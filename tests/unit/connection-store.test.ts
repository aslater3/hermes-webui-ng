import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ConnectionStore } from '../../src/hermes/connection-store.js';
import { HttpError } from '../../src/hermes/dashboard-client.js';
import { ClientError } from '../../src/hermes/protocol.js';
import type { ConnectionState } from '../../src/hermes/gateway-client.js';
class Gateway {
  state: ConnectionState = { phase: 'disconnected', generation: 0, attempt: 0 };
  connects = 0; checks = 0;
  listeners = new Set<(state: ConnectionState) => void>();
  onState(fn: (state: ConnectionState) => void) { this.listeners.add(fn); fn(this.state); return () => { this.listeners.delete(fn); }; }
  phase(phase: ConnectionState['phase'], error?: ClientError) {
    this.state = { phase, error, attempt: 0, generation: this.state.generation + 1 };
    this.listeners.forEach((fn) => fn(this.state));
  }
  close() { this.phase('disconnected'); }
  suspend(error: ClientError) { this.phase(error.kind === 'auth-required' ? 'auth-required' : 'error', error); }
  async connect() { this.connects++; this.phase('ready'); return {}; }
  async ensureLive() { this.checks++; }
  advertised(): Record<string, boolean> { return this.state.phase === 'ready' ? { heartbeat: true } : {}; }
  telemetry() { return { latencyMs: 12 }; }
}
function harness() {
  let id = 'private-user'; let expired = false; let logoutFailure = false;
  const dashboard = {
    status: async () => ({ auth_required: true }),
    providers: async () => [{ name: 'basic', display_name: 'Basic', supports_password: true }],
    me: async () => { if (expired) throw new HttpError(401, true); return { user_id: id, provider: 'basic' }; },
    login: async () => { expired = false; return { user_id: id, provider: 'basic' }; },
    logout: async () => { if (logoutFailure) throw new ClientError('network', 'private-error'); expired = true; },
    schema: async () => ({ openapi: '3.1.0', paths: { '/api/sessions': { get: {} } } }),
    capabilities: async () => ({ schemaVersion: 1, workspace: { available: false }, features: { pwa: false } }),
  };
  const gateway = new Gateway(); const store = new ConnectionStore(dashboard, gateway);
  return { store, gateway, dashboard, expire: () => { expired = true; }, change: () => { id = 'other-private-user'; }, failLogout: () => { logoutFailure = true; } };
}
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
test('healthy REST does not imply ready Gateway, and manual disconnect stays disconnected', async (t) => {
  const h = harness(); t.after(() => h.store.dispose()); h.expire(); await h.store.start();
  assert.equal(h.store.state.rest, 'healthy'); assert.equal(h.store.state.auth, 'auth-required'); assert.equal(h.gateway.connects, 0);
  await h.store.login('basic', 'name', 'private-password'); assert.equal(h.gateway.state.phase, 'ready');
  h.store.disconnect(); await h.store.resume();
  assert.equal(h.gateway.state.phase, 'disconnected'); assert.equal(h.gateway.connects, 1);
});
test('REST expiry while WS is healthy revokes admission and clears transient account state', async (t) => {
  const h = harness(); t.after(() => h.store.dispose()); await h.store.start(); let cleared = 0;
  h.store.onIdentityBoundary(() => { cleared++; }); h.expire(); await h.store.resume();
  assert.equal(cleared, 1); assert.equal(h.gateway.state.phase, 'auth-required'); assert.equal(h.store.state.auth, 'auth-required');
  await h.store.resume(); assert.equal(h.gateway.connects, 1); assert.equal(h.store.capabilities.snapshot().sessionsList.state, 'unknown');
});
test('late identity verification cannot undo explicit logout', async (t) => {
  const h = harness(); t.after(() => h.store.dispose()); await h.store.start();
  let done!: (identity: { user_id: string; provider: string }) => void;
  h.dashboard.me = () => new Promise((resolve) => { done = resolve; });
  const old = h.store.refresh(); await tick(); await h.store.logout();
  done({ user_id: 'stale-private-user', provider: 'basic' }); await old;
  assert.equal(h.store.state.auth, 'signed-out'); assert.equal(h.gateway.state.phase, 'disconnected'); assert.equal(h.gateway.connects, 1);
});
test('identity changes clear the old view before admitting another account', async (t) => {
  const h = harness(); t.after(() => h.store.dispose()); await h.store.start(); let clearedBeforeConnect = false;
  h.store.onIdentityBoundary(() => { clearedBeforeConnect = h.gateway.connects === 1; }); h.change(); await h.store.refresh();
  assert.equal(clearedBeforeConnect, true); assert.equal(h.gateway.connects, 2); assert.equal(JSON.stringify(h.store.report()).includes('private'), false);
});
test('sign-out failure clears the local view but explicitly remains unconfirmed', async (t) => {
  const h = harness(); t.after(() => h.store.dispose()); await h.store.start(); h.failLogout(); await assert.rejects(h.store.logout());
  assert.equal(h.store.state.auth, 'unconfirmed'); assert.equal(h.gateway.state.phase, 'disconnected'); assert.equal(JSON.stringify(h.store.report()).includes('private-error'), false);
});
test('duplicate login is rejected and stale optional schema results cannot repopulate a logged-out scope', async (t) => {
  const h = harness(); t.after(() => h.store.dispose());
  let finish!: (value: { user_id: string; provider: string }) => void;
  h.dashboard.login = () => new Promise((resolve) => { finish = resolve; });
  const first = h.store.login('basic', 'u', 'secret'); await assert.rejects(h.store.login('basic', 'v', 'secret'));
  finish({ user_id: 'private', provider: 'basic' }); await first;
  let schema!: (value: { openapi: string; paths: { '/api/sessions': { get: object } } }) => void;
  h.dashboard.schema = () => new Promise((resolve) => { schema = resolve; });
  const pending = h.store.refreshCapabilities(); await h.store.logout();
  schema({ openapi: '3.1.0', paths: { '/api/sessions': { get: {} } } }); await pending;
  assert.equal(h.store.capabilities.snapshot().sessionsList.state, 'unknown');
});
test('Gateway failure does not falsely mark healthy REST as unreachable', async (t) => {
  const h = harness(); t.after(() => h.store.dispose());
  h.gateway.connect = async () => { h.gateway.phase('error', new ClientError('protocol', 'Upgrade denied')); throw new ClientError('protocol', 'Upgrade denied'); };
  await h.store.start(); assert.equal(h.store.state.rest, 'healthy'); assert.equal(h.store.state.auth, 'signed-in'); assert.equal(h.gateway.state.phase, 'error');
  await h.store.setOffline(true); await h.store.setOffline(false);
  assert.equal(h.gateway.connects, 0, 'terminal rejection must not automatically retry on online');
});
test('offline/resume restores wanted transport but never a deliberately disconnected one', async (t) => {
  const h = harness(); t.after(() => h.store.dispose()); await h.store.start();
  await h.store.setOffline(true); assert.equal(h.gateway.state.phase, 'disconnected');
  await h.store.setOffline(false); assert.equal(h.gateway.connects, 2);
  h.store.disconnect(); await h.store.setOffline(true); await h.store.setOffline(false); assert.equal(h.gateway.connects, 2);
});

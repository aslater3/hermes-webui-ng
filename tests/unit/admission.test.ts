import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ConnectionStore } from '../../src/hermes/connection-store.js';
import { WsAuthClient } from '../../src/hermes/ws-auth.js';
import { ClientError } from '../../src/hermes/protocol.js';
import type { ConnectionState } from '../../src/hermes/gateway-client.js';
class Gateway {
  state: ConnectionState = { phase: 'disconnected', generation: 0, attempt: 0 };
  connects = 0;
  listeners = new Set<(state: ConnectionState) => void>();
  onState(fn: (state: ConnectionState) => void) { this.listeners.add(fn); fn(this.state); return () => { this.listeners.delete(fn); }; }
  phase(phase: ConnectionState['phase'], error?: ClientError) {
    this.state = { phase, error, attempt: 0, generation: this.state.generation + 1 };
    this.listeners.forEach((fn) => fn(this.state));
  }
  close() { this.phase('disconnected'); }
  suspend(error: ClientError) { this.phase(error.kind === 'auth-required' ? 'auth-required' : 'error', error); }
  async connect() { this.connects++; this.phase('ready'); return {}; }
  async ensureLive() {}
  advertised(): Record<string, boolean> { return this.state.phase === 'ready' ? { heartbeat: true } : {}; }
  telemetry() { return { latencyMs: 12 }; }
}
test('admission identity guard runs before a ticket is minted, including repeated attempts', async () => {
  let checked = 0; let minted = 0; let reject = false;
  const client = new WsAuthClient({ origin: 'https://chat.example', ticket: async () => {
    minted++; assert.equal(checked, minted); return { ticket: 'test_only_valid_ticket', ttl_seconds: 30 };
  } }, async () => { checked++; if (reject) throw new Error('Identity changed'); });
  await client.credential(); await client.credential(); reject = true;
  await assert.rejects(client.credential()); assert.equal(minted, 2);
});
test('automatic reconnect cannot admit another account using the old session selection', async (t) => {
  let id = 'private-user';
  const dashboard = {
    status: async () => ({ auth_required: true }),
    providers: async () => [{ name: 'basic', display_name: 'Basic', supports_password: true }],
    me: async () => ({ user_id: id, provider: 'basic' }),
    login: async () => ({ user_id: id, provider: 'basic' }),
    logout: async () => {},
    schema: async () => ({ openapi: '3.1.0', paths: {} }),
    capabilities: async () => ({ schemaVersion: 1, workspace: { available: false }, features: { pwa: false } }),
  };
  const gateway = new Gateway(); const store = new ConnectionStore(dashboard, gateway);
  t.after(() => store.dispose()); await store.start(); let cleared = false;
  store.onIdentityBoundary(() => { cleared = true; });
  await store.verifyAdmission(); id = 'other-private-user'; gateway.phase('authenticating');
  await assert.rejects(store.verifyAdmission(), (error: unknown) => error instanceof ClientError && error.kind === 'auth-required');
  assert.equal(cleared, true); assert.equal(store.state.auth, 'auth-required'); assert.equal(gateway.state.phase, 'auth-required');
});

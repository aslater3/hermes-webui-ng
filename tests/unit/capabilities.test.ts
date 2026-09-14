import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CapabilitiesStore } from '../../src/hermes/capabilities.js';
import { HttpError } from '../../src/hermes/dashboard-client.js';
import { ClientError } from '../../src/hermes/protocol.js';
const schema = { openapi: '3.1.0', paths: { '/api/sessions': { get: {} }, '/api/model/options': { get: {} } } };

test('capabilities use positive schema and Gateway evidence, not version or REST health guesses', () => {
  const store = new CapabilitiesStore(); const epoch = store.begin();
  store.applySchema(epoch, { ...schema, version: '999.0.0', private: 'never retained' });
  assert.equal(store.snapshot().gateway.state, 'unknown');
  assert.equal(store.snapshot().sessionsList.state, 'available');
  assert.equal(store.snapshot().sessionsList.implemented, true);
  assert.equal(store.snapshot().sessionsSearch.state, 'unavailable');
  store.gateway('ready', { heartbeat: true, change_events: false, secret: 'never retained' });
  assert.equal(store.snapshot().gateway.state, 'available');
  assert.equal(store.snapshot().heartbeat.state, 'available');
  assert.equal(store.snapshot().changeEvents.state, 'unavailable');
  store.gateway('reconnecting');
  assert.equal(store.snapshot().gateway.state, 'unreachable');
  assert.equal(store.snapshot().heartbeat.state, 'unknown');
  assert.equal(JSON.stringify(store.snapshot()).includes('retained'), false);
});

test('schema missing, forbidden, unauthenticated and transient failures remain distinct', () => {
  const store = new CapabilitiesStore();
  for (const [error, expected] of [
    [new HttpError(404), 'unknown'], [new HttpError(403), 'forbidden'],
    [new HttpError(401), 'auth-required'], [new ClientError('network', 'down'), 'unreachable'],
  ] as const) {
    store.schemaFailed(store.begin(), error);
    assert.equal(store.snapshot().sessionsList.state, expected);
  }
  assert.throws(() => store.applySchema(store.begin(), { paths: {} }));
  store.gateway('ready', {});
  assert.equal(store.snapshot().heartbeat.state, 'unknown');
});

test('stale capability responses cannot restore old account or connection capabilities', () => {
  const store = new CapabilitiesStore(); const old = store.begin();
  store.reset(); const next = store.begin();
  store.applySchema(old, schema);
  assert.equal(store.discovery, 'unknown');
  store.applyWebui(next, { schemaVersion: 1, workspace: { available: false }, features: { pwa: false } });
  assert.equal(store.snapshot().workspace.state, 'unavailable');
  assert.equal(store.snapshot().pwa.state, 'unavailable');
  const external = store.snapshot(); external.gateway.state = 'available';
  assert.equal(store.snapshot().gateway.state, 'unknown');
});

test('workspace support reflects the configured BFF feature, not a guessed successful file permission', () => {
  const store = new CapabilitiesStore(); assert.equal(store.snapshot().workspace.implemented, true);
  for (const [flag, expected] of [[true, 'available'], [false, 'unavailable'], [undefined, 'unknown']] as const) {
    store.applyWebui(store.begin(), { schemaVersion: 1, workspace: { available: flag }, features: { pwa: true } });
    assert.equal(store.snapshot().workspace.state, expected); assert.equal(store.snapshot().workspace.evidence, 'webui');
  }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CapabilitiesStore } from '../../src/hermes/capabilities.js';

test('PWA capability describes shipped app support, not successful installation on this device', () => {
  const store = new CapabilitiesStore();
  assert.equal(store.snapshot().pwa.implemented, true);
  for (const [flag, state] of [[true, 'available'], [false, 'unavailable'], [undefined, 'unknown']] as const) {
    store.applyWebui(store.begin(), { schemaVersion: 1, workspace: { available: false }, features: { pwa: flag } });
    assert.equal(store.snapshot().pwa.state, state);
    assert.equal(store.snapshot().pwa.evidence, 'webui');
    assert.equal(store.snapshot().workspace.implemented, true);
  }
});

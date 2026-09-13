import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onDocumentExit } from '../../client/document-lifecycle.js';
function hide(target: EventTarget, persisted: boolean) {
  const event = new Event('pagehide'); Object.defineProperty(event, 'persisted', { value: persisted }); target.dispatchEvent(event);
}
test('document exit disposes pending work once instead of leaving delayed fetches alive', () => {
  const target = new EventTarget(); let disposed = 0;
  onDocumentExit(target, () => { disposed++; }); hide(target, false); hide(target, false);
  assert.equal(disposed, 1);
});
test('back-forward cache entry retains the runtime for normal pageshow recovery', () => {
  const target = new EventTarget(); let disposed = 0;
  onDocumentExit(target, () => { disposed++; }); hide(target, true); assert.equal(disposed, 0);
  hide(target, false); assert.equal(disposed, 1);
});
test('error-boundary cleanup can detach the departure listener', () => {
  const target = new EventTarget(); let disposed = 0;
  const remove = onDocumentExit(target, () => { disposed++; }); remove(); hide(target, false); assert.equal(disposed, 0);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DocumentRequests } from '../../client/document-requests.js';

test('navigation aborts active reads and refuses queued reads before native fetch', async () => {
  const target = new EventTarget(); let calls = 0; let received: AbortSignal | undefined;
  const scope = new DocumentRequests(target, async (_input, init) => {
    calls++; received = init?.signal ?? undefined;
    return new Promise<Response>((_resolve, reject) => {
      received!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    });
  });
  const current = scope.fetch('http://example.test/api');
  const rejected = assert.rejects(current, (error: unknown) => error instanceof DOMException && error.name === 'AbortError');
  target.dispatchEvent(new Event('beforeunload'));
  assert.equal(received?.aborted, true);
  await rejected;
  await assert.rejects(scope.fetch('http://example.test/api'));
  assert.equal(calls, 1);
  scope.dispose();
});

test('cached-page restoration opens a fresh scope while caller cancellation still works', async () => {
  const target = new EventTarget(); const signals: AbortSignal[] = [];
  const scope = new DocumentRequests(target, async function (this: unknown, _input, init) {
    assert.equal(this, globalThis); signals.push(init!.signal!); return Response.json({ ok: true });
  });
  await scope.fetch('http://example.test/api');
  target.dispatchEvent(new Event('pagehide'));
  await assert.rejects(scope.fetch('http://example.test/api'));
  target.dispatchEvent(new Event('pageshow'));
  const caller = new AbortController();
  await scope.fetch('http://example.test/api', { signal: caller.signal });
  assert.equal(signals[0]!.aborted, true); assert.equal(signals[1]!.aborted, false);
  caller.abort(); assert.equal(signals[1]!.aborted, true);
  scope.dispose(); target.dispatchEvent(new Event('pageshow'));
  await assert.rejects(scope.fetch('http://example.test/api'));
  assert.equal(signals.length, 2);
});

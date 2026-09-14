import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
test('offline session-fragment navigation uses only the public root cache key', async () => {
  let handle!: (event: Record<string, unknown>) => void; let response!: Promise<Response>;
  const matched: string[] = [];
  const policy = readFileSync('pwa/service-worker.js', 'utf8').replace('__BUILD_ID__', 'test').replace('__PRECACHE__', '["/"]');
  runInNewContext(policy, { self: { location: { origin: 'https://chat.example' }, addEventListener: (type: string, fn: typeof handle) => { if (type === 'fetch') handle = fn; } },
    URL, Request, Response, Set, fetch: async () => { throw new Error('Offline'); },
    caches: { match: async (key: string) => { matched.push(key); return new Response('PUBLIC_SHELL'); } } });
  handle({ request: { url: 'https://chat.example/#session=private-key', method: 'GET', mode: 'navigate' }, respondWith: (pending: Promise<Response>) => { response = pending; } });
  assert.ok(response); assert.equal(await (await response).text(), 'PUBLIC_SHELL');
  assert.deepEqual(matched, ['/']);
});

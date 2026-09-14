import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

test('root HTML stays pinned to the cached worker version online and offline, including session fragments', async () => {
  let handle!: (event: Record<string, unknown>) => void;
  const matched: string[] = []; let fetched = 0;
  const policy = readFileSync('pwa/service-worker.js', 'utf8').replace('__BUILD_ID__', 'test').replace('__PRECACHE__', '["/"]');
  runInNewContext(policy, { self: { location: { origin: 'https://chat.example' }, addEventListener: (type: string, fn: typeof handle) => { if (type === 'fetch') handle = fn; } },
    URL, Request, Response, Set, fetch: async () => { fetched++; return new Response('UNAPPROVED_NEW_BUILD'); },
    caches: { match: async (key: string) => { matched.push(key); return new Response('APPROVED_PUBLIC_SHELL'); } } });
  for (const url of ['https://chat.example/', 'https://chat.example/#session=private-key']) {
    let response!: Promise<Response>;
    handle({ request: { url, method: 'GET', mode: 'navigate' }, respondWith: (pending: Promise<Response>) => { response = pending; } });
    assert.ok(response); assert.equal(await (await response).text(), 'APPROVED_PUBLIC_SHELL');
  }
  assert.deepEqual(matched, ['/', '/']); assert.equal(fetched, 0);
});

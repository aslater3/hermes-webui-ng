import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DashboardClient, HttpError } from '../../src/hermes/dashboard-client.js';
import { DiagnosticsRing } from '../../src/hermes/diagnostics.js';
import { historyPage, searchPage, sessionPage } from '../../src/hermes/session-rest.js';

test('session list uses official recent pagination and encoded profile with no diagnostics content', async () => {
  const diagnostics = new DiagnosticsRing();
  const client = new DashboardClient('https://chat.example', async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.pathname, '/__hermes/api/sessions');
    assert.equal(url.searchParams.get('profile'), 'private profile & one');
    assert.equal(url.searchParams.get('order'), 'recent');
    assert.equal(url.searchParams.get('offset'), '20');
    assert.equal(init?.method, 'GET'); assert.equal(init?.credentials, 'include');
    assert.equal(init?.cache, 'no-store'); assert.equal(init?.redirect, 'error');
    return Response.json({ sessions: [{ id: 'stored', title: 'private title', profile: 'builder' }], total: 21, offset: 20, limit: 20 });
  }, 1000, diagnostics);
  const page = await client.sessions({ offset: 20, profile: 'private profile & one' });
  assert.equal(page.rows[0]?.profile, 'builder');
  const log = JSON.stringify(diagnostics.snapshot());
  for (const value of ['private title', 'private profile', 'stored']) assert.ok(!log.includes(value));
});
test('search and history use supported routes and canonical upstream session/profile', async () => {
  const client = new DashboardClient('http://localhost:8787', async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/search')) {
      assert.equal(url.searchParams.get('q'), 'alpha & ? beta');
      return Response.json({ results: [{ session_id: 'tip', snippet: '<b>untrusted</b>', title: 'Test' }] });
    }
    assert.equal(url.pathname, '/__hermes/api/sessions/parent/messages');
    assert.equal(url.searchParams.get('order'), 'latest');
    assert.equal(url.searchParams.get('offset'), '100');
    assert.equal(url.searchParams.get('limit'), '100');
    return Response.json({ session_id: 'tip', profile: 'owner', messages: [{ role: 'assistant', content: 'reply', id: 42 }],
      pagination: { order: 'latest', limit: 100, offset: 100, returned: 1 } });
  });
  assert.equal((await client.searchSessions('alpha & ? beta'))[0]?.preview, '<b>untrusted</b>');
  const history = await client.sessionMessages({ id: 'parent' }, 100);
  assert.equal(history.id, 'tip'); assert.equal(history.profile, 'owner');
  assert.deepEqual(history.messages[0], { role: 'assistant', text: 'reply', rowId: 42 });
});
test('invalid identifiers, limits and oversized queries never reach the network', async () => {
  let calls = 0;
  const client = new DashboardClient('http://localhost', async () => { calls++; return Response.json({}); });
  for (const id of ['../secret', '..', '.', 'a/b', 'a\\b', '%2e%2e']) await assert.rejects(client.sessionMessages({ id }));
  for (const limit of [0, 101, -1, NaN]) await assert.rejects(client.sessions({ limit }));
  await assert.rejects(client.searchSessions('x'.repeat(513))); await assert.rejects(client.sessions({ offset: -1 }));
  assert.equal(calls, 0);
});
test('empty pages differ from HTTP errors and malformed responses', async () => {
  assert.deepEqual(sessionPage({ sessions: [], total: 0, offset: 0, limit: 20 }).rows, []);
  const client = new DashboardClient('http://localhost', async () => Response.json({ detail: 'private' }, { status: 503 }));
  await assert.rejects(client.sessions(), (error: unknown) => error instanceof HttpError && error.status === 503 && !error.message.includes('private'));
  assert.throws(() => sessionPage({ sessions: [], total: 0, offset: -1, limit: 20 }));
  assert.throws(() => historyPage({ session_id: 'id', messages: [], pagination: { order: 'oldest', offset: 0, limit: 100 } }, { id: 'id' }, 0));
});
test('history bounds individual entries; search deduplicates without dropping profile scope', () => {
  const page = historyPage({ session_id: 'id', messages: [{ role: 'assistant', content: 'x'.repeat(140000) }] }, { id: 'id' }, 0);
  assert.equal(page.messages[0]?.text.length, 131072); assert.equal(page.messages[0]?.truncated, true);
  assert.equal(searchPage({ results: [{ session_id: 'id', profile: 'a' }, { session_id: 'id', profile: 'a' }, { session_id: 'id', profile: 'b' }] }).length, 2);
});

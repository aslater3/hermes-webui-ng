import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DashboardClient } from '../../src/hermes/dashboard-client.js';
import { mergeSearch, profileNames, sessionPage, type SessionRow } from '../../src/hermes/session-rest.js';
import { localPathAllowed } from '../../server/trusted-local.js';

type Handler = (url: URL) => Response | Promise<Response>;
const client = (handler: Handler, calls: URL[] = []) =>
  new DashboardClient('https://chat.example', async (input) => { const url = new URL(String(input)); calls.push(url); return handler(url); }, 1000);
const row = (id: string, profile: string, lastActive: number): SessionRow =>
  ({ id, profile, title: id, preview: '', source: '', lastActive, messageCount: 0 });

test('an unscoped session list reads every profile and keeps each row\'s owning profile', async () => {
  const calls: URL[] = [];
  const page = await client(() => Response.json({
    sessions: [{ id: 'a', profile: 're', last_active: 9 }, { id: 'b', profile: 'default', last_active: 8 }],
    total: 2, profile_totals: { re: 1, default: 1 }, offset: 0, limit: 20, errors: [] }), calls).sessions({ limit: 20 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.pathname, '/__hermes/api/profiles/sessions');
  assert.equal(calls[0]!.searchParams.get('profile'), 'all');
  assert.equal(calls[0]!.searchParams.get('order'), 'recent');
  assert.equal(calls[0]!.searchParams.get('exclude_sources'), 'cron');
  assert.deepEqual(page.rows.map(r => [r.id, r.profile]), [['a', 're'], ['b', 'default']]);
});

test('a scoped session list stays on the single-profile route', async () => {
  const calls: URL[] = [];
  await client(() => Response.json({ sessions: [], total: 0, offset: 0, limit: 20 }), calls).sessions({ profile: 're' });
  assert.equal(calls[0]!.pathname, '/__hermes/api/sessions');
  assert.equal(calls[0]!.searchParams.get('profile'), 're');
  assert.equal(calls[0]!.searchParams.get('exclude_sources'), 'cron');
});

test('a Hermes without the cross-profile route falls back to the serving profile list', async () => {
  const calls: URL[] = [];
  const page = await client((url) => url.pathname.endsWith('/profiles/sessions')
    ? new Response('{}', { status: 404 })
    : Response.json({ sessions: [{ id: 'x', profile: 'default' }], total: 1, offset: 0, limit: 20 }), calls).sessions();
  assert.deepEqual(calls.map(c => c.pathname), ['/__hermes/api/profiles/sessions', '/__hermes/api/sessions']);
  assert.equal(calls[1]!.searchParams.has('profile'), false);
  assert.equal(page.rows[0]?.id, 'x');
});

test('pinned rows back-filled past the page window are accepted', () => {
  const sessions = Array.from({ length: 23 }, (_, i) => ({ id: `s${i}`, profile: 'default' }));
  assert.equal(sessionPage({ sessions, total: 40, offset: 0, limit: 20 }).rows.length, 23);
  assert.throws(() => sessionPage({ sessions: Array.from({ length: 71 }, (_, i) => ({ id: `s${i}` })), total: 80, offset: 0, limit: 20 }));
});

test('unscoped search fans out to every profile, merges by recency and tolerates one failing profile', async () => {
  const calls: URL[] = [];
  const results = await client((url) => {
    if (url.pathname === '/__hermes/api/profiles')
      return Response.json({ profiles: [{ name: 'default' }, { name: 're' }, { name: 'broken' }, { name: 'bad\u0001name' }, {}] });
    const profile = url.searchParams.get('profile');
    if (profile === 'broken') return new Response('{}', { status: 503 });
    const hits = profile === 're' ? [{ session_id: 'r1', profile: 're', last_active: 50 }]
      : [{ session_id: 'd1', profile: 'default', last_active: 10 }, { session_id: 'd2', profile: 'default', last_active: 90 }];
    return Response.json({ results: hits });
  }, calls).searchSessions('kaeru');
  const searched = calls.filter(c => c.pathname === '/__hermes/api/sessions/search').map(c => c.searchParams.get('profile')).sort();
  assert.deepEqual(searched, ['broken', 'default', 're']);
  assert.deepEqual(results.map(r => [r.id, r.profile]), [['d2', 'default'], ['r1', 're'], ['d1', 'default']]);
});

test('unscoped search fails only when every profile fails', async () => {
  await assert.rejects(client((url) => url.pathname === '/__hermes/api/profiles'
    ? Response.json({ profiles: [{ name: 'default' }, { name: 're' }] }) : new Response('{}', { status: 503 })).searchSessions('x'));
});

test('scoped search reads only that profile', async () => {
  const calls: URL[] = [];
  await client(() => Response.json({ results: [] }), calls).searchSessions('x', 're');
  assert.deepEqual(calls.map(c => [c.pathname, c.searchParams.get('profile')]), [['/__hermes/api/sessions/search', 're']]);
});

test('merge keeps the same session id distinct across profiles and bounds the result', () => {
  const merged = mergeSearch([[row('same', 'default', 1)], [row('same', 're', 2)], [row('same', 're', 3)]]);
  assert.deepEqual(merged.map(r => [r.profile, r.lastActive]), [['re', 2], ['default', 1]]);
  const many = mergeSearch([Array.from({ length: 150 }, (_, i) => row(`s${i}`, 'default', i))]);
  assert.equal(many.length, 100); assert.equal(many[0]!.lastActive, 149);
  assert.throws(() => profileNames({}));
});

test('trusted-local proxies the read-only cross-profile list but not its siblings or writes', () => {
  assert.equal(localPathAllowed('/api/profiles/sessions?profile=all&limit=20', 'GET'), true);
  assert.equal(localPathAllowed('/api/profiles/sessions', 'POST'), false);
  assert.equal(localPathAllowed('/api/profiles/sessions/pull-requests', 'GET'), false);
  assert.equal(localPathAllowed('/api/profiles/sessions?token=x', 'GET'), false);
});

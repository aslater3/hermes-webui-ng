import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SessionBrowser } from '../../src/hermes/session-browser.js';
import { HttpError } from '../../src/hermes/dashboard-client.js';
import type { HistoryPage, SessionPage, SessionRow } from '../../src/hermes/session-rest.js';
const row = (id: string): SessionRow => ({ id, title: id, preview: '', source: '', lastActive: 0, messageCount: 0 });
const page = (id: string): SessionPage => ({ rows: [row(id)], total: 1, offset: 0, limit: 20 });
const history = (id: string): HistoryPage => ({ id, profile: 'owner', messages: [{ role: 'user', text: id }], offset: 0, limit: 100, returned: 1 });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; }
const base = { sessions: async () => page('one'), searchSessions: async () => [row('found')], sessionMessages: async () => history('one') };

test('a late list response cannot replace newer search results', async () => {
  const old = deferred<SessionPage>();
  const store = new SessionBrowser({ ...base, sessions: () => old.promise });
  const pending = store.list(); await store.list('new search'); old.resolve(page('stale')); await pending;
  assert.equal(store.index.rows[0]?.id, 'found'); assert.equal(store.index.query, 'new search'); store.dispose();
});
test('late history cannot contaminate a different selected session', async () => {
  const old = deferred<HistoryPage>();
  const store = new SessionBrowser({ ...base, sessionMessages: (ref) => ref.id === 'old' ? old.promise : Promise.resolve(history('canonical')) });
  const first = store.open({ id: 'old' }); const second = await store.open({ id: 'new' }); old.resolve(history('old'));
  assert.equal(await first, undefined); assert.equal(second?.id, 'canonical'); assert.equal(store.history.page?.profile, 'owner'); store.dispose();
});
test('same-query failures retain last good rows but a changed query never shows the old rows', async () => {
  let fail = false;
  const store = new SessionBrowser({ ...base, sessions: async () => { if (fail) throw new HttpError(503); return page('one'); }, searchSessions: async () => { throw new HttpError(403); } });
  await store.list(); fail = true; await store.refresh();
  assert.equal(store.index.phase, 'error'); assert.equal(store.index.rows[0]?.id, 'one');
  await store.list('different'); assert.equal(store.index.phase, 'error'); assert.equal(store.index.rows.length, 0); store.dispose();
});
test('account clearing invalidates in-flight requests and all transient content', async () => {
  const pending = deferred<SessionPage>(), pendingHistory = deferred<HistoryPage>();
  const store = new SessionBrowser({ ...base, sessions: () => pending.promise, sessionMessages: () => pendingHistory.promise });
  const a = store.list(), b = store.open({ id: 'private' }); store.clear();
  pending.resolve(page('private')); pendingHistory.resolve(history('private')); await Promise.all([a,b]);
  assert.equal(store.index.rows.length, 0); assert.equal(store.history.phase, 'empty'); store.dispose();
});
test('paging preserves explicit profile and does not pretend search has an offset API', async () => {
  const calls: unknown[] = [];
  const store = new SessionBrowser({ ...base, sessions: async (options) => { calls.push(options); return { ...page('a'), total: 42, offset: options?.offset ?? 0 }; } });
  await store.list('', 20, 'builder'); assert.equal(store.index.hasNext, true); assert.deepEqual(calls[0], { limit:20, offset:20, profile:'builder' });
  await store.list('find', 0, 'builder'); assert.equal(store.index.hasNext, false); assert.equal(store.index.total, 1); store.dispose();
});
test('auth expiry signals the account owner; missing history does not create a session', async () => {
  let auth = 0;
  const store = new SessionBrowser({ ...base, sessions: async () => { throw new HttpError(401); }, sessionMessages: async () => { throw new HttpError(404); } }, () => { auth++; });
  await store.list(); assert.equal(auth, 1); await store.open({ id:'missing' });
  assert.equal(store.history.phase, 'error'); assert.equal(store.history.page, undefined); assert.equal(auth, 1); store.dispose();
});

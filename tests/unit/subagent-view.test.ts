import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ChatController, navigation, navigationRef, navigationView } from '../../src/hermes/chat-controller.js';
import type { ConnectionState } from '../../src/hermes/gateway-client.js';
import { ClientError, type GatewayEvent } from '../../src/hermes/protocol.js';
import { firstMessage, type HistoryMessage, type HistoryPage, type SessionRef } from '../../src/hermes/session-rest.js';
import { mergeSubagent, subagentPatch } from '../../src/hermes/subagent-catalog.js';

function fixture(options: { prompt?: HistoryMessage; promptError?: boolean } = {}) {
  const state: ConnectionState = { phase: 'ready', generation: 1, attempt: 0 };
  const calls: string[] = []; const reads: { id: string; offset: number }[] = [];
  let pages = 0;
  const gateway = { state, onState: (cb: (s: ConnectionState) => void) => { cb(state); return () => {}; },
    onEvent: (_cb: (e: GatewayEvent) => void) => () => {},
    call: async (method: string) => { calls.push(method); return {}; } };
  const reader = { sessions: async () => ({ rows: [], total: 0, limit: 20, offset: 0 }), searchSessions: async () => [],
    sessionMessages: async (ref: SessionRef, offset = 0): Promise<HistoryPage> => {
      reads.push({ id: ref.id, offset }); pages++;
      return { id: ref.id, profile: ref.profile ?? 'default', offset, limit: 100, returned: 100,
        messages: [{ role: 'assistant', text: `page ${pages}` } as unknown as HistoryMessage] };
    },
    sessionFirstMessage: async () => { if (options.promptError) throw new ClientError('network', 'down'); return options.prompt; } };
  const chat = new ChatController(reader, gateway); chat.setEnabled(true);
  return { chat, calls, reads };
}

test('child_session_id becomes the durable child session id and survives a patch that omits it', () => {
  const start = subagentPatch({ subagent_id: 'sa-1', child_session_id: '20261006_151032_67cdd2' })!;
  assert.equal(start.sessionId, '20261006_151032_67cdd2');
  const merged = mergeSubagent(mergeSubagent(undefined, start), subagentPatch({ subagent_id: 'sa-1', tool_count: 3 })!);
  assert.equal(merged.sessionId, '20261006_151032_67cdd2');
  // A path-shaped id is dropped rather than turned into a link.
  assert.equal(subagentPatch({ subagent_id: 'sa-2', child_session_id: '../etc' })!.sessionId, undefined);
});

test('firstMessage reads one oldest message and rejects an oversized page', () => {
  const message = firstMessage({ messages: [{ role: 'user', content: 'Do the task' }] });
  assert.equal(message?.role, 'user');
  assert.equal(firstMessage({ messages: [] }), undefined);
  assert.throws(() => firstMessage({ messages: [{ role: 'user', content: 'a' }, { role: 'user', content: 'b' }] }));
});

test('subagent links round-trip through the hash and keep the view marker', () => {
  const hash = navigation({ id: 'child-1', profile: 'work' }, 'subagent');
  assert.deepEqual(navigationRef(hash), { id: 'child-1', profile: 'work' });
  assert.equal(navigationView(hash), 'subagent');
  assert.equal(navigationView(navigation({ id: 'child-1' })), undefined);
});

test('opening a subagent is REST-only and read-only: never resumes or writes into the child', async () => {
  const prompt = { role: 'user', text: 'Audit the scripts' } as unknown as HistoryMessage;
  const h = fixture({ prompt });
  await h.chat.openSubagent({ id: 'child-1' }, { parent: { id: 'parent-1' }, goal: 'Audit' });
  assert.deepEqual(h.calls, [], 'no gateway RPC (resume/activate/submit) for a child');
  assert.equal(h.chat.readOnly, true); assert.equal(h.chat.historical, true);
  assert.equal(h.chat.subagent?.promptState, 'ready'); assert.equal(h.chat.subagent?.prompt, prompt);
  assert.equal(h.chat.subagent?.parent?.id, 'parent-1');
  h.chat.setDraft('hello'); await h.chat.send(); assert.deepEqual(h.calls, []);
  // Opening an ordinary conversation leaves the subagent view.
  await h.chat.open({ id: 'other' }); assert.equal(h.chat.subagent, undefined);
  h.chat.dispose();
});

test('a failed prompt read degrades to missing, not an error over the transcript', async () => {
  const h = fixture({ promptError: true });
  await h.chat.openSubagent({ id: 'child-1' });
  assert.equal(h.chat.subagent?.promptState, 'missing'); assert.equal(h.chat.error, undefined);
  assert.equal(h.chat.browser.history.phase, 'ready');
  h.chat.dispose();
});

test('refresh re-reads the latest page in place, and stands down while the operator pages back', async () => {
  const h = fixture();
  await h.chat.openSubagent({ id: 'child-1' });
  await h.chat.refreshSubagent();
  assert.equal(h.chat.browser.history.phase, 'ready');
  assert.equal(h.chat.browser.history.page?.messages[0]?.text, 'page 2');
  await h.chat.historyPage(100);
  const before = h.reads.length;
  await h.chat.refreshSubagent();
  assert.equal(h.reads.length, before, 'no refresh while an earlier page is shown');
  h.chat.dispose();
});

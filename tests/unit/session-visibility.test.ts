import { test } from 'node:test';
import assert from 'node:assert/strict';
import { visibleSessionRows } from '../../src/hermes/session-visibility.js';
import type { AttentionItem } from '../../src/hermes/session-attention.js';
import type { SessionRow } from '../../src/hermes/session-rest.js';

const row = (id: string, profile = 'default'): SessionRow => ({
  id,
  profile,
  title: id,
  preview: '',
  source: 'webui',
  lastActive: 1,
  messageCount: 1,
});
const active = (storedId: string, status: AttentionItem['status']): AttentionItem => ({
  runtimeId: `runtime-${storedId}`,
  storedId,
  title: storedId,
  status,
  review: false,
});

test('removes working, starting, and waiting sessions from the date-grouped list', () => {
  const rows = [row('working'), row('starting'), row('waiting'), row('finished')];
  const items = [active('working', 'working'), active('starting', 'starting'), active('waiting', 'waiting')];
  assert.deepEqual(
    visibleSessionRows(rows, items).map((item) => item.id),
    ['finished'],
  );
});

test('keeps a finished session in the date-grouped list after active state clears', () => {
  const rows = [row('finished')];
  assert.deepEqual(
    visibleSessionRows(rows, []).map((item) => item.id),
    ['finished'],
  );
});

test('does not hide a same-named session from another profile', () => {
  const rows = [row('same', 'default'), row('same', 'other')];
  const item = { ...active('same', 'working'), owner: { id: 'same', profile: 'default' } };
  assert.deepEqual(
    visibleSessionRows(rows, [item]).map((item) => [item.id, item.profile]),
    [['same', 'other']],
  );
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SUBAGENT_LIMIT, mergeRoster, mergeSubagent, reconcileHydration, subagentElapsedSeconds, subagentPatch,
  subagentRoster, subagentRosterPatches, subagentStatusLabel, subagentSummary, upsertSubagent,
} from '../../src/hermes/subagent-catalog.js';

/** Test-only: a fixture that silently lost its identity would make every later assertion meaningless. */
const patch = (input: unknown) => {
  const parsed = subagentPatch(input);
  assert.ok(parsed, `fixture has no usable subagent identity: ${JSON.stringify(input)}`);
  return parsed;
};

test('a subagent row needs an exact identifier and never invents one from a title', () => {
  assert.equal(subagentPatch({ goal: 'No identity' }), undefined);
  assert.equal(subagentPatch({ subagent_id: '', goal: 'Empty' }), undefined);
  assert.equal(subagentPatch({ subagent_id: '../escape' }), undefined);
  assert.equal(subagentPatch({ subagent_id: 'sa-0-1054fd14' })?.subagentId, 'sa-0-1054fd14');
});

test('status aliases normalise and unknown statuses stay unknown', () => {
  assert.equal(subagentPatch({ subagent_id: 'a', status: 'running' })?.status, 'working');
  assert.equal(subagentPatch({ subagent_id: 'a', status: 'queued' })?.status, 'starting');
  assert.equal(subagentPatch({ subagent_id: 'a', status: 'completed' })?.status, 'completed');
  assert.equal(subagentPatch({ subagent_id: 'a', status: 'shiny' })?.status, 'unknown');
});

test('roster reads are bounded, deduplicated and reject a malformed envelope', () => {
  const roster = subagentRoster({ subagents: [
    { subagent_id: 'sa-0', goal: 'G'.repeat(400), status: 'working', model: 'deepseek-v4.1-flash', last_tool: 'terminal', tool_count: 12, accepting_steer: true },
    { subagent_id: 'sa-0', goal: 'Duplicate' },
    { subagent_id: 'sa-1', status: 'completed' },
  ], delegations: [] });
  assert.deepEqual(roster.map(item => item.subagentId), ['sa-0', 'sa-1']);
  assert.equal(roster[0]?.goal.length, 160);
  assert.equal(roster[0]?.model, 'deepseek-v4.1-flash');
  assert.equal(roster[0]?.lastTool, 'terminal');
  assert.equal(roster[0]?.toolCount, 12);
  assert.equal(roster[0]?.acceptingSteer, true);
  assert.throws(() => subagentRoster({ subagents: 'nope' }));
  assert.throws(() => subagentRoster({ subagents: Array.from({ length: 5000 }, (_, i) => ({ subagent_id: `sa-${i}` })) }));
});

test('the roster is bounded even when Hermes sends more children than we render', () => {
  const roster = subagentRoster({ subagents: Array.from({ length: SUBAGENT_LIMIT + 40 }, (_, i) => ({ subagent_id: `sa-${i}` })) });
  assert.equal(roster.length, SUBAGENT_LIMIT);
});

test('an event patch merges without erasing values the event omitted', () => {
  const previous = mergeSubagent(undefined, patch({ subagent_id: 'sa-0', goal: 'Atomics fix', model: 'deepseek-v4.1-flash', status: 'working' }));
  const merged = mergeSubagent(previous, patch({ subagent_id: 'sa-0', tool_name: 'terminal' }));
  assert.equal(merged.goal, 'Atomics fix');
  assert.equal(merged.model, 'deepseek-v4.1-flash');
  assert.equal(merged.status, 'working');
  assert.equal(merged.lastTool, 'terminal');
});

test('a duration-only event derives a start time so elapsed time is still shown', () => {
  const item = mergeSubagent(undefined, patch({ subagent_id: 'sa-0', status: 'working', duration_seconds: 360 }), 1_000_000);
  assert.equal(item.startedAt, 640);
  assert.equal(subagentElapsedSeconds(item, 1_000_000), 360);
});

test('hydration adds and updates but never removes a child the live stream reported as running', () => {
  const live = mergeSubagent(undefined, patch({ subagent_id: 'sa-live', goal: 'Running work', status: 'working' }));
  const done = mergeSubagent(undefined, patch({ subagent_id: 'sa-done', status: 'completed' }));
  const roster = subagentRosterPatches({ subagents: [{ subagent_id: 'sa-live', goal: 'Running work', tool_count: 4 }] });
  const misses = new Map<string, number>();
  const merged = reconcileHydration([live, done], roster, misses);
  const byId = new Map(merged.map(item => [item.subagentId, item]));
  assert.deepEqual([...byId.keys()].sort(), ['sa-done', 'sa-live']);
  assert.equal(byId.get('sa-live')?.toolCount, 4);
  assert.equal(byId.get('sa-live')?.status, 'working');
  assert.equal(byId.get('sa-done')?.status, 'completed');
});

test('a live child the roster keeps omitting is retired only after a bounded run of misses', () => {
  const live = mergeSubagent(undefined, patch({ subagent_id: 'sa-live', status: 'working' }));
  const misses = new Map<string, number>();
  const empty = subagentRosterPatches({ subagents: [] });
  assert.deepEqual(reconcileHydration([live], empty, misses).map(item => item.subagentId), ['sa-live']);
  assert.equal(misses.get('sa-live'), 1);
  assert.deepEqual(reconcileHydration([live], empty, misses).map(item => item.subagentId), ['sa-live']);
  assert.deepEqual(reconcileHydration([live], empty, misses).map(item => item.subagentId), []);
  assert.equal(misses.has('sa-live'), false);
  // A roster that reports the child again clears the run instead of retiring it.
  reconcileHydration([live], empty, misses);
  const reporting = subagentRosterPatches({ subagents: [{ subagent_id: 'sa-live', status: 'running' }] });
  assert.deepEqual(reconcileHydration([live], reporting, misses).map(item => item.subagentId), ['sa-live']);
  assert.equal(misses.has('sa-live'), false);
});

test('a terminal child is final: no later snapshot or frame reopens it', () => {
  const finished = mergeSubagent(undefined, patch({ subagent_id: 'sa-0', status: 'completed' }));
  const reopenedByRoster = mergeRoster([finished], subagentRosterPatches({ subagents: [{ subagent_id: 'sa-0', status: 'running', tool_count: 9 }] }));
  assert.equal(reopenedByRoster[0]?.status, 'completed');
  assert.equal(reopenedByRoster[0]?.toolCount, 9);
  assert.equal(upsertSubagent([finished], patch({ subagent_id: 'sa-0', status: 'running' }))[0]?.status, 'completed');
  assert.equal(upsertSubagent([finished], patch({ subagent_id: 'sa-0', tool_name: 'terminal' }))[0]?.status, 'completed');
});

test('summary text is fixed language, bounded and derived only from validated fields', () => {
  const item = mergeSubagent(undefined, patch({
    subagent_id: 'sa-0', goal: 'Secret goal', status: 'running', model: 'deepseek-v4.1-flash',
    tool_name: 'terminal', tool_count: 7, started_at: 1000,
  }));
  assert.equal(subagentStatusLabel('working'), 'Running');
  assert.equal(subagentStatusLabel('waiting'), 'Needs your input');
  const summary = subagentSummary(item, 1_960_000);
  assert.equal(summary, 'Running 16 min · deepseek-v4.1-flash · last tool: terminal · 7 tools');
  assert.ok(!summary.includes('Secret goal'));
  assert.equal(subagentSummary(mergeSubagent(undefined, patch({ subagent_id: 'sa-1', duration_seconds: 30 }), 1_000_000), 1_000_000), 'Unknown 30 s');
});

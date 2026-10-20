import { test } from 'node:test';
import assert from 'node:assert/strict';
import { skillList, skillDocument, skillName, SKILL_LIST_LIMIT, SKILL_CONTENT_LIMIT } from '../../src/hermes/skills.js';
import { SkillBrowser } from '../../src/hermes/skill-browser.js';
import { CapabilitiesStore } from '../../src/hermes/capabilities.js';
import { ClientError } from '../../src/hermes/protocol.js';
import { HttpError } from '../../src/hermes/dashboard-client.js';

const upstreamRow = { name: 'arxiv', description: 'Search papers\u0007', category: 'research', enabled: true,
  provenance: 'hub', usage: 4, path: '/srv/secret/home/skills/arxiv', tags: ['x'] };

test('skill list projection keeps only typed display fields from the bare upstream array', () => {
  const [row] = skillList([upstreamRow, { name: 'odd', provenance: 'weird', usage: -3, enabled: false }]);
  assert.deepEqual(row, { name: 'arxiv', description: 'Search papers', category: 'research', enabled: true, provenance: 'hub', usage: 4 });
  assert.deepEqual(skillList([upstreamRow])[0]!.enabled, true);
  const second = skillList([upstreamRow, { name: 'odd', provenance: 'weird', usage: -3, enabled: false }])[1]!;
  assert.deepEqual([second.provenance, second.usage, second.enabled], ['unknown', 0, false]);
  assert.equal(JSON.stringify(skillList([upstreamRow])).includes('/srv/secret'), false);
});

test('skill list rejects non-arrays, nameless rows and oversize pages', () => {
  assert.throws(() => skillList({ skills: [] }), ClientError);
  assert.throws(() => skillList([{ description: 'no name' }]), ClientError);
  assert.throws(() => skillList(Array.from({ length: SKILL_LIST_LIMIT + 1 }, () => upstreamRow)), ClientError);
});

test('skill content drops the server path and bounds the Markdown size', () => {
  const doc = skillDocument({ name: 'arxiv', content: '# Title\r\nBody', path: '/srv/secret/SKILL.md' }, 'arxiv');
  assert.deepEqual(doc, { name: 'arxiv', content: '# Title\nBody', truncated: false });
  assert.equal(JSON.stringify(doc).includes('/srv/secret'), false);
  const big = skillDocument({ name: 'big', content: 'a'.repeat(SKILL_CONTENT_LIMIT + 5) }, 'big');
  assert.equal(big.content.length, SKILL_CONTENT_LIMIT); assert.equal(big.truncated, true);
  assert.throws(() => skillDocument({ name: 'x' }, 'x'), ClientError);
});

test('skill names are query values with bounded, control-free characters', () => {
  assert.equal(skillName('mlops/axolotl'), 'mlops/axolotl');
  for (const bad of ['', 'a\nb', 'x'.repeat(257)]) assert.throws(() => skillName(bad), ClientError);
});

test('capability gating: skills are only available when the schema advertises GET routes', () => {
  const store = new CapabilitiesStore(); const epoch = store.begin();
  store.applySchema(epoch, { openapi: '3.1.0', paths: { '/api/skills': { get: {} } } });
  assert.equal(store.snapshot().skills.state, 'available');
  assert.equal(store.snapshot().skills.implemented, true);
  assert.equal(store.snapshot().skillContent.state, 'unavailable');
  const absent = new CapabilitiesStore(); absent.applySchema(absent.begin(), { openapi: '3.1.0', paths: {} });
  assert.equal(absent.snapshot().skills.state, 'unavailable');
  const failed = new CapabilitiesStore(); failed.schemaFailed(failed.begin(), new HttpError(403));
  assert.equal(failed.snapshot().skills.state, 'forbidden');
});

function fakeDashboard() {
  const pending: { profile?: string; resolve: (rows: unknown) => void; reject: (e: unknown) => void }[] = [];
  const dashboard = {
    skills: (profile?: string) => new Promise((resolve, reject) => pending.push({ profile, resolve: resolve as (r: unknown) => void, reject })),
    skillContent: async (name: string) => ({ name, content: `# ${name}`, truncated: false }),
  };
  return { dashboard: dashboard as never, pending };
}

test('profile change invalidates in-flight results and clears the previous profile rows', async () => {
  const { dashboard, pending } = fakeDashboard();
  const browser = new SkillBrowser(dashboard);
  const first = browser.load('work');
  const second = browser.load('home');
  assert.equal(browser.list.profile, 'home');
  pending[1]!.resolve([upstreamRow]);
  await second;
  pending[0]!.resolve([{ ...upstreamRow, name: 'stale-work' }]);
  await first;
  assert.deepEqual(browser.list.rows.map(row => row.name), ['arxiv']);
  assert.equal(browser.list.profile, 'home');
  browser.dispose();
});

test('a failed refresh keeps same-profile cached rows as stale, never as empty', async () => {
  const { dashboard, pending } = fakeDashboard();
  const browser = new SkillBrowser(dashboard);
  const ok = browser.load('default'); pending[0]!.resolve([upstreamRow]); await ok;
  const failed = browser.load('default'); pending[1]!.reject(new ClientError('network', 'down')); await failed;
  assert.equal(browser.list.phase, 'error'); assert.equal(browser.list.stale, true);
  assert.equal(browser.list.rows.length, 1);
  browser.dispose();
});

test('detail reads from a superseded profile are discarded', async () => {
  let release!: (value: unknown) => void;
  const dashboard = { skills: async () => [], skillContent: () => new Promise(resolve => { release = resolve as (v: unknown) => void; }) };
  const browser = new SkillBrowser(dashboard as never);
  await browser.load('work');
  const opening = browser.open('arxiv', 'work');
  await browser.load('home');
  release({ name: 'arxiv', content: 'work-only', truncated: false });
  await opening;
  assert.equal(browser.detail.phase, 'empty');
  browser.dispose();
});

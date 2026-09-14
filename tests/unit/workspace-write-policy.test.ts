import test from 'node:test';
import assert from 'node:assert/strict';
import { writePolicy, assertWriteRequest, writableRoot } from '../../server/workspace/write-policy.js';
import { saveInput } from '../../server/workspace/file-version.js';
import { WriteAudit } from '../../server/workspace/write-audit.js';
const roots = [{ id: 'workspace', label: 'Project', path: '/workspace', dev: 1, ino: 2 }, { id: 'workspace-2', label: 'Read only', path: '/other', dev: 1, ino: 3 }];
const origin = new URL('https://192.168.0.63:8788');
const headers = { host: origin.host, origin: origin.origin, 'content-type': 'application/json', 'x-webui-request': 'workspace-write' };
test('writes require global opt-in, selected logical roots and HTTPS; every default stays disabled', () => {
  assert.deepEqual(writePolicy({}, roots, origin), { enabled: false, roots: [] });
  const policy = writePolicy({ WORKSPACE_WRITE_ENABLED: 'true', WORKSPACE_WRITABLE_ROOTS: 'workspace' }, roots, origin);
  assert.equal(writableRoot(policy, roots[0]!), true); assert.equal(writableRoot(policy, roots[1]!), false);
  for (const env of [{ WORKSPACE_WRITE_ENABLED: 'yes' }, { WORKSPACE_WRITE_ENABLED: 'true' }, { WORKSPACE_WRITABLE_ROOTS: 'workspace' },
    { WORKSPACE_WRITE_ENABLED: 'true', WORKSPACE_WRITABLE_ROOTS: '/etc' }, { WORKSPACE_WRITE_ENABLED: 'true', WORKSPACE_WRITABLE_ROOTS: 'workspace,workspace' }])
    assert.throws(() => writePolicy(env, roots, origin));
  assert.throws(() => writePolicy({ WORKSPACE_WRITE_ENABLED: 'true', WORKSPACE_WRITABLE_ROOTS: 'workspace' }, roots, new URL('http://localhost:8787')));
});
test('write request guard rejects missing/null/cross-site origin, simple forms, spoofing and compression', () => {
  assert.doesNotThrow(() => assertWriteRequest(headers, origin));
  assert.doesNotThrow(() => assertWriteRequest({ ...headers, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json; charset=UTF-8' }, origin));
  for (const patch of [{ origin: undefined }, { origin: 'null' }, { origin: 'https://evil.invalid' }, { host: 'evil.invalid' },
    { 'sec-fetch-site': 'same-site' }, { 'sec-fetch-site': 'cross-site' }, { 'sec-fetch-site': 'none' }, { referer: 'https://evil.invalid/' },
    { 'x-webui-request': undefined }, { 'content-type': 'text/plain' }, { 'content-type': 'multipart/form-data' }, { 'content-encoding': 'gzip' }])
    assert.throws(() => assertWriteRequest({ ...headers, ...patch }, origin));
  assert.throws(() => assertWriteRequest({ ...headers, origin: undefined, 'x-forwarded-host': origin.host }, origin));
});
test('save input requires a strong version and exact bounded UTF-8 fields, never overwrite/force options', () => {
  const data = { root: 'workspace', path: 'file.txt', text: 'é\r\n', expectedVersion: 'a'.repeat(64) };
  assert.deepEqual(saveInput(data), data);
  for (const patch of [{ expectedVersion: null }, { expectedVersion: '*' }, { expectedVersion: '' }, { root: '/etc' }, { force: true },
    { text: '\ud800' }, { text: '\0' }, { text: 'é'.repeat(131073) }]) assert.throws(() => saveInput({ ...data, ...patch }));
  assert.equal(saveInput({ ...data, text: '' }).text, '');
});
test('audit is bounded metadata and salted tags only; it records once and cannot break save results', () => {
  const logs: unknown[] = [], audit = new WriteAudit(event => logs.push(event));
  const done = audit.begin('PRIVATE_COOKIE'); done(200, 'saved', 'workspace', 'PRIVATE_FILE.txt', 6); done(500, 'rejected');
  assert.equal(logs.length, 1); assert.ok(!JSON.stringify(logs).includes('PRIVATE'));
  const other: unknown[] = []; new WriteAudit(event => other.push(event)).begin('PRIVATE_COOKIE')(200, 'saved', 'workspace', 'PRIVATE_FILE.txt');
  assert.notDeepEqual(logs, other);
  assert.doesNotThrow(() => new WriteAudit(() => { throw new Error('bad log sink'); }).begin(undefined)(200, 'saved'));
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

test('HTTPS setup retains tokens and CA, issues valid SAN certificates and never mounts its signing key', t => {
  const dir = mkdtempSync(join(tmpdir(), 'ng-setup-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir,'.env'), 'HERMES_AUTH_MODE=trusted-local\nHERMES_DASHBOARD_SESSION_TOKEN=TEST_ONLY\nPUBLIC_ORIGIN=http://192.168.0.63:8788\n');
  const script = resolve('scripts/setup-https.sh');
  const run = () => execFileSync('bash', [script, '192.168.0.63', '8788'], {cwd:dir, encoding:'utf8'});
  assert.ok(!run().includes('TEST_ONLY'));
  const ca = readFileSync(join(dir,'.local/tls/ca/ca.crt'),'utf8'); run();
  assert.equal(readFileSync(join(dir,'.local/tls/ca/ca.crt'),'utf8'),ca);
  const env = readFileSync(join(dir,'.env'),'utf8');
  assert.ok(env.includes('HERMES_DASHBOARD_SESSION_TOKEN=TEST_ONLY'));
  assert.equal(env.match(/^PUBLIC_ORIGIN=/gm)?.length,1);
  assert.ok(env.includes('PUBLIC_ORIGIN=https://192.168.0.63:8788'));
  assert.equal(statSync(join(dir,'.env')).mode & 0o777,0o600);
  assert.equal(statSync(join(dir,'.local/tls/server/server.key')).mode & 0o777,0o600);
  const cert = join(dir,'.local/tls/server/server.crt');
  execFileSync('openssl',['verify','-CAfile',join(dir,'.local/tls/ca/ca.crt'),'-verify_ip','192.168.0.63',cert]);
  execFileSync('openssl',['verify','-CAfile',join(dir,'.local/tls/ca/ca.crt'),'-verify_ip','127.0.0.1',cert]);
  assert.throws(() => execFileSync('bash',[script,'evil.com/path','8788'],{cwd:dir,stdio:'ignore'}));
});

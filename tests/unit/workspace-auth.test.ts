import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { loadConfig } from '../../server/config.js';
import { authoriseWorkspace } from '../../server/workspace/auth.js';

test('native auth refresh cookies retain scope and Secure attributes without a BFF cookie store', async t => {
  const refreshed = 'hermes_session_at=REFRESHED_FIXTURE; Path=/__hermes/; HttpOnly; Secure; SameSite=Lax';
  const upstream = createServer((req, res) => {
    assert.equal(req.headers['x-forwarded-prefix'], '/__hermes');
    assert.equal(req.headers['x-forwarded-proto'], 'https');
    assert.equal(req.headers['x-forwarded-host'], 'example.test');
    assert.equal(req.headers.cookie, 'hermes_session_at=OLD_FIXTURE');
    assert.equal(req.headers.authorization, undefined);
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/status') res.end(JSON.stringify({ auth_required: true }));
    else { res.setHeader('Set-Cookie', refreshed); res.end(JSON.stringify({ user_id: 'fixture', provider: 'basic' })); }
  });
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => upstream.close(() => resolve())));
  const address = upstream.address(); assert.ok(address && typeof address !== 'string');
  const config = loadConfig({ HERMES_DASHBOARD_URL: `http://127.0.0.1:${address.port}`, PUBLIC_ORIGIN: 'https://example.test' });
  const request = { headers: { cookie: 'hermes_session_at=OLD_FIXTURE', authorization: 'IGNORED_BROWSER_BEARER', 'x-user': 'not-trusted' } };
  assert.deepEqual(await authoriseWorkspace(request, config), [refreshed]);
});

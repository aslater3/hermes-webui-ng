import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TestCookieJar } from '../helpers/cookie-jar.js';

test('Hermes all-variant logout deletions cannot shadow a subsequent bare login cookie', () => {
  const jar = new TestCookieJar('http://localhost:8787');
  const url = 'http://localhost:8787/__hermes/auth/password-login';
  jar.receive('hermes_session=old; Path=/__hermes; HttpOnly', url);
  for (const [name, path, secure] of [
    ['__Host-hermes_session', '/', '; Secure'],
    ['__Secure-hermes_session', '/__hermes', '; Secure'],
    ['hermes_session', '/__hermes', ''],
  ]) jar.receive(`${name}=""; Max-Age=0; Path=${path}${secure}`, url);
  assert.equal(jar.header(url), '');
  jar.receive('hermes_session=new; Path=/__hermes; HttpOnly', url);
  assert.equal(jar.header(url), 'hermes_session=new');
  assert.equal(jar.header('http://localhost:8787/api/webui/capabilities'), '');
});

test('test cookies honour path boundaries, expiry and secure transport without serialising a jar', () => {
  let now = 1000;
  const jar = new TestCookieJar('https://chat.example', () => now);
  const url = 'https://chat.example/__hermes/auth/password-login';
  jar.receive('__Secure-session=value; Secure; Path=/__hermes; Max-Age=1', url);
  assert.equal(jar.header('https://chat.example/__hermes/api/auth/me'), '__Secure-session=value');
  assert.equal(jar.header('https://chat.example/__hermes-other/api'), '');
  jar.receive('__Host-invalid=value; Secure; Path=/__hermes', url);
  assert.equal(jar.header(url), '__Secure-session=value');
  now = 2001;
  assert.equal(jar.header(url), '');
  jar.receive('expired=value; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT', url);
  assert.equal(jar.header(url), '');
  assert.throws(() => jar.header('https://other.example/'));
});

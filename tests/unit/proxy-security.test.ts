import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { IncomingMessage } from 'node:http';
import { loadConfig } from '../../server/config.js';
import { allowedRequest, endToEnd, rewriteLocation, upstreamPath } from '../../server/proxy/headers.js';

const config = loadConfig({ HERMES_DASHBOARD_URL: 'http://hermes:8080', PUBLIC_ORIGIN: 'https://chat.example' });

test('configuration rejects credentials, unsupported features and unsafe origins without echoing secrets', () => {
  assert.equal(config.port, 8787);
  for (const value of ['http://operator:private@hermes:8080', 'file:///tmp/private', 'https://example/path']) {
    assert.throws(
      () => loadConfig({ HERMES_DASHBOARD_URL: value, PUBLIC_ORIGIN: 'https://chat.example' }),
      (error: unknown) => error instanceof Error && !error.message.includes('private'),
    );
  }
  assert.throws(() =>
    loadConfig({
      HERMES_DASHBOARD_URL: 'http://hermes',
      PUBLIC_ORIGIN: 'https://chat.example',
      WORKSPACE_ROOTS: '/workspace',
    }),
  );
});

test('proxy paths reject traversal, encoded separators and protocol-relative destinations', () => {
  assert.equal(upstreamPath('/__hermes/api/auth/me'), '/api/auth/me');
  assert.equal(upstreamPath('/__hermes/api/status?x=1'), '/api/status?x=1');
  for (const path of [
    '/api/ws',
    '/__hermes//evil',
    '/__hermes/../private',
    '/__hermes/%2e%2e/private',
    '/__hermes/%2fprivate',
    '/__hermes/%252fprivate',
    '/__hermes/a\\b',
    '/__hermes/%00',
    '/__hermes/%zz',
  ]) {
    assert.equal(upstreamPath(path), undefined, path);
  }
});

test('origin and host checks fail closed for mutations and WebSocket upgrade', () => {
  const req = (method: string, headers: Record<string, string>) => ({ method, headers }) as IncomingMessage;
  assert.equal(allowedRequest(req('GET', { host: 'chat.example' }), config), true);
  assert.equal(allowedRequest(req('POST', { host: 'chat.example' }), config), false);
  assert.equal(
    allowedRequest(req('POST', { host: 'chat.example', origin: 'https://chat.example' }), config),
    true,
  );
  assert.equal(allowedRequest(req('GET', { host: 'chat.example' }), config, true), false);
  assert.equal(
    allowedRequest(req('GET', { host: 'chat.example', origin: 'https://evil.example' }), config, true),
    false,
  );
  assert.equal(
    allowedRequest(req('GET', { host: 'evil.example', 'x-forwarded-host': 'chat.example' }), config),
    false,
  );
});

test('hop-by-hop, nominated and client forwarding headers are removed; cookies are preserved', () => {
  const headers = endToEnd({
    connection: 'keep-alive, x-remove',
    'x-remove': 'value',
    'x-forwarded-for': 'forged',
    forwarded: 'forged',
    'access-control-allow-origin': '*',
    cookie: 'session=value',
    'set-cookie': ['a=1; HttpOnly', 'b=2; Secure'],
  });
  assert.equal(headers['x-remove'], undefined);
  assert.equal(headers['x-forwarded-for'], undefined);
  assert.equal(headers.forwarded, undefined);
  assert.equal(headers['access-control-allow-origin'], undefined);
  assert.equal(headers.cookie, 'session=value');
  assert.deepEqual(headers['set-cookie'], ['a=1; HttpOnly', 'b=2; Secure']);
});

test('internal redirects are prefixed once and external OAuth redirects are not rewritten', () => {
  assert.equal(rewriteLocation('/login?next=%2F', config), 'https://chat.example/__hermes/login?next=%2F');
  assert.equal(
    rewriteLocation('https://chat.example/__hermes/login', config),
    'https://chat.example/__hermes/login',
  );
  assert.equal(rewriteLocation('https://identity.example/authorize', config), 'https://identity.example/authorize');
  assert.throws(() => rewriteLocation('javascript:alert(1)', config));
});

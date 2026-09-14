import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rpcFailureKind } from '../helpers/rpc-failure-kind.js';

test('acceptance failure classification never retains raw credentials, URLs or identifiers', () => {
  const message = "Could not resolve credentials for private-provider with API key PRIVATE_TOKEN at https://private.invalid: connection timed out";
  const detail = rpcFailureKind(JSON.stringify({ jsonrpc: '2.0', id: 'PRIVATE_SESSION', error: { code: 5001, message } }));
  assert.deepEqual(detail, { code: 5001, kinds: ['credential-resolution', 'connection'] });
  assert.ok(!JSON.stringify(detail).includes('PRIVATE'));
  assert.ok(!JSON.stringify(detail).includes('private'));
});
test('acceptance classifier rejects invalid frames and keeps unknown errors redacted', () => {
  assert.equal(rpcFailureKind('PRIVATE_INVALID_JSON'), undefined);
  assert.equal(rpcFailureKind('{}'), undefined);
  assert.equal(rpcFailureKind('{"jsonrpc":"2.0","result":{"secret":"PRIVATE"}}'), undefined);
  assert.deepEqual(rpcFailureKind('{"jsonrpc":"2.0","error":{"code":5001,"message":"PRIVATE_UNCLASSIFIED"}}'), { code: 5001, kinds: ['unclassified'] });
});

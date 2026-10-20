import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scrubMcpServers, scrubberFor } from '../../server/proxy/scrub.js';

test('MCP server scrubber keeps only identity and status fields and counts tools', () => {
  const scrubbed = scrubMcpServers({ servers: [
    { name: 'a', transport: 'http', url: 'https://u:p@x.test/?token=t', command: null, args: ['--key', 'k'], env: { K: '***' }, headers: { Authorization: 'x' }, auth: 'header', enabled: true, tools: ['one', 'two', 3], source: 'config', plugin: null, extra: 'drop' },
    { name: 'b', transport: 'stdio', command: '/bin/x', args: [], enabled: false, tools: null },
  ] });
  assert.deepEqual(scrubbed, { servers: [
    { name: 'a', transport: 'http', auth: 'header', enabled: true, source: 'config', plugin: null, tool_count: 2 },
    { name: 'b', transport: 'stdio', enabled: false, tool_count: null },
  ] });
});
test('MCP server scrubber fails closed on unexpected shapes', () => {
  for (const body of [null, [], { servers: {} }, { servers: [1] }]) assert.throws(() => scrubMcpServers(body));
});
test('only GET/HEAD of the exact MCP list route is scrubbed', () => {
  assert.ok(scrubberFor('GET', '/api/mcp/servers?profile=x'));
  assert.ok(scrubberFor('HEAD', '/api/mcp/servers'));
  assert.equal(scrubberFor('POST', '/api/mcp/servers'), undefined);
  assert.equal(scrubberFor('GET', '/api/mcp/servers/github'), undefined);
  assert.equal(scrubberFor('GET', '/api/skills'), undefined);
});

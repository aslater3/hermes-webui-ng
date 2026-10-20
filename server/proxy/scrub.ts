/**
 * Server-side response scrubbers. Some upstream read routes return fields that can carry
 * credentials (an MCP server's url, command line or args). Those must never leave the host:
 * browser-side projection alone is not enough, because trusted-local has no browser login.
 * A scrubbed route forwards only an allowlisted shape, or fails closed with 502.
 */
type Scrubber = (body: unknown) => unknown;

const record = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

const MCP_SERVER_KEYS = ['name', 'transport', 'auth', 'enabled', 'source', 'plugin'] as const;

/** `GET /api/mcp/servers`: keep identity/status fields; replace the tool-name list with its count. */
export function scrubMcpServers(body: unknown): unknown {
  const servers = record(body)?.servers;
  if (!Array.isArray(servers)) throw new Error('Unexpected MCP server list');
  return {
    servers: servers.map(raw => {
      const server = record(raw);
      if (!server) throw new Error('Unexpected MCP server row');
      const kept: Record<string, unknown> = {};
      for (const key of MCP_SERVER_KEYS) if (key in server) kept[key] = server[key];
      kept.tool_count = Array.isArray(server.tools) ? server.tools.filter(tool => typeof tool === 'string').length : null;
      return kept;
    }),
  };
}

export function scrubberFor(method: string | undefined, path: string): Scrubber | undefined {
  if (method !== 'GET' && method !== 'HEAD') return undefined;
  const { pathname } = new URL(path, 'http://local');
  return pathname === '/api/mcp/servers' ? scrubMcpServers : undefined;
}

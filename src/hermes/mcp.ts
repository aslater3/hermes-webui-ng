import { ClientError, record } from './protocol.js';
import { safeText } from './safe-text.js';

/**
 * Read-only projection of Hermes `GET /api/mcp/servers` (hermes_cli/web_routers/mcp.py, web_server_mcp.py
 * `_mcp_server_summary`). Wire contract: NousResearch/hermes-agent c5a3c0f8767a72203363d249add14142dbcf3cc7.
 *
 * Dropped on purpose: `url` (may carry credentials or tokens in its query or userinfo), `command`, `args`
 * (paths and secrets), `env` (even though upstream masks values, names and shapes stay out of the browser),
 * the tool name list (only its count is shown), and anything OAuth-related. This slice never calls
 * `POST .../test`, `/auth`, `/catalog` or any write route.
 *
 * Upstream reports no connection status, tool-count-by-live-probe or last error on this route, so none are
 * fabricated here. The UI says so explicitly.
 */
export const MCP_SERVER_LIMIT = 256;
export type McpTransport = 'http' | 'stdio' | 'unknown';
export interface McpServer {
  name: string;
  transport: McpTransport;
  enabled: boolean;
  /** Human label for the authentication mode, or empty when Hermes names none the UI recognises. */
  auth: string;
  /** Number of tools selected in Hermes config. Undefined means Hermes exposes all tools (no list). */
  toolCount?: number;
  /** Plugin name when the server comes from a plugin; empty for config-defined servers. */
  plugin: string;
}

const TRANSPORTS: readonly McpTransport[] = ['http', 'stdio'];
const AUTH: Record<string, string> = { oauth: 'OAuth', header: 'Header token' };

function name(value: unknown): string {
  const result = safeText(value, 128);
  if (!result.trim()) throw new ClientError('protocol', 'Hermes MCP server omitted a name');
  return result;
}

export function mcpServerList(input: unknown): McpServer[] {
  const data = record(input);
  if (!Array.isArray(data.servers) || data.servers.length > MCP_SERVER_LIMIT)
    throw new ClientError('protocol', 'Invalid Hermes MCP server list');
  return data.servers.map((item: unknown) => {
    const row = record(item);
    const transport = TRANSPORTS.find(value => value === row.transport) ?? 'unknown';
    const auth = typeof row.auth === 'string' ? AUTH[row.auth.toLowerCase()] ?? '' : '';
    const tools = row.tools;
    return {
      name: name(row.name),
      transport,
      enabled: row.enabled !== false,
      auth,
      toolCount: Array.isArray(tools) ? tools.filter(tool => typeof tool === 'string').length : undefined,
      plugin: safeText(row.plugin, 128),
    };
  });
}

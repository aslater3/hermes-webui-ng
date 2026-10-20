import { ClientError, record } from './protocol.js';
import { safeText } from './safe-text.js';

/**
 * Read-only projection of Hermes `GET /api/memory` (hermes_cli/web_routers/ops.py). Wire contract:
 * NousResearch/hermes-agent c5a3c0f8767a72203363d249add14142dbcf3cc7. Only the fields below reach the UI.
 * The upstream provider `setup` block (required env names, dependency state) and any `env`/`config`
 * material are dropped. Provider configuration (`/api/memory/providers/{name}/config`) is never fetched.
 */
export const MEMORY_PROVIDER_LIMIT = 64;
const STATUSES = ['ready', 'needs_config', 'unavailable', 'missing'] as const;
export interface MemoryProvider { name: string; description: string; available: boolean; configured: boolean; status: string }
export interface MemoryStatus {
  /** Active external provider name, or an empty string for built-in memory only. */
  active: string;
  providers: MemoryProvider[];
  /** Byte sizes of the built-in MEMORY.md and USER.md files. Contents are not exposed. */
  builtinFiles: { memory: number; user: number };
}

function bytes(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

export function memoryStatus(input: unknown): MemoryStatus {
  const data = record(input);
  if (!Array.isArray(data.providers) || data.providers.length > MEMORY_PROVIDER_LIMIT)
    throw new ClientError('protocol', 'Invalid Hermes memory status');
  const files = record(data.builtin_files);
  return {
    active: safeText(data.active, 128),
    providers: data.providers.map((item: unknown) => {
      const row = record(item);
      const name = safeText(row.name, 128);
      if (!name.trim()) throw new ClientError('protocol', 'Hermes memory provider omitted a name');
      const status = typeof row.status === 'string' && (STATUSES as readonly string[]).includes(row.status) ? row.status : 'unknown';
      return {
        name,
        description: safeText(row.description, 512),
        available: row.available === true,
        configured: row.configured === true,
        status,
      };
    }),
    builtinFiles: { memory: bytes(files.memory), user: bytes(files.user) },
  };
}

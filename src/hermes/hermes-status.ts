import { ClientError, record } from './protocol.js';
import { safeText } from './safe-text.js';

/**
 * Read-only projections for the Diagnostics tab: `GET /api/status` (hermes_cli/web_routers/status.py),
 * `GET /api/health` and `GET /api/system/stats`. Wire contract: NousResearch/hermes-agent
 * c5a3c0f8767a72203363d249add14142dbcf3cc7.
 *
 * Dropped on purpose: `hermes_home`, `config_path`, `env_path`, `gateway_pid`, `gateway_health_url`,
 * `gateways` (ports and internal URLs), `install_id`, `profiles`, `gateway_platforms`, `nous_session_valid`,
 * `commit`, `hostname`, `python_*`, the process block (pid, rss), `disk.total/used`, and the platform label.
 * Only counts, states and version strings reach the UI.
 */
export interface HermesStatus {
  version: string;
  releaseDate: string;
  gatewayRunning?: boolean;
  gatewayState: string;
  activeAgents: number;
  activeSessions: number;
  overall: 'ok' | 'degraded' | 'unknown';
  /** Heartbeat age in seconds when Hermes reports a stale housekeeping stamp, else undefined. */
  heartbeatStaleSeconds?: number;
}
export interface HermesHealth { ok: boolean; version: string; displayVersion: string }
export interface SystemStats {
  os: string;
  osRelease: string;
  arch: string;
  cpuCount?: number;
  cpuPercent?: number;
  loadAverage?: number[];
  uptimeSeconds?: number;
  memory?: { total: number; used: number; percent: number };
  disk?: { percent: number };
}

const SHORT = 64;
function count(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}
function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}
function version(value: unknown): string {
  return typeof value === 'string' && /^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.]+)?$/.test(value) ? value : '';
}

export function hermesStatus(input: unknown): HermesStatus {
  const data = record(input);
  if (typeof data.auth_required !== 'boolean') throw new ClientError('protocol', 'Malformed Hermes status');
  const overall = data.overall === 'ok' || data.overall === 'degraded' ? data.overall : 'unknown';
  const stale = finite(data.gateway_heartbeat_stale_s);
  return {
    version: version(data.version),
    releaseDate: safeText(data.release_date, SHORT),
    gatewayRunning: typeof data.gateway_running === 'boolean' ? data.gateway_running : undefined,
    gatewayState: safeText(data.gateway_state, SHORT),
    activeAgents: count(data.active_agents),
    activeSessions: count(data.active_sessions),
    overall,
    heartbeatStaleSeconds: stale,
  };
}

export function hermesHealth(input: unknown): HermesHealth {
  const data = record(input);
  if (data.ok !== true) throw new ClientError('protocol', 'Hermes health check did not report ok');
  return { ok: true, version: version(data.version), displayVersion: safeText(data.displayVersion, SHORT) };
}

export function systemStats(input: unknown): SystemStats {
  const data = record(input);
  const memory = record(data.memory);
  const disk = record(data.disk);
  const load = Array.isArray(data.load_avg) ? data.load_avg.map(finite).filter((item): item is number => item !== undefined).slice(0, 3) : undefined;
  const memTotal = finite(memory.total), memUsed = finite(memory.used), memPercent = finite(memory.percent);
  return {
    os: safeText(data.os, SHORT),
    osRelease: safeText(data.os_release, SHORT),
    arch: safeText(data.arch, SHORT),
    cpuCount: finite(data.cpu_count),
    cpuPercent: finite(data.cpu_percent),
    loadAverage: load?.length ? load : undefined,
    uptimeSeconds: finite(data.uptime_seconds),
    memory: memTotal !== undefined && memUsed !== undefined && memPercent !== undefined
      ? { total: memTotal, used: memUsed, percent: memPercent } : undefined,
    disk: finite(disk.percent) !== undefined ? { percent: finite(disk.percent)! } : undefined,
  };
}

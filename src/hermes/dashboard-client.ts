import { ClientError, record, textField } from './protocol.js';
import { WsAuthClient } from './ws-auth.js';
import { skillList, skillDocument, skillName, type SkillDocument, type SkillRow } from './skills.js';
import { memoryStatus, type MemoryStatus } from './memory.js';
import { cronJob, cronJobId, cronJobList, cronRunPage, CRON_ACTIONS, type CronActionKind, type CronJob, type CronRun } from './cron.js';
import { sessionQuery, sessionPage, searchPage, historyPage, firstMessage, sessionId, profileName, HISTORY_LIMIT, type SessionQuery, type SessionRef } from './session-rest.js';
import type { DiagnosticsRing } from './diagnostics.js';
import { mcpServerList, type McpServer } from './mcp.js';
import { hermesStatus, hermesHealth, systemStats, type HermesStatus, type HermesHealth, type SystemStats } from './hermes-status.js';
export { WS_PROTOCOL, type WsCredential } from './ws-auth.js';
export interface Identity { user_id: string; provider: string }
export interface Provider { name: string; display_name: string; supports_password: boolean }
export class HttpError extends ClientError {
  constructor(readonly status: number, readonly expired = false) {
    super(status === 401 ? 'auth-required' : status === 403 ? 'forbidden' :
      status >= 500 ? 'network' : 'protocol', `Hermes Dashboard returned HTTP ${status}`);
  }
}
const ROUTES = {
  access: '/api/webui/access',
  status: '/__hermes/api/status', providers: '/__hermes/api/auth/providers',
  identity: '/__hermes/api/auth/me', ticket: '/__hermes/api/auth/ws-ticket',
  login: '/__hermes/auth/password-login', logout: '/__hermes/auth/logout',
  schema: '/__hermes/openapi.json', capabilities: '/api/webui/capabilities',
  sessions: '/__hermes/api/sessions', sessionSearch: '/__hermes/api/sessions/search', sessionHistory: '/__hermes/api/sessions',
  audioTranscribe: '/__hermes/api/audio/transcribe', audioSpeak: '/__hermes/api/audio/speak', audioVoice: '/__hermes/api/audio/voice-config',
  skills: '/__hermes/api/skills', skillContent: '/__hermes/api/skills/content',
  memory: '/__hermes/api/memory',
  mcpServers: '/__hermes/api/mcp/servers', health: '/__hermes/api/health', systemStats: '/__hermes/api/system/stats',
  cronJobs: '/__hermes/api/cron/jobs', cronJob: '/__hermes/api/cron/jobs', cronRuns: '/__hermes/api/cron/jobs', cronAction: '/__hermes/api/cron/jobs',
} as const;
type Route = keyof typeof ROUTES;

/** Bounded reads protect clients even when content-length is absent or dishonest. */
export async function boundedJson(response: Response, maxBytes = 4_194_304): Promise<Record<string, unknown>> {
  return record(await boundedValue(response, maxBytes));
}

/** Bounded JSON of any shape (object or array). Callers must validate the shape they accept. */
export async function boundedValue(response: Response, maxBytes = 4_194_304): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new ClientError('protocol', 'Empty response');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.length;
      if (size > maxBytes) throw new ClientError('protocol', 'Response exceeds the configured limit');
      chunks.push(next.value);
    }
    const bytes = new Uint8Array(size);
    let at = 0;
    for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) {
    if (error instanceof ClientError) throw error;
    throw new ClientError('protocol', 'Hermes Dashboard returned invalid JSON');
  } finally { await reader.cancel().catch(() => {}); }
}

function voiceSuffix(profile: string | undefined): string {
  const name = profileName(profile);
  return name ? `?${new URLSearchParams({ profile: name })}` : '';
}

/** Hermes alone owns auth cookies; neither credentials nor raw responses are persisted. */
export class DashboardClient {
  readonly origin: string;
  admissionMode: 'dashboard' | 'trusted-local' = 'dashboard';
  constructor(origin: string, private readonly fetcher: typeof fetch = fetch,
    private readonly timeoutMs = 15_000, private readonly diagnostics?: DiagnosticsRing) {
    const url = new URL(origin);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      url.pathname !== '/' || url.search || url.hash)
      throw new ClientError('protocol', 'Expected the public WebUI origin');
    this.origin = url.origin;
  }
  private async response(route: Route, method = 'GET', body?: unknown, signal?: AbortSignal,
    redirect: RequestRedirect = 'error', suffix = ''): Promise<Response> {
    const deadline = AbortSignal.timeout(this.timeoutMs);
    const started = Date.now();
    this.diagnostics?.add({ event: 'rest.request', route });
    try {
      const response = await this.fetcher.call(globalThis, this.origin + ROUTES[route] + suffix, {
        method, credentials: ['capabilities', 'access'].includes(route) ? 'omit' : 'include', cache: 'no-store', redirect,
        headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
      });
      if (signal?.aborted) { await response.body?.cancel(); throw new ClientError('disconnected', 'Request superseded'); }
      this.diagnostics?.add({ event: 'rest.response', route, status: response.status, durationMs: Date.now() - started });
      return response;
    } catch (error) {
      const kind = signal?.aborted ? 'disconnected' : deadline.aborted ? 'timeout' : 'network';
      this.diagnostics?.add({ event: 'rest.failed', route, kind });
      if (error instanceof ClientError) throw error;
      throw new ClientError(kind, kind === 'disconnected' ? 'Request superseded' : 'Hermes Dashboard request failed');
    }
  }
  private async request(route: Route, method = 'GET', body?: unknown, signal?: AbortSignal, suffix = '') {
    return record(await this.requestValue(route, method, body, signal, suffix));
  }
  private async requestValue(route: Route, method = 'GET', body?: unknown, signal?: AbortSignal, suffix = '') {
    const response = await this.response(route, method, body, signal, 'error', suffix);
    if (!response.ok) {
      const detail = await boundedJson(response, 8192).catch(() => ({}));
      throw new HttpError(response.status, 'error' in detail && detail.error === 'session_expired');
    }
    const data = await boundedValue(response);
    if (signal?.aborted) throw new ClientError('disconnected', 'Request superseded');
    return data;
  }
  async status(signal?: AbortSignal): Promise<Record<string, unknown>> {
    const data = await this.request('status', 'GET', undefined, signal);
    if (typeof data.auth_required !== 'boolean') throw new ClientError('protocol', 'Malformed Hermes authentication status');
    if (!data.auth_required) {
      await this.requireLocalBridge(signal);
      this.admissionMode = 'trusted-local';
    } else this.admissionMode = 'dashboard';
    return { auth_required: data.auth_required, version: typeof data.version === 'string' &&
      /^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.]+)?$/.test(data.version) ? data.version : null };
  }
  private async requireLocalBridge(signal?: AbortSignal): Promise<void> {
    const access = await this.request('access', 'GET', undefined, signal);
    if (access.mode !== 'trusted-local' || access.authenticated !== false || access.ready !== true)
      throw new ClientError('protocol', 'An authenticated Dashboard or explicitly configured trusted-local bridge is required');
  }
  async verifyLocalAccess(signal?: AbortSignal): Promise<void> {
    if (this.admissionMode !== 'trusted-local') throw new ClientError('protocol', 'Local access has not been configured');
    await this.requireLocalBridge(signal);
  }
  private dashboardOnly(): void {
    if (this.admissionMode === 'trusted-local') throw new ClientError('protocol', 'Trusted-local access has no browser login identity or ticket');
  }
  async providers(signal?: AbortSignal): Promise<Provider[]> {
    if (this.admissionMode === 'trusted-local') return [];
    const data = await this.request('providers', 'GET', undefined, signal);
    if (!Array.isArray(data.providers) || data.providers.length > 64)
      throw new ClientError('protocol', 'Invalid auth provider list');
    return data.providers.map((item: unknown) => {
      const row = record(item);
      return { name: textField(row, 'name').slice(0, 256),
        display_name: textField(row, 'display_name').slice(0, 256), supports_password: row.supports_password === true };
    });
  }
  async me(signal?: AbortSignal): Promise<Identity> {
    this.dashboardOnly();
    const data = await this.request('identity', 'GET', undefined, signal);
    return { user_id: textField(data, 'user_id'), provider: textField(data, 'provider') };
  }
  async login(provider: string, username: string, password: string, signal?: AbortSignal): Promise<Identity> {
    this.dashboardOnly();
    const data = await this.request('login', 'POST', { provider, username, password }, signal);
    if (data.ok !== true) throw new ClientError('auth-required', 'Sign-in was not accepted');
    const identity = await this.me(signal);
    this.diagnostics?.add({ event: 'auth.login' });
    return identity;
  }
  async logout(signal?: AbortSignal): Promise<void> {
    this.dashboardOnly();
    const response = await this.response('logout', 'POST', undefined, signal, 'manual');
    await response.body?.cancel();
    if (response.type !== 'opaqueredirect' && response.status !== 302 && !response.ok)
      throw new HttpError(response.status);
    try { await this.me(signal); } catch (error) {
      if (error instanceof ClientError && error.kind === 'auth-required') {
        this.diagnostics?.add({ event: 'auth.logout' }); return;
      }
      throw error;
    }
    throw new ClientError('protocol', 'Hermes sign-out could not be verified');
  }
  async ticket(signal?: AbortSignal): Promise<{ ticket: string; ttl_seconds: number }> {
    this.dashboardOnly();
    const data = await this.request('ticket', 'POST', undefined, signal);
    if (typeof data.ttl_seconds !== 'number') throw new ClientError('protocol', 'Invalid ticket lifetime');
    this.diagnostics?.add({ event: 'auth.ticket' });
    return { ticket: textField(data, 'ticket'), ttl_seconds: data.ttl_seconds };
  }
  credential(signal?: AbortSignal) { return new WsAuthClient(this).credential(signal); }
  schema(signal?: AbortSignal) { return this.request('schema', 'GET', undefined, signal); }
  capabilities(signal?: AbortSignal) { return this.request('capabilities', 'GET', undefined, signal); }
  async sessions(options: SessionQuery = {}, signal?: AbortSignal) {
    const query = sessionQuery(options);
    const page = sessionPage(await this.request('sessions', 'GET', undefined, signal, `?${query}`), options.profile);
    if (page.offset !== (options.offset ?? 0) || page.limit !== (options.limit ?? 20))
      throw new ClientError('protocol', 'Unexpected Hermes session pagination');
    return page;
  }
  async searchSessions(text: string, profile?: string, signal?: AbortSignal) {
    if (!text.trim() || text.length > 512) throw new ClientError('protocol', 'Search must contain 1–512 characters');
    const query = new URLSearchParams({ q: text.trim(), limit: '50' });
    if (profileName(profile)) query.set('profile', profile!);
    return searchPage(await this.request('sessionSearch', 'GET', undefined, signal, `?${query}`), profile);
  }
  async sessionMessages(ref: SessionRef, offset = 0, signal?: AbortSignal) {
    sessionQuery({ offset });
    const query = new URLSearchParams({ limit: String(HISTORY_LIMIT), offset: String(offset), order: 'latest' });
    if (profileName(ref.profile)) query.set('profile', profileName(ref.profile)!);
    const suffix = `/${encodeURIComponent(sessionId(ref.id))}/messages?${query}`;
    return historyPage(await this.request('sessionHistory', 'GET', undefined, signal, suffix), ref, offset);
  }
  /** Dictation: one recorded clip goes to the host's configured STT provider. Provider keys never reach the browser. */
  async transcribe(dataUrl: string, mimeType: string, profile: string | undefined, signal?: AbortSignal): Promise<string> {
    const data = await this.request('audioTranscribe', 'POST', { data_url: dataUrl, mime_type: mimeType }, signal, voiceSuffix(profile));
    if (data.ok !== true || typeof data.transcript !== 'string') throw new ClientError('protocol', 'Hermes returned an invalid transcript');
    return data.transcript;
  }
  /** Read aloud: the host's TTS chain synthesizes the text. Returns a base64 audio data URL. */
  async speak(text: string, profile: string | undefined, signal?: AbortSignal): Promise<{ dataUrl: string; mimeType: string }> {
    const data = await this.request('audioSpeak', 'POST', { text }, signal, voiceSuffix(profile));
    if (data.ok !== true || typeof data.data_url !== 'string' || !data.data_url.startsWith('data:audio/'))
      throw new ClientError('protocol', 'Hermes returned invalid speech');
    return { dataUrl: data.data_url, mimeType: typeof data.mime_type === 'string' ? data.mime_type : 'audio/mpeg' };
  }
  /** Availability probe only. The response's provider and key fields are deliberately not read or kept. */
  async voiceAvailable(profile: string | undefined, signal?: AbortSignal): Promise<boolean> {
    return (await this.request('audioVoice', 'GET', undefined, signal, voiceSuffix(profile))).ok === true;
  }
  /** Read-only profile-scoped skill catalogue. Mutations are deliberately absent from this client. */
  async skills(profile?: string, signal?: AbortSignal): Promise<SkillRow[]> {
    const query = new URLSearchParams();
    if (profileName(profile)) query.set('profile', profile!);
    return skillList(await this.requestValue('skills', 'GET', undefined, signal, query.size ? `?${query}` : ''));
  }
  /** Raw SKILL.md text for read-only display. The server-side path is never returned to callers. */
  async skillContent(name: string, profile?: string, signal?: AbortSignal): Promise<SkillDocument> {
    const query = new URLSearchParams({ name: skillName(name) });
    if (profileName(profile)) query.set('profile', profile!);
    return skillDocument(await this.request('skillContent', 'GET', undefined, signal, `?${query}`), name);
  }
  /** Read-only memory status. Provider config and setup/reset/provider-switch routes are deliberately not in this client. */
  async memory(profile?: string, signal?: AbortSignal): Promise<MemoryStatus> {
    const query = new URLSearchParams();
    if (profileName(profile)) query.set('profile', profile!);
    return memoryStatus(await this.request('memory', 'GET', undefined, signal, query.size ? `?${query}` : ''));
  }
  /** Read-only MCP server list. Only `GET /api/mcp/servers` is used: no test, auth, catalog or install route. */
  async mcpServers(profile?: string, signal?: AbortSignal): Promise<McpServer[]> {
    const query = new URLSearchParams();
    if (profileName(profile)) query.set('profile', profile!);
    return mcpServerList(await this.request('mcpServers', 'GET', undefined, signal, query.size ? `?${query}` : ''));
  }
  /** Diagnostics reads. `/api/status` is the existing public probe; its paths, ports and PIDs are dropped by the projection. */
  async hermesStatus(profile?: string, signal?: AbortSignal): Promise<HermesStatus> {
    const query = new URLSearchParams();
    if (profileName(profile)) query.set('profile', profile!);
    return hermesStatus(await this.request('status', 'GET', undefined, signal, query.size ? `?${query}` : ''));
  }
  async hermesHealth(signal?: AbortSignal): Promise<HermesHealth> {
    return hermesHealth(await this.request('health', 'GET', undefined, signal));
  }
  async systemStats(signal?: AbortSignal): Promise<SystemStats> {
    return systemStats(await this.request('systemStats', 'GET', undefined, signal));
  }
  /** Cron jobs are always read for one explicit profile: the upstream default `profile=all` would cross profile boundaries. */
  private cronQuery(profile?: string): string {
    return `?${new URLSearchParams({ profile: profileName(profile) ?? 'default' })}`;
  }
  async cronJobs(profile?: string, signal?: AbortSignal): Promise<CronJob[]> {
    return cronJobList(await this.requestValue('cronJobs', 'GET', undefined, signal, this.cronQuery(profile)));
  }
  async cronJob(id: string, profile?: string, signal?: AbortSignal): Promise<CronJob> {
    return cronJob(await this.request('cronJob', 'GET', undefined, signal, `/${encodeURIComponent(cronJobId(id))}${this.cronQuery(profile)}`));
  }
  async cronRuns(id: string, profile?: string, limit = 20, signal?: AbortSignal): Promise<CronRun[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new ClientError('protocol', 'Run limit must be 1–100');
    const query = new URLSearchParams({ profile: profileName(profile) ?? 'default', limit: String(limit) });
    return cronRunPage(await this.request('cronRuns', 'GET', undefined, signal, `/${encodeURIComponent(cronJobId(id))}/runs?${query}`));
  }
  /**
   * The only cron write in the client: pause, resume or run-now for one job. Gated mode only; trusted-local
   * never reaches this (the local allowlist is GET-only and the capability is hidden). Callers must not retry
   * automatically: an error after the request was sent has an unknown outcome.
   */
  async cronAction(kind: CronActionKind, id: string, profile?: string, signal?: AbortSignal): Promise<CronJob> {
    if (!(CRON_ACTIONS as readonly string[]).includes(kind)) throw new ClientError('protocol', 'Unsupported cron action');
    if (this.admissionMode === 'trusted-local') throw new ClientError('protocol', 'Cron actions are available when signed in through the Hermes Dashboard');
    return cronJob(await this.request('cronAction', 'POST', {}, signal, `/${encodeURIComponent(cronJobId(id))}/${kind}${this.cronQuery(profile)}`));
  }
  async sessionFirstMessage(ref: SessionRef, signal?: AbortSignal) {
    const query = new URLSearchParams({ limit: '1', offset: '0', order: 'oldest' });
    if (profileName(ref.profile)) query.set('profile', profileName(ref.profile)!);
    const suffix = `/${encodeURIComponent(sessionId(ref.id))}/messages?${query}`;
    return firstMessage(await this.request('sessionHistory', 'GET', undefined, signal, suffix));
  }
}

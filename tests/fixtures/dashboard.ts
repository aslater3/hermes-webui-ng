/** SYNTHETIC contract fixture. This is not vanilla-Hermes compatibility evidence. */
import { createServer } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';
import { ModelScenarios } from './model-scenarios.js';
import { AgentScenarios } from './agent-scenarios.js';
import { WS_PROTOCOL } from '../../src/hermes/dashboard-client.js';

const fixtureSkills = [
  { name: 'arxiv', description: 'Search and summarise arXiv preprints.', category: 'research', enabled: true, usage: 3, provenance: 'hub' },
  { name: 'axolotl', description: 'Fine-tune language models with Axolotl.', category: 'mlops', enabled: true, usage: 0, provenance: 'bundled' },
  { name: 'local-notes', description: 'Hand-written notes helper.', category: 'productivity', enabled: false, usage: 1, provenance: 'agent' },
];
// Memory and cron shapes mirror hermes_cli/web_routers/ops.py and cron.py. Secret-looking fields are seeded on purpose
// so the projection tests can prove they are dropped (provider env/setup, job prompt/base_url, error text).
const NOW = 1760950800;
function fixtureMemory(profile: string) {
  if (profile !== 'default') return { active: '', providers: [], builtin_files: { memory: 0, user: 0 } };
  return { active: 'honcho', builtin_files: { memory: 2048, user: 311 }, providers: [
    { name: 'honcho', description: 'Honcho long-term user model', available: true, configured: true, status: 'ready',
      env: { HONCHO_API_KEY: 'FIXTURE_PROVIDER_SECRET_VALUE' },
      setup: { pip_dependencies: ['honcho-ai'], required_env: ['HONCHO_API_KEY'], dependencies_installed: true } },
    { name: 'mem0', description: 'Mem0 hosted memory', available: true, configured: false, status: 'needs_config', setup: { required_env: ['MEM0_API_KEY'] } },
  ] };
}
function fixtureCronJobs(): Record<string, unknown>[] {
  return [
    { id: 'a1b2c3d4e5f6', name: 'morning-digest', prompt: 'Summarise overnight mail', base_url: 'https://user:FIXTURE_URL_PASSWORD@example.test/hook',
      workdir: '/srv/hermes/profiles/default/work', deliver: 'local', profile_name: 'default', is_default_profile: true,
      schedule_display: '0 8 * * *', enabled: true, state: 'scheduled', next_run_at: '2026-10-21T08:00:00+00:00', last_run_at: NOW - 3600,
      last_status: 'ok', last_error: null, last_failure: null, failure_streak: 0, no_agent: false, repeat: { times: null, completed: 14 } },
    { id: '0f1e2d3c4b5a', name: 'backup-check', prompt: null, script: '/srv/hermes/scripts/backup.sh', deliver: 'local', profile_name: 'default', is_default_profile: true,
      schedule_display: 'every 6h', enabled: true, state: 'scheduled', next_run_at: '2026-10-20T18:00:00+00:00', last_run_at: NOW - 7200,
      last_status: 'error', last_error: 'Delivery failed: api_key=FIXTURE_JOB_KEY_VALUE', last_failure: { at: NOW - 7200, detail: 'Delivery failed: api_key=FIXTURE_JOB_KEY_VALUE' },
      failure_streak: 3, no_agent: true, repeat: { times: null, completed: 9 } },
    { id: '9a8b7c6d5e4f', name: 'weekly-report', prompt: 'Weekly summary', deliver: 'local', profile_name: 'default', is_default_profile: true,
      schedule_display: '0 9 * * 1', enabled: false, state: 'paused', paused_reason: 'Paused by operator', next_run_at: null, last_run_at: null,
      last_status: null, last_error: null, last_failure: null, failure_streak: 0, no_agent: false, repeat: { times: 4, completed: 1 } },
  ];
}
function fixtureCronRuns(id: string): Record<string, unknown>[] {
  if (id === 'a1b2c3d4e5f6') return [
    { id: 'run-digest-2', title: 'COMPLETED · Morning digest', preview: 'Three messages need a reply.', started_at: NOW - 3600, last_active: NOW - 3570, ended_at: NOW - 3570, is_active: false, source: 'cron', message_count: 4, model: 'fixture-model', input_tokens: 1200, output_tokens: 300 },
    { id: 'run-digest-1', title: 'COMPLETED · Morning digest', preview: null, started_at: NOW - 90000, last_active: NOW - 89950, ended_at: NOW - 89950, is_active: false, source: 'cron_output', message_count: 0 },
  ];
  if (id === '0f1e2d3c4b5a') return [
    { id: 'cron_output:0f1e2d3c4b5a:2026-10-20_12-00-00', title: 'FAILED · Delivery failed', preview: 'Exit status 2. Authorization: Bearer FIXTURE_BEARER_VALUE', started_at: NOW - 7200, last_active: NOW - 7190, ended_at: NOW - 7190, is_active: false, source: 'cron_output', message_count: 0 },
  ];
  return [];
}
function fixtureCronJobFor(profile: string) { return profile === 'default' ? fixtureCronJobs() : profile === 'work' ? [{ id: 'work-sync-01', name: 'work-sync', schedule_display: 'every 1h', enabled: true, state: 'scheduled', next_run_at: '2026-10-20T19:00:00+00:00', last_run_at: null, last_status: null, last_error: null, failure_streak: 0, no_agent: true, repeat: { times: null, completed: 0 }, profile_name: 'work', is_default_profile: false }] : []; }

// MCP and diagnostics shapes mirror hermes_cli/web_server_mcp.py (`_mcp_server_summary`), web_routers/status.py and
// system stats. Secret-bearing fields are seeded on purpose: URL userinfo and token query, command/args, env keys and an
// Authorization header, host paths, PIDs, ports and hostnames. Projection tests and the browser DOM must never show them.
function fixtureMcpServers(profile: string) {
  if (profile !== 'default') return { servers: [{ name: 'work-docs', transport: 'stdio', command: '/srv/hermes/profiles/work/bin/docs-mcp', args: ['--token', 'FIXTURE_MCP_ARG_SECRET'], env: { DOCS_API_KEY: 'FIXTURE_MCP_ENV_SECRET' }, auth: null, enabled: true, tools: null, source: 'config', plugin: null }] };
  return { servers: [
    { name: 'github', transport: 'http', url: 'https://user:FIXTURE_MCP_URL_PASSWORD@mcp.example.test/v1?access_token=FIXTURE_MCP_QUERY_TOKEN', command: null, args: [], env: {}, headers: { Authorization: 'Bearer FIXTURE_MCP_HEADER_SECRET' }, auth: 'header', enabled: true, tools: ['search_code', 'get_issue'], source: 'config', plugin: null },
    { name: 'filesystem', transport: 'stdio', url: null, command: '/usr/bin/npx', args: ['-y', '@example/fs', '/home/fixture/private'], env: { FS_TOKEN: 'FIXTURE_MCP_ENV_SECRET_2' }, auth: null, enabled: false, tools: null, source: 'config', plugin: null },
    { name: 'oauth-calendar', transport: 'http', url: 'https://calendar.example.test/mcp', command: null, args: [], env: {}, auth: 'oauth', enabled: true, tools: ['list_events'], oauth_tokens: { access_token: 'FIXTURE_MCP_OAUTH_TOKEN' }, source: 'plugin', plugin: 'calendar-plugin' },
  ] };
}
function fixtureHermesStatus(profile: string) {
  return { auth_required: false, version: '0.13.2', release_date: '2026-10-15', config_version: 1, latest_config_version: 1,
    gateway_running: true, gateway_state: 'running', gateway_platforms: { telegram: { state: 'connected' } }, gateway_pid: 48211,
    gateway_updated_at: NOW - 12, gateway_heartbeat_stale_s: null, active_agents: 1, active_sessions: 2, gateway_busy: true,
    overall: 'ok', components: { gateway: { status: 'ok' } }, profiles: [{ name: profile }],
    hermes_home: '/srv/hermes/home', config_path: '/srv/hermes/home/config.yaml', env_path: '/srv/hermes/home/.env',
    gateway_health_url: 'http://127.0.0.1:9119/health', gateways: [{ port: 9119, host: 'fixture-host.internal' }], install_id: 'FIXTURE_INSTALL_ID' };
}
const fixtureHealth = { ok: true, version: '0.13.2', displayVersion: '0.13.2 (fixture)', commit: 'deadbeefcafe', auth_required: true };
const fixtureSystemStats = { os: 'Linux', os_release: '6.8.0-fixture', os_version: '#1 SMP fixture', platform: 'Linux-6.8.0-fixture-x86_64', arch: 'x86_64',
  hostname: 'fixture-host.internal', python_version: '3.12.4', python_impl: 'CPython', hermes_version: '0.13.2', cpu_count: 8, cpu_percent: 12.5, load_avg: [0.42, 0.37, 0.30],
  uptime_seconds: 302400, memory: { total: 17179869184, available: 8589934592, used: 8589934592, percent: 50 }, disk: { total: 500000000000, used: 150000000000, free: 350000000000, percent: 30 },
  process: { pid: 48211, rss: 104857600, create_time: NOW - 300, num_threads: 12 }, psutil: true };

function skillMarkdown(name: string): string {
  return `---\nname: ${name}\ndescription: Fixture skill ${name}\n---\n\n# ${name}\n\nUse this skill for **${name}** tasks.\n\n- Step one\n- Step two\n`;
}

export async function startFixture(port = 0, options: { sessionToken?: string; beforeWsTicket?: () => Promise<void>; beforePromptComplete?: (text: string) => Promise<void>; requireSubagentActivation?: boolean; emptyOwnedSubagentRoster?: boolean; uninitializedSessionStore?: boolean; voiceUnavailable?: boolean } = {}) {
  const cookie = `fixture_auth=${randomBytes(24).toString('hex')}`;
  const tickets = new Set<string>();
  const interactions = new AgentScenarios();
  const models = new ModelScenarios();
  const validCookies = new Set([cookie]);
  const sessions = new Map<string, { key: string; messages: {role:string; text:string}[]; running: boolean; profile: string; updated: number; turn: number; inflight: string }>();
  const metrics = { tickets: 0, creates: 0, submits: 0, upgrades: 0, cronActions: 0 };
  // Mutable cron state, keyed by the signed-in browser session so parallel e2e logins never share jobs.
  // Trusted-local (token) requests share one 'local' store.
  const cronStores = new Map<string, Map<string, Record<string, unknown>[]>>();
  const cronJobsFor = (session: unknown, profile: string) => {
    const key = typeof session === 'string' ? session : 'local';
    let store = cronStores.get(key);
    if (!store) { store = new Map(); cronStores.set(key, store); }
    if (!store.has(profile)) store.set(profile, fixtureCronJobFor(profile));
    return store.get(profile)!;
  };
  // Live child agents per parent runtime, mirroring Hermes' `subagent.list` roster shape.
  const children = new Map<string, Record<string, unknown>[]>();
  // Delegated child transcripts: stored like Hermes subagent sessions, readable by id but never listed.
  const childSessions = new Map<string, { key: string; profile: string; messages: {role:string; text:string}[] }>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let closed = false;
  const ws = new WebSocketServer({ noServer: true, handleProtocols: () => options.sessionToken ? false : WS_PROTOCOL });
  const server = createServer((req, res) => {
    const send = (status: number, data: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
    if (req.url?.split('?')[0] === '/api/status') { send(200, { ...fixtureHermesStatus(new URL(req.url, 'http://fixture').searchParams.get('profile') ?? 'default'), auth_required: !options.sessionToken }); return; }
    if (options.sessionToken && (req.url?.startsWith('/auth/') || req.url?.startsWith('/api/auth/'))) { send(404, {}); return; }
    if (req.url === '/api/auth/providers') { send(200, { providers: [{ name: 'basic', display_name: 'Fixture password', supports_password: true }] }); return; }
    if (req.url === '/auth/password-login' && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => { body += String(chunk); });
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (data.username !== 'fixture' || data.password !== 'fixture-password') { send(401, {}); return; }
          const loginCookie = `fixture_auth=${randomBytes(24).toString('hex')}`;
          validCookies.add(loginCookie);
          res.setHeader('Set-Cookie', `${loginCookie}; Path=/__hermes/; HttpOnly; SameSite=Lax`);
          send(200, { ok: true });
        } catch { send(400, {}); }
      }); return;
    }
    const presented = options.sessionToken ? req.headers['x-hermes-session-token'] === options.sessionToken : req.headers.cookie?.split('; ').find((value) => validCookies.has(value));
    if (req.url === '/auth/logout' && req.method === 'POST') {
      if (typeof presented === 'string') validCookies.delete(presented);
      res.writeHead(302, { Location: '/__hermes/login', 'Set-Cookie': 'fixture_auth=; Max-Age=0; Path=/__hermes/; HttpOnly; SameSite=Lax' });
      res.end(); return;
    }
    if (!presented) { send(401, {}); return; }
    if (req.url?.startsWith('/api/audio/')) {
      // Synthetic audio routes: deterministic results, no provider, no real audio. Unconfigured-provider mode returns 503.
      const route = req.url.split('?')[0];
      if (route === '/api/audio/voice-config' && req.method === 'GET') { send(200, { ok: true, stt: { mode: 'relay' }, tts: { mode: 'relay' } }); return; }
      if ((route === '/api/audio/transcribe' || route === '/api/audio/speak') && req.method === 'POST') {
        let body = '';
        req.on('data', (chunk) => { body += String(chunk); if (body.length > 2_000_000) req.destroy(); });
        req.on('end', () => {
          if (options.voiceUnavailable) { send(503, { detail: 'No provider is configured on this host' }); return; }
          let data: Record<string, unknown> = {};
          try { data = JSON.parse(body); } catch { send(400, { detail: 'Invalid JSON' }); return; }
          if (route === '/api/audio/transcribe') {
            if (typeof data.data_url !== 'string' || !data.data_url.startsWith('data:audio/')) { send(400, { detail: 'Invalid audio payload' }); return; }
            send(200, { ok: true, transcript: 'fixture dictation', provider: 'fixture' }); return;
          }
          if (typeof data.text !== 'string' || !data.text.trim()) { send(400, { detail: 'Text is required' }); return; }
          send(200, { ok: true, data_url: 'data:audio/mpeg;base64,AAEC', mime_type: 'audio/mpeg', provider: 'fixture' });
        });
        return;
      }
      send(404, { detail: 'Not Found' }); return;
    }
    if (req.url === '/openapi.json') {
      send(200, { openapi: '3.1.0', paths: { '/api/sessions': { get: {} }, '/api/sessions/search': { get: {} }, '/api/profiles': { get: {} }, '/api/model/options': { get: {} }, '/api/skills': { get: {}, post: {} }, '/api/skills/content': { get: {}, put: {} },
        '/api/memory': { get: {} }, '/api/memory/reset': { post: {} }, '/api/mcp/servers': { get: {}, post: {} }, '/api/mcp/servers/{name}/test': { post: {} }, '/api/mcp/servers/{name}/auth': { post: {} }, '/api/mcp/catalog': { get: {} }, '/api/mcp/catalog/install': { post: {} }, '/api/health': { get: {} }, '/api/system/stats': { get: {} }, '/api/memory/providers/{name}/config': { get: {}, put: {} },
        '/api/cron/jobs': { get: {}, post: {} }, '/api/cron/jobs/{job_id}': { get: {}, put: {}, delete: {} }, '/api/cron/jobs/{job_id}/runs': { get: {} },
        '/api/cron/jobs/{job_id}/pause': { post: {} }, '/api/cron/jobs/{job_id}/resume': { post: {} }, '/api/cron/jobs/{job_id}/trigger': { post: {} }, '/api/cron/fire': { post: {} } }, 'x-private': 'must-not-export' }); return;
    }
    if (req.url === '/api/auth/me') { send(200, { user_id: 'fixture', provider: 'basic' }); return; }
    if (req.url === '/api/auth/ws-ticket' && req.method === 'POST') {
      const issue = () => {
        if (res.destroyed) return;
        const ticket = randomBytes(24).toString('base64url'); tickets.add(ticket); metrics.tickets++;
        send(200, { ticket, ttl_seconds: 30 });
      };
      // Test-only gate: delay real HTTP admission without route/WS/service-worker mocks.
      if (options.beforeWsTicket) void options.beforeWsTicket().then(issue, () => { if (!res.destroyed) send(503, {}); });
      else issue();
      return;
    }
    if (req.url === '/redirect') { res.writeHead(302, { Location: '/login' }); res.end(); return; }
    if (req.url === '/slow') return;
    if (req.url === '/echo-headers') { send(200, req.headers); return; }
    if (req.url === '/consume') { req.resume(); req.on('end', () => send(200, {})); return; }
    const url = new URL(req.url ?? '/', 'http://fixture');
    const rows = [...sessions.values()].filter((session) => session.messages.length &&
      (!url.searchParams.get('profile') || session.profile === url.searchParams.get('profile')))
      .sort((a,b) => b.updated - a.updated).map((session) => ({ id: session.key, profile: session.profile,
        title: session.messages[0]?.text.slice(0,80) ?? '', preview: session.messages.at(-1)?.text.slice(0,120),
        last_active: session.updated, message_count: session.messages.length, source: 'webui-ng' }));
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') ?? 20)));
    const offset = Math.max(0, Number(url.searchParams.get('offset') ?? 0));
    // Current Hermes refuses session browsing until the first session creates the store.
    if (options.uninitializedSessionStore && url.pathname.startsWith('/api/sessions')) {
      send(503, { detail: "Session store is not initialized. Start this profile's gateway to initialize it." }); return;
    }
    if (req.method === 'GET' && url.pathname === '/api/profiles') { send(200, { profiles: [{ name: 'default' }] }); return; }
    if (req.method === 'GET' && url.pathname === '/api/sessions') {
      send(200, { sessions: rows.slice(offset, offset + limit), total: rows.length, limit, offset }); return;
    }
    if (req.method === 'GET' && url.pathname === '/api/sessions/search') {
      const query = (url.searchParams.get('q') ?? '').toLowerCase();
      send(200, { results: rows.filter((row) => row.title.toLowerCase().includes(query) || row.id.includes(query))
        .slice(0, limit).map((row) => ({ ...row, session_id: row.id, snippet: row.preview })) }); return;
    }
    // Read-only skill catalogue shaped like hermes_cli/web_routers/skills.py (bare array; content has an absolute server path).
    if (req.method === 'GET' && url.pathname === '/api/skills') {
      const profile = url.searchParams.get('profile') ?? 'default';
      send(200, profile === 'default' ? fixtureSkills : profile === 'work' ? fixtureSkills.slice(0, 1) : []); return;
    }
    if (req.method === 'GET' && url.pathname === '/api/skills/content') {
      const name = url.searchParams.get('name') ?? '';
      const skill = fixtureSkills.find((item) => item.name === name);
      if (!skill || (url.searchParams.get('profile') ?? 'default') === 'missing') { send(404, { detail: `Skill '${name}' not found.` }); return; }
      send(200, { name, content: skillMarkdown(name), path: `/srv/hermes/profiles/default/skills/${skill.category}/${name}/SKILL.md` }); return;
    }
    if (req.method === 'GET' && url.pathname === '/api/mcp/servers') { send(200, fixtureMcpServers(url.searchParams.get('profile') ?? 'default')); return; }
    if (req.method === 'GET' && url.pathname === '/api/health') { send(200, fixtureHealth); return; }
    if (req.method === 'GET' && url.pathname === '/api/system/stats') { send(200, fixtureSystemStats); return; }
    if (req.method === 'GET' && url.pathname === '/api/memory') { send(200, fixtureMemory(url.searchParams.get('profile') ?? 'default')); return; }
    if (req.method === 'GET' && url.pathname === '/api/cron/jobs') { send(200, cronJobsFor(presented, url.searchParams.get('profile') ?? 'default')); return; }
    const cron = /^\/api\/cron\/jobs\/([^/]+)(\/runs|\/pause|\/resume|\/trigger)?$/.exec(url.pathname);
    if (cron) {
      const profile = url.searchParams.get('profile') ?? 'default';
      const job = cronJobsFor(presented, profile).find((row) => row.id === cron[1]);
      const action = cron[2];
      if (!job) { req.resume(); send(404, { detail: 'Job not found' }); return; }
      if (req.method === 'GET' && action === '/runs') { send(200, { runs: fixtureCronRuns(String(job.id)), limit: Number(url.searchParams.get('limit') ?? 20) }); return; }
      if (req.method === 'GET' && !action) { send(200, job); return; }
      if (req.method === 'POST' && action) {
        req.resume(); metrics.cronActions++;
        const apply = () => {
          if (action === '/pause') Object.assign(job, { enabled: false, state: 'paused', paused_reason: 'Paused from the dashboard' });
          if (action === '/resume') Object.assign(job, { enabled: true, state: 'scheduled', paused_reason: null, paused_at: null });
          if (action === '/trigger') Object.assign(job, { enabled: true, state: 'scheduled', last_run_at: NOW, last_status: 'ok', last_error: null });
          if (!res.destroyed) send(200, job);
        };
        // Trigger is slower on purpose: the UI must hold its buttons disabled while the request is in flight.
        if (action === '/trigger') setTimeout(apply, 800); else apply();
        return;
      }
      req.resume(); send(405, { detail: 'Method not allowed' }); return;
    }
    const match = /^\/api\/sessions\/([^/]+)\/messages$/.exec(url.pathname);
    if (req.method === 'GET' && match) {
      const session = [...sessions.values()].find((item) => item.key === match[1]) ?? childSessions.get(match[1]!);
      if (!session || !session.messages.length || (url.searchParams.get('profile') && url.searchParams.get('profile') !== session.profile)) { send(404, {}); return; }
      const oldest = url.searchParams.get('order') === 'oldest';
      const end = oldest ? Math.min(session.messages.length, offset + limit) : Math.max(0, session.messages.length - offset);
      const start = oldest ? Math.min(offset, end) : Math.max(0, end - limit);
      const messages = session.messages.slice(start, end).map((message, i) => ({ id: start + i + 1, role: message.role, content: message.text }));
      send(200, { session_id: session.key, profile: session.profile, messages,
        pagination: { order: oldest ? 'oldest' : 'latest', limit, offset, returned: messages.length } }); return;
    }
    send(404, {});
  });
  server.on('upgrade', (req, socket, head) => {
    const protocols = (req.headers['sec-websocket-protocol'] ?? '').split(',').map((part) => part.trim());
    const ticket = protocols.find((part) => part.startsWith('hermes-gateway-ticket.'))?.slice(22);
    const localUrl = new URL(req.url ?? '', 'http://local');
    const admitted = options.sessionToken ? localUrl.pathname === '/api/ws' && localUrl.searchParams.get('token') === options.sessionToken && !req.headers['sec-websocket-protocol']
      : req.url === '/api/ws' && !!ticket && tickets.delete(ticket) && protocols.includes(WS_PROTOCOL);
    if (!admitted) {
      socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); return;
    }
    metrics.upgrades++; ws.handleUpgrade(req, socket, head, (client) => ws.emit('connection', client));
  });
  ws.on('connection', (client: WebSocket) => {
    // Mirrors Hermes transport authority: process-wide active_list is readable, but a child roster requires
    // this exact client to have created/resumed/activated the parent runtime.
    const attached = new Set<string>();
    const event = (type: string, session_id?: string, payload: unknown = {}) =>
      client.send(JSON.stringify({ jsonrpc: '2.0', method: 'event', params: { type, session_id, payload } }));
    event('gateway.ready', undefined, { heartbeat: true, change_events: true });
    client.on('message', (raw) => {
      const request = JSON.parse(raw.toString()); const { id, method, params = {} } = request;
      const reply = (result: unknown) => client.send(JSON.stringify({ jsonrpc: '2.0', id, result }));
      const error = () => client.send(JSON.stringify({ jsonrpc: '2.0', id, error: { code: 4001, message: 'Not found' } }));
      if (models.handle(method, params, reply, error, event)) return;
      if (method === 'session.active_list') { reply({ sessions: [...sessions].map(([id, row]) => ({ id, session_key: row.key, last_active: row.updated, title: row.messages.find(message => message.role === 'user')?.text.slice(0, 120) || 'New conversation', status: interactions.waiting(id) ? 'waiting' : row.running ? 'working' : 'idle' })) }); return; }
      if (method === 'delegation.status') {
        const active = [...children].flatMap(([runtimeId, rows]) => {
          const owner = sessions.get(runtimeId)?.key;
          return owner ? rows.map(row => ({ ...row, owner_agent_session_id: owner })) : [];
        });
        reply({ active, paused:false, max_spawn_depth:1, max_concurrent_children:10 }); return;
      }
      if (method === 'subagent.list') {
        if (options.requireSubagentActivation && !attached.has(String(params.session_id))) { error(); return; }
        reply({ subagents: options.emptyOwnedSubagentRoster ? [] : children.get(String(params.session_id)) ?? [], delegations: [] }); return;
      }
      if (method === 'gateway.ping') { reply({ ok: true }); return; }
      if (method === 'session.create') {
        const sid = randomUUID(); const key = randomUUID(); metrics.creates++;
        models.create(sid, typeof params.profile === 'string' ? params.profile : 'default');
        sessions.set(sid, { key, messages: [], running: false, profile: typeof params.profile === 'string' ? params.profile : 'default', updated: Date.now()/1000, turn: 0, inflight: '' }); attached.add(sid); reply({ session_id: sid, stored_session_id: key, info: models.info(sid) }); return;
      }
      if (method === 'session.resume') {
        const entry = [...sessions].find(([sid, session]) => sid === params.session_id || session.key === params.session_id);
        if (!entry || (params.profile && entry[1].profile !== params.profile)) { error(); return; }
        if (!('model' in models.info(entry[0]))) models.create(entry[0], entry[1].profile);
        attached.add(entry[0]);
        reply({ session_id: entry[0], session_key: entry[1].key, info: { ...models.info(entry[0]), profile_name: entry[1].profile } }); return;
      }
      const session = sessions.get(params.session_id);
      if (!session) { error(); return; }
      const emitAgent = (type:string,payload:unknown) => {if(client.readyState===1)event(type,params.session_id,payload);};
      if(interactions.respond(params.session_id,method,params,reply))return;
      if (method === 'session.history') { reply({ messages: session.messages }); return; }
      if (method === 'session.activate') { attached.add(String(params.session_id)); reply({ info: models.info(String(params.session_id)), running: session.running, status: session.running ? 'working' : 'idle', inflight: { assistant: session.inflight },...interactions.snapshot(params.session_id,emitAgent) }); return; }
      if (method === 'session.interrupt') { interactions.interrupt(params.session_id); session.turn++; session.running = false; session.inflight = ''; reply({ ok: true }); event('session.info', params.session_id, { running: false }); return; }
      if (method === 'prompt.submit') {
        if (session.running) { error(); return; }
        metrics.submits++; session.running = true; session.messages.push({ role: 'user', text: params.text });
        session.updated = Date.now()/1000; session.inflight = '';
        const turn = ++session.turn;
        reply({ status: 'streaming' }); event('message.start', params.session_id);
        if(interactions.start(params.session_id,String(params.text),emitAgent,(text)=>{session.messages.push({role:'assistant',text});session.running=false;session.inflight='';session.updated=Date.now()/1000;}))return;
        const slow = String(params.text).startsWith('[slow-test]');
        const streaming = String(params.text).startsWith('[stream-test]');
        const childAgent = String(params.text).startsWith('[subagent-test]');
        const later = (callback: () => void, delay: number) => {
          const timer = setTimeout(() => { timers.delete(timer); if (session.turn === turn) callback(); }, delay);
          timers.add(timer);
        };
        const delta = (text: string) => { session.inflight += text; if (client.readyState === 1) event('message.delta', params.session_id, {text}); };
        if (slow) delta('Controlled turn is running…');
        // Nested child agents: the roster arrives by hydration AND the streamed frames exercise the live path.
        if (childAgent) {
          const childKey = `child-${session.key}`;
          const child = { subagent_id: 'sa-0-1054fd14', goal: 'Nested fixture child', model: 'deepseek-v4.1-flash', status: 'running', started_at: Date.now()/1000, tool_name: 'terminal', tool_count: 3, child_session_id: childKey };
          // Longer than one history page, so the initial prompt is only reachable through the pinned copy.
          childSessions.set(childKey, { key: childKey, profile: session.profile, messages: [
            { role: 'user', text: 'FIXTURE_CHILD_PROMPT: audit the build scripts and report.' },
            ...Array.from({ length: 119 }, (_, i) => ({ role: i % 2 ? 'user' : 'assistant', text: `child step ${i}` })) ] });
          // The roster stays consistent with the stream, as Hermes builds it from the live child records.
          later(() => { children.set(String(params.session_id), [child]); event('subagent.start', params.session_id, child); }, 200);
          later(() => { child.tool_name = 'read_file'; child.tool_count = 4; event('subagent.tool', params.session_id, { subagent_id: child.subagent_id, tool_name: 'read_file', tool_count: 4, child_session_id: childKey }); }, 500);
          // The child keeps working after the operator opens it: the view must pick this up without a reload.
          later(() => { childSessions.get(childKey)?.messages.push({ role: 'assistant', text: 'FIXTURE_CHILD_LATE_STEP' }); }, 5000);
        }
        // Text, a tool, then more text: the order a real turn produces between tool calls.
        if (String(params.text).startsWith('[interleave-test]')) {
          later(() => delta('Checking the build first. '), 50);
          later(() => event('tool.start', params.session_id, { tool_id: 'il-1', name: 'terminal', args: { command: 'make' } }), 150);
          later(() => event('tool.complete', params.session_id, { tool_id: 'il-1', name: 'terminal', result: '{"exit_code":0}' }), 250);
          later(() => delta('The build passes.'), 350);
          later(() => { session.messages.push({ role: 'assistant', text: session.inflight }); session.updated = Date.now()/1000;
            event('message.complete', params.session_id, { text: session.inflight });
            later(() => { session.running = false; session.inflight = ''; event('session.info', params.session_id, { running: false }); }, 20); }, 3000);
          return;
        }
        if (streaming) for (let i=0; i<30; i++) later(() => delta(`Streaming line ${i} ${'text '.repeat(20)}\n`), i*100);
        const complete = () => {
          if (closed || session.turn !== turn) return;
          const text = streaming ? session.inflight + 'SYNTHETIC_RESPONSE' : 'SYNTHETIC_RESPONSE';
          session.messages.push({ role: 'assistant', text }); session.updated = Date.now()/1000;
          if (client.readyState === 1) {
            if (!streaming) delta(text);
            const spawned = children.get(String(params.session_id));
            if (spawned) {
              children.delete(String(params.session_id));
              for (const child of spawned)
                event('subagent.complete', params.session_id, { subagent_id: child.subagent_id, status: 'completed', duration_seconds: 12 });
            }
            event('message.complete', params.session_id, { text });
          }
          later(() => { session.running = false; session.inflight = '';
            if (client.readyState === 1) event('session.info', params.session_id, { running: false });
          }, 20);
        };
        later(() => {
          // Test-only completion barrier: real snapshots stay working until released.
          if (options.beforePromptComplete) void options.beforePromptComplete(String(params.text)).then(complete, () => {
            if (closed || session.turn !== turn) return;
            session.running = false; session.inflight = '';
            if (client.readyState === 1) event('error', params.session_id, { code: 'FIXTURE_COMPLETION_REJECTED' });
          });
          else complete();
        }, slow || streaming ? 3100 : 40); return;
      }
      error();
    });
  });
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No fixture address');
  return { origin: `http://127.0.0.1:${address.port}`, metrics, cookie, interactions,
    seed: (count: number, messageCount = 2) => {
      for (let i=0; i<count; i++) sessions.set(`seed-live-${i}`, { key:`seed-${i}`, profile:'default',
        messages: Array.from({length: messageCount}, (_, j) => ({ role:j%2 ? 'assistant' : 'user', text:`Seed ${i} entry ${j}` })),
        running:false, updated:i, turn:0, inflight:'' });
    },
    seedActiveSubagent: (title: string) => {
      const sid = randomUUID(), key = randomUUID();
      sessions.set(sid, { key, profile:'default', messages:[{role:'user', text:title}],
        running:false, updated:Date.now()/1000, turn:1, inflight:'' });
      children.set(sid, [{ subagent_id:'sa-background', goal:'Background child', model:'deepseek-v4.1-flash',
        status:'running', started_at:Date.now()/1000 - 120, tool_count:4, last_tool:'terminal' }]);
      return { sid, key };
    },
    disconnect: () => { for (const client of ws.clients) client.terminate(); },
    close: async () => {
      closed = true;
      interactions.close();timers.forEach(clearTimeout); ws.clients.forEach((client) => client.terminate()); ws.close();
      server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

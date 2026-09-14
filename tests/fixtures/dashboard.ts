/** SYNTHETIC contract fixture. This is not vanilla-Hermes compatibility evidence. */
import { createServer } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';
import { ModelScenarios } from './model-scenarios.js';
import { AgentScenarios } from './agent-scenarios.js';
import { WS_PROTOCOL } from '../../src/hermes/dashboard-client.js';

export async function startFixture(port = 0, options: { sessionToken?: string; beforeWsTicket?: () => Promise<void>; beforePromptComplete?: (text: string) => Promise<void> } = {}) {
  const cookie = `fixture_auth=${randomBytes(24).toString('hex')}`;
  const tickets = new Set<string>();
  const interactions = new AgentScenarios();
  const models = new ModelScenarios();
  const validCookies = new Set([cookie]);
  const sessions = new Map<string, { key: string; messages: {role:string; text:string}[]; running: boolean; profile: string; updated: number; turn: number; inflight: string }>();
  const metrics = { tickets: 0, creates: 0, submits: 0, upgrades: 0 };
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let closed = false;
  const ws = new WebSocketServer({ noServer: true, handleProtocols: () => options.sessionToken ? false : WS_PROTOCOL });
  const server = createServer((req, res) => {
    const send = (status: number, data: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
    if (req.url === '/api/status') { send(200, { auth_required: !options.sessionToken }); return; }
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
    if (req.url === '/openapi.json') {
      send(200, { openapi: '3.1.0', paths: { '/api/sessions': { get: {} }, '/api/sessions/search': { get: {} }, '/api/profiles': { get: {} }, '/api/model/options': { get: {} } }, 'x-private': 'must-not-export' }); return;
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
    if (req.method === 'GET' && url.pathname === '/api/sessions') {
      send(200, { sessions: rows.slice(offset, offset + limit), total: rows.length, limit, offset }); return;
    }
    if (req.method === 'GET' && url.pathname === '/api/sessions/search') {
      const query = (url.searchParams.get('q') ?? '').toLowerCase();
      send(200, { results: rows.filter((row) => row.title.toLowerCase().includes(query) || row.id.includes(query))
        .slice(0, limit).map((row) => ({ ...row, session_id: row.id, snippet: row.preview })) }); return;
    }
    const match = /^\/api\/sessions\/([^/]+)\/messages$/.exec(url.pathname);
    if (req.method === 'GET' && match) {
      const session = [...sessions.values()].find((item) => item.key === match[1]);
      if (!session || !session.messages.length || (url.searchParams.get('profile') && url.searchParams.get('profile') !== session.profile)) { send(404, {}); return; }
      const end = Math.max(0, session.messages.length - offset);
      const start = Math.max(0, end - limit);
      const messages = session.messages.slice(start, end).map((message, i) => ({ id: start + i + 1, role: message.role, content: message.text }));
      send(200, { session_id: session.key, profile: session.profile, messages,
        pagination: { order:'latest', limit, offset, returned: messages.length } }); return;
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
    const event = (type: string, session_id?: string, payload: unknown = {}) =>
      client.send(JSON.stringify({ jsonrpc: '2.0', method: 'event', params: { type, session_id, payload } }));
    event('gateway.ready', undefined, { heartbeat: true, change_events: true });
    client.on('message', (raw) => {
      const request = JSON.parse(raw.toString()); const { id, method, params = {} } = request;
      const reply = (result: unknown) => client.send(JSON.stringify({ jsonrpc: '2.0', id, result }));
      const error = () => client.send(JSON.stringify({ jsonrpc: '2.0', id, error: { code: 4001, message: 'Not found' } }));
      if (models.handle(method, params, reply, error, event)) return;
      if (method === 'session.active_list') { reply({ sessions: [...sessions].map(([id, row]) => ({ id, session_key: row.key, last_active: row.updated, title: row.messages.find(message => message.role === 'user')?.text.slice(0, 120) || 'New conversation', status: interactions.waiting(id) ? 'waiting' : row.running ? 'working' : 'idle' })) }); return; }
      if (method === 'gateway.ping') { reply({ ok: true }); return; }
      if (method === 'session.create') {
        const sid = randomUUID(); const key = randomUUID(); metrics.creates++;
        models.create(sid, typeof params.profile === 'string' ? params.profile : 'default');
        sessions.set(sid, { key, messages: [], running: false, profile: typeof params.profile === 'string' ? params.profile : 'default', updated: Date.now()/1000, turn: 0, inflight: '' }); reply({ session_id: sid, stored_session_id: key, info: models.info(sid) }); return;
      }
      if (method === 'session.resume') {
        const entry = [...sessions].find(([sid, session]) => sid === params.session_id || session.key === params.session_id);
        if (!entry || (params.profile && entry[1].profile !== params.profile)) { error(); return; }
        if (!('model' in models.info(entry[0]))) models.create(entry[0], entry[1].profile);
        reply({ session_id: entry[0], session_key: entry[1].key, info: { ...models.info(entry[0]), profile_name: entry[1].profile } }); return;
      }
      const session = sessions.get(params.session_id);
      if (!session) { error(); return; }
      const emitAgent = (type:string,payload:unknown) => {if(client.readyState===1)event(type,params.session_id,payload);};
      if(interactions.respond(params.session_id,method,params,reply))return;
      if (method === 'session.history') { reply({ messages: session.messages }); return; }
      if (method === 'session.activate') { reply({ info: models.info(String(params.session_id)), running: session.running, status: session.running ? 'working' : 'idle', inflight: { assistant: session.inflight },...interactions.snapshot(params.session_id,emitAgent) }); return; }
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
        const later = (callback: () => void, delay: number) => {
          const timer = setTimeout(() => { timers.delete(timer); if (session.turn === turn) callback(); }, delay);
          timers.add(timer);
        };
        const delta = (text: string) => { session.inflight += text; if (client.readyState === 1) event('message.delta', params.session_id, {text}); };
        if (slow) delta('Controlled turn is running…');
        if (streaming) for (let i=0; i<30; i++) later(() => delta(`Streaming line ${i} ${'text '.repeat(20)}\n`), i*100);
        const complete = () => {
          if (closed || session.turn !== turn) return;
          const text = streaming ? session.inflight + 'SYNTHETIC_RESPONSE' : 'SYNTHETIC_RESPONSE';
          session.messages.push({ role: 'assistant', text }); session.updated = Date.now()/1000;
          if (client.readyState === 1) {
            if (!streaming) delta(text);
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
    disconnect: () => { for (const client of ws.clients) client.terminate(); },
    close: async () => {
      closed = true;
      interactions.close();timers.forEach(clearTimeout); ws.clients.forEach((client) => client.terminate()); ws.close();
      server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

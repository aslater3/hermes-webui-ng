/** SYNTHETIC contract fixture. This is not vanilla-Hermes compatibility evidence. */
import { createServer } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';
import { WS_PROTOCOL } from '../../src/hermes/dashboard-client.js';

export async function startFixture(port = 0) {
  const cookie = `fixture_auth=${randomBytes(24).toString('hex')}`;
  const tickets = new Set<string>();
  const sessions = new Map<string, { key: string; messages: unknown[]; running: boolean }>();
  const metrics = { tickets: 0, creates: 0, submits: 0, upgrades: 0 };
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const ws = new WebSocketServer({ noServer: true, handleProtocols: () => WS_PROTOCOL });
  const server = createServer((req, res) => {
    const send = (status: number, data: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    };
    if (req.url === '/api/status') {
      send(200, { auth_required: true });
      return;
    }
    if (req.url === '/api/auth/providers') {
      send(200, {
        providers: [{ name: 'basic', display_name: 'Fixture password', supports_password: true }],
      });
      return;
    }
    if (req.url === '/auth/password-login' && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => {
        body += String(chunk);
      });
      req.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (data.username !== 'fixture' || data.password !== 'fixture-password') {
            send(401, {});
            return;
          }
          res.setHeader('Set-Cookie', `${cookie}; Path=/__hermes/; HttpOnly; SameSite=Lax`);
          send(200, { ok: true });
        } catch {
          send(400, {});
        }
      });
      return;
    }
    if (!req.headers.cookie?.split('; ').includes(cookie)) {
      send(401, {});
      return;
    }
    if (req.url === '/api/auth/me') {
      send(200, { user_id: 'fixture', provider: 'basic' });
      return;
    }
    if (req.url === '/api/auth/ws-ticket' && req.method === 'POST') {
      const ticket = randomBytes(24).toString('base64url');
      tickets.add(ticket);
      metrics.tickets++;
      send(200, { ticket, ttl_seconds: 30 });
      return;
    }
    if (req.url === '/redirect') {
      res.writeHead(302, { Location: '/login' });
      res.end();
      return;
    }
    if (req.url === '/slow') return;
    if (req.url === '/echo-headers') {
      send(200, req.headers);
      return;
    }
    if (req.url === '/consume') {
      req.resume();
      req.on('end', () => send(200, {}));
      return;
    }
    send(404, {});
  });
  server.on('upgrade', (req, socket, head) => {
    const protocols = (req.headers['sec-websocket-protocol'] ?? '').split(',').map((part) => part.trim());
    const ticket = protocols.find((part) => part.startsWith('hermes-gateway-ticket.'))?.slice(22);
    if (req.url !== '/api/ws' || !ticket || !tickets.delete(ticket) || !protocols.includes(WS_PROTOCOL)) {
      socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    metrics.upgrades++;
    ws.handleUpgrade(req, socket, head, (client) => ws.emit('connection', client));
  });
  ws.on('connection', (client: WebSocket) => {
    const event = (type: string, session_id?: string, payload: unknown = {}) =>
      client.send(JSON.stringify({ jsonrpc: '2.0', method: 'event', params: { type, session_id, payload } }));
    event('gateway.ready', undefined, { heartbeat: true, change_events: true });
    client.on('message', (raw) => {
      const request = JSON.parse(raw.toString());
      const { id, method, params = {} } = request;
      const reply = (result: unknown) => client.send(JSON.stringify({ jsonrpc: '2.0', id, result }));
      const error = () =>
        client.send(JSON.stringify({ jsonrpc: '2.0', id, error: { code: 4001, message: 'Not found' } }));
      if (method === 'gateway.ping') {
        reply({ ok: true });
        return;
      }
      if (method === 'session.create') {
        const sid = randomUUID();
        const key = randomUUID();
        metrics.creates++;
        sessions.set(sid, { key, messages: [], running: false });
        reply({ session_id: sid, stored_session_id: key });
        return;
      }
      if (method === 'session.resume') {
        const entry = [...sessions].find(([, session]) => session.key === params.session_id);
        if (!entry) {
          error();
          return;
        }
        reply({ session_id: entry[0], session_key: entry[1].key });
        return;
      }
      const session = sessions.get(params.session_id);
      if (!session) {
        error();
        return;
      }
      if (method === 'session.history') {
        reply({ messages: session.messages });
        return;
      }
      if (method === 'session.activate') {
        reply({ running: session.running, status: session.running ? 'working' : 'idle' });
        return;
      }
      if (method === 'session.interrupt') {
        session.running = false;
        reply({ ok: true });
        return;
      }
      if (method === 'prompt.submit') {
        metrics.submits++;
        session.running = true;
        session.messages.push({ role: 'user', text: params.text });
        reply({ status: 'streaming' });
        event('message.start', params.session_id);
        const timer = setTimeout(() => {
          timers.delete(timer);
          session.running = false;
          session.messages.push({ role: 'assistant', text: 'SYNTHETIC_RESPONSE' });
          if (client.readyState === 1) {
            event('message.delta', params.session_id, { text: 'SYNTHETIC_RESPONSE' });
            event('message.complete', params.session_id, { text: 'SYNTHETIC_RESPONSE' });
          }
        }, 40);
        timers.add(timer);
        return;
      }
      error();
    });
  });
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No fixture address');
  return {
    origin: `http://127.0.0.1:${address.port}`,
    metrics,
    cookie,
    disconnect: () => {
      for (const client of ws.clients) client.terminate();
    },
    close: async () => {
      timers.forEach(clearTimeout);
      ws.clients.forEach((client) => client.terminate());
      ws.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

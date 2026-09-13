import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import https from 'node:https';
import { Transform, type Duplex } from 'node:stream';
import type { Config } from '../config.js';
import { localHandshake } from '../trusted-local.js';
import { endToEnd, requestHeaders, rewriteLocation } from './headers.js';

export type Log = (event: { event: string; requestId: string; status: number; durationMs: number }) => void;

export function json(res: ServerResponse, status: number, body: unknown): void {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  });
  res.end(JSON.stringify(body));
}

export function proxyHttp(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  config: Config,
  requestId: string,
  log: Log,
): void {
  const start = Date.now();
  const declared = Number(req.headers['content-length'] ?? 0);
  if (!Number.isSafeInteger(declared) || declared < 0 || declared > config.maxBodyBytes) {
    json(res, 413, { error: { code: 'BODY_TOO_LARGE', requestId } });
    req.resume();
    return;
  }
  const request = config.upstream.protocol === 'https:' ? https.request : http.request;
  const upstream = request(config.upstream, {
    method: req.method,
    path,
    headers: requestHeaders(req, config, requestId),
  });
  let done = false;
  const fail = (status: number, code: string) => {
    if (done) return;
    done = true;
    upstream.destroy();
    json(res, status, { error: { code, requestId } });
  };
  const timer = setTimeout(() => fail(504, 'UPSTREAM_TIMEOUT'), config.requestTimeoutMs);
  res.once('close', () => {
    clearTimeout(timer);
    upstream.destroy();
  });
  res.once('finish', () => {
    clearTimeout(timer);
    log({ event: 'hermes.http', requestId, status: res.statusCode, durationMs: Date.now() - start });
  });
  req.once('aborted', () => {
    done = true;
    upstream.destroy();
  });
  req.once('error', () => fail(400, 'REQUEST_ABORTED'));
  upstream.once('error', () => fail(502, 'UPSTREAM_UNREACHABLE'));
  upstream.once('response', (response) => {
    if (done) {
      response.destroy();
      return;
    }
    try {
      if (config.authMode === 'trusted-local' && (response.headers.location || !response.headers['content-type']?.includes('application/json'))) throw new Error('Unsupported local response');
      const headers = endToEnd(response.headers);
      if (config.authMode === 'trusted-local') delete headers['set-cookie'];
      if (response.headers.location) headers.location = rewriteLocation(response.headers.location, config);
      // Gated auth retains Hermes-owned cookie names and scope verbatim.
      headers['cache-control'] = 'no-store';
      headers['x-content-type-options'] = 'nosniff';
      headers['referrer-policy'] = 'no-referrer';
      headers['x-request-id'] = requestId;
      res.writeHead(response.statusCode ?? 502, headers);
      response.once('error', () => {
        done = true;
        res.destroy();
      });
      response.once('end', () => {
        done = true;
      });
      response.pipe(res);
    } catch {
      response.destroy();
      fail(502, 'INVALID_UPSTREAM_RESPONSE');
    }
  });
  let bytes = 0;
  const limit = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > config.maxBodyBytes) {
        fail(413, 'BODY_TOO_LARGE');
        callback(new Error('body limit'));
      } else callback(null, chunk);
    },
  });
  limit.on('error', () => {
    req.unpipe(limit);
    req.resume();
  });
  req.pipe(limit).pipe(upstream);
}

export function refuseUpgrade(socket: Duplex, status: number): void {
  socket.end(`HTTP/1.1 ${status} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
}

export function proxyUpgrade(
  req: IncomingMessage,
  client: Duplex,
  head: Buffer,
  path: string,
  config: Config,
  requestId: string,
  log: Log,
  sockets: Set<Duplex>,
): void {
  const start = Date.now();
  const request = config.upstream.protocol === 'https:' ? https.request : http.request;
  const upstream = request(config.upstream, {
    method: 'GET',
    path,
    headers: requestHeaders(req, config, requestId, true),
  });
  let admitted = false;
  let peer: Duplex | undefined;
  sockets.add(client);
  const timer = setTimeout(() => {
    refuseUpgrade(client, 504);
    upstream.destroy();
  }, config.requestTimeoutMs);
  const dispose = () => {
    clearTimeout(timer);
    upstream.destroy();
    peer?.destroy();
    sockets.delete(client);
    if (peer) sockets.delete(peer);
  };
  client.on('error', dispose);
  client.once('close', dispose);
  upstream.once('error', () => {
    if (!admitted) refuseUpgrade(client, 502);
  });
  upstream.once('response', (response) => {
    clearTimeout(timer);
    response.resume();
    refuseUpgrade(client, response.statusCode ?? 502);
    log({ event: 'hermes.upgrade', requestId, status: response.statusCode ?? 502, durationMs: Date.now() - start });
  });
  upstream.once('upgrade', (response, socket, initial) => {
    clearTimeout(timer);
    if (client.destroyed) {
      socket.destroy();
      return;
    }
    const headers = endToEnd(response.headers);
    if (!localHandshake(headers, config)) { socket.destroy(); refuseUpgrade(client, 502); upstream.destroy(); return; }
    admitted = true;
    peer = socket;
    sockets.add(socket);
    socket.setTimeout(0);
    socket.setNoDelay(true);
    headers.connection = 'Upgrade';
    headers.upgrade = 'websocket';
    const lines = Object.entries(headers).flatMap(([key, value]) =>
      (Array.isArray(value) ? value : [value])
        .filter((v) => v !== undefined)
        .map((v) => `${key}: ${String(v)}`),
    );
    client.write(`HTTP/1.1 101 Switching Protocols\r\n${lines.join('\r\n')}\r\n\r\n`);
    if (initial.length) client.write(initial);
    if (head.length) socket.write(head);
    socket.on('error', () => client.destroy());
    socket.once('close', () => {
      sockets.delete(socket);
      client.destroy();
    });
    client.pipe(socket).pipe(client);
    log({ event: 'hermes.upgrade', requestId, status: 101, durationMs: Date.now() - start });
  });
  upstream.end();
}

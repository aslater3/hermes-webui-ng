import type { IncomingHttpHeaders, IncomingMessage, OutgoingHttpHeaders } from 'node:http';
import type { Config } from '../config.js';
import { PROXY_PREFIX } from '../config.js';
import { localRequestHeaders } from '../trusted-local.js';

const HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

export function endToEnd(headers: IncomingHttpHeaders): OutgoingHttpHeaders {
  const named = new Set(
    (headers.connection ?? '')
      .toLowerCase()
      .split(',')
      .map((s) => s.trim()),
  );
  return Object.fromEntries(
    Object.entries(headers).filter(
      ([key]) =>
        !HOP.has(key) &&
        !named.has(key) &&
        !key.startsWith('x-forwarded-') &&
        key !== 'forwarded' &&
        !key.startsWith('access-control-'),
    ),
  );
}

export function requestHeaders(
  req: IncomingMessage,
  config: Config,
  requestId: string,
  upgrade = false,
): OutgoingHttpHeaders {
  const headers = endToEnd(req.headers);
  // PUBLIC_ORIGIN is the operator's authority, not an untrusted forwarding header.
  headers.host = config.publicOrigin.host;
  headers['x-forwarded-host'] = config.publicOrigin.host;
  headers['x-forwarded-proto'] = config.publicOrigin.protocol.slice(0, -1);
  headers['x-forwarded-prefix'] = PROXY_PREFIX;
  headers['x-forwarded-for'] = req.socket.remoteAddress ?? '127.0.0.1';
  headers['x-request-id'] = requestId;
  if (upgrade) {
    headers.connection = 'Upgrade';
    headers.upgrade = 'websocket';
  }
  localRequestHeaders(headers, config, upgrade);
  return headers;
}

export function rewriteLocation(value: string, config: Config): string {
  const target = new URL(value, config.upstream);
  if (!['http:', 'https:'].includes(target.protocol)) throw new Error('Invalid upstream redirect');
  if (target.origin !== config.upstream.origin && target.origin !== config.publicOrigin.origin) return value;
  const path =
    target.pathname === PROXY_PREFIX || target.pathname.startsWith(`${PROXY_PREFIX}/`)
      ? target.pathname
      : `${PROXY_PREFIX}${target.pathname}`;
  return `${config.publicOrigin.origin}${path}${target.search}${target.hash}`;
}

export function upstreamPath(raw: string): string | undefined {
  if (!raw.startsWith(`${PROXY_PREFIX}/`)) return undefined;
  const path = raw.slice(PROXY_PREFIX.length);
  const pathname = path.split('?')[0] ?? '';
  try {
    const decoded = decodeURIComponent(pathname);
    if (
      !decoded.startsWith('/') ||
      decoded.startsWith('//') ||
      decoded.includes('\\') ||
      /[\x00-\x20\x7f%]/.test(decoded) ||
      /%2f/i.test(pathname) ||
      decoded.split('/').some((s) => s === '..' || s === '.')
    )
      return undefined;
    return path;
  } catch {
    return undefined;
  }
}

export function allowedRequest(req: IncomingMessage, config: Config, upgrade = false): boolean {
  if (req.headers.host !== config.publicOrigin.host) return false;
  if (req.headers['sec-fetch-site'] === 'cross-site') return false;
  const supplied = req.headers.origin;
  if (supplied !== undefined && supplied !== config.publicOrigin.origin) return false;
  return (
    !(upgrade || !['GET', 'HEAD', 'OPTIONS'].includes(req.method ?? '')) ||
    supplied === config.publicOrigin.origin
  );
}

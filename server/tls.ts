import http, { type RequestListener } from 'node:http';
import https from 'node:https';
import { readFileSync, statSync } from 'node:fs';
import type { Config } from './config.js';

export interface TlsFiles { cert: string; key: string }
export function tlsFiles(env: NodeJS.ProcessEnv, publicOrigin: URL): TlsFiles | undefined {
  const cert = env.WEBUI_TLS_CERT, key = env.WEBUI_TLS_KEY;
  if (!cert && !key) return undefined; // Existing authenticated external TLS proxies remain supported.
  if (!cert || !key || publicOrigin.protocol !== 'https:')
    throw new Error('Native TLS requires WEBUI_TLS_CERT, WEBUI_TLS_KEY and an HTTPS PUBLIC_ORIGIN');
  return { cert, key };
}
function pem(path: string): Buffer {
  const size = statSync(path).size;
  if (size < 1 || size > 131072) throw new Error('Invalid TLS file size');
  return readFileSync(path);
}
export function transportServer(config: Config, listener: RequestListener) {
  const options = { maxHeaderSize: 16384, requestTimeout: 20_000, headersTimeout: 15_000 };
  if (!config.tls) return http.createServer(options, listener);
  try {
    return https.createServer({ ...options, cert: pem(config.tls.cert), key: pem(config.tls.key),
      minVersion: 'TLSv1.2', handshakeTimeout: 10_000 }, listener);
  } catch {
    // Paths, private PEM data and OpenSSL exception strings must not reach logs.
    throw new Error('TLS startup failed; check certificate/key validity, match and read permissions');
  }
}

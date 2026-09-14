import http from 'node:http';
import https from 'node:https';
import { readFileSync } from 'node:fs';
// Verify the local TLS listener with the operator's CA, not a global insecure override.
try {
  const tls = !!process.env.WEBUI_TLS_CERT;
  const request = tls ? https.request : http.request;
  const req = request({ hostname: '127.0.0.1', port: Number(process.env.PORT ?? 8787), path: '/healthz',
    method: 'GET', timeout: 3000,
    ...(tls ? { ca: readFileSync(process.env.WEBUI_TLS_CA ?? process.env.WEBUI_TLS_CERT!), rejectUnauthorized: true } : {}),
  }, response => { response.resume(); process.exitCode = response.statusCode === 200 ? 0 : 1; });
  req.on('error', () => { process.exitCode = 1; });
  req.on('timeout', () => req.destroy()); req.end();
} catch { process.exitCode = 1; }

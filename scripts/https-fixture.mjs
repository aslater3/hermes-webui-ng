import { resolve } from 'node:path';
import { createApp } from '../build/server/app.js';
import { loadConfig } from '../build/server/config.js';
import { startFixture } from '../build/tests/fixtures/dashboard.js';
const upstream = await startFixture();
const config = loadConfig({ HERMES_DASHBOARD_URL: upstream.origin, PUBLIC_ORIGIN: 'https://127.0.0.1:8791', PORT: '8791', HOST: '127.0.0.1',
  WEBUI_TLS_CERT: resolve('.local/tls/server/server.crt'), WEBUI_TLS_KEY: resolve('.local/tls/server/server.key') });
const app = createApp(config, () => {}); app.server.listen(config.port, config.host);
async function close() { await app.close(); await upstream.close(); }
process.once('SIGTERM', () => void close()); process.once('SIGINT', () => void close());

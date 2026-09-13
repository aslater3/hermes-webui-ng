import { mkdtemp, cp, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startFixture } from '../build/tests/fixtures/dashboard.js';
import { createApp } from '../build/server/app.js';
import { loadConfig } from '../build/server/config.js';
const fixture = await startFixture();
fixture.seed(1, 110);
// The legacy regression suite has its own test-only origin. Production / is always React.
const legacy = await mkdtemp(join(tmpdir(), 'hermes-legacy-fixture-'));
await cp('dist', legacy, { recursive: true });
await copyFile(join(legacy, 'diagnostic.html'), join(legacy, 'index.html'));
const apps = [8787, 8788].map(port => {
  const config = loadConfig({ HERMES_DASHBOARD_URL: fixture.origin, PUBLIC_ORIGIN: `http://127.0.0.1:${port}`, PORT: String(port), HOST: '127.0.0.1' });
  if (port === 8788) config.staticDir = legacy;
  return { app: createApp(config), port };
});
await Promise.all(apps.map(({ app, port }) => new Promise(resolve => app.server.listen(port, '127.0.0.1', resolve))));
console.log('SYNTHETIC fixture: React :8787; legacy regression :8788. fixture / fixture-password. Not vanilla-Hermes proof.');
let stopping = false;
async function stop() {
  if (stopping) return; stopping = true;
  await Promise.all(apps.map(({ app }) => app.close()));
  await fixture.close(); await rm(legacy, { recursive: true, force: true });
}
process.once('SIGTERM', () => void stop()); process.once('SIGINT', () => void stop());

import { startFixture } from '../build/tests/fixtures/dashboard.js';
import { createApp } from '../build/server/app.js';
import { loadConfig } from '../build/server/config.js';
const fixture = await startFixture();
const config = loadConfig({
  HERMES_DASHBOARD_URL: fixture.origin,
  PUBLIC_ORIGIN: 'http://127.0.0.1:8787',
  HOST: '127.0.0.1',
});
const app = createApp(config);
app.server.listen(config.port, config.host, () =>
  console.log(
    'SYNTHETIC fixture: http://127.0.0.1:8787 — fixture / fixture-password. Not vanilla-Hermes proof.',
  ),
);
async function stop() {
  await app.close();
  await fixture.close();
}
process.once('SIGTERM', () => void stop());
process.once('SIGINT', () => void stop());

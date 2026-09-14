import { createApp } from './app.js';
import { loadConfig } from './config.js';

try {
  const config = loadConfig();
  const app = createApp(config);
  app.server.listen(config.port, config.host, () =>
    console.log(
      JSON.stringify({
        event: 'webui.started',
        port: config.port,
        tls: !!config.tls,
        version: '0.0.1-phase0',
        workspace: false,
      }),
    ),
  );
  app.server.on('error', () => {
    console.error('WebUI listen failed');
    process.exitCode = 1;
  });
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    const timer = setTimeout(() => process.exit(1), 5000).unref();
    void app.close().finally(() => clearTimeout(timer));
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Invalid startup configuration');
  process.exitCode = 1;
}

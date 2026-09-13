import { startProvider } from '../build/tests/integration/provider.js';
const server = await startProvider(9120);
console.log('Controlled loopback model provider ready');
process.once('SIGTERM', () => void server.close());
process.once('SIGINT', () => void server.close());

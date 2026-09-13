/** Deterministic, loopback-only MODEL endpoint. Hermes itself is not mocked. */
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

export const EXPECTED_RESPONSE = 'HERMES_WEBUI_NG_PHASE0_OK';
export async function startProvider(port = 0, holdMs = 5000) {
  let completions = 0;
  let activeHolds = 0;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const server = createServer((req, res) => {
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(body));
    };
    if (req.method === 'GET' && req.url === '/health') {
      json(200, { completions, activeHolds });
      return;
    }
    if (req.method === 'GET' && req.url === '/v1/models') {
      json(200, { object: 'list', data: [{ id: 'phase0-fixture', object: 'model', owned_by: 'test' }] });
      return;
    }
    if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
      json(404, { error: { message: 'Unsupported fixture endpoint' } });
      return;
    }
    let bytes = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 4_194_304) req.destroy();
      else chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const body: unknown = JSON.parse(Buffer.concat(chunks).toString());
        if (
          typeof body !== 'object' ||
          body === null ||
          !('messages' in body) ||
          !Array.isArray(body.messages)
        ) {
          json(400, {});
          return;
        }
        completions++;
        const latest = [...body.messages].reverse().find((message: unknown) =>
          typeof message === 'object' && message !== null && 'role' in message && message.role === 'user');
        const hold = latest && typeof latest.content === 'string' && latest.content.includes('PHASE2_HOLD_');
        const respond = () => {
        if (res.destroyed) return;
        const common = {
          id: `chatcmpl-${randomUUID()}`,
          created: Math.floor(Date.now() / 1000),
          model: 'phase0-fixture',
        };
        const usage = { prompt_tokens: 20, completion_tokens: 8, total_tokens: 28 };
        if ('stream' in body && body.stream === true) {
          res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' });
          for (const [delta, finish_reason] of [
            [{ role: 'assistant', content: '' }, null],
            [{ content: EXPECTED_RESPONSE }, null],
            [{}, 'stop'],
          ]) {
            res.write(`data: ${JSON.stringify({
              ...common,
              object: 'chat.completion.chunk',
              choices: [{ index: 0, delta, finish_reason, logprobs: null }],
            })}\n\n`);
          }
          res.write(
            `data: ${JSON.stringify({ ...common, object: 'chat.completion.chunk', choices: [], usage })}\n\n`,
          );
          res.end('data: [DONE]\n\n');
        } else {
          json(200, {
            ...common,
            object: 'chat.completion',
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: EXPECTED_RESPONSE },
                finish_reason: 'stop',
              },
            ],
            usage,
          });
        }
        };
        if (hold) {
          activeHolds++;
          let settled = false;
          const release = () => { if (!settled) { settled = true; activeHolds--; } };
          const timer = setTimeout(() => { timers.delete(timer); release(); respond(); }, holdMs);
          timers.add(timer);
          res.once('close', () => { clearTimeout(timer); timers.delete(timer); release(); });
        } else respond();
      } catch {
        if (!res.headersSent) json(400, {});
        else res.destroy();
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No provider address');
  return {
    origin: `http://127.0.0.1:${address.port}`,
    count: () => completions,
    close: async () => {
      timers.forEach(clearTimeout);
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

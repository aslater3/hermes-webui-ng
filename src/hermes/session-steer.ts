import { ClientError, record } from './protocol.js';
import { literalPrompt } from './command-catalog.js';

export interface SteerRpc {
  call(method: string, params?: Record<string, unknown>): Promise<unknown>;
}

/**
 * Explicitly steer the selected live turn. This intentionally bypasses Hermes' configurable
 * busy-input mode: ordinary composer input while running means "steer this turn", never queue
 * or interrupt. The pinned Hermes contract returns {status:'queued'|'rejected', text}.
 */
export async function steerSession(rpc: SteerRpc, runtimeId: string, draft: string): Promise<string> {
  const text = literalPrompt(draft).trim();
  if (!runtimeId) throw new ClientError('disconnected', 'No live Hermes session is available to steer.');
  if (!text) throw new ClientError('protocol', 'Type a steering instruction first.');
  if (text.length > 32768) throw new ClientError('protocol', 'A steering instruction is limited to 32,768 characters.');

  const result = record(await rpc.call('session.steer', { session_id: runtimeId, text }));
  if (result.status === 'rejected')
    throw new ClientError('protocol', 'Hermes could not apply that steer to the active turn. Your draft was kept.');
  if (result.status !== 'queued' || typeof result.text !== 'string' || result.text.trim() !== text)
    throw new ClientError('protocol', 'Hermes returned an unsupported steer acknowledgement. Your draft was kept; check the current turn before retrying.');
  return text;
}

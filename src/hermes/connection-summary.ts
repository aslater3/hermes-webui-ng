import type { FoundationState } from './connection-store.js';
import type { ConnectionState } from './gateway-client.js';
/** Fixed language: upstream error messages and payloads must not become status copy. */
export function connectionSummary(state: FoundationState, gateway: ConnectionState): string {
  if (state.offline) return 'Offline. Reconnect to the network; prompts will not be replayed.';
  if (state.auth === 'unconfirmed') return state.busy ? 'Signing out of Hermes…' : 'Sign-out could not be confirmed. This local conversation view has been cleared.';
  if (state.auth === 'signed-out') return 'Signed out of Hermes. Sign in to reconnect.';
  if (state.rest === 'unreachable') return 'Dashboard REST is unreachable. Check the backend or network, then reconnect.';
  if (state.auth === 'auth-required' || gateway.phase === 'auth-required') return 'Authentication required. Sign in to Hermes; unsent or unacknowledged prompts are never replayed.';
  if (gateway.phase === 'error') return gateway.error?.kind === 'forbidden' ? 'Gateway access denied. Check permissions before reconnecting.' : 'Gateway connection failed. Check the connection details and reconnect explicitly.';
  if (state.rest === 'error' || state.auth === 'error') return 'Dashboard check failed. Check authentication or backend configuration, then reconnect.';
  if (state.auth === 'local-access') {
    if (gateway.phase === 'ready') return 'Connected to Hermes. Trusted LAN access has no browser login.';
    if (gateway.phase === 'authenticating') return 'Verifying the local bridge before Gateway admission…';
    if (gateway.phase === 'disconnected') return 'Local browser transport disconnected. Network access has no login.';
  }
  if (gateway.phase === 'authenticating') return 'REST healthy. Obtaining a fresh one-use Gateway credential…';
  if (gateway.phase === 'connecting') return 'REST healthy. Waiting for the native Gateway ready event…';
  if (gateway.phase === 'reconnecting') return `Gateway reconnecting (attempt ${gateway.attempt}). Recovering from Hermes; no prompt replay.`;
  if (gateway.phase === 'ready') return 'Connected to the native Hermes Gateway.';
  if (state.auth === 'signed-in') return 'Signed in. Browser transport disconnected; this is not sign-out.';
  return 'Checking the Hermes Dashboard connection…';
}

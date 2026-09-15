import type { AppRuntime } from './runtime.js';
import type { NativeSession } from '../src/hermes/native-session.js';
import { navigation } from '../src/hermes/chat-controller.js';
import { ClientError, record } from '../src/hermes/protocol.js';

  /** /new and /clear create a real selected session, never an isolated slash-worker conversation. */
export async function createCommandConversation(rt: Pick<AppRuntime, 'ready' | 'chat' | 'accountGeneration' | 'gateway' | 'notify'>, previous: NativeSession, title = ''): Promise<void> {
    if (!rt.ready || rt.chat.busy || rt.chat.native !== previous || previous.state.phase !== 'idle' || previous.commands.blocked)
      throw new ClientError('disconnected', 'The selected conversation changed before starting a new one.');
    const account = rt.accountGeneration, generation = rt.gateway.state.generation;
    const creation = rt.chat.create(previous.state.profile), created = rt.chat.native;
    await creation;
    const current = () => {
      if (!rt.ready || rt.accountGeneration !== account || rt.gateway.state.generation !== generation || rt.chat.native !== created)
        throw new ClientError('disconnected', 'The new conversation is no longer selected. Nothing was replayed.');
    };
    current();
    if (rt.chat.error || !created.state.runtimeId) throw rt.chat.error ?? new ClientError('protocol', 'Could not create the native conversation.');
    if (title) {
      if (title.length > 512) throw new ClientError('protocol', 'A conversation title is limited to 512 characters.');
      const result = record(await rt.gateway.call('session.title', { session_id: created.state.runtimeId, title }));
      current();
      if (result.title !== title || result.pending === true)
        throw new ClientError('protocol', 'The conversation was created, but Hermes has not confirmed its title. Check native state before retrying.');
      await created.refresh(); current();
    }
    await rt.chat.browser.refresh(); current(); rt.notify();
  }

/** /branch forks the selected native owner through the dedicated live-session RPC. */
export async function branchCommandConversation(
  rt: Pick<AppRuntime, 'ready' | 'chat' | 'accountGeneration' | 'gateway' | 'notify'>,
  previous: NativeSession,
  title = '',
): Promise<void> {
  if (!rt.ready || rt.chat.busy || rt.chat.native !== previous || previous.state.phase !== 'idle' || previous.commands.blocked || !previous.state.runtimeId)
    throw new ClientError('disconnected', 'The selected conversation changed before branching.');
  if (title.length > 512) throw new ClientError('protocol', 'A branch title is limited to 512 characters.');
  const account = rt.accountGeneration, generation = rt.gateway.state.generation, runtimeId = previous.state.runtimeId;
  const current = () => {
    if (!rt.ready || rt.accountGeneration !== account || rt.gateway.state.generation !== generation || rt.chat.native !== previous || previous.state.runtimeId !== runtimeId)
      throw new ClientError('disconnected', 'The conversation changed while Hermes was branching it. Nothing was replayed.');
  };
  current();
  const result = record(await rt.gateway.call('session.branch', {
    session_id: runtimeId,
    ...(previous.state.profile ? { profile: previous.state.profile } : {}),
    ...(title ? { name: title } : {}),
  }));
  current();
  if (typeof result.stored_session_id !== 'string' || !result.stored_session_id || typeof result.session_id !== 'string' || !result.session_id)
    throw new ClientError('protocol', 'Hermes did not return a valid branched conversation.');
  if (title && result.title !== title)
    throw new ClientError('protocol', 'Hermes created a branch but did not confirm its requested title. Check Sessions before retrying.');
  const ref = { id: result.stored_session_id, ...(previous.state.profile ? { profile: previous.state.profile } : {}) };
  history.pushState(null, '', navigation(ref));
  await rt.chat.open(ref);
  if (rt.chat.error) throw rt.chat.error;
  rt.notify();
}


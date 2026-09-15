import { ClientError, record } from './protocol.js';
import { commandResult, type CommandResult } from './command-result.js';
import type { CommandInvocation, CommandOwner, CommandRpc } from './command-dispatch.js';

export const COMPRESS_TIMEOUT_MS = 660_000;
const dynamic = new Set(['Skills', 'Plugin commands', 'User commands']);
export interface NativeCommandRoute {
  /** True only where the inspected handler resolves the live owner or explicitly scopes profile. */
  profileSafe: boolean;
  run(rpc: CommandRpc, owner: CommandOwner, current: () => void, issued: () => void): Promise<CommandResult>;
}
const invalid = (usage: string): never => { throw new ClientError('protocol', usage); };
const bounded = (raw: unknown, max = 32768): string => {
  if (typeof raw !== 'string' || raw.length > max || raw.includes('\0'))
    return invalid('Hermes returned an invalid native command acknowledgement. Check native state before retrying.');
  return raw;
};
function output(value: string, pending = false): CommandResult {
  return commandResult({ output: value, ...(pending ? { status: 'pending' } : {}) });
}
function number(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw < 0)
    return invalid('Hermes omitted a native operation count. Check native state before retrying.');
  return raw;
}
function lines(raw: unknown, keys: string[]): CommandResult {
  const data = record(raw), result: Record<string, unknown> = {};
  if (data.ok === false || data.success === false || data.error)
    return invalid('Hermes did not complete the native operation. Check native state before retrying.');
  for (const key of keys) if (Object.hasOwn(data, key)) result[key] = data[key];
  if (!Object.keys(result).length) return invalid('Hermes returned an unsupported native command result.');
  return output(JSON.stringify(result, null, 2));
}
function noArgument(argument: string, name: string): void {
  if (argument) invalid(`${name} takes no arguments on this Hermes interface. Nothing was executed.`);
}
function rpcRoute(method: string, params: Record<string, unknown>, decode: (raw: unknown) => CommandResult,
  profileSafe = true, timeout = 120_000): NativeCommandRoute {
  return { profileSafe, run: async (rpc, owner, current, issued) => {
    current(); issued();
    const raw = await rpc.call(method, { session_id: owner.runtimeId, profile: owner.profile, ...params }, timeout);
    current(); return decode(raw);
  } };
}

/** Real public RPCs for commands whose slash workers do not own the selected session.
 * A discovered custom command shadowing a builtin always retains native dynamic dispatch. */
export function nativeCommandRoute(command: CommandInvocation): NativeCommandRoute | undefined {
  if (dynamic.has(command.category)) return undefined;
  const { name, argument: arg } = command;
  switch (name) {
    case '/save':
      if (arg) return undefined; // format/filename/redaction arguments retain the native parser.
      return rpcRoute('session.save', {}, raw => {
        const file = bounded(record(raw).file, 4096);
        if (!file) invalid('Hermes did not return the saved transcript path.');
        return output(`Saved transcript to ${file}`);
      });
    case '/title':
      if (arg.length > 512) invalid('A conversation title is limited to 512 characters.');
      return rpcRoute('session.title', arg ? { title: arg } : {}, raw => {
        const data = record(raw), title = bounded(data.title, 512);
        if (arg && title !== arg) invalid('Hermes did not acknowledge the requested title.');
        return output(`${arg ? data.pending === true ? 'Title queued for the first persisted turn' : 'Conversation title updated' : 'Conversation title'}: ${title || '(untitled)'}`);
      });
    case '/compress': case '/compact':
      return rpcRoute('session.compress', arg ? { focus_topic: arg } : {}, raw => {
        const data = record(raw);
        if (data.status === 'pending') return output(bounded(data.message ?? 'Compression is still running in Hermes.'), true);
        if (data.lock_held === true) return output(bounded(data.message ?? 'Compression was not started: another compression owns the lock.'));
        if (!['compressed', 'aborted'].includes(String(data.status))) invalid('Hermes did not confirm compression state.');
        const summary = record(data.summary);
        const text = ['headline', 'token_line', 'note'].flatMap(key => summary[key] == null ? [] : [bounded(summary[key])]).join('\n');
        return output(text || (data.status === 'aborted' ? 'Compression was aborted; inspect the recovered native transcript.' : `Hermes compressed ${number(data.removed)} messages.`));
      }, true, COMPRESS_TIMEOUT_MS);
    case '/stop':
      noArgument(arg, name);
      return { profileSafe: false, run: async (rpc, owner, current, issued) => {
        current(); issued();
        const stopped = record(await rpc.call('session.interrupt', { session_id: owner.runtimeId })); current();
        // Hermes has shipped three explicit interrupt acknowledgement shapes across supported clients:
        // status enum, interrupted boolean, and the older {ok:true} acknowledgement. Accept only those
        // positive/known forms; never infer success from a missing field or ok:false.
        const didInterrupt = stopped.status === 'interrupted' || stopped.interrupted === true;
        const didNotInterrupt = stopped.status === 'not_interrupted' || stopped.interrupted === false;
        const accepted = stopped.ok === true;
        if (!didInterrupt && !didNotInterrupt && !accepted)
          invalid('Hermes did not confirm the interrupt request; background processes were not touched.');
        const processes = record(await rpc.call('process.stop', {})); current();
        const interruptLine = didInterrupt ? 'Interrupt requested for the selected conversation.' : didNotInterrupt ?
          'No active turn was interrupted.' : 'Hermes accepted the interrupt request for the selected conversation.';
        return output(`${interruptLine}\nStopped ${number(processes.killed)} background processes across the Hermes process registry.`);
      } };
    case '/bg': case '/btw':
      if (!arg) invalid(`Use ${name} <${name === '/bg' ? 'prompt' : 'question'}>. Nothing was started.`);
      return rpcRoute(name === '/bg' ? 'prompt.background' : 'prompt.btw', { text: arg }, raw => {
        const id = bounded(record(raw).task_id, 128);
        if (!/^[a-z0-9_-]+$/i.test(id)) invalid('Hermes returned an invalid side-task identifier.');
        return { kind: 'task', id, event: name === '/bg' ? 'background.complete' : 'btw.complete' };
      }, false);
    case '/agents': noArgument(arg, name); return rpcRoute('agents.list', {}, raw => lines(raw, ['processes']), false);
    case '/config': noArgument(arg, name); return rpcRoute('config.show', {}, raw => lines(raw, ['sections']));
    case '/tools': {
      const [action = 'list', ...names] = arg.split(/\s+/).filter(Boolean);
      if (action === 'list' && !names.length) return rpcRoute('tools.show', {}, raw => lines(raw, ['sections', 'total']));
      if (!['enable', 'disable'].includes(action) || !names.length || names.length > 100)
        invalid('Use /tools list or /tools enable|disable <names>. This changes the profile tool configuration.');
      return rpcRoute('tools.configure', { action, names }, raw => lines(raw, ['changed', 'enabled_toolsets', 'unknown', 'missing_servers', 'reset']));
    }
    case '/toolsets': noArgument(arg, name); return rpcRoute('toolsets.list', {}, raw => lines(raw, ['toolsets']), false);
    case '/plugins':
      if (arg) return undefined; // Argument-bearing native management keeps its native parser.
      return rpcRoute('plugins.list', {}, raw => lines(raw, ['plugins']), false);
    case '/insights':
      if (arg && !/^[1-9][0-9]{0,3}$/.test(arg)) invalid('Use /insights [days], from 1 to 9999.');
      return rpcRoute('insights.get', arg ? { days: Number(arg) } : {}, raw => lines(raw, ['days', 'sessions', 'messages']));
    case '/reload': noArgument(arg, name); return rpcRoute('reload.env', {}, raw => output(`Hermes reloaded ${number(record(raw).updated)} environment values. Existing agents may require a new conversation.`), false);
    case '/reload-skills': noArgument(arg, name); return rpcRoute('skills.reload', {}, raw => output(bounded(record(raw).output)), false);
    case '/reload-mcp':
      if (arg && arg !== 'now') return undefined; // Native /always has its own persistent-policy semantics.
      return rpcRoute('reload.mcp', { confirm: true }, raw => lines(raw, ['status', 'coalesced', 'generation', 'tools', 'servers', 'message']), false);
    default: return undefined;
  }
}

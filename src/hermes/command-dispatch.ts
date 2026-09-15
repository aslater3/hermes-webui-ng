import { ClientError, record } from './protocol.js';
import { commandResult, readOnlyCommandResult, type CommandResult } from './command-result.js';

export interface CommandInvocation { name: string; argument: string; category: string }
export interface CommandOwner { runtimeId: string; profile: string }
export interface CommandRpc { call(method: string, params?: Record<string, unknown>, timeoutMs?: number): Promise<unknown> }

const liveDispatch = new Set(['/retry', '/queue', '/steer', '/plan', '/goal', '/loop', '/moa', '/undo', '/learn', '/init', '/compress']);

export type CommandBusyPolicy = 'dispatch' | 'interrupt_then_dispatch' | 'reject';
const busyDispatch = new Set([
  '/start', '/pause', '/approve', '/deny', '/bg', '/btw', '/agents', '/queue', '/steer', '/goal',
  '/heartbeat', '/loop', '/subgoal', '/status', '/egress', '/context', '/profile', '/verbose', '/footer',
  '/yolo', '/busy', '/kanban', '/commands', '/help', '/palette', '/restart', '/login', '/update', '/version',
]);
const busyInterrupt = new Set(['/new', '/stop']);

/** Pinned Hermes registry policy. Catalogue discovery does not carry this field, so keep this compatibility
 * table limited to commands whose busy policy is explicit in the certified runtime. Dynamic skill/plugin/user
 * commands are client-expanded while busy and their generated prompt is handed to prompt.submit, which owns
 * the configured queue/steer/interrupt behavior. */
export function commandBusyPolicy(name: string, category = ''): CommandBusyPolicy {
  if (['Skills', 'Plugin commands', 'User commands'].includes(category)) return 'dispatch';
  if (busyInterrupt.has(name)) return 'interrupt_then_dispatch';
  if (busyDispatch.has(name)) return 'dispatch';
  return 'reject';
}
const readCommands = new Set(['/usage', '/status', '/history']);
export function readOnlyInvocation(command: CommandInvocation): boolean {
  return !command.argument && readCommands.has(command.name) &&
    !['Skills', 'Plugin commands', 'User commands'].includes(command.category);
}
export function nativeCommandMethod(command: CommandInvocation): 'slash.exec' | 'command.dispatch' {
  return liveDispatch.has(command.name) || ['Skills', 'Plugin commands', 'User commands'].includes(command.category) ? 'command.dispatch' : 'slash.exec';
}
function checked(command: CommandInvocation): string {
  if (!/^\/[a-z0-9][a-z0-9_.:-]{0,95}$/i.test(command.name) || /[\u0000-\u0008\u000a-\u001f\u007f]/.test(command.argument))
    throw new ClientError('protocol', 'Invalid native command input. Nothing was sent.');
  const line = command.name + (command.argument ? ` ${command.argument}` : '');
  if (line.length > 32768) throw new ClientError('protocol', 'Command input exceeds 32,768 characters. Nothing was sent.');
  return line;
}

/** The installed baseline does not scope every generic dispatch stage to a supplied profile.
 * Resolve its launch profile through public RPCs, without inferring it from "default" or retaining paths.
 * This is a compatibility gate, not authorisation; native Hermes still authorises every operation. */
export async function verifyCommandProfile(rpc: CommandRpc, owner: CommandOwner, current: () => void): Promise<void> {
  const [rawProfile, rawProfiles] = await Promise.all([
    rpc.call('config.get', { key: 'profile' }), rpc.call('profiles.list', { include_sessions: false }),
  ]);
  current();
  const home = record(rawProfile).home, profiles = record(rawProfiles).profiles;
  if (typeof home !== 'string' || !Array.isArray(profiles))
    throw new ClientError('protocol', 'Hermes did not identify its native command profile. Nothing was executed.');
  const matches = profiles.filter(value => value && typeof value === 'object' && !Array.isArray(value) &&
    (value as Record<string, unknown>).path === home);
  if (matches.length !== 1 || record(matches[0]).name !== owner.profile)
    throw new ClientError('protocol', 'This Hermes version cannot safely run generic commands for the selected profile. Connect to a gateway launched for this profile. Nothing was executed.');
}

/** A newly created runtime may be idle while its lazy agent has no profile metadata yet.
 * Retry read-only snapshots only; an actual run, malformed identity or different owner fails closed. */
export async function waitForCommandOwner(rpc: CommandRpc, owner: CommandOwner, current: () => void, allowRunning = false): Promise<void> {
  const deadline = Date.now() + 10_000;
  for (let attempt = 0; attempt < 100 && Date.now() < deadline; attempt++) {
    current();
    const live = record(await rpc.call('session.activate', { session_id: owner.runtimeId, omit_messages: true }));
    current();
    const info = record(live.info);
    if ((live.running !== false && !(allowRunning && live.running === true)) ||
        (info.profile_name !== undefined && info.profile_name !== owner.profile))
      throw new ClientError('protocol', 'The native session changed or is not in a state that accepts this command. Nothing was executed.');
    if (info.lazy !== true && live.status !== 'starting') {
      if (info.profile_name !== owner.profile)
        throw new ClientError('protocol', 'Hermes did not confirm the native session profile. Nothing was executed.');
      return;
    }
    await new Promise<void>(resolve => setTimeout(resolve, 100));
  }
  current();
  throw new ClientError('timeout', 'Hermes is still preparing this agent. No command was executed; try again once it is ready.');
}

/** One deliberate operation. Never try another executor after a failure: it may already have had effects. */
export async function dispatchCommand(rpc: CommandRpc, command: CommandInvocation, owner: CommandOwner,
  current: () => void, issued: () => void): Promise<CommandResult> {
  const line = checked(command), readOnly = readOnlyInvocation(command);
  const busyPolicy = commandBusyPolicy(command.name, command.category);
  current();
  if (!readOnly) {
    await verifyCommandProfile(rpc, owner, current);
    // Resolve an existing attached runtime before invoking handlers that have an unsafe missing-session fallback.
    await waitForCommandOwner(rpc, owner, current, busyPolicy !== 'reject');
  }
  const method = nativeCommandMethod(command);
  current(); issued();
  const raw = await rpc.call(method, { session_id: owner.runtimeId,
    ...(method === 'slash.exec' ? { command: line } : { name: command.name.slice(1), arg: command.argument }) }, 120_000);
  current();
  return readOnly ? readOnlyCommandResult(raw) : commandResult(raw);
}

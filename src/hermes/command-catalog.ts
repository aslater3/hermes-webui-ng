import { BROWSER_COMMAND_NAMES, browserCommand } from './browser-commands.js';
import { ClientError, record } from './protocol.js';

export type CommandAction = 'catalogue' | 'models' | 'profiles' | 'reasoning' | 'context' | 'native' | 'confirm-native' | 'browser' | 'unavailable';
export interface CommandChoice {
  name: string;
  description: string;
  category: string;
  aliases: string[];
  action: CommandAction;
}
export interface CommandCatalogue { choices: CommandChoice[]; partial: boolean }
export const COMMAND_LIMITS = { entries: 1000, aliases: 2000, description: 240, output: 32768 } as const;
const namePattern = /^\/[a-z0-9][a-z0-9_.:-]{0,95}$/i;
const name = (raw: unknown): string | undefined => typeof raw === 'string' && namePattern.test(raw) ? raw.toLowerCase() : undefined;
const label = (raw: unknown, limit: number): string => typeof raw === 'string' ? raw.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, limit) : '';

/** A catalogue is discovery, not permission to invoke every registered command. */
export function commandAction(command: string): CommandAction {
  if (BROWSER_COMMAND_NAMES.has(command)) return 'browser';
  switch (command) {
    case '/help': case '/commands': case '/palette': return 'catalogue';
    case '/model': return 'models';
    case '/profile': return 'profiles';
    case '/reasoning': return 'reasoning';
    case '/context': return 'context';
    // These exact, argument-free slash.exec paths read the live session before worker/plugin dispatch.
    case '/usage': case '/status': case '/history': return 'native';
    default: return 'confirm-native';
  }
}

/** Allowlisted projection of the official commands.catalog response (execution scope is verified separately). */
export function commandCatalogue(raw: unknown): CommandCatalogue {
  const data = record(raw);
  if (!Array.isArray(data.pairs)) throw new ClientError('protocol', 'Hermes returned an unsupported command catalogue');
  const choices = new Map<string, CommandChoice>();
  let partial = !!data.warning || data.pairs.length > COMMAND_LIMITS.entries;
  for (const pair of data.pairs.slice(0, COMMAND_LIMITS.entries)) {
    const key = Array.isArray(pair) ? name(pair[0]) : undefined;
    if (!key || !Array.isArray(pair) || typeof pair[1] !== 'string') { partial = true; continue; }
    if (!choices.has(key)) choices.set(key, { name: key, description: label(pair[1], COMMAND_LIMITS.description),
      category: 'Other', aliases: [], action: commandAction(key) });
  }
  if (Array.isArray(data.categories)) for (const rawCategory of data.categories.slice(0, 100)) {
    if (!rawCategory || typeof rawCategory !== 'object' || Array.isArray(rawCategory)) continue;
    const category = rawCategory as Record<string, unknown>;
    if (Array.isArray(category.pairs)) for (const pair of category.pairs.slice(0, COMMAND_LIMITS.entries)) {
      const key = Array.isArray(pair) ? name(pair[0]) : undefined, choice = key ? choices.get(key) : undefined;
      if (choice) choice.category = label(category.name, 64) || 'Other';
    }
  }
  if (data.skills && typeof data.skills === 'object' && !Array.isArray(data.skills))
    for (const key of Object.keys(data.skills).slice(0, COMMAND_LIMITS.entries)) {
      const choice = choices.get(key.toLowerCase()); if (choice && choice.category === 'Other') choice.category = 'Skills';
    }
  if (data.canon && typeof data.canon === 'object' && !Array.isArray(data.canon)) {
    const aliases = Object.entries(data.canon); partial ||= aliases.length > COMMAND_LIMITS.aliases;
    for (const [rawAlias, rawTarget] of aliases.slice(0, COMMAND_LIMITS.aliases)) {
      const alias = name(rawAlias), target = name(rawTarget), choice = target ? choices.get(target) : undefined;
      // Canonical rows always win. No recursive aliases, executable targets or prototype-object lookups.
      if (alias && choice && alias !== target && !choices.has(alias) && choice.aliases.length < 20 && !choice.aliases.includes(alias))
        choice.aliases.push(alias);
    }
  }
  for (const choice of choices.values()) {
    if (['Skills', 'User commands', 'Plugin commands'].includes(choice.category)) choice.action = 'confirm-native';
  }
  return { choices: [...choices.values()], partial };
}

export function commandMatches(catalogue: CommandCatalogue | undefined, query: string, limit: number = COMMAND_LIMITS.entries): CommandChoice[] {
  const needle = query.trim().replace(/^\//, '').toLowerCase();
  const terms = needle.split(/\s+/).filter(Boolean);
  const score = (row: CommandChoice): number => {
    const names = [row.name, ...row.aliases].map(value => value.slice(1));
    const searchable = `${names.join(' ')} ${row.description} ${row.category}`.toLowerCase();
    if (!terms.every(term => searchable.includes(term))) return 4;
    return names.some(value => value === needle) ? 0 : names.some(value => value.startsWith(needle)) ? 1 :
      names.some(value => value.includes(needle)) ? 2 : 3;
  };
  return (catalogue?.choices ?? []).map(row => ({ row, score: score(row) })).filter(row => row.score < 4)
    .sort((a, b) => a.score - b.score || Number(['confirm-native', 'unavailable'].includes(a.row.action)) - Number(['confirm-native', 'unavailable'].includes(b.row.action)) || a.row.name.localeCompare(b.row.name))
    .slice(0, Math.max(0, Math.min(limit, COMMAND_LIMITS.entries))).map(({ row }) => row);
}

/** A leading slash is never silently downgraded to a model prompt. // deliberately escapes one slash. */
export function slashInput(text: string): { name: string; argument: string } | undefined {
  const value = text.trimStart();
  if (!value.startsWith('/') || value.startsWith('//')) return undefined;
  const match = /^(\/[^\s]+)(?:[\t ]+([^\r\n]*))?[\t ]*$/.exec(value);
  if (!match || !name(match[1])) throw new ClientError('protocol', 'Use one slash command at a time. Prefix it with // to send it as ordinary text.');
  return { name: match[1]!.toLowerCase(), argument: (match[2] ?? '').trim() };
}
export function literalPrompt(text: string): string {
  return text.trimStart().startsWith('//') ? text.replace(/^(\s*)\//, '$1') : text;
}
export function commandChoice(catalogue: CommandCatalogue, input: { name: string; argument: string }): CommandChoice {
  const choice = catalogue.choices.find(row => row.name === input.name || row.aliases.includes(input.name));
  if (!choice || choice.action === 'unavailable')
    throw new ClientError('protocol', 'This command is not available in HermesUI NG. Check the command catalogue; nothing was sent to the model.');
  if (choice.action === 'browser') { browserCommand(choice.name, input.argument); return choice; }
  if (input.argument && ['/usage', '/status', '/history'].includes(choice.name) && choice.action === 'native')
    throw new ClientError('protocol', 'This Hermes native read ignores arguments. No reset or other argument operation was executed.');
  if (input.argument && choice.action !== 'catalogue') return { ...choice, action: 'confirm-native' };
  return choice;
}
/** Implementation coverage is separate from a missing upstream method or denied admission. */
export function commandAvailability(choice: CommandChoice, executionUnavailable = false): string {
  if (choice.action === 'unavailable') return 'Not implemented in WebUI';
  if (choice.action === 'confirm-native') return 'Native command · confirmation required';
  if (choice.action === 'native' && executionUnavailable) return 'Not supported by this Hermes version';
  return 'Available in WebUI';
}

export function commandHint(choice: CommandChoice, executionUnavailable = false): string {
  if (choice.action === 'native' && executionUnavailable)
    return 'This Hermes version does not provide the native command method used by this WebUI.';
  switch (choice.action) {
    case 'browser': return 'Open browser controls for this command; no detached terminal execution.';
    case 'catalogue': return 'Browse the Hermes command catalogue';
    case 'models': return 'Open the session model picker';
    case 'profiles': return 'Choose a profile for a new conversation';
    case 'reasoning': return 'Open supported reasoning controls';
    case 'context': return 'View native usage and context';
    case 'native': return 'Read-only native command · no arguments';
    case 'confirm-native': return 'Run in Hermes with arguments; review native effects before confirming.';
    default:
      if (['/undo', '/retry', '/rewind', '/regenerate'].includes(choice.name))
        return 'Destructive history controls are not implemented in HermesUI NG yet.';
      if (choice.name === '/compress' || choice.name === '/compact')
        return 'Context compression is not implemented in HermesUI NG yet.';
      if (['Skills', 'Plugin commands', 'User commands'].includes(choice.category))
        return 'Skill, plugin and custom command execution is not implemented in HermesUI NG yet.';
      return 'Hermes advertises this command, but HermesUI NG has no handler for it yet.';
  }
}

import { ClientError, record } from './protocol.js';

export type CommandAction = 'catalogue' | 'models' | 'profiles' | 'reasoning' | 'context' | 'native' | 'unavailable';
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
  switch (command) {
    case '/help': return 'catalogue';
    case '/model': return 'models';
    case '/profile': return 'profiles';
    case '/reasoning': return 'reasoning';
    case '/context': return 'context';
    // These exact, argument-free slash.exec paths read the live session before worker/plugin dispatch.
    case '/usage': case '/status': case '/history': return 'native';
    default: return 'unavailable';
  }
}

/** Allowlisted projection of the official, profile-scoped commands.catalog response. */
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
  return { choices: [...choices.values()], partial };
}

export function commandMatches(catalogue: CommandCatalogue | undefined, query: string, limit = 80): CommandChoice[] {
  const needle = query.trim().replace(/^\//, '').toLowerCase();
  const score = (row: CommandChoice): number => {
    const names = [row.name, ...row.aliases].map(value => value.slice(1));
    return names.some(value => value === needle) ? 0 : names.some(value => value.startsWith(needle)) ? 1 :
      names.some(value => value.includes(needle)) ? 2 : `${row.description} ${row.category}`.toLowerCase().includes(needle) ? 3 : 4;
  };
  return (catalogue?.choices ?? []).map(row => ({ row, score: score(row) })).filter(row => row.score < 4)
    .sort((a, b) => a.score - b.score || Number(a.row.action === 'unavailable') - Number(b.row.action === 'unavailable') || a.row.name.localeCompare(b.row.name))
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
  if (input.argument && choice.action !== 'catalogue')
    throw new ClientError('protocol', 'This command takes no arguments here. Use the matching picker for changes; nothing was sent.');
  return choice;
}
export function commandHint(choice: CommandChoice): string {
  switch (choice.action) {
    case 'catalogue': return 'Browse the Hermes command catalogue';
    case 'models': return 'Open the session model picker';
    case 'profiles': return 'Choose a profile for a new conversation';
    case 'reasoning': return 'Open supported reasoning controls';
    case 'context': return 'View native usage and context';
    case 'native': return 'Read-only native command · no arguments';
    default: return 'Not available in this WebUI · use Hermes CLI or Dashboard';
  }
}

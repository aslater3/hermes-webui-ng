import { ClientError, record } from './protocol.js';

export type BrowserCommand =
  | { kind: 'new'; title: string }
  | { kind: 'sessions'; query: string }
  | { kind: 'compose'; text: string }
  | { kind: 'copy'; ordinal?: number }
  | { kind: 'redraw' }
  | { kind: 'branch'; title: string }
  | { kind: 'yolo' }
  | { kind: 'image'; hostPath: string }
  | { kind: 'paste' };
export const BROWSER_COMMAND_NAMES = new Set(['/new', '/clear', '/resume', '/sessions', '/prompt', '/copy', '/redraw', '/branch', '/yolo', '/image', '/paste']);
export const COPY_TEXT_LIMIT = 262144;

/** Browser equivalents of client-owned commands; never send them to a detached slash worker. */
export function browserCommand(name: string, argument: string): BrowserCommand {
  if (argument.length > 32768 || /[\u0000-\u0008\u000b-\u001f\u007f]/.test(argument))
    throw new ClientError('protocol', 'Invalid browser command arguments. Nothing was executed.');
  switch (name) {
    case '/new':
      if (argument.length > 512) throw new ClientError('protocol', 'A conversation title is limited to 512 characters.');
      return { kind: 'new', title: argument };
    case '/clear':
      if (argument) throw new ClientError('protocol', '/clear takes no arguments. Use /new <name> to name a new conversation.');
      return { kind: 'new', title: '' };
    case '/resume': case '/sessions':
      if (argument.length > 512) throw new ClientError('protocol', 'Conversation search is limited to 512 characters.');
      return { kind: 'sessions', query: argument };
    case '/prompt': return { kind: 'compose', text: argument };
    case '/copy':
      if (argument && !/^[1-9][0-9]{0,4}$/.test(argument))
        throw new ClientError('protocol', 'Use /copy or /copy <response number>, starting at 1.');
      return { kind: 'copy', ...(argument ? { ordinal: Number(argument) } : {}) };
    case '/redraw':
      if (argument) throw new ClientError('protocol', '/redraw takes no arguments.');
      return { kind: 'redraw' };
    case '/branch':
      if (argument.length > 512) throw new ClientError('protocol', 'A branch title is limited to 512 characters.');
      return { kind: 'branch', title: argument };
    case '/yolo':
      if (argument) throw new ClientError('protocol', '/yolo takes no arguments in HermesUI NG. Use the session toggle to choose the state.');
      return { kind: 'yolo' };
    case '/image':
      if (argument.length > 4096) throw new ClientError('protocol', 'An image path is limited to 4,096 characters.');
      return { kind: 'image', hostPath: argument };
    case '/paste':
      if (argument) throw new ClientError('protocol', '/paste takes no arguments.');
      return { kind: 'paste' };
    default: throw new ClientError('protocol', 'No browser handler exists for this command.');
  }
}

/** Native history ordering matches /copy N: N is one-based from the start, not Nth from the end.
 * Reasoning, tools, generated placeholder text and media bodies are never substituted for an answer. */
export function copyAssistantResponse(raw: unknown, ordinal?: number): { text: string; ordinal: number } {
  const messages = record(raw).messages;
  if (!Array.isArray(messages) || messages.length > 20000)
    throw new ClientError('protocol', 'Hermes returned an unsupported or oversized history for copying.');
  const assistants = messages.filter(item => item && typeof item === 'object' && !Array.isArray(item) &&
    item.role === 'assistant' && item.display_kind !== 'hidden');
  const copyText = (item: Record<string, unknown>): string => {
    const content = item.text ?? item.content;
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return '';
    return content.flatMap(part => part && typeof part === 'object' &&
      ['text', 'output_text', 'input_text'].includes(part.type) && typeof part.text === 'string' ? [part.text] : []).join('');
  };
  let index = ordinal === undefined ? assistants.length - 1 : ordinal - 1;
  if (ordinal === undefined) while (index >= 0 && !copyText(assistants[index]).trim()) --index;
  if (!Number.isSafeInteger(index) || index < 0 || index >= assistants.length)
    throw new ClientError('protocol', 'That assistant response is not available in the native history.');
  const text = copyText(assistants[index]);
  if (!text.trim()) throw new ClientError('protocol', 'That assistant response has no copyable text.');
  if (text.length > COPY_TEXT_LIMIT || text.includes('\0'))
    throw new ClientError('protocol', 'That response is too large or invalid for clipboard copying. It was not truncated.');
  return { text, ordinal: index + 1 };
}

import { displayMessage, type DisplayMessage } from './history-message.js';
import { ClientError, record, textField } from './protocol.js';

export interface SessionRef { id: string; profile?: string }
export interface SessionRow extends SessionRef {
  title: string; preview: string; source: string; lastActive: number; messageCount: number;
  /** Optional Hermes state metadata used only to decide whether native resume is appropriate. */
  sessionKey?: string; endedAt?: number; endReason?: string;
}
export interface SessionPage { rows: SessionRow[]; total: number; offset: number; limit: number }
export type HistoryMessage = DisplayMessage;
export interface HistoryPage extends SessionRef {
  messages: HistoryMessage[]; offset: number; limit: number; returned: number;
}
export interface SessionQuery { limit?: number; offset?: number; profile?: string }
export const HISTORY_LIMIT = 100;
export const MESSAGE_LIMIT = 131072;

export function sessionId(value: string): string {
  if (!/^[A-Za-z0-9_.:-]{1,256}$/.test(value) || value === '.' || value === '..')
    throw new ClientError('protocol', 'Unsupported Hermes session identifier');
  return value;
}
export function profileName(value?: string): string | undefined {
  if (value === undefined || value === '') return undefined;
  if (value.length > 256 || /[\x00-\x1f\x7f]/.test(value))
    throw new ClientError('protocol', 'Invalid Hermes profile');
  return value;
}
function number(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new ClientError('protocol', 'Invalid session pagination');
  return value;
}
export function sessionQuery(options: SessionQuery = {}): URLSearchParams {
  const limit = number(options.limit ?? 20), offset = number(options.offset ?? 0);
  if (limit < 1 || limit > 100) throw new ClientError('protocol', 'Session page limit must be 1–100');
  const query = new URLSearchParams({ limit: String(limit), offset: String(offset), order: 'recent' });
  const profile = profileName(options.profile);
  if (profile) query.set('profile', profile);
  return query;
}
function optionalText(value: unknown, max = 256): string { return typeof value === 'string' ? value.slice(0, max) : ''; }
function optionalTime(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}
function optionalSessionId(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw new ClientError('protocol', 'Invalid Hermes session key');
  return sessionId(value);
}
function row(input: unknown, profile?: string, search = false): SessionRow {
  const data = record(input);
  const id = sessionId(textField(data, search && typeof data.session_id === 'string' ? 'session_id' : 'id'));
  const endReason = optionalText(data.end_reason, 80) || undefined;
  return { id, profile: profileName(typeof data.profile === 'string' ? data.profile : profile),
    title: optionalText(data.title), preview: optionalText(search ? data.snippet : data.preview, 512),
    source: optionalText(data.source, 80),
    lastActive: typeof data.last_active === 'number' && Number.isFinite(data.last_active) ? data.last_active :
      typeof data.started_at === 'number' && Number.isFinite(data.started_at) ? data.started_at : 0,
    messageCount: typeof data.message_count === 'number' && Number.isSafeInteger(data.message_count) && data.message_count >= 0 ? data.message_count : 0,
    sessionKey: optionalSessionId(data.session_key), endedAt: optionalTime(data.ended_at), endReason };
}
export function sessionPage(input: unknown, profile?: string): SessionPage {
  const data = record(input);
  const limit = number(data.limit), offset = number(data.offset), total = number(data.total);
  if (!Array.isArray(data.sessions) || limit < 1 || limit > 100 || data.sessions.length > limit)
    throw new ClientError('protocol', 'Invalid Hermes session page');
  return { rows: data.sessions.map((item: unknown) => row(item, profile)), limit, offset, total };
}
export function searchPage(input: unknown, profile?: string): SessionRow[] {
  const data = record(input);
  if (!Array.isArray(data.results) || data.results.length > 100)
    throw new ClientError('protocol', 'Invalid Hermes search results');
  const rows = data.results.map((item: unknown) => row(item, profile, true));
  return [...new Map(rows.map((item) => [JSON.stringify([item.profile, item.id]), item])).values()];
}
export function historyPage(input: unknown, ref: SessionRef, offset: number): HistoryPage {
  const data = record(input);
  if (!Array.isArray(data.messages) || data.messages.length > HISTORY_LIMIT)
    throw new ClientError('protocol', 'Invalid Hermes history page');
  const pagination = data.pagination === undefined ? undefined : record(data.pagination);
  if (pagination && (pagination.order !== 'latest' || pagination.offset !== offset || pagination.limit !== HISTORY_LIMIT))
    throw new ClientError('protocol', 'Unexpected Hermes history pagination');
  const returned = pagination ? number(pagination.returned) : data.messages.length;
  if (returned !== data.messages.length) throw new ClientError('protocol', 'Invalid Hermes history count');
  return { id: sessionId(textField(data, 'session_id')),
    profile: profileName(typeof data.profile === 'string' ? data.profile : ref.profile),
    offset, limit: HISTORY_LIMIT, returned,
    messages: data.messages.flatMap((item: unknown): HistoryMessage[] => {
      const message = displayMessage(item, 'rest');
      return message ? [message] : [];
    }) };
}

import { ClientError, record, type GatewayEvent } from './protocol.js';

export interface PeerQuestion { id: string; text: string; choices: string[]; multiple: boolean; locked?: string }
export interface PeerRequest {
  id: string; sessionId: string; method: string; title: string; detail: string;
  kind: 'approval' | 'clarify' | 'secret' | 'login'; choices: string[]; questions: PeerQuestion[]; batch: boolean;
}
export interface PeerFrame { id: string | number; method: string; params: unknown }
export type PeerAnswer = { choice?: string; answer?: string; answers?: Record<string, string>; value?: string };
const methods = new Set(['approval', 'clarify', 'sudo', 'secret', 'vault.code', 'vault.unlock_prompt', 'vault.unlock', 'vault.save_login']);
const string = (value: unknown, limit = 4096, optional = false): string => {
  if (optional && value === undefined) return '';
  if (typeof value !== 'string' || value.length > limit || value.includes('\0'))
    throw new ClientError('protocol', 'Invalid native interactive request.');
  return value;
};
const strings = (value: unknown): string[] => {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 32) throw new ClientError('protocol', 'Invalid native choices.');
  return [...new Set(value.map(item => string(item, 2048)))];
};
function projection(frame: PeerFrame): PeerRequest {
  const p = record(frame.params), sessionId = string(p.session_id, 256), id = string(frame.id, 128);
  if (!sessionId || !id) throw new ClientError('protocol', 'Native interactive ownership is missing.');
  const base = { id, sessionId, method: frame.method, choices: [] as string[], questions: [] as PeerQuestion[], batch: false };
  if (frame.method === 'approval') {
    const choices = strings(p.choices).filter(value => ['once', 'session', 'always', 'deny'].includes(value));
    // Never infer approval authority from absent choices or a permissive display label.
    return { ...base, kind: 'approval', title: 'Hermes requests approval',
      detail: [string(p.command, 8192, true), string(p.description, 4096, true)].filter(Boolean).join('\n'),
      choices: choices.filter(value => (value !== 'session' || p.allow_session !== false) &&
        (value !== 'always' || p.allow_permanent !== false) && (p.smart_denied !== true || value === 'deny')) };
  }
  if (frame.method === 'clarify') {
    const batch = p.questions !== undefined;
    const rows = batch ? p.questions : [{ qid: 'answer', question: p.question, choices: p.choices, multi_select: p.multi_select }];
    if (!Array.isArray(rows) || !rows.length || rows.length > 32) throw new ClientError('protocol', 'Invalid native questions.');
    const locked = p.answers === undefined ? {} : record(p.answers);
    const questions = rows.map(raw => {
      const row = record(raw), id = string(row.qid, 128);
      if (!id || ['__proto__', 'constructor', 'prototype'].includes(id)) throw new ClientError('protocol', 'Invalid native question identifier.');
      return { id, text: string(row.question, 8192), choices: strings(row.choices), multiple: row.multi_select === true,
        ...(Object.hasOwn(locked, id) ? { locked: string(locked[id], 32768) } : {}) };
    });
    if (new Set(questions.map(q => q.id)).size !== questions.length) throw new ClientError('protocol', 'Duplicate native question identifiers.');
    return { ...base, kind: 'clarify', title: 'Hermes needs your input', detail: '', questions, batch };
  }
  const kind = frame.method === 'vault.save_login' ? 'login' : 'secret';
  const title = frame.method === 'sudo' ? 'Sudo password' : frame.method === 'vault.code' ? 'Verification code' :
    kind === 'login' ? 'Save a login in the native vault' : frame.method.startsWith('vault.') ? 'Unlock native vault' : 'Secret requested by Hermes';
  return { ...base, kind, title,
    detail: ['prompt', 'env_var', 'command', 'display_name', 'origin', 'site', 'hint'].flatMap(key =>
      p[key] === undefined ? [] : [string(p[key], 4096)]).join('\n') };
}

/** Native JSON-RPC peer requests, separate from our client RPC correlation IDs.
 * No secret answers, arbitrary metadata, transcript or response replay is retained. */
export class PeerRequests {
  private rows: readonly PeerRequest[] = [];
  private settled = new Set<string>();
  private listeners = new Set<() => void>();
  private visible = true;
  constructor(private readonly send: (frame: Record<string, unknown>) => void) {}
  getSnapshot = () => this.rows;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(rows: readonly PeerRequest[]): void { this.rows = rows; for (const listener of this.listeners) listener(); }
  private settle(id: string): void {
    this.settled.add(id); if (this.settled.size > 2048) this.settled.delete(this.settled.values().next().value!);
    this.publish(this.rows.filter(row => row.id !== id));
  }
  clear(): void { this.settled.clear(); this.publish([]); }
  setVisible(visible: boolean): void { this.visible = visible; if (!visible) this.publish([]); }
  private error(id: string | number, code: number): void {
    this.send({ jsonrpc: '2.0', id, error: { code, message: code === -32601 ? 'This client does not implement the requested surface.' : 'Invalid native interactive request.' } });
  }
  receive(frame: PeerFrame): void {
    if (!methods.has(frame.method)) { this.error(frame.id, -32601); return; }
    if (!this.visible) return; // Authoritative open_requests restores unanswered questions on foreground.
    let request: PeerRequest;
    try { request = projection(frame); } catch { this.error(frame.id, -32602); return; }
    if (this.settled.has(request.id)) return;
    const existing = this.rows.find(row => row.id === request.id);
    if (existing) {
      // Neither an old snapshot nor a second owner may replace an already displayed question.
      if (existing.sessionId !== request.sessionId || existing.method !== request.method) this.error(frame.id, -32602);
      return;
    }
    if (this.rows.length >= 64) { this.error(frame.id, -32000); return; }
    this.publish([...this.rows, request]);
  }
  hydrate(raw: unknown, sessionId: string): void {
    if (!this.visible || !Array.isArray(raw)) return;
    for (const value of raw.slice(0, 64)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      const frame = value as Record<string, unknown>;
      if (typeof frame.id !== 'string' || typeof frame.method !== 'string' || !frame.params || typeof frame.params !== 'object' ||
          Array.isArray(frame.params) || (frame.params as Record<string, unknown>).session_id !== sessionId) continue;
      this.receive({ id: frame.id, method: frame.method, params: frame.params });
    }
  }
  cancel(event: GatewayEvent): void {
    if (event.type !== 'request.cancel' || !event.payload || typeof event.payload !== 'object') return;
    const p = event.payload as Record<string, unknown>, row = this.rows.find(row => row.id === p.id);
    if (typeof p.id !== 'string' || p.id.length > 128 || typeof p.method !== 'string' || !event.session_id) return;
    if (!row || (row.sessionId === event.session_id && row.method === p.method)) this.settle(p.id);
  }
  respond(request: PeerRequest, answer: PeerAnswer, cancel = false): void {
    if (!this.visible || !this.rows.includes(request) || this.settled.has(request.id))
      throw new ClientError('disconnected', 'This native question is no longer current. No response was replayed.');
    let result: Record<string, unknown>;
    if (request.kind === 'approval') {
      const choice = cancel ? 'deny' : answer.choice;
      if (choice !== 'deny' && !request.choices.includes(choice ?? '')) throw new ClientError('protocol', 'That approval choice is not advertised.');
      result = { choice };
    } else if (request.kind === 'clarify') {
      if (cancel) result = request.batch ? {} : { answer: '' };
      else if (!request.batch) result = { answer: string(answer.answer, 32768) };
      else result = { answers: Object.fromEntries(request.questions.map(q => [q.id, q.locked ?? string(answer.answers?.[q.id], 32768)])) };
    } else result = { value: cancel ? '' : string(answer.value, 32768) };
    if (JSON.stringify({ jsonrpc: '2.0', id: request.id, result }).length > 1_048_576)
      throw new ClientError('protocol', 'The combined answer is too large. Shorten it before sending.');
    // Retire BEFORE send. Socket failure leaves the outcome unknown; never permit a duplicate click.
    this.settle(request.id);
    this.send({ jsonrpc: '2.0', id: request.id, result });
    for (const key of Object.keys(result)) delete result[key];
  }
}

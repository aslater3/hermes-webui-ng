import { ClientError, record, type GatewayEvent } from './protocol.js';

export type InputKind = 'approval' | 'clarify' | 'sudo' | 'secret';
export type InputStatus = 'pending' | 'sending' | 'answered' | 'expired' | 'unknown' | 'unsupported';
export interface Question { id?: string; text: string; choices: string[]; multiple: boolean; }
export interface AgentInput {
  key: string; id: string; kind: InputKind; status: InputStatus;
  prompt: string; command?: string; envVar?: string;
  choices: string[]; questions: Question[]; answered: string[];
  blocked: boolean;
}
export interface ToolActivity {
  id: string; name: string; state: 'running' | 'complete' | 'error' | 'unknown';
  input: string; output: string; context: string; duration?: number; truncated: boolean;
}
export interface ActivityTurn { id: number; reasoning: string; thinking: string; tools: ToolActivity[]; truncated: boolean; }
export interface ActivityState {
  reasoning: string; thinking: string; tools: ToolActivity[]; inputs: AgentInput[];
  truncated: boolean; droppedTools: number; recoveryGap: boolean; malformed: boolean;
}
export const ACTIVITY_LIMITS = { tools: 40, inputs: 16, text: 32768, input: 16384, questions: 12 } as const;
const KINDS: InputKind[] = ['approval', 'clarify', 'sudo', 'secret'];
const clean = (value: string) => value.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
const text = (value: unknown, max: number = ACTIVITY_LIMITS.text): string => typeof value === 'string' ? clean(value).slice(0, max) : '';
function id(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 256 || /[\x00-\x1f\x7f]/.test(value))
    throw new ClientError('protocol', 'Invalid agent interaction identifier');
  return value;
}
/** Bounded display projection; never retain arbitrary raw payloads or credential replies. */
export function displayValue(value: unknown, max: number = ACTIVITY_LIMITS.text): string {
  if (typeof value === 'string') return text(value, max);
  let budget = max;
  const visit = (item: unknown, depth: number): unknown => {
    if (budget <= 0 || depth > 6) return '[bounded]';
    if (typeof item === 'string') { const result = text(item, Math.max(0, budget)); budget -= result.length; return result; }
    if (item === null || typeof item === 'number' || typeof item === 'boolean') { budget -= 16; return item; }
    if (Array.isArray(item)) return item.slice(0, 64).map((v) => visit(v, depth + 1));
    if (typeof item === 'object' && item !== null) {
      return Object.fromEntries(Object.entries(item).slice(0, 64).map(([key, v]) => {
        budget -= key.length;
        return [text(key, 128), /password|secret|token|api.?key|authorization|cookie/i.test(key) ? '[redacted]' : visit(v, depth + 1)];
      }));
    }
    return '';
  };
  return text(JSON.stringify(visit(value, 0), null, 2), max);
}
function choices(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 32 || value.some((v) => typeof v !== 'string' || v.length > 2048))
    throw new ClientError('protocol', 'Unsupported agent choices');
  return value.map((v: string) => clean(v));
}
export function parseInput(kind: InputKind, raw: unknown): AgentInput {
  const p = record(raw), requestId = id(p.request_id);
  let blocked = false;
  const bounded = (v: unknown): string => { if (typeof v === 'string' && (v.length > 8192 || clean(v) !== v)) blocked = true; return text(v, 8192); };
  const question = (raw: unknown, batch: boolean): Question => {
    const q = record(raw);
    const label = bounded(q.question);
    if (!label) throw new ClientError('protocol', 'Missing agent question');
    return { id: batch ? id(q.qid) : undefined, text: label, choices: choices(q.choices), multiple: q.multi_select === true };
  };
  const questions: Question[] = [];
  if (kind === 'clarify') {
    if (p.questions !== undefined) {
      if (!Array.isArray(p.questions) || !p.questions.length || p.questions.length > ACTIVITY_LIMITS.questions)
        throw new ClientError('protocol', 'Unsupported clarify batch');
      questions.push(...p.questions.map((q) => question(q, true)));
      if (new Set(questions.map((q) => q.id)).size !== questions.length)
        throw new ClientError('protocol', 'Duplicate clarify question identifier');
    } else questions.push(question(p, false));
  }
  const approvalChoices = kind === 'approval' ? choices(p.choices) : [];
  if (kind === 'approval' && (typeof p.command !== 'string' || !p.command)) blocked = true;
  return {
    key: `${kind}:${requestId}`, id: requestId, kind, status: 'pending',
    prompt: bounded(p.prompt ?? p.description ?? p.reason),
    command: kind === 'approval' ? bounded(p.command) : undefined,
    envVar: kind === 'secret' ? bounded(p.env_var) : undefined,
    choices: kind === 'approval' ? (p.choices === undefined ? ['once', 'deny'] : approvalChoices.filter((c) => ['once', 'session', 'deny'].includes(c))) : [],
    questions,
    answered: p.answers && typeof p.answers === 'object' ? questions.flatMap((q) => q.id && Object.hasOwn(p.answers as object, q.id) ? [q.id] : []) : [],
    blocked,
  };
}
export interface InputReply { value: string; questionId?: string; }
export function inputRpc(input: AgentInput, reply: InputReply, runtimeId: string): { method: string; params: Record<string, unknown> } {
  if (input.status !== 'pending' || input.blocked || typeof reply.value !== 'string' || reply.value.length > 16384)
    throw new ClientError('protocol', 'This request cannot be answered safely');
  const params: Record<string, unknown> = { session_id: id(runtimeId), request_id: input.id };
  if (input.kind === 'approval') {
    if (!input.choices.includes(reply.value)) throw new ClientError('protocol', 'Approval choice is not offered by Hermes');
    params.choice = reply.value;
  } else if (input.kind === 'clarify') {
    const batch = input.questions.some((q) => q.id);
    if (reply.questionId && input.answered.includes(reply.questionId)) throw new ClientError('protocol', 'This answer was already confirmed');
    if (batch && reply.questionId) {
      if (!input.questions.some((q) => q.id === reply.questionId)) throw new ClientError('protocol', 'Unknown clarify question');
      params.question_id = reply.questionId;
    } else if ((batch && reply.value !== '') || (!batch && reply.questionId)) throw new ClientError('protocol', 'A batch answer needs its question identifier');
    params.answer = reply.value;
  } else params[input.kind === 'sudo' ? 'password' : 'value'] = reply.value;
  return { method: `${input.kind}.respond`, params };
}
export class AgentActivity {
  state: ActivityState = this.empty();
  archive: ActivityTurn[] = [];
  private turn = 0;
  private terminal = new Set<string>();
  private archiveTurn(): void {
    const s = this.state;
    if (s.tools.length || s.reasoning || s.thinking) this.archive = [...this.archive, {
      id: ++this.turn, reasoning: s.reasoning.slice(-8192), thinking: s.thinking.slice(-2048),
      tools: s.tools.slice(-10).map(tool => ({ ...tool, input: tool.input.slice(0, 8192), output: tool.output.slice(0, 8192),
        state: tool.state === 'running' ? 'unknown' as const : tool.state,
        truncated: tool.truncated || tool.input.length > 8192 || tool.output.length > 8192 })),
      truncated: s.truncated || s.droppedTools > 0 || s.tools.length > 10 || s.reasoning.length > 8192 || s.thinking.length > 2048,
    }].slice(-6);
  }
  private remember(key: string): void {
    this.terminal.add(key);
    if (this.terminal.size > 256) this.terminal.delete(this.terminal.values().next().value!);
  }
  private empty(): ActivityState { return { reasoning: '', thinking: '', tools: [], inputs: [], truncated: false, droppedTools: 0, recoveryGap: false, malformed: false }; }
  reset(): void { this.state = this.empty(); this.archive = []; this.terminal.clear(); this.turn = 0; }
  disconnect(): void {
    this.state = { ...this.state, recoveryGap: this.state.inputs.some((p) => ['pending','sending','unknown'].includes(p.status) && ['sudo','secret'].includes(p.kind)),
      inputs: this.state.inputs.map((p) => ['pending','sending'].includes(p.status) ? {...p, status:'unknown'} : p),
      tools: this.state.tools.map((t) => t.state === 'running' ? {...t, state:'unknown'} : t) };
  }
  private put(input: AgentInput): void {
    const old = this.state.inputs.find((p) => p.key === input.key);
    if (this.terminal.has(input.key) || (old && ['answered','expired','sending','unsupported'].includes(old.status))) return;
    if (old) {
      const identity = (p: AgentInput) => JSON.stringify([p.kind, p.prompt, p.command, p.envVar, p.choices, p.questions]);
      if (identity(old) !== identity(input)) {
        this.remember(old.key);
        this.state = { ...this.state, malformed: true, inputs: this.state.inputs.map(p => p.key === old.key ? { ...p, blocked: true, status: 'unknown' } : p) };
        return;
      }
      if (old.status === 'unknown' && ['sudo','secret'].includes(old.kind)) return;
      input.answered = [...new Set([...old.answered, ...input.answered])];
      input.blocked ||= old.blocked;
    }
    if (!old && this.state.inputs.length >= ACTIVITY_LIMITS.inputs) {
      const terminal = this.state.inputs.findIndex((p) => ['answered','expired'].includes(p.status));
      if (terminal < 0) { this.state = {...this.state, malformed:true}; return; }
      this.state.inputs = this.state.inputs.filter((_, i) => i !== terminal);
    }
    this.state = {...this.state, inputs: [...this.state.inputs.filter((p) => p.key !== input.key), input]};
  }
  receive(event: GatewayEvent): boolean {
    try {
      const parts = event.type.split('.');
      if (KINDS.includes(parts[0] as InputKind) && ['request','expire'].includes(parts[1] ?? '')) {
        const kind = parts[0] as InputKind, payload = record(event.payload);
        if (parts[1] === 'request') this.put(parseInput(kind, payload));
        else this.status(`${kind}:${id(payload.request_id)}`, 'expired');
        return true;
      }
      if (event.type === 'message.start') {
        this.archiveTurn();
        this.state.inputs.forEach(input => this.remember(input.key));
        this.state = this.empty(); return true;
      }
      if (['reasoning.delta','reasoning.available','thinking.delta'].includes(event.type)) {
        const p = record(event.payload), field = event.type === 'thinking.delta' ? 'thinking' : 'reasoning';
        const next = event.type === 'reasoning.available' ? text(p.text) : this.state[field] + text(p.text);
        this.state = {...this.state, [field]:next.slice(-ACTIVITY_LIMITS.text), truncated:this.state.truncated || next.length >= ACTIVITY_LIMITS.text}; return true;
      }
      if (['tool.start','tool.progress','tool.complete'].includes(event.type)) {
        const p = record(event.payload), toolId = id(p.tool_id);
        const old = this.state.tools.find((t) => t.id === toolId);
        if (old && ['complete','error'].includes(old.state) && event.type !== 'tool.complete') return true;
        const input = displayValue(p.args ?? p.args_text ?? old?.input ?? '', ACTIVITY_LIMITS.input);
        const output = event.type === 'tool.complete' ? displayValue(p.result ?? p.result_text ?? p.summary ?? '') : text(p.text ?? p.preview ?? old?.output);
        let value: unknown = p.result;
        if (typeof value === 'string' && value.length <= ACTIVITY_LIMITS.text && value.trimStart().startsWith('{')) {
          try { value = JSON.parse(value); } catch { /* unstructured tool output stays plain text */ }
        }
        const result = typeof value === 'object' && value !== null && !Array.isArray(value) ? record(value) : {};
        const failed = result.success === false || !!result.error || (typeof result.exit_code === 'number' && result.exit_code !== 0);
        const tool: ToolActivity = { id:toolId, name:text(p.name ?? old?.name ?? 'Tool',128), input, output,
          context:text(p.context ?? p.preview ?? old?.context,2048), state:event.type === 'tool.complete' ? failed?'error':'complete' : 'running',
          duration:typeof p.duration_s === 'number' && Number.isFinite(p.duration_s) && p.duration_s >= 0 ? p.duration_s : old?.duration,
          truncated:input.length >= ACTIVITY_LIMITS.input || output.length >= ACTIVITY_LIMITS.text || !!old?.truncated };
        let tools = this.state.tools.filter((t) => t.id !== toolId); tools.push(tool);
        const dropped = Math.max(0,tools.length - ACTIVITY_LIMITS.tools); tools = tools.slice(-ACTIVITY_LIMITS.tools);
        this.state = {...this.state, tools, droppedTools:this.state.droppedTools + dropped}; return true;
      }
      return false;
    } catch { this.state = {...this.state, malformed:true}; return true; }
  }
  snapshot(live: Record<string, unknown>): void {
    for (const kind of ['approval','clarify'] as const) {
      const value = live[`pending_${kind}`];
      if (value) { try {this.put(parseInput(kind,value));} catch {this.state = {...this.state,malformed:true};} }
      else this.state = {...this.state, inputs:this.state.inputs.map((p) => p.kind === kind && ['pending','unknown'].includes(p.status) ? {...p,status:'expired'} : p)};
    }
    if (live.running === false) {
      this.state = {...this.state, inputs:this.state.inputs.map((p) => ['pending','unknown'].includes(p.status)?{...p,status:'expired'}:p),
        tools:this.state.tools.map((t)=>t.state==='running'?{...t,state:'unknown'}:t)};
    }
    this.state.inputs.filter(input => ['answered','expired','unsupported'].includes(input.status)).forEach(input => this.remember(input.key));
  }
  status(key: string, status: InputStatus): void {
    if (['answered','expired','unsupported'].includes(status)) this.remember(key);
    this.state = {...this.state, inputs:this.state.inputs.map((p) => p.key === key ? {...p,status} : p)}; }
  result(key: string, raw: unknown, questionId?: string): void {
    const input = this.state.inputs.find((p) => p.key === key);
    if (!input || input.status !== 'sending') return;
    let result: Record<string, unknown>;
    try { result = record(raw); } catch { this.status(key, 'unknown'); throw new ClientError('protocol', 'Invalid interaction acknowledgement'); }
    if (result.status === 'expired' || (input.kind === 'approval' && (result.resolved === false || result.resolved === 0))) {this.status(key,'expired'); return;}
    if (input.kind === 'approval' ? result.resolved !== true && !(typeof result.resolved==='number' && result.resolved>0) : result.status !== 'ok') {
      this.status(key,'unknown'); throw new ClientError('protocol','Hermes did not confirm the interaction response');
    }
    if (input.kind === 'clarify' && questionId && result.remaining !== undefined && (!Array.isArray(result.remaining) || new Set(result.remaining).size !== result.remaining.length || result.remaining.includes(questionId) || input.answered.some(qid => (result.remaining as unknown[]).includes(qid)))) {
      this.status(key, 'unknown'); throw new ClientError('protocol', 'Invalid clarify acknowledgement');
    }
    if (input.kind === 'clarify' && questionId && Array.isArray(result.remaining) && result.remaining.length) {
      if (!result.remaining.every((v)=>typeof v==='string' && input.questions.some((q)=>q.id===v))) {
        this.status(key,'unknown'); throw new ClientError('protocol','Invalid clarify response');
      }
      const remaining = result.remaining;
      this.state = {...this.state, inputs:this.state.inputs.map((p)=>p.key===key?{...p,status:'pending',answered:p.questions.flatMap((q)=>q.id&&!remaining.includes(q.id)?[q.id]:[])}:p)};
    } else this.status(key,'answered');
  }
}

import { ClientError, record, type GatewayEvent } from './protocol.js';
import type { CommandResult } from './command-result.js';

type TaskOutcome = Extract<CommandResult, { kind: 'task' }>;
export interface CommandTask extends TaskOutcome { command: string; status: 'running' | 'complete'; output: string; truncated: boolean }
/** Selected-session ephemeral results. An acknowledgement is not completion; events may precede it. */
export class CommandTasks {
  state: readonly CommandTask[] = [];
  private launching?: { command: string; event: TaskOutcome['event'] };
  private early = new Map<string, { text: string; truncated: boolean }>();
  constructor(private readonly notify: () => void) {}
  clear(): void { this.launching = undefined; this.early.clear(); this.state = []; }
  prepare(command: string, category: string): void {
    if (['Skills', 'Plugin commands', 'User commands'].includes(category) || !['/bg', '/btw'].includes(command)) return;
    if (this.state.filter(task => task.status === 'running').length >= 8)
      throw new ClientError('protocol', 'Eight command tasks are already awaiting results. Nothing else was started.');
    this.launching = { command, event: command === '/bg' ? 'background.complete' : 'btw.complete' }; this.early.clear();
  }
  finish(result?: TaskOutcome): void {
    const launch = this.launching; this.launching = undefined;
    if (result && launch && result.event === launch.event) {
      const early = this.early.get(result.id);
      const kept = [...this.state];
      while (kept.length >= 16) {
        const index = kept.findIndex(task => task.status === 'complete'); if (index < 0) break;
        kept.splice(index, 1);
      }
      this.state = [...kept, { ...result, command: launch.command, status: early ? 'complete' : 'running', output: early?.text ?? '', truncated: early?.truncated ?? false }];
      this.notify();
    }
    this.early.clear();
  }
  receive(event: GatewayEvent): void {
    if (!['background.complete', 'btw.complete'].includes(event.type)) return;
    let payload: Record<string, unknown>;
    try { payload = record(event.payload); } catch { return; }
    if (typeof payload.task_id !== 'string' || typeof payload.text !== 'string' || payload.task_id.length > 128) return;
    const result = { text: payload.text.slice(0, 32768), truncated: payload.text.length > 32768 };
    const task = this.state.find(task => task.id === payload.task_id && task.event === event.type);
    if (task) {
      if (task.status === 'complete') return;
      this.state = this.state.map(row => row === task ? { ...row, status: 'complete', output: result.text, truncated: result.truncated } : row);
      this.notify();
    } else if (this.launching?.event === event.type && this.early.size < 8) this.early.set(payload.task_id, result);
  }
  dismiss(id: string): void {
    this.state = this.state.filter(task => task.id !== id || task.status !== 'complete'); this.notify();
  }
}

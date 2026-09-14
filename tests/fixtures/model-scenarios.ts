import { commandFixture } from './commands.js';
/** SYNTHETIC inventory/config fixture; live acceptance is separate. */
export class ModelScenarios {
  private sessions = new Map<string, { model: string; provider: string; reasoning_effort: string; profile_name: string; yolo: boolean }>();
  create(id: string, profile = 'default'): void {
    this.sessions.set(id, { model: profile === 'work' ? 'work-model' : 'fixture-alpha', provider: 'custom:fixture', reasoning_effort: profile === 'work' ? 'low' : 'medium', profile_name: profile, yolo: false });
  }
  info(id: string) { return this.sessions.get(id) ?? {}; }
  handle(method: string, params: Record<string, unknown>, reply: (data: unknown) => void,
    error: () => void, emit: (type: string, id?: string, payload?: unknown) => void): boolean {
    const id = String(params.session_id ?? ''), session = this.sessions.get(id);
    if (method === 'commands.catalog') {
      reply(commandFixture(String(params.profile ?? session?.profile_name ?? 'default'))); return true;
    }
    if (method === 'slash.exec') {
      if (!session || params.profile !== session.profile_name || !['/usage', '/status', '/history'].includes(String(params.command))) error();
      else reply({ output: `Native ${session.profile_name} ${String(params.command)}\nModel: ${session.model}\nThis is a synthetic native command readout.` });
      return true;
    }
    if (method === 'profiles.list') {
      reply({ profiles: [{ name: 'default', display_name: 'Default', path: '/private/default' }, { name: 'work', display_name: 'Work', path: '/private/work', description: 'A separate work profile' }] }); return true;
    }
    if (method === 'model.options') {
      reply({ model: session?.model ?? (params.profile === 'work' ? 'work-model' : 'fixture-alpha'), provider: 'custom:fixture', providers: [{ slug: 'custom:fixture', name: 'Fixture provider', authenticated: true,
        models: ['fixture-alpha', 'fixture-beta', 'fixture-premium', 'fixture-plain', 'work-model'],
        capabilities: Object.fromEntries(['fixture-alpha', 'fixture-beta', 'fixture-premium', 'work-model'].map(model => [model, { reasoning: true, can_disable_reasoning: model !== 'fixture-premium' }]).concat([['fixture-plain', { reasoning: false, can_disable_reasoning: false }]])),
      }] }); return true;
    }
    if (method === 'config.get' && params.key === 'reasoning') { reply({ value: session?.reasoning_effort ?? 'medium', display: 'show' }); return true; }
    if (method !== 'config.set') return false;
    if (!session || params.profile !== session.profile_name) { error(); return true; }
    if (params.key === 'model') {
      const match = /^(fixture-(?:alpha|beta|premium|plain)|work-model) --provider custom:fixture --session$/.exec(String(params.value));
      if (!match) { error(); return true; }
      if (match[1] === 'fixture-premium' && params.confirm_expensive_model !== true) {
        reply({ key: 'model', value: match[1], scope: 'session', confirm_required: true, confirm_message: 'This model has additional usage cost. Confirm before continuing.' }); return true;
      }
      session.model = match[1]!;
      emit('session.info', id, this.info(id)); reply({ key: 'model', value: session.model, scope: 'session', warning: '', confirm_required: false }); return true;
    }
    if (params.key === 'reasoning' && params.scope === 'session') {
      session.reasoning_effort = String(params.value);
      emit('session.info', id, this.info(id)); reply({ key: 'reasoning', value: params.value }); return true;
    }
    if (params.key === 'yolo' && params.scope === 'session' && ['0', '1'].includes(String(params.value))) {
      session.yolo = String(params.value) === '1';
      emit('session.info', id, this.info(id)); reply({ key: 'yolo', value: session.yolo ? '1' : '0', scope: 'session' }); return true;
    }
    error(); return true;
  }
}

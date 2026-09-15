import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { Brain, Check, ChevronDown, Cpu, Layers3, LoaderCircle, RefreshCw, Search, Zap } from 'lucide-react';
import { AgentCatalogue } from '../src/hermes/agent-catalogue.js';
import { EFFORTS, type Effort } from '../src/hermes/model-catalog.js';
import type { AppRuntime } from './runtime.js';
import { Modal, Notice } from './primitives.js';
import './agent-controls.css';
const effortLabel = (value?: string) => value === 'provider-default' ? 'Provider default' : value === 'none' ? 'Off' : value ? value[0]!.toUpperCase() + value.slice(1) : 'Not reported';

export function AgentControls({ runtime: rt }: { runtime: AppRuntime }) {
  const catalogue = useMemo(() => new AgentCatalogue(rt.gateway, (name, state) => rt.connection.capabilities.observeNative(name, state)), [rt]);
  useSyncExternalStore(catalogue.subscribe, catalogue.getSnapshot);
  const [panel, setPanel] = useState<'models' | 'profiles' | 'reasoning' | null>(null);
  const [query, setQuery] = useState(''), [limit, setLimit] = useState(80);
  const native = rt.chat.native, state = native.state, settings = native.settings.state;
  const generation = rt.gateway.state.generation, profile = state.profile ?? rt.chat.selected?.profile;
  const context = { runtimeId: state.runtimeId, profile };
  useEffect(() => {
    if (rt.ready) void catalogue.load(context); else catalogue.clear();
    return () => catalogue.clear();
  }, [catalogue, native, generation, profile, state.runtimeId, state.agent?.model, state.agent?.provider, rt.ready]);
  useEffect(() => () => catalogue.dispose(), [catalogue]);
  useEffect(() => { setPanel(null); setQuery(''); setLimit(80); }, [native, generation, rt.accountGeneration]);
  useEffect(() => { if (settings.confirmation) setPanel('models'); }, [settings.confirmation]);
  const intent = native.commands.state.action;
  useEffect(() => {
    if (intent && ['models', 'profiles', 'reasoning'].includes(intent.kind)) {
      setQuery(''); setLimit(80); setPanel(intent.kind as 'models' | 'profiles' | 'reasoning');
      native.commands.dismissAction();
    }
  }, [native, intent]);
  const data = catalogue.state;
  const model = state.agent?.model ?? data.models?.model;
  const provider = data.models?.provider ?? state.agent?.provider;
  const selected = data.models?.choices.find(row => row.model === model && row.provider === provider);
  const effort = state.agent?.reasoningEffort ?? data.effort;
  const yolo = state.agent?.yolo === true;
  const locked = !rt.ready || rt.chat.busy || rt.chat.historical || native.commands.blocked || settings.busy || ['attaching', 'running', 'waiting', 'unknown', 'error'].includes(state.phase);
  const blocked = locked || settings.outcome === 'unknown';
  const open = (next: typeof panel) => { setQuery(''); setLimit(80); setPanel(next); };
  const close = () => { native.settings.cancelConfirmation(); setPanel(null); };
  const matches = (data.models?.choices ?? []).filter(row => `${row.model} ${row.providerName}`.toLowerCase().includes(query.toLowerCase()));
  const refresh = () => { void catalogue.load(context, true); };
  return <div className="agent-controls">
    <button type="button" className="agent-chip" aria-label={`Profile: ${profile || 'default'}`} title="Start a conversation with another profile" disabled={locked} onClick={() => open('profiles')}><Layers3 size={14}/><span>{profile || 'default'}</span><ChevronDown size={12}/></button>
    <button type="button" className="agent-chip model-chip" aria-label={`Model: ${model || 'not reported'}`} title={model ? `${model}${provider ? ` · ${provider}` : ''}` : 'Choose a configured Hermes model'} disabled={locked} onClick={() => open('models')}><Cpu size={14}/><span>{model || (data.loading ? 'Loading model…' : 'Choose model')}</span><ChevronDown size={12}/></button>
    <button type="button" className="agent-chip" aria-label={`Reasoning: ${effortLabel(effort)}`} title="Reasoning effort for this conversation" disabled={locked} onClick={() => open('reasoning')}><Brain size={14}/><span>{effortLabel(effort)}</span><ChevronDown size={12}/></button>
    <button type="button" role="switch" aria-checked={yolo} aria-label="YOLO mode for this conversation" className={`yolo-toggle${yolo ? ' yolo-active' : ''}`} title="YOLO mode bypasses routine approval prompts for this conversation. Explicit deny rules and Hermes hardline blocks still apply." disabled={blocked} onClick={() => rt.run(() => rt.changeYolo(!yolo))}>
      <Zap size={14}/><span>YOLO</span><span className="yolo-slider" aria-hidden="true"/>
    </button>
    {settings.busy && <span className="settings-working" role="status"><LoaderCircle size={14} className="spin"/>Applying…</span>}
    {settings.note && <span className={`settings-note${settings.outcome === 'unknown' || settings.outcome === 'rejected' ? ' settings-warning' : ''}`} role="status">{settings.note}{settings.outcome === 'unknown' && <button type="button" onClick={() => rt.run(() => native.settings.recover())} disabled={locked}>Read current settings</button>}</span>}
    {panel && createPortal(<Modal title={panel === 'models' ? 'Choose model' : panel === 'profiles' ? 'Choose profile' : 'Reasoning effort'} kind="agent" onClose={close}>
      <div className="agent-picker-body">
        {panel === 'models' && <>
          <p className="muted">Only this conversation changes. Your saved profile default stays unchanged.</p>
          {settings.confirmation ? <div className="model-confirmation"><h3>Confirm model change</h3><strong>{settings.confirmation.model}</strong><Notice>{settings.confirmation.message}</Notice><div className="button-row"><button type="button" className="secondary" disabled={locked} onClick={() => native.settings.cancelConfirmation()}>Cancel change</button><button type="button" className="primary" disabled={blocked} onClick={() => rt.run(() => native.settings.confirmModel())}>Confirm model change</button></div></div> : <>
            <label className="agent-search"><Search size={17}/><input data-initial-focus aria-label="Search models" type="search" placeholder="Search configured models…" value={query} onChange={event => { setQuery(event.target.value); setLimit(80); }}/></label>
            <div className="picker-summary"><span>{model ? `Current: ${model}` : 'Current model not reported'}{provider ? ` · ${provider}` : ''}</span><button type="button" className="text-button" disabled={data.loading || locked} onClick={refresh}><RefreshCw size={15}/>Refresh models</button></div>
            {data.loading && <p role="status">Reading Hermes model inventory…</p>}
            {data.modelError && <Notice error>{data.modelError}</Notice>}
            {!data.loading && !data.modelError && !matches.length && <p>No matching configured models. Configure providers in Hermes, then refresh.</p>}
            <div className="agent-option-list">{matches.slice(0, limit).map(row => <button type="button" className="agent-option" key={`${row.provider}/${row.model}`} aria-label={`Use ${row.model} from ${row.providerName}`} aria-pressed={row.model === model && row.provider === provider} disabled={blocked || row.authenticated === false} onClick={() => rt.run(() => rt.changeModel(row))}>
              <span className="option-icon"><Cpu size={18}/></span><span className="option-copy"><strong>{row.model}</strong><small>{row.providerName}{row.authenticated === false ? ' · credentials required' : row.reasoning === true ? ' · reasoning' : ''}</small></span>{row.model === model && row.provider === provider && <Check size={17}/>}</button>)}</div>
            {matches.length > limit && <button type="button" className="secondary" onClick={() => setLimit(limit + 80)}>Show more models ({matches.length - limit} remaining)</button>}
          </>}
        </>}
        {panel === 'profiles' && <>
          <p className="muted">Start a new conversation with a profile configured in Hermes. Existing history and drafts stay with their original profile.</p>
          {data.loading && <p role="status">Reading profiles…</p>}{data.profileError && <Notice error>{data.profileError}</Notice>}
          <div className="agent-option-list">{data.profiles.map(row => <button type="button" className="agent-option" key={row.name} aria-label={`New conversation with ${row.label}`} disabled={blocked} onClick={() => { setPanel(null); rt.run(() => rt.newProfile(row.name)); }}><span className="option-icon"><Layers3 size={18}/></span><span className="option-copy"><strong>{row.label}</strong><small>{row.description || row.name}</small></span>{row.name === (profile || 'default') && <span className="small muted">Current</span>}</button>)}</div>
          {!data.loading && !data.profileError && !data.profiles.length && <p>No profiles were returned by Hermes.</p>}
        </>}
        {panel === 'reasoning' && <>
          <p className="muted">Adjust how much reasoning effort Hermes requests for this conversation. This does not hide or reveal reasoning text.</p>
          <p className="small muted">Avoid deleting this conversation in another client while applying an effort. On the tested Hermes version, a vanished runtime can make the setter fall back to the profile default.</p>
          <p className="picker-current">Current effort: <strong>{effortLabel(effort)}</strong></p>
          {data.loading && <p role="status">Checking model capabilities…</p>}
          {selected?.reasoning !== true ? <Notice>{selected?.reasoning === false ? 'This model does not advertise adjustable reasoning.' : 'Reasoning capability has not been confirmed for this model. Refresh the model inventory or select another configured model.'}</Notice> : <>
            <div className="effort-options">{EFFORTS.filter(value => value !== 'none' || selected.canDisableReasoning !== false).map(value => <button type="button" className="agent-option" key={value} aria-label={`Set reasoning ${value}`} aria-pressed={value === effort} disabled={blocked} onClick={() => rt.run(() => rt.changeReasoning(value as Effort))}><span>{effortLabel(value)}</span>{value === effort && <Check size={17}/>}</button>)}</div>
            <p className="small muted">These are Hermes effort levels, not a guarantee of provider support. Higher levels can increase latency and cost.</p>
          </>}
        </>}
        {settings.note && <Notice error={settings.outcome === 'unknown' || settings.outcome === 'rejected'}>{settings.note}{settings.outcome === 'unknown' && <button type="button" disabled={locked} onClick={() => rt.run(() => native.settings.recover())}>Read current settings</button>}</Notice>}
        {settings.busy && <p role="status">Waiting for Hermes to confirm the setting…</p>}
        <div className="agent-picker-footer"><span className="small muted">{locked ? 'Controls unlock when the native conversation is idle.' : 'Session-scoped · no global configuration writes requested'}</span><button type="button" className="secondary" onClick={close}>Done</button></div>
      </div>
    </Modal>, document.body)}
  </div>;
}

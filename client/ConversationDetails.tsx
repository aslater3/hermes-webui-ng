import { RefreshCw, X } from 'lucide-react';
import type { AppRuntime } from './runtime.js';
import { IconButton } from './primitives.js';
import './conversation-details.css';

/** Read-only details of the selected upstream projection, never a second configuration store. */
export function ConversationDetails({ runtime: rt, onClose, pane = false }: { runtime: AppRuntime; onClose: () => void; pane?: boolean }) {
  const state = rt.chat.native.state;
  const inputs = rt.chat.native.activity.state.inputs.filter(input => ['pending', 'sending'].includes(input.status)).length;
  return <aside className="conversation-details" aria-label="Conversation details">
    {pane && <header><h2>Conversation details</h2><IconButton label="Close conversation details" onClick={onClose}><X size={18}/></IconButton></header>}
    <div className="details-content"><p className="eyebrow">NATIVE HERMES SESSION</p><dl className="connection-facts">
      <div><dt>Profile</dt><dd>{state.profile || rt.chat.selected?.profile || 'default'}</dd></div>
      <div><dt>Model</dt><dd>{state.agent?.model || 'Not reported'}</dd></div>
      <div><dt>Provider</dt><dd>{state.agent?.provider || 'Not reported'}</dd></div>
      <div><dt>Reasoning effort</dt><dd>{state.agent?.reasoningEffort || 'Not reported'}</dd></div>
      <div><dt>Run state</dt><dd>{state.phase}</dd></div>
      <div><dt>Waiting inputs</dt><dd>{inputs}</dd></div>
      <div><dt>Gateway</dt><dd>{rt.gateway.state.phase}</dd></div>
      <div><dt>View</dt><dd>{rt.chat.historical ? 'Earlier history · read-only' : 'Latest conversation'}</dd></div>
    </dl>
    <button className="secondary" disabled={!rt.ready || rt.chat.busy || !state.runtimeId || rt.pwa.state.updating} onClick={() => rt.run(() => rt.chat.latest())}><RefreshCw size={16}/>Refresh native state</button>
    <p className="small muted">These values are reported by Hermes. Use the composer controls to request a model or reasoning change.</p>
    {!rt.ready && <p className="small muted" role="status">Disconnected. Previously displayed values may be stale.</p>}
    <div className="settings-divider"/><p className="small muted">Workspace files and Git are a later phase. No filesystem is mounted or exposed by this pane.</p></div>
  </aside>;
}

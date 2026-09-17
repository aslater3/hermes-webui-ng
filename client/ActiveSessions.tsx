import { useState } from 'react';
import { CircleAlert, CircleDot, LoaderCircle, Check, RefreshCw } from 'lucide-react';
import type { AppRuntime } from './runtime.js';
import { subagentSummary } from '../src/hermes/subagent-catalog.js';
import './active-sessions.css';

/** Nested child agents. Only parents whose events this client received have children; nothing is inferred. */
function Subagents({ runtime: rt, parentId }: { runtime: AppRuntime; parentId: string }) {
  const children = rt.attention.subagents(parentId);
  if (!children.length) return null;
  const shown = children.slice(0, 4);
  // `list-style: none` removes the implicit list role, so the child list states it explicitly for assistive tech.
  return <ul className="active-subagents" role="list" aria-label="Subagents">
    {shown.map(child => {
      const busy = child.status === 'working' || child.status === 'starting';
      const attention = child.status === 'waiting' || child.status === 'failed';
      return <li key={child.subagentId} className="active-subagent" data-status={child.status}>
        {busy ? <LoaderCircle className="active-session-spinner" size={14} aria-hidden="true"/>
          : attention ? <CircleAlert size={14} aria-hidden="true"/>
          : child.status === 'completed' ? <Check size={14} aria-hidden="true"/>
          : <CircleDot size={14} aria-hidden="true"/>}
        <span><strong>{child.goal || 'Subagent'}</strong><small><code>{child.subagentId}</code> · {subagentSummary(child)}</small></span>
      </li>;
    })}
    {children.length > shown.length && <li className="active-subagent-more">+{children.length - shown.length} more subagents</li>}
  </ul>;
}

export function ActiveSessions({ runtime: rt, onChoose }: { runtime: AppRuntime; onChoose: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const items = rt.attention.items.filter(item => ['waiting', 'working', 'starting'].includes(item.status) || item.review);
  const waiting = items.filter(item => item.status === 'waiting').length;
  if (!items.length) return null;
  return <section className="active-sessions" aria-label="Active agent sessions">
    <div className="active-session-heading"><h2>Active sessions{waiting > 0 && <span aria-label={`${waiting} need input`}>{waiting}</span>}</h2>
      <button type="button" aria-label="Refresh active sessions" title="Refresh active sessions" disabled={!rt.ready} onClick={() => rt.run(() => rt.attention.refresh())}><RefreshCw size={14} aria-hidden="true"/></button></div>
    <ul>{items.slice(0, expanded ? 100 : 6).map(item => {
      const needsInput = item.status === 'waiting';
      const working = ['working', 'starting'].includes(item.status);
      const newActivity = !!item.review && !needsInput && !working && item.status !== 'unknown';
      return <li key={item.runtimeId}><button type="button" className="active-session-row" data-attention={needsInput ? 'required' : newActivity ? 'new' : undefined} aria-label={`Open active session: ${item.title || 'Native conversation'}`} disabled={!rt.ready || rt.chat.busy} onClick={() => { rt.openLive(item.runtimeId, item.storedId, item.owner?.profile); onChoose(); }}>
        {needsInput ? <CircleAlert size={16} aria-hidden="true"/> : working ? <LoaderCircle className="active-session-spinner" size={16} aria-hidden="true"/> : <Check size={16} aria-hidden="true"/>}
        <span><strong>{item.title || 'Native conversation'}</strong><small>{needsInput ? 'Needs your input' : item.status === 'working' ? 'Working…' : item.status === 'starting' ? 'Starting…' : item.status === 'unknown' ? 'Reconnect to check status' : 'New activity'}</small></span>
      </button><Subagents runtime={rt} parentId={item.runtimeId}/></li>;
    })}</ul>
    {items.length > 6 && <button type="button" className="active-more" onClick={() => setExpanded(!expanded)}>{expanded ? 'Show fewer active sessions' : `Show all ${items.length} active sessions`}</button>}
  </section>;
}

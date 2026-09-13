import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, MessageSquare, Plus, Search, RefreshCw, PanelLeftClose, Settings2, Command } from 'lucide-react';
import type { AppRuntime } from './runtime.js';
import { Brand, IconButton } from './primitives.js';
import { dateGroup } from './preferences.js';
import { draftKey } from '../src/hermes/chat-controller.js';

export function Sidebar({ runtime: rt, onChoose, onSettings, onCommands, onCollapse, compact = false }: {
  runtime: AppRuntime; onChoose: () => void; onSettings: () => void; onCommands: () => void; onCollapse?: () => void; compact?: boolean;
}) {
  const index = rt.chat.browser.index, [query, setQuery] = useState(index.query);
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => { setQuery(index.query); }, [rt.accountGeneration, index.query]);
  useEffect(() => {
    if (!rt.readable || query.trim() === index.query) return;
    const timer = setTimeout(() => rt.run(() => rt.chat.browser.list(query.trim())), 300);
    return () => clearTimeout(timer);
  }, [query, rt.readable, rt, index.query]);
  let previous = '';
  return <aside className={`sidebar${compact ? ' sidebar-compact' : ''}`} aria-label="Conversations">
    <div className="sidebar-brand"><Brand compact={compact}/>{onCollapse && <IconButton label={compact ? 'Expand sidebar' : 'Collapse sidebar'} onClick={onCollapse}><PanelLeftClose size={18}/></IconButton>}</div>
    <div className="sidebar-primary"><button className="new-chat" aria-label="New conversation" disabled={!rt.ready || rt.chat.busy} onClick={() => { rt.newChat(); onChoose(); }}><Plus size={18}/>{!compact && <><span>New conversation</span><kbd>⇧ ⌘ O</kbd></>}</button></div>
    {compact ? <div className="rail-actions"><IconButton label="Search conversations" onClick={onChoose}><Search size={18}/></IconButton><IconButton label="Open command palette" onClick={onCommands}><Command size={18}/></IconButton></div> : <>
      <form className="sidebar-search" role="search" onSubmit={event => { event.preventDefault(); rt.run(() => rt.chat.browser.list(query.trim())); }}><Search size={16}/><input ref={search} id="shell-session-search" type="search" aria-label="Search conversations" placeholder="Search conversations…" value={query} disabled={!rt.readable} maxLength={512} onChange={event => setQuery(event.target.value)}/></form>
      <div className="sidebar-list" aria-busy={index.phase === 'loading'}>
        {index.phase === 'loading' && !index.rows.length && <div className="list-loading" role="status">Loading conversations…<i/><i/><i/></div>}
        {index.phase === 'error' && <div className="sidebar-notice" role="status">Could not load conversations. <button onClick={() => rt.run(() => rt.chat.browser.refresh())}>Retry</button></div>}
        {index.phase === 'ready' && !index.rows.length && <div className="empty-list"><MessageSquare size={22}/><p>{query ? 'No matching conversations' : 'A fresh start'}</p><span>{query ? 'Try a different search.' : 'Your conversations will appear here.'}</span></div>}
        <ul aria-label="Saved conversations">{index.rows.map(row => {
          const group = index.query ? 'Search results' : dateGroup(row.lastActive), heading = group !== previous; previous = group;
          const selected = draftKey(row) === draftKey(rt.chat.selected), state = rt.chat.native.state;
          const waiting = selected && (state.phase === 'waiting' || rt.chat.native.activity.state.inputs.some(input => input.status === 'pending'));
          return <li key={draftKey(row)}>{heading && <h2 className="list-group">{group}</h2>}<button className={`session-row${selected ? ' selected' : ''}`} aria-current={selected ? 'page' : undefined}
            aria-label={`Open conversation: ${row.title || row.preview || 'Untitled conversation'}`} disabled={!rt.readable || rt.chat.busy} onClick={() => { rt.open(row); onChoose(); }}>
            <MessageSquare size={16}/><span className="row-copy"><span className="row-title">{row.title || row.preview || 'Untitled conversation'}</span>{waiting ? <span className="row-state">Needs your input</span> : selected && state.phase === 'running' ? <span className="row-state">Working…</span> : <span className="row-meta">{row.profile || 'default'} · {row.messageCount} messages</span>}</span></button></li>;
        })}</ul>
      </div>
      <div className="sidebar-pagination"><span>{index.query ? `${index.rows.length} results` : index.total ? `${index.offset + 1}–${index.offset + index.rows.length} of ${index.total}` : 'Conversations'}</span>
        <IconButton label="Previous conversations" disabled={!rt.readable || !index.offset || !!index.query || index.phase === 'loading'} onClick={() => rt.run(() => rt.chat.browser.list('', Math.max(0, index.offset - 20)))}><ArrowLeft size={15}/></IconButton>
        <IconButton label="Next conversations" disabled={!rt.readable || !index.hasNext || index.phase === 'loading'} onClick={() => rt.run(() => rt.chat.browser.list('', index.offset + 20))}><ArrowRight size={15}/></IconButton>
        <IconButton label="Refresh conversations" disabled={!rt.readable} onClick={() => rt.run(() => rt.chat.browser.refresh())}><RefreshCw size={14}/></IconButton></div>
    </>}
    <div className="sidebar-footer"><button className="account-button" onClick={onSettings} aria-label="Open settings"><span className="account-avatar">H</span>{!compact && <span><strong>Hermes Agent</strong><small>Connection & appearance</small></span>}{!compact && <Settings2 size={17}/>}</button></div>
  </aside>;
}

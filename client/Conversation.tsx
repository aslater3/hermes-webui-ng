import { NativeQuestions } from './NativeQuestions.js';
import { CommandTaskResults } from './CommandTaskResults.js';
import { useCommands } from './Commands.js';
import './m3-activity.css';
import { HermesMark } from './HermesMark.js';
import { UsageButton } from './SessionUsage.js';
import { AgentControls } from './AgentControls.js';
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ArrowDown, ArrowUp, ArrowUpRight, Code2, Compass, ListChecks, LoaderCircle, Square, Wrench } from 'lucide-react';
import type { AppRuntime } from './runtime.js';
import type { NativeSession } from '../src/hermes/native-session.js';
import { AgentView } from '../src/hermes/agent-view.js';
import { draftKey } from '../src/hermes/chat-controller.js';
import { enterSends } from '../src/hermes/chat-behaviour.js';
import { Notice } from './primitives.js';
import { HistoryMessage as Message } from './HistoryMessage.js';

function Activity({ owner, enabled, historical, revision }: { owner: NativeSession; enabled: boolean; historical: boolean; revision: number }) {
  const root = useRef<HTMLElement>(null), view = useRef<AgentView | null>(null);
  useLayoutEffect(() => { const renderer = new AgentView(root.current!); view.current = renderer; return () => { renderer.dispose(); root.current?.replaceChildren(); view.current = null; }; }, []);
  useLayoutEffect(() => { view.current?.update(owner, enabled, historical); }, [owner, enabled, historical, revision]);
  return <section className="agent-activity" ref={root}/>;
}
const starters = [
  { icon: Code2, title: 'Build something', subtitle: 'From a rough idea to working code', draft: 'Help me build ' },
  { icon: Wrench, title: 'Work through a problem', subtitle: 'Find the cause, not just a workaround', draft: 'Help me troubleshoot ' },
  { icon: Compass, title: 'Explore an idea', subtitle: 'Make sense of something new', draft: 'Help me understand ' },
  { icon: ListChecks, title: 'Make a plan', subtitle: 'Turn the next big thing into steps', draft: 'Help me plan ' },
];
export function Conversation({ runtime: rt, revision }: { runtime: AppRuntime; revision: number }) {
  const { chat } = rt, state = chat.native.state, saved = chat.browser.history;
  const historical = chat.historical, snapshot = historical || (!state.runtimeId && !!saved.page);
  const messages = snapshot ? saved.page?.messages ?? [] : state.messages;
  const streaming = snapshot ? '' : state.streaming;
  const scroller = useRef<HTMLDivElement>(null), content = useRef<HTMLDivElement>(null), composer = useRef<HTMLTextAreaElement>(null);
  const following = useRef(true), [unread, setUnread] = useState(false), [draft, setDraft] = useState(chat.draft);
  const scope = `${draftKey(chat.selected)}:${historical ? saved.page?.offset ?? 0 : 'live'}`;
  const busy = ['running', 'waiting'].includes(state.phase), loading = chat.busy || state.phase === 'attaching';
  const peerRows = useSyncExternalStore(rt.gateway.requests.subscribe, rt.gateway.requests.getSnapshot).filter(row => row.sessionId === state.runtimeId);
  const writable = !peerRows.length && rt.ready && !chat.native.commands.blocked && !chat.native.settings.state.busy && chat.native.settings.state.outcome !== 'unknown' && !chat.native.settings.state.confirmation && !loading && !historical && (!chat.selected || state.phase === 'idle');
  const commands = useCommands(rt, draft, value => { setDraft(value); rt.setDraft(value); }, composer, writable);
  const selectedOwner = chat.native;
  const peerCurrent = () => rt.ready && rt.chat.native === selectedOwner && document.visibilityState === 'visible';
  const pending = peerRows.length + chat.native.activity.state.inputs.filter(input => ['pending', 'sending'].includes(input.status)).length;
  const error = chat.error?.message || (!chat.readOnly ? state.error?.message : '') || saved.error?.message;
  const empty = !messages.length && !streaming && !busy && !loading && !error;
  useEffect(() => { setDraft(chat.draft); }, [chat.draft, scope, rt.accountGeneration]);
  useLayoutEffect(() => { following.current = true; setUnread(false); }, [scope]);
  const jump = () => { following.current = true; setUnread(false); if (scroller.current) { scroller.current.dataset.following = 'true'; scroller.current.scrollTop = scroller.current.scrollHeight; } };
  useLayoutEffect(() => {
    if (following.current) jump(); else setUnread(true);
  }, [messages, streaming, state.phase, chat.native.activity.state]);
  useEffect(() => {
    if (!content.current || !scroller.current) return;
    const observer = new ResizeObserver(() => { if (following.current && scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight; });
    observer.observe(content.current); observer.observe(scroller.current); return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const field = composer.current; if (!field) return;
    field.style.height = 'auto'; field.style.height = `${Math.min(field.scrollHeight, Math.max(70, Math.min(200, innerHeight * 0.25)))}px`;
  }, [draft]);
  const send = () => { rt.setDraft(draft); jump(); rt.send(); };
  const useStarter = (value: string) => { setDraft(value); rt.setDraft(value); if (matchMedia('(pointer:fine)').matches) composer.current?.focus(); };
  const activityAt = messages.reduce((last, message, index) => message.role === 'user' ? index + 1 : last, messages.length);
  const olderAvailable = !!chat.selected && !busy && !loading && (historical ? saved.page?.returned === 100 : (state.totalMessages ?? saved.page?.returned ?? 0) >= 100);
  return <>
    <div className="conversation-scroll" id="conversation-scroll" data-following="true" ref={scroller} aria-label="Conversation" tabIndex={0} onScroll={() => {
      const node = scroller.current!; following.current = node.scrollHeight - node.scrollTop - node.clientHeight < 70;
      node.dataset.following = String(following.current); if (following.current) setUnread(false);
    }}><div ref={content} className={`conversation-content${empty ? ' is-empty' : ''}`}>
      {olderAvailable && <button className="history-button" onClick={() => rt.run(() => chat.historyPage((historical ? saved.page?.offset ?? 0 : 0) + 100))}>Load earlier messages</button>}
      {historical && (chat.readOnly ? <Notice>This conversation has ended. Its saved history is read-only.</Notice> : <Notice>Earlier messages · read-only <button onClick={() => rt.run(() => chat.latest())}>Return to latest</button></Notice>)}
      {error && <Notice error>{error}<button onClick={() => rt.run(() => chat.latest())}>Refresh conversation</button></Notice>}
      {state.deliveryUnknown && <Notice>Delivery was not confirmed. Check the recovered conversation before resending. Nothing has been replayed.</Notice>}
      {empty && <div className="welcome"><div className="welcome-mark"><HermesMark size={30}/></div><p className="eyebrow">A SPACE FOR YOUR NEXT IDEA</p><h1>What are we working on?</h1><p>Think it through. Build it out. Make it happen with Hermes.</p><div className="welcome-suggestions">{starters.map(({ icon: Icon, title, subtitle, draft }) => <button key={title} onClick={() => useStarter(draft)} disabled={!writable} title={`Use “${title}” as a draft`}><Icon size={19}/><span><strong>{title}</strong><small>{subtitle}</small></span><ArrowUpRight size={15}/></button>)}</div></div>}
      {loading && <div className="loading-conversation" role="status"><LoaderCircle size={19} className="spin"/>Opening your conversation…</div>}
      {messages.slice(0, activityAt).map((message, index) => <Message key={`${scope}:${index}`} {...message}/>)}
      <CommandTaskResults commands={chat.native.commands}/>
      <NativeQuestions rows={peerRows} requests={rt.gateway.requests} current={peerCurrent} onError={error => { rt.error = error; rt.notify(); }}/>
      <Activity owner={chat.native} enabled={rt.ready && !loading} historical={snapshot} revision={revision}/>
      {messages.slice(activityAt).map((message, index) => <Message key={`${scope}:${activityAt + index}`} {...message}/>)}
      {streaming && <div className="message message-assistant streaming"><div className="message-label"><span className="assistant-mark"><HermesMark size={15}/></span>Hermes <span className="working-label">Working</span></div><pre className="plain-message">{streaming}<span className="stream-cursor"/></pre></div>}
      {busy && !streaming && !pending && <div className="thinking-indicator" role="status"><span/><span/><span/>Hermes is working</div>}
      {state.phase === 'waiting' && !pending && <Notice>Hermes is waiting for input, but no recoverable request is available. Use Stop response to cancel this turn, then ask again for a fresh request.</Notice>}
      <span className="sr-only" role="status" aria-live="polite">{state.phase === 'idle' && messages.length ? 'Response complete.' : pending ? 'Hermes needs your input.' : ''}</span>
    </div></div>
    <div className="composer-dock">
      {unread && <button className="jump-latest" onClick={jump}><ArrowDown size={15}/>Jump to latest</button>}
      {pending > 0 && <button className="attention-strip" onClick={() => { following.current = false; content.current?.querySelector('[data-native-requests], .agent-requests')?.scrollIntoView({ block: 'center', behavior: 'instant' }); }}><span className="attention-dot"/>{pending} request{pending === 1 ? '' : 's'} need your input<ArrowUpRight size={15}/></button>}
      <form className="composer" id="shell-composer" onSubmit={event => { event.preventDefault(); send(); }}>
        {commands.popup}
        <label className="sr-only" htmlFor="shell-prompt">Message Hermes</label>
        <textarea id="shell-prompt" ref={composer} {...commands.aria} rows={2} placeholder={chat.readOnly ? 'This conversation has ended and is read-only' : historical ? 'Return to latest to continue this conversation' : !rt.ready ? 'Connect to Hermes to send a message' : 'Message Hermes…'} value={draft} maxLength={32768} disabled={!writable} onChange={event => { setDraft(event.target.value); rt.chat.setDraft(event.target.value); }}
          onKeyDown={event => { if (commands.keyDown(event)) return; if (enterSends(event.nativeEvent, navigator.maxTouchPoints > 0 || matchMedia('(pointer:coarse)').matches)) { event.preventDefault(); send(); } }}/>
        <div className="composer-toolbar"><AgentControls runtime={rt}/>
          <div className="composer-right">{draft.length > 30000 && <span className="small muted">{draft.length.toLocaleString()} / 32,768</span>}{busy ? <button type="button" className="send-button stop-button" aria-label="Stop response" title="Stop response" disabled={!rt.ready || !!state.submitting || !!state.interrupting} onClick={() => rt.run(() => chat.interrupt())}>{state.interrupting ? <LoaderCircle size={18} className="spin"/> : <Square size={15} fill="currentColor"/>}</button> : <button type="submit" className="send-button" aria-label="Send message" title="Send message" disabled={!writable || !draft.trim()}><ArrowUp size={20}/></button>}</div>
        </div>
      </form><div className="composer-caption"><span className="composer-privacy">Your conversations stay in Hermes.</span>{commands.button}{!historical && rt.ready && state.runtimeId && <UsageButton key={`${rt.accountGeneration}:${scope}:${state.runtimeId}`} usage={state.usage}/>}<span className="desktop-hint">Enter to send · Shift + Enter for a new line</span></div>
    </div>
    {commands.overlay}
  </>;
}

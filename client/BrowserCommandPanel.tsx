import { useEffect, useRef, useState } from 'react';
import { browserCommand, copyAssistantResponse } from '../src/hermes/browser-commands.js';
import { slashInput } from '../src/hermes/command-catalog.js';
import { SessionBrowser } from '../src/hermes/session-browser.js';
import { ClientError } from '../src/hermes/protocol.js';
import type { CommandsState } from '../src/hermes/native-commands.js';
import type { AppRuntime } from './runtime.js';
import { createCommandConversation } from './browser-command-actions.js';
import { Notice } from './primitives.js';

type Intent = NonNullable<CommandsState['action']>;
/** Explicit browser gestures for client-owned commands. Private buffers are scoped to one modal/owner. */
export function BrowserCommandPanel({ runtime: rt, intent, onClose, setDraft }: {
  runtime: AppRuntime; intent: Intent; onClose: () => void; setDraft: (text: string) => void;
}) {
  const input = slashInput(intent.query)!;
  const command = browserCommand(input.name, input.argument);
  const [text, setText] = useState(command.kind === 'compose' ? command.text || (intent.source === 'catalogue' ? rt.chat.draft : '') : '');
  const [query, setQuery] = useState(command.kind === 'sessions' ? command.query : '');
  const [copied, setCopied] = useState(false), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [response, setResponse] = useState<{ text: string; ordinal: number }>();
  const [browser] = useState(() => new SessionBrowser(rt.dashboard));
  const [index, setIndex] = useState(browser.index);
  const owner = useRef({ native: rt.chat.native, account: rt.accountGeneration, generation: rt.gateway.state.generation });
  const mounted = useRef(true), inFlight = useRef(false);
  const current = () => mounted.current && rt.ready && document.visibilityState === 'visible' &&
    owner.current.native === rt.chat.native && owner.current.account === rt.accountGeneration &&
    owner.current.generation === rt.gateway.state.generation && rt.chat.native.commands.state.action === intent;
  useEffect(() => {
    mounted.current = true;
    const unsubscribe = browser.subscribe(() => setIndex(browser.index));
    return () => { mounted.current = false; unsubscribe(); browser.clear(); };
  }, [browser]);
  useEffect(() => {
    if (command.kind !== 'sessions') return;
    const timer = setTimeout(() => { if (current()) void browser.list(query.trim()); }, 200);
    return () => clearTimeout(timer);
  }, [browser, query, intent]);
  useEffect(() => {
    if (command.kind !== 'copy') return;
    let cancelled = false; setBusy(true);
    void rt.gateway.call('session.history', { session_id: rt.chat.native.state.runtimeId }).then(raw => {
      if (!cancelled && current()) setResponse(copyAssistantResponse(raw, command.ordinal));
    }).catch(() => { if (!cancelled && current()) setError('Could not read that assistant response. No clipboard operation was attempted.'); })
      .finally(() => { if (!cancelled && current()) setBusy(false); });
    return () => { cancelled = true; };
  }, [intent]);
  const finish = () => {
    if (!current()) return false;
    if (intent.source === 'composer' && rt.chat.draft === intent.text) setDraft('');
    rt.chat.native.commands.dismissAction(); onClose(); return true;
  };
  const perform = async (task: () => Promise<void>) => {
    if (!current() || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError('');
    try { await task(); }
    catch (reason) { if (current()) setError(reason instanceof ClientError ? reason.message : 'The operation did not complete. No command was replayed.'); }
    finally { inFlight.current = false; if (current()) setBusy(false); }
  };
  const copy = () => {
    if (!current() || !response || inFlight.current) return;
    // Keep writeText directly in the click task; WebKit must retain user activation.
    if (!navigator.clipboard?.writeText) { setError('Clipboard access is unavailable. Select and copy the text below.'); return; }
    void perform(async () => {
      await navigator.clipboard.writeText(response.text);
      if (current()) { setCopied(true); if (intent.source === 'composer' && rt.chat.draft === intent.text) setDraft(''); }
    });
  };
  return <section className="browser-command" aria-label="Browser command controls">
    {error && <Notice error>{error}</Notice>}
    {command.kind === 'new' && <>
      <h3>New conversation</h3><p>Start a fresh native conversation in the {rt.chat.native.state.profile || 'default'} profile. The previous conversation and its unrelated draft remain available.</p>
      {command.title && <p>New title: <strong>{command.title}</strong></p>}
      <button type="button" className="primary" disabled={busy} onClick={() => {
        if (!current() || inFlight.current) return;
        const native = rt.chat.native; if (!finish()) return;
        rt.run(() => createCommandConversation(rt, native, command.title));
      }}>Start new conversation</button>
    </>}
    {command.kind === 'sessions' && <>
      <h3>Resume a conversation</h3><label className="field">Search saved conversations<input data-initial-focus type="search" aria-label="Search saved conversations" value={query} maxLength={512} onChange={event => setQuery(event.target.value)}/></label>
      <p className="small muted">Choose the actual saved conversation; a name is never guessed as a runtime identifier.</p>
      {index.phase === 'loading' && <p role="status">Reading saved conversations…</p>}
      {index.phase === 'error' && <Notice error>Could not read saved conversations. <button type="button" onClick={() => void browser.refresh()}>Retry</button></Notice>}
      {index.phase === 'ready' && !index.rows.length && <p>No matching conversations.</p>}
      <div className="command-catalogue-list" role="region" tabIndex={0} aria-label="Matching saved conversations">{index.rows.map(row => <button key={`${row.profile}:${row.id}`} type="button" className="command-suggestion" disabled={busy || index.phase !== 'ready'} onClick={() => { if (finish()) rt.open(row); }}>
        <strong>{row.title || row.preview || row.id}</strong><span>{row.profile || 'default'}</span>
      </button>)}</div>
      <div className="browser-command-actions"><button type="button" className="secondary" disabled={!!query.trim() || index.offset === 0 || index.phase === 'loading'} onClick={() => void browser.list('', Math.max(0, index.offset - 20))}>Previous conversations</button>
        <button type="button" className="secondary" disabled={!index.hasNext || index.phase === 'loading'} onClick={() => void browser.list('', index.offset + 20)}>Next conversations</button></div>
    </>}
    {command.kind === 'compose' && <>
      <h3>Compose a prompt</h3><p>Edit here instead of opening an editor on the Hermes host. Using this text replaces the draft but does not send it.</p>
      <label className="field">Prompt<textarea data-initial-focus aria-label="Expanded prompt editor" rows={8} value={text} maxLength={32768} onChange={event => setText(event.target.value)}/></label>
      <button type="button" className="primary" disabled={busy || !text.trim()} onClick={() => {
        if (!finish()) return;
        setDraft(text.trimStart().startsWith('/') ? text.replace(/^(\s*)\//, '$1//') : text);
      }}>Use edited prompt as draft</button>
    </>}
    {command.kind === 'copy' && <>
      <h3>Copy an assistant response</h3><p>Copies to this device, not the Hermes host. An explicit number counts assistant responses from the start of the native history.</p>
      {busy && !response && <p role="status">Reading native response…</p>}
      {response && <><label className="field">Assistant response {response.ordinal}<textarea aria-label="Assistant text to copy" readOnly rows={8} value={response.text}/></label>
        <button type="button" className="primary" disabled={busy} onClick={copy}>Copy response to this device</button></>}
      {copied && <p role="status">Response copied.</p>}
    </>}
    {command.kind === 'redraw' && <>
      <h3>Refresh the conversation</h3><p>Re-read authoritative native state and redraw the browser view. Nothing is sent to the agent.</p>
      <button type="button" className="primary" disabled={busy} onClick={() => void perform(async () => { await rt.chat.latest(); if (current()) finish(); })}>Refresh conversation view</button>
    </>}
  </section>;
}

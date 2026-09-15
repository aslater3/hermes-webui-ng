import { useEffect, useRef, useState } from 'react';
import { browserCommand, copyAssistantResponse } from '../src/hermes/browser-commands.js';
import { slashInput } from '../src/hermes/command-catalog.js';
import { SessionBrowser } from '../src/hermes/session-browser.js';
import { ClientError, record } from '../src/hermes/protocol.js';
import type { CommandsState } from '../src/hermes/native-commands.js';
import type { AppRuntime } from './runtime.js';
import { branchCommandConversation, createCommandConversation } from './browser-command-actions.js';
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
  const [attached, setAttached] = useState('');
  const [browser] = useState(() => new SessionBrowser(rt.dashboard, error => rt.gateway.suspend(error)));
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

  const imageBase64 = (blob: Blob): Promise<string> => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the image.'));
    reader.onload = () => {
      const value = reader.result;
      if (typeof value !== 'string' || !value.includes(',')) reject(new Error('Could not encode the image.'));
      else resolve(value.slice(value.indexOf(',') + 1));
    };
    reader.readAsDataURL(blob);
  });
  const attachBlob = async (blob: Blob, filename: string) => {
    if (!current() || !rt.chat.native.state.runtimeId) throw new ClientError('disconnected', 'The selected conversation changed before attaching the image.');
    if (!blob.size || blob.size > 25 * 1024 * 1024 || (blob.type && !blob.type.startsWith('image/')))
      throw new ClientError('protocol', 'Choose a supported image up to 25 MB. Nothing was attached.');
    const encoded = await imageBase64(blob);
    if (!current()) throw new ClientError('disconnected', 'The selected conversation changed before the image upload.');
    const raw = record(await rt.gateway.call('image.attach_bytes', {
      session_id: rt.chat.native.state.runtimeId,
      ...(rt.chat.native.state.profile ? { profile: rt.chat.native.state.profile } : {}),
      content_base64: encoded, filename: filename.slice(0, 512) || 'browser-image.png',
    }));
    if (!current()) throw new ClientError('disconnected', 'The selected conversation changed after the image was attached. It was not replayed.');
    if (raw.attached !== true || typeof raw.count !== 'number') throw new ClientError('protocol', 'Hermes did not confirm the image attachment. Check native state before retrying.');
    setAttached(`Attached ${typeof raw.name === 'string' ? raw.name : filename} for the next prompt.`);
    if (intent.source === 'composer' && rt.chat.draft === intent.text) setDraft('');
  };
  const attachHostPath = async (path: string) => {
    if (!current() || !rt.chat.native.state.runtimeId) throw new ClientError('disconnected', 'The selected conversation changed before attaching the image.');
    const raw = record(await rt.gateway.call('image.attach', {
      session_id: rt.chat.native.state.runtimeId,
      ...(rt.chat.native.state.profile ? { profile: rt.chat.native.state.profile } : {}), path,
    }));
    if (!current()) throw new ClientError('disconnected', 'The selected conversation changed after the image was attached. It was not replayed.');
    if (raw.attached !== true || typeof raw.count !== 'number') throw new ClientError('protocol', 'Hermes did not confirm the host image attachment. Check native state before retrying.');
    setAttached(`Attached ${typeof raw.name === 'string' ? raw.name : path} for the next prompt.`);
    if (intent.source === 'composer' && rt.chat.draft === intent.text) setDraft('');
  };
  const pasteImage = async () => {
    if (!navigator.clipboard?.read) throw new ClientError('protocol', 'Image clipboard access is unavailable in this browser. Use Choose image instead.');
    const items = await navigator.clipboard.read();
    for (const item of items) for (const type of item.types) if (type.startsWith('image/')) {
      const blob = await item.getType(type); await attachBlob(blob, `clipboard.${type.split('/')[1] || 'png'}`); return;
    }
    throw new ClientError('protocol', 'The browser clipboard does not contain an image.');
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
      <h3>Resume a conversation</h3><label className="field">Search saved conversations<input data-initial-focus type="search" aria-label="Search saved conversations" value={query} maxLength={512} onChange={event => { browser.clear(); setQuery(event.target.value); }}/></label>
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

    {command.kind === 'branch' && <>
      <h3>Branch this conversation</h3><p>Create a real native branch containing this conversation so far. The current conversation remains unchanged.</p>
      {command.title && <p>Branch title: <strong>{command.title}</strong></p>}
      <button type="button" className="primary" disabled={busy} onClick={() => {
        if (!current() || inFlight.current) return;
        const native = rt.chat.native; if (!finish()) return;
        rt.run(() => branchCommandConversation(rt, native, command.title));
      }}>Create native branch</button>
    </>}
    {command.kind === 'yolo' && <>
      <h3>Session YOLO mode</h3><p>{rt.chat.native.state.agent?.yolo ? 'YOLO is enabled for this conversation.' : 'YOLO is disabled for this conversation.'} Hermes hardline blocks and explicit deny rules remain authoritative.</p>
      <button type="button" className="primary" disabled={busy} onClick={() => {
        if (!current() || inFlight.current) return;
        const next = rt.chat.native.state.agent?.yolo !== true; if (!finish()) return;
        rt.run(() => rt.changeYolo(next));
      }}>{rt.chat.native.state.agent?.yolo ? 'Disable session YOLO' : 'Enable session YOLO'}</button>
    </>}
    {(command.kind === 'image' || command.kind === 'paste') && <>
      <h3>Attach an image</h3>
      <p>The image is attached to the selected Hermes conversation for the next prompt. Browser files are sent as bytes; nothing is stored in browser storage.</p>
      {attached && <p role="status">{attached}</p>}
      {command.kind === 'image' && command.hostPath && <button type="button" className="secondary" disabled={busy || !!attached} onClick={() => void perform(() => attachHostPath(command.hostPath))}>Attach Hermes-host path</button>}
      {command.kind === 'paste' && <button type="button" className="secondary" disabled={busy || !!attached} onClick={() => void perform(pasteImage)}>Read image from this device clipboard</button>}
      <label className="field">Choose image from this device<input type="file" accept="image/*" disabled={busy || !!attached} onChange={event => {
        const file = event.currentTarget.files?.[0]; if (file) void perform(() => attachBlob(file, file.name)); event.currentTarget.value = '';
      }}/></label>
      {command.kind === 'image' && command.hostPath && <p className="small muted">The typed path is interpreted on the Hermes host. Choosing a file instead uploads this device's image directly.</p>}
    </>}

    {command.kind === 'redraw' && <>
      <h3>Refresh the conversation</h3><p>Re-read authoritative native state and redraw the browser view. Nothing is sent to the agent.</p>
      <button type="button" className="primary" disabled={busy} onClick={() => void perform(async () => { await rt.chat.latest(); if (current()) finish(); })}>Refresh conversation view</button>
    </>}
  </section>;
}

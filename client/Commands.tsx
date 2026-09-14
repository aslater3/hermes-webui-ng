import { useEffect, useId, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Search, RefreshCw, Terminal } from 'lucide-react';
import { commandHint, commandMatches, type CommandChoice } from '../src/hermes/command-catalog.js';
import type { AppRuntime } from './runtime.js';
import { Modal, Notice } from './primitives.js';
import { UsageDetails } from './SessionUsage.js';
import './commands.css';

/** Catalogue and completion contain no RPC envelopes; the selected native owner admits execution. */
export function useCommands(rt: AppRuntime, draft: string, setDraft: (text: string) => void,
  composer: RefObject<HTMLTextAreaElement | null>, writable: boolean) {
  const native = rt.chat.native, commands = native.commands, state = commands.state;
  const [panel, setPanel] = useState<'catalogue' | 'context' | null>(null);
  const [query, setQuery] = useState(''), [limit, setLimit] = useState(80);
  const [active, setActive] = useState(0), [dismissed, setDismissed] = useState<string>();
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible');
  const trigger = useRef<HTMLButtonElement>(null), list = useRef<HTMLDivElement>(null), id = useId();
  const eligible = rt.ready && visible && !rt.chat.historical && !rt.chat.busy;
  const prefix = /^\s*\/[a-z0-9_.:-]*$/i.test(draft) ? draft.trim() : undefined;
  const suggesting = eligible && writable && prefix !== undefined && dismissed !== draft && !panel && !state.result;
  const matches = commandMatches(state.catalogue, prefix ?? '', 8);
  const enabled = (row: CommandChoice) => row.action !== 'unavailable' && !(row.action === 'native' && state.executionUnavailable);
  const selections = matches.filter(enabled), choice = selections[active % Math.max(1, selections.length)];
  const rows = commandMatches(state.catalogue, query, 1000);
  useEffect(() => {
    const change = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', change); return () => document.removeEventListener('visibilitychange', change);
  }, []);
  useEffect(() => { setPanel(null); setQuery(''); setLimit(80); setDismissed(undefined); },
    [native, native.state.runtimeId, rt.gateway.state.generation, rt.accountGeneration, rt.chat.historical, visible]);
  useEffect(() => { setActive(0); }, [prefix]);
  useEffect(() => { if (eligible && (suggesting || panel === 'catalogue')) void commands.load(); },
    [commands, eligible, suggesting, panel, prefix]);
  const intent = state.action;
  useEffect(() => {
    if (!intent || !eligible || !['catalogue', 'context'].includes(intent.kind)) return;
    trigger.current?.focus({ preventScroll: true });
    setPanel(intent.kind as 'catalogue' | 'context'); setQuery(intent.query); setLimit(80); commands.dismissAction();
  }, [commands, intent, eligible]);
  useEffect(() => {
    const root = list.current, option = root?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (root && option) {
      if (option.offsetTop < root.scrollTop) root.scrollTop = option.offsetTop;
      else if (option.offsetTop + option.offsetHeight > root.scrollTop + root.clientHeight)
        root.scrollTop = option.offsetTop + option.offsetHeight - root.clientHeight;
    }
  }, [active, prefix]);
  const complete = (row: CommandChoice) => {
    if (!writable || !enabled(row)) return;
    setDraft(`${row.name} `); setDismissed(undefined);
    composer.current?.focus({ preventScroll: true });
  };
  const keyDown = (event: KeyboardEvent<HTMLElement>): boolean => {
    if (!suggesting || event.nativeEvent.isComposing || event.keyCode === 229 || event.altKey || event.metaKey || event.ctrlKey) return false;
    if (event.key === 'Escape') { event.preventDefault(); setDismissed(draft); composer.current?.focus({ preventScroll: true }); return true; }
    if (selections.length && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
      event.preventDefault(); setActive((active + (event.key === 'ArrowDown' ? 1 : selections.length - 1)) % selections.length); return true;
    }
    if (choice && !event.shiftKey && (event.key === 'Tab' || (event.key === 'Enter' && (event.currentTarget === list.current || (navigator.maxTouchPoints === 0 && matchMedia('(pointer:fine)').matches))))) {
      event.preventDefault(); complete(choice); return true;
    }
    return false;
  };
  const open = () => { trigger.current?.focus({ preventScroll: true }); setQuery(''); setLimit(80); setPanel('catalogue'); };
  const close = () => {
    setPanel(null); commands.dismissResult();
    requestAnimationFrame(() => {
      if (rt.chat.native === native && rt.ready && document.visibilityState === 'visible')
        trigger.current?.focus({ preventScroll: true });
    });
  };
  const action = (row: CommandChoice) => {
    // The catalogue uses a separate deliberate command operation so an existing draft is untouched.
    if (!enabled(row) || !writable) return;
    setPanel(null); rt.run(async () => { await rt.command(row.name); });
  };
  const popup = suggesting ? <div className="command-suggestions">
    <div className="command-suggestions-heading"><strong>Hermes commands</strong><button type="button" onClick={open}>Browse all</button></div>
    {state.loading && <p role="status">Reading commands…</p>}
    {state.error && <p role="status">{state.error}</p>}
    {!state.loading && !state.error && !matches.length && <p>No matching command. Use // to send literal slash text.</p>}
    {!!matches.length && <div ref={list} id={id} role="listbox" tabIndex={0} aria-activedescendant={choice ? `${id}-${choice.name.slice(1)}` : undefined} onKeyDown={keyDown} aria-label="Slash command suggestions" className="command-suggestion-list">
      {matches.map(row => <button type="button" role="option" key={row.name} id={`${id}-${row.name.slice(1)}`} aria-selected={choice?.name === row.name}
        aria-disabled={!enabled(row)} disabled={!enabled(row)} tabIndex={-1} className="command-suggestion" onMouseDown={event => event.preventDefault()} onClick={() => complete(row)}>
        <strong>{row.name}</strong><span>{commandHint(row)}</span>
      </button>)}
    </div>}
    <span className="command-completion-hint">Choose a command, then send · Tab completes · Escape closes</span>
  </div> : null;
  const overlay = eligible && (panel || state.result) ? createPortal(<Modal title={state.result ? `Command ${state.result.command}` : panel === 'context' ? 'Usage & context' : 'Hermes commands'} kind="commands" onClose={close}>
    <div className="commands-body">
      {state.result ? <>
        <p className="small muted">Read-only native result · {native.state.profile || 'default'} profile. Closing clears this readout; it is not added to the conversation.</p>
        <pre className="command-output" role="region" tabIndex={0} aria-label="Native command output">{state.result.output || 'Hermes returned no output.'}</pre>
        {state.result.truncated && <Notice>Output limited to 32,768 characters.</Notice>}
      </> : panel === 'context' ? <UsageDetails usage={native.state.usage}/> : <>
        <p>Commands advertised by the selected Hermes profile. Unsupported commands are listed for discovery, not execution.</p>
        <label className="command-search"><Search size={17}/><input data-initial-focus type="search" aria-label="Search Hermes commands" placeholder="Search commands, aliases or descriptions…" value={query} onChange={event => { setQuery(event.target.value); setLimit(80); }}/></label>
        <div className="command-catalogue-summary"><span>{native.state.profile || rt.chat.selected?.profile || 'default'} profile</span><button type="button" className="text-button" disabled={state.loading || state.busy} onClick={() => void commands.load(true)}><RefreshCw size={15}/>Refresh commands</button></div>
        {state.loading && <p role="status">Reading Hermes command catalogue…</p>}{state.error && <Notice error>{state.error}</Notice>}
        {state.catalogue?.partial && <Notice>Hermes returned a partial catalogue. Refresh to check for more commands.</Notice>}
        {!state.loading && !state.error && !rows.length && <p>No matching commands were returned by Hermes.</p>}
        <div className="command-catalogue-list">{rows.slice(0, limit).map(row => <div className="command-catalogue-row" key={row.name}>
          <div><strong>{row.name}</strong><span className="small muted">{row.category}{row.aliases.length ? ` · ${row.aliases.join(', ')}` : ''}</span></div>
          <p>{row.description}</p><small>{commandHint(row)}</small>
          <button type="button" className="secondary" disabled={!enabled(row) || !writable} aria-label={`Use ${row.name}`} onClick={() => action(row)}>{enabled(row) ? 'Use command' : 'Unavailable here'}</button>
        </div>)}</div>
        {rows.length > limit && <button type="button" className="secondary" onClick={() => setLimit(limit + 80)}>Show more commands ({rows.length - limit} remaining)</button>}
        <p className="small muted">Using a command here preserves your unsent draft. Type // at the start of a message to send literal slash text. Rewind, global configuration, quick commands and plugin/skill execution are not enabled here.</p>
      </>}
      <button type="button" className="secondary" onClick={close}>Done</button>
    </div>
  </Modal>, document.body) : null;
  return {
    keyDown, popup, overlay,
    aria: { 'aria-autocomplete': suggesting ? 'list' as const : undefined,
      'aria-controls': suggesting && matches.length ? id : undefined,
      'aria-activedescendant': suggesting && choice ? `${id}-${choice.name.slice(1)}` : undefined },
    button: <button ref={trigger} type="button" className="command-button" aria-label="Browse Hermes commands" aria-haspopup="dialog" disabled={!eligible || state.busy} onClick={open}><Terminal size={14}/><span>{state.busy ? 'Reading…' : 'Commands'}</span></button>,
  };
}

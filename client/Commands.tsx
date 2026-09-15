import { BrowserCommandPanel } from './BrowserCommandPanel.js';
import { useEffect, useLayoutEffect, useId, useRef, useState, useSyncExternalStore, type KeyboardEvent, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Search, RefreshCw, Terminal } from 'lucide-react';
import { commandHint, commandAvailability, commandMatches, type CommandChoice } from '../src/hermes/command-catalog.js';
import type { AppRuntime } from './runtime.js';
import { Modal, Notice } from './primitives.js';
import { UsageDetails } from './SessionUsage.js';
import './commands.css';

/** Catalogue and completion contain no RPC envelopes; the selected native owner admits execution. */
export function useCommands(rt: AppRuntime, draft: string, setDraft: (text: string) => void,
  composer: RefObject<HTMLTextAreaElement | null>, writable: boolean) {
  const native = rt.chat.native, commands = native.commands;
  const state = useSyncExternalStore(commands.subscribe, commands.getSnapshot);
  const [panel, setPanel] = useState<'catalogue' | 'context' | 'browser' | null>(null);
  const [query, setQuery] = useState('');
  const [argumentCommand, setArgumentCommand] = useState<string>(), [argumentsText, setArgumentsText] = useState('');
  const [active, setActive] = useState(0), [dismissed, setDismissed] = useState<string>();
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible');
  const trigger = useRef<HTMLButtonElement>(null), list = useRef<HTMLDivElement>(null), id = useId();
  const eligible = rt.ready && visible && !rt.chat.historical && !rt.chat.busy;
  const prefix = /^\s*\/[a-z0-9_.:-]*$/i.test(draft) ? draft.trim() : undefined;
  const suggesting = eligible && writable && prefix !== undefined && dismissed !== draft && !panel && !state.result && !state.confirmation && !state.recovered && !state.uncertain;
  const matches = commandMatches(state.catalogue, prefix ?? '');
  const enabled = (row: CommandChoice) => row.action !== 'unavailable' && !(row.action === 'native' && state.executionUnavailable);
  const selections = matches.filter(enabled), choice = selections[active % Math.max(1, selections.length)];
  const rows = commandMatches(state.catalogue, query);
  useEffect(() => {
    const change = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', change); return () => document.removeEventListener('visibilitychange', change);
  }, []);
  useEffect(() => { setPanel(null); setQuery(''); setDismissed(undefined); setArgumentCommand(undefined); setArgumentsText(''); },
    [native, native.state.runtimeId, rt.gateway.state.generation, rt.accountGeneration, rt.chat.historical, visible]);
  useLayoutEffect(() => {
    setActive(0);
    if (list.current) list.current.scrollTop = 0;
  }, [prefix, state.catalogue, state.executionUnavailable, suggesting]);
  useEffect(() => { if (eligible && (suggesting || panel === 'catalogue')) void commands.load(); },
    [commands, eligible, suggesting, panel, prefix]);
  const intent = state.action;
  useEffect(() => {
    if (!intent || !eligible || !['catalogue', 'context', 'browser'].includes(intent.kind)) return;
    trigger.current?.focus({ preventScroll: true });
    setPanel(intent.kind as 'catalogue' | 'context' | 'browser'); setQuery(intent.query);
    if (intent.kind !== 'browser') commands.dismissAction();
  }, [commands, intent, eligible]);
  useLayoutEffect(() => {
    const root = list.current, option = root?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (root && option) {
      if (option.offsetTop < root.scrollTop) root.scrollTop = option.offsetTop;
      else if (option.offsetTop + option.offsetHeight > root.scrollTop + root.clientHeight)
        root.scrollTop = option.offsetTop + option.offsetHeight - root.clientHeight;
    }
  }, [active, prefix, state.catalogue, suggesting]);
  const complete = (row: CommandChoice) => {
    if (!writable || !enabled(row)) return;
    setDraft(`${row.name} `); setDismissed(undefined);
    composer.current?.focus({ preventScroll: true });
  };
  const keyDown = (event: KeyboardEvent<HTMLElement>): boolean => {
    if (!suggesting || event.nativeEvent.isComposing || event.keyCode === 229 || event.altKey || event.metaKey || event.ctrlKey) return false;
    if (event.key === 'Escape') { event.preventDefault(); setDismissed(draft); composer.current?.focus({ preventScroll: true }); return true; }
    if (selections.length && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
      event.preventDefault(); setActive(index => (index + (event.key === 'ArrowDown' ? 1 : selections.length - 1)) % selections.length); return true;
    }
    if (choice && !event.shiftKey && (event.key === 'Tab' || (event.key === 'Enter' && (event.currentTarget === list.current || (navigator.maxTouchPoints === 0 && matchMedia('(pointer:fine)').matches))))) {
      event.preventDefault(); complete(choice); return true;
    }
    return false;
  };
  const open = () => { trigger.current?.focus({ preventScroll: true }); setQuery(''); setArgumentCommand(undefined); setPanel('catalogue'); };
  const close = () => {
    setPanel(null); setArgumentCommand(undefined); setArgumentsText(''); commands.cancelConfirmation(); commands.dismissResult(); commands.dismissAction();
    requestAnimationFrame(() => {
      if (rt.chat.native === native && rt.ready && document.visibilityState === 'visible')
        trigger.current?.focus({ preventScroll: true });
    });
  };
  const action = (row: CommandChoice) => {
    // The catalogue uses a separate deliberate command operation so an existing draft is untouched.
    if (!enabled(row) || !writable) return;
    if (row.action === 'confirm-native') { setArgumentCommand(row.name); setArgumentsText(''); return; }
    setPanel(null); rt.run(async () => { await rt.command(row.name); });
  };
  const prepare = () => {
    if (!argumentCommand || !writable) return;
    const text = argumentCommand + (argumentsText.trim() ? ` ${argumentsText.trim()}` : '');
    setPanel(null); setArgumentCommand(undefined); setArgumentsText('');
    rt.run(() => rt.command(text));
  };
  const restore = () => {
    const recovered = commands.state.recovered;
    if (!recovered || commands.blocked) return;
    // This is an explicit replacement, not an asynchronous write into an unrelated draft.
    setDraft(recovered.kind === 'prefill' && recovered.text.trimStart().startsWith('/') ? recovered.text.replace(/^(\s*)\//, '$1//') : recovered.text);
    commands.dismissResult(); setPanel(null); composer.current?.focus({ preventScroll: true });
  };
  const popup = suggesting ? <div className="command-suggestions">
    <div className="command-suggestions-heading"><strong>Hermes commands</strong><button type="button" onClick={open}>Browse all</button></div>
    {state.loading && <p role="status">Reading commands…</p>}
    {state.error && <p role="status">{state.error}</p>}
    {!state.loading && !state.error && !matches.length && <p>No matching command. Use // to send literal slash text.</p>}
    {state.catalogue && <p className="command-match-count" role="status">{matches.length} matching · {matches.filter(enabled).length} selectable</p>}
    {!!matches.length && <div ref={list} id={id} role="listbox" tabIndex={0} aria-activedescendant={choice ? `${id}-${choice.name.slice(1)}` : undefined} onKeyDown={keyDown} aria-label="Slash command suggestions" className="command-suggestion-list">
      {matches.map(row => <button type="button" role="option" key={row.name} id={`${id}-${row.name.slice(1)}`} aria-selected={choice?.name === row.name}
        aria-disabled={!enabled(row)} disabled={!enabled(row)} tabIndex={-1} className="command-suggestion" onMouseDown={event => event.preventDefault()} onClick={() => complete(row)}>
        <strong>{row.name}</strong><span className="command-suggestion-copy"><span>{row.description || commandHint(row, state.executionUnavailable)}</span>
          {!enabled(row) && <small>{commandAvailability(row, state.executionUnavailable)}</small>}
        </span>
      </button>)}
    </div>}
    <span className="command-completion-hint">Scroll for more · Type to filter · Tab completes · Escape closes</span>
  </div> : null;
  const overlay = eligible && (panel || state.result || state.confirmation || state.recovered || state.uncertain || argumentCommand) ? createPortal(<Modal title={state.confirmation ? 'Confirm native command' : state.recovered ? 'Recovered command input' : state.uncertain ? 'Check native command outcome' : argumentCommand ? `Command ${argumentCommand}` : state.result ? `Command ${state.result.command}` : panel === 'context' ? 'Usage & context' : panel === 'browser' ? 'Browser command' : 'Hermes commands'} kind="commands" onClose={close}>
    <div className="commands-body">
      {state.confirmation ? <>
        <p>This command runs in Hermes for the <strong>{native.state.profile || 'default'}</strong> profile. It may change conversation history, files, tools or persistent configuration. Custom commands may run server-side programs.</p>
        <pre className="command-output" role="region" tabIndex={0} aria-label="Command to confirm">{state.confirmation.text}</pre>
        <p className="small muted">The confirmation expires after two minutes. Cancelling preserves your draft. Hermes still applies its own permissions and approval rules.</p>
        <button type="button" className="secondary" onClick={() => { setPanel(null); rt.run(() => rt.confirmCommand()); }}>Run native command</button>
        <button type="button" className="secondary" data-initial-focus onClick={close}>Cancel command</button>
      </> : state.uncertain ? <>
        <Notice error>The command may have had effects. It has not been replayed. Check native state and any affected files or configuration before trying again.</Notice>
        {state.error && <p role="status">{state.error}</p>}
        {state.result && <pre className="command-output" role="region" tabIndex={0} aria-label="Native command output">{state.result.output}</pre>}
        <button type="button" className="secondary" disabled={state.busy} onClick={() => rt.run(() => commands.acknowledgeUncertain())}>I have checked the effects — refresh native state</button>
      </> : state.recovered ? <>
        <p>{state.recovered.kind === 'prefill' ? 'Hermes changed the conversation and returned this input for editing. It has not been submitted.' : 'Hermes resolved an alias to this input. It has not been executed or sent.'}</p>
        {state.recovered.notice && <p>{state.recovered.notice}</p>}
        <pre className="command-output" role="region" tabIndex={0} aria-label="Recovered input">{state.recovered.text}</pre>
        {!!draft && <Notice>Your current unsent draft will be replaced only if you choose the button below.</Notice>}
        <button type="button" className="secondary" onClick={restore}>{draft ? 'Replace draft with recovered input' : 'Use recovered input as draft'}</button>
      </> : argumentCommand ? <>
        <p>Enter the arguments accepted by Hermes. Nothing runs until you review and confirm the complete command.</p>
        <label className="command-search"><input data-initial-focus type="text" aria-label="Native command arguments" placeholder="Arguments (optional)" value={argumentsText} maxLength={32000} onChange={event => setArgumentsText(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); prepare(); } }}/></label>
        <button type="button" className="secondary" disabled={!writable} onClick={prepare}>Review command</button>
      </> : state.result ? <>
        <p className="small muted">{state.result.native ? 'Native command result' : 'Read-only native result'} · {native.state.profile || 'default'} profile. Closing clears this readout; it is not added to the conversation.</p>
        <pre className="command-output" role="region" tabIndex={0} aria-label="Native command output">{state.result.output || 'Hermes returned no output.'}</pre>
        {state.result.truncated && <Notice>Output limited to 32,768 characters.</Notice>}
      </> : panel === 'browser' && state.action?.kind === 'browser' ? <BrowserCommandPanel key={`${native.state.runtimeId}:${state.action.query}`} runtime={rt} intent={state.action} onClose={close} setDraft={setDraft}/> : panel === 'context' ? <UsageDetails usage={native.state.usage}/> : <>
        <p>Commands advertised by Hermes. Native commands require review; the gateway must be launched for the selected profile before generic execution is permitted.</p>
        <label className="command-search"><Search size={17}/><input data-initial-focus type="search" aria-label="Search Hermes commands" placeholder="Search commands, aliases or descriptions…" value={query} onChange={event => { setQuery(event.target.value); }}/></label>
        <div className="command-catalogue-summary"><span>{native.state.profile || rt.chat.selected?.profile || 'default'} profile</span><button type="button" className="text-button" disabled={state.loading || state.busy} onClick={() => void commands.load(true)}><RefreshCw size={15}/>Refresh commands</button></div>
        {state.loading && <p role="status">Reading Hermes command catalogue…</p>}{state.error && <Notice error>{state.error}</Notice>}
        {state.catalogue?.partial && <Notice>Hermes returned a partial catalogue. Refresh to check for more commands.</Notice>}
        {!state.loading && !state.error && !rows.length && <p>No matching commands were returned by Hermes.</p>}
        {state.catalogue && <p className="command-match-count" role="status">{rows.length} matching · {rows.filter(enabled).length} selectable</p>}
        <div className="command-catalogue-list" role="region" aria-label="Matching Hermes commands" tabIndex={0} key={query}>{rows.map(row => <div className="command-catalogue-row" key={row.name}>
          <div><strong>{row.name}</strong><span className="small muted">{row.category}{row.aliases.length ? ` · ${row.aliases.join(', ')}` : ''}</span></div>
          <p>{row.description}</p><small>{commandHint(row, state.executionUnavailable)}</small>
          <button type="button" className="secondary" disabled={!enabled(row) || !writable} aria-label={`Use ${row.name}`} onClick={() => action(row)}>{enabled(row) ? 'Use command' : commandAvailability(row, state.executionUnavailable)}</button>
        </div>)}</div>
        <p className="small muted">Using a command here preserves your unsent draft. Type // at the start of a message to send literal slash text. Native handlers remain authoritative. Terminal-only commands and unsupported native operations may need a different Hermes interface.</p>
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

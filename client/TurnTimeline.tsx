import { lazy, memo, Suspense, useContext, useEffect, useId, useState, type ReactNode } from 'react';
import { Check, CircleCheck, CircleX, Copy, FileText, LoaderCircle, Pencil, Search, Terminal, Wrench } from 'lucide-react';
import { HermesMark } from './HermesMark.js';
import { SpeechContext, ReadAloudButton } from './voice.js';
import { clock, readableOutput, thoughtLabel, toolLabel, type CallStatus, type ToolCall, type ToolGroupItem, type ThoughtItem, type NarrationItem, type ReplyItem, type TimelineItem } from '../src/hermes/turn-timeline.js';
import './turn-timeline.css';

const Markdown = lazy(() => import('./Markdown.js'));
/** Rows shown before "Show N earlier items" in a long turn. */
export const ROWS_VISIBLE = 8;
/** Lines of one call's output shown before "Show all". */
const OUTPUT_LINES = 200;

type Kind = 'terminal' | 'file' | 'write' | 'search' | 'other';
/** Icon and kind from the tool name, the same names the projection uses for summaries. */
function kindOf(name: string): Kind {
  if (/^(terminal|bash|shell|run_command|execute_command)$/i.test(name)) return 'terminal';
  if (/^(write_file|patch|edit_file|create_file)$/i.test(name)) return 'write';
  if (/^read_file$/i.test(name)) return 'file';
  if (/(search|grep|find|web|fetch|browse|query)/i.test(name)) return 'search';
  return 'other';
}
function KindIcon({ kind }: { kind: Kind }) {
  const props = { size: 15, 'aria-hidden': true, focusable: false } as const;
  if (kind === 'terminal') return <Terminal {...props}/>;
  if (kind === 'file') return <FileText {...props}/>;
  if (kind === 'write') return <Pencil {...props}/>;
  if (kind === 'search') return <Search {...props}/>;
  return <Wrench {...props}/>;
}
/** The full command for a terminal call, or the arguments as readable JSON; the stored text is already redacted. */
function fullArguments(call: ToolCall): string {
  try {
    const parsed: unknown = JSON.parse(call.args);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const command = (parsed as Record<string, unknown>).command;
      if (typeof command === 'string' && kindOf(call.name) === 'terminal') return command;
      return JSON.stringify(parsed, null, 2);
    }
  } catch { /* not JSON: show it as stored */ }
  return call.args;
}
/** A ticking clock for the running rows. Ticks only while something is running; reduced motion keeps the number. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}
function elapsed(startedAt: number | undefined, now: number): string {
  return startedAt === undefined ? '' : clock(Math.max(0, now - startedAt) / 1000);
}
function Glyph({ status }: { status: CallStatus }) {
  if (status === 'running') return <LoaderCircle size={14} className="spin" aria-hidden="true" focusable="false"/>;
  if (status === 'ok') return <CircleCheck size={14} aria-hidden="true" focusable="false"/>;
  if (status === 'failed') return <CircleX size={14} aria-hidden="true" focusable="false"/>;
  return null;
}
const statusWord: Record<CallStatus, string> = { running: 'running', ok: 'done', failed: 'failed', unknown: '' };

/** One call inside an expanded group: full arguments, bounded output, outcome and duration. */
function CallDetail({ call, now }: { call: ToolCall; now: number }) {
  const [all, setAll] = useState(false);
  const output = readableOutput(call.name, call.output);
  const lines = output.split('\n');
  const shown = all || lines.length <= OUTPUT_LINES ? output : lines.slice(0, OUTPUT_LINES).join('\n');
  const time = call.status === 'running' ? elapsed(call.startedAt, now) : toolLabel(call.seconds);
  return <li className="turn-call" data-status={call.status} data-call-id={call.callId}>
    <div className="turn-call-head">
      <span className="turn-call-state"><Glyph status={call.status}/>{call.verdict || statusWord[call.status]}</span>
      {time && <span className="turn-call-time">{time}</span>}
    </div>
    <p className="turn-field">Command</p>
    <pre className="turn-code turn-command">{fullArguments(call) || call.summary}</pre>
    <p className="turn-field">Output</p>
    {call.status === 'running' ? <p className="turn-empty">Running · {elapsed(call.startedAt, now)}</p>
      : output ? <pre className="turn-code turn-output">{shown}</pre>
        : <p className="turn-empty">No output recorded</p>}
    {lines.length > OUTPUT_LINES && !all && <button type="button" className="turn-more-button" onClick={() => setAll(true)}>Show all {lines.length} lines</button>}
  </li>;
}

function ThoughtRow({ item, open, now, onToggle }: { item: ThoughtItem; open: boolean; now: number; onToggle: () => void }) {
  const id = useId();
  const label = item.running ? `Thinking… ${elapsed(item.startedAt, now)}`.trim() : item.seconds !== undefined ? `Thought for ${thoughtLabel(item.seconds)}` : 'Thought';
  return <li className="turn-row turn-thought" data-row="thought" data-live-row={item.running ? 'true' : undefined} data-running={item.running ? 'true' : undefined}>
    <button type="button" className="turn-row-toggle" aria-expanded={open} aria-controls={id} onClick={onToggle}>
      <span className="turn-glyph" aria-hidden="true">∴</span>
      <span className="turn-label">{label}</span>
      {item.preview && <><span className="turn-sep" aria-hidden="true">·</span><span className="turn-preview">{item.preview}</span></>}
    </button>
    {open && <div id={id} className="turn-row-body">
      <pre className="turn-code turn-thought-text">{item.text}</pre>
      {item.truncated && <p className="turn-empty">This reasoning reached the display limit.</p>}
    </div>}
  </li>;
}

function ToolRow({ item, open, now, onToggle }: { item: ToolGroupItem; open: boolean; now: number; onToggle: () => void }) {
  const id = useId();
  const first = item.calls[0];
  if (!first) return null;
  const kind = kindOf(first.name);
  const more = item.calls.length - 1;
  const failed = item.calls.find(call => call.status === 'failed');
  const seconds = item.seconds;
  let status: ReactNode;
  if (item.status === 'running') status = <><Glyph status="running"/><span className="turn-status-text">{elapsed(item.startedAt, now)}</span></>;
  else if (item.status === 'ok') status = <><Glyph status="ok"/><span className="turn-status-text">{seconds !== undefined ? toolLabel(seconds) : item.calls.map(call => call.verdict).find(Boolean) ?? 'done'}</span></>;
  else if (item.status === 'failed') status = <><Glyph status="failed"/><span className="turn-status-text">{failed?.verdict || 'failed'}{seconds !== undefined ? ` · ${toolLabel(seconds)}` : ''}</span></>;
  else status = <span className="turn-status-text">no result recorded</span>;
  return <li className="turn-row turn-tools" data-row="tools" data-status={item.status} data-live-row={item.running ? 'true' : undefined} data-running={item.running ? 'true' : undefined}>
    <button type="button" className="turn-row-toggle" aria-expanded={open} aria-controls={id} onClick={onToggle}>
      <span className="turn-kind" aria-hidden="true"><KindIcon kind={kind}/></span>
      {kind === 'terminal' && <span className="turn-prompt" aria-hidden="true">$</span>}
      <code className="turn-summary">{first.summary || first.name}</code>
      {more > 0 && <span className="turn-more">+ {more} {kind === 'terminal' ? `command${more === 1 ? '' : 's'}` : `call${more === 1 ? '' : 's'}`}</span>}
      <span className="turn-status" data-status={item.status}>{status}</span>
    </button>
    {open && <ol id={id} className="turn-calls" aria-label={`${item.calls.length} tool call${item.calls.length === 1 ? '' : 's'}`}>
      {item.calls.map(call => <CallDetail key={call.key} call={call} now={now}/>)}
    </ol>}
  </li>;
}

function NarrationRow({ item }: { item: NarrationItem }) {
  return <li className="turn-narration" data-row="narration" data-role="assistant" data-live-row={item.running ? 'true' : undefined} data-running={item.running ? 'true' : undefined}>
    {item.running ? <pre className="turn-prose">{item.text}<span className="stream-cursor"/></pre>
      : <Suspense fallback={<pre className="turn-prose">{item.text}</pre>}><div className="turn-prose"><Markdown text={item.text}/></div></Suspense>}
  </li>;
}

function ReplyRow({ item }: { item: ReplyItem }) {
  const speech = useContext(SpeechContext), speechKey = useId();
  const [copied, setCopied] = useState(false), [note, setNote] = useState('');
  return <li className="turn-reply" data-row="reply" data-role="assistant" data-live-row={item.running ? 'true' : undefined} data-running={item.running ? 'true' : undefined}>
    <div className="message-content">
      {item.truncated && <p className="muted small">This message reached the display limit.</p>}
      {item.running ? <pre className="plain-message">{item.text}<span className="stream-cursor"/></pre>
        : <Suspense fallback={<pre className="plain-message">{item.text}</pre>}><Markdown text={item.text}/></Suspense>}
    </div>
    {!item.running && item.text && <div className="message-actions"><button type="button" aria-label="Copy message" title="Copy message" onClick={() => {
      if (!navigator.clipboard) { setNote('Select the message to copy.'); return; }
      void navigator.clipboard.writeText(item.text).then(() => { setCopied(true); setNote('Message copied.'); }).catch(() => setNote('Select the message to copy.'));
    }}>{copied ? <Check size={14} aria-hidden="true" focusable="false"/> : <Copy size={14} aria-hidden="true" focusable="false"/>}</button><span className="sr-only" role="status">{note}</span>
      <ReadAloudButton itemKey={speechKey} text={item.text} controls={speech}/></div>}
  </li>;
}

/**
 * One Hermes turn as a CLI-style timeline: one header, thin dividers between thought and tool rows, prose for
 * narration and the reply. Saved and live rows use the same component; a running row ticks and turns into its
 * final state in place, and the rows the user opened stay open across that handover.
 */
export const TurnTimeline = memo(function TurnTimeline({ items }: { items: TimelineItem[] }) {
  const [earlier, setEarlier] = useState(false);
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const anyRunning = items.some(item => (item.kind === 'tools' || item.kind === 'thought' || item.kind === 'narration' || item.kind === 'reply') && item.running);
  const now = useNow(anyRunning);
  const collapsible = items.length > ROWS_VISIBLE;
  const hidden = collapsible && !earlier ? items.length - ROWS_VISIBLE : 0;
  const visible = hidden ? items.slice(-ROWS_VISIBLE) : items;
  const toggle = (key: string) => setOpen(previous => {
    const next = new Set(previous);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  return <article className="message message-assistant turn-timeline" data-role="turn">
    <div className="message-label"><span className="assistant-mark" aria-hidden="true"><HermesMark size={15}/></span><span>Hermes</span></div>
    {hidden > 0 && <button type="button" className="turn-more-button" onClick={() => setEarlier(true)}>Show {hidden} earlier item{hidden === 1 ? '' : 's'}</button>}
    <ol className="turn-rows" aria-label="Hermes steps and reply">
      {visible.map(item => {
        if (item.kind === 'thought') return <ThoughtRow key={item.key} item={item} open={open.has(item.key)} now={now} onToggle={() => toggle(item.key)}/>;
        if (item.kind === 'tools') return <ToolRow key={item.key} item={item} open={open.has(item.key)} now={now} onToggle={() => toggle(item.key)}/>;
        if (item.kind === 'narration') return <NarrationRow key={item.key} item={item}/>;
        return <ReplyRow key={item.key} item={item}/>;
      })}
    </ol>
    {collapsible && earlier && <button type="button" className="turn-more-button" onClick={() => setEarlier(false)}>Show only the last {ROWS_VISIBLE} items</button>}
  </article>;
});

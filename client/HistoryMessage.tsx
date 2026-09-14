import { HermesMark } from './HermesMark.js';
import { lazy, memo, Suspense, useState } from 'react';
import { Brain, Check, Copy, Wrench } from 'lucide-react';
import type { DisplayMessage } from '../src/hermes/history-message.js';
import './history-message.css';

const Markdown = lazy(() => import('./Markdown.js'));

/** Native history is a typed projection, not a list of assistant text envelopes. */
export const HistoryMessage = memo(function HistoryMessage({ role, text, toolName, reasoning, truncated = false }: DisplayMessage) {
  const [copied, setCopied] = useState(false), [note, setNote] = useState('');
  const user = role === 'user';
  const limit = truncated && <p className="muted small">This message reached the display limit.</p>;
  if (role === 'tool') return <article className="message message-tool history-tool" data-role="tool">
    <details><summary><Wrench size={15} aria-hidden="true" focusable="false"/><strong>{toolName ?? 'Tool'}</strong><span>Saved tool activity</span></summary>
      <pre className="plain-message">{text}</pre>{limit}
    </details>
  </article>;
  return <article className={`message message-${user ? 'user' : 'assistant'}`} data-role={role}>
    <div className="message-label">{role === 'assistant' && <span className="assistant-mark" aria-hidden="true"><HermesMark size={15}/></span>}<span>{user ? 'You' : role === 'assistant' ? 'Hermes' : role}</span></div>
    {reasoning && <details className="history-reasoning"><summary><Brain size={15} aria-hidden="true" focusable="false"/>Reasoning from Hermes</summary><pre className="plain-message">{reasoning}</pre></details>}
    {text && <div className="message-content">{user ? <div className="user-text">{text}</div> : <Suspense fallback={<pre className="plain-message">{text}</pre>}><Markdown text={text}/></Suspense>}</div>}
    {limit}
    {!user && text && <div className="message-actions"><button type="button" aria-label="Copy message" title="Copy message" onClick={() => {
      if (!navigator.clipboard) { setNote('Select the message to copy.'); return; }
      void navigator.clipboard.writeText(text).then(() => { setCopied(true); setNote('Message copied.'); }).catch(() => setNote('Select the message to copy.'));
    }}>{copied ? <Check size={14} aria-hidden="true" focusable="false"/> : <Copy size={14} aria-hidden="true" focusable="false"/>}</button><span className="sr-only" role="status">{note}</span></div>}
  </article>;
});

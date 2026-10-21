import { useEffect, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import type { NowAction } from '../src/hermes/agent-now.js';
import './now-line.css';

function clock(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
function ago(timestamp: number, now: number): string {
  const seconds = Math.max(0, Math.round(now / 1000 - timestamp));
  return seconds < 60 ? `${seconds}s ago` : seconds < 3600 ? `${Math.floor(seconds / 60)}m ago` : `${Math.floor(seconds / 3600)}h ago`;
}
/** What the running turn is doing now, pinned above the composer. Only the label is announced: the elapsed
 *  time and the reasoning preview are visual, so the live region speaks once per step change. */
export function NowLine({ action, onJump }: { action?: NowAction; onJump: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  const ticking = action?.startedAt !== undefined;
  useEffect(() => {
    if (!ticking) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [ticking, action?.startedAt]);
  if (!action) return null;
  // Shown only while the running row is scrolled out of view; the button brings that row back on screen.
  return <div className="now-line" data-kind={action.kind} role="status" aria-live="polite">
    <button type="button" className="now-jump" onClick={onJump} title="Show this step in the conversation">
      <LoaderCircle size={14} className={action.kind === 'last' ? undefined : 'spin'} aria-hidden="true" focusable="false"/>
      <span className="now-label">{action.label}</span>
      {action.detail && <span className="now-detail" aria-hidden="true">{action.detail}</span>}
      {action.startedAt !== undefined && <span className="now-time" aria-hidden="true">{clock(now - action.startedAt)}</span>}
      {action.timestamp !== undefined && <span className="now-time" aria-hidden="true">{ago(action.timestamp, now)}</span>}
    </button>
  </div>;
}

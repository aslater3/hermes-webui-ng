import { Target, X } from 'lucide-react';
import type { NativeSession } from '../src/hermes/native-session.js';
import { goalLine } from '../src/hermes/session-automation.js';
import './session-automation.css';

/** Goal/loop verdicts and command acks Hermes sent while attached. Ephemeral: dismiss or reload clears them. */
export function AutomationNotices({ owner }: { owner: NativeSession }) {
  const notices = owner.state.notices ?? [];
  if (!notices.length) return null;
  return <section className="automation-notices" aria-label="Goal and command updates">
    {notices.map(notice => <div key={notice.id} className="automation-notice" data-kind={notice.kind} role="status">
      <p>{notice.text}</p>
      <button type="button" className="automation-dismiss" aria-label="Dismiss update" title="Dismiss" onClick={() => owner.dismissNotice(notice.id)}><X size={15}/></button>
    </div>)}
  </section>;
}

/** Persistent goal state above the composer while a goal is active or paused. */
export function GoalStrip({ owner }: { owner: NativeSession }) {
  const goal = owner.state.goal;
  if (!goal || goal.status === 'done') return null;
  const state = goal.awaitingInput ? 'input' : goal.status;
  const detail = goal.awaitingInput
    ? `${goal.pausedReason?.replace(/^awaiting user input:\s*/, '') ?? 'Hermes needs your input.'} Reply and the goal resumes automatically.`
    : goal.status === 'paused'
      ? `${goal.pausedReason ?? 'Paused.'} Send /goal resume to continue.`
      : goal.lastReason;
  return <details className="goal-strip" data-state={state}>
    <summary><Target size={14} aria-hidden="true"/><span className="goal-strip-line">{goalLine(goal)}</span><span className="goal-strip-title">{goal.title}</span></summary>
    <div className="goal-strip-body">
      <p className="goal-strip-full">{goal.title}</p>
      {detail && <p>{detail}</p>}
    </div>
  </details>;
}

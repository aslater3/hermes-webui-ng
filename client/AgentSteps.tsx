import { memo, useState } from 'react';
import { Brain, CircleCheck, CircleDashed, CircleX, Wrench } from 'lucide-react';
import { HermesMark } from './HermesMark.js';
import { STEPS_VISIBLE, type AgentStep, type ToolStep } from '../src/hermes/agent-steps.js';
import './agent-steps.css';

function Outcome({ step }: { step: ToolStep }) {
  const Icon = step.outcome === 'ok' ? CircleCheck : step.outcome === 'failed' ? CircleX : CircleDashed;
  // The verdict text carries the meaning; the icon is decoration, so colour and shape never stand alone.
  return <span className="step-outcome" data-outcome={step.outcome}><Icon size={14} aria-hidden="true" focusable="false"/>{step.verdict}</span>;
}
function Row({ step }: { step: AgentStep }) {
  if (step.kind === 'reasoning') return <details className="agent-step step-reasoning" data-step="reasoning">
    <summary><Brain size={15} aria-hidden="true" focusable="false"/><span className="step-title">Reasoning</span><span className="step-detail">{step.preview}</span></summary>
    <pre className="plain-message">{step.text}</pre>
    {step.truncated && <p className="muted small">This reasoning reached the display limit.</p>}
  </details>;
  return <details className="agent-step step-tool" data-role="tool" data-step="tool" data-outcome={step.outcome}>
    <summary><Wrench size={15} aria-hidden="true" focusable="false"/><strong className="step-title">{step.name}</strong>{step.summary && <code className="step-detail">{step.summary}</code>}<Outcome step={step}/>{step.duration && <span className="step-duration">{step.duration}</span>}</summary>
    {step.orphan
      ? <pre className="plain-message">{step.output || step.summary || 'No details recorded'}</pre>
      : <>
        <p className="step-field">Arguments</p><pre className="plain-message">{step.args || 'No arguments recorded'}</pre>
        <p className="step-field">Output</p><pre className="plain-message">{step.output || 'No output recorded'}</pre>
      </>}
  </details>;
}
/** One Hermes block for a run of tool and reasoning steps: a compact timeline, newest rows last. */
export const AgentSteps = memo(function AgentSteps({ steps }: { steps: AgentStep[] }) {
  const [expanded, setExpanded] = useState(false);
  const collapsible = steps.length > STEPS_VISIBLE;
  const hidden = collapsible && !expanded ? steps.length - STEPS_VISIBLE : 0;
  const visible = hidden ? steps.slice(-STEPS_VISIBLE) : steps;
  const failed = steps.filter(step => step.kind === 'tool' && step.outcome === 'failed').length;
  return <article className="message message-assistant agent-steps" data-role="steps">
    <div className="message-label"><span className="assistant-mark" aria-hidden="true"><HermesMark size={15}/></span><span>Hermes</span></div>
    <section className="agent-steps-block" aria-label={`Agent steps (${steps.length})`}>
      <p className="agent-steps-title">Agent steps ({steps.length}){failed > 0 && <span className="agent-steps-failed" data-outcome="failed"> · {failed} failed</span>}</p>
      {hidden > 0 && <button type="button" className="agent-steps-more" onClick={() => setExpanded(true)}>Show {hidden} earlier step{hidden === 1 ? '' : 's'}</button>}
      <ol className="agent-step-list">{visible.map(step => <li key={step.key}><Row step={step}/></li>)}</ol>
      {collapsible && expanded && <button type="button" className="agent-steps-more" onClick={() => setExpanded(false)}>Show only the last {STEPS_VISIBLE} steps</button>}
    </section>
  </article>;
});

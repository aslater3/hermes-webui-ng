import { useState } from 'react';
import { Gauge } from 'lucide-react';
import { contextPercent, type SessionUsage } from '../src/hermes/session-usage.js';
import { Modal } from './primitives.js';
import './session-usage.css';

const count = (value?: number) => value === undefined ? 'Not reported' : value.toLocaleString('en-GB');
const percentage = (value: number) => `${value.toLocaleString('en-GB', { maximumFractionDigits: 1 })}%`;

/** Runtime counters, not billing estimates or a locally persisted usage ledger. */
export function UsageDetails({ usage, historical = false }: { usage?: SessionUsage; historical?: boolean }) {
  const percent = contextPercent(usage);
  return <section className="session-usage" aria-label="Session usage and context">
    <h3>Usage &amp; context</h3>
    {historical && <p className="small muted">Latest native session counters, not the earlier history page.</p>}
    {!usage ? <p className="small muted">Usage is not reported for this session yet. It may be unavailable on this Hermes version.</p> : <>
      <div className="usage-context"><span>Context window</span><strong>{percent === undefined ? 'Not reported' : percentage(percent)}</strong></div>
      {percent !== undefined && <progress aria-label="Context window used" max={100} value={Math.min(percent, 100)}/>}
      <p className="small muted">{usage.contextUsed !== undefined ? `${count(usage.contextUsed)} tokens used` : 'Used tokens not reported'} · {usage.contextMax !== undefined ? `${count(usage.contextMax)} limit` : 'Limit not reported'}{usage.contextEstimated === true ? ' · Estimated by Hermes' : ''}</p>
      <dl className="usage-counters">
        {([
          ['Input tokens', usage.input], ['Output tokens', usage.output], ['Reasoning tokens', usage.reasoning],
          ['Total tokens', usage.total], ['API calls', usage.calls], ['Context compressions', usage.compressions],
        ] as const).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{count(value)}</dd></div>)}
      </dl>
      <p className="small muted">Hermes runtime counters, not a billing estimate or guaranteed lifetime totals. Context occupancy is separate from cumulative token use.</p>
    </>}
  </section>;
}

/** Unmounted/keyed by the caller at session, profile, account and connection boundaries. */
export function UsageButton({ usage }: { usage?: SessionUsage }) {
  const [open, setOpen] = useState(false), percent = contextPercent(usage);
  return <><button type="button" className="usage-button" aria-label="View session usage and context" aria-haspopup="dialog" onClick={event => { event.currentTarget.focus({ preventScroll: true }); setOpen(true); }}>
    <Gauge size={14}/><span>{percent === undefined ? 'Usage & context' : `Context ${percentage(percent)}`}{usage?.contextEstimated === true && percent !== undefined ? ' · est.' : ''}</span>
  </button>{open && <Modal title="Usage & context" kind="usage" onClose={() => setOpen(false)}><UsageDetails usage={usage}/></Modal>}</>;
}

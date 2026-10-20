import './management.css';
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, RefreshCw, Search, Sparkles } from 'lucide-react';
import type { AppRuntime } from './runtime.js';
import { Modal, Notice } from './primitives.js';
import Markdown from './Markdown.js';
import { SkillBrowser } from '../src/hermes/skill-browser.js';
import type { SkillRow } from '../src/hermes/skills.js';

const PROVENANCE: Record<SkillRow['provenance'], string> = { hub: 'Hub', bundled: 'Bundled', external: 'External', agent: 'Local', unknown: 'Unlabelled' };

/** Management is read-first. Only the tabs Hermes can serve are rendered; no disabled placeholders. */
export function Management({ runtime: rt, onClose }: { runtime: AppRuntime; onClose: () => void }) {
  const [tab] = useState<'skills'>('skills');
  const [, setTick] = useState(0);
  useEffect(() => rt.connection.capabilities.subscribe(() => setTick(value => value + 1)), [rt]);
  const capability = rt.connection.capabilities.snapshot().skills;
  const profile = rt.chat.selected?.profile || undefined;
  const browser = useMemo(() => new SkillBrowser(rt.dashboard), [rt]);
  useEffect(() => () => browser.dispose(), [browser]);
  return <Modal title="Manage" kind="management" onClose={onClose}>
    <div className="management-tabs" role="tablist" aria-label="Management sections">
      <button type="button" role="tab" id="management-tab-skills" aria-selected={tab === 'skills'} aria-controls="management-panel" className="management-tab" data-initial-focus>
        <Sparkles size={16}/>Skills
      </button>
    </div>
    <div className="management-body" id="management-panel" role="tabpanel" aria-labelledby="management-tab-skills">
      {capability.state === 'unavailable' ? <Notice>Not supported by this Hermes version.</Notice>
        : capability.state === 'unknown' || capability.state === 'unreachable' || capability.state === 'auth-required' || capability.state === 'forbidden'
          ? <p className="muted" role="status">{capability.state === 'unknown' ? 'Checking Hermes capabilities…' : 'Skills are unavailable until Hermes connection is restored. Reconnect and try again.'}</p>
          : <SkillsPanel browser={browser} profile={profile}/>}
    </div>
  </Modal>;
}

function SkillsPanel({ browser, profile }: { browser: SkillBrowser; profile?: string }) {
  const [, setVersion] = useState(0), [query, setQuery] = useState(''), [selected, setSelected] = useState<string>();
  useEffect(() => browser.subscribe(() => setVersion(value => value + 1)), [browser]);
  useEffect(() => { void browser.load(profile); }, [browser, profile]);
  // A profile switch is a new scope: the previously opened skill must not stay visible.
  useEffect(() => setSelected(undefined), [profile]);
  const { list, detail } = browser;
  const scope = profile || 'default';
  const needle = query.trim().toLowerCase();
  const rows = list.rows.filter(row => !needle || [row.name, row.description, row.category].some(value => value.toLowerCase().includes(needle)));
  const openSkill = (name: string) => { setSelected(name); void browser.open(name, list.profile); };
  const closeSkill = () => { setSelected(undefined); browser.closeDetail(); };
  return <div className="skills-panel">
    <div className="skills-toolbar">
      <label className="skills-search"><Search size={17} aria-hidden="true"/><span className="sr-only">Search skills</span>
        <input type="search" value={query} placeholder="Search skills" onChange={event => setQuery(event.target.value)} autoComplete="off" enterKeyHint="search"/></label>
      <button type="button" className="secondary skills-refresh" onClick={() => void browser.load(profile)} disabled={list.phase === 'loading'}><RefreshCw size={15}/>Refresh</button>
    </div>
    <p className="small muted">{scope} profile · read-only. Change skills in Hermes.</p>
    {list.phase === 'error' && list.error && <Notice error>{list.stale ? 'Refresh failed. Showing the last loaded skills. ' : ''}{list.error.message}</Notice>}
    <div className="skills-layout" data-detail={selected ? 'open' : 'closed'}>
      <section className="skills-list" aria-label="Skills" aria-busy={list.phase === 'loading'}>
        {list.phase === 'loading' && !list.rows.length && <p role="status" className="muted">Loading skills for {scope}…</p>}
        {list.phase === 'ready' && !list.rows.length && <p className="muted">No skills are installed for the {scope} profile.</p>}
        {list.rows.length > 0 && !rows.length && <p className="muted">No skills match “{query.trim()}”.</p>}
        <ul>{rows.map(row => <li key={row.name}><button type="button" className="skill-row" aria-current={selected === row.name ? 'true' : undefined} onClick={() => openSkill(row.name)}>
          <span className="skill-row-name">{row.name}</span>
          {row.description && <span className="skill-row-description">{row.description}</span>}
          <span className="skill-row-meta">{[row.category || 'uncategorised', PROVENANCE[row.provenance], row.enabled ? undefined : 'Disabled in Hermes'].filter(Boolean).join(' · ')}</span>
        </button></li>)}</ul>
      </section>
      {selected && <section className="skill-detail" aria-label={`Skill: ${selected}`}>
        <button type="button" className="secondary skill-back" onClick={closeSkill}><ArrowLeft size={16}/>All skills</button>
        {detail.phase === 'loading' && <p role="status" className="muted">Loading {selected}…</p>}
        {detail.phase === 'error' && detail.error && <Notice error>{detail.error.message}<button type="button" className="secondary" onClick={() => void browser.open(selected, list.profile)}>Retry</button></Notice>}
        {detail.phase === 'ready' && detail.document && detail.name === selected && <>
          <h3>{detail.document.name}</h3>
          {detail.document.truncated && <p className="small muted" role="note">Long skill shown up to the first 200,000 characters.</p>}
          <div className="skill-markdown"><Markdown text={detail.document.content}/></div>
        </>}
      </section>}
    </div>
  </div>;
}

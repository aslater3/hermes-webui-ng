import './management.css';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Activity, ArrowLeft, Brain, Clock, ExternalLink, Pause, Play, Plug, RefreshCw, Search, Sparkles } from 'lucide-react';
import type { AppRuntime } from './runtime.js';
import { Modal, Notice } from './primitives.js';
import Markdown from './Markdown.js';
import { SkillBrowser } from '../src/hermes/skill-browser.js';
import type { SkillRow } from '../src/hermes/skills.js';
import { MemoryBrowser } from '../src/hermes/memory-browser.js';
import { CronBrowser, ACTION_LABELS } from '../src/hermes/cron-browser.js';
import type { CapabilityMap } from '../src/hermes/capabilities.js';
import type { CronActionKind, CronJob, CronJobState } from '../src/hermes/cron.js';
import { McpBrowser } from '../src/hermes/mcp-browser.js';
import type { McpServer } from '../src/hermes/mcp.js';
import { DiagnosticsBrowser, type DiagnosticsSection } from '../src/hermes/diagnostics-browser.js';
import type { HermesHealth, HermesStatus, SystemStats } from '../src/hermes/hermes-status.js';

const PROVENANCE: Record<SkillRow['provenance'], string> = { hub: 'Hub', bundled: 'Bundled', external: 'External', agent: 'Local', unknown: 'Unlabelled' };
const STATE_LABEL: Record<CronJobState, string> = { scheduled: 'Scheduled', paused: 'Paused', completed: 'Completed', error: 'Error', unknown: 'Unknown state' };
const PROVIDER_STATUS: Record<string, string> = { ready: 'Ready', needs_config: 'Needs configuration', unavailable: 'Unavailable', missing: 'Missing in Hermes', unknown: 'Unknown' };

type TabId = 'skills' | 'memory' | 'cron' | 'mcp' | 'diagnostics' | 'dashboard';
const TABS: { id: TabId; label: string; icon: ReactNode; available: (caps: CapabilityMap) => boolean }[] = [
  { id: 'skills', label: 'Skills', icon: <Sparkles size={16}/>, available: caps => caps.skills.state === 'available' },
  { id: 'memory', label: 'Memory', icon: <Brain size={16}/>, available: caps => caps.memory.state === 'available' },
  { id: 'cron', label: 'Cron', icon: <Clock size={16}/>, available: caps => caps.cronJobs.state === 'available' },
  { id: 'mcp', label: 'MCP', icon: <Plug size={16}/>, available: caps => caps.mcpServers.state === 'available' },
  { id: 'diagnostics', label: 'Diagnostics', icon: <Activity size={16}/>, available: caps => caps.health.state === 'available' },
  // Guidance only. It is offered whenever another Hermes-backed tab is, and never links to a Dashboard URL NG cannot prove reachable.
  { id: 'dashboard', label: 'Hermes Dashboard', icon: <ExternalLink size={16}/>, available: caps => ['skills', 'memory', 'cron', 'mcp', 'diagnostics'].some(id => TABS.find(item => item.id === id)?.available(caps)) },
];
const TRANSIENT = ['unreachable', 'auth-required', 'forbidden'];

/**
 * Management is read-first. Only the tabs Hermes can serve are rendered; no disabled placeholders.
 * Cron actions are the one write path, and only in gated mode (see ADR-029).
 */
export function Management({ runtime: rt, onClose, onSettings }: { runtime: AppRuntime; onClose: () => void; onSettings?: () => void }) {
  const [, setTick] = useState(0);
  useEffect(() => rt.connection.capabilities.subscribe(() => setTick(value => value + 1)), [rt]);
  const caps = rt.connection.capabilities.snapshot();
  const tabs = TABS.filter(tab => tab.available(caps));
  const [requested, setRequested] = useState<TabId>('skills');
  const tab = tabs.find(item => item.id === requested)?.id ?? tabs[0]?.id;
  const profile = rt.chat.selected?.profile || undefined;
  const scope = profile || 'default';
  const browsers = useMemo(() => ({
    skills: new SkillBrowser(rt.dashboard),
    memory: new MemoryBrowser(rt.dashboard),
    cron: new CronBrowser(rt.dashboard),
    mcp: new McpBrowser(rt.dashboard),
    diagnostics: new DiagnosticsBrowser(rt.dashboard),
  }), [rt]);
  useEffect(() => () => { browsers.skills.dispose(); browsers.memory.dispose(); browsers.cron.dispose(); browsers.mcp.dispose(); browsers.diagnostics.dispose(); }, [browsers]);
  const actionsOffered = caps.cronActions.state === 'available';
  const actionsBlockedByMode = rt.dashboard.admissionMode === 'trusted-local';
  const states = Object.values(caps);
  const message = states.some(item => item.state === 'unknown') ? 'Checking Hermes capabilities…'
    : states.some(item => TRANSIENT.includes(item.state)) ? 'Management is unavailable until the Hermes connection is restored. Reconnect and try again.'
      : 'Not supported by this Hermes version.';
  return <Modal title="Manage" kind="management" onClose={onClose}>
    {tabs.length > 0 && <div className="management-tabs" role="tablist" aria-label="Management sections">
      {tabs.map(item => <button key={item.id} type="button" role="tab" id={`management-tab-${item.id}`} aria-selected={tab === item.id}
        aria-controls="management-panel" className="management-tab" data-initial-focus={item.id === tab || undefined} onClick={() => setRequested(item.id)}>
        {item.icon}{item.label}
      </button>)}
    </div>}
    <div className="management-body" id="management-panel" role={tabs.length ? 'tabpanel' : undefined} aria-labelledby={tab ? `management-tab-${tab}` : undefined}>
      {tab === 'skills' && <SkillsPanel browser={browsers.skills} profile={profile}/>}
      {tab === 'memory' && <MemoryPanel browser={browsers.memory} profile={profile}/>}
      {tab === 'cron' && <CronPanel browser={browsers.cron} scope={scope} actions={actionsOffered} actionsBlockedByMode={actionsBlockedByMode}/>}
      {tab === 'mcp' && <McpPanel browser={browsers.mcp} profile={profile}/>}
      {tab === 'diagnostics' && <DiagnosticsPanel browser={browsers.diagnostics} profile={profile} stats={caps.systemStats.state === 'available'} runtime={rt} onSettings={onSettings}/>}
      {tab === 'dashboard' && <DashboardGuidance/>}
      {!tab && <Notice>{message}</Notice>}
    </div>
  </Modal>;
}

function useBrowser(browser: { subscribe(listener: () => void): () => void }) {
  const [, setVersion] = useState(0);
  useEffect(() => browser.subscribe(() => setVersion(value => value + 1)), [browser]);
}

function SkillsPanel({ browser, profile }: { browser: SkillBrowser; profile?: string }) {
  const [query, setQuery] = useState(''), [selected, setSelected] = useState<string>();
  useBrowser(browser);
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
      {!selected && <p className="detail-placeholder">Select a skill to read its instructions.</p>}
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

function formatBytes(value: number): string {
  return value < 1024 ? `${value} B` : `${(value / 1024).toFixed(1)} KB`;
}
function formatTime(value: number): string {
  return new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function MemoryPanel({ browser, profile }: { browser: MemoryBrowser; profile?: string }) {
  useBrowser(browser);
  useEffect(() => { void browser.load(profile); }, [browser, profile]);
  const { state } = browser;
  const scope = profile || 'default';
  return <div className="memory-panel">
    <div className="skills-toolbar">
      <button type="button" className="secondary skills-refresh" onClick={() => void browser.load(profile)} disabled={state.phase === 'loading'}><RefreshCw size={15}/>Refresh</button>
    </div>
    <p className="small muted">{scope} profile · read-only. Change memory in Hermes.</p>
    {state.phase === 'error' && state.error && <Notice error>{state.stale ? 'Refresh failed. Showing the last loaded memory status. ' : ''}{state.error.message}</Notice>}
    {state.phase === 'loading' && !state.status && <p role="status" className="muted">Loading memory for {scope}…</p>}
    {state.status && <>
      <dl className="memory-facts" aria-label="Memory summary">
        <div><dt>Active provider</dt><dd>{state.status.active || 'None (built-in memory only)'}</dd></div>
        <div><dt>MEMORY.md</dt><dd>{formatBytes(state.status.builtinFiles.memory)}</dd></div>
        <div><dt>USER.md</dt><dd>{formatBytes(state.status.builtinFiles.user)}</dd></div>
      </dl>
      {state.status.providers.length === 0 && <p className="muted">No memory providers are installed for the {scope} profile.</p>}
      {state.status.providers.length > 0 && <section aria-label="Memory providers">
        <ul className="memory-providers">{state.status.providers.map(provider => <li key={provider.name} className="memory-provider">
          <span className="skill-row-name">{provider.name}{provider.name === state.status?.active ? ' (active)' : ''}</span>
          {provider.description && <span className="skill-row-description">{provider.description}</span>}
          <span className="skill-row-meta">{[PROVIDER_STATUS[provider.status] ?? 'Unknown', provider.configured ? 'Configured' : 'Not configured', provider.available ? undefined : 'Not available'].filter(Boolean).join(' · ')}</span>
        </li>)}</ul>
      </section>}
    </>}
  </div>;
}

function stateLabel(job: CronJob): string {
  return STATE_LABEL[job.state] ?? 'Unknown state';
}
function actionsFor(job: CronJob): CronActionKind[] {
  if (job.state === 'completed') return [];
  return job.enabled ? ['pause', 'trigger'] : ['resume', 'trigger'];
}
function confirmCopy(kind: CronActionKind, job: CronJob): string {
  if (kind === 'pause') return `Hermes will not run “${job.name}” on schedule until it is resumed.`;
  if (kind === 'resume') return `Hermes will run “${job.name}” again on its schedule.`;
  return job.enabled ? `Hermes starts one run of “${job.name}” now, outside its schedule.` : `“${job.name}” is paused. Running it now resumes the job and starts one run.`;
}

function CronPanel({ browser, scope, actions, actionsBlockedByMode }: { browser: CronBrowser; scope: string; actions: boolean; actionsBlockedByMode: boolean }) {
  const [selected, setSelected] = useState<string>();
  const [confirm, setConfirm] = useState<{ kind: CronActionKind; job: CronJob }>();
  useBrowser(browser);
  useEffect(() => { void browser.load(scope); }, [browser, scope]);
  // A profile switch is a new scope: the open job and any confirmation must not survive it.
  useEffect(() => { setSelected(undefined); setConfirm(undefined); }, [scope]);
  const { list, detail, action } = browser;
  const openJob = (id: string) => { setSelected(id); void browser.open(id); };
  const closeJob = () => { setSelected(undefined); setConfirm(undefined); browser.closeDetail(); };
  const job = detail.phase === 'ready' && detail.jobId === selected ? detail.job : undefined;
  const busy = action.phase === 'pending';
  return <div className="cron-panel">
    <div className="skills-toolbar">
      <button type="button" className="secondary skills-refresh" onClick={() => void browser.load(scope)} disabled={list.phase === 'loading'}><RefreshCw size={15}/>Refresh</button>
    </div>
    <p className="small muted">{scope} profile · {actions ? 'pause, resume and run-now need confirmation' : 'read-only'}.</p>
    {actionsBlockedByMode && <p className="small muted" role="note">Pause, resume and run-now are available when signed in through the Hermes Dashboard.</p>}
    {list.phase === 'error' && list.error && <Notice error>{list.stale ? 'Refresh failed. Showing the last loaded jobs. ' : ''}{list.error.message}</Notice>}
    <div className="cron-layout" data-detail={selected ? 'open' : 'closed'}>
      <section className="cron-list" aria-label="Cron jobs" aria-busy={list.phase === 'loading'}>
        {list.phase === 'loading' && !list.rows.length && <p role="status" className="muted">Loading cron jobs for {scope}…</p>}
        {list.phase === 'ready' && !list.rows.length && <p className="muted">No cron jobs are scheduled for the {scope} profile.</p>}
        <ul>{list.rows.map(row => <li key={row.id}><button type="button" className="cron-row" aria-current={selected === row.id ? 'true' : undefined} onClick={() => openJob(row.id)}>
          <span className="cron-row-name">{row.name}</span>
          <span className="cron-row-meta">{[row.schedule || 'Schedule unknown', stateLabel(row), row.nextRunAt && row.enabled ? `next ${formatTime(row.nextRunAt)}` : undefined, row.lastStatus ? `last ${row.lastStatus}` : undefined, row.failureStreak ? `${row.failureStreak} failures in a row` : undefined].filter(Boolean).join(' · ')}</span>
        </button></li>)}</ul>
      </section>
      {!selected && <p className="detail-placeholder">Select a job to see its schedule and recent runs.</p>}
      {selected && <section className="cron-detail" aria-label={`Cron job: ${job?.name ?? selected}`}>
        <button type="button" className="secondary cron-back" onClick={closeJob}><ArrowLeft size={16}/>All jobs</button>
        {detail.phase === 'loading' && <p role="status" className="muted">Loading job…</p>}
        {detail.phase === 'error' && detail.error && detail.jobId === selected && <Notice error>{detail.error.message}<button type="button" className="secondary" onClick={() => void browser.open(selected)}>Retry</button></Notice>}
        {job && <>
          <h3>{job.name}</h3>
          <dl className="cron-facts">
            <div><dt>Schedule</dt><dd>{job.schedule || 'Unknown'}</dd></div>
            <div><dt>State</dt><dd>{stateLabel(job)}</dd></div>
            <div><dt>Next run</dt><dd>{job.nextRunAt && job.enabled ? formatTime(job.nextRunAt) : 'None scheduled'}</dd></div>
            <div><dt>Last run</dt><dd>{job.lastRunAt ? formatTime(job.lastRunAt) : 'Never'}{job.lastStatus ? ` · ${job.lastStatus}` : ''}</dd></div>
            {job.failureStreak > 0 && <div><dt>Failures in a row</dt><dd>{job.failureStreak}</dd></div>}
            {job.repeat.total !== undefined && <div><dt>Runs</dt><dd>{job.repeat.completed} of {job.repeat.total}</dd></div>}
          </dl>
          {job.lastError && <Notice error>Last error: {job.lastError}</Notice>}
          {job.pausedReason && <p className="small muted">{job.pausedReason}</p>}
          {actions && actionsFor(job).length > 0 && <div className="cron-actions" role="group" aria-label="Job actions">
            {actionsFor(job).map(kind => <button key={kind} type="button" className={kind === 'trigger' ? 'primary' : 'secondary'} disabled={busy}
              onClick={() => setConfirm({ kind, job })}>
              {kind === 'pause' ? <Pause size={16}/> : <Play size={16}/>}{ACTION_LABELS[kind].verb}
            </button>)}
          </div>}
          {!actions && actionsBlockedByMode && <p className="small muted">Actions are unavailable in this sign-in mode.</p>}
          {!actions && !actionsBlockedByMode && <p className="small muted">Cron actions are not supported by this Hermes version.</p>}
          {action.jobId === selected && action.phase === 'pending' && <p role="status" className="muted">Working… Hermes is applying this change.</p>}
          {action.jobId === selected && action.phase === 'done' && <div className="notice" role="status">{action.message}<button type="button" className="secondary" onClick={() => browser.dismissAction()}>Dismiss</button></div>}
          {action.jobId === selected && (action.phase === 'failed' || action.phase === 'unknown') && <Notice error>{action.message}
            <button type="button" className="secondary" onClick={() => browser.dismissAction()}>Dismiss</button>
            {action.phase === 'unknown' && <button type="button" className="secondary" onClick={() => void browser.open(selected)}>Refresh job</button>}</Notice>}
          <h4>Recent runs</h4>
          {detail.runsError && <Notice error>{detail.runsError.message}</Notice>}
          {!detail.runsError && detail.runs.length === 0 && <p className="muted">No runs yet.</p>}
          {detail.runs.length > 0 && <ul className="cron-runs" aria-label="Recent runs">{detail.runs.map(run => <li key={run.id} className="cron-run">
            <span className="skill-row-name">{run.title}{run.active ? ' (running)' : ''}</span>
            {run.startedAt && <span className="skill-row-meta">{formatTime(run.startedAt)}</span>}
            {run.preview && <span className="skill-row-description">{run.preview}</span>}
          </li>)}</ul>}
        </>}
      </section>}
    </div>
    {confirm && <Modal title={`${ACTION_LABELS[confirm.kind].verb} job?`} kind="management-confirm" onClose={() => setConfirm(undefined)}>
      <p className="cron-confirm-copy">{confirmCopy(confirm.kind, confirm.job)}</p>
      <div className="cron-confirm-buttons">
        <button type="button" className="secondary" data-initial-focus onClick={() => setConfirm(undefined)}>Cancel</button>
        <button type="button" className={confirm.kind === 'trigger' ? 'primary' : 'secondary'} disabled={busy}
          onClick={() => { const next = confirm; setConfirm(undefined); void browser.runAction(next.kind, next.job.id); }}>
          {ACTION_LABELS[confirm.kind].verb}
        </button>
      </div>
    </Modal>}
  </div>;
}

const TRANSPORT_LABEL: Record<McpServer['transport'], string> = { http: 'HTTP', stdio: 'Local process', unknown: 'Unknown transport' };
function mcpToolLabel(server: McpServer): string {
  if (server.toolCount === undefined) return 'All tools';
  return server.toolCount === 1 ? '1 tool selected' : `${server.toolCount} tools selected`;
}

function McpPanel({ browser, profile }: { browser: McpBrowser; profile?: string }) {
  useBrowser(browser);
  useEffect(() => { void browser.load(profile); }, [browser, profile]);
  const { state } = browser;
  const scope = profile || 'default';
  return <div className="mcp-panel">
    <div className="skills-toolbar">
      <button type="button" className="secondary skills-refresh" onClick={() => void browser.load(profile)} disabled={state.phase === 'loading'}><RefreshCw size={15}/>Refresh</button>
    </div>
    <p className="small muted">{scope} profile · read-only. Add, test and sign in to MCP servers in Hermes.</p>
    <p className="small muted">Connection status and last errors are not reported by this Hermes version.</p>
    {state.phase === 'error' && state.error && <Notice error>{state.stale ? 'Refresh failed. Showing the last loaded servers. ' : ''}{state.error.message}</Notice>}
    {state.phase === 'loading' && !state.rows.length && <p role="status" className="muted">Loading MCP servers for {scope}…</p>}
    {state.phase === 'ready' && !state.rows.length && <p className="muted">No MCP servers are configured for the {scope} profile.</p>}
    {state.rows.length > 0 && <section aria-label="MCP servers">
      <ul className="memory-providers">{state.rows.map(server => <li key={server.name} className="memory-provider">
        <span className="skill-row-name">{server.name}</span>
        <span className="skill-row-meta">{[TRANSPORT_LABEL[server.transport], server.enabled ? 'Enabled' : 'Disabled in Hermes', server.auth || undefined, mcpToolLabel(server), server.plugin ? `Plugin ${server.plugin}` : undefined].filter(Boolean).join(' · ')}</span>
      </li>)}</ul>
    </section>}
  </div>;
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400), hours = Math.floor((seconds % 86400) / 3600), minutes = Math.floor((seconds % 3600) / 60);
  return days ? `${days} d ${hours} h` : hours ? `${hours} h ${minutes} min` : `${minutes} min`;
}
function Section<T>({ label, section, children }: { label: string; section: DiagnosticsSection<T>; children: (value: T) => ReactNode }) {
  return <section aria-label={label} className="diagnostics-section">
    <h3>{label}</h3>
    {section.error && <Notice error>{section.stale ? 'Refresh failed. Showing the last values. ' : ''}{section.error.message}</Notice>}
    {section.value !== undefined && <dl className="memory-facts">{children(section.value)}</dl>}
    {section.value === undefined && !section.error && <p role="status" className="muted">Loading…</p>}
  </section>;
}

function DiagnosticsPanel({ browser, profile, stats, runtime: rt, onSettings }: { browser: DiagnosticsBrowser; profile?: string; stats: boolean; runtime: AppRuntime; onSettings?: () => void }) {
  useBrowser(browser);
  useEffect(() => { void browser.load(profile, stats); }, [browser, profile, stats]);
  const { state } = browser;
  const scope = profile || 'default';
  const report = rt.connection.report();
  const mode = rt.dashboard.admissionMode === 'trusted-local' ? 'Trusted LAN (no browser login)' : 'Signed in through the Hermes Dashboard';
  return <div className="diagnostics-panel">
    <div className="skills-toolbar">
      <button type="button" className="secondary skills-refresh" onClick={() => void browser.load(profile, stats)} disabled={state.phase === 'loading'}><RefreshCw size={15}/>Refresh</button>
    </div>
    <p className="small muted">{scope} profile · read-only. Metadata only: no paths, ports, hostnames or process IDs.</p>
    <Section<NgFacts> label="HermesUI NG" section={{ value: { version: report.webui.version, protocol: report.webui.protocol, auth: rt.connection.state.auth, rest: rt.connection.state.rest, gateway: rt.gateway.state.phase, mode }, stale: false }}>
      {facts => <>
        <div><dt>Version</dt><dd>{facts.version}</dd></div>
        <div><dt>Protocol</dt><dd>{facts.protocol}</dd></div>
        <div><dt>Access</dt><dd>{facts.mode}</dd></div>
        <div><dt>Dashboard REST</dt><dd>{facts.rest}</dd></div>
        <div><dt>Native Gateway</dt><dd>{facts.gateway}</dd></div>
      </>}
    </Section>
    <Section<HermesStatus> label="Hermes" section={state.status}>
      {status => <>
        <div><dt>Version</dt><dd>{status.version || 'Not reported'}{status.releaseDate ? ` · released ${status.releaseDate}` : ''}</dd></div>
        <div><dt>Gateway</dt><dd>{status.gatewayRunning === undefined ? 'Not reported' : status.gatewayRunning ? 'Running' : 'Not running'}{status.gatewayState ? ` · ${status.gatewayState}` : ''}</dd></div>
        <div><dt>Active agents</dt><dd>{status.activeAgents}</dd></div>
        <div><dt>Active sessions</dt><dd>{status.activeSessions}</dd></div>
        <div><dt>Overall health</dt><dd>{status.overall === 'ok' ? 'OK' : status.overall === 'degraded' ? 'Degraded' : 'Not reported'}</dd></div>
        {status.heartbeatStaleSeconds !== undefined && <div><dt>Heartbeat</dt><dd>Stale for {Math.round(status.heartbeatStaleSeconds)} s</dd></div>}
      </>}
    </Section>
    <Section<HermesHealth> label="Health" section={state.health}>
      {health => <div><dt>Liveness</dt><dd>{health.ok ? 'Responding' : 'Not responding'}{health.version ? ` · ${health.version}` : ''}</dd></div>}
    </Section>
    {stats && <Section<SystemStats> label="Host" section={state.stats}>
      {host => <>
        <div><dt>System</dt><dd>{[host.os, host.osRelease, host.arch].filter(Boolean).join(' ') || 'Not reported'}</dd></div>
        {host.cpuCount !== undefined && <div><dt>CPUs</dt><dd>{host.cpuCount}{host.cpuPercent !== undefined ? ` · ${Math.round(host.cpuPercent)}% busy` : ''}</dd></div>}
        {host.loadAverage && <div><dt>Load average</dt><dd>{host.loadAverage.map(value => value.toFixed(2)).join(' · ')}</dd></div>}
        {host.uptimeSeconds !== undefined && <div><dt>Uptime</dt><dd>{formatUptime(host.uptimeSeconds)}</dd></div>}
        {host.memory && <div><dt>Memory</dt><dd>{formatBytes(host.memory.used)} of {formatBytes(host.memory.total)} · {Math.round(host.memory.percent)}%</dd></div>}
        {host.disk && <div><dt>Hermes disk</dt><dd>{Math.round(host.disk.percent)}% used</dd></div>}
      </>}
    </Section>}
    <section aria-label="Support report" className="diagnostics-section">
      <h3>Support report</h3>
      <p className="small muted">The sanitised support report (copy or download) is in Settings, under Diagnostics.</p>
      {onSettings && <button type="button" className="secondary" onClick={onSettings}>Open Settings diagnostics</button>}
    </section>
  </div>;
}
interface NgFacts { version: string; protocol: string; auth: string; rest: string; gateway: string; mode: string }

function DashboardGuidance() {
  return <div className="dashboard-guidance">
    <p className="small muted">These are not in NG yet. Use the Hermes Dashboard for them.</p>
    <ul className="memory-providers">
      <li className="memory-provider"><span className="skill-row-name">Config</span><span className="skill-row-description">Settings, model and provider configuration.</span></li>
      <li className="memory-provider"><span className="skill-row-name">Providers</span><span className="skill-row-description">Sign-in providers and model providers.</span></li>
      <li className="memory-provider"><span className="skill-row-name">Memory setup</span><span className="skill-row-description">Choosing and configuring memory providers.</span></li>
      <li className="memory-provider"><span className="skill-row-name">Cron editing</span><span className="skill-row-description">Creating, editing and deleting scheduled jobs.</span></li>
      <li className="memory-provider"><span className="skill-row-name">MCP management</span><span className="skill-row-description">Adding, testing, signing in and installing MCP servers.</span></li>
    </ul>
  </div>;
}

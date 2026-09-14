import { ConversationDetails } from './ConversationDetails.js';
import './local-access.css';
import './workspace-trigger.css';
import { lazy, Suspense, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Folder, PanelRight, Command, MessageSquare, MoreHorizontal, PanelLeft, Plus, Search, Settings2, Moon, Sun, Link, History, RefreshCw, KeyRound } from 'lucide-react';
import type { AppRuntime } from './runtime.js';
import { IconButton, Modal, Notice, useMedia, useViewport } from './primitives.js';
import { Sidebar } from './Sidebar.js';
import { Settings } from './Settings.js';
import { SignIn } from './SignIn.js';
import { Conversation } from './Conversation.js';
import { readTheme, applyTheme, THEME_KEY, type Theme } from './preferences.js';
import { connectionSummary } from '../src/hermes/connection-summary.js';

const MutationDialog = lazy(() => import('./workspace/MutationDialog.js'));
const Workspace = lazy(() => import('./workspace/Workspace.js'));

export default function App({ runtime: rt }: { runtime: AppRuntime }) {
  const revision = useSyncExternalStore(rt.subscribe, rt.getSnapshot), mobile = useMedia('(max-width: 850px)');
  const wide = useMedia('(min-width: 1180px)'), [details, setDetails] = useState(false), [files, setFiles] = useState(false);
  const [panel, setPanel] = useState<'settings' | 'commands' | 'sessions' | 'conversation' | null>(null);
  const [collapsed, setCollapsed] = useState(false), [theme, setTheme] = useState<Theme>(readTheme), [commandQuery, setCommandQuery] = useState('');
  const [copyNote, setCopyNote] = useState(''), key = useRef<HTMLInputElement>(null);
  const hasAccess = rt.connection.hasAccess, localAccess = rt.connection.state.auth === 'local-access';
  useViewport();
  useEffect(() => { rt.start(); return () => rt.dispose(); }, [rt]);
  useEffect(() => {
    applyTheme(theme);
    const query = matchMedia('(prefers-color-scheme: dark)'), sync = () => applyTheme(theme);
    const stored = (event: StorageEvent) => { if (event.key === THEME_KEY) setTheme(readTheme()); };
    query.addEventListener('change', sync); window.addEventListener('storage', stored);
    return () => { query.removeEventListener('change', sync); window.removeEventListener('storage', stored); };
  }, [theme]);
  useEffect(() => { if (!hasAccess && panel !== 'settings') setPanel(null); setCopyNote(''); setDetails(false); setFiles(false); }, [rt.accountGeneration]);
  useEffect(() => { if (!mobile && panel === 'sessions') setPanel(null); }, [mobile]);
  const changeTheme = (value: Theme) => { setTheme(value); applyTheme(value, true); };
  const commands = () => { setCommandQuery(''); setPanel('commands'); };
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (rt.pwa.state.updating || rt.workspaceMutations.state.phase !== 'closed') return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setPanel(current => current === 'commands' ? null : 'commands'); setCommandQuery(''); }
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'o' && rt.ready) { event.preventDefault(); rt.newChat(); setPanel(null); }
    };
    window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler);
  }, [rt]);
  const selected = rt.chat.browser.index.rows.find(row => row.id === rt.chat.selected?.id && (!rt.chat.selected?.profile || row.profile === rt.chat.selected.profile));
  const title = selected?.title || (rt.chat.selected ? 'Conversation' : 'New conversation');
  const phase = rt.gateway.state.phase;
  const connectionLabel = rt.connection.state.offline ? 'Offline' : rt.ready ? 'Connected' : phase === 'reconnecting' ? 'Reconnecting' : ['connecting', 'authenticating'].includes(phase) ? 'Connecting' : phase === 'auth-required' ? 'Sign in required' : phase === 'error' ? 'Connection error' : 'Disconnected';
  const palette = [
    { label: 'New conversation', icon: Plus, disabled: !rt.ready, run: () => { rt.newChat(); setPanel(null); } },
    { label: 'Search conversations', icon: Search, disabled: !hasAccess, run: () => { if (mobile || collapsed) { setCollapsed(false); setPanel(mobile ? 'sessions' : null); } else setPanel(null); setTimeout(() => document.getElementById('shell-session-search')?.focus(), 0); } },
    { label: 'Open workspace', icon: Folder, disabled: !hasAccess, run: () => { setPanel(null); setDetails(false); setFiles(true); } },
    { label: 'Conversation details', icon: PanelRight, disabled: !hasAccess, run: () => { setPanel(null); setFiles(false); setDetails(true); } },
    { label: 'Connection and settings', icon: Settings2, run: () => setPanel('settings') },
    { label: 'Reconnect to Hermes', icon: RefreshCw, run: () => { rt.run(() => rt.connection.start()); setPanel(null); } },
    { label: 'Use dark appearance', icon: Moon, run: () => { changeTheme('dark'); setPanel(null); } },
    { label: 'Use light appearance', icon: Sun, run: () => { changeTheme('light'); setPanel(null); } },
  ].filter(item => item.label.toLowerCase().includes(commandQuery.toLowerCase()));
  return <>
    {!hasAccess ? <SignIn key={rt.accountGeneration} runtime={rt} onSettings={() => setPanel('settings')}/> : <div inert={rt.pwa.state.updating} className={`workspace${collapsed ? ' rail-collapsed' : ''}${details && wide ? ' with-details' : ''}${files && wide ? ' with-files' : ''}`}>
      {!mobile && <Sidebar runtime={rt} compact={collapsed} onCollapse={() => setCollapsed(!collapsed)} onChoose={() => { if (collapsed) setCollapsed(false); }} onSettings={() => setPanel('settings')} onCommands={commands}/>}
      <main className="chat-main"><header className="app-header"><div className="header-title">{mobile && <IconButton label="Open conversations" onClick={() => setPanel('sessions')}><PanelLeft size={20}/></IconButton>}{!mobile && <MessageSquare size={17} className="muted"/>}<h1 title={title}>{title}</h1>{!mobile && <span className="header-profile">{rt.chat.selected?.profile || 'default'}</span>}</div>
        <div className="header-actions"><button className={`connection-pill${rt.ready ? ' connected' : ' degraded'}`} aria-label={`Connection status: ${connectionLabel}`} onClick={() => setPanel('settings')}><span className="status-dot"/><span>{connectionLabel}</span></button><IconButton label="Open command palette" onClick={commands}><Command size={18}/></IconButton><IconButton label="Open workspace" onClick={() => { setDetails(false); setFiles(!files); }}><Folder size={18}/></IconButton>{wide && <IconButton label="Toggle conversation details" aria-pressed={details} onClick={() => { setFiles(false); setDetails(!details); }}><PanelRight size={18}/></IconButton>}<IconButton label="Conversation actions" onClick={() => setPanel('conversation')}><MoreHorizontal size={20}/></IconButton></div>
      </header>
      {localAccess && <p className="trusted-local-note" role="note"><strong>Trusted LAN · No login</strong><span>Anyone who can reach this address can use your agent.</span></p>}
      {!rt.ready && <div className="connection-strip" role="status"><span>{connectionSummary(rt.connection.state, rt.gateway.state)}</span><button onClick={() => rt.run(() => rt.connection.start())} disabled={rt.connection.state.busy || rt.connection.state.offline}>Reconnect</button></div>}
      {rt.error && <Notice error>{rt.error}<button aria-label="Dismiss error" onClick={() => { rt.error = ''; rt.notify(); }}>Dismiss</button></Notice>}
      <Conversation runtime={rt} revision={revision}/></main>
      {files && wide && <Suspense fallback={<aside className="file-workspace" role="status">Opening workspace…</aside>}><Workspace runtime={rt} pane onClose={() => setFiles(false)}/></Suspense>}
      {details && wide && <ConversationDetails runtime={rt} pane onClose={() => setDetails(false)}/>}
    </div>}
    {files && !wide && hasAccess && <Modal title="Workspace" kind="workspace" onClose={() => setFiles(false)}><Suspense fallback={<p role="status">Opening workspace…</p>}><Workspace runtime={rt} onClose={() => setFiles(false)}/></Suspense></Modal>}
    {details && !wide && hasAccess && <Modal title="Conversation details" kind="details" onClose={() => setDetails(false)}><ConversationDetails runtime={rt} onClose={() => setDetails(false)}/></Modal>}
    {hasAccess && rt.workspaceMutations.state.phase !== 'closed' && <Suspense fallback={<p role="status">Opening workspace action…</p>}><MutationDialog runtime={rt}/></Suspense>}
    {panel === 'settings' && <Settings key={rt.accountGeneration} runtime={rt} theme={theme} setTheme={changeTheme} onClose={() => setPanel(null)}/>}
    {panel === 'sessions' && <Modal title="Conversations" kind="sessions" onClose={() => setPanel(null)}><Sidebar runtime={rt} onChoose={() => setPanel(null)} onSettings={() => setPanel('settings')} onCommands={commands}/></Modal>}
    {panel === 'commands' && <Modal title="Quick actions" kind="commands" onClose={() => setPanel(null)}><div className="command-search"><Search size={18}/><input data-initial-focus aria-label="Find an action" placeholder="What would you like to do?" value={commandQuery} onChange={event => setCommandQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { const first = palette.find(item => !item.disabled); first?.run(); } }}/></div><div className="command-list">{palette.map(({ label, icon: Icon, disabled, run }) => <button key={label} disabled={disabled} onClick={run}><Icon size={18}/>{label}<span>↵</span></button>)}{!palette.length && <p className="muted">No matching actions.</p>}</div><footer className="command-footer"><span>Tab to navigate · Enter to select</span><span>esc to close</span></footer></Modal>}
    {panel === 'conversation' && <Modal title="Conversation actions" kind="actions" onClose={() => setPanel(null)}><div className="action-list"><button onClick={() => { setPanel(null); setFiles(false); setDetails(true); }}><PanelRight size={17}/>Conversation details</button><button onClick={commands}><Command size={17}/>Quick actions</button><button disabled={!rt.ready} onClick={() => { rt.newChat(); setPanel(null); }}><Plus size={17}/>New conversation</button>
      <button disabled={!rt.chat.selected || !rt.readable} onClick={() => { rt.run(() => rt.chat.latest()); setPanel(null); }}><RefreshCw size={17}/>Refresh from Hermes</button>
      <button disabled={!rt.chat.selected} onClick={() => { if (!navigator.clipboard) { setCopyNote('Copy this conversation’s address from your browser.'); return; } void navigator.clipboard.writeText(location.href).then(() => setCopyNote('Conversation link copied.')).catch(() => setCopyNote('Copy the address from your browser.')); }}><Link size={17}/>Copy conversation link</button>
      <button disabled={!rt.chat.selected || !rt.readable || rt.chat.busy || ['running', 'waiting'].includes(rt.chat.native.state.phase)} onClick={() => { rt.run(() => rt.chat.historyPage(100)); setPanel(null); }}><History size={17}/>Earlier messages</button>
      <details className="open-key"><summary><KeyRound size={16}/>Open a session by key</summary><form onSubmit={event => { event.preventDefault(); rt.open({ id: key.current?.value ?? '' }); setPanel(null); }}><label className="field">Hermes session key<input ref={key} required autoComplete="off"/></label><button className="primary" disabled={!rt.readable}>Open conversation</button></form></details><p role="status" className="small muted">{copyNote}</p>
    </div></Modal>}
  </>;
}

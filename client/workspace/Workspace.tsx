import { Component, lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { ArrowLeft, Check, Copy, Download, FileText, Folder, GitBranch, LockKeyhole, RefreshCw, Search, WrapText, X } from 'lucide-react';
import type { AppRuntime } from '../runtime.js';
import { IconButton, Notice } from '../primitives.js';
import { DocumentRequests } from '../document-requests.js';
import { WorkspaceApi, type Change } from './api.js';
import { WorkspaceStore } from './store.js';
import './workspace.css';
const CodePreview = lazy(() => import('./CodePreview.js'));
class PreviewBoundary extends Component<{ children: ReactNode; text: string }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <pre className="workspace-plain" tabIndex={0}>{this.props.text}</pre> : this.props.children; }
}
const bytes = (value: number) => value < 1024 ? `${value} B` : `${(value / 1024).toFixed(value >= 10240 ? 0 : 1)} KiB`;
const changeLabel = (file: Change) => !file.head && !file.stage ? 'Untracked' : !file.work ? 'Deleted' : !file.head ? 'Added' : 'Modified';
function Content({ runtime: rt }: { runtime: AppRuntime }) {
  const requests = useMemo(() => new DocumentRequests(window), []);
  const store = useMemo(() => new WorkspaceStore(new WorkspaceApi(requests.fetch), () => { void rt.connection.refresh(); }), [rt, requests]);
  const state = useSyncExternalStore(store.subscribe, store.snapshot);
  const [query, setQuery] = useState(''), [wrap, setWrap] = useState(true), [copyNote, setCopyNote] = useState('');
  const previousFileButton = useRef<HTMLElement | null>(null), backButton = useRef<HTMLButtonElement>(null), restoreFocus = useRef(false);
  const tabList = useRef<HTMLDivElement>(null), uploadInput = useRef<HTMLInputElement>(null);
  const writable = state.roots.find(root => root.id === state.root)?.writable === true;
  useEffect(() => { const refresh = () => { void store.directory(store.state.tree?.path ?? ''); }; window.addEventListener('webui-workspace-changed', refresh); return () => window.removeEventListener('webui-workspace-changed', refresh); }, [store]);
  useEffect(() => { void store.load(); return () => { store.dispose(); requests.dispose(); }; }, [store, requests]);
  useEffect(() => { setQuery(''); setCopyNote(''); }, [state.root, state.tree?.path, state.preview?.path, state.diff?.path]);
  const path = state.tree?.path ?? '', preview = state.preview, diff = state.diff, viewing = !!preview || !!diff;
  const contents = preview?.text ?? diff?.patch ?? '';
  const back = () => { restoreFocus.current = true; store.clearPreview(); };
  useLayoutEffect(() => {
    if (viewing) backButton.current?.focus({ preventScroll: true });
    else if (restoreFocus.current) { restoreFocus.current = false; if (previousFileButton.current?.isConnected) previousFileButton.current.focus({ preventScroll: true }); }
  }, [viewing, preview?.path, diff?.path]);
  const remember = () => { previousFileButton.current = document.activeElement as HTMLElement; };
  const refresh = () => { if (!state.root) void store.load(); else if (state.tab === 'git') void store.discover(); else if (state.tab === 'changes') void store.changes(); else if (preview) void store.file(preview.path); else void store.directory(path); };
  const options = state.tree?.entries.filter(entry => entry.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())) ?? [];
  return <>
    <div className="workspace-controls"><label className="sr-only" htmlFor="workspace-root">Workspace root</label>
      <select id="workspace-root" aria-label="Workspace root" disabled={!state.roots.length} value={state.root} onChange={event => { void store.selectRoot(event.target.value); }}>{!state.roots.length && <option value="">No project mounted</option>}{state.roots.map(root => <option key={root.id} value={root.id}>{root.label}</option>)}</select>
      <IconButton label="Refresh workspace" disabled={state.busy} onClick={refresh}><RefreshCw size={17}/></IconButton>
    </div>
    <div className="workspace-tabs" role="tablist" aria-label="Workspace views" ref={tabList} onKeyDown={event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      const tabs = [...tabList.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
      const current = tabs.indexOf(document.activeElement as HTMLButtonElement); if (!tabs.length || current < 0) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      tabs[next]!.focus(); tabs[next]!.click();
    }}>{(['files', 'git', 'changes'] as const).map(tab => <button type="button" key={tab} role="tab" id={`workspace-tab-${tab}`} aria-controls="workspace-view" aria-selected={state.tab === tab} tabIndex={state.tab === tab ? 0 : -1} title={tab === 'changes' && !state.status ? 'Select a repository from Git first' : undefined} disabled={!state.root || tab !== 'files' && !state.git || tab === 'changes' && !state.status && state.tab !== 'changes'} onClick={() => { if (tab === 'files') void store.directory(path); else if (tab === 'git') void store.discover(); else void store.changes(); }}>{tab === 'files' ? <Folder size={16}/> : <GitBranch size={16}/>}<span>{tab[0]!.toUpperCase() + tab.slice(1)}</span></button>)}</div>
    {writable && <div className="workspace-write-tools"><button type="button" disabled={state.busy} onClick={() => { void rt.workspaceMutations.open('mkdir', state.root, path); }}>New folder</button><button type="button" disabled={state.busy} onClick={() => uploadInput.current?.click()}>Upload file</button><input ref={uploadInput} className="sr-only" type="file" aria-label="Choose upload file" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void rt.workspaceMutations.open('upload', state.root, path, file); }}/></div>}
    {state.busy && <p className="workspace-progress" role="status">Reading project…</p>}
    {state.error && <Notice error>{state.error}<button type="button" onClick={refresh}>Refresh</button></Notice>}
    {!state.busy && !state.error && !state.roots.length && <div className="workspace-empty"><Folder size={32}/><h3>No workspace mounted</h3><p>Add a dedicated project folder with the read-only workspace Compose override. Chat works without it.</p><code>compose.workspace.yaml</code></div>}
    {!!state.root && <div id="workspace-view" className={`workspace-view${viewing ? ' preview-open' : ''}`} role="tabpanel" aria-labelledby={`workspace-tab-${state.tab}`}>
      <div className="workspace-browser" hidden={viewing}>
        {state.tab === 'files' && <>
          <nav aria-label="File breadcrumb" className="workspace-breadcrumb"><button type="button" onClick={() => { void store.directory(''); }}>Root</button>{path.split('/').filter(Boolean).map((part, i, parts) => <button type="button" key={i} onClick={() => { void store.directory(parts.slice(0, i + 1).join('/')); }}>/{part}</button>)}</nav>
          <label className="workspace-filter"><Search size={16}/><input type="search" aria-label="Filter current directory" placeholder="Find in this directory…" value={query} onChange={event => setQuery(event.target.value)}/></label>
          <ul className="workspace-list" aria-label="Files">{options.map(entry => <li key={entry.name}><button type="button" disabled={entry.type === 'blocked'} onClick={() => { remember(); const target = [path, entry.name].filter(Boolean).join('/'); if (entry.type === 'directory') void store.directory(target); else void store.file(target); }}>
            {entry.type === 'directory' ? <Folder size={18}/> : entry.type === 'blocked' ? <LockKeyhole size={18}/> : <FileText size={18}/>}<span>{entry.name}</span><small>{entry.type === 'blocked' ? 'Unavailable' : entry.type === 'directory' ? 'Folder' : 'File'}</small></button>{writable && entry.type !== 'blocked' && <div className="workspace-item-actions"><button type="button" aria-label={`Rename ${entry.name}`} onClick={() => { void rt.workspaceMutations.open('rename', state.root, [path, entry.name].filter(Boolean).join('/')); }}>Rename</button><button type="button" aria-label={`Delete ${entry.name}`} onClick={() => { void rt.workspaceMutations.open('delete', state.root, [path, entry.name].filter(Boolean).join('/')); }}>Delete</button></div>}</li>)}</ul>
          {!state.busy && state.tree && !options.length && <p className="workspace-message">{query ? 'No matching files on this page.' : 'This directory has no visible files.'}</p>}
          {state.tree?.truncated && <Notice>Directory scan limited to 1,000 entries. Browse a smaller project folder.</Notice>}
          {state.tree && <div className="workspace-pagination"><button type="button" disabled={state.busy || !state.tree.offset} onClick={() => { void store.directory(path, Math.max(0, (state.tree?.offset ?? 0) - 200)); }}>Previous files</button><button type="button" disabled={state.busy || state.tree.nextOffset === null} onClick={() => { void store.directory(path, state.tree?.nextOffset ?? 0); }}>Next files</button></div>}
        </>}
        {state.tab === 'git' && <>
          <p className="workspace-message">Local repositories beneath <strong>{path || 'Root'}</strong>. Repository discovery is bounded; browse a subfolder to search more deeply.</p>
          <ul className="workspace-list" aria-label="Repositories">{state.repos?.map(repo => <li key={repo.path}><button type="button" disabled={!repo.supported} onClick={() => { void store.repository(repo.path); }}><GitBranch size={18}/><span>{repo.path || 'Root repository'}<small>{repo.supported ? 'Inspect branch and changes' : 'External worktree or symlink · unsupported'}</small></span></button></li>)}</ul>
          {!state.busy && state.repos?.length === 0 && <p className="workspace-message">No Git repositories found in this scan.</p>}
          {state.discoveryTruncated && <Notice>Discovery limit reached. Browse a smaller folder and scan again.</Notice>}
        </>}
        {state.tab === 'changes' && state.status && <>
          <div className="workspace-repo"><GitBranch size={18}/><div><strong>{state.status.branch || (state.status.head ? 'Detached HEAD' : 'No commits yet')}</strong><span>{state.status.repo || 'Root repository'} · {state.status.head?.slice(0, 8) || 'Unborn branch'}</span></div></div>
          <p className="workspace-message">{state.status.total} changed {state.status.total === 1 ? 'file' : 'files'}. Inspection only; no staging or commit actions.</p>
          <ul className="workspace-changes" aria-label="Changed files">{state.status.files.map(file => <li key={file.path}><span><strong>{file.path}</strong><small>{changeLabel(file)}</small></span><div>{file.staged && <button type="button" onClick={() => { remember(); void store.showDiff(file.path, true); }}>Staged diff</button>}{file.unstaged && <button type="button" onClick={() => { remember(); void store.showDiff(file.path, false); }}>{file.stage === 0 && file.head === 0 ? 'Untracked diff' : 'Working diff'}</button>}</div></li>)}</ul>
          {!state.status.files.length && <div className="workspace-empty"><Check size={28}/><h3>Working tree clean</h3><p>No visible staged or working-tree changes.</p></div>}
          {state.status.truncated && <Notice>Showing the first 500 changes.</Notice>}
        </>}
      </div>
      {viewing && <section className="workspace-preview" aria-label={diff ? 'Git diff preview' : 'File preview'}>
        <header><button type="button" className="workspace-back" ref={backButton} onClick={back}><ArrowLeft size={16}/>Back</button><strong title={preview?.path ?? diff?.path}>{preview?.path ?? diff?.path}</strong></header>
        <div className="workspace-preview-tools">{writable && preview?.kind === 'text' && preview.version && <button type="button" onClick={() => rt.workspaceMutations.edit(state.root, preview)}>Edit file</button>}<span>{preview ? bytes(preview.size) : diff?.staged ? 'HEAD → Index' : 'Index → Working tree'}</span>
          <IconButton label="Toggle line wrapping" aria-pressed={wrap} onClick={() => setWrap(!wrap)}><WrapText size={17}/></IconButton>
          <IconButton label="Copy file text" disabled={!contents} onClick={() => {
            if (!navigator.clipboard) { setCopyNote('Select the text to copy.'); return; }
            void navigator.clipboard.writeText(contents).then(() => setCopyNote('Copied.')).catch(() => setCopyNote('Select the text to copy.'));
          }}><Copy size={17}/></IconButton>
          {preview && preview.size <= 10_485_760 && <a aria-label="Download file" title="Download file" href={store.api.download(state.root, preview.path)} download><Download size={17}/></a>}
        </div>
        {copyNote && <p className="workspace-message" role="status">{copyNote}</p>}
        {preview && preview.kind !== 'text' ? <div className="workspace-empty"><FileText size={28}/><h3>{preview.kind === 'binary' ? 'Binary file' : 'File too large to preview'}</h3><p>{preview.size <= 10_485_760 ? 'Use Download file to inspect it locally.' : 'Downloads are limited to 10 MiB.'}</p></div> :
          <PreviewBoundary key={preview?.path ?? diff?.path} text={contents}><Suspense fallback={<pre className="workspace-plain" tabIndex={0}>{contents}</pre>}><CodePreview text={contents} path={preview?.path ?? 'changes.diff'} wrap={wrap}/></Suspense></PreviewBoundary>}
        {diff?.truncated && <Notice>Diff truncated at the display limit.</Notice>}
      </section>}
    </div>}
    {!!state.root && <footer className="workspace-footer"><LockKeyhole size={13}/>{writable ? 'Writes enabled by operator' : 'Read-only project mount'}{!state.git && <span> · Git disabled by operator</span>}</footer>}
  </>;
}
export default function Workspace({ runtime: rt, onClose, pane = false }: { runtime: AppRuntime; onClose: () => void; pane?: boolean }) {
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible'), [size, setSize] = useState('standard');
  useEffect(() => {
    const change = () => setVisible(document.visibilityState === 'visible');
    const hide = () => setVisible(false);
    document.addEventListener('visibilitychange', change); window.addEventListener('pagehide', hide); window.addEventListener('pageshow', change);
    return () => { document.removeEventListener('visibilitychange', change); window.removeEventListener('pagehide', hide); window.removeEventListener('pageshow', change); };
  }, []);
  return <aside className={`file-workspace workspace-size-${size}`} aria-label="Project workspace">
    <header className="workspace-heading"><h2><Folder size={18}/>Workspace</h2><div>{pane && <button type="button" aria-label="Resize workspace pane" onClick={() => setSize(size === 'standard' ? 'wide' : 'standard')}>{size === 'standard' ? 'Widen' : 'Narrow'}</button>}<IconButton label="Back to chat" onClick={onClose}>{pane ? <X size={18}/> : <ArrowLeft size={18}/>}</IconButton></div></header>
    {rt.readable && !rt.connection.state.busy && visible ? <Content key={`${rt.accountGeneration}:${rt.chat.selected?.profile ?? ''}:${rt.chat.selected?.id ?? ''}`} runtime={rt}/> : <div className="workspace-empty"><LockKeyhole size={28}/><h3>Workspace paused</h3><p>Private previews are cleared while offline, hidden or verifying access. Return online to read them again.</p></div>}
  </aside>;
}

import { Component, lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import type { AppRuntime } from '../runtime.js';
import { Modal, Notice } from '../primitives.js';
import './mutations.css';
const EditText = lazy(() => import('./EditText.js'));
class EditorBoundary extends Component<{ children: ReactNode; text: string }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <><Notice error>Editor unavailable. Your draft is retained in this tab; copy it before closing.</Notice><pre className="workspace-plain" tabIndex={0}>{this.props.text}</pre></> : this.props.children; }
}
const titles = { save: 'Edit workspace file', mkdir: 'Create folder', rename: 'Rename entry', delete: 'Delete entry', upload: 'Upload file' };
export default function MutationDialog({ runtime: rt }: { runtime: AppRuntime }) {
  const actions = rt.workspaceMutations, state = actions.state;
  const [visible, setVisible] = useState(document.visibilityState === 'visible');
  useEffect(() => {
    const update = () => setVisible(document.visibilityState === 'visible');
    const leaving = (event: BeforeUnloadEvent) => { if (actions.blocker()) { event.preventDefault(); event.returnValue = ''; } };
    document.addEventListener('visibilitychange', update); window.addEventListener('beforeunload', leaving);
    return () => { document.removeEventListener('visibilitychange', update); window.removeEventListener('beforeunload', leaving); };
  }, [actions]);
  if (!state.operation || state.phase === 'closed') return null;
  const access = visible && rt.readable && !rt.connection.state.busy, locked = !access || actions.pending || state.phase === 'unknown';
  const close = () => {
    if (actions.pending) return;
    if ((actions.dirty || state.phase === 'unknown') && !window.confirm(state.phase === 'unknown' ? 'Discard this local view? The operation may already have completed. Inspect the project before trying again.' : 'Discard unsaved file edits?')) return;
    actions.clear();
  };
  return <Modal title={titles[state.operation]} kind="workspace-mutation" onClose={close}>
    <p className="mutation-path">{access ? `${state.root} / ${state.path || state.target || 'New entry'}` : 'Private workspace operation'}</p>
    {!access ? <Notice>The workspace is paused. Your unsaved edit remains only in this tab’s memory. Reconnect and verify access to continue.</Notice> : <>
      {state.operation === 'save' && state.phase !== 'done' && <EditorBoundary text={state.text}><Suspense fallback={<textarea className="mutation-fallback" aria-label="Loading file editor" value={state.text} disabled readOnly/>}><EditText key={`${state.root}:${state.path}`} value={state.text} locked={locked} onChange={actions.change}/></Suspense></EditorBoundary>}
      {['mkdir', 'rename', 'upload'].includes(state.operation) && state.phase !== 'done' && <label className="mutation-field">Destination inside this workspace<input aria-label="Destination path" value={state.target} maxLength={2048} disabled={locked || state.phase === 'conflict'} onChange={event => actions.target(event.target.value)}/><small>Existing destinations are never replaced. Parent folders must already exist.</small></label>}
      {state.operation === 'delete' && <Notice error>This permanently deletes the selected file or empty folder. There is no recycle bin. Non-empty folders are refused.</Notice>}
      {state.remote && <details className="mutation-current"><summary>Review current file</summary><pre>{state.remote.text ?? 'Current content cannot be previewed.'}</pre></details>}
      {state.note && <Notice error={['unknown', 'conflict'].includes(state.phase)}>{state.note}</Notice>}
      {actions.pending && <p className="mutation-status" role="status">{state.phase === 'sending' ? 'Applying once; waiting for confirmation…' : 'Reading current state…'}</p>}
    </>}
    <footer className="mutation-actions">
      {['unknown', 'conflict'].includes(state.phase) && <button type="button" className="secondary" disabled={!access || actions.pending} onClick={() => { void actions.reconcile(); }}>Read current state</button>}
      {state.phase === 'conflict' && state.remote?.version && <button type="button" className="secondary" disabled={!access} onClick={() => { if (window.confirm('Use the current file version as the base for your draft? Review the differences before explicitly saving.')) actions.useCurrentBase(); }}>Keep draft against current version</button>}
      <button type="button" className="secondary" disabled={actions.pending} onClick={close}>{state.phase === 'done' ? 'Close' : state.operation === 'save' ? 'Discard and close' : 'Cancel'}</button>
      {state.phase === 'ready' && <button type="button" className="primary" disabled={locked || state.operation === 'save' && !actions.dirty} onClick={() => { void actions.perform(); }}>{state.operation === 'save' ? 'Save file' : state.operation === 'delete' ? 'Confirm delete' : state.operation === 'rename' ? 'Confirm rename' : state.operation === 'mkdir' ? 'Create folder' : 'Upload file'}</button>}
    </footer>
    <p className="mutation-footnote">No automatic retries or offline upload queue. Closing the app may lose unsaved edits.</p>
  </Modal>;
}

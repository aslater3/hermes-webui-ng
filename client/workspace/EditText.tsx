import { useEffect, useRef } from 'react';
import { EditorState, Compartment } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { basicSetup } from 'codemirror';
/** A single live editor instance: keystrokes do not recreate it or reset selection/undo. */
export default function EditText({ value, locked, onChange }: { value: string; locked: boolean; onChange: (text: string) => void }) {
  const parent = useRef<HTMLDivElement>(null), editor = useRef<EditorView | null>(null), change = useRef(onChange);
  const editable = useRef(new Compartment()); change.current = onChange;
  useEffect(() => {
    const nonce = document.querySelector<HTMLMetaElement>('meta[name="webui-style-nonce"]')?.content;
    const view = new EditorView({ parent: parent.current!, state: EditorState.create({ doc: value, extensions: [
      basicSetup, EditorView.lineWrapping, EditorState.lineSeparator.of(value.includes('\r\n') ? '\r\n' : '\n'),
      ...(nonce ? [EditorView.cspNonce.of(nonce)] : []),
      editable.current.of([EditorState.readOnly.of(locked), EditorView.editable.of(!locked)]),
      EditorView.contentAttributes.of({ 'aria-label': 'Edit file content', spellcheck: 'false' }),
      EditorState.transactionFilter.of(transaction => transaction.newDoc.length > 262144 ? [] : transaction),
      EditorView.updateListener.of(update => { if (update.docChanged) change.current(update.state.sliceDoc()); }),
      EditorView.theme({ '&': { height: '100%', color: 'var(--text)', backgroundColor: 'var(--code)' }, '.cm-scroller': { overflow: 'auto', fontFamily: 'var(--mono)', fontSize: '14px' }, '.cm-gutters': { color: 'var(--muted)', backgroundColor: 'var(--code)', borderRight: '1px solid var(--border)' }, '.cm-content': { padding: '12px 0' }, '&.cm-focused': { outline: '2px solid var(--focus)' } }),
    ] }) });
    editor.current = view;
    return () => { view.destroy(); editor.current = null; };
  }, []);
  useEffect(() => { editor.current?.dispatch({ effects: editable.current.reconfigure([EditorState.readOnly.of(locked), EditorView.editable.of(!locked)]) }); }, [locked]);
  return <div className="workspace-edit-text" ref={parent}/>;
}

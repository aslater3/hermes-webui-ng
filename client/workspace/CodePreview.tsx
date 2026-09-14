import { useEffect, useRef, useState } from 'react';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';

async function language(path: string): Promise<Extension> {
  if (/\.[cm]?[jt]sx?$/i.test(path)) return (await import('@codemirror/lang-javascript')).javascript({ typescript: /\.[cm]?tsx?$/i.test(path), jsx: /x$/i.test(path) });
  if (/\.json$/i.test(path)) return (await import('@codemirror/lang-json')).json();
  if (/\.py$/i.test(path)) return (await import('@codemirror/lang-python')).python();
  if (/\.ya?ml$/i.test(path)) return (await import('@codemirror/lang-yaml')).yaml();
  return [];
}
/** Inert text only: no Markdown/HTML/SVG execution, persistence or editable transactions. */
export default function CodePreview({ text, path, wrap }: { text: string; path: string; wrap: boolean }) {
  const target = useRef<HTMLDivElement>(null), [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true, view: EditorView | undefined; setFailed(false);
    const nonce = document.querySelector<HTMLMetaElement>('meta[name="webui-style-nonce"]')?.content;
    if (!nonce) { setFailed(true); return; }
    void language(path).then(extension => {
      if (!active || !target.current) return;
      view = new EditorView({ parent: target.current, state: EditorState.create({ doc: text, extensions: [
        basicSetup, extension, EditorState.readOnly.of(true), EditorView.editable.of(false), EditorView.cspNonce.of(nonce),
        EditorView.contentAttributes.of({ tabindex: '0', 'aria-label': 'Read-only file content', 'aria-readonly': 'true' }),
        EditorView.theme({
          '&': { height: '100%', backgroundColor: 'var(--code)', color: 'var(--text)', fontSize: '13px' },
          '.cm-scroller': { overflow: 'auto', fontFamily: 'var(--mono)' },
          '.cm-content': { padding: '12px 0', caretColor: 'var(--text)' },
          '.cm-gutters': { backgroundColor: 'var(--code)', color: 'var(--muted)', borderRight: '1px solid var(--border)' },
          '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'var(--accent-soft)' },
          '&.cm-focused': { outline: '2px solid var(--focus)', outlineOffset: '-2px' },
          '.cm-selectionBackground': { backgroundColor: 'var(--accent-soft) !important' },
        }),
        syntaxHighlighting(HighlightStyle.define([
          { tag: [tags.keyword, tags.modifier, tags.operatorKeyword], color: 'var(--syntax-keyword)' },
          { tag: [tags.string, tags.regexp, tags.number, tags.bool], color: 'var(--accent)' },
          { tag: [tags.function(tags.variableName), tags.typeName, tags.className], color: 'var(--syntax-title)' },
          { tag: [tags.comment, tags.meta], color: 'var(--muted)' },
        ])),
        ...(wrap ? [EditorView.lineWrapping] : []),
      ] }) });
    }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; view?.destroy(); target.current?.replaceChildren(); };
  }, [text, path, wrap]);
  return failed ? <pre className="workspace-plain" tabIndex={0} aria-label="Read-only file content">{text}</pre> : <div className="workspace-code" ref={target}/>;
}

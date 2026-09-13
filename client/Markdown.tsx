import { useRef, useState, type ComponentPropsWithoutRef, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';
import rehypeHighlight from 'rehype-highlight';
import { Check, Copy, WrapText } from 'lucide-react';

export function safeLink(url: string): string {
  try { const parsed = new URL(url); return ['http:', 'https:', 'mailto:'].includes(parsed.protocol) ? url : ''; } catch { return ''; }
}
function CodeBlock({ children }: { children?: ReactNode }) {
  const ref = useRef<HTMLPreElement>(null), [copied, setCopied] = useState(false), [wrap, setWrap] = useState(false), [note, setNote] = useState('');
  return <div className={`code-block${wrap ? ' wrap' : ''}`}><div className="code-toolbar"><span>Code</span><div>
    <button type="button" aria-label="Wrap code" aria-pressed={wrap} onClick={() => setWrap(!wrap)}><WrapText size={15}/></button>
    <button type="button" aria-label="Copy code" onClick={() => { void navigator.clipboard?.writeText(ref.current?.textContent ?? '').then(() => { setCopied(true); setNote('Copied'); }).catch(() => setNote('Select the code to copy.')); if (!navigator.clipboard) setNote('Select the code to copy.'); }}>{copied ? <Check size={14}/> : <Copy size={14}/>}<span>{copied ? 'Copied' : 'Copy'}</span></button>
    </div></div><pre ref={ref} tabIndex={0}>{children}</pre><span className="sr-only" role="status">{note}</span></div>;
}
const components = {
  pre: CodeBlock,
  a: ({ children, href }: ComponentPropsWithoutRef<'a'>) => href ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> : <span>{children}</span>,
  img: ({ alt, src }: ComponentPropsWithoutRef<'img'>) => typeof src === 'string' && safeLink(src) ? <a href={safeLink(src)} target="_blank" rel="noopener noreferrer">Image: {alt || 'Open image'}</a> : <span>{alt || '[Image]'}</span>,
  table: ({ children }: ComponentPropsWithoutRef<'table'>) => <div className="table-scroll" tabIndex={0} role="region" aria-label="Scrollable table"><table>{children}</table></div>,
};
export default function Markdown({ text }: { text: string }) {
  if (text.length > 48000) return <div><p className="muted small">Large message · plain-text view</p><pre className="plain-message">{text}</pre></div>;
  return <ReactMarkdown skipHtml remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize, [rehypeHighlight, { detect: false }]]} urlTransform={safeLink} components={components}>{text}</ReactMarkdown>;
}

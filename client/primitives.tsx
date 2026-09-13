import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { HermesMark } from './HermesMark.js';
import './hermes-brand.css';
export function IconButton({ label, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return <button type="button" className="icon-button" aria-label={label} title={label} {...props}>{children}</button>;
}
export function Brand({ compact = false }: { compact?: boolean }) {
  return <div className="brand"><span className="brand-mark" aria-hidden="true"><HermesMark size={19}/></span>{!compact && <><span>HermesUI</span><span className="brand-ng">NG</span></>}</div>;
}
export function useMedia(query: string) {
  const [matches, setMatches] = useState(() => matchMedia(query).matches);
  useEffect(() => { const media = matchMedia(query); const changed = () => setMatches(media.matches); media.addEventListener('change', changed); changed(); return () => media.removeEventListener('change', changed); }, [query]);
  return matches;
}
export function Modal({ title, children, onClose, kind = 'settings' }: { title: string; children: ReactNode; onClose: () => void; kind?: string }) {
  const ref = useRef<HTMLDialogElement>(null), titleId = useId();
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    const dialog = ref.current!, origin = document.activeElement;
    dialog.showModal();
    const focus = dialog.querySelector<HTMLElement>('[data-initial-focus]'); focus?.focus({ preventScroll: true });
    return () => { dialog.close(); if (origin instanceof HTMLElement && origin.isConnected) origin.focus({ preventScroll: true }); };
  }, []);
  return <dialog ref={ref} className={`modal modal-${kind}`} aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); close.current(); }} onClick={event => { if (event.target === event.currentTarget) close.current(); }}>
    <div className="modal-inner"><header className="modal-header"><h2 id={titleId}>{title}</h2><IconButton label={`Close ${title.toLowerCase()}`} onClick={onClose}><X size={19}/></IconButton></header>{children}</div>
  </dialog>;
}
export function Notice({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return <div className={`notice${error ? ' notice-error' : ''}`} role={error ? 'alert' : 'status'}>{children}</div>;
}
export function useViewport() {
  useEffect(() => {
    const viewport = window.visualViewport;
    const update = () => {
      if (viewport && Math.abs(viewport.scale - 1) > 0.01) return;
      document.documentElement.style.setProperty('--app-height', `${viewport?.height ?? innerHeight}px`);
      document.documentElement.style.setProperty('--app-top', `${viewport?.offsetTop ?? 0}px`);
    };
    update(); viewport?.addEventListener('resize', update); viewport?.addEventListener('scroll', update); window.addEventListener('resize', update);
    return () => { viewport?.removeEventListener('resize', update); viewport?.removeEventListener('scroll', update); window.removeEventListener('resize', update); };
  }, []);
}

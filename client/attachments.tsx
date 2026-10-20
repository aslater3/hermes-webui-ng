import { useRef } from 'react';
import { FileText, Paperclip, X } from 'lucide-react';
import type { AppRuntime } from './runtime.js';
import { attachFiles, removeAttachment } from './attachment-actions.js';
import { formatBytes } from '../src/hermes/attachments.js';
import { Notice } from './primitives.js';
import './attachments.css';

/** Files a paste or drop can carry into the composer. Anything else keeps the browser's default behaviour. */
export function attachableFiles(list: FileList | readonly File[] | null | undefined): File[] {
  return [...(list ?? [])].filter(file => file.type.startsWith('image/') || file.type === 'application/pdf' || (!file.type && /\.pdf$/i.test(file.name)));
}

/** Copy explaining why attach is unavailable right now; empty when it is available. */
export function attachReason(rt: AppRuntime, running: boolean): string {
  if (rt.attachments.support === 'unavailable') return 'Attachments are not supported by this Hermes version.';
  if (running) return 'Attach files when Hermes is idle. Queued files are sent with your next message.';
  return '';
}

/** Attach button with a hidden native picker. No capture attribute: the platform offers files, photos and camera. */
export function AttachButton({ runtime: rt, enabled, reason, reasonId }: { runtime: AppRuntime; enabled: boolean; reason: string; reasonId: string }) {
  const input = useRef<HTMLInputElement>(null);
  return <>
    <button type="button" className="icon-button attach-button" aria-label="Attach image or PDF" title={enabled ? 'Attach image or PDF' : reason || 'Attach image or PDF'}
      disabled={!enabled} aria-describedby={reason ? reasonId : undefined} onClick={() => input.current?.click()}>
      <Paperclip size={18} aria-hidden="true" focusable="false"/>
    </button>
    {/* Visually hidden, not display:none: iOS Safari (and Home Screen PWAs) ignore a programmatic click on a display:none file input. */}
    <input ref={input} type="file" accept="image/*,application/pdf" multiple className="sr-only" tabIndex={-1} aria-hidden="true" data-testid="attachment-input"
      onChange={event => {
        // Every picked file goes through validation so a refused type gets plain copy, not silence.
        const files = [...(event.currentTarget.files ?? [])];
        event.currentTarget.value = '';
        if (files.length) rt.run(() => attachFiles(rt, files));
      }}/>
  </>;
}

const kindLabel = { image: 'Image', pdf: 'PDF' } as const;

/** Queued chips for the selected native session. Empty for every other owner, so nothing resurrects. */
export function AttachmentTray({ runtime: rt, owner }: { runtime: AppRuntime; owner: ReturnType<AppRuntime['attachmentOwner']> }) {
  const chips = rt.attachments.itemsFor(owner), error = rt.attachments.error;
  if (!chips.length && !error) return null;
  return <section className="attachment-tray" aria-label="Attachments for your next message">
    {error && <Notice error>{error}</Notice>}
    {chips.length > 0 && <ul className="attachment-chips">{chips.map(chip => <li key={chip.id} className="attachment-chip">
      {chip.previewUrl ? <img className="attachment-thumb" src={chip.previewUrl} alt="" width={44} height={44}/> : <span className="attachment-thumb attachment-thumb-file" aria-hidden="true"><FileText size={20} focusable="false"/></span>}
      <span className="attachment-meta"><strong>{chip.name}</strong><small>{kindLabel[chip.kind]}{chip.size ? ` · ${formatBytes(chip.size)}` : ''}{chip.kind === 'pdf' ? ` · ${chip.paths.length} page${chip.paths.length === 1 ? '' : 's'}` : ''}</small></span>
      <button type="button" className="attachment-remove" aria-label={`Remove attachment ${chip.name}`} title="Remove attachment" onClick={() => removeAttachment(rt, chip.id)}>
        <X size={18} aria-hidden="true" focusable="false"/>
      </button>
    </li>)}</ul>}
  </section>;
}

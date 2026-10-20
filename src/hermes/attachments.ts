import { ClientError } from './protocol.js';

/** Bounds mirror upstream tui_gateway/prompt_attachments.py (_ATTACH_BYTES_MAX_BYTES, _PDF_ATTACH_MAX_BYTES). */
export const IMAGE_MAX_BYTES = 25 * 1024 * 1024;
export const PDF_MAX_BYTES = 50 * 1024 * 1024;
export const PDF_MAX_PAGES = 25;

export type AttachmentKind = 'image' | 'pdf';
export type AttachmentMethod = 'image.attach_bytes' | 'pdf.attach';

export type Validation =
  | { ok: true; kind: AttachmentKind; method: AttachmentMethod }
  | { ok: false; message: string };

export interface AttachableFile { name: string; size: number; type: string }

/** Client-side admission. Upstream still sniffs magic bytes and enforces the same caps. */
export function validateAttachment(file: AttachableFile): Validation {
  const type = (file.type || '').toLowerCase();
  const isPdf = type === 'application/pdf' || (!type && /\.pdf$/i.test(file.name));
  const isImage = type.startsWith('image/');
  if (!isPdf && !isImage) return { ok: false, message: `${displayName(file.name)} is not an image or PDF. Only images and PDFs can be attached for now. Nothing was attached.` };
  if (!Number.isFinite(file.size) || file.size <= 0) return { ok: false, message: `${displayName(file.name)} is empty. Nothing was attached.` };
  if (isPdf) {
    if (file.size > PDF_MAX_BYTES) return { ok: false, message: `PDFs must be 50 MB or smaller. ${displayName(file.name)} was not attached.` };
    return { ok: true, kind: 'pdf', method: 'pdf.attach' };
  }
  if (file.size > IMAGE_MAX_BYTES) return { ok: false, message: `Images must be 25 MB or smaller. ${displayName(file.name)} was not attached.` };
  return { ok: true, kind: 'image', method: 'image.attach_bytes' };
}

export function displayName(name: string): string {
  const clean = (name || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 120);
  return clean || 'This file';
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Plain copy for a failed attachment RPC. Codes come from prompt_attachments.py (4016-4018, 5028). */
export function attachmentFailure(error: unknown, name: string): string {
  const label = displayName(name);
  if (error instanceof ClientError) {
    if (error.rpcCode === -32601) return 'Attachments are not supported by this Hermes version.';
    if (error.rpcCode === 4018) return `${label} is too large for Hermes. Nothing was attached.`;
    if (error.rpcCode === 4016) return `Hermes does not accept that image type. ${label} was not attached.`;
    if (error.rpcCode === 5028) return 'PDF pages could not be rendered on this Hermes host (it needs poppler). Nothing was attached.';
    if (error.kind === 'disconnected') return error.message;
  }
  return `${label} could not be attached. Nothing was queued. Try again.`;
}

export interface Chip {
  id: string;
  kind: AttachmentKind;
  name: string;
  size: number;
  /** Gateway-visible paths Hermes returned for this attachment; PDFs carry one per rendered page. */
  paths: string[];
  /** Object URL for the local thumbnail; revoked when the chip leaves the tray. */
  previewUrl?: string;
}

export interface Owner { key: string; runtimeId: string; profile?: string }

export interface Ticket { owner: Owner; epoch: number }

export type Support = 'unknown' | 'available' | 'unavailable';

export interface TrayPorts {
  revoke: (url: string) => void;
  /** Best-effort upstream removal for chips that leave the tray without being sent. */
  discard: (owner: Owner, paths: string[]) => void;
  notify: () => void;
}

/**
 * Queued attachments for the selected native session. Local only: never persisted, and every chip
 * belongs to exactly one owner. Async attach results carry a ticket so a result that lands after a
 * session/account switch or a clear is refused (and its upstream copy is discarded), never shown.
 */
export class AttachmentTray {
  private owner?: Owner;
  private chips: Chip[] = [];
  private epoch = 0;
  private seq = 0;
  support: Support = 'unknown';
  error = '';
  constructor(private readonly ports: TrayPorts) {}

  get current(): Owner | undefined { return this.owner; }
  get items(): readonly Chip[] { return this.chips; }
  /** Chips for an owner; a stale owner never exposes chips from another session. */
  itemsFor(owner: Owner | undefined): readonly Chip[] {
    return owner && this.owner?.key === owner.key ? this.chips : [];
  }

  /**
   * Switching owner (session, profile, account) clears every chip without resurrecting it. The previous
   * owner's queued copies are detached upstream best-effort, so returning to that session cannot send them.
   */
  setOwner(next: Owner | undefined): void {
    if ((next?.key) === this.owner?.key) return;
    this.clear(true);
    this.owner = next;
    this.ports.notify();
  }

  begin(owner: Owner | undefined): Ticket | undefined {
    if (!owner || owner.key !== this.owner?.key) return undefined;
    return { owner, epoch: this.epoch };
  }

  /** Returns false when the ticket is stale. The caller must then discard the upstream copy. */
  accept(ticket: Ticket, chip: Omit<Chip, 'id'>): boolean {
    if (ticket.epoch !== this.epoch || !this.owner || ticket.owner.key !== this.owner.key) return false;
    this.chips = [...this.chips, { ...chip, id: `attachment-${++this.seq}` }];
    this.error = '';
    this.ports.notify();
    return true;
  }

  /** Remove one chip: its upstream paths are detached and its preview released. */
  remove(id: string): void {
    const chip = this.chips.find(item => item.id === id);
    if (!chip) return;
    this.chips = this.chips.filter(item => item.id !== id);
    if (chip.previewUrl) this.ports.revoke(chip.previewUrl);
    if (this.owner && chip.paths.length) this.ports.discard(this.owner, chip.paths);
    this.ports.notify();
  }

  /** Accepted by Hermes on a real turn: chips leave the tray with their upstream copy consumed. */
  consume(owner: Owner | undefined): void {
    if (!owner || owner.key !== this.owner?.key) return;
    this.release(this.chips);
    this.ports.notify();
  }

  /** Clear the tray. With discard=true, upstream copies are detached when a session still exists. */
  clear(discard = true): void {
    ++this.epoch;
    const removed = this.chips;
    this.chips = []; this.error = '';
    if (discard && this.owner) {
      const paths = removed.flatMap(chip => chip.paths);
      if (paths.length) this.ports.discard(this.owner, paths);
    }
    this.release(removed);
  }

  private release(chips: readonly Chip[]): void {
    for (const chip of chips) if (chip.previewUrl) this.ports.revoke(chip.previewUrl);
    this.chips = this.chips.filter(chip => !chips.includes(chip));
  }
}

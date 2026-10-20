import type { AppRuntime } from './runtime.js';
import { ClientError, record } from '../src/hermes/protocol.js';
import { attachmentFailure, displayName, validateAttachment, type Chip } from '../src/hermes/attachments.js';

/**
 * The single browser attachment pipeline: the composer (attach button, drop, paste) and the
 * /image and /paste browser commands all queue through here. Images use image.attach_bytes and PDFs
 * pdf.attach, both native RPC over the existing WebSocket. Nothing is written to browser storage.
 */
function base64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file.'));
    reader.onload = () => {
      const value = reader.result;
      if (typeof value !== 'string' || !value.includes(',')) reject(new Error('Could not encode the file.'));
      else resolve(value.slice(value.indexOf(',') + 1));
    };
    reader.readAsDataURL(blob);
  });
}

/** Attaches one file to the selected native session and records it as a chip. Throws ClientError. */
export async function attachFile(rt: AppRuntime, file: Blob & { name?: string }, filename = file.name || 'attachment'): Promise<Chip> {
  const name = displayName(filename);
  const verdict = validateAttachment({ name, size: file.size, type: file.type });
  if (!verdict.ok) throw new ClientError('protocol', verdict.message);
  if (!rt.ready) throw new ClientError('disconnected', 'Connect to Hermes before attaching a file. Nothing was attached.');
  const owner = rt.attachmentOwner();
  const native = rt.chat.native.state;
  if (!owner || native.phase !== 'idle') throw new ClientError('protocol', 'Attach files when Hermes is idle in an open conversation. Nothing was attached.');
  if (rt.attachments.support === 'unavailable') throw new ClientError('protocol', 'Attachments are not supported by this Hermes version.');
  const ticket = rt.attachments.begin(owner);
  if (!ticket) throw new ClientError('disconnected', 'The selected conversation changed before attaching. Nothing was attached.');
  const encoded = await base64(file);
  const params = { session_id: owner.runtimeId, ...(owner.profile ? { profile: owner.profile } : {}),
    content_base64: encoded, filename: name.slice(0, 512) };
  let raw: Record<string, unknown>;
  try {
    raw = record(await rt.gateway.call(verdict.method, params));
  } catch (error) {
    if (error instanceof ClientError && error.rpcCode === -32601) rt.attachments.support = 'unavailable';
    throw new ClientError(error instanceof ClientError ? error.kind : 'protocol', attachmentFailure(error, name), error instanceof ClientError ? error.rpcCode : undefined);
  }
  if (raw.attached !== true) throw new ClientError('protocol', `Hermes did not confirm ${name}. Check the conversation before retrying.`);
  const pages = Array.isArray(raw.pages) ? raw.pages.map(page => record(page)) : [];
  const paths = verdict.kind === 'pdf'
    ? pages.map(page => page.path).filter((path): path is string => typeof path === 'string')
    : typeof raw.path === 'string' ? [raw.path] : [];
  if (verdict.kind === 'pdf' && !paths.length) throw new ClientError('protocol', `Hermes did not return pages for ${name}. Nothing was attached.`);
  rt.attachments.support = 'available';
  const previewUrl = verdict.kind === 'image' ? URL.createObjectURL(file) : undefined;
  const label = typeof raw.name === 'string' && raw.name ? displayName(raw.name) : name;
  const chip = { kind: verdict.kind, name: label, size: file.size, paths, previewUrl };
  if (!rt.attachments.accept(ticket, chip)) {
    // The conversation changed while the upload was in flight: the copy Hermes queued belongs to the
    // old owner, so remove it there and show nothing here.
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    if (paths.length) void rt.discardAttachmentPaths(owner, paths);
    throw new ClientError('disconnected', 'The conversation changed before the attachment was queued. It was removed there and not shown here.');
  }
  rt.notify();
  return { id: '', ...chip };
}

/** Composer entry point (attach button, drop, paste). Sequential, one failure at a time, never auto-sends. */
export async function attachFiles(rt: AppRuntime, files: readonly File[]): Promise<void> {
  rt.attachments.error = '';
  for (const file of files.slice(0, 8)) {
    try { await attachFile(rt, file, file.name); }
    catch (error) {
      rt.attachments.error = error instanceof ClientError ? error.message : 'That file could not be attached. Nothing was queued.';
      rt.notify();
      return;
    }
  }
  if (files.length > 8) { rt.attachments.error = 'Attach up to 8 files at a time. The first 8 were attached.'; rt.notify(); }
}

export function removeAttachment(rt: AppRuntime, id: string): void {
  rt.attachments.remove(id);
  rt.notify();
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AttachmentTray, attachmentFailure, formatBytes, validateAttachment, IMAGE_MAX_BYTES, PDF_MAX_BYTES, type Owner, type Chip } from '../../src/hermes/attachments.js';
import { ClientError } from '../../src/hermes/protocol.js';

const owner = (runtimeId: string, profile = 'default', account = 0): Owner => ({ key: `${account}|${profile}|${runtimeId}`, runtimeId, profile });

function harness() {
  const revoked: string[] = [], discarded: { owner: Owner; paths: string[] }[] = [];
  let notified = 0;
  const tray = new AttachmentTray({
    revoke: url => { revoked.push(url); },
    discard: (who, paths) => { discarded.push({ owner: who, paths }); },
    notify: () => { notified += 1; },
  });
  return { tray, revoked, discarded, notified: () => notified };
}
const chip = (name: string, paths: string[] = [`/p/${name}`], previewUrl?: string): Omit<Chip, 'id'> =>
  ({ kind: 'image', name, size: 10, paths, previewUrl });

test('validation admits images and PDFs within the upstream caps and refuses everything else', () => {
  assert.deepEqual(validateAttachment({ name: 'a.png', size: 10, type: 'image/png' }), { ok: true, kind: 'image', method: 'image.attach_bytes' });
  assert.deepEqual(validateAttachment({ name: 'doc.pdf', size: 10, type: 'application/pdf' }), { ok: true, kind: 'pdf', method: 'pdf.attach' });
  assert.deepEqual(validateAttachment({ name: 'doc.pdf', size: 10, type: '' }), { ok: true, kind: 'pdf', method: 'pdf.attach' });
  assert.deepEqual(validateAttachment({ name: 'big.png', size: IMAGE_MAX_BYTES, type: 'image/png' }).ok, true);
  const oversizedImage = validateAttachment({ name: 'big.png', size: IMAGE_MAX_BYTES + 1, type: 'image/png' });
  assert.equal(oversizedImage.ok, false);
  assert.match(oversizedImage.ok ? '' : oversizedImage.message, /25 MB or smaller/);
  const oversizedPdf = validateAttachment({ name: 'big.pdf', size: PDF_MAX_BYTES + 1, type: 'application/pdf' });
  assert.match(oversizedPdf.ok ? '' : oversizedPdf.message, /50 MB or smaller/);
  const text = validateAttachment({ name: 'notes.txt', size: 4, type: 'text/plain' });
  assert.equal(text.ok, false);
  assert.match(text.ok ? '' : text.message, /Only images and PDFs/);
  assert.equal(validateAttachment({ name: 'empty.png', size: 0, type: 'image/png' }).ok, false);
});

test('validation sanitises control characters from file names in copy', () => {
  const refused = validateAttachment({ name: 'bad\u0007\u0000name.txt', size: 4, type: 'text/plain' });
  assert.equal(refused.ok, false);
  assert.ok(!(refused.ok ? '' : refused.message).includes('\u0007'));
});

test('failure copy maps upstream codes to plain language without exposing raw RPC text', () => {
  assert.equal(attachmentFailure(new ClientError('rpc', 'x', -32601), 'a.png'), 'Attachments are not supported by this Hermes version.');
  assert.match(attachmentFailure(new ClientError('rpc', 'x', 4018), 'a.png'), /too large/);
  assert.match(attachmentFailure(new ClientError('rpc', 'x', 5028), 'a.pdf'), /poppler/);
  assert.match(attachmentFailure(new ClientError('rpc', 'x', 4016), 'a.gif'), /does not accept that image type/);
  assert.match(attachmentFailure(new ClientError('disconnected', 'Conversation changed.'), 'a.png'), /Conversation changed/);
  assert.match(attachmentFailure(new Error('boom'), 'a.png'), /Nothing was queued/);
});

test('formatBytes produces compact sizes', () => {
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(2048), '2 KB');
  assert.equal(formatBytes(3 * 1024 * 1024), '3.0 MB');
});

test('chips are scoped to their owner and invisible to any other owner', () => {
  const { tray } = harness();
  const a = owner('rt-a');
  tray.setOwner(a);
  const ticket = tray.begin(a)!;
  assert.equal(tray.accept(ticket, chip('one.png')), true);
  assert.equal(tray.itemsFor(a).length, 1);
  assert.equal(tray.itemsFor(owner('rt-b')).length, 0);
  assert.equal(tray.itemsFor(undefined).length, 0);
});

test('switching owner clears chips and does not resurrect them when the first owner is selected again', () => {
  const { tray, discarded, revoked } = harness();
  const a = owner('rt-a'), b = owner('rt-b');
  tray.setOwner(a);
  tray.accept(tray.begin(a)!, chip('one.png', ['/p/one.png'], 'blob:one'));
  tray.setOwner(b);
  assert.equal(tray.items.length, 0);
  assert.deepEqual(revoked, ['blob:one']);
  // The old session still exists upstream, so its queued copy is detached rather than left to fire later.
  assert.deepEqual(discarded, [{ owner: a, paths: ['/p/one.png'] }]);
  tray.setOwner(a);
  assert.equal(tray.items.length, 0, 'returning to the owner must not show the old chips');
});

test('profile and account changes are owner changes too', () => {
  const { tray } = harness();
  tray.setOwner(owner('rt-a', 'default', 0));
  tray.accept(tray.begin(owner('rt-a', 'default', 0))!, chip('x.png'));
  tray.setOwner(owner('rt-a', 'work', 0));
  assert.equal(tray.items.length, 0);
  tray.setOwner(owner('rt-a', 'work', 0));
  tray.accept(tray.begin(owner('rt-a', 'work', 0))!, chip('y.png'));
  tray.setOwner(owner('rt-a', 'work', 1));
  assert.equal(tray.items.length, 0, 'an identity boundary (account generation) clears the tray');
});

test('generation invalidation: an attach that resolves after a switch is refused', () => {
  const { tray } = harness();
  const a = owner('rt-a'), b = owner('rt-b');
  tray.setOwner(a);
  const ticket = tray.begin(a)!;
  tray.setOwner(b);
  assert.equal(tray.accept(ticket, chip('late.png')), false);
  assert.equal(tray.items.length, 0);
  tray.setOwner(a);
  assert.equal(tray.accept(ticket, chip('late.png')), false, 'the stale ticket stays dead even when the owner returns');
});

test('generation invalidation: a clear invalidates in-flight attaches for the same owner', () => {
  const { tray } = harness();
  const a = owner('rt-a');
  tray.setOwner(a);
  const ticket = tray.begin(a)!;
  tray.clear();
  assert.equal(tray.accept(ticket, chip('late.png')), false);
});

test('begin refuses a request for a non-current owner', () => {
  const { tray } = harness();
  tray.setOwner(owner('rt-a'));
  assert.equal(tray.begin(owner('rt-b')), undefined);
  assert.equal(tray.begin(undefined), undefined);
});

test('remove detaches the chip upstream and revokes its preview exactly once', () => {
  const { tray, discarded, revoked } = harness();
  const a = owner('rt-a');
  tray.setOwner(a);
  tray.accept(tray.begin(a)!, chip('one.png', ['/p/one.png'], 'blob:one'));
  const id = tray.items[0]!.id;
  tray.remove(id);
  assert.equal(tray.items.length, 0);
  assert.deepEqual(discarded, [{ owner: a, paths: ['/p/one.png'] }]);
  assert.deepEqual(revoked, ['blob:one']);
  tray.remove(id);
  assert.equal(discarded.length, 1, 'removing an unknown chip is a no-op');
});

test('consume clears chips without detaching them, because Hermes has used them', () => {
  const { tray, discarded, revoked } = harness();
  const a = owner('rt-a');
  tray.setOwner(a);
  tray.accept(tray.begin(a)!, chip('one.png', ['/p/one.png'], 'blob:one'));
  tray.consume(owner('rt-other'));
  assert.equal(tray.items.length, 1, 'a consume for another owner must not touch this tray');
  tray.consume(a);
  assert.equal(tray.items.length, 0);
  assert.equal(discarded.length, 0);
  assert.deepEqual(revoked, ['blob:one']);
});

test('clear(true) detaches every queued path of the current owner; PDFs contribute one path per page', () => {
  const { tray, discarded } = harness();
  const a = owner('rt-a');
  tray.setOwner(a);
  tray.accept(tray.begin(a)!, chip('one.png', ['/p/one.png']));
  tray.accept(tray.begin(a)!, { kind: 'pdf', name: 'doc.pdf', size: 9, paths: ['/p/doc-1.png', '/p/doc-2.png'] });
  tray.clear();
  assert.deepEqual(discarded, [{ owner: a, paths: ['/p/one.png', '/p/doc-1.png', '/p/doc-2.png'] }]);
  assert.equal(tray.items.length, 0);
});

test('notify fires on every visible change', () => {
  const { tray, notified } = harness();
  const before = notified();
  tray.setOwner(owner('rt-a'));
  assert.ok(notified() > before);
});

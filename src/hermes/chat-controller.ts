import type { DashboardClient } from './dashboard-client.js';
import type { GatewayClient } from './gateway-client.js';
import { NativeSession } from './native-session.js';
import { SessionBrowser } from './session-browser.js';
import { ClientError } from './protocol.js';
import { profileName, sessionId, type SessionRef } from './session-rest.js';

type Gateway = Pick<GatewayClient, 'call' | 'onEvent' | 'onState' | 'state'>;
type Reader = Pick<DashboardClient, 'sessions' | 'searchSessions' | 'sessionMessages'>;
export function navigation(ref?: SessionRef): string {
  if (!ref) return '';
  const query = new URLSearchParams({ session: sessionId(ref.id) });
  if (profileName(ref.profile)) query.set('profile', ref.profile!);
  return `#${query}`;
}
export function navigationRef(hash: string): SessionRef | undefined {
  const query = new URLSearchParams(hash.replace(/^#/, ''));
  const id = query.get('session');
  return id ? { id: sessionId(id), profile: profileName(query.get('profile') ?? undefined) } : undefined;
}
export function draftKey(ref?: SessionRef): string { return JSON.stringify([ref?.profile ?? '', ref?.id ?? '']); }

/** Selection and composer state only. NativeSession remains the disposable upstream projection. */
export class ChatController {
  readonly browser: SessionBrowser;
  native: NativeSession;
  selected?: SessionRef;
  draft = '';
  busy = false;
  historical = false;
  error?: ClientError;
  private scope = 0;
  private enabled = false;
  private disposed = false;
  private drafts = new Map<string, string>();
  private listeners = new Set<() => void>();
  private refreshTimer?: ReturnType<typeof setTimeout>;
  private unlisten: () => void;
  constructor(private readonly dashboard: Reader, private readonly gateway: Gateway,
    private readonly onAuthFailure?: (error: ClientError) => void) {
    this.browser = new SessionBrowser(dashboard, onAuthFailure);
    this.native = this.newNative();
    this.browser.subscribe(() => this.publish());
    this.unlisten = gateway.onState((state) => {
      if (state.phase === 'ready') queueMicrotask(() => { void this.attachIfReady(); });
    });
  }
  private newNative(): NativeSession {
    const native = new NativeSession(this.gateway);
    let previousPhase = native.state.phase;
    native.subscribe((state) => {
      if (this.native !== native || this.disposed) return;
      if (state.storedId && state.phase !== 'attaching') this.selected = { id: state.storedId, profile: state.profile };
      if (state.phase === 'idle' && previousPhase !== 'idle') this.refreshIndexSoon();
      previousPhase = state.phase; this.publish();
    });
    return native;
  }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); listener(); return () => { this.listeners.delete(listener); }; }
  private publish(): void { if (!this.disposed) for (const listener of this.listeners) listener(); }
  private fail(error: unknown, scope: number): void {
    if (scope !== this.scope || this.disposed) return;
    this.error = error instanceof ClientError ? error : new ClientError('protocol', 'Conversation operation failed');
    if (this.error.kind === 'auth-required') this.onAuthFailure?.(this.error);
    this.publish();
  }
  setEnabled(enabled: boolean): void {
    const was = this.enabled; this.enabled = enabled;
    if (enabled && !was && this.browser.index.phase === 'empty') void this.browser.list();
  }
  private ready(): boolean { return this.enabled && this.gateway.state.phase === 'ready'; }
  setDraft(text: string): void { this.draft = text.slice(0,32768); }
  private saveDraft(): void {
    const key = draftKey(this.selected); this.drafts.delete(key);
    if (this.draft && this.selected) this.drafts.set(key, this.draft);
    while (this.drafts.size > 20) this.drafts.delete(this.drafts.keys().next().value!);
  }
  private reset(ref?: SessionRef): number {
    this.saveDraft(); ++this.scope;
    this.native.dispose(); this.native = this.newNative();
    this.browser.clearHistory(); this.selected = ref;
    this.draft = this.drafts.get(draftKey(ref)) ?? '';
    this.historical = false; this.busy = false; this.error = undefined;
    this.publish(); return this.scope;
  }
  async create(): Promise<void> {
    if (!this.ready() || this.busy) return;
    const scope = this.reset(); this.busy = true; this.publish();
    try { await this.native.create(); } catch (error) { this.fail(error, scope); }
    finally { if (scope === this.scope) { this.busy = false; this.publish(); } }
  }
  async open(ref: SessionRef): Promise<void> {
    if (!this.enabled) return;
    const scope = this.reset(ref); this.busy = true; this.publish();
    try {
      const page = await this.browser.open(ref);
      if (scope !== this.scope || !page) return;
      this.selected = { id:page.id, profile:page.profile };
      if (this.ready()) await this.native.resume(page.id, page.profile);
    } catch (error) { this.fail(error, scope); }
    finally { if (scope === this.scope) { this.busy = false; this.publish(); } }
  }
  async attachIfReady(): Promise<void> {
    // Run outside the synchronous gateway state dispatch: NativeSession may already be resuming.
    if (!this.ready() || this.busy || !this.selected || this.native.state.storedId || this.browser.history.phase !== 'ready') return;
    const scope = this.scope; this.busy = true; this.publish();
    try { await this.native.resume(this.selected.id, this.selected.profile); }
    catch (error) { this.fail(error, scope); }
    finally { if (scope === this.scope) { this.busy = false; this.publish(); } }
  }
  async send(): Promise<void> {
    if (!this.ready() || this.busy || this.historical || !this.draft.trim() || this.native.state.phase !== 'idle') return;
    const scope = this.scope, text = this.draft, native = this.native;
    this.error = undefined;
    try {
      await native.submit(text);
      if (scope === this.scope && this.native === native && this.draft === text) {
        this.draft = ''; this.drafts.delete(draftKey(this.selected));
      }
    } catch (error) { this.fail(error, scope); }
    finally { if (scope === this.scope) { this.refreshIndexSoon(); this.publish(); } }
  }
  async interrupt(): Promise<void> {
    if (!this.ready() || this.busy || this.historical) return;
    const scope = this.scope;
    try { await this.native.interrupt(); } catch (error) { this.fail(error, scope); }
  }
  async historyPage(offset: number): Promise<void> {
    if (!this.enabled || !this.selected || this.busy || ['running','waiting'].includes(this.native.state.phase)) return;
    const scope = this.scope;
    this.busy = true; this.historical = true; this.error = undefined; this.publish();
    try { await this.browser.open(this.selected, offset); }
    finally { if (scope === this.scope) { this.busy = false; this.publish(); } }
  }
  async latest(): Promise<void> {
    if (this.busy) return;
    const scope = this.scope; this.error = undefined; this.historical = false;
    if (this.native.state.runtimeId && this.ready()) {
      this.browser.clearHistory();
      try { await this.native.refresh(); } catch (error) { this.fail(error, scope); }
    } else if (this.selected && this.enabled) await this.open(this.selected);
    this.publish();
  }
  refreshIndexSoon(): void {
    clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => {
      if (this.enabled && this.browser.index.phase !== 'loading') void this.browser.refresh();
    }, 250);
  }
  clear(): void {
    ++this.scope; clearTimeout(this.refreshTimer); this.enabled = false;
    this.native.dispose(); this.native = this.newNative();
    this.selected = undefined; this.draft = ''; this.drafts.clear(); this.busy = false; this.historical = false; this.error = undefined;
    this.browser.clear(); this.publish();
  }
  dispose(): void { this.clear(); this.disposed = true; this.native.dispose(); this.browser.dispose(); this.unlisten(); this.listeners.clear(); }
}

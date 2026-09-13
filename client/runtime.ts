import { DocumentRequests } from './document-requests.js';
import { DashboardClient } from '../src/hermes/dashboard-client.js';
import { GatewayClient } from '../src/hermes/gateway-client.js';
import { WsAuthClient } from '../src/hermes/ws-auth.js';
import { ConnectionStore } from '../src/hermes/connection-store.js';
import { DiagnosticsRing } from '../src/hermes/diagnostics.js';
import { ChatController, draftKey, navigation, navigationRef } from '../src/hermes/chat-controller.js';
import { ClientError } from '../src/hermes/protocol.js';
import type { SessionRef } from '../src/hermes/session-rest.js';

/** One disposable client lifetime; React never builds RPC envelopes or owns durable sessions. */
export class AppRuntime {
  readonly diagnostics = new DiagnosticsRing();
  private readonly requests = new DocumentRequests(window);
  readonly dashboard: DashboardClient;
  readonly gateway: GatewayClient;
  readonly connection: ConnectionStore;
  readonly chat: ChatController;
  accountGeneration = 0;
  error = '';
  private revision = 0;
  private frame = 0;
  private started = false;
  private openedLocation = false;
  private listeners = new Set<() => void>();
  private cleanup: (() => void)[] = [];
  constructor(origin: string) {
    this.dashboard = new DashboardClient(origin, this.requests.fetch, 15_000, this.diagnostics);
    this.gateway = new GatewayClient(new WsAuthClient(this.dashboard, signal => this.connection.verifyAdmission(signal)), { diagnostics: this.diagnostics });
    this.connection = new ConnectionStore(this.dashboard, this.gateway, this.diagnostics);
    this.chat = new ChatController(this.dashboard, this.gateway, error => this.gateway.suspend(error));
  }
  get readable() { return this.connection.hasAccess && !this.connection.state.offline; }
  get ready() { return this.readable && this.gateway.state.phase === 'ready'; }
  getSnapshot = () => this.revision;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  notify = () => {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      if (this.chat.selected && !this.chat.busy && this.readable) {
        const hash = navigation(this.chat.selected);
        if (location.hash !== hash) history.replaceState(null, '', hash);
      }
      ++this.revision; this.listeners.forEach(listener => listener());
    });
  };
  run = (operation: () => Promise<unknown>) => {
    const account = this.accountGeneration;
    this.error = ''; this.notify();
    void operation().catch(error => {
      if (account === this.accountGeneration) {
        this.error = error instanceof ClientError ? error.message : 'That operation could not be completed. Please try again.';
      }
    }).finally(this.notify);
  };
  private navigate = () => {
    if (!this.readable) return;
    try {
      const ref = navigationRef(location.hash);
      if (ref && draftKey(ref) !== draftKey(this.chat.selected)) this.run(() => this.chat.open(ref));
      else if (!ref && this.chat.selected) { this.chat.clear(); this.chat.setEnabled(this.readable); }
    } catch { this.error = 'This conversation link is invalid.'; this.notify(); }
  };
  start() {
    if (this.started) return;
    this.started = true;
    this.cleanup.push(this.chat.subscribe(this.notify), this.gateway.onState(this.notify));
    this.cleanup.push(this.connection.onIdentityBoundary(() => {
      ++this.accountGeneration; this.openedLocation = false;
      this.chat.clear(); this.error = ''; history.replaceState(null, '', location.pathname);
      document.querySelectorAll<HTMLInputElement>('input[type="password"]').forEach(input => { input.value = ''; });
      this.notify();
    }));
    this.cleanup.push(this.connection.subscribe(() => {
      this.chat.setEnabled(this.readable);
      if (this.readable && !this.openedLocation) { this.openedLocation = true; this.navigate(); }
      this.notify();
    }));
    const resume = () => {
      const visible = document.visibilityState === 'visible';
      this.connection.poll(visible ? 30_000 : 0);
      if (visible) this.run(() => this.connection.resume());
    };
    const listen = (target: EventTarget, event: string, callback: () => void) => {
      target.addEventListener(event, callback); this.cleanup.push(() => target.removeEventListener(event, callback));
    };
    listen(window, 'popstate', this.navigate); listen(window, 'hashchange', this.navigate);
    listen(document, 'visibilitychange', resume);
    listen(window, 'pageshow', () => {
      resume();
      if (this.readable) this.run(() => this.chat.browser.refresh());
    });
    listen(window, 'online', () => this.run(() => this.connection.setOffline(false)));
    listen(window, 'offline', () => this.run(() => this.connection.setOffline(true)));
    this.connection.poll();
    this.run(() => navigator.onLine ? this.connection.start() : this.connection.setOffline(true));
  }
  newChat = () => {
    if (!this.ready || this.chat.busy) return;
    this.error = ''; history.pushState(null, '', location.pathname);
    this.run(() => this.chat.create());
  };
  open = (ref: SessionRef) => {
    if (!this.readable || this.chat.busy) return;
    try { history.pushState(null, '', navigation(ref)); this.run(() => this.chat.open(ref)); }
    catch { this.error = 'This conversation link is invalid.'; this.notify(); }
  };
  setDraft = (value: string) => { this.chat.setDraft(value); this.notify(); };
  send = () => this.run(async () => {
    if (!this.ready || this.chat.busy || !this.chat.draft.trim()) return;
    if (!this.chat.selected) {
      const text = this.chat.draft, account = this.accountGeneration;
      const creation = this.chat.create(), native = this.chat.native;
      await creation;
      if (account !== this.accountGeneration || native !== this.chat.native) return;
      this.chat.setDraft(text);
      if (this.chat.error) return;
    }
    await this.chat.send();
  });
  dispose() {
    this.requests.dispose();
    this.cleanup.forEach(fn => fn()); this.cleanup = [];
    cancelAnimationFrame(this.frame); this.chat.dispose(); this.connection.dispose(); this.listeners.clear();
  }
}

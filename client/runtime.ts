import { WorkspaceMutations } from './workspace/mutations.js';
import { WorkspaceApi } from './workspace/api.js';
import { PwaController } from './pwa.js';
import { SessionAttention } from '../src/hermes/session-attention.js';
import { profileIdentifier, type ModelChoice, type Effort } from '../src/hermes/model-catalog.js';
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
  readonly pwa = new PwaController(() => this.reloadBlocker());
  reloadBlocker = () => this.gateway?.requests.getSnapshot().length ? 'Answer or decline the native request before updating.' : this.connection?.state.busy ? 'Wait for authentication to finish.' : this.workspaceMutations?.blocker() || this.chat?.reloadBlocker() || '';
  readonly diagnostics = new DiagnosticsRing();
  private readonly requests = new DocumentRequests(window);
  readonly dashboard: DashboardClient;
  readonly gateway: GatewayClient;
  readonly connection: ConnectionStore;
  readonly chat: ChatController;
  readonly attention: SessionAttention;
  readonly workspaceMutations: WorkspaceMutations;
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
    this.attention = new SessionAttention(this.gateway);
    this.workspaceMutations = new WorkspaceMutations(new WorkspaceApi(this.requests.fetch), this.requests.fetch, () => this.readable && !this.connection.state.busy && !this.pwa.state.updating, () => { void this.connection.refresh(); });
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
    if (this.pwa.state.updating) return;
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
    if (this.workspaceMutations.state.phase !== 'closed') { history.replaceState(null, '', this.chat.selected ? navigation(this.chat.selected) : location.pathname); return; }
    try {
      const ref = navigationRef(location.hash);
      if (ref && draftKey(ref) !== draftKey(this.chat.selected)) this.run(() => this.chat.open(ref));
      else if (!ref && this.chat.selected) { this.chat.clear(); this.chat.setEnabled(this.readable); }
    } catch { this.error = 'This conversation link is invalid.'; this.notify(); }
  };
  start() {
    if (this.started) return;
    this.started = true; this.gateway.requests.setVisible(document.visibilityState === 'visible');
    this.cleanup.push(this.workspaceMutations.subscribe(this.notify));
    this.cleanup.push(this.pwa.subscribe(this.notify)); void this.pwa.start();
    this.cleanup.push(this.attention.subscribe(this.notify), this.chat.subscribe(() => {
      this.chat.native.commands.setVisible(document.visibilityState === 'visible');
      const state = this.chat.native.state;
      if (state.runtimeId && state.storedId) this.attention.bind(state.runtimeId, { id: state.storedId, profile: state.profile });
      this.attention.select(state.runtimeId); this.notify();
    }), this.gateway.onState(() => { this.attention.setEnabled(this.ready); this.notify(); }));
    this.cleanup.push(this.connection.onIdentityBoundary(() => {
      this.workspaceMutations.clear();
      ++this.accountGeneration; this.openedLocation = false; this.gateway.requests.clear();
      this.attention.clear(); this.chat.clear(); this.error = ''; history.replaceState(null, '', location.pathname);
      document.querySelectorAll<HTMLInputElement>('input[type="password"]').forEach(input => { input.value = ''; });
      this.notify();
    }));
    this.cleanup.push(this.connection.subscribe(() => {
      if (!this.readable) this.workspaceMutations.pause();
      this.chat.setEnabled(this.readable); this.attention.setEnabled(this.ready);
      if (this.readable && !this.openedLocation) { this.openedLocation = true; this.navigate(); }
      this.notify();
    }));
    const resume = () => {
      const visible = document.visibilityState === 'visible';
      this.connection.poll(visible ? 30_000 : 0); this.attention.setVisible(visible);
      this.gateway.requests.setVisible(visible);
      this.chat.native.commands.setVisible(visible); this.notify();
      if (visible) this.run(async () => { await this.connection.resume(); if (this.ready && this.chat.native.state.runtimeId) await this.chat.native.refresh(); });
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
    listen(window, 'online', () => this.run(async () => { await this.connection.setOffline(false); if (!this.connection.hasAccess) await this.connection.start(); }));
    listen(window, 'offline', () => this.run(() => this.connection.setOffline(true)));
    this.connection.poll();
    this.run(() => navigator.onLine ? this.connection.start() : this.connection.setOffline(true));
  }
  newChat = () => {
    if (!this.ready || this.chat.busy || this.workspaceMutations.state.phase !== 'closed') return;
    this.error = ''; history.pushState(null, '', location.pathname);
    this.run(() => this.chat.create(this.chat.selected?.profile));
  };
  open = (ref: SessionRef) => {
    if (!this.readable || this.chat.busy || this.workspaceMutations.state.phase !== 'closed') return;
    try { history.pushState(null, '', navigation(ref)); this.run(() => this.chat.open(ref)); }
    catch { this.error = 'This conversation link is invalid.'; this.notify(); }
  };
  openLive = (runtimeId: string, storedId?: string, profile?: string) => {
    if (!this.ready || this.chat.busy || this.workspaceMutations.state.phase !== 'closed') return;
    history.pushState(null, '', location.pathname);
    this.run(async () => {
      await this.chat.openLive(runtimeId, storedId, profile);
      // The row may have been reaped while the user was clicking it. Always reconcile the inventory
      // after a deliberate open so a stale process-local handle disappears instead of remaining clickable.
      await this.attention.refresh();
    });
  };
  setDraft = (value: string) => { this.chat.setDraft(value); this.notify(); };
  send = () => this.run(async () => {
    if (!this.ready || this.chat.busy || this.workspaceMutations.state.phase !== 'closed' || !this.chat.draft.trim()) return;
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
  private async settingsSession() {
    if (!this.ready || this.chat.busy || this.chat.historical || this.workspaceMutations.state.phase !== 'closed')
      throw new ClientError('disconnected', 'Connect to an idle conversation to change settings');
    if (!this.chat.native.state.runtimeId) {
      if (this.chat.selected) throw new ClientError('disconnected', 'Wait for native reattachment');
      const draft = this.chat.draft, account = this.accountGeneration;
      const creation = this.chat.create(), native = this.chat.native;
      await creation;
      if (account !== this.accountGeneration || native !== this.chat.native || !this.ready)
        throw new ClientError('disconnected', 'Conversation selection changed');
      this.chat.setDraft(draft);
      if (this.chat.error || !native.state.runtimeId) throw this.chat.error ?? new ClientError('protocol', 'Could not prepare a native conversation');
    }
    return this.chat.native;
  }
  private async commandSession() {
    if (!this.ready || this.chat.historical)
      throw new ClientError('disconnected', 'Connect to a live conversation to use commands');
    if (!this.chat.native.state.runtimeId) {
      if (this.chat.selected) throw new ClientError('disconnected', 'Wait for native reattachment');
      if (this.chat.busy) throw new ClientError('protocol', 'Wait for the selected conversation to attach');
      const draft = this.chat.draft, account = this.accountGeneration;
      const creation = this.chat.create(), native = this.chat.native;
      await creation;
      if (account !== this.accountGeneration || native !== this.chat.native || !this.ready)
        throw new ClientError('disconnected', 'Conversation selection changed');
      this.chat.setDraft(draft);
      if (this.chat.error || !native.state.runtimeId) throw this.chat.error ?? new ClientError('protocol', 'Could not prepare a native conversation');
    }
    return this.chat.native;
  }
  /** A deliberate catalogue action, independent of the unsent composer draft. Busy-safe slash commands
   * are admitted by NativeCommands according to the pinned Hermes registry; settings controls remain idle-only. */
  async command(text: string): Promise<void> {
    const account = this.accountGeneration;
    let native = this.chat.native;
    try { native = await this.commandSession(); await native.commands.execute(text); }
    catch (error) { if (native === this.chat.native && account === this.accountGeneration) throw error; }
  }
  /** Confirm one prepared command. Never discard a different catalogue-origin draft. */
  async confirmCommand(): Promise<void> {
    const native = this.chat.native, account = this.accountGeneration;
    const pending = native.commands.state.confirmation, text = pending?.text;
    const originalDraft = this.chat.draft;
    try {
      await native.commands.confirm();
      if (native === this.chat.native && account === this.accountGeneration && pending?.source === 'composer' && text === originalDraft && this.chat.draft === originalDraft) {
        this.chat.setDraft(''); this.notify();
      }
    } catch (error) { if (native === this.chat.native && account === this.accountGeneration) throw error; }
  }
  async changeModel(choice: ModelChoice): Promise<void> {
    const native = await this.settingsSession();
    await native.settings.changeModel(choice);
  }
  async changeReasoning(effort: Effort): Promise<void> {
    const native = await this.settingsSession();
    await native.settings.changeReasoning(effort);
  }
  async changeYolo(enabled: boolean): Promise<void> {
    const native = await this.settingsSession();
    await native.setYolo(enabled);
  }
  async newProfile(profile: string): Promise<void> {
    profileIdentifier(profile);
    if (!this.ready || this.chat.busy || this.workspaceMutations.state.phase !== 'closed' || this.chat.native.settings.state.busy || this.chat.native.commands.blocked ||
      ['running', 'waiting'].includes(this.chat.native.state.phase))
      throw new ClientError('protocol', 'Wait for the current turn before changing profile');
    // A profile is a new conversation boundary. Keep the previous draft with its owner.
    history.pushState(null, '', location.pathname);
    await this.chat.create(profile);
  }
  dispose() {
    this.workspaceMutations.clear();
    this.pwa.dispose();
    this.requests.dispose();
    this.cleanup.forEach(fn => fn()); this.cleanup = [];
    cancelAnimationFrame(this.frame); this.attention.dispose(); this.chat.dispose(); this.connection.dispose(); this.listeners.clear();
  }
}

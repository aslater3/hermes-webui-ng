import { WorkspaceMutations } from './workspace/mutations.js';
import { WorkspaceApi } from './workspace/api.js';
import { PwaController } from './pwa.js';
import { SessionAttention } from '../src/hermes/session-attention.js';
import { profileIdentifier, type ModelChoice, type Effort } from '../src/hermes/model-catalog.js';
import { DocumentRequests } from './document-requests.js';
import { DashboardClient, HttpError } from '../src/hermes/dashboard-client.js';
import { GatewayClient } from '../src/hermes/gateway-client.js';
import { WsAuthClient } from '../src/hermes/ws-auth.js';
import { ConnectionStore } from '../src/hermes/connection-store.js';
import { DiagnosticsRing } from '../src/hermes/diagnostics.js';
import { ChatController, draftKey, navigation, navigationRef, navigationView } from '../src/hermes/chat-controller.js';
import { subagentTerminal } from '../src/hermes/subagent-catalog.js';
import { slashInput } from '../src/hermes/command-catalog.js';
import { steerOutcomeCopy, steerSession } from '../src/hermes/session-steer.js';
import { ClientError } from '../src/hermes/protocol.js';
import type { SessionRef } from '../src/hermes/session-rest.js';
import { AttachmentTray, type Owner } from '../src/hermes/attachments.js';
import { DictationMachine, scopeTransition, SpeechPlayback, VoiceError, classifyVoiceHttp, dataUrlToBlob, insertTranscript, recordingMime, type PlaybackAudio, type RecorderLike, type StreamLike, type RecordingMime } from '../src/hermes/voice.js';

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
  /** Queued composer attachments for the selected native session (local only, never persisted). */
  /** Dictation context is the view key (account + conversation), so a late transcript cannot land in another one. */
  readonly dictation: DictationMachine<{ key: string; profile?: string }> = new DictationMachine<{ key: string; profile?: string }>({
    mime: voiceMime(),
    requestStream: async () => {
      if (!voiceMime() || !navigator.mediaDevices?.getUserMedia) throw new VoiceError('unsupported');
      return navigator.mediaDevices.getUserMedia({ audio: true }) as Promise<StreamLike>;
    },
    createRecorder: (stream, recorderType) => new MediaRecorder(stream as MediaStream, { mimeType: recorderType, audioBitsPerSecond: 32000 }) as unknown as RecorderLike,
    transcribe: async (audio, payloadType, signal, context) => {
      const dataUrl = await blobToDataUrl(audio, payloadType);
      try { return await this.dashboard.transcribe(dataUrl, payloadType, context.profile, signal); }
      catch (error) { throw voiceFailure(error); }
    },
    isCurrent: context => context.key === this.viewKeyNow() ||
      (this.adoptedScope?.from === context.key && this.adoptedScope.to === this.viewKeyNow()),
    insert: transcript => this.setDraft(insertTranscript(this.chat.draft, transcript).text),
    now: () => performance.now(),
    schedule: (callback, ms) => { const timer = setTimeout(callback, ms); return () => clearTimeout(timer); },
    onChange: () => this.notify(),
  });
  /** Read aloud: one playback at a time. The audio object URL is revoked when playback ends or stops. */
  readonly speech = new SpeechPlayback({
    fetchSpeech: async (text, signal) => {
      try { const reply = await this.dashboard.speak(text, this.chat.native.state.profile, signal); return dataUrlToBlob(reply.dataUrl, reply.mimeType); }
      catch (error) { throw voiceFailure(error); }
    },
    createAudio: url => new Audio(url) as unknown as PlaybackAudio,
    createUrl: blob => URL.createObjectURL(blob),
    revoke: url => URL.revokeObjectURL(url),
    onChange: () => this.notify(),
  });
  /** Hermes voice availability from the audio config route. 'unknown' still lets the user try. */
  voiceSupport: 'unknown' | 'available' | 'unavailable' = 'unknown';
  private lastViewKey?: string;
  /** The last `n|` -> `n|ref` adoption, so a take started before the conversation had an id still lands. */
  private adoptedScope?: { from: string; to: string };
  readonly attachments: AttachmentTray = new AttachmentTray({
    revoke: url => URL.revokeObjectURL(url),
    discard: (owner, paths) => { void this.discardAttachmentPaths(owner, paths); },
    notify: () => this.notify(),
  });
  readonly workspaceMutations: WorkspaceMutations;
  accountGeneration = 0;
  error = '';
  steering = false;
  steerStatus = '';
  steerRuntimeId?: string;
  private revision = 0;
  private frame = 0;
  private frameTimer: ReturnType<typeof setTimeout> | 0 = 0;
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
    // A dropped animation frame (occluded, backgrounded or a busy engine) must not wedge every later
    // update: without the fallback the pending flag would never clear and this store would go silent.
    const publish = () => {
      if (!this.frame) return;
      clearTimeout(this.frameTimer); this.frame = 0; this.frameTimer = 0;
      if (this.chat.selected && !this.chat.busy && this.readable) {
        const hash = navigation(this.chat.selected, this.chat.subagent ? 'subagent' : undefined);
        if (location.hash !== hash) history.replaceState(null, '', hash);
      }
      ++this.revision; this.listeners.forEach(listener => listener());
    };
    this.frame = requestAnimationFrame(publish);
    this.frameTimer = setTimeout(publish, 250);
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
      const ref = navigationRef(location.hash), subagent = navigationView(location.hash) === 'subagent';
      if (ref && (draftKey(ref) !== draftKey(this.chat.selected) || subagent !== !!this.chat.subagent))
        this.run(() => subagent ? this.chat.openSubagent(ref) : this.chat.open(ref));
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
      this.attachments.setOwner(this.attachmentOwner());
      this.syncViewScope();
      const state = this.chat.native.state;
      if (this.steerRuntimeId && (state.runtimeId !== this.steerRuntimeId || state.phase !== 'running')) {
        this.steering = false; this.steerStatus = ''; this.steerRuntimeId = undefined;
      }
      if (state.runtimeId && state.storedId) this.attention.bind(state.runtimeId, { id: state.storedId, profile: state.profile });
      this.attention.select(state.runtimeId); this.notify();
    }), this.attention.subscribe(() => {
      const ref = this.chat.selected, live = this.chat.subagent && ref ? this.attention.subagentBySession(ref.id) : undefined;
      if (live) this.chat.describeSubagent({ parent: live.parent, goal: live.goal });
    }), this.gateway.onState(() => {
      this.attention.setEnabled(this.ready);
      // A dropped connection cannot be detached upstream now; never keep showing chips that may be stale.
      if (!this.ready) this.attachments.clear(false);
      this.notify();
    }));
    this.cleanup.push(this.connection.onIdentityBoundary(() => {
      this.workspaceMutations.clear();
      ++this.accountGeneration; this.openedLocation = false; this.gateway.requests.clear();
      this.attention.clear(); this.chat.clear(); this.attachments.clear(false); this.error = ''; this.steering = false; this.steerStatus = ''; this.steerRuntimeId = undefined; history.replaceState(null, '', location.pathname);
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
      // A hidden page cannot finish a recording or keep speaking: stop, discard, and say so when it returns.
      if (!visible) { this.dictation.cancel('interrupted'); this.speech.stop(); }
      this.chat.native.commands.setVisible(visible); this.notify();
      if (visible) this.run(async () => { await this.connection.resume(); if (this.ready && this.chat.native.state.runtimeId) await this.chat.native.refresh(); });
    };
    const listen = (target: EventTarget, event: string, callback: () => void) => {
      target.addEventListener(event, callback); this.cleanup.push(() => target.removeEventListener(event, callback));
    };
    listen(window, 'popstate', this.navigate); listen(window, 'hashchange', this.navigate);
    // A running child's transcript is REST-only, so its latest page is re-read while it is still working.
    const poll = setInterval(() => {
      const view = this.chat.subagent, ref = this.chat.selected;
      if (!view || !ref || document.visibilityState !== 'visible' || !this.readable || this.chat.busy) return;
      const live = this.attention.subagentBySession(ref.id);
      if (live) this.chat.describeSubagent({ parent: live.parent, goal: live.goal });
      if (live && !subagentTerminal(live.status)) void this.chat.refreshSubagent().catch(() => undefined);
    }, 4000);
    this.cleanup.push(() => clearInterval(poll));
    listen(document, 'visibilitychange', resume);
    listen(window, 'pageshow', () => {
      resume();
      if (this.readable) this.run(() => this.chat.browser.refresh());
    });
    listen(window, 'online', () => this.run(async () => { await this.connection.setOffline(false); if (!this.connection.hasAccess) await this.connection.start(); }));
    listen(window, 'offline', () => this.run(() => this.connection.setOffline(true)));
    this.connection.poll();
    this.run(() => navigator.onLine ? this.connection.start() : this.connection.setOffline(true));
    this.cleanup.push(() => { this.dictation.cancel(); this.speech.stop(); });
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
  /** Inspect a delegated child's own session: its saved transcript, read-only, starting with its initial prompt. */
  openSubagent = (ref: SessionRef, info: { parent?: SessionRef; goal?: string } = {}) => {
    if (!this.readable || this.chat.busy || this.workspaceMutations.state.phase !== 'closed') return;
    try { history.pushState(null, '', navigation(ref, 'subagent')); this.run(() => this.chat.openSubagent(ref, info)); }
    catch { this.error = 'This subagent link is invalid.'; this.notify(); }
  };
  openLive = (runtimeId: string, storedId?: string, profile?: string) => {
    if (!this.ready || this.chat.busy || this.workspaceMutations.state.phase !== 'closed') return;
    history.pushState(null, '', location.pathname);
    this.run(async () => {
      // Reconcile immediately before using an active-row handle. If the runtime vanished after render,
      // the clicked row's durable key remains the fallback; never depend on the stale process-local id.
      await this.attention.refresh();
      const fresh = this.attention.items.find(item => item.runtimeId === runtimeId);
      try { await this.chat.openLive(runtimeId, fresh?.storedId ?? storedId, fresh?.owner?.profile ?? profile); }
      finally { await this.attention.refresh(); }
    });
  };
  setDraft = (value: string) => { this.chat.setDraft(value); this.notify(); };
  /** Voice is never offered through trusted-local: its route allowlist is GET/HEAD only by design. */
  get voiceAllowed(): boolean { return this.dashboard.admissionMode !== 'trusted-local'; }
  /** This browser can record and has a MIME Hermes accepts. Read-aloud does not need it. */
  get dictationCapable(): boolean { return !!voiceMime() && typeof navigator.mediaDevices?.getUserMedia === 'function'; }
  /** The conversation the user is looking at. Voice state is scoped to it and dropped when it changes. */
  viewKeyNow(): string { return `${this.accountGeneration}|${this.chat.selected ? draftKey(this.chat.selected) : ''}`; }
  startDictation(): void {
    if (!this.ready || !this.voiceAllowed || this.voiceSupport === 'unavailable') return;
    this.dictation.start({ key: this.viewKeyNow(), profile: this.chat.native.state.profile });
    this.notify();
  }
  async probeVoice(): Promise<void> {
    if (this.voiceSupport !== 'unknown' || !this.ready || !this.voiceAllowed) return;
    try { this.voiceSupport = (await this.dashboard.voiceAvailable(this.chat.native.state.profile)) ? 'available' : 'unavailable'; }
    catch (error) { if (error instanceof HttpError && error.status === 404) this.voiceSupport = 'unavailable'; }
    this.notify();
  }
  private syncViewScope(): void {
    const key = this.viewKeyNow(), transition = scopeTransition(this.lastViewKey, key);
    if (transition === 'same') return;
    const previous = this.lastViewKey;
    this.lastViewKey = key;
    // The first sync only records the scope. A new conversation receiving its id keeps the same composer and
    // draft, so a running take is adopted and lands there; only a real switch drops it.
    if (transition === 'initial') return;
    if (transition === 'adopt') { this.adoptedScope = { from: previous!, to: key }; return; }
    this.adoptedScope = undefined;
    this.speech.stop();
    this.dictation.cancel();
    this.dictation.dismiss();
  }
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
    const native = this.chat.native, text = this.chat.draft, runtimeId = native.state.runtimeId, account = this.accountGeneration;
    if (native.state.phase === 'running') {
      if (!runtimeId || this.steering) return;
      if (slashInput(text)) {
        await native.commands.execute(text, 'composer');
        if (account === this.accountGeneration && native === this.chat.native && this.chat.draft === text &&
            !native.commands.state.confirmation && native.commands.state.action?.kind !== 'browser') {
          this.chat.setDraft('');
        }
        return;
      }
      this.steering = true; this.steerStatus = ''; this.steerRuntimeId = runtimeId; this.notify();
      try {
        const steered = await steerSession(this.gateway, runtimeId, text);
        if (account === this.accountGeneration && native === this.chat.native && native.state.runtimeId === runtimeId && this.chat.draft === text) {
          this.chat.setDraft(''); this.steerStatus = steerOutcomeCopy(steered.outcome);
        }
      } finally {
        if (this.steerRuntimeId === runtimeId) this.steering = false;
        this.notify();
      }
      return;
    }
    const owner = this.attachmentOwner();
    const sent = await this.chat.send();
    // Hermes consumes queued attachments on an accepted real turn (a prompt.submit); slash commands do not.
    // consume() only acts when the tray still belongs to that owner, so a switch mid-send cannot clear another session.
    if (sent && !slashInput(text)) this.attachments.consume(owner);
  });
  /** The native session that queued attachments belong to; undefined until Hermes has attached one. */
  attachmentOwner(): Owner | undefined {
    const state = this.chat.native.state;
    return state.runtimeId ? { key: `${this.accountGeneration}|${state.profile ?? ''}|${state.runtimeId}`, runtimeId: state.runtimeId, profile: state.profile } : undefined;
  }
  /** Best-effort upstream removal of queued attachment paths. Skipped when disconnected. */
  async discardAttachmentPaths(owner: Owner, paths: string[]): Promise<void> {
    if (!this.ready) return;
    for (const path of paths) {
      await this.gateway.call('image.detach', { session_id: owner.runtimeId, ...(owner.profile ? { profile: owner.profile } : {}), path }).catch(() => undefined);
    }
  }
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

/** Recorder support and the MIME Hermes will receive. Undefined where MediaRecorder cannot record audio. */
function voiceMime(): RecordingMime | undefined {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return undefined;
  return recordingMime(type => MediaRecorder.isTypeSupported(type));
}
function voiceFailure(error: unknown): VoiceError {
  if (error instanceof VoiceError) return error;
  if (error instanceof HttpError) return new VoiceError(classifyVoiceHttp(error.status));
  if (error instanceof ClientError) return new VoiceError(classifyVoiceHttp(undefined, error.kind === 'network' || error.kind === 'timeout' ? error.kind : 'disconnected'));
  return new VoiceError('failed');
}
function blobToDataUrl(blob: Blob, type: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new VoiceError('failed'));
    reader.onload = () => {
      const value = reader.result;
      if (typeof value !== 'string') reject(new VoiceError('failed'));
      else resolve(value.replace(/^data:[^,]*,/, `data:${type};base64,`));
    };
    reader.readAsDataURL(blob);
  });
}

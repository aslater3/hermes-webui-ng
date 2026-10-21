/**
 * Browser voice: dictation (MediaRecorder -> Dashboard /api/audio/transcribe) and read-aloud
 * (/api/audio/speak -> one <audio> element). Pure state machines with injected ports so the
 * behaviour is unit-tested with fakes. No audio or transcript is logged or persisted here.
 */

/** Longest dictation. Long enough for a sentence or two; short enough to stay inside the proxy body limit. */
export const RECORDING_MAX_MS = 60_000;
/** Raw recording cap. base64 (x4/3) plus the JSON envelope stays under the 1 MiB gated proxy body limit. */
export const AUDIO_MAX_BYTES = 600_000;
/** Read-aloud input cap; keeps the synthesized reply well inside the same response budget. */
export const SPEAK_MAX_CHARS = 2000;
export const DRAFT_MAX_CHARS = 32768;

export type VoiceFailure =
  | 'permission-denied' | 'no-microphone' | 'microphone-busy' | 'unsupported'
  | 'unavailable' | 'too-large' | 'network' | 'rejected' | 'empty' | 'interrupted' | 'owner-changed' | 'failed';

/** Plain, non-technical copy. Upstream error text is never shown: it may name provider configuration. */
export const VOICE_COPY: Record<VoiceFailure, string> = {
  'permission-denied': 'Microphone access was blocked. Allow the microphone for this site in your browser settings, then try again.',
  'no-microphone': 'No microphone was found on this device. Nothing was recorded.',
  'microphone-busy': 'The microphone is in use by another app. Close it and try again.',
  unsupported: 'Recording is not supported in this browser. Type your message instead.',
  unavailable: 'Speech-to-text is not available on this Hermes host right now. Type your message instead.',
  'too-large': 'That recording is too long to send. Record a shorter message.',
  network: 'Could not reach Hermes to transcribe. The recording was discarded.',
  rejected: 'Hermes could not transcribe that recording. Nothing was inserted.',
  empty: 'No speech was recognised. Nothing was inserted.',
  interrupted: 'Recording stopped because this page was hidden. Nothing was sent.',
  'owner-changed': 'The conversation changed, so the transcript was discarded. Nothing was inserted.',
  failed: 'Dictation did not complete. Nothing was inserted.',
};

/** Thrown by the transcription port so the machine keeps the classification without string matching. */
export class VoiceError extends Error {
  constructor(readonly failure: VoiceFailure) { super(VOICE_COPY[failure]); this.name = 'VoiceError'; }
}

/** getUserMedia rejections. Names are the standard DOMException names. */
export function classifyMicError(error: unknown): VoiceFailure {
  const name = typeof error === 'object' && error !== null && 'name' in error ? String((error as { name: unknown }).name) : '';
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') return 'permission-denied';
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') return 'no-microphone';
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') return 'microphone-busy';
  return 'failed';
}

/** Transcription and speech failures. Hermes returns 503/404 when no provider is configured; never show its text. */
export function classifyVoiceHttp(status: number | undefined, networkKind?: 'network' | 'timeout' | 'disconnected'): VoiceFailure {
  if (networkKind) return networkKind === 'disconnected' ? 'failed' : 'network';
  if (status === 413) return 'too-large';
  if (status === 404 || status === 501 || status === 503 || (status !== undefined && status >= 500)) return 'unavailable';
  if (status === 400) return 'rejected';
  return 'failed';
}

export interface RecordingMime { recorderType: string; payloadType: string }

/** Feature-detects a recorder MIME. Safari records audio/mp4; Chromium and Firefox record webm/opus. */
export function recordingMime(isTypeSupported: (type: string) => boolean): RecordingMime | undefined {
  const candidates: RecordingMime[] = [
    { recorderType: 'audio/webm;codecs=opus', payloadType: 'audio/webm' },
    { recorderType: 'audio/webm', payloadType: 'audio/webm' },
    { recorderType: 'audio/mp4', payloadType: 'audio/mp4' },
  ];
  return candidates.find(candidate => isTypeSupported(candidate.recorderType));
}

/** m:ss for the elapsed recording time. */
export function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** Appends a transcript to the draft with one separating space. The result never exceeds the composer cap. */
export function insertTranscript(draft: string, transcript: string): { text: string; truncated: boolean } {
  const clean = transcript.trim();
  if (!clean) return { text: draft, truncated: false };
  const joiner = draft && !/\s$/.test(draft) ? ' ' : '';
  const combined = `${draft}${joiner}${clean}`;
  if (combined.length <= DRAFT_MAX_CHARS) return { text: combined, truncated: false };
  return { text: combined.slice(0, DRAFT_MAX_CHARS), truncated: true };
}

/** Decodes a data: URL returned by the speak route into a Blob. Rejects anything that is not base64 audio. */
export function dataUrlToBlob(dataUrl: string, mimeType: string): Blob {
  const match = /^data:(audio\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/i.exec(dataUrl);
  if (!match) throw new VoiceError('failed');
  const binary = atob(match[2]!);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType || match[1]! });
}

// ─── Dictation ───────────────────────────────────────────────────────────────────────────────

export type DictationState =
  | { phase: 'idle' }
  | { phase: 'requesting' }
  | { phase: 'recording'; elapsedMs: number }
  | { phase: 'transcribing' }
  | { phase: 'error'; failure: VoiceFailure };

export interface RecorderLike {
  state: string;
  start(): void;
  stop(): void;
  ondataavailable: ((event: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
  onerror: ((event: unknown) => void) | null;
}
export interface StreamLike { getTracks(): { stop(): void }[] }

export interface DictationPorts<C> {
  /** Undefined where the browser cannot record audio; start() then refuses with 'unsupported'. */
  mime: RecordingMime | undefined;
  requestStream(): Promise<StreamLike>;
  createRecorder(stream: StreamLike, recorderType: string): RecorderLike;
  /** Throws VoiceError on failure. The signal is aborted when the recording is cancelled or the page hides. */
  transcribe(audio: Blob, payloadType: string, signal: AbortSignal, context: C): Promise<string>;
  /** True only while the conversation that started the recording is still the selected one. */
  isCurrent(context: C): boolean;
  insert(transcript: string, context: C): void;
  now(): number;
  schedule(callback: () => void, ms: number): () => void;
  onChange(): void;
  maxMs?: number;
  maxBytes?: number;
}

interface Run<C> {
  id: number;
  context: C;
  stream?: StreamLike;
  recorder?: RecorderLike;
  chunks: Blob[];
  startedAt: number;
  cancelTimers: Array<() => void>;
  controller: AbortController;
}

/** One dictation at a time. Explicit start, stop and cancel; never sends; never keeps audio after the request. */
export class DictationMachine<C> {
  state: DictationState = { phase: 'idle' };
  private run?: Run<C>;
  private seq = 0;
  constructor(private readonly ports: DictationPorts<C>) {}

  get busy(): boolean { return this.state.phase !== 'idle' && this.state.phase !== 'error'; }

  start(context: C): void {
    if (this.busy) return;
    // Refuse before any permission prompt: without a supported MIME there is nothing to record.
    if (!this.ports.mime) { this.set({ phase: 'error', failure: 'unsupported' }); return; }
    const id = ++this.seq;
    const run: Run<C> = { id, context, chunks: [], startedAt: 0, cancelTimers: [], controller: new AbortController() };
    this.run = run;
    this.set({ phase: 'requesting' });
    this.ports.requestStream().then(stream => {
      if (this.run !== run) { release(stream); return; }
      run.stream = stream;
      let recorder: RecorderLike;
      try { recorder = this.ports.createRecorder(stream, this.ports.mime?.recorderType ?? ''); }
      catch { this.fail(run, 'unsupported'); return; }
      run.recorder = recorder;
      recorder.ondataavailable = event => { if (event.data.size) run.chunks.push(event.data); };
      recorder.onstop = () => { void this.finish(run); };
      recorder.onerror = () => this.fail(run, 'failed');
      recorder.start();
      run.startedAt = this.ports.now();
      this.set({ phase: 'recording', elapsedMs: 0 });
      run.cancelTimers.push(this.ports.schedule(() => this.stop(), this.ports.maxMs ?? RECORDING_MAX_MS));
      this.tick(run);
    }, error => this.fail(run, error instanceof VoiceError ? error.failure : classifyMicError(error)));
  }

  /** Ends the recording and transcribes it. The transcript is inserted only if the context is still current. */
  stop(): void {
    const run = this.run;
    if (!run || this.state.phase !== 'recording' || !run.recorder) return;
    this.clearTimers(run);
    this.set({ phase: 'transcribing' });
    try { run.recorder.stop(); }
    catch { this.fail(run, 'failed'); }
  }

  /** Drops the recording or transcription without sending. A reason leaves visible copy explaining why. */
  cancel(reason?: VoiceFailure): void {
    const run = this.run;
    // Nothing in progress (idle, or an earlier message still showing): there is no take to stop, so say nothing.
    if (!run) return;
    this.run = undefined;
    this.clearTimers(run);
    run.controller.abort();
    if (run.recorder) { run.recorder.onstop = null; run.recorder.ondataavailable = null; run.recorder.onerror = null; try { if (run.recorder.state !== 'inactive') run.recorder.stop(); } catch { /* already stopped */ } }
    if (run.stream) release(run.stream);
    run.chunks = [];
    this.set(reason ? { phase: 'error', failure: reason } : { phase: 'idle' });
  }

  dismiss(): void { if (this.state.phase === 'error') this.set({ phase: 'idle' }); }

  private tick(run: Run<C>): void {
    if (this.run !== run || this.state.phase !== 'recording') return;
    this.set({ phase: 'recording', elapsedMs: this.ports.now() - run.startedAt });
    run.cancelTimers.push(this.ports.schedule(() => this.tick(run), 500));
  }

  private async finish(run: Run<C>): Promise<void> {
    if (this.run !== run) return;
    if (run.stream) release(run.stream);
    const blob = new Blob(run.chunks, { type: this.ports.mime?.payloadType ?? 'audio/webm' });
    run.chunks = [];
    if (!blob.size) { this.fail(run, 'empty'); return; }
    if (blob.size > (this.ports.maxBytes ?? AUDIO_MAX_BYTES)) { this.fail(run, 'too-large'); return; }
    try {
      const transcript = await this.ports.transcribe(blob, this.ports.mime?.payloadType ?? 'audio/webm', run.controller.signal, run.context);
      if (this.run !== run) return;
      this.run = undefined;
      if (!this.ports.isCurrent(run.context)) { this.set({ phase: 'error', failure: 'owner-changed' }); return; }
      if (!transcript.trim()) { this.set({ phase: 'error', failure: 'empty' }); return; }
      this.ports.insert(transcript, run.context);
      this.set({ phase: 'idle' });
    } catch (error) {
      if (this.run !== run) return;
      this.run = undefined;
      this.set({ phase: 'error', failure: error instanceof VoiceError ? error.failure : 'failed' });
    }
  }

  private fail(run: Run<C>, failure: VoiceFailure): void {
    if (this.run !== run) return;
    this.run = undefined;
    this.clearTimers(run);
    run.controller.abort();
    if (run.stream) release(run.stream);
    run.chunks = [];
    this.set({ phase: 'error', failure });
  }

  private clearTimers(run: Run<C>): void {
    for (const cancel of run.cancelTimers.splice(0)) cancel();
  }

  private set(state: DictationState): void {
    this.state = state;
    this.ports.onChange();
  }
}

function release(stream: StreamLike): void {
  for (const track of stream.getTracks()) track.stop();
}

// ─── Read aloud ───────────────────────────────────────────────────────────────────────────────

export interface PlaybackAudio {
  play(): Promise<void>;
  pause(): void;
  onended: (() => void) | null;
  onerror: (() => void) | null;
}

export type SpeechState =
  | { phase: 'idle' }
  | { phase: 'loading'; key: string }
  | { phase: 'playing'; key: string }
  | { phase: 'error'; key: string; message: string };

export interface SpeechPorts {
  fetchSpeech(text: string, signal: AbortSignal): Promise<Blob>;
  createAudio(url: string): PlaybackAudio;
  createUrl(blob: Blob): string;
  revoke(url: string): void;
  onChange(): void;
}

export const SPEECH_COPY = {
  unavailable: 'Read aloud is not available on this Hermes host right now.',
  blocked: 'The browser blocked playback. Tap Read aloud again.',
  failed: 'That reply could not be read aloud.',
} as const;

/** One playback at a time. Starting another stops the first; stop() releases the audio object URL. */
export class SpeechPlayback {
  state: SpeechState = { phase: 'idle' };
  private controller?: AbortController;
  private audio?: PlaybackAudio;
  private url?: string;
  constructor(private readonly ports: SpeechPorts) {}

  play(key: string, text: string): void {
    if (this.state.phase !== 'idle' && this.state.key === key && this.state.phase !== 'error') { this.stop(); return; }
    this.stop();
    if (!text.trim() || text.length > SPEAK_MAX_CHARS) { this.set({ phase: 'error', key, message: SPEECH_COPY.failed }); return; }
    const controller = new AbortController();
    this.controller = controller;
    this.set({ phase: 'loading', key });
    this.ports.fetchSpeech(text, controller.signal).then(blob => {
      if (this.controller !== controller) return;
      const url = this.ports.createUrl(blob);
      const audio = this.ports.createAudio(url);
      this.url = url; this.audio = audio;
      audio.onended = () => this.stop();
      audio.onerror = () => { if (this.controller === controller) this.fail(key, SPEECH_COPY.failed); };
      return audio.play().then(() => {
        if (this.controller === controller) this.set({ phase: 'playing', key });
      }, () => { if (this.controller === controller) this.fail(key, SPEECH_COPY.blocked); });
    }, () => { if (this.controller === controller) this.fail(key, SPEECH_COPY.unavailable); });
  }

  stop(): void {
    const had = this.state.phase !== 'idle';
    this.controller?.abort(); this.controller = undefined;
    this.audio?.pause(); this.audio = undefined;
    if (this.url) { this.ports.revoke(this.url); this.url = undefined; }
    if (had) this.set({ phase: 'idle' });
  }

  private fail(key: string, message: string): void {
    this.controller = undefined; this.audio = undefined;
    if (this.url) { this.ports.revoke(this.url); this.url = undefined; }
    this.set({ phase: 'error', key, message });
  }

  private set(state: SpeechState): void {
    this.state = state;
    this.ports.onChange();
  }
}

/**
 * How the composer's view scope (`<account generation>|<conversation key>`) moved. A new conversation receiving
 * its stored id (`n|` -> `n|ref`) is the same composer and draft, so a dictation take is adopted, not dropped.
 * Any other change (another conversation, another account) is a switch.
 */
export type ScopeTransition = 'same' | 'initial' | 'adopt' | 'switch';
export function scopeTransition(previous: string | undefined, next: string): ScopeTransition {
  if (previous === undefined) return 'initial';
  if (previous === next) return 'same';
  return previous.endsWith('|') && next.startsWith(previous) && next.length > previous.length ? 'adopt' : 'switch';
}

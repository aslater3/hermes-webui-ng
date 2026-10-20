import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AUDIO_MAX_BYTES, type DictationState, DictationMachine, RECORDING_MAX_MS, SpeechPlayback, VOICE_COPY, VoiceError, classifyMicError, classifyVoiceHttp,
  dataUrlToBlob, formatElapsed, insertTranscript, recordingMime, type DictationPorts, type PlaybackAudio, type RecorderLike, type StreamLike, type VoiceFailure,
} from '../../src/hermes/voice.js';

const MIME = { recorderType: 'audio/webm;codecs=opus', payloadType: 'audio/webm' };
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

class FakeRecorder implements RecorderLike {
  state = 'inactive';
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  stops = 0;
  start() { this.state = 'recording'; }
  stop() { this.stops += 1; this.state = 'inactive'; this.ondataavailable?.({ data: new Blob([new Uint8Array(8)], { type: MIME.payloadType }) }); this.onstop?.(); }
}
function harness(over: Partial<DictationPorts<{ key: string }>> & { stream?: 'ok' | Error; transcript?: string | Error; current?: () => boolean } = {}) {
  let clock = 0;
  const timers: { due: number; callback: () => void; cancelled: boolean }[] = [];
  const tracks = { stopped: 0 };
  const stream: StreamLike = { getTracks: () => [{ stop: () => { tracks.stopped += 1; } }] };
  const recorder = new FakeRecorder();
  const inserted: string[] = [];
  let changes = 0;
  let transcribeCalls = 0;
  let lastSignal: AbortSignal | undefined;
  const ports: DictationPorts<{ key: string }> = {
    mime: 'mime' in over ? over.mime : MIME,
    requestStream: async () => {
      if (over.stream instanceof Error) throw over.stream;
      return stream;
    },
    createRecorder: () => recorder,
    transcribe: async (_audio, _type, signal) => {
      transcribeCalls += 1; lastSignal = signal;
      if (over.transcript instanceof Error) throw over.transcript;
      return over.transcript ?? 'hello from the mic';
    },
    isCurrent: over.current ?? (() => true),
    insert: text => { inserted.push(text); },
    now: () => clock,
    schedule: (callback, ms) => {
      const timer = { due: clock + ms, callback, cancelled: false };
      timers.push(timer);
      return () => { timer.cancelled = true; };
    },
    onChange: () => { changes += 1; },
    maxMs: over.maxMs, maxBytes: over.maxBytes,
  };
  const machine = new DictationMachine<{ key: string }>(ports);
  return {
    machine, recorder, inserted, tracks, timers,
    advance(ms: number) {
      clock += ms;
      for (const timer of timers.splice(0)) if (!timer.cancelled && timer.due <= clock) timer.callback(); else if (!timer.cancelled) timers.push(timer);
    },
    transcribeCalls: () => transcribeCalls, lastSignal: () => lastSignal, changes: () => changes,
  };
}

test('mic failures map to plain categories', () => {
  assert.equal(classifyMicError({ name: 'NotAllowedError' }), 'permission-denied');
  assert.equal(classifyMicError({ name: 'SecurityError' }), 'permission-denied');
  assert.equal(classifyMicError({ name: 'NotFoundError' }), 'no-microphone');
  assert.equal(classifyMicError({ name: 'NotReadableError' }), 'microphone-busy');
  assert.equal(classifyMicError(new Error('weird')), 'failed');
  assert.equal(classifyMicError(undefined), 'failed');
});

test('HTTP and network failures never expose upstream text and map provider absence to unavailable', () => {
  assert.equal(classifyVoiceHttp(503), 'unavailable');
  assert.equal(classifyVoiceHttp(404), 'unavailable');
  assert.equal(classifyVoiceHttp(500), 'unavailable');
  assert.equal(classifyVoiceHttp(413), 'too-large');
  assert.equal(classifyVoiceHttp(400), 'rejected');
  assert.equal(classifyVoiceHttp(undefined, 'network'), 'network');
  assert.equal(classifyVoiceHttp(undefined, 'timeout'), 'network');
  assert.equal(classifyVoiceHttp(undefined, 'disconnected'), 'failed');
  for (const copy of Object.values(VOICE_COPY)) assert.doesNotMatch(copy, /provider|api key|traceback|config\.yaml/i);
});

test('recorder MIME is feature-detected: webm/opus first, then webm, then Safari mp4', () => {
  assert.deepEqual(recordingMime(() => true), MIME);
  assert.deepEqual(recordingMime(type => type === 'audio/webm'), { recorderType: 'audio/webm', payloadType: 'audio/webm' });
  assert.deepEqual(recordingMime(type => type === 'audio/mp4'), { recorderType: 'audio/mp4', payloadType: 'audio/mp4' });
  assert.equal(recordingMime(() => false), undefined);
});

test('elapsed time and transcript insertion are bounded and never auto-send', () => {
  assert.equal(formatElapsed(0), '0:00');
  assert.equal(formatElapsed(65_900), '1:05');
  assert.equal(formatElapsed(RECORDING_MAX_MS), '1:00');
  assert.deepEqual(insertTranscript('', ' hi there '), { text: 'hi there', truncated: false });
  assert.deepEqual(insertTranscript('Draft', 'more'), { text: 'Draft more', truncated: false });
  assert.deepEqual(insertTranscript('Draft ', 'more'), { text: 'Draft more', truncated: false });
  assert.deepEqual(insertTranscript('Draft', '   '), { text: 'Draft', truncated: false });
  const long = insertTranscript('x'.repeat(32760), 'abcdefghijklmnop');
  assert.equal(long.text.length, 32768); assert.equal(long.truncated, true);
});

test('data URLs decode only to base64 audio', () => {
  const blob = dataUrlToBlob('data:audio/mpeg;base64,AAEC', 'audio/mpeg');
  assert.equal(blob.type, 'audio/mpeg'); assert.equal(blob.size, 3);
  assert.throws(() => dataUrlToBlob('data:text/html;base64,AAEC', 'audio/mpeg'), VoiceError);
  assert.throws(() => dataUrlToBlob('https://example.test/a.mp3', 'audio/mpeg'), VoiceError);
});

test('happy path: start, recording with elapsed time, stop, transcribe, insert once, no send', async () => {
  const h = harness();
  h.machine.start({ key: 'a' });
  assert.equal((h.machine.state as DictationState).phase, 'requesting');
  await flush();
  assert.equal((h.machine.state as DictationState).phase, 'recording');
  h.advance(2500);
  assert.deepEqual(h.machine.state, { phase: 'recording', elapsedMs: 2500 });
  h.machine.stop();
  assert.equal((h.machine.state as DictationState).phase, 'transcribing');
  await flush(); await flush();
  assert.equal((h.machine.state as DictationState).phase, 'idle');
  assert.deepEqual(h.inserted, ['hello from the mic']);
  assert.equal(h.transcribeCalls(), 1);
  assert.equal(h.tracks.stopped, 1, 'microphone tracks are released');
});

test('cancel discards the take without transcribing or inserting', async () => {
  const h = harness();
  h.machine.start({ key: 'a' }); await flush();
  h.machine.cancel();
  assert.equal((h.machine.state as DictationState).phase, 'idle');
  assert.equal(h.tracks.stopped, 1);
  await flush();
  assert.equal(h.transcribeCalls(), 0);
  assert.deepEqual(h.inserted, []);
});

test('the take stops automatically at the cap', async () => {
  const h = harness();
  h.machine.start({ key: 'a' }); await flush();
  h.advance(RECORDING_MAX_MS - 1);
  assert.equal((h.machine.state as DictationState).phase, 'recording');
  h.advance(2);
  assert.equal((h.machine.state as DictationState).phase, 'transcribing');
  await flush(); await flush();
  assert.equal(h.transcribeCalls(), 1);
});

test('permission denied, no microphone and busy microphone each show their own failure and hold no stream', async () => {
  const cases: [Error, VoiceFailure][] = [
    [Object.assign(new Error('x'), { name: 'NotAllowedError' }), 'permission-denied'],
    [Object.assign(new Error('x'), { name: 'NotFoundError' }), 'no-microphone'],
    [Object.assign(new Error('x'), { name: 'NotReadableError' }), 'microphone-busy'],
  ];
  for (const [error, failure] of cases) {
    const h = harness({ stream: error });
    h.machine.start({ key: 'a' }); await flush();
    assert.deepEqual(h.machine.state, { phase: 'error', failure });
    assert.equal(h.transcribeCalls(), 0);
  }
});

test('a browser without MediaRecorder support refuses before any permission prompt', async () => {
  const h = harness({ mime: undefined });
  h.machine.start({ key: 'a' }); await flush();
  assert.deepEqual(h.machine.state, { phase: 'error', failure: 'unsupported' });
});

test('upstream unavailable and rejected transcription keep the draft untouched', async () => {
  const unavailable = harness({ transcript: new VoiceError('unavailable') });
  unavailable.machine.start({ key: 'a' }); await flush(); unavailable.machine.stop(); await flush(); await flush();
  assert.deepEqual(unavailable.machine.state, { phase: 'error', failure: 'unavailable' });
  assert.deepEqual(unavailable.inserted, []);
  const rejected = harness({ transcript: new VoiceError('rejected') });
  rejected.machine.start({ key: 'a' }); await flush(); rejected.machine.stop(); await flush(); await flush();
  assert.deepEqual(rejected.machine.state, { phase: 'error', failure: 'rejected' });
});

test('an empty transcript and an empty recording insert nothing', async () => {
  const silent = harness({ transcript: '   ' });
  silent.machine.start({ key: 'a' }); await flush(); silent.machine.stop(); await flush(); await flush();
  assert.deepEqual(silent.machine.state, { phase: 'error', failure: 'empty' });
  assert.deepEqual(silent.inserted, []);
});

test('a transcript that arrives for another conversation is discarded, not inserted', async () => {
  let selected = 'a';
  const h = harness({ current: () => selected === 'a' });
  h.machine.start({ key: 'a' }); await flush(); h.machine.stop(); selected = 'b'; await flush(); await flush();
  assert.deepEqual(h.machine.state, { phase: 'error', failure: 'owner-changed' });
  assert.deepEqual(h.inserted, []);
});

test('an oversized recording is refused before upload', async () => {
  const h = harness({ maxBytes: 4 });
  h.machine.start({ key: 'a' }); await flush(); h.machine.stop(); await flush(); await flush();
  assert.deepEqual(h.machine.state, { phase: 'error', failure: 'too-large' });
  assert.equal(h.transcribeCalls(), 0);
  assert.ok(AUDIO_MAX_BYTES < 1_048_576 * 3 / 4, 'raw cap keeps base64 plus envelope under the gated proxy body limit');
});

test('a hidden page cancels the take with visible copy and aborts any upload', async () => {
  const h = harness({ transcript: new Promise(() => undefined) as unknown as string });
  h.machine.start({ key: 'a' }); await flush(); h.machine.stop(); await flush();
  const signal = h.lastSignal();
  h.machine.cancel('interrupted');
  assert.deepEqual(h.machine.state, { phase: 'error', failure: 'interrupted' });
  assert.equal(signal?.aborted, true);
  h.machine.dismiss();
  assert.equal((h.machine.state as DictationState).phase, 'idle');
});

test('a recorder error fails the take and releases the microphone', async () => {
  const h = harness();
  h.machine.start({ key: 'a' }); await flush();
  h.recorder.onerror?.({});
  assert.deepEqual(h.machine.state, { phase: 'error', failure: 'failed' });
  assert.equal(h.tracks.stopped, 1);
});

test('a second start while busy is ignored', async () => {
  const h = harness();
  h.machine.start({ key: 'a' }); h.machine.start({ key: 'a' });
  await flush();
  assert.equal((h.machine.state as DictationState).phase, 'recording');
});

test('a stream that resolves after cancel is released, not used', async () => {
  let release!: (stream: StreamLike) => void;
  const tracks = { stopped: 0 };
  const late = new Promise<StreamLike>(resolve => { release = resolve; });
  const machine = new DictationMachine<{ key: string }>({
    mime: MIME, requestStream: () => late, createRecorder: () => new FakeRecorder(), transcribe: async () => 'x',
    isCurrent: () => true, insert: () => undefined, now: () => 0, schedule: () => () => undefined, onChange: () => undefined,
  });
  machine.start({ key: 'a' });
  machine.cancel();
  release({ getTracks: () => [{ stop: () => { tracks.stopped += 1; } }] });
  await flush();
  assert.equal((machine.state as DictationState).phase, 'idle');
  assert.equal(tracks.stopped, 1);
});

// ─── read aloud ───────────────────────────────────────────────────────────────────────────────

function speech(options: { fetch?: 'ok' | Error; play?: 'ok' | Error } = {}) {
  const urls: string[] = [], revoked: string[] = [], audios: { url: string; paused: boolean; onended: (() => void) | null; onerror: (() => void) | null; plays: number }[] = [];
  let fetches = 0;
  const player = new SpeechPlayback({
    fetchSpeech: async (_text, signal) => {
      fetches += 1;
      if (options.fetch instanceof Error) throw options.fetch;
      void signal;
      return new Blob([new Uint8Array(4)], { type: 'audio/mpeg' });
    },
    createUrl: () => { const url = `blob:fake-${urls.length + 1}`; urls.push(url); return url; },
    createAudio: url => {
      const audio = { url, paused: false, onended: null as (() => void) | null, onerror: null as (() => void) | null, plays: 0,
        play: async () => { audio.plays += 1; if (options.play instanceof Error) throw options.play; },
        pause: () => { audio.paused = true; } };
      audios.push(audio);
      return audio as PlaybackAudio & typeof audio;
    },
    revoke: url => { revoked.push(url); },
    onChange: () => undefined,
  });
  return { player, urls, revoked, audios, fetches: () => fetches };
}

test('read aloud: loading, then playing one element; ended releases the object URL', async () => {
  const s = speech();
  s.player.play('m1', 'Hello there');
  assert.deepEqual(s.player.state, { phase: 'loading', key: 'm1' });
  await flush(); await flush();
  assert.deepEqual(s.player.state, { phase: 'playing', key: 'm1' });
  assert.equal(s.audios.length, 1);
  s.audios[0]!.onended?.();
  assert.equal(s.player.state.phase, 'idle');
  assert.deepEqual(s.revoked, ['blob:fake-1']);
  assert.equal(s.audios[0]!.paused, true);
});

test('read aloud: one playback at a time, and the same control toggles it off', async () => {
  const s = speech();
  s.player.play('m1', 'One'); await flush(); await flush();
  s.player.play('m2', 'Two'); await flush(); await flush();
  assert.equal(s.player.state.phase, 'playing');
  assert.equal(s.player.state.phase === 'playing' && s.player.state.key, 'm2');
  assert.equal(s.audios[0]!.paused, true, 'the first message stops before the second starts');
  assert.deepEqual(s.revoked, ['blob:fake-1']);
  s.player.play('m2', 'Two');
  assert.equal(s.player.state.phase, 'idle');
  assert.deepEqual(s.revoked, ['blob:fake-1', 'blob:fake-2']);
});

test('read aloud: stop during loading aborts the fetch result and nothing plays', async () => {
  const s = speech();
  s.player.play('m1', 'Hello'); s.player.stop();
  await flush(); await flush();
  assert.equal(s.player.state.phase, 'idle');
  assert.equal(s.audios.length, 0);
});

test('read aloud: unavailable provider, blocked autoplay and over-long text each give plain copy', async () => {
  const unavailable = speech({ fetch: new VoiceError('unavailable') });
  unavailable.player.play('m1', 'Hello'); await flush(); await flush();
  assert.equal(unavailable.player.state.phase, 'error');
  assert.match(unavailable.player.state.phase === 'error' ? unavailable.player.state.message : '', /not available on this Hermes host/);
  const blocked = speech({ play: new Error('NotAllowedError') });
  blocked.player.play('m1', 'Hello'); await flush(); await flush();
  assert.match(blocked.player.state.phase === 'error' ? blocked.player.state.message : '', /blocked playback/);
  assert.deepEqual(blocked.revoked, ['blob:fake-1'], 'a blocked start releases its object URL');
  const long = speech();
  long.player.play('m1', 'x'.repeat(2001));
  assert.equal(long.player.state.phase, 'error');
  assert.equal(long.fetches(), 0);
});

test('read aloud: a stale fetch cannot start after its playback was replaced', async () => {
  const s = speech();
  s.player.play('m1', 'Hello');
  s.player.play('m2', 'Other');
  await flush(); await flush();
  assert.equal(s.player.state.phase === 'playing' && s.player.state.key, 'm2');
  assert.equal(s.audios.length, 1);
});

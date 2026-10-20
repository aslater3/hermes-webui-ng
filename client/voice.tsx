import { createContext } from 'react';
import { LoaderCircle, Mic, Square, Volume2, VolumeX, X } from 'lucide-react';
import type { AppRuntime } from './runtime.js';
import { VOICE_COPY, formatElapsed, RECORDING_MAX_MS } from '../src/hermes/voice.js';
import { Notice } from './primitives.js';
import './voice.css';

/** Read-aloud state shared with every assistant message in the open conversation. */
export interface SpeechControls {
  enabled: boolean;
  state: AppRuntime['speech']['state'];
  play(key: string, text: string): void;
  stop(): void;
}
export const SpeechContext = createContext<SpeechControls>({ enabled: false, state: { phase: 'idle' }, play: () => undefined, stop: () => undefined });

export const VOICE_TRUSTED_LOCAL_COPY = 'Voice is available when signed in through the Hermes Dashboard.';
export const VOICE_UNSUPPORTED_COPY = 'Voice is not supported by this Hermes version.';

/** Mic toggle. Start asks for the microphone inside this click; stop ends the take and transcribes it. */
export function DictateButton({ runtime: rt, enabled }: { runtime: AppRuntime; enabled: boolean }) {
  const state = rt.dictation.state, recording = state.phase === 'recording';
  return <button type="button" className={`icon-button dictate-button${recording ? ' is-recording' : ''}`}
    aria-label={recording ? 'Stop recording' : 'Dictate a message'} title={recording ? 'Stop recording' : 'Dictate a message'}
    aria-pressed={recording} disabled={!recording && (!enabled || rt.dictation.busy)}
    onClick={() => { if (recording) rt.dictation.stop(); else rt.startDictation(); }}>
    {recording ? <Square size={16} fill="currentColor" aria-hidden="true" focusable="false"/> : <Mic size={18} aria-hidden="true" focusable="false"/>}
  </button>;
}

/** Visible recording state, elapsed time, cancel, and the outcome of a take. Never sends anything. */
export function DictationStatus({ runtime: rt }: { runtime: AppRuntime }) {
  const state = rt.dictation.state;
  if (state.phase === 'idle') return null;
  if (state.phase === 'recording') return <div className="dictation-status is-recording" role="status">
    <span className="rec-dot" aria-hidden="true"/>
    <span>Recording</span>
    <span className="dictation-elapsed" aria-label={`Elapsed ${formatElapsed(state.elapsedMs)} of ${formatElapsed(RECORDING_MAX_MS)}`}>{formatElapsed(state.elapsedMs)} / {formatElapsed(RECORDING_MAX_MS)}</span>
    <span className="dictation-actions">
      <button type="button" className="secondary" onClick={() => rt.dictation.cancel()}>Cancel</button>
      <button type="button" className="primary" onClick={() => rt.dictation.stop()}>Stop and transcribe</button>
    </span>
  </div>;
  if (state.phase === 'requesting') return <div className="dictation-status" role="status"><LoaderCircle size={15} className="spin" aria-hidden="true" focusable="false"/><span>Waiting for microphone permission…</span>
    <span className="dictation-actions"><button type="button" className="secondary" onClick={() => rt.dictation.cancel()}>Cancel</button></span></div>;
  if (state.phase === 'transcribing') return <div className="dictation-status" role="status"><LoaderCircle size={15} className="spin" aria-hidden="true" focusable="false"/><span>Transcribing. The text will appear in your draft to review. Nothing is sent.</span></div>;
  return <div className="dictation-status is-error"><Notice error>{VOICE_COPY[state.failure]}</Notice>
    <button type="button" className="secondary dictation-dismiss" aria-label="Dismiss voice message" onClick={() => rt.dictation.dismiss()}><X size={16} aria-hidden="true" focusable="false"/></button></div>;
}

/** Read aloud for one assistant message. The key is the message instance, so only one plays at a time. */
export function ReadAloudButton({ itemKey, text, controls }: { itemKey: string; text: string; controls: SpeechControls }) {
  const active = controls.state.phase !== 'idle' && 'key' in controls.state && controls.state.key === itemKey;
  const playing = active && controls.state.phase === 'playing';
  const loading = active && controls.state.phase === 'loading';
  const failure = active && controls.state.phase === 'error' ? controls.state.message : '';
  if (!controls.enabled) return null;
  return <>
    <button type="button" className={`speak-button${active ? ' is-active' : ''}`} aria-label={active && !failure ? 'Stop reading aloud' : 'Read aloud'}
      title={active && !failure ? 'Stop reading aloud' : 'Read aloud'} onClick={() => { if (active && !failure) controls.stop(); else controls.play(itemKey, text); }}>
      {active && !failure ? <VolumeX size={15} aria-hidden="true" focusable="false"/> : <Volume2 size={15} aria-hidden="true" focusable="false"/>}
      <span>{active && !failure ? 'Stop' : 'Read aloud'}</span>
    </button>
    <span className="speak-status" role="status">{loading ? 'Preparing audio…' : playing ? 'Reading aloud' : failure}</span>
  </>;
}

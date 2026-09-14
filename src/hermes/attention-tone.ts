type AudioCapableWindow = Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext };

/**
 * A short, non-verbal approval chime. Browsers require audio to be unlocked by a
 * user gesture, so the context is created/resumed only from pointer/keyboard input.
 * If a browser has not granted that capability yet, fail silently rather than
 * queueing a stale sound that could fire after the approval has already expired.
 */
export class ApprovalAttentionTone {
  private context?: AudioContext;
  private disposed = false;

  constructor(private readonly target: Window = window) {
    target.addEventListener('pointerdown', this.arm, { capture: true, passive: true });
    target.addEventListener('keydown', this.arm, { capture: true });
  }

  private readonly arm = (): void => {
    if (this.disposed) return;
    const audioWindow = this.target as AudioCapableWindow;
    const AudioCtor = audioWindow.AudioContext ?? audioWindow.webkitAudioContext;
    if (!AudioCtor) return;
    try {
      this.context ??= new AudioCtor();
      if (this.context.state !== 'running') void this.context.resume().catch(() => {});
    } catch {
      // Audio is an optional attention aid. Approval controls must remain usable.
    }
  };

  notify(): void {
    const context = this.context;
    if (this.disposed || !context || context.state !== 'running') return;
    try {
      const start = context.currentTime;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(880, start);
      oscillator.frequency.exponentialRampToValueAtTime(660, start + 0.12);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.075, start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.14);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.15);
    } catch {
      // Never turn an audio failure into a broken approval flow.
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.target.removeEventListener('pointerdown', this.arm, true);
    this.target.removeEventListener('keydown', this.arm, true);
    const context = this.context;
    this.context = undefined;
    if (context && context.state !== 'closed') void context.close().catch(() => {});
  }
}

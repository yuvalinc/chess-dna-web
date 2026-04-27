/**
 * Chess sound effects using Web Audio API.
 * Generates distinct tones for game events (no external files needed).
 *
 * All sounds can optionally be routed to a custom AudioNode destination
 * (e.g. a MediaStreamAudioDestinationNode) so they can be recorded into
 * the sequence-share video alongside the visual frames.
 */

let audioCtx: AudioContext | null = null;

function getCtx(): AudioContext {
  if (!audioCtx) audioCtx = new AudioContext();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

/** Expose the singleton AudioContext so callers can attach a recording destination. */
export function getChessAudioContext(): AudioContext {
  return getCtx();
}

export type SoundType =
  | 'move'
  | 'capture'
  | 'check'
  | 'castle'
  | 'checkmate'
  | 'correct'
  | 'incorrect'
  | 'complete';

/**
 * Schedule a single chess sound at an absolute audio-context time.
 * Works with any BaseAudioContext (including OfflineAudioContext), which is
 * how the shareable-video pipeline bakes sounds into an audio buffer.
 */
export function scheduleChessSound(
  ctx: BaseAudioContext,
  dest: AudioNode,
  type: SoundType,
  startTime: number,
): void {
  const tone = (freq: number, duration: number, wave: OscillatorType, gainVal: number, offset: number) => {
    const t0 = startTime + offset;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = wave;
    osc.frequency.setValueAtTime(freq, t0);
    gain.gain.setValueAtTime(gainVal, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
    osc.connect(gain);
    gain.connect(dest);
    osc.start(t0);
    osc.stop(t0 + duration);
  };
  switch (type) {
    // ── Objective per-move sounds. No judgmental "wrong move" tones. ──
    case 'move':
      // Crisp wood-tap click. Identical for good/bad moves.
      tone(420, 0.07, 'sine', 0.16, 0);
      break;
    case 'capture':
      // Slightly heavier two-tone thud — no negative connotation, just
      // signals "two pieces met".
      tone(320, 0.10, 'triangle', 0.22, 0);
      tone(220, 0.12, 'triangle', 0.16, 0.02);
      break;
    case 'castle':
      // Two soft notes that swap places (mirrors the king + rook swap).
      tone(420, 0.08, 'sine', 0.18, 0);
      tone(340, 0.10, 'sine', 0.18, 0.06);
      break;
    case 'check':
      // Bright two-note ascending alert — POSITIVE, not warning. C5 → G5.
      tone(523, 0.12, 'sine', 0.22, 0.00); // C5
      tone(784, 0.14, 'sine', 0.22, 0.10); // G5
      break;
    case 'checkmate':
      // Triumphant fanfare — clearly distinct from check. Major chord
      // arpeggio C5 → E5 → G5 → C6, all rising and bright.
      tone(523, 0.14, 'sine',     0.26, 0.00); // C5
      tone(659, 0.14, 'sine',     0.26, 0.10); // E5
      tone(784, 0.16, 'sine',     0.28, 0.20); // G5
      tone(1047, 0.32, 'triangle', 0.32, 0.32); // C6 — the "win" hit
      // Subtle major-third harmony underneath the final note for richness.
      tone(659, 0.32, 'sine',     0.18, 0.32); // E5 sustain
      break;
    case 'correct':
      tone(523, 0.12, 'sine', 0.2, 0.0);
      tone(659, 0.15, 'sine', 0.2, 0.1);
      break;
    case 'incorrect':
      tone(330, 0.18, 'triangle', 0.25, 0.00);
      tone(220, 0.30, 'triangle', 0.20, 0.15);
      break;
    case 'complete':
      tone(523, 0.12, 'sine', 0.22, 0.0);
      tone(659, 0.12, 'sine', 0.22, 0.1);
      tone(784, 0.25, 'sine', 0.25, 0.2);
      break;
  }
}

/**
 * Play a chess sound live. When `destination` is provided, audio is routed
 * there instead of the default speakers (used for MediaRecorder capture).
 */
export function playChessSound(type: SoundType, destination?: AudioNode): void {
  try {
    const ctx = getCtx();
    const dest = destination ?? ctx.destination;
    scheduleChessSound(ctx, dest, type, ctx.currentTime);
  } catch {
    // Silently fail if audio is not available
  }
}

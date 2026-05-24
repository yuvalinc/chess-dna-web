/**
 * Chess sound effects using Web Audio API.
 * Each sound is built from physical first principles for its event:
 *   move / move-opponent  — wood-on-wood impact (dense partials, sub-thump)
 *   capture               — wood impact + low-noise crunch tail
 *   castle                — two wood impacts in quick succession
 *   complete (game-end)   — three-note bell cadence with octave harmonics
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
  | 'move-opponent'
  | 'capture'
  | 'check'
  | 'castle'
  | 'checkmate'
  | 'correct'
  | 'incorrect'
  | 'complete';

/**
 * Wood-hit primitive — a chess piece arriving on a chess square.
 * Anatomy:
 *   1. 3ms shaped noise impulse (the impact). HP+LP filtered to keep the
 *      crack crisp but not brittle, and to suppress sub-rumble.
 *   2. 5 closely-spaced triangle partials at multiples of `fundamental`
 *      with small random detune. The closely-spaced cluster is what gives
 *      a "full wood" timbre instead of a hollow tone.
 *   3. Higher partials decay before lower ones — that's how real wood damps,
 *      and it's what stops the sound from ringing like a paddle.
 *   4. Short sub-bass thump for perceived weight.
 *
 * @param fundamental  pitch of the lowest body partial (Hz). Higher value = lighter piece.
 * @param gainVal      overall gain multiplier.
 * @param decayScale   scales all decays. <1 = tighter, >1 = lingering.
 */
function woodHit(
  ctx: BaseAudioContext,
  dest: AudioNode,
  startTime: number,
  fundamental: number,
  gainVal: number,
  decayScale: number = 1,
): void {
  const t0 = startTime;
  const sr = ctx.sampleRate;

  // 1) Shaped noise impulse
  const impLen = Math.max(1, Math.floor(0.003 * sr));
  const ib = ctx.createBuffer(1, impLen, sr);
  const id = ib.getChannelData(0);
  for (let i = 0; i < impLen; i++) {
    id[i] = (Math.random() * 2 - 1) * Math.exp(-i / (impLen * 0.25));
  }
  const noise = ctx.createBufferSource();
  noise.buffer = ib;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass'; hp.frequency.setValueAtTime(250, t0);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.setValueAtTime(4200, t0);
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(gainVal * 0.55, t0);
  noise.connect(hp); hp.connect(lp); lp.connect(ng); ng.connect(dest);
  noise.start(t0); noise.stop(t0 + 0.006);

  // 2) Dense partials body
  const partials = [
    { mult: 1.00, g: 0.32, decay: 0.085 },
    { mult: 1.39, g: 0.26, decay: 0.075 },
    { mult: 1.88, g: 0.22, decay: 0.060 },
    { mult: 2.61, g: 0.16, decay: 0.045 },
    { mult: 3.70, g: 0.10, decay: 0.030 },
  ];
  for (const p of partials) {
    const f = fundamental * p.mult;
    const dec = p.decay * decayScale;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(f, t0);
    o.frequency.exponentialRampToValueAtTime(f * 0.93, t0 + dec);
    o.detune.setValueAtTime((Math.random() - 0.5) * 12, t0);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(p.g * gainVal, t0 + 0.0015);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dec);
    o.connect(g); g.connect(dest);
    o.start(t0); o.stop(t0 + dec + 0.01);
  }

  // 3) Sub-bass thump — light, just enough for perceived weight without boom
  const sub = ctx.createOscillator();
  sub.type = 'sine';
  const subF = fundamental * 0.6;
  sub.frequency.setValueAtTime(subF, t0);
  sub.frequency.exponentialRampToValueAtTime(subF * 0.7, t0 + 0.04 * decayScale);
  const sg = ctx.createGain();
  sg.gain.setValueAtTime(0, t0);
  sg.gain.linearRampToValueAtTime(0.14 * gainVal, t0 + 0.003);
  sg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.045 * decayScale);
  sub.connect(sg); sg.connect(dest);
  sub.start(t0); sub.stop(t0 + 0.05 * decayScale);
}

/** Capture: piece-arriving wood-hit + a short low-noise crunch ~15ms later. */
function captureSound(ctx: BaseAudioContext, dest: AudioNode, startTime: number): void {
  // Stage 1: stronger click — the capturing piece arriving.
  woodHit(ctx, dest, startTime, 175, 1.15, 1.0);

  // Stage 2: low broadband noise (~70ms) at +18ms — the "crunch" of the
  // captured piece being displaced. LP at 700 Hz keeps it dark.
  const t0 = startTime + 0.018;
  const sr = ctx.sampleRate;
  const crunchDur = 0.07;
  const cLen = Math.max(1, Math.floor(crunchDur * sr));
  const cb = ctx.createBuffer(1, cLen, sr);
  const cd = cb.getChannelData(0);
  for (let i = 0; i < cLen; i++) {
    cd[i] = (Math.random() * 2 - 1) * Math.exp(-i / (cLen * 0.4));
  }
  const noise = ctx.createBufferSource();
  noise.buffer = cb;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.setValueAtTime(700, t0);
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass'; hp.frequency.setValueAtTime(120, t0);
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(0, t0);
  ng.gain.linearRampToValueAtTime(0.5, t0 + 0.002);
  ng.gain.exponentialRampToValueAtTime(0.0001, t0 + crunchDur);
  noise.connect(hp); hp.connect(lp); lp.connect(ng); ng.connect(dest);
  noise.start(t0); noise.stop(t0 + crunchDur);
}

/** Castle: two wood-hits ~90ms apart, second slightly lower (the rook). */
function castleSound(ctx: BaseAudioContext, dest: AudioNode, startTime: number): void {
  woodHit(ctx, dest, startTime, 170, 0.9, 1.0);
  woodHit(ctx, dest, startTime + 0.09, 145, 0.85, 1.0);
}

/**
 * Game-end cadence: three sine notes with octave harmonics. Pattern is
 * an ascending fifth + fourth (G4 → D5 → G5) — short, bell-like, conclusive.
 */
function gameEndSound(ctx: BaseAudioContext, dest: AudioNode, startTime: number): void {
  const notes: Array<{ f: number; t: number; dur: number; gain: number }> = [
    { f: 392.0, t: 0.00, dur: 0.18, gain: 0.30 }, // G4
    { f: 587.3, t: 0.13, dur: 0.20, gain: 0.32 }, // D5
    { f: 784.0, t: 0.27, dur: 0.34, gain: 0.36 }, // G5
  ];
  for (const n of notes) {
    const t0 = startTime + n.t;
    // Fundamental sine
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(n.f, t0);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(n.gain, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + n.dur);
    o.connect(g); g.connect(dest);
    o.start(t0); o.stop(t0 + n.dur + 0.02);
    // Octave harmonic for bell-like brightness
    const oh = ctx.createOscillator();
    oh.type = 'sine';
    oh.frequency.setValueAtTime(n.f * 2, t0);
    const gh = ctx.createGain();
    gh.gain.setValueAtTime(0, t0);
    gh.gain.linearRampToValueAtTime(n.gain * 0.18, t0 + 0.005);
    gh.gain.exponentialRampToValueAtTime(0.0001, t0 + n.dur * 0.7);
    oh.connect(gh); gh.connect(dest);
    oh.start(t0); oh.stop(t0 + n.dur * 0.7 + 0.02);
  }
}

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
    case 'move':
      // Move-self: bright wood click. Fundamental 165 Hz, default decay.
      woodHit(ctx, dest, startTime, 165, 1.0, 1.0);
      break;
    case 'move-opponent':
      // Move-opponent: same physics, ~20% lower + softer + slightly longer
      // decay. The listener can tell at a glance whose turn just ticked.
      woodHit(ctx, dest, startTime, 130, 0.85, 1.15);
      break;
    case 'capture':
      // Two-stage: piece-arriving click + low-noise crunch tail.
      captureSound(ctx, dest, startTime);
      break;
    case 'castle':
      // Two clicks back-to-back — king + rook arriving on different squares.
      castleSound(ctx, dest, startTime);
      break;
    case 'check':
      // Bright two-note ascending alert — POSITIVE, not warning. C5 → G5.
      tone(523, 0.12, 'sine', 0.22, 0.00);
      tone(784, 0.14, 'sine', 0.22, 0.10);
      break;
    case 'checkmate':
      // Triumphant fanfare. Major arpeggio C5 → E5 → G5 → C6 + E5 sustain.
      tone(523, 0.14, 'sine',     0.26, 0.00);
      tone(659, 0.14, 'sine',     0.26, 0.10);
      tone(784, 0.16, 'sine',     0.28, 0.20);
      tone(1047, 0.32, 'triangle', 0.32, 0.32);
      tone(659, 0.32, 'sine',     0.18, 0.32);
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
      // Game-end bell cadence — three ascending notes with octave harmonics.
      gameEndSound(ctx, dest, startTime);
      break;
  }
}

/**
 * Cooldown to prevent the same sound from layering on top of itself when
 * upstream effects race (e.g. a re-render that briefly nulls a ref guard,
 * StrictMode double-invocation, or two callers reacting to the same state
 * change). 50ms is below human click cadence but well above a duplicated
 * effect tick, so intentional rapid replays still pass through.
 * Only applies to the default destination — the recording path needs every
 * scheduled sound to land in the captured stream.
 */
const PLAYBACK_COOLDOWN_MS = 50;
let lastPlayAt = 0;
let lastPlayType: SoundType | null = null;

/**
 * Play a chess sound live. When `destination` is provided, audio is routed
 * there instead of the default speakers (used for MediaRecorder capture).
 */
export function playChessSound(type: SoundType, destination?: AudioNode): void {
  try {
    const ctx = getCtx();
    const dest = destination ?? ctx.destination;
    if (!destination) {
      const now = ctx.currentTime * 1000;
      if (lastPlayType === type && now - lastPlayAt < PLAYBACK_COOLDOWN_MS) return;
      lastPlayAt = now;
      lastPlayType = type;
    }
    scheduleChessSound(ctx, dest, type, ctx.currentTime);
  } catch {
    // Silently fail if audio is not available
  }
}

#!/usr/bin/env python3
"""Detect beat timestamps in a WAV file using stdlib only.

Approach:
  1. Read mono 16-bit WAV samples.
  2. Compute short-term energy in ~20ms windows.
  3. Smooth and take first-derivative (onset strength).
  4. Pick peaks: local maxima above a dynamic threshold with a minimum gap
     determined by the dominant BPM (estimated via autocorrelation).
  5. Print beat timestamps (seconds) one per line.
"""

import math
import struct
import sys
import wave


def read_wav_mono(path: str):
    with wave.open(path, "rb") as wf:
        assert wf.getsampwidth() == 2, "expected 16-bit PCM"
        assert wf.getnchannels() == 1, "expected mono"
        sr = wf.getframerate()
        n = wf.getnframes()
        raw = wf.readframes(n)
    samples = struct.unpack(f"<{n}h", raw)
    return samples, sr


def energy_envelope(samples, sr, win_ms=20):
    win = int(sr * win_ms / 1000)
    hop = win  # non-overlapping
    env = []
    for i in range(0, len(samples) - win, hop):
        # RMS energy
        s = 0
        for j in range(i, i + win):
            v = samples[j]
            s += v * v
        env.append(math.sqrt(s / win))
    return env, sr / hop  # env, env-rate (frames/sec)


def smooth(xs, w=3):
    out = []
    for i, x in enumerate(xs):
        lo = max(0, i - w)
        hi = min(len(xs), i + w + 1)
        out.append(sum(xs[lo:hi]) / (hi - lo))
    return out


def onset_strength(env):
    """First-order positive difference — emphasizes sudden energy rises."""
    out = [0.0]
    for i in range(1, len(env)):
        d = env[i] - env[i - 1]
        out.append(max(0.0, d))
    return out


def autocorr_bpm(onset, env_fps, bpm_range=(70, 160)):
    """Estimate dominant tempo by autocorrelating onset strength."""
    n = len(onset)
    mean = sum(onset) / n
    centered = [x - mean for x in onset]
    min_lag = int(env_fps * 60 / bpm_range[1])
    max_lag = int(env_fps * 60 / bpm_range[0])
    best_lag = min_lag
    best_score = -float("inf")
    for lag in range(min_lag, min(max_lag, n // 2)):
        s = 0.0
        for i in range(n - lag):
            s += centered[i] * centered[i + lag]
        if s > best_score:
            best_score = s
            best_lag = lag
    bpm = 60 * env_fps / best_lag
    return bpm, best_lag


def pick_beats(onset, env_fps, lag, threshold_pct=0.25):
    """Pick beats as peaks with ~lag spacing."""
    thr = sorted(onset)[int(len(onset) * (1 - threshold_pct))]
    # Find all local maxima above threshold
    peaks = []
    for i in range(2, len(onset) - 2):
        if onset[i] >= thr and onset[i] > onset[i - 1] and onset[i] > onset[i + 1]:
            peaks.append((i, onset[i]))
    if not peaks:
        return []
    # Greedy beat picking: align to a grid of period `lag`
    # Choose anchor = strongest peak, then beats at anchor ± k*lag, snapping
    # to actual peaks within ±lag/3.
    anchor_idx, _ = max(peaks, key=lambda p: p[1])
    grid = []
    # Walk backward and forward in steps of `lag`
    k = 0
    while True:
        t = anchor_idx - k * lag
        if t < 0:
            break
        grid.append(t)
        k += 1
    k = 1
    while True:
        t = anchor_idx + k * lag
        if t >= len(onset):
            break
        grid.append(t)
        k += 1
    grid.sort()
    # Snap each grid point to nearest peak within ±lag/3
    tol = max(1, lag // 3)
    snapped = []
    peak_idx_set = {p[0] for p in peaks}
    peak_list = sorted(peak_idx_set)
    p_i = 0
    for g in grid:
        # Advance p_i to nearest peak
        # Binary search would be nicer, but linear is fine here
        best = g
        best_d = tol + 1
        for p in peak_list:
            d = abs(p - g)
            if d <= tol and d < best_d:
                best = p
                best_d = d
            if p > g + tol:
                break
        snapped.append(best / env_fps)
    return snapped


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else "/tmp/hukum_bass.wav"
    samples, sr = read_wav_mono(path)
    env, env_fps = energy_envelope(samples, sr, win_ms=20)
    env = smooth(env, w=2)
    onset = onset_strength(env)
    onset = smooth(onset, w=1)
    bpm, lag = autocorr_bpm(onset, env_fps)
    beats = pick_beats(onset, env_fps, lag)
    print(f"# bpm={bpm:.1f}  lag={lag}  env_fps={env_fps:.1f}", file=sys.stderr)
    print(f"# beats={len(beats)}", file=sys.stderr)
    for b in beats:
        print(f"{b:.3f}")


if __name__ == "__main__":
    main()

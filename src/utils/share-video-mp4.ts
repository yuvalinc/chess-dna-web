/**
 * Instagram-compatible MP4 encoder.
 *
 * Uses WebCodecs (VideoEncoder + AudioEncoder) and mp4-muxer to produce a
 * proper fast-start H.264 + AAC MP4 — the format social apps actually accept.
 *
 * Why not MediaRecorder?
 *   MediaRecorder's MP4 output is fragmented (moov atom scattered), which
 *   Instagram / TikTok / WhatsApp refuse to decode. mp4-muxer writes the moov
 *   atom at the start of the file ("fast start"), matching what socials expect.
 *
 * Browser support: Chrome/Edge 94+, Safari 17+, Opera. Firefox lacks the full
 * WebCodecs stack. On unsupported browsers the caller should fall back to the
 * older MediaRecorder path in `share-video.ts`.
 */
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import { scheduleChessSound, type SoundType } from '@shared/utils/chess-sounds';

export interface Mp4Frame {
  /** Mutate DOM so `element` visually represents this frame. */
  render: () => Promise<void>;
  /** How long this frame is held in the recording, ms. */
  durationMs: number;
  /** Optional sound to play at the start of this frame. */
  soundType?: SoundType;
}

export interface Mp4CaptureOptions {
  width: number;
  height: number;
  fps?: number;              // default 30
  videoBitrate?: number;     // default 8_000_000
  withAudio?: boolean;       // default true
  /** Progress callback, 0..1. Fires after each frame is encoded. */
  onProgress?: (pct: number) => void;
  /** Optional callback fires once encoding is done with audio status. */
  onAudioStatus?: (status: { included: boolean; reason?: string }) => void;
}

export function isWebCodecsMp4Supported(): boolean {
  return (
    typeof VideoEncoder !== 'undefined' &&
    typeof VideoFrame !== 'undefined' &&
    typeof AudioEncoder !== 'undefined' &&
    typeof AudioData !== 'undefined' &&
    typeof OfflineAudioContext !== 'undefined'
  );
}

async function checkCodecSupport(codec: string): Promise<boolean> {
  try {
    const support = await VideoEncoder.isConfigSupported({ codec, width: 1080, height: 1920 });
    return !!support.supported;
  } catch {
    return false;
  }
}

/**
 * Capture an animated DOM sequence as an Instagram-compatible MP4 Blob.
 *
 * The caller drives playback via each frame's `render` callback; sounds are
 * baked in via an OfflineAudioContext and muxed as an AAC track.
 */
export async function captureSequenceAsMp4(
  element: HTMLElement,
  frames: Mp4Frame[],
  opts: Mp4CaptureOptions,
): Promise<Blob> {
  if (!isWebCodecsMp4Supported()) {
    throw new Error('WebCodecs MP4 encoding not supported in this browser');
  }
  if (frames.length === 0) throw new Error('No frames to capture');
  console.log('[Chess DNA] Encoding MP4 via WebCodecs', {
    frames: frames.length,
    withAudio: opts.withAudio !== false,
  });

  const html2canvas = (await import('html2canvas')).default;

  const { width, height } = opts;
  const fps = opts.fps ?? 30;
  const videoBitrate = opts.videoBitrate ?? 8_000_000;
  const withAudio = opts.withAudio !== false;
  const sampleRate = 48_000;
  const channels = 2;

  // Ensure even dimensions — H.264 requires them.
  const w = width % 2 === 0 ? width : width + 1;
  const h = height % 2 === 0 ? height : height + 1;

  // Total duration in microseconds.
  const totalDurationMs = frames.reduce((sum, f) => sum + f.durationMs, 0);
  const totalDurationSec = totalDurationMs / 1000;

  // ── 1. Bake audio track via OfflineAudioContext, but only if the
  //       browser can actually encode AAC. Falling through silently if not
  //       avoids creating an empty audio track that hangs finalize().
  let audioBuffer: AudioBuffer | null = null;
  let audioConfig: AudioEncoderConfig | null = null;
  // Try a few common AAC profiles — some Chromium builds want the explicit
  // codec tuple, others accept 'aac'. Pick the first supported.
  const audioCandidates: AudioEncoderConfig[] = [
    { codec: 'mp4a.40.2', sampleRate, numberOfChannels: channels, bitrate: 128_000 }, // AAC-LC
    { codec: 'mp4a.40.5', sampleRate, numberOfChannels: channels, bitrate: 128_000 }, // HE-AAC
    { codec: 'aac' as unknown as string, sampleRate, numberOfChannels: channels, bitrate: 128_000 },
  ];
  if (withAudio) {
    for (const cfg of audioCandidates) {
      try {
        const support = await AudioEncoder.isConfigSupported(cfg);
        if (support.supported) { audioConfig = cfg; break; }
      } catch { /* try next */ }
    }
    console.log('[Chess DNA] MP4 audio config:', audioConfig?.codec ?? 'NONE (silent MP4)');
  }
  if (audioConfig) {
    try {
      const totalSamples = Math.max(1, Math.ceil(sampleRate * totalDurationSec));
      const offlineCtx = new OfflineAudioContext(channels, totalSamples, sampleRate);
      let cursor = 0;
      for (const frame of frames) {
        if (frame.soundType) {
          scheduleChessSound(offlineCtx, offlineCtx.destination, frame.soundType, cursor);
        }
        cursor += frame.durationMs / 1000;
      }
      audioBuffer = await offlineCtx.startRendering();
    } catch (err) {
      console.warn('[Chess DNA] Offline audio render failed:', err);
      audioBuffer = null;
    }
  } else if (withAudio) {
    console.warn('[Chess DNA] AAC encoding not supported — producing silent MP4');
  }

  // ── 2. Pick an H.264 codec the browser actually supports ──
  // Main profile level 4.0 (1080p) — widely compatible. Fall back to
  // Baseline/Constrained Baseline if High isn't available.
  const codecCandidates = ['avc1.4d4028', 'avc1.42e028', 'avc1.640028', 'avc1.42001f'];
  let videoCodec = '';
  for (const c of codecCandidates) {
    if (await checkCodecSupport(c)) { videoCodec = c; break; }
  }
  if (!videoCodec) throw new Error('No H.264 encoder available');

  // ── 3a. Pre-encode audio INTO MEMORY before building the muxer.
  //       This is the critical fix: declaring an audio track in the muxer
  //       and then producing zero chunks results in a broken file that
  //       Instagram silently strips audio from. By collecting chunks first
  //       we know up front whether to declare an audio track at all.
  type AudioChunkEntry = { chunk: EncodedAudioChunk; meta?: EncodedAudioChunkMetadata };
  const collectedAudioChunks: AudioChunkEntry[] = [];
  let audioFailureReason = '';
  if (audioBuffer && audioConfig) {
    try {
      let audioError: Error | null = null;
      const audioEncoder = new AudioEncoder({
        output: (chunk, meta) => collectedAudioChunks.push({ chunk, meta }),
        error: (e) => { audioError = e as Error; },
      });
      audioEncoder.configure(audioConfig);

      const totalSamples = audioBuffer.length;
      const chans: Float32Array[] = [];
      for (let c = 0; c < channels; c++) chans.push(audioBuffer.getChannelData(c));

      const chunkSize = 1024;
      for (let offset = 0; offset < totalSamples; offset += chunkSize) {
        if (audioError) throw audioError;
        const len = Math.min(chunkSize, totalSamples - offset);
        const planar = new Float32Array(len * channels);
        for (let c = 0; c < channels; c++) {
          planar.set(chans[c].subarray(offset, offset + len), c * len);
        }
        const audioData = new AudioData({
          format: 'f32-planar',
          sampleRate,
          numberOfFrames: len,
          numberOfChannels: channels,
          timestamp: Math.round((offset / sampleRate) * 1_000_000),
          data: planar,
        });
        audioEncoder.encode(audioData);
        audioData.close();
      }
      await audioEncoder.flush();
      audioEncoder.close();
      if (audioError) throw audioError;
      if (collectedAudioChunks.length === 0) {
        audioFailureReason = 'encoder produced 0 chunks';
      }
    } catch (err) {
      audioFailureReason = (err as Error)?.message ?? 'unknown error';
      collectedAudioChunks.length = 0; // wipe partials
    }
  } else if (!audioConfig && audioBuffer) {
    audioFailureReason = 'AAC config not supported';
  }

  const willMuxAudio = collectedAudioChunks.length > 0;
  console.log('[Chess DNA] MP4 audio result:', willMuxAudio
    ? `${collectedAudioChunks.length} chunks queued (${audioConfig?.codec})`
    : `NO AUDIO — ${audioFailureReason || 'no buffer'}`);
  opts.onAudioStatus?.({ included: willMuxAudio, reason: willMuxAudio ? undefined : audioFailureReason });

  // ── 3b. Build the muxer. Audio track is declared ONLY if we actually
  //       have chunks to fill it — never an empty/broken track.
  const totalVideoFrames = frames.reduce(
    (sum, f) => sum + Math.max(1, Math.round((f.durationMs / 1000) * fps)),
    0,
  );
  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: {
      codec: 'avc',
      width: w,
      height: h,
      frameRate: fps,
    },
    audio: willMuxAudio ? {
      codec: 'aac',
      numberOfChannels: channels,
      sampleRate,
    } : undefined,
    fastStart: {
      expectedVideoChunks: Math.ceil(totalVideoFrames * 1.2),
      expectedAudioChunks: collectedAudioChunks.length + 4,
    },
  });

  // ── 4. Video encoder ──
  const videoChunks: Promise<void>[] = [];
  const videoEncoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => console.error('[VideoEncoder]', e),
  });
  videoEncoder.configure({
    codec: videoCodec,
    width: w,
    height: h,
    bitrate: videoBitrate,
    framerate: fps,
  });

  // ── 5. Render + encode video frames ──
  let timestampUs = 0;
  const frameDurationUs = Math.round(1_000_000 / fps);
  const keyframeEveryN = fps * 2; // keyframe every ~2s
  let emittedCount = 0;
  let frameIdx = 0;
  // Video is the slow part; audio render + finalize are fast now that
  // fastStart reserves metadata space. Give video 85%, audio 10%, final 5%.
  const videoWeight = audioBuffer ? 0.85 : 0.95;
  opts.onProgress?.(0);

  for (const frame of frames) {
    await frame.render();
    // Let React commit + Chessboard animate + browser paint before
    // snapshotting. react-chessboard's piece animation is ~200–260ms; if
    // we snapshot too early we catch pieces mid-slide (or wrong FEN),
    // which is why frames looked "missing" in the exported video.
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    await new Promise((r) => setTimeout(r, 320));

    const snapshot = await html2canvas(element, {
      scale: 1,
      width: w,
      height: h,
      useCORS: true,
      backgroundColor: null,
      logging: false,
      allowTaint: true,
      onclone: (doc) => {
        // Strip the preview-scale transform from the cloned DOM so the
        // output canvas is fully populated at 1080×1920.
        const node = doc.querySelector('[data-share-card]');
        if (node instanceof HTMLElement) {
          node.style.transform = 'none';
          node.style.transformOrigin = 'top left';
        }
      },
    });

    // Freeze pixel data as an ImageBitmap so duplicating the hold doesn't
    // leak references to a mutating canvas.
    const bitmap = await createImageBitmap(snapshot);

    // Diagnostic: check if html2canvas / iOS hardware encoder is silently
    // downscaling. If `bitmap` doesn't match the requested w×h, the iPhone
    // encoder is the source of the lower-res output.
    if (frameIdx === 0) {
      console.log('[Chess DNA] Capture sizes', {
        requested: `${w}x${h}`,
        snapshot: `${snapshot.width}x${snapshot.height}`,
        bitmap: `${bitmap.width}x${bitmap.height}`,
        codec: videoCodec,
        bitrate: videoBitrate,
      });
    }

    const framesForHold = Math.max(1, Math.round((frame.durationMs / 1000) * fps));
    for (let i = 0; i < framesForHold; i++) {
      // Pin coded + display size to the requested w×h so iOS Safari's
      // hardware encoder doesn't silently fall back to a smaller resolution.
      const vFrame = new VideoFrame(bitmap, {
        timestamp: timestampUs,
        displayWidth: w,
        displayHeight: h,
      });
      const isKey = emittedCount % keyframeEveryN === 0;
      videoEncoder.encode(vFrame, { keyFrame: isKey });
      vFrame.close();
      timestampUs += frameDurationUs;
      emittedCount++;
    }
    bitmap.close();
    frameIdx++;
    opts.onProgress?.(Math.min(videoWeight, (frameIdx / frames.length) * videoWeight));
  }

  await videoEncoder.flush();
  videoEncoder.close();
  await Promise.all(videoChunks);
  opts.onProgress?.(videoWeight);

  // ── 6. Mux the pre-collected audio chunks (if any).
  //       Audio was already encoded into `collectedAudioChunks` in step 3a.
  if (willMuxAudio) {
    for (const { chunk, meta } of collectedAudioChunks) {
      muxer.addAudioChunk(chunk, meta);
    }
    opts.onProgress?.(0.98);
  }

  // ── 7. Finalize ──
  muxer.finalize();
  const buffer = (muxer.target as ArrayBufferTarget).buffer;
  opts.onProgress?.(1);
  console.log('[Chess DNA] MP4 ready', {
    sizeKB: Math.round(buffer.byteLength / 1024),
    hasAudio: willMuxAudio,
    audioChunks: collectedAudioChunks.length,
  });
  return new Blob([buffer], { type: 'video/mp4' });
}

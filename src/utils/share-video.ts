/**
 * Video capture for animated share cards (Sequence mode).
 *
 * Strategy:
 *   1. Caller supplies an element plus a list of frames (each with a render function
 *      that mutates the element to show that frame + a duration in ms).
 *   2. We create an offscreen <canvas> at the element's size.
 *   3. For each frame: invoke render → wait a short tick → html2canvas(element) → drawImage.
 *      We hold the drawn image on the canvas for the frame's duration by repeatedly
 *      re-drawing it on requestAnimationFrame ticks.
 *   4. canvas.captureStream(30) feeds a MediaRecorder which collects chunks.
 *   5. Returned Blob is an MP4 (or WebM fallback — Firefox doesn't expose MP4).
 *
 * This avoids trying to record DOM directly (which would require heavy per-frame
 * html2canvas calls and wouldn't look smooth anyway) and instead produces a
 * slideshow-style animation that's more than good enough for social sharing.
 */

export interface SequenceFrame {
  /** Mutate DOM so `element` visually represents this frame. Async to allow React to flush. */
  render: () => Promise<void>;
  /** How long this frame is held in the recording, in ms. */
  durationMs: number;
}

interface RecordOptions {
  /** Target capture width. Output is scaled to fit. Defaults to element's offsetWidth. */
  width?: number;
  /** Target capture height. Defaults to element's offsetHeight. */
  height?: number;
  /** Playback fps. Defaults to 30. */
  fps?: number;
  /** Optional audio stream to mux into the recording (e.g. chess move sounds). */
  audioStream?: MediaStream;
  /**
   * Prefer MP4 output even if it means dropping audio. Set this when the
   * target is the Web Share sheet — iOS rejects WebM via navigator.share.
   */
  preferMp4?: boolean;
  /** Progress callback, 0..1. */
  onProgress?: (pct: number) => void;
}

/**
 * Pick the best MediaRecorder mime type.
 *   - preferMp4=true → always prefer MP4 (for Web Share on iOS). May silently drop audio.
 *   - withAudio=true → prefer WebM/Opus (MP4+AAC is rare in MediaRecorder).
 *   - else → prefer MP4, fall back to WebM.
 */
function pickMimeType(withAudio: boolean, preferMp4: boolean): { mimeType: string; ext: string } {
  const mp4First = [
    // Deliberately video-only MP4 for share compatibility (Instagram et al).
    // Chrome's MP4+AAC output is syntactically valid but Instagram rejects it.
    { mimeType: 'video/mp4;codecs=avc1', ext: 'mp4' },
    { mimeType: 'video/mp4', ext: 'mp4' },
    { mimeType: 'video/webm;codecs=vp9,opus', ext: 'webm' },
    { mimeType: 'video/webm;codecs=vp8,opus', ext: 'webm' },
    { mimeType: 'video/webm', ext: 'webm' },
  ];
  const webmFirst = [
    { mimeType: 'video/webm;codecs=vp9,opus', ext: 'webm' },
    { mimeType: 'video/webm;codecs=vp8,opus', ext: 'webm' },
    { mimeType: 'video/webm', ext: 'webm' },
    { mimeType: 'video/mp4;codecs=avc1,mp4a.40.2', ext: 'mp4' },
    { mimeType: 'video/mp4', ext: 'mp4' },
  ];
  const videoFirst = [
    { mimeType: 'video/mp4;codecs=avc1', ext: 'mp4' },
    { mimeType: 'video/mp4', ext: 'mp4' },
    { mimeType: 'video/webm;codecs=vp9', ext: 'webm' },
    { mimeType: 'video/webm;codecs=vp8', ext: 'webm' },
    { mimeType: 'video/webm', ext: 'webm' },
  ];
  const candidates = preferMp4 ? mp4First : withAudio ? webmFirst : videoFirst;
  for (const c of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(c.mimeType)) {
      return c;
    }
  }
  return { mimeType: '', ext: 'webm' };
}

export function isVideoCaptureSupported(): boolean {
  return (
    typeof MediaRecorder !== 'undefined' &&
    typeof HTMLCanvasElement.prototype.captureStream === 'function'
  );
}

export interface CaptureResult {
  blob: Blob;
  ext: string;
}

export async function captureSequenceAsVideo(
  element: HTMLElement,
  frames: SequenceFrame[],
  opts: RecordOptions = {},
): Promise<CaptureResult> {
  if (!isVideoCaptureSupported()) {
    throw new Error('MediaRecorder / captureStream not supported in this browser');
  }
  if (frames.length === 0) throw new Error('No frames to capture');

  const html2canvas = (await import('html2canvas')).default;

  // IMPORTANT: use the element's INTRINSIC (unscaled) size — the composer
  // renders the card at full resolution (e.g. 1080×1920) but applies a CSS
  // `transform: scale(...)` for the preview. getBoundingClientRect would
  // report the visually-scaled size (~420px) and tank the quality.
  // Prefer explicit width/height from the caller; fall back to offsetWidth
  // (unaffected by transforms) and finally to the visible rect.
  const rect = element.getBoundingClientRect();
  const width = Math.round(opts.width ?? element.offsetWidth ?? rect.width);
  const height = Math.round(opts.height ?? element.offsetHeight ?? rect.height);
  const fps = opts.fps ?? 30;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not get 2D canvas context');
  // Prime with black so the first few ms of video aren't transparent/white.
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, width, height);

  const stream = canvas.captureStream(fps);
  const { mimeType, ext } = pickMimeType(!!opts.audioStream, !!opts.preferMp4);
  // Mux audio ONLY into WebM. Chrome's MediaRecorder CAN produce MP4+AAC,
  // but the resulting file is rejected by Instagram (and several other
  // social apps) even though it plays fine in VLC/QuickTime. Keeping MP4
  // silent restores the previously-working share behaviour.
  if (opts.audioStream && ext === 'webm') {
    for (const track of opts.audioStream.getAudioTracks()) stream.addTrack(track);
  }
  // 8 Mbps matches Instagram's recommended ceiling for 1080p vertical video
  // and keeps files under socials' size limits. 6 Mbps was too low (blocky);
  // 12 Mbps was wasteful and some apps reject it.
  const recorder = mimeType
    ? new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000, audioBitsPerSecond: 128_000 })
    : new MediaRecorder(stream, { videoBitsPerSecond: 8_000_000, audioBitsPerSecond: 128_000 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

  const recorderStopped = new Promise<void>((resolve) => {
    recorder.onstop = () => resolve();
  });

  recorder.start(100); // emit chunks every 100ms

  opts.onProgress?.(0);
  let frameIdx = 0;
  try {
    for (const frame of frames) {
      await frame.render();
      // Give React one microtask + one paint tick to commit.
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      await new Promise((r) => setTimeout(r, 16));

      // html2canvas respects `width`/`height` of the source element — since
      // we're targeting the card's intrinsic size (1080×1920), scale=1 is
      // already retina-quality output. Scaling further would waste CPU and
      // just get downsampled into the fixed recorder canvas.
      const snapshot = await html2canvas(element, {
        scale: 1,
        width,
        height,
        useCORS: true,
        backgroundColor: null,
        logging: false,
        allowTaint: true,
        onclone: (doc) => {
          const node = doc.querySelector('[data-share-card]');
          if (node instanceof HTMLElement) {
            node.style.transform = 'none';
            node.style.transformOrigin = 'top left';
          }
        },
      });

      // Draw + hold for the frame duration. We redraw every ~33ms to keep the
      // stream alive (MediaRecorder needs fresh frames; repainting the same
      // pixels is fine and produces a static hold).
      const start = performance.now();
      while (performance.now() - start < frame.durationMs) {
        ctx.clearRect(0, 0, width, height);
        ctx.drawImage(snapshot, 0, 0, width, height);
        await new Promise((r) => setTimeout(r, 1000 / fps));
      }
      frameIdx++;
      opts.onProgress?.(Math.min(0.95, frameIdx / frames.length * 0.95));
    }
  } finally {
    // One final draw-hold so the recorder has the last frame for at least a
    // few ticks before we stop.
    await new Promise((r) => setTimeout(r, 100));
    recorder.stop();
    stream.getTracks().forEach((t) => t.stop());
  }

  await recorderStopped;
  const blob = new Blob(chunks, { type: mimeType || 'video/webm' });
  opts.onProgress?.(1);
  return { blob, ext };
}

export function downloadVideo(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

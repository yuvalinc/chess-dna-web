/**
 * Image capture and sharing utilities for share cards.
 * html2canvas is dynamically imported to keep the main bundle small.
 */

/** Resolve a CSS color string (including modern `oklab(...)`, `oklch(...)`,
 *  and `color-mix(in oklab, ...)`) to a plain `rgba(r, g, b, a)` string.
 *  Strategy: paint it on a 1×1 canvas and read the pixel back — the browser
 *  does the gamut math for us. Returns '' for fully transparent inputs so the
 *  caller can skip writing them. */
function resolveColorToRgba(input: string): string {
  if (!input) return '';
  if (input === 'transparent' || input === 'rgba(0, 0, 0, 0)') return '';
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext('2d');
  if (!ctx) return input;
  ctx.clearRect(0, 0, 1, 1);
  try {
    ctx.fillStyle = input;
  } catch {
    return '';
  }
  ctx.fillRect(0, 0, 1, 1);
  const d = ctx.getImageData(0, 0, 1, 1).data;
  return `rgba(${d[0]}, ${d[1]}, ${d[2]}, ${(d[3] / 255).toFixed(3)})`;
}

/** Walk a CSS value (e.g. `linear-gradient(...)`, `0 4px 6px oklab(...)`) and
 *  replace every `oklab(...)`, `oklch(...)`, and `color-mix(...)` segment with
 *  a flat `rgba(...)` equivalent. Tokens we can't resolve are left alone so a
 *  bad input doesn't blow up the whole declaration. */
function flattenColorTokens(input: string): string {
  if (!input) return input;
  if (!/(?:oklab|oklch|color-mix)\s*\(/i.test(input)) return input;
  const out: string[] = [];
  let i = 0;
  const n = input.length;
  while (i < n) {
    const rest = input.slice(i);
    const m = /(oklab|oklch|color-mix)\s*\(/i.exec(rest);
    if (!m) {
      out.push(rest);
      break;
    }
    out.push(rest.slice(0, m.index));
    const start = i + m.index;
    let depth = 1;
    let j = start + m[0].length;
    while (j < n && depth > 0) {
      const ch = input[j];
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      j++;
    }
    const expr = input.slice(start, j);
    const resolved = resolveColorToRgba(expr);
    out.push(resolved || expr);
    i = j;
  }
  return out.join('');
}

// Color-bearing CSS properties — we resolve these to plain rgba on capture so
// html2canvas v1 never has to parse oklab/oklch/color-mix.
const FLAT_COLOR_PROPS = [
  'color',
  'backgroundColor',
  'borderTopColor',
  'borderRightColor',
  'borderBottomColor',
  'borderLeftColor',
  'outlineColor',
  'caretColor',
  'fill',
  'stroke',
] as const;

// Composite properties that may contain colors inside other syntax (gradients,
// shadow lists). We pass them through `flattenColorTokens` instead of resolving
// to a single rgba.
const COMPOSITE_COLOR_PROPS = [
  'backgroundImage',
  'boxShadow',
  'textShadow',
  'borderImageSource',
] as const;

// Size-bearing properties that may use viewport-relative units (vw/vh/vmin/
// vmax) or `clamp()` expressions html2canvas v1 mis-evaluates. We snapshot
// the live, resolved px values and inline them on the clone — without this,
// `clamp(72px, 18vw, 112px)` on the achievement-card hero stat collapses to
// a much smaller size inside html2canvas's hidden iframe, clipping the
// "Highest accuracy" descenders and squeezing the ACCURACY caption onto the
// "%" glyph.
const RESOLVED_SIZE_PROPS = ['fontSize', 'lineHeight', 'letterSpacing'] as const;

// Target output width (px). Instagram Stories, Reels, and most social feeds
// display at 1080px wide on mobile — anything less gets upscaled and looks
// blurry. We pick a scale that hits this width without wasting CPU/bandwidth
// on a 4K render.
const TARGET_WIDTH = 1080;
const MIN_SCALE = 2;
const MAX_SCALE = 3;

// Instagram / Snapchat / FB Stories canvas is 1080×1920 (9:16). When a card
// isn't laid out at story dimensions we wrap the capture in this frame so the
// card sits inside the safe area where IG's own UI chrome (close button,
// sticker tools, caption input, story buttons) doesn't overlap it.
const STORY_W = 1080;
const STORY_H = 1920;
// Margins keep the card just inside IG / Snap / FB Stories UI chrome while
// letting it fill most of the width — the user-facing goal is "this should
// look like a phone screenshot of the in-app card", so we leave only a thin
// side gutter and a slim top/bottom band where IG's own controls sit.
const STORY_SAFE_TOP = 160;
const STORY_SAFE_BOTTOM = 220;
const STORY_SAFE_SIDE = 20;
const STORY_BG = '#0a0f1a';

/** Composite a captured card canvas into a 1080×1920 Story-safe canvas. The
 *  card preserves its aspect ratio and is fit to the largest size that stays
 *  inside the safe area. Background uses the chess-bg color so the card's
 *  rounded corners read as a single "phone screenshot" surface. */
function wrapInStoryFrame(card: HTMLCanvasElement, opaque: boolean): HTMLCanvasElement {
  const safeW = STORY_W - STORY_SAFE_SIDE * 2;
  const safeH = STORY_H - STORY_SAFE_TOP - STORY_SAFE_BOTTOM;
  const cardAspect = card.width / card.height;
  const safeAspect = safeW / safeH;

  let drawW: number;
  let drawH: number;
  if (cardAspect > safeAspect) {
    drawW = safeW;
    drawH = drawW / cardAspect;
  } else {
    drawH = safeH;
    drawW = drawH * cardAspect;
  }
  const drawX = (STORY_W - drawW) / 2;
  const drawY = STORY_SAFE_TOP + (safeH - drawH) / 2;

  const out = document.createElement('canvas');
  out.width = STORY_W;
  out.height = STORY_H;
  const ctx = out.getContext('2d');
  if (!ctx) return card;
  if (opaque) {
    ctx.fillStyle = STORY_BG;
    ctx.fillRect(0, 0, STORY_W, STORY_H);
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(card, drawX, drawY, drawW, drawH);
  return out;
}

/** Capture a DOM element as a high-resolution image Blob. Renders at the
 *  element's intrinsic (un-transformed) size, then up-scales by 2-3× so the
 *  shared image stays sharp after social-platform recompression.
 *
 *  Output format defaults to JPEG at quality 0.92 — gives ~5× smaller files
 *  than PNG with negligible visual difference for UI cards, and matches what
 *  Instagram/WhatsApp re-encode to anyway. Callers that need a transparent
 *  background can opt into PNG. */
export interface CaptureOptions {
  /** 'jpeg' (default, smaller) or 'png' (lossless, supports transparency). */
  format?: 'jpeg' | 'png';
  /** JPEG quality 0..1 (ignored for PNG). Default 0.92. */
  quality?: number;
  /** Wrap the captured card in a 1080×1920 (9:16) Instagram Story-safe canvas
   *  with the card centered inside the safe area. Use for callers that render
   *  the card at its in-app size (~448px wide) so the shared image fits the
   *  Story aspect ratio without IG's UI chrome cropping the card's edges.
   *  Default false — callers that already render at 1080×1920 (e.g.
   *  ShareComposer) should leave this off to avoid double-scaling. */
  storyFormat?: boolean;
}

export async function captureCardAsBlob(
  element: HTMLElement,
  opts: CaptureOptions = {},
): Promise<Blob> {
  const html2canvas = (await import('html2canvas')).default;
  const format = opts.format ?? 'jpeg';
  const quality = opts.quality ?? 0.92;
  // Intrinsic (pre-transform) size. offsetWidth/offsetHeight ignore CSS
  // transforms, so this gives us e.g. 1080×1920 even when the preview is
  // visually scaled to ~420×750.
  const width = element.offsetWidth || element.getBoundingClientRect().width;
  // Capture the larger of `offsetHeight` and `scrollHeight`, plus an 8px
  // safety pad. The card uses `overflow-hidden` for its rounded mask, so any
  // text-metric drift between the live DOM and html2canvas's clone iframe
  // can push the footer's descenders out the bottom and get them clipped.
  // Letting the capture grow + telling the clone to drop `overflow` (see
  // onclone) means content cannot be cut off — the wrapInStoryFrame step
  // then fits the full thing into the 9:16 frame.
  const measuredH = Math.max(element.offsetHeight, element.scrollHeight, element.getBoundingClientRect().height);
  const height = measuredH + 8;
  // Pick a scale that brings the rendered width up to TARGET_WIDTH (clamped
  // to [MIN_SCALE, MAX_SCALE]) so the share image always meets the social-
  // platform native display width without producing 4K blobs. When the
  // element is already at or above TARGET_WIDTH (e.g. the dedicated 1080
  // share card), capture at scale=1 — upscaling further just doubles render
  // cost and produces a ~4K blob that gets downsampled on every social
  // platform anyway.
  const scale = width >= TARGET_WIDTH
    ? 1
    : Math.max(MIN_SCALE, Math.min(MAX_SCALE, Math.ceil(TARGET_WIDTH / width)));

  // html2canvas v1 cannot parse Tailwind v4's `color-mix(in oklab, ...)` or
  // `oklab()`/`oklch()` colors. We pre-resolve every color on the live tree
  // (browser does the math), tag elements with stable indices, then in the
  // onclone callback inline the resolved rgba() values on the cloned DOM —
  // so html2canvas only ever sees plain rgba colors it understands.
  const ATTR = 'data-share-cap-idx';
  const liveEls: HTMLElement[] = [
    element,
    ...Array.from(element.querySelectorAll<HTMLElement>('*')),
  ];
  type FlatProp = (typeof FLAT_COLOR_PROPS)[number];
  type CompositeProp = (typeof COMPOSITE_COLOR_PROPS)[number];
  type SizeProp = (typeof RESOLVED_SIZE_PROPS)[number];
  const colorsByIdx: Array<Partial<Record<FlatProp | CompositeProp | SizeProp, string>>> = [];
  liveEls.forEach((el, i) => {
    el.setAttribute(ATTR, String(i));
    const cs = window.getComputedStyle(el);
    const resolved: Partial<Record<FlatProp | CompositeProp | SizeProp, string>> = {};
    for (const prop of FLAT_COLOR_PROPS) {
      const val = cs[prop as 'color'];
      const rgba = resolveColorToRgba(val);
      if (rgba) resolved[prop] = rgba;
    }
    for (const prop of COMPOSITE_COLOR_PROPS) {
      const val = cs[prop as 'backgroundImage'];
      if (val && val !== 'none' && /(?:oklab|oklch|color-mix)\s*\(/i.test(val)) {
        resolved[prop] = flattenColorTokens(val);
      }
    }
    for (const prop of RESOLVED_SIZE_PROPS) {
      const val = cs[prop as 'fontSize'];
      if (val) resolved[prop] = val;
    }
    colorsByIdx.push(resolved);
  });

  try {
    const canvas = await html2canvas(element, {
      scale,
      width,
      height,
      useCORS: true,
      // JPEG can't have transparent pixels — give it the share-card surface
      // color instead of a black box. PNG keeps the alpha channel.
      backgroundColor: format === 'jpeg' ? '#0a0f1a' : null,
      // Pin the simulated viewport to the live one. Otherwise html2canvas
      // creates its clone iframe at its own default size and any `vw`/`vh`
      // values resolve differently than they did on screen — `clamp(72px,
      // 18vw, 112px)` on the achievement hero stat blew up from 72px to
      // 112px, pushing layout past the card's intrinsic height and clipping
      // the title's descenders + the footer.
      windowWidth: window.innerWidth,
      windowHeight: window.innerHeight,
      logging: false,
      allowTaint: true,
      onclone: (doc) => {
        // Remove the preview-scale transform from the CLONE html2canvas renders
        // into. The live DOM stays untouched.
        const node = doc.querySelector('[data-share-card]');
        if (node instanceof HTMLElement) {
          node.style.transform = 'none';
          node.style.transformOrigin = 'top left';
          // Let the card grow to fit any text-metric drift inside the clone —
          // `overflow:hidden` (set by the rounded-mask) was clipping the last
          // line's descenders when the clone's text laid out slightly taller
          // than the live DOM did. We expand height + drop the overflow rule
          // so nothing gets cut; the capture-height pad above gives the wrap
          // step a few pixels of safety canvas to fit it all.
          node.style.height = 'auto';
          node.style.minHeight = `${measuredH}px`;
          node.style.overflow = 'visible';
        }
        const cloneEls = doc.querySelectorAll<HTMLElement>(`[${ATTR}]`);
        cloneEls.forEach((cloneEl) => {
          const idx = Number(cloneEl.getAttribute(ATTR));
          const resolved = colorsByIdx[idx];
          if (resolved) {
            for (const prop of FLAT_COLOR_PROPS) {
              const v = resolved[prop];
              if (v) (cloneEl.style as unknown as Record<string, string>)[prop] = v;
            }
            for (const prop of COMPOSITE_COLOR_PROPS) {
              const v = resolved[prop];
              if (v) (cloneEl.style as unknown as Record<string, string>)[prop] = v;
            }
            for (const prop of RESOLVED_SIZE_PROPS) {
              const v = resolved[prop];
              if (v) (cloneEl.style as unknown as Record<string, string>)[prop] = v;
            }
          }
          cloneEl.removeAttribute(ATTR);
        });
      },
    });
    const outCanvas = opts.storyFormat
      ? wrapInStoryFrame(canvas, format === 'jpeg')
      : canvas;
    const mime = format === 'jpeg' ? 'image/jpeg' : 'image/png';
    return await new Promise<Blob>((resolve, reject) => {
      outCanvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('Failed to create blob'))),
        mime,
        format === 'jpeg' ? quality : 1.0,
      );
    });
  } finally {
    // Always strip the temporary attributes from the LIVE DOM, even if the
    // capture threw — otherwise repeated captures would balloon the markup.
    liveEls.forEach((el) => el.removeAttribute(ATTR));
  }
}

export type ShareOutcome = 'shared' | 'copied' | 'downloaded' | 'cancelled';

/** Share an image with the OS share sheet, with graceful fallbacks.
 *
 *  Order of attempts:
 *    1. `navigator.share({files})` — opens the native share sheet on mobile
 *       and on desktop browsers that support it. AbortError (user dismissed)
 *       is treated as a successful intent — we DO NOT fall through, since
 *       silently downloading after the user cancelled would surprise them.
 *    2. `navigator.clipboard.write()` — useful on desktop where the user can
 *       then paste the image into a messenger, doc, etc.
 *    3. Direct download — the universal last resort. */
export async function shareImage(blob: Blob, filename: string): Promise<ShareOutcome> {
  // Trust the blob's own MIME — captureCardAsBlob may produce JPEG or PNG,
  // and platforms behave differently if the File MIME mismatches the bytes.
  const mime = blob.type || 'image/png';
  const ext = mime === 'image/jpeg' ? 'jpg' : 'png';
  const finalName = /\.(jpg|jpeg|png)$/i.test(filename) ? filename : `${filename}.${ext}`;
  const file = new File([blob], finalName, { type: mime });
  if (typeof navigator.share === 'function' && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return 'shared';
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') return 'cancelled';
      // Other errors (e.g. NotAllowedError on a stale gesture) → fall through.
    }
  }
  if (await copyImageToClipboard(blob)) return 'copied';
  downloadImage(blob, finalName);
  return 'downloaded';
}

/** Download a blob as a file */
export function downloadImage(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Copy image to clipboard. Most browsers' clipboard APIs accept only PNG, so
 *  we re-encode JPEG blobs to PNG on demand. */
export async function copyImageToClipboard(blob: Blob): Promise<boolean> {
  try {
    const pngBlob = blob.type === 'image/png' ? blob : await convertToPng(blob);
    if (!pngBlob) return false;
    await navigator.clipboard.write([
      new ClipboardItem({ 'image/png': pngBlob }),
    ]);
    return true;
  } catch {
    return false;
  }
}

async function convertToPng(blob: Blob): Promise<Blob | null> {
  try {
    const bmp = await createImageBitmap(blob);
    const c = document.createElement('canvas');
    c.width = bmp.width;
    c.height = bmp.height;
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(bmp, 0, 0);
    return await new Promise<Blob | null>((resolve) =>
      c.toBlob((b) => resolve(b), 'image/png'),
    );
  } catch {
    return null;
  }
}

/** Check if native file sharing is supported */
export function canShareFiles(): boolean {
  try {
    const file = new File([], 'test.png', { type: 'image/png' });
    return !!navigator.canShare?.({ files: [file] });
  } catch {
    return false;
  }
}

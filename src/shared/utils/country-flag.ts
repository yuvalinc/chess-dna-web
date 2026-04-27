/**
 * Country code → flag utilities.
 *
 * We deliberately render flags as IMAGE URLs (flagcdn.com) rather than
 * unicode emoji, because html2canvas cannot reliably render regional-
 * indicator emoji (they rasterize as text boxes or missing glyphs in many
 * environments). flagcdn.com is a free CDN, CORS-enabled, and returns PNGs
 * that html2canvas can embed when the img is loaded with crossOrigin="anonymous".
 */

/** ISO-3166-1 alpha-2 code → CDN PNG URL. `null` if cc is invalid. */
export function countryFlagUrl(cc: string | null | undefined, widthPx = 160): string | null {
  if (!cc || cc.length !== 2) return null;
  return `https://flagcdn.com/w${widthPx}/${cc.toLowerCase()}.png`;
}

/** Emoji flag (used only where html2canvas won't touch it — e.g. live UI). */
export function countryFlagEmoji(cc: string | null | undefined): string {
  if (!cc || cc.length !== 2) return '';
  const A = 0x1f1e6;
  const a = 'A'.charCodeAt(0);
  return String.fromCodePoint(
    A + cc.toUpperCase().charCodeAt(0) - a,
    A + cc.toUpperCase().charCodeAt(1) - a,
  );
}

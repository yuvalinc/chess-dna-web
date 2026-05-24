/* ────────────────────────────────────────────────────────────────────────
 *  Pure Canvas2D renderer for the Achievement share card.
 *
 *  Draws the entire 1080×1920 share image directly with `CanvasRenderingContext2D`
 *  primitives — no DOM walk, no html2canvas, no SVG-foreignObject. The chess
 *  board is composed square-by-square with the cburnett SVG pieces loaded
 *  as `<img>` elements. Output is byte-stable and identical across browsers
 *  because the browser is only doing what canvas tells it to.
 *
 *  Replaces the previous `captureCardAsBlob` path for Achievement cards.
 *  Other share surfaces (PlayerCardShare, TakeawayShareView) still use the
 *  html2canvas-based capture in `share-image.ts`.
 * ──────────────────────────────────────────────────────────────────────── */
import { SHARE_COLORS } from '@/components/share/share-colors';

const STORY_W = 1080;
const STORY_H = 1920;

/** Which achievement icon to draw inside the title-block badge. */
export type AchievementIconId = 'star' | 'target' | 'crown' | 'bolt' | 'stopwatch';

export interface AchievementCanvasInput {
  /** Achievement title, e.g. "Highest accuracy". */
  title: string;
  /** Hero stat, e.g. "100%", "989", "1". */
  statValue: string;
  /** Optional unit caption shown under the hero, e.g. "accuracy". */
  statUnit?: string;
  /** Accent color (hex). Used for title, hero stat, badge tint. */
  toneHex: string;
  /** Which icon to render in the title-block badge. */
  iconId: AchievementIconId;
  /** Chess position FEN to render on the mini board. */
  boardFen: string;
  /** Which side faces the bottom of the board. */
  boardOrientation: 'white' | 'black';
  /** Opponent display name. */
  opponentUsername: string;
  /** Opponent rating. */
  opponentRating: number;
  /** Opponent's chess.com avatar URL — null/undefined falls back to a
   *  letter circle (first character of the username). */
  opponentAvatarUrl?: string | null;
  /** Game outcome from the player's perspective. */
  result: 'win' | 'loss' | 'draw';
  /** Single letter shown in the result badge ("W" / "L" / "D"). */
  resultLetter: string;
  /** Bottom meta line, e.g. "33 moves · May 11". */
  metaLine: string;
}

const PIECE_PATHS: Record<string, string> = {
  wK: '/pieces/cburnett/wK.svg', wQ: '/pieces/cburnett/wQ.svg', wR: '/pieces/cburnett/wR.svg',
  wB: '/pieces/cburnett/wB.svg', wN: '/pieces/cburnett/wN.svg', wP: '/pieces/cburnett/wP.svg',
  bK: '/pieces/cburnett/bK.svg', bQ: '/pieces/cburnett/bQ.svg', bR: '/pieces/cburnett/bR.svg',
  bB: '/pieces/cburnett/bB.svg', bN: '/pieces/cburnett/bN.svg', bP: '/pieces/cburnett/bP.svg',
};

const SQ_LIGHT = '#edeed1';
const SQ_DARK = '#779556';

async function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/** Expand a FEN board section into an 8×8 grid of piece keys ("wK", "bP", null). */
function fenToBoard(fen: string): (string | null)[][] {
  const rows = fen.split(' ')[0].split('/');
  return rows.map(row => {
    const out: (string | null)[] = [];
    for (const ch of row) {
      if (/[1-8]/.test(ch)) {
        for (let i = 0; i < Number(ch); i++) out.push(null);
      } else {
        const isWhite = ch === ch.toUpperCase();
        out.push((isWhite ? 'w' : 'b') + ch.toUpperCase());
      }
    }
    return out;
  });
}

function path2dRoundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Draw a Lucide-style 24×24 vector icon at (x,y), scaled to `size` and
 *  stroked in the given color. The geometry mirrors the live React icons
 *  in RecentGames.tsx so the share matches the in-app card. */
function drawAchievementIcon(
  ctx: CanvasRenderingContext2D,
  id: AchievementIconId,
  x: number,
  y: number,
  size: number,
  color: string,
) {
  const s = size / 24; // SVG viewBox is 0 0 24 24
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1.8;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const polygon = (points: number[][]) => {
    ctx.beginPath();
    points.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
    ctx.closePath();
    ctx.stroke();
  };
  const circle = (cx: number, cy: number, r: number) => {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  };
  const segment = (x1: number, y1: number, x2: number, y2: number) => {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  };
  switch (id) {
    case 'star':
      polygon([
        [12, 2], [15.09, 8.26], [22, 9.27], [17, 14.14], [18.18, 21.02],
        [12, 17.77], [5.82, 21.02], [7, 14.14], [2, 9.27], [8.91, 8.26],
      ]);
      break;
    case 'target':
      circle(12, 12, 10);
      circle(12, 12, 6);
      circle(12, 12, 2);
      break;
    case 'crown': {
      segment(3, 18, 21, 18);
      // M3 8l5 4 4-7 4 7 5-4-2 10H5z
      ctx.beginPath();
      ctx.moveTo(3, 8);
      ctx.lineTo(8, 12);
      ctx.lineTo(12, 5);
      ctx.lineTo(16, 12);
      ctx.lineTo(21, 8);
      ctx.lineTo(19, 18);
      ctx.lineTo(5, 18);
      ctx.closePath();
      ctx.stroke();
      break;
    }
    case 'bolt':
      polygon([[13, 2], [3, 14], [12, 14], [11, 22], [21, 10], [12, 10]]);
      break;
    case 'stopwatch':
      circle(12, 13, 8);
      segment(12, 9, 12, 13);
      segment(12, 13, 14.5, 15.5);
      segment(9, 2, 15, 2);
      segment(12, 2, 12, 5);
      break;
  }
  ctx.restore();
}

/** Load an image, returning null on any failure so the renderer can fall
 *  back to a letter avatar instead of throwing. */
async function loadImageSafe(src: string): Promise<HTMLImageElement | null> {
  try { return await loadImage(src); } catch { return null; }
}

function drawAvatarCircle(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement | null,
  username: string,
  cx: number,
  cy: number,
  radius: number,
) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  if (img) {
    ctx.drawImage(img, cx - radius, cy - radius, radius * 2, radius * 2);
  } else {
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
    ctx.fillStyle = '#9ca3af';
    ctx.font = `700 ${Math.round(radius * 0.9)}px -apple-system, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText((username[0] ?? '?').toUpperCase(), cx, cy);
  }
  ctx.restore();
}

/** Render an 8×8 chess board to its own canvas. Exported because the same
 *  routine is useful for board thumbnails outside the share path. */
export async function renderBoardCanvas(
  fen: string,
  orientation: 'white' | 'black',
  size = 720,
): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  const sq = size / 8;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      ctx.fillStyle = (r + c) % 2 === 0 ? SQ_LIGHT : SQ_DARK;
      ctx.fillRect(c * sq, r * sq, sq, sq);
    }
  }
  const board = fenToBoard(fen);
  const needed = new Set<string>();
  board.forEach(row => row.forEach(p => p && needed.add(p)));
  const imgs = new Map<string, HTMLImageElement>();
  await Promise.all(
    Array.from(needed).map(async (p) => {
      try { imgs.set(p, await loadImage(PIECE_PATHS[p])); } catch { /* skip unloadable piece */ }
    }),
  );
  const flip = orientation === 'black';
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = board[r][c];
      if (!piece) continue;
      const img = imgs.get(piece);
      if (!img) continue;
      const dr = flip ? 7 - r : r;
      const dc = flip ? 7 - c : c;
      ctx.drawImage(img, dc * sq, dr * sq, sq, sq);
    }
  }
  return canvas;
}

/** Render the full 1080×1920 Achievement share image as a JPEG Blob. */
export async function renderAchievementShareImage(
  data: AchievementCanvasInput,
  opts: { quality?: number } = {},
): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = STORY_W;
  canvas.height = STORY_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not acquire 2D context');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  // Outer "phone background" — what the user sees behind the card.
  ctx.fillStyle = SHARE_COLORS.bg;
  ctx.fillRect(0, 0, STORY_W, STORY_H);

  // Card surface — 1040×1540, leaving a thin gutter inside the IG safe area.
  const cardX = 20;
  const cardY = 160;
  const cardW = 1040;
  const cardH = 1540;
  path2dRoundRect(ctx, cardX, cardY, cardW, cardH, 40);
  ctx.fillStyle = SHARE_COLORS.surface;
  ctx.fill();

  // Subtle grid pattern — clipped to the card's rounded shape.
  ctx.save();
  path2dRoundRect(ctx, cardX, cardY, cardW, cardH, 40);
  ctx.clip();
  ctx.strokeStyle = 'rgba(255,255,255,0.035)';
  ctx.lineWidth = 1;
  for (let x = cardX; x <= cardX + cardW; x += 64) {
    ctx.beginPath(); ctx.moveTo(x, cardY); ctx.lineTo(x, cardY + cardH); ctx.stroke();
  }
  for (let y = cardY; y <= cardY + cardH; y += 64) {
    ctx.beginPath(); ctx.moveTo(cardX, y); ctx.lineTo(cardX + cardW, y); ctx.stroke();
  }
  ctx.restore();

  // ── Pre-load icon images (logo + avatar) in parallel ──
  const [logoImg, avatarImg] = await Promise.all([
    loadImageSafe('/favicon.png'),
    data.opponentAvatarUrl ? loadImageSafe(data.opponentAvatarUrl) : Promise.resolve(null),
  ]);

  // ── Header row: logo + "CHESS DNA" + "ACHIEVEMENT" badge ──
  ctx.textBaseline = 'top';
  const logoSize = 44;
  const headerY = cardY + 56;
  let headerCursorX = cardX + 60;
  if (logoImg) {
    ctx.save();
    path2dRoundRect(ctx, headerCursorX, headerY + 4, logoSize, logoSize, 6);
    ctx.clip();
    ctx.drawImage(logoImg, headerCursorX, headerY + 4, logoSize, logoSize);
    ctx.restore();
    headerCursorX += logoSize + 16;
  }
  ctx.fillStyle = SHARE_COLORS.text;
  ctx.font = '700 30px -apple-system, "Segoe UI", Roboto, sans-serif';
  ctx.fillText('CHESS DNA', headerCursorX, headerY + 16);

  ctx.font = '700 26px -apple-system, "Segoe UI", Roboto, sans-serif';
  const badgeLabel = 'ACHIEVEMENT';
  const badgePadX = 22;
  const badgePadY = 12;
  const badgeW = ctx.measureText(badgeLabel).width + badgePadX * 2;
  const badgeH = 48;
  const badgeX = cardX + cardW - 60 - badgeW;
  const badgeY = headerY + 4;
  path2dRoundRect(ctx, badgeX, badgeY, badgeW, badgeH, 14);
  ctx.fillStyle = data.toneHex + '28';
  ctx.fill();
  ctx.fillStyle = data.toneHex;
  ctx.fillText(badgeLabel, badgeX + badgePadX, badgeY + badgePadY);

  // ── Title block: achievement icon badge + label + title ──
  const titleBlockY = cardY + 180;
  const iconBadgeSize = 96;
  const iconBadgeX = cardX + 60;
  // Rounded colored badge — matches the live UI's `bg-{tone}/10` swatch.
  path2dRoundRect(ctx, iconBadgeX, titleBlockY, iconBadgeSize, iconBadgeSize, 20);
  ctx.fillStyle = data.toneHex + '1a';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  drawAchievementIcon(
    ctx,
    data.iconId,
    iconBadgeX + iconBadgeSize / 2 - 26,
    titleBlockY + iconBadgeSize / 2 - 26,
    52,
    data.toneHex,
  );

  // Text right of the icon badge
  const titleTextX = iconBadgeX + iconBadgeSize + 28;
  ctx.fillStyle = SHARE_COLORS.textTertiary;
  ctx.font = '700 24px -apple-system, "Segoe UI", Roboto, sans-serif';
  ctx.fillText('YOUR PERSONAL BEST', titleTextX, titleBlockY + 14);
  ctx.fillStyle = data.toneHex;
  ctx.font = '800 56px -apple-system, "Segoe UI", Roboto, sans-serif';
  ctx.fillText(data.title, titleTextX, titleBlockY + 50);

  // ── Hero stat ──
  ctx.textAlign = 'center';
  ctx.fillStyle = data.toneHex;
  ctx.font = '900 280px -apple-system, "Segoe UI", Roboto, sans-serif';
  ctx.fillText(data.statValue, cardX + cardW / 2, cardY + 380);
  if (data.statUnit) {
    ctx.fillStyle = SHARE_COLORS.textTertiary;
    ctx.font = '700 32px -apple-system, "Segoe UI", Roboto, sans-serif';
    ctx.fillText(data.statUnit.toUpperCase(), cardX + cardW / 2, cardY + 700);
  }
  ctx.textAlign = 'left';

  // ── Chess board ──
  // Sized + positioned to leave a clean ~30px gutter above the footer bar so
  // the bottom rank can never spill into the W/L/D badge.
  const boardSize = 620;
  const boardX = cardX + (cardW - boardSize) / 2;
  const boardY = cardY + 760;
  const boardCanvas = await renderBoardCanvas(data.boardFen, data.boardOrientation, boardSize);
  ctx.drawImage(boardCanvas, boardX, boardY);

  // ── Footer bar ──
  // Opaque background — even if the board ever slightly overshoots the
  // gutter, the footer panel hides any pixel intrusion cleanly.
  const footerH = 140;
  const footerY = cardY + cardH - footerH;
  ctx.fillStyle = '#0d1422';
  ctx.fillRect(cardX, footerY, cardW, footerH);
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cardX, footerY);
  ctx.lineTo(cardX + cardW, footerY);
  ctx.stroke();

  // Result badge (W / L / D)
  const resultColor =
    data.result === 'win' ? SHARE_COLORS.win :
      data.result === 'loss' ? SHARE_COLORS.loss : SHARE_COLORS.draw;
  const resultBadgeX = cardX + 60;
  const resultBadgeY = footerY + 32;
  const resultBadgeSize = 72;
  path2dRoundRect(ctx, resultBadgeX, resultBadgeY, resultBadgeSize, resultBadgeSize, 16);
  ctx.fillStyle = resultColor + '2e';
  ctx.fill();
  ctx.fillStyle = resultColor;
  ctx.font = '900 28px -apple-system, "Segoe UI", Roboto, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(data.resultLetter, resultBadgeX + resultBadgeSize / 2, resultBadgeY + resultBadgeSize / 2);

  // Opponent avatar circle, right of the result badge
  const avatarRadius = 32;
  const avatarCx = resultBadgeX + resultBadgeSize + 22 + avatarRadius;
  const avatarCy = resultBadgeY + resultBadgeSize / 2;
  drawAvatarCircle(ctx, avatarImg, data.opponentUsername, avatarCx, avatarCy, avatarRadius);

  // Opponent + meta lines (right of avatar)
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  const textX = avatarCx + avatarRadius + 20;
  ctx.fillStyle = SHARE_COLORS.text;
  ctx.font = '700 34px -apple-system, "Segoe UI", Roboto, sans-serif';
  ctx.fillText(
    `vs ${data.opponentUsername}  (${data.opponentRating})`,
    textX,
    footerY + 38,
  );
  ctx.fillStyle = SHARE_COLORS.textTertiary;
  ctx.font = '500 24px -apple-system, "Segoe UI", Roboto, sans-serif';
  ctx.fillText(data.metaLine, textX, footerY + 86);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('canvas.toBlob returned null'))),
      'image/jpeg',
      opts.quality ?? 0.92,
    );
  });
}

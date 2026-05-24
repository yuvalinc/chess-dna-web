/* ────────────────────────────────────────────────────────────────────────
 *  AchievementShareCard — a dedicated 1080×1920 render of the Achievement
 *  card, used ONLY when generating the social-share image. The live UI
 *  card (in RecentGames.AchievementCarousel) is laid out for the carousel
 *  viewport (~343px wide) and relies on `clamp()`, `truncate`'s implicit
 *  overflow:hidden, and `leading-none` — patterns that html2canvas v1
 *  mishandles, producing descender clipping and caption overlap in the
 *  captured image.
 *
 *  This component side-steps all of that: every dimension is a hardcoded
 *  pixel value at the native Story aspect (9:16, 1080×1920), every color
 *  is a flat hex (so html2canvas never sees `oklab`/`color-mix`), and
 *  every text node has explicit line-height with room for descenders.
 *  Capture is a straight html2canvas at scale=1 — no story-frame wrap,
 *  no viewport-units to resolve, no overflow tricks to argue with.
 * ──────────────────────────────────────────────────────────────────────── */
import type { CSSProperties } from 'react';
import ThemedChessboard from '@/components/ThemedChessboard';
import PlayerAvatar from '@/components/PlayerAvatar';
import { SHARE_COLORS } from './share-colors';

type IconComponent = (props: { className?: string; size?: number }) => React.JSX.Element;

interface OpponentInfo {
  username: string;
  rating: number;
  countryCode?: string | null;
}

export interface AchievementShareData {
  Icon: IconComponent;
  /** Display title — e.g. "Highest accuracy". */
  title: string;
  /** Hero stat shown big — e.g. "100%", "989", "1". */
  statValue: string;
  /** Optional caption below the stat — e.g. "accuracy", "Elo beaten". */
  statUnit?: string;
  /** Hex color for the stat + title + accents (matches the tone class on the live card). */
  toneHex: string;
  /** Board state to display. */
  board: { fen: string; orientation: 'white' | 'black' };
  /** Opponent info. */
  opponent: OpponentInfo;
  /** Game result from the player's perspective. */
  result: 'win' | 'loss' | 'draw';
  /** Single-letter localized label (W/L/D). */
  resultLabel: string;
  /** Move count + already-formatted date string ("33 moves · May 11"). */
  metaLine: string;
}

const STORY_W = 1080;
const STORY_H = 1920;

/* Tone helpers — derive faint background + border tints from the hex tone.
   Using rgba() with the parsed channels means html2canvas always sees a
   plain color and never has to evaluate Tailwind's `bg-X/10` arithmetic. */
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return { r: 74, g: 222, b: 128 };
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}
function rgba(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const cardStyle: CSSProperties = {
  width: STORY_W,
  height: STORY_H,
  position: 'relative',
  backgroundColor: SHARE_COLORS.surface,
  overflow: 'hidden',
  fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Roboto, sans-serif',
  color: SHARE_COLORS.text,
};

const gridBgStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  backgroundImage:
    'linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px)',
  backgroundSize: '64px 64px',
  pointerEvents: 'none',
};

export default function AchievementShareCard({ data }: { data: AchievementShareData }) {
  const { Icon, title, statValue, statUnit, toneHex, board, opponent, result, resultLabel, metaLine } = data;

  const resultColor =
    result === 'win' ? SHARE_COLORS.win
      : result === 'loss' ? SHARE_COLORS.loss
        : SHARE_COLORS.draw;
  const resultBgFill = rgba(resultColor, 0.18);

  return (
    <div data-share-card="true" style={cardStyle}>
      <div style={gridBgStyle} aria-hidden />

      {/* Tone wash in the corner — purely decorative. */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          top: -140,
          right: -140,
          width: 480,
          height: 480,
          borderRadius: 240,
          backgroundColor: rgba(toneHex, 0.12),
          filter: 'blur(80px)',
          pointerEvents: 'none',
        }}
      />

      {/* ──── Header row ──── */}
      <div style={{ position: 'absolute', top: 72, left: 80, right: 80, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <img src="/favicon.png" alt="" width={40} height={40} style={{ borderRadius: 6 }} crossOrigin="anonymous" />
          <span style={{ fontSize: 30, fontWeight: 800, letterSpacing: 4, color: SHARE_COLORS.text, textTransform: 'uppercase', lineHeight: 1.2 }}>
            Chess DNA
          </span>
        </div>
        <span style={{
          fontSize: 26,
          fontWeight: 800,
          letterSpacing: 4,
          color: toneHex,
          backgroundColor: rgba(toneHex, 0.16),
          padding: '10px 22px',
          borderRadius: 14,
          textTransform: 'uppercase',
          lineHeight: 1.2,
        }}>
          Achievement
        </span>
      </div>

      {/* ──── Title block ──── */}
      <div style={{ position: 'absolute', top: 200, left: 80, right: 80, display: 'flex', alignItems: 'center', gap: 32 }}>
        <div style={{
          width: 144,
          height: 144,
          borderRadius: 32,
          backgroundColor: rgba(toneHex, 0.14),
          border: `1px solid ${rgba('#ffffff', 0.06)}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          color: toneHex,
        }}>
          <Icon size={72} />
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: 4, color: SHARE_COLORS.textTertiary, textTransform: 'uppercase', lineHeight: 1.4 }}>
            Your personal best
          </div>
          <div style={{ fontSize: 56, fontWeight: 800, color: toneHex, lineHeight: 1.25, marginTop: 12, whiteSpace: 'nowrap' }}>
            {title}
          </div>
        </div>
      </div>

      {/* ──── Hero stat ──── */}
      <div style={{ position: 'absolute', top: 460, left: 0, right: 0, textAlign: 'center' }}>
        <div style={{
          fontSize: 280,
          fontWeight: 900,
          color: toneHex,
          lineHeight: 1.05,
          letterSpacing: -10,
          fontVariantNumeric: 'tabular-nums',
        }}>
          {statValue}
        </div>
        {statUnit && (
          <div style={{
            fontSize: 32,
            fontWeight: 700,
            color: SHARE_COLORS.textTertiary,
            letterSpacing: 8,
            textTransform: 'uppercase',
            marginTop: 28,
            lineHeight: 1.4,
          }}>
            {statUnit}
          </div>
        )}
      </div>

      {/* ──── Chess board ──── */}
      <div style={{
        position: 'absolute',
        top: 980,
        left: '50%',
        marginLeft: -360,
        width: 720,
        height: 720,
        borderRadius: 16,
        overflow: 'hidden',
        boxShadow: '0 16px 48px rgba(0,0,0,0.45)',
        outline: `1px solid ${rgba('#ffffff', 0.06)}`,
      }}>
        <ThemedChessboard
          position={board.fen}
          boardOrientation={board.orientation}
          arePiecesDraggable={false}
          boardWidth={720}
          customBoardStyle={{ borderRadius: 0 }}
        />
      </div>

      {/* ──── Footer game row ──── */}
      <div style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0,0,0,0.28)',
        borderTop: `1px solid ${rgba('#ffffff', 0.06)}`,
        padding: '32px 80px 56px',
        display: 'flex',
        alignItems: 'center',
        gap: 24,
      }}>
        <div style={{
          width: 72,
          height: 72,
          borderRadius: 16,
          backgroundColor: resultBgFill,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}>
          <span style={{ fontSize: 28, fontWeight: 900, color: resultColor, lineHeight: 1 }}>
            {resultLabel}
          </span>
        </div>
        <PlayerAvatar username={opponent.username} size={64} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 34,
            fontWeight: 700,
            color: SHARE_COLORS.text,
            lineHeight: 1.4,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}>
            vs {opponent.username}{' '}
            <span style={{ fontSize: 26, color: SHARE_COLORS.textTertiary, fontWeight: 600 }}>
              ({opponent.rating})
            </span>
          </div>
          <div style={{
            fontSize: 24,
            color: SHARE_COLORS.textTertiary,
            lineHeight: 1.5,
            marginTop: 4,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}>
            {metaLine}
          </div>
        </div>
      </div>
    </div>
  );
}

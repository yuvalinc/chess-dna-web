/**
 * Move Highlight stats overlay — fully orderable sections.
 * Uses hardcoded colors for html2canvas compatibility.
 */
import { Chessboard } from 'react-chessboard';
import { SHARE_COLORS, getQualityColor } from '../share-colors';
import { getBoardTheme } from '@/components/board-themes';
import type { GameRecord } from '@shared/types/game';
import type { MoveAnalysis } from '@shared/types/analysis';
import type { PositionEval } from '@shared/types/engine';
import type { Square } from 'chess.js';

interface Props {
  game: GameRecord;
  move: MoveAnalysis;
  boardThemeId: string;
  format: 'story' | 'feed';
  hasBackground: boolean;
  visibleElements: Set<string>;
  elementOrder: string[];
  caption?: string | null;
  /** Player's chess.com avatar URL. Null if not resolved. */
  avatarUrl?: string | null;
  /** Player's country flag URL (CDN PNG). Null if unknown. */
  flagUrl?: string | null;
}

function formatEval(ev: PositionEval): string {
  if (ev.scoreType === 'mate') return `M${ev.score > 0 ? '+' : ''}${ev.score}`;
  const v = ev.score / 100;
  return (v > 0 ? '+' : '') + v.toFixed(1);
}

const TC_ICONS: Record<string, string> = {
  bullet: '⚡', blitz: '🔥', rapid: '⏱️', daily: '📅',
};

export default function MoveHighlightOverlay({ game, move, boardThemeId, format, hasBackground, visibleElements, elementOrder, caption, avatarUrl, flagUrl }: Props) {
  const isStory = format === 'story';
  const theme = getBoardTheme(boardThemeId);
  const qualityColor = getQualityColor(move.quality);
  const textShadow = hasBackground ? '0 2px 6px rgba(0,0,0,0.9)' : 'none';
  const show = (id: string) => visibleElements.has(id);

  // Story (9:16) scales 1.5× — fills the story canvas properly.
  const S = isStory ? 1.5 : 0.75;
  const boardSize = Math.round(640 * S);
  const from = move.moveUci.slice(0, 2);
  const to = move.moveUci.slice(2, 4);
  const moveLabel = move.color === 'white'
    ? `${move.moveNumber}. ${move.moveSan}`
    : `${move.moveNumber}... ${move.moveSan}`;
  const qualityLabel = move.quality.charAt(0).toUpperCase() + move.quality.slice(1);
  const motif = move.tacticalMotifs.length > 0
    ? move.tacticalMotifs[0].replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
    : null;

  const renderSection = (id: string) => {
    switch (id) {
      case 'branding':
        if (!show(id)) return null;
        return (
          <div key={id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: Math.round(4 * S), textShadow }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: Math.round(12 * S) }}>
              <img
                src="/favicon.png"
                alt=""
                crossOrigin="anonymous"
                style={{
                  width: Math.round(56 * S),
                  height: Math.round(56 * S),
                  borderRadius: Math.round(12 * S),
                  objectFit: 'cover',
                }}
              />
              <span style={{ fontSize: Math.round(34 * S), fontWeight: 800, color: SHARE_COLORS.text, letterSpacing: 1 }}>ChessDNA</span>
            </div>
            <span style={{
              fontSize: Math.round(13 * S),
              color: SHARE_COLORS.textTertiary,
              letterSpacing: 1.5,
              textTransform: 'uppercase',
              fontWeight: 600,
            }}>
              Download on the App Store
            </span>
          </div>
        );

      case 'timeclass':
        if (!show(id)) return null;
        return (
          <span key={id} style={{
            fontSize: Math.round(20 * S), fontWeight: 700, color: SHARE_COLORS.accent,
            padding: `${Math.round(6 * S)}px ${Math.round(16 * S)}px`, borderRadius: 10,
            background: hasBackground ? 'rgba(0,0,0,0.4)' : 'rgba(74,222,128,0.1)',
            textTransform: 'uppercase', letterSpacing: 2, textShadow,
          }}>
            {TC_ICONS[game.timeClass] ?? ''} {game.timeClass}
          </span>
        );

      case 'players':
        if (!show(id)) return null;
        return (
          <div key={id} style={{ textShadow, display: 'flex', alignItems: 'center', gap: 14 }}>
            <span style={{ fontSize: Math.round(32 * S), fontWeight: 600, color: SHARE_COLORS.text }}>vs {game.opponent.username}</span>
            <span style={{ fontSize: Math.round(24 * S), color: SHARE_COLORS.textTertiary }}>({game.opponent.rating})</span>
          </div>
        );

      case 'avatar':
        if (!show(id) || !avatarUrl) return null;
        return (
          <img
            key={id}
            src={avatarUrl}
            alt=""
            crossOrigin="anonymous"
            style={{
              width: Math.round(110 * S),
              height: Math.round(110 * S),
              borderRadius: '50%',
              objectFit: 'cover',
              border: `${Math.round(4 * S)}px solid ${SHARE_COLORS.accent}`,
              boxShadow: '0 6px 20px rgba(0,0,0,0.4)',
            }}
          />
        );

      case 'country':
        if (!show(id) || !flagUrl) return null;
        return (
          <img
            key={id}
            src={flagUrl}
            alt=""
            crossOrigin="anonymous"
            style={{
              width: Math.round(80 * S),
              height: 'auto',
              borderRadius: Math.round(6 * S),
              boxShadow: '0 3px 10px rgba(0,0,0,0.4)',
            }}
          />
        );

      case 'board':
        // Board + move label always render (can't be toggled off)
        return (
          <div key={id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: Math.round(20 * S) }}>
            <div style={{ width: boardSize, height: boardSize, flexShrink: 0, borderRadius: 10, overflow: 'hidden', boxShadow: '0 6px 32px rgba(0,0,0,0.5)' }}>
              <div dir="ltr">
                <Chessboard position={move.fenAfter} boardWidth={boardSize} arePiecesDraggable={false} animationDuration={0}
                  customDarkSquareStyle={{ backgroundColor: theme.darkSquare }} customLightSquareStyle={{ backgroundColor: theme.lightSquare }}
                  customBoardStyle={{ borderRadius: '8px' }}
                  customArrows={[[from as Square, to as Square, 'rgba(255,170,0,0.8)'] as [Square, Square, string]]}
                  boardOrientation={game.player.color} />
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: Math.round(20 * S), textShadow }}>
              <span style={{ fontSize: Math.round(68 * S), fontWeight: 900, color: SHARE_COLORS.text }}>{moveLabel}</span>
              <span style={{ fontSize: Math.round(28 * S), fontWeight: 700, color: qualityColor, padding: `${Math.round(8 * S)}px ${Math.round(22 * S)}px`, borderRadius: 14, background: hasBackground ? 'rgba(0,0,0,0.4)' : `${qualityColor}15` }}>{qualityLabel}</span>
            </div>
            {(motif || move.phase) && (
              <div style={{ fontSize: Math.round(22 * S), color: SHARE_COLORS.textTertiary, textShadow, textTransform: 'capitalize' }}>{motif || move.phase}</div>
            )}
          </div>
        );

      case 'accuracy':
        if (!show(id)) return null;
        return (
          <div key={id} style={{ display: 'flex', alignItems: 'center', gap: Math.round(16 * S), textShadow }}>
            <span style={{ fontSize: Math.round(32 * S), color: SHARE_COLORS.textSecondary, fontFamily: 'monospace' }}>{formatEval(move.evalBefore)}</span>
            <span style={{ fontSize: Math.round(26 * S), color: SHARE_COLORS.textTertiary }}>→</span>
            <span style={{ fontSize: Math.round(32 * S), color: SHARE_COLORS.textSecondary, fontFamily: 'monospace' }}>{formatEval(move.evalAfter)}</span>
          </div>
        );

      case 'caption':
        if (!show(id) || !caption) return null;
        return (
          <div key={id} style={{ maxWidth: Math.round(620 * S), textAlign: 'center', padding: `${Math.round(12 * S)}px ${Math.round(16 * S)}px 0` }}>
            <div style={{ fontSize: Math.round(22 * S), fontStyle: 'italic', color: 'rgba(255,255,255,0.75)', lineHeight: 1.5, textShadow: hasBackground ? '0 2px 8px rgba(0,0,0,0.9)' : '0 1px 2px rgba(0,0,0,0.3)', letterSpacing: 0.5, fontFamily: 'Georgia, "Times New Roman", serif' }}>
              &ldquo;{caption}&rdquo;
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  // Ensure 'board' is in the order (it's always rendered)
  const fullOrder = elementOrder.includes('board') ? elementOrder : [...elementOrder.slice(0, 2), 'board', ...elementOrder.slice(2)];

  return (
    <div style={{
      position: 'absolute', inset: 0,
      display: 'flex', flexDirection: 'column',
      justifyContent: 'center', alignItems: 'center',
      padding: isStory ? '80px 40px 80px' : '28px 28px 36px',
      gap: Math.round(20 * S),
    }}>
      {fullOrder.map(id => renderSection(id))}
    </div>
  );
}

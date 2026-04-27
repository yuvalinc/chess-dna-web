/**
 * Sequence overlay — animated replay of N moves leading into a target move.
 *
 * Exposes an imperative handle so the composer's Play button and the video
 * recorder can both drive playback deterministically.
 *
 * When the final frame's position is checkmate, a red radial glow is painted
 * over the mated king's square + a "CHECKMATE" banner appears (chess.com style).
 */
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Chessboard } from 'react-chessboard';
import { Chess } from 'chess.js';
import type { Square } from 'chess.js';
import { SHARE_COLORS } from '../share-colors';
import { getBoardTheme } from '@/components/board-themes';
import { playChessSound, type SoundType } from '@shared/utils/chess-sounds';
import type { GameRecord } from '@shared/types/game';
import type { MoveAnalysis } from '@shared/types/analysis';

interface Props {
  game: GameRecord;
  frames: MoveAnalysis[];
  boardThemeId: string;
  format: 'story' | 'feed';
  hasBackground: boolean;
  visibleElements: Set<string>;
  elementOrder: string[];
  caption?: string | null;
  /** ms per move frame (the final mate frame adds extra hold). */
  speedMs: number;
  avatarUrl?: string | null;
  flagUrl?: string | null;
}

export interface SequenceHandle {
  /** Play from current frame; resolves when playback reaches the final frame. */
  play: () => Promise<void>;
  /** Jump to a specific frame index (optionally with move sound). */
  seek: (i: number, opts?: { playSound?: boolean }) => void;
  /** Reset to frame 0. */
  reset: () => void;
  /** Number of frames (including final). */
  frameCount: number;
  /** Is the final frame a checkmate? */
  isCheckmate: boolean;
  /** Extra hold ms applied on the final frame. */
  finalHoldMs: number;
  /** Route subsequent sounds to this destination (e.g. MediaRecorder capture). Null resets to speakers. */
  setAudioDestination: (dest: AudioNode | null) => void;
  /** Enter/exit "recording mode" — disables the chessboard piece-slide
   *  animation so html2canvas snapshots can never catch a capture mid-frame
   *  (which made captured + capturing pieces appear stacked in the video). */
  setRecordingMode: (on: boolean) => void;
}

const TC_ICONS: Record<string, string> = {
  bullet: '\u26A1', blitz: '\uD83D\uDD25', rapid: '\u23F1\uFE0F', daily: '\uD83D\uDCC5',
};

/** Find both king squares: { loser: side-to-move king, winner: the other king }. */
function findKingSquares(fen: string): { loser: Square | null; winner: Square | null } {
  try {
    const chess = new Chess(fen);
    const loserColor = chess.turn(); // side-to-move is the one in checkmate
    const board = chess.board();
    let loser: Square | null = null;
    let winner: Square | null = null;
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const piece = board[r][f];
        if (!piece || piece.type !== 'k') continue;
        const sq = ('abcdefgh'[f] + (8 - r)) as Square;
        if (piece.color === loserColor) loser = sq;
        else winner = sq;
      }
    }
    return { loser, winner };
  } catch {
    return { loser: null, winner: null };
  }
}

function isCheckmateFen(fen: string): boolean {
  try {
    const chess = new Chess(fen);
    return chess.isCheckmate();
  } catch {
    return false;
  }
}

const SequenceHighlightOverlay = forwardRef<SequenceHandle, Props>(function SequenceHighlightOverlay(
  { game, frames, boardThemeId, format, hasBackground, visibleElements, elementOrder, caption, speedMs, avatarUrl, flagUrl },
  ref,
) {
  const isStory = format === 'story';
  const theme = getBoardTheme(boardThemeId);
  const show = (id: string) => visibleElements.has(id);
  // Story format (9:16) gets a 1.5× scale so the board + text fill the
  // 1080×1920 canvas the way IG/TikTok expect. Feed (1:1) keeps the
  // denser 0.75 layout since we have less vertical room.
  const S = isStory ? 1.5 : 0.75;
  const boardSize = Math.round(640 * S);
  const textShadow = hasBackground ? '0 2px 6px rgba(0,0,0,0.9)' : 'none';

  const [frameIndex, setFrameIndex] = useState(0);
  // When the recorder is active we snap pieces to their squares without
  // animation, so captured pieces never visually linger under the
  // capturing piece in the exported video.
  const [recordingMode, setRecordingMode] = useState(false);
  const safeIndex = Math.min(Math.max(frameIndex, 0), Math.max(frames.length - 1, 0));
  const current = frames[safeIndex];

  const finalFrame = frames[frames.length - 1];
  const isMate = useMemo(() => {
    if (!finalFrame) return false;
    if (finalFrame.evalAfter?.scoreType === 'mate' && finalFrame.evalAfter.score === 0) return true;
    return isCheckmateFen(finalFrame.fenAfter);
  }, [finalFrame]);
  const kingSquares = useMemo(
    () => (isMate && finalFrame ? findKingSquares(finalFrame.fenAfter) : { loser: null, winner: null }),
    [isMate, finalFrame],
  );

  const isFinalFrame = safeIndex === frames.length - 1;
  const showMateFlourish = isFinalFrame && isMate;
  // 3-second hold on the final frame so the user has time to read the
  // mate flourish / final move card before the loop ends.
  const FINAL_HOLD_MS = 3000;

  // Drive playback via an imperative handle so recorder + UI Play button agree.
  const playTokenRef = useRef(0);
  const audioDestRef = useRef<AudioNode | null>(null);

  const soundForFrame = (idx: number): SoundType => {
    const m = frames[idx];
    if (!m) return 'move';
    const isLast = idx === frames.length - 1;
    if (isLast && isMate) return 'checkmate';
    if (m.isCapture) return 'capture';
    if (m.isCastling) return 'castle';
    if (m.isCheck) return 'check';
    return 'move';
  };

  const playSoundFor = (idx: number) => {
    try {
      playChessSound(soundForFrame(idx), audioDestRef.current ?? undefined);
    } catch { /* ignore */ }
  };

  useImperativeHandle(
    ref,
    () => ({
      play: async () => {
        const token = ++playTokenRef.current;
        for (let i = 0; i < frames.length; i++) {
          if (playTokenRef.current !== token) return;
          setFrameIndex(i);
          playSoundFor(i);
          const hold = i === frames.length - 1 ? speedMs + FINAL_HOLD_MS : speedMs;
          await new Promise((r) => setTimeout(r, hold));
        }
      },
      seek: (i: number, opts?: { playSound?: boolean }) => {
        // Note: deliberately does NOT increment playTokenRef. Callers like
        // the background MP4 prep loop rely on seek() to step through
        // frames during a live `play()` invocation; if seek() cancelled
        // play() the Preview button would silently die mid-loop.
        const clamped = Math.min(Math.max(i, 0), Math.max(frames.length - 1, 0));
        setFrameIndex(clamped);
        if (opts?.playSound) playSoundFor(clamped);
      },
      reset: () => {
        playTokenRef.current++;
        setFrameIndex(0);
      },
      frameCount: frames.length,
      isCheckmate: isMate,
      finalHoldMs: FINAL_HOLD_MS,
      setAudioDestination: (dest: AudioNode | null) => {
        audioDestRef.current = dest;
      },
      setRecordingMode: (on: boolean) => setRecordingMode(on),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [frames, speedMs, isMate],
  );

  // If the frames array changes (user changed slider), reset to 0.
  useEffect(() => {
    playTokenRef.current++;
    setFrameIndex(0);
  }, [frames]);

  if (!current) return null;

  const from = current.moveUci.slice(0, 2);
  const to = current.moveUci.slice(2, 4);

  // Position helper — map algebraic square to pixel rect on the board.
  const squareRect = (square: Square | null) => {
    if (!square) return null;
    const file = square.charCodeAt(0) - 'a'.charCodeAt(0); // 0..7
    const rank = parseInt(square[1], 10) - 1; // 0..7
    const orientation = game.player.color;
    const x = orientation === 'white' ? file : 7 - file;
    const y = orientation === 'white' ? 7 - rank : rank;
    const sq = boardSize / 8;
    return { left: x * sq, top: y * sq, width: sq, height: sq };
  };
  const loserRect = showMateFlourish ? squareRect(kingSquares.loser) : null;
  const winnerRect = showMateFlourish ? squareRect(kingSquares.winner) : null;

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
            {/* Tiny download CTA tagline */}
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
        return (
          <div key={id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: Math.round(20 * S) }}>
            <div style={{ position: 'relative', width: boardSize, height: boardSize, flexShrink: 0, borderRadius: 10, overflow: 'hidden', boxShadow: '0 6px 32px rgba(0,0,0,0.5)' }}>
              <div dir="ltr">
                <Chessboard
                  position={current.fenAfter}
                  boardWidth={boardSize}
                  arePiecesDraggable={false}
                  animationDuration={recordingMode ? 0 : Math.min(150, Math.max(80, Math.round(speedMs * 0.25)))}
                  customDarkSquareStyle={{ backgroundColor: theme.darkSquare }}
                  customLightSquareStyle={{ backgroundColor: theme.lightSquare }}
                  customBoardStyle={{ borderRadius: '8px' }}
                  customArrows={[[from as Square, to as Square, 'rgba(255,170,0,0.85)'] as [Square, Square, string]]}
                  boardOrientation={game.player.color}
                />
              </div>
              {/* Checkmate red glow on the LOSING king's square */}
              {showMateFlourish && loserRect && (
                <div
                  style={{
                    position: 'absolute',
                    ...loserRect,
                    pointerEvents: 'none',
                    background: 'radial-gradient(circle, rgba(239,68,68,0.85) 0%, rgba(239,68,68,0.55) 45%, rgba(239,68,68,0) 75%)',
                    mixBlendMode: 'screen',
                  }}
                />
              )}
              {/* Green glow on the WINNING king's square */}
              {showMateFlourish && winnerRect && (
                <div
                  style={{
                    position: 'absolute',
                    ...winnerRect,
                    pointerEvents: 'none',
                    background: 'radial-gradient(circle, rgba(74,222,128,0.85) 0%, rgba(74,222,128,0.55) 45%, rgba(74,222,128,0) 75%)',
                    mixBlendMode: 'screen',
                  }}
                />
              )}
              {/* Checkmate banner */}
              {showMateFlourish && (
                <div style={{
                  position: 'absolute',
                  top: Math.round(16 * S),
                  left: '50%',
                  transform: 'translateX(-50%)',
                  padding: `${Math.round(8 * S)}px ${Math.round(22 * S)}px`,
                  background: '#ef4444',
                  color: '#fff',
                  fontSize: Math.round(22 * S),
                  fontWeight: 900,
                  letterSpacing: 3,
                  borderRadius: 10,
                  boxShadow: '0 6px 20px rgba(0,0,0,0.5)',
                  whiteSpace: 'nowrap',
                }}>
                  CHECKMATE
                </div>
              )}
            </div>
            {/* Full sequence move list — single row, all moves same size,
                current move highlighted only via color + pill (no size change). */}
            <div style={{
              display: 'flex', flexWrap: 'nowrap', justifyContent: 'center',
              alignItems: 'center', gap: Math.round(10 * S),
              textShadow, maxWidth: Math.round(boardSize),
              overflow: 'hidden',
            }}>
              {frames.map((m, i) => {
                const label = m.color === 'white'
                  ? `${m.moveNumber}. ${m.moveSan}`
                  : `${m.moveNumber}\u2026 ${m.moveSan}`;
                const isCurrent = i === safeIndex;
                return (
                  <span key={i} style={{
                    fontSize: Math.round(28 * S),
                    fontWeight: isCurrent ? 800 : 600,
                    whiteSpace: 'nowrap',
                    color: isCurrent ? SHARE_COLORS.text : SHARE_COLORS.textTertiary,
                    padding: `${Math.round(3 * S)}px ${Math.round(10 * S)}px`,
                    borderRadius: Math.round(8 * S),
                    background: isCurrent ? 'rgba(74,222,128,0.18)' : 'transparent',
                    border: isCurrent ? `${Math.round(1.5 * S)}px solid rgba(74,222,128,0.45)` : `${Math.round(1.5 * S)}px solid transparent`,
                    transition: 'all 0.18s ease',
                  }}>{label}</span>
                );
              })}
            </div>
          </div>
        );

      case 'caption':
        if (!show(id) || !caption) return null;
        return (
          <div key={id} style={{ maxWidth: Math.round(700 * S), textAlign: 'center', padding: `${Math.round(20 * S)}px ${Math.round(16 * S)}px 0` }}>
            <div style={{
              fontSize: Math.round(44 * S), fontStyle: 'italic', fontWeight: 600,
              color: '#fff',
              lineHeight: 1.25,
              textShadow: hasBackground ? '0 3px 14px rgba(0,0,0,0.9)' : '0 2px 4px rgba(0,0,0,0.5)',
              letterSpacing: 0, fontFamily: 'Georgia, "Times New Roman", serif',
            }}>
              &ldquo;{caption}&rdquo;
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  const fullOrder = elementOrder.includes('board')
    ? elementOrder
    : [...elementOrder.slice(0, 2), 'board', ...elementOrder.slice(2)];

  return (
    <div style={{
      position: 'absolute', inset: 0,
      display: 'flex', flexDirection: 'column',
      justifyContent: 'center', alignItems: 'center',
      padding: isStory ? '80px 40px 80px' : '28px 28px 36px',
      gap: Math.round(20 * S),
    }}>
      {fullOrder.map((id) => renderSection(id))}
    </div>
  );
});

export default SequenceHighlightOverlay;

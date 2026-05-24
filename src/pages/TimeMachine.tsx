import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { useChessData } from '@/contexts/ChessDataContext';
import { useAuth } from '@/contexts/AuthContext';
import { useTutorial } from '@/contexts/TutorialContext';
import { useTheme } from '@/components/ThemeContext';
import { useToast } from '@/components/Toast';
import ThemedChessboard from '@/components/ThemedChessboard';
import PlayerAvatar from '@/components/PlayerAvatar';
import { useResponsiveBoardSize } from '@/hooks/useResponsiveBoardSize';
import { useTimeMachineChallenge } from '@/hooks/useTimeMachineChallenge';
import { playChessSound } from '@/shared/utils/chess-sounds';
import type { MoveAnalysis } from '@shared/types/analysis';
import { Chess } from 'chess.js';
import type { Square } from 'chess.js';
import ExplanationText from '@/components/ExplanationText';
import type { ChallengeConfig, RankedMove } from '@/hooks/useTimeMachineChallenge';
import { useT } from '@/i18n/index';
import type { TranslationKey } from '@/i18n/index';
import { getThemeDescription } from '@/patterns/pattern-engine';
import type { WeaknessTheme } from '@shared/types/patterns';
import { useActivePrompt } from '@/hooks/useActivePrompt';
import { importChessComGames } from '@/api/chess-com-import';
import { fetchChessCom } from '@/api/chess-com-fetch';
import { CHESS_COM_API_BASE } from '@shared/constants';

/* ── Helpers ── */

function patternLabel(theme: string, t?: (key: TranslationKey) => string): string {
  const PATTERN_KEYS: Record<string, TranslationKey> = {
    missed_fork: 'pattern_missed_fork', missed_pin: 'pattern_missed_pin', missed_skewer: 'pattern_missed_skewer',
    hanging_piece: 'pattern_hanging_piece', back_rank_weakness: 'pattern_back_rank', missed_tactic_other: 'pattern_missed_tactic',
    pawn_structure: 'pattern_pawn_structure', piece_activity: 'pattern_positional_error', king_safety: 'pattern_king_safety',
    space_control: 'pattern_space_control', opening_inaccuracy: 'pattern_opening_inaccuracy', opening_specific: 'pattern_opening_issue',
    middlegame_tactics: 'pattern_missed_tactic', endgame_technique: 'pattern_endgame_technique',
    endgame_pawn_play: 'pattern_endgame_pawns', time_pressure_blunder: 'pattern_time_pressure',
  };
  const key = PATTERN_KEYS[theme];
  if (key && t) return t(key);
  if (key) {
    // Fallback English values
    const fallback: Record<string, string> = {
      missed_fork: 'Missed Fork', missed_pin: 'Missed Pin', missed_skewer: 'Missed Skewer',
      hanging_piece: 'Hanging Pieces', back_rank_weakness: 'Back Rank', missed_tactic_other: 'Missed Tactic',
      pawn_structure: 'Pawn Structure', piece_activity: 'Positional Error', king_safety: 'King Safety',
      space_control: 'Space Control', opening_inaccuracy: 'Opening Inaccuracy', opening_specific: 'Opening Issue',
      middlegame_tactics: 'Middlegame Tactics', endgame_technique: 'Endgame Technique',
      endgame_pawn_play: 'Endgame Pawns', time_pressure_blunder: 'Time Pressure',
    };
    return fallback[theme] ?? theme.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }
  return theme.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

type SkillCategory = 'all' | 'Tactics' | 'Defense' | 'Endgame' | 'Opening' | 'Positional';

/** Map a pattern theme to its matching position category.
 *  MUST stay consistent with categoryFromMove() + themeFromMove().
 *  Also handles every WeaknessTheme enum value emitted by the pattern
 *  engine so retro-CTA preselection can land on the right category
 *  even when themeFromMove doesn't produce that exact theme. */
function getCategory(theme: string): SkillCategory {
  if ([
    'missed_fork', 'missed_pin', 'missed_skewer', 'missed_tactic_other',
    'middlegame_tactics',
  ].includes(theme)) return 'Tactics';
  if ([
    'hanging_piece', 'back_rank_weakness', 'king_safety',
    'time_pressure_blunder',
  ].includes(theme)) return 'Defense';
  if ([
    'endgame_technique', 'endgame_pawn_play',
  ].includes(theme)) return 'Endgame';
  if ([
    'opening_inaccuracy', 'opening_specific',
  ].includes(theme)) return 'Opening';
  return 'Positional';
}

const CATEGORY_COLORS: Record<string, { bg: string; text: string }> = {
  Tactics: { bg: 'bg-red-500/15', text: 'text-red-400' },
  Defense: { bg: 'bg-blue-500/15', text: 'text-blue-400' },
  Endgame: { bg: 'bg-purple-500/15', text: 'text-purple-400' },
  Opening: { bg: 'bg-amber-500/15', text: 'text-amber-400' },
  Positional: { bg: 'bg-gray-500/15', text: 'text-gray-400' },
};

/** Minimal line-art SVG icons for pattern themes */
function PatternIcon({ theme }: { theme: string }) {
  const s = { stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };
  const icons: Record<string, React.ReactNode> = {
    // Fork: two arrows diverging from center
    missed_fork: (
      <svg viewBox="0 0 20 20" width="20" height="20" className="text-gray-400">
        <path d="M10 14V6" {...s} /><path d="M6 3L10 6L14 3" {...s} /><circle cx="10" cy="16" r="1.5" {...s} />
      </svg>
    ),
    // Pin: diagonal line through two pieces
    missed_pin: (
      <svg viewBox="0 0 20 20" width="20" height="20" className="text-gray-400">
        <path d="M4 16L16 4" {...s} /><circle cx="7" cy="13" r="2" {...s} /><circle cx="13" cy="7" r="2" {...s} />
      </svg>
    ),
    // Skewer: arrow piercing through
    missed_skewer: (
      <svg viewBox="0 0 20 20" width="20" height="20" className="text-gray-400">
        <path d="M3 17L17 3" {...s} /><path d="M14 3H17V6" {...s} /><circle cx="8" cy="12" r="2" {...s} />
      </svg>
    ),
    // Hanging piece: piece with down arrow
    hanging_piece: (
      <svg viewBox="0 0 20 20" width="20" height="20" className="text-gray-400">
        <circle cx="10" cy="6" r="3" {...s} /><path d="M10 9V15" {...s} /><path d="M7 12L10 15L13 12" {...s} />
      </svg>
    ),
    // Back rank: castle/rook shape
    back_rank_weakness: (
      <svg viewBox="0 0 20 20" width="20" height="20" className="text-gray-400">
        <path d="M4 17H16V14H4Z" {...s} /><path d="M6 14V8H14V14" {...s} /><path d="M6 8V5H8V7H12V5H14V8" {...s} />
      </svg>
    ),
    // Generic tactic: crosshair
    missed_tactic_other: (
      <svg viewBox="0 0 20 20" width="20" height="20" className="text-gray-400">
        <circle cx="10" cy="10" r="5" {...s} /><circle cx="10" cy="10" r="2" {...s} /><path d="M10 3V5M10 15V17M3 10H5M15 10H17" {...s} />
      </svg>
    ),
    // Pawn structure: three pawns
    pawn_structure: (
      <svg viewBox="0 0 20 20" width="20" height="20" className="text-gray-400">
        <circle cx="5" cy="8" r="2" {...s} /><path d="M3.5 16L5 10L6.5 16" {...s} />
        <circle cx="10" cy="6" r="2" {...s} /><path d="M8.5 16L10 8L11.5 16" {...s} />
        <circle cx="15" cy="8" r="2" {...s} /><path d="M13.5 16L15 10L16.5 16" {...s} />
      </svg>
    ),
    // Piece activity: knight shape
    piece_activity: (
      <svg viewBox="0 0 20 20" width="20" height="20" className="text-gray-400">
        <path d="M6 17H14M7 17V12C7 9 8 7 10 5L12 3C12 3 13 5 12 7L14 8V12L13 17" {...s} />
      </svg>
    ),
    // King safety: shield
    king_safety: (
      <svg viewBox="0 0 20 20" width="20" height="20" className="text-gray-400">
        <path d="M10 2L3 6V10C3 14.4 6 17.5 10 18.5C14 17.5 17 14.4 17 10V6L10 2Z" {...s} />
      </svg>
    ),
    // Space control: grid with arrows
    space_control: (
      <svg viewBox="0 0 20 20" width="20" height="20" className="text-gray-400">
        <rect x="3" y="3" width="14" height="14" rx="1" {...s} /><path d="M10 3V17M3 10H17" {...s} />
        <path d="M7 7L5 5M13 7L15 5M7 13L5 15M13 13L15 15" {...s} />
      </svg>
    ),
    // Opening: book/opening lines
    opening_inaccuracy: (
      <svg viewBox="0 0 20 20" width="20" height="20" className="text-gray-400">
        <path d="M3 4C3 4 6 3 10 4C14 3 17 4 17 4V16C17 16 14 15 10 16C6 15 3 16 3 16V4Z" {...s} />
        <path d="M10 4V16" {...s} />
      </svg>
    ),
    opening_specific: (
      <svg viewBox="0 0 20 20" width="20" height="20" className="text-gray-400">
        <path d="M3 4C3 4 6 3 10 4C14 3 17 4 17 4V16C17 16 14 15 10 16C6 15 3 16 3 16V4Z" {...s} />
        <path d="M10 4V16" {...s} />
      </svg>
    ),
    // Middlegame tactics: crossed swords
    middlegame_tactics: (
      <svg viewBox="0 0 20 20" width="20" height="20" className="text-gray-400">
        <path d="M4 16L14 6" {...s} /><path d="M11 4H16V9" {...s} />
        <path d="M16 16L6 6" {...s} /><path d="M9 4H4V9" {...s} />
      </svg>
    ),
    // Endgame technique: king + pawn
    endgame_technique: (
      <svg viewBox="0 0 20 20" width="20" height="20" className="text-gray-400">
        <path d="M8 3V5M6 4H10" {...s} /><circle cx="8" cy="7" r="2" {...s} /><path d="M5 17L8 9L11 17" {...s} />
        <circle cx="15" cy="10" r="2" {...s} /><path d="M13.5 17L15 12L16.5 17" {...s} />
      </svg>
    ),
    // Endgame pawn play: advancing pawn
    endgame_pawn_play: (
      <svg viewBox="0 0 20 20" width="20" height="20" className="text-gray-400">
        <circle cx="10" cy="8" r="2.5" {...s} /><path d="M7 17L10 10.5L13 17" {...s} />
        <path d="M10 4V2M7 5L10 4L13 5" {...s} />
      </svg>
    ),
    // Time pressure: clock
    time_pressure_blunder: (
      <svg viewBox="0 0 20 20" width="20" height="20" className="text-gray-400">
        <circle cx="10" cy="11" r="7" {...s} /><path d="M10 7V11L13 13" {...s} /><path d="M7 3H13" {...s} />
      </svg>
    ),
  };
  return <>{icons[theme] ?? icons.missed_tactic_other}</>;
}

/** Pattern KPI tile — visually mirrors RowCTA from RecentGames so the
 *  pattern row looks like the game row at a glance. Each tile is its own
 *  rounded card with subtle bg + border, large value on top, label below. */


function severityLabel(cpLoss: number, t?: (key: TranslationKey) => string): { text: string; color: string; bg: string } {
  if (cpLoss >= 200) return { text: t ? t('quality_blunder') : 'Blunder', color: 'text-chess-blunder', bg: 'bg-chess-blunder/15' };
  if (cpLoss >= 100) return { text: t ? t('quality_mistake') : 'Mistake', color: 'text-chess-mistake', bg: 'bg-chess-mistake/15' };
  return { text: t ? t('quality_inaccuracy') : 'Inaccuracy', color: 'text-chess-inaccuracy', bg: 'bg-chess-inaccuracy/15' };
}

/** A flat position item built directly from Stockfish-analyzed moves */
interface PositionItem {
  gameId: string;
  moveIndex: number;
  fen: string;
  category: SkillCategory;
  patternTheme: string; // pattern theme or move-quality-based label
  gameOpponent: string;
  gameRating: number;
  gameTimeClass: string;
  playerColor: 'white' | 'black';
  /** Real best move UCI from Stockfish analysis */
  bestMoveUci: string;
  bestMoveSan: string;
  playedMoveSan: string;
  cpLoss: number;
  phase: string;
}

/** Derive a category from move analysis data */
function categoryFromMove(m: MoveAnalysis): SkillCategory {
  if (m.tacticalMotifs && m.tacticalMotifs.length > 0) return 'Tactics';
  if (m.phase === 'endgame') return 'Endgame';
  if (m.phase === 'opening') return 'Opening';
  if (m.quality === 'blunder') return 'Defense';
  return 'Positional';
}

/** Derive a human-readable theme label from move data.
 *  MUST stay consistent with categoryFromMove() — every theme must map
 *  back to the same category via getCategory(). */
function themeFromMove(m: MoveAnalysis): string {
  if (m.tacticalMotifs && m.tacticalMotifs.length > 0) {
    const motif = m.tacticalMotifs[0];
    if (motif.includes('fork')) return 'missed_fork';
    if (motif.includes('pin')) return 'missed_pin';
    if (motif.includes('skewer')) return 'missed_skewer';
    return 'missed_tactic_other';
  }
  if (m.phase === 'opening') return 'opening_inaccuracy';
  if (m.phase === 'endgame') return 'endgame_technique';
  // Blunder without tactics → hanging piece (Defense)
  if (m.quality === 'blunder') return 'hanging_piece';
  // Mistake/inaccuracy in middlegame without tactics → positional error
  return 'piece_activity';
}

/* ── Ranking Table ── */

interface RankingTableProps {
  title: string;
  moves: RankedMove[];
  loading: boolean;
  playerMoveUci?: string | null;
  originalMoveUci?: string | null;
  bestMoveUci?: string;
  selectedUci: string | null;
  onSelect: (move: RankedMove) => void;
  showPv?: boolean;
  activePvStep?: number;
  onPvStepClick?: (step: number) => void;
}

function RankingTable({ title, moves, loading, playerMoveUci, originalMoveUci, selectedUci, onSelect, showPv, activePvStep = -1, onPvStepClick }: RankingTableProps) {
  const { t } = useT();
  const galleryRef = useRef<HTMLDivElement>(null);

  if (!loading && moves.length === 0) return null;

  const scoreColor = (s: number) => {
    if (s >= 95) return 'text-chess-accent';
    if (s >= 80) return 'text-teal-400';
    if (s >= 65) return 'text-amber-400';
    if (s >= 45) return 'text-orange-400';
    return 'text-red-400';
  };

  const rankBadge = (rank: number) => {
    if (rank === 1) return <span className="text-[10px] font-black text-chess-accent">🥇</span>;
    if (rank === 2) return <span className="text-[10px] font-bold text-gray-400">2</span>;
    if (rank === 3) return <span className="text-[10px] font-bold text-gray-500">3</span>;
    return <span className="text-[10px] text-gray-600">{rank}</span>;
  };

  // Quick-nav helpers — scroll the named move into view in the mobile gallery.
  const scrollToUci = (uci: string | null | undefined) => {
    if (!uci || !galleryRef.current) return;
    const card = galleryRef.current.querySelector(`[data-uci="${uci}"]`) as HTMLElement | null;
    if (card) card.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  };
  const bestUciInList = moves.find(m => m.rank === 1)?.uci;
  const playerUciInList = !!playerMoveUci && moves.some(m => m.uci === playerMoveUci) ? playerMoveUci : null;
  const showQuickNav = !loading && moves.length > 0;

  return (
    <div className="mt-3 border border-white/[0.06] rounded-lg overflow-hidden">
      <div className="px-3 py-1.5 bg-white/[0.03] flex items-center justify-between gap-2">
        <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wide shrink-0">{title}</span>
        <div className="flex items-center gap-1.5">
          {/* Quick-nav pills (mobile only) — tap to scroll the gallery to that
              move. Hidden on desktop where the table shows everything at once. */}
          {showQuickNav && bestUciInList && (
            <button
              onClick={() => scrollToUci(bestUciInList)}
              className="md:hidden text-[10px] px-2 py-1 rounded bg-chess-accent/15 text-chess-accent font-bold hover:bg-chess-accent/25 transition-colors leading-none"
              type="button"
            >
              🥇 {t('tm_badge_best')}
            </button>
          )}
          {showQuickNav && playerUciInList && playerUciInList !== bestUciInList && (
            <button
              onClick={() => scrollToUci(playerUciInList)}
              className="md:hidden text-[10px] px-2 py-1 rounded bg-amber-500/15 text-amber-400 font-bold hover:bg-amber-500/25 transition-colors leading-none"
              type="button"
            >
              👤 {t('tm_badge_you')}
            </button>
          )}
          {loading && <span className="w-3 h-3 border-[1.5px] border-chess-accent border-t-transparent rounded-full animate-spin" />}
        </div>
      </div>

      {/* MOBILE: horizontal gallery — swipe to see all moves. Cards are
          fixed-width so the next one always peeks past the edge fade,
          giving a clear "more to see" affordance without an extra label. */}
      <div className="md:hidden relative">
        <div
          ref={galleryRef}
          className="overflow-x-auto scrollbar-hide flex gap-2 px-3 py-3 snap-x snap-mandatory"
        >
          {moves.map(move => {
            const isPlayer = move.uci === playerMoveUci;
            const isOrig = !!originalMoveUci && move.uci === originalMoveUci && !isPlayer;
            const isBest = move.rank === 1;
            const isSelected = move.uci === selectedUci;

            return (
              <button
                key={move.uci}
                type="button"
                data-uci={move.uci}
                onClick={() => onSelect(move)}
                className={`snap-start shrink-0 w-24 rounded-lg border transition-all flex flex-col items-center text-center px-1.5 py-2.5 ${
                  isSelected
                    ? 'bg-chess-accent/10 border-chess-accent/50 ring-1 ring-chess-accent/30'
                    : isBest
                      ? 'bg-chess-accent/[0.04] border-chess-accent/25'
                      : isPlayer
                        ? 'bg-amber-500/[0.05] border-amber-500/25'
                        : 'bg-white/[0.03] border-white/[0.06]'
                }`}
              >
                {/* rank */}
                <div className="text-[11px] leading-none mb-1.5">
                  {isBest ? <span className="text-base">🥇</span> : <span className="text-gray-500 font-bold">#{move.rank}</span>}
                </div>
                {/* SAN — main identifier */}
                <div className="font-mono font-bold text-base text-chess-text leading-tight">{move.san}</div>
                {/* Priority badge (one per card to keep it compact) */}
                <div className="min-h-[16px] mt-1.5 flex items-center justify-center">
                  {isBest && <span className="text-[9px] px-1.5 py-0.5 rounded bg-chess-accent/15 text-chess-accent font-bold leading-none">{t('tm_badge_best')}</span>}
                  {!isBest && isPlayer && <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 font-bold leading-none">{t('tm_badge_you')}</span>}
                  {!isBest && !isPlayer && isOrig && <span className="text-[9px] px-1.5 py-0.5 rounded bg-chess-blunder/15 text-chess-blunder font-bold leading-none">game</span>}
                </div>
                {/* score */}
                <div className={`text-xl font-black tabular-nums leading-none mt-2 ${scoreColor(move.score)}`}>{move.score}</div>
              </button>
            );
          })}
        </div>
        {/* Right-edge gradient fade — implicit "swipe for more" cue. */}
        {moves.length > 3 && (
          <div className="pointer-events-none absolute end-0 top-0 bottom-0 w-10 bg-gradient-to-l from-chess-bg/80 via-chess-bg/40 to-transparent rtl:bg-gradient-to-r" />
        )}
      </div>

      {/* DESKTOP: full table */}
      <table className="hidden md:table w-full text-[12px]">
        <thead>
          <tr className="border-b border-white/[0.06]">
            <th className="pl-3 pr-1 py-1 w-6" />
            <th className="px-1 py-1 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wide" />
            <th className="px-1 py-1 w-16" />
            <th className="pl-1 pr-3 py-1 w-10 text-right text-[10px] font-semibold text-gray-500 uppercase tracking-wide">%</th>
          </tr>
        </thead>
        <tbody>
          {moves.map(move => {
            const isPlayer = move.uci === playerMoveUci;
            const isOrig = !!originalMoveUci && move.uci === originalMoveUci && !isPlayer;
            const isBest = move.rank === 1;
            const isSelected = move.uci === selectedUci;

            // Build PV chain: alternating player (even) / opponent (odd) moves
            const pvMoves = showPv && move.pvSan.length > 0
              ? move.pvSan.slice(0, 5)
              : null;

            return (
              <tr
                key={move.uci}
                onClick={() => onSelect(move)}
                className={`border-t border-white/[0.04] cursor-pointer transition-colors ${
                  isSelected ? 'bg-chess-accent/10' : 'hover:bg-white/[0.03]'
                }`}
              >
                {/* Rank */}
                <td className="pl-3 pr-1 py-2 w-6 text-center">{rankBadge(move.rank)}</td>

                {/* Move / PV chain */}
                <td className="px-1 py-2 font-mono flex-1">
                  {pvMoves ? (
                    <span className="flex items-center flex-wrap gap-x-0.5">
                      {pvMoves.map((san, i) => {
                        const isActiveStep = isSelected && activePvStep === i;
                        const isClickable = isSelected && onPvStepClick;
                        return (
                          <React.Fragment key={i}>
                            <span
                              onClick={isClickable ? (e) => { e.stopPropagation(); onPvStepClick!(i); } : undefined}
                              className={`
                                ${i % 2 === 0 ? 'font-bold' : 'font-normal text-[11px]'}
                                ${isActiveStep
                                  ? 'text-blue-400 underline underline-offset-2'
                                  : i % 2 === 0 ? 'text-chess-text' : 'text-gray-500'}
                                ${isClickable ? 'cursor-pointer hover:text-blue-300 transition-colors' : ''}
                              `}
                            >{san}</span>
                            {i < pvMoves.length - 1 && (
                              <span className="text-gray-600 text-[10px]">→</span>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </span>
                  ) : (
                    <span className="font-bold text-chess-text">{move.san}</span>
                  )}
                </td>

                {/* Tags */}
                <td className="px-1 py-2 w-16 text-right">
                  <div className="flex items-center justify-end gap-1">
                    {isOrig && (
                      <span className="text-[9px] px-1 py-0.5 rounded bg-chess-blunder/15 text-chess-blunder font-bold leading-none">game</span>
                    )}
                    {isPlayer && (
                      <span className="text-[9px] px-1 py-0.5 rounded bg-amber-500/15 text-amber-400 font-bold leading-none">{t('tm_badge_you')}</span>
                    )}
                    {isBest && (
                      <span className="text-[9px] px-1 py-0.5 rounded bg-chess-accent/15 text-chess-accent font-bold leading-none">{t('tm_badge_best')}</span>
                    )}
                  </div>
                </td>

                {/* Score */}
                <td className="pl-1 pr-3 py-2 w-10 text-right">
                  <span className={`font-black tabular-nums ${scoreColor(move.score)}`}>{move.score}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
void RankingTable;

/* ── Challenge persistence ── */

const TM_STORAGE_KEY = 'chess-dna-timemachine-progress';

function getChallengeKey(item: PositionItem): string {
  return `${item.gameId}:${item.moveIndex}`;
}

/* Per-challenge play counts. Stored as { plays: { [key]: count } } so we
 * know how many times each challenge was completed. Legacy `checked` map
 * (boolean per key) is migrated to plays = 1 on read. */
function getPlayCounts(): Map<string, number> {
  try {
    const data = localStorage.getItem(TM_STORAGE_KEY);
    if (!data) return new Map();
    const parsed = JSON.parse(data);
    const m = new Map<string, number>();
    if (parsed.plays) {
      for (const [k, v] of Object.entries(parsed.plays)) {
        const n = typeof v === 'number' ? v : 0;
        if (n > 0) m.set(k, n);
      }
    }
    // Migrate any legacy `checked` entries into plays as count 1.
    if (parsed.checked) {
      for (const k of Object.keys(parsed.checked)) {
        if (!m.has(k)) m.set(k, 1);
      }
    }
    return m;
  } catch { return new Map(); }
}

function markChallengeChecked(key: string): void {
  try {
    const data = localStorage.getItem(TM_STORAGE_KEY);
    const parsed = data ? JSON.parse(data) : { plays: {}, checked: {} };
    parsed.plays = parsed.plays ?? {};
    parsed.plays[key] = (parsed.plays[key] ?? 0) + 1;
    // Keep legacy `checked` field in sync for any old code paths still
    // reading it; safe to drop later once nothing else relies on it.
    parsed.checked = parsed.checked ?? {};
    parsed.checked[key] = Date.now();
    localStorage.setItem(TM_STORAGE_KEY, JSON.stringify(parsed));
  } catch { /* ignore */ }
}


const PAGE_SIZE = 20;

const CATEGORY_KEYS: Record<string, TranslationKey> = {
  all: 'category_all',
  Tactics: 'category_tactics',
  Defense: 'category_defense',
  Endgame: 'category_endgame',
  Opening: 'category_opening',
  Positional: 'category_positional',
};

export default function TimeMachine() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const dataSrc = useChessData();
  const { queueForAnalysis, refetchGames } = dataSrc;
  const { isGuest } = useAuth();
  const { settings, updateSettings } = useTheme();
  const { t } = useT();
  const { toast } = useToast();

  // Source tab: which population of games drives the patterns + challenge
  // list.
  //   yours  → the user's own analyzed games (a.k.a. "For you")
  //   following → friends + top players merged into one feed
  const [sourceTab, _setSourceTab] = useState<'yours' | 'following'>('yours');
  const setSourceTab = useCallback((s: 'yours' | 'following') => {
    _setSourceTab(s);
    // Each tab has its own population of games — drop any pattern/category
    // filter from the previous tab so the user lands on the full list.
    setPatternFilter(null);
    setCategoryFilter('all');
    setVisibleCount(PAGE_SIZE);
  }, []);

  // Tracks usernames whose chess.com last game is currently being imported
  // (and whose Stockfish analysis hasn't completed). Used to render a
  // loading indicator on the friend / top-player card.
  const [pendingNonSelfImports, setPendingNonSelfImports] = useState<Set<string>>(() => new Set());
  // username → game IDs that were imported but not yet analyzed. We
  // hold the spinner until at least one of those analyses lands so the
  // user sees "loading" until the replays are actually playable.
  const pendingGameIdsRef = useRef<Map<string, string[]>>(new Map());

  const markPendingImport = useCallback((username: string) => {
    setPendingNonSelfImports((prev) => {
      const next = new Set(prev);
      next.add(username.toLowerCase());
      return next;
    });
  }, []);
  const clearPendingImport = useCallback((username: string) => {
    pendingGameIdsRef.current.delete(username.toLowerCase());
    setPendingNonSelfImports((prev) => {
      if (!prev.has(username.toLowerCase())) return prev;
      const next = new Set(prev);
      next.delete(username.toLowerCase());
      return next;
    });
  }, []);
  const rememberPendingGameIds = useCallback((username: string, ids: string[]) => {
    pendingGameIdsRef.current.set(username.toLowerCase(), ids);
  }, []);

  // When fresh analyses arrive, clear pending state for any username
  // whose imported games are now analyzed — keeps the spinner alive
  // until the replays are actually available, not just imported.
  useEffect(() => {
    if (pendingGameIdsRef.current.size === 0) return;
    const analyzedIds = new Set(dataSrc.allAnalyses.map((a) => a.gameId));
    for (const [username, ids] of Array.from(pendingGameIdsRef.current.entries())) {
      const anyAnalyzed = ids.some((id) => analyzedIds.has(id));
      if (anyAnalyzed) clearPendingImport(username);
    }
  }, [dataSrc.allAnalyses, clearPendingImport]);

  // Reconcile followed/friended usernames against actual imported games.
  // Three responsibilities:
  //   1. New follow → import their last 10 chess.com games + queue for
  //      analysis so a meaningful pool of mistakes shows up.
  //   2. Already-imported games still pending analysis → re-queue.
  //   3. Daily refresh: if it's been > 24h since we last imported games
  //      for a followed player, fetch the latest 10 again so the feed
  //      stays fresh. Per-username TTL is tracked in localStorage.
  const TM_FOLLOW_REFRESH_KEY = 'tm-follow-last-fetch';
  const FOLLOW_REFRESH_TTL_MS = 24 * 60 * 60 * 1000;
  const FOLLOW_GAMES_PER_USER = 10;
  const reconciledRef = useRef(false);
  useEffect(() => {
    if (reconciledRef.current) return;
    if (sourceTab === 'yours') return;
    const allNonSelf = dataSrc.friendGames.concat(dataSrc.topPlayerGames);
    const presentUsernames = new Set(allNonSelf.map((g) => (g.player?.username ?? '').toLowerCase()));
    const targets = [
      ...(settings.friendUsernames ?? []),
      ...(settings.topPlayerUsernames ?? []),
    ];
    // Read per-username last-fetch timestamps from localStorage.
    let lastFetch: Record<string, number> = {};
    try {
      const raw = localStorage.getItem(TM_FOLLOW_REFRESH_KEY);
      if (raw) lastFetch = JSON.parse(raw);
    } catch { /* ignore */ }
    const now = Date.now();
    const missing = targets.filter((u) => !presentUsernames.has(u.toLowerCase()));
    const stale = targets.filter((u) => {
      const lower = u.toLowerCase();
      // Has games already, but the last fetch is older than the TTL.
      if (!presentUsernames.has(lower)) return false;
      const ts = lastFetch[lower] ?? 0;
      return now - ts > FOLLOW_REFRESH_TTL_MS;
    });
    const analysisIds = new Set(dataSrc.allAnalyses.concat(dataSrc.friendAnalyses, dataSrc.topPlayerAnalyses).map((a) => a.gameId));
    const stalled = allNonSelf.filter((g) => g.analysisStatus !== 'complete' || !analysisIds.has(g.id));
    if (missing.length === 0 && stale.length === 0 && stalled.length === 0) return;
    reconciledRef.current = true;
    (async () => {
      for (const u of [...missing, ...stale]) {
        try {
          const ids = await importChessComGames(u, { maxGames: FOLLOW_GAMES_PER_USER, guest: isGuest });
          // Prepend to the analysis queue so the user sees challenges from
          // their newly-followed player within seconds, not minutes.
          if (ids.length > 0) queueForAnalysis(ids, { priority: 'high' });
          lastFetch[u.toLowerCase()] = now;
          // Per-followed-user 10-game cap was wired here, but it depends on
          // a server-side `playerUsername` filter that Base44 silently drops
          // (unknown field on the entity schema). Until the schema is
          // updated, the trim is a noisy no-op at best — re-enable after
          // adding playerUsername to the Game/Analysis schemas in Base44.
        } catch (err) {
          console.warn('[TM] failed to import games for', u, err);
        }
      }
      try { localStorage.setItem(TM_FOLLOW_REFRESH_KEY, JSON.stringify(lastFetch)); } catch { /* ignore */ }
      if (stalled.length > 0) {
        queueForAnalysis(stalled.map((g) => g.id), { priority: 'high' });
      }
      refetchGames();
    })();
  }, [sourceTab, settings.friendUsernames, settings.topPlayerUsernames, dataSrc.friendGames, dataSrc.topPlayerGames, dataSrc.allAnalyses, dataSrc.friendAnalyses, dataSrc.topPlayerAnalyses, isGuest, queueForAnalysis, refetchGames]);

  // Suggested friends — derived from the user's own most-played opponents.
  // chess.com doesn't expose a public friends list, so we use frequency of
  // play as a proxy: the people you face the most are the closest signal
  // to "your friends" we can compute without OAuth.
  const topOpponents = useMemo(() => {
    if (!dataSrc.allGames || dataSrc.allGames.length === 0) return [] as string[];
    const counts = new Map<string, number>();
    for (const g of dataSrc.allGames) {
      const u = g.opponent?.username;
      if (!u || u === '?' || u.toLowerCase() === 'unknown') continue;
      counts.set(u, (counts.get(u) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([u]) => u);
  }, [dataSrc.allGames]);

  // Following = friends + top-players merged into one feed for the
  // unified "Following" tab. Dedup not strictly necessary since friends
  // and top-players are mutually exclusive sets, but kept defensively.
  const followingGames = useMemo(() => {
    const seen = new Set<string>();
    const out: typeof dataSrc.friendGames = [];
    for (const g of [...dataSrc.friendGames, ...dataSrc.topPlayerGames]) {
      if (seen.has(g.id)) continue;
      seen.add(g.id);
      out.push(g);
    }
    return out;
  }, [dataSrc.friendGames, dataSrc.topPlayerGames]);
  const followingAnalyses = useMemo(() => {
    const seen = new Set<string>();
    const out: typeof dataSrc.friendAnalyses = [];
    for (const a of [...dataSrc.friendAnalyses, ...dataSrc.topPlayerAnalyses]) {
      if (seen.has(a.gameId)) continue;
      seen.add(a.gameId);
      out.push(a);
    }
    return out;
  }, [dataSrc.friendAnalyses, dataSrc.topPlayerAnalyses]);

  // Pick the right data source for the active tab.
  const allAnalyses = sourceTab === 'yours' ? dataSrc.allAnalyses : followingAnalyses;
  const allGames = sourceTab === 'yours' ? dataSrc.allGames : followingGames;
  const { buildPrompt } = useActivePrompt();
  const { containerRef: tmBoardRef, boardSize } = useResponsiveBoardSize(700);
  // Track viewport height so the challenge board can be height-constrained
  // (everything fits above the fold without scrolling). 460 reserves
  // roughly: header chips + title + player + phase indicator + replay
  // button + "Your turn" panel + bottom nav + signup strip.
  const [viewportH, setViewportH] = useState(() => typeof window !== 'undefined' ? window.innerHeight : 800);
  useEffect(() => {
    const onResize = () => setViewportH(window.innerHeight);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  void viewportH;

  // The logged-in user's chess.com username (ground truth for color derivation)
  const myUsername = (settings.chesscomUsername ?? '').toLowerCase();

  const [categoryFilter, setCategoryFilter] = useState<SkillCategory>('all');
  const [patternFilter, setPatternFilter] = useState<string | null>(null);
  // Info popup — replaces the long tm_desc paragraph in the header.
  const [infoOpen, setInfoOpen] = useState(false);
  // Per-pattern info popup — opens when the user taps the "i" badge next to
  // a pattern's title. Stores the active theme so we can look up its label
  // and description. null = closed.
  const [infoPatternTheme, setInfoPatternTheme] = useState<WeaknessTheme | null>(null);
  // Refs for each pattern row so we can scroll the active one into view
  // when the user expands it (the page is long; without this the user has
  // to manually scroll up to see the KPIs they just changed).
  // patternRowRefs removed alongside the pattern-impact filter row.
  // Has the *user* started scrolling after a pattern click? Programmatic
  // scrollIntoView (triggered when a pattern is selected) shouldn't count —
  // we capture a baseline scrollY after the smooth-scroll settles, then
  // fade only when the user scrolls past that baseline.
  const [scrolledAway, setScrolledAway] = useState(false);
  const scrollBaselineRef = useRef(0);
  const ignoreScrollUntilRef = useRef(0);
  useEffect(() => {
    const onScroll = () => {
      const now = Date.now();
      if (now < ignoreScrollUntilRef.current) {
        // During programmatic scroll, treat the latest position as the
        // settling baseline so the user has to scroll *past* it.
        scrollBaselineRef.current = window.scrollY;
        return;
      }
      setScrolledAway(window.scrollY > scrollBaselineRef.current + 60);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  // When a pattern is selected (or unselected), reset the badge state and
  // give the smooth scroll ~800ms to settle before we start watching for
  // user-initiated scroll.
  useEffect(() => {
    setScrolledAway(false);
    scrollBaselineRef.current = window.scrollY;
    ignoreScrollUntilRef.current = Date.now() + 800;
  }, [patternFilter]);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  // Combined list shows uncompleted challenges first, completed last (v sign).
  const gridRef = useRef<HTMLDivElement>(null);
  const [cardBoardSize, setCardBoardSize] = useState(() =>
    typeof window !== 'undefined' ? (window.innerWidth < 768 ? window.innerWidth - 32 : Math.min(window.innerWidth - 48, 896)) : 300
  );
  useEffect(() => {
    const update = () => {
      const isMd = window.innerWidth >= 768;
      const gridWidth = gridRef.current?.offsetWidth ?? Math.min(window.innerWidth - 48, 896);
      const size = isMd ? Math.floor((gridWidth - 8) / 2) : window.innerWidth - 32;
      setCardBoardSize(size);
    };
    update();
    window.addEventListener('resize', update);
    const ro = new ResizeObserver(update);
    if (gridRef.current) ro.observe(gridRef.current);
    return () => { window.removeEventListener('resize', update); ro.disconnect(); };
  }, []);
  const [playCounts, setPlayCounts] = useState<Map<string, number>>(() => getPlayCounts());
  const [challengeItem, setChallengeItem] = useState<PositionItem | null>(null);
  const [challengeConfig, setChallengeConfig] = useState<ChallengeConfig | null>(null);

  // Page-level default for how the bot plays during the continuation phase.
  // Persisted to localStorage so the user's choice carries across sessions.
  const [botMode, setBotModeState] = useState<'opponent' | 'engine'>(() => {
    try {
      const v = typeof window !== 'undefined' ? localStorage.getItem('chess-dna-tm-bot-mode') : null;
      return v === 'opponent' ? 'opponent' : 'engine';
    } catch { return 'engine'; }
  });
  const setBotMode = useCallback((m: 'opponent' | 'engine') => {
    setBotModeState(m);
    try { localStorage.setItem('chess-dna-tm-bot-mode', m); } catch { /* noop */ }
  }, []);
  const [botInfoOpen, setBotInfoOpen] = useState(false);
  // Click-outside / Escape closes the info popover.
  useEffect(() => {
    if (!botInfoOpen) return;
    const onDocClick = (e: MouseEvent) => {
      const tgt = e.target as HTMLElement | null;
      if (!tgt?.closest?.('[data-bot-info-root]')) setBotInfoOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setBotInfoOpen(false); };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, [botInfoOpen]);

  // Hybrid Salvage (C) row tracking — a "row" = ROW_SIZE consecutive replays.
  // Results are appended on each completion. After 3 → halfway checkpoint;
  // after 6 → row complete summary.
  const [rowResults, setRowResults] = useState<RowResult[]>([]);
  const [rowEntries, setRowEntries] = useState<Array<{ item: PositionItem; result: RowResult; firstScore: number }>>([]);
  const [rowMilestone, setRowMilestone] = useState<'halfway' | 'complete' | null>(null);

  // Handle navigation state
  const navState = location.state as { preselectedTheme?: string; directChallenge?: { gameId: string; moveIndex: number }; returnTo?: { path: string; moveIndex: number }; gameFilter?: string; autoStart?: boolean; tutorial?: string } | null;
  const preselectedTheme = navState?.preselectedTheme;
  const directChallenge = navState?.directChallenge;
  const returnTo = navState?.returnTo;
  const [gameFilter, setGameFilter] = useState<string | null>(navState?.gameFilter ?? null);
  // `autoStart` flag — used by the tutorial's "Try it" CTA to drop the user
  // into the first matching position automatically. Cleared after consumption
  // so back-navigation doesn't relaunch the same challenge.
  const autoStartFlag = navState?.autoStart === true;
  const autoStartedRef = useRef(false);

  const timeClassFilter = settings.selectedTimeClass ?? null;

  // Build flat list of ALL mistake positions from ALL analyzed games (not limited to Pattern examples)
  const allPositions = useMemo((): PositionItem[] => {
    const items: PositionItem[] = [];
    const gameMap = new Map(allGames.map(g => [g.id, g]));

    // Deduplicate analyses by gameId — keep only the newest (highest analyzedAt)
    // Re-analysis can create multiple Analysis entities for the same game
    const dedupedAnalyses = new Map<string, typeof allAnalyses[0]>();
    for (const a of allAnalyses) {
      const existing = dedupedAnalyses.get(a.gameId);
      if (!existing || (a.analyzedAt ?? 0) > (existing.analyzedAt ?? 0)) {
        dedupedAnalyses.set(a.gameId, a);
      }
    }

    console.log(`[TM COLOR DEBUG] ══════════════════════════════════════`);
    console.log(`[TM COLOR DEBUG] myUsername="${myUsername}" | allGames=${allGames.length} allAnalyses=${allAnalyses.length} deduped=${dedupedAnalyses.size}`);

    for (const analysis of dedupedAnalyses.values()) {
      const game = gameMap.get(analysis.gameId);
      if (!game) continue;
      if (gameFilter && analysis.gameId !== gameFilter) continue;
      // Time-class filter only applies to "Yours" — friends/top-players have
      // a single imported game each and may be in any time class.
      if (sourceTab === 'yours' && timeClassFilter && game.timeClass !== timeClassFilter) continue;

      // ── Ground-truth player color derivation ──
      // Priority 1: username match against myUsername (most reliable)
      // Priority 2: game.player.color from stored game record
      // Priority 3: analysis.summary.playerColor
      const storedPlayerColor = game.player?.color ?? analysis.summary?.playerColor ?? 'white';
      let playerColor: 'white' | 'black' = storedPlayerColor;

      if (myUsername) {
        const playerNameLower = (game.player?.username ?? '').toLowerCase();
        const opponentNameLower = (game.opponent?.username ?? '').toLowerCase();

        if (playerNameLower === myUsername) {
          // Stored correctly — player record IS the user
          playerColor = game.player.color;
          if (playerColor !== storedPlayerColor) {
            console.warn(`[TM COLOR DEBUG] game=${analysis.gameId} username MATCH but color DIFFERS: username="${playerNameLower}" stored="${storedPlayerColor}" corrected="${playerColor}"`);
          }
        } else if (opponentNameLower === myUsername) {
          // Stored BACKWARDS — user is in the opponent record!
          playerColor = game.opponent.color;
          console.error(`[TM COLOR DEBUG] ⚠️  game=${analysis.gameId} USER IS IN OPPONENT RECORD! opponent.username="${opponentNameLower}" opponent.color="${game.opponent.color}" using="${playerColor}" (was="${storedPlayerColor}")`);
        } else {
          // Username not found in either record — log and use stored value
          console.warn(`[TM COLOR DEBUG] game=${analysis.gameId} myUsername="${myUsername}" NOT found in player="${playerNameLower}" or opponent="${opponentNameLower}" — using stored="${storedPlayerColor}"`);
        }
      }

      console.log(`[TM COLOR DEBUG] game=${analysis.gameId} player.username="${game.player?.username}" player.color="${game.player?.color}" summary.playerColor="${analysis.summary?.playerColor}" → USING playerColor="${playerColor}"`);

      for (const move of analysis.moves) {
        if (!move.fenBefore) continue;
        // Validate data consistency: move.color must match FEN side-to-move
        const fenSide = move.fenBefore.split(' ')[1]; // 'w' or 'b'
        const fenColor = fenSide === 'w' ? 'white' : 'black';
        if (move.color !== fenColor) {
          console.warn(`[TM COLOR DEBUG] game=${analysis.gameId} halfMove=${move.halfMoveIndex} DATA MISMATCH: move.color="${move.color}" fenColor="${fenColor}" fen="${move.fenBefore.slice(0, 30)}..." — SKIPPING`);
          continue; // skip inconsistent data
        }
        // Only include the player's own mistakes
        if (move.color !== playerColor) {
          continue;
        }

        // Only mistakes with Stockfish data
        if (move.cpLoss < 50) continue;
        if (move.cpLoss > 5000) continue;
        if (!move.bestMoveUci || move.bestMoveUci.length < 4) continue;
        // Skip when played move IS the best move
        if (move.moveSan === move.bestMoveSan) continue;
        if (move.moveUci === move.bestMoveUci) continue;

        // ── Validate bestMoveUci is actually a legal move for the player ──
        // Corrupted analysis data can store the opponent's best move here.
        {
          let bestMoveValid = false;
          try {
            const tmpChess = new Chess(move.fenBefore);
            const fromSq = move.bestMoveUci.slice(0, 2);
            const toSq = move.bestMoveUci.slice(2, 4);
            const promo = move.bestMoveUci.length > 4 ? move.bestMoveUci[4] as 'q' | 'r' | 'b' | 'n' : undefined;
            const piece = tmpChess.get(fromSq as Square);
            const playerPieceColor = playerColor === 'white' ? 'w' : 'b';
            if (piece && piece.color === playerPieceColor) {
              const result = tmpChess.move({ from: fromSq as Square, to: toSq as Square, promotion: promo });
              bestMoveValid = !!result;
            }
            if (!bestMoveValid) {
              console.warn(`[TM] Skipping move ${move.halfMoveIndex} — bestMoveUci "${move.bestMoveUci}" invalid for ${playerColor} (piece at from: ${piece?.color ?? 'empty'})`);
            }
          } catch { /* skip */ }
          if (!bestMoveValid) continue;
        }

        items.push({
          gameId: analysis.gameId,
          moveIndex: move.halfMoveIndex,
          fen: move.fenBefore,
          category: categoryFromMove(move),
          patternTheme: themeFromMove(move),
          gameOpponent: game.opponent.username,
          gameRating: game.opponent.rating,
          gameTimeClass: game.timeClass,
          playerColor: move.color, // authoritative from chess.js, always matches FEN
          bestMoveUci: move.bestMoveUci,
          bestMoveSan: move.bestMoveSan,
          playedMoveSan: move.moveSan,
          cpLoss: move.cpLoss,
          phase: move.phase ?? 'middlegame',
        });
      }
    }
    // Sort by pattern frequency (most repeated patterns first), then cpLoss within each
    const patternCounts = new Map<string, number>();
    for (const it of items) patternCounts.set(it.patternTheme, (patternCounts.get(it.patternTheme) ?? 0) + 1);
    items.sort((a, b) => {
      const freqDiff = (patternCounts.get(b.patternTheme) ?? 0) - (patternCounts.get(a.patternTheme) ?? 0);
      if (freqDiff !== 0) return freqDiff;
      return b.cpLoss - a.cpLoss;
    });
    return items;
  }, [allGames, allAnalyses, timeClassFilter, gameFilter, sourceTab]);

  useEffect(() => {
    if (!preselectedTheme || allPositions.length === 0) return;
    // Exact theme match — best case, both filters set.
    if (allPositions.some(p => p.patternTheme === preselectedTheme)) {
      setPatternFilter(preselectedTheme);
      setCategoryFilter(getCategory(preselectedTheme));
      return;
    }
    // Fallback — themeFromMove only emits a subset of WeaknessTheme values,
    // so retro-CTA themes like `middlegame_tactics`, `pawn_structure`,
    // `time_pressure_blunder` etc. won't have direct position matches.
    // Land the user on the right CATEGORY at minimum so the filter still
    // narrows the list to relevant positions.
    const targetCategory = getCategory(preselectedTheme);
    if (targetCategory !== 'all' && allPositions.some(p => p.category === targetCategory)) {
      setCategoryFilter(targetCategory);
      // Pick the most-frequent theme inside the target category as a
      // secondary heuristic — better than no theme filter at all.
      const themeCounts = new Map<string, number>();
      for (const p of allPositions) {
        if (p.category !== targetCategory) continue;
        themeCounts.set(p.patternTheme, (themeCounts.get(p.patternTheme) ?? 0) + 1);
      }
      const topTheme = [...themeCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
      setPatternFilter(topTheme ?? null);
    }
  }, [preselectedTheme, allPositions]);

  // People filter — Following tab only. Narrows the challenge grid to a
  // single follower (one of friends + top-players) so the user can binge
  // their replays. null = all followed.
  const [peopleFilter, setPeopleFilter] = useState<string | null>(null);

  // Filter by category, pattern, and (Following tab only) people.
  const filteredPositions = useMemo(() => {
    let list = allPositions;
    if (categoryFilter !== 'all') list = list.filter(p => p.category === categoryFilter);
    if (patternFilter) list = list.filter(p => p.patternTheme === patternFilter);
    if (peopleFilter && sourceTab === 'following') {
      const target = peopleFilter.toLowerCase();
      const gameById = new Map(allGames.map((g) => [g.id, g] as const));
      list = list.filter((p) => {
        const game = gameById.get(p.gameId);
        return (game?.player?.username ?? '').toLowerCase() === target;
      });
    }
    return list;
  }, [allPositions, allGames, categoryFilter, patternFilter, peopleFilter, sourceTab]);

  // Category counts removed alongside the category-filter row.

  // (pattern stats are computed inline in the Pattern Impact section)

  const loadMore = useCallback(() => setVisibleCount(c => c + PAGE_SIZE), []);

  // Start an interactive challenge. Queue advancement is now key-driven
  // (see `pickNextChallenge`), so callers no longer need to pass an index.
  const startChallenge = useCallback((item: PositionItem) => {
    const analysis = allAnalyses.find(a => a.gameId === item.gameId);
    if (!analysis) return;
    const startIdx = Math.max(0, item.moveIndex - 3);
    const originalMove = analysis.moves[item.moveIndex];

    // Verify item consistency before starting
    const fenSide = item.fen.split(' ')[1]; // 'w' or 'b'
    const fenColor = fenSide === 'w' ? 'white' : 'black';
    console.log(`[TM CHALLENGE START] ══════════════════════`);
    console.log(`[TM CHALLENGE START] gameId=${item.gameId} moveIndex=${item.moveIndex}`);
    console.log(`[TM CHALLENGE START] item.playerColor="${item.playerColor}" | fenColor="${fenColor}" | match=${item.playerColor === fenColor}`);
    console.log(`[TM CHALLENGE START] item.fen="${item.fen.slice(0, 40)}..."`);
    console.log(`[TM CHALLENGE START] originalMove.moveSan="${originalMove?.moveSan}" originalMove.moveUci="${originalMove?.moveUci}"`);
    console.log(`[TM CHALLENGE START] bestMoveUci="${item.bestMoveUci}" bestMoveSan="${item.bestMoveSan}"`);
    console.log(`[TM CHALLENGE START] startIndex=${startIdx} criticalIndex=${item.moveIndex}`);
    console.log(`[TM CHALLENGE START] startMove.fenBefore="${analysis.moves[startIdx]?.fenBefore?.slice(0, 40)}..."`);
    if (item.playerColor !== fenColor) {
      console.error(`[TM CHALLENGE START] ⚠️  MISMATCH: item.playerColor="${item.playerColor}" but FEN side="${fenColor}" — this challenge WILL be wrong-side!`);
    }

    setChallengeItem(item);
    setChallengeConfig({
      gameMoves: analysis.moves,
      startIndex: startIdx,
      criticalIndex: item.moveIndex,
      playerColor: item.playerColor, // from move.color — always correct
      opponentRating: item.gameRating,
      bestMoveUci: item.bestMoveUci,
      bestMoveSan: item.bestMoveSan,
      originalMoveUci: originalMove?.moveUci ?? '',
      originalMoveSan: originalMove?.moveSan ?? '',
      botMode,
    });

    // Push sub-URL so each challenge is shareable/bookmarkable
    setSearchParams({ game: item.gameId, move: String(item.moveIndex) }, { replace: false });
  }, [allAnalyses, setSearchParams, botMode]);

  // startNextChallenge defined after uncheckedPositions below

  // Auto-start a specific challenge when navigated from GameDetail
  const directChallengeStartedRef = useRef(false);
  useEffect(() => {
    if (!directChallenge || directChallengeStartedRef.current || allPositions.length === 0) return;
    const match = allPositions.find(p => p.gameId === directChallenge.gameId && p.moveIndex === directChallenge.moveIndex);
    if (match) {
      directChallengeStartedRef.current = true;
      startChallenge(match);
    }
  }, [directChallenge, allPositions, startChallenge]);

  // Auto-start challenge from URL search params (?game=X&move=Y)
  const urlChallengeStartedRef = useRef(false);
  useEffect(() => {
    if (urlChallengeStartedRef.current || allPositions.length === 0 || challengeItem) return;
    const gameId = searchParams.get('game');
    const moveStr = searchParams.get('move');
    if (!gameId || moveStr === null) return;
    const moveIndex = parseInt(moveStr, 10);
    if (isNaN(moveIndex)) return;
    const match = allPositions.find(p => p.gameId === gameId && p.moveIndex === moveIndex);
    if (match) {
      urlChallengeStartedRef.current = true;
      console.log(`[TM URL] Auto-starting challenge from URL: game=${gameId} move=${moveIndex}`);
      startChallenge(match);
    } else {
      console.warn(`[TM URL] No position found for game=${gameId} move=${moveIndex} (allPositions=${allPositions.length})`);
    }
  }, [searchParams, allPositions, challengeItem, startChallenge]);

  // Tutorial autoStart — when arriving from the "Try it →" coachmark with
  // `state.autoStart=true` and a `gameFilter`, drop the user straight into
  // the first matching challenge for that game. Fires once per visit and
  // clears the navigation state so back-navigation doesn't replay it.
  useEffect(() => {
    if (!autoStartFlag || autoStartedRef.current) return;
    if (allPositions.length === 0 || challengeItem) return;
    const gameIdToMatch = navState?.gameFilter;
    if (!gameIdToMatch) return;
    // Pick the least-played position for this game so the user starts
    // on a fresh challenge whenever one exists. Fallback to least-played
    // overall if the gameId has no positions.
    const sortByPlayCount = (a: PositionItem, b: PositionItem) => {
      const ca = playCounts.get(getChallengeKey(a)) ?? 0;
      const cb = playCounts.get(getChallengeKey(b)) ?? 0;
      return ca - cb;
    };
    const matches = allPositions.filter(p => p.gameId === gameIdToMatch).sort(sortByPlayCount);
    const candidate = matches[0] ?? [...allPositions].sort(sortByPlayCount)[0];
    if (!candidate) return;
    autoStartedRef.current = true;
    // Strip the autoStart flag from history so a back-and-forward doesn't
    // re-trigger the auto-launch.
    try {
      const cleared = { ...(window.history.state || {}) };
      if (cleared.usr) delete cleared.usr.autoStart;
      window.history.replaceState(cleared, '');
    } catch { /* ignore */ }
    startChallenge(candidate);
  }, [autoStartFlag, allPositions, challengeItem, navState?.gameFilter, startChallenge, playCounts]);

  // Use the challenge hook
  const { state: challengeState, advanceLeadup, stepBackLeadup, undoMistake, onSquareClick, onPieceDrop, completePromotion, cancelPromotion, retry, replayLeadup, continueAfterScore, revealWithExplanation, requestHint, dismissHint } = useTimeMachineChallenge(challengeConfig, settings ?? undefined, buildPrompt);

  // Auto-dismiss the Step 5 "Your turn" coachmark as soon as the player
  // has actually made a move — keying on `playerMoveSan` (only set after
  // an explicit player move) rather than `phase` keeps us out of brittle
  // transitional states that fire during challenge initialization.
  const { step: tutorialStep, markSeen: tutorialMarkSeen, triggerStep: tutorialTriggerStep } = useTutorial();
  useEffect(() => {
    if (tutorialStep !== 5) return;
    if (challengeState.playerMoveSan) {
      tutorialMarkSeen(5);
    }
  }, [tutorialStep, challengeState.playerMoveSan, tutorialMarkSeen]);

  // Track highlighted square from clicking square refs in explanation text
  const [highlightedSquare, setHighlightedSquare] = useState<string | null>(null);
  // Tracks whether the user is viewing the "Best move" tab in the AI
  // explanation. When true we draw a green arrow on the board pointing at
  // the best move so the user can see it visually, not just read about it.
  const [aiBestTabActive, setAiBestTabActive] = useState(false);

  // Ranked-move preview state (must be top-level, not inside conditional block)
  const [previewUci, setPreviewUci] = useState<string | null>(null);
  const [previewFen, setPreviewFenState] = useState<string | null>(null);
  const [selectedRowUci, setSelectedRowUci] = useState<string | null>(null); // which row is selected
  const [pvStep, setPvStep] = useState<number>(-1);
  void pvStep;
  const [pvChainData, setPvChainData] = useState<{ fens: string[]; ucis: string[] } | null>(null);
  const [expandedContIdx, setExpandedContIdx] = useState<number | null>(null);
  void expandedContIdx;
  // Whether the user has clicked "Show best move" — starts false, gets cleared on phase change.
  const [revealedBest, setRevealedBest] = useState(false);

  // Clear highlight, preview, and Best-move tab state when the challenge or
  // phase changes. `aiBestTabActive` is otherwise only reset by the MoveStack
  // unmount cleanup, which fires too late — the green Best-move arrow can
  // bleed into the next position's leadup/critical phase.
  useEffect(() => {
    setHighlightedSquare(null);
    setPreviewUci(null);
    setSelectedRowUci(null);
    setPvStep(-1);
    setPvChainData(null);
    setPreviewFenState(null);
    setExpandedContIdx(null);
    setRevealedBest(false);
    setAiBestTabActive(false);
  }, [challengeConfig, challengeState.phase]);

  // Once the user touches the leadup scrubber (◀ / ▶) we hand them full
  // control — auto-advance shuts off until they hit the Replay button or a
  // new challenge starts. Reset whenever the active challenge changes.
  const userTookLeadupControlRef = useRef(false);
  useEffect(() => { userTookLeadupControlRef.current = false; }, [challengeConfig]);

  const onLeadupForward = useCallback(() => {
    userTookLeadupControlRef.current = true;
    advanceLeadup();
    // Move sound is fired inside advanceLeadup itself, with the correct
    // variant (capture / castle / move / move-opponent) per move flags.
  }, [advanceLeadup]);

  const onLeadupBack = useCallback(() => {
    userTookLeadupControlRef.current = true;
    stepBackLeadup();
    // Sound is fired inside stepBackLeadup for the un-played move (player /
    // opponent variant, plus capture/castle flags) so rewinding feels as
    // tactile as the forward animation.
  }, [stepBackLeadup]);

  const onLeadupReplay = useCallback(() => {
    userTookLeadupControlRef.current = false;
    replayLeadup();
  }, [replayLeadup]);

  // Auto-advance leadup moves — disabled once the user takes manual control.
  useEffect(() => {
    if (!challengeConfig || challengeState.phase !== 'leadup') return;
    if (userTookLeadupControlRef.current) return;
    const timer = setTimeout(() => {
      advanceLeadup();
      // advanceLeadup plays its own per-move sound (capture/castle/normal).
    }, 800);
    return () => clearTimeout(timer);
  }, [challengeConfig, challengeState.phase, challengeState.moveIndex, advanceLeadup]);

  // Show original mistake briefly, then undo and enter critical phase
  useEffect(() => {
    if (!challengeConfig || challengeState.phase !== 'showMistake') return;
    playChessSound('incorrect');
    const timer = setTimeout(() => {
      undoMistake();
    }, 1200);
    return () => clearTimeout(timer);
  }, [challengeConfig, challengeState.phase, undoMistake]);

  // Hide the bottom nav (DNA / Analyze / Replays tabs) and the time-class
  // filter pill while a challenge is active — the replay flow needs every
  // pixel for the board + AI explanation. Same body-attr mechanism
  // GameDetail uses for its focus mode (CSS rule lives in src/index.css).
  useEffect(() => {
    const inChallenge = !!challengeItem && !!challengeConfig;
    if (inChallenge) document.body.setAttribute('data-focus-mode', 'true');
    else document.body.removeAttribute('data-focus-mode');
    return () => document.body.removeAttribute('data-focus-mode');
  }, [challengeItem, challengeConfig]);

  // Play sounds on score reveal:
  // - Skip sound entirely when user clicked "Reveal answer" (showAnswer + score 0)
  // - Score 100 → celebration sound
  // - Better than original → congrats
  // - Same or worse → negative
  useEffect(() => {
    if (challengeState.phase === 'scored' && challengeState.moveScore !== null) {
      // Don't play sound on reveal (user didn't actually play)
      if (challengeState.showAnswer && challengeState.moveScore === 0) {
        console.log('[TM SOUND] Reveal path — no sound');
        return;
      }

      const score = challengeState.moveScore;
      const playerUci = challengeState.playerMoveUci;
      const origUci = challengeConfig?.originalMoveUci;

      // Same move as original blunder → always negative
      const playedSameMove = !!playerUci && !!origUci && playerUci === origUci;

      // Estimate original move score from cpLoss (ranking is empty at this point — loaded async)
      const cpLoss = challengeItem?.cpLoss ?? 200;
      const origScore =
        cpLoss >= 300 ? 5 :
        cpLoss >= 200 ? 15 :
        cpLoss >= 120 ? 28 :
        cpLoss >= 90  ? 38 : 50;

      console.log(`[TM SOUND] score=${score} cpLoss=${cpLoss} origScore=${origScore} sameMove=${playedSameMove} playerUci=${playerUci} origUci=${origUci}`);

      if (playedSameMove) { console.log('[TM SOUND] → incorrect (same move as original)'); playChessSound('incorrect'); }
      else if (score === 100) { console.log('[TM SOUND] → complete (celebration)'); playChessSound('complete'); }
      else if (score > origScore) { console.log('[TM SOUND] → correct (improved)'); playChessSound('correct'); }
      else { console.log('[TM SOUND] → incorrect (same or worse score)'); playChessSound('incorrect'); }
    }
  }, [challengeState.phase, challengeState.moveScore, challengeState.showAnswer, challengeItem]);

  // Mark challenge as checked on completion — but only when the user
  // actually solved EVERY move of the challenge (all 3 moves played AND
  // each scored >= 50, with no retries). Rows that ended early (checkmate,
  // game ran out of ply) or had any weak score do not earn the ✓ — the
  // user needs a clean sweep across the entire challenge.
  useEffect(() => {
    if (challengeState.phase === 'complete' && challengeItem) {
      // ANY completion (pass or fail) bumps the play count so the
      // challenge moves to the back of the list and won't be replayed
      // before the user has cycled through everything else.
      const key = getChallengeKey(challengeItem);
      markChallengeChecked(key);
      setPlayCounts(prev => {
        const next = new Map(prev);
        next.set(key, (next.get(key) ?? 0) + 1);
        return next;
      });
      // NO sound here — the per-move scoring effect above already played
      // 'complete' / 'correct' / 'incorrect' for the final move. Firing
      // another 'complete' on phase change made the celebration sound
      // play twice on a perfect finish (and clashed with 'incorrect' on
      // a failed finish).
    }
  }, [challengeState.phase, challengeItem, challengeState.moveScores, challengeState.attempts]);

  // Auto-advance from scored → next move (no manual Continue button).
  // Short delay so the score number registers visually, but we DON'T wait
  // for the AI explanation to load — the explanation panel persists into
  // the continuation phase, so the player can keep reading it while making
  // the next move. The 3rd (last) move does NOT auto-advance — the user
  // must click "Next →" on the scored panel to load the next challenge.
  useEffect(() => {
    if (challengeState.phase !== 'scored') return;
    if (challengeState.error) return;
    if (challengeState.moveScores.length >= 3) return;
    const timer = setTimeout(() => {
      continueAfterScore();
    }, 500);
    return () => clearTimeout(timer);
  }, [challengeState.phase, challengeState.error, challengeState.moveScores.length, continueAfterScore]);

  // Resolve a challenge result from the move scores. Win = every move scored
  // ≥90 ("excellent" — within ~10% win-chance loss of the engine's #1) on the
  // first attempt. Demanding an exact-100 on every move marked good moves as
  // failures whenever Stockfish picked a nearby line over the player's
  // equally-strong alternative.
  const resolveChallengeResult = useCallback((moveScores: number[] | null | undefined, attempts = 0): RowResult => {
    if (!moveScores || moveScores.length === 0) return 'loss';
    if (attempts > 0) return 'loss';
    if (moveScores.some(s => s < 90)) return 'loss';
    return 'win';
  }, []);

  // Combined list, ordered so the user always plays the LEAST-played
  // challenges first. New (count = 0) come first, then 1×, 2×, etc.
  // Once everything has been played at least once, replays kick in but
  // still ordered by lowest play count. This guarantees no challenge is
  // repeated before the user has cycled through every available one.
  const displayPositions = useMemo(() => {
    return [...filteredPositions].sort((a, b) => {
      const ca = playCounts.get(getChallengeKey(a)) ?? 0;
      const cb = playCounts.get(getChallengeKey(b)) ?? 0;
      return ca - cb;
    });
  }, [filteredPositions, playCounts]);

  // Picks the next challenge to serve in least-played order. Skips the
  // just-finished challenge so it never repeats back-to-back, and skips
  // anything already played in the current row to keep variety. Falls
  // back through the preferences if no candidate matches, and finally
  // returns null only when the filter has zero positions.
  const pickNextChallenge = useCallback((excludeKey: string | null, sessionKeys: Set<string>): PositionItem | null => {
    if (displayPositions.length === 0) return null;
    const preferred = displayPositions.find(p => {
      const k = getChallengeKey(p);
      return k !== excludeKey && !sessionKeys.has(k);
    });
    if (preferred) return preferred;
    const skipCurrent = displayPositions.find(p => getChallengeKey(p) !== excludeKey);
    if (skipCurrent) return skipCurrent;
    return displayPositions[0] ?? null;
  }, [displayPositions]);

  // Advance flow:
  //  1. Append the just-completed challenge's result to rowResults.
  //  2. If the row hits 3 (halfway) or ROW_SIZE (complete), pause on a
  //     milestone screen instead of starting the next challenge directly.
  //  3. Otherwise, jump straight to the next least-played position.
  const advanceAfterChallenge = useCallback((completedScores: number[] | null | undefined) => {
    const result = resolveChallengeResult(completedScores, challengeState.attempts);
    const firstScore = completedScores && completedScores.length > 0 ? completedScores[0] : 0;
    const completedKey = challengeItem ? getChallengeKey(challengeItem) : null;
    if (challengeItem) {
      setRowEntries(prev => [...prev, { item: challengeItem, result, firstScore }].slice(0, ROW_SIZE));
    }
    setRowResults(prev => {
      const next = [...prev, result].slice(0, ROW_SIZE);
      if (next.length === ROW_SIZE) {
        setRowMilestone('complete');
      } else if (next.length === 3) {
        setRowMilestone('halfway');
      } else {
        const sessionKeys = new Set(rowEntries.map(e => getChallengeKey(e.item)));
        if (completedKey) sessionKeys.add(completedKey);
        const nextChallenge = pickNextChallenge(completedKey, sessionKeys);
        if (nextChallenge) {
          startChallenge(nextChallenge);
        } else {
          setChallengeItem(null);
          setChallengeConfig(null);
        }
      }
      return next;
    });
  }, [pickNextChallenge, startChallenge, resolveChallengeResult, challengeItem, rowEntries, challengeState.attempts]);

  // Continue from a milestone screen → start the next least-played replay.
  const continueFromMilestone = useCallback(() => {
    setRowMilestone(null);
    const completing = rowResults.length >= ROW_SIZE;
    if (completing) {
      setRowResults([]);
      setRowEntries([]);
    }
    const completedKey = challengeItem ? getChallengeKey(challengeItem) : null;
    // After a complete row we reset variety tracking; after halfway we
    // keep the row's keys so the second half stays varied.
    const sessionKeys = completing
      ? new Set<string>()
      : new Set(rowEntries.map(e => getChallengeKey(e.item)));
    if (completedKey && !completing) sessionKeys.add(completedKey);
    const nextChallenge = pickNextChallenge(completedKey, sessionKeys);
    if (nextChallenge) {
      startChallenge(nextChallenge);
    } else {
      setChallengeItem(null);
      setChallengeConfig(null);
    }
  }, [rowResults.length, pickNextChallenge, startChallenge, challengeItem, rowEntries]);

  // Legacy entry point — still used by the list/grid "Start next" affordances.
  // Inside an active challenge, prefer advanceAfterChallenge so row results
  // get tracked and milestone screens fire correctly.
  const startNextChallenge = useCallback(() => {
    const completedKey = challengeItem ? getChallengeKey(challengeItem) : null;
    const sessionKeys = new Set(rowEntries.map(e => getChallengeKey(e.item)));
    if (completedKey) sessionKeys.add(completedKey);
    const nextChallenge = pickNextChallenge(completedKey, sessionKeys);
    if (nextChallenge) {
      startChallenge(nextChallenge);
    } else {
      setChallengeItem(null);
      setChallengeConfig(null);
    }
  }, [pickNextChallenge, startChallenge, challengeItem, rowEntries]);
  void startNextChallenge;

  // Note: no auto-advance from the complete phase — the user explicitly
  // controls when to move on (via the Next button on the last scored panel,
  // or the Next/Back buttons in the complete review).

  const visiblePositionsSlice = displayPositions.slice(0, visibleCount);
  const hasMore = visibleCount < displayPositions.length;

  // Category sorting removed alongside the category-filter UI.

  // Only early-return for the user's own tab \u2014 Friends/Top Players need the
  // full layout so the user can still add usernames or follow players.
  if (allPositions.length === 0 && sourceTab === 'yours') {
    return (
      <div className="text-center py-16">
        <div className="mb-4 opacity-60 flex justify-center text-chess-accent" style={{ width: 56, height: 56, margin: '0 auto 16px' }}>
          <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <circle cx="12" cy="12" r="9" />
            <polygon points="10 8 16 12 10 16" fill="currentColor" stroke="none" />
          </svg>
        </div>
        <div className="flex items-center justify-center gap-2 max-w-xs mx-auto">
          <p className="text-gray-400 text-sm">
            {t('tm_tagline')}
          </p>
          <InfoButton onClick={() => setInfoOpen(true)} />
        </div>
        {infoOpen && <InfoPopup title={t('tm_title')} body={t('tm_desc')} onClose={() => setInfoOpen(false)} />}
      </div>
    );
  }

  /* ── Hybrid Salvage milestones — render between challenges, replacing the
       challenge view until the user dismisses with Continue / Next row. ── */
  if (rowMilestone === 'halfway') {
    const wins = rowResults.filter(r => r === 'win').length;
    const losses = rowResults.filter(r => r === 'loss').length;
    const remaining = ROW_SIZE - rowResults.length;
    return (
      <div className="max-w-[640px] mx-auto px-4 py-6 relative">
        <div className="absolute inset-0 pointer-events-none" style={{
          background: 'radial-gradient(circle at 50% 20%, rgba(74,222,128,0.13), transparent 55%)',
        }} />
        <div className="relative">
          <RunProgress results={rowResults} current={rowResults.length} />

          <div className="text-center mt-6 mb-5">
            <div className="text-[12px] font-extrabold tracking-[1.4px] text-chess-accent">
              HALFWAY · {rowResults.length} OF {ROW_SIZE}
            </div>
            <h2 className="text-[28px] md:text-[34px] font-black text-chess-text mt-2 leading-tight tracking-tight">
              {wins === rowResults.length ? `${wins} saves in a row.` :
               wins > losses ? `${wins} of ${rowResults.length} saved.` :
               `${rowResults.length} positions down.`}
            </h2>
            <div className="text-sm text-chess-text-secondary mt-1.5 font-medium">
              {remaining} more {remaining === 1 ? 'position' : 'positions'} to go.
            </div>
          </div>

          {/* Three mini-board highlights — one per completed position. Tag is
              the pattern label, framed in the win/loss accent colour. The
              board renders into a fixed-height wrapper with overflow-hidden
              so it never bleeds into the label below on narrow viewports. */}
          <div className="grid grid-cols-3 gap-2 mb-4">
            {rowEntries.slice(0, 3).map((entry, i) => {
              const accent = entry.result === 'win' ? 'rgba(74,222,128,0.35)' : 'rgba(248,113,113,0.35)';
              const pattern = patternLabel(entry.item.patternTheme, t).toUpperCase();
              return (
                <div key={i} className="rounded-lg p-2" style={{
                  background: 'rgba(17,24,39,0.6)',
                  border: `1px solid ${accent}`,
                }}>
                  <div className="flex justify-center pointer-events-none rounded overflow-hidden" style={{ height: 80 }}>
                    <ThemedChessboard
                      position={entry.item.fen}
                      boardOrientation={entry.item.playerColor === 'black' ? 'black' : 'white'}
                      arePiecesDraggable={false}
                      boardWidth={80}
                    />
                  </div>
                  <div className="text-[9px] font-extrabold tracking-[0.4px] text-chess-text mt-2 text-center truncate uppercase">
                    #{i+1} · {pattern}
                  </div>
                </div>
              );
            })}
          </div>

          {/* AI nudge — proud tone if winning, info otherwise */}
          <div className="mb-4">
            <AISays tone={wins >= 2 ? 'proud' : 'info'}>
              {wins >= 2
                ? 'A clean half. Stay focused — keep this rhythm into the second half.'
                : 'Halftime reset. The patterns from the misses tend to repeat — watch for them.'}
            </AISays>
          </div>

          <button
            onClick={continueFromMilestone}
            className="w-full py-3.5 rounded-xl font-black text-[15px] text-chess-bg transition-all active:scale-[0.98]"
            style={{
              background: 'linear-gradient(135deg, rgb(74,222,128), rgb(74,222,128) 60%, rgba(74,222,128,0.85))',
              boxShadow: '0 8px 22px rgba(74,222,128,0.35)',
            }}
          >
            Continue · {remaining} to go →
          </button>
        </div>
      </div>
    );
  }

  if (rowMilestone === 'complete') {
    const wins = rowResults.filter(r => r === 'win').length;
    const heroLine = wins === ROW_SIZE
      ? 'Six of six saved.'
      : wins >= ROW_SIZE - 1
        ? `${wins} of ${ROW_SIZE} saved.`
        : wins >= 3
          ? `${wins} of ${ROW_SIZE} held.`
          : `Row complete · ${wins} saved.`;
    const earnedAchievement = wins >= ROW_SIZE - 1; // 5 of 6 unlocks achievement
    return (
      <div className="max-w-[640px] mx-auto px-4 py-5 relative">
        <div className="absolute inset-0 pointer-events-none" style={{
          background: 'radial-gradient(circle at 50% 20%, rgba(74,222,128,0.18), transparent 50%), radial-gradient(circle at 80% 60%, rgba(251,191,36,0.10), transparent 45%)',
        }} />
        <div className="relative">
          {/* Header with close → back to list */}
          <div className="flex items-center gap-2 mb-4">
            <button
              onClick={() => {
                setRowMilestone(null);
                setRowResults([]);
                setRowEntries([]);
                setChallengeItem(null);
                setChallengeConfig(null);
                setSearchParams({});
              }}
              className="w-8 h-8 rounded-lg bg-chess-surface border border-chess-border/40 text-chess-text inline-flex items-center justify-center text-lg leading-none hover:bg-chess-surface/80 transition-all"
              aria-label="Back to list"
            >×</button>
            <span className="text-[12px] font-extrabold tracking-[0.8px] text-chess-text-tertiary">
              ROW COMPLETE
            </span>
          </div>

          {/* Hero */}
          <div className="text-center mb-4">
            <div className="text-[12px] font-extrabold tracking-[1.4px]" style={{ color: 'rgb(251,191,36)' }}>
              {challengeItem ? patternLabel(challengeItem.patternTheme, t).toUpperCase() : 'REPLAY ROW'}
            </div>
            <h2 className="text-[34px] md:text-[40px] font-black text-chess-text mt-2 leading-[1.05] tracking-tight">
              {heroLine}
            </h2>
          </div>

          {/* Full progress bar */}
          <div className="mb-4">
            <RunProgress results={rowResults} current={ROW_SIZE - 1} />
          </div>

          {/* Achievement card — only when 5 of 6 or better */}
          {earnedAchievement && (
            <div
              className="rounded-xl p-3.5 mb-3 relative overflow-hidden"
              style={{
                background: 'linear-gradient(135deg, rgba(251,191,36,0.13), transparent 70%)',
                border: '1px solid rgba(251,191,36,0.4)',
              }}
            >
              <div className="absolute -right-5 -top-5 w-20 h-20 rounded-full" style={{
                background: 'rgba(251,191,36,0.10)', filter: 'blur(20px)',
              }} />
              <div className="flex gap-3 items-center relative">
                <div
                  className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0"
                  style={{
                    background: 'rgb(251,191,36)',
                    color: 'rgb(10,15,26)',
                    boxShadow: '0 0 18px rgba(251,191,36,0.4)',
                  }}
                >
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M6 3h12v5a6 6 0 0 1-12 0z" />
                    <path d="M6 5H3v2a3 3 0 0 0 3 3" />
                    <path d="M18 5h3v2a3 3 0 0 1-3 3" />
                    <path d="M10 14h4v3l1 3H9l1-3z" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] font-extrabold tracking-[0.8px]" style={{ color: 'rgb(251,191,36)' }}>
                    ACHIEVEMENT UNLOCKED
                  </div>
                  <div className="text-[16px] font-black text-chess-text mt-0.5">
                    Replay Row Cleared
                  </div>
                  <div className="text-[12px] text-chess-text-secondary mt-0.5 leading-snug">
                    Save {ROW_SIZE - 1}+ of {ROW_SIZE} positions in one row.
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Highlight card — pick the highest-scoring win to feature. */}
          {(() => {
            const candidates = rowEntries.filter(e => e.result === 'win');
            if (candidates.length === 0) return null;
            const highlight = candidates.reduce((a, b) => b.firstScore > a.firstScore ? b : a, candidates[0]);
            const positionIdx = rowEntries.indexOf(highlight) + 1;
            const pattern = patternLabel(highlight.item.patternTheme, t);
            return (
              <div className="rounded-xl p-3 mb-3" style={{
                background: 'rgba(17,24,39,0.6)',
                border: '1px solid rgba(30,58,95,0.4)',
              }}>
                <div className="text-[10px] font-extrabold tracking-[0.7px] text-chess-text-tertiary mb-2">
                  HIGHLIGHT
                </div>
                <div className="flex gap-3 items-center">
                  <div className="shrink-0 pointer-events-none" style={{ width: 76, height: 76 }}>
                    <ThemedChessboard
                      position={highlight.item.fen}
                      boardOrientation={highlight.item.playerColor === 'black' ? 'black' : 'white'}
                      arePiecesDraggable={false}
                      boardWidth={76}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-extrabold text-chess-text">
                      Position {positionIdx} · {pattern}
                    </div>
                    <div className="text-[12px] text-chess-text-secondary mt-1 leading-snug">
                      You found <span className="font-mono font-bold text-chess-accent">{highlight.item.bestMoveSan}</span> — exactly the pattern AI flagged.
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Actions pinned bottom */}
          <div className="flex gap-2 mt-4">
            <button
              onClick={() => {
                setRowMilestone(null);
                setRowResults([]);
                setRowEntries([]);
                setChallengeItem(null);
                setChallengeConfig(null);
                setSearchParams({});
              }}
              className="px-4 py-3.5 rounded-xl bg-chess-surface text-chess-text border border-chess-border/40 text-sm font-extrabold inline-flex items-center gap-2 hover:bg-chess-surface/80 transition-all"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
                <line x1="8.6" y1="13.5" x2="15.4" y2="17.5" />
                <line x1="15.4" y1="6.5" x2="8.6" y2="10.5" />
              </svg>
              Share row
            </button>
            <button
              onClick={continueFromMilestone}
              className="flex-1 py-3.5 rounded-xl font-black text-[15px] text-chess-bg transition-all active:scale-[0.98]"
              style={{
                background: 'linear-gradient(135deg, rgb(74,222,128), rgb(52,211,153))',
                boxShadow: '0 8px 22px rgba(74,222,128,0.35)',
              }}
            >
              {(() => {
                // After a row, fresh = positions not yet played in this
                // session row. With the new key-based picker we always
                // have something to serve as long as displayPositions
                // is non-empty, so count all remaining unique positions.
                const sessionKeys = new Set(rowEntries.map(e => getChallengeKey(e.item)));
                const remaining = displayPositions.filter(p => !sessionKeys.has(getChallengeKey(p))).length;
                const ready = Math.max(0, Math.min(ROW_SIZE, remaining));
                return ready > 0 ? `Next row · ${ready} ready →` : 'Done';
              })()}
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ── Interactive Challenge View ── */
  if (challengeItem && challengeConfig) {
    const item = challengeItem;
    const catColor = CATEGORY_COLORS[item.category] ?? CATEGORY_COLORS.Positional;
    const { phase, currentFen, criticalFen, fenAfterCritical: _fac, fenForContinuation: _ffc, opponentResponseSan: _ors, playerTurn, selectedSquare, legalMoves, opponentThinking, evaluating, lastMoveFrom, lastMoveTo, moveScore, moveScores, playerMoveSan: _pms, showAnswer, attempts, error: challengeError, aiExplanation, aiExplanationLoading, criticalRanking, continuationRanking: _cr, continuationMoves, continuationRankings, rankingLoading, pendingPromotion } = challengeState;
    void catColor;
    void _pms;
    void _fac; void _ffc; void _ors; void _cr; void rankingLoading;

    // Use live ranking's top move as the authoritative "best" when available,
    // falling back to the stored analysis best move while ranking loads.
    // For continuation moves we score each move on its own FEN, so the
    // "best" comes from the latest continuationRankings entry.
    const isInContinuationScored = phase === 'scored' && moveScores.length > 1;
    const activeRankingForArrows = isInContinuationScored
      ? (continuationRankings[continuationRankings.length - 1] ?? [])
      : criticalRanking;
    const liveBest = activeRankingForArrows.length > 0
      ? activeRankingForArrows.find(m => m.rank === 1) ?? activeRankingForArrows[0]
      : null;
    const bestMoveUci = liveBest?.uci ?? item.bestMoveUci;
    const bestMoveSan = liveBest?.san ?? item.bestMoveSan;

    // Pre-move FEN + best-move UCI for whichever move the AI explanation is
    // describing. Used for the "Best Move" tab arrow so it works
    // identically across the critical move and every continuation move,
    // even after the live board has advanced past them.
    //
    // CRITICAL move: use the STORED `item.bestMoveUci` — that's the same
    // UCI the scoring path passes to the AI as "best move" (see
    // useTimeMachineChallenge.ts: `bestUci = isCritical ? config.bestMoveUci`).
    // If we used liveBest here the tab arrow would sometimes point at a
    // different (equal-best) alternative than the move the AI is naming
    // in its sentence, which reads as inconsistent.
    //
    // CONTINUATION move: use the live ranking — the AI prompt for
    // continuation moves also uses `ranking[0].san` so they stay in sync.
    let explanationFenBefore: string | null = null;
    let explanationBestUci: string | null = null;
    if (moveScores.length === 1) {
      explanationFenBefore = item.fen;
      explanationBestUci = item.bestMoveUci ?? liveBest?.uci ?? null;
    } else if (moveScores.length > 1) {
      const idx = moveScores.length - 2; // continuationMoves[idx] = the just-scored continuation move
      const lastContMove = continuationMoves[idx];
      const ranking = continuationRankings[idx];
      if (lastContMove && Array.isArray(ranking) && ranking.length > 0) {
        explanationFenBefore = lastContMove.fenBefore;
        const top = ranking.find(m => m.rank === 1) ?? ranking[0];
        explanationBestUci = top?.uci ?? null;
      }
    }

    const boardOrientationColor = item.playerColor === 'black' ? 'black' : 'white';

    const handleRankSelect = (move: RankedMove, startFen: string) => {
      // Toggle off if clicking same row
      if (selectedRowUci === move.uci) {
        setPreviewUci(null);
        setPreviewFenState(null);
        setSelectedRowUci(null);
        setPvStep(-1);
        setPvChainData(null);
        return;
      }

      // Build full PV chain: for each move, capture the FEN BEFORE it's played
      // (so the arrow's source square still has its piece on the displayed board).
      try {
        const chess = new Chess(startFen);
        const pvMoves = move.pvUci.length > 0 ? move.pvUci : [move.uci];
        const fensBefore: string[] = [];
        const ucis: string[] = [];

        for (const uci of pvMoves.slice(0, 5)) {
          const from = uci.slice(0, 2) as Square;
          const to = uci.slice(2, 4) as Square;
          const promo = uci.length > 4 ? uci[4] as 'q' | 'r' | 'b' | 'n' : undefined;
          const fenBefore = chess.fen();
          const result = chess.move({ from, to, promotion: promo });
          if (!result) break;
          fensBefore.push(fenBefore);
          ucis.push(uci);
        }

        if (fensBefore.length > 0) {
          setSelectedRowUci(move.uci);
          setPvChainData({ fens: fensBefore, ucis });
          setPvStep(0);
          setPreviewUci(ucis[0]);
          setPreviewFenState(fensBefore[0]);
          playChessSound('move');
        } else {
          // PV application failed — still show the arrow for this move
          console.warn(`[TM] PV failed for ${move.uci} at ${startFen} — showing arrow only`);
          setSelectedRowUci(move.uci);
          setPreviewUci(move.uci);
          setPreviewFenState(null);
          setPvStep(-1);
          setPvChainData(null);
          playChessSound('move');
        }
      } catch (err) {
        // Chess.js error — still show the arrow
        console.warn(`[TM] PV error for ${move.uci}:`, err);
        setSelectedRowUci(move.uci);
        setPreviewUci(move.uci);
        setPreviewFenState(null);
        setPvStep(-1);
        setPvChainData(null);
      }
    };

    // Handle clicking individual moves within a PV chain
    const handlePvStepClick = (step: number) => {
      if (!pvChainData || step < 0 || step >= pvChainData.fens.length) return;
      setPvStep(step);
      setPreviewUci(pvChainData.ucis[step]);
      setPreviewFenState(pvChainData.fens[step]);
      playChessSound('move');
    };
    void handleRankSelect; void handlePvStepClick;

    // In scored phase: hide arrows by default — only show when the user explicitly
    // reveals the best move (Show best move button) or when they tap a ranked-move row.
    // The "Reveal answer" path (giving up before moving) auto-reveals so the user
    // sees the answer they asked for.
    const isRevealAnswerPath = phase === 'scored' && showAnswer && challengeState.moveScore === 0 && !challengeState.playerMoveUci;
    // Auto-show arrows during scored phase AND through the subsequent
    // continuation phase, until the user starts their next move. The hook
    // keeps `showAnswer` true across both phases and flips it to false in
    // the move handlers, so the gate is just "showAnswer is set and we're
    // not back in leadup".
    const showArrows = (phase === 'scored' || phase === 'continuation') && showAnswer;
    void revealedBest; void isRevealAnswerPath;
    // Board always sits on the post-move FEN — the piece stays where the
    // player dropped it, no snap-back, no flicker between 'scored' and
    // 'continuation'. The pre-move FEN is still needed for ARROW legality
    // (to validate that the source square holds the right piece BEFORE the
    // move was played), so we compute it separately as `arrowFen`.
    const baseFen = currentFen;
    const lastContMoveForArrows = continuationMoves[continuationMoves.length - 1];
    // True whenever the most-recently-scored move is a continuation move
    // (i.e. we've scored more than just the critical move). Used to pick
    // the correct ranking for arrow rendering — regardless of whether
    // we're still on the 'scored' frame or have auto-advanced into
    // 'continuation' while keeping the previous arrows visible.
    const isContinuationScored = moveScores.length > 1;
    const arrowFen = isContinuationScored
      ? (lastContMoveForArrows?.fenBefore ?? currentFen)
      : (criticalFen || item.fen);
    // When the user opens the "Best move" tab in the AI explanation, rewind
    // the board to the position the explanation is talking about so the
    // green arrow visually anchors to the right pieces. Without this, the
    // live board (already past the move) draws the arrow from squares
    // whose pieces have moved, which read as "voodoo" arrows.
    const bestTabFen = aiBestTabActive && explanationFenBefore ? explanationFenBefore : null;
    const displayFen = previewFen ?? bestTabFen ?? baseFen;

    // Helper: a UCI is renderable only when its source square holds a piece
    // of the player's colour on the FEN we're about to display. Without
    // this guard we draw "voodoo" arrows from empty squares (e.g. when the
    // displayed FEN is post-move and the source is now empty).
    const isLegalUciOn = (uci: string, fen: string): boolean => {
      if (!uci || uci.length < 4) return false;
      try {
        const c = new Chess(fen);
        const fromSq = uci.slice(0, 2) as Square;
        const toSq = uci.slice(2, 4) as Square;
        const promo = uci.length > 4 ? uci[4] as 'q' | 'r' | 'b' | 'n' : undefined;
        const piece = c.get(fromSq);
        const turn = c.turn();
        if (!piece || piece.color !== turn) return false;
        const result = c.move({ from: fromSq, to: toSq, promotion: promo });
        return !!result;
      } catch {
        return false;
      }
    };

    // When the player's move scored 100 (multiple equal-best moves are
    // possible — e.g. several tied mate-in-N lines) or matches the engine's
    // top choice exactly, surface their own move as "the best" so the green
    // arrow and the status text agree on what the user is being praised for.
    const attemptUci = challengeState.playerMoveUci;
    const playerScored100 = challengeState.moveScore === 100 && !!attemptUci;
    const sameAsBest = !!attemptUci && attemptUci === bestMoveUci;

    // Single arrow from origin to destination. Knight moves used to be
    // split into an L (long leg + short leg) so the arrow traced the
    // jump, but it rendered as two arrowheads which read as two separate
    // moves. One direct arrow is clearer.
    const expandArrow = (uci: string, _fen: string, color: string): Array<[Square, Square, string]> => {
      const from = uci.slice(0, 2) as Square;
      const to = uci.slice(2, 4) as Square;
      return [[from, to, color]];
    };

    // Arrows — during scored phase (normal answer arrows) OR when previewing a ranked move
    const arrows: [Square, Square, string][] = [];

    // Best-move tab arrow — when the user opens the "Best move" tab in the
    // AI explanation, draw a bright green arrow for the move the
    // explanation is talking about. Uses the SAME source FEN the user is
    // looking at (board is rewound above), so the arrow is always
    // legal/visible regardless of phase. Identical behaviour for the
    // critical move and every continuation move.
    if (aiBestTabActive && explanationBestUci && explanationBestUci.length >= 4 && isLegalUciOn(explanationBestUci, displayFen)) {
      arrows.push(...expandArrow(explanationBestUci, displayFen, 'rgba(74,222,128,0.95)'));
    }

    if (previewUci && isLegalUciOn(previewUci, displayFen)) {
      // Preview arrow: blue — shows the selected ranked move on the critical/continuation FEN.
      // Guarded by isLegalUciOn so we never draw a voodoo arrow from an empty square if the
      // displayed FEN drifts out of sync with the UCI.
      arrows.push(...expandArrow(previewUci, displayFen, 'rgba(96,165,250,0.85)'));
    } else if (phase === 'leadup') {
      // C1 design: subtle gray arrow showing the NEXT leadup move that's
      // about to play, so the player knows what they're watching.
      const nextMove = challengeConfig.gameMoves[challengeState.moveIndex];
      const nextUci = nextMove?.moveUci;
      if (nextUci && nextUci.length >= 4 && isLegalUciOn(nextUci, displayFen)) {
        arrows.push(...expandArrow(nextUci, displayFen, 'rgba(148,163,184,0.55)'));
      }
    } else if (showArrows) {
      // Arrows are validated against the PRE-move FEN (arrowFen) — the board
      // itself is on the post-move FEN, but the arrow's source square needs
      // to have held the right piece BEFORE the move for the path to make
      // visual sense.
      //
      // The GREEN best-move arrow does NOT auto-show here when the player
      // got the move wrong — it only appears when the user explicitly opens
      // the "Best move" tab in the AI explanation (handled higher up via
      // the `aiBestTabActive && explanationBestUci` branch). This avoids
      // (1) spoiling the answer the moment they submit and (2) the
      // inconsistency we used to have between the always-on arrow (live
      // ranking) and the on-tab arrow (stored analysis) sometimes pointing
      // at different equal-best moves.
      if (playerScored100 || sameAsBest) {
        // Player nailed it — single GREEN arrow celebrates the move they
        // played (or the best move if they gave up but it matches).
        if (attemptUci && isLegalUciOn(attemptUci, arrowFen)) {
          arrows.push(...expandArrow(attemptUci, arrowFen, 'rgba(74,222,128,0.85)'));
        } else if (isLegalUciOn(bestMoveUci, arrowFen)) {
          arrows.push(...expandArrow(bestMoveUci, arrowFen, 'rgba(74,222,128,0.85)'));
        }
      } else {
        // Wrong move: only the RED attempt arrow (or ORANGE original
        // mistake if they didn't attempt). The best move stays hidden
        // until the user opens the Best move tab.
        if (attemptUci && isLegalUciOn(attemptUci, arrowFen)) {
          arrows.push(...expandArrow(attemptUci, arrowFen, 'rgba(239,68,68,0.7)'));
        }
        if (!attemptUci && item.playedMoveSan !== bestMoveSan) {
          const origUci = challengeConfig!.originalMoveUci;
          if (origUci && isLegalUciOn(origUci, arrowFen)) {
            arrows.push(...expandArrow(origUci, arrowFen, 'rgba(251,146,60,0.6)'));
          }
        }
      }
    }

    // Square highlights. Selection + legal-move dots only render when the
    // player can interact (no arrows up). The yellow last-move "tracks" stay
    // visible across all phases — including Reveal Answer — so the user sees
    // a consistent move trail like in standard chess UIs.
    //
    // IMPORTANT: highlights MUST be expressed as `backgroundImage` (gradients)
    // — never `background` shorthand or `backgroundColor`. react-chessboard
    // applies `customSquareStyles[sq]` after `customDarkSquareStyle` /
    // `customLightSquareStyle` and merges as a plain object, so any of those
    // two would replace the base square color and reveal the dark page
    // surface beneath the board (the "greyish squares" bug). Layered
    // gradients sit ON TOP of the base color and look correct on both
    // dark and light squares.
    const tint = (color: string): React.CSSProperties => ({
      backgroundImage: `linear-gradient(${color}, ${color})`,
    });
    const dot = (color: string): React.CSSProperties => ({
      backgroundImage: `radial-gradient(circle, ${color} 22%, transparent 22%)`,
    });
    const squareStyles: Record<string, React.CSSProperties> = {};
    // Show selection + legal-move dots whenever the player has selected a
    // piece — including during the continuation phase while previous-move
    // arrows are still on the board. The dots use a low-opacity GREY so
    // they read clearly without competing with the colored arrows or
    // yellow last-move tracks. Suppressing them when arrows were up made
    // the board feel unresponsive after a wrong move on the previous turn.
    if (selectedSquare) squareStyles[selectedSquare] = tint('rgba(148,163,184,0.28)');
    for (const sq of legalMoves) squareStyles[sq] = dot('rgba(148,163,184,0.45)');
    // Derive the user's own move squares from attemptUci so the colored glow
    // can persist past 'scored' into 'continuation' (when lastMoveTo gets
    // overwritten by the opponent's reply). The glow stays on the user's
    // destination until they make their NEXT move (which overwrites
    // playerMoveUci + moveScore in the hook).
    const userMoveFrom = attemptUci ? (attemptUci.slice(0, 2) as Square) : null;
    const userMoveTo = attemptUci ? (attemptUci.slice(2, 4) as Square) : null;
    const userMoveScored = userMoveTo !== null && moveScore !== null;

    // Last-move yellow track (any move, user or opponent). Skip the
    // destination if it's the user's TO — the green/red glow below owns
    // that square and we don't want yellow bleeding through.
    if (lastMoveFrom) squareStyles[lastMoveFrom] = { ...squareStyles[lastMoveFrom], ...tint('rgba(255,210,80,0.22)') };
    if (lastMoveTo && lastMoveTo !== userMoveTo) {
      squareStyles[lastMoveTo] = { ...squareStyles[lastMoveTo], ...tint('rgba(255,200,60,0.5)'), boxShadow: 'inset 0 0 0 3px rgba(255,200,60,0.7)' };
    }

    // User's own source square — faint yellow regardless of phase, so the
    // "where I picked the piece up" is always visible while the glow is on
    // the destination.
    if (userMoveFrom) {
      squareStyles[userMoveFrom] = { ...squareStyles[userMoveFrom], ...tint('rgba(255,210,80,0.22)') };
    }
    // User's destination — green (≥90, "excellent") or red (<90, "wrong")
    // glow that persists until the user makes their next move.
    if (userMoveTo && userMoveScored) {
      const isGood = (moveScore ?? 0) >= 90;
      const baseRgb = isGood ? '74,222,128' : '239,68,68';
      squareStyles[userMoveTo] = {
        ...squareStyles[userMoveTo],
        ...tint(`rgba(${baseRgb},0.22)`),
        boxShadow: `inset 0 0 14px rgba(${baseRgb},0.85), inset 0 0 0 3px rgba(${baseRgb},0.7)`,
      };
    }
    if (highlightedSquare) squareStyles[highlightedSquare] = { ...squareStyles[highlightedSquare], ...tint('rgba(59,130,246,0.5)'), boxShadow: 'inset 0 0 0 2px rgba(59,130,246,0.8)' };

    // Score color helper
    const scoreColor = (s: number | null) => {
      if (s === null) return 'text-gray-400';
      if (s >= 100) return 'text-chess-accent';
      if (s >= 90) return 'text-teal-400';
      if (s >= 70) return 'text-amber-400';
      if (s >= 50) return 'text-orange-400';
      return 'text-red-400';
    };
    const scoreLabel = (s: number | null) => {
      if (s === null) return '';
      if (s >= 100) return t('tm_perfect');
      if (s >= 90) return t('tm_excellent');
      if (s >= 70) return t('tm_good');
      if (s >= 50) return t('tm_okay');
      return t('tm_keep_trying');
    };
    void scoreLabel; void scoreColor;

    // Status panel content (reused in both layouts). No outer border — each
    // inner panel (AI Says, etc.) carries its own toned border.
    // Detect terminal positions (mate / stalemate / draw) so we can surface
    // a "Checkmate — game over" badge on the board itself when the row had
    // to end early. Computed once per render from the displayed FEN so the
    // overlay updates in lock-step with the board.
    let gameOverLabel: string | null = null;
    if (phase === 'complete' && moveScores.length < 3) {
      try {
        const c = new Chess(currentFen ?? item.fen);
        if (c.isCheckmate()) gameOverLabel = t('tm_checkmate') || 'Checkmate — game over';
        else if (c.isStalemate()) gameOverLabel = t('tm_stalemate') || 'Stalemate — game over';
        else if (c.isDraw()) gameOverLabel = t('tm_draw') || 'Draw — game over';
        else if (c.isGameOver()) gameOverLabel = t('tm_game_over') || 'Game over';
      } catch { /* ignore */ }
    }

    const isWhitePlayer = item.playerColor === 'white';
    const playerSidePill = (
      <span
        className="inline-flex items-center gap-1 rounded-full border px-1.5 py-[1px] text-[9px] font-bold uppercase tracking-wide whitespace-nowrap shrink-0"
        style={{
          background: isWhitePlayer ? 'rgba(255,255,255,0.92)' : 'rgba(20,20,24,0.9)',
          color: isWhitePlayer ? '#0b0b0d' : '#f8fafc',
          borderColor: isWhitePlayer ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.18)',
        }}
        title={isWhitePlayer ? 'You are playing White' : 'You are playing Black'}
      >
        <span
          className="inline-block rounded-full"
          style={{
            width: 7,
            height: 7,
            background: isWhitePlayer ? '#ffffff' : '#0b0b0d',
            border: `1px solid ${isWhitePlayer ? '#0b0b0d' : '#ffffff'}`,
          }}
        />
        {isWhitePlayer ? 'You · White' : 'You · Black'}
      </span>
    );

    const statusPanel = (
      <div className="rounded-xl overflow-hidden">
        {/* Player-color marker now lives in the top game chip (replaces
            the old "MV N" badge), reclaiming the vertical space here so
            the action buttons stay above the fold. */}
        {phase === 'leadup' && (() => {
          const moveNumber = challengeConfig.criticalIndex + 1;
          // Split on {move} so the bold styling lands inside the translated
          // sentence wherever the target language places the number.
          const [before, ...rest] = t('tm_leadup_rewinding').split('{move}');
          const after = rest.join('{move}');
          return (
            <div className="px-4 py-3 md:text-left text-center">
              <div className="text-[14px] leading-relaxed text-chess-text-secondary">
                {before}
                <b style={{ color: 'rgb(251,191,36)' }}>{moveNumber}</b>
                {after}
              </div>
            </div>
          );
        })()}
        {/* showMistake is a brief transitional phase — the new design uses
            the same AI Says cautious panel as critical, no separate red box. */}
        {phase === 'critical' && (
          <div className="px-4 py-3 md:text-left text-center">
            {/* When a hint is active (or loading) the AI Says panel itself
                becomes the hint surface — yellow tone, dismissible × — so
                we don't stack two cards. Otherwise show the standard
                cautious instruction. */}
            {(challengeState.hint || challengeState.hintLoading) ? (
              <AISays tone="hint" onDismiss={dismissHint}>
                {challengeState.hintLoading ? (
                  <span className="inline-flex items-center gap-2 text-chess-text-secondary">
                    <span className="w-3 h-3 border-[1.5px] rounded-full animate-spin" style={{ borderColor: 'rgb(251,191,36)', borderTopColor: 'transparent' }} />
                    <span>{t('tm_hint_thinking')}</span>
                  </span>
                ) : challengeState.hint ? (
                  <ExplanationText
                    text={challengeState.hint}
                    onSquareClick={(sq) => setHighlightedSquare(prev => prev === sq ? null : sq)}
                  />
                ) : null}
              </AISays>
            ) : (
              <AISays tone="cautious">
                <span className="font-black text-chess-text">{t('tm_find_better_move')} </span>
                <span className="text-chess-text-secondary">
                  {(() => {
                    if (sourceTab === 'yours') {
                      return t('tm_originally_played', { move: item.playedMoveSan });
                    }
                    const game = allGames.find((g) => g.id === item.gameId);
                    const name = game?.player?.username ?? '';
                    return name
                      ? t('tm_originally_played_by', { name, move: item.playedMoveSan })
                      : t('tm_originally_played', { move: item.playedMoveSan });
                  })()}
                </span>
              </AISays>
            )}

            {/* Attempt counter — Hint and Reveal answer moved into the
                bottom action row (above the tab bar) per Hybrid Salvage (C). */}
            {attempts > 0 && (
              <div className="text-[11px] text-gray-500 mt-2 md:text-left text-center">
                Attempt {attempts + 1}
              </div>
            )}
          </div>
        )}
        {phase === 'evaluating' && (
          <div className="px-4 py-3 md:text-left text-center">
            <div className="flex items-center md:justify-start justify-center gap-2">
              <span className="w-3 h-3 border-2 border-chess-accent border-t-transparent rounded-full animate-spin" />
              <span className="text-sm text-gray-400">Analyzing your move...</span>
            </div>
          </div>
        )}
        {/* During continuation, only show the "Opponent thinking" status —
            the verbose "Keep playing — N moves left" text was removed per
            UX request. The player-color pill above the panel and the move
            counter in the scored card communicate progress instead. */}
        {phase === 'continuation' && opponentThinking && (
          <div className="px-4 py-2 md:text-left text-center border-b border-chess-border/20">
            <span className="text-xs text-gray-400">{t('tm_opponent_thinking')}</span>
          </div>
        )}
        {/* Scored panel — persists into continuation and complete phases so
            the user keeps the previous move's explanation visible while the
            next move plays out, and after the row is done. */}
        {(phase === 'scored' || phase === 'complete' || (phase === 'continuation' && moveScores.length > 0) || (phase === 'evaluating' && moveScores.length > 0)) && (
          <div className="px-4 py-3 md:text-left text-center">
            {challengeError ? (
              <>
                <div className="text-sm text-red-400 mb-2">{challengeError}</div>
                <button onClick={retry} className="px-4 py-2 bg-chess-accent text-chess-bg rounded-lg text-sm font-bold">{t('tm_try_again')}</button>
              </>
            ) : (
              <>
                {/* Game-over banner moved to a board-anchored overlay (see
                    BoardGameOverBadge below the board container). Keeping it
                    here would duplicate the message. */}
                <div className="flex items-center gap-2 flex-nowrap mb-1.5">
                  <div className="min-w-0 flex-1 md:text-left text-center">
                    <div className="text-[10px] font-extrabold tracking-[0.6px] text-chess-text-tertiary uppercase">
                      {(() => {
                        // Total moves can be < 3 when the game ends early
                        // (mate / stalemate, or original game ran out of
                        // ply) and can exceed 3 if retries / reveal-answer
                        // appended extra scores. Either way, the displayed
                        // total must be ≥ the count, so n / total stays
                        // sane (no "MOVE 8 OF 3").
                        const total = Math.max(moveScores.length, phase === 'complete' ? 1 : 3);
                        return t('tm_move_progress', { n: moveScores.length, total });
                      })()}
                    </div>
                  </div>
                </div>

                {/* AI explanation — persists through continuation so the user
                    can keep reading. While loading, show a tabs+card skeleton
                    (same pattern as GameDetail) so the structure is visible
                    immediately and only the text fills in.

                    During continuation, when the user requests a hint we
                    swap this slot for the same yellow AI Says hint surface
                    used in the move-1 critical phase. That keeps the hint
                    UI consistent across moves and avoids stacking two
                    cards. */}
                {phase === 'continuation' && (challengeState.hint || challengeState.hintLoading) ? (
                  <div className="mb-2">
                    <AISays tone="hint" onDismiss={dismissHint}>
                      {challengeState.hintLoading ? (
                        <span className="inline-flex items-center gap-2 text-chess-text-secondary">
                          <span className="w-3 h-3 border-[1.5px] rounded-full animate-spin" style={{ borderColor: 'rgb(251,191,36)', borderTopColor: 'transparent' }} />
                          <span>{t('tm_hint_thinking')}</span>
                        </span>
                      ) : challengeState.hint ? (
                        <ExplanationText
                          text={challengeState.hint}
                          onSquareClick={(sq) => setHighlightedSquare(prev => prev === sq ? null : sq)}
                        />
                      ) : null}
                    </AISays>
                  </div>
                ) : (
                  <>
                    {aiExplanationLoading && !aiExplanation && (
                      <div aria-busy="true" aria-live="polite" className="mb-2">
                        <div className="flex items-end relative z-10" style={{ marginBottom: -1 }}>
                          <div className="px-3 py-1.5 rounded-t-md border border-red-500/40 bg-red-500/10 me-1">
                            <div className="h-2 w-12 rounded bg-red-500/30 animate-pulse" />
                          </div>
                          <div className="px-3 py-1.5 rounded-t-md border border-white/[0.06] bg-white/[0.02]">
                            <div className="h-2 w-12 rounded bg-white/[0.10] animate-pulse" />
                          </div>
                        </div>
                        <div className="border border-red-500/40 bg-red-500/[0.04] rounded-md px-3 py-2 space-y-1.5">
                          <div className="h-2 w-full rounded bg-white/[0.07] animate-pulse" />
                          <div className="h-2 w-[92%] rounded bg-white/[0.07] animate-pulse" />
                          <div className="h-2 w-[60%] rounded bg-white/[0.07] animate-pulse" />
                        </div>
                      </div>
                    )}
                    {aiExplanation && (
                      <div className="text-[12px] leading-relaxed text-gray-400 mb-2">
                        <ExplanationText
                          text={aiExplanation}
                          onSquareClick={(sq) => setHighlightedSquare(prev => prev === sq ? null : sq)}
                          isBestMove={playerScored100 || sameAsBest}
                          onTabChange={(t) => setAiBestTabActive(t === 1)}
                        />
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        )}
      </div>
    );

    return (
      <div className="max-w-[1200px] mx-auto md:block pt-4 md:pt-6">
        {/* Header — back button + pattern title hero, with category/severity
            and the game context (player vs opponent · date · timeClass) on a
            tight secondary row. Visual hierarchy: pattern name reads as the
            heading, everything else is supporting metadata. */}
        {/* Hybrid Salvage (C) chrome — RunProgress at top, then a compact
            one-line game chip. The verbose pattern hero / category / severity
            chips / date row are intentionally dropped per the design. The
            small ← back arrow is preserved on the left for navigation. */}
        <div className="shrink-0 mb-2">
          <div className="flex items-start gap-2 mb-2">
            <button onClick={() => {
              // Always exit the replay challenge back to wherever the user
              // arrived from. If we tracked a `returnTo` (e.g. came from a
              // game's "Practice" CTA), navigate back to that exact spot.
              // Otherwise: clear challenge state AND step the browser back
              // one entry — falling back to the TimeMachine list if there
              // is no prior history.
              setSearchParams({});
              if (returnTo) {
                navigate(returnTo.path, { state: { moveIndex: returnTo.moveIndex } });
                return;
              }
              setChallengeItem(null); setChallengeConfig(null);
              setRowResults([]); setRowEntries([]); setRowMilestone(null);
              if (window.history.length > 1) navigate(-1);
            }} className="shrink-0 w-11 h-11 rounded-xl bg-chess-surface/40 border border-chess-border/30 inline-flex items-center justify-center text-gray-400 hover:text-chess-text hover:bg-chess-surface/60 transition-all"
              aria-label={t('tm_back')}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="rtl:rotate-180"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
            </button>
            <div className="flex-1 min-w-0">
              {(() => {
                // Live preview: once the critical move is scored we already
                // know whether this position was saved or missed (the result
                // is determined by moveScores[0]). Surface that on the row
                // bar without waiting for the user to click "Next" through
                // the continuation moves.
                const hasInProgressResult =
                  (phase === 'scored' || phase === 'continuation' || phase === 'evaluating' || phase === 'complete') &&
                  moveScores.length > 0 &&
                  rowResults.length < ROW_SIZE;
                const previewResults = hasInProgressResult
                  ? [...rowResults, resolveChallengeResult(moveScores, attempts)]
                  : rowResults;
                return <RunProgress results={previewResults} current={rowResults.length} />;
              })()}
            </div>
          </div>

          {/* Compact game chip — pulsing red dot + pattern label + opponent
              + move number. Visible across the whole challenge flow as a
              persistent header (Hybrid Salvage C design language). */}
          {(() => {
            const game = allGames.find((g) => g.id === item.gameId);
            const playerUsername = game?.player?.username ?? '';
            return (
              <div className="rounded-xl px-3 py-2 flex items-center gap-2.5 mb-2" style={{
                background: 'rgba(17,24,39,0.6)',
                border: '1px solid rgba(30,58,95,0.34)',
              }}>
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{
                  background: 'rgb(74,222,128)',
                  boxShadow: '0 0 6px rgb(74,222,128)',
                  animation: 'cBlink 1.4s infinite',
                }} />
                <span className="text-[12px] font-bold text-chess-text truncate">
                  {patternLabel(item.patternTheme, t)}
                </span>
                {(() => {
                  // Replay indicator — shows ×N where N is how many times the
                  // user has *finished* this position before. The in-progress
                  // attempt does NOT pre-increment the badge; it only ticks
                  // up once the current play completes. Matches the ×N chip
                  // used on the position list card so both views agree.
                  const c = playCounts.get(getChallengeKey(item)) ?? 0;
                  if (c < 1) return null;
                  return (
                    <span
                      className="text-[10px] font-extrabold tabular-nums px-1.5 py-0.5 rounded-md leading-none shrink-0 border"
                      style={{
                        color: 'rgb(134, 239, 172)',
                        borderColor: 'rgba(74, 222, 128, 0.45)',
                        background: 'rgba(74, 222, 128, 0.08)',
                      }}
                      title={`You've played this position ${c}× before`}
                    >
                      ×{c}
                    </span>
                  );
                })()}
                <span className="text-[11px] text-chess-text-tertiary truncate">
                  · vs {sourceTab !== 'yours' && playerUsername ? `${playerUsername}` : item.gameOpponent} ({item.gameRating})
                </span>
                {/* Player color pill replaces the old "MV N" badge in the
                    top-right of the chip — frees up the vertical space below
                    the board and keeps the side indicator persistently
                    visible without pushing buttons below the fold. */}
                <span className="ms-auto shrink-0">
                  {playerSidePill}
                </span>
                <style>{`@keyframes cBlink { 50% { opacity: .25; } }`}</style>
              </div>
            );
          })()}
        </div>

        {/* Desktop: board left, sidebar right | Mobile: vertically centered */}
        <div className="flex flex-col md:flex-row md:gap-4 md:items-start">
          {/* Left: board area (~60%) */}
          <div
            data-tutorial-target="tm-challenge-board"
            className="md:flex-[3] md:min-w-0 flex flex-col md:block h-[calc(100dvh-134px-env(safe-area-inset-bottom))] md:h-auto"
          >
            {/* Tap-to-move promotion picker — appears when the user tapped a
                pawn onto the last rank. The drag-to-move flow uses
                react-chessboard's built-in popup; this picker covers taps. */}
            {pendingPromotion && (() => {
              const promoteColor = pendingPromotion.to[1] === '8' ? 'w' : 'b';
              const pieces: Array<'q' | 'r' | 'b' | 'n'> = ['q', 'r', 'b', 'n'];
              const labels: Record<typeof pieces[number], string> = {
                q: promoteColor === 'w' ? '♕' : '♛',
                r: promoteColor === 'w' ? '♖' : '♜',
                b: promoteColor === 'w' ? '♗' : '♝',
                n: promoteColor === 'w' ? '♘' : '♞',
              };
              return (
                <div className="fixed inset-0 z-[120] bg-black/60 flex items-center justify-center p-4" onClick={cancelPromotion}>
                  <div className="bg-chess-surface border border-chess-accent/40 rounded-2xl p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
                    <div className="text-xs font-bold text-chess-text-secondary mb-3 text-center uppercase tracking-wide">
                      Promote to
                    </div>
                    <div className="flex items-center gap-2">
                      {pieces.map((p) => (
                        <button
                          key={p}
                          type="button"
                          onClick={() => completePromotion(p)}
                          className="w-14 h-14 rounded-xl bg-chess-bg border border-chess-border/40 hover:border-chess-accent hover:bg-chess-accent/10 active:scale-95 transition-all flex items-center justify-center text-4xl text-chess-text"
                          aria-label={`Promote to ${p}`}
                        >
                          {labels[p]}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Board — full-bleed on mobile so it spans the entire viewport
                width, ignoring the page's px-4 / sm:px-6 padding. The
                full-bleed pattern (100vw + relative + -50vw margins) is
                needed because the parent <main> uses overflow-y: auto,
                which clips simple negative margins. Reverts to in-flow on
                md+ where the sidebar layout reasserts itself. */}
            <div
              ref={tmBoardRef}
              className="flex justify-center relative mx-[calc(50%-50vw)] w-screen md:mx-0 md:w-full"
            >
              {/* No phase-specific ring — the new design conveys state via
                  the SAVED/MISS stamp overlay and the AI Says panel below,
                  not a coloured halo around the board. */}
              <div className="rounded-xl shadow-lg shadow-black/20 relative">
                {/* SAVED / MISS stamp — overlays the board top-right corner
                    after a player's move is scored. Hybrid Salvage (C). */}
                {phase === 'scored' && moveScore !== null && challengeState.playerMoveUci && moveScores.length === 1 && (
                  moveScore >= 50 ? (
                    <div className="absolute top-2.5 right-2.5 z-20 px-2.5 py-1 rounded-lg text-[12px] font-black tracking-[1px] pointer-events-none" style={{
                      background: 'rgb(74,222,128)',
                      color: 'rgb(10,15,26)',
                      boxShadow: '0 6px 18px rgba(74,222,128,0.4)',
                      transform: 'rotate(-6deg)',
                    }}>✓ SAVED</div>
                  ) : (
                    <div className="absolute top-2.5 right-2.5 z-20 px-2.5 py-1 rounded-lg text-[12px] font-black tracking-[1px] pointer-events-none" style={{
                      background: 'rgb(248,113,113)',
                      color: 'rgb(10,15,26)',
                      boxShadow: '0 6px 18px rgba(248,113,113,0.4)',
                      transform: 'rotate(-6deg)',
                    }}>✗ MISS</div>
                  )
                )}
                {/* Game-over badge — anchored to the board's bottom edge with
                    a small inset, so the user can see at a glance that the
                    position is terminal (checkmate / stalemate / draw). Sits
                    inside the board's relative wrapper so it tracks the
                    board's exact dimensions on every viewport. */}
                {gameOverLabel && (
                  <div
                    className="absolute left-1/2 -translate-x-1/2 z-30 px-3 py-1.5 rounded-lg inline-flex items-center gap-2 text-[12px] font-bold pointer-events-none whitespace-nowrap"
                    style={{
                      bottom: 10,
                      background: 'rgba(15,23,42,0.92)',
                      border: '1px solid rgba(248,113,113,0.55)',
                      color: 'rgb(248,113,113)',
                      boxShadow: '0 8px 22px rgba(0,0,0,0.45)',
                      backdropFilter: 'blur(6px)',
                    }}
                  >
                    <span aria-hidden>⚑</span>
                    <span>{gameOverLabel}</span>
                  </div>
                )}
                <ThemedChessboard
                  position={displayFen}
                  boardOrientation={boardOrientationColor}
                  // Width-first sizing: take the smaller of the container
                  // and the viewport so the board claims every available
                  // pixel. The old height-cap kept the page above-the-fold
                  // at the cost of a smaller board — width wins now.
                  boardWidth={Math.max(Math.min(boardSize, typeof window !== 'undefined' ? window.innerWidth : 700), 200)}
                  arePiecesDraggable={playerTurn && !evaluating && (phase === 'critical' || phase === 'continuation')}
                  autoPromoteToQueen={false}
                  onPromotionCheck={(_from, to, piece) => {
                    return piece[1] === 'P' && (to[1] === '1' || to[1] === '8');
                  }}
                  onPromotionPieceSelect={(piece, fromSq, toSq) => {
                    if (!piece || !fromSq || !toSq) return false;
                    const code = piece[1].toLowerCase() as 'q' | 'r' | 'b' | 'n';
                    return onPieceDrop(fromSq, toSq, code);
                    // Sound (capture/castle/move) is fired by the hook on
                    // the successful chess.move() call inside onPieceDrop.
                  }}
                  onPieceDrop={(from, to) => onPieceDrop(from, to)}
                  onSquareClick={(sq) => { onSquareClick(sq as Square); }}
                  customSquareStyles={squareStyles}
                  customArrows={arrows}
                  animationDuration={phase === 'scored' ? 0 : 200}
                />
              </div>
            </div>

            {/* Status panel — mobile only (below board). Sits in the flex
                column with `mt-auto`, which absorbs any leftover vertical
                space ABOVE the panel and parks the panel + action row at the
                bottom of the column. Result: the explanation card hugs the
                action row regardless of how short its content is (no strict
                empty box). When the AI explanation is long, `min-h-0` lets
                the flex item shrink and `overflow-y-auto` scrolls inside. */}
            <div className="md:hidden mt-auto min-h-0 overflow-y-auto">
              {statusPanel}
            </div>

            {/* Action row — sits at the end of the board column's flex
                stack, directly below the status panel (which is pushed down
                by `mt-auto`). The column itself reserves space for the iOS
                safe-area + a small breathing buffer via its calc'd height,
                so the buttons end up `16px + safe-area` above the viewport
                floor without needing fixed positioning. `shrink-0` keeps the
                row at its content height even if the status panel above
                competes for space (it scrolls instead). Per phase:
                 • leadup / showMistake → Replay (full-width pill) + ◀ ▶ pills
                 • critical → Hint + Reveal answer (both styled like Replay)
                 • scored → Show best move toggle (styled like Replay) */}
            <div className="shrink-0 -mx-4 sm:-mx-6 md:mx-0 px-4 sm:px-6 md:px-0 pt-1.5 md:pt-0 pb-1 md:pb-0">
            {phase === 'leadup' || phase === 'showMistake' ? (
              (() => {
                const startIdx = challengeConfig.startIndex;
                const critIdx = challengeConfig.criticalIndex;
                const backDisabled = phase === 'leadup' && challengeState.moveIndex <= startIdx;
                const fwdDisabled = phase === 'showMistake' || (phase === 'leadup' && challengeState.moveIndex > critIdx);
                return (
                <div className="mt-2 flex items-center gap-2 px-2">
                  <button
                    onClick={onLeadupReplay}
                    className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-[14px] font-extrabold text-chess-text border-2 transition-all active:scale-[0.98]"
                    style={{ background: 'rgba(17,24,39,0.5)', borderColor: 'rgba(30,58,95,0.4)' }}
                    title={t('detail_replay')}
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 12a9 9 0 1 0 3-6.7"/><polyline points="3 4 3 10 9 10"/>
                    </svg>
                    {t('detail_replay')}
                  </button>
                  <div dir="ltr" style={{ direction: 'ltr' }} className="flex items-center gap-2">
                    <button
                      onClick={onLeadupBack}
                      disabled={backDisabled}
                      aria-label={t('tm_step_back')}
                      className="w-11 h-11 rounded-xl border bg-chess-surface/60 inline-flex items-center justify-center text-chess-text hover:bg-chess-surface transition-all active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-chess-surface/60"
                      style={{ borderColor: 'rgba(30,58,95,0.4)' }}
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
                    </button>
                    <button
                      onClick={onLeadupForward}
                      disabled={fwdDisabled}
                      aria-label={t('tm_step_forward')}
                      className="w-11 h-11 rounded-xl border bg-chess-surface/60 inline-flex items-center justify-center text-chess-text hover:bg-chess-surface transition-all active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-chess-surface/60"
                      style={{ borderColor: 'rgba(30,58,95,0.4)' }}
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
                    </button>
                  </div>
                </div>
                );
              })()
            ) : phase === 'critical' ? (
              <div className="mt-2 flex flex-col gap-2 px-2">
                {/* Row 1 — matches the leadup row exactly: Replay (neutral
                    border) + ◀ ▶ scrubber pills. All 44px tall. Forward is
                    always greyed in critical (animation finished). */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={onLeadupReplay}
                    className="flex-1 h-11 inline-flex items-center justify-center gap-2 rounded-xl text-[14px] font-extrabold text-chess-text border-2 transition-all active:scale-[0.98]"
                    style={{ background: 'rgba(17,24,39,0.5)', borderColor: 'rgba(30,58,95,0.4)' }}
                    title={t('detail_replay')}
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 12a9 9 0 1 0 3-6.7"/><polyline points="3 4 3 10 9 10"/>
                    </svg>
                    {t('detail_replay')}
                  </button>
                  <div dir="ltr" style={{ direction: 'ltr' }} className="flex items-center gap-2">
                    <button
                      onClick={onLeadupBack}
                      disabled={challengeConfig.criticalIndex <= challengeConfig.startIndex}
                      aria-label={t('tm_step_back')}
                      className="w-11 h-11 rounded-xl border bg-chess-surface/60 inline-flex items-center justify-center text-chess-text hover:bg-chess-surface transition-all active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-chess-surface/60"
                      style={{ borderColor: 'rgba(30,58,95,0.4)' }}
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
                    </button>
                    <button
                      disabled
                      aria-label={t('tm_step_forward')}
                      className="w-11 h-11 rounded-xl border bg-chess-surface/60 inline-flex items-center justify-center text-chess-text transition-all opacity-30 cursor-not-allowed"
                      style={{ borderColor: 'rgba(30,58,95,0.4)' }}
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
                    </button>
                  </div>
                </div>

                {/* Row 2 — Hint (yellow) + Reveal answer (green), both
                    full-width pills, same 44px height, single-line text. */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={requestHint}
                    disabled={!!challengeState.hint || challengeState.hintLoading}
                    className="flex-1 h-11 inline-flex items-center justify-center gap-2 rounded-xl text-[14px] font-extrabold text-chess-text border-2 transition-all active:scale-[0.98] disabled:opacity-50 whitespace-nowrap"
                    style={{ background: 'rgba(17,24,39,0.5)', borderColor: 'rgba(251,191,36,0.55)' }}
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M9 18h6"/><path d="M10 22h4"/>
                      <path d="M12 2a7 7 0 0 0-4 12.7c.5.4.9 1 1 1.7V18h6v-1.6c.1-.7.5-1.3 1-1.7A7 7 0 0 0 12 2z"/>
                    </svg>
                    {t('tm_hint')}
                  </button>
                  <button
                    onClick={() => { setHighlightedSquare(null); revealWithExplanation(); }}
                    className="flex-1 h-11 inline-flex items-center justify-center gap-2 rounded-xl text-[14px] font-extrabold text-chess-text border-2 transition-all active:scale-[0.98] whitespace-nowrap"
                    style={{ background: 'rgba(17,24,39,0.5)', borderColor: 'rgba(248,113,113,0.55)' }}
                  >
                    {t('tm_skip')}
                  </button>
                </div>
              </div>
            ) : phase === 'continuation' && playerTurn && !opponentThinking && !evaluating ? (
              /* Continuation phase — player's turn for move 2 or 3. Adds a
                 ↺ retry pill so the user can rewind to the critical move
                 and try the row again from the start; mirrors the scored
                 phase's "Try again" affordance so going back is always
                 one tap away. */
              <div className="mt-2 flex items-center gap-2 px-2">
                <button
                  onClick={retry}
                  aria-label={t('tm_try_again')}
                  title={t('tm_try_again')}
                  className="w-11 h-11 rounded-xl border-2 inline-flex items-center justify-center text-chess-text transition-all active:scale-[0.98] shrink-0"
                  style={{ background: 'rgba(17,24,39,0.5)', borderColor: 'rgba(251,191,36,0.55)' }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 12a9 9 0 1 0 3-6.7"/><polyline points="3 4 3 10 9 10"/>
                  </svg>
                </button>
                <button
                  onClick={requestHint}
                  disabled={!!challengeState.hint || challengeState.hintLoading}
                  className="flex-1 h-11 inline-flex items-center justify-center gap-2 rounded-xl text-[14px] font-extrabold text-chess-text border-2 transition-all active:scale-[0.98] disabled:opacity-50 whitespace-nowrap"
                  style={{ background: 'rgba(17,24,39,0.5)', borderColor: 'rgba(251,191,36,0.55)' }}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 18h6"/><path d="M10 22h4"/>
                    <path d="M12 2a7 7 0 0 0-4 12.7c.5.4.9 1 1 1.7V18h6v-1.6c.1-.7.5-1.3 1-1.7A7 7 0 0 0 12 2z"/>
                  </svg>
                  {t('tm_hint')}
                </button>
                <button
                  onClick={() => { setHighlightedSquare(null); revealWithExplanation(); }}
                  className="flex-1 h-11 inline-flex items-center justify-center gap-2 rounded-xl text-[14px] font-extrabold text-chess-text border-2 transition-all active:scale-[0.98] whitespace-nowrap"
                  style={{ background: 'rgba(17,24,39,0.5)', borderColor: 'rgba(248,113,113,0.55)' }}
                >
                  {t('tm_skip')}
                </button>
              </div>
            ) : phase === 'scored' && !challengeError ? (
              /* Scored-phase action row — Try Again rewinds to the critical
                 position (counts as a wrong attempt), so users can re-do
                 the move. On the last move (3rd) we also surface a Next
                 pill; otherwise auto-advance handles progression. */
              <div className="mt-2 flex items-center gap-2 px-2">
                <button
                  onClick={retry}
                  className="flex-1 h-11 inline-flex items-center justify-center gap-2 rounded-xl text-[14px] font-extrabold text-chess-text border-2 transition-all active:scale-[0.98] whitespace-nowrap"
                  style={{ background: 'rgba(17,24,39,0.5)', borderColor: 'rgba(251,191,36,0.55)' }}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 12a9 9 0 1 0 3-6.7"/><polyline points="3 4 3 10 9 10"/>
                  </svg>
                  {t('tm_try_again')}
                </button>
                {moveScores.length >= 3 && (
                  <button
                    onClick={() => { tutorialTriggerStep(6); advanceAfterChallenge(moveScores); }}
                    className="flex-1 h-11 px-4 rounded-xl text-[14px] font-extrabold text-chess-bg transition-all active:scale-[0.98] whitespace-nowrap"
                    style={{
                      background: 'linear-gradient(135deg, rgb(74,222,128), rgb(52,211,153))',
                      boxShadow: '0 6px 18px rgba(74,222,128,0.35)',
                    }}
                  >
                    {t('tm_next')}
                  </button>
                )}
              </div>
            ) : phase === 'complete' ? (
              /* Complete phase — Try Again rewinds the same position so the
                 user can re-attempt it (works whether the row ended cleanly
                 after 3 moves or early via checkmate / stalemate). Next
                 advances to the next position or triggers a milestone. */
              <div className="mt-2 flex items-center gap-2 px-2">
                <button
                  onClick={retry}
                  aria-label={t('tm_try_again')}
                  className="h-11 px-4 inline-flex items-center justify-center gap-2 rounded-xl text-[14px] font-extrabold text-chess-text border-2 transition-all active:scale-[0.98] whitespace-nowrap"
                  style={{ background: 'rgba(17,24,39,0.5)', borderColor: 'rgba(251,191,36,0.55)' }}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 12a9 9 0 1 0 3-6.7"/><polyline points="3 4 3 10 9 10"/>
                  </svg>
                  {t('tm_try_again')}
                </button>
                <button
                  data-tutorial-target="tm-challenge-back"
                  onClick={() => { tutorialTriggerStep(6); advanceAfterChallenge(challengeState.moveScores); }}
                  className="flex-1 h-11 px-4 rounded-xl text-[14px] font-extrabold text-chess-bg transition-all active:scale-[0.98] whitespace-nowrap"
                  style={{
                    background: 'linear-gradient(135deg, rgb(74,222,128), rgb(52,211,153))',
                    boxShadow: '0 6px 18px rgba(74,222,128,0.35)',
                  }}
                >
                  {t('tm_next')}
                </button>
              </div>
            ) : null}
            </div>
          </div>

          {/* Right: sidebar (~40%) — desktop only */}
          <div className="hidden md:block md:flex-[2] md:min-w-[280px] md:max-w-[400px] space-y-3">
            {/* Game context */}
            <div className="bg-chess-surface/30 rounded-xl px-4 py-3 border border-chess-border/15">
              <div className="text-sm text-gray-400 mb-1">
                vs <span className="text-chess-text font-medium">{item.gameOpponent}</span> ({item.gameRating})
              </div>
              <div className="text-xs text-gray-500">{item.gameTimeClass}</div>
              <button onClick={() => navigate(`/games/${item.gameId}`)} className="text-chess-accent/70 hover:text-chess-accent text-xs mt-2 block">
                {t('detail_full_game')}
              </button>
            </div>

            {/* Status panel — desktop sidebar */}
            {statusPanel}
          </div>
        </div>
      </div>
    );
  }

  /* ── List View ── */

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header — Replays brand row (icon + title) above the tagline. */}
      <div className="mb-3">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-chess-accent">
            <ReplayBrandIcon />
          </span>
          <h1 className="text-[22px] font-extrabold text-chess-text leading-none">
            {t('nav_timemachine')}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <p className="text-sm text-gray-400 leading-relaxed">
            {t('tm_tagline')}
          </p>
          <InfoButton onClick={() => setInfoOpen(true)} />
        </div>
      </div>
      {infoOpen && <InfoPopup title={t('tm_title')} body={t('tm_desc')} onClose={() => setInfoOpen(false)} />}

      {/* Source filter — For you / Following.
       *  Following count = number of followed people, not analyses. Using
       *  analyses caused the badge to creep up while a follow's games were
       *  being imported, which read as a bug. */}
      <SourceTabs
        active={sourceTab}
        onChange={setSourceTab}
        forYouCount={dataSrc.allAnalyses.length}
        followingCount={(settings.friendUsernames ?? []).length + (settings.topPlayerUsernames ?? []).length}
      />

      {/* Following manager — combined friends + top-players picker. */}
      {sourceTab === 'following' && (
        <FollowingManager
          friends={settings.friendUsernames ?? []}
          followedTop={settings.topPlayerUsernames ?? []}
          pendingUsernames={pendingNonSelfImports}
          suggestions={topOpponents}
          onAddFriend={async (u) => {
            const list = settings.friendUsernames ?? [];
            if (list.length >= MAX_FRIENDS) return;
            if (list.some((x) => x.toLowerCase() === u.toLowerCase())) return;
            await updateSettings({ friendUsernames: [...list, u] });
            markPendingImport(u);
            let importError: string | undefined;
            try {
              let ids = await importChessComGames(u, {
                maxGames: 3,
                guest: isGuest,
                skipCrossUserDedup: true,
                onProgress: (p) => { if (p.error) importError = p.error; },
              });
              // importChessComGames returns [] when every fetched game was
              // already in storage (dedup). Fall back to whatever's stored
              // for this user — using the ref-backed accessor since
              // dataSrc.friendGames was captured before the settings update
              // and excludes the username we just added.
              if (ids.length === 0) {
                ids = dataSrc.getStoredGameIdsByUsername(u);
              }
              if (ids.length > 0) {
                queueForAnalysis(ids);
                rememberPendingGameIds(u, ids);
              } else {
                toast(importError ? `Couldn't add ${u}: ${importError}` : `No games found for ${u}`, 'error');
                clearPendingImport(u);
              }
              refetchGames();
            } catch (err) {
              toast(`Couldn't add ${u}: ${err instanceof Error ? err.message : String(err)}`, 'error');
              clearPendingImport(u);
            }
          }}
          onRemoveFriend={async (u) => {
            const list = settings.friendUsernames ?? [];
            await updateSettings({
              friendUsernames: list.filter((x) => x.toLowerCase() !== u.toLowerCase()),
            });
          }}
          onToggleTop={async (u) => {
            const list = settings.topPlayerUsernames ?? [];
            const isFollowed = list.some((x) => x.toLowerCase() === u.toLowerCase());
            if (isFollowed) {
              await updateSettings({
                topPlayerUsernames: list.filter((x) => x.toLowerCase() !== u.toLowerCase()),
              });
            } else {
              if (list.length >= MAX_TOP_PLAYERS) return;
              await updateSettings({ topPlayerUsernames: [...list, u] });
              markPendingImport(u);
              let importError: string | undefined;
              try {
                let ids = await importChessComGames(u, {
                  maxGames: 3,
                  guest: isGuest,
                  skipCrossUserDedup: true,
                  onProgress: (p) => { if (p.error) importError = p.error; },
                });
                // importChessComGames returns [] when every fetched game
                // was already in storage (dedup). Fall back to whatever's
                // stored for this user — using the ref-backed accessor
                // since dataSrc.topPlayerGames was captured before the
                // settings update and excludes the username we just added.
                if (ids.length === 0) {
                  ids = dataSrc.getStoredGameIdsByUsername(u);
                }
                if (ids.length > 0) {
                  queueForAnalysis(ids);
                  rememberPendingGameIds(u, ids);
                } else {
                  toast(importError ? `Couldn't add ${u}: ${importError}` : `No games found for ${u}`, 'error');
                  clearPendingImport(u);
                }
                refetchGames();
              } catch (err) {
                toast(`Couldn't add ${u}: ${err instanceof Error ? err.message : String(err)}`, 'error');
                clearPendingImport(u);
              }
            }
          }}
        />
      )}

      {/* Following filter chips — People · Pattern · Skill */}
      {sourceTab === 'following' && (() => {
        const followedAll = [...(settings.friendUsernames ?? []), ...(settings.topPlayerUsernames ?? [])];
        if (followedAll.length === 0 && allPositions.length === 0) return null;
        const themesInScope = Array.from(new Set(allPositions.map((p) => p.patternTheme))).sort();
        const categoriesInScope = Array.from(new Set(allPositions.map((p) => p.category))) as SkillCategory[];
        // No overflow-x-auto on the wrapper: it would clip the FilterChip
        // dropdown when it opens below. The 3 chips fit on common widths;
        // they wrap at very narrow widths instead.
        return (
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <FilterChip
              label="People"
              value={peopleFilter ?? ''}
              icon={<svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /></svg>}
              options={followedAll.map((u) => ({ value: u, label: u }))}
              onChange={(v) => setPeopleFilter(v || null)}
            />
            <FilterChip
              label="Pattern"
              value={patternFilter ?? ''}
              icon={<svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>}
              options={themesInScope.map((th) => ({ value: th, label: patternLabel(th, t) }))}
              onChange={(v) => { setPatternFilter(v || null); setVisibleCount(PAGE_SIZE); }}
            />
            <FilterChip
              label="Skill"
              value={categoryFilter !== 'all' ? categoryFilter : ''}
              icon={<svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l9 4-9 4-9-4 9-4z" /><path d="M3 10l9 4 9-4" /><path d="M3 16l9 4 9-4" /></svg>}
              options={categoriesInScope.map((c) => ({ value: c, label: CATEGORY_KEYS[c] ? t(CATEGORY_KEYS[c]) : c }))}
              onChange={(v) => { setCategoryFilter((v as SkillCategory) || 'all'); setVisibleCount(PAGE_SIZE); }}
            />
          </div>
        );
      })()}

      {/* Bot-mode toggle — page-level default for how the continuation phase
          plays. 'Opponent' replays the actual opponent's move when the user
          stays on-script, then falls back to Stockfish throttled to roughly
          opponent rating. 'Engine' is full-strength Stockfish for every
          reply. Persisted to localStorage so the choice carries between
          sessions. Shown on both 'yours' and 'following' tabs. */}
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[11px] font-bold text-chess-text-tertiary">Vs</span>
        <div
          className="inline-flex items-stretch rounded-full overflow-hidden border border-chess-border/30 text-[11px] font-bold"
          role="group"
          aria-label="Replay opponent"
        >
          <button
            type="button"
            onClick={() => setBotMode('engine')}
            className={`px-3.5 py-1 transition-colors inline-flex items-center gap-1.5 ${botMode === 'engine' ? 'bg-chess-accent/20 text-chess-accent' : 'text-chess-text-tertiary hover:text-chess-text'}`}
          >
            <RobotIconSm />
            Engine
          </button>
          <button
            type="button"
            onClick={() => setBotMode('opponent')}
            className={`px-3.5 py-1 transition-colors inline-flex items-center gap-1.5 ${botMode === 'opponent' ? 'bg-chess-accent/20 text-chess-accent' : 'text-chess-text-tertiary hover:text-chess-text'}`}
          >
            <PersonIconSm />
            Opponent
          </button>
        </div>
        <div className="relative" data-bot-info-root>
          <button
            type="button"
            onClick={() => setBotInfoOpen((v) => !v)}
            className={`w-5 h-5 inline-flex items-center justify-center rounded-full border transition-colors ${botInfoOpen ? 'border-chess-accent/60 text-chess-accent' : 'border-chess-border/30 text-chess-text-tertiary hover:text-chess-text hover:border-chess-border/50'}`}
            aria-label="Bot mode info"
            aria-expanded={botInfoOpen}
          >
            <InfoIconSm />
          </button>
          {botInfoOpen && (
            <div className="absolute z-30 mt-1.5 top-full end-0 w-[240px] max-w-[calc(100vw-32px)] rounded-lg bg-chess-surface border border-chess-border/40 shadow-xl px-3 py-2 text-[11px] leading-snug text-chess-text">
              <div className="font-extrabold text-chess-text-tertiary mb-1 uppercase tracking-[1.2px] text-[10px]">Bot mode</div>
              <p className="mb-1"><span className="font-bold text-chess-text">Engine</span> — full-strength Stockfish on every move.</p>
              <p><span className="font-bold text-chess-text">Opponent</span> — replays the actual opponent’s move when you stay on-script, then Stockfish at their rating once you deviate.</p>
            </div>
          )}
        </div>
      </div>

      {/* Game filter chip — shown when filtering to a specific game */}
      {gameFilter && (() => {
        const filteredGame = allGames.find(g => g.id === gameFilter);
        const label = filteredGame
          ? `vs ${filteredGame.opponent.username} · ${new Date(filteredGame.playedAt).toLocaleDateString()}`
          : gameFilter.slice(0, 12);
        return (
          <div className="flex items-center gap-1.5 mb-2.5">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-chess-accent/10 border border-chess-accent/20 text-chess-accent text-xs font-medium">
              <span className="opacity-70">&#9823;</span>
              {label}
              <button
                onClick={() => setGameFilter(null)}
                className="ml-0.5 opacity-60 hover:opacity-100 transition-opacity text-sm leading-none"
                aria-label="Clear game filter"
              >
                &times;
              </button>
            </span>
          </div>
        );
      })()}


      {/* Pattern impact filter \u2014 Yours tab only. Renders the worst-pattern
          hero card on top, then a list of pattern rows. Tapping a row
          narrows the challenge grid to that pattern. */}
      {sourceTab === 'yours' && (() => {
        const positions = allPositions;
        if (positions.length === 0) return null;
        const gameResultMap = new Map<string, string>();
        for (const g of allGames) gameResultMap.set(g.id, g.player.result);
        const stats = new Map<string, { cps: number[]; lost: Set<string>; total: Set<string> }>();
        for (const p of positions) {
          const e = stats.get(p.patternTheme) ?? { cps: [], lost: new Set<string>(), total: new Set<string>() };
          e.cps.push(p.cpLoss);
          e.total.add(p.gameId);
          if (gameResultMap.get(p.gameId) === 'loss') e.lost.add(p.gameId);
          stats.set(p.patternTheme, e);
        }
        const median = (arr: number[]) => { const s = [...arr].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] ?? 0; };
        // \u2500\u2500 Impact score (single source of truth for sort + tier badge) \u2500\u2500
        //
        //   impactScore = totalCpLost \u00d7 lossRate
        //
        //     totalCpLost = median(cp) \u00d7 occurrences  \u2192 total damage in cp
        //     lossRate    = lostGames / totalGames   \u2192 how often you actually lose
        //
        // This weights three things together: how big each mistake is (median cp),
        // how often this pattern shows up (occurrences), and how strongly it
        // correlates with losing the game (lossRate). The same formula drives
        // both the rank order in this list and the HIGH/MEDIUM/LOW pill on
        // each card, so they always agree.
        const computeImpact = (cps: number[], lossRate: number) => median(cps) * cps.length * (lossRate / 100);
        const sorted = [...stats.entries()].sort(([, a], [, b]) => {
          const aLossRate = a.total.size > 0 ? (a.lost.size / a.total.size) * 100 : 0;
          const bLossRate = b.total.size > 0 ? (b.lost.size / b.total.size) * 100 : 0;
          return computeImpact(b.cps, bLossRate) - computeImpact(a.cps, aLossRate);
        });

        // Worst-pattern hero \u2014 only when no pattern is selected (otherwise
        // the user is already drilled in and the hero would be redundant).
        const worst = sorted[0];
        const worstPositions = worst ? positions.filter((p) => p.patternTheme === worst[0]).length : 0;

        return (
          <>
            {!patternFilter && worst && worstPositions > 0 && (() => {
              const [theme, s] = worst;
              const med = median(s.cps);
              // Rough "rating points lost" estimate: 100cp ≈ 1 rating
              // point of expected outcome on average.
              const ratingPointsLost = Math.max(1, Math.round((med * s.cps.length) / 100));
              const gamesAffected = s.total.size;
              const cat = getCategory(theme);
              const catColor = cat !== 'all' ? (CATEGORY_COLORS[cat] ?? CATEGORY_COLORS.Positional) : null;
              return (
                <div className="mb-3 rounded-xl bg-chess-surface/60 border border-chess-accent/40 shadow-[0_0_24px_rgba(74,222,128,0.1)] p-3.5">
                  {catColor && (
                    <span className={`inline-block px-2 py-0.5 rounded-md text-[10px] font-extrabold uppercase tracking-[1.3px] ${catColor.bg} ${catColor.text} mb-2`}>
                      {t('tm_worst_pattern_label')}
                    </span>
                  )}
                  <div className="text-[18px] font-extrabold text-chess-text leading-tight">
                    {t('tm_start_with', { pattern: patternLabel(theme, t) })}
                  </div>
                  <p className="text-[12px] text-chess-text-tertiary leading-snug mt-1">
                    {t(gamesAffected === 1 ? 'tm_worst_pattern_desc_one' : 'tm_worst_pattern_desc_other', {
                      points: ratingPointsLost,
                      count: gamesAffected,
                      positions: worstPositions,
                    })}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setPatternFilter(theme);
                      setVisibleCount(PAGE_SIZE);
                      // Pick the LEAST-played position for this theme so the
                      // CTA respects the same "no replay before the rest"
                      // ordering the list uses. New (count = 0) come first;
                      // ties broken by original order.
                      const candidates = positions.filter((p) => p.patternTheme === theme);
                      candidates.sort((a, b) => {
                        const ca = playCounts.get(getChallengeKey(a)) ?? 0;
                        const cb = playCounts.get(getChallengeKey(b)) ?? 0;
                        return ca - cb;
                      });
                      const firstPos = candidates[0];
                      if (firstPos) startChallenge(firstPos);
                    }}
                    className="w-full mt-3 flex items-center justify-center gap-2 rounded-xl bg-chess-accent text-black py-3 font-extrabold text-[14px] transition-all hover:brightness-110 hover:shadow-[inset_0_2px_0_rgba(255,255,255,0.28),inset_0_-3px_0_rgba(0,0,0,0.18),0_6px_14px_rgba(74,222,128,0.35),0_2px_4px_rgba(0,0,0,0.25)] active:translate-y-px active:shadow-[inset_0_2px_4px_rgba(0,0,0,0.18),0_2px_6px_rgba(74,222,128,0.25)]"
                  >
                    <svg viewBox="0 0 24 24" width={18} height={18} fill="currentColor" aria-hidden>
                      <polygon points="6 4 20 12 6 20" />
                    </svg>
                    {t('tm_start_playing')}
                    <span className="px-2 py-0.5 rounded-full bg-black/15 text-[11px] font-extrabold tabular-nums">
                      {t('tm_replays_count', { count: worstPositions })}
                    </span>
                  </button>
                </div>
              );
            })()}

            <div className="mb-3 space-y-1.5">
              {patternFilter ? (
                <button
                  type="button"
                  onClick={() => { setPatternFilter(null); setVisibleCount(PAGE_SIZE); }}
                  className="inline-flex items-center gap-1.5 text-[12px] font-bold text-chess-accent hover:text-chess-accent/80 px-0.5"
                >
                  <svg viewBox="0 0 24 24" width={12} height={12} fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                  {t('tm_show_all_patterns')}
                </button>
              ) : (
                <p className="text-[12px] text-gray-400 px-0.5">
                  {t('tm_patterns_intro', { category: '' })}
                </p>
              )}
              {(patternFilter ? sorted.filter(([t2]) => t2 === patternFilter) : sorted).map(([theme, s], idx) => {
                const isActive = patternFilter === theme;
                const lossRate = s.total.size > 0 ? Math.round((s.lost.size / s.total.size) * 100) : 0;
                const cat = getCategory(theme);
                const catColor = cat !== 'all' ? (CATEGORY_COLORS[cat] ?? CATEGORY_COLORS.Positional) : null;
                const catLabel = cat !== 'all' && CATEGORY_KEYS[cat] ? t(CATEGORY_KEYS[cat]) : '';
                // Single impact tier — same formula as the list sort above
                // (totalCp × lossRate), so the badge always matches the rank.
                // Thresholds calibrated empirically on typical user data:
                //   HIGH ≥ 4000  (e.g. 200cp × 20 occurrences × 100% loss)
                //   MEDIUM ≥ 1200
                //   LOW < 1200
                const impactScore = computeImpact(s.cps, lossRate);
                const impactTier: 'high' | 'medium' | 'low' = impactScore >= 4000 ? 'high' : impactScore >= 1200 ? 'medium' : 'low';
                return (
                  <div
                    key={theme}
                    onClick={() => {
                      setPatternFilter(isActive ? null : theme);
                      setVisibleCount(PAGE_SIZE);
                    }}
                    className={`relative bg-chess-surface rounded-xl px-3.5 py-3 border cursor-pointer transition-all ${
                      isActive
                        ? 'border-chess-accent/50 shadow-[0_0_18px_rgba(74,222,128,0.1)]'
                        : 'border-transparent hover:border-chess-border/40'
                    }`}
                  >
                    <span className="absolute top-2 left-2 z-10 inline-flex items-center justify-center w-6 h-6 rounded-full bg-chess-bg/80 border border-chess-border/40 text-[11px] font-black text-chess-text-tertiary tabular-nums">
                      {idx + 1}
                    </span>
                    <div className="flex items-center gap-3 ps-7">
                      <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${isActive ? 'bg-chess-accent/15' : 'bg-chess-bg/50'}`}>
                        <PatternIcon theme={theme} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className="block text-[18px] font-extrabold text-chess-text leading-tight break-words">
                          {patternLabel(theme, t)}
                        </span>
                        {catColor && catLabel && (
                          <span className={`inline-block mt-1 px-2 py-0.5 rounded-md text-[10px] font-extrabold uppercase tracking-[1.3px] ${catColor.bg} ${catColor.text}`}>
                            {catLabel}
                          </span>
                        )}
                      </div>
                      <ImpactRing tier={impactTier} />
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 text-chess-text-tertiary transition-transform ${isActive ? 'rotate-90 text-chess-accent' : ''}`}>
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        );
      })()}

      {/* Results count */}
      <div className="text-xs text-gray-500 mb-2 px-0.5">
        {t('tm_positions', { count: displayPositions.length })}
        {timeClassFilter && <span> {'\u00B7'} {timeClassFilter}</span>}
      </div>

      {/* Position grid — full-width boards */}
      <div ref={(el) => {
        (gridRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
        if (el) {
          // On md+ we have 2 columns with gap-2 (8px), so each card is roughly half the grid width minus half the gap
          const isMd = window.innerWidth >= 768;
          const size = isMd ? Math.floor((el.offsetWidth - 8) / 2) : window.innerWidth - 32;
          if (size !== cardBoardSize) setCardBoardSize(size);
        }
      }} className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {visiblePositionsSlice.map((item, idx) => {
          const sev = severityLabel(item.cpLoss, t);
          const catColor = CATEGORY_COLORS[item.category] ?? CATEGORY_COLORS.Positional;
          const playCount = playCounts.get(getChallengeKey(item)) ?? 0;
          const isCompleted = playCount > 0;
          return (
            <button
              key={`${item.gameId}-${item.moveIndex}-${idx}`}
              onClick={() => startChallenge(item)}
              className={`w-full rounded-xl bg-chess-surface/15 border overflow-hidden transition-all text-left group ${
                isCompleted
                  ? 'border-chess-accent/25 opacity-70 hover:opacity-100 hover:border-chess-accent/50'
                  : 'border-chess-border/15 hover:border-chess-accent/30 hover:bg-chess-surface/25'
              }`}
            >
              {/* Board with centered play overlay */}
              <div className="w-full relative">
                <div className="pointer-events-none">
                  <ThemedChessboard
                    position={item.fen}
                    boardOrientation={item.playerColor === 'black' ? 'black' : 'white'}
                    boardWidth={cardBoardSize}
                    arePiecesDraggable={false}
                  />
                </div>
                {/* Play button overlay — centered on board */}
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="w-14 h-14 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center group-hover:bg-white/30 group-hover:scale-110 transition-all shadow-lg shadow-black/20">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="white" className="ml-1 drop-shadow-md"><polygon points="6,3 20,12 6,21" /></svg>
                  </div>
                </div>
                {/* Completed checkmark badge — top-right corner of the board.
                    On replays (count > 1) a tiny `×N` chip sits next to the
                    ✓ so the user knows it's their nth attempt. */}
                {isCompleted && (
                  <div className="absolute top-2 end-2 flex items-center gap-1 pointer-events-none">
                    {playCount > 1 && (
                      <span className="text-[10px] font-extrabold tabular-nums px-1.5 py-0.5 rounded-md bg-black/65 text-chess-accent border border-chess-accent/40 leading-none">
                        ×{playCount}
                      </span>
                    )}
                    <div className="w-8 h-8 rounded-full bg-chess-accent flex items-center justify-center shadow-lg shadow-black/30">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    </div>
                  </div>
                )}
              </div>
              {/* Info row — pattern + category chips, who played, when */}
              <div className="px-4 py-3.5 flex flex-col gap-1.5">
                {/* Pattern chip + category chip + severity chip */}
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="inline-flex items-center gap-1.5 text-[11px] px-2 py-0.5 rounded-md bg-chess-bg/60 border border-chess-border/30 text-chess-text font-bold">
                    <span className="opacity-80"><PatternIcon theme={item.patternTheme} /></span>
                    {patternLabel(item.patternTheme, t)}
                  </span>
                  <span className={`text-[11px] px-2 py-0.5 rounded-md ${catColor.bg} ${catColor.text} font-bold`}>{CATEGORY_KEYS[item.category] ? t(CATEGORY_KEYS[item.category]) : item.category}</span>
                  <span className={`text-[11px] px-2 py-0.5 rounded-md ${sev.bg} ${sev.color} font-bold`}>{sev.text}</span>
                </div>
                {/* Who + when + time class */}
                {(() => {
                  const game = allGames.find((g) => g.id === item.gameId);
                  const player = game?.player?.username ?? '';
                  const opp = item.gameOpponent;
                  const playedAtMs = game?.playedAt ?? 0;
                  const dateStr = playedAtMs > 0
                    ? new Date(playedAtMs).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
                    : '';
                  return (
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-[13px] text-gray-300 font-medium truncate">
                        {sourceTab !== 'yours' && player && (
                          <><span className="text-white">{player}</span> <span className="text-gray-500">vs</span> </>
                        )}
                        {sourceTab === 'yours' && <span className="text-gray-500">vs </span>}
                        <span className="text-white">{opp}</span>
                        <span className="text-gray-500"> ({item.gameRating})</span>
                      </span>
                      <span className="text-[11px] text-gray-500 font-medium shrink-0">
                        {dateStr ? `${dateStr} · ` : ''}{item.gameTimeClass}
                      </span>
                    </div>
                  );
                })()}
              </div>
            </button>
          );
        })}
      </div>

      {/* Load more */}
      {hasMore && (
        <button
          onClick={loadMore}
          className="w-full mt-3 py-2.5 rounded-xl bg-chess-surface/20 border border-chess-border/15 text-xs text-gray-400 hover:text-chess-text hover:bg-chess-surface/30 transition-all"
        >
          Load more ({displayPositions.length - visibleCount} remaining)
        </button>
      )}

      {/* Floating "X challenges below" pill — only when a pattern is
          selected and there are positions to scroll to. Subtle dark
          background with a light-green stroke so it sits above the chess
          board without competing with it. Fades away as soon as the user
          starts scrolling (they got the hint). */}
      {patternFilter && displayPositions.length > 0 && (
        <button
          type="button"
          onClick={() => gridRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          className="fixed end-4 z-[60] inline-flex items-center gap-1.5 px-3 py-2 rounded-full text-[12px] font-bold backdrop-blur-md transition-all duration-300 active:scale-95 hover:brightness-125"
          style={{
            background: 'rgba(8, 12, 20, 0.78)',
            border: '1px solid rgba(74, 222, 128, 0.55)',
            color: 'rgb(134, 239, 172)',
            boxShadow: '0 6px 20px rgba(0, 0, 0, 0.45)',
            opacity: scrolledAway ? 0 : 0.92,
            transform: scrolledAway ? 'translateY(8px)' : 'translateY(0)',
            pointerEvents: scrolledAway ? 'none' : 'auto',
          }}
        >
          <span className="tabular-nums font-extrabold">{displayPositions.length}</span>
          <span>{displayPositions.length === 1 ? 'challenge' : 'challenges'} below</span>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      )}

      {/* Per-pattern info popup */}
      {infoPatternTheme && (
        <InfoPopup
          title={patternLabel(infoPatternTheme, t)}
          body={getThemeDescription(infoPatternTheme)}
          onClose={() => setInfoPatternTheme(null)}
        />
      )}
    </div>
  );
}

/* ── Small "i" info button + popup, used to hide the long tm_desc paragraph
       behind a tap so the page header can be a one-line tagline. ── */
function InfoButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="More info"
      className="inline-flex items-center justify-center w-5 h-5 rounded-full border border-chess-border/50 text-chess-text-tertiary hover:text-chess-accent hover:border-chess-accent/60 transition-colors text-[11px] font-bold"
    >
      i
    </button>
  );
}

/* ── Hybrid Salvage (C) design components ──
 *  Implementing the design from time-machine-c.jsx in the existing flow.
 *  Concept: a "row" is 6 consecutive replays. Progress bar at top, AI SAYS
 *  panel for guidance, halfway checkpoint after 3, row complete summary after 6. */

const ROW_SIZE = 6;

type RowResult = 'win' | 'loss';
type AITone = 'neutral' | 'cautious' | 'proud' | 'info' | 'hint';

const TONE_COLORS: Record<AITone, string> = {
  neutral: 'rgb(148,163,184)',  // gray
  cautious: 'rgb(248,113,113)', // red
  proud: 'rgb(74,222,128)',     // accent green
  info: 'rgb(167,139,250)',     // purple
  hint: 'rgb(251,191,36)',      // amber/yellow — for active-hint mode
};

/** ROW progress bar — 6 dots showing ✓/✗ for past positions, current highlighted. */
function RunProgress({ results, current, total = ROW_SIZE }: { results: RowResult[]; current: number; total?: number }) {
  const { t } = useT();
  const wins = results.filter(r => r === 'win').length;
  const losses = results.filter(r => r === 'loss').length;
  return (
    <div className="pb-2">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-extrabold tracking-[0.9px] text-chess-text-tertiary">
          {t('tm_row_position', { current: current + 1, total })}
        </span>
        <span className="inline-flex items-center gap-1.5 text-[12px] font-extrabold tabular-nums text-gray-300">
          <span className="text-chess-accent">{wins} ✓</span>
          <span className="text-chess-text-tertiary">·</span>
          <span className="text-red-400">{losses} ✗</span>
        </span>
      </div>
      <div className="flex gap-1">
        {Array.from({ length: total }).map((_, i) => {
          const r = results[i];
          const isCurrent = i === current;
          let bg = 'rgba(30,58,95,0.25)';
          let dot: string | null = null;
          if (r === 'win') { bg = 'rgb(74,222,128)'; dot = '✓'; }
          else if (r === 'loss') { bg = 'rgb(248,113,113)'; dot = '✗'; }
          return (
            <div key={i} className="flex-1 h-2.5 rounded-[5px] relative" style={{
              background: bg,
              boxShadow: isCurrent ? '0 0 0 2px var(--chess-bg, #0a0f1a), 0 0 0 3px rgb(74,222,128)' : 'none',
            }}>
              {dot && (
                <span className="absolute inset-0 flex items-center justify-center text-[9px] font-black text-chess-bg">{dot}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** AI SAYS panel — single-line summary with the DNA mark, tone-based color.
 *  Optional onDismiss renders a small × in the corner (used by the hint
 *  variant so the user can clear the hint and return to the original
 *  instruction). */
function AISays({ tone = 'neutral', children, onDismiss }: { tone?: AITone; children: React.ReactNode; onDismiss?: () => void }) {
  const accent = TONE_COLORS[tone];
  return (
    <div
      className="rounded-xl px-3 py-2.5 flex items-center gap-3 relative"
      style={{ background: 'rgba(17,24,39,0.6)', border: `1px solid ${accent}55` }}
    >
      <div
        className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
        style={{
          // DNA helix is the brand mark — always green regardless of the
          // panel's tone, so it never reads as a "warning" itself.
          background: 'linear-gradient(135deg, rgba(74,222,128,0.16), rgba(74,222,128,0.05))',
          border: '1px solid rgba(74,222,128,0.45)',
          color: 'rgb(74,222,128)',
        }}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <g transform="rotate(45 12 12)">
            <path d="M8 2c0 6.5 8 12.5 8 19" />
            <path d="M16 2c0 6.5-8 12.5-8 19" />
            <line x1="9.2" y1="5.5" x2="14.8" y2="5.5" />
            <line x1="11" y1="8.5" x2="13" y2="8.5" />
            <line x1="11" y1="14.5" x2="13" y2="14.5" />
            <line x1="9.2" y1="17.5" x2="14.8" y2="17.5" />
          </g>
        </svg>
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] leading-snug text-chess-text font-medium">
          {children}
        </div>
      </div>
      {onDismiss && (
        <button
          onClick={onDismiss}
          aria-label="Dismiss"
          className="shrink-0 w-6 h-6 rounded-full text-chess-text-tertiary hover:text-chess-text hover:bg-white/[0.06] inline-flex items-center justify-center transition-colors"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      )}
    </div>
  );
}

/** Auto-advance countdown ring — replaces the silent timer with a visible signal. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function AutoAdvance({ tone = 'win', secondsLeft }: { tone?: 'win' | 'loss'; secondsLeft: number }) {
  const accent = tone === 'win' ? 'rgb(74,222,128)' : 'rgb(251,191,36)';
  const total = 5;
  const progress = Math.max(0, Math.min(1, secondsLeft / total));
  const circumference = 2 * Math.PI * 9;
  return (
    <div
      className="inline-flex items-center gap-2 rounded-lg px-2.5 py-1.5"
      style={{ background: 'rgba(17,24,39,0.85)', border: `1px solid ${accent}55` }}
    >
      <div className="relative w-[22px] h-[22px]">
        <svg width="22" height="22" viewBox="0 0 22 22" style={{ transform: 'rotate(-90deg)' }}>
          <circle cx="11" cy="11" r="9" fill="none" stroke="rgba(30,58,95,0.4)" strokeWidth="2.5" />
          <circle cx="11" cy="11" r="9" fill="none" stroke={accent} strokeWidth="2.5" strokeLinecap="round"
                  strokeDasharray={`${circumference * progress} ${circumference}`} />
        </svg>
      </div>
      <span className="text-[12px] font-extrabold text-chess-text">
        Next in <b style={{ color: accent }}>{Math.max(0, Math.ceil(secondsLeft))}s</b>
      </span>
    </div>
  );
}
void AutoAdvance;

function InfoPopup({ title, body, onClose }: { title: string; body: string; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[120] bg-black/70 flex items-center justify-center p-5"
      onClick={onClose}
    >
      <div
        className="max-w-sm w-full bg-chess-surface border border-chess-border/40 rounded-2xl p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 mb-2.5">
          <h3 className="text-base font-extrabold text-chess-text">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-chess-text-tertiary hover:text-chess-text -mt-0.5 -me-0.5 p-1"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <p className="text-sm text-chess-text-secondary leading-relaxed">{body}</p>
        <button
          type="button"
          onClick={onClose}
          className="w-full mt-4 py-2.5 rounded-xl bg-chess-accent/15 text-chess-accent border border-chess-accent/40 text-sm font-bold hover:bg-chess-accent/25 transition-all"
        >
          Got it
        </button>
      </div>
    </div>
  );
}

/* ─────────────── Source filter helpers ─────────────── */

const MAX_FRIENDS = 5;
const MAX_TOP_PLAYERS = 6;

const TOP_PLAYERS: ReadonlyArray<{ username: string; name: string; flag: string }> = [
  { username: 'MagnusCarlsen',     name: 'Magnus Carlsen',     flag: '🇳🇴' },
  { username: 'Hikaru',            name: 'Hikaru Nakamura',    flag: '🇺🇸' },
  { username: 'FabianoCaruana',    name: 'Fabiano Caruana',    flag: '🇺🇸' },
  { username: 'AnishGiri',         name: 'Anish Giri',         flag: '🇳🇱' },
  { username: 'LevonAronian',      name: 'Levon Aronian',      flag: '🇺🇸' },
  { username: 'DanielNaroditsky',  name: 'Daniel Naroditsky',  flag: '🇺🇸' },
];

function SourceTabs({
  active,
  onChange,
  forYouCount,
  followingCount,
}: {
  active: 'yours' | 'following';
  onChange: (s: 'yours' | 'following') => void;
  forYouCount: number;
  followingCount: number;
}) {
  const tabs: Array<{ id: 'yours' | 'following'; label: string; count: number }> = [
    { id: 'yours', label: 'For you', count: forYouCount },
    { id: 'following', label: 'Following', count: followingCount },
  ];
  return (
    <div className="flex items-center gap-6 mb-4 border-b border-chess-border/20">
      {tabs.map((tab) => {
        const isActive = active === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            className={`relative flex items-center gap-2 pb-2 text-[15px] font-extrabold transition-colors ${
              isActive ? 'text-chess-accent' : 'text-gray-500 hover:text-chess-text'
            }`}
          >
            <span>{tab.label}</span>
            <span className={`inline-flex items-center justify-center min-w-6 px-1.5 py-0.5 rounded-full text-[11px] font-bold tabular-nums ${
              isActive ? 'bg-chess-accent/15 text-chess-accent' : 'bg-chess-surface/60 text-gray-500'
            }`}>
              {tab.count}
            </span>
            {isActive && <span aria-hidden className="absolute left-0 right-0 -bottom-px h-[2px] bg-chess-accent rounded-full" />}
          </button>
        );
      })}
    </div>
  );
}

function Spinner() {
  return (
    <span
      aria-label="Loading"
      className="inline-block w-4 h-4 rounded-full border-2 border-chess-accent/30 border-t-chess-accent animate-spin shrink-0"
    />
  );
}

/* Impact ring badge — replaces the old 3-tile KPI grid on pattern cards.
 * One glanceable circular indicator: red for high impact, amber for
 * medium, green for low. The arc fill animates around the circle to
 * reinforce the tier. */
function ImpactRing({ tier }: { tier: 'high' | 'medium' | 'low' }) {
  const size = 62;
  const r = (size - 6) / 2;
  const c = 2 * Math.PI * r;
  const fillPct = tier === 'high' ? 0.85 : tier === 'medium' ? 0.55 : 0.25;
  const colorHex = tier === 'high' ? '#f87171' : tier === 'medium' ? '#fbbf24' : '#4ade80';
  const offset = c * (1 - fillPct);
  const label = tier === 'high' ? 'HIGH' : tier === 'medium' ? 'MEDIUM' : 'LOW';
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={3} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={colorHex}
          strokeWidth={3}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center leading-none">
        <span className="text-[10px] font-extrabold tracking-[0.5px]" style={{ color: colorHex }}>{label}</span>
        <span className="text-[8px] font-bold uppercase tracking-[1.2px] text-chess-text-tertiary mt-0.5">Impact</span>
      </div>
    </div>
  );
}

/* Pill-style dropdown filter chip — used on the Following tab for
 * People / Pattern / Skill. A native <select> is layered transparently
 * on top of the styled label so the OS picker shows up on tap (mobile
 * gets a proper sheet, desktop gets the native menu). */
function FilterChip({
  label,
  value,
  icon,
  options,
  onChange,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  const active = value !== '';
  const selectedLabel = active ? (options.find((o) => o.value === value)?.label ?? value) : label;
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  // Close the menu on outside-click and Escape so the dropdown feels
  // like a proper popover, not a stuck panel.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDocClick);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={wrapperRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => (active ? onChange('') : setOpen((o) => !o))}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-full border transition-colors ${
          active
            ? 'bg-chess-accent/10 border-chess-accent/40 text-chess-accent'
            : 'bg-chess-surface/60 border-chess-border/30 text-chess-text hover:border-chess-accent/30'
        }`}
      >
        <span className={active ? 'text-chess-accent' : 'text-chess-text-tertiary'}>{icon}</span>
        <span className="text-[12px] font-bold whitespace-nowrap max-w-[120px] truncate">{selectedLabel}</span>
        {active ? (
          <svg viewBox="0 0 24 24" width={11} height={11} fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        ) : (
          <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" className={`text-chess-text-tertiary transition-transform ${open ? 'rotate-180' : ''}`}>
            <polyline points="6 9 12 15 18 9" />
          </svg>
        )}
      </button>
      {open && !active && (
        <div
          role="listbox"
          aria-label={label}
          className="absolute z-30 mt-1.5 min-w-[180px] max-h-[280px] overflow-y-auto rounded-xl border border-chess-border/40 bg-chess-surface/95 backdrop-blur-md shadow-[0_12px_32px_rgba(0,0,0,0.5)] py-1"
        >
          {options.length === 0 ? (
            <div className="px-3 py-2 text-[12px] text-chess-text-tertiary">No options</div>
          ) : (
            options.map((o) => (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={value === o.value}
                onClick={() => { onChange(o.value); setOpen(false); }}
                className={`w-full text-left px-3 py-2 text-[13px] font-medium transition-colors ${
                  value === o.value
                    ? 'bg-chess-accent/15 text-chess-accent'
                    : 'text-chess-text hover:bg-chess-overlay'
                }`}
              >
                {o.label}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

/* Replays brand glyph — circle with a play triangle, used in the page
 * header next to the "Replays" title. */
function ReplayBrandIcon() {
  return (
    <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <polygon points="10 8 16 12 10 16" fill="currentColor" stroke="none" />
    </svg>
  );
}

function PersonIconSm() {
  return (
    <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function RobotIconSm() {
  return (
    <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="4" y="7" width="16" height="12" rx="2" />
      <circle cx="9" cy="13" r="1" fill="currentColor" />
      <circle cx="15" cy="13" r="1" fill="currentColor" />
      <path d="M12 7V3" />
      <path d="M8 19v2M16 19v2" />
    </svg>
  );
}

function InfoIconSm() {
  return (
    <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="11" x2="12" y2="17" />
      <circle cx="12" cy="7.5" r="0.6" fill="currentColor" />
    </svg>
  );
}

/* ─────────────── Following manager ───────────────
 *  Replaces the old separate Friends + Top Players panels with a single
 *  unified picker. Suggested-to-follow cards (top players + your most-
 *  played opponents) live in a horizontal scroller at the top; followed
 *  usernames appear below as removable chips. */
function FollowingManager({
  friends,
  followedTop,
  pendingUsernames,
  suggestions,
  onAddFriend,
  onRemoveFriend,
  onToggleTop,
}: {
  friends: string[];
  followedTop: string[];
  pendingUsernames: Set<string>;
  /** Most-played opponents from the user's games — surface as friend suggestions. */
  suggestions: string[];
  onAddFriend: (username: string) => Promise<void> | void;
  /** Reserved — wired through the API for an inline "remove follow" affordance
   *  added later (currently unused after the chip row was removed in favor of
   *  the People filter chip). */
  onRemoveFriend: (username: string) => Promise<void> | void;
  onToggleTop: (username: string) => Promise<void> | void;
}) {
  void onRemoveFriend;
  const followedTopSet = useMemo(() => new Set(followedTop.map((u) => u.toLowerCase())), [followedTop]);
  const friendSet = useMemo(() => new Set(friends.map((u) => u.toLowerCase())), [friends]);

  // Build the suggestion list: top players the user hasn't followed yet,
  // followed by friend suggestions. Each row in the carousel knows whether
  // tapping "Follow" should follow a top-player or add a friend.
  type SuggestEntry =
    | { kind: 'top'; username: string; name: string; flag: string; subtitle: string }
    | { kind: 'friend'; username: string; subtitle: string };
  const suggestionEntries = useMemo<SuggestEntry[]>(() => {
    const out: SuggestEntry[] = [];
    for (const p of TOP_PLAYERS) {
      // Followed players stay in the list — the card flips to UNFOLLOW
      // so the user can confirm the action and easily reverse it.
      out.push({ kind: 'top', username: p.username, name: p.name, flag: p.flag, subtitle: 'Top player' });
    }
    for (const u of suggestions) {
      out.push({ kind: 'friend', username: u, subtitle: 'Played you recently' });
    }
    return out;
  }, [suggestions]);

  const followedUsernames = useMemo(
    () => [...friends, ...followedTop],
    [friends, followedTop],
  );

  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const trimmed = input.trim();
    if (!trimmed || busy) return;
    if (friends.length >= MAX_FRIENDS) {
      setError(`Max ${MAX_FRIENDS} friends. Remove one to add another.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const resp = await fetchChessCom(`${CHESS_COM_API_BASE}/player/${trimmed.toLowerCase()}`);
      if (!resp.ok) {
        setError('Username not found on chess.com');
        return;
      }
      await onAddFriend(trimmed);
      setInput('');
    } catch {
      setError('Failed to verify username');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-4">
      {/* Suggested-for-you carousel */}
      {suggestionEntries.length > 0 && (
        <div className="mb-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[12px] font-extrabold text-chess-text">
              Suggested for you · {suggestionEntries.length}
            </span>
          </div>
          <div className="-mx-1 px-1 flex gap-2 overflow-x-auto scrollbar-hide">
            {suggestionEntries.map((s) => {
              const lower = s.username.toLowerCase();
              const loading = pendingUsernames.has(lower);
              const isFollowed = s.kind === 'top'
                ? followedTopSet.has(lower)
                : friendSet.has(lower);
              const accentRing = s.kind === 'top' ? 'ring-purple-400/30' : 'ring-sky-400/25';
              const onClickFollow = () => {
                if (loading) return;
                if (s.kind === 'top') onToggleTop(s.username);
                else if (isFollowed) onRemoveFriend(s.username);
                else onAddFriend(s.username);
              };
              const buttonLabel = loading
                ? (<><Spinner /><span>Adding replays</span></>)
                : isFollowed ? 'Unfollow' : 'Follow';
              const buttonClass = isFollowed
                ? 'bg-chess-surface text-chess-text border border-chess-border/40 hover:border-chess-blunder/50 hover:text-chess-blunder'
                : 'bg-chess-accent text-black';
              return (
                <div
                  key={s.username}
                  className={`shrink-0 w-[160px] rounded-2xl bg-chess-surface/60 border p-3 flex flex-col items-center text-center transition-colors ${
                    isFollowed ? 'border-chess-accent/40' : 'border-chess-border/30'
                  }`}
                >
                  <div className={`rounded-full ring-2 ${accentRing} overflow-hidden`}>
                    <PlayerAvatar username={s.username} size={64} />
                  </div>
                  <div className="mt-2 flex items-center gap-1 max-w-full">
                    {s.kind === 'top' && <span className="text-[12px] leading-none">{s.flag}</span>}
                    <span className="text-[12px] font-extrabold text-chess-text truncate">
                      {s.kind === 'top' ? s.name : s.username}
                    </span>
                  </div>
                  <div className="text-[10px] text-chess-text-tertiary mt-0.5 leading-tight line-clamp-2 min-h-[24px]">
                    {isFollowed && !loading ? 'Following' : s.subtitle}
                  </div>
                  <button
                    onClick={onClickFollow}
                    disabled={loading}
                    className={`w-full mt-2 py-1.5 rounded-md text-[11px] font-extrabold uppercase tracking-[1.4px] disabled:opacity-60 flex items-center justify-center gap-1 transition-colors ${buttonClass}`}
                  >
                    {buttonLabel}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Free-form add chess.com username */}
      <div className="flex gap-2 mb-2">
        <input
          type="text"
          value={input}
          onChange={(e) => { setInput(e.target.value); setError(null); }}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
          placeholder="Add chess.com username"
          disabled={busy || friends.length >= MAX_FRIENDS}
          className="flex-1 px-3 py-2 rounded-lg bg-chess-bg/60 border border-chess-border/30 text-sm text-chess-text placeholder-gray-500 focus:outline-none focus:border-chess-accent/50 transition-colors disabled:opacity-50"
        />
        <button
          onClick={submit}
          disabled={busy || !input.trim() || friends.length >= MAX_FRIENDS}
          className="px-3 py-2 rounded-lg bg-chess-accent text-black text-[12px] font-extrabold uppercase tracking-[1.4px] disabled:opacity-50"
        >
          {busy ? 'Adding…' : 'Add'}
        </button>
      </div>
      {error && <div className="text-[11px] text-chess-blunder mb-2">{error}</div>}

      {/* Followed-list chips removed — the People filter chip on the
          Following tab now exposes the same set of usernames and lets the
          user filter / unfollow from there. */}
      {followedUsernames.length === 0 && suggestionEntries.length === 0 && (
        <div className="text-[11px] text-chess-text-tertiary italic mt-2">
          Add a chess.com username — their last game becomes a challenge here.
        </div>
      )}
    </div>
  );
}


import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { useChessData } from '@/contexts/ChessDataContext';
import { useAuth } from '@/contexts/AuthContext';
import { useTutorial } from '@/contexts/TutorialContext';
import { useTheme } from '@/components/ThemeContext';
import ThemedChessboard from '@/components/ThemedChessboard';
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
 *  MUST stay consistent with categoryFromMove() + themeFromMove(). */
function getCategory(theme: string): SkillCategory {
  if (['missed_fork', 'missed_pin', 'missed_skewer', 'missed_tactic_other'].includes(theme)) return 'Tactics';
  if (['hanging_piece', 'back_rank_weakness', 'king_safety'].includes(theme)) return 'Defense';
  if (['endgame_technique', 'endgame_pawn_play'].includes(theme)) return 'Endgame';
  if (['opening_inaccuracy', 'opening_specific'].includes(theme)) return 'Opening';
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

/* ── Challenge persistence ── */

const TM_STORAGE_KEY = 'chess-dna-timemachine-progress';

function getChallengeKey(item: PositionItem): string {
  return `${item.gameId}:${item.moveIndex}`;
}

function getCheckedKeys(): Set<string> {
  try {
    const data = localStorage.getItem(TM_STORAGE_KEY);
    if (!data) return new Set();
    const parsed = JSON.parse(data);
    return new Set(Object.keys(parsed.checked ?? {}));
  } catch { return new Set(); }
}

function markChallengeChecked(key: string): void {
  try {
    const data = localStorage.getItem(TM_STORAGE_KEY);
    const parsed = data ? JSON.parse(data) : { checked: {} };
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

  // Source tab: which population of games drives the patterns + challenge
  // list. Yours = the user's analyzed games; Friends = imported last-games
  // from added chess.com usernames; Top players = same, for the curated
  // top-player list.
  const [sourceTab, _setSourceTab] = useState<'yours' | 'friends' | 'top'>('yours');
  const setSourceTab = useCallback((s: 'yours' | 'friends' | 'top') => {
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
  const markPendingImport = useCallback((username: string) => {
    setPendingNonSelfImports((prev) => {
      const next = new Set(prev);
      next.add(username.toLowerCase());
      return next;
    });
  }, []);
  const clearPendingImport = useCallback((username: string) => {
    setPendingNonSelfImports((prev) => {
      if (!prev.has(username.toLowerCase())) return prev;
      const next = new Set(prev);
      next.delete(username.toLowerCase());
      return next;
    });
  }, []);

  // Reconcile followed/friended usernames against actual imported games.
  // Two responsibilities:
  //   1. If any friend/top-player has no Game in storage → import their
  //      latest chess.com game and queue it for analysis.
  //   2. If a friend/top-player game is already imported but analysis is
  //      pending or analyzing (or there's no Analysis record yet), re-queue
  //      it so the Stockfish pipeline picks it up. This catches games that
  //      were imported in a previous session with the queue stalled.
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
    const missing = targets.filter((u) => !presentUsernames.has(u.toLowerCase()));
    const analysisIds = new Set(dataSrc.allAnalyses.concat(dataSrc.friendAnalyses, dataSrc.topPlayerAnalyses).map((a) => a.gameId));
    const stalled = allNonSelf.filter((g) => g.analysisStatus !== 'complete' || !analysisIds.has(g.id));
    if (missing.length === 0 && stalled.length === 0) return;
    reconciledRef.current = true;
    (async () => {
      for (const u of missing) {
        try {
          const ids = await importChessComGames(u, { maxGames: 1, guest: isGuest });
          if (ids.length > 0) queueForAnalysis(ids);
        } catch (err) {
          console.warn('[TM] failed to import latest game for', u, err);
        }
      }
      if (stalled.length > 0) {
        queueForAnalysis(stalled.map((g) => g.id));
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

  // Pick the right data source for the active tab. Each non-self tab also
  // has its own per-username last-game so the patterns view stays scoped
  // to that group.
  const allAnalyses = sourceTab === 'yours'
    ? dataSrc.allAnalyses
    : sourceTab === 'friends'
      ? dataSrc.friendAnalyses
      : dataSrc.topPlayerAnalyses;
  const allGames = sourceTab === 'yours'
    ? dataSrc.allGames
    : sourceTab === 'friends'
      ? dataSrc.friendGames
      : dataSrc.topPlayerGames;
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
  const tmHeightCappedBoardSize = Math.max(viewportH - 460, 240);

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
  const [checkedKeys, setCheckedKeys] = useState<Set<string>>(() => getCheckedKeys());
  const [challengeItem, setChallengeItem] = useState<PositionItem | null>(null);
  const [challengeConfig, setChallengeConfig] = useState<ChallengeConfig | null>(null);
  const [challengeQueueIdx, setChallengeQueueIdx] = useState(-1); // -1 = not in queue mode

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
    if (preselectedTheme && allPositions.some(p => p.patternTheme === preselectedTheme)) {
      setPatternFilter(preselectedTheme);
      setCategoryFilter(getCategory(preselectedTheme));
    }
  }, [preselectedTheme, allPositions]);

  // Filter by category and pattern
  const filteredPositions = useMemo(() => {
    let list = allPositions;
    if (categoryFilter !== 'all') list = list.filter(p => p.category === categoryFilter);
    if (patternFilter) list = list.filter(p => p.patternTheme === patternFilter);
    return list;
  }, [allPositions, categoryFilter, patternFilter]);

  // Category counts removed alongside the category-filter row.

  // (pattern stats are computed inline in the Pattern Impact section)

  const loadMore = useCallback(() => setVisibleCount(c => c + PAGE_SIZE), []);

  // Start an interactive challenge (optionally with queue index)
  const startChallenge = useCallback((item: PositionItem, queueIdx?: number) => {
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
    });
    if (queueIdx !== undefined) setChallengeQueueIdx(queueIdx);

    // Push sub-URL so each challenge is shareable/bookmarkable
    setSearchParams({ game: item.gameId, move: String(item.moveIndex) }, { replace: false });
  }, [allAnalyses, setSearchParams]);

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
    const candidate = allPositions.find(p => p.gameId === gameIdToMatch) ?? allPositions[0];
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
  }, [autoStartFlag, allPositions, challengeItem, navState?.gameFilter, startChallenge]);

  // Use the challenge hook
  const { state: challengeState, advanceLeadup, undoMistake, onSquareClick, onPieceDrop, completePromotion, cancelPromotion, retry, replayLeadup, continueAfterScore, revealWithExplanation } = useTimeMachineChallenge(challengeConfig, settings ?? undefined, buildPrompt);

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

  // Ranked-move preview state (must be top-level, not inside conditional block)
  const [previewUci, setPreviewUci] = useState<string | null>(null);
  const [previewFen, setPreviewFenState] = useState<string | null>(null);
  const [selectedRowUci, setSelectedRowUci] = useState<string | null>(null); // which row is selected
  const [pvStep, setPvStep] = useState<number>(-1);
  const [pvChainData, setPvChainData] = useState<{ fens: string[]; ucis: string[] } | null>(null);
  const [expandedContIdx, setExpandedContIdx] = useState<number | null>(null);

  // Clear highlight and preview when challenge or phase changes
  useEffect(() => {
    setHighlightedSquare(null);
    setPreviewUci(null);
    setSelectedRowUci(null);
    setPvStep(-1);
    setPvChainData(null);
    setPreviewFenState(null);
    setExpandedContIdx(null);
  }, [challengeConfig, challengeState.phase]);

  // Auto-advance leadup moves
  useEffect(() => {
    if (!challengeConfig || challengeState.phase !== 'leadup') return;
    const timer = setTimeout(() => {
      advanceLeadup();
      playChessSound('move');
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

  // Mark challenge as checked on completion
  useEffect(() => {
    if (challengeState.phase === 'complete' && challengeItem) {
      const key = getChallengeKey(challengeItem);
      markChallengeChecked(key);
      setCheckedKeys(prev => new Set([...prev, key]));
      playChessSound('complete');
    }
  }, [challengeState.phase, challengeItem]);

  // Split positions into checked/unchecked
  const uncheckedPositions = useMemo(() => filteredPositions.filter(p => !checkedKeys.has(getChallengeKey(p))), [filteredPositions, checkedKeys]);
  const checkedPositions = useMemo(() => filteredPositions.filter(p => checkedKeys.has(getChallengeKey(p))), [filteredPositions, checkedKeys]);

  // Start next challenge in the queue (continuous flow)
  const startNextChallenge = useCallback(() => {
    const nextIdx = challengeQueueIdx + 1;
    if (nextIdx < uncheckedPositions.length) {
      startChallenge(uncheckedPositions[nextIdx], nextIdx);
    } else {
      // No more challenges — go back to list
      setChallengeItem(null);
      setChallengeConfig(null);
      setChallengeQueueIdx(-1);
    }
  }, [challengeQueueIdx, uncheckedPositions, startChallenge]);

  // Auto-advance to the next challenge 7s after the current one completes,
  // ONLY if the user is fully passive — any click within the window cancels
  // the auto-nav so users who are exploring the post-game review (Back,
  // expanding ranking tables, switching tabs, etc.) aren't yanked away
  // mid-thought. The phase-change cleanup also clears the timer when the
  // user clicks Next themselves or navigates away.
  useEffect(() => {
    if (challengeState.phase !== 'complete') return;
    let cancelled = false;
    const timer = setTimeout(() => {
      if (cancelled) return;
      // On the first auto-advance after the tutorial, also fire the
      // celebration coachmark — same UX as if the user clicked Next.
      tutorialTriggerStep(6);
      startNextChallenge();
    }, 7000);
    const onClick = () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener('click', onClick, true);
    };
    document.addEventListener('click', onClick, true);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener('click', onClick, true);
    };
  }, [challengeState.phase, startNextChallenge, tutorialTriggerStep]);

  // Combined list: unchecked challenges first, then completed (with checkmark).
  // Replaces the separate Challenges / Completed tabs.
  const displayPositions = useMemo(
    () => [...uncheckedPositions, ...checkedPositions],
    [uncheckedPositions, checkedPositions],
  );
  const visiblePositionsSlice = displayPositions.slice(0, visibleCount);
  const hasMore = visibleCount < displayPositions.length;

  // Category sorting removed alongside the category-filter UI.

  // Only early-return for the user's own tab \u2014 Friends/Top Players need the
  // full layout so the user can still add usernames or follow players.
  if (allPositions.length === 0 && sourceTab === 'yours') {
    return (
      <div className="text-center py-16">
        <div className="text-5xl mb-4 opacity-60">{'\u23F3'}</div>
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

  /* ── Interactive Challenge View ── */
  if (challengeItem && challengeConfig) {
    const item = challengeItem;
    const catColor = CATEGORY_COLORS[item.category] ?? CATEGORY_COLORS.Positional;
    const { phase, currentFen, criticalFen, fenAfterCritical: _fac, fenForContinuation: _ffc, opponentResponseSan: _ors, playerTurn, selectedSquare, legalMoves, opponentThinking, evaluating, lastMoveFrom, lastMoveTo, moveScore, moveScores, playerMoveSan: _pms, showAnswer, attempts, error: challengeError, aiExplanation, aiExplanationLoading, criticalRanking, continuationRanking: _cr, continuationMoves, continuationRankings, rankingLoading, pendingPromotion } = challengeState;
    void _pms;
    void _fac; void _ffc; void _ors; void _cr;

    // Use live ranking's top move as the authoritative "best" when available,
    // falling back to the stored analysis best move while ranking loads.
    const liveBest = criticalRanking.length > 0 ? criticalRanking.find(m => m.rank === 1) ?? criticalRanking[0] : null;
    const bestMoveUci = liveBest?.uci ?? item.bestMoveUci;
    const bestMoveSan = liveBest?.san ?? item.bestMoveSan;

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

    // In scored phase: always show the critical position (item.fen) so arrows reference real pieces.
    // Otherwise show the live game position (currentFen).
    const showArrows = phase === 'scored' && showAnswer;
    const baseFen = phase === 'scored' ? (criticalFen || item.fen) : currentFen;
    const displayFen = previewFen ?? baseFen;

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

    if (previewUci && isLegalUciOn(previewUci, displayFen)) {
      // Preview arrow: blue — shows the selected ranked move on the critical/continuation FEN.
      // Guarded by isLegalUciOn so we never draw a voodoo arrow from an empty square if the
      // displayed FEN drifts out of sync with the UCI.
      arrows.push(...expandArrow(previewUci, displayFen, 'rgba(96,165,250,0.85)'));
    } else if (showArrows) {
      const arrowFen = baseFen;
      // When the player's move is itself top-rank (multiple 100s, or
      // identical match), draw a single GREEN arrow for what they did.
      // Otherwise: green = best, red = attempt, orange = original mistake.
      if (playerScored100 || sameAsBest) {
        if (attemptUci && isLegalUciOn(attemptUci, arrowFen)) {
          arrows.push(...expandArrow(attemptUci, arrowFen, 'rgba(74,222,128,0.85)'));
        } else if (isLegalUciOn(bestMoveUci, arrowFen)) {
          arrows.push(...expandArrow(bestMoveUci, arrowFen, 'rgba(74,222,128,0.85)'));
        }
      } else {
        // Green: best move (from live ranking when available, else stored analysis)
        if (isLegalUciOn(bestMoveUci, arrowFen)) {
          arrows.push(...expandArrow(bestMoveUci, arrowFen, 'rgba(74,222,128,0.85)'));
        }
        // Red: what the player tried in this attempt (if different from best)
        if (attemptUci && attemptUci !== bestMoveUci && isLegalUciOn(attemptUci, arrowFen)) {
          arrows.push(...expandArrow(attemptUci, arrowFen, 'rgba(239,68,68,0.55)'));
        }
        // Orange: the original game mistake (if no attempt was made, i.e. player gave up)
        if (!attemptUci && item.playedMoveSan !== bestMoveSan) {
          const origUci = challengeConfig!.originalMoveUci;
          if (origUci && origUci !== bestMoveUci && isLegalUciOn(origUci, arrowFen)) {
            arrows.push(...expandArrow(origUci, arrowFen, 'rgba(251,146,60,0.6)'));
          }
        }
      }
    }

    // Square highlights — only when player can interact
    const squareStyles: Record<string, React.CSSProperties> = {};
    if (!showArrows) {
      if (selectedSquare) squareStyles[selectedSquare] = { backgroundColor: 'rgba(74,222,128,0.35)' };
      for (const sq of legalMoves) squareStyles[sq] = { background: 'radial-gradient(circle, rgba(74,222,128,0.25) 25%, transparent 25%)', borderRadius: '50%' };
      if (lastMoveFrom) squareStyles[lastMoveFrom] = { ...squareStyles[lastMoveFrom], backgroundColor: 'rgba(255,255,100,0.15)' };
      if (lastMoveTo) squareStyles[lastMoveTo] = { ...squareStyles[lastMoveTo], backgroundColor: 'rgba(255,255,100,0.25)' };
    }
    if (highlightedSquare) squareStyles[highlightedSquare] = { ...squareStyles[highlightedSquare], backgroundColor: 'rgba(59,130,246,0.5)', boxShadow: 'inset 0 0 0 2px rgba(59,130,246,0.8)' };

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

    // Status panel content (reused in both layouts)
    const statusPanel = (
      <div className="rounded-xl overflow-hidden border border-chess-border/20 bg-chess-surface/20">
        {phase === 'leadup' && (
          <div className="px-4 py-3 md:text-left text-center">
            <div className="text-sm text-gray-400">{t('tm_replaying')}</div>
            <div className="mt-2 flex items-center md:justify-start justify-center gap-2">
              <span className="w-2 h-2 rounded-full bg-chess-accent animate-pulse" />
              <span className="text-xs text-chess-accent">{t('tm_watch')}</span>
            </div>
          </div>
        )}
        {phase === 'showMistake' && (
          <div className="px-4 py-3 md:text-left text-center bg-chess-blunder/10">
            <div className="text-sm font-bold text-chess-blunder">{t('tm_this_is_what')}</div>
            <div className="text-xs text-gray-500 mt-1">{t('tm_rewinding')}</div>
          </div>
        )}
        {phase === 'critical' && (
          <div className="px-4 py-3 md:text-left text-center">
            {/* Headline — biggest, clearest action prompt. */}
            <div className="text-base md:text-lg font-black text-chess-accent leading-tight">
              {t('tm_find_better_move')}
            </div>

            {/* Context — who played the move (you, or the friend / top
                player whose game you're replaying). */}
            <div className="text-[13px] text-chess-text/70 mt-1 leading-snug">
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
            </div>

            {/* Subtle action row — escape hatch + attempt counter. */}
            <div className="flex items-center md:justify-start justify-center gap-3 mt-2">
              <button
                onClick={() => {
                  setHighlightedSquare(null);
                  revealWithExplanation();
                }}
                className="text-xs text-gray-400 hover:text-chess-text underline decoration-dotted underline-offset-4 transition-colors"
              >
                {t('tm_reveal_answer')}
              </button>
              {attempts > 0 && (
                <>
                  <span className="text-gray-600 text-xs">·</span>
                  <span className="text-xs text-gray-500">Attempt {attempts + 1}</span>
                </>
              )}
            </div>
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
        {phase === 'scored' && (
          <div className={`px-4 py-4 md:text-left text-center ${
            moveScore !== null && moveScore >= 90 ? 'bg-chess-accent/10' :
            moveScore !== null && moveScore < 50  ? 'bg-chess-blunder/10' :
            'bg-amber-500/[0.06]'
          }`}>
            {challengeError ? (
              <>
                <div className="text-sm text-red-400 mb-2">{challengeError}</div>
                <button onClick={retry} className="px-4 py-2 bg-chess-accent text-chess-bg rounded-lg text-sm font-bold">{t('tm_try_again')}</button>
              </>
            ) : (
              <>
                {/* Score header + CTAs in a single row. The row never
                    wraps — the score block can shrink (truncating long
                    locale strings) so the CTAs stay pinned to the end. */}
                <div className="flex items-center gap-2 flex-nowrap mb-1.5">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <div className={`text-2xl font-black tabular-nums leading-none shrink-0 ${scoreColor(moveScore)}`}>{moveScore}</div>
                    <div className="min-w-0">
                      <div className={`text-xs font-bold leading-tight truncate ${scoreColor(moveScore)}`}>{scoreLabel(moveScore)}</div>
                      <div className="text-[10px] text-gray-500 leading-tight truncate">{t('tm_out_of')}</div>
                    </div>
                  </div>

                  <div className="flex gap-1.5 shrink-0">
                    {moveScore !== null && moveScore < 100 && (
                      <button onClick={retry} className="px-2.5 py-1.5 bg-chess-accent text-chess-bg rounded-lg text-xs font-bold hover:brightness-110 transition-all whitespace-nowrap">
                        {t('tm_try_again')}
                      </button>
                    )}
                    <button onClick={continueAfterScore} className="px-2.5 py-1.5 bg-chess-surface border border-chess-border/30 rounded-lg text-xs font-bold hover:bg-chess-surface/80 transition-all whitespace-nowrap">
                      {t('tm_continue')}
                    </button>
                  </div>
                </div>

                {/* AI explanation — below buttons, collapsible feel */}
                {(aiExplanation || aiExplanationLoading) && (
                  <div className="text-[12px] leading-relaxed text-gray-400 mb-2">
                    {aiExplanationLoading ? (
                      <div className="flex items-center md:justify-start justify-center gap-2 text-gray-500">
                        <span className="w-3 h-3 border-[1.5px] border-chess-accent border-t-transparent rounded-full animate-spin" />
                        <span className="text-xs">Analyzing...</span>
                      </div>
                    ) : (
                      <ExplanationText text={aiExplanation!} onSquareClick={(sq) => setHighlightedSquare(prev => prev === sq ? null : sq)} />
                    )}
                  </div>
                )}

                {/* Top-5 move ranking table */}
                <RankingTable
                  title={t('tm_top_moves')}
                  moves={criticalRanking}
                  loading={rankingLoading && criticalRanking.length === 0}
                  playerMoveUci={challengeState.playerMoveUci ?? challengeConfig!.originalMoveUci}
                  originalMoveUci={challengeConfig!.originalMoveUci}
                  bestMoveUci={bestMoveUci}
                  selectedUci={selectedRowUci}
                  onSelect={(move) => handleRankSelect(move, criticalFen || item.fen)}
                  activePvStep={pvStep}
                  onPvStepClick={handlePvStepClick}
                />
              </>
            )}
          </div>
        )}
        {phase === 'continuation' && (
          <div className="px-4 py-3 md:text-left text-center">
            <div className="text-sm text-gray-400">
              {opponentThinking ? t('tm_opponent_thinking') : playerTurn ? t('tm_keep_playing', { moves: challengeState.continuationMovesLeft }) : ''}
            </div>
          </div>
        )}
        {phase === 'complete' && (
          <div className="px-3 py-2 bg-chess-accent/10 md:text-left text-center">
            {/* Compact header row: just the title + Back/Next. Per-move scores
                live on each tab below. */}
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <span className="text-[11px] font-bold text-chess-accent shrink-0">{t('tm_challenge_complete')}</span>
              <div className="flex items-center gap-2 ms-auto shrink-0">
                <button data-tutorial-target="tm-challenge-back" onClick={() => { setChallengeItem(null); setChallengeConfig(null); setChallengeQueueIdx(-1); setSearchParams({}); }} className="px-2.5 py-1 text-gray-500 hover:text-gray-300 text-[11px] transition-all flex items-center gap-1">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="rtl:rotate-180"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
                  {t('tm_back')}
                </button>
                <button onClick={() => { tutorialTriggerStep(6); startNextChallenge(); }} className="px-3 py-1 bg-chess-accent text-chess-bg rounded-lg text-[12px] font-bold hover:brightness-110 transition-all">
                  {t('tm_next')}
                </button>
              </div>
            </div>

            {/* Continuation review — tab to switch between moves, RankingTable
                shows the top-5 alternatives for the selected move (mirrors how
                the critical move is displayed). */}
            {continuationMoves.length > 0 && (() => {
              const activeIdx = expandedContIdx ?? 0;
              const activeMove = continuationMoves[activeIdx];
              const activeRanking = continuationRankings[activeIdx] ?? [];
              return (
                <div>
                  {/* Move tabs — each tab shows the move number, SAN, and the
                      score the user got for that move. */}
                  <div className="flex items-center gap-1 mb-1.5 overflow-x-auto scrollbar-hide">
                    {continuationMoves.map((cm, idx) => {
                      const ranking = continuationRankings[idx];
                      const userInRanking = ranking?.find(m => m.uci === cm.uci);
                      const userRank = userInRanking?.rank ?? null;
                      const isBest = userRank === 1;
                      const isMiss = ranking && !userRank;
                      const isActive = idx === activeIdx;
                      const moveScore = moveScores[idx];
                      return (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => {
                            setExpandedContIdx(idx);
                            if (cm.uci && cm.fenBefore) {
                              setPreviewUci(cm.uci);
                              setPreviewFenState(cm.fenBefore);
                            }
                            setSelectedRowUci(null);
                            setPvStep(-1);
                            setPvChainData(null);
                          }}
                          className={`shrink-0 flex items-center gap-1.5 px-2 py-0.5 rounded-md border text-[11px] transition-all ${
                            isActive
                              ? 'bg-chess-accent/15 border-chess-accent/40 text-chess-text'
                              : 'bg-white/[0.03] border-white/[0.06] text-gray-400 hover:bg-white/[0.06]'
                          }`}
                        >
                          <span className="font-bold tabular-nums">{idx + 1}</span>
                          <span className="font-mono font-bold">{cm.san}</span>
                          {isBest && <span className="text-[9px] text-chess-accent">★</span>}
                          {isMiss && <span className="text-[9px] text-chess-blunder font-bold">×</span>}
                          {moveScore != null && (
                            <span className={`font-black tabular-nums ${scoreColor(moveScore)}`}>{moveScore}</span>
                          )}
                        </button>
                      );
                    })}
                    {rankingLoading && continuationRankings.length === 0 && (
                      <span className="inline-block w-3 h-3 border-[1.5px] border-chess-accent border-t-transparent rounded-full animate-spin shrink-0 ms-1" />
                    )}
                  </div>

                  {/* Top 5 horizontal gallery for the selected move */}
                  {activeMove && (
                    <RankingTable
                      title={t('tm_top_moves')}
                      moves={activeRanking}
                      loading={rankingLoading && activeRanking.length === 0}
                      playerMoveUci={activeMove.uci}
                      originalMoveUci={null}
                      bestMoveUci={activeRanking[0]?.uci}
                      selectedUci={selectedRowUci}
                      onSelect={(move) => handleRankSelect(move, activeMove.fenBefore)}
                      activePvStep={pvStep}
                      onPvStepClick={handlePvStepClick}
                    />
                  )}
                </div>
              );
            })()}
          </div>
        )}
      </div>
    );

    return (
      <div className="max-w-[1200px] mx-auto md:block">
        {/* Header — back button + pattern title hero, with category/severity
            and the game context (player vs opponent · date · timeClass) on a
            tight secondary row. Visual hierarchy: pattern name reads as the
            heading, everything else is supporting metadata. */}
        {(() => {
          const sev = severityLabel(item.cpLoss, t);
          const game = allGames.find((g) => g.id === item.gameId);
          const playerUsername = game?.player?.username ?? '';
          const playedAtMs = game?.playedAt ?? 0;
          const dateStr = playedAtMs > 0
            ? new Date(playedAtMs).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
            : '';
          return (
            <div className="shrink-0 mb-2">
              {/* Top row: back button + the two classification chips
                  (category + severity) pinned together on the right. */}
              <div className="flex items-center justify-between gap-3">
                <button onClick={() => {
                  setSearchParams({});
                  if (returnTo) {
                    navigate(returnTo.path, { state: { moveIndex: returnTo.moveIndex } });
                  } else {
                    setChallengeItem(null); setChallengeConfig(null);
                  }
                }} className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-chess-text transition-colors">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="rtl:rotate-180"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
                  {t('tm_back')}
                </button>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className={`text-[10px] font-extrabold uppercase tracking-[1.4px] px-2 py-0.5 rounded-md ${catColor.bg} ${catColor.text}`}>
                    {CATEGORY_KEYS[item.category] ? t(CATEGORY_KEYS[item.category]) : item.category}
                  </span>
                  <span className={`text-[10px] font-extrabold uppercase tracking-[1.4px] px-2 py-0.5 rounded-md ${sev.bg} ${sev.color}`}>
                    {sev.text}
                  </span>
                </div>
              </div>

              {/* Hero block — centered, with breathing room from the back row
                  above. Generous spacing inside so the title, players, and
                  date each have their own visual breath. The bottom-of-board
                  elements stay tight so everything still fits above the fold. */}
              <div className="mt-4 flex flex-col items-center text-center gap-2">
                <div className="flex items-center gap-2">
                  <span className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${catColor.bg}`}>
                    <span className={catColor.text}><PatternIcon theme={item.patternTheme} /></span>
                  </span>
                  <h2 className="text-[16px] font-extrabold text-chess-text leading-tight truncate">
                    {patternLabel(item.patternTheme, t)}
                  </h2>
                </div>
                {/* Player vs opponent — bigger, both ratings shown. */}
                <div className="text-[12px] text-gray-300 font-medium">
                  {sourceTab !== 'yours' && playerUsername && (
                    <>
                      <span className="text-white font-semibold">{playerUsername}</span>
                      {game?.player?.rating ? <span className="text-gray-500"> ({game.player.rating})</span> : null}
                      <span className="text-gray-500"> vs </span>
                    </>
                  )}
                  {sourceTab === 'yours' && <span className="text-gray-500">vs </span>}
                  <span className="text-white font-semibold">{item.gameOpponent}</span>
                  <span className="text-gray-500"> ({item.gameRating})</span>
                </div>
                <div className="text-[10px] text-chess-text-tertiary">
                  {dateStr ? `${dateStr} · ` : ''}{item.gameTimeClass}
                </div>
              </div>
            </div>
          );
        })()}

        {/* Desktop: board left, sidebar right | Mobile: vertically centered */}
        <div className="flex flex-col md:flex-row md:gap-4 md:items-start">
          {/* Left: board area (~60%) */}
          <div className="md:flex-[3] md:min-w-0">
            {/* Phase indicator (replay button moved below the board, see after-board section) */}
            <div data-tutorial-target="tm-challenge-board" className="flex items-center gap-3 mb-2">
              <div className="flex-1 flex items-center justify-center gap-3">
                {(['leadup', 'critical', 'continuation'] as const).map((p, i) => {
                  // Map showMistake to the critical dot
                  const effectivePhase = phase === 'showMistake' ? 'critical' : phase === 'evaluating' || phase === 'scored' ? 'critical' : phase;
                  const phaseOrder = ['leadup', 'critical', 'continuation', 'complete'];
                  const isActive = effectivePhase === p;
                  const isPast = phaseOrder.indexOf(effectivePhase) > phaseOrder.indexOf(p);
                  return (
                    <div key={p} className="flex items-center gap-1.5">
                      {i > 0 && <div className="w-6 h-px bg-chess-border/30" />}
                      <div className={`w-2 h-2 rounded-full transition-all ${
                        isActive ? (phase === 'showMistake' ? 'bg-chess-blunder scale-125' : 'bg-chess-accent scale-125') :
                        isPast ? 'bg-chess-accent/50' : 'bg-chess-border/40'
                      }`} />
                      <span className={`text-xs ${isActive ? (phase === 'showMistake' ? 'text-chess-blunder font-bold' : 'text-chess-accent font-bold') : 'text-gray-600'}`}>
                        {p === 'leadup' ? t('detail_review') : p === 'critical' ? t('detail_your_move') : t('detail_continue')}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

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

            {/* Board — overflow-visible so the promotion popup can extend past
                the rounded wrapper without being clipped. The board itself is
                still rounded via customBoardStyle. */}
            <div ref={tmBoardRef} className="flex justify-center w-full max-w-full px-1">
              <div className={`rounded-xl shadow-lg shadow-black/20 ${
                phase === 'showMistake' ? 'ring-2 ring-chess-blunder/50' :
                phase === 'complete' ? 'ring-2 ring-chess-accent/50' :
                (phase === 'scored' && moveScore !== null && moveScore < 50) ? 'ring-2 ring-chess-blunder/50' :
                (phase === 'scored' && moveScore !== null && moveScore >= 90) ? 'ring-2 ring-chess-accent/50' : ''
              }`}>
                <ThemedChessboard
                  position={displayFen}
                  boardOrientation={boardOrientationColor}
                  boardWidth={Math.max(Math.min(boardSize - 16, window.innerWidth - 40, tmHeightCappedBoardSize), 200)}
                  arePiecesDraggable={playerTurn && !evaluating && (phase === 'critical' || phase === 'continuation')}
                  autoPromoteToQueen={false}
                  onPromotionCheck={(_from, to, piece) => {
                    return piece[1] === 'P' && (to[1] === '1' || to[1] === '8');
                  }}
                  onPromotionPieceSelect={(piece, fromSq, toSq) => {
                    if (!piece || !fromSq || !toSq) return false;
                    const code = piece[1].toLowerCase() as 'q' | 'r' | 'b' | 'n';
                    const ok = onPieceDrop(fromSq, toSq, code);
                    if (ok) playChessSound('move');
                    return ok;
                  }}
                  onPieceDrop={(from, to) => {
                    const ok = onPieceDrop(from, to);
                    if (ok) playChessSound('move');
                    return ok;
                  }}
                  onSquareClick={(sq) => { onSquareClick(sq as Square); }}
                  customSquareStyles={squareStyles}
                  customArrows={arrows}
                  animationDuration={phase === 'scored' ? 0 : 200}
                />
              </div>
            </div>

            {/* Replay button — below the board during the critical phase only:
                visible after the leadup has played and before the player picks
                a move. Sized as a real button so it's easy to spot and tap. */}
            {phase === 'critical' && (
              <div className="mt-1.5 flex justify-center">
                <button
                  onClick={replayLeadup}
                  className="flex items-center gap-2 text-[13px] font-semibold text-chess-text/90 hover:text-chess-accent border border-chess-border/40 hover:border-chess-accent/50 transition-all px-4 py-1.5 rounded-lg bg-chess-surface/50 hover:bg-chess-surface/80 active:scale-[0.98]"
                  title={t('detail_replay')}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                    <path d="M1 4v6h6"/>
                    <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>
                  </svg>
                  {t('detail_replay')}
                </button>
              </div>
            )}

            {/* Status panel — mobile only (below board) */}
            <div className="mt-1.5 md:hidden">
              {statusPanel}
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
      {/* Header — title removed; tagline + info icon are the only chrome. */}
      <div className="mb-3">
        <div className="flex items-center gap-2">
          <p className="text-sm text-gray-400 leading-relaxed">
            {t('tm_tagline')}
          </p>
          <InfoButton onClick={() => setInfoOpen(true)} />
        </div>
      </div>
      {infoOpen && <InfoPopup title={t('tm_title')} body={t('tm_desc')} onClose={() => setInfoOpen(false)} />}

      {/* Source filter — Yours / Friends / Top Players */}
      <SourceTabs active={sourceTab} onChange={setSourceTab} />

      {sourceTab === 'friends' && (
        <FriendsManager
          friends={settings.friendUsernames ?? []}
          pendingUsernames={pendingNonSelfImports}
          suggestions={topOpponents}
          onAdd={async (u) => {
            const list = settings.friendUsernames ?? [];
            if (list.length >= MAX_FRIENDS) return;
            if (list.some((x) => x.toLowerCase() === u.toLowerCase())) return;
            await updateSettings({ friendUsernames: [...list, u] });
            markPendingImport(u);
            try {
              const ids = await importChessComGames(u, { maxGames: 1, guest: isGuest });
              if (ids.length > 0) queueForAnalysis(ids);
              refetchGames();
            } finally {
              clearPendingImport(u);
            }
          }}
          onRemove={async (u) => {
            const list = settings.friendUsernames ?? [];
            await updateSettings({
              friendUsernames: list.filter((x) => x.toLowerCase() !== u.toLowerCase()),
            });
          }}
        />
      )}

      {sourceTab === 'top' && (
        <TopPlayersManager
          followed={settings.topPlayerUsernames ?? []}
          pendingUsernames={pendingNonSelfImports}
          onToggle={async (u) => {
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
              try {
                const ids = await importChessComGames(u, { maxGames: 1, guest: isGuest });
                if (ids.length > 0) queueForAnalysis(ids);
                refetchGames();
              } finally {
                clearPendingImport(u);
              }
            }
          }}
        />
      )}

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


      {/* Pattern impact filter \u2014 Yours tab only. Tapping a row narrows the
          challenge list to that pattern; tapping again clears the filter. */}
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
        const sorted = [...stats.entries()].sort(([, a], [, b]) => median(b.cps) * b.cps.length - median(a.cps) * a.cps.length);
        return (
          <div className="mb-3 space-y-1.5">
            <p className="text-[12px] text-gray-400 px-0.5">
              Based on your games, your patterns that affect you most:
            </p>
            {(patternFilter ? sorted.filter(([t2]) => t2 === patternFilter) : sorted).map(([theme, s], idx) => {
              const isActive = patternFilter === theme;
              const med = median(s.cps);
              const lossRate = s.total.size > 0 ? Math.round((s.lost.size / s.total.size) * 100) : 0;
              const cat = getCategory(theme);
              const catColor = cat !== 'all' ? (CATEGORY_COLORS[cat] ?? CATEGORY_COLORS.Positional) : null;
              const catLabel = cat !== 'all' && CATEGORY_KEYS[cat] ? t(CATEGORY_KEYS[cat]) : '';
              const sevColor = med >= 200 ? 'text-chess-blunder' : med >= 100 ? 'text-orange-400' : med >= 50 ? 'text-amber-400' : 'text-chess-accent';
              const lossColor = lossRate >= 60 ? 'text-chess-blunder' : lossRate >= 45 ? 'text-amber-400' : 'text-chess-accent';
              return (
                <div
                  key={theme}
                  onClick={() => {
                    setPatternFilter(isActive ? null : theme);
                    setVisibleCount(PAGE_SIZE);
                  }}
                  className={`relative bg-chess-surface rounded-xl px-3.5 pt-3 pb-3 border cursor-pointer transition-all ${
                    isActive
                      ? 'border-chess-accent/50 shadow-[0_0_18px_rgba(74,222,128,0.1)]'
                      : 'border-transparent hover:border-chess-border/40'
                  }`}
                >
                  <span className="absolute top-2 left-2 z-10 inline-flex items-center justify-center w-6 h-6 rounded-full bg-chess-bg/80 border border-chess-border/40 text-[11px] font-black text-chess-text-tertiary tabular-nums">
                    {idx + 1}
                  </span>
                  <div className="flex items-start gap-3 ps-7">
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${isActive ? 'bg-chess-accent/15' : 'bg-chess-bg/50'}`}>
                      <PatternIcon theme={theme} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="block text-[20px] font-extrabold text-chess-text leading-tight break-words">
                        {patternLabel(theme, t)}
                      </span>
                      {catColor && catLabel && (
                        <span className={`inline-block mt-1.5 px-2 py-0.5 rounded-md text-[10px] font-extrabold uppercase tracking-[1.3px] ${catColor.bg} ${catColor.text}`}>
                          {catLabel}
                        </span>
                      )}
                    </div>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 text-chess-text-tertiary transition-transform mt-2 ${isActive ? 'rotate-90 text-chess-accent' : ''}`}>
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </div>
                  <div onClick={(e) => e.stopPropagation()} className="grid grid-cols-3 gap-2 mt-3">
                    <div className="bg-white/[0.03] rounded-xl py-2 px-2 text-center border border-white/[0.04]">
                      <div className={`text-[16px] leading-none font-black tabular-nums ${sevColor}`}>{'\u2212'}{med}</div>
                      <div className="text-[8px] uppercase tracking-[1.2px] font-bold text-chess-text-tertiary mt-1">Rating pts</div>
                    </div>
                    <div className="bg-white/[0.03] rounded-xl py-2 px-2 text-center border border-white/[0.04]">
                      <div className={`text-[16px] leading-none font-black tabular-nums ${lossColor}`}>{lossRate}%</div>
                      <div className="text-[8px] uppercase tracking-[1.2px] font-bold text-chess-text-tertiary mt-1">{t('common_lost')}</div>
                    </div>
                    <div className="bg-white/[0.03] rounded-xl py-2 px-2 text-center border border-white/[0.04]">
                      <div className="text-[16px] leading-none font-black tabular-nums text-chess-text">{s.cps.length}</div>
                      <div className="text-[8px] uppercase tracking-[1.2px] font-bold text-chess-text-tertiary mt-1">{t('common_occurrences')}</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
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
          const isCompleted = checkedKeys.has(getChallengeKey(item));
          return (
            <button
              key={`${item.gameId}-${item.moveIndex}-${idx}`}
              onClick={() => {
                // Resume queue from this item if it's still unchecked; for
                // already-completed (re-replay), don't push the queue forward.
                const qIdx = uncheckedPositions.indexOf(item);
                startChallenge(item, qIdx >= 0 ? qIdx : undefined);
              }}
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
                {/* Completed checkmark badge — top-right corner of the board */}
                {isCompleted && (
                  <div className="absolute top-2 end-2 w-8 h-8 rounded-full bg-chess-accent flex items-center justify-center shadow-lg shadow-black/30 pointer-events-none">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
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
}: {
  active: 'yours' | 'friends' | 'top';
  onChange: (s: 'yours' | 'friends' | 'top') => void;
}) {
  const tabs: Array<{ id: 'yours' | 'friends' | 'top'; label: string; Icon: () => React.JSX.Element }> = [
    { id: 'yours', label: 'Yours', Icon: DnaTabIcon },
    { id: 'friends', label: 'Friends', Icon: PeopleTabIcon },
    { id: 'top', label: 'Top players', Icon: GmTabIcon },
  ];
  return (
    <div className="flex gap-2 mb-3">
      {tabs.map((tab) => {
        const isActive = active === tab.id;
        const Icon = tab.Icon;
        return (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            className={`flex-1 flex flex-col items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-[12px] font-extrabold uppercase tracking-[1.4px] transition-all border ${
              isActive
                ? 'bg-chess-accent/15 text-chess-accent border-chess-accent/30'
                : 'text-gray-400 hover:text-chess-text hover:bg-white/[0.04] border-chess-border/20'
            }`}
          >
            <Icon />
            <span className="leading-tight text-center">{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ── Tab icons — match the bottom-nav icon weight (1.8 stroke). ── */

function DnaTabIcon() {
  // Same DNA glyph used by the bottom-nav "DNA" tab.
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <g transform="rotate(45 12 12)">
        <path d="M8 2c0 6.5 8 12.5 8 19" />
        <path d="M16 2c0 6.5-8 12.5-8 19" />
        <line x1="9.2" y1="5.5" x2="14.8" y2="5.5" />
        <line x1="11" y1="8.5" x2="13" y2="8.5" />
        <line x1="11" y1="14.5" x2="13" y2="14.5" />
        <line x1="9.2" y1="17.5" x2="14.8" y2="17.5" />
      </g>
    </svg>
  );
}

function PeopleTabIcon() {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function GmTabIcon() {
  // "GM" badge in a square — distinguishes Top Players from regular friends.
  return (
    <svg width={20} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <text
        x="12"
        y="15.5"
        textAnchor="middle"
        fontSize="8"
        fontWeight="900"
        fill="currentColor"
        stroke="none"
        fontFamily="ui-sans-serif, system-ui, sans-serif"
        letterSpacing="0.4"
      >
        GM
      </text>
    </svg>
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

function FriendsManager({
  friends,
  pendingUsernames,
  suggestions,
  onAdd,
  onRemove,
}: {
  friends: string[];
  /** Lowercased usernames whose import is in flight (loading indicator). */
  pendingUsernames: Set<string>;
  /** Suggested usernames from the user's most-played opponents. Tap to add. */
  suggestions: string[];
  onAdd: (username: string) => Promise<void> | void;
  onRemove: (username: string) => Promise<void> | void;
}) {
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Same picked-then-collapsed pattern as TopPlayersManager: once the user
  // has at least one friend, the picker stays collapsed by default so it
  // doesn't get in the way of the challenge list.
  const STORAGE_KEY = 'tm-friends-collapsed';
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (friends.length > 0) return true;
    try { return localStorage.getItem(STORAGE_KEY) === '1'; } catch { return false; }
  });
  const toggleCollapsed = () => {
    setCollapsed((c) => {
      const next = !c;
      try { localStorage.setItem(STORAGE_KEY, next ? '1' : '0'); } catch { /* noop */ }
      return next;
    });
  };

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
      await onAdd(trimmed);
      setInput('');
    } catch {
      setError('Failed to verify username');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-3 rounded-xl bg-chess-surface/60 border border-chess-border/30 p-3">
      <button
        type="button"
        onClick={toggleCollapsed}
        className="w-full flex items-center justify-between gap-2 mb-2"
      >
        <span className="text-[11px] font-extrabold uppercase tracking-[1.4px] text-chess-text-tertiary">
          Your friends · {friends.length}/{MAX_FRIENDS}
        </span>
        <svg
          width="14" height="14" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"
          className={`text-chess-text-tertiary transition-transform ${collapsed ? '' : 'rotate-180'}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {collapsed && friends.length > 0 && (
        <div className="text-[11px] text-chess-text-tertiary truncate">
          {friends.join(' · ')}
        </div>
      )}
      {collapsed && friends.length === 0 && (
        <div className="text-[11px] text-chess-text-tertiary italic">
          Tap to add a chess.com username.
        </div>
      )}
      {!collapsed && (
      <>
      {/* Free username input — same shape as before, kept on top so adding is fast. */}
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

      {/* Added friends — rendered as full-width cards in the same visual style
          as the Top Players list. Click toggles "Following" off (removes). */}
      {friends.length > 0 && (
        <div className="grid grid-cols-1 gap-2 mb-2">
          {friends.map((u) => {
            const loading = pendingUsernames.has(u.toLowerCase());
            return (
              <button
                key={u}
                onClick={() => { if (!loading) onRemove(u); }}
                disabled={loading}
                className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg border bg-chess-accent/10 border-chess-accent/40 text-chess-text text-start transition-all hover:border-chess-accent/60 disabled:opacity-80"
              >
                <div className="min-w-0">
                  <div className="text-[13px] font-bold truncate">{u}</div>
                  <div className="text-[10px] text-chess-text-tertiary truncate">
                    {loading ? 'Importing latest game…' : 'chess.com'}
                  </div>
                </div>
                {loading ? (
                  <Spinner />
                ) : (
                  <span className="text-[10px] font-extrabold uppercase tracking-[1.4px] px-2 py-0.5 rounded-md shrink-0 bg-chess-accent text-black">
                    Following
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
      {friends.length === 0 && (
        <div className="text-[11px] text-chess-text-tertiary italic mb-2">
          Add a chess.com username — their last game becomes a challenge here.
        </div>
      )}

      {/* Suggested — most-played opponents from the user's games. Same
          full-row card layout as the Top Players unfollow list. Tap to add
          (subject to the MAX_FRIENDS cap). */}
      {(() => {
        const friendSet = new Set(friends.map((f) => f.toLowerCase()));
        const fresh = suggestions.filter((u) => !friendSet.has(u.toLowerCase()));
        if (fresh.length === 0) return null;
        const atCap = friends.length >= MAX_FRIENDS;
        return (
          <div className="mt-3 pt-3 border-t border-chess-border/20">
            <div className="grid grid-cols-1 gap-2">
              {fresh.map((u) => (
                <button
                  key={u}
                  type="button"
                  onClick={() => { if (!atCap) onAdd(u); }}
                  disabled={atCap}
                  className={`flex items-center justify-between gap-2 px-3 py-2 rounded-lg border bg-chess-bg/40 border-chess-border/30 text-chess-text text-start transition-all hover:border-chess-accent/30 ${
                    atCap ? 'opacity-50 cursor-not-allowed' : ''
                  }`}
                >
                  <div className="min-w-0">
                    <div className="text-[13px] font-bold truncate">{u}</div>
                    <div className="text-[10px] text-chess-text-tertiary truncate">chess.com</div>
                  </div>
                  <span className="text-[10px] font-extrabold uppercase tracking-[1.4px] px-2 py-0.5 rounded-md shrink-0 bg-chess-bg/60 text-chess-text-tertiary">
                    Follow
                  </span>
                </button>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-chess-text-tertiary italic">
              Suggested from your most-played opponents.
            </p>
          </div>
        );
      })()}
      </>
      )}
    </div>
  );
}

function TopPlayersManager({
  followed,
  pendingUsernames,
  onToggle,
}: {
  followed: string[];
  /** Lowercased usernames whose import is in flight (loading indicator). */
  pendingUsernames: Set<string>;
  onToggle: (username: string) => Promise<void> | void;
}) {
  const followedSet = useMemo(
    () => new Set(followed.map((u) => u.toLowerCase())),
    [followed],
  );

  // Default to collapsed once the user has followed at least one player.
  // Persisted via localStorage so a manual toggle survives reloads, but
  // the picked-state always wins on first mount: if you've followed
  // anyone, the picker stays out of the way.
  const STORAGE_KEY = 'tm-top-players-collapsed';
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (followed.length > 0) return true;
    try { return localStorage.getItem(STORAGE_KEY) === '1'; } catch { return false; }
  });
  const toggleCollapsed = () => {
    setCollapsed((c) => {
      const next = !c;
      try { localStorage.setItem(STORAGE_KEY, next ? '1' : '0'); } catch { /* noop */ }
      return next;
    });
  };

  return (
    <div className="mb-3 rounded-xl bg-chess-surface/60 border border-chess-border/30 p-3">
      <button
        type="button"
        onClick={toggleCollapsed}
        className="w-full flex items-center justify-between gap-2 mb-2"
      >
        <span className="text-[11px] font-extrabold uppercase tracking-[1.4px] text-chess-text-tertiary">
          Following · {followed.length}/{MAX_TOP_PLAYERS}
        </span>
        <svg
          width="14" height="14" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"
          className={`text-chess-text-tertiary transition-transform ${collapsed ? '' : 'rotate-180'}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {!collapsed && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {TOP_PLAYERS.map((p) => {
            const isFollowed = followedSet.has(p.username.toLowerCase());
            const loading = pendingUsernames.has(p.username.toLowerCase());
            const disabled = (!isFollowed && followed.length >= MAX_TOP_PLAYERS) || loading;
            return (
              <button
                key={p.username}
                onClick={() => { if (!disabled) onToggle(p.username); }}
                disabled={disabled}
                className={`flex items-center justify-between gap-2 px-3 py-2 rounded-lg border text-start transition-all ${
                  isFollowed
                    ? 'bg-chess-accent/10 border-chess-accent/40 text-chess-text'
                    : 'bg-chess-bg/40 border-chess-border/30 text-chess-text hover:border-chess-accent/30'
                } ${disabled && !loading ? 'opacity-50' : ''}`}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[14px] leading-none">{p.flag}</span>
                    <span className="text-[13px] font-bold truncate">{p.name}</span>
                  </div>
                  <div className="text-[10px] text-chess-text-tertiary truncate">
                    {loading ? 'Importing latest game…' : p.username}
                  </div>
                </div>
                {loading ? (
                  <Spinner />
                ) : (
                  <span
                    className={`text-[10px] font-extrabold uppercase tracking-[1.4px] px-2 py-0.5 rounded-md shrink-0 ${
                      isFollowed
                        ? 'bg-chess-accent text-black'
                        : 'bg-chess-bg/60 text-chess-text-tertiary'
                    }`}
                  >
                    {isFollowed ? 'Following' : 'Follow'}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
      {collapsed && followed.length > 0 && (
        <div className="text-[11px] text-chess-text-tertiary truncate">
          {followed.join(' · ')}
        </div>
      )}
    </div>
  );
}

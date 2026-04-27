import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { useChessData } from '@/contexts/ChessDataContext';
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
import { useActivePrompt } from '@/hooks/useActivePrompt';

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

/** Mini radial gauge for loss rate % */
function LossRateGauge({ percent, size = 48 }: { percent: number; size?: number }) {
  const { t } = useT();
  const r = (size - 6) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - percent / 100);
  const color = percent >= 60 ? '#ef4444' : percent >= 45 ? '#f59e0b' : '#4ade80';
  return (
    <svg width={size} height={size} className="shrink-0">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={4} />
      <circle
        cx={size / 2} cy={size / 2} r={r}
        fill="none" stroke={color} strokeWidth={4}
        strokeLinecap="round"
        strokeDasharray={circ} strokeDashoffset={offset}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text x={size / 2} y={size / 2 - 1} textAnchor="middle" dominantBaseline="central"
        className="text-[11px] font-black" fill={color}>{percent}%</text>
      <text x={size / 2} y={size / 2 + 9} textAnchor="middle" dominantBaseline="central"
        className="text-[5px] uppercase" fill="#6b7280">{t('common_lost')}</text>
    </svg>
  );
}

/** Severity label for cp loss */
function cpSeverity(cp: number, t?: (key: TranslationKey) => string): { label: string; color: string; bg: string } {
  if (cp >= 300) return { label: t ? t('severity_critical') : 'Critical', color: 'text-red-400', bg: 'bg-red-500/10' };
  if (cp >= 150) return { label: t ? t('severity_severe') : 'Severe', color: 'text-orange-400', bg: 'bg-orange-500/10' };
  if (cp >= 80) return { label: t ? t('severity_moderate') : 'Moderate', color: 'text-amber-400', bg: 'bg-amber-500/10' };
  return { label: t ? t('severity_minor') : 'Minor', color: 'text-yellow-300', bg: 'bg-yellow-500/10' };
}

/** Inline CP loss badge with severity color */
function CpLossBadge({ cp, compact }: { cp: number; compact?: boolean }) {
  const { t } = useT();
  const sev = cpSeverity(cp, t);
  const fontSize = compact ? 'text-[16px]' : 'text-[18px]';
  return (
    <div className="flex flex-col items-end shrink-0">
      <div className="flex items-baseline gap-1">
        <span className={`${fontSize} font-black ${sev.color}`}>{'\u2212'}{cp}</span>
        <span className={`text-[8px] ${sev.color} uppercase font-bold`}>{t('common_cp')}</span>
      </div>
      <span className={`text-[8px] ${sev.color} opacity-70`}>{sev.label}</span>
    </div>
  );
}

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

type ListTab = 'unchecked' | 'checked';

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
  const { allAnalyses, allGames } = useChessData();
  const { settings } = useTheme();
  const { t } = useT();
  const { buildPrompt } = useActivePrompt();
  const { containerRef: tmBoardRef, boardSize } = useResponsiveBoardSize(700);

  // The logged-in user's chess.com username (ground truth for color derivation)
  const myUsername = (settings.chesscomUsername ?? '').toLowerCase();

  const [categoryFilter, setCategoryFilter] = useState<SkillCategory>('all');
  const [patternFilter, setPatternFilter] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [listTab, setListTab] = useState<ListTab>('unchecked');
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
  const navState = location.state as { preselectedTheme?: string; directChallenge?: { gameId: string; moveIndex: number }; returnTo?: { path: string; moveIndex: number }; gameFilter?: string } | null;
  const preselectedTheme = navState?.preselectedTheme;
  const directChallenge = navState?.directChallenge;
  const returnTo = navState?.returnTo;
  const [gameFilter, setGameFilter] = useState<string | null>(navState?.gameFilter ?? null);

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
      if (timeClassFilter && game.timeClass !== timeClassFilter) continue;

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
  }, [allGames, allAnalyses, timeClassFilter, gameFilter]);

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

  // Available categories with counts
  const categoryCounts = useMemo(() => {
    const positions = listTab === 'checked'
      ? allPositions.filter(p => checkedKeys.has(getChallengeKey(p)))
      : allPositions;
    const counts: Record<string, number> = { all: positions.length };
    for (const p of positions) counts[p.category] = (counts[p.category] ?? 0) + 1;
    return counts;
  }, [allPositions, listTab, checkedKeys]);

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

  // Use the challenge hook
  const { state: challengeState, advanceLeadup, undoMistake, onSquareClick, onPieceDrop, retry, replayLeadup, continueAfterScore, revealWithExplanation } = useTimeMachineChallenge(challengeConfig, settings ?? undefined, buildPrompt);

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
  const displayPositions = listTab === 'unchecked' ? uncheckedPositions : checkedPositions;
  const visiblePositionsSlice = displayPositions.slice(0, visibleCount);
  const hasMore = visibleCount < displayPositions.length;

  // Sort categories by how many positions the user has in each (most first)
  // NOTE: Must be above early returns to avoid conditional hook calls (React error #310)
  const sortedCategories = useMemo((): SkillCategory[] => {
    const counts: Record<string, number> = {};
    for (const p of allPositions) counts[p.category] = (counts[p.category] ?? 0) + 1;
    const cats: SkillCategory[] = ['Tactics', 'Defense', 'Endgame', 'Opening', 'Positional'];
    cats.sort((a, b) => (counts[b] ?? 0) - (counts[a] ?? 0));
    return ['all', ...cats.filter(c => (counts[c] ?? 0) > 0)];
  }, [allPositions]);
  const CATEGORIES = sortedCategories;

  if (allPositions.length === 0) {
    return (
      <div className="text-center py-16">
        <div className="text-5xl mb-4 opacity-60">{'\u23F3'}</div>
        <h2 className="text-xl font-bold mb-2">{t('tm_title')}</h2>
        <p className="text-gray-400 text-sm max-w-xs mx-auto">
          {t('tm_desc')}
        </p>
      </div>
    );
  }

  /* ── Interactive Challenge View ── */
  if (challengeItem && challengeConfig) {
    const item = challengeItem;
    const catColor = CATEGORY_COLORS[item.category] ?? CATEGORY_COLORS.Positional;
    const { phase, currentFen, criticalFen, fenAfterCritical: _fac, fenForContinuation: _ffc, opponentResponseSan: _ors, playerTurn, selectedSquare, legalMoves, opponentThinking, evaluating, lastMoveFrom, lastMoveTo, moveScore, moveScores, playerMoveSan: _pms, showAnswer, attempts, error: challengeError, aiExplanation, aiExplanationLoading, criticalRanking, continuationRanking: _cr, continuationMoves, continuationRankings, rankingLoading } = challengeState;
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

    // Knight moves should be drawn as an L (long leg first, short leg into
    // the destination) so the arrow visualises the knight's actual jump
    // rather than slicing through pieces along a straight diagonal.
    const expandArrow = (uci: string, fen: string, color: string): Array<[Square, Square, string]> => {
      const from = uci.slice(0, 2) as Square;
      const to = uci.slice(2, 4) as Square;
      try {
        const c = new Chess(fen);
        const piece = c.get(from);
        if (!piece || piece.type !== 'n') return [[from, to, color]];
        const fromFile = from.charCodeAt(0);
        const fromRank = parseInt(from[1], 10);
        const toFile = to.charCodeAt(0);
        const toRank = parseInt(to[1], 10);
        const df = toFile - fromFile;
        const dr = toRank - fromRank;
        // Validate L-shape: knight moves are (±2, ±1) or (±1, ±2)
        if (!((Math.abs(df) === 2 && Math.abs(dr) === 1) || (Math.abs(df) === 1 && Math.abs(dr) === 2))) {
          return [[from, to, color]];
        }
        // Long leg first: travel the 2-square axis, then 1 square perpendicular into the destination.
        const corner = (Math.abs(df) === 2
          ? `${String.fromCharCode(toFile)}${fromRank}`
          : `${String.fromCharCode(fromFile)}${toRank}`) as Square;
        return [
          [from, corner, color],
          [corner, to, color],
        ];
      } catch {
        return [[from, to, color]];
      }
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
          <div className="px-5 py-5 md:text-left text-center">
            {/* Headline — biggest, clearest action prompt. */}
            <div className="text-lg md:text-xl font-black text-chess-accent leading-tight">
              {t('tm_find_better_move')}
            </div>

            {/* Context — what they originally played, in readable secondary. */}
            <div className="text-sm text-chess-text/70 mt-2 leading-relaxed">
              {t('tm_originally_played', { move: item.playedMoveSan })}
            </div>

            {/* Subtle action row — escape hatch + attempt counter. */}
            <div className="flex items-center md:justify-start justify-center gap-3 mt-4">
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
          <div className="px-4 py-4 bg-chess-accent/10 md:text-left text-center">
            {/* Overall score */}
            <div className="flex items-center md:justify-start justify-center gap-3 mb-2">
              <div className={`text-3xl font-black tabular-nums ${scoreColor(moveScores.length > 0 ? Math.round(moveScores.reduce((a, b) => a + b, 0) / moveScores.length) : null)}`}>
                {moveScores.length > 0 ? Math.round(moveScores.reduce((a, b) => a + b, 0) / moveScores.length) : '—'}
              </div>
              <div>
                <div className="text-sm font-bold text-chess-accent">{t('tm_challenge_complete')}</div>
                <div className="text-[10px] text-gray-500">{t(moveScores.length !== 1 ? 'tm_avg_across_plural' : 'tm_avg_across', { count: String(moveScores.length) })}</div>
              </div>
            </div>

            {/* Move score pills */}
            {moveScores.length > 1 && (
              <div className="flex md:justify-start justify-center gap-1 mb-3">
                {moveScores.map((s, i) => (
                  <span key={i} className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${scoreColor(s)} bg-white/[0.04]`}>{s}</span>
                ))}
              </div>
            )}

            <div className="text-xs text-gray-400 mb-3">
              {t('tm_best_was', { move: bestMoveSan })}
            </div>

            <div className="flex md:justify-start justify-center gap-2 flex-wrap">
              <button onClick={startNextChallenge} className="px-4 py-2 bg-chess-accent text-chess-bg rounded-lg text-sm font-bold hover:brightness-110 transition-all">
                {t('tm_next')}
              </button>
              <button onClick={() => { setChallengeItem(null); setChallengeConfig(null); setChallengeQueueIdx(-1); setSearchParams({}); }} className="px-4 py-2 text-gray-500 hover:text-gray-300 text-sm transition-all flex items-center gap-1">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="rtl:rotate-180"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
                {t('tm_back')}
              </button>
            </div>

            {/* Combined continuation review — your moves vs best at each step */}
            {continuationMoves.length > 0 && (
              <div className="mt-3 border border-white/[0.06] rounded-lg overflow-hidden">
                <div className="px-3 py-1.5 bg-white/[0.03]">
                  <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wide">{t('tm_your_continuation')}</span>
                  {rankingLoading && continuationRankings.length === 0 && (
                    <span className="ml-2 inline-block w-3 h-3 border-[1.5px] border-chess-accent border-t-transparent rounded-full animate-spin align-middle" />
                  )}
                </div>
                <div className="divide-y divide-white/[0.04]">
                  {continuationMoves.map((cm, idx) => {
                    const ranking = continuationRankings[idx];
                    const userInRanking = ranking?.find(m => m.uci === cm.uci);
                    const userRank = userInRanking?.rank ?? null;
                    const userScore = userInRanking?.score ?? null;
                    const bestMove = ranking?.[0];
                    const isBest = userRank === 1;
                    const isExpanded = expandedContIdx === idx;

                    return (
                      <div key={idx}>
                        <div
                          className={`px-3 py-2.5 flex items-center gap-2 cursor-pointer transition-colors ${isExpanded ? 'bg-chess-accent/10' : 'hover:bg-white/[0.03]'}`}
                          onClick={() => {
                            const willExpand = expandedContIdx !== idx;
                            setExpandedContIdx(prev => prev === idx ? null : idx);
                            // Show the position BEFORE the user's move so the arrow's
                            // source square still has the piece on it. Clear preview
                            // when collapsing.
                            if (willExpand && cm.uci && cm.fenBefore) {
                              setPreviewUci(cm.uci);
                              setPreviewFenState(cm.fenBefore);
                            } else {
                              setPreviewUci(null);
                              setPreviewFenState(null);
                              setSelectedRowUci(null);
                              setPvStep(-1);
                              setPvChainData(null);
                            }
                          }}
                        >
                          {/* Move number */}
                          <span className="text-[10px] text-gray-600 font-bold w-3 shrink-0">{idx + 1}</span>

                          {/* User's move */}
                          <span className="font-mono text-[13px] font-bold text-chess-text">{cm.san}</span>

                          {/* Rank badge */}
                          {ranking && (
                            isBest
                              ? <span className="text-[9px] px-1.5 py-0.5 rounded bg-chess-accent/15 text-chess-accent font-bold">{t('tm_badge_best')}</span>
                              : userRank
                                ? <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 font-bold">#{userRank}</span>
                                : <span className="text-[9px] px-1.5 py-0.5 rounded bg-chess-blunder/15 text-chess-blunder font-bold">{t('tm_badge_miss')}</span>
                          )}

                          {/* Score */}
                          {userScore !== null && (
                            <span className={`text-[12px] font-black tabular-nums ${
                              userScore >= 95 ? 'text-chess-accent' : userScore >= 80 ? 'text-teal-400' : userScore >= 60 ? 'text-amber-400' : 'text-red-400'
                            }`}>{userScore}</span>
                          )}

                          {/* Best alternative hint (when user didn't play best) */}
                          {ranking && !isBest && bestMove && (
                            <span className="text-[10px] text-gray-500 ml-auto shrink-0">
                              {t('tm_badge_best')}: <span className="font-mono text-gray-400">{bestMove.san}</span> <span className="text-chess-accent">{bestMove.score}</span>
                            </span>
                          )}

                          {/* Expand arrow */}
                          <svg className={`w-3 h-3 text-gray-600 shrink-0 transition-transform ${isExpanded ? 'rotate-180' : ''} ${!ranking ? 'invisible' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6"/></svg>
                        </div>

                        {/* Expanded: full ranking table */}
                        {isExpanded && ranking && (
                          <div className="bg-white/[0.02] border-t border-white/[0.04]">
                            <table className="w-full text-[12px]">
                              <tbody>
                                {ranking.map(move => {
                                  const isUser = move.uci === cm.uci;
                                  const isRowBest = move.rank === 1;
                                  const pvMoves = move.pvSan.length > 0 ? move.pvSan.slice(0, 5) : null;
                                  return (
                                    <tr
                                      key={move.uci}
                                      onClick={(e) => { e.stopPropagation(); handleRankSelect(move, cm.fenBefore); }}
                                      className={`border-t border-white/[0.03] cursor-pointer hover:bg-white/[0.03] ${isUser ? 'bg-amber-500/[0.06]' : ''}`}
                                    >
                                      <td className="pl-4 pr-1 py-1.5 w-5 text-center text-[10px] text-gray-600">{move.rank}</td>
                                      <td className="px-1 py-1.5 font-mono">
                                        {pvMoves ? (
                                          <span className="flex items-center flex-wrap gap-x-0.5">
                                            {pvMoves.map((san, i) => {
                                              const isActiveStep = selectedRowUci === move.uci && pvStep === i;
                                              const stepClickable = selectedRowUci === move.uci;
                                              return (
                                                <React.Fragment key={i}>
                                                  <span
                                                    onClick={stepClickable ? (ev) => { ev.stopPropagation(); handlePvStepClick(i); } : undefined}
                                                    className={`${i % 2 === 0 ? 'font-bold' : 'font-normal text-[11px]'} ${isActiveStep ? 'text-blue-400 underline underline-offset-2' : i % 2 === 0 ? 'text-chess-text' : 'text-gray-500'} ${stepClickable ? 'cursor-pointer hover:text-blue-300' : ''}`}
                                                  >{san}</span>
                                                  {i < pvMoves.length - 1 && <span className="text-gray-600 text-[10px]">→</span>}
                                                </React.Fragment>
                                              );
                                            })}
                                          </span>
                                        ) : <span className="font-bold text-chess-text">{move.san}</span>}
                                      </td>
                                      <td className="px-1 py-1.5 w-12 text-right">
                                        {isUser && <span className="text-[9px] px-1 py-0.5 rounded bg-amber-500/15 text-amber-400 font-bold me-1">{t('tm_badge_you')}</span>}
                                        {isRowBest && <span className="text-[9px] px-1 py-0.5 rounded bg-chess-accent/15 text-chess-accent font-bold me-1">{t('tm_badge_best')}</span>}
                                      </td>
                                      <td className="pl-1 pr-3 py-1.5 w-8 text-right">
                                        <span className={`font-black tabular-nums text-[12px] ${move.score >= 95 ? 'text-chess-accent' : move.score >= 80 ? 'text-teal-400' : 'text-amber-400'}`}>{move.score}</span>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );

    return (
      <div className="max-w-[1200px] mx-auto flex flex-col min-h-[calc(100dvh-120px)] md:min-h-0 md:block">
        {/* Header bar — just back button (game type filter stays in its global position) */}
        <div className="shrink-0 flex items-center gap-3 mb-2">
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
          <span className="text-gray-600">·</span>
          <span className={`text-xs px-2 py-0.5 rounded-full ${catColor.bg} ${catColor.text} font-bold`}>{CATEGORY_KEYS[item.category] ? t(CATEGORY_KEYS[item.category]) : item.category}</span>
          <span className="text-sm font-bold text-chess-text truncate">{patternLabel(item.patternTheme, t)}</span>
        </div>

        {/* Desktop: board left, sidebar right | Mobile: vertically centered */}
        <div className="flex-1 flex flex-col justify-center md:justify-start md:flex-row md:gap-4 md:items-start md:flex-none">
          {/* Left: board area (~60%) */}
          <div className="md:flex-[3] md:min-w-0">
            {/* Phase indicator (replay button moved below the board, see after-board section) */}
            <div className="flex items-center gap-3 mb-3">
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

            {/* Board */}
            <div ref={tmBoardRef} className="flex justify-center w-full max-w-full px-1">
              <div className={`rounded-xl overflow-hidden shadow-lg shadow-black/20 ${
                phase === 'showMistake' ? 'ring-2 ring-chess-blunder/50' :
                phase === 'complete' ? 'ring-2 ring-chess-accent/50' :
                (phase === 'scored' && moveScore !== null && moveScore < 50) ? 'ring-2 ring-chess-blunder/50' :
                (phase === 'scored' && moveScore !== null && moveScore >= 90) ? 'ring-2 ring-chess-accent/50' : ''
              }`}>
                <ThemedChessboard
                  position={displayFen}
                  boardOrientation={boardOrientationColor}
                  boardWidth={Math.max(Math.min(boardSize - 16, window.innerWidth - 40), 200)}
                  arePiecesDraggable={playerTurn && !evaluating && (phase === 'critical' || phase === 'continuation')}
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
              <div className="mt-3 flex justify-center">
                <button
                  onClick={replayLeadup}
                  className="flex items-center gap-2 text-sm font-semibold text-chess-text/90 hover:text-chess-accent border border-chess-border/40 hover:border-chess-accent/50 transition-all px-5 py-2.5 rounded-lg bg-chess-surface/50 hover:bg-chess-surface/80 active:scale-[0.98]"
                  title={t('detail_replay')}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                    <path d="M1 4v6h6"/>
                    <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>
                  </svg>
                  {t('detail_replay')}
                </button>
              </div>
            )}

            {/* Status panel — mobile only (below board) */}
            <div className="mt-3 md:hidden">
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
      {/* Header */}
      <div className="mb-5">
        <h2 className="text-xl font-black tracking-tight">{t('tm_title')}</h2>
        <p className="text-sm text-gray-400 mt-1 leading-relaxed">
          {t('tm_desc')}
        </p>
      </div>

      {/* Unchecked / Checked tabs */}
      <div className="flex gap-1 mb-3">
        <button
          onClick={() => { setListTab('unchecked'); setVisibleCount(PAGE_SIZE); }}
          className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${
            listTab === 'unchecked' ? 'bg-chess-accent/15 text-chess-accent border border-chess-accent/20' : 'text-gray-500 hover:text-gray-300 bg-chess-surface/20'
          }`}
        >
          {t('tm_challenges')} <span className="ml-1 opacity-60">{uncheckedPositions.length}</span>
        </button>
        <button
          onClick={() => { setListTab('checked'); setVisibleCount(PAGE_SIZE); }}
          className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${
            listTab === 'checked' ? 'bg-chess-accent/15 text-chess-accent border border-chess-accent/20' : 'text-gray-500 hover:text-gray-300 bg-chess-surface/20'
          }`}
        >
          {t('tm_completed')} <span className="ml-1 opacity-60">{checkedPositions.length}</span>
        </button>
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

      {/* Category filter tabs */}
      <div className="flex gap-1.5 overflow-x-auto mb-3 pb-1" style={{ scrollbarWidth: 'none' }}>
        {CATEGORIES.map(cat => {
          const count = categoryCounts[cat] ?? 0;
          if (cat !== 'all' && count === 0) return null;
          const isActive = categoryFilter === cat;
          const color = cat === 'all' ? { bg: 'bg-chess-accent/15', text: 'text-chess-accent' } : (CATEGORY_COLORS[cat] ?? CATEGORY_COLORS.Positional);
          return (
            <button
              key={cat}
              onClick={() => { setCategoryFilter(cat); setPatternFilter(null); setVisibleCount(PAGE_SIZE); }}
              className={`shrink-0 px-2.5 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap ${
                isActive ? `${color.bg} ${color.text} border border-current/20` : 'text-gray-500 hover:text-gray-300 bg-chess-surface/20'
              }`}
            >
              {CATEGORY_KEYS[cat] ? t(CATEGORY_KEYS[cat]) : cat}
              <span className="ms-1 opacity-60">{count}</span>
            </button>
          );
        })}
      </div>



      {/* Pattern impact — filtered to current category tab */}
      {(() => {
        const catPositions = categoryFilter === 'all' ? allPositions : allPositions.filter(p => p.category === categoryFilter);
        const positions = listTab === 'checked'
          ? catPositions.filter(p => checkedKeys.has(getChallengeKey(p)))
          : catPositions;
        if (positions.length === 0) return null;

        const gameResultMap = new Map<string, string>();
        for (const g of allGames) gameResultMap.set(g.id, g.player.result);

        const patternStats = new Map<string, { cpLosses: number[]; gamesLost: Set<string>; gamesWon: Set<string>; gamesAll: Set<string> }>();
        for (const p of positions) {
          const existing = patternStats.get(p.patternTheme) ?? { cpLosses: [], gamesLost: new Set<string>(), gamesWon: new Set<string>(), gamesAll: new Set<string>() };
          existing.cpLosses.push(p.cpLoss);
          existing.gamesAll.add(p.gameId);
          const result = gameResultMap.get(p.gameId);
          if (result === 'loss') existing.gamesLost.add(p.gameId);
          if (result === 'win') existing.gamesWon.add(p.gameId);
          patternStats.set(p.patternTheme, existing);
        }

        const medianCp = (arr: number[]) => { const s = [...arr].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] ?? 0; };
        const sorted = [...patternStats.entries()]
          .sort((a, b) => {
            // Impact = median cp loss × number of occurrences (total damage)
            const impactA = medianCp(a[1].cpLosses) * a[1].cpLosses.length;
            const impactB = medianCp(b[1].cpLosses) * b[1].cpLosses.length;
            return impactB - impactA;
          });

        const totalLosses = new Set(positions.filter(p => gameResultMap.get(p.gameId) === 'loss').map(p => p.gameId)).size;
        const catLabel = categoryFilter === 'all' ? '' : ` ${CATEGORY_KEYS[categoryFilter] ? t(CATEGORY_KEYS[categoryFilter]).toLowerCase() : categoryFilter.toLowerCase()}`;

        return (
          <div className="mb-3">
            <p className="text-[12px] text-gray-400 mb-2 px-0.5">
              {t('tm_patterns_intro', { category: catLabel })}
            </p>
            <div className="space-y-1.5">
                {(patternFilter ? sorted.filter(([t]) => t === patternFilter) : sorted).map(([theme, stats], idx) => {
                  const cpArr = [...stats.cpLosses].sort((a, b) => a - b);
                  const median = cpArr[Math.floor(cpArr.length / 2)];
                  const lossRate = stats.gamesAll.size > 0 ? Math.round((stats.gamesLost.size / stats.gamesAll.size) * 100) : 0;
                  const isActive = patternFilter === theme;
                  // icon rendered via PatternIcon component
                  const rank = idx + 1;
                  return (
                    <div
                      key={theme}
                      onClick={() => {
                        if (isActive) {
                          setPatternFilter(null);
                          setCategoryFilter('all');
                        } else {
                          setPatternFilter(theme);
                          setCategoryFilter(getCategory(theme));
                        }
                        setVisibleCount(PAGE_SIZE);
                      }}
                      className={`rounded-xl cursor-pointer transition-all relative ${
                        isActive
                          ? 'ring-1 ring-chess-accent/40 bg-gradient-to-r from-chess-accent/10 to-transparent'
                          : 'bg-gradient-to-r from-white/[0.04] to-transparent hover:from-white/[0.06]'
                      }`}
                    >
                      <div className="px-3 py-2.5">
                        {/* Top row: rank + icon + name (always full width) */}
                        <div className="flex items-center gap-2.5">
                          <span className="text-[14px] font-black text-gray-600 w-5 text-center shrink-0">{rank}</span>
                          <div className="w-9 h-9 rounded-lg bg-white/[0.06] flex items-center justify-center shrink-0">
                            <PatternIcon theme={theme} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-[13px] font-black text-chess-text uppercase tracking-wide">
                              {patternLabel(theme, t)}
                            </div>
                            <div className="text-[10px] text-gray-500">
                              {stats.gamesAll.size} {t('common_games')} | {stats.cpLosses.length} {t('common_occurrences')}
                            </div>
                          </div>
                          {/* CP Loss + gauge — inline on md+, hidden on mobile */}
                          <div className="hidden md:flex items-center gap-3 relative group/stats" onClick={(e) => e.stopPropagation()}>
                            <CpLossBadge cp={median} />
                            <LossRateGauge percent={lossRate} size={44} />
                            {/* Tooltip — only on hover of CP/gauge area */}
                            <div className="invisible group-hover/stats:visible opacity-0 group-hover/stats:opacity-100 transition-opacity duration-150 absolute right-0 bottom-full mb-2 z-50 bg-chess-surface border border-chess-border/40 rounded-lg px-3 py-2.5 shadow-xl text-[10px] text-chess-text-secondary leading-relaxed w-64 pointer-events-none">
                              <p><span className={`font-bold ${cpSeverity(median, t).color}`}>{'\u2212'}{median} CP</span> = {t('tooltip_cp_desc')} {median >= 200 ? t('tooltip_cp_piece') : median >= 100 ? t('tooltip_cp_pawn') : t('tooltip_cp_minor')}</p>
                              <p className="mt-1.5"><span className="font-bold text-chess-text">{lossRate}% {t('common_lost')}</span> = {t('tooltip_loss_rate', { lost: String(stats.gamesLost.size), total: String(stats.gamesAll.size) })}</p>
                            </div>
                          </div>
                        </div>
                        {/* Bottom row on mobile: CP loss + gauge — right-aligned */}
                        <div className="flex md:hidden items-center justify-end gap-3 mt-1.5">
                          <CpLossBadge cp={median} compact />
                          <LossRateGauge percent={lossRate} size={38} />
                        </div>
                      </div>

                      {/* Expanded stats when active */}
                      {isActive && (
                        <div className="px-3 pb-3 pt-1">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-[10px] text-chess-accent cursor-pointer">{t('tm_clear_filter')}</span>
                          </div>
                          <div className="grid grid-cols-3 gap-2">
                            <div className="bg-white/[0.04] rounded-lg px-2.5 py-2 text-center">
                              <div className="text-[16px] font-black text-chess-blunder">{stats.gamesLost.size}</div>
                              <div className="text-[9px] text-gray-500 mt-0.5">{t('tm_games_lost')}</div>
                            </div>
                            <div className="bg-white/[0.04] rounded-lg px-2.5 py-2 text-center">
                              <div className="text-[16px] font-black text-amber-400">{'\u2212'}{median}</div>
                              <div className="text-[9px] text-gray-500 mt-0.5">{t('tm_cp_per_mistake')}</div>
                            </div>
                            <div className="bg-white/[0.04] rounded-lg px-2.5 py-2 text-center">
                              <div className={`text-[16px] font-black ${lossRate >= 50 ? 'text-chess-blunder' : 'text-gray-300'}`}>{lossRate}%</div>
                              <div className="text-[9px] text-gray-500 mt-0.5">{t('tm_loss_rate')}</div>
                            </div>
                          </div>
                          <div className="mt-2 flex items-center gap-1.5">
                            <div className="flex h-[6px] flex-1 rounded-full overflow-hidden bg-gray-700">
                              <div className="bg-chess-accent" style={{ width: `${Math.round((stats.gamesWon.size / Math.max(stats.gamesAll.size, 1)) * 100)}%` }} />
                              <div className="bg-chess-blunder" style={{ width: `${lossRate}%` }} />
                            </div>
                            <span className="text-[10px] text-gray-500 shrink-0">
                              <span className="text-chess-accent">{stats.gamesWon.size}W</span> / <span className="text-chess-blunder">{stats.gamesLost.size}L</span>
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              {totalLosses > 0 && (
                <div className="px-1 py-1.5 text-[10px] text-gray-500">
                  {t('tm_games_lost_total', { count: String(totalLosses), category: catLabel })}
                </div>
              )}
            </div>
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
          return (
            <button
              key={`${item.gameId}-${item.moveIndex}-${idx}`}
              onClick={() => {
                const qIdx = listTab === 'unchecked' ? uncheckedPositions.indexOf(item) : -1;
                startChallenge(item, qIdx >= 0 ? qIdx : undefined);
              }}
              className="w-full rounded-xl bg-chess-surface/15 border border-chess-border/15 overflow-hidden hover:border-chess-accent/30 hover:bg-chess-surface/25 transition-all text-left group"
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
              </div>
              {/* Info row */}
              <div className="px-4 py-3.5 flex items-center justify-between">
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <span className={`text-[11px] px-2 py-0.5 rounded-md ${catColor.bg} ${catColor.text} font-bold`}>{CATEGORY_KEYS[item.category] ? t(CATEGORY_KEYS[item.category]) : item.category}</span>
                    <span className={`text-[11px] px-2 py-0.5 rounded-md ${sev.bg} ${sev.color} font-bold`}>{sev.text}</span>
                  </div>
                  <span className="text-[13px] text-gray-300 font-medium">vs <span className="text-white">{item.gameOpponent}</span> <span className="text-gray-500">({item.gameRating})</span></span>
                </div>
                <span className="text-[11px] text-gray-600 font-medium">{item.gameTimeClass}</span>
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
    </div>
  );
}

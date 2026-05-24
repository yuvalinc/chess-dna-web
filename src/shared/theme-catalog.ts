/**
 * Theme catalog — controlled vocabulary of chess tactical / strategic themes.
 *
 * Used to (1) give the AI a closed vocabulary in the move-explanation prompt,
 * and (2) drive in-app tappable theme references in the rendered explanation.
 *
 * Labels and definitions live in src/i18n/locales/*.ts under keys
 *   theme_<slug>     — short label (e.g. "Fork")
 *   themedef_<slug>  — one-sentence definition
 * Look up via `getThemeLabel(slug, t)` / `getThemeDefinition(slug, t)`.
 */

import type { GamePhase } from './types/analysis';
import type { TranslationKey } from '@/i18n/index';

export type ThemeCategory =
  | 'tactic'   // fork, pin, skewer, deflection, etc.
  | 'mate'     // mate, mateInN, backRankMate, etc.
  | 'pawn'     // promotion, enPassant, advancedPawn, etc.
  | 'attack'   // kingsideAttack, queensideAttack, attackingF2F7
  | 'eval'     // advantage, crushing, equality
  | 'phase'    // opening, middlegame, endgame
  | 'endgame'  // pawnEndgame, rookEndgame, opposition, etc.
  | 'special'; // castling, zugzwang, stalemate, etc.

export interface ThemeEntry {
  slug: string;
  category: ThemeCategory;
  /** Game phases this theme is meaningful in. Used to filter the vocabulary
   *  we inject into the AI prompt — no point listing "rookEndgame" while
   *  analysing an opening move. */
  phases: GamePhase[];
  /** Whether this theme is something a player can train as a puzzle theme.
   *  Not used in the explanation flow today; kept here as a hook for future
   *  use (e.g. "pick a theme to practice"). */
  trainable: boolean;
}

const ALL: GamePhase[] = ['opening', 'middlegame', 'endgame'];
const MID_END: GamePhase[] = ['middlegame', 'endgame'];
const END_ONLY: GamePhase[] = ['endgame'];
const OPEN_MID: GamePhase[] = ['opening', 'middlegame'];

export const THEME_CATALOG: ThemeEntry[] = [
  // ── Tactical motifs ──
  { slug: 'fork',              category: 'tactic', phases: ALL,    trainable: true },
  { slug: 'pin',               category: 'tactic', phases: ALL,    trainable: true },
  { slug: 'skewer',            category: 'tactic', phases: ALL,    trainable: true },
  { slug: 'discoveredAttack',  category: 'tactic', phases: ALL,    trainable: true },
  { slug: 'discoveredCheck',   category: 'tactic', phases: ALL,    trainable: true },
  { slug: 'doubleCheck',       category: 'tactic', phases: ALL,    trainable: true },
  { slug: 'sacrifice',         category: 'tactic', phases: ALL,    trainable: true },
  { slug: 'deflection',        category: 'tactic', phases: ALL,    trainable: true },
  { slug: 'attraction',        category: 'tactic', phases: ALL,    trainable: true },
  { slug: 'interference',      category: 'tactic', phases: MID_END, trainable: true },
  { slug: 'intermezzo',        category: 'tactic', phases: ALL,    trainable: true },
  { slug: 'clearance',         category: 'tactic', phases: ALL,    trainable: true },
  { slug: 'xRayAttack',        category: 'tactic', phases: ALL,    trainable: true },
  { slug: 'capturingDefender', category: 'tactic', phases: ALL,    trainable: true },
  { slug: 'hangingPiece',      category: 'tactic', phases: ALL,    trainable: true },
  { slug: 'trappedPiece',      category: 'tactic', phases: ALL,    trainable: true },
  { slug: 'exposedKing',       category: 'tactic', phases: MID_END, trainable: true },
  { slug: 'quietMove',         category: 'tactic', phases: ALL,    trainable: true },
  { slug: 'defensiveMove',     category: 'tactic', phases: ALL,    trainable: true },
  { slug: 'desperado',         category: 'tactic', phases: MID_END, trainable: true },
  { slug: 'overloading',       category: 'tactic', phases: MID_END, trainable: true },
  { slug: 'windmill',          category: 'tactic', phases: MID_END, trainable: true },
  { slug: 'battery',           category: 'tactic', phases: MID_END, trainable: true },
  { slug: 'unpinning',         category: 'tactic', phases: ALL,    trainable: true },
  { slug: 'blocking',          category: 'tactic', phases: MID_END, trainable: true },
  { slug: 'mateThreat',        category: 'tactic', phases: MID_END, trainable: true },
  { slug: 'counterAttack',     category: 'tactic', phases: ALL,    trainable: true },
  { slug: 'tempoGain',         category: 'tactic', phases: ALL,    trainable: true },

  // ── Mate patterns ──
  { slug: 'mate',              category: 'mate', phases: ALL,     trainable: false },
  { slug: 'mateIn1',           category: 'mate', phases: ALL,     trainable: true },
  { slug: 'mateIn2',           category: 'mate', phases: ALL,     trainable: true },
  { slug: 'mateIn3',           category: 'mate', phases: ALL,     trainable: true },
  { slug: 'mateIn4',           category: 'mate', phases: ALL,     trainable: true },
  { slug: 'mateIn5',           category: 'mate', phases: ALL,     trainable: true },
  { slug: 'backRankMate',      category: 'mate', phases: MID_END, trainable: true },
  { slug: 'smotheredMate',     category: 'mate', phases: MID_END, trainable: true },
  { slug: 'anastasiaMate',     category: 'mate', phases: MID_END, trainable: true },
  { slug: 'arabianMate',       category: 'mate', phases: MID_END, trainable: true },
  { slug: 'bodenMate',         category: 'mate', phases: MID_END, trainable: true },
  { slug: 'doubleBishopMate',  category: 'mate', phases: MID_END, trainable: true },
  { slug: 'dovetailMate',      category: 'mate', phases: MID_END, trainable: true },
  { slug: 'hookMate',          category: 'mate', phases: MID_END, trainable: true },
  { slug: 'epauletteMate',     category: 'mate', phases: MID_END, trainable: true },
  { slug: 'cornerMate',        category: 'mate', phases: MID_END, trainable: true },
  { slug: 'operaMate',         category: 'mate', phases: MID_END, trainable: true },
  { slug: 'morphysMate',       category: 'mate', phases: MID_END, trainable: true },
  { slug: 'supportMate',       category: 'mate', phases: MID_END, trainable: true },
  { slug: 'matingNet',         category: 'mate', phases: MID_END, trainable: true },

  // ── Pawn & special moves ──
  { slug: 'advancedPawn',      category: 'pawn',    phases: MID_END, trainable: true },
  { slug: 'promotion',         category: 'pawn',    phases: END_ONLY, trainable: true },
  { slug: 'underPromotion',    category: 'pawn',    phases: END_ONLY, trainable: true },
  { slug: 'enPassant',         category: 'pawn',    phases: OPEN_MID, trainable: true },
  { slug: 'pawnBreakthrough',  category: 'pawn',    phases: END_ONLY, trainable: true },
  { slug: 'castling',          category: 'special', phases: OPEN_MID, trainable: false },

  // ── Attack themes ──
  { slug: 'attackingF2F7',     category: 'attack', phases: OPEN_MID, trainable: true },
  { slug: 'kingsideAttack',    category: 'attack', phases: ['middlegame'], trainable: true },
  { slug: 'queensideAttack',   category: 'attack', phases: ['middlegame'], trainable: true },
  { slug: 'greekGiftSacrifice', category: 'attack', phases: ['middlegame'], trainable: true },
  { slug: 'queensacrifice',    category: 'attack', phases: MID_END, trainable: true },
  { slug: 'exchangeSacrifice', category: 'attack', phases: MID_END, trainable: true },
  { slug: 'twoRooksOnSeventh', category: 'attack', phases: MID_END, trainable: true },
  { slug: 'alekhinesGun',      category: 'attack', phases: MID_END, trainable: true },

  // ── Eval-state callouts (let the AI flag the position character) ──
  { slug: 'advantage',         category: 'eval', phases: ALL, trainable: false },
  { slug: 'crushing',          category: 'eval', phases: ALL, trainable: false },
  { slug: 'equality',          category: 'eval', phases: ALL, trainable: false },

  // ── Game phase tags ──
  { slug: 'opening',           category: 'phase', phases: ['opening'],   trainable: false },
  { slug: 'middlegame',        category: 'phase', phases: ['middlegame'], trainable: false },
  { slug: 'endgame',           category: 'phase', phases: ['endgame'],   trainable: false },

  // ── Endgame techniques ──
  { slug: 'pawnEndgame',       category: 'endgame', phases: END_ONLY, trainable: true },
  { slug: 'rookEndgame',       category: 'endgame', phases: END_ONLY, trainable: true },
  { slug: 'bishopEndgame',     category: 'endgame', phases: END_ONLY, trainable: true },
  { slug: 'knightEndgame',     category: 'endgame', phases: END_ONLY, trainable: true },
  { slug: 'queenEndgame',      category: 'endgame', phases: END_ONLY, trainable: true },
  { slug: 'queenRookEndgame',  category: 'endgame', phases: END_ONLY, trainable: true },
  { slug: 'opposition',        category: 'endgame', phases: END_ONLY, trainable: true },
  { slug: 'triangulation',     category: 'endgame', phases: END_ONLY, trainable: true },
  { slug: 'simplification',    category: 'endgame', phases: MID_END, trainable: false },

  // ── Special-situation themes ──
  { slug: 'zugzwang',          category: 'special', phases: END_ONLY, trainable: true },
  { slug: 'stalemate',         category: 'special', phases: END_ONLY, trainable: true },
  { slug: 'perpetualCheck',    category: 'special', phases: END_ONLY, trainable: true },
  { slug: 'avoidingPerpetual', category: 'special', phases: END_ONLY, trainable: true },
  { slug: 'avoidingStalemate', category: 'special', phases: END_ONLY, trainable: true },
  { slug: 'crossCheck',        category: 'special', phases: ALL, trainable: true },
  { slug: 'crossPin',          category: 'special', phases: ALL, trainable: true },
  { slug: 'counting',          category: 'special', phases: ALL, trainable: true },
];

/** All valid slugs (canonical lowercase identifiers). */
export const THEME_SLUGS: readonly string[] = THEME_CATALOG.map((t) => t.slug);

const SLUG_SET = new Set(THEME_SLUGS);

export function isValidThemeSlug(slug: string): boolean {
  return SLUG_SET.has(slug);
}

/** Themes valid for a given phase (used to prune the AI's vocabulary). */
export function getThemesForPhase(phase: GamePhase): ThemeEntry[] {
  return THEME_CATALOG.filter((t) => t.phases.includes(phase));
}

/** Build i18n key for a theme's localized short label. */
export function themeLabelKey(slug: string): TranslationKey {
  return `theme_${slug}` as TranslationKey;
}

/** Build i18n key for a theme's localized one-sentence definition. */
export function themeDefinitionKey(slug: string): TranslationKey {
  return `themedef_${slug}` as TranslationKey;
}

/** Pull the `THEMES: slug1, slug2` line off the top of an AI explanation,
 *  returning the remaining body and the parsed (validated) slug list. */
export function extractThemes(raw: string): { body: string; slugs: string[] } {
  const match = raw.match(/^\s*THEMES\s*:\s*([^\n]*)\n?/i);
  if (!match) return { body: raw, slugs: [] };
  const slugList = (match[1] || '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s && s.toLowerCase() !== 'none')
    .filter((s) => isValidThemeSlug(s));
  const slugs = [...new Set(slugList)].slice(0, 4);
  const body = raw.slice(match[0].length);
  return { body, slugs };
}

/**
 * Map our deterministic TacticalMotif tags (engine-detected) onto the
 * external theme catalog slugs. Lets the prompt declare which slugs are
 * "confirmed" by the engine vs. up to the AI to identify.
 */
export const MOTIF_TO_THEME: Record<string, string> = {
  fork: 'fork',
  pin: 'pin',
  skewer: 'skewer',
  discovered_attack: 'discoveredAttack',
  back_rank: 'backRankMate',
  hanging_piece: 'hangingPiece',
  trapped_piece: 'trappedPiece',
  overloaded_piece: 'overloading',
  deflection: 'deflection',
  removal_of_guard: 'capturingDefender',
  pawn_promotion_threat: 'advancedPawn',
  zwischenzug: 'intermezzo',
  // New deterministic motifs added in this pass:
  promotion: 'promotion',
  under_promotion: 'underPromotion',
  en_passant: 'enPassant',
  castling_move: 'castling',
  mate_in_1: 'mateIn1',
  mate_in_2: 'mateIn2',
  mate_in_3: 'mateIn3',
  mate_in_4: 'mateIn4',
  mate_in_5: 'mateIn5',
  back_rank_mate: 'backRankMate',
  smothered_mate: 'smotheredMate',
  mate_threat: 'mateThreat',
  exposed_king: 'exposedKing',
  double_check: 'doubleCheck',
};

/**
 * Time Machine challenge hook — clean rewrite.
 *
 * Core principles:
 *  1. Chess mutations happen OUTSIDE setState (never inside setState callbacks)
 *  2. stateRef always tracks current state for reading in callbacks
 *  3. Simple, predictable phase machine
 *  4. Stockfish is only queried when genuinely needed
 */
import { useState, useCallback, useRef, useEffect } from 'react';
import { Chess } from 'chess.js';
import type { Square } from 'chess.js';
import { StockfishClient } from '@/engine/stockfish-client';
import type { MultiPVLine } from '@/engine/stockfish-client';
import { computeMoveScore } from '@/engine/eval-classifier';
import { uciToSan } from '@shared/utils/chess-utils';
import { sendWithFallback } from '@/ai/ai-router';
import { buildMoveExplanationPrompt } from '@/ai/prompt-builder';
import { playChessSound, type SoundType } from '@shared/utils/chess-sounds';
import { SUPPORTED_LANGUAGES } from '@/i18n/index';
import { TM_ANALYSIS_DEPTH } from '@shared/constants';
import type { MoveAnalysis } from '@shared/types/analysis';
import type { UserSettings } from '@shared/types/storage';

export interface RankedMove {
  rank: number;
  uci: string;      // root move UCI
  san: string;      // root move SAN
  score: number;    // 0-100
  evalCp: number;   // centipawns from mover's perspective
  pvUci: string[];  // full PV in UCI (including root move as first element)
  pvSan: string[];  // full PV in SAN (up to 4 moves)
}

export interface ContinuationMoveRecord {
  fenBefore: string;
  uci: string;
  san: string;
}

export type ChallengePhase =
  | 'leadup'       // auto-playing moves before the mistake
  | 'showMistake'  // briefly showing the original bad move
  | 'critical'     // player must find a better move
  | 'evaluating'   // stockfish is scoring the player's move
  | 'scored'       // score shown — player can retry / reveal / continue
  | 'continuation' // optional follow-up moves vs Stockfish
  | 'complete';    // challenge done

export interface ChallengeConfig {
  gameMoves: MoveAnalysis[];
  startIndex: number;
  criticalIndex: number;
  playerColor: 'white' | 'black';
  opponentRating: number;
  bestMoveUci: string;   // validated before being passed in
  bestMoveSan: string;
  originalMoveUci: string;
  originalMoveSan: string;
  /** How the bot plays during the continuation phase:
   *   - 'opponent' (default): if the user follows the original game's moves,
   *     replay the actual opponent's move; otherwise Stockfish throttled to
   *     opponent rating.
   *   - 'engine': full-strength Stockfish for every reply.
   */
  botMode?: 'opponent' | 'engine';
}

export interface ChallengeState {
  phase: ChallengePhase;
  currentFen: string;   // live game FEN (for leadup / critical / continuation)
  criticalFen: string;  // FEN at the critical moment (for displaying arrows)
  moveIndex: number;
  playerTurn: boolean;
  selectedSquare: Square | null;
  legalMoves: Square[];
  lastMoveFrom: Square | null;
  lastMoveTo: Square | null;
  playerMoveUci: string | null;
  playerMoveSan: string | null;
  moveScore: number | null;
  moveScores: number[];
  showAnswer: boolean;
  evaluating: boolean;
  attempts: number;
  continuationMovesLeft: number;
  opponentThinking: boolean;
  error: string | null;
  aiExplanation: string | null;
  aiExplanationLoading: boolean;
  // Rankings
  fenAfterCritical: string;          // FEN after the player's critical move (or bestMove on reveal)
  fenForContinuation: string;        // FEN after opponent's best response (player's turn — for continuation ranking)
  opponentResponseSan: string;       // opponent's best response SAN (shown in continuation table title)
  criticalRanking: RankedMove[];     // top 5 alternatives at the critical position
  continuationRanking: RankedMove[]; // top 5 player moves from fenForContinuation
  continuationMoves: ContinuationMoveRecord[];  // each move the user played in continuation
  continuationRankings: RankedMove[][];          // one ranking per continuation move
  rankingLoading: boolean;
  /** When a tap-to-move would require a pawn promotion, we record from/to
   *  here and wait for the user to pick Q/R/B/N from a custom picker. */
  pendingPromotion: { from: Square; to: Square } | null;
  /** AI-generated hint for the current player turn (no answer reveal). */
  hint: string | null;
  hintLoading: boolean;
}

const CONTINUATION_MOVES = 3;

function ratingToSkillLevel(rating: number): number {
  if (rating < 800) return 1;
  if (rating < 1200) return 5;
  if (rating < 1600) return 10;
  if (rating < 2000) return 14;
  if (rating < 2400) return 18;
  return 20;
}

function makeInitialState(config: ChallengeConfig | null): ChallengeState {
  const startFen = config
    ? (config.gameMoves[config.startIndex]?.fenBefore ?? 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')
    : 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  return {
    phase: 'leadup',
    currentFen: startFen,
    criticalFen: '',
    moveIndex: config?.startIndex ?? 0,
    playerTurn: false,
    selectedSquare: null,
    legalMoves: [],
    lastMoveFrom: null,
    lastMoveTo: null,
    playerMoveUci: null,
    playerMoveSan: null,
    moveScore: null,
    moveScores: [],
    showAnswer: false,
    evaluating: false,
    attempts: 0,
    continuationMovesLeft: CONTINUATION_MOVES,
    opponentThinking: false,
    error: null,
    aiExplanation: null,
    aiExplanationLoading: false,
    fenAfterCritical: '',
    fenForContinuation: '',
    opponentResponseSan: '',
    criticalRanking: [],
    continuationRanking: [],
    continuationMoves: [],
    continuationRankings: [],
    rankingLoading: false,
    pendingPromotion: null,
    hint: null,
    hintLoading: false,
  };
}

const PIECE_NAMES: Record<string, string> = {
  k: 'king', q: 'queen', r: 'rook', b: 'bishop', n: 'knight', p: 'pawn',
};
const PIECE_NAMES_HE: Record<string, string> = {
  k: 'מלך', q: 'מלכה', r: 'צריח', b: 'רץ', n: 'פרש', p: 'חייל',
};
const PIECE_NAMES_ES: Record<string, string> = {
  k: 'rey', q: 'dama', r: 'torre', b: 'alfil', n: 'caballo', p: 'peón',
};

function getPieceNames(language?: string): Record<string, string> {
  if (language === 'Hebrew') return PIECE_NAMES_HE;
  if (language === 'Spanish') return PIECE_NAMES_ES;
  return PIECE_NAMES;
}

/**
 * Pre-compute verified chess facts about the best move (and optionally the player's move).
 * These are injected into the AI prompt so it cannot hallucinate piece positions or
 * incorrectly claim a piece is "undefended" when the king (or another piece) is guarding it.
 * Piece names are output in the target language so the AI copies them verbatim.
 */
function computePositionFacts(
  fen: string,
  bestMoveUci: string,
  playerMoveUci?: string | null,
  language?: string,
): string {
  const facts: string[] = [];
  const names = getPieceNames(language);

  const describeMove = (chess: Chess, uci: string, label: string) => {
    const from = uci.slice(0, 2) as Square;
    const to = uci.slice(2, 4) as Square;
    const promo = uci.length > 4 ? uci[4] as 'q' | 'r' | 'b' | 'n' : undefined;
    const movingPiece = chess.get(from);
    const capturedPiece = chess.get(to);

    if (!movingPiece) return;

    const movingName = names[movingPiece.type] ?? movingPiece.type;

    if (capturedPiece) {
      let defended = false;
      try {
        const tempChess = new Chess(fen);
        tempChess.move({ from, to, promotion: promo });
        defended = tempChess.moves({ verbose: true }).some(m => m.to === to);
      } catch { /* ignore */ }

      const capturedName = names[capturedPiece.type] ?? capturedPiece.type;
      const defenseNote = defended
        ? 'DEFENDED — opponent can recapture after this capture'
        : 'NOT defended — free capture, no recapture possible';
      facts.push(`${label}: ${movingName} on [${from}] captures ${capturedName} on [${to}]. The ${capturedName} is ${defenseNote}.`);
    } else {
      facts.push(`${label}: ${movingName} on [${from}] moves to [${to}] (no capture).`);
    }

    // After the move, describe what the moved piece attacks
    try {
      const afterChess = new Chess(fen);
      afterChess.move({ from, to, promotion: promo });
      const isCheck = afterChess.isCheck();
      if (isCheck) facts.push(`After ${label}: gives CHECK.`);

      // Flip turn to see what the moved piece attacks
      const fenAfter = afterChess.fen().split(' ');
      fenAfter[1] = fenAfter[1] === 'w' ? 'b' : 'w';
      const flipped = new Chess(fenAfter.join(' '));
      const pieceMoves = flipped.moves({ square: to as Square, verbose: true });

      const attackedPieces: string[] = [];
      for (const m of pieceMoves) {
        const target = flipped.get(m.to as Square);
        if (target && target.color !== movingPiece.color) {
          attackedPieces.push(`${names[target.type]} on [${m.to}]`);
        }
      }

      if (attackedPieces.length > 0) {
        facts.push(`After ${label}: ${movingName} on [${to}] attacks: ${attackedPieces.join(', ')}.`);
      } else {
        facts.push(`After ${label}: ${movingName} on [${to}] does NOT directly attack any opponent pieces.`);
      }

      // Describe what opponent pieces can capture the moved piece (only for non-captures)
      if (!capturedPiece) {
        const threats: string[] = [];
        const opponentMoves = afterChess.moves({ verbose: true });
        for (const om of opponentMoves) {
          if (om.to === to && om.captured) {
            const attacker = afterChess.get(om.from as Square);
            if (attacker) {
              threats.push(`${names[attacker.type]} on [${om.from}]`);
            }
          }
        }
        if (threats.length > 0) {
          facts.push(`${movingName} on [${to}] can be captured by: ${threats.join(', ')}.`);
        }
      }
    } catch { /* ignore */ }
  };

  try {
    const chess = new Chess(fen);
    describeMove(chess, bestMoveUci, 'Best move');
    if (playerMoveUci && playerMoveUci.length >= 4 && playerMoveUci !== bestMoveUci) {
      describeMove(chess, playerMoveUci, "Player's move");
    }
  } catch { /* ignore — position facts are optional */ }

  return facts.join('\n');
}

/**
 * Build a single verified sentence describing the best move — "Queen captures
 * rook on [a1]" / "Knight to [c3]+" / etc. Sourced from chess.js, never from
 * the AI, so it can be used to override hallucinated piece/square mentions in
 * the AI's "Best move:" line.
 */
function describeMoveVerified(fen: string, uci: string, language?: string): string | null {
  if (!uci || uci.length < 4) return null;
  try {
    const chess = new Chess(fen);
    const from = uci.slice(0, 2) as Square;
    const to = uci.slice(2, 4) as Square;
    const promo = uci.length > 4 ? uci[4] as 'q' | 'r' | 'b' | 'n' : undefined;
    const movingPiece = chess.get(from);
    if (!movingPiece) return null;
    const capturedPiece = chess.get(to);
    const names = getPieceNames(language);
    const movingName = names[movingPiece.type] ?? movingPiece.type;
    // Capitalize for English/Spanish sentence start; Hebrew has no case.
    const cap = (s: string) => language === 'Hebrew' ? s : s.charAt(0).toUpperCase() + s.slice(1);
    const movingCap = cap(movingName);

    let sentence: string;
    if (capturedPiece) {
      const capturedName = names[capturedPiece.type] ?? capturedPiece.type;
      if (language === 'Hebrew') {
        sentence = `${movingCap} לוכד ${capturedName} ב-[${to}]`;
      } else if (language === 'Spanish') {
        sentence = `${movingCap} captura ${capturedName} en [${to}]`;
      } else {
        sentence = `${movingCap} captures ${capturedName} on [${to}]`;
      }
    } else {
      if (language === 'Hebrew') {
        sentence = `${movingCap} ל-[${to}]`;
      } else if (language === 'Spanish') {
        sentence = `${movingCap} a [${to}]`;
      } else {
        sentence = `${movingCap} to [${to}]`;
      }
    }

    // Tack on check / mate marker so the verified sentence carries the
    // same urgency the AI would (often correctly) reach for.
    try {
      const after = new Chess(fen);
      after.move({ from, to, promotion: promo });
      if (after.isCheckmate()) {
        sentence += language === 'Hebrew' ? ' (מט)' : language === 'Spanish' ? ' (mate)' : ' (mate)';
      } else if (after.isCheck()) {
        sentence += '+';
      }
    } catch { /* ignore */ }

    return sentence + '.';
  } catch {
    return null;
  }
}

/**
 * Pre-compute verified facts about a position for HINT generation.
 * Lists the actual pieces on the board, hanging pieces (loose targets and
 * pieces under attack), and check status — WITHOUT directly revealing the
 * engine best move. Injected into the hint prompt so the AI can't hallucinate
 * "knight on h4" when no knight exists, or invent a defended-bishop scenario
 * when the queen is the actually hanging piece.
 * Piece names are output in the target language so the AI copies them verbatim.
 */
function computeHintFacts(fen: string, language?: string): string {
  const facts: string[] = [];
  const names = getPieceNames(language);

  try {
    const chess = new Chess(fen);
    const turn = chess.turn();
    const opponentColor = turn === 'w' ? 'b' : 'w';

    // 1. Inventory: list every piece by side so the AI cannot invent pieces.
    const board = chess.board();
    const myPieces: string[] = [];
    const oppPieces: string[] = [];
    for (let rank = 0; rank < 8; rank++) {
      for (let file = 0; file < 8; file++) {
        const sq = board[rank][file];
        if (!sq) continue;
        const square = String.fromCharCode(97 + file) + (8 - rank);
        const name = names[sq.type] ?? sq.type;
        const desc = `${name} on [${square}]`;
        if (sq.color === turn) myPieces.push(desc);
        else oppPieces.push(desc);
      }
    }
    facts.push(`YOUR pieces (side to move): ${myPieces.join(', ') || 'none'}.`);
    facts.push(`OPPONENT pieces: ${oppPieces.join(', ') || 'none'}.`);

    // 2. Check status — must be addressed first if true.
    if (chess.inCheck()) {
      facts.push(`YOU are in CHECK — the hint MUST be about getting out of check.`);
    }

    // 3. Hanging opponent pieces — undefended targets you can capture for free.
    //    Most common tactical hint, and the user can verify it themselves.
    const myMoves = chess.moves({ verbose: true });
    const captures = myMoves.filter(m => m.captured);
    const hangingOpp = new Map<string, string>();
    for (const cap of captures) {
      if (hangingOpp.has(cap.to)) continue;
      try {
        const capName = names[cap.captured!] ?? cap.captured!;
        const tempChess = new Chess(fen);
        tempChess.move(cap);
        const defended = tempChess.moves({ verbose: true }).some(m => m.to === cap.to);
        if (!defended) hangingOpp.set(cap.to, `${capName} on [${cap.to}]`);
      } catch { /* ignore */ }
    }
    if (hangingOpp.size > 0) {
      facts.push(`OPPONENT loose/hanging pieces (free captures available): ${[...hangingOpp.values()].join(', ')}.`);
    } else {
      facts.push(`OPPONENT has NO undefended pieces — no free captures available.`);
    }

    // 3b. WINNING EXCHANGES — captures where the captured piece is worth more
    //     than the attacker, so even after recapture you net material. This is
    //     the "pawn takes queen" pattern: even if the queen is defended by a
    //     pawn, exf4 wins because P(1) trades for Q(9). Without this signal,
    //     the AI fell back to inventing nonsense ("knight fork from h4") in
    //     positions where the engine's best move is a defended-piece capture.
    const PIECE_VALUES: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };
    const winningExchanges: string[] = [];
    const seenExchangeSquares = new Set<string>();
    for (const cap of captures) {
      if (seenExchangeSquares.has(cap.to)) continue;
      if (hangingOpp.has(cap.to)) continue; // already covered above as free capture
      seenExchangeSquares.add(cap.to);
      try {
        const capturedType = cap.captured ?? 'p';
        const movingType = cap.piece;
        const capturedVal = PIECE_VALUES[capturedType] ?? 0;
        const movingVal = PIECE_VALUES[movingType] ?? 0;
        if (capturedVal > movingVal) {
          const capName = names[capturedType] ?? capturedType;
          const movingName = names[movingType] ?? movingType;
          winningExchanges.push(`${movingName} captures ${capName} on [${cap.to}] (gains ${capturedVal - movingVal} points)`);
        }
      } catch { /* ignore */ }
    }
    if (winningExchanges.length > 0) {
      facts.push(`WINNING EXCHANGES (capture wins material even after recapture — these are tactical sacrifices, NOT free captures): ${winningExchanges.join('; ')}.`);
    }

    // 4. Your hanging pieces — what's at risk so the AI doesn't suggest you
    //    "defend the bishop" when the queen is the actually hanging piece.
    try {
      const fenParts = fen.split(' ');
      fenParts[1] = opponentColor;
      fenParts[3] = '-';
      const flipped = new Chess(fenParts.join(' '));
      const oppCaptures = flipped.moves({ verbose: true }).filter(m => m.captured);
      const myHanging = new Map<string, string>();
      for (const threat of oppCaptures) {
        if (myHanging.has(threat.to)) continue;
        const threatenedName = names[threat.captured!] ?? threat.captured!;
        const myDefenders = chess.moves({ verbose: true }).filter(m => m.to === threat.to);
        if (myDefenders.length === 0) {
          myHanging.set(threat.to, `${threatenedName} on [${threat.to}]`);
        }
      }
      if (myHanging.size > 0) {
        facts.push(`YOUR pieces under attack with NO defender (highest priority to address): ${[...myHanging.values()].join(', ')}.`);
      }
    } catch { /* ignore */ }
  } catch { /* facts are optional */ }

  return facts.join('\n');
}

/**
 * Overwrite the AI's "Best move:" sentence with a chess.js-verified
 * description while keeping any "why" reasoning the AI added. The AI is
 * unreliable about which piece moved and where — it often hallucinates an
 * impossible source square or wrong piece type. We trust chess.js for the
 * move identity and let the AI keep its tactical commentary (forks, threats,
 * piece coordination, etc.).
 *
 * Strategy:
 *   1. Locate the "Best move:" label (any of EN/HE/ES).
 *   2. Find the end of the first sentence in that section — that sentence
 *      is where the AI named the move and is the most likely to be wrong.
 *   3. Replace just that first sentence with `verified`; keep everything else.
 *
 * If no "Best move:" label is found, append a verified one.
 * If we can't find a sentence boundary, prepend `verified` and leave the AI
 * text alone (worst case: duplicated description, never wrong primary info).
 */
function applyVerifiedBestMove(aiText: string, verified: string | null): string {
  if (!verified) return aiText;
  const labelRe = /(best move|המהלך הטוב|la mejor jugada|mejor jugada)\s*[:：]\s*/i;
  const m = aiText.match(labelRe);
  if (!m) {
    return aiText.trimEnd() + (aiText ? '\n\n' : '') + 'Best move: ' + verified;
  }
  const labelEnd = m.index! + m[0].length;
  // Section ends at the next labeled section ("Your move:" / etc.) or EOF.
  const nextLabelRe = /\n\s*(?:your move|המהלך שלך|tu jugada)\s*[:：]/i;
  const restAfterLabel = aiText.slice(labelEnd);
  const nextMatch = restAfterLabel.match(nextLabelRe);
  const sectionEnd = nextMatch ? labelEnd + nextMatch.index! : aiText.length;
  const section = aiText.slice(labelEnd, sectionEnd);

  // Skip-if-correct: when the AI's section already opens with our verified
  // description verbatim, the AI got it right. Leave its "why" tail intact
  // (e.g. "...wins a clean knight while landing a check").
  const verifiedKey = verified.replace(/[.!?]+\s*$/, '').toLowerCase();
  if (section.trimStart().toLowerCase().startsWith(verifiedKey)) {
    return aiText;
  }

  // Otherwise the AI invented a piece or square — replace just the first
  // sentence (where the AI named the move) with our verified description,
  // keeping any later sentences for tactical context.
  const firstSentenceMatch = section.match(/^[^.!?]*[.!?]/);
  let replaced: string;
  if (firstSentenceMatch) {
    const tail = section.slice(firstSentenceMatch[0].length).trimStart();
    replaced = verified + (tail ? ' ' + tail : '');
  } else {
    replaced = verified + ' ' + section.trimStart();
  }
  return aiText.slice(0, labelEnd) + replaced + aiText.slice(sectionEnd);
}

/**
 * Convert MultiPV lines from Stockfish into scored RankedMove objects.
 * Scores are relative to rank-1 (best move = 100).
 * Evals are already from the mover's perspective (Stockfish UCI convention).
 */
function multiPVToRankedMoves(lines: MultiPVLine[], fen: string, playerMoveUci?: string | null, bestMoveUci?: string): RankedMove[] {
  if (lines.length === 0) return [];

  const rank1 = lines[0];
  const rank1Eval = rank1.scoreType === 'mate'
    ? (rank1.score > 0 ? 10000 : -10000)
    : rank1.score;

  return lines.map(line => {
    const evalCp = line.scoreType === 'mate'
      ? (line.score > 0 ? 10000 : -10000)
      : line.score;

    const score = line.rank === 1 ? 100 : Math.max(0, computeMoveScore(rank1Eval, evalCp));

    // Convert root move UCI → SAN
    const san = uciToSan(fen, line.moveUci) || line.moveUci;

    // Convert PV to SAN (up to 4 moves for display)
    const pvSan: string[] = [];
    try {
      const chess = new Chess(fen);
      for (const uci of line.pv.slice(0, 4)) {
        const from = uci.slice(0, 2) as Square;
        const to = uci.slice(2, 4) as Square;
        const promo = uci.length > 4 ? uci[4] as 'q' | 'r' | 'b' | 'n' : undefined;
        const result = chess.move({ from, to, promotion: promo });
        if (!result) break;
        pvSan.push(result.san);
      }
    } catch { /* partial PV is fine */ }

    void playerMoveUci; void bestMoveUci; // used by caller for highlighting

    return { rank: line.rank, uci: line.moveUci, san, score, evalCp, pvUci: line.pv, pvSan };
  });
}

function tryMove(chess: Chess, moveSan: string, moveUci: string): ReturnType<Chess['move']> | null {
  try { return chess.move(moveSan) ?? null; } catch { /* fall through */ }
  try {
    return chess.move({
      from: moveUci.slice(0, 2) as Square,
      to: moveUci.slice(2, 4) as Square,
      promotion: moveUci.length > 4 ? moveUci[4] as 'q' | 'r' | 'b' | 'n' : undefined,
    }) ?? null;
  } catch { return null; }
}

/**
 * Pick a SoundType from a chess.js move result. Captures (regular + en
 * passant) get the heavier capture sound; castling gets the double-tap;
 * everything else falls back to the regular wood-click — different pitch
 * for the user vs. the opponent so the listener can tell whose turn ticked.
 */
function moveResultToSoundType(
  result: { flags?: string } | null,
  isOpponent: boolean,
): SoundType {
  const flags = result?.flags ?? '';
  if (flags.includes('k') || flags.includes('q')) return 'castle';
  if (flags.includes('c') || flags.includes('e')) return 'capture';
  return isOpponent ? 'move-opponent' : 'move';
}

type BuildPromptFn = (
  fen: string, playerMoveSan: string, bestMoveSan: string, cpDiff: number,
  playerRating: number, bestMovePv?: string[], tacticalMotifs?: string[],
  positionFacts?: string, language?: string,
) => { system: string; user: string };

export function useTimeMachineChallenge(config: ChallengeConfig | null, settings?: UserSettings, buildPromptFn?: BuildPromptFn) {
  const [state, setState] = useState<ChallengeState>(() => makeInitialState(config));

  // stateRef: always current state, safe to read in callbacks without stale closures
  const stateRef = useRef(state);
  stateRef.current = state;

  const chessRef = useRef<Chess>(new Chess());
  const sfInitRef = useRef(false);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  // Opponent moves already played at each FEN across retries — used to
  // diversify the computer reply on 2nd+ attempts when multiple moves are
  // essentially equally best.
  const opponentMoveHistoryRef = useRef<Map<string, Set<string>>>(new Map());
  const buildPromptRef = useRef(buildPromptFn ?? buildMoveExplanationPrompt);
  buildPromptRef.current = buildPromptFn ?? buildMoveExplanationPrompt;

  // --- Initialize on config change ---
  useEffect(() => {
    if (!config) return;

    const startFen = config.gameMoves[config.startIndex]?.fenBefore
      ?? 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

    const critMove = config.gameMoves[config.criticalIndex];
    console.log('[TM] Init config — playerColor:', config.playerColor,
      'startIdx:', config.startIndex, 'critIdx:', config.criticalIndex,
      'critMove.color:', critMove?.color,
      'bestMoveUci:', config.bestMoveUci,
      'critFEN side:', critMove?.fenBefore?.split(' ')[1]);

    // Sanity check: critical move color must match playerColor
    if (critMove && critMove.color !== config.playerColor) {
      console.error('[TM] ⚠️ MISMATCH — critMove.color:', critMove.color, '!== playerColor:', config.playerColor);
    }

    chessRef.current = new Chess(startFen);
    opponentMoveHistoryRef.current = new Map();
    setState(makeInitialState(config));

    if (!sfInitRef.current) {
      StockfishClient.getInstance().initialize()
        .then(() => { sfInitRef.current = true; })
        .catch(err => console.error('[TM] Stockfish init failed:', err));
    }
  }, [config]);

  // --- Advance leadup (called by timer in the page component) ---
  const advanceLeadup = useCallback(() => {
    if (!config) return;
    const cur = stateRef.current;
    if (cur.phase !== 'leadup') return;

    const chess = chessRef.current;
    const nextIdx = cur.moveIndex;

    if (nextIdx >= config.criticalIndex) {
      // Reached the critical moment
      const criticalFen = chess.fen();
      const critMove = config.gameMoves[config.criticalIndex];

      console.log('[TM] Critical reached. FEN side:', criticalFen.split(' ')[1],
        'playerColor:', config.playerColor,
        'chess.turn():', chess.turn());

      if (!critMove) {
        setState(prev => ({ ...prev, phase: 'critical', criticalFen, currentFen: criticalFen, playerTurn: true, lastMoveFrom: null, lastMoveTo: null }));
        return;
      }

      // Play the mistake to show it briefly
      const result = tryMove(chess, critMove.moveSan, critMove.moveUci);
      if (result) {
        setState(prev => ({
          ...prev,
          phase: 'showMistake',
          currentFen: chess.fen(),
          criticalFen,
          lastMoveFrom: result.from as Square,
          lastMoveTo: result.to as Square,
        }));
      } else {
        // Can't replay mistake — go straight to critical
        console.warn('[TM] Could not replay mistake move, going straight to critical');
        setState(prev => ({ ...prev, phase: 'critical', criticalFen, currentFen: criticalFen, playerTurn: true, lastMoveFrom: null, lastMoveTo: null }));
      }
      return;
    }

    // Play next leadup move
    const move = config.gameMoves[nextIdx];
    if (!move) { setState(prev => ({ ...prev, moveIndex: nextIdx + 1 })); return; }

    const result = tryMove(chess, move.moveSan, move.moveUci);
    if (result) {
      // Sound differs based on whose move this is in the replayed game:
      // matches player's color → "your" wood click; otherwise → opponent's
      // (darker) variant. Captures and castles override both.
      const isOpponentMove = move.color !== config.playerColor;
      playChessSound(moveResultToSoundType(result, isOpponentMove));
      setState(prev => ({
        ...prev,
        currentFen: chess.fen(),
        moveIndex: nextIdx + 1,
        lastMoveFrom: result.from as Square,
        lastMoveTo: result.to as Square,
      }));
    } else {
      console.warn('[TM] Could not play leadup move at index', nextIdx, '— skipping');
      setState(prev => ({ ...prev, moveIndex: nextIdx + 1 }));
    }
  }, [config]);

  // --- Undo the shown mistake, enter critical phase ---
  const undoMistake = useCallback(() => {
    if (!config) return;
    const cur = stateRef.current;
    if (cur.phase !== 'showMistake') return;

    const chess = chessRef.current;
    chess.undo();

    const afterUndoFen = chess.fen();
    const chessTurn = chess.turn() === 'w' ? 'white' : 'black';
    const isPlayerTurn = chessTurn === config.playerColor;

    console.log('[TM] undoMistake — afterUndoFen:', afterUndoFen.slice(0, 40),
      '| criticalFen matches:', afterUndoFen === cur.criticalFen,
      '| chess.turn:', chess.turn(), '| playerColor:', config.playerColor,
      '| isPlayerTurn:', isPlayerTurn);

    if (!isPlayerTurn) {
      console.error('[TM] ⚠️ After undo, NOT player\'s turn! chess.turn():', chess.turn(), 'playerColor:', config.playerColor);
    }

    setState(prev => ({
      ...prev,
      phase: 'critical',
      currentFen: afterUndoFen,
      playerTurn: isPlayerTurn,
      selectedSquare: null,
      legalMoves: [],
      lastMoveFrom: null,
      lastMoveTo: null,
    }));
  }, [config]);

  // --- Square click ---
  const onSquareClick = useCallback((square: Square) => {
    if (!config) return;
    const cur = stateRef.current;
    if (!cur.playerTurn || cur.opponentThinking || cur.evaluating) return;
    if (cur.phase !== 'critical' && cur.phase !== 'continuation') return;

    const chess = chessRef.current;

    if (cur.selectedSquare) {
      // If this would be a pawn promotion (pawn lands on rank 1 or 8) and
      // the move is otherwise legal, pause for the user to pick the piece.
      const piece = chess.get(cur.selectedSquare);
      if (piece?.type === 'p' && (square[1] === '1' || square[1] === '8')) {
        const legal = chess.moves({ square: cur.selectedSquare, verbose: true })
          .some(m => m.to === square);
        if (legal) {
          setState(prev => ({
            ...prev,
            pendingPromotion: { from: cur.selectedSquare!, to: square },
          }));
          return;
        }
      }

      // Attempt move (no promotion required)
      const fenBefore = chess.fen();
      let result;
      try {
        result = chess.move({ from: cur.selectedSquare, to: square });
      } catch { result = null; }

      if (result) {
        const moveUci = result.from + result.to + (result.promotion ?? '');
        const isContinuation = cur.phase === 'continuation';
        playChessSound(moveResultToSoundType(result, false));
        setState(prev => ({
          ...prev,
          currentFen: chess.fen(),
          selectedSquare: null,
          legalMoves: [],
          playerTurn: false,
          lastMoveFrom: result!.from as Square,
          lastMoveTo: result!.to as Square,
          playerMoveUci: moveUci,
          playerMoveSan: result!.san,
          // Player has started a new move — drop the previous move's
          // your-move-vs-best arrows. They'll re-appear once this move scores.
          showAnswer: false,
          ...(isContinuation ? { continuationMoves: [...prev.continuationMoves, { fenBefore, uci: moveUci, san: result!.san }] } : {}),
        }));
        if (isContinuation) console.log(`[TM CONT MOVE] Recorded continuation move: ${result!.san} (${moveUci}) phase=${cur.phase}`);
        return;
      }
      // Didn't move — maybe selecting a different piece
    }

    // Select piece
    const piece = chess.get(square);
    if (!piece || piece.color !== (config.playerColor === 'white' ? 'w' : 'b')) {
      setState(prev => ({ ...prev, selectedSquare: null, legalMoves: [] }));
      return;
    }
    const moves = chess.moves({ square, verbose: true });
    setState(prev => ({
      ...prev,
      selectedSquare: square,
      legalMoves: moves.map(m => m.to as Square),
    }));
  }, [config]);

  // --- Piece drop ---
  // `promotion` is optional — the caller (board UI) supplies it when the
  // user picks Q/R/B/N from the promotion popup. If omitted and the move
  // requires promotion, defaults to queen.
  const onPieceDrop = useCallback((from: string, to: string, promotion?: 'q' | 'r' | 'b' | 'n'): boolean => {
    if (!config) return false;
    const cur = stateRef.current;
    if (!cur.playerTurn || cur.opponentThinking || cur.evaluating) return false;
    if (cur.phase !== 'critical' && cur.phase !== 'continuation') return false;

    const chess = chessRef.current;
    const fenBefore = chess.fen();
    let result;
    try {
      const piece = chess.get(from as Square);
      const needsPromo = piece?.type === 'p' && (to[1] === '1' || to[1] === '8');
      result = chess.move({ from: from as Square, to: to as Square, promotion: needsPromo ? (promotion ?? 'q') : undefined });
    } catch { result = null; }

    if (!result) return false;

    const moveUci = result.from + result.to + (result.promotion ?? '');
    const isContinuation = cur.phase === 'continuation';
    playChessSound(moveResultToSoundType(result, false));
    setState(prev => ({
      ...prev,
      currentFen: chess.fen(),
      selectedSquare: null,
      legalMoves: [],
      playerTurn: false,
      lastMoveFrom: result!.from as Square,
      lastMoveTo: result!.to as Square,
      playerMoveUci: moveUci,
      playerMoveSan: result!.san,
      // Drop the previous move's arrows the moment the user plays again.
      showAnswer: false,
      ...(isContinuation ? { continuationMoves: [...prev.continuationMoves, { fenBefore, uci: moveUci, san: result!.san }] } : {}),
    }));
    if (isContinuation) console.log(`[TM CONT MOVE] Recorded continuation move (drop): ${result!.san} (${moveUci}) phase=${cur.phase}`);
    return true;
  }, [config]);

  // --- Complete a tap-to-move promotion: user picked Q/R/B/N from the picker ---
  const completePromotion = useCallback((piece: 'q' | 'r' | 'b' | 'n') => {
    if (!config) return;
    const cur = stateRef.current;
    if (!cur.pendingPromotion) return;
    const { from, to } = cur.pendingPromotion;

    const chess = chessRef.current;
    const fenBefore = chess.fen();
    let result;
    try {
      result = chess.move({ from, to, promotion: piece });
    } catch { result = null; }

    if (!result) {
      setState(prev => ({ ...prev, pendingPromotion: null }));
      return;
    }

    const moveUci = result.from + result.to + (result.promotion ?? '');
    const isContinuation = cur.phase === 'continuation';
    playChessSound(moveResultToSoundType(result, false));
    setState(prev => ({
      ...prev,
      currentFen: chess.fen(),
      selectedSquare: null,
      legalMoves: [],
      playerTurn: false,
      lastMoveFrom: result!.from as Square,
      lastMoveTo: result!.to as Square,
      playerMoveUci: moveUci,
      playerMoveSan: result!.san,
      pendingPromotion: null,
      // Drop the previous move's arrows the moment the user plays again.
      showAnswer: false,
      ...(isContinuation ? { continuationMoves: [...prev.continuationMoves, { fenBefore, uci: moveUci, san: result!.san }] } : {}),
    }));
  }, [config]);

  const cancelPromotion = useCallback(() => {
    setState(prev => prev.pendingPromotion ? { ...prev, pendingPromotion: null, selectedSquare: null, legalMoves: [] } : prev);
  }, []);

  // --- Score the player's move (fires after player moves in critical OR continuation phase) ---
  useEffect(() => {
    if (!config) return;
    const cur = stateRef.current;

    if (cur.phase !== 'critical' && cur.phase !== 'continuation') return;
    if (cur.playerTurn || cur.evaluating) return;
    if (!cur.playerMoveUci) return;

    const isCritical = cur.phase === 'critical';
    // Critical phase: scoring FEN is the original criticalFen.
    // Continuation phase: scoring FEN is the fenBefore of the most recent continuation move.
    const lastContMove = cur.continuationMoves[cur.continuationMoves.length - 1];
    const scoringFen = isCritical ? cur.criticalFen : (lastContMove?.fenBefore ?? '');
    if (!scoringFen) return;
    // Guard: position must have changed from the scoring FEN (player has moved).
    if (cur.currentFen === scoringFen) return;
    // Dedup: don't re-score a move we've already scored.
    // Critical: scored when moveScores length is 0.
    // Continuation: scored when moveScores length < 1 + continuationMoves length.
    const expectedScores = isCritical ? 0 : cur.continuationMoves.length;
    if (cur.moveScores.length > expectedScores) return;

    console.log(`[TM] Scoring ${cur.phase} move:`, cur.playerMoveUci, 'fen:', scoringFen.slice(0, 40));

    setState(prev => ({ ...prev, phase: 'evaluating', evaluating: true, error: null }));

    (async () => {
      try {
        const sf = StockfishClient.getInstance();
        await sf.ensureHealthy();

        // Get top-5 alternatives at the scoring FEN — used for both eval and ranking.
        const lines = await sf.analyzePositionMultiPV(scoringFen, 14, 5);
        const ranking = multiPVToRankedMoves(lines, scoringFen, cur.playerMoveUci, isCritical ? config.bestMoveUci : undefined);

        // evalBestCp: best achievable eval at scoringFen, from mover's perspective.
        // For critical phase, prefer the cached pre-game analysis if available; otherwise use multipv.
        const critMove = config.gameMoves[config.criticalIndex];
        const isPlayerWhite = config.playerColor === 'white';
        let evalBestCp: number;
        if (isCritical && critMove?.evalBefore?.scoreType === 'cp') {
          evalBestCp = isPlayerWhite ? critMove.evalBefore.score : -critMove.evalBefore.score;
        } else {
          evalBestCp = ranking.length > 0 ? ranking[0].evalCp : 0;
        }

        // evalAfterCp: evaluation after player's move, from player's perspective
        // After player moves, it's opponent's turn → negate Stockfish output
        const chess = chessRef.current;
        const afterEval = await sf.analyzePosition(chess.fen(), TM_ANALYSIS_DEPTH);
        const evalAfterCp = afterEval.scoreType === 'mate'
          ? (afterEval.score > 0 ? -10000 : 10000)
          : -afterEval.score;

        let score = computeMoveScore(evalBestCp, evalAfterCp);

        // For critical phase, use the preset best move; for continuation, use the live rank-1 move.
        const dynamicBestUci = ranking[0]?.uci ?? '';
        const bestUci = isCritical ? config.bestMoveUci : dynamicBestUci;
        const bestSan = isCritical
          ? (config.bestMoveSan || config.bestMoveUci)
          : (ranking[0]?.san || ranking[0]?.uci || '');

        // Playing the exact engine best move always scores 100 regardless of eval variance
        if (cur.playerMoveUci === bestUci) {
          score = 100;
        }
        // Penalise repeating the exact same mistake (critical phase only)
        else if (isCritical && cur.playerMoveUci === config.originalMoveUci) {
          score = Math.min(score, 10);
        }

        console.log('[TM] Score:', score, 'evalBestCp:', evalBestCp, 'evalAfterCp:', evalAfterCp);

        setState(prev => ({
          ...prev,
          phase: 'scored',
          evaluating: false,
          moveScore: score,
          moveScores: [...prev.moveScores, score],
          showAnswer: true,
          fenAfterCritical: isCritical ? cur.currentFen : prev.fenAfterCritical,
          criticalRanking: isCritical ? ranking : prev.criticalRanking,
          continuationRankings: isCritical ? prev.continuationRankings : [...prev.continuationRankings, ranking],
          continuationRanking: [],
          rankingLoading: false,
          aiExplanation: null,
          aiExplanationLoading: !!settingsRef.current,
          hint: null,
          hintLoading: false,
          error: null,
        }));

        // Always fetch AI explanation, regardless of score, so correct moves
        // also get a "your move was great because..." sentence.
        if (settingsRef.current) {
          const cpDiff = Math.abs(evalBestCp - evalAfterCp);
          const langCode = (settingsRef.current as unknown as Record<string, unknown>)?.language as string | undefined;
          const ttsLang = SUPPORTED_LANGUAGES.find(l => l.code === langCode)?.ttsName;
          const posFacts = computePositionFacts(
            scoringFen,
            bestUci,
            cur.playerMoveUci,
            ttsLang,
          );
          const tacticalMotifs = isCritical ? critMove?.tacticalMotifs : undefined;
          const bestPv = isCritical ? critMove?.evalBefore?.pv : ranking[0]?.pvUci;
          const prompt = buildPromptRef.current(
            scoringFen,
            cur.playerMoveSan ?? cur.playerMoveUci!,
            bestSan,
            cpDiff,
            config.opponentRating,
            bestPv,
            tacticalMotifs,
            posFacts || undefined,
            ttsLang,
          );
          // Pre-compute the verified "Best move:" sentence from chess.js so we
          // can override anything the AI hallucinates for the move identity
          // (wrong piece, impossible source square, etc.).
          const verifiedBest = describeMoveVerified(scoringFen, bestUci, ttsLang);
          // 400 tokens — enough for 1 sentence on "Your move" and 2-3 on
          // "Best move" with the THEMES: prefix line. 200 was clipping the
          // best-move explanation to one short sentence.
          sendWithFallback(settingsRef.current!, prompt.system, [{ role: 'user', content: prompt.user }], 400)
            .then(text => setState(prev => {
              // Keep the explanation as long as we're still inside the same
              // challenge's review surface. Auto-advance moves us from
              // 'scored' to 'continuation' before the AI responds (~3-5s),
              // so dropping unless phase==='scored' loses every explanation
              // for moves 1 + 2 of 3. Resetting to 'leadup' (next challenge
              // starts) is the only state where we discard.
              const keep = prev.phase === 'scored' || prev.phase === 'continuation' || prev.phase === 'complete';
              if (!keep) return prev;
              const corrected = applyVerifiedBestMove(text, verifiedBest);
              return { ...prev, aiExplanation: corrected, aiExplanationLoading: false };
            }))
            .catch(() => setState(prev => ({ ...prev, aiExplanationLoading: false })));
        }
      } catch (err) {
        console.error('[TM] Scoring failed:', err);
        setState(prev => ({
          ...prev,
          phase: 'scored',
          evaluating: false,
          moveScore: null,
          error: 'Engine error — could not score this move.',
        }));
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase, state.playerTurn, state.playerMoveUci, state.currentFen, state.continuationMoves.length, config]);

  // --- Opponent moves in continuation phase ---
  useEffect(() => {
    if (!config) return;
    const cur = stateRef.current;
    if (cur.phase !== 'continuation' || cur.playerTurn || cur.opponentThinking) return;

    const chess = chessRef.current;
    // If the position is already terminal (mate, stalemate, etc.) when we
    // arrive here, there's no opponent reply to compute and no player turn
    // to grant — finish the challenge so the row can resolve. Clear any
    // stale hint so the user doesn't see a leftover "look for tactic"
    // message after they've already been mated.
    if (chess.isGameOver()) {
      setState(prev => ({ ...prev, phase: 'complete', playerTurn: false, opponentThinking: false, currentFen: chess.fen(), hint: null, hintLoading: false }));
      return;
    }
    const turn = chess.turn() === 'w' ? 'white' : 'black';
    if (turn === config.playerColor) {
      setState(prev => ({ ...prev, playerTurn: true }));
      return;
    }

    setState(prev => ({ ...prev, opponentThinking: true }));

    (async () => {
      // Stockfish at depth 10 can return in <100ms on simple positions, which
      // makes the opponent reply land right on top of the player's move sound.
      // Enforce a floor so the two sounds (and the visual move) are clearly
      // separated and the computer feels like it's "thinking" instead of
      // pre-empting the player.
      const MIN_THINK_MS = 350;
      const startTime = Date.now();
      const botMode = config.botMode ?? 'opponent';
      try {
        const sf = StockfishClient.getInstance();
        await sf.ensureHealthy();
        // In opponent mode we throttle Stockfish to roughly the opponent's
        // rating via Skill Level (legacy option). In engine mode we play at
        // max strength — clear the throttle.
        if (botMode === 'opponent') {
          await sf.setOption('Skill Level', ratingToSkillLevel(config.opponentRating));
        } else {
          await sf.setOption('Skill Level', 20);
        }
        const fen = chess.fen();
        const isRetry = stateRef.current.attempts >= 1;
        let chosenUci: string | null = null;

        // Opponent mode: if the player's continuation is still on the
        // original game's script, replay the actual opponent move from the
        // PGN. Falls through to Stockfish if off-script or the SAN doesn't
        // parse in the current position.
        if (botMode === 'opponent' && !isRetry) {
          const continuationIndex = config.criticalIndex + 1 + stateRef.current.continuationMoves.length;
          const onScript = stateRef.current.continuationMoves.every(
            (m, i) => m.san === config.gameMoves[config.criticalIndex + 1 + i]?.moveSan,
          );
          const next = config.gameMoves[continuationIndex];
          if (onScript && next?.moveUci) chosenUci = next.moveUci;
        }

        if (!chosenUci && isRetry) {
          // On the 2nd+ attempt, if multiple moves are essentially tied for
          // best, pick one the opponent hasn't played here yet so the player
          // sees a different reply than last time.
          const lines = await sf.analyzePositionMultiPV(fen, 10, 3);
          if (lines.length > 0) {
            const top = lines[0];
            const equallyBest = lines.filter(l => {
              if (l.scoreType !== top.scoreType) return false;
              if (top.scoreType === 'mate') return l.score === top.score;
              return Math.abs(l.score - top.score) <= 25;
            });
            const history = opponentMoveHistoryRef.current.get(fen) ?? new Set<string>();
            const unused = equallyBest.filter(l => !history.has(l.moveUci));
            const pool = unused.length > 0 ? unused : equallyBest;
            chosenUci = pool[Math.floor(Math.random() * pool.length)].moveUci;
          }
        }

        if (!chosenUci) {
          const result = await sf.analyzePosition(fen, 10);
          chosenUci = result.bestMove ?? null;
        }

        if (chosenUci && chosenUci.length >= 4) {
          let history = opponentMoveHistoryRef.current.get(fen);
          if (!history) { history = new Set(); opponentMoveHistoryRef.current.set(fen, history); }
          history.add(chosenUci);

          const from = chosenUci.slice(0, 2) as Square;
          const to = chosenUci.slice(2, 4) as Square;
          const promo = chosenUci.length > 4 ? chosenUci[4] as 'q' | 'r' | 'b' | 'n' : undefined;
          const moveResult = chess.move({ from, to, promotion: promo });
          if (moveResult) {
            const elapsed = Date.now() - startTime;
            const remaining = MIN_THINK_MS - elapsed;
            if (remaining > 0) await new Promise(r => setTimeout(r, remaining));
            // Wood-knock for every opponent reply — picks the right variant
            // (capture / castle / move-opponent) so the listener can hear
            // what just happened without looking.
            playChessSound(moveResultToSoundType(moveResult, true));
            const movesLeft = stateRef.current.continuationMovesLeft - 1;
            if (movesLeft <= 0 || chess.isGameOver()) {
              setState(prev => ({ ...prev, phase: 'complete', currentFen: chess.fen(), opponentThinking: false, lastMoveFrom: from, lastMoveTo: to, hint: null, hintLoading: false }));
            } else {
              setState(prev => ({ ...prev, currentFen: chess.fen(), playerTurn: true, opponentThinking: false, continuationMovesLeft: movesLeft, lastMoveFrom: from, lastMoveTo: to }));
            }
            return;
          }
        }
      } catch (err) { console.error('[TM] Opponent move failed:', err); }
      setState(prev => ({ ...prev, phase: 'complete', opponentThinking: false }));
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase, state.playerTurn, state.opponentThinking, config]);

  // --- Actions ---

  const retry = useCallback(() => {
    if (!config) return;
    // Rebuild chess state from scratch to critical position
    const startFen = config.gameMoves[config.startIndex]?.fenBefore
      ?? 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    const chess = new Chess(startFen);
    for (let i = config.startIndex; i < config.criticalIndex; i++) {
      const m = config.gameMoves[i];
      if (m) tryMove(chess, m.moveSan, m.moveUci);
    }
    const criticalFen = chess.fen();
    console.log('[TM] Retry — criticalFen:', criticalFen.slice(0, 40), 'chess.turn():', chess.turn(), 'playerColor:', config.playerColor);
    chessRef.current = chess;

    setState(prev => ({
      ...makeInitialState(config),
      phase: 'critical',
      currentFen: criticalFen,
      criticalFen,
      moveIndex: config.criticalIndex,
      playerTurn: chess.turn() === (config.playerColor === 'white' ? 'w' : 'b'),
      attempts: prev.attempts + 1,
    }));
  }, [config]);

  const replayLeadup = useCallback(() => {
    if (!config) return;
    const startFen = config.gameMoves[config.startIndex]?.fenBefore
      ?? 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    chessRef.current = new Chess(startFen);
    setState(prev => ({ ...makeInitialState(config), attempts: prev.attempts }));
  }, [config]);

  // Step backward one move during the leadup animation. Lets the user scrub
  // back through the rewind they just watched. Also rewinds out of critical
  // / showMistake into leadup so the back arrow always feels reactive.
  //
  // Each path plays a wood-click sound for the move being un-played, picked
  // by the moving side (so player vs opponent variants stay correct) and by
  // the move's flags (capture / castle / normal). Without this the rewind
  // is silent and feels disconnected from the forward animation.
  const stepBackLeadup = useCallback(() => {
    if (!config) return;
    const cur = stateRef.current;

    // From showMistake: undo the just-played mistake and drop back to the
    // critical FEN (player would step in here). moveIndex stays at the
    // critical index so a forward step replays the mistake.
    if (cur.phase === 'showMistake') {
      const chess = chessRef.current;
      const undone = chess.undo();
      if (undone) {
        const mistakeMove = config.gameMoves[config.criticalIndex];
        const isOpponent = mistakeMove ? mistakeMove.color !== config.playerColor : false;
        playChessSound(moveResultToSoundType(undone, isOpponent));
      }
      const lastMove = chess.history({ verbose: true }).slice(-1)[0];
      setState(prev => ({
        ...prev,
        phase: 'leadup',
        currentFen: chess.fen(),
        lastMoveFrom: (lastMove?.from as Square | undefined) ?? null,
        lastMoveTo: (lastMove?.to as Square | undefined) ?? null,
      }));
      return;
    }

    // From critical: rewind one move back into the leadup. We have to
    // rewind the chess instance to the FEN before the move that led to
    // the critical position. Easiest: re-replay startIndex..criticalIndex-2
    // (one fewer leadup move). If criticalIndex == startIndex (no leadup at
    // all), this is a no-op.
    if (cur.phase === 'critical') {
      if (config.criticalIndex <= config.startIndex) return;
      const startFen = config.gameMoves[config.startIndex]?.fenBefore ?? '';
      if (!startFen) return;
      const chess = new Chess(startFen);
      // Replay all but the last leadup move.
      const replayUpto = config.criticalIndex - 1;
      let lastFrom: string | null = null;
      let lastTo: string | null = null;
      let lastReplayedFlags = '';
      for (let i = config.startIndex; i < replayUpto; i++) {
        const m = config.gameMoves[i];
        const r = m ? tryMove(chess, m.moveSan, m.moveUci) : null;
        if (r) { lastFrom = r.from; lastTo = r.to; lastReplayedFlags = r.flags ?? ''; }
      }
      chessRef.current = chess;
      // Sound represents the move that was removed (the one at
      // criticalIndex - 1). We pick its variant from the gameMoves entry's
      // SAN so we don't have to re-run chess.move() to fetch flags.
      const removed = config.gameMoves[config.criticalIndex - 1];
      if (removed) {
        const flags = removed.moveSan?.includes('x') ? 'c'
          : (removed.moveSan === 'O-O' || removed.moveSan === 'O-O-O') ? 'k'
            : lastReplayedFlags;
        const isOpponent = removed.color !== config.playerColor;
        playChessSound(moveResultToSoundType({ flags }, isOpponent));
      }
      setState(prev => ({
        ...prev,
        phase: 'leadup',
        moveIndex: replayUpto,
        currentFen: chess.fen(),
        criticalFen: '',
        playerTurn: false,
        selectedSquare: null,
        legalMoves: [],
        lastMoveFrom: lastFrom as Square | null,
        lastMoveTo: lastTo as Square | null,
      }));
      return;
    }

    // From leadup: only step back if we've actually played at least one move
    // beyond the start. moveIndex is the *next* move to play, so the most
    // recent move played is moveIndex - 1.
    if (cur.phase !== 'leadup') return;
    if (cur.moveIndex <= config.startIndex) return;
    const chess = chessRef.current;
    const undone = chess.undo();
    if (undone) {
      const undoneGameMove = config.gameMoves[cur.moveIndex - 1];
      const isOpponent = undoneGameMove ? undoneGameMove.color !== config.playerColor : false;
      playChessSound(moveResultToSoundType(undone, isOpponent));
    }
    const lastMove = chess.history({ verbose: true }).slice(-1)[0];
    setState(prev => ({
      ...prev,
      moveIndex: cur.moveIndex - 1,
      currentFen: chess.fen(),
      lastMoveFrom: (lastMove?.from as Square | undefined) ?? null,
      lastMoveTo: (lastMove?.to as Square | undefined) ?? null,
    }));
  }, [config]);

  const revealWithExplanation = useCallback(() => {
    if (!config) return;
    const critMove = config.gameMoves[config.criticalIndex];
    const bestSan = config.bestMoveSan || config.bestMoveUci;
    const cur = stateRef.current;

    // Compute fenAfterCritical by applying the best move to the critical FEN
    let fenAfterCritical = '';
    try {
      const tmpChess = new Chess(cur.criticalFen || config.gameMoves[config.criticalIndex]?.fenBefore || '');
      if (tmpChess.fen()) {
        const from = config.bestMoveUci.slice(0, 2) as Square;
        const to = config.bestMoveUci.slice(2, 4) as Square;
        const promo = config.bestMoveUci.length > 4 ? config.bestMoveUci[4] as 'q' | 'r' | 'b' | 'n' : undefined;
        const result = tmpChess.move({ from, to, promotion: promo });
        if (result) fenAfterCritical = tmpChess.fen();
      }
    } catch { /* fenAfterCritical stays empty */ }

    // Highlight the best move's from/to squares as yellow tracks so the
    // revealed answer reads visually like a played move.
    const bestFrom = (config.bestMoveUci.slice(0, 2) || null) as Square | null;
    const bestTo = (config.bestMoveUci.slice(2, 4) || null) as Square | null;

    setState(prev => ({
      ...prev,
      phase: 'scored',
      moveScore: 0,
      moveScores: [...prev.moveScores, 0],
      showAnswer: true,
      evaluating: false,
      fenAfterCritical,
      criticalRanking: [],   // reset so ranking effect re-fires
      continuationRanking: [],
      rankingLoading: true,
      aiExplanationLoading: !!settingsRef.current,
      error: null,
      lastMoveFrom: bestFrom,
      lastMoveTo: bestTo,
    }));

    if (settingsRef.current && critMove) {
      // Pass the actual original mistake move so AI can explain exactly why it loses
      const originalMoveSan = config.originalMoveSan || config.originalMoveUci || '(unknown)';
      const langCode2 = (settingsRef.current as unknown as Record<string, unknown>)?.language as string | undefined;
      const ttsLang2 = SUPPORTED_LANGUAGES.find(l => l.code === langCode2)?.ttsName;
      const posFacts = computePositionFacts(
        critMove.fenBefore ?? cur.criticalFen,
        config.bestMoveUci,
        config.originalMoveUci,
        ttsLang2,
      );
      const prompt = buildPromptRef.current(
        critMove.fenBefore ?? cur.criticalFen,
        originalMoveSan,
        bestSan,
        critMove.cpLoss ?? 100,
        config.opponentRating,
        critMove.evalBefore?.pv,
        critMove.tacticalMotifs,
        posFacts || undefined,
        ttsLang2,
      );
      // 400 tokens — see scoring path above for rationale.
      sendWithFallback(settingsRef.current!, prompt.system, [{ role: 'user', content: prompt.user }], 400)
        .then(text => setState(prev => {
          const keep = prev.phase === 'scored' || prev.phase === 'continuation' || prev.phase === 'complete';
          return keep ? { ...prev, aiExplanation: text, aiExplanationLoading: false } : prev;
        }))
        .catch(() => setState(prev => ({ ...prev, aiExplanationLoading: false })));
    }
  }, [config]);

  const continueAfterScore = useCallback(() => {
    if (!config) return;
    const cur = stateRef.current;

    // Reveal-Answer path only: when the user clicked "Reveal answer" (no
    // playerMoveUci was set), the board is still at the critical FEN — bump
    // it forward to fenAfterCritical so continuation plays from there.
    // For ANY actual played move (critical or continuation), chessRef is
    // already at the correct post-move position; resetting to fenAfterCritical
    // here would rewind subsequent continuation moves and break the flow.
    let continuationFen = cur.currentFen;
    if (cur.showAnswer && cur.fenAfterCritical && !cur.playerMoveUci) {
      try {
        chessRef.current = new Chess(cur.fenAfterCritical);
        continuationFen = cur.fenAfterCritical;
      } catch { /* keep existing board */ }
    }

    // If the player's move ended the game (mate they delivered, stalemate,
    // or any other terminal condition), there is nothing left to continue.
    // Skip straight to 'complete' so the row resolves immediately rather
    // than waiting for the opponent useEffect to time out.
    if (chessRef.current.isGameOver()) {
      setState(prev => ({
        ...prev,
        phase: 'complete',
        currentFen: continuationFen,
        playerTurn: false,
        opponentThinking: false,
        showAnswer: false,
        hint: null,
        hintLoading: false,
      }));
      return;
    }

    const playerTurn = chessRef.current.turn() === (config.playerColor === 'white' ? 'w' : 'b');

    // We deliberately keep moveScore, playerMoveUci/San, aiExplanation,
    // rankings, AND showAnswer so the user keeps seeing the previous move's
    // feedback (arrows, ranked moves, AI explanation) while the opponent
    // responds and right up until the user touches the board to make their
    // next move. The piece-drop / promotion / tap-to-move handlers below
    // flip showAnswer to false the moment the user plays again.
    setState(prev => ({
      ...prev,
      phase: 'continuation',
      currentFen: continuationFen,
      playerTurn,
      hint: null,
      hintLoading: false,
    }));
  }, [config]);

  // Ask the AI for a hint that nudges the player without revealing the answer.
  // Builds its own prompt so we don't reveal the engine best move to the model.
  const requestHint = useCallback(() => {
    if (!config) return;
    const cur = stateRef.current;
    if (cur.phase !== 'critical' && cur.phase !== 'continuation') return;
    if (!cur.playerTurn) return;
    if (cur.hint || cur.hintLoading) return;
    if (!settingsRef.current) return;

    const lastContMove = cur.continuationMoves[cur.continuationMoves.length - 1];
    const fen = cur.phase === 'critical'
      ? (cur.criticalFen || cur.currentFen)
      : cur.currentFen;
    void lastContMove; // not needed — currentFen is correct in continuation phase

    setState(prev => ({ ...prev, hintLoading: true, hint: null }));

    const langCode = (settingsRef.current as unknown as Record<string, unknown>)?.language as string | undefined;
    const ttsLang = SUPPORTED_LANGUAGES.find(l => l.code === langCode)?.ttsName;
    const language = ttsLang || 'English';
    const sideToMove = fen.split(' ')[1] === 'w' ? 'White' : 'Black';

    const langStyle = language === 'Hebrew'
      ? 'דבר כמו מאמן שחמט בעברית. שמות כלים: מלך, מלכה, צריח, רץ, פרש, חייל. אל תתרגם מאנגלית.'
      : language === 'Spanish'
        ? 'Habla como un entrenador de ajedrez en español, usando terminología natural (pieza colgada, clavada, horquilla, enfilada).'
        : 'Speak like a friendly chess coach.';

    const hintFacts = computeHintFacts(fen, language);

    const system = `You are a chess coach giving a TINY HINT (NOT the answer).
${langStyle}

Hard rules:
- DO NOT name any move. No "play X", no SAN, no UCI.
- Output ONE single short sentence — 12-18 words max. NO bullet points. NO line breaks.
- Mention ONE concrete thing to look at: a tactical motif (fork/pin/skewer/hanging/back rank), a key square, or a threat.
- Wrap any square references in brackets: [e5], [d4]. Use piece names, not algebraic notation.
- ANTI-HALLUCINATION: use ONLY pieces and squares from the VERIFIED FACTS below. NEVER invent a piece, color, or square that is not listed there. Copy piece names from the facts verbatim.
- Priority order when choosing what to mention: (1) check, if present; (2) YOUR hanging piece (defense first); (3) OPPONENT hanging piece (free capture); (4) WINNING EXCHANGE if listed — point at the target square and hint at a tactical sacrifice that wins material (do NOT name the move, but DO mention the target square in brackets like [f4] and the captured piece type); (5) general motif. Do NOT pick a lower-priority topic when a higher-priority one exists.
- If a WINNING EXCHANGE is listed, the hint MUST be about it — do NOT default to "look for activity" when concrete material is on the table.
- If no clear tactic exists in the verified facts, give a calm strategic hint about piece activity or king safety — do NOT invent threats or hanging pieces.
- No markdown. No move suggestions. No preamble like "here is a hint".`;

    const user = `Position (FEN): ${fen}
Side to move: ${sideToMove}
${hintFacts ? `\nVERIFIED FACTS (only mention pieces/squares from this list — do NOT invent anything):\n${hintFacts}\n` : ''}
Output exactly one short sentence (max 18 words) nudging the player.${language !== 'English' ? `\n\nIMPORTANT: Respond in ${language}.` : ''}`;

    sendWithFallback(settingsRef.current, system, [{ role: 'user', content: user }], 80)
      .then(text => setState(prev => {
        if (prev.phase !== 'critical' && prev.phase !== 'continuation') return prev;
        return { ...prev, hint: text, hintLoading: false };
      }))
      .catch(() => setState(prev => ({ ...prev, hintLoading: false })));
  }, [config]);

  const dismissHint = useCallback(() => {
    setState(prev => prev.hint || prev.hintLoading ? { ...prev, hint: null, hintLoading: false } : prev);
  }, []);

  return {
    state,
    advanceLeadup,
    stepBackLeadup,
    undoMistake,
    onSquareClick,
    onPieceDrop,
    completePromotion,
    cancelPromotion,
    retry,
    replayLeadup,
    revealWithExplanation,
    continueAfterScore,
    requestHint,
    dismissHint,
  };
  // Note: ranking data is in state.criticalRanking / state.continuationRanking / state.rankingLoading
}

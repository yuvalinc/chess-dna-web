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
      // Attempt move
      const fenBefore = chess.fen();
      let result;
      try {
        const piece = chess.get(cur.selectedSquare);
        const needsPromo = piece?.type === 'p' && (square[1] === '1' || square[1] === '8');
        result = chess.move({ from: cur.selectedSquare, to: square, promotion: needsPromo ? 'q' : undefined });
      } catch { result = null; }

      if (result) {
        const moveUci = result.from + result.to + (result.promotion ?? '');
        const isContinuation = cur.phase === 'continuation';
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
  const onPieceDrop = useCallback((from: string, to: string): boolean => {
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
      result = chess.move({ from: from as Square, to: to as Square, promotion: needsPromo ? 'q' : undefined });
    } catch { result = null; }

    if (!result) return false;

    const moveUci = result.from + result.to + (result.promotion ?? '');
    const isContinuation = cur.phase === 'continuation';
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
      ...(isContinuation ? { continuationMoves: [...prev.continuationMoves, { fenBefore, uci: moveUci, san: result!.san }] } : {}),
    }));
    if (isContinuation) console.log(`[TM CONT MOVE] Recorded continuation move (drop): ${result!.san} (${moveUci}) phase=${cur.phase}`);
    return true;
  }, [config]);

  // --- Score the player's move (fires after player moves in critical phase) ---
  useEffect(() => {
    if (!config) return;
    const cur = stateRef.current;

    // Only trigger when player just finished a move in critical phase
    if (cur.phase !== 'critical') return;
    if (cur.playerTurn || cur.evaluating) return;
    if (!cur.playerMoveUci) return;
    // Guard: position must have changed from critical
    if (cur.currentFen === cur.criticalFen) return;

    console.log('[TM] Scoring player move:', cur.playerMoveUci, 'critFen:', cur.criticalFen?.slice(0, 40));

    setState(prev => ({ ...prev, phase: 'evaluating', evaluating: true, error: null }));

    (async () => {
      try {
        const sf = StockfishClient.getInstance();
        await sf.ensureHealthy();

        const critMove = config.gameMoves[config.criticalIndex];
        const isPlayerWhite = config.playerColor === 'white';

        // evalBestCp: evaluation at the critical position from player's perspective
        let evalBestCp: number;
        if (critMove?.evalBefore?.scoreType === 'cp') {
          evalBestCp = isPlayerWhite ? critMove.evalBefore.score : -critMove.evalBefore.score;
        } else {
          const critEval = await sf.analyzePosition(cur.criticalFen, TM_ANALYSIS_DEPTH);
          evalBestCp = critEval.scoreType === 'mate'
            ? (critEval.score > 0 ? 10000 : -10000)
            : critEval.score;
        }

        // evalAfterCp: evaluation after player's move, from player's perspective
        // After player moves, it's opponent's turn → negate Stockfish output
        const chess = chessRef.current;
        const afterEval = await sf.analyzePosition(chess.fen(), TM_ANALYSIS_DEPTH);
        const evalAfterCp = afterEval.scoreType === 'mate'
          ? (afterEval.score > 0 ? -10000 : 10000)
          : -afterEval.score;

        let score = computeMoveScore(evalBestCp, evalAfterCp);

        // Playing the exact engine best move always scores 100 regardless of eval variance
        if (cur.playerMoveUci === config.bestMoveUci) {
          score = 100;
        }
        // Penalise repeating the exact same mistake
        else if (cur.playerMoveUci === config.originalMoveUci) {
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
          fenAfterCritical: cur.currentFen, // FEN after player's critical move
          criticalRanking: [],              // reset so ranking effect re-fires
          continuationRanking: [],
          rankingLoading: true,
          aiExplanationLoading: score < 100 && !!settingsRef.current,
          error: null,
        }));

        // Async AI explanation for imperfect moves
        if (score < 100 && settingsRef.current && critMove) {
          const cpDiff = Math.abs(evalBestCp - evalAfterCp);
          const langCode = (settingsRef.current as unknown as Record<string, unknown>)?.language as string | undefined;
          const ttsLang = SUPPORTED_LANGUAGES.find(l => l.code === langCode)?.ttsName;
          const posFacts = computePositionFacts(
            critMove.fenBefore ?? cur.criticalFen,
            config.bestMoveUci,
            cur.playerMoveUci,
            ttsLang,
          );
          const prompt = buildPromptRef.current(
            critMove.fenBefore ?? cur.criticalFen,
            cur.playerMoveSan ?? cur.playerMoveUci!,
            config.bestMoveSan || config.bestMoveUci,
            cpDiff,
            config.opponentRating,
            critMove.evalBefore?.pv,
            critMove.tacticalMotifs,
            posFacts || undefined,
            ttsLang,
          );
          sendWithFallback(settingsRef.current!, prompt.system, [{ role: 'user', content: prompt.user }], 200)
            .then(text => setState(prev => prev.phase === 'scored' ? { ...prev, aiExplanation: text, aiExplanationLoading: false } : prev))
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
  }, [state.phase, state.playerTurn, state.playerMoveUci, state.currentFen, config]);

  // --- Opponent moves in continuation phase ---
  useEffect(() => {
    if (!config) return;
    const cur = stateRef.current;
    if (cur.phase !== 'continuation' || cur.playerTurn || cur.opponentThinking) return;

    const chess = chessRef.current;
    const turn = chess.turn() === 'w' ? 'white' : 'black';
    if (turn === config.playerColor) {
      setState(prev => ({ ...prev, playerTurn: true }));
      return;
    }

    setState(prev => ({ ...prev, opponentThinking: true }));

    (async () => {
      try {
        const sf = StockfishClient.getInstance();
        await sf.ensureHealthy();
        await sf.setOption('Skill Level', ratingToSkillLevel(config.opponentRating));
        const result = await sf.analyzePosition(chess.fen(), 10);
        if (result.bestMove && result.bestMove.length >= 4) {
          const from = result.bestMove.slice(0, 2) as Square;
          const to = result.bestMove.slice(2, 4) as Square;
          const promo = result.bestMove.length > 4 ? result.bestMove[4] as 'q' | 'r' | 'b' | 'n' : undefined;
          const moveResult = chess.move({ from, to, promotion: promo });
          if (moveResult) {
            const movesLeft = stateRef.current.continuationMovesLeft - 1;
            if (movesLeft <= 0 || chess.isGameOver()) {
              setState(prev => ({ ...prev, phase: 'complete', currentFen: chess.fen(), opponentThinking: false, lastMoveFrom: from, lastMoveTo: to }));
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

  // --- Critical position ranking (fires once when entering scored phase) ---
  useEffect(() => {
    if (!config) return;
    const cur = stateRef.current;
    if (cur.phase !== 'scored') return;
    if (!cur.criticalFen) return;
    if (cur.criticalRanking.length > 0) return; // already computed

    (async () => {
      try {
        const sf = StockfishClient.getInstance();
        await sf.ensureHealthy();
        const lines = await sf.analyzePositionMultiPV(cur.criticalFen, 14, 5);
        const ranking = multiPVToRankedMoves(lines, cur.criticalFen, cur.playerMoveUci, config.bestMoveUci);
        setState(prev => prev.phase === 'scored' ? { ...prev, criticalRanking: ranking, rankingLoading: prev.continuationRanking.length === 0 ? true : false } : prev);
      } catch (err) {
        console.warn('[TM] Critical ranking failed:', err);
        setState(prev => ({ ...prev, rankingLoading: false }));
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase, state.criticalFen, config]);

  // --- Continuation rankings (fires once when entering complete phase) ---
  // For each continuation move the user played, compute top-5 alternatives
  useEffect(() => {
    if (!config) return;
    const cur = stateRef.current;
    if (cur.phase !== 'complete') return;
    if (cur.continuationRankings.length > 0) return; // already computed
    if (cur.continuationMoves.length === 0) {
      console.log('[TM CONT RANK] No continuation moves recorded — skipping');
      setState(prev => ({ ...prev, rankingLoading: false }));
      return;
    }

    console.log(`[TM CONT RANK] Computing rankings for ${cur.continuationMoves.length} continuation moves:`, cur.continuationMoves.map(m => m.san));

    (async () => {
      try {
        const sf = StockfishClient.getInstance();
        await sf.ensureHealthy();

        const rankings: RankedMove[][] = [];
        for (const cm of cur.continuationMoves) {
          console.log(`[TM CONT RANK] Analyzing position for user move: ${cm.san} (${cm.uci}) from FEN: ${cm.fenBefore.slice(0, 40)}...`);
          const lines = await sf.analyzePositionMultiPV(cm.fenBefore, 14, 5);
          const ranking = multiPVToRankedMoves(lines, cm.fenBefore, cm.uci);
          console.log(`[TM CONT RANK] Got ${ranking.length} alternatives for ${cm.san}:`, ranking.map(r => `${r.san}(${r.score})`).join(', '));
          rankings.push(ranking);
        }

        setState(prev => prev.phase === 'complete' ? {
          ...prev,
          continuationRankings: rankings,
          rankingLoading: false,
        } : prev);
      } catch (err) {
        console.warn('[TM] Continuation ranking failed:', err);
        setState(prev => ({ ...prev, rankingLoading: false }));
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase, state.fenAfterCritical, config]);

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
      sendWithFallback(settingsRef.current!, prompt.system, [{ role: 'user', content: prompt.user }], 200)
        .then(text => setState(prev => prev.phase === 'scored' ? { ...prev, aiExplanation: text, aiExplanationLoading: false } : prev))
        .catch(() => setState(prev => ({ ...prev, aiExplanationLoading: false })));
    }
  }, [config]);

  const continueAfterScore = useCallback(() => {
    if (!config) return;
    const cur = stateRef.current;

    // If we revealed the answer, the board is still at the critical FEN (before bestMove).
    // Advance chessRef to fenAfterCritical so continuation plays from the correct position.
    let continuationFen = cur.currentFen;
    if (cur.showAnswer && cur.fenAfterCritical) {
      try {
        chessRef.current = new Chess(cur.fenAfterCritical);
        continuationFen = cur.fenAfterCritical;
      } catch { /* keep existing board */ }
    }

    const playerTurn = chessRef.current.turn() === (config.playerColor === 'white' ? 'w' : 'b');

    setState(prev => ({
      ...prev,
      phase: 'continuation',
      currentFen: continuationFen,
      playerTurn,
      showAnswer: false,
      playerMoveUci: null,
      playerMoveSan: null,
      aiExplanation: null,
      aiExplanationLoading: false,
    }));
  }, [config]);

  return {
    state,
    advanceLeadup,
    undoMistake,
    onSquareClick,
    onPieceDrop,
    retry,
    replayLeadup,
    revealWithExplanation,
    continueAfterScore,
  };
  // Note: ranking data is in state.criticalRanking / state.continuationRanking / state.rankingLoading
}

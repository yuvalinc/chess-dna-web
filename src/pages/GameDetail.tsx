import { useState, useEffect, useCallback, useMemo, useRef, useDeferredValue } from 'react';
import { useParams, useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import ThemedChessboard from '@/components/ThemedChessboard';
import EvalBar from '@/components/EvalBar';
import MoveList from '@/components/MoveList';
import { useChessData } from '@/contexts/ChessDataContext';
import { useTheme } from '@/components/ThemeContext';
import { runAnalysisPipeline } from '@/engine/analysis-pipeline';
import { useResponsiveBoardSize } from '@/hooks/useResponsiveBoardSize';
import { detectGamePatterns, getThemeDescription } from '@/patterns/pattern-engine';
import { sendWithFallbackStream, hasAnyProvider } from '@/ai/ai-router';
import { getExplanation as getCachedExplanation, setExplanation as setCachedExplanation } from '@/storage/explanation-cache';
import { useActivePrompt } from '@/hooks/useActivePrompt';
import ExplanationText from '@/components/ExplanationText';
import ThemeChip from '@/components/ThemeChip';
import { extractThemes, MOTIF_TO_THEME, isValidThemeSlug } from '@shared/theme-catalog';
import { playChessSound, type SoundType } from '@shared/utils/chess-sounds';
import ShareComposer from '@/components/share/ShareComposer';
import { useTutorial } from '@/contexts/TutorialContext';
import type { MoveAnalysis } from '@shared/types/analysis';
import { DataAttribution } from '@/components/PlatformBadge';
import PlayerAvatar from '@/components/PlayerAvatar';
import { useT } from '@/i18n/index';
import type { TranslationKey } from '@/i18n/locales/en';
import { getTerminationReason, type TerminationReason } from '@shared/utils/chess-utils';
import { detectTrapsInGame } from '@/patterns/trap-detector';
import { OPENING_TRAPS_BY_ID } from '@shared/data/opening-traps';
import { getBotReply, type BotMode } from '@/engine/bot-mover';
import StockfishClient from '@/engine/stockfish-client';
import { classifyMove, calcWinChanceLoss, getQualityColor } from '@/engine/eval-classifier';
import type { MoveQuality } from '@shared/types/analysis';
import { Chess } from 'chess.js';
import type { Square } from 'chess.js';

// Stable empty-arrows reference: avoids handing react-chessboard a fresh
// `[]` on every render (which would trigger arrow re-diffs).
const EMPTY_ARROWS: [Square, Square, string][] = [];

const TERMINATION_I18N_KEY: Record<TerminationReason, TranslationKey> = {
  checkmate: 'game_term_checkmate',
  stalemate: 'game_term_stalemate',
  time: 'game_term_time',
  resignation: 'game_term_resignation',
  agreement: 'game_term_agreement',
  repetition: 'game_term_repetition',
  insufficient: 'game_term_insufficient',
  '50-move': 'game_term_50move',
  abandoned: 'game_term_abandoned',
  rules: 'game_term_rules',
};

export default function GameDetail() {
  const { gameId } = useParams<{ gameId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const initialMoveIndex = (location.state as { moveIndex?: number } | null)?.moveIndex;

  const { settings } = useTheme();
  const { t, ttsLanguageName } = useT();
  const { buildPrompt } = useActivePrompt();

  const { allGames, gamesLoading: gameLoading, allAnalyses, analysesLoading: analysisLoading, profile } = useChessData();
  // Tutorial integration: when the GameDetail tutorial step is active we
  // (a) force the insightTab to 'moments' so the user sees the moment cards,
  // (b) auto-jump to the demo move so the AI explanation is on screen,
  // (c) tag the matching KeyMomentCard with a data-tutorial-target.
  const { step: tutorialStep, demoMoveHalfIndex } = useTutorial();
  const inGameDetailTutorial = tutorialStep === 3;
  const game = useMemo(() => allGames.find(g => g.id === gameId) ?? null, [allGames, gameId]);
  const analysis = useMemo(() => allAnalyses.find(a => a.gameId === gameId) ?? null, [allAnalyses, gameId]);

  // Default to the starting position (-1 = no moves played). Only respect
  // an explicit `initialMoveIndex` (e.g. when arriving from Time Machine
  // with a specific move to inspect).
  const [currentMoveIndex, setCurrentMoveIndex] = useState(initialMoveIndex ?? -1);

  // Deferred copy for non-critical children (MoveList, EvalChart). The board
  // uses `currentMoveIndex` so stepping feels instant; the list catches up
  // on the next idle commit, preventing scrub flood.
  const deferredMoveIndex = useDeferredValue(currentMoveIndex);

  // Deep-link support: arriving with `?move=<moveNumber>` (1-based, the
  // value shown in `#N` chips on the Recent Games row) jumps straight to
  // that move in the analysis. We resolve the corresponding halfMoveIndex
  // by matching on the player's color so the link "feels" right whether
  // the user played white or black.
  const [searchParams] = useSearchParams();
  useEffect(() => {
    if (!analysis) return;
    const raw = searchParams.get('move');
    if (!raw) return;
    const targetMoveNumber = parseInt(raw, 10);
    if (Number.isNaN(targetMoveNumber)) return;
    const playerColor = analysis.summary?.playerColor;
    const idx = analysis.moves.findIndex(
      (m) => m.color === playerColor && m.moveNumber === targetMoveNumber,
    );
    if (idx >= 0) setCurrentMoveIndex(idx);
  }, [analysis, searchParams]);
  const [showBoard, setShowBoard] = useState(true);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareMove, setShareMove] = useState<MoveAnalysis | null>(null);
  const { containerRef, boardSize } = useResponsiveBoardSize(700);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!analysis) return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        setCurrentMoveIndex((prev) => Math.min(prev + 1, analysis.moves.length - 1));
        if (!showBoard) setShowBoard(true);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        setCurrentMoveIndex((prev) => Math.max(prev - 1, -1));
      } else if (e.key === 'Home') {
        e.preventDefault();
        setCurrentMoveIndex(-1);
      } else if (e.key === 'End') {
        e.preventDefault();
        setCurrentMoveIndex(analysis.moves.length - 1);
      }
    },
    [analysis, showBoard],
  );

  // Scroll to top when navigating to a new game
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [gameId]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const gamePatterns = useMemo(() => {
    if (!analysis || !game) return [];
    return detectGamePatterns(analysis.moves, game.player.color, game.opening?.name ?? '');
  }, [analysis, game]);

  const gameTraps = useMemo(() => {
    if (!game) return [];
    return detectTrapsInGame(game);
  }, [game]);

  // SAN history of the original game — used by play mode to (a) tell the
  // opponent bot what's "on-script" so it can replay the real opponent's
  // move, and (b) reconstruct the move list up to the anchor position.
  const originalSan = useMemo<string[]>(() => {
    if (!game?.pgn) return [];
    try {
      const c = new Chess();
      c.loadPgn(game.pgn);
      return c.history();
    } catch {
      return [];
    }
  }, [game?.pgn]);

  const keyMoments = useMemo(() => {
    if (!analysis || !game) return [];
    const playerMoves = analysis.moves.filter(m => m.color === game.player.color);

    const mistakes = playerMoves
      .filter(m => m.cpLoss > 30 && (m.quality === 'inaccuracy' || m.quality === 'mistake' || m.quality === 'miss' || m.quality === 'blunder'))
      .sort((a, b) => b.cpLoss - a.cpLoss)
      .map(m => ({ ...m, momentType: 'mistake' as const }));

    const brilliants = playerMoves
      .filter(m => m.quality === 'brilliant' || m.quality === 'great')
      .map(m => ({ ...m, momentType: 'brilliant' as const }));

    return [...mistakes, ...brilliants].sort((a, b) => a.halfMoveIndex - b.halfMoveIndex);
  }, [analysis, game]);

  const hasKeyMoments = keyMoments.length > 0;
  const hasGameTraps = gameTraps.length > 0;
  const hasPatterns = gamePatterns.length > 0 || hasGameTraps;
  // Default tab: Patterns when available — no specific key moment is
  // selected on initial load, so the broader pattern view is the more
  // informative landing surface. The deep-link effect below overrides
  // to Moments when arriving via `?move=N` on a key-moment move.
  const [insightTab, setInsightTab] = useState<'stats' | 'moments' | 'patterns'>(
    hasPatterns ? 'patterns' : hasKeyMoments ? 'moments' : 'stats',
  );
  // Track whether we've auto-picked a default tab once analysis loads.
  // Without this, the initial state above would lock to 'stats' (because
  // analysis is still loading on first render and hasPatterns=false), and
  // never re-evaluate when patterns/moments arrive.
  const initialTabPickedRef = useRef(false);
  useEffect(() => {
    if (initialTabPickedRef.current) return;
    if (!hasPatterns && !hasKeyMoments) return; // wait for data
    initialTabPickedRef.current = true;
    setInsightTab(hasPatterns ? 'patterns' : 'moments');
  }, [hasPatterns, hasKeyMoments]);
  const [selectedPatternIdx, setSelectedPatternIdx] = useState(0);
  const [selectedTrapId, setSelectedTrapId] = useState<string | null>(null);

  // ── Play mode (drag-to-play vs. bot) ──
  //
  // When the user drags a piece on the analysis board, we enter play mode:
  // the board switches from showing the original game's position to a
  // mutable Chess() instance anchored at the move the user was viewing.
  // The bot replies after each user move. Any action that changes the
  // currently-viewed position (move list click, prev/next nav, deep-link)
  // exits play mode and snaps the board back to the original game.
  const [playFen, setPlayFen] = useState<string | null>(null);
  const [playSan, setPlaySan] = useState<string[]>([]);
  const [playAnchorIdx, setPlayAnchorIdx] = useState<number | null>(null);
  const [botMode, setBotMode] = useState<BotMode>('engine');
  const [isBotThinking, setIsBotThinking] = useState(false);
  // Whether to show move-quality color + best-move suggestion after each
  // user move. Persisted per-session in localStorage.
  const [showFeedback, setShowFeedbackState] = useState<boolean>(() => {
    try { return (typeof window !== 'undefined' ? localStorage.getItem('chess-dna-play-feedback') : null) !== 'off'; } catch { return true; }
  });
  const setShowFeedback = useCallback((v: boolean) => {
    setShowFeedbackState(v);
    try { localStorage.setItem('chess-dna-play-feedback', v ? 'on' : 'off'); } catch { /* noop */ }
  }, []);
  // Last user move's quality + suggested-best. Set by an async Stockfish
  // eval after each user drop. Drives the destination-square color and the
  // small text under the board.
  const [lastUserMove, setLastUserMove] = useState<null | {
    from: string;
    to: string;
    san: string;
    quality: MoveQuality;
    bestSan: string;
    cpLoss: number;
  }>(null);
  const playChessRef = useRef<Chess | null>(null);
  // Bumped on every play-mode reset so stale async bot replies (still
  // resolving after the user navigated away) can be ignored.
  const playSessionRef = useRef(0);

  const exitPlayMode = useCallback(() => {
    playSessionRef.current++;
    playChessRef.current = null;
    setPlayFen(null);
    setPlaySan([]);
    setPlayAnchorIdx(null);
    setIsBotThinking(false);
    setLastUserMove(null);
  }, []);

  // Enter play mode anchored at the opening (move -1 = starting position).
  // Used by the "Practice this trap" CTA so the user can drill the trap
  // line from move 1 against the bot. When the user plays black, we
  // immediately play white's opening move from the original game so the
  // first turn is always the user's.
  const practiceFromStart = useCallback(() => {
    const startFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    playSessionRef.current++;
    const chess = new Chess(startFen);
    let initialSan: string[] = [];
    if (game?.player.color === 'black') {
      const firstMove = originalSan[0] || 'e4';
      try {
        const m = chess.move(firstMove);
        if (m) {
          initialSan = [firstMove];
          try {
            playChessSound(pickMoveSound(
              m.san,
              {
                isCapture: m.flags.includes('c') || m.flags.includes('e'),
                isCastling: m.flags.includes('k') || m.flags.includes('q'),
              },
              false,
            ));
          } catch { /* audio may be locked pre-gesture */ }
        }
      } catch { /* fall through with no auto-played move */ }
    }
    playChessRef.current = chess;
    setCurrentMoveIndex(-1);
    setPlayFen(chess.fen());
    setPlaySan(initialSan);
    setPlayAnchorIdx(-1);
    setIsBotThinking(false);
    setLastUserMove(null);
  }, [game, originalSan]);

  // When in play mode with a selected trap, compute the next expected move
  // from the trap's first signature variant — as long as the user is still
  // following the script. Returns null once the user has deviated or the
  // signature is exhausted. Used to highlight from/to squares on the board.
  const trapHint = useMemo(() => {
    if (!playFen || !selectedTrapId) return null;
    const def = OPENING_TRAPS_BY_ID.get(selectedTrapId);
    if (!def) return null;
    const sig = def.signatures[0];
    if (!sig) return null;
    const onScript = playSan.every((s, i) => sig[i] === s);
    if (!onScript) return null;
    const nextSan = sig[playSan.length];
    if (!nextSan) return null;
    // Only hint when it's the user's turn to move.
    try {
      const c = new Chess(playFen);
      const userTurnChar = game?.player.color === 'white' ? 'w' : 'b';
      if (c.turn() !== userTurnChar) return null;
      const m = c.move(nextSan);
      if (!m) return null;
      return { from: m.from, to: m.to, san: nextSan };
    } catch {
      return null;
    }
  }, [playFen, selectedTrapId, playSan, game]);

  // Reset play mode when the user navigates to a different move via the
  // move list / nav arrows / deep-link / pattern click. Stays put when the
  // user is mid-game and only the play state changes.
  useEffect(() => {
    if (playAnchorIdx === null) return;
    if (currentMoveIndex !== playAnchorIdx) exitPlayMode();
  }, [currentMoveIndex, playAnchorIdx, exitPlayMode]);

  // ── Piece-drop handler: enters play mode on first drop, applies the
  // user's move, then triggers the bot reply. Returns true so the
  // chessboard accepts the move; false rejects the drag.
  // Practice can only START at a position where it's the user's turn —
  // we never auto-advance the opponent's move silently, because that hides
  // the fact that the board state has changed and led to "phantom piece"
  // confusion in earlier iterations.
  const handlePieceDrop = useCallback(
    (from: string, to: string): boolean => {
      if (!game) return false;
      if (isBotThinking) return false;

      // Anchor FEN: where we resume from on first drop. After that, we use
      // the running Chess instance in playChessRef.
      const anchorFen = (currentMoveIndex >= 0 && analysis)
        ? analysis.moves[currentMoveIndex].fenAfter
        : 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

      const userTurnChar = game.player.color === 'white' ? 'w' : 'b';
      let chess = playChessRef.current;
      if (!chess) {
        chess = new Chess(anchorFen);
        playChessRef.current = chess;
      }

      // Reject the drag if it isn't the user's turn at this position. The
      // user should navigate to one of their own moves in the move list
      // first. isDraggablePiece below also enforces this so the cursor
      // doesn't even invite the drag.
      if (chess.turn() !== userTurnChar) return false;

      const fenBefore = chess.fen();

      // Always pass promotion='q' — chess.js ignores it for non-promotion
      // moves. For promotion moves we'd need a separate picker; for v1 we
      // auto-queen.
      let userMove;
      try {
        userMove = chess.move({ from, to, promotion: 'q' });
      } catch {
        return false;
      }
      if (!userMove) return false;

      const newSan = [...playSan, userMove.san];
      setPlaySan(newSan);
      setPlayFen(chess.fen());
      if (playAnchorIdx === null) setPlayAnchorIdx(currentMoveIndex);

      try {
        playChessSound(pickMoveSound(
          userMove.san,
          {
            isCapture: userMove.flags.includes('c') || userMove.flags.includes('e'),
            isCastling: userMove.flags.includes('k') || userMove.flags.includes('q'),
          },
          true,
        ));
      } catch { /* audio may be locked pre-gesture */ }
      // Clear the previous feedback overlay so we don't show stale colors
      // while the new eval is in flight.
      setLastUserMove(null);

      // Bump play session — any in-flight feedback eval or bot reply from a
      // prior move (or a prior play session) will see playSessionRef.current
      // !== session and bail out.
      const session = ++playSessionRef.current;

      // Kick off move-quality eval in parallel with the bot reply, but only
      // when the user has feedback enabled. Two depth-12 Stockfish calls
      // (before + after) classify the user's move; the bot reply call
      // proceeds independently.
      if (showFeedback) {
        (async () => {
          try {
            const sf = StockfishClient.getInstance();
            await sf.ensureHealthy();
            const evalBefore = await sf.analyzePosition(fenBefore, 12);
            // Bail out if the user has exited play mode or moved on.
            if (playSessionRef.current !== session) return;
            const evalAfter = await sf.analyzePosition(chess!.fen(), 12);
            if (playSessionRef.current !== session) return;
            const toCp = (sc: { scoreType: 'cp' | 'mate'; score: number }) =>
              sc.scoreType === 'mate' ? (sc.score > 0 ? 10000 : -10000) : sc.score;
            const evalBeforeCp = toCp(evalBefore);
            // evalAfter is from opponent's perspective (now their turn) —
            // flip the sign to express it from the user's perspective.
            const evalAfterFromUser = -toCp(evalAfter);
            const cpLoss = Math.max(0, evalBeforeCp - evalAfterFromUser);
            const winChanceLoss = calcWinChanceLoss(evalBeforeCp, evalAfterFromUser);
            const quality = classifyMove({
              cpLoss,
              winChanceLoss,
              evalBeforeCp,
              evalAfterCp: evalAfterFromUser,
              isSacrifice: false,
              legalMoveCount: 0,
              isBookMove: false,
              isMissedOpportunity: false,
            });
            setLastUserMove({
              from,
              to,
              san: userMove!.san,
              quality,
              bestSan: evalBefore.bestMoveSan || evalBefore.bestMove,
              cpLoss,
            });
          } catch (err) {
            console.warn('[GameDetail] feedback eval failed', err);
          }
        })();
      }

      if (chess.isGameOver()) return true;

      // Trigger bot reply asynchronously (uses the shared `session` from above).
      const prefixLen = currentMoveIndex + 1;
      const playedSoFar = [...originalSan.slice(0, prefixLen), ...newSan];
      const opponentElo = game.opponent.rating || 1500;

      setIsBotThinking(true);
      getBotReply({
        fen: chess!.fen(),
        mode: botMode,
        playedSan: playedSoFar,
        originalSan,
        opponentElo,
      })
        .then((reply) => {
          // Ignore late replies from a prior play session.
          if (playSessionRef.current !== session) return;
          if (!reply) return;
          const botMove = chess!.move({ from: reply.from, to: reply.to, promotion: reply.promotion ?? 'q' });
          if (!botMove) return;
          setPlayFen(chess!.fen());
          setPlaySan((prev) => [...prev, botMove.san]);
          try {
            playChessSound(pickMoveSound(
              botMove.san,
              {
                isCapture: botMove.flags.includes('c') || botMove.flags.includes('e'),
                isCastling: botMove.flags.includes('k') || botMove.flags.includes('q'),
              },
              false,
            ));
          } catch { /* audio may be locked pre-gesture */ }
        })
        .catch((err) => {
          console.warn('[GameDetail] bot reply failed', err);
        })
        .finally(() => {
          if (playSessionRef.current === session) setIsBotThinking(false);
        });

      return true;
    },
    [analysis, game, currentMoveIndex, isBotThinking, playSan, playAnchorIdx, botMode, originalSan, showFeedback],
  );

  const [, _setSelectedMomentIdx] = useState(0);

  // When the user arrives via a `?move=N` deep-link from the Recent Games
  // takeaway, also auto-focus the right insight surface:
  //  - if the move is a Key Moment → switch to the Moments tab
  //  - else if it's part of a detected Pattern → switch to Patterns and
  //    select the pattern containing that move
  // (Moves tab/list always reflects `currentMoveIndex` set by the earlier
  // effect, so the move list is in sync automatically.)
  useEffect(() => {
    if (!analysis) return;
    const raw = searchParams.get('move');
    if (!raw) return;
    const targetMoveNumber = parseInt(raw, 10);
    if (Number.isNaN(targetMoveNumber)) return;
    const playerColor = analysis.summary?.playerColor;
    const targetMove = analysis.moves.find(
      (m) => m.color === playerColor && m.moveNumber === targetMoveNumber,
    );
    if (!targetMove) return;
    const targetHalf = targetMove.halfMoveIndex;
    const isKeyMoment = keyMoments.some((m) => m.halfMoveIndex === targetHalf);
    if (isKeyMoment) {
      setInsightTab('moments');
      return;
    }
    const patternIdx = gamePatterns.findIndex((p) =>
      p.moves.some((mv) => mv.moveIndex === targetHalf),
    );
    if (patternIdx >= 0) {
      setInsightTab('patterns');
      setSelectedPatternIdx(patternIdx);
    }
  }, [analysis, searchParams, keyMoments, gamePatterns]);

  // Deep-link from Takeaways trap card: `?trap=<id>` auto-selects the
  // matching trap card in the Patterns tab. Runs after gameTraps is computed.
  const trapAutoSelectedRef = useRef<string | null>(null);
  useEffect(() => {
    const trapParam = searchParams.get('trap');
    if (!trapParam) return;
    if (trapAutoSelectedRef.current === trapParam) return; // already handled
    if (!gameTraps.some((t) => t.trapId === trapParam)) return; // not in this game
    trapAutoSelectedRef.current = trapParam;
    setInsightTab('patterns');
    setSelectedTrapId(trapParam);
    setSelectedPatternIdx(-1);
  }, [searchParams, gameTraps]);

  // Track last selected move index per tab for state restoration
  const lastMomentMoveRef = useRef<number>(-1);
  const lastPatternMoveRef = useRef<number>(-1);

  // Animation state — MUST be before early returns to keep hook count stable
  const [animatingFen, setAnimatingFen] = useState<string | null>(null);
  const [highlightedSquare, setHighlightedSquare] = useState<string | null>(null);

  // AI explanation cache (moveIndex → text)
  const explanationCache = useRef(new Map<number, string>());
  const [aiExplanation, setAiExplanation] = useState<string | null>(null);
  const [aiExplanationLoading, setAiExplanationLoading] = useState(false);

  // Track viewport height so we can size the board to fit on one screen in
  // focus mode (board + small explanation + dock + focus toggle, no scroll).
  const [viewportHeight, setViewportHeight] = useState<number>(
    typeof window !== 'undefined' ? window.innerHeight : 800,
  );
  useEffect(() => {
    const onResize = () => setViewportHeight(window.innerHeight);
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, []);

  // Measure the actual rendered height of the fixed bottom dock (insight
  // tabs + chip gallery + move-list nav row). The dock content varies
  // (chip cards have multi-line titles, etc.), so a hard-coded estimate
  // misjudges the safe area and the explanation panel sneaks behind it.
  // Use offsetHeight (border-box) — `contentRect` excludes padding+border
  // and was undercounting the dock by ~21px, leaving the panel partially
  // covered. A tiny 8px buffer is enough; the previous 24px buffer was
  // leaving the AI explanation with almost no readable height on small
  // viewports.
  const [dockHeight, setDockHeight] = useState(220);
  const dockObserverRef = useRef<ResizeObserver | null>(null);
  const dockRef = useCallback((el: HTMLDivElement | null) => {
    dockObserverRef.current?.disconnect();
    dockObserverRef.current = null;
    if (!el) return;
    const measure = () => setDockHeight(el.offsetHeight + 8);
    measure();
    const obs = new ResizeObserver(measure);
    obs.observe(el);
    dockObserverRef.current = obs;
  }, []);

  // Derived values needed by hooks below (safe even when analysis is null)
  const currentMove: MoveAnalysis | undefined =
    currentMoveIndex >= 0 && analysis
      ? analysis.moves[currentMoveIndex]
      : undefined;

  // Pick a SoundType for a move from its SAN + analysis flags. Purely
  // physical — what kind of move was it (castle / capture / regular)? Side
  // (user vs opponent) just picks the pitch. Check / checkmate are NOT
  // surfaced as special sounds here: navigation is replaying past moves and
  // a "check fanfare" on every check feels like a reward / accuracy cue,
  // which we explicitly don't want in the analysis view.
  const pickMoveSound = useCallback(
    (san: string, flags: { isCapture?: boolean; isCastling?: boolean }, isUserMove: boolean): SoundType => {
      if (flags.isCastling || /^O-O/.test(san)) return 'castle';
      if (flags.isCapture || /x/.test(san)) return 'capture';
      return isUserMove ? 'move' : 'move-opponent';
    },
    [],
  );

  // Play a piece-move sound whenever the scrubbed move changes. The variant
  // (capture / castle / check / move / move-opponent) is derived from the
  // move's flags, and user vs opponent is determined by comparing the
  // move's color to the analyzed player's color — so playing as Black still
  // produces "move" (your own piece) on Black's moves, not "move-opponent".
  const lastSoundedIndex = useRef<number | null>(null);
  useEffect(() => {
    if (currentMoveIndex < 0 || !currentMove) {
      lastSoundedIndex.current = null;
      return;
    }
    if (lastSoundedIndex.current === currentMoveIndex) return;
    lastSoundedIndex.current = currentMoveIndex;
    const playerColor = analysis?.summary?.playerColor;
    const isUserMove = playerColor ? currentMove.color === playerColor : true;
    const sound = pickMoveSound(
      currentMove.moveSan || '',
      {
        isCapture: currentMove.isCapture,
        isCastling: currentMove.isCastling,
      },
      isUserMove,
    );
    try {
      playChessSound(sound);
    } catch {
      // Audio context may be locked before first user gesture — silently ignore.
    }
  }, [currentMoveIndex, currentMove, analysis, pickMoveSound]);

  // No-op tab handler. Previously this played a "preview" sound for the
  // best move whenever the user opened the Best Move tab — but that sound
  // (especially when the best move was a check) read as an accuracy reward,
  // making the user feel the app was congratulating them for selecting the
  // best alternative. The tab is purely informational; no audio cue belongs
  // here. Kept as a stable function reference so the existing
  // `onTabChange={...}` props don't need to be touched.
  const handleExplanationTabChange = useCallback(
    (_activeTab: 0 | 1) => { void _activeTab; },
    [],
  );

  // All hooks must be BEFORE early returns to avoid React error #300

  useEffect(() => {
    if (insightTab === 'moments' && !hasKeyMoments) {
      setInsightTab(hasPatterns ? 'patterns' : 'stats');
    } else if (insightTab === 'patterns' && !hasPatterns) {
      setInsightTab(hasKeyMoments ? 'moments' : 'stats');
    }
  }, [hasKeyMoments, hasPatterns, insightTab]);

  // When the tutorial lands on this page, switch to the Moments tab and
  // jump the board to the demo move so the user sees the spotlight target
  // immediately. Only fires while the GameDetail tutorial step is active.
  useEffect(() => {
    if (!inGameDetailTutorial) return;
    if (hasKeyMoments) setInsightTab('moments');
    if (typeof demoMoveHalfIndex === 'number' && demoMoveHalfIndex >= 0) {
      setCurrentMoveIndex(demoMoveHalfIndex);
    }
  }, [inGameDetailTutorial, hasKeyMoments, demoMoveHalfIndex]);

  const jumpToMoveWithAnimation = useCallback((moveIndex: number) => {
    if (!analysis) return;
    const move = analysis.moves[moveIndex];
    if (move?.fenBefore) {
      setAnimatingFen(move.fenBefore);
      setCurrentMoveIndex(moveIndex);
      setTimeout(() => setAnimatingFen(null), 100);
    } else {
      setCurrentMoveIndex(moveIndex);
    }
    setShowBoard(true);
    setHighlightedSquare(null);
  }, [analysis]);

  // Check if current move is a notable move (key moment or pattern move)
  const isNotableMove = useMemo(() => {
    if (!currentMove || !game) return false;
    if (currentMove.color !== game.player.color) return false;
    if (currentMove.cpLoss < 50) return false;
    return true;
  }, [currentMove, game]);

  // Check if the current move belongs to the active insight tab
  const isMoveInActiveTab = useMemo(() => {
    if (insightTab === 'stats') return false;
    if (insightTab === 'moments') {
      return keyMoments.some(m => m.halfMoveIndex === currentMoveIndex);
    }
    if (insightTab === 'patterns') {
      return gamePatterns.some(p => p.moves.some(m => m.moveIndex === currentMoveIndex));
    }
    return false;
  }, [insightTab, currentMoveIndex, keyMoments, gamePatterns]);

  // Compact single-screen layout — board + explanation panel + fixed dock,
  // with the bottom nav hidden via the body-level data-focus-mode attribute.
  // Always-on; the AI explanation panel scrolls internally if its content
  // overflows the available height.
  useEffect(() => {
    document.body.setAttribute('data-focus-mode', 'true');
    return () => document.body.removeAttribute('data-focus-mode');
  }, []);

  // Auto-generate AI explanation for notable moves — only when move is in the active tab.
  // When the current move is NOT a notable player move (e.g. opponent's reply,
  // or a quiet player move outside the active tab), clear any stale text so
  // we never display an explanation that talks about a different move.
  useEffect(() => {
    if (!isMoveInActiveTab || !isNotableMove || !currentMove || !analysis || !game || !settings) {
      setAiExplanation(null);
      setAiExplanationLoading(false);
      return;
    }
    const idx = currentMoveIndex;

    // Check in-memory cache first (intra-session) — synchronous, no debounce.
    const cached = explanationCache.current.get(idx);
    if (cached) {
      setAiExplanation(cached);
      setAiExplanationLoading(false);
      return;
    }

    // Check persistent localStorage cache (survives reload — avoids re-billing
    // when the user revisits a previously-explained move). Also synchronous.
    if (gameId) {
      const persisted = getCachedExplanation(gameId, idx);
      if (persisted) {
        explanationCache.current.set(idx, persisted);
        setAiExplanation(persisted);
        setAiExplanationLoading(false);
        return;
      }
    }

    // Check if AI is available
    if (!hasAnyProvider(settings)) {
      setAiExplanation(null);
      setAiExplanationLoading(false);
      return;
    }

    setAiExplanation(null);
    setAiExplanationLoading(true);

    // Compute position facts for accurate explanations
    let positionFacts: string | undefined;
    if (currentMove.fenBefore && currentMove.bestMoveUci) {
      try {
        const PNAMES: Record<string, Record<string, string>> = {
          en: { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' },
          he: { p: 'חייל', n: 'פרש', b: 'רץ', r: 'צריח', q: 'מלכה', k: 'מלך' },
          es: { p: 'peón', n: 'caballo', b: 'alfil', r: 'torre', q: 'dama', k: 'rey' },
        };
        const langKey = ttsLanguageName === 'Hebrew' ? 'he' : ttsLanguageName === 'Spanish' ? 'es' : 'en';
        const PN = PNAMES[langKey] ?? PNAMES.en;
        const facts: string[] = [];
        const chess = new Chess(currentMove.fenBefore);
        const describeMv = (uci: string, lbl: string) => {
          const from = uci.slice(0, 2) as Square, to = uci.slice(2, 4) as Square;
          const promo = uci.length > 4 ? uci[4] as 'q'|'r'|'b'|'n' : undefined;
          const piece = chess.get(from);
          if (!piece) return;
          const name = PN[piece.type] ?? piece.type;
          const cap = chess.get(to);
          if (cap) {
            const cn = PN[cap.type] ?? cap.type;
            const tmp = new Chess(currentMove.fenBefore!);
            tmp.move({ from, to, promotion: promo });
            const def = tmp.moves({ verbose: true }).some(m => m.to === to);
            facts.push(`${lbl}: ${name} on [${from}] captures ${cn} on [${to}]. ${def ? 'DEFENDED' : 'NOT defended'}.`);
          } else {
            facts.push(`${lbl}: ${name} on [${from}] moves to [${to}] (no capture).`);
          }
          // Describe threats against the moved piece (only for non-capture moves where safety matters)
          if (!cap) {
            try {
              const afterChess = new Chess(currentMove.fenBefore!);
              afterChess.move({ from, to, promotion: promo });
              const threats: string[] = [];
              let firstThreatMove: { from: string; to: string; promotion?: string } | null = null;
              for (const om of afterChess.moves({ verbose: true })) {
                if (om.to === to && om.captured) {
                  const attacker = afterChess.get(om.from as Square);
                  if (attacker) {
                    threats.push(`${PN[attacker.type] ?? attacker.type} on [${om.from}]`);
                    if (!firstThreatMove) firstThreatMove = { from: om.from, to: om.to, promotion: om.promotion };
                  }
                }
              }
              if (threats.length > 0) {
                // Simulate opponent's capture, then count our legal recaptures on
                // `to` to compute defenders. Without this the LLM only sees
                // attackers and concludes the piece is hanging even when a pawn
                // or piece guards the square.
                const defenders: string[] = [];
                try {
                  const post = new Chess(afterChess.fen());
                  post.move(firstThreatMove!);
                  for (const m of post.moves({ verbose: true })) {
                    if (m.to === to && m.captured) {
                      const defender = post.get(m.from as Square);
                      if (defender) defenders.push(`${PN[defender.type] ?? defender.type} on [${m.from}]`);
                    }
                  }
                } catch { /* ignore */ }
                if (defenders.length > 0) {
                  facts.push(`${name} on [${to}] can be captured by: ${threats.join(', ')}, but is DEFENDED by: ${defenders.join(', ')} — recapture available, NOT hanging.`);
                } else {
                  facts.push(`${name} on [${to}] can be captured by: ${threats.join(', ')}, and is NOT defended — HANGING (free capture).`);
                }
              }
            } catch { /* ignore */ }
          }
        };
        describeMv(currentMove.bestMoveUci, 'Best move');
        if (currentMove.moveUci && currentMove.moveUci !== currentMove.bestMoveUci) {
          describeMv(currentMove.moveUci, "Player's move");
          facts.push(`The player did NOT play the best move. The played move (${currentMove.moveSan}) and the best move (${currentMove.bestMoveSan}) are DIFFERENT.`);
        }
        if (facts.length > 0) positionFacts = facts.join('\n');
      } catch { /* ignore */ }
    }

    const prompt = buildPrompt(
      currentMove.fenBefore ?? '',
      currentMove.moveSan,
      currentMove.bestMoveSan ?? '',
      currentMove.cpLoss,
      game.opponent.rating,
      currentMove.pvSan,
      currentMove.tacticalMotifs,
      positionFacts,
      ttsLanguageName,
      game.player.color,
      currentMove.phase,
    );

    // Stream the response — first token arrives in ~400ms instead of waiting
    // ~3s for the full message. Each delta callback appends to the local
    // accumulator and pushes the growing text into state so the user reads
    // along as Claude generates. AbortController lets cleanup cancel the
    // in-flight stream when the user navigates to a different move.
    // 400 tokens — fits 1 sentence on "Your move" and 2-3 on "Best move"
    // plus the THEMES: prefix. 200 was clipping the best-move explanation.
    const controller = new AbortController();
    let accumulated = '';
    sendWithFallbackStream(
      settings,
      prompt.system,
      [{ role: 'user', content: prompt.user }],
      400,
      (chunk) => {
        accumulated += chunk;
        // First chunk flips us out of the loading skeleton; subsequent
        // chunks just grow the rendered text.
        setAiExplanation(accumulated);
        setAiExplanationLoading(false);
      },
      controller.signal,
    )
      .then(finalText => {
        // The accumulator usually already equals finalText, but assigning
        // it explicitly covers the edge case where no deltas arrived.
        explanationCache.current.set(idx, finalText);
        if (gameId) setCachedExplanation(gameId, idx, finalText);
        setAiExplanation(finalText);
        setAiExplanationLoading(false);
      })
      .catch((err) => {
        // AbortError = user navigated away mid-stream; not an error to show.
        if (err && (err.name === 'AbortError' || /aborted/i.test(String(err.message)))) return;
        setAiExplanationLoading(false);
      });

    return () => controller.abort();
  }, [currentMoveIndex, isNotableMove, isMoveInActiveTab]); // eslint-disable-line react-hooks/exhaustive-deps

  const bestMoveArrow = useMemo(() => {
    // When the current move is a notable one in the active insight tab
    // (key moment or pattern), automatically draw BOTH arrows:
    //   - Orange: the move the player actually made.
    //   - Green: Stockfish's recommended best move (if different).
    // No "Show best" toggle anymore — it's always visible in this context.
    if (!isMoveInActiveTab || !isNotableMove) return EMPTY_ARROWS;

    const analysisMov = analysis?.moves[currentMoveIndex];
    if (!analysisMov) return EMPTY_ARROWS;

    const arrows: [Square, Square, string][] = [];
    if (analysisMov.moveUci && analysisMov.moveUci.length >= 4) {
      arrows.push([
        analysisMov.moveUci.slice(0, 2) as Square,
        analysisMov.moveUci.slice(2, 4) as Square,
        'rgba(255, 170, 0, 0.85)',
      ]);
    }
    if (
      analysisMov.bestMoveUci &&
      analysisMov.bestMoveUci.length >= 4 &&
      analysisMov.bestMoveUci !== analysisMov.moveUci
    ) {
      arrows.push([
        analysisMov.bestMoveUci.slice(0, 2) as Square,
        analysisMov.bestMoveUci.slice(2, 4) as Square,
        'rgba(74,222,128,0.7)',
      ]);
    }
    return arrows;
  }, [currentMoveIndex, analysis, isMoveInActiveTab, isNotableMove]);

  // Memoize customSquareStyles so react-chessboard doesn't re-diff all 64
  // squares on every ply change. Only rebuilds when one of the inputs
  // actually changes.
  const customSquareStyles = useMemo<Record<string, React.CSSProperties> | undefined>(() => {
    const styles: Record<string, React.CSSProperties> = {};
    if (highlightedSquare) {
      styles[highlightedSquare] = {
        backgroundColor: 'rgba(59,130,246,0.45)',
        boxShadow: 'inset 0 0 0 2px rgba(59,130,246,0.8)',
      };
    }
    if (playFen && trapHint) {
      styles[trapHint.from] = {
        boxShadow: 'inset 0 0 0 3px rgba(96,165,250,0.55)',
      };
      styles[trapHint.to] = {
        background: 'rgba(96,165,250,0.22)',
        boxShadow: 'inset 0 0 0 2px rgba(96,165,250,0.55)',
      };
    }
    if (playFen && lastUserMove) {
      const color = getQualityColor(lastUserMove.quality);
      styles[lastUserMove.to] = {
        background: `${color}55`,
        boxShadow: `inset 0 0 0 3px ${color}`,
      };
    }
    return Object.keys(styles).length ? styles : undefined;
  }, [highlightedSquare, playFen, trapHint, lastUserMove]);

  const requestAnalysis = async (force = false) => {
    if (!game || isAnalyzing) return;
    setIsAnalyzing(true);
    if (force) explanationCache.current.clear();
    try {
      await runAnalysisPipeline(game.id, settings.analysisDepth ?? 18, force);
      // Analysis events trigger refetch automatically via ChessDataContext
    } catch (err) {
      console.error('[GameDetail] Analysis failed:', err);
    } finally {
      setIsAnalyzing(false);
    }
  };


  /* ── Result indicator ── */
  const resultLabel: Record<string, string> = {
    win: 'text-chess-accent',
    loss: 'text-chess-blunder/80',
    draw: 'text-gray-400',
  };

  const terminationKey = game ? getTerminationReason(game.pgn) : null;
  const terminationLabel = terminationKey ? t(TERMINATION_I18N_KEY[terminationKey]) : null;

  // Scroll insight tabs into view on mobile when switching tabs
  const insightTabsRef = useRef<HTMLDivElement>(null);
  const handleTabSwitch = useCallback((tab: 'stats' | 'moments' | 'patterns') => {
    // Save current move index for the tab we're leaving
    if (insightTab === 'moments') lastMomentMoveRef.current = currentMoveIndex;
    if (insightTab === 'patterns') lastPatternMoveRef.current = currentMoveIndex;

    setInsightTab(tab);

    // Restore last move index for the tab we're switching to
    if (tab === 'moments' && lastMomentMoveRef.current >= 0) {
      setCurrentMoveIndex(lastMomentMoveRef.current);
    } else if (tab === 'patterns' && lastPatternMoveRef.current >= 0) {
      setCurrentMoveIndex(lastPatternMoveRef.current);
    }

  }, [insightTab, currentMoveIndex]);

  // ── Checkmate flourish — mirrors the Sequence share overlay so the
  //     in-app board celebrates a mate the same way the exported video does.
  //     Computes the losing-king + winning-king squares from the current FEN
  //     and the orientation, ready to be turned into pixel rects below. ──
  const mateFlourish = useMemo(() => {
    if (!analysis || currentMoveIndex < 0) return null;
    const move = analysis.moves[currentMoveIndex];
    if (!move) return null;
    // Quick gate: only compute when the engine flagged a mate or the SAN
    // ends with #. Avoids running chess.js on every move.
    const sanMate = typeof move.moveSan === 'string' && move.moveSan.endsWith('#');
    const evalMate = move.evalAfter?.scoreType === 'mate' && move.evalAfter.score === 0;
    if (!sanMate && !evalMate) return null;
    try {
      const chess = new Chess(move.fenAfter);
      if (!chess.isCheckmate()) return null;
      const loserColor = chess.turn();
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
      return null;
    }
  }, [analysis, currentMoveIndex]);

  // ── Early returns AFTER all hooks ──
  if (gameLoading || analysisLoading) {
    return (
      <div className="flex items-center gap-2 text-gray-400 py-8">
        <div className="w-4 h-4 border-2 border-chess-accent border-t-transparent rounded-full animate-spin" />
        {t('detail_loading')}
      </div>
    );
  }

  if (!game) {
    return (
      <div className="text-gray-400 py-8">
        <p>{t('detail_not_found')}</p>
        <button onClick={() => navigate(-1)} className="text-chess-accent text-sm mt-2 hover:underline">
          &larr; {t('detail_go_back')}
        </button>
      </div>
    );
  }

  const currentFen = animatingFen
    ?? (currentMoveIndex >= 0 && analysis
      ? analysis.moves[currentMoveIndex].fenAfter
      : 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');

  const currentEval = currentMove?.evalAfter;
  const boardOrientation = game.player.color === 'black' ? 'black' : 'white';

  // When a move is being viewed, collapse the in-flow header and show only
  // a floating back button so the board can sit flush at the top of the
  // screen. The starting position (currentMoveIndex < 0) keeps the full
  // header visible since there's nothing else above the board to hint at
  // game context.
  const inMoveView = currentMoveIndex >= 0;
  const headerReserve = inMoveView ? 0 : 70;

  // Hoisted board / panel sizing. The board area extends edge-to-edge on
  // mobile (no main padding), only reserving room for the eval bar.
  const evalReserve = currentEval ? 32 : 0;
  const viewportSafe = (typeof window !== 'undefined' ? window.innerWidth : 1200) - evalReserve;
  // Reservation: header (when shown) + panel min (80, just status line + a
  // couple lines of AI text) + dock (measured) + safe-area worst-case (24) +
  // buffer (8). Less aggressive than the previous 160px panel reserve so
  // the board fills more of the screen vertically.
  const focusBoardCap = Math.max(200, viewportHeight - (headerReserve + 80 + dockHeight + 24 + 8));
  const safeBoardWidth = Math.min(Math.max(boardSize, 200), Math.max(viewportSafe, 200), focusBoardCap);

  // Insights panel — rendered in sidebar on desktop, above board on mobile
  const insightsPanel = analysis ? (
    <div>
      {/* Tab buttons */}
      <div ref={insightTabsRef} data-tutorial-target="game-detail-tabs" className="flex gap-1 mb-2 scroll-mt-4">
        <button onClick={() => handleTabSwitch('stats')} className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${insightTab === 'stats' ? 'bg-chess-accent/15 text-chess-accent' : 'text-gray-500 hover:text-gray-300 hover:bg-white/[0.04]'}`}>
          {t('detail_stats')}
        </button>
        {hasKeyMoments && (
          <button onClick={() => handleTabSwitch('moments')} className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${insightTab === 'moments' ? 'bg-chess-accent/15 text-chess-accent' : 'text-gray-500 hover:text-gray-300 hover:bg-white/[0.04]'}`}>
            {t('detail_key_moments')} <span className="opacity-50 ml-0.5">{keyMoments.length}</span>
          </button>
        )}
        {hasPatterns && (
          <button onClick={() => handleTabSwitch('patterns')} className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${insightTab === 'patterns' ? 'bg-chess-accent/15 text-chess-accent' : 'text-gray-500 hover:text-gray-300 hover:bg-white/[0.04]'}`}>
            {t('detail_patterns')} <span className="opacity-50 ml-0.5">{gamePatterns.length}</span>
          </button>
        )}
      </div>

      {/* Stats tab */}
      {insightTab === 'stats' && (
        <div className="bg-white/[0.03] rounded-xl px-4 py-3 border border-white/[0.04]">
          <div className="flex items-center gap-4">
            <AccuracyRing accuracy={analysis.summary.accuracy} size={48} />
            <PhaseBar phases={analysis.summary.phaseAccuracy} />
          </div>
          <button
            onClick={() => requestAnalysis(true)}
            disabled={isAnalyzing}
            className="mt-3 w-full py-1.5 rounded-lg text-xs font-medium text-gray-400 border border-white/[0.06] hover:bg-white/[0.04] hover:text-white transition-all disabled:opacity-50"
          >
            {isAnalyzing ? t('detail_analyzing') : '↻ Re-analyze game'}
          </button>
        </div>
      )}

      {/* Key Moments / Patterns */}
      {insightTab !== 'stats' && (
        <div className="flex gap-2 overflow-x-auto pb-1 md:flex-col md:overflow-x-visible md:overflow-y-auto md:max-h-[195px]" style={{ scrollbarWidth: 'thin' }}>
          {insightTab === 'moments' && hasKeyMoments && keyMoments.map((moment, idx) => (
            <KeyMomentCard
              key={idx}
              moment={moment}
              onClick={() => jumpToMoveWithAnimation(moment.halfMoveIndex)}
              isActive={currentMoveIndex === moment.halfMoveIndex}
              tutorialTargetId={inGameDetailTutorial && moment.halfMoveIndex === demoMoveHalfIndex ? 'game-detail-moment' : undefined}
            />
          ))}
          {insightTab === 'patterns' && hasGameTraps && gameTraps.map((trap) => {
            const def = OPENING_TRAPS_BY_ID.get(trap.trapId);
            const isSelected = selectedTrapId === trap.trapId;
            const isSetter = trap.playerWasSetter;
            const tintText = isSetter ? 'text-chess-accent' : 'text-chess-blunder';
            const selectedBorder = isSetter ? 'border-chess-accent/40 bg-chess-accent/[0.06]' : 'border-chess-blunder/40 bg-chess-blunder/[0.06]';
            // "Use" = player set the trap (positive framing — keep using it).
            // "Missed" = player fell into the trap (they missed defending).
            const sideLabel = isSetter ? 'Use' : 'Missed';
            return (
              <button
                key={trap.trapId}
                onClick={() => {
                  setSelectedTrapId(trap.trapId);
                  setSelectedPatternIdx(-1);
                  jumpToMoveWithAnimation(0);
                }}
                title={def?.description ?? trap.trapName}
                className={`shrink-0 w-[140px] md:w-full rounded-xl p-2.5 text-start transition-all border ${
                  isSelected ? selectedBorder : 'border-white/[0.04] bg-white/[0.02] hover:border-white/[0.08]'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className={`text-[10px] font-bold ${tintText}`}>Trap</span>
                  <span className={`text-[10px] font-bold ${tintText}`}>{sideLabel}</span>
                </div>
                <div className="text-xs font-medium text-white/90 leading-tight mb-0.5">
                  {trap.trapName}
                </div>
                <div className="text-[10px] text-gray-500 leading-snug line-clamp-2">
                  {def?.description ?? (isSetter ? 'You set this trap.' : 'Opponent set this trap.')}
                </div>
              </button>
            );
          })}
          {insightTab === 'patterns' && hasPatterns && gamePatterns.map((pattern, idx) => {
            const severityKey = pattern.totalCpLoss >= 400 ? 'detail_severity_high' as const : pattern.totalCpLoss >= 150 ? 'detail_severity_medium' as const : 'detail_severity_low' as const;
            const severity = t(severityKey);
            const sevColor = severityKey === 'detail_severity_high' ? 'text-chess-blunder' : severityKey === 'detail_severity_medium' ? 'text-chess-mistake' : 'text-chess-inaccuracy';
            const isSelected = selectedPatternIdx === idx;
            return (
              <button key={pattern.theme} onClick={() => { setSelectedTrapId(null); setSelectedPatternIdx(idx); jumpToMoveWithAnimation(gamePatterns[idx].moves[0]?.moveIndex); }} title={getThemeDescription(pattern.theme as Parameters<typeof getThemeDescription>[0])} className={`shrink-0 w-[140px] md:w-full rounded-xl p-2.5 text-start transition-all border ${isSelected ? 'border-chess-accent/40 bg-chess-accent/[0.06]' : 'border-white/[0.04] bg-white/[0.02] hover:border-white/[0.08]'}`}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] text-chess-blunder font-bold">{pattern.moves.length}×</span>
                  <span className={`text-[10px] font-bold ${sevColor}`}>{severity}</span>
                </div>
                <div className="text-xs font-medium text-white/90 leading-tight mb-0.5">{(() => {
                  const themeToKey: Record<string, string> = {
                    missed_fork: 'pattern_missed_fork', missed_pin: 'pattern_missed_pin', missed_skewer: 'pattern_missed_skewer',
                    hanging_piece: 'pattern_hanging_piece', back_rank_weakness: 'pattern_back_rank', missed_tactic_other: 'pattern_missed_tactic',
                    pawn_structure: 'pattern_pawn_structure', piece_activity: 'pattern_piece_activity', king_safety: 'pattern_king_safety',
                    space_control: 'pattern_space_control', opening_inaccuracy: 'pattern_opening_inaccuracy', opening_specific: 'pattern_opening_issue',
                    middlegame_tactics: 'pattern_middlegame_tactics', endgame_technique: 'pattern_endgame_technique', endgame_pawn_play: 'pattern_endgame_pawns',
                    time_pressure_blunder: 'pattern_time_pressure',
                  };
                  const key = themeToKey[pattern.theme];
                  return key ? t(key as any) : pattern.label;
                })()}</div>
                <div className="text-[10px] text-gray-500 tabular-nums">−{pattern.totalCpLoss}cp</div>
              </button>
            );
          })}
        </div>
      )}

      {/* "Show best" + "Practice" buttons removed — best move is now drawn
          on the board automatically when a moment/pattern move is active. */}

      {/* Selected trap → Practice CTA. Launches drag-to-play mode anchored
          at the starting position so the user can drill the trap line. */}
      {insightTab === 'patterns' && selectedTrapId && gameTraps.find((t) => t.trapId === selectedTrapId) && (
        <div className="mt-2">
          <button
            type="button"
            onClick={practiceFromStart}
            className="w-full px-3 py-2 rounded-lg bg-chess-accent/15 hover:bg-chess-accent/25 text-chess-accent text-xs font-bold transition-colors"
          >
            Practice this trap
          </button>
        </div>
      )}

      {/* Selected pattern move chips. CTAs (Show best, Practice) removed —
          best move is drawn on the board automatically when the move is active. */}
      {insightTab === 'patterns' && gamePatterns[selectedPatternIdx] && (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {gamePatterns[selectedPatternIdx].moves.map((move) => {
            const isMovActive = currentMoveIndex === move.moveIndex;
            return (
              <button key={move.moveIndex} onClick={() => jumpToMoveWithAnimation(move.moveIndex)} className={`shrink-0 rounded-lg text-xs font-mono transition-all flex items-center gap-1 ${isMovActive ? 'bg-chess-accent text-white px-2.5 py-1' : 'bg-white/[0.05] text-gray-300 hover:bg-chess-accent/20 px-2 py-0.5'}`}>
                <span className={isMovActive ? 'text-white/60 line-through decoration-1' : ''}>{move.moveSan}</span>
                {isMovActive && move.bestMoveSan && move.bestMoveSan !== move.moveSan && (
                  <span className="text-white font-bold">{'\u2192'} {move.bestMoveSan}</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  ) : null;

  return (
    <div className={`max-w-[1200px] mx-auto md:pt-6 ${inMoveView ? 'pt-0' : 'pt-2'}`}>

      {/* ══════ Floating back button — visible while a move is being
           viewed and the in-flow header is collapsed. Sits over the board
           with a blurred backdrop so it's tappable on light squares. */}
      {inMoveView && (
        <button
          onClick={() => navigate(-1)}
          aria-label="Back"
          className="md:hidden fixed top-3 start-3 z-50 text-gray-100 bg-black/35 backdrop-blur-md border border-white/15 shadow-lg p-2 rounded-full active:bg-black/50 active:scale-95 transition-all"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="rtl:rotate-180"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
      )}

      {/* ══════ 1. HEADER — clean, consolidated. Collapses on mobile while
           a move is active so the board can sit flush at the top.
           Always visible on desktop. ══════ */}
      <div className={`flex items-center gap-2 mb-2 md:mb-4 ${inMoveView ? 'hidden md:flex' : ''}`}>
        <button
          onClick={() => navigate(-1)}
          aria-label="Back"
          className="text-gray-400 hover:text-white transition-colors p-2 -ml-2 rounded-lg active:bg-white/10 active:scale-95"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" className="rtl:rotate-180"><path d="M15 18l-6-6 6-6"/></svg>
        </button>

        <PlayerAvatar username={game.opponent.username} size={34} />
        <div className="flex-1 min-w-0">
          {/* Player + result */}
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-white truncate">
              vs {game.opponent.username}
              <span className="font-normal text-gray-400 ml-1.5 text-sm">({game.opponent.rating})</span>
            </h2>
            <span className={`text-xs font-semibold uppercase tracking-wide ${resultLabel[game.player.result] ?? 'text-gray-400'}`}>
              {game.player.result === 'win' ? t('result_win_full') : game.player.result === 'loss' ? t('result_loss_full') : t('result_draw_full')}
            </span>
            {terminationLabel && (
              <span className="text-[10px] text-gray-500 truncate">· {terminationLabel}</span>
            )}
          </div>
          {/* Meta line */}
          <p className="text-xs text-gray-500 mt-0.5 truncate">
            {game.opening?.name && game.opening.name !== 'Unknown' ? game.opening.name : t('common_unknown_opening')} · {game.timeClass} · {new Date(game.playedAt).toLocaleDateString()}
          </p>
        </div>

      </div>

      {/* ══════ LAYOUT: board right, content left ══════ */}
      <div className="md:flex md:gap-14 md:items-stretch">

        {/* ── Board area (RIGHT on desktop, first on mobile) ── */}
        <div className="md:flex-[3] md:min-w-0 md:order-2">

          {/* Insight tabs + chip gallery moved BELOW the board + move
              list on mobile (was at top — caused the green dead-space
              between header and chips in focus mode). */}


          {/* No analysis states */}
          {!analysis && game.analysisStatus !== 'analyzing' && (
            <div className="bg-white/[0.03] rounded-xl p-6 border border-white/[0.04] flex flex-col items-center justify-center aspect-square max-h-[560px]">
              <p className="text-gray-400 mb-3 text-sm">{t('detail_not_analyzed')}</p>
              <button onClick={() => requestAnalysis()} disabled={isAnalyzing} className="bg-chess-accent text-white px-5 py-2 rounded-lg text-sm font-medium hover:brightness-110 transition-all disabled:opacity-50">
                {isAnalyzing ? t('detail_analyzing') : t('detail_analyze_now')}
              </button>
            </div>
          )}
          {game.analysisStatus === 'analyzing' && !analysis && (
            <div className="bg-white/[0.03] rounded-xl p-6 border border-white/[0.04] flex flex-col items-center justify-center aspect-square max-h-[560px]">
              <div className="text-chess-inaccuracy animate-pulse text-sm">{t('detail_analyzing')}</div>
            </div>
          )}

          {/* ══════ 3. BOARD + EVAL BAR — seamless docking ══════ */}
          {analysis && (
            <>
              {!showBoard && (
                <button onClick={() => setShowBoard(true)} className="w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-white/[0.03] rounded-lg text-xs text-gray-400 hover:text-white transition-colors md:hidden">
                  <span>♟</span> {t('detail_show_board')}
                </button>
              )}
              <div className={`${showBoard ? '' : 'hidden md:block'}`}>

                {/* Board + eval — no gap between them */}
                {/* Board column. We measure the BOARD wrapper via
                    containerRef AND clamp to the visible viewport width
                    minus a safety reserve (eval bar + page padding +
                    chessboard chrome). Without the viewport clamp the
                    initial render — before ResizeObserver fires — could
                    overshoot the wrapper and overflow on the right. */}
                {(() => {
                  // safeBoardWidth is hoisted above (so the explanation
                  // panel can size itself off the same value); the board
                  // and its overlays just consume it here.
                  // Map an algebraic square to a pixel rect on the rendered board.
                  const sqRect = (square: Square | null) => {
                    if (!square) return null;
                    const file = square.charCodeAt(0) - 'a'.charCodeAt(0);
                    const rank = parseInt(square[1], 10) - 1;
                    const x = boardOrientation === 'white' ? file : 7 - file;
                    const y = boardOrientation === 'white' ? 7 - rank : rank;
                    const sq = safeBoardWidth / 8;
                    return { left: x * sq, top: y * sq, width: sq, height: sq };
                  };
                  const loserRect = mateFlourish ? sqRect(mateFlourish.loser) : null;
                  const winnerRect = mateFlourish ? sqRect(mateFlourish.winner) : null;
                  return (
                    <div className="flex gap-0 justify-center min-w-0 overflow-hidden w-screen ml-[calc(50%-50vw)] md:w-full md:ml-0">
                      {currentEval && (
                        <div className="shrink-0">
                          <EvalBar score={currentEval.score} scoreType={currentEval.scoreType} height={safeBoardWidth} />
                        </div>
                      )}
                      <div ref={containerRef} className="flex-1 min-w-0 overflow-hidden relative" style={{ maxWidth: safeBoardWidth }}>
                        <ThemedChessboard
                          position={playFen ?? currentFen}
                          boardOrientation={boardOrientation}
                          boardWidth={safeBoardWidth}
                          arePiecesDraggable={!isBotThinking}
                          isDraggablePiece={({ piece }) => {
                            if (isBotThinking) return false;
                            const ownPiece =
                              (game.player.color === 'white' && piece.startsWith('w')) ||
                              (game.player.color === 'black' && piece.startsWith('b'));
                            if (!ownPiece) return false;
                            // Only let the user grab their pieces when it's
                            // their actual turn at the displayed position.
                            const displayedFen = playFen ?? currentFen;
                            const turnChar = displayedFen.split(' ')[1];
                            const userTurnChar = game.player.color === 'white' ? 'w' : 'b';
                            return turnChar === userTurnChar;
                          }}
                          onPieceDrop={(from, to) => handlePieceDrop(from, to)}
                          customArrows={playFen ? EMPTY_ARROWS : bestMoveArrow}
                          customSquareStyles={customSquareStyles}
                        />
                        {/* Board overlay intentionally empty in play mode —
                            all chrome (X, PRACTICE label, toggles) lives in
                            the compact toolbar BELOW the board. */}
                        {/* ─── Checkmate flourish — same red+green glow + banner
                              we paint into the share video, now in-app too. ─── */}
                        {mateFlourish && loserRect && (
                          <div style={{
                            position: 'absolute',
                            ...loserRect,
                            pointerEvents: 'none',
                            background: 'radial-gradient(circle, rgba(239,68,68,0.85) 0%, rgba(239,68,68,0.55) 45%, rgba(239,68,68,0) 75%)',
                            mixBlendMode: 'screen',
                            animation: 'mate-pulse 1.4s ease-in-out infinite',
                          }} />
                        )}
                        {mateFlourish && winnerRect && (
                          <div style={{
                            position: 'absolute',
                            ...winnerRect,
                            pointerEvents: 'none',
                            background: 'radial-gradient(circle, rgba(74,222,128,0.85) 0%, rgba(74,222,128,0.55) 45%, rgba(74,222,128,0) 75%)',
                            mixBlendMode: 'screen',
                            animation: 'mate-pulse 1.4s ease-in-out infinite',
                          }} />
                        )}
                        {mateFlourish && (
                          <div style={{
                            position: 'absolute',
                            top: 8, left: '50%', transform: 'translateX(-50%)',
                            padding: '4px 12px',
                            background: '#ef4444',
                            color: '#fff',
                            fontSize: 11, fontWeight: 900,
                            letterSpacing: 2, borderRadius: 6,
                            boxShadow: '0 4px 14px rgba(0,0,0,0.5)',
                            whiteSpace: 'nowrap',
                            pointerEvents: 'none',
                          }}>
                            CHECKMATE
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })()}

                {/* Mobile flex column: AI panel fills the remaining space
                    between the board and the dock; long AI text scrolls
                    inside the panel; the dock sits flush at the bottom of
                    the viewport with no orphan spacer. The wrapper height is
                    locked to the leftover viewport (after the board) so
                    flex-1 inside has something to flex against. */}
                <div
                  className="md:hidden flex flex-col w-screen ml-[calc(50%-50vw)] px-3 md:w-full md:ml-0"
                  style={{ height: `calc(100dvh - ${safeBoardWidth + headerReserve}px)` }}
                >
                  {/* 1. AI MOVE INSIGHT — flex-1 grows to fill the remaining
                         space; overflow-y-auto handles long commentary. */}
                  <div className="flex-1 min-h-0 overflow-y-auto">
                    {playFen ? (
                      <PracticeCoachPanel
                        trapId={selectedTrapId}
                        trapHintSan={trapHint?.san ?? null}
                        lastUserMove={lastUserMove}
                        showFeedback={showFeedback}
                        onToggleFeedback={setShowFeedback}
                        botMode={botMode}
                        onSetBotMode={setBotMode}
                        isBotThinking={isBotThinking}
                        onExit={exitPlayMode}
                      />
                    ) : currentMove && (
                      <MoveInsightPanel
                        move={currentMove}
                        aiExplanation={aiExplanation}
                        aiExplanationLoading={aiExplanationLoading}
                        hasCommentary={isMoveInActiveTab && isNotableMove}
                        onSquareClick={(sq) => setHighlightedSquare(prev => prev === sq ? null : sq)}
                        onTabChange={handleExplanationTabChange}
                      />
                    )}
                  </div>

                  {/* 2 + 3. DOCK — INSIGHT TABS + CHIP GALLERY, then MOVE
                         LIST with nav arrows. Flex-none, sits at the bottom
                         of the wrapper. The ref measures the dock's actual
                         rendered height so the board cap above can subtract
                         the right amount. */}
                  <div
                    ref={dockRef}
                    className="flex-none pt-2 pb-[calc(env(safe-area-inset-bottom)+4px)]"
                  >
                  {insightsPanel && (
                    <div className="mb-2">
                      {insightsPanel}
                    </div>
                  )}

                  {/* MOVE LIST with all four nav arrows flanking it.
                         Layout: [«][‹] moves [›][»]. Targets sized for thumb use. */}
                  <div className="flex items-stretch gap-1">
                    <button
                      onClick={() => setCurrentMoveIndex(-1)}
                      disabled={currentMoveIndex <= -1}
                      aria-label="Jump to start"
                      className="shrink-0 w-10 h-11 flex items-center justify-center rounded-l-xl bg-white/[0.04] text-gray-400 disabled:opacity-15 hover:bg-white/[0.08] active:bg-white/[0.12] transition-all"
                    >
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 17l-5-5 5-5"/><path d="M11 17l-5-5 5-5"/></svg>
                    </button>
                    <button
                      onClick={() => setCurrentMoveIndex((prev) => Math.max(prev - 1, -1))}
                      disabled={currentMoveIndex <= -1}
                      aria-label="Previous move"
                      className="shrink-0 w-12 h-11 flex items-center justify-center rounded-r-xl bg-white/[0.04] text-gray-300 disabled:opacity-15 hover:bg-white/[0.08] active:bg-white/[0.12] transition-all"
                    >
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M15 18l-6-6 6-6"/></svg>
                    </button>

                    <div className="flex-1 min-w-0 bg-white/[0.03] rounded-xl overflow-hidden border border-white/[0.04]">
                      <MoveList moves={analysis.moves} currentMoveIndex={deferredMoveIndex} onMoveClick={setCurrentMoveIndex} />
                    </div>

                    <button
                      onClick={() => setCurrentMoveIndex((prev) => Math.min(prev + 1, analysis.moves.length - 1))}
                      disabled={currentMoveIndex >= analysis.moves.length - 1}
                      aria-label="Next move"
                      className="shrink-0 w-12 h-11 flex items-center justify-center rounded-l-xl bg-white/[0.04] text-gray-300 disabled:opacity-15 hover:bg-white/[0.08] active:bg-white/[0.12] transition-all"
                    >
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M9 18l6-6-6-6"/></svg>
                    </button>
                    <button
                      onClick={() => setCurrentMoveIndex(analysis.moves.length - 1)}
                      disabled={currentMoveIndex >= analysis.moves.length - 1}
                      aria-label="Jump to end"
                      className="shrink-0 w-10 h-11 flex items-center justify-center rounded-r-xl bg-white/[0.04] text-gray-400 disabled:opacity-15 hover:bg-white/[0.08] active:bg-white/[0.12] transition-all"
                    >
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M6 17l5-5-5-5"/><path d="M13 17l5-5-5-5"/></svg>
                    </button>
                  </div>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        {/* ── Sidebar (LEFT on desktop) — Stats / Key Moments / Patterns + CTAs ── */}
        <div className="md:flex-[2] md:min-w-[280px] md:max-w-[380px] mt-3 md:mt-0 md:order-1 hidden md:flex md:flex-col">
          {/* Insights at top */}
          {insightsPanel && <div>{insightsPanel}</div>}

          {/* Practice coach — desktop. Shown above MoveInsightPanel while
              in play mode. */}
          {analysis && playFen && (
            <PracticeCoachPanel
              trapId={selectedTrapId}
              trapHintSan={trapHint?.san ?? null}
              lastUserMove={lastUserMove}
              showFeedback={showFeedback}
              onToggleFeedback={setShowFeedback}
              botMode={botMode}
              onSetBotMode={setBotMode}
              isBotThinking={isBotThinking}
              onExit={exitPlayMode}
            />
          )}

          {/* Move insight panel — desktop. Always rendered when there is
              a current move so the layout stays stable while scrubbing. */}
          {analysis && currentMove && !playFen && (
            <MoveInsightPanel
              move={currentMove}
              aiExplanation={aiExplanation}
              aiExplanationLoading={aiExplanationLoading}
              hasCommentary={isMoveInActiveTab && isNotableMove}
              onSquareClick={(sq) => setHighlightedSquare(prev => prev === sq ? null : sq)}
              onTabChange={handleExplanationTabChange}
            />
          )}

          {/* CTAs pinned to the bottom, aligned with board nav arrows */}
          {analysis && (
            <div className="mt-auto pt-4 grid grid-cols-3 gap-2">
              <button
                onClick={() => navigate('/timemachine', { state: { gameFilter: gameId, returnTo: { path: `/games/${gameId}`, moveIndex: currentMoveIndex } } })}
                className="bg-white/[0.03] rounded-xl p-3 text-center border border-white/[0.04] hover:border-chess-accent/30 hover:bg-white/[0.05] transition-all group"
              >
                <div className="mb-0.5 opacity-70 group-hover:opacity-100 transition-opacity flex justify-center"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400"><circle cx="12" cy="12" r="9"/><polygon points="10 8 16 12 10 16" fill="currentColor" stroke="none"/></svg></div>
                <div className="text-xs font-semibold text-white">{t('detail_practice_cta')}</div>
                {hasPatterns && <div className="text-[10px] text-gray-500 mt-0.5">{t('detail_practice_sub', { count: gamePatterns.reduce((sum, p) => sum + p.moves.length, 0) })}</div>}
              </button>
              <button
                onClick={() => navigate('/compare', { state: { autoCompare: game.opponent.username } })}
                className="bg-white/[0.03] rounded-xl p-3 text-center border border-white/[0.04] hover:border-chess-accent/30 hover:bg-white/[0.05] transition-all group"
              >
                <div className="mb-0.5 opacity-70 group-hover:opacity-100 transition-opacity flex justify-center"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400"><rect x="3" y="10" width="4" height="11" rx="1"/><rect x="10" y="4" width="4" height="17" rx="1"/><rect x="17" y="8" width="4" height="13" rx="1"/></svg></div>
                <div className="text-xs font-semibold text-white">{t('detail_compare')}</div>
                <div className="text-[10px] text-gray-500 mt-0.5 truncate">{t('detail_compare_sub', { opponent: game.opponent.username })}</div>
              </button>
              <button
                onClick={() => { setShareMove(analysis && currentMoveIndex >= 0 ? analysis.moves[currentMoveIndex] ?? null : null); setShareOpen(true); }}
                className="bg-white/[0.03] rounded-xl p-3 text-center border border-white/[0.04] hover:border-chess-accent/30 hover:bg-white/[0.05] transition-all group"
              >
                <div className="mb-0.5 opacity-70 group-hover:opacity-100 transition-opacity flex justify-center"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg></div>
                <div className="text-xs font-semibold text-white">{t('detail_share') ?? 'Share'}</div>
                <div className="text-[10px] text-gray-500 mt-0.5">{t('detail_share_sub') ?? 'Create card'}</div>
              </button>
            </div>
          )}
        </div>
      </div>{/* end flex layout */}

      {/* ── ACTION CTAs — mobile only (desktop shows in sidebar) ──
            Three columns at full width with title + small subtitle. */}
      {analysis && (
        <div className="grid grid-cols-3 gap-2 mt-5 mb-8 md:hidden">
          {/* Practice → TimeMachine filtered to this game */}
          <button
            onClick={() => navigate('/timemachine', { state: { gameFilter: gameId, returnTo: { path: `/games/${gameId}`, moveIndex: currentMoveIndex } } })}
            className="bg-white/[0.03] rounded-xl p-3 text-center border border-white/[0.04] hover:border-chess-accent/30 hover:bg-white/[0.05] transition-all group"
          >
            <div className="mb-0.5 opacity-70 group-hover:opacity-100 transition-opacity flex justify-center"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400"><circle cx="12" cy="12" r="9"/><polygon points="10 8 16 12 10 16" fill="currentColor" stroke="none"/></svg></div>
            <div className="text-xs font-semibold text-white">{t('detail_practice_cta')}</div>
            <div className="text-[10px] text-gray-500 mt-0.5">mistakes</div>
          </button>

          {/* Compare → auto-start comparison with opponent */}
          <button
            onClick={() => navigate('/compare', { state: { autoCompare: game.opponent.username } })}
            className="bg-white/[0.03] rounded-xl p-3 text-center border border-white/[0.04] hover:border-chess-accent/30 hover:bg-white/[0.05] transition-all group"
          >
            <div className="mb-0.5 opacity-70 group-hover:opacity-100 transition-opacity flex justify-center"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400"><rect x="3" y="10" width="4" height="11" rx="1"/><rect x="10" y="4" width="4" height="17" rx="1"/><rect x="17" y="8" width="4" height="13" rx="1"/></svg></div>
            <div className="text-xs font-semibold text-white">{t('detail_compare')}</div>
            <div className="text-[10px] text-gray-500 mt-0.5 truncate">vs. {game.opponent.username}</div>
          </button>

          {/* Share → open share composer */}
          <button
            onClick={() => { setShareMove(analysis && currentMoveIndex >= 0 ? analysis.moves[currentMoveIndex] ?? null : null); setShareOpen(true); }}
            className="bg-white/[0.03] rounded-xl p-3 text-center border border-white/[0.04] hover:border-chess-accent/30 hover:bg-white/[0.05] transition-all group"
          >
            <div className="mb-0.5 opacity-70 group-hover:opacity-100 transition-opacity flex justify-center"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg></div>
            <div className="text-xs font-semibold text-white">{t('detail_share') ?? 'Share'}</div>
            <div className="text-[10px] text-gray-500 mt-0.5">moments</div>
          </button>
        </div>
      )}
      <DataAttribution />

      {/* Share Composer */}
      {game && (
        <ShareComposer
          isOpen={shareOpen}
          onClose={() => setShareOpen(false)}
          game={game}
          summary={analysis?.summary}
          move={shareMove}
          allMoves={analysis?.moves}
          profile={profile}
        />
      )}
    </div>
  );
}

/* ══════ AccuracyRing — larger, cleaner ══════ */

function AccuracyRing({ accuracy, size }: { accuracy: number; size: number }) {
  const stroke = 4;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = (accuracy / 100) * circumference;
  const color = accuracy >= 90 ? '#4ade80' : accuracy >= 75 ? '#4ade80' : accuracy >= 60 ? '#facc15' : '#ef4444';

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="white" strokeWidth={stroke} opacity={0.06} />
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${progress} ${circumference}`} style={{ transition: 'stroke-dasharray 0.8s ease-out' }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-base font-black text-white leading-none">{accuracy}%</span>
      </div>
    </div>
  );
}

/* ══════ PhaseBar — cleaner with better contrast ══════ */

function PhaseBar({ phases }: { phases: { opening: number; middlegame: number; endgame: number } }) {
  const getColor = (acc: number) => {
    if (acc >= 90) return { bar: 'bg-chess-best', text: 'text-chess-best' };
    if (acc >= 75) return { bar: 'bg-chess-accent', text: 'text-chess-accent' };
    if (acc >= 60) return { bar: 'bg-chess-inaccuracy', text: 'text-amber-400' };
    return { bar: 'bg-chess-blunder', text: 'text-red-400' };
  };

  const { t: phaseT } = useT();
  const segments = [
    { label: phaseT('phase_opening'), accuracy: phases.opening },
    { label: phaseT('phase_middlegame'), accuracy: phases.middlegame },
    { label: phaseT('phase_endgame'), accuracy: phases.endgame },
  ];

  return (
    <div className="flex-1 min-w-0 space-y-2">
      {segments.map((seg) => {
        const colors = getColor(seg.accuracy);
        return (
          <div key={seg.label} className="flex items-center gap-2">
            <span className="text-[10px] text-gray-500 w-16 shrink-0">{seg.label}</span>
            <div className="flex-1 h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
              <div
                className={`h-full rounded-full ${colors.bar} transition-all duration-700`}
                style={{ width: `${seg.accuracy}%`, opacity: 0.5 + (seg.accuracy / 100) * 0.5 }}
              />
            </div>
            <span className={`text-[11px] font-semibold tabular-nums w-9 text-right ${colors.text}`}>
              {seg.accuracy}%
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ══════ KeyMomentCard — move is hero, badge is subtle ══════ */

function KeyMomentCard({
  moment,
  onClick,
  isActive,
  tutorialTargetId,
}: {
  moment: MoveAnalysis & { momentType: 'mistake' | 'brilliant' };
  onClick: () => void;
  isActive: boolean;
  /** When set, marks this card with `data-tutorial-target` so the tutorial
   *  coachmark can spotlight it. */
  tutorialTargetId?: string;
}) {
  const { t } = useT();
  const isMistake = moment.momentType === 'mistake';
  const qualityConfig: Record<string, { icon: string; text: string; label: string }> = {
    brilliant: { icon: '✦', text: 'text-[#1baca6]', label: t('quality_brilliant') },
    great: { icon: '!', text: 'text-[#5c8bb0]', label: t('quality_great') },
    blunder: { icon: '✕', text: 'text-chess-blunder', label: t('quality_blunder') },
    mistake: { icon: '?', text: 'text-chess-mistake', label: t('quality_mistake') },
    miss: { icon: '?', text: 'text-chess-mistake', label: t('quality_miss') },
    inaccuracy: { icon: '?!', text: 'text-chess-inaccuracy', label: t('quality_inaccuracy') },
  };
  const config = qualityConfig[moment.quality] ?? qualityConfig.inaccuracy;

  return (
    <button
      onClick={onClick}
      data-tutorial-target={tutorialTargetId}
      className={`shrink-0 w-[130px] md:w-full rounded-xl p-2 md:p-2.5 transition-all border leading-tight ${
        isActive
          ? 'border-chess-accent/40 bg-chess-accent/[0.06]'
          : 'border-white/[0.04] bg-white/[0.02] hover:border-white/[0.08] hover:bg-white/[0.04]'
      }`}
    >
      <div className="flex items-center justify-between mb-0.5">
        <span className={`text-[10px] font-semibold ${config.text}`}>
          {config.label}
        </span>
        <span className="text-[10px] text-gray-600">{t('detail_move_n', { n: moment.moveNumber })}</span>
      </div>
      {/* Move is the hero */}
      <div className="font-mono text-sm md:text-base font-bold text-chess-text">{moment.moveSan}</div>
      {isMistake && moment.bestMoveSan && moment.moveSan !== moment.bestMoveSan && (
        <div className="text-[11px] md:text-xs text-gray-500">
          {t('detail_best_label')} <span className="text-chess-accent font-mono font-semibold">{moment.bestMoveSan}</span>
        </div>
      )}
    </button>
  );
}

/* ══════ PracticeCoachPanel — guidance + compact toolbar shown while in
   play mode. The toolbar (one row, very compact) replaces the old multi-
   button overlay that used to clutter the board. Only the X (exit) button
   stays on the board itself. */
function PracticeCoachPanel({
  trapId,
  trapHintSan,
  lastUserMove,
  showFeedback,
  onToggleFeedback,
  botMode,
  onSetBotMode,
  isBotThinking,
  onExit,
}: {
  trapId: string | null;
  trapHintSan: string | null;
  lastUserMove: { from: string; to: string; san: string; quality: MoveQuality; bestSan: string; cpLoss: number } | null;
  showFeedback: boolean;
  onToggleFeedback: (v: boolean) => void;
  botMode: BotMode;
  onSetBotMode: (m: BotMode) => void;
  isBotThinking: boolean;
  onExit: () => void;
}) {
  const trap = trapId ? OPENING_TRAPS_BY_ID.get(trapId) ?? null : null;
  const qualityColor = lastUserMove ? getQualityColor(lastUserMove.quality) : null;
  const qualityLabel = lastUserMove ? lastUserMove.quality.charAt(0).toUpperCase() + lastUserMove.quality.slice(1) : null;
  const isError = lastUserMove ? ['inaccuracy', 'mistake', 'miss', 'blunder'].includes(lastUserMove.quality) : false;

  return (
    <div className="space-y-2">
      {/* Compact one-row toolbar — sits flush below the board. Single row
          (no wrap), horizontal scroll only if needed on very narrow widths. */}
      <div className="rounded-full bg-white/[0.04] border border-white/[0.06] px-1.5 py-1 flex items-center gap-1.5 flex-nowrap overflow-x-auto">
        <button
          type="button"
          onClick={onExit}
          aria-label="Exit practice mode"
          title="Exit practice mode"
          className="shrink-0 w-6 h-6 inline-flex items-center justify-center rounded-full bg-chess-blunder/90 text-white hover:bg-chess-blunder transition-colors"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
        <span className="inline-flex items-center gap-1 text-[10px] font-extrabold uppercase tracking-[1.2px] text-chess-accent shrink-0">
          <span className={`w-1.5 h-1.5 rounded-full bg-chess-accent ${isBotThinking ? 'animate-pulse' : ''}`} />
          {isBotThinking ? 'Bot…' : 'Practice'}
        </span>
        <div className="inline-flex items-stretch rounded-full overflow-hidden border border-white/[0.08] text-[10px] font-bold shrink-0">
          <button type="button" onClick={() => onSetBotMode('engine')} className={`px-2 py-0.5 transition-colors ${botMode === 'engine' ? 'bg-chess-accent/25 text-chess-accent' : 'text-gray-400 hover:text-white'}`}>Engine</button>
          <button type="button" onClick={() => onSetBotMode('opponent')} className={`px-2 py-0.5 transition-colors ${botMode === 'opponent' ? 'bg-chess-accent/25 text-chess-accent' : 'text-gray-400 hover:text-white'}`}>Opponent</button>
        </div>
        <button
          type="button"
          onClick={() => onToggleFeedback(!showFeedback)}
          className={`px-2 py-0.5 rounded-full border border-white/[0.08] text-[10px] font-bold transition-colors shrink-0 ${showFeedback ? 'text-chess-accent' : 'text-gray-400 hover:text-white'}`}
          title="Show move-quality color after each of your moves"
        >
          Feedback {showFeedback ? 'on' : 'off'}
        </button>
      </div>

      {/* Coach text — trap description / last-move feedback. */}
      <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] p-3 space-y-2">
        {trap && (
          <div>
            <div className="text-[10px] font-extrabold uppercase tracking-[1.4px] text-chess-accent mb-0.5">
              Practicing
            </div>
            <div className="text-sm font-bold text-white">{trap.name}</div>
            <p className="text-[11px] text-gray-400 mt-1 leading-snug">{trap.description}</p>
            {trapHintSan && (
              <div className="mt-2 inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-blue-500/15 text-blue-300 text-[11px] font-bold">
                Try {trapHintSan}
              </div>
            )}
          </div>
        )}
        {showFeedback && lastUserMove && qualityColor && (
          <div className={`${trap ? 'pt-2 border-t border-white/[0.06]' : ''}`}>
            <div className="text-[10px] font-extrabold uppercase tracking-[1.4px] text-gray-400 mb-0.5">
              Your move
            </div>
            <div className="flex items-center gap-2">
              <span className="font-mono font-bold text-white text-sm">{lastUserMove.san}</span>
              <span className="text-[11px] font-extrabold uppercase tracking-[1.2px] px-1.5 py-0.5 rounded" style={{ backgroundColor: `${qualityColor}33`, color: qualityColor }}>
                {qualityLabel}
              </span>
              {lastUserMove.cpLoss >= 50 && (
                <span className="text-[10px] text-gray-500 tabular-nums">−{lastUserMove.cpLoss}cp</span>
              )}
            </div>
            {isError && lastUserMove.bestSan && lastUserMove.bestSan !== lastUserMove.san && (
              <p className="text-[11px] text-gray-400 mt-1">
                Best was <span className="font-mono font-bold text-chess-accent">{lastUserMove.bestSan}</span>.
              </p>
            )}
          </div>
        )}
        {!trap && !lastUserMove && (
          <div className="text-[11px] text-gray-400">
            Drag a piece to start playing. Tap Exit on the board to leave practice mode.
          </div>
        )}
      </div>
    </div>
  );
}

/* ══════ MoveInsightPanel — compact explanation below board ══════ */

function ClockGlyph({ size = 12 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="inline-block opacity-80"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function formatMoveTime(seconds: number | null): string | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return null;
  if (seconds < 1) return `${(Math.round(seconds * 10) / 10).toString()}s`;
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const rem = Math.round(seconds - m * 60);
  return rem === 0 ? `${m}m` : `${m}m ${rem}s`;
}

type StatPillTone = 'muted' | 'accent' | 'warn';
function StatPill({
  children,
  size = 'sm',
  tone = 'muted',
  title,
}: {
  children: React.ReactNode;
  size?: 'sm' | 'md';
  tone?: StatPillTone;
  title?: string;
}) {
  // Intentionally no background/border — these are data labels, not
  // interactive controls. Tone is conveyed purely through text color
  // so nothing reads as a button.
  const sizeCls = size === 'sm' ? 'text-[11px] gap-1' : 'text-[13px] gap-1.5';
  const toneCls =
    tone === 'accent'
      ? 'text-chess-accent font-semibold'
      : tone === 'warn'
        ? 'text-amber-300 font-semibold'
        : 'text-chess-text-secondary';
  return (
    <span
      className={`inline-flex items-center tabular-nums whitespace-nowrap ${sizeCls} ${toneCls}`}
      title={title}
      dir="ltr"
    >
      {children}
    </span>
  );
}

/** Joins an array of pills with subtle dot separators. Each pill wrapper
 *  is `flex-shrink-0 whitespace-nowrap` so the metadata row stays on a
 *  single line — the parent container handles horizontal overflow. */
function joinWithDots(
  items: Array<React.ReactNode | false | null | undefined>,
  size: 'sm' | 'md',
): React.ReactNode {
  const visible = items.filter(Boolean) as React.ReactNode[];
  const dotCls =
    size === 'sm' ? 'text-[11px] text-gray-700' : 'text-[13px] text-gray-700';
  return visible.map((el, i) => (
    <span key={i} className="inline-flex items-center gap-1.5 flex-shrink-0 whitespace-nowrap">
      {i > 0 && <span className={dotCls} aria-hidden>·</span>}
      {el}
    </span>
  ));
}

function MoveInsightPanel({
  move,
  aiExplanation,
  aiExplanationLoading,
  hasCommentary = true,
  onSquareClick,
  onTabChange,
}: {
  move: MoveAnalysis;
  aiExplanation: string | null;
  aiExplanationLoading: boolean;
  /** True when this move qualifies for AI commentary (key moment / pattern).
   *  When false, the panel still renders at the same size but shows a
   *  short "no commentary on this move" placeholder instead of skeleton/text. */
  hasCommentary?: boolean;
  onSquareClick: (sq: string) => void;
  /** Fires when the user toggles the Your move / Best move tabs. The parent
   *  uses this to play a sound matching the best move when tab 1 is shown. */
  onTabChange?: (activeTab: 0 | 1) => void;
}) {
  const { t } = useT();

  // Theme slugs surfaced as clickable chips: engine-detected motifs
  // (deterministic) merged with AI-declared themes parsed off the THEMES:
  // prefix of the AI explanation. Deduped, capped at 2 so the header row
  // stays on a single line on mobile.
  const themeSlugs = useMemo(() => {
    const fromEngine = (move.tacticalMotifs ?? [])
      .map((m) => MOTIF_TO_THEME[m] ?? m)
      .filter((s) => isValidThemeSlug(s));
    const fromAi = aiExplanation ? extractThemes(aiExplanation).slugs : [];
    return [...new Set([...fromEngine, ...fromAi])].slice(0, 2);
  }, [move.tacticalMotifs, aiExplanation]);
  const phaseLabel = move.phase
    ? (() => {
        const key = `phase_${move.phase}` as Parameters<typeof t>[0];
        const v = t(key);
        return v !== key ? v : move.phase;
      })()
    : null;
  const clockLowText =
    move.clockRemaining != null && move.clockRemaining < 30
      ? `${Math.round(move.clockRemaining)}s left`
      : null;
  const moveTimeText = formatMoveTime(move.timeSpent);

  const qualityColor = move.quality === 'blunder' ? 'text-chess-blunder' : (move.quality === 'mistake' || move.quality === 'miss') ? 'text-chess-mistake' : (move.quality === 'inaccuracy' ? 'text-chess-inaccuracy' : 'text-chess-text-secondary');
  const qualityLabelKey: Parameters<typeof t>[0] = (`quality_${move.quality}` as Parameters<typeof t>[0]);
  const qualityFallback: Record<string, string> = {
    brilliant: 'Brilliant', great: 'Great', best: 'Best', excellent: 'Excellent',
    good: 'Good', book: 'Book', inaccuracy: 'Inaccuracy', mistake: 'Mistake',
    miss: 'Miss', blunder: 'Blunder', forced: 'Forced',
  };
  const qualityLabel = (() => {
    const v = t(qualityLabelKey);
    return v !== qualityLabelKey ? v : (qualityFallback[move.quality] ?? move.quality);
  })();

  // Container is fixed at 240px height — keeps the layout below the panel
  // (chips, move list) stable as the user scrubs through moves regardless
  // of whether the current move has AI commentary or not.
  return (
    <div data-tutorial-target="game-detail-ai-explanation" className="mt-2 bg-white/[0.03] rounded-xl px-3 py-2.5 border border-white/[0.04] flex flex-col">
      {/* Small inline header — only when AI commentary is present. The
          no-commentary path renders its own BIG centered version below. */}
      {hasCommentary && (
        <div
          className="flex items-center gap-2 mb-2 flex-nowrap overflow-x-auto"
          style={{ scrollbarWidth: 'none' }}
        >
          <span className={`text-sm font-bold whitespace-nowrap ${qualityColor}`}>{qualityLabel}</span>
          {joinWithDots(
            [
              move.cpLoss > 0 && <StatPill size="sm">−{move.cpLoss}cp</StatPill>,
              moveTimeText && (
                <StatPill size="sm" title="Time spent on this move">
                  <ClockGlyph size={11} />
                  {moveTimeText}
                </StatPill>
              ),
              clockLowText && (
                <StatPill size="sm" tone="warn" title="Clock remaining after this move">
                  {clockLowText}
                </StatPill>
              ),
              // Header theme chips are only shown when there's NO AI
              // explanation — in that case the chips are the user's only
              // surface for discovering themes. When an explanation is
              // present, the chips render inline inside the prose instead
              // (see ExplanationText), so we don't double up here.
              ...(aiExplanation
                ? []
                : themeSlugs.map((slug) => (
                    <ThemeChip key={slug} slug={slug} size="sm" />
                  ))),
              phaseLabel && <StatPill size="sm">{phaseLabel}</StatPill>,
            ],
            'sm',
          )}
        </div>
      )}

      {/* AI explanation
          Loading state renders a SKELETON the same shape + ~95% the height
          of a real two-section explanation (Your Move + Best Move). This
          way the layout is reserved up front and the page doesn't jump
          when the actual text arrives.
          When `hasCommentary` is false the move isn't a key moment / pattern
          and we render a same-sized placeholder instead — keeps the panel
          height stable while the user scrubs through the move list. */}
      {!hasCommentary && (
        // Big centered headline replaces the tiny inline header in this
        // state, so the panel still looks intentional when empty.
        <div className="flex-1 flex flex-col items-center justify-center text-center px-3 gap-3">
          <span className={`text-3xl font-black leading-none ${qualityColor}`}>{qualityLabel}</span>

          {/* Metadata row — flat data labels with dot separators, not
              pill-buttons. */}
          <div className="flex items-center justify-center gap-2 flex-wrap">
            {joinWithDots(
              [
                move.cpLoss > 0 && <StatPill size="md">−{move.cpLoss}cp</StatPill>,
                moveTimeText && (
                  <StatPill size="md" title="Time spent on this move">
                    <ClockGlyph size={13} />
                    {moveTimeText}
                  </StatPill>
                ),
                clockLowText && (
                  <StatPill size="md" tone="warn" title="Clock remaining after this move">
                    {clockLowText}
                  </StatPill>
                ),
                // Same rule for the md (no-commentary) row: chips only when
                // there's no AI explanation to host them inline.
                ...(aiExplanation
                  ? []
                  : themeSlugs.map((slug) => (
                      <ThemeChip key={slug} slug={slug} size="md" />
                    ))),
                phaseLabel && <StatPill size="md">{phaseLabel}</StatPill>,
              ],
              'md',
            )}
          </div>

          <div className="text-[10px] text-gray-600 leading-snug max-w-[260px]">
            No commentary &mdash; AI explanations appear on key moments &amp; pattern moves.
          </div>
        </div>
      )}
      {hasCommentary && aiExplanationLoading && (
        <div aria-busy="true" aria-live="polite">
          {/* Tab row skeleton */}
          <div className="flex items-center gap-1.5 mb-2">
            <div className="h-5 w-20 rounded-md bg-red-500/20 animate-pulse" />
            <div className="h-5 w-20 rounded-md bg-white/[0.05] animate-pulse" />
          </div>
          {/* Single card skeleton (active tab) */}
          <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
            <div className="space-y-1.5">
              <div className="h-2 w-full rounded bg-white/[0.07] animate-pulse" />
              <div className="h-2 w-[92%] rounded bg-white/[0.07] animate-pulse" />
              <div className="h-2 w-[60%] rounded bg-white/[0.07] animate-pulse" />
            </div>
          </div>
          {/* Tiny accessible label, off-screen, for screen readers. */}
          <span className="sr-only">{t('common_loading')}</span>
        </div>
      )}
      {hasCommentary && aiExplanation && !aiExplanationLoading && (
        <div className="text-[13px] leading-relaxed text-chess-text-secondary">
          <ExplanationText
            text={aiExplanation}
            onSquareClick={onSquareClick}
            onTabChange={onTabChange}
            isBestMove={
              !!move.bestMoveSan && !!move.moveSan &&
              (move.moveSan === move.bestMoveSan ||
                move.moveUci === move.bestMoveUci ||
                move.quality === 'best' || move.quality === 'brilliant' || move.quality === 'great')
            }
          />
        </div>
      )}
    </div>
  );
}


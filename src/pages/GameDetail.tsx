import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import ThemedChessboard from '@/components/ThemedChessboard';
import EvalBar from '@/components/EvalBar';
import MoveList from '@/components/MoveList';
import { useChessData } from '@/contexts/ChessDataContext';
import { useTheme } from '@/components/ThemeContext';
import { useAudioPlayer } from '@/contexts/AudioPlayerContext';
import { runAnalysisPipeline } from '@/engine/analysis-pipeline';
import { useResponsiveBoardSize } from '@/hooks/useResponsiveBoardSize';
import { detectGamePatterns, getThemeDescription } from '@/patterns/pattern-engine';
import { sendWithFallback, hasAnyProvider } from '@/ai/ai-router';
import { useActivePrompt } from '@/hooks/useActivePrompt';
import ExplanationText from '@/components/ExplanationText';
import ShareComposer from '@/components/share/ShareComposer';
import { useTutorial } from '@/contexts/TutorialContext';
import type { MoveAnalysis } from '@shared/types/analysis';
import { DataAttribution } from '@/components/PlatformBadge';
import PlayerAvatar from '@/components/PlayerAvatar';
import { useT } from '@/i18n/index';
import { Chess } from 'chess.js';
import type { Square } from 'chess.js';

export default function GameDetail() {
  const { gameId } = useParams<{ gameId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const initialMoveIndex = (location.state as { moveIndex?: number } | null)?.moveIndex;

  const { settings } = useTheme();
  const { state: audioState, controls: audioControls } = useAudioPlayer();
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
  const hasPatterns = gamePatterns.length > 0;
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

  // "Focus mode" — engaged whenever the user is viewing ANY played move.
  // The starting position (currentMoveIndex === -1) keeps the full chrome
  // so users can read the game header. Once they navigate to move 1+ (via
  // chips, the move list, or arrows) we collapse to the focus layout.
  // The user can override either way via the floating Focus toggle.
  const [focusOverride, setFocusOverride] = useState(false);
  const autoFocus = useMemo(() => currentMoveIndex >= 0, [currentMoveIndex]);
  const inFocusMode = autoFocus && !focusOverride;
  // Reset the manual override on EVERY navigation — when the active move
  // changes (new chip clicked, arrow stepped, etc.) we re-engage focus
  // mode automatically. Same when the trigger conditions flip off.
  useEffect(() => { setFocusOverride(false); }, [autoFocus, currentMoveIndex, insightTab, selectedPatternIdx]);
  // Toggle a body-level attribute so the bottom nav (in AppShell) can
  // slide out of view in focus mode. CSS rule lives in src/index.css.
  useEffect(() => {
    if (inFocusMode) document.body.setAttribute('data-focus-mode', 'true');
    else document.body.removeAttribute('data-focus-mode');
    return () => document.body.removeAttribute('data-focus-mode');
  }, [inFocusMode]);

  // Auto-generate AI explanation for notable moves — only when move is in the active tab
  useEffect(() => {
    if (!isMoveInActiveTab || !isNotableMove || !currentMove || !analysis || !game || !settings) return;
    const idx = currentMoveIndex;

    // Check cache first
    const cached = explanationCache.current.get(idx);
    if (cached) {
      setAiExplanation(cached);
      setAiExplanationLoading(false);
      return;
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
              for (const om of afterChess.moves({ verbose: true })) {
                if (om.to === to && om.captured) {
                  const attacker = afterChess.get(om.from as Square);
                  if (attacker) threats.push(`${PN[attacker.type] ?? attacker.type} on [${om.from}]`);
                }
              }
              if (threats.length > 0) {
                facts.push(`${name} on [${to}] can be captured by: ${threats.join(', ')}.`);
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
    );

    sendWithFallback(settings, prompt.system, [{ role: 'user', content: prompt.user }], 200)
      .then(text => {
        explanationCache.current.set(idx, text);
        setAiExplanation(text);
        setAiExplanationLoading(false);
      })
      .catch(() => {
        setAiExplanationLoading(false);
      });
  }, [currentMoveIndex, isNotableMove, isMoveInActiveTab]); // eslint-disable-line react-hooks/exhaustive-deps

  const bestMoveArrow = useMemo(() => {
    // When the current move is a notable one in the active insight tab
    // (key moment or pattern), automatically draw BOTH arrows:
    //   - Orange: the move the player actually made.
    //   - Green: Stockfish's recommended best move (if different).
    // No "Show best" toggle anymore — it's always visible in this context.
    if (!isMoveInActiveTab || !isNotableMove) return [];

    const analysisMov = analysis?.moves[currentMoveIndex];
    if (!analysisMov) return [];

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


  const handleAudioGenerate = () => {
    if (!game || !analysis || audioState.isGenerating) return;
    audioControls.generateGameAndPlay(settings, game, analysis);
  };

  const audioHasThisGame = !!(
    audioState.script &&
    audioState.script.source.type === 'game' &&
    audioState.script.source.gameId === gameId &&
    audioState.ttsData &&
    !audioState.isPlaying
  );

  /* ── Result indicator ── */
  const resultLabel: Record<string, string> = {
    win: 'text-chess-accent',
    loss: 'text-chess-blunder/80',
    draw: 'text-gray-400',
  };

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

    // On mobile, scroll the tab bar to top of viewport so board + content are visible
    if (window.innerWidth < 768 && insightTabsRef.current) {
      setTimeout(() => {
        insightTabsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 50);
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

  // Hoisted board / panel sizing for focus mode. Computing both with the
  // same constraints lets the explanation panel grow to fill any space
  // between the board and the dock — when the board is width-limited
  // (typical mobile), this kills the visible empty gap below the panel.
  const evalReserve = currentEval ? 32 : 0;
  const viewportSafe = (typeof window !== 'undefined' ? window.innerWidth : 1200) - 32 - evalReserve;
  // Same reservation used by the board-cap below: panel min (80) +
  // dock + focus toggle (40) + safe-area worst-case (50) + buffer (16).
  const focusBoardCap = inFocusMode
    ? Math.max(200, viewportHeight - (160 + dockHeight + 40 + 24 + 8))
    : Number.POSITIVE_INFINITY;
  const safeBoardWidth = Math.min(Math.max(boardSize, 200), Math.max(viewportSafe, 200), focusBoardCap);
  // Panel fills the gap between the rendered board and the dock. Its own
  // scrollbar handles long AI commentary. Min 160 so even on tiny viewports
  // the user always sees a few lines of explanation — 80px was leaving room
  // for only the header line. The board cap above reserves the same 160px
  // so the math stays consistent.
  const focusPanelMaxHeight = inFocusMode
    ? Math.max(160, viewportHeight - safeBoardWidth - dockHeight - 40 - 24 - 8)
    : undefined;

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
          {insightTab === 'patterns' && hasPatterns && gamePatterns.map((pattern, idx) => {
            const severityKey = pattern.totalCpLoss >= 400 ? 'detail_severity_high' as const : pattern.totalCpLoss >= 150 ? 'detail_severity_medium' as const : 'detail_severity_low' as const;
            const severity = t(severityKey);
            const sevColor = severityKey === 'detail_severity_high' ? 'text-chess-blunder' : severityKey === 'detail_severity_medium' ? 'text-chess-mistake' : 'text-chess-inaccuracy';
            const isSelected = selectedPatternIdx === idx;
            return (
              <button key={pattern.theme} onClick={() => { setSelectedPatternIdx(idx); jumpToMoveWithAnimation(gamePatterns[idx].moves[0]?.moveIndex); }} title={getThemeDescription(pattern.theme as Parameters<typeof getThemeDescription>[0])} className={`shrink-0 w-[140px] md:w-full rounded-xl p-2.5 text-start transition-all border ${isSelected ? 'border-chess-accent/40 bg-chess-accent/[0.06]' : 'border-white/[0.04] bg-white/[0.02] hover:border-white/[0.08]'}`}>
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
    <div className={`max-w-[1200px] mx-auto md:pt-6 ${inFocusMode ? 'pt-[1.5px]' : 'pt-4'}`}>

      {/* ══════ 1. HEADER — clean, consolidated ══════
           In Focus Mode (a key-moment / pattern move is active) the back
           button floats in the upper-left corner — slightly enlarged so it
           stays tappable when the rest of the header collapses. The full
           header (with opponent info) still appears on desktop in focus mode,
           but its inline back button is hidden to avoid duplicating the
           floating one. */}
      {inFocusMode && (
        <button
          onClick={() => navigate(-1)}
          aria-label="Back"
          className="fixed top-3 start-3 z-50 text-gray-300 hover:text-white bg-chess-surface/20 backdrop-blur-md border border-chess-border/30 shadow-lg p-2.5 rounded-lg active:bg-white/10 active:scale-95 transition-all"
        >
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" className="rtl:rotate-180"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
      )}
      <div className={`flex items-center gap-2 mb-4 ${inFocusMode ? 'hidden md:flex' : ''}`}>
        <button
          onClick={() => navigate(-1)}
          aria-label="Back"
          className={`text-gray-400 hover:text-white transition-colors p-2 -ml-2 rounded-lg active:bg-white/10 active:scale-95 ${inFocusMode ? 'hidden' : ''}`}
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
                {!inFocusMode && (
                  <div className="flex justify-end md:hidden mb-1">
                    <button onClick={() => setShowBoard(false)} className="text-xs text-gray-600 hover:text-gray-300 transition-colors">{t('detail_hide_board')}</button>
                  </div>
                )}

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
                    <div className="flex gap-0 justify-center w-full min-w-0 overflow-hidden">
                      {currentEval && (
                        <div className="shrink-0">
                          <EvalBar score={currentEval.score} scoreType={currentEval.scoreType} height={safeBoardWidth} />
                        </div>
                      )}
                      <div ref={containerRef} className="flex-1 min-w-0 overflow-hidden relative" style={{ maxWidth: safeBoardWidth }}>
                        <ThemedChessboard
                          position={currentFen}
                          boardOrientation={boardOrientation}
                          boardWidth={safeBoardWidth}
                          arePiecesDraggable={false}
                          customArrows={bestMoveArrow}
                          customSquareStyles={highlightedSquare ? { [highlightedSquare]: { backgroundColor: 'rgba(59,130,246,0.45)', boxShadow: 'inset 0 0 0 2px rgba(59,130,246,0.8)' } } : undefined}
                        />
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

                {/* Mobile order beneath the board:
                      1. AI move-insight explanation
                      2. Stats / Key Moments / Patterns tabs + chip gallery
                      3. Move list with prev/next arrows
                    Desktop layout (the sidebar below) is unchanged. */}

                {/* 1. AI MOVE INSIGHT — mobile only (desktop shows in sidebar)
                       Always rendered when a move is selected so the box
                       keeps its size; for non-notable moves it shows a
                       short "no commentary" message instead of disappearing.
                       In focus mode it caps to a max-height and scrolls
                       internally so the page itself stays scroll-free. */}
                <div
                  className={`md:hidden ${inFocusMode ? 'overflow-y-auto' : ''}`}
                  style={inFocusMode ? { maxHeight: focusPanelMaxHeight } : undefined}
                >
                  {currentMove && (
                    <MoveInsightPanel
                      move={currentMove}
                      aiExplanation={aiExplanation}
                      aiExplanationLoading={aiExplanationLoading}
                      hasCommentary={isMoveInActiveTab && isNotableMove}
                      onSquareClick={(sq) => setHighlightedSquare(prev => prev === sq ? null : sq)}
                    />
                  )}
                </div>

                {/* Spacer reserving room for the fixed bottom dock below —
                    only when the dock is fixed (focus mode). Uses the
                    live measured dock height + focus toggle bar (40px) +
                    safe-area inset so flowing content cleanly meets the
                    top edge of the dock on every device. */}
                {inFocusMode && (
                  <div
                    aria-hidden
                    className="md:hidden"
                    style={{ height: `calc(env(safe-area-inset-bottom) + ${dockHeight + 40}px)` }}
                  />
                )}

                {/* 2 + 3. INSIGHT TABS + CHIP GALLERY, then MOVE LIST with nav arrows.
                       In focus mode the dock is fixed above the focus toggle so
                       Key Moments + focus stripe stay visible while explanation
                       content scrolls. Otherwise it renders inline below the
                       insight panel. The ref measures the dock's actual
                       rendered height so the board cap above can subtract
                       the right amount and the panel never gets clipped. */}
                <div
                  ref={inFocusMode ? dockRef : undefined}
                  className={
                    inFocusMode
                      ? 'md:hidden fixed left-0 right-0 z-30 px-3 pt-2 pb-1.5 bg-chess-bg/95 backdrop-blur-sm border-t border-white/[0.04]'
                      : 'md:hidden mt-3'
                  }
                  style={
                    inFocusMode
                      ? { bottom: 'calc(env(safe-area-inset-bottom) + 40px)' }
                      : undefined
                  }
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
                      <MoveList moves={analysis.moves} currentMoveIndex={currentMoveIndex} onMoveClick={setCurrentMoveIndex} />
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
            </>
          )}
        </div>

        {/* ── Sidebar (LEFT on desktop) — Stats / Key Moments / Patterns + CTAs ── */}
        <div className="md:flex-[2] md:min-w-[280px] md:max-w-[380px] mt-3 md:mt-0 md:order-1 hidden md:flex md:flex-col">
          {/* Insights at top */}
          {insightsPanel && <div>{insightsPanel}</div>}

          {/* Move insight panel — desktop. Always rendered when there is
              a current move so the layout stays stable while scrubbing. */}
          {analysis && currentMove && (
            <MoveInsightPanel
              move={currentMove}
              aiExplanation={aiExplanation}
              aiExplanationLoading={aiExplanationLoading}
              hasCommentary={isMoveInActiveTab && isNotableMove}
              onSquareClick={(sq) => setHighlightedSquare(prev => prev === sq ? null : sq)}
            />
          )}

          {/* CTAs pinned to the bottom, aligned with board nav arrows */}
          {analysis && (
            <div className="mt-auto pt-4 grid grid-cols-4 gap-2">
              <button
                onClick={() => navigate('/timemachine', { state: { gameFilter: gameId, returnTo: { path: `/games/${gameId}`, moveIndex: currentMoveIndex } } })}
                className="bg-white/[0.03] rounded-xl p-3 text-center border border-white/[0.04] hover:border-chess-accent/30 hover:bg-white/[0.05] transition-all group"
              >
                <div className="mb-0.5 opacity-70 group-hover:opacity-100 transition-opacity flex justify-center"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400"><path d="M5 22h14"/><path d="M5 2h14"/><path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22"/><path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"/></svg></div>
                <div className="text-xs font-semibold text-white">{t('detail_practice_cta')}</div>
                {hasPatterns && <div className="text-[10px] text-gray-500 mt-0.5">{t('detail_practice_sub', { count: gamePatterns.reduce((sum, p) => sum + p.moves.length, 0) })}</div>}
              </button>
              <button
                onClick={() => { if (audioHasThisGame) audioControls.play(); else handleAudioGenerate(); }}
                disabled={audioState.isGenerating}
                className="bg-white/[0.03] rounded-xl p-3 text-center border border-white/[0.04] hover:border-chess-accent/30 hover:bg-white/[0.05] transition-all group disabled:opacity-50"
              >
                {audioState.isGenerating ? (
                  <div className="text-lg mb-0.5"><span className="inline-block w-4 h-4 border-2 border-chess-accent border-t-transparent rounded-full animate-spin" /></div>
                ) : (
                  <div className="mb-0.5 opacity-70 group-hover:opacity-100 transition-opacity flex justify-center"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400"><path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/></svg></div>
                )}
                <div className="text-xs font-semibold text-white">{audioHasThisGame ? t('detail_replay_audio') : t('detail_listen')}</div>
                <div className="text-[10px] text-gray-500 mt-0.5">{t('detail_listen_sub')}</div>
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

      {/* ── ACTION CTAs — mobile only (desktop shows in sidebar) ── */}
      {analysis && (
        <div className="grid grid-cols-4 gap-2 mt-5 mb-8 md:hidden">
          {/* Practice → TimeMachine filtered to this game */}
          <button
            onClick={() => navigate('/timemachine', { state: { gameFilter: gameId, returnTo: { path: `/games/${gameId}`, moveIndex: currentMoveIndex } } })}
            className="bg-white/[0.03] rounded-xl p-3 text-center border border-white/[0.04] hover:border-chess-accent/30 hover:bg-white/[0.05] transition-all group"
          >
            <div className="mb-0.5 opacity-70 group-hover:opacity-100 transition-opacity flex justify-center"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400"><path d="M5 22h14"/><path d="M5 2h14"/><path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22"/><path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"/></svg></div>
            <div className="text-xs font-semibold text-white">{t('detail_practice_cta')}</div>
          </button>

          {/* Listen → generate/play audio recap */}
          <button
            onClick={() => {
              if (audioHasThisGame) audioControls.play();
              else handleAudioGenerate();
            }}
            disabled={audioState.isGenerating}
            className="bg-white/[0.03] rounded-xl p-3 text-center border border-white/[0.04] hover:border-chess-accent/30 hover:bg-white/[0.05] transition-all group disabled:opacity-50"
          >
            {audioState.isGenerating ? (
              <div className="text-lg mb-0.5"><span className="inline-block w-4 h-4 border-2 border-chess-accent border-t-transparent rounded-full animate-spin" /></div>
            ) : (
              <div className="mb-0.5 opacity-70 group-hover:opacity-100 transition-opacity flex justify-center"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400"><path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/></svg></div>
            )}
            <div className="text-xs font-semibold text-white">{audioHasThisGame ? t('detail_replay_audio') : t('detail_listen')}</div>
          </button>

          {/* Compare → auto-start comparison with opponent */}
          <button
            onClick={() => navigate('/compare', { state: { autoCompare: game.opponent.username } })}
            className="bg-white/[0.03] rounded-xl p-3 text-center border border-white/[0.04] hover:border-chess-accent/30 hover:bg-white/[0.05] transition-all group"
          >
            <div className="mb-0.5 opacity-70 group-hover:opacity-100 transition-opacity flex justify-center"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400"><rect x="3" y="10" width="4" height="11" rx="1"/><rect x="10" y="4" width="4" height="17" rx="1"/><rect x="17" y="8" width="4" height="13" rx="1"/></svg></div>
            <div className="text-xs font-semibold text-white">{t('detail_compare')}</div>
          </button>

          {/* Share → open share composer */}
          <button
            onClick={() => { setShareMove(analysis && currentMoveIndex >= 0 ? analysis.moves[currentMoveIndex] ?? null : null); setShareOpen(true); }}
            className="bg-white/[0.03] rounded-xl p-3 text-center border border-white/[0.04] hover:border-chess-accent/30 hover:bg-white/[0.05] transition-all group"
          >
            <div className="mb-0.5 opacity-70 group-hover:opacity-100 transition-opacity flex justify-center"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg></div>
            <div className="text-xs font-semibold text-white">{t('detail_share') ?? 'Share'}</div>
          </button>
        </div>
      )}
      <DataAttribution />

      {/* Focus-mode toggle — only rendered while focus mode is ON, so it
          acts purely as an "exit focus" affordance. To re-enter focus the
          user just clicks another move/chip (autoFocus kicks back in via
          the reset effect above). */}
      {inFocusMode && (
        <>
          {/* Full-width bottom bar — visual "floor" that replaces the
              hidden bottom nav. 40px tall (plus safe-area). */}
          <div
            aria-hidden
            className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-chess-bg/98 backdrop-blur-md border-t border-chess-border/30 shadow-[0_-4px_16px_rgba(0,0,0,0.15)] pb-[env(safe-area-inset-bottom)]"
            style={{ height: 'calc(env(safe-area-inset-bottom) + 40px)' }}
          />
          {/* The pill itself — vertically centered inside the 40px bar
              ((40 - 26) / 2 = 7px above safe-area). */}
          <button
            onClick={() => setFocusOverride(true)}
            role="switch"
            aria-checked={true}
            aria-label="Exit focus mode"
            className="md:hidden fixed left-1/2 -translate-x-1/2 z-50 select-none rounded-full shadow-md focus:outline-none focus:ring-2 focus:ring-chess-accent/40"
            style={{
              bottom: 'calc(env(safe-area-inset-bottom) + 7px)',
              background: 'linear-gradient(135deg, #4ade80 0%, #22c55e 100%)',
              width: 96,
              height: 26,
              position: 'fixed',
            }}
          >
            <span
              className="absolute top-0.5 w-[22px] h-[22px] rounded-full bg-white shadow-md"
              style={{ left: 'calc(100% - 24px)' }}
            />
            <span
              className="absolute inset-0 flex items-center justify-center text-[10px] font-bold uppercase tracking-[2px] pointer-events-none"
              style={{ color: '#0a3517' }}
            >
              Focus
            </span>
          </button>
        </>
      )}

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
      className={`inline-flex items-center tabular-nums ${sizeCls} ${toneCls}`}
      title={title}
      dir="ltr"
    >
      {children}
    </span>
  );
}

/** Joins an array of pills with subtle dot separators. */
function joinWithDots(
  items: Array<React.ReactNode | false | null | undefined>,
  size: 'sm' | 'md',
): React.ReactNode {
  const visible = items.filter(Boolean) as React.ReactNode[];
  const dotCls =
    size === 'sm' ? 'text-[11px] text-gray-700' : 'text-[13px] text-gray-700';
  return visible.map((el, i) => (
    <span key={i} className="inline-flex items-center gap-1.5">
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
}: {
  move: MoveAnalysis;
  aiExplanation: string | null;
  aiExplanationLoading: boolean;
  /** True when this move qualifies for AI commentary (key moment / pattern).
   *  When false, the panel still renders at the same size but shows a
   *  short "no commentary on this move" placeholder instead of skeleton/text. */
  hasCommentary?: boolean;
  onSquareClick: (sq: string) => void;
}) {
  const { t } = useT();

  // Build structured facts — each one becomes its own pill so we can style
  // tactical motifs, clock warnings, and the phase chip independently.
  const motifLabel = move.tacticalMotifs?.length
    ? (() => {
        const key = `pattern_${move.tacticalMotifs[0].replace(/\s+/g, '_')}` as Parameters<typeof t>[0];
        const v = t(key);
        return v !== key ? v : move.tacticalMotifs[0].replace(/_/g, ' ');
      })()
    : null;
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
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          <span className={`text-sm font-bold ${qualityColor}`}>{qualityLabel}</span>
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
              motifLabel && (
                <StatPill size="sm" tone="accent">
                  {motifLabel}
                </StatPill>
              ),
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
                motifLabel && (
                  <StatPill size="md" tone="accent">
                    {motifLabel}
                  </StatPill>
                ),
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
          <ExplanationText text={aiExplanation} onSquareClick={onSquareClick} />
        </div>
      )}
    </div>
  );
}


import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { OPENAI_TTS_VOICES, OPENAI_TTS_ENDPOINT, TTS_SPEAKER_A_INSTRUCTIONS, TTS_SPEAKER_B_INSTRUCTIONS } from '@shared/constants';
import type { TokenUsage } from '@shared/types/storage';
import { DEFAULT_TOKEN_USAGE } from '@shared/types/storage';
import { getTokenUsage, resetTokenUsage } from '@/storage/settings-store';
import type { TimeClass as _TimeClass } from '@shared/types/game';
import type { PositionEval } from '@shared/types/engine';
import { useTheme } from '@/components/ThemeContext';
import { useT, SUPPORTED_LANGUAGES } from '@/i18n/index';
import { useChessData } from '@/contexts/ChessDataContext';
import { ChessComBadge, LichessBadge, DataAttribution } from '@/components/PlatformBadge';
import { importLichessGames } from '@/api/lichess-import';
import { splitMultiGamePgn, parsePgnToGameRecord } from '@shared/utils/chess-utils';
import { BOARD_THEMES } from '@/components/board-themes';
import ThemedChessboard from '@/components/ThemedChessboard';
import { recognizePosition, resizeImageForAPI } from '@/ai/position-recognizer';
import { StockfishClient } from '@/engine/stockfish-client';
import { hasAnyProvider } from '@/ai/ai-router';
import { AUDIO_SYSTEM_PROMPT_DEFAULT } from '@/ai/prompt-builder';
import { uciToSan } from '@shared/utils/chess-utils';
import { base44 } from '../api/base44Client';
import { importChessComGames } from '@/api/chess-com-import';
import { deleteAccountData, type DeleteProgress } from '@/utils/account-delete';

type PositionPhase = 'idle' | 'recognizing' | 'recognized' | 'analyzing' | 'complete' | 'error';

export default function Settings() {
  const { theme, boardTheme, setTheme, setBoardTheme, settings, updateSettings, isAdmin } = useTheme();
  const { t: tFunc } = useT();
  const [tokenUsage, setTokenUsage] = useState<TokenUsage>(DEFAULT_TOKEN_USAGE);

  // Load actual token usage on mount
  useEffect(() => {
    getTokenUsage().then(setTokenUsage);
  }, []);
  const { allGames: _allGames, availableTimeClasses, refetchGames } = useChessData();
  const [showApiKey, setShowApiKey] = useState<Record<string, boolean>>({});
  const [tempApiKey, setTempApiKey] = useState<Record<string, string>>({});
  const [importTimeClass, setImportTimeClass] = useState('rapid');
  const [importState, setImportState] = useState<{
    phase: 'idle' | 'fetching' | 'analyzing' | 'done';
    fetched: number;
    total: number;
    error?: string;
  }>({ phase: 'idle', fetched: 0, total: 0 });

  // Lichess import state
  const [lichessImportState, setLichessImportState] = useState<{
    phase: 'idle' | 'fetching' | 'done';
    fetched: number;
    total: number;
    error?: string;
  }>({ phase: 'idle', fetched: 0, total: 0 });

  // Manual PGN import state
  const [pgnText, setPgnText] = useState('');
  const [pgnImportState, setPgnImportState] = useState<{
    phase: 'idle' | 'importing' | 'done';
    imported: number;
    total: number;
    error?: string;
  }>({ phase: 'idle', imported: 0, total: 0 });
  const [pgnGuideOpen, setPgnGuideOpen] = useState(false);

  // Position analysis state
  const [posPhase, setPosPhase] = useState<PositionPhase>('idle');
  const [posFen, setPosFen] = useState('');
  const [posError, setPosError] = useState<string | null>(null);
  const [posEval, setPosEval] = useState<PositionEval | null>(null);
  const [manualFen, setManualFen] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Handle paste events for image recognition
  useEffect(() => {
    const handlePaste = async (e: ClipboardEvent) => {
      if (!hasAnyProvider(settings)) return;
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          const blob = item.getAsFile();
          if (blob) handleImageFile(blob);
          return;
        }
      }
    };
    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [settings]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleImageFile = useCallback(async (file: File | Blob) => {
    setPosPhase('recognizing');
    setPosError(null);
    setPosEval(null);
    try {
      const { base64, mediaType } = await resizeImageForAPI(file);
      const result = await recognizePosition(settings, base64, mediaType);
      if (result.isValid) {
        setPosFen(result.fen);
        setManualFen(result.fen);
        setPosPhase('recognized');
      } else {
        setPosError(result.error || 'Could not recognize position');
        setPosPhase('error');
      }
    } catch (err) {
      setPosError(err instanceof Error ? err.message : 'Recognition failed');
      setPosPhase('error');
    }
  }, [settings]);

  const handleAnalyzePosition = useCallback(async () => {
    const fenToAnalyze = posFen || manualFen;
    if (!fenToAnalyze) return;
    setPosPhase('analyzing');
    setPosError(null);
    try {
      const client = StockfishClient.getInstance();
      await client.initialize();
      const result = await client.analyzePosition(fenToAnalyze, settings.analysisDepth);
      // Convert best move to SAN
      const bestMoveSan = uciToSan(fenToAnalyze, result.bestMove);
      setPosEval({ ...result, bestMoveSan });
      setPosFen(fenToAnalyze);
      setPosPhase('complete');
    } catch (err) {
      setPosError(err instanceof Error ? err.message : 'Analysis failed');
      setPosPhase('error');
    }
  }, [posFen, manualFen, settings.analysisDepth]);

  const handleManualFenSubmit = useCallback(() => {
    if (!manualFen.trim()) return;
    setPosFen(manualFen.trim());
    setPosPhase('recognized');
    setPosError(null);
    setPosEval(null);
  }, [manualFen]);

  const resetPosition = useCallback(() => {
    setPosPhase('idle');
    setPosFen('');
    setPosEval(null);
    setPosError(null);
    setManualFen('');
  }, []);

  // Voice preview state
  const [previewingVoice, setPreviewingVoice] = useState<string | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);

  const previewVoice = useCallback(async (voice: string, speaker: 'A' | 'B') => {
    if (!settings.openaiApiKey) return;
    // Stop any currently playing preview
    if (previewAudioRef.current) {
      previewAudioRef.current.pause();
      URL.revokeObjectURL(previewAudioRef.current.src);
      previewAudioRef.current = null;
    }
    setPreviewingVoice(voice);
    try {
      const sampleText = speaker === 'A'
        ? 'Welcome to your chess game review! Let\'s dive into the key moments.'
        : 'Oh WOW, what a BRILLIANT sacrifice! This changes EVERYTHING!';
      const instructions = speaker === 'A' ? TTS_SPEAKER_A_INSTRUCTIONS : TTS_SPEAKER_B_INSTRUCTIONS;
      const body: Record<string, unknown> = {
        model: settings.ttsModel || 'gpt-4o-mini-tts',
        input: sampleText,
        voice,
        response_format: 'mp3',
      };
      if (settings.ttsModel?.includes('gpt-4o')) {
        body.instructions = instructions;
      }
      const res = await fetch(OPENAI_TTS_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${settings.openaiApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`TTS error ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      previewAudioRef.current = audio;
      audio.onended = () => {
        URL.revokeObjectURL(url);
        previewAudioRef.current = null;
        setPreviewingVoice(null);
      };
      await audio.play();
      // Audio is playing — onended will handle cleanup
    } catch (err) {
      console.error('[Chess DNA] Voice preview failed:', err);
      setPreviewingVoice(null);
    }
  }, [settings.openaiApiKey, settings.ttsModel]);

  const handleImportGames = async () => {
    if (!settings.chesscomUsername) return;
    setImportState({ phase: 'fetching', fetched: 0, total: 0 });

    try {
      const newGameIds = await importChessComGames(settings.chesscomUsername, {
        timeClass: importTimeClass === 'all' ? 'all' : importTimeClass as any,
        maxGames: 20,
        onProgress: (progress) => {
          setImportState({
            phase: progress.done ? 'done' : 'fetching',
            fetched: progress.fetched,
            total: progress.total,
            error: progress.error,
          });
        },
      });

      if (newGameIds.length > 0) {
        setImportState((prev) => ({
          ...prev,
          phase: 'done',
          error: undefined,
        }));
      }
    } catch (err) {
      setImportState({
        phase: 'done',
        fetched: 0,
        total: 0,
        error: `Import failed: ${String(err)}`,
      });
    }
  };

  const handleLichessImport = async () => {
    if (!settings.lichessUsername) return;
    setLichessImportState({ phase: 'fetching', fetched: 0, total: 0 });
    try {
      const newGameIds = await importLichessGames(settings.lichessUsername, {
        maxGames: 20,
        timeClass: importTimeClass === 'all' ? 'all' : importTimeClass as any,
        onProgress: (p) => {
          setLichessImportState({
            phase: p.phase === 'done' || p.phase === 'error' ? 'done' : 'fetching',
            fetched: p.fetched,
            total: p.total,
            error: p.error,
          });
        },
      });
      if (newGameIds.length > 0) {
        setLichessImportState(prev => ({ ...prev, phase: 'done', error: undefined }));
        refetchGames();
      }
    } catch (err) {
      setLichessImportState({ phase: 'done', fetched: 0, total: 0, error: `Import failed: ${String(err)}` });
    }
  };

  const handlePgnImport = async () => {
    if (!pgnText.trim()) return;
    setPgnImportState({ phase: 'importing', imported: 0, total: 0 });

    const pgns = splitMultiGamePgn(pgnText);
    if (pgns.length === 0) {
      setPgnImportState({ phase: 'done', imported: 0, total: 0, error: 'No valid PGN games found. Make sure each game starts with [Event "..."]' });
      return;
    }

    // Use configured username, or try to detect from the first PGN's Site header
    // Build a set of existing game fingerprints for dedup
    const existingFingerprints = new Set<string>();
    for (const g of _allGames) {
      // Fingerprint: white+black+date+moves (robust across different game IDs)
      const fp = `${g.player?.username?.toLowerCase() ?? ''}|${g.opponent?.username?.toLowerCase() ?? ''}|${g.totalMoves}|${new Date(g.playedAt).toISOString().slice(0, 10)}`;
      existingFingerprints.add(fp);
      // Also add reversed (in case player/opponent are swapped)
      const fpRev = `${g.opponent?.username?.toLowerCase() ?? ''}|${g.player?.username?.toLowerCase() ?? ''}|${g.totalMoves}|${new Date(g.playedAt).toISOString().slice(0, 10)}`;
      existingFingerprints.add(fpRev);
    }

    const username = settings.chesscomUsername ?? settings.lichessUsername ?? (() => {
      // Try to find "Yuvalinc" or similar from PGN headers by checking which name appears most
      const names = new Map<string, number>();
      for (const p of pgns) {
        const whiteMatch = p.match(/\[White\s+"([^"]+)"\]/);
        const blackMatch = p.match(/\[Black\s+"([^"]+)"\]/);
        if (whiteMatch) names.set(whiteMatch[1], (names.get(whiteMatch[1]) ?? 0) + 1);
        if (blackMatch) names.set(blackMatch[1], (names.get(blackMatch[1]) ?? 0) + 1);
      }
      // The player is likely the name that appears in ALL games
      let best = 'Player';
      let bestCount = 0;
      for (const [n, c] of names) {
        if (c > bestCount) { best = n; bestCount = c; }
      }
      console.log(`[PGN Import] Auto-detected username: "${best}" (appeared in ${bestCount}/${pgns.length} games)`);
      return best;
    })();
    const entities = (base44.entities as Record<string, any>);
    let imported = 0;
    let skipped = 0;

    for (let i = 0; i < pgns.length; i++) {
      const game = parsePgnToGameRecord(pgns[i], '', username);
      if (!game) continue;

      // Check for duplicates using fingerprint
      const fp = `${game.player.username.toLowerCase()}|${game.opponent.username.toLowerCase()}|${game.totalMoves}|${new Date(game.playedAt).toISOString().slice(0, 10)}`;
      if (existingFingerprints.has(fp)) {
        console.log(`[PGN Import] Skipping duplicate: ${game.player.username} vs ${game.opponent.username} (${game.totalMoves} moves)`);
        skipped++;
        setPgnImportState({ phase: 'importing', imported: i + 1, total: pgns.length });
        continue;
      }

      try {
        await entities.Game.create({
          gameId: game.id,
          url: game.url || '',
          pgn: game.pgn,
          player: game.player,
          opponent: game.opponent,
          timeClass: game.timeClass,
          timeControl: game.timeControl,
          opening: game.opening,
          totalMoves: game.totalMoves,
          playedAt: game.playedAt,
          analyzedAt: null,
          analysisStatus: 'pending',
        });
        imported++;
        existingFingerprints.add(fp);
      } catch (err) {
        console.warn('[PGN Import] Failed to save game:', err);
      }
      setPgnImportState({ phase: 'importing', imported: i + 1, total: pgns.length });
    }

    const msg = skipped > 0 && imported === 0
      ? `All ${skipped} game${skipped !== 1 ? 's' : ''} already exist.`
      : skipped > 0
        ? `${imported} imported, ${skipped} already existed.`
        : undefined;

    setPgnImportState({ phase: 'done', imported, total: pgns.length, error: skipped > 0 && imported === 0 ? msg : undefined });
    if (imported > 0) {
      setPgnText('');
      setTimeout(() => refetchGames(), 500);
    }
  };

  const handlePgnFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') setPgnText(reader.result);
    };
    reader.readAsText(file);
    e.target.value = ''; // reset to allow re-upload
  };

  const handleSaveApiKey = async (provider: string) => {
    const key = tempApiKey[provider] || '';
    if (!key) return;
    const fieldMap: Record<string, string> = { claude: 'claudeApiKey', openai: 'openaiApiKey', gemini: 'geminiApiKey' };
    await updateSettings({ [fieldMap[provider]]: key });
    setTempApiKey(prev => ({ ...prev, [provider]: '' }));
  };

  const handleClearApiKey = async (provider: string) => {
    const fieldMap: Record<string, string> = { claude: 'claudeApiKey', openai: 'openaiApiKey', gemini: 'geminiApiKey' };
    await updateSettings({ [fieldMap[provider]]: null });
  };

  // Estimated cost calculation
  const estimatedCost = useMemo(() => {
    // Rough average pricing across providers (Claude Sonnet ballpark)
    const inputCostPerM = 3; // $3 per million input tokens
    const outputCostPerM = 15; // $15 per million output tokens
    const inputCost = (tokenUsage.totalInputTokens / 1_000_000) * inputCostPerM;
    const outputCost = (tokenUsage.totalOutputTokens / 1_000_000) * outputCostPerM;
    return (inputCost + outputCost).toFixed(2);
  }, [tokenUsage]);

  const [settingsTab, setSettingsTab] = useState<'profile' | 'ai' | 'settings' | 'analytics'>('profile');

  const handleLogout = useCallback(() => {
    base44.auth.logout();
  }, []);

  // ─── Account deletion ───
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteProgress, setDeleteProgress] = useState<DeleteProgress | null>(null);

  const handleDeleteAccount = useCallback(async () => {
    if (deleteConfirmText !== 'DELETE') return;
    setDeleting(true);
    try {
      await deleteAccountData((p) => setDeleteProgress(p));
      // deleteAccountData's last step is base44.auth.logout('/'), which starts
      // a cross-origin navigation to the Base44 logout endpoint. The old code
      // scheduled a 500ms `href = '/'` fallback, but that reliably raced and
      // *overwrote* the logout redirect before Base44 cleared the session
      // cookie — so users could log straight back in. Wait 5s before firing
      // the fallback; by then the logout round-trip has definitely completed
      // (or genuinely failed, in which case we do want a hard reload).
      setTimeout(() => { window.location.href = '/'; }, 5000);
    } catch (err) {
      console.error('[Chess DNA] Account deletion failed:', err);
      setDeleting(false);
      alert('Something went wrong while deleting your account. Please try again or contact support.');
    }
  }, [deleteConfirmText]);

  return (
    <div className="max-w-2xl">
      <h2 className="text-xl font-bold mb-4">{tFunc('settings_profile')}</h2>

      {/* Tab bar */}
      <div className="flex gap-1 mb-5 border-b border-chess-border/30 pb-2">
        {([
          { id: 'profile' as const, label: `\u{1F464} ${tFunc('settings_tab_profile')}` },
          ...(isAdmin ? [{ id: 'ai' as const, label: `\u{1F916} ${tFunc('settings_tab_ai')}` }] : []),
          { id: 'settings' as const, label: `\u2699\uFE0F ${tFunc('settings_tab_settings')}` },
          ...(isAdmin ? [{ id: 'analytics' as const, label: `\u{1F4CA} ${tFunc('settings_tab_analytics')}` }] : []),
        ]).map((t) => (
          <button
            key={t.id}
            onClick={() => setSettingsTab(t.id)}
            className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-all ${
              settingsTab === t.id
                ? 'bg-chess-accent/10 text-chess-accent border border-chess-accent/20'
                : 'text-gray-500 hover:text-chess-text-secondary hover:bg-white/[0.03] border border-transparent'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Profile tab */}
      {settingsTab === 'profile' && (
        <>
          <Section title={<span className="flex items-center gap-2">{tFunc('settings_chess_com')} <ChessComBadge size="xs" /></span>}>
            <div className="flex items-center gap-3">
              <label className="text-sm text-gray-400 w-32">Username</label>
              <input
                type="text"
                value={settings.chesscomUsername ?? ''}
                onChange={(e) =>
                  updateSettings({ chesscomUsername: e.target.value || null })
                }
                placeholder="Auto-detected from games"
                className="bg-chess-surface border border-chess-border rounded px-3 py-1.5 text-sm flex-1 text-chess-text"
              />
            </div>
          </Section>

          {settings.chesscomUsername && (
            <Section title={tFunc('settings_import_games')}>
              <div className="space-y-3">
                <p className="text-xs text-gray-400">
                  Fetch more games from chess.com for <span className="text-chess-accent font-bold">{settings.chesscomUsername}</span>
                </p>

                {/* Time class picker */}
                <div className="flex gap-1.5">
                  {(['rapid', 'blitz', 'bullet', 'daily'] as const).map(tc => {
                    const hasGames = availableTimeClasses.has(tc);
                    return (
                      <button
                        key={tc}
                        onClick={() => setImportTimeClass(tc)}
                        disabled={importState.phase === 'fetching' || importState.phase === 'analyzing'}
                        className={`px-3 py-1.5 rounded text-xs font-medium capitalize transition-colors flex items-center gap-1.5 ${
                          importTimeClass === tc
                            ? 'bg-chess-accent/15 text-chess-accent border border-chess-accent/30'
                            : 'bg-chess-surface border border-chess-border/30 text-chess-text-secondary hover:text-chess-text'
                        } disabled:opacity-40`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full ${hasGames ? 'bg-chess-accent' : 'bg-gray-500/40'}`} />
                        {tc}
                      </button>
                    );
                  })}
                </div>

                {/* Import button */}
                <button
                  onClick={handleImportGames}
                  disabled={importState.phase === 'fetching' || importState.phase === 'analyzing'}
                  className="bg-chess-accent text-chess-bg px-4 py-1.5 rounded text-sm font-bold hover:brightness-110 transition-all disabled:opacity-50"
                >
                  {importState.phase === 'fetching' || importState.phase === 'analyzing' ? 'Importing...' : 'Import Games'}
                </button>

                {/* Progress / status */}
                {importState.phase === 'fetching' && (
                  <div className="bg-chess-surface/50 rounded-lg p-3 border border-chess-border/30">
                    <div className="flex justify-between text-[11px] text-chess-text-secondary mb-2">
                      <span>Importing {importTimeClass} games...</span>
                      <span>{importState.fetched}{importState.total > 0 ? ` / ${importState.total}` : ''}</span>
                    </div>
                    <div className="w-full bg-chess-muted/60 rounded-full h-1.5 overflow-hidden">
                      <div
                        className="bg-chess-accent h-full rounded-full transition-all duration-500"
                        style={{ width: importState.total > 0 ? `${(importState.fetched / importState.total) * 100}%` : '30%' }}
                      />
                    </div>
                  </div>
                )}

                {importState.phase === 'analyzing' && (
                  <div className="bg-chess-surface/50 rounded-lg p-3 border border-chess-border/30">
                    <p className="text-xs text-chess-text-secondary animate-pulse">
                      Analyzing {importState.fetched} game{importState.fetched !== 1 ? 's' : ''} with Stockfish...
                    </p>
                  </div>
                )}

                {importState.phase === 'done' && importState.error && (
                  <p className="text-xs text-chess-blunder">{importState.error}</p>
                )}

                {importState.phase === 'done' && !importState.error && (
                  <p className="text-xs text-chess-accent">
                    {importState.fetched} game{importState.fetched !== 1 ? 's' : ''} imported and analyzed!
                  </p>
                )}
              </div>
            </Section>
          )}

          {/* ── Lichess ── */}
          <Section title={<span className="flex items-center gap-2">Lichess <LichessBadge size="xs" /></span>}>
            <div className="flex items-center gap-3 mb-3">
              <label className="text-sm text-gray-400 w-32">Username</label>
              <input
                type="text"
                value={settings.lichessUsername ?? ''}
                onChange={(e) => updateSettings({ lichessUsername: e.target.value || null })}
                placeholder="Your Lichess username"
                className="bg-chess-surface border border-chess-border rounded px-3 py-1.5 text-sm flex-1 text-chess-text"
              />
            </div>
            {settings.lichessUsername && (
              <div className="space-y-2">
                <button
                  onClick={handleLichessImport}
                  disabled={lichessImportState.phase === 'fetching'}
                  className="bg-chess-accent text-chess-bg px-4 py-1.5 rounded text-sm font-bold hover:brightness-110 transition-all disabled:opacity-50"
                >
                  {lichessImportState.phase === 'fetching' ? 'Importing...' : 'Import Lichess Games'}
                </button>
                {lichessImportState.phase === 'done' && !lichessImportState.error && (
                  <p className="text-xs text-chess-accent">{lichessImportState.fetched} game{lichessImportState.fetched !== 1 ? 's' : ''} imported!</p>
                )}
                {lichessImportState.error && (
                  <p className="text-xs text-chess-blunder">{lichessImportState.error}</p>
                )}
              </div>
            )}
          </Section>

          {/* ── Manual PGN Upload ── */}
          <Section title="Manual Import (PGN)">
            <div className="space-y-3">
              {/* Instructions accordion */}
              <button
                onClick={() => setPgnGuideOpen(!pgnGuideOpen)}
                className="text-xs text-chess-accent hover:underline flex items-center gap-1"
              >
                <span>{pgnGuideOpen ? '▾' : '▸'}</span>
                How to export your games as PGN
              </button>
              {pgnGuideOpen && (
                <div className="bg-chess-surface/50 rounded-lg p-3 border border-chess-border/30 text-[11px] text-gray-400 space-y-2">
                  <div>
                    <span className="font-bold text-gray-300">Chess.com:</span> Go to <a href="https://www.chess.com/games/archive" target="_blank" rel="noopener noreferrer" className="text-chess-accent underline hover:brightness-125">chess.com/games/archive</a> → Select games → Click "Download" → Choose PGN format
                  </div>
                  <div>
                    <span className="font-bold text-gray-300">Lichess:</span> Go to <a href="https://lichess.org" target="_blank" rel="noopener noreferrer" className="text-chess-accent underline hover:brightness-125">lichess.org/@/your-username</a> → Click the games count → "Download" → PGN
                  </div>
                  <div>
                    <span className="font-bold text-gray-300">Other platforms:</span> Look for "Export" or "Download PGN" in your game history. Most chess apps support PGN export.
                  </div>
                  <div className="text-gray-500 italic">
                    You can upload a single game or a bulk file with multiple games. Each game must start with [Event "..."].
                  </div>
                </div>
              )}

              {/* File upload */}
              <div className="flex gap-2">
                <label className="bg-chess-surface border border-chess-border/30 px-3 py-1.5 rounded text-sm text-gray-400 cursor-pointer hover:text-chess-text transition-colors">
                  Upload .pgn file
                  <input type="file" accept=".pgn" onChange={handlePgnFileUpload} className="hidden" />
                </label>
              </div>

              {/* PGN textarea */}
              <textarea
                value={pgnText}
                onChange={e => setPgnText(e.target.value)}
                placeholder={'Paste PGN here...\n\n[Event "Rated Blitz"]\n[White "Player1"]\n[Black "Player2"]\n...\n1. e4 e5 2. Nf3 ...'}
                rows={6}
                className="w-full bg-chess-surface border border-chess-border/30 rounded px-3 py-2 text-[11px] font-mono text-chess-text placeholder:text-gray-600 resize-y"
              />

              {/* Import button */}
              <button
                onClick={handlePgnImport}
                disabled={!pgnText.trim() || pgnImportState.phase === 'importing'}
                className="bg-chess-accent text-chess-bg px-4 py-1.5 rounded text-sm font-bold hover:brightness-110 transition-all disabled:opacity-50"
              >
                {pgnImportState.phase === 'importing' ? `Importing ${pgnImportState.imported}/${pgnImportState.total}...` : 'Import PGN Games'}
              </button>

              {/* Status */}
              {pgnImportState.phase === 'done' && pgnImportState.imported > 0 && (
                <p className="text-xs text-chess-accent">{pgnImportState.imported} game{pgnImportState.imported !== 1 ? 's' : ''} imported! They will be analyzed automatically.</p>
              )}
              {pgnImportState.phase === 'done' && pgnImportState.error && (
                <p className={`text-xs ${pgnImportState.imported > 0 || pgnImportState.error.includes('already') ? 'text-amber-400' : 'text-chess-blunder'}`}>{pgnImportState.error}</p>
              )}
            </div>
          </Section>

          {/* Analyze Position from Image */}
          <Section title="Analyze Position">
            <div className="space-y-3">
              <p className="text-xs text-gray-400">
                Upload a chess board screenshot or paste from clipboard. AI extracts the position, then Stockfish analyzes it.
              </p>

              {posPhase === 'idle' && (
                <>
                  {/* Drop zone / upload */}
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      const file = e.dataTransfer.files[0];
                      if (file?.type.startsWith('image/')) handleImageFile(file);
                    }}
                    className="border-2 border-dashed border-chess-border/40 rounded-lg p-6 text-center cursor-pointer hover:border-chess-accent/40 hover:bg-chess-accent/[0.02] transition-all"
                  >
                    <div className="text-2xl mb-1">&#128247;</div>
                    <div className="text-xs text-gray-400">
                      {hasAnyProvider(settings)
                        ? 'Click to upload, drag & drop, or paste (Ctrl+V) a chess board image'
                        : 'Configure an AI provider in the AI tab to enable image recognition'}
                    </div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleImageFile(file);
                        e.target.value = '';
                      }}
                    />
                  </div>

                  {/* Manual FEN input */}
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-gray-500 uppercase tracking-widest shrink-0">or enter FEN</span>
                    <input
                      type="text"
                      value={manualFen}
                      onChange={(e) => setManualFen(e.target.value)}
                      placeholder="rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
                      className="bg-chess-surface border border-chess-border rounded px-2.5 py-1 text-[11px] flex-1 text-chess-text font-mono"
                    />
                    <button
                      onClick={handleManualFenSubmit}
                      disabled={!manualFen.trim()}
                      className="bg-chess-accent text-chess-bg px-3 py-1 rounded text-xs font-bold disabled:opacity-50"
                    >
                      Go
                    </button>
                  </div>
                </>
              )}

              {posPhase === 'recognizing' && (
                <div className="bg-chess-surface/50 rounded-lg p-4 border border-chess-border/30 text-center">
                  <div className="text-chess-accent animate-pulse text-sm">Recognizing position from image...</div>
                </div>
              )}

              {(posPhase === 'recognized' || posPhase === 'analyzing' || posPhase === 'complete') && (
                <div className="space-y-3">
                  {/* Board preview + analysis */}
                  <div className="flex gap-4">
                    <div className="w-[200px] shrink-0">
                      <ThemedChessboard
                        position={posFen}
                        boardWidth={200}
                        arePiecesDraggable={false}
                      />
                    </div>

                    <div className="flex-1 space-y-2">
                      {/* Editable FEN */}
                      <div>
                        <label className="text-[10px] text-gray-500 uppercase tracking-widest">FEN</label>
                        <input
                          type="text"
                          value={posFen}
                          onChange={(e) => setPosFen(e.target.value)}
                          className="w-full bg-chess-surface border border-chess-border rounded px-2 py-1 text-[10px] text-chess-text font-mono mt-0.5"
                        />
                      </div>

                      {posPhase === 'recognized' && (
                        <button
                          onClick={handleAnalyzePosition}
                          className="bg-chess-accent text-chess-bg px-4 py-1.5 rounded text-sm font-bold hover:brightness-110 transition-all w-full"
                        >
                          Analyze with Stockfish
                        </button>
                      )}

                      {posPhase === 'analyzing' && (
                        <div className="text-chess-accent text-xs animate-pulse">Analyzing with Stockfish...</div>
                      )}

                      {posPhase === 'complete' && posEval && (
                        <div className="space-y-1.5">
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-gray-500">Eval</span>
                            <span className={`text-sm font-bold ${
                              posEval.scoreType === 'mate'
                                ? posEval.score > 0 ? 'text-chess-accent' : 'text-chess-blunder'
                                : posEval.score > 50 ? 'text-chess-accent' : posEval.score < -50 ? 'text-chess-blunder' : 'text-chess-text'
                            }`}>
                              {posEval.scoreType === 'mate'
                                ? `M${posEval.score > 0 ? '+' : ''}${posEval.score}`
                                : `${posEval.score > 0 ? '+' : ''}${(posEval.score / 100).toFixed(2)}`}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-gray-500">Best move</span>
                            <span className="text-sm font-bold text-chess-accent">
                              {posEval.bestMoveSan || posEval.bestMove}
                            </span>
                          </div>
                          {posEval.pv.length > 1 && (
                            <div>
                              <span className="text-[10px] text-gray-500">Line</span>
                              <div className="text-[11px] text-chess-text-secondary font-mono mt-0.5">
                                {posEval.pv.slice(0, 8).join(' ')}
                                {posEval.pv.length > 8 && ' ...'}
                              </div>
                            </div>
                          )}
                          <div className="text-[10px] text-gray-500">Depth: {posEval.depth}</div>
                        </div>
                      )}
                    </div>
                  </div>

                  <button
                    onClick={resetPosition}
                    className="text-xs text-gray-400 hover:text-chess-text-secondary transition-colors"
                  >
                    &#8592; Analyze another position
                  </button>
                </div>
              )}

              {posPhase === 'error' && (
                <div className="space-y-2">
                  <p className="text-xs text-chess-blunder">{posError}</p>
                  <button
                    onClick={resetPosition}
                    className="text-xs text-gray-400 hover:text-chess-text-secondary transition-colors"
                  >
                    &#8592; Try again
                  </button>
                </div>
              )}
            </div>
          </Section>
          <DataAttribution />
        </>
      )}

      {/* AI tab */}
      {settingsTab === 'ai' && (
      <>
        <Section title="AI Providers">
          <p className="text-xs text-gray-500 mb-4">
            Add one or more API keys. The first configured provider is used, with automatic fallback to others.
          </p>

          <ProviderRow
            name="Claude"
            providerId="claude"
            apiKey={settings.claudeApiKey}
            showKey={showApiKey['claude'] ?? false}
            tempKey={tempApiKey['claude'] ?? ''}
            placeholder="sk-ant-..."
            onTempKeyChange={(v) => setTempApiKey(prev => ({ ...prev, claude: v }))}
            onSave={() => handleSaveApiKey('claude')}
            onClear={() => handleClearApiKey('claude')}
            onToggleShow={() => setShowApiKey(prev => ({ ...prev, claude: !prev['claude'] }))}
            model={settings.claudeModel}
            onModelChange={(v) => updateSettings({ claudeModel: v })}
            modelOptions={[
              { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 (recommended)' },
              { value: 'claude-opus-4-6', label: 'Claude Opus 4.6 (most capable)' },
              { value: 'claude-opus-4-5-20251101', label: 'Claude Opus 4.5' },
              { value: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4' },
            ]}
          />

          <ProviderRow
            name="OpenAI"
            providerId="openai"
            apiKey={settings.openaiApiKey}
            showKey={showApiKey['openai'] ?? false}
            tempKey={tempApiKey['openai'] ?? ''}
            placeholder="sk-..."
            onTempKeyChange={(v) => setTempApiKey(prev => ({ ...prev, openai: v }))}
            onSave={() => handleSaveApiKey('openai')}
            onClear={() => handleClearApiKey('openai')}
            onToggleShow={() => setShowApiKey(prev => ({ ...prev, openai: !prev['openai'] }))}
            model={settings.openaiModel}
            onModelChange={(v) => updateSettings({ openaiModel: v })}
            modelOptions={[
              { value: 'gpt-4o', label: 'GPT-4o (recommended)' },
              { value: 'gpt-4o-mini', label: 'GPT-4o Mini (cheaper)' },
            ]}
          />

          <ProviderRow
            name="Gemini"
            providerId="gemini"
            apiKey={settings.geminiApiKey}
            showKey={showApiKey['gemini'] ?? false}
            tempKey={tempApiKey['gemini'] ?? ''}
            placeholder="AIza..."
            onTempKeyChange={(v) => setTempApiKey(prev => ({ ...prev, gemini: v }))}
            onSave={() => handleSaveApiKey('gemini')}
            onClear={() => handleClearApiKey('gemini')}
            onToggleShow={() => setShowApiKey(prev => ({ ...prev, gemini: !prev['gemini'] }))}
            model={settings.geminiModel}
            onModelChange={(v) => updateSettings({ geminiModel: v })}
            modelOptions={[
              { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash (recommended)' },
              { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro (smartest)' },
            ]}
          />
        </Section>

        {/* Audio Prompt Editor — admin only */}
        {isAdmin && (
          <AudioPromptEditor settings={settings} updateSettings={updateSettings} />
        )}
      </>
      )}

      {/* Settings tab */}
      {settingsTab === 'settings' && (
        <>
          <Section title={(() => { try { return tFunc('settings_language'); } catch { return 'Language'; } })()}>
            <div className="flex items-center gap-3">
              <label className="text-sm text-gray-400 w-32">{'\uD83C\uDF10'} {tFunc('settings_language')}</label>
              <div className="flex gap-2 flex-wrap">
                {SUPPORTED_LANGUAGES.map((lang) => (
                  <button
                    key={lang.code}
                    onClick={() => { updateSettings({ language: lang.code as 'en' | 'he' | 'es' }); try { localStorage.setItem('chess-dna-language', lang.code); } catch {} }}
                    className={`px-3 py-1.5 rounded text-sm transition-all ${
                      (settings.language ?? 'en') === lang.code
                        ? 'bg-chess-accent/20 text-chess-accent font-semibold'
                        : 'bg-chess-muted text-gray-400'
                    }`}
                  >
                    {lang.label}
                  </button>
                ))}
              </div>
            </div>
          </Section>

          <Section title={tFunc('settings_appearance')}>
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <label className="text-sm text-gray-400 w-32">{tFunc('settings_theme')}</label>
                <div className="flex gap-2">
                  {(['dark', 'light'] as const).map((themeOpt) => (
                    <button
                      key={themeOpt}
                      onClick={() => setTheme(themeOpt)}
                      className={`px-3 py-1.5 rounded text-sm transition-all ${
                        theme === themeOpt
                          ? 'bg-chess-accent/20 text-chess-accent'
                          : 'bg-chess-muted text-gray-400'
                      }`}
                    >
                      {themeOpt === 'dark' ? tFunc('settings_theme_dark') : tFunc('settings_theme_light')}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-start gap-3">
                <label className="text-sm text-gray-400 w-32 pt-1">{tFunc('settings_board_theme')}</label>
                <div className="flex flex-wrap gap-2">
                  {BOARD_THEMES.map((bt) => (
                    <button
                      key={bt.id}
                      onClick={() => setBoardTheme(bt.id)}
                      className={`flex items-center gap-1.5 px-2 py-1.5 rounded text-xs transition-all ${
                        boardTheme === bt.id
                          ? 'ring-2 ring-chess-accent bg-chess-accent/10'
                          : 'ring-1 ring-chess-border/50 hover:ring-chess-border'
                      }`}
                    >
                      <div className="w-5 h-5 grid grid-cols-2 rounded-sm overflow-hidden shrink-0">
                        <div style={{ backgroundColor: bt.lightSquare }} />
                        <div style={{ backgroundColor: bt.darkSquare }} />
                        <div style={{ backgroundColor: bt.darkSquare }} />
                        <div style={{ backgroundColor: bt.lightSquare }} />
                      </div>
                      <span>{bt.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </Section>

          <Section title={tFunc('settings_analysis')}>
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <label className="text-sm text-gray-400 w-32">Engine Depth</label>
                <input
                  type="range"
                  min="10"
                  max="24"
                  value={settings.analysisDepth}
                  onChange={(e) =>
                    updateSettings({ analysisDepth: parseInt(e.target.value) })
                  }
                  className="flex-1"
                />
                <span className="text-sm w-8 text-center">{settings.analysisDepth}</span>
              </div>

              <div className="flex items-center gap-3">
                <label className="text-sm text-gray-400 w-32">Auto-analyze</label>
                <button
                  onClick={() =>
                    updateSettings({ autoAnalyze: !settings.autoAnalyze })
                  }
                  className={`px-3 py-1 rounded text-sm ${
                    settings.autoAnalyze
                      ? 'bg-chess-accent/20 text-chess-accent'
                      : 'bg-chess-border text-gray-400'
                  }`}
                >
                  {settings.autoAnalyze ? 'On' : 'Off'}
                </button>
              </div>

              <div className="flex items-center gap-3">
                <label className="text-sm text-gray-400 w-32">Pattern Window</label>
                <input
                  type="number"
                  min="10"
                  max="200"
                  value={settings.windowSize}
                  onChange={(e) =>
                    updateSettings({ windowSize: parseInt(e.target.value) || 50 })
                  }
                  className="bg-chess-surface border border-chess-border rounded px-3 py-1.5 text-sm w-20 text-chess-text"
                />
                <span className="text-xs text-gray-500">games</span>
              </div>
            </div>
          </Section>

          {settings.openaiApiKey && (
            <Section title={tFunc('settings_tts')}>
              <div className="space-y-3">
                <p className="text-xs text-gray-400">
                  Audio analysis uses OpenAI TTS for natural voices. Cost: ~$0.015 per 1,000 characters (~$0.03-0.05 per script).
                </p>

                <div className="flex items-center gap-3">
                  <label className="text-sm text-gray-400 w-32">Quality</label>
                  <select
                    value={settings.ttsModel}
                    onChange={(e) => updateSettings({ ttsModel: e.target.value })}
                    className="bg-chess-surface border border-chess-border rounded px-2 py-1 text-xs text-chess-text"
                  >
                    <option value="gpt-4o-mini-tts">Natural (gpt-4o-mini-tts)</option>
                    <option value="tts-1">Fast (tts-1)</option>
                    <option value="tts-1-hd">High Quality (tts-1-hd)</option>
                  </select>
                </div>

                <div className="flex items-center gap-3">
                  <label className="text-sm text-gray-400 w-32">Host voice</label>
                  <select
                    value={settings.ttsVoiceA}
                    onChange={(e) => updateSettings({ ttsVoiceA: e.target.value })}
                    className="bg-chess-surface border border-chess-border rounded px-2 py-1 text-xs text-chess-text capitalize"
                  >
                    {OPENAI_TTS_VOICES.map((v) => (
                      <option key={v} value={v}>{v}</option>
                    ))}
                  </select>
                  <button
                    onClick={() => previewVoice(settings.ttsVoiceA, 'A')}
                    disabled={previewingVoice !== null}
                    className="w-7 h-7 flex items-center justify-center rounded-full bg-chess-surface border border-chess-border/40 text-gray-400 hover:text-chess-accent hover:border-chess-accent/40 transition-all disabled:opacity-40"
                    title="Preview voice"
                  >
                    {previewingVoice === settings.ttsVoiceA ? (
                      <div className="w-3 h-3 border-2 border-chess-accent border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21" /></svg>
                    )}
                  </button>
                </div>

                <div className="flex items-center gap-3">
                  <label className="text-sm text-gray-400 w-32">Commentator voice</label>
                  <select
                    value={settings.ttsVoiceB}
                    onChange={(e) => updateSettings({ ttsVoiceB: e.target.value })}
                    className="bg-chess-surface border border-chess-border rounded px-2 py-1 text-xs text-chess-text capitalize"
                  >
                    {OPENAI_TTS_VOICES.map((v) => (
                      <option key={v} value={v}>{v}</option>
                    ))}
                  </select>
                  <button
                    onClick={() => previewVoice(settings.ttsVoiceB, 'B')}
                    disabled={previewingVoice !== null}
                    className="w-7 h-7 flex items-center justify-center rounded-full bg-chess-surface border border-chess-border/40 text-gray-400 hover:text-chess-accent hover:border-chess-accent/40 transition-all disabled:opacity-40"
                    title="Preview voice"
                  >
                    {previewingVoice === settings.ttsVoiceB ? (
                      <div className="w-3 h-3 border-2 border-chess-accent border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21" /></svg>
                    )}
                  </button>
                </div>

                <div className="flex items-center gap-3">
                  <label className="text-sm text-gray-400 w-32">Language</label>
                  <select
                    value={settings.ttsLanguage || 'English'}
                    onChange={(e) => updateSettings({ ttsLanguage: e.target.value })}
                    className="bg-chess-surface border border-chess-border rounded px-2 py-1 text-xs text-chess-text"
                  >
                    {['English', 'Spanish', 'French', 'German', 'Italian', 'Portuguese', 'Russian', 'Chinese', 'Japanese', 'Korean', 'Arabic', 'Hindi', 'Hebrew', 'Dutch', 'Polish', 'Turkish', 'Swedish', 'Norwegian', 'Danish', 'Finnish'].map((lang) => (
                      <option key={lang} value={lang}>{lang}</option>
                    ))}
                  </select>
                </div>
              </div>
            </Section>
          )}


          <Section title="API Usage">
            <div className="space-y-3">
              <div className="flex justify-end mb-1">
                <button
                  onClick={async () => {
                    await resetTokenUsage();
                    const fresh = await getTokenUsage();
                    setTokenUsage(fresh);
                  }}
                  className="text-[10px] text-gray-500 hover:text-chess-text transition-colors px-2 py-0.5 rounded border border-chess-border/30 hover:border-chess-border/60"
                >
                  Reset
                </button>
              </div>
              <div className="grid grid-cols-4 gap-3">
                <div>
                  <div className="text-xs text-gray-400">Input Tokens</div>
                  <div className="text-sm font-medium">
                    {tokenUsage.totalInputTokens.toLocaleString()}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-400">Output Tokens</div>
                  <div className="text-sm font-medium">
                    {tokenUsage.totalOutputTokens.toLocaleString()}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-400">Requests</div>
                  <div className="text-sm font-medium">
                    {tokenUsage.requestCount}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-400">Est. Cost</div>
                  <div className="text-sm font-medium text-chess-accent">
                    ${estimatedCost}
                  </div>
                </div>
              </div>

              <div className="text-[10px] text-gray-500 pt-1 border-t border-chess-border/20">
                <div className="font-medium text-gray-400 mb-1">Approximate tokens per feature:</div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
                  <span>Image recognition: ~500 tokens</span>
                  <span>Audio script: ~2,000 tokens</span>
                  <span>Exercise generation: ~800 tokens</span>
                  <span>Lesson generation: ~1,000 tokens</span>
                </div>
                <span>TTS audio: ~$0.03-0.05/script</span>
                <div className="mt-1 italic col-span-2">Token cost estimate based on ~$3/M input + ~$15/M output (Claude Sonnet). TTS uses OpenAI pricing. Actual costs vary by provider and model.</div>
              </div>
            </div>
          </Section>

          {/* Account / Sign Out */}
          <Section title={tFunc('settings_account')}>
            <button
              onClick={handleLogout}
              className="bg-chess-blunder/20 text-chess-blunder px-4 py-1.5 rounded text-xs font-bold hover:bg-chess-blunder/30 transition-all"
            >
              Sign Out
            </button>
          </Section>

          {/* Danger Zone — irreversible account deletion */}
          <Section title={<span className="text-chess-blunder">{'\u26A0\uFE0F'} Danger Zone</span>}>
            {!deleteOpen ? (
              <div className="space-y-2">
                <p className="text-[11px] text-gray-500 leading-relaxed">
                  Permanently delete all your data &mdash; games, analyses, patterns, preferences, and AI-generated content. This cannot be undone.
                </p>
                <button
                  onClick={() => { setDeleteOpen(true); setDeleteConfirmText(''); }}
                  className="bg-chess-blunder/10 border border-chess-blunder/40 text-chess-blunder px-4 py-1.5 rounded text-xs font-bold hover:bg-chess-blunder/20 transition-all"
                >
                  Delete account
                </button>
              </div>
            ) : (
              <div className="space-y-3 rounded-lg border border-chess-blunder/30 bg-chess-blunder/5 p-3">
                <div className="text-[11px] text-chess-blunder font-semibold">
                  This permanently deletes every record tied to your account.
                </div>
                <ul className="text-[10px] text-gray-400 list-disc pl-4 space-y-0.5">
                  <li>All imported games &amp; analyses</li>
                  <li>Skill patterns, snapshots, and insights</li>
                  <li>AI-generated lessons, exercises, training plans</li>
                  <li>Your saved preferences &amp; API keys</li>
                </ul>
                <div>
                  <label className="block text-[10px] text-gray-500 mb-1">
                    Type <span className="font-mono text-chess-blunder">DELETE</span> to confirm:
                  </label>
                  <input
                    type="text"
                    value={deleteConfirmText}
                    onChange={(e) => setDeleteConfirmText(e.target.value)}
                    disabled={deleting}
                    placeholder="DELETE"
                    className="w-full bg-chess-bg border border-chess-blunder/40 rounded px-3 py-1.5 text-xs text-chess-text font-mono focus:border-chess-blunder focus:outline-none"
                  />
                </div>
                {deleteProgress && (
                  <div className="text-[10px] text-gray-500">
                    Deleting {deleteProgress.entity}... {deleteProgress.deleted} / {deleteProgress.total}
                  </div>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={handleDeleteAccount}
                    disabled={deleting || deleteConfirmText !== 'DELETE'}
                    className="bg-chess-blunder text-white px-4 py-1.5 rounded text-xs font-bold hover:bg-chess-blunder/90 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {deleting ? 'Deleting\u2026' : 'Permanently delete'}
                  </button>
                  <button
                    onClick={() => { setDeleteOpen(false); setDeleteConfirmText(''); setDeleteProgress(null); }}
                    disabled={deleting}
                    className="bg-white/5 border border-chess-border/30 text-gray-400 px-4 py-1.5 rounded text-xs font-medium hover:bg-white/10 transition-all disabled:opacity-40"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </Section>
        </>
      )}

      {/* Analytics tab (admin only) */}
      {settingsTab === 'analytics' && isAdmin && (
        <AdminAnalyticsPanel tokenUsage={tokenUsage} />
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
 *  Admin Analytics Panel
 * ══════════════════════════════════════════════════════════════ */

function AdminAnalyticsPanel({ tokenUsage }: { tokenUsage: TokenUsage }) {
  const { allGames } = useChessData();
  const analyzedGames = allGames.filter(g => g.analysisStatus === 'complete');
  const estimatedCost = ((tokenUsage.totalInputTokens / 1_000_000) * 3 + (tokenUsage.totalOutputTokens / 1_000_000) * 15).toFixed(2);

  return (
    <>
      <Section title="AI Usage (Your Account)">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-chess-surface/30 border border-chess-border/30 rounded-lg p-3 text-center">
            <div className="text-2xl font-black text-chess-text">{tokenUsage.requestCount}</div>
            <div className="text-[10px] text-gray-500">AI Requests</div>
          </div>
          <div className="bg-chess-surface/30 border border-chess-border/30 rounded-lg p-3 text-center">
            <div className="text-2xl font-black text-chess-text">{(tokenUsage.totalInputTokens / 1000).toFixed(1)}k</div>
            <div className="text-[10px] text-gray-500">Input Tokens</div>
          </div>
          <div className="bg-chess-surface/30 border border-chess-border/30 rounded-lg p-3 text-center">
            <div className="text-2xl font-black text-chess-text">{(tokenUsage.totalOutputTokens / 1000).toFixed(1)}k</div>
            <div className="text-[10px] text-gray-500">Output Tokens</div>
          </div>
          <div className="bg-chess-surface/30 border border-chess-border/30 rounded-lg p-3 text-center">
            <div className="text-2xl font-black text-chess-text">${estimatedCost}</div>
            <div className="text-[10px] text-gray-500">Est. Cost</div>
          </div>
        </div>
      </Section>

      <Section title="App Stats (Your Account)">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div className="bg-chess-surface/30 border border-chess-border/30 rounded-lg p-3 text-center">
            <div className="text-2xl font-black text-chess-text">{allGames.length}</div>
            <div className="text-[10px] text-gray-500">Total Games</div>
          </div>
          <div className="bg-chess-surface/30 border border-chess-border/30 rounded-lg p-3 text-center">
            <div className="text-2xl font-black text-chess-text">{analyzedGames.length}</div>
            <div className="text-[10px] text-gray-500">Analyzed</div>
          </div>
          <div className="bg-chess-surface/30 border border-chess-border/30 rounded-lg p-3 text-center">
            <div className="text-2xl font-black text-chess-text">{allGames.length - analyzedGames.length}</div>
            <div className="text-[10px] text-gray-500">Pending</div>
          </div>
        </div>
      </Section>

      <Section title="Cross-User Analytics">
        <p className="text-xs text-gray-400 mb-3">
          User-level analytics are tracked via Base44. View cross-user data in the Base44 dashboard.
        </p>
        <a
          href="https://app.base44.com"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 bg-chess-accent/10 text-chess-accent px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-chess-accent/20 transition-all"
        >
          Open Base44 Dashboard {'\u2197'}
        </a>
      </Section>
    </>
  );
}

function Section({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mb-6">
      <h3 className="text-sm font-medium text-chess-text mb-3 border-b border-chess-border pb-2">
        {title}
      </h3>
      {children}
    </div>
  );
}

interface ProviderRowProps {
  name: string;
  providerId: string;
  apiKey: string | null;
  showKey: boolean;
  tempKey: string;
  placeholder: string;
  onTempKeyChange: (v: string) => void;
  onSave: () => void;
  onClear: () => void;
  onToggleShow: () => void;
  model: string;
  onModelChange: (v: string) => void;
  modelOptions: { value: string; label: string }[];
}

function ProviderRow({
  name, apiKey, showKey, tempKey, placeholder,
  onTempKeyChange, onSave, onClear, onToggleShow,
  model, onModelChange, modelOptions,
}: ProviderRowProps) {
  return (
    <div className="mb-4 pb-4 border-b border-chess-border/30 last:border-0 last:pb-0 last:mb-0">
      <div className="flex items-center gap-2 mb-2">
        <span className={`w-2 h-2 rounded-full ${apiKey ? 'bg-chess-accent' : 'bg-gray-600'}`} />
        <span className="text-sm font-medium text-chess-text">{name}</span>
        {apiKey && <span className="text-[10px] text-chess-accent">Connected</span>}
      </div>
      <div className="space-y-2 ml-4">
        <div className="flex items-center gap-2">
          {apiKey ? (
            <>
              <span className="text-xs text-gray-400 font-mono">
                {showKey ? apiKey : `${apiKey.slice(0, 6)}...${apiKey.slice(-4)}`}
              </span>
              <button onClick={onToggleShow} className="text-[10px] text-gray-500 hover:text-chess-text">
                {showKey ? 'Hide' : 'Show'}
              </button>
              <button onClick={onClear} className="text-[10px] text-chess-blunder hover:brightness-125">
                Remove
              </button>
            </>
          ) : (
            <>
              <input
                type="password"
                value={tempKey}
                onChange={(e) => onTempKeyChange(e.target.value)}
                placeholder={placeholder}
                className="bg-chess-surface border border-chess-border rounded px-2.5 py-1 text-xs flex-1 text-chess-text"
              />
              <button
                onClick={onSave}
                disabled={!tempKey}
                className="bg-chess-accent text-chess-bg px-3 py-1 rounded text-xs font-bold disabled:opacity-50"
              >
                Save
              </button>
            </>
          )}
        </div>
        {apiKey && (
          <div className="flex items-center gap-2">
            <label className="text-[10px] text-gray-500">Model</label>
            <select
              value={model}
              onChange={(e) => onModelChange(e.target.value)}
              className="bg-chess-surface border border-chess-border rounded px-2 py-1 text-xs text-chess-text"
            >
              {modelOptions.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        )}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
 *  Audio Prompt Editor (admin only)
 * ══════════════════════════════════════════════════════════════ */

const DEFAULT_GAME_SUFFIX = `Be VERY specific about the actual moves:
- When discussing mistakes, say the exact move played vs. the best move and explain WHY it's bad
- When discussing brilliant moves, explain the tactic or idea behind them
- Reference the evaluation swings — explain how the position changed
- Use the tactical motifs when available (fork, pin, skewer, discovered attack, etc.)
- Mention the best continuation lines to show what the engine suggests
- Name the opening and discuss whether it worked out
- Reference exact accuracy percentages and compare phases
Make it feel like a real in-depth chess commentary, not a surface-level summary.
End with 1-2 concrete things the player should work on.`;

function AudioPromptEditor({
  settings,
  updateSettings,
}: {
  settings: import('@shared/types/storage').UserSettings;
  updateSettings: (patch: Partial<import('@shared/types/storage').UserSettings>) => Promise<void>;
}) {
  const [saved, setSaved] = useState<string | null>(null);
  const saveTimeout = useRef<ReturnType<typeof setTimeout>>(undefined);

  const handleChange = (field: 'audioSystemPrompt' | 'audioGamePromptSuffix', value: string) => {
    updateSettings({ [field]: value || null });
    setSaved(field);
    clearTimeout(saveTimeout.current);
    saveTimeout.current = setTimeout(() => setSaved(null), 2000);
  };

  const systemValue = settings.audioSystemPrompt ?? AUDIO_SYSTEM_PROMPT_DEFAULT;
  const suffixValue = settings.audioGamePromptSuffix ?? DEFAULT_GAME_SUFFIX;
  const isCustomSystem = settings.audioSystemPrompt != null;
  const isCustomSuffix = settings.audioGamePromptSuffix != null;

  return (
    <Section title="Audio Prompt Editor">
      <p className="text-[10px] text-gray-500 mb-3">
        Edit the prompts that generate game audio recaps. Changes auto-save and apply to all users.
      </p>

      <div className="space-y-4">
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-medium text-gray-400">System Prompt</label>
            <div className="flex items-center gap-2">
              {isCustomSystem && (
                <button
                  onClick={() => { updateSettings({ audioSystemPrompt: null }); setSaved('audioSystemPrompt'); setTimeout(() => setSaved(null), 2000); }}
                  className="text-[9px] text-gray-500 hover:text-chess-blunder"
                >
                  Reset
                </button>
              )}
              {saved === 'audioSystemPrompt' && (
                <span className="text-[9px] text-chess-accent animate-pulse">Saved {'\u2713'}</span>
              )}
            </div>
          </div>
          <textarea
            value={systemValue}
            onChange={(e) => handleChange('audioSystemPrompt', e.target.value)}
            rows={6}
            className={`w-full bg-chess-bg border rounded-lg px-3 py-2 text-xs text-chess-text focus:border-chess-accent/50 focus:outline-none resize-y font-mono leading-relaxed ${
              isCustomSystem ? 'border-chess-accent/30' : 'border-chess-border/30'
            }`}
          />
          <p className="text-[9px] text-gray-600 mt-1">
            {isCustomSystem ? 'Custom prompt active' : 'Using default prompt'} — sets the AI persona for audio generation.
          </p>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-medium text-gray-400">Game Analysis Instructions</label>
            <div className="flex items-center gap-2">
              {isCustomSuffix && (
                <button
                  onClick={() => { updateSettings({ audioGamePromptSuffix: null }); setSaved('audioGamePromptSuffix'); setTimeout(() => setSaved(null), 2000); }}
                  className="text-[9px] text-gray-500 hover:text-chess-blunder"
                >
                  Reset
                </button>
              )}
              {saved === 'audioGamePromptSuffix' && (
                <span className="text-[9px] text-chess-accent animate-pulse">Saved {'\u2713'}</span>
              )}
            </div>
          </div>
          <textarea
            value={suffixValue}
            onChange={(e) => handleChange('audioGamePromptSuffix', e.target.value)}
            rows={10}
            className={`w-full bg-chess-bg border rounded-lg px-3 py-2 text-xs text-chess-text focus:border-chess-accent/50 focus:outline-none resize-y font-mono leading-relaxed ${
              isCustomSuffix ? 'border-chess-accent/30' : 'border-chess-border/30'
            }`}
          />
          <p className="text-[9px] text-gray-600 mt-1">
            {isCustomSuffix ? 'Custom instructions active' : 'Using default instructions'} — appended to every game audio prompt after the game data.
          </p>
        </div>
      </div>
    </Section>
  );
}

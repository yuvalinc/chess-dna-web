import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import type { TokenUsage } from '@shared/types/storage';
import { DEFAULT_TOKEN_USAGE } from '@shared/types/storage';
import { getTokenUsage } from '@/storage/settings-store';
import type { TimeClass as _TimeClass } from '@shared/types/game';
import type { PositionEval } from '@shared/types/engine';
import { useTheme } from '@/components/ThemeContext';
import { useT, SUPPORTED_LANGUAGES } from '@/i18n/index';
import { useChessData } from '@/contexts/ChessDataContext';
import { ChessComBadge, LichessBadge } from '@/components/PlatformBadge';
import { importLichessGames } from '@/api/lichess-import';
import { trackAnalysis } from '@/analytics/client';
import { splitMultiGamePgn, parsePgnToGameRecord } from '@shared/utils/chess-utils';
import { BOARD_THEMES } from '@/components/board-themes';
import ThemedChessboard from '@/components/ThemedChessboard';
import { recognizePosition, resizeImageForAPI } from '@/ai/position-recognizer';
import { StockfishClient } from '@/engine/stockfish-client';
import { hasAnyProvider } from '@/ai/ai-router';
import { uciToSan } from '@shared/utils/chess-utils';
import { base44 } from '../api/base44Client';
import { importChessComGames } from '@/api/chess-com-import';
import { deleteAccountData, type DeleteProgress } from '@/utils/account-delete';
import DedupDiagnosticsPanel from '@/components/DedupDiagnosticsPanel';

type PositionPhase = 'idle' | 'recognizing' | 'recognized' | 'analyzing' | 'complete' | 'error';

export default function Settings() {
  const navigate = useNavigate();
  const { theme, boardTheme, setTheme, setBoardTheme, settings, updateSettings, isAdmin } = useTheme();
  const { t: tFunc } = useT();
  const [tokenUsage, setTokenUsage] = useState<TokenUsage>(DEFAULT_TOKEN_USAGE);

  // Load actual token usage on mount
  useEffect(() => {
    getTokenUsage().then(setTokenUsage);
  }, []);
  const { allGames: _allGames, availableTimeClasses, refetchGames } = useChessData();
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


  const handleImportGames = async () => {
    if (!settings.chesscomUsername) return;
    setImportState({ phase: 'fetching', fetched: 0, total: 0 });
    trackAnalysis('chesscom_import_started', {
      username: settings.chesscomUsername,
      timeClass: importTimeClass,
      source: 'settings',
    });

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
      trackAnalysis('chesscom_import_complete', {
        username: settings.chesscomUsername,
        timeClass: importTimeClass,
        source: 'settings',
        gamesImported: newGameIds.length,
      });
    } catch (err) {
      setImportState({
        phase: 'done',
        fetched: 0,
        total: 0,
        error: `Import failed: ${String(err)}`,
      });
      trackAnalysis('chesscom_import_error', {
        username: settings.chesscomUsername,
        source: 'settings',
        error: String(err).slice(0, 200),
      });
    }
  };

  const handleLichessImport = async () => {
    if (!settings.lichessUsername) return;
    setLichessImportState({ phase: 'fetching', fetched: 0, total: 0 });
    trackAnalysis('lichess_import_started', {
      username: settings.lichessUsername,
      timeClass: importTimeClass,
      source: 'settings',
    });
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
      trackAnalysis('lichess_import_complete', {
        username: settings.lichessUsername,
        timeClass: importTimeClass,
        source: 'settings',
        gamesImported: newGameIds.length,
      });
    } catch (err) {
      setLichessImportState({ phase: 'done', fetched: 0, total: 0, error: `Import failed: ${String(err)}` });
      trackAnalysis('lichess_import_error', {
        username: settings.lichessUsername,
        source: 'settings',
        error: String(err).slice(0, 200),
      });
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
      {/* Back button + title \u2014 unified single-page Profile (no inner tabs) */}
      <div className="flex items-center gap-3 mb-4">
        <button
          onClick={() => navigate('/')}
          className="flex items-center text-chess-text-secondary hover:text-chess-text transition-colors"
          aria-label="Back to DNA"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="rtl:rotate-180">
            <path d="M19 12H5" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
        </button>
        <h2 className="text-xl font-bold">{tFunc('settings_profile')}</h2>
      </div>

      {/* All sections rendered inline (Profile + Settings unified). Admin-
          only sections (AI / Analytics / Diagnostics) follow the user-
          facing ones. */}
      {true && (
        <>
          {/* ── Preferences: Language + Theme + Board theme in a single card ── */}
          <Section title="Preferences">
            <SubSection label={<span>{'🌐'} {tFunc('settings_language')}</span>}>
              <div className="flex flex-wrap gap-1.5">
                {SUPPORTED_LANGUAGES.map((lang) => (
                  <button
                    key={lang.code}
                    onClick={() => { updateSettings({ language: lang.code as 'en' | 'he' | 'es' }); try { localStorage.setItem('chess-dna-language', lang.code); } catch {} }}
                    className={`px-2.5 py-1 rounded text-[11px] transition-all ${
                      (settings.language ?? 'en') === lang.code
                        ? 'bg-chess-accent/20 text-chess-accent font-semibold'
                        : 'bg-chess-bg/60 text-gray-400'
                    }`}
                  >
                    {lang.label}
                  </button>
                ))}
              </div>
            </SubSection>

            <SubSection label={<span>{tFunc('settings_theme')}</span>}>
              <div className="flex gap-1.5">
                {(['dark', 'light'] as const).map((themeOpt) => (
                  <button
                    key={themeOpt}
                    onClick={() => setTheme(themeOpt)}
                    className={`px-2.5 py-1 rounded text-[11px] transition-all ${
                      theme === themeOpt
                        ? 'bg-chess-accent/20 text-chess-accent'
                        : 'bg-chess-bg/60 text-gray-400'
                    }`}
                  >
                    {themeOpt === 'dark' ? tFunc('settings_theme_dark') : tFunc('settings_theme_light')}
                  </button>
                ))}
              </div>
            </SubSection>

            <SubSection label={<span>{tFunc('settings_board_theme')}</span>}>
              <div className="flex flex-wrap gap-1.5">
                {BOARD_THEMES.map((bt) => (
                  <button
                    key={bt.id}
                    onClick={() => setBoardTheme(bt.id)}
                    className={`flex items-center gap-1.5 px-2 py-1 rounded text-[11px] transition-all ${
                      boardTheme === bt.id
                        ? 'ring-2 ring-chess-accent bg-chess-accent/10'
                        : 'ring-1 ring-chess-border/50 hover:ring-chess-border'
                    }`}
                  >
                    <div className="w-4 h-4 grid grid-cols-2 rounded-sm overflow-hidden shrink-0">
                      <div style={{ backgroundColor: bt.lightSquare }} />
                      <div style={{ backgroundColor: bt.darkSquare }} />
                      <div style={{ backgroundColor: bt.darkSquare }} />
                      <div style={{ backgroundColor: bt.lightSquare }} />
                    </div>
                    <span>{bt.name}</span>
                  </button>
                ))}
              </div>
            </SubSection>
          </Section>

          {/* ── Connected Accounts: Chess.com + Lichess in a single compact card ── */}
          <Section title="Connected Accounts">
            {/* Chess.com row */}
            <SubSection label={<><ChessComBadge size="xs" /><span>Chess.com</span></>}>
              <div className="space-y-2">
                <input
                  type="text"
                  value={settings.chesscomUsername ?? ''}
                  onChange={(e) => updateSettings({ chesscomUsername: e.target.value || null })}
                  placeholder="Username"
                  className="w-full bg-chess-bg border border-chess-border/40 rounded px-2.5 py-1.5 text-sm text-chess-text"
                />
                {settings.chesscomUsername && (
                  <>
                    <div className="flex flex-wrap gap-1.5">
                      {(['rapid', 'blitz', 'bullet', 'daily'] as const).map(tc => {
                        const hasGames = availableTimeClasses.has(tc);
                        return (
                          <button
                            key={tc}
                            onClick={() => setImportTimeClass(tc)}
                            disabled={importState.phase === 'fetching' || importState.phase === 'analyzing'}
                            className={`px-2.5 py-1 rounded text-[11px] font-medium capitalize transition-colors flex items-center gap-1.5 ${
                              importTimeClass === tc
                                ? 'bg-chess-accent/15 text-chess-accent border border-chess-accent/30'
                                : 'bg-chess-bg border border-chess-border/30 text-chess-text-secondary hover:text-chess-text'
                            } disabled:opacity-40`}
                          >
                            <span className={`w-1.5 h-1.5 rounded-full ${hasGames ? 'bg-chess-accent' : 'bg-gray-500/40'}`} />
                            {tc}
                          </button>
                        );
                      })}
                    </div>
                    <button
                      onClick={handleImportGames}
                      disabled={importState.phase === 'fetching' || importState.phase === 'analyzing'}
                      className="bg-chess-accent text-chess-bg px-3 py-1.5 rounded text-xs font-bold hover:brightness-110 transition-all disabled:opacity-50"
                    >
                      {importState.phase === 'fetching' || importState.phase === 'analyzing' ? 'Importing…' : 'Import games'}
                    </button>
                    {importState.phase === 'fetching' && (
                      <div className="text-[11px] text-chess-text-secondary">
                        Importing {importTimeClass}: {importState.fetched}{importState.total > 0 ? ` / ${importState.total}` : ''}
                      </div>
                    )}
                    {importState.phase === 'analyzing' && (
                      <div className="text-[11px] text-chess-text-secondary animate-pulse">
                        Analyzing {importState.fetched} game{importState.fetched !== 1 ? 's' : ''}…
                      </div>
                    )}
                    {importState.phase === 'done' && importState.error && (
                      <p className="text-[11px] text-chess-blunder">{importState.error}</p>
                    )}
                    {importState.phase === 'done' && !importState.error && (
                      <p className="text-[11px] text-chess-accent">
                        {importState.fetched} game{importState.fetched !== 1 ? 's' : ''} imported.
                      </p>
                    )}
                  </>
                )}
              </div>
            </SubSection>

            {/* Lichess row */}
            <SubSection label={<><LichessBadge size="xs" /><span>Lichess</span></>}>
              <div className="space-y-2">
                <input
                  type="text"
                  value={settings.lichessUsername ?? ''}
                  onChange={(e) => updateSettings({ lichessUsername: e.target.value || null })}
                  placeholder="Username"
                  className="w-full bg-chess-bg border border-chess-border/40 rounded px-2.5 py-1.5 text-sm text-chess-text"
                />
                {settings.lichessUsername && (
                  <>
                    <button
                      onClick={handleLichessImport}
                      disabled={lichessImportState.phase === 'fetching'}
                      className="bg-chess-accent text-chess-bg px-3 py-1.5 rounded text-xs font-bold hover:brightness-110 transition-all disabled:opacity-50"
                    >
                      {lichessImportState.phase === 'fetching' ? 'Importing…' : 'Import games'}
                    </button>
                    {lichessImportState.phase === 'done' && !lichessImportState.error && (
                      <p className="text-[11px] text-chess-accent">
                        {lichessImportState.fetched} game{lichessImportState.fetched !== 1 ? 's' : ''} imported.
                      </p>
                    )}
                    {lichessImportState.error && (
                      <p className="text-[11px] text-chess-blunder">{lichessImportState.error}</p>
                    )}
                  </>
                )}
              </div>
            </SubSection>
          </Section>

          {/* ── Manual PGN Upload ── */}
          <CollapsibleSection title="Manual Import (PGN)">
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
          </CollapsibleSection>

          {/* Analyze Position from Image — power-user tool, collapsed by default */}
          <CollapsibleSection title="Analyze Position from Image">
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
          </CollapsibleSection>
        </>
      )}

      {/* Settings section — always shown (unified with Profile) */}
      {true && (
        <>
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

      {/* Analytics section — admin-only */}
      {isAdmin && (
        <AdminAnalyticsPanel tokenUsage={tokenUsage} />
      )}

      {isAdmin && (
        <DedupDiagnosticsPanel />
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
    <div className="mb-4 rounded-xl bg-chess-surface/40 border border-chess-border/20 p-3">
      <h3 className="text-[11px] font-bold uppercase tracking-wider text-chess-text-secondary mb-2.5">
        {title}
      </h3>
      {children}
    </div>
  );
}

/* Sub-section heading inside a compact card. Use for Chess.com / Lichess
 * rows so the parent "Accounts" Section can group related platforms. */
function SubSection({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="py-2 border-t border-chess-border/15 first:border-t-0 first:pt-0 last:pb-0">
      <div className="text-[12px] font-semibold text-chess-text mb-1.5 flex items-center gap-2">
        {label}
      </div>
      {children}
    </div>
  );
}

/* Collapsible section — used for PGN import + Analyze Position so the
 * power-user features don't crowd the main flow. */
function CollapsibleSection({
  title,
  defaultOpen = false,
  children,
}: {
  title: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="mb-4 rounded-xl bg-chess-surface/40 border border-chess-border/20 overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-white/[0.02] transition-colors"
      >
        <span className="text-[11px] font-bold uppercase tracking-wider text-chess-text-secondary">
          {title}
        </span>
        <span className="text-[10px] text-gray-500">{open ? '▾' : '▸'}</span>
      </button>
      {open && <div className="px-3 pb-3">{children}</div>}
    </div>
  );
}


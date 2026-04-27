import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useChessData } from '@/contexts/ChessDataContext';
import { getDefaultConfig, getPublishedConfig } from '@/patterns/skill-config-loader';
import { calculateSkillProfile, countMatchingMoves } from '@/patterns/skill-calculator';
import { importChessComGames } from '@/api/chess-com-import';
import { analyzeGame } from '@/engine/game-analyzer';
import DimensionCard from '@/components/skill-studio/DimensionCard';
import ScorePreview from '@/components/skill-studio/ScorePreview';
import SamplePlayersSection, { type SamplePlayerData } from '@/components/skill-studio/SamplePlayersSection';
import VersionPanel from '@/components/skill-studio/VersionPanel';
import GameInvestigator from '@/components/skill-studio/GameInvestigator';
import type { SkillCalcConfigSchema, DimensionConfig } from '@shared/types/skill-config';
import type { GameRecord } from '@shared/types/game';
import type { GameAnalysis } from '@shared/types/analysis';

export default function SkillStudio() {
  const { userEmail } = useAuth();

  return <SkillStudioContent userEmail={userEmail ?? 'admin'} />;
}

function SkillStudioContent({ userEmail }: { userEmail: string }) {
  const { games, allGames, analyses, allAnalyses, patterns } = useChessData();

  const [draftConfig, setDraftConfig] = useState<SkillCalcConfigSchema>(getDefaultConfig);
  const [publishedConfig, setPublishedConfig] = useState<SkillCalcConfigSchema>(getDefaultConfig);
  const [selectedDimId, setSelectedDimId] = useState<string | null>(null);

  const [samplePlayers, setSamplePlayers] = useState<SamplePlayerData[]>([]);
  const playerDataRef = useRef<Map<string, { games: GameRecord[]; analyses: GameAnalysis[] }>>(new Map());

  useEffect(() => {
    getPublishedConfig().then((cfg) => {
      setPublishedConfig(cfg);
      setDraftConfig(cfg);
    });
  }, []);

  // ── Known players from existing analyzed games ──
  // Extract unique usernames from both player and opponent sides
  const knownPlayers = useMemo(() => {
    const playerMap = new Map<string, { rating: number; gameCount: number }>();

    for (const g of allGames) {
      if (g.analysisStatus !== 'complete') continue;

      // Track the player
      const pKey = g.player.username.toLowerCase();
      const pExisting = playerMap.get(pKey);
      playerMap.set(pKey, {
        rating: Math.max(pExisting?.rating ?? 0, g.player.rating),
        gameCount: (pExisting?.gameCount ?? 0) + 1,
      });

      // Track the opponent
      const oKey = g.opponent.username.toLowerCase();
      const oExisting = playerMap.get(oKey);
      playerMap.set(oKey, {
        rating: Math.max(oExisting?.rating ?? 0, g.opponent.rating),
        gameCount: (oExisting?.gameCount ?? 0) + 1,
      });
    }

    return Array.from(playerMap.entries())
      .map(([username, data]) => ({ username, ...data }))
      .sort((a, b) => b.gameCount - a.gameCount);
  }, [allGames]);

  const draftProfile = useMemo(
    () => calculateSkillProfile(patterns, games, analyses, draftConfig),
    [patterns, games, analyses, draftConfig],
  );

  const publishedProfile = useMemo(
    () => calculateSkillProfile(patterns, games, analyses, publishedConfig),
    [patterns, games, analyses, publishedConfig],
  );

  const dimensionStats = useMemo(() => {
    const map: Record<string, { matching: number; total: number; avgAccuracy: number; score: number }> = {};
    for (let i = 0; i < draftConfig.dimensions.length; i++) {
      const dim = draftConfig.dimensions[i];
      const stats = countMatchingMoves(dim, analyses, games);
      const profileDim = draftProfile.dimensions[i];
      map[dim.id] = { ...stats, score: profileDim?.score ?? 50 };
    }
    return map;
  }, [draftConfig.dimensions, analyses, games, draftProfile]);

  const publishedScores = useMemo(() => {
    const map: Record<string, number> = {};
    for (const dim of publishedProfile.dimensions) map[dim.id] = dim.score;
    return map;
  }, [publishedProfile]);

  const selectedStats = selectedDimId ? dimensionStats[selectedDimId] : null;

  // ── Sample player management ──

  const handleAddPlayer = useCallback(async (username: string) => {
    const lowerUsername = username.toLowerCase();

    // Check if this player already has games in the system
    const existingGames = allGames.filter(
      (g) => g.analysisStatus === 'complete' && g.player.username.toLowerCase() === lowerUsername,
    );
    const existingAnalyses = allAnalyses.filter(
      (a) => existingGames.some((g) => g.id === a.gameId),
    );

    if (existingGames.length > 0 && existingAnalyses.length > 0) {
      // Player already has analyzed games — compute profile immediately
      const rating = Math.max(...existingGames.map((g) => g.player.rating));

      setSamplePlayers((prev) => [
        ...prev,
        { username, rating, status: 'computing', existingUser: true, gameCount: existingGames.length },
      ]);

      playerDataRef.current.set(username, { games: existingGames, analyses: existingAnalyses });
      const profile = calculateSkillProfile(null, existingGames, existingAnalyses, draftConfig);

      setSamplePlayers((prev) =>
        prev.map((p) => p.username === username
          ? { ...p, status: 'ready', profile, gameCount: existingGames.length }
          : p
        ),
      );
      return;
    }

    // No existing games — import from chess.com
    setSamplePlayers((prev) => [...prev, { username, rating: 0, status: 'importing' }]);

    try {
      const gameIds = await importChessComGames(username, { maxGames: 15, timeClass: 'all' });

      if (gameIds.length === 0) {
        setSamplePlayers((prev) =>
          prev.map((p) => p.username === username ? { ...p, status: 'error', error: 'No games found' } : p),
        );
        return;
      }

      setSamplePlayers((prev) =>
        prev.map((p) => p.username === username ? { ...p, status: 'analyzing', gameCount: gameIds.length } : p),
      );

      // Fetch imported games
      const { base44 } = await import('@/api/base44Client');
      const entities = base44.entities as Record<string, any>;
      const importedGames: GameRecord[] = [];
      for (const id of gameIds) {
        try {
          const g = await entities.Game.get(id);
          if (g) importedGames.push(g as GameRecord);
        } catch { /* skip */ }
      }

      // Analyze with Stockfish (depth 12 for speed)
      const playerAnalyses: GameAnalysis[] = [];
      for (const g of importedGames) {
        try {
          const analysis = await analyzeGame(g, 12);
          playerAnalyses.push(analysis);
        } catch (err) {
          console.warn(`[Skill Studio] Failed to analyze game for ${username}:`, err);
        }
      }

      const rating = importedGames.length > 0
        ? Math.max(...importedGames.map((g) => g.player.rating))
        : 0;

      playerDataRef.current.set(username, { games: importedGames, analyses: playerAnalyses });
      const profile = calculateSkillProfile(null, importedGames, playerAnalyses, draftConfig);

      setSamplePlayers((prev) =>
        prev.map((p) => p.username === username
          ? { ...p, status: 'ready', rating, gameCount: importedGames.length, profile }
          : p
        ),
      );
    } catch (err) {
      console.error(`[Skill Studio] Failed to add sample player ${username}:`, err);
      setSamplePlayers((prev) =>
        prev.map((p) => p.username === username ? { ...p, status: 'error', error: String(err) } : p),
      );
    }
  }, [allGames, allAnalyses, draftConfig]);

  const handleRemovePlayer = useCallback((username: string) => {
    setSamplePlayers((prev) => prev.filter((p) => p.username !== username));
    playerDataRef.current.delete(username);
  }, []);

  // Re-compute profiles when config changes
  useEffect(() => {
    setSamplePlayers((prev) =>
      prev.map((p) => {
        if (p.status !== 'ready') return p;
        const data = playerDataRef.current.get(p.username);
        if (!data) return p;
        const profile = calculateSkillProfile(null, data.games, data.analyses, draftConfig);
        return { ...p, profile };
      }),
    );
  }, [draftConfig]);

  // ── Dimension handlers ──

  const handleDimensionChange = useCallback((updated: DimensionConfig) => {
    setDraftConfig((prev) => ({
      ...prev,
      dimensions: prev.dimensions.map((d) => d.id === updated.id ? updated : d),
    }));
  }, []);

  const handleDimensionRemove = useCallback((id: string) => {
    setDraftConfig((prev) => ({
      ...prev,
      dimensions: prev.dimensions.filter((d) => d.id !== id),
    }));
    if (selectedDimId === id) setSelectedDimId(null);
  }, [selectedDimId]);

  const handleAddDimension = useCallback(() => {
    setDraftConfig((prev) => ({
      ...prev,
      dimensions: [...prev.dimensions, {
        id: `custom_${Date.now()}`,
        label: 'New Skill',
        description: 'Custom skill dimension',
        weight: 0.1,
        filters: [{ excludeForced: true }],
        opponentAdjust: true,
        clampMin: 0,
        clampMax: 99,
      }],
    }));
  }, []);

  const handleLoadVersion = useCallback((config: SkillCalcConfigSchema) => {
    setDraftConfig(config);
    setSelectedDimId(null);
  }, []);

  const handlePublished = useCallback(() => {
    getPublishedConfig().then(setPublishedConfig);
  }, []);

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] -mx-4 sm:-mx-6">
      {/* Header + Sample Players */}
      <div className="px-4 py-2 border-b border-chess-border/30 bg-chess-surface/50">
        <div className="flex items-center gap-3 mb-2">
          <h1 className="text-sm font-bold text-chess-text">Skill Studio</h1>
          <span className="text-[10px] bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded-full font-semibold">Draft</span>
          <span className="text-[10px] text-chess-text-disabled">{draftConfig.dimensions.length} dimensions</span>
        </div>
        <SamplePlayersSection
          players={samplePlayers}
          knownPlayers={knownPlayers}
          onAddPlayer={handleAddPlayer}
          onRemovePlayer={handleRemovePlayer}
          compact
        />
      </div>

      {/* 3-panel layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* LEFT: Dimension config */}
        <div className="w-[340px] shrink-0 overflow-y-auto p-3 space-y-2 border-r border-chess-border/20">
          {draftConfig.dimensions.map((dim) => (
            <DimensionCard
              key={dim.id}
              config={dim}
              stats={dimensionStats[dim.id] ?? { matching: 0, total: 0, avgAccuracy: 0, score: 50 }}
              publishedScore={publishedScores[dim.id] ?? null}
              isSelected={selectedDimId === dim.id}
              onSelect={() => setSelectedDimId(dim.id)}
              onChange={handleDimensionChange}
              onRemove={() => handleDimensionRemove(dim.id)}
            />
          ))}
          <button
            onClick={handleAddDimension}
            className="w-full py-2.5 border-2 border-dashed border-chess-border/30 rounded-xl text-[10px] text-chess-text-secondary hover:text-chess-accent hover:border-chess-accent/30 transition-colors"
          >
            + Add Dimension
          </button>
        </div>

        {/* MIDDLE: Investigate */}
        <div className="flex-1 min-w-0 border-r border-chess-border/20 flex flex-col bg-chess-bg">
          <div className="px-3 py-1.5 border-b border-chess-border/20">
            <h2 className="text-[10px] font-bold text-chess-text-secondary uppercase tracking-wider">Investigate</h2>
          </div>
          <div className="flex-1 overflow-hidden">
            <GameInvestigator dimensions={draftConfig.dimensions} />
          </div>
        </div>

        {/* RIGHT: Scores + Versions */}
        <div className="w-[260px] shrink-0 overflow-y-auto bg-chess-bg">
          <div className="border-b border-chess-border/20">
            <ScorePreview
              draftProfile={draftProfile}
              publishedProfile={publishedProfile}
              selectedDimensionId={selectedDimId}
              matchingMoves={selectedStats?.matching}
              totalMoves={selectedStats?.total}
            />
          </div>
          <div>
            <VersionPanel
              currentConfig={draftConfig}
              onLoadVersion={handleLoadVersion}
              onPublished={handlePublished}
              authorEmail={userEmail}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

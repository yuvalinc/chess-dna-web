/**
 * React hook for triggering and tracking game analysis.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { analysisEvents, type AnalysisEvent } from '@/engine/analysis-events';
import { runAnalysisPipeline, runBatchAnalysis } from '@/engine/analysis-pipeline';

export interface AnalysisProgress {
  gameId: string;
  moveIndex: number;
  totalMoves: number;
}

export interface AnalysisPipelineState {
  isAnalyzing: boolean;
  currentGameId: string | null;
  progress: AnalysisProgress | null;
  completedGames: string[];
  error: string | null;
}

export function useAnalysisPipeline() {
  const [state, setState] = useState<AnalysisPipelineState>({
    isAnalyzing: false,
    currentGameId: null,
    progress: null,
    completedGames: [],
    error: null,
  });

  const stateRef = useRef(state);
  stateRef.current = state;

  // Subscribe to analysis events
  useEffect(() => {
    const unsubscribe = analysisEvents.on((event: AnalysisEvent) => {
      switch (event.type) {
        case 'progress':
          setState((prev) => ({
            ...prev,
            currentGameId: event.gameId,
            progress: {
              gameId: event.gameId,
              moveIndex: event.moveIndex,
              totalMoves: event.totalMoves,
            },
          }));
          break;

        case 'complete':
          setState((prev) => ({
            ...prev,
            completedGames: [...prev.completedGames, event.gameId],
            progress: null,
          }));
          break;

        case 'all_complete':
          setState((prev) => ({
            ...prev,
            isAnalyzing: false,
            currentGameId: null,
            progress: null,
          }));
          break;

        case 'error':
          setState((prev) => ({
            ...prev,
            error: `Analysis failed for game ${event.gameId}: ${event.error}`,
          }));
          break;
      }
    });

    return unsubscribe;
  }, []);

  const analyzeGame = useCallback(async (gameId: string, depth?: number) => {
    setState((prev) => ({
      ...prev,
      isAnalyzing: true,
      currentGameId: gameId,
      error: null,
      completedGames: [],
    }));

    try {
      await runAnalysisPipeline(gameId, depth);
    } finally {
      setState((prev) => ({
        ...prev,
        isAnalyzing: false,
        currentGameId: null,
      }));
    }
  }, []);

  const analyzeGames = useCallback(async (gameIds: string[], depth?: number) => {
    if (gameIds.length === 0) return;

    setState((prev) => ({
      ...prev,
      isAnalyzing: true,
      error: null,
      completedGames: [],
    }));

    try {
      await runBatchAnalysis(gameIds, depth);
    } finally {
      setState((prev) => ({
        ...prev,
        isAnalyzing: false,
        currentGameId: null,
      }));
    }
  }, []);

  const reset = useCallback(() => {
    setState({
      isAnalyzing: false,
      currentGameId: null,
      progress: null,
      completedGames: [],
      error: null,
    });
  }, []);

  return {
    ...state,
    analyzeGame,
    analyzeGames,
    reset,
  };
}

/**
 * Global audio player context.
 *
 * Owns the HTMLAudioElement refs and TTS playback logic so audio persists
 * across route changes. Provides play/pause/stop/speed controls and
 * exposes state for the MiniAudioPlayer bar.
 */

import {
  createContext,
  useContext,
  useState,
  useRef,
  useCallback,
  useEffect,
  type ReactNode,
} from 'react';
import type { AudioScript, SpeakerTurn, TTSAudioChunk, TTSAudioData } from '@shared/types/audio';
import type { UserSettings } from '@shared/types/storage';
import type { GameRecord } from '@shared/types/game';
import type { GameAnalysis } from '@shared/types/analysis';
import type { CurrentPatterns } from '@shared/types/patterns';
import { generateSummaryAudioScript, generateGameAudioScript } from '@/ai/audio-script-generator';
import { generateTTSAudio, getCachedTTS, estimateTTSCost, downloadTTSAudio } from '@/ai/tts-client';
import {
  saveAudioSession,
  savePlaybackPosition,
  loadAudioSession,
  clearAudioSession,
  type StoredAudioChunk,
} from '@/storage/audio-session-store';

// ── Types ──

export interface AudioPlayerState {
  /** The current script (null = no audio) */
  script: AudioScript | null;
  /** Whether audio is currently playing */
  isPlaying: boolean;
  /** Whether a script or TTS is being generated */
  isGenerating: boolean;
  /** Index of the currently playing turn */
  currentTurnIndex: number;
  /** The current speaker turn text (for display) */
  currentTurn: SpeakerTurn | null;
  /** Seconds elapsed */
  elapsed: number;
  /** Total duration in seconds */
  duration: number;
  /** Playback speed */
  speed: number;
  /** Generation progress (done/total turns for TTS) */
  genProgress: { done: number; total: number } | null;
  /** Error message */
  error: string | null;
  /** TTS data (for download) */
  ttsData: TTSAudioData | null;
  /** Estimated cost */
  estimatedCost: number;
}

export interface AudioPlayerControls {
  /** Generate script + TTS from game data and start playback */
  generateAndPlay: (
    settings: UserSettings,
    games: GameRecord[],
    analyses: GameAnalysis[],
    patterns: CurrentPatterns,
    profileScores: { dimension: string; score: number }[],
  ) => void;
  /** Generate script + TTS for a single game and start playback */
  generateGameAndPlay: (
    settings: UserSettings,
    game: GameRecord,
    analysis: GameAnalysis,
  ) => void;
  /** Resume playback */
  play: () => void;
  /** Pause playback */
  pause: () => void;
  /** Stop and reset */
  stop: () => void;
  /** Close (stop + clear all state) */
  close: () => void;
  /** Set speed */
  setSpeed: (speed: number) => void;
  /** Download MP3 */
  download: () => void;
}

interface AudioPlayerContextValue {
  state: AudioPlayerState;
  controls: AudioPlayerControls;
}

const defaultState: AudioPlayerState = {
  script: null,
  isPlaying: false,
  isGenerating: false,
  currentTurnIndex: 0,
  currentTurn: null,
  elapsed: 0,
  duration: 0,
  speed: 1,
  genProgress: null,
  error: null,
  ttsData: null,
  estimatedCost: 0,
};

const AudioPlayerContext = createContext<AudioPlayerContextValue>({
  state: defaultState,
  controls: {
    generateAndPlay: () => {},
    generateGameAndPlay: () => {},
    play: () => {},
    pause: () => {},
    stop: () => {},
    close: () => {},
    setSpeed: () => {},
    download: () => {},
  },
});

// ── Constants ──

const TURN_GAP_MS = 300;

// ── Provider ──

export function AudioPlayerProvider({ children }: { children: ReactNode }) {
  // ── State ──
  const [script, setScript] = useState<AudioScript | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [currentTurnIndex, setCurrentTurnIndex] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [speed, setSpeedState] = useState(1);
  const [genProgress, setGenProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ttsData, setTtsData] = useState<TTSAudioData | null>(null);
  const [streamChunks, setStreamChunks] = useState<TTSAudioChunk[]>([]);

  // ── Refs (survive across renders without triggering re-renders) ──
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const turnRef = useRef(0);
  const isPlayingRef = useRef(false);
  const gapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const speedRef = useRef(1);
  const abortRef = useRef<AbortController | null>(null);
  const autoPlayStarted = useRef(false);
  const restoredFromIDB = useRef(false);
  const persistTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Persist helpers ──

  /** Convert blob URLs in TTS data to ArrayBuffers and save to IndexedDB */
  const persistFullSession = useCallback(
    async (s: AudioScript, data: TTSAudioData, turnIdx: number, elapsedSec: number, playing: boolean) => {
      try {
        const storedChunks: StoredAudioChunk[] = await Promise.all(
          data.chunks.map(async (c) => {
            const resp = await fetch(c.blobUrl);
            const buffer = await resp.arrayBuffer();
            return { turnIndex: c.turnIndex, buffer, duration: c.duration };
          }),
        );
        await saveAudioSession(s, storedChunks, turnIdx, elapsedSec, playing);
      } catch {
        // best-effort
      }
    },
    [],
  );

  // Keep a ref to the active audio data (stream or final)
  const streamDataRef = useRef<TTSAudioData | null>(null);

  // Build partial TTSAudioData from streamed chunks
  useEffect(() => {
    if (streamChunks.length > 0 && !ttsData && script) {
      const partial: TTSAudioData = {
        scriptId: script.id,
        chunks: streamChunks,
        totalDuration: streamChunks.reduce((s, c) => s + c.duration, 0),
        totalCharacters: streamChunks.reduce(
          (s, _c, i) => s + (script.turns[i]?.text.length ?? 0),
          0,
        ),
      };
      streamDataRef.current = partial;
      // Also update the active ref so playChunk sees data immediately
      // (prevents race condition where auto-play fires before render updates the ref)
      activeAudioDataRef.current = partial;
    }
  }, [streamChunks, ttsData, script]);

  const activeAudioData = ttsData ?? streamDataRef.current;
  const activeAudioDataRef = useRef(activeAudioData);
  activeAudioDataRef.current = activeAudioData;

  // Cumulative durations for elapsed time tracking
  const cumulativeDurations = useRef<number[]>([]);
  useEffect(() => {
    const data = activeAudioData;
    if (!data) {
      cumulativeDurations.current = [];
      return;
    }
    let sum = 0;
    cumulativeDurations.current = data.chunks.map((c) => {
      const prev = sum;
      sum += c.duration;
      return prev;
    });
  }, [activeAudioData]);

  const totalDuration = activeAudioData?.totalDuration ?? 0;

  // ── Elapsed time tracker ──
  const updateElapsed = useCallback(() => {
    if (!isPlayingRef.current || !audioRef.current) return;
    const chunkStart = cumulativeDurations.current[turnRef.current] ?? 0;
    const currentTime = audioRef.current.currentTime ?? 0;
    setElapsed(chunkStart + currentTime);
    animFrameRef.current = requestAnimationFrame(updateElapsed);
  }, []);

  // ── Play a specific chunk ──
  const playChunk = useCallback(
    (index: number) => {
      const data = activeAudioDataRef.current;
      if (!data || index >= data.chunks.length) {
        // Streaming: wait for more chunks
        if (data && index >= data.chunks.length && isPlayingRef.current) {
          gapTimerRef.current = setTimeout(() => playChunk(index), 500);
          return;
        }
        // Finished — reset to start so play() restarts from the beginning
        setIsPlaying(false);
        isPlayingRef.current = false;
        turnRef.current = 0;
        setCurrentTurnIndex(0);
        setElapsed(0);
        if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
        return;
      }

      const chunk = data.chunks[index];
      turnRef.current = index;
      setCurrentTurnIndex(index);

      if (!audioRef.current) {
        audioRef.current = new Audio();
      }

      const audio = audioRef.current;
      audio.playbackRate = speedRef.current;
      audio.src = chunk.blobUrl;

      audio.onended = () => {
        if (!isPlayingRef.current) return;
        gapTimerRef.current = setTimeout(() => playChunk(index + 1), TURN_GAP_MS);
      };

      audio.onerror = () => {
        setIsPlaying(false);
        isPlayingRef.current = false;
      };

      audio.play().catch(() => {
        setIsPlaying(false);
        isPlayingRef.current = false;
      });

      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = requestAnimationFrame(updateElapsed);
    },
    [updateElapsed],
  );

  // ── Auto-play when first chunk streams in ──
  useEffect(() => {
    if (streamChunks.length === 2 && !autoPlayStarted.current) {
      autoPlayStarted.current = true;
      setTimeout(() => {
        setIsPlaying(true);
        isPlayingRef.current = true;
        playChunk(0);
      }, 50);
    }
  }, [streamChunks.length, playChunk]);

  // ── Restore audio session from IndexedDB on mount ──
  useEffect(() => {
    if (restoredFromIDB.current) return;
    restoredFromIDB.current = true;

    loadAudioSession().then((session) => {
      if (!session) return;

      // Recreate blob URLs from stored ArrayBuffers
      const chunks: TTSAudioChunk[] = session.chunks.map((sc) => {
        const blob = new Blob([sc.buffer], { type: 'audio/mpeg' });
        return { turnIndex: sc.turnIndex, blobUrl: URL.createObjectURL(blob), duration: sc.duration };
      });

      const data: TTSAudioData = {
        scriptId: session.script.id,
        chunks,
        totalDuration: chunks.reduce((s, c) => s + c.duration, 0),
        totalCharacters: session.script.turns.reduce((s, t) => s + t.text.length, 0),
      };

      setScript(session.script);
      setTtsData(data);
      autoPlayStarted.current = true;

      // Resume from stored position
      const startTurn = Math.min(session.currentTurnIndex, chunks.length - 1);
      turnRef.current = startTurn;
      setCurrentTurnIndex(startTurn);
      setElapsed(session.elapsed);

      // Auto-play if was playing before refresh
      if (session.wasPlaying) {
        setTimeout(() => {
          setIsPlaying(true);
          isPlayingRef.current = true;
          playChunk(startTurn);
        }, 100);
      }
    });
  }, [playChunk]);

  // ── Periodically save playback position to IndexedDB ──
  useEffect(() => {
    if (isPlaying && ttsData && script) {
      persistTimerRef.current = setInterval(() => {
        savePlaybackPosition(turnRef.current, cumulativeDurations.current[turnRef.current] ?? 0, true);
      }, 3000);
    }
    return () => {
      if (persistTimerRef.current) {
        clearInterval(persistTimerRef.current);
        persistTimerRef.current = null;
      }
    };
  }, [isPlaying, ttsData, script]);

  // ── Save full session when TTS generation completes ──
  useEffect(() => {
    if (ttsData && script && !isGenerating) {
      persistFullSession(script, ttsData, turnRef.current, 0, isPlayingRef.current);
    }
  }, [ttsData, script, isGenerating, persistFullSession]);

  // ── Save position on page unload ──
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (script && ttsData) {
        savePlaybackPosition(turnRef.current, cumulativeDurations.current[turnRef.current] ?? 0, isPlayingRef.current);
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [script, ttsData]);

  // ── Controls ──

  const play = useCallback(() => {
    if (!activeAudioDataRef.current || isPlayingRef.current) return;
    setIsPlaying(true);
    isPlayingRef.current = true;
    playChunk(turnRef.current);
  }, [playChunk]);

  const pause = useCallback(() => {
    if (!isPlayingRef.current) return;
    audioRef.current?.pause();
    setIsPlaying(false);
    isPlayingRef.current = false;
    if (gapTimerRef.current) clearTimeout(gapTimerRef.current);
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
  }, []);

  const stop = useCallback(() => {
    pause();
    turnRef.current = 0;
    setCurrentTurnIndex(0);
    setElapsed(0);
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
    }
  }, [pause]);

  const close = useCallback(() => {
    stop();
    abortRef.current?.abort();
    // Only clear IndexedDB if audio wasn't fully generated (preserve for replay)
    if (!ttsData) clearAudioSession();
    setScript(null);
    setTtsData(null);
    setStreamChunks([]);
    streamDataRef.current = null;
    setGenProgress(null);
    setError(null);
    setIsGenerating(false);
    autoPlayStarted.current = false;
  }, [stop, ttsData]);

  const setSpeed = useCallback((newSpeed: number) => {
    setSpeedState(newSpeed);
    speedRef.current = newSpeed;
    if (audioRef.current) {
      audioRef.current.playbackRate = newSpeed;
    }
  }, []);

  const download = useCallback(() => {
    const data = ttsData;
    const s = script;
    if (!data || !s) return;
    const name =
      s.source.type === 'game'
        ? `chess-analysis-${s.source.gameId}.mp3`
        : `chess-summary-${s.source.gameCount}games.mp3`;
    downloadTTSAudio(data, name);
  }, [ttsData, script]);

  const generateAndPlay = useCallback(
    async (
      settings: UserSettings,
      games: GameRecord[],
      analyses: GameAnalysis[],
      patterns: CurrentPatterns,
      profileScores: { dimension: string; score: number }[],
    ) => {
      // If already generating, ignore
      if (isGenerating) return;

      // Reset previous state
      close();

      setIsGenerating(true);
      setError(null);

      try {
        // Step 1: Generate script
        const newScript = await generateSummaryAudioScript(
          settings,
          games,
          analyses,
          patterns,
          profileScores,
          'podcast',
        );

        if (!newScript) {
          setError('Failed to generate script');
          setIsGenerating(false);
          return;
        }

        setScript(newScript);

        // Step 2: Check TTS cache
        const cached = getCachedTTS(newScript.id);
        if (cached) {
          setTtsData(cached);
          setIsGenerating(false);
          // Auto-play cached
          setTimeout(() => {
            autoPlayStarted.current = true;
            setIsPlaying(true);
            isPlayingRef.current = true;
            playChunk(0);
          }, 50);
          return;
        }

        // Step 3: Generate TTS with streaming
        const controller = new AbortController();
        abortRef.current = controller;
        setGenProgress({ done: 0, total: newScript.turns.length });

        const data = await generateTTSAudio(
          settings,
          newScript,
          (done, total) => setGenProgress({ done, total }),
          controller.signal,
          (chunk) => setStreamChunks((prev) => [...prev, chunk]),
        );

        setTtsData(data);
        setGenProgress(null);
        setIsGenerating(false);
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
        console.error('[Chess DNA] Audio generation failed:', err);
        setError(err instanceof Error ? err.message : 'Generation failed');
        setIsGenerating(false);
      }
    },
    [close, playChunk], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const generateGameAndPlay = useCallback(
    async (
      settings: UserSettings,
      game: GameRecord,
      analysis: GameAnalysis,
    ) => {
      if (isGenerating) return;

      close();
      setIsGenerating(true);
      setError(null);

      try {
        const newScript = await generateGameAudioScript(settings, game, analysis, 'podcast');

        if (!newScript) {
          setError('Failed to generate script');
          setIsGenerating(false);
          return;
        }

        setScript(newScript);

        const cached = getCachedTTS(newScript.id);
        if (cached) {
          setTtsData(cached);
          setIsGenerating(false);
          setTimeout(() => {
            autoPlayStarted.current = true;
            setIsPlaying(true);
            isPlayingRef.current = true;
            playChunk(0);
          }, 50);
          return;
        }

        const controller = new AbortController();
        abortRef.current = controller;
        setGenProgress({ done: 0, total: newScript.turns.length });

        const data = await generateTTSAudio(
          settings,
          newScript,
          (done, total) => setGenProgress({ done, total }),
          controller.signal,
          (chunk) => setStreamChunks((prev) => [...prev, chunk]),
        );

        setTtsData(data);
        setGenProgress(null);
        setIsGenerating(false);
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
        console.error('[Chess DNA] Game audio generation failed:', err);
        setError(err instanceof Error ? err.message : 'Generation failed');
        setIsGenerating(false);
      }
    },
    [close, playChunk], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // ── Build context value ──

  const currentTurn = script?.turns[currentTurnIndex] ?? null;
  const estimatedCost = script ? estimateTTSCost(script) : 0;

  const state: AudioPlayerState = {
    script,
    isPlaying,
    isGenerating,
    currentTurnIndex,
    currentTurn,
    elapsed,
    duration: totalDuration,
    speed,
    genProgress,
    error,
    ttsData,
    estimatedCost,
  };

  const controls: AudioPlayerControls = {
    generateAndPlay,
    generateGameAndPlay,
    play,
    pause,
    stop,
    close,
    setSpeed,
    download,
  };

  return (
    <AudioPlayerContext.Provider value={{ state, controls }}>
      {children}
    </AudioPlayerContext.Provider>
  );
}

export const useAudioPlayer = () => useContext(AudioPlayerContext);

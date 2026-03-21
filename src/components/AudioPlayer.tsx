/**
 * AudioPlayer — multi-mode audio player.
 *
 * Modes (in priority order):
 * 1. PodcastPlayer:    Google Cloud Podcast API (single MP3, NotebookLM quality)
 * 2. OpenAITTSPlayer:  OpenAI TTS API (natural voices, per-turn MP3 chunks)
 * 3. WebSpeechPlayer:  Web Speech API (browser voices, free fallback)
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import type { AudioScript, SpeakerTurn, TTSAudioChunk, TTSAudioData } from '@shared/types/audio';
import type { PodcastAudioData } from '@shared/types/podcast';
import type { UserSettings } from '@shared/types/storage';
import { generateTTSAudio, estimateTTSCost, getCachedTTS, downloadTTSAudio } from '@/ai/tts-client';
import { downloadPodcastFile } from '@/ai/podcast-client';
import { useTTSPlayback } from '@/hooks/useTTSPlayback';

interface AudioPlayerProps {
  /** Script-based playback (OpenAI TTS / Web Speech) */
  script?: AudioScript;
  /** Podcast-based playback (single MP3 from Google Cloud Podcast API) */
  podcastAudio?: PodcastAudioData;
  settings: UserSettings;
  onClose?: () => void;
}

const SPEEDS = [0.75, 1, 1.25, 1.5];

export default function AudioPlayer({ script, podcastAudio, settings, onClose }: AudioPlayerProps) {
  // Podcast audio takes priority (single MP3, highest quality)
  if (podcastAudio) {
    return <PodcastPlayer audio={podcastAudio} onClose={onClose} />;
  }

  // Script-based playback
  if (script) {
    const useOpenAI = !!settings.openaiApiKey;
    if (useOpenAI) {
      return <OpenAITTSPlayer script={script} settings={settings} onClose={onClose} />;
    }
    return <WebSpeechPlayer script={script} onClose={onClose} />;
  }

  return null;
}

/* ══════════════════════════════════════════════════════════════
 *  Google Cloud Podcast Player (single MP3 blob)
 * ══════════════════════════════════════════════════════════════ */

function PodcastPlayer({
  audio,
  onClose,
}: {
  audio: PodcastAudioData;
  onClose?: () => void;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const animRef = useRef<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [speedIndex, setSpeedIndex] = useState(1);

  // Create audio element on mount
  useEffect(() => {
    const el = new Audio(audio.blobUrl);
    audioRef.current = el;

    el.onended = () => setIsPlaying(false);
    el.onerror = () => setIsPlaying(false);

    return () => {
      el.pause();
      el.src = '';
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
  }, [audio.blobUrl]);

  // Track current time
  const updateTime = useCallback(() => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
    }
    animRef.current = requestAnimationFrame(updateTime);
  }, []);

  const handlePlayPause = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
      if (animRef.current) cancelAnimationFrame(animRef.current);
    } else {
      audioRef.current.play().catch(() => setIsPlaying(false));
      setIsPlaying(true);
      animRef.current = requestAnimationFrame(updateTime);
    }
  };

  const handleStop = () => {
    if (!audioRef.current) return;
    audioRef.current.pause();
    audioRef.current.currentTime = 0;
    setIsPlaying(false);
    setCurrentTime(0);
    if (animRef.current) cancelAnimationFrame(animRef.current);
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!audioRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    audioRef.current.currentTime = pct * audio.duration;
    setCurrentTime(audioRef.current.currentTime);
  };

  const handleSpeedCycle = () => {
    const nextIdx = (speedIndex + 1) % SPEEDS.length;
    setSpeedIndex(nextIdx);
    if (audioRef.current) audioRef.current.playbackRate = SPEEDS[nextIdx];
  };

  const handleDownload = () => {
    const name = audio.source.type === 'game'
      ? `chess-podcast-${audio.source.gameId}.mp3`
      : `chess-podcast-${audio.source.gameCount}games.mp3`;
    downloadPodcastFile(audio, name);
  };

  const progressPct = audio.duration > 0 ? (currentTime / audio.duration) * 100 : 0;

  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="bg-chess-surface/50 rounded-lg border border-chess-border/30 overflow-hidden">
      {/* Seekable progress bar */}
      <div
        className="w-full bg-chess-muted/40 h-1.5 cursor-pointer"
        onClick={handleSeek}
      >
        <div
          className="h-full bg-chess-accent transition-all duration-100"
          style={{ width: `${Math.min(progressPct, 100)}%` }}
        />
      </div>

      {/* Podcast badge */}
      <div className="px-3 py-2 border-b border-chess-border/20">
        <div className="flex items-center gap-1.5">
          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-400">
            Podcast
          </span>
          <span className="text-[9px] text-gray-500">NotebookLM</span>
          <span className="text-[9px] text-gray-600 ml-auto">
            {formatTime(audio.duration)}
          </span>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2 px-3 py-1.5">
        {/* Play/Pause */}
        <button
          onClick={handlePlayPause}
          className="w-7 h-7 rounded-full bg-chess-accent/15 text-chess-accent flex items-center justify-center hover:bg-chess-accent/25 transition-colors"
        >
          {isPlaying ? (
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" />
            </svg>
          ) : (
            <svg className="w-3.5 h-3.5 ml-0.5" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="5,3 19,12 5,21" />
            </svg>
          )}
        </button>

        {/* Stop */}
        <button
          onClick={handleStop}
          className="w-7 h-7 rounded-full bg-chess-border/30 text-gray-400 flex items-center justify-center hover:text-chess-text-secondary transition-colors"
        >
          <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
            <rect x="4" y="4" width="16" height="16" />
          </svg>
        </button>

        {/* Speed */}
        <button
          onClick={handleSpeedCycle}
          className="text-[10px] font-bold text-gray-400 hover:text-chess-text-secondary transition-colors px-1.5 py-0.5 rounded bg-chess-border/20"
        >
          {SPEEDS[speedIndex]}x
        </button>

        {/* Download */}
        <button
          onClick={handleDownload}
          className="w-7 h-7 rounded-full bg-chess-border/30 text-gray-400 flex items-center justify-center hover:text-chess-text-secondary transition-colors"
          title="Download MP3"
        >
          <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 16l-5-5h3V4h4v7h3l-5 5z" /><rect x="5" y="18" width="14" height="2" />
          </svg>
        </button>

        {/* Time */}
        <span className="text-[10px] text-gray-500 ml-auto">
          {formatTime(currentTime)} / {formatTime(audio.duration)}
        </span>

        {/* Close */}
        {onClose && (
          <button
            onClick={() => {
              handleStop();
              onClose();
            }}
            className="text-gray-500 hover:text-chess-text-secondary text-xs ml-1"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
 *  OpenAI TTS Player
 * ══════════════════════════════════════════════════════════════ */

function OpenAITTSPlayer({
  script,
  settings,
  onClose,
}: {
  script: AudioScript;
  settings: UserSettings;
  onClose?: () => void;
}) {
  const cachedData = getCachedTTS(script.id);
  const [ttsData, setTtsData] = useState<TTSAudioData | null>(cachedData);
  const [streamChunks, setStreamChunks] = useState<TTSAudioChunk[]>(cachedData?.chunks ?? []);
  const [genProgress, setGenProgress] = useState<{ done: number; total: number } | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [useFallback, setUseFallback] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const autoPlayStarted = useRef(false);

  // Build a partial TTSAudioData from streamed chunks for playback
  const streamData = useRef<TTSAudioData | null>(null);
  if (streamChunks.length > 0 && !ttsData) {
    streamData.current = {
      scriptId: script.id,
      chunks: streamChunks,
      totalDuration: streamChunks.reduce((s, c) => s + c.duration, 0),
      totalCharacters: streamChunks.reduce((s, _c, i) => s + (script.turns[i]?.text.length ?? 0), 0),
    };
  }

  const activeAudioData = ttsData ?? streamData.current;
  const [playbackState, controls] = useTTSPlayback(activeAudioData);
  const [speedIndex, setSpeedIndex] = useState(1);

  const estimatedCost = estimateTTSCost(script);

  // Auto-generate TTS audio on mount (if not cached)
  useEffect(() => {
    if (ttsData || useFallback) return;

    const controller = new AbortController();
    abortRef.current = controller;
    setGenerating(true);
    setGenProgress({ done: 0, total: script.turns.length });
    setError(null);

    generateTTSAudio(
      settings,
      script,
      (done, total) => setGenProgress({ done, total }),
      controller.signal,
      // Stream: add each chunk as it becomes available
      (chunk) => setStreamChunks((prev) => [...prev, chunk]),
    )
      .then((data) => {
        setTtsData(data);
        setGenProgress(null);
        setGenerating(false);
      })
      .catch((err) => {
        if (err instanceof Error && err.name === 'AbortError') return;
        console.error('[Chess DNA] TTS generation failed:', err);
        setError(err instanceof Error ? err.message : 'TTS generation failed');
        setGenProgress(null);
        setGenerating(false);
      });

    return () => {
      controller.abort();
    };
  }, [script.id, settings.openaiApiKey, useFallback]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-play when first chunk is ready
  useEffect(() => {
    if (streamChunks.length === 1 && !autoPlayStarted.current && !playbackState.isPlaying) {
      autoPlayStarted.current = true;
      // Small delay to let the hook update with the new data
      setTimeout(() => controls.play(), 50);
    }
  }, [streamChunks.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fallback to Web Speech
  if (useFallback) {
    return <WebSpeechPlayer script={script} onClose={onClose} />;
  }

  // Error state (only show if no chunks at all)
  if (error && streamChunks.length === 0) {
    return (
      <div className="bg-chess-surface/50 rounded-lg border border-chess-border/30 px-3 py-2.5">
        <div className="flex items-center justify-between">
          <span className="text-xs text-chess-blunder">{error}</span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setUseFallback(true)}
              className="text-[10px] text-gray-400 hover:text-chess-text-secondary transition-colors"
            >
              Use browser voices
            </button>
            {onClose && (
              <button onClick={onClose} className="text-gray-500 hover:text-chess-text-secondary text-xs ml-1">
                ✕
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // No chunks yet — pure loading
  if (!activeAudioData || streamChunks.length === 0) {
    return (
      <div className="bg-chess-surface/50 rounded-lg border border-chess-border/30 overflow-hidden">
        <div className="w-full bg-chess-muted/40 h-0.5">
          <div className="h-full bg-chess-accent transition-all duration-300 w-[5%]" />
        </div>
        <div className="flex items-center justify-between px-3 py-2.5">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 border-2 border-chess-accent border-t-transparent rounded-full animate-spin" />
            <span className="text-xs text-chess-text-secondary">Generating audio...</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[9px] text-gray-500">~${estimatedCost.toFixed(2)}</span>
            {onClose && (
              <button onClick={() => { abortRef.current?.abort(); onClose(); }}
                className="text-gray-500 hover:text-chess-text-secondary text-xs">✕</button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Playing / ready state (may still be generating remaining chunks)
  const currentTurn: SpeakerTurn | undefined = script.turns[playbackState.currentTurnIndex];
  const progressPct = playbackState.totalDuration > 0
    ? (playbackState.totalElapsed / playbackState.totalDuration) * 100
    : 0;

  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const handleSpeedCycle = () => {
    const nextIdx = (speedIndex + 1) % SPEEDS.length;
    setSpeedIndex(nextIdx);
    controls.setSpeed(SPEEDS[nextIdx]);
  };

  const handlePlayPause = () => {
    if (playbackState.isPlaying) controls.pause();
    else controls.play();
  };

  const handleDownload = () => {
    if (!ttsData) return;
    const name = script.source.type === 'game'
      ? `chess-analysis-${script.source.gameId}.mp3`
      : `chess-summary-${script.source.gameCount}games.mp3`;
    downloadTTSAudio(ttsData, name);
  };

  return (
    <div className="bg-chess-surface/50 rounded-lg border border-chess-border/30 overflow-hidden">
      {/* Progress bar */}
      <div className="w-full bg-chess-muted/40 h-0.5">
        <div
          className="h-full bg-chess-accent transition-all duration-150"
          style={{ width: `${Math.min(progressPct, 100)}%` }}
        />
      </div>

      {/* Current turn text */}
      {currentTurn && (
        <div className="px-3 py-2 border-b border-chess-border/20">
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
              currentTurn.speaker === 'A'
                ? 'bg-chess-accent/15 text-chess-accent'
                : 'bg-blue-500/15 text-blue-400'
            }`}>
              {script.style === 'podcast'
                ? (currentTurn.speaker === 'A' ? 'Host' : 'Commentator')
                : 'Narrator'}
            </span>
            <span className="text-[9px] text-gray-500">
              {playbackState.currentTurnIndex + 1}/{script.turns.length}
            </span>
            {generating && genProgress && (
              <span className="text-[9px] text-gray-600 ml-auto flex items-center gap-1">
                <span className="w-1.5 h-1.5 bg-chess-accent rounded-full animate-pulse" />
                {genProgress.done}/{genProgress.total}
              </span>
            )}
          </div>
          <p className="text-xs text-chess-text-secondary leading-relaxed line-clamp-3">
            {currentTurn.text}
          </p>
        </div>
      )}

      {/* Controls */}
      <div className="flex items-center gap-2 px-3 py-1.5">
        {/* Play/Pause */}
        <button
          onClick={handlePlayPause}
          className="w-7 h-7 rounded-full bg-chess-accent/15 text-chess-accent flex items-center justify-center hover:bg-chess-accent/25 transition-colors"
        >
          {playbackState.isPlaying ? (
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" />
            </svg>
          ) : (
            <svg className="w-3.5 h-3.5 ml-0.5" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="5,3 19,12 5,21" />
            </svg>
          )}
        </button>

        {/* Stop */}
        <button
          onClick={controls.stop}
          className="w-7 h-7 rounded-full bg-chess-border/30 text-gray-400 flex items-center justify-center hover:text-chess-text-secondary transition-colors"
        >
          <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
            <rect x="4" y="4" width="16" height="16" />
          </svg>
        </button>

        {/* Speed */}
        <button
          onClick={handleSpeedCycle}
          className="text-[10px] font-bold text-gray-400 hover:text-chess-text-secondary transition-colors px-1.5 py-0.5 rounded bg-chess-border/20"
        >
          {SPEEDS[speedIndex]}x
        </button>

        {/* Download (only when fully generated) */}
        {ttsData && (
          <button
            onClick={handleDownload}
            className="w-7 h-7 rounded-full bg-chess-border/30 text-gray-400 flex items-center justify-center hover:text-chess-text-secondary transition-colors"
            title="Download MP3"
          >
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 16l-5-5h3V4h4v7h3l-5 5z" /><rect x="5" y="18" width="14" height="2" />
            </svg>
          </button>
        )}

        {/* Time + cost */}
        <span className="text-[10px] text-gray-500 ml-auto">
          {formatTime(playbackState.totalElapsed)} / {formatTime(playbackState.totalDuration)}
        </span>
        <span className="text-[9px] text-gray-600">~${estimatedCost.toFixed(2)}</span>

        {/* Close */}
        {onClose && (
          <button
            onClick={() => {
              controls.stop();
              abortRef.current?.abort();
              onClose();
            }}
            className="text-gray-500 hover:text-chess-text-secondary text-xs ml-1"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
 *  Web Speech API Fallback Player
 * ══════════════════════════════════════════════════════════════ */

function WebSpeechPlayer({
  script,
  onClose,
}: {
  script: AudioScript;
  onClose?: () => void;
}) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTurnIndex, setCurrentTurnIndex] = useState(0);
  const [speedIndex, setSpeedIndex] = useState(1);
  const synthRef = useRef<SpeechSynthesis | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const voicesRef = useRef<{ a: SpeechSynthesisVoice | null; b: SpeechSynthesisVoice | null }>({
    a: null,
    b: null,
  });
  const turnIndexRef = useRef(0);
  const isPlayingRef = useRef(false);

  useEffect(() => {
    synthRef.current = window.speechSynthesis;

    const loadVoices = () => {
      const voices = synthRef.current?.getVoices() ?? [];
      const englishVoices = voices.filter(
        (v) => v.lang.startsWith('en') && !v.name.includes('Compact'),
      );
      if (englishVoices.length >= 2) {
        voicesRef.current.a = englishVoices[0];
        voicesRef.current.b = englishVoices[Math.min(1, englishVoices.length - 1)];
      } else if (englishVoices.length === 1) {
        voicesRef.current.a = englishVoices[0];
        voicesRef.current.b = englishVoices[0];
      }
    };

    loadVoices();
    speechSynthesis.addEventListener('voiceschanged', loadVoices);

    return () => {
      speechSynthesis.removeEventListener('voiceschanged', loadVoices);
      synthRef.current?.cancel();
    };
  }, []);

  const speakTurn = useCallback(
    (index: number) => {
      if (!synthRef.current || index >= script.turns.length) {
        setIsPlaying(false);
        isPlayingRef.current = false;
        return;
      }

      const turn = script.turns[index];
      const utterance = new SpeechSynthesisUtterance(turn.text);

      if (turn.speaker === 'A') {
        if (voicesRef.current.a) utterance.voice = voicesRef.current.a;
        utterance.pitch = 1.0;
      } else {
        if (voicesRef.current.b) utterance.voice = voicesRef.current.b;
        utterance.pitch = 1.15;
      }

      utterance.rate = SPEEDS[speedIndex];

      utterance.onend = () => {
        if (!isPlayingRef.current) return;
        const nextIndex = turnIndexRef.current + 1;
        turnIndexRef.current = nextIndex;
        setCurrentTurnIndex(nextIndex);
        if (nextIndex < script.turns.length) {
          speakTurn(nextIndex);
        } else {
          setIsPlaying(false);
          isPlayingRef.current = false;
        }
      };

      utterance.onerror = () => {
        setIsPlaying(false);
        isPlayingRef.current = false;
      };

      utteranceRef.current = utterance;
      synthRef.current.speak(utterance);
    },
    [script.turns, speedIndex],
  );

  const handlePlay = useCallback(() => {
    if (!synthRef.current) return;
    if (isPlaying) {
      synthRef.current.cancel();
      setIsPlaying(false);
      isPlayingRef.current = false;
    } else {
      setIsPlaying(true);
      isPlayingRef.current = true;
      turnIndexRef.current = currentTurnIndex;
      speakTurn(currentTurnIndex);
    }
  }, [isPlaying, currentTurnIndex, speakTurn]);

  const handleStop = useCallback(() => {
    synthRef.current?.cancel();
    setIsPlaying(false);
    isPlayingRef.current = false;
    setCurrentTurnIndex(0);
    turnIndexRef.current = 0;
  }, []);

  const handleSpeedChange = useCallback(() => {
    const nextSpeed = (speedIndex + 1) % SPEEDS.length;
    setSpeedIndex(nextSpeed);
    if (isPlaying && synthRef.current) {
      synthRef.current.cancel();
      isPlayingRef.current = true;
      setTimeout(() => speakTurn(turnIndexRef.current), 50);
    }
  }, [speedIndex, isPlaying, speakTurn]);

  const currentTurn: SpeakerTurn | undefined = script.turns[currentTurnIndex];
  const progress = script.turns.length > 0 ? ((currentTurnIndex + 1) / script.turns.length) * 100 : 0;

  const formatDuration = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="bg-chess-surface/50 rounded-lg border border-chess-border/30 overflow-hidden">
      {/* Progress bar */}
      <div className="w-full bg-chess-muted/40 h-0.5">
        <div
          className="h-full bg-chess-accent transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Current turn text */}
      {currentTurn && (
        <div className="px-3 py-2 border-b border-chess-border/20">
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
              currentTurn.speaker === 'A'
                ? 'bg-chess-accent/15 text-chess-accent'
                : 'bg-blue-500/15 text-blue-400'
            }`}>
              {script.style === 'podcast'
                ? (currentTurn.speaker === 'A' ? 'Host' : 'Commentator')
                : 'Narrator'}
            </span>
            <span className="text-[9px] text-gray-500">
              {currentTurnIndex + 1}/{script.turns.length}
            </span>
          </div>
          <p className="text-xs text-chess-text-secondary leading-relaxed line-clamp-3">
            {currentTurn.text}
          </p>
        </div>
      )}

      {/* Controls */}
      <div className="flex items-center gap-2 px-3 py-1.5">
        <button
          onClick={handlePlay}
          className="w-7 h-7 rounded-full bg-chess-accent/15 text-chess-accent flex items-center justify-center hover:bg-chess-accent/25 transition-colors"
        >
          {isPlaying ? (
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="4" width="4" height="16" /><rect x="14" y="4" width="4" height="16" />
            </svg>
          ) : (
            <svg className="w-3.5 h-3.5 ml-0.5" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="5,3 19,12 5,21" />
            </svg>
          )}
        </button>

        <button
          onClick={handleStop}
          className="w-7 h-7 rounded-full bg-chess-border/30 text-gray-400 flex items-center justify-center hover:text-chess-text-secondary transition-colors"
        >
          <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
            <rect x="4" y="4" width="16" height="16" />
          </svg>
        </button>

        <button
          onClick={handleSpeedChange}
          className="text-[10px] font-bold text-gray-400 hover:text-chess-text-secondary transition-colors px-1.5 py-0.5 rounded bg-chess-border/20"
        >
          {SPEEDS[speedIndex]}x
        </button>

        <span className="text-[10px] text-gray-500 ml-auto">
          ~{formatDuration(script.estimatedDuration)}
        </span>

        <span className="text-[9px] text-gray-600 italic">browser voices</span>

        {onClose && (
          <button
            onClick={() => {
              synthRef.current?.cancel();
              onClose();
            }}
            className="text-gray-500 hover:text-chess-text-secondary text-xs ml-1"
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
}

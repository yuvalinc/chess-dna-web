/**
 * Hook for playing a sequence of TTS MP3 audio chunks via HTML5 Audio.
 *
 * Provides play / pause / stop / speed controls with time-based
 * progress tracking that maps back to turn indices for text display.
 *
 * Designed for streaming: audioData may grow as new chunks arrive.
 * Playback will NOT reset when chunks are appended — only when
 * the scriptId changes (i.e., an entirely different script).
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import type { TTSAudioData } from '@shared/types/audio';

export interface TTSPlaybackState {
  isPlaying: boolean;
  currentTurnIndex: number;
  /** Seconds elapsed across all completed chunks + current chunk progress */
  totalElapsed: number;
  totalDuration: number;
  speed: number;
}

export interface TTSPlaybackControls {
  play: () => void;
  pause: () => void;
  stop: () => void;
  setSpeed: (speed: number) => void;
}

const TURN_GAP_MS = 300; // silence between turns

export function useTTSPlayback(
  audioData: TTSAudioData | null,
): [TTSPlaybackState, TTSPlaybackControls] {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTurnIndex, setCurrentTurnIndex] = useState(0);
  const [totalElapsed, setTotalElapsed] = useState(0);
  const [speed, setSpeedState] = useState(1);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const turnRef = useRef(0);
  const isPlayingRef = useRef(false);
  const gapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const speedRef = useRef(1);

  // Keep a ref to audioData so callbacks always see the latest chunks
  const audioDataRef = useRef(audioData);
  audioDataRef.current = audioData;

  const totalDuration = audioData?.totalDuration ?? 0;

  // Compute cumulative durations for elapsed time tracking
  const cumulativeDurations = useRef<number[]>([]);
  useEffect(() => {
    if (!audioData) {
      cumulativeDurations.current = [];
      return;
    }
    let sum = 0;
    cumulativeDurations.current = audioData.chunks.map((c) => {
      const prev = sum;
      sum += c.duration;
      return prev; // start time of this chunk
    });
  }, [audioData]);

  // Update elapsed time via requestAnimationFrame while playing
  const updateElapsed = useCallback(() => {
    if (!isPlayingRef.current || !audioRef.current) return;

    const data = audioDataRef.current;
    if (!data) return;

    const chunkStart = cumulativeDurations.current[turnRef.current] ?? 0;
    const currentTime = audioRef.current.currentTime ?? 0;
    setTotalElapsed(chunkStart + currentTime);

    animFrameRef.current = requestAnimationFrame(updateElapsed);
  }, []); // stable — reads from refs

  // Play a specific chunk by index (reads audioData from ref for freshness)
  const playChunk = useCallback(
    (index: number) => {
      const data = audioDataRef.current;
      if (!data || index >= data.chunks.length) {
        // If still generating and we've reached the end of available chunks,
        // wait a bit and retry — a new chunk may arrive
        // (We'll know we're truly done when the component sets final ttsData)
        if (data && index >= data.chunks.length && isPlayingRef.current) {
          // Wait 500ms and check again — streaming may deliver more chunks
          gapTimerRef.current = setTimeout(() => {
            playChunk(index);
          }, 500);
          return;
        }
        // Finished all chunks or no data
        setIsPlaying(false);
        isPlayingRef.current = false;
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
        // Gap before next turn
        gapTimerRef.current = setTimeout(() => {
          playChunk(index + 1);
        }, TURN_GAP_MS);
      };

      audio.onerror = () => {
        setIsPlaying(false);
        isPlayingRef.current = false;
      };

      audio.play().catch(() => {
        setIsPlaying(false);
        isPlayingRef.current = false;
      });

      // Start elapsed timer
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = requestAnimationFrame(updateElapsed);
    },
    [updateElapsed], // stable — reads data from refs
  );

  const play = useCallback(() => {
    if (!audioDataRef.current || isPlayingRef.current) return;
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
    setTotalElapsed(0);
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
    }
  }, [pause]);

  const setSpeed = useCallback(
    (newSpeed: number) => {
      setSpeedState(newSpeed);
      speedRef.current = newSpeed;
      if (audioRef.current) {
        audioRef.current.playbackRate = newSpeed;
      }
    },
    [],
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (gapTimerRef.current) clearTimeout(gapTimerRef.current);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = '';
      }
    };
  }, []);

  // Reset when we switch to a completely different script (not just new chunks)
  const scriptIdRef = useRef(audioData?.scriptId);
  useEffect(() => {
    if (audioData?.scriptId !== scriptIdRef.current) {
      scriptIdRef.current = audioData?.scriptId;
      stop();
    }
  }, [audioData?.scriptId, stop]);

  return [
    { isPlaying, currentTurnIndex, totalElapsed, totalDuration, speed },
    { play, pause, stop, setSpeed },
  ];
}

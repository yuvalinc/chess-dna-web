/**
 * OpenAI Text-to-Speech client with in-memory caching.
 *
 * Converts AudioScript turns into natural-sounding MP3 audio via the
 * OpenAI /v1/audio/speech endpoint.  Speaker A and B get different
 * voices for the podcast style; narrator mode uses only voice A.
 */

import {
  OPENAI_TTS_ENDPOINT,
  OPENAI_TTS_COST_PER_1K_CHARS,
  TTS_SPEAKER_A_INSTRUCTIONS,
  TTS_SPEAKER_B_INSTRUCTIONS,
  TTS_NARRATOR_INSTRUCTIONS,
} from '@shared/constants';
import type { AudioScript, AudioStyle, TTSAudioChunk, TTSAudioData } from '@shared/types/audio';
import type { UserSettings } from '@shared/types/storage';

/* ─────── Speaker instructions ─────── */

function getInstructions(speaker: 'A' | 'B', style: AudioStyle, language?: string): string | undefined {
  let base: string;
  if (style === 'narrator') {
    base = TTS_NARRATOR_INSTRUCTIONS;
  } else {
    base = speaker === 'A' ? TTS_SPEAKER_A_INSTRUCTIONS : TTS_SPEAKER_B_INSTRUCTIONS;
  }
  if (language && language !== 'English') {
    base += ` Language: Speak entirely in ${language}.`;
  }
  return base;
}

/* ─────── Single-turn synthesis ─────── */

async function synthesizeSpeech(
  apiKey: string,
  text: string,
  voice: string,
  model: string,
  instructions?: string,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  const body: Record<string, unknown> = {
    model,
    input: text,
    voice,
    response_format: 'mp3',
  };
  // instructions only works with gpt-4o-mini-tts
  if (instructions && model.includes('gpt-4o')) {
    body.instructions = instructions;
  }

  const response = await fetch(OPENAI_TTS_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'unknown');
    throw new Error(`OpenAI TTS error ${response.status}: ${errorText}`);
  }

  return response.arrayBuffer();
}

/* ─────── Duration probe ─────── */

function getAudioDuration(blobUrl: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const audio = new Audio();
    audio.addEventListener('loadedmetadata', () => resolve(audio.duration));
    audio.addEventListener('error', () => reject(new Error('Failed to load audio')));
    audio.src = blobUrl;
  });
}

/* ─────── Full script generation ─────── */

export async function generateTTSAudio(
  settings: UserSettings,
  script: AudioScript,
  onProgress?: (completed: number, total: number) => void,
  signal?: AbortSignal,
  onChunkReady?: (chunk: TTSAudioChunk) => void,
): Promise<TTSAudioData> {
  const apiKey = settings.openaiApiKey;
  if (!apiKey) throw new Error('OpenAI API key not configured');

  // Check cache first
  const cached = ttsCache.get(script.id);
  if (cached) return cached;

  const chunks: TTSAudioChunk[] = [];
  let totalCharacters = 0;
  const model = settings.ttsModel || 'gpt-4o-mini-tts';

  for (let i = 0; i < script.turns.length; i++) {
    signal?.throwIfAborted();

    const turn = script.turns[i];
    const voice = turn.speaker === 'A'
      ? (settings.ttsVoiceA || 'nova')
      : (settings.ttsVoiceB || 'alloy');
    const instructions = getInstructions(turn.speaker, script.style, settings.ttsLanguage);

    const buffer = await synthesizeSpeech(apiKey, turn.text, voice, model, instructions, signal);

    const blob = new Blob([buffer], { type: 'audio/mpeg' });
    const blobUrl = URL.createObjectURL(blob);

    const duration = await getAudioDuration(blobUrl);

    const chunk: TTSAudioChunk = { turnIndex: i, blobUrl, duration };
    chunks.push(chunk);
    totalCharacters += turn.text.length;
    onProgress?.(i + 1, script.turns.length);
    onChunkReady?.(chunk);
  }

  const totalDuration = chunks.reduce((sum, c) => sum + c.duration, 0);

  const data: TTSAudioData = {
    scriptId: script.id,
    chunks,
    totalDuration,
    totalCharacters,
  };

  // Store in cache
  setCachedTTS(script.id, data);

  return data;
}

/* ─────── Cost estimation ─────── */

export function estimateTTSCost(script: AudioScript): number {
  const totalChars = script.turns.reduce((sum, t) => sum + t.text.length, 0);
  return (totalChars / 1000) * OPENAI_TTS_COST_PER_1K_CHARS;
}

/* ─────── Download as MP3 ─────── */

export async function downloadTTSAudio(audioData: TTSAudioData, filename: string): Promise<void> {
  // Fetch all chunk blobs and concatenate
  const buffers: ArrayBuffer[] = [];
  for (const chunk of audioData.chunks) {
    const resp = await fetch(chunk.blobUrl);
    buffers.push(await resp.arrayBuffer());
  }
  const totalLength = buffers.reduce((sum, b) => sum + b.byteLength, 0);
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const buf of buffers) {
    combined.set(new Uint8Array(buf), offset);
    offset += buf.byteLength;
  }
  const blob = new Blob([combined], { type: 'audio/mpeg' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ─────── Blob cleanup ─────── */

export function releaseTTSAudio(audioData: TTSAudioData): void {
  for (const chunk of audioData.chunks) {
    URL.revokeObjectURL(chunk.blobUrl);
  }
}

/* ─────── In-memory LRU cache ─────── */

const MAX_CACHE = 5;
const ttsCache = new Map<string, TTSAudioData>();

function setCachedTTS(scriptId: string, data: TTSAudioData): void {
  if (ttsCache.size >= MAX_CACHE && !ttsCache.has(scriptId)) {
    // Evict oldest entry
    const oldestKey = ttsCache.keys().next().value;
    if (oldestKey) {
      const old = ttsCache.get(oldestKey);
      if (old) releaseTTSAudio(old);
      ttsCache.delete(oldestKey);
    }
  }
  ttsCache.set(scriptId, data);
}

export function getCachedTTS(scriptId: string): TTSAudioData | null {
  return ttsCache.get(scriptId) ?? null;
}

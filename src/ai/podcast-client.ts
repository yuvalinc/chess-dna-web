/**
 * Google Cloud Podcast API client.
 *
 * Handles the full lifecycle:
 * 1. Create podcast (POST) → long-running operation
 * 2. Poll for completion (GET) every 5 seconds
 * 3. Download MP3 (GET with alt=media)
 * 4. Return single blob URL for playback
 *
 * The Podcast API takes "a few minutes" to generate — significantly
 * longer than per-turn TTS synthesis. Progress callbacks keep the UI
 * responsive during the wait.
 */

import { getGCPAccessToken } from './gcp-auth';
import {
  GCP_PODCAST_API_BASE,
  GCP_PODCAST_POLL_INTERVAL_MS,
  GCP_PODCAST_MAX_POLL_ATTEMPTS,
} from '@shared/constants';
import type {
  CreatePodcastRequest,
  PodcastOperationResponse,
  PodcastAudioData,
  PodcastGenerationPhase,
} from '@shared/types/podcast';

/* ─────── Create podcast operation ─────── */

async function createPodcast(
  projectId: string,
  clientId: string,
  request: CreatePodcastRequest,
  signal?: AbortSignal,
): Promise<string> {
  const token = await getGCPAccessToken(clientId);
  const url = `${GCP_PODCAST_API_BASE}/projects/${projectId}/locations/global/podcasts`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
    signal,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'unknown');
    if (response.status === 401 || response.status === 403) {
      throw new Error('Google Cloud authentication failed. Please reconnect in Settings.');
    }
    throw new Error(`Podcast API error ${response.status}: ${errorText}`);
  }

  const operation: PodcastOperationResponse = await response.json();
  if (!operation.name) {
    throw new Error('No operation name returned from Podcast API');
  }
  return operation.name;
}

/* ─────── Poll for completion ─────── */

async function pollOperation(
  operationName: string,
  clientId: string,
  onProgress?: (phase: PodcastGenerationPhase, elapsedMs: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  const startTime = Date.now();

  for (let attempt = 0; attempt < GCP_PODCAST_MAX_POLL_ATTEMPTS; attempt++) {
    signal?.throwIfAborted();

    // Wait before polling
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, GCP_PODCAST_POLL_INTERVAL_MS);
      // Allow abort to cancel the wait
      signal?.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
    });
    signal?.throwIfAborted();

    onProgress?.('polling', Date.now() - startTime);

    // Get fresh token (may have expired during long poll)
    const token = await getGCPAccessToken(clientId);

    const response = await fetch(
      `${GCP_PODCAST_API_BASE}/${operationName}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        signal,
      },
    );

    if (!response.ok) {
      if (response.status === 401) {
        // Token expired mid-poll — will be refreshed next iteration
        continue;
      }
      const errorText = await response.text().catch(() => 'unknown');
      throw new Error(`Poll error ${response.status}: ${errorText}`);
    }

    const result: PodcastOperationResponse = await response.json();

    if (result.error) {
      throw new Error(`Podcast generation failed: ${result.error.message}`);
    }

    if (result.done) {
      return; // Operation complete — ready to download
    }
  }

  throw new Error('Podcast generation timed out after 10 minutes');
}

/* ─────── Download MP3 ─────── */

async function downloadPodcastMP3(
  operationName: string,
  clientId: string,
  signal?: AbortSignal,
): Promise<{ blobUrl: string; duration: number }> {
  const token = await getGCPAccessToken(clientId);
  const url = `${GCP_PODCAST_API_BASE}/${operationName}:download?alt=media`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'unknown');
    throw new Error(`Download error ${response.status}: ${errorText}`);
  }

  const buffer = await response.arrayBuffer();
  const blob = new Blob([buffer], { type: 'audio/mpeg' });
  const blobUrl = URL.createObjectURL(blob);
  const duration = await getAudioDuration(blobUrl);

  return { blobUrl, duration };
}

/* ─────── Duration probe ─────── */

function getAudioDuration(blobUrl: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const audio = new Audio();
    audio.addEventListener('loadedmetadata', () => resolve(audio.duration));
    audio.addEventListener('error', () => reject(new Error('Failed to load audio metadata')));
    audio.src = blobUrl;
  });
}

/* ─────── Public API: Full generation flow ─────── */

/**
 * Generate podcast audio via the Google Cloud Podcast API.
 *
 * This is a long-running operation (~2–5 minutes). Use the onPhaseChange
 * callback to keep the UI responsive with progress updates.
 */
export async function generatePodcastAudio(
  projectId: string,
  clientId: string,
  request: CreatePodcastRequest,
  source: PodcastAudioData['source'],
  onPhaseChange?: (phase: PodcastGenerationPhase, elapsedMs: number) => void,
  signal?: AbortSignal,
): Promise<PodcastAudioData> {
  // Check cache first
  const cacheKey = buildCacheKey(source);
  const cached = podcastCache.get(cacheKey);
  if (cached) {
    onPhaseChange?.('ready', 0);
    return cached;
  }

  // Step 1: Create podcast
  onPhaseChange?.('creating', 0);
  const operationName = await createPodcast(projectId, clientId, request, signal);

  // Step 2: Poll for completion
  await pollOperation(operationName, clientId, onPhaseChange, signal);

  // Step 3: Download MP3
  onPhaseChange?.('downloading', 0);
  const { blobUrl, duration } = await downloadPodcastMP3(operationName, clientId, signal);

  const result: PodcastAudioData = {
    id: `podcast-${Date.now()}`,
    blobUrl,
    duration,
    source,
    generatedAt: Date.now(),
  };

  // Cache it
  setCachedPodcast(cacheKey, result);
  onPhaseChange?.('ready', 0);

  return result;
}

/* ─────── In-memory LRU cache ─────── */

const MAX_CACHE = 3;
const podcastCache = new Map<string, PodcastAudioData>();

function buildCacheKey(source: PodcastAudioData['source']): string {
  return source.type === 'game'
    ? `podcast-game-${source.gameId}`
    : `podcast-summary-${source.gameCount}`;
}

function setCachedPodcast(key: string, data: PodcastAudioData): void {
  if (podcastCache.size >= MAX_CACHE && !podcastCache.has(key)) {
    const oldestKey = podcastCache.keys().next().value;
    if (oldestKey) {
      const old = podcastCache.get(oldestKey);
      if (old) URL.revokeObjectURL(old.blobUrl);
      podcastCache.delete(oldestKey);
    }
  }
  podcastCache.set(key, data);
}

export function getCachedPodcast(source: PodcastAudioData['source']): PodcastAudioData | null {
  return podcastCache.get(buildCacheKey(source)) ?? null;
}

export function releasePodcastAudio(data: PodcastAudioData): void {
  URL.revokeObjectURL(data.blobUrl);
}

/**
 * Download a podcast as an MP3 file to the user's computer.
 */
export function downloadPodcastFile(data: PodcastAudioData, filename: string): void {
  const a = document.createElement('a');
  a.href = data.blobUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

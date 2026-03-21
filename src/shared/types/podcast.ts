/**
 * Types for the Google Cloud Podcast API (NotebookLM backend).
 *
 * The Podcast API takes raw context (text, images, etc.) and returns
 * a complete podcast MP3 — replacing both script generation and TTS.
 */

/* ─────── Podcast API request/response ─────── */

export type PodcastLength = 'SHORT' | 'STANDARD';

export interface PodcastConfig {
  focus?: string;
  length: PodcastLength;
  languageCode: string;
}

export interface PodcastTextContext {
  text: string;
}

export interface PodcastInlineContext {
  inlineData: {
    mimeType: string;
    data: string; // base64-encoded
  };
}

export type PodcastContext = PodcastTextContext | PodcastInlineContext;

export interface CreatePodcastRequest {
  podcastConfig: PodcastConfig;
  contexts: PodcastContext[];
  title: string;
  description: string;
}

export interface PodcastOperationResponse {
  name: string; // e.g. "projects/123456/locations/global/operations/create-podcast-54321"
  done?: boolean;
  error?: { code: number; message: string };
  metadata?: Record<string, unknown>;
}

/* ─────── Client-side types ─────── */

/** Podcast generation lifecycle phases for UI state management */
export type PodcastGenerationPhase =
  | 'idle'
  | 'creating'     // POST to create podcast operation
  | 'polling'      // Waiting for generation to complete
  | 'downloading'  // Downloading the MP3
  | 'ready'        // MP3 available for playback
  | 'error';

/** Single-blob podcast audio data (vs. multi-chunk TTSAudioData) */
export interface PodcastAudioData {
  /** Unique ID for caching */
  id: string;
  /** Single MP3 blob URL */
  blobUrl: string;
  /** Duration in seconds (probed from audio element) */
  duration: number;
  /** Source metadata */
  source:
    | { type: 'game'; gameId: string }
    | { type: 'summary'; gameCount: number };
  /** When generated */
  generatedAt: number;
}

/* ─────── OAuth token storage ─────── */

/** Stored separately from UserSettings to avoid syncing sensitive data */
export interface GCPTokenState {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // epoch ms
}

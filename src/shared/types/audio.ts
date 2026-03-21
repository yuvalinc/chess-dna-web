/** Audio script generation types (NotebookLM-style) */

export type AudioStyle = 'podcast' | 'narrator';

export interface SpeakerTurn {
  speaker: 'A' | 'B';
  text: string;
}

export interface AudioScript {
  id: string;
  generatedAt: number;
  style: AudioStyle;
  turns: SpeakerTurn[];
  source:
    | { type: 'game'; gameId: string }
    | { type: 'summary'; gameCount: number };
  estimatedDuration: number; // seconds
}

export interface AudioPlaybackState {
  isPlaying: boolean;
  currentTurnIndex: number;
  speed: number;
}

/** A single turn's pre-generated TTS audio */
export interface TTSAudioChunk {
  turnIndex: number;
  blobUrl: string;
  duration: number; // actual seconds
}

/** Full pre-generated TTS audio for an AudioScript */
export interface TTSAudioData {
  scriptId: string;
  chunks: TTSAudioChunk[];
  totalDuration: number;
  totalCharacters: number;
}

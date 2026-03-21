/**
 * IndexedDB persistence for audio playback sessions.
 *
 * Stores the AudioScript + raw audio ArrayBuffers so the player
 * can survive page refreshes.  Uses a single object store with
 * one key (`current`) — only the most recent session is kept.
 */

import type { AudioScript } from '@shared/types/audio';

// ── Types ──

export interface StoredAudioChunk {
  turnIndex: number;
  buffer: ArrayBuffer;
  duration: number;
}

export interface StoredAudioSession {
  script: AudioScript;
  chunks: StoredAudioChunk[];
  currentTurnIndex: number;
  elapsed: number;
  wasPlaying: boolean;
  savedAt: number;
}

// ── DB helpers ──

const DB_NAME = 'chess-dna-audio';
const DB_VERSION = 1;
const STORE_NAME = 'session';
const SESSION_KEY = 'current';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// ── Public API ──

export async function saveAudioSession(
  script: AudioScript,
  chunks: StoredAudioChunk[],
  currentTurnIndex: number,
  elapsed: number,
  wasPlaying: boolean,
): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const session: StoredAudioSession = {
      script,
      chunks,
      currentTurnIndex,
      elapsed,
      wasPlaying,
      savedAt: Date.now(),
    };
    store.put(session, SESSION_KEY);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (err) {
    console.warn('[audio-session-store] Failed to save:', err);
  }
}

/** Update only the playback position (cheaper than saving full chunks). */
export async function savePlaybackPosition(
  currentTurnIndex: number,
  elapsed: number,
  wasPlaying: boolean,
): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    const existing: StoredAudioSession | undefined = await new Promise((resolve, reject) => {
      const req = store.get(SESSION_KEY);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    if (existing) {
      existing.currentTurnIndex = currentTurnIndex;
      existing.elapsed = elapsed;
      existing.wasPlaying = wasPlaying;
      existing.savedAt = Date.now();
      store.put(existing, SESSION_KEY);
    }

    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (err) {
    // Silently fail — position save is best-effort
  }
}

export async function loadAudioSession(): Promise<StoredAudioSession | null> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);

    const session: StoredAudioSession | undefined = await new Promise((resolve, reject) => {
      const req = store.get(SESSION_KEY);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    db.close();

    if (!session || !session.script || !session.chunks?.length) return null;

    // Expire sessions older than 1 hour
    if (Date.now() - session.savedAt > 60 * 60 * 1000) {
      await clearAudioSession();
      return null;
    }

    return session;
  } catch (err) {
    console.warn('[audio-session-store] Failed to load:', err);
    return null;
  }
}

export async function clearAudioSession(): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(SESSION_KEY);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (err) {
    // Silently fail
  }
}

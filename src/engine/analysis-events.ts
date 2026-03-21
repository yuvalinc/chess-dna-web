/**
 * Simple typed event bus for analysis events.
 * Replaces Chrome runtime.sendMessage for the web app.
 */

export type AnalysisEventType =
  | 'progress'
  | 'complete'
  | 'all_complete'
  | 'error';

export interface AnalysisProgressEvent {
  type: 'progress';
  gameId: string;
  moveIndex: number;
  totalMoves: number;
}

export interface AnalysisCompleteEvent {
  type: 'complete';
  gameId: string;
}

export interface AnalysisAllCompleteEvent {
  type: 'all_complete';
}

export interface AnalysisErrorEvent {
  type: 'error';
  gameId: string;
  error: string;
}

export type AnalysisEvent =
  | AnalysisProgressEvent
  | AnalysisCompleteEvent
  | AnalysisAllCompleteEvent
  | AnalysisErrorEvent;

type Listener = (event: AnalysisEvent) => void;

class AnalysisEventBus {
  private listeners: Set<Listener> = new Set();

  on(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event: AnalysisEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        console.error('[AnalysisEventBus] Listener error:', err);
      }
    }
  }

  removeAll(): void {
    this.listeners.clear();
  }
}

export const analysisEvents = new AnalysisEventBus();

// Batch mode: when true, per-game 'complete' events skip refetch.
// Used during S5 sync to prevent incremental dashboard re-renders.
let _batchMode = false;
export function setBatchMode(on: boolean) { _batchMode = on; }
export function isBatchMode() { return _batchMode; }

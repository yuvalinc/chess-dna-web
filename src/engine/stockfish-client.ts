import type { PositionEval } from '@shared/types/engine';
import { parseInfoLine, parseBestMove } from './uci-parser';

type OutputCallback = (line: string) => void;

const CDN_BASE = 'https://unpkg.com/stockfish@17.1.0/src';
const SF_WASM = CDN_BASE + '/stockfish-17.1-lite-single-03e3232.wasm';

/** Default timeout per position analysis: 30 seconds */
const POSITION_TIMEOUT_MS = 30_000;
/** Timeout for init commands (uci, isready): 15 seconds */
const COMMAND_TIMEOUT_MS = 15_000;

/**
 * Singleton high-level async Stockfish client for the web app.
 * Uses a Web Worker + WASM to run Stockfish in the background.
 *
 * The stockfish npm package (v17.1 lite-single) auto-initializes in Worker
 * context and communicates via plain UCI strings (no structured messages).
 * The WASM URL is passed via the Worker URL's hash fragment.
 *
 * IMPORTANT: Must be a singleton because:
 * 1. Only one Worker instance should exist
 * 2. Multiple instances would fight over output lines
 */
class StockfishClient {
  private static instance: StockfishClient | null = null;

  private worker: Worker | null = null;
  private outputListeners: OutputCallback[] = [];
  private isInitialized = false;
  private initPromise: Promise<void> | null = null;
  private consecutiveTimeouts = 0;

  private constructor() {}

  /**
   * Get the singleton StockfishClient instance.
   */
  static getInstance(): StockfishClient {
    if (!StockfishClient.instance) {
      StockfishClient.instance = new StockfishClient();
    }
    return StockfishClient.instance;
  }

  /**
   * Whether the engine is ready to accept commands.
   */
  get isReady(): boolean {
    return this.isInitialized;
  }

  /**
   * Initialize the Stockfish worker. Creates the Web Worker, waits for
   * WASM to load, then sends "uci" and waits for "uciok".
   * Safe to call multiple times -- only initializes once.
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    // Prevent concurrent initialization
    if (this.initPromise) return this.initPromise;

    this.initPromise = this._doInit();
    try {
      await this.initPromise;
    } finally {
      this.initPromise = null;
    }
  }

  private async _doInit(): Promise<void> {
    // Create the Web Worker with WASM URL in hash fragment.
    // The stockfish IIFE reads self.location.hash to find the .wasm file.
    this.worker = new Worker('/stockfish/worker.js#' + SF_WASM);

    // Set up permanent message handler.
    // Stockfish sends plain UCI strings via postMessage.
    this.worker.onmessage = (event: MessageEvent) => {
      const line =
        typeof event.data === 'string' ? event.data : String(event.data);
      this.handleOutput(line);
    };

    // Handle worker-level errors (WASM load failure, etc.)
    this.worker.onerror = (event) => {
      console.error('[Chess DNA] Stockfish worker error:', event.message);
    };

    // Send "uci" and wait for "uciok".
    // Stockfish buffers commands until WASM is loaded, then processes them.
    await this.collectOutput(['uci'], ['uciok'], COMMAND_TIMEOUT_MS);

    this.isInitialized = true;
    this.consecutiveTimeouts = 0;
    console.log('[Chess DNA] Stockfish engine initialized');
  }

  /**
   * Route an output line to all registered listeners.
   */
  private handleOutput(line: string): void {
    for (const listener of this.outputListeners) {
      listener(line);
    }
  }

  /**
   * Send a raw UCI command to the engine (plain string).
   */
  private sendCommand(command: string): void {
    if (!this.worker) {
      console.error('[Chess DNA] Cannot send command — worker not initialized');
      return;
    }
    this.worker.postMessage(command);
  }

  /**
   * Send a sequence of UCI commands and collect output lines until one of
   * the terminator prefixes is found (e.g. "bestmove", "readyok", "uciok").
   * Times out after the specified duration (default 30s).
   * Throws on timeout so callers can detect a dead worker.
   */
  private collectOutput(
    commands: string[],
    terminators: string[] = ['bestmove', 'readyok'],
    timeoutMs: number = POSITION_TIMEOUT_MS,
  ): Promise<string[]> {
    return new Promise<string[]>((resolve, reject) => {
      const lines: string[] = [];
      let timedOut = false;

      const listener: OutputCallback = (line) => {
        lines.push(line);
        if (terminators.some((t) => line.startsWith(t))) {
          // Remove this listener
          const idx = this.outputListeners.indexOf(listener);
          if (idx >= 0) this.outputListeners.splice(idx, 1);
          if (!timedOut) {
            this.consecutiveTimeouts = 0; // reset on success
            resolve(lines);
          }
        }
      };

      this.outputListeners.push(listener);

      for (const cmd of commands) {
        this.sendCommand(cmd);
      }

      // Timeout: reject so the caller knows the worker is stuck/dead
      setTimeout(() => {
        const idx = this.outputListeners.indexOf(listener);
        if (idx >= 0) {
          timedOut = true;
          this.outputListeners.splice(idx, 1);
          this.consecutiveTimeouts++;
          console.warn(
            `[Chess DNA] Stockfish command timeout after ${timeoutMs}ms (${lines.length} lines collected, consecutive timeouts: ${this.consecutiveTimeouts})`,
          );
          reject(new Error(`Stockfish timeout after ${timeoutMs}ms — worker may be dead (consecutive: ${this.consecutiveTimeouts})`));
        }
      }, timeoutMs);
    });
  }

  /**
   * Quick health check — send "isready" and expect "readyok" within 5 seconds.
   * Returns true if healthy, false if dead/unresponsive.
   */
  async healthCheck(): Promise<boolean> {
    if (!this.isInitialized || !this.worker) return false;
    try {
      await this.collectOutput(['isready'], ['readyok'], 5_000);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Destroy and reinitialize the worker. Use after a crash or timeout.
   */
  async restart(): Promise<void> {
    console.warn('[Chess DNA] Restarting Stockfish worker...');
    this.destroy();
    // Small delay to let resources free up
    await new Promise(r => setTimeout(r, 500));
    await this.initialize();
    console.log('[Chess DNA] Stockfish worker restarted successfully');
  }

  /**
   * Ensure the engine is healthy. If not, restart it.
   * Call this before each game in a batch to prevent cascading failures.
   */
  async ensureHealthy(): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
      return;
    }
    // If we've had consecutive timeouts, the worker is likely dead
    if (this.consecutiveTimeouts >= 2) {
      console.warn(`[Chess DNA] ${this.consecutiveTimeouts} consecutive timeouts — restarting worker`);
      await this.restart();
      return;
    }
    // Quick health check
    const healthy = await this.healthCheck();
    if (!healthy) {
      await this.restart();
    }
  }

  /**
   * Analyze a position to a given depth. Returns the evaluation.
   */
  async analyzePosition(
    fen: string,
    depth: number = 18,
  ): Promise<PositionEval> {
    // Make sure the engine is ready before analysis
    await this.collectOutput(['isready'], ['readyok'], COMMAND_TIMEOUT_MS);

    const analysisLines = await this.collectOutput(
      [`position fen ${fen}`, `go depth ${depth}`],
      ['bestmove'],
      POSITION_TIMEOUT_MS,
    );

    return this.parsePositionEval(analysisLines);
  }

  /**
   * Set a UCI option (e.g. Hash, Threads).
   */
  async setOption(name: string, value: string | number): Promise<void> {
    this.sendCommand(`setoption name ${name} value ${value}`);
    await this.collectOutput(['isready'], ['readyok'], COMMAND_TIMEOUT_MS);
  }

  /**
   * Reset the engine for a new game.
   */
  async newGame(): Promise<void> {
    this.sendCommand('ucinewgame');
    await this.collectOutput(['isready'], ['readyok'], COMMAND_TIMEOUT_MS);
  }

  /**
   * Stop the current analysis.
   */
  stop(): void {
    this.sendCommand('stop');
  }

  /**
   * Terminate the worker and clean up.
   */
  destroy(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.outputListeners = [];
    this.isInitialized = false;
    this.consecutiveTimeouts = 0;
    StockfishClient.instance = null;
  }

  /**
   * Parse collected UCI output lines into a PositionEval.
   * Finds the deepest info line (multipv 1) and the bestmove line.
   */
  private parsePositionEval(lines: string[]): PositionEval {
    let bestInfo = null;
    let bestMoveStr = '';

    for (const line of lines) {
      const info = parseInfoLine(line);
      if (info && info.multipv === 1) {
        // Keep the deepest info line
        if (!bestInfo || info.depth >= bestInfo.depth) {
          bestInfo = info;
        }
      }

      const bm = parseBestMove(line);
      if (bm) {
        bestMoveStr = bm.bestMove;
      }
    }

    if (!bestInfo) {
      return {
        depth: 0,
        scoreType: 'cp',
        score: 0,
        bestMove: bestMoveStr || '',
        bestMoveSan: '',
        pv: [],
        nodes: 0,
        nps: 0,
      };
    }

    return {
      depth: bestInfo.depth,
      scoreType: bestInfo.score.type,
      score: bestInfo.score.value,
      bestMove: bestMoveStr || (bestInfo.pv[0] ?? ''),
      bestMoveSan: '', // Will be converted by the caller / analyzer
      pv: bestInfo.pv,
      nodes: bestInfo.nodes,
      nps: bestInfo.nps,
      wdl: bestInfo.wdl,
    };
  }
}

export { StockfishClient };
export default StockfishClient;

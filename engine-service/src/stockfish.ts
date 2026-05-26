/**
 * Native Stockfish process wrapper.
 *
 * Counterpart to the browser's StockfishClient (src/engine/stockfish-client.ts
 * in the main app), but talks to a real OS process over stdin/stdout instead
 * of a WASM Web Worker.
 *
 * One Stockfish process per analysis (not a singleton) — gives us per-job
 * isolation. If a position hangs, killing the process doesn't affect other jobs.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import type { PositionEval, UciInfoLine } from './types.js';
import { parseInfoLine, parseBestMove } from './engine/uci-parser.js';

const POSITION_TIMEOUT_MS = 30_000;
const COMMAND_TIMEOUT_MS = 15_000;

export class StockfishProcess {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private buffer = '';
  private lineListeners: Array<(line: string) => void> = [];
  private initialized = false;

  constructor(
    private readonly binaryPath: string = process.env.STOCKFISH_PATH ?? 'stockfish',
    private readonly threads: number = Number(process.env.STOCKFISH_THREADS ?? '1'),
    private readonly hashMb: number = Number(process.env.STOCKFISH_HASH_MB ?? '128'),
  ) {}

  async start(): Promise<void> {
    if (this.proc) return;

    this.proc = spawn(this.binaryPath, [], { stdio: ['pipe', 'pipe', 'pipe'] });

    this.proc.stdout.setEncoding('utf8');
    this.proc.stdout.on('data', (chunk: string) => {
      this.buffer += chunk;
      let idx: number;
      while ((idx = this.buffer.indexOf('\n')) !== -1) {
        const line = this.buffer.slice(0, idx).trim();
        this.buffer = this.buffer.slice(idx + 1);
        if (line) {
          for (const l of this.lineListeners) l(line);
        }
      }
    });

    this.proc.on('error', (err) => {
      console.error('[stockfish] process error:', err);
    });

    this.proc.on('exit', (code, signal) => {
      console.log(`[stockfish] exited code=${code} signal=${signal}`);
      this.proc = null;
      this.initialized = false;
    });

    await this.collectUntil(['uci'], (line) => line === 'uciok', COMMAND_TIMEOUT_MS);

    await this.setOption('Threads', String(this.threads));
    await this.setOption('Hash', String(this.hashMb));
    await this.setOption('UCI_ShowWDL', 'true');

    await this.collectUntil(['isready'], (line) => line === 'readyok', COMMAND_TIMEOUT_MS);

    this.initialized = true;
  }

  async setOption(name: string, value: string): Promise<void> {
    this.send(`setoption name ${name} value ${value}`);
    await this.collectUntil(['isready'], (line) => line === 'readyok', COMMAND_TIMEOUT_MS);
  }

  async newGame(): Promise<void> {
    this.send('ucinewgame');
    await this.collectUntil(['isready'], (line) => line === 'readyok', COMMAND_TIMEOUT_MS);
  }

  /**
   * Analyze a position to the given depth. Returns the rich PositionEval shape
   * matching @shared/types/engine.ts in the main app.
   *
   * Score is from the perspective of the SIDE TO MOVE at the given FEN. Caller
   * normalizes to white's perspective for storage/display.
   */
  async analyzePosition(fen: string, depth: number): Promise<PositionEval> {
    if (!this.initialized) {
      throw new Error('StockfishProcess not initialized — call start() first');
    }

    // Wrap in an object so TS doesn't narrow-to-null on closure-captured
    // primitives (the assignments happen inside an async callback).
    const captured: { info: UciInfoLine | null; bestMove: string } = {
      info: null,
      bestMove: '',
    };

    await this.collectUntil(
      [`position fen ${fen}`, `go depth ${depth}`],
      (line) => {
        if (line.startsWith('info ')) {
          const parsed = parseInfoLine(line);
          if (parsed && parsed.multipv === 1) {
            captured.info = parsed;
          }
        } else if (line.startsWith('bestmove ')) {
          const bm = parseBestMove(line);
          captured.bestMove = bm?.bestMove ?? '';
          return true;
        }
        return false;
      },
      POSITION_TIMEOUT_MS,
    );

    const lastInfo = captured.info;
    const bestMoveStr = captured.bestMove;

    if (!lastInfo) {
      // Stockfish returned bestmove without info — happens on mate-in-0 or
      // when the position is already checkmate. Return a stub.
      return {
        depth: 0,
        scoreType: 'cp',
        score: 0,
        bestMove: bestMoveStr,
        bestMoveSan: '',
        pv: [],
        nodes: 0,
        nps: 0,
      };
    }

    return {
      depth: lastInfo.depth,
      scoreType: lastInfo.score.type,
      score: lastInfo.score.value,
      bestMove: bestMoveStr,
      bestMoveSan: '',
      pv: lastInfo.pv,
      nodes: lastInfo.nodes,
      nps: lastInfo.nps,
      wdl: lastInfo.wdl,
    };
  }

  async stop(): Promise<void> {
    if (!this.proc) return;
    try {
      this.send('quit');
      await Promise.race([
        new Promise<void>((resolve) => this.proc?.once('exit', () => resolve())),
        delay(500),
      ]);
    } catch {
      // ignore
    }
    if (this.proc) {
      try {
        this.proc.kill('SIGKILL');
      } catch {
        // ignore
      }
      this.proc = null;
    }
    this.initialized = false;
  }

  private send(cmd: string): void {
    if (!this.proc) throw new Error('Stockfish not running');
    this.proc.stdin.write(cmd + '\n');
  }

  private async collectUntil(
    cmds: string[],
    matcher: (line: string) => boolean,
    timeoutMs: number,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Stockfish timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      const listener = (line: string) => {
        if (matcher(line)) {
          cleanup();
          resolve();
        }
      };

      const cleanup = () => {
        clearTimeout(timer);
        this.lineListeners = this.lineListeners.filter((l) => l !== listener);
      };

      this.lineListeners.push(listener);
      for (const cmd of cmds) this.send(cmd);
    });
  }
}

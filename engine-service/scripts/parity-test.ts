/**
 * Parity test: run a PGN through the Fly engine and dump the resulting
 * GameAnalysis JSON. Use this to verify that the Fly engine produces
 * results comparable to the browser WASM engine before flipping users over.
 *
 * Two modes:
 *
 *   analyze — POST a PGN to the engine, stream progress, write JSON to stdout:
 *     npx tsx scripts/parity-test.ts analyze \
 *       --pgn ./game.pgn \
 *       --engine-url https://chess-dna-engine.fly.dev \
 *       --token $BASE44_TOKEN \
 *       --player-color white \
 *       --depth 18 \
 *       > fly.json
 *
 *   compare — diff two GameAnalysis JSON files (one from Fly, one from browser):
 *     npx tsx scripts/parity-test.ts compare fly.json browser.json
 *
 * Compare drift thresholds (move-level):
 *   - moveSan must match exactly
 *   - bestMoveUci must match exactly
 *   - cpLoss within ±5 cp
 *   - winChanceLoss within ±0.01
 *   - quality bucket must match
 *   - tacticalMotifs may differ (engine non-determinism in PV ordering)
 *
 * Summary-level thresholds:
 *   - accuracy within ±0.5
 *   - acpl within ±2
 *   - blunder/mistake/inaccuracy count within ±1
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { GameAnalysis, MoveAnalysis } from '../src/types.js';

const MOVE_CP_TOLERANCE = 5;
const MOVE_WCL_TOLERANCE = 0.01;
const SUMMARY_ACCURACY_TOLERANCE = 0.5;
const SUMMARY_ACPL_TOLERANCE = 2;
const SUMMARY_COUNT_TOLERANCE = 1;

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        out[key] = next;
        i++;
      } else {
        out[key] = 'true';
      }
    }
  }
  return out;
}

async function analyzeCmd(args: Record<string, string>): Promise<void> {
  const pgnPath = args.pgn;
  const engineUrl = args['engine-url'];
  const token = args.token;
  const playerColor = (args['player-color'] ?? 'white') as 'white' | 'black';
  const depth = Number(args.depth ?? '18');

  if (!pgnPath) throw new Error('--pgn <path> required');
  if (!engineUrl) throw new Error('--engine-url <url> required');
  if (!token) throw new Error('--token <jwt> required');

  const pgn = readFileSync(resolve(pgnPath), 'utf8');
  const gameId = pgnPath.replace(/\.pgn$/, '').split('/').pop()!;

  log(`Submitting ${gameId} (${pgn.length} bytes) to ${engineUrl}`);
  const start = Date.now();

  const submitRes = await fetch(`${engineUrl}/analyze`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ gameId, pgn, depth, playerColor }),
  });

  if (!submitRes.ok) {
    throw new Error(`Submit failed: ${submitRes.status} ${await submitRes.text()}`);
  }

  const { streamUrl } = (await submitRes.json()) as { streamUrl: string };

  log(`Job submitted, opening stream ${streamUrl}`);

  const streamRes = await fetch(`${engineUrl}${streamUrl}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
  });
  if (!streamRes.ok || !streamRes.body) {
    throw new Error(`Stream failed: ${streamRes.status}`);
  }

  const reader = streamRes.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result: GameAnalysis | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let idx: number;
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const raw = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const evt = parseSSE(raw);
      if (!evt) continue;
      if (evt.event === 'progress') {
        const data = JSON.parse(evt.data) as { progress?: { moveIndex: number; totalMoves: number } };
        if (data.progress) {
          log(`  progress: ${data.progress.moveIndex}/${data.progress.totalMoves}`);
        }
      } else if (evt.event === 'complete') {
        const data = JSON.parse(evt.data) as { result: GameAnalysis };
        result = data.result;
      } else if (evt.event === 'error') {
        const data = JSON.parse(evt.data) as { error: string };
        throw new Error(`Engine error: ${data.error}`);
      }
    }
  }

  if (!result) throw new Error('Stream ended without complete event');

  const elapsed = Date.now() - start;
  log(`Done in ${elapsed}ms (${result.moves.length} moves at depth ${depth})`);

  process.stdout.write(JSON.stringify(result, null, 2));
}

async function compareCmd(args: string[]): Promise<void> {
  const flyPath = args[0];
  const browserPath = args[1];
  if (!flyPath || !browserPath) {
    throw new Error('Usage: compare <fly.json> <browser.json>');
  }
  if (!existsSync(flyPath)) throw new Error(`Not found: ${flyPath}`);
  if (!existsSync(browserPath)) throw new Error(`Not found: ${browserPath}`);

  const fly = JSON.parse(readFileSync(flyPath, 'utf8')) as GameAnalysis;
  const browser = JSON.parse(readFileSync(browserPath, 'utf8')) as GameAnalysis;

  let drift = 0;
  const issues: string[] = [];

  // ── Move-level ──
  if (fly.moves.length !== browser.moves.length) {
    issues.push(`moves.length: fly=${fly.moves.length} browser=${browser.moves.length}`);
    drift++;
  }

  const minLen = Math.min(fly.moves.length, browser.moves.length);
  let moveDrift = 0;
  for (let i = 0; i < minLen; i++) {
    const f = fly.moves[i]!;
    const b = browser.moves[i]!;
    const diffs = compareMove(f, b, i);
    if (diffs.length > 0) {
      moveDrift++;
      if (moveDrift <= 10) {
        issues.push(`move[${i}] ${f.moveSan}: ${diffs.join(', ')}`);
      }
    }
  }
  if (moveDrift > 10) {
    issues.push(`  … and ${moveDrift - 10} more move-level diffs`);
  }
  drift += moveDrift;

  // ── Summary ──
  const summaryDiffs = compareSummary(fly.summary, browser.summary);
  drift += summaryDiffs.length;
  for (const d of summaryDiffs) issues.push(`summary: ${d}`);

  // ── Report ──
  if (drift === 0) {
    console.log('PARITY ✓  no drift detected');
  } else {
    console.log(`PARITY ✗  ${drift} drift(s):`);
    for (const issue of issues) console.log(`  - ${issue}`);
  }

  process.exit(drift > 0 ? 1 : 0);
}

function compareMove(f: MoveAnalysis, b: MoveAnalysis, _idx: number): string[] {
  const diffs: string[] = [];
  if (f.moveSan !== b.moveSan) diffs.push(`moveSan ${f.moveSan} != ${b.moveSan}`);
  if (f.bestMoveUci !== b.bestMoveUci) diffs.push(`bestMoveUci ${f.bestMoveUci} != ${b.bestMoveUci}`);
  if (Math.abs(f.cpLoss - b.cpLoss) > MOVE_CP_TOLERANCE) {
    diffs.push(`cpLoss ${f.cpLoss} vs ${b.cpLoss}`);
  }
  if (Math.abs(f.winChanceLoss - b.winChanceLoss) > MOVE_WCL_TOLERANCE) {
    diffs.push(`winChanceLoss ${f.winChanceLoss} vs ${b.winChanceLoss}`);
  }
  if (f.quality !== b.quality) diffs.push(`quality ${f.quality} vs ${b.quality}`);
  return diffs;
}

function compareSummary(
  f: GameAnalysis['summary'],
  b: GameAnalysis['summary'],
): string[] {
  const diffs: string[] = [];
  if (Math.abs(f.accuracy - b.accuracy) > SUMMARY_ACCURACY_TOLERANCE) {
    diffs.push(`accuracy ${f.accuracy} vs ${b.accuracy}`);
  }
  if (Math.abs(f.acpl - b.acpl) > SUMMARY_ACPL_TOLERANCE) {
    diffs.push(`acpl ${f.acpl} vs ${b.acpl}`);
  }
  const counts = ['blunders', 'mistakes', 'inaccuracies', 'misses'] as const;
  for (const c of counts) {
    if (Math.abs(f[c] - b[c]) > SUMMARY_COUNT_TOLERANCE) {
      diffs.push(`${c} ${f[c]} vs ${b[c]}`);
    }
  }
  return diffs;
}

function parseSSE(raw: string): { event: string; data: string } | null {
  const lines = raw.split('\n');
  let event = 'message';
  let data = '';
  for (const line of lines) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) data += (data ? '\n' : '') + line.slice(5).trim();
  }
  if (!data) return null;
  return { event, data };
}

function log(msg: string): void {
  process.stderr.write(`[parity-test] ${msg}\n`);
}

async function main(): Promise<void> {
  const [, , cmd, ...rest] = process.argv;
  if (cmd === 'analyze') {
    await analyzeCmd(parseArgs(rest));
  } else if (cmd === 'compare') {
    await compareCmd(rest);
  } else {
    console.error('Usage:');
    console.error('  parity-test analyze --pgn <path> --engine-url <url> --token <jwt> [--player-color white] [--depth 18]');
    console.error('  parity-test compare <fly.json> <browser.json>');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[parity-test] FATAL:', err);
  process.exit(1);
});

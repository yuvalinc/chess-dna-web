/**
 * One-time database cleanup: delete duplicate Game records.
 *
 * The Base44 API returns max 5000 records. With thousands of duplicates
 * (same chess.com gameId), the API window fills up and pushes out real data.
 *
 * Strategy:
 * 1. Fetch all 5000 Game records
 * 2. Group by chess.com gameId
 * 3. For each group, keep the copy that has a matching Analysis record (or the newest)
 * 4. Delete all other copies
 * 5. Repeat until no more duplicates found
 *
 * Also cleans up duplicate Analysis records (same gameId).
 */
import { base44 } from '@/api/base44Client';

interface CleanupResult {
  gamesDeleted: number;
  analysesDeleted: number;
  passes: number;
  uniqueGames: number;
}

// Module-level lock so a second caller (StrictMode re-mount, context re-render, etc.)
// cannot race with an in-flight cleanup and over-delete records.
let inFlight: Promise<CleanupResult> | null = null;

export async function cleanupDuplicates(
  onProgress?: (msg: string) => void,
): Promise<CleanupResult> {
  if (inFlight) {
    onProgress?.('Cleanup already running — joining in-flight run');
    return inFlight;
  }
  inFlight = runCleanup(onProgress).finally(() => { inFlight = null; });
  return inFlight;
}

async function runCleanup(
  onProgress?: (msg: string) => void,
): Promise<CleanupResult> {
  const log = (msg: string) => {
    console.log(`[DB Cleanup] ${msg}`);
    onProgress?.(msg);
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const entities = base44.entities as any;

  let totalGamesDeleted = 0;
  let totalAnalysesDeleted = 0;
  let passes = 0;
  let uniqueGames = 0;

  // ── Phase 1: Clean duplicate Game records ──
  let foundDupes = true;
  while (foundDupes && passes < 20) {
    passes++;
    log(`Pass ${passes}: Fetching Game records...`);

    const allGames = await entities.Game.list();
    log(`Fetched ${allGames.length} Game records`);

    if (allGames.length === 0) break;

    // Fetch Analysis records to know which game entities are referenced
    const allAnalyses = passes === 1 ? await entities.Analysis.list() : [];
    const analyzedEntityIds = new Set(allAnalyses.map((a: Record<string, unknown>) => a.gameId as string));

    // Group by chess.com gameId
    const byChessId = new Map<string, Record<string, unknown>[]>();
    const noChessId: Record<string, unknown>[] = [];

    for (const g of allGames) {
      const chessId = g.gameId as string | undefined;
      if (!chessId) { noChessId.push(g); continue; }
      if (!byChessId.has(chessId)) byChessId.set(chessId, []);
      byChessId.get(chessId)!.push(g);
    }

    // Find duplicates to delete
    const toDelete: string[] = [];

    for (const [chessId, copies] of byChessId) {
      if (copies.length <= 1) continue;

      // Sort: prefer copies with Analysis match, then newest (by id string, which is roughly time-ordered)
      copies.sort((a, b) => {
        const aHasAnalysis = analyzedEntityIds.has(a.id as string) ? 1 : 0;
        const bHasAnalysis = analyzedEntityIds.has(b.id as string) ? 1 : 0;
        if (aHasAnalysis !== bHasAnalysis) return bHasAnalysis - aHasAnalysis;
        // Keep the newest (higher ID = newer in Base44)
        return (b.id as string).localeCompare(a.id as string);
      });

      // Keep the first (best), delete the rest
      for (let i = 1; i < copies.length; i++) {
        toDelete.push(copies[i].id as string);
      }

      void chessId; // used in the loop
    }

    uniqueGames = byChessId.size + noChessId.length;

    if (toDelete.length === 0) {
      log(`No duplicates found. ${uniqueGames} unique games.`);
      foundDupes = false;
      break;
    }

    log(`Found ${toDelete.length} duplicate Game records to delete...`);

    // Parallel delete with a small concurrency window. Sequential @ ~170ms each
    // means ~14 min for 4892 dupes; concurrency=5 brings it to ~3 min while
    // still staying well under typical Base44 rate limits.
    const CONCURRENCY = 5;
    let cursor = 0;
    const tickProgress = () => {
      if (totalGamesDeleted > 0 && totalGamesDeleted % 100 === 0) {
        log(`Deleted ${totalGamesDeleted} games so far...`);
      }
    };
    const worker = async () => {
      while (true) {
        const idx = cursor++;
        if (idx >= toDelete.length) return;
        const recordId = toDelete[idx];
        try {
          await entities.Game.delete(recordId);
          totalGamesDeleted++;
        } catch {
          // Rate-limited or transient — back off and retry once
          await new Promise(r => setTimeout(r, 2000));
          try {
            await entities.Game.delete(recordId);
            totalGamesDeleted++;
          } catch {
            // Give up on this one (likely RLS-protected or already gone)
          }
        }
        tickProgress();
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));

    log(`Pass ${passes} complete: deleted ${toDelete.length} duplicate games`);

    // If we hit the 5000 limit, there might be more dupes beyond the window
    if (allGames.length >= 4900) {
      log('Near 5000 limit — running another pass...');
      // Small delay to let API catch up
      await new Promise(r => setTimeout(r, 1000));
    } else {
      foundDupes = false;
    }
  }

  // ── Phase 2: Clean duplicate Analysis records ──
  log('Phase 2: Checking for duplicate Analysis records...');
  const allAnalyses = await entities.Analysis.list();
  const analysisByGameId = new Map<string, Record<string, unknown>[]>();

  for (const a of allAnalyses) {
    const gid = a.gameId as string;
    if (!gid) continue;
    if (!analysisByGameId.has(gid)) analysisByGameId.set(gid, []);
    analysisByGameId.get(gid)!.push(a);
  }

  const analysesToDelete: string[] = [];
  for (const [, copies] of analysisByGameId) {
    if (copies.length <= 1) continue;
    // Keep newest, delete rest
    copies.sort((a, b) => (b.id as string).localeCompare(a.id as string));
    for (let i = 1; i < copies.length; i++) {
      analysesToDelete.push(copies[i].id as string);
    }
  }

  if (analysesToDelete.length > 0) {
    log(`Found ${analysesToDelete.length} duplicate Analysis records to delete...`);
    const CONCURRENCY = 5;
    let cursor = 0;
    const worker = async () => {
      while (true) {
        const idx = cursor++;
        if (idx >= analysesToDelete.length) return;
        const recordId = analysesToDelete[idx];
        try {
          await entities.Analysis.delete(recordId);
          totalAnalysesDeleted++;
        } catch {
          await new Promise(r => setTimeout(r, 2000));
          try {
            await entities.Analysis.delete(recordId);
            totalAnalysesDeleted++;
          } catch { /* skip */ }
        }
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    log(`Deleted ${totalAnalysesDeleted} duplicate Analysis records`);
  } else {
    log('No duplicate Analysis records found.');
  }

  log(`Cleanup complete! Deleted ${totalGamesDeleted} games + ${totalAnalysesDeleted} analyses in ${passes} passes. ${uniqueGames} unique games remain.`);

  return {
    gamesDeleted: totalGamesDeleted,
    analysesDeleted: totalAnalysesDeleted,
    passes,
    uniqueGames,
  };
}

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
  /** Records the cleanup tried to delete twice but couldn't (RLS / 403 / etc.). */
  stuckGames: number;
  /** Sample of error messages from failed deletes — capped at 5 for display. */
  errorSamples: string[];
}

export interface AnonymousNukeResult {
  scanned: number;
  deleted: number;
  stuck: number;
  errorSamples: string[];
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

  // Records we've already tried twice and given up on (RLS-locked / already gone /
  // permanently failing). We exclude these from future passes so the loop can
  // detect "no more deletable duplicates" and exit instead of spinning forever.
  const stuckIds = new Set<string>();
  const errorSamples: string[] = [];
  const noteError = (msg: string) => {
    if (errorSamples.length < 5 && !errorSamples.includes(msg)) {
      errorSamples.push(msg);
    }
  };

  // ── Phase 1: Clean duplicate Game records ──
  // Loop until either every duplicate is deleted or every remaining duplicate
  // is stuck (we've already tried twice). Bumped to 50 passes since with RLS
  // locks we expect to converge, not blow through the cap.
  while (passes < 50) {
    passes++;
    log(`Pass ${passes}: Fetching Game records...`);

    // Critical: SDK list() defaults to limit=50. Without an explicit limit
    // the cleanup only ever inspects 50 records per pass, so a heavy backlog
    // (e.g. 3000 duplicates) takes 60+ passes to even surface. Pass 5000 —
    // the SDK's per-request maximum — so we see everything in one shot.
    const allGames = await entities.Game.list('-created_date', 5000);
    log(`Fetched ${allGames.length} Game records`);

    if (allGames.length === 0) break;

    // Fetch Analysis records to know which game entities are referenced
    const allAnalyses = passes === 1 ? await entities.Analysis.list('-created_date', 5000) : [];
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

    // Find duplicates to delete (excluding any we've already given up on)
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

      // Keep the first (best), delete the rest — but skip any we already
      // tried twice and couldn't delete. Otherwise the loop would never
      // terminate when RLS blocks every remaining duplicate.
      for (let i = 1; i < copies.length; i++) {
        const id = copies[i].id as string;
        if (stuckIds.has(id)) continue;
        toDelete.push(id);
      }

      void chessId; // used in the loop
    }

    uniqueGames = byChessId.size + noChessId.length;

    if (toDelete.length === 0) {
      const stuckTotal = stuckIds.size;
      log(stuckTotal > 0
        ? `No further deletes possible. ${uniqueGames} unique games. ${stuckTotal} duplicates stuck (likely RLS-locked).`
        : `No duplicates found. ${uniqueGames} unique games.`);
      break;
    }

    log(`Found ${toDelete.length} duplicate Game records to delete...`);

    // Parallel delete with a small concurrency window. Sequential @ ~170ms each
    // means ~14 min for 4892 dupes; concurrency=5 brings it to ~3 min while
    // still staying well under typical Base44 rate limits.
    const CONCURRENCY = 5;
    let cursor = 0;
    let passDeleted = 0;
    let passStuck = 0;
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
          passDeleted++;
        } catch (err1) {
          // Rate-limited or transient — back off and retry once
          await new Promise(r => setTimeout(r, 2000));
          try {
            await entities.Game.delete(recordId);
            totalGamesDeleted++;
            passDeleted++;
          } catch (err2) {
            // Give up on this one — mark stuck so we don't keep retrying it
            // in subsequent passes. Capture the error so we can surface why.
            stuckIds.add(recordId);
            passStuck++;
            const msg = err2 instanceof Error ? err2.message : String(err2);
            noteError(msg);
            void err1;
          }
        }
        tickProgress();
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));

    log(`Pass ${passes}: deleted ${passDeleted}, stuck ${passStuck} (running total: deleted=${totalGamesDeleted}, stuck=${stuckIds.size})`);

    // If nothing succeeded this pass, every remaining dupe is stuck — bail
    // out early instead of grinding through more passes that will all fail.
    if (passDeleted === 0) {
      log('No deletes succeeded this pass — remaining duplicates are stuck. Stopping.');
      break;
    }

    // Small delay before the next list() to let Base44 indexing catch up.
    await new Promise(r => setTimeout(r, 1000));
  }

  // ── Phase 2: Clean duplicate Analysis records ──
  log('Phase 2: Checking for duplicate Analysis records...');
  const allAnalyses = await entities.Analysis.list('-created_date', 5000);
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
  if (stuckIds.size > 0) {
    log(`${stuckIds.size} duplicate Game records could not be deleted (likely RLS-locked legacy records).`);
    if (errorSamples.length > 0) {
      log(`Sample errors: ${errorSamples.join(' | ')}`);
    }
  }

  return {
    gamesDeleted: totalGamesDeleted,
    analysesDeleted: totalAnalysesDeleted,
    passes,
    uniqueGames,
    stuckGames: stuckIds.size,
    errorSamples,
  };
}

/**
 * Nuke every Game record where `created_by_id === "anonymous"`.
 *
 * The CSV export showed 1000+ rows with anonymous owner — accumulated over
 * months from the cold-start race where chess-com-sync fired before the SDK
 * had attached the auth header. The new code prevents fresh ones from
 * appearing, but the existing orphans still pollute filter() results and
 * inflate dedup counts. Anonymous records aren't owned by any real user, so
 * the admin's account can usually delete them (RLS is permissive on
 * unowned rows). Records the admin still can't delete are reported back.
 */
export async function nukeAnonymousOrphans(
  onProgress?: (msg: string) => void,
): Promise<AnonymousNukeResult> {
  const log = (msg: string) => {
    console.log(`[Anonymous Nuke] ${msg}`);
    onProgress?.(msg);
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const entities = base44.entities as any;

  let scanned = 0;
  let deleted = 0;
  let stuck = 0;
  const errorSamples: string[] = [];

  // Iterate up to 10 list passes — each pass refetches because RLS may not
  // immediately reflect prior deletes. Bail when no anonymous rows are seen.
  for (let pass = 1; pass <= 10; pass++) {
    log(`Pass ${pass}: fetching Game records...`);
    const all = await entities.Game.list('-created_date', 5000);
    scanned = all.length;
    const anon = all.filter((g: Record<string, unknown>) => g.created_by_id === 'anonymous');
    log(`Pass ${pass}: ${all.length} total, ${anon.length} anonymous`);
    if (anon.length === 0) break;

    const CONCURRENCY = 5;
    let cursor = 0;
    let passDeleted = 0;
    let passStuck = 0;
    const worker = async () => {
      while (true) {
        const idx = cursor++;
        if (idx >= anon.length) return;
        const recordId = anon[idx].id as string;
        try {
          await entities.Game.delete(recordId);
          deleted++;
          passDeleted++;
        } catch (err1) {
          await new Promise(r => setTimeout(r, 1500));
          try {
            await entities.Game.delete(recordId);
            deleted++;
            passDeleted++;
          } catch (err2) {
            stuck++;
            passStuck++;
            const msg = err2 instanceof Error ? err2.message : String(err2);
            if (errorSamples.length < 5 && !errorSamples.includes(msg)) errorSamples.push(msg);
            void err1;
          }
        }
        if (deleted > 0 && deleted % 100 === 0) log(`Deleted ${deleted} so far...`);
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    log(`Pass ${pass}: deleted ${passDeleted}, stuck ${passStuck}`);

    if (passDeleted === 0) {
      log('No deletes succeeded this pass — remaining anonymous rows are stuck. Stopping.');
      break;
    }
    await new Promise(r => setTimeout(r, 1000));
  }

  log(`Done. Deleted ${deleted} anonymous rows, ${stuck} stuck.`);
  return { scanned, deleted, stuck, errorSamples };
}

// ─── Per-user data hygiene ─────────────────────────────────────────────
// Maintenance helpers that keep the user's Base44 account focused on their
// own data. Solve two coupled problems:
//
// 1. The `Game.list(limit: 250)` fetch was mixing the user's own games with
//    games of followed friends / top-players (which the app imports into
//    the same collection). For a user who has tracked many people, the
//    250-window gets crowded out and game cards fall back to "Pending".
//
// 2. Removing someone from the follow list never deleted their imported
//    games, leaving orphan rows accumulating indefinitely.
//
// The pattern is: tag every Game / Analysis with a flat `playerUsername`
// (added at create time — see chess-com-import.ts and analysis-pipeline.ts),
// keep only N most-recent games per followed user (sliding window), and
// remove anything whose `playerUsername` is no longer in the user's
// {self ∪ friends ∪ topPlayers} set.

interface UserCleanupOptions {
  selfUsername: string;
  followedUsernames: string[]; // friends + top players, lower-cased OK
  maxPerFollowed?: number; // default 10
  log?: (msg: string) => void;
}

export interface BackfillResult {
  scanned: number;
  updated: number;
  alreadySet: number;
  failed: number;
}

/**
 * One-time: copy `player.username.lowercase()` into a flat `playerUsername`
 * field on every Game and Analysis. Once this runs, future fetches can use
 * `Game.filter({playerUsername: x})` server-side instead of pulling 250
 * mixed records and filtering client-side.
 */
export async function backfillPlayerUsername(
  log: (msg: string) => void = () => {},
): Promise<BackfillResult> {
  const entities = base44.entities as Record<string, any>;
  const result: BackfillResult = { scanned: 0, updated: 0, alreadySet: 0, failed: 0 };
  log('Fetching all Games...');
  const games: Array<Record<string, any>> = await entities.Game.list('-playedAt', 5000);
  log(`Got ${games.length} games. Fetching all Analyses...`);
  const analyses: Array<Record<string, any>> = await entities.Analysis.list('-created_date', 5000);
  log(`Got ${analyses.length} analyses. Backfilling...`);

  // Map Analysis.gameId -> playerUsername derived from matching Game.
  const gameById = new Map(games.map(g => [g.id, g]));

  const CONCURRENCY = 8;

  const queue: Array<{ entity: string; id: string; playerUsername: string }> = [];
  for (const g of games) {
    result.scanned++;
    const want = ((g.player?.username ?? '') as string).toLowerCase();
    if (!want) continue;
    if ((g.playerUsername ?? '').toLowerCase() === want) { result.alreadySet++; continue; }
    queue.push({ entity: 'Game', id: g.id, playerUsername: want });
  }
  for (const a of analyses) {
    result.scanned++;
    const matchedGame = gameById.get(a.gameId);
    const want = ((matchedGame?.player?.username ?? '') as string).toLowerCase();
    if (!want) continue;
    if ((a.playerUsername ?? '').toLowerCase() === want) { result.alreadySet++; continue; }
    queue.push({ entity: 'Analysis', id: a.id, playerUsername: want });
  }

  log(`${queue.length} records need playerUsername set. Starting parallel updates...`);

  let nextIndex = 0;
  const worker = async () => {
    while (true) {
      const i = nextIndex++;
      if (i >= queue.length) return;
      const item = queue[i];
      try {
        await entities[item.entity].update(item.id, { playerUsername: item.playerUsername });
        result.updated++;
        if (result.updated % 100 === 0) log(`Updated ${result.updated}/${queue.length}...`);
      } catch (err) {
        result.failed++;
        if (result.failed <= 5) log(`update failed for ${item.entity} ${item.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  log(`Backfill done: updated ${result.updated}, already-set ${result.alreadySet}, failed ${result.failed}.`);
  return result;
}

export interface FollowedTrimResult {
  perUser: Record<string, { kept: number; deletedGames: number; deletedAnalyses: number }>;
  totalDeleted: number;
}

/**
 * Lighter-weight trim for a single followed user — uses the flat
 * `playerUsername` filter so we don't drag the full 5000-record list
 * across the wire. Returns deletion counts. Idempotent; if everything
 * already fits in the cap, deletes nothing.
 */
export async function trimSingleFollowedUser(
  username: string,
  maxN: number = 10,
): Promise<{ kept: number; deletedGames: number; deletedAnalyses: number }> {
  const entities = base44.entities as Record<string, any>;
  const u = username.toLowerCase();
  // Fast path: filter by playerUsername. Pre-flat-field records won't match,
  // but those are caught by the periodic full trim below.
  const theirs: Array<Record<string, any>> = await entities.Game.filter({ playerUsername: u }, '-playedAt', 5000);
  theirs.sort((a, b) => (b.playedAt ?? 0) - (a.playedAt ?? 0));
  const drop = theirs.slice(maxN);
  if (drop.length === 0) {
    return { kept: theirs.length, deletedGames: 0, deletedAnalyses: 0 };
  }
  const dropIds = new Set(drop.map(g => g.id));
  // Their analyses, scoped via the same flat field.
  let analyses: Array<Record<string, any>> = [];
  try {
    analyses = await entities.Analysis.filter({ playerUsername: u }, '-created_date', 5000);
  } catch { /* tolerate */ }
  const dropAnalyses = analyses.filter(a => dropIds.has(a.gameId));
  let deletedGames = 0;
  let deletedAnalyses = 0;
  for (const a of dropAnalyses) {
    try { await entities.Analysis.delete(a.id); deletedAnalyses++; } catch { /* ignore */ }
  }
  for (const g of drop) {
    try { await entities.Game.delete(g.id); deletedGames++; } catch { /* ignore */ }
  }
  return { kept: maxN, deletedGames, deletedAnalyses };
}

/**
 * Per-followed-user sliding window: for each followed username, keep the N
 * most-recent games and delete everything older (plus their analyses).
 * Idempotent — safe to run after every follow sync.
 */
export async function trimFollowedUserGames(
  options: UserCleanupOptions,
): Promise<FollowedTrimResult> {
  const { followedUsernames, maxPerFollowed = 10, log = () => {} } = options;
  const entities = base44.entities as Record<string, any>;
  const result: FollowedTrimResult = { perUser: {}, totalDeleted: 0 };
  const followed = new Set(followedUsernames.map(u => u.toLowerCase()));
  if (followed.size === 0) {
    log('No followed users — nothing to trim.');
    return result;
  }

  log(`Trimming followed-user games to ${maxPerFollowed} per user across ${followed.size} usernames...`);
  // Pull a wide window since we need to see ALL games for each followed user.
  const allGames: Array<Record<string, any>> = await entities.Game.list('-playedAt', 5000);

  for (const u of followed) {
    const theirs = allGames.filter(g =>
      (g.playerUsername?.toLowerCase?.() ?? (g.player?.username ?? '').toLowerCase()) === u,
    );
    theirs.sort((a, b) => (b.playedAt ?? 0) - (a.playedAt ?? 0));
    const keep = theirs.slice(0, maxPerFollowed);
    const drop = theirs.slice(maxPerFollowed);
    if (drop.length === 0) {
      result.perUser[u] = { kept: keep.length, deletedGames: 0, deletedAnalyses: 0 };
      continue;
    }
    const dropIds = new Set(drop.map(g => g.id));
    // Find their analyses (matched by gameId = Game's Base44 id)
    const analyses: Array<Record<string, any>> = await entities.Analysis.filter({ playerUsername: u });
    const dropAnalyses = analyses.filter(a => dropIds.has(a.gameId));

    let deletedGames = 0;
    let deletedAnalyses = 0;
    for (const a of dropAnalyses) {
      try { await entities.Analysis.delete(a.id); deletedAnalyses++; } catch { /* ignore */ }
    }
    for (const g of drop) {
      try { await entities.Game.delete(g.id); deletedGames++; } catch { /* ignore */ }
    }
    result.perUser[u] = { kept: keep.length, deletedGames, deletedAnalyses };
    result.totalDeleted += deletedGames + deletedAnalyses;
    log(`  ${u}: kept ${keep.length}, deleted ${deletedGames} games + ${deletedAnalyses} analyses`);
  }
  log(`Trim done: removed ${result.totalDeleted} records.`);
  return result;
}

export interface OrphanCleanupResult {
  scannedGames: number;
  scannedAnalyses: number;
  deletedGames: number;
  deletedAnalyses: number;
  byUsername: Record<string, number>;
}

/**
 * Delete every Game (and Analysis) whose `playerUsername` is not in the
 * user's {self ∪ followed} set. This is the cleanup hook for users who
 * un-followed people without the app deleting their imported games.
 *
 * NOTE: this relies on `playerUsername` being populated — run
 * `backfillPlayerUsername()` first if records are pre-flat-field era.
 * Records without playerUsername set are skipped (treated as "unknown,
 * don't touch"), so this is safe to run before backfill — it just won't
 * clean anything up.
 */
export async function deleteOrphanRecords(
  options: UserCleanupOptions,
): Promise<OrphanCleanupResult> {
  const { selfUsername, followedUsernames, log = () => {} } = options;
  const entities = base44.entities as Record<string, any>;
  const keep = new Set([selfUsername.toLowerCase(), ...followedUsernames.map(u => u.toLowerCase())]);
  log(`Keep set: ${[...keep].join(', ')}`);

  const result: OrphanCleanupResult = {
    scannedGames: 0, scannedAnalyses: 0, deletedGames: 0, deletedAnalyses: 0, byUsername: {},
  };

  log('Fetching all games...');
  const games: Array<Record<string, any>> = await entities.Game.list('-playedAt', 5000);
  log(`Got ${games.length} games. Fetching all analyses...`);
  const analyses: Array<Record<string, any>> = await entities.Analysis.list('-created_date', 5000);
  log(`Got ${analyses.length} analyses. Identifying orphans...`);

  const orphanGames = games.filter(g => {
    result.scannedGames++;
    const pu = (g.playerUsername ?? '').toLowerCase();
    if (!pu) return false; // skip if not backfilled yet
    return !keep.has(pu);
  });
  const orphanGameIds = new Set(orphanGames.map(g => g.id));
  for (const g of orphanGames) {
    const u = (g.playerUsername ?? '').toLowerCase();
    result.byUsername[u] = (result.byUsername[u] ?? 0) + 1;
  }
  const orphanAnalyses = analyses.filter(a => {
    result.scannedAnalyses++;
    const pu = (a.playerUsername ?? '').toLowerCase();
    if (pu && !keep.has(pu)) return true;
    // Fallback: analysis with no playerUsername but pointing at an orphan game.
    return orphanGameIds.has(a.gameId);
  });

  log(`Found ${orphanGames.length} orphan games + ${orphanAnalyses.length} orphan analyses. Deleting (analyses first)...`);

  const CONCURRENCY = 8;

  let i = 0;
  const analysisWorker = async () => {
    while (true) {
      const idx = i++;
      if (idx >= orphanAnalyses.length) return;
      try { await entities.Analysis.delete(orphanAnalyses[idx].id); result.deletedAnalyses++; } catch { /* ignore */ }
      if (result.deletedAnalyses % 100 === 0) log(`Deleted ${result.deletedAnalyses} analyses so far...`);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, analysisWorker));

  let j = 0;
  const gameWorker = async () => {
    while (true) {
      const idx = j++;
      if (idx >= orphanGames.length) return;
      try { await entities.Game.delete(orphanGames[idx].id); result.deletedGames++; } catch { /* ignore */ }
      if (result.deletedGames % 100 === 0) log(`Deleted ${result.deletedGames} games so far...`);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, gameWorker));

  log(`Orphan cleanup done: ${result.deletedGames} games + ${result.deletedAnalyses} analyses deleted.`);
  return result;
}

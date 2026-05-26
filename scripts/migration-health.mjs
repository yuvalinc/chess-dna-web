#!/usr/bin/env node
/**
 * Migration health check — run daily during shadow-mode soak.
 *
 * Reports per entity:
 *   - Row count: Base44 vs Supabase
 *   - Drift counts: last 24h / 3d / 7d
 *   - Engine job stats (latency, success rate, est cost)
 *
 * Per-entity decision:
 *   ✅ READY    drift_3d == 0 AND row-count Δ ≤ 1%
 *   ⚠️ DRIFT    drift_3d > 0 OR row-count Δ > 1%
 *   ❌ ERROR    couldn't query
 *
 * Usage:
 *   node scripts/migration-health.mjs \
 *     --base44-token "$BASE44_TOKEN" \
 *     --supabase-url https://<ref>.supabase.co \
 *     --supabase-service-key "$SUPABASE_SERVICE_KEY"
 *
 * Or set BASE44_TOKEN / SUPABASE_URL / SUPABASE_SERVICE_KEY env vars and run
 * without args.
 */
import { createClient } from '@base44/sdk';

const ENTITY_MAP = {
  Game: 'games',
  Analysis: 'analyses',
  Pattern: 'patterns',
  PatternSnapshot: 'pattern_snapshots',
  UserPreferences: 'user_preferences',
  Insight: 'insights',
};

const COLOR = {
  reset: '\x1b[0m', dim: '\x1b[2m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m',
};

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
      out[key] = val;
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const BASE44_TOKEN = args['base44-token'] || process.env.BASE44_TOKEN;
const SUPABASE_URL = (args['supabase-url'] || process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SUPABASE_SERVICE_KEY = args['supabase-service-key'] || process.env.SUPABASE_SERVICE_KEY;

if (!BASE44_TOKEN) die('--base44-token or BASE44_TOKEN required');
if (!SUPABASE_URL) die('--supabase-url or SUPABASE_URL required');
if (!SUPABASE_SERVICE_KEY) die('--supabase-service-key or SUPABASE_SERVICE_KEY required');

function die(msg) {
  console.error(`error: ${msg}`);
  process.exit(2);
}

async function supaQuery(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    headers: {
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      'apikey': SUPABASE_SERVICE_KEY,
      'Accept': 'application/json',
    },
  });
  if (!res.ok) throw new Error(`Supabase ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function base44Count(client, entity) {
  // Base44 lacks a count API. List with 5000 cap and use length.
  const rows = await client.entities[entity].list('-created_date', 5000);
  return { count: rows.length, truncated: rows.length === 5000 };
}

async function main() {
  console.log(`\n${COLOR.cyan}═══ MIGRATION HEALTH — ${new Date().toISOString().slice(0, 16).replace('T', ' ')} ═══${COLOR.reset}\n`);

  // 1) Supabase: pull migration_health view in one query.
  let supaHealth;
  try {
    supaHealth = await supaQuery('/migration_health?select=*');
  } catch (err) {
    console.error(`${COLOR.red}Failed to query migration_health view: ${err.message}${COLOR.reset}`);
    process.exit(1);
  }
  const supaByEntity = Object.fromEntries(supaHealth.map((r) => [r.entity, r]));

  // 2) Base44: per-entity counts (parallel).
  const base44 = createClient({ appId: '69a04516fd2be6e9fdd5fbde' });
  base44.setToken(BASE44_TOKEN);

  const baseEntities = Object.keys(ENTITY_MAP);
  const baseCounts = await Promise.all(
    baseEntities.map(async (e) => {
      try { return [e, await base44Count(base44, e)]; }
      catch (err) { return [e, { count: -1, truncated: false, error: err.message }]; }
    }),
  );
  const baseByEntity = Object.fromEntries(baseCounts);

  // 3) Per-entity decision table
  console.log(`  ${'Entity'.padEnd(18)} ${'Base44'.padStart(8)} ${'Supabase'.padStart(8)}  Δ%       ${'24h'.padStart(5)} ${'3d'.padStart(5)} ${'7d'.padStart(5)}  Decision`);
  console.log(`  ${'─'.repeat(86)}`);

  let readyCount = 0;
  let driftCount = 0;

  for (const entity of baseEntities) {
    const supa = supaByEntity[entity] ?? { supabase_rows: 0, drift_24h: 0, drift_3d: 0, drift_7d: 0 };
    const base = baseByEntity[entity];

    const baseCount = base.count;
    const supaCount = Number(supa.supabase_rows);
    const delta = baseCount > 0 ? Math.abs(baseCount - supaCount) / baseCount : (supaCount > 0 ? 1 : 0);
    const deltaPct = (delta * 100).toFixed(1) + '%';

    let decision;
    let color;
    if (base.error) {
      decision = '❌ ERROR  ' + base.error;
      color = COLOR.red;
    } else if (supa.drift_3d > 0 || delta > 0.01) {
      decision = '⚠️  DRIFT';
      color = COLOR.yellow;
      driftCount++;
    } else {
      decision = '✅ READY';
      color = COLOR.green;
      readyCount++;
    }

    const truncMark = base.truncated ? '*' : ' ';
    console.log(
      `  ${entity.padEnd(18)} ${String(baseCount).padStart(7)}${truncMark} ${String(supaCount).padStart(8)}  ${deltaPct.padEnd(7)}  ${String(supa.drift_24h).padStart(5)} ${String(supa.drift_3d).padStart(5)} ${String(supa.drift_7d).padStart(5)}  ${color}${decision}${COLOR.reset}`,
    );
  }

  if (baseCounts.some(([, b]) => b.truncated)) {
    console.log(`\n  ${COLOR.dim}* Base44 list() returned 5000 rows — actual count may be higher (the very limit we're escaping)${COLOR.reset}`);
  }

  // 4) Engine health (if engine_jobs has data)
  console.log(`\n${COLOR.cyan}═══ ENGINE HEALTH — last 24h ═══${COLOR.reset}\n`);
  try {
    const engine = await supaQuery('/engine_jobs?select=duration_ms,success,error&created_at=gte.' + encodeURIComponent(new Date(Date.now() - 86400_000).toISOString()));
    if (engine.length === 0) {
      console.log(`  ${COLOR.dim}No engine jobs recorded in the last 24h. Either no analyses were run through Fly, or telemetry isn't configured (SUPABASE_URL + SUPABASE_SERVICE_KEY on Fly).${COLOR.reset}`);
    } else {
      const durations = engine.map((j) => j.duration_ms).sort((a, b) => a - b);
      const successes = engine.filter((j) => j.success).length;
      const failures = engine.length - successes;
      const avg = (durations.reduce((s, n) => s + n, 0) / durations.length) | 0;
      const p50 = durations[Math.floor(durations.length * 0.5)];
      const p95 = durations[Math.floor(durations.length * 0.95)];
      const costUsd = (durations.reduce((s, n) => s + n, 0) * 8.6e-9).toFixed(4);

      console.log(`  Total jobs:    ${engine.length}`);
      console.log(`  Avg latency:   ${(avg / 1000).toFixed(1)}s`);
      console.log(`  p50 / p95:     ${(p50 / 1000).toFixed(1)}s / ${(p95 / 1000).toFixed(1)}s`);
      const successColor = successes / engine.length >= 0.99 ? COLOR.green : COLOR.yellow;
      console.log(`  Success rate:  ${successColor}${((successes / engine.length) * 100).toFixed(1)}%${COLOR.reset}  (${failures} failure${failures === 1 ? '' : 's'})`);
      console.log(`  Est cost:      $${costUsd}  ${COLOR.dim}(shared-cpu-2x @ $8.6e-9/ms × duration)${COLOR.reset}`);
    }
  } catch (err) {
    console.warn(`  ${COLOR.yellow}Could not query engine_jobs: ${err.message}${COLOR.reset}`);
  }

  // 5) Summary
  console.log(`\n${COLOR.cyan}═══ DECISION SUMMARY ═══${COLOR.reset}\n`);
  console.log(`  ${COLOR.green}✅ Ready to flip reads:  ${readyCount} entit${readyCount === 1 ? 'y' : 'ies'}${COLOR.reset}`);
  if (driftCount > 0) {
    console.log(`  ${COLOR.yellow}⚠️  Need investigation:  ${driftCount}${COLOR.reset}`);
    console.log(`     Run in Supabase SQL Editor:  ${COLOR.dim}SELECT * FROM drift_recent;${COLOR.reset}`);
  }

  const allReady = readyCount === baseEntities.length;
  if (allReady) {
    console.log(`\n  ${COLOR.green}All entities ready. Safe to start flipping VITE_READ_FROM_* one at a time.${COLOR.reset}\n`);
  } else {
    console.log(`\n  ${COLOR.dim}Re-run daily. Flip an entity's read source only after its decision has been READY for 3+ consecutive runs.${COLOR.reset}\n`);
  }

  process.exit(allReady ? 0 : 1);
}

main().catch((err) => {
  console.error(`${COLOR.red}FATAL: ${err.stack || err}${COLOR.reset}`);
  process.exit(2);
});

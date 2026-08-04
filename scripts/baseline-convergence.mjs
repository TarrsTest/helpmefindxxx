#!/usr/bin/env node
// Is MATCH_BASELINE_SAMPLE = 50 big enough?
//
//   node scripts/baseline-convergence.mjs
//   node scripts/baseline-convergence.mjs --reps 40
//
// WHAT THE QUESTION ACTUALLY IS. `score_baseline` scores the requester
// against `p_sample` randomly chosen profiles and returns the mean — an
// estimate of "what a stranger scores". Every call draws a different sample,
// so the estimate itself has a spread. The sample is big enough when that
// spread is small compared with the distance the number has to resolve: the
// gap between a real counterpart's top_margin and a noise case's.
//
// So this does NOT ask "what is the baseline" (one call answers that). It
// calls score_baseline many times at each sample size and measures how much
// the ANSWER MOVES between calls. That spread is the error bar on every
// top_margin the API reports.
//
// WHY THIS COULD NOT BE RUN BEFORE. score_baseline does `limit p_sample` over
// the profiles table, so while the pool was 18 people every sample size at or
// above 18 drew the same 17 rows and returned an identical number — zero
// spread, for a reason that had nothing to do with convergence. It needs a
// pool several times the sample size, which is what scripts/fillers.mjs is
// for.

import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? Number(process.argv[i + 1]) : fallback;
};

const REPS = arg('reps', 25);
const SIZES = [5, 10, 25, 50, 100, 137];
const W1 = arg('w1', 0.5);
const W2 = arg('w2', 0.5);

const env = (() => {
  const out = {};
  try {
    for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  } catch {
    console.error('No .env found — run `tarrs-cli db wire` first.');
    process.exit(1);
  }
  return out;
})();

const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const stddev = (xs) => {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
};

const main = async () => {
  const { count } = await db
    .from('profiles')
    .select('user_id', { count: 'exact', head: true })
    .not('self_emb', 'is', null);
  console.log(`Pool: ${count} embedded profiles · ${REPS} repeats per sample size\n`);

  // One fixed requester, so the only thing varying between runs is which
  // strangers were drawn.
  const { data: probe } = await db
    .from('users')
    .select('id')
    .eq('handle', 'seed_ml_researcher')
    .maybeSingle();
  if (!probe) {
    console.error('seed_ml_researcher missing — run `node scripts/seed-demo.mjs` first.');
    process.exit(1);
  }

  console.log('sample  drawn   mean baseline   spread of estimate   worst swing');
  const rows = [];
  for (const size of SIZES) {
    const estimates = [];
    let drawn = 0;
    for (let r = 0; r < REPS; r += 1) {
      const { data, error } = await db.rpc('score_baseline', {
        p_user_id: probe.id,
        p_w1: W1,
        p_w2: W2,
        p_sample: size,
        p_half_life_km: null,
      });
      if (error) throw error;
      const stats = (data ?? [])[0];
      if (stats?.baseline == null) continue;
      estimates.push(stats.baseline);
      drawn = stats.sample_size;
    }
    const sd = stddev(estimates);
    const swing = Math.max(...estimates) - Math.min(...estimates);
    rows.push({ size, drawn, sd, swing });
    console.log(
      `${String(size).padStart(6)}  ${String(drawn).padStart(5)}   ${mean(estimates).toFixed(6)}` +
        `        ${sd.toFixed(6)}             ${swing.toFixed(6)}`,
    );
  }

  // The number the estimate has to be small against: the observed distance
  // between the weakest true match and the strongest noise case, measured by
  // seed-demo.mjs --probe on this same pool.
  const BOUNDARY_GAP = 0.0755; // 0.1500 (weakest true) − 0.0745 (strongest noise)
  console.log(`\nDecision boundary this has to resolve: ${BOUNDARY_GAP.toFixed(4)} wide.`);
  console.log('A sample is adequate when its spread is small against that gap.\n');
  console.log('sample   spread   gap / spread');
  for (const r of rows) {
    console.log(
      `${String(r.size).padStart(6)}   ${r.sd.toFixed(6)}   ${(BOUNDARY_GAP / r.sd).toFixed(1)}×`,
    );
  }
  console.log(
    '\nNote the last row: at a sample equal to the pool there is nothing left to\n' +
      'draw, every call sees the same people, and the spread collapses to zero.\n' +
      'That is saturation, not accuracy — the same artefact that made this\n' +
      'measurement impossible on the old 18-person pool.',
  );
};

main().catch((e) => {
  console.error('\nFailed:', e.message);
  process.exit(1);
});

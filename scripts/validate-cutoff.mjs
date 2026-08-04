#!/usr/bin/env node
// Re-validate MATCH_RELATIVE_CUTOFF against the ground-truth population.
//
//   node scripts/validate-cutoff.mjs
//   node scripts/validate-cutoff.mjs --w1 0.4 --w2 0.6   try other weights
//
// WHAT THIS MEASURES, AND WHY IT IS NOT THE SAME NUMBER AS THE PROBE'S:
// seed-demo.mjs --probe measures `top_margin` — how far the best candidate
// sits above a random stranger. That answers "is there anything here at
// all". MATCH_RELATIVE_CUTOFF answers a different question: given that the
// top is real, how far below it may a row sit and still be worth showing.
// The two are separate quantities that happen to have similar magnitudes on
// this dataset; conflating them would produce a plausible, wrong threshold.
//
// WHY IT DOES NOT CALL match_recommendations: that function excludes people
// the requester is already connected to, and the seeded true pairs ARE
// connected. Scoring through it would filter out precisely the counterpart
// this measurement is about, and return a clean-looking set of numbers that
// describe noise. Rather than depend on running in the right order (probe
// before connect), this scores ordered pairs directly through pair_scoring,
// which has no connection filter — so the trap cannot be re-entered by
// running the script at the wrong moment.

import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { PEOPLE } from './seed-demo.mjs';

const PREFIX = 'seed_';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? Number(process.argv[i + 1]) : fallback;
};

const W1 = arg('w1', 0.5);
const W2 = arg('w2', 0.5);
const HALF_LIFE = process.argv.includes('--half-life')
  ? arg('half-life', null)
  : null;

// Cutoffs to sweep. The current default sits mid-range so it can be seen
// against both a stricter and a looser setting rather than judged alone.
const SWEEP = [0.04, 0.06, 0.08, 0.10, 0.12, 0.15, 0.18, 0.22, 0.26, 0.30];

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

// Ground truth: partners are the two consecutive 'match' entries of each
// pair, in the order seed-demo.mjs declares them.
const partnerOf = (() => {
  const matches = PEOPLE.filter((p) => p.expect === 'match');
  const map = new Map();
  for (let i = 0; i < matches.length; i += 2) {
    map.set(matches[i].h, matches[i + 1].h);
    map.set(matches[i + 1].h, matches[i].h);
  }
  return map;
})();

const fmt = (n) => (typeof n === 'number' ? n.toFixed(4) : '  —   ');

const main = async () => {
  const { data: users, error } = await db.from('users').select('id, handle');
  if (error) throw error;

  const pool = (users ?? []).filter((u) => u.handle.startsWith(PREFIX));
  const idOf = new Map(pool.map((u) => [u.handle.slice(PREFIX.length), u.id]));

  const missing = PEOPLE.filter((p) => !idOf.has(p.h));
  if (missing.length) {
    console.error(
      `Pool is missing ${missing.length} seeded people (${missing.map((p) => p.h).join(', ')}).\n` +
        'Run `node scripts/seed-demo.mjs` first.',
    );
    process.exit(1);
  }
  console.log(`Pool: ${pool.length} profiles · weights w1=${W1} w2=${W2}\n`);

  // Score every proband against the whole rest of the pool.
  const probands = PEOPLE.filter((p) => p.expect !== 'filler');
  const results = [];

  for (const p of probands) {
    const me = idOf.get(p.h);
    const scored = [];
    for (const other of PEOPLE) {
      if (other.h === p.h) continue;
      const { data, error: e } = await db.rpc('pair_scoring', {
        p_a: me,
        p_b: idOf.get(other.h),
        p_w1: W1,
        p_w2: W2,
        p_half_life_km: HALF_LIFE,
      });
      if (e) throw e;
      const row = (data ?? [])[0];
      if (row) scored.push({ h: other.h, score: row.match_score });
    }
    scored.sort((a, b) => b.score - a.score);

    const partner = partnerOf.get(p.h) ?? null;
    const partnerRow = partner ? scored.find((s) => s.h === partner) : null;
    const best = scored[0];
    const bestNonPartner = scored.find((s) => s.h !== partner);

    results.push({
      handle: p.h,
      expect: p.expect,
      partner,
      top: best?.score ?? null,
      partnerScore: partnerRow?.score ?? null,
      partnerRank: partner ? scored.findIndex((s) => s.h === partner) + 1 : null,
      // The quantity the cutoff has to clear: how far the true counterpart
      // stands above the best impostor. A cutoff wider than this admits
      // noise alongside the real match.
      separation:
        partnerRow && bestNonPartner ? partnerRow.score - bestNonPartner.score : null,
      scored,
    });
  }

  // --- per-person view -------------------------------------------------
  console.log('=== ranking of the true counterpart ===');
  console.log('expect  handle              rank  partner   best-other  separation');
  for (const r of results.filter((r) => r.expect === 'match')) {
    const bestOther = r.scored.find((s) => s.h !== r.partner);
    console.log(
      `${r.expect.padEnd(7)} ${r.handle.padEnd(18)} ${String(r.partnerRank).padStart(4)}  ` +
        `${fmt(r.partnerScore)}   ${fmt(bestOther?.score)}     ${fmt(r.separation)}`,
    );
  }

  const ranks = results.filter((r) => r.expect === 'match').map((r) => r.partnerRank);
  const topOne = ranks.filter((r) => r === 1).length;
  console.log(`\ntrue counterpart ranked #1 for ${topOne}/${ranks.length} people`);

  const seps = results
    .filter((r) => r.expect === 'match' && typeof r.separation === 'number')
    .map((r) => r.separation);
  if (seps.length) {
    console.log(
      `separation from best impostor: min ${Math.min(...seps).toFixed(4)}  ` +
        `max ${Math.max(...seps).toFixed(4)}`,
    );
  }

  // --- cutoff sweep ----------------------------------------------------
  //
  // For each candidate cutoff: does a page still contain the true match,
  // and how much noise rides along with it. The useful setting is the one
  // that keeps 10/10 counterparts while admitting the fewest impostors.
  console.log('\n=== cutoff sweep ===');
  console.log('cutoff  partners kept  rows/match-page  rows/noise-page');
  for (const cut of SWEEP) {
    let kept = 0;
    const matchRows = [];
    const noiseRows = [];
    for (const r of results) {
      const survivors = r.scored.filter((s) => s.score >= r.top - cut);
      if (r.expect === 'match') {
        if (survivors.some((s) => s.h === r.partner)) kept += 1;
        matchRows.push(survivors.length);
      } else {
        noiseRows.push(survivors.length);
      }
    }
    const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
    const flag = cut === 0.15 ? '  ← current default' : '';
    console.log(
      `${cut.toFixed(2).padStart(6)}  ${String(kept).padStart(6)}/${ranks.length}       ` +
        `${mean(matchRows).toFixed(1).padStart(9)}       ` +
        `${mean(noiseRows).toFixed(1).padStart(9)}${flag}`,
    );
  }

  console.log(
    '\nRead the two right-hand columns together: a page that comes back SHORT\n' +
      'for someone with a real counterpart, and FULL for someone without one,\n' +
      'is the cutoff working — page length is itself evidence.',
  );
};

main().catch((e) => {
  console.error('\nFailed:', e.message);
  process.exit(1);
});

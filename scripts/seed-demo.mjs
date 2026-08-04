#!/usr/bin/env node
// Seed a demo population through the real /v1 API, then measure calibration.
//
//   node scripts/seed-demo.mjs            seed, connect, then probe
//   node scripts/seed-demo.mjs --probe    re-measure without re-seeding
//   node scripts/seed-demo.mjs --clean    remove everything this script made
//   …  --base http://localhost:3007       point at a different dev server
//
// Why it goes through the API rather than inserting rows: profiles must be
// embedded by the configured provider, in the same vector space as
// everything else. Writing vectors by hand would produce a pool that
// matches nothing.
//
// Two jobs in one dataset:
//   1. The map needs co-located people (clusters), several cities, and
//      accepted edges between them.
//   2. Calibration needs GROUND TRUTH — people who genuinely have a
//      counterpart here, and people who provably don't. `expect` records
//      which is which, so the probe can print margins side by side and the
//      real decision boundary can be read off instead of guessed.
//
// Personas are written so a true pair shares almost NO vocabulary
// ("venture capitalist writing checks" vs "investor who backs startups").
// Lexically-overlapping pairs would pass even on a keyword baseline and
// prove nothing about semantic matching.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const PREFIX = 'seed_';

const CITIES = {
  sf: { lat: 37.7749, lng: -122.4194 },
  nyc: { lat: 40.7128, lng: -74.006 },
  london: { lat: 51.5074, lng: -0.1278 },
  tokyo: { lat: 35.6762, lng: 139.6503 },
  berlin: { lat: 52.52, lng: 13.405 },
  nowhere: null, // no location — must NOT appear on the map
};

// expect: 'match' → a real counterpart exists in this pool
//         'none'  → nobody here fits; a full page of recommendations is noise
//         'filler'→ background population, makes the random baseline steadier
export const PEOPLE = [
  // --- pair 1: research ↔ capital (sf / sf, same cluster) ---
  { h: 'ml_researcher', city: 'sf', expect: 'match',
    self: 'I train large neural networks and publish deep learning research at a university lab.',
    seeking: 'An investor who backs early-stage AI startups with capital and introductions.' },
  { h: 'ai_vc', city: 'sf', expect: 'match',
    self: 'I am a venture capitalist writing first checks into machine-learning companies.',
    seeking: 'Technical founders building artificial intelligence models who need funding.' },

  // --- pair 2: game art ↔ gameplay code (sf / tokyo, cross-map edge) ---
  { h: 'pixel_artist', city: 'sf', expect: 'match',
    self: 'I draw hand-animated sprites and environment art for small indie games.',
    seeking: 'A programmer who can build gameplay systems so my art becomes a playable game.' },
  { h: 'gameplay_dev', city: 'tokyo', expect: 'match',
    self: 'I write gameplay code and physics for 2D games in Godot and Unity.',
    seeking: 'An illustrator to make the visuals for the game I am building.' },

  // --- pair 3: spare room ↔ relocating (nyc / nyc, same cluster) ---
  { h: 'has_spare_room', city: 'nyc', expect: 'match',
    self: 'I own a two-bedroom apartment in Brooklyn and one bedroom sits empty.',
    seeking: 'A quiet long-term tenant to rent my second bedroom from next month.' },
  { h: 'relocating', city: 'nyc', expect: 'match',
    self: 'I am moving cities in three weeks for a new job and have references.',
    seeking: 'A room to rent long term in a shared flat, ideally in Brooklyn.' },

  // --- pair 4: language exchange (london / tokyo, cross-map edge) ---
  { h: 'learns_spanish', city: 'london', expect: 'match',
    self: 'Native Mandarin speaker, fluent English, currently studying Spanish grammar.',
    seeking: 'A Spanish native who wants to practise Mandarin conversation with me.' },
  { h: 'learns_mandarin', city: 'tokyo', expect: 'match',
    self: 'I grew up in Madrid speaking Spanish and now study Chinese characters daily.',
    seeking: 'Someone fluent in Mandarin to swap language practice sessions.' },

  // --- pair 5: bakery ↔ mill (london / berlin, cross-map edge) ---
  { h: 'bakery_owner', city: 'london', expect: 'match',
    self: 'I run a neighbourhood sourdough bakery producing three hundred loaves a day.',
    seeking: 'A wholesale supplier of stoneground organic flour at consistent quality.' },
  { h: 'organic_mill', city: 'berlin', expect: 'match',
    self: 'Our family mill stonegrinds organic wheat and rye into flour by the tonne.',
    seeking: 'Craft bakeries buying flour wholesale on a recurring contract.' },

  // --- nobody here fits these two: the noise cases ---
  { h: 'needs_surgeon', city: 'sf', expect: 'none',
    self: 'I coordinate clinical trials for a hospital cardiology department.',
    seeking: 'A cardiothoracic surgeon to co-author a paper on valve replacement outcomes.' },
  { h: 'needs_welder', city: 'nyc', expect: 'none',
    self: 'I manage offshore platform maintenance schedules for an energy company.',
    seeking: 'A certified saturation diver for deep-sea structural welding contracts.' },

  // --- background population: unrelated to everyone, steadies the baseline ---
  { h: 'bird_ringer', city: 'london', expect: 'filler',
    self: 'I ring migratory birds and record their movements for a conservation trust.',
    seeking: 'Volunteers for dawn ringing sessions at coastal sites.' },
  { h: 'tax_lawyer', city: 'nyc', expect: 'filler',
    self: 'I advise on cross-border corporate tax structuring and transfer pricing.',
    seeking: 'Referrals from accountants whose clients face multi-jurisdiction filings.' },
  { h: 'ceramicist', city: 'berlin', expect: 'filler',
    self: 'I throw stoneware vessels and fire them in a wood kiln twice a year.',
    seeking: 'Gallery space to exhibit a collection of glazed tableware.' },
  { h: 'trail_runner', city: 'tokyo', expect: 'filler',
    self: 'I run long mountain trails and write about ultramarathon training.',
    seeking: 'Training partners for weekend long runs in the hills.' },
  { h: 'sailmaker', city: 'sf', expect: 'filler',
    self: 'I cut and stitch racing sails from laminate cloth for keelboats.',
    seeking: 'Yacht owners needing a new mainsail before the racing season.' },
  { h: 'archivist', city: 'nowhere', expect: 'filler',
    self: 'I catalogue nineteenth-century municipal records and digitise fragile documents.',
    seeking: 'Historians researching urban administration who need archive access.' },
];

// Accepted connections — drawn between real pairs so the map's edges mean
// something. Two are same-cluster (must NOT render as a line) and three
// cross cities (must render).
export const CONNECT = [
  ['ml_researcher', 'ai_vc'],       // both sf → intra-cluster, edge dropped
  ['has_spare_room', 'relocating'], // both nyc → intra-cluster, edge dropped
  ['pixel_artist', 'gameplay_dev'], // sf ↔ tokyo
  ['learns_spanish', 'learns_mandarin'], // london ↔ tokyo
  ['bakery_owner', 'organic_mill'], // london ↔ berlin
];

// --- plumbing ---------------------------------------------------------

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const flag = (name) => process.argv.includes(`--${name}`);

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

const BASE = arg('base', 'http://localhost:3000').replace(/\/$/, '');

const admin = () =>
  createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

const api = async (path, { method = 'GET', key, body } = {}) => {
  const res = await fetch(`${BASE}/api/v1${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(key ? { authorization: `Bearer ${key}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(json)}`);
  return json;
};

const keyfile = new URL('../.seed-keys.json', import.meta.url);
const loadKeys = () => {
  try {
    return JSON.parse(readFileSync(keyfile, 'utf8'));
  } catch {
    return null;
  }
};

// --- commands ---------------------------------------------------------

const clean = async () => {
  const db = admin();
  const { data } = await db.from('users').select('id, handle');
  const mine = (data ?? []).filter((u) => u.handle.startsWith(PREFIX));
  if (mine.length === 0) return console.log('Nothing to clean.');
  const { error } = await db.from('users').delete().in('id', mine.map((u) => u.id));
  if (error) throw error;
  // Cascades to profiles / api_keys / connections.
  console.log(`Removed ${mine.length} seeded users (and their profiles, keys, edges).`);
  try {
    const { unlinkSync } = await import('node:fs');
    unlinkSync(keyfile);
  } catch {}
};

const seed = async () => {
  const keys = {};
  const ids = {};

  for (const p of PEOPLE) {
    const loc = CITIES[p.city];
    const created = await api('/users', {
      method: 'POST',
      body: {
        handle: PREFIX + p.h,
        contact: { email: `${p.h}@example.invalid` },
        ...(loc ? { lat: loc.lat, lng: loc.lng, loc_precision: 5 } : {}),
      },
    });
    keys[p.h] = created.api_key;
    ids[p.h] = created.user_id;
    await api('/profile', {
      method: 'POST',
      key: created.api_key,
      body: { self: p.self, seeking: p.seeking },
    });
    process.stdout.write(`  ${p.h} …ok\n`);
  }

  const { writeFileSync } = await import('node:fs');
  writeFileSync(keyfile, JSON.stringify({ keys, ids }, null, 2));
  console.log(`\nSeeded ${PEOPLE.length} people.`);
  console.log('Keys saved to .seed-keys.json (gitignored) for --probe.');
  return { keys, ids };
};

// Run AFTER probing: an accepted edge removes both people from each
// other's recommendations, which would hide exactly the counterpart the
// calibration measurement depends on.
const connect = async (keys, ids) => {
  for (const [a, b] of CONNECT) {
    const { connection } = await api('/connections', {
      method: 'POST',
      key: keys[a],
      body: { target_id: ids[b] },
    });
    await api(`/connections/${connection.id}/respond`, {
      method: 'POST',
      key: keys[b],
      body: { action: 'accept' },
    });
    process.stdout.write(`  ${a} ↔ ${b} accepted\n`);
  }
  console.log(`${CONNECT.length} accepted connections — the map now has edges.`);
};

// The measurement JQ needs: margin for people who DO have a counterpart
// here versus people who provably don't. The gap between the two columns
// is the real decision boundary.
const probe = async (keys) => {
  const rows = [];
  for (const p of PEOPLE) {
    if (p.expect === 'filler') continue;
    const key = keys[p.h];
    if (!key) continue;
    const r = await api('/recommendations?limit=5', { key });
    const c = r.calibration ?? {};
    // Recommendations exclude anyone you already have an edge with, so a
    // probe run after connecting silently hides each person's true
    // counterpart and measures noise. Surface the count instead of
    // producing a plausible-looking wrong number.
    const { connections } = await api('/connections', { key });
    rows.push({
      handle: p.h,
      expect: p.expect,
      margin: c.top_margin,
      top: c.top_score,
      baseline: c.baseline,
      n: c.sample_size,
      conns: connections.length,
      rows_returned: r.recommendations.length,
      top_handle: r.recommendations[0]?.handle?.replace(PREFIX, '') ?? '—',
    });
  }

  const fmt = (v) => (typeof v === 'number' ? v.toFixed(4) : String(v));
  console.log('\n=== calibration probe ===');
  console.log('expect   handle              margin    top      baseline  n  conn  rows  top match');
  for (const r of rows.sort((a, b) => (b.margin ?? -1) - (a.margin ?? -1))) {
    console.log(
      `${r.expect.padEnd(8)} ${r.handle.padEnd(18)} ${fmt(r.margin).padStart(7)}  ` +
        `${fmt(r.top).padStart(7)}  ${fmt(r.baseline).padStart(7)}  ${String(r.n).padStart(2)}  ` +
        `${String(r.conns).padStart(4)}  ${String(r.rows_returned).padStart(4)}  ${r.top_handle}`,
    );
  }

  const contaminated = rows.filter((r) => r.conns > 0).length;
  if (contaminated > 0) {
    console.log(
      `\n!! ${contaminated} probed people already have connections. Recommendations\n` +
        '   exclude existing edges, so their true counterpart was filtered out and\n' +
        '   these margins measure noise. Re-run --clean then seed to measure properly.',
    );
  }

  const m = rows.filter((r) => r.expect === 'match' && typeof r.margin === 'number');
  const n = rows.filter((r) => r.expect === 'none' && typeof r.margin === 'number');
  if (m.length && n.length) {
    const lowestTrue = Math.min(...m.map((r) => r.margin));
    const highestNone = Math.max(...n.map((r) => r.margin));
    console.log('\n--- decision boundary ---');
    console.log(`lowest margin among TRUE matches : ${lowestTrue.toFixed(4)}`);
    console.log(`highest margin among NON matches : ${highestNone.toFixed(4)}`);
    console.log(
      lowestTrue > highestNone
        ? `separated — any cutoff in (${highestNone.toFixed(4)}, ${lowestTrue.toFixed(4)}) splits them cleanly`
        : 'OVERLAP — margin alone cannot separate these two groups on this dataset',
    );
    console.log('\nThese two numbers are what skills/helpmefind/SKILL.md §1 should quote.');
  }
};

// --- main -------------------------------------------------------------

const main = async () => {
  if (flag('clean')) return clean();

  if (flag('probe')) {
    const saved = loadKeys();
    if (!saved) {
      console.error('No .seed-keys.json — run without --probe first to seed.');
      process.exit(1);
    }
    return probe(saved.keys);
  }

  console.log(`Seeding against ${BASE} …`);
  const { keys, ids } = await seed();
  await probe(keys);
  console.log('\nConnecting pairs (after the probe, so it saw the full pool) …');
  await connect(keys, ids);
};

// Only run when invoked directly. PEOPLE / CONNECT are the ground truth for
// every calibration measurement in this repo, so other scripts import them
// rather than keeping a second copy — a duplicated pairing table that drifts
// would not fail, it would quietly measure the wrong thing.
const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  main().catch((e) => {
    console.error('\nFailed:', e.message);
    console.error('If handles already exist, run with --clean first.');
    process.exit(1);
  });
}

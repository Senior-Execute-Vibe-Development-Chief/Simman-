// The SHAPE of the political map: the full realm-size distribution, not the top-5.
// The user-facing complaint this instruments (2026-08): "country counts, sizes,
// spread, differences are a bit off — too blunt, not enough tiny countries."
// Every prior size gate reads the TOP of the distribution (largest share, tail
// largest/median) or the middle (median area); none reads the BOTTOM — whether
// small states EXIST at all. Real political maps at every era are heavy-tailed in
// BOTH directions: a few giants, a body of kingdoms, and a long tail of small
// polities (city-states, principalities, mountain/island statelets — the HRE alone
// held ~300; Greece ~1000 poleis; the Maya lowlands dozens of ajawil).
//
// Prints, at each checkpoint: count, claimed%, log-decade size histogram, spread
// stats (P10/median/P90, largest/median, top1 share, Gini), the smallest-10 realms
// with their context (age, members, org, terrain), and the flows. Also a rank-size
// log-log slope over the WHOLE realm list (not just cities): real country areas
// are roughly log-normal — ln(area) std ≈ 2.0-2.6 across eras (modern world ~2.4
// over 195 states; the 1500 CE map similar over ~500 polities peer-reviewed lists
// count) — while a "blunt" uniform band reads σ ≲ 1.
//
//   node tools/probe_shape.mjs [steps] [W] [seed] [checkEvery]
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";

const STEPS = +(process.argv[2] || 16000);
const W = +(process.argv[3] || 480), H = W >> 1;
const SEED = +(process.argv[4] || 8817);
const EVERY = +(process.argv[5] || 4000);

const world = buildSim({ W, H, seed: SEED });
let landN = 0;
for (let i = 0; i < world.N; i++) if (world.elev[i] > 0) landN++;
const km2PerTile = (510e6 * 0.29) / landN;   // real land km² per land tile at this grid

function gini(xs) {
  if (xs.length < 2) return 0;
  const s = [...xs].sort((a, b) => a - b);
  let cum = 0, weighted = 0;
  for (let i = 0; i < s.length; i++) { weighted += (i + 1) * s[i]; cum += s[i]; }
  return (2 * weighted) / (s.length * cum) - (s.length + 1) / s.length;
}

function report() {
  const co = world._countryOwner, elev = world.elev, N = world.N;
  const tiles = new Map(); let claimed = 0;
  for (let i = 0; i < N; i++) { if (!(elev[i] > 0)) continue; const c = co ? co[i] : -1; if (c >= 0) { claimed++; tiles.set(c, (tiles.get(c) || 0) + 1); } }
  const members = new Map();
  for (const s of world.settlements) if (s.mode === "settled" && s.countryId >= 0) { let a = members.get(s.countryId); if (!a) members.set(s.countryId, a = []); a.push(s); }
  const rows = [...tiles.entries()].map(([c, t]) => {
    const p = world.polities && world.polities.get(c);
    const mem = members.get(c) || [];
    const cc = world.countries && world.countries.get(c);
    const cap = cc && cc.capital;
    return {
      c, t, km2: t * km2PerTile, mem: mem.length,
      age: p ? world.step - p.foundedStep : -1,
      org: (cap && cap.knowledge && cap.knowledge.organization) || 0,
      name: (p && p.name) || "?",
    };
  }).sort((a, b) => a.t - b.t);
  const n = rows.length;
  const areas = rows.map(r => r.km2);
  const lnAreas = areas.map(a => Math.log(Math.max(1, a)));
  const mean = lnAreas.reduce((x, y) => x + y, 0) / Math.max(1, n);
  const sigma = Math.sqrt(lnAreas.reduce((x, y) => x + (y - mean) ** 2, 0) / Math.max(1, n));
  const q = (p) => areas[Math.min(n - 1, Math.floor(p * n))] || 0;
  // log-decade histogram in km²
  const bins = [[0, 50e3, "<50k"], [50e3, 200e3, "50-200k"], [200e3, 1e6, "200k-1M"], [1e6, 5e6, "1-5M"], [5e6, Infinity, ">5M"]];
  const hist = bins.map(([lo, hi, lab]) => `${lab}:${areas.filter(a => a >= lo && a < hi).length}`).join("  ");
  let founded = 0, ended = 0, seceded = 0, shattered = 0;
  for (const ev of world.events || []) {
    if (ev.type === "polity.founded") founded++;
    if (ev.type === "polity.ended") ended++;
    if (ev.type === "polity.seceded") seceded++;
    if (ev.type === "polity.shattered") shattered++;
  }
  console.log(`\n=== step ${world.step}  realms=${n}  claimed=${(100 * claimed / landN).toFixed(1)}%  flows: founded=${founded} ended=${ended} seceded=${seceded} shattered=${shattered}`);
  console.log(`    size km2: P10=${Math.round(q(0.1) / 1000)}k  MED=${Math.round(q(0.5) / 1000)}k  P90=${Math.round(q(0.9) / 1000)}k  MAX=${Math.round(q(0.999) / 1000)}k  | top1share=${(100 * (areas[n - 1] || 0) / Math.max(1, areas.reduce((x, y) => x + y, 0))).toFixed(0)}%  max/med=${((areas[n - 1] || 0) / Math.max(1, q(0.5))).toFixed(1)}  gini=${gini(areas).toFixed(2)}  lnσ=${sigma.toFixed(2)} (real maps ≈2.0-2.6)`);
  console.log(`    histogram  ${hist}`);
  const small = rows.filter(r => r.km2 < 100e3);
  console.log(`    SMALL (<100k km2): ${small.length} of ${n} (${(100 * small.length / Math.max(1, n)).toFixed(0)}%) — real maps: modern 47%, 1500CE-Europe ~80%`);
  const show = rows.slice(0, Math.min(8, n));
  for (const r of show) console.log(`      tiny #${r.c} "${r.name}" ${Math.round(r.km2 / 1000)}k km2 mem=${r.mem} age=${r.age} org=${r.org.toFixed(2)}`);
}

const t0 = Date.now();
while (world.step < STEPS) {
  const next = Math.min(STEPS, world.step + EVERY);
  while (world.step < next) stepPeopleSim(world, 1);
  report();
  console.log(`    [${((Date.now() - t0) / 1000).toFixed(0)}s]`);
}

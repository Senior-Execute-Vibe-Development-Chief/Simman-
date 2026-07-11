// ── Headless Earth sim harness ───────────────────────────────────────
//
// Runs the *real* worldgen the browser uses (src/worldgen.js) on the
// "earth_sim" preset, then the *real* peopleSim, so the dynamics match
// what you see in the browser when you pick the Earth (Sim) preset.
//
//   node tools/earthRun.mjs [steps=10000] [seed=8817]
//
// Reports a structured run log: world stats, settlement count over time,
// event tallies, top countries, fiscal indicators, plague/famine
// activity, inflation, etc. Useful for headless calibration and for
// auditing model behaviour without launching the browser.
//
// To keep this script light, it implements a MINIMAL post-worldgen
// pipeline matching what the browser does in createTerritory() — enough
// for peopleSim to step. tCrop uses tileFert verbatim from WorldSim.jsx.
// If a calibration depends on a tCrop subtlety we don't replicate yet
// (plate-boundary adjustments, the young-soil discount), pull more of
// createTerritory in.

import { buildWorld, buildSim } from "./_harness.mjs";
import { initPeopleSim, stepPeopleSim, peopleSimStats } from "../src/sim/peopleSim/index.js";
import { settlementPower } from "../src/sim/peopleSim/conquest.js";
import { ERAS } from "../src/sim/peopleSim/tech.js";
import { displayYear } from "../src/sim/calendar.js";

const STEPS = parseInt(process.argv[2] || "10000", 10);
const SEED  = parseInt(process.argv[3] || "8817", 10);

// World dimensions — defaults match WorldSim.jsx (1920×960, RES=1) but
// can be overridden by env vars for faster headless runs:
//   EARTH_W=960 EARTH_H=480 node tools/earthRun.mjs 50000 8817
// Lower resolution speeds the per-step trade/territory work proportionally
// to (W*H), without changing the Earth shape — the heightmap is sampled at
// the requested grid size. For "what does the user see", run at the
// default 1920×960; for fast iteration, drop to 960×480.
const W = parseInt(process.env.EARTH_W || "1920", 10);
const H = parseInt(process.env.EARTH_H || "960", 10);
const RES = 1;
const TW = Math.ceil(W / RES), TH = Math.ceil(H / RES);

// Optional experimental-lever overrides (env unset = defaults = no-op), mirroring
// tools/stylized.mjs — so long Earth runs can measure a lever's on-trajectory
// (e.g. RES_INVARIANT_POP=1 for the resolution-invariance validation matrix).
import { T } from "../src/sim/peopleSim/tuning.js";
for (const k of ["CROSS_REALM_HEIRS", "CLAIMANT_WARS", "CLAIM_POWER_WIN", "CAP_MODEL", "CAP_FISC", "CAP_LOG", "RES_INVARIANT_POP", "ANCHOR_POP"]) if (process.env[k] != null) { T[k] = +process.env[k]; console.log(`[earthRun]   lever ${k}=${T[k]}`); }

console.log(`[earthRun] seed=${SEED} steps=${STEPS} W=${W} H=${H}`);

// ── 1-5. Worldgen → rivers → tCrop → deposits → sim (app-identical) ──
// All built by tools/_harness.mjs, which mirrors WorldSim's createTerritory
// (river/lake moisture boosts feed tCrop; deposits see boosted moisture).
let t0 = performance.now();
const { w, rivers, tCrop, deposits } = buildWorld({ W, H, seed: SEED });
console.log(`[earthRun] worldgen+rivers+resources done in ${((performance.now() - t0) / 1000).toFixed(1)}s`);
let land = 0; for (let i = 0; i < W * H; i++) if (w.elevation[i] > 0) land++;
console.log(`[earthRun] land tiles: ${land} (${Math.round(land * 100 / (W * H))}% of map)`);
let riverTiles = 0;
if (rivers && rivers.riverMag) for (let i = 0; i < rivers.riverMag.length; i++) if (rivers.riverMag[i] >= 2) riverTiles++;
console.log(`[earthRun] ${riverTiles} river tiles`);
const depCounts = {};
for (const id in deposits) {
  let n = 0; for (let i = 0; i < deposits[id].length; i++) if (deposits[id][i] > 0.1) n++;
  depCounts[id] = n;
}
console.log(`[earthRun] deposits (richness>0.1):`, depCounts);
t0 = performance.now();
// App-identical init via the harness (buildSim wires tFlood/tAncestry/tArrival
// and the ancestry layer): the old hand-rolled initPeopleSim dropped the
// floodplain mask, so every long-run report measured a floodplain-less world
// the browser never simulates (review B63).
const world = buildSim({ W, H, seed: SEED });
console.log(`[earthRun] peopleSim init done in ${((performance.now() - t0) / 1000).toFixed(1)}s — cradle planted`);

// ── 6. Step + report ─────────────────────────────────────────────────
const reportSteps = new Set();
const period = Math.max(1000, Math.floor(STEPS / 12));
for (let s = period; s <= STEPS; s += period) reportSteps.add(s);
reportSteps.add(STEPS);

function snapshot(label) {
  const setts = world.settlements.filter(x => x.mode === "settled");
  const tiers = [0, 0, 0, 0];
  let totalPop = 0, totalWealth = 0, withArmy = 0, maxArmy = 0;
  for (const st of setts) {
    if (st.tier >= 0 && st.tier < 4) tiers[st.tier]++;
    totalPop += st.people;
    totalWealth += st.wealth || 0;
    if ((st.army || 0) > 1) withArmy++;
    if ((st.army || 0) > maxArmy) maxArmy = st.army;
  }
  // Top countries by member count
  const sizes = [];
  if (world.countries) for (const c of world.countries.values()) sizes.push(c.members.length);
  sizes.sort((a, b) => b - a);
  const top5 = sizes.slice(0, 5).join(",");
  // Insolvency
  let insolvent = 0, minSolv = 1;
  if (world.countries) for (const c of world.countries.values()) {
    if (c.members.length <= 1) continue;
    const sv = c._solvency ?? 1;
    if (sv < 0.99) insolvent++;
    if (sv < minSolv) minSolv = sv;
  }
  // Plague + global price level
  const plagued = world._plagued ? world._plagued.size : 0;
  let globalP = 1;
  if (world._inflRaw && world._networkComponents) {
    let num = 0, den = 0;
    for (const st of setts) {
      const root = world._networkComponents.has(st.id) ? world._networkComponents.get(st.id) : st.id;
      const p = world._inflRaw.get(root);
      if (p == null) continue;
      num += p * st.people; den += st.people;
    }
    if (den > 0) globalP = num / den;
  }
  console.log(`${label}: setts=${setts.length} V=${tiers[0]} T=${tiers[1]} C=${tiers[2]} M=${tiers[3]} | pop=${Math.round(totalPop / 1000)}k wealth=${Math.round(totalWealth / 1000)}k | cnt=${world.countries ? world.countries.size : 0} top5=[${top5}] | inso=${insolvent} minSv=${minSolv.toFixed(2)} | plagued=${plagued} P=${globalP.toFixed(2)}`);
}

t0 = performance.now();
for (let s = 1; s <= STEPS; s++) {
  stepPeopleSim(world, 1);
  if (reportSteps.has(s)) snapshot(`step ${s}`);
}
const dt = (performance.now() - t0) / 1000;
console.log(`[earthRun] ${STEPS} steps in ${dt.toFixed(1)}s (${Math.round(STEPS / dt)} steps/s)`);

// Emergent endgame: did the world climb the whole knowledge tree? (chronicle.js:
// _eraAt[6] = the step the leading civ first reached the Modern era — the arc-complete
// milestone. Never a date; a slow world simply never gets here.)
{
  const eraAt = world._eraAt || [0];
  const FINAL = ERAS.length - 1;
  if (eraAt.length > FINAL) {
    const step = eraAt[FINAL];
    console.log(`[earthRun] ARC COMPLETE — reached the ${ERAS[FINAL]} era at step ${step} (display year ~${Math.round(displayYear(step))})`);
  } else {
    console.log(`[earthRun] arc incomplete — leading civ topped out at the ${ERAS[eraAt.length - 1]} era (never reached ${ERAS[FINAL]})`);
  }
}

// ── 7. Event tally + verdict ─────────────────────────────────────────
const ev = {};
for (const st of world.settlements) {
  if (!st.history) continue;
  for (const h of st.history) ev[h.type] = (ev[h.type] || 0) + 1;
}
const orderedEvents = Object.entries(ev).sort((a, b) => b[1] - a[1]);
console.log(`\n[earthRun] event tally over ${STEPS} steps:`);
for (const [k, n] of orderedEvents) console.log(`   ${k.padEnd(22)} ${n}`);

// Top 10 settlements by population and by wealth
const setts = world.settlements.filter(s => s.mode === "settled");
const topPop = setts.slice().sort((a, b) => b.people - a.people).slice(0, 10);
const topWealth = setts.slice().sort((a, b) => (b.wealth || 0) - (a.wealth || 0)).slice(0, 10);
console.log(`\n[earthRun] top 10 by population:`);
for (const s of topPop) console.log(`   ${s.name.padEnd(24)} pop=${Math.round(s.people)} tier=${s.tier} wealth=${Math.round(s.wealth || 0)} country=${s.countryId}`);
console.log(`\n[earthRun] top 10 by wealth:`);
for (const s of topWealth) console.log(`   ${s.name.padEnd(24)} wealth=${Math.round(s.wealth || 0)} pop=${Math.round(s.people)} tier=${s.tier}`);

// Top 10 countries by member count
if (world.countries) {
  const cs = Array.from(world.countries.values()).filter(c => c.members.length > 1).sort((a, b) => b.members.length - a.members.length).slice(0, 10);
  console.log(`\n[earthRun] top 10 countries by member count:`);
  for (const c of cs) {
    const pop = c.members.reduce((s, m) => s + (m.people || 0), 0);
    const treas = c._treasury || 0;
    const cap = c.capital ? c.capital.name : "?";
    console.log(`   ${cap.padEnd(20)} members=${c.members.length} pop=${Math.round(pop / 1000)}k treas=${Math.round(treas)} solv=${(c._solvency ?? 1).toFixed(2)} P=${(c._priceLevel ?? 1).toFixed(2)}`);
  }
}

// ── 8. Nearest-neighbour distance distribution ───────────────────────
// A natural settlement pattern is non-uniform: dense clusters along rivers /
// coasts, large empty stretches across desert / tundra. A tightly clumped
// nearest-neighbour distribution means placement is too geometric (every
// settlement at roughly the same distance from its neighbour), which reads
// as an unnatural grid.
{
  const alive = world.settlements.filter(s => s.mode === "settled");
  const dists = [];
  const tw = world.tw;
  for (let i = 0; i < alive.length; i++) {
    let nd = Infinity;
    for (let j = 0; j < alive.length; j++) {
      if (i === j) continue;
      let dx = Math.abs(alive[i].pos.x - alive[j].pos.x);
      if (dx > tw / 2) dx = tw - dx;
      const dy = alive[i].pos.y - alive[j].pos.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < nd) nd = d;
    }
    dists.push(nd);
  }
  dists.sort((a, b) => a - b);
  const n = dists.length;
  const pct = p => dists[Math.min(n - 1, Math.floor(n * p))];
  const mean = dists.reduce((a, b) => a + b, 0) / Math.max(1, n);
  const variance = dists.reduce((a, b) => a + (b - mean) * (b - mean), 0) / Math.max(1, n);
  const stdev = Math.sqrt(variance);
  console.log(`\n[earthRun] nearest-neighbour distances over ${n} settlements:`);
  console.log(`   min=${pct(0).toFixed(1)}  p10=${pct(0.10).toFixed(1)}  p25=${pct(0.25).toFixed(1)}  median=${pct(0.5).toFixed(1)}  p75=${pct(0.75).toFixed(1)}  p90=${pct(0.9).toFixed(1)}  max=${pct(0.999).toFixed(1)}`);
  console.log(`   mean=${mean.toFixed(1)}  stdev=${stdev.toFixed(1)}  CV=${(stdev / Math.max(1, mean)).toFixed(2)}  (low CV → uniform grid; high CV → natural clusters)`);
  // Histogram (5-tile bins)
  const bins = new Array(20).fill(0);
  for (const d of dists) { const b = Math.min(19, Math.floor(d / 5)); bins[b]++; }
  console.log(`   histogram (bins of 5 tiles):`);
  for (let b = 0; b < bins.length; b++) {
    if (bins[b] === 0 && b > 8) continue;
    const lo = b * 5, hi = (b + 1) * 5;
    const bar = "█".repeat(Math.round(bins[b] * 40 / Math.max(1, n)));
    console.log(`   ${String(lo).padStart(3)}-${String(hi).padStart(3)}: ${String(bins[b]).padStart(3)} ${bar}`);
  }
}

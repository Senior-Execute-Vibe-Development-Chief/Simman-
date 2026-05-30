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

import { generateWorld } from "../src/worldgen.js";
import { computeRivers } from "../src/riverGen.js";
import { generateResources } from "../src/resourceGen.js";
import { initPeopleSim, stepPeopleSim, peopleSimStats } from "../src/peopleSim/index.js";
import { settlementPower } from "../src/peopleSim/conquest.js";

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

console.log(`[earthRun] seed=${SEED} steps=${STEPS} W=${W} H=${H}`);

// ── 1. Worldgen ──────────────────────────────────────────────────────
let t0 = performance.now();
const w = generateWorld(W, H, SEED, "earth_sim", 0.78, true, false, {});
console.log(`[earthRun] worldgen done in ${((performance.now() - t0) / 1000).toFixed(1)}s`);
let land = 0; for (let i = 0; i < W * H; i++) if (w.elevation[i] > 0) land++;
console.log(`[earthRun] land tiles: ${land} (${Math.round(land * 100 / (W * H))}% of map)`);

// ── 2. Post-worldgen tile data (minimal createTerritory equivalent) ──
// Downsample to tile space. At RES=1 this is identity.
const tElev = new Float32Array(TW * TH), tTemp = new Float32Array(TW * TH);
const tMoist = new Float32Array(TW * TH), tCoast = new Uint8Array(TW * TH);
const tCrop = new Float32Array(TW * TH);

function tileFert(t, m, e) {
  if (e > 0.45) return 0.01;
  const tFactor = Math.min(1, t * 1.5) * Math.min(1, 1 - Math.pow(Math.max(0, t - 0.7), 2) * 4);
  const mFactor = Math.exp(-((m - 0.45) * (m - 0.45)) / (2 * 0.22 * 0.22));
  const base = tFactor * mFactor;
  return Math.max(0.01, base * (1 - Math.max(0, e - 0.15) * 3));
}

for (let ty = 0; ty < TH; ty++) {
  for (let tx = 0; tx < TW; tx++) {
    const px = Math.min(W - 1, tx * RES), py = Math.min(H - 1, ty * RES);
    const ti = ty * TW + tx, i = py * W + px;
    tElev[ti] = w.elevation[i];
    tTemp[ti] = w.temperature[i];
    tMoist[ti] = w.moisture[i];
    tCoast[ti] = w.coastal[ti] || 0;
    tCrop[ti] = tileFert(w.temperature[i], w.moisture[i], w.elevation[i]);
  }
}

// ── 3. Rivers ────────────────────────────────────────────────────────
t0 = performance.now();
const rivers = computeRivers(TW, TH, tElev, tMoist, tTemp);
w.rivers = rivers;
let riverTiles = 0;
if (rivers && rivers.riverMag) for (let i = 0; i < rivers.riverMag.length; i++) if (rivers.riverMag[i] >= 2) riverTiles++;
console.log(`[earthRun] rivers done in ${((performance.now() - t0) / 1000).toFixed(1)}s — ${riverTiles} river tiles`);

// ── 4. Resources ─────────────────────────────────────────────────────
t0 = performance.now();
const deposits = generateResources(TW, TH, tElev, tTemp, tMoist, tCoast, w, w._seed || SEED, rivers);
w.deposits = deposits;
const depCounts = {};
for (const id in deposits) {
  let n = 0; for (let i = 0; i < deposits[id].length; i++) if (deposits[id][i] > 0.1) n++;
  depCounts[id] = n;
}
console.log(`[earthRun] resources done in ${((performance.now() - t0) / 1000).toFixed(1)}s`);
console.log(`[earthRun] deposits (richness>0.1):`, depCounts);

// ── 5. Init peopleSim ────────────────────────────────────────────────
t0 = performance.now();
const world = initPeopleSim(w, { seed: w._seed || SEED, tCrop, tileRes: RES, deposits });
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

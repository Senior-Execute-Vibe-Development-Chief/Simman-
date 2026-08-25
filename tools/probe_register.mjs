// THE CITY REGISTER READ — are cities stuck at the bar and starving?
// (2026-08-25, the owner's play report, problem 1: "the vast majority of
// cities are STILL stuck at the absolute population minimum, 12k, and
// starving at all times" — at the app's observed-climate regime.)
//
// Steps an observed-climate world under the live arm and reads, per
// checkpoint: the urban-core size distribution against the city bar
// (TIER_CORE[2] — "stuck at the minimum" = cores piled within ~1.2× of it),
// the FED distribution (s._fedM, the smoothed supply/demand — "starving at
// all times" = fed well under 1 chronically), granaries, the import share
// (probe_zipf's fuel gauge: (foodNet − landFood)/supply), and primacy.
// Distinguishes the two candidate diagnoses:
//   · GROWTH ceiling (cores capped at what local land feeds; imports ≈ 0 —
//     the deferred agglomeration story): cores pile at the bar but fed ≈ 1.
//   · FOOD shortfall (the ledger genuinely underfeeds the core): fed << 1 —
//     then WHERE (which regions/classes) and how it correlates with cv.
//
//   SIM_TUNE="<live arm>" node tools/probe_register.mjs [steps=10000] [W=480] [seed=8817]
import { readFileSync } from "node:fs";
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { TIER_CORE } from "../src/sim/peopleSim/settlement.js";
import { ensureYieldCv } from "../src/sim/peopleSim/harvest.js";

const STEPS = +(process.argv[2] || 10000);
const W = +(process.argv[3] || 480), H = W >> 1, SEED = +(process.argv[4] || 8817);

const rc = await import("../src/realClimateData.js");
const load = n => JSON.parse(readFileSync(new URL(`../data/${n}`, import.meta.url)));
rc.provideRealClimateData(load("global_precip.json"), load("global_airtemp.json"));
const world = buildSim({ W, H, seed: SEED, realWind: true, realWindFns: { isRealWindAvailable: () => false, isRealClimateAvailable: rc.isRealClimateAvailable, fillRealClimate: rc.fillRealClimate } });

const q = (a, f) => (a.length ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(f * a.length))] : 0);
console.log(`\n=== CITY REGISTER  ${W}x${H} (tw=${world.tw})  seed ${SEED}  OBSERVED + live arm  ${STEPS} steps ===`);
console.log(`  city bar TIER_CORE[2] = ${TIER_CORE[2]} census units (~${TIER_CORE[2]}k people)\n`);
const cv = ensureYieldCv(world);
for (let s = 0; s < STEPS; s += 1000) {
  stepPeopleSim(world, 1000);
  const cores = [], feds = [], gran = [], imp = [], hungryCv = [], fedCv = [];
  let atBar = 0, n = 0;
  for (const st of world.settlements) {
    if (st.mode !== "settled") continue;
    n++;
    const core = st._urbanPop ?? st.people;
    cores.push(core);
    if (core <= TIER_CORE[2] * 1.25) atBar++;
    const fed = st._fedM ?? 1;
    feds.push(fed);
    gran.push(st.food || 0);
    const supply = st._foodSupply || 0;
    imp.push(supply > 0 ? Math.max(0, ((st._foodNet ?? 0) - (st._landFood || 0)) / supply) : 0);
    const ti = (st.pos.y | 0) * world.tw + (st.pos.x | 0);
    (fed < 0.85 ? hungryCv : fedCv).push(cv[ti] || 0);
  }
  cores.sort((a, b) => b - a);
  const prim = cores.length > 1 ? cores[0] / cores[1] : 1;
  console.log(`  step ${String(world.step).padStart(6)}  n ${String(n).padStart(3)} · core p10/50/90 ${q(cores, .1).toFixed(0)}/${q(cores, .5).toFixed(0)}/${q(cores, .9).toFixed(0)} · at-bar(≤1.25×) ${Math.round(100 * atBar / Math.max(1, n))}% · fed p10/50/90 ${q(feds, .1).toFixed(2)}/${q(feds, .5).toFixed(2)}/${q(feds, .9).toFixed(2)} · hungry(<0.85) ${Math.round(100 * feds.filter(f => f < 0.85).length / Math.max(1, n))}% · granary p50 ${q(gran, .5).toFixed(0)} · importShare p50/p90 ${q(imp, .5).toFixed(2)}/${q(imp, .9).toFixed(2)} · primacy ${prim.toFixed(1)} · cv(hungry) ${q(hungryCv, .5).toFixed(2)} vs cv(fed) ${q(fedCv, .5).toFixed(2)}`);
}
console.log(`\n  READ: at-bar% high + fed ≈ 1 → the growth ceiling (agglomeration lap).`);
console.log(`  fed << 1 → a food shortfall: cv(hungry) >> cv(fed) convicts the harvest`);
console.log(`  swings / ghost-cv seats; similar cv means the base ledger underfeeds.`);

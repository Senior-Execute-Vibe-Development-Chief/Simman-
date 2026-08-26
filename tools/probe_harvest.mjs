// THE HARVEST-YEARS REFEREE — does the annual layer behave? (2026-08-25)
//
// Runs the same world under the legacy scripted-famine arm and the
// T.HARVEST_YEARS arm and reads: the annual multiplier's regional amplitude
// (does England swing ±10% while the Sahel swings ±40%?), the famine cadence
// (events per millennium, by region class — England ~2/1000y, the Sahel
// chronic), granary/price behaviour, and the aggregate world food economy
// (did the mean harvest stay ~1 — no free food, no hidden tax?).
//
//   node tools/probe_harvest.mjs [W=480] [seed=8817] [steps=6000]
import { buildSim, SIM_TUNE_OVERRIDES } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { applyTuning, T } from "../src/sim/peopleSim/tuning.js";
import { ensureYieldCv, LEAN_Z } from "../src/sim/peopleSim/harvest.js";

const W = +(process.argv[2] || 480), H = W >> 1;
const SEED = +(process.argv[3] || 8817);
const STEPS = +(process.argv[4] || 6000);
const q = (a, f) => (a.length ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(f * a.length))] : 0);

function runArm(harvest) {
  applyTuning({ ...(harvest ? { HARVEST_YEARS: 1 } : { HARVEST_YEARS: 0 }), ...SIM_TUNE_OVERRIDES });
  const world = buildSim({ W, H, seed: SEED });
  const TW = world.tw;
  const lonOf = (x) => (x / TW) * 360 - 180, latOf = (y) => 90 - (y / TW * 2) * 180;
  // per-settlement multiplier time series, keyed by region class of its tile CV
  const mulSeries = { low: [], mid: [], high: [] };   // cv<0.15 / 0.15-0.3 / >0.3
  const foodSeries = [];
  let famines0 = 0;
  const checkEvery = 2;   // every harvest year
  const cv = ensureYieldCv(world);
  for (let s = 0; s < STEPS; s += checkEvery) {
    stepPeopleSim(world, checkEvery);
    if (harvest) {
      for (const st of world.settlements) {
        if (st.mode !== "settled" || st._harvestYearMul === undefined) continue;
        const ti = (st.pos.y | 0) * TW + (st.pos.x | 0);
        const c = cv[ti] || 0;
        const bucket = c < 0.15 ? "low" : c < 0.3 ? "mid" : "high";
        mulSeries[bucket].push(st._harvestYearMul);
      }
    }
    if (s % 500 === 0) {
      let food = 0, n = 0;
      for (const st of world.settlements) if (st.mode === "settled") { food += st.food || 0; n++; }
      foodSeries.push({ step: world.step, granary: n ? food / n : 0, n });
    }
  }
  const famines = (world.events || []).filter(e => e.type === "famine.struck").length;
  famines0 = famines;
  return { world, mulSeries, foodSeries, famines: famines0 };
}

console.log(`\n=== HARVEST-YEARS REFEREE  ${W}x${H} seed ${SEED} ${STEPS} steps (${(STEPS / 2).toFixed(0)} harvest years) ===`);
console.error("[arm 1/2] legacy scripted famine ...");
const A = runArm(false);
console.error("[arm 2/2] HARVEST_YEARS ...");
const B = runArm(true);

console.log(`\n  ANNUAL MULTIPLIER by tile-CV class (HARVEST arm; p10/p50/p90 over all settlement-years):`);
for (const k of ["low", "mid", "high"]) {
  const v = B.mulSeries[k];
  console.log(`    cv ${k.padEnd(4)} n=${String(v.length).padStart(6)}  ${q(v, .1).toFixed(2)}/${q(v, .5).toFixed(2)}/${q(v, .9).toFixed(2)}  mean ${(v.reduce((a, b) => a + b, 0) / Math.max(1, v.length)).toFixed(3)}`);
}
const yrs = STEPS / 2, kyr = yrs / 1000;
console.log(`\n  FAMINE EVENTS (famine.struck): legacy ${A.famines} (${(A.famines / kyr).toFixed(1)}/1000y)  vs  harvest ${B.famines} (${(B.famines / kyr).toFixed(1)}/1000y)`);
console.log(`\n  GRANARY (mean settlement food, sampled):`);
console.log(`    step      legacy    harvest`);
for (let i = 0; i < Math.min(A.foodSeries.length, B.foodSeries.length); i++) {
  const a = A.foodSeries[i], b = B.foodSeries[i];
  console.log(`    ${String(a.step).padStart(6)}  ${a.granary.toFixed(1).padStart(8)}  ${b.granary.toFixed(1).padStart(8)}   (n ${a.n}/${b.n})`);
}
console.log(`\n  settlements at end: legacy ${A.world.settlements.filter(s => s.mode === "settled").length}  harvest ${B.world.settlements.filter(s => s.mode === "settled").length}`);
console.log(`  READ: mean multiplier ~1.00 per class (no hidden tax/subsidy); amplitude ordered`);
console.log(`  low<mid<high; famine cadence regionally honest (chronic only where cv is high);`);
console.log(`  granary/aliveness within a sane band of legacy.`);

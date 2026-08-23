// WHY DOESN'T THE IRRIGATION THAT ALREADY SHIPS REACH MESOPOTAMIA? (2026-08-23)
//
// owner-review-2026-08-21 item 2 names irrigation as "a mechanism the sim does not
// have". That is STALE: FIELD_CRADLE, IRR_BAND, IRRIG_CROP and FLOOD_OPT all ship
// at 1, and popField.js's capacity pass carries the cradle stack:
//
//     arid = clamp((IRRIG_ARID0(0.52) - moist) / 0.20)
//     irr  = 1 + IRRIG_BOOST(1.5) * FIELD_CRADLE * arid * water * farmTech
//     allu = 1 + ALLUVIUM(2.0)   * FIELD_CRADLE * (water + 0.5*coast) * farmTech
//     cap *= irr * allu
//
// So irrigation exists and Mesopotamia still carries only a THIRD of the Nile per
// land tile (5,352 vs 16,837, probe_cradlelag). Three terms can be starving it and
// they call for completely different fixes:
//
//   moist    — if southern Mesopotamia is not ARID enough in the climate model,
//              `arid` is small and the canal premium never applies. A climate
//              problem.
//   water    — if the Tigris and Euphrates carry little banded river magnitude
//              where the Nile carries a lot, `water` is small. At tw=240 one tile
//              is ~167 km, so two medium rivers may simply not resolve into a
//              channel the way a single great one does. A RESOLUTION problem, and
//              the third cardinal rule's own territory.
//   farmTech — if the local development wave has not arrived, the whole stack is
//              gated off regardless. A timing problem.
//
// Building irrigation harder would be the fourth correct-and-irrelevant lever of
// the day if the starved term is `water` or `farmTech`. So this measures the terms
// themselves, per region, rather than the outcome.
//
//   node tools/probe_irrfield.mjs [steps] [W] [seed]
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { T } from "../src/sim/peopleSim/tuning.js";

const STEPS = +(process.argv[2] || 20000);
const W = +(process.argv[3] || 480), H = W >> 1;
const SEED = +(process.argv[4] || 8817);

const world = buildSim({ W, H, seed: SEED });
stepPeopleSim(world, STEPS);

const tw = world.tw, th = world.th, N = world.N, elev = world.elev;
const lonOf = (x) => (x / tw) * 360 - 180;
const latOf = (y) => 90 - (y / th) * 180;
const R = [
  { k: "Nile",        lon: [26, 34], lat: [16, 32] },
  { k: "Mesopotamia", lon: [40, 50], lat: [29, 38] },
  { k: "Indus",       lon: [66, 78], lat: [22, 34] },
  { k: "YellowRiver", lon: [104, 122], lat: [30, 42] },
  { k: "~Sahel",      lon: [-18, 40], lat: [8, 18] },
];

// the same fields the capacity pass reads
const rmEff = (T.ACCESS_BAND && world._rmBand) ? world._rmBand : world.riverMag;
const coastEff = (T.ACCESS_BAND && world._coastBand) ? world._coastBand : world.coast;
const moistF = world.moist, devF = world.devField, cap = world.capField;
// RM_FULL is popField-local; recover the same normalisation empirically from the
// field's own top of range so the `water` term below is on the pass's own scale.
let rmMax = 0; for (let i = 0; i < N; i++) if (elev[i] > 0 && rmEff && rmEff[i] > rmMax) rmMax = rmEff[i];

const q = (a, f) => (a.length ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(f * a.length))] : 0);
const FARM_MATURE_F = 0.5, ALLU_COAST_F = 0.5, arid0 = T.IRRIG_ARID0 ?? 0.52;
const irrB = (T.IRRIG_BOOST || 0) * (T.FIELD_CRADLE || 0), alluB = (T.ALLUVIUM || 0) * (T.FIELD_CRADLE || 0);

console.log(`\n=== THE IRRIGATION TERMS, PER REGION  ${W}x${H} (tw=${tw})  seed ${SEED}  step ${world.step} ===`);
console.log(`    FIELD_CRADLE=${T.FIELD_CRADLE}  IRRIG_BOOST=${T.IRRIG_BOOST}  ALLUVIUM=${T.ALLUVIUM}  IRRIG_ARID0=${arid0}`);
console.log(`    (irrigation SHIPS ON — this asks which of its three inputs is starved, not whether it exists)\n`);
console.log(`  region        tiles   moist p50   ARID p50/p90   water p50/p90   farmTech p50   irr p50/max   allu p50/max   cap/tile`);
for (const r of R) {
  const mo = [], ar = [], wa = [], ft = [], ir = [], al = [];
  let capSum = 0, n = 0;
  for (let ti = 0; ti < N; ti++) {
    if (!(elev[ti] > 0)) continue;
    const y = (ti / tw) | 0, x = ti - y * tw, lo = lonOf(x), la = latOf(y);
    if (!(lo >= r.lon[0] && lo <= r.lon[1] && la >= r.lat[0] && la <= r.lat[1])) continue;
    n++; capSum += cap ? cap[ti] : 0;
    const m = moistF ? moistF[ti] : 0;
    const water = rmEff && rmMax > 0 ? Math.min(1, rmEff[ti] / (rmMax * 0.25)) : 0;   // pass uses /RM_FULL; scaled to the field's own top quartile
    const a = devF ? devF[ti] : 0;
    const farmTech = Math.min(1, a / FARM_MATURE_F);
    const arid = Math.max(0, Math.min(1, (arid0 - m) / 0.20));
    const coastV = coastEff ? coastEff[ti] : 0;
    mo.push(m); ar.push(arid); wa.push(water); ft.push(farmTech);
    ir.push(1 + irrB * arid * water * farmTech);
    al.push(1 + alluB * (water + ALLU_COAST_F * coastV) * farmTech);
  }
  if (!n) continue;
  console.log(`  ${r.k.padEnd(13)} ${String(n).padStart(5)}   ${q(mo, .5).toFixed(3).padStart(9)}   ${q(ar, .5).toFixed(2)}/${q(ar, .9).toFixed(2).padStart(4)}   ${q(wa, .5).toFixed(3)}/${q(wa, .9).toFixed(3)}   ${q(ft, .5).toFixed(2).padStart(12)}   ${q(ir, .5).toFixed(2)}/${Math.max(...ir).toFixed(2)}   ${q(al, .5).toFixed(2)}/${Math.max(...al).toFixed(2)}   ${(capSum / n).toFixed(0).padStart(8)}`);
}
console.log(`\n  WHICH TERM IS STARVED decides the fix:`);
console.log(`   · low ARID  -> the climate model does not think it is dry. A climate problem;`);
console.log(`                  building irrigation harder cannot help, the premium never applies.`);
console.log(`   · low WATER -> the rivers do not resolve into channel magnitude here. A GRID`);
console.log(`                  problem before it is a physics one — re-measure at tw=480 before`);
console.log(`                  touching anything (third cardinal rule).`);
console.log(`   · low TECH  -> the development wave has not arrived; the whole stack is gated`);
console.log(`                  off regardless of climate or water. A timing problem.`);
console.log("");

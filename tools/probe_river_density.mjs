// River-NETWORK density vs resolution. The open resolution-invariance residual (plan doc) is that
// early development runs ~2× slower at 2× resolution, suspect: the riverMag fraction of land halves
// per 2× resolution (a riverGen accumulation-threshold artefact), so there are fewer river-valley
// CRADLES to seed states → fewer civilisations. This measures, at a given grid, the fraction of
// LAND tiles that carry a river channel at each magnitude, plus floodplain + fertility, so we can
// see whether the drainage network thins with resolution.
//   node tools/probe_river_density.mjs [W] [seed]
import { buildSim } from "./_harness.mjs";

const W = +(process.argv[2] || 480), H = W >> 1;
const SEED = +(process.argv[3] || 8817);
const world = buildSim({ W, H, seed: SEED });
const N = world.N, elev = world.elev, rm = world.riverMag, fert = world.fert, flood = world._tFlood || world.tFlood;

let land = 0, r1 = 0, r2 = 0, r3 = 0, fl = 0, fertSum = 0, hiFert = 0;
for (let t = 0; t < N; t++) {
  if (elev[t] <= 0) continue; land++;
  const m = rm ? rm[t] : 0;
  if (m >= 1) r1++; if (m >= 2) r2++; if (m >= 3) r3++;
  if (flood && flood[t]) fl++;
  const f = fert ? fert[t] : 0; fertSum += f; if (f >= 0.7) hiFert++;
}
const pct = (x) => (100 * x / land).toFixed(2) + "%";
console.log(`\n  ${W}w  (tw=${world.tw})  land tiles ${land}`);
console.log(`  river tiles:  mag≥1 ${pct(r1)}   mag≥2 ${pct(r2)}   mag≥3 ${pct(r3)}`);
console.log(`  floodplain:   ${flood ? pct(fl) : "n/a"}`);
console.log(`  fertility:    mean ${(fertSum/land).toFixed(3)}   fert≥0.7 ${pct(hiFert)}`);

// Worldgen resolution-sampling probe (docs/resolution-invariance-plan.md, the open
// early-growth channel): does the SAME seed produce the same real-area FRACTIONS of
// prime cropland at different grid resolutions? If the floodplain/river/high-fert
// fraction of land shrinks with resolution, early settlements (which sit on exactly
// that land) grow slower at high res — the measured ~0.55× pop/area undershoot.
//   node tools/probe_worldgen_res.mjs <W> [seed]
import { buildSim } from "./_harness.mjs";

const W = parseInt(process.argv[2] || "480", 10), H = W >> 1;
const SEED = parseInt(process.argv[3] || "8817", 10);
const w = buildSim({ W, H, seed: SEED });
const N = w.N;
let land = 0, flood = 0, riv = 0, fertSum = 0, f5 = 0, f8 = 0;
for (let i = 0; i < N; i++) {
  if (!(w.elev[i] > 0)) continue;
  land++;
  const f = w.fert[i] || 0;
  fertSum += f;
  if (f >= 0.5) f5++;
  if (f >= 0.8) f8++;
  if (w.tFlood && w.tFlood[i]) flood++;
  if (w.riverMag && w.riverMag[i] >= 2) riv++;
}
const pc = (x) => (100 * x / land).toFixed(2) + "%";
console.log(`${W}x${H} (tw=${w.tw}) seed=${SEED}: land=${land} (${(100 * land / N).toFixed(1)}% of map)`);
console.log(`  meanFert=${(fertSum / land).toFixed(4)}  fert>=0.5: ${pc(f5)}  fert>=0.8: ${pc(f8)}  flood: ${pc(flood)}  river(mag>=2): ${pc(riv)}`);

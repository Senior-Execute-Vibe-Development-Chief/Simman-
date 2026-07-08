// Pulse detector: trace the control field's TOTAL claimed land over consecutive ticks. A
// healthy feed-forward field grows/settles monotonically toward the real extent; the old
// closed-loop scale PULSED (area swung up/down repeatedly). Prints the field-claimed fraction
// every STEP ticks over a window and flags oscillation (sign-changing deltas).
//   node tools/probe_ctrl_pulse.mjs [seed] [warm] [window] [sample]
import { buildSim } from "./_harness.mjs";
import { applyTuning } from "../src/sim/peopleSim/tuning.js";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";

applyTuning({ CONTROL_FIELD: 1 });
const SEED = +(process.argv[2] || 8817);
const WARM = +(process.argv[3] || 8000);
const WIN  = +(process.argv[4] || 4000);
const SAMPLE = +(process.argv[5] || 100);
const W = 480, H = 240;
const world = buildSim({ W, H, seed: SEED });
const N = world.N, elev = world.elev;

function fieldClaimed() {
  const o = world._ctrlOwner; if (!o) return 0;
  let c = 0, land = 0;
  for (let t = 0; t < N; t++) { if (elev[t] <= 0) continue; land++; if (o[t] >= 0) c++; }
  return c / land;
}
function realClaimed() {
  const o = world._countryOwner; if (!o) return 0;
  let c = 0, land = 0;
  for (let t = 0; t < N; t++) { if (elev[t] <= 0) continue; land++; if (o[t] >= 0) c++; }
  return c / land;
}

stepPeopleSim(world, WARM);
const trace = [];
for (let s = 0; s < WIN; s += SAMPLE) {
  stepPeopleSim(world, SAMPLE);
  trace.push({ step: WARM + s + SAMPLE, field: fieldClaimed(), real: realClaimed() });
}

let flips = 0, maxSwing = 0, prevDelta = 0;
console.log("  step    field%   real%   Δfield");
for (let i = 0; i < trace.length; i++) {
  const t = trace[i];
  const d = i > 0 ? t.field - trace[i - 1].field : 0;
  if (i > 1 && Math.sign(d) !== 0 && Math.sign(d) !== Math.sign(prevDelta) && Math.sign(prevDelta) !== 0) flips++;
  if (i > 0) maxSwing = Math.max(maxSwing, Math.abs(d));
  prevDelta = d !== 0 ? d : prevDelta;
  console.log(`  ${String(t.step).padStart(6)}  ${(t.field*100).toFixed(1).padStart(6)}  ${(t.real*100).toFixed(1).padStart(6)}   ${(d*100>=0?"+":"")}${(d*100).toFixed(2)}`);
}
console.log(`\n  direction flips: ${flips} (0-2 = settling; many = PULSING)`);
console.log(`  max per-sample swing: ${(maxSwing*100).toFixed(2)}% of land over ${SAMPLE} ticks`);

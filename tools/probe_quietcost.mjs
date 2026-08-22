// The quiet-ages cost profile (owner 2026-08-19: "dawn through stone age has
// very little going on — what is running that is expensive and unnecessary?").
// Uses the sim's own per-pass profiler (world._dbgProfile -> world.debug.pass)
// over sampling windows in the pre-farming forager span and the pre-state
// Neolithic, under the app's true regime. A pass that costs real ms while its
// entity list is empty (no settlements / no realms) is the target list.
//   SIM_TUNE="DAWN_LIVE=1,STATE_RECORDS=1" node tools/probe_quietcost.mjs [W] [seed]
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";

const W = +(process.argv[2] || 480), SEED = +(process.argv[3] || 8817);
const world = buildSim({ W, H: W >> 1, seed: SEED });

function window_(label, upto, sample) {
  const gap = upto - world.step - sample;
  if (gap > 0) stepPeopleSim(world, gap);
  world._dbgProfile = true;
  const agg = new Map();
  const t0 = performance.now();
  for (let i = 0; i < sample; i++) {
    stepPeopleSim(world, 1);
    for (const [k, v] of Object.entries(world.debug.pass || {})) agg.set(k, (agg.get(k) || 0) + v);
  }
  const total = performance.now() - t0;
  world._dbgProfile = false;
  const rows = [...agg.entries()].sort((a, b) => b[1] - a[1]);
  const nSett = world.settlements.filter((s) => s.mode === "settled").length;
  console.log(`\n=== ${label}: steps ${world.step - sample}-${world.step}  ${(total / sample).toFixed(1)}ms/step  settlements=${nSett} realms=${world.countries ? world.countries.size : 0}`);
  for (const [k, v] of rows.slice(0, 14)) console.log(`  ${(v / sample).toFixed(2).padStart(8)}ms/step  ${k}  (${(100 * v / total).toFixed(0)}%)`);
}

window_("forager span (pre-farming)", 3000, 200);
window_("Neolithic (farming, pre-state)", 10000, 200);

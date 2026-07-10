// Chronology distortion probe: how many DYN-YEARS (the uniform human clock,
// 0.25y/tick) does the world spend in each era, vs the historical duration?
//   node tools/probe_erapace.mjs        (SIM_TUNE="SCI_COMPOUND=0.6" for the A/B)
// Baseline (default, seed 8817, 42k): Neolithic 3.8x, Bronze 0.8x, Iron 0.3x,
// Medieval 1.0x, Renaissance 3.6x, Industrial 6.5x, Modern 38x — the flat-ceiling
// signature the SCI_COMPOUND curve exists to fix (settlement.js). Iterate the
// exponent against THIS table; never a per-era constant.
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
const world = buildSim({ W: 480, H: 240, seed: 8817 });
stepPeopleSim(world, 42000);
const NAMES = ["Neolithic", "Bronze", "Iron/Classical", "Medieval", "Renaissance", "Industrial", "Modern"];
const HIST = [-3300, -3000, -700, 500, 1450, 1800, 1950, 2050];  // ERA_ANCHOR + endpoint
const ea = world._eraAt || [0];
console.log("era            reached@step  dyn-years spent   historical-years   ratio");
for (let e = 0; e < ea.length; e++) {
  const end = e + 1 < ea.length ? ea[e + 1] : world.step;
  const dynY = (end - ea[e]) * 0.25;
  const histY = (HIST[e + 1] ?? 2050) - HIST[e];
  console.log(`${(NAMES[e] || "era" + e).padEnd(15)} ${String(ea[e]).padStart(8)}    ${String(Math.round(dynY)).padStart(8)}          ${String(histY).padStart(6)}          ${(dynY / histY).toFixed(1)}x`);
}
console.log(`(run ends step ${world.step}, last era ${NAMES[ea.length - 1] || ea.length - 1}${ea.length < 7 ? " — later eras not reached" : ""})`);

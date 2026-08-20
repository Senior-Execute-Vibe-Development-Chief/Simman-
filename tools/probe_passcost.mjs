// THE 20x SLOWDOWN (owner report 2026-08-20): with the peer-seats register
// (~900 cities / ~600 realms at the shipped grid) the app runs ~20x slower.
// Per-entity and per-pair passes tuned for a ~60-entity world now dominate.
// This attributes the tick: run a live world to a dense late state, switch on
// the existing per-pass profiler (world._dbgProfile -> world.debug.pass), and
// print the mean per-tick cost of every pass over a measured window, sorted.
//
//   SIM_TUNE="DAWN_LIVE=1,STATE_RECORDS=1,LAND_KNOW=1,PEER_SEATS=1" node tools/probe_passcost.mjs [warm=24000] [meas=600] [W=960] [seed=8817]
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";

const WARM = +(process.argv[2] || 24000), MEAS = +(process.argv[3] || 600);
const W = +(process.argv[4] || 960), SEED = +(process.argv[5] || 8817);
const world = buildSim({ W, H: W >> 1, seed: SEED });

let t0 = performance.now();
stepPeopleSim(world, WARM);
const warmMs = performance.now() - t0;
const cities = world.settlements.filter((s) => s.mode === "settled").length;
console.log(`[warm] ${WARM} steps in ${(warmMs / 1000).toFixed(0)}s (${(warmMs / WARM).toFixed(2)} ms/step) · ${cities} cities · ${world.countries ? world.countries.size : 0} realms`);

world._dbgProfile = true;
const acc = new Map(); let ticks = 0, tSum = 0;
for (let i = 0; i < MEAS; i++) {
  const t1 = performance.now();
  stepPeopleSim(world, 1);
  tSum += performance.now() - t1; ticks++;
  const p = world.debug.pass;
  if (p) for (const k in p) acc.set(k, (acc.get(k) || 0) + p[k]);
}
console.log(`[measure] ${ticks} ticks, mean ${(tSum / ticks).toFixed(2)} ms/step at step ${world.step}`);
const rows = [...acc.entries()].map(([k, v]) => [k, v / ticks]).sort((a, b) => b[1] - a[1]);
let covered = 0;
for (const [k, ms] of rows) { covered += ms; console.log(`  ${k.padEnd(22)} ${ms.toFixed(3)} ms/tick  (${((ms / (tSum / ticks)) * 100).toFixed(0)}%)`); }
console.log(`  ${"(sum of marks)".padEnd(22)} ${covered.toFixed(3)} of ${(tSum / ticks).toFixed(3)} ms`);
// Inside the field pass: per-phase accumulation (popField.js).
if (world.debug.pf) {
  console.log(`[popField phases] ms/tick:`);
  const pr = Object.entries(world.debug.pf).map(([k, v]) => [k, v / ticks]).sort((a, b) => b[1] - a[1]);
  for (const [k, ms] of pr) console.log(`  ${k.padEnd(22)} ${ms.toFixed(3)}`);
}
// Inside the settlements pass: per-section accumulation (settlement.js).
if (world.debug.sett) {
  console.log(`[settlements sections] ms/tick over the whole register:`);
  const sr = Object.entries(world.debug.sett).map(([k, v]) => [k, v / ticks]).sort((a, b) => b[1] - a[1]);
  for (const [k, ms] of sr) console.log(`  ${k.padEnd(22)} ${ms.toFixed(3)}`);
}

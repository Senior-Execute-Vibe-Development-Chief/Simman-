// Byte-identity guard at the 240-tile REFERENCE grid (W=480) — the companion
// to probe_hashbase.mjs (which runs the 320 grid, BELOW the reference, and so
// re-keys under any resolution-invariance factor). Every res-invariance fix is
// constructed to be ×1.0 EXACTLY at tw=240, so THIS pair must never move:
//   Current pair (2500 steps): 8817=b9c264b9  31337=100239cd
// (verified unchanged across the res-invariance arc AND identity Stage 2 at
// default-off — see probe_hashbase's header chain for the full history).
//   node tools/probe_hash480.mjs [steps]
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { hashWorld } from "../src/sim/persist.js";

const STEPS = parseInt(process.argv[2] || "2500", 10);
for (const seed of [8817, 31337]) {
  const world = buildSim({ W: 480, H: 240, seed });
  stepPeopleSim(world, STEPS);
  console.log(`seed=${seed} steps=${STEPS} W=480  hash=${hashWorld(world)}`);
}

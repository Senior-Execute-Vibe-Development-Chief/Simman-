// Byte-identity guard for the I82 refactor: run fixed seeds a fixed number of
// steps and print the full-state hash. Capture at baseline, compare after each
// change — identical hash ⇒ byte-identical trajectory (stronger than the smoke
// determinism check, which only compares run-to-run on the same code).
//   node tools/probe_hashbase.mjs [steps]
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { hashWorld } from "../src/sim/persist.js";

const STEPS = parseInt(process.argv[2] || "2500", 10);
const SEEDS = [8817, 31337];
const W = 320, H = 160;
for (const seed of SEEDS) {
  const world = buildSim({ W, H, seed });
  stepPeopleSim(world, STEPS);
  console.log(`seed=${seed} steps=${STEPS}  hash=${hashWorld(world)}`);
}

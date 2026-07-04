// Byte-identity guard for any settlement/persist change: run fixed seeds a fixed
// number of steps and print the full-state hash. Capture at baseline, compare
// after each change — identical hash ⇒ byte-identical trajectory (stronger than
// the smoke determinism check, which only compares run-to-run on the same code).
// NB: the hash DEFINITION itself changes when hashWorld's field set changes, so a
// baseline is only comparable within one hashWorld version.
//   node tools/probe_hashbase.mjs [steps]
// Current baseline (2500 steps, settlement + registry hash-hardening):
//   8817=6df86092  31337=82c7f3f   (was 20b4f37e/43c73b01 before registry hashing,
//   11ad8765/27063acb before any hardening — each a different hashWorld field set).
// NB: at 2500 steps the kin graph is still EMPTY — for dynasty-bearing coverage use
// tools/probe_roundtrip_deep.mjs (8000 steps). So the W6-F dynastic levers
// (CROSS_REALM_HEIRS / CLAIMANT_WARS), though now default ON, do not fire here and this
// baseline is unchanged by that flip — it stays a pure settlement/persist byte guard.
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

// Byte-identity guard for any settlement/persist change: run fixed seeds a fixed
// number of steps and print the full-state hash. Capture at baseline, compare
// after each change — identical hash ⇒ byte-identical trajectory (stronger than
// the smoke determinism check, which only compares run-to-run on the same code).
// NB: the hash DEFINITION itself changes when hashWorld's field set changes, so a
// baseline is only comparable within one hashWorld version.
//   node tools/probe_hashbase.mjs [steps]
// Current baseline (2500 steps, CAP_MODEL default ON):
//   8817=5045e8aa  31337=ef8e169b
//   (CAP_MODEL=0 recovers the legacy fitted-tail baseline 6df86092/82c7f3f — the grounded
//   capacity model is the first change to move THIS 2500-step guard, since real states
//   extract revenue and differentiate in capacity well before dynasties form. Earlier
//   hashWorld field sets: 20b4f37e/43c73b01 pre-registry-hashing, 11ad8765/27063acb pre-hardening.)
// NB: at 2500 steps the kin graph is still EMPTY — for dynasty-bearing coverage use
// tools/probe_roundtrip_deep.mjs (8000 steps). The W6-F dynastic levers (CROSS_REALM_HEIRS /
// CLAIMANT_WARS) do not fire here, so their flip left this guard unchanged; CAP_MODEL does.
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { hashWorld } from "../src/sim/persist.js";
import { T } from "../src/sim/peopleSim/tuning.js";

const STEPS = parseInt(process.argv[2] || "2500", 10);
const SEEDS = [8817, 31337];
const W = 320, H = 160;
// Env-overridable levers (unset = defaults): CAP_MODEL=0 recovers the fitted-tail baseline.
for (const k of ["CROSS_REALM_HEIRS", "CLAIMANT_WARS", "CLAIM_POWER_WIN", "CAP_MODEL", "CAP_FISC", "CAP_LOG"]) if (process.env[k] != null) T[k] = +process.env[k];
for (const seed of SEEDS) {
  const world = buildSim({ W, H, seed });
  stepPeopleSim(world, STEPS);
  console.log(`seed=${seed} steps=${STEPS}  hash=${hashWorld(world)}`);
}

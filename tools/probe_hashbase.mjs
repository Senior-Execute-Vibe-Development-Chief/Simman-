// Byte-identity guard for any settlement/persist change: run fixed seeds a fixed
// number of steps and print the full-state hash. Capture at baseline, compare
// after each change — identical hash ⇒ byte-identical trajectory (stronger than
// the smoke determinism check, which only compares run-to-run on the same code).
// NB: the hash DEFINITION itself changes when hashWorld's field set changes, so a
// baseline is only comparable within one hashWorld version.
//   node tools/probe_hashbase.mjs [steps]
// Current baseline (2500 steps): 692c38be/2532b712 (SCI_COMPOUND 1.5 + LABOR_INNOV 0.6
// defaults — the chronology repacing; LABOR_INNOV=0 gives 1c56993f/eeff4048,
// SCI_COMPOUND=0 recovers the pre-chronology f4530e0a/18235178).
// Older baseline (2500 steps, RES_INVARIANT_POP default ON — this probe grid is 320-pixel/tw160, rNorm 0.67):
//   8817=d3acad98  31337=ffeab697   (REACTIVE-SETTLEMENT model, TILE_POLITY + CATCHMENT_CLIP
//   default ON — settlements are reactionary to the political map: only the CAPITAL anchors a
//   border, and the economic catchment is clipped to the tiles its country already holds, so a
//   settlement never creates or moves a border. TILE_POLITY=0 + CATCHMENT_CLIP=0 recovers the
//   prior FIELD-SIMULATION default byte-identically: 8817=809cfa67 31337=8da625d2 — that hash is
//   now the lever-off baseline (people on a per-tile population field, territory grown by governed
//   capacity from member cores; POP_FIELD=0 under it recovers the pre-field settlement model
//   8817=ed576254 31337=92744c20). Under POP_FIELD=0, FIELD_POLITY=0 further recovers the ENTITY model
//   7a3afd73/7e8d33f. Prior default
//   (REGION_SPACING 1.2, entity model) was 7a3afd73/7e8d33f; RES_INVARIANT_POP=0 under it
//   478cd406/827e1f09. Earlier: 8a3eca3c/2a354abf (ridge relief); 38a440bb/53cd01ed
//   (empire mortality); 22b292be/53cd01ed (statecraft symmetry); f2b5211b/2f83e5c5
//   (real-width floodplain ribbon); 316e19ea/9d292e22 (ribbon rescale).)
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
for (const k of ["CROSS_REALM_HEIRS", "CLAIMANT_WARS", "CLAIM_POWER_WIN", "CAP_MODEL", "CAP_FISC", "CAP_LOG", "RES_INVARIANT_POP"]) if (process.env[k] != null) T[k] = +process.env[k];
for (const seed of SEEDS) {
  const world = buildSim({ W, H, seed });
  stepPeopleSim(world, STEPS);
  console.log(`seed=${seed} steps=${STEPS}  hash=${hashWorld(world)}`);
}

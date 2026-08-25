// Byte-identity guard at the 240-tile REFERENCE grid (W=480) — the companion
// to probe_hashbase.mjs (which runs the 320 grid, BELOW the reference, and so
// re-keys under any resolution-invariance factor). Every res-invariance fix is
// constructed to be ×1.0 EXACTLY at tw=240, so this pair moves ONLY on a
// deliberate default BEHAVIOUR change (not a res factor):
//   Current pair (2500 steps, v43 FOREST_LOCK=0.8 regime): 8817=370172a6  31337=8481465f
//   (SIM_TUNE="FOREST_LOCK=0" recovers the prior pair 8817=201db8af 31337=9e4ca0c5,
//   which itself carried BORN_OF_LAND/SEAT_ADMIN/SEAT_FIELD — the 2026-08-22..24 wave.)
//   Prior pair (2500 steps): 8817=6c46c2d1  31337=9262bb95
//   (SIZE_BY_POP flipped DEFAULT 0→1 — realm size = governed-people core +
//   logistics march, replacing the COVER_BASE/COVER_ORG floor so realms
//   smaller than Egypt exist and coverage rises with development; the popCapK
//   anchor is smoothed+persisted so save/load continuation is clean. docs/
//   empire-consolidation-2026-07.md "THE MINIMUM-EGYPT FIX".)
//   SIM_TUNE="SIZE_BY_POP=0" recovers the pre-flip pair EXACTLY:
//   8817=b9c264b9 31337=100239cd (the res-invariance + identity-Stage-2 world,
//   the size distribution where nothing smaller than Egypt existed). This is
//   the FIRST change to move the reference pair — every prior arc was ×1 here.
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

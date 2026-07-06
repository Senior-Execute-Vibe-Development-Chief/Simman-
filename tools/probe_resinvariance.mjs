// Resolution-invariance probe (docs/resolution-invariance-plan.md).
// The same Earth must hold the same real settlement density and population at any
// grid resolution. This runs ONE (resolution, seed) cell and reports density samples
// at MATCHED DEVELOPMENT (leading-org crossings, not fixed steps — a bigger grid
// develops on a different schedule, so stepping to a fixed tick would compare
// different eras). Compare cells across resolutions:
//   RES_INVARIANT_POP=1 node tools/probe_resinvariance.mjs <W> [steps] [seed]
// Invariance holds when, at each org crossing, setts-per-1k-land and pop-per-land
// agree across W within a few % (they currently scale ~linearly with W — the bug).
// The lever under test defaults ON here (measuring the fix); RES_INVARIANT_POP=0
// env measures the tile-unit baseline.
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim, peopleSimStats } from "../src/sim/peopleSim/index.js";
import { T } from "../src/sim/peopleSim/tuning.js";

const W = parseInt(process.argv[2] || "480", 10), H = W >> 1;
const STEPS = parseInt(process.argv[3] || "16000", 10);
const SEED = parseInt(process.argv[4] || "8817", 10);
T.RES_INVARIANT_POP = process.env.RES_INVARIANT_POP != null ? +process.env.RES_INVARIANT_POP : 1;
const ORG_MARKS = [0.25, 0.35, 0.45, 0.55, 0.65];   // development crossings to sample at
const CHUNK = 250;

const world = buildSim({ W, H, seed: SEED });
let land = 0; for (let i = 0; i < W * H; i++) if (world.elev[i] > 0) land++;
console.log(`── res-invariance · ${W}x${H} · seed ${SEED} · lever=${T.RES_INVARIANT_POP} · land=${land} ──`);
console.log(`leadOrg  step    setts  setts/1k-land  pop(units)  pop/land`);
let next = 0;
for (let s = 0; s < STEPS && next < ORG_MARKS.length; s += CHUNK) {
  stepPeopleSim(world, CHUNK);
  let leadOrg = 0;
  for (const c of (world.countries ? world.countries.values() : [])) {
    const k = c.capital && c.capital.knowledge;
    if (k && k.organization > leadOrg) leadOrg = k.organization;
  }
  while (next < ORG_MARKS.length && leadOrg >= ORG_MARKS[next]) {
    const st = peopleSimStats(world);
    console.log(`${ORG_MARKS[next].toFixed(2)}     ${String(world.step).padStart(6)}  ${String(st.settlements).padStart(5)}  ${(1000 * st.settlements / land).toFixed(2).padStart(13)}  ${String(Math.round(st.totalPeople)).padStart(10)}  ${(st.totalPeople / land).toFixed(2).padStart(8)}`);
    next++;
  }
}
if (next < ORG_MARKS.length) console.log(`(run ended at step ${world.step} before reaching org ${ORG_MARKS[next]} — raise steps)`);

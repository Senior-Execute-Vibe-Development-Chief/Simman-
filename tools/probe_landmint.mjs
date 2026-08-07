// DOES MINTING A NATION RESET ITS LAND'S POPULATION? — owner-observed at the
// app grid. Watches the FIRST land-nation formation: buffers the founding
// cell's field population and capacity for the 60 ticks before, then prints
// them for 120 ticks after, so a reset and its exact tick — and whether
// capacity moved first — are read off directly.
//
//   SIM_TUNE="DAWN_LIVE=1" node tools/probe_landmint.mjs [steps] [seed] [W]
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { labelSiteLedger } from "../src/sim/peopleSim/crystallize.js";

const STEPS = parseInt(process.argv[2] || "20000", 10);
const SEED = parseInt(process.argv[3] || "8817", 10);
const W = parseInt(process.argv[4] || "480", 10);

const world = buildSim({ W, H: W / 2, seed: SEED });
let watching = null, printed = 0;
const ring = [];   // pre-formation buffer of {step, pop, cap}

function cellSum(k) {
  const L = labelSiteLedger(world);
  const pf = world.popField, cf = world.capField;
  let p = 0, c = 0;
  for (let i = 0; i < L.siteId.length; i++) if (L.siteId[i] === k) { p += pf ? pf[i] : 0; c += cf ? cf[i] : 0; }
  return { p, c };
}

for (let i = 0; i < STEPS; i++) {
  stepPeopleSim(world);
  const seats = world._landSeats;
  if (!watching) {
    if (seats && seats.size > 0) {
      const [id, rec] = [...seats][0];
      const L = labelSiteLedger(world);
      watching = { id, k: L.siteId[rec.ti], ti: rec.ti, at: world.step };
      console.log(`FORMED nation ${id} at step ${world.step} (seat ti ${rec.ti}, cell ${watching.k})`);
      console.log(`--- pre-formation (buffered):`);
      for (const r of ring.slice(-60)) console.log(`${String(r.step).padStart(6)} | pop ${r.pop.toFixed(0).padStart(8)} | cap ${r.cap.toFixed(0).padStart(8)}`);
      console.log(`--- post-formation:`);
    } else if (world.popField) {
      // Buffer a plausible future cell: the densest unclaimed site's cell.
      // Cheap proxy: buffer ALL cells is too much — buffer the global field
      // total instead pre-formation, then the cell after. Global total also
      // exposes a world-scale reset.
      let tot = 0; const pf = world.popField;
      for (let t = 0; t < world.N; t++) tot += pf[t];
      ring.push({ step: world.step, pop: tot, cap: NaN });
      if (ring.length > 60) ring.shift();
    }
    continue;
  }
  if (printed < 120) {
    const { p, c } = cellSum(watching.k);
    let tot = 0; const pf = world.popField;
    for (let t = 0; t < world.N; t++) tot += pf[t];
    console.log(`${String(world.step).padStart(6)} | cell pop ${p.toFixed(0).padStart(8)} | cell cap ${c.toFixed(0).padStart(8)} | world pop ${tot.toFixed(0)}`);
    printed++;
  } else break;
}
if (!watching) console.log("no land nation formed in the horizon");

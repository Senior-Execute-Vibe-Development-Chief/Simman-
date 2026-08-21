// Register-vs-age probe: how many CITIES does the sim's world hold at each
// DEVELOPMENT age (never the calendar — the two-clock rule)? Compared against
// the real series (Modelski/Chandler/Bairoch, cities >=10k urban core):
//   dawn ~5-15 · early bronze ~30-60 · late bronze ~50-100 · iron ~100-200
//   classical ~400-600 · late-antique dip ~300-500 · high medieval ~800-1200
//   1500CE ~1000-1500 · 1800CE ~2000-3000
//   SIM_TUNE="<live stack>" node probe_cityage.mjs [steps] [W] [seed]
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { techState, ERAS } from "../src/sim/peopleSim/tech.js";
import { POP_SCALE } from "../src/sim/units.js";

const STEPS = +(process.argv[2] || 28000);
const W = +(process.argv[3] || 960), H = W >> 1;
const SEED = +(process.argv[4] || 8817);
const EVERY = 2000;

const world = buildSim({ W, H, seed: SEED });

while (world.step < STEPS) {
  stepPeopleSim(world, EVERY);
  const eraN = new Array(ERAS.length).fill(0);
  let cities = 0, urb10k = 0, lead = 0, popSim = 0;
  for (const s of world.settlements) {
    if (s.mode !== "settled") continue;
    cities++;
    popSim += s.people || 0;
    const u = s._urbanPop != null ? s._urbanPop : s.people || 0;
    if (u * POP_SCALE >= 10000) urb10k++;
    const e = techState(s.knowledge || {}).era;
    eraN[e]++;
    if (e > lead) lead = e;
  }
  const eras = eraN.map((n, e) => (n ? `${ERAS[e].slice(0, 4)}:${n}` : null)).filter(Boolean).join(" ");
  console.log(`step ${String(world.step).padStart(5)}  register=${cities}  cores>=10k=${urb10k}  leading=${ERAS[lead]}  [${eras}]  pop=${(popSim * POP_SCALE / 1e6).toFixed(0)}M`);
}

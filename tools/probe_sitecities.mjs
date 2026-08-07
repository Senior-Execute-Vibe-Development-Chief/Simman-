// IS THE SITE-CITY CHANNEL DELIVERING? — CITY_AT_BIRTH diagnostics.
//
// Under the lever, cities are born from ledger sites whose cells concentrate
// (URBAN_DRIFT + capacity spike + core-disk mint). This prints the channel's
// internals over time: eligible site count, the top site core disks in census
// units against the mint bar, and the cumulative city-arose events — so "the
// drift is too weak" is distinguishable from "no basin ever qualifies" and
// from "the leak-back wins".
//
//   SIM_TUNE="CITY_AT_BIRTH=1" node tools/probe_sitecities.mjs [steps] [seed] [W]
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { labelSiteLedger, labelBasinMass } from "../src/sim/peopleSim/crystallize.js";
import { urbanCoreR, diskSum } from "../src/sim/peopleSim/popField.js";
import { T } from "../src/sim/peopleSim/tuning.js";

const STEPS = parseInt(process.argv[2] || "6000", 10);
const SEED = parseInt(process.argv[3] || "8817", 10);
const W = parseInt(process.argv[4] || "480", 10);

const world = buildSim({ W, H: W / 2, seed: SEED });
console.log(`CITY_AT_BIRTH=${T.CITY_AT_BIRTH | 0}  W=${W} seed=${SEED} steps=${STEPS}`);
console.log(`step | settled | eligSites | top site cores (census, mint bar 10) | cities-arose`);

for (let i = 0; i < STEPS; i++) {
  stepPeopleSim(world);
  if (world.step % 250 !== 0 && i !== STEPS - 1) continue;
  const L = labelSiteLedger(world);
  const bridge = world._onePopScale > 0 ? world._onePopScale : 0.002;
  const coreR = urbanCoreR(world);
  const pf = world.popField;
  const basinBar = (10 / 0.05) / bridge;
  const cores = [];
  let elig = 0;
  for (let k = 0; k < L.sites.length; k++) {
    const st = L.sites[k];
    const mass = labelBasinMass(world, st.x, st.y);
    if (mass >= basinBar) elig++;
    const c = diskSum(pf, world.tw, world.th, st.x, st.y, coreR) * bridge;
    cores.push(c);
  }
  cores.sort((a, b) => b - a);
  const settled = world.settlements.filter((s) => s.mode === "settled").length;
  const arose = (world.events || []).filter((e) => e.type === "settlement.founded" && e.city).length;
  console.log(`${String(world.step).padStart(5)} | ${String(settled).padStart(7)} | ${String(elig).padStart(9)} | ${cores.slice(0, 4).map((c) => c.toFixed(1).padStart(6)).join(" ")} | ${arose}`);
}

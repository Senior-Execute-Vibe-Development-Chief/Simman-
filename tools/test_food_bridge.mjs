/**
 * Food bridge: granary counts toward supply/famine gate; harvest before hierarchy.
 */
import { buildWorld, buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";

const { w, rivers, tCrop, deposits } = buildWorld({ W: 320, H: 160, seed: 8817, preset: "earth_sim" });
const world = buildSim(w, rivers, tCrop, deposits, { tw: 240 });
let stocked = null;
for (let i = 0; i < 12000; i++) {
  stepPeopleSim(world, 1);
  for (const s of world.settlements) {
    if (s.mode !== "settled" || (s.food || 0) < 15) continue;
    if ((s._foodFlow || 0) < 0.001 && (s._foodAvail || 0) > 0.01) {
      stocked = s;
      break;
    }
  }
  if (stocked) break;
}
if (!stocked) {
  console.log("food_bridge: skip (no stocked+flow-off sample in 12k steps)");
  process.exit(0);
}
const core = stocked._coreNeed || 0;
if ((stocked._foodAvail || 0) < core * 0.5 && (stocked._foodFlow || 0) < core * 0.5) {
  console.error("food_bridge FAIL: _foodAvail should reflect granary buffer", stocked._foodAvail, core, stocked.food);
  process.exit(1);
}
console.log("food_bridge OK", { food: stocked.food, flow: stocked._foodFlow, avail: stocked._foodAvail, supply: stocked._foodSupply, core });

// THE FIRST CITY'S FIRST 600 STEPS — every quantity that could explain the
// runaway (v3/v4/v5 all show the first-born at ~1,000 core-census within a
// tick of birth, immune to the founding-take cap and the pile bounds).
//
//   SIM_TUNE="DAWN_LIVE=1,CITY_AT_BIRTH=1" node tools/probe_firstcity.mjs [steps] [seed] [W]
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";

const STEPS = parseInt(process.argv[2] || "12500", 10);
const SEED = parseInt(process.argv[3] || "8817", 10);
const W = parseInt(process.argv[4] || "480", 10);

const world = buildSim({ W, H: W / 2, seed: SEED });
let born = null, bornStep = -1;

console.log(`step | people | _urbanPop | _coreMeasured | tier | food | bridge | catchTiles`);
for (let i = 0; i < STEPS; i++) {
  stepPeopleSim(world);
  if (!born) {
    const s = world.settlements.find((x) => x.mode === "settled");
    if (s) {
      born = s; bornStep = world.step;
      console.log(`BORN step ${bornStep}: "${s.name}" people=${(s.people || 0).toFixed(1)} tier=${s.tier}`);
    }
    continue;
  }
  if (born.mode !== "settled") { console.log(`died at ${world.step}`); break; }
  const w = world.step - bornStep;
  if (w <= 50 || (w <= 600 && world.step % 25 === 0)) {
    let catchTiles = 0;
    const owner = world._territoryOwner;
    if (owner) for (let t = 0; t < world.N; t++) if (owner[t] === born.id) catchTiles++;
    console.log(`${String(world.step).padStart(5)} | ${(born.people || 0).toFixed(1).padStart(7)} | ${(born._urbanPop ?? -1).toFixed(1).padStart(9)} | ${(born._coreMeasured ?? -1).toFixed(1).padStart(9)} | ${born.tier} | ${(born.food || 0).toFixed(0).padStart(5)} | ${(world._onePopScale || 0).toExponential(2)} | ${catchTiles}`);
  }
  if (w > 600) break;
}

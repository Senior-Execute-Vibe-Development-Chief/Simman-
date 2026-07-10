// Quick health read for the reactive-settlement decoupling: realms, coverage,
// population, alive settlements, and how starved the catchment is.
//   node tools/probe_reactive.mjs [steps] [W] [seed]
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";

const STEPS = +(process.argv[2] || 8000);
const W = +(process.argv[3] || 480), H = W >> 1;
const SEED = +(process.argv[4] || 8817);
const world = buildSim({ W, H, seed: SEED });
const kmPerTile = 510e6 / (world.tw * world.th);

for (const ck of [4000, 8000, 12000, 16000].filter(c => c <= STEPS)) {
  while (world.step < ck) stepPeopleSim(world, 1);
  const co = world._countryOwner, terr = world._territoryOwner;
  let landN = 0, coClaimed = 0, terrClaimed = 0;
  for (let ti = 0; ti < world.N; ti++) {
    if (!(world.elev[ti] > 0)) continue; landN++;
    if (co && co[ti] >= 0) coClaimed++;
    if (terr && terr[ti] >= 0) terrClaimed++;
  }
  const realms = new Set();
  let pop = 0, alive = 0, terrTiles = 0, stateless = 0, tiny = 0;
  for (const s of world.settlements) {
    if (s.mode !== "settled") continue;
    alive++; pop += s.people; terrTiles += s._terrTiles || 0;
    if (s.countryId >= 0) realms.add(s.countryId); else stateless++;
    if ((s._terrTiles || 0) < 2) tiny++;   // near-starved catchment
  }
  console.log(`step ${ck}: realms=${realms.size} co=${(100*coClaimed/landN).toFixed(1)}% terr=${(100*terrClaimed/landN).toFixed(1)}% | pop=${Math.round(pop/1000)}k settlements=${alive} stateless=${stateless} tinyCatch=${tiny} meanCatch=${(terrTiles/Math.max(1,alive)).toFixed(1)}`);
}

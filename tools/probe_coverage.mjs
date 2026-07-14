// Is TILE_POLITY coverage target-bound (capacity too small) or rate-bound (growth
// too slow)? Print, for the top realms, capacity vs the FIELD_SPAN·capacity target
// vs tiles actually held — and the populated-land gap (dense popField tiles vs
// claimed). node tools/probe_coverage.mjs [steps] [W] [seed]
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { T } from "../src/sim/peopleSim/tuning.js";
import { resScaleFor } from "../src/sim/peopleSim/countryTerritory.js";

const STEPS = +(process.argv[2] || 8000);
const W = +(process.argv[3] || 480), H = W >> 1;
const SEED = +(process.argv[4] || 8817);
const world = buildSim({ W, H, seed: SEED });
while (world.step < STEPS) stepPeopleSim(world, 1);

const co = world._countryOwner, pf = world.popField, elev = world.elev;
const FIELD_SPAN = T.FIELD_SPAN || 6;
const r2 = resScaleFor(world.tw) ** 2;

const held = new Map();
let landN = 0, claimed = 0, popTiles = 0, popClaimed = 0;
let pfMax = 0; for (let i = 0; i < world.N; i++) if (pf && pf[i] > pfMax) pfMax = pf[i];
const POP_THR = pfMax * 0.05;
for (let ti = 0; ti < world.N; ti++) {
  if (!(elev[ti] > 0)) continue; landN++;
  const dense = pf && pf[ti] > POP_THR;
  if (dense) popTiles++;
  if (co[ti] >= 0) { claimed++; held.set(co[ti], (held.get(co[ti]) || 0) + 1); if (dense) popClaimed++; }
}
console.log(`land=${landN} claimed=${(100*claimed/landN).toFixed(1)}% | POPULATED tiles=${popTiles} (${(100*popTiles/landN).toFixed(1)}% of land) of which CLAIMED=${popClaimed} (${(100*popClaimed/Math.max(1,popTiles)).toFixed(1)}%)`);
console.log(`FIELD_SPAN=${FIELD_SPAN} r2=${r2}  (target = FIELD_SPAN*capacity*r2)`);

const rows = [...(world.countries?.values() || [])]
  .filter(c => c.capital && (held.get(c.id) || 0) > 0)
  .map(c => ({ id: c.id, cap: c._capacity || 0, held: held.get(c.id) || 0, mem: c.members?.length || 0 }))
  .sort((a, b) => b.held - a.held).slice(0, 12);
console.log("  realm     capacity   target   held   mem   held/target");
for (const r of rows) {
  const target = Math.round(FIELD_SPAN * r.cap * r2);
  console.log(`  #${String(r.id).padEnd(6)} ${r.cap.toFixed(2).padStart(8)} ${String(target).padStart(8)} ${String(r.held).padStart(6)} ${String(r.mem).padStart(5)}   ${(r.held/Math.max(1,target)).toFixed(2)}`);
}

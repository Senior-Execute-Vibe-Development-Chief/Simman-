// Field-grounded power probe (T.POW_FIELD): how does national power redistribute
// when it reads GOVERNED PEOPLE (popField over held tiles × the court's mil·org)
// instead of Σ settlementPower over the member roster? Steps a world, then compares
// world._countryPow under the lever against the entity-summed measure recomputed
// on the same frozen world.
//   node tools/probe_powfield.mjs [seed] [steps] [W] [H]
// Reference (320×160 seed 8817, 3000 steps): all 18 realms shift >1%; the new #1
// is a realm governing a big settled region with few towns (3.8× its roster power);
// dense city-cluster realms compress to ~0.7×. Median is anchored by construction.
// War shape at the validate grid (15k, 3 seeds): hard gates 3/3, wars/1k and
// deadliness in-band, tech~cradle-distance cleared on 3/3 seeds (was warn on 2),
// fallen-realm median lifespan up (power no longer jumps when a census line moves).
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { updateAlliances } from "../src/sim/peopleSim/conquest.js";
import { T } from "../src/sim/peopleSim/tuning.js";

const seed = parseInt(process.argv[2] || "8817", 10);
const STEPS = parseInt(process.argv[3] || "9000", 10);
const W = parseInt(process.argv[4] || "320", 10), H = parseInt(process.argv[5] || "160", 10);

const world = buildSim({ W, H, seed });
stepPeopleSim(world, STEPS);
updateAlliances(world);
const on = new Map(world._countryPow);
T.POW_FIELD = 0;
updateAlliances(world);
const off = new Map(world._countryPow);

let changed = 0;
const rows = [];
for (const [id, v] of on) {
  const o = off.get(id) || 0;
  if (Math.abs(v - o) / Math.max(1, o) > 0.01) changed++;
  rows.push([id, v, o]);
}
rows.sort((a, b) => b[1] - a[1]);
console.log(`t=${STEPS}: realms=${on.size}, shifted>1%=${changed}`);
console.log("top by FIELD power (field / entity / ratio):");
for (const [id, v, o] of rows.slice(0, 8)) {
  const c = world.countries && world.countries.get(id);
  console.log(`  ${(c && c.capital && c.capital.name) || id}: ${v.toFixed(0)} / ${o.toFixed(0)} = ${(v / Math.max(1, o)).toFixed(2)}`);
}
const offTop = [...off.entries()].sort((a, b) => b[1] - a[1])[0];
console.log(`entity-measure #1: ${offTop && offTop[0]} — same as field #1? ${offTop && rows[0] && offTop[0] === rows[0][0]}`);

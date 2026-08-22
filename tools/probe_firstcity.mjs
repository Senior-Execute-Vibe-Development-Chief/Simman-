// THE FIRST CITY'S FIRST ~2000 STEPS — plus the world it is born into.
// Extended for the LAND_KNOW whale-birth report (owner 2026-08-20: "the very
// first city starts with 350k people in it, starving; nations spawn with an
// instant vast size"): prehistory now runs ~6k steps longer before any entity
// exists, so the first lenses open onto a fully-peopled countryside. This
// prints, per sample: the WORLD population (field × bridge, real people — the
// 3200-BCE anchor is ~35M), the newborn's catchment census / urban read /
// core-disk field / tier / food ramp, its catchment's real area, and the
// realm register (count + top areas) so "Rome-sized at birth" is measurable.
//   SIM_TUNE="DAWN_LIVE=1,STATE_RECORDS=1,LAND_KNOW=1" node tools/probe_firstcity.mjs [steps] [seed] [W]
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { diskSum, urbanCoreR } from "../src/sim/peopleSim/popField.js";
import { POP_SCALE } from "../src/sim/units.js";

const STEPS = parseInt(process.argv[2] || "17000", 10);
const SEED = parseInt(process.argv[3] || "8817", 10);
const W = parseInt(process.argv[4] || "960", 10);

const world = buildSim({ W, H: W / 2, seed: SEED });
let born = null, bornStep = -1;
let landTiles = 0; for (let i = 0; i < world.N; i++) if (world.elev[i] > 0) landTiles++;
const km2PerTile = (510e6 * 0.29) / landTiles;
const worldPeople = () => {
  const pf = world.popField; if (!pf) return 0;
  let f = 0; for (let i = 0; i < world.N; i++) f += pf[i];
  return f * (world._onePopScale || 0) * POP_SCALE;
};
const realmRow = () => {
  if (!world.countries || !world.countries.size) return "realms 0";
  const held = new Map();
  const co = world._countryOwner;
  if (co) for (let i = 0; i < world.N; i++) if (co[i] >= 0) held.set(co[i], (held.get(co[i]) || 0) + 1);
  const top = [...held.values()].sort((a, b) => b - a).slice(0, 3).map((t) => `${(t * km2PerTile / 1e6).toFixed(2)}Mkm2`);
  return `realms ${world.countries.size} top[${top.join(" ")}]`;
};
const MN = (v) => (v / 1e6).toFixed(2) + "M";

console.log(`tw=${world.tw} seed ${SEED} — world-pop arc, then the first city's window`);
for (let i = 0; i < STEPS; i++) {
  stepPeopleSim(world);
  if (world.step % 2500 === 0 && !born) {
    console.log(`  step ${String(world.step).padStart(6)}  worldPop ${MN(worldPeople())}  (pre-entity)`);
  }
  if (!born) {
    const s = world.settlements.find((x) => x.mode === "settled");
    if (s) {
      born = s; bornStep = world.step;
      const coreR = urbanCoreR(world);
      const coreF = diskSum(world.popField, world.tw, world.th, s.pos.x | 0, s.pos.y | 0, coreR);
      console.log(`BORN step ${bornStep}: "${s.name}" at (${s.pos.x | 0},${s.pos.y | 0})`);
      console.log(`  worldPop ${MN(worldPeople())}   (3200-BCE anchor ~35M)`);
      console.log(`  people(catchment)=${(s.people || 0).toFixed(0)}su=${MN((s.people || 0) * POP_SCALE)}  coreDiskField=${(coreF * (world._onePopScale || 0)).toFixed(0)}su  tier=${s.tier}`);
      console.log(`step | people(M) | urban(k) | coreMeas(k) | tier | food | supply | demand | catchKm2 | politics`);
    }
    continue;
  }
  if (born.mode !== "settled") { console.log(`died at ${world.step}`); break; }
  const w = world.step - bornStep;
  if (w % 100 === 0 || w <= 5) {
    let catchTiles = 0;
    const owner = world._territoryOwner;
    if (owner) for (let t = 0; t < world.N; t++) if (owner[t] === born.id) catchTiles++;
    console.log(`${String(world.step).padStart(6)} | ${((born.people || 0) * POP_SCALE / 1e6).toFixed(2).padStart(8)} | ${((born._urbanPop || 0) * POP_SCALE / 1e3).toFixed(0).padStart(7)} | ${((born._coreMeasured ?? -1) * POP_SCALE / 1e3).toFixed(0).padStart(8)} | ${born.tier} | ${(born.food || 0).toFixed(0).padStart(5)} | ${(born._foodSupply || 0).toFixed(1).padStart(6)} | ${(born._foodDemand || 0).toFixed(1).padStart(6)} | ${(catchTiles * km2PerTile / 1e3).toFixed(0).padStart(7)}k | ${realmRow()}`);
  }
  if (w > 2200) break;
}
console.log(`END step ${world.step}  worldPop ${MN(worldPeople())}  ${realmRow()}`);

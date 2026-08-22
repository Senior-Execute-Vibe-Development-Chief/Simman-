// The gradient's TRUE win metric: when does each world region get its FIRST
// state, and does the cradle→periphery lag stretch under a gate? Counts at one
// checkpoint can hide a real timing shift (a delayed periphery shows the same
// 15k census); founding steps cannot.
//   SIM_TUNE="DAWN_LIVE=1[,TILLAGE=1]" node tools/probe_firststate.mjs [steps] [W] [seed]
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { T } from "../src/sim/peopleSim/tuning.js";

const STEPS = +(process.argv[2] || 18000);
const W = +(process.argv[3] || 960), H = W >> 1;
const SEED = +(process.argv[4] || 8817);
const world = buildSim({ W, H, seed: SEED });

const seen = new Map();   // polityId → {step, lat, lon}
function sweep(step) {
  for (const [id, c] of world.countries || []) {
    if (seen.has(id) || !c.capital) continue;
    const x = c.capital.pos.x | 0, y = c.capital.pos.y | 0;
    seen.set(id, { step, lat: 90 - (y / world.th) * 180, lon: (x / world.tw) * 360 - 180 });
  }
}
for (let s = 1; s <= STEPS; s++) { stepPeopleSim(world, 1); if (s % 100 === 0) sweep(s); }

const REGIONS = [
  ["CradleBelt", r => r.lat >= 15 && r.lat <= 42 && r.lon >= 25 && r.lon <= 75],
  ["China", r => r.lat >= 20 && r.lat <= 45 && r.lon >= 100 && r.lon <= 125],
  ["MedEurope", r => r.lat > 36 && r.lat <= 46 && r.lon >= -10 && r.lon < 25],
  ["NorthEurope", r => r.lat > 46 && r.lon >= -12 && r.lon < 45],
  ["SubSaharan", r => r.lat < 15 && r.lat > -35 && r.lon >= -20 && r.lon <= 52],
  ["India", r => r.lat >= 5 && r.lat < 30 && r.lon > 70 && r.lon <= 90],
  ["SEAsia", r => r.lat >= -10 && r.lat < 25 && r.lon > 90 && r.lon <= 130],
  ["Steppe", r => r.lat >= 40 && r.lat <= 55 && r.lon >= 45 && r.lon <= 110],
  ["Americas", r => r.lon < -30],
];
const firsts = new Map(), counts = new Map();
for (const [, rec] of seen) {
  for (const [nm, fn] of REGIONS) {
    if (!fn(rec)) continue;
    counts.set(nm, (counts.get(nm) || 0) + 1);
    if (!firsts.has(nm) || rec.step < firsts.get(nm)) firsts.set(nm, rec.step);
    break;
  }
}
console.log(`[firststate] TILLAGE=${T.TILLAGE} seed=${SEED} tw=${world.tw} steps=${STEPS} politiesSeen=${seen.size}`);
const base = firsts.get("CradleBelt") || 0;
for (const [nm] of REGIONS) console.log(`  ${nm.padEnd(12)} first=${String(firsts.get(nm) ?? "—").padStart(6)}  lagVsCradle=${firsts.has(nm) ? String(firsts.get(nm) - base).padStart(6) : "     —"}  n=${counts.get(nm) || 0}`);

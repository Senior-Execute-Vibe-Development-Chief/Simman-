// STATE_WORKS instrument: does an outlier's REACH separate from the era's, and
// does the stock fall again when the fisc fails? Per checkpoint: the reach
// spread across live realms (max/median c.range — the quantity that was
// era-uniform by construction before this wave), the works stock of the top
// realms, and the head of the size distribution. Also tracks per-realm works
// TRAJECTORIES for the boom-bust read: how many realms have ever built a
// stock, and how many have since lost ≥half of their peak (the dilapidation
// arc — an empire whose reach collapsed).
//   SIM_TUNE="DAWN_LIVE=1" node tools/probe_works.mjs [steps] [W] [seed] [every]
//   A/B: SIM_TUNE="DAWN_LIVE=1,STATE_WORKS=0" ...
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { T } from "../src/sim/peopleSim/tuning.js";

const STEPS = +(process.argv[2] || 30000);
const W = +(process.argv[3] || 960), H = W >> 1;
const SEED = +(process.argv[4] || 8817);
const EVERY = +(process.argv[5] || 3000);

const world = buildSim({ W, H, seed: SEED });
let landN = 0; for (let i = 0; i < world.N; i++) if (world.elev[i] > 0) landN++;
const km2PerTile = (510e6 * 0.29) / landN;
console.log(`[works] W=${W} (tw=${world.tw}) seed=${SEED} steps=${STEPS} STATE_WORKS=${T.STATE_WORKS} CEIL=${T.WORKS_CEIL}`);

const peak = new Map();      // countryId → highest works ever held
let everBuilt = 0;

function report(step) {
  const co = world._countryOwner, elev = world.elev, N = world.N;
  const tiles = new Map(); let claimed = 0;
  for (let i = 0; i < N; i++) { if (!(elev[i] > 0)) continue; const c = co ? co[i] : -1; if (c >= 0) { claimed++; tiles.set(c, (tiles.get(c) || 0) + 1); } }
  const areas = [...tiles.values()].sort((a, b) => b - a);
  const tot = areas.reduce((a, b) => a + b, 0) || 1;

  const ranges = [], works = [];
  let lost = 0;
  if (world.countries) for (const [id, c] of world.countries) {
    if (!c.capital) continue;
    ranges.push(c.range || 0);
    const g = world.polities && world.polities.get(id);
    const w = (g && g._works) || 0;
    works.push(w);
    const pk = Math.max(peak.get(id) || 0, w);
    if (!peak.has(id) && w > 0.05) everBuilt++;
    peak.set(id, pk);
    if (pk > 0.1 && w < pk * 0.5) lost++;      // dilapidation: reach collapsed to under half its peak
  }
  ranges.sort((a, b) => a - b); works.sort((a, b) => b - a);
  const medR = ranges.length ? ranges[ranges.length >> 1] : 0;
  const maxR = ranges.length ? ranges[ranges.length - 1] : 0;
  console.log(`t=${step} realms=${areas.length} reachMax/med=${medR > 0 ? (maxR / medR).toFixed(2) : "n/a"} ` +
    `worksTop=${works.slice(0, 3).map(w => w.toFixed(2)).join(",")} everBuilt=${everBuilt} dilapidated=${lost} ` +
    `top1=${(areas[0] * 100 / tot).toFixed(1)}% claimed=${(claimed * 100 / landN).toFixed(1)}% ` +
    `top3km2=${areas.slice(0, 3).map(a => Math.round(a * km2PerTile / 1000)).join("k,")}k`);
}

for (let s = 1; s <= STEPS; s++) {
  stepPeopleSim(world, 1);
  if (s % EVERY === 0) report(s);
}

// WHERE are the early settlements? — the "inaccurate locations" complaint, on a map.
//
// probe_siting refuted the blind-scatter theory: early sites sit on fertility
// ~0.86 against an all-land median of 0.033, and 85% of them are on rivers. The
// siting SCORE is working. What it confirmed is the WAVE — 35% of the settlements
// alive at step 12000 already existed at step 500, 56% by step 2000.
//
// So if the locations still read wrong, the error is not "bad land" but WHERE ON
// EARTH, and when. This prints the actual geography: every settlement's latitude
// and longitude at each checkpoint, bucketed into coarse real-world regions, so
// "the whole planet lights up at once" is distinguishable from "the cradles
// settle first and it spreads".
//
// Longitude/latitude follow the generator's equirectangular convention: x=0 is
// -180deg, y=0 is +90deg. Region boxes are deliberately crude — they only have to
// separate continents, not draw borders.
//
//   node tools/probe_wheretowns.mjs [steps] [seed] [W]
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";

const STEPS = parseInt(process.argv[2] || "6000", 10);
const SEED = parseInt(process.argv[3] || "8817", 10);
const W = parseInt(process.argv[4] || "480", 10);

const world = buildSim({ W, H: W / 2, seed: SEED });
const { tw, th } = world;

const lonOf = (x) => (x / tw) * 360 - 180;
const latOf = (y) => 90 - (y / th) * 180;

// Crude continental boxes: [name, lonMin, lonMax, latMin, latMax]
const REGIONS = [
  ["N America",   -170, -52,   15,  75],
  ["S America",    -82, -34,  -56,  15],
  ["Europe",       -10,  40,   36,  71],
  ["N Africa/Sahara", -17, 35,  18,  36],
  ["Sahel/W Africa",  -18, 25,   4,  18],
  ["C/S Africa",   -18,  52,  -35,   4],
  ["Nile/Levant",   25,  40,   18,  37],
  ["Mesopotamia/Arabia", 35, 60, 12, 37],
  ["C Asia/Steppe", 45,  95,   37,  60],
  ["India",         66,  92,    6,  35],
  ["China/E Asia",  95, 145,   20,  53],
  ["SE Asia",       92, 155,  -11,  20],
  ["Siberia/N Asia", 60, 180,  53,  78],
  ["Australia",    112, 154,  -44, -10],
];
function regionOf(lon, lat) {
  for (const [name, a, b, c, d] of REGIONS) if (lon >= a && lon <= b && lat >= c && lat <= d) return name;
  return "elsewhere";
}

function report() {
  const setts = world.settlements.filter((s) => s.mode === "settled");
  const byRegion = new Map();
  for (const s of setts) {
    const lon = lonOf(s.pos.x), lat = latOf(s.pos.y);
    const r = regionOf(lon, lat);
    if (!byRegion.has(r)) byRegion.set(r, []);
    byRegion.get(r).push({ s, lon, lat });
  }
  console.log(`\n=== step ${world.step}   settled ${setts.length}   regions occupied ${byRegion.size} ===`);
  const rows = [...byRegion.entries()].sort((a, b) => b[1].length - a[1].length);
  for (const [name, list] of rows) {
    const eldest = list.slice().sort((a, b) => (a.s.foundedStep | 0) - (b.s.foundedStep | 0))[0];
    console.log(`  ${name.padEnd(22)} ${String(list.length).padStart(3)}   first founded at step ${String(eldest.s.foundedStep | 0).padStart(5)}` +
      `   e.g. ${eldest.s.name} (${eldest.lat.toFixed(0)}N ${eldest.lon.toFixed(0)}E)`);
  }
}

console.log(`# probe_wheretowns  W=${W} seed=${SEED}`);
console.log(`# Real Earth at ~4000 BC: towns existed in Mesopotamia, the Nile, the Indus and the`);
console.log(`# Yellow River. Nowhere else. Anything broadly settled at the dawn is an anachronism.`);
const CHECKS = [200, 500, 1000, 2000, 6000, 12000].filter((c) => c <= STEPS);
for (let i = 0; i < STEPS; i++) {
  stepPeopleSim(world);
  if (CHECKS.includes(world.step)) report();
}

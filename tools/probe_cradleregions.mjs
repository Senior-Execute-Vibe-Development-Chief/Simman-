// WHY IS THE FERTILE CRESCENT WEAK? — owner question, 2026-08-06. Compares the
// real cradle regions on the Earth preset by the quantities that actually drive
// the sim: terrain (fert/moist/river), the technique field (devField — where
// farming has ARRIVED), the people-on-land field, and the political outcome
// (settlements, nations, realms) inside each region's box. Prints a terrain
// table once, then the state of every region at each checkpoint, so "the
// Crescent starts late/thin" can be attributed to ground, technique, people or
// politics rather than guessed at.
//
//   SIM_TUNE="DAWN_LIVE=1" node tools/probe_cradleregions.mjs [steps] [seed] [W]
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";

const STEPS = parseInt(process.argv[2] || "25000", 10);
const SEED = parseInt(process.argv[3] || "8817", 10);
const W = parseInt(process.argv[4] || "960", 10);

const world = buildSim({ W, H: W / 2, seed: SEED });
const tw = world.tw, th = world.th;

// lon/lat boxes for the historical cradles (west, east, south, north)
const REGIONS = [
  ["Fertile Crescent", 33, 50, 28, 38],
  ["  ↳ N rain-fed arc", 35, 44, 33, 38],
  ["  ↳ S alluvium", 43, 49, 29, 34],
  ["Nile", 29, 34, 22, 32],
  ["Indus", 66, 78, 22, 34],
  ["Yellow R.", 105, 120, 32, 41],
  ["Yangtze", 105, 122, 26, 33],
  ["Mesoamerica", -105, -88, 14, 22],
];
const boxOf = (w, e, s, n) => {
  const tiles = [];
  for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
    const lon = x / tw * 360 - 180, lat = 90 - y / th * 180;
    if (lon < w || lon > e || lat < s || lat > n) continue;
    const ti = y * tw + x;
    if (world.elev[ti] > 0) tiles.push(ti);
  }
  return tiles;
};
const boxes = REGIONS.map(([name, ...b]) => ({ name, tiles: boxOf(...b) }));

const mean = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
console.log(`Earth preset · seed ${SEED} · tw=${tw}\n`);
console.log("region             | land |  fert       | moist | river≥1 | fert>0.5");
for (const b of boxes) {
  const f = b.tiles.map(t => world.fert[t] || 0);
  const m = b.tiles.map(t => world.moist[t] || 0);
  const riv = b.tiles.filter(t => (world.riverMag ? world.riverMag[t] : 0) >= 1).length;
  const good = f.filter(v => v > 0.5).length;
  console.log(`${b.name.padEnd(18)} | ${String(b.tiles.length).padStart(4)} | mean ${mean(f).toFixed(2)}  | ${mean(m).toFixed(2)}  | ${String(riv).padStart(7)} | ${String(good).padStart(8)}`);
}

const CHECK = [4000, 8000, 12000, 16000, 20000, 25000];
console.log(`\nstep  | region             | devF mean | devF>0.45 | people | setts | nations | realms`);
for (let i = 0; i < STEPS; i++) {
  stepPeopleSim(world);
  if (!CHECK.includes(world.step)) continue;
  for (const b of boxes) {
    const dev = world.devField ? b.tiles.map(t => world.devField[t] || 0) : [0];
    const farm = world.devField ? b.tiles.filter(t => (world.devField[t] || 0) >= 0.45).length : 0;
    let ppl = 0;
    if (world.popField) for (const t of b.tiles) ppl += world.popField[t];
    const inBox = new Set(b.tiles);
    let setts = 0;
    for (const s of world.settlements) {
      if (s.mode !== "settled") continue;
      const ti = (s.pos.y | 0) * tw + (((s.pos.x | 0) % tw) + tw) % tw;
      if (inBox.has(ti)) setts++;
    }
    let nations = 0;
    if (world._landSeats) for (const [, r] of world._landSeats) if (inBox.has(r.ti)) nations++;
    const realms = new Set();
    if (world._countryOwner) for (const t of b.tiles) { const c = world._countryOwner[t]; if (c >= 0) realms.add(c); }
    const cen = world._onePopScale > 0 ? ppl * world._onePopScale : 0;
    console.log(`${String(world.step).padStart(5)} | ${b.name.padEnd(18)} | ${mean(dev).toFixed(3).padStart(9)} | ${String(farm).padStart(9)} | ${(cen * 1000 / 1e6).toFixed(1).padStart(5)}M | ${String(setts).padStart(5)} | ${String(nations).padStart(7)} | ${String(realms.size).padStart(6)}`);
  }
  console.log("");
}

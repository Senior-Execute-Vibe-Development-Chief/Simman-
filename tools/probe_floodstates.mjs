// Attribution probe for the secondary-state gradient (docs/atlas-gap cause II):
// WHERE do the too-early states seat, and is the arid-river prime-cropland
// floor (pipeline.js tFlood → tCrop ≥ 0.92) what feeds them? Reports:
//   1. world census: tFlood land tiles by river-magnitude class, with mean tCrop
//   2. per-polity seats at the checkpoint: lat/lon, aridity, on-flood?, river class
//   SIM_TUNE="DAWN_LIVE=1" node tools/probe_floodstates.mjs [steps] [W] [seed]
import { buildWorld } from "./_harness.mjs";
import { initPeopleSim, stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { RIVER_STREAM } from "../src/sim/riverGen.js";

const STEPS = +(process.argv[2] || 15000);
const W = +(process.argv[3] || 960), H = W >> 1;
const SEED = +(process.argv[4] || 8817);

const { w, ter } = (() => { const r = buildWorld({ W, H, seed: SEED }); return { w: r.w, ter: r.ter }; })();
const { tFlood, tCrop, tMoist, rivers, tw: ptw, th: pth } = ter;
const rmArr = rivers.riverMag;

// river class bars: read from riverGen conventions (STREAM export; TRIB/MAJOR/GREAT
// inferred from the pipeline's riverRadius comment order). Print raw magnitudes too.
const classOf = (rm) => rm >= 3 ? "GREAT/MAJOR" : rm >= 1.0 ? "TRIB" : rm >= RIVER_STREAM ? "STREAM" : "trace";

// 1. census of flood-stamped land
const byClass = new Map();
for (let i = 0; i < ptw * pth; i++) {
  if (!tFlood[i]) continue;
  const c = classOf(rmArr[i] || 0);
  let e = byClass.get(c); if (!e) byClass.set(c, e = { n: 0, crop: 0 });
  e.n++; e.crop += tCrop[i];
}
console.log("[census] tFlood land tiles by river class (pixel grid):");
for (const [c, e] of byClass) console.log(`  ${c.padEnd(12)} n=${e.n}  meanTCrop=${(e.crop / e.n).toFixed(2)}`);

// 2. run the sim and report seats
const world = initPeopleSim(w, { seed: w.seed, tCrop: ter.tCrop, tFlood: ter.tFlood, tileRes: 1, deposits: ter.deposits, tAncestry: ter.tAncestry, terTw: ter.tw, terTh: ter.th, ancestryCount: ter.ancestryCount, ancHue: ter.ancHue, tArrival: ter.tArrival });
for (let s = 1; s <= STEPS; s++) stepPeopleSim(world, 1);

console.log(`[seats] step ${STEPS} — every polity seat:`);
const stw = world.tw;
for (const [id, c] of world.countries || []) {
  const cap = c.capital; if (!cap) continue;
  const sx = cap.pos.x | 0, sy = cap.pos.y | 0;
  const px = Math.min(ptw - 1, sx * (ptw / stw) | 0), py = Math.min(pth - 1, sy * (ptw / stw) | 0);
  const pi = py * ptw + px;
  const lon = (px / ptw) * 360 - 180, lat = 90 - (py / pth) * 180;
  // min moisture in a 1-pixel ring = the aridity of the surrounding country
  let arid = tMoist[pi];
  for (let dy = -2; dy <= 2; dy += 2) for (let dx = -2; dx <= 2; dx += 2) {
    const yy = py + dy; if (yy < 0 || yy >= pth) continue;
    const xx = ((px + dx) % ptw + ptw) % ptw;
    if (tMoist[yy * ptw + xx] < arid) arid = tMoist[yy * ptw + xx];
  }
  console.log(`  #${String(id).padStart(4)} ${String(c.members.length).padStart(2)}mem  lat=${lat.toFixed(0).padStart(4)} lon=${lon.toFixed(0).padStart(5)}  flood=${tFlood[pi] ? 1 : 0} rm=${(rmArr[pi] || 0).toFixed(2)} arid=${arid.toFixed(2)} tCrop=${tCrop[pi].toFixed(2)}`);
}

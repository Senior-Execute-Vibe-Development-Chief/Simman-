// Inspect the Tigris-Euphrates / Mesopotamia hydrology after the snowmelt fix.
//   node tools/probe_tigris.mjs [W] [H]
import { generateWorld } from "../src/sim/worldgen.js";
import { computeRivers, RIVER_NAMES } from "../src/sim/riverGen.js";

const W = parseInt(process.argv[2] || "960", 10);
const H = parseInt(process.argv[3] || "480", 10);
const w = generateWorld(W, H, 8817, "earth_sim", 0.78, true, false, {});
const r = computeRivers(W, H, w.elevation, w.moisture, w.temperature);

function box(name, lat0, lat1, lon0, lon1) {
  const y0 = Math.round((90 - lat1) / 180 * (H - 1));
  const y1 = Math.round((90 - lat0) / 180 * (H - 1));
  const xx = lon => { let x = Math.round(((lon + 180) / 360) * W) % W; if (x < 0) x += W; return x; };
  const x0 = xx(lon0), x1 = xx(lon1);
  let maxMag = 0, maxFlow = 0, nRiver = 0, nGE2 = 0, sumFlood = 0;
  const counts = [0, 0, 0, 0, 0];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const i = y * W + x;
    const mag = r.riverMag[i];
    counts[mag]++;
    if (mag >= 1) nRiver++;
    if (mag >= 2) nGE2++;
    if (r.flowAccum && r.flowAccum[i] > maxFlow) maxFlow = r.flowAccum[i];
    if (mag > maxMag) maxMag = mag;
  }
  console.log(`${name.padEnd(22)} maxMag=${maxMag}(${RIVER_NAMES[maxMag]||''})  riverTiles≥1=${nRiver} ≥2=${nGE2}  maxFlow=${maxFlow.toFixed(0)}  byMag=${counts.join('/')}`);
}

console.log(`[${W}x${H}] flowAccum present: ${!!r.flowAccum}`);
box('Mesopotamia',      30, 37, 38, 49);
box('Tigris-Euph src',  37, 41, 37, 44);
box('Nile valley',      24, 31, 30, 34);
box('Indus',            24, 34, 66, 74);
box('Ganges',           24, 28, 77, 88);
box('Amazon',           -6,  2, -70, -50);
box('Mississippi',      30, 42, -95, -89);
box('Caspian(should be terminal/empty)', 38, 46, 48, 54);

// Floodplain farmland fertility for the arid cradles, at varying resolution.
// Is the Nile/Mesopotamia's near-zero netFert a resolution artifact?
//   node tools/probe_floodfert.mjs [W]
import { buildWorld } from "../src/sim/pipeline.js";
const W = parseInt(process.argv[2] || "480", 10), H = W >> 1;
const { ter } = buildWorld({ W, H, seed: 8817 });
const { tw, th, tFert, tCrop, tFlood, rivers } = ter;
const xx = lon => { let x = Math.round(((lon + 180) / 360) * tw) % tw; if (x < 0) x += tw; return x; };
const yy = lat => Math.round((90 - lat) / 180 * (th - 1));

function region(name, lat0, lat1, lon0, lon1) {
  const y0 = yy(lat1), y1 = yy(lat0), x0 = xx(lon0), x1 = xx(lon1);
  let fertSum = 0, cropSum = 0, floodN = 0, riverN = 0, n = 0, fertMax = 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const i = y * tw + x; n++;
    fertSum += tFert[i]; cropSum += tCrop[i];
    if (tFlood[i]) floodN++;
    if (rivers.riverMag[i] >= 1) riverN++;
    if (tFert[i] > fertMax) fertMax = tFert[i];
  }
  console.log(`${name.padEnd(14)} tiles=${String(n).padStart(4)}  fertSum=${fertSum.toFixed(1).padStart(7)}  fertMean=${(fertSum/n).toFixed(3)}  fertMax=${fertMax.toFixed(2)}  cropMean=${(cropSum/n).toFixed(3)}  flood=${floodN}  river≥1=${riverN}`);
}
console.log(`[${W}x${H}]  (fert = farmland fertility that feeds netFert/land food)`);
region('Nile valley', 24, 31, 30, 34);
region('Nile delta',  29, 32, 29, 33);
region('Mesopotamia', 30, 37, 38, 49);
region('Indus',       24, 32, 66, 74);
region('Ganges',      24, 28, 77, 88);
region('N China',     33, 40,108,118);

// Calibrate the cold-mountain snowmelt term.
//   node tools/probe_snowmelt.mjs [W] [H]
// Samples elev/temp/moisture at headwater regions and prints OLD vs NEW snowmelt
// across a sweep of SNOWMELT_K, so we can preserve the Himalaya (~0.51) while
// reviving the cold mid-latitude massifs (Anatolia / Zagros) that feed Mesopotamia.
import { generateWorld } from "../src/sim/worldgen.js";

const W = parseInt(process.argv[2] || "480", 10);
const H = parseInt(process.argv[3] || "240", 10);
const toC = t => ((t - 0.60) * 100).toFixed(0);

// headwater massifs (should melt) + control lowlands/deserts (should NOT)
const PLACES = [
  ['Himalaya (PRESERVE ~.51)', 30,  84, 'melt'],
  ['Anatolia highlands',       39,  35, 'melt'],
  ['Zagros (Iran/Iraq)',       34,  47, 'melt'],
  ['E Anatolia (TigEuph src)', 38,  41, 'melt'],
  ['Caucasus',                 43,  44, 'melt'],
  ['Rockies (Colorado)',       39,-106, 'melt'],
  ['Alps',                     46,   9, 'melt'],
  ['Pamir (Amu Darya)',        38,  73, 'melt'],
  ['Ethiopian highlands',      10,  39, 'tropmelt?'],
  ['Andes (tropical)',         -13, -72, 'tropmelt?'],
  ['—Mesopotamia lowland',     33,  44, 'NO'],
  ['—Sahara',                  23,   5, 'NO'],
  ['—Amazon lowland',          -3, -62, 'NO'],
  ['—Congo',                    0,  20, 'NO'],
  ['—Ganges plain',            26,  82, 'NO'],
];

const w = generateWorld(W, H, 8817, "earth_sim", 0.78, true, false, {});
function sample(lat, lon) {
  const y = Math.round((90 - lat) / 180 * (H - 1));
  let x = Math.round(((lon + 180) / 360) * W) % W; if (x < 0) x += W;
  const i = y * W + x;
  return { i, y, e: w.elevation[i], m: w.moisture[i], t: w.temperature[i] };
}

const oldMelt = e => Math.max(0, e - 0.15) * 1.6;
const SWING = parseFloat(process.env.SWING || "0.38");
const RFLOOR = parseFloat(process.env.RFLOOR || "0.04");
function newMelt(e, m, t, y, K) {
  const aLat = Math.abs((0.5 - y / H) * 180);
  const winterTemp = t - (aLat / 90) * SWING;
  const snowpack = Math.max(0, Math.min(1, (0.60 - winterTemp) / 0.15));
  const glacier = Math.max(0, Math.min(1, (e - 0.32) / 0.20));
  const snowFrac = Math.max(snowpack, glacier);
  const relief = Math.max(0, e - RFLOOR);
  return snowFrac * relief * K * (0.35 + 0.65 * m);
}

const Ks = [2.5, 3.0, 3.5, 4.0, 4.5];
let hdr = 'place                         lat   elev   t°C  moist  OLD ';
for (const K of Ks) hdr += ` K=${K}`;
console.log(hdr);
console.log('─'.repeat(hdr.length + 4));
for (const [name, lat, lon, tag] of PLACES) {
  const s = sample(lat, lon);
  if (s.e <= 0) { console.log(`${name.padEnd(28)} ${String(lat).padStart(4)}  OCEAN`); continue; }
  let row = `${name.padEnd(28)} ${String(lat).padStart(4)}  ${s.e.toFixed(3)}  ${toC(s.t).padStart(3)}  ${s.m.toFixed(2)}  ${oldMelt(s.e).toFixed(2)}`;
  for (const K of Ks) row += `  ${newMelt(s.e, s.m, s.t, s.y, K).toFixed(2)}`;
  console.log(row + `   ${tag}`);
}

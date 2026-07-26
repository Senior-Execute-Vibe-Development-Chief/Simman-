// Probe the earth_sim climate at real-world coordinates and compare to reality.
//   node tools/probe_climate.mjs [W] [H] [preset]
// Samples elevation/temperature/moisture/biome at known places, converts the
// internal t-scale back to °C (t = 0.60 + °C/100), and prints expected vs got.
import { generateWorld } from "../src/sim/worldgen.js";

const W = parseInt(process.argv[2] || "720", 10);
const H = parseInt(process.argv[3] || "360", 10);
const PRESET = process.argv[4] || "earth_sim";

const BN = ['DeepOcean','ShallowOcean','Coastal','Beach','Tundra','Ice','Taiga','Boreal',
  'TempForest','TempRain','TropRain','Savanna','Grassland','Desert','Shrubland',
  'TropDryForest','Barren','Subtropical','ColdDesert'];
function getBiomeD(e, m, t, sl, dry) {
  if (e <= sl) return e < sl - .08 ? 0 : e < sl - .01 ? 1 : 2;
  const demand = .5 + t * .5;
  let em = Math.min(1, m / demand);
  // Dry-season length (see WorldSim.jsx getBiomeD) — kept in sync.
  const warmth = Math.max(0, Math.min(1, (t - 0.79) / 0.035));
  if (dry > 0 && warmth > 0) {
    const seas = em * (1 - 0.68 * warmth * Math.max(0, Math.min(1, (dry - 0.28) / 0.10)));
    em = Math.max(seas, Math.min(em, 0.17));
  }
  if (t < .45) return 5;
  if (t < .52) return em > .4 ? 6 : em > .08 ? 4 : 18;
  if (t < .58) return em > .35 ? 6 : em > .08 ? 4 : 18;
  if (t < .65) return em > .45 ? 7 : em > .25 ? 6 : em > .08 ? 4 : 18;
  if (t < .78) return em>.58?9:em>.40?8:em>.14?12:13;
  if (t < .85) return em>.54?17:em>.36?15:em>.16?11:em>.09?14:13;
  return em>.56?10:em>.38?15:em>.16?11:em>.09?12:13;
}
const toC = t => ((t - 0.60) * 100).toFixed(0);

// lat (+N), lon (+E), name, expected biome / note
const PLACES = [
  ['Sahara (Algeria)',        23,   5, 'DESERT — hyperarid, ~25°C ann'],
  ['Sahara core (Libya)',     25,  18, 'DESERT'],
  ['Sahel (Niger)',           15,   8, 'Savanna/semi-arid'],
  ['W Sahara coast',          22, -14, 'Desert (cool coast)'],
  ['Equatorial Congo',         0,  20, 'TropRainforest'],
  ['Amazon',                  -3, -62, 'TropRainforest'],
  ['Beijing E China',         40, 116, 'TempForest/humid — NOT desert'],
  ['Shanghai E China',        31, 121, 'Subtropical humid — NOT desert'],
  ['S China Guangzhou',       23, 113, 'Subtropical/Trop humid'],
  ['Taklamakan W China',      39,  82, 'DESERT (real cold desert)'],
  ['Gobi Mongolia',           43, 105, 'Cold Desert/steppe'],
  ['India Mumbai',            19,  73, 'Trop monsoon (very wet)'],
  ['India Delhi',             28,  77, 'Humid subtrop/semi-arid'],
  ['Arabia Riyadh',           24,  47, 'DESERT'],
  ['Western Europe (Paris)',  49,   2, 'TempForest mild'],
  ['London',                  51,   0, 'TempForest mild (Gulf Stream)'],
  ['Moscow interior',         55,  37, 'Boreal/cont. cold winters'],
  ['Siberia Yakutsk',        62, 130, 'Boreal/taiga, brutal cont.'],
  ['US Midwest (Kansas)',     38, -98, 'Grassland/prairie'],
  ['US SE (Atlanta)',         34, -84, 'Subtropical humid forest'],
  ['US SW (Arizona)',         33,-112, 'Desert'],
  ['Australia outback',      -25, 133, 'DESERT'],
  ['Australia E coast',      -28, 153, 'Subtrop humid'],
  ['Kalahari',               -23,  22, 'Desert/semi-arid'],
  ['Patagonia',              -47, -70, 'Cold steppe/grassland'],
  ['Greenland interior',      72, -40, 'ICE'],
  ['Greenland S coast',       61, -45, 'Tundra'],
  ['Antarctica edge',        -70,   0, 'ICE'],
  ['Antarctica coast',       -66, 110, 'ICE'],
  ['Antarctic Peninsula',    -68, -65, 'ICE/tundra'],
  ['Iceland',                 65, -19, 'Tundra/cold'],
  ['Sahara/Egypt Nile',       26,  32, 'DESERT'],
  ['SE Asia Thailand',        15, 101, 'Trop monsoon'],
  ['Borneo',                   1, 114, 'TropRainforest'],
];

console.log(`[gen] ${PRESET} ${W}x${H} ...`);
const w = generateWorld(W, H, 8817, PRESET, 0.78, true, false, {});

function sample(lat, lon) {
  const y = Math.round((90 - lat) / 180 * (H - 1));
  let x = Math.round(((lon + 180) / 360) * W) % W;
  if (x < 0) x += W;
  const i = y * W + x;
  return { i, x, y, e: w.elevation[i], m: w.moisture[i], t: w.temperature[i] };
}

console.log('\nplace                         lat  lon   elev    t(°C)  moist  BIOME            expected');
console.log('─'.repeat(110));
for (const [name, lat, lon, exp] of PLACES) {
  const s = sample(lat, lon);
  const b = getBiomeD(s.e, s.m, s.t, 0, w.dryFrac ? w.dryFrac[s.i] : 0);
  const eStr = s.e <= 0 ? 'ocean' : s.e.toFixed(3);
  console.log(
    `${name.padEnd(26)} ${String(lat).padStart(4)} ${String(lon).padStart(4)}  ${eStr.padStart(6)}  ${toC(s.t).padStart(4)}   ${s.m.toFixed(2)}   ${BN[b].padEnd(14)}   ${exp}`);
}

// Zonal moisture/temp means (land only) to see banding
console.log('\nZONAL LAND MEANS (lat band → mean t°C, mean moisture, %land):');
for (let latBand = 80; latBand >= -80; latBand -= 10) {
  const y = Math.round((90 - latBand) / 180 * (H - 1));
  let st = 0, sm = 0, n = 0, land = 0, tot = 0;
  for (let x = 0; x < W; x++) {
    const i = y * W + x; tot++;
    if (w.elevation[i] > 0) { st += w.temperature[i]; sm += w.moisture[i]; n++; land++; }
  }
  if (n === 0) { console.log(`  ${String(latBand).padStart(3)}°  (all ocean)`); continue; }
  console.log(`  ${String(latBand).padStart(3)}°  t=${toC(st/n).padStart(4)}°C  m=${(sm/n).toFixed(2)}  land=${(100*land/tot).toFixed(0)}%`);
}

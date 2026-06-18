// Comprehensive climate audit: dozens of real-world points vs model, grouped by
// region, with real annual-mean temp (°C) and expected biome. Flags mismatches.
//   node tools/probe_audit.mjs [W] [H]
import { generateWorld } from "../src/sim/worldgen.js";

const W = parseInt(process.argv[2] || "1440", 10);
const H = parseInt(process.argv[3] || "720", 10);
const BN = ['DeepOcean','ShallowOcean','Coastal','Beach','Tundra','Ice','Taiga','Boreal',
  'TempForest','TempRain','TropRain','Savanna','Grassland','Desert','Shrubland',
  'TropDryForest','Barren','Subtropical','ColdDesert'];
// rough biome "family" for each id, to judge match leniently
const FAM = {5:'ice',4:'tundra',6:'cold',7:'cold',8:'tempF',9:'tempF',10:'tropF',11:'grass',
  12:'grass',13:'desert',14:'desert',15:'tropF',16:'barren',17:'subF',18:'desert'};
function getBiomeD(e, m, t) {
  if (e <= 0) return -1;
  const demand = .5 + t * .5; const em = Math.min(1, m / demand);
  if (t < .45) return 5;
  if (t < .52) return em > .4 ? 6 : em > .08 ? 4 : 18;
  if (t < .58) return em > .35 ? 6 : em > .08 ? 4 : 18;
  if (t < .65) return em > .45 ? 7 : em > .25 ? 6 : em > .08 ? 4 : 18;
  if (t < .78) return em>.58?9:em>.40?8:em>.14?12:13;
  if (t < .85) return em>.54?17:em>.36?15:em>.16?11:em>.09?14:13;
  return em>.56?10:em>.38?15:em>.16?11:em>.09?12:13;
}
const toC = t => Math.round((t - 0.60) * 100);

const w = generateWorld(W, H, 8817, "earth_sim", 0.78, true, false, {});
// sample with nearest-land fallback within ~2°
function sample(lat, lon) {
  const cy = (90 - lat) / 180 * (H - 1), cx = ((lon + 180) / 360) * W;
  const R = Math.round(W * 2 / 360);
  let best = null, bestD = 1e9;
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    const y = Math.round(cy + dy); if (y < 0 || y >= H) continue;
    let x = Math.round(cx + dx) % W; if (x < 0) x += W;
    const i = y * W + x; if (w.elevation[i] <= 0) continue;
    const d = dx * dx + dy * dy; if (d < bestD) { bestD = d; best = i; }
  }
  if (best == null) { const y = Math.max(0, Math.min(H - 1, Math.round(cy))); let x = Math.round(cx) % W; if (x < 0) x += W; const i = y * W + x; return { e: w.elevation[i], m: 0.5, t: w.temperature[i], ocean: true }; }
  return { e: w.elevation[best], m: w.moisture[best], t: w.temperature[best], ocean: false };
}

// [name, lat, lon, realTempC, expectedFamily, note]
const REGIONS = {
'CHINA & E ASIA': [
  ['Harbin (Manchuria)', 45.8, 126.6, 4, 'cold', 'humid continental, cold'],
  ['Beijing', 39.9, 116.4, 13, 'tempF', 'humid continental, monsoon'],
  ['Shanghai', 31.2, 121.5, 17, 'subF', 'humid subtropical'],
  ['Guangzhou', 23.1, 113.3, 22, 'subF', 'humid subtropical'],
  ['Chengdu (Sichuan)', 30.7, 104.1, 16, 'subF', 'humid subtropical basin'],
  ['Kunming (Yunnan)', 25.0, 102.7, 15, 'subF', 'subtropical highland'],
  ['Urumqi (Xinjiang)', 43.8, 87.6, 7, 'desert', 'cold desert (Dzungaria)'],
  ['Kashgar (Tarim)', 39.5, 76.0, 12, 'desert', 'Taklamakan edge, cold desert'],
  ['Lhasa (Tibet)', 29.7, 91.1, 8, 'grass', 'alpine steppe (not ice!)'],
  ['Tibet interior', 33.0, 88.0, -2, 'cold', 'alpine desert/steppe'],
  ['Hong Kong', 22.3, 114.2, 23, 'subF', 'humid subtropical'],
  ['Tokyo', 35.7, 139.7, 16, 'tempF', 'humid subtropical/temperate'],
  ['Seoul', 37.6, 127.0, 13, 'tempF', 'humid continental monsoon'],
],
'BRITAIN & NW EUROPE': [
  ['London', 51.5, -0.1, 11, 'tempF', 'oceanic temperate'],
  ['Edinburgh (Scotland)', 55.9, -3.2, 9, 'tempF', 'oceanic, cool'],
  ['Dublin (Ireland)', 53.3, -6.3, 10, 'tempF', 'oceanic temperate'],
  ['Paris', 48.9, 2.4, 12, 'tempF', 'oceanic/temperate'],
  ['Bergen (Norway)', 60.4, 5.3, 8, 'tempF', 'oceanic, wet (Gulf Stream!)'],
  ['Reykjavik (Iceland)', 64.1, -21.9, 5, 'tundra', 'subpolar oceanic'],
  ['Madrid', 40.4, -3.7, 15, 'grass', 'hot-summer Med, semi-arid'],
  ['Berlin', 52.5, 13.4, 10, 'tempF', 'temperate continental'],
  ['Moscow', 55.8, 37.6, 6, 'cold', 'humid continental, boreal-ish'],
],
'E CANADA / NEWFOUNDLAND': [
  ['St Johns (Newfoundland)', 47.6, -52.7, 5, 'cold', 'cold oceanic, boreal (Labrador cur.)'],
  ['Labrador coast', 54.0, -58.0, -1, 'cold', 'subarctic, cold current'],
  ['Halifax (Nova Scotia)', 44.6, -63.6, 7, 'tempF', 'cool humid continental'],
  ['Quebec City', 46.8, -71.2, 4, 'cold', 'humid continental, cold winter'],
  ['Goose Bay', 53.3, -60.4, -1, 'cold', 'subarctic taiga'],
  ['Iqaluit (Baffin)', 63.7, -68.5, -9, 'tundra', 'arctic tundra'],
],
'CENTRAL AMERICA & CARIBBEAN': [
  ['Mexico City', 19.4, -99.1, 16, 'subF', 'subtropical highland'],
  ['Monterrey (N Mexico)', 25.7, -100.3, 23, 'desert', 'semi-arid/steppe'],
  ['Yucatan (Merida)', 21.0, -89.6, 26, 'tropF', 'tropical wet-dry'],
  ['Guatemala', 14.6, -90.5, 23, 'tropF', 'tropical highland/forest'],
  ['Panama', 9.0, -79.5, 27, 'tropF', 'tropical rainforest'],
  ['Costa Rica Carib', 10.0, -83.0, 25, 'tropF', 'tropical rainforest'],
  ['Havana (Cuba)', 23.1, -82.4, 25, 'tropF', 'tropical savanna/wet'],
  ['Baja California', 27.0, -113.0, 20, 'desert', 'desert (Sonoran/Baja)'],
],
'SOUTH AMERICA': [
  ['Bogota (Andes)', 4.7, -74.1, 14, 'subF', 'highland, cool'],
  ['Manaus (Amazon)', -3.1, -60.0, 27, 'tropF', 'tropical rainforest'],
  ['Caracas/Llanos', 8.0, -67.0, 27, 'grass', 'tropical savanna (llanos)'],
  ['Recife (NE Brazil)', -8.0, -34.9, 26, 'tropF', 'coast wet; inland Caatinga dry'],
  ['Caatinga (interior NE)', -9.0, -40.0, 25, 'desert', 'semi-arid thornscrub'],
  ['Brasilia (Cerrado)', -15.8, -47.9, 21, 'grass', 'tropical savanna (cerrado)'],
  ['Rio de Janeiro', -22.9, -43.2, 24, 'subF', 'humid subtropical/coastal forest'],
  ['Sao Paulo', -23.5, -46.6, 19, 'subF', 'humid subtropical'],
  ['Buenos Aires (Pampas)', -34.6, -58.4, 18, 'grass', 'humid pampas grassland'],
  ['Cordoba (Pampas interior)', -31.4, -64.2, 18, 'grass', 'dry pampas/steppe'],
  ['Atacama (Antofagasta)', -23.6, -70.4, 17, 'desert', 'hyperarid coastal desert'],
  ['Santiago (Chile)', -33.4, -70.6, 15, 'grass', 'Mediterranean, semi-arid'],
  ['Patagonia (steppe)', -46.0, -69.0, 8, 'desert', 'cold rain-shadow steppe'],
  ['S Patagonia (Andes W)', -47.0, -73.0, 7, 'tempF', 'wet temperate rainforest'],
  ['Tierra del Fuego', -54.0, -68.0, 6, 'cold', 'subpolar/tundra'],
  ['Quito (equ Andes)', -0.2, -78.5, 14, 'subF', 'equatorial highland'],
],
'OTHER CHECKS': [
  ['Sahara (Algeria)', 23, 5, 25, 'desert', ''],
  ['E Sahara (Egypt)', 26, 30, 24, 'desert', ''],
  ['Mumbai', 19, 73, 27, 'tropF', 'monsoon, very wet'],
  ['Delhi', 28.6, 77.2, 25, 'grass', 'humid subtrop/semi-arid'],
  ['Serengeti (E Africa)', -2.3, 34.8, 21, 'grass', 'savanna'],
  ['Congo', 0, 20, 25, 'tropF', 'rainforest'],
  ['Perth (SW Australia)', -32, 116, 18, 'grass', 'Mediterranean'],
  ['Sydney', -33.9, 151.2, 18, 'subF', 'humid subtropical'],
],
};

let nMiss = 0, nTot = 0;
for (const [region, places] of Object.entries(REGIONS)) {
  console.log(`\n━━━ ${region} ━━━`);
  console.log('place                          real°C  mdl°C  moist  biome           expected     '+'flag');
  for (const [name, lat, lon, realC, exFam, note] of places) {
    const s = sample(lat, lon);
    const b = getBiomeD(s.e, s.m, s.t);
    const fam = b < 0 ? 'OCEAN' : FAM[b];
    const dT = toC(s.t) - realC;
    const biomeBad = fam !== exFam && !(fam==='OCEAN');
    const tempBad = Math.abs(dT) >= 7;
    const flag = (s.ocean?'~ ':'')+(tempBad?`T${dT>0?'+':''}${dT} `:'')+(biomeBad?`B!`:'')+(b<0?'OCEAN!':'');
    nTot++; if (biomeBad || tempBad || b<0) nMiss++;
    console.log(`${name.padEnd(28)} ${String(realC).padStart(5)}  ${String(toC(s.t)).padStart(5)}  ${s.ocean?'  - ':s.m.toFixed(2)}   ${(b<0?'OCEAN':BN[b]).padEnd(14)}  ${exFam.padEnd(7)}      ${flag}`);
  }
}
console.log(`\n${nMiss}/${nTot} points off (biome family mismatch or |ΔT|≥7°C). Legend: T±n=temp err°C, B!=biome, ~=nearest-land fallback`);

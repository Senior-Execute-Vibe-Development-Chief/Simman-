// Transects across problem regions: Sahara (N-S), China (E-W), Antarctica (N-S),
// plus an ocean-current check (E-W temperature profile at a fixed latitude).
import { generateWorld } from "../src/sim/worldgen.js";
import { classifyBiome } from "../src/sim/biomeClass.js";

const W = 720, H = 360;
const BN = ['DeepOcean','ShallowOcean','Coastal','Beach','Tundra','Ice','Taiga','Boreal',
  'TempForest','TempRain','TropRain','Savanna','Grassland','Desert','Shrubland',
  'TropDryForest','Barren','Subtropical','ColdDesert'];
// Classifier imported, not copied — see src/sim/biomeClass.js. Local copies in
// tools/ are how the probes drifted away from the code they were meant to check.
const getBiomeD = (e, m, t, sl, dry) => classifyBiome(e, m, t, dry, 0);
const toC = t => ((t - 0.60) * 100).toFixed(0);
const w = generateWorld(W, H, 8817, "earth_sim", 0.78, true, false, {});
const px = (lat, lon) => { const y = Math.round((90 - lat) / 180 * (H - 1)); let x = Math.round(((lon + 180) / 360) * W) % W; if (x < 0) x += W; return [x, y]; };
const at = (lat, lon) => { const [x, y] = px(lat, lon); const i = y * W + x; return { e: w.elevation[i], m: w.moisture[i], t: w.temperature[i], b: getBiomeD(w.elevation[i], w.moisture[i], w.temperature[i], 0, w.dryFrac ? w.dryFrac[i] : 0) }; };

console.log('\n=== SAHARA N-S TRANSECT @ 13°E (Niger→Libya→Med) ===');
console.log('lat  elev    t°C  moist  biome       (real: 10-15°N savanna, 18-30°N desert)');
for (let lat = 35; lat >= 5; lat -= 2.5) { const s = at(lat, 13); console.log(`${String(lat).padStart(3)}  ${(s.e<=0?'ocean':s.e.toFixed(3)).padStart(6)}  ${toC(s.t).padStart(3)}  ${s.m.toFixed(2)}   ${BN[s.b]}`); }

console.log('\n=== SAHARA N-S TRANSECT @ 30°E (Sudan→Egypt) ===');
for (let lat = 32; lat >= 8; lat -= 2.5) { const s = at(lat, 30); console.log(`${String(lat).padStart(3)}  ${(s.e<=0?'ocean':s.e.toFixed(3)).padStart(6)}  ${toC(s.t).padStart(3)}  ${s.m.toFixed(2)}   ${BN[s.b]}`); }

console.log('\n=== CHINA E-W TRANSECT @ 35°N (Taklamakan→Beijing→coast) ===');
console.log('lon  elev    t°C  moist  biome       (real: 80°E desert, 100°E steppe, 115°E+ humid forest)');
for (let lon = 78; lon <= 122; lon += 4) { const s = at(35, lon); console.log(`${String(lon).padStart(3)}  ${(s.e<=0?'ocean':s.e.toFixed(3)).padStart(6)}  ${toC(s.t).padStart(3)}  ${s.m.toFixed(2)}   ${BN[s.b]}`); }

console.log('\n=== E CHINA N-S TRANSECT @ 115°E (humid monsoon belt) ===');
for (let lat = 45; lat >= 22; lat -= 2.5) { const s = at(lat, 115); console.log(`${String(lat).padStart(3)}  ${(s.e<=0?'ocean':s.e.toFixed(3)).padStart(6)}  ${toC(s.t).padStart(3)}  ${s.m.toFixed(2)}   ${BN[s.b]}`); }

console.log('\n=== ANTARCTICA: coast & peninsula (real: ALL ice, ann -10 to -55°C) ===');
for (const [name, lat, lon] of [['Pen tip',-63,-57],['Pen base',-68,-65],['Ross coast',-72,170],['Wilkes coast',-66,110],['Dronning coast',-70,10],['Interior',-82,0]]) { const s = at(lat, lon); console.log(`${name.padEnd(14)} (${lat},${lon}) elev=${(s.e<=0?'ocean':s.e.toFixed(3)).padStart(6)} t=${toC(s.t).padStart(3)}°C m=${s.m.toFixed(2)} ${BN[s.b]}`); }

console.log('\n=== OCEAN CURRENTS: SST E-W profile @ 50°N (real: W Atlantic warm ~Gulf Stream, but mostly Pacific/Atlantic basins) ===');
console.log('Real 50°N: NW Atlantic off Newfoundland ~ warm tongue NE to Europe; check if W→E ocean temp varies at all');
let prevOcean = null;
for (let lon = -180; lon < 180; lon += 10) { const s = at(50, lon); if (s.e <= 0) { const tag = prevOcean !== null ? (s.t - prevOcean > 0.02 ? ' ↑warm' : s.t - prevOcean < -0.02 ? ' ↓cold' : '') : ''; console.log(`lon ${String(lon).padStart(4)}  SST=${toC(s.t).padStart(3)}°C${tag}`); prevOcean = s.t; } }

console.log('\n=== OCEAN SST: known current spots (compare W vs E basin at same lat) ===');
for (const [name, lat, lon, real] of [
  ['Gulf Stream (NW Atl)', 40, -50, 'WARM ~18°C'],
  ['E Atlantic (off Iberia)', 40, -20, 'cool ~16°C'],
  ['Off NW Europe', 55, -10, 'WARM (Gulf Stream ext) ~11°C'],
  ['Labrador (cold)', 55, -50, 'COLD ~3°C'],
  ['California current', 30, -125, 'cool upwelling ~17°C'],
  ['Kuroshio (W Pacific)', 35, 145, 'WARM ~20°C'],
  ['Humboldt (off Peru)', -15, -80, 'COLD upwelling ~18°C'],
  ['Benguela (off Namibia)', -25, 10, 'COLD upwelling ~16°C'],
  ['Agulhas (off SE Africa)', -35, 25, 'WARM ~21°C'],
]) { const s = at(lat, lon); console.log(`${name.padEnd(26)} model SST=${(s.e<=0?toC(s.t)+'°C':'LAND!').padStart(6)}   real: ${real}`); }

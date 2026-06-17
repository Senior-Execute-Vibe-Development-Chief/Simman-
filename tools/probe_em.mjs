// Show effective-moisture (em) and biome along a tropical Africa N-S transect,
// to see whether the savanna deficit is a moisture problem or a threshold problem.
import { generateWorld } from "../src/sim/worldgen.js";
const W = 720, H = 360;
const BN = ['DeepOcean','ShallowOcean','Coastal','Beach','Tundra','Ice','Taiga','Boreal',
  'TempForest','TempRain','TropRain','Savanna','Grassland','Desert','Shrubland',
  'TropDryForest','Barren','Subtropical','ColdDesert'];
function biome(e, m, t) {
  const demand = .5 + t * .5; const em = Math.min(1, m / demand);
  let b;
  if (t < .45) b = 5; else if (t < .52) b = em > .4 ? 6 : em > .08 ? 4 : 18;
  else if (t < .58) b = em > .35 ? 6 : em > .08 ? 4 : 18;
  else if (t < .65) b = em > .45 ? 7 : em > .25 ? 6 : em > .08 ? 4 : 18;
  else if (t < .78) b = em > .55 ? 9 : em > .35 ? 8 : em > .15 ? 12 : 13;
  else if (t < .85) b = em > .5 ? 17 : em > .3 ? 15 : em > .18 ? 11 : em > .1 ? 14 : 13;
  else b = em > .5 ? 10 : em > .3 ? 15 : em > .18 ? 11 : em > .1 ? 12 : 13;
  return { em, b };
}
const w = generateWorld(W, H, 8817, "earth_sim", 0.78, true, false, {});
const at = (lat, lon) => { const y = Math.round((90 - lat) / 180 * (H - 1)); let x = Math.round(((lon + 180) / 360) * W) % W; const i = y * W + x; return { e: w.elevation[i], m: w.moisture[i], t: w.temperature[i] }; };
console.log('W Africa N-S @ 0°E (Sahara→Sahel→Guinea coast)  [real: 12-16°N=savanna, 8-12°N=woodland]');
console.log('lat  moist   em    biome');
for (let lat = 24; lat >= 4; lat -= 1.5) { const s = at(lat, 0); const { em, b } = biome(s.e, s.m, s.t); console.log(`${String(lat).padStart(3)}  ${(s.e<=0?'ocn':s.m.toFixed(2)).padStart(4)}  ${em.toFixed(2)}  ${BN[b]}`); }
console.log('\nE Africa N-S @ 37°E (Ethiopia→Kenya→Tanzania)  [real: mostly savanna/grassland]');
for (let lat = 12; lat >= -10; lat -= 1.5) { const s = at(lat, 37); const { em, b } = biome(s.e, s.m, s.t); console.log(`${String(lat).padStart(4)}  ${(s.e<=0?'ocn':s.m.toFixed(2)).padStart(4)}  ${em.toFixed(2)}  ${BN[b]}`); }

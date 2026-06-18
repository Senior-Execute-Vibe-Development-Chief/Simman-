// Interior W→E transects to see where the model over-deserts: real interiors are
// mostly GRASSLAND/STEPPE (semi-arid), with true desert only in specific spots.
import { generateWorld } from "../src/sim/worldgen.js";
const W = 1440, H = 720;
const BN = ['DeepOcean','ShallowOcean','Coastal','Beach','Tundra','Ice','Taiga','Boreal',
  'TempForest','TempRain','TropRain','Savanna','Grassland','Desert','Shrubland',
  'TropDryForest','Barren','Subtropical','ColdDesert'];
function biome(e, m, t) {
  const demand = .5 + t * .5; const em = Math.min(1, m / demand);
  let b;
  if (t < .45) b = 5; else if (t < .52) b = em > .4 ? 6 : em > .08 ? 4 : 18;
  else if (t < .58) b = em > .35 ? 6 : em > .08 ? 4 : 18;
  else if (t < .65) b = em > .45 ? 7 : em > .25 ? 6 : em > .08 ? 4 : 18;
  else if (t < .78) b = em>.58?9:em>.40?8:em>.14?12:13;
  else if (t < .85) b = em>.54?17:em>.36?15:em>.16?11:em>.09?14:13;
  else b = em>.56?10:em>.38?15:em>.16?11:em>.09?12:13;
  return { em, b };
}
const w = generateWorld(W, H, 8817, "earth_sim", 0.78, true, false, {});
const at = (lat, lon) => { const y = Math.round((90 - lat) / 180 * (H - 1)); let x = Math.round(((lon + 180) / 360) * W) % W; const i = y * W + x; return { e: w.elevation[i], m: w.moisture[i], t: w.temperature[i] }; };
function transect(name, lat, lons, note){
  console.log(`\n${name}  ${note}`);
  console.log('lon   moist  em   biome');
  for(const lon of lons){const s=at(lat,lon);if(s.e<=0){console.log(`${String(lon).padStart(4)}  ocean`);continue;}const {em,b}=biome(s.e,s.m,s.t);console.log(`${String(lon).padStart(4)}  ${s.m.toFixed(2)}  ${em.toFixed(2)} ${BN[b]}`);}
}
const R=(a,b,st)=>{const o=[];for(let v=a;v<=b;v+=st)o.push(v);return o;};
transect('US @ 40°N', 40, R(-122,-72,4), '[real: -120 desert/basin, -105..-98 high plains GRASS, -95..-75 humid FOREST]');
transect('US @ 35°N', 35, R(-118,-78,4), '[real: SW desert, -100 grass, SE forest]');
transect('Canada Prairie @ 52°N', 52, R(-120,-95,3), '[real: BC forest, AB/SK prairie GRASS→aspen]');
transect('Eurasia @ 52°N', 52, R(20,110,6), '[real: E Europe FOREST, -55 steppe GRASS, Kazakh steppe, Gobi]');
transect('Central Asia @ 45°N', 45, R(50,120,6), '[real: Caspian/Aral desert, Kazakh steppe GRASS, Gobi desert]');
transect('Argentina @ 33°S', -33, R(-70,-58,2), '[real: Andes, Cuyo dry, Pampas GRASS humid east]');
// distribution of interior (away from coast) biomes
console.log('\n--- where is the pale? desert vs grass on land ---');
let des=0,grass=0,forest=0,tot=0;
for(let i=0;i<W*H;i++){if(w.elevation[i]<=0)continue;const {b}=biome(w.elevation[i],w.moisture[i],w.temperature[i]);tot++;
  if(b===13||b===14||b===18)des++;else if(b===11||b===12)grass++;else if(b===8||b===9||b===10||b===15||b===17)forest++;}
console.log(`desert/shrub ${(100*des/tot).toFixed(1)}%  grass/sav ${(100*grass/tot).toFixed(1)}%  forest ${(100*forest/tot).toFixed(1)}% (raw px)`);

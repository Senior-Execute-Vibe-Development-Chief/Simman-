// Raw solver moisture (windMoisture) vs final, across the US and Eurasia interiors,
// to see how much of the over-desertification is the solver vs the worldgen drying.
import { EARTH_ELEV, EARTH_W, EARTH_H, decodeEarth, sampleEarth } from "../src/sim/earthData.js";
import { initNoise, mkRng, fbm } from "../src/sim/worldgenUtils.js";
import { solveWind } from "../src/sim/windSolver.js";
import { solveMoisture } from "../src/sim/moistureSolver.js";
const W = 1440, H = 720, seed = 8817;
initNoise(seed); mkRng(seed);
const eData = decodeEarth(EARTH_ELEV);
const elevation = new Float32Array(W * H), temperature = new Float32Array(W * H);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const i = y * W + x, nx = x / W, ny = y / H;
  const he = sampleEarth(eData, EARTH_W, EARTH_H, x, y, W, H);
  const noise = fbm(nx*20+3.7,ny*20+3.7,3,2,.5)*.012+fbm(nx*40+7,ny*40+7,2,2,.4)*.006;
  if (he < 3) { const depth = fbm(nx*8+50,ny*8+50,3,2,.5)*.04; elevation[i] = Math.max(-0.04,-0.03-Math.max(0,(1-he/3))*0.12+depth); }
  else { elevation[i] = Math.max(0.001,(he-3)/252*0.55+0.005+noise); }
}
const wind = solveWind(W, H, elevation, fbm, {}, seed*0.0137);
const rawM = solveMoisture(W, H, elevation, wind.windX, wind.windY, temperature, {});
const at = (lat, lon) => { const y = Math.round((90 - lat) / 180 * (H - 1)); let x = Math.round(((lon + 180) / 360) * W) % W; return y * W + x; };
function tr(name, lat, lons){console.log(`\n${name}`);console.log('lon   RAWmoist');
  for(const lon of lons){const i=at(lat,lon);console.log(`${String(lon).padStart(4)}  ${elevation[i]<=0?'ocean':rawM[i].toFixed(2)}`);}}
const R=(a,b,st)=>{const o=[];for(let v=a;v<=b;v+=st)o.push(v);return o;};
tr('US @ 40°N raw', 40, R(-122,-74,4));
tr('Eurasia @ 52°N raw', 52, R(20,110,8));
tr('Central Asia @ 45°N raw', 45, R(52,118,6));

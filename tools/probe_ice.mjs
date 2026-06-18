// Break down where ICE comes from (latitude vs elevation) and the elevation
// temperature penalty, to see why 32% of land freezes.
import { generateWorld } from "../src/sim/worldgen.js";
const W = 720, H = 360;
const w = generateWorld(W, H, 8817, "earth_sim", 0.78, true, false, {});
const toC = t => ((t - 0.60) * 100).toFixed(0);
let iceLowPolar = 0, iceHighElev = 0, iceOther = 0, totalIce = 0, land = 0;
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const i = y * W + x; if (w.elevation[i] <= 0) continue; land++;
  if (w.temperature[i] < 0.45) {
    totalIce++;
    const lat = Math.abs(y / H - 0.5) * 2;
    if (w.elevation[i] > 0.15) iceHighElev++;        // mountain/plateau ice
    else if (lat > 0.72) iceLowPolar++;              // genuine polar (>65°)
    else iceOther++;                                 // ice that is neither high nor very polar
  }
}
console.log(`land=${land}  ICE=${totalIce} (${(100*totalIce/land).toFixed(1)}%)`);
console.log(`  high-elevation ice (e>0.15, mountains/plateaus): ${(100*iceHighElev/land).toFixed(1)}% of land`);
console.log(`  genuine polar ice (lat>65°, low elev):           ${(100*iceLowPolar/land).toFixed(1)}% of land`);
console.log(`  OTHER ice (mid-lat, low-elev — suspicious):      ${(100*iceOther/land).toFixed(1)}% of land`);

console.log('\nElevation temp penalty at lat=0.39 (35°N, Tibet band): t = base - e*(0.45+0.8*lat)');
const lat = 0.39, base = 0.85 - 0.66*lat*lat + 0.18*lat*lat*lat*lat;
for (const e of [0.1, 0.2, 0.3, 0.4, 0.5]) {
  const pen = e * (0.45 + 0.8 * lat); const t = base - pen;
  console.log(`  e=${e.toFixed(2)}  penalty=${pen.toFixed(3)}  t=${t.toFixed(3)} (${toC(t)}°C) ${t<0.45?'→ ICE':''}`);
}
console.log('\nReal Tibetan Plateau (4500m, 33°N): annual mean ~0°C (alpine steppe/desert, NOT ice sheet).');
console.log('Real Andes Altiplano (3800m, 20°S): ~8°C.  Real Greenland interior (3000m, 72°N): ~-25°C (true ice).');

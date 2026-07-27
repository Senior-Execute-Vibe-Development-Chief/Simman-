// Area-weighted (cos-lat) land biome distribution — equirectangular pixels
// over-count the poles ~3-5×, so raw pixel % exaggerates ice. Weight by cos(lat).
import { generateWorld } from "../src/sim/worldgen.js";
import { classifyBiome } from "../src/sim/biomeClass.js";
const W = 720, H = 360;
const PRESET = process.argv[2] || "earth_sim";
const BN = ['DeepOcean','ShallowOcean','Coastal','Beach','Tundra','Ice','Taiga','Boreal',
  'TempForest','TempRain','TropRain','Savanna','Grassland','Desert','Shrubland',
  'TropDryForest','Barren','Subtropical','ColdDesert'];
// Classifier imported, not copied — see src/sim/biomeClass.js. Local copies in
// tools/ are how the probes drifted away from the code they were meant to check.
const getBiomeD = (e, m, t, sl, dry) => classifyBiome(e, m, t, dry, 0);
const w = generateWorld(W, H, 8817, PRESET, 0.78, true, false, {});
const counts = {}; let land = 0;
for (let y = 0; y < H; y++) {
  const lat = (y / H - 0.5) * Math.PI; const wgt = Math.cos(lat); // area weight
  for (let x = 0; x < W; x++) {
    const i = y * W + x; if (w.elevation[i] <= 0) continue;
    const b = getBiomeD(w.elevation[i], w.moisture[i], w.temperature[i], 0, w.dryFrac ? w.dryFrac[i] : 0);
    counts[b] = (counts[b] || 0) + wgt; land += wgt;
  }
}
const g = (...ids) => ids.reduce((s, id) => s + (counts[id] || 0), 0) * 100 / land;
console.log(`\n${PRESET} AREA-WEIGHTED land biome distribution:`);
for (const [b, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) console.log(`  ${BN[b].padEnd(14)} ${(100 * n / land).toFixed(1)}%`);
console.log('\nAGGREGATE (area-weighted model vs real-Earth land share):');
console.log(`  Ice/PolarDesert   ${g(5,18).toFixed(1).padStart(5)}%   real ~10%`);
console.log(`  Tundra            ${g(4).toFixed(1).padStart(5)}%   real ~5%`);
console.log(`  Taiga/Boreal      ${g(6,7).toFixed(1).padStart(5)}%   real ~17%`);
console.log(`  Temperate forest  ${g(8,9).toFixed(1).padStart(5)}%   real ~7%`);
console.log(`  Tropical forest   ${g(10,15,17).toFixed(1).padStart(5)}%   real ~12% (+subtrop)`);
console.log(`  Grass/Savanna     ${g(11,12).toFixed(1).padStart(5)}%   real ~20%`);
console.log(`  Desert/Shrub      ${g(13,14).toFixed(1).padStart(5)}%   real ~19% (hot only)`);
console.log(`  cold total (ice+tundra+taiga+boreal): ${g(5,18,4,6,7).toFixed(1)}% (real ~32% incl Antarctica)`);
console.log(`  arid total (desert+shrub+colddesert): ${g(13,14).toFixed(1)}% (real ~26%)`);

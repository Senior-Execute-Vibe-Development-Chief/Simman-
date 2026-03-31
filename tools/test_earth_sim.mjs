// Headless Earth Sim test — uses real Earth elevation data
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, '../src/WorldSim.jsx'), 'utf-8');

// Extract pure functions
const startMarker = 'const PERM=';
const endMarker = 'export default function WorldSim';
const startIdx = src.indexOf(startMarker);
const endIdx = src.indexOf(endMarker);
const pureCode = src.substring(startIdx, endIdx);

// Import all dependencies
const { computeRivers, RIVER_NONE, RIVER_STREAM, RIVER_TRIBUTARY, RIVER_MAJOR, RIVER_GREAT } = await import('../src/riverGen.js');
const { generateResources, tileResourceSummary, dominantResource, RESOURCES, RES_BY_ID } = await import('../src/resourceGen.js');
const { EARTH_ELEV, EARTH_W, EARTH_H, decodeEarth, sampleEarth } = await import('../src/earthData.js');
const { solveWind } = await import('../src/windSolver.js');
const { solveMoisture } = await import('../src/moistureSolver.js');

const RIVER_NAMES = ['', 'Stream', 'Tributary', 'Major River', 'Great River'];

// We also need generateTectonicWorld but won't use it
const generateTectonicWorld = () => null;
// Mock the real wind functions
const isRealWindAvailable = () => false;
const fillRealWind = () => {};

// Build function context
const fnBody = `
  const RIVER_NAMES = ${JSON.stringify(RIVER_NAMES)};
  const RIVER_NONE = ${RIVER_NONE};
  const RIVER_STREAM = ${RIVER_STREAM};
  const RIVER_TRIBUTARY = ${RIVER_TRIBUTARY};
  const RIVER_MAJOR = ${RIVER_MAJOR};
  const RIVER_GREAT = ${RIVER_GREAT};
  ${pureCode}
  return { initNoise, noise2D, fbm, ridged, worley, generateWorld, createTerritory, stepTerritory, stepToYear, yearStr };
`;

let fns;
try {
  const factory = new Function(
    'computeRivers', 'generateResources', 'tileResourceSummary', 'dominantResource', 'RESOURCES', 'RES_BY_ID',
    'generateTectonicWorld', 'solveWind', 'solveMoisture',
    'EARTH_ELEV', 'EARTH_W', 'EARTH_H', 'decodeEarth', 'sampleEarth',
    'isRealWindAvailable', 'fillRealWind',
    fnBody
  );
  fns = factory(
    computeRivers, generateResources, tileResourceSummary, dominantResource, RESOURCES, RES_BY_ID,
    generateTectonicWorld, solveWind, solveMoisture,
    EARTH_ELEV, EARTH_W, EARTH_H, decodeEarth, sampleEarth,
    isRealWindAvailable, fillRealWind
  );
  console.log('Loaded simulation functions OK');
} catch(e) {
  console.error('Failed:', e.message);
  // Find approximate line in eval
  const stack = e.stack || '';
  const evalMatch = stack.match(/<anonymous>:(\d+)/);
  if (evalMatch) console.error('Eval line ~' + evalMatch[1]);
  process.exit(1);
}

const { generateWorld, createTerritory, stepTerritory, stepToYear, yearStr } = fns;

// Generate Earth Sim world
console.log('Generating Earth (Sim) world...');
const t0 = performance.now();
const world = generateWorld(1920, 960, 1234, 'earth_sim', 0.78);
console.log(`World generated in ${((performance.now()-t0)/1000).toFixed(1)}s`);
console.log(`  Size: ${world.width}x${world.height}`);

console.log('Creating territory...');
const ter = createTerritory(world);
console.log(`Initial: ${ter.tribes} tribes, ${ter.landCount} land tiles, tw=${ter.tw} th=${ter.th}`);

for (let i = 0; i < ter.tribeSizes.length; i++) {
  if (ter.tribeSizes[i] > 0) {
    const k = ter.tribeKnowledge[i];
    const cx = ter.tribeCenters[i][0].x, cy = ter.tribeCenters[i][0].y;
    console.log(`  Tribe ${i}: ${ter.tribeSizes[i]}t at (${cx},${cy}) ag=${k.agriculture.toFixed(2)} mt=${k.metallurgy.toFixed(2)}`);
  }
}

// Run simulation
console.log('\n=== RUNNING EARTH SIM ===\n');
let cur = ter;
const t1 = performance.now();

for (let step = 0; step <= 800; step++) {
  cur = stepTerritory(cur, world);

  if (step % 50 === 0 || step === 10 || step === 25) {
    let alive = 0, totalPop = 0, totalTiles = 0;
    let maxMet = 0, maxAg = 0, maxOrg = 0;
    const tribeSizesArr = [];
    for (let i = 0; i < cur.tribeSizes.length; i++) {
      if (cur.tribeSizes[i] <= 0) continue;
      alive++;
      totalPop += cur.tribePopulation[i];
      totalTiles += cur.tribeSizes[i];
      maxMet = Math.max(maxMet, cur.tribeKnowledge[i].metallurgy);
      maxAg = Math.max(maxAg, cur.tribeKnowledge[i].agriculture);
      maxOrg = Math.max(maxOrg, cur.tribeKnowledge[i].organization);
      tribeSizesArr.push(cur.tribeSizes[i]);
    }
    tribeSizesArr.sort((a,b) => b-a);
    const top3 = tribeSizesArr.slice(0,3).join('/');

    let maxBg = 0, bgAbove = 0, unowned = 0;
    for (let ti = 0; ti < cur.tw * cur.th; ti++) {
      if (cur.bgPop[ti] > maxBg) maxBg = cur.bgPop[ti];
      if (cur.owner[ti] < 0 && cur.bgPop[ti] > 0.12) bgAbove++;
      if (cur.owner[ti] < 0 && cur.tElev[ti] > 0) unowned++;
    }

    const yr = yearStr(step);
    const era = maxMet > 0.7 ? 'Industrial' : maxMet > 0.5 ? 'Iron' : maxMet > 0.3 ? 'Bronze' : maxMet > 0.15 ? 'Copper' : 'Stone';
    const elapsed = ((performance.now()-t1)/1000).toFixed(1);
    console.log(`Step ${String(step).padStart(3)} (${yr.padStart(8)}) | ${String(alive).padStart(2)} tribes | ${totalTiles}/${cur.landCount}t (${(totalTiles/cur.landCount*100).toFixed(0)}%) | pop ${(totalPop/1000).toFixed(0)}M | Ag${(maxAg*100).toFixed(0)} Mt${(maxMet*100).toFixed(0)} Og${(maxOrg*100).toFixed(0)} [${era}] | top3: ${top3} | bg:${maxBg.toFixed(2)} free:${unowned} bgAbv:${bgAbove} sp:${cur._dbgCrystalSpawned||0} | ${elapsed}s`);
  }
}

// Final state
console.log('\n=== FINAL STATE ===');
const finalTribes = [];
for (let i = 0; i < cur.tribeSizes.length; i++) {
  if (cur.tribeSizes[i] <= 0) continue;
  finalTribes.push({
    id: i, sz: cur.tribeSizes[i], pop: cur.tribePopulation[i],
    k: cur.tribeKnowledge[i], b: cur.tribeBudget[i]
  });
}
finalTribes.sort((a,b) => b.sz - a.sz);
for (const t of finalTribes.slice(0, 15)) {
  console.log(`  Tribe ${t.id}: ${t.sz}t pop=${(t.pop/1000).toFixed(1)}M ag=${t.k.agriculture.toFixed(2)} mt=${t.k.metallurgy.toFixed(2)} cn=${t.k.construction.toFixed(2)} og=${t.k.organization.toFixed(2)} [${t.b?.personality||'?'}]`);
}
if (finalTribes.length > 15) console.log(`  ... and ${finalTribes.length-15} more tribes`);

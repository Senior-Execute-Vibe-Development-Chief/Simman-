// Full headless simulation test
// Extracts pure sim functions from WorldSim.jsx and runs createTerritory + stepTerritory
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, '../src/WorldSim.jsx'), 'utf-8');

// Extract pure functions (between PERM declaration and export default)
const startMarker = 'const PERM=';
const endMarker = 'export default function WorldSim';
const startIdx = src.indexOf(startMarker);
const endIdx = src.indexOf(endMarker);
const pureCode = src.substring(startIdx, endIdx);

// Import dependencies
const { computeRivers, RIVER_NONE, RIVER_STREAM, RIVER_TRIBUTARY, RIVER_MAJOR, RIVER_GREAT } = await import('../src/riverGen.js');
const { generateResources, tileResourceSummary, dominantResource, RESOURCES, RES_BY_ID } = await import('../src/resourceGen.js');

// We need these available but won't actually generate tectonic worlds — use a simple test world
const RIVER_NAMES = ['', 'Stream', 'Tributary', 'Major River', 'Great River'];

// Create a minimal mock world (no tectonic gen needed)
function createMockWorld(W, H, seed) {
  const elevation = new Float32Array(W * H);
  const temperature = new Float32Array(W * H);
  const moisture = new Float32Array(W * H);
  const coastal = new Uint8Array(W * H);

  // Simple procedural world: land in center, ocean at edges
  // With a "river valley" of high fertility in the middle
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const cx = x / W - 0.5, cy = y / H - 0.5;
      const dist = Math.sqrt(cx*cx + cy*cy);

      // Land: inner 70% is land
      elevation[i] = dist < 0.35 ? 0.1 + Math.random() * 0.15 : -0.1;

      // Temperature: warm in middle, cold at poles
      temperature[i] = 0.3 + 0.4 * (1 - Math.abs(cy) * 2);

      // Moisture: higher near center (river valley simulation)
      const riverDist = Math.abs(cy); // horizontal river through middle
      moisture[i] = 0.2 + 0.4 * Math.max(0, 1 - riverDist * 5) + Math.random() * 0.1;

      // Coastal
      if (elevation[i] > 0 && dist > 0.30 && dist < 0.37) coastal[i] = 1;
    }
  }

  return { width: W, height: H, elevation, temperature, moisture, coastal, _seed: seed, preset: 'tectonic' };
}

// Build the function context
// We need to provide all the imports the pure code uses
const fnBody = `
  // Provide imports
  const RIVER_NAMES = ${JSON.stringify(RIVER_NAMES)};
  const RIVER_NONE = ${RIVER_NONE};
  const RIVER_STREAM = ${RIVER_STREAM};
  const RIVER_TRIBUTARY = ${RIVER_TRIBUTARY};
  const RIVER_MAJOR = ${RIVER_MAJOR};
  const RIVER_GREAT = ${RIVER_GREAT};

  ${pureCode}

  return { createTerritory, stepTerritory, stepToYear, yearStr };
`;

let fns;
try {
  const factory = new Function('computeRivers', 'generateResources', 'tileResourceSummary', 'dominantResource', 'RESOURCES', 'RES_BY_ID', fnBody);
  fns = factory(computeRivers, generateResources, tileResourceSummary, dominantResource, RESOURCES, RES_BY_ID);
  console.log('Loaded simulation functions OK');
} catch(e) {
  console.error('Failed to load:', e.message);
  // Try to find the line
  const lines = fnBody.split('\n');
  const match = e.message.match(/position (\d+)/);
  if (match) {
    const pos = parseInt(match[1]);
    let charCount = 0;
    for (let i = 0; i < lines.length; i++) {
      charCount += lines[i].length + 1;
      if (charCount > pos) {
        console.error(`Near line ${i}: ${lines[i].substring(0, 100)}`);
        break;
      }
    }
  }
  process.exit(1);
}

const { createTerritory, stepTerritory, stepToYear, yearStr } = fns;

// Create test world
console.log('\nCreating test world (200x100)...');
const W = 200, H = 100;
const world = createMockWorld(W, H, 42);

console.log('Creating territory...');
const ter = createTerritory(world);

console.log(`Initial state: ${ter.tribes} tribes, ${ter.landCount} land tiles`);
console.log(`Starting tribes:`);
for (let i = 0; i < ter.tribeSizes.length; i++) {
  if (ter.tribeSizes[i] > 0) {
    const k = ter.tribeKnowledge[i];
    console.log(`  Tribe ${i}: ${ter.tribeSizes[i]} tiles, pop=${ter.tribePopulation[i].toFixed(0)}, ag=${k.agriculture.toFixed(2)} mt=${k.metallurgy.toFixed(2)}`);
  }
}

// Check initial bgPop
let maxBg = 0, bgCount = 0;
for (let i = 0; i < ter.tw * ter.th; i++) {
  if (ter.bgPop[i] > maxBg) maxBg = ter.bgPop[i];
  if (ter.bgPop[i] > 0.12) bgCount++;
}
console.log(`\nInitial bgPop: max=${maxBg.toFixed(3)}, tiles above 0.12=${bgCount}`);

// Run simulation
console.log('\n=== RUNNING SIMULATION ===\n');
let currentTer = ter;

for (let step = 0; step <= 500; step++) {
  currentTer = stepTerritory(currentTer, world);

  // Report every 25 steps
  if (step % 25 === 0 || step === 1 || step === 5 || step === 10) {
    let alive = 0, totalPop = 0, totalTiles = 0;
    let maxMet = 0, maxAg = 0;
    for (let i = 0; i < currentTer.tribeSizes.length; i++) {
      if (currentTer.tribeSizes[i] <= 0) continue;
      alive++;
      totalPop += currentTer.tribePopulation[i];
      totalTiles += currentTer.tribeSizes[i];
      maxMet = Math.max(maxMet, currentTer.tribeKnowledge[i].metallurgy);
      maxAg = Math.max(maxAg, currentTer.tribeKnowledge[i].agriculture);
    }

    let maxBg2 = 0, bgAbove = 0;
    for (let ti = 0; ti < currentTer.tw * currentTer.th; ti++) {
      if (currentTer.bgPop[ti] > maxBg2) maxBg2 = currentTer.bgPop[ti];
      if (currentTer.owner[ti] < 0 && currentTer.bgPop[ti] > 0.12) bgAbove++;
    }

    const yr = yearStr(step);
    const era = maxMet > 0.7 ? 'Industrial' : maxMet > 0.5 ? 'Iron' : maxMet > 0.3 ? 'Bronze' : maxMet > 0.15 ? 'Copper' : 'Stone';
    console.log(`Step ${String(step).padStart(3)} (${yr.padStart(8)}) | ${alive} tribes | ${totalTiles} tiles | pop ${(totalPop/1000).toFixed(1)}M | maxAg=${maxAg.toFixed(2)} maxMet=${maxMet.toFixed(2)} [${era}] | bg:${maxBg2.toFixed(3)} unownedAbove:${bgAbove} | spawned:${currentTer._dbgCrystalSpawned||0} calls:${currentTer._dbgBgCalls||0}`);
  }
}

console.log('\n=== FINAL STATE ===');
for (let i = 0; i < currentTer.tribeSizes.length; i++) {
  if (currentTer.tribeSizes[i] <= 0) continue;
  const k = currentTer.tribeKnowledge[i];
  const b = currentTer.tribeBudget[i];
  const pop = currentTer.tribePopulation[i];
  console.log(`  Tribe ${i}: ${currentTer.tribeSizes[i]}t pop=${(pop/1000).toFixed(1)}M ag=${k.agriculture.toFixed(2)} mt=${k.metallurgy.toFixed(2)} cn=${k.construction.toFixed(2)} og=${k.organization.toFixed(2)} [${b.personality}]`);
}

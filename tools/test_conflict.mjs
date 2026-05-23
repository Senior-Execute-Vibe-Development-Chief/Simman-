// Headless conflict-rate test for tribe border combat.
// Extracts pure sim funcs from WorldSim.jsx, instruments the conflict block
// with a counter, runs many steps, and reports tile-flip rate and tribe deaths.
//
// Usage: node tools/test_conflict.mjs [steps] [seed]
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STEPS = parseInt(process.argv[2] || '600', 10);
const SEED = parseInt(process.argv[3] || '42', 10);

const src = readFileSync(join(__dirname, '../src/WorldSim.jsx'), 'utf-8');

// Pure region: between `const PERM=` and `function KnowledgeRadar` (first JSX comp)
const startIdx = src.indexOf('const PERM=');
const endIdx = src.indexOf('function KnowledgeRadar');
let pureCode = src.substring(startIdx, endIdx);

// Instrument the conflict block: count flips and credible-attempts
pureCode = pureCode.replace(
  'for(const[ti,to]of flips){if(owner[ti]===to)continue;',
  'if(!ter._dbgFlips)ter._dbgFlips=0; ter._dbgFlips+=flips.length;\nfor(const[ti,to]of flips){if(owner[ti]===to)continue;'
);
// Sample the ratio distribution for any qualifying border attack
pureCode = pureCode.replace(
  'const ratio=lpB/Math.max(0.001,lpA*totalDef);',
  'const ratio=lpB/Math.max(0.001,lpA*totalDef); if(!ter._dbgRatios)ter._dbgRatios=new Array(20).fill(0); ter._dbgRatios[Math.min(19,Math.floor(ratio*4))]++;'
);

// Pull in module deps the refactor introduced
const tribePower = await import('../src/tribePower.js');
const tribeModel = await import('../src/tribeModel.js');
const tribeStepMod = await import('../src/tribeStep.js');
const { computeRivers, RIVER_NAMES, RIVER_NONE, RIVER_STREAM, RIVER_TRIBUTARY, RIVER_MAJOR, RIVER_GREAT } = await import('../src/riverGen.js');
const { generateResources, tileResourceSummary, dominantResource, RESOURCES, RES_BY_ID } = await import('../src/resourceGen.js');

// Simple seeded RNG so runs are reproducible
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
const rng = mulberry32(SEED);
const origRand = Math.random;
Math.random = rng;

function createMockWorld(W, H) {
  const elevation = new Float32Array(W * H);
  const temperature = new Float32Array(W * H);
  const moisture = new Float32Array(W * H);
  const coastal = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const cx = x / W - 0.5, cy = y / H - 0.5;
      const dist = Math.sqrt(cx*cx + cy*cy);
      elevation[i] = dist < 0.38 ? 0.05 + rng() * 0.20 : -0.1;
      // Add some mountain ridges so terrain varies
      if (Math.abs(cx) > 0.15 && Math.abs(cx) < 0.20 && elevation[i] > 0) elevation[i] += 0.3;
      temperature[i] = 0.3 + 0.4 * (1 - Math.abs(cy) * 2);
      const riverDist = Math.abs(cy);
      moisture[i] = 0.2 + 0.4 * Math.max(0, 1 - riverDist * 5) + rng() * 0.1;
      if (elevation[i] > 0 && dist > 0.33 && dist < 0.40) coastal[i] = 1;
    }
  }
  return { width: W, height: H, elevation, temperature, moisture, coastal, _seed: SEED, preset: 'tectonic' };
}

const fnBody = `
  const RIVER_NAMES = ${JSON.stringify(RIVER_NAMES)};
  const RIVER_NONE = ${RIVER_NONE};
  const RIVER_STREAM = ${RIVER_STREAM};
  const RIVER_TRIBUTARY = ${RIVER_TRIBUTARY};
  const RIVER_MAJOR = ${RIVER_MAJOR};
  const RIVER_GREAT = ${RIVER_GREAT};
  ${pureCode}
  return { createTerritory, stepTerritory };
`;

const factory = new Function(
  'computeRivers', 'generateResources', 'tileResourceSummary', 'dominantResource', 'RESOURCES', 'RES_BY_ID',
  'tribePower', 'localPower', 'tribeOreAccess', 'tDistW', 'expFalloff',
  'ensureTribeViews', 'attachRegistries',
  'runTribeStep', 'resetInvariantState',
  fnBody
);

const fns = factory(
  computeRivers, generateResources, tileResourceSummary, dominantResource, RESOURCES, RES_BY_ID,
  tribePower.tribePower, tribePower.localPower, tribePower.tribeOreAccess, tribePower.tDistW, tribePower.expFalloff,
  tribeModel.ensureTribeViews, tribeModel.attachRegistries,
  tribeStepMod.runTribeStep, tribeStepMod.resetInvariantState,
);

const { createTerritory, stepTerritory } = fns;

const W = parseInt(process.env.W || '600', 10), H = parseInt(process.env.H || '300', 10);
const world = createMockWorld(W, H);
const ter = createTerritory(world);

// Report tribe spacing + border-contact stats
const initialTribes = (() => { let n=0; for (let i=0;i<ter.tribeSizes.length;i++) if (ter.tribeSizes[i]>0) n++; return n; })();
console.log(`World ${W}x${H}, seed=${SEED}, initial tribes=${initialTribes}`);
console.log(`MIN_SPACING for world width ${W}: ${Math.round(W*0.02)}`);

let totalFlips = 0, totalCredible = 0;
let prevFlips = 0, prevCredible = 0;

const samples = [];

for (let step = 1; step <= STEPS; step++) {
  stepTerritory(ter, world);

  if (step % 50 === 0 || step === STEPS) {
    const flipsTotal = ter._dbgFlips || 0;
    const credTotal = ter._dbgCredible || 0;
    const dFlips = flipsTotal - prevFlips;
    const dCred = credTotal - prevCredible;
    prevFlips = flipsTotal; prevCredible = credTotal;

    let alive = 0, totalPop = 0, totalTiles = 0;
    let largestTribe = 0;
    for (let i = 0; i < ter.tribeSizes.length; i++) {
      if (ter.tribeSizes[i] <= 0) continue;
      alive++;
      totalPop += ter.tribePopulation[i];
      totalTiles += ter.tribeSizes[i];
      if (ter.tribeSizes[i] > largestTribe) largestTribe = ter.tribeSizes[i];
    }
    const unclaimedLand = (() => {
      let c=0; for (let i=0;i<ter.tw*ter.th;i++) if (ter.tElev[i]>0 && ter.owner[i]<0) c++;
      return c;
    })();

    // Count tribes with any border contact
    let withContact = 0;
    if (ter._borderContacts) for (let i=0;i<ter._borderContacts.length;i++) {
      if (ter.tribeSizes[i]<=0) continue;
      if (Object.keys(ter._borderContacts[i]).length>0) withContact++;
    }
    let activeWars = 0, recentDeclared = 0, recentEnded = 0, capitalsTaken = 0;
    if (ter.wars) for (const k in ter.wars) if (ter.wars[k].active) activeWars++;
    if (ter._warEvents) {
      for (const e of ter._warEvents) {
        if (ter.stepCount - e.step > 50) continue;
        if (e.type === 'declared') recentDeclared++;
        else if (e.type === 'ended') recentEnded++;
        else if (e.type === 'capital-fall' || e.type === 'city-fall') capitalsTaken++;
      }
    }
    samples.push({step, alive, totalTiles, unclaimedLand, dFlips, dCred, largestTribe, totalPop, withContact, activeWars});
    console.log(`Step ${String(step).padStart(4)} | ${String(alive).padStart(3)} tribes (${withContact} touch others) | tiles=${String(totalTiles).padStart(5)} | biggest=${largestTribe} | flips/50=${dFlips} | wars: ${activeWars} active, ${recentDeclared} new, ${recentEnded} ended, ${capitalsTaken} cities fell`);
  }
}

console.log('\n=== SUMMARY ===');
console.log(`Total flips: ${ter._dbgFlips || 0}`);
if (ter._dbgRatios) {
  console.log('Ratio histogram (lpB / (lpA*totalDef), bucket size 0.25):');
  for (let b = 0; b < 20; b++) {
    const lo = (b/4).toFixed(2), hi = ((b+1)/4).toFixed(2);
    const count = ter._dbgRatios[b];
    const bar = '█'.repeat(Math.min(60, Math.floor(count / 200)));
    if (count > 0) console.log(`  [${lo}-${hi}${b===19?'+':''}] ${String(count).padStart(7)} ${bar}`);
  }
}
const lastSample = samples[samples.length - 1];
const firstStableSample = samples.find(s => s.unclaimedLand < 50) || samples[samples.length - 1];
console.log(`Tribes died: ${initialTribes - lastSample.alive} (started ${initialTribes}, ended ${lastSample.alive})`);
console.log(`Largest tribe at end: ${lastSample.largestTribe} tiles`);
console.log(`Map filled (unclaimed<50) at step: ${firstStableSample.step}`);
const postFillSamples = samples.filter(s => s.step >= firstStableSample.step);
const postFillFlips = postFillSamples.reduce((a,s)=>a+s.dFlips, 0);
console.log(`Total flips AFTER map fill: ${postFillFlips} (across ${postFillSamples.length * 50} steps)`);

Math.random = origRand;

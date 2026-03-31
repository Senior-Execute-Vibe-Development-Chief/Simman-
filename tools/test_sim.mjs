// Headless simulation test — runs worldgen + stepTerritory without React/Canvas
// Usage: node tools/test_sim.mjs

// Mock React hooks so the module can load
const mockState = (v) => [v, ()=>{}];
const mockRef = (v) => ({current:v});
const mockCb = (f) => f;
globalThis.React = { useState: mockState, useEffect:()=>{}, useRef: mockRef, useCallback: mockCb };

// We can't import WorldSim.jsx directly because it's full of JSX and React.
// Instead, let's extract and test the core logic by reading the source and eval-ing
// just the pure functions we need.

import { readFileSync } from 'fs';
import { generateTectonicWorld } from '../src/tectonicGen.js';
import { solveWind } from '../src/windSolver.js';
import { solveMoisture } from '../src/moistureSolver.js';
import { computeRivers, RIVER_NONE, RIVER_STREAM, RIVER_TRIBUTARY, RIVER_MAJOR, RIVER_GREAT } from '../src/riverGen.js';
import { generateResources, RESOURCES, RES_BY_ID } from '../src/resourceGen.js';

// Read WorldSim source and extract the pure functions
const src = readFileSync(new URL('../src/WorldSim.jsx', import.meta.url), 'utf-8');

// Extract everything between the first function and "export default function WorldSim"
const startIdx = src.indexOf('const PERM=');
const endIdx = src.indexOf('export default function WorldSim');
const pureFunctions = src.substring(startIdx, endIdx);

// We need to provide the imports that the pure functions use
const RIVER_NAMES = ['', 'Stream', 'Tributary', 'Major River', 'Great River'];

// Eval the pure functions in our scope
// This is hacky but works for testing
const fn = new Function(
  'computeRivers', 'RIVER_NONE', 'RIVER_STREAM', 'RIVER_TRIBUTARY', 'RIVER_MAJOR', 'RIVER_GREAT', 'RIVER_NAMES',
  'generateResources', 'RESOURCES', 'RES_BY_ID',
  'generateTectonicWorld', 'solveWind', 'solveMoisture',
  // Return the functions we need
  pureFunctions + `
  return { createTerritory, stepTerritory, tileFert, stepToYear, yearStr };
  `
);

console.log('Loading simulation functions...');
let fns;
try {
  fns = fn(
    computeRivers, RIVER_NONE, RIVER_STREAM, RIVER_TRIBUTARY, RIVER_MAJOR, RIVER_GREAT, RIVER_NAMES,
    generateResources, RESOURCES, RES_BY_ID,
    generateTectonicWorld, solveWind, solveMoisture
  );
  console.log('OK - functions loaded');
} catch(e) {
  console.error('Failed to load functions:', e.message);
  console.error('Line:', e.stack?.split('\n')[1]);
  process.exit(1);
}

// This approach is too fragile. Let's do something simpler:
// Just test the bgPop math directly.

console.log('\n=== BACKGROUND POP MATH TEST ===');
console.log('Testing if bgPop grows above crystallization threshold...\n');

// Simulate bgPop growth for a single tile
function testBgPopGrowth(fert, diff, owned) {
  const orgBoost = owned ? 2.0 : 1.0;
  const cap = fert*fert*2.0*(1-diff*0.6)*orgBoost;
  // Init value (from createTerritory)
  let bgPop = fert*fert*1.5*(1-diff); // + valley bonus, but ignore for simplicity

  console.log(`fert=${fert}, diff=${diff}, owned=${owned}`);
  console.log(`  init bgPop=${bgPop.toFixed(4)}, cap=${cap.toFixed(4)}, ratio=${(bgPop/cap).toFixed(3)}`);

  // Simulate 200 steps of growth (stepBackgroundPop runs every 8 steps, but let's sim the math)
  for (let step = 0; step < 200; step++) {
    const ratio = bgPop / cap;
    bgPop = Math.max(0, bgPop + bgPop * 0.02 * (1 - ratio));

    if (step === 10 || step === 50 || step === 100 || step === 199) {
      console.log(`  step ${step+1}: bgPop=${bgPop.toFixed(4)}, ratio=${(bgPop/cap).toFixed(3)}`);
    }
  }

  const CRYSTAL_THRESHOLD = 0.20;
  console.log(`  Final bgPop=${bgPop.toFixed(4)}, above crystal threshold (${CRYSTAL_THRESHOLD})? ${bgPop > CRYSTAL_THRESHOLD ? 'YES' : 'NO'}`);
  console.log();
}

// Test various tile types
testBgPopGrowth(0.5, 0.0, false);  // Good fertile unowned
testBgPopGrowth(0.5, 0.0, true);   // Good fertile owned
testBgPopGrowth(0.3, 0.1, false);  // Moderate unowned
testBgPopGrowth(0.3, 0.1, true);   // Moderate owned
testBgPopGrowth(0.1, 0.3, false);  // Poor unowned
testBgPopGrowth(0.1, 0.0, false);  // Poor flat unowned

console.log('\n=== KNOWLEDGE GROWTH TEST ===');
console.log('Testing metallurgy progression...\n');

function testMetallurgyGrowth(startMet, agriculture, copperAmt, tinAmt, ironAmt, coalAmt) {
  let mt = startMet;
  const ag = agriculture;

  // Simulate resourceValues for metallurgy
  function metRv(mt) {
    return {
      copper: Math.min(1, mt < 0.5 ? mt*1.5 : 0.75-(mt-0.5)*0.5),
      tin: Math.min(1, mt > 0.1 && mt < 0.6 ? (mt-0.1)*2.0 : mt >= 0.6 ? 0.3 : 0),
      iron: Math.min(1, Math.max(0, mt-0.2)*1.2),
      coal: Math.min(1, Math.max(0, mt-0.5)*Math.max(0, 0.3)*4)  // cn=0.3 placeholder
    };
  }

  console.log(`Starting mt=${startMet}, ag=${ag}, Cu=${copperAmt} Sn=${tinAmt} Fe=${ironAmt} Co=${coalAmt}`);

  for (let step = 0; step < 500; step++) {
    const rv = metRv(mt);
    const oreRichness = Math.min(1, rv.copper*copperAmt*0.12 + rv.tin*tinAmt*0.15 + rv.iron*ironAmt*0.12 + rv.coal*coalAmt*0.10);
    let score = oreRichness*1.0 + ag*0.5 + mt*0.4;
    if (oreRichness < 0.05) score *= 0.15;
    const growth = 0.015 * score * Math.sqrt(1-mt);
    mt = Math.min(1, mt + Math.max(0, growth));

    if (step === 0 || step === 49 || step === 99 || step === 199 || step === 299 || step === 499) {
      const era = mt > 0.7 ? 'Industrial' : mt > 0.5 ? 'Iron' : mt > 0.3 ? 'Bronze' : mt > 0.15 ? 'Copper' : 'Stone';
      console.log(`  kStep ${step+1} (simStep ${step*8}): mt=${mt.toFixed(3)} [${era}] oreRich=${oreRichness.toFixed(3)} score=${score.toFixed(3)} growth=${growth.toFixed(5)}`);
    }
  }
  console.log();
}

// Test with good ore access (like Mesopotamia)
testMetallurgyGrowth(0.15, 0.45, 8, 4, 6, 2);
// Test with only copper (no tin)
testMetallurgyGrowth(0.15, 0.45, 8, 0, 6, 2);
// Test with no ore
testMetallurgyGrowth(0.15, 0.45, 0, 0, 0, 0);

console.log('\n=== EXPANSION CHANCE TEST ===');
console.log('Testing expansion probability for different tiles...\n');

function testExpansionChance(fert, diff, agLevel, mt, cn, org, popPressure, groB, expB) {
  const wet = 0.7;
  const knowledgeReduction = cn*0.25 + org*0.15 + agLevel*0.10 + mt*0.10;
  const adjDiff = Math.max(0.02, Math.min(1, diff - knowledgeReduction));
  const agBoost = 1 + agLevel * 2;

  let chance = 0.30 * wet * 1; // smallBoost=1
  chance *= Math.max(0.01, (1-adjDiff)*(1-adjDiff)*(1-adjDiff));
  const fertSq = fert*fert;
  const techFloor = agLevel*0.05 + mt*0.03 + cn*0.03;
  chance *= Math.max(techFloor, fertSq*4);
  chance *= agBoost;
  chance *= (0.4 + groB*3.0 + expB*2.5);
  chance *= Math.max(0.05, popPressure);
  // skip score bonus and distance for simplicity

  console.log(`fert=${fert} diff=${diff} ag=${agLevel} mt=${mt} pop=${popPressure.toFixed(1)} gro=${groB} exp=${expB}`);
  console.log(`  adjDiff=${adjDiff.toFixed(3)} fertMult=${Math.max(techFloor,fertSq*4).toFixed(3)} agBoost=${agBoost.toFixed(1)} budgetMult=${(0.4+groB*3.0+expB*2.5).toFixed(2)} → chance=${(chance*100).toFixed(2)}%`);
  console.log();
}

// Good fertile river tile, early civ
testExpansionChance(0.5, 0.0, 0.4, 0.15, 0.1, 0.1, 0.8, 0.25, 0.15);
// Moderate land, established civ
testExpansionChance(0.3, 0.1, 0.5, 0.3, 0.2, 0.2, 0.6, 0.25, 0.15);
// Poor land, advanced civ
testExpansionChance(0.1, 0.3, 0.7, 0.5, 0.4, 0.4, 0.5, 0.20, 0.15);
// Desert, industrial civ
testExpansionChance(0.05, 0.5, 0.9, 0.8, 0.7, 0.7, 1.0, 0.15, 0.10);

console.log('=== DONE ===');

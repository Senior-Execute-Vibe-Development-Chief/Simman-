import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, '../src/WorldSim.jsx'), 'utf-8');
const startIdx = src.indexOf('const PERM=');
const endIdx = src.indexOf('export default function WorldSim');
const pureCode = src.substring(startIdx, endIdx);
const { computeRivers, RIVER_NONE, RIVER_STREAM, RIVER_TRIBUTARY, RIVER_MAJOR, RIVER_GREAT } = await import('../src/riverGen.js');
const { generateResources, tileResourceSummary, dominantResource, RESOURCES, RES_BY_ID } = await import('../src/resourceGen.js');
const { EARTH_ELEV, EARTH_W, EARTH_H, decodeEarth, sampleEarth } = await import('../src/earthData.js');
const { solveWind } = await import('../src/windSolver.js');
const { solveMoisture } = await import('../src/moistureSolver.js');
const RIVER_NAMES=['','Stream','Tributary','Major River','Great River'];
const generateTectonicWorld=()=>null;const isRealWindAvailable=()=>false;const fillRealWind=()=>{};
const fnBody=`const RIVER_NAMES=${JSON.stringify(RIVER_NAMES)};const RIVER_NONE=${RIVER_NONE};const RIVER_STREAM=${RIVER_STREAM};const RIVER_TRIBUTARY=${RIVER_TRIBUTARY};const RIVER_MAJOR=${RIVER_MAJOR};const RIVER_GREAT=${RIVER_GREAT};${pureCode}return{generateWorld,createTerritory,stepTerritory};`;
const factory=new Function('computeRivers','generateResources','tileResourceSummary','dominantResource','RESOURCES','RES_BY_ID','generateTectonicWorld','solveWind','solveMoisture','EARTH_ELEV','EARTH_W','EARTH_H','decodeEarth','sampleEarth','isRealWindAvailable','fillRealWind',fnBody);
const fns=factory(computeRivers,generateResources,tileResourceSummary,dominantResource,RESOURCES,RES_BY_ID,generateTectonicWorld,solveWind,solveMoisture,EARTH_ELEV,EARTH_W,EARTH_H,decodeEarth,sampleEarth,isRealWindAvailable,fillRealWind);
const world = fns.generateWorld(1920,960,1234,'earth_sim',0.78);
let cur = fns.createTerritory(world);
// Run to step 100 and time each
for(let step=0;step<50;step++){
  const t0=performance.now();
  cur=fns.stepTerritory(cur,world);
  const dt=performance.now()-t0;
  if(dt>50)console.log(`Step ${step}: ${dt.toFixed(0)}ms SLOW | frontier:${cur.frontierList.length}`);
}
console.log('First 50 steps done');
// Run 50 more
for(let step=50;step<100;step++){
  const t0=performance.now();
  cur=fns.stepTerritory(cur,world);
  const dt=performance.now()-t0;
  if(dt>100)console.log(`Step ${step}: ${dt.toFixed(0)}ms SLOW | frontier:${cur.frontierList.length}`);
}
console.log('100 steps done');

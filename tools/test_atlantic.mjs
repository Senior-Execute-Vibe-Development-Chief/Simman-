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
const fnBody=`const RIVER_NAMES=${JSON.stringify(RIVER_NAMES)};const RIVER_NONE=${RIVER_NONE};const RIVER_STREAM=${RIVER_STREAM};const RIVER_TRIBUTARY=${RIVER_TRIBUTARY};const RIVER_MAJOR=${RIVER_MAJOR};const RIVER_GREAT=${RIVER_GREAT};${pureCode}return{generateWorld,createTerritory,stepTerritory,yearStr};`;
const factory=new Function('computeRivers','generateResources','tileResourceSummary','dominantResource','RESOURCES','RES_BY_ID','generateTectonicWorld','solveWind','solveMoisture','EARTH_ELEV','EARTH_W','EARTH_H','decodeEarth','sampleEarth','isRealWindAvailable','fillRealWind',fnBody);
const fns=factory(computeRivers,generateResources,tileResourceSummary,dominantResource,RESOURCES,RES_BY_ID,generateTectonicWorld,solveWind,solveMoisture,EARTH_ELEV,EARTH_W,EARTH_H,decodeEarth,sampleEarth,isRealWindAvailable,fillRealWind);
const{generateWorld,createTerritory,stepTerritory,yearStr}=fns;
const world=generateWorld(1920,960,1234,'earth_sim',0.78);
let cur=createTerritory(world);
// Americas are roughly x=100-500 on 1920-wide map. Check if any known coast falls there.
for(let step=0;step<=800;step++){
  cur=stepTerritory(cur,world);
  if(step%50===0){
    let kc=0,kcAmericas=0,alive=0,maxNav=0;
    for(let i=0;i<cur.tribeSizes.length;i++){if(cur.tribeSizes[i]<=0)continue;alive++;
      maxNav=Math.max(maxNav,cur.tribeKnowledge[i].navigation);
      const coasts=cur.tribeKnownCoasts[i];if(!coasts)continue;
      kc+=coasts.length;
      // Check if any known coast is in the Americas (x roughly 100-500)
      for(const c of coasts){if(c.x>=100&&c.x<=500)kcAmericas++;}}
    console.log(`Step ${step} (${yearStr(step)}): ${alive}t ${kc}kc maxNav=${maxNav.toFixed(2)} Americas:${kcAmericas}`);
  }
}

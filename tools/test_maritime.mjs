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

console.log('Generating Earth Sim...');
const world = generateWorld(1920,960,1234,'earth_sim',0.78);
let cur = createTerritory(world);

// Track voyage attempts and successes
let totalVoyageAttempts=0,totalVoyageSuccess=0;

for(let step=0;step<=800;step++){
  cur=stepTerritory(cur,world);
  if(step%100===0||step===50||step===200||step===400){
    const yr=yearStr(step);
    let totalPorts=0,totalKnown=0,maxNav=0,tribesWithPorts=0;
    let tribesNav03=0,tribesNav05=0,tribesNav07=0;
    let totalNavSum=0,alive=0;
    
    // Check which continents have tribes
    // Simple: check if tribes exist in different X-ranges (representing continents)
    const xRanges=new Set();
    
    for(let i=0;i<cur.tribeSizes.length;i++){
      if(cur.tribeSizes[i]<=0)continue;
      alive++;
      const k=cur.tribeKnowledge[i];
      const nav=k.navigation;
      totalNavSum+=nav;
      if(nav>maxNav)maxNav=nav;
      if(nav>0.3)tribesNav03++;
      if(nav>0.5)tribesNav05++;
      if(nav>0.7)tribesNav07++;
      const ports=cur.tribePorts[i]?cur.tribePorts[i].length:0;
      totalPorts+=ports;
      if(ports>0)tribesWithPorts++;
      const kc=cur.tribeKnownCoasts[i]?cur.tribeKnownCoasts[i].length:0;
      totalKnown+=kc;
      
      // Track continent coverage via center positions
      if(cur.tribeCenters[i]&&cur.tribeCenters[i][0]){
        const cx=cur.tribeCenters[i][0].x;
        xRanges.add(Math.floor(cx/200));// divide map into ~10 zones
      }
    }
    
    const avgNav=alive>0?(totalNavSum/alive).toFixed(2):'0';
    
    console.log(`=== Step ${step} (${yr}) ===`);
    console.log(`  Nav: max=${maxNav.toFixed(2)} avg=${avgNav} | nav>0.3: ${tribesNav03} | nav>0.5: ${tribesNav05} | nav>0.7: ${tribesNav07}`);
    console.log(`  Ports: ${totalPorts} across ${tribesWithPorts}/${alive} tribes`);
    console.log(`  Known coasts: ${totalKnown} total`);
    console.log(`  Map zones with tribes: ${[...xRanges].sort((a,b)=>a-b).join(',')}`);
    
    // Check the voyage code: what's the max range and chance?
    if(maxNav>0.05){
      const maxRange=Math.floor(3+maxNav*50);
      console.log(`  Max voyage range: ${maxRange} tiles`);
    }
    console.log();
  }
}

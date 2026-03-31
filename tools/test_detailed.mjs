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
const RIVER_NAMES = ['','Stream','Tributary','Major River','Great River'];
const generateTectonicWorld = () => null;
const isRealWindAvailable = () => false;
const fillRealWind = () => {};
const fnBody = `const RIVER_NAMES=${JSON.stringify(RIVER_NAMES)};const RIVER_NONE=${RIVER_NONE};const RIVER_STREAM=${RIVER_STREAM};const RIVER_TRIBUTARY=${RIVER_TRIBUTARY};const RIVER_MAJOR=${RIVER_MAJOR};const RIVER_GREAT=${RIVER_GREAT};${pureCode}return{generateWorld,createTerritory,stepTerritory,stepToYear,yearStr};`;
const factory = new Function('computeRivers','generateResources','tileResourceSummary','dominantResource','RESOURCES','RES_BY_ID','generateTectonicWorld','solveWind','solveMoisture','EARTH_ELEV','EARTH_W','EARTH_H','decodeEarth','sampleEarth','isRealWindAvailable','fillRealWind',fnBody);
const fns = factory(computeRivers,generateResources,tileResourceSummary,dominantResource,RESOURCES,RES_BY_ID,generateTectonicWorld,solveWind,solveMoisture,EARTH_ELEV,EARTH_W,EARTH_H,decodeEarth,sampleEarth,isRealWindAvailable,fillRealWind);
const{generateWorld,createTerritory,stepTerritory,yearStr}=fns;

console.log('Generating Earth Sim...');
const world = generateWorld(1920,960,1234,'earth_sim',0.78);
const ter = createTerritory(world);
console.log(`${ter.tribes} starting tribes, ${ter.landCount} land tiles\n`);

let cur = ter;
for(let step=0;step<=1000;step++){
  cur=stepTerritory(cur,world);
  if(step%100===0||step===50||step===150||step===250||step===350){
    let alive=0,totalPop=0,totalTiles=0,maxMt=0,maxAg=0,maxNav=0,maxOrg=0,maxTr=0;
    let totalPorts=0,totalKnownCoasts=0;
    let personalities={};
    let tribesWithNav=0,tribesWithTrade=0,tribesWithIron=0;
    let largest=0,smallest=Infinity;
    
    for(let i=0;i<cur.tribeSizes.length;i++){
      if(cur.tribeSizes[i]<=0)continue;
      alive++;
      const sz=cur.tribeSizes[i];
      totalPop+=cur.tribePopulation[i];
      totalTiles+=sz;
      if(sz>largest)largest=sz;
      if(sz<smallest)smallest=sz;
      const k=cur.tribeKnowledge[i];
      maxMt=Math.max(maxMt,k.metallurgy);
      maxAg=Math.max(maxAg,k.agriculture);
      maxNav=Math.max(maxNav,k.navigation);
      maxOrg=Math.max(maxOrg,k.organization);
      maxTr=Math.max(maxTr,k.trade);
      if(k.navigation>0.3)tribesWithNav++;
      if(k.trade>0.3)tribesWithTrade++;
      if(k.metallurgy>0.5)tribesWithIron++;
      const ports=cur.tribePorts[i]?cur.tribePorts[i].length:0;
      totalPorts+=ports;
      const kc=cur.tribeKnownCoasts[i]?cur.tribeKnownCoasts[i].length:0;
      totalKnownCoasts+=kc;
      const b=cur.tribeBudget[i];
      if(b&&b.personality){personalities[b.personality]=(personalities[b.personality]||0)+1;}
    }
    
    const yr=yearStr(step);
    const era=maxMt>0.83?'Industrial':maxMt>0.5?'Iron':maxMt>0.3?'Bronze':maxMt>0.15?'Copper':'Stone';
    const coverage=(totalTiles/cur.landCount*100).toFixed(0);
    const avgSize=alive>0?(totalTiles/alive).toFixed(0):'0';
    
    console.log(`=== Step ${step} (${yr}) [${era}] ===`);
    console.log(`  Tribes: ${alive} (largest:${largest} smallest:${smallest} avg:${avgSize})`);
    console.log(`  Coverage: ${totalTiles}/${cur.landCount} (${coverage}%) | Pop: ${(totalPop/1000).toFixed(0)}M`);
    console.log(`  Knowledge max: Ag${(maxAg*100).toFixed(0)} Mt${(maxMt*100).toFixed(0)} Nav${(maxNav*100).toFixed(0)} Org${(maxOrg*100).toFixed(0)} Tr${(maxTr*100).toFixed(0)}`);
    console.log(`  Maritime: ${totalPorts} ports, ${totalKnownCoasts} known coasts, nav>0.3: ${tribesWithNav}/${alive} tribes`);
    console.log(`  Economy: trade>0.3: ${tribesWithTrade}/${alive} | Iron(mt>0.5): ${tribesWithIron}/${alive}`);
    console.log(`  Personalities: ${JSON.stringify(personalities)}`);
    console.log(`  Spawned total: ${cur._dbgCrystalSpawned||0} | bgPop max: ${cur._dbgMaxBgPop?.toFixed(2)}`);
    console.log();
  }
}

// Debug: check pop vs capacity for largest tribe
const largest = [...Array(cur.tribeSizes.length).keys()].filter(i=>cur.tribeSizes[i]>0).sort((a,b)=>cur.tribeSizes[b]-cur.tribeSizes[a])[0];
if(largest!==undefined){
  const k=cur.tribeKnowledge[largest];
  const str=cur.tribeStrength[largest];
  const ag=k.agriculture,mt=k.metallurgy,cn=k.construction,og=k.organization;
  let em=0.2+ag*0.4+mt*0.25+cn*0.15+og*0.1;
  em+=(Math.max(0,mt-0.7))*(Math.max(0,cn-0.5))*1600;
  const cap=str*em;
  const pop=cur.tribePopulation[largest];
  console.log(`\nDEBUG largest tribe #${largest}: ${cur.tribeSizes[largest]}t str=${str.toFixed(1)} em=${em.toFixed(2)} cap=${cap.toFixed(0)}k pop=${pop.toFixed(0)}k ratio=${(pop/cap).toFixed(2)}`);
  console.log(`  Knowledge: ag=${ag.toFixed(2)} mt=${mt.toFixed(2)} cn=${cn.toFixed(2)} og=${og.toFixed(2)}`);
}

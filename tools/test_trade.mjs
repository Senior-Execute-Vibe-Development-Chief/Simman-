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
const ter = createTerritory(world);
let cur = ter;
for(let step=0;step<=600;step++){
  cur=stepTerritory(cur,world);
  if(step%100===0||step===50||step===200){
    const yr=yearStr(step);
    let totalIncome=0,totalFoodImports=0,totalFoodExports=0,tradingTribes=0;
    let maxIncome=0,maxIncomeTribe=-1;
    for(let i=0;i<cur.tribeSizes.length;i++){
      if(cur.tribeSizes[i]<=0)continue;
      const td=cur.tradeData&&cur.tradeData[i]?cur.tradeData[i]:null;
      if(!td)continue;
      totalIncome+=td.income;
      totalFoodImports+=td.foodImports;
      totalFoodExports+=td.foodExports;
      if(td.partners>0)tradingTribes++;
      if(td.income>maxIncome){maxIncome=td.income;maxIncomeTribe=i;}
    }
    console.log(`=== Step ${step} (${yr}) ===`);
    console.log(`  Trading tribes: ${tradingTribes}`);
    console.log(`  Total trade income: ${totalIncome.toFixed(1)}`);
    console.log(`  Food imports: ${totalFoodImports.toFixed(2)} | Food exports: ${totalFoodExports.toFixed(2)}`);
    if(maxIncomeTribe>=0){
      const td=cur.tradeData[maxIncomeTribe];
      const pers=cur.tribeBudget[maxIncomeTribe]?cur.tribeBudget[maxIncomeTribe].personality:'';
      console.log(`  Richest trader: #${maxIncomeTribe} [${pers}] income=${maxIncome.toFixed(1)} partners=${td.partners}`);
      const imports=Object.entries(td.imports).filter(([k,v])=>v>0.01).map(([k,v])=>`${k}:${v.toFixed(2)}`).join(' ');
      const exports=Object.entries(td.exports).filter(([k,v])=>v>0.01).map(([k,v])=>`${k}:${v.toFixed(2)}`).join(' ');
      if(imports)console.log(`    Imports: ${imports}`);
      if(exports)console.log(`    Exports: ${exports}`);
    }
    console.log();
  }
}

import { generateWorld } from "../src/worldgen.js";
import { computeRivers } from "../src/riverGen.js";
import { cropSuitability } from "../src/cropGen.js";
import { generateResources } from "../src/resourceGen.js";
import { initPeopleSim, stepPeopleSim } from "../src/peopleSim/index.js";

const W=+(process.argv[4]||480),H=W>>1,N=W*H;
const SEED=+(process.argv[2]||8817);
const CKPTS=(process.argv[3]||"12000,20000").split(",").map(Number);
const w=generateWorld(W,H,SEED,"earth_sim",0.78,true,false,{});
const tE=new Float32Array(N),tT=new Float32Array(N),tM=new Float32Array(N),tC=new Uint8Array(N),tCrop=new Float32Array(N);
for(let i=0;i<N;i++){tE[i]=w.elevation[i];tT[i]=w.temperature[i];tM[i]=w.moisture[i];tC[i]=w.coastal[i]||0;}
const rivers=computeRivers(W,H,tE,tM,tT);w.rivers=rivers;
for(let i=0;i<N;i++)tCrop[i]=cropSuitability(tT[i],tM[i],tE[i],tC[i],rivers.riverMag?rivers.riverMag[i]:0);
w.deposits=generateResources(W,H,tE,tT,tM,tC,w,SEED,rivers);
const world=initPeopleSim(w,{seed:SEED,tCrop,tileRes:1,deposits:w.deposits});

const sum=a=>a.reduce((x,y)=>x+y,0);
const mean=a=>a.length?sum(a)/a.length:0;
const med=a=>{if(!a.length)return 0;const s=[...a].sort((x,y)=>x-y);return s[s.length>>1];};
function gini(a){if(a.length<2)return 0;const s=[...a].sort((x,y)=>x-y);let c=0;for(let i=0;i<s.length;i++)c+=(2*(i+1)-s.length-1)*s[i];return c/(s.length*sum(s));}

let step=0;
for(const ck of CKPTS){
  while(step<ck){stepPeopleSim(world,1);step++;}
  const co=world._countryOwner||world._countryClaim;     // per-tile country id (-1 = unclaimed/ocean)
  const fert=world.fert, elev=world.elev;
  const size=new Map(), fsum=new Map();
  for(let ti=0;ti<N;ti++){const c=co[ti];if(c<0||(elev[ti]||0)<=0)continue;size.set(c,(size.get(c)||0)+1);fsum.set(c,(fsum.get(c)||0)+(fert?fert[ti]:0));}
  const members=new Map(), capOrg=new Map();
  for(const s of world.settlements){if(s.mode!=="settled"||s.countryId<0)continue;const c=s.countryId;members.set(c,(members.get(c)||0)+1);const o=(s.knowledge&&s.knowledge.organization)||0;if(!capOrg.has(c)||o>capOrg.get(c))capOrg.set(c,o);}
  const rows=[...size.keys()].map(c=>({sz:size.get(c),mem:members.get(c)||0,org:capOrg.get(c)||0,mf:(fsum.get(c)||0)/Math.max(1,size.get(c))}));
  rows.sort((a,b)=>b.sz-a.sz);
  const sizes=rows.map(r=>r.sz), nC=sizes.length, totalClaimed=sum(sizes);
  const medS=med(sizes), maxS=sizes[0]||0;
  const settled=world.settlements.filter(s=>s.mode==="settled").length;
  console.log(`\nstep ${step}: ${nC} countries | claimed ${totalClaimed} (${(100*totalClaimed/N).toFixed(1)}% of map) | ${settled} settled`);
  console.log(`  size  median=${medS} mean=${mean(sizes).toFixed(0)} max=${maxS} max/med=${(maxS/Math.max(1,medS)).toFixed(1)} gini=${gini(sizes).toFixed(2)}`);
  console.log(`  top5  ${sizes.slice(0,5).join(", ")}  (share ${(100*sum(sizes.slice(0,5))/totalClaimed).toFixed(0)}% of claimed)`);
  const t0=rows[0]||{sz:0,mem:0,org:0,mf:0};
  console.log(`  #1    size=${t0.sz} members=${t0.mem} capOrg=${t0.org.toFixed(2)} meanFert=${t0.mf.toFixed(2)}`);
  const tpm=rows.map(r=>r.sz/Math.max(1,r.mem));
  console.log(`  median members=${med(rows.map(r=>r.mem))} | tiles/member median=${med(tpm).toFixed(1)} | median capOrg=${med(rows.map(r=>r.org)).toFixed(2)}`);
  const k=Math.max(1,nC>>3);                              // top / bottom eighth
  const big=rows.slice(0,k), small=rows.slice(-k);
  console.log(`  BIG vs SMALL (top vs bottom 1/8, ${k} each):`);
  console.log(`     size    ${med(big.map(r=>r.sz))}  vs  ${med(small.map(r=>r.sz))}`);
  console.log(`     members ${med(big.map(r=>r.mem))}  vs  ${med(small.map(r=>r.mem))}`);
  console.log(`     capOrg  ${med(big.map(r=>r.org)).toFixed(2)}  vs  ${med(small.map(r=>r.org)).toFixed(2)}`);
  console.log(`     meanFert ${med(big.map(r=>r.mf)).toFixed(2)}  vs  ${med(small.map(r=>r.mf)).toFixed(2)}   (low = expanded into poor/low-resistance land)`);
}

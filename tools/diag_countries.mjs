import { generateWorld } from "../src/sim/worldgen.js";
import { computeRivers } from "../src/sim/riverGen.js";
import { cropSuitability } from "../src/sim/cropGen.js";
import { generateResources } from "../src/sim/resourceGen.js";
import { initPeopleSim, stepPeopleSim } from "../src/sim/peopleSim/index.js";

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
  // Cross-sea reach: landmass components (4-neighbour, x wraps), then count
  // realms whose CLAIM spans ≥2 components (≥3 tiles each, to skip noise) and
  // realms with MEMBERS on ≥2 components. Undercounts same-landmass gulf
  // crossings (Eurasia+Africa can be one component) — it's an island/overseas signal.
  if(!world._diagComp){
    const comp=new Int32Array(N).fill(-1); const cstack=[];
    for(let i=0;i<N;i++){
      if(comp[i]>=0||world.elev[i]<=0)continue;
      cstack.length=0;cstack.push(i);comp[i]=i;
      while(cstack.length){const ti=cstack.pop();const y=(ti/W)|0,x=ti-y*W;
        const ns=[y*W+((x+1)%W),y*W+((x-1+W)%W),y>0?ti-W:-1,y<H-1?ti+W:-1];
        for(const ni of ns){if(ni<0||comp[ni]>=0||world.elev[ni]<=0)continue;comp[ni]=i;cstack.push(ni);}}
    }
    world._diagComp=comp;
  }
  {
    const comp=world._diagComp, claimComps=new Map(), memComps=new Map();
    for(let ti=0;ti<N;ti++){const c=co[ti];if(c<0||world.elev[ti]<=0)continue;
      let m=claimComps.get(c);if(!m){m=new Map();claimComps.set(c,m);}m.set(comp[ti],(m.get(comp[ti])||0)+1);}
    for(const s of world.settlements){if(s.mode!=="settled"||s.countryId<0)continue;
      const ti=(s.pos.y|0)*W+(s.pos.x|0);let st=memComps.get(s.countryId);if(!st){st=new Set();memComps.set(s.countryId,st);}st.add(comp[ti]);}
    let claimSpan=0,memSpan=0,best=null;
    for(const [c,m] of claimComps){const sig=[...m.values()].filter(v=>v>=3);
      if(sig.length>=2){claimSpan++;const tot=sig.reduce((a,b)=>a+b,0);if(!best||tot>best.tot)best={c,tot,parts:sig.length};}}
    for(const st of memComps.values())if(st.size>=2)memSpan++;
    console.log(`  cross-sea  claims spanning ≥2 landmasses: ${claimSpan}${best?` (best: ${best.tot} tiles over ${best.parts})`:""} | member-spanning realms: ${memSpan}`);
  }
  const k=Math.max(1,nC>>3);                              // top / bottom eighth
  const big=rows.slice(0,k), small=rows.slice(-k);
  console.log(`  BIG vs SMALL (top vs bottom 1/8, ${k} each):`);
  console.log(`     size    ${med(big.map(r=>r.sz))}  vs  ${med(small.map(r=>r.sz))}`);
  console.log(`     members ${med(big.map(r=>r.mem))}  vs  ${med(small.map(r=>r.mem))}`);
  console.log(`     capOrg  ${med(big.map(r=>r.org)).toFixed(2)}  vs  ${med(small.map(r=>r.org)).toFixed(2)}`);
  console.log(`     meanFert ${med(big.map(r=>r.mf)).toFixed(2)}  vs  ${med(small.map(r=>r.mf)).toFixed(2)}   (low = expanded into poor/low-resistance land)`);
}

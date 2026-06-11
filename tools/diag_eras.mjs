import { generateWorld } from "../src/worldgen.js";
import { computeRivers } from "../src/riverGen.js";
import { cropSuitability } from "../src/cropGen.js";
import { generateResources } from "../src/resourceGen.js";
import { initPeopleSim, stepPeopleSim } from "../src/peopleSim/index.js";
import { techState, ERAS } from "../src/peopleSim/tech.js";
const W=+(process.argv[4]||480),H=W>>1,N=W*H;
const SEED=+(process.argv[2]||8817);
const CKPTS=(process.argv[3]||"8000,12000,16000,20000,24000").split(",").map(Number);
const w=generateWorld(W,H,SEED,"earth_sim",0.78,true,false,{});
const tE=new Float32Array(N),tT=new Float32Array(N),tM=new Float32Array(N),tC=new Uint8Array(N),tCrop=new Float32Array(N);
for(let i=0;i<N;i++){tE[i]=w.elevation[i];tT[i]=w.temperature[i];tM[i]=w.moisture[i];tC[i]=w.coastal[i]||0;}
const rivers=computeRivers(W,H,tE,tM,tT);w.rivers=rivers;
for(let i=0;i<N;i++)tCrop[i]=cropSuitability(tT[i],tM[i],tE[i],tC[i],rivers.riverMag?rivers.riverMag[i]:0);
w.deposits=generateResources(W,H,tE,tT,tM,tC,w,SEED,rivers);
const world=initPeopleSim(w,{seed:SEED,tCrop,tileRes:1,deposits:w.deposits});
const med=(a)=>{if(!a.length)return 0;const s=[...a].sort((x,y)=>x-y);return s[s.length>>1];};
let step=0;
for(const ck of CKPTS){
  while(step<ck){stepPeopleSim(world,1);step++;}
  const S=world.settlements.filter(s=>s.mode==="settled"&&s.knowledge);
  const eraH=[0,0,0,0,0,0,0]; const met=[],org=[],con=[],nav=[]; let oreN=0,reachN=0,awareGtCap=0;
  for(const s of S){
    const e=techState(s.knowledge).era; eraH[e]++;
    const m=s.knowledge.metallurgy||0, c=s._metalCap??0;
    met.push(m); org.push(s.knowledge.organization||0); con.push(s.knowledge.construction||0); nav.push(s.knowledge.navigation||0);
    if(c>0)oreN++; if(s._tradeReach&&s._tradeReach.size>0)reachN++; if(m>c+0.1)awareGtCap++;
  }
  console.log(`\nstep ${step}: ${S.length} settled | ore-access ${oreN} | connected ${reachN} | aware>cap ${awareGtCap}`);
  console.log(`  eras  `+ERAS.map((n,i)=>`${n.split(" ")[0]}:${eraH[i]}`).join("  "));
  console.log(`  med   met=${med(met).toFixed(2)} org=${med(org).toFixed(2)} con=${med(con).toFixed(2)} nav=${med(nav).toFixed(2)}`);
  console.log(`  max   met=${Math.max(...met).toFixed(2)} org=${Math.max(...org).toFixed(2)} con=${Math.max(...con).toFixed(2)} nav=${Math.max(...nav).toFixed(2)}`);
}

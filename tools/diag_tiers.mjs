import { generateWorld } from "../src/worldgen.js";
import { computeRivers } from "../src/riverGen.js";
import { cropSuitability } from "../src/cropGen.js";
import { generateResources } from "../src/resourceGen.js";
import { initPeopleSim, stepPeopleSim } from "../src/peopleSim/index.js";
import { techState, ERAS } from "../src/peopleSim/tech.js";
const W=480,H=240,N=W*H,PS=1000;
const CHECKS=(process.argv[2]||"4000,9720,16000").split(",").map(Number);
const SEED=+(process.argv[3]||8817);
const MAX=Math.max(...CHECKS);
const w=generateWorld(W,H,SEED,"earth_sim",0.78,true,false,{});
const tE=new Float32Array(N),tT=new Float32Array(N),tM=new Float32Array(N),tC=new Uint8Array(N),tCrop=new Float32Array(N);
for(let i=0;i<N;i++){tE[i]=w.elevation[i];tT[i]=w.temperature[i];tM[i]=w.moisture[i];tC[i]=w.coastal[i]||0;}
const rivers=computeRivers(W,H,tE,tM,tT);w.rivers=rivers;
for(let i=0;i<N;i++)tCrop[i]=cropSuitability(tT[i],tM[i],tE[i],tC[i],rivers.riverMag?rivers.riverMag[i]:0);
w.deposits=generateResources(W,H,tE,tT,tM,tC,w,SEED,rivers);
const world=initPeopleSim(w,{seed:SEED,tCrop,tileRes:1,deposits:w.deposits});
const TN=["FarmReg","Town","City","Metro"];
function snap(label){
  const cs=world.settlements.filter(s=>s.mode==="settled");
  const cnt=[0,0,0,0],big=[0,0,0,0];let tot=0;
  for(const s of cs){const t=s.tier|0;cnt[t]++;if(s.people>big[t])big[t]=s.people;tot+=s.people;}
  const top=cs.slice().sort((a,b)=>b.people-a.people).slice(0,6)
    .map(s=>`${(s.people*PS/1e6).toFixed(2)}M·${TN[s.tier|0]}·${ERAS[techState(s.knowledge||{}).era].slice(0,4)}`);
  console.log(`${label}: pop ${(tot*PS/1e6).toFixed(1)}M  | counts FR:${cnt[0]} Tn:${cnt[1]} Ci:${cnt[2]} Me:${cnt[3]}  | biggest/tier ${big.map((b,i)=>b?`${TN[i].slice(0,2)}=${(b*PS/1e6).toFixed(2)}M`:`${TN[i].slice(0,2)}=-`).join(" ")}`);
  console.log(`        top6: ${top.join("  ")}`);
}
for(let s=1;s<=MAX;s++){stepPeopleSim(world,1);if(CHECKS.includes(s))snap(`step ${s}`);}

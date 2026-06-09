import { generateWorld } from "../src/worldgen.js";
import { computeRivers } from "../src/riverGen.js";
import { cropSuitability } from "../src/cropGen.js";
import { generateResources } from "../src/resourceGen.js";
import { initPeopleSim, stepPeopleSim } from "../src/peopleSim/index.js";
import { techEffects, techState } from "../src/peopleSim/tech.js";
const W=480,H=240,N=W*H;
const STEP=+(process.argv[2]||9720), SEED=+(process.argv[3]||8817);
const w=generateWorld(W,H,SEED,"earth_sim",0.78,true,false,{});
const tE=new Float32Array(N),tT=new Float32Array(N),tM=new Float32Array(N),tC=new Uint8Array(N),tCrop=new Float32Array(N);
for(let i=0;i<N;i++){tE[i]=w.elevation[i];tT[i]=w.temperature[i];tM[i]=w.moisture[i];tC[i]=w.coastal[i]||0;}
const rivers=computeRivers(W,H,tE,tM,tT);w.rivers=rivers;
for(let i=0;i<N;i++)tCrop[i]=cropSuitability(tT[i],tM[i],tE[i],tC[i],rivers.riverMag?rivers.riverMag[i]:0);
w.deposits=generateResources(W,H,tE,tT,tM,tC,w,SEED,rivers);
const world=initPeopleSim(w,{seed:SEED,tCrop,tileRes:1,deposits:w.deposits});
for(let s=1;s<=STEP;s++)stepPeopleSim(world,1);
const S=world.settlements.filter(s=>s.mode==="settled"&&s.knowledge);
// aware = metallurgy KNOWLEDGE; cap = s._metalCap (ore capability)
let awareGtCap=0, connected=0, orePoorConn=0;
const examples=[];
for(const s of S){
  const aware=s.knowledge.metallurgy||0, cap=s._metalCap??0;
  const reach=s._tradeReach?s._tradeReach.size:0;
  if(reach>0)connected++;
  if(aware>cap+0.1){
    awareGtCap++;
    if(reach>0&&cap<0.4&&examples.length<6){
      const milActual=s._techEff?s._techEff.military:null;
      const milRaw=techEffects(s.knowledge,1).military;
      const milCap=techEffects({...s.knowledge,metallurgy:Math.min(aware,cap)},1).military;
      const eraAware=techState(s.knowledge).era;
      const eraCap=techState({...s.knowledge,metallurgy:cap}).era;
      examples.push({id:s.id,reach,aware:+aware.toFixed(2),cap:+cap.toFixed(2),
        milActual:+(milActual||0).toFixed(2),milRaw:+milRaw.toFixed(2),milCap:+milCap.toFixed(2),
        eraAwareTree:eraAware,eraIfCapBound:eraCap});
    }
    if(reach>0&&cap<0.4)orePoorConn++;
  }
}
console.log(`step ${STEP} seed ${SEED}: ${S.length} settled, ${connected} connected`);
console.log(`AWARENESS > capability (knows more metallurgy than its ore can forge): ${awareGtCap}`);
console.log(`  ...of which connected & ore-poor (cap<0.4): ${orePoorConn}  (the "knows iron, holds no ore" case)`);
console.log(`Examples (milActual should match milCap, NOT milRaw — payoff stays ore-gated):`);
for(const e of examples)console.log("  ",JSON.stringify(e));

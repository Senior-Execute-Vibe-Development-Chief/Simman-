// Does the NATIONAL FORCE LAYER actually bite? Samples every war-pass over a
// window and reports, per number of simultaneous OFFENSIVE fronts, how throttled
// each realm's offence is (offMul) — and how throttled realms are when invaded
// (offence + defence at once). If the layer works, offMul falls as fronts rise,
// and a realm pinned defending can't also conquer at full strength.
//   node tools/probe_war.mjs [step] [seed] [W] [H] [window]
import { generateWorld } from "../src/worldgen.js";
import { computeRivers } from "../src/riverGen.js";
import { generateResources } from "../src/resourceGen.js";
import { initPeopleSim, stepPeopleSim } from "../src/peopleSim/index.js";
const STEP=+(process.argv[2]||9000), SEED=+(process.argv[3]||857691), W=+(process.argv[4]||1920), H=+(process.argv[5]||960), WIN=+(process.argv[6]||3000);
const w=generateWorld(W,H,SEED,"earth_sim",0.78,true,false,{});
const tCrop=new Float32Array(W*H),tC=new Uint8Array(W*H),tE=new Float32Array(W*H),tT=new Float32Array(W*H),tM=new Float32Array(W*H);
function tf(t,m,e){if(e>0.45)return 0.01;const tF=Math.min(1,t*1.5)*Math.min(1,1-Math.pow(Math.max(0,t-0.7),2)*4);const mF=Math.exp(-((m-0.45)*(m-0.45))/(2*0.22*0.22));return Math.max(0.01,tF*mF*(1-Math.max(0,e-0.15)*3));}
for(let i=0;i<W*H;i++){tE[i]=w.elevation[i];tT[i]=w.temperature[i];tM[i]=w.moisture[i];tC[i]=w.coastal[i]||0;tCrop[i]=tf(w.temperature[i],w.moisture[i],w.elevation[i]);}
w.rivers=computeRivers(W,H,tE,tM,tT); w.deposits=generateResources(W,H,tE,tT,tM,tC,w,w._seed||SEED,w.rivers);
const world=initPeopleSim(w,{seed:w._seed||SEED,tCrop,tileRes:1,deposits:w.deposits});

const INTV=50;   // CONQUEST_INTERVAL
stepPeopleSim(world, Math.max(0, STEP-WIN));   // warm up

const hist=new Map();   // EFFECTIVE-fronts bucket (1,2,3=3+) → {n, sumMain}
const bump=(b,main)=>{let r=hist.get(b);if(!r)hist.set(b,r={n:0,sumMain:0});r.n++;r.sumMain+=main;};
let invN=0, invMul=0;       // realms attacking WHILE invaded (offence+defence)
let cleanN=0, cleanMul=0;   // realms attacking with a clear rear
let maxEff=0, maxBorders=0, sumBorders=0, attackerPasses=0, samples=0;
for(let t=Math.max(0,STEP-WIN); t<STEP; t+=INTV){
  stepPeopleSim(world, INTV); samples++;
  for(const c of world.countries.values()){
    if(c._warStamp!==world.step) continue;            // only realms engaged THIS pass
    const borders=c._offFronts||0; if(borders<=0) continue;   // only ones with a favourable border (attacking)
    const eff=c._effFronts||0, main=c._mainOffMul||0;
    attackerPasses++; sumBorders+=borders;
    if(borders>maxBorders) maxBorders=borders;
    if(eff>maxEff) maxEff=eff;
    bump(Math.min(3,Math.max(1,eff)), main);
    if((c._defLoad||0)>0){ invN++; invMul+=main; } else { cleanN++; cleanMul+=main; }
  }
}
console.log(`\n=== war dynamics, seed ${SEED}, steps ${STEP-WIN}-${STEP} (${samples} passes) ===`);
console.log(`EFFECTIVE offensive fronts (can actually push) per attacking realm-pass:`);
for(let b=1;b<=3;b++){ const r=hist.get(b); if(!r) continue;
  const lbl=b===3?"3+ eff":`${b} eff `;
  console.log(`  ${lbl} fronts |  ${String(r.n).padStart(6)} realm-passes   main-effort offMul ${(r.sumMain/r.n).toFixed(2)}`); }
console.log(`\nmain-effort capacity:  CLEAR rear ${cleanN?(cleanMul/cleanN).toFixed(2):"-"} (${cleanN})   |   while INVADED ${invN?(invMul/invN).toFixed(2):"-"} (${invN})`);
console.log(`mean border fronts (geographic) per attacker: ${(sumBorders/Math.max(1,attackerPasses)).toFixed(1)}  (max ${maxBorders})`);
console.log(`max EFFECTIVE fronts a realm pushed at once: ${maxEff}  ← concentration caps real offensives`);

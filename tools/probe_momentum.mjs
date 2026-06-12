// Track the biggest empire over time + its momentum, to see rise-and-shatter.
import { generateWorld } from "../src/sim/worldgen.js";
import { computeRivers } from "../src/sim/riverGen.js";
import { generateResources } from "../src/sim/resourceGen.js";
import { initPeopleSim, stepPeopleSim } from "../src/sim/peopleSim/index.js";

const STEPS=+(process.argv[2]||30000), SEED=+(process.argv[3]||8817);
const W=+(process.env.EARTH_W||480), H=+(process.env.EARTH_H||240), TW=W, TH=H;
const w=generateWorld(W,H,SEED,"earth_sim",0.78,true,false,{});
const tE=new Float32Array(TW*TH),tT=new Float32Array(TW*TH),tM=new Float32Array(TW*TH),tC=new Uint8Array(TW*TH),tF=new Float32Array(TW*TH);
function fert(t,m,e){if(e>0.45)return 0.01;const a=Math.min(1,t*1.5)*Math.min(1,1-Math.pow(Math.max(0,t-0.7),2)*4);const b=Math.exp(-((m-0.45)**2)/(2*0.22*0.22));return Math.max(0.01,a*b*(1-Math.max(0,e-0.15)*3));}
for(let y=0;y<TH;y++)for(let x=0;x<TW;x++){const i=y*W+x;tE[i]=w.elevation[i];tT[i]=w.temperature[i];tM[i]=w.moisture[i];tC[i]=w.coastal[i]||0;tF[i]=fert(w.temperature[i],w.moisture[i],w.elevation[i]);}
w.rivers=computeRivers(TW,TH,tE,tM,tT);
w.deposits=generateResources(TW,TH,tE,tT,tM,tC,w,w._seed||SEED,w.rivers);
const world=initPeopleSim(w,{seed:w._seed||SEED,tCrop:tF,tileRes:1,deposits:w.deposits});

// Track the single largest empire each sample; flag big drops (shatter).
let prevMax=0;
console.log("step   maxMembers  momentum(of max)  label   #countries  shatters(>=30% drop)");
let shatters=0;
for(let s=1;s<=STEPS;s++){
  stepPeopleSim(world,1);
  if(s%2500===0){
    let big=null,bm=0;
    for(const c of world.countries.values()){ if(c.members.length>bm){bm=c.members.length;big=c;} }
    const gov=world.governments&&big&&world.governments.get(big.id);
    const mom=(big&&big._momentum)||0;
    const drop=prevMax>0?(prevMax-bm)/prevMax:0;
    if(drop>=0.30) shatters++;
    const lbl=(big&&big.personality&&big.personality._label)||"?";
    console.log(`${String(s).padStart(5)}   ${String(bm).padStart(8)}   ${mom.toFixed(1).padStart(10)}     ${lbl.padEnd(12)} ${String(world.countries.size).padStart(4)}      ${drop>=0.30?"SHATTER -"+(drop*100).toFixed(0)+"%":""}`);
    prevMax=bm;
  }
}
console.log(`\ntotal shatter events (top empire lost >=30% members in a 2500-step window): ${shatters}`);

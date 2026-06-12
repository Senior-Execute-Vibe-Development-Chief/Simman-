// Enclave counter — measures the "parasitic statelet" artefact directly.
// Counts countries whose territory is ≥ FRAC bordered by a SINGLE other country
// and never touches sea/edge (a speck marooned inside a neighbour). Run with
// SIM_CITY_ENCLAVE=0 (off) vs default (fix on) to see the fix's effect.
//   node tools/probe_enclaves.mjs [step] [seed] [W] [H]
import { generateWorld } from "../src/sim/worldgen.js";
import { computeRivers } from "../src/sim/riverGen.js";
import { generateResources } from "../src/sim/resourceGen.js";
import { initPeopleSim, stepPeopleSim, peopleSimStats } from "../src/sim/peopleSim/index.js";
const STEP=+(process.argv[2]||10000), SEED=+(process.argv[3]||857691), W=+(process.argv[4]||1920), H=+(process.argv[5]||960);
const w=generateWorld(W,H,SEED,"earth_sim",0.78,true,false,{});
const tCrop=new Float32Array(W*H),tC=new Uint8Array(W*H),tE=new Float32Array(W*H),tT=new Float32Array(W*H),tM=new Float32Array(W*H);
function tf(t,m,e){if(e>0.45)return 0.01;const a=Math.min(1,Math.max(0,(t-0.57)/0.13))*Math.min(1,1-Math.pow(Math.max(0,t-0.88),2)*1.5);const b=Math.exp(-((m-0.45)**2)/(2*0.22*0.22));return Math.max(0.01,a*b*(1-Math.max(0,e-0.15)*3));}
for(let i=0;i<W*H;i++){tE[i]=w.elevation[i];tT[i]=w.temperature[i];tM[i]=w.moisture[i];tC[i]=w.coastal[i]||0;tCrop[i]=tf(w.temperature[i],w.moisture[i],w.elevation[i]);}
w.rivers=computeRivers(W,H,tE,tM,tT); w.deposits=generateResources(W,H,tE,tT,tM,tC,w,w._seed||SEED,w.rivers);
const world=initPeopleSim(w,{seed:w._seed||SEED,tCrop,tileRes:1,deposits:w.deposits});
stepPeopleSim(world, STEP);

const co=world._countryOwner, elev=world.elev, tw=world.tw, th=world.th, N=world.N;
// Per-country: border-tile count by neighbour country, and whether it touches sea/edge.
const bord=new Map(), edge=new Set(), area=new Map();
for(let ti=0;ti<N;ti++){const c=co[ti]; if(c<0)continue; area.set(c,(area.get(c)||0)+1);
  const ty=(ti/tw)|0,tx=ti-ty*tw,xm=tx===0?tw-1:tx-1,xp=tx===tw-1?0:tx+1;
  if(ty===0||ty===th-1)edge.add(c);
  const ns=[ty*tw+xm,ty*tw+xp,ty>0?ti-tw:-1,ty<th-1?ti+tw:-1];
  for(let k=0;k<4;k++){const ni=ns[k]; if(ni<0){continue;} const nc=co[ni];
    if(elev[ni]<=0){edge.add(c);continue;}            // sea = open border
    if(nc===c||nc<0)continue;                          // self or wild
    let m=bord.get(c); if(!m){m=new Map();bord.set(c,m);} m.set(nc,(m.get(nc)||0)+1);
  }
}
let enclaves=0, total=0;
for(const c of (world.countries?world.countries.keys():[])){
  total++;
  if(edge.has(c))continue;                             // touches sea/edge → not enclosed
  const m=bord.get(c); if(!m||m.size===0)continue;
  let tot=0,best=0; for(const v of m.values()){tot+=v; if(v>best)best=v;}
  if(tot>0 && best>=tot*0.90) enclaves++;              // ≥90% one neighbour → parasitic enclave
}
const st=peopleSimStats(world);
console.log(`enclaves=${enclaves}  of ${total} countries   (land ${(st.landPct*100).toFixed(0)}%, pop ${st.totalPeople})   CITY_ENCLAVE=${process.env.SIM_CITY_ENCLAVE==="0"?"OFF":"on"}`);

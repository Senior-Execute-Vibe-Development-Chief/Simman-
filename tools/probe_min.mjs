import { generateWorld } from "../src/sim/worldgen.js";
import { computeRivers } from "../src/sim/riverGen.js";
import { generateResources } from "../src/sim/resourceGen.js";
import { initPeopleSim, stepPeopleSim, peopleSimStats } from "../src/sim/peopleSim/index.js";
const STEPS=+(process.argv[2]||8000),SEED=+(process.argv[3]||857691),W=+(process.argv[4]||1920),H=+(process.argv[5]||960);
const w=generateWorld(W,H,SEED,"earth_sim",0.78,true,false,{});
const tE=new Float32Array(W*H),tT=new Float32Array(W*H),tM=new Float32Array(W*H),tC=new Uint8Array(W*H),tCrop=new Float32Array(W*H);
function tf(t,m,e){if(e>0.45)return 0.01;const a=Math.min(1,t*1.5)*Math.min(1,1-Math.pow(Math.max(0,t-0.7),2)*4);const b=Math.exp(-((m-0.45)**2)/(2*0.22*0.22));return Math.max(0.01,a*b*(1-Math.max(0,e-0.15)*3));}
for(let i=0;i<W*H;i++){tE[i]=w.elevation[i];tT[i]=w.temperature[i];tM[i]=w.moisture[i];tC[i]=w.coastal[i]||0;tCrop[i]=tf(w.temperature[i],w.moisture[i],w.elevation[i]);}
w.rivers=computeRivers(W,H,tE,tM,tT);w.deposits=generateResources(W,H,tE,tT,tM,tC,w,w._seed||SEED,w.rivers);
const world=initPeopleSim(w,{seed:w._seed||SEED,tCrop,tileRes:1,deposits:w.deposits});
console.log("step  setts  ctry land%   pop");
for(let s=1;s<=STEPS;s++){stepPeopleSim(world,1);if(s%2000===0){const st=peopleSimStats(world);console.log(`${s}  ${st.settlements}  ${st.countries}  ${(st.landPct*100).toFixed(0)}%  ${st.totalPeople}`);}}

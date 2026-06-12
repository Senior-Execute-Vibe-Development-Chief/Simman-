// Memory footprint probe — runs the sim and reports actual process memory
// (RSS + heap) alongside settlement/tile counts, to see how much RAM the sim
// really holds vs the device total. node tools/probe_mem.mjs [steps] [seed] [W] [H]
import { generateWorld } from "../src/sim/worldgen.js";
import { computeRivers } from "../src/sim/riverGen.js";
import { generateResources } from "../src/sim/resourceGen.js";
import { initPeopleSim, stepPeopleSim, peopleSimStats } from "../src/sim/peopleSim/index.js";

const STEPS = parseInt(process.argv[2] || "8000", 10);
const SEED  = parseInt(process.argv[3] || "8817", 10);
const W = parseInt(process.argv[4] || "960", 10);
const H = parseInt(process.argv[5] || "480", 10);
const TW = W, TH = H;
const w = generateWorld(W, H, SEED, "earth_sim", 0.78, true, false, {});
const tElev=new Float32Array(TW*TH),tTemp=new Float32Array(TW*TH),tMoist=new Float32Array(TW*TH),tCoast=new Uint8Array(TW*TH),tCrop=new Float32Array(TW*TH);
function tileFert(t,m,e){if(e>0.45)return 0.01;const tF=Math.min(1,t*1.5)*Math.min(1,1-Math.pow(Math.max(0,t-0.7),2)*4);const mF=Math.exp(-((m-0.45)*(m-0.45))/(2*0.22*0.22));return Math.max(0.01,tF*mF*(1-Math.max(0,e-0.15)*3));}
for(let ty=0;ty<TH;ty++)for(let tx=0;tx<TW;tx++){const i=ty*W+tx,ti=ty*TW+tx;tElev[ti]=w.elevation[i];tTemp[ti]=w.temperature[i];tMoist[ti]=w.moisture[i];tCoast[ti]=w.coastal[ti]||0;tCrop[ti]=tileFert(w.temperature[i],w.moisture[i],w.elevation[i]);}
w.rivers=computeRivers(TW,TH,tElev,tMoist,tTemp);
w.deposits=generateResources(TW,TH,tElev,tTemp,tMoist,tCoast,w,w._seed||SEED,w.rivers);
const world=initPeopleSim(w,{seed:w._seed||SEED,tCrop,tileRes:1,deposits:w.deposits});
for(let s=1;s<=STEPS;s++) stepPeopleSim(world,1);
if (global.gc) global.gc();
const m = process.memoryUsage();
const MB = b => (b/1048576).toFixed(1);
const st = peopleSimStats(world);
console.log(`mem ${W}x${H} worldgen -> ${world.tw}x${world.th} sim (N=${world.N} tiles)  step=${STEPS}`);
console.log(`settlements=${st.settlements}  countries=${st.countries}`);
console.log(`RSS=${MB(m.rss)} MB   heapUsed=${MB(m.heapUsed)} MB   external=${MB(m.external)} MB   arrayBuffers=${MB(m.arrayBuffers)} MB`);

// Macro-economy A/B probe — prints population, wealth, settlements, cities,
// countries and land% at checkpoints so a change (e.g. the trade throttle,
// SIM_TRADE_STRIDE) can be compared against baseline for behaviour drift.
//   SIM_TRADE_STRIDE=1 node tools/probe_econ.mjs 12000 8817 480 240   # baseline
//   SIM_TRADE_STRIDE=3 node tools/probe_econ.mjs 12000 8817 480 240   # throttled
import { generateWorld } from "../src/worldgen.js";
import { computeRivers } from "../src/riverGen.js";
import { generateResources } from "../src/resourceGen.js";
import { initPeopleSim, stepPeopleSim, peopleSimStats } from "../src/peopleSim/index.js";
import { T } from "../src/peopleSim/tuning.js";
if (process.env.SIM_TRADE_STRIDE) T.TRADE_STRIDE = +process.env.SIM_TRADE_STRIDE;   // A/B the trade throttle
if (process.env.SIM_DEV_STRIDE)   T.DEV_STRIDE   = +process.env.SIM_DEV_STRIDE;     // A/B the construction stagger
if (process.env.SIM_VILLAGE_PARTNERS) T.VILLAGE_PARTNERS = +process.env.SIM_VILLAGE_PARTNERS;

const STEPS = parseInt(process.argv[2] || "12000", 10);
const SEED  = parseInt(process.argv[3] || "8817", 10);
const W = parseInt(process.argv[4] || "480", 10);
const H = parseInt(process.argv[5] || "240", 10);
const TW = W, TH = H, INTERVAL = 2000;

const w = generateWorld(W, H, SEED, "earth_sim", 0.78, true, false, {});
const tElev=new Float32Array(TW*TH),tTemp=new Float32Array(TW*TH),tMoist=new Float32Array(TW*TH),tCoast=new Uint8Array(TW*TH),tCrop=new Float32Array(TW*TH);
function tileFert(t,m,e){if(e>0.45)return 0.01;const tF=Math.min(1,t*1.5)*Math.min(1,1-Math.pow(Math.max(0,t-0.7),2)*4);const mF=Math.exp(-((m-0.45)*(m-0.45))/(2*0.22*0.22));return Math.max(0.01,tF*mF*(1-Math.max(0,e-0.15)*3));}
for(let ty=0;ty<TH;ty++)for(let tx=0;tx<TW;tx++){const i=ty*W+tx,ti=ty*TW+tx;tElev[ti]=w.elevation[i];tTemp[ti]=w.temperature[i];tMoist[ti]=w.moisture[i];tCoast[ti]=w.coastal[ti]||0;tCrop[ti]=tileFert(w.temperature[i],w.moisture[i],w.elevation[i]);}
const rivers=computeRivers(TW,TH,tElev,tMoist,tTemp); w.rivers=rivers;
const deposits=generateResources(TW,TH,tElev,tTemp,tMoist,tCoast,w,w._seed||SEED,rivers); w.deposits=deposits;
const world=initPeopleSim(w,{seed:w._seed||SEED,tCrop,tileRes:1,deposits});

console.log(`econ ${W}x${H} seed=${SEED}  TRADE_STRIDE=${process.env.SIM_TRADE_STRIDE||"(default)"}`);
console.log("step    setts cities ctry  land%      pop        wealth");
function report(step){
  const st = peopleSimStats(world);
  console.log(`${String(step).padStart(5)}  ${String(st.settlements).padStart(5)} ${String(st.cities+st.metropolises).padStart(5)}  ${String(st.countries).padStart(3)}  ${(st.landPct*100).toFixed(0).padStart(3)}%  ${String(st.totalPeople).padStart(9)}  ${String(st.totalWealth).padStart(11)}`);
}
for(let s=1;s<=STEPS;s++){ stepPeopleSim(world,1); if(s%INTERVAL===0) report(s); }

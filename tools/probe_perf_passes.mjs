// Per-pass timing breakdown — where does a tick's time actually go? Runs the
// sim with world._dbgProfile and averages world.debug.pass over a window, so we
// know whether the tile-bound passes (territory/claim) dominate (→ lowering sim
// resolution helps) or the per-settlement passes do (→ it won't).
//   node tools/probe_perf_passes.mjs [steps] [seed] [W] [H]
import { generateWorld } from "../src/worldgen.js";
import { computeRivers } from "../src/riverGen.js";
import { generateResources } from "../src/resourceGen.js";
import { initPeopleSim, stepPeopleSim, peopleSimStats } from "../src/peopleSim/index.js";
import { T } from "../src/peopleSim/tuning.js";
if (process.env.SIM_TRADE_STRIDE) T.TRADE_STRIDE = +process.env.SIM_TRADE_STRIDE;   // A/B the trade throttle
if (process.env.SIM_DEV_STRIDE)   T.DEV_STRIDE   = +process.env.SIM_DEV_STRIDE;     // A/B the construction stagger
if (process.env.SIM_VILLAGE_PARTNERS) T.VILLAGE_PARTNERS = +process.env.SIM_VILLAGE_PARTNERS;

const STEPS = parseInt(process.argv[2] || "8000", 10);
const SEED  = parseInt(process.argv[3] || "8817", 10);
const W = parseInt(process.argv[4] || "960", 10);
const H = parseInt(process.argv[5] || "480", 10);
const TW = W, TH = H;

const w = generateWorld(W, H, SEED, "earth_sim", 0.78, true, false, {});
const tElev=new Float32Array(TW*TH),tTemp=new Float32Array(TW*TH),tMoist=new Float32Array(TW*TH),tCoast=new Uint8Array(TW*TH),tCrop=new Float32Array(TW*TH);
function tileFert(t,m,e){if(e>0.45)return 0.01;const tF=Math.min(1,t*1.5)*Math.min(1,1-Math.pow(Math.max(0,t-0.7),2)*4);const mF=Math.exp(-((m-0.45)*(m-0.45))/(2*0.22*0.22));return Math.max(0.01,tF*mF*(1-Math.max(0,e-0.15)*3));}
for(let ty=0;ty<TH;ty++)for(let tx=0;tx<TW;tx++){const i=ty*W+tx,ti=ty*TW+tx;tElev[ti]=w.elevation[i];tTemp[ti]=w.temperature[i];tMoist[ti]=w.moisture[i];tCoast[ti]=w.coastal[ti]||0;tCrop[ti]=tileFert(w.temperature[i],w.moisture[i],w.elevation[i]);}
const rivers=computeRivers(TW,TH,tElev,tMoist,tTemp); w.rivers=rivers;
const deposits=generateResources(TW,TH,tElev,tTemp,tMoist,tCoast,w,w._seed||SEED,rivers); w.deposits=deposits;
const world=initPeopleSim(w,{seed:w._seed||SEED,tCrop,tileRes:1,deposits});
world._dbgProfile = true;
world._wantMoneyFlows = false;   // common case: not in the money view (worker gates this on viewMode)

const acc = {}; let nAcc = 0, totalMs = 0;
const WARM = Math.min(2000, STEPS>>1);
for(let s=1;s<=STEPS;s++){
  stepPeopleSim(world,1);
  if(s>WARM){
    const p = world.debug.pass || {};
    for(const k in p){ acc[k] = (acc[k]||0) + p[k]; }
    totalMs += world.debug.tickMs || 0; nAcc++;
  }
}
const st = peopleSimStats(world);
console.log(`perf ${W}x${H} worldgen -> ${world.tw}x${world.th} sim tiles (N=${world.N})  seed=${SEED}`);
console.log(`settlements=${st.settlements} countries=${st.countries} land%=${(st.landPct*100).toFixed(0)} pop=${st.totalPeople}`);
console.log(`avg over ${nAcc} ticks (after ${WARM} warmup): tick=${(totalMs/nAcc).toFixed(3)} ms/tick`);
const rows = Object.entries(acc).map(([k,v])=>[k, v/nAcc]).sort((a,b)=>b[1]-a[1]);
let sum=0; for(const [,v] of rows) sum+=v;
for(const [k,v] of rows) console.log(`  ${k.padEnd(12)} ${v.toFixed(4).padStart(9)} ms  ${(v/sum*100).toFixed(1).padStart(5)}%`);

// Macro-economy A/B probe — prints population, wealth, settlements, cities,
// countries and land% at checkpoints so a change (e.g. the trade throttle,
// SIM_TRADE_STRIDE) can be compared against baseline for behaviour drift.
//   SIM_TRADE_STRIDE=1 node tools/probe_econ.mjs 12000 8817 480 240   # baseline
//   SIM_TRADE_STRIDE=3 node tools/probe_econ.mjs 12000 8817 480 240   # throttled
import { generateWorld } from "../src/sim/worldgen.js";
import { computeRivers } from "../src/sim/riverGen.js";
import { cropSuitability } from "../src/sim/cropGen.js";
import { generateResources } from "../src/sim/resourceGen.js";
import { initPeopleSim, stepPeopleSim, peopleSimStats } from "../src/sim/peopleSim/index.js";
import { T } from "../src/sim/peopleSim/tuning.js";
if (process.env.SIM_TRADE_STRIDE) T.TRADE_STRIDE = +process.env.SIM_TRADE_STRIDE;   // A/B the trade throttle
if (process.env.SIM_DEV_STRIDE)   T.DEV_STRIDE   = +process.env.SIM_DEV_STRIDE;     // A/B the construction stagger
if (process.env.SIM_VILLAGE_PARTNERS) T.VILLAGE_PARTNERS = +process.env.SIM_VILLAGE_PARTNERS;
if (process.env.SIM_LOCALITY) T.LOCALITY_MODE = +process.env.SIM_LOCALITY;
if (process.env.SIM_LOCALITY_SPACING) T.LOCALITY_SPACING = +process.env.SIM_LOCALITY_SPACING;
if (process.env.SIM_LAND_HUNGER) T.LAND_HUNGER = +process.env.SIM_LAND_HUNGER;
if (process.env.SIM_CAPITAL_ANCHOR) T.CAPITAL_ANCHOR = +process.env.SIM_CAPITAL_ANCHOR;   // A/B territory compactness

const STEPS = parseInt(process.argv[2] || "12000", 10);
const SEED  = parseInt(process.argv[3] || "8817", 10);
const W = parseInt(process.argv[4] || "480", 10);
const H = parseInt(process.argv[5] || "240", 10);
const TW = W, TH = H, INTERVAL = 2000;

const w = generateWorld(W, H, SEED, "earth_sim", 0.78, true, false, {});
const tElev=new Float32Array(TW*TH),tTemp=new Float32Array(TW*TH),tMoist=new Float32Array(TW*TH),tCoast=new Uint8Array(TW*TH),tCrop=new Float32Array(TW*TH);
for(let ty=0;ty<TH;ty++)for(let tx=0;tx<TW;tx++){const i=ty*W+tx,ti=ty*TW+tx;tElev[ti]=w.elevation[i];tTemp[ti]=w.temperature[i];tMoist[ti]=w.moisture[i];tCoast[ti]=w.coastal[ti]||0;}
const rivers=computeRivers(TW,TH,tElev,tMoist,tTemp); w.rivers=rivers;
const rmag=rivers&&rivers.riverMag?rivers.riverMag:null;
for(let ti=0;ti<TW*TH;ti++)tCrop[ti]=cropSuitability(tTemp[ti],tMoist[ti],tElev[ti],tCoast[ti],rmag?rmag[ti]:0);   // shared crop module (src/cropGen.js) — one source of truth with the app
const deposits=generateResources(TW,TH,tElev,tTemp,tMoist,tCoast,w,w._seed||SEED,rivers); w.deposits=deposits;
const world=initPeopleSim(w,{seed:w._seed||SEED,tCrop,tileRes:1,deposits});

console.log(`econ ${W}x${H} seed=${SEED}  LOCALITY=${process.env.SIM_LOCALITY||"0"}`);
console.log("step    setts  vil  twn  cty ctry land%      pop        wealth");
function report(step){
  const st = peopleSimStats(world);
  console.log(`${String(step).padStart(5)}  ${String(st.settlements).padStart(5)} ${String(st.villages).padStart(4)} ${String(st.towns).padStart(4)} ${String(st.cities+st.metropolises).padStart(4)} ${String(st.countries).padStart(4)} ${(st.landPct*100).toFixed(0).padStart(3)}%  ${String(st.totalPeople).padStart(9)}  ${String(st.totalWealth).padStart(11)}`);
}
for(let s=1;s<=STEPS;s++){ stepPeopleSim(world,1); if(s%INTERVAL===0) report(s); }

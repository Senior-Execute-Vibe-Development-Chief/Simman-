// Attribute political-map churn to its CAUSES by counting the country-changing
// history events each settlement records, per time window. Tells us whether the
// boiling map is driven by conquest, secession, absorption, fragmentation, or
// enclave capture — so we fix the dominant driver, not a symptom.
import { generateWorld } from "../src/sim/worldgen.js";
import { computeRivers } from "../src/sim/riverGen.js";
import { generateResources } from "../src/sim/resourceGen.js";
import { initPeopleSim, stepPeopleSim } from "../src/sim/peopleSim/index.js";

const STEPS = parseInt(process.argv[2] || "20000", 10);
const SEED  = parseInt(process.argv[3] || "8817", 10);
const W = parseInt(process.env.EARTH_W || "480", 10);
const H = parseInt(process.env.EARTH_H || "240", 10);
const TW = W, TH = H;

const w = generateWorld(W, H, SEED, "earth_sim", 0.78, true, false, {});
const tCrop = new Float32Array(TW*TH);
function tileFert(t,m,e){ if(e>0.45)return 0.01; const tF=Math.min(1,t*1.5)*Math.min(1,1-Math.pow(Math.max(0,t-0.7),2)*4); const mF=Math.exp(-((m-0.45)*(m-0.45))/(2*0.22*0.22)); return Math.max(0.01,tF*mF*(1-Math.max(0,e-0.15)*3)); }
for(let ty=0;ty<TH;ty++)for(let tx=0;tx<TW;tx++){const i=ty*W+tx,ti=ty*TW+tx; tCrop[ti]=tileFert(w.temperature[i],w.moisture[i],w.elevation[i]);}
const rivers = computeRivers(TW,TH,w.elevation,w.moisture,w.temperature); w.rivers = rivers;
const deposits = generateResources(TW,TH,w.elevation,w.temperature,w.moisture,w.coastal,w,w._seed||SEED,rivers); w.deposits = deposits;
const world = initPeopleSim(w, { seed: w._seed||SEED, tCrop, tileRes: 1, deposits });

// Event types that change (or damage over) a settlement's country allegiance.
const TYPES = ["conquered","seceded","joined-revolt","rebellion","joined-rebellion",
               "absorbed","successor","declared-independence","followed-lord",
               "failed-revolt","riot","colony-sent"];
let lastCount = {};   // type -> cumulative count seen so far
for (const t of TYPES) lastCount[t] = 0;

function scanCumulative(){
  const cum = {}; for (const t of TYPES) cum[t]=0;
  for (const s of world.settlements){
    if (!s.history) continue;
    for (const h of s.history){ if (cum[h.type] !== undefined) cum[h.type]++; }
  }
  return cum;
}

function report(step){
  const cum = scanCumulative();
  const delta = {};
  for (const t of TYPES) delta[t] = cum[t] - lastCount[t];
  lastCount = cum;
  // Avg admin load / capacity ratio across multi-member realms (over-extension).
  let overSum=0, overN=0, maxMembers=0;
  for (const c of world.countries.values()){
    if (c.members.length<=1) continue;
    if (c._capacity>0 && c._loadTotal!=null){ overSum += c._loadTotal/c._capacity; overN++; }
    if (c.members.length>maxMembers) maxMembers=c.members.length;
  }
  const avgOver = overN? (overSum/overN):0;
  const parts = TYPES.filter(t=>delta[t]>0).map(t=>`${t}=${delta[t]}`).join(" ");
  console.log(`step ${String(step).padStart(6)} | countries=${String(world.countries.size).padStart(3)} maxMembers=${String(maxMembers).padStart(3)} avgLoad/Cap=${avgOver.toFixed(2)} | ${parts}`);
}

const REPORT_EVERY = parseInt(process.env.REPORT_EVERY || "2000",10);
for(let s=1;s<=STEPS;s++){ stepPeopleSim(world,1); if(s%REPORT_EVERY===0) report(s); }

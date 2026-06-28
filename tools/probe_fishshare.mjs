// What share of each settlement's food comes from FISH vs land (farm+livestock)?
//   node tools/probe_fishshare.mjs [steps] [seed] [W] [H]
import { generateWorld } from "../src/sim/worldgen.js";
import { computeRivers } from "../src/sim/riverGen.js";
import { generateResources } from "../src/sim/resourceGen.js";
import { initPeopleSim, stepPeopleSim, peopleSimStats } from "../src/sim/peopleSim/index.js";
import { applyTuning } from "../src/sim/peopleSim/tuning.js";

// sweep knobs via env (applyTuning ignores unknown/non-finite)
const ov = {};
for (const k of ["FISH_RATE","FISH_ERAPROD_POW","LIVESTOCK","LIVESTOCK_FOOD"]) if (process.env[k] !== undefined) ov[k] = +process.env[k];
applyTuning(ov);
if (Object.keys(ov).length) console.log("[override]", JSON.stringify(ov));

const STEPS = parseInt(process.argv[2] || "15000", 10);
const SEED = parseInt(process.argv[3] || "8817", 10);
const W = parseInt(process.argv[4] || "480", 10), H = parseInt(process.argv[5] || "240", 10);
const w = generateWorld(W, H, SEED, "earth_sim", 0.78, true, false, {});
const tCrop = new Float32Array(W * H);
function tf(t, m, e) { if (e > 0.45) return 0.01; const a = Math.min(1, Math.max(0,(t-0.57)/0.13)) * Math.min(1, 1-Math.pow(Math.max(0,t-0.88),2)*1.5); const b = Math.exp(-((m - 0.45) ** 2) / (2 * 0.22 * 0.22)); return Math.max(0.01, a * b * (1 - Math.max(0, e - 0.15) * 3)); }
const tC = new Uint8Array(W * H), tE = new Float32Array(W * H), tT = new Float32Array(W * H), tM = new Float32Array(W * H);
for (let i = 0; i < W * H; i++) { tE[i] = w.elevation[i]; tT[i] = w.temperature[i]; tM[i] = w.moisture[i]; tC[i] = w.coastal[i] || 0; tCrop[i] = tf(w.temperature[i], w.moisture[i], w.elevation[i]); }
w.rivers = computeRivers(W, H, tE, tM, tT); w.deposits = generateResources(W, H, tE, tT, tM, tC, w, w._seed || SEED, w.rivers);
const world = initPeopleSim(w, { seed: w._seed || SEED, tCrop, tileRes: 1, deposits: w.deposits });
for (let s = 1; s <= STEPS; s++) stepPeopleSim(world, 1);

const setts = world.settlements.filter(s => s.mode === "settled");
// fish share = fish / (landFood + fish) per settlement, using cached fields
// EXACTLY what the panel shows: _fishYield / _foodSupply (supply = netLand + fish,
// netLand = hierarchy-adjusted land food incl. grain shipped up from the hinterland).
function share(s) {
  const fish = s._fishYield || 0;
  const supply = s._foodSupply || 0;
  return supply > 0 ? fish / supply : 0;
}
console.log(`step ${STEPS} ${W}x${H}: ${setts.length} settlements\n`);

// distribution of fish share across ALL settlements (weighted by pop)
let totPop = 0, fishPop = 0;
const buckets = [0,0,0,0,0]; // 0-20,20-40,40-60,60-80,80-100
for (const s of setts) { const f = share(s); totPop += s.people; if (f>0.5) fishPop += s.people; buckets[Math.min(4, Math.floor(f*5))]++; }
console.log(`settlements by fish-share bucket: 0-20%:${buckets[0]} 20-40%:${buckets[1]} 40-60%:${buckets[2]} 60-80%:${buckets[3]} 80-100%:${buckets[4]}`);
console.log(`population living where fish>50% of food: ${(100*fishPop/totPop).toFixed(1)}%\n`);

// pastoral belts: top settlements by pastoral food (should be dry grassland/steppe,
// modest pop — NOT a farming-grade primate)
const past = [...setts].filter(s=>(s._pastoral||0)>0.01).sort((a,b)=>(b._pastoral||0)-(a._pastoral||0)).slice(0,8);
console.log('\nTOP PASTORAL SETTLEMENTS (herd-fed grassland):');
console.log('name        pop   pastoral land  fish  climT climM');
past.forEach(s=>console.log(`${(s.name||'').padEnd(11)} ${String(Math.round(s.people)).padStart(5)} ${(s._pastoral||0).toFixed(1).padStart(7)} ${(s._landFood||0).toFixed(1).padStart(5)} ${(s._fishYield||0).toFixed(1).padStart(5)} ${(s._climTemp||0).toFixed(2).padStart(5)} ${(s._climMoist||0).toFixed(2).padStart(5)}`));

// detailed limiter dump for the biggest settlements
console.log('\nLIMITER DUMP (biggest 6):');
console.log('name        pop    land   fish  netFert eraProd irrig livestk agg  agriK climT climM');
[...setts].sort((a,b)=>b.people-a.people).slice(0,6).forEach(s=>{
  console.log(`${(s.name||'').padEnd(11)} ${String(Math.round(s.people)).padStart(5)} ${(s._landFood||0).toFixed(1).padStart(6)} ${(s._fishYield||0).toFixed(1).padStart(5)} ${(s._terrFertSum||0).toFixed(1).padStart(7)} ${(s._eraProd||0).toFixed(1).padStart(6)} ${(s._irrigation||1).toFixed(2).padStart(5)} ${(s._livestock||0).toFixed(2).padStart(6)} ${(s._agg||0).toFixed(2).padStart(4)} ${((s.knowledge&&s.knowledge.agriculture)||0).toFixed(2).padStart(5)} ${(s._climTemp||0).toFixed(2).padStart(5)} ${(s._climMoist||0).toFixed(2).padStart(5)}`);
});

// top settlements by pop, with their fish share
const top = [...setts].sort((a,b)=>b.people-a.people).slice(0, 25);
console.log('rank  pop     fish%  supply  fish   name');
top.forEach((s,i)=>{
  console.log(`${String(i+1).padStart(3)}  ${String(Math.round(s.people)).padStart(6)}  ${(share(s)*100).toFixed(0).padStart(4)}%  ${(s._foodSupply||0).toFixed(2).padStart(6)} ${(s._fishYield||0).toFixed(2).padStart(6)}  ${s.name||''} ${s._cradleName?'('+s._cradleName+')':''}`);
});

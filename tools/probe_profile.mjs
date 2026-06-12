// Per-step timing profiler — finds the frame-pacing SPIKE (the "jumping").
// Warms up to WARM, then profiles PROF steps at full res, reporting median vs
// worst single-step time and the pass breakdown of the worst step.
//   node tools/probe_profile.mjs [warm] [prof] [seed] [W] [H]
import { generateWorld } from "../src/sim/worldgen.js";
import { computeRivers } from "../src/sim/riverGen.js";
import { generateResources } from "../src/sim/resourceGen.js";
import { initPeopleSim, stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { T } from "../src/sim/peopleSim/tuning.js";
if (process.env.SIM_TERRITORY_INTERVAL) T.TERRITORY_INTERVAL = +process.env.SIM_TERRITORY_INTERVAL;
if (process.env.SIM_RES_SCALE) {/* read by countryTerritory directly */}

const WARM = +(process.argv[2] || 6000), PROF = +(process.argv[3] || 600);
const SEED = +(process.argv[4] || 857691), W = +(process.argv[5] || 1920), H = +(process.argv[6] || 960);
const w = generateWorld(W, H, SEED, "earth_sim", 0.78, true, false, {});
const tCrop = new Float32Array(W*H), tC = new Uint8Array(W*H), tE = new Float32Array(W*H), tT = new Float32Array(W*H), tM = new Float32Array(W*H);
function tf(t,m,e){if(e>0.45)return 0.01;const a=Math.min(1,Math.max(0,(t-0.57)/0.13))*Math.min(1,1-Math.pow(Math.max(0,t-0.88),2)*1.5);const b=Math.exp(-((m-0.45)**2)/(2*0.22*0.22));return Math.max(0.01,a*b*(1-Math.max(0,e-0.15)*3));}
for(let i=0;i<W*H;i++){tE[i]=w.elevation[i];tT[i]=w.temperature[i];tM[i]=w.moisture[i];tC[i]=w.coastal[i]||0;tCrop[i]=tf(w.temperature[i],w.moisture[i],w.elevation[i]);}
w.rivers=computeRivers(W,H,tE,tM,tT); w.deposits=generateResources(W,H,tE,tT,tM,tC,w,w._seed||SEED,w.rivers);
const world=initPeopleSim(w,{seed:w._seed||SEED,tCrop,tileRes:1,deposits:w.deposits});

process.stderr.write(`warming ${WARM} steps @ ${world.tw}x${world.th} (TERRITORY_INTERVAL=${T.TERRITORY_INTERVAL})...\n`);
stepPeopleSim(world, WARM);

world._dbgProfile = true;
const times = [];
let worst = -1, worstPass = null, worstPol = null;
for (let s = 0; s < PROF; s++) {
  stepPeopleSim(world, 1);
  const ms = world.debug.tickMs;
  times.push(ms);
  if (ms > worst) { worst = ms; worstPass = { ...world.debug.pass }; worstPol = world.debug.pol ? { ...world.debug.pol } : null; }
}
times.sort((a,b)=>a-b);
const med = times[times.length>>1], p50 = med, p99 = times[Math.min(times.length-1, Math.floor(times.length*0.99))];
const mean = times.reduce((a,b)=>a+b,0)/times.length;
const spikes = times.filter(t => t > 3*med).length;
console.log(`\n=== per-step timing over ${PROF} steps (sim ${world.tw}x${world.th}) ===`);
console.log(`median ${med.toFixed(2)}ms   mean ${mean.toFixed(2)}ms   p99 ${p99.toFixed(2)}ms   WORST ${worst.toFixed(2)}ms   (${(worst/med).toFixed(0)}x median)`);
console.log(`steps >3x median: ${spikes} of ${PROF}  (~1 every ${(PROF/Math.max(1,spikes)).toFixed(0)} steps)`);
console.log(`worst step pass breakdown (ms):`);
for (const [k,v] of Object.entries(worstPass).sort((a,b)=>b[1]-a[1])) console.log(`   ${k.padEnd(12)} ${v.toFixed(2)}`);
if (worstPol) { console.log(`   └─ polities sub-breakdown (ms):`); for (const [k,v] of Object.entries(worstPol).sort((a,b)=>b[1]-a[1])) console.log(`         ${k.padEnd(10)} ${v.toFixed(2)}`); }

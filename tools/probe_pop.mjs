// Population / housing-scaling diagnostic. At step N, reports the tier pyramid,
// how many settlements are HOUSING-limited vs FOOD-limited, WHY housing isn't
// growing (updateDevelopment's _devReason), and the food/house/space numbers for
// the biggest settlements — to find why so few reach city tier.
//   node tools/probe_pop.mjs [steps] [seed] [W] [H]
import { generateWorld } from "../src/sim/worldgen.js";
import { computeRivers } from "../src/sim/riverGen.js";
import { generateResources } from "../src/sim/resourceGen.js";
import { initPeopleSim, stepPeopleSim, peopleSimStats } from "../src/sim/peopleSim/index.js";
import { spaceCapacity, housingCapacity } from "../src/sim/peopleSim/settlement.js";

const STEPS = parseInt(process.argv[2] || "16000", 10);
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

const st = peopleSimStats(world);
console.log(`step ${STEPS} ${W}x${H}: settlements=${st.settlements} V${st.villages} T${st.towns} C${st.cities} M${st.metropolises}`);
let housing = 0, food = 0, reason = {}, spaceCapHit = 0, infraLow = 0, n = 0;
const setts = world.settlements.filter(s => s.mode === "settled");
for (const s of setts) {
  n++;
  const fK = s._foodK || 0, hK = s._houseK || 0;
  if (hK < fK - 0.5) housing++; else food++;
  const r = s._devReason || "(not pressed)";
  reason[r] = (reason[r] || 0) + 1;
  const space = spaceCapacity(s);
  if (housingCapacity(s) >= space - 1) spaceCapHit++; else infraLow++;
}
console.log(`limit: HOUSING-limited=${housing} (${(100*housing/n|0)}%)  food-limited=${food}`);
console.log(`devReason:`, JSON.stringify(reason));
console.log(`housing cap: at SPACE ceiling=${spaceCapHit}  below space (infra not built)=${infraLow}`);
// biggest settlements detail
const big = setts.slice().sort((a, b) => b.people - a.people).slice(0, 12);
console.log(`\ntop settlements: pop  tier foodK houseK space infra constr  devReason  timber stone water terrT`);
for (const s of big) {
  const k = s.knowledge || {}, r = s.localRes || {};
  console.log(`  ${String(Math.round(s.people)).padStart(5)} t${s.tier|0} ${String(Math.round(s._foodK||0)).padStart(5)} ${String(Math.round(s._houseK||0)).padStart(5)} ${String(Math.round(spaceCapacity(s))).padStart(5)} ${String(Math.round(s.infrastructure||0)).padStart(5)} ${(k.construction||0).toFixed(2)}  ${(s._devReason||'-').padEnd(10)} ${(r.timber||0).toFixed(2)}  ${(r.stone||0).toFixed(2)}  ${(s.waterAccess||0).toFixed(2)}  ${s._terrTiles||0}`);
}
// medians
const pops = setts.map(s=>s.people).sort((a,b)=>a-b);
const constr = setts.map(s=>(s.knowledge&&s.knowledge.construction)||0).sort((a,b)=>a-b);
console.log(`\nmedian pop=${Math.round(pops[pops.length>>1]||0)}  median construction=${(constr[constr.length>>1]||0).toFixed(2)}  max pop=${Math.round(pops[pops.length-1]||0)}`);

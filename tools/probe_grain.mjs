// Grain-market diagnostic: verifies the central-place grain economy
// (foodHierarchy.js) — money conservation, the tier pyramid, and the MERCHANT
// CHAIN signature (villages sell, towns earn a margin, the capital is the top
// buyer funding the chain). Reports per-tier the smoothed food-coin sold/bought.
//   node tools/probe_grain.mjs [steps] [seed] [W] [H]
import { generateWorld } from "../src/worldgen.js";
import { computeRivers } from "../src/riverGen.js";
import { generateResources } from "../src/resourceGen.js";
import { initPeopleSim, stepPeopleSim, peopleSimStats } from "../src/peopleSim/index.js";

const STEPS = parseInt(process.argv[2] || "12000", 10);
const SEED = parseInt(process.argv[3] || "8817", 10);
const W = parseInt(process.argv[4] || "960", 10), H = parseInt(process.argv[5] || "480", 10);
const w = generateWorld(W, H, SEED, "earth_sim", 0.78, true, false, {});
const tCrop = new Float32Array(W * H);
function tf(t, m, e) { if (e > 0.45) return 0.01; const a = Math.min(1, Math.max(0,(t-0.57)/0.13)) * Math.min(1, 1-Math.pow(Math.max(0,t-0.88),2)*1.5); const b = Math.exp(-((m - 0.45) ** 2) / (2 * 0.22 * 0.22)); return Math.max(0.01, a * b * (1 - Math.max(0, e - 0.15) * 3)); }
const tC = new Uint8Array(W * H), tE = new Float32Array(W * H), tT = new Float32Array(W * H), tM = new Float32Array(W * H);
for (let i = 0; i < W * H; i++) { tE[i] = w.elevation[i]; tT[i] = w.temperature[i]; tM[i] = w.moisture[i]; tC[i] = w.coastal[i] || 0; tCrop[i] = tf(w.temperature[i], w.moisture[i], w.elevation[i]); }
w.rivers = computeRivers(W, H, tE, tM, tT); w.deposits = generateResources(W, H, tE, tT, tM, tC, w, w._seed || SEED, w.rivers);
const world = initPeopleSim(w, { seed: w._seed || SEED, tCrop, tileRes: 1, deposits: w.deposits });
world._checkInvariants = true;   // verify the grain coin-flow conserves the money supply
for (let s = 1; s <= STEPS; s++) stepPeopleSim(world, 1);

const st = peopleSimStats(world);
console.log(`step ${STEPS} ${W}x${H}: settlements=${st.settlements} V${st.villages} T${st.towns} C${st.cities} M${st.metropolises}  totalWealth=${st.totalWealth}`);

// Per-tier grain-coin flows (IN_FOOD=2 sold, OUT_FOOD=1 bought) — the merchant chain.
const names = ["village", "town", "city", "metro"];
const agg = [0, 1, 2, 3].map(() => ({ n: 0, sold: 0, bought: 0, wealth: 0, pop: 0 }));
let earners = 0, townN = 0;
for (const s of world.settlements) {
  if (s.mode !== "settled") continue;
  const t = Math.min(3, Math.max(0, s.tier | 0));
  const a = agg[t]; a.n++;
  const sold = s._mInRate ? s._mInRate[2] : 0;
  const bought = s._mOutRate ? s._mOutRate[1] : 0;
  a.sold += sold; a.bought += bought; a.wealth += s.wealth || 0; a.pop += s.people;
  if (t === 1) { townN++; if (sold > bought) earners++; }
}
console.log("tier        n   avgFoodSold  avgFoodBought  netGrainCoin  avgWealth");
for (let t = 0; t < 4; t++) {
  const a = agg[t]; if (!a.n) continue;
  const sold = a.sold / a.n, bought = a.bought / a.n;
  console.log(`${names[t].padEnd(8)} ${String(a.n).padStart(4)}   ${sold.toFixed(3).padStart(10)}   ${bought.toFixed(3).padStart(11)}   ${(sold - bought).toFixed(3).padStart(11)}   ${String(a.wealth / a.n | 0).padStart(8)}`);
}
console.log(`towns earning a grain margin (sold>bought): ${earners}/${townN} (${townN ? (100 * earners / townN | 0) : 0}%)`);
const hits = world.debug.invariantHits || {};
const nHits = Object.values(hits).reduce((a, b) => a + b, 0);
console.log(`invariants: ${nHits === 0 ? "CLEAN" : JSON.stringify(hits)}  totalCoin=${world.debug.totalCoin}`);

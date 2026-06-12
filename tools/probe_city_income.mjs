// What do cities actually earn money from in the sim? Sums each tier's smoothed
// income by category, so we can see whether cities live on RESOURCE EXTRACTION
// (mining) or on MANUFACTURING + TRADE + TOLLS (as real cities did).
//   node tools/probe_city_income.mjs [step] [seed]
import { generateWorld } from "../src/sim/worldgen.js";
import { computeRivers } from "../src/sim/riverGen.js";
import { cropSuitability } from "../src/sim/cropGen.js";
import { generateResources } from "../src/sim/resourceGen.js";
import { initPeopleSim, stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { IN_LABELS } from "../src/sim/peopleSim/money.js";

const STEP = +(process.argv[2] || "10000");
const SEED = +(process.argv[3] || "8817");
const W = 480, H = 240, N = W * H;
const w = generateWorld(W, H, SEED, "earth_sim", 0.78, true, false, {});
const tE = new Float32Array(N), tT = new Float32Array(N), tM = new Float32Array(N), tC = new Uint8Array(N), tCrop = new Float32Array(N);
for (let i = 0; i < N; i++) { tE[i] = w.elevation[i]; tT[i] = w.temperature[i]; tM[i] = w.moisture[i]; tC[i] = w.coastal[i] || 0; }
const rivers = computeRivers(W, H, tE, tM, tT); w.rivers = rivers;
for (let i = 0; i < N; i++) tCrop[i] = cropSuitability(tT[i], tM[i], tE[i], tC[i], rivers.riverMag ? rivers.riverMag[i] : 0);
w.deposits = generateResources(W, H, tE, tT, tM, tC, w, SEED, rivers);
const world = initPeopleSim(w, { seed: SEED, tCrop, tileRes: 1, deposits: w.deposits });
for (let s = 1; s <= STEP; s++) stepPeopleSim(world, 1);

const TIER = ["village/farm", "town", "city", "metropolis"];
const acc = TIER.map(() => ({ n: 0, cat: new Float64Array(IN_LABELS.length), tot: 0 }));
for (const s of world.settlements) {
  if (s.mode !== "settled" || !s._mInRate) continue;
  const t = Math.max(0, Math.min(3, s.tier | 0));
  const a = acc[t]; a.n++;
  for (let c = 0; c < IN_LABELS.length; c++) { a.cat[c] += s._mInRate[c]; a.tot += s._mInRate[c]; }
}
console.log(`\nincome composition by tier @ step ${STEP} (earth ${SEED}) — share of each tier's total income`);
for (let t = 0; t < TIER.length; t++) {
  const a = acc[t]; if (!a.n || a.tot <= 0) continue;
  const parts = IN_LABELS.map((lab, c) => ({ lab, pct: 100 * a.cat[c] / a.tot }))
    .filter(p => p.pct > 1).sort((x, y) => y.pct - x.pct);
  console.log(`\n${TIER[t]} (${a.n}):`);
  for (const p of parts) console.log(`   ${p.lab.padEnd(18)} ${p.pct.toFixed(0).padStart(3)}%`);
}

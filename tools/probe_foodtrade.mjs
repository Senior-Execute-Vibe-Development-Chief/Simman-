// Quantify the "everyone both buys AND sells food" artifact. Runs the default
// sim and reports, per tier, the smoothed IN_FOOD vs OUT_FOOD money rates and
// how many settlements book BOTH.  node tools/probe_foodtrade.mjs [step] [seed]
import { generateWorld } from "../src/worldgen.js";
import { computeRivers } from "../src/riverGen.js";
import { cropSuitability } from "../src/cropGen.js";
import { generateResources } from "../src/resourceGen.js";
import { initPeopleSim, stepPeopleSim } from "../src/peopleSim/index.js";
import { IN_FOOD, OUT_FOOD } from "../src/peopleSim/money.js";

const STEP = +(process.argv[2] || "8000");
const SEED = +(process.argv[3] || "8817");
const W = 480, H = 240, N = W * H;
const w = generateWorld(W, H, SEED, "earth_sim", 0.78, true, false, {});
const tElev = new Float32Array(N), tTemp = new Float32Array(N), tMoist = new Float32Array(N), tCoast = new Uint8Array(N), tCrop = new Float32Array(N);
for (let i = 0; i < N; i++) { tElev[i] = w.elevation[i]; tTemp[i] = w.temperature[i]; tMoist[i] = w.moisture[i]; tCoast[i] = w.coastal[i] || 0; }
const rivers = computeRivers(W, H, tElev, tMoist, tTemp); w.rivers = rivers;
const rmag = rivers.riverMag;
for (let i = 0; i < N; i++) tCrop[i] = cropSuitability(tTemp[i], tMoist[i], tElev[i], tCoast[i], rmag ? rmag[i] : 0);
w.deposits = generateResources(W, H, tElev, tTemp, tMoist, tCoast, w, SEED, rivers);
const world = initPeopleSim(w, { seed: SEED, tCrop, tileRes: 1, deposits: w.deposits });
for (let s = 1; s <= STEP; s++) stepPeopleSim(world, 1);

const TIER = ["village/farm", "town", "city", "metropolis"];
const acc = TIER.map(() => ({ n: 0, both: 0, inF: 0, outF: 0, agFrac: 0 }));
for (const s of world.settlements) {
  if (s.mode !== "settled") continue;
  const t = Math.max(0, Math.min(3, s.tier | 0));
  const inF = s._mInRate ? s._mInRate[IN_FOOD] : 0;
  const outF = s._mOutRate ? s._mOutRate[OUT_FOOD] : 0;
  const a = acc[t]; a.n++; a.inF += inF; a.outF += outF; a.agFrac += (s._exportFoodFrac ?? 0);
  if (inF > 0.05 && outF > 0.05) a.both++;
}
console.log(`\nfood-trade money rates by tier @ step ${STEP} (earth ${SEED})`);
console.log(`tier            count  both buy&sell   mean IN_FOOD  mean OUT_FOOD  net food   foodFrac`);
acc.forEach((a, t) => {
  if (!a.n) return;
  const net = (a.inF - a.outF) / a.n;
  console.log(`${TIER[t].padEnd(15)} ${String(a.n).padStart(4)}   ${String(a.both).padStart(4)} (${(100*a.both/a.n).toFixed(0).padStart(3)}%)     ${(a.inF/a.n).toFixed(3).padStart(8)}     ${(a.outF/a.n).toFixed(3).padStart(8)}   ${(net>=0?"+":"")+net.toFixed(2)} ${net>=0?"SELLER":"buyer"}   ${(a.agFrac/a.n).toFixed(2)}`);
});
console.log(`\n→ a settlement booking BOTH IN_FOOD and OUT_FOOD is buying and selling "food & farm goods" at once.`);

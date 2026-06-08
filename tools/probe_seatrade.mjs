// Measure SEA vs LAND money flow in the live economy: counts and magnitudes of
// the trade links the money overlay draws (world._moneyFlows), split by link.sea.
// Answers whether ocean routes genuinely carry little money or just render thin.
//   node tools/probe_seatrade.mjs [step] [seed]
import { generateWorld } from "../src/worldgen.js";
import { computeRivers } from "../src/riverGen.js";
import { cropSuitability } from "../src/cropGen.js";
import { generateResources } from "../src/resourceGen.js";
import { initPeopleSim, stepPeopleSim, peopleSimStats } from "../src/peopleSim/index.js";
import { applyTuning } from "../src/peopleSim/tuning.js";
import { localP } from "../src/peopleSim/inflation.js";

const STEP = +(process.argv[2] || "8000");
const SEED = +(process.argv[3] || "8817");
if (process.argv[4] !== undefined) applyTuning({ SEA_TRADE_MULT: +process.argv[4] });
if (process.argv[5] !== undefined) applyTuning({ COIN_LOSS_RATE: +process.argv[5] });
if (process.argv[6] !== undefined) applyTuning({ HUME_ELASTICITY: +process.argv[6] });
const W = 480, H = 240, N = W * H;
const w = generateWorld(W, H, SEED, "earth_sim", 0.78, true, false, {});
const tE = new Float32Array(N), tT = new Float32Array(N), tM = new Float32Array(N), tC = new Uint8Array(N), tCrop = new Float32Array(N);
for (let i = 0; i < N; i++) { tE[i] = w.elevation[i]; tT[i] = w.temperature[i]; tM[i] = w.moisture[i]; tC[i] = w.coastal[i] || 0; }
const rivers = computeRivers(W, H, tE, tM, tT); w.rivers = rivers;
for (let i = 0; i < N; i++) tCrop[i] = cropSuitability(tT[i], tM[i], tE[i], tC[i], rivers.riverMag ? rivers.riverMag[i] : 0);
w.deposits = generateResources(W, H, tE, tT, tM, tC, w, SEED, rivers);
const world = initPeopleSim(w, { seed: SEED, tCrop, tileRes: 1, deposits: w.deposits });
world._wantMoneyFlows = true;
for (let s = 1; s <= STEP; s++) stepPeopleSim(world, 1);
console.log(`[stats]`, peopleSimStats(world));

// Price-level dispersion across the world (population-weighted). Hume should
// TIGHTEN this — specie self-distributes so regional price levels converge
// instead of some regions hoarding coin and inflating away from the rest.
{
  let pw = 0, pmean = 0; const Ps = [];
  for (const s of world.settlements) { if (s.mode !== "settled") continue; const p = localP(world, s); const w = Math.max(1, s.people); Ps.push([p, w]); pw += w; pmean += p * w; }
  pmean /= Math.max(1, pw);
  let pvar = 0, pmin = 9, pmax = 0; for (const [p, w] of Ps) { pvar += w * (p - pmean) ** 2; if (p < pmin) pmin = p; if (p > pmax) pmax = p; }
  pvar /= Math.max(1, pw);
  console.log(`[price level] mean ${pmean.toFixed(2)}  spread ${pmin.toFixed(2)}..${pmax.toFixed(2)}  CV ${(100 * Math.sqrt(pvar) / Math.max(0.01, pmean)).toFixed(1)}%  (lower CV = Hume equilibrating prices across regions)`);
}

const flows = world._moneyFlows || [];
const acc = { land: { n: 0, mag: 0, tiles: 0 }, sea: { n: 0, mag: 0, tiles: 0 } };
const seaMags = [], landMags = [];
for (const f of flows) {
  const a = f.sea ? acc.sea : acc.land;
  a.n++; a.mag += f.mag; a.tiles += f.tiles.length;
  (f.sea ? seaMags : landMags).push(f.mag);
}
seaMags.sort((x, y) => y - x); landMags.sort((x, y) => y - x);
const tot = acc.land.mag + acc.sea.mag;
const pct = v => (100 * v / Math.max(1e-9, tot)).toFixed(1) + "%";
console.log(`\n── money-flow links @ step ${STEP} (earth ${SEED}) ──`);
console.log(`total links ${flows.length}   total flow ${tot.toFixed(1)}/tick`);
console.log(`LAND: ${acc.land.n} links  flow ${acc.land.mag.toFixed(1)} (${pct(acc.land.mag)})  mean ${(acc.land.mag/Math.max(1,acc.land.n)).toFixed(2)}/link  mean len ${(acc.land.tiles/Math.max(1,acc.land.n)).toFixed(0)} tiles`);
console.log(`SEA : ${acc.sea.n} links  flow ${acc.sea.mag.toFixed(1)} (${pct(acc.sea.mag)})  mean ${(acc.sea.mag/Math.max(1,acc.sea.n)).toFixed(2)}/link  mean len ${(acc.sea.tiles/Math.max(1,acc.sea.n)).toFixed(0)} tiles`);
console.log(`top 5 SEA mags : ${seaMags.slice(0,5).map(v=>v.toFixed(1)).join(", ") || "—"}`);
console.log(`top 5 LAND mags: ${landMags.slice(0,5).map(v=>v.toFixed(1)).join(", ")}`);
// Dots-per-link the overlay would allocate (sqrt(mag) share of a 350 budget, cap 16),
// and dot DENSITY (dots per tile) — a long sea route spreads the same dots thinner.
let totalRoot = 0, maxMag = 0;
for (const f of flows) { totalRoot += Math.sqrt(f.mag); if (f.mag > maxMag) maxMag = f.mag; }
const dotsOf = f => Math.min(16, Math.max(f.mag >= maxMag*0.03 ? 1 : 0, Math.round((Math.sqrt(f.mag)/Math.max(0.001,totalRoot))*350)));
let seaDots = 0, seaLen = 0, landDots = 0, landLen = 0;
for (const f of flows) { const dd = dotsOf(f); if (f.sea) { seaDots += dd; seaLen += f.tiles.length; } else { landDots += dd; landLen += f.tiles.length; } }
console.log(`\noverlay DOTS: sea ${seaDots} dots over ${seaLen} tiles (${(seaDots/Math.max(1,seaLen)).toFixed(3)}/tile) · land ${landDots} dots over ${landLen} tiles (${(landDots/Math.max(1,landLen)).toFixed(3)}/tile)`);

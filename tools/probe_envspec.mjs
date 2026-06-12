// Climate-specialization A/B — proves ENV_SPEC changes WHO develops first.
// Same world + seed, run twice (ENV_SPEC off vs on), measured MID-GAME (before
// agriculture saturates), comparing agriculture knowledge by climate class.
//   node tools/probe_envspec.mjs [steps] [seed] [W] [H]
import { generateWorld } from "../src/sim/worldgen.js";
import { computeRivers } from "../src/sim/riverGen.js";
import { generateResources } from "../src/sim/resourceGen.js";
import { initPeopleSim, stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { T } from "../src/sim/peopleSim/tuning.js";

const STEPS = parseInt(process.argv[2] || "6000", 10);
const SEED = parseInt(process.argv[3] || "8817", 10);
const W = parseInt(process.argv[4] || "480", 10), H = parseInt(process.argv[5] || "240", 10);
const w = generateWorld(W, H, SEED, "earth_sim", 0.78, true, false, {});
const tCrop = new Float32Array(W * H);
function tf(t, m, e) { if (e > 0.45) return 0.01; const a = Math.min(1, Math.max(0,(t-0.57)/0.13)) * Math.min(1, 1-Math.pow(Math.max(0,t-0.88),2)*1.5); const b = Math.exp(-((m - 0.45) ** 2) / (2 * 0.22 * 0.22)); return Math.max(0.01, a * b * (1 - Math.max(0, e - 0.15) * 3)); }
const tC = new Uint8Array(W * H), tE = new Float32Array(W * H), tT = new Float32Array(W * H), tM = new Float32Array(W * H);
for (let i = 0; i < W * H; i++) { tE[i] = w.elevation[i]; tT[i] = w.temperature[i]; tM[i] = w.moisture[i]; tC[i] = w.coastal[i] || 0; tCrop[i] = tf(w.temperature[i], w.moisture[i], w.elevation[i]); }
w.rivers = computeRivers(W, H, tE, tM, tT); w.deposits = generateResources(W, H, tE, tT, tM, tC, w, w._seed || SEED, w.rivers);

function run(envSpec) {
  T.ENV_SPEC = envSpec;
  const world = initPeopleSim(w, { seed: w._seed || SEED, tCrop, tileRes: 1, deposits: w.deposits });
  for (let s = 1; s <= STEPS; s++) stepPeopleSim(world, 1);
  const cls = { aridRiver: [], temperate: [], tropical: [] };
  for (const s of world.settlements) {
    if (s.mode !== "settled" || !s.knowledge) continue;
    const t = s._climTemp ?? 0.5, m = s._climMoist ?? 0.5, wa = s.waterAccess || 0;
    const ag = s.knowledge.agriculture || 0;
    if (m < 0.42 && wa > 0.2) cls.aridRiver.push(ag);
    else if (t > 0.80 && m > 0.55) cls.tropical.push(ag);
    else cls.temperate.push(ag);
  }
  const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
  return { arid: mean(cls.aridRiver), aridN: cls.aridRiver.length, temp: mean(cls.temperate), trop: mean(cls.tropical), tropN: cls.tropical.length };
}

const off = run(0), on = run(1);
console.log(`A/B @ step ${STEPS} ${W}x${H} seed ${SEED} — mean AGRICULTURE knowledge by climate\n`);
console.log("                    ENV_SPEC=0   ENV_SPEC=1     Δ (effect)");
const row = (lbl, a, b) => console.log(`  ${lbl.padEnd(18)} ${a.toFixed(3).padStart(8)}   ${b.toFixed(3).padStart(8)}   ${(b - a >= 0 ? "+" : "") + (b - a).toFixed(3)}`);
row(`arid river (n=${on.aridN})`, off.arid, on.arid);
row("temperate", off.temp, on.temp);
row(`tropical (n=${on.tropN})`, off.trop, on.trop);
console.log(`\nExpected: ENV_SPEC lifts arid-river (irrigation) and damps tropical, vs the climate-blind baseline.`);

// Cartography-pass activity probe (W6-G R6 residue, backlog #19): are the
// corrective political-map passes — fillEnclosedWaste, closeRealmGaps,
// smoothCountryBorders — still doing work under the shipped field-polity
// defaults, or are any dead weight? Reads the changed-tile tallies the
// passes record under world.debug.carto and prints per-window deltas, so
// the prune decision is a measurement, not a vibe.
//   node tools/probe_carto.mjs [seed] [steps] [W] [H] [window]
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim, peopleSimStats } from "../src/sim/peopleSim/index.js";

const SEED = parseInt(process.argv[2] || "8817", 10);
const STEPS = parseInt(process.argv[3] || "8000", 10);
const W = parseInt(process.argv[4] || "480", 10), H = parseInt(process.argv[5] || String(W >> 1), 10);
const WIN = parseInt(process.argv[6] || "1000", 10);

const world = buildSim({ W, H, seed: SEED });
console.log(`[carto] seed ${SEED} · ${W}x${H} · ${STEPS} steps · window ${WIN}`);
const keys = ["calls", "waste", "gaps", "smooth", "smoothPinned"];
let prev = Object.fromEntries(keys.map(k => [k, 0]));
const totals = Object.fromEntries(keys.map(k => [k, 0]));
console.log("  step   calls  waste   gaps  smooth  pinned   realms setts");
for (let t = 0; t < STEPS; t += WIN) {
  stepPeopleSim(world, Math.min(WIN, STEPS - t));
  const c = (world.debug && world.debug.carto) || {};
  const d = {};
  for (const k of keys) { const v = c[k] || 0; d[k] = v - prev[k]; prev[k] = v; totals[k] += d[k]; }
  const st = peopleSimStats(world);
  console.log(`${String(world.step).padStart(6)}  ${String(d.calls).padStart(5)}  ${String(d.waste).padStart(5)}  ${String(d.gaps).padStart(5)}  ${String(d.smooth).padStart(6)}  ${String(d.smoothPinned).padStart(6)}   ${String(st.countries).padStart(4)} ${String(st.settlements).padStart(5)}`);
}
console.log(`[carto] totals over ${STEPS} steps: ` + keys.map(k => `${k}=${totals[k]}`).join(" ")
  + `  (per stack call: waste ${(totals.waste / Math.max(1, totals.calls)).toFixed(2)}, gaps ${(totals.gaps / Math.max(1, totals.calls)).toFixed(2)}, smooth ${(totals.smooth / Math.max(1, totals.calls)).toFixed(2)})`);

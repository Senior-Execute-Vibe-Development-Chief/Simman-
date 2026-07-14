// Windowed, multi-sample realm-count / size / coverage probe.
//
// WHY THIS EXISTS: the country count is a volatile attractor — it swings ~12→31
// WITHIN a single run as fragmentation/consolidation waves pass. Single-step or
// single-seed lever comparisons are NOISE and repeatedly gave opposite answers a
// few thousand steps apart (see docs/empire-consolidation-2026-07.md). So sample
// over a LATE WINDOW and report the MEAN — the only trustworthy way to judge a
// lever's effect on the political map. Run 2+ seeds.
//
//   node tools/probe_avg.mjs                     # seed 8817, 480 (defaults = comboE since the flip)
//   SEED=4242 W=480 node tools/probe_avg.mjs
//   SIM_TUNE="COVER_ORG=300,FIELD_SPAN=8" node tools/probe_avg.mjs        # any lever sweep
//   SIM_TUNE="FIELD_SPAN=12,COVER_ORG=150,EXPAND_RATE=1.5,REGION_SPACING=1.2" \
//     node tools/probe_avg.mjs                   # recovers the pre-comboE baseline
// (COVER_BASE/COVER_ORG are live levers now; SIM_COVER_* envs still force-override them.)
//
// count = world.countries.size ; claimed% + biggest from _countryOwner.
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";

const SEED = +(process.env.SEED || 8817);
const W = +(process.env.W || 480), H = W >> 1;
const START = +(process.env.START || 16000), END = +(process.env.END || 30000), STRIDE = +(process.env.STRIDE || 2000);

const world = buildSim({ W, H, seed: SEED });
const NG = world.tw * world.th;   // sim-tile grid (tileRes 2 → 240 wide at W=480), NOT W*H
let NLAND = 0; for (let i = 0; i < NG; i++) if (world.elev[i] > 0) NLAND++;

function snap() {
  const co = world._countryOwner; const size = new Map();
  if (co) for (let ti = 0; ti < NG; ti++) { const c = co[ti]; if (c < 0 || !(world.elev[ti] > 0)) continue; size.set(c, (size.get(c) || 0) + 1); }
  let claimed = 0, top = 0; for (const v of size.values()) { claimed += v; if (v > top) top = v; }
  return { nC: (world.countries || new Map()).size, claimedPct: 100 * claimed / NLAND, topKm: top * 510e6 / NG / 1e6 };
}

let step = 0; const samples = [];
while (step < START) { stepPeopleSim(world, START - step); step = START; }
samples.push(snap());
while (step < END) { stepPeopleSim(world, STRIDE); step += STRIDE; samples.push(snap()); }

const mean = a => a.reduce((x, y) => x + y, 0) / a.length, mn = a => Math.min(...a), mx = a => Math.max(...a);
const nC = samples.map(s => s.nC), cl = samples.map(s => s.claimedPct), tk = samples.map(s => s.topKm);
const tag = process.env.SIM_TUNE ? ` | ${process.env.SIM_TUNE}` : "";
console.log(`seed ${SEED} · ${W}px${tag} · ${samples.length} samples (${START}-${END}): ` +
  `countries mean ${mean(nC).toFixed(1)} [${mn(nC)}-${mx(nC)}] | ` +
  `claimed mean ${mean(cl).toFixed(1)}% | biggest mean ${mean(tk).toFixed(1)} [${mn(tk).toFixed(1)}-${mx(tk).toFixed(1)}] Mkm²`);

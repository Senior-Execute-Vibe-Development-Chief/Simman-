// Function-level profiling window over a mature snapshot — the ONLY trustworthy
// perf read. The battery's per-pass `slow:` field is a SINGLE-TICK snapshot
// (world.debug.pass holds the last tick only, sampled once per SERIES rows), so
// spiky passes (road planning: expensive only while the plan queue drains) read
// near-zero on sampled ticks while their true per-tick MEAN is 10-50× higher —
// the mis-attribution documented in docs/roadmap-wave-6.md W6-G item 4. This
// window records EVERY tick's bracket times and prints mean/median/p95/max, so
// bracket-vs-function-profile discrepancies are visible directly.
//
//   node --cpu-prof --cpu-prof-dir=bench --cpu-prof-name=win.cpuprofile \
//        tools/profile_window.mjs bench/<snapshot>.world.json [ticks=600]
//   then: node tools/prof_aggregate.mjs bench/win.cpuprofile
//
// SIM_TUNE passes through (_harness side effect). Invariant checks are OFF so
// the window measures the sim, not the debug pass.
import fs from "fs";
import "./_harness.mjs";
import { loadWorld } from "../src/sim/persist.js";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";

const SNAP = process.argv[2];
const TICKS = parseInt(process.argv[3] || "600", 10);
if (!SNAP) { console.error("usage: profile_window.mjs <snapshot.world.json> [ticks]"); process.exit(2); }

let t0 = performance.now();
const world = loadWorld(fs.readFileSync(SNAP, "utf8"));
world._dbgProfile = true;
world._checkInvariants = false;
console.log(`[prof] loaded step=${world.step} tw=${world.tw} setts=${world.settlements.length} in ${((performance.now() - t0) / 1000).toFixed(1)}s`);

const acc = new Map();   // pass key -> per-tick ms array
const tickMs = [];
// The polity pass self-reports sub-phases (world.debug.pol — a fresh object per
// firing); accumulate each firing once, by object identity.
const polSum = {}; let polFirings = 0, lastPol = null;
t0 = performance.now();
for (let i = 0; i < TICKS; i++) {
  const s0 = performance.now();
  stepPeopleSim(world, 1);
  tickMs.push(performance.now() - s0);
  const p = world.debug.pass || {};
  for (const k in p) { let a = acc.get(k); if (!a) acc.set(k, a = []); a.push(p[k]); }
  const pol = world.debug.pol;
  if (pol && pol !== lastPol) { lastPol = pol; polFirings++; for (const k in pol) polSum[k] = (polSum[k] || 0) + pol[k]; }
}
const wall = performance.now() - t0;

const stat = (a) => {
  const s = [...a].sort((x, y) => x - y);
  const n = s.length, sum = a.reduce((x, y) => x + y, 0);
  return { mean: sum / n, med: s[n >> 1], p95: s[Math.min(n - 1, (n * 0.95) | 0)], max: s[n - 1], sum };
};
const r1 = (x) => x.toFixed(1).padStart(8);
console.log(`[prof] ${TICKS} ticks in ${(wall / 1000).toFixed(1)}s  (end step ${world.step})`);
console.log(`  pass            mean      med      p95      max     sum(ms)`);
const rows = [...acc.entries()].map(([k, a]) => [k, stat(a)]).sort((a, b) => b[1].sum - a[1].sum);
for (const [k, st] of rows) {
  console.log(`  ${k.padEnd(12)}${r1(st.mean)} ${r1(st.med)} ${r1(st.p95)} ${r1(st.max)}   ${st.sum.toFixed(0).padStart(7)}`);
}
const tt = stat(tickMs);
console.log(`  ${"TICK TOTAL".padEnd(12)}${r1(tt.mean)} ${r1(tt.med)} ${r1(tt.p95)} ${r1(tt.max)}   ${tt.sum.toFixed(0).padStart(7)}`);
if (polFirings) console.log(`[prof] polity sub-phases over ${polFirings} firing(s):`, Object.entries(polSum).map(([k, v]) => `${k}=${v.toFixed(0)}ms`).join(" "));
if (world._fpStats) console.log(`[prof] findPath stats:`, JSON.stringify(world._fpStats, (k, v) => typeof v === "number" ? Math.round(v * 10) / 10 : v));

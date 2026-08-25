// THE CAPACITY LEDGER, DECOMPOSED (2026-08-23 — the wave's measurement-first step)
//
// Measured facts this instrument exists to explain, not re-assert:
//   * load reads ~20x capacity (576 vs 25 on an 11-member realm, probe_seatcap)
//   * hasAbsorbHeadroom never evaluates (ordering bug) — but if revived TODAY it
//     would reject nearly everything, because of that ratio
//   * a province pays 0.013 capacity and costs ~1
//
// The design's own units (conquest.js comments): capacity X = "the administration
// to govern X median-realm-equivalents", and "a province at the capital's reach
// costs ~1". reachCeil = holdRange x 25 caps an unreachable member's distance
// term. So if members were at their capital's reach, an 11-member realm would
// load ~11 against capacity ~25 and the ledger would balance. It reads 576.
//
// Per-member load = (d/holdRange) x sizeMul x recMul x langMul / coerce, and the
// stamps (s._loadDist, s._loadCoerce, s._langFriction, s._adminLoad) let this
// probe split every member's load into its factors WITHOUT re-implementing the
// Dijkstra (telemetry.js's warning). The sharp question:
//
//   IS THE DIST TERM PINNED AT ITS CEILING (~25)? If p50 _loadDist sits at the
//   reachCeil, the world's provinces are "beyond the grip" — the transport-cost
//   Dijkstra cannot reach a realm's own members within its holdRange, and the
//   whole ledger is dominated by a saturated distance term, not by size, tongue
//   or coercion. That is a units/reach mis-grounding, and it would explain both
//   the 20x ratio and why beyondDirectRule eats 42% of integration candidates.
//
// Capacity side: c._capPeace (post-hysteresis), c._capThrottle (war x fiscal),
// c._momentum, c._seatUsed — so the deflation half is attributable too.
//
//   node tools/probe_capledger.mjs [steps] [W] [seed]
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";

const STEPS = +(process.argv[2] || 24000);
const W = +(process.argv[3] || 480), H = W >> 1;
const SEED = +(process.argv[4] || 8817);

const world = buildSim({ W, H, seed: SEED });
stepPeopleSim(world, STEPS);

const q = (a, f) => (a.length ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(f * a.length))] : 0);
const countries = world.countries || new Map();

const realms = [];
const memDist = [], memSizeRec = [], memLang = [], memCoerce = [], memLoad = [];
let atCeil = 0, memN = 0;
for (const c of countries.values()) {
  if (c._capacity == null || c._loadTotal == null) continue;
  const members = (c.members || []).filter(m => m.mode === "settled");
  const loads = [];
  for (const m of members) {
    if (m._adminLoad == null || m._loadDist == null) continue;
    memN++;
    const lang = 1 + (m._langFriction || 0);
    const coerce = m._loadCoerce || 1;
    const sizeRec = m._loadDist > 0 ? (m._adminLoad * coerce) / (m._loadDist * lang) : 0;
    memDist.push(m._loadDist); memSizeRec.push(sizeRec); memLang.push(lang); memCoerce.push(coerce);
    memLoad.push(m._adminLoad);
    loads.push(m._adminLoad);
    if (m._loadDist >= 24.5) atCeil++;      // reachCeil = holdRange x 25 → _loadDist pins at ~25
  }
  // coverage: spend the budget cheapest-first, the pass's own rule
  loads.sort((a, b) => a - b);
  let spent = 0, covered = 0;
  for (const L of loads) { if (spent + L > c._capacity) break; spent += L; covered++; }
  const gov = world.polities ? world.polities.get(c.id) : null;
  realms.push({
    id: c.id, mem: members.length,
    load: c._loadTotal, cap: c._capacity, ratio: c._capacity > 0 ? c._loadTotal / c._capacity : Infinity,
    covered, coveredShare: loads.length ? covered / loads.length : 1,
    peace: c._capPeace || 0, throttle: c._capThrottle ?? 1, mom: c._momentum || 0, seat: c._seatUsed || 0,
    works: gov && gov._works || 0,
    holdReach: c.holdReach || c.range || 0,
    wouldPassHeadroom: c._loadTotal < c._capacity * 0.90,
  });
}

const M = (x) => x.toFixed(1);
console.log(`\n=== THE CAPACITY LEDGER  ${W}x${H} (tw=${world.tw})  seed ${SEED}  step ${world.step} ===`);
console.log(`  ${realms.length} realms with a stamped ledger · ${memN} provinced members\n`);

console.log(`-- the ratio, by realm size ------------------------------------------------`);
console.log(`  class      n     load p50     cap p50    load/cap p50/p90    covered-share p50   would pass headroom`);
for (const [lab, lo, hi] of [["1 member", 1, 1], ["2-4", 2, 4], ["5-9", 5, 9], ["10+", 10, 1e9]]) {
  const g = realms.filter(r => r.mem >= lo && r.mem <= hi);
  if (!g.length) continue;
  console.log(`  ${lab.padEnd(9)} ${String(g.length).padStart(4)}  ${M(q(g.map(r => r.load), .5)).padStart(9)}  ${M(q(g.map(r => r.cap), .5)).padStart(9)}    ${M(q(g.map(r => r.ratio), .5)).padStart(7)}/${M(q(g.map(r => r.ratio), .9))}    ${(100 * q(g.map(r => r.coveredShare), .5)).toFixed(0).padStart(12)}%   ${String(g.filter(r => r.wouldPassHeadroom).length).padStart(8)} of ${g.length}`);
}

console.log(`\n-- WHERE the load lives: the per-member factor split -----------------------`);
console.log(`   load = DIST x SIZExREC x LANG / COERCE      (design: a province at reach costs ~1; DIST ceilings at 25)`);
console.log(`   factor      p10      p50      p90      max`);
const row = (lab, a) => console.log(`   ${lab.padEnd(9)} ${q(a, .1).toFixed(2).padStart(6)}  ${q(a, .5).toFixed(2).padStart(7)}  ${q(a, .9).toFixed(2).padStart(7)}  ${(a.length ? Math.max(...a) : 0).toFixed(2).padStart(7)}`);
row("DIST", memDist); row("SIZExREC", memSizeRec); row("LANG", memLang); row("COERCE", memCoerce); row("= load", memLoad);
console.log(`   members with DIST pinned at the ceiling (~25): ${atCeil} of ${memN} (${memN ? (100 * atCeil / memN).toFixed(0) : 0}%)`);

console.log(`\n-- WHERE the capacity comes from -------------------------------------------`);
console.log(`   term                    p50      p90`);
console.log(`   peace (post-hyst.)   ${M(q(realms.map(r => r.peace), .5)).padStart(6)}   ${M(q(realms.map(r => r.peace), .9)).padStart(6)}`);
console.log(`   war/fiscal throttle  ${q(realms.map(r => r.throttle), .5).toFixed(2).padStart(6)}   ${q(realms.map(r => r.throttle), .9).toFixed(2).padStart(6)}`);
console.log(`   momentum             ${M(q(realms.map(r => r.mom), .5)).padStart(6)}   ${M(q(realms.map(r => r.mom), .9)).padStart(6)}`);
console.log(`   delegated seats      ${q(realms.map(r => r.seat), .5).toFixed(2).padStart(6)}   ${q(realms.map(r => r.seat), .9).toFixed(2).padStart(6)}`);
console.log(`   final capacity       ${M(q(realms.map(r => r.cap), .5)).padStart(6)}   ${M(q(realms.map(r => r.cap), .9)).padStart(6)}`);

const worst = [...realms].filter(r => r.mem >= 5).sort((a, b) => b.ratio - a.ratio).slice(0, 8);
if (worst.length) {
  console.log(`\n-- the 8 most over-loaded multi-member realms ------------------------------`);
  console.log(`   mem   load     cap   ratio   covered   holdReach   name`);
  for (const r of worst) {
    const p = world.polities && world.polities.get(r.id);
    console.log(`   ${String(r.mem).padStart(3)}  ${M(r.load).padStart(6)}  ${M(r.cap).padStart(6)}  ${M(r.ratio).padStart(5)}x   ${String(r.covered).padStart(3)}/${String(r.mem).padEnd(4)} ${M(r.holdReach).padStart(8)}   ${(p && p.name) || "?"}`);
  }
}
console.log("");

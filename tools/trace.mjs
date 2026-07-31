// TRACE — the run over TIME, not a snapshot of its end.
//
// Everything else in this suite measures a checkpoint. That cannot see trajectories,
// rates, lifespans, or whether the world is at equilibrium versus thrashing — and
// thrashing is a finding: the pre-Tier-B world's median realm swung 92k → 23k → 11k →
// 80k km² across four checkpoints, which is what identified the old `_sizePopK` anchor
// as unstable rather than merely generous. Reading that took four separate manual runs.
//
// This records the full metric map at every checkpoint, writes a CSV (one row per
// checkpoint, one column per metric — ~1,570 of them), and reports the derived
// TIME properties no snapshot can carry:
//
//   SWING      max(peak/trough) over the run — a stability measure. High = thrashing.
//   DIR        rising / falling / oscillating (sign changes in the first difference)
//   PEAK@      when the metric peaked, in steps and displayed years
//   SETTLE     whether the last third is flat (|Δ| < 5% across it) — did it converge?
//   EVENTS     the chronicle bucketed by WINDOW, so WHEN things happened is visible
//              rather than just how many — the event log's timestamps survive here.
//
//   node tools/trace.mjs --steps=21000 --every=1000
//   node tools/trace.mjs --W=960 --steps=12000 --every=1000 --out=run.csv
//   node tools/trace.mjs --watch=realm.areaKm2.p50,pop.field,shape.isolatedPct
//   node tools/trace.mjs --unstable          # rank ALL metrics by how much they thrash
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { collect, provenance } from "./lib/simmetrics.mjs";
import { stepToYear } from "../src/sim/calendar.js";
import { writeFileSync } from "node:fs";

const arg = (k, d) => { const h = process.argv.find(a => a.startsWith(`--${k}=`)); return h ? h.slice(k.length + 3) : d; };
const has = (k) => process.argv.includes(`--${k}`);
const W = +arg("W", 480), STEPS = +arg("steps", 12000), EVERY = +arg("every", 1000), SEED = +arg("seed", 8817);
const OUT = arg("out", null), UNSTABLE = has("unstable"), TOP = +arg("top", 25);
const WATCH = (arg("watch", "realm.count,realm.areaKm2.p50,realm.claimedPct,pop.field,pop.census,entity.settled,shape.isolatedPct,shape.compact.p50,drawn.claimedPct,nation._dominance.max") || "").split(",").filter(Boolean);

const yr = (s) => { const y = Math.round(stepToYear(s)); return y < 0 ? `${-y}BC` : `${y}AD`; };
const world = buildSim({ W, H: W >> 1, seed: SEED });
const rows = [], evWin = [];
let prevEvents = 0;

console.log(`[trace] seed=${SEED} W=${W} (tw=${W >> 1}) steps=${STEPS} every=${EVERY}`);
for (let t = EVERY; t <= STEPS; t += EVERY) {
  stepPeopleSim(world, EVERY);
  rows.push({ step: t, m: collect(world) });
  // events IN THIS WINDOW — the timing the flat histogram throws away
  const ev = world.events || [];
  const win = {};
  for (let i = prevEvents; i < ev.length; i++) { const k = ev[i].kind || ev[i].type; win[k] = (win[k] || 0) + 1; }
  prevEvents = ev.length;
  evWin.push({ step: t, win });
  process.stdout.write(`\r  ${t}/${STEPS}   `);
}
console.log("");
const pv = provenance(world);
console.log(`  commit ${pv.commit}${pv.dirtySrc ? " (src DIRTY)" : ""}  levers: ${Object.keys(pv.levers).length ? JSON.stringify(pv.levers) : "all at defaults"}`);

const keys = [...new Set(rows.flatMap(r => Object.keys(r.m)))].sort();

// ── derived TIME properties ──────────────────────────────────────────────────
function timeStats(k) {
  const v = rows.map(r => r.m[k] ?? 0);
  const finite = v.filter(Number.isFinite);
  if (!finite.length) return null;
  const peak = Math.max(...finite), trough = Math.min(...finite.filter(x => x !== 0).length ? finite.filter(x => x !== 0) : finite);
  const peakAt = rows[v.indexOf(peak)]?.step ?? 0;
  let flips = 0;
  for (let i = 2; i < v.length; i++) { const a = Math.sign(v[i - 1] - v[i - 2]), b = Math.sign(v[i] - v[i - 1]); if (a && b && a !== b) flips++; }
  const swing = Math.abs(trough) > 1e-12 ? Math.abs(peak / trough) : (peak !== 0 ? Infinity : 1);
  const third = Math.max(1, Math.floor(v.length / 3));
  const tail = v.slice(-third), tMin = Math.min(...tail), tMax = Math.max(...tail);
  const settled = Math.abs(tMax) > 1e-12 ? (tMax - tMin) / Math.abs(tMax) < 0.05 : true;
  const dir = flips >= Math.max(2, v.length * 0.25) ? "oscillating" : (v[v.length - 1] > v[0] ? "rising" : v[v.length - 1] < v[0] ? "falling" : "flat");
  return { first: v[0], last: v[v.length - 1], peak, peakAt, swing, flips, dir, settled, v };
}

const fmt = (x) => !Number.isFinite(x) ? "—" : Math.abs(x) >= 1e5 ? x.toExponential(2) : Math.abs(x) >= 1 ? x.toFixed(1) : x.toFixed(4);

if (UNSTABLE) {
  // Which metrics THRASH? Ranked by swing, filtered to ones that actually oscillate —
  // a monotonic rise from 0 has a huge ratio and is not instability.
  const rank = [];
  for (const k of keys) { const s = timeStats(k); if (!s || !Number.isFinite(s.swing)) continue;
    if (s.dir !== "oscillating") continue;
    rank.push({ k, ...s }); }
  rank.sort((a, b) => b.swing - a.swing);
  console.log(`\n  MOST UNSTABLE METRICS (oscillating, ranked by peak/trough) — top ${TOP} of ${rank.length}`);
  console.log(`  ${"metric".padEnd(36)}${"first".padStart(11)}${"peak".padStart(11)}${"last".padStart(11)}${"swing".padStart(9)}${"flips".padStart(7)}`);
  for (const r of rank.slice(0, TOP))
    console.log(`  ${r.k.padEnd(36)}${fmt(r.first).padStart(11)}${fmt(r.peak).padStart(11)}${fmt(r.last).padStart(11)}${fmt(r.swing).padStart(9)}${String(r.flips).padStart(7)}`);
} else {
  console.log(`\n  WATCHED TRAJECTORIES`);
  for (const k of WATCH) {
    const s = timeStats(k); if (!s) { console.log(`    ${k}: not collected`); continue; }
    console.log(`\n    ${k}  [${s.dir}${s.settled ? ", settled" : ", still moving"}]  swing ${fmt(s.swing)}×  peak ${fmt(s.peak)} @${s.peakAt} (${yr(s.peakAt)})`);
    const step = Math.max(1, Math.ceil(rows.length / 12));
    const cells = [];
    for (let i = 0; i < rows.length; i += step) cells.push(`${yr(rows[i].step)}:${fmt(s.v[i])}`);
    console.log(`      ${cells.join("  ")}`);
  }
}

// ── event timing ─────────────────────────────────────────────────────────────
const allKinds = [...new Set(evWin.flatMap(w => Object.keys(w.win)))].sort();
const interesting = allKinds.filter(k => evWin.reduce((a, w) => a + (w.win[k] || 0), 0) >= 3);
console.log(`\n  EVENTS BY WINDOW (when, not just how many) — ${interesting.length} kinds with ≥3 occurrences`);
const cols = Math.max(1, Math.ceil(evWin.length / 12));
const hdr = evWin.filter((_, i) => i % cols === 0).map(w => yr(w.step).padStart(7)).join("");
console.log(`  ${"kind".padEnd(26)}${hdr}`);
for (const k of interesting) {
  const cells = evWin.filter((_, i) => i % cols === 0).map((w, i) => {
    let n = 0; for (let j = i * cols; j < Math.min(evWin.length, (i + 1) * cols); j++) n += evWin[j].win[k] || 0;
    return (n || "·").toString().padStart(7);
  }).join("");
  console.log(`  ${k.padEnd(26)}${cells}`);
}

if (OUT) {
  const head = ["step", "year", ...keys].join(",");
  const body = rows.map(r => [r.step, Math.round(stepToYear(r.step)), ...keys.map(k => r.m[k] ?? "")].join(",")).join("\n");
  writeFileSync(OUT, head + "\n" + body + "\n");
  console.log(`\n[trace] ${rows.length} checkpoints × ${keys.length} metrics → ${OUT}`);
}

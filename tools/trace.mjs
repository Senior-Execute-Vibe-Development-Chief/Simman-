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
//   node tools/trace.mjs --entity=top        # ONE realm's arc, checkpoint by checkpoint
//   node tools/trace.mjs --out-entities=e.csv   # one row per realm × checkpoint
//
// ARCS are the per-ENTITY half of this. Every metric above is a world aggregate, and
// an aggregate structurally cannot answer "did THIS realm peak and decline?" — a
// distribution of realm areas per checkpoint is equally consistent with every realm
// growing monotonically and with half of them collapsing.
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { collect, provenance, realmRows } from "./lib/simmetrics.mjs";
import { stepToYear } from "../src/sim/calendar.js";
import { writeFileSync } from "node:fs";

const arg = (k, d) => { const h = process.argv.find(a => a.startsWith(`--${k}=`)); return h ? h.slice(k.length + 3) : d; };
const has = (k) => process.argv.includes(`--${k}`);
const W = +arg("W", 480), STEPS = +arg("steps", 12000), EVERY = +arg("every", 1000), SEED = +arg("seed", 8817);
const OUT = arg("out", null), UNSTABLE = has("unstable"), TOP = +arg("top", 25);
const OUT_ENT = arg("out-entities", null), ENTITY = arg("entity", null);
const MONOTONE = has("monotone");
const WATCH = (arg("watch", "realm.count,realm.areaKm2.p50,realm.claimedPct,pop.field,pop.census,entity.settled,shape.isolatedPct,shape.compact.p50,drawn.claimedPct,nation._dominance.max") || "").split(",").filter(Boolean);

const yr = (s) => { const y = Math.round(stepToYear(s)); return y < 0 ? `${-y}BC` : `${y}AD`; };
const world = buildSim({ W, H: W >> 1, seed: SEED });
const rows = [], evWin = [];
// Per-ENTITY history. Everything else here is a world aggregate, which structurally
// cannot answer "did THIS realm peak and decline?" — a distribution of areas at each
// checkpoint says nothing about whether any single realm traced an arc. Keyed on the
// sim's OWN polity id, never an invented lineage heuristic: restoration is already
// modelled (endedStep is cleared, `polity.restored` is logged), so the sim's notion of
// identity is the one to use. Inventing a second one is how an instrument starts
// disagreeing with the thing it measures.
const series = new Map();   // id -> [{ step, tiles, km2, people, wealth, power }]
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
  for (const r of realmRows(world)) {
    let a = series.get(r.id); if (!a) series.set(r.id, a = { name: r.name, pts: [] });
    a.name = r.name;                     // realms are renamed on succession — keep the latest
    a.pts.push({ step: t, tiles: r.tiles, km2: r.km2, people: r.people, wealth: r.wealth, power: r.power });
  }
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

// ── MONOTONICITY — the error class `coverage` and `spread` both structurally miss ──
//
// Coverage proves every value is measured. Spread proves a value is stable across
// seeds. NEITHER can tell you a metric answers the question its name implies, and
// that is the error that actually cost this session: `life.polity.died` was measured,
// was reachable, was invariant-zero on four seeds — and counted records CURRENTLY
// marked dead rather than deaths ever, because restoration clears the flag. Realms
// were dying and the map said none had.
//
// It was caught by accident, and only because the number went 0 → 1 → 0 across
// checkpoints. That is the signature, and it is checkable: A COUNT OF THINGS THAT
// HAVE HAPPENED CANNOT DECREASE. Any metric whose name asserts a cumulative history
// and whose value ever falls is either measuring a state in a counter's clothing, or
// has a reset in it.
//
// Two detectors, because a name is a claim and a shape is evidence:
//   BY NAME   — `event.*`, `.bornEver`, `.endedEver`, the id counters. A decrease
//               here is a defect unless the event log pruned (which it does at 200k,
//               visibly, via count.events — so that case is recognised, not guessed).
//   BY SHAPE  — rises overall, falls rarely. A counter with a reset in it looks like
//               this whatever it is called, so this arm catches metrics whose names
//               make no promise at all.
if (MONOTONE) {
  const CLAIMS_CUMULATIVE = (k) =>
    k.startsWith("event.") ||
    /\.(bornEver|endedEver|restoredEver|diedThenRestored)$/.test(k) ||
    /^world\._next[A-Za-z]+Id$/.test(k);
  // The event log prunes at EVENT_CAP (events.js) and that legitimately drops every
  // event.* count at once. Recognised by the live log shrinking at the same
  // checkpoint, so a long run does not fail the gate for documented behaviour.
  const evLen = rows.map(r => r.m["count.events"] ?? 0);
  const prunedAt = new Set();
  for (let i = 1; i < evLen.length; i++) if (evLen[i] < evLen[i - 1]) prunedAt.add(i);

  const byName = [], byShape = [];
  for (const k of keys) {
    const v = rows.map(r => r.m[k] ?? 0);
    let ups = 0, downs = 0, firstDrop = -1, unexplained = 0;
    for (let i = 1; i < v.length; i++) {
      if (v[i] > v[i - 1]) ups++;
      else if (v[i] < v[i - 1]) {
        downs++; if (firstDrop < 0) firstDrop = i;
        if (!(k.startsWith("event.") && prunedAt.has(i))) unexplained++;
      }
    }
    if (!downs) continue;
    if (CLAIMS_CUMULATIVE(k) && unexplained > 0) {
      byName.push({ k, downs: unexplained, at: rows[firstDrop].step, from: v[firstDrop - 1], to: v[firstDrop] });
      continue;
    }
    // Shape arm — and the first version of this was useless, which is worth recording:
    // "rises overall, drops occasionally" flagged 998 metrics, because that describes
    // almost every growing stock in a growing world. Noise at that volume is not a
    // weak signal, it is an ignored report.
    //
    // The signature that actually matters is a RESET: the value falls back to a level
    // it had already left behind, then climbs again. `life.polity.died` ran 0,0,1,0 —
    // it returned to its own baseline. A population or a tile count dips, but a dip
    // rarely erases every gain since the start of the run.
    if (CLAIMS_CUMULATIVE(k) || ups < 2) continue;
    // Counters are INTEGERS. Requiring that alone removes every mean, percentile and
    // ratio in the map — which is most of the noise, since a float that wobbles is a
    // measurement, not a tally.
    if (!v.every(Number.isInteger)) continue;
    // A reset is not merely "fell": it is "rose above where it started, then came
    // back to it". The first version tested against the running MINIMUM, which at the
    // second checkpoint IS the starting value — so any early dip qualified and 632
    // metrics were flagged. Track the peak instead.
    let peak = v[0], resetAt = -1;
    for (let i = 1; i < v.length; i++) {
      if (v[i] > peak) peak = v[i];
      if (peak > v[0] && v[i] < v[i - 1] && v[i] <= v[0]) { resetAt = i; break; }
    }
    if (resetAt > 0)
      byShape.push({ k, ups, downs, at: rows[resetAt].step, from: v[resetAt - 1], to: v[resetAt] });
  }

  console.log(`\n  MONOTONICITY — a count of things that have happened cannot decrease`);
  if (byName.length) {
    console.log(`\n  ✗ ${byName.length} metric(s) NAME a cumulative history and decreased:`);
    for (const r of byName.sort((a, b) => a.k.localeCompare(b.k)))
      console.log(`      ${r.k.padEnd(38)}${fmt(r.from).padStart(10)} → ${fmt(r.to).padStart(10)}  at step ${r.at}  (${r.downs} drop${r.downs > 1 ? "s" : ""})`);
    console.log(`\n    Each is either a STATE wearing a counter's name — measure the history`);
    console.log(`    separately, as life.*.endedEver does — or a genuine reset to find.`);
  } else console.log(`  ✓ no metric that names a cumulative history ever decreased`);

  if (byShape.length) {
    console.log(`\n  ⚠ ${byShape.length} metric(s) rose, then fell back to their own baseline — reset-shaped, review:`);
    for (const r of byShape.sort((a, b) => b.ups - a.ups).slice(0, TOP))
      console.log(`      ${r.k.padEnd(38)}${String(r.ups).padStart(4)}↑${String(r.downs).padStart(4)}↓   ${fmt(r.from)} → ${fmt(r.to)} at ${r.at}`);
    if (byShape.length > TOP) console.log(`      … ${byShape.length - TOP} more`);
    console.log(`    (Not a failure — a real stock can be spent back to nothing. The arm exists`);
    console.log(`     because the death bug's NAME promised nothing; only its shape gave it away.)`);
  }
  if (prunedAt.size) console.log(`\n    note: the event log pruned at ${prunedAt.size} checkpoint(s); event.* drops there are expected and excluded.`);
  if (byName.length) { console.log(""); process.exitCode = 1; }
}

// ── ARCS — the shape of ONE realm's life, which no aggregate can carry ───────
// "Do empires rise and fall?" is the question this simulator exists to answer, and
// until now nothing could read it: a distribution of realm areas at each checkpoint
// is compatible with every realm growing monotonically AND with half of them
// collapsing. These are per realm, over its own observed history.
const arcs = [];
for (const [id, s] of series) {
  const p = s.pts; if (p.length < 2) continue;
  let peak = -Infinity, peakAt = p[0].step;
  for (const q of p) if (q.km2 > peak) { peak = q.km2; peakAt = q.step; }
  const first = p[0], last = p[p.length - 1];
  arcs.push({ id, name: s.name, first: first.step, last: last.step,
    peak, peakAt, finalKm2: last.km2,
    // 1.0 = still at its largest; below 1 = it has given ground since its peak.
    peakFraction: peak > 0 ? last.km2 / peak : 0,
    riseSteps: peakAt - first.step, fallSteps: last.step - peakAt,
    observed: last.step - first.step, seen: p.length });
}
arcs.sort((a, b) => b.peak - a.peak);
const declined = arcs.filter(a => a.peakFraction < 0.9);
const q50 = (xs) => { if (!xs.length) return NaN; const b = [...xs].sort((x, y) => x - y); return b[b.length >> 1]; };

console.log(`\n  ARCS — ${arcs.length} realms with ≥2 checkpoints`);
if (arcs.length) {
  console.log(`    peakFraction (final ÷ peak area):  p50 ${fmt(q50(arcs.map(a => a.peakFraction)))}   min ${fmt(Math.min(...arcs.map(a => a.peakFraction)))}`);
  console.log(`    rise ${fmt(q50(arcs.map(a => a.riseSteps)))} steps p50   ·   fall ${fmt(q50(arcs.map(a => a.fallSteps)))} steps p50`);
  console.log(`    realms that EVER declined (kept <90% of peak): ${declined.length} of ${arcs.length}` +
    (declined.length === 0 ? "   ◄── every realm is at or near its largest extent: no falls, only rises" : ""));
  console.log(`\n    ${"realm".padEnd(16)}${"peak km²".padStart(11)}${"peak@".padStart(8)}${"final km²".padStart(11)}${"final/peak".padStart(11)}${"rise".padStart(7)}${"fall".padStart(7)}`);
  for (const a of arcs.slice(0, 10))
    console.log(`    ${String(a.name).slice(0, 15).padEnd(16)}${fmt(a.peak).padStart(11)}${String(a.peakAt).padStart(8)}${fmt(a.finalKm2).padStart(11)}${a.peakFraction.toFixed(3).padStart(11)}${String(a.riseSteps).padStart(7)}${String(a.fallSteps).padStart(7)}`);
}
// SELF-DIAGNOSING: a checkpoint trace cannot see a realm that was born and died
// between two checkpoints. life.polity.known counts every realm the world ever minted
// (records are never deleted), so the gap is the blind spot — reported, never hidden,
// because a silently-truncated sample reads exactly like a complete one.
const bornEver = rows.length ? (rows[rows.length - 1].m["life.polity.known"] ?? 0) : 0;
if (bornEver) {
  const missed = Math.max(0, bornEver - series.size);
  console.log(`\n    coverage: ${series.size} realms observed vs ${bornEver} ever founded` +
    (missed ? `  — ${missed} lived and died inside one ${EVERY}-step interval (invisible here; lower --every to catch them)` : `  — none missed`));
}

// ── one realm, in full ───────────────────────────────────────────────────────
if (ENTITY) {
  const pick = ENTITY === "top" ? arcs[0] : arcs.find(a => String(a.id) === ENTITY);
  console.log(`\n  ENTITY — ${pick ? `${pick.name} (#${pick.id})` : ENTITY}`);
  if (!pick) console.log("    not found");
  else {
    const p = series.get(pick.id).pts;
    console.log(`    ${"step".padStart(8)}${"year".padStart(9)}${"km²".padStart(12)}${"tiles".padStart(8)}${"people".padStart(11)}${"wealth".padStart(11)}${"power".padStart(10)}`);
    for (const q of p)
      console.log(`    ${String(q.step).padStart(8)}${yr(q.step).padStart(9)}${fmt(q.km2).padStart(12)}${String(q.tiles).padStart(8)}${fmt(q.people).padStart(11)}${fmt(q.wealth).padStart(11)}${fmt(q.power).padStart(10)}`);
  }
}

if (OUT_ENT) {
  const head = ["step", "year", "id", "name", "tiles", "km2", "people", "wealth", "power"].join(",");
  const body = [];
  for (const [id, s] of series) for (const q of s.pts)
    body.push([q.step, Math.round(stepToYear(q.step)), id, JSON.stringify(s.name), q.tiles, q.km2, q.people, q.wealth, q.power].join(","));
  writeFileSync(OUT_ENT, head + "\n" + body.join("\n") + "\n");
  console.log(`\n[trace] ${body.length} entity-checkpoint rows → ${OUT_ENT}`);
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

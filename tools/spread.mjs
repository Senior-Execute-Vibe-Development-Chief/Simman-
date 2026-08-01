// SPREAD — does this finding generalise, or is it one seed?
//
// Everything `observe`, `trace` and `why` report comes from ONE seed. This session
// produced a run of strong claims on seed 8817 alone — no realm has ever ended, no
// province has ever seceded, 0.5% of attacks fail on strength, trade partners pinned
// at exactly 12 — and not one of them carried an error bar. `abtest` has been
// multi-seed by default since it was written, for a reason recorded in its own header:
// "single-seed A/B is how you ship noise as a finding", and the cross-grid ratio
// measured 0.57 on one seed and 1.09 on another. The same hazard applies to every
// single-seed OBSERVATION, and nothing was checking it.
//
// This runs the same measurement across N seeds and reports, per metric, the median
// and the spread — plus a verdict on whether a one-seed reading of it is safe.
//
//   npm run spread
//   node tools/spread.mjs --seeds=8817,31337,4242,7777 --steps=9000
//   node tools/spread.mjs --W=960 --grep=life,graph.vassal      # the shipped grid
//   node tools/spread.mjs --unstable                            # rank by variability
//   node tools/spread.mjs --no-funnels                          # metrics only (faster)
//
// FUNNELS ARE INCLUDED, because the loudest results this session were funnel zeros
// ("secede: 0 passed ◄── NEVER FIRED") and a zero on one seed is the single easiest
// kind of finding to over-read.
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { collect, provenance } from "./lib/simmetrics.mjs";
import { telEnable, telReport } from "../src/sim/peopleSim/telemetry.js";

const arg = (k, d) => { const h = process.argv.find(a => a.startsWith(`--${k}=`)); return h ? h.slice(k.length + 3) : d; };
const has = (k) => process.argv.includes(`--${k}`);
const W = +arg("W", 480), STEPS = +arg("steps", 6000);
const SEEDS = arg("seeds", "8817,31337,4242,7777").split(",").map(Number).filter(Boolean);
const GREP = (arg("grep", "") || "").split(",").filter(Boolean);
const UNSTABLE = has("unstable"), TOP = +arg("top", 30), FUNNELS = !has("no-funnels");

if (SEEDS.length < 2) { console.error("[spread] need at least two seeds"); process.exit(2); }

const runs = [];
let lastWorld = null;
console.log(`[spread] ${SEEDS.length} seeds × ${STEPS} steps @ tw=${W >> 1}`);
for (const seed of SEEDS) {
  const w = buildSim({ W, H: W >> 1, seed });
  if (FUNNELS) telEnable(w);
  stepPeopleSim(w, STEPS);
  runs.push({ seed, m: collect(w), fun: FUNNELS ? telReport(w) : null });
  lastWorld = w;
  process.stdout.write(`\r  ${runs.length}/${SEEDS.length} seeds   `);
}
console.log("");
const pv = provenance(lastWorld);
console.log(`  commit ${pv.commit}${pv.dirtySrc ? " (src DIRTY)" : ""}  levers: ${Object.keys(pv.levers).length ? JSON.stringify(pv.levers) : "all at defaults"}`);

// ── per-metric spread ────────────────────────────────────────────────────────
const keys = [...new Set(runs.flatMap(r => Object.keys(r.m)))].sort();
const stat = (vals) => {
  const v = vals.filter(Number.isFinite);
  if (!v.length) return null;
  const s = [...v].sort((a, b) => a - b);
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length);
  return { median: s[s.length >> 1], min: s[0], max: s[s.length - 1], mean, sd,
    // CV is the honest comparator across scales — an SD of 4 means nothing until
    // you know whether the mean is 5 or 500,000.
    cv: Math.abs(mean) > 1e-12 ? sd / Math.abs(mean) : (sd > 0 ? Infinity : 0) };
};
// A verdict, not just a number: the whole point is telling a reader whether a
// single-seed claim about this metric is safe to make.
const verdictOf = (st, vals) => {
  const allSame = vals.every(v => v === vals[0]);
  if (allSame) return vals[0] === 0 ? "INVARIANT ZERO" : "invariant";
  if (!Number.isFinite(st.cv)) return "UNSAFE (mean 0)";
  if (st.cv < 0.10) return "stable";
  if (st.cv < 0.35) return "varies";
  return "UNSAFE 1-seed";
};

const rows = [];
for (const k of keys) {
  const vals = runs.map(r => r.m[k] ?? 0);
  const st = stat(vals); if (!st) continue;
  rows.push({ k, ...st, vals, verdict: verdictOf(st, vals) });
}

const fmt = (x) => !Number.isFinite(x) ? "—" : Math.abs(x) >= 1e5 ? x.toExponential(2)
  : Math.abs(x) >= 1 ? x.toFixed(1) : x.toFixed(4);
const show = (list, title) => {
  console.log(`\n  ── ${title} ${"─".repeat(Math.max(0, 52 - title.length))}`);
  console.log(`  ${"metric".padEnd(34)}${"median".padStart(11)}${"min".padStart(11)}${"max".padStart(11)}${"CV".padStart(8)}  verdict`);
  for (const r of list)
    console.log(`  ${r.k.padEnd(34)}${fmt(r.median).padStart(11)}${fmt(r.min).padStart(11)}${fmt(r.max).padStart(11)}${(Number.isFinite(r.cv) ? r.cv.toFixed(2) : "—").padStart(8)}  ${r.verdict}`);
};

if (GREP.length) {
  show(rows.filter(r => GREP.some(g => r.k.includes(g))), `MATCHING ${GREP.join(",")}`);
} else if (UNSTABLE) {
  show(rows.filter(r => Number.isFinite(r.cv) && r.cv > 0).sort((a, b) => b.cv - a.cv).slice(0, TOP),
    `LEAST TRUSTWORTHY FROM ONE SEED (top ${TOP})`);
} else {
  // The claims this session actually made, each with its error bar.
  const HEADLINE = ["realm.count", "realm.areaKm2.p50", "realm.claimedPct", "pop.field",
    "entity.settled", "life.polity.born", "life.polity.died", "life.faith.died",
    "life.culture.died", "life.dynasty.died", "life.dynasty.lifespan.n",
    "graph.vassal.bonds", "graph.vassal.depthMax", "graph.vassal.blocLandPct",
    "event.settlement.captured", "event.settlement.annexed", "event.polity.submitted",
    "event.war.began", "sett._tradeReach.size.p50", "sett._tradeReach.size.max"];
  show(rows.filter(r => HEADLINE.includes(r.k)).sort((a, b) => HEADLINE.indexOf(a.k) - HEADLINE.indexOf(b.k)),
    "THIS SESSION'S CLAIMS, WITH ERROR BARS");
}

const unsafe = rows.filter(r => r.verdict === "UNSAFE 1-seed" || r.verdict === "UNSAFE (mean 0)");
console.log(`\n  ${rows.length} metrics · ${rows.filter(r => r.verdict.startsWith("INVARIANT")).length} invariant-zero`
  + ` · ${rows.filter(r => r.verdict === "invariant").length} invariant · ${rows.filter(r => r.verdict === "stable").length} stable`
  + ` · ${rows.filter(r => r.verdict === "varies").length} vary · ${unsafe.length} UNSAFE from one seed`);
console.log(`  ${(100 * unsafe.length / Math.max(1, rows.length)).toFixed(1)}% of the metric map cannot be honestly quoted from a single run.`);

// ── funnels across seeds ─────────────────────────────────────────────────────
// A funnel zero is the easiest result in this repo to over-read, and three of this
// session's headline findings were exactly that. Reported per seed, never averaged:
// "0,0,0,0" and "0,0,0,7" mean completely different things and a mean of 1.75 hides
// which one you have.
if (FUNNELS) {
  const chans = [...new Set(runs.flatMap(r => Object.keys(r.fun || {})))].sort();
  console.log(`\n  ── FUNNELS, PER SEED (never averaged) ${"─".repeat(20)}`);
  console.log(`  ${"channel".padEnd(14)}${"considered".padStart(28)}${"passed".padStart(24)}   verdict`);
  for (const ch of chans) {
    // Same denominator convention as why.mjs: CANDIDATE is the population when a pass
    // emits it, otherwise the sum of the outcomes. `growth` has no CANDIDATE marker,
    // and reading its absence as zero made a channel that passed 69 times report
    // "never reached" — the exact confusion this tool exists to prevent, one level up.
    const denomOf = (o) => o ? (o.CANDIDATE ?? Object.entries(o).filter(([k]) => k !== "CANDIDATE" && !k.startsWith("~")).reduce((a, [, v]) => a + v, 0)) : 0;
    const cons = runs.map(r => denomOf(r.fun?.[ch]));
    const pass = runs.map(r => r.fun?.[ch]?.PASSED ?? 0);
    const reached = cons.some(c => c > 0);
    const verdict = !reached ? "never reached on any seed"
      : pass.some(p => p > 0) ? "" : "◄── NEVER FIRES ON ANY SEED";
    console.log(`  ${ch.padEnd(14)}${cons.join("/").padStart(28)}${pass.join("/").padStart(24)}   ${verdict}`);
  }
}

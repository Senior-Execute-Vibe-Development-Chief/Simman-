// ABTEST — "what does this lever actually do?", answered exhaustively, in one command.
//
// This replaces the thing that was hand-rolled six times in the 2026-07-31 session:
// build two arms, run them, eyeball a handful of numbers, and hope the number that
// moved was one you thought to print. It wasn't, twice.
//
// It runs the SAME seed with and without a tuning override, collects the exhaustive
// metric map (tools/lib/simmetrics.mjs — every tile field, every settlement/nation/
// polity key, geometry, collections, chronicle, debug counters), and reports every
// metric that moved, sorted by magnitude.
//
// MULTI-SEED BY DEFAULT, because single-seed A/B is how you ship noise as a finding.
// The cross-grid ratio measured 0.57 on one seed and 1.09 on another this session. A
// metric only earns "CONSISTENT" here if it moves the same direction on every seed.
//
//   node tools/abtest.mjs --tune="CATCH_WILD=1,SIZE_WORKED=1"
//   node tools/abtest.mjs --tune="SPAN_TECH=0" --steps=12000 --W=960
//   node tools/abtest.mjs --tune="ORG_BIRTH_VAR=0" --seeds=8817,31337,4242
//   node tools/abtest.mjs --tune="FOOD_K=0" --grep=realm,shape,pop   # focus
//   node tools/abtest.mjs --env="SIM_SUCCESSORS=0"                   # env-gated levers
//
// Note --env: some switches are env-only (SIM_SUCCESSORS) and some are module
// constants that are NOT tunable at all (BALANCE_W) — a lever that cannot be reached
// silently produces two identical arms, which reads as "no effect" when it is really
// "no experiment". This tool detects that and says so rather than letting it pass.
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { applyTuning, resetTuning, T } from "../src/sim/peopleSim/tuning.js";
import { collect, provenance } from "./lib/simmetrics.mjs";

const arg = (k, d) => { const h = process.argv.find(a => a.startsWith(`--${k}=`)); return h ? h.slice(k.length + 3) : d; };
const TUNE = arg("tune", ""), ENVV = arg("env", "");
const STEPS = +arg("steps", 9000), W = +arg("W", 480);
const SEEDS = arg("seeds", "8817,31337").split(",").map(Number).filter(Boolean);
const GREP = (arg("grep", "") || "").split(",").filter(Boolean);
const TOP = +arg("top", 45), MINPCT = +arg("minpct", 2);

if (!TUNE && !ENVV) { console.error("usage: node tools/abtest.mjs --tune=\"KEY=VAL,...\" [--env=\"VAR=VAL\"] [--steps=] [--W=] [--seeds=]"); process.exit(2); }

const parseTune = (s) => { const o = {}; for (const kv of s.split(",")) { const [k, v] = kv.split("="); if (k && v !== undefined) o[k.trim()] = +v; } return o; };
const overrides = TUNE ? parseTune(TUNE) : {};

function runArm(seed, applyOverrides) {
  resetTuning();
  applyTuning({ POP_FIELD_WORKERS: -1 });         // match tools/_harness defaults
  if (applyOverrides && TUNE) applyTuning(overrides);
  if (ENVV) { const [k, v] = ENVV.split("="); if (applyOverrides) process.env[k] = v; else delete process.env[k]; }
  const w = buildSim({ W, H: W >> 1, seed });
  stepPeopleSim(w, STEPS);
  return { metrics: collect(w), prov: provenance(w) };
}

// Verify the override is REACHABLE before trusting a null result.
resetTuning();
const unknown = Object.keys(overrides).filter(k => !(k in T));
if (unknown.length) { console.error(`[abtest] NOT A LEVER: ${unknown.join(", ")} — T has no such key. A module constant cannot be overridden by SIM_TUNE; expose it as a lever first.`); process.exit(2); }

console.log(`[abtest] ${TUNE || ENVV}   steps=${STEPS} W=${W} (tw=${W >> 1}) seeds=${SEEDS.join(",")}`);

const per = [];
for (const seed of SEEDS) {
  const base = runArm(seed, false), test = runArm(seed, true);
  per.push({ seed, base: base.metrics, test: test.metrics, prov: test.prov });
  console.log(`  seed ${seed}: baseline realms=${base.metrics["realm.count"]} medianKm2=${Math.round(base.metrics["realm.areaKm2.p50"] || 0)}  →  variant realms=${test.metrics["realm.count"]} medianKm2=${Math.round(test.metrics["realm.areaKm2.p50"] || 0)}`);
}
console.log(`  provenance: commit ${per[0].prov.commit}${per[0].prov.dirtySrc ? " (src DIRTY)" : ""}  non-default levers in variant: ${JSON.stringify(per[0].prov.levers)}`);

// ── did anything move at all? ────────────────────────────────────────────────
const keys = [...new Set(per.flatMap(p => [...Object.keys(p.base), ...Object.keys(p.test)]))].sort();
let anyMove = 0;
for (const p of per) for (const k of keys) if ((p.base[k] ?? 0) !== (p.test[k] ?? 0)) { anyMove++; break; }
if (anyMove === 0) {
  console.log(`\n[abtest] ⚠ THE TWO ARMS ARE IDENTICAL ON EVERY METRIC, EVERY SEED.`);
  console.log(`         That is "no experiment", not "no effect". Check the switch is actually`);
  console.log(`         read at runtime (a module constant, an env-only gate, or a lever whose`);
  console.log(`         consuming branch is disabled will all produce this).`);
  process.exit(0);
}

// ── rank movers, and mark cross-seed consistency ─────────────────────────────
const rows = []; let movedAll = 0;
for (const k of keys) {
  const movedHere = per.some(p => (p.base[k] ?? 0) !== (p.test[k] ?? 0));
  if (movedHere) movedAll++;
  if (GREP.length && !GREP.some(g => k.includes(g))) continue;
  const ds = per.map(p => { const a = p.base[k] ?? 0, b = p.test[k] ?? 0;
    const rel = a === 0 ? (b === 0 ? 0 : Infinity) : (b - a) / Math.abs(a) * 100; return { a, b, rel, abs: b - a }; });
  const finite = ds.map(d => d.rel).filter(Number.isFinite);
  const meanRel = finite.length ? finite.reduce((x, y) => x + y, 0) / finite.length : (ds.some(d => d.rel === Infinity) ? Infinity : 0);
  if (!ds.some(d => d.abs !== 0)) continue;
  const dirs = ds.map(d => Math.sign(d.abs)).filter(x => x !== 0);
  const consistent = dirs.length === per.length && new Set(dirs).size === 1;
  rows.push({ k, meanRel, ds, consistent });
}
// RANK BY A BOUNDED EFFECT SIZE, not by raw percent. Percent explodes on 0->x and on
// sentinel flips (endedStep -1 -> 2287 reads as 228800% and is meaningless), which
// buries the metrics that matter under arithmetic artefacts. |d| / (|a|+|b|) is in
// [0,1], treats 0->x as a full move without ranking it above everything, and is
// scale-free so a price and a population compare honestly.
for (const r of rows) {
  let eff = 0;
  for (const d of r.ds) { const e = (Math.abs(d.a) + Math.abs(d.b)) > 0 ? Math.abs(d.abs) / (Math.abs(d.a) + Math.abs(d.b)) : 0; eff += e; }
  r.effect = eff / r.ds.length;
}
rows.sort((x, y) => y.effect - x.effect);
const big = rows.filter(r => r.effect >= MINPCT / 100);

const fn = (x) => !Number.isFinite(x) ? "—" : Math.abs(x) >= 1e5 ? x.toExponential(2) : Math.abs(x) >= 1 ? x.toFixed(2) : x.toFixed(4);
console.log(`\n${movedAll} of ${keys.length} collected metrics moved${GREP.length ? `; ${rows.length} match --grep=${GREP.join(",")}` : ""}. ${big.length} exceed ±${MINPCT}%.`);
// Headline metrics ALWAYS shown, moved or not — the questions asked most often.
const HEADLINE = ["realm.count", "realm.claimedPct", "realm.areaKm2.p50", "realm.areaKm2.max",
  "entity.settled", "entity.stateless", "pop.people", "pop.largestCity", "pop.perKm2", "sett.wealth.p50",
  "shape.compact.p50", "shape.elong.p50", "shape.frags.max", "shape.isolatedPct", "shape.nearestSeat.p50",
  "nation._dominance.max", "count.cultures", "event.war.began", "event.settlement.captured",
  "event.polity.founded", "event.polity.receded",
  // Consolidation runs through VASSALAGE here, not annexation — `event.settlement.captured`
  // above is reliably 0 while the tributary network forms about once per thousand steps.
  // blocLandPct is the largest power's honest extent, which realm.count cannot show
  // because a tributary is invisible on the political map.
  "event.polity.submitted", "graph.vassal.blocLandPct", "graph.vassal.depthMax"];
console.log(`\n  ── HEADLINE ${"─".repeat(58)}`);
for (const k of HEADLINE) {
  const a = per[0].base[k], b = per[0].test[k];
  if (a === undefined && b === undefined) continue;
  const rel = (a || 0) === 0 ? ((b || 0) === 0 ? 0 : Infinity) : ((b || 0) - a) / Math.abs(a) * 100;
  const mark = (a || 0) === (b || 0) ? "  " : "→ ";
  console.log(`  ${mark}${k.padEnd(36)}${fn(a ?? 0).padStart(12)}${fn(b ?? 0).padStart(12)}${(rel === Infinity ? "new" : rel.toFixed(1)).padStart(10)}`);
}
console.log(`\n  ── LARGEST EFFECTS (bounded effect size, sentinel-safe) ${"─".repeat(15)}`);
console.log(`  ${"metric".padEnd(38)}${"baseline".padStart(12)}${"variant".padStart(12)}${"Δ%".padStart(10)}  seeds`);
for (const r of big.slice(0, TOP)) {
  const d0 = r.ds[0];
  const tag = r.consistent ? "CONSISTENT" : "mixed";
  console.log(`  ${r.k.padEnd(38)}${fn(d0.a).padStart(12)}${fn(d0.b).padStart(12)}${(r.meanRel === Infinity ? "new" : r.meanRel.toFixed(1)).padStart(10)}  ${tag}`);
}
if (big.length > TOP) console.log(`  … ${big.length - TOP} more (raise --top=)`);
const inconsistent = big.filter(r => !r.consistent).length;
console.log(`\n[abtest] ${big.length - inconsistent} movers consistent across all ${per.length} seeds; ${inconsistent} mixed-direction (treat as noise until a third seed agrees).`);

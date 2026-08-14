// COVERAGE — does the collector actually see the whole world?
//
// This exists because the same mistake was made three times in one session, and
// nothing in the repo could have caught any of them:
//
//   one level DOWN   the walk assumed entity fields are SCALARS      → missed 234
//                                                                      leaves per settlement
//   one level OUT    it assumed entities live in THREE registries    → missed 5 of 8
//                                                                      entity classes
//   the CONTAINER    it assumed state is a length-N array or a       → missed all 61
//                    registry                                          world scalars,
//                                                                      `deposits`, `_popLand`
//
// Every one was found by hand-writing a throwaway enumeration script. None was
// visible as a missing NUMBER — each was visible only as a missing DIMENSION, which
// is exactly what a metric map cannot report about itself. `collect()` growing from
// 1,304 to 5,020 metrics did not make it complete; it made it complete WITHIN THE
// SHAPE IT ASSUMED, three times running.
//
// So the question this tool asks is not "did the collector walk all the fields?" but
// **"what shape is it assuming, and what lives outside it?"**
//
// ── HOW IT CHECKS, AND WHY NOT BY NAME ──────────────────────────────────────
//
// The obvious implementation — match world keys against metric names — is a
// REPLICATED GATE, and this repo already has the scar: tools/probe_fillaudit.mjs
// answers its question by re-implementing the size-target computation externally,
// which silently drifts from the real one and then lies. A name-matching coverage
// check would inherit exactly that: it would encode a second, parallel idea of what
// collect() does, and go stale the first time collect() changed.
//
// Two mechanisms instead, neither of which knows anything about collect()'s logic:
//
//   1. PROXY — run the REAL collect() against a Proxy of the world that records
//      every property read. A key the collector never even reads cannot possibly be
//      measured, and this is exact by construction: it observes the actual code, in
//      helpers too, and cannot drift because there is nothing to keep in sync.
//
//   2. PERTURBATION — for numeric scalars, change the value, re-collect, and check
//      whether ANY metric moved. Reading a value is necessary but not sufficient;
//      this proves the value actually REACHES a number in the map. It is the
//      strongest evidence available and costs one collect() per scalar.
//
// A property passes if it is reached, or if it is NAMED in WORLD_SCRATCH — imported
// from the collector itself, never copied, so the exclusion list cannot fork.
// Anything else is DARK and this exits non-zero.
//
//   npm run coverage
//   node tools/coverage.mjs --steps=9000 --W=960     # the shipped grid
//   node tools/coverage.mjs --no-perturb             # skip the slow strong check
//   node tools/coverage.mjs --verbose                # list every property, classified
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { collect, provenance, WORLD_SCRATCH } from "./lib/simmetrics.mjs";

const arg = (k, d) => { const h = process.argv.find(a => a.startsWith(`--${k}=`)); return h ? h.slice(k.length + 3) : d; };
const has = (k) => process.argv.includes(`--${k}`);
const W = +arg("W", 480), STEPS = +arg("steps", 4000), SEED = +arg("seed", 8817);
const PERTURB = !has("no-perturb"), VERBOSE = has("verbose");

// Entity-level residue that has been AUDITED as duplicate or scratch rather than
// missing signal, with the reason. Unlike WORLD_SCRATCH this is a property of the
// audit, not of the collector, so it lives here — but it is still a NAMED list that
// fails open: a new registry appears as dark until someone justifies it.
const ENTITY_ACCEPTED = new Map([
  ["_moneyFlows", "a flow log; its aggregate is already sett._mIn/_mOut"],
  ["_evIndex", "an index into events, which are themselves measured"],
  ["_urbanSpike", "per-settlement pass scratch"],
  ["_royalCourt", "a roster of person references; persons are measured"],
  ["_byId", "alias of settlements"], ["_stMap", "alias of settlements"],
  ["_planQueue", "alias of settlement plans"],
]);

const w = buildSim({ W, H: W >> 1, seed: SEED });
stepPeopleSim(w, STEPS);
const pv = provenance(w);
console.log(`[coverage] commit ${pv.commit}${pv.dirtySrc ? " (src DIRTY)" : ""}  seed ${SEED}  grid tw=${w.tw}  step ${w.step}`);

// ── the one check that matters: does this value REACH a metric? ──────────────
// Reading a property is necessary but nowhere near sufficient. `collect()` iterates
// Object.keys(world) in several loops, so almost everything gets READ — including an
// object whose contents it then walks straight past. The only honest test is to
// change the value and see whether any number in the map moves.
//
// This is deliberately kind-uniform: the three misses this tool exists to catch were
// each a different SHAPE (a scalar, a nested object, an oddly-sized array), so a
// check that only understood one shape would have caught only one of them.
// WHICH element to perturb in a tile array is not a detail. `collect()` distributes
// length-N fields over LAND ONLY, and tile 0 is ocean on every map this generates —
// so probing index 0 changes nothing and the whole terrain layer reports as
// unreachable. The first run of this tool did exactly that: 83 false alarms,
// including `popField` and `fert`. Probe a land tile.
const LAND_IDX = (() => { for (let i = 0; i < w.N; i++) if (w.elev[i] > 0) return i; return 0; })();
const probeIdx = (a) => (a.length === w.N ? LAND_IDX : 0);

const deepLeaf = (o, depth = 0) => {           // path to some numeric leaf, any depth
  if (depth > 4 || !o || typeof o !== "object") return null;
  for (const k of Object.keys(o)) {
    const v = o[k];
    if (typeof v === "number" && Number.isFinite(v)) return [k];
    if (ArrayBuffer.isView(v) && v.length) return [k, probeIdx(v)];
    if (v && typeof v === "object" && !(v instanceof Map) && !(v instanceof Set) && !Array.isArray(v)) {
      const sub = deepLeaf(v, depth + 1); if (sub) return [k, ...sub];
    }
  }
  return null;
};
const readPath = (o, p) => p.reduce((a, k) => a?.[k], o);
const writePath = (o, p, val) => { let t = o; for (let i = 0; i < p.length - 1; i++) t = t[p[i]]; t[p[p.length - 1]] = val; };

/** Perturb one numeric leaf of world[key] and report whether ANY metric moved. */
function reachesAMetric(world, key, baseline, baseKeys) {
  const v = world[key];
  let path = null;
  if (typeof v === "number" && Number.isFinite(v)) path = [key];
  else if (ArrayBuffer.isView(v) && v.length) path = [key, probeIdx(v)];
  else if (v && typeof v === "object" && !(v instanceof Map) && !(v instanceof Set) && !Array.isArray(v)) {
    const sub = deepLeaf(v); if (sub) path = [key, ...sub];
  }
  if (!path) return null;                       // nothing numeric to perturb
  const old = readPath(world, path);
  writePath(world, path, (Number.isFinite(old) ? old : 0) * 1.7 + 13.7);
  try {
    const alt = collect(world);
    for (const mk of baseKeys) if (alt[mk] !== baseline[mk]) return true;
    for (const mk of Object.keys(alt)) if (!(mk in baseline)) return true;
    return false;
  } finally { writePath(world, path, old); }
}

// ── 0. SELF-TEST: a gate that has never failed is a rubber stamp ─────────────
// Inject state the collector provably cannot reach and confirm the detector fires.
// The canary is a numeric nested TWO levels down, because that is exactly the shape
// this collector still cannot see: its descent into world objects is depth-1, so it
// reads the outer bag, walks past the inner one, and never touches the number. If
// this tool cannot catch that, every green run below is worthless — and a coverage
// tool that cannot fail is worse than none, because it certifies blindness.
{
  const CANARY = "__coverageCanary";
  w[CANARY] = { nested: { value: 12345.6789 } };
  const probeBase = collect(w);
  const caught = reachesAMetric(w, CANARY, probeBase, Object.keys(probeBase)) === false;
  delete w[CANARY];
  if (!caught) {
    console.error(`[coverage] ✗ SELF-TEST FAILED: a two-level-nested number was NOT reported`);
    console.error(`  as unreachable. The detector cannot tell covered from dark, so a green`);
    console.error(`  result from it means nothing. Fix this before trusting the gate.`);
    process.exit(2);
  }
  console.log(`[coverage] self-test ok — unreachable state IS detected (depth-2 canary)`);
}

// ── 1. what does collect() actually READ? ────────────────────────────────────
const touched = new Set();
const spy = new Proxy(w, { get(t, k) { if (typeof k === "string") touched.add(k); return t[k]; } });
const base = collect(spy);
const baseKeys = Object.keys(base);
// Count only reads of properties that EXIST — the collector also probes optional
// keys that are absent on this world, and counting those gave "read 208 of 204".
const realKeys = Object.keys(w);
const readReal = realKeys.filter(k => touched.has(k)).length;
console.log(`[coverage] collect() emitted ${baseKeys.length} metrics and read ${readReal} of ${realKeys.length} world properties\n`);

// ── 2. classify every property ───────────────────────────────────────────────
const N = w.N;
const kindOf = (v) => {
  if (v === null || v === undefined) return "empty";
  if (typeof v === "function") return "fn";
  if (typeof v === "number") return "scalar";
  if (typeof v === "string" || typeof v === "boolean") return "flag";
  if (ArrayBuffer.isView(v)) return v.length === N ? "tileArray" : "typedArray";
  if (v instanceof Map || v instanceof Set) return "collection";
  if (Array.isArray(v)) return "array";
  return "object";
};
// Kinds that carry no measurable number at all — not a coverage failure.
const UNMEASURABLE = new Set(["empty", "fn", "flag"]);

const rows = [];
for (const k of Object.keys(w)) {
  const kind = kindOf(w[k]);
  const excluded = WORLD_SCRATCH.has(k);
  const read = touched.has(k);
  rows.push({ k, kind, excluded, read, unmeasurable: UNMEASURABLE.has(kind) });
}

// ── 3. PERTURBATION over every perturbable kind ──────────────────────────────
// Structural grid identity is skipped: changing N or tw does not test coverage, it
// invalidates every derived quantity in the map at once and proves nothing.
const STRUCTURAL = new Set(["N", "tw", "th", "width", "height", "tileRes", "seed", "step"]);
let perturbed = 0; const unreached = [];
if (PERTURB) {
  for (const r of rows) {
    if (r.excluded || r.unmeasurable || STRUCTURAL.has(r.k)) continue;
    if (!["scalar", "tileArray", "typedArray", "object"].includes(r.kind)) continue;
    const res = reachesAMetric(w, r.k, base, baseKeys);
    if (res === null) continue;                 // nothing numeric inside — not a miss
    perturbed++;
    r.reaches = res;
    if (!res) unreached.push(r.k);
  }
}

// ── 4. verdict ───────────────────────────────────────────────────────────────
// DARK = carries measurable numbers, is not named in WORLD_SCRATCH, and either was
// never read by the collector or (when perturbation ran) provably reaches no metric.
const dark = rows.filter(r => !r.unmeasurable && !r.excluded && (!r.read || r.reaches === false));
const covered = rows.filter(r => !r.unmeasurable && !r.excluded && r.read && r.reaches !== false);
const excluded = rows.filter(r => r.excluded);

const byKind = {};
for (const r of rows) { const b = byKind[r.kind] ||= { n: 0, dark: 0 }; b.n++; if (dark.includes(r)) b.dark++; }
console.log(`  ${"kind".padEnd(13)}${"total".padStart(7)}${"dark".padStart(7)}`);
for (const [kind, b] of Object.entries(byKind)) console.log(`  ${kind.padEnd(13)}${String(b.n).padStart(7)}${String(b.dark).padStart(7)}`);

console.log(`\n  measurable properties ${covered.length + dark.length}`);
console.log(`    reached by collect()  ${covered.length}`);
console.log(`    named in WORLD_SCRATCH ${excluded.length}  (pass workspace — the list fails open)`);
if (PERTURB) console.log(`    perturbation-proved   ${perturbed} properties re-collected; ${perturbed - unreached.length} provably reach a metric`);

if (VERBOSE) {
  console.log(`\n  ── every property, classified ──`);
  for (const r of rows.sort((a, b) => a.k.localeCompare(b.k))) {
    const st = r.unmeasurable ? "n/a" : r.excluded ? "scratch" : dark.includes(r) ? "DARK" : "ok";
    console.log(`    ${r.k.padEnd(24)}${r.kind.padEnd(13)}${st}`);
  }
}

// ── 5. entity-class residue (reported, not gated) ────────────────────────────
// The world-level check above is exact. This one is a share, because the residue is
// known and justified rather than zero — but a NEW registry shows up here as
// unexplained instead of quietly joining the accepted total.
const numeric = (x) => typeof x === "number" && Number.isFinite(x);
const leaves = (o) => { let n = 0; if (!o || typeof o !== "object") return 0;
  for (const k of Object.keys(o)) { const v = o[k];
    if (numeric(v)) { n++; continue; }
    if (!v || typeof v !== "object" || v instanceof Map || v instanceof Set) continue;
    if ("id" in v && ("pos" in v || "name" in v)) continue;
    if (Array.isArray(v) || ArrayBuffer.isView(v)) { for (const x of v) if (numeric(x)) n++; continue; }
    for (const kk of Object.keys(v)) if (numeric(v[kk])) n++; } return n; };
// _armedHearths / _landSeats: the dawn's two live registries, measured in
// collect() since the package-biogeography flip kept them populated at gate
// horizons (hearth.armedNow + hearthArmed.* dists; nation.landSeatsNow +
// landSeat.* dists — simmetrics.mjs).
const MEASURED_CLASSES = new Set(["settlements", "countries", "polities", "cultures", "languages", "faiths", "dynasties", "persons", "events", "_armedHearths", "_landSeats"]);
const seen = new Set(); let lit = 0, residue = 0; const unexplained = [];
for (const k of Object.keys(w)) {
  const v = w[k];
  let items = v instanceof Map ? [...v.values()] : (Array.isArray(v) && v.length && v[0] && typeof v[0] === "object" && !ArrayBuffer.isView(v[0])) ? v : null;
  if (!items || !items.length) continue;
  const fresh = items.filter(o => o && typeof o === "object" && !seen.has(o));
  if (!fresh.length) continue;
  for (const o of fresh) seen.add(o);
  const per = leaves(fresh[0]); if (!per) continue;
  const total = per * fresh.length;
  if (MEASURED_CLASSES.has(k)) { lit += total; continue; }
  residue += total;
  if (!ENTITY_ACCEPTED.has(k)) unexplained.push(`${k} (${total} leaves)`);
}
const residuePct = 100 * residue / Math.max(1, lit + residue);
console.log(`\n  entity-class leaves: measured ${lit}, residue ${residue} (${residuePct.toFixed(1)}%)`);
for (const [k, why] of ENTITY_ACCEPTED) if (Object.keys(w).includes(k)) console.log(`    accepted: ${k.padEnd(14)} ${why}`);

// ── 6. exit ──────────────────────────────────────────────────────────────────
let fail = false;
if (dark.length) {
  fail = true;
  console.log(`\n[coverage] ✗ ${dark.length} DARK propert${dark.length === 1 ? "y" : "ies"} — carries numbers, not named in WORLD_SCRATCH, not reached:`);
  for (const r of dark) console.log(`    ${r.k.padEnd(24)}${r.kind.padEnd(13)}${r.read ? "read but reaches no metric" : "never read by collect()"}`);
  console.log(`\n  Either it is an OUTCOME — extend collect() to reach it — or it is pass`);
  console.log(`  workspace, in which case add it to WORLD_SCRATCH with a reason. Do not`);
  console.log(`  add it to silence this: the list fails open precisely so that new state`);
  console.log(`  is measured by default.`);
}
if (unexplained.length) {
  fail = true;
  console.log(`\n[coverage] ✗ ${unexplained.length} unexplained entity collection(s): ${unexplained.join(", ")}`);
  console.log(`  Measure it (entityDists in collect()) or justify it in ENTITY_ACCEPTED here.`);
}
if (!fail) console.log(`\n[coverage] ✓ every measurable world property is reached by collect() or named as workspace`);
process.exit(fail ? 1 : 0);

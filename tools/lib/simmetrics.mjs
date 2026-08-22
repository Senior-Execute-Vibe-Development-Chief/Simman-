// SIMMETRICS — one collector, every consumer.
//
// The measurement problem this solves: every question asked of this sim has meant
// hand-rolling a probe, and every A/B has meant hand-rolling two arms and eyeballing
// them. Different probes measured different things, so answers were not comparable and
// a change could move something nobody happened to be printing.
//
// collect(world) returns a FLAT map of metricName -> number. It is built by
// INTROSPECTION, so it covers everything the world carries and grows automatically:
//
//   field.<name>.{p50,p90,max,mean,sum}   every length-N tile array, over LAND
//   sett.<path>.{p50,p90,max,sum}         every numeric leaf on settlements, DEPTH 2
//   nation.<path>.{p50,p90,max,sum}       every numeric leaf on country records
//   polity.<path>.{p50,p90,max,sum}       every numeric leaf on polity records
//   shape.<metric>.{p50,p90,max}          realm geometry (compactness, frags, …)
//   graph.<net>.<metric>                  TOPOLOGY of the networks (see below)
//   count.<collection>                    every Map/Set/Array on the world, by size
//   event.<kind>                          the chronicle histogram
//   run.*, pop.*, realm.*                 curated headline aggregates
//
// Because it is exhaustive, a DIFF of two collect() results is a complete answer to
// "what did this change actually move?" — nothing is missed because nobody thought to
// print it. That is the whole point: perfect measurement is measuring everything by
// default and letting the diff decide what mattered.
import { execSync } from "node:child_process";
import { T, TUNING_SCHEMA } from "../../src/sim/peopleSim/tuning.js";
import { stepToYear } from "../../src/sim/calendar.js";
import { POP_SCALE } from "../../src/sim/units.js";

const pct = (sorted, p) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : 0;

function dist(prefix, arr, into) {
  if (!arr.length) return;
  const b = Float64Array.from(arr).sort();
  let sum = 0; for (const v of b) if (Number.isFinite(v)) sum += v;
  // SAMPLE SIZE, on every distribution. A p50 over three values reads exactly like a
  // p50 over five thousand, and that is not hypothetical: life.dynasty.lifespan.p50
  // came out 75 steps at tw=240 and 1,175 at tw=480 — a 15.7x cross-grid gap that
  // looked like a finding until you saw it rested on 3 and 6 completed lives. Without
  // `.n` a diff cannot tell "this moved" from "this had two data points", so every
  // consumer here — abtest's ranking especially — was one anecdote from a wrong call.
  into[`${prefix}.n`] = b.length;
  into[`${prefix}.p50`] = pct(b, 0.5);
  into[`${prefix}.p90`] = pct(b, 0.9);
  into[`${prefix}.max`] = b[b.length - 1];
  into[`${prefix}.mean`] = sum / b.length;
  into[`${prefix}.sum`] = sum;
}

// ── DEPTH 2: the leaves the collector used to walk straight past ─────────────
//
// This stopped at `typeof v === "number"`, so it saw a settlement's ~60 scalars and
// NONE of the 234 numeric leaves one level down: the entire 8-good economy
// (_gPrice/_gProd/_gDem/_gStock/_gCap/_gNet/_gExpLeft/_gImpLeft), all six knowledge
// tracks, the 22 derived _techEff effects (farmYield, reachLevel, logisticsLevel,
// military, walls, credit, seaRange, cohesion), the 108 money-provenance channels,
// and the localRes/_effRes resource vectors.
//
// abtest, bisect and trace ALL read collect(), so a lever writing into any of those
// was structurally unmeasurable — and worse, abtest's non-experiment detector ("both
// arms identical on every metric ⇒ the switch was never reached") would report a
// lever that moves ONLY hidden state as a dead switch. A false negative exactly where
// it costs most: MIXED_FARM writes _techEff.farmYield, and the A/B could not see it.
//
// ONE level, not arbitrary depth. Depth 2 is where this world's data model actually
// ends; deeper wandering hits entity references and cycles.

const MAX_VEC = 64;      // enumerate vectors up to this long; beyond it, shape only
const numeric = (x) => typeof x === "number" && Number.isFinite(x);

// World-level PASS WORKSPACE — the counterpart of observe's SCRATCH, and the same
// bargain: the outcome/workspace split is semantic so it cannot be detected, but the
// list FAILS OPEN. Anything not named here is treated as an outcome and measured, so
// new world state shows up by default instead of hiding. Only two kinds are named:
// re-entrancy cursors and version stamps (pure bookkeeping — `_reachCursor`,
// `_roadVersion`, `_fpStamp`), and allocator/worker plumbing (`_pfArena`, `_pfPool`,
// `_gapBuf`, `_settGrid`, `_polHeap`). `worldRef` is excluded for a different reason:
// it is the raw worldgen output at RENDER resolution (115,200 cells), and the sim-res
// copies of those same fields — elev, fert, temp, moist — are already collected, so
// including it would double-count terrain at a resolution nothing simulates.
// NOTE the id counters (`_nextPersonId`, …) are deliberately NOT scratch: each one is
// a cumulative "how many were ever minted", which is exactly the total the live
// registry cannot give once records start being reclaimed.
export const WORLD_SCRATCH = new Set([
  "worldRef", "debug",                                     // duplicate / already emitted as debug.*
  "_pfArena", "_pfPool", "_gapBuf", "_settGrid", "_polHeap",   // allocators, pools, indices
  "_pfCapT", "_pfGateT",                                   // precomputed lookup tables
  "_stMapStep", "_reachStamp", "_reachCursor", "_linkCursor", "_transportStep",
  "_fpStamp", "_roadVersion", "_tileCompStamp", "_tileCompStampVal", "_fpowStep",
  "_loyalScanAt", "_slaveScarcityStep", "_compRoadVer", "_compSettCount",
  "_planSnap", "_planIdx", "_craftMeanStep", "_craftAccN", "_tierScaleStep",
  "_sittingRulersStep", "_aliveCCStep", "_coreStamp", "_agriCeilKey",
  // Persistent pass workspace from the stall-fix reuse-slot pattern (2026-08-19):
  // MinHeaps whose contents are per-firing scratch, fully overwritten each use —
  // the memory fix keeps the ALLOCATION alive, never the values.
  "_terrHeap", "_fpHeap", "_fpHeap2",
  "_lkContactStep",   // land-ledger contact-sweep cadence stamp (landKnow.js)
  // The 26.6k allocation-wall fix (2026-08-20): the transport Dijkstra frontier
  // joins the persistent-heap family, plus its high-water diagnostic counters
  // (peak sizes/pushes — observability about the machine, not world history).
  "_transHeap", "_transStat",
  // PEER_SEATS (2026-08-20): the peer lane's candidate cache — positions and
  // basin takes mid-gather, rebuilt from claims/popField; never serialized.
  "_peerCand",
  // WAR_FINISH siege-endurance (2026-08-21): the camp clock — per-pair
  // continuous-siege start stamps, renewed each war pass, stale-pruned;
  // rebuilt within one pass after load (the _warBornAt doctrine).
  "_siegeOpen",
  // ABSORB_ORG_ERA (2026-08-21): the era's absorption bar, cached per pass —
  // a quantile of live capital orgs, recomputed each polity pass.
  "_eraOrgBar", "_eraOrgBarStep",
  // ENGULF (2026-08-21): the per-realm enclosure map - border-share by
  // neighbour, cached per polity pass; read by submissions AND integration.
  "_enclosure", "_enclosureStep",
]);

/** An ENTITY REFERENCE, not a data bag. Recursing into a settlement's `_foodParent`
 *  would re-measure a whole other settlement under a misleading name, and
 *  `country.capital` would duplicate all 113 of its fields under `nation.capital.*`.
 *  Entity-shaped = carries an id AND a name or a position. */
const isEntityRef = (v) => v !== null && typeof v === "object" && !Array.isArray(v)
  && !ArrayBuffer.isView(v) && ("id" in v) && (("pos" in v) || ("name" in v));

// Vector index NAMES — cosmetic legibility only, and loaded defensively because
// bisect.mjs copies this collector into an OLD commit's worktree, where an export
// may not exist yet (a static import would hard-fail at link time and take the whole
// bisect with it). A missing table costs a readable name, never a measurement:
// an unnamed vector still gets measured, just as `_gPrice.3` instead of
// `_gPrice.metal`. Fails open, like SCRATCH in observe.
const VEC_NAMES = await (async () => {
  const t = {};
  const put = (keys, names) => { for (const k of keys) t[k] = names; };
  try {
    const g = await import("../../src/sim/peopleSim/goods.js");
    if (Array.isArray(g.GOODS)) {
      put(["_gPrice", "_gProd", "_gDem", "_gStock", "_gCap", "_gNet", "_gExpLeft", "_gImpLeft"], g.GOODS);
      // The craft subset is GOODS read at the CRAFTS indices — derived from the
      // same two arrays the sim uses, so it cannot drift out of step with them.
      if (Array.isArray(g.CRAFTS)) put(["_gShare", "_gCapx"], g.CRAFTS.map(i => g.GOODS[i]));
    }
  } catch { /* older commit, or goods.js absent — indices it is */ }
  try {
    const m = await import("../../src/sim/peopleSim/money.js");
    const slug = (s) => String(s).replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "").toLowerCase();
    if (Array.isArray(m.IN_LABELS)) put(["_mIn", "_mInRate", "_mInPend", "_mInPendRate"], m.IN_LABELS.map(slug));
    if (Array.isArray(m.OUT_LABELS)) put(["_mOut", "_mOutRate"], m.OUT_LABELS.map(slug));
  } catch { /* ditto */ }
  return t;
})();

/** Discover every numeric leaf path on one entity, adding `path -> getter` to `paths`.
 *  Entities are heterogeneous — a key present on one settlement may be absent on the
 *  next — so paths are unioned across the whole population before any is measured.
 *  `fixedLen` names the array keys whose length is IDENTICAL across the whole class;
 *  only those are enumerated positionally (see entityDists). */
function discoverPaths(o, paths, fixedLen) {
  for (const k of Object.keys(o)) {
    const v = o[k];
    if (numeric(v)) { if (!paths.has(k)) paths.set(k, (e) => numeric(e[k]) ? e[k] : 0); continue; }
    if (v === null || typeof v !== "object") continue;
    // A Map/Set is a RELATION, not a value: its size is the measurement. This is how
    // `_tradeReach` (partners per settlement) stops being an observe-only curated line.
    if (v instanceof Map || v instanceof Set) {
      const p = `${k}.size`;
      if (!paths.has(p)) paths.set(p, (e) => (e[k] instanceof Map || e[k] instanceof Set) ? e[k].size : 0);
      continue;
    }
    if (isEntityRef(v)) continue;
    if (Array.isArray(v) || ArrayBuffer.isView(v)) {
      const p = `${k}.len`;
      // Length is itself an outcome — `culMix.len` IS the mix depth observe prints
      // by hand, `dynasty.members.len` is how big a house grew, and it is the only
      // thing measurable about an array of non-numbers.
      if (!paths.has(p)) paths.set(p, (e) => (e[k]?.length) || 0);
      // POSITION MEANS SOMETHING ONLY IN A FIXED-SCHEMA VECTOR. `_gPrice[3]` is metal
      // in every settlement; but index 5 of one dynasty's `members` list has nothing
      // to do with index 5 of the next, so distributing it is noise wearing a metric's
      // name — and noise in this map costs real money, because abtest ranks by effect
      // size and a shuffled id list moves hard. Detected FROM THE DATA (one length
      // across the entire class ⇒ structural), never from a hand-kept list of names.
      if (!fixedLen.has(k)) continue;
      if (v.length > MAX_VEC) continue;              // bounded: shape only, no enumeration
      const names = VEC_NAMES[k];
      // Collision scope is THIS vector, not the accumulated path map — a duplicated
      // label would otherwise collapse two channels into one name and silently drop
      // one, the exact failure mode this collector exists to prevent. The table is
      // the same for every entity, so index i always resolves to the same name.
      const used = new Set();
      for (let i = 0; i < v.length; i++) {
        if (!numeric(v[i])) continue;
        const cand = names?.[i] != null ? `${k}.${names[i]}` : `${k}.${i}`;
        const q = used.has(cand) ? `${k}.${i}` : cand;
        used.add(q);
        if (!paths.has(q)) paths.set(q, (e) => { const a = e[k]; return (a && numeric(a[i])) ? a[i] : 0; });
      }
      continue;
    }
    for (const kk of Object.keys(v)) {
      if (!numeric(v[kk])) continue;
      const q = `${k}.${kk}`;
      if (!paths.has(q)) paths.set(q, (e) => { const o2 = e[k]; return (o2 && numeric(o2[kk])) ? o2[kk] : 0; });
    }
  }
}

/** One distribution per numeric leaf, over a population of entities. */
function entityDists(prefix, items, into) {
  if (!items.length) return;
  // Which array keys carry a FIXED schema? Survey every entity first: one distinct
  // length across the whole class means position is structural (a goods vector, a
  // money-channel array); two or more means it is a variable-length LIST.
  const lens = new Map();
  for (const it of items) for (const k of Object.keys(it)) {
    const v = it[k];
    if (v && typeof v === "object" && (Array.isArray(v) || ArrayBuffer.isView(v))) {
      let s = lens.get(k); if (!s) lens.set(k, s = new Set());
      s.add(v.length);
    }
  }
  const fixedLen = new Set([...lens].filter(([, s]) => s.size === 1).map(([k]) => k));
  const paths = new Map();
  for (const it of items) discoverPaths(it, paths, fixedLen);
  for (const [p, get] of paths) dist(`${prefix}.${p}`, items.map(get), into);
}

/** Which levers differ from their shipped defaults — the provenance of any measurement. */
export function leverDiff() {
  const defs = {};
  try { for (const cat of (TUNING_SCHEMA || [])) for (const p of cat.params) defs[p.key] = p.def; }
  catch { return {}; }   // an older commit's tuning.js may not export the schema
  const out = {};
  for (const k of Object.keys(defs)) if (T[k] !== defs[k]) out[k] = T[k];
  return out;
}

export function provenance(world, extra = {}) {
  let commit = "unknown", dirty = false;
  try {
    commit = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
    dirty = execSync("git status --porcelain -- src/", { encoding: "utf8" }).trim().length > 0;
  } catch { /* not a repo — fine */ }
  return { commit, dirtySrc: dirty, seed: world.seed, tw: world.tw, th: world.th,
    step: world.step, year: Math.round(stepToYear(world.step)), levers: leverDiff(), ...extra };
}

/** Realm geometry. Separated so observe.mjs and the diff tools share one definition.
 *  `src` selects WHICH political map: the authoritative _countryOwner, or _ctrlOwner —
 *  the control field the APP ACTUALLY DRAWS when T.CONTROL_FIELD is on (the default).
 *  These are not the same map: measured at the shipped grid, step 9000, the drawn map
 *  claims 1.45x the tiles of the authoritative one and they disagree on 2% of all land.
 *  Measuring only _countryOwner means measuring a map no player ever looks at. */
/** One row per living realm — the per-ENTITY view, as opposed to the distributions
 *  `collect()` returns. Lives here rather than in a tool because trace and observe
 *  both need it and two private definitions of "a realm's size" would drift, which is
 *  the failure the single-collector design exists to prevent. */
export function realmRows(world) {
  const { N, elev } = world;
  let landN = 0; for (let i = 0; i < N; i++) if (elev[i] > 0) landN++;
  const km2 = (510e6 * 0.29) / Math.max(1, landN);
  const co = world._countryOwner, held = new Map();
  if (co) for (let i = 0; i < N; i++) { if (!(elev[i] > 0)) continue; const c = co[i]; if (c >= 0) held.set(c, (held.get(c) || 0) + 1); }
  const rows = [];
  if (world.countries) for (const [cid, c] of world.countries) {
    if (!c.capital) continue;
    let people = 0, wealth = 0;
    for (const m of c.members || []) { people += m.people || 0; wealth += m.wealth || 0; }
    const p = world.polities?.get?.(cid);
    const tiles = held.get(cid) || 0;
    rows.push({ id: cid, name: p?.name || `#${cid}`, tiles, km2: tiles * km2, people, wealth,
      members: (c.members || []).length, power: world._countryPow?.get(cid) || 0,
      foundedStep: p?.foundedStep ?? -1, overlord: p?._overlord ?? -1,
      // ADMINISTRATIVE STRAIN — load ÷ capacity, the quantity that decides whether a
      // realm sheds its frontier. Added because the question "why do the largest
      // realms plateau instead of shattering?" could not be answered from an entity
      // trace that recorded only size: strain is the mechanism, area is the symptom,
      // and the two had to be joined by hand from a separate run.
      strain: p?._strain ?? -1, capacity: c._capacity ?? -1,
      loadTotal: c._loadTotal ?? -1, momentum: c._momentum ?? 0,
      // T.STATE_WORKS: the maintained infrastructure stock and the reach it
      // buys. Recorded for the same reason strain was — "why did this realm
      // reach so far, and why did it stop?" is a question about the STOCK,
      // while area is only its symptom; a realm whose works are decaying is
      // mid-collapse several passes before its borders show it.
      works: p?._works ?? 0, range: c.range ?? -1 });
  }
  rows.sort((a, b) => b.tiles - a.tiles);
  return rows;
}

export function shapeOf(world, src) {
  const { tw, th, N, elev } = world, co = src || world._countryOwner;
  const rows = [];
  if (!co) return rows;
  const tiles = new Map();
  for (let i = 0; i < N; i++) { if (!(elev[i] > 0)) continue; const c = co[i]; if (c >= 0) { let a = tiles.get(c); if (!a) tiles.set(c, a = []); a.push(i); } }
  const nb4 = (i) => { const y = (i / tw) | 0, x = i - y * tw; const o = [y * tw + ((x + 1) % tw), y * tw + ((x - 1 + tw) % tw)]; if (y > 0) o.push(i - tw); if (y < th - 1) o.push(i + tw); return o; };
  const nb8 = (i) => { const y = (i / tw) | 0, x = i - y * tw; const o = []; for (let dy = -1; dy <= 1; dy++) { const ny = y + dy; if (ny < 0 || ny >= th) continue; for (let dx = -1; dx <= 1; dx++) { if (!dx && !dy) continue; o.push(ny * tw + ((x + dx + tw) % tw)); } } return o; };
  for (const [cid, arr] of tiles) {
    const own = new Set(arr);
    let perim = 0; const nbrs = new Set();
    for (const i of arr) for (const n of nb4(i)) { if (own.has(n)) continue; perim++; const o = co[n]; if (o >= 0 && o !== cid) nbrs.add(o); }
    const seen = new Set(); let comps = 0, biggest = 0;
    for (const s0 of arr) { if (seen.has(s0)) continue; comps++; let sz = 0; const st = [s0]; seen.add(s0);
      while (st.length) { const i = st.pop(); sz++; for (const n of nb8(i)) if (own.has(n) && !seen.has(n)) { seen.add(n); st.push(n); } } if (sz > biggest) biggest = sz; }
    const c = world.countries?.get(cid), cap = c?.capital;
    const sx = cap ? (cap.pos.x | 0) : (arr[0] % tw), sy = cap ? (cap.pos.y | 0) : ((arr[0] / tw) | 0);
    const xs = [], ys = []; let mx = 0, my = 0;
    for (const i of arr) { const y = (i / tw) | 0; let dx = (i - y * tw) - sx; if (dx > tw / 2) dx -= tw; if (dx < -tw / 2) dx += tw; xs.push(dx); ys.push(y - sy); mx += dx; my += y - sy; }
    mx /= arr.length; my /= arr.length;
    let sxx = 0, syy = 0, sxy = 0, rg = 0;
    for (let j = 0; j < xs.length; j++) { const a = xs[j] - mx, b = ys[j] - my; sxx += a * a; syy += b * b; sxy += a * b; rg += xs[j] ** 2 + ys[j] ** 2; }
    sxx /= arr.length; syy /= arr.length; sxy /= arr.length;
    const tr = sxx + syy, det = sxx * syy - sxy * sxy, disc = Math.max(0, tr * tr / 4 - det);
    const l1 = tr / 2 + Math.sqrt(disc), l2 = Math.max(1e-9, tr / 2 - Math.sqrt(disc));
    let holes = 0;
    for (const i of arr) for (const n of nb4(i)) { if (own.has(n) || !(elev[n] > 0) || co[n] >= 0) continue; if (nb4(n).every(m => own.has(m) || !(elev[m] > 0))) holes++; }
    rows.push({ id: cid, tiles: arr.length, perim,
      compact: perim > 0 ? (4 * Math.PI * arr.length) / (perim * perim) : 0,
      frags: comps, mainShare: biggest / arr.length,
      elong: Math.sqrt(l1 / l2), spread: Math.sqrt(rg / arr.length), holes, nbrs: nbrs.size,
      nbrSet: nbrs });   // kept, not just counted — graphOf builds the realm adjacency from it
  }
  rows.sort((a, b) => b.tiles - a.tiles);
  return rows;
}

// ── NETWORK TOPOLOGY — the structures that were only ever COUNTED ────────────
//
// `_overlordOf.size = 16` is the same integer for a sixteen-wide star under one
// hegemon and a four-deep tributary chain, and those are completely different
// worlds. That mattered more than it looked: reading the sim's own chronicle
// established that consolidation here runs almost entirely through VASSALAGE
// (16 `polity.submitted` against 0 annexations over 16k steps), which makes the
// tributary tree the most consequential political structure in the world — and
// the entire measurement of it was one integer printed in observe's WAR line.
//
// It also resolves the standing paradox directly. Realm COUNT rises while one
// realm's `_dominance` towers 6-9x over the median, and the map reads fragmented,
// because a tributary is INVISIBLE on the political map. `vassal.blocLandPct` —
// the share of claimed land inside the largest bloc, suzerain plus every
// descendant — is the number that says whether the world is actually fragmented
// or merely drawn that way.
const compStats = (adj) => {
  // Undirected connected components over an adjacency Map(id -> iterable of ids).
  const seen = new Set(); let comps = 0, largest = 0;
  for (const a of adj.keys()) {
    if (seen.has(a)) continue;
    comps++; let n = 0; const st = [a]; seen.add(a);
    while (st.length) { const x = st.pop(); n++;
      for (const y of (adj.get(x) || [])) if (!seen.has(y)) { seen.add(y); st.push(y); } }
    if (n > largest) largest = n;
  }
  return { comps, largest, nodes: seen.size };
};

/** Topology of every network the world carries. `held` maps realm id -> tile count
 *  (so a bloc can be weighed in LAND, not just member count); `shape` is a shapeOf()
 *  result to reuse rather than recompute — it is the expensive part. Both optional. */
export function graphOf(world, held, shape) {
  const g = {};
  const totalHeld = held ? [...held.values()].reduce((a, b) => a + b, 0) : 0;

  // ── the tributary tree ─────────────────────────────────────────────────────
  const ov = world._overlordOf;
  if (ov && ov.size >= 0) {
    const kids = new Map();                       // suzerain -> [deps]
    for (const [dep, sz] of ov) { let a = kids.get(sz); if (!a) kids.set(sz, a = []); a.push(dep); }
    // Depth: hops from each dependency up to its root. Bounded by the bond count —
    // bendTheKnee refuses cycles, but a corrupt save must not hang the collector.
    const depths = [];
    for (const dep of ov.keys()) {
      let d = 0, up = dep;
      while (ov.has(up) && d <= ov.size) { up = ov.get(up); d++; }
      depths.push(d);
    }
    // Roots: a suzerain that is nobody's dependency. Its bloc is its whole subtree.
    const roots = [...kids.keys()].filter(k => !ov.has(k));
    let blocMax = 0, blocLandMax = 0;
    for (const r of roots) {
      let members = 0, land = held ? (held.get(r) || 0) : 0;
      const st = [r]; const seen = new Set([r]);
      while (st.length) {
        const x = st.pop(); members++;
        for (const k of (kids.get(x) || [])) if (!seen.has(k)) { seen.add(k); land += held ? (held.get(k) || 0) : 0; st.push(k); }
      }
      if (members > blocMax) blocMax = members;
      if (land > blocLandMax) blocLandMax = land;
    }
    const branch = [...kids.values()].map(a => a.length);
    const realms = world.countries ? world.countries.size : 0;
    g["vassal.bonds"] = ov.size;
    g["vassal.suzerains"] = kids.size;
    g["vassal.roots"] = roots.length;
    g["vassal.depthMax"] = depths.length ? Math.max(...depths) : 0;
    g["vassal.depthMean"] = depths.length ? depths.reduce((a, b) => a + b, 0) / depths.length : 0;
    // A bond whose suzerain is ITSELF somebody's dependency — the pyramid, not the star.
    g["vassal.subvassalPct"] = ov.size ? 100 * [...ov.values()].filter(s => ov.has(s)).length / ov.size : 0;
    g["vassal.branchMax"] = branch.length ? Math.max(...branch) : 0;
    g["vassal.blocMaxRealms"] = blocMax;
    g["vassal.blocPctRealms"] = realms ? 100 * blocMax / realms : 0;
    g["vassal.blocLandPct"] = totalHeld ? 100 * blocLandMax / totalHeld : 0;
    // How much of the world is inside SOME bloc at all — sovereignty's real extent.
    g["vassal.dependentPctRealms"] = realms ? 100 * ov.size / realms : 0;
  }

  // ── the alliance graph ─────────────────────────────────────────────────────
  if (world._allies) {
    const deg = [...world._allies.values()].map(s => s.size);
    const cst = compStats(world._allies);
    const realms = world.countries ? world.countries.size : 0;
    g["alliance.edgesNodes"] = world._allies.size;
    g["alliance.degMean"] = deg.length ? deg.reduce((a, b) => a + b, 0) / deg.length : 0;
    g["alliance.degMax"] = deg.length ? Math.max(...deg) : 0;
    g["alliance.components"] = cst.comps;
    g["alliance.largestPct"] = realms ? 100 * cst.largest / realms : 0;
    g["alliance.unalliedPct"] = realms ? 100 * (realms - cst.nodes) / realms : 0;
  }

  // ── the trade graph (settlement links) ─────────────────────────────────────
  const lm = world._linkMoney;
  if (lm && lm.size) {
    const adj = new Map(); const flows = [];
    for (const [key, v] of lm) {
      const c = key.indexOf(":"); if (c < 0) continue;
      const a = +key.slice(0, c), b = +key.slice(c + 1);
      if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
      let sa = adj.get(a); if (!sa) adj.set(a, sa = new Set()); sa.add(b);
      let sb = adj.get(b); if (!sb) adj.set(b, sb = new Set()); sb.add(a);
      flows.push(Math.abs(v));
    }
    const cst = compStats(adj);
    const deg = [...adj.values()].map(s => s.size);
    flows.sort((a, b) => b - a);
    const tot = flows.reduce((a, b) => a + b, 0);
    const top = flows.slice(0, Math.max(1, Math.ceil(flows.length * 0.1))).reduce((a, b) => a + b, 0);
    g["trade.links"] = lm.size;
    g["trade.nodes"] = adj.size;
    g["trade.degMean"] = deg.length ? deg.reduce((a, b) => a + b, 0) / deg.length : 0;
    g["trade.degMax"] = deg.length ? Math.max(...deg) : 0;
    g["trade.components"] = cst.comps;
    g["trade.largestPct"] = adj.size ? 100 * cst.largest / adj.size : 0;
    // Concentration: is commerce a web, or a handful of arteries carrying everything?
    g["trade.top10FlowPct"] = tot > 0 ? 100 * top / tot : 0;
  }

  // ── the realm adjacency graph: how many separate political WORLDS? ─────────
  // `shape.isolatedPct` counts realms touching nobody; this counts the CLUSTERS.
  // Two realms that border each other but nobody else are not isolated, and are
  // also not part of the same history as the rest of the map.
  const sh = shape || shapeOf(world);
  if (sh.length) {
    const adj = new Map();
    for (const r of sh) adj.set(r.id, r.nbrSet || new Set());
    const cst = compStats(adj);
    g["realmnet.components"] = cst.comps;
    g["realmnet.largestPct"] = 100 * cst.largest / sh.length;
  }

  // ── the road network: one system, or disconnected stubs? ──────────────────
  const rt = world._roadTiles;
  if (rt && rt.size) {
    const { tw, th } = world;
    const seen = new Set(); let comps = 0, largest = 0;
    for (const s0 of rt) {
      if (seen.has(s0)) continue;
      comps++; let n = 0; const st = [s0]; seen.add(s0);
      while (st.length) {
        const i = st.pop(); n++;
        const y = (i / tw) | 0, x = i - y * tw;
        for (let dy = -1; dy <= 1; dy++) { const ny = y + dy; if (ny < 0 || ny >= th) continue;
          for (let dx = -1; dx <= 1; dx++) { if (!dx && !dy) continue;
            const j = ny * tw + ((x + dx + tw) % tw);
            if (rt.has(j) && !seen.has(j)) { seen.add(j); st.push(j); } } }
      }
      if (n > largest) largest = n;
    }
    g["road.tiles"] = rt.size;
    g["road.components"] = comps;
    g["road.largestPct"] = 100 * largest / rt.size;
    g["road.meanCompSize"] = rt.size / Math.max(1, comps);
  }

  // ── the liege tree INSIDE realms (settlement hierarchy, not realm hierarchy) ─
  const settled = world.settlements ? world.settlements.filter(s => s.mode === "settled") : [];
  const byId = new Map(settled.map(s => [s.id, s]));
  const ld = [];
  for (const s of settled) {
    if (!(s.liegeId >= 0)) continue;
    let d = 0, up = s;
    while (up && up.liegeId >= 0 && d <= settled.length) { up = byId.get(up.liegeId); d++; }
    ld.push(d);
  }
  g["liege.bonds"] = ld.length;
  g["liege.depthMax"] = ld.length ? Math.max(...ld) : 0;
  g["liege.depthMean"] = ld.length ? ld.reduce((a, b) => a + b, 0) / ld.length : 0;
  return g;
}

// ── LIFECYCLE — birth, death and SURVIVAL of entities ────────────────────────
//
// Every other metric here is a snapshot of the population that EXISTS. That cannot
// answer the question the sim is actually for: do realms rise and fall? A snapshot
// of survivors has no lifespans in it, and a mean lifespan computed over a
// population that is still mostly alive is not a number, it is a lie.
//
// Two facts about this codebase make it computable with NO new recording:
//   * `entities.js` — "Records are never deleted. A fallen realm keeps its record
//     (endedStep set)". So `endedStep − foundedStep` IS the lifespan, exactly, for
//     every polity that ever existed.
//   * the EVENT LOG is the wrong place to get this: events.js caps at 200,000 and
//     splices the oldest 50,000, so a long run silently deletes its early history
//     and leaves deaths whose births have been pruned away.
//
// RIGHT-CENSORING IS HANDLED, because getting it wrong is how survival statistics
// mislead: an entity founded 500 steps ago tells you nothing about 4,000-step
// survival. Each horizon's denominator is only those entities that have HAD THE
// CHANCE to reach it, and a horizon with no eligible entities emits no metric at
// all rather than a fake 0%.
//
// Everything is in STEPS. The displayed year is cosmetic (FIRST CARDINAL RULE) and
// must never be the unit of a mechanism OR of a measurement compared across runs.
const BIRTH_FIELDS = ["foundedStep", "bornStep", "born", "createdStep"];
const DEATH_FIELDS = ["endedStep", "diedStep", "died", "fadedStep"];
const SURVIVAL_HORIZONS = [1000, 4000, 16000];

/** Lifecycle of every entity class that stamps a birth step. */
export function lifecycleOf(world) {
  const g = {};
  const CLASSES = [["polity", world.polities], ["faith", world.faiths],
    ["dynasty", world.dynasties], ["culture", world.cultures],
    ["lang", world.languages], ["person", world.persons]];
  for (const [name, reg] of CLASSES) {
    if (!reg) continue;
    const items = (reg instanceof Map ? [...reg.values()] : Array.isArray(reg) ? reg : [])
      .filter(x => x && typeof x === "object");
    if (!items.length) continue;
    // Field names differ per class (foundedStep/endedStep, born/died, bornStep/…).
    // Detected against the live records rather than hard-coded per class, and
    // scanning ALL items because the first one may not carry the stamp.
    const has = (f) => items.some(it => Number.isFinite(it[f]));
    const bf = BIRTH_FIELDS.find(has);
    if (!bf) continue;                          // undated class — nothing to say
    const df = DEATH_FIELDS.find(has);

    const lifespans = [], ages = [];
    for (const it of items) {
      const b = it[bf]; if (!Number.isFinite(b)) continue;
      const d = df ? it[df] : undefined;
      // Convention throughout this sim: a negative death stamp means STILL ALIVE
      // (endedStep = −1, died = −1). Absent is alive too.
      if (Number.isFinite(d) && d >= 0) lifespans.push(d - b);
      else ages.push(world.step - b);
    }
    // `known`, NOT `born` — and this is the SECOND time the same defect appeared.
    // It counts records the registry currently HOLDS, and dynasties.js reclaims dead
    // unreferenced persons and extinct dynasty husks, so the number falls. Called
    // `born` it claimed a birth count and `npm run monotone` caught it decreasing at
    // 50,000 steps: life.person.born 20,758 → 20,651, life.dynasty.born 221 → 219.
    // Exactly the trap `died` → `endedNow` had just been renamed out of, one field
    // over, found by the gate built for the first one.
    g[`${name}.known`] = lifespans.length + ages.length;
    // NAMED `endedNow`, NOT `died`, and that is the whole lesson of this block: it
    // counts records CURRENTLY marked ended, and restoration clears the flag. Called
    // `died` it read as a death toll, went 0 while two realms had fallen and been
    // restored, and carried a wrong headline finding for a session. A metric's name
    // is a CLAIM about what it answers; make the claim the metric can keep.
    g[`${name}.endedNow`] = lifespans.length;
    g[`${name}.alive`] = ages.length;
    g[`${name}.turnoverPct`] = (lifespans.length + ages.length)
      ? 100 * lifespans.length / (lifespans.length + ages.length) : 0;
    if (lifespans.length) dist(`${name}.lifespan`, lifespans, g);
    if (ages.length) dist(`${name}.age`, ages, g);

    for (const H of SURVIVAL_HORIZONS) {
      let eligible = 0, survived = 0;
      for (const it of items) {
        const b = it[bf]; if (!Number.isFinite(b)) continue;
        if (world.step - b < H) continue;       // right-censored: no chance yet
        eligible++;
        const d = df ? it[df] : undefined;
        const life = (Number.isFinite(d) && d >= 0) ? d - b : world.step - b;
        if (life >= H) survived++;
      }
      // No metric at all when nobody could have reached the horizon — a 0% here
      // would read as "everything dies young" when it means "the run is short".
      if (eligible > 0) g[`${name}.survival${H / 1000}k`] = 100 * survived / eligible;
    }

    // ── CURRENTLY-DEAD IS NOT DEATHS-EVER ────────────────────────────────────
    // The bug this block exists to fix, and it invalidated a headline finding for
    // most of a session. `died` above counts records whose endedStep is set — but
    // entities.js:103 CLEARS endedStep when an old realm re-forms under its id
    // ("re-opened: an old nation re-forming"). So a realm that fell and was later
    // restored reads as never having died at all. Measured at the app grid, 12,000
    // steps: seed 8817 logged TWO `polity.ended` events and reported died = 0,
    // because both were restored. "Nothing has ever died" was an artefact of asking
    // the records a question they do not answer.
    //
    // The event log is the only cumulative source, and it was deliberately rejected
    // earlier in this file for pruning at 200k — that reasoning was right about
    // LIFESPANS (which need the founding too) and wrong about COUNTS. Both are kept,
    // labelled: `.died` is a state, `.endedEver` is a history with a known horizon.
    const DEATH_EVENT = { polity: "polity.ended", faith: "faith.faded", dynasty: "dynasty.extinct" };
    const ek = DEATH_EVENT[name];
    if (ek) {
      let ended = 0, restored = 0;
      for (const e of (world.events || [])) {
        const k = e.kind || e.type;
        if (k === ek) ended++;
        else if (name === "polity" && k === "polity.restored") restored++;
      }
      g[`${name}.endedEver`] = ended;
      if (name === "polity") {
        g[`${name}.restoredEver`] = restored;
        // Deaths the record no longer remembers — the size of the discrepancy above.
        g[`${name}.diedThenRestored`] = Math.max(0, ended - lifespans.length);
      }
    }

    // ── SAMPLING HONESTY ─────────────────────────────────────────────────────
    // Not every registry is permanent: dynasties.js reclaims dead unreferenced
    // persons and extinct dynasty husks. For those classes the live registry is a
    // SAMPLE OF SURVIVORS, so every number above is conditioned on retention and
    // must say so rather than quietly degrade as a run gets longer.
    //
    // The count of records EVER MINTED is the world's own monotone counter, whose
    // name follows the codebase convention `_next<Class>Id` — derived from the class
    // name, so a new registry following the same convention is covered with no edit.
    // FAILS SAFE: a class with no such counter (polities take their id from the
    // country, so the ids are sparse by construction and never dense) emits NO
    // metric, instead of an id-span heuristic that would have read 23% retention on
    // a registry whose own header promises records are never deleted.
    const counter = world[`_next${name[0].toUpperCase()}${name.slice(1)}Id`];
    if (Number.isFinite(counter)) {
      // The true ever-born count, from the same monotone counter — the history
      // `known` cannot give once records start being reclaimed.
      g[`${name}.bornEver`] = Math.max(0, counter - 1);
      let lo = Infinity, n = 0;
      for (const it of items) if (Number.isFinite(it.id)) { if (it.id < lo) lo = it.id; n++; }
      const everMinted = counter - (Number.isFinite(lo) ? lo : 0);
      if (n && everMinted > 0) g[`${name}.retainedPct`] = 100 * n / Math.max(n, everMinted);
    }
  }
  return g;
}

/** The exhaustive flat metric map. */
export function collect(world) {
  const m = {};
  const { N, elev } = world;
  const land = []; for (let i = 0; i < N; i++) if (elev[i] > 0) land.push(i);
  const km2 = (510e6 * 0.29) / land.length;
  const settled = world.settlements.filter(s => s.mode === "settled");
  const co = world._countryOwner, held = new Map();
  let claimed = 0;
  if (co) for (const i of land) { const c = co[i]; if (c >= 0) { claimed++; held.set(c, (held.get(c) || 0) + 1); } }

  // headline
  m["run.step"] = world.step;
  m["run.landTiles"] = land.length;
  m["run.km2PerTile"] = km2;
  m["realm.count"] = world.countries ? world.countries.size : 0;
  m["realm.claimedPct"] = 100 * claimed / Math.max(1, land.length);
  m["realm.claimedKm2"] = claimed * km2;
  m["entity.settled"] = settled.length;
  m["entity.stateless"] = settled.filter(s => s.countryId < 0).length;
  const areas = [...held.values()].map(t => t * km2);
  dist("realm.areaKm2", areas, m);
  let pf = 0; if (world.popField) for (const i of land) pf += world.popField[i];
  // ── POPULATION, IN REAL PEOPLE ─────────────────────────────────────────────
  // `pop.people` is THE number to quote: the settlement census scaled by
  // POP_SCALE, which is exactly what the game shows the player. Everything else
  // here is named for its unit so it cannot be mistaken for a headcount again —
  // a 50k analysis was published claiming 32M people and a city "smaller than
  // Çatalhöyük" because `pop.census` (sim units) and `pop.field` (a THIRD scale,
  // bridged by _onePopScale) were read as people. True figures: 135M and a
  // 4.4-million metropolis. See src/sim/units.js.
  const censusSim = settled.reduce((a, s) => a + (s.people || 0), 0);
  m["pop.people"] = censusSim * POP_SCALE;                        // ← real people
  m["pop.perKm2"] = (censusSim * POP_SCALE) / Math.max(1, land.length * km2);
  m["pop.largestCity"] = settled.reduce((a, s) => Math.max(a, s.people || 0), 0) * POP_SCALE;
  m["pop.urbanPeople"] = settled.reduce((a, s) => a + (s._urbanPop || 0), 0) * POP_SCALE;
  m["pop.censusSimUnits"] = censusSim;                            // raw, NOT people
  m["pop.fieldUnits"] = pf;                                       // a third scale, NOT people
  m["pop.fieldPerKm2Units"] = pf / Math.max(1, land.length * km2);
  m["pop.bridge"] = world._onePopScale || 0;

  // ── the pre-urban land ledger (T.LAND_KNOW, landKnow.js) ───────────────────
  // The countryside's own knowledge while no court exists — the ladder the
  // first cities are born from (the tally bar gates both minting doors). All
  // zero in the pinned mature regime, where the lever is off and no ledger is
  // ever planted; instantaneous maxima, no cumulative-history claim.
  {
    const lk = world._landKnow;
    m["landKnow.records"] = lk ? lk.size : 0;
    let mo = 0, mm = 0, mc = 0;
    if (lk) for (const r of lk.values()) {
      if (r.k.organization > mo) mo = r.k.organization;
      if (r.k.metallurgy > mm) mm = r.k.metallurgy;
      if (r.k.construction > mc) mc = r.k.construction;
    }
    m["landKnow.maxOrg"] = mo;
    m["landKnow.maxMetallurgy"] = mm;
    m["landKnow.maxConstruction"] = mc;
    m["landKnow.era"] = world._lkEra || 0;
  }

  // every tile field — and every OTHER typed array too. The old test was
  // `v.length !== N → skip`, which silently dropped `_popLand[9616]`: a real
  // per-LAND-tile population field whose length is the land count, not N. A
  // length test is a shape assumption, and this collector has now been caught
  // by a shape assumption three times.
  const landIdx = (a) => { const o = new Array(land.length); for (let j = 0; j < land.length; j++) o[j] = a[land[j]]; return o; };
  for (const k of Object.keys(world)) {
    const v = world[k];
    if (!ArrayBuffer.isView(v) || WORLD_SCRATCH.has(k)) continue;
    if (v.length === N) dist(`field.${k}`, landIdx(v), m);
    else if (v.length === land.length) dist(`field.${k}`, Array.from(v), m);  // already land-indexed
    // Anything else is a list or a table: its distribution is mostly meaningless
    // (`_coastList` holds tile indices) but `.n` is not — that is the only record
    // anywhere of how many coast tiles the world has.
    else dist(`vec.${k}`, Array.from(v), m);
  }

  // ── THE WORLD OBJECT ITSELF ────────────────────────────────────────────────
  // Audited at 9,000 steps: of 61 numeric scalars sitting directly on `world`,
  // the collector read exactly ZERO. Not a shortfall — a whole category missed,
  // because the walk only ever looked for typed arrays of length N and objects
  // inside registries. Among the misses were every REFERENCE SCALE the sim
  // calibrates itself against (`_refCapPower`, `_refRevenue`, `_refRealmPop`,
  // `_musterRatio`, `_provRatio`, `_fortRef`, `_tierScale`) — precisely the
  // "has a constant become the answer?" quantities the SECOND CARDINAL RULE is
  // about — plus `_leadOrg`, `_topUrban`, `_townBar`, `_cityBar`, `_popTotal`.
  //
  // Plain objects on the world were dark too, and one of them mattered a lot:
  // `deposits` holds FOURTEEN per-tile arrays (timber, stone, copper, tin, iron,
  // coal, horses, salt, precious, gems, …) and `depositReserve` holds what is
  // left of the depletable ones. The world's entire resource endowment — the
  // input the whole mining and metal economy runs on — was unmeasured.
  for (const k of Object.keys(world)) {
    const v = world[k];
    if (WORLD_SCRATCH.has(k)) continue;
    if (typeof v === "number" && Number.isFinite(v)) { m[`world.${k}`] = v; continue; }
    if (!v || typeof v !== "object") continue;
    if (ArrayBuffer.isView(v) || Array.isArray(v) || v instanceof Map || v instanceof Set) continue;
    if (isEntityRef(v)) continue;          // `_lastInheritDonor` is a settlement
    for (const kk of Object.keys(v)) {
      const vv = v[kk];
      // A tile field hiding inside a bag is still a tile field.
      if (ArrayBuffer.isView(vv) && vv.length === N) { dist(`field.${k}.${kk}`, landIdx(vv), m); continue; }
      if (typeof vv === "number" && Number.isFinite(vv)) m[`world.${k}.${kk}`] = vv;
      else if (vv instanceof Map || vv instanceof Set) m[`world.${k}.${kk}.size`] = vv.size;
    }
  }
  // every numeric leaf on settlements / countries / polity records, DEPTH 2
  const cs = world.countries ? [...world.countries.values()].filter(c => c.capital) : [];
  const ps = world.polities ? [...world.polities.values()] : [];
  entityDists("sett", settled, m);
  entityDists("nation", cs, m);
  entityDists("polity", ps, m);
  // …and the PEOPLES half of the sim, which was counted and never characterised.
  // Depth-2 fixed the collector one level DOWN; this fixes the identical hole one
  // level OUT — it measured three entity classes of eight, so `count.cultures = 23`
  // was the entire measurement of a culture. 36.5% of the world's distinct numeric
  // entity state sat outside the collector, concentrated in exactly these registries
  // (persons is the largest AND the fastest-growing: 456 at 6k steps on the reference
  // grid, ~23,700 in a long run). Two design docs describe language systems that no
  // standing instrument had ever read.
  for (const [prefix, reg] of [["culture", world.cultures], ["lang", world.languages],
       ["faith", world.faiths], ["dynasty", world.dynasties], ["person", world.persons]]) {
    if (!reg) continue;
    const items = reg instanceof Map ? [...reg.values()] : Array.isArray(reg) ? reg : null;
    if (items && items.length) entityDists(prefix, items.filter(x => x && typeof x === "object"), m);
  }
  // The DAWN's two live registries, reachable at gate horizons since the
  // package-biogeography flip slowed hearth maturation to the real stagger
  // (2026-08-07): armed hearth candidates still serving peopled-basin time, and
  // land-nation seats awaiting a city. Both are persisted cross-tick state, so
  // they are MEASURED, not pass-listed. "Now" naming: point-in-time gauges
  // (an armed hearth ignites and LEAVES; a land seat materialises and leaves) —
  // never cumulative-history claims, so the monotone gate has nothing to bite.
  if (world._armedHearths && world._armedHearths.length) {
    m["hearth.armedNow"] = world._armedHearths.length;
    entityDists("hearthArmed", world._armedHearths, m);
  }
  if (world._landSeats && world._landSeats.size) {
    m["nation.landSeatsNow"] = world._landSeats.size;
    entityDists("landSeat", [...world._landSeats.values()], m);
  }
  // Dev-wave GROUND SOURCES (T.CITY_AT_BIRTH seedless dawns): each hearth
  // invention stamps its basin's peopled tiles as technique-wave sources
  // ({ti, agri}, persisted; crystallize.js → popField stampDevSources). Their
  // downstream effect is the devField, but the sources themselves are durable
  // state — measured, not pass-listed. "Now" naming (sources accumulate but
  // agri levels move), so the monotone gate reads only the gauge.
  if (world._hearthSeeds && world._hearthSeeds.length) {
    m["hearth.devSourcesNow"] = world._hearthSeeds.length;
    entityDists("hearthSeed", world._hearthSeeds, m);
  }

  // ── EVENT PAYLOAD MAGNITUDES ───────────────────────────────────────────────
  // `event.<kind>` counts how often a thing happened; it cannot say how BIG. A run
  // with two catastrophic famines and one with two mild ones are identical in the
  // histogram. This distributes the numeric payload per kind.
  //
  // Most payload fields are IDENTIFIERS, though — measured over a 6k-step run, `id`
  // appears 260 times, `polity` 191, `s` 172, `x`/`y` 138 each, against `people` 5
  // and `dead` 2. Distributing an id yields a number that moves whenever entities are
  // renumbered, which would pollute abtest's effect ranking with pure noise. So ids
  // are excluded by name — a semantic distinction that cannot be detected, exactly
  // like observe's SCRATCH set, and FAILING OPEN the same way: an unknown field is
  // treated as a magnitude and measured, so a new one shows up by default instead of
  // hiding. `step` is always kept: WHEN a kind of event fires is a real outcome.
  const EVENT_IDS = new Set(["id", "polity", "s", "x", "y", "parent", "culture", "from",
    "to", "dynasty", "person", "person2", "seat", "faith", "faithId", "lang", "language",
    "cultureId", "settlement", "target", "attacker", "defender", "ruler", "house"]);
  const evByKind = new Map();
  for (const e of (world.events || [])) {
    const k = e.kind || e.type; if (!k) continue;
    let a = evByKind.get(k); if (!a) evByKind.set(k, a = []);
    a.push(e);
  }
  for (const [kind, evs] of evByKind) {
    const fields = new Set();
    for (const e of evs) for (const f of Object.keys(e)) if (numeric(e[f]) && !EVENT_IDS.has(f)) fields.add(f);
    for (const f of fields) dist(`eventv.${kind}.${f}`, evs.map(e => numeric(e[f]) ? e[f] : 0), m);
  }

  // realm geometry — for BOTH political maps: the authoritative one the sim reasons
  // over, and the control field the player actually sees rendered.
  const GEO = ["compact", "frags", "mainShare", "elong", "spread", "holes", "nbrs", "perim"];
  const sh = shapeOf(world);
  for (const key of GEO) dist(`shape.${key}`, sh.map(r => r[key]), m);
  m["shape.isolatedRealms"] = sh.filter(r => r.nbrs === 0).length;
  m["shape.isolatedPct"] = 100 * sh.filter(r => r.nbrs === 0).length / Math.max(1, sh.length);
  if (world._ctrlOwner && world._ctrlOwner.length === N) {
    const shc = shapeOf(world, world._ctrlOwner);
    for (const key of GEO) dist(`drawn.${key}`, shc.map(r => r[key]), m);
    m["drawn.realmCount"] = shc.length;
    m["drawn.isolatedPct"] = 100 * shc.filter(r => r.nbrs === 0).length / Math.max(1, shc.length);
    let dc = 0, dd = 0;
    for (const i of land) { if (world._ctrlOwner[i] >= 0) dc++; if (world._ctrlOwner[i] !== (co ? co[i] : -1)) dd++; }
    m["drawn.claimedPct"] = 100 * dc / Math.max(1, land.length);
    m["drawn.disagreePct"] = 100 * dd / Math.max(1, land.length);   // drawn vs authoritative
  }
  // network topology — the shape of the tributary tree, the alliance / trade
  // graphs, the realm adjacency clusters and the road network
  for (const [k, v] of Object.entries(graphOf(world, held, sh))) m[`graph.${k}`] = v;

  // lifecycle — how long things LAST, which no snapshot of survivors can say
  for (const [k, v] of Object.entries(lifecycleOf(world))) m[`life.${k}`] = v;

  // nearest-seat spacing — the "scattered dots" measure
  const seats = cs.filter(c => c.capital?.mode === "settled").map(c => [c.capital.pos.x | 0, c.capital.pos.y | 0]);
  const nn = [];
  for (let a = 0; a < seats.length; a++) { let best = Infinity;
    for (let b = 0; b < seats.length; b++) { if (a === b) continue; let dx = Math.abs(seats[a][0] - seats[b][0]); if (dx > world.tw / 2) dx = world.tw - dx; const d = Math.hypot(dx, seats[a][1] - seats[b][1]); if (d < best) best = d; }
    if (Number.isFinite(best)) nn.push(best); }
  dist("shape.nearestSeat", nn, m);

  // collections + chronicle + debug counters
  for (const k of Object.keys(world)) { const v = world[k];
    if (v instanceof Map || v instanceof Set) m[`count.${k}`] = v.size;
    else if (Array.isArray(v)) m[`count.${k}`] = v.length; }
  for (const e of (world.events || [])) { const k = `event.${e.kind || e.type}`; m[k] = (m[k] || 0) + 1; }
  for (const [k, v] of Object.entries(world.debug || {})) if (typeof v === "number") m[`debug.${k}`] = v;
  return m;
}

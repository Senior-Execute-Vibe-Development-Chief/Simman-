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

const pct = (sorted, p) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : 0;

function dist(prefix, arr, into) {
  if (!arr.length) return;
  const b = Float64Array.from(arr).sort();
  let sum = 0; for (const v of b) if (Number.isFinite(v)) sum += v;
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
 *  next — so paths are unioned across the whole population before any is measured. */
function discoverPaths(o, paths) {
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
      // by hand, and it is the only thing measurable about an array of non-numbers.
      if (!paths.has(p)) paths.set(p, (e) => (e[k]?.length) || 0);
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
  const paths = new Map();
  for (const it of items) discoverPaths(it, paths);
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
  m["pop.field"] = pf;
  m["pop.perKm2"] = pf / Math.max(1, land.length * km2);
  m["pop.census"] = settled.reduce((a, s) => a + (s.people || 0), 0);
  m["pop.bridge"] = world._onePopScale || 0;

  // every tile field
  for (const k of Object.keys(world)) {
    const v = world[k];
    if (!ArrayBuffer.isView(v) || v.length !== N) continue;
    const a = new Array(land.length);
    for (let j = 0; j < land.length; j++) a[j] = v[land[j]];
    dist(`field.${k}`, a, m);
  }
  // every numeric leaf on settlements / countries / polity records, DEPTH 2
  const cs = world.countries ? [...world.countries.values()].filter(c => c.capital) : [];
  const ps = world.polities ? [...world.polities.values()] : [];
  entityDists("sett", settled, m);
  entityDists("nation", cs, m);
  entityDists("polity", ps, m);

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

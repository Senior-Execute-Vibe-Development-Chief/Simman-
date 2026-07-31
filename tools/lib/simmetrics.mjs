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
//   sett.<key>.{p50,p90,max,sum}          every numeric key present on settlements
//   nation.<key>.{p50,p90,max,sum}        every numeric key on country records
//   polity.<key>.{p50,p90,max,sum}        every numeric key on polity records
//   shape.<metric>.{p50,p90,max}          realm geometry (compactness, frags, …)
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
      elong: Math.sqrt(l1 / l2), spread: Math.sqrt(rg / arr.length), holes, nbrs: nbrs.size });
  }
  rows.sort((a, b) => b.tiles - a.tiles);
  return rows;
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
  // every numeric settlement key
  const skeys = new Set();
  for (const s of settled) for (const k of Object.keys(s)) if (typeof s[k] === "number" && Number.isFinite(s[k])) skeys.add(k);
  for (const k of skeys) dist(`sett.${k}`, settled.map(s => (typeof s[k] === "number" && Number.isFinite(s[k])) ? s[k] : 0), m);
  // every numeric country key
  const cs = world.countries ? [...world.countries.values()].filter(c => c.capital) : [];
  const ckeys = new Set();
  for (const c of cs) for (const k of Object.keys(c)) if (typeof c[k] === "number" && Number.isFinite(c[k])) ckeys.add(k);
  for (const k of ckeys) dist(`nation.${k}`, cs.map(c => (typeof c[k] === "number" && Number.isFinite(c[k])) ? c[k] : 0), m);
  // every numeric polity-record key
  const ps = world.polities ? [...world.polities.values()] : [];
  const pkeys = new Set();
  for (const p of ps) for (const k of Object.keys(p)) if (typeof p[k] === "number" && Number.isFinite(p[k])) pkeys.add(k);
  for (const k of pkeys) dist(`polity.${k}`, ps.map(p => (typeof p[k] === "number" && Number.isFinite(p[k])) ? p[k] : 0), m);

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

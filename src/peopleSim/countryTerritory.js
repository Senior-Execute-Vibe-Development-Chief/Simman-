// ── Country-primary territory (Option B) ─────────────────────────────
//
// world._countryOwner — countryId per tile (-1 = wilderness / water). The land
// a STATE owns, as opposed to the per-settlement food catchments in
// territory.js (owner[]). Two layers:
//
//   CORE    — a settled tile flies the country of the settlement whose
//             catchment it is (owner[]). Refreshed every pass, so capturing or
//             seceding a settlement moves its settled heartland with it (via the
//             existing conquest in conquest.js / armies.js). Settled land is
//             defended by its city; you take the city to take the land.
//   MARCHES — claimed but UNSETTLED frontier the state holds directly. PERSISTENT
//             (survives across passes), grown outward from the core up to a
//             per-country reach budget, capacity-capped. This is the "a state
//             owns land with no settlement on it" land — and the land WAR fights
//             over: marchWarfare() lets a stronger neighbour annex a weaker
//             realm's march tiles, tile by tile (B3).
//
// The rendered border (countryClaim.js relaxClaim) crawls toward this, so all
// of it animates tile-by-tile.

import { localEdgeCost } from "./transport.js";

// March reach (transport-cost) a state projects into wilderness beyond its core:
// MARCH_BASE + capital-organization × MARCH_ORG. Generous + org-scaled — in the
// country-primary model the marches ARE the territory. Total size is bounded by
// the capacity below; this just sets how far the state CAN reach.
const MARCH_BASE = 8;
const MARCH_ORG  = 46;
// Tile capacity = members × (CAP_TILES_BASE + capitalOrg × CAP_TILES_ORG). Over
// it the farthest marches are shed (over-extension pulls back). The real size
// dial: low-org early states hold little (map fragments into many small realms),
// high-org late states hold large regions (world consolidates with the era).
const CAP_TILES_BASE = 200;
const CAP_TILES_ORG  = 1400;
// Frontier warfare: a neighbour must be at least this much stronger to annex a
// march tile, and only this fraction of contestable tiles flip per pass (so
// fronts creep, not collapse). See marchWarfare().
const WAR_DOMINANCE  = 1.2;
const WAR_FLIP_FRAC  = 0.10;
const SQRT2 = Math.SQRT2;

class MinHeap {
  constructor(cap = 4096) { this.ti = new Int32Array(cap); this.d = new Float64Array(cap); this.c = new Int32Array(cap); this.n = 0; this.cap = cap; }
  _grow() { const k = this.cap * 2; const t = new Int32Array(k); t.set(this.ti); this.ti = t; const d = new Float64Array(k); d.set(this.d); this.d = d; const c = new Int32Array(k); c.set(this.c); this.c = c; this.cap = k; }
  push(ti, d, c) { if (this.n >= this.cap) this._grow(); let i = this.n++; this.ti[i] = ti; this.d[i] = d; this.c[i] = c; while (i > 0) { const p = (i - 1) >> 1; if (this.d[p] <= this.d[i]) break; this._sw(p, i); i = p; } }
  _sw(a, b) { const t = this.ti[a]; this.ti[a] = this.ti[b]; this.ti[b] = t; const d = this.d[a]; this.d[a] = this.d[b]; this.d[b] = d; const c = this.c[a]; this.c[a] = this.c[b]; this.c[b] = c; }
  popMin() { const ti = this.ti[0], d = this.d[0], c = this.c[0]; this.n--; if (this.n > 0) { this.ti[0] = this.ti[this.n]; this.d[0] = this.d[this.n]; this.c[0] = this.c[this.n]; let i = 0; for (;;) { const l = i * 2 + 1, r = i * 2 + 2; let b = i; if (l < this.n && this.d[l] < this.d[b]) b = l; if (r < this.n && this.d[r] < this.d[b]) b = r; if (b === i) break; this._sw(b, i); i = b; } } return { ti, d, c }; }
}

// Persistent country territory: refresh core from settlements, keep + grow
// marches, prune orphaned / over-capacity marches. Runs on the territory pass.
export function computeCountryTerritory(world) {
  const { N, tw, th, elev } = world;
  const owner = world._territoryOwner;       // per-settlement food catchments
  const byId = world._byId;
  if (!owner || !byId) return null;
  let co = world._countryOwner;
  if (!co || co.length !== N) { co = world._countryOwner = new Int32Array(N); co.fill(-1); }

  // Per-country: members + the capital (strongest org → march reach + capacity).
  const members = new Map(), capOrg = new Map(), knOf = new Map();
  for (const s of world.settlements) {
    if (s.mode !== "settled") continue;
    const c = s.countryId;
    members.set(c, (members.get(c) || 0) + 1);
    const org = (s.knowledge && s.knowledge.organization) || 0;
    if (!capOrg.has(c) || org > capOrg.get(c)) { capOrg.set(c, org); knOf.set(c, s.knowledge || {}); }
  }

  // Release tiles of dead (member-less) countries and any water — but KEEP the
  // marches of living countries (persistence; that's what lets war stick).
  for (let ti = 0; ti < N; ti++) {
    const c = co[ti];
    if (c >= 0 && (!members.has(c) || elev[ti] <= 0)) co[ti] = -1;
  }

  // CORE: every settled tile flies its settlement's country (refreshed). This
  // also reclaims a march tile that just became someone's settled catchment.
  for (let ti = 0; ti < N; ti++) {
    const oid = owner[ti];
    if (oid < 0 || elev[ti] <= 0) continue;
    const s = byId.get(oid);
    if (s && s.mode === "settled") co[ti] = s.countryId;
  }

  // GROW marches: multi-source Dijkstra SEEDED FROM THE CORE (owner ≥ 0) at cost
  // 0; cost propagates through a country's own owned land (core + existing
  // marches) and CLAIMS unclaimed wilderness within the country budget. Another
  // country's land is a wall (taken only by war). dist[] = cost from the core,
  // used to prune orphaned marches + shed when over capacity.
  const budget = new Map();
  for (const [c, org] of capOrg) budget.set(c, MARCH_BASE + org * MARCH_ORG);
  const dist = world._countryMarchDist && world._countryMarchDist.length === N
    ? world._countryMarchDist : (world._countryMarchDist = new Float64Array(N));
  dist.fill(Infinity);
  const heap = new MinHeap();
  for (let ti = 0; ti < N; ti++) {
    if (owner[ti] >= 0 && co[ti] >= 0) { dist[ti] = 0; heap.push(ti, 0, co[ti]); }   // core seeds
  }
  while (heap.n > 0) {
    const { ti, d, c } = heap.popMin();
    if (d > dist[ti]) continue;
    const bud = budget.get(c) || 0;
    const kn = knOf.get(c);
    const ty = (ti / tw) | 0, tx = ti - ty * tw;
    const xm = tx === 0 ? tw - 1 : tx - 1, xp = tx === tw - 1 ? 0 : tx + 1;
    const ns = [
      ty * tw + xm, ty * tw + xp,
      ty > 0 ? ti - tw : -1, ty < th - 1 ? ti + tw : -1,
      ty > 0 ? (ty - 1) * tw + xm : -1, ty > 0 ? (ty - 1) * tw + xp : -1,
      ty < th - 1 ? (ty + 1) * tw + xm : -1, ty < th - 1 ? (ty + 1) * tw + xp : -1,
    ];
    const mul = [1, 1, 1, 1, SQRT2, SQRT2, SQRT2, SQRT2];
    for (let k = 0; k < 8; k++) {
      const ni = ns[k]; if (ni < 0 || elev[ni] <= 0) continue;
      const oc = co[ni];
      if (oc >= 0 && oc !== c) continue;            // another country's land = wall
      const ec = localEdgeCost(world, ti, ni, kn, true);
      if (ec === Infinity) continue;
      const nd = d + ec * mul[k];
      if (nd > bud) continue;
      if (nd < dist[ni]) {
        dist[ni] = nd;
        if (oc < 0) co[ni] = c;                     // claim unclaimed wilderness for this country
        heap.push(ni, nd, c);
      }
    }
  }

  // Prune orphaned marches (a march no longer reachable from its country's core —
  // e.g. cut off by a war flip) and tally for the capacity check. Settled core
  // (owner ≥ 0) is never pruned or shed here.
  const total = new Map();
  const marchesOf = new Map();
  for (let ti = 0; ti < N; ti++) {
    const c = co[ti]; if (c < 0) continue;
    if (owner[ti] >= 0) { total.set(c, (total.get(c) || 0) + 1); continue; }   // core
    if (!isFinite(dist[ti])) { co[ti] = -1; continue; }                        // orphaned march → wilderness
    total.set(c, (total.get(c) || 0) + 1);
    let a = marchesOf.get(c); if (!a) marchesOf.set(c, a = []); a.push(ti);
  }
  for (const [c, tot] of total) {
    const cap = (members.get(c) || 1) * (CAP_TILES_BASE + (capOrg.get(c) || 0) * CAP_TILES_ORG);
    if (tot <= cap) continue;
    const marches = marchesOf.get(c); if (!marches) continue;
    marches.sort((a, b) => dist[b] - dist[a]);     // farthest from core shed first
    let shed = tot - cap;
    for (const ti of marches) { if (shed <= 0) break; co[ti] = -1; shed--; }
  }
  return co;
}

// ── Frontier warfare (B3) ────────────────────────────────────────────
// War over LAND: where a country's MARCH tile (claimed but unsettled frontier)
// borders a militarily STRONGER country, the stronger annexes it — tile by tile,
// a fraction per pass, so fronts creep across the empty frontier rather than
// snapping. Only marches are contestable here; settled core is taken by storming
// the settlement (armies.js). Strength = the realm's total army.
export function marchWarfare(world) {
  const { N, tw, th } = world;
  const co = world._countryOwner, owner = world._territoryOwner;
  if (!co || !owner) return;
  const army = new Map();
  for (const s of world.settlements) {
    if (s.mode !== "settled") continue;
    army.set(s.countryId, (army.get(s.countryId) || 0) + (s.army || 0));
  }
  const rng = world.rng;
  const flips = [];
  for (let ti = 0; ti < N; ti++) {
    const c = co[ti];
    if (c < 0 || owner[ti] >= 0) continue;          // only a defender's MARCH tile is contestable
    const def = army.get(c) || 0;
    const ty = (ti / tw) | 0, tx = ti - ty * tw;
    const xm = tx === 0 ? tw - 1 : tx - 1, xp = tx === tw - 1 ? 0 : tx + 1;
    const ns = [ty * tw + xm, ty * tw + xp, ty > 0 ? ti - tw : -1, ty < th - 1 ? ti + tw : -1];
    let bestC = -1, bestStr = def * WAR_DOMINANCE;   // attacker must beat this
    for (let k = 0; k < 4; k++) {
      const ni = ns[k]; if (ni < 0) continue;
      const nc = co[ni]; if (nc < 0 || nc === c) continue;
      const str = army.get(nc) || 0;
      if (str > bestStr) { bestStr = str; bestC = nc; }
    }
    if (bestC >= 0) flips.push(ti, bestC);
  }
  for (let i = 0; i < flips.length; i += 2) {
    if (rng() < WAR_FLIP_FRAC) co[flips[i]] = flips[i + 1];
  }
}

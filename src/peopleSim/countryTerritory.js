// ── Country-primary territory (Option B, stage B1) ───────────────────
//
// world._countryOwner — countryId per tile (-1 = wilderness / water). This is
// the FIRST-CLASS political territory: the land a STATE owns, as opposed to the
// per-settlement food catchments in territory.js (owner[]).
//
// Built in two layers:
//   1. CORE — the country of the settlement that owns each tile in the
//      per-settlement owner[] map. This makes the realm's settled heartland
//      transfer automatically when a settlement is conquered or secedes (its
//      countryId flips → its tiles' country flips), and it is contiguous
//      because owner[] is.
//   2. MARCHES — each country then grows OUTWARD into adjacent WILDERNESS up to
//      a per-country reach budget (set by the CAPITAL's organization, so a
//      bigger state projects authority over more unsettled frontier). This is
//      the "a state can hold land with no settlement on it" capability — empty
//      marches, buffer zones, claimed-but-unfarmed hinterland.
//
// A per-country tile CAPACITY (members + capital org) caps total size; over it,
// the farthest march tiles are shed (over-extension pulls back). Stages B2/B3
// will re-root food onto slices of this territory and move conquest/secession
// onto the tiles directly; for now the economy still runs on territory.js and
// this drives the rendered borders.

import { localEdgeCost } from "./transport.js";

// March reach (transport-cost) a state projects into wilderness BEYOND its
// settled core: MARCH_BASE + capital-organization × MARCH_ORG. In the country-
// primary model the marches ARE the state's territory (not a thin fringe), so
// the reach is generous and org-scaled — a developed realm projects authority
// far into its hinterland. Total size is bounded by the capacity below, so this
// just sets how far the state CAN reach; capacity decides how much it holds.
const MARCH_BASE = 8;
const MARCH_ORG  = 46;
// Tile capacity = members × (CAP_TILES_BASE + capitalOrg × CAP_TILES_ORG). Over
// it, the farthest march tiles are released (settled core is never shed). This
// is the real size dial: low-org early states hold little (so the map fragments
// into many small realms with lots of wilderness between), high-org late states
// hold large regions (so the world consolidates with the era).
const CAP_TILES_BASE = 200;
const CAP_TILES_ORG  = 1400;
const SQRT2 = Math.SQRT2;

class MinHeap {
  constructor(cap = 4096) { this.ti = new Int32Array(cap); this.d = new Float64Array(cap); this.c = new Int32Array(cap); this.n = 0; this.cap = cap; }
  _grow() { const k = this.cap * 2; const t = new Int32Array(k); t.set(this.ti); this.ti = t; const d = new Float64Array(k); d.set(this.d); this.d = d; const c = new Int32Array(k); c.set(this.c); this.c = c; this.cap = k; }
  push(ti, d, c) { if (this.n >= this.cap) this._grow(); let i = this.n++; this.ti[i] = ti; this.d[i] = d; this.c[i] = c; while (i > 0) { const p = (i - 1) >> 1; if (this.d[p] <= this.d[i]) break; this._sw(p, i); i = p; } }
  _sw(a, b) { const t = this.ti[a]; this.ti[a] = this.ti[b]; this.ti[b] = t; const d = this.d[a]; this.d[a] = this.d[b]; this.d[b] = d; const c = this.c[a]; this.c[a] = this.c[b]; this.c[b] = c; }
  popMin() { const ti = this.ti[0], d = this.d[0], c = this.c[0]; this.n--; if (this.n > 0) { this.ti[0] = this.ti[this.n]; this.d[0] = this.d[this.n]; this.c[0] = this.c[this.n]; let i = 0; for (;;) { const l = i * 2 + 1, r = i * 2 + 2; let b = i; if (l < this.n && this.d[l] < this.d[b]) b = l; if (r < this.n && this.d[r] < this.d[b]) b = r; if (b === i) break; this._sw(b, i); i = b; } } return { ti, d, c }; }
}

// Compute world._countryOwner. Cheap-ish: one O(N) derive + one bounded
// wilderness flood (marches) + one O(N) capacity tally. Runs on the territory
// pass alongside computeTerritory.
export function computeCountryTerritory(world) {
  const { N, tw, th, elev } = world;
  const owner = world._territoryOwner;       // per-settlement food catchments
  const byId = world._byId;
  if (!owner || !byId) return null;
  let co = world._countryOwner;
  if (!co || co.length !== N) co = world._countryOwner = new Int32Array(N);
  co.fill(-1);

  // Per-country: members + the capital (strongest org, used for the march reach
  // budget and tile capacity — a state's reach is a property of its centre).
  const members = new Map();   // countryId -> count
  const capOrg = new Map();    // countryId -> max member organization
  const knOf = new Map();      // countryId -> capital knowledge (for edge cost)
  for (const s of world.settlements) {
    if (s.mode !== "settled") continue;
    const c = s.countryId;
    members.set(c, (members.get(c) || 0) + 1);
    const org = (s.knowledge && s.knowledge.organization) || 0;
    if (!capOrg.has(c) || org > capOrg.get(c)) { capOrg.set(c, org); knOf.set(c, s.knowledge || {}); }
  }

  // 1. CORE: country of the owning settlement, per tile.
  for (let ti = 0; ti < N; ti++) {
    const oid = owner[ti];
    if (oid < 0 || elev[ti] <= 0) continue;
    const s = byId.get(oid);
    if (s && s.mode === "settled") co[ti] = s.countryId;
  }

  // 2. MARCHES: grow each country into adjacent wilderness up to its budget.
  //    Multi-source Dijkstra seeded from every core tile (cost 0, its country);
  //    claims only wilderness (co<0, land) within that country's budget; another
  //    country's land is a wall. dist[] = march cost from the core (for shedding).
  const budget = new Map();
  for (const [c, org] of capOrg) budget.set(c, MARCH_BASE + org * MARCH_ORG);
  const dist = world._countryMarchDist && world._countryMarchDist.length === N
    ? world._countryMarchDist : (world._countryMarchDist = new Float64Array(N));
  dist.fill(0);
  const heap = new MinHeap();
  for (let ti = 0; ti < N; ti++) if (co[ti] >= 0) heap.push(ti, 0, co[ti]);
  const claimC = world._countryClaimTmp && world._countryClaimTmp.length === N
    ? world._countryClaimTmp : (world._countryClaimTmp = new Int32Array(N));
  claimC.fill(-1);
  const claimD = world._countryClaimTmpD && world._countryClaimTmpD.length === N
    ? world._countryClaimTmpD : (world._countryClaimTmpD = new Float64Array(N));
  claimD.fill(Infinity);
  while (heap.n > 0) {
    const { ti, d, c } = heap.popMin();
    const isCore = co[ti] === c;
    if (!isCore && d > claimD[ti]) continue;
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
      if (co[ni] >= 0) continue;                       // settled core or already-claimed wall
      const ec = localEdgeCost(world, ti, ni, kn, true);
      if (ec === Infinity) continue;
      const nd = d + ec * mul[k];
      if (nd > bud) continue;
      if (nd < claimD[ni]) { claimD[ni] = nd; claimC[ni] = c; heap.push(ni, nd, c); }
    }
  }
  for (let ti = 0; ti < N; ti++) {
    if (co[ti] < 0 && claimC[ti] >= 0) { co[ti] = claimC[ti]; dist[ti] = claimD[ti]; }
  }

  // 3. CAPACITY: cap total tiles per country; shed the farthest MARCH tiles
  //    (never the settled core) when over.
  const tally = new Map();   // countryId -> array of march-tile indices (shed candidates)
  const total = new Map();   // countryId -> total tiles
  for (let ti = 0; ti < N; ti++) {
    const c = co[ti]; if (c < 0) continue;
    total.set(c, (total.get(c) || 0) + 1);
    if (claimC[ti] === c) { let a = tally.get(c); if (!a) tally.set(c, a = []); a.push(ti); }   // a march tile
  }
  for (const [c, tot] of total) {
    const cap = (members.get(c) || 1) * (CAP_TILES_BASE + (capOrg.get(c) || 0) * CAP_TILES_ORG);
    if (tot <= cap) continue;
    const marches = tally.get(c); if (!marches) continue;
    marches.sort((a, b) => dist[b] - dist[a]);        // farthest first
    let shed = tot - cap;
    for (const ti of marches) { if (shed <= 0) break; co[ti] = -1; shed--; }
  }
  return co;
}

// ── National claim: a PROGRESSIVE, tile-by-tile border ───────────────
//
// The rendered country borders. Two parts:
//
//   computeClaimTarget(world) → world._claimTarget
//     Where each tile's border SHOULD be right now: a fresh cost-Voronoi by
//     COUNTRY (nearest settlement by terrain reach — roads ignored — within a
//     reach budget; tiles beyond everyone's reach stay -1 = wilderness).
//
//   relaxClaim(world) → world._countryClaim
//     The ACTUAL drawn border, which crawls one ring toward the target each
//     call. Every settlement's home tile flies its current flag (a foothold),
//     and a tile only flips to its target country once that country's claim has
//     reached an adjacent tile. So land NEVER teleports: when a city is taken
//     or a town secedes, the target flips instantly but the LAND is re-claimed
//     tile by tile, emanating outward from the settlement, over many ticks.
//     (This replaces the old instant "whole territory re-colours when a
//     settlement changes countryId" behaviour.)
//
// Render-only: nothing in the sim depends on _countryClaim.

import { localEdgeCost } from "./transport.js";
import { reachBudget } from "./territory.js";

// National claim reaches this many × a settlement's food reach (terrain cost,
// roads ignored). The target Voronoi extent; wilderness lies beyond it.
const CLAIM_MULT = 1.1;
// Rings the drawn claim advances toward the target per relax call. 1 = slowest/
// smoothest crawl. index.js calls relaxClaim every RELAX_INTERVAL ticks.
const RINGS_PER_RELAX = 1;

// "Main" settlement of a country: the strongest member (tier first, then
// people) — the same seat rebuildCountries would crown capital. Used to pick
// the single tile a brand-new realm's claim is born from. Robust to a dead
// founder (a country id can outlive the settlement it was named for).
function headScore(s) { return (s.tier | 0) * 1e7 + (s.people || 0); }

class MinHeap {
  constructor(cap = 4096) { this.ti = new Int32Array(cap); this.d = new Float64Array(cap); this.n = 0; this.cap = cap; }
  _grow() { const c = this.cap * 2; const t = new Int32Array(c); t.set(this.ti); const d = new Float64Array(c); d.set(this.d); this.ti = t; this.d = d; this.cap = c; }
  push(ti, d) { if (this.n >= this.cap) this._grow(); let i = this.n++; this.ti[i] = ti; this.d[i] = d; while (i > 0) { const p = (i - 1) >> 1; if (this.d[p] <= this.d[i]) break; const tt = this.ti[p], td = this.d[p]; this.ti[p] = this.ti[i]; this.d[p] = this.d[i]; this.ti[i] = tt; this.d[i] = td; i = p; } }
  popMin() { const ti = this.ti[0], d = this.d[0]; this.n--; if (this.n > 0) { this.ti[0] = this.ti[this.n]; this.d[0] = this.d[this.n]; let i = 0; for (;;) { const l = i * 2 + 1, r = i * 2 + 2; let b = i; if (l < this.n && this.d[l] < this.d[b]) b = l; if (r < this.n && this.d[r] < this.d[b]) b = r; if (b === i) break; const tt = this.ti[b], td = this.d[b]; this.ti[b] = this.ti[i]; this.d[b] = this.d[i]; this.ti[i] = tt; this.d[i] = td; i = b; } } return { ti, d }; }
}
const SQRT2 = Math.SQRT2;

// PERSISTENT, flow-through cost-Voronoi by country (the IDEAL borders). Keeps a
// per-settlement claim ACROSS passes — releasing only tiles whose settlement
// died (or turned to water) and claiming nearby UNCLAIMED land within budget —
// so a realm's territory ACCUMULATES into one solid region. A from-scratch
// single-pass Voronoi instead repaints the raw cost-reachable star every pass,
// which renders as spindly, disconnected-looking "rash" arms and shimmers as
// budgets drift; persistence fills those arms in and holds them steady. Same-
// country settlements flow THROUGH each other (no internal walls) so a country
// reads as one clean region; another country's land is a wall. Derives
// world._claimTarget (countryId per tile) for relaxClaim to crawl toward.
export function computeClaimTarget(world) {
  const { N, tw, th, elev } = world;
  // _claimSett (settlement id per tile) is the PERSISTENT substrate; _claimTarget
  // (countryId per tile) is the derived target the drawn border chases.
  let sett = world._claimSett;
  if (!sett || sett.length !== N) { sett = world._claimSett = new Int32Array(N); sett.fill(-1); }
  let cost = world._claimCost;
  if (!cost || cost.length !== N) cost = world._claimCost = new Float32Array(N);
  let target = world._claimTarget;
  if (!target || target.length !== N) target = world._claimTarget = new Int32Array(N);
  cost.fill(Infinity);

  const byId = new Map(), budget = new Map(), knOf = new Map();
  for (const s of world.settlements) {
    if (s.mode !== "settled") continue;
    byId.set(s.id, s);
    budget.set(s.id, reachBudget(s) * CLAIM_MULT);
    knOf.set(s.id, s.knowledge || {});
  }

  // Persistence: release tiles whose settlement is gone, and any water.
  for (let ti = 0; ti < N; ti++) {
    const o = sett[ti];
    if (o >= 0 && (!byId.has(o) || elev[ti] <= 0)) sett[ti] = -1;
  }

  const heap = new MinHeap();
  for (const s of byId.values()) {
    const ti = (s.pos.y | 0) * tw + (s.pos.x | 0);
    if (elev[ti] > 0) { sett[ti] = s.id; cost[ti] = 0; heap.push(ti, 0); }
  }
  const base = sett.slice();   // pre-pass snapshot for the wall / unclaimed test

  while (heap.n > 0) {
    const { ti, d } = heap.popMin();
    if (d > cost[ti]) continue;
    const oid = sett[ti];
    const owner = byId.get(oid); if (!owner) continue;
    const oc = owner.countryId;
    const bud = budget.get(oid) || 0;
    const kn = knOf.get(oid);
    const ty = (ti / tw) | 0, tx = ti - ty * tw;
    const xm = tx === 0 ? tw - 1 : tx - 1, xp = tx === tw - 1 ? 0 : tx + 1;
    const yu = ty - 1, yd = ty + 1;
    const ns = [
      ty * tw + xm, ty * tw + xp,
      yu >= 0 ? yu * tw + tx : -1, yd < th ? yd * tw + tx : -1,
      yu >= 0 ? yu * tw + xm : -1, yu >= 0 ? yu * tw + xp : -1,
      yd < th ? yd * tw + xm : -1, yd < th ? yd * tw + xp : -1,
    ];
    const mul = [1, 1, 1, 1, SQRT2, SQRT2, SQRT2, SQRT2];
    for (let k = 0; k < 8; k++) {
      const ni = ns[k]; if (ni < 0) continue;
      const lk = base[ni];
      let sibling = false;
      if (lk >= 0 && lk !== oid) {
        const ls = byId.get(lk);
        if (!ls || ls.countryId !== oc) continue;   // another country's land = wall
        sibling = true;                              // same-country: flow through, don't seize
      }
      const c = localEdgeCost(world, ti, ni, kn, true);  // reach ignores roads
      if (c === Infinity) continue;
      const nd = d + c * mul[k];
      if (nd > bud) continue;
      if (nd < cost[ni]) {
        cost[ni] = nd;
        if (!sibling && lk < 0 && elev[ni] > 0) sett[ni] = oid;   // claim unclaimed land
        heap.push(ni, nd);
      }
    }
  }

  // Derive the target: countryId per tile (-1 = unclaimed / water).
  for (let ti = 0; ti < N; ti++) {
    const o = sett[ti];
    const s = o >= 0 ? byId.get(o) : null;
    target[ti] = s ? s.countryId : -1;
  }
  return target;
}

// Crawl the drawn claim one (or RINGS_PER_RELAX) ring toward the target. A tile
// only changes hands once the gaining country (or wilderness) already holds a
// neighbour — so borders advance/retreat tile by tile, never jumping.
export function relaxClaim(world) {
  const { N, tw, th, elev } = world;
  let claim = world._countryClaim;
  if (!claim || claim.length !== N) { claim = world._countryClaim = new Int32Array(N); claim.fill(-1); }
  const target = world._claimTarget;
  if (!target) return claim;

  // ── Footholds ──────────────────────────────────────────────────────
  // A settlement plants its flag on its OWN home tile only when doing so is
  // NOT a transfer of land away from another country — otherwise the claim must
  // CRAWL to it (below) so land never teleports. A home tile is planted when:
  //   • it is already ours        → no-op;
  //   • it is wilderness (-1)     → a settlement legitimately sits on fresh land
  //                                  (a new colony / crystallised town / the
  //                                  very first village) — not a land transfer;
  //   • it belongs to ANOTHER country, BUT this settlement is the HEAD of a
  //     country that holds no tiles yet → the single birth-foothold a brand-new
  //     realm needs. Only the head plants it, so a secession (even a multi-city
  //     revolt) EMANATES from its one main settlement and then crawls outward to
  //     absorb its co-seceders' land, instead of every breakaway city lighting
  //     up at once.
  // First: which countries already hold ground, and (for those that don't yet)
  // their head settlement.
  const present = new Set();
  for (let ti = 0; ti < N; ti++) { const v = claim[ti]; if (v >= 0) present.add(v); }
  const headOf = new Map();
  for (const s of world.settlements) {
    if (s.mode !== "settled" || present.has(s.countryId)) continue;
    const cur = headOf.get(s.countryId);
    if (!cur || headScore(s) > headScore(cur)) headOf.set(s.countryId, s);
  }
  for (const s of world.settlements) {
    if (s.mode !== "settled") continue;
    const ti = (s.pos.y | 0) * tw + (s.pos.x | 0);
    if (elev[ti] <= 0) continue;
    const cur = claim[ti];
    if (cur === s.countryId) continue;                       // already ours
    if (cur === -1) { claim[ti] = s.countryId; continue; }   // fresh land — legit foothold
    // Home tile currently belongs to another country: flipping it is a land
    // transfer. Only the head of a country with no ground yet may plant its one
    // birth-foothold; everyone else waits for the crawl to reach them.
    if (!present.has(s.countryId) && headOf.get(s.countryId) === s) {
      claim[ti] = s.countryId;
      present.add(s.countryId);                              // it now exists; co-seceders wait for the crawl
    }
  }

  for (let r = 0; r < RINGS_PER_RELAX; r++) {
    const flips = [];
    for (let ti = 0; ti < N; ti++) {
      if (elev[ti] <= 0) { if (claim[ti] >= 0) claim[ti] = -1; continue; }  // water is never claimed
      const tg = target[ti];
      if (claim[ti] === tg) continue;
      // Flip toward the target only if the target country (or wilderness, -1)
      // already holds an orthogonal neighbour — i.e. its front has reached here.
      const ty = (ti / tw) | 0, tx = ti - ty * tw;
      const xm = tx === 0 ? tw - 1 : tx - 1, xp = tx === tw - 1 ? 0 : tx + 1;
      const ns = [ty * tw + xm, ty * tw + xp, ty > 0 ? ti - tw : -1, ty < th - 1 ? ti + tw : -1];
      let adjacent = false;
      for (let k = 0; k < 4; k++) { const ni = ns[k]; if (ni < 0) continue; if (claim[ni] === tg) { adjacent = true; break; } }
      if (adjacent) flips.push(ti);
    }
    if (flips.length === 0) break;
    for (const ti of flips) claim[ti] = target[ti];
  }
  return claim;
}

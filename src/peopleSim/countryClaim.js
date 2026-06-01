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

class MinHeap {
  constructor(cap = 4096) { this.ti = new Int32Array(cap); this.d = new Float64Array(cap); this.n = 0; this.cap = cap; }
  _grow() { const c = this.cap * 2; const t = new Int32Array(c); t.set(this.ti); const d = new Float64Array(c); d.set(this.d); this.ti = t; this.d = d; this.cap = c; }
  push(ti, d) { if (this.n >= this.cap) this._grow(); let i = this.n++; this.ti[i] = ti; this.d[i] = d; while (i > 0) { const p = (i - 1) >> 1; if (this.d[p] <= this.d[i]) break; const tt = this.ti[p], td = this.d[p]; this.ti[p] = this.ti[i]; this.d[p] = this.d[i]; this.ti[i] = tt; this.d[i] = td; i = p; } }
  popMin() { const ti = this.ti[0], d = this.d[0]; this.n--; if (this.n > 0) { this.ti[0] = this.ti[this.n]; this.d[0] = this.d[this.n]; let i = 0; for (;;) { const l = i * 2 + 1, r = i * 2 + 2; let b = i; if (l < this.n && this.d[l] < this.d[b]) b = l; if (r < this.n && this.d[r] < this.d[b]) b = r; if (b === i) break; const tt = this.ti[b], td = this.d[b]; this.ti[b] = this.ti[i]; this.d[b] = this.d[i]; this.ti[i] = tt; this.d[i] = td; i = b; } } return { ti, d }; }
}
const SQRT2 = Math.SQRT2;

// Fresh cost-Voronoi by country (the IDEAL borders). Stores settlement id per
// tile during the search (for per-settlement budgets), then derives country.
export function computeClaimTarget(world) {
  const { N, tw, th, elev } = world;
  let target = world._claimTarget;
  if (!target || target.length !== N) target = world._claimTarget = new Int32Array(N);
  target.fill(-1);
  let cost = world._claimTargetCost;
  if (!cost || cost.length !== N) cost = world._claimTargetCost = new Float32Array(N);
  cost.fill(Infinity);
  let sid = world._claimTargetSid;
  if (!sid || sid.length !== N) sid = world._claimTargetSid = new Int32Array(N);
  sid.fill(-1);

  const byId = new Map(), budget = new Map(), knOf = new Map();
  for (const s of world.settlements) {
    if (s.mode !== "settled") continue;
    byId.set(s.id, s);
    budget.set(s.id, reachBudget(s) * CLAIM_MULT);
    knOf.set(s.id, s.knowledge || {});
  }
  const heap = new MinHeap();
  for (const s of byId.values()) {
    const ti = (s.pos.y | 0) * tw + (s.pos.x | 0);
    if (elev[ti] > 0) { sid[ti] = s.id; cost[ti] = 0; heap.push(ti, 0); }
  }
  while (heap.n > 0) {
    const { ti, d } = heap.popMin();
    if (d > cost[ti]) continue;
    const oid = sid[ti];
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
      const c = localEdgeCost(world, ti, ni, kn, true);   // reach ignores roads
      if (c === Infinity) continue;
      const nd = d + c * mul[k];
      if (nd > bud) continue;
      if (nd < cost[ni]) { cost[ni] = nd; if (elev[ni] > 0) sid[ni] = oid; heap.push(ni, nd); }
    }
  }
  for (let ti = 0; ti < N; ti++) {
    const o = sid[ti];
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

  // Every settlement's home tile flies its CURRENT flag — the foothold a fresh
  // (e.g. just-seceded) country needs for its claim to spread from.
  for (const s of world.settlements) {
    if (s.mode !== "settled") continue;
    const ti = (s.pos.y | 0) * tw + (s.pos.x | 0);
    if (elev[ti] > 0) claim[ti] = s.countryId;
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

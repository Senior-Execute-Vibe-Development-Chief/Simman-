// ── PROTOTYPE: capital-projected national claim ──────────────────────
//
// A PARALLEL, render-only experiment that computes country borders the way the
// Transport-Test overlay does — a claim projected outward from each country's
// CAPITAL — so we can eyeball it next to the live settlement-union borders
// before deciding whether to make it the real territory model.
//
// Key design point (the whole reason this exists): the Trans Test looks clean
// because it's STATIC. A naive capital-Voronoi recomputed every frame would
// shimmer as budgets/capitals shift. So this is PERSISTENT, exactly like
// territory.js: a claimed tile sticks with its country (a wall to everyone
// else) and is only released when that country dies; each capital only EXPANDS
// into UNCLAIMED land, cheapest-cost-wins. That's what makes a live capital
// claim stable instead of flickery.
//
// Nothing in the sim depends on this — it does not feed food, conquest, or
// secession. It only fills world._countryClaim (countryId per tile) for the
// "Capital Claim" debug view.

import { localEdgeCost } from "./transport.js";

// National claim reaches this many × the capital's admin range (conquest.js
// c.range). Generous so neighbours' claims actually meet (Voronoi borders)
// rather than leaving big unclaimed gaps; tune by eye in the overlay.
const CLAIM_REACH_MULT = 3.5;

class MinHeap {
  constructor(cap = 4096) { this.ti = new Int32Array(cap); this.d = new Float64Array(cap); this.n = 0; this.cap = cap; }
  _grow() { const c = this.cap * 2; const t = new Int32Array(c); t.set(this.ti); const d = new Float64Array(c); d.set(this.d); this.ti = t; this.d = d; this.cap = c; }
  push(ti, d) { if (this.n >= this.cap) this._grow(); let i = this.n++; this.ti[i] = ti; this.d[i] = d; while (i > 0) { const p = (i - 1) >> 1; if (this.d[p] <= this.d[i]) break; const tt = this.ti[p], td = this.d[p]; this.ti[p] = this.ti[i]; this.d[p] = this.d[i]; this.ti[i] = tt; this.d[i] = td; i = p; } }
  popMin() { const ti = this.ti[0], d = this.d[0]; this.n--; if (this.n > 0) { this.ti[0] = this.ti[this.n]; this.d[0] = this.d[this.n]; let i = 0; for (;;) { const l = i * 2 + 1, r = i * 2 + 2; let b = i; if (l < this.n && this.d[l] < this.d[b]) b = l; if (r < this.n && this.d[r] < this.d[b]) b = r; if (b === i) break; const tt = this.ti[b], td = this.d[b]; this.ti[b] = this.ti[i]; this.d[b] = this.d[i]; this.ti[i] = tt; this.d[i] = td; i = b; } } return { ti, d }; }
}

const SQRT2 = Math.SQRT2;

export function computeCountryClaim(world) {
  const { N, tw, th, elev } = world;
  const countries = world.countries;
  if (!countries || countries.size === 0) return null;

  let claim = world._countryClaim;
  if (!claim || claim.length !== N) { claim = world._countryClaim = new Int32Array(N); claim.fill(-1); }
  let cost = world._countryClaimCost;
  if (!cost || cost.length !== N) cost = world._countryClaimCost = new Float32Array(N);

  // Release tiles whose country is gone, and any water (claims don't bleed
  // into the ocean). This is the only way a claimed tile ever changes hands —
  // everything else is sticky, which is what kills flicker.
  for (let ti = 0; ti < N; ti++) {
    const c = claim[ti];
    if (c >= 0 && (!countries.has(c) || elev[ti] <= 0)) claim[ti] = -1;
  }

  // Per-country budget + capital knowledge; seed each capital.
  const budget = new Map(), knOf = new Map();
  cost.fill(Infinity);
  const heap = new MinHeap();
  for (const c of countries.values()) {
    const cap = c.capital; if (!cap) continue;
    budget.set(c.id, Math.max(8, (c.range || 8) * CLAIM_REACH_MULT));
    knOf.set(c.id, cap.knowledge || {});
    const ti = (cap.pos.y | 0) * tw + (cap.pos.x | 0);
    if (elev[ti] > 0) { claim[ti] = c.id; cost[ti] = 0; heap.push(ti, 0); }
  }

  // Snapshot pre-pass ownership: a tile already held by ANOTHER country is a
  // wall (sticky persistence). Only tiles unclaimed in the snapshot are raced.
  const base = claim.slice();

  while (heap.n > 0) {
    const { ti, d } = heap.popMin();
    if (d > cost[ti]) continue;
    const cid = claim[ti];
    const bud = budget.get(cid) || 0;
    const kn = knOf.get(cid);
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
      if (lk >= 0 && lk !== cid) continue;        // another country's land = wall
      const c = localEdgeCost(world, ti, ni, kn);
      if (c === Infinity) continue;
      const nd = d + c * mul[k];
      if (nd > bud) continue;                      // beyond this capital's reach
      if (nd < cost[ni]) {
        cost[ni] = nd;
        if (elev[ni] > 0) claim[ni] = cid;         // claim land; water propagates cost but isn't claimed
        heap.push(ni, nd);
      }
    }
  }
  return claim;
}

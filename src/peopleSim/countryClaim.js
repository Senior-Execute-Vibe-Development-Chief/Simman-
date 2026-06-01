// ── National claim (the rendered country borders) ────────────────────
//
// A second, render-facing territory pass that draws the political borders the
// way the Transport-Test overlay did: smooth, terrain-following, capital/
// country-centric regions — instead of the blobby union of per-settlement food
// patches that owner[] produces.
//
// PHASE 1 (this is it): borders only. The SIM still runs on the settlement
// territory (territory.js owner[]) for food / conquest / secession; this just
// produces world._countryClaim (countryId per tile) for the renderer. Because
// it is keyed off each settlement's CURRENT countryId, it tracks the real
// political map automatically — conquer a city and its claim flips with it.
//
// It differs from owner[] in exactly two ways, which is what makes it look
// better: (1) a much larger reach (CLAIM_MULT × the settlement's reach), so a
// realm projects sovereignty over its frontier hinterland, not just its farmed
// core; (2) same-country settlements COOPERATE (no internal walls) so a country
// reads as one clean region. Persistent + multi-source, same as owner[], so it
// is stable (no per-frame reshuffle → no flicker).

import { localEdgeCost } from "./transport.js";
import { reachBudget } from "./territory.js";

// National claim reaches this many × a settlement's food-territory reach. >1 so
// borders enclose frontier hinterland between towns; tune for coverage (higher
// = countries tile more of the map, less unclaimed wilderness).
const CLAIM_MULT = 1.1;

class MinHeap {
  constructor(cap = 4096) { this.ti = new Int32Array(cap); this.d = new Float64Array(cap); this.n = 0; this.cap = cap; }
  _grow() { const c = this.cap * 2; const t = new Int32Array(c); t.set(this.ti); const d = new Float64Array(c); d.set(this.d); this.ti = t; this.d = d; this.cap = c; }
  push(ti, d) { if (this.n >= this.cap) this._grow(); let i = this.n++; this.ti[i] = ti; this.d[i] = d; while (i > 0) { const p = (i - 1) >> 1; if (this.d[p] <= this.d[i]) break; const tt = this.ti[p], td = this.d[p]; this.ti[p] = this.ti[i]; this.d[p] = this.d[i]; this.ti[i] = tt; this.d[i] = td; i = p; } }
  popMin() { const ti = this.ti[0], d = this.d[0]; this.n--; if (this.n > 0) { this.ti[0] = this.ti[this.n]; this.d[0] = this.d[this.n]; let i = 0; for (;;) { const l = i * 2 + 1, r = i * 2 + 2; let b = i; if (l < this.n && this.d[l] < this.d[b]) b = l; if (r < this.n && this.d[r] < this.d[b]) b = r; if (b === i) break; const tt = this.ti[b], td = this.d[b]; this.ti[b] = this.ti[i]; this.d[b] = this.d[i]; this.ti[i] = tt; this.d[i] = td; i = b; } } return { ti, d }; }
}
const SQRT2 = Math.SQRT2;

export function computeCountryClaim(world) {
  const { N, tw, th, elev } = world;
  // _claimSett (settlement id per tile, persistent) is the working substrate;
  // _countryClaim (countryId per tile) is the render output derived from it.
  let sett = world._claimSett;
  if (!sett || sett.length !== N) { sett = world._claimSett = new Int32Array(N); sett.fill(-1); }
  let cost = world._claimCost;
  if (!cost || cost.length !== N) cost = world._claimCost = new Float32Array(N);
  let claim = world._countryClaim;
  if (!claim || claim.length !== N) claim = world._countryClaim = new Int32Array(N);
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
  const base = sett.slice();   // pre-pass snapshot for the wall test

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
      const c = localEdgeCost(world, ti, ni, kn);
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

  // Derive the render map: countryId per tile (-1 = unclaimed / water).
  for (let ti = 0; ti < N; ti++) {
    const o = sett[ti];
    const s = o >= 0 ? byId.get(o) : null;
    claim[ti] = s ? s.countryId : -1;
  }
  return claim;
}

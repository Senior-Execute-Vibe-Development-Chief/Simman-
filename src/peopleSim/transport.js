import { T } from "./tuning.js";
// Transport distance map: for every land tile, the minimum cumulative
// terrain-weighted cost to reach the nearest settlement. Used by the
// crystallization sweep to bias new settlements toward sites already
// connected to existing ones (knowledge spread along easy corridors),
// while still allowing ideal-but-distant sites to crystallize
// independently (the historical Egypt / Indus / Yangtze / Mesoamerica
// pattern of independent agricultural revolutions).
//
// ── Continuous edge cost ─────────────────────────────────────────────
//
// Cost is computed PER EDGE (fromTi → toTi), not per tile. This lets
// us include a slope term — climbing a steep face costs more than
// walking a flat plateau even if both tiles have the same elevation.
// All other components are smooth functions of the underlying terrain
// fields (no threshold buckets), so the resulting distance map varies
// continuously across the world instead of jumping at e=0.20 / e=0.35
// stair-steps.
//
// Components (additive into base 1.0):
//   altitude    e × 5 + e² × 14     spread across low/mid elevations
//   slope       |Δelev| × 35        steep climbs visibly punished
//   cold        (0.35−t)² × 28      smooth ramp below t=0.35
//   aridity     heat × dry × 25     heat=max(0,t−0.45), dry=max(0,0.40−m)
// Multiplicative bonuses:
//   river       ÷ (1 + mag × 0.32) continuous in magnitude
//   coast       × 0.80
// Water (e ≤ 0) is impassable.
//
// Plain flat tile (e=0, t=0.5, m=0.5, no river/coast) costs 1.0 — same
// as the old function — so MAX_TRANSPORT_BY_TIER still reads as "~N
// plain tiles" of reach. Hills (e≈0.10) now cost ~2× a plain rather
// than 1.5×; mountains (e≈0.40) cost ~5× instead of ~3×; high
// mountains plus a climb can hit 12+. This widens the dynamic range
// so the Crossing overlay genuinely separates terrain types, and so
// settlements in mountainous terrain have visibly tighter
// catchments than those on plains.

const HEAP_INIT_CAP = 1024;

// Binary min-heap of {ti:int, d:float}. Stored as two parallel typed
// arrays for cache-friendly access — avoids object churn at scale.
class _MinHeap {
  constructor(cap = HEAP_INIT_CAP) {
    this.ti = new Int32Array(cap);
    this.d  = new Float32Array(cap);
    this.n  = 0;
    this.cap = cap;
  }
  _grow() {
    const ncap = this.cap * 2;
    const nti = new Int32Array(ncap); nti.set(this.ti);
    const nd  = new Float32Array(ncap); nd.set(this.d);
    this.ti = nti; this.d = nd; this.cap = ncap;
  }
  push(ti, d) {
    if (this.n >= this.cap) this._grow();
    let i = this.n++;
    this.ti[i] = ti; this.d[i] = d;
    // Bubble up.
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.d[p] <= this.d[i]) break;
      const tt = this.ti[p], td = this.d[p];
      this.ti[p] = this.ti[i]; this.d[p] = this.d[i];
      this.ti[i] = tt; this.d[i] = td;
      i = p;
    }
  }
  popMin() {
    if (this.n === 0) return -1;
    const ti = this.ti[0], d = this.d[0];
    this.n--;
    if (this.n === 0) return { ti, d };
    this.ti[0] = this.ti[this.n]; this.d[0] = this.d[this.n];
    // Bubble down.
    let i = 0;
    for (;;) {
      const l = i * 2 + 1, r = i * 2 + 2;
      let best = i;
      if (l < this.n && this.d[l] < this.d[best]) best = l;
      if (r < this.n && this.d[r] < this.d[best]) best = r;
      if (best === i) break;
      const tt = this.ti[best], td = this.d[best];
      this.ti[best] = this.ti[i]; this.d[best] = this.d[i];
      this.ti[i] = tt; this.d[i] = td;
      i = best;
    }
    return { ti, d };
  }
}

// ── Trans-test cost model ────────────────────────────────────────────
//
// Adapted from the live "Transport Test" view (WorldSim.jsx
// runTransportTest). The principle: each tile is one of THREE MODES,
// each mode has its own base cost, mode changes pay a flat PORT TAX,
// and tech maps to SPECIFIC cost reductions (not a generic multiplier
// on every land tile).
//
//   mode LAND  (elev > 0, not a river)
//     base = params.plain
//     + (elev-0.25) × 8           when e > 0.25 (mountains)
//     + slope_above_0.05 × params.harsh     (rough terrain)
//     + climate penalties         (hot+dry, cold, hot+wet)
//     coast → min(base, params.coast)
//
//   mode RIVER (mag ≥ 2)
//     base = params.river × {1.0 if mag≥4, 1.3 if mag=3, 2.0 if mag=2}
//
//   mode WATER (elev ≤ 0)
//     params.water (=Infinity if nav below threshold)
//
//   MODE CHANGE → + params.port (the single dominant tax on switching
//   modes — at low construction this is large; bridges/ferries/ports
//   bring it down).
//
// Tech mapping:
//   construction → cuts plain (roads), harsh, river, coast, port
//   mobility     → cuts plain (wagons), harsh
//   navigation   → enables water (gate at 0.10); cuts coast and water
//   organization → does NOT enter here; it controls reach budget
//                  in territory.js. Pure separation of concerns.
//
// Two exports:
//   baseEdgeCost — zero-tech costs (used by the global transport
//                  distance map and the crossing overlay)
//   localEdgeCost — same shape, parametrised by the caller's tech
//                  (used by territory, conquest, armies, roads)
//
// Both delegate to one core function so the rules can never drift.

// NAV_EMBARK_THRESH (seafaring tech gate) is a runtime lever — tuning.js T.NAV_EMBARK_THRESH.

function _paramsFromKnowledge(kn) {
  const k = kn || {};
  const cons = k.construction || 0;
  const mob  = k.mobility     || 0;
  const nav  = k.navigation   || 0;
  return {
    nav,
    // Cost-per-tile by mode (base values), then tech-discounted.
    plain: Math.max(0.30, 1.0 - mob * 0.30 - cons * 0.10),    // wagons + roads
    harsh: Math.max(8,    35  - mob * 13   - cons * 10),       // slope coefficient (steep climbs)
    river: Math.max(0.15, 0.50 - cons * 0.30),                 // river-along (banded by mag)
    coast: Math.max(0.20, 0.70 - cons * 0.30 - nav * 0.25),    // coastal hop floor
    water: nav < T.NAV_EMBARK_THRESH ? Infinity
         : Math.max(0.5, 2.5 / (0.3 + nav * 1.5)),             // open ocean (gated)
    port:  Math.max(0.5, 6   - cons * 5),                      // mode-change tax (6 → 1)
  };
}

function _tileMode(world, ti) {
  // 0 = land, 1 = river, 2 = water. Matches the trans-test convention.
  if (world.elev[ti] <= 0) return 2;
  if (world.riverMag && world.riverMag[ti] >= 2) return 1;
  return 0;
}

// Core cost function. Roads short-circuit it (a road tile costs its
// intrinsic road quality, terrain ignored — Roman-engineered model).
function _edgeCost(world, fromTi, toTi, params) {
  // Road override stays — roads are infrastructure, not terrain.
  const rq = world.roadQuality;
  if (rq) {
    const qF = rq[fromTi], qT = rq[toTi];
    if (qF < 1.0 || qT < 1.0) return Math.min(qF, qT);
  }

  const toMode   = _tileMode(world, toTi);
  const fromMode = _tileMode(world, fromTi);
  let base;

  if (toMode === 2) {                        // ── WATER ──
    if (!isFinite(params.water)) return Infinity;
    base = params.water;
    if (world.coast && world.coast[toTi]) base = Math.min(base, params.coast);
    base *= T.WATER_COST_MULT;               // open-water crossing dial (tuning.js)
  } else if (toMode === 1) {                 // ── RIVER ──
    const rm = world.riverMag[toTi];
    const magMul = rm >= 4 ? 1.0 : rm >= 3 ? 1.3 : 2.0;
    base = params.river * magMul;
  } else {                                   // ── LAND ──
    const e = world.elev[toTi];
    const t = world.temp[toTi];
    const m = world.moist[toTi];
    base = params.plain;
    // Mountains + slope: linear + quadratic altitude so foothills are mild
    // but high peaks are crushing (e=0.20 → +1.6, 0.50 → +6.0, 0.80 → +12.0),
    // plus the steep per-tile climb term (construction cuts it via
    // params.harsh). The whole relief penalty is scaled by the mountain-cost
    // lever, so ranges can be made hard walls or gentle slopes (tuning.js).
    let relief = e * 5 + e * e * 14;
    const slope = Math.abs(e - world.elev[fromTi]);
    if (slope > 0.02) relief += (slope - 0.02) * params.harsh;
    base += relief * T.MOUNTAIN_COST_MULT;
    if (t > 0.55 && m < 0.25) base += (t - 0.55) * 5 + (0.25 - m) * 4;  // hot dry
    if (t < 0.18) base += (0.18 - t) * 8;                          // cold
    if (m > 0.70 && t > 0.4) base += (m - 0.70) * 6;               // hot wet
    if (world.coast && world.coast[toTi]) base = Math.min(base, params.coast);
    base *= T.LAND_COST_MULT;                // overall land-travel cost dial (tuning.js)
  }

  // Mode change pays the port tax. Construction shrinks it — this is
  // why a high-construction realm can bridge rivers cheaply while a
  // neolithic one is walled by them.
  if (toMode !== fromMode) base += params.port;
  return base;
}

// Zero-tech cost (for global transport distance map + crossing overlay).
const _ZERO_PARAMS = _paramsFromKnowledge({});
export function baseEdgeCost(world, fromTi, toTi) {
  return _edgeCost(world, fromTi, toTi, _ZERO_PARAMS);
}

// Tech-aware cost (per-settlement reach, march speed, conquest range).
export function localEdgeCost(world, fromTi, toTi, kn) {
  return _edgeCost(world, fromTi, toTi, _paramsFromKnowledge(kn));
}

export function computeTransport(world) {
  const { N, tw, th } = world;
  const dist = new Float32Array(N);
  for (let i = 0; i < N; i++) dist[i] = Infinity;
  const heap = new _MinHeap();
  // Seed: every alive settlement contributes a 0-distance source.
  for (const s of world.settlements) {
    if (s.mode !== "settled") continue;
    const ti = (s.pos.y | 0) * tw + (s.pos.x | 0);
    if (dist[ti] > 0) {
      dist[ti] = 0;
      heap.push(ti, 0);
    }
  }
  // Dijkstra over 8-neighbours (cardinals + diagonals). Diagonal
  // steps cover √2 × the geometric distance so their cost is
  // multiplied accordingly — this stops the algorithm from
  // preferring stairstep paths over a straight diagonal across
  // open ground.
  const SQRT2 = Math.SQRT2;
  while (heap.n > 0) {
    const { ti, d } = heap.popMin();
    if (d > dist[ti]) continue;       // stale
    const ty = (ti / tw) | 0;
    const tx = ti - ty * tw;
    const xm = tx === 0      ? tw - 1 : tx - 1;
    const xp = tx === tw - 1 ? 0      : tx + 1;
    const yu = ty - 1, yd = ty + 1;
    const left  = ty * tw + xm;
    const right = ty * tw + xp;
    const up    = yu >= 0 ? yu * tw + tx : -1;
    const down  = yd < th ? yd * tw + tx : -1;
    const ul    = yu >= 0 ? yu * tw + xm : -1;
    const ur    = yu >= 0 ? yu * tw + xp : -1;
    const dl    = yd < th ? yd * tw + xm : -1;
    const dr    = yd < th ? yd * tw + xp : -1;
    const ns  = [left, right, up, down, ul, ur, dl, dr];
    const mul = [1,    1,     1,  1,    SQRT2, SQRT2, SQRT2, SQRT2];
    for (let k = 0; k < 8; k++) {
      const ni = ns[k];
      if (ni < 0) continue;
      const c = baseEdgeCost(world, ti, ni);
      if (c === Infinity) continue;
      const nd = d + c * mul[k];
      if (nd < dist[ni]) {
        dist[ni] = nd;
        heap.push(ni, nd);
      }
    }
  }
  return dist;
}

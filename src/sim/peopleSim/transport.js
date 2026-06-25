import { T, TUNING_VERSION } from "./tuning.js";
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
    // Callers must guard on n > 0; an empty pop returns a sentinel object (not
    // -1 — destructuring a number silently yields undefined fields).
    if (this.n === 0) return { ti: -1, d: Infinity };
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

// ── Per-(knowledge, tick) parameter cache ─────────────────────────────
// localEdgeCost used to rebuild its params object on EVERY edge relaxation —
// millions of allocations + T.* reads per territory / claim / polity / A*
// pass, the single hottest allocation site in the sim. Knowledge drifts by
// ~1e-5/tick, so the params are constant within a tick: cache them per
// knowledge OBJECT per (step, tuning-version). The WeakMap keys on the live
// knowledge object (knOf maps / s.knowledge hand the same reference around a
// pass), so a stale entry simply refreshes on the next tick — and a tuning
// slider bumps TUNING_VERSION, invalidating mid-tick as the live-lever
// contract promises. Zero-knowledge callers share one sentinel key.
const _paramCache = new WeakMap();
const _ZERO_KN = {};
function _paramsFor(world, kn) {
  const key = kn || _ZERO_KN;
  const step = (world && world.step) | 0;
  const tv = TUNING_VERSION.v;
  let e = _paramCache.get(key);
  if (!e || e.step !== step || e.tv !== tv) {
    e = { step, tv, params: _paramsFromKnowledge(kn) };
    _paramCache.set(key, e);
  }
  return e.params;
}

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
    ride:  mob * T.OPEN_RIDE,                                  // open-country riding discount (steppe highway) — see land branch
    coast: Math.max(0.20, 0.70 - cons * 0.30 - nav * 0.25),    // coastal hop floor
    // Open ocean (nav-gated). Steep slope ON PURPOSE: at the embark floor a
    // crossing is a perilous hop (≈4–6/tile), by classical seafaring it rivals
    // rough land (≈1.2), and at full navigation the open sea UNDERCUTS the
    // plains (≈0.76 vs ≈0.6+relief) — Braudel's highway, and the same pricing
    // the sea-lane TRADE pass already uses (sea.js SEA_STEP). Because claims,
    // admin reach and armies all route through this one cost core, a naval
    // realm reaches a far wilderness coast at its true sea distance — often
    // CHEAPER than the overland way around — and claims it (the colonial
    // coastal claim), while a foot realm still sees the sea as a wall.
    water: nav < T.NAV_EMBARK_THRESH ? Infinity
         : Math.max(0.35, 2.5 / (0.3 + nav * 3.0)),
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
// intrinsic road quality, terrain ignored — Roman-engineered model) — UNLESS
// ignoreRoads is set, used by the territory/claim/admin-reach passes so that
// political reach follows TERRAIN, not roads (a realm shouldn't sprawl its
// borders down a trade road). Movement/trade callers keep the road discount.
function _edgeCost(world, fromTi, toTi, params, ignoreRoads, noPortTax) {
  if (!ignoreRoads) {
    const rq = world.roadQuality;
    if (rq) {
      const qF = rq[fromTi], qT = rq[toTi];
      if (qF < 1.0 || qT < 1.0) return Math.min(qF, qT);
    }
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
    // Open-country rider (the steppe-highway effect). To a MOUNTED culture,
    // flat unforested country — steppe, savanna, prairie — is not an obstacle
    // but a freeway: low RESISTANCE, not high fertility, is what bred the
    // sprawling horse empires (the khaganates, Russia's sweep east, Sahelian
    // cavalry states). Openness needs ground dry enough for grass (the canopy
    // closes by m≈0.65) and dies with relief (forest, hills, broken country
    // snap the ride). Scales with mobility tech via the T.OPEN_RIDE lever;
    // a foot culture sees the steppe exactly as before.
    if (params.ride > 0) {
      const open = (m < 0.45 ? 1 : Math.max(0, 1 - (m - 0.45) / 0.20))
                 * Math.max(0, 1 - Math.max(0, relief - 0.6) / 1.4);
      if (open > 0) base = Math.max(0.12, base * (1 - params.ride * open));
    }
  }

  // Mode change pays the port tax. Construction shrinks it — this is
  // why a high-construction realm can bridge rivers cheaply while a
  // neolithic one is walled by them. NOTE the tax is per mode CHANGE, so
  // crossing a river perpendicular pays it twice (step on + step off) —
  // intentional: a ford/bridge has two banks, and travel ALONG the river
  // pays nothing. (conquest.js majorRiverToll is a separate, admin-reach-
  // only surcharge on top for mag≥3 rivers.)
  // Mode-change port tax (boat ↔ land cargo transfer). Skipped for the FOOD
  // CATCHMENT reach (noPortTax): a settlement farms its hinterland on foot, so
  // loading-dock cost is irrelevant to which land it can work — and without this a
  // settlement sitting ON a river channel couldn't afford to step onto its own
  // floodplain bank (port tax > a fresh cradle's whole reach budget), starving the
  // valley cradles. The river's own mode cost still applies, so a far bank is still
  // harder than a near one.
  if (toMode !== fromMode && !noPortTax) base += params.port;
  return base;
}

// Zero-tech cost (for global transport distance map + crossing overlay).
// Routed through the per-tick cache (not a frozen module-load snapshot) so
// the zero-tech baseline honours live tuning levers like NAV_EMBARK_THRESH /
// the *_COST_MULT dials on its next pass.
export function baseEdgeCost(world, fromTi, toTi) {
  return _edgeCost(world, fromTi, toTi, _paramsFor(world, null));
}

// Tech-aware cost (per-settlement reach, march speed, conquest range). Pass
// ignoreRoads=true for political REACH (territory / national claim / admin
// projection) so borders follow terrain, not roads; leave it off for movement
// and trade, which legitimately speed up on roads.
export function localEdgeCost(world, fromTi, toTi, kn, ignoreRoads, noPortTax) {
  return _edgeCost(world, fromTi, toTi, _paramsFor(world, kn), ignoreRoads, noPortTax);
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

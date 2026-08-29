import { T, TUNING_VERSION, rNormPop } from "./tuning.js";
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
/** Cap frontier growth — a Dijkstra peak is O(N); past this is a runaway. */
function _heapCapFor(N) {
  const need = Math.max(HEAP_INIT_CAP, N || HEAP_INIT_CAP);
  // next power of two ≥ need (clz32(need-1) form; need=1 → 1)
  return need <= 1 ? 1 : 1 << (32 - Math.clz32(need - 1));
}

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
    // Soft ceiling — skip further grows; callers treat a failed push as "frontier full".
    if (ncap > (this._maxCap || (1 << 26))) return false;
    try {
      const nti = new Int32Array(ncap); nti.set(this.ti);
      const nd  = new Float32Array(ncap); nd.set(this.d);
      this.ti = nti; this.d = nd; this.cap = ncap;
      return true;
    } catch (err) {
      console.error(`[transHeap] grow ${this.cap}→${ncap} failed:`, err && err.message);
      return false;
    }
  }
  push(ti, d) {
    if (this.n >= this.cap && !this._grow()) return false;
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
    return true;
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
    ridge: Math.max(30,   130 - cons * 80),                    // local-RELIEF coefficient (gorge-and-ridge country); engineering (roads, bridges, tunnels) cuts it ~60%
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

// The shared definition of OPEN RIDING COUNTRY — dry grass (the canopy closes
// by m≈0.65), low relief (forest, hills and broken country snap the ride).
// This is the same openness the land branch of _edgeCost discounts for mounted
// cultures (which additionally folds per-edge SLOPE into its relief — an edge
// property this per-tile view can't see; keep the two formulas in step).
// Consumers: the ride discount below, and the nomad classification
// (conquest.js) — a people are nomadic where this is high and farming is poor.
export function tileOpenness(world, ti) {
  const e = world.elev[ti];
  if (e <= 0) return 0;
  const m = world.moist[ti];
  const relief = e * 5 + e * e * 14;
  return (m < 0.45 ? 1 : Math.max(0, 1 - (m - 0.45) / 0.20))
       * Math.max(0, 1 - Math.max(0, relief - 0.6) / 1.4);
}

// T.RES_INV_RIVERCOST: a river CHANNEL is a 1-D line on a 2-D grid, so the share of
// land tiles carrying one HALVES per resolution doubling (the repo's own measurement:
// riverMag>=1 is 50%/27%/14% of land at tw 240/480/960). River-mode land is far cheaper
// to cross than plain land, so at the reference grid HALF the map is cheap river travel
// and at 2x only a quarter is — the cost field is systematically dearer on finer grids.
// Measured consequence: economic catchments cover 25.3% of land at tw=240 but 15.8% at
// tw=480, and the shortfall is NOT the reach budget (verified identical, 5.000, then
// correctly scaled by rNormPop) nor tile desirability (neutralising it moved catchment
// scaling only 2.41x -> 2.56x where 4x is parity).
//   Physically the coarse grid is the generous one: a tile holding a river gets river
// travel across its WHOLE area, including the land in it that is nowhere near the water.
// The honest invariant is that a river makes travel cheap for the land within a REAL
// distance of it (walk to the water, take a boat). So read the channel over a
// real-distance neighbourhood instead of the single tile — the same correction already
// shipped and gated for the per-settlement water scan (RES_INV_RIVER, computeWaterAccess).
// radius = round(rNormPop)-1 => 0 at the 240 reference => BYTE-IDENTICAL there.
function _riverNear(world) {
  let rn = world._rivNear;
  if (rn && rn.length === world.N) return rn;
  const N = world.N, tw = world.tw, th = world.th, rmA = world.riverMag;
  rn = world._rivNear = new Float32Array(N);
  if (!rmA) return rn;
  const R = Math.max(0, Math.round(rNormPop(world)) - 1);
  if (R === 0) { rn.set(rmA); return rn; }
  const R2 = R * R;
  for (let y = 0; y < th; y++) {
    for (let x = 0; x < tw; x++) {
      let best = 0;
      for (let dy = -R; dy <= R; dy++) {
        const yy = y + dy; if (yy < 0 || yy >= th) continue;
        for (let dx = -R; dx <= R; dx++) {
          if (dx * dx + dy * dy > R2) continue;
          const xx = ((x + dx) % tw + tw) % tw;          // cylindrical in x
          const v = rmA[yy * tw + xx]; if (v > best) best = v;
        }
      }
      rn[y * tw + x] = best;
    }
  }
  return rn;
}

function _tileMode(world, ti) {
  // 0 = land, 1 = river, 2 = water. Matches the trans-test convention.
  if (world.elev[ti] <= 0) return 2;
  const rmF = T.RES_INV_RIVERCOST ? _riverNear(world) : world.riverMag;
  if (rmF && rmF[ti] >= 2) return 1;
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
      // BOTH endpoints must be road tiles. The old `qF < 1 || qT < 1` let a
      // single coastal road price the STEP INTO OPEN OCEAN at road cost
      // (terrain/nav never consulted) — zero-tech invent-jump worlds then
      // flooded the whole globe on the first computeTransport and blew the
      // frontier heap (browser: cap 2M→4M at step ~35088 after mint-ready).
      const qF = rq[fromTi], qT = rq[toTi];
      if (qF < 1.0 && qT < 1.0) {
        const q = Math.min(qF, qT);
        if (q > 0 && isFinite(q)) return Math.max(1e-3, q);
      }
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
    const rm = (T.RES_INV_RIVERCOST ? _riverNear(world) : world.riverMag)[toTi];   // same neighbourhood the mode was classified from
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
    // RIDGE RELIEF (worldgenUtils computeRelief): the local VERTICAL RANGE of the
    // ground — the thing cell-mean altitude is blind to. A ridge-and-valley range
    // (the Alps) averages to ~0.31 cells and slips under both altitude terms, while
    // a flat plateau of the same mean reads as a wall. Measured: crossing the Alps
    // cost the same as an equal-length plain march (37.7 vs 35.7 claim-frame units)
    // while the Tibet edge read 143 — which is why sim-Europe soldered into one
    // realm while China/India stayed properly bounded by their walls. Gorge-and-
    // ridge country (relief past the 0.07 floor — plains p90 ≈ 0.06, Alps p50 ≈
    // 0.15) now pays by its broken-ness; flat plateau INTERIORS (Tibet p50 ≈ 0.05)
    // pay nothing extra — altitude already prices them, and once up, the going is
    // flat. Engineering eases it (params.ridge), same as the slope term.
    const rr = world.relief ? world.relief[toTi] : 0;
    if (rr > 0.07) relief += (rr - 0.07) * params.ridge;
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
  // Non-positive costs turn Dijkstra into an unbounded re-push (the mint-ready
  // Max OOM). Terrain costs are ≥ ~0.12 by construction; clamp anyway.
  return (base > 0 && isFinite(base)) ? base : Infinity;
}

// Zero-tech cost (for global transport distance map + crossing overlay).
// Routed through the per-tick cache (not a frozen module-load snapshot) so
// the zero-tech baseline honours live tuning levers like NAV_EMBARK_THRESH /
// the *_COST_MULT dials on its next pass.
export function baseEdgeCost(world, fromTi, toTi) {
  return _edgeCost(world, fromTi, toTi, _paramsFor(world, null));
}

// ── Terrain hold: how hard ground is to SUBDUE (T.REFUGE) ───────────────────
// ONE definition of "the defender stands on ground that fights for it", shared
// by the war pass's tile defence, the capital storm, peaceful absorption and
// the city-enclave gate (armies.js / conquest.js) — so a moat city and a
// mountain community resist conquest and gravitation with the same physics.
// The river and alpine constants are the war pass's own (extracted verbatim —
// armies.js reads these names, values unchanged); the RIDGE term is the new
// one: gorge-and-ridge country read off world.relief, the first-class vertical-
// range field the movement cost already pays (same 0.07 floor — plains p90 ≈
// 0.06, so plains never trigger), because cell-MEAN altitude is blind to real
// ranges (the Alps average ~0.31 and slip under elev > 0.5 entirely). Each
// term eases with the defender's CONSTRUCTION — engineering bridges the ford
// and roads the pass — so refuges are strongest exactly when statecraft is
// young, and erode as the besieger's world matures. Never a clock.
export const RIVER_DEF_W = 2.2, RIVER_DEF_ENG = 0.6;    // ford under fire: ≈3.2× neolithic → ≈2× engineered
export const ALPINE_DEF_BASE = 1.0, ALPINE_DEF_SLOPE = 1.6, ALPINE_DEF_ENG = 0.5;   // high ground past elev 0.5, steeper = harder
export const RIDGE_DEF_W = 2.0;       // a fully-broken ridge tile defends at ~×3 before engineering (same family as the river/alpine weights)
export const RIDGE_DEF_FLOOR = 0.07;  // where ridge country begins — the movement cost's own floor (transport ridge term above)
export const RIDGE_DEF_FULL = 0.25;   // full brokenness — the measured Himalaya-front class (Alps p50 0.145 sits ~43% up the ramp)
export const TERRAIN_DEF_CAP = 6;     // the war pass's cap — no single tile is unconquerable

// The ridge term alone (the war tile-scan composes it onto its existing
// river/alpine terms): extra defence MULTIPLE, 0 on plains.
export function ridgeHoldAt(world, ti, cons) {
  const rr = world.relief ? world.relief[ti] : 0;
  if (rr <= RIDGE_DEF_FLOOR) return 0;
  return RIDGE_DEF_W * Math.min(1, (rr - RIDGE_DEF_FLOOR) / (RIDGE_DEF_FULL - RIDGE_DEF_FLOOR)) * (1 - 0.5 * cons);
}

// The SEAT hold (high ground × ridge, capped) for the sites that had NO
// terrain physics before (the capital storm, peaceful absorption, the
// city-enclave gate). Deliberately NO river term here: seats are river-sited
// almost universally (85% of the first settlement cohort is riparian —
// probe_siting), so a river-moat term at the seat is not a refuge
// differentiator but a global war re-balance — and history storms river
// cities routinely (they are the ROADS armies arrive on) while the mountain
// mosaics persist. Measured before this narrowing: realm-kills fell 4 → 1
// per 8k with the river term in, war mortality cratering globally — the
// exact immortal-giants regime this repo already fought once. The river keeps
// defending exactly where it always did: the countryside tile war (fronts
// snap to rivers). Callers weight the hold as 1 + T.REFUGE·(hold−1), so
// lever 0 is exactly ×1.
export function terrainHoldAt(world, ti, cons) {
  let m = 1;
  const e = world.elev[ti];
  if (e > 0.5) { const alp = Math.min(1, (e - 0.5) / 0.3); m *= 1 + (ALPINE_DEF_BASE + ALPINE_DEF_SLOPE * alp) * (1 - ALPINE_DEF_ENG * cons); }
  const rh = ridgeHoldAt(world, ti, cons);
  if (rh > 0) m *= 1 + rh;
  return Math.min(m, TERRAIN_DEF_CAP);
}

// The lever-weighted form every new consumer applies: ×1 exactly at REFUGE 0.
export function refugeHoldAt(world, ti, cons) {
  const w = T.REFUGE || 0;
  if (w <= 0) return 1;
  return 1 + w * (terrainHoldAt(world, ti, cons) - 1);
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
  // Refresh IN PLACE (the ~24k stall fix): the result is retained as
  // world.transportDist and rebuilt on a cadence — reusing its buffer swaps a
  // fresh N-array per rebuild for a full overwrite (every index set to
  // Infinity below before the Dijkstra writes real values).
  let dist = world.transportDist;
  if (!dist || dist.length !== N) dist = new Float32Array(N);
  for (let i = 0; i < N; i++) dist[i] = Infinity;
  // Persistent frontier heap: PRE-SIZE to ≥N so the first post-mint transport
  // flood does not cascade 1024→2→…→131k grows under invent-jump memory
  // pressure (browser: Array buffer allocation failed in _grow at the first
  // crystallize after mint-ready — step ~35088). Contents are per-firing
  // scratch (n=0 below); only the backing lanes persist.
  const wantCap = _heapCapFor(N);
  let heap = world._transHeap;
  if (!heap || heap.cap < wantCap) {
    heap = world._transHeap = new _MinHeap(wantCap);
    heap._maxCap = Math.max(wantCap * 4, 1 << 20);
  }
  heap.n = 0;
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
  let peakN = 0, pushes = 0;   // frontier high-water attribution (allocation-wall watch)
  while (heap.n > 0) {
    if (heap.n > peakN) peakN = heap.n;
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
      if (!(c > 0) || !isFinite(c)) continue;
      const nd = d + c * mul[k];
      if (nd < dist[ni]) {
        dist[ni] = nd;
        if (!heap.push(ni, nd)) { /* frontier full — leave remaining tiles at Infinity */ }
        else pushes++;
      }
    }
  }
  // Frontier watch (the 26.6k allocation-wall diagnosis, 2026-08-20): the heap
  // measured SMALL at both grids (tw=480 cap 4096 / tw=960 cap 65536 by ~28k),
  // proving its _grow was the canary, not the cause. Keep the high-water stat —
  // it prints only when the persistent cap grows past its all-time peak (a
  // handful of lines per world, then silence), so a future REAL frontier
  // runaway names itself in the console instead of dying as a mystery OOM.
  const st = world._transStat || (world._transStat = { peakN: 0, peakCap: 0, maxPushes: 0, calls: 0 });
  st.calls++;
  if (peakN > st.peakN) st.peakN = peakN;
  if (pushes > st.maxPushes) st.maxPushes = pushes;
  if (heap.cap > st.peakCap) {
    st.peakCap = heap.cap;
    console.log(`[transHeap] step=${world.step} cap=${heap.cap} peakN=${peakN} pushes=${pushes} (${((heap.cap * 8) / 1e6).toFixed(1)}MB backing)`);
  }
  return dist;
}

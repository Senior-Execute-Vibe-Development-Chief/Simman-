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

// Raw geography edge cost (no tech). Pass fromTi = toTi at a source
// seed where there's no climb yet.
export function baseEdgeCost(world, fromTi, toTi) {
  const { elev, temp, moist, riverMag, coast } = world;
  const e = elev[toTi];
  if (e <= 0) return Infinity;        // water — impassable for land transport

  // ── Road override ──
  // If EITHER endpoint is a road tile, the edge cost is purely the
  // road's intrinsic quality — ignore underlying terrain. A road
  // over mountains costs the same as a road over plains
  // (Roman-engineered-road model). Heavily-worn arterials (lower
  // quality number) are even cheaper. This makes Dijkstra
  // aggressively prefer any existing road, producing visible
  // trunk-and-spur networks.
  const rq = world.roadQuality;
  if (rq) {
    const qF = rq[fromTi], qT = rq[toTi];
    if (qF < 1.0 || qT < 1.0) return Math.min(qF, qT);
  }

  // ── Standard terrain cost (non-road edges) ──
  const fromE = elev[fromTi];

  // Absolute altitude. Linear + quadratic so even small hills are
  // visibly harder than sea level, and high mountains scale steeply.
  //   e=0.00 → +0.00   e=0.10 → +0.64   e=0.20 → +1.56   e=0.35 → +3.47
  //   e=0.50 → +6.00   e=0.70 → +10.36  e=1.00 → +19.00
  const altCost = e * 5 + e * e * 14;

  // Slope between this tile and the one we came from.
  //   |Δ|=0.02 → +0.70   |Δ|=0.05 → +1.75   |Δ|=0.10 → +3.50   |Δ|=0.20 → +7.00
  const slope = Math.abs(e - fromE);
  const slopeCost = slope * 35;

  const t = temp[toTi], m = moist[toTi];

  // Cold. Smooth ramp below t=0.35.
  let coldCost = 0;
  if (t < 0.35) {
    const cold = 0.35 - t;
    coldCost = cold * cold * 28;
  }

  // Aridity. Continuous heat × dryness interaction.
  const heat = Math.max(0, t - 0.45);
  const dry  = Math.max(0, 0.40 - m);
  const aridCost = heat * dry * 25;

  let c = 1.0 + altCost + slopeCost + coldCost + aridCost;

  // River bonus scales continuously with magnitude.
  if (riverMag && riverMag[toTi] > 0) c /= (1 + riverMag[toTi] * 0.32);
  if (coast[toTi])                    c *= 0.80;
  return c;
}

// Per-settlement edge cost = base × tech multipliers. Each surviving
// knowledge track reduces effective edge cost in a way that maps to a
// real transport innovation. (Toolmaking was folded into construction
// in the knowledge merge — bridges/wagons/road-junctions all live under
// "construction" now.)
//   construction roads, bridges, wagons, switchbacks ×0.55 max
//   organization postal relays, supply chains        ×0.85 max
//   mobility     horses (cavalry, courier, plough)   ×0.70 max
//   navigation   ships on rivers / coasts            water ×0.55 max
//                + WATER EMBARKATION (see below): with nav ≥ 0.2, water
//                tiles become passable for land transport at a cost that
//                falls from ~12 (small boats) to ~3 (real fleet) as nav
//                rises. Models troop transports / amphibious crossings.
//
// At full tech (everything at 1.0), a flat plain tile costs:
//   ×0.55 × 0.85 × 0.70 = 0.327 (was 0.250 with the separate toolmaking
//   multiplier). The slightly higher floor means high-tech land transport
//   doesn't crush the distance budget for empire reach — which was part
//   of why "empires too big" kept happening.
//
// MODE-CHANGE cost: crossing between road and rough terrain, or between
// land and water, incurs a one-step setup penalty — the column has to
// find the route, board ships, etc. Applied as a small additive cost
// when the cost class of the FROM and TO tiles differs.
//
// RIVER as its own mode: a major river (mag ≥ 2) is treated as a
// distinct travel class — getting INTO the water is an event (find a
// ford / build a raft / board a boat) and so is getting OUT, regardless
// of the river's width. That makes river crossing a FIXED penalty
// (embark + debark = RIVER_BOARD_COST × 2), not a per-tile traversal
// cost, which matches the physical fact that a 1-tile and a 3-tile
// river take roughly the same effort to cross — the work is in boarding
// and disembarking, not in paddling. Construction tech (bridges,
// pontoons, ferries) shrinks the boarding cost toward zero. Travel
// ALONG the river (river → river) pays only the cheap river-tile cost
// from baseEdgeCost — once you're floating, you keep floating.
const WATER_BASE_COST    = 12;   // small-boat / raft crossing at nav≈0.2
const WATER_NAV_FLOOR    = 3;    // real-fleet crossing at nav≥1
const NAV_EMBARK_THRESH  = 0.2;  // below this, water remains impassable
const MODE_CHANGE_COST   = 0.6;  // additive penalty when crossing a class boundary
const RIVER_BOARD_COST   = 5.0;  // embark OR debark a major river (each side, ≈ a ford / raft / bridge)

function tileMode(world, ti) {
  // 0 = ocean water, 1 = road, 2 = land, 3 = major river (mag ≥ 2)
  if (world.elev[ti] <= 0) return 0;
  if (world.roadQuality && world.roadQuality[ti] < 1.0) return 1;
  if (world.riverMag && world.riverMag[ti] >= 2) return 3;
  return 2;
}
export function localEdgeCost(world, fromTi, toTi, kn) {
  const nav  = kn ? (kn.navigation || 0) : 0;
  // Water embarkation: if the destination is water and the column has
  // navigation, substitute a navigation-shaped cost instead of Infinity.
  // Source can be land OR water (we're sailing); intermediate water steps
  // cost the same.
  const toIsWater = world.elev[toTi] <= 0;
  if (toIsWater) {
    if (nav < NAV_EMBARK_THRESH) return Infinity;
    // Cost from WATER_BASE_COST at nav≈0.2 down to WATER_NAV_FLOOR at nav≥1.
    const t = Math.max(0, Math.min(1, (nav - NAV_EMBARK_THRESH) / (1 - NAV_EMBARK_THRESH)));
    let waterCost = WATER_BASE_COST + (WATER_NAV_FLOOR - WATER_BASE_COST) * t;
    // Coastal vs open ocean: stick close to the coast for cheaper hops.
    if (world.coast && world.coast[toTi]) waterCost *= 0.7;
    return waterCost;
  }
  const c = baseEdgeCost(world, fromTi, toTi);
  if (c === Infinity || !kn) return c;
  const cons = kn.construction || 0;
  const org  = kn.organization || 0;
  const mob  = kn.mobility     || 0;
  let mul = (1 - 0.45 * cons) * (1 - 0.15 * org) * (1 - 0.30 * mob);
  if (nav > 0) {
    const isWater = (world.riverMag && world.riverMag[toTi] >= 2)
                 || (world.coast && world.coast[toTi]);
    if (isWater) mul *= (1 - 0.45 * nav);
  }
  let cost = c * mul;
  // Mode-change penalty when crossing between land/road/water/river
  // classes. Construction reduces the cost (better infrastructure makes
  // transitions cheaper — proper ports, road junctions, embankments,
  // bridges). The RIVER mode pays a much bigger boarding cost than a
  // road-↔-land transition, because the boat/ford operation is the
  // whole "cross the river" event compressed into one step. A full
  // crossing (land → river → land) therefore pays RIVER_BOARD_COST
  // TWICE — once to embark, once to debark — and a river of any width
  // pays roughly the same total, since paddling is cheap once you're
  // in the boat.
  const fromMode = tileMode(world, fromTi);
  const toMode   = tileMode(world, toTi);
  if (fromMode !== toMode) {
    if (fromMode === 3 || toMode === 3) {
      cost += RIVER_BOARD_COST * (1 - 0.7 * cons);   // boat/ford/bridge
    } else {
      cost += MODE_CHANGE_COST * (1 - 0.5 * cons);
    }
  }
  return cost;
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

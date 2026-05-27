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
  const fromE = elev[fromTi];

  // Absolute altitude. Linear + quadratic so even small hills are
  // visibly harder than sea level, and high mountains scale steeply.
  //   e=0.00 → +0.00   e=0.10 → +0.64   e=0.20 → +1.56   e=0.35 → +3.47
  //   e=0.50 → +6.00   e=0.70 → +10.36  e=1.00 → +19.00
  const altCost = e * 5 + e * e * 14;

  // Slope between this tile and the one we came from. The old per-tile
  // model could not see steepness — a flat alpine plateau cost the
  // same as a sheer cliff face. Slope fixes that.
  //   |Δ|=0.02 → +0.70   |Δ|=0.05 → +1.75   |Δ|=0.10 → +3.50   |Δ|=0.20 → +7.00
  const slope = Math.abs(e - fromE);
  const slopeCost = slope * 35;

  const t = temp[toTi], m = moist[toTi];

  // Cold. Smooth ramp below t=0.35 (wider than old t<0.30).
  //   t=0.35 → +0.00   t=0.25 → +0.28   t=0.15 → +1.12   t=0.05 → +2.52   t=0.00 → +3.43
  let coldCost = 0;
  if (t < 0.35) {
    const cold = 0.35 - t;
    coldCost = cold * cold * 28;
  }

  // Aridity. Continuous heat × dryness interaction.
  //   t=0.65, m=0.20 → +1.25   t=0.85, m=0.10 → +3.50   t=1.00, m=0.00 → +5.50
  const heat = Math.max(0, t - 0.45);
  const dry  = Math.max(0, 0.40 - m);
  const aridCost = heat * dry * 25;

  let c = 1.0 + altCost + slopeCost + coldCost + aridCost;

  // River bonus scales continuously with magnitude (was a binary
  // "mag ≥ 2 → ×0.4"). mag=1 → ×0.76, mag=2 → ×0.61, mag=3 → ×0.51,
  // mag=4 → ×0.44.
  if (riverMag && riverMag[toTi] > 0) c /= (1 + riverMag[toTi] * 0.32);
  if (coast[toTi])                    c *= 0.80;
  return c;
}

// Per-settlement edge cost = base × tech multipliers. Each track of
// knowledge reduces effective edge cost in a way that maps to a real
// transport innovation:
//   toolmaking   wagons, harness, draft animals      flat ×0.70 max
//   construction roads, bridges, switchbacks         flat ×0.60 max
//   organization postal relays, supply chains        flat ×0.85 max
//   mobility     horses (cavalry, courier, plough)   flat ×0.70 max
//   navigation   ships on rivers / coasts            water ×0.55 max
//
// At full tech (everything at 1.0), a flat plain tile costs:
//   ×0.70 × 0.60 × 0.85 × 0.70 = 0.250 (was 0.357 without mobility)
// A river tile with navigation maxed adds another ×0.55 on top.
// So a maxed-out Iron Age tribe with horses and ships moves ~4× faster
// over land and ~7× faster on water than a stone-age starter.
export function localEdgeCost(world, fromTi, toTi, kn) {
  const c = baseEdgeCost(world, fromTi, toTi);
  if (c === Infinity || !kn) return c;
  const tool = kn.toolmaking   || 0;
  const cons = kn.construction || 0;
  const org  = kn.organization || 0;
  const mob  = kn.mobility     || 0;
  const nav  = kn.navigation   || 0;
  let mul = (1 - 0.30 * tool) * (1 - 0.40 * cons) * (1 - 0.15 * org) * (1 - 0.30 * mob);
  if (nav > 0) {
    const isWater = (world.riverMag && world.riverMag[toTi] >= 2)
                 || (world.coast && world.coast[toTi]);
    if (isWater) mul *= (1 - 0.45 * nav);
  }
  return c * mul;
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
  // Dijkstra. Edge cost is the cost of stepping FROM ti INTO the
  // neighbour ni — depends on neighbour terrain AND the slope.
  while (heap.n > 0) {
    const { ti, d } = heap.popMin();
    if (d > dist[ti]) continue;       // stale
    const ty = (ti / tw) | 0;
    const tx = ti - ty * tw;
    // 4-neighbours with wrap-X, clamp-Y.
    const left  = ty * tw + (tx === 0 ? tw - 1 : tx - 1);
    const right = ty * tw + (tx === tw - 1 ? 0 : tx + 1);
    const up    = ty > 0      ? (ty - 1) * tw + tx : -1;
    const down  = ty < th - 1 ? (ty + 1) * tw + tx : -1;
    const ns = [left, right, up, down];
    for (let k = 0; k < 4; k++) {
      const ni = ns[k];
      if (ni < 0) continue;
      const c = baseEdgeCost(world, ti, ni);
      if (c === Infinity) continue;
      const nd = d + c;
      if (nd < dist[ni]) {
        dist[ni] = nd;
        heap.push(ni, nd);
      }
    }
  }
  return dist;
}

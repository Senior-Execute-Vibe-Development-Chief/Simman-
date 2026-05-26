// Transport distance map: for every land tile, the minimum cumulative
// terrain-weighted cost to reach the nearest settlement. Used by the
// crystallization sweep to bias new settlements toward sites already
// connected to existing ones (knowledge spread along easy corridors),
// while still allowing ideal-but-distant sites to crystallize
// independently (the historical Egypt / Indus / Yangtze / Mesoamerica
// pattern of independent agricultural revolutions).
//
// Multi-source Dijkstra from every settlement. Tile costs:
//   plains          1.0
//   hills (e>0.20)  2.0
//   mountains (e>0.35)  5.0
//   cold (t<0.15)   ×3
//   desert (t>0.70 & m<0.20)  ×2.5
//   river (mag≥2)   ×0.4
//   coast           ×0.7
//   water (e≤0)     impassable
//
// Result: world.transportDist is Float32Array(N), Infinity for water.

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

function tileCost(world, ti) {
  const { elev, temp, moist, riverMag, coast } = world;
  const e = elev[ti];
  if (e <= 0) return Infinity;        // water — impassable for land transport
  let c = 1.0;
  if (e > 0.35)                       c *= 5;
  else if (e > 0.20)                  c *= 2;
  const t = temp[ti], m = moist[ti];
  if (t < 0.15)                       c *= 3;
  if (t > 0.70 && m < 0.20)           c *= 2.5;
  if (riverMag && riverMag[ti] >= 2)  c *= 0.4;
  if (coast[ti])                      c *= 0.7;
  return c;
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
  // Dijkstra. Edge cost is the cost of stepping INTO the neighbour
  // (i.e., the neighbour's terrain).
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
      const c = tileCost(world, ni);
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

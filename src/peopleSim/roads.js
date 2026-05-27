// ── Roads: trade infrastructure between settlements ──
//
// Settlements build roads when they have a resource shortfall AND
// enough wealth to fund the construction. A road permanently
// reduces the edge cost between its endpoint settlements along a
// Dijkstra-optimal path. Subsequent road plans get the benefit of
// existing roads via the same edge-cost function — so road networks
// grow organically (Rome's empire pattern: cheap upgrades along
// existing arteries first).
//
// Road effect: any edge where BOTH endpoints are road tiles costs
// ×0.15 of the base — cheaper than rivers (×0.31 for mag 4), no
// mode change. Stays forever (no maintenance / decay yet).
//
// Trade: connection alone is enough; the knowledge system reads
// effective resource access via road links (see settlement.js's
// effectiveLocalRes). No per-tick economic flow modelled yet —
// that lands when production/consumption returns in a later phase.

import { localEdgeCost } from "./transport.js";
import { computeExportValue } from "./settlement.js";

// Roads are free to build (they emerge as traffic patterns) but
// USING them costs money per tick of trade — see updateTrade and
// TRANSPORT_PER_PATHCOST below.
const ROAD_TILE_DISCOUNT   = 0.15;     // existing road tile edge cost multiplier
const PLAN_INTERVAL        = 240;      // ticks between road-planning attempts
const MAX_PARTNER_DIST     = 80;       // tile-units of euclidean distance to consider
const MIN_POP_TO_PLAN      = 60;       // hamlets too small to coordinate a trade route
const MAX_ROADS_PER_SETT   = 4;        // cap so a metropolis doesn't sprawl

// Resource needs by tier — what a settlement requires to fund its
// next expansion phase. Used to identify shortages worth importing.
const NEEDED_BY_TIER = [
  ["timber"],                                                 // village
  ["timber", "stone"],                                        // town
  ["timber", "stone", "copper", "iron"],                      // city
  ["timber", "stone", "copper", "tin", "iron", "coal"],       // metropolis
];

// What constitutes "have" vs "need" for a given resource — we
// inspect localRes (max in reach). 0.10 threshold matches the ore
// gate used by knowledge growth.
const HAVE_THRESHOLD = 0.10;

export function maybeBuildRoads(world) {
  if (!world.roads) world.roads = [];
  if (!world.roadTiles) world.roadTiles = new Set();
  if (world.step % PLAN_INTERVAL !== 0) return;

  // Iterate alive settlements in random-ish order — sort by id so
  // earlier-founded settlements (which had more time to accrue
  // wealth) get first pick, but break ties with population so a
  // booming new city doesn't get crowded out by a stagnant elder.
  const candidates = world.settlements
    .filter(s => s.mode === "settled"
              && s.people >= MIN_POP_TO_PLAN
              && (s.roadsConnecting?.length || 0) < MAX_ROADS_PER_SETT);
  for (const s of candidates) {
    tryBuildOne(world, s);
  }
}

function tryBuildOne(world, s) {
  const needs = NEEDED_BY_TIER[s.tier] || NEEDED_BY_TIER[0];
  // Find unmet needs — resources the settlement doesn't yet have
  // even through existing road links.
  const own = s.localRes || {};
  const connected = new Set(s.roadsConnecting || []);
  const reachable = { ...own };
  for (const rid of connected) {
    const road = world.roads[rid];
    if (!road || !road.active) continue;
    const peerId = road.from === s.id ? road.to : road.from;
    const peer = world.settlements.find(o => o.id === peerId);
    if (!peer) continue;
    const peerRes = peer.localRes || {};
    for (const k in peerRes) {
      if ((peerRes[k] || 0) > (reachable[k] || 0)) reachable[k] = peerRes[k];
    }
  }
  const missing = needs.filter(n => (reachable[n] || 0) < HAVE_THRESHOLD);
  if (missing.length === 0) return;

  // For each missing resource, scan candidate partners — alive
  // settlements within MAX_PARTNER_DIST that have the resource at
  // useful richness. Pick the one with best (richness / build cost)
  // ratio. Build cost is wealth ≈ 0.5 × total path edge cost.
  let bestPartner = null;
  let bestScore = -Infinity;
  let bestPath = null;
  for (const peer of world.settlements) {
    if (peer.mode !== "settled" || peer.id === s.id) continue;
    if (connected.has(roadIdBetween(world, s.id, peer.id))) continue;
    // Cheap distance filter so we don't Dijkstra to the other side of the world.
    let dx = Math.abs(peer.pos.x - s.pos.x);
    if (dx > world.tw / 2) dx = world.tw - dx;
    const dy = peer.pos.y - s.pos.y;
    if (dx * dx + dy * dy > MAX_PARTNER_DIST * MAX_PARTNER_DIST) continue;
    // Does this peer ACTUALLY have something the settlement wants?
    const peerRes = peer.localRes || {};
    let bestResVal = 0;
    for (const n of missing) {
      const v = peerRes[n] || 0;
      if (v > bestResVal) bestResVal = v;
    }
    if (bestResVal < HAVE_THRESHOLD) continue;
    // Dijkstra path from s to peer using current edge costs (which
    // already include existing roads as cheap edges).
    const path = findPath(world, s, peer);
    if (!path) continue;
    // Roads are FREE to build (they emerge organically as trade
    // paths get walked into existence). The pathCost is still
    // recorded on the road and used by updateTrade to compute
    // per-tick transport cost — long roads stay viable for
    // valuable cargo but become unprofitable for low-margin trade.
    // Score: resource access per unit path expense. Penalise
    // very short hops (already de facto reachable).
    const score = bestResVal / Math.max(1, path.cost) * (path.tiles.length > 3 ? 1 : 0.5);
    if (score > bestScore) {
      bestScore = score;
      bestPartner = peer;
      bestPath = path;
    }
  }
  if (!bestPartner) return;

  // Build the road. Free of charge — money will be spent on
  // transport per-tick later (paid by importer to porters, deadweight).
  const roadId = world.roads.length;
  const road = {
    id: roadId,
    from: s.id, to: bestPartner.id,
    path: bestPath.tiles,
    pathCost: bestPath.cost,   // Dijkstra edge sum — drives transport cost in updateTrade
    builtBy: s.id,
    builtStep: world.step,
    active: true,
  };
  world.roads.push(road);
  for (const ti of bestPath.tiles) world.roadTiles.add(ti);
  if (!s.roadsConnecting) s.roadsConnecting = [];
  if (!bestPartner.roadsConnecting) bestPartner.roadsConnecting = [];
  s.roadsConnecting.push(roadId);
  bestPartner.roadsConnecting.push(roadId);
  if (s.history) s.history.push({
    step: world.step, type: "road-built",
    to: bestPartner.id, tiles: bestPath.tiles.length, pathCost: Math.round(bestPath.cost),
  });
}

function roadIdBetween(world, idA, idB) {
  if (!world.roads) return -1;
  for (let i = 0; i < world.roads.length; i++) {
    const r = world.roads[i];
    if (!r.active) continue;
    if ((r.from === idA && r.to === idB) || (r.from === idB && r.to === idA)) return r.id;
  }
  return -1;
}

// Bounded Dijkstra from settlement s to peer t, with parent tracking
// so we can reconstruct the path. Uses the same localEdgeCost as
// localTransport — including existing-road discounts via the global
// world.roadTiles set, which baseEdgeCost reads.
function findPath(world, s, t) {
  const { tw, th, elev } = world;
  const start = (s.pos.y | 0) * tw + (s.pos.x | 0);
  const goal  = (t.pos.y | 0) * tw + (t.pos.x | 0);
  if (start === goal || elev[start] <= 0 || elev[goal] <= 0) return null;
  const dist = new Map();
  const prev = new Map();
  dist.set(start, 0);
  const heap = new MinHeap();
  heap.push(start, 0);
  const limit = 5000;             // abort if path > 5k edges (won't happen on a 256×128)
  let visited = 0;
  while (heap.n > 0) {
    if (visited++ > limit) return null;
    const { ti, d } = heap.popMin();
    if (d > (dist.get(ti) ?? Infinity)) continue;
    if (ti === goal) break;
    const ty = (ti / tw) | 0, tx = ti - ty * tw;
    const left  = ty * tw + (tx === 0 ? tw - 1 : tx - 1);
    const right = ty * tw + (tx === tw - 1 ? 0 : tx + 1);
    const up    = ty > 0      ? (ty - 1) * tw + tx : -1;
    const down  = ty < th - 1 ? (ty + 1) * tw + tx : -1;
    const ns = [left, right, up, down];
    for (let k = 0; k < 4; k++) {
      const ni = ns[k];
      if (ni < 0) continue;
      const c = localEdgeCost(world, ti, ni, s.knowledge);
      if (c === Infinity) continue;
      const nd = d + c;
      if (nd < (dist.get(ni) ?? Infinity)) {
        dist.set(ni, nd);
        prev.set(ni, ti);
        heap.push(ni, nd);
      }
    }
  }
  if (!prev.has(goal)) return null;
  // Reconstruct path.
  const tiles = [];
  let cur = goal;
  while (cur !== undefined) {
    tiles.push(cur);
    if (cur === start) break;
    cur = prev.get(cur);
  }
  tiles.reverse();
  return { tiles, cost: dist.get(goal) };
}

// Local min-heap (cloned from transport.js style — keeps roads
// module standalone without crossing into transport internals).
class MinHeap {
  constructor() {
    this.ti = new Int32Array(256);
    this.d  = new Float32Array(256);
    this.n  = 0; this.cap = 256;
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
    const ti = this.ti[0], d = this.d[0];
    this.n--;
    if (this.n === 0) return { ti, d };
    this.ti[0] = this.ti[this.n]; this.d[0] = this.d[this.n];
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

// ── Trade: zero-sum transfer + transport cost (deadweight) ──
//
// Each tick on each active road, money moves from the BUYER (lower
// exportValue, importing) to the SELLER (higher exportValue,
// exporting). The buyer ALSO pays a transport cost — wages to
// porters, fodder for pack animals, spoilage en route — which is
// destroyed (consumed by labour that disperses it out of trackable
// wealth). Long / mountainous roads cost much more in transport,
// making long-distance trade unprofitable for low-margin goods.
//
//   trade value      = |exportDiff| × √min(pop) × TRADE_RATE
//   transport cost   = pathCost × TRANSPORT_PER_PATHCOST
//   buyer pays       = trade value + transport cost  (bounded by wealth)
//   seller receives  = trade value × (paid/want)     (scaled if buyer poor)
//   sunk             = transport cost × (paid/want)  (destroyed)
//
// Net effect on system wealth per road per tick: -transportCost
// (transport is the only money sink in the system besides the
// already-zero road build cost).
const TRADE_RATE              = 0.05;
const TRANSPORT_PER_PATHCOST  = 0.02;
export function updateTrade(world) {
  if (!world.roads || world.roads.length === 0) return;
  for (const road of world.roads) {
    if (!road || !road.active) continue;
    const a = findById(world, road.from);
    const b = findById(world, road.to);
    if (!a || !b || a.mode !== "settled" || b.mode !== "settled") continue;
    const exA = computeExportValue(a);
    const exB = computeExportValue(b);
    const diff = exA - exB;                          // >0: A exporter, B importer
    const minPop = Math.min(a.people, b.people);
    const tradeValue = Math.abs(diff) * Math.sqrt(minPop) * TRADE_RATE;
    const transport  = (road.pathCost || 0) * TRANSPORT_PER_PATHCOST;
    const want = tradeValue + transport;
    if (want <= 0) continue;
    const buyer  = diff > 0 ? b : a;
    const seller = diff > 0 ? a : b;
    const have = buyer.wealth || 0;
    if (have <= 0) continue;
    const actual = have < want ? have : want;
    const scale  = actual / want;
    const sellerGets = tradeValue * scale;
    buyer.wealth  -= actual;
    seller.wealth  = (seller.wealth || 0) + sellerGets;
    // The (transport × scale) remainder is the sink — it just
    // disappears, matching road-construction sink semantics.
  }
}

function findById(world, id) {
  for (let i = 0; i < world.settlements.length; i++) {
    if (world.settlements[i].id === id) return world.settlements[i];
  }
  return null;
}

export { ROAD_TILE_DISCOUNT };

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

const ROAD_COST_FACTOR     = 0.5;      // wealth per unit of path edge cost
const ROAD_COST_PER_TILE_MIN = 0.5;    // minimum cost per tile, even on flat road
const ROAD_TILE_DISCOUNT   = 0.15;     // existing road tile edge cost multiplier
const PLAN_INTERVAL        = 240;      // ticks between road-planning attempts
const MAX_PARTNER_DIST     = 80;       // tile-units of euclidean distance to consider
const MIN_POP_TO_PLAN      = 60;       // hamlets too small to fund anything
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
  let bestCost = 0;
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
    const pathCost = path.cost;
    const wealthCost = Math.max(ROAD_COST_PER_TILE_MIN * path.tiles.length, pathCost * ROAD_COST_FACTOR);
    if (wealthCost > s.wealth) continue;
    // Score: how much resource we'd unlock per unit wealth spent.
    // Length bonus discounts very short hops (might already be in reach).
    const score = bestResVal / Math.max(1, wealthCost) * (path.tiles.length > 3 ? 1 : 0.5);
    if (score > bestScore) {
      bestScore = score;
      bestPartner = peer;
      bestPath = path;
      bestCost = wealthCost;
    }
  }
  if (!bestPartner) return;

  // Build the road.
  const roadId = world.roads.length;
  const road = {
    id: roadId,
    from: s.id, to: bestPartner.id,
    path: bestPath.tiles,
    builtBy: s.id,
    builtStep: world.step,
    cost: bestCost,
    active: true,
  };
  world.roads.push(road);
  for (const ti of bestPath.tiles) world.roadTiles.add(ti);
  s.wealth -= bestCost;
  if (!s.roadsConnecting) s.roadsConnecting = [];
  if (!bestPartner.roadsConnecting) bestPartner.roadsConnecting = [];
  s.roadsConnecting.push(roadId);
  bestPartner.roadsConnecting.push(roadId);
  if (s.history) s.history.push({
    step: world.step, type: "road-built",
    to: bestPartner.id, tiles: bestPath.tiles.length, cost: Math.round(bestCost),
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

// ── Trade: zero-sum money transfer along roads ──
// Each tick, every active road moves money from the buyer
// (lower exportValue) to the seller (higher exportValue). The
// system creates no new money here — total wealth is conserved.
// Flow magnitude scales with both the export-value difference
// AND the smaller of the two populations (small markets bottleneck
// big partners). Bounded by the buyer's available wealth so a poor
// settlement can't go negative.
const TRADE_FLOW_RATE = 0.05;
export function updateTrade(world) {
  if (!world.roads || world.roads.length === 0) return;
  for (const road of world.roads) {
    if (!road || !road.active) continue;
    const a = findById(world, road.from);
    const b = findById(world, road.to);
    if (!a || !b || a.mode !== "settled" || b.mode !== "settled") continue;
    const exA = computeExportValue(a);
    const exB = computeExportValue(b);
    const diff = exA - exB;                          // >0: A is exporter; B pays
    if (Math.abs(diff) < 0.01) continue;             // similar offerings, nothing flows
    const minPop = Math.min(a.people, b.people);
    const want = Math.abs(diff) * Math.sqrt(minPop) * TRADE_FLOW_RATE;
    if (diff > 0) {
      const got = Math.min(want, b.wealth || 0);
      if (got > 0) { b.wealth -= got; a.wealth = (a.wealth || 0) + got; }
    } else {
      const got = Math.min(want, a.wealth || 0);
      if (got > 0) { a.wealth -= got; b.wealth = (b.wealth || 0) + got; }
    }
  }
}

function findById(world, id) {
  for (let i = 0; i < world.settlements.length; i++) {
    if (world.settlements[i].id === id) return world.settlements[i];
  }
  return null;
}

export { ROAD_TILE_DISCOUNT };

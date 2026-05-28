// ── Roads: tile-map model + per-settlement trade-reach cache ──
//
// Roads are NOT entities. The entire road network exists as two
// per-tile Float32Arrays:
//
//   world.roadQuality[ti]  — 1.0 = no road, < 1.0 = road quality.
//                            QUALITY_NEW (0.25) when freshly built,
//                            falls toward QUALITY_MAX (0.08) with use.
//                            Read by baseEdgeCost so Dijkstra prefers
//                            road tiles.
//   world.roadUsage[ti]    — accumulated trade traffic, drives the
//                            usage → quality wear function. Also
//                            used by the renderer to thicken trunk
//                            arteries.
//
// Each alive settlement caches its TRADE REACH — the shortest
// road-path to every other settlement it can reach through the
// existing network:
//
//   s._tradeReach : Map<peerId, { cost, tiles[] }>
//
// Rebuilt every road planning cycle (or whenever a new road tile
// is painted) by per-settlement Dijkstra through road tiles only.
// Trade passes iterate s._tradeReach pairs instead of a "road
// entity list" — giving naturally transitive trade: settlement 1
// can trade with 3 via the existing 1-2-3 chain without needing
// any explicit 1↔3 road.
//
// Road building: each plan cycle, settlements look for trade
// partners. If a peer is reachable via the network, the trade is
// already possible — only build a new road segment when (a) the
// peer is in a different network component (bridging needed), or
// (b) a new direct path is meaningfully shorter than the network
// route (genuine shortcut worth the effort). New tiles are
// painted into roadQuality; nothing else is created.

import { localEdgeCost, baseEdgeCost } from "./transport.js";
import { computeExportValue, getWealthReserve } from "./settlement.js";

// ── Constants ──────────────────────────────────────────────────────
const QUALITY_NEW         = 0.25;       // new road: 4× cheaper than plain
const QUALITY_MAX         = 0.08;       // worn arterial: 12× cheaper
const USAGE_FOR_MAX       = 5000;       // ticks of usage to reach max quality
const PLAN_INTERVAL       = 240;        // ticks between road-planning attempts
const MAX_PARTNER_DIST    = 80;         // Euclidean tile-distance for partner search
const MIN_POP_TO_PLAN     = 60;
const MAX_REACH_VISITS    = 8000;       // BFS visit cap for trade-reach computation

// New roads need a margin of improvement to justify the effort.
// Higher threshold for shortcuts within an existing network (the
// network already provides connectivity) vs lower for bridging
// disconnected clusters.
const NEW_FRACTION_OUT    = 0.35;       // peer in different component: low bar
const NEW_FRACTION_IN     = 0.80;       // peer in same component: must be much novel
const SHORTCUT_GAIN_RATIO = 0.65;       // new direct path must be ≤ 65% of network path

// Resource needs by tier — kept for road-planning preference.
const NEEDED_BY_TIER = [
  ["timber"],
  ["timber", "stone"],
  ["timber", "stone", "copper", "iron"],
  ["timber", "stone", "copper", "tin", "iron", "coal"],
];
const HAVE_THRESHOLD = 0.10;

// Trade flow rates (same as old model so dynamics carry over).
const TRADE_RATE                   = 0.025;
const TRANSPORT_PER_PATHCOST       = 0.012;
const FOOD_PRICE                   = 5;
const FOOD_TRANSPORT_PER_PATHCOST  = 0.005;
const STARVING_TICKS_LEFT          = 100;
const FOOD_IMPORT_EMA_ALPHA        = 0.002;
const USAGE_PER_TRADE              = 0.04;   // wear per tile per active trade tick

export { QUALITY_NEW, QUALITY_MAX, USAGE_FOR_MAX };

// ── State init ─────────────────────────────────────────────────────
function ensureRoadArrays(world) {
  if (!world.roadQuality || world.roadQuality.length !== world.N) {
    world.roadQuality = new Float32Array(world.N).fill(1.0);
  }
  if (!world.roadUsage || world.roadUsage.length !== world.N) {
    world.roadUsage = new Float32Array(world.N);
  }
}

// Map: settlementId → its home tile index. Inverse lookup tile → settlement.
function buildSettlementTileMap(world) {
  const map = new Map();
  for (const s of world.settlements) {
    if (s.mode !== "settled") continue;
    const ti = (s.pos.y | 0) * world.tw + (s.pos.x | 0);
    map.set(ti, s);
  }
  return map;
}

// Network components via BFS on road tiles + settlement tiles. Two
// settlements are in the same component if a continuous road / via-
// settlement path connects them. Returns Map<settlementId → rootId>
// and ALSO populates world._tileComponent (Map<tileIndex → rootId>)
// used by tryAddRoad's junction-truncation.
export function buildNetworkComponents(world) {
  const out = new Map();
  const tileComp = new Map();
  if (!world.roadQuality) { world._tileComponent = tileComp; return out; }
  const stMap = buildSettlementTileMap(world);
  const { tw, th, roadQuality: rq } = world;
  const visited = new Uint8Array(world.N);
  for (const s of world.settlements) {
    if (s.mode !== "settled" || out.has(s.id)) continue;
    const start = (s.pos.y | 0) * tw + (s.pos.x | 0);
    out.set(s.id, s.id);
    if (visited[start]) continue;
    const root = s.id;
    const q = [start];
    visited[start] = 1;
    tileComp.set(start, root);
    while (q.length) {
      const ti = q.shift();
      const peer = stMap.get(ti);
      if (peer && peer.id !== s.id) out.set(peer.id, root);
      const ty = (ti / tw) | 0, tx = ti - ty * tw;
      const ns = [
        ty * tw + (tx === 0 ? tw - 1 : tx - 1),
        ty * tw + (tx === tw - 1 ? 0 : tx + 1),
        ty > 0      ? (ty - 1) * tw + tx : -1,
        ty < th - 1 ? (ty + 1) * tw + tx : -1,
      ];
      for (const ni of ns) {
        if (ni < 0 || visited[ni]) continue;
        const isRoad = rq[ni] < 1.0;
        const isSett = stMap.has(ni);
        if (!isRoad && !isSett) continue;
        visited[ni] = 1;
        tileComp.set(ni, root);
        q.push(ni);
      }
    }
  }
  world._tileComponent = tileComp;
  return out;
}

// ── Trade-reach: per-settlement Dijkstra through road network ──
// For each alive settlement, compute the shortest road-path to every
// other settlement reachable via the network. Result is cached on
// s._tradeReach for the trade pass to iterate.
export function rebuildTradeReach(world) {
  if (!world.roadQuality) return;
  const stMap = buildSettlementTileMap(world);
  for (const s of world.settlements) {
    if (s.mode !== "settled") { s._tradeReach = null; continue; }
    s._tradeReach = computeReach(world, s, stMap);
  }
}

function computeReach(world, s, stMap) {
  const reach = new Map();
  const { tw, th, roadQuality: rq } = world;
  const startTi = (s.pos.y | 0) * tw + (s.pos.x | 0);
  const dist = new Map();
  const prev = new Map();
  const heap = new MinHeap();
  dist.set(startTi, 0);
  heap.push(startTi, 0);
  let visited = 0;
  while (heap.n > 0 && visited++ < MAX_REACH_VISITS) {
    const { ti, d } = heap.popMin();
    if (d > (dist.get(ti) ?? Infinity)) continue;
    // Record peer arrivals (other settlement home tiles)
    const peer = stMap.get(ti);
    if (peer && peer.id !== s.id && !reach.has(peer.id)) {
      const tiles = [];
      let cur = ti;
      while (cur !== undefined) {
        tiles.push(cur);
        if (cur === startTi) break;
        cur = prev.get(cur);
      }
      tiles.reverse();
      reach.set(peer.id, { cost: d, tiles });
      // Continue — there may be more peers further along this branch.
    }
    // Expand to neighbours that are roads or settlement tiles.
    const ty = (ti / tw) | 0, tx = ti - ty * tw;
    const ns = [
      ty * tw + (tx === 0 ? tw - 1 : tx - 1),
      ty * tw + (tx === tw - 1 ? 0 : tx + 1),
      ty > 0      ? (ty - 1) * tw + tx : -1,
      ty < th - 1 ? (ty + 1) * tw + tx : -1,
    ];
    for (const ni of ns) {
      if (ni < 0) continue;
      const isRoad = rq[ni] < 1.0;
      const isSett = stMap.has(ni);
      if (!isRoad && !isSett) continue;
      // Cost: use the road tile's quality (or a small settlement-
      // transit cost for non-road settlement tiles).
      const stepCost = isRoad ? rq[ni] : 0.15;
      const nd = d + stepCost;
      if (nd < (dist.get(ni) ?? Infinity)) {
        dist.set(ni, nd);
        prev.set(ni, ti);
        heap.push(ni, nd);
      }
    }
  }
  return reach;
}

// ── Road planning ─────────────────────────────────────────────────
// Each plan cycle, every alive settlement considers building one
// new road segment. The decision is informed by:
//   1. Existing trade reach — peers already in network are
//      "connected"; only worth a new road for genuine shortcuts.
//   2. Resource gaps (missing tier-need resources at peer).
//   3. Trade gap (different exportValues).
//   4. Food complementarity (one has surplus, other deficit).
// When a road segment is added, new tiles are painted into
// roadQuality and the trade reach is rebuilt so subsequent plans
// see the new connectivity.
export function maybeBuildRoads(world) {
  ensureRoadArrays(world);
  if (world.step % PLAN_INTERVAL !== 0) return;

  const candidates = world.settlements.filter(
    s => s.mode === "settled" && s.people >= MIN_POP_TO_PLAN
  );
  // Rebuild reach + components before this plan cycle so all
  // settlements see the current network state.
  rebuildTradeReach(world);
  world._networkComponents = buildNetworkComponents(world);
  let anyBuilt = false;
  for (const s of candidates) {
    if (tryAddRoad(world, s)) {
      anyBuilt = true;
      // Rebuild incrementally so later candidates in this cycle
      // see the road we just added.
      rebuildTradeReach(world);
      world._networkComponents = buildNetworkComponents(world);
    }
  }
  return anyBuilt;
}

function tryAddRoad(world, s) {
  const sExport = computeExportValue(s);
  const sFood = (s._foodSupply || 0) - (s._foodDemand || 0);
  const own = s.localRes || {};
  // Resources we already have access to via local OR via existing
  // trade reach. Anything missing from this set is a "needed"
  // resource that justifies building a road.
  const reachable = { ...own };
  if (s._tradeReach) {
    for (const peerId of s._tradeReach.keys()) {
      const peer = findById(world, peerId);
      if (!peer) continue;
      const pr = peer.localRes || {};
      for (const k in pr) {
        if ((pr[k] || 0) > (reachable[k] || 0)) reachable[k] = pr[k];
      }
    }
  }
  const tierNeeds = NEEDED_BY_TIER[s.tier] || NEEDED_BY_TIER[0];
  const missing = tierNeeds.filter(n => (reachable[n] || 0) < HAVE_THRESHOLD);

  const components = world._networkComponents;
  const myComp = components ? components.get(s.id) : null;

  let bestPartner = null, bestScore = -Infinity, bestPath = null, bestNewFrac = 0;
  for (const peer of world.settlements) {
    if (peer.mode !== "settled" || peer.id === s.id) continue;
    let dx = Math.abs(peer.pos.x - s.pos.x);
    if (dx > world.tw / 2) dx = world.tw - dx;
    const dy = peer.pos.y - s.pos.y;
    if (dx * dx + dy * dy > MAX_PARTNER_DIST * MAX_PARTNER_DIST) continue;

    // Resource gain from connecting to this peer.
    const peerRes = peer.localRes || {};
    let resGain = 0;
    for (const n of missing) {
      if ((peerRes[n] || 0) >= HAVE_THRESHOLD) resGain += 1;
    }
    // Export-value gap.
    const peerExport = computeExportValue(peer);
    const exGap = Math.abs(sExport - peerExport);
    // Food complementarity.
    const peerFood = (peer._foodSupply || 0) - (peer._foodDemand || 0);
    let foodGain = 0;
    if ((sFood < -0.01 && peerFood > 0.01) ||
        (sFood > 0.01 && peerFood < -0.01)) {
      foodGain = Math.min(Math.abs(sFood), Math.abs(peerFood));
    }
    // Always evaluate the path — early-game settlements have similar
    // export profiles, so a hard eligibility gate here would prevent
    // initial network formation entirely. The score-multiplier
    // below still favours genuinely-useful partners.
    const path = findPath(world, s, peer);
    if (!path) continue;

    // New-tile fraction: how much of the path is NOT yet on a
    // road. Lower bar to bridge disconnected clusters; higher
    // bar to add a shortcut within an existing network.
    const rq = world.roadQuality;
    let newTiles = 0;
    for (const ti of path.tiles) if (rq[ti] >= 1.0) newTiles++;
    const newFrac = path.tiles.length > 0 ? newTiles / path.tiles.length : 0;
    const sameNetwork = myComp !== null && components && components.get(peer.id) === myComp;
    const requiredFrac = sameNetwork ? NEW_FRACTION_IN : NEW_FRACTION_OUT;
    if (newFrac < requiredFrac) continue;

    // If same network: ALSO require the new direct path to be
    // meaningfully shorter than the existing network path.
    if (sameNetwork && s._tradeReach && s._tradeReach.has(peer.id)) {
      const networkCost = s._tradeReach.get(peer.id).cost;
      if (path.cost > networkCost * SHORTCUT_GAIN_RATIO) continue;
    }

    // Wealth eagerness: both sides' wealth raise enthusiasm. A
    // poor village seeing a rich neighbour wants the road too.
    const effectiveWealth = Math.max(s.wealth || 0, (peer.wealth || 0) * 0.5);
    const wealthEagerness = Math.min(2.0, 1 + Math.log10(Math.max(1, effectiveWealth)) / 6);
    const benefit = resGain * 2 + exGap + foodGain * 10;
    const score = benefit / Math.max(1, path.cost)
                * (path.tiles.length > 3 ? 1 : 0.5)
                * wealthEagerness
                * newFrac;
    if (score > bestScore) {
      bestScore = score;
      bestPartner = peer;
      bestPath = path;
      bestNewFrac = newFrac;
    }
  }
  if (!bestPartner) return false;

  // Truncate at junction onto destination's network (if any).
  const destComp = components ? components.get(bestPartner.id) : null;
  const tileComp = world._tileComponent;
  let physicalTiles = bestPath.tiles;
  if (destComp !== null && tileComp) {
    for (let i = 1; i < bestPath.tiles.length; i++) {
      if (tileComp.get(bestPath.tiles[i]) === destComp) {
        physicalTiles = bestPath.tiles.slice(0, i + 1);
        break;
      }
    }
  }
  // Paint new tiles into roadQuality (take min so we don't downgrade
  // an existing worn road).
  const rq = world.roadQuality;
  for (const ti of physicalTiles) {
    if (QUALITY_NEW < rq[ti]) rq[ti] = QUALITY_NEW;
  }
  if (s.history) s.history.push({
    step: world.step, type: "road-built",
    to: bestPartner.id, tiles: physicalTiles.length,
    pathCost: Math.round(bestPath.cost), newFrac: +bestNewFrac.toFixed(2),
  });
  return true;
}

// ── Trade pass — iterates per-settlement reach pairs ───────────────
// Each tick, for each alive settlement, iterate its trade reach
// (cached shortest road-paths to all reachable settlements). For
// each pair (S, P) with S.id < P.id (avoid double-processing):
//   1. Food trade — if surplus/deficit complementarity exists
//   2. General trade — flow money from lower exportValue to higher
// Both apply the appropriate per-tick transport cost (as a sink)
// and wear the path tiles by incrementing roadUsage.
export function updateTrade(world) {
  ensureRoadArrays(world);
  // Food import EMA decay (per-settlement) runs every tick.
  for (const s of world.settlements) {
    if (s.mode === "settled") {
      s._foodImportRate = (s._foodImportRate || 0) * (1 - FOOD_IMPORT_EMA_ALPHA);
    }
  }
  // Iterate settlements, then pair with their reach.
  for (const s of world.settlements) {
    if (s.mode !== "settled" || !s._tradeReach) continue;
    for (const [peerId, link] of s._tradeReach) {
      if (peerId <= s.id) continue;   // process each pair once
      const peer = findById(world, peerId);
      if (!peer || peer.mode !== "settled") continue;
      runFoodTradeBetween(world, s, peer, link);
      runGeneralTradeBetween(world, s, peer, link);
      // Wear the path tiles.
      if (link.tiles && link.tiles.length > 0) {
        const ru = world.roadUsage;
        for (const ti of link.tiles) ru[ti] += USAGE_PER_TRADE;
      }
    }
  }
  // Apply usage → quality update (smoothly, per-tick).
  // Each tile's quality improves toward QUALITY_MAX with usage.
  const rq = world.roadQuality, ru = world.roadUsage;
  if (rq && ru) {
    for (let ti = 0; ti < world.N; ti++) {
      if (rq[ti] >= 1.0) continue;  // not a road tile
      const t = Math.min(1, ru[ti] / USAGE_FOR_MAX);
      const target = QUALITY_NEW - t * (QUALITY_NEW - QUALITY_MAX);
      if (target < rq[ti]) rq[ti] = target;
    }
  }
}

function runFoodTradeBetween(world, a, b, link) {
  const aSurplus = (a._foodSupply || 0) - (a._foodDemand || 0);
  const bSurplus = (b._foodSupply || 0) - (b._foodDemand || 0);
  let exporter, importer, shipRate, deficit;
  if (aSurplus > 0.001 && bSurplus < -0.001) {
    exporter = a; importer = b; shipRate = aSurplus; deficit = -bSurplus;
  } else if (bSurplus > 0.001 && aSurplus < -0.001) {
    exporter = b; importer = a; shipRate = bSurplus; deficit = -aSurplus;
  } else return;
  // Growth-reserve fraction for exporter (feed own children first).
  const exporterK = exporter._k || Math.max(1, exporter.people);
  const headroom = Math.max(0, 1 - exporter.people / exporterK);
  const reserveFraction = 0.20 + headroom * 0.50;
  const effectiveShipRate = shipRate * (1 - reserveFraction);
  const storageRate = (exporter.food || 0) * 0.01;
  const maxFlow = Math.min(effectiveShipRate, deficit, storageRate);
  if (maxFlow <= 0) return;
  const wantPrice = maxFlow * FOOD_PRICE;
  const transport = link.cost * FOOD_TRANSPORT_PER_PATHCOST;
  const totalCost = wantPrice + transport;
  // Starvation overrides reserve.
  const importerDemand = importer._foodDemand || 0.001;
  const ticksLeft = (importer.food || 0) / importerDemand;
  const isStarving = ticksLeft < STARVING_TICKS_LEFT;
  const reserve = isStarving ? 0 : getWealthReserve(importer);
  const available = Math.max(0, (importer.wealth || 0) - reserve);
  if (available <= 0) return;
  const affordable = available < totalCost ? available : totalCost;
  const scale = affordable / totalCost;
  const actualFood = maxFlow * scale;
  const actualPayment = wantPrice * scale;
  const actualTransport = transport * scale;
  importer.wealth -= (actualPayment + actualTransport);
  exporter.wealth = (exporter.wealth || 0) + actualPayment;
  importer.food = (importer.food || 0) + actualFood;
  exporter.food = (exporter.food || 0) - actualFood;
  importer._foodImportRate = (importer._foodImportRate || 0) + actualFood * FOOD_IMPORT_EMA_ALPHA;
}

function runGeneralTradeBetween(world, a, b, link) {
  const exA = computeExportValue(a);
  const exB = computeExportValue(b);
  const diff = exA - exB;
  const minPop = Math.min(a.people, b.people);
  const tradeValue = Math.abs(diff) * Math.sqrt(minPop) * TRADE_RATE;
  const transport = link.cost * TRANSPORT_PER_PATHCOST;
  const want = tradeValue + transport;
  if (want <= 0) return;
  const buyer = diff > 0 ? b : a;
  const seller = diff > 0 ? a : b;
  const reserve = getWealthReserve(buyer);
  const available = Math.max(0, (buyer.wealth || 0) - reserve);
  if (available <= 0) return;
  const actual = available < want ? available : want;
  const scale = actual / want;
  const sellerGets = tradeValue * scale;
  buyer.wealth -= actual;
  seller.wealth = (seller.wealth || 0) + sellerGets;
}

// ── Helpers ────────────────────────────────────────────────────────
function findById(world, id) {
  for (let i = 0; i < world.settlements.length; i++) {
    if (world.settlements[i].id === id) return world.settlements[i];
  }
  return null;
}

// Bounded Dijkstra from s to t (full terrain Dijkstra including
// the road-override discount in baseEdgeCost). Used by road
// planning to decide if a new road segment between two settlements
// is worth painting.
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
  const limit = 20000;
  let visited = 0;
  while (heap.n > 0) {
    if (visited++ > limit) return null;
    const { ti, d } = heap.popMin();
    if (d > (dist.get(ti) ?? Infinity)) continue;
    if (ti === goal) break;
    const ty = (ti / tw) | 0, tx = ti - ty * tw;
    const ns = [
      ty * tw + (tx === 0 ? tw - 1 : tx - 1),
      ty * tw + (tx === tw - 1 ? 0 : tx + 1),
      ty > 0      ? (ty - 1) * tw + tx : -1,
      ty < th - 1 ? (ty + 1) * tw + tx : -1,
    ];
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

// Float64 distance storage is required: dist is a Map (Float64 numbers),
// and the staleness check `d > dist.get(ti)` would mis-fire on Float32
// rounding — a value pushed at d=4.24445128 reads back as 4.24445152,
// which compares greater than the Map's exact 4.24445128 and silently
// drops the expansion.
class MinHeap {
  constructor() {
    this.ti = new Int32Array(256);
    this.d  = new Float64Array(256);
    this.n  = 0; this.cap = 256;
  }
  _grow() {
    const ncap = this.cap * 2;
    const nti = new Int32Array(ncap); nti.set(this.ti);
    const nd  = new Float64Array(ncap); nd.set(this.d);
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

// Compatibility shims so callers using old function names still work.
export function updateFoodTrade() { /* merged into updateTrade */ }
export function maybeRebuildRoadQuality() { /* tile quality now updates per-tick in updateTrade */ }
export function rebuildRoadTileQuality(world) { ensureRoadArrays(world); }

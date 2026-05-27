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
import { computeExportValue, getWealthReserve } from "./settlement.js";

const TRADE_RATE              = 0.025;     // slower per-tick exchange — settlements visibly accumulate
const TRANSPORT_PER_PATHCOST  = 0.012;     // reduced proportionally with trade rate

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

  const candidates = world.settlements
    .filter(s => s.mode === "settled"
              && s.people >= MIN_POP_TO_PLAN
              && (s.roadsConnecting?.length || 0) < MAX_ROADS_PER_SETT);
  for (const s of candidates) {
    // Rebuild network components before each plan so a road built
    // earlier in this loop is visible — prevents redundant duplicate
    // links when several settlements all want to reach a hub.
    world._networkComponents = buildNetworkComponents(world);
    tryBuildOne(world, s);
  }
}

// Union-find over the road graph. Each alive settlement id maps to
// the "root" id of its connected component; two settlements with
// the same root can already reach each other through the existing
// road network and shouldn't need a direct redundant road built
// between them.
export function buildNetworkComponents(world) {
  const parent = new Map();
  const find = (x) => {
    let p = x;
    while ((parent.get(p) ?? p) !== p) p = parent.get(p);
    // Path compression for the next call.
    let cur = x;
    while ((parent.get(cur) ?? cur) !== p) {
      const next = parent.get(cur);
      parent.set(cur, p);
      cur = next;
    }
    return p;
  };
  const union = (a, b) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (const s of world.settlements) {
    if (s.mode === "settled" && !parent.has(s.id)) parent.set(s.id, s.id);
  }
  for (const road of world.roads || []) {
    if (road.active) union(road.from, road.to);
  }
  const out = new Map();
  for (const s of world.settlements) {
    if (s.mode === "settled") out.set(s.id, find(s.id));
  }
  return out;
}

function tryBuildOne(world, s) {
  const needs = NEEDED_BY_TIER[s.tier] || NEEDED_BY_TIER[0];
  const own = s.localRes || {};
  const connected = new Set(s.roadsConnecting || []);
  // Effective reach via existing road links — figures into resource-
  // gap analysis (resources we already get via trade don't count
  // as "missing").
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
  // exportValue of this settlement — used to gauge trade asymmetry
  // with each candidate.
  const sExport = computeExportValue(s);

  // Scan candidate partners. A road is worth building if EITHER
  //   (a) the peer has a resource we lack (tech / supply gap), OR
  //   (b) the peer has a substantially different exportValue
  //       (trade gap — different specialties, money will flow).
  // Score combines both; settlements rich in money but resource-
  // self-sufficient will still build roads to lower-exportValue
  // neighbours to spend their wealth on imports.
  let bestPartner = null;
  let bestScore = -Infinity;
  let bestPath = null;
  for (const peer of world.settlements) {
    if (peer.mode !== "settled" || peer.id === s.id) continue;
    if (connected.has(roadIdBetween(world, s.id, peer.id))) continue;
    let dx = Math.abs(peer.pos.x - s.pos.x);
    if (dx > world.tw / 2) dx = world.tw - dx;
    const dy = peer.pos.y - s.pos.y;
    if (dx * dx + dy * dy > MAX_PARTNER_DIST * MAX_PARTNER_DIST) continue;
    // Resource benefit: how many of our missing resources does this
    // peer have? Each one contributes 1.0 to the score.
    const peerRes = peer.localRes || {};
    let resGain = 0;
    for (const n of missing) {
      if ((peerRes[n] || 0) >= HAVE_THRESHOLD) resGain += 1;
    }
    // Trade benefit: |exportValue gap|. Settlements with very
    // different offerings make worthwhile trade partners even
    // without specific resource needs.
    const peerExport = computeExportValue(peer);
    const exGap = Math.abs(sExport - peerExport);
    // Food complementarity: one settlement has surplus, the other
    // has deficit. This is THE main reason farming villages should
    // build roads — they monetize their grain by selling to nearby
    // cities. Weighted heavily because food trade is high-value
    // (every food unit nets $5 to the seller), and without this
    // signal food-surplus villages just sit on rotting grain.
    const sFood = (s._foodSupply || 0) - (s._foodDemand || 0);
    const peerFood = (peer._foodSupply || 0) - (peer._foodDemand || 0);
    let foodGain = 0;
    if ((sFood < -0.01 && peerFood > 0.01) ||
        (sFood > 0.01 && peerFood < -0.01)) {
      foodGain = Math.min(Math.abs(sFood), Math.abs(peerFood));
    }
    // Skip if there's neither a resource gain nor a meaningful
    // trade gap nor a food complementarity. Threshold low enough
    // that small specialty differences (every village has some
    // baseline products) can still motivate a road if the partner
    // is nearby.
    if (resGain === 0 && exGap < 0.15 && foodGain < 0.01) continue;
    // Dijkstra path (existing roads route cheap).
    const path = findPath(world, s, peer);
    if (!path) continue;
    // New-tile fraction: how much of this proposed path is OFF the
    // existing road network? If almost all overlap, the new road
    // would be redundant — trade can already flow via the existing
    // network. Only build if the path is meaningfully NEW terrain,
    // i.e., a real new direct route worth the effort.
    let newTiles = 0;
    for (const ti of path.tiles) if (!world.roadTiles.has(ti)) newTiles++;
    const newFrac = path.tiles.length > 0 ? newTiles / path.tiles.length : 0;
    if (newFrac < MIN_NEW_TILE_FRACTION) continue;
    // Score combines resource gain (weighted 2x — direct tech
    // unlock) + trade gap (weighted 1x). Divided by path cost so
    // closer partners are preferred when benefits tie. Short-hop
    // penalty unchanged.
    // Wealth eagerness goes BOTH ways:
    //   - settlements with money want to spend it on imports
    //     (own wealth → rich-buyer motivation)
    //   - settlements without money still want roads to wealthy
    //     neighbours so they can SELL their goods to them
    //     (peer wealth → rich-customer motivation)
    // We use the max of own wealth and HALF the peer's wealth so a
    // poor village seeing a rich neighbour is as eager to build a
    // road as a rich settlement seeing a poor one.
    const effectiveWealth = Math.max(s.wealth || 0, (peer.wealth || 0) * 0.5);
    const wealthEagerness = Math.min(2.0, 1 + Math.log10(Math.max(1, effectiveWealth)) / 6);
    // Food gets a strong weight (×10) because a steady food road
    // generates real wealth — at $5 per food unit per tick, a
    // 0.1 food surplus through a road earns $0.50/tick which over
    // hundreds of ticks dwarfs casual specialty trade.
    const benefit = resGain * 2 + exGap + foodGain * 10;
    const score = benefit / Math.max(1, path.cost)
                * (path.tiles.length > 3 ? 1 : 0.5)
                * wealthEagerness;
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
    usage: 0,                  // accumulated ticks of active trade — drives roadTileQuality
    active: true,
  };
  world.roads.push(road);
  for (const ti of bestPath.tiles) world.roadTiles.add(ti);
  // Immediately register the new road's tile quality so other
  // settlements planning in the SAME tick (and during the next
  // 64 ticks before the periodic rebuild) can route through it.
  // EAGERLY initialise the cache here — it's null before the first
  // road, so without this, early road batches never see each other
  // and you get parallel paths instead of a merged network.
  if (!world.roadTileQuality || world.roadTileQuality.length !== world.N) {
    world.roadTileQuality = new Float32Array(world.N);
    world.roadTileQuality.fill(1.0);
  }
  for (const ti of bestPath.tiles) {
    if (QUALITY_NEW < world.roadTileQuality[ti]) world.roadTileQuality[ti] = QUALITY_NEW;
  }
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
  const limit = 20000;            // generous so Dijkstra has room to detour via distant existing roads
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
// ── Food trade (priority pass) ──
// Runs BEFORE general trade so food gets first dibs on the buyer's
// wealth. A starving settlement can dip into its rainy-day reserve
// for food (and only food) — the urgency override.
//
//   surplus side ships food to deficit side
//   importer pays exporter $FOOD_PRICE per food unit
//   transport surcharge destroyed (path × FOOD_TRANSPORT_PER_PATHCOST)
//   importer.food += actualFood;  exporter.food -= actualFood
//
// Imported food is also tracked in importer._foodImportRate so
// updatePopulation can lift its carrying capacity above local food
// production (Rome-via-Egypt grain pattern).
const FOOD_PRICE                   = 5;       // wealth per food unit
const FOOD_TRANSPORT_PER_PATHCOST  = 0.005;   // ¼ of general transport — bulk shipping
const STARVING_TICKS_LEFT          = 100;     // < 100 ticks of food → emergency

// EMA alpha for tracking average per-tick food imports. ~350-tick
// half-life — matches the logistic-growth timescale of pop. A city
// won't grow on a brief import surge, nor collapse on a brief dip;
// it tracks the SUSTAINED inflow over many seasons.
const FOOD_IMPORT_EMA_ALPHA = 0.002;
export function updateFoodTrade(world) {
  if (!world.roads || world.roads.length === 0) return;
  // EMA: each tick, smooth toward the current tick's input. The
  // (1 - α) decay runs every tick regardless of trade; α-scaled
  // additions only fire when food actually flows. Steady inflow
  // of X food/tick → equilibrium _foodImportRate = X.
  for (const s of world.settlements) {
    if (s.mode === "settled") {
      s._foodImportRate = (s._foodImportRate || 0) * (1 - FOOD_IMPORT_EMA_ALPHA);
    }
  }
  for (const road of world.roads) {
    if (!road || !road.active) continue;
    const a = findById(world, road.from);
    const b = findById(world, road.to);
    if (!a || !b || a.mode !== "settled" || b.mode !== "settled") continue;
    const aSurplus = (a._foodSupply || 0) - (a._foodDemand || 0);
    const bSurplus = (b._foodSupply || 0) - (b._foodDemand || 0);
    let exporter, importer, shipRate, deficit;
    if (aSurplus > 0.001 && bSurplus < -0.001) {
      exporter = a; importer = b; shipRate = aSurplus; deficit = -bSurplus;
    } else if (bSurplus > 0.001 && aSurplus < -0.001) {
      exporter = b; importer = a; shipRate = bSurplus; deficit = -aSurplus;
    } else continue;
    // Growth-buffer reservation: the exporter keeps part of their
    // surplus for their OWN population growth. Headroom is how far
    // below K they are (0 at K, 1 at empty); they reserve a bigger
    // share when they have room to grow. At K → 20% reserve (still
    // a small famine buffer); far below K → 70% reserve (most
    // surplus fed to their own children before sold to outsiders).
    const exporterK = exporter._k || Math.max(1, exporter.people);
    const headroom = Math.max(0, 1 - exporter.people / exporterK);
    const reserveFraction = 0.20 + headroom * 0.50;
    const effectiveShipRate = shipRate * (1 - reserveFraction);
    // Per-tick flow capped at: exporter's effective ship rate (after
    // their growth reserve), importer's deficit, and a small
    // fraction of exporter's stored food (can't ship out their
    // entire granary in one tick).
    const storageRate = (exporter.food || 0) * 0.01;
    const maxFlow = Math.min(effectiveShipRate, deficit, storageRate);
    if (maxFlow <= 0) continue;
    const wantPrice = maxFlow * FOOD_PRICE;
    const transport = (road.pathCost || 0) * FOOD_TRANSPORT_PER_PATHCOST;
    const totalCost = wantPrice + transport;
    // Urgency override: starving settlement dips into reserve for food.
    const importerDemand = importer._foodDemand || 0.001;
    const ticksOfFoodLeft = (importer.food || 0) / importerDemand;
    const isStarving = ticksOfFoodLeft < STARVING_TICKS_LEFT;
    const reserve = isStarving ? 0 : getWealthReserve(importer);
    const available = Math.max(0, (importer.wealth || 0) - reserve);
    if (available <= 0) continue;
    const affordable = available < totalCost ? available : totalCost;
    const scale = affordable / totalCost;
    const actualFood = maxFlow * scale;
    const actualPayment = wantPrice * scale;
    const actualTransport = transport * scale;
    importer.wealth -= (actualPayment + actualTransport);
    exporter.wealth = (exporter.wealth || 0) + actualPayment;
    importer.food = (importer.food || 0) + actualFood;
    exporter.food = (exporter.food || 0) - actualFood;
    // α-scale this tick's actual food into the EMA so the running
    // value represents an average per-tick rate, not an integrated
    // sum. Without the α, _foodImportRate would settle at 50× the
    // per-tick rate.
    importer._foodImportRate = (importer._foodImportRate || 0)
                              + actualFood * FOOD_IMPORT_EMA_ALPHA;
    if (scale > 0.1) road.usage = (road.usage || 0) + scale * 0.5;
  }
}

// Net effect on system wealth per road per tick: -transportCost
// (transport is the only money sink in the system besides the
// already-zero road build cost).
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
    // Buyer's affordable spending = wealth ABOVE their reserve.
    // Below reserve, the settlement is in "hoarding" mode — they
    // hold their treasury and refuse to import anything. This is
    // the urgency gate: a poor settlement won't buy luxuries when
    // they're below their rainy-day fund.
    const have = buyer.wealth || 0;
    const reserve = getWealthReserve(buyer);
    const available = have - reserve;
    if (available <= 0) continue;
    const actual = available < want ? available : want;
    const scale  = actual / want;
    const sellerGets = tradeValue * scale;
    buyer.wealth  -= actual;
    seller.wealth  = (seller.wealth || 0) + sellerGets;
    // The (transport × scale) remainder is the sink — it just
    // disappears, matching road-construction sink semantics.
    // Wear the road in — quality compounds over thousands of ticks
    // of active trade, eventually reaching the MAX_QUALITY discount.
    if (scale > 0.1) road.usage = (road.usage || 0) + scale;
  }
}

// ── Road tile quality ──
// Each road improves with use. road.usage accumulates per tick of
// active trade (scaled by trade-completion ratio). The discount
// applied to edges crossing that road's tiles scales from the
// baseline (new path) down to MAX_QUALITY (worn arterial) over
// USAGE_FOR_MAX ticks of accumulated traffic.
const QUALITY_NEW          = 0.25;       // new road: 4× cheaper than plain
const QUALITY_MAX          = 0.08;       // worn arterial: 12× cheaper
// Minimum fraction of a candidate path's tiles that must be NEW (not
// already on an existing road) to justify building. Below this, the
// "new" road would mostly overlap the existing network — skip it.
const MIN_NEW_TILE_FRACTION = 0.35;
const USAGE_FOR_MAX        = 5000;       // ticks of trade to reach top quality
const QUALITY_REBUILD_FREQ = 64;         // ticks between cache rebuilds

function roadDiscount(usage) {
  const t = Math.min(1, (usage || 0) / USAGE_FOR_MAX);
  return QUALITY_NEW - t * (QUALITY_NEW - QUALITY_MAX);
}

export function rebuildRoadTileQuality(world) {
  if (!world.roads || world.roads.length === 0) {
    world.roadTileQuality = null;
    return;
  }
  if (!world.roadTileQuality || world.roadTileQuality.length !== world.N) {
    world.roadTileQuality = new Float32Array(world.N);
  }
  // 1.0 means "no road here, full base cost". Roads will write a
  // value < 1.0 over their tiles (lower = better road).
  world.roadTileQuality.fill(1.0);
  for (const road of world.roads) {
    if (!road.active) continue;
    const q = roadDiscount(road.usage);
    for (const ti of road.path) {
      if (q < world.roadTileQuality[ti]) world.roadTileQuality[ti] = q;
    }
  }
}

export function maybeRebuildRoadQuality(world) {
  if (world.step % QUALITY_REBUILD_FREQ !== 0) return;
  rebuildRoadTileQuality(world);
}

function findById(world, id) {
  for (let i = 0; i < world.settlements.length; i++) {
    if (world.settlements[i].id === id) return world.settlements[i];
  }
  return null;
}

export { ROAD_TILE_DISCOUNT };

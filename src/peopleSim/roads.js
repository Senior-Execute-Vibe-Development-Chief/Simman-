// ── Roads: tile-map model + per-settlement trade-reach cache ──
//
// Roads are NOT entities. The entire road network exists as two
// per-tile Float32Arrays:
//
//   world.roadQuality[ti]  — 1.0 = no road, < 1.0 = road quality.
//                            QUALITY_NEW (0.25) when freshly built,
//                            falls toward QUALITY_MAX (0.08) under
//                            sustained flow. Monotonically decreases —
//                            a road never gets worse.
//                            Read by baseEdgeCost so Dijkstra prefers
//                            road tiles.
//   world.roadFlow[ti]     — current trade traffic rate per tile, a
//                            decaying EMA-style value. Each active
//                            trade tick adds USAGE_PER_TRADE; each
//                            tick the whole field decays by
//                            FLOW_DECAY so abandoned roads fall
//                            silent. Drives both the quality
//                            pave-rate and the renderer's
//                            trunk-thickness — "busy" means traffic
//                            NOW, not traffic at any point in
//                            history.
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
const PLAN_INTERVAL       = 240;        // ticks between road-planning attempts
const MIN_POP_TO_PLAN     = 60;
const MAX_REACH_VISITS    = 8000;       // BFS visit cap for trade-reach computation
// Caps on full-path A* evaluations per settlement per plan cycle.
// Candidates are ranked by (cheap) trade benefit first; only this many
// get a real path computed, so the cost is bounded regardless of how
// many peers fall within a big city's partner reach. Split by kind:
//   • NEW    — peers NOT yet in the trade network (genuine new bridges,
//              the builds that matter); pathed generously.
//   • SHORTCUT — peers already reachable via the network (we only path
//              them to look for a meaningfully-shorter direct line).
//              Tightly capped: on a stable, fully-connected network this
//              is the only work left, and it's almost always fruitless.
const MAX_NEW_EVALS       = 6;
const MAX_SHORTCUT_EVALS  = 2;

// Flow dynamics. roadFlow gains USAGE_PER_TRADE per active trade
// per tile each tick, decays multiplicatively the rest of the time.
// Half-life ≈ 35 ticks — the value reflects traffic over the last
// few seconds of game time, not lifetime accumulation.
//   Sustained 1-pair trade:    eq ≈ 0.04 / 0.02 = 2
//   Sustained 5-pair trunk:    eq ≈ 10
//   Heavy 30-pair arterial:    eq ≈ 60
const FLOW_DECAY          = 0.02;       // per-tick multiplicative decay (half-life ~35 ticks)
const FLOW_FOR_PAVE       = 5;          // sustained flow that fully drives quality progression
const FLOW_FOR_BUSY       = 50;         // sustained flow that saturates the busy-road bonus
// Quality improves toward QUALITY_MAX at this rate per tick when
// flow ≥ FLOW_FOR_PAVE; proportionally slower when flow is lower.
// At flow=FLOW_FOR_PAVE sustained, takes ~5000 ticks to fully pave
// — matches the historical wear curve.
const PAVE_RATE           = (QUALITY_NEW - QUALITY_MAX) / 5000;

// Road abandonment. A road carrying essentially no traffic
// (flow < ROAD_ABANDON_FLOW — below even a single sustained trade
// pair, whose equilibrium flow is ~2) is no longer maintained and
// its surface decays back toward bare terrain (quality → 1.0) at
// ROAD_DECAY_RATE per tick (~5000 ticks to fully revert). Once it
// crosses ROAD_GONE it's dropped from the road set entirely, so
// Dijkstra / network-component passes stop walking it and the
// network shrinks instead of accreting dead trunks forever. This
// both restores realism (unmaintained roads crumble) and bounds the
// road-tile count that every routing pass has to traverse.
const ROAD_ABANDON_FLOW   = 0.2;
const ROAD_DECAY_RATE     = (1.0 - QUALITY_NEW) / 5000;
const ROAD_GONE           = 0.999;
// Flow below this is treated as zero (tile drops out of the active
// flow set so the per-tick decay sweep stays proportional to live
// traffic, not world size).
const FLOW_EPS            = 0.001;

// Partner-distance reach scales with the BUILDER's population: a
// 60-pop hamlet can only see ~28 tiles; a 5000-pop city sees ~90;
// a 16000-pop metropolis sees ~140. Stops small villages from
// reaching out across the whole map to a distant rich neighbour.
const PARTNER_DIST_BASE   = 20;
const PARTNER_DIST_PER    = 1.0;        // tiles per sqrt(pop)
function partnerReachFor(s) {
  return PARTNER_DIST_BASE + Math.sqrt(Math.max(0, s.people || 0)) * PARTNER_DIST_PER;
}

// New roads need a margin of improvement to justify the effort.
// Lower bar to bridge disconnected components; medium bar for
// shortcuts WITHIN a network — a direct line through the
// countryside should still be possible if it saves enough cost
// (medieval trunk roads were often more direct than the village
// paths they replaced).
const NEW_FRACTION_OUT    = 0.35;       // peer in different component: low bar
const NEW_FRACTION_IN     = 0.55;       // peer in same component: moderate novelty
const SHORTCUT_GAIN_RATIO = 0.85;       // new direct path must save ≥ 15% vs network path

// Close-neighbour rule: any settled pair within this many tiles
// of each other gets a direct path painted by the local-link
// pass — separate from economic road planning. Models the
// ever-present village foot traffic (kin visits, shared grazing,
// market days, parish boundaries) which produces paths between
// neighbours whether or not they have anything to trade. Without
// this, two hamlets 22 tiles apart get routed 80 tiles round a
// worn trunk because the worn arterial is "cheaper" than a fresh
// terrain crossing. Threshold sits just above MIN_SETT_DIST (12)
// so the closest possible pairs always qualify.
const CLOSE_NEIGHBOUR_DIST    = 20;
const CLOSE_NEIGHBOUR_DIST_SQ = CLOSE_NEIGHBOUR_DIST * CLOSE_NEIGHBOUR_DIST;
const MIN_POP_TO_LINK         = 30;     // lower bar than road planning

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
const USAGE_PER_TRADE              = 0.04;   // flow added per tile per active trade tick
const MONEY_FLOW_EPS               = 0.01;   // min net /tick for a link to register in the money-flow overlay

// Tolls — when trade between A and B passes through a third
// settlement C's home tile, C skims a cut of the trade value.
// Buyer pays the toll on top of the trade price; seller's revenue
// is unchanged; intermediate's wealth rises. Models bridge tolls,
// market dues, inn-keeping, supply sales to caravans, taxes on
// through-traffic — the historical mechanism that made
// crossroads/post towns viable as economic entities (Lyon,
// Frankfurt, every English market town on a Roman road).
// Food trade has a lower rate: famine-era food tolls were
// politically charged, and a 5% toll on grain to a starving city
// would be unconscionable.
const TOLL_RATE       = 0.05;
const FOOD_TOLL_RATE  = 0.02;

export { QUALITY_NEW, QUALITY_MAX, FLOW_FOR_PAVE, FLOW_FOR_BUSY };

// ── State init ─────────────────────────────────────────────────────
function ensureRoadArrays(world) {
  if (!world.roadQuality || world.roadQuality.length !== world.N) {
    world.roadQuality = new Float32Array(world.N).fill(1.0);
    world._roadTiles = new Set();
  }
  if (!world.roadFlow || world.roadFlow.length !== world.N) {
    world.roadFlow = new Float32Array(world.N);
    world._flowTiles = new Set();
  }
  // Sparse indices: tiles that are roads (quality < 1.0) and tiles that
  // currently carry flow. The per-tick decay / paving sweeps iterate
  // these instead of all N tiles, so their cost scales with the live
  // network (hundreds of tiles) rather than the whole map (N ~ 460k in
  // the real sim). Rebuild from roadQuality if it exists but the index
  // doesn't (e.g. after a state load that set the array directly).
  if (!world._roadTiles) {
    world._roadTiles = new Set();
    const rq = world.roadQuality;
    for (let ti = 0; ti < rq.length; ti++) if (rq[ti] < 1.0) world._roadTiles.add(ti);
  }
  if (!world._flowTiles) world._flowTiles = new Set();
}

// Paint a single tile as a fresh road, keeping the sparse road-tile
// index in sync. Takes min so an existing worn road isn't downgraded.
// Returns true if the tile actually changed.
function paintRoad(world, ti) {
  if (QUALITY_NEW < world.roadQuality[ti]) {
    world.roadQuality[ti] = QUALITY_NEW;
    world._roadTiles.add(ti);
    return true;
  }
  return false;
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
    let head = 0;                       // index-based dequeue (q.shift is O(n))
    visited[start] = 1;
    tileComp.set(start, root);
    while (head < q.length) {
      const ti = q[head++];
      const peer = stMap.get(ti);
      if (peer && peer.id !== s.id) out.set(peer.id, root);
      const ty = (ti / tw) | 0, tx = ti - ty * tw;
      const xm = tx === 0      ? tw - 1 : tx - 1;
      const xp = tx === tw - 1 ? 0      : tx + 1;
      const yu = ty - 1, yd = ty + 1;
      // 8-neighbours: diagonally-adjacent road tiles are part of
      // the same network (the road tiles meet at a corner and a
      // foot or cart can transit between them).
      const ns = [
        ty * tw + xm,
        ty * tw + xp,
        yu >= 0 ? yu * tw + tx : -1,
        yd < th ? yd * tw + tx : -1,
        yu >= 0 ? yu * tw + xm : -1,
        yu >= 0 ? yu * tw + xp : -1,
        yd < th ? yd * tw + xm : -1,
        yd < th ? yd * tw + xp : -1,
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
    // Expand to 8-neighbours that are roads or settlement tiles.
    // Diagonal step cost is multiplied by √2 to match the real
    // geometric distance traversed.
    const ty = (ti / tw) | 0, tx = ti - ty * tw;
    const xm = tx === 0      ? tw - 1 : tx - 1;
    const xp = tx === tw - 1 ? 0      : tx + 1;
    const yu = ty - 1, yd = ty + 1;
    const ns = [
      ty * tw + xm,
      ty * tw + xp,
      yu >= 0 ? yu * tw + tx : -1,
      yd < th ? yd * tw + tx : -1,
      yu >= 0 ? yu * tw + xm : -1,
      yu >= 0 ? yu * tw + xp : -1,
      yd < th ? yd * tw + xm : -1,
      yd < th ? yd * tw + xp : -1,
    ];
    const mul = [1, 1, 1, 1, SQRT2, SQRT2, SQRT2, SQRT2];
    for (let k = 0; k < 8; k++) {
      const ni = ns[k];
      if (ni < 0) continue;
      const isRoad = rq[ni] < 1.0;
      const isSett = stMap.has(ni);
      if (!isRoad && !isSett) continue;
      // Cost: use the road tile's quality (or a small settlement-
      // transit cost for non-road settlement tiles).
      const stepCost = (isRoad ? rq[ni] : 0.15) * mul[k];
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
      // Refresh ONLY the network components after each build — that's
      // a cheap BFS and keeps the cross-component / junction-truncation
      // decisions of later candidates correct. The expensive per-
      // settlement trade-reach Dijkstra is NOT rebuilt here (it was the
      // dominant cost of a plan tick — O(builds × settlements × reach));
      // it's deferred to a single rebuild at the end of the cycle.
      // Within-cycle reach is therefore slightly stale, which at worst
      // adds a redundant shortcut the next cycle's fresh reach prunes.
      world._networkComponents = buildNetworkComponents(world);
    }
  }
  // Local-link pass: ensure close-neighbour pairs have a direct
  // path. Runs AFTER economic road planning so trunk lines win
  // the planner's attention first; this pass only fills in the
  // missing village-to-village links.
  if (maybeBuildLocalLinks(world)) anyBuilt = true;
  // Single trade-reach rebuild for the whole cycle.
  if (anyBuilt) {
    rebuildTradeReach(world);
    world._networkComponents = buildNetworkComponents(world);
  }
  return anyBuilt;
}

// Paint direct paths between close-neighbour pairs that don't
// already have one. No economic gate — proximity is the only
// criterion. Each pair processed once via id ordering. A pair
// "already has a direct path" if every tile of the shortest
// route is already a road (newFrac === 0).
function maybeBuildLocalLinks(world) {
  const candidates = world.settlements.filter(
    s => s.mode === "settled" && s.people >= MIN_POP_TO_LINK
  );
  let anyBuilt = false;
  for (const s of candidates) {
    for (const peer of candidates) {
      if (peer.id <= s.id) continue;            // each pair once
      let dx = Math.abs(peer.pos.x - s.pos.x);
      if (dx > world.tw / 2) dx = world.tw - dx;
      const dy = peer.pos.y - s.pos.y;
      if (dx * dx + dy * dy > CLOSE_NEIGHBOUR_DIST_SQ) continue;
      const path = findPath(world, s, peer);
      if (!path) continue;
      let didChange = false;
      for (const ti of path.tiles) {
        if (paintRoad(world, ti)) didChange = true;
      }
      if (didChange) {
        anyBuilt = true;
        if (s.history) s.history.push({
          step: world.step, type: "local-link",
          to: peer.id, tiles: path.tiles.length,
        });
      }
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

  const reach = partnerReachFor(s);
  const reachSq = reach * reach;

  // ── Pass 1: rank in-reach peers by trade benefit, WITHOUT pathing ──
  // findPath is a full terrain Dijkstra (the expensive primitive); doing
  // it for every in-reach peer was the dominant cost of a plan tick.
  // Score peers cheaply on benefit first, then only path the most
  // promising few.
  const ranked = [];
  for (const peer of world.settlements) {
    if (peer.mode !== "settled" || peer.id === s.id) continue;
    let dx = Math.abs(peer.pos.x - s.pos.x);
    if (dx > world.tw / 2) dx = world.tw - dx;
    const dy = peer.pos.y - s.pos.y;
    const peerDistSq = dx * dx + dy * dy;
    if (peerDistSq > reachSq) continue;

    const peerRes = peer.localRes || {};
    let resGain = 0;
    for (const n of missing) {
      if ((peerRes[n] || 0) >= HAVE_THRESHOLD) resGain += 1;
    }
    const peerExport = computeExportValue(peer);
    const exGap = Math.abs(sExport - peerExport);
    const peerFood = (peer._foodSupply || 0) - (peer._foodDemand || 0);
    let foodGain = 0;
    if ((sFood < -0.01 && peerFood > 0.01) ||
        (sFood > 0.01 && peerFood < -0.01)) {
      foodGain = Math.min(Math.abs(sFood), Math.abs(peerFood));
    }
    const benefit = resGain * 2 + exGap + foodGain * 10;
    ranked.push({ peer, benefit, distSq: peerDistSq });
  }
  // Best benefit first; ties broken toward the nearer (cheaper) peer.
  ranked.sort((p, q) => (q.benefit - p.benefit) || (p.distSq - q.distSq));

  // ── Pass 2: path only the top candidates, pick the best buildable ──
  // Two budgets: bridges to unconnected peers (the valuable builds) get
  // most of it; shortcut probes against already-connected peers get a
  // tight cap so a stable network doesn't re-path every peer every cycle.
  const rq = world.roadQuality;
  let bestPartner = null, bestScore = -Infinity, bestPath = null, bestNewFrac = 0;
  let newEvals = 0, shortcutEvals = 0;
  for (const cand of ranked) {
    if (newEvals >= MAX_NEW_EVALS && shortcutEvals >= MAX_SHORTCUT_EVALS) break;
    const peer = cand.peer;
    const connected = !!(s._tradeReach && s._tradeReach.has(peer.id));
    if (connected) {
      if (shortcutEvals >= MAX_SHORTCUT_EVALS) continue;
    } else {
      if (newEvals >= MAX_NEW_EVALS) continue;
    }
    const path = findPath(world, s, peer);
    if (connected) shortcutEvals++; else newEvals++;   // count cost even if null
    if (!path) continue;

    // New-tile fraction: how much of the path is NOT yet on a
    // road. Lower bar to bridge disconnected clusters; higher
    // bar to add a shortcut within an existing network.
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

    // Wealth eagerness: only the BUILDER's own coffers matter. A
    // poor hamlet can't be lured into an over-ambitious road just
    // because a distant peer is rich — they have to fund it
    // themselves (in road labour, not money, but the principle
    // stands: poor settlements build modestly).
    const wealthEagerness = Math.min(2.0, 1 + Math.log10(Math.max(1, s.wealth || 0)) / 6);
    const score = cand.benefit / Math.max(1, path.cost)
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
  // an existing worn road). If nothing actually changed (path is
  // entirely on existing roads), report no build — otherwise we
  // re-run reach + components every cycle on a stable network.
  let didChange = false;
  for (const ti of physicalTiles) {
    if (paintRoad(world, ti)) didChange = true;
  }
  if (!didChange) return false;
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
// add to the path tiles' roadFlow.
export function updateTrade(world) {
  ensureRoadArrays(world);
  // Food import EMA decay (per-settlement) runs every tick.
  for (const s of world.settlements) {
    if (s.mode === "settled") {
      s._foodImportRate = (s._foodImportRate || 0) * (1 - FOOD_IMPORT_EMA_ALPHA);
    }
  }
  // Decay current flow over the active-flow set only (proportional to
  // live traffic, not world size). Done BEFORE this tick's trade
  // contributions so trades land on a freshly-decayed field and the
  // equilibrium is well-defined. Tiles whose flow falls below FLOW_EPS
  // drop out of the set.
  const rf = world.roadFlow;
  const flowTiles = world._flowTiles;
  if (rf && flowTiles) {
    const keep = 1 - FLOW_DECAY;
    for (const ti of flowTiles) {
      const v = rf[ti] * keep;
      if (v < FLOW_EPS) { rf[ti] = 0; flowTiles.delete(ti); }
      else rf[ti] = v;
    }
  }
  // Settlement tile lookup, shared across all trade pairs this tick
  // so the toll computation in runFood/GeneralTradeBetween can
  // identify intermediate settlements on each path in O(pathLen).
  const stMap = buildSettlementTileMap(world);
  // Iterate settlements, then pair with their reach. Also snapshot, per
  // actively-trading pair, the NET money that reached the peer this tick
  // and along which tiles — consumed by the money-flow overlay to animate
  // flow direction. Rebuilt fresh each tick (no staleness across the
  // 240-tick reach rebuilds).
  const moneyFlows = [];
  const linkMoney = new Map();   // "loId:hiId" -> net money that reached the higher-id settlement
  for (const s of world.settlements) {
    if (s.mode !== "settled") continue;
    // Trade peers = the road network reach PLUS any sea-lane peers
    // (sea.js). Where both exist for a peer, take the cheaper link.
    const reach = mergeReach(s);
    if (!reach) continue;
    for (const [peerId, link] of reach) {
      if (peerId <= s.id) continue;   // process each pair once
      const peer = findById(world, peerId);
      if (!peer || peer.mode !== "settled") continue;
      const peerBefore = peer.wealth || 0;
      runFoodTradeBetween(world, s, peer, link, stMap);
      runGeneralTradeBetween(world, s, peer, link, stMap);
      const net = (peer.wealth || 0) - peerBefore;   // +ve = money toward peer (higher id, end of tiles)
      linkMoney.set(s.id + ":" + peerId, net);
      // Land trade wears its road path (flow drives paving + thickness);
      // sea trade leaves no road, but both animate on the money overlay.
      if (link.tiles && link.tiles.length > 0) {
        if (!link.sea) { for (const ti of link.tiles) { rf[ti] += USAGE_PER_TRADE; flowTiles.add(ti); } }
        if (link.tiles.length > 1 && Math.abs(net) > MONEY_FLOW_EPS) {
          moneyFlows.push({ tiles: link.tiles, mag: Math.abs(net), toEnd: net >= 0, sea: !!link.sea });
        }
      }
    }
  }
  world._moneyFlows = moneyFlows;
  world._linkMoney = linkMoney;
  // Quality evolution over the road set only:
  //   • busy tiles (flow ≥ ROAD_ABANDON_FLOW) pave further toward
  //     QUALITY_MAX, faster the higher the flow (capped at FLOW_FOR_PAVE,
  //     ~5000 ticks to fully pave).
  //   • abandoned tiles (flow below that floor) revert toward bare
  //     terrain and, once past ROAD_GONE, leave the road set so routing
  //     and component passes stop treating them as roads.
  const rq = world.roadQuality;
  const roadTiles = world._roadTiles;
  if (rq && rf && roadTiles) {
    const gone = [];
    for (const ti of roadTiles) {
      const flow = rf[ti] || 0;
      if (flow >= ROAD_ABANDON_FLOW) {
        const t = Math.min(1, flow / FLOW_FOR_PAVE);
        const next = rq[ti] - t * PAVE_RATE;
        if (next < rq[ti]) rq[ti] = next < QUALITY_MAX ? QUALITY_MAX : next;
      } else {
        const next = rq[ti] + ROAD_DECAY_RATE;
        if (next >= ROAD_GONE) { rq[ti] = 1.0; gone.push(ti); }
        else rq[ti] = next;
      }
    }
    for (const ti of gone) roadTiles.delete(ti);
  }
}

// Walk the path's tiles, collect each settlement whose home tile
// sits on the route (other than endpoints). De-duplicates so a
// settlement that owns several adjacent tiles still only tolls
// once per trade.
function intermediatesOnPath(link, aId, bId, stMap) {
  if (!link.tiles || link.tiles.length === 0) return null;
  let out = null;
  let seen = null;
  for (const ti of link.tiles) {
    const sett = stMap.get(ti);
    if (!sett || sett.id === aId || sett.id === bId) continue;
    if (!seen) { seen = new Set(); out = []; }
    if (seen.has(sett.id)) continue;
    seen.add(sett.id);
    out.push(sett);
  }
  return out;
}

// Per-tick food a settlement could ship out. Only STORABLE food (grain +
// forage) travels — fresh fish is perishable and stays local — so the
// exportable surplus is the total surplus capped by storable production.
// A fishing town that's fed mostly by the sea therefore can't become a
// food exporter; only grain breadbaskets feed distant cities.
function foodSurplus(s) {
  const total = (s._foodSupply || 0) - (s._foodDemand || 0);
  if (total <= 0) return total;
  return Math.min(total, s._storableSupply || 0);
}
// Per-tick food a settlement wants shipped IN: enough to feed the
// population its HOUSING could hold beyond what it has now. This is what
// lets a food-limited but development-rich city pull grain and grow past
// its own land — at pop = foodK it has no starvation deficit, but it
// still has housing headroom to fill.
function foodAppetite(s) {
  const headroom = (s._houseK || 0) - s.people;
  if (headroom <= 0) return 0;
  return headroom * 0.003 * (s._urbanFactor || 1);
}
function runFoodTradeBetween(world, a, b, link, stMap) {
  const aSurplus = foodSurplus(a), bSurplus = foodSurplus(b);
  const aWant = foodAppetite(a), bWant = foodAppetite(b);
  let exporter, importer, shipRate, deficit;
  if (aSurplus > 0.001 && bWant > 0.001) {
    exporter = a; importer = b; shipRate = aSurplus; deficit = bWant;
  } else if (bSurplus > 0.001 && aWant > 0.001) {
    exporter = b; importer = a; shipRate = bSurplus; deficit = aWant;
  } else return;
  // Growth-reserve fraction for exporter (feed own children first).
  const exporterK = exporter._k || Math.max(1, exporter.people);
  const headroom = Math.max(0, 1 - exporter.people / exporterK);
  const reserveFraction = 0.20 + headroom * 0.50;
  const effectiveShipRate = shipRate * (1 - reserveFraction);
  // Ship the ongoing production surplus, bounded by the importer's
  // deficit. effectiveShipRate was just added to the granary this tick so
  // this can't drive food negative; the stored-food term is only a floor
  // against transient dips. (The old food×0.01 cap throttled exports to a
  // trickle, which is what made import-fed cities impossible.)
  const maxFlow = Math.min(effectiveShipRate, deficit, Math.max(0, exporter.food || 0));
  if (maxFlow <= 0) return;

  // ── The grain moves by BARTER — always. Survival and growth don't wait
  // for coin; the importer gives goods in return (untracked). This is the
  // default exchange and is what keeps a money-less settlement (or a whole
  // pre-money world) fed.
  importer.food = (importer.food || 0) + maxFlow;
  exporter.food = (exporter.food || 0) - maxFlow;
  importer._foodImportRate = (importer._foodImportRate || 0) + maxFlow * FOOD_IMPORT_EMA_ALPHA;

  // ── If the importer holds coin (above its reserve) money REPLACES
  // barter for as much of the grain as it can pay for: coin flows
  // importer → exporter, tolls to any middlemen. A broke importer simply
  // barters (no coin moves). This is how money supplants barter once it
  // reaches a settlement.
  const wantPrice = maxFlow * FOOD_PRICE;
  const transport = link.cost * FOOD_TRANSPORT_PER_PATHCOST;
  const intermediates = intermediatesOnPath(link, a.id, b.id, stMap);
  const numInter = intermediates ? intermediates.length : 0;
  const totalToll = wantPrice * FOOD_TOLL_RATE * numInter;
  const totalCost = wantPrice + transport + totalToll;
  const importerDemand = importer._foodDemand || 0.001;
  const isStarving = (importer.food || 0) / importerDemand < STARVING_TICKS_LEFT;
  const reserve = isStarving ? 0 : getWealthReserve(importer);
  const available = Math.max(0, (importer.wealth || 0) - reserve);
  if (available <= 0) return;            // no coin — pure barter, done
  const pay = available < totalCost ? available : totalCost;
  const scale = pay / totalCost;
  importer.wealth -= pay;
  exporter.wealth = (exporter.wealth || 0) + wantPrice * scale;
  if (intermediates) {
    const tollPer = wantPrice * FOOD_TOLL_RATE * scale;
    for (const inter of intermediates) inter.wealth = (inter.wealth || 0) + tollPer;
  }
}

// Bilateral trade: each settlement sells its OWN goods to the other and
// pays for what it buys. Money flows BOTH directions, so a settlement
// earns by selling what it makes (never credited for nothing), and even
// a cash-poor, low-export town keeps earning instead of draining to its
// reserve and freezing — that's the velocity that keeps money moving.
// Net wealth still drifts toward the higher-export partner, but only by
// the difference, while the gross flow circulates.
function runGeneralTradeBetween(world, a, b, link, stMap) {
  const minPop = Math.min(a.people, b.people);
  const vol = Math.sqrt(minPop) * TRADE_RATE;
  const transport = link.cost * TRANSPORT_PER_PATHCOST;
  const intermediates = intermediatesOnPath(link, a.id, b.id, stMap);
  const numInter = intermediates ? intermediates.length : 0;
  // A's goods sold to B (B pays A), then B's goods sold to A (A pays B).
  // Freight is split across the two legs of the round trip.
  sellGoods(a, b, computeExportValue(a) * vol, transport * 0.5, intermediates, numInter);
  sellGoods(b, a, computeExportValue(b) * vol, transport * 0.5, intermediates, numInter);
}

// One leg: `seller` ships `goodsValue` of goods to `buyer`; buyer pays
// from wealth above its reserve, with freight consumed en route and a
// toll skimmed by each intermediate settlement on the road.
function sellGoods(seller, buyer, goodsValue, freight, intermediates, numInter) {
  if (goodsValue <= 0) return;
  const totalToll = goodsValue * TOLL_RATE * numInter;
  // Don't ship goods worth less than the freight + tolls to move them.
  if (goodsValue <= freight + totalToll) return;
  const want = goodsValue + freight + totalToll;
  const reserve = getWealthReserve(buyer);
  const available = Math.max(0, (buyer.wealth || 0) - reserve);
  if (available <= 0) return;
  const actual = available < want ? available : want;
  const scale = actual / want;
  buyer.wealth -= actual;
  seller.wealth = (seller.wealth || 0) + goodsValue * scale;
  if (intermediates) {
    const tollPer = goodsValue * TOLL_RATE * scale;
    for (const inter of intermediates) inter.wealth = (inter.wealth || 0) + tollPer;
  }
  // Conservation: buyer loses `actual` = goodsValue*scale (to seller)
  // + totalToll*scale (to intermediates) + freight*scale (consumed).
}

// ── Helpers ────────────────────────────────────────────────────────
// Combined trade reach for a settlement: its road-network peers plus any
// sea-lane peers (sea.js, on s._seaReach). Returns the road map directly
// when there's no sea reach (the common case — only ports sail), so we
// only allocate a merged map for actual ports.
function mergeReach(s) {
  const road = s._tradeReach, sea = s._seaReach;
  if (!sea || sea.size === 0) return road;
  if (!road || road.size === 0) return sea;
  const m = new Map(road);
  for (const [pid, link] of sea) {
    const ex = m.get(pid);
    if (!ex || link.cost < ex.cost) m.set(pid, link);
  }
  return m;
}

// O(1) id lookup via the per-tick map built in stepPeopleSim. Falls
// back to building it on demand (e.g. when called from the UI between
// ticks).
function findById(world, id) {
  if (!world._byId) {
    world._byId = new Map();
    for (const s of world.settlements) world._byId.set(s.id, s);
  }
  return world._byId.get(id) || null;
}

// Bounded Dijkstra from s to t (full terrain Dijkstra including
// the road-override discount in baseEdgeCost). Used by road
// planning to decide if a new road segment between two settlements
// is worth painting. Uses 8-neighbour movement so paths can run
// diagonally rather than stairstepping over open ground.
const SQRT2 = Math.SQRT2;
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
  const limit = 40000;
  let visited = 0;
  while (heap.n > 0) {
    if (visited++ > limit) return null;
    const { ti, d } = heap.popMin();
    if (d > (dist.get(ti) ?? Infinity)) continue;
    if (ti === goal) break;
    const ty = (ti / tw) | 0, tx = ti - ty * tw;
    const xm = tx === 0      ? tw - 1 : tx - 1;
    const xp = tx === tw - 1 ? 0      : tx + 1;
    const yu = ty - 1, yd = ty + 1;
    const ns = [
      ty * tw + xm,                          // W
      ty * tw + xp,                          // E
      yu >= 0 ? yu * tw + tx : -1,           // N
      yd < th ? yd * tw + tx : -1,           // S
      yu >= 0 ? yu * tw + xm : -1,           // NW
      yu >= 0 ? yu * tw + xp : -1,           // NE
      yd < th ? yd * tw + xm : -1,           // SW
      yd < th ? yd * tw + xp : -1,           // SE
    ];
    const mul = [1, 1, 1, 1, SQRT2, SQRT2, SQRT2, SQRT2];
    for (let k = 0; k < 8; k++) {
      const ni = ns[k];
      if (ni < 0) continue;
      const c = localEdgeCost(world, ti, ni, s.knowledge);
      if (c === Infinity) continue;
      const nd = d + c * mul[k];
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

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
import { forEachNear } from "./spatialGrid.js";
import { T } from "./tuning.js";
import { exportValueOf, getWealthReserve } from "./settlement.js";
import { localP } from "./inflation.js";
import { govOf } from "./conquest.js";
import { commerceMul } from "./personality.js";
import { recordIn, recordOut, IN_GOODS, IN_FOOD, IN_TOLLS, IN_LUXURY, OUT_GOODS, OUT_FOOD, OUT_TOLLS, OUT_TARIFFS, OUT_LUXURY } from "./money.js";

// ── Constants ──────────────────────────────────────────────────────
const QUALITY_NEW         = 0.25;       // new road: 4× cheaper than plain
const QUALITY_MAX         = 0.08;       // worn arterial: 12× cheaper
const PLAN_INTERVAL       = 240;        // ticks between road-planning attempts
const MIN_POP_TO_PLAN     = 60;
const MAX_REACH_VISITS    = 8000;       // BFS visit cap for trade-reach computation
// Each settlement trades only with its NEAREST few road-connected peers.
// Without this, a settlement in a large connected landmass reaches almost
// every other settlement, so the trade pass (and the per-tick reach loops)
// degrade to O(settlements²) — that quadratic blow-up is what makes the sim
// start fast and then rapidly bog down as the network fuses. Capping reach
// keeps trade O(settlements × MAX_PARTNERS), and lets the Dijkstra stop as
// soon as it has found this many peers (they come out nearest-first), which
// also slashes the periodic reach-rebuild cost. Distant partners contributed
// almost nothing anyway — transport cost already throttled their volume to a
// trickle — so this is the single biggest lever on the per-tick trade cost
// (updateTrade, knowledge diffusion, and urbanise all iterate the reach):
// 12 nearest partners is still a dense, well-connected local economy, but
// ~40% cheaper per tick than 20 once the dense map's networks fuse.
const MAX_PARTNERS        = 12;
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
const MAX_NEW_EVALS       = 2;
const MAX_SHORTCUT_EVALS  = 1;

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

// Partner-distance reach scales with the BUILDER's population AND its
// transport technology: a 60-pop hamlet can only see ~28 tiles at stone-
// age tech; the same hamlet with horses+ships+roads can see ~50. A
// 5000-pop city sees ~90 base → ~160 maxed. A 16000-pop metropolis sees
// ~140 base → ~250 maxed. Stops small villages from reaching across the
// world while letting tech-advanced civs build genuine trade empires
// (the historical pattern — the Hanseatic League's reach was about
// shipping tech, not just city size).
const PARTNER_DIST_BASE   = 20;
const PARTNER_DIST_PER    = 1.0;        // tiles per sqrt(pop)
function partnerReachFor(s) {
  const k = s.knowledge || {};
  // Mobility (horses, wagons) and navigation (ships) both expand commercial
  // horizon. Cap the multiplier at ~1.8× so even a maxed-tech metropolis
  // can't reach across an entire continent in one trade pair.
  const techMul = 1 + 0.5 * (k.mobility || 0) + 0.3 * (k.navigation || 0);
  return (PARTNER_DIST_BASE + Math.sqrt(Math.max(0, s.people || 0)) * PARTNER_DIST_PER) * techMul;
}

// New roads need a margin of improvement to justify the effort.
// Lower bar to bridge disconnected components; medium bar for
// shortcuts WITHIN a network — a direct line through the
// countryside should still be possible if it saves enough cost
// (medieval trunk roads were often more direct than the village
// paths they replaced).
const NEW_FRACTION_OUT    = 0.35 / 1.2; // peer in different component: low bar
const NEW_FRACTION_IN     = 0.55 / 1.2; // peer in same component: moderate novelty
                                        // (both ÷1.2 re-anchor the 0.5-pivot commerceMul,
                                        // which divides these; behaviour identical)
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
const CLOSE_NEIGHBOUR_DIST    = 20;     // grid near-query radius for local links
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
// TRADE_RATE -> runtime lever (tuning.js T.TRADE_RATE)
// Wealth-scaled demand: a settlement holding coin above its reserve imports
// MORE (its buying power, not just its headcount, drives consumption). This is
// what stops a windfall (mining, state pay, a tax hoard) from sitting idle —
// a rich node relays it onward by buying more from its neighbours. Capped so
// it lubricates circulation without exploding trade volume.
const DEMAND_WEALTH_REF            = 4000;   // spare wealth that adds +1× import demand
const DEMAND_WEALTH_CAP            = 8;      // a very rich buyer imports up to (1+cap)× as much
const TRANSPORT_PER_PATHCOST       = 0.012;
const FOOD_PRICE                   = 5;
const FOOD_TRANSPORT_PER_PATHCOST  = 0.005;
const STARVING_TICKS_LEFT          = 100;
const FOOD_IMPORT_EMA_ALPHA        = 0.02;    // import-fed food capacity tracks delivered grain in ~50 ticks, not ~500 — lets a city grow on grain it's actually receiving instead of lagging centuries behind
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
// Cross-border customs: when goods are sold INTO a different country, that
// country's state (its capital) levies an import duty on top of the price.
// It raises the cost of foreign trade — so commerce within one realm is
// cheaper and empires act as trade blocs — and hands the crown a customs
// income, making a conquered trade hub genuinely worth holding. Conserved:
// the duty the buyer pays goes to the importing country's capital. Food is
// exempt (famine relief shouldn't be taxed).
// TARIFF_RATE -> runtime lever (tuning.js T.TARIFF_RATE)

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
  // Don't paint roads on water tiles — navigation lets findPath route across
  // water (for marching armies), but the road network is land-only.
  if (world.elev && world.elev[ti] <= 0) return false;
  if (QUALITY_NEW < world.roadQuality[ti]) {
    world.roadQuality[ti] = QUALITY_NEW;
    world._roadTiles.add(ti);
    world._roadVersion = (world._roadVersion || 0) + 1;   // topology changed
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
// and ALSO populates world._tileComp (Int32Array tile → rootId, stamped)
// used by tryAddRoad's junction-truncation.
export function buildNetworkComponents(world) {
  const out = new Map();
  const { tw, th, roadQuality: rq, N } = world;
  if (!rq) return out;
  // Typed-array scratch with a per-build stamp (no Map overhead, no O(N)
  // allocation each call): tileComp[ti] holds the component root, valid only
  // where seen[ti] === stamp. This BFS fires on build / topology-change ticks,
  // so the old Map version was a frame spike on a large network.
  if (!world._tileComp || world._tileComp.length !== N) {
    world._tileComp = new Int32Array(N);
    world._tileCompSeen = new Int32Array(N);
    world._compQueue = new Int32Array(N);
    world._tileCompStamp = 0;
  }
  const tileComp = world._tileComp, seen = world._tileCompSeen, q = world._compQueue;
  if (world._tileCompStamp >= 2147483646) { seen.fill(0); world._tileCompStamp = 0; }
  const stamp = ++world._tileCompStamp;
  world._tileCompStampVal = stamp;
  const stMap = buildSettlementTileMap(world);
  for (const s of world.settlements) {
    if (s.mode !== "settled" || out.has(s.id)) continue;
    const start = (s.pos.y | 0) * tw + (s.pos.x | 0);
    out.set(s.id, s.id);
    if (seen[start] === stamp) continue;
    const root = s.id;
    let head = 0, tail = 0;
    q[tail++] = start; seen[start] = stamp; tileComp[start] = root;
    while (head < tail) {
      const ti = q[head++];
      const peer = stMap.get(ti);
      if (peer && peer.id !== s.id) out.set(peer.id, root);
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
      for (let k = 0; k < 8; k++) {
        const ni = ns[k];
        if (ni < 0 || seen[ni] === stamp) continue;
        if (rq[ni] >= 1.0 && !stMap.has(ni)) continue;   // not a road / settlement tile
        seen[ni] = stamp; tileComp[ni] = root; q[tail++] = ni;
      }
    }
  }
  return out;
}

// ── Trade-reach: per-settlement Dijkstra through road network ──

function computeReach(world, s, stMap) {
  const reach = new Map();
  const { tw, th, roadQuality: rq, N } = world;
  const startTi = (s.pos.y | 0) * tw + (s.pos.x | 0);
  // Typed-array Dijkstra scratch (shared across settlements; a per-call stamp
  // means no Map overhead and no O(N) clear). This pass runs once per
  // settlement on every reach rebuild, so the Map version was a big spike.
  if (!world._reachDist || world._reachDist.length !== N) {
    world._reachDist = new Float64Array(N);
    world._reachSeen = new Int32Array(N);
    world._reachPrev = new Int32Array(N);
    world._reachStamp = 0;
  }
  const dist = world._reachDist, seen = world._reachSeen, prev = world._reachPrev;
  if (world._reachStamp >= 2147483646) { seen.fill(0); world._reachStamp = 0; }
  const stamp = ++world._reachStamp;
  const heap = new MinHeap();
  dist[startTi] = 0; seen[startTi] = stamp; prev[startTi] = -1;
  heap.push(startTi, 0);
  let visited = 0;
  while (heap.n > 0 && visited++ < MAX_REACH_VISITS) {
    const { ti, d } = heap.popMin();
    if (d > dist[ti]) continue;                 // stale heap entry
    const peer = stMap.get(ti);
    if (peer && peer.id !== s.id && !reach.has(peer.id)) {
      const tiles = [];
      let cur = ti;
      while (cur !== -1) { tiles.push(cur); if (cur === startTi) break; cur = prev[cur]; }
      tiles.reverse();
      const link = { cost: d, tiles };
      link.inter = intermediatesOnPath(link, s.id, peer.id, stMap);
      reach.set(peer.id, link);
      if (reach.size >= MAX_PARTNERS) break;     // nearest-first; we have enough
    }
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
      if (!isRoad && !stMap.has(ni)) continue;
      const nd = d + (isRoad ? rq[ni] : 0.15) * mul[k];
      if (seen[ni] !== stamp || nd < dist[ni]) {
        dist[ni] = nd; seen[ni] = stamp; prev[ni] = ti;
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
// A full plan cycle (evaluate every settlement for new roads + a local-link
// pass + reach rebuilds) is hundreds of pathfinds — doing it all on one tick
// caused a periodic multi-hundred-ms FREEZE that grew with the map, the main
// cause of "starts fast, then rapidly slows". Instead the cycle is now SPREAD
// across PLAN_SPREAD ticks: a snapshot is taken each PLAN_INTERVAL, then a
// small slice of candidates is evaluated per tick, so the same total work is
// amortised into smooth per-tick cost with no stutter.
const PLAN_SPREAD = 120;   // ticks to spread one plan cycle over (< PLAN_INTERVAL)

// Network COMPONENTS only need rebuilding when the topology changed (a road
// was built / decayed, or the settlement set changed). In a settled world
// neither happens for long stretches, so this skips the BFS on most cycles.
// (Trade reach is refreshed separately and continuously — see staggerReach.)
function refreshComponentsIfStale(world) {
  let settled = 0;
  for (const s of world.settlements) if (s.mode === "settled") settled++;
  const rv = world._roadVersion || 0;
  if (rv === world._compRoadVer && settled === world._compSettCount) return;
  world._networkComponents = buildNetworkComponents(world);
  world._compRoadVer = rv;
  world._compSettCount = settled;
}

// Trade reach is rebuilt a few settlements at a time, cycling through the whole
// population every REACH_SPREAD ticks, rather than all at once. A full rebuild
// was ~tens of ms on a large map — a frame spike at high sim speed. Reach
// drifts slowly (roads change rarely), so a settlement seeing slightly stale
// reach for a few ticks is invisible.
const REACH_SPREAD = 120;
function staggerReachRebuild(world) {
  if (!world.roadQuality) return;
  const setts = world.settlements;
  const n = setts.length;
  if (n === 0) return;
  const stMap = buildSettlementTileMap(world);
  const perTick = Math.max(1, Math.ceil(stMap.size / REACH_SPREAD));
  let cur = world._reachCursor || 0;
  let processed = 0, scanned = 0;
  while (processed < perTick && scanned < n) {
    const s = setts[cur % n];
    cur++; scanned++;
    if (s.mode === "settled") { s._tradeReach = computeReach(world, s, stMap); processed++; }
  }
  world._reachCursor = cur;
}

export function maybeBuildRoads(world) {
  ensureRoadArrays(world);
  // Continuously refresh a slice of trade reach (spread, never a spike).
  staggerReachRebuild(world);

  // Start a new cycle: refresh components (only if stale) and snapshot the
  // candidates DUE for planning. Settlements that recently built nothing back
  // off exponentially (re-checked up to 8× less often), so a stable world
  // evaluates only its new / growing settlements instead of all of them — the
  // per-candidate work (ranking + several A* pathfinds) was the bulk of the
  // plan cost. Growth (or a backoff cap) brings a settlement back into the queue.
  if (world.step % PLAN_INTERVAL === 0) {
    refreshComponentsIfStale(world);
    const snap = world.step;
    world._planSnap = snap;
    world._planQueue = world.settlements.filter(s => {
      if (s.mode !== "settled" || s.people < MIN_POP_TO_PLAN) return false;
      // A meaningful pop jump (or first-ever evaluation) makes it due now.
      if (s._planPop === undefined || s.people > s._planPop * 1.4) s._planNext = 0;
      return (s._planNext || 0) <= snap;
    });
    world._planIdx = 0;
  }

  const queue = world._planQueue;
  if (!queue) return false;

  // Evaluate a slice this tick — sized so the whole queue finishes within
  // PLAN_SPREAD ticks regardless of how many settlements there are.
  const snap = world._planSnap || world.step;
  // Exactly one settlement per tick: each tryAddRoad is several A* probes, so
  // this guarantees no single tick can spike on road planning. A big backlog
  // just takes more ticks (and the next cycle re-queues anything unprocessed)
  // — roads aren't urgent, and smoothness matters more at high sim speed.
  const end = Math.min(queue.length, world._planIdx + 1);
  let built = false;
  for (; world._planIdx < end; world._planIdx++) {
    const s = queue[world._planIdx];
    if (!s || s.mode !== "settled") continue;
    const did = tryAddRoad(world, s);
    s._planPop = s.people;
    s._planBackoff = did ? 1 : Math.min(8, (s._planBackoff || 1) * 2);
    s._planNext = snap + PLAN_INTERVAL * s._planBackoff;
    if (did) built = true;
    // Wire this settlement to any UNCONNECTED close neighbour. Done per
    // candidate (one settlement/tick) rather than as a single cycle-end pass —
    // that pass did all its pathfinds at once and was a ~90ms spike.
    if (linkCloseNeighbours(world, s)) built = true;
  }
  // One components refresh per tick if anything built (not per build — that
  // BFS-per-build was a multi-hundred-ms stall when a cycle built many roads).
  if (built) world._networkComponents = buildNetworkComponents(world);

  if (world._planIdx >= queue.length) world._planQueue = null;
  return built;
}

// Connect ONE settlement to any close neighbour that isn't already in its
// road network. Called for a single settlement per tick from the plan spread,
// so the cost (a scan for close neighbours + a bounded pathfind for each
// unconnected one) is tiny and never lumps into a cycle-end spike. Uses the
// cached network components for the "already connected?" test; slightly stale
// between rebuilds, which at worst costs a redundant (bounded) pathfind.
// Gabriel-edge test: is the segment a–b free of any other town lying "between"
// them (inside the circle that has a–b as its diameter)? By Thales that's
// |ac|² + |bc|² < |ab|² for some town c. If NO such town exists, a and b are
// direct neighbours in the realistic road mesh and deserve a direct road; if one
// sits between, the route runs a→c→b instead. (Real road networks sit at roughly
// the Gabriel graph — MST ⊂ relative-neighbourhood ⊂ Gabriel ⊂ Delaunay — not the
// bare spanning tree the bridge logic alone produces.)
function isGabrielEdge(world, a, b, dAB2) {
  const tw = world.tw;
  // A town c lies "between" a and b (inside the Thales circle on diameter AB)
  // exactly when it sits within |AB|/2 of the segment's MIDPOINT — by the
  // parallelogram law |ac|²+|bc|² = 2|mc|² + |AB|²/2, so the original
  // "< dAB2" between-test is precisely |mc|² < dAB2/4. Only settlements the
  // spatial grid returns for that small disk can break the edge, so we query
  // it instead of scanning every settlement. Midpoint via the shortest signed
  // Δx so it's correct across the longitude seam (edges here are ≤20 tiles).
  let dx = b.pos.x - a.pos.x;
  if (dx > tw / 2) dx -= tw; else if (dx < -tw / 2) dx += tw;
  let mx = a.pos.x + dx / 2; mx = ((mx % tw) + tw) % tw;
  const my = (a.pos.y + b.pos.y) / 2;
  const radius = Math.sqrt(dAB2) / 2;
  let between = false;
  forEachNear(world, mx, my, radius, (c, d2) => {
    if (between || c === a || c === b || c.people < MIN_POP_TO_LINK) return;
    if (d2 < dAB2 / 4) between = true;   // c is inside the Thales circle
  });
  return !between;
}

function linkCloseNeighbours(world, s) {
  if (s.people < MIN_POP_TO_LINK) return false;
  const comp = world._networkComponents;
  const myComp = comp && comp.get(s.id) !== undefined ? comp.get(s.id) : s.id;
  let anyBuilt = false;
  // Only the settlements within CLOSE_NEIGHBOUR_DIST matter; the spatial grid
  // returns exactly those (with their squared distance as dAB2) instead of a
  // full O(settlements) scan per settled town each tick.
  forEachNear(world, s.pos.x, s.pos.y, CLOSE_NEIGHBOUR_DIST, (peer, dAB2) => {
    if (peer.id === s.id || peer.people < MIN_POP_TO_LINK) return;
    const pc = comp && comp.get(peer.id) !== undefined ? comp.get(peer.id) : peer.id;
    // Unconnected close neighbours are bridged for connectivity. ALREADY-connected
    // ones still get a DIRECT road when they are true mesh neighbours (a Gabriel
    // edge — no town between them), so a city links straight to its neighbour
    // instead of every trip detouring out to a trunk artery and back.
    if (pc === myComp && !isGabrielEdge(world, s, peer, dAB2)) return;
    const path = findPath(world, s, peer, { noWater: true });
    if (!path) return;
    let didChange = false;
    for (const ti of path.tiles) if (paintRoad(world, ti)) didChange = true;
    if (didChange) {
      anyBuilt = true;
      if (s.history) s.history.push({ step: world.step, type: "local-link", to: peer.id, tiles: path.tiles.length });
    }
  });
  return anyBuilt;
}

function tryAddRoad(world, s) {
  const sExport = exportValueOf(s, world);
  const sFood = (s._foodSupply || 0) - (s._foodDemand || 0);
  const sCountry = world.countries && world.countries.get(s.countryId);   // for the commerce-temperament road bar
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

  // ── Pass 1: rank in-reach peers by trade benefit, WITHOUT pathing ──
  // findPath is a full terrain Dijkstra (the expensive primitive); doing
  // it for every in-reach peer was the dominant cost of a plan tick.
  // Score peers cheaply on benefit first, then only path the most
  // promising few.
  const ranked = [];
  // Grid-bounded near query: rank only the peers within partner reach instead
  // of scanning every settlement (this ranking pass was the dominant per-plan
  // cost once the map got dense). forEachNear hands back the squared distance.
  forEachNear(world, s.pos.x, s.pos.y, reach, (peer, peerDistSq) => {
    if (peer.id === s.id) return;
    const peerRes = peer.localRes || {};
    let resGain = 0;
    for (const n of missing) {
      if ((peerRes[n] || 0) >= HAVE_THRESHOLD) resGain += 1;
    }
    const peerExport = exportValueOf(peer, world);
    const exGap = Math.abs(sExport - peerExport);
    const peerFood = (peer._foodSupply || 0) - (peer._foodDemand || 0);
    let foodGain = 0;
    if ((sFood < -0.01 && peerFood > 0.01) ||
        (sFood > 0.01 && peerFood < -0.01)) {
      foodGain = Math.min(Math.abs(sFood), Math.abs(peerFood));
    }
    const benefit = resGain * 2 + exGap + foodGain * 10;
    ranked.push({ peer, benefit, distSq: peerDistSq });
  });
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
    const path = findPath(world, s, peer, { noWater: true });
    if (connected) shortcutEvals++; else newEvals++;   // count cost even if null
    if (!path) continue;

    // New-tile fraction: how much of the path is NOT yet on a
    // road. Lower bar to bridge disconnected clusters; higher
    // bar to add a shortcut within an existing network.
    let newTiles = 0;
    for (const ti of path.tiles) if (rq[ti] >= 1.0) newTiles++;
    const newFrac = path.tiles.length > 0 ? newTiles / path.tiles.length : 0;
    const sameNetwork = myComp !== null && components && components.get(peer.id) === myComp;
    // A mercantile realm builds trade roads more eagerly (lower acceptance
    // bar); an insular one less so (personality.js commerceMul). Knowledge /
    // wealth still gate whether a road is actually affordable below — this
    // only colours the appetite.
    const commMul = (sCountry && sCountry.personality) ? commerceMul(sCountry.personality) : 1;
    const requiredFrac = (sameNetwork ? NEW_FRACTION_IN : NEW_FRACTION_OUT) / commMul;
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
  const tileComp = world._tileComp, tcSeen = world._tileCompSeen, tcStamp = world._tileCompStampVal;
  let physicalTiles = bestPath.tiles;
  if (destComp !== null && tileComp) {
    for (let i = 1; i < bestPath.tiles.length; i++) {
      const ti = bestPath.tiles[i];
      if (tcSeen[ti] === tcStamp && tileComp[ti] === destComp) {
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
      runFoodTradeBetween(world, s, peer, link);
      runGeneralTradeBetween(world, s, peer, link);
      runLuxuryTradeBetween(world, s, peer);
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
    if (gone.length) world._roadVersion = (world._roadVersion || 0) + 1;   // topology changed
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
  const growthNeed = headroom > 0 ? headroom * 0.003 * (s._urbanFactor || 1) : 0;
  // Also import enough to cover any CURRENT shortfall between local supply and
  // total demand (which now includes garrison provisioning) — that's how a
  // city feeds a standing army it can't grow the food for locally.
  const deficit = Math.max(0, (s._foodDemand || 0) - (s._foodSupply || 0));
  return growthNeed + deficit;
}
function runFoodTradeBetween(world, a, b, link) {
  const aSurplus = foodSurplus(a), bSurplus = foodSurplus(b);
  const aWant = foodAppetite(a), bWant = foodAppetite(b);
  let exporter, importer, shipRate, deficit;
  if (aSurplus > 0.001 && bWant > 0.001) {
    exporter = a; importer = b; shipRate = aSurplus; deficit = bWant;
  } else if (bSurplus > 0.001 && aWant > 0.001) {
    exporter = b; importer = a; shipRate = bSurplus; deficit = aWant;
  } else return;
  // Growth-reserve fraction for exporter: keep a thin buffer against transient
  // dips, but SHIP THE SURPLUS. The old rule reserved up to 70% when the
  // exporter had spare capacity ("feed own children first"), which made exactly
  // the depopulating rural villages — the breadbaskets a city should eat from —
  // hoard their grain instead of feeding the city. Shipping surplus doesn't
  // impede the seller's own growth (that's logistic on K, not on granary
  // level), so a farming village exports most of what it grows.
  const exporterK = exporter._k || Math.max(1, exporter.people);
  const headroom = Math.max(0, 1 - exporter.people / exporterK);
  const reserveFraction = 0.10 + headroom * 0.15;
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
  // reaches a settlement. The price is scaled by the IMPORTER's local
  // price level (inflation.js) — a coin-rich region pays more for grain.
  const wantPrice = maxFlow * FOOD_PRICE * localP(world, importer);
  const transport = link.cost * FOOD_TRANSPORT_PER_PATHCOST;
  const intermediates = link.inter || null;          // precomputed at reach build
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
  recordOut(importer, OUT_FOOD, wantPrice * scale);
  recordOut(importer, OUT_TOLLS, (transport + totalToll) * scale);
  recordIn(exporter, IN_FOOD, wantPrice * scale);
  if (intermediates) {
    const tollPer = wantPrice * FOOD_TOLL_RATE * scale;
    for (const inter of intermediates) { inter.wealth = (inter.wealth || 0) + tollPer; recordIn(inter, IN_TOLLS, tollPer); }
  }
}

// Bilateral trade: each settlement sells its OWN goods to the other and
// pays for what it buys. Money flows BOTH directions, so a settlement
// earns by selling what it makes (never credited for nothing), and even
// a cash-poor, low-export town keeps earning instead of draining to its
// reserve and freezing — that's the velocity that keeps money moving.
// Net wealth still drifts toward the higher-export partner, but only by
// the difference, while the gross flow circulates.
function demandMul(buyer) {
  const spare = (buyer.wealth || 0) - getWealthReserve(buyer);
  if (spare <= 0) return 1;
  return 1 + Math.min(DEMAND_WEALTH_CAP, spare / DEMAND_WEALTH_REF);
}
function runGeneralTradeBetween(world, a, b, link) {
  const minPop = Math.min(a.people, b.people);
  const vol = Math.sqrt(minPop) * T.TRADE_RATE;
  const transport = link.cost * TRANSPORT_PER_PATHCOST;
  const intermediates = link.inter || null;          // precomputed at reach build
  const numInter = intermediates ? intermediates.length : 0;
  // A's goods sold to B (B pays A), then B's goods sold to A (A pays B).
  // Each leg scales with the BUYER's buying power, so a rich node imports more
  // and relays its coin onward. Freight is split across the two legs.
  sellGoods(world, a, b, exportValueOf(a, world) * vol * demandMul(b), transport * 0.5, intermediates, numInter);
  sellGoods(world, b, a, exportValueOf(b, world) * vol * demandMul(a), transport * 0.5, intermediates, numInter);
}

// Luxury trade: a wealthy settlement spends coin importing luxury goods
// (spices/furs/incense/dyes) from a connected region that produces them.
// Coin flows consumer → producer (high value-to-weight, so no freight cost),
// bounded each tick by the producer's supply, the consumer's appetite, and
// what the consumer can afford above its reserve. This is what makes luxury-
// producing regions prosper and what gives rich cities somewhere to spend.
function runLuxuryTradeBetween(world, a, b) {
  luxLeg(a, b);   // a sells to b
  luxLeg(b, a);   // b sells to a
}
function luxLeg(seller, buyer) {
  const supply = seller._luxSupplyLeft || 0;
  const demand = buyer._luxDemandLeft || 0;
  if (supply <= 0.0001 || demand <= 0.0001) return;
  const affordable = Math.max(0, (buyer.wealth || 0) - getWealthReserve(buyer));
  const pay = Math.min(supply, demand, affordable);
  if (pay <= 0.0001) return;
  buyer.wealth -= pay;
  seller.wealth = (seller.wealth || 0) + pay;
  seller._luxSupplyLeft -= pay;
  buyer._luxDemandLeft -= pay;
  recordIn(seller, IN_LUXURY, pay);
  recordOut(buyer, OUT_LUXURY, pay);
}

// Importing country's capital (the customs collector) when buying foreign
// goods, or null for domestic trade / when the buyer is itself the capital.
function customsCollector(world, seller, buyer) {
  if (seller.countryId === buyer.countryId) return null;
  const c = world.countries && world.countries.get(buyer.countryId);
  if (!c || !c.capital || c.capital === buyer) return null;
  return c.capital;
}

// One leg: `seller` ships `goodsValue` of goods to `buyer`; buyer pays from
// wealth above its reserve, with freight consumed en route, a toll skimmed
// by each intermediate settlement on the road, and — for foreign goods — an
// import duty collected by the buyer's state.
function sellGoods(world, seller, buyer, goodsValue, freight, intermediates, numInter) {
  if (goodsValue <= 0) return;
  const totalToll = goodsValue * TOLL_RATE * numInter;
  const collector = customsCollector(world, seller, buyer);
  const tariff = collector ? goodsValue * T.TARIFF_RATE : 0;
  // Don't ship goods worth less than the cost to move + clear them.
  if (goodsValue <= freight + totalToll + tariff) return;
  const want = goodsValue + freight + totalToll + tariff;
  const reserve = getWealthReserve(buyer);
  const available = Math.max(0, (buyer.wealth || 0) - reserve);
  if (available <= 0) return;
  const actual = available < want ? available : want;
  const scale = actual / want;
  buyer.wealth -= actual;
  seller.wealth = (seller.wealth || 0) + goodsValue * scale;
  recordOut(buyer, OUT_GOODS, goodsValue * scale);
  recordOut(buyer, OUT_TOLLS, (freight + totalToll) * scale);
  recordIn(seller, IN_GOODS, goodsValue * scale);
  if (intermediates) {
    const tollPer = goodsValue * TOLL_RATE * scale;
    for (const inter of intermediates) { inter.wealth = (inter.wealth || 0) + tollPer; recordIn(inter, IN_TOLLS, tollPer); }
  }
  // Customs duty funds the importing realm's STATE TREASURY (not the capital
  // city's purse) — the government then redistributes it (conquest.js).
  if (collector) { govOf(world, buyer.countryId).treasury += tariff * scale; recordOut(buyer, OUT_TARIFFS, tariff * scale); }
  // Conservation: buyer loses `actual` = goodsValue*scale (to seller)
  // + totalToll*scale (to intermediates) + tariff*scale (to the state)
  // + freight*scale (consumed).
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
// Point-to-point least-cost path for road building. A* over the terrain
// cost field: an admissible heuristic (straight-line distance × the cheapest
// possible per-tile step) steers the search toward the goal so it explores a
// fraction of the tiles a blind Dijkstra would, and typed-array scratch with
// a per-call stamp avoids both Map overhead and any O(N) clear. Hundreds of
// these run each road-plan cycle, so this is the hot primitive.
const FP_MIN_STEP = 0.02;   // cheapest an edge can ever cost (worn road × max tech) — keeps h admissible
// Optional opts.noWater: skip water tiles even if the settlement's
// navigation would let it embark. Used by road planners (you can't paint
// a road across the sea); marching armies pass no opts so they DO get to
// route over water if they have navigation tech.
export function findPath(world, s, t, opts) {
  const { tw, th, elev, N } = world;
  const noWater = opts && opts.noWater;
  const start = (s.pos.y | 0) * tw + (s.pos.x | 0);
  const goal  = (t.pos.y | 0) * tw + (t.pos.x | 0);
  if (start === goal || elev[start] <= 0 || elev[goal] <= 0) return null;
  // Scratch arrays, reused across calls; a monotonic stamp marks which
  // entries belong to THIS call so we never have to clear N every time.
  if (!world._fpG || world._fpG.length !== N) {
    world._fpG = new Float64Array(N);
    world._fpSeen = new Int32Array(N);
    world._fpPrev = new Int32Array(N);
    world._fpStamp = 0;
  }
  const g = world._fpG, seen = world._fpSeen, prev = world._fpPrev;
  if (world._fpStamp >= 2147483646) { seen.fill(0); world._fpStamp = 0; }
  const stamp = ++world._fpStamp;
  const gy = (goal / tw) | 0, gx = goal - gy * tw;
  const h = ti => {
    const y = (ti / tw) | 0, x = ti - y * tw;
    let dx = Math.abs(x - gx); if (dx > tw / 2) dx = tw - dx;
    const dy = y - gy;
    return Math.sqrt(dx * dx + dy * dy) * FP_MIN_STEP;
  };
  g[start] = 0; seen[start] = stamp; prev[start] = -1;
  const heap = new MinHeap();
  heap.push(start, h(start));
  // Bound exploration by the straight-line distance: a road should be roughly
  // direct, so cap the node budget at O(distance²). This makes a FAILED probe
  // (e.g. a peer with no land route) abort within its local region instead of
  // scanning the whole landmass up to 40k nodes — those failures were the
  // dominant road-plan spike on a large map.
  let dgx=Math.abs((start%tw)-gx); if(dgx>tw/2)dgx=tw-dgx;
  const dgy=((start/tw)|0)-gy;
  const dHint=Math.sqrt(dgx*dgx+dgy*dgy);
  const limit = Math.min(12000, 1500 + ((dHint*dHint*6)|0));
  let visited = 0;
  while (heap.n > 0) {
    if (visited++ > limit) return null;
    const { ti, d } = heap.popMin();
    if (ti === goal) break;
    const gti = g[ti];
    if (d > gti + h(ti) + 1e-9) continue;     // stale heap entry (a cheaper g was found after push)
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
      if (noWater && elev[ni] <= 0) continue;
      const c = localEdgeCost(world, ti, ni, s.knowledge);
      if (c === Infinity) continue;
      const nd = gti + c * mul[k];
      if (seen[ni] !== stamp || nd < g[ni]) {
        g[ni] = nd; seen[ni] = stamp; prev[ni] = ti;
        heap.push(ni, nd + h(ni));
      }
    }
  }
  if (seen[goal] !== stamp) return null;
  const tiles = [];
  let cur = goal;
  while (cur !== -1) {
    tiles.push(cur);
    if (cur === start) break;
    cur = prev[cur];
  }
  tiles.reverse();
  return { tiles, cost: g[goal] };
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

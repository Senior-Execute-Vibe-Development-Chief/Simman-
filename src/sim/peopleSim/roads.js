// ── Roads: tile-map model + per-settlement trade-reach cache ──
//
// Roads are NOT entities. The entire road network exists as two
// per-tile Float32Arrays:
//
//   world.roadQuality[ti]  — 1.0 = no road, < 1.0 = road quality.
//                            Painted at the BUILDER's roadcraft
//                            (paintQualityFor: neolithic path 0.58 →
//                            engineered road 0.25), hard-packs under
//                            sustained flow to TRACK_FLOOR (0.30), and
//                            paves below that only as the owning realm
//                            earns it: Roads tech → PAVED_FLOOR (0.12),
//                            Railroad → QUALITY_MAX (0.08). Abandoned
//                            surfaces decay back to bare terrain.
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

import { localEdgeCost } from "./transport.js";
import { forEachNear } from "./spatialGrid.js";
import { T, rNormPop } from "./tuning.js";
import { getPolity } from "./entities.js";
import { TECH_IDX } from "./tech.js";
import { exportValueOf, getWealthReserve, techEff } from "./settlement.js";
import { govOf } from "./conquest.js";
import { commerceMul } from "./personality.js";
import { localP } from "./inflation.js";
import { recordIn, recordOut, recordInMetered, recordOutMetered, IN_GOODS, IN_FOOD, IN_MATERIALS, IN_TOLLS, IN_LUXURY, IN_CARRY, IN_ORE, IN_METAL, IN_CLOTH, IN_WARES, OUT_GOODS, OUT_FOOD, OUT_MATERIALS, OUT_TOLLS, OUT_TARIFFS, OUT_LUXURY } from "./money.js";
import { TRADABLE, G_MATERIALS, G_ORE, G_METAL, G_CLOTH, G_WARES, G_LUXURY } from "./goods.js";   // goods-vector Stage 2 (T.GOODS_TRADE) + the freight bulk table

// Entrepôt share (0..1): how much of an entrepôt a hub is — port access (a harbour or
// strait trade must funnel through) times market size (a great mart re-sells what it
// lands). A big coastal city ≈ 1 (Venice, Amsterdam, Malacca); a small inland ford ≈ 0.
// Scales the re-export brokerage it skims off goods passing through it.
function entrepotShare(s) {
  const port = Math.min(1, s.waterAccess || 0);
  const market = Math.min(1, Math.log10(Math.max(1, s.people || 0)) / 4);   // ~0 at a hamlet, ~1 at 10k+
  return (0.3 + 0.7 * port) * market;
}

// ── Constants ──────────────────────────────────────────────────────
const QUALITY_NEW         = 0.25;       // ENGINEERED road as laid: 4× cheaper than plain
const QUALITY_MAX         = 0.08;       // worn arterial: 12× cheaper
// What surface can a builder actually LAY? Roadcraft is construction
// knowledge: a neolithic village treads a kin PATH (~1.7× cheaper than wild
// ground), a masonry-age town grades a cart TRACK, and only an engineering
// culture (the construction band of the Roads tech, cons ≈ 0.6) lays the
// QUALITY_NEW metalled surface. Smooth in the builder's own construction —
// what the world has become, never when it is. This is what stops stone-age
// hamlets from painting highway-grade trunks at tick 0 (they still connect —
// paths carry trade and ideas — but a path is not a via).
const TRAIL_NEW           = 0.58;
function paintQualityFor(s) {
  const cons = (s && s.knowledge && s.knowledge.construction) || 0;
  const t = Math.min(1, Math.max(0, (cons - 0.10) / 0.50));   // 0 at cons 0.10 → 1 at 0.60 (the Roads-tech band)
  return TRAIL_NEW - (TRAIL_NEW - QUALITY_NEW) * t;
}
// Flow-paving splits into three regimes by what the tile's OWNING realm has
// actually earned (capital techEff, memoised per tick):
//   • ANY sustained traffic hard-packs a surface down to TRACK_FLOOR — a
//     beaten trunk track; no state needed.
//   • A realm holding the ROADS tech paves its busy corridors on to
//     PAVED_FLOOR — the metalled via. Deliberately kept ABOVE the river
//     lane (RIVER_STEP 0.10): water haulage stayed cheaper than the best
//     road until rail (review I17 — the old single 0.08 floor priced a
//     Roman road below a river barge).
//   • The RAILROAD tech takes the corridor to QUALITY_MAX — the one land
//     mode that historically beat the barge.
// Unowned ground and pre-engineering realms keep tracks; each unlock lets
// the same busy corridors pave on with no repaint — the emergent via (and
// then rail-age) network. Never a date, always the realm's own tree.
const TRACK_FLOOR         = 0.30;
const PAVED_FLOOR         = 0.12;
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
const PARTNER_DIST_BASE   = 10;         // was 20: the zero-tech horizon is the next
                                        // settlement over, not a continental corridor —
                                        // long trunk planning is EARNED below
const PARTNER_DIST_PER    = 1.0;        // tiles per sqrt(pop)
// Hard ceiling on a SINGLE planned road segment, in REFERENCE tiles (a real
// distance: one reference tile ≈ 170 km on the Earth grid). Population and
// commerce may WANT a far partner, but a maintained overland route longer
// than the local ring was beyond any pre-modern state — long-range land
// trade was a RELAY through intermediate towns (the trade-reach chain
// already models it), not one continuous surveyed line between two little
// settlements. Only LOGISTICS technique (wheel→roads→rail→telegraph, the
// techEff channel) extends what one polity can survey and maintain as a
// single route: ~12 ref-tiles pre-logistics (the neighbour ring), ~20 by
// the classical roads era, ~35-48 in the rail age (the genuinely
// continental trunk — historically the first single land routes at that
// scale). Without this cap the uncapped √pop term let any modest early
// town plan a ~4000-km line: the "continent-spanning road between two
// random little settlements" artifact.
const SEG_CAP_BASE        = 12;
const SEG_CAP_LOGI        = 36;
// The horizon above bounds a ROUTE, not a sight line — and the route that
// actually gets painted is the A* line ON THE GROUND, which winds around
// mountains, lakes and coasts and can run far longer than the straight
// endpoint distance the planner measured. A maintained route tolerates only
// modest winding beyond the direct line: surveyed historical land routes run
// ~1.2–1.5× their great-circle distance (route "detour index" — passes,
// fords and contour-following), and anything beyond that was never one
// maintained line but a RELAY through intermediate places. So a candidate
// route whose walked length exceeds the builder's horizon × this allowance
// is rejected — the pair must connect through relays instead. NB what is
// bounded is ABSOLUTE walked length against the tech horizon (walked ≤
// horizon × allowance), not the pair's own detour ratio — a close pair may
// still take a winding route so long as the whole walk stays inside 1.5×
// what the builder's logistics can maintain. Dimensionless multiple of the
// horizon (which already carries rNormPop), hence resolution-invariant.
const PATH_WINDING_MAX    = 1.5;
function partnerReachFor(world, s) {
  const k = s.knowledge || {};
  // Mobility (horses, wagons), navigation (ships) and CONSTRUCTION (the
  // roadcraft that makes a long overland route worth surveying at all)
  // expand the commercial horizon — up to ~2.4× for a fully-teched
  // metropolis. A stone-age hamlet plans only to its neighbours; the wheel,
  // pack routes and engineering push the horizon outward as they arrive.
  const techMul = 1 + 0.5 * (k.mobility || 0) + 0.3 * (k.navigation || 0) + 0.6 * (k.construction || 0);
  const want = (PARTNER_DIST_BASE + Math.sqrt(Math.max(0, s.people || 0)) * PARTNER_DIST_PER) * techMul;
  const cap = SEG_CAP_BASE + SEG_CAP_LOGI * techEff(s).logisticsLevel;
  // A commercial horizon is a REAL distance: peers sit ×rNormPop more tiles
  // apart on a finer grid (founding spacing scales — crystallize.js), so the
  // raw-tile radius quietly shrank the road planner's real horizon to 1/rn
  // (¼ at the shipped 1920 default) and the trunk network under-wired.
  // ×1 exactly at the 240-tile reference.
  return Math.min(want, cap) * rNormPop(world);
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
const SHORTCUT_GAIN_RATIO = 0.85;       // new direct path must save ≥ 15% vs network path…
// …at ZERO engineering. Surveying and earthworks are what made straightening
// worth it — the groma-and-causeway cultures famously cut direct lines where
// older routes wound (the Roman viae; the motorway age again) — so the
// savings a shortcut must promise FALLS as the builder's roadcraft rises:
// the required ratio eases from 0.85 toward SHORTCUT_GAIN_ENG (≥3% saving)
// and the per-cycle shortcut probe budget grows 1 → 3. Emergent in the
// builder's own construction band + logistics techs (the same measures that
// set paint quality and the segment cap) — a neolithic culture never
// straightens; an engineering one redraws its map.
const SHORTCUT_GAIN_ENG   = 0.97;
function roadEngineeringOf(s) {
  const cons = (s && s.knowledge && s.knowledge.construction) || 0;
  const t = Math.min(1, Math.max(0, (cons - 0.10) / 0.50));   // the paintQualityFor band
  return Math.max(t, techEff(s).logisticsLevel);
}

// Close-neighbour rule: any settled pair within this many REFERENCE tiles
// of each other gets a direct path painted by the local-link
// pass — separate from economic road planning. Models the
// ever-present village foot traffic (kin visits, shared grazing,
// market days, parish boundaries) which produces paths between
// neighbours whether or not they have anything to trade. Without
// this, two close towns get routed the long way round a worn trunk
// because the worn arterial is "cheaper" than a fresh terrain crossing.
// 12 covers the natural founding-spacing rings on habitable land
// (fertile ~4-10, moderate ~10-12 — crystallize.js capacitySpacingMul);
// pairs farther apart than this are NOT "close" in any real sense (a
// reference tile ≈ 170 km) and get no guaranteed path — they trade via
// relay chains, or genuinely stand isolated (ultra-sparse pairs on barren
// land: honest — and under the urban floor such entities barely arise).
// The old 20 guaranteed painted ~3300-km lines between little settlements.
const CLOSE_NEIGHBOUR_DIST    = 12;     // grid near-query radius for local links (REFERENCE tiles, ×rn at use)
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
const USAGE_PER_TRADE              = 0.04;   // flow added per tile per active trade tick
const MONEY_FLOW_EPS               = 0.01;   // min net /tick for a link to register in the money-flow overlay
// ── Trade throttle ──
// The bilateral trade loop is O(pairs) and the single biggest per-tick cost of
// the whole sim, yet a pair's transfer is tiny and the economy runs on EMAs +
// granary buffers — it does NOT need resolving every tick. So run the pass once
// every T.TRADE_STRIDE ticks at STRIDE× volume: same AVERAGE money / goods / road-
// flow, ~STRIDE× cheaper amortised. This is the same throttle the knowledge pass
// already uses (KNOW_INTERVAL). Road flow DECAY and PAVING still run every tick,
// so the surface maintains smoothly between trade ticks. T.TRADE_STRIDE is a live
// Pacing lever (tuning.js); 1 recovers the exact every-tick behaviour.
const tradeStride = () => Math.max(1, T.TRADE_STRIDE | 0);

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
const TOLL_RATE       = 0.18;   // transit toll skimmed by each settlement a trade route passes through
const TOLL_CHOKE_W    = 3.0;    // …multiplied for a settlement that controls a CROSSING (river ford/bridge,
                                // coastal strait/port — high waterAccess): trade must funnel through it, so a
                                // chokepoint town lives on tolls (the Rhine castles, the Bosphorus, the Sound Dues)
// Cross-border customs: when goods are sold INTO a different country, that
// country's state (its capital) levies an import duty on top of the price.
// It raises the cost of foreign trade — so commerce within one realm is
// cheaper and empires act as trade blocs — and hands the crown a customs
// income, making a conquered trade hub genuinely worth holding. Conserved:
// the duty the buyer pays goes to the importing country's capital. Food is
// exempt (famine relief shouldn't be taxed).
// TARIFF_RATE -> runtime lever (tuning.js T.TARIFF_RATE)

const ROADS_TECH = TECH_IDX["roads"];      // the paving unlock the pave floor reads
const RAIL_TECH  = TECH_IDX["railroad"];   // …and the rail-age unlock below it

// Walked length of a contiguous 8-neighbour tile route, in RAW tiles
// (orthogonal step 1, diagonal step √2): the on-the-ground length of the
// line as surveyed, as opposed to the straight-line endpoint distance.
// This is the quantity the logistics horizon must actually bound — A*
// winds around mountains and coasts, so a route between endpoints inside
// the horizon can still be far longer than the horizon on the ground.
function pathWalkLength(world, tiles) {
  const tw = world.tw;
  let len = 0;
  for (let i = 1; i < tiles.length; i++) {
    // Consecutive route tiles differ by one 8-neighbour step: orthogonal
    // (length 1) or diagonal (length √2). Classify via decoded Δx (wrapped
    // across the longitude seam) — a step is diagonal exactly when both
    // the row and the (wrapped) column change.
    const a = tiles[i - 1], b = tiles[i];
    const ay = (a / tw) | 0, by = (b / tw) | 0;
    let dx = Math.abs((a - ay * tw) - (b - by * tw)); if (dx > tw / 2) dx = tw - dx;
    len += (dx === 1 && ay !== by) ? SQRT2 : 1;
  }
  return len;
}

// Debug telemetry: the longest SINGLE build (one planned/linked route)
// ever painted this run, in REFERENCE tiles — BOTH the Euclidean endpoint
// distance (maxBuildSpan) and the walked length of the painted route
// (maxBuildPathLen), which winding can push far beyond the endpoint span;
// the path length is the quantity the horizon actually has to bound, and
// the earlier endpoint-only telemetry is what let 6×-winding routes pass
// three audits unseen. Relay-guard builds (the sanctioned over-cap
// exception — see linkCloseNeighbours) are tallied separately
// (kinGuardBuilds / maxGuardPathLen) so the rule and the exception stay
// independently auditable. Write-only — probe scripts print these; the
// sim never reads them.
function recordBuildSpan(world, a, b, walkLenRaw, viaGuard) {
  if (!world.debug) return;
  const tw = world.tw;
  let dx = Math.abs(a.pos.x - b.pos.x); if (dx > tw / 2) dx = tw - dx;
  const dy = a.pos.y - b.pos.y;
  const rn = rNormPop(world);
  const d = Math.sqrt(dx * dx + dy * dy) / rn;
  if (!(world.debug.maxBuildSpan >= d)) world.debug.maxBuildSpan = d;
  if (walkLenRaw !== undefined) {
    const pl = walkLenRaw / rn;
    if (viaGuard) {
      world.debug.kinGuardBuilds = (world.debug.kinGuardBuilds || 0) + 1;
      if (!(world.debug.maxGuardPathLen >= pl)) world.debug.maxGuardPathLen = pl;
    } else if (!(world.debug.maxBuildPathLen >= pl)) {
      world.debug.maxBuildPathLen = pl;
    }
  }
}

export { QUALITY_NEW, QUALITY_MAX, TRACK_FLOOR, FLOW_FOR_PAVE, FLOW_FOR_BUSY };
// The trade-cost machinery, exported for the slave market's distance-priced
// clearing (slavery.js): captives clear through the SAME audited sale path
// and pay the SAME friction family (freight per path cost, per-hub tolls,
// entrepôt brokerage, tariffs) every other consignment pays — one cost
// model, no parallel physics.
export { sellGoods, TRANSPORT_PER_PATHCOST, TOLL_RATE, TOLL_CHOKE_W, GT_BULK, entrepotShare, MinHeap };

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
  if (!world._flowTiles) {
    world._flowTiles = new Set();
    const rf = world.roadFlow;
    for (let ti = 0; ti < rf.length; ti++) if (rf[ti] >= FLOW_EPS) world._flowTiles.add(ti);
  }
}

// After a state load replaces roadQuality/roadFlow wholesale, the sparse
// indices (created empty at init) no longer match the arrays — the decay
// and paving sweeps would then skip every loaded tile forever. Rebuild
// both from the arrays they index.
export function reindexRoads(world) {
  world._roadTiles = null;
  world._flowTiles = null;
  ensureRoadArrays(world);
}

// Paint a single tile as a fresh road at the builder's own roadcraft
// quality (paintQualityFor), keeping the sparse road-tile index in sync.
// Takes min so an existing better surface isn't downgraded — and so a
// LATER, more skilled builder re-planning the same route UPGRADES the old
// path to its era's surface. Returns true if the tile actually changed.
function paintRoad(world, ti, q = QUALITY_NEW) {
  // Don't paint roads on water tiles — navigation lets findPath route across
  // water (for marching armies), but the road network is land-only.
  if (world.elev && world.elev[ti] <= 0) return false;
  if (q < world.roadQuality[ti]) {
    world.roadQuality[ti] = q;
    world._roadTiles.add(ti);
    world._roadVersion = (world._roadVersion || 0) + 1;   // topology changed
    return true;
  }
  return false;
}

// Map: home tile index → settlement. Cached per tick (one shared Map instance,
// clear+refill — it used to be re-allocated every tick by staggerReachRebuild
// AND per components rebuild).
function buildSettlementTileMap(world) {
  if (world._stMapStep === world.step && world._stMap) return world._stMap;
  let map = world._stMap;
  if (map) map.clear(); else map = world._stMap = new Map();
  for (const s of world.settlements) {
    if (s.mode !== "settled") continue;
    const ti = (s.pos.y | 0) * world.tw + (s.pos.x | 0);
    map.set(ti, s);
  }
  world._stMapStep = world.step;
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

// A navigable-river tile is a cheap trade corridor in its own right (a boat on the
// Nile / Rhine / Yangtze), so the reach Dijkstra flows along great rivers even with
// no road on them — dearer than a worn arterial, far cheaper than bare land.
const RIVER_STEP = 0.10;

// Steamship-era throughput: a sea link's volume multiplier grows up to ×(1+this)
// with the endpoints' seaSpeed tech, so the maritime share of trade RISES with
// era (sail ≈ T.SEA_TRADE_MULT, full steam ≈ 2.5× that) instead of staying flat.
const SEA_TECH_VOL = 1.5;

function computeReach(world, s, stMap) {
  const reach = new Map();
  const { tw, th, roadQuality: rq, N, riverMag, elev } = world;
  const startTi = (s.pos.y | 0) * tw + (s.pos.x | 0);
  // A tier-0 VILLAGE keeps only its nearest T.VILLAGE_PARTNERS partners (local
  // market trade) instead of the whole network. Same toll/tariff/tax machinery
  // (money stays conserved — it's still real bilateral trade), but far cheaper:
  // the reach Dijkstra stops sooner, and the per-pair trade / knowledge-diffusion
  // / development-materials loops all iterate THIS reach. Towns+ always get the
  // full set; default 12 = villages trade like everyone else (no change).
  const cap = (s.tier | 0) < 1
    ? Math.max(1, Math.min(MAX_PARTNERS, T.VILLAGE_PARTNERS | 0))
    : MAX_PARTNERS;
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
  // The visit cap bounds a REAL search area: tiles-per-real-area is ×rNormPop²
  // on a finer grid, so the cap rides along or the reach Dijkstra covers ¼ the
  // real disk at tw=480 and frontier settlements lose their far partners
  // (audit OPEN #5b). ×1 exactly at the 240-tile reference.
  const maxVisits = MAX_REACH_VISITS * rNormPop(world) ** 2;
  while (heap.n > 0 && visited++ < maxVisits) {
    const { ti, d } = heap.popMin();
    if (d > dist[ti]) continue;                 // stale heap entry
    const peer = stMap.get(ti);
    if (peer && peer.id !== s.id && !reach.has(peer.id)) {
      const tiles = [];
      let cur = ti;
      while (cur !== -1) { tiles.push(cur); if (cur === startTi) break; cur = prev[cur]; }
      tiles.reverse();
      const link = { cost: d, tiles };
      // River lane: if a good share of the path runs along a navigable river, the
      // link carries boosted volume (T.RIVER_TRADE_MULT), the way sea links do.
      let rvt = 0;
      for (let j = 0; j < tiles.length; j++) { const t = tiles[j]; if (riverMag && riverMag[t] >= 3 && elev[t] > 0) rvt++; }
      if (tiles.length > 0 && rvt >= tiles.length * 0.35) link.river = true;
      link.inter = intermediatesOnPath(link, s.id, peer.id, stMap);
      reach.set(peer.id, link);
      if (reach.size >= cap) break;              // nearest-first; we have enough (villages: fewer — see cap)
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
      const isRiver = !isRoad && riverMag && riverMag[ni] >= 3 && elev[ni] > 0;   // navigable river = cheap corridor, no road needed
      if (!isRoad && !isRiver && !stMap.has(ni)) continue;
      const nd = d + (isRoad ? rq[ni] : isRiver ? RIVER_STEP : 0.15) * mul[k];
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
// out over many ticks: a snapshot queue is taken each PLAN_INTERVAL, then
// exactly ONE candidate settlement is evaluated per tick (see maybeBuildRoads),
// so the same total work is amortised into smooth per-tick cost with no stutter.

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
      if (s.countryId < 0) return false;   // stateless settlements PLAN no trunk roads — surveying and protecting a long route is statecraft (kin paths to close neighbours are separate: the local-link rotation below serves everyone)
      if ((s.tier | 0) < (T.ROAD_MIN_TIER | 0)) return false;   // grand scale: tier-0 Farming Regions don't lay roads (roads are trade-only trunk routes, town↔city)
      // A meaningful pop jump (or first-ever evaluation) makes it due now.
      if (s._planPop === undefined || s.people > s._planPop * 1.4) s._planNext = 0;
      return (s._planNext || 0) <= snap;
    });
    world._planIdx = 0;
  }

  let built = false;
  const queue = world._planQueue;
  if (queue) {
    // Evaluate a slice this tick — sized so the whole queue finishes within
    // PLAN_SPREAD ticks regardless of how many settlements there are.
    const snap = world._planSnap || world.step;
    // Exactly one settlement per tick: each tryAddRoad is several A* probes, so
    // this guarantees no single tick can spike on road planning. A big backlog
    // just takes more ticks (and the next cycle re-queues anything unprocessed)
    // — roads aren't urgent, and smoothness matters more at high sim speed.
    const end = Math.min(queue.length, world._planIdx + 1);
    for (; world._planIdx < end; world._planIdx++) {
      const s = queue[world._planIdx];
      if (!s || s.mode !== "settled") continue;
      const did = tryAddRoad(world, s);
      s._planPop = s.people;
      s._planBackoff = did ? 1 : Math.min(8, (s._planBackoff || 1) * 2);
      s._planNext = snap + PLAN_INTERVAL * s._planBackoff;
      if (did) built = true;
    }
    if (world._planIdx >= queue.length) world._planQueue = null;
  }

  // Local-link rotation: ONE settlement per tick, cycling through EVERYONE
  // settled — statehood NOT required. Kin visits, shared grazing and market
  // days tread paths between close neighbours whether or not a court exists
  // (the pass's own stated model; it was unreachable for the stateless
  // communities it was written for while it lived inside the state-gated plan
  // queue — review I19). The paths it paints are the builder's OWN roadcraft
  // (paintQualityFor): village paths, not state trunks, so statecraft still
  // owns the engineered network via tryAddRoad above.
  {
    const setts = world.settlements;
    const n = setts.length;
    let cur = world._linkCursor || 0;
    let scanned = 0;
    while (scanned < n) {
      const s = setts[cur % n];
      cur++; scanned++;
      if (s.mode === "settled" && s.people >= MIN_POP_TO_LINK) {
        if (linkCloseNeighbours(world, s)) built = true;
        break;
      }
    }
    world._linkCursor = cur;
  }

  // One components refresh per tick if anything built (not per build — that
  // BFS-per-build was a multi-hundred-ms stall when a cycle built many roads).
  if (built) world._networkComponents = buildNetworkComponents(world);
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
  // Δx so it's correct across the longitude seam (edges here are ≤20·rNormPop
  // tiles — the res-scaled close-neighbour radius — always ≪ half the map).
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
  // ×rNormPop: "close" is a REAL distance. The constant is calibrated just above
  // the reference founding spacing (MIN_SETT_DIST 12) so closest pairs always
  // qualify — but the spacing scales ×rn with the grid (crystallize.js) while a
  // raw 20 does not, so at the shipped 1920 default (rn=4, spacing ~48 tiles)
  // the guaranteed city↔neighbour wiring found NOBODY and the local road
  // mesh never formed (under cities-only defaults every settlement entity is
  // an urban centre — the countryside is the popField, not an entity).
  // ×1 exactly at the 240-tile reference.
  const q = paintQualityFor(s);
  const rn = rNormPop(world);
  // Kin paths obey the SAME physics as trunk routes: the walked line to a
  // neighbour may not exceed min(the close-neighbour radius, the builder's
  // own logistics horizon) × the winding allowance. The Euclidean radius
  // already bounds WHO counts as close; this bounds the ROUTE — without it
  // a path to a neighbour 12 ref-tiles away could legally wind an unbounded
  // distance around mountains and gulfs, and those painted detours were the
  // "continental path at tick 0" artifact (third report). Raw tiles: both
  // terms carry ×rn, so the comparison is resolution-invariant.
  const kinCapRaw = Math.min(CLOSE_NEIGHBOUR_DIST * rn, partnerReachFor(world, s)) * PATH_WINDING_MAX;
  // Collect-then-sort (nearest first, id tiebreak) instead of acting inside
  // the grid callback: the relay guard below needs to know how the WHOLE
  // neighbourhood fared before it may fire.
  const cands = [];
  forEachNear(world, s.pos.x, s.pos.y, CLOSE_NEIGHBOUR_DIST * rn, (peer, dAB2) => {
    if (peer.id === s.id || peer.people < MIN_POP_TO_LINK) return;
    cands.push({ peer, dAB2 });
  });
  cands.sort((a, b) => (a.dAB2 - b.dAB2) || (a.peer.id - b.peer.id));
  // hasLink: s demonstrably reaches SOMEBODY within the cap (a link painted
  // now, or an existing within-cap route). fallback: the least-winding
  // over-cap route found, kept for the relay guard.
  let hasLink = false;
  let fallback = null;
  for (const { peer, dAB2 } of cands) {
    const pc = comp && comp.get(peer.id) !== undefined ? comp.get(peer.id) : peer.id;
    // Unconnected close neighbours are bridged for connectivity. ALREADY-connected
    // ones still get a DIRECT road when they are true mesh neighbours (a Gabriel
    // edge — no town between them), so a city links straight to its neighbour
    // instead of every trip detouring out to a trunk artery and back.
    if (pc === myComp && !isGabrielEdge(world, s, peer, dAB2)) continue;
    const path = findPath(world, s, peer, { noWater: true });
    if (!path) continue;
    const walk = pathWalkLength(world, path.tiles);
    if (walk > kinCapRaw) {
      // Too winding to maintain as a kin path — remember the least-bad
      // route in case s would otherwise stand utterly alone (relay guard).
      if (!fallback || walk < fallback.walk) fallback = { peer, path, walk };
      continue;
    }
    let didChange = false;
    for (const ti of path.tiles) if (paintRoad(world, ti, q)) didChange = true;
    if (didChange) {
      anyBuilt = true;
      recordBuildSpan(world, s, peer, walk);
    }
    hasLink = true;   // a within-cap route exists (whether or not it was new paint)
  }
  // THE RELAY GUARD — the recorded trap (see the ×rNormPop note above): the
  // last time effective kin reach was cut, the guaranteed city↔neighbour
  // wiring found NOBODY and the early network never formed. A people is
  // never voluntarily roadless: it always treads a path to its ONE nearest
  // neighbour — that path IS the relay the horizon model assumes long-range
  // trade flows through. So if s is in a singleton network component (no
  // road links at all) and every close route was rejected as too winding,
  // permit the single least-winding one regardless of the cap.
  if (!hasLink && !anyBuilt && fallback) {
    let isolated = true;
    if (comp) {
      for (const [id, root] of comp) {
        if (id !== s.id && root === myComp) { isolated = false; break; }
      }
    }
    if (isolated) {
      let didChange = false;
      for (const ti of fallback.path.tiles) if (paintRoad(world, ti, q)) didChange = true;
      if (didChange) {
        anyBuilt = true;
        recordBuildSpan(world, s, fallback.peer, fallback.walk, true);
      }
    }
  }
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

  const reach = partnerReachFor(world, s);

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
    // Stateless peers are legitimate trunk DESTINATIONS: the tin/amber pattern —
    // states surveyed roads to the non-state peripheries that held what they
    // lacked. (Stateless communities still PLAN no trunks of their own — the
    // statecraft gate on the plan queue.)
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
  let bestPartner = null, bestScore = -Infinity, bestPath = null;
  let newEvals = 0, shortcutEvals = 0;
  // Engineering eases the straightening economics (see SHORTCUT_GAIN_ENG):
  // the acceptance bar and the probe budget both follow the builder's own
  // roadcraft, so mature networks get redrawn by the cultures that can.
  const eng = roadEngineeringOf(s);
  const shortcutBar = SHORTCUT_GAIN_RATIO + (SHORTCUT_GAIN_ENG - SHORTCUT_GAIN_RATIO) * eng;
  const maxShortcuts = MAX_SHORTCUT_EVALS + (eng > 0.35 ? 1 : 0) + (eng > 0.7 ? 1 : 0);
  for (const cand of ranked) {
    if (newEvals >= MAX_NEW_EVALS && shortcutEvals >= maxShortcuts) break;
    const peer = cand.peer;
    const connected = !!(s._tradeReach && s._tradeReach.has(peer.id));
    if (connected) {
      if (shortcutEvals >= maxShortcuts) continue;
    } else {
      if (newEvals >= MAX_NEW_EVALS) continue;
    }
    const path = findPath(world, s, peer, { noWater: true });
    if (connected) shortcutEvals++; else newEvals++;   // count cost even if null
    if (!path) continue;

    // The logistics horizon caps the ROUTE AS WALKED, not just its
    // endpoints: `reach` bounded which peers were considered (Euclidean),
    // but the A* line to an in-horizon peer can wind far beyond the horizon
    // on the ground. A route longer than the horizon × the winding
    // allowance is beyond what this builder can survey and maintain as one
    // segment — the pair trades via relay chains instead. (reach and the
    // walked length are both in raw tiles at this grid, so the comparison
    // is resolution-invariant.)
    if (pathWalkLength(world, path.tiles) > reach * PATH_WINDING_MAX) continue;

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

    // If same network: ALSO require the new direct path to be meaningfully
    // shorter than the existing network path — "meaningfully" by the
    // builder's own engineering (shortcutBar: 15% savings for a pre-survey
    // culture, any ≥3% once roadcraft matures).
    if (sameNetwork && s._tradeReach && s._tradeReach.has(peer.id)) {
      const networkCost = s._tradeReach.get(peer.id).cost;
      if (path.cost > networkCost * shortcutBar) continue;
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
  // Paint new tiles into roadQuality at the builder's own roadcraft (take
  // min so we don't downgrade an existing better surface). If nothing
  // actually changed (path is entirely on existing roads), report no build —
  // otherwise we re-run reach + components every cycle on a stable network.
  let didChange = false;
  const paintQ = paintQualityFor(s);
  for (const ti of physicalTiles) {
    if (paintRoad(world, ti, paintQ)) didChange = true;
  }
  if (!didChange) return false;
  recordBuildSpan(world, s, bestPartner, pathWalkLength(world, physicalTiles));
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
  // (Food no longer trades flat here — it flows up the settlement hierarchy in
  // foodHierarchy.js. This pass handles goods / luxuries / money only.)
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
  // Throttle the O(pairs) bilateral trade to every T.TRADE_STRIDE ticks at STRIDE×
  // volume (see tradeStride). On the skipped ticks _linkMoney / _moneyFlows keep
  // the last sweep's (complete) contents — at most STRIDE-1 ticks stale, which the
  // armies trade-peace read and the money overlay both tolerate.
  const tStride = tradeStride();
  if (world.step === 1 || world.step % tStride === 0) runTradePass(world, rf, flowTiles, tStride);
  // Quality evolution over the road set only:
  //   • busy tiles (flow ≥ ROAD_ABANDON_FLOW) pave further, faster the
  //     higher the flow (capped at FLOW_FOR_PAVE, ~5000 ticks to fully
  //     pave) — but only down to the floor the tile's polity has EARNED:
  //     traffic alone hard-packs a track (TRACK_FLOOR); the engineered
  //     surface below it (→ QUALITY_MAX) needs the owning realm to hold
  //     the Roads tech (see TRACK_FLOOR above). Emergent: when the realm
  //     discovers engineering, its busy corridors simply pave on.
  //   • abandoned tiles (flow below that floor) revert toward bare
  //     terrain and, once past ROAD_GONE, leave the road set so routing
  //     and component passes stop treating them as roads.
  const rq = world.roadQuality;
  const roadTiles = world._roadTiles;
  if (rq && rf && roadTiles) {
    const gone = [];
    const co = world._countryOwner;
    // Per-tick memo: countryId → the pave floor its engineers have earned
    // (capital's discovered techs). A handful of Map lookups per realm per
    // tick, cleared and refilled like the other per-tick caches.
    let paveMemo = world._paveMemo;
    if (paveMemo) paveMemo.clear(); else paveMemo = world._paveMemo = new Map();
    const floorFor = (cid) => {
      if (cid == null || cid < 0 || !world.countries) return TRACK_FLOOR;
      let v = paveMemo.get(cid);
      if (v === undefined) {
        const c = world.countries.get(cid);
        const cap = c && c.capital;
        const have = cap && techEff(cap).have;
        v = have && have[RAIL_TECH] ? QUALITY_MAX
          : have && have[ROADS_TECH] ? PAVED_FLOOR
          : TRACK_FLOOR;
        paveMemo.set(cid, v);
      }
      return v;
    };
    for (const ti of roadTiles) {
      const flow = rf[ti] || 0;
      if (flow >= ROAD_ABANDON_FLOW) {
        const floor = co ? floorFor(co[ti]) : TRACK_FLOOR;
        if (rq[ti] > floor) {
          const t = Math.min(1, flow / FLOW_FOR_PAVE);
          const next = rq[ti] - t * PAVE_RATE;
          rq[ti] = next < floor ? floor : next;
        }
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

// One bilateral-trade sweep standing in for `stride` ticks (see TRADE_STRIDE).
// Runs every pair once at stride× volume, so the average money / goods / road-
// flow matches the old every-tick pass; the per-pair NET is divided back down to
// a per-tick rate before it lands in _linkMoney / _moneyFlows, so the armies
// trade-peace read and the money overlay see the same magnitudes as before.
function runTradePass(world, rf, flowTiles, stride) {
  // The luxury budgets (set per-tick by computeLuxury) must cover `stride` ticks
  // now that this sweep stands in for that many — scale them up front so every
  // luxLeg, from either side, draws against the larger pool.
  const goodsTrade = T.GOODS_TRADE && T.GOODS_PRICES;
  if (stride !== 1 || goodsTrade) {
    for (const s of world.settlements) {
      if (s.mode !== "settled") continue;
      if (stride !== 1) {
        s._luxSupplyLeft = (s._luxSupplyLeft || 0) * stride;
        s._luxDemandLeft = (s._luxDemandLeft || 0) * stride;
      }
      // Stage 2 sweep budgets: what each settlement can EXPORT this sweep
      // (its surplus over own demand) and how much it will IMPORT (its
      // shortfall × GT_OVERBUY), per good — drawn down across partners like
      // the luxury budgets. _gNet rebuilds each sweep (≤ stride−1 ticks
      // stale between sweeps, the _linkMoney convention).
      if (goodsTrade && s._gProd && s._gDem) {
        let e = s._gExpLeft, im = s._gImpLeft, n = s._gNet;
        if (!e)  e  = s._gExpLeft = new Array(8).fill(0);
        if (!im) im = s._gImpLeft = new Array(8).fill(0);
        if (!n)  n  = s._gNet     = new Array(8).fill(0);
        for (let g = 0; g < 8; g++) { e[g] = 0; im[g] = 0; n[g] = 0; }
        for (const g of TRADABLE) {
          const surplus = (s._gProd[g] || 0) - (s._gDem[g] || 0);
          if (surplus > 0) e[g] = surplus * stride;
          else im[g] = -surplus * GT_OVERBUY * stride;
        }
        // Merchant stocks (T.GOODS_STOCKS): a MART also OFFERS what it holds
        // in its warehouses and BIDS for goods beyond its own needs, to the
        // extent it is an entrepôt — the Venice pattern: buy where cheap,
        // shelve, resell where dear. The price-gap gate still rules every
        // leg, so a hub only accumulates when it genuinely sits between a
        // cheap source and a dear sink. Stock stays OFF the local price
        // (warehoused for re-export, not dumped on the town market).
        if (T.GOODS_STOCKS > 0) {
          const es = entrepotShare(s);
          if (es > 0.05) {
            let st = s._gStock;
            if (!st) st = s._gStock = new Array(8).fill(0);
            const room = STOCK_CAP_W * es * Math.sqrt(Math.max(1, s.people || 0));
            for (const g of TRADABLE) {
              e[g] += st[g] * T.GOODS_STOCKS;                                   // offer the shelf
              const free = room - st[g];
              if (free > 0) im[g] += free * STOCK_BID_FRAC * T.GOODS_STOCKS;    // bid for re-export stock
            }
          }
        }
      }
    }
  }
  const usage = USAGE_PER_TRADE * stride;
  const invStride = 1 / stride;
  const moneyFlows = [];
  const linkMoney = new Map();   // "loId:hiId" -> net /tick that reached the higher-id settlement
  // The animated money-flow overlay (moneyFlows) is render-only and consumed ONLY
  // in the money view; skip the per-pair object churn unless that view is active
  // (the worker sets the flag from viewMode). _linkMoney is always built — armies.js
  // reads it for the trade-peace dampener, so it's a sim input, not just an overlay.
  const wantFlows = world._wantMoneyFlows !== false;
  for (const s of world.settlements) {
    if (s.mode !== "settled") continue;
    // Trade peers = the road network reach PLUS any sea-lane peers
    // (sea.js). Where both exist for a peer, take the cheaper link.
    const reach = mergeReach(s);
    if (!reach) continue;
    for (const [peerId, link] of reach) {
      if (peerId === s.id) continue;
      const peer = findById(world, peerId);
      if (!peer || peer.mode !== "settled") continue;
      // Process each unordered pair exactly once. Normally the lower-id member
      // runs it — but trade reach can be ASYMMETRIC (each settlement keeps only
      // its nearest MAX_PARTNERS, and "b is among a's nearest" does NOT imply
      // the reverse). So the lower id runs it, UNLESS the lower-id peer doesn't
      // list us back — then WE run it, so a one-way-listed link still trades
      // instead of being silently dropped (a peripheral breadbasket's grain
      // reaching a city used to hinge on arbitrary id ordering).
      if (peerId < s.id && reachHasPeer(peer, s.id)) continue;
      const sBefore = s.wealth || 0;
      const peerBefore = peer.wealth || 0;
      runGeneralTradeBetween(world, s, peer, link, stride);
      // Under GOODS_TRADE luxury rides the goods market (G_LUXURY flows with
      // the rest) — the separate overlay would double-count it.
      if (!goodsTrade) runLuxuryTradeBetween(world, s, peer);
      // Store under a canonical lo:hi key, oriented as "coin /tick that reached
      // the HIGHER-id settlement" (the convention getTradeProfile + the
      // money-flow overlay expect). Measure the HIGHER-id side's own wealth
      // delta directly: the pair is NOT zero-sum (tolls/brokerage/tariffs go
      // to third parties), so negating the lower side's delta booked those
      // third-party fees as coin that reached the higher settlement.
      const lo = s.id < peerId ? s.id : peerId, hi = s.id < peerId ? peerId : s.id;
      const hiDelta = (peerId === hi ? (peer.wealth || 0) - peerBefore : (s.wealth || 0) - sBefore) * invStride;
      linkMoney.set(lo + ":" + hi, hiDelta);
      // Overlay animation is oriented along link.tiles (s → peer): use the
      // PEER's own delta for direction/magnitude.
      const peerNet = ((peer.wealth || 0) - peerBefore) * invStride;
      // Land trade wears its road path (flow drives paving + thickness);
      // sea trade leaves no road, but both animate on the money overlay.
      if (link.tiles && link.tiles.length > 0) {
        // A tile only needs ADDING to the sparse flow-set when it was idle; a
        // busy trunk shared by many pairs (and across ticks) is already in the
        // set, so the cheap rf===0 test skips almost every redundant Set.add.
        if (!link.sea) { for (const ti of link.tiles) { if (rf[ti] === 0) flowTiles.add(ti); rf[ti] += usage; } }
        if (wantFlows && link.tiles.length > 1 && Math.abs(peerNet) > MONEY_FLOW_EPS) {
          moneyFlows.push({ tiles: link.tiles, mag: Math.abs(peerNet), toEnd: peerNet >= 0, sea: !!link.sea });
        }
      }
    }
  }
  world._moneyFlows = moneyFlows;
  world._linkMoney = linkMoney;
  // Merchant-stock reconcile (T.GOODS_STOCKS): after the sweep, what a mart
  // bought beyond its OWN shortfall goes on the shelf; what it sold beyond
  // its OWN surplus came off it. Own-need baselines recompute from prod/dem
  // (unchanged within a sweep — deterministic), so no extra arrays ride the
  // settlement. Spoilage + warehouse cost drain the shelf each sweep, so
  // stock is a working buffer, not a hoard.
  if (T.GOODS_TRADE && T.GOODS_PRICES && T.GOODS_STOCKS > 0) {
    for (const s of world.settlements) {
      if (s.mode !== "settled" || !s._gStock || !s._gExpLeft) continue;
      const st = s._gStock, e = s._gExpLeft, im = s._gImpLeft;
      const es = entrepotShare(s);
      const room = STOCK_CAP_W * es * Math.sqrt(Math.max(1, s.people || 0));
      const spoil = Math.pow(1 - STOCK_SPOIL, stride);
      for (const g of TRADABLE) {
        const baseE = Math.max(0, ((s._gProd && s._gProd[g]) || 0) - ((s._gDem && s._gDem[g]) || 0)) * stride;
        const baseIm = Math.max(0, ((s._gDem && s._gDem[g]) || 0) - ((s._gProd && s._gProd[g]) || 0)) * GT_OVERBUY * stride;
        const offered = baseE + st[g] * T.GOODS_STOCKS;
        const eUsed = offered - e[g];
        const soldFromStock = Math.max(0, eUsed - baseE);
        const bidTotal = baseIm + Math.max(0, room - st[g]) * STOCK_BID_FRAC * T.GOODS_STOCKS;
        const imUsed = bidTotal - im[g];
        const boughtForStock = Math.max(0, imUsed - baseIm);   // own need is filled first, the rest is shelved
        st[g] = Math.min(room, Math.max(0, (st[g] - soldFromStock + boughtForStock) * spoil));
      }
    }
  }
}
// Warehouse scale: a great mart (entrepôt share ~1, big market) shelves a
// few sweeps' worth of a strong flow; a river ford shelves nothing.
const STOCK_CAP_W   = 1.5;    // stock cap = W × entrepôtShare × √pop
const STOCK_BID_FRAC = 0.3;   // share of free shelf a mart bids for per sweep (works into position gradually)
const STOCK_SPOIL   = 0.002;  // per-tick spoilage + warehouse cost (a working buffer, not a hoard)

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

// (Food is no longer traded flat between pairs — it flows UP the settlement
// hierarchy in foodHierarchy.js, so a city is fed by its whole hinterland rather
// than its 12 nearest partners. This pass handles goods / luxuries / money only.)

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
// ── Goods trade (T.GOODS_TRADE — goods-vector Stage 2) ─────────────────────
// Replaces the symmetric both-sell-their-scalar flow with PER-GOOD flows
// down the price gradient: each shippable good moves from the side where it
// is locally CHEAP to the side where it is DEAR, in quantity bounded by the
// seller's surplus budget, the buyer's shortfall appetite, the pair's
// carrying capacity, and the buyer's purse. Money moves the other way
// through sellGoods — the same audited path (reserve, tolls, entrepôt
// brokerage, FX, tariffs, conservation) the scalar flow used. Imports and
// exports feed back into each side's local prices (goods.js reads _gNet),
// so prices RELAX TOWARD EQUALITY ACROSS THE NETWORK, up to transport cost —
// the spatial price gradient becomes self-flattening, which IS the trade
// system the spec pivots on. Hume's imposed compA/compB correction retires
// here: with real per-good prices, price-specie-flow EMERGES (a specie-rich,
// dear region imports more than it exports and bleeds coin) instead of
// being bolted on. buy ≠ sell by construction — a town imports what it is
// short of and exports what it is long on.
const GT_MIN_GAP  = 0.05;   // relative price gap below which a good doesn't move (arbitrage won't pay)
const GT_GAP_CAP  = 2.0;    // flow-driving gap factor cap (a 3×+ gap ships no faster than 3× — carrying capacity binds first)
const GT_FLOW_FRAC = 0.25;  // fraction of the seller's remaining surplus budget one route can take per unit gap (≈12 partners: a few strong-gap routes drain the budget, weak gaps nibble)
const GT_OVERBUY  = 1.5;    // a buyer imports at most this multiple of its own shortfall (merchants overbuy a little; no bottomless hoards without re-export modelling)
// Money channels per good index (book the crate on its own channel). Every
// craft rides its OWN income channel (money.js IN_ORE..IN_WARES) — with four
// crafts lumped into IN_GOODS the income-ranking taxonomy was near-empty and
// any thin channel (the slave trade) ranked top-3 by default (diagnosis §3).
// The buy side stays bundled as generic imports: the visibility problem is
// what a town LIVES ON, not what it shops for.
const GT_BOOK_IN  = { [G_MATERIALS]: IN_MATERIALS,  [G_LUXURY]: IN_LUXURY,
                      [G_ORE]: IN_ORE, [G_METAL]: IN_METAL, [G_CLOTH]: IN_CLOTH, [G_WARES]: IN_WARES };
const GT_BOOK_OUT = { [G_MATERIALS]: OUT_MATERIALS, [G_LUXURY]: OUT_LUXURY };
// VALUE-TO-WEIGHT (T.GOODS_FREIGHT — von Thünen): freight a coin's worth of
// each good incurs, relative to the average consignment. Pre-modern freight
// economics: stone and ore all but never moved overland (they doubled in
// price within a cart-day), grain not much farther, metalware and pottery
// traded regionally, cloth crossed kingdoms, and spice/silk crossed the
// world with freight a rounding error on their value. The ship-worthiness
// check in sellGoods (value must exceed freight+tolls) then KILLS distant
// bulk trades while letting the light-and-dear run far — trade range per
// good becomes an OUTPUT of value density × route cost, never a rule.
const GT_BULK = { [G_MATERIALS]: 2.5, [G_ORE]: 3.0, [G_METAL]: 1.0, [G_CLOTH]: 0.5, [G_WARES]: 1.0, [G_LUXURY]: 0.15 };
function runGoodsTradeBetween(world, a, b, link, stride, vol, transport, intermediates, numInter) {
  // Pair carrying capacity in VALUE — the scalar model's own gravity volume
  // (√pop × rate × sea/river carrier terms), so gross trade magnitude stays
  // on the calibrated scale; what changes is the CONTENTS of the flow.
  let valueLeft = vol * (exportValueOf(a, world) + exportValueOf(b, world)) * 0.5;
  if (valueLeft <= 0) return;
  const Pa = a._gPrice, Pb = b._gPrice;
  // Ship the widest gaps first — when carrying capacity binds, the trades
  // most worth making happen (sorted, so deterministic).
  const order = [];
  for (const g of TRADABLE) {
    const gap = Math.abs(Pa[g] - Pb[g]) / Math.min(Pa[g], Pb[g]);
    if (gap >= GT_MIN_GAP) order.push([g, gap]);
  }
  if (order.length === 0) return;
  order.sort((x, y) => y[1] - x[1] || x[0] - y[0]);
  // Pair freight allocates against the INITIAL carrying budget — a fixed
  // denominator, so the legs' shares sum to ≤ 1 and the pair's total freight
  // = transport × the cargo mix's value-weighted bulkiness (exactly the
  // physics: same value in ore = more tonnage = more carriage). The first
  // cut divided by the SHRINKING remaining budget and tracked an exhaustible
  // freight pool: legs compounded to ~1.8-3× the physical cost, the pool
  // went negative, and every later consignment shipped FREE — silently
  // bypassing the ship-worthiness check the von Thünen mechanism depends on
  // (caught by the 2026-07 adversarial pre-merge review).
  const freightTotal = transport;
  const valueBudget0 = valueLeft;
  for (const [g, gap] of order) {
    if (valueLeft <= 0.001) break;
    const aSells = Pa[g] < Pb[g];
    const seller = aSells ? a : b, buyer = aSells ? b : a;
    const exp = seller._gExpLeft, imp = buyer._gImpLeft;
    if (!exp || !imp) continue;
    const gapF = Math.min(GT_GAP_CAP, gap);
    // Quantity: seller's remaining surplus × how hard the gap pulls, capped
    // by the buyer's remaining shortfall appetite.
    let qty = Math.min(exp[g] * Math.min(1, GT_FLOW_FRAC * gapF), imp[g]);
    if (qty <= 0.0001) continue;
    // Clearing price: the midpoint — both sides gain vs their local price
    // (the gains from trade). T.GOODS_VALUE_UNIT converts the goods' own
    // quantity scale to COIN (the F8 unit calibration): a pure unit factor
    // on value — quantities, budgets, prices and every ratio untouched.
    // (Scaling the DEMAND constants instead was measured wrong: it shrinks
    // exportable surpluses — towns eat their own production — so goods-sold
    // income FELL as the scale rose. Units belong on the value line.)
    const pMid = (Pa[g] + Pb[g]) * 0.5 * (T.GOODS_VALUE_UNIT || 1);
    let value = qty * pMid;
    if (value > valueLeft) { value = valueLeft; qty = value / pMid; }
    // Freight ∝ share of the pair's INITIAL value budget — scaled by the
    // good's value density under T.GOODS_FREIGHT (lever 0 = flat, 1 = full
    // bulk differentiation; ore pays 3×, silk a fifteenth).
    const bulkMul = T.GOODS_FREIGHT > 0 ? 1 + T.GOODS_FREIGHT * ((GT_BULK[g] || 1) - 1) : 1;
    const freight = freightTotal * (value / (valueBudget0 + EPS_V)) * bulkMul;
    const scale = sellGoods(world, seller, buyer, value * fxRate(world, buyer, seller), freight, intermediates, numInter,
      GT_BOOK_IN[g] !== undefined ? GT_BOOK_IN[g] : IN_GOODS,
      GT_BOOK_OUT[g] !== undefined ? GT_BOOK_OUT[g] : OUT_GOODS) || 0;
    if (scale <= 0) continue;
    const moved = qty * scale;
    exp[g] -= moved; imp[g] -= moved;
    valueLeft -= value * scale;
    // Per-tick net-goods bookkeeping → next tick's local prices (goods.js).
    const perTick = moved / stride;
    const nS = seller._gNet, nB = buyer._gNet;
    if (nS) nS[g] -= perTick;
    if (nB) nB[g] += perTick;
  }
}
const EPS_V = 0.001;

function runGeneralTradeBetween(world, a, b, link, stride = 1) {
  const minPop = Math.min(a.people, b.people);
  // stride× volume + freight: this sweep stands in for `stride` ticks, so it
  // moves that many ticks' worth of goods (and pays that much freight), keeping
  // the average flow identical to the old every-tick pass.
  // Maritime trade moved BULK far cheaper than ox-carts, so a sea lane carries
  // several times the volume of the same overland link (T.SEA_TRADE_MULT) — the
  // reason the great trading powers were ports. Without it ocean routes carried
  // ~4% of all money flow. (Mirrors the grain trade's FOOD_HAUL_WATER bonus.)
  // Ship TECH multiplies it further (caravels → steamships): historically the
  // sea's share of trade ROSE with era — by 1900 intercontinental trade was
  // effectively all seaborne — but with a flat multiplier the share stayed
  // ~20-28% from medieval to modern (land roads kept pace). seaSpeed is the
  // throughput proxy; the better-shipped endpoint sets the carrier.
  const shipTech = link.sea
    ? Math.max((a._techEff && a._techEff.seaSpeed) || 0, (b._techEff && b._techEff.seaSpeed) || 0) : 0;
  const vol = Math.sqrt(minPop) * T.TRADE_RATE * stride * (world._dt || 1)   // granularity: finer trade per tick
    * (link.sea ? T.SEA_TRADE_MULT * (1 + SEA_TECH_VOL * shipTech) : link.river ? T.RIVER_TRADE_MULT : 1);
  // Freight is paid per REAL distance, not per tile: link.cost is a cumulative
  // per-tile path cost, so the same real route reads ×rNormPop on a finer grid —
  // uncorrected, fine-grid trade paid double freight (tw=480) and city wealth
  // starved (part of the development-clock res-variance, audit OPEN #5b). ÷1
  // exactly at the 240-tile reference.
  const transport = link.cost / rNormPop(world) * TRANSPORT_PER_PATHCOST * stride;
  const intermediates = link.inter || null;          // precomputed at reach build
  const numInter = intermediates ? intermediates.length : 0;
  // Stage 2 (T.GOODS_TRADE): per-good flows down the price gradient replace
  // the symmetric scalar exchange below. Same gravity volume (carrying
  // capacity), same freight, same sellGoods plumbing; a pair where a side
  // has no goods vector yet (first tick of a fresh settlement) trades the
  // scalar way this sweep. Hume compA/compB and demandMul retire on this
  // path — the per-good prices ARE the balance mechanism now.
  if (T.GOODS_TRADE && T.GOODS_PRICES && a._gPrice && b._gPrice) {
    runGoodsTradeBetween(world, a, b, link, stride, vol, transport, intermediates, numInter);
    return;
  }
  // HUME price-specie-flow (Currency Phase 2): a region's export COMPETITIVENESS
  // scales with how cheap it is vs its trade partner. A specie-rich region has a
  // high price level (localP), so its goods are dear — it exports LESS and (as
  // the partner's cheap goods undersell it) imports MORE, bleeding specie until
  // its prices fall back. The scaling is RECIPROCAL (compA·compB = 1) and then
  // NORMALISED to compA + compB = 2, so it shifts the trade BALANCE without changing
  // total volume: specie self-distributes across regions and none hoards unboundedly.
  // (Self-correcting, so
  // it bounds the price-level spread rather than expanding the money supply —
  // which is why it doesn't need the inflation-neutrality work.)
  let compA = 1, compB = 1;
  if (T.HUME_ELASTICITY > 0) {
    const Pa = localP(world, a), Pb = localP(world, b);
    if (Pa > 0 && Pb > 0 && Pa !== Pb) {
      compA = Math.pow(Pb / Pa, T.HUME_ELASTICITY); compB = 1 / compA;
      // The raw reciprocal legs are summed into gross flow (evA·compA + evB·compB), and
      // (x + 1/x)/2 >= 1, so a price gap systematically INFLATED total trade. Rescale so
      // compA + compB = 2: the ratio (the balance shift) is preserved and the AVERAGE
      // scaling is exactly 1, removing that bias. (Exactly volume-neutral for equal legs;
      // for asymmetric flows a small SECOND-ORDER term remains — but signed, not the old
      // one-way inflation.) (B14)
      const norm = (compA + compB) / 2;
      compA /= norm; compB /= norm;
    }
  }
  // FX / exchange rate (Currency Phase 4): on a FOREIGN purchase the buyer pays
  // the exchange rate = seller's currency ÷ buyer's (their fineness ratio). A
  // debased (weak-currency) buyer pays DEARER for imports and so affords fewer,
  // while a strong-currency realm's coin buys more abroad; the premium is a
  // conserved transfer to the seller (strong currencies profit from the exchange
  // trade). Gently capped so debasement bites without a death-spiral. This is the
  // proper exchange-rate version of the Phase-3 crude foreign-trade penalty.
  // A's goods to B (buyer B), then B's to A (buyer A).
  sellGoods(world, a, b, exportValueOf(a, world) * vol * demandMul(b) * compA * fxRate(world, b, a), transport * 0.5, intermediates, numInter);
  sellGoods(world, b, a, exportValueOf(b, world) * vol * demandMul(a) * compB * fxRate(world, a, b), transport * 0.5, intermediates, numInter);
}

// Exchange rate applied to a foreign purchase: seller's-currency ÷ buyer's
// (fineness ratio), so a weak-currency buyer pays more per unit. 1 for domestic
// trade; gently capped to [0.8, 1.3] so a debased realm's terms of trade worsen
// without spiralling. Reads fineness directly (no gov creation for stateless).
function fxRate(world, buyer, seller) {
  if (buyer.countryId === seller.countryId || !world.polities) return 1;
  const gb = getPolity(world, buyer.countryId), gs = getPolity(world, seller.countryId);
  const fb = gb && gb.fineness !== undefined ? gb.fineness : 1;
  const fs = gs && gs.fineness !== undefined ? gs.fineness : 1;
  if (fb === fs) return 1;
  const r = fs / fb;
  return r < 0.8 ? 0.8 : r > 1.3 ? 1.3 : r;
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
// Returns the SCALE actually applied (0 when nothing shipped, 1 when the
// buyer could afford the full consignment) so the goods-trade pass
// (T.GOODS_TRADE) can book the real quantity moved. Optional bookIn/bookOut
// override the seller-mix booking split with an explicit channel pair — the
// per-good path knows exactly what's in the crate; the scalar path (both
// omitted) books by the seller's export fractions exactly as before.
// Optional meterTicks (> 1): a SLOW-CADENCE caller (the slave market's
// ~50-tick pass) meters every provenance booking of this sale over the ticks
// the pass stands for (money.js recordInMetered — the Tier-A honest-rate
// contract), so a lumped consignment reads as the steady flow it represents.
// Coin still moves at once; only the display ledger is metered. Default 0 =
// the per-tick recordIn path, byte-identical.
function sellGoods(world, seller, buyer, goodsValue, freight, intermediates, numInter, bookIn, bookOut, meterTicks = 0) {
  if (goodsValue <= 0) return 0;
  const bookI = meterTicks > 1 ? (t, cat, amt) => recordInMetered(t, cat, amt, meterTicks) : recordIn;
  const bookO = meterTicks > 1 ? (t, cat, amt) => recordOutMetered(t, cat, amt, meterTicks) : recordOut;
  // Each intermediate's toll scales with how much of a CROSSING it controls
  // (waterAccess — a ford, bridge, strait or port that trade must funnel through).
  let tollSum = 0, brokerSum = 0;
  // Intermediates are object references captured when trade reach was built
  // (a ~120-tick stagger) — a hub that died since then can neither charge nor
  // collect (paying a dead record leaked coin out of the closed supply).
  // Liveness is checked inline: sellGoods runs per trading pair on the hot
  // path, so no per-sale array allocation.
  if (intermediates) for (const inter of intermediates) {
    if (inter.mode !== "settled") continue;
    tollSum += 1 + TOLL_CHOKE_W * Math.min(1, inter.waterAccess || 0);   // chokepoint transit toll
    brokerSum += entrepotShare(inter);                                    // market re-export brokerage (0..1 per hub)
  }
  const totalToll = goodsValue * TOLL_RATE * tollSum;
  // CARRYING TRADE (entrepôt): a re-export MARGIN on the goods' value charged by the
  // great market hubs they pass through — the brokerage that made Venice and Amsterdam
  // rich on goods they never produced. Paid by the buyer (goods routed through a mart
  // cost more — conserved), captured by the hubs in proportion to how much of an
  // entrepôt each is (port access × market size). Distinct from the flat transit toll.
  const totalBroker = goodsValue * T.ENTREPOT_W * brokerSum;
  const collector = customsCollector(world, seller, buyer);
  const tariff = collector ? goodsValue * T.TARIFF_RATE : 0;
  // Don't ship goods worth less than the cost to move + clear them.
  if (goodsValue <= freight + totalToll + totalBroker + tariff) return 0;
  const want = goodsValue + freight + totalToll + totalBroker + tariff;
  const reserve = getWealthReserve(buyer);
  const available = Math.max(0, (buyer.wealth || 0) - reserve);
  if (available <= 0) return 0;
  const actual = available < want ? available : want;
  const scale = actual / want;
  buyer.wealth -= actual;
  const paid = goodsValue * scale;
  seller.wealth = (seller.wealth || 0) + paid;
  // FREIGHT is the carrier's fee, NOT money burned (Phase 1): credit it to the
  // seller's shipping/merchant sector (the "carrying trade" that enriched ports)
  // so the closed specie supply is conserved. The supply is instead regulated by
  // the realistic COIN_LOSS_RATE drain + depleting mines, not this burn.
  const freightPaid = freight * scale;
  if (freightPaid > 0) seller.wealth += freightPaid;   // carrier fee (the seller's own shipping)
  // Book the trade by SECTOR (computeExportValue split the seller's exports into
  // food / raw materials / manufactured goods). A Farming Region reads as a
  // farmer selling grain & livestock, a town as a workshop selling crafts.
  // CRUCIALLY the FOOD leg is booked only when the BUYER is actually food-short
  // (supply < demand): a self-feeding settlement does not IMPORT food — its
  // grain comes up the central-place HIERARCHY (foodHierarchy.js), not the
  // horizontal gravity trade — so that fraction is re-booked as ordinary goods.
  // This is what stops every town/city/region from both buying AND selling food.
  // The FOOD leg books as agrarian income when the buyer is food-short OR the
  // SELLER is a farming region (its surplus genuinely IS food/agrarian produce —
  // grain, livestock, wine, wool — so the countryside reads as a grain seller, not
  // a generic goods vendor). A town (export-food-fraction ≈ 0) still books goods
  // either way, so this can't make a workshop read as a farmer.
  // A seller reads as an agrarian/grain producer when EITHER it's a low-tier farm
  // region (legacy model) OR — the part that matters under DISSOLVE_FARMS — its own
  // export mix is genuinely food-dominated (a breadbasket whose output is mostly
  // grain, even after it grows past tier 0). Without the second clause every grown
  // farm town is mislabelled a goods-merchant and the whole map reads as "goods sold".
  if (bookIn !== undefined) {
    // Per-good booking (T.GOODS_TRADE): the crate's contents are known —
    // book the whole consignment on its own channel, freight to the
    // seller's shipping income as ever.
    bookI(seller, bookIn, paid);
    if (freightPaid > 0) bookI(seller, IN_GOODS, freightPaid);
    bookO(buyer, bookOut, paid);
  } else {
    const sellerFarm = (seller.tier | 0) <= (T.FARM_MAX_TIER | 0)
                     || (seller._exportFoodFrac || 0) >= T.FOOD_SELLER_FRAC;
    const buyerShort = (buyer._foodSupply || 0) < (buyer._foodDemand || 0);
    const foodFrac = (buyerShort || sellerFarm) ? (seller._exportFoodFrac || 0) : 0;
    const matFrac  = seller._exportMatFrac || 0;
    const foodPaid = paid * foodFrac;
    const matPaid  = paid * matFrac;
    const goodsPaid = paid - foodPaid - matPaid;
    bookI(seller, IN_FOOD, foodPaid);
    bookI(seller, IN_MATERIALS, matPaid);
    bookI(seller, IN_GOODS, goodsPaid + freightPaid);   // goods sold + the seller's own shipping fee
    bookO(buyer, OUT_FOOD, foodPaid);
    bookO(buyer, OUT_MATERIALS, matPaid);
    bookO(buyer, OUT_GOODS, goodsPaid);
  }
  bookO(buyer, OUT_TOLLS, (freight + totalToll + totalBroker) * scale);
  if (intermediates) {
    for (const inter of intermediates) {
      if (inter.mode !== "settled") continue;
      const tollPer = goodsValue * TOLL_RATE * (1 + TOLL_CHOKE_W * Math.min(1, inter.waterAccess || 0)) * scale;
      inter.wealth = (inter.wealth || 0) + tollPer; bookI(inter, IN_TOLLS, tollPer);
      // Re-export brokerage: the great market hubs (high entrepôt share) capture a
      // margin on the goods' value — a coastal mart on a busy route reads as a
      // carrying-trade hub, a backwater ford as a mere toll post.
      const brokerPer = goodsValue * T.ENTREPOT_W * entrepotShare(inter) * scale;
      if (brokerPer > 0) { inter.wealth += brokerPer; bookI(inter, IN_CARRY, brokerPer); }
    }
  }
  // Customs duty funds the importing realm's STATE TREASURY (not the capital
  // city's purse) — the government then redistributes it (conquest.js).
  if (collector) { govOf(world, buyer.countryId).treasury += tariff * scale; bookO(buyer, OUT_TARIFFS, tariff * scale); }
  // Conservation: buyer loses `actual` = goodsValue*scale + freight*scale (both
  // to the SELLER — goods price + carrying fee) + totalToll*scale (to the
  // intermediates) + tariff*scale (to the state). Nothing is burned in trade; the
  // money supply is regulated by COIN_LOSS_RATE + depleting mines instead.
  return scale;
}

// ── Helpers ────────────────────────────────────────────────────────
// Combined trade reach for a settlement: its road-network peers plus any
// sea-lane peers (sea.js, on s._seaReach). Returns the road map directly
// when there's no sea reach (the common case — only ports sail), so we
// only allocate a merged map for actual ports.
export function mergeReach(s) {
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

// Does settlement `p` list `id` among its trade peers (road OR sea reach)?
// Used by the trade pass to dedupe each unordered pair exactly once even when
// the nearest-K reach is asymmetric (see updateTrade).
function reachHasPeer(p, id) {
  return !!((p._tradeReach && p._tradeReach.has(id)) || (p._seaReach && p._seaReach.has(id)));
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
// ── Static land-connectivity oracle for the noWater A* ──────────────────────
// findPath(noWater) can only ever reach tiles in the START tile's 8-neighbour
// land component (x wraps, y clamps — exactly the A*'s own neighbour rule):
// water destinations are skipped outright and land/river edge costs are always
// finite, so noWater reachability is pure geometry. Elevation never changes
// after worldgen, so ONE flood fill per world answers "is there any land route
// at all?" in O(1) — where the A* burned its whole node budget (≤12000·rn²,
// 192k heap pops at the 1920 default) re-proving the same permanent geographic
// NO for the same island↔mainland pair every plan cycle: candidate peers are
// offered by EUCLIDEAN radius (partnerReachFor / the close-neighbour scan via
// forEachNear), so strait and island pairs are ranked forever. Measured on the
// 30k-step 1920 snapshot (600 ticks): 28/495 calls were topological fails at
// ~33 ms each — a fifth of all findPath time — and the whole labelling floods
// once in 8 ms (numbers in the commit / roadmap W6-G item 4).
// Distinct from countryClaim.js's _landComp, which is 4-NEIGHBOUR (the claim
// crawl's connectivity): a diagonal isthmus joins components for the A* that
// the crawl correctly splits, so reusing that map would wrongly null real
// routes. Derived scratch — never persisted, never hashed; rebuilt lazily
// after load.
function landComp8(world) {
  let lc = world._landComp8;
  if (lc && lc.length === world.N) return lc;
  const { N, tw, th, elev } = world;
  lc = world._landComp8 = new Int32Array(N).fill(-1);
  const stack = new Int32Array(N);
  for (let seed = 0; seed < N; seed++) {
    if (lc[seed] >= 0 || elev[seed] <= 0) continue;
    let top = 0;
    stack[top++] = seed; lc[seed] = seed;
    while (top > 0) {
      const ti = stack[--top];
      const ty = (ti / tw) | 0, tx = ti - ty * tw;
      const xm = tx === 0 ? tw - 1 : tx - 1;
      const xp = tx === tw - 1 ? 0 : tx + 1;
      const yu = ty - 1, yd = ty + 1;
      const ns = [
        ty * tw + xm, ty * tw + xp,
        yu >= 0 ? yu * tw + tx : -1, yd < th ? yd * tw + tx : -1,
        yu >= 0 ? yu * tw + xm : -1, yu >= 0 ? yu * tw + xp : -1,
        yd < th ? yd * tw + xm : -1, yd < th ? yd * tw + xp : -1,
      ];
      for (let k = 0; k < 8; k++) {
        const ni = ns[k];
        if (ni < 0 || elev[ni] <= 0 || lc[ni] >= 0) continue;
        lc[ni] = seed; stack[top++] = ni;
      }
    }
  }
  return lc;
}
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
  // A noWater route between different 8-neighbour land components is a
  // PERMANENT geographic no — answer it in O(1) instead of re-burning the
  // node budget proving it every plan cycle. Byte-identical skip: the search
  // below provably returns null for an off-component goal (noWater skips
  // every water tile and land edges are always finite, so the goal can never
  // be stamped — it exits via the visit limit or heap exhaustion either way);
  // only the unhashed scratch (_fpG/_fpSeen/_fpStamp) would have differed.
  if (noWater) {
    const lc = landComp8(world);
    if (lc[start] !== lc[goal]) return null;
  }
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
  // Node budget bounds a REAL search area (the dHint² term self-scales — dHint
  // is in raw tiles — but the floor and the hard cap don't): ×rNormPop² keeps
  // the longest buildable road a constant REAL length at any grid (raw, the cap
  // halved it at tw=480; audit OPEN #5b). ×1 exactly at the reference.
  const _rr = rNormPop(world) ** 2;
  const limit = Math.min(12000 * _rr, 1500 * _rr + ((dHint*dHint*6)|0));
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

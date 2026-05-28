// Settlement: a permanent community at a fixed location. Single icon
// (pop-scaled) with a patch of farmland painted on the most fertile
// tiles within reach. No bands, no individual buildings — the
// settlement is the atomic visible unit.
//
// New settlements come from the crystallization sweep (crystallize.js),
// which scatters them across viable sites and lets them inherit
// knowledge from their nearest neighbour weighted by transport
// distance. There is no settlement cap — the world fills with
// settlements wherever there is room (MIN_SETT_DIST spacing) and
// enough fertile land to support them.

import { localEdgeCost } from "./transport.js";

let _nextId = 1;
export function resetSettlementIds() { _nextId = 1; }

const TIER_THRESHOLD = [0, 80, 400, 2000];
const TIER_NAME      = ["village", "town", "city", "metropolis"];

// Pop growth slowed from 0.0045 → 0.0018 so settlements visibly take
// many in-game years to grow from village to city. With 0.0018, a
// village at 20 ppl reaches K=470 (city tier) in ~2000 ticks rather
// than ~700.
const SETT_GROWTH = 0.0018;

// Farmland model:
//   farmland tile yields = world.fert[tile] × FARM_YIELD_PER_FERT
//                          × (1 + ag × 1.2)  per tick
// Forage model:
//   forage area food = forageArea × FORAGE_RATE
//                      × (1 + foraging × 0.5)  per tick
// Population K is derived ENTIRELY from food production (local +
// imports). No artificial fudge factors — pop is what food can
// support, full stop.
//   K = (supply + imported supply) / demand_per_capita
// where demand_per_capita = 0.003 food/person/tick.
const K_MIN_VIABLE = 8;                    // bare-survival floor (matches the wither cull threshold)
// ~1 farm tile feeds ~16 people (yield 0.055/fert × ag-mature 2.2 / demand 0.003).
const FARM_TARGET_PEOPLE_PER_TILE = 16;
// Farmland is sized by a per-tier CATCHMENT — how much countryside the
// settlement commands — NOT by population, so food output is set by LAND,
// not people. Together with the housing cap below this is what lets a
// fertile rural settlement grow far more food than its (housing-limited)
// population eats and export the surplus, while a dense city on limited
// land runs a deficit and must import. The flood-fill takes the best
// plantable tiles within transport reach up to this count, so poor
// terrain still yields a smaller patch than the cap.
const CATCHMENT_BY_TIER = [10, 28, 80, 200];   // village → metropolis

// ── Housing population cap: FOOD, BUILDINGS, and SPACE ──
// Population grows to min(food capacity, housing). Housing is purely
// physical now:
//   SPACE        — buildable land around the site (water and high
//                  mountains don't count) × density. Density rises with
//                  construction knowledge (huts → dense multi-storey),
//                  so better building tech fits more people on the same
//                  ground. This is the hard ceiling: a settlement boxed
//                  in by sea/mountains stays small no matter how rich.
//   BUILDINGS    — to actually occupy that space you must BUILD, which
//                  needs construction materials (timber + stone, local or
//                  bought from trade partners) and labour. Until built,
//                  housing sits at HOUSING_BASE. See updateDevelopment.
// Economy / water / organization no longer magically house people — they
// matter only insofar as they bring food, materials, and the coin to buy
// them.
const HOUSING_BASE        = 45;     // starting shelter before anything is built
const SPACE_RADIUS        = 14;     // urban-footprint radius for the buildable-land scan
const DENSITY_BASE        = 6;      // people per buildable tile at zero construction
const DENSITY_PER_CONSTR  = 5;      // extra people/tile per point of construction knowledge
// Development: build housing up toward the space ceiling. Needs materials
// (timber/stone — own, or bought from suppliers with coin) and labour;
// rate-limited by construction tech + population. Coin paid for imported
// materials is TRANSFERRED to the supplying partners, not destroyed.
const INFRA_COST          = 80;     // coin per +1 housing of (imported) materials + labour
const BUILD_RATE          = 0.015;  // housing/tick per construction-weighted builder
const FARM_YIELD_PER_FERT    = 0.055;
// Forage rate calibrated so a forage-only village in a modest 5×5
// neighbourhood (avg fert ~0.4) reaches equilibrium pop ~70. Bumped
// from 0.012 so K from forageArea isn't bottlenecked by food supply
// — without this, K could be 80 but demand starved pop down to ~25.
// Farming (yield 0.055/fert) is still ~3× more efficient per
// fert-unit, so fertile valleys still dominate by orders of magnitude.
const FORAGE_RATE            = 0.018;
// Fish: per-tick food a water settlement lands. fishYield = FISH_RATE ×
// waterAccess × (0.3 + navigation×1.2). A great-river port with a
// deep-sea fleet (wa≈0.9, nav≈0.8) nets ~12/tk — comparable to a big
// farmland patch — so maritime cities can feed themselves; a landlocked
// site gets nothing.
const FISH_RATE              = 11.0;
// Farm placement is bounded by transport COST, not Euclidean distance.
// Reach is computed by a small Dijkstra from the settlement using the
// same terrain weights as transport.js — plains 1, hills ×2, mountains
// ×5, cold ×3, desert ×2.5, rivers ×0.4, coasts ×0.7. Effect:
// settlements in a river valley reach far along the river (cheap),
// settlements walled in by mountains reach only adjacent tiles. The
// cap below is in accumulated tile-cost units, not tiles.
const MAX_TRANSPORT_BY_TIER = [7, 14, 26, 40];    // village → metropolis
// Reach cache refresh interval — picks up slow knowledge drift within
// a tier (mature metropolis still benefits from its tech maturing from
// ~0.7 to ~0.99 over thousands of ticks).
const REACH_REFRESH_TICKS = 2000;
// Minimum soil fertility for a tile to be plantable. Below this, the
// land yields too little to be worth cultivating — it's left wild,
// regardless of pop pressure. This is what stops every settlement
// from filling its full range cap: in mediocre terrain, only a few
// tiles clear the bar, the soil-yield → carrying-capacity → tile-
// target feedback loop settles at a small footprint, and the
// settlement stays a hamlet. In a lush basin most tiles clear the bar
// and the settlement grows huge. Result: terrain-driven size variation
// instead of every settlement converging on the same disc.
//
// Threshold scales with agriculture knowledge — heavy plough, drainage,
// fertiliser, etc. progressively open up marginal soils:
//   ag 0.00  → floor 0.60  (foraging only — must be very lush)
//   ag 0.50  → floor 0.45  (neolithic baseline)
//   ag 1.00  → floor 0.30  (industrial — most land plantable)
const MIN_PLANTABLE_FERT_BASE  = 0.60;
const MIN_PLANTABLE_FERT_SLOPE = 0.30;
const FARMLAND_REFRESH_INTERVAL = 32;

export function makeSettlement(world, x, y, opts = {}) {
  const s = {
    id: _nextId++,
    kind: "settlement",
    pos: { x: Math.floor(x) + 0.5, y: Math.floor(y) + 0.5 },
    foundedStep: world.step,
    parentSettlementId: opts.parentId ?? -1,
    name: opts.name || `settlement-${_nextId - 1}`,
    people: opts.people ?? 25,
    // Start at the tier-0 storage cap (see storageCap in updateFood);
    // a larger value would just be clamped away on the first tick.
    food: 80,
    knowledge: opts.knowledge || {
      foraging:    0.5,
      toolmaking:  0.2,
      agriculture: 0.50,        // cradle starts already farming
      construction: 0.1,
      organization: 0.1,
      metallurgy:  0,           // gated by ore access
      navigation:  0,           // gated by water access
      mobility:    0,           // gated by horses
      literacy:    0,           // gated by organization + population
    },
    // Maximum local deposit richness within transport reach, per
    // resource id. Populated by scanLocalResources alongside the
    // farmland refresh; used by updateKnowledge to gate tech growth.
    // A road connection also merges the peer's localRes via max(),
    // so a settlement effectively "sees" the resources of any town
    // it trades with.
    localRes: {},
    // Cached water-access score (coast + river magnitude at home
    // tile). Set on creation, doesn't change.
    waterAccess: 0,
    // Buildable land within the urban footprint (the SPACE ceiling).
    // Cached on creation; terrain doesn't change.
    _buildableArea: 0,
    // Built infrastructure (housing built with materials + labour via
    // updateDevelopment). Persists; adds to housing capacity up to space.
    infrastructure: 0,
    // Coin. Starts at ZERO — the world runs on barter. Money only comes
    // into being once it is mined out of the ground (updateWealth), and
    // from there it spreads through trade, replacing barter wherever it
    // reaches.
    wealth: 0,
    // Cached shortest road-network paths to all reachable
    // settlements. { peerId → { cost, tiles } }. Populated by
    // rebuildTradeReach in roads.js on each plan cycle.
    _tradeReach: null,
    farmland: new Set(),
    tier: 0,
    mode: "settled",
    lastFarmRefresh: world.step,
    lastFoundAttempt: world.step,
    history: [{ step: world.step, type: "founded", parent: opts.parentId ?? -1, pos: { x, y } }],
  };
  // Migrate older knowledge objects (e.g. crystallization inheritance)
  // that don't have the new fields.
  for (const k of ["metallurgy","navigation","mobility","literacy"]) {
    if (s.knowledge[k] === undefined) s.knowledge[k] = 0;
  }
  // Compute water access score from the home tile + 4 neighbours.
  s.waterAccess = computeWaterAccess(world, x | 0, y | 0);
  s._buildableArea = computeBuildableArea(world, x | 0, y | 0);
  world.settlements.push(s);
  refreshFarmland(world, s);
  scanLocalResources(world, s);
  return s;
}

// Water-access score: 0 (landlocked, no river) to ~1 (coastal city
// on a great river). Coast contributes 0.5; river magnitude scales
// linearly: mag 1 → 0.2, mag 3 → 0.6, mag 4 → 0.8. Capped at 1.
function computeWaterAccess(world, sx, sy) {
  const { tw, th, coast, riverMag } = world;
  let coastBit = 0, bestMag = 0;
  for (let dy = -1; dy <= 1; dy++) {
    const ny = sy + dy;
    if (ny < 0 || ny >= th) continue;
    for (let dx = -1; dx <= 1; dx++) {
      const nx = ((sx + dx) % tw + tw) % tw;
      const ni = ny * tw + nx;
      if (coast[ni]) coastBit = 1;
      if (riverMag) {
        const m = riverMag[ni] || 0;
        if (m > bestMag) bestMag = m;
      }
    }
  }
  return Math.min(1, coastBit * 0.5 + bestMag * 0.2);
}

// Scan the settlement's LOCAL territory — a box that grows modestly with
// tier — for resource access. Deliberately NOT the full transport reach
// (which spans thousands of tiles and would hand every settlement every
// resource, erasing regional tech cultures). A settlement only "has" what
// is near it; distant resources reach it through TRADE — effectiveLocalRes
// merges road-connected peers' localRes, so a copper-poor town on a road
// to a copper-rich one still gains the access (and, with knowledge
// diffusion, the technique to use it).
const RES_RADIUS_BY_TIER = [4, 7, 10, 13];   // village → metropolis (box half-width)
function scanLocalResources(world, s) {
  const deposits = world.deposits;
  if (!deposits) return;
  const keys = Object.keys(deposits);
  if (keys.length === 0) return;
  const { tw, th } = world;
  const sx = s.pos.x | 0, sy = s.pos.y | 0;
  const R = RES_RADIUS_BY_TIER[s.tier] || RES_RADIUS_BY_TIER[0];
  const maxOut = {};
  for (const k of keys) maxOut[k] = 0;
  const minable = [];
  for (let dy = -R; dy <= R; dy++) {
    const ny = sy + dy;
    if (ny < 0 || ny >= th) continue;
    for (let dx = -R; dx <= R; dx++) {
      const nx = ((sx + dx) % tw + tw) % tw;
      const ti = ny * tw + nx;
      for (const k of keys) {
        const v = deposits[k][ti] || 0;
        if (v > maxOut[k]) maxOut[k] = v;
      }
      if (deposits.precious && deposits.precious[ti] > 0.05) minable.push([ti, "precious"]);
      if (deposits.gems     && deposits.gems[ti]     > 0.05) minable.push([ti, "gems"]);
    }
  }
  s.localRes = maxOut;
  s._minableTiles = minable;
}
export { scanLocalResources };

// Settlement's effective resource access including road-connected
// peers. Each tracked resource is the MAX across this settlement's
// local resources and each connected peer's. world.settlements is
// an array indexed in insertion order, NOT by id, so we have to
// look up peers by id rather than treating ids as indices.
function findSettlementById(world, id) {
  if (!world._byId) {
    world._byId = new Map();
    for (const s of world.settlements) world._byId.set(s.id, s);
  }
  return world._byId.get(id) || null;
}
function effectiveLocalRes(world, s) {
  const own = s.localRes || {};
  if (!s._tradeReach || s._tradeReach.size === 0) return own;
  const out = { ...own };
  for (const peerId of s._tradeReach.keys()) {
    const peer = findSettlementById(world, peerId);
    if (!peer || peer.mode !== "settled") continue;
    const peerRes = peer.localRes || {};
    for (const k in peerRes) {
      if ((peerRes[k] || 0) > (out[k] || 0)) out[k] = peerRes[k];
    }
  }
  return out;
}
export { effectiveLocalRes, findSettlementById };

// ── Wealth: money comes from trade, not thin air ──
//
// A settlement earns money by SELLING what it produces to other
// settlements (see runGeneralTradeBetween in roads.js) — money is never
// credited just for existing. The only thing updateWealth does is
// inject the base money SUPPLY: minted specie pulled out of the ground.
//
// SOURCE — mining. Each tick a settlement extracts from precious / gem
// tiles in reach, drawing on finite per-tile reserves (set on world
// init at richness × scale). When a tile's reserve hits 0 the mine is
// dry forever. This is how fresh money enters the system; founding
// endowments (makeSettlement) seed a little more.
//
// CIRCULATION — bilateral trade. On every road both partners sell their
// goods to each other, so money flows BOTH ways and keeps moving by
// velocity instead of pooling. A cash-poor town still earns by selling
// what little it makes, so it never freezes at its reserve. Gold-rich
// (but goods-poor) mining towns are net buyers, spending their specie
// outward — that's how mined money spreads to the rest of the economy.
const MINING_RATE = 5.0;              // base specie extraction multiplier
function updateWealth(world, s) {
  const reserves = world.depositReserve;
  if (!reserves) return;
  const minable = s._minableTiles;
  if (!minable || minable.length === 0) return;
  const k = s.knowledge;
  const popFactor = Math.sqrt(Math.max(1, s.people)) * 0.05;
  const orgMul    = 1 + (k.organization || 0) * 0.3;
  let mined = 0;
  for (const [ti, id] of minable) {
    const reserveArr = reserves[id];
    if (!reserveArr) continue;
    const left = reserveArr[ti];
    if (left <= 0) continue;
    const richness = (world.deposits[id] && world.deposits[id][ti]) || 0;
    const want = MINING_RATE * richness * popFactor * orgMul;
    const got = want < left ? want : left;
    reserveArr[ti] = left - got;
    mined += got;
  }
  s.wealth = (s.wealth || 0) + mined;
  // Smoothed mining income, for the money-flow overlay's source markers
  // (mining is the only money entering the system).
  s._minedRate = (s._minedRate || 0) * 0.9 + mined * 0.1;
}
export { updateWealth };

// Export-value = how many GOODS this settlement has to sell on a
// road. NOT wealth itself — precious metals and gems are CURRENCY
// once mined, not exportable goods. Gold-rich settlements have
// low exportValue (no goods, just coin) and become net buyers,
// spending their gold on imports from goods-producing partners —
// how mining wealth spreads out to the rest of the economy.
//
// Composition (broad enough that most settlements have SOMETHING
// distinctive to sell):
//   metallurgy + ore        tools / weapons (Damascus steel)
//   construction + mats     building goods (lumber, dressed stone)
//   agriculture + farmland  grain surplus (Egypt → Rome)
//   navigation + water      ship goods, fish, salt cod
//   toolmaking              crafted goods — pottery, textiles,
//                           leatherwork — works without metallurgy
//   foraging + timber       wild goods — furs, honey, herbs,
//                           game (Russian taiga, Canadian fur trade)
//   horses + mobility       horse trade, caravan beasts, war mounts
//                           (Mongol horse export, Andalusian)
//   organization + pop      administrative services — scribes,
//                           banking, contracts (Venice's bankers)
//   salt raw                preserved food, currency-adjacent
// Range is roughly 1.0 (no specialisation, "just gold") → ~5.5
// (highly developed multi-specialty exporter).
//
// Deliberately uses s.localRes (materials physically present in the
// settlement's reach), NOT effectiveLocalRes (which folds in trade-
// reachable peers). You can't forge steel from ore you don't hold, and
// counting a partner's ore here would double-count the same goods the
// partner already exports. Knowledge growth (updateKnowledge) is the
// place imported resources legitimately matter — learning a craft from
// a trading partner — not finished-goods output.
export function computeExportValue(s) {
  const k = s.knowledge || {};
  const r = s.localRes || {};
  let v = 1.0;
  const oreAccess = Math.max(r.copper || 0, r.tin || 0, r.iron || 0, r.coal || 0);
  if (oreAccess > 0.10) v += (k.metallurgy || 0) * 1.5;
  const matAccess = ((r.timber || 0) + (r.stone || 0)) * 0.5;
  v += (k.construction || 0) * matAccess * 0.8;
  const agScale = Math.min(1, s.farmland.size / 50);
  v += (k.agriculture || 0) * agScale * 0.6;
  if ((s.waterAccess || 0) > 0) v += (k.navigation || 0) * s.waterAccess * 0.5;
  // Toolmaking — crafted goods are valuable even without metal.
  // Pottery and textiles travel further than grain because of
  // density-value ratio.
  v += (k.toolmaking || 0) * 0.4;
  // Foraging × timber — wild forest goods.
  v += (k.foraging || 0) * (r.timber || 0) * 0.4;
  // Horses + mobility — horse trade and caravans.
  const horses = r.horses || 0;
  if (horses > 0.05) v += horses * 0.6 + (k.mobility || 0) * 0.4;
  // Organization × log-scale population — bureaucracy / services
  // / banking. Scales with population because you need lots of
  // people to support a clerical class.
  const popScale = Math.min(1, Math.log(Math.max(1, s.people)) / 8);
  v += ((k.organization || 0) + (k.literacy || 0) * 0.6) * popScale * 0.5;
  // Salt counts as a tradeable good.
  v += (r.salt || 0) * 0.5;
  // Base village products — every populated settlement has SOMETHING
  // to sell: chickens, eggs, basket-weaving, surplus labour,
  // hand-loomed cloth. Floor scales with log of pop so even a
  // 25-person hamlet contributes a bit, a metropolis a lot.
  // 25 ppl  → +0.14    1k ppl   → +0.30
  // 100 ppl → +0.20    10k ppl  → +0.40
  v += Math.min(0.5, Math.log10(Math.max(1, s.people)) / 10);
  return v;
}

// Wealth reserve = "rainy day fund" the settlement holds back from
// active spending. Scales with population — bigger settlements have
// more obligations (granary stockpiles, watch wages, ceremonial
// reserves) and need more cushion against bad years.
//   50  ppl: $ 45 reserve
//   200 ppl: $ 90
//   1000:    $330
//   10000:   $3030
// Below reserve, the settlement REFUSES to spend on trade outflows
// of any kind — they hoard. This is the urgency / priority gate
// the user asked for ("don't buy horses when struggling").
export function getWealthReserve(s) {
  return 30 + Math.max(0, s.people || 0) * 0.3;
}

// Decomposition of exportValue — returns a sorted list of
// { label, value } for each contributor. Used by the settlement
// info card to show WHAT the settlement actually exports, not
// just the headline number. Mirrors computeExportValue's
// structure.
export function getExportBreakdown(s) {
  const k = s.knowledge || {};
  const r = s.localRes || {};
  const out = [{ label: "Baseline", value: 1.0 }];
  const oreAccess = Math.max(r.copper || 0, r.tin || 0, r.iron || 0, r.coal || 0);
  if (oreAccess > 0.10) {
    const v = (k.metallurgy || 0) * 1.5;
    if (v > 0.01) out.push({ label: "Metalwork", value: v });
  }
  const matAccess = ((r.timber || 0) + (r.stone || 0)) * 0.5;
  const construction = (k.construction || 0) * matAccess * 0.8;
  if (construction > 0.01) out.push({ label: "Building goods", value: construction });
  const agScale = Math.min(1, s.farmland.size / 50);
  const agriculture = (k.agriculture || 0) * agScale * 0.6;
  if (agriculture > 0.01) out.push({ label: "Grain surplus", value: agriculture });
  if ((s.waterAccess || 0) > 0) {
    const v = (k.navigation || 0) * s.waterAccess * 0.5;
    if (v > 0.01) out.push({ label: "Ship goods", value: v });
  }
  const tools = (k.toolmaking || 0) * 0.4;
  if (tools > 0.01) out.push({ label: "Crafted goods", value: tools });
  const wild = (k.foraging || 0) * (r.timber || 0) * 0.4;
  if (wild > 0.01) out.push({ label: "Wild goods", value: wild });
  const horses = r.horses || 0;
  if (horses > 0.05) {
    const v = horses * 0.6 + (k.mobility || 0) * 0.4;
    if (v > 0.01) out.push({ label: "Horse trade", value: v });
  }
  const popScale = Math.min(1, Math.log(Math.max(1, s.people)) / 8);
  const services = ((k.organization || 0) + (k.literacy || 0) * 0.6) * popScale * 0.5;
  if (services > 0.01) out.push({ label: "Services", value: services });
  const salt = (r.salt || 0) * 0.5;
  if (salt > 0.01) out.push({ label: "Salt", value: salt });
  const base = Math.min(0.5, Math.log10(Math.max(1, s.people)) / 10);
  if (base > 0.01) out.push({ label: "Village products", value: base });
  return out.sort((a, b) => b.value - a.value);
}

// Trade profile across all connected roads. Per route:
//   netPerTick — ACTUAL net money this settlement gained (+) or paid (−)
//                on that route last tick, read from the live trade pass
//                (world._linkMoney). NOT a notional value — matches what
//                actually moved.
//   foodRole   — "selling food" / "buying food" / null (real
//                complementary food flow).
// Sorted by magnitude so the biggest flows show first. We deliberately
// don't report per-route "goods": trade is abstract money flow along the
// export-value gradient, not specific-commodity barter, so a goods label
// would be fiction (and made a town look like it both buys and sells the
// same thing).
// Resources, by richness, that `haver` has and `needer` lacks — i.e.
// what `haver` could barter to `needer`. Returns the top one (or null).
const BARTER_RES = ["timber","stone","copper","tin","iron","coal","horses","salt"];
const BARTER_HAVE = 0.10;   // a settlement "has" a resource at ≥ this richness
function topBarterGood(haver, needer) {
  const hr = haver.localRes || {}, nr = needer.localRes || {};
  let best = null, bestV = BARTER_HAVE;
  for (const id of BARTER_RES) {
    const hv = hr[id] || 0;
    if (hv > bestV && (nr[id] || 0) < BARTER_HAVE) { bestV = hv; best = id; }
  }
  return best;
}
export function getTradeProfile(s, world) {
  const profile = [];
  if (!s._tradeReach || s._tradeReach.size === 0) return profile;
  const sFood = (s._foodSupply || 0) - (s._foodDemand || 0);
  const lm = world._linkMoney;
  for (const [peerId, link] of s._tradeReach) {
    const peer = findSettlementById(world, peerId);
    if (!peer || peer.mode !== "settled") continue;
    // Actual money this settlement netted on the route last tick.
    let net = 0;
    if (lm) {
      const lo = Math.min(s.id, peer.id), hi = Math.max(s.id, peer.id);
      const toHi = lm.get(lo + ":" + hi) || 0;     // money that reached the higher-id settlement
      net = (s.id === hi) ? toHi : -toHi;
    }
    const peerFood = (peer._foodSupply || 0) - (peer._foodDemand || 0);
    let foodRole = null;
    if (sFood > 0.01 && peerFood < -0.01) foodRole = "selling food";
    else if (sFood < -0.01 && peerFood > 0.01) foodRole = "buying food";
    // Barter description: what each side gives the other (a resource it
    // has that the partner lacks). Shown when little/no coin moves.
    const give = topBarterGood(s, peer);
    const get  = topBarterGood(peer, s);

    profile.push({
      partner: peer.name, partnerId: peer.id,
      netPerTick: net, foodRole, pathCost: link.cost,
      give, get,
    });
  }
  profile.sort((a, b) => Math.abs(b.netPerTick) - Math.abs(a.netPerTick));
  return profile;
}

export function updateSettlement(world, s) {
  if (s.mode !== "settled") return;
  updateFood(world, s);
  updatePopulation(world, s);
  if (s.mode !== "settled") return;        // died this tick (famine / wither)
  maybeRefreshFarmland(world, s);
  updateWealth(world, s);
  updateDevelopment(world, s);
  updateKnowledge(world, s);
  updateTier(world, s);
}

// ── Knowledge growth ──────────────────────────────────────────────
// Each tech accumulates slowly while a settlement does the right
// things: more farmland → agriculture improves; more pop → organization
// improves; bigger pop + ag → construction improves. Diminishing
// returns near 1.0.
const LEARN_BASE = 0.000040;          // per tick scaling
const KTRACKS = ["foraging","toolmaking","agriculture","construction","organization","metallurgy","navigation","mobility","literacy"];
// Fraction of the gap to a better-developed road-connected neighbour
// closed per tick — technology transfer by contact. ~1/0.0006 ≈ 1700
// ticks to largely absorb a neighbour's lead.
const DIFFUSE_RATE = 0.0006;
//
// ── Resource-gated knowledge growth ──
//
// Each tech track grows in proportion to whatever inputs let it
// progress. Some tracks are HARD-GATED: without the input, no
// progress at all (metallurgy without ore, navigation without water).
// Others are SOFT-BOOSTED: they progress everywhere but faster with
// the right inputs (construction with timber, agriculture with
// metal tools).
//
// metallurgy caps:
//   stone tools only            cap 0
//   + copper                    cap 0.30  (chalcolithic — knives, ornaments)
//   + copper + tin              cap 0.65  (bronze age — proper weapons + ploughs)
//   + iron                      cap 0.90  (iron age)
//   + iron + coal               cap 1.00  (steel / industrial)
//
function updateKnowledge(world, s) {
  const k = s.knowledge;
  // Trade brings remote resources into the local tech equation —
  // a copper-poor settlement connected by road to a copper-rich one
  // can advance to chalcolithic on imported ore.
  const r = effectiveLocalRes(world, s);
  const wa = s.waterAccess || 0;
  const fc = s.farmland.size;
  const pop = s.people;
  const popSqrt = Math.sqrt(pop);
  const horsesThr = 0.05;
  const horses = r.horses || 0;

  // Ore tier cap (also caps how far a diffused metallurgy technique can
  // actually be practised — you need the ore to use the knowledge).
  const cu = r.copper || 0, sn = r.tin || 0, fe = r.iron || 0, co = r.coal || 0;
  const oreThr = 0.10;
  let metalCap = 0;
  if (cu > oreThr)                metalCap = Math.max(metalCap, 0.30);
  if (cu > oreThr && sn > oreThr) metalCap = Math.max(metalCap, 0.65);
  if (fe > oreThr)                metalCap = Math.max(metalCap, 0.90);
  if (fe > oreThr && co > oreThr) metalCap = 1.00;

  // ── Local learning ──────────────────────────────────────────────
  // Foraging: slow trickle everywhere; faster in resource-rich zones.
  const forageBoost = 1 + (r.timber || 0) * 0.3 + (r.salt || 0) * 0.2;
  k.foraging = clamp01(k.foraging + LEARN_BASE * 0.3 * (1 - k.foraging) * forageBoost);

  // Toolmaking: stone for primitive, metallurgy multiplies.
  const stoneBoost = 1 + (r.stone || 0) * 0.6;
  const metalBoost = 1 + k.metallurgy * 2.5;
  k.toolmaking = clamp01(k.toolmaking + LEARN_BASE * 0.8 * (1 - k.toolmaking)
    * stoneBoost * metalBoost * (1 + popSqrt * 0.08));

  // Construction: timber/stone + agricultural surplus to free builders.
  const buildMat = 1 + (r.timber || 0) * 0.8 + (r.stone || 0) * 0.6;
  k.construction = clamp01(k.construction + LEARN_BASE * 0.9 * (1 - k.construction)
    * buildMat * (1 + k.agriculture * 0.8) * (1 + popSqrt * 0.05));

  // Agriculture: farmland scale + metal tools (plough).
  k.agriculture = clamp01(k.agriculture + LEARN_BASE * 1.2 * (1 - k.agriculture)
    * (1 + fc * 0.03) * (1 + k.toolmaking * 0.7));

  // Organization: pop driven (admin burden grows with size).
  k.organization = clamp01(k.organization + LEARN_BASE * 1.0 * (1 - k.organization)
    * (1 + popSqrt * 0.10));

  // Metallurgy — hard-gated by ore. Paced so the eras (chalcolithic →
  // bronze → iron → steel) are actually reachable within a game rather
  // than plateauing in bronze.
  if (metalCap > 0 && k.metallurgy < metalCap) {
    const oreRate = Math.max(cu, sn, fe, co);
    const headroom = 1 - k.metallurgy / metalCap;
    k.metallurgy = Math.min(metalCap, k.metallurgy +
      LEARN_BASE * 2.6 * headroom * oreRate * (1 + k.toolmaking * 0.5));
  }

  // Navigation — hard-gated by water; paced so coasts/great rivers grow
  // into real naval powers.
  if (wa > 0) {
    k.navigation = clamp01(k.navigation + LEARN_BASE * 1.3 * (1 - k.navigation)
      * wa * (1 + k.construction * 0.6));
  }

  // Mobility — hard-gated by horses; paced so horse country becomes
  // cavalry country.
  if (horses > horsesThr) {
    k.mobility = clamp01(k.mobility + LEARN_BASE * 1.1 * (1 - k.mobility)
      * horses * (1 + k.construction * 0.4 + k.metallurgy * 0.6));
  }

  // Literacy / writing — emerges only in an organised, populous society
  // (scribes, law, records need both a bureaucracy and a class of people
  // to support it). Once present it makes the settlement absorb diffused
  // technique far faster (records + teaching), so it amplifies the spread
  // below rather than the local tracks above.
  if (k.organization > 0.30) {
    k.literacy = clamp01((k.literacy || 0) + LEARN_BASE * 0.6 * (1 - (k.literacy || 0))
      * k.organization * (1 + popSqrt * 0.06));
  }

  // ── Diffusion: learn techniques from connected neighbours ─────────
  // Technology spreads by contact. Pull each track toward the best level
  // among road-connected partners, FASTER the more literate this society
  // is (writing records and teaches technique). Resource-gated tracks are
  // capped by what THIS site can actually practise (ore tier / water /
  // horses) — you can hear how iron is worked, but still need iron to do
  // it.
  if (s._tradeReach && s._tradeReach.size > 0 && world._byId) {
    const km = { foraging:0, toolmaking:0, agriculture:0, construction:0,
                 organization:0, metallurgy:0, navigation:0, mobility:0, literacy:0 };
    let any = false;
    for (const pid of s._tradeReach.keys()) {
      const p = world._byId.get(pid);
      if (!p || p.mode !== "settled" || !p.knowledge) continue;
      any = true;
      const pk = p.knowledge;
      for (const t of KTRACKS) { const v = pk[t] || 0; if (v > km[t]) km[t] = v; }
    }
    if (any) {
      if (km.metallurgy > metalCap) km.metallurgy = metalCap;
      if (wa <= 0) km.navigation = 0;
      if (horses <= horsesThr) km.mobility = 0;
      const litMul = 1 + (k.literacy || 0) * 2;     // literate cultures absorb 1–3× faster
      const rate = DIFFUSE_RATE * litMul;
      for (const t of KTRACKS) {
        const gap = km[t] - k[t];
        if (gap > 0) k[t] = clamp01(k[t] + rate * gap);
      }
    }
  }
}

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

// ── Food ───────────────────────────────────────────────────────────
//
// Two supply sources: foraging (passive, over a neighbourhood) and
// farming (active, over the farmland set).
//
// Foraging used to be home-tile-only, which gave near-zero supply in
// any settlement not sitting on a lush square — completely unrealistic
// for hunter-gatherer baseline survival, and meant marginal-land
// hamlets always starved. Now foraging samples a 5×5 box (the
// neighbourhood the village can realistically walk), so a small
// village in semi-arid land can sustain ~20 people on hunting and
// gathering even with zero farmland.
//
// Farming still drives carrying capacity (K is set from farmland in
// updatePopulation), so the gain from foraging is *additive supply*,
// not *higher K*. A village stuck on forage alone stays at K=20 and
// just doesn't starve.
function updateFood(world, s) {
  const tw = world.tw, th = world.th;
  const sx = s.pos.x | 0, sy = s.pos.y | 0;
  // 5×5 forage area, fertility-summed. Includes the home tile.
  let forageArea = 0;
  for (let dy = -2; dy <= 2; dy++) {
    const ny = sy + dy;
    if (ny < 0 || ny >= th) continue;
    for (let dx = -2; dx <= 2; dx++) {
      const nx = ((sx + dx) % tw + tw) % tw;
      const ni = ny * tw + nx;
      forageArea += world.fert[ni] || 0;
    }
  }
  const forage = FORAGE_RATE * forageArea * (1 + (s.knowledge.foraging || 0.3) * 0.5);
  s._forageArea = forageArea;            // reused by updatePopulation for K

  let farmYield = 0;
  for (const fti of s.farmland) farmYield += world.fert[fti] || 0;
  farmYield *= FARM_YIELD_PER_FERT * (1 + (s.knowledge.agriculture || 0) * 1.2);

  // Fish: coastal/river settlements draw food from the water, scaled by
  // water access (the site: minor river → great-river port) and by
  // navigation (shore-gathering → deep-sea fleets). A fixed local-fishery
  // flow, not pop-scaled, so it sets how many people the water alone can
  // feed; a maritime city beyond that still imports. This is what lets a
  // coastal city — which the housing cap already lets grow large — feed
  // itself from the sea instead of relying entirely on shipped-in grain.
  const wa = s.waterAccess || 0;
  const fish = wa > 0 ? FISH_RATE * wa * (0.3 + (s.knowledge.navigation || 0) * 1.2) : 0;
  s._fishYield = fish;

  const supply = forage + farmYield + fish;
  // Urbanization tax: per-capita food demand rises with population
  // because bigger settlements have more non-farming specialists
  // (craftsmen, soldiers, priests, scribes) plus transport
  // overhead, food waste, supporting infrastructure. A village of
  // 25 is essentially all farmers; a metropolis of 10000 has a
  // huge urban service class eating without producing. This is what
  // historically forced big cities to import grain — they
  // physically couldn't feed their non-rural population from local
  // farmland even when surrounded by it.
  //   pop 25    → urbanFactor 1.14 (base × 1.14 = 0.0034)
  //   pop 200   → 1.23
  //   pop 1000  → 1.30
  //   pop 10000 → 1.40
  const urbanFactor = 1 + Math.log10(Math.max(10, s.people)) / 10;
  const demand = s.people * 0.0030 * urbanFactor;
  // Expose rates so the food-trade pass can compute surplus/deficit
  // per road without recomputing forage + farmland sums.
  s._foodSupply = supply;
  s._foodDemand = demand;
  s._urbanFactor = urbanFactor;
  s.food += supply - demand;

  const storageCap = 80 + s.tier * 200;
  if (s.food > storageCap) s.food = storageCap;
  if (s.food < 0) s.food = 0;
}

// ── Population ─────────────────────────────────────────────────────
// Housing capacity: how many people a settlement can sustain regardless
// of food, from its economy + site. Multiplicative, so a hub with several
// advantages (organised + watered + many partners) compounds into a real
// city while a plain inland hamlet sits near HOUSING_BASE.
// SPACE: buildable land within the urban footprint. Water and high
// mountains don't count. Cached on the settlement (terrain is static).
function computeBuildableArea(world, sx, sy) {
  const { tw, th, elev } = world;
  let n = 0;
  for (let dy = -SPACE_RADIUS; dy <= SPACE_RADIUS; dy++) {
    const ny = sy + dy;
    if (ny < 0 || ny >= th) continue;
    for (let dx = -SPACE_RADIUS; dx <= SPACE_RADIUS; dx++) {
      const nx = ((sx + dx) % tw + tw) % tw;
      const e = elev[ny * tw + nx];
      if (e > 0 && e < 0.6) n++;        // habitable land only
    }
  }
  return n;
}

// The hard ceiling: how many people the SITE can physically hold =
// buildable land x density, density rising with construction knowledge
// (more people on the same ground as building tech improves).
function spaceCapacity(s) {
  const area = s._buildableArea || 1;
  const density = DENSITY_BASE * (1 + (s.knowledge.construction || 0) * DENSITY_PER_CONSTR);
  return area * density;
}
export { spaceCapacity };

// Housing = what's actually been BUILT (base shelter + infrastructure),
// never exceeding the physical SPACE ceiling.
function housingCapacity(s) {
  return Math.min(HOUSING_BASE + (s.infrastructure || 0), spaceCapacity(s));
}
export { housingCapacity };

// Development: build housing up toward the SPACE ceiling. Runs only when
// housing is the binding constraint (food could feed more than is housed),
// and is gated by the three real limits on a growing town: FOOD, SPACE,
// and construction MATERIALS (timber/stone, local or bought from trade
// partners). Coin spent buying imported materials is TRANSFERRED to the
// supplying partners (a building boom enriches the material-rich
// hinterland), never destroyed.
function updateDevelopment(world, s) {
  s._developRate = 0;
  s._devReason = null;
  const houseK = s._houseK || 0, foodK = s._foodK || 0;
  s._housingPressed = foodK > houseK * 1.02;
  if (!s._housingPressed) return;

  // Room to grow = up to whichever of FOOD / SPACE binds first.
  const space = spaceCapacity(s);
  const room = Math.min(foodK, space) - houseK;
  if (room <= 0) { s._devReason = "space"; return; }   // built out the site

  // MATERIALS gate: timber + stone, local or from a trade partner.
  const own = s.localRes || {};
  const localMat = (own.timber || 0) + (own.stone || 0);
  const partnerWeight = p => { const pr = p.localRes || {}; return (pr.timber || 0) + (pr.stone || 0) + 0.05; };
  let bestPartnerMat = 0, totalW = 0;
  if (s._tradeReach && world._byId) {
    for (const pid of s._tradeReach.keys()) {
      const p = world._byId.get(pid);
      if (!p || p.mode !== "settled") continue;
      const pr = p.localRes || {};
      const pm = (pr.timber || 0) + (pr.stone || 0);
      if (pm > bestPartnerMat) bestPartnerMat = pm;
      totalW += partnerWeight(p);
    }
  }
  if (Math.max(localMat, bestPartnerMat) < 0.05) { s._devReason = "materials"; return; }

  const buildCap = (0.2 + (s.knowledge.construction || 0) * 2)
    * Math.sqrt(Math.max(1, s.people)) * BUILD_RATE;
  let add = Math.min(buildCap, room);
  if (add <= 0) return;

  // Local materials cover part of the cost for free (own forests/quarries
  // + local labour); the rest is bought from suppliers and paid for in
  // coin, transferred to them.
  const discount = Math.min(0.7, localMat * 0.5);
  let cost = add * INFRA_COST * (1 - discount);
  if (cost > 0 && totalW > 0) {
    const spare = (s.wealth || 0) - getWealthReserve(s);
    if (spare <= 0) { s._devReason = "coin"; return; }   // needs to buy materials it lacks
    if (cost > spare) { add *= spare / cost; cost = spare; }
    if (add <= 0) return;
    s.wealth -= cost;
    for (const pid of s._tradeReach.keys()) {
      const p = world._byId.get(pid);
      if (!p || p.mode !== "settled") continue;
      p.wealth = (p.wealth || 0) + cost * (partnerWeight(p) / totalW);
    }
  }
  s.infrastructure = (s.infrastructure || 0) + add;
  s._developRate = add;
  s._devReason = "expanding";
}
export { updateDevelopment };

function updatePopulation(world, s) {
  // Carrying capacity = the lesser of what FOOD can feed and what HOUSING
  // can hold. Food capacity includes smoothed imports, so a housing-rich
  // city grows past its LOCAL food on shipped-in grain; a food-rich but
  // undeveloped village is capped by housing and exports the surplus.
  //   foodK   = (local production + imports) / (0.003 × urbanFactor)
  //   houseK  = housingCapacity(s)  — economy + site, food-independent
  const supply = (s._foodSupply || 0) + (s._foodImportRate || 0);
  const perCapita = 0.003 * (s._urbanFactor || 1);
  const foodK = supply / perCapita;
  const houseK = housingCapacity(s);
  const K = Math.max(K_MIN_VIABLE, Math.min(foodK, houseK));
  s._k = K;
  s._foodK = foodK;            // exposed so the info panel can show which limit binds
  s._houseK = houseK;

  if (s.food <= 0.01 && s.people > 1) {
    s.people *= 0.985;
  } else {
    s.people = s.people + SETT_GROWTH * s.people * (1 - s.people / K);
  }
  if (s.people < 1.5) {
    s.mode = "dead";
    releaseFarmland(world, s);
    s.history.push({ step: world.step, type: "abandoned" });
    return;
  }
  // Withering: settlement has been below 8 people for too long.
  // Catches both stillborn farmland-less villages (food too scarce
  // even with 5×5 forage to grow) and post-famine zombies. Doesn't
  // touch small-but-stable forage hamlets in semi-arid land — those
  // hold ~10–15 people and never trip the timer.
  if (s.people < 8) {
    if (s._witherSince === undefined) s._witherSince = world.step;
    if (world.step - s._witherSince > 2000) {
      s.mode = "dead";
      releaseFarmland(world, s);
      s.history.push({ step: world.step, type: "withered" });
    }
  } else {
    s._witherSince = undefined;
  }
}

// ── Farmland selection ────────────────────────────────────────────
function maybeRefreshFarmland(world, s) {
  if (world.step - s.lastFarmRefresh < FARMLAND_REFRESH_INTERVAL) return;
  s.lastFarmRefresh = world.step;
  refreshFarmland(world, s);
  // Reach may have widened on tier growth; rescan resources too.
  scanLocalResources(world, s);
}

function refreshFarmland(world, s) {
  // Farmland is sized by the settlement's tier CATCHMENT (land it
  // commands), not its population — so food output is set by land. The
  // flood-fill below takes the best plantable tiles within reach up to
  // this count.
  const target = Math.max(4, CATCHMENT_BY_TIER[s.tier] || CATCHMENT_BY_TIER[0]);
  const { tw, th, elev, fert, coast, riverMag, _farmedBy } = world;
  // Plantability floor for this settlement, given its current ag tech.
  const minFert = MIN_PLANTABLE_FERT_BASE - MIN_PLANTABLE_FERT_SLOPE * (s.knowledge.agriculture || 0);

  // ── Shrink: drop least-fertile tiles ──
  if (s.farmland.size > target) {
    const sorted = [...s.farmland].sort((a, b) => (fert[a] || 0) - (fert[b] || 0));
    while (s.farmland.size > target && sorted.length > 0) {
      const ti = sorted.shift();
      s.farmland.delete(ti);
      if (_farmedBy[ti] === s.id) _farmedBy[ti] = -1;
    }
  }

  // ── Grow: flood-fill from settlement, best score first ──
  // Candidates are bounded by TRANSPORT REACH (cheap Dijkstra cached on
  // the settlement), not Euclidean distance. Effect: a city on a river
  // stretches its fields along the cheap valley; a city walled in by
  // mountains gets a tight, irregular pocket of farmland. The flood-
  // fill itself still picks best-fert-first inside that reach, so the
  // shape follows soil quality within the corridor.
  //
  // Reach also widens as the settlement's transport knowledge matures
  // (wagons, roads, logistics — see localTransport). Cache is keyed by
  // tier; we also force a refresh every REACH_REFRESH_TICKS so a metro
  // sitting at the top tier for thousands of ticks still benefits from
  // its slowly-maturing tech.
  if (s.farmland.size < target) {
    const maxCost = MAX_TRANSPORT_BY_TIER[s.tier] || MAX_TRANSPORT_BY_TIER[0];
    const reachStale = !s._reach ||
                       s._reachTier !== s.tier ||
                       (world.step - (s._reachStep || -Infinity)) > REACH_REFRESH_TICKS;
    if (reachStale) {
      s._reach = localTransport(world, s.pos.x | 0, s.pos.y | 0, maxCost, s.knowledge);
      s._reachTier = s.tier;
      s._reachStep = world.step;
    }
    const reach = s._reach;
    const heap = new _MaxHeap();
    const visited = new Set(s.farmland);

    // Score: fertility primary, plus generous river/coast bonus so
    // settlements naturally extend along water rather than blob outward.
    const scoreTile = (ti) => {
      let sc = fert[ti] || 0;
      if (riverMag && riverMag[ti] >= 3)      sc += 0.6;
      else if (riverMag && riverMag[ti] >= 2) sc += 0.35;
      if (coast[ti])                          sc += 0.20;
      return sc;
    };

    const tryAddCandidate = (ti) => {
      if (visited.has(ti)) return;
      visited.add(ti);
      if (elev[ti] <= 0) return;
      if (!reach.has(ti)) return;            // out of transport range
      const owner = _farmedBy[ti];
      if (owner !== -1 && owner !== s.id) return;
      if ((fert[ti] || 0) < minFert) return;
      heap.push(ti, scoreTile(ti));
    };

    const pushNeighbours = (ti) => {
      const ty = (ti / tw) | 0;
      const tx = ti - ty * tw;
      const left  = ty * tw + (tx === 0 ? tw - 1 : tx - 1);
      const right = ty * tw + (tx === tw - 1 ? 0 : tx + 1);
      const up    = ty > 0      ? (ty - 1) * tw + tx : -1;
      const down  = ty < th - 1 ? (ty + 1) * tw + tx : -1;
      tryAddCandidate(left);
      tryAddCandidate(right);
      if (up   >= 0) tryAddCandidate(up);
      if (down >= 0) tryAddCandidate(down);
    };

    // Seed from existing farmland or the home tile.
    if (s.farmland.size === 0) {
      const home = (s.pos.y | 0) * tw + (s.pos.x | 0);
      visited.add(home);
      if (elev[home] > 0 && (fert[home] || 0) >= minFert &&
          (_farmedBy[home] === -1 || _farmedBy[home] === s.id)) {
        s.farmland.add(home);
        _farmedBy[home] = s.id;
      }
      pushNeighbours(home);
    } else {
      for (const ti of s.farmland) pushNeighbours(ti);
    }

    while (s.farmland.size < target && heap.size() > 0) {
      const top = heap.popMax();
      const ti = top.ti;
      const cur = _farmedBy[ti];
      if (cur !== -1 && cur !== s.id) continue;
      s.farmland.add(ti);
      _farmedBy[ti] = s.id;
      pushNeighbours(ti);
    }
  }
}

// Tiny binary max-heap, parallel typed arrays. Used by refreshFarmland's
// flood-fill expansion.
class _MaxHeap {
  constructor() { this.ti = []; this.sc = []; }
  size() { return this.ti.length; }
  push(ti, sc) {
    this.ti.push(ti); this.sc.push(sc);
    let i = this.ti.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.sc[p] >= this.sc[i]) break;
      const tt = this.ti[p], ts = this.sc[p];
      this.ti[p] = this.ti[i]; this.sc[p] = this.sc[i];
      this.ti[i] = tt; this.sc[i] = ts;
      i = p;
    }
  }
  popMax() {
    const ti = this.ti[0], sc = this.sc[0];
    const lastTi = this.ti.pop(), lastSc = this.sc.pop();
    if (this.ti.length > 0) {
      this.ti[0] = lastTi; this.sc[0] = lastSc;
      let i = 0;
      const n = this.ti.length;
      for (;;) {
        const l = i * 2 + 1, r = i * 2 + 2;
        let best = i;
        if (l < n && this.sc[l] > this.sc[best]) best = l;
        if (r < n && this.sc[r] > this.sc[best]) best = r;
        if (best === i) break;
        const tt = this.ti[best], ts = this.sc[best];
        this.ti[best] = this.ti[i]; this.sc[best] = this.sc[i];
        this.ti[i] = tt; this.sc[i] = ts;
        i = best;
      }
    }
    return { ti, sc };
  }
}

function releaseFarmland(world, s) {
  for (const ti of s.farmland) {
    if (world._farmedBy[ti] === s.id) world._farmedBy[ti] = -1;
  }
  s.farmland.clear();
  // Reach cache is positional + tier; both invariant when farmland is
  // released for a dying settlement, but null it out for cleanliness.
  s._reach = null;
}

// Bounded Dijkstra from (sx, sy). Returns Map<ti, accumulated cost> for
// every land tile reachable within maxCost. Uses the same continuous
// edge-cost function as the global transport map (transport.js) so
// units of "cost" are identical everywhere; just adds per-settlement
// tech multipliers (localEdgeCost).
function localTransport(world, sx, sy, maxCost, kn) {
  const { tw, th, elev } = world;
  const out = new Map();
  const seed = sy * tw + sx;
  if (elev[seed] <= 0) return out;
  const heap = new _MinHeap();
  out.set(seed, 0);
  heap.push(seed, 0);
  while (heap.n > 0) {
    const { ti, d } = heap.popMin();
    if (d > (out.get(ti) ?? Infinity)) continue;
    const ty = (ti / tw) | 0, tx = ti - ty * tw;
    const left  = ty * tw + (tx === 0 ? tw - 1 : tx - 1);
    const right = ty * tw + (tx === tw - 1 ? 0 : tx + 1);
    const up    = ty > 0      ? (ty - 1) * tw + tx : -1;
    const down  = ty < th - 1 ? (ty + 1) * tw + tx : -1;
    const ns = [left, right, up, down];
    for (let k = 0; k < 4; k++) {
      const ni = ns[k];
      if (ni < 0) continue;
      const c = localEdgeCost(world, ti, ni, kn);
      if (c === Infinity) continue;
      const nd = d + c;
      if (nd > maxCost) continue;
      const cur = out.get(ni);
      if (cur === undefined || nd < cur) {
        out.set(ni, nd);
        heap.push(ni, nd);
      }
    }
  }
  return out;
}

// Tiny min-heap with parallel typed arrays — same shape as transport.js's
// _MinHeap. Duplicated to keep the modules independent at this scale; if
// a third caller shows up, lift it to a shared util.
class _MinHeap {
  constructor(cap = 256) {
    this.ti = new Int32Array(cap);
    // Float64 distances (matches roads.js): localTransport's `out` is a
    // Float64 Map, so a Float32 heap mis-fires the `d > out.get(ti)`
    // staleness check on rounding and silently truncates the reach. The
    // full reach is now SAFE for farmland because the patch is capped by
    // the per-tier CATCHMENT, not by population — a large reach just gives
    // the flood-fill more good tiles to pick from, it can't blow farmland
    // up the way pop/16 × huge-reach did.
    this.d  = new Float64Array(cap);
    this.n  = 0;
    this.cap = cap;
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

// ── Tier ───────────────────────────────────────────────────────────
function updateTier(world, s) {
  for (let t = TIER_THRESHOLD.length - 1; t > s.tier; t--) {
    if (s.people >= TIER_THRESHOLD[t]) {
      s.tier = t;
      s.history.push({ step: world.step, type: "tier-up", tier: TIER_NAME[t], people: Math.round(s.people) });
      s.lastFarmRefresh = world.step - FARMLAND_REFRESH_INTERVAL;
      break;
    }
  }
}

export { TIER_THRESHOLD, TIER_NAME, releaseFarmland };

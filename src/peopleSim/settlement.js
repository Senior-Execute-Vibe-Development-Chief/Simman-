// Settlement: a permanent community at a fixed location. It controls a
// TERRITORY — the land it can reach cheapest within its budget (see
// territory.js) — from which it draws food and resources. No bands, no
// individual buildings.
//
// New settlements come from the crystallization sweep (crystallize.js),
// which scatters them across viable sites and lets them inherit
// knowledge from their nearest neighbour weighted by transport distance.

import { seedLocalTerritory } from "./territory.js";

let _nextId = 1;
export function resetSettlementIds() { _nextId = 1; }

const TIER_THRESHOLD = [0, 80, 400, 2000];
const TIER_NAME      = ["village", "town", "city", "metropolis"];

// Pop growth slowed from 0.0045 → 0.0018 so settlements visibly take
// many in-game years to grow from village to city. With 0.0018, a
// village at 20 ppl reaches K=470 (city tier) in ~2000 ticks rather
// than ~700.
const SETT_GROWTH = 0.0018;

// Food model: a settlement's land food comes from the TERRITORY it
// controls (territory.js) — the distance-weighted sum of its claimed
// arable tiles' fertility, times yield and agriculture. Fish is added on
// top (and is perishable/local). Population K is derived from food:
//   K = (land food + fish + imported food) / demand_per_capita
// where demand_per_capita = 0.003 food/person/tick.
const K_MIN_VIABLE = 8;                    // bare-survival floor (matches the wither cull threshold)

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
// Yield per (distance-weighted) fertility unit of territory, ×(1+ag·1.2).
// Calibrated against the old catchment model so population stays in a
// similar range (the rest of the balance is tuned around it).
const FARM_YIELD_PER_FERT    = 0.12;
// Fish: per-tick food a water settlement lands. fishYield = FISH_RATE ×
// waterAccess × (0.3 + navigation×1.2). A great-river port with a
// deep-sea fleet (wa≈0.9, nav≈0.8) nets ~12/tk — comparable to a big
// farmland patch — so maritime cities can feed themselves; a landlocked
// site gets nothing.
const FISH_RATE              = 11.0;

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
    // resource id. Populated from the settlement's TERRITORY (territory.js)
    // each territory pass; used by updateKnowledge to gate tech growth.
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
    // Polity: each settlement starts as its own one-settlement country
    // (city-state); conquest merges them (see conquest.js / armies.js).
    countryId: 0,                 // set to own id just below
    army: 0,                      // garrison size (soldiers), see armies.js
    tier: 0,
    mode: "settled",
    lastFoundAttempt: world.step,
    history: [{ step: world.step, type: "founded", parent: opts.parentId ?? -1, pos: { x, y } }],
  };
  // Migrate older knowledge objects (e.g. crystallization inheritance)
  // that don't have the new fields.
  for (const k of ["metallurgy","navigation","mobility","literacy"]) {
    if (s.knowledge[k] === undefined) s.knowledge[k] = 0;
  }
  // Compute water access score from the home tile + 4 neighbours.
  s.countryId = s.id;             // its own one-settlement country to start
  s.waterAccess = computeWaterAccess(world, x | 0, y | 0);
  s._buildableArea = computeBuildableArea(world, x | 0, y | 0);
  world.settlements.push(s);
  seedLocalTerritory(world, s);   // food/resource stats until the first full territory pass
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

// Local resources (s.localRes) and mineable tiles (s._minableTiles) are
// now populated from the settlement's TERRITORY (territory.js), not a box
// scan — a settlement controls the resources of the land it claims.

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
  const agScale = Math.min(1, (s._terrTiles || 0) / 120);
  v += (k.agriculture || 0) * agScale * 0.6;
  if ((s.waterAccess || 0) > 0) v += (k.navigation || 0) * s.waterAccess * 0.5;
  // Fish / seafood — only the PRESERVED fraction (salt cod, etc.) trades
  // for coin; most fish is eaten fresh and locally, so this is a minor
  // good next to the storable grain staple. Needs navigation (preserving
  // + shipping), so a shore-fishing village sells almost none.
  if ((s.waterAccess || 0) > 0) v += s.waterAccess * (k.navigation || 0) * 0.3;
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
  const agScale = Math.min(1, (s._terrTiles || 0) / 120);
  const agriculture = (k.agriculture || 0) * agScale * 0.6;
  if (agriculture > 0.01) out.push({ label: "Grain surplus", value: agriculture });
  if ((s.waterAccess || 0) > 0) {
    const v = (k.navigation || 0) * s.waterAccess * 0.5;
    if (v > 0.01) out.push({ label: "Ship goods", value: v });
    const fish = s.waterAccess * (k.navigation || 0) * 0.3;
    if (fish > 0.01) out.push({ label: "Salt fish", value: fish });
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
  const fc = s._terrTiles || 0;
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
  // Land food from the controlled TERRITORY: the distance-weighted sum of
  // claimed arable fertility (computed in territory.js), times yield and
  // agriculture. Storable — fills granaries and ships to feed cities.
  const landFood = (s._terrFertSum || 0) * FARM_YIELD_PER_FERT
    * (1 + (s.knowledge.agriculture || 0) * 1.2);

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

  // Land food is STORABLE — it fills granaries and ships across the world
  // to feed distant cities. Fish is perishable: it feeds the local
  // population well but can't be shipped or stored, so it never becomes
  // export food. The food trade reads _storableSupply for what a
  // settlement can send out.
  s._storableSupply = landFood;
  const supply = landFood + fish;
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
    s.history.push({ step: world.step, type: "abandoned" });
    return;
  }
  // Withering: a settlement stuck below 8 people for too long (a stillborn
  // site whose territory can't feed it, or a post-famine zombie) dies.
  // Stable small forage hamlets sit at ~10–15 and never trip the timer.
  if (s.people < 8) {
    if (s._witherSince === undefined) s._witherSince = world.step;
    if (world.step - s._witherSince > 2000) {
      s.mode = "dead";
      s.history.push({ step: world.step, type: "withered" });
    }
  } else {
    s._witherSince = undefined;
  }
}

// ── Tier ───────────────────────────────────────────────────────────
function updateTier(world, s) {
  for (let t = TIER_THRESHOLD.length - 1; t > s.tier; t--) {
    if (s.people >= TIER_THRESHOLD[t]) {
      s.tier = t;
      s.history.push({ step: world.step, type: "tier-up", tier: TIER_NAME[t], people: Math.round(s.people) });
      break;
    }
  }
}

export { TIER_THRESHOLD, TIER_NAME };

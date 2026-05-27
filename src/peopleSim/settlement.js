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
//   1 painted tile feeds PEOPLE_PER_FARM_TILE people on average.
//   Yield is calibrated so supply / demand ≈ 1.31 at K (30 % margin).
// Forage model:
//   K also includes a forage-area contribution at 0.8× weight, so a
//   village in a modest semi-arid neighbourhood can carry 40–70
//   people on hunting/gathering alone (no plantable farmland). This
//   is what lets steppe/desert-edge/tundra hamlets be a visible
//   feature instead of empty floor-20 dots.
const PEOPLE_PER_FARM_TILE   = 14;
const PEOPLE_PER_FORAGE_TILE = 7;          // forage-K rate (per fert-unit in 5×5)
const FORAGE_K_WEIGHT        = 1.0;        // forage contribution to total K
const K_FLOOR                = 35;         // hamlet visible at zoom — pop ~35 even in worst land
const FARM_YIELD_PER_FERT    = 0.055;
// Forage rate calibrated so a forage-only village in a modest 5×5
// neighbourhood (avg fert ~0.4) reaches equilibrium pop ~70. Bumped
// from 0.012 so K from forageArea isn't bottlenecked by food supply
// — without this, K could be 80 but demand starved pop down to ~25.
// Farming (yield 0.055/fert) is still ~3× more efficient per
// fert-unit, so fertile valleys still dominate by orders of magnitude.
const FORAGE_RATE            = 0.018;
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
    food: (opts.people ?? 25) * 30,
    knowledge: opts.knowledge || {
      foraging:    0.5,
      toolmaking:  0.2,
      agriculture: 0.50,        // cradle starts already farming
      construction: 0.1,
      organization: 0.1,
      metallurgy:  0,           // gated by ore access
      navigation:  0,           // gated by water access
      mobility:    0,           // gated by horses
    },
    traits: opts.traits || {
      aggression:   world.rng(),
      mercantilism: world.rng(),
      curiosity:    world.rng(),
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
    // Currency for funding road construction. Earned from mining
    // valuable resources and from trade across roads. New
    // settlements get a small endowment so they can build their
    // first road and join the trade network — the cradle gets a
    // larger one as the world's economic seed.
    wealth: opts.name === "cradle" ? 100 : 40,
    // Ids of roads connecting this settlement to others.
    roadsConnecting: [],
    farmland: new Set(),
    tier: 0,
    mode: "settled",
    lastFarmRefresh: world.step,
    lastFoundAttempt: world.step,
    history: [{ step: world.step, type: "founded", parent: opts.parentId ?? -1, pos: { x, y } }],
  };
  // Migrate older knowledge objects (e.g. crystallization inheritance)
  // that don't have the new fields.
  for (const k of ["metallurgy","navigation","mobility"]) {
    if (s.knowledge[k] === undefined) s.knowledge[k] = 0;
  }
  // Compute water access score from the home tile + 4 neighbours.
  s.waterAccess = computeWaterAccess(world, x | 0, y | 0);
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

// Walk the settlement's transport reach (if cached) or a 5×5 fall
// back box, and record per-resource richness. Two outputs:
//   s.localRes[k]  — MAX richness within reach (gates knowledge:
//                    is there ANY deposit accessible at all?).
// Road connections merge peer localRes via max() in
// effectiveLocalRes() so trade unlocks tech the same way local
// deposits would. Run alongside farmland refresh so it picks up
// tier-driven reach growth.
function scanLocalResources(world, s) {
  const deposits = world.deposits;
  if (!deposits) return;
  const keys = Object.keys(deposits);
  if (keys.length === 0) return;
  const maxOut = {};
  for (const k of keys) maxOut[k] = 0;
  const sample = (ti) => {
    for (const k of keys) {
      const v = deposits[k][ti] || 0;
      if (v > maxOut[k]) maxOut[k] = v;
    }
  };
  if (s._reach && s._reach.size > 0) {
    for (const ti of s._reach.keys()) sample(ti);
  } else {
    const { tw, th } = world;
    const sx = s.pos.x | 0, sy = s.pos.y | 0;
    for (let dy = -2; dy <= 2; dy++) {
      const ny = sy + dy;
      if (ny < 0 || ny >= th) continue;
      for (let dx = -2; dx <= 2; dx++) {
        const nx = ((sx + dx) % tw + tw) % tw;
        sample(ny * tw + nx);
      }
    }
  }
  s.localRes = maxOut;
  // Cache minable tiles (precious + gems) so updateWealth can
  // extract per-tick without re-walking reach. Each entry is
  // [tileIndex, resourceId]. Refreshed on the same cadence as the
  // reach scan, so newly-reached deposits start producing wealth at
  // the next refresh boundary.
  const minable = [];
  const tileList = (s._reach && s._reach.size > 0)
    ? [...s._reach.keys()]
    : (() => {
        const ts = [];
        const { tw, th } = world;
        const sx = s.pos.x | 0, sy = s.pos.y | 0;
        for (let dy = -2; dy <= 2; dy++) {
          const ny = sy + dy;
          if (ny < 0 || ny >= th) continue;
          for (let dx = -2; dx <= 2; dx++) {
            const nx = ((sx + dx) % tw + tw) % tw;
            ts.push(ny * tw + nx);
          }
        }
        return ts;
      })();
  for (const ti of tileList) {
    if (deposits.precious && deposits.precious[ti] > 0.05) minable.push([ti, "precious"]);
    if (deposits.gems     && deposits.gems[ti]     > 0.05) minable.push([ti, "gems"]);
  }
  s._minableTiles = minable;
}
export { scanLocalResources };

// Settlement's effective resource access including road-connected
// peers. Each tracked resource is the MAX across this settlement's
// local resources and each connected peer's. world.settlements is
// an array indexed in insertion order, NOT by id, so we have to
// look up peers by id rather than treating ids as indices.
function findSettlementById(world, id) {
  for (let i = 0; i < world.settlements.length; i++) {
    if (world.settlements[i].id === id) return world.settlements[i];
  }
  return null;
}
function effectiveLocalRes(world, s) {
  const own = s.localRes || {};
  if (!world.roads || world.roads.length === 0 || !s.roadsConnecting || s.roadsConnecting.length === 0) {
    return own;
  }
  const out = { ...own };
  for (const rid of s.roadsConnecting) {
    const road = world.roads[rid];
    if (!road || !road.active) continue;
    const peerId = road.from === s.id ? road.to : road.from;
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

// ── Wealth: closed-economy model ──
//
// MONEY IS NOT CREATED FROM POPULATION OR TRADE. In a closed system,
// total wealth grows only when new specie comes out of the ground.
// All other "income" (trade, services, crafts) just moves existing
// money between settlements.
//
// SOURCE — mining. Each tick, a settlement extracts from precious-
// and gems-bearing tiles within its reach. Each tile has a finite
// reserve (set on world init at richness × scale). Extraction draws
// from reserve and adds to settlement wealth. When a tile's reserve
// hits 0, that mine is dry — no more wealth from it ever. Mines
// visibly deplete over thousands of ticks of heavy use.
//
// TRANSFER — trade. Handled in roads.js updateTrade(). Each tick on
// each road, money flows from the buyer (lower exportValue) to the
// seller (higher exportValue), bounded by buyer's wealth. Net
// change to total system wealth: zero.
//
// SINK — road construction. Wealth spent on roads is gone from the
// trackable economy (paid to labourers who disperse it). Already
// implemented in roads.js.
//
// FOUNDING ENDOWMENT — new settlements get a small starting wealth
// so they can build a first road; cradle gets more as the world's
// economic seed.
const MINING_RATE = 5.0;              // base extraction multiplier
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
}
export { updateWealth };

// Export-value = how many GOODS this settlement has to sell on a
// road. NOT wealth itself — precious metals and gems are CURRENCY
// once mined, not exportable goods. Gold-rich settlements have
// low exportValue (no goods, just coin) and become net buyers,
// spending their gold on imports from goods-producing partners.
// That's how mining wealth actually distributes in a closed economy.
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
  v += (k.organization || 0) * popScale * 0.5;
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
  const services = (k.organization || 0) * popScale * 0.5;
  if (services > 0.01) out.push({ label: "Services", value: services });
  const salt = (r.salt || 0) * 0.5;
  if (salt > 0.01) out.push({ label: "Salt", value: salt });
  const base = Math.min(0.5, Math.log10(Math.max(1, s.people)) / 10);
  if (base > 0.01) out.push({ label: "Village products", value: base });
  return out.sort((a, b) => b.value - a.value);
}

// Trade profile across all connected roads. Returns array of
// { rid, partner, partnerId, role, tradeValue, transport,
//   netPerTick } where role is "selling" (we receive money) or
// "buying" (we pay). netPerTick is positive when money flows IN,
// negative when it flows OUT.
export function getTradeProfile(s, world) {
  const profile = [];
  if (!s.roadsConnecting || !world.roads) return profile;
  const sExport = computeExportValue(s);
  for (const rid of s.roadsConnecting) {
    const road = world.roads[rid];
    if (!road || !road.active) continue;
    const peerId = road.from === s.id ? road.to : road.from;
    const peer = findSettlementById(world, peerId);
    if (!peer || peer.mode !== "settled") continue;
    const peerExport = computeExportValue(peer);
    const diff = sExport - peerExport;             // >0: we're seller
    const minPop = Math.min(s.people, peer.people);
    const tradeValue = Math.abs(diff) * Math.sqrt(minPop) * 0.025;
    const transport  = (road.pathCost || 0) * 0.012;
    const selling = diff > 0;
    const netPerTick = selling ? tradeValue : -(tradeValue + transport);
    profile.push({
      rid, partner: peer.name, partnerId: peer.id,
      role: selling ? "selling" : "buying",
      tradeValue, transport: selling ? 0 : transport,
      netPerTick,
    });
  }
  return profile;
}

export function updateSettlement(world, s) {
  if (s.mode !== "settled") return;
  updateFood(world, s);
  updatePopulation(world, s);
  if (s.mode !== "settled") return;        // died this tick (famine / wither)
  maybeRefreshFarmland(world, s);
  updateWealth(world, s);
  updateKnowledge(world, s);
  updateTier(world, s);
}

// ── Knowledge growth ──────────────────────────────────────────────
// Each tech accumulates slowly while a settlement does the right
// things: more farmland → agriculture improves; more pop → organization
// improves; bigger pop + ag → construction improves. Diminishing
// returns near 1.0.
const LEARN_BASE = 0.000040;          // per tick scaling
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

  // Foraging: slow trickle everywhere; faster in resource-rich zones
  // (timber for tools, salt for preservation).
  const forageBoost = 1 + (r.timber || 0) * 0.3 + (r.salt || 0) * 0.2;
  k.foraging = clamp01(k.foraging + LEARN_BASE * 0.3 * (1 - k.foraging) * forageBoost);

  // Toolmaking: stone for primitive, metallurgy multiplies.
  const stoneBoost = 1 + (r.stone || 0) * 0.6;
  const metalBoost = 1 + k.metallurgy * 2.5;
  k.toolmaking = clamp01(k.toolmaking + LEARN_BASE * 0.8 * (1 - k.toolmaking)
    * stoneBoost * metalBoost * (1 + popSqrt * 0.08));

  // Construction: timber for early shelter, stone for durable
  // structures, agriculture for surplus to free up builders.
  const buildMat = 1 + (r.timber || 0) * 0.8 + (r.stone || 0) * 0.6;
  k.construction = clamp01(k.construction + LEARN_BASE * 0.9 * (1 - k.construction)
    * buildMat * (1 + k.agriculture * 0.8) * (1 + popSqrt * 0.05));

  // Agriculture: farmland scale + metal tools (plough). Cradle starts
  // at 0.5 so the floor is non-zero.
  k.agriculture = clamp01(k.agriculture + LEARN_BASE * 1.2 * (1 - k.agriculture)
    * (1 + fc * 0.03) * (1 + k.toolmaking * 0.7));

  // Organization: pop driven (admin burden grows with size).
  k.organization = clamp01(k.organization + LEARN_BASE * 1.0 * (1 - k.organization)
    * (1 + popSqrt * 0.10));

  // ── Metallurgy: hard-gated by ore access ──
  const cu = r.copper || 0;
  const sn = r.tin    || 0;
  const fe = r.iron   || 0;
  const co = r.coal   || 0;
  const oreThr = 0.10;             // need at least a faint deposit
  let metalCap = 0;
  if (cu > oreThr)                metalCap = Math.max(metalCap, 0.30);
  if (cu > oreThr && sn > oreThr) metalCap = Math.max(metalCap, 0.65);
  if (fe > oreThr)                metalCap = Math.max(metalCap, 0.90);
  if (fe > oreThr && co > oreThr) metalCap = 1.00;
  if (metalCap > 0 && k.metallurgy < metalCap) {
    const oreRate = Math.max(cu, sn, fe, co);
    const headroom = 1 - k.metallurgy / metalCap;
    // 3× faster than the original 0.5 factor so era transitions
    // happen on a meaningful timescale (~5–10k ticks per era jump
    // instead of plateauing for 100k+).
    k.metallurgy = Math.min(metalCap, k.metallurgy +
      LEARN_BASE * 1.5 * headroom * oreRate * (1 + k.toolmaking * 0.5));
  }

  // ── Navigation: hard-gated by water access ──
  // Coast + major river gives the fastest growth (port cities). A
  // small river alone gives slow progress (riverboats only).
  if (wa > 0) {
    k.navigation = clamp01(k.navigation + LEARN_BASE * 0.7 * (1 - k.navigation)
      * wa * (1 + k.construction * 0.6));
  }

  // ── Mobility: hard-gated by horses ──
  // Cavalry, postal relays, scouting. Construction unlocks chariots /
  // saddles / stirrups (gradual real-world progression). Horses are
  // sparse and clustered, so a much lower threshold (0.05 vs the
  // 0.10 used for ore mines) lets faint herds count — a settlement
  // doesn't need a stud farm to start training scouts.
  const horsesThr = 0.05;
  const horses = r.horses || 0;
  if (horses > horsesThr) {
    k.mobility = clamp01(k.mobility + LEARN_BASE * 0.5 * (1 - k.mobility)
      * horses * (1 + k.construction * 0.4 + k.metallurgy * 0.6));
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

  const supply = forage + farmYield;
  const demand = s.people * 0.0030;
  // Expose rates so the food-trade pass can compute surplus/deficit
  // per road without recomputing forage + farmland sums.
  s._foodSupply = supply;
  s._foodDemand = demand;
  s.food += supply - demand;

  const storageCap = 80 + s.tier * 200;
  if (s.food > storageCap) s.food = storageCap;
  if (s.food < 0) s.food = 0;
}

// ── Population ─────────────────────────────────────────────────────
function updatePopulation(world, s) {
  let farmFert = 0;
  for (const fti of s.farmland) farmFert += world.fert[fti] || 0;
  const farmK = farmFert * PEOPLE_PER_FARM_TILE * (1 + (s.knowledge.agriculture || 0) * 1.2);
  // Forage area was computed in updateFood (5×5 fertility-sum around
  // the home tile). Counts toward K at FORAGE_K_WEIGHT so marginal
  // forage-only villages can actually grow past the floor — pastoral
  // hamlets, oasis villages, tundra encampments.
  const forageK = (s._forageArea || 0) * PEOPLE_PER_FORAGE_TILE
                * (1 + (s.knowledge.foraging || 0.3) * 0.5);
  // Imported food via trade lifts effective carrying capacity. Each
  // food unit/tick imported sustains ~1/0.003 ≈ 333 people; we
  // weight at 0.5 because imports can be disrupted, so a prudent
  // settlement doesn't grow to fully match imported supply. This is
  // what lets coastal grain-importing cities (Rome → Egypt) hold
  // populations far beyond local farmland.
  const importK = (s._foodImportRate || 0) / 0.003 * 0.5;
  const K = Math.max(K_FLOOR, farmK + forageK * FORAGE_K_WEIGHT + importK);
  s._k = K;

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
  // Minimum 4 farm tiles so a freshly-founded settlement (~20 ppl,
  // would naively want only 2 tiles) has enough food capacity to grow
  // past its founding pop.
  const target = Math.max(4, Math.ceil(s.people / PEOPLE_PER_FARM_TILE));
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

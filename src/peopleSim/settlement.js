// Settlement: a permanent community at a fixed location. It controls a
// TERRITORY — the land it can reach cheapest within its budget (see
// territory.js) — from which it draws food and resources. No bands, no
// individual buildings.
//
// New settlements come from the crystallization sweep (crystallize.js),
// which scatters them across viable sites and lets them inherit
// knowledge from their nearest neighbour weighted by transport distance.

import { seedLocalTerritory } from "./territory.js";
import { T } from "./tuning.js";
import { recordIn, recordOut, IN_MINING, IN_MATERIALS, OUT_MATERIALS } from "./money.js";
import { localP } from "./inflation.js";

let _nextId = 1;
export function resetSettlementIds() { _nextId = 1; }

// Pop thresholds for village / town / city / metropolis. Set so that with
// subsistence farm yields most settlements are small farming VILLAGES, towns
// are the local market centres, and cities/metropolises are the rare
// trade-fed hubs — a realistic population pyramid rather than a map of
// uniform cities.
const TIER_THRESHOLD = [0, 250, 1200, 5000];
const TIER_NAME      = ["village", "town", "city", "metropolis"];

// Pop growth slowed from 0.0045 → 0.0018 so settlements visibly take
// many in-game years to grow from village to city. With 0.0018, a
// village at 20 ppl reaches K=470 (city tier) in ~2000 ticks rather
// than ~700.
// SETT_GROWTH -> runtime lever (tuning.js T.SETT_GROWTH)

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
// Agricultural-hinterland food multiplier (see updateFood): how a big city's
// organised, intensively-farmed food shed scales with its population above
// town size. The strength is the runtime lever T.URBAN_HINTERLAND; REF is the
// population floor below which there's no boost (town threshold), so
// villages/towns keep their plain catchment.
const HINTERLAND_REF      = 250;    // = TIER_THRESHOLD[town]; boost starts above town size
// DENSITY_PER_CONSTR -> runtime lever (tuning.js T.DENSITY_PER_CONSTR)
// Development: build housing up toward the space ceiling. Needs materials
// (timber/stone — own, or bought from suppliers with coin) and labour;
// rate-limited by construction tech + population. Coin paid for imported
// materials is TRANSFERRED to the supplying partners, not destroyed.
const INFRA_COST          = 80;     // coin per +1 housing of (imported) materials + labour
const BUILD_RATE          = 0.015;  // housing/tick per construction-weighted builder
// Yield per (distance-weighted) fertility unit of territory, ×(1+ag·1.2).
// Deliberately SUBSISTENCE-scale: a settlement's own land feeds only a
// village-to-town population, so the countryside fills with small farming
// villages. Growing into a city requires importing grain by trade — which
// is exactly what makes cities form at trade/river/coast hubs and produces
// the realistic village → town → city size hierarchy (rather than every
// patch of decent land becoming a metropolis).
// FARM_YIELD_PER_FERT -> runtime lever (tuning.js T.FARM_YIELD_PER_FERT)
// ── Luxury trade ── Renewable luxury goods (spices/furs/incense/dyes) in a
// settlement's territory let it EARN coin by selling to wealthy buyers; and a
// settlement's own wealth drives a DEMAND to import luxuries (elite
// consumption). The actual coin transfer happens in the trade pass
// (runLuxuryTradeBetween). Both are expressed directly in coin/tick.
// ── Army food cost ── A garrison consumes extra food (provisioning); it's
// sized against the food surplus in musterArmies so the granary stays positive.
export const ARMY_FOOD        = 0.003;  // extra food per soldier per tick (provisioning, above civilian)
const LUX_RES = ["spices", "furs", "incense", "dyes"];
const LUX_SUPPLY_RATE = 4.0;    // coin/tick a region can earn per luxury-unit × √pop
const LUX_SPEND_FRAC  = 0.015;  // fraction of SPARE wealth a settlement spends on luxury/tick
                                // (so rich hoards drive real luxury demand, not just headcount)
// Fish: per-tick food a water settlement lands. fishYield = T.FISH_RATE ×
// waterAccess × (0.3 + navigation×1.2). A great-river port with a
// deep-sea fleet (wa≈0.9, nav≈0.8) nets ~12/tk — comparable to a big
// farmland patch — so maritime cities can feed themselves; a landlocked
// site gets nothing.
// FISH_RATE -> runtime lever (tuning.js T.FISH_RATE)

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
      agriculture: 0.50,        // cradle starts already farming (absorbs the old foraging track)
      construction: 0.1,        // absorbs the old toolmaking track (wagons + bridges)
      organization: 0.1,        // absorbs the old literacy track (records + bureaucracy)
      metallurgy:  0,           // gated by ore access
      navigation:  0,           // gated by water access
      mobility:    0,           // gated by horses
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
    // staggerReachRebuild in roads.js on each plan cycle.
    _tradeReach: null,
    // Polity: each settlement starts as its own one-settlement country
    // (city-state); conquest merges them (see conquest.js / armies.js).
    countryId: 0,                 // set to own id just below
    // Loyalty to the current country [0..1]. A loyalty STOCK that integrates
    // over time (conquest.js): it climbs while the realm can administer this
    // province (within its control budget) and bleeds while it can't; the
    // province secedes when it hits zero. Starts fully loyal (a city-state is
    // loyal to itself); set low when conquered.
    loyalty: 1,
    // Popular discontent [0..1] — a separate stock from loyalty (conquest.js).
    // Loyalty is administrative cohesion (can the centre reach/hold this?);
    // unrest is POPULAR grievance (hunger, conscription, war fatigue, heavy
    // taxes). It rises with hardship, cools in peace + plenty, bleeds loyalty,
    // and at the top boils over into a destructive REBELLION. Starts content.
    unrest: 0,
    army: 0,                      // garrison size (soldiers), see armies.js
    tier: 0,
    mode: "settled",
    lastFoundAttempt: world.step,
    history: [{ step: world.step, type: "founded", parent: opts.parentId ?? -1, pos: { x, y } }],
  };
  // Migrate older knowledge objects (e.g. crystallization inheritance)
  // that don't have the new fields.
  for (const k of ["metallurgy","navigation","mobility"]) {
    if (s.knowledge[k] === undefined) s.knowledge[k] = 0;
  }
  // Compute water access score from the home tile + 4 neighbours.
  s.countryId = opts.countryId ?? s.id;             // joins parent's realm if specified, else own city-state
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
// MINING_RATE -> runtime lever (tuning.js T.MINING_RATE)
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
    const want = T.MINING_RATE * richness * popFactor * orgMul;
    const got = want < left ? want : left;
    reserveArr[ti] = left - got;
    mined += got;
  }
  s.wealth = (s.wealth || 0) + mined;
  recordIn(s, IN_MINING, mined);
  // Smoothed mining income, for the money-flow overlay's source markers
  // (mining is the only money entering the system).
  s._minedRate = (s._minedRate || 0) * 0.9 + mined * 0.1;
  computeLuxury(s, world);
}

// Per-tick luxury supply (coin a region can earn selling its luxury goods)
// and demand (coin the settlement will spend importing luxuries, scaled by
// how rich it is). Stored as remaining budgets the trade pass draws down.
function computeLuxury(s, world) {
  const lr = s.localRes || {};
  let luxRes = 0; for (const id of LUX_RES) luxRes += lr[id] || 0;
  const popF = Math.sqrt(Math.max(1, s.people));
  // Luxury supply takes the FULL sack penalty squared — luxuries depend on
  // the most skilled labour, so a sacked town's silk/dye/spice production
  // collapses harder than its grain (which the same sackPenalty above only
  // dents). Squaring takes 0.3 → 0.09 at the floor.
  const sp = sackPenalty(s, world && world.step);
  s._luxSupply = luxRes * LUX_SUPPLY_RATE * popF * sp * sp;
  const spare = Math.max(0, (s.wealth || 0) - getWealthReserve(s));
  s._luxDemand = spare * LUX_SPEND_FRAC;
  s._luxSupplyLeft = s._luxSupply;   // drawn down across partners in the trade pass
  s._luxDemandLeft = s._luxDemand;
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
//   construction + mats     building goods + crafted wares — lumber,
//                           dressed stone, pottery, textiles. (Folds in
//                           the old toolmaking track.)
//   agriculture + farmland  grain surplus + wild forest goods — fur,
//                           honey, herbs. (Folds in the old foraging
//                           track; an agrarian society also manages its
//                           wood-and-hunt commons.)
//   navigation + water      ship goods, fish, salt cod
//   horses + mobility       horse trade, caravan beasts, war mounts
//                           (Mongol horse export, Andalusian)
//   organization + pop      administrative services — scribes, records,
//                           banking, contracts. (Folds in the old
//                           literacy track; a state apparatus implies a
//                           clerical class.)
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
// Conquest production penalty: forcibly stormed settlements (armies.js sets
// _sackedAt) lose most of their export value for a while — skilled labour
// fled or died, infrastructure was destroyed, supply lines collapsed. This
// makes conquest of a trading partner DESTRUCTIVE to the very thing that
// made them worth attacking, the historical reason conquering trade hubs
// was usually a bad deal (Mongol sack of Baghdad, Mongol/Yuan collapse of
// Iranian agriculture, etc.). Recovers linearly over ~CONQUEST_RECOVERY
// ticks. The penalty applies regardless of whether the new owner held the
// city long ago and re-took it — sacks always cost real productive value.
// SACK_PRODUCTION_FLOOR -> runtime lever (tuning.js T.SACK_PRODUCTION_FLOOR)
const CONQUEST_RECOVERY     = 5000;  // ticks to recover linearly to full output
function sackPenalty(s, worldStep) {
  if (s._sackedAt == null || worldStep == null) return 1;
  const age = worldStep - s._sackedAt;
  if (age >= CONQUEST_RECOVERY) return 1;
  if (age < 0) return 1;
  return T.SACK_PRODUCTION_FLOOR + (1 - T.SACK_PRODUCTION_FLOOR) * (age / CONQUEST_RECOVERY);
}
export function computeExportValue(s, world) {
  const k = s.knowledge || {};
  const r = s.localRes || {};
  let v = 1.0;
  const oreAccess = Math.max(r.copper || 0, r.tin || 0, r.iron || 0, r.coal || 0);
  if (oreAccess > 0.10) v += (k.metallurgy || 0) * 1.5;
  const matAccess = ((r.timber || 0) + (r.stone || 0)) * 0.5;
  // Construction now covers building goods + crafted wares (formerly the
  // toolmaking line) — the floor term gives a craft contribution even
  // without raw materials.
  v += (k.construction || 0) * (0.4 + matAccess * 0.8);
  const agScale = Math.min(1, (s._terrTiles || 0) / 120);
  // Agriculture now covers grain surplus + wild-forest goods (formerly
  // the foraging × timber line).
  v += (k.agriculture || 0) * agScale * 0.6;
  v += (k.agriculture || 0) * (r.timber || 0) * 0.4;
  if ((s.waterAccess || 0) > 0) v += (k.navigation || 0) * s.waterAccess * 0.5;
  // Fish / seafood — only the PRESERVED fraction (salt cod, etc.) trades
  // for coin; most fish is eaten fresh and locally, so this is a minor
  // good next to the storable grain staple. Needs navigation (preserving
  // + shipping), so a shore-fishing village sells almost none.
  if ((s.waterAccess || 0) > 0) v += s.waterAccess * (k.navigation || 0) * 0.3;
  // Horses + mobility — horse trade and caravans.
  const horses = r.horses || 0;
  if (horses > 0.05) v += horses * 0.6 + (k.mobility || 0) * 0.4;
  // Organization × log-scale population — bureaucracy / services / banking
  // (now includes the old literacy contribution: scribes and records are
  // a sub-function of an organised state with a clerical class).
  const popScale = Math.min(1, Math.log(Math.max(1, s.people)) / 8);
  v += (k.organization || 0) * popScale * 0.8;
  // Salt counts as a tradeable good.
  v += (r.salt || 0) * 0.5;
  // Base village products — every populated settlement has SOMETHING
  // to sell: chickens, eggs, basket-weaving, surplus labour,
  // hand-loomed cloth. Floor scales with log of pop so even a
  // 25-person hamlet contributes a bit, a metropolis a lot.
  // 25 ppl  → +0.14    1k ppl   → +0.30
  // 100 ppl → +0.20    10k ppl  → +0.40
  v += Math.min(0.5, Math.log10(Math.max(1, s.people)) / 10);
  // Soldiers don't produce trade goods — a heavily militarised settlement
  // exports less (the workforce is under arms, not at the loom/forge).
  const armyFrac = (s.army || 0) / Math.max(1, s.people);
  // Sack penalty: a forcibly-stormed settlement loses output for a while
  // (see sackPenalty above). World-aware callers pass `world`; older callers
  // get penalty=1 (no change). The trade pass and the inflation pass DO
  // pass world, so the dynamics fire where it matters most.
  return v * Math.max(0.1, 1 - armyFrac) * sackPenalty(s, world && world.step);
}

// Per-tick memo of computeExportValue. It's a heavy function (several log/sqrt
// terms) whose inputs — knowledge, localRes, territory, population, army — are
// fixed within a tick, yet the trade pass alone called it ~40×/settlement/tick
// (twice per trade pair, plus road ranking and inflation). Compute it once per
// settlement per tick on first use; every later read that tick is free. (The
// passes that consume it — roads, inflation, trade — don't mutate any of its
// inputs, so the memo is consistent across them.)
export function exportValueOf(s, world) {
  if (s._evStep !== world.step) {
    s._exportValue = computeExportValue(s, world);
    s._evStep = world.step;
  }
  return s._exportValue;
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
  const construction = (k.construction || 0) * (0.4 + matAccess * 0.8);
  if (construction > 0.01) out.push({ label: "Building & crafted goods", value: construction });
  const agScale = Math.min(1, (s._terrTiles || 0) / 120);
  const agriculture = (k.agriculture || 0) * agScale * 0.6;
  if (agriculture > 0.01) out.push({ label: "Grain surplus", value: agriculture });
  if ((s.waterAccess || 0) > 0) {
    const v = (k.navigation || 0) * s.waterAccess * 0.5;
    if (v > 0.01) out.push({ label: "Ship goods", value: v });
    const fish = s.waterAccess * (k.navigation || 0) * 0.3;
    if (fish > 0.01) out.push({ label: "Salt fish", value: fish });
  }
  const wild = (k.agriculture || 0) * (r.timber || 0) * 0.4;
  if (wild > 0.01) out.push({ label: "Wild goods", value: wild });
  const horses = r.horses || 0;
  if (horses > 0.05) {
    const v = horses * 0.6 + (k.mobility || 0) * 0.4;
    if (v > 0.01) out.push({ label: "Horse trade", value: v });
  }
  const popScale = Math.min(1, Math.log(Math.max(1, s.people)) / 8);
  const services = (k.organization || 0) * popScale * 0.8;
  if (services > 0.01) out.push({ label: "Services & records", value: services });
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

// ── Urbanisation: rural → urban drift ────────────────────────────────
// Without migration every village just grows toward its own small local carrying
// capacity, so the map is a uniform sea of hamlets and no real CITY ever forms.
// In reality people drift to the nearest big town — opportunity, trade, the
// market — and that town outgrows its own fields on the surplus GRAIN those same
// emptying villages ship in. So each pass a small fraction of a settlement's
// people move to the LARGEST road-connected settlement in its trade reach, faster
// the bigger the gap, capped by the destination's remaining carrying capacity so
// the city only grows to what it can actually feed and house. Chained up the
// network (village → town → city → metropolis) this concentrates population into
// a few real cities standing over many villages — the historical settlement
// pyramid — instead of an even smear.
const MIGRATE_RATE     = 0.004;  // per pass: base share of a town that drifts to its hub
const MIGRATE_MIN_POP  = 25;     // a hamlet this small doesn't shed migrants
const MIGRATE_GAP_CAP  = 6;      // a far-bigger hub pulls this much harder (capped)
const MIGRATE_DRAIN_CAP = 0.04;  // never move more than this fraction of a village in one pass
export function urbanise(world) {
  const byId = world._byId;
  if (!byId) return;
  for (const s of world.settlements) {
    if (s.mode !== "settled" || s.people < MIGRATE_MIN_POP || !s._tradeReach) continue;
    // The biggest road-connected settlement in reach is this region's draw.
    let best = null, bestPop = s.people;
    for (const pid of s._tradeReach.keys()) {
      const d = byId.get(pid);
      if (!d || d.mode !== "settled") continue;
      if (d.people > bestPop) { bestPop = d.people; best = d; }
    }
    if (!best) continue;                               // s is its own region's hub
    const gap = Math.min(MIGRATE_GAP_CAP, best.people / Math.max(1, s.people));
    const room = Math.max(0, (best._k || best.people) - best.people);   // don't push it past what it can feed/house
    let movers = Math.min(s.people * MIGRATE_RATE * gap, room, s.people * MIGRATE_DRAIN_CAP);
    if (movers < 0.2) continue;
    s.people -= movers;
    best.people += movers;
  }
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
// LEARN_BASE -> runtime lever (tuning.js T.LEARN_BASE)
const KTRACKS = ["agriculture","construction","organization","metallurgy","navigation","mobility"];
// Fraction of the gap to a better-developed road-connected neighbour
// closed per tick — technology transfer by contact. ~1/0.0006 ≈ 1700
// ticks to largely absorb a neighbour's lead.
// DIFFUSE_RATE -> runtime lever (tuning.js T.DIFFUSE_RATE)
// The two reach-iterating parts of updateKnowledge (folding in trade-reach
// resources, and diffusing technique from neighbours) are recomputed only
// every KNOW_INTERVAL ticks per settlement — staggered by id so the cost
// spreads evenly across ticks instead of every settlement paying it every
// tick. Knowledge and resource availability drift far too slowly for the
// per-tick recompute to matter; rates are scaled up to keep the average
// pace identical. This is the single biggest per-tick cost as the trade
// network grows (it was O(reach) × every settlement × every tick).
const KNOW_INTERVAL = 8;
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
  // can advance to chalcolithic on imported ore. Cached and refreshed
  // only every KNOW_INTERVAL ticks (resource availability drifts slowly).
  if (!s._effRes || (world.step + s.id) % KNOW_INTERVAL === 0) s._effRes = effectiveLocalRes(world, s);
  const r = s._effRes;
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
  // Construction: covers buildings, roads, wagons, bridges (the old
  // toolmaking track folded in here — they're all "things built by
  // skilled labour"). Driven by timber/stone, helped by metal tools,
  // agricultural surplus to free builders, and population.
  const buildMat = 1 + (r.timber || 0) * 0.8 + (r.stone || 0) * 0.6;
  const stoneBoost = 1 + (r.stone || 0) * 0.6;
  const metalBoost = 1 + k.metallurgy * 1.8;
  k.construction = clamp01(k.construction + T.LEARN_BASE * 1.0 * (1 - k.construction)
    * buildMat * stoneBoost * metalBoost
    * (1 + k.agriculture * 0.6) * (1 + popSqrt * 0.06));

  // Agriculture: farmland scale + metal tools (plough) + wild-food
  // gathering that supplements the early village (folds in the old
  // foraging track). The wild-food boost decays as metallurgy advances
  // — society moves off forage onto stored grain.
  const wildBoost = 1 + (r.timber || 0) * 0.2 * (1 - k.metallurgy * 0.7);
  k.agriculture = clamp01(k.agriculture + T.LEARN_BASE * 1.2 * (1 - k.agriculture)
    * (1 + fc * 0.03) * (1 + k.construction * 0.5) * wildBoost);

  // Organization: pop-driven admin burden + a literate-state branch
  // (folded in from the old literacy track) that kicks in once the
  // bureaucracy is mature enough to support scribes. The kicker means
  // organization keeps accelerating past 0.30 instead of plateauing.
  //
  // ERA GATE: organization can't outrun the MATERIAL era. A stone-tool
  // society runs a chiefdom, not a continental bureaucracy — without this,
  // a big fertile village grew org→1.0 (continental reach) on population
  // alone, with zero metallurgy. The ceiling rises with the era ladder
  // (metallurgy: chalcolithic 0.30 → bronze 0.65 → iron 0.90), and ore
  // counts even when IMPORTED by trade (metalCap is computed from
  // effectiveLocalRes), so a trade-connected culture isn't frozen on
  // ore-poor ground; construction (monumental/record infrastructure) lifts
  // it a little more. Iron-era realms still reach full org (≈continental
  // reach); stone-age realms are held to kingdom scale.
  const orgEraCap = clamp01(0.15 + metalCap * 0.95 + k.construction * 0.15);
  const orgHead = Math.max(0, orgEraCap - k.organization);
  const litBranch = k.organization > 0.30
    ? 0.6 * k.organization * (1 + popSqrt * 0.06)
    : 0;
  k.organization = clamp01(k.organization + T.LEARN_BASE * orgHead
    * ((1 + popSqrt * 0.10) + litBranch));

  // Metallurgy — hard-gated by ore. Paced so the eras (chalcolithic →
  // bronze → iron → steel) are actually reachable within a game rather
  // than plateauing in bronze.
  if (metalCap > 0 && k.metallurgy < metalCap) {
    const oreRate = Math.max(cu, sn, fe, co);
    const headroom = 1 - k.metallurgy / metalCap;
    k.metallurgy = Math.min(metalCap, k.metallurgy +
      T.LEARN_BASE * 2.6 * headroom * oreRate * (1 + k.construction * 0.4));
  }

  // Navigation — hard-gated by water; paced so coasts/great rivers grow
  // into real naval powers.
  if (wa > 0) {
    k.navigation = clamp01(k.navigation + T.LEARN_BASE * 1.3 * (1 - k.navigation)
      * wa * (1 + k.construction * 0.6));
  }

  // Mobility — hard-gated by horses; paced so horse country becomes
  // cavalry country.
  if (horses > horsesThr) {
    k.mobility = clamp01(k.mobility + T.LEARN_BASE * 1.1 * (1 - k.mobility)
      * horses * (1 + k.construction * 0.4 + k.metallurgy * 0.6));
  }

  // ── Diffusion: learn techniques from connected neighbours ─────────
  // Technology spreads by contact. Pull each track toward the best level
  // among road-connected partners, FASTER the more ORGANISED this
  // society is (writing/records are now folded into organization, so a
  // literate-bureaucratic state absorbs technique 1–3× faster).
  // Resource-gated tracks are capped by what THIS site can actually
  // practise (ore tier / water / horses) — you can hear how iron is
  // worked, but still need iron to do it.
  // Diffusion is throttled to every KNOW_INTERVAL ticks (staggered by id),
  // with the rate scaled up to match — technique spreads over ~1700 ticks,
  // so an 8-tick cadence is indistinguishable while costing 8× less.
  if (s._tradeReach && s._tradeReach.size > 0 && world._byId
      && (world.step + s.id) % KNOW_INTERVAL === 0) {
    const km = { agriculture:0, construction:0, organization:0,
                 metallurgy:0, navigation:0, mobility:0 };
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
      // Literate-state diffusion multiplier (was "literacy"; now reads off
      // the literate-state branch of organization, which only kicks in
      // past 0.30).
      const litMul = 1 + Math.max(0, k.organization - 0.30) * 3;
      const rate = T.DIFFUSE_RATE * KNOW_INTERVAL * litMul;
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
  //
  // Agricultural hinterland / provisioning: a large settlement organises a
  // proportionally larger and more intensively-worked food shed than the tiles
  // it claims — peri-urban market gardening and irrigation, plus the state
  // granary/supply system (Rome's annona, the Inca qollqa) that concentrated
  // staples from a wide region to feed a non-farming urban class. Without this
  // every settlement grows to eat exactly its own catchment, leaving no
  // structural surplus, so the largest cities stall at foodK ~2000 and the
  // metropolis tier (5000+) is unreachable. Modelled as a bounded multiplier
  // that grows with population ABOVE town size (HINTERLAND_REF) — villages and
  // towns are untouched (the dense rural map stays), but a city can assemble
  // the grain to push into the metropolis tier. The log keeps it self-limiting:
  // food rises far slower than population, so it settles at a finite size.
  const hinterlandMul = 1 + T.URBAN_HINTERLAND
    * Math.max(0, Math.log10(Math.max(1, s.people / HINTERLAND_REF)));
  const landFood0 = (s._terrFertSum || 0) * T.FARM_YIELD_PER_FERT
    * (1 + (s.knowledge.agriculture || 0) * 1.2) * hinterlandMul;
  // Famine (shocks.js): a regional bad-harvest window slashes the land yield.
  const landFood = world.step < (s._famineUntil || 0)
    ? landFood0 * (s._harvestMul || 1) : landFood0;

  // Fish: coastal/river settlements draw food from the water, scaled by
  // water access (the site: minor river → great-river port) and by
  // navigation (shore-gathering → deep-sea fleets). A fixed local-fishery
  // flow, not pop-scaled, so it sets how many people the water alone can
  // feed; a maritime city beyond that still imports. This is what lets a
  // coastal city — which the housing cap already lets grow large — feed
  // itself from the sea instead of relying entirely on shipped-in grain.
  const wa = s.waterAccess || 0;
  const fish = wa > 0 ? T.FISH_RATE * wa * (0.3 + (s.knowledge.navigation || 0) * 1.2) : 0;
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
  const civDemand = s.people * 0.0030 * urbanFactor;
  // The garrison eats too — extra rations/fodder above the civilian rate
  // (provisioning). This is the food cost of a standing army: a big garrison
  // burns the food surplus that would otherwise fill granaries / grow the
  // town (guns vs. butter). The army is SIZED against this surplus in
  // musterArmies, so the granary still nets positive in steady state.
  const armyFood = (s.army || 0) * ARMY_FOOD;
  const demand = civDemand + armyFood;
  // Expose rates so the food-trade pass can compute surplus/deficit
  // per road without recomputing forage + farmland sums.
  s._foodSupply = supply;
  s._foodDemand = demand;          // total (civilian + garrison) — drains the granary
  s._civFoodDemand = civDemand;    // civilian only — army sizing reads this
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
  const density = DENSITY_BASE * (1 + (s.knowledge.construction || 0) * T.DENSITY_PER_CONSTR);
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

  // MATERIALS gate: timber + stone, local or from a trade partner. The
  // partner aggregate (best supplier + total supply weight) drifts slowly,
  // so it's cached and refreshed only every KNOW_INTERVAL ticks (staggered)
  // rather than re-walking the whole reach every tick a town is building.
  const own = s.localRes || {};
  const localMat = (own.timber || 0) + (own.stone || 0);
  const partnerWeight = p => { const pr = p.localRes || {}; return (pr.timber || 0) + (pr.stone || 0) + 0.05; };
  if (!s._devMat || (world.step + s.id) % KNOW_INTERVAL === 0) {
    let bpm = 0, tw = 0;
    if (s._tradeReach && world._byId) {
      for (const pid of s._tradeReach.keys()) {
        const p = world._byId.get(pid);
        if (!p || p.mode !== "settled") continue;
        const pr = p.localRes || {};
        const pm = (pr.timber || 0) + (pr.stone || 0);
        if (pm > bpm) bpm = pm;
        tw += partnerWeight(p);
      }
    }
    s._devMat = { bestPartnerMat: bpm, totalW: tw };
  }
  const bestPartnerMat = s._devMat.bestPartnerMat, totalW = s._devMat.totalW;
  if (Math.max(localMat, bestPartnerMat) < 0.05) { s._devReason = "materials"; return; }

  const buildCap = (0.2 + (s.knowledge.construction || 0) * 2)
    * Math.sqrt(Math.max(1, s.people)) * BUILD_RATE;
  let add = Math.min(buildCap, room);
  if (add <= 0) return;

  // Local materials cover part of the cost for free (own forests/quarries
  // + local labour); the rest is bought from suppliers and paid for in
  // coin, transferred to them.
  const discount = Math.min(0.7, localMat * 0.5);
  // Building costs scale with the local price level (inflation.js): an
  // inflated economy pays more in coin for the same imported materials.
  let cost = add * INFRA_COST * (1 - discount) * localP(world, s);
  if (cost > 0 && totalW > 0) {
    const spare = (s.wealth || 0) - getWealthReserve(s);
    if (spare <= 0) { s._devReason = "coin"; return; }   // needs to buy materials it lacks
    if (cost > spare) { add *= spare / cost; cost = spare; }
    if (add <= 0) return;
    s.wealth -= cost;
    recordOut(s, OUT_MATERIALS, cost);
    for (const pid of s._tradeReach.keys()) {
      const p = world._byId.get(pid);
      if (!p || p.mode !== "settled") continue;
      const share = cost * (partnerWeight(p) / totalW);
      p.wealth = (p.wealth || 0) + share;
      recordIn(p, IN_MATERIALS, share);
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
    s.people = s.people + T.SETT_GROWTH * s.people * (1 - s.people / K);
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

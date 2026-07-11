// Settlement: a permanent community at a fixed location. It controls a
// TERRITORY — the land it can reach cheapest within its budget (see
// territory.js) — from which it draws food and resources. No bands, no
// individual buildings.
//
// New settlements come from the crystallization sweep (crystallize.js),
// which scatters them across viable sites and lets them inherit
// knowledge from their nearest neighbour weighted by transport distance.

import { seedLocalTerritory } from "./territory.js";
import { mergeReach } from "./roads.js";
import { techEffects } from "./tech.js";
import { agriGate, bestPackageAt, pkgSuitAt } from "./agriculture.js";
import { CROP_BY_ID } from "../cropPackages.js";
import { logEvent } from "./events.js";
import { fieldShift } from "./popField.js";
import { ensurePolity, getPolity } from "./entities.js";
import { foundCulture, getCulture, seedCulture, nameFor, admixArrivals } from "./cultures.js";
import { T, rNormPop } from "./tuning.js";
import { malariaSignal, tsetseSignal, aridSignal } from "./habitability.js";
import { recordIn, recordOut, IN_MINING, IN_GOODS, IN_MATERIALS, IN_CREDIT, IN_LUXURY, OUT_GOODS, OUT_MATERIALS, OUT_CREDIT } from "./money.js";
import { hash32 } from "./rng.js";

// Settlement ids count up PER WORLD (world._nextSettlementId), not at module
// scope: country ids are settlement ids and the personality RNG is seeded from
// them, so a shared module counter would make two worlds in one process (tools,
// tests, future multi-map UI) interfere and break same-seed reproducibility.

// Pop thresholds for village / town / city / metropolis. Set so that with
// subsistence farm yields most settlements are small farming VILLAGES, towns
// are the local market centres, and cities/metropolises are the rare
// trade-fed hubs — a realistic population pyramid rather than a map of
// uniform cities.
//
// The metropolis bar is 3000, not 5000: at the current (dense) settlement
// URBAN tier bars (sim-people), now that towns are SPAWNED (not promoted from a
// region) and grow on the grain surplus of the capped rural districts around
// them. A town tops out ~600-800 on its narrow tier-1 food catchment; crossing
// the CITY bar widens that catchment (FOOD_RANGE_BY_TIER 1→2.2), which is what
// lets a city pull grain from a whole region and grow on toward the METRO bar.
// So the bars are set just below those natural ceilings — low enough that the
// town→city→metropolis ladder is actually climbable in the slower, smaller
// world (the old 1200/3000 bars were tuned for the in-place-promotion era, when
// a single node aggregated everything, and left almost nothing above "town").
// (TIER_THRESHOLD[1], the town bar, no longer gates anything — towns are born
// tier-1 — but it's kept as the tier-1 demotion reference.)
const TIER_THRESHOLD = [0, 150, 600, 900];
const TIER_NAME      = ["farming region", "town", "city", "metropolis"];   // tier-0 = an abstraction for MANY small villages (a farmed region), not one village
// Rural ceiling: a FARMING REGION (tier 0) is a collection of villages — a rural
// DISTRICT — not a proto-city. Its population is capped here so it can never pile
// into a single giant "farming region" node. The surplus food its land grows
// beyond this ceiling ships UP the hierarchy to feed TOWNS (foodHierarchy), and
// because a capped region is neither hungry (it stops pulling grain) nor has any
// urbanise room (migrants flow past it), the rural→urban concentration lands on
// the spawned towns instead of fattening a region. Urban nodes (tier ≥ 1) are
// uncapped — they grow on that imported surplus into cities and metropolises.
const URBAN_CAP = 300;
// The rural ceiling RISES with farm yield — intensive modern agriculture (the
// fertiliser/mechanisation/green-revolution surge) lets a rural district hold far
// more people, so the COUNTRYSIDE densifies in the industrial era instead of every
// village staying pinned at the medieval cap. Dampened (<farmYield) so abundant
// surplus still ships up to grow the cities/metros rather than all of it staying rural.
const RURAL_YIELD_BASE = 2.0;     // ≈ medieval farmYield — densification only kicks in ABOVE this
const URBAN_DENSITY_GAIN = 0.42;  // rural cap = URBAN_CAP × (1 + GAIN × (farmYield − BASE))
// Demotion hysteresis: a settlement loses a tier only once its population falls
// below this fraction of its CURRENT tier's promotion floor — a deadband so a
// city hovering at a threshold doesn't flicker between tiers, while a sustained
// decline (plague, famine, sacking, out-migration) genuinely costs it its rank.
const TIER_DEMOTE_FRAC = 0.8;
// The metropolis bar floats with the world's largest urban centre: a settlement
// is a metropolis once it reaches METRO_REL_FRAC of the biggest city (but never
// below the absolute TIER_THRESHOLD floor, so early/slow worlds still mint their
// first metros). Without this the bar is fixed while DEVELOPMENT lifts every
// city's size, so eventually they ALL cross it and the metropolis tier balloons
// past the city tier — an inverted pyramid. Tying it to the top keeps a
// metropolis "one of the handful of largest cities in the world", whatever the
// era, so the pyramid (many towns ▸ fewer cities ▸ a few metros) holds.
const METRO_REL_FRAC = 0.8;

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
const HOUSING_BASE        = 90;     // starting shelter before anything is built (raised so small settlements aren't pinned tiny by build-lag)
const SPACE_RADIUS        = 14;     // urban-footprint radius for the buildable-land scan
const DENSITY_BASE        = 6;      // people per buildable tile at zero construction
// Anticipatory urban development: a city builds housing/infrastructure for more
// people than its CURRENT food can feed, and that empty headroom is what makes
// it import grain (foodAppetite.growthNeed) and pull in migrants — the engine of
// real urban growth. Applied only above town size, so villages/towns stay
// pinned to their own food (the dense rural map is untouched).
const URBAN_ANTICIPATION     = 1.6;   // a city builds housing up to 1.6x its current food capacity
const URBAN_ANTICIPATION_REF = 250;   // anticipation kicks in above this population — deliberately
                                      // ABOVE the town bar (TIER_THRESHOLD[1] = 150) so only towns
                                      // already growing past their founding size build ahead of food
// DENSITY_PER_CONSTR -> runtime lever (tuning.js T.DENSITY_PER_CONSTR)
// Development: build housing up toward the space ceiling. Needs materials
// (timber/stone — own, or bought from suppliers with coin) and labour;
// rate-limited by construction tech + population. Coin paid for imported
// materials is TRANSFERRED to the supplying partners, not destroyed.
const INFRA_COST          = 80;     // coin per +1 housing of (imported) materials + labour
const BUILD_RATE          = 0.045;  // housing/tick per construction-weighted builder (3x: at scale, build-lag was the binding constraint — settlements sat housing-limited far below their food potential, so few reached city size. Faster building lets FOOD drive scaling, as intended.)
// Construction is resolved every T.DEV_STRIDE ticks at STRIDE× rate (temporal
// LOD): a town's build pass walks its trade reach every tick to pay material
// suppliers — the biggest slice of the per-settlement update — but housing grows
// slowly, so bursting it keeps the same AVERAGE pace at ~STRIDE× less cost.
// 1 = build every tick (original). (Towns are staggered by id so the cost is
// even across ticks, not a spike.) T.DEV_STRIDE is a live Pacing lever (tuning.js).
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
const ARMY_LABOR_FREE = 0.08;   // army up to this fraction of pop (the standing professional core) doesn't reduce farming; only the wartime CONSCRIPT surge beyond it empties the fields
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

// ── Ancestry (deep genetic stock) ──────────────────────────────────────────
// s.ancMix = [[ancId, share], ...] summing to 1, dominant first — the genetic
// substrate a settlement's population descends from. Seeded from the worldgen
// field; admixed only by MIGRATION (founding), never by conquest/culture, so it
// is the slow bedrock the peoples/languages drift away from.
// How much of the LOCAL stock a new settlement absorbs, by residence density (tArrival):
const ANC_LOCAL_FRONTIER = 0.22;  // on a just-peopled frontier (sparse residents) the founders dominate → replacement-leaning
const ANC_LOCAL_SETTLED  = 0.85;  // on ancient, densely-settled land the incomers are absorbed → the place keeps its stock (bootload)
const SETTLER_BARRIER    = 0.85;  // strength of the "white man's grave": how far an endemic-disease gap the incomers
                                  // have no immunity to pushes the stock back toward the adapted locals (0 = none, 1 = total)
export function dominantAnc(s) { return s.ancMix && s.ancMix.length ? s.ancMix[0][0] : -1; }
function normAnc(pairs) {
  let t = 0; for (const e of pairs) t += e[1]; if (t <= 0) return [];
  const out = pairs.map(([id, sh]) => [id, sh / t]).filter(e => e[1] > 0.012);
  let t2 = 0; for (const e of out) t2 += e[1]; for (const e of out) e[1] /= t2;
  out.sort((a, b) => b[1] - a[1]);
  return out.slice(0, 5);                 // keep the top handful of stocks
}
function blendAnc(a, wA, b, wB) {
  const m = new Map();
  if (a) for (const [id, sh] of a) m.set(id, (m.get(id) || 0) + sh * wA);
  if (b) for (const [id, sh] of b) m.set(id, (m.get(id) || 0) + sh * wB);
  return normAnc([...m.entries()]);
}
function seedAncestry(world, s, opts) {
  const anc = world.ancestry;
  const ti = (s.pos.y | 0) * world.tw + (s.pos.x | 0);
  const localId = anc ? anc[ti] : -1;
  const local = localId >= 0 ? [[localId, 1]] : [];
  const par = opts.parentId != null && opts.parentId >= 0 ? findSettlementById(world, opts.parentId) : null;
  if (!(par && par.ancMix && par.ancMix.length)) { s.ancMix = local; return; }
  // DEMOGRAPHIC admixture — the share of LOCAL stock the settlement takes scales with how densely
  // the destination is ALREADY peopled, read from residence time (tArrival: 0 = the ancient, deeply
  // settled cradle of humanity → 1 = a frontier the wavefront only just reached). Long-settled land
  // has a large resident population that ABSORBS the incomers (high local share → BOOTLOAD: Africa
  // keeps its stock while adopting Old-World crops/iron); a thinly-peopled frontier is dominated by
  // the FOUNDERS (low local share → REPLACEMENT-leaning: the settler Americas/Australia). Comparable
  // weights → a real BLEND. The mode thus emerges from geography, never a per-region tag.
  const arr = world.tArrival ? Math.max(0, Math.min(1, world.tArrival[ti])) : 0.5;
  let localShare = localId >= 0 ? ANC_LOCAL_FRONTIER + (ANC_LOCAL_SETTLED - ANC_LOCAL_FRONTIER) * (1 - arr) : 0;
  // SETTLER DISEASE BARRIER — "the white man's grave". The incomers carry immunity matched to their
  // HOME pathogen burden; dropped into a land whose endemic tropical disease (malaria, yellow fever,
  // sleeping sickness — habitability.js malariaSignal) far exceeds it, they die before they can
  // establish a dense settler society, so the long-adapted LOCAL stock keeps the land even on a
  // frontier (the Congo, the Amazon, New Guinea stay indigenous). A founder from an EQUALLY tropical
  // home (a Bantu farmer expanding through the forest) carries that immunity → no barrier → they
  // settle and admix freely. It is the disease-burden GAP, never a per-region tag, that does the work
  // — and it is asymmetric (it bars the outsider, not the adapted local), which is the whole point.
  if (localShare > 0 && world.temp && world.moist) {
    const pti = (par.pos.y | 0) * world.tw + (par.pos.x | 0);
    const barrier = Math.max(0, malariaSignal(world.temp[ti], world.moist[ti]) - malariaSignal(world.temp[pti], world.moist[pti]));
    localShare = localShare + (1 - localShare) * barrier * SETTLER_BARRIER;
  }
  s.ancMix = localShare > 0 ? blendAnc(par.ancMix, 1 - localShare, local, localShare) : par.ancMix.slice();
}

// ── Forced migration (T.SLAVE_PEOPLE): captives are PEOPLE, and people carry identity ──
// Coerced flows (slave raids, the sack of cities, horde razzias) are demographic events,
// not labour-stat transfers. Each captor keeps a count-weighted pool of its captives'
// origin peoples (_captiveCul) and deep stocks (_captiveAnc); when captives ARRIVE
// somewhere — bought on the market, or put to work by the captor itself — they join
// s.people and admix the destination's culMix/langMix/ancMix exactly as founding
// migration does. This is the THIRD admixture source after founding migration and
// in-place drift (conquest still moves rulers, never peoples) — and it is what put
// African-descended populations across the plantation belts of the Americas: bondage
// moved PEOPLES. Under the lever the population ledger CONSERVES people the way the
// money ledger already conserves coin (victim → captive in transit → resident unfree).
function addPairsScaled(pool, pairs, n) {
  const out = pool || [];
  if (!pairs || !pairs.length || !(n > 0)) return out;
  for (const [id, sh] of pairs) {
    if (id == null || id < 0 || !(sh > 0)) continue;
    let e = null; for (const p of out) if (p[0] === id) { e = p; break; }
    if (e) e[1] += sh * n; else out.push([id, sh * n]);
  }
  return out;
}
/** Record `n` captives seized from `victim` into `captor`'s origin pools. */
export function recordCaptives(captor, victim, n) {
  if (!T.SLAVE_PEOPLE || !(n > 0)) return;
  captor._captiveCul = addPairsScaled(captor._captiveCul, victim.culMix, n);
  captor._captiveAnc = addPairsScaled(captor._captiveAnc, victim.ancMix, n);
}
/** Scale a captor's origin pools down when `taken` of its `stock` captives leave / are put to work. */
export function drainCaptivePools(captor, taken, stock) {
  if (!T.SLAVE_PEOPLE || !(taken > 0) || !(stock > 0)) return;
  const keep = Math.max(0, 1 - taken / stock);
  if (captor._captiveCul) { if (keep <= 0) captor._captiveCul = []; else for (const e of captor._captiveCul) e[1] *= keep; }
  if (captor._captiveAnc) { if (keep <= 0) captor._captiveAnc = []; else for (const e of captor._captiveAnc) e[1] *= keep; }
}
/** `count` captives of origin mixture culPairs/ancPairs (count-weighted; may be null)
    ARRIVE at `dest`: they join its population and admix its identity layers. */
export function arriveCaptives(world, dest, count, culPairs, ancPairs) {
  if (!T.SLAVE_PEOPLE || !(count > 0)) return;
  dest.people = (dest.people || 0) + count;
  fieldShift(world, dest, count);   // one population: the forced arrivals stand on this ground now (FIELD_DEMOG)
  const frac = count / Math.max(1, dest.people);
  if (culPairs && culPairs.length) admixArrivals(world, dest, culPairs, frac);
  if (ancPairs && ancPairs.length) {
    const arriving = normAnc(ancPairs.map(e => [e[0], e[1]]));
    if (arriving.length) dest.ancMix = blendAnc(dest.ancMix, 1 - frac, arriving, frac);
  }
}

export function makeSettlement(world, x, y, opts = {}) {
  const id = world._nextSettlementId || 1;
  world._nextSettlementId = id + 1;
  // (ONE_POP: the founders are placed onto the FIELD after the object exists — see below)
  const s = {
    id,
    kind: "settlement",
    pos: { x: Math.floor(x) + 0.5, y: Math.floor(y) + 0.5 },
    foundedStep: world.step,
    parentSettlementId: opts.parentId ?? -1,
    name: opts.name || `settlement-${id}`,
    people: opts.people ?? 25,
    // Start at the tier-0 storage cap (see storageCap in updateFood);
    // a larger value would just be clamped away on the first tick.
    food: 80,
    knowledge: opts.knowledge || (opts.cradle ? {
      // A CRADLE seeds at the EVE OF STATES — the display epoch is 3000 BC
      // (calendar.js DISP_START) and this is what 3000 BC WAS: proto-urban
      // irrigation towns (late Uruk, Naqada III, Longshan) with temple
      // administration on the verge of kingship, and copper metallurgy already
      // millennia old. The old stone-age seed (agr .5 / org .1 / met 0) spent
      // ~1600 displayed years growing INTO the state the start date already
      // claims — the measured 5.3x "Neolithic" start-up row (probe_erapace).
      // Initial CONDITIONS of the world at t=0, not a gate on anything.
      agriculture: 0.55,        // mature floodplain/irrigation farming
      construction: 0.20,       // mudbrick towns, the first monumental works
      organization: 0.28,       // temple accounts / proto-writing — kingship at the door
      metallurgy:  0.16,        // chalcolithic copper (ore access still gates practice)
      navigation:  0.05,        // river craft
      mobility:    0.05,        // pack animals
    } : {
      agriculture: 0.50,        // frontier starts already farming (absorbs the old foraging track)
      construction: 0.1,        // absorbs the old toolmaking track (wagons + bridges)
      organization: 0.1,        // absorbs the old literacy track (records + bureaucracy)
      metallurgy:  0,           // gated by ore access
      navigation:  0,           // gated by water access
      mobility:    0,           // gated by horses
    }),
    // Crop packages this settlement has (ids into src/cropPackages.js). Empty
    // unless T.CROP_AXIS is on; seeded at creation (cradle domestication /
    // parent inheritance) and grown by crop diffusion in updateKnowledge. The
    // best STORABLE member at the home tile is the farming ceiling (cropCeil).
    crops: [],
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
    // tier 0 = rural farming region (a collection of villages); tiers 1+ are
    // URBAN nodes (town/city/metropolis). A farming region never urbanises in
    // place (updateTier) — it BIRTHS a separate town within its catchment
    // (urban genesis, crystallize.js), seeded at tier 1 via opts.tier.
    tier: opts.tier ?? 0,
    mode: "settled",
    lastFoundAttempt: world.step,

  };
  // Migrate older knowledge objects (e.g. crystallization inheritance)
  // that don't have the new fields.
  for (const k of ["metallurgy","navigation","mobility"]) {
    if (s.knowledge[k] === undefined) s.knowledge[k] = 0;
  }
  // Compute water access score from the home tile + 4 neighbours.
  s.countryId = opts.countryId ?? s.id;             // joins parent's realm if specified, else own city-state
  // ── Who lives here: culture stock + a name in that people's tongue ──
  // A cradle is the birth of a PEOPLE (founds a culture); everything else
  // carries its founder stock's culture. Explicit opts.name wins (imports).
  {
    let cul = null;
    if (opts.cradle) cul = foundCulture(world, { origin: s });
    else if (opts.cultureId != null && opts.cultureId >= 0) cul = getCulture(world, opts.cultureId);
    seedCulture(world, s, cul ? cul.id : -1);
    if (cul && !opts.name) s.name = nameFor(world, cul, "settlement");
  }
  seedAncestry(world, s, opts);   // deep genetic stock: local substrate, admixed if founded from afar
  // Heritable organisation aptitude: a colony's founders carry their parent's
  // aptitude in FULL (they ARE that people); a fresh cradle/frontier starts at
  // zero and only the right climate ratchets it up (seasonalSelect, ratcheted in
  // updateKnowledge). Diluted afterwards only by in-migration of other stock.
  {
    const aptPar = (opts.parentId != null && opts.parentId >= 0) ? findSettlementById(world, opts.parentId) : null;
    s._orgApt = aptPar ? (aptPar._orgApt || 0) : 0;
  }
  rederiveSiteStatics(world, s);
  s._rivalN = 0;                                           // distinct rival polities in contact (refreshed in updateKnowledge)
  world.settlements.push(s);
  if (T.ONE_POP) fieldShift(world, s, s.people || 0);   // one population: the founders stand on this ground (their SOURCE was debited where they left)
  seedLocalTerritory(world, s);   // food/resource stats until the first full territory pass
  // Crop-package ownership (T.CROP_AXIS). Off → stays empty (unused). A cradle
  // domesticates its best local crop; a colony/daughter inherits its parent's
  // crops (off-climate ones cost nothing — cropCeil reads suitability locally);
  // a frontier village starts empty and acquires crops by diffusion / later
  // mature domestication.
  if (T.CROP_AXIS > 0) {
    if (opts.crops) { for (const id of opts.crops) if (!s.crops.includes(id)) s.crops.push(id); }
    else if (opts.cradle) { const b = bestPackageAt(world, (y | 0) * world.tw + (x | 0)); if (b) s.crops.push(b.id); }
    else if (opts.parentId != null && opts.parentId >= 0) {
      const par = findSettlementById(world, opts.parentId);
      if (par && par.crops) for (const id of par.crops) if (!s.crops.includes(id)) s.crops.push(id);
    }
    s._cropCeil = undefined;
  }
  // Record the birth in the world's event log; a cradle also founds the
  // first polity of its river valley.
  logEvent(world, "settlement.founded", {
    s: s.id, sName: s.name, x: s.pos.x | 0, y: s.pos.y | 0,
    kind: opts.cradle ? "cradle" : (opts.kind || (opts.parentId != null && opts.parentId >= 0 ? "settled" : "crystallized")),
    parent: opts.parentId ?? -1, polity: opts.countryId ?? -1,
  });
  if (opts.cradle) ensurePolity(world, s.id, { how: "cradle", seat: s });
  // _techEff is left UNSET here: at creation _metalCap is undefined, so seeding it now
  // (techEffects(s.knowledge, …)) would bake in an UNCAPPED metallurgy tier that ignores
  // the reachable-ore cap (B51). The lazy techEff() path fills it — via practisedK, so it
  // respects _metalCap — on first use, and the KNOW_INTERVAL refresh keeps it capped;
  // direct readers (territory.js, countryTerritory.js) already fall back when it's unset.
  return s;
}

// Water-access score: 0 (landlocked, no river) to ~1 (coastal city
// on a great river), scanned over the 3×3 block around home. Coast
// contributes 0.5; river magnitude scales linearly: mag 1 → 0.2,
// mag 3 → 0.6, mag 4 → 0.8. Capped at 1.
// A dying settlement's coin doesn't evaporate (review B72 — the last silent
// drain on the closed supply): it is STRANDED in the ground at its home tile
// as a ruin hoard, recovered gradually by whoever later works that land
// (territory.js reclaimRuins) — buried strongboxes, spolia, the classic
// hoard archaeology. Conserved: the invariant watch counts hoards.
export function bankRuinHoard(world, s) {
  const w = s.wealth || 0;
  if (!(w > 0)) return;
  const ti = (s.pos.y | 0) * world.tw + (s.pos.x | 0);
  const m = world._ruinHoards || (world._ruinHoards = new Map());
  m.set(ti, (m.get(ti) || 0) + w);
  s.wealth = 0;
}

// Static site attributes — pure functions of position + immutable terrain,
// computed once at founding. Exported so loadWorld can re-derive them for
// settlements whose save predates their serialization (cheap and
// deterministic, so recomputation is exact).
export function rederiveSiteStatics(world, s) {
  const x = s.pos.x | 0, y = s.pos.y | 0;
  const _wa = computeWaterAccess(world, x, y);
  s.waterAccess = _wa.wa;
  s._riverAcc = _wa.river;                       // river component of water access (aridSignal input)
  s._buildableArea = computeBuildableArea(world, x, y);
  s._confine = computeConfinement(world, x, y);  // circumscription (static terrain)
  s._rugged = computeRuggedness(world, x, y);    // broken terrain → fragmentation (static)
}

function computeWaterAccess(world, sx, sy) {
  const { tw, th, coast, riverMag } = world;
  // The scan is a fixed 3×3 in tiles → a SHRINKING real area at high resolution, where a river
  // channel is also thinner (1-D on 2-D). Under RES_INV_RIVER, cover the SAME REAL neighbourhood
  // at any grid: radius = round(rNorm) tiles (rNorm=1 at the 480 reference ⇒ radius 1 ⇒ the
  // original 3×3, byte-identical). So a settlement detects the same river valley regardless of grid.
  const R = T.RES_INV_RIVER ? Math.max(1, Math.round(rNormPop(world))) : 1;
  let coastBit = 0, bestMag = 0;
  for (let dy = -R; dy <= R; dy++) {
    const ny = sy + dy;
    if (ny < 0 || ny >= th) continue;
    for (let dx = -R; dx <= R; dx++) {
      const nx = ((sx + dx) % tw + tw) % tw;
      const ni = ny * tw + nx;
      if (coast[ni]) coastBit = 1;
      if (riverMag) {
        const m = riverMag[ni] || 0;
        if (m > bestMag) bestMag = m;
      }
    }
  }
  // .wa = combined coast+river access (fishing/shipping); .river = RIVER-only access
  // (irrigation — a managed river through dry land, NOT the sea/coast).
  return { wa: Math.min(1, coastBit * 0.5 + bestMag * 0.2), river: Math.min(1, bestMag * 0.3) };
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
  const reach = mergeReach(s);   // road + sea: the tin trade crossed water (review I41)
  if (!reach || reach.size === 0) return own;
  const out = { ...own };
  for (const peerId of reach.keys()) {
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

// Ore tier a resource bundle can support — the metallurgy that ore lets a site
// actually PRACTISE (independent of what it KNOWS): copper 0.30 → +tin bronze
// 0.65 → iron 0.90 → +coal steel 1.00, nothing without copper or iron. Used both
// for the knowledge cap (over REACHABLE ore, effectiveLocalRes) and for export
// metalwork (over PHYSICALLY-HELD ore, localRes — you forge from ore in hand).
const ORE_THR = 0.10;
function oreTier(res) {
  const cu = res.copper || 0, sn = res.tin || 0, fe = res.iron || 0, co = res.coal || 0;
  let cap = 0;
  if (cu > ORE_THR)                 cap = 0.30;
  if (cu > ORE_THR && sn > ORE_THR) cap = Math.max(cap, 0.65);
  if (fe > ORE_THR)                 cap = Math.max(cap, 0.90);
  if (fe > ORE_THR && co > ORE_THR) cap = 1.00;
  return cap;
}
// Craft-sector weights. TEXTILES were the LARGEST pre-modern manufacture by far
// (Flemish/Florentine wool, Indian cotton, Chinese silk) — the universal town
// industry — so they're the default "goods". METALWORK is now an ore-gated
// SPECIALTY (Toledo, the Ruhr), not the thing every town read as. Pottery /
// woodcraft / leather are the broad everyday crafts.
// Craft weights. Textiles were the largest pre-modern manufacture, but they are a
// CLIMATE specialty (wool needs temperate pasture, cotton warm-wet ground), NOT a
// universal floor every town shares — a fibre-poor desert/tundra/rainforest town
// leads with something else. Metalwork is the ore specialty; SERVICES (the counting-
// house, entrepôt trade, the chancery) are the BIG-CITY specialty that makes a
// Venice/Amsterdam lead on commerce, not cloth; pottery/leather/wares are the broad
// everyday crafts. Differentiated so a settlement's GEOGRAPHY (climate, ore, coast,
// size, farmland) picks which sector leads — economic variety across the map.
const TEXTILE_W = 2.4;   // the loom — leads where fibre (wool/cotton) is genuinely abundant
const METAL_W   = 1.9;   // the forge — ore-gated: rich ore regions out-earn the loom
const POTTERY_W = 0.6;   // pottery / woodcraft / leather — broad everyday crafts
const SERVICE_W = 1.4;   // counting-house / entrepôt — leads in large, organised commercial cities
// Reference "fully-realised" output for each craft, used to pick a town's COMPARATIVE
// advantage (legs[k] / ref) — the sector it's closest to maxing out — rather than its
// absolute-largest leg. A pure ore town then locks into metal even though cloth might
// out-earn it in raw coin, exactly as real towns specialised in what they were
// RELATIVELY best at and traded for the rest. This is what spreads specialties across
// the map instead of every town chasing the single globally-strongest sector.
const CRAFT_REF = {
  "Textiles": 2.0, "Metalwork": 1.9, "Pottery & leather": 0.6,
  "Crafted wares": 0.3, "Services & records": 1.4,
};
// Shared craft recipe so computeExportValue and getExportBreakdown can't drift.
// Returns the RAW manufactured-sector legs (pre craftFrac / mult / cluster-boost),
// keyed by label, including each town's fixed idiosyncratic edge.
function craftLegs(s, k, r) {
  const popScale = Math.min(1, Math.log(Math.max(1, s.people || 0)) / 8);
  const craft = 0.4 + (k.construction || 0) * 0.5;                  // general artisanship
  const temp = s._climTemp ?? 0.5, moist = s._climMoist ?? 0.5;
  const wool   = Math.max(0, 1 - Math.abs(temp - 0.45) * 2.2);      // temperate pasture
  const cotton = Math.max(0, (temp - 0.55) * 2.2) * Math.max(0, (moist - 0.4) * 2);   // warm & wet
  // Fibre is a CLIMATE endowment (wool + cotton), with only a small flax/agri floor —
  // so cloth is a regional specialty, not the universal default it used to be.
  const fibre  = 0.2 + 0.8 * Math.min(1, wool + cotton + (k.agriculture || 0) * 0.15);
  const physMetalCap = oreTier(r);
  const legs = {
    "Textiles":          TEXTILE_W * fibre * (0.55 + 0.45 * popScale) * craft,
    "Metalwork":         physMetalCap > 0 ? Math.min(k.metallurgy || 0, physMetalCap) * METAL_W : 0,
    "Pottery & leather": POTTERY_W * popScale * (0.4 + (r.timber || 0) * 0.3 + (r.horses || 0) * 0.3),
    "Crafted wares":     (k.construction || 0) * 0.3,
    // Services scale super-linearly with city size (popScale²): a great metropolis is a
    // commercial/financial hub whose trade & administration dwarf its workshops.
    "Services & records": SERVICE_W * (k.organization || 0) * popScale * popScale,
  };
  // Idiosyncratic founding edge — a fixed, deterministic per-town bias on each sector
  // (the master weaver / smith who happened to settle here). Breaks ties so towns with
  // identical geography still differ; small enough that real geography still dominates.
  if (T.AGGLOM_IDIO > 0) {
    const sid = s.id || 1;
    for (const key in legs) legs[key] *= Math.max(0, 1 + T.AGGLOM_IDIO * (hash32(sid, key) / 4294967296 - 0.5) * 2);
  }
  return legs;
}
// AGGLOMERATION lock-in (increasing returns): multiply a town's ESTABLISHED specialty
// (_specKey, the comparative-advantage sector it has committed to, strength _specStr)
// so the cluster compounds — Florence→wool, Toledo→steel, Murano→glass. Applied by
// BOTH the economy (computeExportValue) and the panel (getExportBreakdown) so they
// can't drift. Separate from craftLegs so the comparative-advantage PICK reads the raw
// geographic profile (lets industry move when the geography changes), not the boost.
function applyClusterBoost(legs, s) {
  if (T.AGGLOM_W > 0 && s._specKey && legs[s._specKey] != null) {
    legs[s._specKey] *= 1 + T.AGGLOM_W * (s._specStr || 0);
  }
  return legs;
}

// Cache a settlement's home-tile climate — latitude band (0 = equator,
// 1 = pole), temperature and moisture (worldgen's 0..1 scales). Terrain is
// static, so this is computed once and reused by the knowledge model
// (continental-axis diffusion + climate specialization).
function climateOf(world, s) {
  if (s._climLat !== undefined) return;
  const ty = Math.min(world.th - 1, Math.max(0, s.pos.y | 0));
  const tx = ((s.pos.x | 0) % world.tw + world.tw) % world.tw;
  const ci = ty * world.tw + tx;
  s._climLat   = Math.abs((ty / world.th) * 2 - 1);
  s._climTemp  = world.temp[ci]  ?? 0.5;
  s._climMoist = world.moist[ci] ?? 0.5;
}

// Cached tech-derived bonus channels (tech.js techEffects) for a settlement —
// what its DISCOVERED techs grant: farmYield, fishFactor, buildLevel, military,
// reach, abilities, etc. This is what the sim reads instead of the raw
// continuous tracks (the tree gives the bonuses; the tracks earn the tree).
// Refreshed every KNOW_INTERVAL ticks in updateKnowledge (knowledge drifts
// slowly); filled lazily here for a settlement inspected before its first tick.
// The knowledge the sim's EFFECTS may draw on: metalworking AWARENESS capped to
// what the reachable ore lets a culture actually forge (metalCap). Knowing iron
// ≠ holding it — so the tech BONUSES (military, tools, …) read this capped view,
// while the tech TREE reads the raw knowledge (what the culture knows). Returns k
// untouched when nothing is capped, so the common case allocates nothing.
function practisedK(k, metalCap) {
  if (k == null || metalCap == null || (k.metallurgy || 0) <= metalCap) return k;
  return { ...k, metallurgy: metalCap };
}
function techEff(s) {
  if (!s._techEff) s._techEff = techEffects(practisedK(s.knowledge, s._metalCap), T.TECH_EFFECTS);
  return s._techEff;
}
export { techEff };

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
// dry forever. This is how fresh money enters the system; every
// settlement otherwise starts at ZERO coin (makeSettlement — barter).
//
// CIRCULATION — bilateral trade. On every road both partners sell their
// goods to each other, so money flows BOTH ways and keeps moving by
// velocity instead of pooling. A cash-poor town still earns by selling
// what little it makes, so it never freezes at its reserve. Gold-rich
// (but goods-poor) mining towns are net buyers, spending their specie
// outward — that's how mined money spreads to the rest of the economy.
// MINING_RATE -> runtime lever (tuning.js T.MINING_RATE)
// Credit contraction runs this multiple of the build-up easing rate: a run on the
// bank is intrinsically faster than deposit growth (confidence compounds slowly,
// evaporates at once — 1637, 1720, 1873). An asymmetry of the mechanism itself,
// not a tunable outcome: expansion ~a generation to full depth at the default
// CREDIT_RATE, a crunch ~a few years.
const CREDIT_CRUNCH = 4;
// SCI_COMPOUND bounds: the medieval-typical hub's knowledge-production index (the
// curve's =1 anchor — where the measured era pacing is already 1.0×), and the
// floor/cap on the correction while the exponent is calibrated. Floor keeps a
// fresh cradle learning (deep antiquity is already ~right); cap keeps a
// discovery from teleporting a track in one tick.
// FLOOR 0.7 (was 0.6): the floor is the antiquity learning rate — the whole
// Bronze window sits below the anchor (idx 0.3-1.1 → (idx/1.6)^1.5 ≈ 0.09-0.57,
// floored), so the Bronze SPAN ∝ 1/floor. The 3-seed table priced 0.6 at 1.6×
// the historical span; with the eve-of-states genesis seed (makeSettlement) also
// lifting the early window's inputs, the measured correction that lands Bronze
// at ~1× is 0.7 (0.95 overshot to 0.7× — the two changes stack). Calibrated to
// the SPAN, never to a date: the display epoch (calendar.js −3000) then simply
// fits.
const SCI_MED_IDX = 1.6, SCI_COMPOUND_FLOOR = 0.7, SCI_COMPOUND_CAP = 12;
function updateWealth(world, s) {
  // Coin-loss drain (Phase 1 — the honest micro-sink replacing the freight burn):
  // a sliver of circulating specie leaves for good each tick — worn, shipwrecked,
  // buried in hoards, melted to plate. Runs for EVERY settlement (before the
  // mining-only return) so the money supply settles at an equilibrium between
  // mint inflow and this realistic drain, instead of the freight burn.
  if (T.COIN_LOSS_RATE > 0 && s.wealth > 0) s.wealth -= s.wealth * T.COIN_LOSS_RATE * (world._dt || 1);   // per-tick specie drain → granularity-scaled
  // CREDIT (Phase 5, default ON): a BANKING hub creates credit money on top of its
  // specie — the fractional-reserve / bills-of-exchange layer that made Venice &
  // Amsterdam rich with no mines. Gated on the banking INSTITUTION (the discrete
  // banking tech's `credit` ability — bills of exchange need banks, exactly as the
  // monetization gauge gates a cash economy on the currency tech's `market`; the
  // old raw org>0.45 proxy fired half the organization track before anyone built
  // one). Depth then grows with organization BEYOND the banking gate (0.70→1:
  // goldsmith notes → giro banks → joint-stock finance) and with market breadth
  // (trade partners — a bill of exchange needs correspondents to clear through),
  // up to CREDIT_MAX_MULT × specie backing. When commerce COLLAPSES (a sack,
  // severed trade, lost institution) the target falls and credit is CALLED IN at
  // CREDIT_CRUNCH × the build-up rate — panics run faster than deposit growth —
  // contracting the money supply (the dark-age crunch). Credit is tracked
  // separately (s._credit) so it stays bounded — contraction never pushes wealth
  // negative or unwinds money it lacks. Everything gates on the settlement's own
  // emergent tech/commerce, never era/time; rates are dt-scaled like COIN_LOSS so
  // SIM_GRANULARITY leaves the arc invariant.
  if (T.CREDIT_RATE > 0) {
    const cur = s._credit || 0;
    const base = Math.max(0, (s.wealth || 0) - cur);                      // specie backing the credit
    const org = (s.knowledge && s.knowledge.organization) || 0;
    const reachF = s._tradeReach ? Math.min(1, s._tradeReach.size / 12) : 0;
    const depth = 0.25 + 0.75 * Math.min(1, Math.max(0, (org - 0.70) / 0.30));   // a new bank multiplies modestly; finance deepens with statecraft
    const bankF = techEff(s).credit ? depth * reachF : 0;
    const gap = base * (T.CREDIT_MAX_MULT - 1) * bankF - cur;
    const rate = Math.min(1, T.CREDIT_RATE * (world._dt || 1) * (gap < 0 ? CREDIT_CRUNCH : 1));
    const delta = gap * rate;
    if (delta > 0) { s._credit = cur + delta; s.wealth = (s.wealth || 0) + delta; recordIn(s, IN_CREDIT, delta); }   // conjured money is FINANCE, not goods sold (B17)
    else if (delta < 0) { const take = Math.min(-delta, s.wealth || 0, cur); if (take > 0) { s._credit = cur - take; s.wealth -= take; recordOut(s, OUT_CREDIT, take); } }   // credit called in, not goods bought (B17)
  }
  // Luxury budgets refresh for EVERY settlement, every tick — supply from the
  // luxury resources its territory holds, demand from its spare coin. This must
  // run BEFORE the mining-only early-returns below: it used to sit after them,
  // which silently disabled the whole luxury economy for any settlement without
  // a precious/gem mine (≈97% of the map — only 6 of 185 settlements earned any
  // luxury coin in an 8k-step probe) and left STALE budgets compounding ×stride
  // on settlements that had lost their mines.
  computeLuxury(s, world);
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
    // Coerced labour intensifies extraction — more specie out, reserves depleted FASTER
    // (Potosí's mita): a deadly mining boom that burns through both the seam and its slaves.
    const coerceMine = T.SLAVERY ? 1 + T.MINE_COERCE * Math.min(2, (s._unfree || 0) / Math.max(1, s.people || 1)) : 1;
    const want = T.MINING_RATE * richness * popFactor * orgMul * coerceMine * (world._dt || 1);   // mining income per tick → granularity-scaled
    const got = want < left ? want : left;
    reserveArr[ti] = left - got;
    mined += got;
  }
  // Minting (Phase 1): the realm's MINT coins the new specie, taking SEIGNIORAGE
  // to the treasury before paying the miner the rest — so money creation is a
  // state act, not pure geology. A stateless miner (no government yet) keeps the
  // lot (the cut is only taken when there is a treasury to receive it, so no coin
  // is destroyed). govOf is inlined here to avoid a settlement↔conquest cycle.
  let seig = 0;
  if (T.SEIGNIORAGE_RATE > 0 && s.countryId >= 0 && world.polities) {
    const g = getPolity(world, s.countryId);
    if (g) { seig = mined * T.SEIGNIORAGE_RATE; g.treasury += seig; }
  }
  s.wealth = (s.wealth || 0) + mined - seig;
  recordIn(s, IN_MINING, mined - seig);
  // Smoothed mining income, for the money-flow overlay's source markers
  // (mining is the only money entering the system).
  s._minedRate = (s._minedRate || 0) * 0.9 + mined * 0.1;
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
  const sp = sackPenalty(s, world);
  s._luxSupply = luxRes * LUX_SUPPLY_RATE * popF * sp * sp;
  const spare = Math.max(0, (s.wealth || 0) - getWealthReserve(s));
  // Luxury is URBAN / elite consumption — silks, spices, furs for a town's wealthy class. A
  // farming village (tier 0) is a subsistence peasant community: even a cash-rich one buys
  // little luxury (it saves / reinvests in land + stock), so its appetite is LUX_VILLAGE_FRAC.
  const luxClass = (s.tier | 0) >= 1 ? 1 : T.LUX_VILLAGE_FRAC;
  s._luxDemand = spare * LUX_SPEND_FRAC * luxClass;
  s._luxSupplyLeft = s._luxSupply;   // drawn down across partners in the trade pass
  s._luxDemandLeft = s._luxDemand;
}
export { updateWealth };

// ── Coerced labour: slaves, cash crops & intensified mining ──────────────────
// Coerced labour is NOT a relabel of population — it does what free pop structurally
// can't: work land for CASH CROPS (so the land stops feeding itself and must import
// food), intensify mining, and pump owner-concentrated wealth without becoming citizens
// — at the cost of a death-sink and revolt risk. See docs/coerced-labor.md. Everything
// gates on climate / deposits / wealth / food — never on time/era (the cardinal rule).
//
// Tropical export-crop suitability (sugar & coffee want it hot AND wet; cotton warm).
// ~0 in temperate / cold / arid land — the geography that made the plantation zones.
function cashSuit(s) {
  const t = s._climTemp ?? 0.5, m = s._climMoist ?? 0.5;
  const sugar  = Math.max(0, (t - 0.55) * 2.2) * Math.max(0, (m - 0.45) * 2.2);              // hot & wet
  const cotton = Math.max(0, (t - 0.5) * 1.6) * Math.max(0, 1 - Math.abs(m - 0.45) * 2.2);   // warm
  return Math.min(1.5, sugar + 0.5 * cotton);
}
const CASHCROP_LAND   = 0.85;   // fraction of arable a fully-cash-cropped settlement pulls OFF food
const ALLUVIUM_COAST  = 0.5;    // coastal lowland gets this share of a river floodplain's silt-fertility lift (delta/plain/polder farming)
const FISH_LAND_REF   = 8.0;    // land-food-per-tile above which farming is rich enough that fish stops mattering (the cradles sit well above)
const SLAVE_MINE_PULL = 0.6;    // mining's coerced-labour demand weight
const ESTATE_PULL     = 1.0;    // latifundia gang-labour demand weight (a fully-consolidated estate belt pulls like full cash-crop suitability)

// Evolve a settlement's coerced-labour stock, its cash-crop land allocation, and its
// plantation output. Called once per tick from updateSettlement (after updateWealth, so
// it reads fresh wealth; mining/food read last tick's _unfree, which drifts slowly).
export function updateCoercedLabour(world, s) {
  if (!T.SLAVERY || s.mode !== "settled") { if (s._unfree) { s._unfree = 0; s._cashFrac = 0; } return; }
  const cs = cashSuit(s); s._cashSuit = cs;
  const hasMine = (s._minableTiles && s._minableTiles.length) ? 1 : 0;
  // Latifundia (conquest.js): countryside consolidated into elite estates demands GANG
  // labour — the classical demand engine, needing no cash-crop climate and no mine (Rome's
  // temperate Italies). A stateless settlement's estates lose their grip — the lord class
  // was the state's — receding on the same tenure clock they consolidated on.
  let est = 0;
  if (T.LATIFUNDIA && (s._estates || 0) > 0) {
    if (s.countryId < 0) s._estates = Math.max(0, s._estates - 0.0008 * (world._dt || 1));
    est = s._estates;
  }
  // The plantation is an EXPORT business, and it CONCENTRATES:
  //  • CONVEX suitability (cs²/CS_MAX): fixed costs + comparative advantage meant
  //    marginal cash land was never planted at all while prime land got everything —
  //    the plantation economy lives in its best belts, not smeared over every warm
  //    village (measured: linear cs put a diffuse ~20% coerced across the whole
  //    subtropics once supply turned elastic).
  //  • The MARKET gate: gang labour is only worth buying in proportion to how well
  //    this place's luxuries actually SELL (smoothed realized income vs offered) —
  //    a poor world buys no sugar, so the tropics wait for RICH BUYERS (the Atlantic
  //    timing, via wealth, never a date), with a small speculative floor so the
  //    first planters can trial prime cash ground.
  // Before the price-responsive market (SLAVE_PULL) both were moot — chronic supply
  // starvation hid them — so they ride that lever for byte-identical off.
  const csDem = T.SLAVE_PULL > 0
    ? (cs * cs / 1.5) * (0.15 + 0.85 * Math.min(1, ((s._mInRate && s._mInRate[IN_LUXURY]) || 0) / Math.max(0.5, s._luxSupply || 0)))
    : cs;
  const labourDemand = csDem + SLAVE_MINE_PULL * hasMine + ESTATE_PULL * est;   // coerced labour this site could USE
  // Food security: can it feed extra mouths AND afford to stop growing its own food?
  // surplus on hand + a trade link to import grain (a plantation must import food).
  const surplus = Math.max(0, (s._foodSupply || 0) - (s._foodDemand || 0));
  const reachF = s._tradeReach ? Math.min(0.7, s._tradeReach.size / 12) : 0;
  const foodSec = Math.min(1, surplus / Math.max(1, s._foodDemand || 1) + reachF);
  // Wealth gates how much coerced labour it can buy & maintain (a cost proxy).
  const spare = Math.max(0, (s.wealth || 0) - getWealthReserve(s));
  const afford = Math.min(1, spare / (150 + (s._unfree || 0) * 3));
  // Sized by the settlement's economy (people as the land/capital proxy), NOT sqrt — a
  // plantation/mine can hold MORE unfree than free (the Caribbean was ~80% enslaved); the
  // revolt cap below keeps the ratio from running to 100%.
  // Under SLAVE_PEOPLE the unfree are INSIDE s.people, so the sizing proxy (and every
  // "free population" term below) is the FREE headcount — otherwise buying slaves would
  // inflate the very population the demand target is sized on (a runaway loop).
  const freePop = T.SLAVE_PEOPLE ? Math.max(1, (s.people || 0) - (s._unfree || 0)) : Math.max(1, s.people || 0);
  const target = T.SLAVE_TARGET * labourDemand * freePop * foodSec * afford;
  let u = s._unfree || 0;
  // The workforce comes from the slave TRADE (slavery.js), not thin air: work your OWN
  // captives first (a raider that also has plantations/mines uses what it seizes), then
  // post the residual as market DEMAND for slavery.js to fill from others' captives.
  const cap = s._captives || 0;
  if (cap > 0 && u < target) {
    const useLocal = Math.min(cap, target - u); u += useLocal; s._captives = cap - useLocal;
    // The captor puts its own captives to WORK: they become resident population here,
    // carrying their origin peoples into the local mixture (T.SLAVE_PEOPLE).
    if (T.SLAVE_PEOPLE && useLocal > 0) {
      arriveCaptives(world, s, useLocal, s._captiveCul, s._captiveAnc);
      drainCaptivePools(s, useLocal, cap);
    }
  }
  // Attrition — the death sink: mines & plantations are lethal, so the unfree must be
  // resupplied (this is what sustains the slave trade); mild for domestic/mixed work.
  // Under SLAVE_PEOPLE those deaths leave the population ledger too — they were people.
  // (estate gang labour is brutal — the chained ergastulum — though less lethal than sugar or Potosí)
  const harsh = 0.25 + 0.75 * Math.min(1, cs + 0.5 * hasMine + 0.4 * est);
  if (T.SLAVE_PEOPLE) {
    const dead = u * T.SLAVE_DEATH * harsh * (world._dt || 1);
    if (dead > 0) { u -= dead; const b = s.people; s.people = Math.max(1, (s.people || 0) - dead); fieldShift(world, s, s.people - b); }
  } else {
    u *= (1 - T.SLAVE_DEATH * harsh * (world._dt || 1));
  }
  // Revolt: a high unfree ratio with too little free population to police it boils over —
  // the estate is wrecked and most of the unfree are lost (Haiti, the Zanj rebellion).
  const ratio = u / Math.max(1, (s.people || 0) + (T.SLAVE_PEOPLE ? 0 : u));
  s._unfreeRatio = ratio;
  if (ratio > 0.6 && u > 50) {
    const r = hash32(world.seed || 1, "slaveRevolt", s.id, world.step) / 4294967296;
    if (r < T.SLAVE_UNREST * (ratio - 0.6) * 0.02 * (world._dt || 1)) {
      const lost = u * 0.75;
      u *= 0.25; s._sackedAt = world.step;                      // the revolt craters output
      if (T.SLAVE_PEOPLE) { const b = s.people; s.people = Math.max(1, (s.people || 0) - lost); fieldShift(world, s, s.people - b); }   // the dead and the fled leave the ledger — and the land
      logEvent(world, "slave.revolt", { s: s.id, sName: s.name || "a settlement" });
    }
  }
  s._unfree = Math.max(0, u);
  // Safety clamp (SLAVE_PEOPLE): the unfree live inside s.people, so any population sink
  // this file doesn't see (famine, missed shocks) must take its share of them too — never
  // more unfree than people. Keeps the invariant against every current and future sink.
  if (T.SLAVE_PEOPLE) s._unfree = Math.min(s._unfree, Math.max(0, (s.people || 0) - 1));
  s._slaveDemand = Math.max(0, target - s._unfree);   // residual demand → bought on the market (slavery.js)
  u = s._unfree;
  // Cash-crop land allocation drifts toward what's suitable, food-secure & labour-backed.
  const labourBacked = Math.min(1, u / Math.max(1, 0.25 * freePop));
  const cashTarget = cs > 0.05 ? Math.min(1, cs) * foodSec * labourBacked : 0;
  s._cashFrac = (s._cashFrac || 0) + 0.04 * (cashTarget - (s._cashFrac || 0));
  // Cash-crop OUTPUT → folded into the LUXURY supply (sugar/tobacco/coffee were the
  // colonial luxuries), so it trades as luxury income to the OWNER. Coerced labour
  // multiplies it into a real plantation; free peasants grow only a little.
  const arableScale = Math.min(1, (s._terrTiles || 0) / 120);
  const coerceMul = T.COERCE_CASH * Math.min(2, u / freePop);
  const cashOut = T.CASHCROP_W * cs * (s._cashFrac || 0) * arableScale * (0.25 + coerceMul) * (s._eraProd || 1);
  s._cashOut = cashOut;
  if (cashOut > 0) { s._luxSupply = (s._luxSupply || 0) + cashOut; s._luxSupplyLeft = (s._luxSupplyLeft || 0) + cashOut; }
}

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
function sackPenalty(s, world) {
  if (s._sackedAt == null || !world || world.step == null) return 1;
  // Recovery span in HISTORY time: same healing arc at any SIM_GRANULARITY
  // (matches the wither/isolation windows in this file).
  const recov = CONQUEST_RECOVERY / (world._dt || 1);
  const age = world.step - s._sackedAt;
  if (age >= recov) return 1;
  if (age < 0) return 1;
  return T.SACK_PRODUCTION_FLOOR + (1 - T.SACK_PRODUCTION_FLOOR) * (age / recov);
}
export function computeExportValue(s, world) {
  const k = s.knowledge || {};
  const r = s.localRes || {};
  const tier = s.tier | 0;

  // ── Primary sector (ag) ───────────────────────────────────────────────
  // The total `ag` is UNCHANGED, but it is split for the money panel into what
  // is genuinely FOOD (agFood — grain, forage, seafood: only the tiers that
  // FARM, plus its base subsistence surplus) vs RAW MATERIALS (agMat — timber /
  // stone / salt / draught stock). A town/city grows no food, so its base
  // output is urban goods, NOT "farm produce" — which is why a non-farming
  // settlement used to read, wrongly, as SELLING food. (sellGoods books the
  // three sectors; the food leg is suppressed unless the buyer is food-short.)
  const baseIsFood = farmsLand(s);   // DISSOLVE_FARMS: every town farms its own catchment
  let ag = 1.0;                                          // base primary output
  let agFood = baseIsFood ? 1.0 : 0;                     // farm village's base surplus is food; a town's base output is urban goods
  let agMat = 0;
  const agScale = Math.min(1, (s._terrTiles || 0) / 120);
  if (baseIsFood) {
    // Grain surplus scales with LOCAL FERTILITY: a rich river-valley breadbasket (Nile,
    // Sicily, the Black Earth) out-produces marginal ground many times over and STAYS a
    // grain exporter even after it grows and industrialises — so food remains a leading
    // export where the soil is genuinely rich, instead of fading everywhere as crafts
    // rise. Economic role follows geography. (Export attribution only — actual feeding
    // is foodHierarchy.js.)
    const homeTi = (s.pos.y | 0) * world.tw + (s.pos.x | 0);
    const fert = world && world.fert ? (world.fert[homeTi] || 0.5) : 0.5;
    const grain = (k.agriculture || 0) * agScale * (0.45 + 1.25 * fert);  // grain surplus, fertility-scaled
    const wild  = (k.agriculture || 0) * (r.timber || 0) * 0.4;   // wild-forest forage / game
    ag += grain + wild; agFood += grain + wild;
  }
  const matAccess = ((r.timber || 0) + (r.stone || 0)) * 0.5;
  const rawmat = (k.construction || 0) * matAccess * 0.8;          // RAW building materials (timber/stone)
  ag += rawmat; agMat += rawmat;
  if ((s.waterAccess || 0) > 0) {
    ag += (k.navigation || 0) * s.waterAccess * 0.5;     // coastal / river shipping — a SERVICE (booked as goods)
    // Fish / seafood — only the PRESERVED fraction (salt cod, etc.) trades for
    // coin; most is eaten fresh & locally, so it's minor next to the grain staple.
    const fish = s.waterAccess * (k.navigation || 0) * 0.3;
    ag += fish; agFood += fish;
  }
  const horses = r.horses || 0;
  if (horses > 0.05) { const h = horses * 0.6 + (k.mobility || 0) * 0.4; ag += h; agMat += h; }   // horses & draught stock → materials
  const salt = (r.salt || 0) * 0.5; ag += salt; agMat += salt;     // salt → materials
  // Base village/urban products — eggs & dairy (food) for a farm region, basketry
  // & hand-loom cloth (goods) for a town. 25 ppl → +0.14  1k → +0.30  10k → +0.40
  const base = Math.min(0.5, Math.log10(Math.max(1, s.people)) / 10);
  ag += base; if (baseIsFood) agFood += base;

  // ── Manufactured / service sector ─────────────────────────────────────
  // Diverse crafts (booked as "goods"): TEXTILES are the universal town industry,
  // METALWORK an ore-gated specialty, plus pottery, crafted wares and the
  // counting-house (craftLegs). A Farming Region does only FARM_CRAFT_FRAC of
  // this; the loom, the forge and the clerks concentrate in TOWNS.
  let man = 0;
  const legs = craftLegs(s, k, r);
  // Evolve the agglomeration cluster ONCE per tick (computeExportValue is memoised per
  // step via exportValueOf). The town drifts toward its COMPARATIVE-advantage sector —
  // the one it's closest to maxing out (legs[k] / CRAFT_REF[k]) on its RAW geographic
  // profile — and that specialty STRENGTHENS while held (capped), decaying if the
  // comparative lead moves (a mine plays out, a rival out-competes). Picking on the raw
  // profile (not the boosted output) is what lets industry relocate and keeps the map
  // diverse instead of every town chasing the single absolute-strongest craft.
  if (world && T.AGGLOM_W > 0) {
    let topK = null, topScore = -1;
    for (const key in legs) { const sc = legs[key] / (CRAFT_REF[key] || 1); if (sc > topScore) { topScore = sc; topK = key; } }
    if (topK) {
      if (s._specKey === topK) s._specStr = Math.min(1, (s._specStr || 0) + T.AGGLOM_RISE * (1 - (s._specStr || 0)));
      else {
        s._specStr = (s._specStr || 0) * (1 - T.AGGLOM_DECAY);
        if (s._specStr < 0.05) { s._specKey = topK; s._specStr = 0.05; }   // the new trade takes hold
      }
    }
  }
  applyClusterBoost(legs, s);                                      // established cluster compounds its sector
  for (const key in legs) man += legs[key];
  if (tier < 1) man *= T.FARM_CRAFT_FRAC;                           // a village manufactures little

  // Soldiers don't produce trade goods; a sacked settlement's output is depressed
  // for a while (sackPenalty); tech scales the lot.
  const armyFrac = (s.army || 0) / Math.max(1, s.people);
  const mult = Math.max(0.1, 1 - armyFrac) * sackPenalty(s, world) * techEff(s).tradeMult;
  ag *= mult; man *= mult; agFood *= mult; agMat *= mult;
  const v = ag + man;
  s._exportFoodFrac = v > 0 ? agFood / v : 0;           // share booked as "food & farm goods"
  s._exportMatFrac  = v > 0 ? agMat / v : 0;            // share booked as "materials" (rest = manufactured/service goods)
  return v;
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

// Does this settlement FARM its own land (so its base output is food)? Under
// DISSOLVE_FARMS every town up to a metropolis works its own catchment;
// otherwise only tier-0 Farming Regions (≤ FARM_MAX_TIER) do. ONE predicate so
// the economy (computeExportValue) and its info-panel breakdown can't drift.
export function farmsLand(s) {
  return (s.tier | 0) <= (T.DISSOLVE_FARMS ? 3 : (T.FARM_MAX_TIER | 0));
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

// ── Monetization: how much of a settlement's economy runs on COIN ────────────
// The levy→coin arc's per-settlement gauge (T.MONETIZE, conquest.js fiscal pass):
// a place is monetized to the degree it (a) actually HOLDS coin against its own
// subsistence reserve (a village whose whole purse is below its hoarding floor
// transacts in kind, whatever the era) and (b) touches MARKETS (trade partners —
// coin is only worth holding where there is somewhere to spend it). Emergent on
// three axes: mining, trade tech and currency->banking lift coin stocks and
// connectivity over the arc, so the countryside monetizes centuries after the
// entrepôts — never a date, never an era gate. 0 (a coinless, marketless
// hamlet) → 1 (a cash economy).
// The third axis is the INSTITUTION: before a society unlocks coined money
// (the currency tech's `market` ability, via its own tree — never a year),
// exchange runs on weighed metal, barter and ledger credit (Ur's silver
// shekels-by-weight), which monetizes an economy only partly however rich the
// hoard — a hoard measures wealth, not a cash economy. Without this gate the
// gauge saturated in the Bronze Age (measured median 1.00 at 15k steps: every
// state a cash state again, just via the meter instead of the ledger).
export function monetization(s) {
  const coinF = Math.min(1, Math.max(0, s.wealth || 0) / (3 * getWealthReserve(s)));
  const reachF = Math.min(1, (s._tradeReach ? s._tradeReach.size : 0) / 10);
  const instF = techEff(s).market ? 1 : 0.3;
  return coinF * (0.25 + 0.75 * reachF) * instF;
}

// Decomposition of exportValue — returns a sorted list of
// { label, value } for each contributor. Used by the settlement
// info card to show WHAT the settlement actually exports, not
// just the headline number. Mirrors computeExportValue's structure
// INCLUDING the multipliers (FARM_CRAFT_FRAC on the manufactured/
// service sector, the army-labour / sack / tech multipliers on the
// lot) — so the panel's composition sums to the same scale the trade
// pass actually sells at, instead of the raw pre-multiplier recipe.
// `world` is optional (the sack penalty needs the current step; a
// worker-mirror settlement without world still gets the rest right).
export function getExportBreakdown(s, world) {
  const k = s.knowledge || {};
  const r = s.localRes || {};
  const tier = s.tier | 0;
  const craftFrac = tier < 1 ? T.FARM_CRAFT_FRAC : 1;      // a village manufactures little (computeExportValue)
  const armyFrac = (s.army || 0) / Math.max(1, s.people);
  const mult = Math.max(0.1, 1 - armyFrac) * sackPenalty(s, world) * techEff(s).tradeMult;
  const out = [{ label: "Baseline", value: 1.0 * mult }];
  // Manufactured / service crafts — textiles (the universal town good), the
  // ore-gated metalwork specialty, pottery/leather, crafted wares and the
  // counting-house (craftLegs, shared with computeExportValue so the panel can't
  // drift from the economy). Each is tier-scaled and tech/army/sack-scaled.
  const legs = applyClusterBoost(craftLegs(s, k, r), s);   // same cluster lock-in the economy applies
  for (const key in legs) { const v = legs[key] * craftFrac * mult; if (v > 0.01) out.push({ label: key, value: v }); }
  const matAccess = ((r.timber || 0) + (r.stone || 0)) * 0.5;
  const buildMat = (k.construction || 0) * matAccess * 0.8 * mult;   // RAW building materials (ag-sector)
  if (buildMat > 0.01) out.push({ label: "Building materials", value: buildMat });
  const agScale = Math.min(1, (s._terrTiles || 0) / 120);
  if (farmsLand(s)) {   // SAME food gate as computeExportValue — panel can't drift from the economy
    const agriculture = (k.agriculture || 0) * agScale * 0.6 * mult;
    if (agriculture > 0.01) out.push({ label: "Grain surplus", value: agriculture });
    const wild = (k.agriculture || 0) * (r.timber || 0) * 0.4 * mult;
    if (wild > 0.01) out.push({ label: "Wild goods", value: wild });
  }
  if ((s.waterAccess || 0) > 0) {
    const v = (k.navigation || 0) * s.waterAccess * 0.5 * mult;
    if (v > 0.01) out.push({ label: "Ship goods", value: v });
    const fish = s.waterAccess * (k.navigation || 0) * 0.3 * mult;
    if (fish > 0.01) out.push({ label: "Salt fish", value: fish });
  }
  const horses = r.horses || 0;
  if (horses > 0.05) {
    const v = (horses * 0.6 + (k.mobility || 0) * 0.4) * mult;
    if (v > 0.01) out.push({ label: "Horse trade", value: v });
  }
  const salt = (r.salt || 0) * 0.5 * mult;
  if (salt > 0.01) out.push({ label: "Salt", value: salt });
  const base = Math.min(0.5, Math.log10(Math.max(1, s.people)) / 10) * mult;
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
const MIGRATE_DRAIN_CAP = 0.04;  // never move more than this fraction of a village in one pass (peacetime)
// REFUGE: in peace people drift cityward for OPPORTUNITY; in hard times — war,
// raids, conscription, famine, heavy taxes, all of which spike a region's UNREST
// — they FLEE the open land for the nearest defended town far faster. So unrest
// multiplies both the drift rate and the per-pass drain cap: a war empties the
// countryside into the walled towns (Jericho/Uruk), a long peace lets it spread
// back out onto the land. Towns sit on defensible sites (crystallize.js), so the
// hub people run to IS the stronghold. T.SITE_DEFENSE dials the whole effect.
const REFUGE_PULL      = 2.0;    // unrest=1 → up to ×(1+2·SITE_DEFENSE) flight into the hub
// FARM-LABOUR ANCHOR: pre-modern agriculture is LABOUR-intensive — most people must
// farm, and only the small SURPLUS can move to the cities, so the world stayed
// ~85–90% rural until the 1800s and ~70% rural even in 1950. As farm YIELD rises (the
// agricultural revolution: heavy plough → crop rotation → fertiliser → mechanisation)
// fewer farmers feed more, the surplus grows, and the countryside finally empties into
// the cities — the urban transition. So a farming region retains a rural share that
// FALLS with its farm yield; the city can never drain it below that.
export const URBAN_BASE_RURAL = 0.90;   // pre-industrial retained rural share (most people farm)
const URBAN_YIELD0     = 3.0;    // farm yield below which the countryside stays ~full (pre-industrial: ~90% rural)
const URBAN_GAIN       = 0.13;   // share of farmers freed to the cities per unit of yield ABOVE that (→ ~70% rural by 1950)
const URBAN_MIN_RURAL  = 0.55;   // floor on the retained rural share even at peak modern yield
// Retained rural share of a settlement's people: high pre-industrially, falling
// as farm yield frees labour to the towns. ONE source of truth for both the
// urbanise farm-labour anchor and the province rural/urban split.
export function ruralShare(s) {
  const fy = s._farmYield || 1;
  return Math.max(URBAN_MIN_RURAL, URBAN_BASE_RURAL - URBAN_GAIN * Math.max(0, fy - URBAN_YIELD0));
}
export function urbanise(world) {
  // ONE POPULATION (slice B): urbanization IS the field's capacity-seeking
  // migration into each city's urban spike — the census-side drift retires.
  if (T.ONE_POP) return;
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
    // Draw only toward what the hub can actually feed today (its carrying
    // capacity). Pulling migrants beyond that — toward the city's pre-built
    // housing — looks like it should free more village grain, but in practice
    // the migrants outrun the food (which ships in with a lag) and simply
    // starve, shrinking both the city and the villages it drained. Filling to
    // capacity lets the city grow exactly as fast as imported grain arrives.
    const room = Math.max(0, (best._k || best.people) - best.people);
    // Hard times accelerate the flight cityward (refuge), lifting both the drift
    // rate and the drain cap; in peace (unrest ≈ 0) this is a no-op.
    const refuge = 1 + REFUGE_PULL * (s.unrest || 0) * T.SITE_DEFENSE;
    const _dt = world._dt || 1;   // granularity: drift the same share of people per unit of HISTORY
    let movers = Math.min(s.people * MIGRATE_RATE * gap * refuge * _dt, room, s.people * MIGRATE_DRAIN_CAP * refuge * _dt);
    // Farm-labour anchor: a farming region keeps the farmers who work its land — only
    // the surplus above the (yield-dependent) rural floor can leave for the cities, so
    // the world stays ~85% rural until the agricultural revolution lets it urbanise.
    if ((s.tier | 0) <= (T.DISSOLVE_FARMS ? 1 : (T.FARM_MAX_TIER | 0))) {   // DISSOLVE: only the small farming TOWNS keep farmers rural; cities shed freely
      const ruralFrac = ruralShare(s);
      movers = Math.min(movers, Math.max(0, s.people - ruralFrac * (s._k || s.people)));
    }
    if (movers < 0.2) continue;
    s.people -= movers;
    // Migrants carry their heritable aptitude into the destination, blending it
    // pop-weighted with the residents — the one thing that DILUTES a high-aptitude
    // stock (intermarriage), since the trait itself never decays in place.
    if (T.ORG_APTITUDE > 0) {
      const bp = best.people, ba = best._orgApt || 0, sa = s._orgApt || 0;
      if (bp + movers > 0) best._orgApt = (ba * bp + sa * movers) / (bp + movers);
    }
    best.people += movers;
  }
}

export function updateSettlement(world, s) {
  if (s.mode !== "settled") return;
  updateFood(world, s);
  updatePopulation(world, s);
  if (s.mode !== "settled") return;        // died this tick (famine / wither)
  updateWealth(world, s);
  updateCoercedLabour(world, s);   // slaves, cash crops, mine intensification (reads fresh wealth)
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
// Crop-package spread thresholds (T.CROP_AXIS): a settlement ADOPTS a trade
// neighbour's crop if its own tile suits that crop above CROP_ESTABLISH; a
// MATURE farming culture independently DOMESTICATES a strongly-suitable un-owned
// crop above CROP_DOMESTICATE (a secondary hearth, so no good land stays forager
// forever). Establish < domesticate: a crop spreads to marginal land far more
// readily than it is invented from scratch.
const CROP_ESTABLISH = 0.18;
const CROP_DOMESTICATE = 0.45;
//
// ── Resource-gated knowledge growth ──
//
// Each tech track grows in proportion to whatever inputs let it
// progress. Navigation/mobility are HARD-GATED: without water/horses no
// progress at all, and the technique doesn't even diffuse in (the craft is
// inseparable from the environment). Metallurgy is gated differently — its
// KNOWLEDGE diffuses freely by contact (you can learn how iron is worked
// without owning a mine), but independent INVENTION and all PRACTICE are
// capped by reachable ore (metalCap → metalEff). Others are SOFT-BOOSTED:
// faster with the right inputs (construction with timber, agriculture with
// metal tools).
//
// metallurgy caps (bound what can be PRACTISED & independently INVENTED —
// NOT what can be learned of; awareness can diffuse past these):
//   stone tools only            cap 0
//   + copper                    cap 0.30  (chalcolithic — knives, ornaments)
//   + copper + tin              cap 0.65  (bronze age — proper weapons + ploughs)
//   + iron                      cap 0.90  (iron age)
//   + iron + coal               cap 1.00  (steel / industrial)
//
// ── Heritable organisation aptitude ("bountiful hardship" selection) ──────
// The thesis: a population that must put by a STORABLE SURPLUS to cross a harsh
// season is selected, over generations, for the foresight, storage and
// coordination a state runs on. Modelled as a heritable, per-population aptitude
// that RATCHETS up under that climate and never falls (a permanent trait), rides
// with colonists/migrants in full (founder-carried — see makeSettlement + the
// migration blend — but never transferred by conquest, like the ancestry stock),
// and pays out as faster ORGANISATION learning + extra STATE CAPACITY (admin reach).
//
// TWO climates impose that storage pressure, and seasonalSelect rewards BOTH:
//   • COLD WINTER  — a cool-temperate / continental winter with a moist growing
//                    season (Northern Europe, North China): store against the frost.
//   • DRY SUMMER   — a WARM Mediterranean / semi-arid climate with a pronounced
//                    RAINLESS season (the Fertile Crescent, the Nile, the Maghreb,
//                    the Mediterranean littoral, the Indus): grain must be stored
//                    against the dry months, and the dry heat KEEPS it. This is the
//                    "bountiful hardship" that built the FIRST states — and an
//                    earlier cold-ONLY score wrongly read it as "no winter → no
//                    aptitude", debuffing the very cradle of civilisation.
// It is ~0 only where there is no storable surplus to select on: the year-round-wet
// TROPICS (no harsh season, food any day) and the true DESERT / POLAR margins
// (no growing season at all). Dialled by T.ORG_APTITUDE.
const APT_T_OPT = 0.45, APT_T_TOL = 0.15;        // cold-winter lobe: cool-temperate (wide enough for temperate-monsoon Asia)
const APT_M_MIN = 0.32, APT_M_SPAN = 0.30;       // ...with a moist growing season
const APT_MEDI_T = 0.58, APT_MEDI_T_SPAN = 0.14; // dry-summer lobe: warm enough for a hot rainless season
const APT_MEDI_M = 0.30, APT_MEDI_M_TOL = 0.15;  // ...peaking at SEMI-ARID (falls off for wet tropics and true desert)
const APT_CROP_M = 0.12, APT_CROP_SPAN = 0.12;   // ...but a growing season must exist at all (excludes the bone-dry desert)
function seasonalSelect(temp, moist) {
  const cold = Math.exp(-((temp - APT_T_OPT) ** 2) / (2 * APT_T_TOL * APT_T_TOL))
             * Math.min(1, Math.max(0, (moist - APT_M_MIN) / APT_M_SPAN));
  const warm     = Math.min(1, Math.max(0, (temp - APT_MEDI_T) / APT_MEDI_T_SPAN));
  const semiArid = Math.exp(-((moist - APT_MEDI_M) ** 2) / (2 * APT_MEDI_M_TOL * APT_MEDI_M_TOL));
  const crop     = Math.min(1, Math.max(0, (moist - APT_CROP_M) / APT_CROP_SPAN));
  const medi     = warm * semiArid * crop;        // Mediterranean / dry-summer storage pressure
  return Math.min(1, Math.max(cold, medi));
}

// ── Circumscription (Carneiro): confinement forces organisation ──────────
// A fertile pocket hemmed in by INHOSPITABLE land — the Nile walled by desert,
// a valley ringed by mountains, an island — cannot answer population pressure by
// dispersing, so it answers with INTENSIFICATION: irrigation, hierarchy, the
// coordinated state. computeConfinement scores how walled-in a site is (the
// fraction of its surroundings that is sea / high mountain / frozen / true
// desert — land you cannot just walk off into and farm). Cached at creation
// (terrain is static); pays out as faster organisation learning (T.CONFINE).
function computeConfinement(world, x, y) {
  const { tw, th, elev, temp, moist } = world;
  const R = 6; let bar = 0, tot = 0;
  for (let dy = -R; dy <= R; dy++) {
    const ny = (y | 0) + dy; if (ny < 0 || ny >= th) continue;
    for (let dx = -R; dx <= R; dx++) {
      const d2 = dx * dx + dy * dy; if (d2 === 0 || d2 > R * R) continue;
      const nx = (((x | 0) + dx) % tw + tw) % tw, ni = ny * tw + nx;
      tot++;
      const e = elev[ni], t = temp ? temp[ni] : 0.5, m = moist ? moist[ni] : 0.5;
      if (e <= 0 || e > 0.55 || t < 0.30 || (m < 0.12 && t > 0.5)) bar++;   // sea / mountain / ice / desert
    }
  }
  return tot > 0 ? bar / tot : 0;
}

// Terrain ruggedness: local elevation roughness (standard deviation of height in
// a small window). Broken, compartmented country — the Aegean, Italy, the
// Caucasus, the Swiss cantons — splinters into many small competing polities
// because no centre can cheaply project power across the ranges; smooth plains
// consolidate into few large realms. Cached at creation (terrain is static);
// eases frontier-state nucleation (countryTerritory.js) so rugged land carries
// MORE, smaller states. The reach flood's mountain transport cost already does
// half this job; ruggedness makes the polity-COUNT effect explicit.
function computeRuggedness(world, x, y) {
  const { tw, th, elev } = world;
  const R = 4; let n = 0, sum = 0, sum2 = 0;
  for (let dy = -R; dy <= R; dy++) {
    const ny = (y | 0) + dy; if (ny < 0 || ny >= th) continue;
    for (let dx = -R; dx <= R; dx++) {
      const nx = (((x | 0) + dx) % tw + tw) % tw, e = Math.max(0, elev[ny * tw + nx]);
      n++; sum += e; sum2 += e * e;
    }
  }
  if (n === 0) return 0;
  const mean = sum / n;
  return Math.min(1, Math.sqrt(Math.max(0, sum2 / n - mean * mean)) / 0.20);
}

// Livestock / herding suitability from climate: open grassland, savanna and
// temperate pasture are prime; bare desert (no graze), rainforest/swamp (no open
// range, tsetse, foot-rot) and frozen ground are not. Combined in updateFood with
// the regional domesticate-availability gate (the agri ceiling — isolated New-World
// landmasses and the wet tropics score low, Diamond's "no large domesticates").
// Exported: crystallize.js scores SITE quality with the same suitability the
// food model feeds herders by — one definition of "herding country".
export function livestockClimate(temp, moist) {
  const dryOK  = Math.min(1, Math.max(0, (moist - 0.10) / 0.18));   // not bare desert
  const wetOK  = Math.min(1, Math.max(0, (0.82 - moist) / 0.28));   // not rainforest / swamp
  // Grazing needs a real growing/warm season: cattle, horses and oxen are a COOL-
  // TEMPERATE steppe thing (annual mean ~0 °C and up — Mongolia, the Kazakh and
  // Pontic steppe), not a taiga/tundra one. The old cutoff saturated to full support
  // at −18 °C and only died at −34 °C, which fed dense herding (and, via livestockBonus,
  // farm yield) deep into −12 °C Siberia — settling cold land that was near-empty in
  // reality. Pull the band up: full at/above 0 °C (t≥0.60), fading to nothing by ~−15 °C
  // (t≈0.45), so the steppe belt keeps its herds but the boreal north does not.
  const warmOK = Math.min(1, Math.max(0, (temp - 0.45) / 0.15));    // not frozen

  // TSETSE BELT: subtract the warm sub-humid woodland-savanna where the fly killed
  // cattle, horses and oxen — the model used to hand this belt a livestock BONUS
  // (warm + moderate moisture scored high above), which is exactly the African
  // savanna that historically could keep no draft animals. This turns that bonus
  // into the real handicap; the dry grassland (Sahel fringe, steppe) is spared.
  const tsetse = 1 - T.TSETSE * tsetseSignal(temp, moist);
  return dryOK * wetOK * warmOK * Math.max(0, tsetse);
}

// Competition (fractious-polity innovation): a settlement in contact with many
// DISTINCT rival polities sits in a competitive, pluralistic world (fragmented
// Europe, the warring states) and innovates faster; one deep inside a single
// monolithic empire does not. COMPETE_REF rival neighbours → full effect.
const COMPETE_REF = 4;

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
  // Specialist-class techs (institutions, metallurgy, seamanship, literacy) are
  // built by the URBAN CORE — the scribes, smiths and shipwrights of a city, not
  // the peasantry. Under DISSOLVE_FARMS a settlement's `people` bundles its whole
  // rural province, so keying tech growth off raw population let a big farming
  // region race up the tech ladder — and, because _civYear tracks the leading
  // capital's organisation, dragged the WORLD CLOCK forward centuries, firing the
  // modern frontier-close (the partition of the wastes) far too early and
  // ballooning every realm. Scale the "more minds" term by the urban core
  // instead, so development paces to a CITY of that size, not a province (mirrors
  // the urban-core reach scaling in countryTerritory.js). Agriculture keeps the
  // full population below — peasants are exactly who improve farming.
  const sciSqrt = T.DISSOLVE_FARMS && s._urbanPop != null ? Math.sqrt(s._urbanPop) : popSqrt;
  const horsesThr = 0.05;
  const horses = r.horses || 0;

  // Ore tier cap — what the reachable ore lets this site actually PRACTISE.
  // Knowledge of metalworking now spreads freely by contact (see diffusion
  // below); metalCap instead gates what that knowledge can be USED for. Counts
  // imported ore (r = effectiveLocalRes), so a trade-connected people isn't
  // frozen on ore-poor ground.
  const cu = r.copper || 0, sn = r.tin || 0, fe = r.iron || 0, co = r.coal || 0;
  const metalCap = oreTier(r);   // over REACHABLE ore (imports count)
  // AWARENESS vs CAPABILITY. k.metallurgy is what this culture KNOWS of
  // metalworking — technique, which travels by contact far faster and wider than
  // the ore does. metalEff is what it can actually FORGE: that awareness capped
  // by the ore within reach. A connected but ore-poor people knows perfectly how
  // iron is worked yet makes little of it — knowing ≠ holding the metal. So every
  // PHYSICAL use of metallurgy (tools, weapons, the metal-tech bonuses) reads
  // metalEff; only the tech-tree LEGIBILITY and the spread of technique read the
  // raw awareness. (_metalCap is cached for techEff's lazy path.)
  s._metalCap = metalCap;
  const metalEff = Math.min(k.metallurgy, metalCap);

  // ── Emergent capacity (the science rate) ──────────────────────────────
  // What a society LEARNS per tick is not a constant: it scales with the
  // number of minds (population), the banked food surplus that frees
  // specialists from the fields, the trade contacts that exchange ideas, and
  // the institutions that organise them. A fed, populous, well-connected hub
  // invents fast; a starving, isolated hamlet barely moves. Centred so a
  // typical developing settlement learns at ≈ the old flat pace; T.SCI_SPREAD
  // dials the swing (0 = the old uniform rate everywhere).
  const popF = Math.min(1, sciSqrt / T.SCI_POP_REF);                        // sqrt(urban core) at which a settlement learns at full speed
  const granF = Math.min(1, (s.food || 0) / (80 + s.tier * 200));          // banked surplus
  const flow = (s._foodSupply || 0) / Math.max(0.01, s._foodDemand || 0);  // 1 = break-even
  const surplusF = Math.max(0, Math.min(1, 0.5 * granF + 0.5 * Math.min(1, Math.max(0, (flow - 1) / 0.4))));
  const reachN = s._tradeReach ? s._tradeReach.size : 0;
  const tradeF = Math.min(1, reachN / 18);                                 // ~18 partners → 1
  // Competition: contact with many DISTINCT rival polities (fractious frontier /
  // warring states) spurs faster innovation; monolithic-empire interiors don't.
  const competF = Math.min(1, (s._rivalN || 0) / COMPETE_REF);
  // ── Winter aptitude → learning SPEED (buff / debuff) ──────────────────
  // "Winter peoples" — those whose climate selected for the foresight, storage
  // and coordination a hard seasonal cycle demands (seasonalSelect, carried as
  // the heritable s._orgApt) — learn ALL techniques FASTER; year-round-tropical
  // peoples, never under that selection pressure, learn SLOWER. winterness is the
  // heritable aptitude normalised to 0 (pure tropics) .. 1 (full winter); the
  // multiplier swings symmetrically about 1 so it is a true buff AND debuff.
  const winterness = T.ORG_APTITUDE > 0 ? Math.min(1, Math.max(0, (s._orgApt || 0) / T.ORG_APT_FULL)) : 0.5;
  const winterSci = Math.max(0.1, 1 + T.WINTER_LEARN * (2 * winterness - 1));   // >1 winter, <1 tropics
  // ×_dt folds the time-granularity step into EVERY technique-learning track at once
  // (all five use sciMul as their rate multiplier), so tech develops 1/G as fast per
  // tick — paced with the granularity-slowed population. ×winterSci slows/speeds
  // the WHOLE tree for non-winter / winter peoples at once.
  let sciMul = winterSci * (world._dt || 1) * Math.max(0.25, Math.min(2.2,
    1 + T.SCI_SPREAD * (0.55 * popF + 0.45 * surplusF + 0.30 * tradeF + 0.20 * k.organization
      + T.COMPETE * competF - 0.45)));
  // ── Compounding returns (T.SCI_COMPOUND, experimental default OFF) ──────────
  // The chronology rectification (docs/roadmap: chronology wave). The factors
  // above all CLAMP, so from the Iron Age on every hub learns at the same
  // ceiling — the sim's pace is FLAT where history's was CURVED. Measured on the
  // uniform human clock (tools/probe_erapace.mjs): Iron runs 0.3× its historical
  // length, Renaissance 3.6×, Industrial 6.5×, Modern ~38× too long. This term
  // replaces the flat ceiling with one smooth curve through the medieval-typical
  // hub: the knowledge-production INDEX — connected minds × market breadth × the
  // knowledge INSTITUTIONS actually discovered (writing → paper → printing →
  // universities → the scientific method, techEff sciInst) — compounds the rate
  // as (idx/SCI_MED_IDX)^α. =1 at the medieval anchor (the era row already
  // pacing 1.0×, so the validated mid-game doesn't move), below it for a
  // classical hub (their inputs are genuinely smaller — the flat cap was
  // over-paying them), far above for an industrial world-city. Era durations
  // become OUTPUTS of the world's own state — no era is ever named, no date is
  // ever read. Floor/cap bound the correction while α is calibrated (the
  // measured table is the thermometer, α the only knob — never a per-era value).
  if (T.SCI_COMPOUND > 0) {
    const inst = techEff(s).sciInst || 1;
    const idx = Math.max(0.02, sciSqrt / T.SCI_POP_REF) * Math.max(0.02, reachN / 18) * inst;
    sciMul *= Math.max(SCI_COMPOUND_FLOOR, Math.min(SCI_COMPOUND_CAP, Math.pow(idx / SCI_MED_IDX, T.SCI_COMPOUND)));
  }
  // ── Labor cost → innovation demand (T.LABOR_INNOV) ──────────────────────────
  // The classical-stagnation driver (docs: chronology wave, "driver 3"). When a
  // machine competes with a slave, the slave wins: a society whose production
  // runs on COERCED labor has little demand for labor-saving technique — Rome's
  // aeolipile stayed a toy while Hero's world ran on chattel muscle; the serf
  // manor likewise under-bought the mill. So the learning rate scales DOWN with
  // the coerced share of the workforce (chattel headcount _unfree + serf tenure
  // _serf, both live emergent stocks of the slavery/serfdom systems). The other
  // half of the law — SCARCE labor is dear and compels invention (the post-plague
  // wage revolution) — is already emergent here: mass death raises food-per-head
  // (flow) and with it surplusF above. A fully free-labor settlement is exactly
  // 1 (unchanged); a fully coerced one learns at 1 − LABOR_INNOV. No era, no
  // date, no region is named — sim-Rome slows because of what its economy IS.
  if (T.LABOR_INNOV > 0) {
    const coerced = Math.min(1, (s._unfree || 0) / Math.max(1, s.people || 1) + (s._serf || 0));
    if (coerced > 0) sciMul *= Math.max(0.1, 1 - T.LABOR_INNOV * coerced);
  }
  // ── Hegemonic stagnation (T.HEGEMONY_STAG) — the classical law's other half ──
  // A state system that has ABSORBED its peers loses the competitive driver
  // itself (Scheidel's Escape-from-Rome thesis): no rival that could beat you, no
  // court to defect to, no war you might lose — the pressure that pays for
  // technique is gone. Reads s._hegF (the peer-competition pass above): the
  // power-weighted share of this settlement's contact world that its own political
  // system has subordinated, scaled by having actually absorbed ≥2 peer-equivalents
  // — so a lone pioneer kingdom on an empty frontier (nothing ever subordinated)
  // and a fragmented peer system (nothing to subordinate) both read 0, while the
  // hegemon that swallowed its neighbourhood reads ~1 exactly where the era-leading
  // hubs live. Multiplicative like LABOR_INNOV — the additive COMPETE bonus term
  // can only swing the rate ~10-15% (measured), never the classical row's ~2.5×.
  // Fires purely from live political structure — no era, no date, no name.
  if (T.HEGEMONY_STAG > 0 && (s._hegF || 0) > 0) {
    sciMul *= Math.max(0.1, 1 - T.HEGEMONY_STAG * s._hegF);
  }

  // ── Environment specialization (climate-tied learning) ────────────────
  // Beyond the resource gates, the LOCAL CLIMATE biases which techniques a
  // culture perfects: arid river valleys pioneer irrigation farming
  // (Egypt/Mesopotamia/Indus); the humid tropics lacked a storable cereal
  // staple and carried a heavy disease burden; short cold seasons cap farming;
  // temperate maritime coasts grow trade-administration. T.ENV_SPEC dials it
  // (0 = climate-blind, the old behaviour).
  climateOf(world, s);
  const arid     = Math.max(0, 0.42 - s._climMoist) / 0.42;                // 0 wet .. 1 desert
  const irrig    = arid * wa;                                              // desert + river → irrigation
  const tropical = (Math.max(0, s._climTemp - 0.80) / 0.20) * (Math.max(0, s._climMoist - 0.55) / 0.45);
  const cold     = Math.max(0, 0.40 - s._climTemp) / 0.40;                 // short growing season
  const maritime = wa * Math.max(0, 1 - Math.abs(s._climTemp - 0.62) / 0.25);   // temperate coast
  const agriClim = Math.max(0.2, 1 + T.ENV_SPEC * (irrig * 1.1 - tropical * 0.45 - cold * 0.5));
  const orgClim  = Math.max(0.4, 1 + T.ENV_SPEC * (maritime * 0.3 - tropical * 0.40));

  // ── Heritable aptitude: selection ratchet ────────────────────────────
  // Under a mild-summer/harsh-winter/reliable-growing-season climate the
  // population's heritable organisation aptitude climbs toward the selection
  // target over generations — and NEVER falls (permanent ratchet), so a people
  // that earned it keeps it when they spread to climates that select for nothing.
  if (T.ORG_APTITUDE > 0) {
    const aptTarget = seasonalSelect(s._climTemp, s._climMoist);
    const apt = s._orgApt || 0;
    if (aptTarget > apt) s._orgApt = apt + T.ORG_APT_SELECT * (aptTarget - apt) * (world._dt || 1);
  }

  // ── Nomadism: the mounted-pastoralist path ───────────────────────────
  // Open horse-country grassland that never took up dense farming breeds MOUNTED
  // PASTORALISTS — sparse (low farm carrying capacity) but martially formidable:
  // cavalry hosts that raid and conquer far richer settled realms (Scythians,
  // Huns, Mongols). High where open graze + horses meet LOW agriculture; fades to
  // nothing as farming takes hold and the people settle. Powers the military
  // bonus in armies.js (techMul).
  s._nomad = T.NOMAD_MIL > 0
    ? livestockClimate(s._climTemp, s._climMoist) * Math.min(1, horses / 0.15) * Math.max(0, 1 - k.agriculture * 1.4)
    : 0;

  // ── Local learning ──────────────────────────────────────────────
  // Construction: covers buildings, roads, wagons, bridges (the old
  // toolmaking track folded in here — they're all "things built by
  // skilled labour"). Driven by timber/stone, helped by metal tools,
  // agricultural surplus to free builders, and population.
  const buildMat = 1 + (r.timber || 0) * 0.8 + (r.stone || 0) * 0.6;
  const stoneBoost = 1 + (r.stone || 0) * 0.6;
  const metalBoost = 1 + metalEff * 1.8;             // metal TOOLS help building — the metal you can forge, not merely know of
  k.construction = clamp01(k.construction + T.LEARN_BASE * 1.0 * sciMul * (1 - k.construction)
    * buildMat * stoneBoost * metalBoost
    * (1 + k.agriculture * 0.6) * (1 + popSqrt * 0.06));

  // Agriculture: farmland scale + metal tools (plough) + wild-food
  // gathering that supplements the early village (folds in the old
  // foraging track). The wild-food boost decays as metallurgy advances
  // — society moves off forage onto stored grain.
  const wildBoost = 1 + (r.timber || 0) * 0.2 * (1 - metalEff * 0.7);   // metal tools (not just the idea) move society off forage onto stored grain
  // Forager bounty DELAYS farming: where wild food is abundant — rich fisheries,
  // game-filled open grassland (the New World's bison, the salmon coasts) — the
  // pressure to take up cereal farming is weak, so the transition drags until the
  // wild surplus is outgrown. Fades to nothing as agriculture matures.
  const forageEase = Math.min(1, wa * 0.5 + livestockClimate(s._climTemp, s._climMoist) * 0.5) * (1 - k.agriculture);
  const foragePull = 1 - T.FORAGE_EASE * forageEase;
  // INDUSTRIAL AGRONOMY: a settlement that has industrialised (organisation AND
  // metallurgy both climbing past ~0.78 — the chemistry, machinery and scientific
  // base) learns agriculture markedly FASTER — the historical break from the Malthusian
  // yield ceiling (synthetic nitrogen, mechanisation, scientific breeding). This pushes
  // an industrial civ's agriculture past the ~0.9 plateau into the green-revolution
  // techs, so yields and _eraProd (which tracks agriculture) keep climbing through the
  // modern era instead of flat-lining — the modern explosion is EARNED by industrialising,
  // while a pre-industrial society stays capped at subsistence.
  const indAgri = 1 + T.AGRI_INDUSTRIAL
    * Math.min(1, Math.max(0, (k.organization - 0.78) / 0.18))
    * Math.min(1, Math.max(0, (k.metallurgy   - 0.78) / 0.18));
  k.agriculture = clamp01(k.agriculture + T.LEARN_BASE * 1.2 * sciMul * agriClim * (1 - k.agriculture)
    * (1 + fc * 0.03) * (1 + k.construction * 0.5) * wildBoost * foragePull * indAgri);

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
    ? T.ORG_LIT_BRANCH * k.organization * (1 + sciSqrt * 0.06)
    : 0;
  // Heritable winter aptitude as a BUFF / DEBUFF on organisation learning: a
  // winter people (high aptitude) builds institutions faster, a non-winter people
  // slower (still capped by orgEraCap — it sets the PACE to the era ceiling, not
  // the ceiling itself). This is ON TOP of winterSci in sciMul, so organisation is
  // the most winter-sensitive track of all.
  const aptLearn = T.ORG_APTITUDE > 0 ? Math.max(0.05, 1 + T.ORG_APT_LEARN * (2 * winterness - 1)) : 1;
  const confineMul = 1 + T.CONFINE * (s._confine || 0);   // circumscription forces intensification → organisation
  // a shrewd sovereign builds institutions faster at the seat of rule (dynasties.js c._rulerWit)
  let rulerLearn = 1;
  if (s.countryId >= 0 && world.countries) { const cc = world.countries.get(s.countryId); if (cc && cc.capitalId === s.id) rulerLearn = cc._rulerWit || 1; }
  k.organization = clamp01(k.organization + T.LEARN_BASE * sciMul * orgClim * orgHead
    * ((1 + sciSqrt * 0.10) + litBranch) * aptLearn * confineMul * rulerLearn);

  // Metallurgy — gated by ore, but PACED to keep step with the rest of the tree.
  // It used to crawl (∝ raw ore richness), so cultures reached the Renaissance
  // still forging bronze — iron was nominally reachable but never actually
  // reached. Now a thin deposit still smelts (you need SOME ore, not RICH ore,
  // to learn the craft — iron came from modest bog ore), charcoal/coke fires the
  // furnace, and more people means more smiths, so chalcolithic → bronze → iron
  // → steel arrive roughly in step with construction/admin.
  if (metalCap > 0 && k.metallurgy < metalCap) {
    const oreRate = Math.max(cu, sn, fe, co);
    const fuel = 1 + (r.timber || 0) * 0.3 + co * 0.4;             // charcoal / coke
    const headroom = 1 - k.metallurgy / metalCap;
    k.metallurgy = Math.min(metalCap, k.metallurgy +
      T.LEARN_BASE * 2.6 * sciMul * headroom * (0.5 + 0.5 * oreRate) * fuel
      * (1 + k.construction * 0.4 + sciSqrt * 0.04));
  }

  // Navigation — gated by water, paced like metallurgy: even a river port or a
  // modest coast grows real seamanship (helped by population — more shipwrights),
  // so coasts and great rivers become naval powers in step with the rest of the
  // tree instead of lagging centuries behind.
  if (wa > 0) {
    k.navigation = clamp01(k.navigation + T.LEARN_BASE * 1.9 * sciMul * (1 - k.navigation)
      * (0.5 + 0.5 * wa) * (1 + k.construction * 0.6 + sciSqrt * 0.04));
  }

  // Mobility — gated by horses, paced like metallurgy's thin-ore rule: you
  // need SOME horses to become a rider culture, not RICH herds (the steppe
  // was never "rich" in the deposit sense — presence + practice is what
  // builds horsemanship). The old rate scaled with raw richness and ran at
  // ~60% of its siblings' pace, so chariots (0.45) and cavalry (0.70) were
  // NEVER invented on any seed — the whole steppe branch was dead content.
  // Saturates at modest herd size (0.2) and paces with the tree.
  if (horses > horsesThr) {
    const herd = Math.min(1, horses / 0.2);
    // SADDLE-LIFE: a people whose FOOD is the herd (s._pastShare — the pastoral
    // share of subsistence, from the food model) lives on horseback: children
    // grow up riding, the camp moves with the grass. Horsemanship compounds
    // accordingly — the steppe INVENTED riding and the sown adopted it a step
    // behind (chariots reached the river valleys from the grass; China faced
    // Xiongnu cavalry before it fielded its own). A fully pastoral camp
    // practices at 3× the rate of a farm town that merely OWNS horses; a
    // farming realm with a herding fringe gets a sliver. Without this
    // differential every culture learned riding at the same resource-gated
    // pace, mounted AGRARIAN empires swept the steppe before any steppe
    // people could ride, and the nomad branch was unreachable on any map.
    const saddleLife = 1 + 2 * (s._pastShare || 0);
    k.mobility = clamp01(k.mobility + T.LEARN_BASE * 2.2 * sciMul * (1 - k.mobility)
      * (0.5 + 0.5 * herd) * saddleLife * (1 + k.construction * 0.4 + metalEff * 0.6 + sciSqrt * 0.04));   // metal bits/shoes/tack — capability, not awareness
  }
  // Industrial mobility — machines replace horses at the top of the tree:
  // rail, steam haulage and the telegraph made land movement a MACHINE
  // capability. Opens a horse-independent term in the same org+metallurgy
  // industrial band that gates industrial agronomy above, so a horseless
  // industrial nation still learns modern logistics — while a world stuck
  // in antiquity never sees it. (Review idea D75.)
  {
    const indBand = Math.min(1, Math.max(0, (k.organization - 0.78) / 0.18))
                  * Math.min(1, Math.max(0, (k.metallurgy   - 0.78) / 0.18));
    if (indBand > 0) {
      k.mobility = clamp01(k.mobility + T.LEARN_BASE * 2.0 * sciMul * (1 - k.mobility) * indBand);
    }
  }

  // ── Dark ages: knowledge is lost when a society collapses ─────────────
  // Technique lives in people and institutions. When a settlement's
  // population falls far below its historic peak (plague, famine, war, a sack)
  // or it is cut off from all trade, the specialist class dies or scatters and
  // craft, records and administration are forgotten. The peak bleeds slowly
  // toward the present, so a collapse causes a BURST of forgetting that eases
  // once the survivors stabilise at their new, smaller scale — a dark age, not
  // a permanent reset. Organization and the crafts go first; subsistence
  // agriculture is the stickiest. T.KNOW_DECAY dials it (0 = off).
  {
    const _r = Math.pow(0.9997, world._dt || 1);   // granularity-scaled peak decay (same history-rate at any G)
    s._popPeak = Math.max(pop, (s._popPeak || pop) * _r + pop * (1 - _r));
  }
  const drawdown = 1 - pop / Math.max(1, s._popPeak);               // fraction of peak lost
  // Isolation only bites an ESTABLISHED settlement that has genuinely been cut
  // off — not a new frontier village that simply hasn't built roads yet.
  const cutOff = reachN === 0 && (world.step - (s.foundedStep || 0)) > 2000 / (world._dt || 1);
  const regress = Math.max(0, drawdown - 0.15) + (cutOff ? 0.12 : 0);  // small dips absorbed
  if (T.KNOW_DECAY > 0 && regress > 0) {
    const dec = T.LEARN_BASE * 12 * T.KNOW_DECAY * regress;
    k.organization = Math.max(0, k.organization - dec * 1.4 * k.organization);
    k.construction = Math.max(0, k.construction - dec * 1.0 * k.construction);
    k.metallurgy   = Math.max(0, k.metallurgy   - dec * 0.8 * k.metallurgy);
    k.navigation   = Math.max(0, k.navigation   - dec * 0.8 * k.navigation);
    k.mobility     = Math.max(0, k.mobility     - dec * 0.8 * k.mobility);
    k.agriculture  = Math.max(0, k.agriculture  - dec * 0.4 * k.agriculture);
  }

  // ── Diffusion: learn techniques from connected neighbours ─────────
  // Technology spreads by contact. Pull each track toward the best level
  // among road-connected partners, FASTER the more ORGANISED this
  // society is (writing/records are now folded into organization, so a
  // literate-bureaucratic state absorbs technique 1–3× faster).
  // Metallurgy KNOWLEDGE spreads freely here — you can learn how iron is worked
  // from a neighbour who works it, whether or not you hold any ore; the ore gates
  // what you can DO with that knowledge (metalEff / metalCap), not whether you
  // hear of it. Navigation and mobility stay capacity-gated: a landlocked people
  // grows no deep-water craft and a horseless one no cavalry, because there the
  // technique is inseparable from the environment that breeds it.
  // Diffusion is throttled to every KNOW_INTERVAL ticks (staggered by id),
  // with the rate scaled up to match — technique spreads over ~1700 ticks,
  // so an 8-tick cadence is indistinguishable while costing 8× less.
  // Ideas travel wherever GOODS travel: diffusion iterates the MERGED road +
  // sea reach (review I41/D37) — sea lanes carried trade, plague and language
  // but no knowledge, so island civilizations could never converge. Each
  // track's pull is damped by the ROUTE COST of the partner holding the best
  // level: a busy strait floods technique across, a hard ocean crossing
  // trickles — the channel scales with the same emergent lanes and ship tech
  // that built it. Land partners' costs are small, so the pre-sea calibration
  // is preserved.
  if (world._byId && (world.step + s.id) % KNOW_INTERVAL === 0) {
    const reach = mergeReach(s);
    if (!reach || reach.size === 0) {
      s._rivalN = 0;   // no contact, no competition signal (used to go stale forever)
    } else {
    const km = { agriculture:0, construction:0, organization:0,
                 metallurgy:0, navigation:0, mobility:0 };
    // Climate similarity to the partner that holds each track's best level —
    // 1 = same climate band, → 0 = opposite climate.
    const kmSim = { agriculture:1, construction:1, organization:1,
                    metallurgy:1, navigation:1, mobility:1 };
    // Route-cost damping of the best-holder's pull. The scale means "the
    // route cost at which contact is too thin to carry technique well" —
    // ~3× a nav-0 port's whole sea range; a typical neighbourly land link
    // costs a fraction of it (weight ≈ 1).
    const DIFFUSE_COST_K = 30;
    const kmCostW = { agriculture:1, construction:1, organization:1,
                      metallurgy:1, navigation:1, mobility:1 };
    let any = false;
    const rivals = new Set();
    for (const [pid, link] of reach) {
      const p = world._byId.get(pid);
      if (!p || p.mode !== "settled" || !p.knowledge) continue;
      any = true;
      if (p.countryId >= 0 && p.countryId !== s.countryId) rivals.add(p.countryId);   // competition signal
      const pk = p.knowledge;
      // Continental-axis climate similarity — used to gate AGRICULTURE only (see
      // the diffusion loop). The farming PACKAGE crosses easily along a shared
      // latitude/climate band (same day-length, soils, crops, seasons) and only
      // slowly across them. Same-latitude neighbour → sim ≈ 1.
      climateOf(world, p);
      const dLat = s._climLat - p._climLat, dT = s._climTemp - p._climTemp;
      const sim = Math.exp(-(dLat * dLat) / (2 * 0.22 * 0.22) - (dT * dT) / (2 * 0.10 * 0.10));
      const costW = Math.exp(-((link && link.cost) || 0) / DIFFUSE_COST_K);
      for (const t of KTRACKS) { const v = pk[t] || 0; if (v > km[t]) { km[t] = v; kmSim[t] = sim; kmCostW[t] = costW; } }
    }
    // ── PEER competition (T.PEER_COMPETE): rivals are independent PEERS ────────
    // The competition-drives-innovation thesis (Hume, the warring states, fractious
    // Europe) is about states that could genuinely BEAT you — not any foreign flag
    // in trade reach. Two corrections, both measured necessities for the classical
    // gap (the era clock follows the leading hubs, and only this pressure slows
    // them): (a) SUBORDINATION — a vassal, an overlord, a co-dependency share your
    // power system and are no rivals (the old count kept competF pinned at 1 inside
    // a perfect suzerain network — hegemony was structurally invisible); (b) PEER
    // WEIGHT — a rival presses in proportion to its power against yours (min(1,
    // theirs/(0.5×mine)): a peer at half your power presses fully, a minnow barely —
    // Rome felt no spur from Germanic villages). Alongside, the SUBORDINATED weight
    // is tallied: how much of your contact world your system has absorbed — the
    // hegemony fraction the stagnation law (sciMul, below) reads. Falls back to the
    // legacy count where power is unpriceable (young states between alliance
    // rebuilds). 0 = the legacy any-flag count (byte-identical).
    if (T.PEER_COMPETE > 0 && s.countryId >= 0 && rivals.size) {
      const powM = world._countryPow, ov = world._overlordOf;
      const rootOf = (cc) => { let c = cc, hops = 0; while (ov && ov.has(c) && hops++ < 64) c = ov.get(c); return c; };
      const myRoot = rootOf(s.countryId);
      const myPow = powM ? powM.get(s.countryId) : undefined;
      let peerW = 0;
      for (const cc of rivals) {
        if (rootOf(cc) === myRoot) continue;                   // your own suzerainty network is not your competition
        const rp = powM ? powM.get(cc) : undefined;
        peerW += (myPow > 0 && rp !== undefined) ? Math.min(1, rp / (0.5 * myPow)) : 1;
      }
      s._rivalN = peerW;
      // THE RATCHET — stagnation is the DEATH of once-present pressure, not mere
      // solitude (measured, seed 8817: the leading hub's peer pressure RISES through
      // the bronze arc as secondary states form — 0.7 → 2.2, the Amarna-club dynamic —
      // then COLLAPSES to 0.34 exactly in the iron window as the leading realm
      // outgrows everyone; formal vassalage stayed rare, so a subordination-share
      // proxy never fired). Track the peak peer pressure this hub has ever felt;
      // the hegemony fraction is the DECLINE from that peak, gated on a real peer
      // system having existed (peak ≥ half of full pressure — two peer-equivalents).
      // A lone pioneer kingdom never had a peak → 0; a fragmented peer world never
      // declines → 0; and when a hegemony later shatters into successor states, the
      // pressure recovers and learning resumes — the post-imperial revival, free.
      const p = Math.min(1, peerW / COMPETE_REF);
      const peak = Math.max(s._peerPeak || 0, p);
      s._peerPeak = peak;
      s._hegF = peak >= 0.5 ? Math.max(0, (peak - p) / peak) : 0;
    } else {
      s._rivalN = rivals.size;   // legacy: distinct rival polities in contact
      s._hegF = 0;
    }
    if (any) {
      if (wa <= 0) km.navigation = 0;            // no sea → no naval technique to absorb
      if (horses <= horsesThr) km.mobility = 0;  // no horses → no cavalry technique to absorb
      // Literate-state diffusion multiplier (was "literacy"; now reads off
      // the literate-state branch of organization, which only kicks in
      // past 0.30).
      const litMul = 1 + Math.max(0, k.organization - 0.30) * 3;
      const rate = T.DIFFUSE_RATE * KNOW_INTERVAL * litMul * (world._dt || 1);   // granularity-scaled
      for (const t of KTRACKS) {
        const gap = km[t] - k[t];
        if (gap > 0) {
          // Axis bias gates ONLY agriculture. Diamond's continental-axis claim is
          // about the farming PACKAGE — crops and livestock are latitude-bound, so a
          // lead held across a climate band trickles in slowly (floor 5%) while a
          // same-band neighbour's floods in. Every other craft (metallurgy, masonry,
          // organisation, seafaring, horsemanship) is the SAME in any climate and
          // diffuses freely by contact; the axis still reaches it, but indirectly —
          // by gating the farming base that feeds population and tech development.
          const axisW = t === "agriculture"
            ? Math.max(0.05, 1 - T.AXIS_BIAS * (1 - kmSim[t]))
            : 1;
          // ABSORPTIVE CAPACITY (T.ABSORB_STEP): technique transfers by contact only
          // NEAR current practice — a society copies the next rung of what it can
          // already use (a tool its workshops can reproduce, a method its
          // institutions can run), never the frontier outright. The absorbed gap per
          // contact is therefore capped at ~one tech-rung: within the window,
          // diffusion is exactly the old exponential gap-closing (near-frontier
          // neighbours track tightly, as before); beyond it, a distant laggard
          // chases the moving frontier LINEARLY, at a speed still scaled by its own
          // literacy (litMul — Abramovitz's "social capability": a literate,
          // organised laggard absorbs ~3x faster, the Meiji pattern). This is what
          // makes DIVERGENCE possible at all: with uncapped gap-closing the whole
          // planet converged to within 0.10 of the frontier by the Modern era on
          // every track (measured p10-p90 of capitals' org: 0.90-1.00) — no rising
          // periphery, no stagnant empire, no Great Divergence, modernity arriving
          // everywhere at once. Composes with the climate axis-gate above, the hard
          // resource gates (no sea -> no seamanship), and KNOW_DECAY — a stressed,
          // cut-off periphery can now regress NET even while in contact, a real
          // dark age. 0 = off (the legacy uncapped pull, byte-identical).
          const absGap = T.ABSORB_STEP > 0 ? Math.min(gap, T.ABSORB_STEP) : gap;
          k[t] = clamp01(k[t] + rate * axisW * kmCostW[t] * absGap);
        }
      }
    }
    }   // reach else-branch (merged road+sea diffusion)
  }

  // ── Crop diffusion + domestication (T.CROP_AXIS) ──────────────────────
  // Crops SPREAD settlement-to-settlement but only ESTABLISH where the local
  // climate suits them — the mechanism that makes farming radiate from the
  // cradles along climate bands and stall at the hot/wet tropics (the
  // continental axis, now emergent rather than a tuned multiplier). Throttled
  // and staggered like the rest of the knowledge recompute.
  if (T.CROP_AXIS > 0 && (world.step + s.id) % KNOW_INTERVAL === 0) {
    if (!s.crops) s.crops = [];
    const cti = (s.pos.y | 0) * world.tw + (s.pos.x | 0);
    let cropsChanged = false;
    // (a) acquire from trade neighbours any crop that suits THIS tile
    if (s._tradeReach && s._tradeReach.size > 0 && world._byId) {
      for (const pid of s._tradeReach.keys()) {
        const p = world._byId.get(pid);
        if (!p || !p.crops || p.crops.length === 0) continue;
        for (const id of p.crops) {
          if (s.crops.includes(id)) continue;
          const pkg = CROP_BY_ID[id]; if (!pkg) continue;
          if (pkgSuitAt(world, cti, pkg) > CROP_ESTABLISH) { s.crops.push(id); cropsChanged = true; }
        }
      }
    }
    // (b) independent domestication once farming is mature, on strongly-suitable land
    if (k.agriculture >= T.AGRI_FULL_AT) {
      const b = bestPackageAt(world, cti);
      if (b && b.suit > CROP_DOMESTICATE && !s.crops.includes(b.id)) { s.crops.push(b.id); cropsChanged = true; }
    }
    if (cropsChanged) s._cropCeil = undefined;   // ceiling depends on owned crops
  }

  // Refresh the cached tech-effect bonuses the sim reads (food, density, …),
  // throttled like the rest of the knowledge recompute (knowledge drifts slowly).
  if ((world.step + s.id) % KNOW_INTERVAL === 0) s._techEff = techEffects(practisedK(k, metalCap), T.TECH_EFFECTS);
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
// ── Soil-exhaustion sweep (periodic): salinisation + nutrient depletion ───
// Cumulative per-TILE soil fatigue, read by updateFood as a carrying-capacity
// drag (soilBurden). The LAND remembers (the field is keyed to the tile, not the
// settlement), so a region that wrecked its soil stays poor even as settlements
// come and go. Two halves run each SOIL_INTERVAL ticks (a slow, millennial pace):
//   GAIN — each FARMING settlement tires its home tile in proportion to its
//          FRAGILITY (SOIL_BASE_FRAG for robust rain-fed land; up to +SOIL_ARID_FRAG
//          for irrigated ARID land — the salinisation case) and its INTENSITY
//          (active farming, MITIGATED once crop rotation / drainage arrives — so
//          ancient irrigation salinises but later agronomy recovers the soil).
//   HEAL — every tile recovers slowly toward pristine (fallow / abandonment), so
//          only SUSTAINED intensive farming on FRAGILE land stays exhausted.
// The emergent payoff: the arid-irrigated cradle blooms first, then plateaus and
// declines as it salinises, while the durable rain-fed temperate belt sustains and
// overtakes — the shift of civilisation's centre, with no scripted decline.
export const SOIL_INTERVAL = 600; // ticks between soil passes (a slow process; rates are calibrated to this)
const SOIL_CATCH_R = 3;           // catchment radius (tiles) a settlement farms & tires — the farmed REGION, not one point
export function updateSoil(world) {
  if (!(T.SOIL_EXHAUST > 0)) return;
  const N = world.N, tw = world.tw;
  let f = world._soilFatigue;
  if (!f || f.length !== N) f = world._soilFatigue = new Float32Array(N);
  // HEAL — slow recovery toward pristine everywhere.
  const keep = T.SOIL_RECOVER;
  if (keep < 1) for (let i = 0; i < N; i++) { const v = f[i]; if (v > 0) f[i] = v * keep; }
  // GAIN — each farming settlement tires the soil of its CATCHMENT (not just one
  // tile, so the farmed REGION degrades as a whole and an expanding frontier can't
  // dilute it away), and caches the catchment-mean fatigue on the settlement for
  // updateFood's cheap per-tick penalty read.
  // Catchment radius in REAL distance (RES_INVARIANT_POP Phase 2): the farmed
  // region a settlement tires is the same real land at any grid resolution
  // (rounded — exact at the 240-tile reference where rNormPop is 1). Per-tile
  // fatigue GAIN needs no area factor: it is an intensity (people per real area
  // are already invariant), and the catchment MEAN read back is scale-free.
  const _rnS = rNormPop(world);
  const th = world.th, elev = world.elev, R = Math.max(1, Math.round(SOIL_CATCH_R * _rnS)), R2 = R * R;
  // CATCHMENT_CLIP: tire only the tiles the settlement actually WORKS (its clipped
  // catchment, _territoryOwner === s.id) — "soil fatigue is fine if it does step one".
  // Off ⇒ the disc scan below (byte-identical).
  const terrClip = T.CATCHMENT_CLIP > 0 ? world._territoryOwner : null;
  for (const s of world.settlements) {
    if (s.mode !== "settled") continue;
    climateOf(world, s);
    // FRAGILITY: HOT land under irrigation / intensive tillage degrades — salt left
    // by evaporating irrigation water (the arid cradles) and accelerated weathering
    // of hot soils — while COOL temperate rain-fed land is robust. Heat is the clean
    // signal (a river masks a desert's low rainfall in _climMoist, but not its heat),
    // gated above ~0.70 so temperate China/Europe stay durable and the hot cradles
    // (Nile, Mesopotamia, the Indus) carry the fragility. Water access scales it:
    // irrigated hot land salinises fastest.
    const heat = Math.min(1, Math.max(0, ((s._climTemp ?? 0.5) - 0.70) / 0.18));
    const wa   = s.waterAccess || 0;
    const fragility = T.SOIL_BASE_FRAG + T.SOIL_ARID_FRAG * heat * (0.35 + 0.65 * wa);
    const ag = (s.knowledge && s.knowledge.agriculture) || 0;
    const farm = Math.min(1, Math.max(0, (ag - 0.20) / 0.20));          // foragers don't till; farming ramps in
    const rotation = Math.min(1, Math.max(0, (ag - 0.72) / 0.28));      // crop_rotation (tech.js, agri≥0.72): drainage/legumes mitigate
    const intensity = farm * Math.max(0.15, 1 - T.SOIL_ROTATION * rotation);
    const gain = T.SOIL_GAIN * fragility * intensity;
    const x0 = s.pos.x | 0, y0 = s.pos.y | 0;
    let sum = 0, cnt = 0;
    for (let dy = -R; dy <= R; dy++) {
      const y = y0 + dy; if (y < 0 || y >= th) continue;
      for (let dx = -R; dx <= R; dx++) {
        if (dx * dx + dy * dy > R2) continue;
        const x = ((x0 + dx) % tw + tw) % tw, ti = y * tw + x;
        if (elev[ti] <= 0) continue;                                    // farm soil only
        if (terrClip && terrClip[ti] !== s.id) continue;                // CATCHMENT_CLIP: only the worked catchment (within borders)
        const v = f[ti] + gain; const fv = v > 1 ? 1 : v;
        f[ti] = fv; sum += fv; cnt++;
      }
    }
    s._soilFatigue = cnt ? sum / cnt : 0;                               // catchment mean → updateFood penalty
  }
}

function updateFood(world, s) {
  // Land food from the controlled TERRITORY: the distance-weighted sum of
  // claimed arable fertility (computed in territory.js), times yield and
  // agriculture. Storable — fills granaries and ships to feed cities. A big
  // city does NOT magically farm more; it grows by IMPORTING grain shipped
  // from its rural hinterland (see updatePopulation / the food trade), exactly
  // as real metropolises did (Rome's Egyptian grain, London's American wheat).
  // Only Farming Regions (tier ≤ FARM_MAX_TIER) farm the land; a town/city grows no
  // grain of its own — it BUYS what its countryside ships up the hierarchy. (Fish below
  // is unaffected — a coastal city still fishes.)
  // Soldiers are MEN OFF THE LAND, but a standing PROFESSIONAL core (up to ARMY_LABOR_FREE of
  // the population) is carried by the settled economy without hurting the harvest — it's the
  // wartime CONSCRIPT surge BEYOND it that empties the fields. A heavy mobilisation thus farms
  // less just as the host needs feeding MORE → the granary drains → famine forces demobilisation.
  // This is the cycle that ends total wars (armies.js); peace carries no production drag.
  const armyFrac = (s.army || 0) / Math.max(1, s.people);
  const armyLabor = Math.max(0.2, 1 - Math.max(0, armyFrac - ARMY_LABOR_FREE) * T.ARMY_LABOR_FOOD);
  // FARM-LABOUR SUBSISTENCE: working land takes farmers, and they must eat. Each territory tile
  // carries a per-tile labour cost (FARM_FERT_FLOOR, in fertility units) — the crops its farmers
  // consume to work it — deducted from the gross BEFORE the surplus enters the food economy. So
  // the NET food a region yields is (total fertility − area × floor) × yield, and land too
  // marginal to feed the people required to farm it (average fertility below the floor) yields
  // NOTHING and supports no settlement. The break-even fertility is exactly FARM_FERT_FLOOR.
  // The labour floor is charged on FARMED tiles only (_terrFarmedWt — the
  // falloff-weighted tiles that actually entered the harvest sum;
  // territory.js): a fragment cut off by a war front grows nothing so it
  // costs no farmhands, and barren desert/mountain claims cost nothing
  // either (they used to bill a phantom workforce, so claiming worthless
  // land actively DESTROYED food).
  const netFert = Math.max(0, (s._terrFertSum || 0) - (s._terrFarmedWt ?? s._terrWorkTiles ?? s._terrTiles ?? 0) * T.FARM_FERT_FLOOR);
  // MODEL B: EVERY settlement's territory (its rural hinterland) is farmed by the country
  // folk who live on it — a city does not grow food in its packed urban core, but the land
  // it controls IS worked and feeds it. So land food is produced from a settlement's territory
  // regardless of tier; the tier instead sets how URBAN/concentrated its population is (below),
  // and a city's dense population simply eats MORE than its hinterland grows, so it net-IMPORTS
  // the shortfall up the hierarchy (Rome's Egyptian grain), while a rural region grows a surplus
  // it ships up. No farmable land is wasted by sitting under an urban centre.
  // AGRICULTURAL TRANSITION (agriculture.js): fertility is only FORAGING density until
  // farming is invented/arrives (development) and only if the land can support it
  // (domestication ceiling). This is what keeps a fresh/isolated frontier sparse and
  // stateless — the whole map no longer farms at full yield from tick 0.
  const fy = techEff(s).farmYield; s._farmYield = fy;   // stored for the rural-density ceiling (updatePopulation)
  // _eraProd — the productivity index that scales carrying capacity (land food, fish,
  // housing, rural ceiling). ANCHOR_POP=1 → the global historical anchor (index.js,
  // steered to a recorded population curve). ANCHOR_POP=0 (EMERGENT) → driven by a
  // settlement's OWN agriculture knowledge (farming+industry raised human carrying
  // capacity ~100-1000× over foraging) — BUT gated on its civilisation having actually
  // DEVELOPED, not on farming CLIMATE. Agriculture knowledge is learned fastest in good
  // rain-fed farming climates, so keying the lift on agronomy ALONE balloons fertile
  // temperate land (Europe) in the stone age while the arid early cradles (Egypt, Sumer)
  // — whose advantage was IRRIGATION and early STATES, not rainfall — stay empty. The
  // development GATE (the settlement's country's organisation) fixes that: undeveloped /
  // stateless / stone-age land sits at bare subsistence no matter how fertile, the first
  // ORGANISED civilisations bloom first, and the centre of gravity follows DEVELOPMENT —
  // then shifts as development does. agri^POW keeps the lift back-loaded so the modern
  // BOOM still rides agriculture's climb to the top of the tree.
  if (T.ANCHOR_POP > 0) {
    s._eraProd = world._eraProd || 1;
  } else {
    const agri = (s.knowledge && s.knowledge.agriculture) || 0;
    // Density requires being in a DEVELOPED STATE, not just personal organisation: read the
    // settlement's COUNTRY's development (its capital's organisation). A stateless settlement
    // gets devOrg 0 → no lift → it stays a sparse tribe (eraProd≈BASE) until it FOUNDS or JOINS
    // a state. (A capital reads its own org, since it IS its country's capital.) This is what
    // keeps significant/dense settlements always part of a nation — undeveloped, stateless
    // ground can't bloom on fertility alone, however rich it is.
    let devOrg = 0;
    if (s.countryId >= 0 && world.countries) {
      const c = world.countries.get(s.countryId);
      if (c && c.capital && c.capital.knowledge) devOrg = c.capital.knowledge.organization;
    }
    const devGate = Math.min(1, Math.max(0, (devOrg - T.ERA_PROD_DEV0) / (T.ERA_PROD_DEV1 - T.ERA_PROD_DEV0)));
    // BASE is a uniform floor (climate-NEUTRAL): it carries the ORIGINAL cradle-correct
    // distribution (fertility / rivers / the farming transition — NOT farm-climate), so
    // even undeveloped land holds enough people to found and grow STATES. Without it the
    // dev-gate drove undeveloped ground to bare subsistence (eraProd=1), which starved
    // state formation — the map went sparse and stateless. The agri^POW·devGate term then
    // adds the DEVELOPMENT-driven bloom on top, so the cradles still out-grow the rest as
    // they organise, but the world isn't inert while it gets there.
    s._eraProd = T.ERA_PROD_BASE + T.ERA_PROD_SCALE * Math.pow(agri, T.ERA_PROD_POW) * devGate;
  }
  const agg = agriGate(world, s);   // also builds world._agriCeil (used for the livestock regional gate)
  // ── Animal husbandry: livestock secondary products ──────────────────
  // Oxen (traction), manure (fertiliser) and dairy/meat lift the food a worked
  // hinterland yields — but only where the climate suits herding AND the region
  // actually HAD large domesticable stock. Regional availability reuses the agri
  // ceiling, so isolated landmasses (the New World) and the disease-ridden wet
  // tropics get little (Diamond's missing-domesticates / tsetse effect), while
  // the Old-World temperate-grassland belt gets the full plough-and-manure lift.
  // Develops with farming (agriculture knowledge ≈ the husbandry proxy).
  let livestockBonus = 1;
  if (T.LIVESTOCK > 0) {
    climateOf(world, s);
    const lti = (s.pos.y | 0) * world.tw + (s.pos.x | 0);
    const ceilReg = world._agriCeil ? (world._agriCeil[lti] || 0) : 1;
    s._livestock = livestockClimate(s._climTemp, s._climMoist) * ceilReg;
    livestockBonus = 1 + T.LIVESTOCK * s._livestock * ((s.knowledge && s.knowledge.agriculture) || 0);
  }
  // ── Wet-tropic disease & soil burden (carrying-capacity brake) ──────────
  // Endemic disease (falciparum malaria, sleeping sickness) and leached,
  // quickly-exhausted rainforest soils held tropical population DENSITY far
  // below the temperate world even where the land looked lush — Diamond's
  // wet-tropic brake, and THE reason a fertile-looking equatorial belt (the
  // Congo, West Africa, Amazonia, New Guinea) stayed sparse and stateless while
  // temperate Eurasia filled. It needs BOTH heat AND damp (malaria wants warmth
  // + standing water): the dry-hot subtropics and river breadbaskets (the Nile,
  // the Sahel) and the cool-wet temperate core escape, so it bites the wet
  // tropics specifically. A continuous drag on DENSITY itself — distinct from
  // the agricultural CEILING (a tech limit, agriGate) and from plague (an event).
  let diseaseBurden = 1;
  if (T.TROPICAL_DISEASE > 0 || T.STATE_DISEASE > 0) {
    climateOf(world, s);
    // BROADENED disease signal: warm + at-least-sub-humid (the savanna woodland
    // carried malaria & sleeping sickness too, not only the deep rainforest), so
    // this now thins the savanna as well — see habitability.js malariaSignal.
    s._wetTropic = malariaSignal(s._climTemp, s._climMoist);   // disease intensity (0 dry/cool → 1 hot-wet)
    s._disease = T.TROPICAL_DISEASE * s._wetTropic;   // drives the carrying-capacity drag; STATE_DISEASE reuses _wetTropic for state formation
    diseaseBurden = 1 - s._disease;
  }
  // ── Hot rain-fed aridity (Sahel / dry savanna) ──────────────────────────
  // Erratic, unreliable rainfall held the dry savanna to sparse pastoralism, never
  // dense farming. A drag on carrying capacity that FADES with river access — a
  // managed river through the desert (the Nile) escapes and gets the irrigation
  // lift instead. Distinct from the wet-tropic disease brake above.
  let aridBurden = 1;
  if (T.ARID_PENALTY > 0) {
    climateOf(world, s);
    s._aridity = aridSignal(s._climTemp, s._climMoist, s._riverAcc || 0);
    aridBurden = 1 - T.ARID_PENALTY * s._aridity;
  }
  // _eraProd is the global historical-productivity index (index.js demographic
  // anchor): scaling LAND FOOD here lifts every settlement's carrying capacity
  // together so the world total tracks recorded population, while the spatial
  // distribution stays emergent and the food economy (surplus, trade, army
  // labour all derived from this flow) stays internally consistent.
  // ── Soil exhaustion (salinisation / nutrient depletion) ──────────────────
  // Long, intensive farming TIRES the land — and irrigated ARID land tires FAST
  // (the Fertile-Crescent / Nile salinisation: irrigation water evaporates and
  // leaves its salt, with no rain to flush it), while rain-fed temperate land is
  // robust. A cumulative per-tile fatigue (updateSoil, below) drags the land's
  // food here, so a cradle blooms first and then PLATEAUS/DECLINES as its soil
  // exhausts, while the durable rain-fed belt sustains and overtakes — the
  // historical shift of the centre of civilisation, emergent (no scripted decline;
  // and because the demographic anchor only refills ABSOLUTE penalties, this
  // RELATIVE one surfaces as a centre-of-gravity shift, not a population crash).
  const soilBurden = T.SOIL_EXHAUST > 0 ? 1 - T.SOIL_EXHAUST * (s._soilFatigue || 0) : 1;
  // LAND WORKABILITY — you can only farm land your TOOLS can open. Open, light, WATERED
  // ground (river-valley alluvium) and dry grassland are farmable from the first digging
  // stick, so the river cradles (Nile, Mesopotamia, Indus, Yellow R.) bloom first. But
  // fertile land OFF the rivers is FORESTED and HEAVY: the woodland must be CLEARED (metal
  // axes — bronze, then iron) and the heavy soil broken by the mouldboard PLOUGH before it
  // yields. So the rich temperate plains (Europe) sit near-empty until a civilisation has
  // the metallurgy AND the plough — which is why farming radiated OUTWARD from the cradles
  // as tools spread, not wherever the soil was richest. The land OPENS as the tools arrive.
  let workable = 1;
  if (T.LAND_TOOL_GATE > 0) {
    climateOf(world, s);
    const kk = s.knowledge || {};
    // A river VALLEY is open alluvium — farmable from the first digging stick (the cradles sit
    // on rivers). RIVER-only (s._riverAcc), NOT waterAccess: a forested COAST is not open ground —
    // NW Europe's coastal woodland still had to be felled. Keying this on waterAccess (which
    // counts coast as 0.5) wrongly exempted every coastal forest and gutted the gate, which is
    // why temperate Europe still bloomed in the bronze age with the gate nominally on.
    const riverOpen = Math.min(1, (s._riverAcc || 0) / 0.30);
    const moist = s._climMoist ?? 0.5;
    const tiles = s._terrWorkTiles ?? s._terrTiles ?? 1;
    const meanFert = (s._terrFertSum || 0) / Math.max(1, tiles);
    // FOREST: woodland starts at ~0.40 effective moisture (the sim's own biome line). It must be
    // CLEARED with metal axes. Dry grassland/steppe (<0.40) and river valleys are open.
    const forest = Math.max(0, Math.min(1, (moist - 0.38) / 0.20)) * (1 - riverOpen);
    // HEAVY soil: very rich ground off the rivers (clay plains) — needs the plough; river alluvium is light.
    const heavy  = Math.max(0, Math.min(1, (meanFert - 0.6) / 0.30)) * (1 - riverOpen);
    const axes   = Math.min(1, (kk.metallurgy || 0) / T.LAND_CLEAR_METAL);              // bronze→iron clears forest
    const plough = Math.min(1, Math.max(0, ((kk.agriculture || 0) - 0.45) / 0.40));     // the_plough→heavy_plough breaks heavy soil
    const locked = Math.min(0.92, Math.max(forest * (1 - axes), heavy * (1 - plough))); // the binding lock holds back this share of the land
    workable = 1 - T.LAND_TOOL_GATE * locked;
  }
  s._workable = workable;
  // IRRIGATION — an arid RIVER valley (the Nile, the Euphrates, the Indus) is a fertile
  // ribbon through desert: a managed river makes it extraordinarily productive per acre,
  // which is why the first dense civilisations rose there despite the surrounding aridity.
  // Rain-fed or COASTAL land draws its water from the sky/sea, not a controlled river, so it
  // gets no such concentration. This is the cradles' head-start — it keeps the arid Middle-
  // Eastern river valleys ahead of their better-watered coastal/temperate neighbours early,
  // and fades (relatively) as the rest of the world develops the tools to farm its own land.
  let irrigation = 1;
  if (T.IRRIG_BOOST > 0) {
    climateOf(world, s);
    const arid = Math.max(0, Math.min(1, (T.IRRIG_ARID0 - (s._climMoist ?? 0.5)) / 0.20));   // DRY land only — not the rainy/coastal belt
    const river = s._riverAcc || 0;                                                          // a managed RIVER, not the sea/coast
    const farmTech = Math.min(1, ((s.knowledge && s.knowledge.agriculture) || 0) / 0.5);     // needs the farming/irrigation know-how
    irrigation = 1 + T.IRRIG_BOOST * arid * river * farmTech;
  }
  s._irrigation = irrigation;
  // ALLUVIAL FLOODPLAIN — a river's annual flood lays down fresh silt, making the valley floor rich
  // cropland regardless of rainfall. This is the flood-farming GRAIN that actually fed the first
  // civilisations — the Nile's black land, the Mesopotamian/Indus/Yellow-River/Yangtze floodplains,
  // the wet-rice river deltas of monsoon Asia. Where IRRIGATION above models only the ARID valley's
  // water-concentration edge, this models the silt fertility EVERY floodplain gets, wet or dry, so a
  // river CRADLE feeds its dense population from its own LAND (the granary, not the fishery). Coastal
  // lowland — deltas, plains, reclaimed polder — shares a fraction of the lift. The river valley is the
  // densely-settled breadbasket; the political union of those settlements IS the valley state.
  let alluvium = 1;
  if (T.ALLUVIUM > 0) {
    const river = s._riverAcc || 0;                                                        // river floodplain — full silt fertility
    const coast = Math.max(0, (s.waterAccess || 0) - river);                               // coastal lowland: delta, plain, reclaimed marsh
    const lowland = river + ALLUVIUM_COAST * coast;
    const farmTech = Math.min(1, ((s.knowledge && s.knowledge.agriculture) || 0) / 0.5);   // worked by a farming people
    alluvium = 1 + T.ALLUVIUM * lowland * farmTech;
  }
  s._alluvium = alluvium;
  // CASH CROPS displace food: arable turned over to sugar/cotton/tobacco grows no grain,
  // so a plantation settlement must IMPORT food (the new dynamic — see updateCoercedLabour).
  const cashLand = T.SLAVERY ? (s._cashFrac || 0) * CASHCROP_LAND : 0;
  const landFood0 = netFert * T.FARM_YIELD_PER_FERT * fy * agg * armyLabor * (s._eraProd || 1) * livestockBonus * diseaseBurden * aridBurden * soilBurden * workable * irrigation * alluvium * (1 - cashLand);
  // Famine (shocks.js): a regional bad-harvest window slashes the land yield.
  const landFarm = world.step < (s._famineUntil || 0)
    ? landFood0 * (s._harvestMul || 1) : landFood0;
  // ── Pastoral calories: the herd itself as FOOD (dairy, meat, blood) ──────
  // Distinct from livestockBonus (oxen/manure LIFTING a farmed field): on open
  // pasture too dry, too marginal or too disease-bound for dense cereal farming —
  // the Eurasian steppe, the Sahel, the East-African cattle belt — people lived
  // OFF the herd directly. A land-food source that does NOT need fertile cropland,
  // so it feeds exactly the grassland the farm term leaves empty, scaled by the same
  // herding suitability + domesticate-availability + tsetse gate already in
  // s._livestock, the grazed territory, and development. LOW density (a steppe feeds
  // far fewer per tile than a wheat field), so it never breeds a farming-grade
  // primate; and it survives famine (herds are the classic crop-failure hedge), so
  // it's added AFTER the harvest cut as a stable floor.
  const agriK = (s.knowledge && s.knowledge.agriculture) || 0;
  const grazeTiles = s._terrWorkTiles ?? s._terrTiles ?? 0;
  const pastoral = T.LIVESTOCK_FOOD > 0
    ? T.LIVESTOCK_FOOD * (s._livestock || 0) * grazeTiles * (s._eraProd || 1) * armyLabor * (0.3 + 0.7 * agriK)
    : 0;
  s._pastoral = pastoral;
  const landFood = landFarm + pastoral;
  // The share of subsistence that comes OFF THE HERD — the emergent measure of
  // saddle-life. Read by the mobility-learning pass: a people who EAT from the
  // herd live on horseback, and horsemanship compounds accordingly. Measured
  // against ACTUAL calories (landFood, post-harvest) on purpose: when the
  // harvest fails a mixed farming-herding people leans on the flock (crisis
  // transhumance — herds are the famine hedge, as the pastoral-food note above
  // says), genuinely living more on horseback that season. The pastoral share
  // rising in a dearth is a real behaviour, not an artefact to correct away —
  // and it is what the emergent history validates against across seeds.
  s._pastShare = landFood > 0 ? pastoral / landFood : 0;

  // FISH — a LOCAL marine supplement, never a staple. History is emphatic: the great agrarian
  // empires (Egypt, Mesopotamia, China, Rome) ran on GRAIN; fish was caloric noise to them. But fish
  // WAS the foundation of a distinct class of societies — the cold-temperate fishing coasts where the
  // sea teemed and the land farmed poorly: Norway's cod, the North-Sea/Baltic herring, the Pacific-
  // Northwest salmon peoples (complex, sedentary, monument-building, NO agriculture), the Humboldt-
  // anchovy coast that may have underwritten Caral, the oldest American civilisation. So fish here
  // emerges exactly where it mattered and nowhere else: it scales UP where the SEA is rich and the
  // LAND is poor, and falls to ~0 in the fertile river cradles and the nutrient-poor tropics.
  const sea = Math.max(0, (s.waterAccess || 0) - (s._riverAcc || 0));   // SEA (coast) access — rivers are GRAIN-fed (alluvium), not fished
  let fish = 0;
  if (T.FISH_RATE > 0 && sea > 0.02) {
    climateOf(world, s);
    const t = s._climTemp ?? 0.7;
    // Marine productivity: the world's great fisheries are COLD-temperate/subpolar (cold, nutrient-
    // churned water teems); warm tropical seas are clear and barren; permanent ice locks the surface.
    // So the catch peaks in the cool, ice-free band (~0–15°C) and tails off either side.
    const iceCut  = Math.max(0, Math.min(1, (0.60 - t) / 0.10));         // sub-freezing → ice-locked, short season
    const tropCut = Math.max(0, Math.min(1, (t - 0.80) / 0.15));         // warm tropical sea → nutrient-poor
    const seaRich = (1 - T.COLD_FISH * iceCut) * (1 - 0.7 * tropCut);
    // LAND-POOR gate: fish only supplements where the farmed LAND can't carry the people. landFood
    // per workable tile measures how rich the local farming is — high in a cradle, low on a marginal
    // coast — so a fertile valley draws ~no fish while a cold/barren shore leans on the sea.
    const tiles = s._terrWorkTiles ?? s._terrTiles ?? 1;
    const landPerTile = landFood / Math.max(1, tiles);
    const poor = Math.max(0, Math.min(1, 1 - landPerTile / FISH_LAND_REF));
    // Fishery technology (tech.js fishFactor: 0.3 pre-tech baseline rising
    // with navigation + fishing techs) — normalized to that baseline so a
    // tech-less shore fishes exactly as calibrated and technique multiplies
    // upward from there. (The channel existed but was read by nothing.)
    fish = T.FISH_RATE * sea * seaRich * poor * ((techEff(s).fishFactor || 0.3) / 0.3);
  }
  s._fishYield = fish;

  // Land food is STORABLE — it fills granaries and ships across the world
  // to feed distant cities. Fish is perishable: it feeds the local
  // population well but can't be shipped or stored, so it never becomes
  // export food. The food trade reads _storableSupply for what a
  // settlement can send out.
  s._storableSupply = landFood;
  // Carrying food = what the food HIERARCHY leaves this settlement — its
  // aggregated subtree intake minus what it ships up to its liege (computed last
  // tick, foodHierarchy.js) — plus local perishable fish. So a city is fed by its
  // whole hinterland, not 12 partners. Before the first aggregation (_foodNet
  // unset) fall back to its own land food.
  const netLand = s._foodNet !== undefined ? s._foodNet : landFood;
  const supply = netLand + fish;
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
  // Under SLAVE_PEOPLE the unfree are inside the headcount but are fed at the owner's
  // subsistence ration (the slaveFood line below), not the civic rate — split them out
  // so they aren't fed twice.
  const unfreeIn = (T.SLAVERY && T.SLAVE_PEOPLE) ? Math.min(s._unfree || 0, s.people) : 0;
  const civDemand = (s.people - unfreeIn) * 0.0030 * urbanFactor;
  // The garrison eats too — extra rations/fodder above the civilian rate
  // (provisioning). This is the food cost of a standing army: a big garrison
  // burns the food surplus that would otherwise fill granaries / grow the
  // town (guns vs. butter). The army is SIZED against this surplus in
  // musterArmies, so the granary still nets positive in steady state.
  const armyFood = (s.army || 0) * ARMY_FOOD;
  // The unfree eat too — fed at subsistence by the owner (≤ free per-capita). A big
  // plantation/mine workforce adds real food demand the settlement must cover or import.
  const slaveFood = T.SLAVERY ? (s._unfree || 0) * 0.0030 * T.SLAVE_FEED : 0;
  const demand = civDemand + armyFood + slaveFood;
  // Expose rates so the food-trade pass can compute surplus/deficit
  // per road without recomputing forage + farmland sums.
  s._foodSupply = supply;
  s._foodDemand = demand;          // total (civilian + garrison) — drains the granary
  s._civFoodDemand = civDemand;    // civilian only — army sizing reads this
  s._landFood = landFood;          // LOCAL farm production only (no hierarchy imports, no fish) — for the food-viability overlay
  s._urbanFactor = urbanFactor;
  s.food += supply - demand;

  // Seasonality → storage: a mild-summer/harsh-winter climate MUST bank the
  // harvest to survive winter, so it builds deeper granaries (root cellars,
  // smokehouses) — a larger buffer against famine/siege than a tropics where
  // food is gathered year-round. (A storage-economy proxy, not a full annual
  // cycle.) Reuses the cool-temperate selection target.
  const seasonStore = T.SEASON_STORE > 0 ? 1 + T.SEASON_STORE * seasonalSelect(s._climTemp || 0.5, s._climMoist || 0.5) : 1;
  const storageCap = (80 + s.tier * 200) * seasonStore;
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
  // Urban footprint in REAL distance, counted in REFERENCE tiles (RES_INVARIANT_POP
  // Phase 2): spaceCapacity multiplies this area by a per-reference-tile density
  // (DENSITY_BASE, calibrated at the 240-tile grid), so both the scan radius and the
  // area unit must be resolution-invariant or a finer grid's cities hold rn²× fewer
  // (smaller real footprint) people at rn²× the count. Off ⇒ radius 14, count raw.
  const _rn = rNormPop(world), _invA = 1 / (_rn * _rn);
  const rr = Math.max(1, Math.round(SPACE_RADIUS * _rn));
  let n = 0;
  for (let dy = -rr; dy <= rr; dy++) {
    const ny = sy + dy;
    if (ny < 0 || ny >= th) continue;
    for (let dx = -rr; dx <= rr; dx++) {
      const nx = ((sx + dx) % tw + tw) % tw;
      const e = elev[ny * tw + nx];
      if (e > 0 && e < 0.6) n += _invA;        // habitable land only, in reference-tile units
    }
  }
  return n;
}

// The hard ceiling: how many people the SITE can physically hold =
// buildable land x density, density rising with construction knowledge
// (more people on the same ground as building tech improves).
function spaceCapacity(s) {
  const area = s._buildableArea || 1;
  const density = DENSITY_BASE * (1 + techEff(s).buildLevel * T.DENSITY_PER_CONSTR);
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
  const houseK = s._houseK || 0, foodK = s._foodK || 0;
  // Cities lay out housing AHEAD of the food they have today; that empty
  // headroom is exactly what creates the demand to IMPORT grain (foodAppetite's
  // growthNeed) and draw migrants — how a real city grows. With housing pinned
  // to current foodK, houseK tracks population, growthNeed ~ 0, and the city
  // never pulls the grain that would let it grow, so metropolises never form.
  const target = s.people > URBAN_ANTICIPATION_REF ? foodK * URBAN_ANTICIPATION : foodK;
  s._housingPressed = target > houseK * 1.02;     // set EVERY tick — conquest.js + food appetite read it
  if (!s._housingPressed) { s._developRate = 0; s._devReason = null; return; }

  // ── Construction is BATCHED (temporal LOD; see DEV_STRIDE) ──
  // The materials gate + supplier-payment walk below iterate the trade reach every
  // tick a town builds — the biggest slice of the per-settlement pass. Housing
  // grows slowly, so resolve it every DEV_STRIDE ticks at DEV_STRIDE× rate: same
  // average build pace + payments, ~DEV_STRIDE× cheaper. Only _housingPressed
  // (above) stays per-tick; between bursts _developRate / _devReason keep their
  // last value so the info-panel readout is steady. Staggered by id → even cost.
  const stride = Math.max(1, T.DEV_STRIDE | 0);
  if (stride > 1 && (world.step + s.id) % stride !== 0) return;
  s._developRate = 0;
  s._devReason = null;

  // Room to grow = up to whichever of the (anticipatory) housing target / SPACE
  // binds first.
  const space = spaceCapacity(s);
  const room = Math.min(target, space) - houseK;
  if (room <= 0) { s._devReason = "space"; return; }   // built out the site

  // MATERIALS gate: timber + stone, local or from a trade partner. The
  // partner aggregate (best supplier + total supply weight) drifts slowly,
  // so it's cached and refreshed only every KNOW_INTERVAL ticks (staggered)
  // rather than re-walking the whole reach every tick a town is building.
  const own = s.localRes || {};
  const localMat = (own.timber || 0) + (own.stone || 0);
  const partnerWeight = p => { const pr = p.localRes || {}; return (pr.timber || 0) + (pr.stone || 0) + 0.05; };
  if (!s._devMat || (world.step + s.id) % KNOW_INTERVAL === 0) {
    let bpm = 0;
    if (s._tradeReach && world._byId) {
      for (const pid of s._tradeReach.keys()) {
        const p = world._byId.get(pid);
        if (!p || p.mode !== "settled") continue;
        const pr = p.localRes || {};
        const pm = (pr.timber || 0) + (pr.stone || 0);
        if (pm > bpm) bpm = pm;
      }
    }
    s._devMat = { bestPartnerMat: bpm };
  }
  const bestPartnerMat = s._devMat.bestPartnerMat;
  if (Math.max(localMat, bestPartnerMat) < 0.05) { s._devReason = "materials"; return; }

  // ×stride: this burst stands in for `stride` ticks of building (so the average
  // housing/tick — and the coin paid to suppliers — matches the per-tick original).
  const buildCap = (0.2 + (s.knowledge.construction || 0) * 2)
    * Math.sqrt(Math.max(1, s.people)) * BUILD_RATE * stride;
  let add = Math.min(buildCap, room);
  if (add <= 0) return;

  // Local materials cover part of the cost for free (own forests/quarries
  // + local labour); the rest is bought from suppliers and paid for in
  // coin, transferred to them.
  const discount = Math.min(0.7, localMat * 0.5);
  // Building costs scale with the local price level (inflation.js): an
  // (b) NOMINAL-inflation model: building costs are REAL (base) — not × localP —
  // so the absolute money level doesn't squeeze construction (and thus housing
  // and population). localP stays for Hume competitiveness + the price ticker.
  let cost = add * INFRA_COST * (1 - discount);
  if (cost > 0) {
    // Pay the suppliers ACTUALLY in reach this tick, distributing by a weight
    // sum recomputed over exactly those recipients. The cached _devMat.totalW
    // can be stale (a partner died / reach shifted since the KNOW_INTERVAL
    // refresh), which would make the shares sum to less/more than `cost` and
    // silently leak or mint coin — but the money supply is meant to be closed
    // (inflation.js depends on it). Recomputing liveW here keeps Σshare == cost.
    let liveW = 0; const recips = [];
    if (s._tradeReach && world._byId) {
      for (const pid of s._tradeReach.keys()) {
        const p = world._byId.get(pid);
        if (!p || p.mode !== "settled") continue;
        const w = partnerWeight(p); liveW += w; recips.push([p, w]);
      }
    }
    if (liveW > 0) {
      const spare = (s.wealth || 0) - getWealthReserve(s);
      if (spare <= 0) { s._devReason = "coin"; return; }   // needs to buy materials it lacks
      if (cost > spare) { add *= spare / cost; cost = spare; }
      if (add <= 0) return;
      s.wealth -= cost;
      recordOut(s, OUT_MATERIALS, cost);
      for (const [p, w] of recips) {
        const share = cost * (w / liveW);
        p.wealth = (p.wealth || 0) + share;
        recordIn(p, IN_MATERIALS, share);
      }
    } else {
      // No live suppliers to buy the imported share from. An isolated town
      // can only build what its OWN forests/quarries cover (the discount
      // fraction) — it can't conjure the bought share for free, which used
      // to let cut-off settlements out-build connected ones at zero coin.
      add *= discount;
      if (add <= 0.0001) { s._devReason = "materials"; return; }
    }
  }
  s.infrastructure = (s.infrastructure || 0) + add;
  s._developRate = add / stride;   // per-tick-equivalent (the burst built `add` over `stride` ticks)
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
  const perCapita = 0.003 * (s._urbanFactor || 1);
  let foodK = (s._foodSupply || 0) / perCapita;   // _foodSupply = food-hierarchy net (own + subtree intake − shipped up) + local fish
  // ×_eraProd: the housing/site ceiling rises with the same global productivity
  // index as food, representing denser settlement (intensive rural occupation,
  // vertical urban growth) in later eras. Without this the population would stay
  // pinned at the medieval SITE cap while food scaled freely — the carrying
  // capacity must be linear in _eraProd end-to-end or the anchor (index.js)
  // winds up against the housing dead-zone.
  // Under the anchor (ANCHOR_POP=1) housing must scale LINEARLY in _eraProd or the
  // controller winds up against a housing dead-zone. Under EMERGENT productivity
  // (ANCHOR_POP=0) per-settlement _eraProd reaches into the hundreds, and applying it
  // linearly to a single city's housing lets one high-agriculture capital absorb a
  // whole region into an unphysical 70M+ megacity (and makes the world fragile — when
  // that one city falls the global total craters). City INFRASTRUCTURE can't scale as
  // fast as farm OUTPUT, so housing takes a DAMPENED power (HOUSE_ERA_POW≈0.45): the
  // surplus food the capped city can't house stays in the hinterland feeding RURAL
  // population (ruralCap keeps full _eraProd), so the modern boom spreads across the
  // land and many towns instead of piling into one metropolis.
  const houseEra = T.ANCHOR_POP > 0 ? (s._eraProd || 1) : Math.pow(s._eraProd || 1, T.HOUSE_ERA_POW);
  let houseK = housingCapacity(s) * houseEra;
  // RURAL CEILING: a tier-0 farming region holds only a rural district's worth
  // of people (URBAN_CAP). Capping foodK AND houseK (not just K) is deliberate:
  // it drops the region's grain HUNGER ((houseK−foodK)/houseK → ~0 once both sit
  // at the ceiling) so it stops competing with towns for shipped grain, and it
  // leaves no urbanise headroom (K−people → 0) so rural migrants flow on to the
  // towns. The land still GROWS its full harvest — that surplus ships up the
  // hierarchy (via _storableSupply, untouched here) to grow the towns.
  if ((s.tier | 0) === 0 && !T.DISSOLVE_FARMS) {
    // (DISSOLVE_FARMS lifts this cap entirely: a town's size is set by what its
    // catchment FEEDS — see the Locality K below — so a big/rich catchment grows
    // into a city and a poor one stays a town, with no fixed rural ceiling.)
    // ×_eraProd: the rural ceiling rises with the same global productivity index
    // as land food (updateFood), so the countryside scales WITH the cities and
    // the rural/urban balance is preserved as the world total tracks history.
    // ×_eraProd^RURAL_ERA_POW (emergent): damping the rural HOUSING ceiling below land
    // food's full _eraProd means a modern countryside FEEDS more than it can HOUSE, so the
    // surplus ships up the hierarchy to grow TOWNS instead of piling into ever-denser
    // villages — the farm→city drift that urbanises the modern era. Linear under the anchor.
    const rEra = T.ANCHOR_POP > 0 ? (s._eraProd || 1) : Math.pow(s._eraProd || 1, T.RURAL_ERA_POW);
    const ruralCap = URBAN_CAP * (1 + URBAN_DENSITY_GAIN * Math.max(0, (s._farmYield || 1) - RURAL_YIELD_BASE)) * rEra;
    foodK = Math.min(foodK, ruralCap); houseK = Math.min(houseK, ruralCap);
  }
  // LOCALITY model: population = whatever the farmable catchment feeds (foodK
  // already folds in own land + any food routed in). Housing stops being the
  // size cap — a locality IS its hinterland, so a rich-land centre simply holds
  // more people (→ a city) and a poor one stays a town. Money is a separate
  // closed layer (commerce/mining), unrelated to how big the place is.
  // How far the demographic transition can depress intrinsic growth: at full
  // modernity (urban majority + literate bureaucracy + secure food) fertility
  // falls to ~15% of the Malthusian rate — near-replacement, not extinction.
  const DEMO_TRANSITION = 0.85;
  // Urban graveyard strength, RELATIVE to intrinsic growth: at full endemic
  // load, full urbanity and zero sanitation, crowd disease slightly more than
  // cancels natural increase (1.2x) — the city needs migrants to grow.
  const URBAN_GRAVEYARD_W = 1.2;
  const K = (T.LOCALITY_MODE || T.DISSOLVE_FARMS)
    ? Math.max(K_MIN_VIABLE, foodK)
    : Math.max(K_MIN_VIABLE, Math.min(foodK, houseK));
  s._k = K;
  s._foodK = foodK;            // exposed so the info panel can show which limit binds
  s._houseK = houseK;

  const _dt = world._dt || 1;                         // time-granularity step (1/SIM_GRANULARITY)
  if (s.food <= 0.01 && s.people > 1) {
    const before = s.people;
    s.people *= Math.pow(0.985, _dt);                 // famine die-off, per-tick → granularity-scaled
    fieldShift(world, s, s.people - before);          // one population: hunger empties the LAND too (FIELD_DEMOG)
  } else if (T.ONE_POP) {
    // ONE POPULATION (docs/one-population.md slice B): the census logistic
    // RETIRES — the field grows this region's people (at the human rate, its
    // urban core at the bent rate below), and s.people is DERIVED from the
    // field after the field pass (popField.js deriveOnePop). Here we only
    // compute what the core's stamp needs: the demographic-transition bend
    // and the urban-graveyard sink, from the settlement's own live state —
    // the same inputs, the same never-a-date reasoning as the census form.
    let r = T.SETT_GROWTH;
    const urbShare = (s._urbanPop || 0) / Math.max(1, s.people);
    const lit = Math.min(1, Math.max(0, (((s.knowledge && s.knowledge.organization) || 0) - 0.6) / 0.3));
    const fed = Math.min(1, (s._foodSupply || 0) / Math.max(1, s._foodDemand || 1));
    r *= 1 - DEMO_TRANSITION * Math.min(1, urbShare / 0.5) * lit * fed;
    s._rEff = r;          // the core tile's intrinsic rate (popField re-integrates it)
    s._rSink = T.SETT_GROWTH * URBAN_GRAVEYARD_W
      * (s._diseaseLoad || 0) * Math.min(1, urbShare / 0.3)
      * (1 - (techEff(s).healthRelief || 0));   // flat excess mortality — does NOT ease as the city fills
  } else {
    // Exponential-form logistic: identical growth for small r·dt, but a
    // carrying-capacity CRASH (war front severs the fields, famine guts the
    // harvest, K collapses under people) declines smoothly instead of the
    // raw Euler step killing a large city in ONE tick (or driving its
    // population negative) — the granary/famine path gets time to bite.
    //
    // DEMOGRAPHIC TRANSITION (review D4): the intrinsic growth RATE itself
    // bends as a society modernises — an urban, literate-bureaucratic,
    // food-secure population chooses smaller families (every historical
    // society that reached all three did). The escape from Malthus used to
    // raise only K (via _eraProd), so the world stayed maximum-fertility
    // forever. All three inputs are the settlement's own live state — a
    // world that never industrialises never transitions, a region that
    // modernises early transitions early, never a date anywhere.
    const grow = 1 - s.people / K;
    let r = T.SETT_GROWTH;
    if (grow > 0) {
      const urbShare = (s._urbanPop || 0) / Math.max(1, s.people);
      const lit = Math.min(1, Math.max(0, (((s.knowledge && s.knowledge.organization) || 0) - 0.6) / 0.3));
      const fed = Math.min(1, (s._foodSupply || 0) / Math.max(1, s._foodDemand || 1));
      const modern = Math.min(1, urbShare / 0.5) * lit * fed;
      r *= 1 - DEMO_TRANSITION * modern;
    }
    // THE URBAN GRAVEYARD (review D57): dense settlements carry a chronic
    // crowd-disease mortality ∝ their endemic disease load × how urban they
    // are, blunted by their own discovered health tech. At full endemic load
    // an un-sanitized city's excess deaths roughly cancel natural increase —
    // the historical pattern where great cities grew only by drawing people
    // in — and the sink lifts exactly when aqueducts/germ theory arrive.
    // Villages (low urban share) and clean-tech cities are untouched.
    const urbShare2 = (s._urbanPop || 0) / Math.max(1, s.people);
    const sink = T.SETT_GROWTH * URBAN_GRAVEYARD_W
      * (s._diseaseLoad || 0) * Math.min(1, urbShare2 / 0.3)
      * (1 - (techEff(s).healthRelief || 0));
    const f = Math.exp((r * grow - sink) * _dt);
    s.people = s.people * f;
    // Hereditary bondage (SLAVE_PEOPLE): children born to the unfree are unfree, and the
    // urban graveyard takes free and unfree alike — the unfree share rides the settlement's
    // own demographic wave (its EXTRA plantation/mine mortality is SLAVE_DEATH, in
    // updateCoercedLabour). Without this every birth was implicitly born free, so enslaved
    // populations could never reproduce themselves — but natural increase (not only the
    // trade) is how the North American enslaved population actually grew.
    if (T.SLAVERY && T.SLAVE_PEOPLE && (s._unfree || 0) > 0) s._unfree = Math.min(s._unfree * f, Math.max(0, s.people - 1));
  }
  if (s.people < 1.5) {
    s.mode = "dead";
    bankRuinHoard(world, s);
    logEvent(world, "settlement.abandoned", { s: s.id, sName: s.name, polity: s.countryId });
    return;
  }
  // Withering: a settlement stuck below 8 people for too long (a stillborn
  // site whose territory can't feed it, or a post-famine zombie) dies.
  // Stable small forage hamlets sit at ~10–15 and never trip the timer.
  if (s.people < 8) {
    if (s._witherSince === undefined) s._witherSince = world.step;
    if (world.step - s._witherSince > 2000 / _dt) {   // same wither-window in history-time at any granularity
      s.mode = "dead";
      bankRuinHoard(world, s);
      logEvent(world, "settlement.withered", { s: s.id, sName: s.name, polity: s.countryId });
    }
  } else {
    s._witherSince = undefined;
  }
  // ── Province split ── a settlement's people = its town's URBAN core + the
  // surrounding RURAL countryside it administers (its province). The rural share
  // is high pre-industrially and falls as farm yield frees labour to the towns,
  // so urbanisation rises over history. This is what makes a big farming province
  // read as mostly rural rather than mislabelling its whole population "urban".
  if (T.DISSOLVE_FARMS) {
    const ruralFrac = ruralShare(s);
    s._ruralPop = s.people * ruralFrac;
    s._urbanPop = s.people - s._ruralPop;
  } else {
    s._ruralPop = 0; s._urbanPop = s.people;
  }
}

// ── Tier ───────────────────────────────────────────────────────────
function updateTier(world, s) {
  // RELATIVE tiers: the bar to count as a town / city / metropolis SCALES with the world's
  // total population, so as civilisation grows the size that qualifies as a "city" rises too
  // (a 500-soul settlement is a large farming village in a populous world, a city in an empty
  // one). This keeps the urban hierarchy proportional and the rural majority rural, instead of
  // mislabelling mid-size farming settlements as "towns" once the world fills up. Cached once
  // per tick. (TIER_SCALE_REF / TIER_SCALE_MAX tune it; =off by setting REF huge.)
  let sc = world._tierScale, topU = world._topUrban;
  if (world._tierScaleStep !== world.step) {
    let tot = 0, top = 0;
    for (const x of world.settlements) if (x.mode === "settled") {
      tot += x.people || 0;
      if ((x.tier | 0) >= 1 && (x.people || 0) > top) top = x.people;   // largest URBAN centre, for the floating metro bar
    }
    sc = world._tierScale = Math.max(0.4, Math.min(T.TIER_SCALE_MAX, tot / T.TIER_SCALE_REF));
    topU = world._topUrban = top;
    world._tierScaleStep = world.step;
  }
  // Tier bars: the rural→TOWN bar (tier 1) scales with total population (big
  // farming villages shouldn't read as "towns" once the world fills up). The CITY
  // bar stays absolute — a genuine floor for "an urban centre". The METROPOLIS bar
  // floats with the largest city (METRO_REL_FRAC of it, floored at the absolute
  // base): "metropolis" means one of the handful of biggest cities of the age, so
  // it stays rare as development lifts every city's size, instead of the whole
  // city tier eventually crossing a fixed bar into a metro glut.
  const metroBar = Math.max(TIER_THRESHOLD[3], topU * METRO_REL_FRAC);
  // DISSOLVE_FARMS: a settlement bundles its rural hinterland + urban core into one
  // entity, so they run large — scale the CITY bar with world population too (as the
  // town bar already does), or every big farming region mislabels as a "city" and
  // urbanisation reads ~90%. Now "city" means a genuine concentration of its age.
  const cityScale = T.DISSOLVE_FARMS ? sc : 1;
  const bar = (t) => t === 3 ? metroBar : TIER_THRESHOLD[t] * (t === 1 ? sc : t === 2 ? cityScale : 1);
  // Farming regions (tier 0) NEVER urbanise in place: a region is a collection
  // of villages, not a proto-city. It instead BIRTHS a separate town within its
  // catchment (urban genesis, crystallize.js). So the tier ladder here moves
  // only ALREADY-URBAN nodes (tier ≥ 1) up and down — the rural→urban step is a
  // spawn, not a relabel.
  // Under DISSOLVE_FARMS the smallest settlement IS a town: no tier-0 farming regions
  // ever exist. Any path that mints one anyway (cradles start small; a colony created
  // without an explicit tier) is floored to a town here, so it can't linger as a
  // "farming region" once the relative town-bar rises above its size mid-game.
  if (T.DISSOLVE_FARMS) { if ((s.tier | 0) < 1) s.tier = 1; }
  else if ((s.tier | 0) === 0) return;   // legacy model: tier-0 regions birth towns, don't relabel
  // Promote among the urban tiers (town → city → metropolis).
  for (let t = TIER_THRESHOLD.length - 1; t > s.tier; t--) {
    if (s.people >= bar(t)) {
      s.tier = t;
      // Announce "grew into a city/metropolis" only the FIRST time this rung is reached
      // (s._peakTier), not on every flicker. Settlements cluster at the relative city bar
      // and flip tier 1↔2 harmlessly (the flip barely affects behaviour) — logging each
      // crossing drowned the chronicle in thousands of grew/declined lines.
      if (t > (s._peakTier | 0)) {
        s._peakTier = t;
        logEvent(world, "settlement.tier", { s: s.id, sName: s.name, polity: s.countryId,
          tier: t, tierName: TIER_NAME[t], up: 1, people: Math.round(s.people) });
      }
      return;
    }
  }
  // Demote one rung once population has fallen clearly below the current tier's
  // floor — but never below tier 1. SILENT: a town slipping a rung at the floating
  // bar isn't chronicle-worthy and would only flicker against the re-promotion.
  if (s.tier > 1 && s.people < bar(s.tier) * TIER_DEMOTE_FRAC) {
    s.tier -= 1;
  }
}

export { TIER_THRESHOLD, TIER_NAME };

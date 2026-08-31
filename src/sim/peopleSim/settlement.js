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
import { techEffects, stateOrgBar, orgEraCapOf } from "./tech.js";
import { agriGate, bestPackageAt, pkgSuitAt, cropCeil } from "./agriculture.js";
import { CROP_BY_ID } from "../cropPackages.js";
import { logEvent } from "./events.js";
import { fieldShift } from "./popField.js";
import { ensurePolity, getPolity, fiscAdoptable } from "./entities.js";
import { foundCulture, getCulture, seedCulture, nameFor, admixArrivals } from "./cultures.js";
import { T, rNormPop } from "./tuning.js";
import { cageAt, cageFillAt } from "./cageField.js";
import { malariaSignal, tsetseSignal, aridSignal, grainSpoilClimate } from "./habitability.js";
import { recordIn, recordOut, IN_MINING, IN_GOODS, IN_MATERIALS, IN_CREDIT, IN_LUXURY, OUT_GOODS, OUT_MATERIALS, OUT_CREDIT } from "./money.js";
import { hash32 } from "./rng.js";
import { POP_SCALE } from "../units.js";   // T.VIABLE_UNITS reads the viability constants as PEOPLE, which is what their comments say they are
import { updateGoods, LEG_GOOD, GOODS, G_STAPLE, G_MATERIALS, G_ORE, G_METAL, G_CLOTH, G_WARES, G_SERVICES } from "./goods.js";   // goods-vector Stage 1 (T.GOODS_PRICES; ESM cycle is fine — functions only, like the roads.js pair)

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
// Floors under the PERCENTILE tier bars (updateTier, Tier-B food wave): the
// measured pre-Tier-B EFFECTIVE bars — the retired relative scale sat pinned at
// its 0.4 floor all run, so the world actually ran on THRESHOLD×0.4 = 60/240.
// Kept as floors so a sparse early world still mints its first towns; they are
// a documented measured-floor shortcut (design-food-economy-wave.md open q.4),
// not first-principles census minima.
const TIER_TOWN_FLOOR = 60;    // = TIER_THRESHOLD[1] × 0.4
const TIER_CITY_FLOOR = 240;   // = TIER_THRESHOLD[2] × 0.4
// ── T.CITY_CORE: ABSOLUTE urban-core floors — the words defined, not ranked ──
// The measured failure of re-ranking alone (see the lever): while the bar is a
// percentile or K×median it mints a fixed SHARE of "cities" in ANY distribution,
// so the map showed stone-age towns everywhere and hamlet-cored "metropolises".
// These floors are DEFINITIONS of the words on the urban-core scale (census
// units, 1 = 1,000 people): a TOWN is a settlement whose core holds ~2,000
// people (the smallest agglomerations the urban literature calls towns); a CITY
// ~10,000 (the classic threshold, Uruk-period cities at 10-40k); METROPOLIS
// keeps its relative form but is floored at 40 (=40,000 — Uruk at its height,
// the largest city on Earth in its age). Historically anchored, era-free, and
// resolution-free (a core is a count of people, not of tiles). Under the lever
// tier 0 EXISTS again as a LABEL — a VILLAGE/rural centre — without resurrecting
// the farming-region entity: it farms (DISSOLVE opens food to every tier),
// trades locally, and simply is not called a town on the map, does not plan
// trunk roads (ROAD_MIN_TIER), and does not self-anchor sovereignty.
const TIER_CORE = [0, 2, 10, 40];
const TIER_NAME_CORE = ["village", "town", "city", "metropolis"];   // tier-0 under CITY_CORE is one rural community, not the legacy farmed-region abstraction
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
// T.VIABLE_UNITS — the SAME constant, read in the units its own comment claims.
// K_MIN_VIABLE and the wither cull below are both written as "8", and the wither
// comment says "stable small forage hamlets sit at ~10-15". Under POP_SCALE=1000
// that reads as forage hamlets of 10,000-15,000 people, which is a town. The pair
// was written for a HEADCOUNT scale. Measured consequence (docs/tier-ratchet-
// 2026-08-27.md section 26): with the 12k founding stamp retired, 36.5% of the
// register lands on a new mode at EXACTLY 8.00su — this floor — because
// coreEff = min(_coreF, kLocal + kBeyond) and kLocal + kBeyond is identically
// s._k/scale, so a settlement under the floor reports exactly K_MIN_VIABLE.
// ZERO NEW CONSTANTS: 8 stays 8, expressed as 8 PEOPLE rather than 8,000.
// The pair MUST move together — lowering the capacity floor alone would drop
// settlements under an unchanged cull threshold and kill them wholesale.
const viableUnits = () => (T.VIABLE_UNITS ? 8 / POP_SCALE : 8);

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
// LUX_SUPPLY_RATE -> runtime lever (tuning.js T.LUX_SUPPLY_RATE): coin/tick a
// region can earn per luxury-unit × √pop. Exposed for the goods-vector
// calibration battery (spec Stage 4: luxury should be a thin high-margin
// sliver, not the biggest line in every port) — default unchanged.
const LUX_SPEND_FRAC  = 0.015;  // fraction of SPARE wealth a settlement spends on luxury/tick
                                // (so rich hoards drive real luxury demand, not just headcount)
// Fish: per-tick food a COASTAL settlement lands (see updateFood's FISH block).
// Tier-B model (T.FISH_LABOR): catch = fishers × per-capita catch × fishery
// tech × stock abundance — fishers are a labor share ramped toward
// FISHER_MAX × the unmet-need share (clamp01(1 − retainedLand/foodDemand): the
// sea supplements exactly the need the land leaves unfilled, so a fertile
// cradle draws ~no boats while a marginal coast lives off the sea), withdrawn
// from farm labor 1:1, and the catch draws down a per-coast-tile logistic
// stock (updateFishStocks). A landlocked site gets nothing.
// FISH_RATE -> retired lever (tuning.js: the legacy flat cap, FISH_LABOR=0 arm)

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

// ── T.BORN_OF_LAND: whose flag is a NEWBORN settlement's? ────────────────────
// The legacy answer is `its own` — sovereignty as the default value of the
// field, with T.STATE_RECORDS postponing it to the writing bar. Measured at
// both grids on the live arm (docs/nationless-cities-2026-08-22.md): of the
// cities minted inside a LIVE realm's own field, 4 of 1,252 joined it at
// tw=480 and 3 of 728 at tw=240. Not a refusal — ADOPT_BUDGET and FISC_ADOPT
// both ship at 0, so nothing ever declines a city — but because
// adoptAndFound's adoption branch reads `if (s.countryId < 0)` and a city
// born flying its own flag never enters it. The pass that owns this decision
// cannot reach the one moment that decides it.
//
// Under the lever the birth asks the question adoptAndFound asks: WHOSE GROUND
// IS THIS? Land held by a living court births its city into that court. The
// residual — unowned ground — is untouched, so a founding in the wild is still
// a founding, minted by the founding channel under its own records bar (and,
// under SEAT_FIELD, its own land test). Nothing here is a new rule: it is
// adoptAndFound's own rule, applied where adoptAndFound cannot see.
function bornPolityAt(world, s, legacy) {
  const co = world._countryOwner, elev = world.elev, tw = world.tw;
  if (!co || !elev || !tw) return legacy;                     // no political field yet (genesis) — the residual stands
  const ti = (s.pos.y | 0) * tw + (s.pos.x | 0);
  if (!(ti >= 0 && ti < co.length) || !(elev[ti] > 0)) return legacy;
  const owner = co[ti];
  if (owner < 0) return legacy;                               // NO ONE HOLDS THIS GROUND — sovereignty is the residual, and this is where it belongs
  // The paint can outlive the realm (measured 2-11% of self-foundings across
  // arms). A court is a countries-view entry with a capital — the same
  // liveness the adoption pass demands before it hands a settlement over.
  const c = world.countries && world.countries.get(owner);
  if (!c || !c.capital) return legacy;
  // Can the court AFFORD this subject? Both gates are inert at their shipped 0,
  // and when they are not, a refusal births the city STATELESS and leaves the
  // consequence to adoptAndFound — refusal semantics are that pass's business,
  // not this default's, so this lever moves exactly one thing.
  if (!fiscAdoptable(world, c, s.pos.x, s.pos.y, s.people || 0)) return -1;
  return owner;
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
    // Small starter store — a few ticks of household grain so the first
    // harvest can book before the pot reads empty. This is a famine buffer,
    // not a size gift: agglomeration aims at harvest supply, not the pile.
    food: opts.food ?? 80,
    knowledge: opts.knowledge || {
      // The NATURAL-VILLAGE seed: an internally consistent neolithic package.
      // agriculture 0.5 asserts ESTABLISHED cereal farming — and no farming
      // people ever lacked pottery (the granary craft), fire, mudbrick and
      // the hunt. The old construction 0.1 paired plough-adjacent agronomy
      // with a pre-pottery toolkit — a society ~2000 years out of joint with
      // itself — and that skew alone stretched the played Stone Age to
      // ~11.7k steps (39% of a 30k run, probe_erapace seed 8817: 9.8× its
      // display-span vs Bronze 1.2× / Medieval 1.3×), because the whole
      // pre-Bronze arc is the construction track crawling 0.10 → 0.36.
      // 0.18 = pottery just mastered (tech.js gate), masonry still far off:
      // the same LATE-NEOLITHIC moment the agriculture value describes.
      // Initial CONDITIONS of the world at t=0, not a gate on anything.
      agriculture: 0.50,        // frontier starts already farming (absorbs the old foraging track)
      construction: 0.18,       // the farming village's real toolkit: pottery, granaries, mudbrick
      organization: birthOrgAt(world, x, y, 0.1),   // kin-village society — statehood still to be EARNED (site-scaled: T.ORG_BIRTH_VAR)
      metallurgy:  0,           // gated by ore access
      navigation:  0,           // gated by water access
      mobility:    0,           // gated by horses
    },
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
  // T.STATE_RECORDS: the "else own city-state" default IS a statehood door —
  // every settlement used to be BORN flying its own flag, which is exactly
  // how full nations covered the Stone Age map (the flag, not the polity
  // record, is what the countries view and the political paint aggregate).
  // Below the unified founding bar (tech.js stateOrgBar) a settlement with no
  // realm to join is born STATELESS; explicit opts.countryId (daughters,
  // colonies, materialising nations — each gated at its own source) passes.
  // T.BORN_OF_LAND (bornPolityAt above): a birth with no explicit flag takes the
  // politics of the GROUND, and sovereignty is what is left when no court holds
  // it. Off, the legacy value stands untouched (byte-identical).
  s.countryId = opts.countryId ?? (() => {
    const legacy = !T.STATE_RECORDS || (((s.knowledge && s.knowledge.organization) || 0) >= stateOrgBar())
      ? s.id : -1;                                  // joins parent's realm if specified, else own city-state — once the court can administrate one
    return T.BORN_OF_LAND ? bornPolityAt(world, s, legacy) : legacy;
  })();
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
  // T.STATE_RECORDS: a cradle city is born a stateless temple town unless its
  // court can already administrate (tech.js RECORDS_ORG — the Writing gate);
  // below the bar it self-founds later through the frontier channel, so the
  // dawn shows villages and temple towns first, then the tablet, then the state.
  if (opts.cradle && (!T.STATE_RECORDS || (((s.knowledge && s.knowledge.organization) || 0) >= stateOrgBar()))) ensurePolity(world, s.id, { how: "cradle", seat: s });
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

export function computeWaterAccess(world, sx, sy) {   // exported: the land ledger derives a site's wa the same way a settlement does
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
export function oreTier(res) {   // exported: the land ledger (landKnow.js) caps village metallurgy by the same tiers
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
export { craftLegs };   // goods.js (Stage 1) builds craft capabilities from the same recipe — can't drift
export { METAL_W };     // goods.js (Stage 3 chain): skill-limited metal capability on the same weight
// ── Ricardian specialty reference (T.SPEC_RELATIVE, goods-vector Stage 0) ──
// True comparative advantage is RELATIVE TO THE COMPETITION, not to a sector's
// own ceiling: score = legs[k] / (world-typical output of k). The CRAFT_REF
// scoring ("closeness to the ceiling") let the easiest-to-saturate sector win
// everywhere — Crafted wares = construction ≈ 1 for every developed town, so
// 50-65% of towns locked into it and Metalwork/Services structurally never won
// (docs/settlement-economy-analysis-2026-07.md F1). Against the world mean, an
// ore town's metal leg towers over a world mostly without ore, a metropolis's
// services tower over a world of villages — the pick spreads with geography,
// with NO reference constants at all.
// The mean is LAG-1: settlements accumulate raw legs as they compute them, and
// the first computeExportValue of each tick swaps last tick's sums into the
// mean every settlement then reads — identical for all, order-independent,
// deterministic. No mean yet (first tick of a run, or right after load — the
// accumulator is a transient cache, never persisted) → the caller skips
// evolving the pick for that one tick.
const SPEC_REL_EPS = 0.02;   // output level below which a sector reads "globally absent" (guards ÷0; a locally-present, globally-absent craft then scores huge — the world's only forge town IS the metal specialist)
function craftMeanOf(world) {
  if (world._craftMeanStep !== world.step) {
    const acc = world._craftAcc, n = world._craftAccN || 0;
    let mean = null;
    if (acc && n > 0) { mean = {}; for (const k in acc) mean[k] = acc[k] / n; }
    world._craftMean = mean;
    world._craftMeanStep = world.step;
    world._craftAcc = null; world._craftAccN = 0;
  }
  return world._craftMean;
}
function accumulateCraftLegs(world, legs) {
  let acc = world._craftAcc;
  if (!acc) { acc = world._craftAcc = {}; world._craftAccN = 0; }
  for (const k in legs) acc[k] = (acc[k] || 0) + legs[k];
  world._craftAccN++;
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
export { applyClusterBoost };   // goods.js (GOODS_UNIFY): the goods caps carry the same increasing returns

// Cache a settlement's home-tile climate — latitude band (0 = equator,
// 1 = pole), temperature and moisture (worldgen's 0..1 scales). Terrain is
// static, so this is computed once and reused by the knowledge model
// (continental-axis diffusion + climate specialization).
function climateOf(world, s) {
  if (s._climLat !== undefined) return;
  rederiveSiteClimate(world, s);
}

// Static home-tile climate — recomputed on load (terrain is immutable).
export function rederiveSiteClimate(world, s) {
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
  if (!s._techEff) s._techEff = techEffects(practisedK(s.knowledge, s._metalCap), T.TECH_EFFECTS, s._techEnv || null);
  return s._techEff;
}
// T.TECH_USE — the site's ecological ENABLER record, the generalisation of
// practisedK's one-channel law ("knowing iron ≠ holding it") to whole techs:
//   draft — a working ox/horse team can LIVE here: the same livestock composite
//           the food model feeds herders by (livestockClimate × the regional
//           domesticate ceiling — the tsetse belt and the pre-contact New World
//           both fall out of fields the sim already owns; the Columbian
//           exchange arrives when the ceiling does). Bar 0.15: below it a
//           draft team cannot be maintained year-round.
//   water — navigable water at the site (the ship techs' ground truth).
//   river — a floodplain or real river to canal (irrigation's ground truth).
// Refreshed on the KNOW_INTERVAL cadence beside _techEff — the parts are
// terrain-static except the domesticate ceiling, which diffuses.
function techEnvOf(world, s) {
  const tw = world.tw;
  const ti = (s.pos.y | 0) * tw + (((s.pos.x | 0) % tw) + tw) % tw;
  climateOf(world, s);
  const ceilReg = world._agriCeil ? (world._agriCeil[ti] || 0) : 1;
  const herd = livestockClimate(s._climTemp, s._climMoist) * ceilReg;
  let st = s._techEnvSite;
  if (!st) st = s._techEnvSite = {
    water: computeWaterAccess(world, s.pos.x | 0, s.pos.y | 0).wa > 0.05,
    river: !!(world.tFlood && world.tFlood[ti]) || !!(world.riverMag && world.riverMag[ti] >= 1),
  };
  return { draft: herd > 0.15, water: st.water, river: st.river };
}
export { techEff, computeConfinement };

// ── The administrative-reach ramp (ONE definition, two consumers) ──────────
// Statecraft below LEVY_ORG_MIN cannot run a systematic assessment of the
// countryside at all (a chiefdom takes tribute, not a grain levy); above it
// the bureaucracy ramps to full reach. The food hierarchy's in-kind levy
// (foodHierarchy.js levyShare = LEVY_MAX × this) and the ledger's authority
// over rural carrying capacity (T.FOOD_REACH → FOOD_K's blend weight,
// popField.js) are the SAME administrative capacity, so they read the same
// ramp — a state that cannot collect the harvest cannot re-price the land
// that grows it. Emergent: gated on the settlement's own statecraft
// (techEff reachLevel), never a date.
export const LEVY_ORG_MIN = 0.35;   // the proto-state threshold (moved here from foodHierarchy.js — one definition)
export function foodReach(s) {
  const org = techEff(s).reachLevel || 0;
  return org > LEVY_ORG_MIN ? Math.min(1, (org - LEVY_ORG_MIN) / (1 - LEVY_ORG_MIN)) : 0;
}

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
    let target = base * (T.CREDIT_MAX_MULT - 1) * bankF;                  // specie-anchored credit ceiling (existing)
    // ②a FIAT (default off, docs/industrial-transition-2026-07.md): at industrial
    // financial maturity money becomes a claim on real OUTPUT, not just mined specie
    // — the fiat/central-bank transition. Without it credit ≤ specie×MULT, and the
    // INDUSTRIAL_CAP-scaled (×N) economy deflates to the price floor because specie
    // can't grow to monetise it (→ chronic insolvency → the fiscal-collapse cascade).
    // Back credit with the settlement's own real-output proxy (exportValue×√people —
    // the SAME measure the price level divides T by) at the EMERGENT baseline
    // monetisation ratio world._inflRef, so money tracks output and M/T stays off the
    // floor. Gated on organisation past the industrial threshold (emergent, never a
    // clock) and the banking INSTITUTION — but NOT trade reach: central-bank/fiat
    // money is a claim on the DOMESTIC economy, unlike the bills-of-exchange specie-
    // credit above which legitimately needs correspondents (reachF). The deep battery
    // showed reach-gated fiat firing on only ~2 of 140 industrial hubs, because the
    // very fragmentation fiat must survive severs trade reach → reachF→0 → fiat off
    // (chicken-and-egg). So fiat uses a reach-INDEPENDENT bank factor. Byte-identical
    // off / pre-industrial (fmat=0).
    const fiatBank = techEff(s).credit ? depth : 0;   // banking institution + org depth only, reach-independent
    let fiatBound = false;   // is the fiat (output-backed) target the binding one this tick?
    let fmatHub = 0;         // this hub's financial maturity (0 pre-industrial → 1 fully modern); gates the no-crunch rule below
    if (T.FIAT_OUTPUT > 0 && world._inflRef > 0 && fiatBank > 0) {
      const fmat = Math.min(1, Math.max(0, (org - 0.78) / 0.18));        // financial maturity: the industrial gate on the hub's own organisation
      fmatHub = fmat;
      if (fmat > 0) {
        const out = realOutputOf(s, world);   // the hub's real-output proxy (= the inflation model's T-contribution; OUTPUT_TOTAL switches trade-proxy → total output)
        const fiatTargetRaw = T.FIAT_OUTPUT * fmat * out * world._inflRef * fiatBank;   // × REF ⇒ coin units: money the output supports at the baseline monetisation ratio
        // FIAT_SMOOTH (default 0 ⇒ spot, unchanged): a central bank targets the TREND
        // money stock, not the last tick's. Smoothing the backing (slow EMA) keeps the
        // fiat target — and thus the money supply and the price — stable through a
        // TRANSIENT dip in output OR organisation (a fragmentation blip), instead of
        // the target dropping with the blip and the overhang unwinding to the floor.
        // dt-scaled for SIM_GRANULARITY. FIAT_SMOOTH=0 ⇒ s._fiatTgt == raw (no change).
        const a = T.FIAT_SMOOTH > 0 ? Math.min(1, T.FIAT_SMOOTH * (world._dt || 1)) : 1;
        s._fiatTgt = s._fiatTgt === undefined ? fiatTargetRaw : s._fiatTgt + (fiatTargetRaw - s._fiatTgt) * a;
        if (s._fiatTgt > target) { target = s._fiatTgt; fiatBound = true; }             // fiat SUPERSEDES the specie ceiling when the output-backed level is larger
      }
    }
    const gap = target - cur;
    // Managed/fiat money is NOT panic-recalled like bills of exchange: when the fiat
    // target binds, contraction runs at the normal rate (not ×CREDIT_CRUNCH), so a
    // TRANSIENT output dip can't ratchet the money supply — and the price — back to the
    // floor over each population oscillation. The deep battery showed the ×4 crunch
    // calling fiat in on a trade dip (coin 17M→4M in 10k steps, P 0.47→0.21); sticky
    // fiat is what keeps the price off the floor across the whole modern arc, not just
    // at onset. Specie-credit (bills of exchange) keeps the crunch — a run on a bank IS
    // faster than deposit growth; a central bank managing fiat is not.
    // A financially-MATURE fiat hub does not panic-recall: the ×CREDIT_CRUNCH bank-run
    // contraction is specie-credit (bills-of-exchange) behaviour — a run is faster than
    // deposit growth. Once a hub is fiat-mature (fmatHub>0) it MANAGES its currency, so
    // even when a transient output dip drops the fiat target below the specie line
    // (fiatBound flips false and the overhang would otherwise be crunched), contraction
    // runs at the NORMAL rate. Without this a −7% output blip flipped fiatBound false and
    // the crunch collapsed the money supply −77% in a pass — the measured procyclical
    // modern price break. Pre-fiat hubs (fmatHub=0) keep the crunch; byte-identical when
    // FIAT_OUTPUT=0 (fmatHub stays 0 ⇒ the original `gap<0 && !fiatBound` rule exactly).
    const rate = Math.min(1, T.CREDIT_RATE * (world._dt || 1) * (gap < 0 && !fiatBound && fmatHub <= 0 ? CREDIT_CRUNCH : 1));
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
  s._luxSupply = luxRes * T.LUX_SUPPLY_RATE * popF * sp * sp;
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
  let labourDemand = csDem + SLAVE_MINE_PULL * hasMine + ESTATE_PULL * est;   // coerced labour this site could USE
  // Free labour outcompetes (T.FREE_LABOUR): where THIS settlement has genuinely
  // industrialized — the same org×metallurgy band the industrial-mobility learning
  // gates on — wage labour and machine production outbid the coerced gang:
  // monitoring costs rise with the skill content of the work and capital displaces
  // raw muscle, so demand falls away and the stock bleeds out through the existing
  // attrition sink WITHOUT replacement (the market only fills up to target). This
  // is the emergent decline the 2026-07 war+slavery breakdown measured missing —
  // unfree share still RISING at 24k with nothing ever eroding it. Realm by realm,
  // early industrializers manumit first, agrarian estate belts hold on longest,
  // and a world that never industrializes keeps its slave economies forever —
  // never a date. 0 = no substitution (byte-identical).
  if (T.FREE_LABOUR > 0) {
    const kL = s.knowledge || {};
    const ind = Math.min(1, Math.max(0, ((kL.organization || 0) - 0.78) / 0.18))
              * Math.min(1, Math.max(0, ((kL.metallurgy || 0) - 0.78) / 0.18));
    if (ind > 0) labourDemand /= 1 + T.FREE_LABOUR * ind;
  }
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
export { sackPenalty };   // goods.js (GOODS_UNIFY): craft caps take the same sack crater the scalar output does
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
    const fish = T.FISH ? s.waterAccess * (k.navigation || 0) * 0.3 : 0;
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
    // T.SPEC_RELATIVE: score vs the lag-1 WORLD-TYPICAL output of each sector
    // (Ricardian — see craftMeanOf) instead of vs the CRAFT_REF ceiling. No
    // mean yet (first tick / just loaded) → hold the pick for one tick.
    let specRef = null, holdPick = false;
    if (T.SPEC_RELATIVE) {
      specRef = craftMeanOf(world);
      accumulateCraftLegs(world, legs);
      if (!specRef) holdPick = true;
    }
    let topK = null, topScore = -1;
    // GOODS_PRICES (Stage 1): weight each sector's score by the LOCAL PRICE of
    // the good it makes — full comparative advantage (supply-side edge × local
    // demand). A cold town's dear cloth pulls the loom, a war economy's dear
    // metal pulls the forge. Prices are clamped to [0.25, 4] in goods.js, so
    // this colours the pick rather than overriding geography.
    const gP = T.GOODS_PRICES ? s._gPrice : null;
    if (!holdPick) for (const key in legs) {
      let sc = specRef ? legs[key] / ((specRef[key] || 0) + SPEC_REL_EPS)
                       : legs[key] / (CRAFT_REF[key] || 1);
      if (gP && LEG_GOOD[key] !== undefined) sc *= gP[LEG_GOOD[key]];
      if (sc > topScore) { topScore = sc; topK = key; }
    }
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
  ag *= mult; agFood *= mult; agMat *= mult;
  // Stash the PRIMARY materials component (post-mult, PRE-ore) for the goods
  // layer — cap[G_MATERIALS] must never include the ore the goods vector
  // already carries as G_ORE. Stashing after the UNIFY branch's `agMat +=
  // oreU` made every mining settlement's extraction ship TWICE (once as ore,
  // once as phantom materials), double-booking income and depressing its
  // materials price — caught by the 2026-07 adversarial pre-merge review.
  s._agMat = agMat;
  let v;
  if (T.GOODS_UNIFY && s._gProd) {
    // ── LAYER UNIFICATION (T.GOODS_UNIFY) ────────────────────────────────
    // The manufactured/service sector IS the goods layer's production
    // (last tick's _gProd — a one-tick lag on a slow variable, which breaks
    // the ev↔cap cycle deterministically). Everything the goods economy
    // knows — labour dedication, invested capital, the ore chain's input
    // gate, cluster lock-in, the sack/army/tech multiplier, the village
    // craft fraction — is already inside prod (goods.js caps under this
    // same flag), so the ONE number the rest of the sim reads (trade
    // volume, inflation's T, development, war worth) finally describes the
    // economy that actually trades. craftLegs' own in-hand ore gate
    // retires here automatically: prod[metal] is chain-gated instead.
    // The primary sector stays this function's (its recipes were always
    // authoritative); goods.js reads the stashed post-mult agMat directly.
    const gp = s._gProd;
    const oreU = gp[G_ORE] || 0;   // raw extraction sells as materials
    const manU = (gp[G_METAL] || 0) + (gp[G_CLOTH] || 0) + (gp[G_WARES] || 0) + (gp[G_SERVICES] || 0);
    ag += oreU; agMat += oreU;
    v = ag + manU;
  } else {
    man *= mult;
    v = ag + man;
  }
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

// ── Real-output measure for the MONETARY economy (inflation T + fiat backing) ──
// The price level is P = (M/T)/REF and fiat money (FIAT_OUTPUT) is a claim on
// output; BOTH the denominator T (inflation.js) and the fiat backing
// (updateMining, above) read THIS one function, so numerator and denominator can
// never drift. Two regimes:
//   • DEFAULT (OUTPUT_TOTAL 0): the TRADED-output proxy exportValue×√people — the
//     volume that crosses markets (sub-linear in population, trade-tech-weighted).
//     Byte-identical to the original inline expressions both callers used.
//   • OUTPUT_TOTAL > 0: TOTAL (domestic) real output ≈ population × productivity,
//     people × _eraProd. _eraProd is the composite productivity index that already
//     scales carrying capacity (built land capital × the industrial break — ~1
//     forager → ~tens× fully industrial; the ERA_PROD_SCALE legacy arm ran to
//     ~260 — gated on the settlement's OWN development, never a clock). This is the whole economy, not
//     the traded slice, so as a modern realm turns inward (trade fraction shrinks,
//     trade links fragment) T does NOT collapse — the money supply can keep
//     monetising the real economy instead of pricing the ×N industrial output
//     against a shrinking traded fraction (which deflates the modern price toward
//     the floor). Magnitude is absorbed by the live REF calibration, so only the
//     SHAPE of the measure changes (linear in people, productivity-weighted,
//     trade-independent). Necessary but, alone, not sufficient for a stable modern
//     price — the fiat supply dynamics (②b/②c) co-determine it; see the measured
//     A/B in docs/industrial-transition-2026-07.md ②a residual 1.
export function realOutputOf(s, world) {
  const ppl = Math.max(1, s.people || 0);
  if (T.OUTPUT_TOTAL > 0) return ppl * (s._eraProd || 1);
  return exportValueOf(s, world) * Math.sqrt(ppl);
}

// Does this settlement FARM its own land (so its base output is food)? Under
// DISSOLVE_FARMS every town up to a metropolis works its own catchment;
// otherwise only tier-0 Farming Regions (≤ FARM_MAX_TIER) do. ONE predicate so
// the economy (computeExportValue) and its info-panel breakdown can't drift.
export function farmsLand(s) {
  return (s.tier | 0) <= (T.DISSOLVE_FARMS ? 3 : 0);
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
    const fish = T.FISH ? s.waterAccess * (k.navigation || 0) * 0.3 * mult : 0;
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
// A settlement's top REAL net-export good, from the goods layer's measured
// flows (_gNet: negative = exported). Replaces the old topBarterGood fiction
// (a raw-resource guess that printed "give copper / get −" regardless of what
// actually moved — retired 2026-07 once the goods trade made flows real).
function topNetExportOf(s) {
  const n = s._gNet;
  if (!n) return null;
  let best = null, bestV = -0.005;   // a real flow, not noise
  for (let g = 0; g < n.length; g++) if (n[g] < bestV) { bestV = n[g]; best = GOODS[g]; }
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
    // What each side genuinely SELLS into the network (its top measured
    // net-export good) — real flows, not the old resource-guess fiction.
    const give = topNetExportOf(s);
    const get  = topNetExportOf(peer);

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
    if ((s.tier | 0) <= (T.DISSOLVE_FARMS ? 1 : 0)) {   // DISSOLVE: only the small farming TOWNS keep farmers rural; cities shed freely
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
  // Per-section attribution for the pass profiler (the 20x-slowdown probe,
  // 2026-08-20): the settlements pass is 65% of a dense tick, so WHICH update
  // scales with the register decides the fix. Accumulates across settlements
  // and ticks into world.debug.sett; zero cost when _dbgProfile is off.
  const dp = world._dbgProfile ? (world.debug.sett || (world.debug.sett = {})) : null;
  let _t = dp ? performance.now() : 0;
  const m = dp ? (k) => { const n2 = performance.now(); dp[k] = (dp[k] || 0) + (n2 - _t); _t = n2; } : null;
  // ── T.SETT_STRIDE: the settlement economy on a stride (the 20x-slowdown
  // fix, 2026-08-20) ─────────────────────────────────────────────────────
  // The peer-seats register multiplied entities ~15x and the owner's app ran
  // ~20x slower; the pass profiler attributed 65% of a dense tick to THIS
  // loop, and its sections to knowledge (23ms), goods (22ms) and food (18ms)
  // per tick across 535 cities — rate processes recomputed every tick for
  // every city. The cure is the codebase's own stride convention, already
  // shipped twice: TRADE_STRIDE (the bilateral sweep every K ticks at Kx
  // volume) and updateKnowledge's internal KNOW_INTERVAL ("staggered by id
  // so the cost spreads evenly; rates scaled up to keep the average pace
  // identical"). Here the whole heavy per-settlement economy — food, wealth,
  // coerced labour, goods, development, knowledge — runs every K ticks per
  // settlement, phase-staggered by id, under dt x K so every per-tick rate
  // integrates to the same average. Population and tier stay per-tick (cheap,
  // and demography/registers stay smooth). Consumers see fields at most K-1
  // ticks stale — the _linkMoney convention, documented there. K=1 is
  // byte-identical; the harness pins 1 (gates keep their trajectories), the
  // app ships the default.
  const _K = Math.max(1, T.SETT_STRIDE | 0);
  const _due = _K === 1 || ((world.step + s.id) % _K) === 0;
  const _dt0 = world._dt;
  if (_due && _K > 1) world._dt = _dt0 * _K;
  if (_due) { updateFood(world, s); if (m) m("food"); }
  updatePopulation(world, s); if (m) m("population");
  if (s.mode !== "settled") { world._dt = _dt0; return; }   // died this tick (famine / wither)
  if (_due) {
    updateWealth(world, s); if (m) m("wealth");
    updateCoercedLabour(world, s);   // slaves, cash crops, mine intensification (reads fresh wealth)
    if (m) m("coercedLabour");
    updateGoods(world, s);           // goods-vector Stage 1: prod/demand/price + craft labour (after lux & cash crops so budgets are fresh; no-op unless T.GOODS_PRICES)
    if (m) m("goods");
    updateDevelopment(world, s); if (m) m("development");
    updateKnowledge(world, s); if (m) m("knowledge");
  }
  world._dt = _dt0;
  updateTier(world, s); if (m) m("tier");
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
// ── Stride-aware inner cadence (T.SETT_STRIDE) ──────────────────────────────
// The per-settlement economy fires every K ticks (phase (step+id)%K), so any
// inner "(step+id) % IVL === 0" gate only coincides every lcm(K, IVL). With
// the app's K=3 against KNOW_INTERVAL=8 that was every 24 ticks: dt-scaled
// RATE terms stayed neutral (dt rides ×K) but EVENT-like work — crop
// adoption and domestication — ran at a THIRD of the measured pace in the
// SHIPPING APP ONLY, because the gate harnesses pin K=1 and never see the
// composition (the resgate blind spot, in time instead of space; found from
// the owner's 22.6k-step Bronze-Age 94%-stateless screenshot, 2026-08-21).
// _strideIvl rounds an interval onto the stride's own grid (K=1 → IVL
// exactly, byte-identical); _strideIvlF is that window measured in FIRINGS —
// the factor rate terms must use in place of the raw interval, since dt
// inside the strided pass is already ×K.
const _strideIvl = (ivl) => { const K = Math.max(1, T.SETT_STRIDE | 0); return Math.max(1, Math.round(ivl / K)) * K; };
const _strideIvlF = (ivl) => _strideIvl(ivl) / Math.max(1, T.SETT_STRIDE | 0);
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
export function seasonalSelect(temp, moist) {   // exported: the land ledger reads the local selection target as its winter-aptitude proxy
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
// T.ORG_BIRTH_VAR — the organisation a community is BORN with depends on WHERE it is.
// Every settlement in the world is currently seeded at organization 0.1 EXACTLY (here and
// in crystallize.js's inherit baseline), and inheritance blends toward neighbours who are
// also at 0.1 — so the uniformity is self-reinforcing. Organisation then climbs to
// ORG_STATE_MIN (0.15) at a near-uniform rate, and the whole planet crosses the statehood
// bar as ONE COHORT (measured: 0 of 61 qualifying at step 4500, then 8 -> 44 -> 62). That
// is why the early map is a handful of lone dots and then fills in at once, and why
// T.ORG_PRESSURE — which spreads the RATE — cannot touch the first ~3000 steps: a rate
// cannot differentiate what starts identical.
//   The coordination a founding community carries reflects what its site DEMANDS and
// SUPPORTS: a rich site that cannot disperse (hemmed in by desert, mountain or sea) must
// manage water, store a surplus and settle disputes over scarce ground from the first
// generation — Wittfogel's hydraulic demand meeting Carneiro's circumscription. An open or
// barren site needs none of it. So scale the birth value by confinement × fertility, both
// already computed per site. 0 = off (every birth 0.1, byte-identical).
//   A FOUNDING VILLAGE IS NOT A STATE. The first form of this scaled the base:
// base × (1 + K·conf·fert), which at K=1 ranges 0.1–0.2 against an ORG_STATE_MIN
// of 0.15 — so any site with conf·fert > 0.5 was BORN ABOVE THE STATEHOOD BAR: a
// state at tick one, with no development, no learning and no time. Measured over
// the map (seed 8817): 622 of 9,616 land tiles, 6.5% of the planet. It did not
// disadvantage the cradles (Nile 0.170, Mesopotamia 0.151, Indus 0.161 — all above
// the bar); it handed the same instant statehood to hundreds of scattered
// confined-and-fertile pockets, so the cradles stopped being SPECIAL and states
// appeared everywhere at once instead of at four rivers
// (docs/early-game-size-loop-2026-07-31.md).
//   The variation is right; granting the ANSWER at birth is not. So the site now
// places the community across the PRE-STATE RANGE — from a loose kin band at
// `base` up to, at most, the brink of statehood — instead of scaling past it. The
// ceiling is ORG_STATE_MIN itself, which already MEANS "the top of the pre-state
// range", so this adds no new constant and rides any change to that bar. K stays
// the shape of the climb across that range (1 = linear in conf·fert); statehood
// must still be EARNED everywhere, by learning, exactly as it was before the
// lever existed. 0 = off (every birth `base`, byte-identical).
export function birthOrgAt(world, x, y, base) {
  const K = T.ORG_BIRTH_VAR || 0;
  if (!(K > 0)) return base;
  const xi = x | 0, yi = y | 0;
  if (xi < 0 || yi < 0 || yi >= world.th) return base;
  const ti = yi * world.tw + xi;
  const fert = world.fert ? (world.fert[ti] || 0) : 0;
  const conf = computeConfinement(world, xi, yi);
  const bar = T.ORG_STATE_MIN ?? 0.15;
  if (!(bar > base)) return base;                                  // no pre-state range to spread over
  const site = Math.max(0, Math.min(1, K * conf * fert));
  return base + (bar - base) * site;
}

function computeConfinement(world, x, y) {   // exported below for probes (the land-nation gate no longer reads it — measured mis-scoring ecological circumscription, see crystallize.js)
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
  if (!s._effRes || (world.step + s.id) % _strideIvl(KNOW_INTERVAL) === 0) s._effRes = effectiveLocalRes(world, s);
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
  // T.LAND_KNOW: the minds term reads the MEASURED core (the same
  // measurement-over-model switch the tier ladder made, for the same reason —
  // between derives _urbanPop holds the census-side ratio HEURISTIC, which on
  // a first-mover whale catchment handed the newborn court sqrt(578k) minds
  // and raced it through the eras; the measured core is the pile it actually
  // gathered). Null until the field first derives — fall through to the model.
  const sciSqrt = T.LAND_KNOW && s._coreMeasured != null ? Math.sqrt(s._coreMeasured)
    : (T.DISSOLVE_FARMS && s._urbanPop != null ? Math.sqrt(s._urbanPop) : popSqrt);
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

  // ── Induced innovation (T.INDUCED_INNOV): necessity mothers invention ──
  // A society whose own market prices a good DEAR leans its learning toward
  // the technique that makes it: dearth pushes agronomy (the rotation and
  // manuring literature followed hungry decades), dear metal pushes the
  // furnace men, dear building materials the mason's methods. Reads the
  // settlement's LOCAL goods prices (goods.js, only under T.GOODS_PRICES) —
  // a lived condition, never a date. One-sided by design: gluts never
  // punish learning (abundance doesn't make a society forget).
  let needAgri = 1, needMat = 1, needMetal = 1;
  if (T.INDUCED_INNOV > 0 && s._gPrice) {
    const gp = s._gPrice;
    needAgri  = 1 + T.INDUCED_INNOV * Math.max(0, gp[G_STAPLE] - 1);
    needMat   = 1 + T.INDUCED_INNOV * Math.max(0, gp[G_MATERIALS] - 1);
    needMetal = 1 + T.INDUCED_INNOV * Math.max(0, gp[G_METAL] - 1);
  }
  // Probe-only learning-rate decomposition (tools/probe_eraskew.mjs installs
  // world._kDbg; the sim never does — zero cost otherwise). sciMul here is the
  // final composite (compound/stagnation applied above); the need terms are
  // re-derivable from s._gPrice but stashed for one-stop reading.
  if (world._kDbg) { s._dbgSciMul = sciMul; s._dbgNeedAgri = needAgri; s._dbgNeedMetal = needMetal; }

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
    * buildMat * stoneBoost * metalBoost * needMat
    * (1 + k.agriculture * 0.6) * (1 + sciSqrt * 0.06));   // urban core builds — pace to a CITY of that size, not the whole province (mirrors organization/metallurgy/navigation/mobility above; closes the raw-pop leak into orgEraCap → the world clock)

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
  k.agriculture = clamp01(k.agriculture + T.LEARN_BASE * 1.2 * sciMul * agriClim * needAgri * (1 - k.agriculture)
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
  const orgEraCap = orgEraCapOf(metalCap, k.construction);   // ONE definition with the land ledger (tech.js)
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
  // T.ORG_PRESSURE — CARNEIRO, STATED PROPERLY: circumscription ALONE does not build
  // states, circumscription PLUS population pressure does. Where land is open the losers
  // of a quarrel walk away; where it is bounded AND full they must submit, and submission
  // is what an institution is. `confineMul` above already carries circumscription, but as
  // a bare rate multiplier capped at ~1.39 — and with no pressure term it rewards an EMPTY
  // hemmed-in island exactly as much as a packed valley.
  //   Why this matters here: every settlement starts at org=0.1000 and climbs to
  // ORG_STATE_MIN (0.15) at a near-uniform rate, so the whole planet crosses the statehood
  // bar within ~2000 steps of itself (measured: 0 of 61 qualifying at step 4500, then
  // 8 -> 44 -> 62). A uniform initial condition plus a uniform rate makes ANY threshold a
  // global switch, which is why the early map is a few lone dots and then fills in at
  // once. Spreading the RATE by local conditions is what turns that switch into a frontier:
  // a crowded circumscribed basin crosses generations before an open frontier, so the dawn
  // of states ROLLS (what DAWN does for population, which is not the gate).
  //   fill = the settlement's people against its own carrying capacity (s._k, one pass
  // stale — set in the capacity pass; 0 on the very first tick, guarded). 0 = off,
  // byte-identical.
  const _fillK = s._k > 0 ? Math.min(1.5, (s.people || 0) / s._k) : 0;
  const pressMul = T.ORG_PRESSURE > 0 ? 1 + T.ORG_PRESSURE * (s._confine || 0) * _fillK : 1;
  // T.ORG_CONTACT — STATES MAKE STATES (2026-08-11, the state-frontier wave;
  // docs/dawn-cradles-2026-08-07.md §9). Statehood was a local exam with a
  // planetary answer key: uniform birth org climbing at a near-uniform rate
  // crossed ORG_STATE_MIN as one cohort, so nations stood on every habitable
  // band within one early window and held there to the end (owner report;
  // measured: formations from 172km to 4,278km off the cradles inside ~7k
  // steps — ~3km/y against history's ~0.5-1km/y state frontier, and
  // contact-blind: the Baltic stated before the North China Plain —
  // probe_statefrontier). History's periphery waited MILLENNIA, then stated
  // under CONTACT PRESSURE from existing states (trade, threat, emulation —
  // Tilly's "states make states"; farmed Neolithic Europe stayed pre-state
  // ~4,000 years while circumscribed Egypt stated pristine). Statecraft
  // therefore compounds only under PRESSURE: the site's own (pressMul above
  // — Carneiro's circumscription×fill, the PRISTINE engine, so the cradles
  // and the Americas bootstrap exactly as before) or an existing state's
  // example in trade reach (s._stateContact — stamped one knowledge pass
  // stale by the reach loop below, the SECONDARY engine). A settlement
  // already governing (countryId ≥ 0) is its own pressure — running a court
  // teaches statecraft — so the lever shapes only the PRE-STATE climb: the
  // frontier. The normalized re-base ×(1+K·drive)/(1+K) leaves a fully
  // pressed village at today's exact pace and an unpressured open-frontier
  // one at 1/(1+K) of it. No new reference constants; both drives are live
  // local state; no clock, no place. 0 = the planetary cohort (byte-identical).
  // T.STATE_CAGE (2026-08-12, docs §10 — the owner's re-founding question:
  // "nations spawn where population gets big enough... was that really the
  // core force?"): CAGING joins the pre-state drives, as Carneiro's full
  // triad — circumscription × surplus (pressure is the K re-base itself).
  // cage (cageField.js): the share of country within flight distance, beyond
  // the own basin, that a defeated household could NOT flee to — people
  // hemmed by desert/mountain (or by other states' closed borders) cannot
  // walk away from a quarrel or a tax, so statecraft compounds; people on an
  // open plain disperse instead (measured on the REAL field: the _confine
  // proxy mis-scored exactly the desert-hemmed cradles — the Indus seat read
  // 0.01). × cropCeil, the settlement's own storable ceiling (suit ×
  // storability, the CITY_STORE axis): a cage with no taxable grain inside
  // it raises no state (the taiga, the tuber belts — however hemmed, nothing
  // to seize). The Nile/Sumer strip reads high × high and arms PRISTINE at
  // full pace; the rain-fed European interior reads cage ≈ 0 and waits for
  // contact — history's four-millennium gap, from one field. No new
  // constants: two existing radii, two existing measures, the same re-base.
  let contactMul = 1;
  if (T.ORG_CONTACT > 0 && s.countryId < 0) {
    const cageDrv = T.STATE_CAGE
      ? cageAt(world, (s.pos.y | 0) * world.tw + (s.pos.x | 0)) * cropCeil(world, s)
        * cageFillAt(world, (s.pos.y | 0) * world.tw + (s.pos.x | 0)) : 0;   // T.CAGE_FILL: ×basin fill (×1 at lever 0)
    const drive = Math.min(1, Math.max(pressMul - 1, Math.max(s._stateContact || 0, cageDrv)));
    contactMul = (1 + T.ORG_CONTACT * drive) / (1 + T.ORG_CONTACT);
  }
  if (typeof process !== "undefined" && process.env && process.env.SIM_DBG_PRESS && (world._pDbg = (world._pDbg || 0) + 1) <= 5) {
    console.error(`  [press] confine=${(s._confine||0).toFixed(3)} people=${Math.round(s.people||0)} _k=${(s._k||0).toFixed(1)} fill=${_fillK.toFixed(3)} pressMul=${pressMul.toFixed(3)} confineMul=${confineMul.toFixed(3)} contactMul=${contactMul.toFixed(3)} org=${k.organization.toFixed(4)}`);
  }
  k.organization = clamp01(k.organization + T.LEARN_BASE * sciMul * orgClim * orgHead
    * ((1 + sciSqrt * 0.10) + litBranch) * aptLearn * confineMul * rulerLearn * pressMul * contactMul);

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
      T.LEARN_BASE * 2.6 * sciMul * headroom * (0.5 + 0.5 * oreRate) * fuel * needMetal
      * (1 + k.construction * 0.4 + sciSqrt * 0.04));
  }

  // Navigation — gated by water, paced like metallurgy: even a river port or a
  // modest coast grows real seamanship (helped by population — more shipwrights),
  // so coasts and great rivers become naval powers in step with the rest of the
  // tree instead of lagging centuries behind.
  // T.SEA_PRACTICE: fold this tick's booked carrying trade (roads.js) into the
  // sea-share EMA — the port's living memory of how much of its trade rides
  // the sea (~20-fold memory, a fleet/skill generation). Unconditional of wa
  // so the ledger never accumulates unfolded on any settlement.
  if (T.SEA_PRACTICE > 0) {
    const tv = s._tvAll || 0;
    if (tv > 0) {
      const prev = s._seaShare ?? (s._tvSea || 0) / tv;   // first fold seeds at the observed share
      s._seaShare = prev + 0.05 * ((s._tvSea || 0) / tv - prev);
      s._tvAll = 0; s._tvSea = 0;
    }
  }
  if (wa > 0) {
    // T.SEA_DEMAND (cause III, docs/atlas-gap-2026-08-14.md): navigation was
    // the ONLY practice with no demand term (metallurgy has needMetal,
    // mobility saddleLife) — however profitable the sea, practice never
    // accelerated, and the 50k world sat one point under the galleys gate
    // forever. The sea's induced innovation, in the needMetal pattern and on
    // the same lever: DEAR GOODS AT A WATERSIDE TOWN INDUCE SEAMANSHIP —
    // ships are how a port fetches what its market prices dear. One-sided
    // (gluts never punish), a lived condition, no clock, no new constant.
    let needSea = 1;
    if (T.SEA_DEMAND && T.INDUCED_INNOV > 0 && s._gPrice) {
      const gp = s._gPrice;
      const dear = Math.max(gp[G_STAPLE] || 0, gp[G_MATERIALS] || 0, gp[G_METAL] || 0);
      needSea = 1 + T.INDUCED_INNOV * Math.max(0, dear - 1);
    }
    // T.SEA_PRACTICE: the FLEET term — metallurgy's fuel analog (charcoal
    // fires the forge; a working merchant fleet drills the pilots). The
    // seaneed attribution (2026-08-17) exonerated demand — ports price dear
    // (needSea 1.5-1.75) yet nav crawled at HALF metallurgy's pace, because a
    // pure coastal port's wa is 0.5 by construction (practice factor capped
    // 0.75) and navigation alone had no availability multiplier. A town whose
    // carrying trade is fully sea-borne learns at up to x(1+lever); an
    // inland-facing beach town at x1. Venice and Athens, not every beach.
    const fleet = 1 + T.SEA_PRACTICE * Math.min(1, s._seaShare || 0);
    if (world._kDbg) { s._dbgNeedSea = needSea; s._dbgFleet = fleet; }
    k.navigation = clamp01(k.navigation + T.LEARN_BASE * 1.9 * sciMul * (1 - k.navigation)
      * (0.5 + 0.5 * wa) * needSea * fleet * (1 + k.construction * 0.6 + sciSqrt * 0.04));
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
  if (world._byId && (world.step + s.id) % _strideIvl(KNOW_INTERVAL) === 0) {
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
    // costs a fraction of it (weight ≈ 1). Link costs are cumulative PER-TILE
    // path costs (transport.js/sea.js), so the same real route reads ×rNormPop
    // on a finer grid — the scale rides along, or technique diffuses at half
    // the real reach at tw=480 (measured: org 0.84× at matched step — the
    // development-clock res-variance, docs/audit-2026-07.md OPEN #5b). ×1
    // exactly at the 240-tile reference.
    const DIFFUSE_COST_K = 30 * rNormPop(world);
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
    // T.ORG_CONTACT: a state's example in trade reach is the SECONDARY-state
    // pressure (the org-growth law above reads this one knowledge pass stale).
    // The rivals set already collects every reach partner flying a foreign
    // state's flag — for a stateless settlement that is exactly "an existing
    // state presses on you". Not persisted: rewarms in one KNOW_INTERVAL
    // after load, the same class as war fronts.
    s._stateContact = rivals.size ? 1 : 0;
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
      const rate = T.DIFFUSE_RATE * _strideIvlF(KNOW_INTERVAL) * litMul * (world._dt || 1);   // granularity-scaled; window in FIRINGS — dt already rides the stride
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
  if (T.CROP_AXIS > 0 && (world.step + s.id) % _strideIvl(KNOW_INTERVAL) === 0) {
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
  if ((world.step + s.id) % _strideIvl(KNOW_INTERVAL) === 0) {
    s._techEnv = T.TECH_USE > 0 ? techEnvOf(world, s) : null;
    s._techEff = techEffects(practisedK(k, metalCap), T.TECH_EFFECTS, s._techEnv);
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

// ── Coastal fish stocks: the sea remembers (T.FISH_LABOR) ──────────────────
// A depletable-renewable stock per stretch of coast, keyed on COASTAL LAND
// tiles (world.coast — the fishery off this stretch of shore), stored as the
// TAKEN fraction of virgin capacity in world._fishTaken (lazily allocated, the
// _soilFatigue pattern; 0 = virgin). Capacity is DERIVED, never stored:
// C_i = C_full × rich_i with C_full = 4·FISH_MSY/FISH_REGEN (logistic identity
// MSY = rC/4) and rich_i the marine-productivity shape below. Settlement
// drawdown happens in updateFood (deterministic settlement order); logistic
// regrowth runs here on an amortized sweep.

// Marine richness of the fishery off a coastal land tile: the same cold-
// temperate plateau the legacy per-settlement seaRich used (great fisheries
// are cold-and-ice-free; warm tropical seas are clear and barren; T.COLD_FISH
// cuts the ice-locked shore) — evaluated from the TILE's own temperature so
// per-tile capacity follows the real coast, not the port's home tile.
function fishRichAt(world, ti) {
  const t = world.temp[ti] ?? 0.7;
  const iceCut  = Math.max(0, Math.min(1, (0.60 - t) / 0.10));   // sub-freezing → ice-locked, short season
  const tropCut = Math.max(0, Math.min(1, (t - 0.80) / 0.15));   // warm tropical sea → nutrient-poor
  return (1 - T.COLD_FISH * iceCut) * (1 - 0.7 * tropCut);
}

// The stretch of coast a settlement's boats work: coast-flagged land tiles
// within the computeWaterAccess neighbourhood — the SAME box that defines
// waterAccess, so a port fishes exactly the shore it reads its sea access
// from. Static geography, cached at first read (founding/load — rebuildable,
// never saved). Two ports within the box radius share tiles: the commons is
// real.
function shoreTilesOf(world, s) {
  if (s._shoreTiles) return s._shoreTiles;
  const { tw, th, coast } = world;
  const R = T.RES_INV_RIVER ? Math.max(1, Math.round(rNormPop(world))) : 1;
  const sx = s.pos.x | 0, sy = s.pos.y | 0;
  const out = [];
  for (let dy = -R; dy <= R; dy++) {
    const ny = sy + dy; if (ny < 0 || ny >= th) continue;
    for (let dx = -R; dx <= R; dx++) {
      const nx = ((sx + dx) % tw + tw) % tw;
      const ni = ny * tw + nx;
      if (coast[ni]) out.push(ni);
    }
  }
  return (s._shoreTiles = out);
}

// Regen sweep cadence in TICKS (not SIM_GRANULARITY-stretched: the drawdown in
// updateFood is a per-tick food flow like the rest of the granary ledger, so
// regrowth must share the same clock). A performance cadence, not a content
// gate — the exact logistic step below is interval-invariant.
export const FISH_REGEN_INTERVAL = 50;
export function updateFishStocks(world) {
  if (!(T.FISH_LABOR > 0)) return;
  const ft = world._fishTaken;
  if (!ft) return;                     // nobody has fished yet — every stock virgin
  let list = world._coastList;
  if (!list) {
    const idx = [];
    const coast = world.coast;
    for (let i = 0; i < world.N; i++) if (coast[i]) idx.push(i);
    list = world._coastList = Int32Array.from(idx);   // static geography, built once
  }
  // Exact logistic step in capacity-relative form (unconditionally stable at
  // any interval): with s = S/C, s' = s·e^{rΔt} / (1 + s·(e^{rΔt} − 1)).
  // rich_i cancels — regrowth is capacity-relative — so one exp serves the
  // whole sweep. The 0.999 drawdown clamp guarantees a remnant to regrow from.
  const e = Math.exp(T.FISH_REGEN * FISH_REGEN_INTERVAL);
  for (let k = 0; k < list.length; k++) {
    const ti = list[k];
    const tk = ft[ti];
    if (tk <= 0) continue;             // virgin: s' = s exactly
    const sf = 1 - tk;
    const s2 = sf * e / (1 + sf * (e - 1));
    const v = 1 - s2;
    ft[ti] = v < 1e-9 ? 0 : v;         // snap the healed shore back to virgin
  }
}

function updateFood(world, s) {
  climateOf(world, s);   // before granary spoil / climate-gated food reads
  // Land food from the controlled TERRITORY: the distance-weighted sum of
  // claimed arable fertility (computed in territory.js), times yield and
  // agriculture. Storable — fills granaries and ships to feed cities. A big
  // city does NOT magically farm more; it grows by IMPORTING grain shipped
  // from its rural hinterland (see updatePopulation / the food trade), exactly
  // as real metropolises did (Rome's Egyptian grain, London's American wheat).
  // EVERY settlement's territory is farmed regardless of tier (MODEL B, below) — a city's
  // own hinterland feeds it first, and it BUYS the shortfall up the hierarchy. (Fish below
  // is local and perishable — a coastal city still fishes.)
  // Soldiers are MEN OFF THE LAND, but a standing PROFESSIONAL core (up to ARMY_LABOR_FREE of
  // the population) is carried by the settled economy without hurting the harvest — it's the
  // wartime CONSCRIPT surge BEYOND it that empties the fields. A heavy mobilisation thus farms
  // less just as the host needs feeding MORE → the granary drains → famine forces demobilisation.
  // This is the cycle that ends total wars (armies.js); peace carries no production drag.
  const armyFrac = (s.army || 0) / Math.max(1, s.people);
  // FISHER LABOR withdrawal (T.FISH_LABOR): the boats are manned by the same labor
  // pool that works the fields — LAST tick's fisher share (s._fisherFrac, set in the
  // fish block below; the same 1-tick lag _foodNet uses, so there is no circularity:
  // land food is computed before the fish block). Fishers withdraw from the harvest
  // 1:1, bounded by FISHER_MAX ≤ 0.25. This is what makes fishing COST something —
  // conscription/famine no longer raise fish for free. ×1 exactly while the lever is
  // off or the settlement has never fished (undefined → 0).
  const armyLabor = Math.max(0.2, 1 - Math.max(0, armyFrac - ARMY_LABOR_FREE) * T.ARMY_LABOR_FOOD) * (1 - (s._fisherFrac || 0));
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
  const _fertA = 1;
  // T.URBAN_LABOR — A CITY-DWELLER IS NOT IN THE FIELDS. Owner, 2026-08-27: "when a
  // farmer goes to a city, they stop making food, so we always really need more
  // farmers than city people, by a pretty exact margin."
  // THE OMISSION, verified across the whole of updateFood: this harvest already charges
  // labour for SOLDIERS ("Soldiers are MEN OFF THE LAND", armyFrac above) and for
  // FISHERS (fisherFrac, added expressly so "conscription/famine no longer raise fish
  // for free"), and it charges a per-TILE subsistence for the farmhands a worked tile
  // needs (FARM_FERT_FLOOR). It charges NOTHING for urbanisation. _urbanPop enters this
  // function on the DEMAND side only — as mouths and as _coreNeed. City people eat, and
  // they also still farm. Someone took the trouble to make fishing cost labour and
  // never made a city cost any.
  // WHY THAT IS THE WHOLE CEILING PROBLEM. History's agrarian urban ceiling is not a
  // policy, it is arithmetic: a pre-modern farmer fed himself plus a fraction, so the
  // urban share could not pass roughly that fraction. Here it can pass anything,
  // because the fields keep yielding after the hands leave them — which is why the
  // world runs to 28% urban with the countryside losing 37% of its mass, and why the
  // only thing opposing it had to be an arbitrary disease cap (min(1, urbShare/0.3),
  // settlement.js) standing in for a constraint that belongs HERE.
  // THE FORM HAS NO CONSTANT, because there is nothing to choose: output scales with
  // the share of the catchment that is actually rural. Applied to netFert rather than
  // to landFood so the per-tile labour floor scales WITH the worked area and is not
  // double-charged — (fertSum − tiles·floor)·rural expands to both terms scaling, which
  // is exactly "fewer hands work fewer tiles".
  // Reads _coreMeasured, NOT _urbanPop: the comment at popField.js's core read records
  // that the census-side ruralShare HEURISTIC overwrites _urbanPop every tick between
  // derives, so a reader inside the settlement pass sees the ratio model rather than the
  // measurement. Null before the first derive ⇒ treated as fully rural, which is both
  // the safe direction and the true one: a settlement with no measured core is a farm
  // village. Same one-tick lag the fisher term uses, for the same no-circularity reason.
  const _uCore = s._coreMeasured != null ? s._coreMeasured : 0;
  const _ruralLabor = T.URBAN_LABOR ? Math.max(0, 1 - Math.min(1, _uCore / Math.max(1, s.people))) : 1;
  const netFert = Math.max(0, (s._terrFertSum || 0) - (s._terrFarmedWt ?? s._terrWorkTiles ?? s._terrTiles ?? 0) * T.FARM_FERT_FLOOR) * _fertA * _ruralLabor;
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
  // _eraProd — the settlement's COMPOSITE PRODUCTIVITY INDEX (scales land food,
  // housing, the rural ceiling, cash-crop output, real output). Tier-B food wave:
  // the index is now the product of the two REAL capacity mechanisms the sim
  // already carries — BUILT LAND CAPITAL (popField LAND_WORKS: the canals,
  // terraces and drainage a pressed basin's own people accumulate, read back as
  // the harvest-weighted mean over the FARMED catchment) and the INDUSTRIAL
  // AGRONOMY BREAK (s._indCap — mechanisation + synthetic nitrogen, the same
  // multiple the capField proxy applies). The retired overlay it replaces
  // (BASE + SCALE·agri^POW·devGate, the ERA_PROD_SCALE legacy arm below) was a
  // fitted curve: 260 and the exponent 6 existed only to land the modern boom at
  // a target scale while staying invisible pre-modern, and its devGate keyed FOOD
  // productivity on political organisation — but a state does not make wheat
  // grow; technique (farmYield), tools and built land capital do, and all of them
  // exist elsewhere in the code. Measured consequence of the overlay: land food
  // DECLINED 28→21 over steps 1500-9000 while population quadrupled, and the mid
  // run went 62-75% fish-fed because nothing matured land food in that window.
  {
    // Country development reads (kept for the industrial gate + the legacy arm):
    // a settlement's industrial break needs its COUNTRY to have industrialised
    // (its capital's organisation AND metallurgy past ~0.78 — the same gate as
    // AGRI_INDUSTRIAL); a stateless settlement keeps indCap 1 (subsistence).
    let devOrg = 0, capMetal = 0;
    if (s.countryId >= 0 && world.countries) {
      const c = world.countries.get(s.countryId);
      if (c && c.capital && c.capital.knowledge) { devOrg = c.capital.knowledge.organization; capMetal = c.capital.knowledge.metallurgy || 0; }
    }
    // Industrial carrying-capacity break (T.INDUSTRIAL_CAP → popField.capField and,
    // since the Tier-B food wave, the LEDGER's industrial break too). Emergent
    // (reached industrial development, never a clock); byte-identical at
    // INDUSTRIAL_CAP=0.
    s._indGate = Math.min(1, Math.max(0, (devOrg - 0.78) / 0.18)) * Math.min(1, Math.max(0, (capMetal - 0.78) / 0.18));   // reached-industrial-development gate (0..1), reused by the urban transition
    s._indCap = 1 + T.INDUSTRIAL_CAP * s._indGate;
    // Built land capital: the works the basin's own people accumulated under
    // pressure (popField LAND_WORKS — canals, terraces, drainage). Catchment
    // mean over FARMED tiles, same falloff weighting as the harvest itself
    // (territory.js _terrWorksMean). ONE constant (T.LAND_WORKS) prices it on
    // ledger and field alike — and the ledger and the field finally agree on
    // what the industrial break is worth (both ride works × indCap now; the
    // overlay said 260× where the field said 26×·wk).
    const worksMul = 1 + T.LAND_WORKS * (s._terrWorksMean || 0);
    // ── T.MIXED_FARM — the manure-and-traction channel ────────────────────────────
    // Retiring the fitted `260·agri^6` overlay (de97888) was right: that constant had
    // no independent meaning, it existed to land the modern boom at a target scale, and
    // its devGate keyed FOOD on political organisation — a state grows no wheat. But it
    // was standing in for a REAL channel, and deleting the fake left the hole: the
    // several-fold rise in PRE-INDUSTRIAL yields from technique. What replaced it prices
    // built works (canals, terraces) and the industrial break, and nothing between.
    //   The largest of those missing levers is MIXED FARMING. An animal's chief
    // contribution to arable was never dairy or meat — it was nitrogen returned to the
    // field as manure, and the draught power to pull a plough through heavier soil and
    // work more land per family. Fields that carried animals out-yielded animal-less
    // cultivation by roughly a factor of two, and the two-way dependence (fodder for the
    // beasts, dung for the grain) is the mixed-farming system itself.
    //   `s._livestock` — climate suitability × the regional husbandry ceiling — is
    // already computed here, but only feeds SECONDARY products (LIVESTOCK: dairy/meat).
    // It has never touched crop yield. Technique gates how much of it reaches the field:
    // a people with beasts but no plough and no rotation gets the dung and not the
    // traction. One pass stale (set below in the same function), 0 on the first tick.
    // Byte-identical at 0.
    const _agriK = (s.knowledge && s.knowledge.agriculture) || 0;
    const mixedFarm = T.MIXED_FARM > 0 ? 1 + T.MIXED_FARM * (s._livestock || 0) * _agriK : 1;
    if (typeof process !== "undefined" && process.env && process.env.SIM_DBG_MIXED && (world._mDbg = (world._mDbg || 0) + 1) <= 5) console.error(`  [mixed] live=${(s._livestock||0).toFixed(3)} agri=${_agriK.toFixed(3)} mixedFarm=${mixedFarm.toFixed(3)} works=${worksMul.toFixed(3)} indCap=${s._indCap.toFixed(3)}`);
    s._eraProd = worksMul * mixedFarm * s._indCap;   // composite productivity index (housing/rural/cash/output consumers keep one number)
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
  // (LAND_TOOL_GATE removed in the 2026-07 default-flip campaign: its own desc
  // recorded the verdict — measured at every strength 0.35–0.7 it cost more
  // than it bought. The tool-unlock idea may return via CROP_AXIS packages.)
  const workable = 1;
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
  // ×(s._eraProd || 1): the composite productivity index — built land capital
  // (worksMul, the basin's own accumulated irrigation/terrace/drainage capital)
  // × the industrial agronomy break (s._indCap). Under the ERA_PROD_SCALE legacy
  // arm it is the retired fitted overlay instead.
  const landFood0 = netFert * T.FARM_YIELD_PER_FERT * fy * agg * armyLabor * (s._eraProd || 1) * livestockBonus * diseaseBurden * aridBurden * soilBurden * workable * irrigation * alluvium * (1 - cashLand);
  // The year's harvest. Under T.HARVEST_YEARS (harvest.js) EVERY year carries a
  // real regional index — lean years thin the granary, fat years fill it, and
  // "famine" is the derived tail of the same physics (the scripted window
  // below retires). Legacy arm: the shocks.js famine window slashes the yield.
  const landFarm = T.HARVEST_YEARS
    ? landFood0 * (s._harvestYearMul ?? 1)
    : (world.step < (s._famineUntil || 0) ? landFood0 * (s._harvestMul || 1) : landFood0);
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
  const pastEra = 1;
  let pastoral = T.LIVESTOCK_FOOD > 0
    ? T.LIVESTOCK_FOOD * (s._livestock || 0) * grazeTiles * pastEra * armyLabor * (0.3 + 0.7 * agriK)
    : 0;
  // T.LAND_SURPLUS: herds face the same countryside-eats-first gate as grain —
  // mean tradeable fraction from the catchment tally. Without this, zeroed farm
  // surplus left only gross pastoral and every city read as herd-fed.
  if (T.MARKET_PULL > 0 && T.LAND_SURPLUS > 0 && s._terrMeanSurplus != null) {
    pastoral *= Math.max(0, Math.min(1, s._terrMeanSurplus));
  }
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

  // ── Food demand ── (computed BEFORE the fish block: the fish gate reads the
  // share of this demand the RETAINED land food leaves unfilled. Nothing here
  // depends on fish.)
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
  // T.ONE_BOOK — ONE food book: the market ledger bills the MARKET-FED
  // (docs/egypt-autopsy-2026-08-24.md, the funnel verdict). Under ONE_POP the
  // catchment census is mostly SUBSISTENCE countryside that feeds itself off
  // the field (capField — the demographic book); billing the ledger for all of
  // it read the whole planet at 1/6-1/8 production:demand forever, which ran
  // every downstream pathology: pseudo-famine at anchors (fed≈0.1), granaries
  // pinned empty (siege clocks, famine buffers, TRIBUTE_OF_LAND all dead),
  // scarcity prices at the max clamp planet-wide (no signal), vulnerability
  // draws onto the "fragile" cradles, ZERO storable surplus → importShare
  // 0.00 → the agglomeration engine fuel-less → clone cities at 1× the bar →
  // the churn. T.FOOD_REACH already moved the famine GATE to the core need
  // ("the census counts subsistence people the market neither feeds nor
  // taxes") and expressly deferred the rest; this is that re-key: the civic
  // mouths become the MARKET-FED people — the urban core (the countryside's
  // own subsistence never touched the granary anyway) — so demand, the
  // granary drain, the scarcity price, the fish gate, army sizing and the
  // trade surplus all read one coherent book. Supply-side quantities (foodK,
  // s._k, the FOOD_K countryside blend) are untouched by construction —
  // imports raise them through dynamics, and FOOD_K's landShare already
  // keeps import-fed capacity at the core. Guarded to the shipped regime
  // (ONE_POP + DISSOLVE_FARMS): in the legacy census-logistic world the
  // whole census genuinely eats from this ledger and the old billing stands.
  const oneBook = T.ONE_BOOK > 0 && T.ONE_POP > 0 && T.DISSOLVE_FARMS > 0;
  const mouths = oneBook ? Math.min(s.people, s._urbanPop != null ? s._urbanPop : s.people) : s.people;
  // Under SLAVE_PEOPLE the unfree are inside the headcount but are fed at the owner's
  // subsistence ration (the slaveFood line below), not the civic rate — split them out
  // so they aren't fed twice.
  const unfreeIn = (T.SLAVERY && T.SLAVE_PEOPLE) ? Math.min(s._unfree || 0, mouths) : 0;
  const civDemand = (mouths - unfreeIn) * 0.0030 * urbanFactor;
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
  // T.FOOD_REACH consequence-side completion (2026-08-11, docs §6): the CORE's
  // own need — what the pot must actually cover for the people who depend on
  // it (urban core at the civic rate, the garrison, the unfree). The ledger's
  // headline demand deliberately keeps billing the WHOLE census (the
  // FED_FAMINE precedent: re-keying the granary drain re-keys granary/trade
  // balances world-wide), but under FOOD_REACH the census counts subsistence
  // people the market neither feeds nor taxes — so the empty-pot famine gate
  // below compares the supply FLOW against THIS, not against the notional
  // whole-catchment drain. Stashed, not returned: the famine block runs later.
  s._coreNeed = Math.min(s.people, s._urbanPop || 0) * 0.0030 * urbanFactor + armyFood + slaveFood;
  // Sustained FED-NESS (s._fedM) is stamped AFTER supply + store draw below —
  // a city eating from its granary is fed, and STARVE_SHED must not melt a
  // stocked core on a flow-only read (measured 2026-08-29: food at hundreds
  // of units with fedM ≈ 0.3 and capacity thrash).

  // T.SIEGE_STARVE — a BESIEGED seat eats its granary (the variance arc's
  // storm-gate fix, docs/variance-arc-2026-08-13.md): while an enemy front
  // stands at the walls (armies.js stamps _besiegedAt each war pass it
  // holds), the fields and the roads are the besieger's — the supply FLOW is
  // cut and the core lives on stores, drained at the walls' own demand. When
  // the granary empties, the famine ratio the storm's break test reads goes
  // to zero and the militia withers — history's siege clock, run by the
  // city's own stores (a stocked metropolis holds for years, an empty town
  // for weeks; a relieved city re-supplies the moment the front breaks).
  // Scoped hard to the besieged seat while the stamp is fresh — the
  // FED_FAMINE/FOOD_REACH scars demand the consequence never re-keys the
  // drain of anyone else. Freshness = the war pass cadence (an existing
  // clock: the stamp renews while the front holds).
  if (T.SIEGE_STARVE && s._besiegedAt !== undefined
      && world.step - s._besiegedAt < (T.POLITY_INTERVAL || 150) * 1.5) {
    s._besiegedNow = true;   // the supply assignment below zeroes the flow
    s.food = Math.max(0, (s.food || 0) - (s._coreNeed || 0));
  } else if (s._besiegedNow) s._besiegedNow = false;

  // Carrying food this tick. `_foodNet` is last tick's hierarchy book
  // (own harvest + imports − what shipped up). A real retained amount
  // (including a provincial city that kept 20%) must be used as-is — that is
  // the SHIP_FRAC law, villages stay small because they send grain away.
  // `_foodNet === 0` is NOT a real book: it is the default after a tick with
  // no harvest yet (founding, territory just assigned the first tiles, a
  // skipped node). The old `!== undefined` test treated that 0 as "kept
  // nothing" and stamped `_foodSupply = 0`. foodK followed it to 0, and under
  // STAMP_RETIRE the size read is min(disk, foodK) — the city became a
  // village in one derive, then agglomeration dumped the core at 20%/tick.
  // Fall back to this tick's landFood only when the retained book is empty;
  // imports (net > land) still raise supply.
  const netLand = (s._foodNet > 1e-9) ? s._foodNet : landFood;

  // FISH — a LOCAL marine supplement, never a staple. History is emphatic: the great agrarian
  // empires (Egypt, Mesopotamia, China, Rome) ran on GRAIN; fish was caloric noise to them. But fish
  // WAS the foundation of a distinct class of societies — the cold-temperate fishing coasts where the
  // sea teemed and the land farmed poorly: Norway's cod, the North-Sea/Baltic herring, the Pacific-
  // Northwest salmon peoples (complex, sedentary, monument-building, NO agriculture), the Humboldt-
  // anchovy coast that may have underwritten Caral, the oldest American civilisation. So fish here
  // emerges exactly where it mattered and nowhere else: it scales UP where the SEA is rich and the
  // LAND is poor, and falls to ~0 in the fertile river cradles and the nutrient-poor tropics.
  // T.FISH master gate (owner directive 2026-08-14: "remove fish as a food
  // source entirely"). 0 = no sea access for the food law: both fishery arms
  // (Tier-B labor fishery and the legacy flat cap) read sea=0, the boats
  // stand down through the existing reallocation decay, and coastal food is
  // land food alone. Old saves keep their fed coasts (v19 guard pins 1).
  const sea = T.FISH ? Math.max(0, (s.waterAccess || 0) - (s._riverAcc || 0)) : 0;   // SEA (coast) access — rivers are GRAIN-fed (alluvium), not fished
  let fish = 0;
  if (T.FISH_LABOR > 0) {
    // ── Tier-B fish: the catch costs LABOR and draws down a STOCK ────────────
    // Schaefer/Graham surplus production: catch = q·E·S — catch-per-unit-effort
    // proportional to abundance, effort = the fishers this community actually
    // mans the boats with, stock a logistic population per stretch of coast
    // (world._fishTaken — the depositReserve/soilFatigue pattern: the sea
    // remembers). What this replaces: a flat per-settlement cap
    // (FISH_RATE × sea × seaRich × poor) with no labor, no boats-per-person and
    // no depletion — a 25-person hamlet landed a 16-food windfall and the world
    // split bimodally into fishless inland vs 90%-fish ports. Now the cap is
    // EMERGENT = fishers × per-capita catch × abundance: a fishing village
    // feeds itself with surplus, a great port CAN exist (the all-in classical
    // equilibrium on rich virgin coast solves to thousands of people with the
    // stock fished down — the overfished-commons steady state), and industrial
    // trawling can genuinely strip a coast. The Tier-A demand-gap gate (poor,
    // below) is KEPT as the effort throttle — the sea supplements exactly the
    // need the land leaves unfilled (the full rationale lives with the gate's
    // Tier-A record in docs/tier-a-fixes-2026-07-28.md §1).
    if (sea > 0.02) {
      // `poor` = clamp01(1 − netLand/demand) on RETAINED land food (netLand,
      // last tick's hierarchy net — one basis with the supply line below; both
      // sides same-unit per-tick food, so the gate is constant-free and closes
      // BY ITSELF as agriculture matures).
      const poor = demand > 0 ? Math.max(0, Math.min(1, 1 - netLand / demand)) : 0;
      // Fisher labor share: the hungry share mans the boats. A land-fed coast
      // draws ~no boats; a coast that cannot feed itself commits its full
      // boat-capable share (FISHER_MAX). The ADJUSTMENT rate (FISHER_ADJ) is
      // the labor-reallocation clock — boats built, crews learned — and the
      // damper that populates the formerly-empty proportional middle band
      // (the measured bistability becomes a transition regime).
      const _dtF = world._dt || 1;
      const curFF = s._fisherFrac || 0;
      const dFF = T.FISHER_MAX * poor - curFF;
      const limFF = T.FISHER_ADJ * _dtF;
      const ff = curFF + (dFF > limFF ? limFF : dFF < -limFF ? -limFF : dFF);
      s._fisherFrac = ff;
      if (ff > 1e-6) {
        const shore = shoreTilesOf(world, s);
        const nSh = shore.length;
        if (nSh > 0) {
          let ft = world._fishTaken;
          if (!ft || ft.length !== world.N) ft = world._fishTaken = new Float32Array(world.N);   // lazily allocated, 0 = virgin (the _soilFatigue pattern)
          // Per-tile capacity is DERIVED, never stored: C_i = C_full × rich_i,
          // where C_full = 4·MSY/r (the logistic identity MSY = rC/4) and
          // rich_i is the cold-temperate marine-productivity shape evaluated
          // from the TILE's temperature (fishRichAt — seaRich appears ONCE,
          // inside the capacity, not as a separate catch factor). ÷rNormPop:
          // a coastline is 1-D (the sea.js budget principle), so a finer grid
          // cuts the same real shore into rn× more tiles — each tile carries
          // its SHARE of the real stretch's stock, keeping the total fishery
          // and its depletion clock resolution-invariant (÷1 exactly at the
          // 240-tile reference; regrowth is capacity-relative, unaffected).
          const cFull = 4 * T.FISH_MSY / Math.max(1e-9, T.FISH_REGEN) / rNormPop(world);
          // Mean abundance d = Σ S_i / (n_shore × C_full): the standing stock
          // as a fraction of full-richness virgin capacity — catch-per-unit-
          // effort falls as the shore is fished down.
          let wSum = 0;
          for (let k = 0; k < nSh; k++) { const ti = shore[k]; wSum += (1 - ft[ti]) * fishRichAt(world, ti); }
          const d = wSum / nSh;
          // Catch = fishers × per-capita catch (FISH_PER_CAP on virgin full-
          // richness water) × technique (fishFactor normalized to the 0.3
          // pre-tech baseline) × abundance.
          fish = s.people * ff * T.FISH_PER_CAP * ((techEff(s).fishFactor || 0.3) / 0.3) * d;
          // Drawdown, same tick, deterministic settlement order: distribute the
          // catch over the shore ∝ S_i; taken_i += catch_i / C_i, clamped so a
          // remnant always survives to reseed the logistic. Ports whose boxes
          // overlap share tiles — the commons is real.
          if (fish > 0 && wSum > 1e-9) {
            for (let k = 0; k < nSh; k++) {
              const ti = shore[k];
              const rich = fishRichAt(world, ti);
              if (rich <= 1e-6) continue;
              const w = (1 - ft[ti]) * rich;
              if (w <= 0) continue;
              const v = ft[ti] + (fish * w / wSum) / (cFull * rich);
              ft[ti] = v > 0.999 ? 0.999 : v;
            }
          }
        }
      }
    } else if (s._fisherFrac) {
      // Inland (or a lever/water edge case): the boats stand down at the same
      // reallocation clock.
      s._fisherFrac *= 1 - T.FISHER_ADJ * (world._dt || 1);
    }
  } else {
  // FISH_LABOR=0: boats stand down; no legacy flat-cap fishery.
  if (s._fisherFrac) s._fisherFrac *= 1 - T.FISHER_ADJ;   // boats stand down if the lever flips off mid-run
  }
  s._fishYield = fish;

  // Land food is STORABLE — it fills granaries and ships across the world
  // to feed distant cities. Fish is perishable: it feeds the local
  // population well but can't be shipped or stored, so it never becomes
  // export food. The food trade reads _storableSupply for what a
  // settlement can send out.
  s._storableSupply = landFood;
  // Carrying food = the RETAINED land food (netLand, hoisted above the fish
  // block, which gates on it) plus local perishable fish. So a city is fed by
  // its whole hinterland, not 12 partners.
  const supply = netLand + fish;
  // Expose rates so the food-trade pass can compute surplus/deficit
  // per road without recomputing forage + farmland sums.
  s._foodSupply = (T.SIEGE_STARVE && s._besiegedNow) ? 0 : supply;   // a besieged seat's flow is the besieger's (T.SIEGE_STARVE, block above)
  s._foodDemand = demand;          // total (civilian + garrison) — drains the granary
  s._civFoodDemand = civDemand;    // civilian only — army sizing reads this
  s._landFood = landFood;          // LOCAL farm production only (no hierarchy imports, no fish) — for the food-viability overlay
  s._urbanFactor = urbanFactor;
  // A granary cannot hold negative grain (owner report 2026-08-14: "cities
  // STILL have negative food"): the store floors at 0 — an uncovered
  // shortfall's consequence is the famine channel and the STARVE_SHED melt,
  // never a grain debt carried on the books.
  // Sustained FED-NESS (T.STARVE_SHED): flow PLUS what the store covers this
  // tick. A stocked city is not starving — the pot's purpose is to bridge
  // lean flow. ~100-tick EMA (a granary-decade).
  {
    const need = s._coreNeed || 0;
    const store = s.food || 0;
    const flow = s._foodSupply || 0;
    const covered = need > 0 ? Math.min(need, flow + store) : need;
    const fedNow = need > 0 ? Math.min(1, covered / need) : 1;
    s._fedM = s._fedM === undefined ? 1 : 0.99 * s._fedM + 0.01 * fedNow;
  }
  s.food = Math.max(0, (s.food || 0) + supply - demand);
  // T.TRIBUTE_OF_LAND — Joseph's granary: the CAPITAL draws the polity's
  // in-kind store down when its own granary runs below a few ticks of
  // demand. The state's storehouse is the famine buffer it historically was
  // (Egypt's grain administration; the Inca storehouse network) — filled
  // from the whole land's tribute, spent where the court sits. Same food
  // units on both sides (the store accrues in this pass's own demand
  // constant — entities.js updateTribute).
  if (T.TRIBUTE_OF_LAND && s._isCapital && s.countryId >= 0 && s.food < demand * 4) {
    const pol = getPolity(world, s.countryId);
    if (pol && pol.tribute > 0) {
      const draw = Math.min(pol.tribute, demand * 4 - s.food);
      pol.tribute -= draw;
      s.food += draw;
    }
  }

  // Seasonality → storage: a mild-summer/harsh-winter climate MUST bank the
  // harvest to survive winter, so it builds deeper granaries (root cellars,
  // smokehouses) — a larger buffer against famine/siege than a tropics where
  // food is gathered year-round. (A storage-economy proxy, not a full annual
  // cycle.) Reuses the cool-temperate selection target.
  const storageCap = granaryCap(s);
  if (s.food > storageCap) s.food = storageCap;
  if (s.food < 0) s.food = 0;
  // T.GRANARY_SPOIL — stored grain rots (insects, damp, rats). Not the mouths
  // drain above — passive loss on what sits in the barn. T.CLIMATE_SPOIL scales
  // the rate: hot+wet tropics fast, hot+dry river valleys slow (the Nile kept
  // grain; the wet tropics could not). ~1%/yr at reference climate (~4 steps/yr).
  if (T.GRANARY_SPOIL > 0 && (s.food || 0) > 0) {
    const clim = T.CLIMATE_SPOIL > 0
      ? grainSpoilClimate(s._climTemp, s._climMoist) : 1;
    const loss = 0.0025 * clim * (s.food || 0) * (world._dt || 1);
    s.food = Math.max(0, (s.food || 0) - loss);
  }
}

// The granary's capacity — ONE definition, two consumers: the updateFood clamp
// above, and the grain market's seed-corn rule (foodHierarchy.js: a settlement
// sells only the surplus its own granary cannot absorb).
export function granaryCap(s) {
  const seasonStore = T.SEASON_STORE > 0 ? 1 + T.SEASON_STORE * seasonalSelect(s._climTemp || 0.5, s._climMoist || 0.5) : 1;
  return (80 + s.tier * 200) * seasonStore;
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
  if (!s._devMat || (world.step + s.id) % _strideIvl(KNOW_INTERVAL) === 0) {
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
  // _foodSupply = food-hierarchy net (own + subtree intake − shipped up) + local fish.
  // T.GRAIN_MARKET: MARKET EXPORTS ADD BACK into the capacity basis
  // (s._foodExported — last aggregation's peer-market sales, the same 1-tick
  // lag as _foodNet itself). The FOOD_REACH asymmetric-authority law extended
  // to the market: selling grain is a downward-take, and the market cannot
  // drag a catchment's carrying capacity below what its own land grows —
  // measured without it, even the post-seed-corn export trickle (PEER-bought
  // rounding to 0.00/tick) lowered marginal sellers' supply-based K below the
  // fade bar (777: 40→14, gm/gm2_stylized_777). The add-back form (not a
  // max() against production) because the first floor implementation compared
  // last-tick net against THIS-tick production and became a cross-tick
  // ratchet under HARVEST_YEARS — muting the annual capacity signal for every
  // settlement from tick 1, trades or none (the gm3/gm4 15-alive residue).
  // Add-back is exact: zero when nothing sold (a no-trade lever world is
  // byte-identical to baseline), sellers-only, harvest-transparent, and a
  // besieged seat sells nothing (the market pass skips besieged parties) so
  // SIEGE_STARVE still bites in full.
  let foodK = ((s._foodSupply || 0) + (T.GRAIN_MARKET > 0 ? (s._foodExported || 0) : 0)) / perCapita;
  // ×_eraProd: the housing/site ceiling rises with the same composite
  // productivity index as food, representing denser settlement (intensive rural
  // occupation, vertical urban growth) as land capital and industry mature.
  // Without this the population would stay pinned at the medieval SITE cap
  // while food scaled freely.
  // Applying the productivity index linearly to a single city's housing lets one
  // high-productivity capital absorb a whole region into an unphysical megacity
  // (and makes the world fragile — when that one city falls the global total
  // craters). City INFRASTRUCTURE can't scale as fast as farm OUTPUT, so housing
  // takes a DAMPENED power (HOUSE_ERA_POW): the surplus food the capped city
  // can't house stays in the hinterland feeding RURAL population, so the boom
  // spreads across the land and many towns instead of piling into one metropolis.
  // Under the Tier-B composite index the same damping reads pre-modern works too:
  // an improved basin houses denser (≤3^0.8 ≈ 2.4× at full works — why classical
  // cradle cities can exist on grain), and the modern ceiling rides
  // INDUSTRIAL_CAP alone (78^0.8 ≈ 33 vs the legacy overlay's 261^0.8 ≈ 86 — the
  // recorded modern-era scale change, re-tunable through that single lever).
  // Housing deliberately keeps the ONE composite number (works feed people AND
  // terraced basins housed denser — design open q.6 resolved composite).
  const houseEra = Math.pow(s._eraProd || 1, T.HOUSE_ERA_POW);
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
    const rEra = Math.pow(s._eraProd || 1, T.RURAL_ERA_POW);
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
  const _kMin = viableUnits();
  const K = T.DISSOLVE_FARMS
    ? Math.max(_kMin, foodK)
    : Math.max(_kMin, Math.min(foodK, houseK));
  s._k = K;
  s._foodK = foodK;            // exposed so the info panel can show which limit binds
  s._houseK = houseK;
  // T.FOOD_REACH — the ledger's writ over its countryside (2026-08-11, the
  // residual birth-crater root cause; docs/dawn-cradles-2026-08-07.md §6).
  // Stamped here (techEff's home turf) so the field pass reads a plain field:
  // FOOD_K's blend weight becomes fkL × THIS — the same administrative ramp
  // the grain levy runs on (foodReach below), because a border is not an
  // economy: the market's authority over rural carrying capacity extends
  // exactly as far as the bureaucracy that can assess, collect and haul the
  // countryside's harvest. Below the proto-state threshold the countryside
  // keeps the subsistence formula wholesale.
  s._foodReach = T.FOOD_REACH ? foodReach(s) : 1;

  const _dt = world._dt || 1;                         // time-granularity step (1/SIM_GRANULARITY)
  // ── T.FED_FAMINE: an empty CITY granary starves the CITY — the urban core,
  // the people who depend on the pot — never the subsistence countryside whose
  // own harvest fed them the tick before. The 2026-08-07 birth-crater
  // investigation measured the defect this scopes out: under ONE_POP a newborn
  // censuses its WHOLE catchment onto a ledger whose supply machinery starts
  // cold (worked farmland assigns over territory passes), demand ran 2-25×
  // supply, the granary window expired, and the empty-pot die-off — applied to
  // the FULL census — starved 50-90% of the basin's field people around the
  // newborn (Ganges: half of a 124k-person basin; Indus/Nile to 0.25-0.27× at
  // the app grid). Countryside starvation has its own honest channels — the
  // field's capacity law (pop > cap) and the harvest-shock module (famine
  // windows cut landFood, which both the pot AND the field feel) — so the
  // pot's emptiness is the CORE's emergency alone. v1 of this lever scoped the
  // base by a fedPeak supply-ratchet ("the most people the ledger ever fed")
  // and measured DEFEATED: newborn ledgers see transient supply spikes
  // (hierarchy grain, first harvests — s≈1.5-1.8 at +250 steps) that ratchet
  // the memory to census scale before the crash, and the craters reproduced
  // ~unchanged (tables in docs/dawn-cradles-2026-08-07.md §4). No memory, no
  // ratchet, no constant: the base IS the urban core.
  // T.FOOD_REACH famine gate (2026-08-11, docs §6): an empty STORE is not
  // core starvation while the supply FLOW still covers the core's own need.
  // Under FOOD_REACH the census (and so the ledger's headline demand) counts
  // subsistence countryside the market neither feeds nor taxes, so a
  // proto-state city amid a THRIVING basin runs a permanently negative
  // notional ledger — pot pinned at 0, the die-off firing every tick at full
  // rate (measured: famT 775/1101 ticks, Σkill 2990, the dissolve-arm
  // aliveness gate broken) while its actual flow (s/d 2.58/4.25) covered its
  // 87-person core several times over. The gate compares flow to _coreNeed
  // (the pot's real dependents at the civic rate + garrison + unfree — the
  // same quantities FED_FAMINE scopes the KILL to); genuine starvation
  // (flow below the core's own need) dies exactly as before. Follows the
  // FED_FAMINE precedent: scope the famine CONSEQUENCE, never re-key the
  // calibrated granary/trade drain. Lever off ⇒ gate absent, byte-identical.
  if (s.food <= 0.01 && s.people > 1
      && (!T.FOOD_REACH || (s._foodSupply || 0) < (s._coreNeed !== undefined ? s._coreNeed : Infinity))) {
    const before = s.people;
    if (T.FED_FAMINE) {
      const dependents = Math.min(before, s._urbanPop || 0);
      s.people = Math.max(1, before - dependents * (1 - Math.pow(0.985, _dt)));
    } else {
      s.people *= Math.pow(0.985, _dt);               // legacy: famine die-off over the whole census
    }
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
  if (s.people < viableUnits()) {
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
    // ONE_POP: the field already split urban/rural. A yield-ratio heuristic
    // (90% rural) overwriting _urbanPop every tick is what made the inspect
    // card bounce between the measured city and 10% of the catchment — and
    // any same-tick reader (tier, dissolve, food on a stride gap) saw the
    // wrong number. Keep the field measurement when we have one.
    if (T.ONE_POP && s._coreMeasured != null) {
      s._urbanPop = Math.min(s.people, s._coreMeasured);
      s._ruralPop = Math.max(0, s.people - s._urbanPop);
    } else {
      const ruralFrac = ruralShare(s);
      s._ruralPop = s.people * ruralFrac;
      s._urbanPop = s.people - s._ruralPop;
    }
  } else {
    s._ruralPop = 0; s._urbanPop = s.people;
  }
}

// ── Tier ───────────────────────────────────────────────────────────
function updateTier(world, s) {
  // RANK tiers (Tier-B food wave): the urban hierarchy is a RANK structure
  // (central-place theory) — towns are the upper half of the settlement
  // lattice, cities its top ~15% (each city serves ~3-5 towns, the Christaller
  // branching band). The bars are the settled-population PERCENTILES
  // townBar = max(floor, P50), cityBar = max(floor, P85), which decouples the
  // labels from the food SCALE entirely (they survive the honest-food rework,
  // any seed, any resolution) — the retired TIER_SCALE_REF=29000 was
  // calibrated to the phantom-fish population scale and sat pinned at its 0.4
  // floor all run (tier-a-fixes: the recorded Tier-B constraint). The floors
  // are exactly those measured pre-Tier-B effective bars (THRESHOLD × the 0.4
  // floor: 60 town / 240 city), kept so a tiny early world still mints its
  // first towns. Percentiles gate LABELS/rank thresholds only — never any
  // realm's resources. Cached once per tick.
  // LEGACY ARM (A/B): TIER_SCALE_REF > 0 restores the world-total relative
  // scale byte-identically (TIER_SCALE_MAX caps it; the old default was 29000).
  // T.CITY_CORE: the ladder ranks what a settlement IS — its URBAN CORE — not
  // the countryside it farms. Under ONE_POP `people` is the CATCHMENT census
  // (city + every villager in its district), so the old ranking measured how
  // peopled a district was and called the result a town: measured, the median
  // "town" at step 2000 has an urban core of 881 people (a hamlet) against a
  // 22,000-person catchment, and not one settlement clears the town floor on
  // its real core through step 6000 (docs/state-birth-2026-08). The economy
  // already disagrees with the label — the agglomeration pass gives a
  // non-importer no urban target at all. Reading _urbanPop makes the label mean
  // the thing it names. Requires the DISSOLVE_FARMS province split: without it
  // _urbanPop IS the whole catchment (no rural share is ever carved off) and
  // the small core floors would mint instant metropolises.
  // Off = the catchment census, byte-identical.
  const coreLadder = !!(T.CITY_CORE && T.DISSOLVE_FARMS);
  let topU = world._topUrban;
  if (world._tierScaleStep !== world.step) {
    let tot = 0, top = 0;
    const pops = [];
    for (const x of world.settlements) if (x.mode === "settled") {
      const rank = coreLadder ? (x._coreMeasured || 0) : (x.people || 0);
      tot += x.people || 0;
      // The percentile pool ranks the CATCHMENT census under every regime: the
      // published world._townBar/_cityBar are the age's "typical town/city"
      // MEASUREMENT in census units — a public quantity other systems consume
      // in those units (maybePlantTowns' relative capital bar, probes, panels)
      // — while the core ladder below prices its rungs on TIER_CORE
      // definitions and never reads these percentiles at all.
      pops.push(x.people || 0);
      if ((x.tier | 0) >= 1 && rank > top) top = rank;   // largest URBAN centre, for the floating metro bar
    }
    pops.sort((a, b) => a - b);
    const n = pops.length;
    const pAt = (q) => n ? pops[Math.min(n - 1, Math.floor(q * n))] : 0;
    world._tierScale = 1;   // kept for probes/panels that read it
      // DEFLATION GUARD (T.MULTI_HEARTH, docs/design-c-hearth-field.md §1d): a
      // census is a PARTITION of the same field people among the labels that
      // exist, so raising the label supply lowers every label's share — measured
      // p50 69 → 44 going from 78 to 139 labels — and the absolute floors then
      // BIND (60 > 44), pinning every label to tier 0/1 and collapsing the whole
      // tier-keyed stack (CORE/HINTERLAND_BY_TIER, foodHierarchy's haul ranges,
      // ARMY_TIER_FRAC × s.people, the Zipf/urbanisation stylized facts). The
      // floors are, by their own comment above, "a documented measured-floor
      // shortcut… not first-principles census minima" — a number from a retired
      // scale. Central-place rank structure is scale-free by construction, so the
      // pure percentile is the mechanism-honest bar and it self-calibrates at any
      // label supply (verify, don't re-anchor). Off the lever the floors stand.
      // MEASURED SINCE (docs/tier-bar-derivation.md): the percentile is scale-free
      // but a fixed RANK QUOTA — 15% "cities" in any distribution — and the
      // T.TIER_BRANCH branch below supersedes this guard when set: same survival
      // under deflation, city share a measurement of the tail instead of a quota.
      // THE DERIVED CITY BAR (T.TIER_BRANCH > 0, docs/tier-bar-derivation.md —
      // the open item both the hearth field and the idea field are blocked on).
      // The comment above states the mechanism — "each city serves ~3-5 towns
      // (the Christaller branching band)" — and then implements it as a rank
      // QUOTA (P85), which fixes the COUNT ratio where Christaller's statement
      // is about the LOAD ratio. A city is a central place carrying the
      // higher-order demand of K towns' catchments, so its catchment census is
      // K × the TYPICAL town's:   cityBar = K × median.   This is neither an
      // absolute census floor (it moves with the world's own scale, so label-
      // supply deflation moves the bar and the labels together) nor a fixed
      // rank quota (the share above K×median is a property of the size
      // distribution's TAIL: a Zipf world yields a few percent of cities, a
      // flat lattice of equal villages yields ZERO — where P85 mints 15%
      // "cities" in ANY distribution, including uniform). K is the lever value
      // itself — a structural constant of market geometry (3-5), not a count
      // dialed to an outcome — and the metro bar below is already this species
      // (a fraction of the age's largest). The town bar under DISSOLVE_FARMS
      // gates no promotion (every settlement IS a town; founding is priced by
      // the act bars in field people), so _townBar becomes the pure median —
      // "the typical town", a measurement probes/UI read, not a gate.
      if (T.TIER_BRANCH > 0) {
        const med = pAt(0.50);
        world._townBar = med;
        world._cityBar = T.TIER_BRANCH * med;
      } else {
        world._townBar = T.MULTI_HEARTH ? pAt(0.50) : Math.max(TIER_TOWN_FLOOR, pAt(0.50));
        world._cityBar = T.MULTI_HEARTH ? pAt(0.85) : Math.max(TIER_CITY_FLOOR, pAt(0.85));
      }
    topU = world._topUrban = top;
    world._tierScaleStep = world.step;
  }
  // The METROPOLIS bar floats with the largest city (METRO_REL_FRAC of it,
  // floored at the absolute base): "metropolis" means one of the handful of
  // biggest cities of the age, so it stays rare as development lifts every
  // city's size, instead of the whole city tier eventually crossing a fixed
  // bar into a metro glut. Unchanged by the rank-bar rework.
  // The core ladder's bars are DEFINITIONS (TIER_CORE, absolute core census):
  // a town/city/metropolis is a size of urban core, not a rank in this world's
  // distribution — a percentile bar mints its fixed share of labels in ANY
  // world (measured: re-ranking alone still called 26 hamlet-cored settlements
  // "cities" at step 3000), so the words only regain meaning as floors. They
  // stay LOCAL: world._townBar/_cityBar keep publishing the census-unit
  // percentile measurement for their existing consumers.
  const metroBar = Math.max(coreLadder ? TIER_CORE[3] : TIER_THRESHOLD[3], topU * METRO_REL_FRAC);
  const townBar = coreLadder ? TIER_CORE[1] : world._townBar;
  const cityBar = coreLadder ? TIER_CORE[2] : world._cityBar;
  const bar = (t) => t === 3 ? metroBar : t === 2 ? cityBar : t === 1 ? townBar : TIER_THRESHOLD[0];
  // Farming regions (tier 0) NEVER urbanise in place: a region is a collection
  // of villages, not a proto-city. It instead BIRTHS a separate town within its
  // catchment (urban genesis, crystallize.js). So the tier ladder here moves
  // only ALREADY-URBAN nodes (tier ≥ 1) up and down — the rural→urban step is a
  // spawn, not a relabel.
  // Under DISSOLVE_FARMS the smallest settlement IS a town: no tier-0 farming regions
  // ever exist. Any path that mints one anyway (cradles start small; a colony created
  // without an explicit tier) is floored to a town here, so it can't linger as a
  // "farming region" once the relative town-bar rises above its size mid-game.
  if (T.DISSOLVE_FARMS) { if ((s.tier | 0) < 1 && !coreLadder) s.tier = 1; }
  else if ((s.tier | 0) === 0) return;   // legacy model: tier-0 regions birth towns, don't relabel
  // The settlement's own value must be measured on the SAME scale as the bars
  // (core ladder: the FIELD-MEASURED urban core; off, catchment census). Not
  // _urbanPop: inside the settlement pass that holds the census-side ruralShare
  // HEURISTIC (updatePopulation just overwrote it; deriveOnePop re-measures
  // later in the tick), and pricing the ladder on the model instead of the
  // measurement minted a "city" at step 1 and metropolises at 3× their field
  // core. A core not yet measured (fresh birth, pre-first-derive) must not
  // fall back to the catchment either — the label just waits for the field.
  if (coreLadder && s._coreMeasured == null) return;
  const mine = coreLadder ? s._coreMeasured : s.people;
  // Promote among the urban tiers (town → city → metropolis).
  for (let t = TIER_THRESHOLD.length - 1; t > s.tier; t--) {
    if (mine >= bar(t)) {
      s.tier = t;
      // Announce "grew into a city/metropolis" only the FIRST time this rung is reached
      // (s._peakTier), not on every flicker. Settlements cluster at the relative city bar
      // and flip tier 1↔2 harmlessly (the flip barely affects behaviour) — logging each
      // crossing drowned the chronicle in thousands of grew/declined lines.
      if (t > (s._peakTier | 0)) {
        s._peakTier = t;
        logEvent(world, "settlement.tier", { s: s.id, sName: s.name, polity: s.countryId,
          tier: t, tierName: (coreLadder ? TIER_NAME_CORE : TIER_NAME)[t], up: 1, people: Math.round(mine) });
      }
      return;
    }
  }
  // Demote one rung once population has fallen clearly below the current tier's
  // floor — but never below tier 1. SILENT: a town slipping a rung at the floating
  // bar isn't chronicle-worthy and would only flicker against the re-promotion.
  if (s.tier > (coreLadder ? 0 : 1) && mine < bar(s.tier) * TIER_DEMOTE_FRAC) {
    s.tier -= 1;
  }
}

export { TIER_THRESHOLD, TIER_NAME, TIER_CORE, TIER_NAME_CORE };

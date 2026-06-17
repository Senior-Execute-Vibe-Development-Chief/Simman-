// Settlement crystallization sweep.
//
// New settlements appear at fertile, watered sites. Probability of any
// given site spontaneously becoming a settlement depends on:
//   1. Site quality (fertility + water access bonus)
//   2. Transport distance to the nearest existing settlement
//      (computed by transport.js — terrain-weighted Dijkstra).
//
// Sites close in transport (knowledge diffuses from neighbours via
// trade and migration along easy corridors) crystallize fast. Sites
// very far away can still crystallize through INDEPENDENT INVENTION
// at a low baseline rate — matches the historical pattern of separate
// agricultural revolutions in the Levant, Yangtze, Indus, Mesoamerica.
//
// Knowledge inherited from the nearest settlement gets diluted with
// transport distance: a settlement spawning right next to a city
// inherits most of its tech; one that crystallises in isolation starts
// near the cradle baseline.

import { isContinentalLand } from "./state.js";
import { makeSettlement } from "./settlement.js";
import { getPolity } from "./entities.js";
import { dominantCulture, foundCulture, seedCulture, nameFor } from "./cultures.js";
import { passRng } from "./rng.js";
import { computeTransport } from "./transport.js";
import { forEachNear, gridAdd } from "./spatialGrid.js";
import { grownOwnerAt } from "./countryClaim.js";
import { T } from "./tuning.js";

const CRYSTAL_INTERVAL          = 24;     // sweep more often (was 32)
const TRANSPORT_REFRESH_TICKS   = 480;    // transport map is a global O(map) flood — a
                                          // frame spike at high speed; it drives only spawn
                                          // weighting and drifts slowly, so refresh rarely
const CANDIDATES_PER_SWEEP      = 120;    // wider net per sweep (was 80)

// Permissive fertility gates. Earth had hamlets in desert, tundra,
// steppe, jungle — they just stayed small because the land couldn't
// carry more. The hard thresholds used to ban any settlement below
// MIN_FERT=0.30 or in non-watered land below LUSH_FERT=0.55, which
// emptied vast realistic regions. Now: any land can host a
// settlement, but the quality-weighted probability strongly favours
// good sites — a fertile river valley spawns a city in centuries,
// a desert spot spawns a tiny hamlet over millennia. Carrying
// capacity (K ∝ farmland × fert) keeps marginal hamlets small.
const MIN_FERT                  = 0.03;   // basically "is there any soil?"
const MIN_AREA_FERT             = 1.0;    // 5×5 box must have *some* support
// Tighter spacing → a lush continent fills with a denser web of
// smaller settlements rather than a handful of ever-growing
// metropolises. Farmland contention (_farmedBy) between close
// neighbours keeps each one's footprint — and so its carrying
// capacity — modest.
// Spacing. A hard minimum prevents territorial overlap; everything else
// (where towns cluster vs. where they don't) is driven by site quality, not
// the spacing rule. The "geometric grid" pattern we used to see came not
// from the spacing alone but from too-weak locational pull: with roughly
// uniform fertility AND only ~2× quality multipliers for rivers/coasts,
// every site looked similar and packed evenly. The fix is in the QUALITY
// scoring below — but the spacing rule is now SOFT, not binary. The old
// binary `tooClose = (d < MIN_SETT_DIST)` rule produced a circle-packing
// pattern visible as a low coefficient-of-variation in the nearest-neighbour
// distribution: every new settlement landed at *exactly* the smallest
// distance the rule allowed, giving a uniform grid. The soft version below
// rejects truly overlapping sites (d < HARD_FLOOR) but lets brilliant
// candidates squeeze in close (creating twin/paired towns — Buda-Pest,
// Edo-shitamachi, the classic dual market settlements) while typical
// fertility-tier candidates still get pushed apart.
const HARD_FLOOR                = 4;          // absolutely no settlement closer than this
const HARD_FLOOR_SQ             = HARD_FLOOR * HARD_FLOOR;
const SOFT_DIST                 = 10;         // beyond this, the spacing factor is 1 (no penalty) — tighter so villages pack denser
const SOFT_DIST_SQ              = SOFT_DIST * SOFT_DIST;
// ── Market-town pull ──
// A new settlement is more likely to crystallise WITHIN the catchment area
// of an existing town/city — markets, labour pools, defence, and trade
// gravity all attract incoming farmers. This is the cause of the
// historical "cluster of villages around a market town" pattern: most real
// rural settlements existed within a day's walk of a market. Without this
// term, the spacing rules alone produced a circle-pack with everyone at the
// floor; market pull breaks that by making the *area around an existing
// settlement* a preferred zone.
//
// Per existing settlement, contribute (tier+1) × exp(-d/MARKET_RANGE) to a
// candidate's pull. So a city (tier 2) within 20 tiles adds 3 × exp(-20/30)
// = ~1.54, while a village (tier 0) at 40 tiles adds only 1 × exp(-40/30) =
// ~0.26. The cradle's nearby villages cluster; distant frontiers are weak.
// The cradle's MARKET_RANGE is large enough that the catchment overlaps
// with itself, producing dense intra-cluster spawning at distances above
// the SOFT_DIST floor (15-30 tiles, not 5-10).
const MARKET_RANGE              = 20;   // tighter catchment — clusters are local, not regional
const MARKET_PULL_WEIGHT        = 0.4;   // modest pull so clusters form but don't snowball
// Spacing-factor: 0 at HARD_FLOOR, 1 at SOFT_DIST. Used in sendSettlers'
// hard reject because mother-country colony parties already pick deliberately
// (the founder doesn't accidentally plant at 4 tiles).
const MIN_SETT_DIST             = 8;          // daughter-colony spacing floor (grid near-query radius)
const KNOWLEDGE_DECAY_SCALE     = 30;
// Radius for the spatial-grid fast path in inheritKnowledgeAt. Generous enough
// that any non-isolated spawn finds its nearest neighbour in the grid (so the
// O(settlements) full scan is only hit for genuinely remote sites).
const INHERIT_NEAR_RADIUS       = 90;
// Independent invention: a site reached by no land network at all relies on
// this baseline rate. Low so empty regions stay empty until colonised
// (existing networks still spread by diffusionMul × NEAR_RATE).
const INDEPENDENT_RATE          = 0.020;
// Spontaneous invention ACROSS OPEN WATER (no land path to any existing
// settlement → transportDist is Infinity) is far rarer: separate landmasses
// are reached by COLONISATION (sea.js), not magically populated. A small
// non-zero rate keeps the door open for the occasional independent overseas
// genesis (the Mesoamerica/Andes pattern) without letting empty continents
// fill before colonists can sail to them.
const OVERSEAS_INDEPENDENT_RATE = 0.02;
// Transport-cost beyond which a new community is an INDEPENDENT ORIGIN — its
// own root people, language family and gods — rather than a divergent branch
// of a distant stock. A whole connected landmass stays one FAMILY of related
// peoples (Indo-European spreads across a continent by land); only a genuine
// barrier — open water (transportDist = Infinity) or an extreme interior
// beyond this cost — breeds a separate civilisation.
const INDEPENDENT_DIST          = 185;
const NEAR_RATE                 = 1.50;
const BASE_RATE                 = 0.030;   // 3x — the world settles ~3x faster/denser (a fuller map of villages); the saturation guard (REF) sets where it plateaus
// A settlement spontaneously arising on a STATE'S land (its core or claimed
// marches, world._countryOwner) is born INTO that state; one arising in genuine
// wilderness is born INDEPENDENT (a new country). See the spawn block below.

// ── Settler colonisation (mother-country-driven expansion) ───────────
// A crowded, prosperous town with no room to grow ("housing pressed" or
// near its food cap) sends out a SETTLER PARTY: a chunk of its population
// walks a few tiles to a viable empty site and founds a daughter town that
// joins the parent's realm from day one (s.countryId = parent.countryId,
// parentSettlementId set → already gets COLONY_SUPPLY_FOOD/COIN from
// conquest.js). This is the Greek apoikia / Roman colonia / Ostsiedlung
// pattern: population pressure drives outward settlement, peacefully growing
// the realm instead of waiting for spontaneous crystallisation or conquest.
const COLONY_CHECK_INTERVAL   = 240;   // ticks between settler-party rolls (per parent)
const COLONY_MIN_POP          = 200;   // need a town worth's people before splitting one off
const COLONY_PRESS_FRAC       = 0.85;  // counts as "pressed" at this fraction of carrying capacity
const COLONY_SEND_FRAC        = 0.10;  // fraction of parent's population that leaves with the settler party
const COLONY_SEND_CAP         = 80;    // max settlers per founding (a whole town doesn't depopulate)
const COLONY_RANGE            = 28;    // tiles the settler party will walk from the parent
const COLONY_MIN_RANGE        = MIN_SETT_DIST + 2;  // can't found right next door (spacing already enforces it; this is just the search lower bound)
const COLONY_CANDIDATES       = 12;    // viable sites sampled per attempt (best is picked)
const COLONY_CHANCE           = 0.5;   // probability a pressed, eligible parent actually sends settlers on a roll
const COLONY_COOLDOWN         = 1500;  // ticks the parent waits between settler parties (recovery)
const COLONY_HEADROOM         = 0.85;  // realm may only colonise while admin load is below this fraction of capacity
const COLONY_MIN_SOLVENCY     = 0.80;  // ...and only while it can still (mostly) pay its army
// Colonisation, like crystallisation (CRYSTAL_SATURATION_REF), slows as the
// world fills: the per-parent send chance is scaled by 1/(1+alive/REF). Without
// this, colonisation (undamped, and now the dominant settlement source) keeps
// packing towns into already-claimed land forever — ever more provinces → ever
// more over-extension secession → the steadily-climbing nation count and the
// late-game splotchy churn. With it, settlement density plateaus.
const COLONY_SATURATION_REF   = 1500;  // density guard — much higher so colonisation keeps filling the frontier (denser map), not plateauing at a few hundred

// Resource attraction. Each resource has a per-tier value (how
// valuable it is to a civilisation at that tech level) and a
// scarcity factor (how many of the existing settlements DON'T have
// access to it). A candidate tile with a high-richness deposit of
// a tier-appropriate, currently-scarce resource gets a quality
// bonus — that's how mining towns and breadbasket sites form.
// Resource bonuses are still gated by the transport-distance
// modifier (Math.exp(-td/...)), so deposits in genuinely
// unexplored land don't spontaneously attract settlement — the
// resource has to be "discoverable" by an existing network.
const RES_RICHNESS_FLOOR = 0.20;
const RESOURCE_TIER_VALUE = {
  timber:   [1.0, 1.0, 0.8, 0.6],
  stone:    [0.5, 1.0, 1.0, 0.8],
  copper:   [0.2, 0.6, 1.0, 0.8],
  tin:      [0.0, 0.4, 0.8, 0.6],
  iron:     [0.0, 0.2, 1.0, 1.2],
  coal:     [0.0, 0.0, 0.3, 1.0],
  horses:   [0.4, 0.6, 0.8, 1.0],
  salt:     [0.6, 0.8, 1.0, 1.0],
  precious: [1.0, 1.2, 1.4, 1.6],  // currency: always wanted, more in later tiers
  gems:     [0.8, 1.0, 1.2, 1.4],
  spices:   [0.5, 0.8, 1.0, 1.0],  // luxury trade goods: draw settlement, more as wealth grows
  furs:     [0.5, 0.7, 0.8, 0.8],
  incense:  [0.4, 0.6, 0.8, 0.8],
  dyes:     [0.4, 0.6, 0.9, 1.0],
};

// Settlement-count decay for crystallisation: each existing settlement
// makes the next one *slightly* less likely, modelling that as a world
// fills up the remaining viable land is more contested and less likely
// to produce a brand-new village. Without this the late game shows a
// hockey-stick where settlement count explodes once a few cities exist.
// Half-rate around N=300, third-rate around N=600. Settler colonisation
// (which is parent-driven and intentional) is NOT subject to this — the
// mother country can still push outward into the frontier.
const CRYSTAL_SATURATION_REF = 1500;  // density guard — much higher so the world keeps filling with villages (a denser, more alive map) instead of plateauing at a few hundred
// Coverage tempo (applied as devFactor in maybeCrystallize): the habitable world
// starts a SPARSE frontier and fills in gradually over the developmental arc,
// instead of saturating at once. Ungated, crystallisation+colonisation grabbed all
// the easy terrain by the classical era and then sat static; ramping the spread
// rate up over the eras makes the wilderness recede the way it did historically.
const COVERAGE_FLOOR = 0.22;   // stone-age frontier spread rate, as a fraction of full
const COVERAGE_RAMP  = 17000;  // steps over which the spread rate ramps to full (~renaissance)
export function maybeCrystallize(world) {
  if (world.step % CRYSTAL_INTERVAL !== 0) return;

  // Refresh transport map if stale or absent.
  if (!world.transportDist || world.step - (world._transportStep || -Infinity) > TRANSPORT_REFRESH_TICKS) {
    world.transportDist = computeTransport(world);
    world._transportStep = world.step;
  }

  // Alive-settlement count — shared by the colony saturation damper and the
  // crystallisation saturation damper below (one scan instead of two).
  let _alive = 0;
  for (const s of world.settlements) if (s.mode === "settled") _alive++;

  // Coverage tempo: settlement spreads GRADUALLY as civilisation matures rather
  // than all at once (see COVERAGE_FLOOR / COVERAGE_RAMP). Scales both the random
  // crystallisation sweep and mother-country colonisation, so the early map stays a
  // sparse frontier and the wilderness recedes over the eras.
  const devFactor = Math.min(1, COVERAGE_FLOOR + (1 - COVERAGE_FLOOR) * (world.step * (world._dt || 1)) / COVERAGE_RAMP);   // ramp over HISTORY, not raw ticks (SIM_GRANULARITY)
  // Spread is measured in TILES, so a finer-resolution map must scale it like the
  // territory reach does (countryTerritory's RES_REF_W = 240) — otherwise the
  // frontier crawls the same ABSOLUTE tiles/step and a big map fills a far smaller
  // FRACTION per year (the "full-size map barely settles by 1900" bug: 24% claimed
  // at 1950 vs ~40% on the quarter-width reference). resScale = 1 at/below the
  // reference width, so small maps and the determinism tests are untouched.
  const resScale = Math.max(1, world.tw / 240);

  // Mother-country expansion: pressed towns send settler parties (see
  // sendSettlers — this is the entire "population pressure → new colony"
  // axis, distinct from the random crystallisation sweep below).
  if (world.step % COLONY_CHECK_INTERVAL === 0) maybeSendSettlers(world, _alive, devFactor);

  // Urban genesis: a mature farming region births a TOWN within its catchment
  // (the rural→urban transition is a spawn, not an in-place relabel). Gated at a
  // multiple of CRYSTAL_INTERVAL so it actually fires past the early return above.
  if (world.step % URBAN_CHECK_INTERVAL === 0) maybeUrbanGenesis(world);

  // Crystallisation saturation: settlement-count-dependent damper.
  const saturationDamper = 1 / (1 + (_alive / CRYSTAL_SATURATION_REF) ** 2);

  // Compute per-sweep resource scarcity / value table once.
  const resScarcity = computeResourceScarcity(world);

  // Sample random tiles. For each viable one, compute crystallization
  // probability and roll. No cap on settlement count — spacing
  // (MIN_SETT_DIST) and the fertility filters limit density. In
  // saturated regions every candidate fails the tooClose / area-fert
  // checks, so spawn rate falls off naturally.
  const { N, tw, th, elev, fert, coast, riverMag, transportDist } = world;
  const rng = passRng(world, "crystallize");
  // LOCALITY model spaces centres farther apart (×LOCALITY_SPACING) so the map
  // fills with fewer, larger localities — each farming a bigger catchment —
  // instead of a dense village scatter.
  const spMul = T.LOCALITY_MODE ? Math.max(1, T.LOCALITY_SPACING || 3) : 1;
  const hardFloorSq = HARD_FLOOR_SQ * spMul * spMul;
  const softDistSq  = SOFT_DIST_SQ  * spMul * spMul;
  const hardFloor   = HARD_FLOOR * spMul;
  const softDist    = SOFT_DIST  * spMul;
  for (let i = 0; i < CANDIDATES_PER_SWEEP; i++) {
    const ti = rng.int(N);
    if (!isContinentalLand(world, ti)) continue;
    const f = fert[ti];
    if (f < MIN_FERT) continue;
    const hasRiver = riverMag && riverMag[ti] >= 2;
    const hasCoast = !!coast[ti];
    const ty = (ti / tw) | 0, tx = ti - ty * tw;
    // Area-fertility: sum fert in a 5×5 box around the candidate.
    // Used both as a low-floor sanity check (tile must have *some*
    // surrounding support) and as a continuous quality input below,
    // so marginal-but-not-hopeless regions spawn small hamlets while
    // lush regions spawn dense networks.
    let areaFert = 0;
    for (let dy = -2; dy <= 2; dy++) {
      const ny = ty + dy;
      if (ny < 0 || ny >= th) continue;
      for (let dx = -2; dx <= 2; dx++) {
        const nx = ((tx + dx) % tw + tw) % tw;
        const ni = ny * tw + nx;
        if (elev[ni] > 0) areaFert += fert[ni];
      }
    }
    if (areaFert < MIN_AREA_FERT) continue;
    // Visit only the settlements NEAR this candidate (spatial grid, radius
    // MARKET_RANGE × 3), accumulating both:
    //   nearestSq  — for the spacing (anti-overlap) rule
    //   marketPull — for the market-town attraction (positive cluster pull)
    // The radius IS the market cutoff: anything beyond it contributes nothing
    // to either signal (HARD_FLOOR/SOFT_DIST ≪ radius, and the market kernel
    // has decayed to nothing), so the grid query is exact, not approximate.
    // This replaces an O(settlements) scan per candidate — the dominant cost
    // once the map gets dense.
    const MARKET_CUTOFF = MARKET_RANGE * 3;
    let nearestSq = Infinity;
    let marketPull = 0;
    forEachNear(world, tx, ty, MARKET_CUTOFF, (o, dd) => {
      if (dd < nearestSq) nearestSq = dd;
      const d = Math.sqrt(dd);
      const tierBonus = 1 + (o.tier | 0);
      marketPull += tierBonus * Math.exp(-d / MARKET_RANGE);
    });
    if (nearestSq < hardFloorSq) continue;         // hard reject — overlap
    // Linear ramp between HARD_FLOOR and SOFT_DIST on actual distance (not
    // squared, so it grows steeply near the floor and flattens out near the
    // soft boundary — matches the "very close = bad, modest distance =
    // mostly fine" historical pattern). (Thresholds widen in LOCALITY mode.)
    let spacingFactor = 1;
    if (nearestSq < softDistSq) {
      const d = Math.sqrt(nearestSq);
      spacingFactor = (d - hardFloor) / (softDist - hardFloor);
    }
    // Market pull: 1.0 at zero pull (frontier), grows with proximity to
    // existing settlements weighted by their tier. Multiplied into the
    // overall spawn probability so a candidate WITHIN reach of an existing
    // town's catchment gets a real boost — the cause of the historical
    // village-cluster pattern.
    const marketFactor = 1 + MARKET_PULL_WEIGHT * marketPull;

    // Site-quality score — the LOCATIONAL PULL that decides where a sparsely
    // settled landscape clusters. Real settlement patterns are highly uneven
    // (dense along rivers/coasts/chokepoints, empty in marginal interior),
    // and that's because the difference between a good site and a poor one
    // is huge — not the ~2× of the earlier scoring, which produced near-
    // uniform packing. Scale ≈ 0.4 (marginal interior) → 1.5 (decent
    // farmland) → 5–10 (river valley / coast) → 15+ (river-mouth port, pass,
    // confluence). The multiplicative form (rather than additive bonuses) is
    // what makes rivers/coasts dominate by enough to leave bad land empty.
    const fertilityScore = 0.4 + f * 1.5 + Math.min(2.0, areaFert * 0.1);
    let locMul = 1;
    if (hasRiver) locMul *= 6;            // rivers were *the* historical magnet —
                                          // strong multiplier so river valleys
                                          // dominate spawning and dry inland
                                          // tiles stay empty. The Nile pattern:
                                          // dense settlement along the water,
                                          // huge empty desert between.
    if (hasCoast) locMul *= 3;            // coasts second — natural harbours
                                          // and trade contact draw settlement.
    // Resource / network / geographic bonuses are still additive
    // contributions on top of the multiplied location score.
    let quality = fertilityScore * locMul;
    // LAND-HUNGER: population pressure pushes settlers onto poorer land once the
    // good sites NEARBY are taken. marketPull measures how settled the surroundings
    // already are, so this lifts low-fertility tiles ONLY within populated regions
    // (good land still fills first on an open frontier) — and being ADDITIVE it
    // boosts a marginal site far more than an already-prime one. This is what lets
    // the desert/upland interior of a mature region fill with sparse hamlets
    // instead of staying empty forever. (T.LAND_HUNGER lever.)
    quality += T.LAND_HUNGER * Math.min(3, marketPull);
    quality += resourceBonusFor(world, ti, resScarcity);
    quality += busyRoadBonusFor(world, ti, tx, ty);
    quality += geoBonusFor(world, ti, tx, ty);   // chokepoints / passes / sheltered harbours
    quality += defensibilityFor(world, ti, tx, ty);  // hills / river islands / mountain-backed sites

    // Transport-distance modifier. Finite td → diffusion from the land
    // network plus the normal independent floor. Infinite td (across water,
    // unreachable by land) → only the much smaller overseas-invention rate,
    // so other landmasses wait to be colonised rather than self-populating.
    const td = transportDist[ti];
    const diffusionMul = isFinite(td) ? Math.exp(-td / (KNOWLEDGE_DECAY_SCALE * resScale)) * NEAR_RATE : 0;   // diffusion REACHES proportionally farther on a finer map
    const independent = isFinite(td) ? INDEPENDENT_RATE : OVERSEAS_INDEPENDENT_RATE;
    const p = quality * (diffusionMul + independent) * BASE_RATE * saturationDamper * spacingFactor * marketFactor * devFactor * (world._dt || 1);   // granularity: per-tick settling odds scale with the time-step

    if (rng() < p) {
      // Inherited knowledge: blend from nearest settlement, weighted by
      // distance. Far sites start near baseline neolithic knowledge.
      const inherited = inheritKnowledgeAt(world, ti, td);
      // A spawned village is NEVER its own country. It ADOPTS the country whose
      // border has actually GROWN over the tile it's founded on (grownOwnerAt →
      // world._countryClaim), or is born STATELESS (-1) if the front hasn't
      // reached here — a frontier hamlet that's just population until a state's
      // territory crawls over it (adoptAndFound) or it grows into a city and
      // founds a realm. Reading the GROWN claim (not the realm's projected reach,
      // world._countryOwner) is what stops a hamlet spawning on land a country
      // has merely projected toward from flying that flag ahead of the border.
      // This keeps the political map clean however many villages spawn: villages
      // add people, never countries/flecks.
      const region = grownOwnerAt(world, ti);
      // ── Culture by CONNECTION (independent origins) ────────────────────
      // Who these people ARE depends on whether they have a living link to an
      // existing people:
      //   • DISCONNECTED (across water, transport-unreachable, or beyond the
      //     independence range) → an INDEPENDENT ORIGIN: a fresh ROOT people
      //     with its OWN language family and folk gods. A civilisation that
      //     arose on its own continent owes nothing to one it never met — this
      //     is what gives separate landmasses (and deep interiors) their own
      //     stocks instead of every people descending from the cradles.
      //   • connected but distant / across a climate divide → a divergent
      //     BRANCH of the donor's people (a daughter language of the same
      //     family — Europe from the Near East).
      //   • near → the donor's people simply extends onto new ground.
      const donor = world._lastInheritDonor;
      const dCul = donor ? dominantCulture(donor) : -1;
      const connected = !!donor && dCul >= 0 && isFinite(td) && td <= INDEPENDENT_DIST;
      let climDelta = 0;
      if (connected) {
        const dTi = (donor.pos.y | 0) * tw + (donor.pos.x | 0);
        climDelta = Math.abs((world.temp[ti] || 0) - (world.temp[dTi] || 0)) * 1.4
                  + Math.abs((world.moist[ti] || 0) - (world.moist[dTi] || 0));
      }
      const isBranch = connected && (td > 70 || (td > 38 && climDelta > 0.34));
      const born = makeSettlement(world, tx + 0.5, ty + 0.5, {
        people: 18 + (rng.int(8)),
        knowledge: inherited,
        countryId: region >= 0 ? region : -1,
        parentId: donor.id,   // carries the donor's ancestry; a long jump admixes with the local substrate
        // near spread keeps the donor's people; otherwise we assign below
        cultureId: (connected && !isBranch) ? dCul : -1,
      });
      gridAdd(world, born);   // same-pass candidates must see (and space off) it
      if (!connected) {
        const cul = foundCulture(world, { origin: born });          // independent root: own family, language, gods
        seedCulture(world, born, cul.id);
        born.name = nameFor(world, cul, "settlement");
      } else if (isBranch) {
        // proximity → derivation: a near offshoot speaks a dialect of its
        // stock; a far one is generations removed (and earns its own gods)
        const divergence = Math.max(0.15, Math.min(1, (td - 38) / 90 + climDelta * 0.5));
        const cul = foundCulture(world, { origin: born, parentCultureId: dCul, divergence });
        seedCulture(world, born, cul.id);
        born.name = nameFor(world, cul, "settlement");
      }
    }
  }
}

// Per-sweep resource scarcity / value table. For each tracked
// resource: scarcity = fraction of alive settlements that DON'T
// have local access (≥0.10 richness); value = the tier-appropriate
// weight from RESOURCE_TIER_VALUE, picked by the average settlement
// tier (stone-age clusters don't care about iron; iron-age clusters
// care a lot). The product `scarcity × value` is what later
// multiplies on-tile deposit richness to bonus the spawn quality.
function computeResourceScarcity(world) {
  const out = {};
  if (!world.deposits) {
    for (const id in RESOURCE_TIER_VALUE) out[id] = { sv: 0 };
    return out;
  }
  let total = 0, tierSum = 0;
  for (const s of world.settlements) {
    if (s.mode !== "settled") continue;
    total++;
    tierSum += s.tier || 0;
  }
  const avgTier = total > 0 ? tierSum / total : 0;
  const tierIdx = Math.min(3, Math.max(0, Math.floor(avgTier)));
  for (const id in RESOURCE_TIER_VALUE) {
    if (!world.deposits[id]) { out[id] = { sv: 0 }; continue; }
    if (total === 0) {
      // No settlements yet — treat as fully scarce for the cradle.
      out[id] = { sv: RESOURCE_TIER_VALUE[id][tierIdx] };
      continue;
    }
    let have = 0;
    for (const s of world.settlements) {
      if (s.mode !== "settled") continue;
      const r = s.localRes && s.localRes[id];
      if (r && r >= 0.10) have++;
    }
    const scarcity = 1 - (have / total);
    const value = RESOURCE_TIER_VALUE[id][tierIdx];
    out[id] = { sv: scarcity * value };
  }
  return out;
}

// Bonus from sitting on or beside a heavily-trafficked road. A
// candidate tile picks up the max roadFlow in a 3×3 box around
// it (so settlements form at junctions and on busy arteries, not
// just on the road tile itself). Scales linearly with current
// flow, saturating at FLOW_FOR_BUSY (~3-pair sustained traffic).
// roadFlow is a decaying EMA, so a route that USED to be busy
// but has since gone quiet no longer attracts new towns — the
// "busy" signal reflects traffic happening now, not at any
// point in history. Tolls in roads.js give these settlements an
// economic reason to exist (passing trade pays them tribute);
// this bonus speeds up their spawning so the pattern is visible
// across the sim timescale.
const FLOW_FOR_BUSY = 50;
const BUSY_ROAD_MAX_BONUS = 1.5;
function busyRoadBonusFor(world, ti, tx, ty) {
  const rf = world.roadFlow;
  if (!rf) return 0;
  const tw = world.tw, th = world.th;
  let peak = rf[ti] || 0;
  for (let dy = -1; dy <= 1; dy++) {
    const ny = ty + dy;
    if (ny < 0 || ny >= th) continue;
    for (let dx = -1; dx <= 1; dx++) {
      const nx = ((tx + dx) % tw + tw) % tw;
      const u = rf[ny * tw + nx] || 0;
      if (u > peak) peak = u;
    }
  }
  if (peak <= 0) return 0;
  return Math.min(BUSY_ROAD_MAX_BONUS, BUSY_ROAD_MAX_BONUS * peak / FLOW_FOR_BUSY);
}

// Bonus from on-tile resource deposits. Each resource contributes
// `richness × scarcityValue` where scarcityValue is precomputed per
// sweep. Capped overall to stop a single ultra-rich precious tile
// from dominating fertility (a goldmine in a desert is attractive,
// but not so attractive that the surrounding deserts spawn cities
// just to be near it).
function resourceBonusFor(world, ti, scarcity) {
  if (!world.deposits) return 0;
  let bonus = 0;
  for (const id in scarcity) {
    const arr = world.deposits[id];
    if (!arr) continue;
    const r = arr[ti] || 0;
    if (r < RES_RICHNESS_FLOOR) continue;
    bonus += r * scarcity[id].sv;
  }
  return Math.min(2.5, bonus);
}

// ── Geographic / chokepoint bonus ──
// The "why this city is here" factor — captures three patterns:
//   • RIVER CONFLUENCE   (two river tiles meeting): inland trade nexus
//                        (St. Louis, Khartoum, Pittsburgh, Lyon — pick any
//                        big inland city, it's almost always on one).
//   • CHOKEPOINT / NECK  (land tile with land on two opposite sides AND
//                        water/impassable on the other two): a pass through
//                        terrain barriers (Constantinople's isthmus,
//                        Panama, mountain passes, river fords).
//   • SHELTERED HARBOUR  (coastal tile with coast on several sides — a bay,
//                        not a straight shoreline): a natural port
//                        (Venice, Boston, San Francisco).
// Computed cheaply over a 3×3 neighbourhood (and 5×5 for the harbour shape).
function geoBonusFor(world, ti, tx, ty) {
  const { tw, th, elev, riverMag } = world;
  let bonus = 0;

  // RIVER CONFLUENCE: this tile is on a river, and a neighbouring tile is on
  // a DIFFERENT river segment. Cheap proxy: this tile has riverMag ≥ 2, and
  // at least 3 of the 8 neighbours also have riverMag ≥ 2 (a confluence has
  // more "river" around it than a straight stretch's 2 neighbours).
  if (riverMag && riverMag[ti] >= 2) {
    let riverNbrs = 0;
    for (let dy = -1; dy <= 1; dy++) {
      const ny = ty + dy;
      if (ny < 0 || ny >= th) continue;
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = ((tx + dx) % tw + tw) % tw;
        if (riverMag[ny * tw + nx] >= 2) riverNbrs++;
      }
    }
    if (riverNbrs >= 3) bonus += 1.5;        // confluence
  }

  // Sample a 3×3 neighbourhood once for the chokepoint + harbour checks.
  let landN = 0, waterN = 0;
  const landBits = [];
  for (let dy = -1; dy <= 1; dy++) {
    const ny = ty + dy;
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) { landBits.push(true); continue; }
      if (ny < 0 || ny >= th) { landBits.push(false); waterN++; continue; }
      const nx = ((tx + dx) % tw + tw) % tw;
      const isLand = elev[ny * tw + nx] > 0;
      landBits.push(isLand);
      if (isLand) landN++; else waterN++;
    }
  }
  // CHOKEPOINT: very land-poor neighbourhood (a thin strip) — 2–4 of 8 neighbours
  // are land. A wide-open plain has all 8; deep ocean has 0; a neck has ~3.
  if (landN >= 2 && landN <= 4 && waterN >= 3) bonus += 1.2;

  // SHELTERED HARBOUR: coast tile (already given +0.4 above) where the coast
  // WRAPS around it — i.e. nearby tiles on several sides are also water.
  // Detected by the same 3×3: 3-5 water neighbours = an indent/bay, not a
  // straight shoreline (which would have ~3-5 water but all on one side).
  // Approximation: if this tile is coastal AND has water on at least two of
  // the four cardinal directions, it's a bay shape.
  if (world.coast && world.coast[ti] && waterN >= 3) {
    // landBits index layout: [NW,N,NE,W,self,E,SW,S,SE] (dy=-1..1, dx=-1..1)
    const N = !landBits[1], S = !landBits[7], W = !landBits[3], E = !landBits[5];
    const cardWater = (N ? 1 : 0) + (S ? 1 : 0) + (W ? 1 : 0) + (E ? 1 : 0);
    if (cardWater >= 2) bonus += 0.8;
  }

  return bonus;
}

// ── Defensibility bonus ──
// The "this site can be HELD" factor — why so many old cities sit on hills,
// river islands, peninsulas and mountain-girt valleys rather than open plain.
// geoBonusFor above captures TRADE geography (confluences, harbours, necks);
// this captures DEFENCE, three classic forms, all cheap from one 3×3 sweep:
//   • COMMANDING GROUND — a local high point (an acropolis / hill-fort): the
//     tile stands above its neighbours while still itself habitable.
//   • NATURAL MOAT      — sea, a great river channel or impassable peaks wrap
//     several sides (a river island, a peninsula, a guarded neck): hard to reach.
//   • MOUNTAIN-BACKED   — at least one impassable neighbour: a flank the enemy
//     cannot turn (a valley town backed against the range).
// Gated by T.SITE_DEFENSE (0 = terrain defence ignored, the old behaviour).
const MOUNTAIN_ELEV = 0.6;   // elev ≥ this is impassable mountain (matches habitable < 0.6 elsewhere)
function defensibilityFor(world, ti, tx, ty) {
  if (T.SITE_DEFENSE <= 0) return 0;
  const { tw, th, elev, riverMag } = world;
  const e0 = elev[ti];
  if (e0 <= 0 || e0 >= MOUNTAIN_ELEV) return 0;        // the site itself must be habitable land
  let sumE = 0, n = 0, moat = 0, mtn = 0;
  for (let dy = -1; dy <= 1; dy++) {
    const ny = ty + dy;
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      if (ny < 0 || ny >= th) { moat++; continue; }    // map edge ≈ open water
      const nx = ((tx + dx) % tw + tw) % tw;
      const ne = elev[ny * tw + nx];
      sumE += ne; n++;
      if (ne <= 0) moat++;                               // sea / lake flank
      else if (ne >= MOUNTAIN_ELEV) { mtn++; moat++; }   // a peak is also a wall
      else if (riverMag && riverMag[ny * tw + nx] >= 3) moat++;  // a great river channel
    }
  }
  let bonus = 0;
  // Commanding ground: the tile rises above its surroundings (an acropolis).
  const prominence = e0 - (n ? sumE / n : e0);
  if (prominence > 0.04) bonus += Math.min(1.2, prominence * 12);
  // Natural moat: water / peaks wrap several sides (island, peninsula, neck).
  if (moat >= 3) bonus += 0.6 + Math.min(0.9, (moat - 3) * 0.3);
  // A mountain-backed flank (a single guarded side already helps).
  if (mtn >= 1) bonus += 0.4;
  return bonus * T.SITE_DEFENSE;
}
// Each pass, every viable parent town that's both population-pressed and off
// cooldown rolls to send a settler party. The party walks up to COLONY_RANGE
// tiles to a viable empty site (picks the best one out of a small sample) and
// founds a daughter joining the parent's realm. Cooldown stops a single town
// from spamming colonies; settler-cost shaves the parent's population so
// expansion has a real demographic cost (you trade headcount for territory).
function maybeSendSettlers(world, alive, devFactor = 1) {
  if (!world.transportDist) return;
  const rng = passRng(world, "settlers");
  // Saturation: colonies get rarer as the map fills, so settlement density
  // plateaus instead of climbing forever (see COLONY_SATURATION_REF).
  const colonySat = 1 / (1 + (alive / COLONY_SATURATION_REF) ** 2);
  for (const parent of world.settlements) {
    if (parent.mode !== "settled") continue;
    if (parent.people < COLONY_MIN_POP) continue;
    if (world.step - (parent._lastColonySent ?? -Infinity) < COLONY_COOLDOWN) continue;
    // Don't expand a realm that can't hold what it already governs. A young
    // colony is an UNSHEDDABLE, SUBSIDISED province (it pays no tribute and
    // draws food + coin for COLONY_SUPPLY_TICKS, and can't secede however
    // over-budget the realm is) — so founding colonies from an already
    // over-extended or insolvent state just deepens the over-stretch and feeds
    // the secession/rebellion churn. Let such a realm consolidate first; only
    // states with real administrative and fiscal slack push out new colonies.
    const c = world.countries && world.countries.get(parent.countryId);
    if (c && c._capacity != null && c._loadTotal != null
        && c._loadTotal > c._capacity * COLONY_HEADROOM) continue;
    const gov = getPolity(world, parent.countryId);
    if (gov && (gov._solvency ?? 1) < COLONY_MIN_SOLVENCY) continue;
    // Pressed: at or near carrying capacity (either food or housing) — the
    // people would otherwise sit at the ceiling. updatePopulation set s._k.
    const k = parent._k || 1;
    if (parent.people / k < COLONY_PRESS_FRAC) continue;
    if (rng() >= COLONY_CHANCE * colonySat * devFactor) continue;
    sendSettlers(world, parent);
  }
}

function sendSettlers(world, parent) {
  // Find a viable empty site within walking range. Score by quality (same
  // ingredients as the random sweep) and pick the best.
  const { tw, th, elev, fert, coast, riverMag } = world;
  const rng = passRng(world, "settlers.site");
  const px = parent.pos.x | 0, py = parent.pos.y | 0;
  let best = null, bestQ = -Infinity;
  for (let i = 0; i < COLONY_CANDIDATES; i++) {
    // Sample a tile in an annulus around the parent: random angle, random
    // radius in [COLONY_MIN_RANGE, COLONY_RANGE].
    const ang = rng() * Math.PI * 2;
    const r = COLONY_MIN_RANGE + rng() * (COLONY_RANGE - COLONY_MIN_RANGE);
    const tx = ((px + Math.round(Math.cos(ang) * r)) % tw + tw) % tw;
    const ty = py + Math.round(Math.sin(ang) * r);
    if (ty < 1 || ty >= th - 1) continue;
    const ti = ty * tw + tx;
    if (!isContinentalLand(world, ti)) continue;
    if (fert[ti] < MIN_FERT) continue;
    // Spacing check against existing settlements (grid-bounded near query —
    // any settled neighbour within MIN_SETT_DIST disqualifies the site).
    let tooClose = false;
    forEachNear(world, tx, ty, MIN_SETT_DIST, () => { tooClose = true; });
    if (tooClose) continue;
    let areaFert = 0;
    for (let dy = -2; dy <= 2; dy++) {
      const ny = ty + dy;
      if (ny < 0 || ny >= th) continue;
      for (let dx = -2; dx <= 2; dx++) {
        const nx = ((tx + dx) % tw + tw) % tw;
        const ni = ny * tw + nx;
        if (elev[ni] > 0) areaFert += fert[ni];
      }
    }
    if (areaFert < MIN_AREA_FERT) continue;
    let q = fert[ti] * 1.5 + Math.min(2.0, areaFert * 0.1);
    if (riverMag && riverMag[ti] >= 2) q += 1.0;
    if (coast && coast[ti]) q += 0.4;
    if (q > bestQ) { bestQ = q; best = { ti, tx, ty }; }
  }
  if (!best) return;
  // Pay the demographic cost: a chunk of the parent's people leaves with
  // them. They take some of the parent's tech (full inheritance — they're
  // literate citizens of the realm, not isolated frontier inventors).
  const settlers = Math.min(COLONY_SEND_CAP, Math.round(parent.people * COLONY_SEND_FRAC));
  if (settlers < 25) return;
  parent.people -= settlers;
  parent._lastColonySent = world.step;
  const inherited = {};
  for (const k of Object.keys(parent.knowledge)) inherited[k] = parent.knowledge[k];
  const daughter = makeSettlement(world, best.tx + 0.5, best.ty + 0.5, {
    people: settlers,
    knowledge: inherited,
    parentId: parent.id,
    countryId: parent.countryId,                   // joins the parent's realm immediately
    kind: "settlers",
    cultureId: dominantCulture(parent),
  });
  gridAdd(world, daughter);   // register for same-pass spacing queries
}

// ── Urban genesis (mode #2): a farming region BIRTHS a town ───────────
// A tier-0 farming region is a collection of villages, not a proto-city, so it
// never urbanises in place (updateTier returns early for tier 0). Instead, once
// a region has filled out on its OWN land — a mature, surplus-producing rural
// district — and no town yet serves its catchment, ONE of its villages thickens
// into a market town: a NEW tier-1 settlement spawned a short walk away, seeded
// with a village's worth of the region's people. The region carries on as the
// rural hinterland around it, shipping its grain surplus up to the new town
// (foodHierarchy.js), which grows on that surplus into a city and, in time, a
// metropolis. One market town per catchment keeps towns appropriately sparse
// over the many villages — the historical settlement pyramid.
//
// TRADE-NODE / FORTRESS birth: a town doesn't only grow out of rich FARMLAND. A
// brilliant TRADE site (a river confluence, a sheltered harbour, a pass) or a
// commanding DEFENSIVE site (a hill, a river island, a mountain-girt neck) drew
// a town even on poor soil — it lived on commerce or as a stronghold, importing
// its grain (Venice, a caravan city, a hill-fort capital). So the population a
// region needs to spin off a town is DISCOUNTED by the best nearby site's
// trade+defence value: a great site nucleates a town from a far smaller district.
const URBANIZE_POP         = 180;  // people a region needs to spin off a town on PLAIN ground (~0.6 of the rural cap URBAN_CAP=300)
const URBAN_MIN_POP        = 90;   // ...but never fewer than this — a town must seed a viable founding population from the region
const URBAN_SITE_DISCOUNT  = 25;   // each point of a site's trade+defence value lowers the population bar by this much (a brilliant site needs little farmland)
const URBAN_CATCHMENT      = 10;   // one market town per ~10-tile cluster — dense enough for a proper many-towns pyramid (16 suppressed neighbours over too wide an area)
const URBAN_CHECK_INTERVAL = 120;  // ticks between genesis rolls (multiple of CRYSTAL_INTERVAL=24)
const URBAN_CHANCE         = 0.40; // probability an eligible region births a town on a roll
const URBAN_SPACING        = 5;    // a founding town may sit this close to other settlements — the dense countryside packs ~8-10 apart, so MIN_SETT_DIST=8 left no room to plant one
const URBAN_MIN_RANGE      = 5;    // candidate ring inner radius (just clear of the region's own node)
const URBAN_RANGE          = 12;   // ...outer radius — within the region's catchment, a day's walk to market
const URBAN_CANDIDATES     = 12;   // nearby sites sampled; the best (river/coast/fertile) wins
const URBAN_SEED_FRAC      = 0.30; // share of the region's people that move into the founding town
const URBAN_SEED_CAP       = 70;   // ...capped so the region isn't gutted — it stays the rural hinterland
const URBAN_SEED_MIN       = 25;   // a founding town smaller than this isn't viable — skip the roll

function maybeUrbanGenesis(world) {
  const { tw, th, fert, coast, riverMag } = world;
  const rng = passRng(world, "urban");
  for (const region of world.settlements) {
    if (region.mode !== "settled") continue;
    if ((region.tier | 0) !== 0) continue;                 // only rural regions birth towns
    if (region.people < URBAN_MIN_POP) continue;           // cheap floor: too small to seed any town (the site discount can't go below this)
    // One market town per catchment: skip if an urban node already serves nearby.
    let served = false;
    forEachNear(world, region.pos.x, region.pos.y, URBAN_CATCHMENT, (s) => { if ((s.tier | 0) >= 1) served = true; });
    if (served) continue;
    // Pick the best nearby site within the catchment — a ford, a harbour, a hill,
    // the richest farmland edge — where a village would thicken into a market or a
    // stronghold. Track its TRADE+DEFENCE value separately (siteVal): that, not
    // fertility, is what lets a brilliant site nucleate a town on poor soil.
    const px = region.pos.x | 0, py = region.pos.y | 0;
    let best = null, bestQ = -Infinity, bestSV = 0;
    for (let i = 0; i < URBAN_CANDIDATES; i++) {
      const ang = rng() * Math.PI * 2;
      const r = URBAN_MIN_RANGE + rng() * (URBAN_RANGE - URBAN_MIN_RANGE);
      const tx = ((px + Math.round(Math.cos(ang) * r)) % tw + tw) % tw;
      const ty = py + Math.round(Math.sin(ang) * r);
      if (ty < 1 || ty >= th - 1) continue;
      const ti = ty * tw + tx;
      if (!isContinentalLand(world, ti)) continue;
      // Spacing: don't plant on top of another settlement (a looser floor than
      // the colony rule — a market town belongs INSIDE its dense countryside).
      let tooClose = false;
      forEachNear(world, tx, ty, URBAN_SPACING, () => { tooClose = true; });
      if (tooClose) continue;
      // Trade + defence value of the site (commerce/stronghold potential).
      const siteVal = geoBonusFor(world, ti, tx, ty) + defensibilityFor(world, ti, tx, ty)
        + ((riverMag && riverMag[ti] >= 2) ? 1.2 : 0)   // river: a ford / quay
        + ((coast && coast[ti]) ? 0.8 : 0);             // a harbour
      const q = (fert[ti] || 0) * 1.5 + siteVal;        // overall site pick still weighs farmland
      if (q > bestQ) { bestQ = q; best = { tx, ty }; bestSV = siteVal; }
    }
    if (!best) continue;
    // A great trade/defence site lowers the population a region needs to spin off
    // a town (it lives on commerce or as a stronghold, importing its grain).
    const need = Math.max(URBAN_MIN_POP, URBANIZE_POP - bestSV * URBAN_SITE_DISCOUNT);
    if (region.people < need) continue;
    if (rng() >= URBAN_CHANCE) continue;
    // Seed the town with a village's worth of the region's people; the region
    // continues, slightly reduced, as the surrounding rural hinterland.
    const seed = Math.min(URBAN_SEED_CAP, Math.round(region.people * URBAN_SEED_FRAC));
    if (seed < URBAN_SEED_MIN) continue;
    region.people -= seed;
    const inherited = {};
    for (const k of Object.keys(region.knowledge)) inherited[k] = region.knowledge[k];
    const town = makeSettlement(world, best.tx + 0.5, best.ty + 0.5, {
      people: seed,
      tier: 1,                                  // born URBAN — a market town, not a village
      knowledge: inherited,
      parentId: region.id,
      countryId: region.countryId,              // joins its hinterland's realm
      kind: "town",
      cultureId: dominantCulture(region),
    });
    gridAdd(world, town);   // register so same-pass spacing / catchment checks see it
  }
}

// Pick the nearest settlement (by straight-line distance, cheap), then
// blend its knowledge with a baseline based on how isolated this site
// is in transport terms. Settlements that crystallise right next to a
// city inherit most of its tech; isolated cradles start near baseline.
function inheritKnowledgeAt(world, ti, td) {
  world._lastInheritDonor = null;
  const { tw } = world;
  const ty = (ti / tw) | 0, tx = ti - ty * tw;
  let nearest = null, bestD2 = Infinity;
  // Fast path via the spatial grid: the nearest settlement within a generous
  // radius IS the global nearest (nothing closer can exist outside the disk).
  // Only when the disk is empty (a genuinely isolated spawn) do we fall back to
  // the full O(settlements) scan — so this is behaviour-identical, just cheaper.
  forEachNear(world, tx, ty, INHERIT_NEAR_RADIUS, (s, d2) => {
    if (d2 < bestD2) { bestD2 = d2; nearest = s; }
  });
  if (!nearest) {
    for (const s of world.settlements) {
      if (s.mode !== "settled") continue;
      let dx = Math.abs(s.pos.x - tx);
      if (dx > tw / 2) dx = tw - dx;
      const dy = s.pos.y - ty;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) { bestD2 = d2; nearest = s; }
    }
  }
  // Baseline neolithic knowledge for independent invention. Just the six
  // surviving tracks after the merge (foraging→agriculture,
  // toolmaking→construction, literacy→organization). Metallurgy,
  // navigation, and mobility stay at zero — they're resource-gated and
  // only kick in once the site touches ore / water / horses.
  const baseline = {
    agriculture: 0.45,
    construction: 0.1,
    organization: 0.1,
  };
  world._lastInheritDonor = nearest;   // culture rides the same lineage (caller reads this)
  if (!nearest) return baseline;
  // Inheritance fraction by transport distance: 90 % at td=0, 30 % at
  // td=60, ~5 % far away. Distant sites mostly invent on their own.
  const inheritFrac = isFinite(td) ? Math.max(0.05, Math.exp(-td / 50)) : 0.05;
  const out = {};
  for (const k of Object.keys(baseline)) {
    const parentVal = nearest.knowledge[k] || baseline[k];
    out[k] = baseline[k] * (1 - inheritFrac) + parentVal * inheritFrac;
  }
  return out;
}

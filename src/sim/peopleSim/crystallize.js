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
import { makeSettlement, dominantAnc, livestockClimate } from "./settlement.js";
import { tileOpenness } from "./transport.js";
import { getPolity } from "./entities.js";
import { dominantCulture, foundCulture, seedCulture, nameFor, ancestryCulture } from "./cultures.js";
import { passRng } from "./rng.js";
import { computeTransport } from "./transport.js";
import { forEachNear, gridAdd } from "./spatialGrid.js";
import { grownLiveOwnerAt } from "./countryClaim.js";
import { T, rNormPop } from "./tuning.js";
import { settleHostility } from "./habitability.js";

const CRYSTAL_INTERVAL          = 24;     // sweep more often (was 32)
const TRANSPORT_REFRESH_TICKS   = 480;    // transport map is a global O(map) flood — a
                                          // frame spike at high speed; it drives only spawn
                                          // weighting and drifts slowly, so refresh rarely
const CANDIDATES_PER_SWEEP      = 120;    // wider net per sweep (was 80)
const FLOOD_SAMPLE_FRAC         = 0.4;    // share of sweep candidates drawn from the arid-river FLOODPLAIN tile list directly — a thin ribbon is almost never hit by the uniform random sweep, so the Nile/Indus valley would stay empty otherwise
const FLOOD_SPACING_MUL         = 0.75;   // floodplain packs somewhat denser than ordinary land (a watered valley held more villages) — but only ×0.75, NOT the ×0.5 first tried: combined with the base-floor exemption below, ×0.5 gave a ~2-tile chain that over-packed the rivers (≈55% of ALL settlements crowded onto the ~1% floodplain — a stiff bead-string look). ×0.75 (≈3-tile spacing) keeps the valley a modest chain, not a lone cradle, while pulling the floodplain share back to ~45%.

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
const PASTURE_SITE_W            = 0.9;    // site value of PEAK herding country ≈ middling rain-fed cropland (f≈0.55 worth) — the steppe fed real peoples off the herd, an order below the river valleys
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
const SOFT_DIST                 = 10;         // beyond this, the spacing factor is 1 (no penalty) — tighter so villages pack denser
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
// ── Resolution-invariant spacing (T.RES_INVARIANT_POP — Phase 1 of ─────
// docs/resolution-invariance-plan.md). Every founding-spacing rule in this file
// is calibrated in TILES at the 480-wide reference grid. On any other grid a
// fixed tile gap is a DIFFERENT real distance, so settlement density — and
// through it total population — silently scales with the pixel count (measured:
// ~2.1× total pop per 2× resolution at matched development; the full-Earth
// 18-billion-at-Medieval artefact). rNorm converts each spacing back to constant
// REAL distance: ×1 at the reference (byte-identical by construction), ×4 at the
// 1920-pixel full Earth, ×0.67 at the 320-pixel probe grid — the same convention
// territory reach / sea range / knowledge diffusion already use (resScaleFor).
// NB world.tw is the SIM TILE grid — half the requested pixel width (the app and
// tools/_harness run tileRes 2) — so the reference is 240 TILES (= the calibrated
// 480-pixel world), the very same RES_REF_W countryTerritory.js normalises reach
// against. This closes the DENSITY half of that inconsistency; the catchment-area /
// per-tile-yield half lives in territory.js + settlement.js (Phase 2). The shared
// factor is tuning.js rNormPop. Lever off ⇒ exactly 1.
const rNormFor = rNormPop;
// ── Density ∝ carrying capacity ───────────────────────────────────────
// Without this, spacing was a fixed distance, so EVERY habitable tile filled
// to the same settlement density — the low-capacity wet tropics (Congo, the
// Amazon) and marginal frontier packed as tightly as the fertile Nile, giving
// a uniform wall-to-wall patchwork. Real settlement density tracked the land's
// carrying capacity: dense villages in fertile river valleys, a thin sparse
// scatter across rainforest, steppe and outback. So spacing now SCALES with the
// tile's own fertility — which already encodes the right contrast, because the
// alluvial boost lifts a fertile river-in-desert (the Nile, fert→1, stays dense)
// but barely touches a river in already-wet rainforest (Congo, fert→0.2, goes
// sparse). capacitySpacingMul: 1 at a lush site (FERT_REF+), up to 1+SPARSE_SPREAD
// on barren land — which spaces settlements (1+SPARSE_SPREAD)× farther apart, so
// ~1/(1+SPARSE_SPREAD)² the density.
const CAP_FERT_REF              = 0.5;   // fertility at/above which a site packs at full density
const SPARSE_SPREAD             = 1.5;   // barren land spaces up to this many × farther apart
// Habitability HOSTILITY at a tile — mirrors the brakes in settlement.js. The
// disease-ridden tropics AND the tsetse savanna AND the hot rain-fed Sahel all
// held SETTLEMENT density far below what raw fertility implied, so they end a thin
// scatter, not a dense web (habitability.js settleHostility). riverAcc is
// approximated from the river-magnitude field so a managed river escapes aridity.
function hostilityAt(world, ti) {
  const t = world.temp[ti]  ?? 0.5, m = world.moist[ti] ?? 0.5;
  const riverAcc = (world.riverMag && world.riverMag[ti] >= 2) ? 0.4 : 0;
  return settleHostility(t, m, riverAcc);
}
function capacitySpacingMul(fertTile, hostility) {
  // Hostility discounts EFFECTIVE fertility for spacing — geometric spacing is the
  // one density lever the global productivity anchor (index.js _eraProd) can't
  // wash out (it scales food, not how far apart villages sit). So this, not the
  // carrying-capacity drag, is what actually thins harsh land on the map.
  const effFert = fertTile * (1 - T.TROPIC_SPARSE * (hostility || 0));
  const capNorm = Math.min(1, Math.max(0, effFert / CAP_FERT_REF));
  return 1 + SPARSE_SPREAD * (1 - capNorm);
}
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
// FRONTIER EXTENSION vs TELEPORT: a village crystallising in WILDERNESS (a tile no
// realm's border has reached, region<0) joins the realm of the settlement it springs
// from — but ONLY if that settlement is within a frontier HOP. Without this bound the
// donor could be up to INDEPENDENT_DIST (185) of travel away, so the sweep dropped
// tech-naked villages FAR out in open country that snapped to a distant nation — a
// "wave of no-tech settlements in isolated wilderness" detached from the realm they
// flew the flag of. Beyond this hop a wilderness candidate simply doesn't found here;
// longer jumps into virgin land are the job of colony parties (maybeSendSettlers),
// which carry full tech and pick a bounded site. ABSOLUTE tiles (NOT res-scaled):
// settlement spacing itself is absolute at every resolution, so a frontier extension is
// ~one spacing from the donor on any map — the detached-exclave gaps this guards against
// are absolute, not a fraction of the world (a res-scaled bound let 40-tile exclaves
// through on the full-res map). CALIBRATED TO THE SPACING MODEL: it must be at least the
// MAXIMUM natural spacing — barren land spaces settlements MIN_SETT_DIST·(1+SPARSE_SPREAD)
// = 20 tiles apart (capacitySpacingMul) — or a realm on marginal land can't reach its OWN
// next village at its natural density and is frozen at a handful of settlements while
// fertile river valleys (8-tile spacing) chain freely: the "river nations vast, everyone
// else 4-7" divide. So set it one spacing PAST the barren maximum: contiguous frontier
// extension works on every terrain at its own density, while true teleports are still cut.
const FRONTIER_EXTEND_DIST      = MIN_SETT_DIST * (1 + SPARSE_SPREAD) + MIN_SETT_DIST;   // 20 (barren spacing) + 8 (one hop) = 28
// A MOUNTED people's frontier reaches farther over OPEN country: to riders the
// grass is a highway (transport.js tileOpenness — same openness the cost core
// discounts), so the wave of advance that walks tile-by-tile through forest
// LEAPS across steppe. At full mobility over fully open ground the extension
// triples — a day's ride against a day's walk — which is what lets herding
// peoples actually fill the steppe (the Yamnaya pattern) instead of the wave
// stalling at the grass line for want of a donor within foot range.
const RIDE_EXTEND               = 2;
// A rode-away camp is born only on genuine steppe — the same "dry, open, too
// poor to farm" test the nomad classifier uses (conquest.js NOMAD_FERT_MAX /
// NOMAD_OPEN_MIN) — so the stateless-birth exemption can't leak into ordinary
// open scrub off a mounted farm realm's frontier.
const RIDE_AWAY_FERT_MAX        = 0.35;
const RIDE_AWAY_OPEN_MIN        = 0.5;
// A frontier village born INTO a realm shares that realm's DEVELOPMENT (its roads,
// crops, administration, craft all diffuse to the new settlement), so it is never a
// stone-age speck inside a developed empire. Floor its inherited knowledge at this
// fraction of the realm's (capital's) level. Emergent — keyed on the nation's actual
// development, never a date/era.
const NATION_TECH_FLOOR         = 0.5;
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
// Colonisation slows as the FRONTIER AROUND A TOWN fills — a LOCAL density guard, not
// a global one. A town on the edge of an empty continent has few neighbours and colonises
// freely (its settler parties roll inland — how Russia took Siberia, the US the plains);
// a town in a packed heartland is throttled (no infill churn). The old global guard
// (1/(1+(total alive/REF)²)) wrongly froze NEW-WORLD frontiers the moment the OLD WORLD
// filled — colonies stalled at their landing point because the planet's total count, not
// the empty land next to them, set the brake. Local density is also the more emergent
// gate: settlement spreads where there is room, regardless of how full elsewhere is.
const FRONTIER_RADIUS         = 28;    // tiles around a parent that count as its "local" neighbourhood (~one colony hop)
const COLONY_LOCAL_SAT_REF    = 8;     // local neighbours within FRONTIER_RADIUS at which the send-chance halves

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
// Coverage tempo (pioneerTempo below): the habitable world starts a SPARSE
// frontier and fills in gradually over the developmental arc, instead of
// saturating at once. Ungated, crystallisation+colonisation grabbed all the
// easy terrain by the classical era and then sat static.
const COVERAGE_FLOOR = 0.22;   // pre-agricultural (forager-margin) spread rate, as a fraction of full
// The neolithic package a fresh independent village invents on its own —
// shared with inheritKnowledgeAt's baseline so the tempo and the inherited
// knowledge describe the same starting point.
const NEOLITHIC_AGRI = 0.45;
// Wave-of-advance pioneering tempo (replaces the old COVERAGE_RAMP step
// clock, a cardinal-rule-1 violation: it let the wilderness recede because
// of WHEN it was, not what the world had become). The real cause of slow
// early spread is that pioneers can only settle as fast as their FARMING
// CAPABILITY sustains new villages (the demic "wave of advance"): tempo
// rises from the forager floor to full as the relevant people's agriculture
// matures from the neolithic baseline to the maturity point the food model
// already defines (T.AGRI_FULL_AT). Purely local state — a stalled
// stone-age region keeps a sparse frontier forever, a precocious cradle
// fills its valley early, a colonised coast spreads at the colonists' own
// tempo — self-calibrating on any map, seed, or pace.
const pioneerTempo = (agri) => {
  const span = Math.max(0.05, T.AGRI_FULL_AT - NEOLITHIC_AGRI);   // T always carries the schema default
  const dev = Math.min(1, Math.max(0, ((agri || 0) - NEOLITHIC_AGRI) / span));
  return COVERAGE_FLOOR + (1 - COVERAGE_FLOOR) * dev;
};
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
  // Rate passes stretch their cadence with granularity (index.js convention),
  // so settler parties and town genesis fire at the same HISTORY rate at any G.
  const _ivlG = (base) => Math.max(1, Math.round(base * (T.SIM_GRANULARITY || 1)));
  if (world.step % _ivlG(COLONY_CHECK_INTERVAL) === 0) maybeSendSettlers(world, _alive);

  // Urban genesis: a mature farming region births a TOWN within its catchment
  // (the rural→urban transition is a spawn, not an in-place relabel). Gated at a
  // multiple of CRYSTAL_INTERVAL so it actually fires past the early return above.
  if (world.step % _ivlG(URBAN_CHECK_INTERVAL) === 0) maybeUrbanGenesis(world);

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
  const spMul = T.LOCALITY_MODE ? Math.max(1, T.LOCALITY_SPACING || 3)
              : T.DISSOLVE_FARMS ? 2     // tuned: fewer/larger town-regions, but keeping a rural town layer so urbanisation stays realistic (~60%)
              : 1;
  const rn = rNormFor(world);            // spacing in REAL distance, not tiles (RES_INVARIANT_POP)
  const hardFloor   = HARD_FLOOR * spMul * rn;
  const softDist    = SOFT_DIST  * spMul * rn;
  const floodTiles = world._floodTiles, nFlood = floodTiles ? floodTiles.length : 0;
  for (let i = 0; i < CANDIDATES_PER_SWEEP; i++) {
    // Draw a share of candidates straight from the FLOODPLAIN ribbon so the arid
    // river valley actually fills — the uniform random sweep almost never lands on
    // a 1–5-tile-wide strip, which is why the Nile stayed empty despite being prime
    // cropland. Everything downstream (river magnet, spacing, quality) is unchanged.
    const ti = (nFlood && rng() < FLOOD_SAMPLE_FRAC) ? floodTiles[rng.int(nFlood)] : rng.int(N);
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
    // Capacity-scaled spacing: a low-fertility site demands more elbow room,
    // so marginal land (rainforest, steppe, outback) ends up a sparse scatter
    // while fertile valleys pack tight.
    const capSp = capacitySpacingMul(f, hostilityAt(world, ty * world.tw + tx));
    const onFlood = !!(world.tFlood && world.tFlood[ti]);
    // The irrigated floodplain was a near-continuous chain of villages — denser than
    // the farming-region abstraction assumes — so its spacing comes off the BASE floor,
    // NOT the DISSOLVE/LOCALITY-doubled one (spMul), then FLOOD_SPACING_MUL packs it
    // tighter still. Without the exemption spMul exactly cancels the dense-pack intent,
    // leaving the floodplain at ordinary density (the Nile/Indus stayed a lone cradle).
    const floodSp = onFlood ? FLOOD_SPACING_MUL : 1;
    const baseFloor = onFlood ? HARD_FLOOR * rn : hardFloor;
    const baseSoft  = onFlood ? SOFT_DIST  * rn : softDist;
    const hf = baseFloor * capSp * floodSp, sd = baseSoft * capSp * floodSp;
    if (nearestSq < hf * hf) continue;             // hard reject — overlap
    // Linear ramp between hf and sd on actual distance (not squared, so it
    // grows steeply near the floor and flattens out near the soft boundary —
    // matches the "very close = bad, modest distance = mostly fine" pattern).
    let spacingFactor = 1;
    if (nearestSq < sd * sd) {
      const d = Math.sqrt(nearestSq);
      spacingFactor = (d - hf) / (sd - hf);
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
    // PASTORAL PULL: open grassland converts to calories through the HERD — the
    // same livestockClimate suitability the food model feeds herders by
    // (settlement.js pastoral channel), times how open the country is
    // (transport.js tileOpenness). Without this term a site's food potential
    // was purely ARABLE, so the steppe scored near-zero and never founded the
    // settlements its pastoral calories could actually feed — no steppe
    // peoples, no hordes, on any map. Weighted so PEAK herding country scores
    // like middling rain-fed cropland: the steppe carried real populations,
    // but an order below the river valleys (which keep their ×6 magnet).
    // Gated by the SAME domesticate-availability ceiling the food model applies
    // to pastoral calories (settlement.js s._livestock = livestockClimate ×
    // world._agriCeil): on an isolated continent or a tsetse belt where the
    // ceiling is ~0, no large herds → the herd calories the site would be scored
    // on are never delivered, so the site must not be scored for them either
    // (else hamlets crystallise onto grass that cannot feed them).
    const agriCeil = world._agriCeil ? (world._agriCeil[ti] || 0) : 1;
    const pasture = livestockClimate(world.temp[ti], world.moist[ti]) * tileOpenness(world, ti) * agriCeil;
    const fertilityScore = 0.4 + f * 1.5 + Math.min(2.0, areaFert * 0.1) + pasture * PASTURE_SITE_W;
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
    const p = quality * (diffusionMul + independent) * BASE_RATE * saturationDamper * spacingFactor * marketFactor * (world._dt || 1);   // granularity: per-tick settling odds scale with the time-step

    // One draw per candidate (stream-stable), tested twice: first against the
    // full-tempo probability (cheap reject), then against the wave-of-advance
    // tempo of the nearest people — the frontier advances at the pace of the
    // farming capability actually arriving at it. No donor in the disk = a
    // genuinely isolated site = forager-floor pace.
    const _r = rng();
    if (_r >= p) continue;
    // One nearest-donor lookup, shared: the tempo gate reads its agriculture
    // and, on accept, the SAME donor seeds inheritance (passing it as a hint
    // avoids a second identical grid scan, and guarantees tempo and inherited
    // knowledge describe the same people).
    let _donor = null, _bd2 = Infinity;
    forEachNear(world, tx, ty, INHERIT_NEAR_RADIUS, (s, d2) => {
      if (d2 < _bd2) { _bd2 = d2; _donor = s; }
    });
    const _donorAgri = _donor && _donor.knowledge ? (_donor.knowledge.agriculture || NEOLITHIC_AGRI) : NEOLITHIC_AGRI;
    if (_r >= p * pioneerTempo(_donorAgri)) continue;
    { // ── accepted: found the settlement (block kept to avoid a 100-line reindent; no semantic scope) ──
      // Inherited knowledge: blend from nearest settlement, weighted by
      // distance. Far sites start near baseline neolithic knowledge.
      const inherited = inheritKnowledgeAt(world, ti, td, _donor);
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
      const region = grownLiveOwnerAt(world, ti);
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
      // Found settlements only INSIDE a nation or as a nation's FRONTIER EXTENSION —
      // never a stateless hamlet in the deep wilderness. A candidate is allowed if
      // the tile already lies in a realm's drawn border (region ≥ 0), OR it is a
      // CONNECTED extension of a nearby realm settlement (the donor), in which case
      // it joins that realm and grows its frontier. A DISCONNECTED site (independent
      // origin: another continent, across water, beyond reach) has no nation to join,
      // so it is NOT founded — only a colony party (maybeSendSettlers, carrying its
      // parent's flag) can plant the first settlement on virgin land. Cradles are
      // seeded at world-gen, so the world still bootstraps. (Existing settlements may
      // still become stateless when their realm collapses — a separate path.)
      const donorCountry = connected && donor && donor.mode === "settled" ? donor.countryId : -1;
      let joinCountry = region >= 0 ? region : donorCountry;
      let rodeAway = false;
      // Wilderness founding (region<0) must be a CONTIGUOUS frontier extension of the
      // donor's realm, not a detached tech-less exclave far out in the wild (see
      // FRONTIER_EXTEND_DIST). On the realm's OWN claimed land (region>=0) this doesn't
      // apply — that ground is already the nation's.
      if (region < 0 && donor) {
        let ddx = Math.abs(donor.pos.x - (tx + 0.5)); if (ddx > tw / 2) ddx = tw - ddx;
        const ddy = donor.pos.y - (ty + 0.5);
        const dd2 = ddx * ddx + ddy * ddy;
        // Mounted donors extend far over open country (see RIDE_EXTEND).
        const ride = 1 + RIDE_EXTEND * ((donor.knowledge && donor.knowledge.mobility) || 0) * tileOpenness(world, ti);
        const fed = FRONTIER_EXTEND_DIST * rn;   // frontier reach in REAL distance (RES_INVARIANT_POP)
        const lim = fed * ride;
        if (dd2 > lim * lim) continue;
        // Beyond the FOOT frontier — ground only the RIDE made reachable — the
        // camp is not an administered extension of the donor's realm: it is kin
        // who RODE AWAY. The donor's court projects nothing three days' ride
        // into the open grass, so the camp is born STATELESS and founds (or
        // joins) a steppe polity when it matures — adoptAndFound's wilderness
        // path, the same one collapsed realms' orphans use. This is how the
        // steppe gets its OWN peoples instead of every camp flying the flag of
        // a farming court that has never seen it. Two gates keep it honest:
        //   • RIDABLE ground — the donor must be reachable overland (isFinite td),
        //     so a rider cannot "ride away" across a strait or an impassable wall
        //     and mint a fresh people on a landmass only ships reach.
        //   • genuine STEPPE — dry, open, unfarmable (the classifier's own test):
        //     without it any high-mobility FARM realm (mobility rises everywhere
        //     via diffusion) would spray stateless camps into ordinary open scrub,
        //     the detached-exclave confetti the never-stateless rule exists to kill.
        if (dd2 > fed * fed
            && isFinite(td)
            && (world.fert[ti] || 0) < RIDE_AWAY_FERT_MAX
            && tileOpenness(world, ti) >= RIDE_AWAY_OPEN_MIN) { rodeAway = true; joinCountry = -1; }
        // Past the foot ring but NOT genuine ridable steppe → not a frontier
        // extension the court can hold, and not a horde birth → no settlement.
        if (dd2 > fed * fed && !rodeAway) continue;
      }
      if (joinCountry < 0 && !rodeAway) continue;
      // Share the joining realm's development: floor the (distance-decayed) inherited
      // knowledge at NATION_TECH_FLOOR of the realm's capital, so a frontier village of
      // a developed empire is born developed, not neolithic. Cloned so we never mutate
      // inheritKnowledgeAt's shared baseline object.
      const bornKnow = { ...inherited };
      const jc = world.countries && world.countries.get(joinCountry);
      if (jc && jc.capital && jc.capital.knowledge) {
        const nk = jc.capital.knowledge;
        for (const kk in bornKnow) { const fl = NATION_TECH_FLOOR * (nk[kk] || 0); if (fl > bornKnow[kk]) bornKnow[kk] = fl; }
      }
      const born = makeSettlement(world, tx + 0.5, ty + 0.5, {
        people: 18 + (rng.int(8)),
        knowledge: bornKnow,
        countryId: joinCountry,   // born into the realm it sits in / extends — stateless (-1) only for a rode-away steppe camp
        parentId: donor.id,   // carries the donor's ancestry; a long jump admixes with the local substrate
        // near spread keeps the donor's people; otherwise we assign below
        cultureId: (connected && !isBranch) ? dCul : -1,
        tier: T.DISSOLVE_FARMS ? 1 : 0,   // DISSOLVE: there are no farming regions — new settlements are towns
      });
      gridAdd(world, born);   // same-pass candidates must see (and space off) it
      // Whose PEOPLE is this? Anchored to the DEEP ANCESTRY of the ground, not to whoever
      // colonised nearby first. If the local stock differs from the donor people's stock, the
      // settlement crystallised among a DIFFERENT people — it roots in that local ancestry (its
      // own family/tongue/gods), so the cradle peoples don't flood the world; only their
      // CIVILISATION diffuses across (the bootload). Same stock → the donor people genuinely
      // extends onto its own ground.
      const localAnc = world.ancestry ? world.ancestry[ti] : -1;
      const foreignSoil = connected && localAnc >= 0 && donor && localAnc !== dominantAnc(donor);
      if (!connected) {
        const cul = foundCulture(world, { origin: born });          // independent root: own family, language, gods
        seedCulture(world, born, cul.id);
        born.name = nameFor(world, cul, "settlement");
      } else if (foreignSoil) {
        const cul = ancestryCulture(world, localAnc, born);         // the LOCAL people of this stock
        seedCulture(world, born, cul.id);
        born.cultureId = cul.id;
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
// How strongly a busy trade road pulls new settlement onto it. Kept MODEST: at
// the old 1.5 it rivalled the fertility score, so towns bunched along the road
// network (and on the margin just outside an existing cluster's spacing) instead
// of spreading into open good cropland. Now it's a tiebreaker that nudges a town
// toward a trade artery, not the dominant siting force.
const BUSY_ROAD_MAX_BONUS = 0.5;
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
function maybeSendSettlers(world, alive) {
  if (!world.transportDist) return;
  const rng = passRng(world, "settlers");
  for (const parent of world.settlements) {
    if (parent.mode !== "settled") continue;
    if (parent.people < COLONY_MIN_POP) continue;
    if (world.step - (parent._lastColonySent ?? -Infinity) < COLONY_COOLDOWN / (world._dt || 1)) continue;
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
    // Pressed: at or near carrying capacity (either food or housing) — the
    // people would otherwise sit at the ceiling. updatePopulation set s._k.
    const k = parent._k || 1;
    if (parent.people / k < COLONY_PRESS_FRAC) continue;
    // LOCAL saturation: count settled neighbours within a frontier radius (discounting the
    // parent itself). A frontier town with empty land around it colonises at near-full
    // chance; a town hemmed in by a dense cluster is throttled — settlement spreads into
    // room wherever it is, instead of stalling GLOBALLY once the cradles fill (the old
    // total-count guard wrongly froze a New-World frontier the moment the Old World filled).
    let localN = -1;
    forEachNear(world, parent.pos.x, parent.pos.y, FRONTIER_RADIUS, () => { localN++; });
    const colonySat = 1 / (1 + (Math.max(0, localN) / COLONY_LOCAL_SAT_REF) ** 2);
    // Wave-of-advance tempo from the PARENT's own agriculture: a mature
    // farming people colonises at full rate, a marginal one trickles.
    if (rng() >= COLONY_CHANCE * colonySat * pioneerTempo(parent.knowledge && parent.knowledge.agriculture)) continue;
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
    // radius in [COLONY_MIN_RANGE, COLONY_RANGE] — in REAL distance (the rng
    // draws are identical either way; RES_INVARIANT_POP only scales the radius).
    const ang = rng() * Math.PI * 2;
    const r = (COLONY_MIN_RANGE + rng() * (COLONY_RANGE - COLONY_MIN_RANGE)) * rNormFor(world);
    const tx = ((px + Math.round(Math.cos(ang) * r)) % tw + tw) % tw;
    const ty = py + Math.round(Math.sin(ang) * r);
    if (ty < 1 || ty >= th - 1) continue;
    const ti = ty * tw + tx;
    if (!isContinentalLand(world, ti)) continue;
    if (fert[ti] < MIN_FERT) continue;
    // Spacing check against existing settlements (grid-bounded near query — any
    // settled neighbour within the capacity-scaled spacing disqualifies the
    // site, so low-fertility frontier spreads its colonies far thinner).
    const spacing = MIN_SETT_DIST * rNormFor(world) * capacitySpacingMul(fert[ti], hostilityAt(world, ti));
    let tooClose = false;
    forEachNear(world, tx, ty, spacing, () => { tooClose = true; });
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
    tier: T.DISSOLVE_FARMS ? 1 : 0,   // DISSOLVE: colonies are towns too — never mint a tier-0 region
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
  if (T.DISSOLVE_FARMS) return;   // no tier-0 regions to birth towns from — towns grow/promote in place
  const { tw, th, fert, coast, riverMag } = world;
  const rng = passRng(world, "urban");
  for (const region of world.settlements) {
    if (region.mode !== "settled") continue;
    if ((region.tier | 0) !== 0) continue;                 // only rural regions birth towns
    if (region.people < URBAN_MIN_POP) continue;           // cheap floor: too small to seed any town (the site discount can't go below this)
    // One market town per catchment: skip if an urban node already serves nearby.
    let served = false;
    forEachNear(world, region.pos.x, region.pos.y, URBAN_CATCHMENT * rNormFor(world), (s) => { if ((s.tier | 0) >= 1) served = true; });
    if (served) continue;
    // Pick the best nearby site within the catchment — a ford, a harbour, a hill,
    // the richest farmland edge — where a village would thicken into a market or a
    // stronghold. Track its TRADE+DEFENCE value separately (siteVal): that, not
    // fertility, is what lets a brilliant site nucleate a town on poor soil.
    const px = region.pos.x | 0, py = region.pos.y | 0;
    let best = null, bestQ = -Infinity, bestSV = 0;
    for (let i = 0; i < URBAN_CANDIDATES; i++) {
      const ang = rng() * Math.PI * 2;
      const r = (URBAN_MIN_RANGE + rng() * (URBAN_RANGE - URBAN_MIN_RANGE)) * rNormFor(world);   // real-distance annulus (RES_INVARIANT_POP)
      const tx = ((px + Math.round(Math.cos(ang) * r)) % tw + tw) % tw;
      const ty = py + Math.round(Math.sin(ang) * r);
      if (ty < 1 || ty >= th - 1) continue;
      const ti = ty * tw + tx;
      if (!isContinentalLand(world, ti)) continue;
      // Spacing: don't plant on top of another settlement (a looser floor than
      // the colony rule — a market town belongs INSIDE its dense countryside).
      let tooClose = false;
      forEachNear(world, tx, ty, URBAN_SPACING * rNormFor(world), () => { tooClose = true; });
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
    // a town (it lives on commerce or as a stronghold, importing its grain). A
    // country's CAPITAL needs only a viable founding population: a state's seat
    // founds its capital town as soon as it can (the court then relocates to it,
    // below), so the realm's seat stops sitting as a farming region.
    const need = (region._isCapital && T.CAPITAL_COURT_MOVE > 0)
      ? URBAN_MIN_POP
      : Math.max(URBAN_MIN_POP, URBANIZE_POP - bestSV * URBAN_SITE_DISCOUNT);
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
    // ── Court relocation: a rural seat founds its CAPITAL town ──
    // If this region is the realm's CAPITAL, the town it founds becomes the new
    // SEAT: the court's treasury and the capital garrison move there, so at the
    // next rebuildCountries pass the town — not the rural region — is the realm's
    // highest-power member (its capital). It then grows into the capital city by
    // NORMAL, bounded town dynamics (fed up the food hierarchy), while the region
    // carries on as its rural hinterland. So the capital urbanises WITHOUT a
    // rural-ceiling exemption — the rural/urban balance and world population hold.
    if (region._isCapital && T.CAPITAL_COURT_MOVE > 0) {
      const f = T.CAPITAL_COURT_MOVE;
      const wMove = (region.wealth || 0) * f;
      region.wealth = (region.wealth || 0) - wMove; town.wealth = (town.wealth || 0) + wMove;
      const aMove = (region.army || 0) * f;
      region.army = (region.army || 0) - aMove; town.army = (town.army || 0) + aMove;
      region._isCapital = false; town._isCapital = true;   // within-pass hint; rebuildCountries reconfirms by power next pass
    }
  }
}

// Pick the nearest settlement (by straight-line distance, cheap), then
// blend its knowledge with a baseline based on how isolated this site
// is in transport terms. Settlements that crystallise right next to a
// city inherit most of its tech; isolated cradles start near baseline.
function inheritKnowledgeAt(world, ti, td, nearestHint = null) {
  world._lastInheritDonor = null;
  const { tw } = world;
  const ty = (ti / tw) | 0, tx = ti - ty * tw;
  let nearest = nearestHint, bestD2 = Infinity;
  // Fast path via the spatial grid: the nearest settlement within a generous
  // radius IS the global nearest (nothing closer can exist outside the disk).
  // A caller that already ran the disk scan passes the result as nearestHint.
  // Only when the disk is empty (a genuinely isolated spawn) do we fall back to
  // the full O(settlements) scan — so this is behaviour-identical, just cheaper.
  if (!nearest) forEachNear(world, tx, ty, INHERIT_NEAR_RADIUS, (s, d2) => {
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
    agriculture: NEOLITHIC_AGRI,
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

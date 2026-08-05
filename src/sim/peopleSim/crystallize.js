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
import { tel, telPass } from "./telemetry.js";
import { fieldShift, devWaveIvl, urbanCoreR, diskSum } from "./popField.js";
import { makeSettlement, dominantAnc, livestockClimate, birthOrgAt, bankRuinHoard, TIER_CORE } from "./settlement.js";
import { tileOpenness } from "./transport.js";
import { getPolity, fiscAdoptable } from "./entities.js";
import { dominantCulture, foundCulture, seedCulture, nameFor, ancestryCulture } from "./cultures.js";
import { dominantFaith } from "./faiths.js";
import { logEvent } from "./events.js";
import { grievOf } from "./loyaltyField.js";
import { passRng } from "./rng.js";
import { computeTransport } from "./transport.js";
import { forEachNear, gridAdd } from "./spatialGrid.js";
import { grownLiveOwnerAt } from "./countryClaim.js";
import { T, rNormPop } from "./tuning.js";
import { settleHostility } from "./habitability.js";
import { CATCH_TRIB, D8_DX, D8_DY } from "../riverGen.js";

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
// The countryside a prospective site stands in: the population-field mass over
// the market basin around it. This is the sim's own measure of "are there people
// here to make a town of" — the urban floor reads it against TOWN_BASIN_MIN, and
// T.INVENT_FIELD reads it for independent invention (see the floor note below).
// Extracted verbatim from the urban-floor check so both ask one question.
function townBasinMass(world, tx, ty, rB) {
  const pf = world.popField, tw = world.tw, th = world.th;
  let basin = 0;
  for (let dy = -rB; dy <= rB; dy++) {
    const yy = ty + dy; if (yy < 0 || yy >= th) continue;
    for (let dx = -rB; dx <= rB; dx++) {
      if (dx * dx + dy * dy > rB * rB) continue;
      basin += pf[yy * tw + (((tx + dx) % tw) + tw) % tw];
    }
  }
  return basin;
}
/** Measurement export (probes only): the CROWD_FOUND mass ratio at (tx,ty) —
 *  the founding basin's field people over a bar-sized basin (1 = exactly
 *  TOWN_BASIN_MIN×rn², the "enough countryside to carry a town" bar). A
 *  PHYSICAL yardstick for probes; crowdMul itself normalizes by the live
 *  crowdRefMass (the age's typical settled basin), not by this bar — the
 *  first build normalized by the bar and measured degenerate (see the
 *  crowdMul comment). */
export function crowdMassRatio(world, tx, ty) {
  const rn = rNormPop(world);
  // Raw bar, no rn²: field mass is EXTENSIVE (people), so the sum over a
  // fixed real region is grid-invariant and the bar is absolute — the same
  // convention as the founding floor itself. (An earlier ×rn² here was wrong
  // beyond the reference grid; every recorded measurement ran at rn=1 where
  // the two coincide.)
  return townBasinMass(world, tx, ty, Math.round(TOWN_BASIN_R * rn)) / TOWN_BASIN_MIN;
}
/** The age's TYPICAL settled basin (median townBasinMass over settled sites),
 *  cached and refreshed on a coarse cadence — a live self-calibrating
 *  reference of the tier-bar species, floored at the TOWN_BASIN_MIN bar so
 *  the dawn (few settlements, all cradles) divides by the viability floor
 *  rather than by noise. Only T.CROWD_FOUND consumes it; the lever guard at
 *  the call site keeps the off-path free of this work entirely. */
const CROWD_REF_IVL = 250;   // refresh cadence in steps — amortization, not a content gate (the median moves slowly)
export function crowdRefMass(world) {
  if (world._crowdRefAt !== undefined && world.step - world._crowdRefAt < CROWD_REF_IVL) return world._crowdRef;
  const rn = rNormPop(world);
  const rB = Math.round(TOWN_BASIN_R * rn);
  const floor = TOWN_BASIN_MIN;   // raw: field mass is extensive, the bar absolute (see crowdMassRatio)
  const masses = [];
  for (const s of world.settlements) {
    if (s.mode !== "settled") continue;
    masses.push(townBasinMass(world, s.pos.x | 0, s.pos.y | 0, rB));
  }
  masses.sort((a, b) => a - b);
  const med = masses.length ? masses[masses.length >> 1] : 0;
  world._crowdRefAt = world.step;
  return world._crowdRef = Math.max(floor, med);
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
// which carry full tech and pick a bounded site. REFERENCE-tiles, ×rn at the use site
// (a REAL distance, like the spacing model it is calibrated to — both moved to real
// distance under RES_INVARIANT_POP; this comment previously argued "ABSOLUTE (NOT
// res-scaled)" from the era when spacing was absolute too — stale since the spacing
// went ×rn, fixed in the 2026-07 audit). CALIBRATED TO THE SPACING MODEL: it must be at least the
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
// ── THE URBAN FLOOR (cities-only ontology, 2026-07) ─────────────────────
// A settlement ENTITY represents a CITY or LARGE TOWN — never less. The
// sub-town world (hamlets, villages, the dispersed countryside) is the
// popField, which peoples and develops the land on its own (logistic
// growth + migration + the devField wave). The sweep therefore founds an
// entity only where the surrounding basin's FIELD people can actually seed
// a town, and the founding population is drawn OUT of that basin
// (fieldShift debit here + the ONE_POP credit inside makeSettlement): a
// town is a CONCENTRATION of its countryside, not a minted speck. Before
// this, the sweep minted 18–26-person tier-1 entities — sub-floor "towns"
// that sat flagless in the wilderness for millennia (the complaint that
// prompted this: no city or large town has ever stood outside all polity;
// what history has is peopled countryside, which the FIELD already is).
// Rode-away steppe camps are the one documented exception (the horde
// system's mobile seats — ordu, not towns; conquest.js nomad path). A
// legacy config without the population field keeps the old village-scale
// births — there is no countryside substrate to concentrate from.
const TOWN_FOUND_MIN            = 90;    // smallest founding a town entity may have (= URBAN_MIN_POP: a viable town seed).
                                         // ABSOLUTE by ruling (Tier-C C1 deflation audit): this is the number of real
                                         // people who physically walk in and found the town — a per-community viability
                                         // quantum (a town IS ~a hundred people, the urban-floor ruling), debited from
                                         // the field 1:1, never a label's share of a census partition. Label supply
                                         // cannot deflate it.
const TOWN_BASIN_MIN            = 360;   // field people the catchment must hold first (~4× the founding — the town gathers a quarter of its basin).
                                         // Already a FIELD-MASS read (the B3 bar pattern). Under T.LABEL_BIRTH the bar
                                         // is the lever T.LABEL_BAR (default = this same 360 anchor) and the read
                                         // becomes basin-EXCLUSIVE — see the sweep.
const CROWD_CAP                 = 6;     // T.CROWD_FOUND saturation: the densest basin founds at most this multiple of a bar-sized one
const TOWN_BASIN_R              = 10;    // catchment radius, REFERENCE-tiles (×rn at the use site; = URBAN_CATCHMENT, one market catchment).
                                         // Under T.LABEL_BIRTH this same real distance is the market HORIZON of the
                                         // site-ledger law below (the cell's activation-mass radius AND the reach of a
                                         // site's cell) — one constant, one physical meaning: the day's walk that binds
                                         // a countryside to one market.
// ── T.LABEL_BIRTH v3: the MARKET-SITE LEDGER (Tier C phase 1, third cut) ──
// docs/design-c-siting-ledger.md — the measured foundation and the law. The
// two dead geometries before it, both refuted ON THIS BRANCH (kept for the
// record so v4 does not retread):
//   v1 (fixed-disk exclusivity): a spacing constant in disguise — 29 entities
//      vs 78 OFF at 480/12k, uniform nn, stylized 0/3 (v1 verdict addendum,
//      docs/design-c-label-extraction.md).
//   v2 (watershed of the horizon-smoothed popField): the supply ceiling is
//      the demand field's ATTRACTOR TEXTURE, which is GRID-RESOLVED (38/82/
//      113 bar-clearing basins at 240/480/960) — the law inherited a
//      resolution dependence the invariance discipline forbids (v2 verdict
//      addendum). Its kernel/watershed machinery survives BELOW as
//      INSTRUMENTS ONLY (labelBasinCensus / labelServiceCensus — cross-
//      version probe continuity), now with fractional edge weights (the v2
//      erratum: integer rounding of the kernel half-width was itself a
//      resolution leak, ×1.9 count distortion on the same field).
// v3 splits supply from demand along the line the siting-ledger probes
// proved: STRUCTURE SUPPLIES, POPULATION ACTIVATES, EXCLUSIVITY IS A
// PARTITION.
//   THE SITE LEDGER (static candidate supply — buildSiteLedger): market
//     sites are read off the drainage/coast SKELETON, the one measured
//     resolution-invariant source (field maxima of ANY worldgen field are
//     grid-textured — worldgen is not band-limited at the horizon scale):
//     • Class N — river nodes (the PIXEL flow tree, worldRef.rivers):
//       confluences (≥2 upstream branches each ≥ CATCH_TRIB = 60e3 km² of
//       discharge-equivalent catchment — riverGen's own tributary bar),
//       ocean mouths (≥ bar, next hop true ocean), terminal sinks (≥ bar,
//       sealed terminus / inland-sea shore — the oasis / terminal-lake
//       market, at the MARKET bar, not the TERMINAL_STRICT display multiple:
//       trade geometry, design OQ2). Ranked by km².
//     • Class H — anchorages (sim grid): near-shore sea tiles whose horizon
//       HALF-disk (R/2 real) is ≥ SHELTER_MIN land — meaningful enclosure,
//       excluding open-sea rocks and cape tips — local maxima under the
//       strict order (shelter, −index), ranked by shelter: the best
//       anchorage per stretch of coast.
//     • THE QUANTIZER: one greedy keep-largest pass, Class N by rank then
//       Class H by rank, rejecting within SITE_MERGE_D = TOWN_BASIN_R/2 real
//       distance of any accepted site — the attractor half-support of the
//       blessed v2 merge ruling (two features within half a horizon are one
//       physical site). A mouth in a bay is one site (the mouth, which
//       outranks). Measured (probe_sitesupply): river nodes 149/142 and
//       anchorages 165/172 at 480/960 (±5%), ~203-site union at 480, 91–97%
//       cross-grid position match — node counts of a tree thresholded in
//       absolute km² are TOPOLOGICAL real quantities. Re-run the probe
//       whenever worldgen's hydrology changes.
//   THE CELL PARTITION (exclusivity): every tile belongs to its NEAREST
//     ledger site (Euclidean real distance, ties by site rank) within one
//     market horizon (TOWN_BASIN_R); land beyond every horizon is
//     subsistence countryside — field-fed, unclaimable (the market-shed
//     rule). ONE LABEL PER CELL: a cell is claimed iff a settled label
//     stands in it; claims rebuild from the LIVE label set at the
//     CRYSTAL_INTERVAL staleness (a perf cadence — label deaths lapse at the
//     next rebuild: Jericho refounding for free) and are stamped live on
//     mint (labelClaimBasin — the gridAdd discipline, on cells).
//   ACTIVATION (demand): a site fires only when Σ popField over its cell
//     (∩ horizon, by construction) ≥ T.LABEL_BAR — one O(N) gather per
//     refresh, cheaper than v2's smooth+watershed rebuild — and then only
//     through the sweep's EXISTING probability machinery evaluated at the
//     site tile (quality, diffusion × pioneerTempo of the nearest donor,
//     saturation damper, ×dt; spacingFactor ≡ 1 — exclusivity is the cell).
//     A site on dead ground (fert < MIN_FERT) never fires spontaneously.
//     Dense valleys activate wall-to-wall; sparse steppe cells never reach
//     the bar; supply scales with real area through the skeleton and with
//     density through activation. The ledger is static geography — the
//     HISTORY is which sites live.
// Founding stays the conserved ACT (TOWN_FOUND_MIN debited 1:1 from the
// field, the ONE_POP credit, born-into-state gates verbatim), AT the site
// tile — the demand overlay measured 93.6% of mature OFF labels already
// within 5 ref-tiles of the skeleton, so snap-founding moves almost nothing.
// Daughters and sea landings keep their act semantics but SITE through the
// same three-function API (colonists land at harbors); no unclaimed site in
// range = fail-and-wait (the v2 decline path, design OQ4). Plantations keep
// their documented exemption (marches are forts, not markets — site-free)
// but claim the cell they stand in. Nothing here persists — the ledger and
// cells rebuild deterministically from worldgen at load (the same contract
// that rebuilds w.rivers itself), claims rebuild from live labels — and
// nothing here runs lever-off.
// HONEST LIMIT (the design's flip decider, §7.1, recorded): ~47% of the
// mature demand texture is diffuse rain-fed interior the skeleton does not
// host — the interior-pocket candidate class needs a band-limited worldgen
// texture contract before ANY field-maxima law can be invariant. Do not
// paper over it with a lower bar or interior spacing quotas.
const SHELTER_MIN   = 0.30;             // an anchorage's horizon half-disk is ≥30% enclosed by land
                                        // (excludes open water and cape tips; deliberately below the
                                        // straight-shore 0.5 because the RANKING, not the floor,
                                        // selects — floors ≥0.45 measured LESS invariant: enclosure
                                        // values grid-sharpen. The one NEW constant of the v3 law.)
const SITE_MERGE_D  = TOWN_BASIN_R / 2; // DERIVED, not free: the attractor half-support of the v2
                                        // kernel ruling (D=10 sensitivity measured — invariance does
                                        // not ride on the choice)
const CLAIM_REFRESH = CRYSTAL_INTERVAL; // claims/mass staleness bound, steps (perf cadence — how often
                                        // the same read refreshes, never whether history may happen)

/** INSTRUMENT ONLY (since v3 — the market-site ledger below is the shipped
 *  law; this v2 watershed machinery survives for cross-version probe
 *  continuity, never on the supply path). The watershed partition, computed
 *  fresh (a pure read of popField). Returns { root: Int32Array(N) — basin id
 *  (its maximum's tile index) per tile; mass: Float64Array(N) — Σ popField
 *  of each basin, at its root }. */
function computeLabelBasins(world) {
  const { N, tw, th } = world;
  const pf = world.popField;
  const rn = rNormPop(world);
  // Merge-kernel half-width: support diameter 2h = the horizon (see (a)).
  // FRACTIONAL edge weights (the v3 erratum): rounding h to an integer made
  // the kernel's REAL support grid-dependent (round(2.5)=3 at rn=0.5 reads 14
  // ref-tiles of support vs 11 at rn=1 — up to ×1.9 attractor-count
  // distortion on the same field). The box now carries weight 1 on the inner
  // integer core [−m..m] and weight frac(h) on the two edge taps ±(m+1), so
  // the real support is exactly the horizon at any grid. At integer h (480:
  // h=5; 960: h=10) fw=0 and this is bit-identical to the old integer kernel
  // — the recorded v2 wshed numbers at those grids reproduce.
  const hReal = Math.min(Math.max(1, TOWN_BASIN_R * rn / 2), (tw - 1) >> 1);
  const m = Math.floor(hReal);
  const fw = hReal - m;   // fractional edge weight (0 at integer h)
  // (a) separable box sum — x wraps (the map is a cylinder), y truncates at
  // the poles. Sliding windows in a fixed accumulation order: deterministic.
  const hS = new Float64Array(N);
  for (let y = 0; y < th; y++) {
    const row = y * tw;
    let acc = 0;
    for (let dx = -m; dx <= m; dx++) acc += pf[row + ((dx + tw) % tw)];
    hS[row] = fw > 0 ? acc + fw * (pf[row + ((-m - 1 + tw) % tw)] + pf[row + ((m + 1) % tw)]) : acc;
    for (let x = 1; x < tw; x++) {
      acc += pf[row + ((x + m) % tw)] - pf[row + ((x - m - 1 + tw) % tw)];
      hS[row + x] = fw > 0 ? acc + fw * (pf[row + ((x - m - 1 + tw) % tw)] + pf[row + ((x + m + 1) % tw)]) : acc;
    }
  }
  const S = new Float64Array(N);
  const acc = new Float64Array(tw);
  const yTop = Math.min(th - 1, m);
  for (let y = 0; y <= yTop; y++) { const row = y * tw; for (let x = 0; x < tw; x++) acc[x] += hS[row + x]; }
  if (fw > 0 && m + 1 < th) { const rowB = (m + 1) * tw; for (let x = 0; x < tw; x++) S[x] = acc[x] + fw * hS[rowB + x]; }
  else for (let x = 0; x < tw; x++) S[x] = acc[x];
  for (let y = 1; y < th; y++) {
    const yAdd = y + m, ySub = y - m - 1;
    if (yAdd < th) { const rowA = yAdd * tw; for (let x = 0; x < tw; x++) acc[x] += hS[rowA + x]; }
    if (ySub >= 0) { const rowS = ySub * tw; for (let x = 0; x < tw; x++) acc[x] -= hS[rowS + x]; }
    const row = y * tw;
    if (fw > 0) {
      const rowEA = ySub >= 0 ? ySub * tw : -1, eB = y + m + 1, rowEB = eB < th ? eB * tw : -1;
      for (let x = 0; x < tw; x++) {
        let v = acc[x];
        if (rowEA >= 0) v += fw * hS[rowEA + x];
        if (rowEB >= 0) v += fw * hS[rowEB + x];
        S[row + x] = v;
      }
    } else {
      for (let x = 0; x < tw; x++) S[row + x] = acc[x];
    }
  }
  // (b)+(c) steepest-ascent pointer per tile under the strict total order
  // height(i) = (S[i], −i): among the 8 neighbours take the highest; if it
  // out-ranks the tile itself the tile drains to it, else the tile is a
  // local maximum (its basin's root). Plateaus drain toward the lowest tile
  // index — fully deterministic, and acyclic because height strictly
  // increases along every pointer.
  const ptr = new Int32Array(N);
  for (let y = 0; y < th; y++) {
    const row = y * tw;
    const up = y > 0 ? row - tw : -1, dn = y < th - 1 ? row + tw : -1;
    for (let x = 0; x < tw; x++) {
      const i = row + x;
      const xl = x === 0 ? tw - 1 : x - 1, xr = x === tw - 1 ? 0 : x + 1;
      let bi = i, bs = S[i], j, sj;
      j = row + xl; sj = S[j]; if (sj > bs || (sj === bs && j < bi)) { bs = sj; bi = j; }
      j = row + xr; sj = S[j]; if (sj > bs || (sj === bs && j < bi)) { bs = sj; bi = j; }
      if (up >= 0) {
        j = up + xl; sj = S[j]; if (sj > bs || (sj === bs && j < bi)) { bs = sj; bi = j; }
        j = up + x;  sj = S[j]; if (sj > bs || (sj === bs && j < bi)) { bs = sj; bi = j; }
        j = up + xr; sj = S[j]; if (sj > bs || (sj === bs && j < bi)) { bs = sj; bi = j; }
      }
      if (dn >= 0) {
        j = dn + xl; sj = S[j]; if (sj > bs || (sj === bs && j < bi)) { bs = sj; bi = j; }
        j = dn + x;  sj = S[j]; if (sj > bs || (sj === bs && j < bi)) { bs = sj; bi = j; }
        j = dn + xr; sj = S[j]; if (sj > bs || (sj === bs && j < bi)) { bs = sj; bi = j; }
      }
      ptr[i] = bi;
    }
  }
  // resolve every tile to its root (path compression; ptr becomes root)
  for (let i = 0; i < N; i++) {
    let r0 = i;
    while (ptr[r0] !== r0) r0 = ptr[r0];
    let j2 = i;
    while (ptr[j2] !== r0) { const nx = ptr[j2]; ptr[j2] = r0; j2 = nx; }
  }
  // (d) basin mass (ascending-index accumulation order: deterministic)
  const mass = new Float64Array(N);
  for (let i = 0; i < N; i++) { const v = pf[i]; if (v > 0) mass[ptr[i]] += v; }
  return { root: ptr, mass };
}

// ── The market-site LEDGER + cell partition (the v3 law's static half) ──
// Fixed scan order for the ≤1-tile land snap (pixel→sim coastal aliasing, and
// an anchorage's shore tile): the tile itself, then the four cardinals, then
// the diagonals — nearest first, deterministic.
const SNAP_ORDER = [[0, 0], [0, -1], [-1, 0], [1, 0], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]];
function _snapToLand(world, x, y) {
  const { tw, th } = world;
  for (const [dx, dy] of SNAP_ORDER) {
    const yy = y + dy; if (yy < 0 || yy >= th) continue;
    const xx = (((x + dx) % tw) + tw) % tw;
    if (isContinentalLand(world, yy * tw + xx)) return { x: xx, y: yy };
  }
  return null;
}
/** Build the market-site ledger + cell partition — a PURE, deterministic
 *  read of static worldgen (the pixel flow tree + sim coast geometry; no
 *  rng, strictly ordered greedy). Returns:
 *    sites  — rank-ordered array of { x, y, ti, cls, v }: Class N (cls
 *             "conf"/"mouth"/"sink", v = discharge-equivalent km²) then
 *             Class H (cls "bay", v = shelter), greedy-quantized at
 *             SITE_MERGE_D;
 *    siteId — Int32Array(N): every tile within one market horizon
 *             (TOWN_BASIN_R real) of a site → the NEAREST site's rank
 *             (ties to the better rank); −1 = subsistence countryside
 *             beyond every horizon (unclaimable, field-fed);
 *    raw    — pre-quantizer candidate counts per class (probe channel).
 *  opts.detail (probe-only) additionally returns the sorted candidate lists
 *  candN/candH and the merge distance D, so tools/probe_sitesupply.mjs can
 *  quantize each class ALONE for the §3 invariance table.
 *  Exported for the probes (tools/probe_sitesupply.mjs — §3's invariance
 *  table — and probe_entitysupply.mjs); the sim reads the cache below. */
export function buildSiteLedger(world, opts = {}) {
  const { N, tw, th, elev, tileRes } = world;
  const rn = rNormPop(world);
  const raw = { conf: 0, mouth: 0, sink: 0, bay: 0 };
  // ── Class N: river nodes on the PIXEL flow tree (worldRef.rivers) ──
  const candN = [];
  const w = world.worldRef;
  const rv = w && w.rivers;
  if (rv && rv.flowDir && rv.flowAccum && (rv.km2PerAccum || 0) > 0 && w.elevation) {
    const pw = w.width, ph = w.height, pe = w.elevation;
    const { flowDir, flowAccum, drainsTerminal, km2PerAccum } = rv;
    const bar = CATCH_TRIB / km2PerAccum;   // 60e3 km² of discharge-equivalent catchment, in accumulation units
    // Upstream branches ≥ bar per pixel: one fixed-order pass along flowDir.
    const upBig = new Uint8Array(pw * ph);
    for (let pi = 0; pi < pw * ph; pi++) {
      if (pe[pi] <= 0 || flowAccum[pi] < bar) continue;
      const d = flowDir[pi];
      if (d === 255) continue;
      const px = pi % pw, py = (pi - px) / pw;
      const ny = py + D8_DY[d];
      if (ny < 0 || ny >= ph) continue;
      const ni = ny * pw + ((px + D8_DX[d] + pw) % pw);
      if (pe[ni] > 0 && upBig[ni] < 255) upBig[ni]++;
    }
    for (let pi = 0; pi < pw * ph; pi++) {
      if (pe[pi] <= 0) continue;
      const a = flowAccum[pi];
      let cls = null;
      if (a >= bar) {
        const d = flowDir[pi];
        if (d === 255) cls = "sink";   // sealed endorheic terminus
        else {
          const px = pi % pw, py = (pi - px) / pw;
          const ny = py + D8_DY[d];
          if (ny >= 0 && ny < ph && pe[ny * pw + ((px + D8_DX[d] + pw) % pw)] <= 0) {
            // next hop is water: TRUE ocean = mouth; inland sea = the
            // terminal-lake market (drainsTerminal encodes exactly this).
            cls = drainsTerminal && drainsTerminal[pi] === 1 ? "sink" : "mouth";
          }
        }
      }
      if (!cls && upBig[pi] >= 2) cls = "conf";
      if (!cls) continue;
      raw[cls === "conf" ? "conf" : cls]++;
      const px = pi % pw, py = (pi - px) / pw;
      const st = _snapToLand(world, Math.min(tw - 1, (px / tileRes) | 0), Math.min(th - 1, (py / tileRes) | 0));
      if (!st) continue;   // stranded past the 1-tile snap (islet/edge) — no market can stand
      candN.push({ v: a * km2PerAccum, x: st.x, y: st.y, cls });
    }
  }
  // ── Class H: anchorages on the sim grid ──
  const candH = [];
  {
    const rH = (TOWN_BASIN_R / 2) * rn, rHy = Math.floor(rH), rH2 = rH * rH;
    // Per-row prefix sums of the land mask (x wraps — the map is a cylinder).
    const pref = new Int32Array((tw + 1) * th);
    for (let y = 0; y < th; y++) {
      const row = y * tw, prow = y * (tw + 1);
      let acc = 0;
      for (let x = 0; x < tw; x++) { if (elev[row + x] > 0) acc++; pref[prow + x + 1] = acc; }
    }
    const rowLand = (y, x0, x1) => {   // inclusive column span, wrapping
      const prow = y * (tw + 1), tot = pref[prow + tw];
      if (x1 - x0 + 1 >= tw) return tot;
      const a = ((x0 % tw) + tw) % tw, b = ((x1 % tw) + tw) % tw;
      return a <= b ? pref[prow + b + 1] - pref[prow + a] : (tot - pref[prow + a]) + pref[prow + b + 1];
    };
    // Shelter (land fraction of the R/2 real disk) for NEAR-SHORE sea tiles —
    // a land tile in the 8-neighbourhood; the floor itself excludes open sea.
    // FRACTIONAL boundary columns (the v3 erratum discipline, §4: integer
    // truncation of a real support is a resolution leak — enclosure values
    // grid-sharpen): each row's edge column at floor(h)+1 carries the real
    // coverage weight h−floor(h), so the disk's support is exactly rH at any
    // grid.
    const shel = new Float32Array(N).fill(-1);
    for (let y = 0; y < th; y++) {
      const row = y * tw;
      for (let x = 0; x < tw; x++) {
        const i = row + x;
        if (elev[i] > 0) continue;
        let shore = false;
        for (let dy = -1; dy <= 1 && !shore; dy++) {
          const yy = y + dy; if (yy < 0 || yy >= th) continue;
          const nrow = yy * tw;
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            if (elev[nrow + ((((x + dx) % tw) + tw) % tw)] > 0) { shore = true; break; }
          }
        }
        if (!shore) continue;
        let land = 0, tot = 0;
        for (let dy = -rHy; dy <= rHy; dy++) {
          const yy = y + dy; if (yy < 0 || yy >= th) continue;
          const rem = rH2 - dy * dy; if (rem < 0) continue;
          const h = Math.sqrt(rem), half = Math.floor(h), fwc = h - half;
          land += rowLand(yy, x - half, x + half);
          tot += 2 * half + 1;
          if (fwc > 0) {
            const rowT = yy * tw;
            const xl = rowT + ((((x - half - 1) % tw) + tw) % tw);
            const xr = rowT + ((((x + half + 1) % tw) + tw) % tw);
            land += fwc * ((elev[xl] > 0 ? 1 : 0) + (elev[xr] > 0 ? 1 : 0));
            tot += 2 * fwc;
          }
        }
        shel[i] = tot > 0 ? land / tot : 0;
      }
    }
    // Local maxima under the strict order (shelter, −index), floor SHELTER_MIN.
    for (let y = 0; y < th; y++) {
      const row = y * tw;
      for (let x = 0; x < tw; x++) {
        const i = row + x, sv = shel[i];
        if (sv < SHELTER_MIN) continue;
        let isMax = true;
        for (let dy = -1; dy <= 1 && isMax; dy++) {
          const yy = y + dy; if (yy < 0 || yy >= th) continue;
          const nrow = yy * tw;
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const j = nrow + ((((x + dx) % tw) + tw) % tw);
            const nv = shel[j];
            if (nv < 0) continue;
            if (nv > sv || (nv === sv && j < i)) { isMax = false; break; }
          }
        }
        if (!isMax) continue;
        raw.bay++;
        const st = _snapToLand(world, x, y);
        if (!st) continue;
        candH.push({ v: sv, x: st.x, y: st.y, cls: "bay" });
      }
    }
  }
  // ── The quantizer: greedy keep-largest, rivers first, then bays ──
  // Strict total orders (value desc, x asc, y asc): deterministic.
  const byRank = (a, b) => (b.v - a.v) || (a.x - b.x) || (a.y - b.y);
  candN.sort(byRank);
  candH.sort(byRank);
  const D = SITE_MERGE_D * rn, D2 = D * D;
  const sites = [];
  const accept = (c) => {
    for (let i = 0; i < sites.length; i++) {
      let dx = Math.abs(sites[i].x - c.x); if (dx > tw / 2) dx = tw - dx;
      const dy = sites[i].y - c.y;
      if (dx * dx + dy * dy < D2) return;
    }
    sites.push({ x: c.x, y: c.y, ti: c.y * tw + c.x, cls: c.cls, v: c.v });
  };
  for (const c of candN) accept(c);
  for (const c of candH) accept(c);
  // ── The cell partition: nearest site within one horizon ──
  const siteId = new Int32Array(N).fill(-1);
  const bestD2 = new Float64Array(N).fill(Infinity);
  const R = TOWN_BASIN_R * rn, R2 = R * R, ry = Math.floor(R);
  for (let k = 0; k < sites.length; k++) {
    const sx = sites[k].x, sy = sites[k].y;
    for (let dy = -ry; dy <= ry; dy++) {
      const yy = sy + dy; if (yy < 0 || yy >= th) continue;
      const rem = R2 - dy * dy; if (rem < 0) continue;
      const half = Math.floor(Math.sqrt(rem));
      const nrow = yy * tw;
      for (let dx = -half; dx <= half; dx++) {
        const i = nrow + ((((sx + dx) % tw) + tw) % tw);
        const d2 = dx * dx + dy * dy;
        if (d2 < bestD2[i]) { bestD2[i] = d2; siteId[i] = k; }   // strict <: ties keep the better rank (k ascending)
      }
    }
  }
  return opts.detail ? { sites, siteId, raw, candN, candH, D } : { sites, siteId, raw };
}
/** The cached ledger — static per world (a pure function of worldgen), so it
 *  rebuilds only at load / world swap: the _floodTiles / transportDist
 *  re-warm lifecycle. NOTHING persists. */
export function labelSiteLedger(world) {
  let L = world._siteLedger;
  if (!L || L.N !== world.N) {
    const { sites, siteId, raw } = buildSiteLedger(world);
    L = world._siteLedger = { N: world.N, sites, siteId, raw };
  }
  return L;
}
// Claims + cell mass, from the LIVE label set + popField, at the
// CRYSTAL_INTERVAL staleness (a perf cadence; label deaths lapse the claim at
// the next rebuild — Jericho refounding); labels minted mid-pass stamp their
// claim live (labelClaimBasin — the gridAdd discipline, on cells).
function _siteClaims(world) {
  const L = labelSiteLedger(world);
  let c = world._siteClaims;
  if (!c || c.K !== L.sites.length || world.step - c.step >= CLAIM_REFRESH || world.step < c.step) {
    const K = L.sites.length, tw = world.tw, N = world.N, siteId = L.siteId;
    const claimed = new Uint8Array(K);
    const mass = new Float64Array(K);
    const pf = world.popField;
    if (pf) for (let i = 0; i < N; i++) { const k = siteId[i]; if (k >= 0) mass[k] += pf[i]; }
    for (const s of world.settlements) {
      if (s.mode !== "settled") continue;
      const ti = (s.pos.y | 0) * tw + (((s.pos.x | 0) % tw) + tw) % tw;
      if (ti >= 0 && ti < N) { const k = siteId[ti]; if (k >= 0) claimed[k] = 1; }
    }
    c = world._siteClaims = { K, step: world.step, claimed, mass };
  }
  return c;
}
const _cellTi = (world, tx, ty) => (ty | 0) * world.tw + ((((tx | 0) % world.tw) + world.tw) % world.tw);
/** Is (tx,ty)'s market cell open to a new label — within one horizon of a
 *  ledger site AND unclaimed by every existing label? The one siting law
 *  every label-minting act reads (sweep, daughters, sea landings — survey §4
 *  verdict). Callers gate on T.LABEL_BIRTH && world.popField. */
export function labelBasinFree(world, tx, ty) {
  const k = labelSiteLedger(world).siteId[_cellTi(world, tx, ty)];
  return k >= 0 && !_siteClaims(world).claimed[k];
}
/** Field people (tx,ty)'s cell holds (cell ∩ horizon by construction) — the
 *  C1 activation mass. 0 beyond every horizon (subsistence countryside). */
export function labelBasinMass(world, tx, ty) {
  const k = labelSiteLedger(world).siteId[_cellTi(world, tx, ty)];
  return k >= 0 ? _siteClaims(world).mass[k] : 0;
}
/** Mark (tx,ty)'s cell claimed (a label was just minted in it). */
export function labelClaimBasin(world, tx, ty) {
  const k = labelSiteLedger(world).siteId[_cellTi(world, tx, ty)];
  if (k >= 0) _siteClaims(world).claimed[k] = 1;
}
/** The ledger site whose cell (tx,ty) belongs to (null beyond every horizon)
 *  — the act-snap read: parties found AT the site tile, so labels stand on
 *  their sites and claim reconstruction at load is exact. */
export function labelSiteOf(world, tx, ty) {
  const L = labelSiteLedger(world);
  const k = L.siteId[_cellTi(world, tx, ty)];
  return k >= 0 ? L.sites[k] : null;
}
/** Instrument read (probe_entitysupply / probe_sitesupply): the ledger
 *  census — sites by class with claim counts, and how many clear the
 *  activation bar (claimed/total at the bar is the law's direct
 *  supply-uptake measure). PURE wrt the claims cache (fresh gather from live
 *  labels + popField — safe to call lever-off; the static ledger cache is
 *  shared, a pure function of worldgen). */
export function siteLedgerCensus(world, bar) {
  if (!world.popField) return null;
  const L = labelSiteLedger(world);
  const K = L.sites.length, N = world.N, tw = world.tw, siteId = L.siteId;
  const mass = new Float64Array(K);
  const pf = world.popField;
  for (let i = 0; i < N; i++) { const k = siteId[i]; if (k >= 0) mass[k] += pf[i]; }
  const claimed = new Uint8Array(K);
  for (const s of world.settlements) {
    if (s.mode !== "settled") continue;
    const ti = (s.pos.y | 0) * tw + (((s.pos.x | 0) % tw) + tw) % tw;
    if (ti >= 0 && ti < N) { const k = siteId[ti]; if (k >= 0) claimed[k] = 1; }
  }
  const byClass = {};
  let nClaimed = 0, overBar = 0, freeOverBar = 0;
  for (let k = 0; k < K; k++) {
    const o = byClass[L.sites[k].cls] || (byClass[L.sites[k].cls] = { n: 0, claimed: 0 });
    o.n++;
    if (claimed[k]) { o.claimed++; nClaimed++; }
    if (mass[k] >= bar) { overBar++; if (!claimed[k]) freeOverBar++; }
  }
  return { K, claimed: nClaimed, overBar, freeOverBar, byClass };
}
/** Instrument read (tools/probe_entitysupply.mjs): the watershed supply
 *  census — per mass bar, how many basins clear it and how many of those a
 *  label already claims (claimed/total at the founding bar is the direct
 *  supply-uptake measure of the law). PURE — fresh compute, never touches
 *  the world's cache: safe to call lever-off without perturbing the
 *  trajectory. */
export function labelBasinCensus(world, bars) {
  if (!world.popField) return null;
  const { root, mass } = computeLabelBasins(world);
  const tw = world.tw, N = world.N;
  const claimed = new Uint8Array(N);
  for (const s of world.settlements) {
    if (s.mode !== "settled") continue;
    const ti = (s.pos.y | 0) * tw + (((s.pos.x | 0) % tw) + tw) % tw;
    if (ti >= 0 && ti < N) claimed[root[ti]] = 1;
  }
  const out = bars.map((bar) => ({ bar, basins: 0, claimed: 0 }));
  for (let i = 0; i < N; i++) {
    if (root[i] !== i) continue;          // roots only
    const m = mass[i];
    if (!(m > 0)) continue;
    for (const o of out) if (m >= o.bar) { o.basins++; if (claimed[i]) o.claimed++; }
  }
  return out;
}
/** Instrument read: what share of the field population lives within one
 *  market horizon (TOWN_BASIN_R) of a label — the service-coverage measure
 *  that exposed the covering-constraint dead end (96% served by 32 labels).
 *  PURE — fresh compute, no caches. */
export function labelServiceCensus(world) {
  if (!world.popField) return null;
  const { N, tw, th } = world;
  const served = new Uint8Array(N);
  const rB = Math.max(1, Math.round(TOWN_BASIN_R * rNormPop(world)));
  for (const s of world.settlements) {
    if (s.mode !== "settled") continue;
    const sx = s.pos.x | 0, sy = s.pos.y | 0;
    for (let dy = -rB; dy <= rB; dy++) {
      const yy = sy + dy; if (yy < 0 || yy >= th) continue;
      const half = Math.floor(Math.sqrt(rB * rB - dy * dy));
      const row = yy * tw;
      for (let dx = -half; dx <= half; dx++) served[row + (((sx + dx) % tw) + tw) % tw] = 1;
    }
  }
  const pf = world.popField;
  let unserved = 0, tot = 0;
  for (let i = 0; i < N; i++) { const v = pf[i]; if (v > 0) { tot += v; if (!served[i]) unserved += v; } }
  return { unserved, tot };
}
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
const COLONY_MIN_POP          = 200;   // need a town worth's people before splitting one off.
                                       // ABSOLUTE by ruling (Tier-C C1 deflation audit): the bar prices a real
                                       // demographic ACT — sending ≥25 settlers (COLONY_SEND_FRAC/CAP below)
                                       // without gutting the sender — in the SAME census units the act debits.
                                       // Under ONE_POP a label's census IS the people it governs; a community
                                       // governing fewer people genuinely has fewer to send. Act frequency
                                       // shifts with C1's census deflation (~×0.6-0.75 at the conservative
                                       // supply step) — measured, not fudged per-site.
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
// ── T.DISSOLVE_TOWNS: a settlement whose basin can no longer feed a CITY
// fades back into the countryside. Under ONE_POP the entity was always a
// LENS over the field: its people stay on the land as the villages and
// small towns they are — only the urban institution dissolves (wealth to a
// ruin hoard, the chronicle notes the fading). Founding requires the city
// basin (TIER_CORE[2]/TIER_CORE[1] × the town bar); dissolution fires below
// DISSOLVE_HYST × that, SUSTAINED in history-time — the wide hysteresis gap
// plus the timer is what keeps a breathing basin from flickering its city
// in and out of existence. Checked on a per-settlement stride: the disk sum
// is the whole cost, so a hundred settlements cost ~half a disk per tick.
const DISSOLVE_CHECK_IVL = 200;   // per-settlement stride (amortization, not a content gate)
const DISSOLVE_HYST = 0.6;        // dissolve below this fraction of the founding bar
const DISSOLVE_SUSTAIN = 1500;    // history-steps the basin must stay thin (granularity-corrected below)
const URBAN_SHARE_REF = 0.05;     // pre-industrial urban share: measured here (core share p50 4.6-5.6%, every probe arm) and historically (~3-8%)
/** T.DISSOLVE_TOWNS: can (tx,ty)'s basin feed a CITY? The lever's one bar —
 *  basin census ≥ TIER_CORE[2]/URBAN_SHARE_REF (a 10k core at the ~5% urban
 *  share needs a ~200,000-person market basin) — shared by every mint path
 *  (crystallize, state plantations, sea colonies) so no channel can mint at
 *  town scale around it. True when the lever is off or the bridge is not yet
 *  live (the dawn is hearth-driven anyway). */
export function cityBasinOkAt(world, tx, ty) {
  if (!T.DISSOLVE_TOWNS || !(world._onePopScale > 0)) return true;
  const rn = rNormPop(world);
  const mass = townBasinMass(world, tx, ty, Math.round(TOWN_BASIN_R * rn));
  return mass * world._onePopScale >= TIER_CORE[2] / URBAN_SHARE_REF;
}
function maybeDissolveTowns(world) {
  if (!T.DISSOLVE_TOWNS) return;
  if (!(world._onePopScale > 0)) return;   // pre-bridge the basin census is unreadable (dawn; hearth-driven anyway)
  const rn = rNormPop(world);
  const rB = Math.round(TOWN_BASIN_R * rn);
  // The same census bar founding pays (a city's ~200-census market basin),
  // at DISSOLVE_HYST of it — the hysteresis gap plus the sustain timer keeps
  // a breathing basin from flickering its city in and out of existence.
  const bar = (TIER_CORE[2] / URBAN_SHARE_REF) * DISSOLVE_HYST / world._onePopScale;   // in field units
  const dt = world._dt || 1;
  for (const s of world.settlements) {
    if (s.mode !== "settled") continue;
    if ((world.step + s.id) % DISSOLVE_CHECK_IVL !== 0) continue;
    if (townBasinMass(world, s.pos.x | 0, s.pos.y | 0, rB) >= bar) { s._thinBasinSince = undefined; continue; }
    if (s._thinBasinSince === undefined) { s._thinBasinSince = world.step; continue; }
    if (world.step - s._thinBasinSince > DISSOLVE_SUSTAIN / dt) {
      s.mode = "dead";
      bankRuinHoard(world, s);
      logEvent(world, "settlement.dissolved", { s: s.id, sName: s.name, polity: s.countryId });
    }
  }
}

// ── T.CITY_AT_BIRTH: cities are BORN as cities — the proto-urban stage lives
// in the land (Wave 5 Stage B; owner 2026-08-05: "i still see you spawning
// villages and towns"). No entity ever mints below the city definition.
// Instead, each unclaimed ledger site whose market cell can feed a city
// (cell mass ≥ the city-basin bar) CONCENTRATES its countryside in the field
// itself: URBAN_DRIFT of the cell's people per step trickle toward the site
// tile (the rural→proto-urban migration), a capacity spike stamped at the
// site each tick holds what arrived (exactly the mechanism grown cities use,
// applied pre-entity — deriveOnePop clears the spike map every stride, so
// the stamp is per-tick), and when the site's core disk holds a real city's
// people the ENTITY is born: a CITY, tier 2, "the city of X arose" — never
// a village or town dot. Genesis then runs: hearths ripen basins, basins
// concentrate, Uruk rises, and the map's first dot IS a city.
//   The dawn's unit bridge: before any census exists to calibrate
// _onePopScale, BRIDGE_REF stands in — the measured mid-band of the live
// bridge (0.001-0.003; a unit choice, not a tuning), replaced by the live
// bridge the moment the first city exists.
const BRIDGE_REF = 0.002;
const URBAN_DRIFT = 5e-5;      // per-step share of a market cell's people drifting to its site (Uruk: village → 40,000 over ~900 years at a ~200-census basin ≈ this order)
const SITE_CITY_IVL = 25;      // drift/mint cadence (amortization; the spike re-stamp below is per-tick so every field pass holds the core)
// The settlement-less invention IMPROVES WITH PRACTICE: a static seed measured
// dead (25k genesis arc: eight inventions fired on the real multi-millennial
// stagger, zero cities ever — a fixed 0.45 source has a fixed few-tile wave
// reach and can never establish farming across a cell). A settlement's
// agriculture GROWS and its wave halo with it; the ground's practice does the
// same during the settlement-less window: toward the PRE-URBAN PLATEAU
// (agriculture's next advances came with urban specialists — the old dawn's
// pre-city settlements sat ~0.50-0.55), at the settlement law's own measured
// early slope (0.45 → 0.50 over ~4000 steps at the old dawn).
const AGRI_PRACTICE_CAP = 0.55;
const SEED_AGRI_RATE = 1.5e-5;   // per step
function maybeSiteCities(world) {
  if (!T.CITY_AT_BIRTH || !T.POP_FIELD || !T.ONE_POP || !world.popField) return;
  const L = labelSiteLedger(world);
  const claims = _siteClaims(world);
  const pf = world.popField;
  const bridge = world._onePopScale > 0 ? world._onePopScale : BRIDGE_REF;
  const basinBarF = (TIER_CORE[2] / URBAN_SHARE_REF) / bridge;   // city-capable cell, field units
  const coreBarF = TIER_CORE[2] / bridge;                        // a CITY's core, field units
  const coreR = urbanCoreR(world);
  // Eligibility is cached between cadence firings; the spike re-stamp runs
  // every tick from the cache so the field pass always holds the cores.
  let elig = world._siteCityElig;
  if (!elig || elig.length !== L.sites.length || world.step % SITE_CITY_IVL === 0) {
    if (!elig || elig.length !== L.sites.length) elig = world._siteCityElig = new Uint8Array(L.sites.length);
    // THE FARMING GATE — measured essential, not optional: without it the
    // dawn's Malthusian FORAGER field cleared the census bar under
    // BRIDGE_REF's farming-era guess and the site pass minted 183 "cities"
    // out of forager countryside by step 500 (each self-anchoring a realm —
    // 185 realms in a world where farming was not yet invented). There are
    // no forager cities: a site concentrates and mints only where the
    // technique field carries the FULL invention (NEOLITHIC_AGRI — the same
    // constant the founding quality machinery gates on, no new number).
    const devF = world.devField;
    for (let k = 0; k < L.sites.length; k++) {
      elig[k] = !claims.claimed[k] && claims.mass[k] >= basinBarF
        && devF && devF[L.sites[k].ti] >= NEOLITHIC_AGRI ? 1 : 0;
    }
  }
  const spikes = world._urbanSpike || (world._urbanSpike = new Map());
  for (let k = 0; k < L.sites.length; k++) {
    if (!elig[k]) continue;
    const st = L.sites[k];
    const coreNow = diskSum(pf, world.tw, world.th, st.x, st.y, coreR);
    // Hold what has gathered — BOUNDED at the mint bar: the proto-urban stage
    // ends at city size, so capacity never chases the pile beyond it.
    // Measured without the bound (genesis v3/v4): drift + spike compounded
    // ~2,800 steps into a ~500k-field single-tile pile, and the first-born
    // entity derived a 1,073-census catchment (ONE_POP re-reads the land, so
    // capping the founding take alone was cosmetic).
    if (coreNow > 0 && !spikes.has(st.ti)) spikes.set(st.ti, { k: Math.min(coreNow, coreBarF * 1.2) });
  }
  if (world.step % SITE_CITY_IVL !== 0) return;
  // Practice improves at the settlement-less hearths (see AGRI_PRACTICE_CAP).
  if (world._hearthSeeds) {
    const dA = SEED_AGRI_RATE * (world._dt || 1) * SITE_CITY_IVL;
    for (const h of world._hearthSeeds) if (h.agri < AGRI_PRACTICE_CAP) h.agri = Math.min(AGRI_PRACTICE_CAP, h.agri + dA);
  }
  // Drift: one O(N) sweep — every tile of every eligible cell pays the same
  // share, its site receives the sum. Mass-conserving by construction.
  const rate = Math.min(0.2, URBAN_DRIFT * (world._dt || 1) * SITE_CITY_IVL);
  // A site whose core has already gathered a city's worth stops drawing —
  // the mint takes it from here (same bound as the spike above).
  for (let k = 0; k < L.sites.length; k++) {
    if (!elig[k]) continue;
    const st = L.sites[k];
    if (diskSum(pf, world.tw, world.th, st.x, st.y, coreR) >= coreBarF) elig[k] = 2;   // 2 = mint-ready, no more drift
  }
  const gain = new Float64Array(L.sites.length);
  const siteId = L.siteId;
  for (let i = 0; i < siteId.length; i++) {
    const k = siteId[i];
    if (k < 0 || elig[k] !== 1) continue;
    const p = pf[i];
    if (p <= 1e-9) continue;
    const mv = p * rate;
    pf[i] = p - mv;
    gain[k] += mv;
  }
  for (let k = 0; k < L.sites.length; k++) {
    if (gain[k] > 0) pf[L.sites[k].ti] += gain[k];
  }
  // Mint: a site whose core disk holds a city's people becomes a CITY —
  // stateless at birth (-1): a stateless city self-anchors sovereignty
  // through the existing countryTerritory channel (city-creates-nation), or
  // is adopted by the realm whose border has grown over it. The people are
  // MOVED, never printed: the field is debited at the site and
  // makeSettlement's ONE_POP credit restores them as the city's census.
  for (let k = 0; k < L.sites.length; k++) {
    if (!elig[k]) continue;
    const st = L.sites[k];
    const coreF = diskSum(pf, world.tw, world.th, st.x, st.y, coreR);
    if (coreF < coreBarF) continue;
    // The city is born a CITY — never a megalopolis: the entity takes the
    // city's own people (the bar, with growth headroom) and the REST of what
    // gathered stays on the land as its countryside. Measured without this
    // cap: the first genesis mint arrived only when the farming gate opened,
    // by which time the basin had piled organically, and the first-born
    // entity swallowed a 1,008-census core — a metropolis at birth in a
    // world whose second entity did not exist yet.
    const coreCensus = Math.min(coreF * bridge, TIER_CORE[2] * 1.5);
    // The mint has priced every bar in BRIDGE_REF units — so the FIRST mint
    // must SET the live bridge to that same value, not let the next derive
    // re-calibrate it from the founding party. Measured without this
    // (probe_firstcity): the derive computed _onePopScale = 15-census party /
    // a barely-assigned catchment = 0.35 (175× the reference), the first city
    // read 11,000 census at birth, famine-crashed to ~1,000 over 600 steps,
    // and only then regrew honestly. A unit must not be re-derived from the
    // first datum that used it.
    if (!(world._onePopScale > 0)) world._onePopScale = BRIDGE_REF;
    fieldShift(world, { pos: { x: st.x, y: st.y } }, -coreCensus);
    const inherited = inheritKnowledgeAt(world, st.ti, world.transportDist ? world.transportDist[st.ti] : 0);
    // A city born within reach of an existing people carries their culture
    // (the inherit pass just found the nearest); one born in virgin land is
    // the BIRTH of a people — Uruk is where the Sumerians become visible.
    // Without this the genesis cities named as "settlement-1" (measured).
    const donor = world._lastInheritDonor;
    const donorCul = donor ? dominantCulture(donor) : -1;
    const born = makeSettlement(world, st.x + 0.5, st.y + 0.5, {
      people: coreCensus, knowledge: inherited, tier: 2,
      ...(donorCul >= 0 ? { cultureId: donorCul } : { cradle: true }),
    });
    labelClaimBasin(world, st.x, st.y);
    elig[k] = 0;
    spikes.delete(st.ti);
    logEvent(world, "settlement.founded", { s: born.id, sName: born.name, polity: born.countryId ?? -1, city: 1 });
  }
}

export function maybeCrystallize(world) {
  maybeDissolveTowns(world);
  maybeSiteCities(world);
  if (world.step % CRYSTAL_INTERVAL !== 0) return;

  // Refresh transport map if stale or absent.
  if (!world.transportDist || world.step - (world._transportStep || -Infinity) > TRANSPORT_REFRESH_TICKS) {
    world.transportDist = computeTransport(world);
    world._transportStep = world.step;
  }

  // ── T.INVENT_STAGGER: armed hearths mature on PEOPLED-BASIN TIME ──────────
  // A candidate whose maturity ran past prehistory (state.js seatOrArmHearths)
  // ignites HERE, mid-game, when its remaining years are served — and a year
  // only counts in proportion to how full the basin actually is (effYears +=
  // dt × basinMass/basinCapacity): an empty basin never matures, a rich
  // forager basin serves time at full rate. Colonisation stands a candidate
  // down — if settlement reached the basin first, the package arrived before
  // it was invented (the Australia case), which is the mechanism-true outcome,
  // not a failure. Emergent throughout: the calendar never enters; dt is
  // derived from the technique wave's own physical calibration (devWaveIvl ↔
  // one tile-hop ↔ tileKm/DEV_WAVE_KMPY years), the same real-time unit the
  // pre-run epoch uses.
  if (T.INVENT_STAGGER && world._armedHearths && world._armedHearths.length && world.popField && world.capField) {
    const rB = Math.max(1, Math.round(TOWN_BASIN_R * rNormFor(world)));
    const lastAt = world._hearthArmAt ?? world.step;
    const dtSteps = world.step - lastAt;
    world._hearthArmAt = world.step;
    if (dtSteps > 0) {
      // steps × (years per wave-hop ÷ steps per wave-hop): derived from the
      // wave's own calibration (one hop = EARTH_KM/tw km at DEV_WAVE_KMPY=1
      // km/y over devWaveIvl steps), so the unit is consistent at any grid
      // and granularity without a second time constant.
      const dtYears = dtSteps * (40075 / world.tw) / devWaveIvl(world);
      const keep = [];
      for (const h of world._armedHearths) {
        // Colonised basin → stand down (diffusion won the race to this valley).
        let settledNear = false;
        forEachNear(world, h.tx, h.ty, rB, () => { settledNear = true; });
        if (settledNear) {
          console.log(`[peopleSim] hearth candidate at (${h.tx},${h.ty}) stood down — the farming package arrived before it was invented`);
          continue;
        }
        const basin = townBasinMass(world, h.tx, h.ty, rB);
        let capMass = 0;
        const cap = world.capField, tw = world.tw, th = world.th;
        for (let dy = -rB; dy <= rB; dy++) {
          const yy = h.ty + dy; if (yy < 0 || yy >= th) continue;
          for (let dx = -rB; dx <= rB; dx++) {
            if (dx * dx + dy * dy > rB * rB) continue;
            capMass += cap[yy * tw + (((h.tx + dx) % tw) + tw) % tw];
          }
        }
        h.effY += dtYears * Math.min(1, capMass > 0 ? basin / capMass : 0);
        if (h.effY >= h.needY) {
          if (T.CITY_AT_BIRTH) {
            // The invention is the INVENTION — not a town. The basin is
            // peopled and farming; the site pass concentrates it and the
            // city is born when a real core exists. The hearth stands down —
            // but the practice must RADIATE: with no settlement to carry the
            // technique wave's source, the ground itself does
            // (world._hearthSeeds → stampDevSources; persisted). Without
            // this, a seedless dawn could never leave the forager age.
            (world._hearthSeeds || (world._hearthSeeds = [])).push({ ti: h.ti, agri: NEOLITHIC_AGRI });
            logEvent(world, "farming.invented", { x: h.tx, y: h.ty });
            console.log(`[peopleSim] AGRICULTURE INVENTED at (${h.tx},${h.ty}) — the basin farms; a city will rise when its market gathers one (score ${h.score.toFixed(2)})`);
          } else {
            const born = makeSettlement(world, h.tx + 0.5, h.ty + 0.5, { people: 110, cradle: true });   // a fresh invention is a natural proto-town, never an eve-of-states core
            logEvent(world, "settlement.founded", { s: born.id, sName: born.name, polity: -1, hearth: 1 });
            console.log(`[peopleSim] AGRICULTURE INVENTED at (${h.tx},${h.ty}) — ${born.name}, ${Math.round(h.needY)}y of peopled-basin time served (score ${h.score.toFixed(2)})`);
          }
        } else keep.push(h);
      }
      world._armedHearths = keep;
      if (!keep.length) delete world._armedHearths;
    }
  }

  // Alive-settlement count — shared by the colony saturation damper and the
  // crystallisation saturation damper below (one scan instead of two).
  let _alive = 0;
  for (const s of world.settlements) if (s.mode === "settled") _alive++;

  // Spread is measured in TILES, so a finer-resolution map must scale it like the
  // territory reach does (countryTerritory's RES_REF_W = 240) — otherwise the
  // frontier crawls the same ABSOLUTE tiles/step and a big map fills a far smaller
  // FRACTION per year (the "full-size map barely settles by 1900" bug: 24% claimed
  // at 1950 vs ~40% on the quarter-width reference). Symmetric with resScaleFor: under
  // RES_INVARIANT_POP the clamp is dropped BELOW the reference too, so a coarse sim
  // spreads over the same world-fraction instead of over-claiming (=0 keeps legacy).
  const resScale = T.RES_INVARIANT_POP ? world.tw / 240 : Math.max(1, world.tw / 240);

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

  // State plantation: courts with charters, treasury and spare people found
  // deliberate march/charter towns (see maybePlantTowns).
  if (world.step % _ivlG(PLANT_CHECK_INTERVAL) === 0) maybePlantTowns(world);

  // Crystallisation saturation: settlement-count-dependent damper.
  const saturationDamper = 1 / (1 + (_alive / CRYSTAL_SATURATION_REF) ** 2);

  // Compute per-sweep resource scarcity / value table once.
  const resScarcity = computeResourceScarcity(world);
  // Holy ground: dead sees of great living faiths keep pulling settlement
  // (see holyRuinSites) — the refounded holy city.
  const holySites = holyRuinSites(world);

  // Sample random tiles. For each viable one, compute crystallization
  // probability and roll. No cap on settlement count — spacing
  // (MIN_SETT_DIST) and the fertility filters limit density. In
  // saturated regions every candidate fails the tooClose / area-fert
  // checks, so spawn rate falls off naturally.
  const { N, tw, th, elev, fert, coast, riverMag, transportDist } = world;
  const rng = passRng(world, "crystallize");
  // (LOCALITY_MODE removed 2026-07 — the experiment was superseded by the
  // shipped DISSOLVE_FARMS region model, which owns the spacing below.)
  const spMul = T.DISSOLVE_FARMS ? (T.REGION_SPACING || 2)   // the model's GRANULARITY constant: how much countryside one town-region entity abstracts (see tuning.js REGION_SPACING)
              : 1;
  const rn = rNormFor(world);            // spacing in REAL distance, not tiles (RES_INVARIANT_POP)
  // ── T.LABEL_BIRTH (Tier C phase 1 v3): the SUPPLY is the site ledger ──
  // Under the lever the fixed spacing quantum below (hardFloor/softDist ×
  // capacitySpacingMul — a spacing CONSTANT that pinned planet-wide entity
  // count at ~90 at every grid) stops being consulted by the sweep, and the
  // SWEEP ITSELF INVERTS (design §2c): instead of CANDIDATES_PER_SWEEP
  // random tiles praying to land on viable ground, the pass iterates the
  // LEDGER's unclaimed, bar-clearing sites (deterministic rank order) and
  // rolls each with the SAME probability machinery evaluated at the site
  // tile. O(K≈200) per pass instead of 120 random rejects; the flood-ribbon
  // oversampling retires with the random draw (river sites ARE the valley).
  // Density expresses through ACTIVATION (dense cells clear the bar, sparse
  // never do), supply through the skeleton (∝ real drainage/coast
  // structure). Requires the field (a legacy config without popField keeps
  // the quantum — there is no countryside substrate to read).
  const labelBirth  = T.LABEL_BIRTH >= 1 && !!world.popField;
  const hardFloor   = HARD_FLOOR * spMul * rn;
  const softDist    = SOFT_DIST  * spMul * rn;
  const floodTiles = world._floodTiles, nFlood = floodTiles ? floodTiles.length : 0;
  let siteCand = null;
  if (labelBirth) {
    const L = labelSiteLedger(world), sc = _siteClaims(world);
    const bar = T.LABEL_BAR > 0 ? T.LABEL_BAR : TOWN_BASIN_MIN;
    siteCand = [];
    for (let k = 0; k < L.sites.length; k++) {
      if (!sc.claimed[k] && sc.mass[k] >= bar) siteCand.push(L.sites[k].ti);
    }
  }
  // NB (RES_INVARIANT_POP, measured): scaling THIS candidate count by rn² — the
  // dimensionally-obvious "founding pressure per real area" Phase-3 fix for the
  // 3-seed-systematic ~0.5× EARLY-population undershoot at 2× resolution — was
  // built and MEASURED to do nothing: with 4× the candidates, early settlement
  // counts moved only ~5–10% and the population ratio not at all (0.46/0.44 vs
  // 0.49/0.55 at org 0.25/0.35). Candidate throughput is NOT the binding early
  // channel (spawn success is gated elsewhere — probability/fertility/colony
  // cadence), so the rn²× per-tick cost (16× at full size) was unearned and it
  // was reverted per the I82 precedent. The early undershoot remains OPEN — see
  // docs/resolution-invariance-plan.md for the decomposition to run next.
  // T.CITY_AT_BIRTH: the spontaneous sweep mints NOTHING — genesis belongs to
  // the site pass (maybeSiteCities), which births entities only at the city
  // definition. Zero candidates = the whole channel off under the lever.
  const nSweep = T.CITY_AT_BIRTH ? 0 : (labelBirth ? siteCand.length : CANDIDATES_PER_SWEEP);
  for (let i = 0; i < nSweep; i++) {
    // OFF path: draw a share of candidates straight from the FLOODPLAIN ribbon so
    // the arid river valley actually fills — the uniform random sweep almost never
    // lands on a 1–5-tile-wide strip, which is why the Nile stayed empty despite
    // being prime cropland. Everything downstream (river magnet, spacing, quality)
    // is unchanged. ON path: the candidate IS the next unclaimed bar-clearing site.
    const ti = labelBirth ? siteCand[i]
      : (nFlood && rng() < FLOOD_SAMPLE_FRAC) ? floodTiles[rng.int(nFlood)] : rng.int(N);
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
    tel(world, "found", "CANDIDATE");
    if (areaFert < MIN_AREA_FERT) { tel(world, "found", "areaFertTooLow"); continue; }
    // Visit only the settlements NEAR this candidate (spatial grid, radius
    // MARKET_RANGE × 3), accumulating both:
    //   nearestSq  — for the spacing (anti-overlap) rule
    //   marketPull — for the market-town attraction (positive cluster pull)
    // The radius IS the market cutoff: anything beyond it contributes nothing
    // to either signal (HARD_FLOOR/SOFT_DIST ≪ radius, and the market kernel
    // has decayed to nothing), so the grid query is exact, not approximate.
    // This replaces an O(settlements) scan per candidate — the dominant cost
    // once the map gets dense.
    // MARKET_RANGE is a REAL distance (a market catchment), so it scales with the
    // grid like the founding spacings beside it (hardFloor/softDist ×rn) — unscaled
    // it made clusters tighter in real km the finer the grid (audit 2026-07).
    // ×1 exactly at the 240-tile reference.
    const mktR = MARKET_RANGE * rn;
    const MARKET_CUTOFF = mktR * 3;
    let nearestSq = Infinity;
    let marketPull = 0;
    forEachNear(world, tx, ty, MARKET_CUTOFF, (o, dd) => {
      if (dd < nearestSq) nearestSq = dd;
      const d = Math.sqrt(dd);
      const tierBonus = 1 + (o.tier | 0);
      marketPull += tierBonus * Math.exp(-d / mktR);
    });
    let spacingFactor = 1;
    if (labelBirth) {
      // T.LABEL_BIRTH v3: CELL exclusivity IS the spacing — one label per
      // market cell, no soft ramp, no capacity scaling, no radius on this
      // path. The site list was drawn unclaimed above; this re-check makes
      // acts minted EARLIER THIS PASS visible (a daughter/plantation/sea
      // landing that stamped a claim between the list build and this roll —
      // the gridAdd discipline, on cells).
      if (!labelBasinFree(world, tx, ty)) { tel(world, "found", "basinTaken(LABEL_BIRTH)"); continue; }
    } else {
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
      if (nearestSq < hf * hf) { tel(world, "found", "hardFloorOverlap"); continue; }   // hard reject — overlap
      // Linear ramp between hf and sd on actual distance (not squared, so it
      // grows steeply near the floor and flattens out near the soft boundary —
      // matches the "very close = bad, modest distance = mostly fine" pattern).
      if (nearestSq < sd * sd) {
        const d = Math.sqrt(nearestSq);
        spacingFactor = (d - hf) / (sd - hf);
      }
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
    // Holy ground: the dead see of a great living faith draws resettlement —
    // pilgrims, offerings and memory refound the holy city on its own ruin
    // (Jerusalem's pattern). Purely live state: the pull exists only while
    // the faith is large and its see is dead, and fades with distance.
    if (holySites) {
      const hR = HOLY_PULL_R * rn;
      for (const h of holySites) {
        let dx = Math.abs(h.x - (tx + 0.5)); if (dx > tw / 2) dx = tw - dx;
        const dy = h.y - (ty + 0.5);
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < hR) quality += HOLY_PULL * (1 - d / hR);
      }
    }

    // Transport-distance modifier. Finite td → diffusion from the land
    // network plus the normal independent floor. Infinite td (across water,
    // unreachable by land) → only the much smaller overseas-invention rate,
    // so other landmasses wait to be colonised rather than self-populating.
    const td = transportDist[ti];
    const diffusionMul = isFinite(td) ? Math.exp(-td / (KNOWLEDGE_DECAY_SCALE * resScale)) * NEAR_RATE : 0;   // diffusion REACHES proportionally farther on a finer map
    let independent = isFinite(td) ? INDEPENDENT_RATE : OVERSEAS_INDEPENDENT_RATE;
    // INDEPENDENT INVENTION IS A PROPERTY OF A PEOPLE, NOT OF A TILE (T.INVENT_FIELD).
    // As a flat per-tile floor it says that being five thousand km from the nearest
    // farmer makes you no less likely to invent farming than being 130 tiles away —
    // and because it is ADDED to the distance decay, beyond td ≈ 130 it dominates
    // and CANCELS the decay entirely. Measured consequence (probe_wheretowns, 480/
    // 8817): at step 200 the world holds settlements in NINE regions, the Central
    // Asian steppe the most-settled of them; Siberia has a town at 67°N by step 264;
    // Europe has ten towns before Mesopotamia has five. Every good valley on Earth
    // invents urbanism at once, which is exactly what its own comment ("low so empty
    // regions stay empty until colonised") was trying to prevent.
    //
    // The opportunity for invention is PEOPLE-TIME: farming and town-building are
    // invented where many people have lived on workable land for a long time, which
    // is why there were a handful of neolithic origins rather than one per valley.
    // So the floor is scaled by the basin's own people, measured against the bar the
    // sim ALREADY uses for "enough countryside to carry a town" — no new constant is
    // introduced. A basin exactly at the bar keeps INDEPENDENT_RATE unchanged; ten
    // times the people invents ten times as readily; empty land effectively never.
    // The cradles invent first because that is where the people are, and secondary
    // centres emerge as the field thickens — the shape of the real record, arrived at
    // by mechanism rather than by tuning a rate until seven centres appear.
    if (T.INVENT_FIELD > 0 && world.popField) {
      independent *= townBasinMass(world, tx, ty, Math.round(TOWN_BASIN_R * rn)) / TOWN_BASIN_MIN;
    }
    // T.INDEP_TECH — a town can only crystallize where the PACKAGE HAS ARRIVED.
    // Three measured failures aimed this at the right variable and the right
    // channel: INVENT_FIELD scaled the floor by basin PEOPLE → worse (every
    // fireable site has people); INVENT_STAGGER's handout repair fixed what a
    // newborn KNOWS → the dawn map did not move (the founding still happened);
    // and gating the INDEPENDENT floor alone → byte-identical outcomes at 6k,
    // which proved the floor NEVER BINDS under multi-hearth defaults — with
    // seven hearths every fireable site sits within diffusion reach of some
    // network, and the anachronisms (a steppe town at step 24, 61°N by step
    // 144) ride the DIFFUSION term. That term is exp(−td/·): a probability
    // GRADIENT, not a FRONT — a site 3 000 km from the Indus can found the
    // moment the sim starts, with no waiting for the package to arrive. But
    // the sim HAS a front: devField, the technique wave, at its measured
    // 1 km/year. So the lever scales the WHOLE channel sum by the package's
    // local arrival, devField/NEOLITHIC_AGRI (clamped 0..1): fully-taught
    // ground founds at the unchanged rate (the ratio saturates — mature
    // worlds identical), the wave's edge founds at the edge's fraction, and
    // untaught land founds NOTHING — towns trail the green stain on the
    // Technique lens, which is the wave-of-advance picture the pioneering
    // tempo below already gestures at (it paces by the nearest DONOR's tempo;
    // this paces by the field's actual arrival). Daughter colonies, sea
    // landings and plantations are untouched — those are real settler parties
    // that carry the package with them. No new constant: NEOLITHIC_AGRI is
    // the package's own definition of "full farming". 0 = ungated
    // (byte-identical, and the default).
    const packageFrac = T.INDEP_TECH && world.devField ? Math.min(1, (world.devField[ti] || 0) / NEOLITHIC_AGRI) : 1;
    // ── T.CROWD_FOUND: towns appear where the PEOPLE are ────────────────────
    // Owner, 2026-08: "do cities appear where populations are dense?" Measured:
    // NO, not as a rate. The basin's people are a THRESHOLD (TOWN_BASIN_MIN, a
    // pass/fail gate above) and marketPull counts SETTLEMENTS (tier-weighted,
    // distance-decayed) — so founding tracks where other TOWNS are and where the
    // LAND is good, but a basin at ten times the bar founds no faster than one
    // exactly at it. Historically the opposite: towns crystallise out of dense
    // countryside — the Nile, the Yangtze, the Ganges grew thickets of them
    // while equally fertile but thinly-peopled land grew few.
    //   The rate carries the basin's people RELATIVE TO THE AGE'S TYPICAL
    // SETTLED BASIN (crowdRefMass — the live median over settled sites, the
    // same self-calibrating species as the tier ladder's percentile bars),
    // damped by a square root so it is a gradient and not a runaway: 4× the
    // typical countryside founds ~2× as readily, a quarter of it ~half. Above
    // CROWD_CAP the term saturates (a basin cannot mint towns without limit —
    // the spacing floors and the market-cell exclusivity still bind).
    //   MEASURED, first build (probe_crowdfound A/B 480/8817/6k): normalizing
    // by the TOWN_BASIN_MIN bar instead pegged the cap on 100% of foundings —
    // real settled basins run 150-3300× that bar (p50 249×), so the sqrt's
    // useful range sat two orders below the distribution and the "gradient"
    // degenerated to a blunt ×CAP step on all settled land vs the frontier
    // (foundings 109 → 202, +85%, with the within-settled signal erased). The
    // bar is the FLOOR of viability; the reference for "denser than usual" is
    // the TYPICAL basin, and that is a measurement, not a constant.
    //   NB this is NOT T.INVENT_FIELD, which failed: that scaled the INDEPENDENT
    // INVENTION floor by the same mass and measured worse, because every site
    // that can found at all already clears the bar, so it only ever multiplied
    // up on the isolated frontier. This scales the WHOLE rate, where the
    // ratio's variation across settled land is the signal, and the technique
    // wave (INDEP_TECH, now default-on) independently keeps the frontier shut.
    let crowdMul = 1;
    if (T.CROWD_FOUND > 0 && world.popField) {
      const mass = townBasinMass(world, tx, ty, Math.round(TOWN_BASIN_R * rn));
      crowdMul = Math.min(CROWD_CAP, Math.pow(Math.max(0, mass / crowdRefMass(world)), 0.5 * T.CROWD_FOUND));
    }
    const p = quality * (diffusionMul + independent) * packageFrac * crowdMul * BASE_RATE * saturationDamper * spacingFactor * marketFactor * (world._dt || 1);   // granularity: per-tick settling odds scale with the time-step

    // One draw per candidate (stream-stable), tested twice: first against the
    // full-tempo probability (cheap reject), then against the wave-of-advance
    // tempo of the nearest people — the frontier advances at the pace of the
    // farming capability actually arriving at it. No donor in the disk = a
    // genuinely isolated site = forager-floor pace.
    const _r = rng();
    if (_r >= p) {
      // WHICH throttle actually killed this site? `p` is a product of independent
      // multipliers, so a bare "the roll failed" tally says nothing. Attribute the
      // rejection to the SMALLEST factor — the one doing the suppressing. This is the
      // measurement the ~90-entity supply ceiling has needed: entity count is flat at
      // both grids and in time (docs/tier-c-coupling-survey.md W4/R1), and nothing has
      // ever said whether spacing, market saturation or reach is what pins it.
      if (world._tel) {
        const parts = [["spacing", spacingFactor], ["market", marketFactor],
                       ["saturation", saturationDamper], ["reach/diffusion", diffusionMul + independent]];
        let worst = parts[0];
        for (const pp of parts) if (pp[1] < worst[1]) worst = pp;
        tel(world, "found", `throttled:${worst[0]}`);
      }
      continue;
    }
    // One nearest-donor lookup, shared: the tempo gate reads its agriculture
    // and, on accept, the SAME donor seeds inheritance (passing it as a hint
    // avoids a second identical grid scan, and guarantees tempo and inherited
    // knowledge describe the same people).
    let _donor = null, _bd2 = Infinity;
    forEachNear(world, tx, ty, INHERIT_NEAR_RADIUS, (s, d2) => {
      if (d2 < _bd2) { _bd2 = d2; _donor = s; }
    });
    const _donorAgri = _donor && _donor.knowledge ? (_donor.knowledge.agriculture || NEOLITHIC_AGRI) : NEOLITHIC_AGRI;
    if (_r >= p * pioneerTempo(_donorAgri)) { tel(world, "found", "pioneerTempo(waveOfAdvance)"); continue; }
    telPass(world, "found");
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
      // Found settlements only INSIDE a nation or as a CONNECTED EXTENSION of a
      // nearby settled community — never in the deep wilderness. A candidate is
      // allowed if the tile already lies in a realm's drawn border (region ≥ 0), OR
      // it is a CONNECTED extension of a nearby settled donor (state or stateless —
      // people beget people regardless of politics; whether the daughter also
      // inherits a FLAG is the separate statecraft question below). A DISCONNECTED
      // site (independent origin: another continent, across water, beyond reach) is
      // NOT founded — only a colony party (maybeSendSettlers, carrying its parent's
      // flag) can plant the first settlement on virgin land. Cradles are seeded at
      // world-gen, so the world still bootstraps. (Existing settlements may still
      // become stateless when their realm collapses — a separate path.)
      // STATECRAFT SYMMETRY (docs/country-count-size-diagnosis.md): binding a new
      // village to a realm from OUTSIDE its drawn border is an act of territorial
      // administration — records, tax rolls, delegated authority — and takes the
      // SAME organisation the founding bar (T.ORG_STATE_MIN) demands of a people
      // founding a state. A mother settlement below that bar spreads PEOPLE, not
      // rule: her daughter is born STATELESS (kin beyond the chiefdom's
      // administration — the same status the ride-away steppe path mints), and
      // becomes primary-state fuel (nucleateFrontierStates) or is integrated later
      // once a qualified state's border actually reaches her. Without this gate the
      // org-0.1 cradle realms vacuumed their whole frontier from step one (measured:
      // 20 sub-bar donor-joins by step 1000 — 9-member realms at org 0.11, the
      // "wall-to-wall from genesis" anachronism), which both starved state founding
      // of stateless fuel and made the earliest realms the largest. A village born
      // ON administered ground (region ≥ 0) still joins — the chiefdom rules its
      // own core; it is the LONG ARM beyond the border that needs statecraft.
      // Two SEPARATE questions the old single `joinCountry` conflated:
      //   • DEMOGRAPHY — may a settlement exist here? Yes if it is a connected
      //     extension of ANY living settled community within frontier reach
      //     (people beget people; statehood is irrelevant to spreading), or on
      //     already-administered ground. Deep-wilderness/disconnected sites are
      //     still never founded (colony ships only) — enforced by `connected`
      //     here and the FRONTIER_EXTEND_DIST contiguity check below.
      //   • POLITICS — whose flag, if any? Administered ground's owner; else the
      //     donor's realm ONLY if the mother settlement has the statecraft to
      //     bind a daughter to it (the symmetry gate above); else born stateless.
      const donorOrg = donor && donor.knowledge ? (donor.knowledge.organization || 0) : 0;
      const donorSettled = connected && donor && donor.mode === "settled";
      const donorCountry = donorSettled && donorOrg >= T.ORG_STATE_MIN ? donor.countryId : -1;
      const extension = region >= 0 || donorSettled;
      let joinCountry = region >= 0 ? region : donorCountry;
      // FUNNEL (telemetry.js) — WHY IS THIS SETTLEMENT BORN WITHOUT A FLAG? Measured
      // at the app grid, 91% of settlements are stateless at step 1,500 and they hold
      // 80% of everyone alive — cities of 100,000+ answering to nobody. Statelessness
      // has FOUR separate causes here and they need opposite fixes, so a single
      // "stateless" count cannot guide anything. Tallied at the decision itself.
      if (world._tel) {
        tel(world, "birthPolity", "CANDIDATE");
        if (region >= 0) tel(world, "birthPolity", "PASSED");                       // on administered ground
        else if (!donorSettled) tel(world, "birthPolity", "stateless:noSettledDonor");
        else if (donor.countryId < 0) tel(world, "birthPolity", "stateless:motherIsStatelessToo");
        else if (donorOrg < T.ORG_STATE_MIN) tel(world, "birthPolity", "stateless:motherLacksStatecraft");
        else tel(world, "birthPolity", "PASSED");                                   // inherits the mother's flag
      }
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
            && tileOpenness(world, ti) >= RIDE_AWAY_OPEN_MIN) {
          if (world._tel && joinCountry >= 0) tel(world, "birthPolity", "~lostToRideAway");
          rodeAway = true; joinCountry = -1; }
        // Past the foot ring but NOT genuine ridable steppe → not a frontier
        // extension the court can hold, and not a horde birth → no settlement.
        if (dd2 > fed * fed && !rodeAway) continue;
      }
      if (!extension && !rodeAway) continue;   // demographic gate: connected extension or horde birth — a FLAG is not required to be born (see the statecraft symmetry above)
      // THE URBAN FLOOR: an entity is a town, and a town only coalesces where
      // the countryside can people it. Read the basin's field mass; too thin →
      // no entity yet — the ground stays field-peopled countryside (the wave
      // of advance carries on in the FIELD; the town follows the people, not
      // the other way round). Camps are exempt (ordu, not towns — see above).
      const townScale = !rodeAway && !!world.popField;
      if (townScale) {
        // T.DISSOLVE_TOWNS — settlements are ONLY cities (owner 2026-08-05:
        // "settlements should be ONLY cities. No towns"). An entity mints only
        // where the basin could feed a CITY: catchment census ≥ TIER_CORE[2] /
        // URBAN_SHARE_REF — a 10k core at the measured ~5% pre-industrial
        // urban share needs a ~200-census (200,000-person) market basin. Both
        // terms have independent meaning: the core floor is the ladder's own
        // city DEFINITION; the share is measured in this sim (core share p50
        // 4.6-5.6% across every probe arm and step, docs/state-birth-2026-08)
        // and historically (~3-8% urban before industry). The FIRST build
        // scaled the TOWN_BASIN_MIN floor ×5 instead and measured INERT —
        // byte-identical arcs — because that floor is a fossil two orders
        // below real settled basins (founding sites measured 143-3300× it);
        // the census form is the live quantity. Villages AND towns then live
        // in the land — popField and each city's belt — exactly as villages
        // already do under DISSOLVE_FARMS. The hearth-cradle bootstrap keeps
        // its own (longer) emergent bar — the first cities ARE the hearth
        // cities — and pre-bridge (no _onePopScale yet) the census cannot be
        // read, so the legacy floor stands for those few dawn steps.
        if (labelBirth) {
          // T.LABEL_BIRTH v3 — the ACTIVATION bar: the site's cell (its
          // exclusive countryside, cell ∩ horizon by construction) must hold
          // the bar in MASS. Cells PARTITION the in-horizon land, so no
          // villager is ever counted toward two markets — the same
          // conservation the fieldShift debit enforces on the founders
          // themselves. (The sweep pre-filtered on this; the act re-reads
          // the same cached answer as its own guard.)
          if (labelBasinMass(world, tx, ty) < (T.LABEL_BAR > 0 ? T.LABEL_BAR : TOWN_BASIN_MIN)) continue;
        } else {
          if (townBasinMass(world, tx, ty, Math.round(TOWN_BASIN_R * rn)) < TOWN_BASIN_MIN) continue;
        }
        // The city-capability bar reads the DISK basin under both arms — the
        // market reach a city needs does not care about label-cell partitions.
        if (!cityBasinOkAt(world, tx, ty)) continue;
      }
      // (people drawn here, after the last reject, so the rng stream is unchanged)
      const roll = rng.int(8);
      const bornPeople = townScale ? TOWN_FOUND_MIN + roll * 4 : 18 + roll;
      // FISC TEST (T.FISC_ADOPT): booking a newborn community onto the tax rolls is
      // an act of administration the court must be able to AFFORD — the capacity its
      // people bring must cover the admin load of governing them (entities.js). A
      // hamlet the fisc cannot carry is born STATELESS instead (people, not rule —
      // the same status the statecraft-symmetry gate mints), staying primary-state
      // fuel until a court that CAN afford it reaches it. This is the birth-grant
      // half of the early overextension: realms no longer book countryside their
      // revenue cannot govern just because it crystallised inside their border.
      if (joinCountry >= 0
          && !fiscAdoptable(world, world.countries && world.countries.get(joinCountry), tx + 0.5, ty + 0.5, bornPeople)) {
        if (world._tel) tel(world, "birthPolity", "~lostToFiscalRefusal");
        joinCountry = -1;
      }
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
      // The founders leave the countryside: debit the basin field around the
      // site (ring-cascade, nearest first) — makeSettlement's ONE_POP credit
      // then stands them at the new town, so founding a town moves people off
      // the land instead of creating them (one population, conserved).
      if (townScale) fieldShift(world, { pos: { x: tx + 0.5, y: ty + 0.5 } }, -bornPeople);
      const born = makeSettlement(world, tx + 0.5, ty + 0.5, {
        people: bornPeople,
        knowledge: bornKnow,
        countryId: joinCountry,   // born into the realm it sits in / extends — stateless (-1) for a rode-away steppe camp or a daughter of a sub-ORG_STATE_MIN mother (statecraft symmetry)
        parentId: donor.id,   // carries the donor's ancestry; a long jump admixes with the local substrate
        // near spread keeps the donor's people; otherwise we assign below
        cultureId: (connected && !isBranch) ? dCul : -1,
        tier: T.DISSOLVE_FARMS ? 1 : 0,   // DISSOLVE: there are no farming regions — new settlements are towns
      });
      gridAdd(world, born);   // same-pass candidates must see (and space off) it
      if (labelBirth) labelClaimBasin(world, tx, ty);   // ...and the basin law must see its claim
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

// ── Holy-city refounding (religious genesis) ─────────────────────────
// A faith's founding see is its holy city (faiths.js: pilgrimage and
// offerings already flow to it while it stands). When the see DIES but the
// faith lives on large, the SITE keeps its sanctity — pilgrims still come,
// and history refounds the holy city on its own ruin (Jerusalem, rebuilt
// again and again; Rome resettled around its shrines). Model: dead origin
// settlements of faiths whose flock still dominates ≥ HOLY_FLOCK_MIN towns
// project a settlement pull around their site (used in the sweep's quality
// score). Pure live state — the pull appears when a see falls, persists
// while the faith is great, and fades if the faith does.
const HOLY_FLOCK_MIN = 6;    // towns whose dominant faith it is — a great faith, not a fading sect
const HOLY_PULL      = 3.0;  // peak quality bonus at the ruin itself (river-magnet order)
const HOLY_PULL_R    = 5;    // REFERENCE-tiles of sanctity around the dead see (×rn at use)
function holyRuinSites(world) {
  if (!world.faiths || !world.faiths.size || !world._byId) return null;
  let flock = null, out = null;
  for (const [, f] of world.faiths) {
    if (!f || f.originSettlementId == null || f.originSettlementId < 0) continue;
    const org = world._byId.get(f.originSettlementId);
    if (!org || org.mode === "settled" || !org.pos) continue;   // see stands (or is gone entirely) — no ruin to refound
    if (!flock) {   // dominant-faith census, built lazily only when some see is dead
      flock = new Map();
      for (const s of world.settlements) {
        if (s.mode !== "settled") continue;
        const df = dominantFaith(s);
        if (df >= 0) flock.set(df, (flock.get(df) || 0) + 1);
      }
    }
    if ((flock.get(f.id) || 0) < HOLY_FLOCK_MIN) continue;
    (out || (out = [])).push({ x: org.pos.x, y: org.pos.y });
  }
  return out;
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
    forEachNear(world, parent.pos.x, parent.pos.y, FRONTIER_RADIUS * rNormFor(world), () => { localN++; });
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
  if (T.LABEL_BIRTH >= 1 && world.popField) {
    // T.LABEL_BIRTH v3: the colony stays a parent ACT — its people are
    // carried, so no activation BAR applies (the party is its own founding
    // population; virgin frontier cells hold no field mass and must stay
    // colonisable) — but it SITES through the ledger: the party walks to the
    // best UNCLAIMED market site in its existing range and founds AT it, so
    // the label stands on its site (claim reconstruction at load is exact).
    // No unclaimed site in range = fail-and-wait (the party simply isn't
    // sent this roll — design OQ4). The capacity-spacing quantum retires
    // with the sweep's (survey §4), and no radius replaces it (the v1
    // error); the deterministic K≈200 site scan replaces the random annulus
    // sample.
    const L = labelSiteLedger(world);
    const rnD = rNormFor(world);
    const rMin = COLONY_MIN_RANGE * rnD, rMax = COLONY_RANGE * rnD;
    const rMin2 = rMin * rMin, rMax2 = rMax * rMax;
    for (let k = 0; k < L.sites.length; k++) {
      const st = L.sites[k];
      let ddx = Math.abs(st.x + 0.5 - parent.pos.x); if (ddx > tw / 2) ddx = tw - ddx;
      const ddy = st.y + 0.5 - parent.pos.y;
      const d2 = ddx * ddx + ddy * ddy;
      if (d2 < rMin2 || d2 > rMax2) continue;
      const tx = st.x, ty = st.y, ti = st.ti;
      if (ty < 1 || ty >= th - 1) continue;
      if (!isContinentalLand(world, ti)) continue;
      if (fert[ti] < MIN_FERT) continue;
      if (!labelBasinFree(world, tx, ty)) continue;
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
      if (q > bestQ) { bestQ = q; best = { ti, tx, ty }; }   // strict >: ties keep the better site rank
    }
  } else {
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
    {
      const spacing = MIN_SETT_DIST * rNormFor(world) * capacitySpacingMul(fert[ti], hostilityAt(world, ti));
      let tooClose = false;
      forEachNear(world, tx, ty, spacing, () => { tooClose = true; });
      if (tooClose) continue;
    }
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
  }
  if (!best) return;
  // T.DISSOLVE_TOWNS: the crown plants CITIES — a site whose basin cannot
  // feed one is not planted (checked BEFORE the demographic cost, so no
  // settler party is debited for a rejected site).
  if (!cityBasinOkAt(world, best.tx, best.ty)) return;
  // Pay the demographic cost: a chunk of the parent's people leaves with
  // them. They take some of the parent's tech (full inheritance — they're
  // literate citizens of the realm, not isolated frontier inventors).
  const settlers = Math.min(COLONY_SEND_CAP, Math.round(parent.people * COLONY_SEND_FRAC));
  if (settlers < 25) return;
  parent.people -= settlers;
  fieldShift(world, parent, -settlers);   // one population: the colonists leave this ground (ONE_POP; no-op otherwise)
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
  if (T.LABEL_BIRTH >= 1 && world.popField) labelClaimBasin(world, best.tx, best.ty);   // the basin law too
}

// ── State plantation: the DELIBERATE town (colonia / bastide / gord) ────
// The genesis family the sweep cannot express: a town founded by a COURT for
// reasons of state, not by a basin's own economics. Two intents, both read
// from live political state (never a date, never a name):
//   • MARCH town — planted on the realm's own claimed border facing another
//     realm, at an unserved stretch, preferring defensible ground and the
//     borders its people are AGGRIEVED at (the grievance ledger): the limes
//     fort-town, the bastide line, the frontier gord.
//   • CHARTER town — planted in a governed but town-less interior basin (a
//     peopled countryside more than a market-catchment from any settlement):
//     the administrative seat that brings the hinterland onto the rolls.
// It takes a literate administration (org ≥ PLANT_ORG_MIN — charters and
// surveys), a funded treasury (the endowment MOVES, conserved, into the new
// town), spare capital population (the settlers are moved, ONE_POP-debited,
// from the capital — a plantation is the state relocating its own people,
// which is why it is EXEMPT from the sweep's basin bar), and a court within
// its governing budget. The planted town joins the realm at birth with the
// capital's knowledge and culture, and is provisioned by the existing
// colony-supply channel (parentId → conquest.js). A charter town that
// prospers can grow into the realm's leading city and take the throne
// through the ordinary capital selection — the planned-capital arc
// (Baghdad) emerging from growth rather than fiat.
const PLANT_CHECK_INTERVAL = 480;   // ticks between plantation considerations (per world; realms gate below)
const PLANT_ORG_MIN        = 0.35;  // written administration: charters + surveying (the colonia/bastide bar)
const PLANT_COST           = 1200;  // treasury endowment the settlers carry (conserved: treasury → town wealth)
const PLANT_PEOPLE         = 100;   // settlers moved out of the capital (town-scale — the urban floor's own size)
const PLANT_CAP_MIN_POP    = 500;   // (legacy absolute; superseded by PLANT_CAP_MULT under T.PLANT_EARLY)
// T.PLANT_EARLY: the state-planted-city channel (colonia, bastide, march fort,
// Alexandria, St Petersburg) was measurably DORMANT until ~step 25k because
// PLANT_CAP_MIN_POP = 500 census demands a half-million-catchment METROPOLIS
// capital before a state may found a town (docs/state-birth-2026-08.md: "planted
// zero by step 8000, every check blocked on capital-too-small"). That is an
// anachronism — small organized states colonized aggressively (the Greek poleis
// founded hundreds of colonies at city sizes of tens of thousands; early Rome's
// coloniae; Assyrian and Neo-Babylonian foundations). Colonization scales with
// STATECRAFT and SURPLUS, not with owning a metropolis. Re-grounded: the capital
// must simply be a real regional CENTRE relative to the age's typical town
// (world._townBar, the self-calibrating median settled census the tier ladder
// already maintains) AND able to spare the settler party without gutting itself.
// Self-scaling, so it opens across the WHOLE arc — states found cities in the
// bronze age as they historically did — instead of only once capitals are
// industrial. Never a clock; every term is live census/statecraft.
const PLANT_CAP_MULT       = 2.5;   // capital ≥ this × the age's typical town (a real centre, not any town)
const PLANT_SPARE_MULT     = 2.0;   // ...and ≥ this × the settler party it sends (people genuinely to spare)
// The funnel measurement (probe_plantfunnel) then caught the deeper units bug —
// the CLAUDE.md's own most-repeated-mistake class: PLANT_PEOPLE = 100 CENSUS is
// a settler party of 100,000 people, and PLANT_COST = 1200 coin sits above every
// measured pre-classical treasury (medians 1-170). A large historical colonia
// party was a few THOUSAND settlers (Greek apoikiai: hundreds of families).
// Under T.PLANT_EARLY the party is 6 census (≈6,000 settlers) and the endowment
// is priced PER SETTLER (12 coin/census — outfit, passage, seed grain), so the
// channel opens when statecraft (the org bar) says so, not when a treasury
// crosses an industrial-scale constant.
const PLANT_EARLY_PEOPLE   = 6;     // census — the large-colony settler party (~6,000 people)
const PLANT_COIN_PER_CENSUS = 12;   // endowment per census of settlers (outfit + passage + seed)
const PLANT_STRAIN_MAX     = 0.85;  // no planting past the governing budget (COLONY_HEADROOM precedent)
const PLANT_COOLDOWN       = 2400;  // ticks between plantations per realm
// A plantation obeys the SAME minimum spacing as any founding (the sweep's
// capacity-scaled hard floor) — and nothing more. Measured: any larger
// "isolation" requirement contradicts the map's own geometry (a realm's
// every tile, border included, sits within ~4-6 of the towns whose reach
// draws its claim — 9-, 6- and even intent-split 4/6-tile radii each killed
// ~90% of all candidates). Historically right too: bastides and limes forts
// were planted BETWEEN existing towns, on the line itself; what keeps
// plantations meaningful is the SCORE (a real border, a peopled basin), not
// empty ground around them.
const PLANT_CAND_MAX       = 4;     // border/frontier seed candidates kept per realm (deterministic reservoir)
const PLANT_SCORE_MIN      = 0.7;   // don't plant for nothing: an empty frontier scores below this
const PLANT_SURVEY_R       = 5;     // REFERENCE-tiles the founding party surveys around a seed for the plot
const PLANT_SURVEY_TRIES   = 8;     // plots sampled per seed (first try = the seed itself)
function maybePlantTowns(world) {
  if (!world.countries || !world._countryOwner || !world.popField) return;
  const { N, tw, elev, fert } = world;
  const co = world._countryOwner, pf = world.popField;
  const rng = passRng(world, "plant");
  const rn = rNormFor(world), rn2 = rn * rn;
  // Realms eligible to plant this pass (all gates are live political state).
  const eligible = new Map();
  // Gate telemetry (write-only, probe-readable — the maxBuildSpan pattern).
  const dbg = world.debug ? (world.debug.plant || (world.debug.plant = { pop: 0, org: 0, strain: 0, coin: 0, cool: 0, elig: 0, cand: 0, iso: 0, planted: 0 })) : null;
  // Party + endowment at their re-derived scale under T.PLANT_EARLY (see the
  // constants' units note); the legacy pair off-lever, byte-identical.
  const plantPeople = T.PLANT_EARLY ? PLANT_EARLY_PEOPLE : PLANT_PEOPLE;
  const plantCost = T.PLANT_EARLY ? PLANT_EARLY_PEOPLE * PLANT_COIN_PER_CENSUS : PLANT_COST;
  for (const [cid, c] of world.countries) {
    const cap = c.capital;
    if (!cap || cap.mode !== "settled") { if (dbg) dbg.pop++; continue; }
    // Can this state found a town? Under T.PLANT_EARLY the bar is RELATIVE — a
    // real regional centre (≥ PLANT_CAP_MULT × the age's typical town) with
    // people to spare (≥ PLANT_SPARE_MULT × the settler party). Off: the legacy
    // absolute-metropolis bar (byte-identical).
    if (T.PLANT_EARLY) {
      const typical = world._townBar || PLANT_CAP_MIN_POP;
      const need = Math.max(PLANT_CAP_MULT * typical, PLANT_SPARE_MULT * plantPeople);
      if ((cap.people || 0) < need) { if (dbg) dbg.pop++; continue; }
    } else if ((cap.people || 0) < PLANT_CAP_MIN_POP) { if (dbg) dbg.pop++; continue; }
    if (((cap.knowledge && cap.knowledge.organization) || 0) < PLANT_ORG_MIN) { if (dbg) dbg.org++; continue; }
    const pol = getPolity(world, cid);
    if (!pol || pol.endedStep >= 0) continue;
    if ((pol._strain ?? 0) >= PLANT_STRAIN_MAX) { if (dbg) dbg.strain++; continue; }
    if ((pol.treasury || 0) < plantCost) { if (dbg) dbg.coin++; continue; }
    if (world.step - (pol._lastPlant ?? -Infinity) < PLANT_COOLDOWN) { if (dbg) dbg.cool++; continue; }
    if (dbg) dbg.elig++;
    eligible.set(cid, { cid, c, cap, pol, march: [], inland: [] });
  }
  if (!eligible.size) return;
  // One strided sweep over the map gathers bounded candidate lists for every
  // eligible realm at once (a deterministic reservoir per list) — no per-realm
  // O(N) scans. The siting domain is the realm's EDGE, because that is where
  // plantations historically went (measured: inside a healthy realm every
  // tile is within ~4 of a town — the interior is already served):
  //   • an OWNED tile touching a FOREIGN realm  → march candidate (the line);
  //   • an UNOWNED tile touching the realm's own claim → frontier candidate —
  //     a march if some other realm also touches it (a contested gap), else
  //     a charter (the state extends rule over the peopled unclaimed basin —
  //     the colonia-on-annexed-land pattern; the town then anchors territory
  //     there through the ordinary reach mechanics).
  const stride = 5;
  for (let ti = rng.int(stride); ti < N; ti += stride) {
    if (elev[ti] <= 0) continue;
    if ((fert[ti] || 0) < 0.02) continue;               // a town needs a toehold (OUTPOST_FERT_MIN)
    const own = co[ti];
    const ty = (ti / tw) | 0, tx = ti - ty * tw;
    const xm = tx === 0 ? tw - 1 : tx - 1, xp = tx === tw - 1 ? 0 : tx + 1;
    const ns = [ty * tw + xm, ty * tw + xp, ti - tw, ti + tw];
    let e = null, foe = -1;
    if (own >= 0) {
      e = eligible.get(own);
      if (!e) continue;
      for (const ni of ns) {
        if (ni < 0 || ni >= N) continue;
        const o = co[ni];
        if (o >= 0 && o !== own) { foe = o; break; }
      }
      if (foe < 0) continue;   // served interior — nothing to plant for (measured)
    } else {
      // Unowned frontier: does an eligible realm's claim touch it — and does a
      // rival's too (a contested gap)?
      let mine = -1;
      for (const ni of ns) {
        if (ni < 0 || ni >= N) continue;
        const o = co[ni];
        if (o < 0) continue;
        if (mine < 0 && eligible.has(o)) mine = o;
        else if (mine >= 0 && o !== mine) { foe = o; break; }
      }
      if (mine < 0) continue;
      e = eligible.get(mine);
    }
    const list = foe >= 0 ? e.march : e.inland;
    const item = foe >= 0 ? { ti, tx, ty, foe } : { ti, tx, ty };
    if (list.length < PLANT_CAND_MAX) list.push(item);
    else { const j = rng.int(list.length * 3); if (j < list.length) list[j] = item; }   // decaying reservoir: keeps a spread, stays deterministic
  }
  // The founding spacing floor every plot obeys (see the note above) —
  // WITHOUT the capacity-spacing widening: a plantation is provisioned by
  // the state (colony supply from home), not by the land under it, so the
  // thin-soil frontier does not push it away as it would an organic
  // village. The flat floor only prevents stacking on a town.
  // T.LABEL_BIRTH deliberately does NOT re-key this to the site-ledger law: a
  // march/charter town is a state ACT planted ON the line between towns by
  // design (the measured note above: any isolation radius ≥6 killed ~90% of
  // all candidates), state-provisioned rather than cell-fed — marches are
  // forts, not markets (design §2c). The same reasoning that already exempts
  // plantations from the sweep's activation BAR extends to requiring a free
  // SITE. Once planted it is an ordinary label and claims the cell it stands
  // in (if any) against future foundings.
  const spMul = T.DISSOLVE_FARMS ? (T.REGION_SPACING || 2) : 1;
  const isoR = HARD_FLOOR * spMul * rn;
  const surveyR = PLANT_SURVEY_R * rn;
  const scoreAt = (e, foe, ti, tx, ty) => {
    if (foe !== undefined) {
      // A march is worth holding as such; defensible ground and an
      // aggrieved border raise the priority (the ledger, loyaltyField.js).
      return 1.0 + defensibilityFor(world, ti, tx, ty) * 0.4 + 2.5 * grievOf(world, e.cid, foe);
    }
    // Charter value = the ungoverned-in-practice people around the site
    // (local field mass, res-normalised — a peopled hinterland with no
    // town is admin friction the seat would remove).
    const ty0 = ty > 0 ? ti - tw : ti, ty1 = ty < world.th - 1 ? ti + tw : ti;
    const cross = pf[ti] + pf[ty * tw + (tx === 0 ? tw - 1 : tx - 1)] + pf[ty * tw + (tx === tw - 1 ? 0 : tx + 1)] + pf[ty0] + pf[ty1];
    return (cross * rn2) / 60;
  };
  for (const e of eligible.values()) {
    let best = null, bestScore = PLANT_SCORE_MIN;
    // A seed candidate marks the REGION; the founding party surveys around it
    // for the actual plot (a short ring walk, the sendSettlers pattern) —
    // measured necessity: realms here are so compact that their entire border
    // skin lies within the spacing floor of some town (17/19 seed tiles
    // failed it), so the party must be able to step outward from the line.
    for (const cand of e.march.concat(e.inland)) {
      if (dbg) dbg.cand++;
      for (let k = 0; k < PLANT_SURVEY_TRIES; k++) {
        const ang = rng() * Math.PI * 2;
        const rr = k === 0 ? 0 : (0.3 + 0.7 * rng()) * surveyR;
        const sx = ((Math.round(cand.tx + Math.cos(ang) * rr) % tw) + tw) % tw;
        const sy = Math.round(cand.ty + Math.sin(ang) * rr);
        if (sy < 1 || sy >= world.th - 1) continue;
        const ti = sy * tw + sx;
        if (elev[ti] <= 0 || (fert[ti] || 0) < 0.02 || !isContinentalLand(world, ti)) continue;
        const o = co[ti];
        if (o >= 0 && o !== e.cid) continue;             // never plant inside another realm
        let taken = false;
        forEachNear(world, sx + 0.5, sy + 0.5, isoR, () => { taken = true; });
        if (taken) { if (dbg) dbg.iso++; continue; }
        const score = scoreAt(e, cand.foe, ti, sx, sy);
        if (score > bestScore) { bestScore = score; best = { tx: sx, ty: sy, foe: cand.foe }; }
      }
    }
    if (!best) continue;
    const { cap, pol, cid } = e;
    // Found it: settlers and endowment MOVE (both conserved) — the state
    // relocates people and coin it already has.
    pol.treasury -= plantCost;
    pol._lastPlant = world.step;
    cap.people -= plantPeople;
    fieldShift(world, cap, -plantPeople);
    const town = makeSettlement(world, best.tx + 0.5, best.ty + 0.5, {
      people: plantPeople,
      knowledge: { ...cap.knowledge },
      countryId: cid,
      parentId: cap.id,               // provisioned from home while young (conquest.js colony supply)
      kind: "planted",
      cultureId: dominantCulture(cap),
      tier: 1,
    });
    town.wealth = (town.wealth || 0) + plantCost;
    town._integratedAt = world.step;
    gridAdd(world, town);
    // Exempt from the ledger LAW for siting (see above) — but once planted it
    // is an ordinary label and its cell claim must be visible same-pass.
    if (T.LABEL_BIRTH >= 1 && world.popField) labelClaimBasin(world, best.tx, best.ty);
    if (dbg) dbg.planted++;
    logEvent(world, "town.planted", {
      s: town.id, sName: town.name, polity: cid,
      march: best.foe !== undefined ? true : undefined,
      x: best.tx, y: best.ty,
    });
  }
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
    fieldShift(world, region, -seed);   // one population: the founders leave this ground (ONE_POP; no-op otherwise)
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
    if (T.LABEL_BIRTH >= 1 && world.popField) labelClaimBasin(world, best.tx, best.ty);   // basin-law parity (legacy non-DISSOLVE path)
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
  // Construction matches the genesis-village package (settlement.js
  // makeSettlement): a people that invents farming invents the pot and the
  // granary with it — the two values describe ONE late-neolithic moment.
  // T.INVENT_STAGGER: the free handout ends — an isolated site inherits the
  // agriculture that has actually REACHED its ground (devField, the technique
  // wave), not a flat NEOLITHIC_AGRI. The land knows what it has been taught:
  // a frontier the wave covered founds farming at the wave's local level, a
  // valley the wave never reached founds knowing none — and its density,
  // economy and survival follow from that, with no distance constant deciding
  // anything. (The wrong-places finding — the steppe out-settling Mesopotamia,
  // Siberia farming at 67°N — was this handout; docs/state-birth-2026-08.md.)
  // Deletes a constant from the founding path rather than adding one.
  const agBase = T.INVENT_STAGGER && world.devField ? (world.devField[ti] || 0) : NEOLITHIC_AGRI;
  const baseline = {
    agriculture: agBase,
    construction: 0.18,
    organization: birthOrgAt(world, tx, ty, 0.1),   // site-scaled birth organisation (T.ORG_BIRTH_VAR)
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

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
import { computeTransport } from "./transport.js";

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
const SOFT_DIST                 = 14;         // beyond this, the spacing factor is 1 (no penalty)
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
const MIN_SETT_DIST             = 8;          // kept for daughter-colony search hardcoding
const MIN_SETT_DIST_SQ          = MIN_SETT_DIST * MIN_SETT_DIST;
const KNOWLEDGE_DECAY_SCALE     = 30;
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
const OVERSEAS_INDEPENDENT_RATE = 0.0015;
const NEAR_RATE                 = 1.50;
const BASE_RATE                 = 0.010;
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
const COLONY_SATURATION_REF   = 350;  // gentle density guard (carrying capacity) — country count is now emergent (circumscription), not damper-forced

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
const CRYSTAL_SATURATION_REF = 350;  // gentle density guard; many villages, country count emergent
export function maybeCrystallize(world) {
  if (world.step % CRYSTAL_INTERVAL !== 0) return;

  // Refresh transport map if stale or absent.
  if (!world.transportDist || world.step - (world._transportStep || -Infinity) > TRANSPORT_REFRESH_TICKS) {
    world.transportDist = computeTransport(world);
    world._transportStep = world.step;
  }

  // Mother-country expansion: pressed towns send settler parties (see
  // sendSettlers — this is the entire "population pressure → new colony"
  // axis, distinct from the random crystallisation sweep below).
  if (world.step % COLONY_CHECK_INTERVAL === 0) maybeSendSettlers(world);

  // Crystallisation saturation: settlement-count-dependent damper.
  let _alive = 0;
  for (const s of world.settlements) if (s.mode === "settled") _alive++;
  const saturationDamper = 1 / (1 + (_alive / CRYSTAL_SATURATION_REF) ** 2);

  // Compute per-sweep resource scarcity / value table once.
  const resScarcity = computeResourceScarcity(world);

  // Sample random tiles. For each viable one, compute crystallization
  // probability and roll. No cap on settlement count — spacing
  // (MIN_SETT_DIST) and the fertility filters limit density. In
  // saturated regions every candidate fails the tooClose / area-fert
  // checks, so spawn rate falls off naturally.
  const { N, tw, th, elev, fert, coast, riverMag, transportDist, rng } = world;
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
    // Walk existing settlements ONCE, accumulating both:
    //   nearestSq  — for the spacing (anti-overlap) rule
    //   marketPull — for the market-town attraction (positive cluster pull)
    // A market-area-bonus cutoff distance (MARKET_RANGE × 3) skips far-away
    // settlements that contribute nothing to either signal.
    const MARKET_CUTOFF_SQ = (MARKET_RANGE * 3) * (MARKET_RANGE * 3);
    let nearestSq = Infinity;
    let marketPull = 0;
    let earlyExit = false;
    for (const o of world.settlements) {
      if (o.mode === "dead") continue;
      let ddx = Math.abs(o.pos.x - tx);
      if (ddx > tw / 2) ddx = tw - ddx;
      const ddy = o.pos.y - ty;
      const dd = ddx * ddx + ddy * ddy;
      if (dd < nearestSq) {
        nearestSq = dd;
        if (dd < HARD_FLOOR_SQ) { earlyExit = true; break; }
      }
      if (dd < MARKET_CUTOFF_SQ) {
        const d = Math.sqrt(dd);
        const tierBonus = 1 + (o.tier | 0);
        marketPull += tierBonus * Math.exp(-d / MARKET_RANGE);
      }
    }
    if (earlyExit || nearestSq < HARD_FLOOR_SQ) continue;       // hard reject — overlap
    // Linear ramp between HARD_FLOOR and SOFT_DIST on actual distance (not
    // squared, so it grows steeply near the floor and flattens out near the
    // soft boundary — matches the "very close = bad, modest distance =
    // mostly fine" historical pattern).
    let spacingFactor = 1;
    if (nearestSq < SOFT_DIST_SQ) {
      const d = Math.sqrt(nearestSq);
      spacingFactor = (d - HARD_FLOOR) / (SOFT_DIST - HARD_FLOOR);
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
    quality += resourceBonusFor(world, ti, resScarcity);
    quality += busyRoadBonusFor(world, ti, tx, ty);
    quality += geoBonusFor(world, ti, tx, ty);   // chokepoints / passes / sheltered harbours

    // Transport-distance modifier. Finite td → diffusion from the land
    // network plus the normal independent floor. Infinite td (across water,
    // unreachable by land) → only the much smaller overseas-invention rate,
    // so other landmasses wait to be colonised rather than self-populating.
    const td = transportDist[ti];
    const diffusionMul = isFinite(td) ? Math.exp(-td / KNOWLEDGE_DECAY_SCALE) * NEAR_RATE : 0;
    const independent = isFinite(td) ? INDEPENDENT_RATE : OVERSEAS_INDEPENDENT_RATE;
    const p = quality * (diffusionMul + independent) * BASE_RATE * saturationDamper * spacingFactor * marketFactor;

    if (rng() < p) {
      // Inherited knowledge: blend from nearest settlement, weighted by
      // distance. Far sites start near baseline neolithic knowledge.
      const inherited = inheritKnowledgeAt(world, ti, td);
      // A spawned village is NEVER its own country. It ADOPTS the country that
      // owns the tile it's founded on (world._countryOwner), or is born STATELESS
      // (-1) if that's open wilderness — a frontier hamlet that's just population
      // until a state's territory reaches it (adoptAndFound) or it grows into a
      // city and founds a realm. This is what keeps the political map clean
      // however many villages spawn: villages add people, never countries/flecks.
      const region = world._countryOwner ? world._countryOwner[ti] : -1;
      makeSettlement(world, tx + 0.5, ty + 0.5, {
        people: 18 + (rng.int(8)),
        knowledge: inherited,
        countryId: region >= 0 ? region : -1,
      });
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

// ── Settler colonisation (mode #1): parent-driven founding ───────────
// Each pass, every viable parent town that's both population-pressed and off
// cooldown rolls to send a settler party. The party walks up to COLONY_RANGE
// tiles to a viable empty site (picks the best one out of a small sample) and
// founds a daughter joining the parent's realm. Cooldown stops a single town
// from spamming colonies; settler-cost shaves the parent's population so
// expansion has a real demographic cost (you trade headcount for territory).
function maybeSendSettlers(world) {
  if (!world.transportDist) return;
  const { rng } = world;
  // Saturation: colonies get rarer as the map fills, so settlement density
  // plateaus instead of climbing forever (see COLONY_SATURATION_REF).
  let _alive = 0;
  for (const s of world.settlements) if (s.mode === "settled") _alive++;
  const colonySat = 1 / (1 + (_alive / COLONY_SATURATION_REF) ** 2);
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
    const gov = world.governments && world.governments.get(parent.countryId);
    if (gov && (gov._solvency ?? 1) < COLONY_MIN_SOLVENCY) continue;
    // Pressed: at or near carrying capacity (either food or housing) — the
    // people would otherwise sit at the ceiling. updatePopulation set s._k.
    const k = parent._k || 1;
    if (parent.people / k < COLONY_PRESS_FRAC) continue;
    if (rng() >= COLONY_CHANCE * colonySat) continue;
    sendSettlers(world, parent);
  }
}

function sendSettlers(world, parent) {
  // Find a viable empty site within walking range. Score by quality (same
  // ingredients as the random sweep) and pick the best.
  const { tw, th, elev, fert, coast, riverMag, rng } = world;
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
    // Spacing check against existing settlements.
    let tooClose = false;
    for (const o of world.settlements) {
      if (o.mode === "dead") continue;
      let ddx = Math.abs(o.pos.x - tx); if (ddx > tw / 2) ddx = tw - ddx;
      const ddy = o.pos.y - ty;
      if (ddx * ddx + ddy * ddy < MIN_SETT_DIST_SQ) { tooClose = true; break; }
    }
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
    name: "colony-" + parent.id + "-" + world.step,
  });
  if (parent.history) parent.history.push({ step: world.step, type: "colony-sent", to: daughter.id, settlers });
}

// Pick the nearest settlement (by straight-line distance, cheap), then
// blend its knowledge with a baseline based on how isolated this site
// is in transport terms. Settlements that crystallise right next to a
// city inherit most of its tech; isolated cradles start near baseline.
function inheritKnowledgeAt(world, ti, td) {
  const { tw } = world;
  const ty = (ti / tw) | 0, tx = ti - ty * tw;
  let nearest = null, bestD2 = Infinity;
  for (const s of world.settlements) {
    if (s.mode !== "settled") continue;
    let dx = Math.abs(s.pos.x - tx);
    if (dx > tw / 2) dx = tw - dx;
    const dy = s.pos.y - ty;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2) { bestD2 = d2; nearest = s; }
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

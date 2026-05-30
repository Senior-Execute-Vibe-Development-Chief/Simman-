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
const MIN_SETT_DIST             = 8;
const MIN_SETT_DIST_SQ          = MIN_SETT_DIST * MIN_SETT_DIST;
const KNOWLEDGE_DECAY_SCALE     = 30;
const INDEPENDENT_RATE          = 0.060;
// Spontaneous invention ACROSS OPEN WATER (no land path to any existing
// settlement → transportDist is Infinity) is far rarer: separate landmasses
// are reached by COLONISATION (sea.js), not magically populated. A small
// non-zero rate keeps the door open for the occasional independent overseas
// genesis (the Mesoamerica/Andes pattern) without letting empty continents
// fill before colonists can sail to them.
const OVERSEAS_INDEPENDENT_RATE = 0.0015;
const NEAR_RATE                 = 1.50;
const BASE_RATE                 = 0.010;

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
    // Min distance to all existing settlements.
    let tooClose = false;
    for (const o of world.settlements) {
      if (o.mode === "dead") continue;
      let ddx = Math.abs(o.pos.x - tx);
      if (ddx > tw / 2) ddx = tw - ddx;
      const ddy = o.pos.y - ty;
      if (ddx * ddx + ddy * ddy < MIN_SETT_DIST_SQ) { tooClose = true; break; }
    }
    if (tooClose) continue;

    // Site-quality score. Floor=0.45 lifts low-fert spawn rate so
    // marginal terrain is visibly populated rather than empty;
    // fertile river valleys still dominate by 5–6× after the f×2 and
    // area terms. Range roughly 0.45 (worst) → ~5.5 (best lush river).
    let quality = 0.45 + f * 1.5 + Math.min(2.0, areaFert * 0.1);
    if (hasRiver) quality += 1.0;
    if (hasCoast) quality += 0.4;
    quality += resourceBonusFor(world, ti, resScarcity);
    quality += busyRoadBonusFor(world, ti, tx, ty);

    // Transport-distance modifier. Finite td → diffusion from the land
    // network plus the normal independent floor. Infinite td (across water,
    // unreachable by land) → only the much smaller overseas-invention rate,
    // so other landmasses wait to be colonised rather than self-populating.
    const td = transportDist[ti];
    const diffusionMul = isFinite(td) ? Math.exp(-td / KNOWLEDGE_DECAY_SCALE) * NEAR_RATE : 0;
    const independent = isFinite(td) ? INDEPENDENT_RATE : OVERSEAS_INDEPENDENT_RATE;
    const p = quality * (diffusionMul + independent) * BASE_RATE;

    if (rng() < p) {
      // Inherited knowledge: blend from nearest settlement, weighted by
      // distance. Far sites start near baseline neolithic knowledge.
      const inherited = inheritKnowledgeAt(world, ti, td);
      makeSettlement(world, tx + 0.5, ty + 0.5, {
        people: 18 + (rng.int(8)),
        knowledge: inherited,
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
  for (const parent of world.settlements) {
    if (parent.mode !== "settled") continue;
    if (parent.people < COLONY_MIN_POP) continue;
    if (world.step - (parent._lastColonySent ?? -Infinity) < COLONY_COOLDOWN) continue;
    // Pressed: at or near carrying capacity (either food or housing) — the
    // people would otherwise sit at the ceiling. updatePopulation set s._k.
    const k = parent._k || 1;
    if (parent.people / k < COLONY_PRESS_FRAC) continue;
    if (rng() >= COLONY_CHANCE) continue;
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
  // Baseline neolithic knowledge for independent invention. Literacy is
  // included (at 0) so a colony of a literate parent inherits some of its
  // writing, blended by distance like the other soft tracks.
  const baseline = {
    foraging:    0.5,
    toolmaking:  0.2,
    agriculture: 0.45,
    construction: 0.1,
    organization: 0.1,
    literacy:    0,
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

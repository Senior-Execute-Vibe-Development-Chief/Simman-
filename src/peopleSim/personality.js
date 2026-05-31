// ── Country personalities ─────────────────────────────────────────────
//
// Every country carries a PERSONALITY: a small vector of continuous −1..1
// temperament traits (0 = neutral; sign = direction, magnitude = intensity)
// that bias what a realm WANTS to do. Knowledge gates
// what a realm CAN do; geography sets what's materially POSSIBLE; this layer
// is the cultural CHARACTER on top — so two iron-age empires of equal tech on
// similar ground can still be a war-machine and a merchant republic.
//
// Design (deliberate, after a critical review):
//
//   • Temperament is PREDOMINANTLY INTRINSIC. The core of each trait is an
//     arbitrary cultural seed — reproducible from the world seed + country id
//     (so a given world replays identically) but NOT a readout of geography.
//     This is what lets temperament DEFY circumstance, which is exactly where
//     personality earns its keep in history: Ming China burned its treasure
//     fleets and turned inward at the height of its naval power; Tokugawa
//     Japan chose isolation, then Meiji Japan chose aggressive expansion from
//     the same islands; Sparta and Athens shared a geography and almost
//     nothing else. None of that is predictable from terrain.
//
//   • Environment is only a WEAK PRIOR (~20%), and only for the couplings
//     that are genuinely about MATERIAL opportunity shaping inclination —
//     maritime/luxury ground nudges toward commerce, horses+metal toward
//     militarism (the Phoenicia / steppe-raider tendencies are real). We do
//     NOT derive expansionism from "room to grow": the sim already lets a
//     realm with room expand (reach budget, colony eligibility), so feeding
//     room back in as a "trait" was double-counting geography, not flavour.
//
//   • Traits DRIFT over a realm's life (driftPersonality): a long war hardens
//     militarism, a long peace lets commerce flower, losing ground turns a
//     realm inward (expansionism ebbs). Drift is slow (it reverts toward the
//     intrinsic anchor) so a people's character shifts over centuries.
//
//   • Successor states INHERIT the parent's temperament with a small drift,
//     so lineages stay coherent while diverging over generations.
//
// Personalities live in world.personalities, a Map keyed by countryId — the
// SAME persistence pattern as world.governments: stable across capital
// changes, pruned when a country dies. The traits feed real levers via the
// behaviour multipliers at the bottom of this file.

import { mkRng } from "./rng.js";

// Three INDEPENDENT outward-drive axes, each in −1..1 with 0 = neutral
// (uncorrelated — so a realm can be high on two at once: the warlike merchant,
// the conquering trader). A POSITIVE value expresses the trait (warlike,
// mercantile, expansive); a NEGATIVE value its mirror (pacifist, autarkic,
// inward); 0 is an average realm with no lean. There is deliberately NO
// "caution" trait: caution is not an orthogonal drive, it's the ABSENCE of
// outward drive, so we DERIVE it (a realm negative on all three reads as
// "Insular") rather than storing a redundant fourth number.
export const TRAITS = ["aggression", "commerce", "expansionism"];

// How far a successor state's traits drift from the parent's (±, in the −1..1
// trait scale). Small — a breakaway is recognisably its parent's child, not a
// fresh roll.
const INHERIT_DRIFT = 0.24;

// Weight of the environment PRIOR vs the intrinsic cultural seed. 0.2 means
// temperament is ~80% arbitrary character, ~20% "the ground leans you this
// way" — most realms roughly fit their geography, a meaningful minority defy
// it (the insular maritime power, the warlike trade hub).
const ENV_PRIOR_W = 0.20;

// ── Event-driven drift (per polity pass) ──────────────────────────────
// Magnitudes are deliberately GENTLE relative to the mean-reversion pull, so
// lived experience only COLOURS a realm's intrinsic character (a steady-war
// equilibrium sits ~0.1–0.15 above the anchor, not pinned near 1.0). If
// experience-drift were strong it would re-determine temperament from
// circumstance — re-introducing exactly the "geography decides personality"
// flaw this design exists to avoid. The anchor stays the dominant signal;
// the world can be at war for centuries and a peaceable people stays
// recognisably more peaceable than a warlike neighbour.
const DRIFT_REVERT     = 0.010;  // per pass: traits ease back toward intrinsic anchor
const DRIFT_WAR_AGG    = 0.004;  // a realm at war slowly hardens toward militarism
const DRIFT_PEACE_COMM = 0.003;  // a solvent realm at peace drifts mercantile
const DRIFT_LOSS_EXP   = 0.008;  // losing members (secession/conquest) turns a realm
                                 // INWARD — expansionism ebbs (the "breeds caution"
                                 // effect, now expressed as withdrawal → derives Insular)
const DRIFT_GROW_EXP   = 0.004;  // steadily gaining members emboldens expansionism

// Luxury / specie resource ids read off the capital's territory for the
// (weak) commerce prior. Mirrors settlement.js LUX_RES + specie deposits.
const LUX_RES = ["spices", "furs", "incense", "dyes", "gems", "precious"];

function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
function clampv(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }

// Deterministic per-country RNG: fold the world seed with the country id so a
// given world always produces the same temperaments (reproducible), but each
// country is independent.
function countryRng(world, countryId) {
  const base = (world.seed || 1) * 2654435761;
  return mkRng((base ^ (countryId * 40503)) >>> 0);
}

// A spread roll in −1..1 with a gentle central bias toward 0 (sum of two
// uniforms minus 1 → a triangular distribution peaked at neutral), so most
// cultures are moderate and the extremes are rarer — without ever pinning a
// trait to circumstance.
function cultureRoll(rng) { return (rng() + rng()) - 1; }

// The intrinsic cultural ANCHOR: arbitrary, seeded, geography-free. This is
// the heart of the temperament; everything else is a nudge on top.
function intrinsicAnchor(rng) {
  return {
    aggression:   cultureRoll(rng),
    commerce:     cultureRoll(rng),
    expansionism: cultureRoll(rng),
  };
}

// The weak environment PRIOR — only the genuinely material couplings. Returns
// per-trait targets the anchor is nudged ~20% toward. Expansionism is NOT
// derived from geography (see file header).
function environmentPrior(world, c) {
  const cap = c.capital;
  const k = cap.knowledge || {};
  const lr = cap.localRes || {};

  // Commerce prior: navigable water + tradable luxuries lean a people toward
  // the carrying trade (Phoenicia, Venice, the Dutch).
  let lux = 0; for (const id of LUX_RES) lux += lr[id] || 0;
  const water = cap.waterAccess || 0;
  const commerce = clamp01(0.3 + water * 0.5 + Math.min(0.5, lux * 0.6)
    + (k.navigation || 0) * 0.2);

  // Aggression prior: horses (cavalry) + metal (weapons) lean toward the
  // raiding/conquest tradition (the steppe, the early metal-rich warbands).
  const horses = lr.horses || 0;
  const ore = Math.max(lr.copper || 0, lr.iron || 0, lr.tin || 0);
  const aggression = clamp01(0.3 + horses * 0.6 + (k.metallurgy || 0) * 0.3
    + Math.min(0.25, ore * 0.4));

  // No expansionism prior — that's purely cultural. The priors above are
  // computed in 0..1 (their natural form); map them onto the −1..1 trait scale
  // (x → 2x−1) so they blend in the same space as the intrinsic anchor.
  return { aggression: aggression * 2 - 1, commerce: commerce * 2 - 1 };
}

// Build a fresh personality: intrinsic anchor, nudged ~20% toward the weak
// environment prior on the two material axes. The anchor is retained (_base)
// so event-drift can revert toward it.
function makePersonality(world, c, rng) {
  const base = intrinsicAnchor(rng);
  const prior = environmentPrior(world, c);
  const p = { _base: {} };
  for (const t of TRAITS) {
    let v = base[t];
    if (prior[t] !== undefined) v = v * (1 - ENV_PRIOR_W) + prior[t] * ENV_PRIOR_W;
    p[t] = clampv(v, -1, 1);
    p._base[t] = p[t];      // intrinsic anchor for mean-reverting drift
  }
  p._label = labelFor(p);
  return p;
}

// Get (or lazily create) a country's personality.
export function personalityOf(world, c) {
  if (!world.personalities) world.personalities = new Map();
  let p = world.personalities.get(c.id);
  if (!p) {
    p = makePersonality(world, c, countryRng(world, c.id));
    p._size = c.members.length;
    world.personalities.set(c.id, p);
  }
  return p;
}

// Slow, event-driven drift — called once per polity pass per multi-member
// country. Traits ease back toward the intrinsic anchor (mean reversion) and
// are pushed by lived experience: sustained war hardens militarism, long
// solvent peace lets commerce flower, losing ground turns a realm inward,
// steady growth emboldens expansion. Magnitudes are per-pass (POLITY_INTERVAL ≈ 150
// ticks), so character shifts over centuries — a Tokugawa→Meiji turn, not a
// mood swing.
export function driftPersonality(world, c, signals) {
  const p = world.personalities && world.personalities.get(c.id);
  if (!p || !p._base) return;
  const atWar    = (signals.warLevel || 0) > 0;
  const solvent  = (signals.solvency ?? 1) > 0.9;
  const prevSize = p._size ?? c.members.length;
  const grew     = c.members.length - prevSize;

  // Mean reversion toward the intrinsic anchor.
  for (const t of TRAITS) p[t] += (p._base[t] - p[t]) * DRIFT_REVERT;

  // Lived experience. Each term scales by the HEADROOM to the relevant pole
  // (+1 for the hardening drifts, −1 for the inward one), so a trait already
  // near its pole barely moves and the push is gentle and bounded.
  if (atWar)               p.aggression   += DRIFT_WAR_AGG   * (1 - p.aggression);
  else if (solvent)        p.commerce     += DRIFT_PEACE_COMM * (1 - p.commerce);
  if (grew < 0)            p.expansionism -= DRIFT_LOSS_EXP  * (p.expansionism + 1);   // turn inward (toward −1)
  else if (grew > 0)       p.expansionism += DRIFT_GROW_EXP  * (1 - p.expansionism);

  for (const t of TRAITS) p[t] = clampv(p[t], -1, 1);
  p._size = c.members.length;
  p._label = labelFor(p);
}

// A successor state (secession / fragmentation / overmighty governor) inherits
// the parent realm's temperament with a little drift — a breakaway is its
// parent's child, not a stranger. The intrinsic anchor is inherited too (and
// drifted), so the lineage's character persists. If the parent has no recorded
// personality yet, the child is left to lazily self-seed.
export function inheritPersonality(world, parentCountryId, childCountryId) {
  if (!world.personalities) world.personalities = new Map();
  if (world.personalities.has(childCountryId)) return;       // already set
  const parent = world.personalities.get(parentCountryId);
  if (!parent) return;                                        // child self-seeds later
  const rng = countryRng(world, childCountryId);
  const child = { _base: {} };
  for (const t of TRAITS) {
    const jitter = (rng() - 0.5) * 2 * INHERIT_DRIFT;
    child[t] = clampv((parent[t] ?? 0) + jitter, -1, 1);
    // Anchor inherits the parent's anchor with its own drift, so the
    // breakaway has a distinct-but-related intrinsic character to revert to.
    const baseJ = (rng() - 0.5) * 2 * INHERIT_DRIFT;
    child._base[t] = clampv(((parent._base && parent._base[t]) ?? parent[t] ?? 0) + baseJ, -1, 1);
  }
  child._label = labelFor(child);
  world.personalities.set(childCountryId, child);
}

// Drop personalities of realms that no longer exist (called from the polity
// pass alongside the governments prune, so the map can't grow unbounded).
export function prunePersonalities(world, countries) {
  if (!world.personalities) return;
  for (const id of world.personalities.keys()) {
    if (!countries.has(id)) world.personalities.delete(id);
  }
}

// Human-readable archetype — BLEND-AWARE, so the personalities we actually
// simulate read on screen. The three outward drives are independent, so a
// realm can be co-dominant in two at once; that blend gets its own evocative
// name (the warlike merchant is a Raider-Republic, not just "Warlike").
//
//   • all three drives negative → Insular   (the absence of outward drive —
//                                  this is the DERIVED "caution"/withdrawal)
//   • one drive clearly on top   → its single archetype
//   • two co-dominant drives     → the pair's blend name
//   • all three high & close     → Balanced  (driven but unspecialised)
// Thresholds are in the −1..1 trait scale.
const LABEL_INSULAR_MAX = -0.20; // top drive below this ⇒ no real ambition ⇒ Insular
const LABEL_CODOMINANT  = 0.24;  // drives within this of the top count as co-dominant
const NOUN = { aggression: "Warlike", commerce: "Mercantile", expansionism: "Expansionist" };
// Blend names keyed by the sorted pair (symmetric — a blend is a blend).
const COMBO = {
  "aggression+commerce":     "Raider-Republic",  // Carthage / Norse / the armed trading city
  "aggression+expansionism": "Conqueror",        // Rome / the Mongols / Macedon
  "commerce+expansionism":   "Trading Empire",   // the Dutch / Portuguese / maritime colonial powers
};
function labelFor(p) {
  const drives = [
    ["aggression",   p.aggression],
    ["commerce",     p.commerce],
    ["expansionism", p.expansionism],
  ];
  drives.sort((a, b) => b[1] - a[1]);
  const [top, second, third] = drives;
  if (top[1] < LABEL_INSULAR_MAX) return "Insular";          // no drive worth the name
  const coSecond = top[1] - second[1] < LABEL_CODOMINANT;
  const coThird  = top[1] - third[1]  < LABEL_CODOMINANT;
  if (coSecond && coThird) return "Balanced";                // all three jostling
  if (coSecond) {                                            // two co-dominant → blend
    const key = [top[0], second[0]].sort().join("+");
    return COMBO[key] || NOUN[top[0]];
  }
  return NOUN[top[0]];                                       // one clear dominant
}

// ── Behaviour multipliers (the levers other passes read) ───────────────
// CONVENTION: every multiplier is centred on the 0 pivot —
//     mul = 1 + trait · HALFSPAN          (trait ∈ −1..1)
// so a trait of 0 is neutral (mul = 1.0, the bare constant), a negative trait
// expresses the MIRROR (pacifist / autarkic / inward) and a positive one the
// trait, symmetrically. Because `cultureRoll` is mean-0, the AVERAGE realm is
// genuinely neutral.
//
// This is a PURE RE-PARAMETERISATION of the old hand-tuned multipliers — the
// behaviour is mathematically IDENTICAL for every realm, only the trait's
// scale and pivot moved. The old forms were `base + slope·t01` (t01 ∈ 0..1)
// pivoting at varied places (0.25–0.58), so "neutral" was inconsistent and
// even disagreed between a trait's own two levers. With t11 = 2·t01−1, each
// HALFSPAN is the old slope ÷ (2·F) where F is the old value-at-the-mean, and
// every caller constant is re-anchored by that same F (×F for a constant the
// multiplier MULTIPLIES, ÷F for one it DIVIDES). F is written inline so the
// algebra stays legible:
//   attack F=1.05   army F=1.075   commerce F=1.20   reach F=1.02   colony F=1.10

// Conquest appetite: a warlike realm (aggression > 0) needs less of a power
// edge to attack (lowers the effective ATTACK_MIN_RATIO, which is ×1.05); a
// peaceable one (aggression < 0) demands a clear advantage. The old caution
// term is subsumed here — "cautious" is just negative aggression. Clamp caps
// the extremes (the old [0.75,1.35] band ÷1.05).
export function aggressionAttackMul(p) {
  if (!p) return 1;
  return clampv(1 - p.aggression * (0.60 / (2 * 1.05)), 0.75 / 1.05, 1.35 / 1.05);
}

// Garrison size: warlike realms field bigger armies for their pop; pacifist
// ones (negative) fewer. (ARMY_TIER_FRAC and ARMY_CAPITAL_BONUS are ×1.075.)
export function aggressionArmyMul(p) {
  if (!p) return 1;
  return 1 + p.aggression * (0.45 / (2 * 1.075));
}

// Road-building eagerness: a mercantile realm (commerce > 0) builds trade roads
// more readily, an autarkic one (negative) less so. (NEW_FRACTION_* in roads.js
// are ÷1.2 — they're divided by this multiplier.)
export function commerceMul(p) {
  if (!p) return 1;
  return 1 + p.commerce * (0.80 / (2 * 1.20));
}

// Administrative reach: an expansionist realm projects authority a little
// farther; an inward (negative) one pulls in. Deliberately MILD — knowledge
// sets the real reach; personality only colours it. (RANGE_* in conquest.js
// are ×1.02.)
export function expansionReachMul(p) {
  if (!p) return 1;
  return 1 + p.expansionism * (0.34 / (2 * 1.02));
}

// Colony drive: how eager a realm is to seed overseas/frontier colonies; an
// inward realm (negative) mounts fewer. (COLONY_COOLDOWN in sea.js is ÷1.1 —
// it's divided by this multiplier.)
export function expansionColonyMul(p) {
  if (!p) return 1;
  return 1 + p.expansionism * (1.0 / (2 * 1.10));
}

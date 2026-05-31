// ── Country personalities ─────────────────────────────────────────────
//
// Every country carries a PERSONALITY: a small vector of continuous 0..1
// temperament traits that bias how it behaves. Unlike knowledge (which
// gates what a realm CAN do), personality colours what it WANTS to do —
// two iron-age empires of equal tech can be a war-machine and a merchant
// republic. The traits feed real levers:
//
//   aggression   → conquest threshold + garrison size (armies.js)
//   commerce     → trade-peace weight + road-building eagerness (roads.js)
//   expansionism → administrative reach + colony drive (conquest.js, sea.js)
//   caution      → how readily the frontier is risked / held (dampens the
//                  above when high)
//
// Personalities live in world.personalities, a Map keyed by countryId —
// the SAME persistence pattern as world.governments: stable across capital
// changes, inherited with drift by successor states, pruned when a country
// dies. A country with no entry yet gets one lazily, seeded from its
// capital's environment so the temperament is explainable (a coastal,
// spice-rich, ore-poor cradle leans merchant; a horse-and-metal steppe
// power leans warlike; a realm on an open frontier leans expansionist).

import { mkRng } from "./rng.js";

// Trait names. Kept as a flat object per country so new traits can be
// added without touching the persistence plumbing.
export const TRAITS = ["aggression", "commerce", "expansionism", "caution"];

// How far a successor state's traits drift from the parent's (±). Small —
// a breakaway is recognisably its parent's child, not a fresh roll.
const INHERIT_DRIFT = 0.12;
// Jitter applied to the environment-derived baseline at first founding.
const FOUNDING_JITTER = 0.18;

// Luxury / ore / mobility resource ids we read off the capital's territory
// to shape the founding temperament. (Mirrors the ids used elsewhere in
// the sim — see settlement.js LUX_RES and the metallurgy ore gate.)
const LUX_RES = ["spices", "furs", "incense", "dyes", "gems", "precious"];

function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }

// Deterministic per-country RNG: fold the world seed with the country id so
// a given world always produces the same temperaments (reproducible runs),
// but each country is independent.
function countryRng(world, countryId) {
  const base = (world.seed || 1) * 2654435761;
  return mkRng((base ^ (countryId * 40503)) >>> 0);
}

// Build a fresh personality from the capital's environment + seeded jitter.
// The environment read is intentionally cheap and explainable:
//   • water access + luxury goods   → commerce
//   • horses + metallurgy/ore       → aggression
//   • room to grow (few neighbours) + mobility → expansionism
//   • inverse of the above pressures → caution (a realm with no obvious
//     outward pull turns inward)
function deriveFromEnvironment(world, c, rng) {
  const cap = c.capital;
  const k = cap.knowledge || {};
  const lr = cap.localRes || {};

  // Commerce: navigable water + tradable luxuries make a merchant.
  let lux = 0; for (const id of LUX_RES) lux += lr[id] || 0;
  const water = cap.waterAccess || 0;
  const commerce = clamp01(0.25 + water * 0.45 + Math.min(0.5, lux * 0.6)
    + (k.navigation || 0) * 0.2);

  // Aggression: horses (cavalry) + metallurgy/ore (weapons) make a warband.
  const horses = lr.horses || 0;
  const ore = Math.max(lr.copper || 0, lr.iron || 0, lr.tin || 0);
  const aggression = clamp01(0.30 + horses * 0.6 + (k.metallurgy || 0) * 0.3
    + Math.min(0.25, ore * 0.4) + (k.mobility || 0) * 0.2);

  // Expansionism: open frontier (few neighbours) + mobility drives sprawl.
  const borders = world._borders && world._borders.get(cap.id);
  const neighbours = borders ? borders.size : 0;
  const elbowRoom = clamp01(1 - neighbours / 6);     // crowded → less room
  const expansionism = clamp01(0.30 + elbowRoom * 0.4 + (k.mobility || 0) * 0.25
    + (k.organization || 0) * 0.15);

  // Caution: the residual temperament — a realm with no strong outward pull
  // (low commerce/aggression/expansion incentive) hunkers down. Kept loosely
  // anti-correlated so most realms aren't simultaneously bold on every axis.
  const drive = (commerce + aggression + expansionism) / 3;
  const caution = clamp01(0.65 - drive * 0.5);

  const p = { aggression, commerce, expansionism, caution };
  // Seeded jitter so two identical environments still diverge a little.
  for (const t of TRAITS) p[t] = clamp01(p[t] + (rng() - 0.5) * 2 * FOUNDING_JITTER);
  return p;
}

// Get (or lazily create) a country's personality. Seeded from its capital's
// environment the first time it's asked for.
export function personalityOf(world, c) {
  if (!world.personalities) world.personalities = new Map();
  let p = world.personalities.get(c.id);
  if (!p) {
    p = deriveFromEnvironment(world, c, countryRng(world, c.id));
    p._label = labelFor(p);
    world.personalities.set(c.id, p);
  }
  return p;
}

// A successor state (secession / fragmentation / overmighty governor)
// inherits the parent realm's temperament with a little drift — a breakaway
// is its parent's child, not a stranger. Called from conquest.js the moment
// a new countryId is minted. If the parent has no recorded personality yet
// (shouldn't normally happen), the child is left to lazily self-seed.
export function inheritPersonality(world, parentCountryId, childCountryId) {
  if (!world.personalities) world.personalities = new Map();
  if (world.personalities.has(childCountryId)) return;       // already set
  const parent = world.personalities.get(parentCountryId);
  if (!parent) return;                                        // child self-seeds later
  const rng = countryRng(world, childCountryId);
  const child = {};
  for (const t of TRAITS) {
    child[t] = clamp01(parent[t] + (rng() - 0.5) * 2 * INHERIT_DRIFT);
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

// Human-readable archetype from the dominant trait — for the info panel.
// Caution only "wins" when no outward drive is notably high, so a balanced
// realm reads as "Balanced" rather than defaulting to cautious.
function labelFor(p) {
  const drives = [
    ["aggression",   p.aggression,   "Warlike"],
    ["commerce",     p.commerce,     "Mercantile"],
    ["expansionism", p.expansionism, "Expansionist"],
  ];
  drives.sort((a, b) => b[1] - a[1]);
  const top = drives[0], second = drives[1];
  if (top[1] < 0.45 && p.caution > 0.5) return "Insular";
  if (top[1] - second[1] < 0.08) return "Balanced";
  return top[2];
}

// ── Behaviour multipliers (the levers other passes read) ───────────────
// Each returns a multiplier centred near 1.0 so a trait of 0.5 is roughly
// neutral and the extremes meaningfully push the lever. Callers stay simple:
// they multiply their existing constant by these.

// Conquest appetite: a warlike realm needs less of a power edge to attack
// (lowers ATTACK_MIN_RATIO); a cautious one demands more. Range ~0.78–1.30.
export function aggressionAttackMul(p) {
  if (!p) return 1;
  return clamp01v(1.18 - p.aggression * 0.50 + p.caution * 0.30, 0.75, 1.35);
}

// Garrison size: aggressive realms field bigger armies for their pop.
// Range ~0.85–1.30.
export function aggressionArmyMul(p) {
  if (!p) return 1;
  return 0.85 + p.aggression * 0.45;
}

// Trade-peace weight: a mercantile realm values its trade links more, so
// cross-border commerce suppresses border-grabbing harder (and it builds
// roads more eagerly). Range ~0.8–1.6.
export function commerceMul(p) {
  if (!p) return 1;
  return 0.8 + p.commerce * 0.8;
}

// Administrative reach: an expansionist realm projects authority a little
// farther (it's organised around holding ground); a cautious one pulls in.
// Range ~0.9–1.18. Deliberately MILD — knowledge still sets the real reach;
// personality only nudges it so tech stays the dominant gate.
export function expansionReachMul(p) {
  if (!p) return 1;
  return 0.9 + p.expansionism * 0.28 - p.caution * 0.10;
}

// Colony drive: how eager a realm is to seed overseas/frontier colonies.
// Range ~0.6–1.6.
export function expansionColonyMul(p) {
  if (!p) return 1;
  return 0.6 + p.expansionism * 1.0;
}

function clamp01v(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }

// Settlement: a band that stopped wandering and built a permanent
// home. Pop grows on local food supply (forage + farms), houses appear
// as needed, the footprint expands as the settlement tiers up from
// village → town → city → metropolis.
//
// At atlas scale: buildings appear instantly when a settlement earns
// them — no construction-in-progress dim phase. The visible progression
// is "village turns into town turns into city", not "wall N is at 80 %".

import {
  BUILDING, HOUSE_CAPACITY, FARM_YIELD,
  makeBuilding, nextBuildingNeeded, placeBuildingOffset,
} from "./building.js";

let _nextId = 1;
export function resetSettlementIds() { _nextId = 1; }

const TIER_THRESHOLD = [0, 80, 400, 2000];        // village, town, city, metropolis
const TIER_NAME      = ["village", "town", "city", "metropolis"];

const SETT_GROWTH = 0.0045;          // logistic rate per tick
const FOOD_STORAGE_CAP = 200;        // ~half a year of forage for a small village

// Build cadence: a settlement adds at most one building every BUILD_INTERVAL
// ticks (modulated by labour). Atlas-scale doesn't track masons — this
// just paces visual growth so a new village doesn't instantly become 30
// houses.
const BUILD_INTERVAL_BASE = 80;

export function settleBand(world, band, name) {
  const s = {
    id: _nextId++,
    kind: "settlement",
    pos: { x: Math.floor(band.pos.x) + 0.5, y: Math.floor(band.pos.y) + 0.5 },
    foundedStep: world.step,
    founderBandId: band.id,
    name: name || `settlement-${_nextId - 1}`,
    people: band.people,
    food: band.people * 20,            // ~3 months of forage on founding
    knowledge: { ...band.knowledge },
    traits: { ...band.traits },
    buildings: [makeBuilding(BUILDING.HOUSE, 0, 0)],   // first house at centre, instantly built
    tier: 0,
    mode: "settled",
    lastBuildStep: world.step,
    history: [{ step: world.step, type: "founded", from: band.id, pos: { x: band.pos.x, y: band.pos.y } }],
  };
  world.settlements.push(s);
  band.mode = "dead";
  band.history.push({ step: world.step, type: "settled", asSettlement: s.id });
  return s;
}

export function updateSettlement(world, s) {
  if (s.mode !== "settled") return;
  updateFood(world, s);
  updatePopulation(world, s);
  maybeAddBuilding(world, s);
  updateTier(world, s);
}

// ── Food ───────────────────────────────────────────────────────────
function updateFood(world, s) {
  const farms = s.buildings.filter(b => b.kind === BUILDING.FARM).length;
  const ti = (s.pos.y | 0) * world.tw + (s.pos.x | 0);
  const localFert = world.fert[ti] || 0.05;

  const forage    = 0.012 * localFert * (1 + (s.knowledge.foraging || 0.3) * 0.5);
  const farmYield = farms * FARM_YIELD * (1 + (s.knowledge.agriculture || 0) * 1.2) * (0.4 + localFert);
  const supply    = forage + farmYield;
  const demand    = s.people * 0.0030;

  s.food += (supply - demand);
  if (s.food > FOOD_STORAGE_CAP) s.food = FOOD_STORAGE_CAP;
  if (s.food < 0) s.food = 0;
}

// ── Population ─────────────────────────────────────────────────────
function updatePopulation(world, s) {
  const housing = s.buildings.filter(b => b.kind === BUILDING.HOUSE).length * HOUSE_CAPACITY;
  const ti = (s.pos.y | 0) * world.tw + (s.pos.x | 0);
  const localFert = world.fert[ti] || 0.05;
  const farms = s.buildings.filter(b => b.kind === BUILDING.FARM).length;
  const foodCap = 30 + localFert * 200 + farms * 25;
  const K = Math.max(2, Math.min(housing > 0 ? housing : foodCap, foodCap));

  if (s.food <= 0.01 && s.people > 1) {
    s.people *= 0.985;                              // famine
  } else {
    s.people = s.people + SETT_GROWTH * s.people * (1 - s.people / K);
  }
  if (s.people < 1.5) {
    s.mode = "dead";
    s.history.push({ step: world.step, type: "abandoned" });
  }
}

// ── Building (no construction queue, just visible additions) ───────
function maybeAddBuilding(world, s) {
  const interval = BUILD_INTERVAL_BASE / Math.max(0.5, Math.sqrt(s.people) / 4);
  if (world.step - s.lastBuildStep < interval) return;
  const needed = nextBuildingNeeded(s);
  if (!needed) return;
  const { dx, dy } = placeBuildingOffset(world.rng, s, needed);
  s.buildings.push(makeBuilding(needed, dx, dy));
  s.lastBuildStep = world.step;
  s.history.push({ step: world.step, type: "build", kind: needed });
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

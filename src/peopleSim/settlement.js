// Settlement: a band that stopped wandering and built a permanent
// home. Pop grows on local food supply (forage + farms), houses are
// added as needed, the footprint expands as the settlement tiers up
// from village → town → city.

import {
  BUILDING, BUILD_COST, HOUSE_CAPACITY, FARM_YIELD, GRANARY_BUFFER,
  makeBuilding, buildingDone, nextBuildingNeeded, placeBuildingOffset,
} from "./building.js";

let _nextId = 1;
export function resetSettlementIds() { _nextId = 1; }

// Tier thresholds — population at which a settlement promotes.
const TIER_THRESHOLD = [0, 80, 400, 2000];  // village, town, city, metropolis
const TIER_NAME = ["village", "town", "city", "metropolis"];

const SETT_GROWTH = 0.0045;   // per tick logistic rate. Higher than band
                              // growth — sedentary life supports more
                              // children per woman than nomadic foraging.

// Convert a band into a settlement at its current location. Called by
// the orchestrator when band.mode === "settling".
export function settleBand(world, band, name) {
  const s = {
    id: _nextId++,
    kind: "settlement",
    pos: { x: Math.floor(band.pos.x) + 0.5, y: Math.floor(band.pos.y) + 0.5 },
    foundedStep: world.step,
    founderBandId: band.id,
    name: name || `settlement-${_nextId - 1}`,
    people: band.people,
    food: band.people * 20,           // ~3 months of forage buffer on founding
    knowledge: { ...band.knowledge },
    traits: { ...band.traits },
    buildings: [],
    tier: 0,                          // 0=village
    mode: "settled",
    history: [{ step: world.step, type: "founded", from: band.id, pos: { x: band.pos.x, y: band.pos.y } }],
  };
  // First house — placed at the centre, immediately complete so the
  // settlement has somewhere to live from day one.
  const h0 = makeBuilding(BUILDING.HOUSE, 0, 0);
  h0.builtFrac = 1;
  s.buildings.push(h0);
  world.settlements.push(s);
  band.mode = "dead";
  band.history.push({ step: world.step, type: "settled", asSettlement: s.id });
  return s;
}

// Per-tick update for one settlement.
export function updateSettlement(world, s) {
  if (s.mode !== "settled") return;
  updateFood(world, s);
  updatePopulation(world, s);
  updateBuilding(world, s);
  updateTier(world, s);
}

// ── Food accounting ────────────────────────────────────────────────
// Production from farms + forage from local terrain. Consumption from
// people. Net into / out of food stockpile, capped by storage capacity.
function updateFood(world, s) {
  const farmsBuilt = s.buildings.filter(b => b.kind === BUILDING.FARM && buildingDone(b)).length;
  const granariesBuilt = s.buildings.filter(b => b.kind === BUILDING.GRANARY && buildingDone(b)).length;

  const ti = (s.pos.y | 0) * world.tw + (s.pos.x | 0);
  const localFert = world.fert[ti] || 0.05;

  const forage = 0.012 * localFert * (1 + (s.knowledge.foraging || 0.3) * 0.5);
  const farmYield = farmsBuilt * FARM_YIELD * (1 + (s.knowledge.agriculture || 0) * 1.2) * (0.4 + localFert);

  const supply = forage + farmYield;
  const demand = s.people * 0.0030;   // moderate per-capita food draw

  s.food += (supply - demand);
  // Storage cap: a village holds ~3 months of forage even with no
  // granary; granaries multiply that several times over.
  const storageCap = 80 + granariesBuilt * GRANARY_BUFFER;
  if (s.food > storageCap) s.food = storageCap;
  if (s.food < 0) s.food = 0;
}

// ── Population ────────────────────────────────────────────────────
function updatePopulation(world, s) {
  const housing = s.buildings.filter(b => b.kind === BUILDING.HOUSE && buildingDone(b)).length * HOUSE_CAPACITY;
  // Carrying cap = min(housing, food-based-cap).
  const ti = (s.pos.y | 0) * world.tw + (s.pos.x | 0);
  const localFert = world.fert[ti] || 0.05;
  const foodCap = 30 + localFert * 200 +
                  s.buildings.filter(b => b.kind === BUILDING.FARM && buildingDone(b)).length * 25;
  const K = Math.max(2, Math.min(housing > 0 ? housing : foodCap, foodCap));
  // Logistic growth with famine when food < 0.
  if (s.food <= 0.01 && s.people > 1) {
    s.people *= 0.985;     // famine shrinks pop
  } else {
    s.people = s.people + SETT_GROWTH * s.people * (1 - s.people / K);
  }
  if (s.people < 1.5) {
    s.mode = "dead";
    s.history.push({ step: world.step, type: "abandoned" });
  }
}

// ── Building queue ─────────────────────────────────────────────────
// Each tick: advance the highest-priority in-progress building. If none
// is in progress and the settlement needs something, queue it.
function updateBuilding(world, s) {
  let inProgress = s.buildings.find(b => !buildingDone(b));
  if (!inProgress) {
    const needed = nextBuildingNeeded(s);
    if (!needed) return;
    const { dx, dy } = placeBuildingOffset(world.rng, s, needed);
    inProgress = makeBuilding(needed, dx, dy);
    s.buildings.push(inProgress);
    s.history.push({ step: world.step, type: "build-start", kind: needed });
  }
  // Construction rate = 1/cost per tick, modulated by labour pool.
  // Labour = sqrt(people) capped so very large settlements don't ALSO
  // build instantly (they hit material/coordination limits).
  const labour = Math.min(4, Math.sqrt(s.people) / 4);
  inProgress.builtFrac += labour / BUILD_COST[inProgress.kind];
  if (inProgress.builtFrac >= 1) {
    inProgress.builtFrac = 1;
    s.history.push({ step: world.step, type: "build-done", kind: inProgress.kind });
  }
}

// ── Tier promotion ─────────────────────────────────────────────────
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

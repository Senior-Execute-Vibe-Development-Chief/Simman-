// Building definitions. Each building has a kind, a build cost (ticks),
// and a function it performs (housing capacity, food production, etc.).
// Per-building state lives on the settlement: { kind, dx, dy, builtFrac }
// where (dx, dy) is offset from settlement center in tile units.

export const BUILDING = {
  HOUSE:   "house",
  FARM:    "farm",
  GRANARY: "granary",
  // Later phases:
  WORKSHOP: "workshop",
  MARKET:   "market",
  PORT:     "port",
  MINE:     "mine",
  WALLS:    "walls",
};

// Build cost in ticks. Construction = builtFrac advances by (1 / cost)
// per tick while the settlement has labour to spare.
export const BUILD_COST = {
  house:   60,
  farm:    100,
  granary: 140,
  workshop: 200,
  market:  220,
  port:    260,
  mine:    300,
  walls:   400,
};

// Per-tier housing capacity is the sum of completed houses.
export const HOUSE_CAPACITY  = 8;     // people per house

// Per-tier food production: each farm yields this many "food units" per
// tick when fully built. Settlement also forages from surrounding tiles,
// but farms are the dominant supply once any are built.
export const FARM_YIELD      = 0.04;  // per tick per fully-built farm
export const GRANARY_BUFFER  = 30;    // extra food stored, prevents famine

export function makeBuilding(kind, dx, dy) {
  return { kind, dx, dy, builtFrac: 0 };
}

export function buildingDone(b) { return b.builtFrac >= 1; }

// Returns the next building this settlement should prioritise, or null.
// Order: first house → farm (food first) → more houses → farm/granary
// alternation. Putting farm AFTER first house prevents settlements from
// starving while building a row of houses they can't feed.
export function nextBuildingNeeded(settlement) {
  const houseCount   = settlement.buildings.filter(b => b.kind === BUILDING.HOUSE && buildingDone(b)).length;
  const housing      = houseCount * HOUSE_CAPACITY;
  const farms        = settlement.buildings.filter(b => b.kind === BUILDING.FARM && buildingDone(b)).length;
  const granaries    = settlement.buildings.filter(b => b.kind === BUILDING.GRANARY && buildingDone(b)).length;

  // Always need shelter from day one.
  if (houseCount === 0) return BUILDING.HOUSE;

  // Then food: build a farm as soon as the settlement has any shelter.
  // Without this, the settlement spends all labour on houses until pop
  // starves out.
  // Food check must use the same per-capita rate as updateFood() in
  // settlement.js, or the build queue will starve the settlement.
  const foodSupply = farms * FARM_YIELD + 0.02 * (settlement.knowledge.foraging || 0.3);
  const foodDemand = settlement.people * 0.0030;
  if (foodSupply < foodDemand * 1.2) return BUILDING.FARM;

  // Housing shortfall — well-fed pop is bursting out of houses.
  if (settlement.people > housing - 1) return BUILDING.HOUSE;

  // Stable food + town tier → granary for buffer.
  if (settlement.tier >= 1 && granaries < Math.floor(settlement.tier)) return BUILDING.GRANARY;

  return null;
}

// Decide where to place a new building of `kind`. Settlements have a
// growing footprint: village (radius 0.6), town (1.4), city (2.4).
// Newly placed buildings get a small random offset within the footprint
// so the village looks like a cluster, not a grid.
export function placeBuildingOffset(rng, settlement, kind) {
  const r = footprintRadius(settlement.tier);
  // Choose offset; try a few candidates and avoid stacking on top of
  // existing buildings.
  let bestDx = 0, bestDy = 0, bestDist = -Infinity;
  for (let i = 0; i < 8; i++) {
    const ang = rng() * Math.PI * 2;
    const rad = r * (0.25 + rng() * 0.75);
    const dx = Math.cos(ang) * rad;
    const dy = Math.sin(ang) * rad;
    // Minimum distance to existing buildings.
    let minD = Infinity;
    for (const b of settlement.buildings) {
      const dd = (b.dx - dx) ** 2 + (b.dy - dy) ** 2;
      if (dd < minD) minD = dd;
    }
    if (minD > bestDist) { bestDist = minD; bestDx = dx; bestDy = dy; }
  }
  return { dx: bestDx, dy: bestDy };
}

export function footprintRadius(tier) {
  // 0=village, 1=town, 2=city, 3=metropolis
  return [0.6, 1.4, 2.4, 3.6][tier] || 0.6;
}

// Building definitions. Atlas-scale: only buildings that mean something
// the player can SEE — houses (where people live), farms (where food
// comes from). Granaries / workshops / etc. are mechanical buffers
// that don't reward visualisation; they're not modelled.
//
// Buildings appear instantly when earned — no construction-in-progress
// phase. At this zoom you watch the settlement grow, not the masons
// finish each wall.

export const BUILDING = {
  HOUSE: "house",
  FARM:  "farm",
  // Reserved for later phases — added only when they ENABLE something
  // mechanically (trade routes, sea routes, sieges):
  MARKET: "market",   // phase 2 — caravan endpoint
  PORT:   "port",     // phase 2 — sea trade origin
  WALLS:  "walls",    // phase 3 — defensive bonus on siege
};

export const HOUSE_CAPACITY  = 8;     // people per house
export const FARM_YIELD      = 0.04;  // food per tick per farm

export function makeBuilding(kind, dx, dy) {
  return { kind, dx, dy };
}

// Returns the next building this settlement needs, or null when it's
// happily provisioned. First house → farm (food first) → more houses
// as the population grows past current housing.
export function nextBuildingNeeded(settlement) {
  const houseCount = settlement.buildings.filter(b => b.kind === BUILDING.HOUSE).length;
  const housing    = houseCount * HOUSE_CAPACITY;
  const farms      = settlement.buildings.filter(b => b.kind === BUILDING.FARM).length;

  if (houseCount === 0) return BUILDING.HOUSE;

  // Food check uses the SAME per-capita rate as updateFood() in
  // settlement.js, or the queue will starve the settlement.
  const foodSupply = farms * FARM_YIELD + 0.02 * (settlement.knowledge.foraging || 0.3);
  const foodDemand = settlement.people * 0.0030;
  if (foodSupply < foodDemand * 1.2) return BUILDING.FARM;

  if (settlement.people > housing - 1) return BUILDING.HOUSE;

  return null;
}

// Place a new building. Settlements have a growing footprint:
// village (radius 0.6), town (1.4), city (2.4), metropolis (3.6).
// Slight random jitter so the cluster looks organic, not gridded.
export function placeBuildingOffset(rng, settlement, kind) {
  const r = footprintRadius(settlement.tier);
  let bestDx = 0, bestDy = 0, bestDist = -Infinity;
  for (let i = 0; i < 8; i++) {
    const ang = rng() * Math.PI * 2;
    const rad = r * (0.25 + rng() * 0.75);
    const dx = Math.cos(ang) * rad;
    const dy = Math.sin(ang) * rad;
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
  return [0.6, 1.4, 2.4, 3.6][tier] || 0.6;
}

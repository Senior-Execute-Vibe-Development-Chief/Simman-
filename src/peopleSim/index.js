// Public API for the people simulator (settlements-only model).
//
//   initPeopleSim(worldGen, opts)  — build world + seed cradle village
//   stepPeopleSim(world, n=1)      — advance N ticks
//   getEntities(world)             — { settlements, caravans, armies }
//   peopleSimStats(world)          — quick numbers for HUD / debug
//
// No bands — settlements are the atomic visible entity. New ones come
// from daughter colonies founded by existing settlements.

import { createWorld, pruneDead } from "./state.js";
import { updateSettlement } from "./settlement.js";

export function initPeopleSim(worldGen, opts = {}) {
  return createWorld(worldGen, opts);
}

export function stepPeopleSim(world, n = 1) {
  for (let s = 0; s < n; s++) {
    const t0 = performance.now();
    world.step++;
    for (let i = 0; i < world.settlements.length; i++) {
      updateSettlement(world, world.settlements[i]);
    }
    if (world.step % 32 === 0) pruneDead(world);
    world.debug.tickMs = performance.now() - t0;
  }
  return world;
}

export function getEntities(world) {
  return {
    settlements: world.settlements,
    caravans:    world.caravans,
    armies:      world.armies,
  };
}

export function peopleSimStats(world) {
  let sPeople = 0, aliveSettlements = 0, farmlandTiles = 0;
  const tierCounts = [0, 0, 0, 0];
  for (const s of world.settlements) {
    if (s.mode === "dead") continue;
    aliveSettlements++;
    sPeople += s.people;
    if (s.farmland) farmlandTiles += s.farmland.size;
    if (s.tier >= 0 && s.tier < tierCounts.length) tierCounts[s.tier]++;
  }
  return {
    step: world.step,
    settlements: aliveSettlements,
    villages:    tierCounts[0],
    towns:       tierCounts[1],
    cities:      tierCounts[2],
    metropolises:tierCounts[3],
    farmlandTiles,
    totalPeople: Math.round(sPeople),
    tickMs: world.debug.tickMs.toFixed(2),
  };
}

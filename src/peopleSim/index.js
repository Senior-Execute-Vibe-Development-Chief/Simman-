// Public API for the people simulator.
//
//   initPeopleSim(worldGen, opts)  — build world + initial bands
//   stepPeopleSim(world, n=1)      — advance N ticks
//   getEntities(world)             — { bands, settlements, caravans, armies }
//   peopleSimStats(world)          — quick numbers for the HUD
//
// Phase 0 covers: bands wandering and growing/splitting. No settling,
// trade, or war yet — those land in the next phases.

import { createWorld, pruneDead } from "./state.js";
import { updateBand } from "./band.js";

export function initPeopleSim(worldGen, opts = {}) {
  return createWorld(worldGen, opts);
}

export function stepPeopleSim(world, n = 1) {
  for (let s = 0; s < n; s++) {
    const t0 = performance.now();
    world.step++;
    // Bands.
    for (let i = 0; i < world.bands.length; i++) {
      updateBand(world, world.bands[i]);
    }
    // Settlements / caravans / armies will plug in here in later phases.
    // Periodic prune of dead entities.
    if (world.step % 32 === 0) pruneDead(world);
    world.debug.tickMs = performance.now() - t0;
  }
  return world;
}

export function getEntities(world) {
  return {
    bands:       world.bands,
    settlements: world.settlements,
    caravans:    world.caravans,
    armies:      world.armies,
  };
}

export function peopleSimStats(world) {
  let totalPeople = 0, aliveBands = 0;
  for (const b of world.bands) {
    if (b.mode === "dead") continue;
    aliveBands++;
    totalPeople += b.people;
  }
  return {
    step: world.step,
    bands: aliveBands,
    settlements: world.settlements.filter(s => s.mode !== "dead").length,
    totalPeople: Math.round(totalPeople),
    tickMs: world.debug.tickMs.toFixed(2),
  };
}

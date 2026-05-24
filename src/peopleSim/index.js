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
import { updateBand, processMeetings } from "./band.js";
import { settleBand, updateSettlement } from "./settlement.js";

export function initPeopleSim(worldGen, opts = {}) {
  return createWorld(worldGen, opts);
}

export function stepPeopleSim(world, n = 1) {
  for (let s = 0; s < n; s++) {
    const t0 = performance.now();
    world.step++;
    // 1. Per-band update (wander, grow, learn, check settle, split).
    for (let i = 0; i < world.bands.length; i++) {
      updateBand(world, world.bands[i]);
    }
    // 2. Convert any band that decided to settle this tick into a
    //    Settlement entity. Process AFTER updateBand so a band can't
    //    flip-flop in the same tick.
    for (let i = 0; i < world.bands.length; i++) {
      const b = world.bands[i];
      if (b.mode === "settling") settleBand(world, b);
    }
    // 3. Knowledge diffusion between bands within range.
    //    O(N²) but capped at ~80 bands by world.cap.
    if (world.step % 4 === 0) processMeetings(world);
    // 4. Per-settlement update (food, pop, building queue, tier).
    for (let i = 0; i < world.settlements.length; i++) {
      updateSettlement(world, world.settlements[i]);
    }
    // 5. Periodic prune of dead entities.
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
  let bandPeople = 0, aliveBands = 0;
  for (const b of world.bands) {
    if (b.mode === "dead" || b.mode === "settling") continue;
    aliveBands++;
    bandPeople += b.people;
  }
  let sPeople = 0, aliveSettlements = 0, sBuildings = 0;
  for (const s of world.settlements) {
    if (s.mode === "dead") continue;
    aliveSettlements++;
    sPeople += s.people;
    sBuildings += s.buildings.length;
  }
  return {
    step: world.step,
    bands: aliveBands,
    settlements: aliveSettlements,
    buildings: sBuildings,
    bandPeople: Math.round(bandPeople),
    settledPeople: Math.round(sPeople),
    totalPeople: Math.round(bandPeople + sPeople),
    tickMs: world.debug.tickMs.toFixed(2),
  };
}

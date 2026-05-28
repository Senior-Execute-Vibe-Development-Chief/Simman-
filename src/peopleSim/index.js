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
import { maybeCrystallize } from "./crystallize.js";
import { maybeBuildRoads, updateTrade } from "./roads.js";
import { computeTerritory } from "./territory.js";
import { updatePolities, CONQUEST_INTERVAL } from "./conquest.js";

const TERRITORY_INTERVAL = 96;   // ticks between full territory recomputes

export function initPeopleSim(worldGen, opts = {}) {
  return createWorld(worldGen, opts);
}

export function stepPeopleSim(world, n = 1) {
  for (let s = 0; s < n; s++) {
    const t0 = performance.now();
    world.step++;
    // Fast id → settlement lookup, rebuilt each tick. Replaces the
    // O(n) linear scans the trade / knowledge passes would otherwise
    // do per peer (effectiveLocalRes, findById, ...).
    world._byId = new Map();
    for (let i = 0; i < world.settlements.length; i++) {
      const s = world.settlements[i];
      world._byId.set(s.id, s);
      s._wPrev = s.wealth || 0;   // baseline for the money-flow net-change readout
    }
    // Recompute territory periodically: each settlement claims the land it
    // reaches cheapest, and its food / resources are tallied from it.
    if (world.step === 1 || world.step % TERRITORY_INTERVAL === 0) computeTerritory(world);
    for (let i = 0; i < world.settlements.length; i++) {
      updateSettlement(world, world.settlements[i]);
    }
    // New settlements crystallise spontaneously at fertile sites,
    // weighted by transport distance to existing ones.
    maybeCrystallize(world);
    // Roads: settlements build trade roads to partners, then trade
    // flows money along the network. updateTrade runs food trade
    // first within each pair, so a starving importer's wealth goes
    // to grain (and can dip into its reserve) before luxuries.
    maybeBuildRoads(world);
    updateTrade(world);
    // Smoothed per-settlement wealth change rate, for the money-flow
    // overlay (gold = gaining, red = losing). Cheap; ready when shown.
    for (let i = 0; i < world.settlements.length; i++) {
      const s = world.settlements[i];
      if (s.mode !== "settled") continue;
      s._wealthDelta = (s._wealthDelta || 0) * 0.9 + ((s.wealth || 0) - (s._wPrev || 0)) * 0.1;
    }
    if (world.step % 32 === 0) pruneDead(world);
    // Polities: strong countries conquer weak neighbours' frontier
    // settlements; over-extended members secede.
    if (world.step % CONQUEST_INTERVAL === 0) updatePolities(world);
    world.debug.tickMs = performance.now() - t0;
  }
  return world;
}

export function getEntities(world) {
  return { settlements: world.settlements };
}

export function peopleSimStats(world) {
  let sPeople = 0, aliveSettlements = 0, territoryTiles = 0;
  const tierCounts = [0, 0, 0, 0];
  for (const s of world.settlements) {
    if (s.mode === "dead") continue;
    aliveSettlements++;
    sPeople += s.people;
    territoryTiles += s._terrTiles || 0;
    if (s.tier >= 0 && s.tier < tierCounts.length) tierCounts[s.tier]++;
  }
  return {
    step: world.step,
    settlements: aliveSettlements,
    villages:    tierCounts[0],
    towns:       tierCounts[1],
    cities:      tierCounts[2],
    metropolises:tierCounts[3],
    territoryTiles,
    totalPeople: Math.round(sPeople),
    tickMs: world.debug.tickMs.toFixed(2),
  };
}

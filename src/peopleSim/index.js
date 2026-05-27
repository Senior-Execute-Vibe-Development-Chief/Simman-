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
    // New settlements crystallise spontaneously at fertile sites,
    // weighted by transport distance to existing ones.
    maybeCrystallize(world);
    if (world.step % 32 === 0) pruneDead(world);
    if (world.step % 256 === 0) checkFarmlandOwnership(world);
    world.debug.tickMs = performance.now() - t0;
  }
  return world;
}

// Sanity check: every farmland tile belongs to exactly one alive
// settlement, _farmedBy[ti] points at that settlement. Catches any
// regression that lets two settlements claim the same ground or
// leaves orphan-owned tiles after a settlement dies.
const _farmlandWarned = new Set();
function checkFarmlandOwnership(world) {
  const seen = new Map();              // ti -> first settlement id seen
  for (const s of world.settlements) {
    if (s.mode !== "settled" || !s.farmland) continue;
    for (const ti of s.farmland) {
      const prev = seen.get(ti);
      if (prev !== undefined && prev !== s.id) {
        const key = `dup:${ti}`;
        if (!_farmlandWarned.has(key)) {
          _farmlandWarned.add(key);
          console.warn(`[peopleSim] farmland overlap at tile ${ti}: settlements ${prev} and ${s.id}`);
        }
      }
      seen.set(ti, s.id);
      if (world._farmedBy[ti] !== s.id) {
        const key = `mismatch:${ti}`;
        if (!_farmlandWarned.has(key)) {
          _farmlandWarned.add(key);
          console.warn(`[peopleSim] _farmedBy[${ti}]=${world._farmedBy[ti]} but settlement ${s.id} has it in farmland`);
        }
      }
    }
  }
  // Walk _farmedBy for orphan ownership (tile owned by a dead/nonexistent settlement).
  const aliveIds = new Set();
  for (const s of world.settlements) if (s.mode === "settled") aliveIds.add(s.id);
  for (let ti = 0; ti < world._farmedBy.length; ti++) {
    const o = world._farmedBy[ti];
    if (o === -1) continue;
    if (!aliveIds.has(o)) {
      const key = `orphan:${ti}`;
      if (!_farmlandWarned.has(key)) {
        _farmlandWarned.add(key);
        console.warn(`[peopleSim] orphan-owned tile ${ti}: settlement ${o} is not alive`);
      }
      world._farmedBy[ti] = -1;        // self-heal
    }
  }
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

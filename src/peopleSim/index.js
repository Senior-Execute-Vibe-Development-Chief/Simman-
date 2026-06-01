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
import { updatePolities } from "./conquest.js";
import { musterArmies, advanceFronts, moveArmies, MUSTER_INTERVAL } from "./armies.js";
import { updateSea, moveShips, SEA_INTERVAL } from "./sea.js";
import { updateShocks } from "./shocks.js";
import { updateInflation } from "./inflation.js";
import { foldMoney } from "./money.js";
import { T } from "./tuning.js";

// Territory / conquest / polity cadences are runtime levers (tuning.js:
// T.TERRITORY_INTERVAL, T.CONQUEST_INTERVAL, T.POLITY_INTERVAL) — the step
// loop below gates each pass on its live value.

export function initPeopleSim(worldGen, opts = {}) {
  return createWorld(worldGen, opts);
}

export function stepPeopleSim(world, n = 1) {
  // Optional per-pass timing (set world._dbgProfile to capture a breakdown of
  // the most expensive passes into world.debug.pass). Zero cost when off.
  const prof = world._dbgProfile ? (world.debug.pass || (world.debug.pass = {})) : null;
  let _pt = 0; const mark = prof ? (k) => { const n2 = performance.now(); prof[k] = n2 - _pt; _pt = n2; } : () => {};
  for (let s = 0; s < n; s++) {
    const t0 = performance.now();
    if (prof) _pt = t0;
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
    mark("byId");
    // Recompute territory periodically: each settlement claims the land it
    // reaches cheapest, and its food / resources are tallied from it.
    if (world.step === 1 || world.step % T.TERRITORY_INTERVAL === 0) computeTerritory(world);
    mark("territory");
    for (let i = 0; i < world.settlements.length; i++) {
      updateSettlement(world, world.settlements[i]);
    }
    mark("settlements");
    // Exogenous shocks: regional famines (harvest crash) + epidemics that
    // spread along the trade graph (population crash). Both feed the unrest /
    // control-budget systems, so a bad harvest or a plague can tip a stable
    // realm into collapse.
    updateShocks(world);
    mark("shocks");
    // New settlements crystallise spontaneously at fertile sites,
    // weighted by transport distance to existing ones.
    maybeCrystallize(world);
    mark("crystallize");
    // Roads: settlements build trade roads to partners, then trade
    // flows money along the network. updateTrade runs food trade
    // first within each pair, so a starving importer's wealth goes
    // to grain (and can dip into its reserve) before luxuries.
    maybeBuildRoads(world);
    mark("roads");
    // Recompute the per-component price level (quantity theory of money,
    // closed-system inflation). Runs every INFLATION_INTERVAL ticks and EMAs
    // toward the new target, so per-tick reads via localP are stable.
    updateInflation(world);
    updateTrade(world);
    mark("trade");
    // Smoothed per-settlement wealth change rate, for the money-flow
    // overlay (gold = gaining, red = losing). Cheap; ready when shown.
    for (let i = 0; i < world.settlements.length; i++) {
      const s = world.settlements[i];
      if (s.mode !== "settled") continue;
      s._wealthDelta = (s._wealthDelta || 0) * 0.9 + ((s.wealth || 0) - (s._wPrev || 0)) * 0.1;
    }
    if (world.step % 32 === 0) pruneDead(world);
    // Military: garrisons muster + are paid periodically; war fronts then
    // grind tile-by-tile across borders, annexing a settlement when its
    // heartland is stormed.
    if (world.step % MUSTER_INTERVAL === 0) musterArmies(world);
    if (world.step % T.CONQUEST_INTERVAL === 0) advanceFronts(world);
    moveArmies(world);   // marching reinforcement columns advance every tick
    mark("armies");
    // Maritime: colony ships sail every tick; the port→port sea-lane graph
    // (sea trade peers) and overseas colonisation are rebuilt periodically.
    moveShips(world);
    if (world.step % SEA_INTERVAL === 0) updateSea(world);
    mark("sea");
    // Polities: group settlements into countries, tribute, and let
    // over-extended members secede.
    if (world.step % T.POLITY_INTERVAL === 0) updatePolities(world);
    mark("polities");
    // Fold this tick's categorised money flows (recorded across all the
    // passes above) into each settlement's smoothed in/out rate, for the
    // info panel's "where the money comes from / goes" breakdown.
    for (let i = 0; i < world.settlements.length; i++) {
      const s = world.settlements[i];
      if (s.mode === "settled") foldMoney(s);
    }
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

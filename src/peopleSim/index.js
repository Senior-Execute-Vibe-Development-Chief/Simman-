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
import { updateSettlement, urbanise } from "./settlement.js";
import { aggregateFoodHierarchy } from "./foodHierarchy.js";
import { maybeCrystallize } from "./crystallize.js";
import { maybeBuildRoads, updateTrade } from "./roads.js";
import { computeTerritory } from "./territory.js";
import { computeCountryTerritory, adoptAndFound, nucleateFrontierStates } from "./countryTerritory.js";
import { buildSettlementGrid } from "./spatialGrid.js";
import { relaxClaim } from "./countryClaim.js";

// How often the drawn border crawls one ring toward the country-primary
// territory target (world._countryOwner). Small so borders visibly creep
// tile-by-tile rather than snapping each territory pass.
const CLAIM_RELAX_INTERVAL = 12;
import { updatePolities } from "./conquest.js";
import { musterArmies, advanceFronts, moveArmies, MUSTER_INTERVAL } from "./armies.js";
import { updateSea, moveShips, SEA_INTERVAL } from "./sea.js";
import { updateShocks } from "./shocks.js";
import { updateInflation } from "./inflation.js";
import { foldMoney } from "./money.js";
import { checkPeopleSimInvariants } from "./invariants.js";
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
    buildSettlementGrid(world);   // spatial index for near-settlement queries (crystallise / roads)
    mark("byId");
    // Recompute territory periodically: each settlement claims the land it
    // reaches cheapest, and its food / resources are tallied from it.
    if (world.step === 1 || world.step % T.TERRITORY_INTERVAL === 0) {
      computeTerritory(world);          // per-settlement food catchments (economy)
      computeCountryTerritory(world);   // clean per-country cost-Voronoi (the political map)
      adoptAndFound(world);             // settlements take their politics from the territory (villages adopt; stateless cities found)
      nucleateFrontierStates(world);    // primary state formation: a developed stateless frontier cluster mints a NEW country
    }
    // The drawn border CRAWLS toward that target a ring at a time, so land
    // exchanges (conquest / secession / absorption) play out tile-by-tile over
    // ticks instead of teleporting (see countryClaim.js relaxClaim).
    if (world.step === 1 || world.step % CLAIM_RELAX_INTERVAL === 0) relaxClaim(world);
    mark("territory");
    for (let i = 0; i < world.settlements.length; i++) {
      updateSettlement(world, world.settlements[i]);
    }
    urbanise(world);   // rural→urban drift: concentrate population into hubs so real cities form
    // Central-place food: surplus flows UP the liege tree so a city is fed by its
    // whole hinterland (foodHierarchy.js). Produces _foodNet for next tick's
    // updateFood; runs here so it sees this tick's fresh production + housing.
    aggregateFoodHierarchy(world);
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
    // Military: garrisons muster + are paid periodically; war fronts then grind
    // across borders, annexing a settlement when its heartland is stormed. Land
    // follows the cities: capturing a city flips it to the conqueror, and the
    // per-country Voronoi (computeCountryTerritory) re-draws its region cleanly.
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
    // Opt-in dev sanity pass (finiteness / non-negative wealth / tier range,
    // plus money + population totals on world.debug). Zero cost unless enabled.
    if (world._checkInvariants) checkPeopleSimInvariants(world);
    world.debug.tickMs = performance.now() - t0;
  }
  return world;
}

export function getEntities(world) {
  return { settlements: world.settlements };
}

export function peopleSimStats(world) {
  let sPeople = 0, sWealth = 0, aliveSettlements = 0, territoryTiles = 0, sArmy = 0;
  const tierCounts = [0, 0, 0, 0];
  for (const s of world.settlements) {
    if (s.mode === "dead") continue;
    aliveSettlements++;
    sPeople += s.people;
    sWealth += s.wealth || 0;
    sArmy += s.army || 0;
    territoryTiles += s._terrTiles || 0;
    if (s.tier >= 0 && s.tier < tierCounts.length) tierCounts[s.tier]++;
  }
  // Political map: land claimed (vs total land) and the largest single empire,
  // tallied from the per-tile country owner. This scans the whole owner array,
  // and peopleSimStats is posted ~30×/s, so cache it and refresh only every ~32
  // steps (it drifts slowly). Sum of state treasuries folds into the world's
  // total gold alongside settlement coin.
  let claimedTiles = 0, landTiles = 0, largestEmpire = 0, treasury = 0;
  const co = world._countryOwner, elev = world.elev;
  const cache = world._landStatsCache;
  if (cache && cache.landTiles > 0 && world.step - cache.step < 32) {
    claimedTiles = cache.claimedTiles; landTiles = cache.landTiles; largestEmpire = cache.largestEmpire;
  } else if (co && elev) {
    const perCountry = new Map();
    for (let i = 0; i < co.length; i++) {
      if (elev[i] <= 0) continue;
      landTiles++;
      const o = co[i];
      if (o >= 0) {
        claimedTiles++;
        const v = (perCountry.get(o) || 0) + 1; perCountry.set(o, v);
        if (v > largestEmpire) largestEmpire = v;
      }
    }
    world._landStatsCache = { step: world.step, claimedTiles, landTiles, largestEmpire };
  }
  if (world.countries) for (const c of world.countries.values()) treasury += c._treasury || 0;
  return {
    step: world.step,
    settlements: aliveSettlements,
    villages:    tierCounts[0],
    towns:       tierCounts[1],
    cities:      tierCounts[2],
    metropolises:tierCounts[3],
    territoryTiles,
    totalPeople: Math.round(sPeople),
    totalWealth: Math.round(sWealth + treasury),   // total gold in the world (settlement coin + state treasuries)
    totalArmy:   Math.round(sArmy),
    claimedTiles, landTiles,
    landPct: landTiles > 0 ? claimedTiles / landTiles : 0,
    countries: world.countries ? world.countries.size : 0,
    largestEmpire,
    tickMs: world.debug.tickMs.toFixed(2),
  };
}

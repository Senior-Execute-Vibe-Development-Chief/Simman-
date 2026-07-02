// Public API for the people simulator (settlements-only model).
//
//   initPeopleSim(worldGen, opts)  — build world + seed cradle villages
//   stepPeopleSim(world, n=1)      — advance N ticks
//   peopleSimStats(world)          — quick numbers for HUD / debug
//
// No bands — settlements are the atomic visible entity. New ones come
// from crystallisation, settler parties and overseas colonies.

import { createWorld, pruneDead } from "./state.js";
import { updateSettlement, urbanise, updateSoil, SOIL_INTERVAL } from "./settlement.js";
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
import { musterArmies, advanceFronts, MUSTER_INTERVAL } from "./armies.js";
import { updateSea, moveShips, SEA_INTERVAL } from "./sea.js";
import { updateShocks } from "./shocks.js";
import { updateClimate, CLIMATE_INTERVAL } from "./climate.js";
import { updateInflation } from "./inflation.js";
import { foldMoney } from "./money.js";
import { checkPeopleSimInvariants } from "./invariants.js";
import { chronicleTick } from "./chronicle.js";
import { techState } from "./tech.js";
import { updateCultures, CULTURE_INTERVAL } from "./cultures.js";
import { updateFaiths, FAITH_INTERVAL, updatePilgrimage, PILGRIM_INTERVAL } from "./faiths.js";
import { updateSlaveTrade, SLAVE_INTERVAL } from "./slavery.js";
import { updateDynasties, DYNASTY_INTERVAL } from "./dynasties.js";
import { diffuseIdentityField } from "./identityField.js";
import { T } from "./tuning.js";

const CHRONICLE_INTERVAL = 300;   // ticks between per-country chronicle milestone checks
// Per-tile identity field (identityField.js): mirror each settlement's
// culture/faith/language mix onto the tiles it owns. Stage 0 — a passive
// mirror that nothing reads yet — paced with the culture cadence so it
// refreshes right after the identity passes have moved the entity mixes.
const IDENTITY_MIRROR_INTERVAL = 150;

// Territory / conquest / polity cadences are runtime levers (tuning.js:
// T.TERRITORY_INTERVAL, T.CONQUEST_INTERVAL, T.POLITY_INTERVAL) — the step
// loop below gates each pass on its live value.

export function initPeopleSim(worldGen, opts = {}) {
  return createWorld(worldGen, opts);
}

// ── Real-history population anchor ───────────────────────────────────────
// The emergent food economy gets the SHAPE of early growth right but badly
// undershoots the modern explosion — left alone it stays near-flat from
// antiquity while the real world grew ~50× between 1 AD and 1950. So, exactly
// as the calendar anchors year↔step, we calibrate ONE global productivity index
// (world._eraProd) to recorded world population and let the per-settlement
// distribution stay fully emergent. _eraProd scales BOTH food production
// (settlement.js updateFood) and the rural ceiling (updatePopulation), so the
// food economy — trade, surplus, army labour — stays internally consistent and
// only the overall SCALE of civilisation tracks history.
//
// Anchors are [year, world population in MILLIONS] (standard historical
// estimates). 1 sim-person ≙ 1000 people, so the sim-unit target is
// millions × 1000. Interpolated in LOG space, since population grows
// geometrically.
const POP_ANCHORS = [
  [-9000,    2], [-5000,    5], [-3000,   14], [-1000,   50],
  [1,      200], [500,     190], [1000,   290], [1500,   450],
  [1700,   600], [1800,    990], [1850,  1260], [1900,  1650],
  [1950,  2520],
];
function realWorldPopSim(year) {
  const A = POP_ANCHORS, n = A.length;
  let m;
  if (year <= A[0][0]) m = A[0][1];
  else if (year >= A[n - 1][0]) m = A[n - 1][1];
  else { let i = 1; while (i < n && year > A[i][0]) i++;
    const a = A[i - 1], b = A[i], t = (year - a[0]) / (b[0] - a[0]);
    m = Math.exp(Math.log(a[1]) + (Math.log(b[1]) - Math.log(a[1])) * t); }   // log-linear
  return m * 1000;   // millions → sim-units (people / 1000)
}
const ANCHOR_MIN = 0.5, ANCHOR_MAX = 240, ANCHOR_SLEW = 0.02, ANCHOR_HEADROOM = 4;
function applyDemographicAnchor(world, popTotal, capTotal) {
  world._popTotal = popTotal;
  if (world._eraProd === undefined) world._eraProd = 1;
  if (capTotal <= 0 || popTotal <= 1) return;   // need a live population to steer by
  // Target the population a civilisation at the world's DEVELOPMENT level would have
  // — NOT the wall clock. Keying this on stepToYear was the two-clock landmine the
  // cardinal rule warns about: the linear calendar runs to "6000 AD" by step 18000
  // while the world is still developmentally medieval, so realWorldPopSim demanded a
  // far-future population and the integrator cranked _eraProd toward its ceiling —
  // inflating the single best-fertility settlement into a runaway primate mega-city
  // (the "civilisation always blooms in that one strip" artifact). world._civYear is
  // the emergent development pseudo-year (civYearFromOrg), so the target now tracks
  // what the world has BECOME: a world stuck in antiquity keeps an ancient
  // population forever, one that industrialises early grows early. (One-tick lag —
  // _civYear is set just after this call — is immaterial to the slow integrator.)
  const target = realWorldPopSim(world._civYear ?? -6000);
  if (target <= 0) return;
  // Integral control: nudge the global productivity index so the world TOTAL
  // population converges on the historical curve. Carrying capacity is linear in
  // _eraProd (food, fish, housing and the rural ceiling all scale with it), so
  // this feedback is bounded, and the integrator's infinite DC gain removes the
  // steady lag that pinning capacity directly leaves — population forever chasing
  // a rising ceiling — so the total lands ON the curve, not a fixed fraction below.
  //   ANTI-WIND-UP: cap how far total capacity may LEAD population (≤ HEADROOM×).
  // In the deep past a handful of seed villages fill in only at the logistic
  // rate, so target/pop is briefly enormous; without this the integrator would
  // wind straight to the clamp and then overshoot. Capping the lead lets
  // population grow at near-max rate while _eraProd stays only as high as it can
  // actually use — and where a steep stretch of the curve outruns the logistic
  // ceiling, the total simply lags gracefully instead of oscillating.
  const wantPop = target / popTotal;                       // drive pop → target
  const wantCap = ANCHOR_HEADROOM * popTotal / capTotal;   // but lead pop by ≤ HEADROOM×
  const want = world._eraProd * Math.min(wantPop, wantCap);
  const lo = world._eraProd * (1 - ANCHOR_SLEW), hi = world._eraProd * (1 + ANCHOR_SLEW);
  world._eraProd = Math.max(ANCHOR_MIN, Math.min(ANCHOR_MAX, Math.max(lo, Math.min(hi, want))));
}

// Civilisational development → pseudo-year. The era gates that used to read the
// wall-clock (frontier close, hinterland claim, identity salience) instead read how
// far the LEADING state has climbed the organisation ladder (a smooth 0→1 proxy for
// developmental stage), mapped here to the "year" a real civilisation at that stage
// would sit at. So those gates fire on REACHED DEVELOPMENT, not on a date: a world
// that industrialises early gets its frontier close early; one that stalls in
// antiquity never closes it. The anchor points trace organisation against the
// historical timeline, so a typical run still lines the gates up with real history —
// but nothing is pinned to the calendar; it is the tech that drives the clock.
import { civYearFromOrg } from "./cohesion.js";
export { civYearFromOrg };

export function stepPeopleSim(world, n = 1) {
  // Optional per-pass timing (set world._dbgProfile to capture a breakdown of
  // the most expensive passes into world.debug.pass). Zero cost when off.
  const prof = world._dbgProfile ? (world.debug.pass || (world.debug.pass = {})) : null;
  let _pt = 0; const mark = prof ? (k) => { const n2 = performance.now(); prof[k] = n2 - _pt; _pt = n2; } : () => {};
  for (let s = 0; s < n; s++) {
    const t0 = performance.now();
    if (prof) _pt = t0;
    world.step++;
    // ── Time granularity (T.SIM_GRANULARITY = G) ──────────────────────────
    // Run the sim in 1/G-size steps: every per-tick CLOCK (population growth,
    // learning, diffusion, settling, shocks) advances dt = 1/G as much, so the
    // SAME emergent history unfolds over G× more ticks in finer increments —
    // slower wall-clock, smoother. Rate PASSES (conquest, polity, muster) stretch
    // their tick-interval by G to stay paced with the slowed clock; RECOMPUTE
    // passes (territory, border-crawl) keep their interval and so refresh G× more
    // often per unit of history — free smoothness. G = 1 is the calibrated
    // baseline, byte-for-byte unchanged.
    const _G = Math.max(1, T.SIM_GRANULARITY || 1);
    world._dt = 1 / _G;
    const _ivl = (base) => Math.max(1, Math.round(base * _G));
    // Fast id → settlement lookup, refreshed each tick (the Map instance is
    // reused — clear+refill — so this allocates nothing per tick). Replaces
    // the O(n) linear scans the trade / knowledge passes would otherwise do
    // per peer (effectiveLocalRes, findById, ...).
    if (world._byId) world._byId.clear(); else world._byId = new Map();
    let _popSum = 0, _capSum = 0;
    for (let i = 0; i < world.settlements.length; i++) {
      const s = world.settlements[i];
      world._byId.set(s.id, s);
      s._wPrev = s.wealth || 0;   // baseline for the money-flow net-change readout
      if (s.mode !== "dead") { _popSum += s.people; _capSum += s._k || 0; }   // world totals for the demographic anchor
    }
    if (T.ANCHOR_POP > 0) applyDemographicAnchor(world, _popSum, _capSum);   // calibrate _eraProd to the historical population curve
    else { world._popTotal = _popSum; world._eraProd = 1; }                  // FULLY EMERGENT: no pinning — carrying capacity is whatever local tech + land support
    buildSettlementGrid(world);   // spatial index for near-settlement queries (crystallise / roads)
    mark("byId");
    // Civilisational development signal for the de-pinned era gates (frontier close,
    // hinterland claim, identity salience): the leading capital's ORGANISATION mapped
    // to a pseudo-year. Computed from last step's countries (a slow signal — a one-tick
    // lag is immaterial), so the gates downstream read REACHED DEVELOPMENT, not a date.
    let leadOrg = 0;
    if (world.countries) for (const c of world.countries.values()) {
      const k = c.capital && c.capital.knowledge;
      if (k && k.organization > leadOrg) leadOrg = k.organization;
    }
    world._leadOrg = leadOrg;
    world._civYear = civYearFromOrg(leadOrg);
    // Dynamic climate: advance the slow global state + per-tile fertility overlay
    // BEFORE the territory pass tallies food (territory.js multiplies fert by climMod),
    // so a harsh century is felt across every realm's catchment at once.
    if (world.step === 1 || world.step % _ivl(CLIMATE_INTERVAL) === 0) updateClimate(world);   // rate pass: walk/eruptions per unit of HISTORY
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
    if (world.step % _ivl(MUSTER_INTERVAL) === 0) musterArmies(world);
    if (world.step % _ivl(T.CONQUEST_INTERVAL) === 0) advanceFronts(world);
    mark("armies");
    // Maritime: colony ships sail every tick; the port→port sea-lane graph
    // (sea trade peers) and overseas colonisation are rebuilt periodically.
    moveShips(world);
    if (world.step % SEA_INTERVAL === 0) updateSea(world);
    mark("sea");
    if (world.step % _ivl(SOIL_INTERVAL) === 0) updateSoil(world);   // rate pass: fatigue accrual per unit of HISTORY
    mark("soil");
    // Polities: group settlements into countries, tribute, and let
    // over-extended members secede.
    if (world.step % _ivl(T.POLITY_INTERVAL) === 0) updatePolities(world);
    mark("polities");
    // Peoples: assimilation toward the ruler's culture, colonial divergence,
    // per-polity culture refresh (cultures.js).
    if (world.step % _ivl(CULTURE_INTERVAL) === 0) updateCultures(world);
    // Faiths: folk-faith seeding, organized genesis, trade-graph conversion,
    // state adoption + legitimacy, schisms (faiths.js).
    if (world.step % _ivl(FAITH_INTERVAL) === 0) updateFaiths(world);
    // Pilgrimage economy: the faithful send offerings to each creed's holy see
    // (faiths.js) — a holy city grows rich on devotion, no local production needed.
    if (world.step % _ivl(PILGRIM_INTERVAL) === 0) updatePilgrimage(world);
    // Slave trade: raiding captures people from weaker neighbours; the market clears
    // captives into coerced labour where it's demanded (slavery.js, coerced-labour step 2).
    if (world.step % _ivl(SLAVE_INTERVAL) === 0) updateSlaveTrade(world);
    // Thrones: rulers age/marry/die, succession + crises (dynasties.js).
    if (world.step % _ivl(DYNASTY_INTERVAL) === 0) updateDynasties(world);
    // Per-tile identity field (identityField.js): for the lens the user is
    // viewing, partition each realm into town COUNTIES and blur the seams into
    // gradients (Stage 2). Render-only: nothing in the sim reads the field, so it
    // can't perturb history/determinism/saves. _identityLens is set by the worker
    // from the active view; unset (headless / non-identity lens) → skipped.
    if (world._identityLens && (world.step === 1 || world.step % _ivl(IDENTITY_MIRROR_INTERVAL) === 0)) {
      diffuseIdentityField(world, world._identityLens);
    }
    // Country chronicle: the slow-drift events (a discovery, a growth/wealth
    // milestone) that aren't a single discrete moment, checked periodically.
    if (world.step % CHRONICLE_INTERVAL === 0) chronicleTick(world);
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
  // Leading era: the most advanced capital's tech era — drives the HUD ribbon
  // (the mirror's settlement records don't carry knowledge, so this must be
  // computed worker-side). Capitals only, so it's a few dozen techState calls.
  let leadingEra = 0;
  if (world.countries) for (const c of world.countries.values()) {
    const k = c.capital && c.capital.knowledge;
    if (k) { const e = techState(k).era; if (e > leadingEra) leadingEra = e; }
  }
  // Sum LIVE polity treasuries (like invariants.js), not the per-polity-pass
  // c._treasury snapshots: between passes the per-tick flows (tariffs, mint
  // seigniorage) drain purses into the live treasuries, so the snapshot sum
  // counted that coin in NEITHER place — the world-gold readout sawtoothed
  // ~50% at exactly the polity cadence.
  if (world.polities) for (const p of world.polities.values()) {
    if (p.endedStep < 0) treasury += Math.max(0, p.treasury || 0);
  }
  return {
    step: world.step,
    leadingEra,
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

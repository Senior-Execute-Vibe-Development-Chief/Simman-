// Public API for the people simulator (settlements-only model).
//
//   initPeopleSim(worldGen, opts)  — build world + seed cradle villages
//   stepPeopleSim(world, n=1)      — advance N ticks
//   peopleSimStats(world)          — quick numbers for HUD / debug
//
// No bands — settlements are the atomic visible entity. New ones come
// from crystallisation, settler parties and overseas colonies.

import { createWorld, pruneDead } from "./state.js";
import { updateSettlement, urbanise, stampLandHarvest, updateSoil, SOIL_INTERVAL, updateFishStocks, FISH_REGEN_INTERVAL } from "./settlement.js";
import { aggregateFoodHierarchy, poolFoodHierarchy } from "./foodHierarchy.js";
import { maybeCrystallize } from "./crystallize.js";
import { maybeBuildRoads, updateTrade } from "./roads.js";
import { computeTerritory } from "./territory.js";
import { computeCountryTerritory, adoptAndFound, nucleateFrontierStates } from "./countryTerritory.js";
import { buildSettlementGrid } from "./spatialGrid.js";
import { relaxClaim } from "./countryClaim.js";

// How often the drawn border crawls toward the country-primary territory target
// (world._countryOwner). Small so borders visibly creep tile-by-tile rather than
// snapping each territory pass.
const CLAIM_RELAX_INTERVAL = 12;
// Under the REACTIVE model (TILE_POLITY) the crawl (_countryClaim) is a PURE RENDER
// layer — nothing in the sim reads it (grownLiveOwnerAt reads _countryOwner) — so run it
// on a FINE cadence for a continuously-moving border instead of a ring every 12 ticks.
// The per-call pressure step is scaled by the cadence (relaxClaim's pressStep) so the
// average advance PACE is unchanged; only the temporal resolution is finer. Pre-reactive
// models keep the 12-tick cadence (there the crawl feeds adoption; byte-identical).
const CLAIM_RELAX_FINE = 3;
// Control-field cadence: the field is a slow render layer (pretty borders), so advancing it
// one hop every few ticks instead of every tick cuts its cost ~this× for an imperceptible
// change in how the border moves. (The field pass is ~half a tick if run every tick.)
const CTRL_FIELD_STRIDE = 4;
import { updatePolities, resolveOrphanedMarches } from "./conquest.js";
import { musterArmies, advanceFronts, MUSTER_INTERVAL } from "./armies.js";
import { updateSea, moveShips, SEA_INTERVAL } from "./sea.js";
import { updateShocks } from "./shocks.js";
import { updateClimate, CLIMATE_INTERVAL } from "./climate.js";
import { updateHarvestYears, HARVEST_INTERVAL } from "./harvest.js";
import { updateInflation } from "./inflation.js";
import { foldMoney } from "./money.js";
import { checkPeopleSimInvariants } from "./invariants.js";
import { chronicleTick } from "./chronicle.js";
import { sumTileWealth } from "./tileMoney.js";
import { techState } from "./tech.js";
import { updateCultures, CULTURE_INTERVAL } from "./cultures.js";
import { updateFaiths, FAITH_INTERVAL, updatePilgrimage, PILGRIM_INTERVAL } from "./faiths.js";
import { updateSlaveTrade, SLAVE_INTERVAL } from "./slavery.js";
import { updateDynasties, DYNASTY_INTERVAL } from "./dynasties.js";
import { diffuseIdentityField } from "./identityField.js";
import { stepPopField, deriveOnePop } from "./popField.js";
import { stepControlField } from "./controlField.js";
import { T, rNormPop } from "./tuning.js";

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

// (The real-history population anchor — realWorldPopSim + applyDemographicAnchor —
// was removed in the 2026-07 default-flip campaign with its T.ANCHOR_POP lever: it
// was the legacy two-clock trap codified, population steered to a recorded curve
// instead of emerging. The modern boom's real mechanism is INDUSTRIAL_CAP + the
// energy-regimes wave, not a curve fit.)

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
    // Phase-offset a cadence: same interval, fired at a fixed offset so the
    // heavy passes stop stacking on one tick. All intervals used to share
    // phase 0 and their common factors made every multiple of 600 a
    // sea+polity+culture+faith+war+dynasty mega-tick (measured worst ticks
    // 174ms → 1197ms). Offsets are small distinct primes: pure scheduling —
    // per-pass cadence, ordering-on-shared-ticks, and determinism unchanged.
    const _at = (base, phase) => { const m = _ivl(base); return world.step % m === phase % m; };
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
    world._popTotal = _popSum; world._eraProd = 1;                  // FULLY EMERGENT: no pinning — carrying capacity is whatever local tech + land support (the legacy anchor was removed with T.ANCHOR_POP)
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
    // The harvest years (T.HARVEST_YEARS, harvest.js): the ANNUAL regional layer
    // under the century walk — each year every region draws its harvest index
    // (amplitude = its own yield CV), settlements' landFood multiplies by it,
    // and famine DERIVES from the tail. Before the food passes for the same
    // reason as the climate line above.
    if (world.step % _ivl(HARVEST_INTERVAL) === 0) updateHarvestYears(world);
    // Recompute territory periodically: each settlement claims the land it
    // reaches cheapest, and its food / resources are tallied from it.
    // PERF CADENCE at large maps (RES_INVARIANT_POP): the territory flood's work grows
    // ~rNorm² (same real catchments over rNorm²× tiles — measured 63-203 s per firing at
    // 1920-pixel Modern, 97% of all compute), so its cadence stretches by rNorm to keep
    // the amortized cost bounded. Cadence only — how OFTEN the same computation runs,
    // never whether/what; clamped so the reference grid and anything below it (all byte-
    // identity probes) keep the exact base interval. The real fix (B80-style budgeted
    // incremental flood) is designed in docs/roadmap-wave-6.md.
    const _terrIvl = Math.max(T.TERRITORY_INTERVAL, Math.round(T.TERRITORY_INTERVAL * rNormPop(world)));
    if (world.step === 1 || world.step % _terrIvl === 0) {
      computeTerritory(world);          // per-settlement food catchments (economy)
      computeCountryTerritory(world);   // clean per-country cost-Voronoi (the political map)
      resolveOrphanedMarches(world);    // T.SUCCESSOR_STATES: shed marches resolve (restore → secede → witnessed lapse) BEFORE the derivation reads the ground
      adoptAndFound(world);             // settlements take their politics from the territory (villages adopt; stateless cities found)
      nucleateFrontierStates(world);    // primary state formation: a developed stateless frontier cluster mints a NEW country
    }
    // The drawn border CRAWLS toward that target, so land exchanges (conquest /
    // secession / absorption / growth) play out tile-by-tile over ticks instead of
    // teleporting (see countryClaim.js relaxClaim). Under the reactive model the crawl is
    // pure render, so run it FINELY (every CLAIM_RELAX_FINE ticks) at a pace-preserving
    // pressure step for a continuously-moving border; pre-reactive models keep the 12-tick
    // cadence (byte-identical, the crawl feeds adoption there).
    {
      const _relaxIvl = T.TILE_POLITY ? CLAIM_RELAX_FINE : CLAIM_RELAX_INTERVAL;
      if (world.step === 1 || world.step % _relaxIvl === 0) relaxClaim(world, _relaxIvl / CLAIM_RELAX_INTERVAL);
    }
    mark("territory");
    for (let i = 0; i < world.settlements.length; i++) {
      const s = world.settlements[i];
      if (s.mode === "settled") stampLandHarvest(world, s);
    }
    // Same-tick imports: pool this tick's harvest before the granary ledger runs.
    poolFoodHierarchy(world);
    for (let i = 0; i < world.settlements.length; i++) {
      updateSettlement(world, world.settlements[i]);
    }
    urbanise(world);   // rural→urban drift: concentrate population into hubs so real cities form
    // Population field (T.POP_FIELD): advance the per-tile people/carrying-capacity
    // substrate. It's a SLOW diffusion (logistic growth + capacity-seeking migration),
    // so it runs on a STRIDE (POP_FIELD_STRIDE) at stride× the step size — same
    // trajectory, ~1/stride the cost (the field pass is the whole field-model overhead).
    mark("settLoop");
    // Runs after the settlement pass so it reads this tick's leading agriculture.
    {
      const _pfs = Math.max(1, T.POP_FIELD_STRIDE | 0);
      if (T.POP_FIELD && world.step % _pfs === 0) {
        stepPopField(world, _pfs);
        mark("popField");
        // ONE POPULATION (docs/one-population.md slice B): the census is a
        // DERIVED READ of the field over each settlement's catchment; this
        // also stamps next pass's urban capacity spikes and core rates.
        deriveOnePop(world);
        mark("derive");
      }
    }
    // Scarcity prices for next territory cadence (pooling ran before the ledger).
    aggregateFoodHierarchy(world);
    // Political control field (controlField.js). In PRETTY mode (CONTROL_FIELD, CTRL_LIVE off)
    // it's a render-only layer (world._ctrlOwner is the drawn border; nothing in the sim reads
    // it) — so STRIDE it (the border relaxes one hop per firing and moves slowly, and the
    // render ships it only every few snapshots anyway) to keep its cost small. Live mode
    // (CTRL_LIVE) authors _countryOwner, still on the same cheap cadence.
    if (T.CONTROL_FIELD && world.step % CTRL_FIELD_STRIDE === 0) { stepControlField(world); mark("ctrlField"); }
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
    if (_at(MUSTER_INTERVAL, 23)) musterArmies(world);
    if (world.step % _ivl(T.CONQUEST_INTERVAL) === 0) advanceFronts(world);
    mark("armies");
    // Maritime: colony ships sail every tick; the port→port sea-lane graph
    // (sea trade peers) and overseas colonisation are rebuilt periodically.
    moveShips(world);
    if (world.step % SEA_INTERVAL === 7 % SEA_INTERVAL) updateSea(world);
    mark("sea");
    if (_at(SOIL_INTERVAL, 11)) updateSoil(world);   // rate pass: fatigue accrual per unit of HISTORY
    // Coastal fish-stock regrowth (T.FISH_LABOR): exact logistic step, amortized.
    // Plain tick modulo (NOT granularity-stretched): the drawdown in updateFood is
    // a per-tick food flow like the rest of the granary ledger, so regrowth must
    // share the same clock — and the exact step is interval-invariant anyway.
    if (world.step % FISH_REGEN_INTERVAL === 13 % FISH_REGEN_INTERVAL) updateFishStocks(world);
    mark("soil");
    // Polities: group settlements into countries, tribute, and let
    // over-extended members secede.
    if (_at(T.POLITY_INTERVAL, 37)) updatePolities(world);
    mark("polities");
    // Peoples: assimilation toward the ruler's culture, colonial divergence,
    // per-polity culture refresh (cultures.js).
    if (_at(CULTURE_INTERVAL, 41)) updateCultures(world);
    // Faiths: folk-faith seeding, organized genesis, trade-graph conversion,
    // state adoption + legitimacy, schisms (faiths.js).
    if (_at(FAITH_INTERVAL, 43)) updateFaiths(world);
    // Pilgrimage economy: the faithful send offerings to each creed's holy see
    // (faiths.js) — a holy city grows rich on devotion, no local production needed.
    if (_at(PILGRIM_INTERVAL, 47)) updatePilgrimage(world);
    // Slave trade: raiding captures people from weaker neighbours; the market clears
    // captives into coerced labour where it's demanded (slavery.js, coerced-labour step 2).
    if (_at(SLAVE_INTERVAL, 53)) updateSlaveTrade(world);
    // Thrones: rulers age/marry/die, succession + crises (dynasties.js).
    if (_at(DYNASTY_INTERVAL, 59)) updateDynasties(world);
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
  let claimedTiles = 0, landTiles = 0, largestEmpire = 0, treasury = 0, beltShareOut = 0, beltCountOut = 0;
  const co = world._countryOwner, elev = world.elev;
  const cache = world._landStatsCache;
  if (cache && cache.landTiles > 0 && world.step - cache.step < 32) {
    claimedTiles = cache.claimedTiles; landTiles = cache.landTiles; largestEmpire = cache.largestEmpire;
    beltShareOut = cache.beltShare || 0; beltCountOut = cache.beltCount || 0;
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
    // BELT decomposition — the owner-facing form of the atlas-gap wave's core
    // measurement (probe_beltclaims / docs/atlas-gap-2026-08-14.md): claimed
    // land groups into contact-connected BELTS (states within a small real
    // distance of one another share a belt), and history's telling ratio is
    // the LEADING belt's share of all claimed land (the real Old World belt
    // held 75-80% until ~1800). Multi-source BFS from claimed tiles out to a
    // REAL gap (6 reference tiles ≈ 1000 km — the probe's merge scale, grid-
    // honest via ×tw/240), then one flood labels the dilated mask. O(N) per
    // cache refresh (every 32 steps), scratch reused.
    let beltShare = 0, beltCount = 0;
    if (claimedTiles > 0) {
      const N = co.length, tw = world.tw;
      const GAP = Math.max(1, Math.round(6 * tw / 240));
      let sc = world._beltScratch;
      if (!sc || sc.dist.length !== N) sc = world._beltScratch = { dist: new Int16Array(N), belt: new Int32Array(N), q: new Int32Array(N) };
      const { dist, belt, q } = sc;
      dist.fill(-1); belt.fill(-1);
      let qh = 0, qt = 0;
      for (let i = 0; i < N; i++) if (co[i] >= 0 && elev[i] > 0) { dist[i] = 0; q[qt++] = i; }
      while (qh < qt) {
        const i = q[qh++]; const d = dist[i];
        if (d >= GAP) continue;
        const y = (i / tw) | 0, x = i - y * tw;
        const ns = [y * tw + ((x + 1) % tw), y * tw + ((x - 1 + tw) % tw), i - tw, i + tw];
        for (let k = 0; k < 4; k++) {
          const j = ns[k];
          if (j < 0 || j >= N || dist[j] >= 0 || !(elev[j] > 0)) continue;
          dist[j] = d + 1; q[qt++] = j;
        }
      }
      let beltTop = 0;
      for (let s0 = 0; s0 < N; s0++) {
        if (dist[s0] < 0 || belt[s0] >= 0) continue;
        let bh = 0, bt = 0, claimedInBelt = 0;
        q[bt++] = s0; belt[s0] = beltCount;
        while (bh < bt) {
          const i = q[bh++];
          if (co[i] >= 0) claimedInBelt++;
          const y = (i / tw) | 0, x = i - y * tw;
          const ns = [y * tw + ((x + 1) % tw), y * tw + ((x - 1 + tw) % tw), i - tw, i + tw];
          for (let k = 0; k < 4; k++) {
            const j = ns[k];
            if (j < 0 || j >= N || dist[j] < 0 || belt[j] >= 0) continue;
            belt[j] = beltCount; q[bt++] = j;
          }
        }
        if (claimedInBelt > 0) { beltCount++; if (claimedInBelt > beltTop) beltTop = claimedInBelt; }
      }
      beltShare = beltTop / claimedTiles;
    }
    beltShareOut = beltShare; beltCountOut = beltCount;
    world._landStatsCache = { step: world.step, claimedTiles, landTiles, largestEmpire, beltShare, beltCount };
  }
  // Leading era: the most advanced capital's tech era — drives the HUD ribbon
  // (the mirror's settlement records don't carry knowledge, so this must be
  // computed worker-side). Capitals only, so it's a few dozen techState calls.
  // T.LAND_KNOW: while no court exists, the land's own era carries the ribbon
  // (world._lkEra — cached per growth firing in landKnow.js, the max over
  // single records' tech eras). Unset off-lever → 0, byte-identical.
  let leadingEra = world._lkEra || 0;
  if (world.countries) for (const c of world.countries.values()) {
    const k = c.capital && c.capital.knowledge;
    if (k) { const e = techState(k).era; if (e > leadingEra) leadingEra = e; }
    // Sum the LIVE polity treasury (like invariants.js), not the per-pass
    // c._treasury snapshot: between passes the per-tick flows (tariffs, mint
    // seigniorage) drain purses into the live treasuries, so the snapshot sum
    // counted that coin in NEITHER place — the world-gold readout sawtoothed
    // ~50% at exactly the polity cadence. Reading through the countries view
    // keeps this O(live realms); world.polities keeps every realm EVER (a
    // ~30x/s snapshot path must not scale with total history).
    const pol = world.polities ? world.polities.get(c.id) : null;
    if (pol && pol.endedStep < 0) treasury += Math.max(0, pol.treasury || 0);
  }
  return {
    step: world.step,
    leadingEra,
    saveV: world._loadedSaveV,   // physics regime a LOADED world was born under (undefined = fresh world, current physics) — display-only
    openKind: world._openKind,   // invent-jump outcome: "mint-ready" | "invent" | "dawn"
    settlements: aliveSettlements,
    villages:    tierCounts[0],
    towns:       tierCounts[1],
    cities:      tierCounts[2],
    metropolises:tierCounts[3],
    territoryTiles,
    totalPeople: Math.round(sPeople),
    totalWealth: Math.round(sWealth + treasury),   // total gold in the world (settlement coin + state treasuries)
    tileWealth: T.TILE_MONEY > 0 ? Math.round(sumTileWealth(world)) : 0,   // farm-gate coin on worked tiles (coin-field lens)
    totalArmy:   Math.round(sArmy),
    claimedTiles, landTiles,
    landPct: landTiles > 0 ? claimedTiles / landTiles : 0,
    countries: world.countries ? world.countries.size : 0,
    largestEmpire,
    beltShare: beltShareOut, beltCount: beltCountOut,
    tickMs: world.debug.tickMs.toFixed(2),
  };
}

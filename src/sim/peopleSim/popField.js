// ── Phase 1 of the field-simulation rewrite (T.POP_FIELD) ──────────────────────
//
// Population lives on the LAND, not on settlement entities. Two per-tile fields:
//   world.capField[ti] — carrying capacity (people the tile can feed) = fertility ×
//     the agricultural DEVELOPMENT available there (emergent, never a clock) —
//     under T.DEV_FIELD (default) the LOCAL technique that has actually reached
//     the tile (the wave-of-advance block below) plus a pastoral rangeland term;
//     lever off, the phase-1 global scalar.
//   world.popField[ti] — people actually living on the tile. Grows LOGISTICALLY
//     toward the tile's capacity, and MIGRATES down the capacity gradient so a full
//     cradle spills its surplus into empty fertile land (the peopling of the world
//     as a diffusion, not a settlement scatter).
//
// Seeded from the deep-ancestry peopling (tArrival: long-settled cradles start
// populated, the frontier near-empty), so the field reproduces where civilisation
// actually massed — dense river valleys and fertile belts, sparse deserts/tundra.
//
// LEVER-GATED, default OFF: when off, none of this runs and the settlement sim is
// byte-identical. When on (phase 1) it runs ALONGSIDE the settlement model purely as
// the demographic substrate to validate; phases 2-3 move food, territory and the
// settlements themselves onto it. Pure function of the terrain + emergent tech, fully
// deterministic (double-buffered migration), never persisted-vs-recomputed ambiguous
// (both fields are re-derivable, but popField carries state so it IS saved — see persist).

import { T } from "./tuning.js";
import { tileOpenness } from "./transport.js";

const DIRS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// Carrying capacity: people per unit (fertility × development) on one tile at
// saturation. A calibration constant — its absolute value sets total world
// population; the DISTRIBUTION (the point of phase 1) is set by fertility alone.
const CAP_PER_FERT = 1200;
// Development multiplier: local carrying capacity rises with AGRICULTURAL tech —
// a hunter-gatherer land feeds a thin scatter, an irrigated-plough society feeds a
// dense one. Emergent (read from the world's leading agriculture in phase 1);
// becomes a field in a later phase. base at neolithic → ~×3.3 at full farming tech.
const DEV_BASE = 0.30, DEV_TECH = 3.0;
const POP_GROWTH = 0.03;    // logistic intrinsic growth per step (r in pop += r·pop·(1−pop/K))
const POP_MIGRATE = 0.06;   // share of a tile's people that migrate toward spare capacity per step
const SEED_POP = 0.4;       // people seeded per habitable tile (the spark logistic growth needs)

// ── T.DEV_FIELD: the REGIONAL development field (the phase the header promised:
// "becomes a field in a later phase") ────────────────────────────────────────
// world.devField[ti] = the agricultural TECHNIQUE known to the people ON that
// ground (0..1). Settlements STAMP their own agriculture onto the land they
// work (their catchments); from there the technique DIFFUSES over land as a
// wave of advance — the Neolithic expansion's measured mechanism (Ammerman &
// Cavalli-Sforza: farming crossed Europe at ~1 km/year, carried farmer-to-
// forager and farmer-by-migration). Carrying capacity then reads the LOCAL
// technique instead of one global scalar, so the civilized cores grow dense
// while the deep frontier stays a thin subsistence scatter — and the contrast
// between them WIDENS as regional development diverges and COLLAPSES as it
// diffuses. Emergent everywhere: no clock, no named region, no cap on where
// the wave may reach.
//   • WAVE SPEED: one tile per firing, with the firing interval derived from
//     DEV_WAVE_KMPY (km/year) and the grid's real tile size — so the same
//     km/year at any resolution (÷rNormPop) and any SIM_GRANULARITY (×G, the
//     _ivl pattern: dyn-years per step shrink 1/G while intervals stretch G).
//   • THINNING: a package loses DEV_WAVE_LOSS_PLANET of its level across a
//     full planet circumference of distance from where it is practiced —
//     remote peoples work a degraded version until nearer sources arise
//     (their own settlements then stamp the real local level). One
//     planetary-scale constant, no per-place tuning.
//   • RATCHET: the field only rises (techniques spread; forgetting is the
//     settlement layer's KNOW_DECAY story, not the frontier's). Double-
//     buffered relaxation — an in-place max sweep would cascade a whole row
//     in one pass (infinite wave speed along the scan direction).
//   • GENESIS: the map starts at 3000 BC, AFTER the real Neolithic expansion
//     (~9000→3000 BC) — so a fresh (or newly-activated) field inherits that
//     skipped history as an INITIAL CONDITION: the same wave, run from the
//     cradle hearths for DEV_INIT_YEARS before the first step. An initial
//     condition, not a gate (the genesis-seed philosophy).
const DEV_WAVE_KMPY = 1.0;          // wave-of-advance speed (the measured Neolithic ~1 km/year)
const DEV_WAVE_LOSS_PLANET = 1.0;   // technique lost per planet-circumference of distance from a source
const DEV_INIT_YEARS = 6000;        // pre-map Neolithic spread inherited at genesis (9000→3000 BC)
const EARTH_KM = 40075;             // planet circumference — the map's x-extent in km
// ── Pastoral capacity (the mechanism DEV_FIELD un-masked) ────────────────────
// The global scalar had been silently gifting the STEPPE farming-level capacity;
// with capacity honest about local technique, the range thinned to nothing and
// the nomad system starved (measured: hordes classified from t≈18k with 50 raids
// under the scalar; first classification t≈24k and ZERO raids under the bare
// wave). The missing CAUSE: herding converts grass — inedible to people — into
// food, independent of crop technique. Rangeland capacity is openness-weighted
// (transport.js tileOpenness: dry grass, low relief — the same saddle-country
// measure the nomad system reads) at the historical pastoral density: ~1/10 of
// what fert-1.0 cropland feeds at the pre-farming base. An economy uses the
// better strategy locally (max), so the herd beats the plough exactly where the
// ground is open and too poor to farm — the steppe carries real people again
// without giving back the farming contrast. Sheep/goat pastoralism predates the
// 3000 BC start wherever grass grows, so v1 is technique-free; scaling the range
// with the mounted complex (mobility diffusion) is a noted follow-up.
const PASTORAL_DENS = 0.10;         // people per openness-1 range tile, as a fraction of fert-1 cropland at CAP_PER_FERT

// Firing interval (steps) for the wave at this grid: a tile is EARTH_KM/tw km
// across and the wave crosses one tile per firing, so fire every
// tileKm/KMPY years = tileKm/KMPY/0.25 steps (dyn-years run 0.25/G per step,
// intervals stretch ×G — the _ivl pattern). Resolution-invariant by
// construction: a finer grid has smaller tiles and proportionally shorter
// intervals, the same km/year everywhere.
function devWaveIvl(world) {
  const tileKm = EARTH_KM / world.tw;
  const G = T.SIM_GRANULARITY || 1;
  return Math.max(1, Math.round(tileKm / DEV_WAVE_KMPY / 0.25 * G));
}
const devWaveLoss = (world) => DEV_WAVE_LOSS_PLANET / world.tw;

/** Stamp every settlement's own agriculture onto the land it works. */
function stampDevSources(world, dev) {
  const owner = world._territoryOwner, byId = world._byId, tw = world.tw;
  if (owner && byId) {
    for (let i = 0; i < world.N; i++) {
      const sid = owner[i];
      if (sid < 0) continue;
      const s = byId.get(sid);
      if (!s || s.mode !== "settled") continue;
      const a = (s.knowledge && s.knowledge.agriculture) || 0;
      if (a > dev[i]) dev[i] = a;
    }
  }
  // Home tiles directly, so a settlement with no catchment yet still radiates.
  for (const s of world.settlements) {
    if (s.mode !== "settled") continue;
    const ti = (s.pos.y | 0) * tw + (s.pos.x | 0);
    if (ti < 0 || ti >= world.N) continue;
    const a = (s.knowledge && s.knowledge.agriculture) || 0;
    if (a > dev[ti]) dev[ti] = a;
  }
}

/** One wave relaxation: each land tile rises toward its best neighbour − loss. */
function relaxDevWave(world, dev, land) {
  const tw = world.tw, th = world.th;
  let nxt = world._devNext;
  if (!nxt || nxt.length !== world.N) nxt = world._devNext = new Float32Array(world.N);
  nxt.set(dev);
  const loss = devWaveLoss(world);
  for (let li = 0; li < land.length; li++) {
    const i = land[li];
    const y = (i / tw) | 0, x = i - y * tw;
    let best = dev[y * tw + ((x + 1) % tw)];
    const l = dev[y * tw + ((x - 1 + tw) % tw)];
    if (l > best) best = l;
    if (y > 0 && dev[i - tw] > best) best = dev[i - tw];
    if (y < th - 1 && dev[i + tw] > best) best = dev[i + tw];
    const v = best - loss;
    if (v > nxt[i]) nxt[i] = v;
  }
  world._devNext = dev;
  world.devField = nxt;
  return nxt;
}

/**
 * Allocate + seed the development field: stamp today's sources, then run the
 * skipped pre-map Neolithic expansion (DEV_INIT_YEARS of the same wave) so a
 * 3000 BC world starts with farming already spread around its hearths — the
 * eve-of-states initial condition. Deterministic (a pure function of current
 * state); also serves an old save on load (absent field → same seeding).
 */
function ensureDevField(world, land) {
  if (world.devField && world.devField.length === world.N) return world.devField;
  let dev = world.devField = new Float32Array(world.N);
  world._devNext = new Float32Array(world.N);
  stampDevSources(world, dev);
  const tileKm = EARTH_KM / world.tw;
  const iters = Math.max(0, Math.round(DEV_INIT_YEARS * DEV_WAVE_KMPY / tileKm));
  for (let k = 0; k < iters; k++) dev = relaxDevWave(world, dev, land);
  return dev;
}

// ── Carrying-capacity terms beyond raw fertility (phase 2) ──────────────────
// Real land does not feed people in proportion to its crop suitability alone: a
// river valley or a coast supports FAR denser settlement than the same soil
// inland, because water carries food IN (irrigation + grain barges + sea trade —
// the market/port premium), while rugged land supports LESS. Each term is a
// genuine mechanism with independent physical meaning (never a size fitted to a
// place): the great river valleys, deltas and coastal plains concentrate on their
// own, and so does any map you never looked at.
const RM_FULL = 4;          // river magnitude of a GREAT river (Nile/Yangtze) — the data's top bin; access ∝ min(1, mag/RM_FULL)
const ACCESS_RIVER = 1.0;   // full-magnitude river's share of the transport-access premium
const ACCESS_COAST = 0.35;  // a coast's share (fisheries + sea trade) — weaker than a great river
// The premium GROWS with development: a neolithic landing imports little, an
// industrial port draws grain from a continent. Emergent (reads leading
// agriculture as the transport-tech proxy), never a clock. base (ancient
// irrigation already ~doubles a great valley) → +ACCESS_DEVK at full tech.
const ACCESS_DEV0 = 1.0, ACCESS_DEVK = 1.0;
const RELIEF_PEN = 3.0;     // how sharply local ruggedness (relief 0..~0.54) cuts capacity: cap ×= 1/(1+RELIEF_PEN·relief)

export function initPopField(world) {
  const N = world.N;
  const pop = world.popField = new Float32Array(N);
  world.capField = new Float32Array(N);
  world._popNext = new Float32Array(N);
  const { elev, fert, tArrival } = world;
  for (let i = 0; i < N; i++) {
    if (!(elev[i] > 0) || !(fert[i] > 0.03)) continue;
    // Residence: 1 in the long-settled cradle of humanity (tArrival→0), →0 on the
    // late-reached frontier (tArrival→1). Long-peopled land starts with a real seed
    // population; the frontier starts near-empty and fills by migration.
    const residence = tArrival ? (1 - Math.min(1, Math.max(0, tArrival[i]))) : 0.5;
    pop[i] = SEED_POP * (0.15 + 0.85 * residence);
  }
}

// Advance the population field one step: capacity → logistic growth → migration.
// `sub` = how many ticks this firing represents (POP_FIELD_STRIDE); the step size
// scales by it so a strided field follows the same trajectory at ~1/sub the cost.
export function stepPopField(world, sub = 1) {
  const N = world.N, tw = world.tw, th = world.th;
  const { elev, fert, riverMag, relief, coast } = world;
  let pop = world.popField, cap = world.capField;
  if (!pop || pop.length !== N) { initPopField(world); pop = world.popField; cap = world.capField; }

  // Global agricultural development (emergent — phase 1 reads it from settlements'
  // leading agriculture; T.DEV_FIELD replaces this scalar with the REGIONAL
  // technique field — see the wave-of-advance block above).
  let leadAgri = 0;
  for (const s of world.settlements) if (s.mode === "settled") { const a = (s.knowledge && s.knowledge.agriculture) || 0; if (a > leadAgri) leadAgri = a; }
  const dev = DEV_BASE + DEV_TECH * leadAgri;
  // Time-granularity dt × stride: a firing advances `sub` ticks of history at
  // 1/G each (so it honours SIM_GRANULARITY), capped for integrator stability.
  // At the default stride 4 / G 1 → dt 4, the field advances 4 ticks per firing.
  const dt = Math.min(8, (world._dt || 1) * sub);

  // Iterate LAND tiles only. ~45% of the grid is ocean, where cap/pop are always 0
  // (water cap stays at its init 0, never written; nothing migrates into it) — so
  // skipping it is byte-identical, it just drops the field pass's dead iterations
  // (the whole field-model overhead scales with this loop count). The land index is
  // static (terrain), built once.
  const land = world._popLand && world._popLand.length ? world._popLand : (world._popLand = buildLandList(world));
  const nLand = land.length;

  // T.DEV_FIELD: keep the regional technique field current — stamp sources +
  // advance the wave one tile every devWaveIvl steps (~1 km/year at any grid).
  let devF = null, pasture = null;
  if (T.DEV_FIELD) {
    devF = ensureDevField(world, land);
    const ivl = devWaveIvl(world);
    if (world.step - (world._devWaveAt ?? -Infinity) >= ivl) {
      world._devWaveAt = world.step;
      stampDevSources(world, devF);
      devF = relaxDevWave(world, devF, land);
    }
    // Static rangeland capacity (openness is pure terrain — built once).
    pasture = world._pastureCap;
    if (!pasture || pasture.length !== N) {
      pasture = world._pastureCap = new Float32Array(N);
      for (let li = 0; li < nLand; li++) { const i = land[li]; pasture[i] = tileOpenness(world, i) * CAP_PER_FERT * PASTORAL_DENS; }
    }
  }

  // 1. Carrying capacity per tile = farmable yield (fert × development) lifted by
  //    the water-transport PREMIUM (river/coast can import food → denser settlement)
  //    and cut by rugged RELIEF. The premium is multiplicative on fert, so it
  //    concentrates people onto FERTILE valleys and shores (a barren river bank
  //    stays empty — you can't irrigate rock) rather than blooming deserts.
  //    Under T.DEV_FIELD both development terms read the LOCAL technique — the
  //    people of a tile farm (and build ports) with what has REACHED them, so
  //    the civilized cores support dense settlement while the deep frontier
  //    stays a thin subsistence scatter. Lever off: the global scalar, exactly.
  const accessDev = ACCESS_DEV0 + ACCESS_DEVK * leadAgri;   // transport premium grows with tech (emergent)
  for (let li = 0; li < nLand; li++) {
    const i = land[li];
    const water = riverMag ? Math.min(1, riverMag[i] / RM_FULL) : 0;
    const access = ACCESS_RIVER * water + ACCESS_COAST * (coast ? coast[i] : 0);
    const reliefMul = relief ? 1 / (1 + RELIEF_PEN * relief[i]) : 1;
    if (devF) {
      const a = devF[i];
      const reach = 1 + access * (ACCESS_DEV0 + ACCESS_DEVK * a);
      const crop = fert[i] * CAP_PER_FERT * (DEV_BASE + DEV_TECH * a) * reach * reliefMul;
      const range = pasture[i];   // the herd or the plough — whichever feeds this ground better (openness already prices relief)
      cap[i] = crop > range ? crop : range;
    } else {
      const reach = 1 + access * accessDev;
      cap[i] = fert[i] * CAP_PER_FERT * dev * reach * reliefMul;
    }
  }

  // T.ONE_POP: the urban spikes land in the capacity field (each city core
  // carries what its economy supports beyond its land), and the field's
  // intrinsic rate becomes the census's HUMAN rate — the field owns demography
  // now, so it grows like people, not like the phase-1 peopling wave. City
  // cores use their own transition/graveyard-bent rate (saved before the bulk
  // loop, re-integrated after with their stamped r).
  const onePop = !!T.ONE_POP;
  if (onePop) applyUrbanSpikes(world, cap);
  const rBulk = onePop ? T.SETT_GROWTH : POP_GROWTH;
  // ONE_POP activation: the world of 3000 BC was already peopled to its
  // Malthusian equilibrium — the phase-1 peopling SPARKS (grow-from-cradles)
  // are the wrong initial condition once the field grows at human rates (it
  // would take tens of millennia to fill). Seed the field AT equilibrium —
  // a residence-weighted fraction of local capacity (the late-reached
  // frontier sits below it) — once, at activation (scale unset = first
  // derive hasn't run). Idempotent via max(); the same skipped-history
  // reasoning as the genesis seeds and the pre-map Neolithic wave.
  if (onePop && !(world._onePopScale > 0)) {
    const tArr = world.tArrival;
    for (let li = 0; li < nLand; li++) {
      const i = land[li];
      const residence = tArr ? (1 - Math.min(1, Math.max(0, tArr[i]))) : 0.5;
      const eq = cap[i] * (0.55 + 0.35 * residence);   // long-peopled land presses its ceiling; the frontier sits under it
      if (eq > pop[i]) pop[i] = eq;
    }
  }
  // City cores grow at their OWN transition/graveyard-bent rate: save their
  // pre-growth values (a ~hundred entries), let the bulk loop run, then
  // re-integrate them exactly from the saved value with the stamped r.
  let corePre = null;
  if (onePop && world._urbanSpike && world._urbanSpike.size) {
    corePre = [];
    for (const [ti, e] of world._urbanSpike) if (e.r !== undefined && (e.r !== rBulk || e.sink > 0)) corePre.push(ti, pop[ti]);
  }

  // 2. Logistic growth toward capacity (in place).
  for (let li = 0; li < nLand; li++) {
    const i = land[li];
    const k = cap[i];
    if (k <= 0) { pop[i] = 0; continue; }
    const p = pop[i];
    if (p > 0) pop[i] = p + rBulk * dt * p * (1 - p / k);
  }
  if (corePre) {
    for (let j = 0; j < corePre.length; j += 2) {
      const ti = corePre[j], p = corePre[j + 1];
      const k = cap[ti];
      if (!(k > 0) || !(p > 0)) continue;
      const e = world._urbanSpike.get(ti);
      // the census's own form: bent logistic growth minus a FLAT graveyard
      // sink (excess mortality does not ease as the city fills)
      pop[ti] = Math.max(0, p + (e.r * (1 - p / k) - e.sink) * dt * p);
    }
  }

  // 3. Capacity-seeking migration (double-buffered → deterministic). Each tile sends
  //    a share of its people to neighbours weighted by their SPARE capacity (cap−pop):
  //    people flow from crowded land toward empty fertile land, which is what carries
  //    the cradle populations out across the map over deep time. No flow into water/
  //    zero-capacity tiles.
  let nxt = world._popNext; if (!nxt || nxt.length !== N) nxt = world._popNext = new Float32Array(N);
  nxt.set(pop);
  for (let li = 0; li < nLand; li++) {
    const i = land[li];
    const p = pop[i]; if (p <= 0) continue;
    const y = (i / tw) | 0, x = i - y * tw;
    let sumSpare = 0;
    const spare = _spare4; // reused scratch
    for (let d = 0; d < 4; d++) {
      const ny = y + DIRS4[d][1];
      if (ny < 0 || ny >= th) { spare[d] = 0; continue; }
      const nx = (x + DIRS4[d][0] + tw) % tw;
      const ni = ny * tw + nx;
      const s = cap[ni] - pop[ni];
      spare[d] = s > 0 ? s : 0;
      sumSpare += spare[d];
    }
    if (sumSpare <= 0) continue;                 // hemmed in by full/empty land — nobody leaves
    const move = POP_MIGRATE * dt * p;           // total leaving this tile this step
    nxt[i] -= move;
    for (let d = 0; d < 4; d++) {
      if (spare[d] <= 0) continue;
      const ny = y + DIRS4[d][1], nx = (x + DIRS4[d][0] + tw) % tw;
      nxt[ny * tw + nx] += move * (spare[d] / sumSpare);
    }
  }
  world.popField = nxt;
  world._popNext = pop;   // swap buffers
}

const _spare4 = new Float64Array(4);

// Static list of LAND tile indices (ascending, so the field loops keep their exact
// iteration order). Terrain is fixed, so this is built once and reused.
function buildLandList(world) {
  const { N, elev } = world;
  let n = 0; for (let i = 0; i < N; i++) if (elev[i] > 0) n++;
  const a = new Int32Array(n); let k = 0;
  for (let i = 0; i < N; i++) if (elev[i] > 0) a[k++] = i;
  return a;
}

// Total field population — for the demographic anchor / validation.
export function popFieldTotal(world) {
  const p = world.popField; if (!p) return 0;
  let s = 0; for (let i = 0; i < p.length; i++) s += p[i];
  return s;
}

// ── T.ONE_POP: the city is a concentration of the field (one population, B) ──
// docs/one-population.md slice B. The field takes OWNERSHIP of demography:
//   • its intrinsic rate becomes the census's human rate (T.SETT_GROWTH, with
//     the demographic-transition/urban-graveyard bend stamped at each city's
//     core tile) instead of the phase-1 peopling rate;
//   • each settlement's home tile carries an URBAN SPIKE of carrying capacity
//     = what its ECONOMY supports beyond what its land feeds (imports, the
//     granary, housing: s._k minus the catchment's terrain capacity) — the
//     concentration cities ARE, and the field's own capacity-seeking
//     migration into that spike IS urbanization (the census-side drift and
//     the census logistic both retire);
//   • s.people becomes a DERIVED READ: the field over the settlement's
//     catchment, in census units via a FIXED bridge scalar computed once at
//     activation (median census / median field-region — the POW_FIELD
//     anchoring pattern, frozen and persisted so it is a unit conversion,
//     never a second dynamic).
// A settlement dying no longer erases people — the region's people outlive
// the town, on the land, where they always were.

/** Apply the urban spikes (built by deriveOnePop) into this pass's capField. */
function applyUrbanSpikes(world, cap) {
  const sp = world._urbanSpike;
  if (!sp) return;
  for (const [ti, e] of sp) cap[ti] += e.k;
}

// ── T.URBAN_AGGLOM: agglomeration↔congestion urban concentration (ONE_POP) ──
// The Zipf blocker is that generic 4-neighbour diffusion is throughput-limited
// AND flows the WRONG way (toward EMPTY land — the peopling of a frontier),
// whereas urbanization is anti-diffusive: people concentrate UP the density
// gradient into the productive city, braked by congestion. This moves a
// region's people between its CORE tile and its own countryside toward an
// agglomeration target (a bigger economy pulls harder), the target sublinear
// in economic capacity because congestion cost rises super-linearly with
// density — so equilibrium size ∝ capacity^β, β<1, which compresses the
// heavy-tailed (−1.5) import economy toward the −0.8..−1.2 city envelope.
// CONSERVATIVE: people are only ever moved town↔country within the SAME
// region's owned tiles, never created or destroyed — the region's census total
// is unchanged, only its rural/urban split. Deterministic box walk, no RNG.
const URBAN_MAXSHARE = 0.9;  // a city holds at most this share of its region's people (the hinterland bound)
const URBAN_CONC_R = 6;      // the urban hinterland radius (tiles) people draw in from
const URBAN_CONC_LAMBDA = 0.2;  // relaxation toward the target per tick (convergence rate, not the equilibrium)
const URBAN_CONC_MAXFRAC = 0.5; // cap per-tick flux at half the available side (no single-tick emptying)

/** Move `delta` field-people between the core tile and its OWN countryside
 *  (owner==sid, within the hinterland box), conservatively. +pull in, −push out. */
function urbanConcentrate(world, owner, sid, cx, cy, coreTi, delta) {
  const pf = world.popField, tw = world.tw, th = world.th;
  const x0 = cx - URBAN_CONC_R, x1 = cx + URBAN_CONC_R;
  const y0 = Math.max(0, cy - URBAN_CONC_R), y1 = Math.min(th - 1, cy + URBAN_CONC_R);
  if (delta > 0) {
    // AGGLOMERATION: pull the hinterland in. Sum owned countryside people, then
    // drain the same fraction from each (proportional) up to the flux cap.
    let avail = 0;
    for (let y = y0; y <= y1; y++) for (let xx = x0; xx <= x1; xx++) {
      const x = ((xx % tw) + tw) % tw, ti = y * tw + x;
      if (ti === coreTi || owner[ti] !== sid) continue;
      if (pf[ti] > 0) avail += pf[ti];
    }
    if (avail <= 0) return;
    const take = Math.min(delta, avail * URBAN_CONC_MAXFRAC);
    const frac = take / avail;
    let moved = 0;
    for (let y = y0; y <= y1; y++) for (let xx = x0; xx <= x1; xx++) {
      const x = ((xx % tw) + tw) % tw, ti = y * tw + x;
      if (ti === coreTi || owner[ti] !== sid || pf[ti] <= 0) continue;
      const m = pf[ti] * frac; pf[ti] -= m; moved += m;
    }
    pf[coreTi] += moved;
  } else if (delta < 0) {
    // CONGESTION: push the crowd back out, spread over owned countryside
    // proportional to each tile's SPARE capacity (people go where there is room).
    const push = Math.min(-delta, pf[coreTi] * URBAN_CONC_MAXFRAC);
    if (push <= 0) return;
    const cap = world.capField;
    let room = 0;
    for (let y = y0; y <= y1; y++) for (let xx = x0; xx <= x1; xx++) {
      const x = ((xx % tw) + tw) % tw, ti = y * tw + x;
      if (ti === coreTi || owner[ti] !== sid) continue;
      const s = cap[ti] - pf[ti]; if (s > 0) room += s;
    }
    if (room <= 0) return;
    let moved = 0;
    for (let y = y0; y <= y1; y++) for (let xx = x0; xx <= x1; xx++) {
      const x = ((xx % tw) + tw) % tw, ti = y * tw + x;
      if (ti === coreTi || owner[ti] !== sid) continue;
      const s = cap[ti] - pf[ti]; if (s <= 0) continue;
      const m = push * (s / room); pf[ti] += m; moved += m;
    }
    pf[coreTi] -= moved;
  }
}

/**
 * The ONE_POP derive, called once per tick after the field pass (index.js):
 * accumulate each settlement's catchment field people + terrain capacity,
 * refresh the bridge scalar (once), set s.people from the field, and stamp
 * next pass's urban spikes (economy-beyond-land capacity + the city core's
 * transition-bent growth rate).
 */
export function deriveOnePop(world) {
  if (!T.ONE_POP || !T.POP_FIELD || !world.popField) return;
  const pf = world.popField, cap = world.capField, owner = world._territoryOwner, tw = world.tw;
  if (!owner) return;
  const spikes = world._urbanSpike || (world._urbanSpike = new Map());
  const accP = new Map();
  for (let i = 0; i < world.N; i++) {
    const sid = owner[i];
    if (sid < 0) continue;
    if (pf[i] > 0) accP.set(sid, (accP.get(sid) || 0) + pf[i]);
  }
  // The bridge scalar: median census per median field-region, frozen at
  // activation (persisted). A pure unit conversion between the economy's
  // calibrated census magnitudes and the field's people — the distribution
  // and all dynamics are the field's.
  if (!(world._onePopScale > 0)) {
    const cs = [], fs = [];
    for (const s of world.settlements) {
      if (s.mode !== "settled") continue;
      const f = accP.get(s.id) || 0;
      if (f > 0 && s.people > 0) { cs.push(s.people); fs.push(f); }
    }
    cs.sort((a, b) => a - b); fs.sort((a, b) => a - b);
    world._onePopScale = cs.length ? Math.max(1e-6, cs[cs.length >> 1] / Math.max(1e-6, fs[fs.length >> 1])) : 1;
  }
  const scale = world._onePopScale;
  const agglom = T.URBAN_AGGLOM > 0;
  // AGGLOMERATION↔CONGESTION distribution (T.URBAN_AGGLOM). The TOTAL urban
  // population is set by the ECONOMY — Σ import-fed capacity, i.e. how many
  // non-farmers the food surplus can support — so urbanization is an OUTPUT,
  // not a knob. That total is DISTRIBUTED across cities by a β-COMPRESSED share
  // of each one's import capacity: share_i = pull_i^β / Σ pull^β. β<1
  // (congestion: crowding cost rising super-linearly with density) compresses
  // the heavy-tailed (−1.5) import economy toward the −0.8..−1.2 city envelope
  // WITHOUT changing the total (Σ share = 1 for any β) — so the slope (β) and
  // the urbanization level (economy) cannot fight. Pre-pass sums the pulls.
  let sumK = 0, sumKb = 0;
  if (agglom) {
    for (const s of world.settlements) {
      if (s.mode !== "settled") continue;
      const isr = Math.max(0, Math.min(1,
        ((s._foodNet !== undefined ? s._foodNet : 0) - (s._landFood || 0)) / Math.max(1e-9, s._foodSupply || 0)));
      const kb = ((s._k || 0) * isr) / scale;
      if (kb > 0) { sumK += kb; sumKb += Math.pow(kb, T.URBAN_BETA); }
    }
  }
  spikes.clear();
  for (const s of world.settlements) {
    if (s.mode !== "settled") continue;
    const ti = (s.pos.y | 0) * tw + (s.pos.x | 0);
    if (ti < 0 || ti >= world.N) continue;
    const f = accP.get(s.id) || 0;
    // The IMPORT-FED share of the settlement's carrying capacity, in field
    // units — what its market feeds from BEYOND its own land (hierarchy grain:
    // _foodNet − _landFood, one food model). A self-fed farm town concentrates
    // nothing; a grain-importing hub concentrates what it ships in — the
    // heavy-tailed (−1.5) import economy gives the cores their size ORDER.
    const importShare = Math.max(0, Math.min(1,
      ((s._foodNet !== undefined ? s._foodNet : 0) - (s._landFood || 0)) / Math.max(1e-9, s._foodSupply || 0)));
    const kBeyond = ((s._k || 0) * importShare) / scale;
    // AGGLOMERATION↔CONGESTION (T.URBAN_AGGLOM): relax the core tile toward an
    // agglomeration target that is SUBLINEAR in the economic pull (β<1, the
    // congestion compression), conservatively concentrating the region's own
    // countryside into (or back out of) its city. Runs BEFORE the core read so
    // s._urbanPop sees the concentrated field. Non-importers (kBeyond=0) have
    // no target — they stay rural, as the ontology says.
    let uTarget = 0;
    if (agglom && kBeyond > 0 && sumKb > 0) {
      // This city's β-compressed share of the economy's total urban capacity.
      const share = Math.pow(kBeyond, T.URBAN_BETA) / sumKb;
      uTarget = T.URBAN_AGGLOM * sumK * share;   // AGGLOM = the fraction of import-fed capacity that concentrates in the core
      // A city lives WITHIN its hinterland: cap the target at a share of the
      // region's own people. Since the countryside is terrain-capped, this
      // bounds any feedback and is the real constraint that the largest cities
      // can't outgrow the land that feeds them.
      if (f > 0) uTarget = Math.min(uTarget, URBAN_MAXSHARE * f);
      if (f > 0) {
        const cx = s.pos.x | 0, cy = s.pos.y | 0;
        const delta = URBAN_CONC_LAMBDA * (uTarget - pf[ti]);
        if (delta > 1e-6 || delta < -1e-6) urbanConcentrate(world, owner, s.id, cx, cy, ti, delta);
      }
    }
    if (f > 0) s.people = Math.max(1, f * scale);
    // The URBAN CORE is the concentration itself: the people on the city's
    // own tile, in census units — the ruling made literal. This is what the
    // urbanization share, the demographic transition, the graveyard and the
    // Zipf statistics read; the region's rural remainder is everyone else on
    // its land. (Overrides the census-side ruralShare heuristic each tick.)
    if (f > 0) {
      s._urbanPop = Math.min(s.people, Math.max(0, pf[ti] * scale));
      s._ruralPop = Math.max(0, s.people - s._urbanPop);
    }
    // else: no catchment tiles this pass (fresh founding / recompute lag) — keep the census value
    // The spike (next pass's capacity + the core's transition/graveyard-bent
    // growth rate stamped by updatePop). Under URBAN_AGGLOM the capacity spike
    // is the agglomeration TARGET itself — just enough to HOLD what the
    // concentration flow delivers (so the field pass's logistic and migration
    // see pop≈cap and neither crash nor expel the crowd); the flow, not the
    // throughput-limited diffusion, is what actually fills it. Otherwise it is
    // the raw import ceiling (the pre-agglomeration behaviour).
    const kCap = agglom ? uTarget : kBeyond;
    if (kCap > 0 || s._rEff !== undefined) spikes.set(ti, { k: kCap, r: s._rEff, sink: s._rSink || 0 });
  }
}

// ── T.FIELD_DEMOG: demographic events live on the field (one population) ────
// docs/one-population.md slice A. Every event that adds or removes PEOPLE in
// the town census — plague, famine, the sack's captive trains, razzias,
// revolt ravages, forced arrivals — is mirrored onto the people-on-land field
// around the settlement it struck, so the land is the honest record of
// demographic history (a devastating war EMPTIES countryside on the
// Population lens) and the field consumers (national power, hold capacity,
// nomads, the grievance reference) feel it. Losses drain the settlement's
// home tile first, then cascade outward ring by ring — the countryside its
// people lived in — clamped at zero and bounded (if the field carries fewer
// people than the census lost, the remainder is dropped: the two numbers are
// not yet reconciled to the person; slice B derives the census FROM the
// field). Gains land on the home tile — arrivals concentrate where the
// market that bought them is. Deterministic ring walk, no RNG; the field's
// own logistic growth recovers a dent over generations, exactly as the
// census does. No-op when the lever (or the field itself) is off.
const FIELD_SHIFT_R = 6;   // max cascade radius (tiles): a town's demographic hinterland

export function fieldShift(world, s, delta) {
  if ((!T.FIELD_DEMOG && !T.ONE_POP) || !T.POP_FIELD || !world.popField || !s || !s.pos) return;
  if (!(delta < 0 || delta > 0)) return;
  const pf = world.popField, tw = world.tw, th = world.th;
  const cx = s.pos.x | 0, cy = s.pos.y | 0;
  const ti0 = cy * tw + cx;
  if (ti0 < 0 || ti0 >= world.N) return;
  if (delta > 0) { pf[ti0] += delta; return; }
  let need = -delta;
  for (let r = 0; r <= FIELD_SHIFT_R && need > 0; r++) {
    // ring r around (cx,cy): fixed order (top row, bottom row, left col, right col)
    for (let k = -r; k <= r && need > 0; k++) {
      for (let e = 0; e < (r === 0 ? 1 : 4) && need > 0; e++) {
        let x, y;
        if (r === 0) { x = cx; y = cy; }
        else if (e === 0) { x = cx + k; y = cy - r; }
        else if (e === 1) { x = cx + k; y = cy + r; }
        else if (e === 2) { x = cx - r; y = cy + k; if (k === -r || k === r) continue; }   // corners already visited
        else { x = cx + r; y = cy + k; if (k === -r || k === r) continue; }
        if (y < 0 || y >= th) continue;
        const ti = ((x % tw) + tw) % tw + y * tw;
        const have = pf[ti];
        if (!(have > 0)) continue;
        const take = have < need ? have : need;
        pf[ti] = have - take;
        need -= take;
      }
    }
  }
}

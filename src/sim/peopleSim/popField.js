// ── Phase 1 of the field-simulation rewrite (T.POP_FIELD) ──────────────────────
//
// Population lives on the LAND, not on settlement entities. Two per-tile fields:
//   world.capField[ti] — carrying capacity (people the tile can feed) = fertility ×
//     a global agricultural-DEVELOPMENT multiplier (emergent, never a clock).
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

  // 2. Logistic growth toward capacity (in place).
  for (let li = 0; li < nLand; li++) {
    const i = land[li];
    const k = cap[i];
    if (k <= 0) { pop[i] = 0; continue; }
    const p = pop[i];
    if (p > 0) pop[i] = p + POP_GROWTH * dt * p * (1 - p / k);
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

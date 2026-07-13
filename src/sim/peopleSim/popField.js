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

import { T, rNormPop } from "./tuning.js";

const DIRS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// Carrying capacity: people per unit (fertility × development) on one tile at
// saturation. A calibration constant — its absolute value sets total world
// population; the DISTRIBUTION (the point of phase 1) is set by fertility alone.
// PER REAL AREA, not per tile (res-invariance 2026-07): calibrated on the
// 240-tile reference, so each tile carries cap (and seed) ÷rNormPop² — a finer
// grid divides the same real land among more tiles instead of multiplying the
// world's people by the tile count (measured 3.15× total people at tw=480
// before this; the median-anchors absorbed the LEVEL for their consumers, but
// the field's own dynamics and any raw read did not). ×1 exactly at the
// reference. The GROWTH/MIGRATE rates below are per-capita/share and stay
// unscaled (NB: POP_MIGRATE's implied diffusion coefficient D ∝ rate·Δx² is
// still res-variant — second-order here, since every habitable tile is seeded
// and fills by LOCAL logistic growth; a true fix needs sub-stepped migration).
const CAP_PER_FERT = 1200;
// Development multiplier: local carrying capacity rises with AGRICULTURAL tech —
// a hunter-gatherer land feeds a thin scatter, an irrigated-plough society feeds a
// dense one. Emergent (read from the world's leading agriculture in phase 1);
// becomes a field in a later phase. base at neolithic → ~×3.3 at full farming tech.
const DEV_BASE = 0.30, DEV_TECH = 3.0;
const POP_GROWTH = 0.03;    // logistic intrinsic growth per step (r in pop += r·pop·(1−pop/K))
const POP_MIGRATE = 0.06;   // share of a tile's people that migrate toward spare capacity per step
const SEED_POP = 0.4;       // people seeded per habitable tile (the spark logistic growth needs)

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
  const rn = rNormPop(world);
  const seedPop = SEED_POP / (rn * rn);   // per REAL area (÷1 exactly at the reference)
  for (let i = 0; i < N; i++) {
    if (!(elev[i] > 0) || !(fert[i] > 0.03)) continue;
    // Residence: 1 in the long-settled cradle of humanity (tArrival→0), →0 on the
    // late-reached frontier (tArrival→1). Long-peopled land starts with a real seed
    // population; the frontier starts near-empty and fills by migration.
    const residence = tArrival ? (1 - Math.min(1, Math.max(0, tArrival[i]))) : 0.5;
    pop[i] = seedPop * (0.15 + 0.85 * residence);
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
  // leading agriculture; a later phase makes tech a field of its own).
  let leadAgri = 0;
  for (const s of world.settlements) if (s.mode === "settled") { const a = (s.knowledge && s.knowledge.agriculture) || 0; if (a > leadAgri) leadAgri = a; }
  const dev = DEV_BASE + DEV_TECH * leadAgri;
  // Time-granularity dt × stride: a firing advances `sub` ticks of history at
  // 1/G each (so it honours SIM_GRANULARITY), capped for integrator stability.
  // At the default stride 4 / G 1 → dt 4, the field advances 4 ticks per firing.
  const dt = Math.min(8, (world._dt || 1) * sub);

  // 1. Carrying capacity per tile = farmable yield (fert × development) lifted by
  //    the water-transport PREMIUM (river/coast can import food → denser settlement)
  //    and cut by rugged RELIEF. The premium is multiplicative on fert, so it
  //    concentrates people onto FERTILE valleys and shores (a barren river bank
  //    stays empty — you can't irrigate rock) rather than blooming deserts.
  const accessDev = ACCESS_DEV0 + ACCESS_DEVK * leadAgri;   // transport premium grows with tech (emergent)
  // Iterate LAND tiles only. ~45% of the grid is ocean, where cap/pop are always 0
  // (water cap stays at its init 0, never written; nothing migrates into it) — so
  // skipping it is byte-identical, it just drops the field pass's dead iterations
  // (the whole field-model overhead scales with this loop count). The land index is
  // static (terrain), built once.
  const land = world._popLand && world._popLand.length ? world._popLand : (world._popLand = buildLandList(world));
  const nLand = land.length;
  const _rnF = rNormPop(world);
  const capPerFert = CAP_PER_FERT / (_rnF * _rnF);   // per REAL area (÷1 exactly at the reference)
  for (let li = 0; li < nLand; li++) {
    const i = land[li];
    const water = riverMag ? Math.min(1, riverMag[i] / RM_FULL) : 0;
    const access = ACCESS_RIVER * water + ACCESS_COAST * (coast ? coast[i] : 0);
    const reach = 1 + access * accessDev;
    const reliefMul = relief ? 1 / (1 + RELIEF_PEN * relief[i]) : 1;
    cap[i] = fert[i] * capPerFert * dev * reach * reliefMul;
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

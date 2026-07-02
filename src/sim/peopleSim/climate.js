// ── Dynamic climate over deep time ──────────────────────────────────────
// The physical world is otherwise frozen after worldgen; this layers a slow,
// GLOBAL climate state on top of it. A bounded random walk (_climIndex) stands
// for the warm/cold, wet/dry centuries of the Holocene; rare sharp dips
// (_climShock) are volcanic winters — the 536 AD "year without a summer",
// Tambora 1815. Per tile it scales FERTILITY (world.climMod, read by the food
// catchment in territory.js), biting HARDEST AT HIGH LATITUDES where the farming
// frontier is marginal, so a harsh epoch fails harvests across a whole band at
// once. That correlation is the whole point: realms rise and fall TOGETHER in the
// bad centuries (the Bronze-Age collapse, the Little Ice Age) instead of each
// dicing its own private famine.
//
// Determinism: the walk draws from passRng(world, "climate") (keyed on step), and
// only _climIndex / _climShock are cross-tick state (persisted). climMod is
// recomputed from them every pass, so it never needs serialising.

import { passRng } from "./rng.js";
import { T } from "./tuning.js";

// Cadence: advance ~every 10 years (0.5 yr/tick × 20). Exported like SOIL_INTERVAL
// so index.js drives it without another tuning lever.
export const CLIMATE_INTERVAL = 20;

const WALK        = 0.03;   // per-update random-walk step of the global index
const REVERT      = 0.05;   // mean-reversion toward 0 (keeps the walk bounded, ±0.15-ish)
const VOLC_CHANCE = 0.010;  // per update: a volcanic winter erupts (~1 per 1000 yrs)
const VOLC_MAG    = 0.14;   // its sudden global cooling
const VOLC_DECAY  = 0.55;   // how fast the ash clears each update
const FLOOR = 0.70, CEIL = 1.15;   // clamp on the per-tile fertility multiplier

export function updateClimate(world) {
  if (!T.CLIMATE_VAR) return;
  const N = world.N, tw = world.tw, th = world.th;
  let cm = world.climMod;
  if (!cm || cm.length !== N) { cm = world.climMod = new Float32Array(N); cm.fill(1); }
  const rng = passRng(world, "climate");
  // 1) advance the slow global index — a mean-reverting random walk.
  let idx = world._climIndex || 0;
  idx += (rng() - 0.5) * 2 * WALK - idx * REVERT;
  world._climIndex = idx;
  // 2) volcanic winters — a rare sharp cooling that then clears over a few updates.
  let shock = (world._climShock || 0) * VOLC_DECAY;
  if (rng() < VOLC_CHANCE) shock += VOLC_MAG;
  world._climShock = shock;
  // 3) recompute the per-tile multiplier from the advanced state.
  recomputeClimMod(world);
}

// Rebuild world.climMod from the persisted state (_climIndex/_climShock)
// WITHOUT advancing the walk — no rng draw. Called from updateClimate after
// each advance, and from loadWorld so the territory warm-up tallies with the
// saved climate instead of a neutral field. eff < 0 = a harsh (cold/dry)
// epoch; the latitude weight rises toward the poles, so high latitudes swing
// most while the equatorial cradles barely move.
export function recomputeClimMod(world) {
  const N = world.N, tw = world.tw, th = world.th;
  let cm = world.climMod;
  if (!cm || cm.length !== N) { cm = world.climMod = new Float32Array(N); cm.fill(1); }
  const eff = ((world._climIndex || 0) - (world._climShock || 0)) * (T.CLIMATE_AMP || 1);
  const denom = th > 1 ? th - 1 : 1;
  for (let ti = 0; ti < N; ti++) {
    const ty = (ti / tw) | 0;
    const latW = 0.10 + 0.30 * Math.abs(ty / denom - 0.5) * 2;   // 0.1 at the equator → 0.4 at the poles
    const v = 1 + eff * latW;
    cm[ti] = v < FLOOR ? FLOOR : v > CEIL ? CEIL : v;
  }
}

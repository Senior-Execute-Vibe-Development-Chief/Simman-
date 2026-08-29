// Invent foresight (T.INVENT_JUMP): solve first domestication at genesis.
// Mint-ready open (gather + hold mint) lives in dawnJump.js.
//
// Under DAWN_LIVE the same hearth law that used to accrue live
// (needY = domLagY/suit, peopled-basin fill) is solved at genesis: forager
// demography advances by the field's own logistic, every armed hearth
// accrues peopled-basin years, and the first to cross ignites — basin
// farming stamped, later hearths kept armed with their accrued effY.
// Same mechanism as maybeCrystallize's invent pass; no calendar gate.

import { T, rNormPop } from "./tuning.js";
import { stepPopField, initPopField, devWaveIvl } from "./popField.js";
import { R_DEV0 } from "./popFieldKernel.js";
import { logEvent } from "./events.js";
import { makeSettlement } from "./settlement.js";

// Mirror crystallize.js / popField.js — one definition of the invent disk and
// the farming floor; digits are the codebase's own bars, not free knobs.
const TOWN_BASIN_R = 10;
export const NEOLITHIC_AGRI = 0.45;
// Must match popField.js POP_GROWTH (logistic intrinsic per step at dt=1).
const POP_GROWTH = 0.03;
// Chunk length in technique-wave years between fill remeasures. Small enough
// that fill drift inside a chunk is noise; large enough that genesis stays
// cheap at the app grid.
const CHUNK_YEARS = 25;

const _geoStr = (world, x, y) =>
  `(${(x / world.tw * 360 - 180).toFixed(1)}E ${(90 - y / world.th * 180).toFixed(1)}N)`;

function diskMass(field, tw, th, tx, ty, rB) {
  let m = 0;
  for (let dy = -rB; dy <= rB; dy++) {
    const yy = ty + dy; if (yy < 0 || yy >= th) continue;
    for (let dx = -rB; dx <= rB; dx++) {
      if (dx * dx + dy * dy > rB * rB) continue;
      m += field[yy * tw + (((tx + dx) % tw) + tw) % tw];
    }
  }
  return m;
}

/** Ignite one matured hearth — shared by the live crystallize pass and the genesis jump. */
export function igniteHearth(world, h, rB) {
  const tw = world.tw, th = world.th;
  if (T.CITY_AT_BIRTH) {
    const seeds = (world._hearthSeeds || (world._hearthSeeds = []));
    if (T.BASIN_IGNITE && world.popField) {
      const pfI = world.popField;
      for (let dy = -rB; dy <= rB; dy++) {
        const yy = h.ty + dy; if (yy < 0 || yy >= th) continue;
        for (let dx = -rB; dx <= rB; dx++) {
          if (dx * dx + dy * dy > rB * rB) continue;
          const t2 = yy * tw + (((h.tx + dx) % tw) + tw) % tw;
          if (pfI[t2] > 0) seeds.push({ ti: t2, agri: NEOLITHIC_AGRI });
        }
      }
    } else seeds.push({ ti: h.ti, agri: NEOLITHIC_AGRI });
    logEvent(world, "farming.invented", { x: h.tx, y: h.ty, jump: world._inventJump ? 1 : 0 });
    console.log(`[peopleSim] AGRICULTURE INVENTED at (${h.tx},${h.ty}) ${_geoStr(world, h.tx, h.ty)} — the basin farms; a city will rise when its market gathers one (score ${h.score.toFixed(2)}${world._inventJump ? "; invent-jump" : ""})`);
  } else {
    const born = makeSettlement(world, h.tx + 0.5, h.ty + 0.5, { people: 110, cradle: true });
    logEvent(world, "settlement.founded", { s: born.id, sName: born.name, polity: -1, hearth: 1 });
    console.log(`[peopleSim] AGRICULTURE INVENTED at (${h.tx},${h.ty}) ${_geoStr(world, h.tx, h.ty)} — ${born.name}, ${Math.round(h.needY)}y of peopled-basin time served (score ${h.score.toFixed(2)})`);
  }
}

/** Closed-form forager logistic over `steps` (dt=1), matching GROWTH_LOCAL's forager regime. */
function advanceForagerLogistic(world, steps) {
  if (!(steps > 0)) return;
  const pop = world.popField, cap = world.capField;
  if (!pop || !cap) return;
  const land = world._popLand && world._popLand.length
    ? world._popLand
    : (world._popLand = (() => {
        const L = [];
        for (let i = 0; i < world.N; i++) if (world.elev[i] > 0) L.push(i);
        return L;
      })());
  // Forager land: DEV_FIELD is flat 0 before invent → reg = R_DEV0. Tropic
  // burden omitted (slightly optimistic tropics; invent order is package-led).
  const gl = T.GROWTH_LOCAL || 0;
  const rT = POP_GROWTH * (gl > 0 ? (1 + gl * (R_DEV0 - 1)) : 1);
  const expF = Math.exp(-rT * steps);
  for (let li = 0; li < land.length; li++) {
    const i = land[li];
    const k = cap[i];
    if (!(k > 0)) { pop[i] = 0; continue; }
    const p0 = pop[i];
    if (!(p0 > 0)) continue;
    // p(t) = K / (1 + (K/p0 − 1) e^{−r t})
    pop[i] = k / (1 + (k / p0 - 1) * expF);
  }
}

/**
 * Solve the armed-hearth invent clock at genesis and open there.
 * No-op unless DAWN_LIVE × INVENT_STAGGER × INVENT_JUMP with armed hearths.
 */
export function jumpToFirstInvent(world) {
  if (!(T.INVENT_JUMP > 0) || !T.DAWN_LIVE || !T.INVENT_STAGGER) return false;
  const armed = world._armedHearths;
  if (!armed || !armed.length) return false;
  if (!world.popField || world.popField.length !== world.N) initPopField(world);

  world._dt = 1 / Math.max(1, T.SIM_GRANULARITY || 1);
  // One field pass: builds forager capacity (no hearth seeds yet) and lands.
  stepPopField(world, 1);

  const ivl = devWaveIvl(world);
  const yearsPerStep = (40075 / world.tw) / ivl;
  if (!(yearsPerStep > 0)) return false;
  const rB = Math.max(1, Math.round(TOWN_BASIN_R * rNormPop(world)));
  const maxNeed = Math.max(...armed.map((h) => h.needY || 0));
  // Safety: 3× the slowest needY in steps (fill < 1 stretches the clock).
  const maxSteps = Math.ceil((maxNeed * 3) / yearsPerStep) + 8;
  const chunkSteps = Math.max(1, Math.round(CHUNK_YEARS / yearsPerStep));

  world._inventJump = true;
  world._hearthArmAt = world.step;
  let invented = false;
  const t0 = performance.now();

  while (!invented && world.step < maxSteps) {
    const list = world._armedHearths;
    if (!list || !list.length) break;
    const steps = Math.min(chunkSteps, maxSteps - world.step);
    advanceForagerLogistic(world, steps);
    world.step += steps;

    const dtYears = steps * yearsPerStep;
    const keep = [];
    for (const h of list) {
      const basin = diskMass(world.popField, world.tw, world.th, h.tx, h.ty, rB);
      const capMass = diskMass(world.capField, world.tw, world.th, h.tx, h.ty, rB);
      h.effY += dtYears * Math.min(1, capMass > 0 ? basin / capMass : 0);
      if (h.effY >= h.needY) {
        igniteHearth(world, h, rB);
        invented = true;
      } else keep.push(h);
    }
    // Drop ignited; keep the rest (same as the live pass).
    if (keep.length) world._armedHearths = keep;
    else delete world._armedHearths;
  }

  world._hearthArmAt = world.step;
  // Refresh capacity with farming sources stamped into the technique field.
  if (invented) stepPopField(world, 1);

  const ms = (performance.now() - t0).toFixed(0);
  if (invented) {
    const nSeed = world._hearthSeeds ? world._hearthSeeds.length : 0;
    console.log(`[peopleSim] invent-jump: farming at step ${world.step} (${nSeed} basin seeds) in ${ms}ms`);
  } else {
    console.warn(`[peopleSim] invent-jump: no hearth matured by step ${world.step} (${ms}ms) — live invent continues`);
  }
  return invented;
}

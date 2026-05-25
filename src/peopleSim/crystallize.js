// Settlement crystallization sweep.
//
// New settlements appear at fertile, watered sites. Probability of any
// given site spontaneously becoming a settlement depends on:
//   1. Site quality (fertility + water access bonus)
//   2. Transport distance to the nearest existing settlement
//      (computed by transport.js — terrain-weighted Dijkstra).
//
// Sites close in transport (knowledge diffuses from neighbours via
// trade and migration along easy corridors) crystallize fast. Sites
// very far away can still crystallize through INDEPENDENT INVENTION
// at a low baseline rate — matches the historical pattern of separate
// agricultural revolutions in the Levant, Yangtze, Indus, Mesoamerica.
//
// Knowledge inherited from the nearest settlement gets diluted with
// transport distance: a settlement spawning right next to a city
// inherits most of its tech; one that crystallises in isolation starts
// near the cradle baseline.

import { isContinentalLand } from "./state.js";
import { makeSettlement } from "./settlement.js";
import { computeTransport } from "./transport.js";

const CRYSTAL_INTERVAL          = 32;     // ticks between sweeps
const TRANSPORT_REFRESH_TICKS   = 200;
const CANDIDATES_PER_SWEEP      = 80;     // up from 60 — more chances per sweep
const MIN_FERT                  = 0.32;
const MIN_AREA_FERT             = 6.0;    // sum of fert in 5×5 box must exceed this
                                          // (rejects isolated fertile tiles surrounded by waste)
const LUSH_FERT                 = 0.55;
const MIN_SETT_DIST             = 18;     // up from 12 — clearer visual spacing
const MIN_SETT_DIST_SQ          = MIN_SETT_DIST * MIN_SETT_DIST;
const KNOWLEDGE_DECAY_SCALE     = 30;
const INDEPENDENT_RATE          = 0.030;  // up from 0.025 — more independent invention
const NEAR_RATE                 = 1.50;
const BASE_RATE                 = 0.0050; // up from 0.0025 — settlements appear earlier

export function maybeCrystallize(world) {
  if (world.step % CRYSTAL_INTERVAL !== 0) return;
  // Cap check.
  let alive = 0;
  for (const s of world.settlements) if (s.mode !== "dead") alive++;
  if (alive >= world.cap.settlements) return;

  // Refresh transport map if stale or absent.
  if (!world.transportDist || world.step - (world._transportStep || -Infinity) > TRANSPORT_REFRESH_TICKS) {
    world.transportDist = computeTransport(world);
    world._transportStep = world.step;
  }

  // Sample random tiles. For each viable one, compute crystallization
  // probability and roll. Multiple sites can spawn in one sweep (cap-
  // limited).
  const { N, tw, th, elev, fert, coast, riverMag, transportDist, rng } = world;
  for (let i = 0; i < CANDIDATES_PER_SWEEP; i++) {
    if (alive >= world.cap.settlements) break;
    const ti = rng.int(N);
    if (!isContinentalLand(world, ti)) continue;
    const f = fert[ti];
    if (f < MIN_FERT) continue;
    const hasRiver = riverMag && riverMag[ti] >= 2;
    const hasCoast = !!coast[ti];
    if (!hasRiver && !hasCoast && f < LUSH_FERT) continue;
    const ty = (ti / tw) | 0, tx = ti - ty * tw;
    // Area-fertility check: the SURROUNDING land must support a real
    // settlement, not just the one point tile. Sums fert in a 5×5 box;
    // rejects "tiny fertile islet surrounded by waste" sites that
    // would crystallise into stillborn settlements.
    let areaFert = 0;
    for (let dy = -2; dy <= 2; dy++) {
      const ny = ty + dy;
      if (ny < 0 || ny >= th) continue;
      for (let dx = -2; dx <= 2; dx++) {
        const nx = ((tx + dx) % tw + tw) % tw;
        const ni = ny * tw + nx;
        if (elev[ni] > 0) areaFert += fert[ni];
      }
    }
    if (areaFert < MIN_AREA_FERT) continue;
    // Min distance to all existing settlements.
    let tooClose = false;
    for (const o of world.settlements) {
      if (o.mode === "dead") continue;
      let ddx = Math.abs(o.pos.x - tx);
      if (ddx > tw / 2) ddx = tw - ddx;
      const ddy = o.pos.y - ty;
      if (ddx * ddx + ddy * ddy < MIN_SETT_DIST_SQ) { tooClose = true; break; }
    }
    if (tooClose) continue;

    // Site-quality score 0..3-ish.
    let quality = f * 2;
    if (hasRiver) quality += 1.0;
    if (hasCoast) quality += 0.4;

    // Transport-distance modifier. tdist=Infinity → independent only.
    const td = transportDist[ti];
    const diffusionMul = isFinite(td) ? Math.exp(-td / KNOWLEDGE_DECAY_SCALE) * NEAR_RATE : 0;
    const p = quality * (diffusionMul + INDEPENDENT_RATE) * BASE_RATE;

    if (rng() < p) {
      // Inherited knowledge: blend from nearest settlement, weighted by
      // distance. Far sites start near baseline neolithic knowledge.
      const inherited = inheritKnowledgeAt(world, ti, td);
      makeSettlement(world, tx + 0.5, ty + 0.5, {
        people: 18 + (rng.int(8)),
        knowledge: inherited,
      });
      alive++;
    }
  }
}

// Pick the nearest settlement (by straight-line distance, cheap), then
// blend its knowledge with a baseline based on how isolated this site
// is in transport terms. Settlements that crystallise right next to a
// city inherit most of its tech; isolated cradles start near baseline.
function inheritKnowledgeAt(world, ti, td) {
  const { tw } = world;
  const ty = (ti / tw) | 0, tx = ti - ty * tw;
  let nearest = null, bestD2 = Infinity;
  for (const s of world.settlements) {
    if (s.mode !== "settled") continue;
    let dx = Math.abs(s.pos.x - tx);
    if (dx > tw / 2) dx = tw - dx;
    const dy = s.pos.y - ty;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2) { bestD2 = d2; nearest = s; }
  }
  // Baseline neolithic knowledge for independent invention.
  const baseline = {
    foraging:    0.5,
    toolmaking:  0.2,
    agriculture: 0.45,
    construction: 0.1,
    organization: 0.1,
  };
  if (!nearest) return baseline;
  // Inheritance fraction by transport distance: 90 % at td=0, 30 % at
  // td=60, ~5 % far away. Distant sites mostly invent on their own.
  const inheritFrac = isFinite(td) ? Math.max(0.05, Math.exp(-td / 50)) : 0.05;
  const out = {};
  for (const k of Object.keys(baseline)) {
    const parentVal = nearest.knowledge[k] || baseline[k];
    out[k] = baseline[k] * (1 - inheritFrac) + parentVal * inheritFrac;
  }
  return out;
}

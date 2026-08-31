// ── Lineage genetics — Rail B look traits carried with ancestry ─────────────
//
// Climate look (skin, limbs, …) lives in peopleStyle.lookFromHomeland.
// These traits are mostly heritable lineage capacity — stamped at each
// ancestry anchor, inherited on fission with drift, mixed through ancMix.
// Not per-person random; not culture names; not calendar gates.
//
// arrN is peopling depth (0 cradle → 1 last frontier), not the display year.

import { hash32 } from "./peopleSim/rng.js";

function clamp01(x) {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Follicle density / androgen response at an ancestry anchor (0–1). */
export function facialHairAtAnchor(seed, ancId, parentId, parentHair, ti, tTemp, tMoist, arrN) {
  const temp = tTemp[ti];
  const moist = tMoist[ti];
  const u = hash32(seed >>> 0, ancId | 0, (parentId + 1) | 0, 0xFACE) / 4294967296;
  if (parentId < 0) {
    const cold = clamp01((0.82 - temp) / 0.34);
    const arid = temp > 0.74 && moist < 0.30;
    const humid = temp > 0.80 && moist > 0.50;
    const climate = clamp01(0.68 + 0.22 * cold + 0.14 * (arid ? 1 : 0) - 0.08 * (humid ? 1 : 0));
    const frontier = arrN[ti] < Infinity ? arrN[ti] : 1;
    const founder = clamp01(1 - 0.32 * frontier * frontier);
    return clamp01(0.05 + 0.90 * u * climate * founder);
  }
  const humid = temp > 0.80 && moist > 0.50;
  const drift = (u - 0.5) * 0.16;
  return clamp01(parentHair * 0.90 + drift - 0.03 * (humid ? 1 : 0));
}

/** Stamp Rail-B genetics onto ancHomelands (parents before children). */
export function stampLineageGenetics(ancHomelands, K, ancParent, src, seed, tTemp, tMoist, arrN) {
  for (let a = 0; a < K; a++) {
    const ti = src[a];
    const par = ancParent[a];
    const parentHair = par >= 0 ? ancHomelands[par].facialHair : 0;
    ancHomelands[a].facialHair = facialHairAtAnchor(
      seed, a, par, parentHair, ti, tTemp, tMoist, arrN);
  }
}

/** Below this, a lineage rarely grows a visible beard (capacity, not style). */
export const BEARD_VISIBLE = 0.15;

export function canGrowBeard(look, threshold = BEARD_VISIBLE) {
  return !!(look && (look.facialHair ?? 0) >= threshold);
}

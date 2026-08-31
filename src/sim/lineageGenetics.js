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

/** Ordered Rail B genes — stamp order is the inheritance backbone. */
export const RAIL_B_GENES = [
  "facialHair", "hairHue", "hairDensity",
  "epicanthic", "eyeAperture",
  "noseBridge", "noseLength",
  "jawWidth", "chinProminence", "cheekFullness", "lipFullness",
  "browRidge", "earSize", "headBreadth",
];

const RAIL_B_TAG = Object.fromEntries(RAIL_B_GENES.map((g, i) => [g, 0xFACE0000 ^ (i * 0x9e3779b9)]));

function unit(seed, ancId, parentId, tag) {
  return hash32(seed >>> 0, ancId | 0, (parentId + 1) | 0, tag) / 4294967296;
}

function inheritGene(parentVal, u) {
  return clamp01(parentVal * 0.90 + (u - 0.5) * 0.14);
}

/** Follicle density / androgen response at an ancestry anchor (0–1). */
export function facialHairAtAnchor(seed, ancId, parentId, parentHair, ti, tTemp, tMoist, arrN) {
  const temp = tTemp[ti];
  const moist = tMoist[ti];
  const u = unit(seed, ancId, parentId, RAIL_B_TAG.facialHair);
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
  return clamp01(inheritGene(parentHair, u) - 0.03 * (humid ? 1 : 0));
}

function founderBias(gene, temp, moist, arrN, ti, u) {
  const cold = clamp01((0.82 - temp) / 0.34);
  const frontier = arrN[ti] < Infinity ? arrN[ti] : 1;
  switch (gene) {
    case "hairHue":
      // Lighter hair capacity nudges in cold/arid founder climates — heritable, not per-tile.
      return clamp01(0.08 + 0.84 * u * (0.55 + 0.35 * cold));
    case "hairDensity":
      return clamp01(0.12 + 0.86 * u * (0.70 + 0.22 * cold));
    case "epicanthic":
      return clamp01(0.04 + 0.92 * u * (0.82 - 0.18 * frontier));
    case "eyeAperture":
      return clamp01(0.10 + 0.80 * u);
    case "noseBridge":
      return clamp01(0.08 + 0.84 * u * (0.65 + 0.25 * cold));
    case "noseLength":
      return clamp01(0.10 + 0.80 * u * (0.55 + 0.30 * cold));
    case "jawWidth":
      return clamp01(0.12 + 0.76 * u * (0.60 + 0.28 * cold));
    case "chinProminence":
      return clamp01(0.08 + 0.84 * u * (0.58 + 0.30 * cold));
    case "cheekFullness":
      return clamp01(0.10 + 0.80 * u);
    case "lipFullness":
      return clamp01(0.12 + 0.76 * u * (0.55 + 0.35 * (1 - cold)));
    case "browRidge":
      return clamp01(0.06 + 0.88 * u * (0.62 + 0.28 * cold));
    case "earSize":
      return clamp01(0.10 + 0.80 * u);
    case "headBreadth":
      return clamp01(0.10 + 0.80 * u * (0.58 + 0.28 * cold));
    default:
      return clamp01(u);
  }
}

export function railBAtAnchor(seed, gene, ancId, parentId, parentVal, ti, tTemp, tMoist, arrN) {
  if (gene === "facialHair") {
    return facialHairAtAnchor(seed, ancId, parentId, parentVal, ti, tTemp, tMoist, arrN);
  }
  const u = unit(seed, ancId, parentId, RAIL_B_TAG[gene]);
  if (parentId < 0) {
    const temp = tTemp[ti], moist = tMoist[ti];
    return founderBias(gene, temp, moist, arrN, ti, u);
  }
  return inheritGene(parentVal, u);
}

/** Stamp Rail-B genetics onto ancHomelands (parents before children). */
export function stampLineageGenetics(ancHomelands, K, ancParent, src, seed, tTemp, tMoist, arrN) {
  for (let a = 0; a < K; a++) {
    const ti = src[a];
    const par = ancParent[a];
    for (const gene of RAIL_B_GENES) {
      const parentVal = par >= 0 ? (ancHomelands[par][gene] ?? 0) : 0;
      ancHomelands[a][gene] = railBAtAnchor(
        seed, gene, a, par, parentVal, ti, tTemp, tMoist, arrN);
    }
  }
}

/** Below this, a lineage rarely grows a visible beard (capacity, not style). */
export const BEARD_VISIBLE = 0.15;

export function canGrowBeard(look, threshold = BEARD_VISIBLE) {
  return !!(look && (look.facialHair ?? 0) >= threshold);
}

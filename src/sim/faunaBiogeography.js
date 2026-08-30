// ── Fauna / flora biogeography ────────────────────────────────────────────
// Climate says a species *could* live here (`tileMaterials` eligibility).
// This module says whether it *does* — Earth pins (same class as crop
// PACKAGE_ORIGINS / EARTH_HEARTH_SITES) or a seeded landmass lottery on
// procedural maps.
//
// Not a fitted outcome: origins are real-world range facts, preset-gated.
// Cosmopolitan species (deer, wolf, fish…) stay climate-only.

import { landComp } from "./peopleSim/countryClaim.js";
import { hash32 } from "./peopleSim/rng.js";
import { classifyBiome, observedClimate, B_SAVANNA, B_GRASSLAND, B_DESERT, B_SHRUBLAND,
  B_COLD_DESERT, B_TROP_RAIN, B_TROP_DRY, B_SUBTROP, B_TEMP_RAIN } from "./biomeClass.js";

export function isEarthPreset(world) {
  const p = world && world.preset;
  return p === "earth" || p === "earth_sim";
}

// Wrap-aware map distance in fractional coords (equirectangular).
export function mapDist(ax, ay, bx, by) {
  let dx = Math.abs(ax - bx);
  if (dx > 0.5) dx = 1 - dx;
  return Math.hypot(dx, Math.abs(ay - by));
}

function snapLand(world, fx, fy) {
  const { tw, th, elev } = world;
  if (!elev || !(tw > 0)) return -1;
  const cx = Math.round(fx * tw), cy = Math.round(fy * th);
  const rr = Math.max(2, Math.round(0.03 * tw));
  let best = -1, bestD = Infinity;
  for (let dy = -rr; dy <= rr; dy++) {
    const yy = cy + dy; if (yy < 0 || yy >= th) continue;
    for (let dx = -rr; dx <= rr; dx++) {
      const xx = ((cx + dx) % tw + tw) % tw;
      const ti = yy * tw + xx;
      if (elev[ti] <= 0) continue;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = ti; }
    }
  }
  return best;
}

function tileFrac(world, ti) {
  const { tw, th } = world;
  const y = (ti / tw) | 0, x = ti - y * tw;
  return { fx: (x + 0.5) / tw, fy: (y + 0.5) / th };
}

// Earth origins: fractional map coords, same convention as EARTH_HEARTH_SITES
// (fx = (lon+180)/360, fy = (90−lat)/180). `reach` is wrap-aware map distance.
//
// Cosmopolitan species are omitted — faunaPresent returns true for unknown ids.
export const FAUNA_ORIGINS = {
  lion: {
    biomes: [B_SAVANNA, B_GRASSLAND], nPicks: 1,
    origins: [
      { fx: 0.55, fy: 0.48, reach: 0.20 },  // ~18°E  4°N  sub-Saharan core
      { fx: 0.51, fy: 0.36, reach: 0.08 },  // Maghreb / Atlas remnant
      { fx: 0.705, fy: 0.385, reach: 0.035 }, // Gir Forest (Asiatic lion)
    ],
  },
  leopard: {
    biomes: [B_SAVANNA, B_SHRUBLAND, B_TROP_DRY], nPicks: 2,
    origins: [
      { fx: 0.54, fy: 0.48, reach: 0.20 },  // Africa
      { fx: 0.76, fy: 0.40, reach: 0.12 },  // South / SE Asia
    ],
  },
  tiger: {
    biomes: [B_TROP_RAIN, B_SUBTROP], nPicks: 1,
    origins: [
      { fx: 0.76, fy: 0.38, reach: 0.10 },  // India
      { fx: 0.85, fy: 0.46, reach: 0.08 },  // Sumatra / SE Asia
      { fx: 0.86, fy: 0.28, reach: 0.06 },  // Amur
    ],
  },
  hyena: {
    biomes: [B_SAVANNA, B_SHRUBLAND], nPicks: 1,
    origins: [
      { fx: 0.54, fy: 0.48, reach: 0.18 },
    ],
  },
  elephant: {
    biomes: [B_SAVANNA, B_TROP_DRY], nPicks: 2,
    origins: [
      { fx: 0.53, fy: 0.50, reach: 0.20 },  // Africa
      { fx: 0.78, fy: 0.42, reach: 0.10 },  // India / SE Asia
    ],
  },
  hippo: {
    biomes: [B_SAVANNA, B_TROP_RAIN, B_TROP_DRY], nPicks: 1,
    origins: [
      { fx: 0.53, fy: 0.50, reach: 0.18 },
    ],
  },
  bison: {
    biomes: [B_GRASSLAND], nPicks: 1,
    origins: [
      { fx: 0.22, fy: 0.32, reach: 0.14 },  // North American plains
    ],
  },
  camel: {
    biomes: [B_DESERT, B_COLD_DESERT, B_SHRUBLAND], nPicks: 1,
    origins: [
      { fx: 0.54, fy: 0.38, reach: 0.12 },  // Sahara
      { fx: 0.62, fy: 0.38, reach: 0.08 },  // Arabia
      { fx: 0.78, fy: 0.30, reach: 0.08 },  // Central Asia / Gobi
    ],
  },
  llama: {
    biomes: [B_GRASSLAND, B_SHRUBLAND], nPicks: 1,
    origins: [
      { fx: 0.28, fy: 0.58, reach: 0.07 },  // Andes
    ],
  },
  yak: {
    biomes: [B_GRASSLAND, B_SHRUBLAND], nPicks: 1,
    origins: [
      { fx: 0.80, fy: 0.33, reach: 0.05 },  // Tibetan plateau
    ],
  },
  horse: {
    biomes: [B_GRASSLAND, B_SHRUBLAND], nPicks: 1,
    origins: [
      { fx: 0.64, fy: 0.28, reach: 0.16 },  // Eurasian steppe
    ],
  },
  antelope: {
    biomes: [B_SAVANNA, B_GRASSLAND, B_SHRUBLAND], nPicks: 2,
    origins: [
      { fx: 0.54, fy: 0.48, reach: 0.20 },
      { fx: 0.76, fy: 0.38, reach: 0.10 },
    ],
  },
};

export const FLORA_ORIGINS = {
  nutmeg: {
    biomes: [B_TROP_RAIN], nPicks: 1,
    origins: [{ fx: 0.855, fy: 0.505, reach: 0.04 }],  // Moluccas
  },
  cloves: {
    biomes: [B_TROP_RAIN], nPicks: 1,
    origins: [{ fx: 0.855, fy: 0.505, reach: 0.045 }],
  },
  frankincense: {
    biomes: [B_DESERT, B_SHRUBLAND], nPicks: 1,
    origins: [
      { fx: 0.62, fy: 0.42, reach: 0.06 },  // south Arabia
      { fx: 0.58, fy: 0.44, reach: 0.05 },  // Horn
    ],
  },
  myrrh: {
    biomes: [B_DESERT, B_SHRUBLAND], nPicks: 1,
    origins: [
      { fx: 0.60, fy: 0.43, reach: 0.06 },
    ],
  },
  mulberry: {
    biomes: [B_SUBTROP, B_TEMP_RAIN], nPicks: 1,
    origins: [
      { fx: 0.82, fy: 0.36, reach: 0.10 },  // East Asian sericulture belt
    ],
  },
};

function paintEarth(world, spec, mask) {
  const { N, elev } = world;
  const comp = landComp(world);
  const originComps = new Set();
  const pts = [];
  for (const o of spec.origins) {
    const ti = snapLand(world, o.fx, o.fy);
    if (ti < 0) continue;
    originComps.add(comp[ti]);
    pts.push(o);
  }
  if (!pts.length) return;
  for (let ti = 0; ti < N; ti++) {
    if (elev[ti] <= 0) continue;
    if (!originComps.has(comp[ti])) continue;
    const { fx, fy } = tileFrac(world, ti);
    for (const o of pts) {
      if (mapDist(fx, fy, o.fx, o.fy) <= o.reach) { mask[ti] = 1; break; }
    }
  }
}

function paintProcedural(world, spec, mask, kind, id) {
  const { N, tw, elev, temp, moist, seed } = world;
  const dry = world._dryFrac, sum = world._summerDry;
  const comp = landComp(world);
  const biomes = spec.biomes || [];
  const counts = new Map();
  for (let ti = 0; ti < N; ti++) {
    if (elev[ti] <= 0) continue;
    const b = classifyBiome(elev[ti], moist[ti], temp[ti], dry ? dry[ti] : 0, sum ? sum[ti] : 0,
      observedClimate(world));
    if (!biomes.includes(b)) continue;
    const c = comp[ti];
    counts.set(c, (counts.get(c) || 0) + 1);
  }
  const cands = [...counts.keys()].filter(c => counts.get(c) >= Math.max(4, (tw || 8) >> 3));
  if (!cands.length) return;
  cands.sort((a, b) => a - b);
  const nPick = Math.min(spec.nPicks || 1, cands.length);
  const picked = new Set();
  let h = hash32(seed >>> 0, "faunaBio", kind, id);
  for (let i = 0; i < nPick; i++) {
    h = hash32(h, i);
    let choice = cands[h % cands.length];
    let guard = 0;
    while (picked.has(choice) && guard++ < cands.length) {
      h = hash32(h, guard);
      choice = cands[h % cands.length];
    }
    picked.add(choice);
  }
  for (let ti = 0; ti < N; ti++) {
    if (elev[ti] > 0 && picked.has(comp[ti])) mask[ti] = 1;
  }
}

export function ensureFaunaFields(world) {
  if (!world || !world.elev || !(world.N > 0)) return null;
  const cache = world._faunaBio;
  if (cache && cache.N === world.N && cache.preset === world.preset && cache.seed === world.seed) {
    return cache;
  }
  const { N } = world;
  const fauna = {};
  const flora = {};
  const earth = isEarthPreset(world);
  const paint = (table, out, kind) => {
    for (const [id, spec] of Object.entries(table)) {
      const mask = new Uint8Array(N);
      if (earth) paintEarth(world, spec, mask);
      else paintProcedural(world, spec, mask, kind, id);
      out[id] = mask;
    }
  };
  paint(FAUNA_ORIGINS, fauna, "fauna");
  paint(FLORA_ORIGINS, flora, "flora");
  world._faunaBio = { N, preset: world.preset, seed: world.seed, fauna, flora };
  return world._faunaBio;
}

function presentIn(kind, world, ti, id) {
  const table = kind === "fauna" ? FAUNA_ORIGINS : FLORA_ORIGINS;
  if (!table[id]) return true;
  if (!world || !(world.N > 0) || ti == null || ti < 0) return true;
  const fields = ensureFaunaFields(world);
  if (!fields) return true;
  const mask = fields[kind][id];
  if (!mask) return true;
  return !!mask[ti];
}

export function faunaPresent(world, ti, id) {
  return presentIn("fauna", world, ti, id);
}

export function floraPresent(world, ti, id) {
  return presentIn("flora", world, ti, id);
}

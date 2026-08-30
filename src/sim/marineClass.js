// ── Coast / shelf / ocean classification ───────────────────────────────────
// Land biomes stop at the shore. Pearl, coral, Tyrian, whale, shelf fisheries
// need a water class. There is no bathymetry download: real shelves are a
// standard profile (shallow for a coastal band, then the slope drops to the
// abyss), so the class is distance-to-land in degrees, not cartoon elev.
//
// Classification, not a place name: reef = warm + on the shelf + not a muddy
// estuary; upwelling = subtropical eastern-boundary (west-coast) ocean;
// enclosed = land-locked fetch. Baltic amber and Persian-Gulf pearl fall
// out of those classes, they are not pinned.
//
// Width is in *degrees* (resolution-invariant), ~80 km at the equator, then
// a short slope. Floored at one tile so a coarse grid still has a shelf.

export const M_NONE = 0;
export const M_ROCKY = 1;
export const M_ESTUARY = 2;
export const M_MANGROVE = 3;
export const M_DUNE = 4;
export const M_SHELF = 5;
export const M_REEF = 6;
export const M_UPWELLING = 7;
export const M_ENCLOSED = 8;
export const M_POLAR = 9;
export const M_TEMPERATE = 10;
export const M_TROPICAL = 11;
export const M_DEEP = 12;

/** Flat shelf width, then the drop. Degrees of map, not tiles. */
export const SHELF_DEG = 0.75;
export const SLOPE_DEG = 0.45;

function tileDeg(c) {
  const tw = (c && c.tw) || (c && c.world && (c.world.tw || c.world.width)) || 0;
  return tw > 0 ? 360 / tw : 1.5;
}

/**
 * Multi-source BFS: degrees from nearest land. Land is 0; ocean beyond ~8°
 * stays huge (deep). Cached on the world. Does not rewrite elev.
 */
export function ensureLandDeg(world) {
  const N = world && (world.N != null ? world.N : (world.elev && world.elev.length));
  if (!world || !N) return null;
  if (world._matLandDeg && world._matLandDeg.length === N) return world._matLandDeg;
  const { tw, th, elev } = world;
  const dist = new Float32Array(N);
  dist.fill(1e9);
  if (!elev || !(tw > 0) || !(th > 0)) {
    world._matLandDeg = dist;
    return dist;
  }
  const step = 360 / tw;
  const q = [];
  for (let i = 0; i < N; i++) {
    if (elev[i] > 0) { dist[i] = 0; q.push(i); }
  }
  const cap = 8;
  for (let qi = 0; qi < q.length; qi++) {
    const ci = q[qi], cd = dist[ci];
    if (cd >= cap) continue;
    const cx = ci % tw, cy = (ci - cx) / tw;
    const n4 = [
      cy * tw + (cx === 0 ? tw - 1 : cx - 1),
      cy * tw + (cx === tw - 1 ? 0 : cx + 1),
      cy > 0 ? ci - tw : -1,
      cy < th - 1 ? ci + tw : -1,
    ];
    for (let k = 0; k < 4; k++) {
      const ni = n4[k];
      if (ni < 0) continue;
      const nd = cd + step;
      if (nd < dist[ni]) {
        dist[ni] = nd;
        q.push(ni);
      }
    }
  }
  world._matLandDeg = dist;
  return dist;
}

/** Degrees from nearest land for an ocean tile (0 on land). */
export function landDistDeg(c) {
  if (c.landDeg != null) return c.landDeg;
  if ((c.elev || 0) > 0) return 0;
  if (c.world && c.ti != null) {
    const d = ensureLandDeg(c.world);
    if (d) return d[c.ti];
  }
  if (c.oceanDist != null && c.oceanDist < 255) return c.oceanDist * tileDeg(c);
  // Unit tests pass coastDist on a water tile as "nearness to shore".
  const coast = c.coastDist == null ? 255 : c.coastDist;
  return coast * tileDeg(c);
}

/** Shallow coastal band (shelf + short slope), floored at one tile. */
export function onShelf(c) {
  const tile = tileDeg(c);
  return landDistDeg(c) <= Math.max(SHELF_DEG + SLOPE_DEG, tile);
}

export const MARINE_NAMES = {
  [M_NONE]: "none",
  [M_ROCKY]: "rocky-coast",
  [M_ESTUARY]: "estuary",
  [M_MANGROVE]: "mangrove",
  [M_SHELF]: "shelf",
  [M_REEF]: "reef",
  [M_UPWELLING]: "upwelling",
  [M_ENCLOSED]: "enclosed-sea",
  [M_POLAR]: "polar-sea",
  [M_TEMPERATE]: "temperate-sea",
  [M_TROPICAL]: "tropical-sea",
  [M_DEEP]: "deep",
  [M_DUNE]: "dune",
};

function latOf(c) {
  if (c.lat != null) return c.lat;
  const { world, ti } = c;
  if (!world || ti == null) return 0;
  const th = world.th || world.height || 1;
  const tw = world.tw || world.width || 1;
  const y = (ti / tw) | 0;
  return Math.abs((y + 0.5) / th - 0.5) * 2; // 0 equator … 1 pole
}

function westIsOcean(c) {
  const world = c.world;
  if (!world || !world.elev || !(world.tw > 0)) return false;
  const { tw, th, elev } = world;
  const y = (c.ti / tw) | 0, x = c.ti - y * tw;
  const wi = y * tw + (x === 0 ? tw - 1 : x - 1);
  const ei = y * tw + (x === tw - 1 ? 0 : x + 1);
  if (c.elev > 0) return elev[wi] <= 0;          // land, ocean to the west
  return elev[ei] > 0 && elev[wi] <= 0;          // ocean, land to the east
}

function landSurround(c, r = 4) {
  const world = c.world;
  if (!world || !world.elev || !(world.tw > 0)) return 0;
  const { tw, th, elev } = world;
  const y0 = (c.ti / tw) | 0, x0 = c.ti - y0 * tw;
  let land = 0, n = 0;
  for (let dy = -r; dy <= r; dy++) {
    const y = y0 + dy;
    if (y < 0 || y >= th) continue;
    for (let dx = -r; dx <= r; dx++) {
      const x = ((x0 + dx) % tw + tw) % tw;
      n++;
      if (elev[y * tw + x] > 0) land++;
    }
  }
  return n ? land / n : 0;
}

/**
 * @param {object} c tileMaterials signal bag (elev, temp, moist, coastDist,
 *   riverMag, flood, biome, world, ti)
 * @returns {number} M_* class
 */
export function classifyMarine(c) {
  const elev = c.elev || 0;
  const temp = c.temp || 0;
  const moist = c.moist || 0;
  const coast = c.coastDist == null ? 255 : c.coastDist;
  const river = c.riverMag || 0;
  const lat = latOf(c);
  const warm = temp > 0.76;
  const trop = temp > 0.80;
  const cold = temp < 0.58;
  const shelf = onShelf(c);

  if (elev > 0) {
    if (trop && moist > 0.45 && coast <= 3) return M_MANGROVE;
    if ((c.flood || river >= 3) && coast <= 4) return M_ESTUARY;
    if (moist < 0.22 && coast <= 2) return M_DUNE;
    if ((c.relief > 0.40 || elev > 0.18) && coast <= 2) return M_ROCKY;
    if (coast <= 1) {
      if (warm) return M_REEF;
      return M_SHELF;
    }
    return M_NONE;
  }

  // Ocean: polar anywhere (whales in open polar water). Enclosed / upwelling
  // are coastal. Past the shelf+slope the water is deep.
  if (cold && lat > 0.55) return M_POLAR;
  if (shelf && landSurround(c, 5) > 0.42) return M_ENCLOSED;
  const westCoastOcean = westIsOcean(c);
  if (shelf && westCoastOcean && lat > 0.10 && lat < 0.45 && temp < 0.82) return M_UPWELLING;
  if (!shelf) return M_DEEP;
  if (warm && river < 3) return M_REEF;
  if (trop) return M_TROPICAL;
  if (temp < 0.70) return M_TEMPERATE;
  return M_SHELF;
}

const GOODS = [
  { id: "coral",     ok: m => m === M_REEF },
  { id: "pearl",     ok: m => m === M_REEF || m === M_ENCLOSED },
  { id: "whale",     ok: m => m === M_POLAR || m === M_UPWELLING },
  { id: "amber",     ok: m => m === M_ENCLOSED },
  { id: "fish",      ok: m => m === M_SHELF || m === M_ESTUARY || m === M_REEF || m === M_ENCLOSED || m === M_TEMPERATE || m === M_TROPICAL },
  { id: "shellfish", ok: m => m === M_SHELF || m === M_ESTUARY || m === M_ENCLOSED },
  { id: "mangrove",  ok: m => m === M_MANGROVE },
];

/**
 * Named marine goods. Coastal land, and ocean only on the shelf (before
 * the drop). Open-ocean polar/upwelling still name whale.
 */
export function marineGoods(c, marineClass) {
  const m = marineClass == null ? classifyMarine(c) : marineClass;
  if (m === M_NONE || m === M_DEEP) return [];
  if ((c.elev || 0) <= 0 && m !== M_POLAR && m !== M_UPWELLING && !onShelf(c)) return [];
  const warm = (c.temp || 0) > 0.74;
  const cold = (c.temp || 0) < 0.62;
  const out = [];
  for (const g of GOODS) {
    if (!g.ok(m)) continue;
    if (g.id === "coral" && !warm) continue;
    if (g.id === "pearl" && !warm) continue;
    if (g.id === "whale" && !cold && m !== M_UPWELLING) continue;
    if (g.id === "amber" && !((c.temp || 0) >= 0.52 && (c.temp || 0) <= 0.68)) continue;
    out.push({ id: g.id, class: MARINE_NAMES[m] });
  }
  return out.slice(0, 3);
}

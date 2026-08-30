// ── Coast / shelf / ocean classification ───────────────────────────────────
// Land biomes stop at the shore. Pearl, coral, Tyrian, whale, shelf fisheries
// need a water class. Signals are the ones Earth already has: elevation as a
// depth proxy, coast distance, latitude, temperature, river magnitude, and
// whether the basin is enclosed (high land-surround). No second bathymetry.
//
// Classification, not a place name: reef = warm + shallow + not a muddy
// estuary; upwelling = subtropical eastern-boundary (west-coast) ocean;
// enclosed = land-locked fetch. Baltic amber and Persian-Gulf pearl fall
// out of those classes, they are not pinned.

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

export const MARINE_NAMES = {
  [M_NONE]: "none",
  [M_ROCKY]: "rocky-coast",
  [M_ESTUARY]: "estuary",
  [M_MANGROVE]: "mangrove",
  [M_DUNE]: "dune",
  [M_SHELF]: "shelf",
  [M_REEF]: "reef",
  [M_UPWELLING]: "upwelling",
  [M_ENCLOSED]: "enclosed-sea",
  [M_POLAR]: "polar-sea",
  [M_TEMPERATE]: "temperate-sea",
  [M_TROPICAL]: "tropical-sea",
  [M_DEEP]: "deep",
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
  const shallow = elev > -0.05;
  const deep = elev <= -0.08;

  if (elev > 0) {
    if (coast > 3 && !c.flood && river < 2) return M_NONE;
    if (trop && moist > 0.45 && coast <= 3) return M_MANGROVE;
    if ((c.flood || river >= 3) && coast <= 4) return M_ESTUARY;
    if (moist < 0.22 && coast <= 3) return M_DUNE;
    if ((c.relief > 0.40 || elev > 0.18) && coast <= 3) return M_ROCKY;
    if (coast <= 3) {
      if (warm && shallow) return M_REEF;
      return M_SHELF;
    }
    return M_NONE;
  }

  // Ocean tile.
  if (deep && coast > 6) return M_DEEP;
  if (cold && lat > 0.55) return M_POLAR;
  const enclosed = landSurround(c, 5) > 0.42;
  if (enclosed && !deep) return M_ENCLOSED;
  const westCoastOcean = westIsOcean(c);
  if (westCoastOcean && lat > 0.10 && lat < 0.45 && temp < 0.82) return M_UPWELLING;
  if (warm && shallow && river < 3) return M_REEF;
  if (shallow || coast <= 4) return M_SHELF;
  if (trop) return M_TROPICAL;
  if (temp < 0.70) return M_TEMPERATE;
  return M_TROPICAL;
}

const GOODS = [
  { id: "coral",     ok: m => m === M_REEF },
  { id: "pearl",     ok: m => m === M_REEF || m === M_SHELF || m === M_ENCLOSED },
  { id: "whale",     ok: m => m === M_POLAR || m === M_UPWELLING },
  { id: "amber",     ok: m => m === M_ENCLOSED },
  { id: "fish",      ok: m => m !== M_NONE && m !== M_DEEP && m !== M_DUNE },
  { id: "shellfish", ok: m => m === M_SHELF || m === M_ESTUARY || m === M_ENCLOSED },
  { id: "mangrove",  ok: m => m === M_MANGROVE },
];

/**
 * Named marine goods for this tile. Coastal land AND the first ring of
 * ocean both qualify; deep open ocean returns [].
 */
export function marineGoods(c, marineClass) {
  const m = marineClass == null ? classifyMarine(c) : marineClass;
  if (m === M_NONE || m === M_DEEP) return [];
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

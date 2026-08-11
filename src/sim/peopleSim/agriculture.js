// ── The agricultural transition (Diamond / Scott, in sim form) ───────────────
//
// Fertility is NECESSARY but not SUFFICIENT for dense, state-capable population.
// Most of the planet can grow *something* — but a hunter-gatherer band on fertile
// land lives at a tiny fraction of the density a farming society reaches on the
// SAME land, and produces no storable, taxable cereal surplus, so no state forms.
// Historically the move from foraging to farming (a) had to be INVENTED at a few
// hearths and DIFFUSE outward (slowly, and barely across climates/deserts/water —
// the sim's cradles + knowledge spread + AXIS_BIAS already model this), and (b) was
// capped by GEOGRAPHY: the domesticable-species package was rich on the giant,
// connected Old-World landmass and poor on isolated continents (Australia, the
// Americas) and in the disease-ridden wet tropics (Diamond's thesis for why fertile
// Australia / the pre-maize US / the Amazon stayed stateless until colonisation).
//
// Two factors, multiplied into a settlement's LAND food:
//   1. DEVELOPMENT — forager floor at zero agriculture knowledge, rising to full as
//      farming develops/arrives. This is what makes a fresh frontier sparse and lets
//      civilisation RADIATE from the cradles instead of the whole map farming at full
//      yield from tick 0.
//   2. CEILING — a static, per-tile cap on how far agriculture can develop AT ALL on
//      this land (Diamond's geography): high on the largest connected landmass, low on
//      isolated continents and in the wet tropics. Even given infinite time, a low-
//      ceiling region never reaches full farming density — it stays a sparse frontier.

import { T } from "./tuning.js";
import { packagePresent, packageAdaptMul } from "./biogeography.js";
import { CROP_PACKAGES, CROP_BY_ID } from "../cropPackages.js";
import { cropSuitabilityPkg } from "../cropGen.js";

// ── Crop-package layer (T.CROP_AXIS) ──────────────────────────────────
// Suitability of ONE package at a tile, read from the world's tile climate
// arrays (cropSuitabilityPkg applies the shared arid / tropical-soil / elevation
// / alluvial gates and the package's own climate bell).
// T.IRRIG_CROP: a FLOOD-FED field reads the river, not the sky. The crop model's
// moisture bell reads rainfall, but the arid-river cradles were never rain-fed —
// Mesopotamian and Egyptian wheat grew on basin irrigation from the flood
// (measured under OBSERVED climate: Mesopotamia rains m=0.02, and the wheat that
// historically fed it scores ~0 there, so the hearth falls to a sorghum-class
// site — the crop model contradicting the fertility model, whose alluvium terms
// already know these valleys are breadbaskets). On tFlood ground (the arid-river
// floodplain mask — the Nile/Indus/Tigris corridor class, a WORLDGEN property,
// no place named) the moisture a crop EXPERIENCES is floored at well-watered:
// MOIST_FLOOD_FED = 0.5, mid-scale — a statement about flood basins (annually
// re-watered, silt-wetted), not about any crop; rain-fed land is untouched, and
// a wet-climate floodplain is already above the floor so nothing changes there.
// Applied to the annual read AND the seasonal read (the shared envGate comment's
// own words: "a river irrigates year-round").
const MOIST_FLOOD_FED = 0.5;
export function pkgSuitAt(world, ti, pkg) {
  const e = world.elev[ti]; if (e <= 0) return 0;
  const coast = world.coast ? world.coast[ti] : 0;
  const rm = world.riverMag ? world.riverMag[ti] : 0;
  const t = world.temp[ti];
  let m = world.moist[ti];
  if (T.IRRIG_CROP && world.tFlood && world.tFlood[ti] && m < MOIST_FLOOD_FED) m = MOIST_FLOOD_FED;
  // T.GROW_SEASON: evaluate the package on the SEASON IT GROWS IN. The crop's
  // own tOpt picks the season — a cool-optimum crop (wheat) grows in the tile's
  // cool half, a warm-optimum crop (maize/rice) in the warm half — and it reads
  // THAT season's temperature and rainfall. No per-crop label: the season falls
  // out of tOpt vs the two half-year temperatures. (docs/design-growing-season.md)
  if (world._tAmp) {
    const amp = world._tAmp[ti], wf = world._warmRainFrac[ti];
    const tWarm = t + amp, tCool = t - amp;
    // CROP-SEASON CLASSIFICATION: a crop is warm-season or cool-season by its OWN
    // optimum (the botanical division ~18C: wheat/barley/oats cool, maize/rice/
    // sorghum/millet warm), and it grows in THAT half of the year regardless of
    // whether the half is above/below its optimum — a summer crop grows in summer
    // or not at all. A warm-season crop forced into a hot dry summer then FAILS on
    // that season's drought, which is the Mediterranean-summer mechanism.
    const warm = pkg.tOpt >= 0.80;
    const tGrow = warm ? tWarm : tCool;
    // Season moisture: gentle bias toward the annual level (even split ⇒ mGrow=m,
    // fully-wet season ⇒ 1.4×m, fully-dry ⇒ 0.6×m) — not the ×2 that overshot.
    const frac = warm ? wf : 1 - wf;
    let mGrow = Math.max(0, Math.min(1, m * (0.6 + 0.8 * frac)));
    // Flood-fed ground keeps its floor in EVERY season (basin irrigation stores
    // the flood for the growing season — Egypt's winter wheat on the summer
    // flood's water); rain-fed seasonality is untouched.
    if (T.IRRIG_CROP && world.tFlood && world.tFlood[ti] && mGrow < MOIST_FLOOD_FED) mGrow = MOIST_FLOOD_FED;
    return cropSuitabilityPkg(pkg, t, m, e, coast, rm, null, tGrow, mGrow);
  }
  return cropSuitabilityPkg(pkg, t, m, e, coast, rm, null);
}

// Best package at a tile by RAW suitability — what a cradle / mature culture
// would domesticate here. Returns { id, suit } or null if nothing grows.
// T.CROP_BIOGEO: only packages that have SPREAD to this tile (wild ancestor's
// homeland + the wave of advance, biogeography.js) compete — so maize is not a
// candidate in Egypt however irrigable, and the New World keeps its own crops.
// Off / before the fields exist, every package is present (byte-identical).
export function bestPackageAt(world, ti) {
  let best = null, bestS = 0;
  for (const pkg of CROP_PACKAGES) {
    // T.CROP_MILLET (v7 regime guard): the millet split changes which crop the
    // whole East-Asian dawn domesticates. A never-owned package's ONLY entry
    // point into a world is this competition (cropCeil/adoption read OWNED
    // crops), so one gate here keeps a pre-split save's agronomy whole.
    if (pkg.id === "millet" && !T.CROP_MILLET) continue;
    // PRESENCE (T.CROP_HOMELAND, or the full T.CROP_BIOGEO): a wild ancestor
    // can only be domesticated where its range has actually arrived — what
    // keeps maize out of China, rice out of Australia, wheat out of the
    // southern hemisphere at the dawn (the from-0 report, 2026-08-07).
    if ((T.CROP_BIOGEO || T.CROP_HOMELAND) && !packagePresent(world, ti, pkg)) continue;
    // ADAPTATION (full T.CROP_BIOGEO only): a package arrives as a lesser
    // version of itself the farther it has come (packageAdaptMul) — so the
    // LOCAL package wins its own band. Measured to thin domesticated-crop
    // coverage past the founding bars (see biogeography.js), so it stays with
    // the blocked full lever; the presence half ships without it. ×1 off.
    const s = pkgSuitAt(world, ti, pkg) * (T.CROP_BIOGEO ? packageAdaptMul(world, ti, pkg) : 1);
    if (s > bestS) { bestS = s; best = pkg; }
  }
  return best ? { id: best.id, suit: bestS } : null;
}

// Crop-package agricultural CEILING for a settlement: the best STORABLE yield
// (suit × storability) among the crops it OWNS, evaluated at its home tile. 0 =
// it owns no crop that grows here — a forager (it may know farming TECHNIQUE,
// but has nothing domesticated for this climate). The ×storability is what caps
// the wet-tropic tuber zone low even where the land is lush. Carrying an
// off-climate crop (e.g. inherited wheat in the tropics) costs nothing: its
// local suitability is ~0, so it never sets the ceiling.
export function cropCeil(world, s) {
  const crops = s.crops; if (!crops || crops.length === 0) return 0;
  const ti = (s.pos.y | 0) * world.tw + (s.pos.x | 0);
  let best = 0;
  for (const id of crops) {
    const pkg = CROP_BY_ID[id]; if (!pkg) continue;
    const v = pkgSuitAt(world, ti, pkg) * pkg.storability;
    if (v > best) best = v;
  }
  return best;
}

// Per-tile domestication ceiling (computed once, cached on world._agriCeil).
function computeAgriCeiling(world) {
  const { N, tw, th, elev, temp, moist } = world;
  // ── connected-landmass flood fill (4-neighbour, x-wraps) ──
  const comp = new Int32Array(N).fill(-1);
  const size = [];
  const stack = [];
  let nComp = 0;
  for (let i = 0; i < N; i++) {
    if (elev[i] <= 0 || comp[i] >= 0) continue;
    const id = nComp++; let sz = 0;
    stack.length = 0; stack.push(i); comp[i] = id;
    while (stack.length) {
      const ti = stack.pop(); sz++;
      const y = (ti / tw) | 0, x = ti - y * tw;
      const left  = y * tw + ((x - 1 + tw) % tw);
      const right = y * tw + ((x + 1) % tw);
      const up    = y > 0 ? ti - tw : -1;
      const down  = y < th - 1 ? ti + tw : -1;
      if (comp[left]  < 0 && elev[left]  > 0) { comp[left]  = id; stack.push(left); }
      if (comp[right] < 0 && elev[right] > 0) { comp[right] = id; stack.push(right); }
      if (up   >= 0 && comp[up]   < 0 && elev[up]   > 0) { comp[up]   = id; stack.push(up); }
      if (down >= 0 && comp[down] < 0 && elev[down] > 0) { comp[down] = id; stack.push(down); }
    }
    size[id] = sz;
  }
  let largest = 1; for (const s of size) if (s > largest) largest = s;
  // ── ceiling per tile: landmass connectivity × wet-tropic penalty ──
  const ceil = new Float32Array(N);
  const floor = T.AGRI_CEIL_FLOOR;
  for (let i = 0; i < N; i++) {
    if (elev[i] <= 0) { ceil[i] = 0; continue; }
    // Relative landmass size → ceiling. sqrt so medium continents (the Americas) sit
    // well above the isolated floor while the giant Old-World mass alone reaches 1.0.
    const rel = size[comp[i]] / largest;
    let c = floor + (1 - floor) * Math.sqrt(rel);
    // Wet-tropic penalty: hot & wet land (disease, leached soils, root crops not
    // storable cereals) caps lower — the Congo/Amazon/New-Guinea statelessness.
    const t = temp[i], m = moist[i];
    if (t > 0.78 && m > 0.6) {
      const trop = Math.min(1, (t - 0.78) / 0.12) * Math.min(1, (m - 0.6) / 0.25);
      c *= 1 - T.AGRI_TROPIC_PENALTY * trop;
    }
    ceil[i] = c;
  }
  return ceil;
}

// Agricultural development factor on a settlement's LAND food (the home tile's land).
// Forager floor at zero agriculture, rising to full at T.AGRI_FULL_AT — but the land's
// domestication ceiling caps the effective agriculture, so isolated/tropical regions
// can never reach full farming density no matter how long they develop.
export function agriGate(world, s) {
  let ceil;
  if (T.CROP_AXIS > 0) {
    // Owned-crop ceiling. Cached (home tile + crops are static between changes);
    // crop acquisition / domestication in settlement.js invalidates it by
    // setting s._cropCeil = undefined. STILL capped by the landmass-isolation
    // ceiling, so an isolated continent can't farm at full density just because
    // its settlements happen to own good crops — the Diamond isolation thesis
    // holds on BOTH branches, not only the default one.
    if (s._cropCeil === undefined) s._cropCeil = cropCeil(world, s);
    if (!world._agriCeil || world._agriCeilKey !== T.AGRI_CEIL_FLOOR * 1000 + T.AGRI_TROPIC_PENALTY) { world._agriCeil = computeAgriCeiling(world); world._agriCeilKey = T.AGRI_CEIL_FLOOR * 1000 + T.AGRI_TROPIC_PENALTY; }   // recompute when either baked-in lever moves (B10 — honour the live-lever contract)
    const ti = (s.pos.y | 0) * world.tw + (s.pos.x | 0);
    ceil = Math.min(s._cropCeil, world._agriCeil[ti] || 0);
  } else {
    if (!world._agriCeil || world._agriCeilKey !== T.AGRI_CEIL_FLOOR * 1000 + T.AGRI_TROPIC_PENALTY) { world._agriCeil = computeAgriCeiling(world); world._agriCeilKey = T.AGRI_CEIL_FLOOR * 1000 + T.AGRI_TROPIC_PENALTY; }   // recompute when either baked-in lever moves (B10 — honour the live-lever contract)
    const ti = (s.pos.y | 0) * world.tw + (s.pos.x | 0);
    ceil = world._agriCeil[ti] || 0;
  }
  const ag = Math.min((s.knowledge && s.knowledge.agriculture) || 0, ceil);
  const dev = Math.min(1, ag / Math.max(1e-3, T.AGRI_FULL_AT));   // 0 = foraging, 1 = full agriculture
  s._agriGate = T.AGRI_FORAGE_YIELD + (1 - T.AGRI_FORAGE_YIELD) * dev;   // (info panel)
  s._agriCeil = ceil;
  return s._agriGate;
}

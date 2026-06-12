// ── Crop packages (SPIKE) ─────────────────────────────────────────────
// A concrete, per-crop layer under the single abstract `cropSuitability`
// scalar in cropGen.js. Each package is a CLIMATE ENVELOPE — a Gaussian bell
// over temperature and moisture — plus two economic traits:
//   storability — how storable/taxable the surplus is (a cereal you can bin and
//                 tax vs a root crop that rots in weeks). This is the lever that
//                 keeps the WET TROPICS stateless even on fertile land: tubers
//                 grow lushly but yield no granary, so no surplus-funded state.
//   yield       — peak food multiplier at the climate optimum.
//
// Temperature scale (shared across the sim): t = 0.60 + degC/100, so
//   t 0.60 = 0°C · 0.70 = 10°C · 0.80 = 20°C · 0.86 = 26°C · 0.90 = 30°C.
//
// WHY THIS GIVES THE AXIS EFFECT FOR FREE: a package only takes where the
// destination's climate suits THAT crop. Wheat's bell is centred cool & dry, so
// it spreads fast east–west along a temperate latitude band and simply cannot
// jump south across the hot, wet tropics — a region there must wait for a
// tropic-adapted package (rice/sorghum/tubers) or re-domesticate. The continental
// axis is then EMERGENT geography, not a hand-tuned diffusion multiplier.
//
// The five packages map onto Diamond's story (and the user's wheat/rice/corn):
//   wheat  — Fertile-Crescent founder cereal; the east–west Eurasian breadbasket
//   rice   — warm + very wet; monsoon Asia paddy
//   maize  — broad-tolerant New-World cereal; its width is its superpower
//   sorghum— hot + DRY; the Sahel/dry-savanna crop that farms tropical Africa
//   tubers — hot + WET but barely storable; the Congo/Amazon/New-Guinea pattern

export const CROP_PACKAGES = [
  // id        name              tOpt  tTol   mOpt  mTol  store yield  color (RGB)
  { id: "wheat",   name: "Wheat & Barley", tOpt: 0.73, tTol: 0.075, mOpt: 0.36, mTol: 0.16, storability: 1.00, yield: 1.00, color: [222, 184, 70] },
  { id: "rice",    name: "Rice",           tOpt: 0.86, tTol: 0.065, mOpt: 0.72, mTol: 0.17, storability: 1.00, yield: 1.15, color: [70, 160, 95] },
  { id: "maize",   name: "Maize",          tOpt: 0.82, tTol: 0.100, mOpt: 0.50, mTol: 0.18, storability: 0.95, yield: 1.05, color: [225, 140, 55] },
  { id: "sorghum", name: "Sorghum & Millet", tOpt: 0.87, tTol: 0.100, mOpt: 0.30, mTol: 0.17, storability: 0.90, yield: 0.85, color: [196, 170, 110] },
  { id: "tubers",  name: "Roots & Tubers", tOpt: 0.85, tTol: 0.100, mOpt: 0.78, mTol: 0.20, storability: 0.35, yield: 1.00, color: [150, 95, 175] },
];

export const CROP_BY_ID = {};
for (const c of CROP_PACKAGES) CROP_BY_ID[c.id] = c;

// Raw climate fit of a package at a tile: a separable Gaussian over (temp, moisture),
// 0..1, 1 at the crop's optimum. NO environment gates here (elevation / aridity /
// alluvium live in cropGen.js so the package path reuses the already-tuned gates).
export function pkgClimateBell(pkg, t, m) {
  const dt = (t - pkg.tOpt) / pkg.tTol;
  const dm = (m - pkg.mOpt) / pkg.mTol;
  return Math.exp(-0.5 * dt * dt) * Math.exp(-0.5 * dm * dm);
}

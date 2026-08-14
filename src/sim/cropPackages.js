import { T } from "./peopleSim/tuning.js";

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

// domLagY — the DOMESTICATION LAG: years from first cultivation of the wild
// ancestor to a productive, farmable staple. An archaeobotany fact per package
// (the same admissibility class as tTolEarly): wheat/barley fixed non-shattering
// forms within centuries (PPNA→PPNB, ~9500→8700 BC); Yangtze rice shows a
// millennia-long proto-domestication tail (~7000→4500 BC); maize is the extreme —
// teosinte's 5-kernel spike took ~4,000+ years of selection to become a cob worth
// planting (~7000→2700 BC), the documented reason Mesoamerican VILLAGES lag
// Mesoamerican CULTIVATION by millennia; sorghum/millet sit between; vegetative
// tuber domestication is slow to yield a taxable staple. The DIRECTIONS and
// ORDERS of magnitude are the evidence-backed claims — none of these is derivable
// to three digits and none is asserted to be. Read by the hearth-maturity law
// (state.js, T.INVENT_STAGGER): T = domLagY / site-suitability — the package
// carries the lag, the land only stretches or realizes it. This is what makes
// continental DIVERGENCE emerge from botany: the Crescent leads because its
// package was uniquely fast, the Americas trail by millennia because maize is
// maize, and a packageless land (Australia) never matures a hearth at all.
export const CROP_PACKAGES = [
  // id        name              tOpt  tTol   mOpt  mTol  store yield  domLagY  color (RGB)
  { id: "wheat",   name: "Wheat & Barley", tOpt: 0.73, tTol: 0.075, mOpt: 0.36, mTol: 0.16, storability: 1.00, yield: 1.00, domLagY: 900,  color: [222, 184, 70] },
  { id: "rice",    name: "Rice",           tOpt: 0.86, tTol: 0.065, mOpt: 0.72, mTol: 0.17, storability: 1.00, yield: 1.15, domLagY: 2500, color: [70, 160, 95] },
  // tTolEarly (T.CROP_PHOTOPERIOD): PREHISTORIC maize was PHOTOPERIOD-SENSITIVE —
  // it flowered on day-length cues, so every shift in latitude demanded
  // re-adaptation. That is the documented reason maize crawled north from Mexico
  // for millennia and did not reach productive cultivation in eastern North
  // America until ~900 AD, while wheat and barley crossed ~9,000 km of Eurasia
  // along one latitude band far faster. tTol 0.100 (WIDER than wheat's 0.075)
  // describes MODERN maize — 500 years of breeding, deliberately
  // photoperiod-insensitive varieties — which is an anachronism in a prehistory
  // model, and it is the parameter that made maize win the extreme
  // high-suitability TAIL and take 7 of 10 hearths including the Nile
  // (measured, docs/design-idea-field.md). The corrected value is narrower than
  // wheat because early maize was genuinely harder to move across latitude than
  // wheat was; the DIRECTION is the evidence-backed claim, the exact figure is
  // not derivable to three digits and is not asserted to be.
  { id: "maize",   name: "Maize",          tOpt: 0.82, tTol: 0.100, tTolEarly: 0.055, mOpt: 0.50, mTol: 0.18, storability: 0.95, yield: 1.05, domLagY: 4500, color: [225, 140, 55] },
  { id: "sorghum", name: "Sorghum & Pearl Millet", tOpt: 0.87, tTol: 0.100, mOpt: 0.30, mTol: 0.17, storability: 0.90, yield: 0.85, domLagY: 2000, color: [196, 170, 110] },
  // MILLET (foxtail/broomcorn — the North-China founder crop), split from the
  // Sahel package 2026-08-07 (owner order; docs/dawn-cradles-2026-08-07.md §5).
  // The combined "Sorghum & Millet" wore one Sahel-hot bell (tOpt 0.87 ≈ 27°C)
  // that scores ~0 on the cool Central Plain, so the Yellow River pin fell to
  // RICE's 2,500y lag at mediocre suit — measured needY 3,564-3,945y, 2.3-2.6×
  // the Nile/Indus, making China the LAST Old-World cradle and a seed-coin-flip
  // against Mesoamerica when the real record has Cishan/Xinglonggou millet
  // villages nearly contemporary with the Crescent. Values, all archaeobotany-
  // class (direction and order the claim, digits not asserted): a WARM-SEASON
  // temperate summer crop (tOpt 0.84 ≈ the N-China 22-26°C growing season, ≥
  // the 0.80 warm-season classifier line; tTol 0.080 — a temperate band, not
  // equatorial); dryland summer-rain moisture (mOpt 0.32 between wheat's 0.36
  // and sorghum's 0.30); storability 1.00 — millet IS the ancient Chinese
  // granary/tax staple (Qin/Han grain levies); modest yield 0.85; and the
  // FAST lag that is the whole point: ~1,500y (cultivation ~8000-7500 BC →
  // domesticated forms by ~6500 BC — slower than wheat's 900, far faster than
  // rice's proto-domestication tail). Gated by T.CROP_MILLET (v7 save-regime
  // guard: a pre-split save keeps the agronomy it grew on).
  { id: "millet",  name: "Millet",          tOpt: 0.84, tTol: 0.080, mOpt: 0.32, mTol: 0.16, storability: 1.00, yield: 0.85, domLagY: 1500, color: [214, 196, 120] },
  { id: "tubers",  name: "Roots & Tubers", tOpt: 0.85, tTol: 0.100, mOpt: 0.78, mTol: 0.20, storability: 0.35, yield: 1.00, domLagY: 3000, color: [150, 95, 175] },
];

export const CROP_BY_ID = {};
for (const c of CROP_PACKAGES) CROP_BY_ID[c.id] = c;

// Raw climate fit of a package at a tile: a separable Gaussian over (temp, moisture),
// 0..1, 1 at the crop's optimum. NO environment gates here (elevation / aridity /
// alluvium live in cropGen.js so the package path reuses the already-tuned gates).
export function pkgClimateBell(pkg, t, m) {
  // T.CROP_PHOTOPERIOD: use a package's PREHISTORIC temperature tolerance where
  // one is declared (tTolEarly — currently maize alone; see its note above).
  // Temperature band is this model's only proxy for latitude, so a crop that
  // could not cross latitudes without re-adaptation is expressed as a narrower
  // temperature bell.
  const tTol = (T.CROP_PHOTOPERIOD && pkg.tTolEarly) ? pkg.tTolEarly : pkg.tTol;
  const dt = (t - pkg.tOpt) / tTol;
  const dm = (m - pkg.mOpt) / pkg.mTol;
  return Math.exp(-0.5 * dt * dt) * Math.exp(-0.5 * dm * dm);
}

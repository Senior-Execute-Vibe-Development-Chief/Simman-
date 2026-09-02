/* V2 M1 PORT
 * source: src/sim/cropGen.js; deviations: Math transcendental calls use v2 dmath; v1 tuning import is removed at the boundary; plate-boundary soil radius is expressed in km.
 * source commit: 97f51dd7c3a3142bfbb366f2e08491f582367e30
 */
import { dexp, dpow } from "../../sim/dmath.ts";
import { VOLCANIC_FULL_KM } from "../../sim/constants.ts";
// Crop suitability — the SINGLE source of truth for agricultural fertility, imported by both
// the app (WorldSim.jsx world-gen) and the headless probe/render harness so they can never
// silently diverge (they used to: the probes carried a stale, pre-cold-gate copy that rated
// Siberia as prime farmland). Mirrors the original inline WorldSim calc exactly.
//
// A COLD GATE rules out short-season high latitudes (annual mean below ~-3C ~= 0, rising to
// full suitability by ~+10C); a broad warm plateau (temperate breadbaskets -> subtropics ->
// watered tropics) with a gentle roll-off in extreme heat; a tropical lateritic-soil penalty
// (the Amazon/Congo paradox) discounted on young soil near plate boundaries / coasts / rivers;
// an elevation penalty; and a river/coast alluvial bonus (Nile, Indus, Mekong breadbaskets).
//
//   t = temperature (0.60 + degC/100), m = moisture, e = elevation (sea <= 0),
//   coast = coastal flag, riverMag = river magnitude at the tile (0 if none),
//   bDist = plate-boundary distance (optional; omit/undefined to skip the young-soil discount).
import { pkgClimateBell } from "./cropPackages.js";

// Shared ENVIRONMENT gates applied to a raw climate-suitability value: the arid
// gate, the tropical lateritic-soil penalty (discounted on young volcanic /
// alluvial / coastal soil), the elevation penalty, and the river/coast alluvial
// bonus. ONE source of truth so the legacy single-bell path and the per-package
// path can never drift — they used to carry byte-identical copies of this block.
//   ARID GATE (the dry-side mirror of the cold gate): rain-fed crops FAIL in the
//   desert. Hyper-arid land (m < 0.12 — Sahara/Arabia/Australian-interior core)
//   yields ~0, ramping to full by m ≈ 0.30 (semi-arid steppe is marginal, not
//   dead). Without it the moisture bell floored dry land at ~0.27, so deserts
//   read as prime farmland. The alluvial bonus still threads GREEN RIBBONS
//   through the sand (Nile/Indus/Murray, oasis coasts).
function envGate(climate, t, m, e, coast, rm, bDist, floodFraction=1, irrigated=false) {
  const aridGate = Math.min(1, Math.max(0, (m - 0.12) / 0.18));
  let crop = climate * (irrigated ? 1 : aridGate);
  // Tropical lateritic-soil penalty (the Amazon/Congo paradox), discounted by
  // young soil (volcanic/orogenic near plate boundaries, alluvial, coastal).
  if (t > 0.75 && m > 0.65) {
    let trop = Math.min(1, (t - 0.75) / 0.20) * Math.min(1, (m - 0.65) / 0.20);
    let youngSoil = 0;
    if (bDist != null && bDist < VOLCANIC_FULL_KM) youngSoil += (1 - bDist / VOLCANIC_FULL_KM) * 0.85;
    if (coast) youngSoil += 0.35;
    if (rm >= 3) youngSoil += 0.50 * floodFraction;
    else if (rm >= 2) youngSoil += 0.20 * floodFraction;
    trop *= Math.max(0, 1 - Math.min(1, youngSoil));
    crop *= 1 - 0.65 * trop;
  }
  if (e > 0.30) crop *= Math.max(0, 1 - (e - 0.30) * 2.0);
  // General river / coast alluvial bonus (pull-toward-1, strongest where raw
  // climate is marginal): the Nile/Indus/Mekong breadbaskets.
  let allu = 0;
  if (rm >= 3) allu += 0.45; else if (rm >= 2) allu += 0.22; else if (rm >= 1) allu += 0.08;
  if (coast) allu += 0.15;
  allu *= Math.min(1, Math.max(0, floodFraction));
  // Cold-gate the alluvial pull: this bonus pulls crop TOWARD 1, so applied raw it
  // overrode the cold gate entirely — a frozen great-river valley came out at crop≈0.45
  // and read as prime cropland, settling the Lena/Ob/Yenisei taiga densely (near-empty in
  // reality). The silt is real but worthless when the ground is frozen and the season too
  // short. The gate is GENTLER than the crop bell, though: it must spare COOL-temperate
  // river valleys (the Rhine, Danube, Po, Russian rivers at 0..+10 °C — genuinely prime
  // farmland), so it only bites BELOW freezing — full at/above 0 °C (t≥0.60), gone by
  // ~−10 °C (t≈0.50). Warm cradles keep full alluvium; only the boreal north loses it.
  const coldGate = Math.min(1, Math.max(0, (t - 0.50) / 0.10));
  crop = crop + (1 - crop) * Math.min(0.65, allu) * coldGate;
  return Math.max(0, Math.min(1, crop));
}

export function cropSuitability(t, m, e, coast, riverMag, bDist, floodFraction) {
  if (e <= 0) return 0;
  if (e > 0.45) return 0.02;
  const rm = riverMag || 0;
  const tBell = Math.min(1, Math.max(0, (t - 0.57) / 0.13)) * Math.min(1, 1 - dpow(Math.max(0, t - 0.88), 2) * 1.5);
  const mBell = dexp(-((m - 0.45) * (m - 0.45)) / (2 * 0.28 * 0.28));
  if (floodFraction === undefined) return envGate(tBell * mBell, t, m, e, coast, rm, bDist);
  const fraction = Math.min(1, Math.max(0, floodFraction));
  const rainfed = envGate(tBell * mBell, t, m, e, coast, rm, bDist, fraction);
  if (fraction <= 0 || rm < 1) return rainfed;
  const flood = envGate(tBell, t, m, e, coast, rm, bDist, fraction, true);
  return fraction * flood + (1 - fraction) * rainfed;
}

// ── Per-package suitability ───────────────────────────────────────────
// Same tile as cropSuitability() above, but for ONE crop package: the single
// temperate (t,m) bell is swapped for the package's own climate envelope
// (src/cropPackages.js) while every ENVIRONMENT gate is the shared envGate()
// above. So a package inherits all the tuned soil/water realism and differs only
// in WHICH climate it wants. Returns 0..1 × the package's peak yield.
export function cropSuitabilityPkg(pkg, t, m, e, coast, riverMag, bDist, tGrow, mGrow, floodFraction) {
  if (e <= 0) return 0;
  if (e > 0.45) return 0.02 * pkg.yield;
  const rm = riverMag || 0;
  // T.GROW_SEASON: the CLIMATE BELL reads the season the crop grows in (tGrow,
  // mGrow) when supplied; the environmental gates — aridity floor, tropical
  // soil, river alluvium, cold — stay ANNUAL land properties (a river irrigates
  // year-round; a laterite soil is a laterite soil). tGrow undefined ⇒ annual,
  // byte-identical.
  const bell = tGrow !== undefined ? pkgClimateBell(pkg, tGrow, mGrow) : pkgClimateBell(pkg, t, m);
  if (floodFraction === undefined) return envGate(bell, t, m, e, coast, rm, bDist) * pkg.yield;
  const fraction = Math.min(1, Math.max(0, floodFraction));
  const rainfed = envGate(bell, t, m, e, coast, rm, bDist, fraction);
  if (fraction <= 0 || rm < 1) return rainfed * pkg.yield;
  const floodMoisture = pkg.mOpt;
  const floodBell = tGrow !== undefined
    ? pkgClimateBell(pkg, tGrow, floodMoisture)
    : pkgClimateBell(pkg, t, floodMoisture);
  const flood = envGate(floodBell, t, m, e, coast, rm, bDist, fraction, true);
  return (fraction * flood + (1 - fraction) * rainfed) * pkg.yield;
}

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

export function cropSuitability(t, m, e, coast, riverMag, bDist) {
  if (e <= 0) return 0;
  if (e > 0.45) return 0.02;
  const rm = riverMag || 0;
  const tBell = Math.min(1, Math.max(0, (t - 0.57) / 0.13)) * Math.min(1, 1 - Math.pow(Math.max(0, t - 0.88), 2) * 1.5);
  // ARID GATE (the dry-side mirror of the cold gate): rain-fed crops FAIL in the desert.
  // Hyper-arid land (m < 0.12 — the Sahara / Arabia / Australian-interior core) yields ~0,
  // ramping to full suitability by m ≈ 0.30 (semi-arid steppe/savanna is marginal, not dead).
  // Without this the moisture bell floored dry land at ~0.27, so deserts read as prime
  // farmland, filled with villages and got carved into nations. The river/coast alluvial
  // bonus below still threads GREEN RIBBONS through the sand (the Nile/Indus/Murray, oasis
  // coasts), so desert INTERIORS go empty while their watered margins host isolated realms.
  const aridGate = Math.min(1, Math.max(0, (m - 0.12) / 0.18));
  const mBell = Math.exp(-((m - 0.45) * (m - 0.45)) / (2 * 0.28 * 0.28)) * aridGate;
  let crop = tBell * mBell;
  // Tropical lateritic-soil penalty, discounted by young soil (volcanic/orogenic, alluvial).
  if (t > 0.75 && m > 0.65) {
    let trop = Math.min(1, (t - 0.75) / 0.20) * Math.min(1, (m - 0.65) / 0.20);
    let youngSoil = 0;
    if (bDist != null && bDist < 12) youngSoil += (1 - bDist / 12) * 0.85;
    if (coast) youngSoil += 0.35;
    if (rm >= 3) youngSoil += 0.50; else if (rm >= 2) youngSoil += 0.20;
    trop *= Math.max(0, 1 - Math.min(1, youngSoil));
    crop *= 1 - 0.65 * trop;
  }
  if (e > 0.30) crop *= Math.max(0, 1 - (e - 0.30) * 2.0);
  // General river / coast alluvial bonus (pull-toward-1, strongest where raw climate is marginal).
  let allu = 0;
  if (rm >= 3) allu += 0.45; else if (rm >= 2) allu += 0.22; else if (rm >= 1) allu += 0.08;
  if (coast) allu += 0.15;
  crop = crop + (1 - crop) * Math.min(0.65, allu);
  return Math.max(0, Math.min(1, crop));
}

// ── Per-package suitability (SPIKE) ───────────────────────────────────
// Same tile as cropSuitability() above, but for ONE crop package: the single
// temperate (t,m) bell is swapped for the package's own climate envelope
// (src/cropPackages.js) while every ENVIRONMENT gate — aridity, the tropical
// lateritic-soil penalty, the elevation penalty and the river/coast alluvial
// bonus — is reused UNCHANGED. So a package inherits all the tuned soil/water
// realism and differs only in WHICH climate it wants. Returns 0..1 × the
// package's peak yield (rice/maize peak a touch above wheat).
//
// The legacy cropSuitability() above is deliberately left byte-identical so the
// live sim is untouched; the eventual refactor unifies the two by treating the
// old single bell as one more package. Reuses pkgClimateBell (imported at top)
// so there is one source of truth for the envelopes.
export function cropSuitabilityPkg(pkg, t, m, e, coast, riverMag, bDist) {
  if (e <= 0) return 0;
  if (e > 0.45) return 0.02 * pkg.yield;
  const rm = riverMag || 0;
  const aridGate = Math.min(1, Math.max(0, (m - 0.12) / 0.18));
  let crop = pkgClimateBell(pkg, t, m) * aridGate;
  // Tropical lateritic-soil penalty — a SOIL effect, so it applies to every crop
  // (it is what keeps even the tuber zone's raw yield modest), discounted on
  // young volcanic/alluvial/coastal soil exactly as the legacy path.
  if (t > 0.75 && m > 0.65) {
    let trop = Math.min(1, (t - 0.75) / 0.20) * Math.min(1, (m - 0.65) / 0.20);
    let youngSoil = 0;
    if (bDist != null && bDist < 12) youngSoil += (1 - bDist / 12) * 0.85;
    if (coast) youngSoil += 0.35;
    if (rm >= 3) youngSoil += 0.50; else if (rm >= 2) youngSoil += 0.20;
    trop *= Math.max(0, 1 - Math.min(1, youngSoil));
    crop *= 1 - 0.65 * trop;
  }
  if (e > 0.30) crop *= Math.max(0, 1 - (e - 0.30) * 2.0);
  let allu = 0;
  if (rm >= 3) allu += 0.45; else if (rm >= 2) allu += 0.22; else if (rm >= 1) allu += 0.08;
  if (coast) allu += 0.15;
  crop = crop + (1 - crop) * Math.min(0.65, allu);
  return Math.max(0, Math.min(1, crop)) * pkg.yield;
}

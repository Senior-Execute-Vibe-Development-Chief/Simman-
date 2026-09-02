/* V2 M3a DATA PORT
 * source: src/sim/cropPackages.js; deviations: the catalogue is promoted to
 * data/reality/crop-packages.json and gains season minima plus supported
 * biogeographic packages; dexp uses v2 dmath.
 * source commit: 97f51dd7c3a3142bfbb366f2e08491f582367e30
 */
import { dexp } from "../../sim/dmath.ts";
import packageData from "../../../data/reality/crop-packages.json" with { type: "json" };

// The catalogue is data so new crops never require a mechanism branch.
export const CROP_PACKAGES = packageData.packages;

export const CROP_BY_ID = {};
for (const crop of CROP_PACKAGES) CROP_BY_ID[crop.id] = crop;

/** Separable 0..1 climate bell; no geography or state is hidden here. */
export function pkgClimateBell(pkg, t, m) {
  const tTol = pkg.tTolEarly ?? pkg.tTol;
  const dt = (t - pkg.tOpt) / tTol;
  const dm = (m - pkg.mOpt) / pkg.mTol;
  return dexp(-0.5 * dt * dt) * dexp(-0.5 * dm * dm);
}

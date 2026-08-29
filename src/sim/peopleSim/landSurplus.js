// ── Land surplus (Scenario 5 — the tradeable residue after implied countryside) ──
// docs/food-system-design-2026-08-27.md §1.2: rent/tithe is a first claim on the
// harvest; the market sees what is LEFT. Villages and manors are not entities —
// their subsistence and local obligations are modeled as retention on the tile
// (popField density), not as catchment reassignment.
//
// Requires T.MARKET_PULL + T.LAND_SURPLUS. Empire tribute (Egypt→Rome) stays in
// TRIBUTE_OF_LAND + TRIBUTE_UP at collection — not here.

import { T } from "./tuning.js";

// Retention band: sparse fringe keeps ~20% locally (seed/subsistence); dense
// worked countryside keeps up to ~60% (eat + implied manor/church rent).
const RETAIN_AT_SPARSE = 0.20;
const RETAIN_AT_DENSE  = 0.60;

/**
 * Fraction of gross tile harvest that enters the tradeable pool assigned by bid.
 * 1 = all gross harvest is surplus; 0 = none (barren handled by caller).
 */
export function landSurplusFrac(world, ti) {
  if (!(T.MARKET_PULL > 0) || !(T.LAND_SURPLUS > 0)) return 1;

  const { elev } = world;
  if (elev[ti] <= 0) return 0;

  const pf = world.popField;
  if (!pf || pf[ti] <= 0) return 1;   // unpeopled belt: no implied village eating

  const cf = world.capField;
  let fill = 0.35;
  if (cf && cf[ti] > 0) fill = Math.min(1, pf[ti] / cf[ti]);

  const retain = RETAIN_AT_SPARSE + (RETAIN_AT_DENSE - RETAIN_AT_SPARSE) * fill;
  return 1 - retain;
}

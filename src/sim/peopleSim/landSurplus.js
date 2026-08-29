// ── Land surplus (Scenario 5 — the tradeable residue after implied countryside) ──
// docs/food-system-design-2026-08-27.md §1.2: rent/tithe is a first claim on the
// harvest; the market sees what is LEFT. Villages and manors are not entities —
// their eat + local obligations are SUBTRACTED from gross tile production, not
// a fixed fraction of it.
//
// WHY SUBTRACTION, NOT A FRACTION: the Nile carried the same order of farmers
// as marginal European land but vastly MORE gross harvest per tile. A density-
// only fraction makes surplus depend on how many people sit on the tile, not
// on fertility — Egypt's export surplus would fall out wrong. Correct form:
//   surplus = max(0, grossFood(tile) − localTake(people on tile))
// so high-fertility + same people ⇒ large surplus automatically.
//
// GROSS MUST BE THE LEDGER HARVEST, not bare fert×FARM_YIELD. The first cut
// compared mouths to fert×0.035 alone and ignored era/irrigation/harvest-year
// multipliers updateFood applies — dense tiles read surplus 0, farm credit
// vanished, and the unfiltered pastoral term made every city look
// herd-fed (measured 2026-08-29). The settlement-uniform yield stack is folded
// in here; tile irrigation/alluvium still live only in updateFood (conservative:
// surplus is slightly understated on watered land, never overstated).
//
// Pastoral calories use the catchment's mean surplus fraction (tally stamps
// s._terrMeanSurplus) so herds face the same countryside-eats-first rule.
//
// Polity tithe (TRIBUTE_OF_LAND) and empire tribute (TRIBUTE_UP) are parallel
// pipes off field people — not subtracted here. Requires T.MARKET_PULL +
// T.LAND_SURPLUS.

import { T } from "./tuning.js";

// ONE subsistence constant with settlement.js updateFood and entities.js TRIBUTE_OF_LAND.
export const FOOD_PER_PERSON = 0.0030;
// Implied manor/church rent above bare eat on the tile (not the polity tithe).
export const LOCAL_OBLIG_MUL = 1.15;

/**
 * Fraction of gross tile harvest (in fert-weight units at tally time) that
 * enters the tradeable pool. 1 = all gross is surplus; 0 = none.
 * @param grossFertWt  f × falloff × invArea for this tile (tallyTerritory)
 * @param s            owning settlement (yield stack); optional
 */
export function landSurplusFrac(world, ti, grossFertWt, s) {
  if (!(T.MARKET_PULL > 0) || !(T.LAND_SURPLUS > 0)) return 1;
  if (grossFertWt <= 0) return 0;

  const pf = world.popField;
  if (!pf || pf[ti] <= 0) return 1;   // unpeopled belt: all gross is surplus

  const bridge = world._onePopScale;
  if (!(bridge > 0)) return 1;         // census bridge not live yet — don't zero harvest

  let y = T.FARM_YIELD_PER_FERT || 0.035;
  if (s) {
    y *= (s._eraProd || 1);
    if (T.HARVEST_YEARS) y *= (s._harvestYearMul ?? 1);
    else if (world.step < (s._famineUntil || 0)) y *= (s._harvestMul || 1);
    // Army-off-the-land and cash-crop displacement — same terms updateFood uses
    // on the settlement-uniform half of the stack.
    const army = (s.army || 0), pop = Math.max(1, s.people || 1);
    const armyLabor = Math.max(0.15, 1 - (army / pop) * 0.5);
    y *= armyLabor;
    const cashLand = T.SLAVERY ? (s._cashFrac || 0) * 0.5 : 0;
    y *= Math.max(0, 1 - cashLand);
    // Last tick's alluvium / irrigation / workability — without these,
    // floodplain surplus stays understated and farm credit collapses on the
    // densest valleys (the herd-only symptom).
    if (s._alluvium > 0) y *= s._alluvium;
    if (s._irrigation > 0) y *= s._irrigation;
    if (s._workable > 0) y *= s._workable;
  }

  const grossFood = grossFertWt * y;
  const localMouths = pf[ti] * bridge;
  const localTake = localMouths * FOOD_PER_PERSON * LOCAL_OBLIG_MUL;

  if (localTake >= grossFood) return 0;
  return (grossFood - localTake) / grossFood;
}

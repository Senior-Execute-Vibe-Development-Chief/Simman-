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
// Polity tithe (TRIBUTE_OF_LAND) and empire tribute (TRIBUTE_UP) are parallel
// pipes off field people — not subtracted here. Requires T.MARKET_PULL +
// T.LAND_SURPLUS.

import { T } from "./tuning.js";

// ONE subsistence constant with settlement.js updateFood and entities.js TRIBUTE_OF_LAND.
const FOOD_PER_PERSON = 0.0030;
// Implied manor/church rent above bare eat on the tile (not the polity tithe).
const LOCAL_OBLIG_MUL = 1.15;

/**
 * Fraction of gross tile harvest (in fert-weight units at tally time) that
 * enters the tradeable pool. 1 = all gross is surplus; 0 = none.
 * @param grossFertWt  f × falloff × invArea for this tile (tallyTerritory)
 */
export function landSurplusFrac(world, ti, grossFertWt) {
  if (!(T.MARKET_PULL > 0) || !(T.LAND_SURPLUS > 0)) return 1;
  if (grossFertWt <= 0) return 0;

  const pf = world.popField;
  if (!pf || pf[ti] <= 0) return 1;   // unpeopled belt: all gross is surplus

  const bridge = world._onePopScale;
  if (!(bridge > 0)) return 1;         // census bridge not live yet — don't zero harvest

  const yieldPerFert = T.FARM_YIELD_PER_FERT || 0.035;
  const grossFood = grossFertWt * yieldPerFert;

  const localMouths = pf[ti] * bridge;
  const localTake = localMouths * FOOD_PER_PERSON * LOCAL_OBLIG_MUL;

  if (localTake >= grossFood) return 0;
  return (grossFood - localTake) / grossFood;
}

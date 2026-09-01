import {
  PEOPLE_CAPACITY_FLOOR_PER_KM2,
  PEOPLE_FARM_CAPACITY_PER_KM2,
  PEOPLE_FARM_TECHNIQUE_BASE,
  PEOPLE_FARM_TECHNIQUE_GAIN,
  PEOPLE_WATER_ACCESS_GAIN,
} from "../constants";
import { reliefMultiplier, waterAccess } from "./habitability";
import type { PeopleWorld } from "./types";

/**
 * Re-derive carrying capacity from the immutable substrate and the current
 * technique field. Capacity is intentionally not a saved population-like
 * quantity: it is a present environmental consequence, not history.
 */
export function deriveCapacity(world: PeopleWorld): void {
  const substrate = world.substrate;
  const capacity = world.capField;
  for (let cell = 0; cell < world.N; cell++) {
    if (!substrate.landMask[cell]) {
      capacity[cell] = 0;
      continue;
    }
    const fertility = Math.max(0, Math.min(1, substrate.fertility[cell] ?? 0));
    const technique = Math.max(0, Math.min(1, world.technique[cell] ?? 0));
    const access = waterAccess(world, cell);
    const farmed = fertility
      * PEOPLE_FARM_CAPACITY_PER_KM2
      * technique
      * (PEOPLE_FARM_TECHNIQUE_BASE + PEOPLE_FARM_TECHNIQUE_GAIN * technique)
      * (1 + access * PEOPLE_WATER_ACCESS_GAIN)
      * reliefMultiplier(world, cell);
    capacity[cell] = Math.max(
      PEOPLE_CAPACITY_FLOOR_PER_KM2,
      world._foragerCapacity[cell] ?? 0,
      farmed,
    );
  }
}

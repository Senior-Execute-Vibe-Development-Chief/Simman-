import {
  PEOPLE_CAPACITY_FLOOR_PER_KM2,
} from "../constants";
import { packageCapacity } from "./crop";
import type { PeopleWorld } from "./types";

/**
 * Re-derive carrying capacity from the immutable substrate and the current
 * technique field. Capacity is intentionally not a saved population-like
 * quantity: it is a present environmental consequence, not history.
 */
export function deriveCapacity(world: PeopleWorld): void {
  if (world._wasmPeopleKernel) {
    world._wasmPeopleKernel.deriveCapacity();
    return;
  }
  const capacity = world.capField;
  for (const cell of world._landCells) {
    const farmed = packageCapacity(world, cell, world._dominantPackage[cell] ?? 0);
    capacity[cell] = Math.max(
      PEOPLE_CAPACITY_FLOOR_PER_KM2,
      world._foragerCapacity[cell] ?? 0,
      farmed,
    );
  }
}

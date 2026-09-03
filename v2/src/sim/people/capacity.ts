import {
  PEOPLE_CAPACITY_FLOOR_PER_KM2,
} from "../constants";
import { activePackageIndices, dominantPackageOf, packageCapacity } from "./crop";
import type { PeopleWorld } from "./types";

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

/**
 * Re-derive carrying capacity from the immutable substrate and the current
 * population mix. Capacity is intentionally not a saved population-like
 * quantity: it is a present environmental consequence, not history.
 *
 * A cell's capacity is the mixture its people imply: foragers hold the land
 * at the forager density, farmers at their dominant package's farmed
 * density, weighted by the farmed share. An unfarmed cell is forager land
 * even where a package could grow — the farmed capacity opens to a
 * migration source in proportion to the farmers it sends (`pairSpare`),
 * never to foragers passing through.
 */
export function deriveCapacity(world: PeopleWorld): void {
  if (world._wasmPeopleKernel) {
    world._wasmPeopleKernel.deriveCapacity();
    return;
  }
  const capacity = world.capField;
  const active = activePackageIndices(world);
  for (let packed = 0; packed < world._landCells.length; packed++) {
    const cell = world._landCells[packed] ?? 0;
    const dominant = dominantPackageOf(world, packed, active);
    world._dominantPackage[cell] = dominant;
    const farmed = packageCapacity(world, cell, dominant);
    const forager = world._foragerCapacity[cell] ?? 0;
    const share = clamp01(world.technique[cell] ?? 0);
    capacity[cell] = Math.max(
      PEOPLE_CAPACITY_FLOOR_PER_KM2,
      forager + share * (farmed - forager),
    );
  }
}

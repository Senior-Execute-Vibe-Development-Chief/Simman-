import {
  PEOPLE_CAPACITY_FLOOR_PER_KM2,
} from "../constants";
import { CROP_PACKAGES } from "../../ported/worldgen/cropPackages.js";
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
    world._dominantPackage[cell] = dominantPackageOf(world, packed, active);
    capacity[cell] = Math.max(PEOPLE_CAPACITY_FLOOR_PER_KM2, mixtureCapacity(world, cell, packed, active));
  }
}

/**
 * The mixture is the capacity (W8): a cell holds what its people's crops
 * hold — each package at its own farmed capacity weighted by its share of
 * the cell's people, the rest at the forager density. The dominant package
 * is a label the shell paints and the room law prices from a source,
 * nothing else. Both kernels sum the active packages in index order.
 */
export function mixtureCapacity(world: PeopleWorld, cell: number, packed: number, active: readonly number[]): number {
  const forager = world._foragerCapacity[cell] ?? 0;
  const population = Math.max(0, world.people[cell] ?? 0);
  if (population <= 0) return forager;
  let farmedShare = 0;
  let mixture = 0;
  for (const packageIndex of active) {
    const mass = Math.max(0, world.farmers[CROP_PACKAGES[packageIndex]?.id ?? ""]?.[packed] ?? 0);
    if (mass <= 0) continue;
    const share = Math.min(1, mass / population);
    farmedShare += share;
    mixture += share * packageCapacity(world, cell, packageIndex);
  }
  return forager * (1 - clamp01(farmedShare)) + mixture;
}

import {
  CAGE_KNEE_FREE_SHARE,
  MATH_NEGATIVE_ONE,
  PEOPLE_FARM_CAPACITY_PER_KM2,
  PEOPLE_FARM_TECHNIQUE_BASE,
  PEOPLE_FARM_TECHNIQUE_GAIN,
  PEOPLE_FARMED_MARKER_SHARE,
  PEOPLE_WATER_ACCESS_GAIN,
} from "../constants";
import { CROP_PACKAGES } from "../../ported/worldgen/cropPackages.js";
import { wakeTargetStep } from "../horizon";
import type { World } from "../world";
import { activePackageIndices } from "./crop";
import { basinRadiusCells, fillSummedArea, windowSum } from "./technique";
import { asPeopleWorld, type PeopleWorld } from "./types";

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

/**
 * Rendering state for the timeline: the step at which each cell first
 * counted as farmed and the package that farmed it. Kept for the shell's
 * reconstruction and read by the arrival instruments; never saved, never
 * hashed, never read by a pass.
 */
export function recordArrivals(worldInput: World): void {
  const world = asPeopleWorld(worldInput);
  for (let packed = 0; packed < world._landCells.length; packed++) {
    if ((world._arrivalStep[packed] ?? MATH_NEGATIVE_ONE) >= 0) continue;
    const cell = world._landCells[packed] ?? 0;
    if ((world.technique[cell] ?? 0) < PEOPLE_FARMED_MARKER_SHARE) continue;
    world._arrivalStep[packed] = world.step;
    world._arrivalPackage[packed] = world._dominantPackage[cell] ?? 0;
  }
}

/**
 * The best yield any active package can reach in a cell: the only
 * per-package factor of `packageCapacity`, so the room a farmer sees is the
 * cell's capacity expression at that yield. Rebuilt when the active set
 * changes (an ignition), never per step.
 */
function refreshBestYield(world: PeopleWorld): void {
  const active = activePackageIndices(world);
  const digest = active.join(",");
  if (digest === world._bestYieldDigest) return;
  world._bestYieldDigest = digest;
  for (let packed = 0; packed < world._landCells.length; packed++) {
    let best = 0;
    for (const packageIndex of active) {
      if ((world._canGrow[packageIndex]?.[packed] ?? 0) === 0) continue;
      const yieldValue = CROP_PACKAGES[packageIndex]?.yield ?? 1;
      if (yieldValue > best) best = yieldValue;
    }
    world._bestYield[packed] = best;
  }
}

/** The room a farmer sees in a cell: `packageCapacity` at the best active yield, the pair-spare expression with a farmer share of one. */
function farmerRoom(world: PeopleWorld, cell: number, packed: number): number {
  const best = world._bestYield[packed] ?? 0;
  if (best <= 0) return 0;
  const fertility = clamp01(world.substrate.fertility[cell] ?? 0);
  const technique = clamp01(world.technique[cell] ?? 0);
  const access = world._waterAccess[cell] ?? 0;
  return fertility
    * PEOPLE_FARM_CAPACITY_PER_KM2
    * best
    * (PEOPLE_FARM_TECHNIQUE_BASE + PEOPLE_FARM_TECHNIQUE_GAIN * technique)
    * (1 + access * PEOPLE_WATER_ACCESS_GAIN)
    * (world._reliefMult[cell] ?? 0);
}

export interface CagedBasin {
  readonly cell: number;
  readonly freeShare: number;
}

/**
 * The first caged basin: over every basin window centred on a farmed cell
 * (the hearth law's window, through summed-area tables), the free farmable
 * room against the total farmable room. Where the free share falls below
 * the caging knee, people can no longer move away to new land — Carneiro's
 * circumscription, the precondition of M4's taking and therefore the first
 * state from which anything can push back on the people field. The window
 * with the smallest free share is reported; ties fall to the first cell.
 */
export function cagedBasin(worldInput: World): CagedBasin | undefined {
  const world = asPeopleWorld(worldInput);
  refreshBestYield(world);
  const free = world._basinFree;
  const room = world._basinRoom;
  free.fill(0);
  room.fill(0);
  for (let packed = 0; packed < world._landCells.length; packed++) {
    const cell = world._landCells[packed] ?? 0;
    const total = farmerRoom(world, cell, packed);
    if (total <= 0) continue;
    room[cell] = total;
    free[cell] = Math.max(0, total - Math.max(0, world.people[cell] ?? 0));
  }
  fillSummedArea(world, free, world._basinFreeSum);
  fillSummedArea(world, room, world._basinRoomSum);
  const radius = basinRadiusCells(world);
  let cagedCell = MATH_NEGATIVE_ONE;
  let cagedShare = CAGE_KNEE_FREE_SHARE;
  for (let packed = 0; packed < world._landCells.length; packed++) {
    const cell = world._landCells[packed] ?? 0;
    if ((world.technique[cell] ?? 0) < PEOPLE_FARMED_MARKER_SHARE) continue;
    const total = windowSum(world, world._basinRoomSum, cell, radius);
    if (total <= 0) continue;
    const share = windowSum(world, world._basinFreeSum, cell, radius) / total;
    if (share < cagedShare) {
      cagedShare = share;
      cagedCell = cell;
    }
  }
  return cagedCell >= 0 ? { cell: cagedCell, freeShare: cagedShare } : undefined;
}

/**
 * Evaluated after every solve step. The trigger is state — a caged basin —
 * and records the step it first fired at whether or not the world wakes on
 * it (`wake: "never"` keeps solving and still reports it). A chosen epoch
 * wakes the world at that year instead; a chosen year later than the
 * trigger is the player knowingly accepting the solve past its validity,
 * and provenance carries both steps.
 */
export function evaluateWake(world: World): void {
  if (world.phase !== "solve") return;
  if (world.cagedStep < 0) {
    const caged = cagedBasin(world);
    if (caged) {
      world.cagedStep = world.step;
      world.cagedCell = caged.cell;
    }
  }
  const target = wakeTargetStep(world.config);
  const due = target === undefined
    ? world.cagedStep >= 0
    : Number.isFinite(target) && world.step >= target;
  if (!due) return;
  world.phase = "awake";
  world.wakeStep = world.step;
  world.events.push({ step: world.step, kind: "wake", cell: world.cagedCell });
}

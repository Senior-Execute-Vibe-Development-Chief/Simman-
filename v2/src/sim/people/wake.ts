import {
  CAGE_KNEE_FREE_SHARE,
  MATH_NEGATIVE_ONE,
  PEOPLE_FARMED_MARKER_SHARE,
} from "../constants";
import { wakeTargetStep } from "../horizon";
import type { World } from "../world";
import { basinRadiusCells, fillSummedArea, windowSum } from "./technique";
import { asPeopleWorld } from "./types";

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

export interface CagedBasin {
  readonly cell: number;
  readonly freeShare: number;
}

/**
 * The first caged basin (P24 / W32): over every basin window centred on a
 * farmed cell (the hearth law's window, through summed-area tables), the
 * free farmable room against the total farmable room. The room is
 * `capField` — fit, technique, works, water, the land a cell has, the same
 * capacity the growth pass reads — not W5's pair-spare expression at best
 * yield with a farmer share of one. Free is capacity minus people. Where
 * the free share falls below the caging knee, people can no longer move
 * away to new land — Carneiro's circumscription, the precondition of M4's
 * taking. The window with the smallest free share is reported; ties fall
 * to the first cell.
 */
export function cagedBasin(worldInput: World): CagedBasin | undefined {
  const world = asPeopleWorld(worldInput);
  const free = world._basinFree;
  const room = world._basinRoom;
  free.fill(0);
  room.fill(0);
  for (let packed = 0; packed < world._landCells.length; packed++) {
    const cell = world._landCells[packed] ?? 0;
    const total = Math.max(0, world.capField[cell] ?? 0);
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
 *
 * `committed` is false on a solve step no pass fired on, which the solve
 * clock allows once the passes are on their own strides (W12). The search
 * reads people, technique and the room fields, none of which such a step
 * touched, so it is skipped; the chosen epoch is a clock reading and is
 * still checked every step.
 */
export function evaluateWake(world: World, committed = true): void {
  if (world.phase !== "solve") return;
  if (committed && world.cagedStep < 0) {
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

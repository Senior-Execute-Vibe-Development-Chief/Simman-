/**
 * How two adjacent cells are joined (W22). The land/sea bit of a cell says
 * what the cell mostly is; it says nothing about the EDGE between two cells,
 * and at every grid the sim steps a coast, a strait or an island is smaller
 * than the cell it lies in. The crossing table is one byte per edge, baked
 * from the 1-arc-minute source: the high bit says ground runs between the
 * two cells' land, the low seven the width, in source samples, of the
 * widest water channel between the two cells' water — zero where there is
 * none. It is read-only geometry like the shape plane: nothing here changes
 * a cell, an edge only says whether a traveller reaches the far cell by
 * ground, by water, by both, or by neither.
 *
 * Four directions are stored per cell in the router's D8 rose (E, SE, S,
 * SW); the other four are the neighbour's entry for the opposite direction,
 * so each edge is stored once and read from either end.
 */
import {
  CROSSING_LAND_LINK,
  CROSSING_WIDTH_MASK,
} from "../ported/worldgen/crossingData.js";
import {
  CROSSING_ROSE_DX,
  CROSSING_ROSE_DY,
  MATH_NEGATIVE_ONE,
  TRAVEL_PASS_DIRECTIONS,
} from "./constants";

/** The rose index of a unit step, or -1 for a step that is not one of the eight. */
export function crossingDirection(dx: number, dy: number): number {
  for (let direction = 0; direction < CROSSING_ROSE_DX.length; direction++) {
    if (CROSSING_ROSE_DX[direction] === dx && CROSSING_ROSE_DY[direction] === dy) return direction;
  }
  return MATH_NEGATIVE_ONE;
}

/**
 * The table index of the edge leaving `cell` by the unit step (dx, dy), or -1
 * off the top or bottom of the grid. East-west wraps.
 */
export function crossingIndex(
  width: number,
  height: number,
  cell: number,
  dx: number,
  dy: number,
): number {
  const direction = crossingDirection(dx, dy);
  if (direction < 0) return MATH_NEGATIVE_ONE;
  const y = Math.floor(cell / width);
  const targetY = y + dy;
  if (targetY < 0 || targetY >= height) return MATH_NEGATIVE_ONE;
  if (direction < TRAVEL_PASS_DIRECTIONS) return cell * TRAVEL_PASS_DIRECTIONS + direction;
  const x = cell - y * width;
  const targetX = (x + dx + width) % width;
  const target = targetY * width + targetX;
  return target * TRAVEL_PASS_DIRECTIONS + direction - TRAVEL_PASS_DIRECTIONS;
}

/** The edge byte leaving `cell` by (dx, dy); zero (no ground, no water) off the grid. */
export function crossingAt(
  crossings: Uint8Array,
  width: number,
  height: number,
  cell: number,
  dx: number,
  dy: number,
): number {
  const index = crossingIndex(width, height, cell, dx, dy);
  return index < 0 ? 0 : (crossings[index] ?? 0);
}

export function crossingHasGround(byte: number): boolean {
  return (byte & CROSSING_LAND_LINK) !== 0;
}

/** Water width in source samples; `CROSSING_WIDTH_MASK` means open water. */
export function crossingWaterWidth(byte: number): number {
  return byte & CROSSING_WIDTH_MASK;
}

export function crossingIsOpenWater(byte: number): boolean {
  return (byte & CROSSING_WIDTH_MASK) === CROSSING_WIDTH_MASK;
}

/**
 * The table a grid has when nothing finer than its own mask was measured:
 * two land cells share ground and no water, and an edge touching a water
 * cell is open water with no ground. That is exactly the rule every consumer
 * applied before the table existed, so a preset without a bake is unchanged.
 */
export function fallbackCrossings(landMask: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height * TRAVEL_PASS_DIRECTIONS);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const cell = y * width + x;
      for (let direction = 0; direction < TRAVEL_PASS_DIRECTIONS; direction++) {
        const targetY = y + (CROSSING_ROSE_DY[direction] ?? 0);
        if (targetY < 0 || targetY >= height) continue;
        const targetX = (x + (CROSSING_ROSE_DX[direction] ?? 0) + width) % width;
        const target = targetY * width + targetX;
        out[cell * TRAVEL_PASS_DIRECTIONS + direction] = landMask[cell] && landMask[target]
          ? CROSSING_LAND_LINK
          : CROSSING_WIDTH_MASK;
      }
    }
  }
  return out;
}

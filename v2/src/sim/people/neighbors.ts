import {
  CROSSING_ROSE_DX,
  CROSSING_ROSE_DY,
  CROSSING_SAMPLE_KM,
  MATH_HALF,
  MATH_NEGATIVE_ONE,
  PEOPLE_COASTAL_HOP_KM,
  PEOPLE_CROP_NEIGHBOR_COUNT,
  PEOPLE_NEIGHBOR_DX,
  PEOPLE_NEIGHBOR_DY,
  PEOPLE_NEIGHBOR_OPPOSITE,
  TRAVEL_COASTAL_KM_PER_DAY,
  TRAVEL_PASS_DIRECTIONS,
  TRAVEL_SLOPE_COST_FACTOR,
} from "../constants";
import {
  crossingAt,
  crossingHasGround,
  crossingIsOpenWater,
  crossingWaterWidth,
} from "../crossings";
import { migrationEdgeLengths } from "../travel/cost";
import type { PeopleWorld } from "./types";

export interface PeopleNeighborTable {
  readonly targets: Int32Array;
  readonly distanceKm: Float64Array;
  /** 0 = land/foot edge, 1 = coastal water hop. */
  readonly mode: Uint8Array;
  /** The height a land step climbs, elevation units: |Δmean| + 2 × the pass
   * climb above the higher mean (W24, the router's own term); 0 on a hop. */
  readonly ascent: Float64Array;
}

function edgeLengthKm(
  world: PeopleWorld,
  from: number,
  to: number,
  horizontal: Float64Array,
  vertical: number,
): number {
  const fromY = Math.floor(from / world.width);
  const toY = Math.floor(to / world.width);
  const fromX = from - fromY * world.width;
  const toX = to - toY * world.width;
  const rawDx = Math.abs(fromX - toX);
  const dx = Math.min(rawDx, world.width - rawDx);
  const dy = Math.abs(fromY - toY);
  const eastWest = dx * ((horizontal[fromY] ?? 0) + (horizontal[toY] ?? 0)) * MATH_HALF;
  const northSouth = dy * vertical;
  return Math.sqrt(eastWest * eastWest + northSouth * northSouth);
}

/**
 * The walk of one stencil step (W26's tables; W24 gave the front the W21
 * proxy): four directions are stored per cell, E, SE, S, SW in the router's
 * rose; the other four are the neighbour's entry for the opposite direction,
 * whose ascent back is this step's ascent. Returns the walk's length and the
 * metres it climbs in this direction, or null where the edge carries none.
 */
function walkOf(world: PeopleWorld, from: number, to: number, direction: number): { km: number; ascent: number } | null {
  const dx = PEOPLE_NEIGHBOR_DX[direction] ?? 0;
  const dy = PEOPLE_NEIGHBOR_DY[direction] ?? 0;
  let rose = 0;
  for (let index = 0; index < CROSSING_ROSE_DX.length; index++) {
    if (CROSSING_ROSE_DX[index] === dx && CROSSING_ROSE_DY[index] === dy) { rose = index; break; }
  }
  const stored = rose < TRAVEL_PASS_DIRECTIONS;
  const slot = stored
    ? from * TRAVEL_PASS_DIRECTIONS + rose
    : to * TRAVEL_PASS_DIRECTIONS + rose - TRAVEL_PASS_DIRECTIONS;
  const km = world.substrate.walkKm[slot] ?? 0;
  if (km <= 0) return null;
  const ascent = (stored ? world.substrate.walkAscent[slot] : world.substrate.walkDescent[slot]) ?? 0;
  return { km, ascent };
}

/** The edge byte of one stencil step, read from the crossing table (W22). */
function edgeByte(world: PeopleWorld, from: number, direction: number): number {
  return crossingAt(
    world.substrate.crossings,
    world.width,
    world.height,
    from,
    PEOPLE_NEIGHBOR_DX[direction] ?? 0,
    PEOPLE_NEIGHBOR_DY[direction] ?? 0,
  );
}

/**
 * The water one step over an edge actually crosses. Open water is the whole
 * lattice edge, as it always was. Where the source measured a channel
 * narrower than that between the two cells — a strait the raster is too
 * coarse to hold as a cell of its own — the step crosses the channel, a
 * kilometre or two, and not a cell edge of open sea (W18, now read from the
 * table instead of a carve's record). The term can refuse a hop, never
 * invent one: a channel can only be narrower than the edge it lies on.
 */
function stepKm(
  world: PeopleWorld,
  from: number,
  to: number,
  byte: number,
  horizontal: Float64Array,
  vertical: number,
): number {
  const edge = edgeLengthKm(world, from, to, horizontal, vertical);
  if (crossingIsOpenWater(byte)) return edge;
  return Math.min(edge, crossingWaterWidth(byte) * CROSSING_SAMPLE_KM);
}

function stepCell(
  world: PeopleWorld,
  cell: number,
  direction: number,
): number {
  const y = Math.floor(cell / world.width);
  const x = cell - y * world.width;
  const targetY = y + (PEOPLE_NEIGHBOR_DY[direction] ?? 0);
  if (targetY < 0 || targetY >= world.height) return MATH_NEGATIVE_ONE;
  const targetX = (x + (PEOPLE_NEIGHBOR_DX[direction] ?? 0) + world.width) % world.width;
  return targetY * world.width + targetX;
}

function addHop(
  world: PeopleWorld,
  cell: number,
  direction: number,
  horizontal: Float64Array,
  vertical: number,
): { readonly target: number; readonly distanceKm: number } {
  let previous = cell;
  let distance = 0;
  const maxSteps = Math.max(world.width, world.height);
  for (let step = 0; step < maxSteps; step++) {
    const next = stepCell(world, previous, direction);
    if (next < 0) return { target: MATH_NEGATIVE_ONE, distanceKm: 0 };
    // Every step of the hop is over water the source says is there.
    const byte = edgeByte(world, previous, direction);
    if (crossingWaterWidth(byte) === 0) return { target: MATH_NEGATIVE_ONE, distanceKm: 0 };
    distance += stepKm(world, previous, next, byte, horizontal, vertical);
    if (world.substrate.landMask[next]) {
      if (next === cell || distance > PEOPLE_COASTAL_HOP_KM) {
        return { target: MATH_NEGATIVE_ONE, distanceKm: 0 };
      }
      return { target: next, distanceKm: distance };
    }
    previous = next;
  }
  return { target: MATH_NEGATIVE_ONE, distanceKm: 0 };
}

/**
 * Build the immutable 8-neighbour relation used by both migration and
 * farmer-contact adoption. Adjacent land joined by ground uses the true edge
 * length; a water run — a run of water cells, or a channel between two land
 * cells whose ground does not meet — is represented by one coastal hop priced
 * later at coastal days/km (W22).
 */
export function buildPeopleNeighborTable(world: PeopleWorld): PeopleNeighborTable {
  const landCount = world._landCells.length;
  const targets = new Int32Array(landCount * PEOPLE_CROP_NEIGHBOR_COUNT);
  const distanceKm = new Float64Array(landCount * PEOPLE_CROP_NEIGHBOR_COUNT);
  const mode = new Uint8Array(landCount * PEOPLE_CROP_NEIGHBOR_COUNT);
  const ascent = new Float64Array(landCount * PEOPLE_CROP_NEIGHBOR_COUNT);
  targets.fill(MATH_NEGATIVE_ONE);
  const lengths = migrationEdgeLengths(world.substrate);
  const horizontal = lengths.horizontal;
  const vertical = lengths.vertical;
  for (let packed = 0; packed < landCount; packed++) {
    const cell = world._landCells[packed] ?? 0;
    for (let direction = 0; direction < PEOPLE_CROP_NEIGHBOR_COUNT; direction++) {
      const slot = packed * PEOPLE_CROP_NEIGHBOR_COUNT + direction;
      const adjacent = stepCell(world, cell, direction);
      if (adjacent < 0) continue;
      const byte = edgeByte(world, cell, direction);
      if (world.substrate.landMask[adjacent]) {
        if (crossingHasGround(byte)) {
          targets[slot] = adjacent;
          // The step is the measured walk where one was baked (W26): its
          // length and the metres it climbs this way (Naismith: the descent
          // is free); else the straight geometry and the rise between the
          // two means, as the router falls back too.
          const walk = walkOf(world, cell, adjacent, direction);
          if (walk) {
            distanceKm[slot] = walk.km;
            ascent[slot] = walk.ascent;
          } else {
            distanceKm[slot] = edgeLengthKm(world, cell, adjacent, horizontal, vertical);
            ascent[slot] = Math.max(0, (world.substrate.elevation[adjacent] ?? 0) - (world.substrate.elevation[cell] ?? 0));
          }
          continue;
        }
        // Two land cells whose ground does not meet: the far bank is reached
        // over the channel between them, if there is one narrow enough.
        if (crossingWaterWidth(byte) === 0) continue;
        const channelKm = stepKm(world, cell, adjacent, byte, horizontal, vertical);
        if (channelKm > PEOPLE_COASTAL_HOP_KM) continue;
        targets[slot] = adjacent;
        distanceKm[slot] = channelKm;
        mode[slot] = 1;
        continue;
      }
      const hop = addHop(world, cell, direction, horizontal, vertical);
      if (hop.target < 0) continue;
      targets[slot] = hop.target;
      distanceKm[slot] = hop.distanceKm;
      mode[slot] = 1;
    }
  }
  return { targets, distanceKm, mode, ascent };
}

export function neighborSlot(direction: number): number {
  return PEOPLE_NEIGHBOR_OPPOSITE[direction] ?? 0;
}

export function coastalHopCost(distanceKm: number): number {
  return distanceKm / TRAVEL_COASTAL_KM_PER_DAY;
}

/** The days a land step costs: the target's days/km over the distance, plus
 * the climb at the router's Naismith rate (W24). Both kernels spell it so. */
export function landStepCost(daysPerKm: number, distanceKm: number, ascent: number): number {
  return daysPerKm * distanceKm + ascent * TRAVEL_SLOPE_COST_FACTOR;
}


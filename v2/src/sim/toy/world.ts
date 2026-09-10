/**
 * Seed the M4 toy world so politics is immediately visible:
 * dense farmed valleys (caged) and a lighter farmed plain (open exit).
 *
 * Peaks sit above COMMUNITY_BAR_PERSONS; hinterland is farmed but under the
 * bar so it joins the nearest seat — catchments span several cells at the
 * toy's 12 km edge.
 */

import {
  CAGE_KNEE_FREE_SHARE,
  COMMUNITY_BAR_PERSONS,
  FOOD_RATION_TONNES_PER_PERSON_YEAR,
  HORIZON_OPENING_YEAR,
  MONTHS_PER_YEAR,
  TOY_CELL_EDGE_KM,
} from "../constants";
import { stepTaking } from "../politics";
import type { PeopleWorld } from "../people/types";
import { World } from "../world";
import { buildToySubstrate } from "./substrate";

export interface ToySeedInfo {
  readonly westValleyCells: number;
  readonly eastValleyCells: number;
  readonly plainCells: number;
}

/**
 * Seat peaks — dense enough to mint communities; hinterland fills under them.
 * Spaced ~3–4 cells apart so catchments share borders (tribute needs adjacency).
 */
const WEST_PEAKS: ReadonlyArray<readonly [number, number]> = [
  [25, 52], [28, 55], [31, 58], [25, 58], [31, 52],
];
const EAST_PEAKS: ReadonlyArray<readonly [number, number]> = [
  [69, 49], [72, 52], [75, 55], [69, 55], [75, 49],
];
const PLAIN_PEAKS: ReadonlyArray<readonly [number, number]> = [
  [47, 52], [50, 55], [53, 58], [47, 58], [53, 52],
];

function inWestValley(x: number, y: number): boolean {
  const dx = x - 28;
  const dy = y - 55;
  return dx * dx + dy * dy <= 14 * 14 && y >= 40 && y <= 78;
}

function inEastValley(x: number, y: number): boolean {
  const dx = x - 72;
  const dy = y - 52;
  return dx * dx + dy * dy <= 12 * 12 && y >= 38 && y <= 75;
}

function inPlainBelt(x: number, y: number): boolean {
  return y >= 42 && y <= 70 && x >= 42 && x <= 58;
}

function nearestPeakDist2(
  x: number,
  y: number,
  peaks: ReadonlyArray<readonly [number, number]>,
): number {
  let best = Number.POSITIVE_INFINITY;
  for (const [px, py] of peaks) {
    const dx = x - px;
    const dy = y - py;
    const d2 = dx * dx + dy * dy;
    if (d2 < best) best = d2;
  }
  return best;
}

function applyToyCellScale(world: World): void {
  const area = TOY_CELL_EDGE_KM * TOY_CELL_EDGE_KM;
  for (let cell = 0; cell < world.N; cell++) {
    world.cellAreaKm2[cell] = area;
  }
}

function seedStores(world: PeopleWorld): void {
  const land = world._landCells;
  for (let packed = 0; packed < land.length; packed++) {
    const cell = land[packed] ?? 0;
    if ((world.technique[cell] ?? 0) < 1) continue;
    const x = cell % world.width;
    const y = Math.floor(cell / world.width);
    const valley = inWestValley(x, y) || inEastValley(x, y);
    const floor = (valley ? 24 : 8) * FOOD_RATION_TONNES_PER_PERSON_YEAR;
    if ((world.store[cell] ?? 0) < floor) world.store[cell] = floor;
  }
}

/**
 * Create an awake toy world with farmed people, stores, and capacities set
 * so the west/east valleys are caged and the central plain is not.
 */
export function createToyWorld(seed = 7): { world: World; info: ToySeedInfo } {
  const substrate = buildToySubstrate(seed);
  const world = new World({
    seed,
    grid: "toy",
    config: {
      peopleKernel: "ts",
      wake: HORIZON_OPENING_YEAR,
    },
    substrate,
  }) as PeopleWorld;

  if (world.phase !== "awake") {
    world.phase = "awake";
    world.wakeStep = 0;
  }

  applyToyCellScale(world);

  let westValleyCells = 0;
  let eastValleyCells = 0;
  let plainCells = 0;
  const land = world._landCells;
  // Mass targets: seats clear the bar; hinterland stays under it.
  const seatMass = COMMUNITY_BAR_PERSONS * 2.4;
  const hinterMass = COMMUNITY_BAR_PERSONS * 0.55;

  for (let packed = 0; packed < land.length; packed++) {
    const cell = land[packed] ?? 0;
    const x = cell % world.width;
    const y = Math.floor(cell / world.width);
    world.people[cell] = 0;
    world.technique[cell] = 0;
    world.store[cell] = 0;
    world.capField[cell] = 0;

    const west = inWestValley(x, y);
    const east = inEastValley(x, y);
    const plain = inPlainBelt(x, y);
    if (!west && !east && !plain) continue;

    const area = Math.max(1, world.cellAreaKm2[cell] ?? 1);
    const peaks = west ? WEST_PEAKS : east ? EAST_PEAKS : PLAIN_PEAKS;
    const d2 = nearestPeakDist2(x, y, peaks);
    const isPeak = d2 === 0;
    const nearPeak = d2 <= 3 * 3; // hinterland within ~3 cells of a seat
    if (!isPeak && !nearPeak) continue;

    const mass = isPeak ? seatMass : hinterMass;
    const density = mass / area;
    // Capacity: valleys packed (caged exit); plain roomy (open exit).
    if (west || east) {
      world.capField[cell] = density / (1 - CAGE_KNEE_FREE_SHARE * 0.5);
      world.store[cell] = 24 * FOOD_RATION_TONNES_PER_PERSON_YEAR;
      if (west) westValleyCells++;
      else eastValleyCells++;
    } else {
      world.capField[cell] = density / 0.45;
      world.store[cell] = 8 * FOOD_RATION_TONNES_PER_PERSON_YEAR;
      plainCells++;
    }
    world.people[cell] = density;
    world.technique[cell] = 1;
  }

  world.step = 0;
  world.events = [];
  // Playground cadence: a longer taking window so raids/tribute show up
  // on the first paint without changing TAKING_RAID_RATE_PER_YEAR.
  stepTaking(world, MONTHS_PER_YEAR * 20);

  return {
    world,
    info: { westValleyCells, eastValleyCells, plainCells },
  };
}

/** Advance the toy one display-year of taking (and the calendar). */
export function stepToyYear(world: World): void {
  world.step += MONTHS_PER_YEAR;
  world.calendarMonth = (world.calendarMonth + MONTHS_PER_YEAR) % MONTHS_PER_YEAR;
  seedStores(world as PeopleWorld);
  world.events = [];
  // Same stretched window as create — one click should usually fire raids.
  stepTaking(world, MONTHS_PER_YEAR * 20);
}

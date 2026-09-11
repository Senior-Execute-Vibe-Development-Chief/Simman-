/**
 * Seed the M4 toy world on a real Nile-mouth Earth crop:
 * farm the floodplain (not the river channel, not the open desert),
 * so caged delta seats and open-fringe seats show tribute vs plunder.
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
import { buildNileCropSubstrate } from "./nileCrop.generated";

export interface ToySeedInfo {
  readonly farmedCells: number;
  readonly cagedCells: number;
  readonly openCells: number;
  readonly skippedRiverCells: number;
}

/** Cells with this much flow are the Nile channel — not farmed seats. */
const RIVER_CHANNEL_FLOW = 40;
/** Floodplain / fertility bar for farmable land on the crop. */
const FARM_FLOODPLAIN = 0.08;
const FARM_FERTILITY = 0.22;
/** Hinterland radius (cells) around a seat on the toy grid. */
const HINTER_CELLS = 3;
/** How many local-max seats to mint along the floodplain. */
const SEAT_COUNT = 14;

function applyToyCellScale(world: World): void {
  const area = TOY_CELL_EDGE_KM * TOY_CELL_EDGE_KM;
  for (let cell = 0; cell < world.N; cell++) {
    world.cellAreaKm2[cell] = area;
  }
}

function isRiverChannel(world: World, cell: number): boolean {
  const rivers = world.substrate?.rivers;
  if (!rivers) return false;
  return (rivers.flowAccum[cell] ?? 0) > RIVER_CHANNEL_FLOW
    || (rivers.magnitude[cell] ?? 0) >= 2;
}

function isFarmable(world: World, cell: number): boolean {
  if (!(world.substrate?.landMask[cell])) return false;
  if (isRiverChannel(world, cell)) return false;
  const flood = world.substrate?.floodplain[cell] ?? 0;
  const fert = world.substrate?.fertility[cell] ?? 0;
  return flood >= FARM_FLOODPLAIN || fert >= FARM_FERTILITY;
}

function farmScore(world: World, cell: number): number {
  const flood = world.substrate?.floodplain[cell] ?? 0;
  const fert = world.substrate?.fertility[cell] ?? 0;
  const moist = world.substrate?.moisture[cell * MONTHS_PER_YEAR] ?? 0;
  return flood * 2 + fert + moist * 0.25;
}

/** Pick the strongest local floodplain maxima as community seats. */
function pickSeats(world: World): number[] {
  const width = world.width;
  const candidates: { cell: number; score: number }[] = [];
  for (let cell = 0; cell < world.N; cell++) {
    if (!isFarmable(world, cell)) continue;
    const score = farmScore(world, cell);
    if (score <= 0) continue;
    const x = cell % width;
    const y = (cell / width) | 0;
    let localMax = true;
    for (let dy = -1; dy <= 1 && localMax; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= world.height) continue;
        const other = ny * width + nx;
        if (!isFarmable(world, other)) continue;
        if (farmScore(world, other) > score) {
          localMax = false;
          break;
        }
      }
    }
    if (localMax) candidates.push({ cell, score });
  }
  candidates.sort((a, b) => b.score - a.score || a.cell - b.cell);
  const seats: number[] = [];
  for (const row of candidates) {
    if (seats.length >= SEAT_COUNT) break;
    const tooClose = seats.some((seat) => {
      const ax = seat % width;
      const ay = (seat / width) | 0;
      const bx = row.cell % width;
      const by = (row.cell / width) | 0;
      const dx = ax - bx;
      const dy = ay - by;
      return dx * dx + dy * dy < 4 * 4;
    });
    if (tooClose) continue;
    seats.push(row.cell);
  }
  return seats;
}

function nearestSeatDist2(cell: number, seats: readonly number[], width: number): number {
  const x = cell % width;
  const y = (cell / width) | 0;
  let best = Number.POSITIVE_INFINITY;
  for (const seat of seats) {
    const sx = seat % width;
    const sy = (seat / width) | 0;
    const dx = x - sx;
    const dy = y - sy;
    const d2 = dx * dx + dy * dy;
    if (d2 < best) best = d2;
  }
  return best;
}

function seedStores(world: PeopleWorld): void {
  const land = world._landCells;
  for (let packed = 0; packed < land.length; packed++) {
    const cell = land[packed] ?? 0;
    if ((world.technique[cell] ?? 0) < 1) continue;
    if (isRiverChannel(world, cell)) continue;
    const flood = world.substrate?.floodplain[cell] ?? 0;
    const floor = (flood >= FARM_FLOODPLAIN ? 24 : 8) * FOOD_RATION_TONNES_PER_PERSON_YEAR;
    if ((world.store[cell] ?? 0) < floor) world.store[cell] = floor;
  }
}

/**
 * Create an awake toy world on the Nile crop with farmed floodplain people.
 */
export function createToyWorld(seed = 7): { world: World; info: ToySeedInfo } {
  const substrate = buildNileCropSubstrate(seed);
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

  // Keep Earth fields for the map; square the cells so a day's-walk spans tiles.
  applyToyCellScale(world);

  let farmedCells = 0;
  let cagedCells = 0;
  let openCells = 0;
  let skippedRiverCells = 0;
  const land = world._landCells;
  const seats = pickSeats(world);
  const seatSet = new Set(seats);
  const seatMass = COMMUNITY_BAR_PERSONS * 2.4;
  const hinterMass = COMMUNITY_BAR_PERSONS * 0.55;
  const hinterR2 = HINTER_CELLS * HINTER_CELLS;
  // Caged seats: on the floodplain or beside the channel. Fringe seats stay
  // open. Whole hinterland must match — community exit averages free-share.
  const cagedSeatSet = new Set(
    seats.filter((seat) => {
      const flood = world.substrate?.floodplain[seat] ?? 0;
      const flow = world.substrate?.rivers.flowAccum[seat] ?? 0;
      return flood >= FARM_FLOODPLAIN || flow >= 12;
    }),
  );

  for (let packed = 0; packed < land.length; packed++) {
    const cell = land[packed] ?? 0;
    world.people[cell] = 0;
    world.technique[cell] = 0;
    world.store[cell] = 0;
    world.capField[cell] = 0;

    if (isRiverChannel(world, cell)) {
      skippedRiverCells++;
      continue;
    }
    if (!isFarmable(world, cell)) continue;

    const d2 = nearestSeatDist2(cell, seats, world.width);
    const isPeak = seatSet.has(cell);
    if (!isPeak && d2 > hinterR2) continue;

    const area = Math.max(1, world.cellAreaKm2[cell] ?? 1);
    const mass = isPeak ? seatMass : hinterMass;
    const density = mass / area;
    // Which seat owns this hinterland cell?
    let ownerSeat = -1;
    let bestD2 = Number.POSITIVE_INFINITY;
    const width = world.width;
    const x = cell % width;
    const y = (cell / width) | 0;
    for (const seat of seats) {
      const sx = seat % width;
      const sy = (seat / width) | 0;
      const dx = x - sx;
      const dy = y - sy;
      const dd = dx * dx + dy * dy;
      if (dd < bestD2) {
        bestD2 = dd;
        ownerSeat = seat;
      }
    }
    const caged = ownerSeat >= 0 && cagedSeatSet.has(ownerSeat);
    if (caged) {
      world.capField[cell] = density / (1 - CAGE_KNEE_FREE_SHARE * 0.5);
      world.store[cell] = 24 * FOOD_RATION_TONNES_PER_PERSON_YEAR;
      cagedCells++;
    } else {
      world.capField[cell] = density / 0.45;
      world.store[cell] = 8 * FOOD_RATION_TONNES_PER_PERSON_YEAR;
      openCells++;
    }
    world.people[cell] = density;
    world.technique[cell] = 1;
    farmedCells++;
  }

  world.step = 0;
  world.events = [];
  stepTaking(world, MONTHS_PER_YEAR * 20);

  return {
    world,
    info: { farmedCells, cagedCells, openCells, skippedRiverCells },
  };
}

/** Advance the toy one display-year of taking (and the calendar). */
export function stepToyYear(world: World): void {
  world.step += MONTHS_PER_YEAR;
  world.calendarMonth = (world.calendarMonth + MONTHS_PER_YEAR) % MONTHS_PER_YEAR;
  seedStores(world as PeopleWorld);
  world.events = [];
  stepTaking(world, MONTHS_PER_YEAR * 20);
}

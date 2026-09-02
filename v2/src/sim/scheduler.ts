import {
  DEG_TO_RAD,
  EARTH_CIRCUMFERENCE_KM,
  EARTH_HALF_DEGREES,
  EARTH_MERIDIONAL_KM,
  MONTHS_PER_YEAR,
  PEOPLE_GROWTH_STRIDE_MONTHS,
  PEOPLE_MIGRATION_DIFFUSIVITY_KM2_PER_YEAR,
  PEOPLE_MIGRATION_MAX_SHARE,
  TRAVEL_HALF,
} from "./constants";
import { dcos } from "./dmath";
import type { World } from "./world";

export interface PassSchedule {
  readonly name: string;
  readonly stride: number;
  readonly phase: number;
}

const DEFAULT_PHASE = 0;
const SCHEDULE_NAMES = [
  "people.technique",
  "people.conversion",
  "people.capacity",
  "people.growth",
  "people.migration",
  "people.cohorts",
] as const;

function positiveInteger(value: unknown, fallback: number): number {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number >= 1 ? Math.max(1, Math.floor(number)) : fallback;
}

function phaseFor(world: World, name: string, stride: number): number {
  const key = `${name}Phase`;
  const configured = world.config[key];
  const phase = typeof configured === "number" ? configured : Number(configured);
  if (!Number.isFinite(phase)) return DEFAULT_PHASE;
  const normalized = phase % stride;
  return normalized < 0 ? normalized + stride : normalized;
}

/**
 * A cadence check is deliberately centralized. The phase is a month on the
 * single world clock, not an additional clock owned by a pass.
 */
export function passFires(
  world: Pick<World, "step">,
  schedule: Pick<PassSchedule, "stride" | "phase">,
): boolean {
  const stride = positiveInteger(schedule.stride, 1);
  const phase = ((schedule.phase % stride) + stride) % stride;
  return ((world.step - phase) % stride + stride) % stride === 0;
}

export function passDtMonths(schedule: Pick<PassSchedule, "stride">): number {
  return positiveInteger(schedule.stride, 1);
}

function cellAreaAtRow(width: number, height: number, row: number): number {
  const northSouth = EARTH_MERIDIONAL_KM / height;
  const latitude = (
    EARTH_HALF_DEGREES * TRAVEL_HALF
      - ((row + TRAVEL_HALF) / height) * EARTH_HALF_DEGREES
  ) * DEG_TO_RAD;
  const eastWest = EARTH_CIRCUMFERENCE_KM / width * Math.max(0, dcos(latitude));
  return northSouth * eastWest;
}

/**
 * Return the uncapped one-firing diffusion share. The analytic migration
 * kernel substeps when this exceeds the stability bound; cadence derivation
 * must inspect the uncapped value or it would incorrectly bless an unstable
 * annual firing merely because the fallback substep hid it.
 */
export function migrationRawShareForArea(area: number, dtMonths: number): number {
  const safeArea = Math.max(1, area);
  return PEOPLE_MIGRATION_DIFFUSIVITY_KM2_PER_YEAR
    * dtMonths / MONTHS_PER_YEAR / safeArea;
}

function derivedMigrationStride(world: World, growthStride: number): number {
  const override = world.config.peopleMigrationStride;
  if (override !== undefined) return positiveInteger(override, 1);

  const divisors: number[] = [];
  for (let stride = 1; stride <= growthStride; stride++) {
    if (growthStride % stride === 0) divisors.push(stride);
  }
  divisors.sort((left, right) => right - left);
  const peopled = world.substrate
    ? (world as unknown as { _peopledMask?: Uint8Array })._peopledMask
    : undefined;
  for (const stride of divisors) {
    let valid = true;
    for (let row = 0; row < world.height; row++) {
      let rowIsPeopled = peopled === undefined;
      if (peopled) {
        const first = row * world.width;
        const last = first + world.width;
        for (let cell = first; cell < last; cell++) {
          if (peopled[cell] === 1) {
            rowIsPeopled = true;
            break;
          }
        }
      }
      const configuredArea = world.cellAreaKm2?.[row * world.width] ?? 0;
      const area = configuredArea > 0
        ? configuredArea
        : cellAreaAtRow(world.width, world.height, row);
      if (rowIsPeopled && migrationRawShareForArea(area, stride) > PEOPLE_MIGRATION_MAX_SHARE) {
        valid = false;
        break;
      }
    }
    if (valid) return stride;
  }
  return 1;
}

function scheduleEntry(world: World, name: string, stride: number): PassSchedule {
  return Object.freeze({
    name,
    stride,
    phase: phaseFor(world, name, stride),
  });
}

/**
 * Resolve once per world. The order is the dependency order: technique and
 * capacity feed growth, growth feeds migration, and cohorts close the commit.
 */
export function resolveSchedule(world: World): readonly PassSchedule[] {
  const growthStride = positiveInteger(
    world.config.peopleGrowthStride,
    PEOPLE_GROWTH_STRIDE_MONTHS,
  );
  const migrationStride = derivedMigrationStride(world, growthStride);
  return Object.freeze([
    scheduleEntry(world, SCHEDULE_NAMES[0], growthStride),
    scheduleEntry(world, SCHEDULE_NAMES[1], growthStride),
    scheduleEntry(world, SCHEDULE_NAMES[2], growthStride),
    scheduleEntry(world, SCHEDULE_NAMES[3], growthStride),
    scheduleEntry(world, SCHEDULE_NAMES[4], migrationStride),
    scheduleEntry(world, SCHEDULE_NAMES[5], growthStride),
  ]);
}

export function scheduleDigest(schedule: readonly PassSchedule[]): string {
  return schedule.map(({ name, stride, phase }) => `${name}:${stride}:${phase}`).join("|");
}

export function sameSchedule(
  left: readonly PassSchedule[],
  right: readonly PassSchedule[],
): boolean {
  return scheduleDigest(left) === scheduleDigest(right);
}

/** Calendar wrapping is a clock operation, not a content cadence check. */
export function monthIndex(month: number): number {
  const normalized = month % MONTHS_PER_YEAR;
  return normalized < 0 ? normalized + MONTHS_PER_YEAR : normalized;
}

export function nextMonth(month: number): number {
  return month + 1 === MONTHS_PER_YEAR ? 0 : month + 1;
}

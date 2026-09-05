import {
  DEG_TO_RAD,
  DIFFUSION_MSD_PER_DIFFUSIVITY,
  EARTH_CIRCUMFERENCE_KM,
  EARTH_HALF_DEGREES,
  EARTH_MERIDIONAL_KM,
  MIGRATION_HOP_MEAN_SQUARE_WEIGHT,
  MONTHS_PER_YEAR,
  PEOPLE_ADOPTION_RATE_PER_YEAR,
  PEOPLE_CHILD_AGE_YEARS,
  PEOPLE_FARMER_MOBILITY_KM2_PER_YEAR,
  PEOPLE_GROWTH_FORAGER_FACTOR,
  PEOPLE_GROWTH_STRIDE_MONTHS,
  PEOPLE_GROWTH_TECHNIQUE_GAIN,
  PEOPLE_FORAGER_MOBILITY_KM2_PER_YEAR,
  PEOPLE_MIGRATION_MAX_SHARE,
  PEOPLE_R_GROWTH_PER_YEAR,
  TRAVEL_HALF,
} from "./constants";
import { dcos } from "./dmath";
import type { World } from "./world";

export interface PassSchedule {
  readonly name: string;
  readonly stride: number;
  readonly phase: number;
}

/**
 * The world runs in one of two regimes. SOLVE: before anything pushes back
 * on the people field the only thing that moves is the farming front, and
 * the bounds the passes carry permit multi-year firings; each pass fires on
 * its own stride and foragers grow in place. AWAKE: the monthly regime,
 * from the first caged basin on (W5). The phase is world state — saved,
 * hashed — and nothing reads it except the scheduler and the wake trigger.
 */
export type WorldPhase = "solve" | "awake";

const DEFAULT_PHASE = 0;
const MIGRATION_PASS = "people.migration";
const SCHEDULE_NAMES = [
  "people.technique",
  "people.conversion",
  "people.capacity",
  "people.growth",
  MIGRATION_PASS,
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
 * The mean square length of one hop out of a cell on this row, in km2 (W12).
 *
 * A hop lands on one of eight neighbours: two at the row's east-west
 * spacing, two at the north-south spacing, four on the diagonal at the root
 * of their squares. Averaged, that is `0.75 * (h_ew^2 + h_ns^2)` — one and
 * a half times the cell area where the cell is square, and increasingly
 * more than that toward the poles, where cells narrow east-west but keep
 * their height. The row's north-south spacing is a grid property; its
 * east-west spacing follows from the cell's area.
 *
 * Row geometry, so it lives with the other row geometry: both the share the
 * migration pass takes and the stride the scheduler derives are expressed
 * through it, and they must be the same expression or the cadence would
 * bless a firing the pass then has to cap.
 */
export function meanSquareHopKm2(areaKm2: number, height: number): number {
  const northSouth = EARTH_CIRCUMFERENCE_KM / (2 * height);
  const eastWest = Math.max(1, areaKm2) / northSouth;
  return MIGRATION_HOP_MEAN_SQUARE_WEIGHT * (eastWest * eastWest + northSouth * northSouth);
}

function rowArea(world: World, row: number): number {
  const configuredArea = world.cellAreaKm2?.[row * world.width] ?? 0;
  return configuredArea > 0
    ? configuredArea
    : cellAreaAtRow(world.width, world.height, row);
}

/** The rows anyone lives on: the rows foragers can be sources from. */
function peopledRows(world: World): boolean[] {
  const rows: boolean[] = new Array<boolean>(world.height).fill(false);
  const peopled = world.substrate
    ? (world as unknown as { _peopledMask?: Uint8Array })._peopledMask
    : undefined;
  if (!peopled) return rows.fill(true);
  for (let row = 0; row < world.height; row++) {
    const first = row * world.width;
    const last = first + world.width;
    for (let cell = first; cell < last; cell++) {
      if (peopled[cell] === 1) {
        rows[row] = true;
        break;
      }
    }
  }
  return rows;
}

/**
 * The movement stride of the AWAKE regime (W6): the solve regime's own
 * migration stride — the same transport bound, capped by the same reaction
 * bound — rounded down to a multiple of the growth stride, so a movement
 * firing always follows a growth firing in the same month. May exceed a
 * year. Never hand-set.
 */
function derivedMigrationStride(world: World, growthStride: number): number {
  const override = world.config.peopleMigrationStride;
  if (override !== undefined) return positiveInteger(override, 1);
  const { migration } = resolveSolveStrides(world);
  return Math.max(growthStride, Math.floor(migration / growthStride) * growthStride);
}

function scheduleEntry(world: World, name: string, stride: number): PassSchedule {
  return Object.freeze({
    name,
    stride,
    phase: phaseFor(world, name, stride),
  });
}

/**
 * Resolve the AWAKE schedule once per world. The order is the dependency
 * order: technique and capacity feed growth, growth feeds migration, and
 * cohorts close the commit.
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

/** The rows any package can grow on: the rows farmers can be sources from. */
function canGrowRows(world: World): boolean[] {
  const rows: boolean[] = new Array<boolean>(world.height).fill(false);
  const people = world as unknown as { _canGrow?: readonly Uint8Array[]; _landCells?: Int32Array };
  const canGrow = people._canGrow ?? [];
  const landCells = people._landCells;
  if (!landCells) return rows;
  for (let packed = 0; packed < landCells.length; packed++) {
    let grows = false;
    for (const table of canGrow) {
      if ((table[packed] ?? 0) !== 0) {
        grows = true;
        break;
      }
    }
    if (grows) rows[Math.floor((landCells[packed] ?? 0) / world.width)] = true;
  }
  return rows;
}

/**
 * The REACTION bound in years: the coarsest firing over which the passes
 * that write the people field in place keep their per-firing fraction
 * inside the bound the kernel honours — farmer growth, adoption, and
 * cohort ageing. None of the three knows the cell size, so this bound is
 * the same at every grid.
 */
function reactionBoundYears(): number {
  const farmerGrowth = PEOPLE_R_GROWTH_PER_YEAR
    * (PEOPLE_GROWTH_FORAGER_FACTOR + PEOPLE_GROWTH_TECHNIQUE_GAIN);
  return Math.min(
    PEOPLE_MIGRATION_MAX_SHARE / farmerGrowth,
    PEOPLE_MIGRATION_MAX_SHARE / PEOPLE_ADOPTION_RATE_PER_YEAR,
    PEOPLE_MIGRATION_MAX_SHARE * PEOPLE_CHILD_AGE_YEARS,
  );
}

/**
 * The TRANSPORT bound in years: the coarsest firing keeping each group's
 * hop share inside `PEOPLE_MIGRATION_MAX_SHARE` on every row it can be a
 * source from — farmers on can-grow rows, foragers on peopled rows.
 *
 * A firing takes the share `4 * D * dt / <d^2>` (W12), so the bound is
 * `share * <d^2> / (4 * D)`. It is NOT the bound times the substep cap, as
 * it was: substepping is what keeps the explicit scheme stable when a
 * firing is long, not licence to make one longer. A firing moves people at
 * most one cell whatever the share, so the reach a stride can carry
 * saturates at one hop and the 16x allowance bought a slower front and
 * nothing else (QUESTIONS #57). It never showed at the reference grid,
 * whose share sits at a sixtieth of the bound.
 */
function transportBoundYears(world: World): number {
  const farmerRows = canGrowRows(world);
  const foragerRows = peopledRows(world);
  let years = Number.POSITIVE_INFINITY;
  for (let row = 0; row < world.height; row++) {
    if (!farmerRows[row] && !foragerRows[row]) continue;
    const reach = PEOPLE_MIGRATION_MAX_SHARE
      * meanSquareHopKm2(rowArea(world, row), world.height)
      / DIFFUSION_MSD_PER_DIFFUSIVITY;
    if (farmerRows[row]) {
      years = Math.min(years, reach / PEOPLE_FARMER_MOBILITY_KM2_PER_YEAR);
    }
    if (foragerRows[row]) {
      years = Math.min(years, reach / PEOPLE_FORAGER_MOBILITY_KM2_PER_YEAR);
    }
  }
  return years;
}

function wholeYearStride(years: number): number {
  return Math.max(1, Math.floor(years)) * MONTHS_PER_YEAR;
}

export interface SolveStrides {
  /** Every pass that writes the people field where it stands. */
  readonly reaction: number;
  /** The one pass that carries it somewhere else. */
  readonly migration: number;
}

/**
 * The SOLVE strides. Each pass takes the largest whole-year firing inside
 * its OWN bound, as the awake regime's passes already do (W12). One stride
 * for every pass dragged growth, capacity, adoption and cohorts down to
 * migration's bound, which at the shipped grid is three and a half times
 * shorter than theirs; that, not the physics, was the cost of the corrected
 * hop share.
 *
 * Migration is additionally capped at the reaction stride. It transports
 * what reaction wrote, so a transport firing longer than the span over
 * which that field is held fixed integrates a field that no longer exists —
 * and it buys no reach doing so, since a firing moves people at most one
 * cell. At the reference grid the transport bound is over a century and
 * this cap is what binds, so nothing there moves.
 */
export function resolveSolveStrides(world: World): SolveStrides {
  const override = world.config.peopleSolveStride;
  if (override !== undefined) {
    const stride = positiveInteger(override, MONTHS_PER_YEAR);
    return { reaction: stride, migration: stride };
  }
  const reaction = wholeYearStride(reactionBoundYears());
  return {
    reaction,
    migration: Math.min(reaction, wholeYearStride(transportBoundYears(world))),
  };
}

export function resolveSolveSchedule(world: World): readonly PassSchedule[] {
  const { reaction, migration } = resolveSolveStrides(world);
  return Object.freeze(SCHEDULE_NAMES.map((name) => Object.freeze({
    name,
    stride: name === MIGRATION_PASS ? migration : reaction,
    phase: DEFAULT_PHASE,
  })));
}

function greatestCommonDivisor(left: number, right: number): number {
  let larger = Math.max(0, Math.floor(left));
  let smaller = Math.max(0, Math.floor(right));
  while (smaller > 0) {
    const remainder = larger % smaller;
    larger = smaller;
    smaller = remainder;
  }
  return larger;
}

/**
 * How far the SOLVE clock advances per world step: the largest advance that
 * lands exactly on every pass's cadence, which is the greatest common
 * divisor of the strides on it. The awake regime advances by a month
 * because its content is seasonal; the solve regime has no season — its
 * conductance is the annual mean — so it advances by whole years, and since
 * every solve stride is a whole number of years the clock never runs finer
 * than one. A step on which nothing is due costs the cadence check and
 * nothing else; rounding a pass's stride to the clock instead would set the
 * growth cadence from migration's bound, which has nothing to do with it.
 */
export function solveClockMonths(schedule: readonly PassSchedule[]): number {
  let clock = 0;
  for (const entry of schedule) {
    clock = greatestCommonDivisor(clock, positiveInteger(entry.stride, 1));
  }
  return Math.max(1, clock);
}

/** The coarsest solve firing: the span a frame of the solve should cover. */
export function solveSpanMonths(schedule: readonly PassSchedule[]): number {
  let span = 1;
  for (const entry of schedule) span = Math.max(span, positiveInteger(entry.stride, 1));
  return span;
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

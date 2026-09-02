import {
  BYTE_MASK,
  DEV_GRID_HEIGHT,
  DEV_GRID_WIDTH,
  HASH_HEX_WIDTH,
  HASH_MASK,
  HASH_NUMBER_BYTES,
  HASH_RADIX,
  HASH_OFFSET_BASIS,
  HASH_PRIME,
  TARGET_GRID_HEIGHT,
  TARGET_GRID_WIDTH,
} from "./constants";
import { ConservationLedger } from "./conservation";
import { allocateFields, fieldEntries, type NumericField } from "./fields";
import type { Substrate } from "./substrate";
import { initializePeople, stepPeople } from "./people/index";
import type { HearthState } from "./people/types";
import { resolveSchedule, type PassSchedule, nextMonth } from "./scheduler";

export type GridPreset = "dev" | "target";

export interface GridDimensions {
  readonly width: number;
  readonly height: number;
}

export interface WorldOptions {
  readonly seed: number;
  readonly grid: GridPreset;
  readonly config?: Readonly<Record<string, string | number | boolean>>;
  readonly substrate?: Substrate;
}

export interface WorldConfig extends Record<string, string | number | boolean> {
  readonly seed: number;
  readonly grid: GridPreset;
  readonly width: number;
  readonly height: number;
}

export interface WorldDebug {
  ticks: number;
  conservationChecks: number;
  peoplePasses: Record<string, number>;
  peopleBirths: number;
  peopleDeaths: number;
  peopleMigration: number;
}

export class World {
  readonly seed: number;
  readonly grid: GridPreset;
  readonly width: number;
  readonly height: number;
  readonly N: number;
  readonly config: WorldConfig;
  readonly schedule: readonly PassSchedule[];
  readonly ledger: ConservationLedger;
  readonly debug: WorldDebug;
  readonly substrate?: Substrate;
  people!: Float64Array;
  technique!: Float64Array;
  children!: Float64Array;
  working!: Float64Array;
  elders!: Float64Array;
  peopleInitialized = false;
  hearths: HearthState[] = [];
  cellAreaKm2: Float64Array;
  capField: Float64Array;
  step = 0;
  calendarMonth = 0;

  constructor(options: WorldOptions) {
    const dimensions = dimensionsFor(options.grid);
    this.seed = options.seed >>> 0;
    this.grid = options.grid;
    this.width = dimensions.width;
    this.height = dimensions.height;
    this.N = this.width * this.height;
    if (options.substrate
      && (options.substrate.width !== this.width || options.substrate.height !== this.height)) {
      throw new Error("World grid and substrate dimensions must match.");
    }
    this.substrate = options.substrate;
    this.config = {
      ...(options.config ?? {}),
      seed: this.seed,
      grid: this.grid,
      width: this.width,
      height: this.height,
    };
    this.ledger = new ConservationLedger();
    this.debug = {
      ticks: 0,
      conservationChecks: 0,
      peoplePasses: {},
      peopleBirths: 0,
      peopleDeaths: 0,
      peopleMigration: 0,
    };
    this.cellAreaKm2 = new Float64Array(this.N);
    this.capField = new Float64Array(this.N);
    if (this.substrate) initializePeople(this);
    else allocateFields(this as unknown as Record<string, unknown>, this.N);
    this.schedule = resolveSchedule(this);
  }
}

export function dimensionsFor(grid: GridPreset): GridDimensions {
  if (grid === "dev") return { width: DEV_GRID_WIDTH, height: DEV_GRID_HEIGHT };
  return { width: TARGET_GRID_WIDTH, height: TARGET_GRID_HEIGHT };
}

export function stepWorld(world: World): void {
  if (world.substrate) stepPeople(world);
  world.step++;
  world.calendarMonth = nextMonth(world.calendarMonth);
  world.debug.ticks++;
}

export function runSteps(world: World, steps: number): void {
  for (let index = 0; index < steps; index++) stepWorld(world);
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}

const hashNumberBuffer = new ArrayBuffer(HASH_NUMBER_BYTES);
const hashNumberView = new DataView(hashNumberBuffer);

function hashByte(hash: bigint, value: number): bigint {
  return ((hash ^ BigInt(value)) * HASH_PRIME) & HASH_MASK;
}

function hashText(hash: bigint, text: string): bigint {
  let result = hash;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    result = hashByte(result, code & BYTE_MASK);
    result = hashByte(result, code >>> 8);
  }
  return result;
}

function hashNumber(hash: bigint, value: number): bigint {
  hashNumberView.setFloat64(0, value, true);
  let result = hash;
  for (let index = 0; index < hashNumberView.byteLength; index++) {
    result = hashByte(result, hashNumberView.getUint8(index));
  }
  return result;
}

function hashField(hash: bigint, field: NumericField): bigint {
  let result = hash;
  for (let index = 0; index < field.length; index++) {
    result = hashNumber(result, field[index] ?? 0);
  }
  return result;
}

/** Stable 64-bit FNV-1a identity over config, step, and every declared field. */
export function hashWorld(world: World): string {
  let hash = HASH_OFFSET_BASIS;
  // Kernel selection and its dispatch width are execution details, not world
  // state. Excluding them makes the TS oracle and the wasm drop-in share one
  // identity while preserving every physical/configuration input.
  const identityConfig = Object.fromEntries(
    Object.entries(world.config)
      .filter(([key]) => (
        key !== "peopleKernel" && key !== "peopleWorkers" && key !== "peopleThreads"
      )),
  );
  hash = hashText(hash, stableStringify(identityConfig));
  hash = hashText(hash, stableStringify({ schedule: world.schedule }));
  hash = hashNumber(hash, world.step);
  hash = hashNumber(hash, world.calendarMonth);
  hash = hashText(hash, stableStringify({
    peopleInitialized: world.peopleInitialized,
    hearths: world.hearths,
  }));
  for (const { definition, field } of fieldEntries(world as unknown as Record<string, unknown>)) {
    hash = hashText(hash, definition.name);
    hash = hashNumber(hash, field.length);
    hash = hashField(hash, field);
  }
  return hash.toString(HASH_RADIX).padStart(HASH_HEX_WIDTH, "0");
}

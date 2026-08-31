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
  MONTHS_PER_YEAR,
  PLACEHOLDER_NOISE_AMPLITUDE,
  PLACEHOLDER_NOISE_DECAY,
  PLACEHOLDER_NOISE_FREQUENCY,
  PLACEHOLDER_STEP_PHASE,
  TARGET_GRID_HEIGHT,
  TARGET_GRID_WIDTH,
} from "./constants";
import { ConservationLedger } from "./conservation";
import { allocateFields, fieldEntries, type NumericField } from "./fields";
import { dsin } from "./dmath";
import { passRng } from "../ported/rng";

export type GridPreset = "dev" | "target";

export interface GridDimensions {
  readonly width: number;
  readonly height: number;
}

export interface WorldOptions {
  readonly seed: number;
  readonly grid: GridPreset;
  readonly config?: Readonly<Record<string, string | number | boolean>>;
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
}

export class World {
  readonly seed: number;
  readonly grid: GridPreset;
  readonly width: number;
  readonly height: number;
  readonly N: number;
  readonly config: WorldConfig;
  readonly ledger: ConservationLedger;
  readonly debug: WorldDebug;
  noise!: Float64Array;
  step = 0;
  calendarMonth = 0;

  constructor(options: WorldOptions) {
    const dimensions = dimensionsFor(options.grid);
    this.seed = options.seed >>> 0;
    this.grid = options.grid;
    this.width = dimensions.width;
    this.height = dimensions.height;
    this.N = this.width * this.height;
    this.config = {
      ...(options.config ?? {}),
      seed: this.seed,
      grid: this.grid,
      width: this.width,
      height: this.height,
    };
    this.ledger = new ConservationLedger();
    this.debug = { ticks: 0, conservationChecks: 0 };
    allocateFields(this as unknown as Record<string, unknown>, this.N);
  }
}

export function dimensionsFor(grid: GridPreset): GridDimensions {
  if (grid === "dev") return { width: DEV_GRID_WIDTH, height: DEV_GRID_HEIGHT };
  return { width: TARGET_GRID_WIDTH, height: TARGET_GRID_HEIGHT };
}

/**
 * M0 placeholder tick. It is intentionally not simulation physics: it only
 * proves that a deterministic pass can read RNG, write dmath output through
 * the balance sheet, and advance the world without allocating field buffers.
 */
export function stepWorld(world: World): void {
  const field = world.noise;
  if (!(field instanceof Float64Array)) throw new Error("The placeholder field is unavailable.");

  world.ledger.beginPass(
    "placeholder.noise",
    field,
    "placeholder.input",
    "placeholder.decay",
  );
  const random = passRng(world.seed, "m0.placeholder", world.step);
  const phase = random();
  const signal = dsin(
    phase
    + world.step * PLACEHOLDER_NOISE_FREQUENCY
    + world.step * PLACEHOLDER_STEP_PHASE,
  );
  let sourceAmount = 0;
  let sinkAmount = 0;
  for (let index = 0; index < field.length; index++) {
    const oldValue = field[index] ?? 0;
    const nextValue = oldValue * PLACEHOLDER_NOISE_DECAY
      + signal * PLACEHOLDER_NOISE_AMPLITUDE;
    field[index] = nextValue;
    const delta = nextValue - oldValue;
    if (delta >= 0) sourceAmount += delta;
    else sinkAmount -= delta;
  }
  world.ledger.endPass("placeholder.noise", field, sourceAmount, sinkAmount);
  world.ledger.assertAll();
  world.debug.conservationChecks++;
  world.step++;
  world.calendarMonth = (world.calendarMonth + 1) % MONTHS_PER_YEAR;
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
  hash = hashText(hash, stableStringify(world.config));
  hash = hashNumber(hash, world.step);
  hash = hashNumber(hash, world.calendarMonth);
  for (const { definition, field } of fieldEntries(world as unknown as Record<string, unknown>)) {
    hash = hashText(hash, definition.name);
    hash = hashNumber(hash, field.length);
    hash = hashField(hash, field);
  }
  return hash.toString(HASH_RADIX).padStart(HASH_HEX_WIDTH, "0");
}

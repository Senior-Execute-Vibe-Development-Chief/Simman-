import {
  BYTE_MASK,
  DEV_GRID_HEIGHT,
  DEV_GRID_WIDTH,
  HASH_HEX_WIDTH,
  HASH_LANE_SEED,
  HASH_NUMBER_BYTES,
  HASH_RADIX,
  HASH_OFFSET_BASIS,
  HASH_PRIME,
  HASH_WORD_BYTES,
  MATH_NEGATIVE_ONE,
  TARGET_GRID_HEIGHT,
  TARGET_GRID_WIDTH,
} from "./constants";
import { ConservationLedger } from "./conservation";
import { allocateFields, fieldEntries, type NumericField } from "./fields";
import type { Substrate } from "./substrate";
import { initializePeople, stepPeople } from "./people/index";
import { evaluateWake, recordArrivals } from "./people/wake";
import type { HearthState } from "./people/types";
import { wakeTargetStep } from "./horizon";
import {
  monthIndex,
  nextMonth,
  resolveSchedule,
  resolveSolveSchedule,
  resolveSolveStride,
  type PassSchedule,
  type WorldPhase,
} from "./scheduler";

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

/** The append-only event log: hearth ignitions and the wake, the first world content it holds. */
export interface WorldEvent {
  readonly step: number;
  readonly kind: "hearth" | "wake";
  readonly cell: number;
  readonly packageId?: string;
}

export class World {
  readonly seed: number;
  readonly grid: GridPreset;
  readonly width: number;
  readonly height: number;
  readonly N: number;
  readonly config: WorldConfig;
  /** The monthly regime's schedule; the solve regime's is every pass at the solve stride. */
  readonly awakeSchedule: readonly PassSchedule[];
  readonly solveStride: number;
  readonly solveSchedule: readonly PassSchedule[];
  readonly ledger: ConservationLedger;
  readonly debug: WorldDebug;
  readonly substrate?: Substrate;
  people!: Float64Array;
  technique!: Float64Array;
  children!: Float64Array;
  working!: Float64Array;
  elders!: Float64Array;
  /** Authoritative per-package farmer masses; allocated by the people layer. */
  farmers: Record<string, Float64Array> = {};
  peopleInitialized = false;
  hearths: HearthState[] = [];
  cellAreaKm2: Float64Array;
  capField: Float64Array;
  step = 0;
  calendarMonth = 0;
  /** SOLVE before anything pushes back on the people field; AWAKE from the first caged basin (W5). */
  phase: WorldPhase = "awake";
  /** The step the monthly regime began at, −1 while the world still solves. */
  wakeStep = MATH_NEGATIVE_ONE;
  /** The first step at which a basin window was caged, −1 until then; the cell its window is centred on. */
  cagedStep = MATH_NEGATIVE_ONE;
  cagedCell = MATH_NEGATIVE_ONE;
  events: WorldEvent[] = [];

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
    this.awakeSchedule = resolveSchedule(this);
    this.solveStride = resolveSolveStride(this);
    this.solveSchedule = resolveSolveSchedule(this, this.solveStride);
    // A world without a substrate has nothing to solve; a peopled world
    // opens in the solve regime unless its chosen epoch is the opening.
    if (this.substrate) {
      const target = wakeTargetStep(this.config);
      if (target === undefined || target > 0) {
        this.phase = "solve";
      } else {
        this.phase = "awake";
        this.wakeStep = 0;
      }
    }
  }

  /** The schedule of the current regime. */
  get schedule(): readonly PassSchedule[] {
    return this.phase === "solve" ? this.solveSchedule : this.awakeSchedule;
  }
}

export function dimensionsFor(grid: GridPreset): GridDimensions {
  if (grid === "dev") return { width: DEV_GRID_WIDTH, height: DEV_GRID_HEIGHT };
  return { width: TARGET_GRID_WIDTH, height: TARGET_GRID_HEIGHT };
}

/**
 * The months one solve step advances: the solve stride, or the remainder
 * to a chosen epoch so the world wakes at exactly that year.
 */
export function solveStepMonths(world: World): number {
  const target = wakeTargetStep(world.config);
  if (target !== undefined && Number.isFinite(target)) {
    return Math.max(1, Math.min(world.solveStride, target - world.step));
  }
  return world.solveStride;
}

export function stepWorld(world: World): void {
  if (world.substrate && world.phase === "solve") {
    const dtMonths = solveStepMonths(world);
    stepPeople(world, dtMonths);
    world.step += dtMonths;
    world.calendarMonth = monthIndex(world.calendarMonth + dtMonths);
    world.debug.ticks++;
    recordArrivals(world);
    evaluateWake(world);
    return;
  }
  if (world.substrate) stepPeople(world);
  world.step++;
  world.calendarMonth = nextMonth(world.calendarMonth);
  world.debug.ticks++;
  if (world.substrate) recordArrivals(world);
}

export function runSteps(world: World, steps: number): void {
  for (let index = 0; index < steps; index++) stepWorld(world);
}

/** Run whichever regime the world is in until its clock reaches `step`; crosses the wake if it lies inside. */
export function runUntil(world: World, step: number): void {
  while (world.step < step) stepWorld(world);
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
const hashNumberBytes = new Uint8Array(hashNumberBuffer);

/**
 * Two 32-bit FNV-1a lanes over 32-bit words, carried as a pair of uint32s.
 * The previous identity was 64-bit FNV-1a over every byte in BigInt
 * arithmetic — 5.5 s per target-grid hash, which made the parity harness
 * spend nine of its thirteen CI minutes hashing (review, 2026-09-03). Word
 * lanes in Math.imul run the same walk in tens of milliseconds. Typed-array
 * bytes are consumed in platform order, which is little-endian on every
 * supported host and inside wasm.
 */
interface HashState { a: number; b: number; }

function hashWord(state: HashState, word: number): void {
  state.a = Math.imul(state.a ^ word, HASH_PRIME) >>> 0;
  state.b = Math.imul(state.b ^ Math.imul(word, HASH_LANE_SEED), HASH_PRIME) >>> 0;
}

function hashByte(state: HashState, value: number): void {
  hashWord(state, value & BYTE_MASK);
}

function hashBytes(state: HashState, bytes: Uint8Array): void {
  const words = Math.floor(bytes.byteLength / HASH_WORD_BYTES);
  if (bytes.byteOffset % HASH_WORD_BYTES === 0) {
    const view = new Uint32Array(bytes.buffer, bytes.byteOffset, words);
    for (let index = 0; index < words; index++) hashWord(state, view[index] ?? 0);
  } else {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let index = 0; index < words; index++) {
      hashWord(state, view.getUint32(index * HASH_WORD_BYTES, true));
    }
  }
  for (let index = words * HASH_WORD_BYTES; index < bytes.byteLength; index++) {
    hashByte(state, bytes[index] ?? 0);
  }
}

function hashText(state: HashState, text: string): void {
  for (let index = 0; index < text.length; index++) hashWord(state, text.charCodeAt(index));
}

function hashNumber(state: HashState, value: number): void {
  hashNumberView.setFloat64(0, value, true);
  hashBytes(state, hashNumberBytes);
}

function hashField(state: HashState, field: NumericField): void {
  hashBytes(state, new Uint8Array(field.buffer, field.byteOffset, field.byteLength));
}

function hashHex(state: HashState): string {
  return state.a.toString(HASH_RADIX).padStart(HASH_HEX_WIDTH, "0")
    + state.b.toString(HASH_RADIX).padStart(HASH_HEX_WIDTH, "0");
}

/** Stable 64-bit FNV-1a identity over config, step, and every declared field. */
export function hashWorld(world: World): string {
  const hash: HashState = { a: HASH_OFFSET_BASIS, b: HASH_OFFSET_BASIS ^ HASH_LANE_SEED };
  // Kernel selection and its dispatch width are execution details, not world
  // state. Excluding them makes the TS oracle and the wasm drop-in share one
  // identity while preserving every physical/configuration input.
  const identityConfig = Object.fromEntries(
    Object.entries(world.config)
      .filter(([key]) => (
        key !== "peopleKernel" && key !== "peopleWorkers" && key !== "peopleThreads"
      )),
  );
  hashText(hash, stableStringify(identityConfig));
  hashText(hash, stableStringify({
    schedule: world.awakeSchedule,
    solveSchedule: world.solveSchedule,
    phase: world.phase,
    wakeStep: world.wakeStep,
    cagedStep: world.cagedStep,
    cagedCell: world.cagedCell,
    events: world.events,
  }));
  hashNumber(hash, world.step);
  hashNumber(hash, world.calendarMonth);
  hashText(hash, stableStringify({
    peopleInitialized: world.peopleInitialized,
    hearths: world.hearths,
  }));
  const peopleState = world as unknown as {
    farmers?: Record<string, Float64Array>;
    _peopledMask?: Uint8Array;
  };
  for (const packageId of Object.keys(peopleState.farmers ?? {}).sort()) {
    const field = peopleState.farmers?.[packageId];
    if (!field) continue;
    hashText(hash, `farmers.${packageId}`);
    hashNumber(hash, field.length);
    hashField(hash, field);
  }
  const hearthYears = (world as unknown as { _hearthYears?: readonly Float64Array[] })._hearthYears ?? [];
  hearthYears.forEach((years, index) => {
    hashText(hash, `hearthYears.${index}`);
    hashNumber(hash, years.length);
    hashField(hash, years);
  });
  if (peopleState._peopledMask) {
    hashText(hash, "peopledMask");
    hashBytes(hash, peopleState._peopledMask);
  }
  for (const { definition, field } of fieldEntries(world as unknown as Record<string, unknown>)) {
    hashText(hash, definition.name);
    hashNumber(hash, field.length);
    hashField(hash, field);
  }
  return hashHex(hash);
}

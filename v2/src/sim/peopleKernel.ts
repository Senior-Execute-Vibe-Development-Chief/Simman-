import init, {
  deterministic_power as wasmDpow,
  PeopleKernel as WasmPeopleKernel,
  wasm_memory as wasmMemory,
} from "../wasm/people/people.js";
import initThreads, {
  PeopleKernel as ThreadedPeopleKernel,
} from "../wasm/people-threads/people.js";
import { fillMeanMigrationDaysPerKm, fillMigrationDaysPerKm, migrationEdgeLengths } from "./travel/cost";
import { landShare } from "./people/habitability";
import type { PeopleWorld } from "./people/types";
import { CROP_PACKAGES } from "../ported/worldgen/cropPackages.js";
import {
  BAND_CONTROL_BAND_COUNT,
  BAND_CONTROL_BANDS_OFFSET,
  BAND_CONTROL_CLAIM,
  BAND_CONTROL_DONE_OFFSET,
  BAND_CONTROL_DT_WORD,
  BAND_CONTROL_KERNEL,
  BAND_CONTROL_OPERATION,
  BAND_CONTROL_PHASE,
  BAND_CONTROL_STOP,
  beginBandPhase,
  createBandControl,
  type BandControl,
  type PeopleBand,
} from "./people/bands";
import {
  MONTHS_PER_YEAR,
  PEOPLE_BAND_COUNT,
  PEOPLE_THREAD_STACK_BYTES,
  PEOPLE_WORKER_ERROR_BYTES,
  PEOPLE_WASM_MEMORY_INITIAL_PAGES,
  PEOPLE_WASM_MEMORY_MAXIMUM_PAGES,
  PEOPLE_WORKER_WAIT_MS,
  PEOPLE_BARRIER_WAIT_MS,
  MATH_NEGATIVE_ONE,
} from "./constants";

let initialized = false;
let initialization: Promise<boolean> | undefined;
// A browser WORKER has no `window` either: testing for it sent the shell's
// sim worker down the Node path (fs.readFile) and silently onto the
// TypeScript kernels for all of W2 (review, W3). Node is Node when it says so.
const IS_NODE = typeof process !== "undefined"
  && typeof (process as { versions?: { node?: string } }).versions?.node === "string";
let threadedInitialized = false;
let threadedMemory: WebAssembly.Memory | undefined;
let threadedModule: WebAssembly.Module | undefined;
type WorkerConstructor = new (url: URL, options?: Record<string, unknown>) => WorkerLike;
let workerConstructor: WorkerConstructor | undefined;
let workerIsNode = false;
const runtimeRegistry = new Set<PeopleKernelRuntimeImpl>();

interface WorkerLike {
  postMessage(message: unknown): void;
  terminate(): void | Promise<number>;
  /** Node only: a pool must never keep the process alive on its own. */
  unref?: () => void;
  addEventListener?: (type: string, listener: (event: MessageEvent) => void) => void;
  on?: (type: string, listener: (message: unknown) => void) => void;
}

interface PeopleKernelLike {
  free(): void;
  kernel_ptr(): number;
  people_ptr(): number;
  peopled_ptr(): number;
  technique_ptr(): number;
  children_ptr(): number;
  working_ptr(): number;
  elders_ptr(): number;
  capacity_ptr(): number;
  people_next_ptr(): number;
  technique_next_ptr(): number;
  children_mass_ptr(): number;
  working_mass_ptr(): number;
  elders_mass_ptr(): number;
  children_next_ptr(): number;
  working_next_ptr(): number;
  elders_next_ptr(): number;
  migration_out_ptr(): number;
  migration_weight_ptr(): number;
  migration_population_ptr(): number;
  migration_received_ptr(): number;
  farmer_ptr(packageIndex: number): number;
  farmer_next_ptr(packageIndex: number): number;
  farmer_total_ptr(): number;
  farmer_total_next_ptr(): number;
  dominant_ptr(): number;
  set_active_packages(mask: Uint8Array): void;
  derive_capacity_band(rawLo: number, rawHi: number): void;
  begin_growth(dtMonths: number): void;
  growth_band(rawLo: number, rawHi: number, bandIndex: number): void;
  births(): number;
  deaths(): number;
  begin_migration(month: number, dtMonths: number, growthPrepared: boolean): void;
  migration_prepare_band(rawLo: number, rawHi: number, bandIndex: number): void;
  migration_source_band(rawLo: number, rawHi: number, bandIndex: number): void;
  migration_debit_band(rawLo: number, rawHi: number): void;
  migration_target_band(rawLo: number, rawHi: number, bandIndex: number): void;
  finish_migration(): void;
  migration_total(): number;
  priced_pairs(): number;
  commit_population(): void;
  commit_farmers(): void;
  normalize_cohorts(): void;
}

type BandOperation =
  | "capacity"
  | "growth"
  | "migration-prepare"
  | "migration-source"
  | "migration-debit"
  | "migration-target";

/** Operation codes written into the control plane; the worker script mirrors this order. */
const BAND_OPERATIONS: readonly BandOperation[] = [
  "capacity",
  "growth",
  "migration-prepare",
  "migration-source",
  "migration-debit",
  "migration-target",
];

// The worker script is plain JS outside the constants ledger; it receives
// the shared-layout constants from here rather than restating them.
const WORKER_LAYOUT = Object.freeze({
  stackBytes: PEOPLE_THREAD_STACK_BYTES,
  waitMs: PEOPLE_BARRIER_WAIT_MS,
  phaseIndex: BAND_CONTROL_PHASE,
  claimIndex: BAND_CONTROL_CLAIM,
  doneOffset: BAND_CONTROL_DONE_OFFSET,
  operationIndex: BAND_CONTROL_OPERATION,
  kernelIndex: BAND_CONTROL_KERNEL,
  bandCountIndex: BAND_CONTROL_BAND_COUNT,
  stopIndex: BAND_CONTROL_STOP,
  dtWord: BAND_CONTROL_DT_WORD,
  bandsOffset: BAND_CONTROL_BANDS_OFFSET,
  operations: BAND_OPERATIONS,
});
// A worker that throws mid-band reports through shared memory: the
// coordinator is blocked in Atomics.wait and can never receive a posted
// message, so a posted error would be a silent hang (review, W3).
const WORKER_ERROR_BYTES = PEOPLE_WORKER_ERROR_BYTES;

class PeopleBandWorkerPool {
  readonly control: BandControl;
  barrierMilliseconds = 0;
  private readonly workers: WorkerLike[];
  private readonly idle: Int32Array;
  private readonly errorFlag: Int32Array;
  private readonly errorText: Uint8Array;
  private readonly dt: Float64Array;

  private constructor(control: BandControl, workers: WorkerLike[], idle: Int32Array, errorStorage: SharedArrayBuffer) {
    this.control = control;
    this.workers = workers;
    this.idle = idle;
    this.errorFlag = new Int32Array(errorStorage, 0, 1);
    this.errorText = new Uint8Array(errorStorage, Int32Array.BYTES_PER_ELEMENT, WORKER_ERROR_BYTES);
    this.dt = new Float64Array(control.words.buffer, BAND_CONTROL_DT_WORD * Int32Array.BYTES_PER_ELEMENT, 1);
  }

  get workerCount(): number {
    return this.workers.length;
  }

  /**
   * Spawn the workers and await their readiness through ordinary message
   * events. Readiness must not be awaited with Atomics.wait: a worker that
   * fails to start reports through an event, and a thread blocked in
   * Atomics.wait can never receive it — the shell's sim worker hung on
   * exactly that (review, W3). Failure resolves to undefined after logging.
   */
  static async create(
    workerCount: number,
    module: WebAssembly.Module,
    memory: WebAssembly.Memory,
    WorkerClass: WorkerConstructor,
    isNode: boolean,
  ): Promise<PeopleBandWorkerPool | undefined> {
    const control = createBandControl(workerCount);
    if (!control.shared || !control.storage) return undefined;
    const idleStorage = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
    const errorStorage = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT + WORKER_ERROR_BYTES);
    const readyStorage = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
    const payload = {
      module,
      memory,
      controlStorage: control.storage,
      readyStorage,
      idleStorage,
      errorStorage,
      ...WORKER_LAYOUT,
    };
    const workers: WorkerLike[] = [];
    const readiness: Array<Promise<void>> = [];
    for (let index = 0; index < control.workerCount; index++) {
      const worker = new WorkerClass(new URL("./peopleWorker.mjs", import.meta.url), {
        type: "module",
        workerData: payload,
      });
      readiness.push(new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`people worker ${index} did not become ready within ${PEOPLE_WORKER_WAIT_MS} ms`)), PEOPLE_WORKER_WAIT_MS);
        const onMessage = (data: unknown): void => {
          const message = data as { type?: string; message?: string } | undefined;
          if (message?.type === "ready") {
            clearTimeout(timer);
            resolve();
          } else if (message?.type === "error") {
            clearTimeout(timer);
            reject(new Error(message.message ?? "worker error"));
          }
        };
        if (isNode) {
          worker.on?.("message", onMessage);
          worker.on?.("error", (error) => reject(error instanceof Error ? error : new Error(String(error))));
        } else {
          worker.addEventListener?.("message", (event) => onMessage(event.data));
          worker.addEventListener?.("error", (event) => reject(new Error(String((event as unknown as { message?: string }).message ?? "worker failed to start"))));
        }
      }));
      if (isNode) worker.unref?.();
      else worker.postMessage({ type: "init", ...payload });
      workers.push(worker);
    }
    try {
      await Promise.all(readiness);
    } catch (error) {
      for (const worker of workers) void worker.terminate();
      console.error("People worker pool unavailable; using serial wasm.", error);
      return undefined;
    }
    return new PeopleBandWorkerPool(control, workers, new Int32Array(idleStorage), errorStorage);
  }

  dispatch(
    operation: BandOperation,
    kernelPointer: number,
    bands: readonly PeopleBand[],
    dtMonths = 1,
  ): void {
    Atomics.store(this.idle, 0, 0);
    // The dispatch descriptor is written BEFORE the phase bump that
    // publishes it; workers read it only after observing the new phase.
    const words = this.control.words;
    Atomics.store(words, BAND_CONTROL_OPERATION, BAND_OPERATIONS.indexOf(operation));
    Atomics.store(words, BAND_CONTROL_KERNEL, kernelPointer);
    Atomics.store(words, BAND_CONTROL_BAND_COUNT, bands.length);
    this.dt[0] = dtMonths;
    bands.forEach((band, index) => {
      Atomics.store(words, BAND_CONTROL_BANDS_OFFSET + index * 2, band.rawLo);
      Atomics.store(words, BAND_CONTROL_BANDS_OFFSET + index * 2 + 1, band.rawHi);
    });
    beginBandPhase(this.control);
    // Short slices: the platform's futex occasionally loses a wakeup
    // (measured ~1 in 1000 barrier rounds on the review runner, with no
    // wasm involved); a slice bounds the cost of a lost wake to ~1 ms
    // where a 10 s slice produced 10 s stalls and, once, a full hang.
    for (let index = 0; index < bands.length; index++) {
      while (Atomics.load(this.control.done, index) === 0) {
        this.throwIfWorkerFailed(operation, index);
        // Every worker has left the claim loop yet this band was never
        // marked done: fail loudly instead of waiting forever.
        // Re-read the flag AFTER seeing every worker idle: a worker sets its
        // last band done and then goes idle, and the two loads are not one
        // atomic step (the first version of this guard fired falsely).
        if (Atomics.load(this.idle, 0) >= this.workers.length
          && Atomics.load(this.control.done, index) === 0) {
          throw new Error(`People band ${index} (${operation}) was never finished: a worker left the phase early.`);
        }
        Atomics.wait(this.control.done, index, 0, PEOPLE_BARRIER_WAIT_MS);
      }
    }
    const barrierStart = performance.now();
    while (Atomics.load(this.idle, 0) < this.workers.length) {
      this.throwIfWorkerFailed(operation, MATH_NEGATIVE_ONE);
      Atomics.wait(this.idle, 0, Atomics.load(this.idle, 0), PEOPLE_BARRIER_WAIT_MS);
    }
    this.barrierMilliseconds += performance.now() - barrierStart;
  }

  private throwIfWorkerFailed(operation: BandOperation, band: number): void {
    if (Atomics.load(this.errorFlag, 0) === 0) return;
    const length = this.errorText.indexOf(0);
    const text = new TextDecoder().decode(this.errorText.subarray(0, length < 0 ? this.errorText.length : length));
    this.dispose();
    throw new Error(`People worker failed during ${operation}${band >= 0 ? ` band ${band}` : ""}: ${text}`);
  }

  dispose(): void {
    // Workers block in Atomics.wait on the phase word; tell them to leave
    // before terminating so no thread dies inside a wasm call.
    Atomics.store(this.control.words, BAND_CONTROL_STOP, 1);
    Atomics.notify(this.control.phase, 0);
    for (const worker of this.workers) void worker.terminate();
    this.workers.length = 0;
  }
}

function kernelArguments(world: PeopleWorld): ConstructorParameters<typeof WasmPeopleKernel> {
  const lengths = migrationEdgeLengths(world.substrate);
  world._migrationEdgeH = lengths.horizontal;
  world._migrationEdgeV = lengths.vertical;
  // Twelve monthly tables and their annual mean at index MONTHS_PER_YEAR,
  // the solve regime's conductance; the mean is computed once here so both
  // kernels read the same numbers.
  const days = new Float64Array(world.N * (MONTHS_PER_YEAR + 1));
  for (let month = 0; month < MONTHS_PER_YEAR; month++) {
    fillMigrationDaysPerKm(
      world.substrate,
      month,
      days.subarray(month * world.N, (month + 1) * world.N),
    );
  }
  fillMeanMigrationDaysPerKm(
    world.substrate,
    days.subarray(MONTHS_PER_YEAR * world.N, (MONTHS_PER_YEAR + 1) * world.N),
  );
  const canGrow = new Uint8Array(CROP_PACKAGES.length * world._landCells.length);
  for (let packageIndex = 0; packageIndex < CROP_PACKAGES.length; packageIndex++) {
    canGrow.set(
      world._canGrow[packageIndex] ?? new Uint8Array(world._landCells.length),
      packageIndex * world._landCells.length,
    );
  }
  // The ground share each capacity law charges (W19), built through the same
  // law the reference kernel calls so both read identical numbers.
  const landShareField = new Float64Array(world.N);
  for (let cell = 0; cell < world.N; cell++) landShareField[cell] = landShare(world, cell);
  const yields = Float64Array.from(CROP_PACKAGES, (pkg) => pkg.yield ?? 1);
  const cropFit = new Float64Array(CROP_PACKAGES.length * world._landCells.length);
  const standingGain = new Float64Array(CROP_PACKAGES.length * world._landCells.length);
  for (let packageIndex = 0; packageIndex < CROP_PACKAGES.length; packageIndex++) {
    cropFit.set(
      world._cropFit[packageIndex] ?? new Float64Array(world._landCells.length),
      packageIndex * world._landCells.length,
    );
    standingGain.set(
      world._standingGain[packageIndex] ?? new Float64Array(world._landCells.length),
      packageIndex * world._landCells.length,
    );
  }
  return [
    world.width,
    world.height,
    world.substrate.landMask,
    world._peopledMask,
    Float64Array.from(world.substrate.fertility),
    world._waterAccess,
    world._reliefMult,
    landShareField,
    world._foragerCapacity,
    world._diseaseBurden,
    world.cellAreaKm2,
    days,
    world._migrationShareRow,
    CROP_PACKAGES.length,
    yields,
    canGrow,
    cropFit,
    standingGain,
    world._neighborTargets,
    world._neighborDistanceKm,
    world._neighborMode,
  ];
}

/**
 * Load the people module once. Node needs bytes because fetch() does not
 * accept file:// URLs; browsers let the generated wasm-bindgen loader fetch
 * the sibling asset. Failure is a deliberate capability result: callers can
 * select the reference TypeScript kernel when wasm is unavailable.
 */
export interface PeopleWasmOptions {
  /** Worker count for the pre-warmed pool; defaults to the machine's spare cores. */
  readonly workers?: number;
}

// One pool per process, sized once and pre-warmed by the loader; kernels
// borrow it (dispatch carries the kernel pointer). Node may still build a
// private pool of another size synchronously (the parity harness does).
let sharedPool: PeopleBandWorkerPool | undefined;

/**
 * The coordinator blocks in Atomics.wait between bands. A browser's main
 * thread may not block, so a world created there (the browser smoke checks
 * do; the shell's worker does not) must run serial wasm rather than throw
 * mid-tick. The probe waits on a value that is already different, which
 * returns "not-equal" at once where waiting is allowed and throws where it
 * is not.
 */
function coordinatorCanWait(): boolean {
  try {
    const probe = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));
    Atomics.wait(probe, 0, 1, 0);
    return true;
  } catch {
    return false;
  }
}

export async function ensurePeopleWasm(options: PeopleWasmOptions = {}): Promise<boolean> {
  if (initialized) return true;
  if (initialization) return initialization;
  initialization = (async () => {
    try {
      const wasmUrl = new URL("../wasm/people/people_bg.wasm", import.meta.url);
      if (IS_NODE) {
        const fs = await import("node:fs/promises");
        await init({ module_or_path: await fs.readFile(wasmUrl) });
      } else {
        await init({ module_or_path: wasmUrl });
      }
      initialized = true;
    } catch (error) {
      // Never fall back silently: the shell reported "TypeScript people
      // fallback" for a whole wave without anyone seeing why (review, W3).
      console.error("People wasm kernel unavailable; using the TypeScript kernels.", error);
      return false;
    }
    try {
      const threadUrl = new URL("../wasm/people-threads/people_bg.wasm", import.meta.url);
      const threadBytes = IS_NODE
        ? await (await import("node:fs/promises")).readFile(threadUrl)
        : new Uint8Array(await (await fetch(threadUrl)).arrayBuffer());
      threadedModule = await WebAssembly.compile(threadBytes);
      threadedMemory = new WebAssembly.Memory({
        initial: PEOPLE_WASM_MEMORY_INITIAL_PAGES,
        maximum: PEOPLE_WASM_MEMORY_MAXIMUM_PAGES,
        shared: true,
      });
      await initThreads({
        module_or_path: threadBytes,
        memory: threadedMemory,
        thread_stack_size: PEOPLE_THREAD_STACK_BYTES,
      });
      if (IS_NODE) {
        const workers = await import("node:worker_threads");
        workerConstructor = workers.Worker as unknown as WorkerConstructor;
        workerIsNode = true;
      } else if (typeof globalThis.Worker === "function"
        && typeof crossOriginIsolated !== "undefined" && crossOriginIsolated
        && coordinatorCanWait()) {
        workerConstructor = globalThis.Worker as unknown as WorkerConstructor;
        workerIsNode = false;
      }
      threadedInitialized = true;
      const requested = Number(options.workers);
      const count = Number.isFinite(requested) && requested >= 1 ? Math.floor(requested) : defaultPeopleWorkers();
      if (count > 1 && workerConstructor) {
        sharedPool = await PeopleBandWorkerPool.create(count, threadedModule, threadedMemory, workerConstructor, workerIsNode);
      }
    } catch (error) {
      // The ordinary wasm module remains a valid capability fallback. The
      // shell reports this as serial wasm instead of claiming worker threads.
      console.error("Threaded people kernel unavailable; using serial wasm.", error);
      threadedInitialized = false;
    }
    return true;
  })();
  return initialization;
}

export function peopleWasmReady(): boolean {
  return initialized;
}

export function peopleThreadsReady(): boolean {
  return threadedInitialized;
}

export function wasmDpowValue(base: number, exponent: number): number {
  if (!initialized) throw new Error("People WASM is not initialized.");
  return wasmDpow(base, exponent);
}

export function defaultPeopleWorkers(): number {
  const concurrency = typeof navigator !== "undefined" && Number.isFinite(navigator.hardwareConcurrency)
    ? navigator.hardwareConcurrency
    : 1;
  return Math.max(1, Math.min(PEOPLE_BAND_COUNT, concurrency - 1));
}

export interface PeopleKernelRuntime {
  readonly workerCount: number;
  readonly usesThreads: boolean;
  readonly barrierMilliseconds: number;
  readonly bands: readonly PeopleBand[];
  readonly control: BandControl;
  deriveCapacity(): void;
  beginGrowth(dtMonths?: number): void;
  grow(): void;
  beginMigration(month: number, dtMonths?: number, growthPrepared?: boolean): void;
  prepareMigration(): void;
  migrateSources(): void;
  debitMigration(): void;
  gatherMigration(): void;
  finishMigration(): void;
  commitPopulation(): void;
  commitFarmers(): void;
  normalizeCohorts(): void;
  dispose(): void;
  births(): number;
  deaths(): number;
  migrationTotal(): number;
  pricedPairs(): number;
}

type KernelFieldName =
  | "people"
  | "technique"
  | "children"
  | "working"
  | "elders"
  | "capField"
  | "_peopleNext"
  | "_techniqueNext"
  | "_childrenMass"
  | "_workingMass"
  | "_eldersMass"
  | "_childrenNext"
  | "_workingNext"
  | "_eldersNext"
  | "_migrationOut"
  | "_migrationWeight"
  | "_migrationPopulation"
  | "_migrationReceived";

class PeopleKernelRuntimeImpl implements PeopleKernelRuntime {
  readonly bands: readonly PeopleBand[];
  readonly control: BandControl;
  readonly workerCount: number;
  readonly usesThreads: boolean;
  private readonly kernel: PeopleKernelLike;
  private readonly workerPool?: PeopleBandWorkerPool;
  private readonly memory: WebAssembly.Memory;
  private memoryBuffer: ArrayBufferLike;
  private memoryBytes: number;
  private readonly world: PeopleWorld;

  constructor(
    world: PeopleWorld,
    workerCount: number,
    kernel: PeopleKernelLike = new WasmPeopleKernel(...kernelArguments(world)),
    memoryOverride?: WebAssembly.Memory,
    workerPool?: PeopleBandWorkerPool,
  ) {
    this.kernel = kernel;
    const memory = memoryOverride ?? wasmMemory() as WebAssembly.Memory;
    if (!(memory instanceof WebAssembly.Memory)) {
      throw new Error("People WASM did not expose linear memory.");
    }
    this.memory = memory;
    this.memoryBuffer = memory.buffer;
    this.memoryBytes = memory.buffer.byteLength;
    this.world = world;
    this.bands = world._peopleBands;
    this.workerCount = Math.max(1, Math.floor(workerCount));
    this.workerPool = workerPool;
    this.usesThreads = workerPool !== undefined;
    this.control = workerPool?.control ?? createBandControl(this.workerCount);
    this.attachFields(world);
    // wasm-bindgen exposes one linear memory for the module. A second world
    // can make the allocator grow while it is being constructed; refresh all
    // existing views at that boundary before any tick can observe them.
    for (const runtime of runtimeRegistry) runtime.refreshViews();
    runtimeRegistry.add(this);
  }

  private assertMemoryStable(): void {
    if (this.memory.buffer.byteLength !== this.memoryBytes) {
      throw new Error("People WASM memory grew during an active kernel phase.");
    }
  }

  private refreshViews(): void {
    this.memoryBuffer = this.memory.buffer;
    this.memoryBytes = this.memoryBuffer.byteLength;
    this.attachFields(this.world);
  }

  private view(pointer: number, length: number): Float64Array {
    return new Float64Array(this.memoryBuffer, pointer, length);
  }

  private byteView(pointer: number, length: number): Uint8Array {
    return new Uint8Array(this.memoryBuffer, pointer, length);
  }

  private attachFields(world: PeopleWorld): void {
    const pointers: Record<KernelFieldName, number> = {
      people: this.kernel.people_ptr(),
      technique: this.kernel.technique_ptr(),
      children: this.kernel.children_ptr(),
      working: this.kernel.working_ptr(),
      elders: this.kernel.elders_ptr(),
      capField: this.kernel.capacity_ptr(),
      _peopleNext: this.kernel.people_next_ptr(),
      _techniqueNext: this.kernel.technique_next_ptr(),
      _childrenMass: this.kernel.children_mass_ptr(),
      _workingMass: this.kernel.working_mass_ptr(),
      _eldersMass: this.kernel.elders_mass_ptr(),
      _childrenNext: this.kernel.children_next_ptr(),
      _workingNext: this.kernel.working_next_ptr(),
      _eldersNext: this.kernel.elders_next_ptr(),
      _migrationOut: this.kernel.migration_out_ptr(),
      _migrationWeight: this.kernel.migration_weight_ptr(),
      _migrationPopulation: this.kernel.migration_population_ptr(),
      _migrationReceived: this.kernel.migration_received_ptr(),
    };
    const fullGrid = new Set<KernelFieldName>([
      "people",
      "technique",
      "children",
      "working",
      "elders",
      "capField",
    ]);
    const target = world as unknown as Record<string, unknown>;
    for (const [name, pointer] of Object.entries(pointers)) {
      target[name] = this.view(pointer, fullGrid.has(name as KernelFieldName)
        ? world.N : world._landCells.length);
    }
    world._peopledMask = this.byteView(this.kernel.peopled_ptr(), world.N);
    world._dominantPackage = this.byteView(this.kernel.dominant_ptr(), world.N);
    world._farmerTotal = this.view(
      this.kernel.farmer_total_ptr(),
      world._landCells.length,
    );
    world._farmerTotalNext = this.view(
      this.kernel.farmer_total_next_ptr(),
      world._landCells.length,
    );
    for (let packageIndex = 0; packageIndex < CROP_PACKAGES.length; packageIndex++) {
      const packageId = CROP_PACKAGES[packageIndex]?.id;
      if (!packageId) continue;
      world.farmers[packageId] = this.view(
        this.kernel.farmer_ptr(packageIndex),
        world._landCells.length,
      );
      world._farmersNext[packageId] = this.view(
        this.kernel.farmer_next_ptr(packageIndex),
        world._landCells.length,
      );
    }
    world._migrationDaysPerKm = new Float64Array(world.N);
    world._migrationDaysPerKmByMonth = new Array(MONTHS_PER_YEAR + 1).fill(undefined);
  }

  private dispatchBands(operation: BandOperation, dtMonths = 1): void {
    if (this.workerPool) {
      this.workerPool.dispatch(operation, this.kernel.kernel_ptr(), this.bands, dtMonths);
      return;
    }
    for (const band of this.bands) {
      if (operation === "capacity") {
        this.kernel.derive_capacity_band(band.rawLo, band.rawHi);
      } else if (operation === "growth") {
        this.kernel.growth_band(band.rawLo, band.rawHi, band.index);
      } else if (operation === "migration-prepare") {
        this.kernel.migration_prepare_band(band.rawLo, band.rawHi, band.index);
      } else if (operation === "migration-source") {
        this.kernel.migration_source_band(band.rawLo, band.rawHi, band.index);
      } else if (operation === "migration-debit") {
        this.kernel.migration_debit_band(band.rawLo, band.rawHi);
      } else {
        this.kernel.migration_target_band(band.rawLo, band.rawHi, band.index);
      }
    }
  }

  /** The active-package mask is oracle state; the kernel reads a copy per pass. */
  private syncActivePackages(): void {
    this.kernel.set_active_packages(this.world._activePackage);
  }

  deriveCapacity(): void {
    this.assertMemoryStable();
    this.syncActivePackages();
    this.dispatchBands("capacity");
  }

  beginGrowth(dtMonths = 1): void {
    this.assertMemoryStable();
    this.syncActivePackages();
    this.kernel.begin_growth(dtMonths);
  }

  grow(): void {
    this.assertMemoryStable();
    this.dispatchBands("growth");
  }

  beginMigration(month: number, dtMonths = 1, growthPrepared = true): void {
    this.assertMemoryStable();
    this.syncActivePackages();
    this.kernel.begin_migration(month, dtMonths, growthPrepared);
  }

  prepareMigration(): void {
    this.assertMemoryStable();
    this.dispatchBands("migration-prepare");
  }

  migrateSources(): void {
    this.assertMemoryStable();
    this.dispatchBands("migration-source");
  }

  debitMigration(): void {
    this.assertMemoryStable();
    this.dispatchBands("migration-debit");
  }

  gatherMigration(): void {
    this.assertMemoryStable();
    this.dispatchBands("migration-target");
  }

  finishMigration(): void {
    this.assertMemoryStable();
    this.kernel.finish_migration();
  }

  commitPopulation(): void {
    this.assertMemoryStable();
    this.kernel.commit_population();
  }

  commitFarmers(): void {
    this.assertMemoryStable();
    this.syncActivePackages();
    this.kernel.commit_farmers();
  }

  normalizeCohorts(): void {
    this.assertMemoryStable();
    this.kernel.normalize_cohorts();
  }

  births(): number {
    return this.kernel.births();
  }

  deaths(): number {
    return this.kernel.deaths();
  }

  migrationTotal(): number {
    return this.kernel.migration_total();
  }

  pricedPairs(): number {
    return this.kernel.priced_pairs();
  }

  get barrierMilliseconds(): number {
    return this.workerPool?.barrierMilliseconds ?? 0;
  }

  dispose(): void {
    runtimeRegistry.delete(this);
    // The pool is a process resource borrowed by kernels, never owned.
    this.kernel.free();
  }
}

export function createPeopleKernel(
  world: PeopleWorld,
  workerCount = 1,
  preferThreads = false,
): PeopleKernelRuntime | undefined {
  if (!peopleWasmReady()) return undefined;
  const count = Math.max(1, Math.floor(workerCount));
  const wantThreads = preferThreads || count > 1;
  const pool = wantThreads && threadedInitialized && threadedMemory
    ? borrowPool(count)
    : undefined;
  if (pool && threadedMemory) {
    let kernel: ThreadedPeopleKernel | undefined;
    try {
      kernel = new ThreadedPeopleKernel(...kernelArguments(world));
      return new PeopleKernelRuntimeImpl(world, count, kernel, threadedMemory, pool);
    } catch (error) {
      kernel?.free();
      console.error("Threaded people kernel unavailable; using serial wasm.", error);
    }
  } else if (wantThreads) {
    console.warn(`People kernel: no worker pool of ${count} is ready (pre-warm one with ensurePeopleWasm({ workers })); using serial wasm.`);
  }
  return new PeopleKernelRuntimeImpl(world, count);
}

/** The pre-warmed pool when its size matches; a pool is a process resource, never disposed by a kernel. */
function borrowPool(count: number): PeopleBandWorkerPool | undefined {
  if (sharedPool && sharedPool.workerCount === count) return sharedPool;
  return undefined;
}

/** Replace the process pool with one of another size (tests and harnesses). */
export async function resizePeoplePool(workers: number): Promise<boolean> {
  if (!threadedInitialized || !threadedModule || !threadedMemory || !workerConstructor) return false;
  const count = Math.max(1, Math.floor(workers));
  if (sharedPool?.workerCount === count) return true;
  sharedPool?.dispose();
  sharedPool = await PeopleBandWorkerPool.create(count, threadedModule, threadedMemory, workerConstructor, workerIsNode);
  return sharedPool !== undefined;
}


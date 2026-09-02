import init, {
  deterministic_power as wasmDpow,
  PeopleKernel as WasmPeopleKernel,
  wasm_memory as wasmMemory,
} from "../wasm/people/people.js";
import initThreads, {
  PeopleKernel as ThreadedPeopleKernel,
} from "../wasm/people-threads/people.js";
import { fillMigrationDaysPerKm, migrationEdgeLengths } from "./travel/cost";
import type { PeopleWorld } from "./people/types";
import {
  beginBandPhase,
  createBandControl,
  fixedPeopleBands,
  type BandControl,
  type PeopleBand,
} from "./people/bands";
import {
  MONTHS_PER_YEAR,
  PEOPLE_BAND_COUNT,
  PEOPLE_THREAD_STACK_BYTES,
  PEOPLE_WASM_MEMORY_INITIAL_PAGES,
  PEOPLE_WASM_MEMORY_MAXIMUM_PAGES,
  PEOPLE_WORKER_WAIT_MS,
  MATH_NEGATIVE_ONE,
} from "./constants";

let initialized = false;
let initialization: Promise<boolean> | undefined;
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
  addEventListener?: (type: string, listener: (event: MessageEvent) => void) => void;
  on?: (type: string, listener: (message: unknown) => void) => void;
}

interface PeopleKernelLike {
  free(): void;
  kernel_ptr(): number;
  set_parallel_reductions(enabled: boolean): void;
  people_ptr(): number;
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
  derive_capacity_band(rawLo: number, rawHi: number): void;
  prepare_technique(): void;
  technique_band(rawLo: number, rawHi: number, dtMonths: number): void;
  commit_technique(): void;
  begin_growth(dtMonths: number): void;
  growth_band(rawLo: number, rawHi: number, bandIndex: number): void;
  births(): number;
  deaths(): number;
  begin_migration(month: number, dtMonths: number, growthPrepared: boolean): void;
  migration_source_band(rawLo: number, rawHi: number, bandIndex: number): void;
  migration_debit_band(rawLo: number, rawHi: number): void;
  migration_target_band(rawLo: number, rawHi: number, bandIndex: number): void;
  finish_migration(): void;
  migration_total(): number;
  commit_population(): void;
  normalize_cohorts(): void;
}

type BandOperation =
  | "capacity"
  | "technique"
  | "growth"
  | "migration-source"
  | "migration-debit"
  | "migration-target";

class PeopleBandWorkerPool {
  readonly control: BandControl;
  barrierMilliseconds = 0;
  private readonly workers: WorkerLike[];
  private readonly ready: Int32Array;
  private readonly idle: Int32Array;

  constructor(
    workerCount: number,
    module: WebAssembly.Module,
    memory: WebAssembly.Memory,
    WorkerClass: WorkerConstructor,
    isNode: boolean,
  ) {
    this.control = createBandControl(workerCount);
    if (!this.control.shared || !this.control.storage) {
      throw new Error("SharedArrayBuffer is unavailable for people workers.");
    }
    const readyStorage = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
    this.ready = new Int32Array(readyStorage);
    const idleStorage = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
    this.idle = new Int32Array(idleStorage);
    this.workers = [];
    for (let index = 0; index < this.control.workerCount; index++) {
      const worker = new WorkerClass(new URL("./peopleWorker.mjs", import.meta.url), {
        type: "module",
        workerData: {
          module,
          memory,
          controlStorage: this.control.storage,
          readyStorage,
          idleStorage,
        },
      });
      worker.addEventListener?.("message", () => undefined);
      worker.on?.("error", (error) => {
        if (Atomics.load(this.ready, 0) >= 0) {
          Atomics.store(this.ready, 0, MATH_NEGATIVE_ONE);
          Atomics.notify(this.ready, 0);
        }
        console.error(error);
      });
      if (!isNode) {
        worker.postMessage({
          type: "init",
          module,
          memory,
          controlStorage: this.control.storage,
          readyStorage,
          idleStorage,
        });
      }
      this.workers.push(worker);
    }
    while (Atomics.load(this.ready, 0) < this.control.workerCount) {
      if (Atomics.load(this.ready, 0) < 0) {
        this.dispose();
        throw new Error("A people worker failed during initialization.");
      }
      Atomics.wait(this.ready, 0, Atomics.load(this.ready, 0), PEOPLE_WORKER_WAIT_MS);
    }
  }

  dispatch(
    operation: BandOperation,
    kernelPointer: number,
    bands: readonly PeopleBand[],
    dtMonths = 1,
  ): void {
    Atomics.store(this.idle, 0, 0);
    beginBandPhase(this.control);
    const message = {
      type: "dispatch",
      operation,
      kernelPointer,
      bands,
      dtMonths,
      phase: Atomics.load(this.control.phase, 0),
    };
    for (const worker of this.workers) worker.postMessage(message);
    for (let index = 0; index < bands.length; index++) {
      while (Atomics.load(this.control.done, index) === 0) {
        Atomics.wait(this.control.done, index, 0, PEOPLE_WORKER_WAIT_MS);
      }
    }
    const barrierStart = performance.now();
    while (Atomics.load(this.idle, 0) < this.workers.length) {
      Atomics.wait(this.idle, 0, Atomics.load(this.idle, 0), PEOPLE_WORKER_WAIT_MS);
    }
    this.barrierMilliseconds += performance.now() - barrierStart;
  }

  dispose(): void {
    for (const worker of this.workers) void worker.terminate();
    this.workers.length = 0;
  }
}

function kernelArguments(world: PeopleWorld): ConstructorParameters<typeof WasmPeopleKernel> {
  const lengths = migrationEdgeLengths(world.substrate);
  world._migrationEdgeH = lengths.horizontal;
  world._migrationEdgeV = lengths.vertical;
  const days = new Float64Array(world.N * MONTHS_PER_YEAR);
  for (let month = 0; month < MONTHS_PER_YEAR; month++) {
    fillMigrationDaysPerKm(
      world.substrate,
      month,
      days.subarray(month * world.N, (month + 1) * world.N),
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
    world._foragerCapacity,
    world._diseaseBurden,
    world.cellAreaKm2,
    world._techniqueSuitability,
    world._techniqueEdgeH,
    world._techniqueEdgeV,
    days,
    world._migrationEdgeH,
    world._migrationEdgeV,
    world._migrationShareRow,
  ];
}

/**
 * Load the people module once. Node needs bytes because fetch() does not
 * accept file:// URLs; browsers let the generated wasm-bindgen loader fetch
 * the sibling asset. Failure is a deliberate capability result: callers can
 * select the reference TypeScript kernel when wasm is unavailable.
 */
export async function ensurePeopleWasm(): Promise<boolean> {
  if (initialized) return true;
  if (initialization) return initialization;
  initialization = (async () => {
    try {
      const wasmUrl = new URL("../wasm/people/people_bg.wasm", import.meta.url);
      if (typeof window === "undefined") {
        const fs = await import("node:fs/promises");
        await init({ module_or_path: await fs.readFile(wasmUrl) });
      } else {
        await init({ module_or_path: wasmUrl });
      }
      initialized = true;
    } catch {
      return false;
    }
    try {
      const threadUrl = new URL("../wasm/people-threads/people_bg.wasm", import.meta.url);
      const threadBytes = typeof window === "undefined"
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
      if (typeof window === "undefined") {
        const workers = await import("node:worker_threads");
        workerConstructor = workers.Worker as unknown as WorkerConstructor;
        workerIsNode = true;
      } else if (typeof globalThis.Worker === "function"
        && typeof crossOriginIsolated !== "undefined" && crossOriginIsolated) {
        workerConstructor = globalThis.Worker as unknown as WorkerConstructor;
        workerIsNode = false;
      }
      threadedInitialized = true;
    } catch {
      // The ordinary wasm module remains a valid capability fallback. The
      // shell reports this as serial wasm instead of claiming worker threads.
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
  prepareTechnique(): void;
  spreadTechnique(dtMonths?: number): void;
  commitTechnique(): void;
  beginGrowth(dtMonths?: number): void;
  grow(): void;
  beginMigration(month: number, dtMonths?: number, growthPrepared?: boolean): void;
  migrateSources(): void;
  debitMigration(): void;
  gatherMigration(): void;
  finishMigration(): void;
  commitPopulation(): void;
  normalizeCohorts(): void;
  dispose(): void;
  births(): number;
  deaths(): number;
  migrationTotal(): number;
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
  | "_migrationPopulation";

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
    parallelReductions = false,
  ) {
    this.kernel = kernel;
    if (parallelReductions) this.kernel.set_parallel_reductions(true);
    const memory = memoryOverride ?? wasmMemory() as WebAssembly.Memory;
    if (!(memory instanceof WebAssembly.Memory)) {
      throw new Error("People WASM did not expose linear memory.");
    }
    this.memory = memory;
    this.memoryBuffer = memory.buffer;
    this.memoryBytes = memory.buffer.byteLength;
    this.world = world;
    this.bands = fixedPeopleBands(world.width, world.height);
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
    };
    const target = world as unknown as Record<string, unknown>;
    for (const [name, pointer] of Object.entries(pointers)) {
      target[name] = this.view(pointer, world.N);
    }
    world._migrationDaysPerKm = new Float64Array(world.N);
    world._migrationDaysPerKmByMonth = new Array(MONTHS_PER_YEAR).fill(undefined);
  }

  private dispatchBands(operation: BandOperation, dtMonths = 1): void {
    if (this.workerPool) {
      this.workerPool.dispatch(operation, this.kernel.kernel_ptr(), this.bands, dtMonths);
      return;
    }
    for (const band of this.bands) {
      if (operation === "capacity") {
        this.kernel.derive_capacity_band(band.rawLo, band.rawHi);
      } else if (operation === "technique") {
        this.kernel.technique_band(band.rawLo, band.rawHi, dtMonths);
      } else if (operation === "growth") {
        this.kernel.growth_band(band.rawLo, band.rawHi, band.index);
      } else if (operation === "migration-source") {
        this.kernel.migration_source_band(band.rawLo, band.rawHi, band.index);
      } else if (operation === "migration-debit") {
        this.kernel.migration_debit_band(band.rawLo, band.rawHi);
      } else {
        this.kernel.migration_target_band(band.rawLo, band.rawHi, band.index);
      }
    }
  }

  deriveCapacity(): void {
    this.assertMemoryStable();
    this.dispatchBands("capacity");
  }

  prepareTechnique(): void {
    this.assertMemoryStable();
    this.kernel.prepare_technique();
  }

  spreadTechnique(dtMonths = 1): void {
    this.assertMemoryStable();
    this.dispatchBands("technique", dtMonths);
  }

  commitTechnique(): void {
    this.assertMemoryStable();
    this.kernel.commit_technique();
  }

  beginGrowth(dtMonths = 1): void {
    this.assertMemoryStable();
    this.kernel.begin_growth(dtMonths);
  }

  grow(): void {
    this.assertMemoryStable();
    this.dispatchBands("growth");
  }

  beginMigration(month: number, dtMonths = 1, growthPrepared = true): void {
    this.assertMemoryStable();
    this.kernel.begin_migration(month, dtMonths, growthPrepared);
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

  get barrierMilliseconds(): number {
    return this.workerPool?.barrierMilliseconds ?? 0;
  }

  dispose(): void {
    runtimeRegistry.delete(this);
    this.workerPool?.dispose();
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
  if (wantThreads && threadedInitialized && threadedMemory && threadedModule && workerConstructor) {
    let pool: PeopleBandWorkerPool | undefined;
    let kernel: ThreadedPeopleKernel | undefined;
    try {
      kernel = new ThreadedPeopleKernel(...kernelArguments(world));
      kernel.set_parallel_reductions(true);
      pool = new PeopleBandWorkerPool(
        count,
        threadedModule,
        threadedMemory,
        workerConstructor,
        workerIsNode,
      );
      return new PeopleKernelRuntimeImpl(world, count, kernel, threadedMemory, pool, true);
    } catch (error) {
      pool?.dispose();
      kernel?.free();
      console.error("Threaded people kernel unavailable; using serial wasm.", error);
    }
  }
  return new PeopleKernelRuntimeImpl(world, count);
}


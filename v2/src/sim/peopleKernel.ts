import init, {
  deterministic_power as wasmDpow,
  PeopleKernel as WasmPeopleKernel,
  wasm_memory as wasmMemory,
} from "../wasm/people/people.js";
import { fillMigrationDaysPerKm, migrationEdgeLengths } from "./travel/cost";
import type { PeopleWorld } from "./people/types";
import {
  createBandControl,
  fixedPeopleBands,
  type BandControl,
  type PeopleBand,
} from "./people/bands";
import {
  MONTHS_PER_YEAR,
} from "./constants";

let initialized = false;
let initialization: Promise<boolean> | undefined;
const runtimeRegistry = new Set<PeopleKernelRuntimeImpl>();

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
      return true;
    } catch {
      return false;
    }
  })();
  return initialization;
}

export function peopleWasmReady(): boolean {
  return initialized;
}

export function wasmDpowValue(base: number, exponent: number): number {
  if (!initialized) throw new Error("People WASM is not initialized.");
  return wasmDpow(base, exponent);
}

export interface PeopleKernelRuntime {
  readonly workerCount: number;
  readonly bands: readonly PeopleBand[];
  readonly control: BandControl;
  deriveCapacity(): void;
  prepareTechnique(): void;
  spreadTechnique(): void;
  commitTechnique(): void;
  beginGrowth(): void;
  grow(): void;
  beginMigration(month: number): void;
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
  private readonly kernel: WasmPeopleKernel;
  private readonly memory: WebAssembly.Memory;
  private memoryBuffer: ArrayBufferLike;
  private memoryBytes: number;
  private readonly world: PeopleWorld;

  constructor(world: PeopleWorld, workerCount: number) {
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
    const migrationShareRow = world._migrationShareRow;
    const kernel = new WasmPeopleKernel(
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
      migrationShareRow,
    );
    this.kernel = kernel;
    const memory = wasmMemory() as WebAssembly.Memory;
    if (!(memory instanceof WebAssembly.Memory)) {
      throw new Error("People WASM did not expose linear memory.");
    }
    this.memory = memory;
    this.memoryBuffer = memory.buffer;
    this.memoryBytes = memory.buffer.byteLength;
    this.world = world;
    this.bands = fixedPeopleBands(world.width, world.height);
    this.workerCount = Math.max(1, Math.floor(workerCount));
    this.control = createBandControl(this.workerCount);
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

  deriveCapacity(): void {
    this.assertMemoryStable();
    for (const band of this.bands) this.kernel.derive_capacity_band(band.rawLo, band.rawHi);
  }

  prepareTechnique(): void {
    this.assertMemoryStable();
    this.kernel.prepare_technique();
  }

  spreadTechnique(): void {
    this.assertMemoryStable();
    for (const band of this.bands) this.kernel.technique_band(band.rawLo, band.rawHi);
  }

  commitTechnique(): void {
    this.assertMemoryStable();
    this.kernel.commit_technique();
  }

  beginGrowth(): void {
    this.assertMemoryStable();
    this.kernel.begin_growth();
  }

  grow(): void {
    this.assertMemoryStable();
    for (const band of this.bands) this.kernel.growth_band(band.rawLo, band.rawHi);
  }

  beginMigration(month: number): void {
    this.assertMemoryStable();
    this.kernel.begin_migration(month);
  }

  migrateSources(): void {
    this.assertMemoryStable();
    for (const band of this.bands) this.kernel.migration_source_band(band.rawLo, band.rawHi);
  }

  debitMigration(): void {
    this.assertMemoryStable();
    for (const band of this.bands) this.kernel.migration_debit_band(band.rawLo, band.rawHi);
  }

  gatherMigration(): void {
    this.assertMemoryStable();
    for (const band of this.bands) this.kernel.migration_target_band(band.rawLo, band.rawHi);
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

  dispose(): void {
    runtimeRegistry.delete(this);
    this.kernel.free();
  }
}

export function createPeopleKernel(
  world: PeopleWorld,
  workerCount = 1,
): PeopleKernelRuntime | undefined {
  if (!peopleWasmReady()) return undefined;
  return new PeopleKernelRuntimeImpl(world, workerCount);
}


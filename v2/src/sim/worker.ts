import {
  HASH_NUMBER_BYTES,
  MATH_NEGATIVE_ONE,
  MONTHS_PER_YEAR,
  PEOPLE_ADOPTION_RATE_PER_YEAR,
  PEOPLE_DISEASE_RATE,
  PEOPLE_FARM_CAPACITY_PER_KM2,
  PEOPLE_FARM_TECHNIQUE_BASE,
  PEOPLE_FARM_TECHNIQUE_GAIN,
  PEOPLE_FARMED_MARKER_SHARE,
  PEOPLE_GROWTH_FORAGER_FACTOR,
  PEOPLE_GROWTH_TECHNIQUE_GAIN,
  PEOPLE_INITIAL_FILL_FRACTION,
  PEOPLE_R_GROWTH_PER_YEAR,
  PEOPLE_SNAPSHOT_FIELD_COUNT,
  PEOPLE_WATER_ACCESS_GAIN,
} from "./constants";
import { dexp } from "./dmath";
import { ensurePeopleWasm } from "./peopleKernel";
import { hashWorld, runSteps, type GridPreset, World } from "./world";
import { populationTotal } from "./people";
import { yearFromStep } from "./horizon";
import { solveSpanMonths } from "./scheduler";
import { CROP_PACKAGES } from "../ported/worldgen/cropPackages.js";
import type { Substrate } from "./substrate";
import type { PeopleWorld } from "./people/types";

/**
 * The can-grow and native overlays are annual land properties: how many
 * packages can grow in a cell, and how many are native there. They never
 * change after creation, so they are built once per world, not per batch.
 */
let overlayCache: { world: PeopleWorld; canGrow: Uint8Array; native: Float32Array } | undefined;
function staticOverlays(world: PeopleWorld): { canGrow: Uint8Array; native: Float32Array } {
  if (overlayCache?.world === world) return overlayCache;
  const canGrow = new Uint8Array(world.N);
  // The "native" plane is the wild-stand richness (W8): the richest stand of
  // any package in the cell, 0..1 — the belt a hearth can condense on.
  const native = new Float32Array(world.N);
  for (let packed = 0; packed < world._landCells.length; packed++) {
    const cell = world._landCells[packed] ?? 0;
    let grows = 0;
    for (let packageIndex = 0; packageIndex < world._canGrow.length; packageIndex++) {
      grows += world._canGrow[packageIndex]?.[packed] ?? 0;
    }
    canGrow[cell] = grows;
    native[cell] = world._standBest[cell] ?? 0;
  }
  overlayCache = { world, canGrow, native };
  return overlayCache;
}

interface CreateMessage {
  readonly type: "create";
  readonly seed: number;
  readonly grid: GridPreset;
  readonly config?: Readonly<Record<string, string | number | boolean>>;
  readonly substrate?: Substrate;
}

interface TickMessage {
  readonly type: "tick";
  readonly steps: number;
}

interface RecycleMessage {
  readonly type: "recycle";
  readonly buffer: ArrayBuffer;
}

/** A frame of the solved prehistory at a world step before the wake: a reconstruction, never state (W5). */
interface SeekMessage {
  readonly type: "seek";
  readonly step: number;
}

type WorkerMessage = CreateMessage | TickMessage | RecycleMessage | SeekMessage;

interface WorkerScope {
  addEventListener(type: "message", listener: (event: MessageEvent<WorkerMessage>) => void): void;
  postMessage(message: unknown, transfer?: Transferable[]): void;
}

let world: World | undefined;
const snapshotPool: ArrayBuffer[] = [];
let snapshotVersion = 0;

function regimeOf(target: World): Record<string, unknown> {
  return {
    phase: target.phase,
    solveClock: target.solveClock,
    solveSpan: solveSpanMonths(target.solveSchedule),
    wakeStep: target.wakeStep,
    cagedStep: target.cagedStep,
    cagedCell: target.cagedCell,
    year: yearFromStep(target.step),
  };
}

interface SnapshotPlanes {
  readonly buffer: ArrayBuffer;
  readonly people: Float32Array;
  readonly technique: Float32Array;
  readonly packageView: Float32Array;
}

function snapshotPlanes(target: World): SnapshotPlanes {
  const bytes = HASH_NUMBER_BYTES + target.N * Float32Array.BYTES_PER_ELEMENT * PEOPLE_SNAPSHOT_FIELD_COUNT;
  const recycled = snapshotPool.pop();
  const buffer = recycled?.byteLength === bytes ? recycled : new ArrayBuffer(bytes);
  const plane = (index: number): Float32Array => new Float32Array(
    buffer,
    HASH_NUMBER_BYTES + target.N * Float32Array.BYTES_PER_ELEMENT * index,
    target.N,
  );
  const people = plane(0);
  const technique = plane(1);
  const packageView = plane(2);
  const canGrowView = plane(2 + 1);
  const nativeView = plane(2 + 2);
  if (target.substrate) {
    const overlays = staticOverlays(target as PeopleWorld);
    canGrowView.set(overlays.canGrow);
    nativeView.set(overlays.native);
  }
  return { buffer, people, technique, packageView };
}

function liveSnapshot(target: World): Record<string, unknown> {
  const planes = snapshotPlanes(target);
  new Float64Array(planes.buffer, 0, 1)[0] = target.step;
  planes.people.set(target.people);
  planes.technique.set(target.technique);
  if (target.substrate) planes.packageView.set((target as PeopleWorld)._dominantPackage);
  // No world hash per snapshot: hashWorld walks every field with BigInt
  // arithmetic (5.3 s at the target grid — measured, review W3), which
  // made every tick batch take seconds regardless of the kernel. The hash
  // is reported once at creation; harnesses hash on demand.
  return {
    type: "snapshot",
    step: target.step,
    reconstructed: false,
    version: snapshotVersion++,
    cells: target.N,
    population: target.substrate ? populationTotal(target) : 0,
    ...regimeOf(target),
    buffer: planes.buffer,
  };
}

/**
 * The timeline's reconstruction of a pre-wake step from the recorded
 * arrival steps and the passes' own constants: foragers as the logistic fill
 * from the opening at the cell's forager rate; from the recorded arrival,
 * farmers as a logistic toward the recorded package's matured capacity at
 * the farmer rate while the remaining foragers convert at the adoption
 * rate; technique as the farmed share. A rendering condensation (02, box
 * 5): derived, evictable, never state, never read by a pass.
 */
function reconstructedSnapshot(target: World, step: number): Record<string, unknown> {
  const people = target as PeopleWorld;
  const planes = snapshotPlanes(target);
  new Float64Array(planes.buffer, 0, 1)[0] = step;
  planes.people.fill(0);
  planes.technique.fill(0);
  planes.packageView.fill(0);
  const years = step / MONTHS_PER_YEAR;
  let total = 0;
  for (let packed = 0; packed < people._landCells.length; packed++) {
    const cell = people._landCells[packed] ?? 0;
    const foragerCapacity = people._foragerCapacity[cell] ?? 0;
    const disease = people._diseaseBurden[cell] ?? 0;
    const peopled = people._peopledMask[cell] === 1 && foragerCapacity > 0;
    const foragerRate = PEOPLE_R_GROWTH_PER_YEAR * PEOPLE_GROWTH_FORAGER_FACTOR / (1 + PEOPLE_DISEASE_RATE * disease);
    const opening = foragerCapacity * PEOPLE_INITIAL_FILL_FRACTION;
    const foragersAt = (t: number): number => (
      peopled && opening > 0
        ? foragerCapacity / (1 + (foragerCapacity / opening - 1) * dexp(-foragerRate * t))
        : 0
    );
    const arrival = people._arrivalStep[packed] ?? MATH_NEGATIVE_ONE;
    let density = foragersAt(years);
    let technique = 0;
    let packageIndex = 0;
    if (arrival >= 0 && arrival <= step) {
      const arrivalYears = arrival / MONTHS_PER_YEAR;
      const since = years - arrivalYears;
      const foragersThen = foragersAt(arrivalYears);
      const seedFarmers = PEOPLE_FARMED_MARKER_SHARE * foragersThen;
      packageIndex = people._arrivalPackage[packed] ?? 0;
      const pkg = CROP_PACKAGES[packageIndex];
      const fertility = Math.max(0, Math.min(1, people.substrate.fertility[cell] ?? 0));
      const matured = fertility
        * PEOPLE_FARM_CAPACITY_PER_KM2
        * (pkg?.yield ?? 1)
        * (PEOPLE_FARM_TECHNIQUE_BASE + PEOPLE_FARM_TECHNIQUE_GAIN)
        * (1 + (people._waterAccess[cell] ?? 0) * PEOPLE_WATER_ACCESS_GAIN)
        * (people._reliefMult[cell] ?? 0);
      const farmerRate = PEOPLE_R_GROWTH_PER_YEAR
        * (PEOPLE_GROWTH_FORAGER_FACTOR + PEOPLE_GROWTH_TECHNIQUE_GAIN)
        / (1 + PEOPLE_DISEASE_RATE * disease);
      const farmers = matured > 0 && seedFarmers > 0
        ? matured / (1 + (matured / seedFarmers - 1) * dexp(-farmerRate * since))
        : seedFarmers;
      const remaining = foragersThen * (1 - PEOPLE_FARMED_MARKER_SHARE) * dexp(-PEOPLE_ADOPTION_RATE_PER_YEAR * since);
      density = farmers + remaining;
      technique = density > 0 ? farmers / density : 0;
    }
    planes.people[cell] = density;
    planes.technique[cell] = technique;
    planes.packageView[cell] = packageIndex;
    total += density * (people.cellAreaKm2[cell] ?? 0);
  }
  return {
    type: "snapshot",
    step,
    reconstructed: true,
    version: snapshotVersion++,
    cells: target.N,
    population: total,
    ...regimeOf(target),
    year: yearFromStep(step),
    buffer: planes.buffer,
  };
}

export async function handleWorkerMessage(message: WorkerMessage): Promise<Record<string, unknown>> {
  if (message.type === "create") {
    if (message.config?.peopleKernel !== "ts") await ensurePeopleWasm();
    overlayCache = undefined;
    world = new World(message);
    const peopleKernel = (world as unknown as {
      _wasmPeopleKernel?: { workerCount: number; usesThreads: boolean; control: { shared: boolean } };
    })._wasmPeopleKernel;
    const growth = world.awakeSchedule.find((row) => row.name === "people.growth")?.stride ?? 1;
    const migration = world.awakeSchedule.find((row) => row.name === "people.migration")?.stride ?? 1;
    const solve = world.solveSchedule.find((row) => row.name === "people.growth")?.stride ?? 1;
    const solveMigration = world.solveSchedule.find((row) => row.name === "people.migration")?.stride ?? 1;
    const isolated = typeof crossOriginIsolated === "undefined" || crossOriginIsolated;
    return {
      type: "created",
      hash: hashWorld(world),
      grid: world.grid,
      step: world.step,
      kernel: peopleKernel ? "wasm" : "ts",
      workerCount: peopleKernel?.workerCount ?? 1,
      usesThreads: peopleKernel?.usesThreads === true,
      isolated,
      scheduleLabel: `growth ${growth} · migration ${migration} · solve ${solve}/${solveMigration}`,
      sharedBands: peopleKernel?.control.shared === true,
      ...regimeOf(world),
    };
  }
  if (message.type === "recycle") {
    snapshotPool.push(message.buffer);
    return { type: "recycled" };
  }
  if (!world) throw new Error("The worker world has not been created.");
  if (message.type === "seek") {
    // Only the solved span reconstructs; a step at or past the wake (or
    // past the present while still solving) is the live world.
    const solvedEnd = world.phase === "solve" ? world.step : world.wakeStep;
    if (!world.substrate || message.step >= solvedEnd) return liveSnapshot(world);
    return reconstructedSnapshot(world, Math.max(0, Math.floor(message.step)));
  }
  runSteps(world, message.steps);
  return liveSnapshot(world);
}

const scope = globalThis as unknown as Partial<WorkerScope>;
// Messages are handled strictly in order: "create" awaits the wasm load, and
// a "tick" that arrived meanwhile must wait for it, not throw (it did — the
// shell then sat on "waiting for worker" forever; review, W3).
let queue: Promise<unknown> = Promise.resolve();
if (typeof scope.addEventListener === "function" && typeof scope.postMessage === "function") {
  scope.addEventListener("message", (event) => {
    queue = queue.then(() => handleWorkerMessage(event.data)).then((response) => {
      const transfer = response.type === "snapshot" && response.buffer instanceof ArrayBuffer
        ? [response.buffer]
        : [];
      scope.postMessage?.(response, transfer);
    }).catch((error: unknown) => {
      scope.postMessage?.({
        type: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    });
  });
}

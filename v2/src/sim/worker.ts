import { HASH_NUMBER_BYTES } from "./constants";
import { ensurePeopleWasm } from "./peopleKernel";
import { hashWorld, runSteps, type GridPreset, World } from "./world";
import { populationTotal } from "./people";
import type { Substrate } from "./substrate";

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

type WorkerMessage = CreateMessage | TickMessage | RecycleMessage;

interface WorkerScope {
  addEventListener(type: "message", listener: (event: MessageEvent<WorkerMessage>) => void): void;
  postMessage(message: unknown, transfer?: Transferable[]): void;
}

let world: World | undefined;
const snapshotPool: ArrayBuffer[] = [];
let snapshotVersion = 0;

export async function handleWorkerMessage(message: WorkerMessage): Promise<Record<string, unknown>> {
  if (message.type === "create") {
    if (message.config?.peopleKernel !== "ts") await ensurePeopleWasm();
    world = new World(message);
    const peopleKernel = (world as unknown as {
      _wasmPeopleKernel?: { workerCount: number; usesThreads: boolean; control: { shared: boolean } };
    })._wasmPeopleKernel;
    const growth = world.schedule.find((row) => row.name === "people.growth")?.stride ?? 1;
    const migration = world.schedule.find((row) => row.name === "people.migration")?.stride ?? 1;
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
      scheduleLabel: `growth ${growth} · migration ${migration}`,
      sharedBands: peopleKernel?.control.shared === true,
    };
  }
  if (message.type === "recycle") {
    snapshotPool.push(message.buffer);
    return { type: "recycled" };
  }
  if (!world) throw new Error("The worker world has not been created.");
  runSteps(world, message.steps);
  const bytes = HASH_NUMBER_BYTES + world.N * Float32Array.BYTES_PER_ELEMENT * 2;
  const recycled = snapshotPool.pop();
  const buffer = recycled?.byteLength === bytes ? recycled : new ArrayBuffer(bytes);
  new Float64Array(buffer, 0, 1)[0] = world.step;
  const people = new Float32Array(buffer, HASH_NUMBER_BYTES, world.N);
  const technique = new Float32Array(buffer, HASH_NUMBER_BYTES + world.N * Float32Array.BYTES_PER_ELEMENT, world.N);
  people.set(world.people);
  technique.set(world.technique);
  return {
    type: "snapshot",
    hash: hashWorld(world),
    step: world.step,
    version: snapshotVersion++,
    cells: world.N,
    population: world.substrate ? populationTotal(world) : 0,
    buffer,
  };
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

import { HASH_NUMBER_BYTES } from "./constants";
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

export function handleWorkerMessage(message: WorkerMessage): Record<string, unknown> {
  if (message.type === "create") {
    world = new World(message);
    return { type: "created", hash: hashWorld(world), grid: world.grid, step: world.step };
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
if (typeof scope.addEventListener === "function" && typeof scope.postMessage === "function") {
  scope.addEventListener("message", (event) => {
    try {
      const response = handleWorkerMessage(event.data);
      const transfer = response.type === "snapshot" && response.buffer instanceof ArrayBuffer
        ? [response.buffer]
        : [];
      scope.postMessage?.(response, transfer);
    } catch (error) {
      scope.postMessage?.({
        type: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });
}

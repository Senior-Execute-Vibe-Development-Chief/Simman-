import { hashWorld, runSteps, type GridPreset, World } from "./world";

interface CreateMessage {
  readonly type: "create";
  readonly seed: number;
  readonly grid: GridPreset;
  readonly config?: Readonly<Record<string, string | number | boolean>>;
}

interface TickMessage {
  readonly type: "tick";
  readonly steps: number;
}

type WorkerMessage = CreateMessage | TickMessage;

interface WorkerScope {
  addEventListener(type: "message", listener: (event: MessageEvent<WorkerMessage>) => void): void;
  postMessage(message: unknown): void;
}

let world: World | undefined;

export function handleWorkerMessage(message: WorkerMessage): Record<string, unknown> {
  if (message.type === "create") {
    world = new World(message);
    return { type: "created", hash: hashWorld(world), grid: world.grid, step: world.step };
  }
  if (!world) throw new Error("The worker world has not been created.");
  runSteps(world, message.steps);
  return {
    type: "state",
    hash: hashWorld(world),
    step: world.step,
  };
}

const scope = globalThis as unknown as Partial<WorkerScope>;
if (typeof scope.addEventListener === "function" && typeof scope.postMessage === "function") {
  scope.addEventListener("message", (event) => {
    try {
      scope.postMessage?.(handleWorkerMessage(event.data));
    } catch (error) {
      scope.postMessage?.({
        type: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });
}

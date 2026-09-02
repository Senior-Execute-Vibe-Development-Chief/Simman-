import { initSync } from "../wasm/people-threads/people.js";

const isNode = typeof process !== "undefined" && Boolean(process.versions?.node);
let parentPort;
let workerData;
if (isNode) {
  ({ parentPort, workerData } = await import("node:worker_threads"));
}

let runtime;

function post(message) {
  if (parentPort) parentPort.postMessage(message);
  else globalThis.postMessage(message);
}

function start(input) {
  const wasm = initSync({
    module: input.module,
    memory: input.memory,
    thread_stack_size: 1048576,
  });
  const control = new Int32Array(input.controlStorage);
  const ready = new Int32Array(input.readyStorage);
  const idle = new Int32Array(input.idleStorage);
  runtime = { wasm, control, ready, idle };
  Atomics.add(ready, 0, 1);
  Atomics.notify(ready, 0);
  post({ type: "ready" });
}

function finishBand(index) {
  Atomics.store(runtime.control, 2 + index, 1);
  Atomics.notify(runtime.control, 2 + index);
}

function runBand(payload, band, index) {
  const { wasm } = runtime;
  const pointer = payload.kernelPointer;
  if (payload.operation === "capacity") {
    wasm.people_dispatch_capacity(pointer, band.rawLo, band.rawHi);
  } else if (payload.operation === "technique") {
    wasm.people_dispatch_technique(pointer, band.rawLo, band.rawHi, payload.dtMonths);
  } else if (payload.operation === "growth") {
    wasm.people_dispatch_growth(pointer, band.rawLo, band.rawHi, index);
  } else if (payload.operation === "migration-source") {
    wasm.people_dispatch_migration_source(pointer, band.rawLo, band.rawHi, index);
  } else if (payload.operation === "migration-debit") {
    wasm.people_dispatch_migration_debit(pointer, band.rawLo, band.rawHi);
  } else if (payload.operation === "migration-target") {
    wasm.people_dispatch_migration_target(pointer, band.rawLo, band.rawHi, index);
  } else {
    throw new Error(`Unknown people band operation: ${payload.operation}`);
  }
  finishBand(index);
}

function dispatch(payload) {
  const bands = payload.bands;
  const expectedPhase = payload.phase;
  try {
    while (true) {
      if (Atomics.load(runtime.control, 0) !== expectedPhase) return;
      const index = Atomics.add(runtime.control, 1, 1);
      if (Atomics.load(runtime.control, 0) !== expectedPhase) return;
      if (index >= bands.length) return;
      runBand(payload, bands[index], index);
    }
  } finally {
    Atomics.add(runtime.idle, 0, 1);
    Atomics.notify(runtime.idle, 0);
  }
}

function onMessage(message) {
  try {
    if (message.type === "init") start(message);
    else if (message.type === "dispatch") dispatch(message);
  } catch (error) {
    post({ type: "error", message: error instanceof Error ? error.message : String(error) });
  }
}

if (workerData) start(workerData);
if (parentPort) parentPort.on("message", onMessage);
else globalThis.addEventListener("message", (event) => onMessage(event.data));

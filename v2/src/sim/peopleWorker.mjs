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
    thread_stack_size: 1024 * 1024,
  });
  const control = new Int32Array(input.controlStorage);
  const ready = new Int32Array(input.readyStorage);
  runtime = { wasm, control, ready };
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
    wasm.peoplekernel_derive_capacity_band(pointer, band.rawLo, band.rawHi);
  } else if (payload.operation === "technique") {
    wasm.peoplekernel_technique_band(pointer, band.rawLo, band.rawHi, payload.dtMonths);
  } else if (payload.operation === "growth") {
    wasm.peoplekernel_growth_band(pointer, band.rawLo, band.rawHi, index);
  } else if (payload.operation === "migration-source") {
    wasm.peoplekernel_migration_source_band(pointer, band.rawLo, band.rawHi, index);
  } else if (payload.operation === "migration-debit") {
    wasm.peoplekernel_migration_debit_band(pointer, band.rawLo, band.rawHi);
  } else if (payload.operation === "migration-target") {
    wasm.peoplekernel_migration_target_band(pointer, band.rawLo, band.rawHi, index);
  } else {
    throw new Error(`Unknown people band operation: ${payload.operation}`);
  }
  finishBand(index);
}

function dispatch(payload) {
  const bands = payload.bands;
  while (true) {
    const index = Atomics.add(runtime.control, 1, 1);
    if (index >= bands.length) return;
    runBand(payload, bands[index], index);
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

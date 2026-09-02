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
  // Layout constants (stack size, control-word indices) come from the
  // coordinator, which reads them from the constants ledger.
  const wasm = initSync({
    module: input.module,
    memory: input.memory,
    thread_stack_size: input.stackBytes,
  });
  const control = new Int32Array(input.controlStorage);
  const ready = new Int32Array(input.readyStorage);
  const idle = new Int32Array(input.idleStorage);
  const errorFlag = new Int32Array(input.errorStorage, 0, 1);
  const errorText = new Uint8Array(input.errorStorage, Int32Array.BYTES_PER_ELEMENT);
  runtime = {
    wasm,
    control,
    ready,
    idle,
    errorFlag,
    errorText,
    phaseIndex: input.phaseIndex,
    claimIndex: input.claimIndex,
    doneOffset: input.doneOffset,
  };
  Atomics.add(ready, 0, 1);
  Atomics.notify(ready, 0);
  post({ type: "ready" });
}

function finishBand(index) {
  Atomics.store(runtime.control, runtime.doneOffset + index, 1);
  Atomics.notify(runtime.control, runtime.doneOffset + index);
}

/** Report a failure through shared memory: the coordinator is blocked in Atomics.wait and cannot receive a posted message. */
function reportError(error) {
  const text = error instanceof Error ? (error.stack ?? error.message) : String(error);
  if (runtime) {
    const bytes = new TextEncoder().encode(text).subarray(0, runtime.errorText.length - 1);
    runtime.errorText.set(bytes);
    runtime.errorText[bytes.length] = 0;
    Atomics.store(runtime.errorFlag, 0, 1);
    Atomics.notify(runtime.idle, 0);
    for (let index = 0; index < runtime.control.length - runtime.doneOffset; index++) {
      Atomics.notify(runtime.control, runtime.doneOffset + index);
    }
  }
  post({ type: "error", message: text });
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
      if (Atomics.load(runtime.control, runtime.phaseIndex) !== expectedPhase) return;
      const index = Atomics.add(runtime.control, runtime.claimIndex, 1);
      if (Atomics.load(runtime.control, runtime.phaseIndex) !== expectedPhase) return;
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
    reportError(error);
  }
}

if (workerData) start(workerData);
if (parentPort) parentPort.on("message", onMessage);
else globalThis.addEventListener("message", (event) => onMessage(event.data));

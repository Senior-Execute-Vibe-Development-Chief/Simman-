// Browser band-worker entry (Web Worker, module type). Receives its init once
// via postMessage — the ONLY event-loop dependence, satisfied before the loop
// starts — then enters the same Atomics run loop as the node entry (the sim
// side never depends on this worker's event loop again; readiness rides the
// ctrl SAB's C_READY). Requires cross-origin isolation (COOP/COEP) for
// SharedArrayBuffer — the pool only spawns this entry when
// crossOriginIsolated is true.
import { runBandLoop } from "./popFieldWorkerCore.js";

self.onmessage = (e) => {
  self.onmessage = null;
  try {
    runBandLoop(e.data);
  } catch (err) {
    // Surface band-worker failures loudly — a silent dead band would leave
    // the pool permanently unready (fallback), which QA must SEE, not infer.
    console.error("[popField band worker]", String(err && err.stack ? err.stack : err));
    throw err;
  }
};

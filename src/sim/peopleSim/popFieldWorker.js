// Node band-worker entry (worker_threads). The run loop lives in
// popFieldWorkerCore.js, shared verbatim with the browser entry
// (popFieldWorker.browser.js) — one loop, two spawners.
import { parentPort, workerData } from "node:worker_threads";
import { runBandLoop } from "./popFieldWorkerCore.js";

parentPort.postMessage({ ready: true });   // informational — readiness is the C_READY atomic (stamped inside the loop)
runBandLoop(workerData);

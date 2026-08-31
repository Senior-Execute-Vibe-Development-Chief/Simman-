// In-browser identity check for the popField worker pool
// (docs/popfield-parallel.md §6, the browser leg). Runs INSIDE a Web Worker —
// the app's own sim topology; the pool's band workers are NESTED workers
// spawned from here. Builds the same world twice (hashbase geometry, seed
// 8817), steps it at lever 0 then lever 4, and posts both hashes plus the
// pool's engagement status: the driver asserts hash equality AND that the
// pool genuinely ran (a fallback-only "pass" would be vacuous — the lesson
// of the first snapshot identity run).
import { buildWorld } from "../src/sim/pipeline.js";
import { initPeopleSim, stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { hashWorld } from "../src/sim/persist.js";
import { applyTuning } from "../src/sim/peopleSim/tuning.js";

const SEED = 8817, W = 320, H = 160, STEPS = 300;

function buildSim() {
  const { w, ter } = buildWorld({ W, H, seed: SEED });
  return initPeopleSim(w, { seed: w.seed, tCrop: ter.tCrop, tFlood: ter.tFlood, tileRes: 1,
    deposits: ter.deposits, tAncestry: ter.tAncestry, terTw: ter.tw, terTh: ter.th,
    ancestryCount: ter.ancestryCount, ancHue: ter.ancHue, ancHomelands: ter.ancHomelands, tArrival: ter.tArrival });
}

(async () => {
try {
  const t0 = performance.now();
  applyTuning({ POP_FIELD_WORKERS: 0 });
  const w0 = buildSim();
  stepPeopleSim(w0, STEPS);
  const h0 = hashWorld(w0);

  applyTuning({ POP_FIELD_WORKERS: 4 });
  const w4 = buildSim();
  // Step in CHUNKS with event-loop yields — the app's own cadence. Chromium
  // proxies a NESTED worker's script fetch through its parent worker, so a
  // parent that never yields (one long synchronous run) starves its band
  // workers of their own boot: the pool stays unready and the whole run
  // silently falls back — a vacuous pass this gate exists to reject.
  for (let s = 0; s < STEPS; s += 25) {
    stepPeopleSim(w4, Math.min(25, STEPS - s));
    await new Promise((r) => setTimeout(r, 0));
  }
  const h4 = hashWorld(w4);
  const pool = w4._pfPool;
  applyTuning({ POP_FIELD_WORKERS: 0 });

  postMessage({
    ok: h0 === h4 && !!pool && pool.readyNow() && !pool.dead,
    h0, h4,
    isolated: typeof crossOriginIsolated !== "undefined" && crossOriginIsolated,
    poolReady: !!pool && pool.readyNow(), poolDead: !!pool && pool.dead,
    bands: pool ? pool.bands : 0, arena: !!w4._pfArena,
    secs: Math.round((performance.now() - t0) / 1000),
  });
} catch (e) {
  postMessage({ ok: false, error: String(e && e.stack ? e.stack : e) });
}
})();

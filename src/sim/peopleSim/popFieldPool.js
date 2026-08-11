// Worker pool + Atomics barrier for the popField pass (Stage B,
// docs/popfield-parallel.md §4). Node-only.
//
// EVERYTHING here must work inside a fully SYNCHRONOUS driver (probes,
// batteries, the profiler step their worlds in one long synchronous loop, so
// the event loop — promises, worker 'message'/'error' events — never runs
// mid-window). Hence: the spawn uses process.getBuiltinModule (synchronous
// builtin access, node ≥20.16 — no await), READINESS rides the ctrl SAB, and
// worker crashes are caught by the awaitPhase wall-clock timeout, never by
// the 'error' event.
//
// The barrier is EPOCH-STAMPED, not counted: worker k stamps its own ctrl
// slot with the phase seq it just ran. Idempotent under duplicate wakes (a
// shared counter overshot — measured), immune to stragglers (stale epochs are
// simply not the current one), and loud on the impossible (a worker that
// observes a seq it cannot replay stamps POISON → dispose → the caller
// throws). Each pool also gets a FRESH ctrl/hdr SAB pair: threads from a
// disposed pool can never touch a successor's barrier, whatever their
// termination latency.
//
// Topology: lever N ⇒ N bands; the COORDINATOR (the sim thread) computes band
// 0 between signal and await, workers 1..N−1 run the rest. Any structural
// change (bigger owner tables, a loaded world, a lever change) disposes the
// pool and spawns a fresh one; until a pool is ready the caller runs the
// identical-result one-thread path, so pool state only ever moves wall-clock.
import { C_SEQ, C_OP, C_PARITY, C_READY, C_HINT, C_SLOT0, POISON, OP_EXIT, HDR_LEN, bandBase, ctrlLen } from "./popFieldKernel.js";

// Explicit band-worker URL for BUILT apps: the app's sim worker is bundled
// inline (?worker&inline → a blob), where import.meta.url cannot resolve the
// band-worker chunk. The page resolves the emitted chunk's real URL
// (?worker&url) and threads it in via setBandWorkerUrl before the pool
// spawns; unset (dev module graph, tests) falls back to sibling resolution.
let _bandWorkerUrl = null;
export function setBandWorkerUrl(u) { _bandWorkerUrl = u || null; }

export function makeBands(nLand, N, bands) {
  const out = [];
  for (let k = 0; k < bands; k++) {
    out.push({
      lo: Math.floor((nLand * k) / bands), hi: Math.floor((nLand * (k + 1)) / bands),
      rawLo: Math.floor((N * k) / bands), rawHi: Math.floor((N * (k + 1)) / bands),
    });
  }
  return out;
}

/** Write band ranges into ctrl (plain stores — the phase handshake publishes
 *  them). ranges = [{lo, hi, rawLo, rawHi} × bands]. */
export function writeBands(ctrl, bands, ranges) {
  const base = bandBase(bands);
  for (let k = 0; k < bands; k++) {
    const r = ranges[k], o = base + 4 * k;
    ctrl[o] = r.lo; ctrl[o + 1] = r.hi; ctrl[o + 2] = r.rawLo; ctrl[o + 3] = r.rawHi;
  }
}

/** Spawn bands−1 workers, SYNCHRONOUSLY where possible, over a FRESH ctrl/hdr
 *  pair seeded with equal band ranges. Node: worker_threads via
 *  process.getBuiltinModule (no event loop needed). Browser: Web Workers —
 *  requires crossOriginIsolated (COOP/COEP) for SharedArrayBuffer; init rides
 *  one postMessage (delivered before the worker enters its Atomics loop).
 *  Workers count into ctrl[C_READY]; poll pool.readyNow() each firing. */
export function ensurePool(world, arena, bands) {
  const nW = bands - 1;
  const ctrlSab = new SharedArrayBuffer(ctrlLen(bands) * 4);
  const hdrSab = new SharedArrayBuffer(HDR_LEN * 8);
  const ctrl = new Int32Array(ctrlSab);
  const hdr = new Float64Array(hdrSab);
  writeBands(ctrl, bands, makeBands(arena.nLand, arena.N, bands));
  const pool = {
    dead: false, bands, gen: arena.gen, workers: [], seq: 0,
    ctrl, hdr,
    readyNow() { return !this.dead && Atomics.load(this.ctrl, C_READY) >= this.bands - 1; },
    dispose() {
      if (this.dead) return;
      this.dead = true;
      try { Atomics.store(this.ctrl, C_OP, OP_EXIT); Atomics.add(this.ctrl, C_SEQ, 1); Atomics.notify(this.ctrl, C_SEQ); } catch { /* ignore */ }
      for (const w of this.workers) { try { w.terminate(); } catch { /* ignore */ } }
      this.workers.length = 0;
    },
  };
  let WT = null;
  try {
    if (typeof process !== "undefined" && process.getBuiltinModule) WT = process.getBuiltinModule("node:worker_threads");
  } catch { WT = null; }
  // T.ACCESS_BAND: `arena` here is the _pfArenaMsg MESSAGE — its sabs already
  // carry the banded Float32 fields under the riverMag/coast slot names, and
  // its accessBand flag tells the worker core to build Float32 views over
  // them (they are Float32 where the sim's raw arrays are Uint8 — a
  // mismatched view is garbage; the flag and the redirected slots must
  // travel TOGETHER, which is why both live on the message). A lever toggle
  // bumps arena.gen, which respawns this pool.
  const bufs = { ...arena.sabs, ctrl: ctrlSab, hdr: hdrSab };
  const geom = { N: arena.N, tw: arena.tw, th: arena.th, nLand: arena.nLand, bands, accessBand: !!arena.accessBand };
  try {
    if (WT) {
      for (let k = 1; k < bands; k++) {
        const w = new WT.Worker(new URL("./popFieldWorker.js", import.meta.url), {
          workerData: { bufs, geom, idx: k },
        });
        w.unref();   // never hold the process open — batteries/probes must exit naturally
        pool.workers.push(w);
      }
    } else if (typeof Worker !== "undefined" && typeof crossOriginIsolated !== "undefined" && crossOriginIsolated === true) {
      // Browser: the sim already runs in a worker; these are NESTED workers.
      // SABs share (not copy) through postMessage; the entry blocks in
      // Atomics.wait forever after this one message.
      for (let k = 1; k < bands; k++) {
        const w = new Worker(_bandWorkerUrl || new URL("./popFieldWorker.browser.js", import.meta.url), { type: "module" });
        w.onerror = (e) => { console.error("[popField pool] band worker error:", e && e.message); pool.dispose(); };
        w.postMessage({ bufs, geom, idx: k });
        pool.workers.push(w);
      }
    } else {
      pool.dead = true;   // no worker substrate here — permanent fallback
    }
  } catch {
    pool.dispose();
  }
  return pool;
}

/** Signal one phase. The caller then runs band 0 itself and calls awaitPhase.
 *  Plain hdr/data writes made before this call are visible to workers via the
 *  seq-cst Atomics handshake. */
export function signalPhase(pool, op, parity) {
  const ctrl = pool.ctrl;
  Atomics.store(ctrl, C_PARITY, parity);
  Atomics.store(ctrl, C_OP, op);
  pool.seq = Atomics.add(ctrl, C_SEQ, 1) + 1;
  Atomics.notify(ctrl, C_SEQ);
}

/** Block until every worker has stamped the CURRENT phase seq into its slot.
 *  POISON in any slot (a worker hit an unreplayable state) or the wall-clock
 *  timeout (a worker died — its 'error' event cannot fire mid-loop) disposes
 *  the pool; the caller must treat a dead pool as fatal for this run
 *  (growth/works are in-place, a partial phase is unrecoverable). */
export function awaitPhase(pool) {
  const ctrl = pool.ctrl, nW = pool.bands - 1, want = pool.seq;
  const t0 = performance.now();
  for (;;) {
    let done = 0;
    for (let k = 0; k < nW; k++) {
      const v = Atomics.load(ctrl, C_SLOT0 + k);
      if (v === POISON) { pool.dispose(); return; }
      if (v === want) done++;
    }
    if (done === nW) return;
    if (pool.dead) return;
    if (performance.now() - t0 > 10000) { pool.dispose(); return; }
    // Park on the wake HINT with its current value: a worker's bump+notify
    // wakes us immediately; the 2ms timeout only backstops a lost hint. (A
    // wait on C_SEQ blocked its full timeout every pass — C_SEQ already
    // equals the current phase — and the sleep ate the parallel win.)
    Atomics.wait(ctrl, C_HINT, Atomics.load(ctrl, C_HINT), 2);
  }
}

# The allocation wall — the app dies at ~24-27k steps (2026-08-19/20)

Two owner reports, one disease, two layers.

## The reports

1. **2026-08-19, ~step 24,264 (tw=960 app):** banner "Array buffer allocation
   failed"; pausing buys a few display years, then it returns. Fixed the same
   day (commit `2fc6ae6`) by killing the SIM's steady-state allocation churn —
   the reuse-slot wave (persistent MinHeaps, double-buffered timeline layer,
   cageField arena, in-place `transportDist`).
2. **2026-08-20, ~step 26,600 (tw=960 app, build `d64a7ba`):** the crash
   returns, 2.4k steps later, now with a stack:
   `RangeError: Array buffer allocation failed … new Int32Array ← YR._grow ←
   YR.push ← TR ← RK ← lR`. Mapped against the built bundle: `YR` =
   **transport.js `_MinHeap`**, `TR` = `computeTransport`, `RK` =
   `maybeCrystallize` (its 480-tick transport refresh), `lR` = `stepPeopleSim`.

## The diagnosis (measure first — every suspect measured, most acquitted)

The failing allocation was a **16KB heap grow**. An allocation that small
failing means the tab was at its absolute ceiling — the site in the stack is
the canary on duty, not the cause. So the question is what FILLS the tab.
Everything step-proportional was measured under the live regime
(`SIM_TUNE="DAWN_LIVE=1,STATE_RECORDS=1,LAND_KNOW=1"`, seed 8817):

| suspect | instrument | verdict at the crash horizon |
|---|---|---|
| transport frontier heap | `world._transStat` (new, permanent) | **tiny** — cap 4096 (tw=480/23k), cap 65536 = 0.5MB (tw=960/28k) |
| sim world graph, tw=480 | `probe_memgrowth` 30k live | **flat** — heapUsed 73MB; top grower `persons` +25MB (realm-count-proportional, designed) |
| sim world graph, tw=960 | `probe_memgrowth` 28k live | **flat** — heapUsed 63MB, arrayBuffers 120MB (the old "14GB at 45k" record was PRE-fix churn) |
| scrubber timeline | `probe_timelinemem` (new) 30k live | **negligible** — 0.3MB retained at 30k, 69 realms |
| main-thread mirrors/history | code audit | bounded (last-copy slots; charts capped 5000; feed capped 250) |
| worker→main snapshot stream | code audit | **the killer** — see below |

What remained is the snapshot pipeline: `buildSnapshot()` ships fresh
multi-MB transferables ~30×/sec while playing — `roadFlow` (Float32Array(N),
1.8MB at tw=960) every frame; owner + roadQuality + countryClaim every 6th;
lens fields when open. That is **~60-90MB/s of ArrayBuffer traffic at the
shipped grid**, sustained for the whole session, while the unbounded tick
loop re-enters through a MessageChannel and **never idles** — so collection
falls behind allocation until one allocation, any allocation, fails. It is
the same disease the 2026-08-19 fix cured inside the sim, one layer up — and
that fix's own commit message named it as the recorded follow-up ("the
snapshot transfer churn … wants a buffer-return pool"). The rhythm matches
the original report exactly: pausing idles the worker, GC catches up, a few
more years fit.

## The fix (this commit): the reuse-slot idea, stretched across the thread boundary

* **Buffer-return pool.** The main thread's mirror keeps exactly one copy per
  slot; each slot swap in `applySnapshot` strands the displaced array. Those
  buffers now go home: `postMessage({type:"bufret", bufs}, bufs)` back to the
  worker, which pools them by byteLength (`POOL_KEEP` 6 per size class,
  cleared on init/load — N can change). Every per-snapshot array is built by
  `pooledArr`/`pooledCopy` from the pool. Steady state after warmup: **zero
  new ArrayBuffer allocation per snapshot, on both threads.** A pooled array
  is dirty, so every maker overwrites every index — the two skip-pattern
  lenses (`popDens`, `devDens`) get an explicit `fill(0)`; the rest were
  already full-overwrite. The scrubbed `timelineFrame` override returns the
  same way at drag rate.
* **The transport frontier heap joins the persistent-heap family**
  (`world._transHeap`, contents per-firing scratch, never serialized) — it
  measured small, but it re-grew its lanes from 1024 every 480-tick rebuild,
  and it was the recorded failure point. Its high-water stat
  (`world._transStat`) stays: it prints only when the persistent cap grows
  past its all-time peak, so a future REAL frontier runaway names itself
  instead of dying as a mystery OOM.
* Audited, no change needed: draw() caches key on versions and hold canvases,
  never the mirror arrays, so returned buffers cannot be seen detached; the
  worker already auto-pauses on a step throw (the "very long repeated
  postMessage stack" in the owner's console was ONE error's Chrome async-stack
  chain through the tick loop, not an error spam loop).

## Verification

* Hashbase anchors byte-identical (the heap persistence and the stat are
  provably invisible to the sim).
* smoke / validate / resgate / coverage green; `_transHeap`/`_transStat`
  registered as WORLD_SCRATCH (allocator workspace + machine observability,
  not world history).
* The pool is render-plumbing only — no sim semantics anywhere in it.

## What to watch

If a wall ever returns, `[transHeap]` lines in the console are the frontier's
own testimony, and the next layer down is the small structured-clone parts of
each snapshot (settlement rows, stats, feed strings — KBs/frame, minor-GC
fodder, currently harmless). The probes to reach for first:
`probe_memgrowth` (world graph), `probe_timelinemem` (scrubber retention),
`probe_allocchurn` (transient sites) — all run under the LIVE arm, at the
grid that ships.

# HANDOFF — Wave W2 of Simman v2: the banded wasm people kernel

**For:** the implementing agent (Cursor).
**From:** the review session of 2026-09-01 (branch
`claude/world-sim-rebuild-decision-1umpax`).
**Scope:** performance ONLY. The people pass gets its designed wasm +
worker-band kernel behind the existing typed-array API. **Zero physics
change — bit-exact output parity with the current TypeScript kernels is
the acceptance test, not a goal.** Do not start M3; do not implement
annual-cadence stride (that is a separate owner ratification); do not
touch worldgen, the travel router's routing logic, or any substrate data.

## The number this wave exists to close

The spec's standing ceiling is a **full Phase-1 history in ≤30 minutes**
at the shipped grid. Measured today (M2 review, seed 42042, earth_sim):
the people pass runs ~210 ms/tick warm at target (1800×900, 1.62M cells)
— YD→1 CE is 116,412 monthly ticks ≈ **6.8 hours**, 13× over budget.
Per-cell the TS kernels already beat v1 (0.13 µs/cell/tick vs v1
popField's 0.17–0.39 at 115k cells); the workload is simply 14× the
cells at 12× the ticks per year, by design (R3; monthly climate). The
M2 handoff mandated pure typed-array band-kernel SHAPE precisely so this
drop-in could land without touching physics. Target: **≤15 ms/tick at
the shipped grid on CI-class hardware** (goal; ≤20 ms acceptable with
the arithmetic shown) → YD→1 CE in ~30–40 min, and the full-horizon gate
finally runs at the grid that ships.

## Required reading, in order

1. `spec/handoffs/M2.md` §7 (budgets) and ruling 1 (cadence rules —
   which this wave must NOT use).
2. `v2/QUESTIONS.md` #29–#32 — the M2 review record: what was measured,
   which optimizations already landed (row-local edge math, per-month
   cost caches, static habitability LUTs), and the hash-identity
   discipline this wave inherits.
3. `v2/src/sim/people/*.ts` — the kernels to port. These stay in the
   tree as the REFERENCE implementation and parity oracle.
4. v1 `src/sim/peopleSim/popFieldKernel.js` header — the band-kernel
   bit-identity contract this wave re-founds (fixed band layout,
   deterministic reductions).
5. `v2/rust/router/` and `v2/package.json` wasm scripts — the existing
   Rust→wasm build pipeline to mirror.
6. `v2/src/sim/dmath.ts` + `tools/lib/dmath-check.ts` — the golden
   discipline any Rust transcendental must join.
7. `v2/src/sim/worker.ts`, `src/shell/main.ts` worker section, and
   `tools/gate-people.ts`.

## Ground rules (non-negotiable)

- **Bit-exact parity.** For identical inputs, the wasm kernels produce
  byte-identical `people`, `technique`, cohort, and scratch-visible
  fields to the TypeScript reference, at both grids, over hundreds of
  ticks. IEEE 754 double ops (`+ − × ÷ sqrt`) are deterministic across
  JS and Rust; keep the SAME operation order as the TS code —
  re-association is a physics change here. The only transcendental in
  the pass is `dpow` (graveyard mortality): port dmath's `dpow` (and
  anything else you find you need) to Rust EXACTLY and extend the
  bit-golden vector check to the wasm build.
- **Fixed band layout, worker-count independence.** Bands are a fixed
  row partition derived from the GRID (e.g. 16 contiguous row bands),
  never from the worker count. Workers claim bands; per-band partial
  reductions (births, deaths, migration totals) are combined in
  ascending band order on one thread. Result: the world hash is
  IDENTICAL for 1, 2, or 8 workers, and identical to the single-thread
  TS reference. This is asserted, not assumed.
- **Band safety by construction.** The kernels are already double-
  buffered gathers over frozen inputs: growth is per-cell independent;
  migration's gather reads only the frozen source-scan records; the
  technique spread reads the frozen previous field. Sequential preludes
  (hearth ignition, remainder deposit) stay sequential on the
  coordinating thread. Cross-band reads of frozen arrays are safe;
  cross-band WRITES are forbidden — if you find one, the port is wrong.
- **State lives in wasm linear memory; JS holds views.** Copy-in/out
  per tick (~130 MB) would eat the win. The people FIELD_LIST entries
  allocate inside the wasm instance and expose `Float64Array` views;
  save/load, `hashWorld`, the collector, and the shell snapshot read
  the views unchanged. Views invalidate if wasm memory grows — size the
  allocation up front per grid and assert it never grows mid-run.
- **The TS kernels remain the oracle, selected by an explicit lever**
  (env/config), default wasm where available, TS otherwise. Procedural
  presets, the worldgen oracle, travel gates: untouched.
- Branch `cursor/v2-w2` from `claude/world-sim-rebuild-decision-1umpax`.
  QUESTIONS.md and the constants ledger are the sanctioned append
  points; conventional commits; no new runtime dependencies (wasm-pack
  and the workspace toolchain already exist).

## Deliverables

### 1. `rust/people/` — the kernel crate

Port `grow`, `migrate` (source scan, debit, gather, remainder),
`stepTechnique`'s spread loop, and `deriveCapacity` as band functions
over a shared SoA in linear memory. `basinFill`/hearth logic and
`normalizeCohorts` may stay in TS if profiling shows they don't matter
(they are O(hearths·basin) and O(land)); state which you chose and why.
Mirror the wasm-pack build of `rust/router` (`npm run wasm:build`
extends to both crates).

### 2. `tools/kernel-parity.ts` — the parity harness, joined into `npm test`

Runs the reference TS pass and the wasm pass side by side from the same
seed at BOTH grids — ≥240 ticks dev, ≥24 ticks target — and asserts
byte-equality of every people field and equality of `hashWorld` at every
audited step. Repeats the wasm run at 1 and N workers and asserts the
hashes identical. This is the wave's acceptance instrument; it fails, the
wave isn't done.

### 3. Worker banding

- Node (gates, bench, smoke): `worker_threads` + `SharedArrayBuffer`
  over the wasm memory.
- Browser: Web Workers + SAB, which requires cross-origin isolation —
  add the COOP/COEP headers to the vite dev/build config and VERIFY the
  shell still loads its data modules under isolation. Where SAB is
  unavailable, fall back to single-thread wasm (still a real speedup)
  — detected, not configured.
- The tri-engine browser smoke asserts the chromium hash equals node's
  (the existing identity check now covering the wasm path).

### 4. Gate promotion — the verdict moves to the shipped grid

- `GATE_PEOPLE_LONG=1` now runs the full YD→1 CE arm at TARGET (the M2
  handoff: "dev is the fast sanity, target is the verdict"), with dev's
  full arm kept as the quick check.
- People known-miss ids gain grid scoping (`population:-5000:target`),
  mirroring the travel manifest. Re-measure the target curve and
  arrivals honestly and write its manifest rows with physical reasons —
  they will differ from dev's numbers; do not copy them.
- The default per-commit gate keeps the mechanical + 3000-year
  trajectory arms (now cheap).

### 5. Bench + the arithmetic

New baselines at both grids with the ratchet re-anchored. The PR states:
ms/tick before/after at target, the worker count used, the projected
YD→1 CE wall-clock, and the ≤30-min ceiling arithmetic. If the ceiling
is still missed, that is a QUESTIONS.md finding with the numbers — not a
reason to touch physics.

## Acceptance (what "done" means)

`lint && test && smoke && gate && bench -- --check && oracle && build`
green at both grids, where `test` now includes the parity harness;
worker-count independence asserted; browser chromium hash identical to
node through the wasm path; the target-grid long arm run once with its
manifest written; QUESTIONS.md updated; PR from `cursor/v2-w2` titled
`v2 W2 — banded wasm people kernel`, body listing each deliverable with
measured numbers. Review happens against this document, line by line.

## What NOT to do (recap)

No physics or constant changes of any kind — parity is byte-exact. No
annual-cadence stride (separate ratification; ruling 1's trajectory
clause applies). No re-association of float arithmetic. No band layout
derived from worker count. No copy-per-tick memory traffic. No touching
worldgen, substrate data, travel costs, or the router crate's logic. No
second population representation — the wasm SoA IS the field storage,
viewed, never mirrored.

## Status at merge (2026-09-02, review)

Delivered: deliverables 1, 2, 4 (gate promotion wiring), 5, and the
cross-origin isolation half of 3. **Open — W2b:** deliverable 3's actual
parallelism. The merged kernel dispatches its 16 bands serially; the
worker count is a label and the SharedArrayBuffer control plane is a
stub. Measured on the review runner: target tick 361→169 ms cold
(~2× from wasm alone) against the 10–20× this handoff asked for, so the
≤30-minute ceiling is still missed (~5.5 h). W2b needs a shared-memory
wasm build (`+atomics,+bulk-memory`, threads-enabled std) with
`worker_threads`/Web Workers claiming bands from the control plane —
or the owner ratifies annual-cadence stride as the alternative lever.
**Resolved 2026-09-02:** both, as one wave — `spec/handoffs/W3-cadence.md`
(DECISIONS 24). W2b is its second half.

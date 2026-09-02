# HANDOFF — Wave W4 of Simman v2: the land-packed people kernel

**For:** the implementing agent (Cursor).
**From:** the review session of 2026-09-02 (branch
`claude/world-sim-rebuild-decision-1umpax`). **Branch from the commit that
merges W3** — this wave builds on the threaded, hash-checked kernel and
uses it as its oracle.
**Scope:** memory traffic in the people kernel. Zero physics change. The
schedule, the strides, the peopled mask, the band doctrine, and every
constant stay exactly as W3 left them.

## The number this wave exists to close

W3 measured the shipped tick at the target grid (Cursor's 4-core runner):
110 ms all-monthly → 73 ms with annual growth, and then **threads did
almost nothing** — migration 54.5 ms serial → 49.4 ms on eight threads.
The ceiling (full YD→1 CE in ≤30 min) is **≤15.5 ms per tick**; the wave
landed at 62–73 ms, ~4× over (QUESTIONS #34, W3 table).

The reason is not arithmetic. The migration pass moves a lot of bytes for
little maths: per firing it fills or copies six full-grid arrays (each
1.62M × 8 B = 13 MB), walks the whole grid three more times to add up the
conservation totals, and every one of those arrays spans all 1.62M cells
although **71% are ocean and are skipped**. Four cores share one memory
bus; when the bus is the limit, threads queue instead of scaling. The
lever is therefore the amount of memory touched per firing, not the
number of workers. Shrink the traffic and the threads W3 built start to
pay.

The warehouse picture, for the record: W3 hired more workers; W4 shrinks
the building so they stop queueing at the door.

## Required reading, in order

1. `spec/handoffs/W3-cadence.md` and its status at merge; `v2/QUESTIONS.md`
   #34 (the phase split and the thread table).
2. `v2/rust/people/src/lib.rs` — every `fill`, `copy_from_slice`, and
   whole-grid `for cell in 0..self.cells` loop is a candidate; list them
   in deliverable 0.
3. `v2/src/sim/people/*.ts` (the TypeScript oracle), `src/sim/
   peopleKernel.ts`, `src/sim/people/bands.ts`, `tools/kernel-parity.ts`,
   `tools/bench.ts` (`cadenceBench`).
4. `spec/02-architecture.md` §Determinism (band reductions in ascending
   band order; no float atomics).

## Ground rules (non-negotiable)

- **Byte-exact parity is still the acceptance instrument**, with one
  precisely named allowance below (summation order). TS oracle ↔ serial
  wasm ↔ threaded pool at 1, 2, 8 workers, both grids, the existing tick
  counts; the stride arm re-run at dev (default gate) and target
  (3000-year trajectory) to show no trajectory change.
- **The saved fields keep their full-grid layout and their views.** `people`,
  `technique`, `children`, `working`, `elders`, `capField` stay full-grid
  `Float64Array` views into wasm memory: `hashWorld`, save/load, the
  collector, and the shell read them unchanged. **Only scratch and
  iteration are packed.** Nothing about which cells are simulated
  changes — the peopled/land masks keep their meaning exactly.
- **The band layout stays grid-derived and worker-independent.** Bands
  become contiguous ranges of the packed land list, cut at row
  boundaries (so a band is still a set of whole rows, and the W2/W3
  write-disjointness argument is unchanged).
- **Summation order is the one thing you may change**, and only like
  this: every per-firing total (births, deaths, migration out, migration
  received) becomes per-band partials combined in ascending band order,
  in the TS oracle AND the kernel, identically. This moves the
  conservation remainder by an ulp or two relative to W3 — that is
  allowed because it is a summation order, not physics — and the stride
  arm is what proves it. State the measured delta. Nothing else may
  change a result bit.
- No re-association of the per-cell arithmetic; no new constants; no
  physics; no touching travel, worldgen, substrate, the router, or the
  scheduler. Branch `cursor/v2-w4`; QUESTIONS.md and the constants ledger
  are the sanctioned append points; scratch probes never committed.

## Deliverables

### 0. The traffic ledger (measure first)

Before any change: for each phase of one shipped-schedule target firing,
the bytes read + written (count the arrays × cells × width per loop, and
confirm with a timing per loop), split into (a) per-cell banded work and
(b) serial whole-grid fills, copies, and sums. Post the table in
QUESTIONS.md. It is the baseline the rest of the wave is judged by; the
expected finding is that (b) plus ocean-skipping dominate migration.

### 1. Pack the land

- A packed land index: `land_cells: Vec<u32>` in row-major order (the
  existing `_landCells` order), and its inverse `packed_of: Vec<i32>`
  over the full grid (−1 for ocean). Both built once at construction.
- **Every scratch array becomes packed** (length = land count): people
  next, cohort masses and nexts, migration out / weight / population /
  received, technique next. The per-cell loops iterate the packed range
  of their band; neighbour lookups go through `packed_of` (a read-only
  4-byte gather per neighbour against the 8-byte data it replaces).
- Whole-grid fills and copies become packed fills and copies — and,
  where the value is written by every cell of the following phase anyway,
  no fill at all (say which).
- Commit (`commit_population`), `normalize_cohorts`, and the ledger's
  field sum iterate the packed land list; the full-grid saved fields are
  written through the index.
- The TS oracle gets the same packing, in the same order, so parity stays
  byte-exact.

### 2. Fold the serial passes into the bands

- `begin_migration`'s copies and the growth-prepared / migration-only
  setup become part of the first banded phase (each band prepares its own
  rows), not a serial prelude.
- `finish_migration`'s three whole-grid sums disappear: totals are
  per-band partials from the phases that already touch the data, combined
  in band order (the allowance above). The remainder cell logic is
  unchanged apart from which total it receives.
- `migration_total()` returns the combined partials, not a re-sum.
- After this, the serial part of a firing should be the remainder deposit
  and the barriers. Measure it and say what is left.

### 3. Narrower scratch (optional, measured, in lockstep)

Only after 1 and 2 are measured: scratch that is cleared every firing may
be stored as `f32` **with all arithmetic still in f64** — load, compute in
f64, round on store — which is exactly what a JS `Float32Array` does, so
the TS oracle switches to `Float32Array` for the same arrays and parity
stays byte-exact. Candidates: migration weight, migration out, received.
NOT candidates: anything that carries population between firings, the
cohort masses, the technique next field. Report the traffic and time
delta per array; drop any that does not pay. If the stride arm moves
outside its tolerance for any of these, that array stays f64 — no
tolerance edits.

### 4. Re-measure threads and the ceiling

`bench.ts`'s cadence table again, same configs, same runner class, plus
the traffic ledger after. The PR states: bytes per firing before/after,
ms per tick serial and at N threads, the barrier cost, and the projected
YD→1 CE wall-clock with the core count. Expectation, written so it can be
wrong: packing alone takes migration from ~54 ms to ~16–20 ms serial
(≈3.4× less traffic), the folded passes remove most of the rest of the
serial tail, and four threads then reach the ~15 ms line; eight real
cores clear it. If the line is met only above some core count, write
that as the finding, as W3 did.

## Acceptance (what "done" means)

`lint && test && smoke && gate && bench -- --check && oracle && build`
green at both grids; parity byte-exact across TS / serial / 1, 2, 8
threads; the stride arm passes at dev and at the target 3000-year
trajectory, with the summation-order delta reported; Chromium hash equal
to Node's through the threaded path; the traffic ledger before and after
in QUESTIONS.md; README's kernel paragraph updated; PR from `cursor/v2-w4`
titled `v2 W4 — land-packed people kernel`, body listing each deliverable
with measured numbers. Review is line by line against this document.

## What NOT to do (recap)

No physics or constant changes. No change to which cells are simulated
or to the peopled mask. No packing of the saved fields or their views. No
band layout from worker count; no float atomics. No f32 arithmetic (f32
storage with f64 arithmetic only, and only in deliverable 3). No stride
or schedule changes. No touching travel, worldgen, substrate, router, or
scheduler. No tolerance edits to pass the stride arm.

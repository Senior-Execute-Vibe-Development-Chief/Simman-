# HANDOFF — Wave W3 of Simman v2: the pass scheduler, and real threads (W2b)

**For:** the implementing agent (Cursor).
**From:** the review session of 2026-09-02 (branch
`claude/world-sim-rebuild-decision-1umpax`).
**Scope:** two performance deliverables that together close the ≤30-minute
full-Phase-1 ceiling, in this order:

- **W3a — the multi-rate scheduler.** The world keeps one monthly clock;
  every pass declares its own stride and phase; the people pass splits into
  a GROWTH pass (annual) and a MIGRATION pass (at the stride its own physics
  bounds — monthly at the shipped grid). Cross-rate coupling goes through
  delta ledgers, never through direct reads of a field mid-stride.
- **W3b — real worker threads for the band kernel** (the open W2b item):
  a shared-memory wasm build with `worker_threads` / Web Workers claiming
  bands, hash-identical to the serial dispatch.

**Zero physics change is still the contract**, with one precisely stated
exception: a pass at stride k integrates k months in one firing. Ruling 1
of M2 (the tick is one month; cadence is performance scheduling only;
any pass whose stride measurably changes trajectory declares stride=1)
is the law this wave implements — and the acceptance instrument MEASURES
the trajectory difference rather than assuming it away. Do not start M3;
do not touch worldgen, substrate data, travel costs, or any people
constant.

## Why this is the right shape (owner conversation, 2026-09-01/02)

Cost is cells × passes, and the expensive passes are the SLOW-changing
ones. Population growth, technique, capacity are dense fields over 1.62M
cells that move on decadal timescales; updating them monthly spends 12×
the compute resolving change that is not happening. The fast-changing
things — armies, harvests, trade windows — are sparse or cheap. Matching
each process's update rate to its own timescale is the standard
multi-rate design: fidelity where things move fast, cost only where
things are dense. The v1 scars (POP_FIELD_STRIDE, the SETT_STRIDE lcm
bug — `spec/research/02` §141/§183) are exactly the failure modes this
wave designs against, so read them first.

**The honest limit — migration's step is bounded by physics, not by
choice.** Migration is explicit diffusion with per-firing outflow share
`s = D · dt / area` (`PEOPLE_MIGRATION_DIFFUSIVITY_KM2_PER_YEAR` = 1200
km²/yr). At the shipped grid a cell is ~494 km² at the equator, ~247 km²
at 60° and ~170 km² at 70°: the ANNUAL share is 2.4 / 4.9 / 7.1 — far
above the stability bound `PEOPLE_MIGRATION_MAX_SHARE` = 0.5. Today's
kernel handles that with an analytic sub-step formula that SATURATES at
0.5 per firing; run annually it would halve equatorial mobility and cut
northern mobility 3–5×, which changes wave-of-advance arrival times —
a measurable trajectory change, so ruling 1 says stride=1. Real
sub-gathers instead of the analytic form would cost 5–16 gathers per
year: no saving. Even monthly, share is 0.20 at the equator and 0.59 at
70° (already sub-stepped analytically today — no change). At the DEV
grid (170 km cells, ~29,000 km²) the annual share is 0.04 and annual
migration is perfectly stable. **This is R3 in time: the cadence a
mechanism can bear depends on the grid.** So the migration stride is
DERIVED from the bound at the grid, never configured by hand (below).

Consequence for the owner's expectation: "people yearly" means people
GROWTH yearly. People MOVEMENT stays monthly at the shipped grid. The
cadence win is therefore the growth/technique/capacity/cohort share of
the tick — not 12× of the whole tick — and threads (W3b) are what
finishes the ceiling. Measure the split first (deliverable 0).

## Required reading, in order

1. `spec/02-architecture.md` §Scheduling (extended by this wave — the
   delta-ledger coupling doctrine) and §Determinism.
2. `spec/handoffs/M2.md` ruling 1; `spec/handoffs/W2-kernel.md` whole,
   including its "Status at merge" (what W2b is).
3. `v2/QUESTIONS.md` #32–#33 (the M2/W2 review records).
4. `v2/src/sim/world.ts` (`stepWorld`, `hashWorld`), `src/sim/people/
   index.ts` (`stepPeople` — the phase order this wave splits),
   `src/sim/peopleKernel.ts` (the band dispatch), `src/sim/people/
   bands.ts`, `rust/people/src/lib.rs`, `src/sim/conservation.ts`.
5. `tools/gate-people.ts` (`runTrajectory`, the `measured` set, grid-
   scoped manifest ids), `tools/kernel-parity.ts`, `tools/bench.ts`.
6. `spec/research/02-investigations-dossier.md` §141, §183 (the stride
   scars) and `spec/research/03-tuning-registry-dossier.md` §415
   (`passWindow`).

## Ground rules (non-negotiable)

- **One clock.** `world.step` and `world.calendarMonth` advance one month
  per `stepWorld`, always. No pass ever advances the clock; no pass ever
  reads the clock to decide whether history may happen (R1). A stride
  controls how often code RUNS, never whether a thing is ALLOWED yet.
- **Every cadence check goes through one helper.** `passFires(world,
  stride, phase)` in a new `src/sim/scheduler.ts`; no `step % N` anywhere
  else in `src/sim/`. Add an eslint rule (or `ledger-lint` check) that
  fails on `% MONTHS_PER_YEAR` / `step %` outside `scheduler.ts`.
- **Strides are world identity.** The resolved stride and phase of every
  pass are part of `hashWorld` (unlike `peopleKernel`/`peopleWorkers`,
  which are execution details). Two worlds at different strides are
  different worlds; the gate is what says whether that difference is
  measurable. Saves carry the schedule (`SAVE_VERSION` bump) and refuse
  to load into a different one.
- **Rates × dt, verbatim.** A pass firing at stride k receives `dtMonths
  = k` and applies every per-year rate as `rate × dtMonths /
  MONTHS_PER_YEAR` where the code today applies `rate / MONTHS_PER_YEAR`.
  Same operation order otherwise: at stride 1 the output is BYTE-
  IDENTICAL to today's (this is asserted). No re-association, no new
  constants inside kernels.
- **Cross-rate coupling is by ledger, never by reach-in.** A pass may
  only read fields owned by another pass as they stood at that pass's
  last commit, and may only CHANGE them by posting a delta into a named
  accumulator that the owning pass consumes at its next firing (booked
  through the conservation ledger as a channel). Nothing this wave ships
  needs an accumulator yet (growth and migration commute through the
  shared `people` field, see W3a.3) — but the helper and the doctrine
  land now, because M3's food pass is the first real consumer.
- **Determinism unchanged.** Fixed band layout; per-band partial
  reductions combined in ascending band order on one thread; no float
  atomics; the world hash identical for 1, 2, N workers AND identical to
  the serial dispatch. Asserted, never assumed — and this time with real
  threads, so the assertion is no longer vacuous.
- **The TS kernels stay the oracle** (`peopleKernel: "ts"`), extended to
  the new phase split so parity keeps meaning something.
- Branch `cursor/v2-w3` from `claude/world-sim-rebuild-decision-1umpax`.
  QUESTIONS.md and the constants ledger are the sanctioned append points;
  conventional commits; scratch probes never committed.

## W3a — the scheduler

### 0. Measure the split first

Before any change: at both grids, warm, 12 ticks, the ms per phase of the
wasm people pass — technique, capacity, growth, migration (source /
debit / gather), cohort normalize, ledger assert. Post the table in
QUESTIONS.md. It fixes the arithmetic the rest of this wave is judged by
(the M2 review's rounds were all on migration; expect it to dominate).

### 1. `src/sim/scheduler.ts`

```ts
interface PassSchedule { readonly name: string; readonly stride: number; readonly phase: number; }
// stride in months; phase in [0, stride). Fires when (step − phase) mod stride === 0.
export function passFires(world, schedule): boolean
export function passDtMonths(schedule): number   // = stride
export function resolveSchedule(world): readonly PassSchedule[]  // the pass list, in order
```

- The pass list is explicit and ordered: `people.technique`,
  `people.capacity`, `people.growth`, `people.migration`, then `people.
  cohorts`; M3 appends. `stepWorld` iterates the list and fires what is
  due; `debug.peoplePasses` becomes per-pass firing counts.
- **Inner cadences snap to the stride grid** (the lcm scar): a pass may
  not carry its own second-level `% N`; anything that needs a slower
  rhythm is a separate pass with its own schedule entry.
- Phase for annual passes: fire on `calendarMonth === 0` of the world's
  clock (phase 0). Nothing in growth depends on the season; document that
  and leave phase configurable so M3's harvest passes can pick theirs.
  Pass cadence is GLOBAL; the timing of a local event inside a firing
  (when a cell's harvest comes in) is LOCAL, from the cell's climate — a
  southern-hemisphere harvest is booked in the firing after ITS growing
  season, not in October. Not built here; the doctrine is written so the
  scheduler is not designed to prevent it.

### 2. Strides

| pass | stride | how set |
|---|---:|---|
| `people.technique` | 12 | `peopleGrowthStride` config, default 12 |
| `people.capacity` | 12 | same (derived from technique; fires with it) |
| `people.growth` | 12 | same |
| `people.cohorts` | 12 | same (normalizes after growth) |
| `people.migration` | **derived** | largest divisor of 12 whose per-firing share on every peopled row ≤ `PEOPLE_MIGRATION_MAX_SHARE` (target → 1; dev → 12); `peopleMigrationStride` config overrides for gate arms only |

The derivation is a performance cadence chosen by a physics bound — it is
NOT a content gate — and it is printed in provenance. If you find the
derived target stride is anything but 1, the arithmetic above is wrong;
say so in QUESTIONS.md with the row shares.

### 3. The people pass, split

Today `stepPeople` runs technique → capacity → grow → migrate → commit →
cohorts every tick, with `grow` writing `_peopleNext` and `migrate`
debiting/gathering on it. Under the split:

- **Growth firing (annual):** technique(dt) → capacity → grow(dt) → the
  cohort ageing at dt → writes `_peopleNext` and cohort masses exactly as
  now with `dtMonths = 12`. Births/deaths booked to the ledger for that
  firing.
- **Migration firing (monthly at target):** on a month with no growth
  firing, `begin_migration` must START from `people` (copy → `_peopleNext`,
  or gather directly into next from current) — today it assumes grow ran
  first. Cohort masses on such a month are `share × people` (the existing
  `cohortShareOf`), so migration keeps moving cohort mass with people.
  Migration total booked to the ledger per firing.
- **Commit** happens at the end of any month in which either fired;
  `normalizeCohorts` runs after every commit (it is O(land), cheap; keep it
  so `children/working/elders` are always consistent with `people`).
- **Order within a month where both fire** (January at target; every
  firing at dev): growth first, migration second, as today, so stride 1
  everywhere reproduces the current output byte-for-byte.
- Hearth ignition's peopled-basin-years accumulate per FIRING in years
  (`dtMonths / MONTHS_PER_YEAR`), so the arming bar is unchanged in
  years. The technique wave spreads `PEOPLE_TECHNIQUE_WAVE_KMPY × dt`
  per firing (1 km/yr against 22 km cells: no CFL concern; say so with
  the number).
- The ledger (`beginPass`/`endPass`/`assertAll`) runs per firing, in
  persons, as now.

Port the split to BOTH kernels (TS oracle and Rust) with identical
operation order. `dtMonths` enters the Rust kernel as an argument to the
band functions, never as a global.

### 4. The trajectory instrument (`tools/gate-people.ts`)

Ruling 1's "measurably changes trajectory" gets a definition and a gate:

- A new **stride arm**: run the trajectory twice — reference schedule
  (all strides 1) and shipped schedule — from the same seed, and compare
  at every population checkpoint and every farming arrival. Pass if
  `|Δpop| / pop_ref ≤ CADENCE_TRAJECTORY_POP_TOLERANCE` (0.02) at every
  checkpoint AND `|Δarrival| ≤ CADENCE_TRAJECTORY_ARRIVAL_TOLERANCE_YEARS`
  (25) for every region reached in both. Fail otherwise — and a failure
  means THAT pass's stride is 1 (its contract), not a tolerance edit.
- The stride arm runs in the default gate at dev for the 3000-year
  trajectory horizon (cheap) and under `GATE_PEOPLE_LONG=1` for the full
  YD→1 CE horizon at both grids. Report the deltas as numbers in the
  findings even when passing.
- The manifest rows stay grid-scoped; the shipped schedule is the one the
  manifest describes (its ids do not change — stride is not a grid).
  Re-measure and rewrite the rows honestly if any moves outside its band.
- Stride 1 at both kernels must be BYTE-IDENTICAL to HEAD before this
  wave (hash equality against the pre-wave commit, 240 dev / 24 target
  ticks, both kernels). This is the "no physics change" proof.

### 5. Shell and worker

- The shell's speed slider is in sim-months per second as today; the
  status line gains the firing schedule (`growth 12 · migration 1`).
- `hashWorld` includes the resolved schedule; `collect()` exposes per-pass
  firing counts; `npm run coverage` and `npm run monotone` still pass
  (firing counts are cumulative — name them so).

## W3b — real threads for the band kernel

### 6. The shared-memory build

- `rust/people` gains a threaded build variant: `-C target-feature=
  +atomics,+bulk-memory,+mutable-globals`, std built with atomics
  (`-Z build-std=std,panic_abort` on a PINNED nightly — write the pin in
  `rust/people/rust-toolchain.toml` or the npm script, never "nightly"
  floating), linked with `--shared-memory --import-memory
  --max-memory=<sized per grid>`. Keep the current single-thread build as
  a second artifact (`src/wasm/people/` and `src/wasm/people-threads/`);
  the loader picks threads only where `SharedArrayBuffer` and
  `crossOriginIsolated` are real (node `worker_threads` always qualifies).
- The band functions must not go through wasm-bindgen's `&mut self`
  borrow flag from multiple threads. Expose free functions taking the
  kernel pointer + `(raw_lo, raw_hi, dt_months)`; the band layout is the
  proof of write-disjointness (cross-band READS of frozen arrays only —
  the W2 rule). Each worker instantiates the SAME module against the
  SAME shared `WebAssembly.Memory`, with its own shadow stack / TLS
  region allocated by the coordinator before dispatch.
- Reductions: each band writes its partial (`births`, `deaths`,
  `migration_total`) into a per-band slot; the coordinator sums slots in
  ascending band order. No `Atomics` on floats, ever.
- Per-phase barrier via `Atomics.wait/notify` on the existing control
  plane (`bands.ts` `BandControl` — make the stub real: a phase counter,
  a claim counter, per-band done flags). ~8 barriers per tick; measure
  their cost and print it.
- **Fallback design if the threaded-std toolchain proves unstable** (say
  so in QUESTIONS.md before switching): halo exchange — each worker owns
  its band's rows in its OWN instance, halos (one row per side of the
  frozen inputs) exchanged per phase by `postMessage`, fields gathered
  into the coordinator's views at snapshot/hash/save cadence rather than
  per tick. It needs no shared memory and no COOP/COEP, at the cost of
  the W2 "views, never mirrored" contract — which then becomes "views at
  commit cadence", documented. Either design is acceptable; both must
  pass the same identity assertions.

### 7. Workers

- Node: `worker_threads`, `peopleWorkers` default `min(os.cpus().length
  − 1, PEOPLE_BAND_COUNT)`, floor 1.
- Browser: `Worker` pool inside `src/sim/worker.ts` (the sim worker
  becomes the coordinator), default `min(navigator.hardwareConcurrency −
  1, PEOPLE_BAND_COUNT)`. COOP/COEP are already in `vite.config.ts` for
  dev and preview; VERIFY the deployed shell is cross-origin isolated
  (`crossOriginIsolated === true` in the tri-engine smoke) and, where the
  host cannot send the headers, that the single-thread path is what runs
  — detected, logged in the status line, never a silent 1-worker label.
- `kernel-parity.ts`: worker-count independence now asserted with REAL
  threads (1 vs 2 vs 8 hashes) and against the serial dispatch; the
  Chromium smoke asserts the threaded browser hash equals node's.

### 8. Bench and the arithmetic

`bench.ts` reports, at target: ms per tick for (serial, N threads) ×
(stride 1, shipped schedule), the barrier overhead, the worker count and
`os.cpus().length`, and the projected YD→1 CE wall-clock for each. New
baselines, ratchet re-anchored on the REVIEW runner's numbers (the W2
lesson: a faster dev box's baselines fail the ratchet here).

The ceiling arithmetic to fill in (target, 116,412 monthly ticks; ≤30 min
means **≤15.5 ms per tick amortized**):

| | per tick today | after W3a (growth annual) | after W3b (N threads) |
|---|---:|---:|---:|
| growth+technique+capacity+cohorts | g | g / 12 | g / (12·N) + barrier |
| migration (monthly at target) | m | m | m / N + barrier |
| ledger assert, commit | ℓ | ℓ | ℓ |

with g, m, ℓ from deliverable 0 (g + m + ℓ ≈ 169 ms cold / ~122 warm on
the review runner). Expectation, stated so it can be wrong: W3a alone
takes the tick to roughly m + ℓ — a real but partial win, because
migration is the physics-bound part; with 8 threads the shipped grid
lands near the 15 ms line, and a 4-core machine near 25–30 ms (~50–60
min). If the ceiling is met only above some core count, that is the
finding: write it, with the count, in QUESTIONS.md and README.

## Acceptance (what "done" means)

`lint && test && smoke && gate && bench -- --check && oracle && build`
green at both grids, where:

- `test` includes parity (TS ↔ wasm, stride 1 ↔ pre-wave HEAD hash, 1/2/8
  REAL workers ↔ serial) and the scheduler unit tests (`passFires` over
  phase/stride grids; the lcm case from the v1 scar as a regression).
- `gate` includes the stride arm with its deltas printed; the shipped
  schedule passes the tolerances or the offending pass is at stride 1
  and the finding says why.
- The migration stride is derived (target 1, dev 12) and printed.
- The threaded build runs in node and in cross-origin-isolated Chromium
  with identical hashes; non-isolated hosts fall back detectably.
- QUESTIONS.md carries: the phase split table, the stride-arm deltas at
  both grids, the bench table above filled in, and the core-count
  arithmetic. README's W2 paragraph is rewritten to what now ships.
- PR from `cursor/v2-w3` titled `v2 W3 — pass scheduler and threaded band
  kernel`, body listing each deliverable with measured numbers. Review is
  line by line against this document.

## What NOT to do (recap)

No physics or constant changes beyond `rate × dt`. No stride on
migration by hand — derived from the bound or it is 1. No `% N` outside
`scheduler.ts`. No tolerance edits to make the stride arm pass. No float
atomics; no band layout from worker count; no per-tick copy of fields.
No "workers" label without threads behind it. No M3 mechanics (harvest,
famine, accumulators with consumers) — only the coupling helper and the
doctrine. No touching worldgen, substrate data, travel, or the router.

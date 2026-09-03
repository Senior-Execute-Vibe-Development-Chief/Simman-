# HANDOFF — Wave W5 of Simman v2: the peopling solve and the wake

**For:** the implementing agent (Cursor).
**From:** the spec session of 2026-09-03 (branch
`claude/world-sim-rebuild-decision-1umpax`). **Branch from the commit that
merges this branch into main** (2ac9948a or later: it carries the M3a
review kernel, the 32-bit world hash and the mechanical CI). Twice a wave
has branched from a main that lacked the previous review's kernel fixes
and had to be re-merged by hand.
**Scope:** prehistory stops costing ticks. Before anything in the world
can push back on the people field, the only thing that moves is the
farming front, and its own diffusion bound permits a multi-year step. The
people kernel runs that regime — the same passes, the same two kernels —
from the opening until the first basin is caged, in seconds at the shipped
grid, then wakes into the monthly regime it runs today. The peopling
becomes scrubbable, the reality tables for the front and the population
curve become per-commit measurements at both grids, and a player can
start the world at any year. **No new physics.** Do not change the growth,
conversion, hearth or hop laws except where named; do not start M3b; do
not touch the thread pool, worldgen or the substrate builders. This wave
replaces the performance wave sketched after the M3a review.

## Why (owner, 2026-09-03)

> "ALL of this we work on is covering the pre history phase, before
> anything interesting actually happens. do we NEED to model several
> thousand years of predictable people growth?" — "is it not far more
> deterministic than we make it to be? do we REALLY need to simulate
> actual year by year movement?"

No. The monthly tick exists for one reason: the forager diffusion bound.
Foragers hop `PEOPLE_MIGRATION_DIFFUSIVITY_KM2_PER_YEAR / area` of
themselves a year — 2.4 hops a year at the equator of the shipped grid,
unbounded toward the poles — and an explicit diffusion step may move at
most half a cell's people per firing, so migration fires monthly and the
whole kernel runs 116,000 ticks from the Younger Dryas to 1 CE. Two to
three hours on three threads at the shipped grid (QUESTIONS #37), and most of
those ticks fall before the first city could exist.

But before anything pushes back on the people field, the forager field
carries no information that needs a monthly clock. It opens at a uniform
fraction of capacity and fills logistically in place; its diffusion moves
no net mass to first order. The one thing that MOVES is the farming
front, and farmers hop eighty times more slowly than foragers
(`PEOPLE_FARMER_MOBILITY_KM2_PER_YEAR`, 15 against 1200): the same bound
that forces a monthly forager step permits a seven-year farmer step at the
shipped grid. The state at any pre-wake year is a function of the map and
the constants — the kernel merely evaluates that function 116,000 times
where 1,400 evaluations would do.

So: run the kernel's own passes at the stride the farmer bound permits,
without forager hops, until the first basin is caged — the first state
from which anything in the ladder (M4's taking) could push back — and wake
the monthly kernel there. The prehistory then costs seconds, plays on the
map as it is solved, scrubs, and is measured against every arrival window
and population band at both grids on every commit. What it does NOT buy
is the awake kernel's cost; that remains the row-cadence question W3
left open and is not this wave's.

QUESTIONS #39 carries the analysis: which bounds set the stride, what
the multi-year regime omits and how large that is expected to be, the two
regimes of the lattice front at the two grids, and where the wake is
expected to land on the current kernel.

## Required reading, in order

1. `spec/02-architecture.md` §Scheduling (a stride derived from a physics
   bound at the grid), §The state (box 5: rendering condensations are
   never state), §Persistence.
2. `spec/handoffs/W3-cadence.md` (the scheduler and the stride arm) and
   `spec/handoffs/M3a-wave.md` with its status section (the kernel you
   inherit: farmers as per-package masses, the pair spare, the farmer
   mobility, the hearth law); `spec/handoffs/M2.md` (the peopled-basin
   law).
3. `v2/QUESTIONS.md` #37 (the M3a review: measurements, cost table), #38
   (the dev loop), #39 (this wave's analysis).
4. `v2/src/sim/scheduler.ts`, `src/sim/world.ts`, `src/sim/people/index.ts`,
   `migration.ts`, `growth.ts`, `technique.ts`, `capacity.ts`, `crop.ts`;
   `rust/people/src/lib.rs`; `src/sim/peopleKernel.ts`; `src/sim/persist.ts`;
   `src/sim/worker.ts`, `src/shell/main.ts`.
5. `v2/tools/gate-people.ts`, `kernel-parity.ts`, `bench.ts`,
   `unit.test.ts`; `data/reality/*.json`; `.github/workflows/v2-ci.yml`
   and `v2-long.yml`.
6. `spec/01-constitution.md` R1–R5 and R7; `CLAUDE.md` (the dev-loop
   directive of 2026-09-03).

## Ground rules (non-negotiable)

- **R1.** The wake is a STATE trigger — a caged basin — never a year. The
  `wake` config is an initial condition the player chooses, like the
  seed; no mechanism reads it after the switch, and nothing in any pass
  reads the phase except the scheduler and the trigger.
- **R2.** No new physical constant. The pre-wake stride is derived from
  the bounds the passes already carry and printed. The knee is the
  ledger's `CAGE_KNEE` row made concrete, and M4 will read the same row.
  If the solve disagrees with the awake kernel, the stride comes down or
  an omitted term comes back; no tolerance moves.
- **R4.** One representation. The solve regime operates on the world's
  own authoritative arrays — `people`, `farmers`, `_hearthYears`,
  `hearths`, `_peopledMask` — there is no second people field and nothing
  is copied at the wake. The scrubber's reconstruction is a rendering
  condensation: derived, evictable, never state, never saved, never read
  by a mechanism.
- **Kernel doctrine unchanged.** TS oracle and Rust byte-identical, banded,
  land-packed, the ledger asserting every step; parity is the development
  instrument, the gates the merge instrument. No new dispatch phases.
- **Dev loop.** Nothing that simulates history runs per commit. The solve
  is seconds, not hours, and its per-commit cost is capped and reported
  (deliverable 6); the agreement arm that needs the monthly kernel runs on
  the long workflow, never per commit, and never by this wave.
- Branch `cursor/v2-w5`; `QUESTIONS.md` and the constants ledger are the
  sanctioned append points; scratch probes never committed.

## Deliverables

### 0. Baseline (no runs)

Copy into your PR the numbers the wave is judged against, all already in
QUESTIONS #37: the merged kernel's dev long-arm arrival table, the target
3000-year spot check (ignition years, half-farmed years, farmed shares at
−7000), and the cost table (target, shipped schedule: 166 ms serial / 97
ms on three threads / 76 on eight). Do not run a long arm. The agreement
arm (deliverable 5) is run by the reviewer on the long workflow after the
wave lands.

### 1. Two schedule regimes (`scheduler.ts`, `world.ts`)

- `world.phase`: `"solve"` | `"awake"`. World state: saved, hashed, in
  provenance. A world with a substrate opens in `solve` unless
  `config.wake` says otherwise (deliverable 3).
- `resolveSchedule` returns the regime's schedule. **Awake: unchanged**
  (growth, technique, conversion, capacity, cohorts at 12 months;
  migration at the derived forager stride). **Solve: every pass at one
  stride S**, the largest whole-year multiple of 12 months such that every
  explicit per-firing fraction a pass takes stays inside
  `PEOPLE_MIGRATION_MAX_SHARE`:
  1. the farmer hop share, `PEOPLE_FARMER_MOBILITY_KM2_PER_YEAR × S/12 /
     area`, on every row holding a can-grow cell of any package (the rows
     farmers can occupy — not the polar rows that bound the forager step);
  2. farmer growth, `PEOPLE_R_GROWTH_PER_YEAR × (PEOPLE_GROWTH_FORAGER_FACTOR
     + PEOPLE_GROWTH_TECHNIQUE_GAIN) × S/12`;
  3. adoption, `PEOPLE_ADOPTION_RATE_PER_YEAR × S/12`;
  4. cohort ageing, `S/12 / PEOPLE_CHILD_AGE_YEARS`.
  Printed in provenance and the status line, like the migration stride.
  Expected: 84 months at dev (the cohort bound) and 60–84 at target (the
  hop bound on the highest can-grow row, 62–70°) — verify, do not assume. A
  bound that yields less than 12 months is a finding, not a reason to
  substep.
- `stepWorld` advances `step` by the regime's stride — the world clock is
  months from the opening in both regimes — and `calendarMonth` by the
  stride modulo 12. `runSteps(world, n)` keeps its meaning (n firings);
  add `runUntil(world, step)` for the harnesses, which crosses the wake if
  it lies inside.
- The switch: at the end of the solve step in which the trigger fires
  (deliverable 3), `phase` becomes `awake`, the schedule re-resolves, the
  monthly conductance resumes; technique and capacity are already derived
  by the commit epilogue. The world hash covers the phase and both
  schedules' digests; a solve-phase world and an awake world with the
  same fields hash differently.

### 2. The pre-wake passes (both kernels)

The passes are the kernel's own, called with the stride as `dtMonths` —
`grow`, `convertFarmers` (with `updateHearths`), `deriveCapacity`,
`migrate`, cohorts, the ledger — all already dt-parametrised (W3). Two
differences, both named, both in the TS oracle and in Rust:

- **Foragers do not hop.** In the solve regime the mobile mass of a cell
  is its farmer mass (all active packages), and the hop share is the
  FARMER share, `migrationShareForArea` evaluated with
  `PEOPLE_FARMER_MOBILITY_KM2_PER_YEAR` instead of the forager
  diffusivity. The invariant that holds in either regime: **a farmer mass
  hops `PEOPLE_FARMER_MOBILITY_KM2_PER_YEAR × dt / area` of itself per
  firing, pair-split by conductance × pair spare exactly as today.** (In
  the awake regime the same flow arises as the farmer fraction of the
  forager-share flow; factor it as you like, but write the invariant as a
  unit check, deliverable 8.) Foragers grow in place. Why this is
  admissible, what it omits and how large that is expected to be:
  QUESTIONS #39; the agreement arm measures it.
- **Conductance is the annual mean.** For a stride ≥ 12 months the
  migration cache holds a thirteenth table, the mean of the twelve monthly
  days/km tables; coastal hops are already season-free. Both kernels read
  the same table through the existing glue.

The source loop skips cells with zero mobile mass (an arithmetic no-op,
both kernels), so the solve's migration cost scales with the farmed
frontier, not the land. Rust: `begin_migration` learns the regime (a
farmers-only flag and the mean-days table pointer through the existing
glue); no new dispatch phases, no new band structure.

### 3. The wake: the first caged basin

- Evaluated at the end of every solve step, both kernels (the TS oracle
  owns the rule; Rust computes it identically). Over every land cell's
  basin window — the hearth law's square window of
  `PEOPLE_HEARTH_BASIN_RADIUS_KM`, through the summed-area tables it
  already keeps — with `K*ᵢ = max over active packages p of
  packageCapacity(i, p)` (the room a farmer sees: the pair-spare
  expression with a farmer share of one; zero where no active package can
  grow):

  ```
  free  = Σ_window max(0, K*ᵢ − peopleᵢ) · areaᵢ
  total = Σ_window K*ᵢ · areaᵢ
  ```

  A window with `total = 0` does not vote. **The world wakes at the first
  step in which any window has `free / total < CAGE_KNEE_FREE_SHARE`.**
  The window's centre and the step go to provenance and the event log;
  the shell says where and when.
- **Why this trigger.** The pre-wake regime is valid exactly while nothing
  pushes back on the people field. The first mechanism in the ladder that
  does is M4's taking, whose precondition is Carneiro's circumscription:
  a basin with no free farmable land to flee to (05.2, the ledger's
  `CAGE_KNEE`: pressure zero while about a fifth of the basin is free).
  So the kernel wakes where M4 will first be able to fire, and M4 inherits
  the trigger instead of redefining it. Until M4 lands, the awake kernel
  and the solve agree to within the stride error; the wake exists now so
  that play, parity and the gates exercise the switch and the monthly
  kernel. The window is the hearth-law basin for now; when M4 derives its
  flight radius (the forager diffusion length over a generation is the
  candidate) the wake follows that derivation — DECISIONS 27 records the
  ruling.
- `config.wake`: `"auto"` (default: the trigger); `"never"` (the solve
  regime to the end of the horizon — a MEASUREMENT mode for the gates,
  outside the regime's validity once M4 exists, and provenance says so);
  or a year (an initial condition: the world wakes at that year). When a
  chosen year is later than the trigger would have fired, provenance
  notes both ("caged at −5800; woken at −3000 by choice"): the player has
  accepted the solve's approximation past its validity, knowingly.
- After the switch the kernel is byte-for-byte the kernel of today given
  the same state (parity, deliverable 5). No pass reads `wake` or the
  phase.

### 4. Prehistory on screen (`worker.ts`, `shell/main.ts`)

- On create the worker runs the solve regime in batches, posting the
  existing snapshot after every batch, so the map PLAYS the peopling
  while it solves (order of a thousand years a second at the shipped grid
  on three threads). The status line shows the phase, the stride, and the
  wake year and window once known.
- A `seek` message returns a frame for any year before the wake without
  stepping anything: the reconstruction. Per cell — foragers as the
  logistic fill from the opening at the cell's forager rate; farmers as a
  logistic from the cell's recorded arrival step toward the recorded
  dominant package's matured capacity at the farmer rate; technique from
  the two; the dominant package as recorded. The worker keeps two
  land-packed arrays for it, the arrival step (the first step with
  technique ≥ `PEOPLE_FARMED_MARKER_SHARE`) and the dominant package at
  that step. They are rendering state: not saved, not hashed, not read by
  any pass. The reconstruction uses the same constants as the passes and
  nothing else; the shell labels a sought frame "reconstructed".
- The timeline scrubber (17.1) over the solved span; Run continues from
  the wake with the monthly kernel. The population total recorded every
  solve step and the hearth ignitions feed the almanac's curve and the
  event feed (the first world content the event log holds).
- The `wake` control in the shell: auto, or a year.

### 5. Parity and the agreement arm

- `tools/kernel-parity.ts`: (a) the solve regime — TS ↔ serial wasm ↔
  1/2/8 workers, byte-exact — at dev to the wake or 240 steps, whichever
  comes first, with the harness's primed hearths so farmers exist from
  step one; at target 24 steps; (b) the switch inside the horizon — a
  world with `wake` set to a step inside the parity horizon, compared
  across it; (c) the existing awake parity, unchanged.
- **The agreement arm** (`tools/gate-people.ts`, under
  `GATE_PEOPLE_TRAJECTORY=1` at dev and `GATE_PEOPLE_LONG=1` or
  `GATE_PEOPLE_TARGET=1` at target — the long workflow, never per commit):
  the awake kernel from the opening (the existing trajectory run, shipped
  schedule) against the solve regime with `wake: "never"` over the same
  horizon. Compared: the per-cell arrival step (median and 90th
  percentile of |Δ| over cells both reach, and the symmetric difference of
  the reached sets as a share of land); population at every checkpoint
  band; hearth ignition steps per hearth, matched by package under the
  separation bar; the dominant-package map at the horizon's end (share of
  farmed cells that differ). Bounds: `SOLVE_AGREEMENT_ARRIVAL_TOLERANCE_YEARS`
  on the median, `SOLVE_AGREEMENT_POP_TOLERANCE` at every checkpoint. The
  90th percentile, the reached-set difference and the package-map share
  are reported, not bounded, until the first measurement says what they
  are (08.4: a gate that cannot fail is deleted; one whose bound is
  invented is worse). A failure brings the stride down, or brings the
  forager hops back at the forager stride with substeps; never a
  tolerance edit.

### 6. The reality tables per commit (`tools/gate-people.ts`, CI)

- The per-commit people gate gains a **solve arm at both grids**: a world
  with `wake: "never"` run to the end of the horizon, measured with the
  gate's existing instruments — the population checkpoint bands, both
  arrival tables (technique ≥ the marker within ±3° of the row), the
  barrier box at its window, the Balkans→Rhine speed band, the density
  ordering at the end — plus the step at which the trigger WOULD have
  fired (evaluate the trigger every step and record the first firing
  without switching). Misses go to `known-misses-people.json` under ids
  suffixed `:solve:<grid>` with physical reasons; the kernel's own rows
  keep their ids. The manifest's ratchet applies to both.
- Budget: the target solve arm ≤ 60 s wall on the review runner (the gate
  may use the pool), dev ≤ 3 s; the per-commit gates job grows by no more
  than that. Report the actual. If the target arm exceeds its budget it
  moves behind `GATE_PEOPLE_SOLVE_TARGET=1` into `v2-long.yml` — a
  one-line change — and the PR says so; the dev solve arm stays per
  commit regardless.
- This sits inside the dev-loop directive as written: the solve is a
  minute, not hours. The owner may still demote it.

### 7. Bench and persistence

- `bench.ts`: two rows, `solve.dev.ms` and `solve.target.ms` (opening to
  the wake, `auto`), in the ratchet under the standing cap; per-phase ms
  for the solve regime beside the awake table. The cadence table is
  unchanged.
- `persist.ts`: the envelope carries `phase` and the wake step;
  `SAVE_VERSION_W5 = 6`. Save→load→save byte-identical in either phase; a
  loaded solve-phase world continues the solve, a loaded awake world runs
  the kernel. The reconstruction arrays are not saved.
- Smoke: determinism over the solve regime (two worlds to the wake,
  identical hashes); save/load in both phases; conservation asserted
  every solve step as it is every tick.

### 8. Unit checks (`tools/unit.test.ts`)

- **Stride derivation**: on the dev and target geometries the derived
  stride equals the minimum over the four bounds, and moving any of the
  four constants moves it.
- **The hop invariant**: one solve step moves, from a single farmed cell
  on a flat field, `PEOPLE_FARMER_MOBILITY_KM2_PER_YEAR × dt / area` of
  its farmers, to the ulp of the pair split; one awake month moves the
  same fraction scaled by dt.
- **The switch**: a world with `wake` at step k is `awake` from k, fires
  migration monthly after, and its hash equals the never-world's before k
  and differs after.
- **The flat-field front**: on a uniform can-grow field with uniform
  capacity at the dev geometry, the front speed read from the solve's
  arrival steps along a row matches the AWAKE kernel's on the same field
  (a few hundred years of monthly ticks on a flat dev field: a check of a
  law, not a history run) within 10 %. Print beside it, at both
  geometries, the linear spreading speed of the same hop-and-grow law —
  `min over μ > 0 of (r + Σⱼ λⱼ (e^{μ pⱼ} − 1)) / μ`, with λⱼ the
  per-neighbour hop rates and pⱼ the projected hop lengths — as a
  diagnostic, not a bound: the gap between it and the measured speed is
  the lattice regime (QUESTIONS #39), and the print keeps it visible.

## New constants (ledger rows, all with grounding)

| Constant | Value | Meaning |
|---|---:|---|
| `CAGE_KNEE_FREE_SHARE` | 0.2 | the ledger's Power row `CAGE_KNEE` (pressure zero while ≳20 % of the basin is free; Carneiro; v1-measured ladder) as a named constant: the free farmable share below which a basin is caged. The wake reads it now, M4 reads the same row |
| `PEOPLE_FARMED_MARKER_SHARE` | 0.5 | representation threshold (18.3): the farmed share at which a cell counts as farmed for arrival instruments — the gate's existing 0.5, named and shared with the recorder |
| `SOLVE_AGREEMENT_ARRIVAL_TOLERANCE_YEARS` | 100 | gate tolerance, never a mechanism input: median per-cell arrival delta, solve vs awake kernel — a tenth of the narrowest reality window |
| `SOLVE_AGREEMENT_POP_TOLERANCE` | 0.05 | gate tolerance: checkpoint population delta, solve vs awake kernel |
| `SAVE_VERSION_W5` | 6 | the envelope gains the phase and the wake step |
| (solve stride) | derived | largest whole-year multiple of 12 months inside the bound for farmer hops on can-grow rows, farmer growth, adoption and cohort ageing; printed, never hand-set |
| `config.wake` | auto / never / year | an initial condition, not a constant |

No physical constant is added or changed. Nothing is deleted.

## Acceptance (what "done" means)

`lint && test && smoke && gate && bench -- --check && oracle && build`
and the Chromium check green; parity byte-exact for the solve regime and
across the switch at both grids; the stride printed at both grids; the
target solve from the opening to the wake in ≤ 60 s serial on the review
runner with per-phase ms; the wake year and window at both grids; the
full-horizon solve's arrival table and population curve at both grids set
beside QUESTIONS #37's dev long arm and target spot check, with every miss
manifested with a physical reason; the shell playing the peopling on
create, scrubbing it, and running the monthly kernel from the wake; the
bench rows in the ratchet; PR from `cursor/v2-w5` titled `v2 W5 — the
peopling solve and the wake`, body listing each deliverable with measured
numbers. The agreement arm is delivered as an instrument with its unit
checks and is NOT run by the wave. Review is line by line against this
document.

## What NOT to do (recap)

No new growth, conversion, hearth or hop physics. No speed, delay,
arrival or wake-year constant. No place names in code. No year in any
trigger. No cohort materialisation formula (cohorts run at the stride).
No forager hops re-enabled without the measurement that demands them. No
saving or hashing of the reconstruction. No tolerance edits. No long-arm
runs. No touching the thread pool, worldgen, the substrate builders, the
awake schedule, or the band layout.

---

## Status (implemented on the working branch, 2026-09-03)

Implemented in the spec session itself (owner: "you must now implement
the spec, here in this chat"), not by a `cursor/v2-w5` PR; reviewed
against this document as if it were one. QUESTIONS #40 carries the
findings and measurements.

**Delivered as specified:** deliverable 1 (two regimes; `world.phase`,
saved and hashed; the solve schedule at one derived stride; `stepWorld`
advancing by it; `runUntil`; the switch re-resolving the schedule), 2's
structure (the kernel's own passes at the stride; the annual-mean
conductance as a thirteenth table both kernels read; no new dispatch
phases), 3 (the caged-basin trigger over the hearth-law window through
summed-area tables; `config.wake` auto / never / a year with the exact
landing on a chosen epoch; the wake and the hearth ignitions in the event
log, `HearthState.ignitedStep`), 4 (the worker plays the solve in
batches, `seek` returns a reconstructed frame, the shell's timeline, wake
control and regime status line), 5's parity (three regimes at both grids,
byte-exact across TS, serial wasm and 1/2/8 workers) and the agreement
arm as an instrument, 6's solve arm with the manifest rows under
`:solve:dev`, 7 (save v6 with phase, wake and caged steps and the events;
the solve-regime smoke at dev; the bench row), 8's four unit checks.

**Changed by measurement (each recorded in QUESTIONS #40):**

- *Foragers hop in the solve regime.* The flat-field check measured the
  spec's omission at 58 % in farmed extent; the named remedy applied:
  each group takes its own row share of the stride, and the awake regime
  is unchanged bit for bit. Agreement on the flat field is 5.3 % in
  extent and 0.02 % in population.
- *The stride derivation uses the substepped hop bound.* The bare bound
  gave 12 months at the shipped grid because the crop bells admit
  can-grow cells on near-polar rows (a data finding: highland roots to
  83° S, wheat to 78° N). The bound the hop kernel honours without
  capping gives 84 months at both grids, the cohort-ageing minimum.
- *The target solve arm is a long-workflow arm.* A solve firing at the
  shipped grid costs 294 ms serial (the annual passes fire every firing),
  so the full horizon is about seven minutes serial, past the 60 s
  budget; per the spec it moved behind `GATE_PEOPLE_SOLVE_TARGET=1` in
  `v2-long.yml`, and the dev solve arm (14 s for the horizon) runs per
  commit. Opening to the wake at the shipped grid is about 150 s serial
  against the awake kernel's 69 min on three threads.
- *The bench row is per firing* (`solveStepMilliseconds`, ten serial
  firings beside `tickMilliseconds`), not opening-to-wake: the ratchet
  compares like with like and the wake year is the gate's to print.
- *The trigger is sequential TypeScript*, like the hearth law, over the
  authoritative arrays; Rust computes nothing for it. Windows are centred
  on farmed cells.

**Not run:** the agreement arm (a monthly 3000-year run) and the target
solve arm's reality table; both are `v2-long` arms. The wake year and the
solve regime's full table at the shipped grid therefore come from the
long workflow, not from this landing.

# HANDOFF — Wave W6 of Simman v2: the base population stays

**For:** the implementing agent (Cursor).
**From:** the spec session of 2026-09-03 (branch
`claude/world-sim-rebuild-decision-1umpax`, after W5 landed as 37a10b12).
**Branch from the commit that merges this branch into main** (37a10b12 or
later: it carries the W5 regimes, the arrival recorder and the solve arm).
**Scope:** foragers stop being the thing that sets the clock. Two
mechanism corrections and one re-grounding, all in the movement pass:
foragers see forager room, farmers see farmed room; each group flows on
its own weights and its own derived stride; and the forager mobility, a v1
constant the ledger has carried as `[REDERIVE]` since M2, is grounded on
forager evidence. With those, forager flows are near zero everywhere by
construction, the monthly clock disappears from the awake kernel, and a
source with no room beside it is not priced at all. **No new mechanism, no
new constant without a citation.** Do not touch growth, conversion, the
hearth law, the wake, worldgen, the substrate builders or the thread pool.

## Why (owner, 2026-09-03)

> "Why do foragers need to move at all. They are a standard, constantly
> growing base population? It's not like their movement is consequential."

It is not, and the one place W5 measured it as consequential was an
artefact. Today a cell that starts farming is treated as having room for
anyone: the pair spare a forager source sees is the target's MIXTURE
capacity, and a farmed cell feeds twenty to forty times more people than
forager land, so the foragers of all eight neighbours pour into it as
foragers and are converted over a century. Real foragers did not move
into a farmed valley to live there at farmers' density; some joined the
farmers, which is adoption, and adoption is already a rate in the model.
The flood is the room rule, and the room rule is wrong.

The second cause is the constant. Foragers hop
`PEOPLE_MIGRATION_DIFFUSIVITY_KM2_PER_YEAR` = 1200 km²/yr of themselves, a
value the M2 ledger row calls "real pre-modern mobility correction" and
the seed table marks `[REDERIVE] (v1 measured)`: it was a v1 calibration
of something else, never a measurement of how forager populations
redistribute. It is eighty times the farmer mobility, which IS grounded
(Ammerman & Cavalli-Sforza, 1544 km² per generation). That one number is
what forces the movement pass to fire monthly at the shipped grid — 2.4
cell-loads a year at the equator, unbounded toward the poles — and the
monthly movement pass is two thirds of every awake tick and the two hours
that remain after the wake (QUESTIONS #40).

Fix the room, ground the mobility, and the forager field does what the
owner describes: it grows toward what the land feeds, is converted where
farmers arrive, and later is killed, raided and displaced by the phases
that do those things. Nothing is deleted: foragers may still move, at a
grounded rate, into forager room; there is simply almost never any.

## Required reading, in order

1. `spec/handoffs/W5-solve.md` with its status, and `v2/QUESTIONS.md`
   #37 (M3a review ruling d: the pair spare), #39, #40 (the flat-field
   measurement, the tick-cost table).
2. `spec/handoffs/M3a-wave.md` status and `spec/DECISIONS.md` 26 (d) and
   27 — the rulings this wave revises, named below.
3. `v2/src/sim/people/migration.ts` (`pairSpare`, `prepareFarmers`, the
   source/debit/gather phases), `rust/people/src/lib.rs` (the same),
   `src/sim/scheduler.ts` (`derivedMigrationStride`, `resolveSolveStride`),
   `src/sim/people/wake.ts` (`recordArrivals`).
4. `spec/09-constants-ledger.md` §People (`MIGRATE_D`), §M2
   (`PEOPLE_MIGRATION_DIFFUSIVITY_KM2_PER_YEAR`), §M3a (the farmer
   mobility's grounding — the convention this wave reuses), §W5.
5. `spec/01-constitution.md` R1–R3, R6; `CLAUDE.md`.

## Ground rules (non-negotiable)

- **R2, both ways.** The room rule changes because it is physically
  wrong, not because it is expensive. The mobility changes because its
  grounding was never a forager measurement, not because a smaller value
  is cheaper: the value comes from the literature, is cited in the ledger
  row, and is chosen before any outcome is looked at. If the grounded
  value makes the front too slow or too fast, that is a finding for the
  adoption rate's re-grounding (deliverable 5), never a reason to move the
  mobility.
- **R1.** No cadence is hand-set. Each group's stride derives from its own
  bound the way W5 derives the solve stride, and is printed.
- **Kernel doctrine unchanged.** Both kernels, byte-identical; every
  per-cell array land-packed; band partials in locals; the ledger asserts
  every firing; parity is the development instrument.
- **Nothing that simulates history runs per commit.** The dev solve arm
  and the unit checks are the per-commit instruments; the awake
  trajectory is the long workflow's.
- Branch `cursor/v2-w6`; `QUESTIONS.md` and the ledger are the append
  points; scratch probes never committed.

## Deliverables

### 0. Baseline (no runs)

Copy from QUESTIONS #40: the dev solve-arm table (arrivals, front speed,
population), the flat-field agreement numbers, the awake tick cost by
phase at the shipped grid (163 ms, movement about 110), the wake year.
The wave is judged against these.

### 1. Room by group (`migration.ts`, `lib.rs`)

Replace the single pair spare with one per group, evaluated identically
on the source and target sides as today so conservation holds to the ulp:

```
foragerRoom(target) = max(0, foragerCapacity[target] − people[target]) · area
farmerRoom(target)  = max(0, packageCapacity(target, dominant(source)) − people[target]) · area
```

Foragers see the land's forager capacity, farmers the farmed capacity of
the package they carry; both see everyone already there as occupying it.
On unfarmed land the forager room is what it is today (the mixture IS the
forager capacity there), so nothing changes where nothing farms. In a
farmed cell, whose people exceed its forager capacity within a generation
of arrival, the forager room is zero: foragers do not enter farmed land,
and the only way in is the adoption already in the model. The mixture
capacity keeps its other uses (growth's crowding term, the wake trigger,
the capacity lens); this wave only stops using it as forager room. DECISIONS
26 (d)'s "foragers see the target's capacity as it stands" is revised to
this, and the ruling records why.

### 2. Two flows (`migration.ts`, `lib.rs`)

Each group flows on its own weights: a source's foragers are split among
its neighbours by conductance × forager room, its farmers by conductance ×
farmer room, and each flow conserves its own group. The M3a mixed flow —
one outflow of "mobile mass" split by one weight, with the farmers riding
along at a ratio — is retired; it is what let foragers ride into farmed
room in proportion to the source's farmer share. Structure:

- The source phase prices each pair twice, once per group, and stores
  both weights (`pairWeight` gains a second slot per pair; the reverse-slot
  read-back stays). Per source: two outflows, two ratios.
- Debit and gather move each group by its own ratio and weight; cohort
  fractions ride with each group's flow in proportion to the source's
  cohort shares as today; the peopled mask extends on any arrival.
- The remainder rule (rounding to the first peopled cell) applies per
  group so each group's ledger channel closes exactly.
- The hop invariant stands and gains a twin: per firing, farmers hop
  `PEOPLE_FARMER_MOBILITY_KM2_PER_YEAR × dt / area` of themselves and
  foragers `PEOPLE_FORAGER_MOBILITY_KM2_PER_YEAR × dt / area`, each
  substepped and capped by the kernel's bound; the W5 unit check is
  extended to assert both.
- The solve regime's two-weight form (W5) collapses into this: there is
  no longer a regime-dependent factoring, only two flows with their own
  shares. The awake and solve regimes differ only in their strides.

### 3. The forager mobility, grounded (`constants.ts`, the ledger)

`PEOPLE_MIGRATION_DIFFUSIVITY_KM2_PER_YEAR` is retired and
`PEOPLE_FORAGER_MOBILITY_KM2_PER_YEAR` takes its place, grounded by the
same convention the farmer value uses: mean squared parent–offspring
displacement per generation ÷ 4T. The literature on forager
parent–offspring and marital distances (the review in Wijsman &
Cavalli-Sforza 1984; MacDonald & Hewlett 1999 on forager mobility; Fix
1999 on migration in human microevolution) puts forager displacements at
tens of kilometres per generation — hundreds to a couple of thousand km²
per generation, i.e. a few to some twenty km²/yr. That is the farmer
value's order, not eighty times it. **The implementer reads the sources,
records the figure used with its citation in the ledger row, and chooses
it before running anything.** If the sources disagree, the row carries the
range and the value is its median. `PEOPLE_FARMER_MOBILITY_RATIO` is
deleted (nothing rides at a ratio any more); `MIGRATE_D` in the seed table
is resolved to the new row.

### 4. Strides by group, and the skip (`scheduler.ts`, both kernels)

- The movement pass's stride is derived as W5 derives the solve stride,
  for each group from its own bound: foragers on every peopled row with
  the forager mobility, farmers on every can-grow row with the farmer
  mobility, each inside `PEOPLE_MIGRATION_MAX_SHARE ×
  PEOPLE_MIGRATION_MAX_SUBSTEPS` per firing; the pass fires at the smaller
  of the two, a multiple of the growth stride, printed in provenance. The
  "largest divisor of twelve" rule is retired: a movement stride may
  exceed a year. With a grounded forager mobility both bounds sit far
  above the cohort-ageing bound and the awake movement stride comes out
  at 84 months at both grids — verify, print, do not assume. If a bound
  binds below a year on some row, that is a finding about the value or the
  row, recorded, never substepped by hand.
- **The skip.** Before pricing, one pass marks each cell's room per group
  against the numerical floor `PEOPLE_CAPACITY_FLOOR_PER_KM2` (room below
  the floor is no room; a representation threshold, 18.3). A source none
  of whose neighbours has room for a group sends none of that group and
  is not priced for it. In a filled world that is almost every source for
  foragers and every source away from a front for farmers. The skipped
  flow is below the floor times the area by construction; the ledger
  still closes because nothing left.
- The arrival recorder runs on commit firings only, not every month.
- Growth stays annual; the solve regime stays as W5 built it. What
  changes is that the awake regime no longer has a monthly pass at all:
  most months are empty ticks and cost nothing.

### 5. Re-grounding the adoption rate (the check, not a dial)

The Balkans → Rhine front speed was inside the radiocarbon band with the
flood in place (1.05 km/yr awake, 1.04 solve). Removing the flood removes
the contact dilution the flood caused, so the front may run faster. The
ledger row for `PEOPLE_ADOPTION_RATE_PER_YEAR` already records that,
given the farmer mobility, the band admits 0.005–0.02; if the dev solve
arm's front leaves the band, the rate is re-grounded inside that range to
the band's centre and the row says so with the new measurement. That is
the one constant this wave may move, and only by that rule. Every other
miss goes to the manifest with a physical reason.

### 6. Instruments and acceptance

- Parity at both grids, three regimes, byte-exact, with the two-flow
  arrays in the harness's lists.
- Unit: the two hop invariants; the skip (a source whose neighbours are
  full sends nothing and is not priced — count priced pairs); the flat-
  field agreement (solve vs awake within the W5 bounds; with equal
  strides it should be near-exact, and the check says what it measures);
  the stride derivation per group.
- Gate: the dev solve arm re-measured (arrivals, front speed, population,
  wake year) and manifested; `GATE_PEOPLE_SOLVE_TARGET=1` in the long
  workflow.
- Bench: `tickMilliseconds` and `solveStepMilliseconds` re-measured. The
  awake tick should fall from about 163 ms to the growth pass alone on
  growth months and near zero on empty months; **re-baseline downward and
  say so** (the ratchet's rule), and record the projected YD→1 CE time at
  the shipped grid beside the two hours it replaces.
- Housekeeping: the parity CI job runs three regimes at both grids and
  took 7:41 (QUESTIONS #40); run the chosen-epoch switch regime at dev
  only and report the job's new time.
- PR from `cursor/v2-w6` titled `v2 W6 — the base population stays`,
  body listing each deliverable with measured numbers, the cited mobility
  figure, and the front speed before and after.

## Constants (ledger rows)

| Constant | Value | Meaning |
|---|---:|---|
| `PEOPLE_FORAGER_MOBILITY_KM2_PER_YEAR` | from the literature, cited | forager population mobility by the parent–offspring displacement convention; replaces `PEOPLE_MIGRATION_DIFFUSIVITY_KM2_PER_YEAR` (1200, v1 calibration, `[REDERIVE]`) |
| `PEOPLE_ADOPTION_RATE_PER_YEAR` | 0.01, or re-grounded inside 0.005–0.02 | only if the front leaves the band once the flood is gone; the row records the measurement |
| deleted | — | `PEOPLE_MIGRATION_DIFFUSIVITY_KM2_PER_YEAR`, `PEOPLE_FARMER_MOBILITY_RATIO`; the seed row `MIGRATE_D` resolves to the new row |
| (movement stride) | derived, per group | printed; expected 84 months at both grids once the mobility is grounded |

## What NOT to do

No "foragers do not move" switch: their movement is grounded and stays,
it is the room that is almost never there. No mobility value chosen by
looking at the front. No touching growth, conversion, the hearth law, the
wake trigger, the solve stride's bounds, or the bad-year question for
forager land (that is M3b's, and it goes to the owner as a ruling there).
No tolerance edits. No long-arm runs.

---

## Status (implemented on the working branch, 2026-09-03)

Implemented in the spec session itself (owner: "now I want YOU to
implement this"); reviewed against this document as if it were a PR.
QUESTIONS #41 carries the findings and measurements.

**Delivered as specified:** deliverable 1 (room by group, the floor), 2
(two flows with two weights per pair, per-group remainders, the two hop
invariants), 3 (`PEOPLE_FORAGER_MOBILITY_KM2_PER_YEAR` = 23, grounded on
the Aka mating and exploration ranges of Cavalli-Sforza & Hewlett 1982
and Hewlett, van de Koppel & Cavalli-Sforza 1982 by the farmer value's
convention, the derivation range 9–37 carried in the ledger and the value
its median, chosen before any run; the M2 diffusivity and the ratio
retired), 4 (each group's bound in the stride derivation; the awake
movement stride a multiple of the growth stride that may exceed a year,
84 months at both grids; the skip with a superset room flag per target;
the recorder on commit firings), 5 (the front stayed inside the band at
1.08 km/yr, so the adoption rate did not move), 6 (parity in three
regimes; the unit checks; the dev solve arm re-measured and manifested;
the bench over one movement cycle, re-baselined downward for the tick
rows; the parity CI job's switch regime at dev only).

**Found on the way (QUESTIONS #41):** a growth-only firing — new with a
movement stride above the growth stride — never committed the farmer
masses growth wrote; both kernels now do. The flat-field check caught it
as an 80 % gap in farmed extent between the regimes.

**Not run:** the agreement arm and the target solve arm (`v2-long`).

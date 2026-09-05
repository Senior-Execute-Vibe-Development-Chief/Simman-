# W12 — The front at the speed its constants name

Wave 12 of the v2 rebuild. Owner directive (2026-09-04/05, after the
play-report: "farming starts in the gulf of issus, at around 8000bc, then in
bohai bay around 6700bc … by 4500 the issus wave has reached the mouth of the
nile … at this point it has JUST reached the alps"; "europe seems late?";
"so surely if it is half speed, everywhere, we just double the speed?";
"can you not just make the cells represent as larger, proportionally?";
"think about it a bit"; then **"spec it"**). One wave, because every item is
the same subject: the farming front runs slower than the mobility constants
it is built from, and the reasons are all in the discretisation — none in
the physics, none in the constants.

## The findings this wave answers

1. **A lattice hop is not a diffusivity** (QUESTIONS #55, #56; landed as
   `a1eac742`). The migration pass moved a fraction `D·dt/area` of a cell's
   people one hop per firing. Moving a fraction `s` one hop delivers a
   diffusion coefficient of `s·<d²>/4`, because two-dimensional diffusion
   spreads as `<r²> = 4Dt`, so the share must be `4·D·dt/<d²>` — and `<d²>`
   is the eight-neighbour stencil's mean square hop, `0.75·(h_ew² + h_ns²)`,
   not the cell area. The share was short by 2.67 on a square cell; the
   front, which runs as the square root, came out at 0.553 km/yr at the
   shipped grid against the ledger's own design of `2·√((r + adoption)·D)`
   = 0.936, with the Balkans 822 years late and the Rhine 2,499. Corrected:
   0.670, inside the Pinhasi–Fort–Ammerman band (0.6–1.3) for the first
   time; findings 27 → 24; the Balkans, the Cardial coast and inland Europe
   cleared at both grids.
2. **The solve regime runs every pass at one stride, and only migration
   needs the short one** (QUESTIONS #57, #58; this wave). With the share
   corrected, the explicit-diffusion bound at the shipped grid is 24 months
   for foragers, but the solve regime's single stride drags growth, capacity,
   adoption and cohorts — whose own bounds are 108, 50 and 7.5 years — down
   with it, which is where the "3.5×" came from. Measured per pass at dev:
   conversion 65 %, migration 21 %, growth 7 %, capacity 6 %. Migration
   alone at 24 months with the rest at 84 is **1.5×**, not 3.5×.
3. **The stride bound is set by three Arctic cells holding 25 people** —
   0.0006 % of the world — and by 1,800 Antarctic cells holding none
   (QUESTIONS #57). Every threshold-free way of ignoring them fails, because
   `h_ew = h_ns·cos(lat)` makes the bound fall *smoothly* poleward: reaching
   48 months by exclusion gives up 89 % of humanity (#58). The lat/lon grid
   over-resolves east–west toward the poles; that is the pole problem every
   atmospheric model has, and its fix is the grid, not the stride.
4. **The movement scheme is isotropic on a grid that is not.** The outflow
   is split among eight neighbours by `conductance × room` with no distance
   term, so a cell at 60 °N sends as much east (11 km) as north (22 km). The
   proper finite-volume flux weights each face by its length over its
   distance. This under-serves east–west transport across the mid-latitudes
   — the main axis of the Eurasian front — and it is *stiffer* at the poles
   than the isotropic average admits (a 4-month bound at 84 °N, not 24),
   which is why item 3 must land before this one.

Every item below is a discretisation correction with no free parameter, or
a grid change whose one criterion is geometric. No constant is re-grounded:
the Ammerman & Cavalli-Sforza mobilities are untouched throughout (second
cardinal rule — the temptation this wave was named for, "just double the
speed", would quadruple a cited number and break dev, which already runs
*above* design). Nothing reads the calendar. Everything is measured at both
grids, and the whole effect of §2 is at the shipped grid alone (third rule).

## 1. The diffusion conversion (landed, `a1eac742`)

Recorded here so the wave is whole; nothing further to build.

- `migrationShareForArea(area, dtMonths, D, height)` computes the share as
  `DIFFUSION_MSD_PER_DIFFUSIVITY · D · dt / meanSquareHopKm2(area, height)`,
  where `meanSquareHopKm2 = MIGRATION_HOP_MEAN_SQUARE_WEIGHT · (h_ew² + h_ns²)`,
  `h_ns = EARTH_CIRCUMFERENCE_KM / (2·height)` and `h_ew = area / h_ns`. The
  `height` argument is REQUIRED — a default that preserved the old path let
  the unit test assert the buggy value and pass.
- Both constants are mathematics: 4 is the 4 of `<r²> = 4Dt`; 0.75 is the
  stencil mean `(2 + 2 + 4·2)/8`. Ledger §W12.
- Mirrored in `rust/people/src/lib.rs` (`mean_square_hop_km2`,
  `share_for_area`), which derives the same value from cell area and grid
  height. Parity byte-exact, both grids, three regimes, 1/2/8 workers.
- Measured: front 0.553 → 0.670 km/yr at target, 1.077 → 1.420 at dev. The
  dev figure is now above the band and `europe-front-speed:solve:dev` fails:
  the coarse lattice, which flattered the front before, flatters it the
  other way now. Dev-raster class; recorded, not dialed.

The gain is smaller than the factor implies because at an 84-month stride
the corrected share exceeds `PEOPLE_MIGRATION_MAX_SHARE` on most rows and
the substep machinery saturates it. That is §2's subject.

## 2. Per-pass strides in the solve regime

### 2a. What changes

`resolveSolveSchedule` maps every pass to one stride. It becomes what
`resolveSchedule` (the awake regime) already is: **each pass at the largest
whole-year multiple of 12 months inside its own bound.**

| pass | bound | dev | target |
|---|---|---:|---:|
| technique, conversion, capacity, growth, cohorts | cohort ageing, `0.5 × PEOPLE_CHILD_AGE_YEARS` | 84 | 84 |
| migration | hop share ≤ `PEOPLE_MIGRATION_MAX_SHARE` on every peopled / can-grow row, at the corrected share | 84 | **24** |

Dev is unchanged: its hop bound is 227 years for foragers, so the cohort
bound binds everything at 84, as W6 recorded. The whole effect is at the
shipped grid.

The hop bound is `hopBound · <d²> / (4 · D)` with `hopBound =
PEOPLE_MIGRATION_MAX_SHARE` — **not** `× PEOPLE_MIGRATION_MAX_SUBSTEPS`.
Substepping keeps the explicit scheme stable, which is what the substep cap
is for, but it does not let anyone hop twice: a firing moves people at most
one cell whatever the share, so the reach a stride can carry saturates at
one hop, and the 16× allowance bought a slower front and nothing else. It
never showed at dev, whose share sits at a sixtieth of the bound.

### 2b. The clock and the passes

- The solve clock advances by the **greatest common divisor** of the solve
  strides: 84 at dev (one stride), **12** at target (the gcd of 84 and 24) —
  not the "shortest stride" this line first said. Each pass fires when due,
  by the same `passFires(world, schedule)` check the awake regime uses — the
  cadence check stays centralised — and that check is
  `(step − phase) % stride === 0`. A clock of 24 does not land on the 84
  cadence: steps would fall on 0, 24, 48, 72, 96 … and `step % 84 === 0`
  would be true only every 168 months, silently running growth, capacity,
  adoption and cohorts at **double** their own bound. Only a clock that
  divides every stride lands on every cadence, and the gcd is the largest
  such value — the biggest advance per step, so the fewest steps.
  `unit.test.ts` asserts both halves: the clock divides every stride, and no
  coarser value lands on every cadence.
- Each pass receives **its own stride as `dtMonths`**, as the awake regime
  does through `passDtMonths`. `stepPeople`'s `solve ? solveDtMonths :
  passDtMonths(schedule)` collapses to the second branch in both regimes;
  the `solveDtMonths` argument goes. The kernel already takes `dt` per pass
  (`beginMigration(month, dtMonths, growthPrepared)`, `grow(world, dt)`),
  so no kernel interface changes.
- A migration firing without a growth firing (the common case at target)
  runs with `growthPrepared = false` and reads committed `world.people` —
  the path W6 built for the awake regime's multi-year movement stride.
- The regimes now differ only in how the clock advances: by one month in
  awake, by the shortest stride in solve. W6's ledger row already says they
  differ only in the growth cadence; this makes it literally true.

### 2c. Persistence, provenance, shell, parity

- `WorldSave.solveStride: number` → `solveSchedule: PassSchedule[]`,
  checked on load with `sameSchedule` like the awake schedule.
  `SAVE_VERSION_W12 = 8`. There is no v7 → v8 expansion and none was
  written: `loadWorld` has always rejected `data.version !== SAVE_VERSION`
  outright, so the bump IS the migration — a v7 save fails cleanly rather
  than loading a stride the schedule no longer carries.
- Provenance prints the solve schedule per pass, as it prints the awake one.
  The status line's `solve 84` becomes the per-pass list; the shell's
  "solving · 7-year steps" reads the clock advance, so at the shipped grid it
  reads **"1-year steps"** — not the "2-year" this line first said, which was
  the shortest-stride clock talking. It is visible to the player; what to do
  about it is the owner's (§Rulings).
- The scrubber's reconstruction of the solved span is unchanged in kind:
  frames at recorded arrival steps, granularity the clock advance.
- `kernel-parity.ts` converts steps to years through `solveStride`; it
  converts through the clock advance instead, and where the grid gives
  different strides its solve arm asserts that the arm actually VISITS every
  cadence combination — no pass at all, migration alone, a reaction firing
  without migration, both together. A schedule with more than one stride is
  the case the harness has never seen and the one that matters. Covering the
  old 2016-month span instead would take 168 steps against 24 and add ~6.3
  minutes to an 8m17s harness; the coverage assertion costs nothing and
  proves the same thing. The consequence, recorded rather than hidden: the
  target solve arm now spans 24 years and 4 reaction firings where it spanned
  168 years and 24.
- The bench's solve rows change by construction. `solveStepMilliseconds` is
  replaced as the ratchet phase by **`solveYearMilliseconds`** — milliseconds
  per YEAR of solve, which survives a change of schedule where a per-firing
  row cannot (a step is 7 years at dev and 1 at target). The sample count
  moves from 10 steps to 10 of the coarsest SPANS, so the row measures 70
  years of history at either grid. The baselines are the old per-firing
  baselines carried across **by the ratio measured on this runner, not reset
  to it** — this runner is about 2.5× faster than the one that set 11/440,
  and resetting to it would ratchet the cap down by that factor for everyone
  else. The per-step row is retained, unratcheted, as what one frame costs.

### 2d. Cost, measured and to be measured

At dev, over 40 solve firings: conversion 642 ms (65.0 %), migration 203 ms
(20.6 %), growth 66 ms (6.7 %), capacity 62 ms (6.3 %), technique 7 ms,
cohorts 5 ms, ledger 2 ms. Migration alone at 24 months, the rest at 84:
**1.51× the people-pass cost**; at 36, 1.27×. The shipped-grid split is not
yet measured (the probe stalled) and migration is plausibly heavier there —
the finer coast has more hop pairs — so the acceptance figure is the
shipped-grid measurement, expected 1.5–1.8×. Against the 3.5× of moving
every pass, and the 89 % of humanity that any exclusion deep enough to
matter would give up.

**Measured on landing** (this runner, wasm, one worker, warm-up world first —
the first timed arm of a cold process reads ~60 % high on JIT alone, which
cost one probe its answer). Dev is unchanged, as the schedule is: 0.55 ms per
solve-year before, 0.57 after. At the shipped grid a solve-year goes
**34.9 → 104.8 ms, 3.0×** — and that multiplier is §1's, not §2's: the
corrected share needs 3.5× the movement firings to carry the same span inside
`PEOPLE_MIGRATION_MAX_SHARE`. What §2 buys is keeping that multiplier OFF the
other five passes. Against a single stride at migration's own bound, the same
70 years cost 124.3 ms/yr against 104.5 on a cold world (**1.19×**) and 401.8
against 243.6 with every hearth primed (**1.65×**) — the spread is the
adoption pass, which is 65 % of a firing once packages are live (§2e) and
nothing at all before they are.

### 2e. The adoption pass is 65 % of a firing

Three times the migration pass, for a pass that per cell does far less than
price eight neighbours with room and conductance. Almost certainly per-package
work over the whole grid every firing that could be restricted to cells with
contact or with any active package. Out of this wave's scope and owned as a
pure performance task (`convertFarmers`, `technique.ts`; results must stay
byte-identical, Rust mirror included). If it falls, §2's cost falls with it.

## 3. The reduced polar grid (owner's idea, structural)

### 3a. The criterion

Poleward of the latitude where `cos(lat) < 0.5` (60 °), cells are merged
east–west in pairs; poleward of `cos(lat) < 0.25` (75.5 °), in fours. The
criterion is geometric and has one meaning: **the cell's aspect ratio stays
inside [0.5, 1]**, which is the condition under which the isotropic bound of
§1 and the anisotropic bound of §4 agree within a factor of two. Nothing is
tuned; the merge latitudes follow from the ratio, and a different grid
height moves them without anyone editing a number. This is the reduced
Gaussian grid of atmospheric modelling, in its simplest form.

### 3b. What it touches

The substrate: `cellAreaKm2`, `landMask`, the climate and water fields, the
neighbour tables (`neighbor_targets`, `neighbor_distance`, `neighbor_mode`,
including coastal hops), `packedOf` / `landCells`, and every per-cell field
of the people kernel. The renderer, which maps cells to screen: a merged
cell paints its span. Persistence: the land packing changes, so
`SAVE_VERSION_W12` covers it. The kernel's band layout, which is by row.

### 3c. What it was expected to give — MEASURED FALSE, 2026-09-05

The claim below was measured before building and does not hold. It is kept
verbatim because it is what DECISIONS 31(c) ratified; §3d is what the world
actually does. **Do not build §3a.**

- ~~With `h_ew ~ h_ns` everywhere, `<d²>` is uniform and the migration bound
  is ~48 months at every latitude — with nothing given up anywhere. It
  removes the problem §2 works around, rather than trading against it: after
  §3, §2's migration stride at the shipped grid rises from 24 to 48 and its
  cost from ~1.5× to ~1.15×.~~
- It is the prerequisite for §4 at the shipped grid (below) — still true, and
  §3d shows the ratified rule does not satisfy it either.
- It is the prime suspect for the Antarctic `canGrow` oddity (§5), and for
  the documented 1.3–2.2× dilution of 1-D coast and river terms, both of
  which are the same over-resolution seen from other sides. Untouched by
  §3d: that suspicion is about over-resolution, not about the stride.

### 3d. What it actually gives (measured, QUESTIONS #61)

Per-row transport bound over every row anyone can be a source from, at the
shipped grid, from the real substrate, using the same expression
`transportBoundYears` uses — validated by reproducing the shipped 24-month
stride exactly on the no-merge arm:

| merge rule | bound | stride | worst aspect | §4 bound | §4 stride |
| --- | ---: | ---: | ---: | ---: | ---: |
| none (today) | 2.045 yr | 24 | 0.110 | 0.064 yr | 12 |
| pairs only | 2.117 yr | 24 | 0.219 | 0.247 yr | 12 |
| **pairs then fours (§3a, ratified)** | **2.408 yr** | **24** | **0.438** | 0.868 yr | 12 |
| powers of two, uncapped | 2.525 yr | 24 | 0.500 | 1.077 yr | 12 |
| `floor(width·cos)`, aspect ≥ 1 | **4.034 yr** | **48** | 0.998 | 2.689 yr | **24** |

Three things follow.

- **§3a moves the stride from 24 months to 24 months.** Its entire claimed
  payoff does not happen.
- **It is not the cap of four.** A cell of aspect `a` has mean square hop
  `0.75·h_ns²·(a² + 1)` = `(a² + 1)/2` of a square cell's; the equatorial
  bound is 4.034 years and the stride is that bound FLOORED to whole years,
  so holding 48 months needs `(a² + 1)/2 ≥ 4/4.034`, i.e. **a ≥ 0.992** —
  not the a ≥ 0.5 §3a targets. A power-of-two rule has worst-case aspect 0.5
  BY CONSTRUCTION, just below each doubling threshold, whatever the cap:
  raising it from 4 to 64 moves the binding row 83.7 °N → 75.5 °N and the
  bound 2.408 → 2.525 years, and the stride not at all.
- **§3a fails its own criterion.** Measured worst aspect under it is 0.438,
  at 83.7 °N — a peopled row at the shipped grid — because `cos(83.7°) =
  0.11` is under the 0.125 at which a cap of four still reaches 0.5. The
  [0.5, 1] band needs unbounded factors and was given two.

The rule that does work is `n_row = max(1, floor(width · cos(lat)))` — a cell
is never narrower than it is tall. It is a mechanism, not a fitted constant:
rounding DOWN is what puts the aspect on the safe side of 1, and it
self-calibrates at any grid height. But it is a TRUE reduced grid — arbitrary
run lengths, so adjacent rows disagree everywhere — and the fixed eight-slot
stencil the TS oracle and the Rust kernel share cannot express a merged
cell's several northern neighbours. That is a change to what a cell IS, and
it reaches the packing, the adjacency structure, persistence, the kernel's
per-row cell area, and the renderer. It is a different design from the one
ratified, so it is the owner's to ratify, not a substitution to make quietly.

Dev is unaffected under either rule: its transport bound is 116 years today
and 227 under `floor`, and the 84-month reaction cap binds long before both.

## 4. Anisotropic flux (the proper finite-volume form)

### 4a. What changes

The outflow of a cell is split among its neighbours by `conductance × room`.
It becomes `conductance × room × (L_i / d_i)`: the shared face length over
the centre-to-centre distance, which is the finite-volume discretisation of
`∇·(D∇n)`. On a rectangular cell the east and west faces are `h_ns` long at
distance `h_ew`, the north and south faces `h_ew` long at distance `h_ns`;
the diagonals carry the nine-point stencil's weight for an isotropic
Laplacian on a rectangle. The face lengths and distances are the row's
geometry — `migrationEdgeLengths` already carries them — so the geometric
part of the weight is per row and the share normalisation `4·D·dt/<d²>`
uses the *weight-averaged* `<d²>` of that stencil rather than the equal-
weight one. No constant.

### 4b. Why it must follow §3

Under this form the explicit stability bound is `2·D·dt·(1/h_ew² + 1/h_ns²)
≤ 0.5`: 32 months at the equator, **4 months at 84 °N**. The isotropic
average was hiding how stiff the slivers are. On the unmerged grid at a
24-month migration stride everything poleward of ~42 ° would clamp — Europe
included, 28 % of the world's people — so this form cannot ship at the
shipped grid until the aspect ratio is bounded near 1.

~~After §3 the bound is ~32 months everywhere and §2's derivation picks it
up.~~ MEASURED FALSE, 2026-09-05 (§3d): under every power-of-two merge the
anisotropic bound stays under 1.1 years, so §2 would derive a **12-month**
stride — half of today's, doubling movement cost, with the poles still
clamping. §4 is free only after a grid whose aspect is ~1: under
`floor(width·cos)` its bound is 2.689 years, exactly today's 24-month
stride. So §4 waits on that grid being ratified and built, not on §3a.

### 4c. What it is expected to do

Restore east–west transport across the mid-latitudes, where the isotropic
split under-serves it by the aspect ratio (1.4× at 45 °N). The Eurasian
front runs east–west; this is the remaining candidate for the gap between
0.670 and the 0.936 design once §2 has removed the clamp. Measured, not
assumed: the acceptance arm reports the front at both grids before and
after, and the Indus and Ganges arrivals, which are the null rows this
speed owns.

**Measured before building (QUESTIONS #64, the arrival raster).** The
mid-latitude east–west deficit this section was to recover is not there:
local front speed by front normal, latitude band and capacity tercile
gives east–west / north–south ratios of 0.69–1.18 across 30–60 °N with no
consistent sign, and on the best ground the east–west movement is FASTER
at 30–50 °N; only above 60 °, where nobody farms by 1 CE, does a uniform
~0.6 appear, and it sits far above the cos(lat) = 0.26 the hypothesis
predicts there. The eastward leg's slowness is the Iranian plateau's
capacity (§Status). So §4 stays what §4a says it is — the correct
finite-volume form, with no free parameter — but its case is now the
stability bound and P16's cost, not the front, and the front is not a
reason to build it.

## 5. Findings surfaced, owned elsewhere

- **Antarctic can-grow.** Some package reports `canGrow` on rows at 83 °S.
  Sampled mid-row no package grows, so the cell is elsewhere on the row; the
  substrate's temperature field there reads 0.02–0.40 in its normalised
  units. Investigate the climate interpolation near the poles and the
  growing-season test; likely the over-resolution of §3 seen from the
  climate side.
- **The gate emits duplicate ids.** `arrival:sahel:solve:dev` and
  `arrival:ganges:solve:dev` appear twice in `unacknowledged`; the count
  reads 26 for 24 findings. Gate bookkeeping.
- **The wake fires at 30 CE at the shipped grid** — at the very end of the
  run, not never as #46 said. The W5 trigger review stands.
- **The hearths** (QUESTIONS #50–#52): the separated score is correct and
  cannot ship without the draw, and the draw's scale needs the front half
  of the cultivation wait measured. Owner's; untouched by this wave.

## What NOT to do

- **Do not raise `PEOPLE_MIGRATION_MAX_SHARE`.** It is the explicit
  scheme's stability bound, not a tuning value; above it populations
  oscillate and go negative.
- **Do not raise the mobility constants.** Speed goes as the square root, so
  doubling it quadruples a cited measurement — and dev already runs above
  design, so no value satisfies both grids. The error has opposite signs at
  the two resolutions, which is the signature of discretisation, not of a
  wrong number.
- **Do not exclude polar rows by a population threshold** to lengthen the
  stride. #58 measured it: the bound falls smoothly with latitude and any
  cut deep enough to matter cuts through Europe and north China.
- **Do not "treat cells as square" globally.** The grid is square only at
  the equator; a blanket rule halves east–west movement at 60 °N and
  quarters it across the mid-latitudes.
- **Do not substep the pass to shorten migration alone.** Substepping the
  pass at dt/N costs what a shorter stride costs, and rows are coupled
  north–south.
- **Do not land §4 before §3 at the shipped grid.** §4b.
- **Do not lift the plateau by hand.** The Indus is late because the
  substrate holds the Iranian piedmont at the moisture floor with no
  channel (#64). Raising the floor, the fertility east of the Zagros, or a
  river's drawn magnitude to reach the Indus is fitting the outcome; the
  mechanism is routed runoff (P17), and until it exists the row stays a
  recorded miss.

## Acceptance

Measured at both grids on every commit (dev) and in `v2-long` (target,
`GATE_PEOPLE_SOLVE_TARGET=1`):

- **§2.** Met on landing: the solve schedule prints per pass, at target
  migration at 24 months and every other pass at 84, at dev all at 84;
  parity byte-exact in the solve regime with a multi-stride schedule, both
  grids, three regimes, 1/2/8 workers; cost measured at both grids and
  recorded in the bench note; dev byte-identical to §1 (same grid hash, same
  solve-arm hash, same wake step, same routing hashes), which is the check
  that the schedule machinery changed nothing where the schedule did not.
  The shell reads **"1-year steps"** at the shipped grid, not the "2-year"
  first written here — see §2b and §Rulings.
  The long arm (`GATE_PEOPLE_SOLVE_TARGET=1`, run on request 2026-09-05,
  QUESTIONS #63): the front at target **0.670 → 0.854 km/yr** against the
  0.936 design, every European window met (Balkans −6024, central Europe
  −4683, Rhine −4161, Cardial −5439, inland −5179), and the residual has a
  direction — the eastward leg to the Indus SLOWED (0.66 → 0.54 km/yr,
  arrival −3155 → −2027, now a miss) while the northwestward legs sped up
  by a quarter, which is §4's sign but is confounded by the Iranian
  plateau's capacity and is not decidable without the per-cell arrival
  raster. Decided by that raster, run on request (QUESTIONS #64): it is
  the plateau's capacity — a 750 km patch at 0.18 persons/km² crossed at
  0.16–0.30 km/yr, ~2,400 years of the miss — and the anisotropy test on
  the same raster shows no east–west penalty at 30–60 °N. The clamp is
  inactive at the chosen stride BY CONSTRUCTION — the
  stride is the largest whole year inside the bound at which the share
  reaches `PEOPLE_MIGRATION_MAX_SHARE` — so what the long arm measured is
  how much of the 0.936 recovered: 91 %.
- **§3.** Aspect ratio inside [0.5, 1] on every row; the migration bound
  ~48 months at every latitude; §2's target stride rises to 48 and its cost
  is re-measured. Parity and the oracle hold across the land re-packing.
  The travel gate's rivers, lakes and floodplain rows hold at target.
- **§4.** The front at both grids before and after; the mid-latitude
  east–west speed measured directly (Levant → Balkans, Levant → Indus).
- **Throughout.** Lint, tsc, unit, smoke, parity, the bench ratchet with any
  re-baseline reasoned, the oracle, the Chromium browser smoke, the travel
  and people gates. Correction: `npm run coverage` is the **v1** tool — it
  imports `src/sim/peopleSim` and asks whether v1's `collect()` reaches every
  property — and cannot see v2 state at all. For §2c's schedule state the v2
  equivalents are the persistence round-trip in `smoke.ts` (the schedule is
  saved and `sameSchedule`-checked on load) and the unit assertions that the
  clock is the gcd of the schedule it is derived from. §3b's re-packing needs
  the same treatment, not `coverage`.

## Rulings that stay the owner's

- **The visible step — reopened by the clock correction.** As landed, §2
  makes the shipped app read **"1-year steps"** during the prehistory solve
  (7 at dev), not the "2-year" first specified: the clock is the gcd of the
  strides (§2b), and gcd(84, 24) = 12. This is not cosmetic drift, it is what
  the correct clock gives, and §3 does not improve it on its own —
  gcd(84, 48) is 12 as well. Three ways to a coarser visible step, all
  mechanisms rather than labels, and the choice is the owner's:

  | | rule | target strides | visible step | cost |
  |---|---|---|---|---|
  | **a** (landed) | each pass at the largest whole year inside its bound | 84 / 24 | 1 year | — |
  | **b** | …and a DIVISOR of the coarsest stride | 84 / 21 | 1.75 years | +14 % movement firings |
  | **c** | coarsest stride rounded to a MULTIPLE of the shortest | 72 / 24 | 2 years | +17 % reaction firings ≈ +13 % total |

  Rounding down is always safe — a shorter stride is inside its own bound —
  so all three are legal; (a) is what §2a's rule says literally, and the
  "2-year" and "4-year" numbers first written here were (c)'s. After §3 the
  spread widens: (a) stays at 1 year, (b) gives 42 months (3.5 years) for the
  same +14 %, and (c) drags the reaction passes down to 48 months, which is
  expensive. If the player-facing number matters, (b) is the one that scales.
- **The cultivation wait** (hearths), P10, P15 — unchanged. P15, the
  frontier growth rate, may close on its own once §2–§4 deliver the
  designed speed; it is not touched here. The arrival raster (#64)
  measured Europe's residual as ring-by-ring terrain — 0.60–1.07 km/yr on
  the ground each ring holds, the slow rings Bavaria and the Rhine at
  capacity 6–8 — not a uniform rate deficit, so the front does not ask for
  P15 (which would also add to M3b's 593M).
- **P17, routed catchment runoff as water access** (DECISIONS P17, from
  #64). The Indus row now waits on it: the plateau sites that were farmed
  on mountain runoff (Jeitun, Sang-e Chakhmaq, Mehrgarh, Tepe Yahya) read
  the moisture floor and water access 0.02 in the substrate, with no
  channel of any magnitude within ±125 km, so wheat capacity there is
  0.13–0.21 persons/km² against 3–19 in Europe. A substrate mechanism, the
  owner's to rule on; not built here.

## Status (2026-09-05)

§1 landed and verified (`a1eac742`). **§2 landed and measured at the grid
that ships: the front is 0.854 km/yr, Europe is on time, the Indus is not**
(QUESTIONS #63; the target known-miss manifest re-measured to 22 rows, 60
in all — three cleared, six refreshed, sixteen first measured). What is
left is 9 % of the design, split by direction, and the population
overshoot grew with the speed (214M / 497M / 593M against 100 / 200 /
400M) — M3b's debt, not this wave's. **§3 measured and NOT built** — as ratified it moves the shipped-grid stride from 24 months to 24
months (§3d, QUESTIONS #61, DECISIONS 33), so 31(c) is withdrawn and §4,
which is worse off under it than §4b assumed, is blocked behind whatever
replaces it. The rule that does work (`n_row = max(1, floor(width·cos))`) is
a different design and is proposed as DECISIONS P16, awaiting the owner. §2's corrections to what
was specified are marked inline above: the clock is the gcd and not the
shortest stride (§2b — the shortest-stride clock would have run the reaction
passes at double their bound), the shell reads 1-year steps and not 2 (§2c,
§Rulings), there is no v7 → v8 save expansion (§2c), the bench row is per
solve-YEAR (§2c), the target parity arm trades span for cadence coverage
(§2c), and `npm run coverage` is a v1 tool that cannot see v2 state
(§Acceptance). The awake migration stride at target also moves 84 → 24 as a
side effect — the corrected share saturates at 84 there — so the target
world hash moves `b05519874764bff8` → `217a88344bd3a6b1` while dev is
byte-identical.

**The direction split is decided (QUESTIONS #64, the arrival raster, run
on request).** The eastward leg is not slow: it runs at 0.99–1.06 km/yr
for its first 500 km and at 0.85–1.17 on the Indus side, and the whole
of its lateness is a 750 km patch of the Iranian plateau that the
substrate holds at 0.18 persons/km² of wheat capacity (fit 0.06), crossed
at 0.16–0.30 km/yr — ~2,400 years, more than the Indus miss. The patch is
dry because the water that farmed the real piedmont sites is not in the
substrate: annual moisture at the quantile map's 0.02 floor, water access
0.02, river magnitude 0 within ±125 km, no floodplain — Jeitun and
Mehrgarh are never farmed by 1 CE, Sang-e Chakhmaq and Tepe Yahya 4,100
years late, while Çatalhöyük, Karanovo and Vinča are on the year. The
anisotropy test on the same raster finds no east–west penalty at
30–60 °N, so the sign split #63 read as §4's is the confound, and neither
§4/P16 nor P15 is indicated by the front. What is indicated is a
substrate mechanism, routed catchment runoff as water access (DECISIONS
P17) — proposed, not built. Why §2 moved the Indus 1,128 years later is
still not explained; that needs a raster of the pre-§2 arm.

Before §2, `a1eac742` had left nine dev solve rows unacknowledged and the
per-commit people gate red; they are measured and recorded in `15d83fe6`,
and fourteen stale reasons refreshed with them.

Verified: tsc, lint, unit, smoke, the byte-exact kernel parity harness (8m17s,
three regimes per grid, serial wasm and 1/2/8 workers), the travel gate, the
people gate (48 known misses, none unacknowledged, none stale), the bench
ratchet `--check`, the worldgen oracle, and the Chromium browser smoke — the
last returning dev `64e16935452e6c26` unchanged and target
`217a88344bd3a6b1`. The shipped-grid `GATE_PEOPLE_SOLVE_TARGET=1` arm was
run once on request (1,504 s, #63), and once more as the chunked
arrival-raster run (~1,500 s in four save/load chunks, #64); the full
three-engine browser matrix stays in `v2-long`.

§3 was measured, not run: the per-row transport bound computed from the real
substrate with the same expression the scheduler uses, validated against the
shipped 24-month stride on the no-merge arm. No simulation was run for it,
and no code changed — the finding is the deliverable (§3d).

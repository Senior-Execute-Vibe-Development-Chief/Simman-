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

- The solve clock advances by the **shortest solve stride** (24 at target,
  84 at dev). Each pass fires when due, by the same `isDue(step, stride,
  phase)` check the awake regime uses — the cadence check stays centralised.
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
  `SAVE_VERSION_W12 = 8`; a v7 save's single stride expands to the schedule
  it implied (every pass at that stride) so old saves load and re-derive.
- Provenance prints the solve schedule per pass, as it prints the awake one.
  The status line's `solve 84` becomes the per-pass list; the shell's
  "solving · 7-year steps" reads the clock advance, so at the shipped grid it
  reads **"2-year steps"**. That is visible to the player and is the cost of
  the front being right; the owner has seen the number (§Rulings).
- The scrubber's reconstruction of the solved span is unchanged in kind:
  frames at recorded arrival steps, granularity the clock advance.
- `kernel-parity.ts` converts steps to years through `solveStride`; it
  converts through the clock advance instead, and its solve arm must show
  migration firing 3.5× as often as growth at target — a schedule with more
  than one stride is the case the harness has never seen and the one that
  matters.
- The bench's solve rows change by construction; the baseline is re-set
  and the row's note records "per-pass solve strides, W12" and the measured
  ratio.

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

### 3c. What it gives

- With `h_ew ~ h_ns` everywhere, `<d²>` is uniform and the migration bound
  is ~48 months at every latitude — with nothing given up anywhere. It
  removes the problem §2 works around, rather than trading against it: after
  §3, §2's migration stride at the shipped grid rises from 24 to 48 and its
  cost from ~1.5× to ~1.15×.
- It is the prerequisite for §4 at the shipped grid (below).
- It is the prime suspect for the Antarctic `canGrow` oddity (§5), and for
  the documented 1.3–2.2× dilution of 1-D coast and river terms, both of
  which are the same over-resolution seen from other sides.

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
shipped grid until §3 has bounded the aspect ratio. After §3 the bound is
~32 months everywhere and §2's derivation picks it up.

### 4c. What it is expected to do

Restore east–west transport across the mid-latitudes, where the isotropic
split under-serves it by the aspect ratio (1.4× at 45 °N). The Eurasian
front runs east–west; this is the remaining candidate for the gap between
0.670 and the 0.936 design once §2 has removed the clamp. Measured, not
assumed: the acceptance arm reports the front at both grids before and
after, and the Indus and Ganges arrivals, which are the null rows this
speed owns.

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

## Acceptance

Measured at both grids on every commit (dev) and in `v2-long` (target,
`GATE_PEOPLE_SOLVE_TARGET=1`):

- **§2.** The solve schedule prints per pass; at target migration fires at
  24 months and every other pass at 84; at dev all at 84. Parity byte-exact
  in the solve regime with a multi-stride schedule. The front at target
  moves from 0.670 toward 0.936 and the residual is attributed (clamp
  fraction by population, per firing, reported). The Indus and Ganges
  arrival rows at target are reported (currently null). Cost measured at
  the shipped grid and recorded in the bench note. The shell reads "2-year
  steps" at the shipped grid.
- **§3.** Aspect ratio inside [0.5, 1] on every row; the migration bound
  ~48 months at every latitude; §2's target stride rises to 48 and its cost
  is re-measured. Parity and the oracle hold across the land re-packing.
  The travel gate's rivers, lakes and floodplain rows hold at target.
- **§4.** The front at both grids before and after; the mid-latitude
  east–west speed measured directly (Levant → Balkans, Levant → Indus).
- **Throughout.** Lint, tsc, unit, smoke, parity, the bench ratchet with any
  re-baseline reasoned, the oracle, the Chromium browser smoke, the travel
  gate. `npm run coverage` for the schedule state (§2c) and the re-packing
  (§3b).

## Rulings that stay the owner's

- **The visible step.** §2 makes the shipped app read "2-year steps" during
  the prehistory solve (7 at dev), and the solve takes ~1.5× longer, until
  §3 lands and brings it to "4-year steps" at ~1.15×. The owner has the
  numbers; the order in which §2 and §3 land is theirs.
- **The cultivation wait** (hearths), P10, P15 — unchanged. P15, the
  frontier growth rate, may close on its own once §2–§4 deliver the
  designed speed; it is not touched here.

## Status (2026-09-05)

§1 landed and verified (`a1eac742`). §2–§4 specified; implementation on
request, in the order §2 → §3 → §4. Dev findings 9, shipped-grid findings
15, at HEAD `e46d58e0`.

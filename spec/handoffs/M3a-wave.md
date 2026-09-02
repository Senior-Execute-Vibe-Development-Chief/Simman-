# HANDOFF — Milestone M3a of Simman v2: the wave and the crops

**For:** the implementing agent (Cursor).
**From:** the review session of 2026-09-02 (branch
`claude/world-sim-rebuild-decision-1umpax`). **Branch from the commit that
merges this branch into main** — twice now a wave has branched from a main
that lacked the previous review's kernel fixes (W3 pool, W4 accumulators)
and had to be re-merged by hand.
**Scope:** the spread of farming becomes a prediction, not a script: where
it goes, how fast, and where it stops. Crop packages with climate
tolerances, wild-progenitor ranges replacing the hearth pins, farmers as a
sub-population carried by migration so the front's speed EMERGES, spread
over the travel field with short coastal hops, and a radiocarbon reality
table for the front. **Do not start M3b** (no food books, harvest years,
granaries, famine, herds, fish, communities); do not touch the scheduler,
the thread pool, worldgen or the substrate builders except where named.

## Why (owner play-report, 2026-09-02, target grid at 4400 BCE)

The M2 wave reaches the Old World core correctly — Fertile Crescent,
Anatolia, the Iranian plateau, Lower Egypt, the Indus, the Yellow River
and Yangtze — and is wrong everywhere the front had to cross water or
stop at a climate: Europe has no farming (reality: Balkans 6500 BCE,
central Europe 5500 BCE), the Near Eastern package has poured across the
Sahel to the Zambezi (reality: Sahel millet ~3000 BCE, the south after
1000 BCE), all of India is farmed (Ganges rice ~2500 BCE), and South
America carries a huge blob over the Chaco (reality: Peruvian coast and
south-west Amazonia, settled farming ~3000 BCE). Where nothing else bounds
the front it is a diamond: the 4-neighbour grid metric made visible.

The cause is that "technique" is one scalar moving at a fixed 1 km/yr
over land, above a permissive climate floor. Real farming spread because
FARMERS multiplied and moved: it ran fast up loess corridors and along
coasts by boat, paused a thousand years at the North European Plain
(day length and season), stalled two thousand at the tropical edge of the
Sahara (wheat does not grow there), and held off for millennia where
foraging was rich (the Baltic, Jomon Japan). The 1 km/yr is an AVERAGE
that came out of that process (Ammerman & Cavalli-Sforza), and this
milestone makes it come out of ours.

## Required reading, in order

1. `spec/04-people-and-food.md` §4.1–4.2 (the crop-package clause,
   storability, the reality tables) and §4.4.
2. `spec/handoffs/M2.md` rulings (the hearth-maturity law; peopled-basin
   years), `spec/handoffs/W3-cadence.md` and `W4-layout.md` with their
   status sections (the kernel doctrine you inherit: land-packed scratch,
   band partials in locals, byte parity, cadence via the scheduler).
3. `v2/QUESTIONS.md` #32–#36.
4. `v2/src/ported/worldgen/cropPackages.js` — v1's six packages with
   climate bells (`pkgClimateBell`), storability and domestication lags,
   already ported and cited. `cropGen.js` — how the single
   `wildCropSuitability` field is composed today.
5. `v2/src/sim/people/technique.ts`, `growth.ts`, `migration.ts`,
   `capacity.ts`, `rust/people/src/lib.rs`; `src/sim/travel/cost.ts`
   (`fillMigrationDaysPerKm`, `migrationEdgeLengths`, the coastal mode).
6. `v2/data/reality/hearths.json`, `farming-arrivals.json`,
   `known-misses-people.json`; `tools/gate-people.ts`.

## Ground rules (non-negotiable)

- **R1/R2/R7 as always.** No time gates. No place names in code — the
  Fertile Crescent, the Sahel, the Danube must not appear anywhere but
  data files and reality tables. Earthness enters as MAPS (wild ranges,
  climate) and as a package catalogue (botany), never as a mechanism. On
  a procedural preset the wild ranges are generated with the biomes and
  the same code runs.
- **No scripted speed.** `PEOPLE_TECHNIQUE_WAVE_KMPY` is deleted. The
  front's speed is an OUTPUT, checked against the radiocarbon table. If
  it comes out wrong, the mechanism is wrong; nothing is dialed.
- **Kernel doctrine unchanged.** Every new per-cell array is land-packed
  scratch or a land-packed saved field; every per-cell loop is banded;
  partials accumulate in locals and combine in band order; the TS oracle
  and the Rust kernel stay byte-identical (parity is the development
  instrument — 240 dev / 24 target ticks — the gate is the merge
  instrument). Cadence goes through `scheduler.ts`; the conversion pass
  declares its stride like every other pass.
- **Cost budget:** ≤ +8 ms per target tick on the review runner's 40 ms
  (measured per phase, reported). Everything static — can-grow per
  package, wild ranges, hop tables — is a LUT built once at init.
- Branch `cursor/v2-m3a`; QUESTIONS.md and the constants ledger are the
  sanctioned append points; scratch probes never committed.

## Deliverables

### 0. Baseline

Before any change, at the target grid: the technique map at −8000, −6000,
−4000 and the arrival table. The target long-arm rows in
`known-misses-people.json` are the baseline; if they are still absent
when you start, run `GATE_PEOPLE_LONG=1 npm run gate:people` once at the
target grid (the shipped and the stride-1 trajectories, ~2 h on a 4-core box with the threaded kernel; the gate no longer pins one worker) and
write them with physical reasons before touching the wave. QUESTIONS #36
has the dev numbers. This is what the wave is judged against, before and
after.

### 1. The package catalogue and two overlays (data)

- The catalogue is `cropPackages.js`'s six packages, promoted to a data
  file (`data/reality/crop-packages.json`) carrying per package: the
  climate bell (tOpt/tTol, mOpt/mTol, and a **growing-season-length
  minimum** — new, from the monthly climate: months above the package's
  base temperature; the Baltic pause is day length and season, and a
  package without it will cross the North European Plain on schedule
  with nothing to stop it), storability and yield (M3b reads them),
  and the domestication lag.
- **Can-grow**: per package, the land cells whose climate clears the bell
  and the season minimum — a land-packed Uint8 LUT per package, built at
  init from the substrate's monthly climate. Recomputed if the climate
  ever changes (it does not yet).
- **Native**: per package, the wild-progenitor range — a raster baked to
  both grids from crop biogeography (`tools/build-cropdata.mts`, cited
  sources in the file header, carried like `LAKE_MASK`). This REPLACES
  `hearths.json` as an input; the pins move to the reality table as the
  archaeological check (deliverable 6). Add the packages the six lack
  where the botany supports them (a New Guinea root package, an
  Ethiopian highland package, eastern North America's seed package are
  the known omissions) — each is a catalogue row plus a range, no code.
- Two shell lenses: **package** (which package a cell farms, by the
  catalogue colour) with **can-grow** and **native** as toggleable
  overlays. The gap between native and can-grow is exactly the ground
  the wave must cross.

### 2. Farmers as a sub-population

- Per package, a land-packed mass array `farmers[p]` (persons/km², same
  contract as the cohort masses), saved (SAVE_VERSION bump); foragers
  are `people − Σ farmers`. **`technique` becomes DERIVED**: the farmed
  share per cell, with the dominant package, so every existing hook —
  capacity, the growth regime, the lenses — keeps reading a 0..1
  technique field unchanged.
- **Growth splits by group**: farmers grow at the farmed rate toward the
  farmed capacity of their package (capacity × that package's can-grow
  suitability × yield), foragers at the forager rate toward forager
  capacity. Same logistic, same graveyard, per group; births and deaths
  stay the ledger's named channels, now summed over groups.
- **Migration carries them**: the gather moves `farmers[p]` mass with the
  people exactly as it moves the cohort masses today (the same
  `cohortShareOf` shape). That IS the demic wave — nothing else moves
  technique.
- **Conversion pass** (annual, via the scheduler): foragers in a cell
  adopt package p at rate `PEOPLE_ADOPTION_RATE_PER_YEAR × contact_p ×
  advantage_p`, where `contact_p` is the farmer share of p over the
  travel-weighted stencil (deliverable 3) and `advantage_p = max(0,
  (capacity_p − foragerCapacity) / foragerCapacity)`. Where advantage is
  ≤ 0 nothing converts — that is the forager-resistance and the
  climate wall in one expression. Symmetrically, farmers revert to
  foraging where advantage < 0 (abandonment; it costs nothing to carry
  and M3b's famine will need it). Conversion is booked as a balanced
  ledger channel (people are conserved; only labels move).
- The wave's SPEED is now 2·√(r·D) of the farmer group: growth advantage
  × mobility, per cell, with no constant for it.

### 3. Spread over the travel field, with coastal hops

- The neighbour stencil for migration conductance and for contact
  becomes **8 neighbours with true edge lengths** (the diagonals from the
  row geometry `cost.ts` already has), weighted by the month's days/km
  the migration cache already holds. Diamonds disappear; rivers and
  coasts run ahead; mountains and forest lag — all from the cost model.
- **Coastal hops**: for a coastal land cell, extend the stencil across up
  to `PEOPLE_COASTAL_HOP_KM` of water in each of the 8 directions to the
  first land cell, with the hop priced by the coastal mode's days/km ×
  sea distance. Built once as a per-coastal-cell hop table (LUT). The
  hop length is what foot-and-raft crossings were — tens of km — and
  the Cardial coast (Mediterranean arrivals ~1000 years before inland)
  is the check that it is not a highway. Applies to migration and to
  contact alike; the peopled mask is extended by arrival (an island
  someone reaches is peopled from then on).

### 4. Hearths condense; the pins go

A cell on the native range of package p, whose basin has been peopled
above the forager-density bar for at least the package's domestication
lag (the existing peopled-basin-years law, unchanged, with the lag now
from the catalogue instead of the pin), seeds `farmers[p]` at
`PEOPLE_HEARTH_SEED_FRACTION` of its people. No search window, no
scored fallback, no pin: the first cells to qualify on each range are
the hearths, and a map without a range never farms (Australia). Keep
`PEOPLE_HEARTH_MIN_SEPARATION_KM` as the condensation bar between
hearths of the same package (two ignitions 200 km apart are one
hearth), nothing else from the pin machinery survives.

### 5. Capacity and the existing hooks

`deriveCapacity` reads the cell's dominant package: farmed capacity =
`PEOPLE_FARM_CAPACITY_PER_KM2 × fertility × canGrow_p × yield_p ×
(technique regime)`. The water-access, floodplain and relief terms are
unchanged. `wildCropSuitability` (the single field) is no longer read by
the people pass; it stays in the substrate for the lenses until M3b
decides its fate.

### 6. The reality table for the front (`tools/gate-people.ts`)

- `data/reality/neolithic-arrivals.json`: the European radiocarbon
  dataset (Pinhasi, Fort & Ammerman 2005 — the 735 dated sites, or the
  regional summary if the full set is impractical), plus the existing
  region rows, plus: Sahel (~−3000), Ganges (~−2500), Japan (~−800),
  South India (~−3000), the Cardial coast vs inland Europe. Each row is
  a region and a window, as today.
- Checks: arrival inside the window; the front's mean speed across
  Europe within the measured band (0.6–1.3 km/yr) and the Danube corridor
  faster than the mean; **no farming south of the Sahara before the
  Sahel window** (the wall); front isotropy (the bounding aspect of any
  free front within 1.3, so a diamond fails). Misses go to the manifest
  with a physical reason, never a dial.
- The stride arm stays: the conversion pass at its stride vs stride 1.

### 7. The budget and the parity

Per-phase ms at target before/after; the +8 ms cap; parity byte-exact
across TS, serial wasm and 1/2/8 workers with the new arrays in the
harness's field lists; the Chromium shell still reporting threads.

## New constants (ledger rows, all with grounding)

| Constant | Meaning |
|---|---|
| `PEOPLE_ADOPTION_RATE_PER_YEAR` | forager→farmer conversion per unit contact × advantage; grounded on the measured European front speed — if only an implausible value fits, that is a mechanism finding |
| `PEOPLE_COASTAL_HOP_KM` | longest water crossing foot-and-raft people make; tens of km |
| `PEOPLE_HEARTH_SEED_FRACTION` | share of a hearth cell's people who farm at ignition |
| `PEOPLE_FORAGER_DENSITY_BAR` | the peopled-basin density the hearth law already implies, made explicit |

Deleted: `PEOPLE_TECHNIQUE_WAVE_KMPY`, the hearth search/score constants
(`PEOPLE_HEARTH_SEARCH_FRACTION`, `_SCORE_*`, `_FALLBACK_LAG`,
`_LAG_RANGE`, `_MAX_COUNT`).

## Acceptance (what "done" means)

`lint && test && smoke && gate && bench -- --check && oracle && build`
green at both grids; parity byte-exact; the front reality table passing
or manifested with reasons; Europe farmed by −4000 on the target grid
with the Balkans before the Rhine; no farming south of the Sahara before
the Sahel window; the three maps of deliverable 0 re-taken and put beside
the baseline in QUESTIONS.md; per-phase cost table; PR from
`cursor/v2-m3a` titled `v2 M3a — the wave and the crops`, body listing
each deliverable with measured numbers. Review is line by line against
this document.

## What NOT to do (recap)

No food books, harvest years, granaries, famine, herds, fish, communities,
irrigation works (M3b). No paleoclimate or sea-level tracks (P9/P10,
owner rulings pending). No long sea voyages (14). No speed constant of
any kind. No place names in code. No touching the scheduler, the thread
pool, or the band layout. No tolerance edits to pass the front table.

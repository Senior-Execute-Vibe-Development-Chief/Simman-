# Simman v2 — M3a wave and crops

M3a builds on the immutable Earth substrate and seasonal multimodal travel
field with one real-unit population field. Population grows toward derived
carrying capacity, migrates through the travel field's local costs, and farming
emerges as per-package farmer populations carried by that migration.

## Setup and commands

Requires Node 20+ and Rust with the `wasm32-unknown-unknown` target. From this
directory:

```bash
npm ci
npm run lint       # ESLint restrictions plus constants-ledger lint
npm run test       # smoke gate plus unit checks
npm run smoke      # M0 integrity plus layered WASM routing battery
npm run gate       # travel reality gate followed by M3a people gate
                   # (hard-fails on any failure NOT acknowledged in
                   #  data/reality/known-misses.json, and on any stale
                   #  manifest entry that now passes — a one-way ratchet)
npm run oracle     # v1 supplier comparison with per-field diff report
npm run bench      # substrate and routing phase measurements
npm run bench -- --check  # compare measurements with committed baselines
BENCH_LONG=1 npm run bench  # add the target-grid 1000-year wall-clock run
npm run build      # WASM build, strict TypeScript check, Vite production build
npm run browser    # Node + Chromium + Firefox + WebKit identity checks
npm run dev        # Vite development server
```

`npm run gate:people` runs the people arm directly. Per commit it is
mechanical: the opening-window checks at both grids over twelve ticks
(seconds, plus the substrate builds). **Nothing that simulates history runs
per commit** (owner directive, 2026-09-03). The 3000-year dev trajectory
arm and the cadence stride arm run with `GATE_PEOPLE_TRAJECTORY=1`; the
full YD→1 CE dev and shipped-grid batteries — population checkpoint bands,
farming arrival order and timing, density ordering — with
`GATE_PEOPLE_LONG=1`. Misses are acknowledged in
`data/reality/known-misses-people.json` or fail the gate. The bench's
per-phase cadence table (six configurations per grid) runs with
`BENCH_CADENCE=1`; `bench -- --check` alone is the ratchet. In CI the
mechanical checks run as four parallel jobs on every push
(`.github/workflows/v2-ci.yml`); the long arms and the full browser matrix
are `v2-long.yml`, on request or weekly.

The W1 water bake is reproducible with `npx tsx tools/build-waterdata.mts
<etopo.nc> <HydroLAKES_polys_v10.shp>` when refreshing the committed
`RIVER_FLOOD` and `LAKE_MASK` layers. The full
`tools/build-riverdata.mts` bake accepts the polygon path as an additional
argument.

`npm run smoke`, `npm run build`, and `npm run browser` build the Rust bindings
as needed. `npm run browser` launches its own Vite server and compares the
Node and three browser results.

## Layout

```text
src/sim/       world, substrate adapter, people fields, travel engine, dmath, worker
src/ported/    byte-compatible RNG and copied v1 worldgen supplier
src/shell/     terrain/climate/travel demo (Equal Earth display projection; sim grid stays lat-lon)
rust/router/   wasm-bindgen layered routing engine
rust/people/   wasm-bindgen banded people kernel
data/reality/  cited travel, crop-package, range, and arrival fixtures
tools/         smoke, gate, oracle, bench, browser runner, collector
```

The `dev` grid is `240×120`; the shipped `target` grid is `1800×900`.
Unresolved choices and measured gate findings are recorded in `QUESTIONS.md`.
The first reality-table landing is allowed to fail its hard route rows; such
failures are findings for the next mechanism revision, never route-specific
fudge factors.

## M3a guarantees

- The v1 worldgen chain is copied under `src/ported/worldgen` and only
  consumed through the typed `buildSubstrate` boundary.
- The substrate exposes land, monthly temperature/moisture, rivers/lakes,
  measured fractional floodplain and monthly river-flow scales, biome,
  soil/crop suitability, resources, relief, coast distance,
  and deep ancestry as typed arrays; it is rebuilt, never saved.
- Travel is in days using real Earth geometry, month-specific climate,
  capability-gated modes, directed river costs, intermodal transfers, and a
  three-phase WASM routing API.
- Save → load → save is byte-identical, and continuation remains identical.
- `people` is density in persons/km²; world totals use each cell's real area.
- The only population representation is the people field. Capacity is derived,
  and the three cohort fractions ride the same field.
- Births and deaths are named sources/sinks; migration is a balanced channel
  in the per-pass conservation sheet.
- Farming is a derived share of per-package farmer masses. Climate bells,
  growing-season minima, wild ranges, and travel costs determine where the
  demic wave can move; farmers move at their own grounded mobility and
  foragers adopt the package of the farmers they live among, so the front's
  speed is 2·√((r + adoption)·D) of the farmer group — no speed constant or
  hearth pin drives it. A cell's capacity is the mixture of its people, and
  the land a farming source can enter opens in proportion to the farmers it
  sends; a hearth ignites where a native range has been a peopled basin for
  the package's domestication lag (the M2 law).
- Save format v5 persists people, farmer masses, derived technique, cohorts,
  peopled arrivals, hearth progress, and the resolved pass schedule; terrain
  remains immutable substrate rebuilt
  from its identity.
- `collect()` exposes `pop.people`, `pop.perKm2`, largest-cell density,
  technique coverage, weighted cohort shares, and per-pass firing counts.
- Every people field pass uses aggregated named source/sink accounting.
- People cadence is derived, not scripted: growth/technique/capacity/cohorts
  fire annually; migration's stride is the largest divisor of 12 whose
  per-firing share stays inside the diffusion bound (dev 12, target 1).
- The wasm people kernel uses a row-major land index and 16 fixed,
  grid-derived row bands. Only scratch and iteration are land-packed; the
  saved people, technique, cohort, and capacity views remain full-grid.
  Node `worker_threads` and cross-origin-isolated browsers run those bands
  on a shared-memory pool: one per process, pre-warmed asynchronously by
  `ensurePeopleWasm({ workers })` and borrowed by kernels; the dispatch
  descriptor lives in shared memory and barriers wait in 1 ms slices;
  hashes are identical for 1, 2, and N workers and identical to the serial
  TypeScript oracle. Hosts without isolation, and a browser main thread
  (which may not block in `Atomics.wait`), fall back to serial wasm,
  logged in the status line; a worker that fails mid-phase raises an error
  through shared memory rather than hanging the coordinator. Band partials
  accumulate in locals (per-cell writes to adjacent slots false-shared a
  cache line and threads gave no speedup). On the review runner the target
  shipped tick is 88 ms serial and 40 ms on three threads (78 min projected
  for YD→1 CE); the ≤15.5 ms ceiling remains open. QUESTIONS #34 has the
  W3 thread table and review corrections, #36 the W4 traffic ledger, the
  false-sharing finding and the measurements.
- M3a adds a catalogue-backed crop system: one can-grow LUT and one native
  wild-range mask per package, farmer masses in the same land-packed order as
  the kernel's cohort state, and an annual local adoption/reversion pass.
  Migration uses an eight-neighbour true-distance stencil with coastal hops
  capped by the grounded crossing length. The package, can-grow, and native
  overlays are available in the shell. QUESTIONS #37 has the M3a review:
  what the delivered mechanisms did, what the corrections are, and the
  measurements.
- `collect()` measures numeric leaves and distributions by default; its
  fail-open scratch list is exported from the collector.
- Node, Chromium, Firefox, and WebKit agree on world hashes, math bit goldens,
  and routing battery hashes.
- `eslint` forbids standard-library transcendentals in simulation and copied
  worldgen uses the v2 deterministic math substitutions.


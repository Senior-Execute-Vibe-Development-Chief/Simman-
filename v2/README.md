# Simman v2 — M2 people

M2 builds on the immutable Earth substrate and seasonal multimodal travel field
with one real-unit population field. Population grows toward derived
carrying capacity, migrates through the travel field's local costs, and learns
farming through a climate-tolerated wave from real and emergent hearths.

## Setup and commands

Requires Node 20+ and Rust with the `wasm32-unknown-unknown` target. From this
directory:

```bash
npm ci
npm run lint       # ESLint restrictions plus constants-ledger lint
npm run test       # smoke gate plus unit checks
npm run smoke      # M0 integrity plus layered WASM routing battery
npm run gate       # travel reality gate followed by M2 people gate
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

`npm run gate:people` runs the people arm directly. Its opening-window checks
run at both grids and every run adds a ~3000-year dev trajectory arm (first
hearth ignitions, curve checkpoints inside the window). The full YD→1 CE
dev and shipped target batteries — population checkpoint bands, farming arrival
order and timing, density ordering — run with
`GATE_PEOPLE_LONG=1 npm run gate:people`; misses are acknowledged in
`data/reality/known-misses-people.json` or fail the gate. The target-grid long
battery is the primary W2 verdict; the dev battery is retained for comparison.

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
data/reality/  cited travel reality fixture
tools/         smoke, gate, oracle, bench, browser runner, collector
```

The `dev` grid is `240×120`; the shipped `target` grid is `1800×900`.
Unresolved choices and measured gate findings are recorded in `QUESTIONS.md`.
The first reality-table landing is allowed to fail its hard route rows; such
failures are findings for the next mechanism revision, never route-specific
fudge factors.

## M2 guarantees

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
- The farming technique field is monotone, climate-tolerated, and driven by
  hearth maturity measured in peopled-basin years rather than calendar gates.
- Save format v3 persists people, technique, cohorts, and hearth progress;
  terrain remains immutable substrate rebuilt from its identity.
- `collect()` exposes `pop.people`, `pop.perKm2`, largest-cell density,
  technique coverage, and weighted cohort shares.
- Every people field pass uses aggregated named source/sink accounting.
- The wasm people kernel uses 16 fixed grid-derived row bands dispatched
  serially (W2 shipped single-thread wasm; parallel band execution is the
  open W2b item). Band order is fixed by the grid, so a future worker count
  cannot alter the field or world hash.
- `collect()` measures numeric leaves and distributions by default; its
  fail-open scratch list is exported from the collector.
- Node, Chromium, Firefox, and WebKit agree on world hashes, math bit goldens,
  and routing battery hashes.
- `eslint` forbids standard-library transcendentals in simulation and copied
  worldgen uses the v2 deterministic math substitutions.


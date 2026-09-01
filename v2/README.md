# Simman v2 — M1 land and the cost of moving

M1 builds on the M0 instrument bench with an immutable Earth substrate and a
real-unit, seasonal, multimodal travel field. It contains no population,
growth, migration, or technique physics; those begin in M2.

## Setup and commands

Requires Node 20+ and Rust with the `wasm32-unknown-unknown` target. From this
directory:

```bash
npm ci
npm run lint       # ESLint restrictions plus constants-ledger lint
npm run test       # smoke gate plus unit checks
npm run smoke      # M0 integrity plus layered WASM routing battery
npm run gate       # ORBIS/freight/season/cross-grid travel reality gate
                   # (hard-fails on any failure NOT acknowledged in
                   #  data/reality/known-misses.json, and on any stale
                   #  manifest entry that now passes — a one-way ratchet)
npm run oracle     # v1 supplier comparison with per-field diff report
npm run bench      # substrate and routing phase measurements
npm run bench -- --check  # compare measurements with committed baselines
npm run build      # WASM build, strict TypeScript check, Vite production build
npm run browser    # Node + Chromium + Firefox + WebKit identity checks
npm run dev        # Vite development server
```

`npm run smoke`, `npm run build`, and `npm run browser` build the Rust bindings
as needed. `npm run browser` launches its own Vite server and compares the
Node and three browser results.

## Layout

```text
src/sim/       world, substrate adapter, travel engine, dmath, worker
src/ported/    byte-compatible RNG and copied v1 worldgen supplier
src/shell/     terrain/climate/travel demo
rust/router/   wasm-bindgen layered routing engine
data/reality/  cited travel reality fixture
tools/         smoke, gate, oracle, bench, browser runner, collector
```

The `dev` grid is `240×120`; the shipped `target` grid is `1800×900`.
Unresolved choices and measured gate findings are recorded in `QUESTIONS.md`.
The first reality-table landing is allowed to fail its hard route rows; such
failures are findings for the next mechanism revision, never route-specific
fudge factors.

## M1 guarantees

- The v1 worldgen chain is copied under `src/ported/worldgen` and only
  consumed through the typed `buildSubstrate` boundary.
- The substrate exposes land, monthly temperature/moisture, rivers/lakes,
  floodplain, biome, soil/crop suitability, resources, relief, coast distance,
  and deep ancestry as typed arrays; it is rebuilt, never saved.
- Travel is in days using real Earth geometry, month-specific climate,
  capability-gated modes, directed river costs, intermodal transfers, and a
  three-phase WASM routing API.
- Save → load → save is byte-identical, and continuation remains identical.
- Every placeholder field pass uses aggregated named source/sink accounting.
- `collect()` measures numeric leaves and distributions by default; its
  fail-open scratch list is exported from the collector.
- Node, Chromium, Firefox, and WebKit agree on world hashes, math bit goldens,
  and routing battery hashes.
- `eslint` forbids standard-library transcendentals in simulation and copied
  worldgen uses the v2 deterministic math substitutions.


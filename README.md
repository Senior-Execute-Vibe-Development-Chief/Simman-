# Simman

A procedural world generator and emergent civilization simulator that runs
entirely in the browser. It builds a planet — tectonics, wind, rain, rivers,
soil, ores — then seeds two Neolithic river-valley villages on it and lets
thousands of years of history emerge: settlements crystallize, trade routes
form, states rise, wage war, overextend, and fall. Nothing is scripted; every
empire on the map is the output of local rules.

**Live build:** pushed to `main` deploys to GitHub Pages automatically.

## Quickstart

```bash
npm ci
npm run dev        # vite dev server
npm run lint       # eslint over src/
npm test           # headless smoke run (worldgen sanity + determinism + 4000-step invariant check)
npm run build      # production single-file build → dist/index.html
```

Requires Node 20+. The production build is a single self-contained HTML file
(`vite-plugin-singlefile`), so it can be hosted anywhere static.

## Using the app

The app has two tabs:

- **World** — the main attraction. Pick a preset, roll a seed, press play.
  - Presets: **Earth (Sim)** (real Earth heightmap + simulated climate; can
    optionally use real NCEP wind data), **Tectonic** (plate simulation from
    scratch), plus continents/archipelago-style noise presets and an **Import**
    mode (Azgaar Full-JSON exports or grayscale heightmap images).
  - View modes render terrain, biomes, crop suitability, political borders,
    trade flow, technology, and more. A 3D globe view can be toggled.
  - Click a settlement for its full economy panel (food, money flows, trade
    partners, tech tracks); hover tiles for local detail.
  - The **Levers** panel exposes the simulation's tuning constants live —
    growth rates, war pacing, trade friction, simulation granularity — and
    applies them to the running world.
- **Language** — a standalone procedural conlang generator (phonology,
  morphology, sample sentences with gloss).

## Architecture

Two layers, each in its own Web Worker so the UI never blocks:

```
src/worldgen.js + tectonicGen/windSolver/moistureSolver/riverGen/resourceGen
        │  runs in worldGenWorker.js (all presets; real-wind Earth stays on
        │  the main thread because the NCEP JSON lives in the main bundle)
        ▼
   world arrays (elevation / temperature / moisture / coastal / deposits)
        │
        │  WorldSim.jsx createTerritory(): rivers, moisture boosts, tCrop
        ▼
src/peopleSim/  — the civilization sim, runs in peopleSimWorker.js
        │  snapshot protocol → WorldSim.jsx renders a read-only mirror
        ▼
   canvas renderer + parchment UI (atlasUI.css)
```

### Worldgen

Plate tectonics (or preset heightmaps) → latitudinal + simulated wind fields →
iterative moisture transport → rivers/lakes with flow accumulation → biome and
crop-suitability classification → seeded resource deposits (14 tracked
resources from timber to dyes). Everything is deterministic from a single
integer seed.

### People sim (`src/peopleSim/`)

Settlements are the atomic entity — no individual agents. Each tick they farm
their cost-Voronoi territory, eat, grow, learn (six knowledge tracks gate
eras from Stone to Modern), trade along emergent road/sea networks with real
money (closed supply: mining faucet, wear drain, conservation in trade), and
politick: villages adopt the local state, cities found new ones, realms tax,
conquer along war fronts, suffer plagues and famines, fragment when
overextended. Country "personalities" (seeded RNG per realm) bias expansion,
aggression, and commerce. The sim is deterministic per seed; a granularity
lever (`SIM_GRANULARITY`) subdivides ticks for smoother history at the same
calibration.

Dev sanity: set `world._checkInvariants = true` (the smoke test does) to run
per-tick finiteness/range/conservation checks; violations tally on
`world.debug.invariantHits`.

## Tools

Headless node scripts for measuring the sim live in `tools/`:

- `tools/_harness.mjs` — **the** way to build a world in node. Replicates the
  app's exact pipeline (worldgen → rivers → moisture boosts → tCrop → deposits
  → `initPeopleSim`), so measurements match what the browser simulates.
  ```js
  import { buildSim } from "./_harness.mjs";
  const world = buildSim({ W: 480, H: 240, seed: 42 });
  ```
- `tools/smoke.mjs` — the `npm test` entry. Fast (~6s).
- `tools/earthRun.mjs` — long full-Earth runs with periodic reports
  (`EARTH_W=960 EARTH_H=480 node tools/earthRun.mjs 50000 8817`).
- `tools/diag_full.mjs` — deep checkpoint reports + JSON record (demography,
  territory, economy, tech, war, personality, longevity, hall of fame).
- `probe_*.mjs` / `diag_*.mjs` / `render_*.mjs` — focused one-off probes,
  diagnostics, and PNG renderers used during tuning. Most predate the harness
  and hand-roll a similar pipeline; prefer the harness for new tools.
- `tools/convert_wind_data.py` — regenerates `data/global_wind.json` from the
  NCEP/NCAR reanalysis NetCDF files (local copies in `data/`, else downloads).

## Data

- `src/earthData.js` — packed Earth heightmap (source reference images in
  `data/`).
- `data/global_wind.json` — NCEP/NCAR 10 m climatological winds, 12 monthly
  U/V grids, used by the optional "real wind" toggle in Earth (Sim).

## Deploying

`.github/workflows/deploy.yml` lints, smoke-tests, builds, and publishes
`dist/` to GitHub Pages on every push to `main`. The Vite `base` is set to
`/Simman-/`; change it if the repo name changes. Production builds strip
sourcemaps (`vite build --mode development` keeps them inline).

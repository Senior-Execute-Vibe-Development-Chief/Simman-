# Simman

A procedural world generator and emergent civilization simulator that runs
entirely in the browser. It builds a planet — tectonics, wind, rain, rivers,
soil, ores — then seeds a handful of Neolithic river-valley villages on it (three
historical hearths on the Earth preset; site-scored emergent cradles on procedural
maps) and lets
thousands of years of history emerge: settlements crystallize, trade routes
form, states rise, wage war, overextend, and fall. Nothing is scripted; every
empire on the map is the output of local rules.

**Live build:** pushed to `main` deploys to GitHub Pages automatically.

## Quickstart

```bash
npm ci
npm run dev        # vite dev server
npm run lint       # eslint over src/
npm test           # smoke run: worldgen sanity, determinism, invariants, save/load roundtrip
npm run validate   # stylized-facts suite: is the emergent history history-SHAPED?
npm run build      # production single-file build → dist/index.html
```

Requires Node 20+. The production build is a single self-contained HTML file
(`vite-plugin-singlefile`), so it can be hosted anywhere static.

## Using the app

The map is the app. A top bar carries the run controls (play + speed
steps), the era/year readout, a live ticker of the latest world event,
the globe toggle, the **New World** dialog, and the menu
(save/load/export, advanced tuning). Press a number key to switch lens,
Space to pause, Esc to close panels.

- **World** — pick a preset in ⊕ New World, roll a seed, press play.
  - Presets: **Earth (Sim)** (real Earth heightmap + simulated climate; can
    optionally use real NCEP wind data), **Tectonic** (plate simulation from
    scratch), plus continents/archipelago-style noise presets and an **Import**
    mode (Azgaar Full-JSON exports or grayscale heightmap images).
  - The left rail holds map **lenses** — Terrain (map/atlas), Politics,
    Peoples, Faiths, Economy (trade/money/resources/cropland) — with
    overlay toggles beneath (rivers, lakes, plates, layers). Worldgen
    diagnostics (wind/moisture/temperature/depth/crossing) appear with
    ?dev in the URL.
  - The right **World Panel** has five tabs: World (history charts + the
    scrolling event feed — click an event to jump the camera), Realms (a
    sortable browser; click through to a realm inspector with throne,
    faith, temperament, fisc and chronicle), Peoples and Faiths (live
    registries with lineage), and Inspect (the selected settlement).
  - Click a settlement for its full panel: economy (food, money flows, trade
    partners, tech tracks), its people and faith mixtures, and its realm —
    ruler, house, state faith, and the realm's chronicle. The chronicle
    opens into a full scrollable history with a **true record / scribes'
    version** toggle (see Historiography below).
  - **Save / Load** snapshots the entire running world (settlements,
    polities, the event log, money, roads, depletion) to a versioned JSON
    file; terrain regenerates from the recorded seed on load. **Export
    History** downloads the world bible: the full structured event log, all
    registries, and each great realm's chronicle in both versions.
  - The **Levers** panel exposes the simulation's tuning constants live —
    growth rates, war pacing, trade friction, simulation granularity — and
    applies them to the running world.

## Architecture

Two layers, each in its own Web Worker so the UI never blocks:

```
src/sim/  — the pure simulation package (no DOM/React/bundler deps)
  worldgen.js + tectonicGen/windSolver/moistureSolver/riverGen/resourceGen
        │  runs in worldGenWorker.js (all presets; real-wind Earth stays on
        │  the main thread because the NCEP JSON lives in the main bundle)
        ▼
  pipeline.js — rivers, moisture boosts, tCrop, deposits (ONE source of
        │       truth for app, workers, and tools)   + calendar.js
        ▼
  peopleSim/ — the civilization sim, runs in peopleSimWorker.js
        │       entities · events · cultures · faiths · dynasties ·
        │       historiography · persist (save/load)
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

### People sim (`src/sim/peopleSim/`)

Settlements are the atomic visible entity — no individual agents. Each tick
they farm their cost-Voronoi territory, eat, grow, learn (six knowledge
tracks gate eras from Stone to Modern), trade along emergent road/sea
networks with real money (closed supply: mining faucet, wear drain,
conservation in trade), and politick: villages adopt the local state, cities
found new ones, realms tax, conquer along war fronts, suffer plagues and
famines, fragment when overextended. Deterministic per seed, with
randomness partitioned into named substreams (`rng.js`) so adding a system
never perturbs another's dice.

On top of that economic-political engine sit the identity layers:

- **Entities & events** — polities are persistent records
  (`entities.js`) with stable ids and lifecycles (founded / ended /
  restored); fiscal state, temperament, names, and attachments live on
  them and survive conquest. Every consequential moment is appended to a
  structured, queryable **event log** (`events.js`) — actors, places,
  causes — and prose is only ever a rendering of it.
- **Cultures** (`cultures.js`) — peoples carried BY population: every
  settlement holds a culture mixture; conquest changes rulers, not
  peoples. Cradles found cultures; colonies that lose contact diverge
  into daughter cultures; subjects assimilate over generations. Each
  culture carries a generative phonology (`names.js`) that names its
  settlements, realms, dynasties and people in one recognisable tongue.
- **Faiths** (`faiths.js`) — folk faiths organize into churches in
  literate towns, spread along the trade graph, convert courts (state
  faith = legitimacy coupling on loyalty), and schism when followers
  span realms far from the founding see.
- **Dynasties** (`dynasties.js`) — sampled royal genealogies: rulers age
  in calendar years, marry (sometimes across courts), bear heirs, die;
  succession runs child → regency → sibling, and a bare house means a
  succession CRISIS — a legitimacy shock that gives wars human causes
  (war events carry crisis/faith/temperament annotations). Dynastic
  history begins with literacy, like real king-lists.
- **Historiography** (`historiography.js`) — any realm's history can be
  rendered as its OWN scribes kept it: an information horizon (distant
  events arrive as rumor or not at all), archive loss (sacked capitals
  burn records; lost foundings are retold as myth), and court bias
  (conquests are liberations, defeats are betrayals or omissions). False
  history from honest mechanisms — the true log stays underneath.
- **Emblems** (`emblems.js`) — heritable arms that EVOLVE. Every people
  carries a visual TRADITION founded from the biome it cradles on
  (maritime→blue, sylvan→green, arid→sun-and-sand, montane→stark stone);
  every realm flies an emblem founded from that tradition and its own
  character (a martial court blood-and-iron, a rich one gilded, a great
  centralised state quartered regalia, a clan brand for the undeveloped),
  which then descends UNCHANGED down its rulers, MARSHALS two lineages on
  one shield at a dynastic union, and is DIFFERENCED when a cadet line
  founds a successor state; every creed gets an aniconic sacred SIGIL that
  drifts on schism. Founded from emergent STATE, evolved by emergent EVENTS
  — never a clock (docs/emblems.md). The design-genetics engine it drives is
  `emblemGenome.js` + `emblemRender.js`.

**Save/load** (`src/sim/persist.js`): versioned JSON of the full dynamic
state; terrain rebuilds deterministically from the seed. The smoke test
proves save → load → hash identity.

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
- `tools/smoke.mjs` — the `npm test` entry. Fast (~10s): worldgen sanity,
  same-seed determinism, a 4000-step invariant run, save/load roundtrip.
- `tools/stylized.mjs` — `npm run validate`: scores a long run against
  stylized facts of real history (Zipf rank-size slope for cities, empire
  size tails, fallen-polity lifespan distributions, war rates and their
  correlation with succession crises, tech diffusion gradients from the
  cradles, urbanization bands).
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

- `src/sim/earthData.js` — packed Earth heightmap (1920×960; land/sea mask and
  relief both from the three-globe topology DEM — ocean by border flood-fill so
  straits/islands resolve, relief quantile-matched to the original Tangram
  elevation scale; source reference images in `data/`).
- `data/global_wind.json` — NCEP/NCAR 10 m climatological winds, 12 monthly
  U/V grids, used by the optional "real wind" toggle in Earth (Sim).

## Deploying

`.github/workflows/deploy.yml` lints, smoke-tests, builds, and publishes
`dist/` to GitHub Pages on every push to `main`. The Vite `base` is set to
`/Simman-/`; change it if the repo name changes. Production builds strip
sourcemaps (`vite build --mode development` keeps them inline).

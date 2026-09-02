# SIMMAN PERIPHERY & HARNESS DOSSIER (for the v2 rebuild spec)

Scope: worldgen chain, language subsystem, heraldry/emblems, validation harness, metric map, UI shell. Verdicts: **port verbatim** / **port with cleanup** / **redesign**.

---

## 1. WORLDGEN CHAIN

### Architecture in one line

`generateWorld(W,H,seed,preset,...)` (pixel-space climate) → `buildTerritory(w, RES=1)` (rivers, fertility, crops, resources, ancestry → "territory" arrays) → `initPeopleSim/createWorld` (downsamples everything by `tileRes`, default 2 → sim `tw = W/2`). One composed entry: `buildWorld({W,H,seed,preset,oceanLevel,tecParams,realWind,realWindFns})` in `src/sim/pipeline.js` — "THE single source of truth; the tools no longer carry a hand-synced copy." Pure and isomorphic across browser, both workers, and the node harness.

### Stage table

| Stage (file) | Inputs | Outputs | Resolution assumptions | People-sim coupling |
|---|---|---|---|---|
| **Noise/RNG** `worldgenUtils.js` (118 ln) | seed | `initNoise(seed)` seeds a module-level 512-entry PERM table; `noise2D/fbm/warp/ridged/worley`; `mkRng` (Park–Miller); `computeRelief(elev,w,h)` → Float32Array (3×3 max−min, x wraps, sea=0) | Noise sampled in normalized coords (nx=x/W) → grid-free. PERM is module-level state — one world per process at a time; behaviour "MUST stay bit-identical" to the old inline WorldSim copies | none |
| **Earth DEM** `earthData.js` (2.3MB) | — | `EARTH_ELEV` base64 (1920×960 bytes, ocean=0, land 3..255, quantile-matched relief), `EARTH_W/H`, `decodeEarth`, `sampleEarth` (bilinear) | Fixed 1920×960 equirectangular source, sampled to any W,H. Sub-pixel straits seal at coarse grids → `carveStraits` (Gibraltar list in worldgen.js, min-1-tile box "so it still opens at low render/validator resolutions") | none |
| **generateWorld** `worldgen.js` (870 ln) | W,H,seed,preset (`earth` / `earth_sim` / `pangaea` / `tectonic` / random), oceanLevel, `_tecParams`, `realWind` flag + injected `realWindFns` | `{elevation, moisture, temperature, dryFrac, summerDry, tAmp, warmRainFrac, coastal, swamp, width, height, preset, pixPlate, windX, windY, _seed}` — all Float32Array/Uint8Array(W·H) | Deliberately resolution-independent scans: coast proximity converted to **degrees** not pixels (a recorded bug where px-based ramp over-dried interiors at 1920); `dirDist` per-degree decay; all belt/fetch scans derived from W in degrees. Coast-distance BFS on CDT=4 subgrid; wind-temp advection on a 2× coarse grid, 60 iterations | Imports nothing from peopleSim. `realWindFns` injected (not imported) to keep ~5MB NCEP JSON out of the worker bundle |
| **earth_sim branch** (inside worldgen.js) | real heightmap + solved (or real) winds | Same fields; the physically-grounded flagship. Pipeline: three seasonal wind+moisture solves (July/January/equinox, ITCZ ±13°/0°), ocean-current model (4 gyre limbs from directional coast distance), westerly advection of warm marine air, monsoon spare, `dryFrac` reconstructed from a quadratic through 3 seasonal samples (Koppen months-of-drought), `summerDry` phase (Mediterranean axis), growing-season `tAmp`/`warmRainFrac` | Everything in degrees | none |
| — geographic corrections (same branch) | — | Named, bounded lon/lat Gaussians: Saharo-Arabian/Horn drying (Empty Quarter ~46°E/21°N), Patagonian rain shadow (~66°W), South-Asia monsoon foreland floor (~91°E/22°N), interior-Asia alpine lift (~86°E), Andes low-level jet (~60°W) | **Place-anchored constants** — each documented as a correction over a diagnosed solver debt (no seasonal storm track, DEM too smooth for the Andes), i.e. earth_sim-only escape hatches, not part of the emergent generator | none |
| — observed-climate override | `data/global_precip.json` + `global_airtemp.json` via injected fns | replaces moisture/temperature/dryFrac/summerDry/tAmp/warmRainFrac wholesale (quantile-mapped) | comment: "a deliberate escape hatch from the emergent generator … everything after this line still emerges" | none |
| **tectonicGen** `tectonicGen.js` (1270 ln) | W,H,seed, injected noiseFns, params | `{elevation, moisture, temperature, pixPlate, windX, windY}` | Coarse sim grid CG=4; plate assignment at PS=2; own wind/moisture/temperature combination (an **older duplicate** of the earth_sim logic — drift risk). Steps: weighted-Voronoi plates w/ velocities → multi-stamp land on plate nuclei → boundary interactions → bicubic modifier → hydraulic erosion → wind/moisture/temp | none |
| **windSolver** `windSolver.js` (646 ln) | W,H,elevation,fbm,params (incl. `season` −1/0/+1 — the monsoon engine; 0 = annual mean, byte-identical legacy), noiseSeed | `{windX, windY}` Float32Array(W·H) | Solves on WG=4 coarse grid, ~500 iterations, upscales. All params named physics-ish dials | none |
| **moistureSolver** `moistureSolver.js` (651 ln) | W,H,elevation,windX,windY,temperature,params (incl. `itczLat`) | Float32Array(W·H) moisture (ocean 0.5, land clamped 0.02..1); plus `terrainShelter(W,H,elevation)` → 0..1 enclosed-basin field | 2× coarse grid, bilinear upscale, x-wrap. Shelter radii in degrees. Conserved-budget depletive advection (continentality emergent), winter storm-track band ~37°±7° | none |
| **riverGen** `riverGen.js` (631 ln) | tw,th,tElev,tMoist,tTemp | `{flowDir, flowAccum, riverMag (0..4), maxAccum, lake (id per tile), lakeInfo, drainsTerminal, km2PerTile, km2PerAccum}` + `D8_DX/DY`, magnitude consts, `CATCH_TRIB` | **Deliberately resolution-invariant**: classification by absolute runoff-weighted catchment km² (STREAM 10e3 / TRIB 60e3 / MAJOR 800e3 / GREAT 2.4e6; TERMINAL_STRICT 2.5×), replacing a percentile cut documented as broken two ways at different grids. `EARTH_KM2=5.10e8` sets km²/tile from grid size. ONE fixed-tile constant remains: `maxLakeTiles = 800`. Transmission loss (0.30/tile, terminal-drainage-gated), endorheic evaporation, snowmelt w/ winter-amplitude proxy | none |
| **pipeline / buildTerritory** `pipeline.js` (609 ln) | worldgen `w`, RES=1 | `{tw,th,tElev,tTemp,tMoist,tCoast,tDiff,tFert,tCrop,tCross,tFlood,tRelief,deposits,rivers,tAncestry,ancestryCount,tArrival,ancBirth,ancParent,ancHue,ancLight,ancOriginFx,ancOriginFy}`; also stamps `w.rivers`, `w.deposits`, `w.seed` | Floodplain ribbon: under `T.RES_INVARIANT_POP` the alluvial half-width is **physical** (`FLOOD_W_KM·√(discharge-km²)`, converted to pixels; sub-pixel valleys mass-conserve) — a tile-radius rescale at 1920 once blew floodplain share 2.5%→14.5% and "realms ballooned". Lever OFF = legacy fixed radii byte-identically. Lake moisture radius 3 tiles (fixed). Volcanic-soil bDist BFS radius 15 tiles (fixed). CROSS_MAX=6 normalization | **The one code-level backward edge:** imports `T` (tuning), `baseEdgeCost` (peopleSim/transport — tCross deliberately shares the sim's transport cost), `mkRng/hash32` (peopleSim/rng) |
| — ancestry (in pipeline.js) | tElev,tTemp,tMoist,tDiff,tFert,seed,preset | `tAncestry` Int16 lineage id per tile, arrival times, lineage birth/parent trees, relatedness hue wheel | Simulated peopling: Dijkstra wavefront from a cradle (hard-pinned to Lake Turkana on earth presets, computed otherwise), founder + residence-time subdivision. Grid warnings: `ANC_HOP_FREE=4` **tiles** of near-shore free hopping and the per-tile open-ocean exponent scale with grid; separations are fractions of `tw` (scale-free) | consumed by peopleSim (passed via harness/init) |
| **cropGen** `cropGen.js` (87 ln) | per-tile t,m,e,coast,riverMag,bDist (+ optional tGrow,mGrow) | scalar 0..1 `cropSuitability`; `cropSuitabilityPkg(pkg,…)` per crop package | Pure per-tile function; shared `envGate` (arid gate, laterite penalty w/ young-soil discount, elevation, cold-gated alluvial pull) so legacy and package paths can't drift | reads `T.GROW_SEASON` semantics via caller; `cropPackages` imports `T` |
| **cropPackages** `cropPackages.js` (104 ln) | — | `CROP_PACKAGES` (wheat/rice/maize/sorghum/millet/tubers: tOpt/tTol(+tTolEarly)/mOpt/mTol/storability/yield/**domLagY** domestication lag/color), `pkgClimateBell` | data; temperature scale t=0.60+°C/100 shared sim-wide | `domLagY` read by hearth maturity law; storability is the wet-tropics-stateless lever |
| **resourceGen** `resourceGen.js` (488 ln) | tw,th,tElev,tTemp,tMoist,tCoast, world (pixPlate), seed, rivers, tDryFrac, tSummerDry | `deposits`: `{resourceId: Float32Array(N)}` richness 0..1 for 16 resources (each with era tag/color/icon — display metadata only); helpers `tileResourceSummary`, `dominantResource` | Own hash-noise in normalized coords (scales); `scatterMines(density-as-fraction, radius-in-**tiles**, …)` — radii fixed in tiles; plate-boundary BFS ≤12 tiles; biome-keyed rules via the shared classifier | none (sim later downsampled-copies + depletes via its own `depositReserve`) |
| **biomeClass** `biomeClass.js` (224 ln) | e,m,t,dry,sumDry per tile | biome id (17 classes incl. FLOODPLAIN, disabled MEDITERRANEAN); `bioTemp/demand` (Holdridge softplus); `ensureBiome/ensureCanopy(world)` cached per-sim-tile fields | Pure per-tile; calibrated 79.4% vs Koppen over 21,587 points w/ share-matching; "no threshold that names a place". MED branch disabled with a measured reason (solver phase field F1 0.157) and a re-enable criterion | `ensureBiome` reads sim `world.step` for a 2000-step **rebuild cadence** (a refresh interval, not a gate) and `world._dryFrac/_summerDry` carried onto sim world |
| **realClimateData** `realClimateData.js` (309 ln) | `data/global_precip.json`, `global_airtemp.json` (94×192 NCEP grid, 12 months) | `fillRealClimate(W,H,…)` in-place; `provideRealClimateData` Node injection; availability probes | Temperature trivial (t=0.6+°C/100, 6.5 K/km lapse); moisture **quantile-mapped onto the solver's own land distribution** — "no free parameters", pattern from observation, units from the sim (documented failed aridity-index attempt, rank-corr 0.397) | none |
| **realWindData** `realWindData.js` (173 ln) | `data/global_wind.json` monthly NCEP | `fillRealWind(W,H,windX,windY,month,scale=0.008)`, `sampleRealWind`, `provideRealWindData` | bilinear from 12 monthly grids; m/s → internal scale is a derived conversion | none |
| **mapImport** `mapImport.js` (278 ln) | Azgaar Full-JSON / heightmap image | `parseAzgaarJSON` → cell arrays; `rasterizeAzgaar(parsed,W,H)` and `rasterizeHeightmap(imageData,…)` → **generateWorld-shaped object** so buildTerritory consumes directly; `loadImageFile` (browser) | nearest-cell rasterization | none |

### Does anything flow backward from the people-sim?

**No runtime data flows back into worldgen fields.** Verified:
- The sim runs on **downsampled copies** (`createWorld` in `peopleSim/state.js`: `tileRes` default 2, so sim `tw = W/2`; copies elev/temp/moist/fert/relief/tFlood/coast/riverMag/deposits at sim res). Worldgen output is immutable afterward.
- Climate variability (`peopleSim/climate.js`) is a **multiplier layer** `world.climMod` (bounded random-walk index + volcanic shocks, clamped 0.70..1.15) read by the food catchment — it never writes moisture/temp/fert.
- Soil exhaustion is per-settlement (`s._soilFatigue`), deposit depletion is sim-side (`depositReserve`).
- The only **code-level** backward edges: `pipeline.js` imports `T` (for the `RES_INVARIANT_POP` lever), `baseEdgeCost` (deliberate — tCross must equal the sim's transport cost), and `mkRng/hash32` from `peopleSim/rng.js`; `cropPackages.js` imports `T`. A v2 port must carry or cut exactly these four imports.

### Portability verdicts (worldgen)

| Stage | Verdict | Notes |
|---|---|---|
| worldgenUtils | **port verbatim** | mind the module-level PERM (one concurrent world/process); bit-identical contract documented |
| earthData + carveStraits | **port verbatim** | data asset; keep the strait list with the DEM |
| windSolver | **port verbatim** | pure, param-driven, seasonal lever |
| moistureSolver (+terrainShelter) | **port verbatim** | pure; per-degree radii |
| riverGen | **port verbatim** | resolution-invariance is designed in; fix `maxLakeTiles=800` (express as km²) when porting |
| biomeClass | **port verbatim** | single-source classifier; carries own calibration provenance and MED re-enable criterion |
| cropGen / cropPackages | **port verbatim** | pure + data; two `T` levers to re-home |
| realClimateData / realWindData / mapImport | **port verbatim** | loaders are quarantined from the generator by design; keep the `provide*` Node injection pattern |
| generateWorld (preset switch, earth/pangaea/random branches) | **port with cleanup** | monolithic branches; earth_sim's named geographic corrections should be carried as an explicitly labeled "earth-corrections" stage (honest, documented solver-debt patches — but keep them out of procedural presets) |
| tectonicGen | **port with cleanup** | self-contained, but its internal temp/moisture combination duplicates (older) earth_sim logic — unify on the shared solvers to kill the drift risk |
| pipeline buildTerritory | **port with cleanup** | extract the 4 peopleSim imports; keep physical-units floodplain as the default (delete the legacy branch in v2); fixed tile radii (lakes r=3, volcanic bDist≤15) should become km |
| ancestry generator | **port with cleanup** | mechanism is excellent and self-contained; make `ANC_HOP_FREE` and the ocean-depth exponent per-km rather than per-tile; the Earth cradle pin is preset-scoped scenario data (fine) |

Resolution-dependence warnings found in comments, collected: the floodplain-rescale scar (pipeline.js ~line 340), the percentile-river scar (riverGen ~line 48), the coast-proximity-in-degrees scar (worldgen ~line 400), sub-pixel straits (worldgen ~line 59), `maxLakeTiles` (riverGen ~line 604), scatterMines tile radii, ancestry hop constants, smoke's own note that its 320-wide grid is "BELOW the reference".

---

## 2. LANGUAGE SUBSYSTEM

**Files:** `src/sim/language.js` (1065 ln, core), `languagePhonology.js` (570), `languagePhonetics.js` (140, IPA), `languageLexicon.js` (529, concept graph data), `languageGrammar.js` (3443, Greenberg-correlated syntax/inflection), `languageScript.js` (1136, writing systems), `languageChange.js` (164, sound-law rule engine), `languageHistory.js` (151, standalone areal test harness), `languageRefs.js` (251, pinned Mandarin/Russian/English scenario profiles), `vocalTract.js` (589, Kelly–Lochbaum waveguide speech synth, Pink Trombone port).

**What it takes from the sim.** Remarkably little:
- A `world` bag carrying: `world.languages` (Map, lazily created by `languagesOf`), `world._nextLanguageId`, `world.step` (stamped as `bornStep` — a record, not a gate), `world.seed`.
- Lifecycle verbs, driven entirely by `peopleSim/cultures.js` (and one `langWord` import in `faiths.js`):
  - `foundLanguage(world, {seed, parentId})` — on culture creation (each culture carries `langSeed`).
  - `branchLanguage(world, parent, divergence=0.4)` — on culture branching / nation-language split.
  - `driftLanguage(world, lang)` — periodic sound change inside the culture pass.
  - `borrowFrom(world, lang, donor)` — on culture contact (prestige loan strata).
  - `adoptScriptFrom(lang, donor)` (languageScript) — script spread (sim wiring "parked"; used by the Lab/history harness today).
- Contact/population/prestige *state* is supplied by the caller; `languageHistory.js` documents "THE INTEGRATION SEAM": populations replace `pop`, trade/faith adjacency replaces `pos`, "the sim's own events call the same four verbs … nothing else changes."

**What it returns:**
- Names: `langWord(lang,n)`, `langPlaceName/Ex` (meaningful compounds with recoverable glosses), `langRealmName(lang,n,base)`, `langPersonName(lang,n,female)`, `langDynastyName(lang,n,founder)` — the five calls `cultures.js` actually makes.
- Deep API (Lab/UI): virtual dictionary `wordOf(lang, conceptId)`, `glossOf`, `etymologyOf`, `colexPartner`, `colorTermsOf`, `kinshipOf`, `dialectsOf`, `registerOf/highRegister`; scripts via `scriptOf(lang)` (type walked down a logo→syllabary/abjad→alphabet transmission ladder by re-learning junctures, "never wall-clock"), `writeWord/writeName/glyphInventory/numeralGlyphs` (procedural glyphs shaped by writing medium), orthographic-lag/silent-letter machinery; audio via `vocalTract.scorePlan/renderScore` (offline PCM).

**Persistence contract:** a language record persists **only seeds + history** (seed, famSeed, parentId/rootId, gen, hue, `prof` dial bundle, `rules` sound-change log, `loans`, `xph`, script tradition). Inventory, syllabary, romanization, the entire vocabulary and grammar paradigms are derived on demand and cached in WeakMaps — "save/load round-trips byte-identical names by construction." Cognates are real: sisters differ by replayed regular correspondences.

**Self-containment:** the whole cluster imports exactly one thing from outside itself: `mkRng/hash32` from `peopleSim/rng.js`. No terrain, no entities, no tuning. `vocalTract` is "pure, dependency-free, JSON-safe". `languageRefs` pins real-language *shapes* as scenario data (explicitly permitted, like Earth hearths).

**Verdict: port verbatim.** Swap the rng import; hand it a `{languages: Map, _nextLanguageId, step, seed}` bag and drive the four verbs from v2's culture/contact events. The areal harness (`languageHistory`) doubles as its acceptance test. (The 122KB `src/langLab.js` is a separate lab build — tooling, not sim.)

---

## 3. HERALDRY / EMBLEMS

Two engines plus art data:

**A. Emblem genome engine** — `src/sim/emblemGenome.js` (107KB) + `src/sim/emblemRender.js` (64KB) + `heraldryChargesDetailed.js` (5.1MB generated charge art, do-not-hand-edit).
- Genome = 26 named genes, each 0..1 (`GENES` order is the crossover backbone). API: `foundGenome(seed, axes)`, `mutateGenome`, `inheritGenome` (succession drift), `crossGenome` (marshalling as genetic crossover), `expressGenome` (genotype→phenotype), `emblemSVG(genome,W,H)` / `drawEmblem(...)` → SVG strings, `blazonGenome`, `describeGenome`, `genomeDistance`, `sigilFromSeed` (procedural sacred sigils for faiths).
- Inputs from the world are **axes only** — 8 abstract visual axes (figuration/ornateness/boldness/saturation/symmetry/tone/hue/format) plus semantic axes read from *emergent state* (maritime, sylvan, arid, montane, regal, martial, austere, mercantile, devout, pastoral, imperial, tribal). All are **soft window shifts**; comment: "no 'nomads get a tamga', no cultural stereotype baked into the seed… every pattern stays reachable by every realm." Pure + deterministic (mulberry32, no Math.random); zero sim imports.
- Sim coupling today is render-side only: `src/ui/emblems.jsx` derives axes from the realm mirror (capital tile elevation/moisture from `ter`, port share, personality vector, member count), **quantizes** them to quarter steps for stability, caches genome+SVG per realm per session. The evolutionary layer (persisted genome on the polity, cadency on succession, marshalling on union — "engine support already exists") is designed but unwired.

**B. Armorial grammar** — `src/sim/heraldry.js` (20KB) + `heraldryCharges.js` (106KB CC-BY game-icons.net silhouettes; see CREDITS-heraldry.md).
- `armsForCountry(world, c)` → arms record; `blazon(arms)` → text; `TINCTURES/tinctureRGB`. Reads world entities directly: `personalityOf`, faiths (the state faith's holy device is a real anchor), cultures (`familyOf` — stock-level aesthetic tradition), dynasties (lineage differencing), `entityRng`. Explicit design doctrine in the header: arms are mostly abstract; meaning lives in **lineage, marshalling, and two anchors** (faith device + canting on the realm's own name via the language system); the old "maritime → ship" semantic map is called out as a second-cardinal-rule violation and removed.

**Verdicts:** genome+render engine **port verbatim** (with the two art data files and CC-BY attribution; `tools/emblem.test.mjs` is its ready-made property suite). `heraldry.js` **port with cleanup** — sound design, but its inputs are v1 entity-API calls that must be re-bound to v2's registries.

---

## 4. THE HARNESS — complete gate catalog

### npm wiring (`package.json`)
- `test` = smoke.mjs + emblem.test.mjs + test_market_pay + test_grain_spoil + test_settlement_trace + test_food_bridge
- `validate` = stylized.mjs · `resgate` · `coverage` · `spread` · `monotone` = `trace.mjs --monotone --steps=12000 --every=1000` · `observe` · `abtest` · `bisect` · `trace` · `why` · `livegate` · `fooddiag`

### `tools/_harness.mjs` — what it pins (88 ln)
- Thin veneer over `src/sim/pipeline.js`: `buildWorld(opts)` → `{w, tw, th, ter, rivers, tCrop, deposits}`; `buildSim(opts)` → running people-sim.
- **Provenance stamp**: prints `[harness] tree <git short-hash>` once per process — added after the container silently reset its checkout three times in one day and stale-tree probe output was nearly published.
- **`SIM_TUNE` env** ("K=V,K=V") parsed into `SIM_TUNE_OVERRIDES`, exported so snapshot loaders can re-apply after `loadWorld` (persist restores the save's tuning and would clobber pre-load levers).
- **`applyToolTuning()` pins** (run at import): `POP_FIELD_WORKERS: -1` (auto pool; app stays 0 pending COOP/COEP) and the gate regime — `DAWN_LIVE:0, STATE_RECORDS:0, LAND_KNOW:0, PEER_SEATS:0, FOUND_DRIFT:0, ABSORB_ORG_ERA:0, TRIBUTE_UP:0, ENGULF:0, FEAR_REACH:0, WAR_FINISH:0, SMALL_WAR:0, RELIEF_REACH:0, EXCH_WAVE:0, TECH_USE:0, VASSAL_LEVY:0, DISSOLVE_CORE:0, SETT_STRIDE:1, TRADE_STRIDE:3`, with `...SIM_TUNE_OVERRIDES` spread last. Rationale: the standing gates measure **mature-regime facts at fixed horizons** (seeded dawn); the shipped app runs the live dawn — hence livegate. The full live arm is named in-file: `SIM_TUNE="DAWN_LIVE=1,STATE_RECORDS=1,LAND_KNOW=1,PEER_SEATS=1,WAR_FINISH=1"`.
- **Reference grids:** harness "W" is worldgen pixel width; sim grid is `tw = W / tileRes` with tileRes defaulting to 2. Gates run W=480 → sim tw=240; resgate app arm W=960 → tw=480; the app ships W=1920, simDiv 2 → tw=960.

### `tools/smoke.mjs` — `npm test` (W=320×160, seed 4242, preset earth_sim; DET=600, RUN=4000 steps). **All checks hard** (any failure → exit 1):

| # | Check | Threshold |
|---|---|---|
| 1 | elevation finite | 0 non-finite |
| 2 | climate in range | t∈[−0.5,1.5], m∈[0,1.001], 0 bad |
| 3 | land fraction sane | 0.15 < land/N < 0.55 |
| 4 | good cropland exists | tCrop>0.4 on >1% of tiles |
| 5 | rivers formed | ≥50 tiles with riverMag≥2 |
| 6 | deposits placed | >30 iron/copper/timber tiles |
| 7 | cradles distinct & separated | ≥2 seats, min pairwise gap ≥3 tiles |
| 8 | determinism (600 steps ×2) | `hashWorld` identical AND stats JSON identical (minus tickMs) |
| 9 | invariant run (4000 steps, `_checkInvariants`) | 0 invariant hits; ≥3 settlements; pop grew; wealth finite ≥0 |
| 10 | identity field mirror (3000 steps) | ≥80 owned tiles audited; 0 culture/faith/language mismatches |
| 11 | identity counties | double-diffuse byte-identical; shares sum 255±1, share-ordered; 0 covered tiles outside any realm; town cores ≥85% anchored OR ≤1 off |
| 12 | save/load (1500 steps) | load hash == save hash; save <30MB; resume 0 invariant hits; **continuation** after +1000 steps: pop drift <10%, wealth <25%, |Δsettlements|≤3, |Δcountries|≤3, |ΔlandPct|<3pp — with a documented one-retry-at-seed+1 rule: systematic drift (both seeds) fails; a lone butterfly passes and is recorded |
| 13 | DISSOLVE_FARMS arm (3000 steps, both models) | dissolve deterministic; no tier-0 farming regions on legacy ladder; 0 invariant hits; ≥3 settlements & pop>500; **entities-per-person < legacy model's** (granularity guarantee, measured not snapshotted) |

Plus in `npm test`: `emblem.test.mjs` (rule-of-tincture with OKLab ΔE floor, art coverage of every motif id, determinism of express/mutate/inherit/cross, marshalling ≤4 deduped quarters, tincture/blazon reachability), and unit tests for farm-gate offers (hunger is demand not cash), climate-scaled grain spoilage, settlement trace, food bridge (granary counts toward famine gate).

### `tools/stylized.mjs` — `npm run validate` (seed 8817, **24000 steps** (re-baselined 15k→21k→24k as the emergent chronology repaced — matched *urban age*, not wall-clock), W=480; 30 sampled windows). Soft unless marked HARD; **soft budget = 2** (a 3rd soft warning exits 1). Multi-seed: `STYLIZED_SEEDS="8817,4242,777"` runs children, fails on majority. `STYLIZED_DUMP=1` prints underlying distributions.

| # | Gate | Pass condition | Notes/abstentions |
|---|---|---|---|
| 1 | **Zipf rank-size** (urban cores > TIER_CORE[2]=10k, Gabaix–Ibragimov log(rank−½) fit, n≤80, needs ≥15) | −1.35 < slope < −0.45 | mature envelope −0.8..−1.2; earned-span antiquity shallower (owner-accepted). <15 cities: n/a passes if register ≥8, warns below |
| 2 | **Empire land share** (needs ≥5 landed polities) | largest/claimed ∈ [4%, 55%] | measured on `_countryOwner` land tiles |
| 2 | **Empire area tail** | largest/median ≥ 3 | |
| 2 | realm ABSOLUTE area | *printed unscored* (largest/median k km² + Bronze ~0.5–1M / Rome ~5M / Han ~6.5M reference) | era-dependent bar needs per-era derivation; printing = seen |
| 2b | **Empire mortality** | *printed unscored* (back-half top-3 union, secession count) | deliberate: measured that no scalar bar separates frozen-leaderboard worlds at this horizon without outcome-fitting; deep instrument = probe_empires.mjs |
| 3 | **State lifespan median** (lives rebuilt from the append-only event log; restoration counts one completed fall; living realms right-censored; needs ≥5 fallen) | median(all lives) ∈ [50y, 2000y] at 0.25 y/step | fallen-only median + revolt-churn mode printed unscored. <5 fallen: n/a passes if ≥1 fallen, warns at 0 |
| 3 | **Lifespan heavy tail** | max(incl. oldest living)/median ≥ 3, scored only when run/median ≥ 3 | else n/a "horizon-censored" |
| 4 | **War rate** | wars per 1000 steps per polity ∈ (0.05, 20) | normalized by state count |
| 4 | **Wars amid succession crises** | crisis share > 2% (or 0 wars) | faith-clash count printed |
| 5 | **Tech ~ cradle-distance** (cradles = the dawn cohort; needs >20 settlements) | Pearson r < 0.2 (flags only an *inverted* gradient) | n/a passes if ≥1 root culture exists |
| 6 | **Urbanization vs development** | agrarian (leading era<5): 2–25%; industrial (era≥5): 10–80% | urban = Σ`_urbanPop`; band conditioned on world state, never step count |
| 7 | **Population ~ development** | Pearson(log pop, leadAgri over 30 windows) > 0.7 | |
| 7 | **Growth accelerates with development** | mean(top-third growth) ≥ 0.8×mean(bottom-third) — scored **only if** modern agriculture was actually discovered | else n/a "chapter absent, not off-shape" |
| 8 | **Price level bounded** | people-weighted raw M/T÷baseline (`_inflRaw`, uncapped — the clamped `_inflP` would make the gate untrippable) ∈ [0.35, 8] | pegged-component count printed |
| 8 | **Market integration narrows prices (Δ)** | over knit windows (component-count drops), mean dispersion Δ ≤ series' own noise floor (median |Δ| — self-normalizing, no fitted constant) | population-weighted dispersion; n/a if no knit window/baseline unlocked |
| 9 | **Trade intensity vs transport** | flow×1000/wealth ∈ [2,400] if median nav+mob ≥0.8, else [0.05,150] | |
| 10 | **War deadliness tail** (Richardson; needs ≥8 reckoned wars) | largest/median dead ≥ 5 | greatest-war share printed unscored |
| 11 | **Culture count ~ area^k** (needs ≥8 growth samples) | 0 < k < 1.05 | temporal-accumulation proxy caveat recorded |
| 12 | **Settlements cluster on water** (needs ≥25) | same-footprint enrichment ≥ 1.15 (3×3 detector in numerator AND null) | measured 1.36–1.37 canon; NN-CV instrument retired for chasing the mechanics |
| 12b | **Fish share of food supply** | ≤ 40% (Tier-B band) | exists because fish share regressed 6%→84–92% with every other gate green |
| 13 | **Continuity — HARD** | ≥20 settlements AND pop>500; wealth finite ≥0; ≥3 polities | the only hard gates |

### `tools/resgate.mjs` — `npm run resgate` (6000 steps, seed 8817; **ref W=480/tw=240 vs app arm W=960/tw=480**; km² = 510e6×0.29/landTiles). A **ratchet on a recorded gap** (~1.3–2.2× 1-D coast/river capacity dilution), "never a target to tune toward — if a change improves them, re-baseline downward and say so". Current floors (each `got ≥ floor`, else fail):

| Band | Floor | Duty |
|---|---|---|
| app/ref **median** realm area | **0.34** | deep uniform-collapse floor (median is rank-cliffy at n=4–8 — a fresh seed failed the old 0.58 floor at baseline) |
| app/ref **mean** realm area (claimed÷count) | **0.46** | the SUCCESSOR_STATES catcher (its signature — claims flat, realm count exploding — craters the mean to ~0.25) |
| app/ref claimed-land % | **0.53** | tightened 2026-08-19 (0.75×worst-of-six-seeds 0.71) |
| app/ref people per km² | **0.50** | |
| app median realm **absolute** | **60,000 km²** | collapse-catch: `deffdce` shipped 27k |
| app realm count | **≥3** | "a real map, not two dots" |

Derivation discipline recorded in-file: floors = 0.75 × worst seed over six declared seeds (8817, 31337, 777, 101, 555, 999), derived blind to pending levers; the twice-learned lesson "ratchet tightenings must not be derived and shipped in the same wave as regime changes" is written down, as are the three failure cases the gate was built on.

### `tools/coverage.mjs` — `npm run coverage` (W=480, 4000 steps). The perturbation-reachability idea:
- **Why not name-matching:** a name-matching check is a replicated gate that drifts. Instead: (1) **Proxy** — run the real `collect()` against a Proxy recording every property read; (2) **Perturbation** — for every numeric leaf (scalar, tile array at a **land** index — tile 0 is ocean and probing it produced 83 false alarms —, typed array, depth-≤4 object leaf), nudge it (×1.7+13.7), re-collect, and require **some** metric to move.
- **Self-test first:** injects a depth-2 nested numeric canary that the collector provably cannot reach and requires the detector to flag it (exit 2 otherwise — "a coverage tool that cannot fail … certifies blindness").
- **Verdict:** DARK = carries numbers, not named in `WORLD_SCRATCH` (imported from the collector, never copied), and never read / provably reaches no metric → exit 1 with a per-property explanation. Structural identity keys skipped.
- **Entity residue:** any object collection not in `MEASURED_CLASSES` and not justified in the in-file `ENTITY_ACCEPTED` map (each with a reason) → exit 1. Both lists **fail open**.

### `tools/trace.mjs --monotone` — `npm run monotone` (12000 steps, checkpoint every 1000):
- **BY NAME (hard, exit 1):** any metric whose name claims a cumulative history — `event.*`, `*.bornEver/endedEver/restoredEver/diedThenRestored`, `world._next*Id` — that decreases, except `event.*` drops at recognized event-log prune checkpoints (detected by `count.events` shrinking at the same checkpoint, not guessed).
- **BY SHAPE (warn only):** integer metrics that rose above their starting value then fell back to ≤ it — the reset signature (`life.polity.died` ran 0,0,1,0). The file records two failed earlier designs (998 flags, then 632) and why peak-tracking + integer-only is the right filter.
- Trace's general instruments (same file): per-metric SWING/DIR/PEAK@/SETTLE, `--unstable` thrash ranking, per-realm **ARCS** (peakFraction = final/peak area, rise/fall steps — "did THIS realm peak and decline?"), arc-coverage self-diagnosis vs `life.polity.known`, events-by-window, full CSV export (~1,570 columns) and per-entity CSV.

### `tools/livegate.mjs` — `npm run livegate` (seed 8817, **32000 steps, W=960**):
- Exists because the pinned gate world and the shipped world differ by ~25× in political register (20 vs 541 realms at tw=480/32k) — "a green stylized battery is evidence about the GATE world, and the gate world is not the game."
- Derives the live arm **from code, never a copied string**: snapshot `tuningDefaults()` before importing the harness, diff against the harness-mutated `T`, run stylized.mjs in a child with `SIM_TUNE=` that diff (caller SIM_TUNE appended last).
- **Arming check on the gate itself**: the child must echo `[SIM_TUNE] {...}` carrying every diverged lever, else exit 2 ("whatever it printed above is about some other world. Not a result."). Horizon 32k because the live dawn's first ~23k steps are Neolithic by design; grid W=960 because tw=240 is the regime where CORE_LOCAL/SUCCESSOR_STATES measure nothing.

### Companions worth adopting
- `tools/spread.mjs` — same collect() across N seeds; per-metric median+spread+"is a one-seed reading safe" verdict; includes telemetry funnels because funnel zeros are the easiest finding to over-read.
- `tools/observe.mjs` — the human dashboard over the same introspection; prints the real-people figure first; self-maintaining (no hardcoded field list); its `SCRATCH` set is fail-open.
- `tools/abtest.mjs` / `bisect.mjs` / `why.mjs` — A/B (multi-seed by default, with a non-experiment detector: both arms identical ⇒ dead switch), bisection, causal drill — all reading the one collector.

---

## 5. METRIC MAP — `tools/lib/simmetrics.mjs` `collect()`

One collector, every consumer (observe/trace/spread/abtest/bisect/coverage). Flat map metricName→number, built by **introspection** so a diff of two collects is a complete answer to "what did this change move".

**Namespaces:**

| Prefix | Content |
|---|---|
| `run.*` | step, landTiles, km2PerTile |
| `realm.*` | count, claimedPct, claimedKm2, areaKm2.{n,p50,p90,max,mean,sum} |
| `entity.settled/stateless` | register sizes |
| `pop.*` | **`pop.people`** (census × POP_SCALE — THE quotable number), perKm2, largestCity, urbanPeople; deliberately unit-named traps: `censusSimUnits`, `fieldUnits`, `fieldPerKm2Units`, `bridge` (=`_onePopScale`) |
| `urban.*` | coreBlockRanPct / coreLocalBindPct / coreDiskBoundPct — **arming checks**: facts about the measurement (did the edited block execute; did the mechanism bind), added after two "no effect" verdicts that were really wrong-regime runs |
| `landKnow.*` | pre-urban land-ledger gauges |
| `field.<name>.*` | every typed array of length N, distributed over **land**; other typed arrays → `vec.<name>` |
| `world.<scalar>`, `world.<bag>.<leaf>` | all 61+ numeric world scalars (incl. every self-calibration reference scale) and depth-1 bags; tile fields hiding in bags surface as `field.deposits.<res>` |
| `sett.* / nation.* / polity.*` | every numeric leaf on entities, **depth 2**, paths unioned across the population; fixed-schema vectors detected **from the data** and index-named via VEC_NAMES (goods `_gPrice.metal`, 108 money channels); Maps/Sets → `.size`, arrays → `.len`; entity refs never recursed |
| `culture.* / lang.* / faith.* / dynasty.* / person.*` | same over the peoples registries (was 36.5% of entity state, dark) |
| `hearth.armedNow`+`hearthArmed.*`, `nation.landSeatsNow`+`landSeat.*`, `hearth.devSourcesNow`+`hearthSeed.*` | dawn registries, gauge-named ("Now") |
| `eventv.<kind>.<field>.*` | event payload magnitudes; identifier fields excluded **by name** (fail-open) |
| `shape.*` / `drawn.*` | realm geometry on the **authoritative** `_countryOwner` AND on `_ctrlOwner` — the map the player actually sees (they disagree on ~2% of land; measuring only the authoritative one "means measuring a map no player ever looks at"); `drawn.claimedPct/disagreePct` |
| `graph.*` | network **topology**: `vassal.*` (bonds, suzerains, depthMax/Mean, blocMaxRealms/**blocLandPct**), `alliance.*`, `trade.*` (incl. top10FlowPct), `realmnet.*` components, `road.*` components, `liege.*` |
| `life.<class>.*` | lifecycle for polity/faith/dynasty/culture/lang/person: `known`, `endedNow`, `alive`, `turnoverPct`, `lifespan.*`, `age.*`, `survival{1,4,16}k` (right-censored: horizons with no eligible entities emit **no metric**, never a fake 0%), `endedEver`/`restoredEver`/`diedThenRestored` (from the event log), `bornEver` (from `_next*Id` monotone counters), `retainedPct` |
| `count.<collection>` / `event.<kind>` / `debug.<counter>` | sizes, chronicle histogram, debug numbers |

**Conventions to carry into v2 wholesale:**
1. **`.n` on every distribution** — a p50 over 3 reads like a p50 over 5000 (the 15.7× dynasty-lifespan "finding" rested on n=3 vs 6).
2. **Fail-open exclusion lists everywhere** — `WORLD_SCRATCH` (exported from the collector so coverage can't fork it), observe's `SCRATCH`, `EVENT_IDS`, `ENTITY_ACCEPTED`, `VEC_NAMES`. New state is measured by default; exclusions are named with reasons.
3. **Name-vs-measurement discipline** — a metric's name is a claim the metric must be able to keep: `endedNow` (state) vs `endedEver` (history), `known` vs `bornEver`. Backed by `npm run monotone`.
4. **Unit discipline** — `POP_SCALE` lives in `src/sim/units.js` imported by both UI and collector; sim-unit metrics are named for their units.
5. **`provenance(world)`** on every instrument: git commit + src-dirty flag + seed/grid/step/year + `leverDiff()` (levers ≠ shipped defaults) — every output is self-identifying.
6. **Shared per-entity view** — `realmRows()` (incl. strain/capacity/works/momentum — "strain is the mechanism, area is the symptom") and `shapeOf()` live in the library because "two private definitions of 'a realm's size' would drift."
7. **Measure both the authoritative and the drawn map.**

---

## 6. UI SHELL

**`src/App.jsx` / `src/main.jsx`** — trivial: mount `<WorldSim/>` with `atlasUI.css`.

**`src/WorldSim.jsx`** (340KB, ~7.6k lines) — the monolith, mid-dissolution into `src/ui/*`. Responsibilities: world generation orchestration (posts to `worldGenWorker`, main-thread fallback for imported maps and the real-wind path, injected as `REAL_FNS`); the people-sim worker lifecycle and snapshot mirror (`psw`); the canvas map with a **lens system** (`LENSES` table: Terrain/Atlas · Politics Realms/Loyalty · Peoples/Population/Ancestry · Tongues · Faiths · Economy Trade/Money/Coin-field/Goods/Prices/Labour/Resources/Cropland/Technique · dev-only lenses), with **emergent lens availability** (`subLockReason` — a lens lights when its phenomenon first exists, "state-gated, never time-gated"); flat-equirect (1920×960) and Mercator (max-lat 78°) projections with static-view offscreen caching; realm/settlement labels; hover cards and the selected-settlement card; save/load; tuning panels; a country editor (drops a fully formed realm then runs a 640-step settling burst); timeline scrubber (`timelineStore` frames); GlobeView embed. Per-pixel biome render calls the same `classifyBiome`.

**Worker feed** (`src/peopleSimWorker.js`, 72KB): sim steps continuously off-thread; posts a **render snapshot ~30×/s** (throttled when hidden/fast). Snapshot payload: step, stats, grid ids; per-tile layers as pooled transferable typed arrays — `owner`, `roadQuality`, `roadFlow`, `tileComp`, `moneyFlows`, `goodsFlows`, `countryClaim`, `landNations`, war pairs + border arrows, identity-field dom/sec layers, loyalty heat + remembered nation, view-gated Uint8 heatfields with absolute rulers (`popDens`+`popMax`, `devDens`, `tileCoinDens`); `settlements` as lean packed records (pos/people/urban/rural/tier/country/culture/faith/lang/ancestry + ≥20% secondary ids for checkerboarding, wealth, port, army, shock/besieged/sacked, coerced-labour scalar, goods prices); `countries` (ids + personality); **static-cadence extras every 6th snapshot** (sea lanes, culture/faith/language rosters); `ships`; full `packSelected` detail for the one selected settlement; chronicle, dynasty, incremental event feed. Messages in: init/control/select/view/tune/settTrace/save/load/editor-place/timeline/history-export. Two hardening patterns worth keeping: snapshot exceptions are caught and throttled so a render bug can never tear down the sim ("the map holds the last good frame… save/export can rescue the world"), and zero-copy transferables with a pooled-buffer + `version` counter idiom.

**`src/GlobeView.jsx`** — three.js sphere fed by the same shared `terrainBuf` via CanvasTexture keyed on a version counter (no 25MB/frame allocation), nearest-filtered for the pixel look, ocean specular map, atmosphere shader, drag-rotate. Cleanly separable.

**`src/ui/`** — the extracted modules: `bits.jsx` (units/formatters — re-exports `src/sim/units.js`), `documents.jsx` (tech tree/chronicle/dynasty full-screens, pure over snapshot data), `emblems.jsx` (genome cache + axesFor), `events.jsx` (category/severity metadata — "severity derives from the event TYPE… never from the clock", bell, toasts), `labels.js` (realm anchors from the claim grid, cached per new grid; screen-space draw with LOD + collision), `legends.jsx` (per-lens legend **as data** — "teaches the MECHANISM… never gates or drives anything"), `surfaces.js` (single ordered surface stack: popovers exclusive, drawers exclusive, documents stack, Esc pops top, z from stack position).

**Atlas design system** (`src/atlasUI.css`): a two-surface doctrine — **CHROME** (the dark table: player controls, quiet/translucent) vs **PAPER** (the parchment: world content, warm) — with `--au-*` tokens (paper/ink/wax-red/verdigris/gold palettes, chrome bg/line/text tiers), self-hosted latin-subset fonts (no runtime fetch in the single-file build), a type scale with an 11px interactive floor, and an `au-` class prefix to avoid collisions.

**What transfers to a game shell:** the worker protocol (snapshot mirror + transferables + static cadence + error containment), the lens/legend/emergent-availability pattern, the surface stack, the labels collision system, the emblem cache, the two-surface design language and tokens, GlobeView, and the units module. WorldSim.jsx itself is the thing v2 replaces — its extracted `ui/` modules and the worker are the salvage.

---

### Cross-cutting facts v2 should not lose
- **The three population scales** (`s.people` sim-units catchment / `popField` / `_onePopScale` bridge) and the catchment-vs-urban-core distinction are enforced at the metric layer by unit-named metrics — carry that enforcement, not just the doc.
- **Determinism infrastructure** is what makes every gate cheap: per-system RNG streams (`passRng`/`entityRng`, "no shared world.rng"), `hashWorld`, derive-don't-persist (languages, grammar, emblems, scripts), append-only event log with a visible prune.
- **The gate regime vs live regime split** is a first-class design decision with a named cost and a named mitigation (livegate + the full live-arm SIM_TUNE string); v2 should either avoid harness pins or ship livegate from day one.
- Reference grids to preserve in the suite: gates at sim tw=240 (W=480), cross-grid arm tw=480 (W=960), shipped tw=960 (W=1920 simDiv 2), with resgate's charter (ratchet, re-baseline downward on improvement, never derive floors in the same wave as a regime change).

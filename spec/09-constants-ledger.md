# 09 — The constants ledger  `[FULL DETAIL — living table]`

The mechanism-budget enforcement point (R9). **Every free constant in the
v2 sim has a row here, added the same day the constant is written.** A row
has: name, value, unit, the mechanism it belongs to, and its grounding
(citation or derivation). Budget target: order 100 rows for all of Phase 1.
Confessed calibrations are allowed but must say so in the grounding column
and carry a `[CALIBRATED]` tag — R2 governs whether they may exist at all.

Rows below are the seed set, inherited from v1's audited registry
(research/03 §1 — the ~85 grounded survivors of 430 levers). Values marked
`[REDERIVE]` must be re-derived in v2's units before use, not copied.

## Units

| Constant | Value | Notes |
|---|---|---|
| POP_SCALE | 1 sim-person = 1,000 people | display bridge only; sim runs in real persons |
| FOOD_UNIT | 1 t grain | |
| RATION | ~1 t/person/year equivalent (v1: 0.003 u/tick·su) `[REDERIVE at v2 tick]` | subsistence flow |
| TICK | `[DERIVE]` (v1: 0.25 y) | one tick's span in years |
| HASH_OFFSET_BASIS / HASH_PRIME | 2166136261 / 16777619 | world identity hash: 32-bit FNV-1a over 32-bit words, two lanes (the second seeded with HASH_LANE_SEED 1013904223, the Numerical Recipes LCG increment), 16 hex digits. Replaced the byte-wise 64-bit BigInt FNV-1a (5.5 s per target hash) on 2026-09-03; identity strings before that date are not comparable |

## Travel & freight (03)

| Constant | Value | Grounding |
|---|---|---|
| HAUL_LAND_KM | 340 km e-fold | Diocletian's Price Edict; `[CONTESTED — Scheidel 2013]` |
| FREIGHT_RATIO | sea:river:land ≈ 1:5:28 | Duncan-Jones |
| WATER_HAUL_MULT | ×12 vs land | the Edict's ratio |
| FOOT_DAY / RIDE_DAY | ~25 km / ~35 km | standard literature |
| PORTER_FLOOR | ~⅓ of animal logistics radius | tlameme/Maya porterage |
| SEA_ICE_LATS | onset 60°, saturation 72° | real trade-lane extents |

## People (04)

| Constant | Value | Grounding |
|---|---|---|
| R_GROWTH | ~0.28 %/yr intrinsic | pre-modern recovery band 0.2–0.6 %/yr |
| GROWTH_REGIME | forager ×0.35 → advanced ×1.65 | Neolithic differential increase |
| MIGRATE_D | `[REDERIVE]` (v1 measured) | real pre-modern mobility |
| URBAN_GRAVEYARD_γ | 0.5 | urban excess-mortality literature (de Vries; contested per Sharlin — recorded) |
| URBAN_RATE | ~0.13 of regional capacity | 5–15 % agrarian urbanization band |
| TROPICAL_DISEASE / TSETSE | 0.6 / 0.85 cuts | disease-belt geography |
| COMMUNITY_BAR / TOWN / CITY / METRO | `[DERIVE]` (v1: cores 2k/10k/40k people) | settlement-size literature; labels derived, capability-free |

## Food & land (04)

| Constant | Value | Grounding |
|---|---|---|
| WAVE_KMPY | 1.0 km/yr | Neolithic wave of advance |
| HEARTH_SPAN_Y | ~6,500 yr invention span | real origins spread |
| LEAN_Z | 2.33 (the century year) | founding margin law, v1-validated |
| HARVEST_ρ / CELL | AR(1) 0.30 / ~12° | v1-validated vs 11/12 regions |
| SPOIL_BASE / CLIMATE | ~1 %/yr; hot-wet ×2.5, hot-dry ×0.5 | storage literature |
| YIELD_ARC | 3–6× Neolithic→classical | agronomy anchors |
| WORKS_MULT | ≤2 (irrigation premium) | improved-vs-rainfed literature |
| MIXED_FARM | ~2× with animals | manure+traction literature |
| ALLUVIUM / IRRIG | 2.0 / 1.5 lifts | floodplain agronomy |
| GRANARY_NORM | 2–4× subsistence minimum | granary literature |
| CROP_PACKAGES | per-package tOpt/mOpt/storability/domLag | archaeobotany (port verbatim) |
| FISH_PER_CAP | ~1.5–2.5 t/yr per fisher on virgin rich water | historical inshore fisheries (v1 re-anchored value) |
| FISH_MSY | ~4,000 people per ~167 km of richest coast | Lofoten/North-Sea scale |
| FISH_REGEN | r ≈ 0.3–0.5 /yr logistic | surplus-production literature (C = 4·MSY/r — one fishery, not two dials) |

## Power (05) — mostly `[DERIVE]` against tables

| Constant | Value | Grounding |
|---|---|---|
| EXTRACT_BAND | ~0.10 floor, ~0.20 strong | harvest-tax literature |
| VIOLENCE_SHARE | 1–2 % of population | standard estimates |
| TRIBUTE_UP | ~⅓ remitted upward | bala/Achaemenid levies |
| REACH_GROUND | 50–150 km zero-tech court | pre-road administration |
| FORCE_DECAY | exponential over supply-days | v1-validated form |
| CAGE_KNEE | pressure 0 while ≳20 % basin free | Carneiro; v1-measured ladder |
| BIND_DENS | 3–12 people/km² over imperial extent | Achaemenid/Han/Rome densities |
| MARCH_MULT | ≤2–3× people-funded extent at full logistics | Russia/Qing anchor |
| SUBMIT_ODDS | ~5× hopeless-odds bar | v1-validated |
| GRIEF_HALFLIFE | ~120 yr (~2 generations) | reconciliation timescales |
| MIL_REVOLUTIONS | ~1.5–2.5× per armament revolution, compounding | battlefield-dominance literature |
| COLLAPSE_SCAR | loss ∝ palace-dependence | Late Bronze reference |
| INSTITUTION_CATALOG | conditions/magnitudes `[DERIVE vs Seshat]` | 05.5 |

## Money & goods (06)

| Constant | Value | Grounding |
|---|---|---|
| SEIGNIORAGE | 0.05 | minting practice |
| COIN_SINK | `[CALIBRATED]` wear/hoard drain | honest sink; value re-derived |
| CREDIT_MULT | ≤2 reserve ceiling | early banking |
| HUME_ε | 0.5 | price-specie-flow |
| FREIGHT_BY_DENSITY | ore 3×, materials 2.5×, cloth 0.5×, luxury 1/15 | value-density freight |
| COERCED_CORE | 30–40 % in conquest cores | Rome literature |

## Worldgen (03; ported registry)

The grounded subset of v1's 75 worldgen params carries with its own
provenance (Hadley latitude 28°, Coriolis, drag ratios, lapse rate,
recycling fraction — research/03 §1.8). Ungrounded shape dials stay in the
worldgen param registry, outside this ledger, because they define the
*procedural* presets, not the Phase-1 Earth.

## Later-chapter seeds (11–16) — all `[DERIVE]` unless noted

| Constant | Value | Grounding |
|---|---|---|
| TECH_COMPLEXITY per catalog entry | `[DERIVE]` | Henrich population-complexity relation (11) |
| PASTURE_REGROWTH / HERD_CONVERT | `[DERIVE]` | rangeland ecology (15) |
| DANGER_PREMIUM scale | `[DERIVE]` | caravan-guard/insurance cost shares (03/12d) |
| POOL_GROWTH (density×livestock×connectivity) | `[DERIVE]` | epidemiological transition literature (16) |
| PERSIST_HOSTS | ~¼–½ M connected hosts (crowd class) | measles epidemiology (16) |
| OUTBREAK_SPEED | overland km/day band | Black Death mapping (16) |
| CONFED_CASCADE | hazard ∝ adjacent extortable wealth | Barfield-pattern (15) `[CALIBRATED shape]` |
| DOMAR_LAW | binding demand ∝ land abundance × labor scarcity × coercive capacity | Domar hypothesis (06.4) |
| DEBT_BOND / MANUMIT rates | `[DERIVE]` | debt-crisis and freedman literature (06.4) |
| VALUE_EMA | generational lag on culture value vectors | path-dependence literature (07.6) `[DERIVE]` |

## Representation thresholds (18.3 — NOT world constants)

Bookkeeping numbers, each carrying a tested invariance band instead of a
citation: the community condensation bar, the center salience bar,
authority top-K (4), identity top-K (4), catalog granularities, grid
resolution. A threshold whose perturbation changes macro-history is a bug
(the representation-invariance gate, 08).

## Rules

1. No constant outside this file. CI greps for numeric literals in
   mechanism code lacking a ledger reference `[M0 tooling]`.
2. `[CALIBRATED]` rows are reviewed at every milestone gate: each must
   either gain a grounding or be dissolved into a mechanism (R2).
3. Paired constants that must move together are one row with both values.
4. A row's value changes only with a measurement attached.

## M1 — proposed (review pending)

These rows are introduced by the M1 substrate and travel harness. They are
implementation parameters with the unit or grounding needed to review them;
they are not hidden outcome-fitting levers.

| Constant | Value | Unit / grounding |
|---|---:|---|
| `TARGET_GRID_WIDTH / HEIGHT` | 1800 / 900 | simulation cells; ~22 km equatorial target convention from M1 handoff |
| `MONTHS_PER_YEAR` | 12 | calendar/climate cycle |
| `EARTH_CIRCUMFERENCE_KM / MERIDIONAL_KM` | 40,075 / 20,004 | spherical Earth geodesy |
| `DEG_TO_RAD` | π/180 | coordinate conversion |
| `FOOT_DAY / RIDE_DAY` | 25 / 35 | km/day; standard travel anchors |
| `CART / RIVER / COASTAL / OPEN-SEA SPEED` | 30 / 45 / 80 / 120 | km/day; mode anchors pending ORBIS calibration |
| `COASTAL_BAND_KM` | 150 | km; coastal-mode shoreline band |
| `RIVER_MIN_MAGNITUDE` | 2 | river classification bar from the ported hydrology; navigability is binary at M1 (a per-magnitude speed discount was removed in review — no grounding, and it broke the emergent freight ratio) |
| `TRANSFER_DAYS` | 0.25 | days; intermodal handling placeholder |
| `MOUNTAIN / SLOPE / RELIEF COST` | 5 / 3 / 4 | continuous terrain-factor coefficients; the slope term is Naismith-form (days per unit ascent, horizontal-grid-independent, so total climb telescopes across resolutions) |
| `COLD / MUD / WATERLOG / SEA-STORM` | 2 / 0.8 / 0.7 / 1.2 | seasonal cost responses. Land: cold (snow/pass closure) + waterlogged-ground mud. Sea: the cold-storm/ice term only — review REMOVED an undocumented `MONSOON_STORM_FACTOR = 6` wetness tax that slowed all tropical sea travel identically both ways |
| `WIND_GAIN / WIND_REF_MS` | 0.4 / 8 | the monsoon mechanism: sail-time factor 1/(1+gain·alignment), alignment = wind·heading clamped at the reference speed. At full monsoon wind the downwind:upwind passage ratio is ≈2.3, the band period sailing records support |
| `RIVER_DOWNSTREAM / UPSTREAM` | 0.6 / 1.4 | directed river travel factors |
| `FREIGHT sea:river:land` | 1:5:28 | Duncan-Jones relative freight anchor; the gate MEASURES this through the engine on reference terrain — cost-per-ton-day = mode speed × ratio, so the per-km ratio emerges |
| `GRAIN_FREIGHT_EFOLD_KM` | 340 | [CONTESTED] Diocletian land-haul anchor, carried from v1 |
| `GRAIN_SHED_EQUIVALENCE` | 3000 km sea ≡ 75–175 km land | the "cheaper across the Mediterranean than 75 miles inland" anchor (Jones/Gibbon), measured through the engine |
| `CLIMATE_MONTHLY_RATIO clamps` | 0.05 / 3 | bounds on the observed month/annual precipitation ratio applied to the sim's annual moisture |
| `DEGC_PER_TEMPERATURE_UNIT` | 100 | the sim temperature scale (t = 0.6 + °C/100), v1 convention |
| `MATH_TAN_EIGHTH_PI` | tan(π/8) | atan range-reduction bound (dmath datan2 — rewritten in review: the ported series was artanh, not arctan) |
| `ROUTING_UNREACHABLE_DAYS` | 1e300 | router sentinel, not physics |
| `MAX_LAKE_AREA_KM2` | 370,000 | Caspian-class physical lake cap |
| `ANCESTRY_HOP_FREE / OCEAN_EFOLD` | 80 / 40 | km; converted from v1 tile conventions |
| `LAKE_MOISTURE_RADIUS_KM` | 60 | km; converted from v1 tile convention |
| `VOLCANIC_INFLUENCE / FULL_KM` | 300 / 140 | km; converted plate-boundary soil influence |
| `MINE_SCATTER_RADIUS_KM / SMALL` | 500 / 375 | km; converted v1 scatter radii |

## W1 — proposed (review pending)

| Constant | Value | Unit / grounding |
|---|---:|---|
| `FLOOD_STAGE_M` | 8 | metres above the local low-water channel floor; order set by the pre-dam Nile crest at Aswan |
| `FLOOD_SEARCH_RADIUS_KM` | 100 | kilometres; physical lateral bound for a flood-stage cross-section scan, with the elevation cut determining the actual plain |
| `ELEVATION_SAMPLE_STEP_KM` | 1.8 | kilometres; spacing of the ETOPO point samples used by the river-floor and floodplain measurements |
| `RIVER_FREEZING_TEMPERATURE` | 0.60 | sim temperature units; freshwater freezing point at 0°C under `t = 0.60 + °C/100` |
| `RIVER_BASEFLOW_FRACTION` | 0.65 | share of mean annual runoff represented by groundwater/baseflow in the monthly routing pass; damps flash-rainfall noise without changing annual flow |
| `FINE_CHANNEL_ACCUM_MIN` | 4 | fine-grid drainage cells; bake-time channel observation floor, not a world or river-class threshold |
| `LAKE_RASTER_SUBSAMPLES` | 4×4 | subpixel coverage samples; representation rule for the majority-filled data-pixel bar |
| `LAKE_SOURCE_MIN_AREA_KM2` | 100 | square kilometres; bake-time parsing floor below the shipped-pixel scale, retained only to skip sub-grid HydroLAKES texture |
| `SEASONAL_SNOW_RELEASE_BAND` | 0.08 | sim temperature units; minimal monthly thaw band used by the snow-store fallback for cold-season runoff |

## M2 — proposed (review pending)

| Constant | Value | Unit / grounding |
|---|---:|---|
| `PEOPLE_R_GROWTH_PER_YEAR` | 0.0028 | intrinsic annual natural increase; pre-modern recovery band |
| `PEOPLE_FORAGER_CAPACITY_PER_KM2` | 0.12 | persons/km²; mobile forager carrying density, HYDE/McEvedy opening-envelope scale |
| `PEOPLE_INITIAL_FILL_FRACTION` | 0.35 | share of forager capacity at the Younger Dryas opening |
| `PEOPLE_FARM_CAPACITY_PER_KM2` | 12 | persons/km²; rainfed farming capacity scale |
| `PEOPLE_FARM_TECHNIQUE_BASE / GAIN` | 0.45 / 1.65 | first-tech to advanced-farming capacity differential |
| `PEOPLE_WATER_ACCESS_GAIN` | 1.4 | capacity lift from water access |
| `PEOPLE_RIVER_ACCESS_DIVISOR / WEIGHT / LAKE_WEIGHT` | 4 / 0.35 / 0.25 | river-magnitude normalization and channel/lake access weights |
| `PEOPLE_FORAGER_FERTILITY_BASE / GAIN` | 0.35 / 0.65 | forager response to static fertility |
| `PEOPLE_FLOODPLAIN_ACCESS_WEIGHT` | 1.5 | measured fractional floodplain access weight |
| `PEOPLE_RELIEF_PENALTY` | 3 | relief-to-capacity penalty |
| `PEOPLE_DISEASE_RATE` | 0.35 | tropical climate-state growth brake |
| `PEOPLE_GROWTH_FORAGER_FACTOR / TECHNIQUE_GAIN` | 0.35 / 1.3 | forager-to-advanced farming growth regime |
| `PEOPLE_GRAVEYARD_RATE / DENSITY / GAMMA` | 0.0014 / 30 / 0.5 | density-graded urban excess mortality; literature exponent |
| `PEOPLE_CAPACITY_FLOOR_PER_KM2` | 0.001 | numerical density floor |
| `PEOPLE_MIGRATION_DIFFUSIVITY_KM2_PER_YEAR` | 1200 | real pre-modern mobility correction |
| `PEOPLE_MIGRATION_MAX_SHARE / SUBSTEPS` | 0.5 / 16 | explicit diffusion stability bound and safety cap |
| `PEOPLE_TECHNIQUE_PRESENT / CLIMATE_FLOOR` | 0.01 / 0.05 | reached-technique visibility and package-envelope floor |
| `PEOPLE_HEARTH_MIN_SEPARATION_KM / BASIN_RADIUS_KM` | 1000 / 500 | same-package condensation spacing and maturity-basin radius |
| `PEOPLE_COHORT_CHILD / WORKING / ELDER_FRACTION` | 0.35 / 0.60 / 0.05 | opening age-structure fractions |
| `PEOPLE_CHILD / WORKING_AGE_YEARS` | 15 / 45 | fixed compartment cohort spans |
| `PEOPLE_*_MORTALITY_FACTOR` | 1.2 / 0.8 / 2.4 | child, working, elder mortality weights |
| `SAVE_VERSION_M2` | 3 | additive people-field persistence format |
| `PEOPLE_BAND_COUNT` | 16 | fixed contiguous row bands derived from the grid, independent of worker count |
| `PEOPLE_BROWSER_PARITY_TICKS` | 24 | browser/node wasm identity sample horizon |
| `PEOPLE_BENCH_LONG_YEARS` | 1000 | target-grid wall-clock benchmark horizon |

## W3 — proposed (review pending)

| Constant | Value | Unit / grounding |
|---|---:|---|
| `PEOPLE_GROWTH_STRIDE_MONTHS` | 12 | default stride of the growth/technique/capacity/cohort passes; performance cadence, trajectory-checked by the stride arm |
| (migration stride) | derived | largest divisor of 12 keeping every peopled row's per-firing share ≤ `PEOPLE_MIGRATION_MAX_SHARE`; printed in provenance, not a constant |
| `CADENCE_TRAJECTORY_POP_TOLERANCE` | 0.02 | relative population delta, shipped schedule vs all-strides-1, at every checkpoint — gate tolerance, never a mechanism input |
| `CADENCE_TRAJECTORY_ARRIVAL_TOLERANCE_YEARS` | 25 | farming-arrival delta bound, same comparison |
| `SAVE_VERSION_W3` | 4 | saves carry the resolved schedule |
| `PEOPLE_WORKER_WAIT_MS` | 10000 | timeout for a worker to report ready at pool start |
| `PEOPLE_BARRIER_WAIT_MS` | 1 | Atomics.wait slice for the band-done, worker-idle and phase barriers; a lost futex wakeup (measured: ~1 per 1000 rounds on the review runner, Node main thread ↔ workers, no wasm) then costs one slice instead of hanging |
| `PEOPLE_WASM_MEMORY_INITIAL_PAGES` | 1024 | shared-memory people kernel initial pages (64 MiB); grows toward the max |
| `PEOPLE_WASM_MEMORY_MAXIMUM_PAGES` | 32768 | shared-memory cap, 2 GiB, matching the threaded link `--max-memory` |
| `PEOPLE_THREAD_STACK_BYTES` | 1048576 | per-worker shadow stack allocated at instance init |
| `PEOPLE_WORKER_ERROR_BYTES` | 1024 | shared-memory text capacity through which a band worker reports a failure to a coordinator blocked in Atomics.wait |

## M3a — reviewed (2026-09-02)

| Constant | Value | Unit / grounding |
|---|---:|---|
| `PEOPLE_ADOPTION_RATE_PER_YEAR` | 0.01 | per year; the fraction of a cell's foragers who take up a package per year at full local contact (living wholly among its farmers) and saturated advantage. The front runs at 2·√((r + rate)·D) of the farmer group; with the farmer mobility below and M2's farmer growth regime (0.46 %/yr) the Pinhasi–Fort–Ammerman band (0.6–1.3 km/yr) admits 0.005–0.02, and the long front gate can falsify it. Proposed at 0.08 with an unbounded linear advantage, which converted a cell within a few years of first contact and moved the front one cell per conversion interval — a grid-spacing speed (review) |
| `PEOPLE_FARMER_MOBILITY_KM2_PER_YEAR` | 15 | km²/yr; sedentary farmer mobility, Ammerman & Cavalli-Sforza (1984): 1544 km² mean squared displacement per 25-year generation ÷ 4T. Foragers keep the M2 diffusivity (1200); a farmer mass joins a month's flow at the ratio of the two |
| `PEOPLE_FARMER_MOBILITY_RATIO` | 15 / 1200 = 0.0125 | derived |
| `PEOPLE_COASTAL_HOP_KM` | 40 | km; longest foot-and-raft water crossing, checked by Cardial coast vs inland arrivals |
| `PEOPLE_HEARTH_SEED_FRACTION` | 0.2 | share of a hearth cell's people farming at ignition; a founding sub-population rather than a whole-cell relabel |
| `PEOPLE_CROP_NEIGHBOR_COUNT` | 8 | neighbours; eight-direction travel stencil with true edge lengths and coastal hops |
| `SAVE_VERSION_M3A` | 5 | additive farmer-mass and hearth-history persistence format |
| `PEOPLE_SNAPSHOT_FIELD_COUNT` | 5 | float32 overlay planes in a shell snapshot: population, technique, package, can-grow count, native count |
| crop packages (data) | per package | climate bell + growing-season minimum + storability + yield + domestication lag; `cropPackages.js` promoted to `data/reality/crop-packages.json` |
| wild ranges (data) | boxes per package | `data/reality/crop-ranges.json`, longitude/latitude boxes rasterized at the substrate grid; sources still to be cited per box (review finding) |
| withdrawn | — | `PEOPLE_FORAGER_DENSITY_BAR` (proposed 0.12 × 0.35 × 0.35): the peopled-basin law measures a basin's people against the basin's own static forager capacity (M2, unchanged) and needs no bar; a global bar clamped every peopled basin to "full" from the opening tick |
| deleted | — | `PEOPLE_TECHNIQUE_WAVE_KMPY`, `PEOPLE_HEARTH_SEARCH_FRACTION`, `PEOPLE_HEARTH_SCORE_*`, `PEOPLE_HEARTH_FALLBACK_LAG_YEARS`, `PEOPLE_HEARTH_LAG_RANGE_YEARS`, `PEOPLE_HEARTH_MAX_COUNT` |

## W5 — proposed (review pending)

| Constant | Value | Unit / grounding |
|---|---:|---|
| `CAGE_KNEE_FREE_SHARE` | 0.2 | share; the Power row `CAGE_KNEE` (pressure zero while ≳20 % of the basin is free — Carneiro's circumscription, v1-measured ladder) as a named constant. Read by the wake trigger now and by M4's taking later: one quantity, one row |
| `PEOPLE_FARMED_MARKER_SHARE` | 0.5 | representation threshold (18.3), not a world constant: the farmed share at which arrival instruments count a cell as farmed — the people gate's existing 0.5, named and shared with the arrival recorder |
| `SOLVE_AGREEMENT_ARRIVAL_TOLERANCE_YEARS` | 100 | gate tolerance, never a mechanism input: bound on the median per-cell arrival delta between the solve regime and the awake kernel over the same horizon; a tenth of the narrowest arrival window the tables carry (the Pinhasi rows are 800–1000 years wide) |
| `SOLVE_AGREEMENT_POP_TOLERANCE` | 0.05 | gate tolerance: relative population delta at every checkpoint band, same comparison; the bands themselves are factors of two to six wide |
| `SAVE_VERSION_W5` | 6 | saves carry the phase and the wake step |
| (solve stride) | derived | largest whole-year multiple of 12 months keeping every explicit per-firing fraction inside `PEOPLE_MIGRATION_MAX_SHARE`: the farmer hop share on rows with can-grow cells, farmer growth, adoption, cohort ageing; printed in provenance like the migration stride, never hand-set per grid |
| `config.wake` | auto / never / year | an initial condition (auto = the caged-basin trigger; never = measurement mode; a year = the player's epoch), not a constant, read by no pass |

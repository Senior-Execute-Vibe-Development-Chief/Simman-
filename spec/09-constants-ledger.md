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
| HORIZON_OPENING_YEAR / HORIZON_END_YEAR | −9700 / 1 | the world clock's origin (the end of the Younger Dryas) and Phase 1's primary horizon end, as calendar labels: display, provenance, and the conversion of a player's chosen epoch into an initial condition (W5). Never a mechanism input (R1) |
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
| MIGRATE_D | resolved (W6) | see `PEOPLE_FORAGER_MOBILITY_KM2_PER_YEAR` and `PEOPLE_FARMER_MOBILITY_KM2_PER_YEAR`; the v1 value was a calibration, never a measurement |
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
| `PEOPLE_MIGRATION_DIFFUSIVITY_KM2_PER_YEAR` | 1200 → retired (W6) | was "real pre-modern mobility correction": a v1 calibration, `[REDERIVE]` in the seed table; replaced by the grounded forager mobility below (§W6) |
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

## W12 — the diffusion conversion

| Constant | Value | Unit / grounding |
|---|---:|---|
| `DIFFUSION_MSD_PER_DIFFUSIVITY` | 4 | dimensionless; two-dimensional diffusion spreads as `<r^2> = 4Dt`, so a lattice that moves a fraction `s` one hop per unit time delivers `s * <d^2> / 4` and the share must be `4 * D * dt / <d^2>` to deliver the diffusivity the mobility constants name. Mathematics, not a tuning value |
| `MIGRATION_HOP_MEAN_SQUARE_WEIGHT` | 0.75 | dimensionless; the eight-neighbour stencil's mean square hop, `(2*h_ew^2 + 2*h_ns^2 + 4*(h_ew^2 + h_ns^2)) / 8 = 0.75*(h_ew^2 + h_ns^2)`. One and a half times the cell area where the cell is square, more toward the poles. Replaces the cell area, which the share had used as if it were the mean square hop |

The pass previously used `share = D * dt / area`, short by `4 * area / <d^2>`
— 2.67 at the equator — so it delivered about `D / 2.3` after substepping and
the front, which runs as `2*sqrt((r + adoption)*D)`, came out at 0.553 km/yr
at the shipped grid against this ledger's own design of 0.936 and the cited
Pinhasi-Fort-Ammerman band of 0.6-1.3. Corrected: 0.670 km/yr, inside the
band. The mobility constants are unchanged (QUESTIONS #55, #56).

The correction is not free: a share inside `PEOPLE_MIGRATION_MAX_SHARE`
needs 3.5x the movement firings to carry the same span at the shipped grid,
measured 34.9 -> 104.8 ms per solve year. Per-pass strides are what keep that
multiplier off the other five passes — against one stride at migration's own
bound the same span costs 124.3 ms/yr on a cold world and 401.8 against
243.6 ms/yr with every hearth primed (1.19x and 1.65x). The reference grid is
untouched: its transport bound is over a century, the reaction cap binds, and
the schedule and every hash are byte-identical.

| (solve schedule, per pass) | derived: 84 / 84 / 84 / 84 / **24** / 84 months at target, all 84 at dev | technique, conversion, capacity, growth, migration, cohorts, each at the largest whole-year multiple of 12 months inside ITS OWN bound — the REACTION bound (`0.5 × PEOPLE_CHILD_AGE_YEARS`, the tightest of growth, adoption and cohort ageing, and grid-independent because none of the three knows a cell size) for five of them, the hop bound for migration. Replaces the single solve stride, which ran every pass at the tightest bound. Migration is additionally capped at the reaction stride: it carries the field the reaction passes wrote, so a longer firing would integrate a field that no longer exists, and it would buy no reach doing so since a firing moves people at most one cell. At the reference grid that cap is what binds and the schedule stays uniform — byte-identical (W12 §2) |
| (solve clock) | derived: gcd of the strides — 12 months at target, 84 at dev | how far one solve step advances: the largest advance that lands exactly on every pass's cadence, so each pass keeps the stride its own bound gives it and the centralised `passFires` check decides the rest, as in the awake regime. Rounding the longer strides DOWN to the shortest instead would set the growth cadence from migration's transport bound, which has nothing to do with growth, and would put every pass back on one stride the moment §3 moves that bound. A step on which nothing is due costs the cadence check and nothing else (W12 §2) |
| `SAVE_VERSION_W12` | 8 | the solve regime carries a schedule, not one stride |
| (migration hop bound) | `PEOPLE_MIGRATION_MAX_SHARE · <d²> / (4·D)` per row | the stride the corrected share permits on every peopled (foragers) or can-grow (farmers) row. `hopBound` is `PEOPLE_MIGRATION_MAX_SHARE` alone, NOT `× PEOPLE_MIGRATION_MAX_SUBSTEPS`: substepping keeps the explicit scheme stable but does not let anyone hop twice, so reach saturates at one hop per firing and the 16× allowance bought only a slower front. Binds at 24 months at the shipped grid, on rows at 83 °N holding 25 people — the pole problem, whose fix is the grid (W12 §3), not a threshold (QUESTIONS #58: any exclusion deep enough to matter gives up 89 % of the world) |
| (reduced polar grid) | merge east–west where `cos(lat) < 0.5`, in fours below 0.25 | proposed, W12 §3; one geometric criterion — every cell's aspect ratio inside [0.5, 1], the condition under which the isotropic and anisotropic diffusion bounds agree within 2×. The merge latitudes follow from it; nothing is set per grid |

## W5 — proposed (review pending)

| Constant | Value | Unit / grounding |
|---|---:|---|
| `CAGE_KNEE_FREE_SHARE` | 0.2 | share; the Power row `CAGE_KNEE` (pressure zero while ≳20 % of the basin is free — Carneiro's circumscription, v1-measured ladder) as a named constant. Read by the wake trigger now and by M4's taking later: one quantity, one row |
| `PEOPLE_FARMED_MARKER_SHARE` | 0.5 | representation threshold (18.3), not a world constant: the farmed share at which arrival instruments count a cell as farmed — the people gate's existing 0.5, named and shared with the arrival recorder |
| `SOLVE_AGREEMENT_ARRIVAL_TOLERANCE_YEARS` | 100 | gate tolerance, never a mechanism input: bound on the median per-cell arrival delta between the solve regime and the awake kernel over the same horizon; a tenth of the narrowest arrival window the tables carry (the Pinhasi rows are 800–1000 years wide) |
| `SOLVE_AGREEMENT_POP_TOLERANCE` | 0.05 | gate tolerance: relative population delta at every checkpoint band, same comparison; the bands themselves are factors of two to six wide |
| `SAVE_VERSION_W5` | 6 | saves carry the phase and the wake step |
| (solve stride) | derived: 84 months at both grids | largest whole-year multiple of 12 months keeping every explicit per-firing fraction inside `PEOPLE_MIGRATION_MAX_SHARE`: the farmer hop share on rows with can-grow cells, farmer growth, adoption, cohort ageing (the binding bound at both grids); printed in provenance like the migration stride, never hand-set per grid. Foragers take the forager share of the same stride, substepped and capped by the kernel's own bound |
| `config.wake` | auto / never / year | an initial condition (auto = the caged-basin trigger; never = measurement mode; a year = the player's epoch), not a constant, read by no pass |

## W6 — implemented (2026-09-03)

| Constant | Value | Unit / grounding |
|---|---:|---|
| `PEOPLE_FORAGER_MOBILITY_KM2_PER_YEAR` | 23 | km²/yr; forager population mobility by the convention the farmer value uses, mean squared displacement per generation ÷ 4T (T = 25 y). Source: the Aka of the Central African Republic, at 0.017–0.031 people/km² (inside the sim's forager density band). Cavalli-Sforza & Hewlett 1982, *Ann. Hum. Genet.* 46:257–270: the mean distance between birthplaces of mates equals the mean exploration range; Hewlett, van de Koppel & Cavalli-Sforza 1982, *Man* 17:418–430: that range is negative-exponential with mean k = 43 km (half-range 30 km; adult-male half-ranges 27.5–58.3 km by locality, females 32.4). Exponential ⇒ ⟨d²⟩ = 2k². Counting one parent's displacement as half the mating distance (21.5 km) gives 925 km² per generation, 9 km²/yr; counting the whole mating distance as the displacement (43 km) gives 3,698 km², 37 km²/yr. The range is carried and the value is its median, 23 — the farmer value's order (15), not eighty times it. Chosen from the sources before any run. Replaces `PEOPLE_MIGRATION_DIFFUSIVITY_KM2_PER_YEAR` (1200, a v1 calibration `[REDERIVE]` since the seed table) |
| `PEOPLE_ADOPTION_RATE_PER_YEAR` | 0.01, re-grounded only inside 0.005–0.02 | if the Balkans → Rhine speed leaves the radiocarbon band once foragers stop flooding farmed cells; the row records the measurement |
| (movement stride, per group) | derived: 84 months at both grids | foragers on peopled rows at the forager mobility, farmers on can-grow rows at the farmer mobility, each inside `PEOPLE_MIGRATION_MAX_SHARE × PEOPLE_MIGRATION_MAX_SUBSTEPS` per firing, together with the growth, adoption and cohort-ageing bounds the solve stride carries (the cohort bound binds); the awake movement pass fires at that stride, a multiple of the growth stride, printed. The awake and solve regimes now differ only in the growth cadence |
| room floor | `PEOPLE_CAPACITY_FLOOR_PER_KM2` (0.001, existing) | representation threshold (18.3): room below the numerical floor is no room; a source none of whose neighbours has room for a group is not priced for it, and the skipped flow is below floor × area by construction |
| deleted | — | `PEOPLE_MIGRATION_DIFFUSIVITY_KM2_PER_YEAR`, `PEOPLE_FARMER_MOBILITY_RATIO`; the seed row `MIGRATE_D` resolves here |

## W7 — implemented (2026-09-03)

| Constant | Value | Unit / grounding |
|---|---:|---|
| wild ranges (data) | dense-stand belts per package, cited | `data/reality/crop-ranges.json`: the habitat where each package's wild progenitor forms harvestable stands, with the sources that separate massive stands from sporadic plants (Harlan & Zohary 1966; Zohary, Hopf & Weiss 2012; Fuller 2011; Fuller & Qin 2009; Zheng 2016; Matsuoka 2002; Piperno 2009; Harlan 1971; Winchell 2017; Manning 2011; Lu 2009; Zhao 2011; Olsen & Schaal 1999; Piperno & Pearsall 1998; Harlan 1969; Denham 2003; Smith 2006). Replaces the M3a bounding boxes of the whole botanical distribution, whose citations were pending (26 g). Earthness in data (R7): the plant's biogeography, never a hearth's archaeology |
| (hearth accrual rate) | derived: fill × min(1, foragerCapacity / capField) | per year of years toward the package's lag; the basin's fill (M2's peopled-basin law, unchanged) times the share of the cell's own subsistence that is still the land's forager yield. An unfarmed cell accrues at its fill; a cell the spread has reached lives on a capacity a hundredfold the forager yield and its clock all but stops, so arrival pre-empts invention with no rule or constant for it. `PEOPLE_CAPACITY_FLOOR_PER_KM2` (existing) floors the denominator |
| `PEOPLE_COASTAL_HOP_KM` | 100 (was 40) | km; the longest sea crossing the Neolithic demonstrably colonised from a mainland: Cyprus (~70 km, by 8500 BCE), Malta (~80 km from Sicily), Corsica (~80 km from Tuscany via Elba and Capraia). The M3a value was a foot-and-raft scale checked against the Cardial row; at the dev grid (167 km cells) no sea cell is within either, at the shipped grid the Aegean, the Marmara, the Adriatic and the Korea Strait become crossings |
| sorghum `domLagY` (data) | 2500 (was 2000) | years from the wild-sorghum harvests of the Khartoum Mesolithic and Nabta Playa (~6000 BCE) to domesticated grain in the eastern Sudan (Winchell et al. 2017, Current Anthropology 58:673–683, fourth millennium BCE). The other lags keep v1's archaeobotanical directions |
| unchanged | — | `PEOPLE_HEARTH_MIN_SEPARATION_KM` (1000), `PEOPLE_HEARTH_BASIN_RADIUS_KM` (500), `PEOPLE_HEARTH_SEED_FRACTION`, every bell, every other lag, the adoption rate, both mobilities |
| (front speed, measured) | 0.53 km/yr flat, shipped grid | 2·√(r·D) of the farmer group's own growth (0.28 %/yr × 1.65) and mobility (15 km²/yr), reproduced on a flat field at the shipped grid (0.66 at dev, one 167 km cell per 252 years). The M3a expectation of 0.94 added `PEOPLE_ADOPTION_RATE_PER_YEAR` at full contact; a pulled front's leading edge has none. Landing central Europe is P15 (the uncrowded frontier growth rate), not a rate to dial here |

## W8 — implemented (2026-09-03)

| Constant | Value | Unit / grounding |
|---|---:|---|
| wild-habitat envelopes (data) | per package: `tOptWild / tTolWild / mOptWild / mTolWild` | the sim's annual climate indices sampled at the documented dense-stand localities of each progenitor (the plant's localities from the range sources, listed in `data/reality/README.md`), mean ± spread; the spread floored at the climate table's resolution (0.05 temperature, 0.08 moisture: the table is ~1.9° cells and a one-valley crop samples a handful). Never sampled at a hearth |
| wild ranges (data) | polygons per package | `data/reality/crop-ranges.json` rings traced on the W7 sources; rasterized by point-in-polygon |
| (stand richness) | derived: wildBell(annual T, M) inside the polygon where the crop can grow | 0..1 per package per cell, static |
| `PEOPLE_WILD_STAND_CAPACITY_PER_KM2` | 0.5 | persons/km² a dense wild stand feeds at full richness: Natufian hamlets on the Levantine stands (Bar-Yosef 1998, *Evolutionary Anthropology* 6:159–177), Binford 2001's terrestrial-plant groups in warm-temperate settings (0.1–0.5). The first draft priced the stand through the farmed-yield chain (12 × fertility × fit × 0.45 × a 0.1 cover) and got 0.04 at Karacadağ, a tenth of what the Natufian record holds; the density is the measured quantity, so it is the constant |
| `PEOPLE_FORAGER_AQUATIC_CAPACITY_PER_KM2` | 0.4 | persons/km² at full aquatic access: the median of Binford 2001's aquatic-resource groups (0.3–3, Kelly 2013 ch. 7). Applied to aquatic access — floodplain, river, lake and the shore strip — never to the water-access index, whose largest term is rainfall (the first draft did, and every wet cell became a fishing shore) |
| `PEOPLE_SHORE_STRIP_KM` | 20 | km; the shore strip a coastal forager works, a day's foraging radius each way (Kelly 2013, ~10 km). A coast cell's shore access is the strip's share of the cell, min(1, 20 / √area): a 22 km cell on the coast is nearly all shore, a 167 km cell a tenth — the same in real km at every grid. Without it 29 % of the reference grid's peopled cells were full shore and the opening population left its band (third cardinal rule) |
| (forager capacity) | derived: terrestrial (M2's law) + aquatic × access + the richest stand | the terrestrial part is kept apart (`_foragerTerrestrial`) for the hearth law |
| (crop fit) | derived: warmth term × max(rain term, water access), over the growing months | grades the harvest the floor gates; a floodplain grows wheat in a desert (the first draft graded on rain alone and the Nile could not be farmed) |
| (mixture capacity) | derived: forager × (1 − Σ shares) + Σ share × package capacity | both kernels, active packages in index order |
| (adoption pressure) | derived: min(1, people / forager capacity) | the cell's people against the FORAGER capacity — the foragers' own living, as W6's room law reads it; against the mixture, the pressure vanished the moment farmers appeared and the front stalled (first draft) |
| (switching) | derived: `PEOPLE_ADOPTION_RATE_PER_YEAR` × contact × saturated relative advantage, between packages | conserved labels; no new constant |
| (hearth accrual) | derived: basin fill × stand / (stand + terrestrial) × min(1, forager / capField) | the stand's share of the terrestrial living (fishing is the stand's companion, not its alternative: the first draft divided by the whole forager capacity and the Yangtze rice clock ran at a third of its rate), times W7's pre-emption. A hearth is a region: cells crossing the lag within a basin radius (500 km, existing) of an ignited hearth of the package join it; ignition requires the package to beat foraging where it stands |
| deleted | — | `PEOPLE_HEARTH_MIN_SEPARATION_KM` (1000), `PEOPLE_WILD_STAND_COVER` (a first-draft constant, replaced by the density above), `PEOPLE_COAST_ACCESS_WEIGHT` (replaced by the strip) |
| `SAVE_VERSION_W8` | 7 | hearth records carry their region size; the done flags are rebuilt from the years on load |
| reality tables (data) | `hearths.json`, `staple-by-region.json` | the centres of domestication with windows and per-centre radii where the source describes a belt; the dominant staple by region at 1 CE; the forager density ordering by habitat (Binford) is measured on the static forager capacity |

## W13 — implemented (2026-09-05)

| Constant | Value | Unit / grounding |
|---|---:|---|
| `PEOPLE_CHANNEL_STRIP_KM` | 10 | km; the ground a channel's own gravity offtake commands, both banks together: the Upper Nile valley floor between the desert edges (5–15 km, Butzer 1976, *Early Hydraulic Civilization in Egypt*, ch. 2) and the piedmont fans the first Central Asian farmers sat on (Jeitun on the Kopet Dag fans, Harris 2010, *Origins of Agriculture in Western Central Asia*). A cell's irrigable share is the strip's share of the cell, min(1, 10 / √area) — the shore strip's law (W8), the same ground in real km at every grid: 0.06 of a 167 km dev cell, ~0.5 of a 20 km shipped cell. Chosen from the sources before any run; no value was tried against a row |
| (per-tile runoff, data) | worldgen's own | `substrate.rivers.runoff`: the field the worldgen's flow accumulation already summed — moisture less evaporation plus mountain melt, floored at the desert tile's 0.05, in tile-depth units — returned alongside the accumulation instead of being summed and thresholded away. Read, not re-derived |
| (routed water) | derived: `taken = min(inflow, strip × (1 − annual moisture))` | per cell in drainage order down the worldgen's flow directions (Kahn over the D8 graph, columns wrapping); `outflow = inflow − taken + own runoff`. A cell's own runoff is never taken (it is its rain, already counted); upstream takes first, so a stream is used up along its course and the desert floor never sums into a river of its own — which is why the thresholded magnitude, which it does sum into, is not the quantity read. The term is a cell-average depth: a strip watered in full on a dry cell reads as the strip's share of the cell |
| (surface water access) | derived: clamp01(routed + floodplain × 1.5 + min(1, magnitude / 4) × 0.35 + lake × 0.25) | the land's own water, rain aside (`_surfaceAccess`): the existing floodplain, river and lake terms with their existing weights, plus the routed term. Water access is annual moisture plus this, clamped, as before; the split is so that a month can be admitted on the land's water without being admitted on the year's rain |
| (month admission) | derived: warm enough, and watered by the month's rain or by the land's own water | a growing month is one where `warmth × max(rain bell, surface access) ≥ PEOPLE_TECHNIQUE_CLIMATE_FLOOR` (0.05, existing) and the temperature clears the package's base. W8 admitted a month on its rain alone and graded it on rain-or-access, so the Nile's dry winter — warm and watered — never counted toward wheat's season: Luxor 5 months → 8, Mohenjo-daro 4 → 7, Peshawar 9 → 12. The YEAR's rain does not admit a dry month (the first draft admitted on the whole water index and broadened every rain-fed season; measured, the gate did not move and the rule was narrowed to the physical one) |
| (crop fit) | unchanged: warmth × max(rain bell, water access), over the admitted months | W8's grade, now over W13's months. Finding, recorded not dialed: on watered ground `max(rain, access)` saturates for every package alike, so the fit is the warmth term alone — a water index that serves every package alike is not a paddy, and rice's advantage on flooded ground is not in the bells (QUESTIONS #65) |
| unchanged | — | `PEOPLE_FLOODPLAIN_ACCESS_WEIGHT`, `PEOPLE_RIVER_ACCESS_WEIGHT`, `PEOPLE_RIVER_ACCESS_DIVISOR`, `PEOPLE_LAKE_ACCESS_WEIGHT`, `PEOPLE_WATER_ACCESS_GAIN`, `PEOPLE_SHORE_STRIP_KM`, every bell, every lag, both mobilities, the adoption rate |
| (measured, substrate only, shipped grid) | — | water access at the sites: Luxor 0.35 → 0.81, Mohenjo-daro 0.74 → 1.00, Bukhara 0.15 → 0.44, Kashgar 0.33 → 0.67, Peshawar 0.54 → 0.77, Patna 0.36 → 0.66, Aleppo 0.15 → 0.31; the plateau sites the row waits on barely move (Jeitun 0.02 → 0.07, Mehrgarh 0.02 → 0.12, Sang-e Chakhmaq 0.02 → 0.02) because their catchments hold only the runoff floor in the 1.9° table — P18, a data finding, not this constant's |

## W14 — implemented (2026-09-05)

| Constant | Value | Unit / grounding |
|---|---:|---|
| `OROGRAPHIC_GAIN_PER_KM` (ported worldgen, `realClimateData.js`) | 0.5 | per km of elevation anomaly; the relative windward precipitation gradient — Barry 2008, *Mountain Weather and Climate*, ch. 4: 50–100 mm per 100 m on 1,000–2,000 mm regimes, i.e. 0.25–1 per km; PRISM's slope regression fits the same order (Daly, Neilson & Phillips 1994, J. Appl. Meteorol. 33:140–158). The middle of that range. Chosen from the sources before any run; no value was tried against a row. **W15 amends the reference, not the gain**: the footprint was aspect-blind (a lee slope lifted like a windward one) and now weighs the height the air CLIMBED along the month's observed wind, which is the standard upslope model (Smith 1979, Adv. Geophys. 21:87–230). The gain is deliberately unchanged — moving it to suit the new term would be fitting the outcome |
| `VAPOUR_SCALE_HEIGHT_KM` (ported worldgen) | 2.5 | km; the anomaly is clamped at ±H_w — above it the column has no more water to wring out (Smith & Barstad 2004, J. Atmos. Sci. 61:1377–1391, H_w 2–3 km; Roe 2005, Annu. Rev. Earth Planet. Sci. 33:645–671) |
| `TABLE_CELL_DEG` (ported worldgen) | 1.9 | degrees; the NCEP/NCAR reanalysis Gaussian grid's cell (94 × 192). The footprint half-width is `max(0, floor((W · 1.9 / 360 − 1) / 2))` — the widest odd box that fits INSIDE one table cell, so nothing is moved across the table's own resolution: 0 at the reference grid (240 wide) and the 480-wide cross-grid proxy, where the correction is inert by construction; 2 at the app's Half grid (960 wide: a 5-cell, 1.875° box); 4 at the v2 target grid (1800 wide, 0.2°: a 9-cell, 1.8° box) and at 1920 |
| (orographic share) | derived: `exp(g · clamp(Δz, ±H_w)) × landCount / Σ_box weight` | each land pixel's share of its footprint's rain: Δz against the footprint's LAND-mean elevation (**superseded by W15: Δz is the climb from the elevation one footprint half-width UPWIND**; the sea is excluded and reads 1), columns wrap and rows clamp at the poles (the lapse smoothing's own convention), and the weights are normalised to a land mean of one over the same footprint, so the footprint's rain is conserved to first order and none is invented (measured land mean 0.9988 over the target grid's 558,091 land cells; the unit test holds a synthetic ridge's crest above 2, its foot below 1, far land and sea at 1, and the land mean within 1 %). Applied to the sampled millimetres BEFORE the quantile rank (Pass 1); the quantile map itself (Pass 2, the solver's own moisture at the observed rank, floored at 0.02) is untouched, which is what leaves the desert plateau at the floor (measured row below). Off with `SubstrateConfig.rawRain` |
| `standingWaterResponse` (data, `crop-packages.json`) | rice 1.0; New Guinea roots 0.33; every other package −0.35 | the relative change of a package's monthly fit on ground standing under water. Rice: the paddy about doubles the upland crop (Bray 1986, *The Rice Economies*; GRiSP 2013, *Rice Almanac*: irrigated ~5.4 t/ha against rainfed lowland ~2.3 and upland ~1). The New Guinea roots: taro's ~2× wet-over-dry gain (Kirch 1994, *The Wet and the Dry*) over one member of three. Everything else: the middle of the 20–50 % waterlogging loss in cereals (Setter & Waters 2003, Plant and Soil 253:1–34), applied as the class figure to the tubers as well — coarse, and said so in the data file. A property of the plant; no package is named in code and no place is |
| (flood presence, per month) | derived: `floodplain × clamp01(flow_m / mean₁₂(flow) − 1)` | the plain under water in a month is the channel's discharge above its own year's mean — one mean-flow's worth covers the plain. `seasonalFlowScale` is monthly flow over the STATIC annual accumulation and is not mean-one (measured on the target grid: the Nile ≈ 1.0, the Ganges 0.57, the Yangtze mouth 0.62, the lower Indus 0.41, Tonle Sap 0.86), so it is read against its own twelve-month mean. Finding, recorded not dialed: the seasonal river model's amplitude is flat — the peak month on floodplain cells reads p10 0.58, p50 1.19, p90 2.03, max 3.74 of the mean, and the Nile's 1.21 against the ~3× of the real pre-dam flood at Aswan (Sutcliffe & Parks 1999, *The Hydrology of the Nile*) — so the imposed term is a few hundredths on the great rivers and the stream term below carries the paddy there (QUESTIONS #66) |
| (stream, per month) | derived: `min(strip, inflow × flow_m / mean₁₂(flow))` | the water that arrives from upstream (`_runoffInflow`: W13's routing, now kept per cell in the runoff's own units) can keep up to the channel strip standing: one cell-runoff is taken to keep about one cell-area of paddy under water (Bouman et al. 2007, *Water Management in Irrigated Rice*: 1,300–1,500 mm per season, the order of a wet year's rain) — a unit assumption, stated as one. Counted only by a wetland crop (response ≥ 0); an upland crop is hurt by the flood it cannot drain and never by a stream beside it |
| (crop fit) | W8's month term × (1 + response × standing) — **W15 splits the signs, see below** | `standing = min(1, flood presence + stream)` for a wetland crop, the flood presence alone for the rest; over the admitted months, and the admission rule (W13) is unchanged. A pure multiplier of capacity (TS and Rust read the fit the same way), so a fit above one is a paddy above the rain-fed optimum; the stand (bells × fit × fertility × relief) rises with it on flooded native cells, so the paddy also makes the flooded wild stand richer |
| unchanged | — | every bell, every lag, `PEOPLE_CHANNEL_STRIP_KM`, every access weight, the month admission, the quantile map and its 0.02 floor, the worldgen's runoff floor, both mobilities, the adoption rate. Nothing was lifted to reach the plateau (second cardinal rule) |
| (measured, substrate only, target grid 1800 × 900) | — | share over land: p1 0.764, p10 0.936, p50 0.999, p90 1.052, p99 1.279, max 2.113; annual moisture moved by more than 0.05 on 3.7 % of land and by more than 0.1 on 0.8 %; the river directions differ on one cell. Where the range is wet the crest gains and the foot loses (the Pamir 39.7°N 71.5°E 0.33 → 0.59, the Hindu Kush 35.3°N 68.7°E 0.19 → 0.44, the Alborz crest 35.9°N 52.5°E 0.04 → 0.16; the Alps' Turin foot 0.34 → 0.20, Kashgar 0.33 → 0.26, Xi'an 0.20 → 0.15). **Where the whole table cell is dry it does not move the plateau sites**: Jeitun, Sang-e Chakhmaq, Mehrgarh and Tepe Yahya read 0.02 → 0.02 (water access 0.02 / 0.02 / 0.12 / 0.07, unchanged), and their highest nearby range cells (share 1.33–1.73) read 0.019–0.026 → 0.020–0.080, because the driest 26.3 % of land sits at the quantile map's 0.02 floor (raw annual moisture p25 = 0.020, p30 = 0.022) and a ×1.5 share does not move a desert-range pixel's rank out of that band (of the 1,260 cells with share ≥ 1.5, 117 sat at the floor and 57 still do). The Indus target row will not move under W14; recorded as the floor band's, not fixed by lifting the floor |
| (measured, paddy, substrate only, target grid) | — | rice's fit, paddy off → on, at the P18 substrate: Mohenjo-daro 0.54 → 0.80 (wheat 0.35 unchanged, sorghum 0.75 → 0.74), Luxor 0.48 → 0.72 (sorghum 0.63, wheat 0.32), Patna 0.52 → 0.77, Bengal 0.59 → 0.81, Dongting 0.48 → 0.74, south China 0.57 → 0.83, Tonle Sap 0.98 → 1.44, Peshawar 0.33 → 0.50; the lower Yangtze's centre cell, off the ribbon, 0.26 unchanged. Wheat is unchanged at every site in the table (the flood months fall outside its warm months); the summer crops lose 0.01–0.02 on flooded cells. Best package by summed capacity at technique 1 over the 3° staple boxes, paddy off → on: south China New Guinea roots → rice, the Ganges tubers → rice, the Indus sorghum → rice, the Sahel sorghum → rice, Mesoamerica New Guinea roots → rice; the lower Yangtze stays with the New Guinea roots (rice 5.19M, wheat 5.00M, millet 3.43M), the Nile with sorghum (0.38M; rice 0.28M, wheat 0.19M), the loess with wheat, central Europe with the highland roots, the Amazon margin with rice — fit statements on the substrate, not predictions |
| (measured, dev solve arm, the per-commit gate) | — | P18 is inert at dev by construction (zero footprint), so the arm moves on the paddy alone: people −5000 71.4 → 71.5M, −3000 624 → 629M, 1 CE 1,162 → 1,160M; the Sahel −4758 → −4842, the Ganges −5346 → −5353, the Indus −4121 → −4114, the Nile −3106 → −3099, the Balkans −5017 → −5024, the Rhine −3911 → −3904; the front 1.438 → 1.420 km/yr; river density 20.45 → 20.25 persons/km²; the first caged basin −2875 → −2896; the Sichuan millet hearth −6116 → −6228, the Orinoco tubers −4800 → −4856. No verdict changed: the two millet staples and the Yangtze hearth stand (the paddy does not flip them at 167 km cells, and says so in the manifest). 63 rows, none unacknowledged, none stale |

## W15 — implemented (2026-09-05)

Two corrections to W14, both mechanism changes with no new constant: nothing
was added to `constants.ts` and no cited value moved.

| Constant | Value | Unit / grounding |
|---|---:|---|
| `OROGRAPHIC_GAIN_PER_KM` (ported worldgen) | 0.5, **unchanged** | W14's citation stands (Barry 2008, ch. 4; Daly, Neilson & Phillips 1994). W15 changes only WHICH height the gain is applied to. Moving the gain to suit the new reference would be fitting the outcome (second cardinal rule), so it is deliberately untouched, and the measured contrast improves without it |
| `VAPOUR_SCALE_HEIGHT_KM` (ported worldgen) | 2.5, **unchanged** | as W14; the clamp is on the same anomaly, now the climbed one |
| `TABLE_CELL_DEG`, the footprint half-width | 1.9, **unchanged** | as W14; the lookback distance is the same half-width, so no length is introduced. Radius 0 at the reference grid and the 480 proxy (inert by construction), 2 at the app's Half grid, 4 at the target grid and at 1920 |
| (orographic share — **supersedes W14's**) | derived: `exp(g · clamp(z(x) − z(x − r·ŵ_m), ±H_w))`, land-mean-normalised over the footprint, averaged over the twelve months weighted by each month's rain | the standard upslope model: the rain a slope makes is set by the height the air CLIMBED to reach it, so the reference elevation is the ground one footprint half-width UPWIND along that month's wind, not the footprint's land mean. W14's land-mean reference was aspect-blind — a lee slope of the same height lifted exactly as much as the windward one, which is the one thing an orographic term must not do. Smith 1979, *Adv. Geophys.* 21:87–230 (the linear upslope/airflow model); Roe 2005, *Annu. Rev. Earth Planet. Sci.* 33:645–671 (§2, upslope forcing as the leading control on the windward-lee contrast). The wind is the substrate's own monthly NCEP/NCAR field already used by the climate sampler, sampled at the cell: `dx = +u, dy = −v` (u eastward, v northward, raster y southward), the zonal component divided by cos(lat) for the equirectangular grid and the pair renormalised to unit length in cells. A dead calm (‖w‖ = 0) reads weight 1, as does the sea and a zero footprint. The share is a per-month field; the annual share the sampler applies is `(1/12) Σ_m rawPrecipRatio_m · share_m`, exact because `precipRatio` has annual mean one by construction. Off with `SubstrateConfig.rawRain`, as before |
| (crop fit — **supersedes W14's**) | W8's month term × (1 + technique × gain − drowning) | W14 applied the whole standing-water response as botany, at every technique and to the wild stand. The paddy is not botany: a bunded, levelled, water-controlled field is HUSBANDRY, and Bray 1986 / GRiSP 2013's irrigated-over-rainfed yield ratio is a number measured on managed fields. So the POSITIVE part of the response is scaled by the cell's technique — a first cultivator (technique 0) and the un-farmed wild stand get none of it, full paddy arrives at technique 1 — while the NEGATIVE part (a crop drowning in a flood it cannot drain) is physiology and applies at every technique, unchanged. Implemented as one per-cell, per-package factor `1 + technique · gain` with `gain = Σ_m gainful / Σ_m fitted − 1` measured over the same admitted months, so technique-1 capacity is bit-for-bit W14's and technique-0 capacity is bit-for-bit the un-paddied one; only 0 and 1 appear as literals and no constant is introduced. Both kernels; the Rust package capacity carries the same factor and parity holds |
| `standingWaterResponse` (data) | **unchanged**: rice 1.0; New Guinea roots 0.33; every other package −0.35 | the values stand; W15 changes when they apply, not what they are. The data file and `v2/data/reality/README.md` now say that Setter & Waters 2003 is a cereal number measured under managed flooding, which is why the loss is physiology and the gain is not |
| unchanged | — | every bell, every lag, `PEOPLE_CHANNEL_STRIP_KM`, every access weight, the month admission, the quantile map and its 0.02 floor, the worldgen's runoff floor, both mobilities, the adoption rate, the flood-presence and stream terms. Nothing was lifted (second cardinal rule) |
| (measured, husbandry, substrate only, target grid 1800 × 900) | — | `fit / gain / capacity at technique 0 / at technique 1`, rice unless named: Yangtze 0.216 / 0.000 / 0.80 / 3.74; Ganges 0.523 / 0.473 / 5.92 / 40.67; Godavari 0.583 / 0.255 / 6.44 / 37.71; Bengal 0.610 / 0.469 / 5.35 / 36.70; Sichuan 0.317 / 0.486 / 1.50 / 10.41; Mekong 0.979 / 0.480 / 2.95 / 20.35; Levant wheat 0.186 / 0.000 / 0.26 / 1.23; Nile wheat 0.041 / 0.000 / 0.03 / 0.15; Indus wheat 0.376 / 0.000 / 1.83 / 8.55. **Every wheat gain is zero** — the flood months fall outside its warm months, so the split costs the rain-fed cereals nothing. 81,337 land cells carry a rice paddy gain, mean 0.367, max 0.819. By the construction's own identity (W14 capacity at technique 0 = (1 + gain) × W15's), W14 was crediting an un-farmed floodplain with up to 82 % more capacity than any un-farmed ground can deliver: the Ganges 8.72 against 5.92, Bengal 7.86 against 5.35, the Mekong 4.37 against 2.95 |
| (measured, wind reference, substrate only, target grid) | — | windward-minus-lee share contrast, W14 → W15: the Alps −0.006 → **+0.080**; the Himalaya +0.426 → **+0.474**; the Western Ghats −0.019 → **+0.013**; the Andes +0.039 → **+0.178**; the Southern Alps of New Zealand −0.148 → **−0.033**; the Alborz −0.674 → **−0.535**; the Cascades −0.083 → −0.164; the Zagros +0.107 → −0.078. **Six of eight ranges improve**, and the two that do not are recorded below, not dialed. Conservation holds: share over 558,091 land cells p1 0.711, p50 1.000, p99 1.327, max 2.881, mean 0.9981 (W14: p1 0.764, p50 0.999, p99 1.279, max 3.089). Mean absolute annual-moisture change against the un-corrected substrate 0.0086 → 0.0100; cells moved by more than 0.02, 12.3 % → 13.8 % |
| (finding, recorded not dialed) | — | the Cascades and the Zagros move the WRONG way, and the Alborz is still negative. One nameable cause covers all three: a 1.9° MONTHLY CLIMATOLOGICAL MEAN wind averages away the barrier-normal component of a flow that reverses within the month, so at a 60–90 km lookback the model reads the along-range residual and picks the wrong upwind cell. The remedy is finer or higher-moment wind data, not a coefficient — a constant tuned to turn the Cascades around would be a fitted outcome. The Alborz miss pre-exists W15 (share 0.329 there under W14) and W15 halves the contrast error rather than creating it. Recorded in QUESTIONS #68 |

## W17 — implemented (2026-09-06)

One new constant and one new data column. The mechanism is a NORMALISATION
split: the same twelve monthly grades, divided by the year for the wild stand
and by the crop's own cycle for the harvest.

| Constant | Value | Unit / grounding |
|---|---:|---|
| `MEAN_DAYS_PER_MONTH` | 30.436875 | days; the Gregorian mean year (365.2425 d) over twelve. A pure unit conversion, so that a cycle quoted in days by the agronomy can be read as a count of the climate's months. It has no free parameter and nothing was tried against a row |
| `cycleDays` (data, `crop-packages.json`) | wheat 120; rice 150; maize 125; sorghum 130; millet 105; tubers 210; highland roots 1460; New Guinea roots 210; eastern seeds 90 | days from sowing to harvest — how long the crop occupies the ground. FAO-56 Table 11, *lengths of crop development stages*, total growing period (Allen, Pereira, Raes & Smith 1998, *Crop Evapotranspiration*, FAO Irrigation and Drainage Paper 56): Barley/Oats/Wheat 120 (Central India, Nov), Rice 150 (tropics, Mediterranean), Maize grain 125 (humid Nigeria, dry-cool India), Sorghum 130 (USA, Pakistan, Mediterranean), Millet 105 (Pakistan, June), Cassava year 1 210 (rainy tropics), Squash/Zucchini 90 (Mediterranean and Europe, May/June). Enset (1460 d, the low end of four-to-eight years to harvest maturity — Brandt et al. 1997, *The Tree Against Hunger*) and the New Guinea roots (210 d: greater yam 7–10 months, dryland taro 7–9 — Bourke & Harwood 2009, *Food and Agriculture in Papua New Guinea*, ch. 5) are not in that table and come from the crops' own literature. **The sourcing rule is stated so it can be audited: the SHORTEST period listed for the package's own crops.** The reason is structural, not a preference for an outcome — the sim's month-admission test (W13) already drops the months a crop cannot use, so a longer regional figure, long precisely because of overwintering or cold dormancy, would count those dropped months a second time inside the window. The sensitivity to the one row where that choice bites is measured below |
| (cycle in months) | derived: `min(cycleDays / 30.436875, 12)` | wheat 3.94, rice 4.93, maize 4.11, sorghum 4.27, millet 3.45, tubers 6.90, highland roots 12.00, New Guinea roots 6.90, eastern seeds 2.96. The clamp is the mechanism, not an exception for root crops: a crop that stands in the ground longer than a year experiences the whole year, and at twelve months the window below reduces EXACTLY to the pre-W17 `Σ/12`, so the perennial is unmoved by the change rather than special-cased out of it |
| (harvest fit — **supersedes W8/W13/W14/W15's single fit**) | derived: `(Σ monthFit over the best run of the cycle, wrapping the year) / cycleMonths`, the run chosen to maximise `Σ (monthFit + monthGain)` | the best planting date. A farmer sows once and reaps once, so what sets the harvest is the weather of the months the crop is IN THE GROUND; the months outside its cycle are not part of it. Months inside the run that the crop cannot use contribute zero, so a season shorter than the cycle degrades the harvest in proportion rather than forbidding it — there is no cliff at a whole number of months, and the fractional part of the cycle weights the last month (3.94 months counts the fourth at 0.94). The run wraps the turn of the year because a winter cereal is sown in one year and reaped in the next. Bounded above by the best single month, so the fit's range is unchanged. The run is chosen by the WHOLE harvest the worked field yields — its fit and its paddy gain together — because that is what a planting date is chosen for; see the gain row below. One consequence is worth naming, because it is a change to W14 and not only to W8: a crop can now be sown AROUND a flood it cannot drain, so the drowning loss is charged only where the season leaves no room to avoid it. That is most of why the Nile's wheat doubles below |
| (stand fit — **unchanged**, `Σ/12`) | derived: `Σ monthFit over the admitted months / 12` | W10's finding stands and is the reason the split exists rather than a replacement. A wild stand is GRAZED, not reaped: gatherers take from it whenever it is giving, so what feeds them is the total favourable growing time over the year, and eight good months feed more than five. Grading the stand over its qualifying months alone scored a short Siberian summer as highly as a long Chinese one and put millet's richest ground on the west Siberian plain. The two readers ask opposite questions of the same twelve numbers |
| (paddy gain) | derived over the SAME window as the fit | `gain = Σ_window monthGain / Σ_window monthFit`, so W15's identity holds unchanged: capacity at technique 1 is exactly the fit the flooded months earn and at technique 0 exactly the unwatered one. Measuring the gain over a different run of months from the fit would leave the two failing to divide out. The run is selected on `fit + gain`, not on fit alone, and that is not a refinement — it is what keeps W15 alive. W15 deliberately holds a wetland crop's POSITIVE response outside the fit (the paddy is husbandry, paid out with technique), so rice's monthly fit is identical wet and dry; a fit-only search therefore ties across the flood, takes the first run it sees, and leaves the gain outside it. The mechanism would have been disabled by its own normalisation. An upland crop's gain is identically zero, so its planting date is still set by fit alone and nothing about it moves; only a wetland crop shifts its date onto the flood, which is what a paddy is. Measured: on the dev substrate the selection rule is worth 1,828.6M against 1,829.8M of world best-package capacity at technique 1 (+0.07 %). It is small only because a monsoon flood already falls inside the season a wetland crop would have chosen anyway; on ground where the flood and the best months part company, a fit-only search loses the paddy entirely, which is what the flooded unit fixture measures (1 + 1.5 · response / cycleMonths, against 1 with the paddy dropped) |
| unchanged | — | every bell, `seasonMinimumMonths` and the can-grow test, `standingWaterResponse`, every access weight, the month admission, both mobilities, the adoption rate, the wild ranges and their envelopes. No Rust change: `_cropFit` is a precomputed input to the kernel, so parity is structural |
| (measured, substrate only, dev grid, no history) | — | best package by summed capacity at technique 1 over the 3° staple boxes, before → after: **south China New Guinea roots → RICE** (9.25M against tubers 7.99M), **the lower Yangtze New Guinea roots → RICE** (14.61M against the roots' 12.85M), the Ganges rice → rice (6.53 → 8.68M, and rice now leads at the box centre too), central Europe wheat → wheat (4.02 → 5.78M), the Nile sorghum → sorghum with **wheat second** (0.45M, from below third), the Indus sorghum → sorghum with **wheat third** (1.66M, from below third), the Sahel rice → rice at the box and **sorghum first at the centre** (0.384 → 0.678), the loess highland roots → maize with millet third, Mesoamerica New Guinea roots → the roots, the Amazon margin rice → rice. Centre-cell yield × fit × (1 + gain) at technique 1, before → after: Cairo/Nile wheat 0.187 → 0.384, Luxor-latitude sorghum 0.257 → 0.332, south China rice 0.665 → 0.990, the lower Yangtze rice 0.376 → 0.787, central Europe wheat 0.367 → 0.616 |
| (measured, blast radius, dev grid) | — | 2,828 of 6,529 farmable cells change best package (43.3 %); with the one perennial dropped from the ranking, 1,619 of 6,121 (26.4 %). **1,749 of the 2,828 are the perennial losing the top slot** — the mechanism working, not a side effect: an annual is graded on the months it chooses, a perennial on the whole year it must stand through. World best-package capacity at technique 1 × 1.260 |
| (finding, recorded not dialed — the multi-cropping asymmetry) | — | that ×1.260 is not uniform, and the shape is the mechanism's own gap. By absolute latitude band: 0–15° **× 1.086**, 15–30° × 1.250, 30–45° × 1.556, 45–60° × 1.682, 60–90° **× 1.997** (mean season of the best package 11.8, 11.2, 8.5, 7.5, 5.4 months). The window credits a SHORT season with one whole harvest, which is right, but it does not credit a LONG season with the several harvests it can actually take — the pre-W17 `Σ/12` was an uncapped multi-cropping model with every cycle implicitly twelve months, and W17 replaces it with exactly one harvest everywhere. The truth is between the two and is `min(season / cycle, what a field can carry in a year)`. That cap is a datum this repo does not have and would decide the answer, so it is proposed (DECISIONS P20) and NOT invented here — the same discipline that kept `cycleDays` unbuilt until it was looked up. QUESTIONS #71 |
| (measured, the wheat row's sensitivity) | — | the alternative reading of the wheat row is FAO-56's own *Winter Wheat* line, 180/240/335 d, and it is recorded because the rule chosen happens to favour the outcome wanted. At 240 d, on the dev substrate: **every rice result is bit-for-bit unchanged** (south China, the lower Yangtze and the Ganges do not depend on the wheat row at all), while wheat falls from 0.616 to 0.513 in central Europe (still first at the centre, but tied at the box), from 0.384 to 0.284 at the Nile (third at the box instead of second) and from 0.414 to 0.343 at the Indus (out of the box's top three). So the choice moves the three WHEAT rows and nothing else. The 240 d reading also double-charges the crop it describes: winter wheat is long because it overwinters, and those dormant months are exactly the ones the admission test has already dropped, so they enter the window as zeros. The structural argument and the outcome point the same way here; both are recorded so a later reader can weigh them |
| (measured, dev solve arm, the per-commit gate) | — | **four acknowledged misses cleared**: `staple:south-china:solve:dev` (millet → rice), `staple:lower-yangtze:solve:dev` (millet → rice), `staple:mesoamerica:solve:dev` (eastern seeds → maize) and `arrival:nile:solve:dev` (−3099, LATE and out of window, → −6620, in window). The staple table goes 5/10 to 8/10. **One new miss**: `hearth-outside:millet:solve:dev`, millet lighting at 45.8°N 77.3°E in −4625 — the same spread-not-rank problem already acknowledged at the shipped grid, now reachable at dev because the world carries more people. `staple:indus:solve:dev` changes incumbent (rice → millet) and stays a miss; `staple:nile:solve:dev` stays sorghum. The acknowledged population rows worsen with the capacity: −5000 69.1 → 98.7M, −3000 603 → 773M, −1000 1,074 → 1,391M, 1 CE 1,160 → 1,503M, which is the multi-cropping asymmetry above arriving in the curve and is owned by it and by M3b's missing mortality, not dialed. The front 1.420 → 1.447 km/yr; river density 20.2 → 24.1 and rainfed 11.6 → 14.5 persons/km², ordering preserved |

## W18 — implemented (2026-09-06)

No new constant in `src/sim/constants.ts`. One new substrate field
(`straitWidthKm`), five new data values beside the strait paths they belong
to in `src/ported/worldgen/worldgen.js`, and one line of arithmetic in
`src/sim/people/neighbors.ts`. The mechanism is a **raster-error record**:
the hand carve that opens a sub-pixel channel is the only place that knows
the raster is lying about a piece of water, so it writes down what it knows,
and the consumer charges the water instead of the cell.

| Constant | Value | Unit / grounding |
|---|---:|---|
| `widthKm` (data, `EARTH_STRAITS` in `worldgen.js`) | Gibraltar 13; Dardanelles→Marmara→Bosporus 1.2; Malacca→Singapore 2.8; Messina 3.1; Magellan 3 | km; the channel's **minimum** width — the narrows, which is where a crossing is actually made. Gibraltar 13 km at Point Marroquí (ES) to Point Cires (MA); the Dardanelles 1.2 km abreast Çanakkale; the Malacca/Singapore waterway 2.8 km at the Phillip Channel; Messina 3.1 km at Punta del Faro (Sicily) to Punta Pezzo (Calabria); Magellan 3 km at the Primera Angostura. **The sourcing rule is stated so it can be audited: where a row traces a CHAIN of channels it carries the LARGEST of their minima**, so the figure bounds the crossing whichever channel on the chain is taken — the Turkish Straits row therefore carries the Dardanelles' 1.2 km and not the Bosporus' 0.7 km. These are coastline data of the same kind as the paths themselves, which is why they live beside them rather than in `constants.ts` |
| `straitWidthKm` (substrate field) | derived: the width of every land cell the carve OPENS; 0 elsewhere; a whole zero field on any preset that does not carve | km. **The field is exactly the carve's own deviation from the DEM.** A cell the raster resolves as water by itself is never marked, so the term cannot reach into a real sea, and a finer raster carves less and records less: the field empties itself as the grid improves, which is what a correction for a KNOWN raster failure should do (third cardinal rule). Where two channels cross one cell the narrower governs, because that is the crossing a traveller would take |
| (step length — **supersedes the lattice edge inside a carved cell only**) | derived: `stepKm(a,b) = channel > 0 ? min(edge, channel) : edge`, `channel = max(width[a], width[b])` | km per step of the coastal-hop walk in `people/neighbors.ts`. A step into or out of a cell the carve opened crosses the CHANNEL — a kilometre or two — not a whole cell edge of open sea. A run of k carved cells is charged k+1 crossings, which **over-charges** the one real crossing, so the term can refuse a hop but never invent one; and any step touching no carved cell keeps `edgeLengthKm` exactly, so genuine open water in the same hop is still priced at the lattice. No place name appears in the mechanism: it asks whether the carve opened this cell, never whether this is the Bosporus |
| unchanged | — | `PEOPLE_COASTAL_HOP_KM` (100 km, W7) and every other constant; the elevation the carve writes is byte-identical (the width write sits inside the same `elevation[i] > 0` guard, and the recorder is an optional argument the v1 call site does not pass, so the worldgen oracle's byte-exact arm is untouched); every fit, bell, capacity and rate; both mobilities. No Rust change: the neighbour table is built in TS and handed to the kernel, so parity is structural |
| (measured, substrate only, both grids, no history) | — | **dev 240×120** (cell ~131 km E-W at 40°N, 166.7 N-S): 11 carved cells — 1.2 km ×4 (the Dardanelles/Marmara line at 39.8°N), 3 km ×4 (Magellan), 3.1 ×1 (Messina), 2.8 ×2 (Malacca); **Gibraltar is not carved at dev**, the raster already reads that mouth as water. Hops clearing the 100 km bar through a carved channel: **0 → 2** — Thrace↔Anatolia (41.3°N 27.7°E → 38.3°N 27.7°E, 333 km → 2.4 km) and Magellan (385 km → 6.0 km). **target 1800×900** (cell ~17.2 km E-W at 40°N, 22.2 N-S): 78 carved cells (1.2 ×24, 3 ×37, 2.8 ×13, 3.1 ×3, 13 ×1 — Gibraltar, one cell). Hops clearing the bar: **68 → 86**, all 18 new ones at the Dardanelles/Marmara, Malacca or Magellan; Gibraltar gains none, that crossing already cleared at 17 km cells. **No leakage into open ocean at either grid**, and the Malacca rows show why: `2.5°N 102.3°E → 1.3°N 102.3°E` goes 133 km → **94.5 km**, not to 5.6 km, because one carved cell was re-priced and the several cells of genuine open water in the same hop were charged in full |
| (measured, dev solve arm, the per-commit gate) | — | **three acknowledged misses cleared and their manifest rows deleted**: `arrival:balkans:solve:dev` (−5080 → **−6634**, in window), `arrival:rhine:solve:dev` (−3981 → **−5164**, in window), `arrival:cardial-coast:solve:dev` (−4436 → **−5871**, in window). Central Europe −4317 → −5528 and inland Europe −4555 → −5857, both comfortably inside. **`europe-front-speed:solve:dev` 1.447 → 1.082 km/yr — inside the 0.6–1.3 radiocarbon band (Pinhasi, Fort & Ammerman 2005) at the reference grid for the first time**, and its row was deleted too; the gate cannot flag that row stale by itself, because it only adds the id to `measured` when it fails. The speed FALLS while the arrivals come 1,200–1,550 years earlier, and that is the mechanism rather than a coincidence: the front used to reach the Balkans late, by an already-mature population walking the long way round the Black Sea, and then race west; it now enters Europe early and young, across the Dardanelles, and advances at the diffusion speed the constants name. Population: −5000 98.7 → 116.7M, −3000 773.1 → 805.2M, −1000 1,391 → 1,391.6M, 1 CE 1,503 → 1,503.0M — the last two unchanged, because an earlier Europe changes WHEN the curve fills, not the M3b ceiling it fills to; −8000 stays in band at 13.2M. Density ordering 24.09 → 24.08 (river) and 14.53 → 14.52 (rain-fed), preserved. The staple table is unchanged at 8/10, every hearth row is unchanged, the Sahel is 14 years later and the Ganges 7 earlier (two strides and one, on routes no carved channel touches), and Japan is still not reached at dev — the Korea Strait is two genuine ~50 km open-water legs around an island smaller than a dev cell, not a carved channel, so W18 does not and should not move it |
| (known imprecision, recorded not papered over) | — | the Turkish Straits row traces a chain that includes the **Sea of Marmara**, which falls below the enclosed-sea bar and reads as land at every grid, so the carve opens it and W18 prices those cells at the chain's 1.2 km too. The Thrace↔Anatolia crossing this produces IS a real 1.2 km crossing at either end of the chain, so the outcome is right; but a route that in reality traverses ~70 km of open Marmara is charged the narrows instead. The fix is not a constant — it is for the enclosed-sea bar to admit the Marmara as the sea it is, at which point the carve stops opening it and the term stops applying. QUESTIONS #72 |

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

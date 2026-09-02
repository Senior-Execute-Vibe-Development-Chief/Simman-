// M0 constants ledger. Every value here has a grounding row in
// spec/09-constants-ledger.md; implementation-only coefficients are explicitly
// kept separate from simulation physics until the M1 design supplies their
// physical units.

// Grid dimensions follow the documented v1/v2 simulation-width conventions.
// The exact height and preset naming remain logged in QUESTIONS.md.
export const DEV_GRID_WIDTH = 240; // spec/09-constants-ledger.md §Units — M0 grid convention
export const DEV_GRID_HEIGHT = 120; // spec/09-constants-ledger.md §Units — M0 grid convention
export const TARGET_GRID_WIDTH = 1800; // spec/09-constants-ledger.md §M1 proposed — target grid convention
export const TARGET_GRID_HEIGHT = 900; // spec/09-constants-ledger.md §M1 proposed — target grid convention

// Deterministic-math coefficients. These are numerical implementation details,
// not mechanisms; their precision contract is recorded for the M0 bench.
export const MATH_PI = 3.141592653589793; // spec/09-constants-ledger.md §Units — M0 deterministic math contract
export const MATH_LN2 = 0.6931471805599453; // spec/09-constants-ledger.md §Units — M0 deterministic math contract
export const MATH_INV_LN2 = 1.4426950408889634; // spec/09-constants-ledger.md §Units — M0 deterministic math contract
export const MATH_SIN_C3 = 1 / 6; // spec/09-constants-ledger.md §Units — M0 deterministic math contract
export const MATH_SIN_C5 = 1 / 120; // spec/09-constants-ledger.md §Units — M0 deterministic math contract
export const MATH_SIN_C7 = 1 / 5040; // spec/09-constants-ledger.md §Units — M0 deterministic math contract
export const MATH_SIN_C9 = 1 / 362880; // spec/09-constants-ledger.md §Units — M0 deterministic math contract
export const MATH_SIN_C11 = 1 / 39916800; // spec/09-constants-ledger.md §Units — M0 deterministic math contract
export const MATH_SIN_C13 = 1 / 6227020800; // spec/09-constants-ledger.md §Units — M0 deterministic math contract
export const MATH_SIN_C15 = 1 / 1307674368000; // spec/09-constants-ledger.md §Units — M0 deterministic math contract
export const MATH_SIN_C17 = 1 / 355687428096000; // spec/09-constants-ledger.md §Units — M0 deterministic math contract
export const MATH_COS_C2 = 1 / 2; // spec/09-constants-ledger.md §Units — M0 deterministic math contract
export const MATH_COS_C4 = 1 / 24; // spec/09-constants-ledger.md §Units — M0 deterministic math contract
export const MATH_COS_C6 = 1 / 720; // spec/09-constants-ledger.md §Units — M0 deterministic math contract
export const MATH_COS_C8 = 1 / 40320; // spec/09-constants-ledger.md §Units — M0 deterministic math contract
export const MATH_COS_C10 = 1 / 3628800; // spec/09-constants-ledger.md §Units — M0 deterministic math contract
export const MATH_COS_C12 = 1 / 479001600; // spec/09-constants-ledger.md §Units — M0 deterministic math contract
export const MATH_COS_C14 = 1 / 87178291200; // spec/09-constants-ledger.md §Units — M0 deterministic math contract
export const MATH_COS_C16 = 1 / 20922789888000; // spec/09-constants-ledger.md §Units — M0 deterministic math contract
export const MATH_EXP_C2 = 1 / 2; // spec/09-constants-ledger.md §Units — M0 deterministic math contract
export const MATH_EXP_C3 = 1 / 6; // spec/09-constants-ledger.md §Units — M0 deterministic math contract
export const MATH_EXP_C4 = 1 / 24; // spec/09-constants-ledger.md §Units — M0 deterministic math contract
export const MATH_EXP_C5 = 1 / 120; // spec/09-constants-ledger.md §Units — M0 deterministic math contract
export const MATH_EXP_C6 = 1 / 720; // spec/09-constants-ledger.md §Units — M0 deterministic math contract
export const MATH_EXP_C7 = 1 / 5040; // spec/09-constants-ledger.md §Units — M0 deterministic math contract
export const MATH_EXP_C8 = 1 / 40320; // spec/09-constants-ledger.md §Units — M0 deterministic math contract
export const MATH_EXP_C9 = 1 / 362880; // spec/09-constants-ledger.md §Units — M0 deterministic math contract
export const MATH_EXP_C10 = 1 / 3628800; // spec/09-constants-ledger.md §Units — M0 deterministic math contract
export const MATH_EXP_C11 = 1 / 39916800; // spec/09-constants-ledger.md §Units — M0 deterministic math contract
export const MATH_LN_FIRST_ODD = 3; // spec/09-constants-ledger.md §Units — M0 deterministic math contract
export const MATH_LN_STEP = 2; // spec/09-constants-ledger.md §Units — M0 deterministic math contract
export const MATH_LN_LAST_ODD = 23; // spec/09-constants-ledger.md §Units — M0 deterministic math contract
export const MATH_ATAN_FIRST_ODD = 3; // spec/09-constants-ledger.md §Units — M0 deterministic math contract
export const MATH_ATAN_LAST_ODD = 23; // spec/09-constants-ledger.md §Units — M0 deterministic math contract
export const MATH_ATAN_STEP = 2; // spec/09-constants-ledger.md §Units — M0 deterministic math contract
export const MATH_TAN_EIGHTH_PI = 0.41421356237309503; // spec/09-constants-ledger.md §Units — M0 deterministic math contract (tan(π/8), atan range reduction)
export const MATH_EXP_MAX = 709; // spec/09-constants-ledger.md §Units — M0 deterministic math contract
export const MATH_EXP_MIN = -745; // spec/09-constants-ledger.md §Units — M0 deterministic math contract
export const MATH_HALF = 0.5; // spec/09-constants-ledger.md §Units — M0 deterministic math contract
export const MATH_THREE = 3; // spec/09-constants-ledger.md §Units — M0 deterministic math contract
export const MATH_FOUR = 4; // spec/09-constants-ledger.md §Units — M0 deterministic math contract
export const MATH_NEGATIVE_ONE = -1; // spec/09-constants-ledger.md §Units — M0 deterministic math contract
export const MATH_NEGATIVE_TWO = -2; // spec/09-constants-ledger.md §Units — M0 deterministic math contract

export const CONSERVATION_EPSILON = 1e-10; // spec/09-constants-ledger.md §Units — M0 conservation assertion
export const M0_DETERMINISM_TICKS = 500; // spec/09-constants-ledger.md §Units — M0 smoke horizon
export const M0_DEFAULT_SEED = 42042; // spec/09-constants-ledger.md §Units — M0 smoke seed
export const HASH_NUMBER_BYTES = 8; // spec/09-constants-ledger.md §Units — M0 world identity hash

// FNV-1a 64-bit-ish world hash parameters.
export const HASH_OFFSET_BASIS = 14695981039346656037n; // spec/09-constants-ledger.md §Units — M0 world identity hash
export const HASH_PRIME = 1099511628211n; // spec/09-constants-ledger.md §Units — M0 world identity hash
export const HASH_MASK = 18446744073709551615n; // spec/09-constants-ledger.md §Units — M0 world identity hash
export const HASH_HEX_WIDTH = 16; // spec/09-constants-ledger.md §Units — M0 world identity hash
export const HASH_RADIX = 16; // spec/09-constants-ledger.md §Units — M0 world identity hash
export const BASE64_CHUNK_SIZE = 32768; // spec/09-constants-ledger.md §Units — M0 persistence envelope

// Byte-compatible sfc32/splitmix32 port parameters.
export const UINT32_BASE = 4294967296; // spec/09-constants-ledger.md §Units — M0 RNG compatibility
export const FNV32_OFFSET = 0x811c9dc5; // spec/09-constants-ledger.md §Units — M0 RNG compatibility
export const FNV32_PRIME = 0x01000193; // spec/09-constants-ledger.md §Units — M0 RNG compatibility
export const SPLITMIX_INCREMENT = 0x9e3779b9; // spec/09-constants-ledger.md §Units — M0 RNG compatibility
export const SPLITMIX_MULTIPLIER_A = 0x21f0aaad; // spec/09-constants-ledger.md §Units — M0 RNG compatibility
export const SPLITMIX_MULTIPLIER_B = 0x735a2d97; // spec/09-constants-ledger.md §Units — M0 RNG compatibility
export const RNG_SHIFT_A = 9; // spec/09-constants-ledger.md §Units — M0 RNG compatibility
export const RNG_SHIFT_B = 21; // spec/09-constants-ledger.md §Units — M0 RNG compatibility
export const RNG_SHIFT_C = 11; // spec/09-constants-ledger.md §Units — M0 RNG compatibility
export const RNG_SHIFT_D = 3; // spec/09-constants-ledger.md §Units — M0 RNG compatibility
export const SPLITMIX_SHIFT_A = 16; // spec/09-constants-ledger.md §Units — M0 RNG compatibility
export const SPLITMIX_SHIFT_B = 15; // spec/09-constants-ledger.md §Units — M0 RNG compatibility
export const BYTE_MASK = 0xff; // spec/09-constants-ledger.md §Units — M0 RNG compatibility
export const BYTE_SHIFT = 8; // spec/09-constants-ledger.md §Units — M0 RNG compatibility
export const BYTE_SHIFT_2 = 16; // spec/09-constants-ledger.md §Units — M0 RNG compatibility
export const BYTE_SHIFT_3 = 24; // spec/09-constants-ledger.md §Units — M0 RNG compatibility

// M1 calendar and real-unit travel constants. Proposed rows are appended to
// spec/09-constants-ledger.md by the M1 change.
export const MONTHS_PER_YEAR = 12; // spec/09-constants-ledger.md §M1 proposed — monthly climate cadence
export const EARTH_CIRCUMFERENCE_KM = 40075; // spec/09-constants-ledger.md §M1 proposed — Earth geodesy
export const EARTH_MERIDIONAL_KM = 20004; // spec/09-constants-ledger.md §M1 proposed — Earth geodesy
export const EARTH_DEGREES = 360; // spec/09-constants-ledger.md §M1 proposed — Earth geodesy
export const EARTH_HALF_DEGREES = 180; // spec/09-constants-ledger.md §M1 proposed — Earth geodesy
export const DEG_TO_RAD = 0.017453292519943295; // spec/09-constants-ledger.md §M1 proposed — Earth geodesy
export const TRAVEL_FOOT_KM_PER_DAY = 25; // spec/09-constants-ledger.md §Travel & freight — FOOT_DAY
export const TRAVEL_PACK_KM_PER_DAY = 35; // spec/09-constants-ledger.md §Travel & freight — RIDE_DAY
export const TRAVEL_CART_KM_PER_DAY = 30; // spec/09-constants-ledger.md §M1 proposed — cart speed
export const TRAVEL_RIVER_KM_PER_DAY = 45; // spec/09-constants-ledger.md §M1 proposed — river craft speed
export const TRAVEL_COASTAL_KM_PER_DAY = 80; // spec/09-constants-ledger.md §M1 proposed — coastal sail speed
export const TRAVEL_OPEN_SEA_KM_PER_DAY = 120; // spec/09-constants-ledger.md §M1 proposed — open-sea sail speed
export const TRAVEL_COASTAL_BAND_KM = 150; // spec/09-constants-ledger.md §M1 proposed — coastal sailing band
export const TRAVEL_RIVER_MIN_MAGNITUDE = 2; // spec/09-constants-ledger.md §M1 proposed — navigable river bar
export const RIVER_FREEZING_TEMPERATURE = 0.6; // spec/09-constants-ledger.md §W1 proposed — freshwater freezing point
export const RIVER_BASEFLOW_FRACTION = 0.65; // spec/09-constants-ledger.md §W1 proposed — groundwater-fed annual flow share
// Navigability is about FALL, not just flow: boats die in rapids. Commercial
// navigation historically holds below ~0.5 m/km; skilled small craft manage
// a bit more; mountain torrents (tens of m/km) are portage country.
export const TRAVEL_RIVER_NAVIGABLE_GRADIENT_M_PER_KM = 1.5; // spec/09-constants-ledger.md §M1 proposed — downstream (raftable) gradient bar
// Floating down and hauling up are different physics: towing/poling
// upstream died on anything beyond canal-grade water, well below what a
// raft could run down.
export const TRAVEL_RIVER_UPSTREAM_GRADIENT_M_PER_KM = 0.5; // spec/09-constants-ledger.md §M1 proposed — upstream (towing) gradient bar
// Navigability is a property of a REACH, not a cell edge: the DEM stores
// elevation in ~37 m quantization steps, so a single-edge gradient reads up
// to ~1.7 m/km of pure noise at the shipped grid. Falls are measured along
// the river's own course over this baseline instead.
export const TRAVEL_RIVER_GRADIENT_BASELINE_KM = 100; // spec/09-constants-ledger.md §M1 proposed — reach-scale gradient baseline
export const TRAVEL_RIVER_GRADIENT_MAX_STEPS = 64; // spec/09-constants-ledger.md §M1 proposed — reach-walk guard
export const TRAVEL_RIVER_GRADIENT_UNMEASURED = -1; // spec/09-constants-ledger.md §M1 proposed — sentinel: no baked reach-gradient sample at this cell
export const ELEVATION_METERS_PER_UNIT = 9400; // spec/09-constants-ledger.md §M1 proposed — elevation scale (Tibetan-plateau anchor, realClimateData)
export const TRAVEL_MODE_COUNT = 6; // spec/09-constants-ledger.md §M1 proposed — layered routing representation
export const TRAVEL_TRANSFER_DAYS = 0.25; // spec/09-constants-ledger.md §M1 proposed — intermodal transfer
export const TRAVEL_BASE_TERRAIN = 1; // spec/09-constants-ledger.md §M1 proposed — neutral terrain factor
export const TRAVEL_RIVER_DOWNSTREAM_FACTOR = 0.6; // spec/09-constants-ledger.md §M1 proposed — directed river cost
export const TRAVEL_RIVER_UPSTREAM_FACTOR = 1.4; // spec/09-constants-ledger.md §M1 proposed — directed river cost
export const TRAVEL_COST_FREIGHT_LAND = 28; // spec/09-constants-ledger.md §Travel & freight — freight ratio
export const TRAVEL_COST_FREIGHT_RIVER = 5; // spec/09-constants-ledger.md §Travel & freight — freight ratio
export const TRAVEL_COST_FREIGHT_SEA = 1; // spec/09-constants-ledger.md §Travel & freight — freight ratio
export const TRAVEL_CACHE_LIMIT = 4; // spec/09-constants-ledger.md §M1 proposed — customized metric cache
export const TRAVEL_ORBIS_TOLERANCE = 0.25; // spec/09-constants-ledger.md §Travel & freight — ORBIS gate tolerance
export const TRAVEL_MODE_RIVER_INDEX = 3; // spec/09-constants-ledger.md §M1 proposed — layered routing representation
export const TRAVEL_MODE_COASTAL_INDEX = 4; // spec/09-constants-ledger.md §M1 proposed — layered routing representation
export const TRAVEL_MODE_OPEN_SEA_INDEX = 5; // spec/09-constants-ledger.md §M1 proposed — layered routing representation
export const TRAVEL_RELIEF_THRESHOLD = 0.07; // spec/09-constants-ledger.md §M1 proposed — continuous relief cost
export const TRAVEL_ELEVATION_FACTOR = 5; // spec/09-constants-ledger.md §M1 proposed — continuous terrain cost
export const TRAVEL_RELIEF_COST_FACTOR = 4; // spec/09-constants-ledger.md §M1 proposed — continuous terrain cost
export const TRAVEL_SLOPE_COST_FACTOR = 3; // spec/09-constants-ledger.md §M1 proposed — continuous terrain cost
export const TRAVEL_COLD_THRESHOLD = 0.35; // spec/09-constants-ledger.md §M1 proposed — seasonal cold cost
export const TRAVEL_COLD_COST_FACTOR = 2; // spec/09-constants-ledger.md §M1 proposed — seasonal cold cost
export const TRAVEL_MUD_COST_FACTOR = 0.8; // spec/09-constants-ledger.md §M1 proposed — seasonal wet-ground cost
export const TRAVEL_WATERLOG_THRESHOLD = 0.7; // spec/09-constants-ledger.md §M1 proposed — seasonal wet-ground cost
export const TRAVEL_MOISTURE_FLOOR = 0.4; // spec/09-constants-ledger.md §M1 proposed — aridity cost (baseEdgeCost terrain seed)
export const TRAVEL_LAND_MIN_FACTOR = 0.5; // spec/09-constants-ledger.md §M1 proposed — terrain factor floor
export const TRAVEL_COASTAL_MIN_FACTOR = 0.8; // spec/09-constants-ledger.md §M1 proposed — coastal travel factor
export const TRAVEL_SEASONAL_AMPLITUDE = 0.6; // spec/09-constants-ledger.md §M1 proposed — monthly climate cost response
export const TRAVEL_HALF = 0.5; // spec/09-constants-ledger.md §M1 proposed — real-unit averaging
export const TRAVEL_MONTH_PHASE = 0.5235987755982988; // spec/09-constants-ledger.md §M1 proposed — monthly climate phase
// Seawater freezes at about −1.8°C; on the sim scale t = 0.6 + °C/100 that
// is 0.582. A sea cell is closed to sail in any month below it, and closed
// YEAR-ROUND where the annual mean sits below it — multi-year pack ice
// persists wherever the heat budget cannot clear it (why the Northeast
// Passage stayed shut until 1878, emergent from the climate data alone).
export const SEA_FREEZING_TEMPERATURE = 0.582; // spec/09-constants-ledger.md §M1 proposed — seawater freezing point
export const TRAVEL_INFRASTRUCTURE_FACTOR = 1; // spec/09-constants-ledger.md §M1 proposed — neutral infrastructure slot
export const DEFAULT_OCEAN_LEVEL = 0.78; // spec/09-constants-ledger.md §M1 proposed — worldgen substrate configuration
// The monsoon mechanism: sailing time responds to wind ALIGNMENT along the
// route, read from the observed monthly wind field — never from a wetness
// proxy (M1 review: the |moisture−floor| tax penalized all tropical sea
// travel identically in both directions, which is not a monsoon).
export const TRAVEL_WIND_GAIN = 0.4; // spec/09-constants-ledger.md §M1 proposed — sail wind-alignment response
export const TRAVEL_WIND_REF_MS = 8; // spec/09-constants-ledger.md §M1 proposed — full-effect wind speed, m/s
export const GRAIN_FREIGHT_EFOLD_KM = 340; // spec/09-constants-ledger.md §Travel & freight — [CONTESTED] Diocletian land-haul anchor
export const GRAIN_SHED_EQUIVALENCE_SEA_KM = 3000; // spec/09-constants-ledger.md §M1 proposed — Mediterranean crossing reference
export const GRAIN_SHED_MIN_KM = 75; // spec/09-constants-ledger.md §M1 proposed — sea-equivalence land-haul band
export const GRAIN_SHED_MAX_KM = 175; // spec/09-constants-ledger.md §M1 proposed — sea-equivalence land-haul band
export const CLIMATE_MONTHLY_RATIO_MIN = 0.05; // spec/09-constants-ledger.md §M1 proposed — observed monthly rain-ratio clamp
export const CLIMATE_MONTHLY_RATIO_MAX = 3; // spec/09-constants-ledger.md §M1 proposed — observed monthly rain-ratio clamp
export const DEGC_PER_TEMPERATURE_UNIT = 100; // spec/09-constants-ledger.md §M1 proposed — sim temperature scale (t = 0.6 + °C/100)
export const ROUTING_UNREACHABLE_DAYS = 1e300; // spec/09-constants-ledger.md §M1 proposed — router unreachable sentinel
export const ROUTING_FIXTURE_DEV_WIDTH = 12; // spec/09-constants-ledger.md §M1 proposed — routing battery fixture
export const ROUTING_FIXTURE_DEV_HEIGHT = 6; // spec/09-constants-ledger.md §M1 proposed — routing battery fixture
export const ROUTING_FIXTURE_TARGET_WIDTH = 24; // spec/09-constants-ledger.md §M1 proposed — routing battery fixture
export const ROUTING_FIXTURE_TARGET_HEIGHT = 12; // spec/09-constants-ledger.md §M1 proposed — routing battery fixture
export const ROUTING_FIXTURE_WATER_ELEVATION = -0.01; // spec/09-constants-ledger.md §M1 proposed — routing battery fixture
export const ROUTING_FIXTURE_LAND_ELEVATION = 0.01; // spec/09-constants-ledger.md §M1 proposed — routing battery fixture
export const ROUTING_FIXTURE_TEMPERATURE = 0.6; // spec/09-constants-ledger.md §M1 proposed — routing battery fixture
export const ROUTING_FIXTURE_MOISTURE = 0.5; // spec/09-constants-ledger.md §M1 proposed — routing battery fixture
export const ROUTING_FIXTURE_COAST_KM = 25; // spec/09-constants-ledger.md §M1 proposed — routing battery fixture
export const ROUTING_FIXTURE_WIND_MS = 6; // spec/09-constants-ledger.md §M1 proposed — routing battery fixture
export const UINT8_SENTINEL = 255; // spec/09-constants-ledger.md §M1 proposed — routing battery fixture
export const MAX_LAKE_AREA_KM2 = 370000; // spec/09-constants-ledger.md §M1 proposed — physical lake cap
export const ANCESTRY_HOP_FREE_KM = 80; // spec/09-constants-ledger.md §M1 proposed — ancestry coastal hop
export const ANCESTRY_OCEAN_EFOLD_KM = 40; // spec/09-constants-ledger.md §M1 proposed — ancestry ocean barrier
export const LAKE_MOISTURE_RADIUS_KM = 60; // spec/09-constants-ledger.md §M1 proposed — lake moisture footprint
export const VOLCANIC_INFLUENCE_KM = 300; // spec/09-constants-ledger.md §M1 proposed — volcanic soil influence
export const VOLCANIC_FULL_KM = 140; // spec/09-constants-ledger.md §M1 proposed — volcanic soil falloff
export const EARTH_SURFACE_KM2 = 510000000; // spec/09-constants-ledger.md §M1 proposed — grid real-area conversion
export const MINE_SCATTER_RADIUS_KM = 500; // spec/09-constants-ledger.md §M1 proposed — mineral deposit footprint
export const MINE_SCATTER_SMALL_RADIUS_KM = 375; // spec/09-constants-ledger.md §M1 proposed — mineral deposit footprint
export const CARDINAL_NEIGHBOR_COUNT = 4; // spec/09-constants-ledger.md §M1 proposed — grid topology
export const TRAVEL_RIVER_TEST_MAGNITUDE = 3; // spec/09-constants-ledger.md §M1 proposed — routing battery fixture
export const ROUTING_SYMMETRY_EPSILON = 1e-9; // spec/09-constants-ledger.md §M1 proposed — routing battery tolerance

// M2 people constants. These are expressed in real units; density fields are
// persons/km² and the tick is one month. The values are mechanism anchors,
// not targets for a particular historical checkpoint.
export const PEOPLE_R_GROWTH_PER_YEAR = 0.0028; // spec/09-constants-ledger.md §M2 proposed — intrinsic pre-modern growth
export const PEOPLE_FORAGER_CAPACITY_PER_KM2 = 0.12; // spec/09-constants-ledger.md §M2 proposed — mobile forager carrying density
export const PEOPLE_INITIAL_FILL_FRACTION = 0.35; // spec/09-constants-ledger.md §M2 proposed — Younger Dryas opening fill
export const PEOPLE_FARM_CAPACITY_PER_KM2 = 12; // spec/09-constants-ledger.md §M2 proposed — rainfed farming capacity scale
export const PEOPLE_FARM_TECHNIQUE_BASE = 0.45; // spec/09-constants-ledger.md §M2 proposed — farming capacity at first technique
export const PEOPLE_FARM_TECHNIQUE_GAIN = 1.65; // spec/09-constants-ledger.md §M2 proposed — advanced farming capacity gain
export const PEOPLE_WATER_ACCESS_GAIN = 1.4; // spec/09-constants-ledger.md §M2 proposed — water-access capacity lift
export const PEOPLE_RIVER_ACCESS_DIVISOR = 4; // spec/09-constants-ledger.md §M2 proposed — river magnitude normalization
export const PEOPLE_RIVER_ACCESS_WEIGHT = 0.35; // spec/09-constants-ledger.md §M2 proposed — channel access weight
export const PEOPLE_LAKE_ACCESS_WEIGHT = 0.25; // spec/09-constants-ledger.md §M2 proposed — lakeside access weight
export const PEOPLE_FORAGER_FERTILITY_BASE = 0.35; // spec/09-constants-ledger.md §M2 proposed — forager fertility floor
export const PEOPLE_FORAGER_FERTILITY_GAIN = 0.65; // spec/09-constants-ledger.md §M2 proposed — forager fertility response
export const PEOPLE_FLOODPLAIN_ACCESS_WEIGHT = 1.5; // spec/09-constants-ledger.md §M2 proposed — measured floodplain fraction weight
export const PEOPLE_RELIEF_PENALTY = 3; // spec/09-constants-ledger.md §M2 proposed — relief capacity penalty
export const PEOPLE_DISEASE_RATE = 0.35; // spec/09-constants-ledger.md §M2 proposed — climate-state demographic brake
export const PEOPLE_GROWTH_FORAGER_FACTOR = 0.35; // spec/09-constants-ledger.md §People — forager growth regime
export const PEOPLE_GROWTH_TECHNIQUE_GAIN = 1.3; // spec/09-constants-ledger.md §People — farming growth regime
export const PEOPLE_DISEASE_WARMTH_FLOOR = 0.72; // spec/09-constants-ledger.md §M2 proposed — habitability warmth onset
export const PEOPLE_DISEASE_WARMTH_RANGE = 0.1; // spec/09-constants-ledger.md §M2 proposed — habitability warmth ramp
export const PEOPLE_DISEASE_MOISTURE_FLOOR = 0.16; // spec/09-constants-ledger.md §M2 proposed — endemic disease moisture onset
export const PEOPLE_DISEASE_MOISTURE_RANGE = 0.34; // spec/09-constants-ledger.md §M2 proposed — endemic disease moisture ramp
export const PEOPLE_GRAVEYARD_RATE = 0.0014; // spec/09-constants-ledger.md §M2 proposed — density-graded urban excess mortality
export const PEOPLE_GRAVEYARD_DENSITY = 30; // spec/09-constants-ledger.md §M2 proposed — density where urban excess mortality starts
export const PEOPLE_GRAVEYARD_GAMMA = 0.5; // spec/09-constants-ledger.md §People — urban graveyard exponent
export const PEOPLE_CAPACITY_FLOOR_PER_KM2 = 0.001; // spec/09-constants-ledger.md §M2 proposed — numerical density floor
export const PEOPLE_MIGRATION_DIFFUSIVITY_KM2_PER_YEAR = 1200; // spec/09-constants-ledger.md §M2 proposed — pre-modern mobility correction
export const PEOPLE_MIGRATION_MAX_SHARE = 0.5; // spec/09-constants-ledger.md §M2 proposed — explicit diffusion stability bound
export const PEOPLE_MIGRATION_REFERENCE_CELL_KM = EARTH_CIRCUMFERENCE_KM / DEV_GRID_WIDTH; // spec/09-constants-ledger.md §M2 proposed — reference-grid scale
export const PEOPLE_MIGRATION_MAX_SUBSTEPS = 16; // spec/09-constants-ledger.md §M2 proposed — explicit diffusion substep cap
export const PEOPLE_TECHNIQUE_WAVE_KMPY = 1; // spec/09-constants-ledger.md §People — Neolithic wave of advance
export const PEOPLE_TECHNIQUE_PRESENT = 0.01; // spec/09-constants-ledger.md §M2 proposed — reached-technique visibility threshold
export const PEOPLE_TECHNIQUE_CLIMATE_FLOOR = 0.05; // spec/09-constants-ledger.md §M2 proposed — package-envelope spread floor
export const PEOPLE_HEARTH_MIN_SEPARATION_KM = 1000; // spec/09-constants-ledger.md §M2 proposed — independent hearth spacing
export const PEOPLE_HEARTH_BASIN_RADIUS_KM = 500; // spec/09-constants-ledger.md §M2 proposed — peopled-basin maturity radius
export const PEOPLE_HEARTH_MAX_COUNT = 8; // spec/09-constants-ledger.md §People — archaeological independent-origin count
export const PEOPLE_HEARTH_SEARCH_FRACTION = 0.03; // spec/09-constants-ledger.md §M2 proposed — pin snap search window
export const PEOPLE_HEARTH_ELEVATION_SCALE = 0.4; // spec/09-constants-ledger.md §M2 proposed — lowland score scale
export const PEOPLE_HEARTH_SCORE_REFERENCE = 5; // spec/09-constants-ledger.md §M2 proposed — scored-site lag reference
export const PEOPLE_HEARTH_FALLBACK_LAG_YEARS = 900; // spec/09-constants-ledger.md §People — wheat domestication lag anchor
export const PEOPLE_HEARTH_LAG_RANGE_YEARS = 3600; // spec/09-constants-ledger.md §M2 proposed — package-lag fallback range
export const PEOPLE_HEARTH_SCORE_RIVER_GAIN = 1.5; // spec/09-constants-ledger.md §M2 proposed — water-access hearth score
export const PEOPLE_HEARTH_SCORE_FERTILITY_GAIN = 2; // spec/09-constants-ledger.md §M2 proposed — fertile-basin hearth score
export const PEOPLE_HEARTH_SCORE_CIRCUMSCRIPTION_GAIN = 1; // spec/09-constants-ledger.md §M2 proposed — basin enclosure hearth score
export const PEOPLE_HEARTH_SCORE_SEA_PENALTY = 1; // spec/09-constants-ledger.md §M2 proposed — open-ocean hearth penalty
export const PEOPLE_HEARTH_SUITABILITY_FLOOR = 0.15; // spec/09-constants-ledger.md §M2 proposed — viable crop package floor
export const PEOPLE_COHORT_CHILD_FRACTION = 0.35; // spec/09-constants-ledger.md §M2 proposed — opening child cohort share
export const PEOPLE_COHORT_WORKING_FRACTION = 0.6; // spec/09-constants-ledger.md §M2 proposed — opening working cohort share
export const PEOPLE_COHORT_ELDER_FRACTION = 0.05; // spec/09-constants-ledger.md §M2 proposed — opening elder cohort share
export const PEOPLE_CHILD_AGE_YEARS = 15; // spec/09-constants-ledger.md §M2 proposed — child-to-working cohort span
export const PEOPLE_WORKING_AGE_YEARS = 45; // spec/09-constants-ledger.md §M2 proposed — working-to-elder cohort span
export const PEOPLE_CHILD_MORTALITY_FACTOR = 1.2; // spec/09-constants-ledger.md §M2 proposed — cohort mortality weighting
export const PEOPLE_WORKING_MORTALITY_FACTOR = 0.8; // spec/09-constants-ledger.md §M2 proposed — cohort mortality weighting
export const PEOPLE_ELDER_MORTALITY_FACTOR = 2.4; // spec/09-constants-ledger.md §M2 proposed — cohort mortality weighting
export const SAVE_VERSION_M2 = 3; // spec/09-constants-ledger.md §M2 proposed — people-field save format
export const PEOPLE_BAND_COUNT = 16; // spec/09-constants-ledger.md §W2 proposed — fixed grid-derived kernel bands
export const PEOPLE_BROWSER_PARITY_TICKS = 24; // spec/09-constants-ledger.md §W2 proposed — browser people identity sample
export const PEOPLE_BENCH_LONG_YEARS = 1000; // spec/09-constants-ledger.md §W2 proposed — target benchmark horizon
export const PEOPLE_GROWTH_STRIDE_MONTHS = 12; // spec/09-constants-ledger.md §W3 proposed — annual slow-pass cadence
export const CADENCE_TRAJECTORY_POP_TOLERANCE = 0.02; // spec/09-constants-ledger.md §W3 proposed — cadence trajectory gate
export const CADENCE_TRAJECTORY_ARRIVAL_TOLERANCE_YEARS = 25; // spec/09-constants-ledger.md §W3 proposed — cadence arrival gate
export const SAVE_VERSION_W3 = 4; // spec/09-constants-ledger.md §W3 proposed — schedule-aware persistence
export const PEOPLE_WORKER_WAIT_MS = 10000; // spec/09-constants-ledger.md §W3 proposed — band-barrier wait slice
export const PEOPLE_WASM_MEMORY_INITIAL_PAGES = 1024; // spec/09-constants-ledger.md §W3 proposed — shared-memory wasm initial pages
export const PEOPLE_WASM_MEMORY_MAXIMUM_PAGES = 32768; // spec/09-constants-ledger.md §W3 proposed — shared-memory wasm max pages (2 GiB)
export const PEOPLE_THREAD_STACK_BYTES = 1048576; // spec/09-constants-ledger.md §W3 proposed — per-worker wasm shadow stack

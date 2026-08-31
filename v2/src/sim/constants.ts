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
export const MATH_EXP_MAX = 709; // spec/09-constants-ledger.md §Units — M0 deterministic math contract
export const MATH_EXP_MIN = -745; // spec/09-constants-ledger.md §Units — M0 deterministic math contract
export const MATH_HALF = 0.5; // spec/09-constants-ledger.md §Units — M0 deterministic math contract
export const MATH_THREE = 3; // spec/09-constants-ledger.md §Units — M0 deterministic math contract
export const MATH_FOUR = 4; // spec/09-constants-ledger.md §Units — M0 deterministic math contract
export const MATH_NEGATIVE_ONE = -1; // spec/09-constants-ledger.md §Units — M0 deterministic math contract
export const MATH_NEGATIVE_TWO = -2; // spec/09-constants-ledger.md §Units — M0 deterministic math contract

// M0 placeholder tick. These values make the bench observable without
// pretending to be v2 physics; M1 deletes this field and its coefficients.
export const PLACEHOLDER_NOISE_DECAY = 0.99; // spec/09-constants-ledger.md §Units — M0 placeholder harness
export const PLACEHOLDER_NOISE_AMPLITUDE = 0.01; // spec/09-constants-ledger.md §Units — M0 placeholder harness
export const PLACEHOLDER_NOISE_FREQUENCY = 0.0001; // spec/09-constants-ledger.md §Units — M0 placeholder harness
export const PLACEHOLDER_STEP_PHASE = 0.01; // spec/09-constants-ledger.md §Units — M0 placeholder harness
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
export const TRAVEL_MODE_COUNT = 6; // spec/09-constants-ledger.md §M1 proposed — layered routing representation
export const TRAVEL_DIAGONAL_FACTOR = 1.4142135623730951; // spec/09-constants-ledger.md §M1 proposed — grid geometry
export const TRAVEL_TRANSFER_DAYS = 0.25; // spec/09-constants-ledger.md §M1 proposed — intermodal transfer
export const TRAVEL_BASE_TERRAIN = 1; // spec/09-constants-ledger.md §M1 proposed — neutral terrain factor
export const TRAVEL_SLOPE_FACTOR = 3; // spec/09-constants-ledger.md §M1 proposed — continuous slope cost
export const TRAVEL_RELIEF_FACTOR = 4; // spec/09-constants-ledger.md §M1 proposed — relief cost
export const TRAVEL_COLD_FACTOR = 2; // spec/09-constants-ledger.md §M1 proposed — seasonal cold cost
export const TRAVEL_MUD_FACTOR = 0.8; // spec/09-constants-ledger.md §M1 proposed — seasonal wet-ground cost
export const TRAVEL_SEA_STORM_FACTOR = 1.2; // spec/09-constants-ledger.md §M1 proposed — seasonal sea cost
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
export const TRAVEL_MOISTURE_FLOOR = 0.4; // spec/09-constants-ledger.md §M1 proposed — aridity cost
export const TRAVEL_WET_COST_FACTOR = 1.2; // spec/09-constants-ledger.md §M1 proposed — seasonal wet-ground cost
export const TRAVEL_LAND_MIN_FACTOR = 0.5; // spec/09-constants-ledger.md §M1 proposed — terrain factor floor
export const TRAVEL_RIVER_MIN_FACTOR = 0.4; // spec/09-constants-ledger.md §M1 proposed — river travel factor
export const TRAVEL_COASTAL_MIN_FACTOR = 0.8; // spec/09-constants-ledger.md §M1 proposed — coastal travel factor
export const TRAVEL_OPEN_SEA_STORM_FACTOR = 1.2; // spec/09-constants-ledger.md §M1 proposed — seasonal sea cost
export const TRAVEL_SEASONAL_AMPLITUDE = 0.6; // spec/09-constants-ledger.md §M1 proposed — monthly climate cost response
export const TRAVEL_HALF = 0.5; // spec/09-constants-ledger.md §M1 proposed — real-unit averaging
export const TRAVEL_MONTH_PHASE = 0.5235987755982988; // spec/09-constants-ledger.md §M1 proposed — monthly climate phase
export const TRAVEL_COLD_SEA_THRESHOLD = 0.3; // spec/09-constants-ledger.md §M1 proposed — sea ice response
export const TRAVEL_SEA_ICE_FACTOR = 2.5; // spec/09-constants-ledger.md §Travel & freight — SEA_ICE_LATS
export const TRAVEL_INFRASTRUCTURE_FACTOR = 1; // spec/09-constants-ledger.md §M1 proposed — neutral infrastructure slot
export const DEFAULT_OCEAN_LEVEL = 0.78; // spec/09-constants-ledger.md §M1 proposed — worldgen substrate configuration
export const TRAVEL_MONSOON_STORM_FACTOR = 6; // spec/09-constants-ledger.md §M1 proposed — monthly sea-weather response
export const ROUTING_FIXTURE_DEV_WIDTH = 12; // spec/09-constants-ledger.md §M1 proposed — routing battery fixture
export const ROUTING_FIXTURE_DEV_HEIGHT = 6; // spec/09-constants-ledger.md §M1 proposed — routing battery fixture
export const ROUTING_FIXTURE_TARGET_WIDTH = 24; // spec/09-constants-ledger.md §M1 proposed — routing battery fixture
export const ROUTING_FIXTURE_TARGET_HEIGHT = 12; // spec/09-constants-ledger.md §M1 proposed — routing battery fixture
export const ROUTING_FIXTURE_WATER_ELEVATION = -0.01; // spec/09-constants-ledger.md §M1 proposed — routing battery fixture
export const ROUTING_FIXTURE_LAND_ELEVATION = 0.01; // spec/09-constants-ledger.md §M1 proposed — routing battery fixture
export const ROUTING_FIXTURE_TEMPERATURE = 0.6; // spec/09-constants-ledger.md §M1 proposed — routing battery fixture
export const ROUTING_FIXTURE_MOISTURE = 0.5; // spec/09-constants-ledger.md §M1 proposed — routing battery fixture
export const ROUTING_FIXTURE_COAST_KM = 25; // spec/09-constants-ledger.md §M1 proposed — routing battery fixture
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

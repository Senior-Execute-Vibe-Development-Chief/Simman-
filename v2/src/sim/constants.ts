// M0 constants ledger. Every value here has a grounding row in
// spec/09-constants-ledger.md; implementation-only coefficients are explicitly
// kept separate from simulation physics until the M1 design supplies their
// physical units.

// Grid dimensions follow the documented v1/v2 simulation-width conventions.
// The exact height and preset naming remain logged in QUESTIONS.md.
export const DEV_GRID_WIDTH = 240; // spec/09-constants-ledger.md §Units — M0 grid convention
export const DEV_GRID_HEIGHT = 120; // spec/09-constants-ledger.md §Units — M0 grid convention
export const TARGET_GRID_WIDTH = 960; // spec/09-constants-ledger.md §Units — M0 target-grid convention
export const TARGET_GRID_HEIGHT = 480; // spec/09-constants-ledger.md §Units — M0 target-grid convention

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
export const MATH_EXP_MAX = 709; // spec/09-constants-ledger.md §Units — M0 deterministic math contract
export const MATH_EXP_MIN = -745; // spec/09-constants-ledger.md §Units — M0 deterministic math contract
export const MATH_HALF = 0.5; // spec/09-constants-ledger.md §Units — M0 deterministic math contract
export const MATH_THREE = 3; // spec/09-constants-ledger.md §Units — M0 deterministic math contract
export const MATH_NEGATIVE_ONE = -1; // spec/09-constants-ledger.md §Units — M0 deterministic math contract
export const MATH_NEGATIVE_TWO = -2; // spec/09-constants-ledger.md §Units — M0 deterministic math contract

// M0 placeholder tick. These values make the bench observable without
// pretending to be v2 physics; M1 deletes this field and its coefficients.
export const PLACEHOLDER_NOISE_DECAY = 0.99; // spec/09-constants-ledger.md §Units — M0 placeholder harness
export const PLACEHOLDER_NOISE_AMPLITUDE = 0.01; // spec/09-constants-ledger.md §Units — M0 placeholder harness
export const PLACEHOLDER_NOISE_FREQUENCY = 0.0001; // spec/09-constants-ledger.md §Units — M0 placeholder harness
export const PLACEHOLDER_STEP_PHASE = 0.01; // spec/09-constants-ledger.md §Units — M0 placeholder harness
export const CONSERVATION_EPSILON = 1e-5; // spec/09-constants-ledger.md §Units — M0 conservation assertion
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

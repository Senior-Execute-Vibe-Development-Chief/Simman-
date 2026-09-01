// Deterministic transcendental approximations for the simulation.
//
// All range reduction and polynomial evaluation is explicit. The accepted M0
// contract is approximately 1e-9 over the normal operating domain; the
// important property is that Node and browsers execute the same operations.

import {
  MATH_ATAN_FIRST_ODD,
  MATH_ATAN_LAST_ODD,
  MATH_ATAN_STEP,
  MATH_TAN_EIGHTH_PI,
  MATH_COS_C10,
  MATH_COS_C12,
  MATH_COS_C14,
  MATH_COS_C16,
  MATH_COS_C2,
  MATH_COS_C4,
  MATH_COS_C6,
  MATH_COS_C8,
  MATH_EXP_C10,
  MATH_EXP_C11,
  MATH_EXP_C2,
  MATH_EXP_C3,
  MATH_EXP_C4,
  MATH_EXP_C5,
  MATH_EXP_C6,
  MATH_EXP_C7,
  MATH_EXP_C8,
  MATH_EXP_C9,
  MATH_EXP_MAX,
  MATH_EXP_MIN,
  MATH_FOUR,
  MATH_HALF,
  MATH_INV_LN2,
  MATH_LN2,
  MATH_LN_FIRST_ODD,
  MATH_LN_LAST_ODD,
  MATH_LN_STEP,
  MATH_NEGATIVE_ONE,
  MATH_PI,
  MATH_SIN_C11,
  MATH_SIN_C13,
  MATH_SIN_C15,
  MATH_SIN_C17,
  MATH_SIN_C3,
  MATH_SIN_C5,
  MATH_SIN_C7,
  MATH_SIN_C9,
} from "./constants";

const TWO_PI = MATH_PI * 2;
const HALF_PI = MATH_PI / 2;
const QUARTER_PI = MATH_PI / MATH_FOUR;

function reduceAngle(value: number): number {
  if (!Number.isFinite(value)) return Number.NaN;
  let reduced = value - Math.trunc(value / TWO_PI) * TWO_PI;
  if (reduced > MATH_PI) reduced -= TWO_PI;
  if (reduced < -MATH_PI) reduced += TWO_PI;
  return reduced;
}

function reduceToCosine(value: number): number {
  let reduced = reduceAngle(value);
  if (reduced > HALF_PI) reduced = MATH_PI - reduced;
  if (reduced < -HALF_PI) reduced = -MATH_PI - reduced;
  return reduced;
}

export function dsin(value: number): number {
  const reduced = reduceToCosine(value);
  const square = reduced * reduced;
  return reduced * (
    1 - square * (
      MATH_SIN_C3 - square * (
        MATH_SIN_C5 - square * (
          MATH_SIN_C7 - square * (
            MATH_SIN_C9 - square * (
              MATH_SIN_C11 - square * (
                MATH_SIN_C13 - square * (
                  MATH_SIN_C15 - square * MATH_SIN_C17
                )
              )
            )
          )
        )
      )
    )
  );
}

export function dcos(value: number): number {
  let reduced = reduceAngle(value);
  let sign = 1;
  if (reduced > HALF_PI) {
    reduced = MATH_PI - reduced;
    sign = MATH_NEGATIVE_ONE;
  }
  if (reduced < -HALF_PI) {
    reduced = -MATH_PI - reduced;
    sign = MATH_NEGATIVE_ONE;
  }
  const square = reduced * reduced;
  return sign * (1 - square * (
    MATH_COS_C2 - square * (
      MATH_COS_C4 - square * (
        MATH_COS_C6 - square * (
          MATH_COS_C8 - square * (
            MATH_COS_C10 - square * (
              MATH_COS_C12 - square * (
                MATH_COS_C14 - square * MATH_COS_C16
              )
            )
          )
        )
      )
    )
  ));
}

function scaleByPowerOfTwo(value: number, exponent: number): number {
  let result = value;
  if (exponent > 0) {
    for (let i = 0; i < exponent; i++) result *= 2;
  } else {
    for (let i = 0; i > exponent; i--) result *= MATH_HALF;
  }
  return result;
}

export function dexp(value: number): number {
  if (Number.isNaN(value)) return Number.NaN;
  if (value > MATH_EXP_MAX) return Number.POSITIVE_INFINITY;
  if (value < MATH_EXP_MIN) return 0;

  const exponent = Math.trunc(value * MATH_INV_LN2 + (value >= 0 ? MATH_HALF : -MATH_HALF));
  const reduced = value - exponent * MATH_LN2;
  const square = reduced * reduced;
  const cube = square * reduced;
  const fourth = square * square;
  const fifth = fourth * reduced;
  const sixth = thirdPower(fourth, square);
  const seventh = sixth * reduced;
  const eighth = fourth * fourth;
  const ninth = eighth * reduced;
  const tenth = fifth * fifth;
  const eleventh = tenth * reduced;
  const polynomial = 1 + reduced
    + square * MATH_EXP_C2
    + cube * MATH_EXP_C3
    + fourth * MATH_EXP_C4
    + fifth * MATH_EXP_C5
    + sixth * MATH_EXP_C6
    + seventh * MATH_EXP_C7
    + eighth * MATH_EXP_C8
    + ninth * MATH_EXP_C9
    + tenth * MATH_EXP_C10
    + eleventh * MATH_EXP_C11;
  return scaleByPowerOfTwo(polynomial, exponent);
}

// Kept as a named helper so the polynomial's multiplication order is obvious.
function thirdPower(value: number, square: number): number {
  return value * square;
}

export function dln(value: number): number {
  if (Number.isNaN(value)) return Number.NaN;
  if (value === 0) return Number.NEGATIVE_INFINITY;
  if (value < 0) return Number.NaN;
  if (value === Number.POSITIVE_INFINITY) return Number.POSITIVE_INFINITY;

  let normalized = value;
  let exponent = 0;
  while (normalized >= 2) {
    normalized *= MATH_HALF;
    exponent++;
  }
  while (normalized < 1) {
    normalized *= 2;
    exponent--;
  }

  const z = (normalized - 1) / (normalized + 1);
  const zSquare = z * z;
  let power = z;
  let series = z;
  for (let odd = MATH_LN_FIRST_ODD; odd <= MATH_LN_LAST_ODD; odd += MATH_LN_STEP) {
    power *= zSquare;
    series += power / odd;
  }
  return 2 * series + exponent * MATH_LN2;
}

// Alternating Maclaurin series for atan on |z| ≤ tan(π/8) ≈ 0.4142, where
// the last kept term (z²³/23) is below 2e-11 — inside the ~1e-9 contract.
function datanSeries(z: number): number {
  const zSquare = z * z;
  let power = z;
  let series = z;
  let sign = MATH_NEGATIVE_ONE;
  for (let odd = MATH_ATAN_FIRST_ODD; odd <= MATH_ATAN_LAST_ODD; odd += MATH_ATAN_STEP) {
    power *= zSquare;
    series += sign * (power / odd);
    sign = -sign;
  }
  return series;
}

function datanUnit(value: number): number {
  let sign = 1;
  let magnitude = value;
  if (magnitude < 0) {
    sign = MATH_NEGATIVE_ONE;
    magnitude = -magnitude;
  }
  if (magnitude > 1) {
    return sign * (HALF_PI - datanUnit(1 / magnitude));
  }
  // Range reduction keeps the series argument ≤ tan(π/8): atan(m) =
  // π/4 + atan((m−1)/(m+1)), and for m ≤ tan(π/8) the series is direct.
  if (magnitude > MATH_TAN_EIGHTH_PI) {
    return sign * (QUARTER_PI + datanSeries((magnitude - 1) / (magnitude + 1)));
  }
  return sign * datanSeries(magnitude);
}

export function datan2(y: number, x: number): number {
  if (Number.isNaN(x) || Number.isNaN(y)) return Number.NaN;
  if (x > 0) return datanUnit(y / x);
  if (x < 0) return y >= 0 ? MATH_PI + datanUnit(y / x) : -MATH_PI + datanUnit(y / x);
  if (y > 0) return HALF_PI;
  if (y < 0) return -HALF_PI;
  return 0;
}

export function dpow(base: number, exponent: number): number {
  if (Number.isNaN(base) || Number.isNaN(exponent)) return Number.NaN;
  if (base === 0) {
    if (exponent === 0) return 1;
    return exponent < 0 ? Number.POSITIVE_INFINITY : 0;
  }
  if (base < 0) {
    if (exponent !== Math.trunc(exponent)) return Number.NaN;
    const magnitude = dexp(exponent * dln(-base));
    return Math.trunc(exponent) % 2 === 0 ? magnitude : -magnitude;
  }
  return dexp(exponent * dln(base));
}

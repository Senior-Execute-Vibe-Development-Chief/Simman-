import { MATH_HALF, MATH_NEGATIVE_TWO, MATH_PI, MATH_THREE } from "./constants";

export interface DmathGolden {
  readonly name: "dsin" | "dcos" | "dexp" | "dln" | "dpow";
  readonly args: readonly number[];
  readonly bits: string;
}

// The bit strings are filled from this implementation's checked-in M0
// algorithm and are compared in Node plus Chromium, Firefox, and WebKit.
export const DMATH_GOLDENS: readonly DmathGolden[] = [
  { name: "dsin", args: [-MATH_PI], bits: "0000000000000000" },
  { name: "dsin", args: [-1], bits: "bfeaed548f090cee" },
  { name: "dsin", args: [0], bits: "0000000000000000" },
  { name: "dsin", args: [MATH_HALF], bits: "3fdeaee8744b05f0" },
  { name: "dsin", args: [MATH_PI], bits: "0000000000000000" },
  { name: "dcos", args: [-MATH_PI], bits: "bff0000000000000" },
  { name: "dcos", args: [-1], bits: "3fe14a280fb5068d" },
  { name: "dcos", args: [0], bits: "3ff0000000000000" },
  { name: "dcos", args: [MATH_HALF], bits: "3fec1528065b7d50" },
  { name: "dcos", args: [MATH_PI], bits: "bff0000000000000" },
  { name: "dexp", args: [-1], bits: "3fd78b56362cef2c" },
  { name: "dexp", args: [0], bits: "3ff0000000000000" },
  { name: "dexp", args: [1], bits: "4005bf0a8b145761" },
  { name: "dexp", args: [MATH_PI], bits: "403724046eb0931f" },
  { name: "dln", args: [MATH_HALF], bits: "bfe62e42fefa39ef" },
  { name: "dln", args: [1], bits: "0000000000000000" },
  { name: "dln", args: [2], bits: "3fe62e42fefa39ef" },
  { name: "dln", args: [MATH_PI], bits: "3ff250d048e7a1bc" },
  { name: "dpow", args: [2, MATH_THREE], bits: "4020000000000000" },
  { name: "dpow", args: [MATH_HALF, 2], bits: "3fd0000000000000" },
  { name: "dpow", args: [MATH_NEGATIVE_TWO, MATH_THREE], bits: "c020000000000000" },
];

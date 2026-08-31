// Byte-compatible port of src/sim/peopleSim/rng.js.
//
// Streams are stateless and partitioned by system and step/entity. A new
// consumer therefore cannot perturb an existing consumer's sequence, and no
// RNG state belongs in a save.

import {
  BYTE_MASK,
  BYTE_SHIFT,
  BYTE_SHIFT_2,
  BYTE_SHIFT_3,
  FNV32_OFFSET,
  FNV32_PRIME,
  RNG_SHIFT_A,
  RNG_SHIFT_B,
  RNG_SHIFT_C,
  RNG_SHIFT_D,
  SPLITMIX_SHIFT_A,
  SPLITMIX_SHIFT_B,
  SPLITMIX_INCREMENT,
  SPLITMIX_MULTIPLIER_A,
  SPLITMIX_MULTIPLIER_B,
  UINT32_BASE,
} from "../sim/constants";

export type Rng = (() => number) & {
  int(n: number): number;
  range(lo: number, hi: number): number;
  pick<T>(arr: readonly T[]): T | undefined;
};

export function hash32(...parts: readonly (number | string)[]): number {
  let h = FNV32_OFFSET;
  for (const part of parts) {
    if (typeof part === "number") {
      const hi = Math.floor(part / UINT32_BASE);
      const lo = part >>> 0;
      for (const value of [lo, hi]) {
        h = Math.imul(h ^ (value & BYTE_MASK), FNV32_PRIME);
        h = Math.imul(h ^ ((value >>> BYTE_SHIFT) & BYTE_MASK), FNV32_PRIME);
        h = Math.imul(h ^ ((value >>> BYTE_SHIFT_2) & BYTE_MASK), FNV32_PRIME);
        h = Math.imul(h ^ ((value >>> BYTE_SHIFT_3) & BYTE_MASK), FNV32_PRIME);
      }
    } else {
      const text = String(part);
      for (let i = 0; i < text.length; i++) {
        h = Math.imul(h ^ text.charCodeAt(i), FNV32_PRIME);
      }
    }
  }
  return h >>> 0;
}

function splitmix32(start: number): () => number {
  let a = start | 0;
  return () => {
    a = (a + SPLITMIX_INCREMENT) | 0;
    let t = a ^ (a >>> SPLITMIX_SHIFT_A);
    t = Math.imul(t, SPLITMIX_MULTIPLIER_A);
    t ^= t >>> SPLITMIX_SHIFT_B;
    t = Math.imul(t, SPLITMIX_MULTIPLIER_B);
    return (t ^ (t >>> SPLITMIX_SHIFT_B)) >>> 0;
  };
}

export function mkRng(seed: number): Rng {
  const split = splitmix32(seed >>> 0);
  let a = split();
  let b = split();
  let c = split();
  let d = split();
  const rng = (() => {
    a >>>= 0;
    b >>>= 0;
    c >>>= 0;
    d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> RNG_SHIFT_A);
    b = (c + (c << RNG_SHIFT_D)) | 0;
    c = (c << RNG_SHIFT_B) | (c >>> RNG_SHIFT_C);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / UINT32_BASE;
  }) as Rng;

  // These methods intentionally preserve the v1 JS arithmetic and behavior.
  rng.int = (n) => Math.floor(rng() * n);
  rng.range = (lo, hi) => lo + rng() * (hi - lo);
  rng.pick = <T>(arr: readonly T[]) => arr[Math.floor(rng() * arr.length)];
  return rng;
}

export function passRng(seed: number, systemName: string, step: number): Rng {
  return mkRng(hash32(seed || 1, systemName, step | 0));
}

export function entityRng(seed: number, systemName: string, entityId: number): Rng {
  return mkRng(hash32(seed || 1, systemName, entityId | 0));
}

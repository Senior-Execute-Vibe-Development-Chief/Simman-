/* V2 W23 — WHAT IS WATER, ON THE FINE GRID
 *
 * The 1-arc-minute source is a height grid with no water mask, and the four
 * bakes that read it (cover, shape, pass heights, crossings) each took
 * `altitude > 0` as land. That reads every dry floor below sea level — the
 * Qattara Depression, Lake Eyre, Death Valley, the chotts — as sea, so those
 * cells held no ground and could not be walked across, while the coarse
 * elevation bake (build-earthdata.mts) had the right rule all along.
 *
 * This module is that rule, once, on the fine grid, shared by every bake. A
 * body of standing water is the set of samples at or below ITS OWN SURFACE
 * that connect to that surface (4-connected; x wraps the antimeridian):
 *   - the OCEAN's surface is the datum — altitude 0 is what "sea level"
 *     means — and it is entered from the polar rows (the ring of ocean round
 *     the south pole and the Arctic basin seed it);
 *   - an ENCLOSED body (samples at or below the datum the ocean does not
 *     reach) of at least ENCLOSED_SEA_MIN_KM2 is a SEA — a basin that large
 *     behaves as one for climate and navigation (the Caspian) — but its
 *     surface is not the datum: a landlocked sea stands at its own level, and
 *     the ground between that level and the datum is dry (the Caspian's
 *     surface is ~28 m below the datum, and the depression round it, the
 *     Volga delta included, lies between the two). A height grid shows a
 *     water surface as the one thing dry ground never is at this pitch: FLAT
 *     — a connected patch of samples at one altitude — so the sea's level is
 *     the altitude of the largest flat patch in the body, and the sea is what
 *     lies at or below that level and connects to the patch. It must still
 *     clear the bar once levelled;
 *   - everything else returns to LAND: a dry floor below the datum, the dry
 *     rim of a landlocked sea, or a lake the worldgen's own lake machinery
 *     judges on the coarse grid.
 *
 * No place is named; the one constant is the coarse bake's, cited there.
 */

import { readFileSync, statSync } from "node:fs";

/** The coarse elevation bake's threshold (build-earthdata.mts, QUESTIONS #19). */
export const ENCLOSED_SEA_MIN_KM2 = 100_000;
const EARTH_RADIUS_KM = 6371;

export interface FineLand {
  readonly SRC_W: number;
  readonly SRC_H: number;
  /** 1 = land, indexed `sy * SRC_W + sx`; the +180 column mirrors −180. */
  readonly land: Uint8Array;
  readonly stats: {
    readonly waterSamples: number;
    readonly oceanSamples: number;
    readonly enclosedSeasKept: number;
    /** Each kept sea's surface, in metres below the datum, and the samples of its dry rim. */
    readonly enclosedSeaLevels: readonly { readonly level: number; readonly samples: number; readonly rimSamples: number }[];
    readonly enclosedBodiesToLand: number;
    readonly samplesReturnedToLand: number;
  };
}

export function buildFineLand(src: Int16Array, SRC_W: number, SRC_H: number): FineLand {
  const COLS = SRC_W - 1; // the +180 column duplicates −180
  const N = SRC_H * COLS;
  // 0 = land, 1 = water not yet classified, 2 = ocean.
  const state = new Uint8Array(N);
  let waterSamples = 0;
  for (let sy = 0; sy < SRC_H; sy++) {
    const rowBase = sy * SRC_W;
    const outBase = sy * COLS;
    for (let sx = 0; sx < COLS; sx++) {
      if (src[rowBase + sx]! <= 0) { state[outBase + sx] = 1; waterSamples++; }
    }
  }
  const queue = new Int32Array(N);
  let head = 0;
  let tail = 0;
  const flood = (seed: number, mark: number): number => {
    head = 0; tail = 0;
    queue[tail++] = seed; state[seed] = mark;
    let count = 0;
    while (head < tail) {
      const o = queue[head++]!;
      count++;
      const sy = (o / COLS) | 0;
      const sx = o - sy * COLS;
      const east = sy * COLS + (sx + 1 === COLS ? 0 : sx + 1);
      const west = sy * COLS + (sx === 0 ? COLS - 1 : sx - 1);
      if (state[east] === 1) { state[east] = mark; queue[tail++] = east; }
      if (state[west] === 1) { state[west] = mark; queue[tail++] = west; }
      if (sy > 0) { const n = o - COLS; if (state[n] === 1) { state[n] = mark; queue[tail++] = n; } }
      if (sy + 1 < SRC_H) { const n = o + COLS; if (state[n] === 1) { state[n] = mark; queue[tail++] = n; } }
    }
    return count;
  };
  // Ocean: everything reachable from the polar rows.
  let oceanSamples = 0;
  for (const sy of [0, SRC_H - 1]) {
    for (let sx = 0; sx < COLS; sx++) {
      const o = sy * COLS + sx;
      if (state[o] === 1) oceanSamples += flood(o, 2);
    }
  }
  // Enclosed bodies: sea-sized ones join the ocean, the rest return to land.
  const rowKm2 = new Float64Array(SRC_H);
  for (let sy = 0; sy < SRC_H; sy++) {
    const lat = ((-90 + (180 * sy) / (SRC_H - 1)) * Math.PI) / 180;
    rowKm2[sy] = ((2 * Math.PI * EARTH_RADIUS_KM) / COLS) * ((Math.PI * EARTH_RADIUS_KM) / (SRC_H - 1)) * Math.cos(lat);
  }
  let enclosedSeasKept = 0;
  const enclosedSeaLevels: { level: number; samples: number; rimSamples: number }[] = [];
  let enclosedBodiesToLand = 0;
  let samplesReturnedToLand = 0;
  const altitudeOf = (o: number): number => {
    const sy = (o / COLS) | 0;
    return src[sy * SRC_W + (o - sy * COLS)]!;
  };
  const seen = new Uint8Array(N);
  const patchQueue = new Int32Array(N);
  const body = new Int32Array(N);
  for (let o = 0; o < N; o++) {
    if (state[o] !== 1) continue;
    // Mark 3 = "this body", then decide.
    const count = flood(o, 3);
    body.set(queue.subarray(0, count));
    let km2 = 0;
    for (let k = 0; k < count; k++) km2 += rowKm2[(body[k]! / COLS) | 0]!;
    if (km2 < ENCLOSED_SEA_MIN_KM2) {
      for (let k = 0; k < count; k++) state[body[k]!] = 0;
      enclosedBodiesToLand++; samplesReturnedToLand += count;
      continue;
    }
    // The body's surface: its largest flat patch (ties to the higher one).
    let bestSize = 0; let level = 0; let seed = body[0]!;
    for (let k = 0; k < count; k++) {
      const start = body[k]!;
      if (seen[start]) continue;
      const alt = altitudeOf(start);
      let ph = 0; let pt = 0;
      patchQueue[pt++] = start; seen[start] = 1;
      while (ph < pt) {
        const c = patchQueue[ph++]!;
        const sy = (c / COLS) | 0;
        const sx = c - sy * COLS;
        const around = [
          sy * COLS + (sx + 1 === COLS ? 0 : sx + 1),
          sy * COLS + (sx === 0 ? COLS - 1 : sx - 1),
          sy > 0 ? c - COLS : -1,
          sy + 1 < SRC_H ? c + COLS : -1,
        ];
        for (const n of around) {
          if (n < 0 || seen[n] || state[n] !== 3 || altitudeOf(n) !== alt) continue;
          seen[n] = 1; patchQueue[pt++] = n;
        }
      }
      if (pt > bestSize || (pt === bestSize && alt > level)) { bestSize = pt; level = alt; seed = start; }
    }
    for (let k = 0; k < count; k++) seen[body[k]!] = 0;
    // The sea: what lies at or below that surface and connects to it.
    let ph = 0; let pt = 0;
    patchQueue[pt++] = seed; state[seed] = 2;
    let seaKm2 = 0;
    while (ph < pt) {
      const c = patchQueue[ph++]!;
      const sy = (c / COLS) | 0;
      const sx = c - sy * COLS;
      seaKm2 += rowKm2[sy]!;
      const around = [
        sy * COLS + (sx + 1 === COLS ? 0 : sx + 1),
        sy * COLS + (sx === 0 ? COLS - 1 : sx - 1),
        sy > 0 ? c - COLS : -1,
        sy + 1 < SRC_H ? c + COLS : -1,
      ];
      for (const n of around) {
        if (n < 0 || state[n] !== 3 || altitudeOf(n) > level) continue;
        state[n] = 2; patchQueue[pt++] = n;
      }
    }
    if (seaKm2 < ENCLOSED_SEA_MIN_KM2) {
      for (let k = 0; k < count; k++) state[body[k]!] = 0;
      enclosedBodiesToLand++; samplesReturnedToLand += count;
      continue;
    }
    // The dry rim — the body above its own surface, or below it but cut off
    // from it — is land.
    let rim = 0;
    for (let k = 0; k < count; k++) if (state[body[k]!] === 3) { state[body[k]!] = 0; rim++; }
    enclosedSeasKept++; oceanSamples += pt; samplesReturnedToLand += rim;
    enclosedSeaLevels.push({ level: -level, samples: pt, rimSamples: rim });
  }
  const land = new Uint8Array(SRC_W * SRC_H);
  for (let sy = 0; sy < SRC_H; sy++) {
    const outBase = sy * COLS;
    const rowBase = sy * SRC_W;
    for (let sx = 0; sx < COLS; sx++) land[rowBase + sx] = state[outBase + sx] === 2 ? 0 : 1;
    land[rowBase + COLS] = land[rowBase]!;
  }
  return {
    SRC_W, SRC_H, land,
    stats: { waterSamples, oceanSamples, enclosedSeasKept, enclosedSeaLevels, enclosedBodiesToLand, samplesReturnedToLand },
  };
}

/** Read the raw little-endian int16 ETOPO1 grid whose dimensions are in its name. */
export function readEtopo(binPath: string): { src: Int16Array; SRC_W: number; SRC_H: number } {
  const dims = /-(\d+)x(\d+)\.bin$/.exec(binPath);
  if (!dims) throw new Error("input filename must carry its dimensions, e.g. etopo1-21601x10801.bin");
  const SRC_W = Number(dims[1]);
  const SRC_H = Number(dims[2]);
  if (statSync(binPath).size !== SRC_W * SRC_H * 2) throw new Error("bin size does not match its dimensions");
  const raw = readFileSync(binPath);
  return { src: new Int16Array(raw.buffer, raw.byteOffset, SRC_W * SRC_H), SRC_W, SRC_H };
}

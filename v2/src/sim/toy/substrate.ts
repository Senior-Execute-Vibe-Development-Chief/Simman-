/**
 * Fake 100×100 landscape for the M4 playground shell.
 * Not Earth — heights, climate, rivers, and fertility are shaped so
 * communities, exit, and tribute are easy to see cell by cell.
 */

import {
  MATH_NEGATIVE_ONE,
  MONTHS_PER_YEAR,
  TOY_GRID_HEIGHT,
  TOY_GRID_WIDTH,
  TRAVEL_PASS_DIRECTIONS,
  UINT8_SENTINEL,
} from "../constants";
import { fallbackCrossings } from "../crossings";
import { emptySnowpack } from "../snow";
import type { Substrate } from "../substrate";
import type { GridPreset } from "../world";

const WIDTH = TOY_GRID_WIDTH;
const HEIGHT = TOY_GRID_HEIGHT;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function idx(x: number, y: number): number {
  return y * WIDTH + x;
}

function blob(x: number, y: number, cx: number, cy: number, radius: number): number {
  const dx = x - cx;
  const dy = y - cy;
  const t = Math.sqrt(dx * dx + dy * dy) / Math.max(1e-6, radius);
  return t >= 1 ? 0 : clamp01(1 - t * t);
}

/** Build the toy substrate: mountains north, sea south, two river valleys. */
export function buildToySubstrate(seed = 1): Substrate {
  const N = WIDTH * HEIGHT;
  const elevation = new Float32Array(N);
  const landMask = new Uint8Array(N);
  const coast = new Uint8Array(N);
  const coastDistanceKm = new Float32Array(N);
  const relief = new Float32Array(N);
  const fertility = new Float32Array(N);
  const soil = new Float32Array(N);
  const floodplain = new Float32Array(N);
  const wildCropSuitability = new Float32Array(N);
  const biome = new Uint8Array(N);
  const temperature = new Float32Array(N * MONTHS_PER_YEAR);
  const moisture = new Float32Array(N * MONTHS_PER_YEAR);
  const windU = new Float32Array(N * MONTHS_PER_YEAR);
  const windV = new Float32Array(N * MONTHS_PER_YEAR);
  const magnitude = new Uint8Array(N);
  const direction = new Uint8Array(N);
  direction.fill(UINT8_SENTINEL);
  const flowAccum = new Float32Array(N);
  const runoff = new Float32Array(N);
  const lake = new Int32Array(N);
  lake.fill(MATH_NEGATIVE_ONE);

  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const cell = idx(x, y);
      const sea = y >= HEIGHT - 8;
      const mountain = blob(x, y, 50, 12, 22) * 0.85
        + blob(x, y, 20, 8, 14) * 0.55
        + blob(x, y, 80, 10, 14) * 0.55;
      const westValley = blob(x, y, 28, 55, 18);
      const eastValley = blob(x, y, 72, 52, 16);
      const valley = Math.max(westValley, eastValley);
      const plain = clamp01(1 - mountain - valley * 0.4);

      let height = 0.12 + plain * 0.25 + mountain * 0.7 - valley * 0.08;
      if (sea) height = 0.02;
      elevation[cell] = clamp01(height);
      landMask[cell] = sea ? 0 : 1;
      coast[cell] = !sea && y >= HEIGHT - 10 ? 1 : 0;
      coastDistanceKm[cell] = sea ? 0 : Math.max(0, (HEIGHT - 9 - y) * 12);
      relief[cell] = mountain;
      fertility[cell] = sea ? 0 : clamp01(0.25 + valley * 0.7 + plain * 0.2 - mountain * 0.4);
      soil[cell] = fertility[cell];
      floodplain[cell] = valley * 0.9;
      wildCropSuitability[cell] = fertility[cell];
      biome[cell] = sea ? 0 : mountain > 0.45 ? 2 : valley > 0.35 ? 5 : 4;

      if (!sea && Math.abs(x - 28) <= 1 && y >= 35 && y <= 88) {
        magnitude[cell] = 180;
        direction[cell] = 2;
        flowAccum[cell] = 40 + (88 - y);
      }
      if (!sea && Math.abs(x - (72 + Math.floor((y - 40) * 0.15))) <= 1 && y >= 32 && y <= 90) {
        magnitude[cell] = 160;
        direction[cell] = 2;
        flowAccum[cell] = 30 + (90 - y);
      }

      for (let month = 0; month < MONTHS_PER_YEAR; month++) {
        const season = Math.sin(((month + 3) / MONTHS_PER_YEAR) * Math.PI * 2);
        const climateIndex = cell * MONTHS_PER_YEAR + month;
        temperature[climateIndex] = clamp01(0.55 + season * 0.18 - mountain * 0.25 + (sea ? 0.05 : 0));
        moisture[climateIndex] = clamp01(0.35 + valley * 0.45 + season * 0.08 - mountain * 0.2 + (sea ? 0.1 : 0));
        windU[climateIndex] = 2 + season;
        windV[climateIndex] = -0.5;
      }
    }
  }

  for (const [lx, ly] of [[30, 60], [70, 58]] as const) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const x = lx + dx;
        const y = ly + dy;
        if (x < 0 || x >= WIDTH || y < 0 || y >= HEIGHT) continue;
        const cell = idx(x, y);
        if (!landMask[cell]) continue;
        lake[cell] = ly * WIDTH + lx;
        magnitude[cell] = Math.max(magnitude[cell] ?? 0, 40);
      }
    }
  }

  return {
    seed,
    grid: "toy" as GridPreset,
    width: WIDTH,
    height: HEIGHT,
    N,
    preset: "m4-toy",
    crossings: fallbackCrossings(landMask, WIDTH, HEIGHT),
    landFraction: Float32Array.from(landMask, (bit) => (bit ? 1 : 0)),
    landShape: new Uint8Array(landMask),
    landShapeWidth: WIDTH,
    landShapeHeight: HEIGHT,
    landShapeBlock: 1,
    walkKm: new Float32Array(N * TRAVEL_PASS_DIRECTIONS),
    snow: emptySnowpack(N),
    dryFraction: new Float32Array(N),
    temperatureAmplitude: new Float32Array(N),
    warmRainFraction: new Float32Array(N),
    walkAscent: new Float32Array(N * TRAVEL_PASS_DIRECTIONS),
    walkDescent: new Float32Array(N * TRAVEL_PASS_DIRECTIONS),
    elevation,
    landMask,
    climate: { temperature, moisture },
    wind: { u: windU, v: windV },
    temperature,
    moisture,
    rivers: { magnitude, direction, flowAccum, runoff, lake },
    ancestry: {
      lineage: new Int16Array(N),
      arrival: new Float32Array(N),
      count: 1,
      hue: new Float32Array(1),
      light: new Float32Array([0.6]),
      originFx: 0.5,
      originFy: 0.5,
    },
    floodplain,
    biome,
    soil,
    fertility,
    wildCropSuitability,
    crossingCost: new Float32Array(N),
    resources: {},
    relief,
    coast,
    coastDistanceKm,
  };
}

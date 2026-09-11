/**
 * Bake a 100×100 Nile-mouth crop from the target Earth substrate for the
 * M4 toy playground. Run: npx tsx tools/bake-toy-nile.ts
 *
 * Window: Mediterranean + Nile delta/mouth + Eastern Desert relief.
 * Writes src/sim/toy/nileCrop.generated.ts (typed binary arrays as base64).
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MONTHS_PER_YEAR,
  TOY_GRID_HEIGHT,
  TOY_GRID_WIDTH,
  TRAVEL_PASS_DIRECTIONS,
} from "../src/sim/constants";
import { buildSubstrate } from "../src/sim/substrate";
import type { Substrate } from "../src/sim/substrate";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "../src/sim/toy/nileCrop.generated.ts");

const CROP_W = TOY_GRID_WIDTH;
const CROP_H = TOY_GRID_HEIGHT;

/** Prefer Med + delta + Nile channel + eastern relief (Sinai / Red Sea hills). */
function pickWindow(source: Substrate): { x0: number; y0: number } {
  const W = source.width;
  let best = { score: -1, x0: 1025, y0: 240 };
  for (let y0 = 220; y0 <= 320; y0 += 4) {
    for (let x0 = 1000; x0 <= 1120; x0 += 4) {
      if (x0 + CROP_W > W || y0 + CROP_H > source.height) continue;
      let ocean = 0;
      let land = 0;
      let river = 0;
      let mtn = 0;
      for (let dy = 0; dy < CROP_H; dy++) {
        for (let dx = 0; dx < CROP_W; dx++) {
          const i = (y0 + dy) * W + (x0 + dx);
          if (!source.landMask[i]) ocean++;
          else land++;
          if ((source.rivers.flowAccum[i] ?? 0) > 40) river++;
          if ((source.elevation[i] ?? 0) > 0.22) mtn++;
        }
      }
      if (ocean < 150 || land < 2500 || river < 20 || mtn < 40) continue;
      const score =
        Math.min(ocean, 900)
        + Math.min(river, 250) * 6
        + Math.min(mtn, 500) * 3;
      if (score > best.score) best = { score, x0, y0 };
    }
  }
  return best;
}

function slicePlane<T extends Float32Array | Float64Array | Uint8Array | Int32Array | Int16Array>(
  Ctor: { new (length: number): T },
  src: ArrayLike<number>,
  srcW: number,
  x0: number,
  y0: number,
  stride = 1,
): T {
  const out = new Ctor(CROP_W * CROP_H * stride);
  for (let dy = 0; dy < CROP_H; dy++) {
    for (let dx = 0; dx < CROP_W; dx++) {
      const srcCell = (y0 + dy) * srcW + (x0 + dx);
      const dstCell = dy * CROP_W + dx;
      for (let k = 0; k < stride; k++) {
        out[dstCell * stride + k] = src[srcCell * stride + k] ?? 0;
      }
    }
  }
  return out;
}

function b64(buf: ArrayBufferView): string {
  return Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength).toString("base64");
}

function decodeHelper(): string {
  return `
function u8(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function f32(b64: string): Float32Array {
  const bytes = u8(b64);
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
}
function i32(b64: string): Int32Array {
  const bytes = u8(b64);
  return new Int32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
}
function i16(b64: string): Int16Array {
  const bytes = u8(b64);
  return new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
}
`.trim();
}

async function main(): Promise<void> {
  console.log("Building target Earth substrate (this takes a few minutes)…");
  const source = buildSubstrate(1, { preset: "earth_sim" }, "target");
  const { x0, y0 } = pickWindow(source);
  console.log(`Crop origin (${x0}, ${y0}) on ${source.width}×${source.height}`);

  const W = source.width;
  const elevation = slicePlane(Float32Array, source.elevation, W, x0, y0);
  const landMask = slicePlane(Uint8Array, source.landMask, W, x0, y0);
  const fertility = slicePlane(Float32Array, source.fertility, W, x0, y0);
  const soil = slicePlane(Float32Array, source.soil, W, x0, y0);
  const floodplain = slicePlane(Float32Array, source.floodplain, W, x0, y0);
  const wildCrop = slicePlane(Float32Array, source.wildCropSuitability, W, x0, y0);
  const biome = slicePlane(Uint8Array, source.biome, W, x0, y0);
  const relief = slicePlane(Float32Array, source.relief, W, x0, y0);
  const coast = slicePlane(Uint8Array, source.coast, W, x0, y0);
  const coastDistanceKm = slicePlane(Float32Array, source.coastDistanceKm, W, x0, y0);
  const magnitude = slicePlane(Uint8Array, source.rivers.magnitude, W, x0, y0);
  const direction = slicePlane(Uint8Array, source.rivers.direction, W, x0, y0);
  const flowAccum = slicePlane(Float32Array, source.rivers.flowAccum, W, x0, y0);
  const runoff = slicePlane(Float32Array, source.rivers.runoff, W, x0, y0);
  const lake = slicePlane(Int32Array, source.rivers.lake, W, x0, y0);
  // Remap lake ids that pointed at absolute cells into crop-local seats, or -1.
  for (let i = 0; i < lake.length; i++) {
    const id = lake[i] ?? -1;
    if (id < 0) continue;
    const lx = id % W;
    const ly = (id / W) | 0;
    if (lx < x0 || ly < y0 || lx >= x0 + CROP_W || ly >= y0 + CROP_H) {
      lake[i] = -1;
    } else {
      lake[i] = (ly - y0) * CROP_W + (lx - x0);
    }
  }
  const temperature = slicePlane(Float32Array, source.temperature, W, x0, y0, MONTHS_PER_YEAR);
  const moisture = slicePlane(Float32Array, source.moisture, W, x0, y0, MONTHS_PER_YEAR);
  const windU = slicePlane(Float32Array, source.wind.u, W, x0, y0, MONTHS_PER_YEAR);
  const windV = slicePlane(Float32Array, source.wind.v, W, x0, y0, MONTHS_PER_YEAR);
  const dryFraction = slicePlane(Float32Array, source.dryFraction, W, x0, y0);
  const temperatureAmplitude = slicePlane(Float32Array, source.temperatureAmplitude, W, x0, y0);
  const warmRainFraction = slicePlane(Float32Array, source.warmRainFraction, W, x0, y0);
  const lineage = slicePlane(Int16Array, source.ancestry.lineage, W, x0, y0);
  const arrival = slicePlane(Float32Array, source.ancestry.arrival, W, x0, y0);

  let land = 0;
  let ocean = 0;
  let river = 0;
  let mtn = 0;
  for (let i = 0; i < landMask.length; i++) {
    if (landMask[i]) land++;
    else ocean++;
    if ((flowAccum[i] ?? 0) > 40) river++;
    if ((elevation[i] ?? 0) > 0.22) mtn++;
  }
  console.log({ land, ocean, river, mtn, maxElev: Math.max(...elevation) });

  const parts = {
    elevation: b64(elevation),
    landMask: b64(landMask),
    fertility: b64(fertility),
    soil: b64(soil),
    floodplain: b64(floodplain),
    wildCropSuitability: b64(wildCrop),
    biome: b64(biome),
    relief: b64(relief),
    coast: b64(coast),
    coastDistanceKm: b64(coastDistanceKm),
    magnitude: b64(magnitude),
    direction: b64(direction),
    flowAccum: b64(flowAccum),
    runoff: b64(runoff),
    lake: b64(lake),
    temperature: b64(temperature),
    moisture: b64(moisture),
    windU: b64(windU),
    windV: b64(windV),
    dryFraction: b64(dryFraction),
    temperatureAmplitude: b64(temperatureAmplitude),
    warmRainFraction: b64(warmRainFraction),
    lineage: b64(lineage),
    arrival: b64(arrival),
  };

  const body = `/* AUTO-GENERATED by tools/bake-toy-nile.ts — do not edit. */
/* Nile-mouth crop from target Earth (${source.width}×${source.height}) at (${x0},${y0}). */
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

${decodeHelper()}

const WIDTH = TOY_GRID_WIDTH;
const HEIGHT = TOY_GRID_HEIGHT;
const N = WIDTH * HEIGHT;

export const NILE_CROP_ORIGIN = { x0: ${x0}, y0: ${y0}, sourceWidth: ${source.width}, sourceHeight: ${source.height} } as const;

export function buildNileCropSubstrate(seed = 1): Substrate {
  const elevation = f32(${JSON.stringify(parts.elevation)});
  const landMask = u8(${JSON.stringify(parts.landMask)});
  const fertility = f32(${JSON.stringify(parts.fertility)});
  const soil = f32(${JSON.stringify(parts.soil)});
  const floodplain = f32(${JSON.stringify(parts.floodplain)});
  const wildCropSuitability = f32(${JSON.stringify(parts.wildCropSuitability)});
  const biome = u8(${JSON.stringify(parts.biome)});
  const relief = f32(${JSON.stringify(parts.relief)});
  const coast = u8(${JSON.stringify(parts.coast)});
  const coastDistanceKm = f32(${JSON.stringify(parts.coastDistanceKm)});
  const magnitude = u8(${JSON.stringify(parts.magnitude)});
  const direction = u8(${JSON.stringify(parts.direction)});
  const flowAccum = f32(${JSON.stringify(parts.flowAccum)});
  const runoff = f32(${JSON.stringify(parts.runoff)});
  const lake = i32(${JSON.stringify(parts.lake)});
  const temperature = f32(${JSON.stringify(parts.temperature)});
  const moisture = f32(${JSON.stringify(parts.moisture)});
  const windU = f32(${JSON.stringify(parts.windU)});
  const windV = f32(${JSON.stringify(parts.windV)});
  const dryFraction = f32(${JSON.stringify(parts.dryFraction)});
  const temperatureAmplitude = f32(${JSON.stringify(parts.temperatureAmplitude)});
  const warmRainFraction = f32(${JSON.stringify(parts.warmRainFraction)});
  const lineage = i16(${JSON.stringify(parts.lineage)});
  const arrival = f32(${JSON.stringify(parts.arrival)});
  void UINT8_SENTINEL;
  void MATH_NEGATIVE_ONE;
  void MONTHS_PER_YEAR;

  return {
    seed,
    grid: "toy" as GridPreset,
    width: WIDTH,
    height: HEIGHT,
    N,
    preset: "m4-toy-nile",
    crossings: fallbackCrossings(landMask, WIDTH, HEIGHT),
    landFraction: Float32Array.from(landMask, (bit) => (bit ? 1 : 0)),
    landShape: new Uint8Array(landMask),
    landShapeWidth: WIDTH,
    landShapeHeight: HEIGHT,
    landShapeBlock: 1,
    walkKm: new Float32Array(N * TRAVEL_PASS_DIRECTIONS),
    snow: emptySnowpack(N),
    dryFraction,
    temperatureAmplitude,
    warmRainFraction,
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
      lineage,
      arrival,
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
`;

  writeFileSync(OUT, body);
  console.log("Wrote", OUT, `(${(Buffer.byteLength(body) / 1024).toFixed(0)} KB)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

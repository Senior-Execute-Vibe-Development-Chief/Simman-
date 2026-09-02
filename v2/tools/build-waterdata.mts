/**
 * Build the W1 water layers while preserving an existing river bake.
 *
 * This sibling path is useful when HydroSHEDS has already been baked:
 *   npx tsx tools/build-waterdata.mts <etopo.nc> <HydroLAKES_polys_v10.shp>
 *
 * The full build-riverdata.mts accepts the same polygon input and emits all
 * layers together. This tool only regenerates RIVER_FLOOD and LAKE_MASK, so a
 * source HydroSHEDS GeoTIFF is not needed to refresh those layers.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  RIVER_DIR,
  RIVER_DIR_H,
  RIVER_DIR_NODATA,
  RIVER_DIR_W,
  decodeRiverDir,
} from "../src/ported/worldgen/riverDirData.js";

const OUT_W = RIVER_DIR_W;
const OUT_H = RIVER_DIR_H;
const N = OUT_W * OUT_H;
const D8_DX = [1, 1, 0, -1, -1, -1, 0, 1];
const D8_DY = [0, 1, 1, 1, 0, -1, -1, -1];
const FLOOD_STAGE_M = 8;
const FLOOD_SEARCH_RADIUS_KM = 100;
const ELEVATION_SAMPLE_STEP_KM = 1.8;
const FINE_CHANNEL_ACCUM_MIN = 4;
const LAKE_RASTER_SUBSAMPLES = 4;
const LAKE_SOURCE_MIN_AREA_KM2 = 100;
const EARTH_MERIDIONAL_KM = 20004;

interface LakeShape {
  readonly bbox: readonly [number, number, number, number];
  readonly parts: readonly number[];
  readonly points: readonly [number, number][];
}

function readNetcdfAltitude(path: string): { readonly w: number; readonly h: number; readonly data: Float64Array } {
  const buf = readFileSync(path);
  if (buf.toString("latin1", 0, 3) !== "CDF") throw new Error("not a NetCDF-3 file");
  let offset = 4;
  const u32 = (): number => { const value = buf.readUInt32BE(offset); offset += 4; return value; };
  const name = (): string => {
    const length = u32();
    const value = buf.toString("latin1", offset, offset + length);
    offset += length + ((4 - (length % 4)) % 4);
    return value;
  };
  u32();
  const dimensions: number[] = [];
  if (u32() === 10) {
    const count = u32();
    for (let index = 0; index < count; index++) { name(); dimensions.push(u32()); }
  }
  const skipAttributes = (): void => {
    const tag = u32();
    const count = u32();
    if (tag === 0) return;
    for (let index = 0; index < count; index++) {
      name();
      const type = u32();
      const length = u32();
      const bytes = length * ([0, 1, 1, 2, 4, 4, 8][type] ?? 1);
      offset += bytes + ((4 - (bytes % 4)) % 4);
    }
  };
  skipAttributes();
  if (u32() !== 11) throw new Error("no NetCDF variables");
  const variables = u32();
  let found: { readonly dims: readonly number[]; readonly type: number; readonly begin: number } | undefined;
  for (let variable = 0; variable < variables; variable++) {
    const variableName = name();
    const rank = u32();
    const dims: number[] = [];
    for (let dim = 0; dim < rank; dim++) dims.push(dimensions[u32()] ?? 0);
    skipAttributes();
    const type = u32();
    u32();
    const begin = u32();
    if (variableName === "altitude") found = { dims, type, begin };
  }
  if (!found) throw new Error("altitude variable missing");
  const count = found.dims.reduce((product, size) => product * size, 1);
  const data = new Float64Array(count);
  for (let index = 0; index < count; index++) {
    data[index] = found.type === 3
      ? buf.readInt16BE(found.begin + index * 2)
      : found.type === 5
        ? buf.readFloatBE(found.begin + index * 4)
        : buf.readDoubleBE(found.begin + index * 8);
  }
  return { w: found.dims[1] ?? 0, h: found.dims[0] ?? 0, data };
}

function readDbfAreas(path: string): Float64Array {
  const buf = readFileSync(path);
  const records = buf.readUInt32LE(4);
  const headerLength = buf.readUInt16LE(8);
  const recordLength = buf.readUInt16LE(10);
  let fieldOffset = 32;
  let recordFieldOffset = 1;
  let areaOffset = -1;
  let areaLength = 0;
  while (fieldOffset + 32 <= headerLength && buf[fieldOffset] !== 0x0d) {
    const fieldName = buf.toString("latin1", fieldOffset, fieldOffset + 11)
      .replace(/\0.*$/, "").trim().toLowerCase();
    if (fieldName === "lake_area" || fieldName === "lakearea") {
      areaOffset = recordFieldOffset;
      areaLength = buf[fieldOffset + 16] ?? 0;
    }
    recordFieldOffset += buf[fieldOffset + 16] ?? 0;
    fieldOffset += 32;
  }
  if (areaOffset < 0) throw new Error("HydroLAKES DBF has no Lake_area field");
  const areas = new Float64Array(records);
  for (let record = 0; record < records; record++) {
    const start = headerLength + record * recordLength;
    if (buf[start] !== 0x2a) {
      areas[record] = Number.parseFloat(
        buf.toString("ascii", start + areaOffset, start + areaOffset + areaLength).trim(),
      ) || 0;
    }
  }
  return areas;
}

function readPolygonRecord(buf: Buffer, offset: number): LakeShape | null {
  const shapeType = buf.readInt32LE(offset);
  if (shapeType === 0) return null;
  if (shapeType !== 5 && shapeType !== 15 && shapeType !== 25) {
    throw new Error(`unsupported polygon shape type ${shapeType}`);
  }
  const bbox: [number, number, number, number] = [
    buf.readDoubleLE(offset + 4),
    buf.readDoubleLE(offset + 12),
    buf.readDoubleLE(offset + 20),
    buf.readDoubleLE(offset + 28),
  ];
  const partCount = buf.readInt32LE(offset + 36);
  const pointCount = buf.readInt32LE(offset + 40);
  const parts: number[] = [];
  for (let part = 0; part < partCount; part++) parts.push(buf.readInt32LE(offset + 44 + part * 4));
  const points: [number, number][] = [];
  const pointsOffset = offset + 44 + partCount * 4;
  for (let point = 0; point < pointCount; point++) {
    const at = pointsOffset + point * 16;
    points.push([buf.readDoubleLE(at), buf.readDoubleLE(at + 8)]);
  }
  return { bbox, parts, points };
}

function pointInRing(x: number, y: number, points: readonly [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i]!;
    const [xj, yj] = points[j]!;
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function pointInShape(x: number, y: number, shape: LakeShape): boolean {
  let inside = false;
  for (let part = 0; part < shape.parts.length; part++) {
    const start = shape.parts[part]!;
    const end = shape.parts[part + 1] ?? shape.points.length;
    if (end - start >= 3 && pointInRing(x, y, shape.points.slice(start, end))) inside = !inside;
  }
  return inside;
}

const etopoPath = process.argv[2];
const lakePath = process.argv[3];
if (!etopoPath || !lakePath) throw new Error("usage: build-waterdata.mts <etopo.nc> <HydroLAKES_polys_v10.shp>");
const etopo = readNetcdfAltitude(etopoPath);
const earthSource = readFileSync(
  fileURLToPath(new URL("../src/ported/worldgen/earthData.js", import.meta.url)),
  "utf8",
);
const earthMatch = earthSource.match(/export const EARTH_ELEV="([^"]+)"/);
if (!earthMatch) throw new Error("EARTH_ELEV not found");
const earth = Buffer.from(earthMatch[1]!, "base64");
const lakeMask = new Uint8Array(N);
const areas = readDbfAreas(lakePath.replace(/\.[^.]+$/, ".dbf"));
const shp = readFileSync(lakePath);
let record = 0;
for (let offset = 100; offset + 8 <= shp.length && record < areas.length; record++) {
  const contentBytes = shp.readInt32BE(offset + 4) * 2;
  const area = areas[record] ?? 0;
  if (area >= LAKE_SOURCE_MIN_AREA_KM2) {
    const shape = readPolygonRecord(shp, offset + 8);
    if (shape) {
      const [minLon, minLat, maxLon, maxLat] = shape.bbox;
      const x0 = Math.max(0, Math.floor(((minLon + 180) / 360) * OUT_W) - 1);
      const x1 = Math.min(OUT_W - 1, Math.ceil(((maxLon + 180) / 360) * OUT_W) + 1);
      const y0 = Math.max(0, Math.floor(((90 - maxLat) / 180) * OUT_H) - 1);
      const y1 = Math.min(OUT_H - 1, Math.ceil(((90 - minLat) / 180) * OUT_H) + 1);
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const index = y * OUT_W + x;
        if (lakeMask[index] || (earth[index] ?? 0) < 3) continue;
        let inside = 0;
        for (let sy = 0; sy < LAKE_RASTER_SUBSAMPLES; sy++) {
          for (let sx = 0; sx < LAKE_RASTER_SUBSAMPLES; sx++) {
            const lon = -180 + ((x + (sx + 0.5) / LAKE_RASTER_SUBSAMPLES) / OUT_W) * 360;
            const lat = 90 - ((y + (sy + 0.5) / LAKE_RASTER_SUBSAMPLES) / OUT_H) * 180;
            if (pointInShape(lon, lat, shape)) inside++;
          }
        }
        if (inside >= (LAKE_RASTER_SUBSAMPLES * LAKE_RASTER_SUBSAMPLES) / 2) lakeMask[index] = 1;
      }
    }
  }
  offset += 8 + contentBytes;
}

const direction = decodeRiverDir(RIVER_DIR);
const target = new Int32Array(N).fill(-1);
const degree = new Uint16Array(N);
for (let cell = 0; cell < N; cell++) {
  const d = direction[cell] ?? RIVER_DIR_NODATA;
  if (d > 7) continue;
  const x = cell % OUT_W;
  const y = (cell - x) / OUT_W;
  const ny = y + D8_DY[d]!;
  if (ny < 0 || ny >= OUT_H) continue;
  const next = ny * OUT_W + ((x + D8_DX[d]! + OUT_W) % OUT_W);
  target[cell] = next;
  degree[next]++;
}
const accumulation = new Float64Array(N).fill(1);
const queue = new Int32Array(N);
let queueLength = 0;
for (let cell = 0; cell < N; cell++) if (degree[cell] === 0) queue[queueLength++] = cell;
for (let head = 0; head < queueLength; head++) {
  const cell = queue[head]!;
  const next = target[cell]!;
  if (next < 0) continue;
  accumulation[next] += accumulation[cell]!;
  degree[next]--;
  if (degree[next] === 0) queue[queueLength++] = next;
}

const { data: elevation, w: elevationWidth, h: elevationHeight } = etopo;
const valueAt = (lat: number, lon: number): number => {
  const y = Math.max(0, Math.min(elevationHeight - 1, Math.round(((lat + 90) / 180) * (elevationHeight - 1))));
  const wrapped = ((lon + 180) % 360 + 360) % 360 - 180;
  const x = Math.max(0, Math.min(elevationWidth - 1, Math.round(((wrapped + 180) / 360) * (elevationWidth - 1))));
  return elevation[y * elevationWidth + x] ?? 0;
};
const flood = new Uint8Array(N);
const kmPerDegree = EARTH_MERIDIONAL_KM / 180;
const radiusSteps = Math.ceil(FLOOD_SEARCH_RADIUS_KM / ELEVATION_SAMPLE_STEP_KM);
for (let cell = 0; cell < N; cell++) {
  const d = direction[cell] ?? RIVER_DIR_NODATA;
  if (d > 7 || accumulation[cell]! < FINE_CHANNEL_ACCUM_MIN) continue;
  const x = cell % OUT_W;
  const y = (cell - x) / OUT_W;
  const baseLat = 90 - ((y + 0.5) / OUT_H) * 180;
  const baseLon = ((x + 0.5) / OUT_W) * 360 - 180;
  const floor = Math.max(0, valueAt(baseLat, baseLon));
  const px = -D8_DY[d]!;
  const py = D8_DX[d]!;
  let hits = 0;
  for (let lateral = -radiusSteps; lateral <= radiusSteps; lateral++) {
    const lat = baseLat + py * lateral * ELEVATION_SAMPLE_STEP_KM / kmPerDegree;
    const lon = baseLon + px * lateral * ELEVATION_SAMPLE_STEP_KM
      / (kmPerDegree * Math.max(0.05, Math.cos((baseLat * Math.PI) / 180)));
    const height = valueAt(lat, lon);
    if (height >= floor && height <= floor + FLOOD_STAGE_M) hits++;
  }
  flood[cell] = Math.min(255, Math.round((hits / (radiusSteps * 2 + 1)) * 255));
}

const targetPath = fileURLToPath(new URL("../src/ported/worldgen/riverDirData.js", import.meta.url));
const current = readFileSync(targetPath, "utf8");
const floodB64 = Buffer.from(flood).toString("base64");
const lakeB64 = Buffer.from(lakeMask).toString("base64");
const withFlood = current.replace(
  /export const RIVER_FLOOD\s*=\s*"[^"]*";/,
  `export const RIVER_FLOOD="${floodB64}";`,
);
const output = withFlood.replace(
  /export const LAKE_MASK\s*=\s*"[^"]*";/,
  `export const LAKE_MASK="${lakeB64}";`,
);
writeFileSync(targetPath, output);
let floodMax = 0;
for (const value of flood) if (value > floodMax) floodMax = value;
console.log(JSON.stringify({
  lakePixels: lakeMask.reduce((sum, value) => sum + value, 0),
  floodPixels: flood.reduce((sum, value) => sum + (value > 0 ? 1 : 0), 0),
  floodMax,
}));

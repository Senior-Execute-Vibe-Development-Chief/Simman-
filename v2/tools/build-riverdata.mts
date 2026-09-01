/**
 * Bake real river GEOMETRY: src/ported/worldgen/riverDirData.js from the
 * HydroSHEDS v1 global 5-arcmin flow-direction grid.
 *
 * Why (owner directive 2026-09-01, QUESTIONS.md #21): rivers were DERIVED by
 * D8 routing over our elevation raster, whose ~20 m byte steps of cell
 * averages carry no signal in flat basins — exactly where real rivers are
 * decided by 1-3 m of relief. The result merged the Tigris and Euphrates
 * into one channel, combed the Congo cuvette into parallel terraces, and
 * fragmented the Mississippi. Per R7 the Earth's river geometry is DATA
 * (like the coastline and the winds); only the water AMOUNTS stay emergent —
 * the sim still accumulates moisture-driven runoff through this geometry.
 *
 * Source (fetch + unzip before running; pass the .tif path as argv):
 *   https://data.hydrosheds.org/file/hydrosheds-v1-dir/hyd_glo_dir_5m.zip
 *   HydroSHEDS v1 © World Wildlife Fund — Lehner, B., Verdin, K., Jarvis, A.
 *   (2008), doi:10.1029/2008EO100001. License: CC-BY 4.0 (attribution above).
 *   Grid: 4320×1680, 5 arc-min, origin 180°W 84°N (covers 84°N..56°S),
 *   LZW-tiled GeoTIFF; ESRI D8 codes 1,2,4,8,16,32,64,128 = E,SE,S,SW,W,NW,
 *   N,NE; 0 = terminal (river mouth or inland sink); 255 = ocean/nodata.
 *
 * Output raster: 1920×960 (the earthData grid), one byte per cell:
 *   0-7  = D8 flow direction in the sim's rose (E=0,SE=1,S=2,SW=3,W=4,NW=5,
 *          N=6,NE=7 — ESRI code 2^i maps to index i);
 *   8    = terminal inland sink (endorheic; flow pools);
 *   255  = no data (ocean, or beyond 84°N/56°S) — the sim falls back to
 *          elevation-derived directions there.
 *
 * Downsampling is DOMINANT RIVER TRACING: each coarse cell is represented by
 * its highest-accumulation fine cell; the fine flow path is walked until it
 * settles in another coarse cell, which fixes the coarse direction. Cycles
 * the projection creates are broken deterministically (next candidate along
 * the same fine path; terminal as last resort, count reported).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SRC_W = 4320;
const SRC_H = 1680;
const SRC_LAT0 = 84; // top edge
const SRC_PER_DEG = 12; // 5-arcmin cells
const OUT_W = 1920;
const OUT_H = 960;
const TERMINAL = 8;
const NODATA = 255;
const FLOOD_STAGE_M = 8; // pre-dam great-river flood crest above low water
const FLOOD_SEARCH_RADIUS_KM = 100; // physical lateral flood-spread search bound
const ELEVATION_SAMPLE_STEP_KM = 1.8; // ETOPO point-sample spacing
const FINE_CHANNEL_ACCUM_MIN = 4; // drainage cells needed to be a mapped channel
const LAKE_RASTER_SUBSAMPLES = 4; // per-axis coverage samples for majority rasterization
const LAKE_SOURCE_MIN_AREA_KM2 = 100; // skip HydroLAKES texture below the shipped-pixel scale
const D8_DX = [1, 1, 0, -1, -1, -1, 0, 1];
const D8_DY = [0, 1, 1, 1, 0, -1, -1, -1];
// ESRI code value -> our rose index (code 2^i -> i).
const ESRI_TO_ROSE = new Map([[1, 0], [2, 1], [4, 2], [8, 3], [16, 4], [32, 5], [64, 6], [128, 7]]);

// ── Minimal little-endian TIFF reader for this exact file class:
//    single strip-less tiled IFD, 8-bit single sample, LZW, no predictor. ──
function readTiff(path: string): Uint8Array {
  const buf = readFileSync(path);
  if (buf.readUInt16LE(0) !== 0x4949 || buf.readUInt16LE(2) !== 42) throw new Error("not a little-endian TIFF");
  const ifd = buf.readUInt32LE(4);
  const entries = buf.readUInt16LE(ifd);
  const tag: Record<number, { type: number; count: number; value: number }> = {};
  for (let i = 0; i < entries; i++) {
    const off = ifd + 2 + i * 12;
    tag[buf.readUInt16LE(off)] = {
      type: buf.readUInt16LE(off + 2),
      count: buf.readUInt32LE(off + 4),
      value: buf.readUInt32LE(off + 8),
    };
  }
  const width = tag[256]?.value;
  const height = tag[257]?.value;
  const tileW = tag[322]?.value;
  const tileH = tag[323]?.value;
  const tileOffsets = tag[324];
  const tileCounts = tag[325];
  if (width !== SRC_W || height !== SRC_H) throw new Error(`unexpected grid ${width}×${height}`);
  if (tag[259]?.value !== 5) throw new Error("expected LZW compression");
  if ((tag[317]?.value ?? 1) !== 1) throw new Error("expected no predictor");
  if (!tileW || !tileH || !tileOffsets || !tileCounts) throw new Error("expected tiled layout");
  const tilesX = Math.ceil(width / tileW);
  const grid = new Uint8Array(width * height);
  for (let t = 0; t < tileOffsets.count; t++) {
    const offset = buf.readUInt32LE(tileOffsets.value + t * 4);
    const count = buf.readUInt32LE(tileCounts.value + t * 4);
    const raw = lzwDecode(buf.subarray(offset, offset + count), tileW * tileH);
    const ty = Math.floor(t / tilesX);
    const tx = t - ty * tilesX;
    for (let r = 0; r < tileH; r++) {
      const gy = ty * tileH + r;
      if (gy >= height) break;
      const gx = tx * tileW;
      const n = Math.min(tileW, width - gx);
      grid.set(raw.subarray(r * tileW, r * tileW + n), gy * width + gx);
    }
  }
  return grid;
}

// TIFF-flavour LZW (MSB-first codes, 9→12 bits, early change).
function lzwDecode(src: Uint8Array, expected: number): Uint8Array {
  const out = new Uint8Array(expected);
  let outLen = 0;
  const prefix = new Int32Array(4096);
  const suffix = new Uint8Array(4096);
  const stack = new Uint8Array(4096);
  let tableSize = 258;
  let width = 9;
  let prev = -1;
  let bitBuf = 0;
  let bitCnt = 0;
  let pos = 0;
  const emit = (code: number): number => {
    let sp = 0;
    let c = code;
    while (c >= 256) { stack[sp++] = suffix[c]!; c = prefix[c]!; }
    const first = c;
    out[outLen++] = c;
    while (sp > 0) out[outLen++] = stack[--sp]!;
    return first;
  };
  for (;;) {
    while (bitCnt < width && pos < src.length) { bitBuf = (bitBuf << 8) | src[pos++]!; bitCnt += 8; }
    if (bitCnt < width) break;
    const code = (bitBuf >>> (bitCnt - width)) & ((1 << width) - 1);
    bitCnt -= width;
    if (code === 256) { tableSize = 258; width = 9; prev = -1; continue; }
    if (code === 257) break;
    if (prev < 0) {
      emit(code);
      prev = code;
    } else {
      let first: number;
      if (code < tableSize) first = emit(code);
      else { // KwKwK
        let c = prev, f = c;
        while (f >= 256) f = prefix[f]!;
        emit(prev);
        out[outLen++] = f;
        first = f;
      }
      prefix[tableSize] = prev;
      suffix[tableSize] = first;
      tableSize++;
      prev = code;
    }
    if (tableSize + 1 >= 1 << width && width < 12) width++;
  }
  return out.subarray(0, outLen);
}

interface LakeShape {
  readonly bbox: readonly [number, number, number, number];
  readonly parts: readonly number[];
  readonly points: readonly [number, number][];
}

function readDbfAreas(path: string): Float64Array {
  const buf = readFileSync(path);
  const records = buf.readUInt32LE(4);
  const headerLength = buf.readUInt16LE(8);
  const recordLength = buf.readUInt16LE(10);
  let fieldOffset = 32;
  let recordFieldOffset = 1; // DBF records begin with the deletion flag
  let areaOffset = -1;
  let areaLength = 0;
  while (fieldOffset + 32 <= headerLength && buf[fieldOffset] !== 0x0d) {
    const name = buf.toString("latin1", fieldOffset, fieldOffset + 11).replace(/\0.*$/, "").trim().toLowerCase();
    if (name === "lake_area" || name === "lakearea") {
      areaOffset = recordFieldOffset;
      areaLength = buf[fieldOffset + 16] ?? 0;
    }
    recordFieldOffset += buf[fieldOffset + 16] ?? 0;
    fieldOffset += 32;
  }
  if (areaOffset < 0 || areaLength <= 0) throw new Error("HydroLAKES DBF has no Lake_area field");
  const areas = new Float64Array(records);
  for (let record = 0; record < records; record++) {
    const start = headerLength + record * recordLength;
    if (buf[start] === 0x2a) continue;
    areas[record] = Number.parseFloat(
      buf.toString("ascii", start + areaOffset, start + areaOffset + areaLength).trim(),
    ) || 0;
  }
  return areas;
}

function readPolygonRecord(buf: Buffer, offset: number): LakeShape | null {
  const shapeType = buf.readInt32LE(offset);
  if (shapeType === 0) return null;
  if (shapeType !== 5 && shapeType !== 15 && shapeType !== 25) {
    throw new Error(`unsupported HydroLAKES shape type ${shapeType}`);
  }
  const bbox: [number, number, number, number] = [
    buf.readDoubleLE(offset + 4),
    buf.readDoubleLE(offset + 12),
    buf.readDoubleLE(offset + 20),
    buf.readDoubleLE(offset + 28),
  ];
  const partsCount = buf.readInt32LE(offset + 36);
  const pointCount = buf.readInt32LE(offset + 40);
  const parts: number[] = [];
  for (let part = 0; part < partsCount; part++) parts.push(buf.readInt32LE(offset + 44 + part * 4));
  const pointsOffset = offset + 44 + partsCount * 4;
  const points: [number, number][] = [];
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
    const crosses = (yi > y) !== (yj > y)
      && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
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

const inputPath = process.argv[2];
if (!inputPath) throw new Error("usage: build-riverdata.mts <hyd_glo_dir_5m.tif> [etopo .nc] [HydroLAKES .shp]");

const lakePath = process.argv.slice(2).find((arg) => arg.toLowerCase().endsWith(".shp"));
const lakeMask = new Uint8Array(OUT_W * OUT_H);
const earthSource = readFileSync(
  fileURLToPath(new URL("../src/ported/worldgen/earthData.js", import.meta.url)),
  "utf8",
);
const earthMatch = earthSource.match(/export const EARTH_ELEV="([^"]+)"/);
if (!earthMatch) throw new Error("EARTH_ELEV not found for lake rasterization");
const earthRaster = Buffer.from(earthMatch[1]!, "base64");
if (lakePath) {
  const dbfPath = lakePath.replace(/\.[^.]+$/, ".dbf");
  const areas = readDbfAreas(dbfPath);
  const shp = readFileSync(lakePath);
  const shapeType = shp.readInt32LE(32);
  if (shapeType !== 5) throw new Error(`expected HydroLAKES Polygon shapefile, got ${shapeType}`);
  const recordCount = areas.length;
  let considered = 0;
  let records = 0;
  let offset = 100;
  while (offset + 8 <= shp.length && records < recordCount) {
    const contentBytes = shp.readInt32BE(offset + 4) * 2;
    const content = offset + 8;
    const area = areas[records] ?? 0;
    if (area >= LAKE_SOURCE_MIN_AREA_KM2 && content + contentBytes <= shp.length) {
      const shape = readPolygonRecord(shp, content);
      if (shape) {
        considered++;
        const [minLon, minLat, maxLon, maxLat] = shape.bbox;
        const x0 = Math.max(0, Math.floor(((minLon + 180) / 360) * OUT_W) - 1);
        const x1 = Math.min(OUT_W - 1, Math.ceil(((maxLon + 180) / 360) * OUT_W) + 1);
        const y0 = Math.max(0, Math.floor(((90 - maxLat) / 180) * OUT_H) - 1);
        const y1 = Math.min(OUT_H - 1, Math.ceil(((90 - minLat) / 180) * OUT_H) + 1);
        for (let oy = y0; oy <= y1; oy++) {
          for (let ox = x0; ox <= x1; ox++) {
            const o = oy * OUT_W + ox;
            if (lakeMask[o]) continue;
            // A body already represented by the Earth sea mask is sea-class,
            // not a W1 lake. Positive-elevation polygons are the only ones
            // allowed to enter this layer.
            const earthWater = (earthRaster[o] ?? 0) < 3;
            if (earthWater) continue;
            let inside = 0;
            for (let sy = 0; sy < LAKE_RASTER_SUBSAMPLES; sy++) {
              for (let sx = 0; sx < LAKE_RASTER_SUBSAMPLES; sx++) {
                const lon = -180 + ((ox + (sx + 0.5) / LAKE_RASTER_SUBSAMPLES) / OUT_W) * 360;
                const lat = 90 - ((oy + (sy + 0.5) / LAKE_RASTER_SUBSAMPLES) / OUT_H) * 180;
                if (pointInShape(lon, lat, shape)) inside++;
              }
            }
            if (inside >= (LAKE_RASTER_SUBSAMPLES * LAKE_RASTER_SUBSAMPLES) / 2) lakeMask[o] = 1;
          }
        }
      }
    }
    offset += 8 + contentBytes;
    records++;
  }
  console.log(`HydroLAKES polygons rasterized: ${considered} candidates; ${lakeMask.reduce((sum, value) => sum + value, 0)} data pixels`);
} else {
  console.log("no HydroLAKES .shp given — LAKE_MASK emitted as empty");
}
const esri = readTiff(inputPath);
console.log("decoded source grid");

// Optional ETOPO grid (the earthData fetch, 6-arcmin stride of the 1-arcmin
// model: POINT samples with ~1.8 km footprints) for the channel FLOOR
// profile. A 22 km cell average cannot tell a cataract field from a
// navigable glide — the Livingstone gorge smears to its 0.77 m/km mean —
// but 1.8 km samples near the channel resolve the real steps.
let etopo: { data: Float64Array; w: number; h: number } | null = null;
{
  const ncPath = process.argv.slice(3).find((arg) => arg.endsWith(".nc"));
  if (ncPath) {
    const nc = readNetcdfAltitude(ncPath);
    etopo = { data: nc.data, w: nc.dims[1]!, h: nc.dims[0]! };
    console.log(`etopo floor grid ${etopo.w}×${etopo.h}`);
  }
}

// Minimal NetCDF-3 reader (same file class as tools/build-earthdata.mts).
function readNetcdfAltitude(path: string): { dims: number[]; data: Float64Array } {
  const buf = readFileSync(path);
  if (buf.toString("latin1", 0, 3) !== "CDF") throw new Error("not a NetCDF-3 file");
  let off = 4;
  const u32 = () => { const v = buf.readUInt32BE(off); off += 4; return v; };
  const name = () => {
    const n = u32();
    const s = buf.toString("latin1", off, off + n);
    off += n + ((4 - (n % 4)) % 4);
    return s;
  };
  u32();
  const dimSizes: number[] = [];
  const dimTag = u32();
  const dimCount = u32();
  if (dimTag === 10) for (let i = 0; i < dimCount; i++) { name(); dimSizes.push(u32()); }
  const skipAttrs = () => {
    const tag = u32();
    const count = u32();
    if (tag === 0 && count === 0) return;
    for (let i = 0; i < count; i++) {
      name();
      const type = u32();
      const n = u32();
      const size = [0, 1, 1, 2, 4, 4, 8][type] ?? 1;
      const bytes = n * size;
      off += bytes + ((4 - (bytes % 4)) % 4);
    }
  };
  skipAttrs();
  const varTag = u32();
  const varCount = u32();
  if (varTag !== 11) throw new Error("no variables");
  let found: { dims: number[]; begin: number; count: number; type: number } | undefined;
  for (let i = 0; i < varCount; i++) {
    const varName = name();
    const rank = u32();
    const dims: number[] = [];
    for (let d = 0; d < rank; d++) dims.push(dimSizes[u32()] ?? 0);
    skipAttrs();
    const type = u32();
    u32();
    const begin = u32();
    if (varName === "altitude") found = { dims, begin, count: dims.reduce((a, b) => a * b, 1), type };
  }
  if (!found) throw new Error("altitude variable missing");
  const data = new Float64Array(found.count);
  for (let i = 0; i < found.count; i++) {
    data[i] = found.type === 3 ? buf.readInt16BE(found.begin + i * 2) : buf.readDoubleBE(found.begin + i * 8);
  }
  return { dims: found.dims, data };
}

// Remap to rose indices; 0 → TERMINAL, 255 → NODATA, anything else invalid.
const fineDir = new Uint8Array(SRC_W * SRC_H);
for (let i = 0; i < esri.length; i++) {
  const v = esri[i]!;
  fineDir[i] = v === 255 ? NODATA : v === 0 ? TERMINAL : (ESRI_TO_ROSE.get(v) ?? NODATA);
}

// Estuary rescue: HydroSHEDS marks inland water (estuaries, lagoons, delta
// channels) as TERMINAL blobs. A terminal cell CONNECTED to receiving water
// through other terminal cells is estuarine WATER, not a sink — rewrite its
// direction one step toward that water (its BFS parent), so the Amazon,
// Mississippi, Ganges, Plata and every delta discharge instead of pooling at
// the coast. "Receiving water" is the HydroSHEDS ocean (nodata) PLUS any cell
// that is WATER in the shipped elevation raster (earthData bytes 0-2) — the
// map's own sea-class basins (the Caspian) receive their rivers (the Volga)
// even though HydroSHEDS classes them inland. A terminal blob with no such
// contact (a playa, the Qattara floor, the Aral's dry basin) stays a true
// sink.
{
  const earthModule = readFileSync(
    fileURLToPath(new URL("../src/ported/worldgen/earthData.js", import.meta.url)),
    "utf8",
  );
  const earthMatch = earthModule.match(/export const EARTH_ELEV="([^"]+)"/);
  if (!earthMatch) throw new Error("EARTH_ELEV not found for the rescue water mask");
  const earth = Buffer.from(earthMatch[1]!, "base64");
  const EARTH_W = 1920;
  const EARTH_H = 960;
  const shippedWater = (fx: number, fy: number): boolean => {
    const lat = SRC_LAT0 - (fy + 0.5) / SRC_PER_DEG;
    const lon = -180 + (fx + 0.5) / SRC_PER_DEG;
    const ey = Math.min(EARTH_H - 1, Math.max(0, Math.floor(((90 - lat) / 180) * EARTH_H)));
    const ex = Math.min(EARTH_W - 1, Math.max(0, Math.floor(((lon + 180) / 360) * EARTH_W)));
    return (earth[ey * EARTH_W + ex] ?? 0) < 3;
  };
  // A terminal cell that is WATER in the shipped raster IS the sea for the
  // sim's purposes — convert it to nodata outright, so walks that reach the
  // Caspian, an estuary, or a delta lagoon read "arrived at receiving water"
  // instead of dying inside a sink field.
  let converted = 0;
  for (let i = 0; i < SRC_W * SRC_H; i++) {
    if (fineDir[i] === TERMINAL && shippedWater(i % SRC_W, Math.floor(i / SRC_W))) {
      fineDir[i] = NODATA;
      converted++;
    }
  }
  console.log(`shipped-water terminals converted to sea: ${converted}`);
  const queue: number[] = [];
  const seen = new Uint8Array(SRC_W * SRC_H);
  for (let i = 0; i < SRC_W * SRC_H; i++) {
    if (fineDir[i] === NODATA) { seen[i] = 1; queue.push(i); }
  }
  let rescued = 0;
  for (let qi = 0; qi < queue.length; qi++) {
    const i = queue[qi]!;
    const y = Math.floor(i / SRC_W);
    const x = i - y * SRC_W;
    for (let d = 0; d < 8; d++) {
      const ny = y + D8_DY[d]!;
      if (ny < 0 || ny >= SRC_H) continue;
      const j = ny * SRC_W + ((x + D8_DX[d]! + SRC_W) % SRC_W);
      if (seen[j] || fineDir[j] !== TERMINAL) continue;
      seen[j] = 1;
      // point j back toward i (the cell closer to the ocean): opposite rose.
      fineDir[j] = (d + 4) % 8;
      rescued++;
      queue.push(j);
    }
  }
  console.log(`estuary rescue: ${rescued} terminal cells rewired toward the ocean`);
}

// Optional debug window: argv[3] = "lat,lon" prints the post-rescue fine
// neighbourhood (O = terminal, ~ = nodata, digits = rose directions).
if (process.argv[3]?.includes(",")) {
  const [lat, lon] = process.argv[3].split(",").map(Number) as [number, number];
  const fy = Math.floor((SRC_LAT0 - lat) * SRC_PER_DEG);
  const fx = Math.floor((lon + 180) * SRC_PER_DEG);
  console.log(`fine window around ${lat},${lon}:`);
  for (let dy = -10; dy <= 10; dy++) {
    let line = "";
    for (let dx = -14; dx <= 14; dx++) {
      const v = fineDir[(fy + dy) * SRC_W + fx + dx];
      line += v === NODATA ? "~" : v === TERMINAL ? "O" : String(v);
    }
    console.log("  " + line);
  }
}

// Fine accumulation (uniform weight — only ranks representatives for tracing).
function accumulate(dir: Uint8Array, w: number, h: number): Float64Array {
  const n = w * h;
  const target = new Int32Array(n).fill(-1);
  const indeg = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const d = dir[i]!;
    if (d > 7) continue;
    const y = Math.floor(i / w);
    const ny = y + D8_DY[d]!;
    if (ny < 0 || ny >= h) continue;
    const j = ny * w + ((i - y * w + D8_DX[d]! + w) % w);
    target[i] = j;
    indeg[j]!++;
  }
  const acc = new Float64Array(n).fill(1);
  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;
  for (let i = 0; i < n; i++) if (indeg[i] === 0) queue[tail++] = i;
  while (head < tail) {
    const i = queue[head++]!;
    const j = target[i]!;
    if (j >= 0) {
      acc[j]! += acc[i]!;
      if (--indeg[j]! === 0) queue[tail++] = j;
    }
  }
  if (head !== n) console.log(`warning: ${n - head} cells in source cycles`);
  return acc;
}
const fineAcc = accumulate(fineDir, SRC_W, SRC_H);

// Map each fine cell center to its coarse pixel.
function coarseOf(fx: number, fy: number): number {
  const lat = SRC_LAT0 - (fy + 0.5) / SRC_PER_DEG;
  const lon = -180 + (fx + 0.5) / SRC_PER_DEG;
  const oy = Math.min(OUT_H - 1, Math.max(0, Math.floor(((90 - lat) / 180) * OUT_H)));
  const ox = Math.min(OUT_W - 1, Math.max(0, Math.floor(((lon + 180) / 360) * OUT_W)));
  return oy * OUT_W + ox;
}

// Representative fine cell per coarse pixel = max fine accumulation.
const rep = new Int32Array(OUT_W * OUT_H).fill(-1);
for (let fy = 0; fy < SRC_H; fy++) {
  for (let fx = 0; fx < SRC_W; fx++) {
    const fi = fy * SRC_W + fx;
    if (fineDir[fi] === NODATA) continue;
    const o = coarseOf(fx, fy);
    if (rep[o] < 0 || fineAcc[fi]! > fineAcc[rep[o]!]!) rep[o] = fi;
  }
}

// Trace each representative's fine path; record up to 3 distinct coarse
// cells it enters (candidates for the coarse direction, cycle repair uses
// the later ones), or terminal.
const MAX_TRACE = 64;
const candidates: Int32Array = new Int32Array(OUT_W * OUT_H * 3).fill(-1);
const terminalAt = new Uint8Array(OUT_W * OUT_H);

// A fine TERMINAL cell is a river MOUTH when ocean (nodata) touches it — its
// coarse cell must then point INTO the sea so the basin reads exorheic, never
// pool as a sink (a pooling mouth marks the whole basin closed and the arid
// transmission loss erases it — this wiped the Tigris-Euphrates). Returns the
// fine direction of the first adjacent nodata cell, or -1 for a true sink.
function mouthDirection(fi: number): number {
  const fy = Math.floor(fi / SRC_W);
  const fx = fi - fy * SRC_W;
  for (let d = 0; d < 8; d++) {
    const ny = fy + D8_DY[d]!;
    if (ny < 0 || ny >= SRC_H) continue;
    if (fineDir[ny * SRC_W + ((fx + D8_DX[d]! + SRC_W) % SRC_W)] === NODATA) return d;
  }
  return -1;
}

/** Strongest directed neighbour NOT flowing into `fi` (a bypassing channel), or -1. */
function bypassNeighbor(fi: number): number {
  const fy = Math.floor(fi / SRC_W);
  const fx = fi - fy * SRC_W;
  let best = -1;
  let bestAcc = -1;
  for (let d = 0; d < 8; d++) {
    const ny = fy + D8_DY[d]!;
    if (ny < 0 || ny >= SRC_H) continue;
    const j = ny * SRC_W + ((fx + D8_DX[d]! + SRC_W) % SRC_W);
    const jd = fineDir[j]!;
    if (jd > 7) continue;
    const jy = Math.floor(j / SRC_W);
    const jny = jy + D8_DY[jd]!;
    if (jny >= 0 && jny < SRC_H
      && jny * SRC_W + ((j - jy * SRC_W + D8_DX[jd]! + SRC_W) % SRC_W) === fi) continue;
    if (fineAcc[j]! > bestAcc) { bestAcc = fineAcc[j]!; best = j; }
  }
  return best;
}

for (let o = 0; o < OUT_W * OUT_H; o++) {
  const start = rep[o]!;
  if (start < 0) continue;
  let fi = start;
  let found = 0;
  for (let step = 0; step < MAX_TRACE && found < 3; step++) {
    const d = fineDir[fi]!;
    if (d === TERMINAL || d === NODATA) {
      const seaward = d === NODATA ? 0 : mouthDirection(fi);
      if (seaward >= 0) {
        // Mouth: continue seaward until the coarse cell changes, so the
        // coarse direction discharges into the ocean.
        let mx = fi % SRC_W;
        let my = Math.floor(fi / SRC_W);
        for (let extend = 0; extend < 8 && found < 3; extend++) {
          mx = (mx + D8_DX[seaward]! + SRC_W) % SRC_W;
          my += D8_DY[seaward]!;
          if (my < 0 || my >= SRC_H) break;
          const cc = coarseOf(mx, my);
          if (cc !== o && (found === 0 || candidates[o * 3 + found - 1] !== cc)) {
            candidates[o * 3 + found] = cc;
            found++;
            break;
          }
        }
        break;
      }
      // Unrescued pocket (enclosed delta water): hop onto the strongest
      // adjacent BYPASSING channel — a braid pond spills into the
      // distributary beside it. A true sink never qualifies: all its
      // directed neighbours flow INTO it.
      const hop = bypassNeighbor(fi);
      if (hop >= 0) {
        fi = hop;
        const hy = Math.floor(fi / SRC_W);
        const cc = coarseOf(fi % SRC_W, hy);
        if (cc !== o && (found === 0 || candidates[o * 3 + found - 1] !== cc)) {
          candidates[o * 3 + found] = cc;
          found++;
        }
        continue;
      }
      if (found === 0) terminalAt[o] = 2; // true inland sink
      break;
    }
    const fy = Math.floor(fi / SRC_W);
    const ny = fy + D8_DY[d]!;
    if (ny < 0 || ny >= SRC_H) break;
    fi = ny * SRC_W + ((fi - fy * SRC_W + D8_DX[d]! + SRC_W) % SRC_W);
    const cc = coarseOf(fi % SRC_W, ny);
    if (cc !== o && (found === 0 || candidates[o * 3 + found - 1] !== cc)) {
      candidates[o * 3 + found] = cc;
      found++;
    }
  }
}

// Direction from coarse cell o toward coarse cell c (nearest D8 rose index).
function roseToward(o: number, c: number): number {
  const oy = Math.floor(o / OUT_W);
  const ox = o - oy * OUT_W;
  const cy = Math.floor(c / OUT_W);
  const cx = c - cy * OUT_W;
  let dx = cx - ox;
  if (dx > OUT_W / 2) dx -= OUT_W;
  if (dx < -OUT_W / 2) dx += OUT_W;
  const dy = cy - oy;
  const angle = Math.atan2(dy, dx); // screen: +y south
  const sector = Math.round(angle / (Math.PI / 4));
  return ((sector % 8) + 8) % 8; // 0=E,1=SE,2=S,...,7=NE
}

const out = new Uint8Array(OUT_W * OUT_H).fill(NODATA);
for (let o = 0; o < OUT_W * OUT_H; o++) {
  if (rep[o]! < 0) continue;
  if (terminalAt[o] === 2) { out[o] = TERMINAL; continue; }
  const first = candidates[o * 3];
  if (first !== undefined && first >= 0) out[o] = roseToward(o, first);
  else out[o] = TERMINAL;
}

// The rose clamp can point at a coarse cell other than the traced one; that
// plus projection can create cycles. Break them deterministically: follow
// each cell's chain; a cell revisited in the same walk is in a cycle — retry
// its later candidates; if none escapes, it becomes terminal.
function targetOf(o: number): number {
  const d = out[o]!;
  if (d > 7) return -1;
  const oy = Math.floor(o / OUT_W);
  const ny = oy + D8_DY[d]!;
  if (ny < 0 || ny >= OUT_H) return -1;
  return ny * OUT_W + ((o - oy * OUT_W + D8_DX[d]! + OUT_W) % OUT_W);
}
let broken = 0;
for (let round = 0; round < 5; round++) {
  let brokenThisRound = 0;
  const stamp = new Int32Array(OUT_W * OUT_H).fill(-1);
  const resolved = new Uint8Array(OUT_W * OUT_H);
  for (let s = 0; s < OUT_W * OUT_H; s++) {
    if (out[s]! > 7 || resolved[s]) continue;
    let o = s;
    const path: number[] = [];
    while (o >= 0 && !resolved[o] && out[o]! <= 7) {
      if (stamp[o] === s) {
        // Cycle found: repair the weakest cell that HAS an escape candidate
        // (checking every cycle cell before ever giving up) — a terminal
        // fallback on a mainstem dams the whole river upstream.
        let c = targetOf(o);
        const cycle = [o];
        while (c !== o && c >= 0) { cycle.push(c); c = targetOf(c); }
        cycle.sort((a, b) =>
          (rep[a]! >= 0 ? fineAcc[rep[a]!]! : 0) - (rep[b]! >= 0 ? fineAcc[rep[b]!]! : 0));
        let fixed = false;
        for (const cell of cycle) {
          for (let k = 1; k < 3 && !fixed; k++) {
            const cand = candidates[cell * 3 + k]!;
            if (cand >= 0 && !cycle.includes(cand)) {
              out[cell] = roseToward(cell, cand);
              fixed = true;
            }
          }
          if (fixed) break;
        }
        if (!fixed) out[cycle[0]!] = TERMINAL;
        brokenThisRound++;
        break;
      }
      stamp[o] = s;
      path.push(o);
      o = targetOf(o);
    }
    for (const cell of path) resolved[cell] = 1;
  }
  broken += brokenThisRound;
  if (brokenThisRound === 0) break;
}
console.log(`coarse cells with data: ${out.filter((v) => v !== NODATA).length}; cycles broken: ${broken}`);

// ── Measured floodplain fractions (QUESTIONS.md #23) ──
// A floodplain is the share of the local cross-section that lies within a
// real flood stage of the channel floor. It is deliberately not a corridor
// mask: a narrow river in a broad cell contributes only a narrow fraction.
const floodOut = new Uint8Array(OUT_W * OUT_H);
if (etopo) {
  const { data: eData, w: eW, h: eH } = etopo;
  const kmPerDegree = 20004 / 180;
  const eValue = (lat: number, lon: number): number => {
    const ey = Math.max(0, Math.min(eH - 1, Math.round(((lat + 90) / 180) * (eH - 1))));
    const wrappedLon = ((lon + 180) % 360 + 360) % 360 - 180;
    const ex = Math.max(0, Math.min(eW - 1, Math.round(((wrappedLon + 180) / 360) * (eW - 1))));
    return eData[ey * eW + ex] ?? 0;
  };
  const channelFloor = (fx: number, fy: number): number => {
    const lat = SRC_LAT0 - (fy + 0.5) / SRC_PER_DEG;
    const lon = -180 + (fx + 0.5) / SRC_PER_DEG;
    let minimum = Infinity;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const sampleLat = lat + dy * ELEVATION_SAMPLE_STEP_KM / kmPerDegree;
        const sampleLon = lon + dx * ELEVATION_SAMPLE_STEP_KM
          / (kmPerDegree * Math.max(0.05, Math.cos((lat * Math.PI) / 180)));
        minimum = Math.min(minimum, eValue(sampleLat, sampleLon));
      }
    }
    return Math.max(0, minimum);
  };
  const radiusSteps = Math.ceil(FLOOD_SEARCH_RADIUS_KM / ELEVATION_SAMPLE_STEP_KM);
  let measured = 0;
  for (let o = 0; o < OUT_W * OUT_H; o++) {
    const fi = rep[o]!;
    if (fi < 0 || fineDir[fi]! > 7 || fineAcc[fi]! < FINE_CHANNEL_ACCUM_MIN) continue;
    const fy = Math.floor(fi / SRC_W);
    const fx = fi - fy * SRC_W;
    const direction = fineDir[fi]!;
    const px = -D8_DY[direction]!;
    const py = D8_DX[direction]!;
    const baseLat = SRC_LAT0 - (fy + 0.5) / SRC_PER_DEG;
    const baseLon = -180 + (fx + 0.5) / SRC_PER_DEG;
    const floor = channelFloor(fx, fy);
    let hits = 0;
    for (let offset = -radiusSteps; offset <= radiusSteps; offset++) {
      const lat = baseLat + py * offset * ELEVATION_SAMPLE_STEP_KM / kmPerDegree;
      const lon = baseLon + px * offset * ELEVATION_SAMPLE_STEP_KM
        / (kmPerDegree * Math.max(0.05, Math.cos((baseLat * Math.PI) / 180)));
      const height = eValue(lat, lon);
      if (height >= floor && height <= floor + FLOOD_STAGE_M) hits++;
    }
    floodOut[o] = Math.min(255, Math.round((hits / (radiusSteps * 2 + 1)) * 255));
    measured++;
  }
  console.log(`floodplain fractions measured for ${measured} data pixels`);
} else {
  console.log("no etopo grid given — RIVER_FLOOD baked as all-zero");
}

// ── Channel-floor reach gradients (QUESTIONS.md #22) ──
// Per fine channel cell: walk ~100 km downstream along the fine path and take
// the STEEPEST ~28 km sub-reach of the channel-floor profile — the worst
// water a boat must pass in that reach. The floor at a fine cell is the
// minimum ETOPO point-sample (1.8 km footprints) in its 3×3 neighbourhood —
// fine enough that the Livingstone gorge's real steps resolve instead of
// smearing into their navigable-looking 100 km mean, while the Nile's
// floodplain floor reads flat because a near-channel sample sees the valley,
// not the walls. Profile smoothed by a ±1-step running MIN so a single
// wall-contaminated floor sample cannot fake a cataract. Encoded 1/16 m/km
// per byte (0..15.8), 255 = no data.
const GRAD_NODATA = 255;
const gradOut = new Uint8Array(OUT_W * OUT_H).fill(GRAD_NODATA);
if (etopo) {
  const { data: eData, w: eW, h: eH } = etopo;
  const floorOf = (fx: number, fy: number): number => {
    const lat = SRC_LAT0 - (fy + 0.5) / SRC_PER_DEG;
    const lon = -180 + (fx + 0.5) / SRC_PER_DEG;
    const ey = Math.round(((lat + 90) / 180) * (eH - 1)); // ETOPO rows ascend from -90
    const ex = Math.round(((lon + 180) / 360) * (eW - 1));
    let minimum = Infinity;
    for (let dy = -1; dy <= 1; dy++) {
      const y = ey + dy;
      if (y < 0 || y >= eH) continue;
      for (let dx = -1; dx <= 1; dx++) {
        const x = Math.min(eW - 1, Math.max(0, ex + dx));
        const v = eData[y * eW + x] ?? 0;
        if (v < minimum) minimum = v;
      }
    }
    return Math.max(0, minimum); // the water surface never sits below sea level
  };
  const SUB_STEPS = 3;   // ~28 km sub-reach
  const MAX_STEPS = 11;  // ~100 km walk
  const KM_PER_FINE_NS = 9.27;
  const fineGrad = new Float32Array(SRC_W * SRC_H).fill(-1);
  for (let fi = 0; fi < SRC_W * SRC_H; fi++) {
    if (fineDir[fi]! > 7) continue;
    // Collect the floor profile along the walk (with per-step km).
    const floors: number[] = [];
    const kms: number[] = [0];
    let current = fi;
    for (let step = 0; step <= MAX_STEPS; step++) {
      const fy = Math.floor(current / SRC_W);
      floors.push(floorOf(current - fy * SRC_W, fy));
      const d = fineDir[current]!;
      if (d > 7) break;
      const ny = fy + D8_DY[d]!;
      if (ny < 0 || ny >= SRC_H) break;
      const lat = SRC_LAT0 - (fy + 0.5) / SRC_PER_DEG;
      const ew = D8_DX[d]! !== 0 ? KM_PER_FINE_NS * Math.cos((lat * Math.PI) / 180) : 0;
      const ns = D8_DY[d]! !== 0 ? KM_PER_FINE_NS : 0;
      kms.push((kms[kms.length - 1] ?? 0) + Math.sqrt(ew * ew + ns * ns));
      current = ny * SRC_W + ((current - fy * SRC_W + D8_DX[d]! + SRC_W) % SRC_W);
    }
    // ±1-step running-min smoothing.
    const smooth = floors.map((_, index) => Math.min(
      floors[index]!,
      floors[index - 1] ?? Infinity,
      floors[index + 1] ?? Infinity,
    ));
    let worst = 0;
    for (let start = 0; start + SUB_STEPS < smooth.length; start++) {
      const drop = (smooth[start] ?? 0) - (smooth[start + SUB_STEPS] ?? 0);
      const km = (kms[start + SUB_STEPS] ?? 0) - (kms[start] ?? 0);
      if (drop > 0 && km > 0) worst = Math.max(worst, drop / km);
    }
    fineGrad[fi] = worst;
  }
  // Bake at each coarse cell's dominant (representative) fine cell.
  let graded = 0;
  for (let o = 0; o < OUT_W * OUT_H; o++) {
    const fi = rep[o]!;
    if (fi < 0 || (fineGrad[fi] ?? -1) < 0) continue;
    gradOut[o] = Math.min(254, Math.round(fineGrad[fi]! * 16));
    graded++;
  }
  console.log(`floor gradients baked for ${graded} coarse cells`);
} else {
  console.log("no etopo grid given — RIVER_GRAD baked as all-nodata");
}

const header = `/* V2 DATA — real river geometry (recorded deviation, QUESTIONS.md #21)
 * RIVER_DIR: global D8 flow directions at 1920x960 (the earthData grid),
 * baked 2026-09-01 by tools/build-riverdata.mts from the HydroSHEDS v1
 * 5-arcmin global flow-direction grid via dominant river tracing.
 * HydroSHEDS v1 © World Wildlife Fund — Lehner, Verdin & Jarvis (2008),
 * doi:10.1029/2008EO100001, https://www.hydrosheds.org (CC-BY 4.0).
 * Bytes: 0-7 = flow direction (E=0,SE=1,S=2,SW=3,W=4,NW=5,N=6,NE=7 — the
 * sim's D8 rose), 8 = terminal inland sink, 255 = no data (ocean, or
 * beyond the source's 84N..56S coverage; the sim derives those from
 * elevation as before). Earth presets take river GEOMETRY from this data;
 * runoff, accumulation and magnitude stay emergent from climate (R7).
 *
 * RIVER_GRAD (QUESTIONS.md #22): the channel-floor reach gradient at each
 * coarse cell's dominant channel — the steepest ~28 km sub-reach of the
 * next ~100 km, measured on 1.8 km ETOPO point-samples along the HydroSHEDS
 * path (a 22 km cell average smears the Livingstone cataracts into a
 * navigable-looking mean; the fine floor profile keeps their real steps).
 * Encoding: 1/16 m/km per byte (0..15.8), 255 = no data.
 *
 * RIVER_FLOOD (QUESTIONS.md #23): per-data-pixel flood-stage share, measured
 * from the same ~1.8 km ETOPO point samples in a ±100 km lateral scan of
 * each dominant channel. Encoding: 0..255 = fraction 0..1.
 *
 * LAKE_MASK (QUESTIONS.md #23): positive-elevation HydroLAKES polygon
 * geometry rasterized by 4×4 majority coverage. Sea-class EARTH_ELEV pixels
 * are excluded; water activation remains an emergent inflow/evaporation
 * decision in riverGen.
 */
export const RIVER_DIR_W = ${OUT_W}, RIVER_DIR_H = ${OUT_H};
export const RIVER_DIR_TERMINAL = 8, RIVER_DIR_NODATA = 255;
export const RIVER_GRAD_NODATA = 255, RIVER_GRAD_PER_M_KM = 16;

export function decodeRiverDir(b64) {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}
`;
const b64 = Buffer.from(out).toString("base64");
const gradB64 = Buffer.from(gradOut).toString("base64");
const floodB64 = Buffer.from(floodOut).toString("base64");
const lakeB64 = Buffer.from(lakeMask).toString("base64");
const targetPath = fileURLToPath(new URL("../src/ported/worldgen/riverDirData.js", import.meta.url));
writeFileSync(targetPath, `${header}\nexport const RIVER_DIR="${b64}";\n\nexport const RIVER_GRAD="${gradB64}";\n\nexport const RIVER_FLOOD="${floodB64}";\n\nexport const LAKE_MASK="${lakeB64}";\n`);
console.log(`wrote ${targetPath}`);

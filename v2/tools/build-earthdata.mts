/**
 * Regenerate src/ported/worldgen/earthData.js from real ETOPO1 relief.
 *
 * Why this exists (owner decision 2026-09-01, QUESTIONS.md #19): the inherited
 * v1 raster derived its land/sea mask from a byte-quantized heightmap whose
 * first land step sat ~20 m above sea level, so its ocean flood-fill drowned
 * every low coastal plain on Earth — the Nile delta, Sumer (the Persian Gulf
 * reached ~32.5°N), all of Bangladesh, the Indus delta, the Bohai coast, the
 * Netherlands. Those plains are the cradle basins the M2+ gates measure
 * against, so the mask must come from data that still knows a 3 m delta is
 * land: real bathymetry/topography, masked at altitude 0 BEFORE any byte
 * quantization.
 *
 * Contract preserved (v1 consumers read the raster unchanged):
 *   - 1920×960 equirectangular, x=0 ↔ 180°W, y=0 ↔ 90°N.
 *   - ocean = byte 0 (deep) .. 2 (shelf); land = bytes 3..255.
 *   - land bytes stay LINEAR in metres at the v1 scale so the climate
 *     solver's elevation terms and the travel engine's gradient physics keep
 *     their calibration: worldgen maps byte b → (b−3)/252×0.55 elevation
 *     units and ELEVATION_METERS_PER_UNIT = 9400, giving
 *     METERS_PER_BYTE = 0.55×9400/252 ≈ 20.52 m.
 *
 * Input: an ETOPO1 grid fetched from NOAA ERDDAP (etopo180), NetCDF-3 with
 * float64 altitude[lat][lon], lat ascending from −90. Pass its path as argv.
 * The fetch used (6-arcmin stride, 1801×3601 point samples):
 *   https://coastwatch.pfeg.noaa.gov/erddap/griddap/etopo180.nc
 *     ?altitude[(-90):6:(90)][(-180):6:(180)]
 *
 * Mask rules (each a physical statement, no place names):
 *   - A pixel is WATER when the majority of its source samples lie at or
 *     below sea level (altitude ≤ 0).
 *   - OCEAN = water reachable by flood-fill from the map's E/W borders
 *     (wrapping in x), PLUS any enclosed water body of at least
 *     ENCLOSED_SEA_MIN_KM2 — a basin that large behaves as a sea for
 *     climate and navigation (the Caspian), while a smaller enclosed
 *     depression (the Dead Sea, Qattara) stays low-lying LAND for the
 *     worldgen's own lake machinery to judge.
 *   - Land below sea level (polders, endorheic floors) carries the minimum
 *     land byte 3 — the raster cannot express negative land, and ~20 m is
 *     below its quantization anyway.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const OUT_W = 1920;
const OUT_H = 960;
// Derived from the v1 decode ramp (see header): 0.55 × 9400 / 252.
const METERS_PER_BYTE = (0.55 * 9400) / 252;
// Continental-shelf shading for the two shallow-ocean bytes: the shelf break
// lies near −200 m; byte 1 marks the slope above the deep floor.
const SHELF_SHALLOW_M = -60;
const SHELF_BREAK_M = -200;
// An enclosed water body at least this large is a SEA (ocean-class): the
// Caspian (~371k km²) is the archetype; the Aral (~68k km²) is not.
const ENCLOSED_SEA_MIN_KM2 = 100_000;

// ── Minimal NetCDF-3 classic reader (big-endian, one float64 data var) ──
function readNetcdfDoubles(path: string): { dims: number[]; data: Float64Array } {
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
  u32(); // numrecs
  const dimSizes: number[] = [];
  const dimTag = u32();
  const dimCount = u32();
  if (dimTag === 10) {
    for (let i = 0; i < dimCount; i++) { name(); dimSizes.push(u32()); }
  }
  const skipAttributes = () => {
    const tag = u32();
    const count = u32();
    if (tag === 0 && count === 0) return;
    if (tag !== 12) throw new Error("unexpected attribute tag");
    for (let i = 0; i < count; i++) {
      name();
      const type = u32();
      const n = u32();
      const size = [0, 1, 1, 2, 4, 4, 8][type] ?? 1;
      const bytes = n * size;
      off += bytes + ((4 - (bytes % 4)) % 4);
    }
  };
  skipAttributes(); // global attributes
  const varTag = u32();
  const varCount = u32();
  if (varTag !== 11) throw new Error("no variables");
  let found: { dims: number[]; begin: number; count: number; type: number } | undefined;
  for (let i = 0; i < varCount; i++) {
    const varName = name();
    const rank = u32();
    const dims: number[] = [];
    for (let d = 0; d < rank; d++) dims.push(dimSizes[u32()] ?? 0);
    skipAttributes();
    const type = u32();
    u32(); // vsize
    const begin = u32();
    if (varName === "altitude") {
      if (type !== 3 && type !== 6) throw new Error(`altitude is nc_type ${type}, expected short or double`);
      found = { dims, begin, count: dims.reduce((a, b) => a * b, 1), type };
    }
  }
  if (!found) throw new Error("altitude variable missing");
  const data = new Float64Array(found.count);
  for (let i = 0; i < found.count; i++) {
    data[i] = found.type === 3
      ? buf.readInt16BE(found.begin + i * 2)
      : buf.readDoubleBE(found.begin + i * 8);
  }
  return { dims: found.dims, data };
}

const inputPath = process.argv[2];
if (!inputPath) throw new Error("usage: build-earthdata.mts <etopo.nc>");
const { dims, data } = readNetcdfDoubles(inputPath);
const [srcH, srcW] = dims as [number, number];
console.log(`source grid ${srcW}×${srcH}`);

// Source: lat ascending from −90 (row 0 = south pole), lon from −180.
// Output: row 0 = 90°N. For each output pixel, gather the source samples
// whose coordinates fall inside it.
const landFrac = new Float64Array(OUT_W * OUT_H);
const landMean = new Float64Array(OUT_W * OUT_H);
const waterMean = new Float64Array(OUT_W * OUT_H);
{
  const landSum = new Float64Array(OUT_W * OUT_H);
  const landN = new Uint32Array(OUT_W * OUT_H);
  const waterSum = new Float64Array(OUT_W * OUT_H);
  const waterN = new Uint32Array(OUT_W * OUT_H);
  for (let sy = 0; sy < srcH; sy++) {
    const lat = -90 + (180 * sy) / (srcH - 1);
    let oy = Math.floor(((90 - lat) / 180) * OUT_H);
    if (oy >= OUT_H) oy = OUT_H - 1;
    for (let sx = 0; sx < srcW; sx++) {
      const lon = -180 + (360 * sx) / (srcW - 1);
      if (lon >= 180) continue; // the +180 column duplicates −180
      const ox = Math.floor(((lon + 180) / 360) * OUT_W);
      const o = oy * OUT_W + ox;
      const alt = data[sy * srcW + sx] ?? 0;
      if (alt > 0) { landSum[o] += alt; landN[o]++; }
      else { waterSum[o] += alt; waterN[o]++; }
    }
  }
  for (let o = 0; o < OUT_W * OUT_H; o++) {
    const n = (landN[o] ?? 0) + (waterN[o] ?? 0);
    if (n === 0) throw new Error(`no source samples for pixel ${o}`);
    landFrac[o] = (landN[o] ?? 0) / n;
    landMean[o] = landN[o] ? (landSum[o] ?? 0) / (landN[o] ?? 1) : 0;
    waterMean[o] = waterN[o] ? (waterSum[o] ?? 0) / (waterN[o] ?? 1) : 0;
  }
}

// Provisional water = majority of samples at or below sea level.
const water = new Uint8Array(OUT_W * OUT_H);
for (let o = 0; o < OUT_W * OUT_H; o++) water[o] = landFrac[o] < 0.5 ? 1 : 0;

// Ocean flood-fill from the E/W borders (x wraps; poles are natural seeds
// too since Antarctica's ring of ocean touches every column).
const ocean = new Uint8Array(OUT_W * OUT_H);
const queue: number[] = [];
for (let y = 0; y < OUT_H; y++) {
  for (const x of [0, OUT_W - 1]) {
    const o = y * OUT_W + x;
    if (water[o] && !ocean[o]) { ocean[o] = 1; queue.push(o); }
  }
}
for (let x = 0; x < OUT_W; x++) {
  for (const y of [0, OUT_H - 1]) {
    const o = y * OUT_W + x;
    if (water[o] && !ocean[o]) { ocean[o] = 1; queue.push(o); }
  }
}
for (let qi = 0; qi < queue.length; qi++) {
  const o = queue[qi] ?? 0;
  const y = Math.floor(o / OUT_W);
  const x = o - y * OUT_W;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    const ny = y + dy;
    if (ny < 0 || ny >= OUT_H) continue;
    const nx = (x + dx + OUT_W) % OUT_W;
    const no = ny * OUT_W + nx;
    if (water[no] && !ocean[no]) { ocean[no] = 1; queue.push(no); }
  }
}

// Enclosed water bodies: sea-sized ones become ocean; the rest become land.
const visited = new Uint8Array(OUT_W * OUT_H);
let enclosedSeas = 0;
let enclosedToLand = 0;
for (let o = 0; o < OUT_W * OUT_H; o++) {
  if (!water[o] || ocean[o] || visited[o]) continue;
  const component: number[] = [o];
  visited[o] = 1;
  for (let qi = 0; qi < component.length; qi++) {
    const c = component[qi] ?? 0;
    const y = Math.floor(c / OUT_W);
    const x = c - y * OUT_W;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const ny = y + dy;
      if (ny < 0 || ny >= OUT_H) continue;
      const nx = (x + dx + OUT_W) % OUT_W;
      const no = ny * OUT_W + nx;
      if (water[no] && !ocean[no] && !visited[no]) { visited[no] = 1; component.push(no); }
    }
  }
  // Cos-weighted area: pixel = (2πR/W)·(πR/H)·cos(lat).
  let km2 = 0;
  for (const c of component) {
    const y = Math.floor(c / OUT_W);
    const lat = ((90 - ((y + 0.5) / OUT_H) * 180) * Math.PI) / 180;
    km2 += ((2 * Math.PI * 6371) / OUT_W) * ((Math.PI * 6371) / OUT_H) * Math.cos(lat);
  }
  if (km2 >= ENCLOSED_SEA_MIN_KM2) {
    for (const c of component) ocean[c] = 1;
    enclosedSeas++;
  } else {
    for (const c of component) water[c] = 0;
    enclosedToLand += component.length;
  }
}
console.log(`enclosed seas kept as ocean: ${enclosedSeas}; enclosed pixels returned to land: ${enclosedToLand}`);

// Emit bytes.
const out = new Uint8Array(OUT_W * OUT_H);
let landPixels = 0;
for (let o = 0; o < OUT_W * OUT_H; o++) {
  if (water[o] && ocean[o]) {
    const depth = waterMean[o] ?? 0;
    out[o] = depth > SHELF_SHALLOW_M ? 2 : depth > SHELF_BREAK_M ? 1 : 0;
  } else {
    // Land: mean of above-sea samples; a returned-to-land basin floor or an
    // all-water pixel promoted by the majority rule holds the minimum byte.
    const meters = landMean[o] ?? 0;
    out[o] = Math.max(3, Math.min(255, 3 + Math.round(meters / METERS_PER_BYTE)));
    landPixels++;
  }
}
console.log(`land pixels: ${landPixels} (${((100 * landPixels) / (OUT_W * OUT_H)).toFixed(1)}%)`);

// Compare against the current raster for the report.
const targetPath = fileURLToPath(new URL("../src/ported/worldgen/earthData.js", import.meta.url));
const current = readFileSync(targetPath, "utf8");
const match = current.match(/export const EARTH_ELEV="([^"]+)"/);
if (!match) throw new Error("EARTH_ELEV not found in earthData.js");
const old = Buffer.from(match[1]!, "base64");
let landGained = 0;
let landLost = 0;
for (let o = 0; o < OUT_W * OUT_H; o++) {
  const wasLand = (old[o] ?? 0) >= 3;
  const isLand = (out[o] ?? 0) >= 3;
  if (isLand && !wasLand) landGained++;
  if (!isLand && wasLand) landLost++;
}
console.log(`vs current raster: +${landGained} land pixels gained, -${landLost} lost`);

const header = `/* V2 M1 PORT — DATA REGENERATED (recorded deviation, QUESTIONS.md #19)
 * algorithms: src/sim/earthData.js (decode/sample identical, commit 97f51dd7);
 * EARTH_ELEV: rebuilt 2026-09-01 from real ETOPO1 (NOAA ERDDAP etopo180,
 * 6-arcmin stride) by tools/build-earthdata.mts. The inherited raster's mask
 * came from a byte-quantized heightmap whose first land step sat ~20 m up, so
 * its flood-fill drowned every low coastal plain (Nile delta, Sumer, Bengal,
 * Indus, Bohai, Netherlands). The mask is now altitude>0 by sample majority,
 * BEFORE quantization; ocean = border flood-fill plus enclosed basins ≥
 * 100k km² (sea-sized: the Caspian); smaller enclosed depressions stay land.
 * Encoding contract unchanged: 1920x960 equirectangular, ocean = bytes 0-2
 * (deep/slope/shelf at -200/-60 m), land = bytes 3..255 LINEAR in metres at
 * 0.55*9400/252 ≈ 20.52 m/byte — the v1 decode ramp, so climate and gradient
 * calibrations carry over.
 */
`;
const body = current.slice(current.indexOf("export const EARTH_W"));
const b64 = Buffer.from(out).toString("base64");
writeFileSync(
  targetPath,
  `${header}export const EARTH_ELEV="${b64}";\n\n${body.slice(body.indexOf("export const EARTH_W"))}`,
);
console.log(`wrote ${targetPath}`);

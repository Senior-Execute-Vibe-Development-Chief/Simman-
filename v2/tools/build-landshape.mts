/* V2 W20 — THE SHAPE OF THE LAND
 *
 * The sim's grid is a compromise between two things it cannot serve at once:
 * a cell has to be cheap enough to step a whole world of them every month, and
 * small enough to hold the geography that matters. The shipped grid resolves
 * the first; a cell there is ~22 km on a side and holds a few hundred km2, so
 * a coast, a strait, a peninsula neck or a small island is a fraction of one
 * cell and the land/sea bit rounds it away.
 *
 * W19 measured HOW MUCH ground each cell holds (the cover plane). This bake
 * measures WHERE that ground is: a land/sea bit on a grid several times finer
 * than any grid the sim steps. It is read-only geometry — a plane the world is
 * drawn from and measured against, never one that is stepped — so its cost is
 * a fixed allocation and a fixed decode, not a per-month one.
 *
 * Rule (a physical statement, no place names):
 *   - SHAPE[cell] = 1 when MORE THAN HALF the 1-arc-minute samples inside the
 *     cell stand above sea level, else 0. `altitude > 0` is the same land test
 *     the elevation and cover bakes use, so all three planes agree on what
 *     "above sea level" means, and majority is the same rule the elevation
 *     bake's own mask uses — a cell is what most of it is.
 *
 * Consequence worth stating: ground that lies BELOW sea level but is dry
 * (endorheic floors, polders) counts as water here, exactly as in the other
 * two planes. This measures height against the sea, not dryness — QUESTIONS.md
 * records the gap. And a landform smaller than half a cell of this plane has
 * no bit of its own: the plane has a resolution limit like any other, it is
 * just a much finer one.
 *
 * Storage: the bit sequence is dominated by long runs of one value (ocean
 * basins, continental interiors), so it is run-length encoded in row-major
 * order with varint run lengths, alternating from sea. Measured against the
 * alternative on this data: run-length 40 KB, bit-packed 791 KB.
 *
 * Input: the 1-arc-minute ETOPO1 grid, raw little-endian int16, dimensions in
 * the filename, rows ascending from -90. See tools/fetch-etopo1.md for the
 * fetch and assembly; build-landfrac.mts and build-riverdata.mts take the same
 * file.
 *
 * Usage: npx tsx tools/build-landshape.mts etopo1-21601x10801.bin
 */
import { closeSync, openSync, readFileSync, readSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Twice the shipped grid on each axis (1800x900), fifteen times the dev grid,
// and a whole multiple of both — so every cell of either grid covers a whole
// block of these and the sum over that block is exact, with no cell of this
// plane ever straddling two cells of the grid that reads it.
const OUT_W = 3600;
const OUT_H = 1800;
// The elevation bake's first land byte: worldgen reads `he < 3` as sea.
const LAND_BYTE = 3;
const EARTH_W = 1920;
const EARTH_H = 960;
const EARTH_RADIUS_KM = 6371;

const binPath = process.argv[2];
if (!binPath) throw new Error("usage: build-landshape.mts <etopo1-WxH.bin>");
const dims = /-(\d+)x(\d+)\.bin$/.exec(binPath);
if (!dims) throw new Error("input filename must carry its dimensions, e.g. etopo1-21601x10801.bin");
const SRC_W = Number(dims[1]);
const SRC_H = Number(dims[2]);
if (statSync(binPath).size !== SRC_W * SRC_H * 2) throw new Error("bin size does not match its dimensions");
if (SRC_W < OUT_W * 4) throw new Error("source grid is too coarse to place a coastline inside these cells");

// Bin every source sample into the output cell that contains it. Row 0 of the
// source is -90 (ascending); row 0 of the output is +90.
const landN = new Uint32Array(OUT_W * OUT_H);
const allN = new Uint32Array(OUT_W * OUT_H);
{
  const fd = openSync(binPath, "r");
  const rowBytes = Buffer.alloc(SRC_W * 2);
  // The output column of each source column never changes — resolve it once.
  const colOf = new Int32Array(SRC_W);
  for (let sx = 0; sx < SRC_W; sx++) {
    const lon = -180 + (360 * sx) / (SRC_W - 1);
    colOf[sx] = lon >= 180 ? -1 : Math.min(OUT_W - 1, Math.floor(((lon + 180) / 360) * OUT_W));
  }
  for (let sy = 0; sy < SRC_H; sy++) {
    readSync(fd, rowBytes, 0, SRC_W * 2, sy * SRC_W * 2);
    const row = new Int16Array(rowBytes.buffer, rowBytes.byteOffset, SRC_W);
    const lat = -90 + (180 * sy) / (SRC_H - 1);
    const oy = Math.min(OUT_H - 1, Math.floor(((90 - lat) / 180) * OUT_H));
    const base = oy * OUT_W;
    for (let sx = 0; sx < SRC_W; sx++) {
      const ox = colOf[sx]!;
      if (ox < 0) continue; // the +180 column duplicates -180
      const o = base + ox;
      allN[o]!++;
      if (row[sx]! > 0) landN[o]!++;
    }
  }
  closeSync(fd);
}

const shape = new Uint8Array(OUT_W * OUT_H);
for (let o = 0; o < OUT_W * OUT_H; o++) {
  const n = allN[o] ?? 0;
  if (n === 0) throw new Error(`no source samples for cell ${o}`);
  shape[o] = (landN[o] ?? 0) * 2 > n ? 1 : 0;
}

// Run-length encode in row-major order, alternating runs starting from sea. A
// leading land cell emits a zero-length sea run first, so the parity of a run
// is its position in the list and needs no flag of its own.
const runs: number[] = [];
{
  let value = 0;
  let run = 0;
  const push = (length: number): void => {
    let v = length;
    while (v >= 0x80) {
      runs.push((v & 0x7f) | 0x80);
      v >>>= 7;
    }
    runs.push(v);
  };
  for (let o = 0; o < OUT_W * OUT_H; o++) {
    if (shape[o] === value) {
      run++;
      continue;
    }
    push(run);
    value = value === 0 ? 1 : 0;
    run = 1;
  }
  push(run);
}

// Round-trip: the decoder in the emitted module must reproduce the plane bit
// for bit, or the run list is not the plane.
{
  const check = new Uint8Array(OUT_W * OUT_H);
  let at = 0;
  let value = 0;
  for (let k = 0; k < runs.length; ) {
    let run = 0;
    let shift = 0;
    for (;;) {
      const byte = runs[k++] ?? 0;
      run += (byte & 0x7f) * Math.pow(2, shift);
      if ((byte & 0x80) === 0) break;
      shift += 7;
    }
    if (value === 1) check.fill(1, at, at + run);
    at += run;
    value = value === 0 ? 1 : 0;
  }
  if (at !== OUT_W * OUT_H) throw new Error(`run lengths sum to ${at}, not ${OUT_W * OUT_H}`);
  for (let o = 0; o < OUT_W * OUT_H; o++) {
    if (check[o] !== shape[o]) throw new Error(`round-trip mismatch at cell ${o}`);
  }
}

// Diagnostics. Cell area falls off as cos(latitude), so a COUNT of land cells
// is not a land AREA — weight each row by the band it stands on.
const rowKm2 = new Float64Array(OUT_H);
for (let y = 0; y < OUT_H; y++) {
  const north = Math.PI / 2 - (y / OUT_H) * Math.PI;
  const south = Math.PI / 2 - ((y + 1) / OUT_H) * Math.PI;
  rowKm2[y] = ((2 * Math.PI * EARTH_RADIUS_KM * EARTH_RADIUS_KM) / OUT_W) * (Math.sin(north) - Math.sin(south));
}
let landCells = 0;
let landKm2 = 0;
let allKm2 = 0;
for (let y = 0; y < OUT_H; y++) {
  const area = rowKm2[y] ?? 0;
  allKm2 += area * OUT_W;
  for (let x = 0; x < OUT_W; x++) {
    if (shape[y * OUT_W + x] === 1) {
      landCells++;
      landKm2 += area;
    }
  }
}

// How much of that land the shipped raster's own bit cannot hold: ground this
// plane resolves inside a cell the coarser plane calls sea.
const earthSource = readFileSync(
  fileURLToPath(new URL("../src/ported/worldgen/earthData.js", import.meta.url)),
  "utf8",
);
const earthMatch = /export const EARTH_ELEV="([^"]+)"/.exec(earthSource);
if (!earthMatch) throw new Error("cannot read EARTH_ELEV");
const earth = Buffer.from(earthMatch[1]!, "base64");
if (earth.length !== EARTH_W * EARTH_H) throw new Error("elevation raster is not the grid it declares");
let unheldKm2 = 0;
for (let y = 0; y < OUT_H; y++) {
  const ey = Math.min(EARTH_H - 1, Math.floor((y / OUT_H) * EARTH_H));
  const area = rowKm2[y] ?? 0;
  for (let x = 0; x < OUT_W; x++) {
    if (shape[y * OUT_W + x] !== 1) continue;
    const ex = Math.min(EARTH_W - 1, Math.floor((x / OUT_W) * EARTH_W));
    if ((earth[ey * EARTH_W + ex] ?? 0) < LAND_BYTE) unheldKm2 += area;
  }
}

const cells = OUT_W * OUT_H;
const meanKm2 = allKm2 / cells;
console.log(`source ${SRC_W}x${SRC_H} -> ${OUT_W}x${OUT_H}, ~${Math.round((SRC_W - 1) / OUT_W) * Math.round((SRC_H - 1) / OUT_H)} samples per cell`);
console.log(`cell ~${meanKm2.toFixed(0)} km2 mean, ~${((2 * Math.PI * EARTH_RADIUS_KM) / OUT_W).toFixed(1)} km wide at the equator`);
console.log(`land ${landCells} cells (${((landCells / cells) * 100).toFixed(1)}% of cells) = ${(landKm2 / 1e6).toFixed(1)} Mkm2 (${((landKm2 / allKm2) * 100).toFixed(1)}% of the sphere)`);
console.log(`of that, ${(unheldKm2 / 1e6).toFixed(2)} Mkm2 stands where the ${EARTH_W}x${EARTH_H} bit says sea`);
console.log(`runs ${runs.length} bytes (${(runs.length / 1024).toFixed(0)} KB raw, ${((runs.length * 4) / 3 / 1024).toFixed(0)} KB base64); bit-packed would be ${(cells / 8 / 1024).toFixed(0)} KB`);

const targetPath = fileURLToPath(new URL("../src/ported/worldgen/landShapeData.js", import.meta.url));
const header = `/* V2 W20 — GENERATED by tools/build-landshape.mts from the 1-arc-minute
 * ETOPO1 grid (see tools/fetch-etopo1.md). Do not edit by hand.
 *
 * Where the land is, on a grid finer than any the sim steps: one bit per cell,
 * ${OUT_W}x${OUT_H}, ~${meanKm2.toFixed(0)} km2 and ~${((2 * Math.PI * EARTH_RADIUS_KM) / OUT_W).toFixed(0)} km on a side at the equator. A cell is land when
 * more than half its ~${Math.round((SRC_W - 1) / OUT_W) * Math.round((SRC_H - 1) / OUT_H)} source samples stand above sea level — the same
 * land test, by the same majority rule, as the elevation bake's own mask.
 *
 * This is READ-ONLY geometry: the plane the world is drawn from and measured
 * against, never one that is stepped. It is a whole multiple of both sim grids
 * on each axis, so a cell of either covers a whole block of these.
 *
 * Ground below sea level but dry counts as water, as in the elevation and
 * cover planes: this measures height against the sea, not dryness.
 *
 * Stored as ${runs.length} bytes of run lengths, varint, row-major, alternating from
 * sea (a leading land cell emits a zero-length sea run first).
 */
export const LAND_SHAPE_W = ${OUT_W}, LAND_SHAPE_H = ${OUT_H};

/** Rebuild the plane: one byte per cell, 1 = land. */
export function decodeLandShape(b64) {
  const out = new Uint8Array(LAND_SHAPE_W * LAND_SHAPE_H);
  const bin = atob(b64);
  let at = 0, value = 0;
  for (let k = 0; k < bin.length; ) {
    let run = 0, scale = 1;
    for (;;) {
      const byte = bin.charCodeAt(k++);
      run += (byte & 0x7f) * scale;
      if ((byte & 0x80) === 0) break;
      scale *= 128;
    }
    if (value === 1) out.fill(1, at, at + run);
    at += run;
    value = value === 0 ? 1 : 0;
  }
  return out;
}
`;
writeFileSync(targetPath, `${header}\nexport const LAND_SHAPE="${Buffer.from(runs).toString("base64")}";\n`);
console.log(`wrote ${targetPath}`);

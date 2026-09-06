/* V2 W19 — LAND COVER FRACTION
 *
 * The shipped raster stores one bit per cell for geometry that is often far
 * finer than a cell. At the shipped grid a cell is ~21 km on a side and holds
 * ~450 km² at mid latitude; the coast, an island, a strait or a lake shore all
 * cut through the middle of one. Thresholding that to land-or-sea both erases
 * land (an island smaller than a cell) and invents it (a cell that is mostly
 * water counts as whole land for anything that asks how much ground is there).
 *
 * This bake measures the missing quantity directly: the FRACTION of each
 * shipped cell that stands above sea level, counted on the 1-arc-minute grid
 * (~1.9 km at the equator, ~126 samples per shipped cell). It is a coverage
 * statistic, not a height, so it needs the fine grid by definition — the mean
 * elevation the shipped raster already carries is well sampled at 6 arc-minutes
 * but says nothing about how the land inside a cell is arranged.
 *
 * Rule (a physical statement, no place names):
 *   - LAND_FRAC[cell] = (1-arc-minute samples in the cell with altitude > 0)
 *                       / (samples in the cell), quantized to a byte.
 *     `altitude > 0` is the same land test the elevation bake uses, so the two
 *     planes agree on what "above sea level" means.
 *
 * Consequence worth stating: ground that lies BELOW sea level but is dry
 * (endorheic floors, polders) counts as water here. This plane measures
 * height against the sea, not dryness — QUESTIONS.md records the gap.
 *
 * Input: the 1-arc-minute ETOPO1 grid, raw little-endian int16, dimensions in
 * the filename, rows ascending from −90. See tools/fetch-etopo1.md for the
 * fetch and assembly; build-riverdata.mts takes the same file.
 *
 * Usage: npx tsx tools/build-landfrac.mts etopo1-21601x10801.bin
 */
import { closeSync, openSync, readFileSync, readSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const OUT_W = 1920;
const OUT_H = 960;
// The elevation bake's first land byte: worldgen reads `he < 3` as sea.
const LAND_BYTE = 3;

const binPath = process.argv[2];
if (!binPath) throw new Error("usage: build-landfrac.mts <etopo1-WxH.bin>");
const dims = /-(\d+)x(\d+)\.bin$/.exec(binPath);
if (!dims) throw new Error("input filename must carry its dimensions, e.g. etopo1-21601x10801.bin");
const SRC_W = Number(dims[1]);
const SRC_H = Number(dims[2]);
if (statSync(binPath).size !== SRC_W * SRC_H * 2) throw new Error("bin size does not match its dimensions");
if (SRC_W < OUT_W * 4) throw new Error("source grid is too coarse to measure sub-cell cover");

// Bin every source sample into the shipped cell that contains it. Row 0 of the
// source is −90 (ascending); row 0 of the output is +90.
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
      if (ox < 0) continue; // the +180 column duplicates −180
      const o = base + ox;
      allN[o]!++;
      if (row[sx]! > 0) landN[o]!++;
    }
  }
  closeSync(fd);
}

const frac = new Uint8Array(OUT_W * OUT_H);
for (let o = 0; o < OUT_W * OUT_H; o++) {
  const n = allN[o] ?? 0;
  if (n === 0) throw new Error(`no source samples for cell ${o}`);
  frac[o] = Math.round(((landN[o] ?? 0) / n) * 255);
}

// The plane is a CORRECTION to the land/sea bit the elevation raster already
// carries, so only the cells that disagree with that bit need storing: a cell
// the raster calls land and the fine grid finds wholly above sea implies 255,
// and one it calls sea and the fine grid finds wholly under implies 0. That is
// 97% of the world, left out entirely; what remains is the coast, the islands
// smaller than a cell, and the water the bit could not see.
const earthSource = readFileSync(
  fileURLToPath(new URL("../src/ported/worldgen/earthData.js", import.meta.url)),
  "utf8",
);
const earthMatch = /export const EARTH_ELEV="([^"]+)"/.exec(earthSource);
if (!earthMatch) throw new Error("cannot read EARTH_ELEV");
const earth = Buffer.from(earthMatch[1]!, "base64");
if (earth.length !== OUT_W * OUT_H) throw new Error("elevation raster is not the shipped grid");

const corrections: number[] = [];
let previous = -1;
let count = 0;
for (let o = 0; o < OUT_W * OUT_H; o++) {
  const implied = (earth[o] ?? 0) >= LAND_BYTE ? 255 : 0;
  if (frac[o] === implied) continue;
  let delta = o - previous;
  previous = o;
  count++;
  while (delta >= 0x80) {
    corrections.push((delta & 0x7f) | 0x80);
    delta >>>= 7;
  }
  corrections.push(delta);
  corrections.push(frac[o] ?? 0);
}

// Round-trip: the decoder in the emitted module must reproduce the plane byte
// for byte, or the correction list is not the plane.
{
  const check = new Uint8Array(OUT_W * OUT_H);
  for (let o = 0; o < OUT_W * OUT_H; o++) check[o] = (earth[o] ?? 0) >= LAND_BYTE ? 255 : 0;
  let at = -1;
  for (let k = 0; k < corrections.length; ) {
    let delta = 0;
    let shift = 0;
    for (;;) {
      const byte = corrections[k++] ?? 0;
      delta |= (byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) break;
      shift += 7;
    }
    at += delta;
    check[at] = corrections[k++] ?? 0;
  }
  for (let o = 0; o < OUT_W * OUT_H; o++) {
    if (check[o] !== frac[o]) throw new Error(`round-trip mismatch at cell ${o}`);
  }
}

// Diagnostics: how much of the world is actually mixed, and how far the bit
// the shipped raster carries is from the cover it stands for.
let dry = 0;
let wet = 0;
let mixed = 0;
for (let o = 0; o < OUT_W * OUT_H; o++) {
  if (frac[o] === 255) dry++;
  else if (frac[o] === 0) wet++;
  else mixed++;
}
const cells = OUT_W * OUT_H;
console.log(`source ${SRC_W}x${SRC_H} -> ${OUT_W}x${OUT_H}, ~${Math.round((SRC_W - 1) / OUT_W) * Math.round((SRC_H - 1) / OUT_H)} samples per cell`);
console.log(`all land ${dry} (${((dry / cells) * 100).toFixed(1)}%)  all sea ${wet} (${((wet / cells) * 100).toFixed(1)}%)  mixed ${mixed} (${((mixed / cells) * 100).toFixed(1)}%)`);
console.log(`stored corrections ${count} cells (${((count / cells) * 100).toFixed(1)}%), ${(corrections.length / 1024).toFixed(0)} KB raw`);

const targetPath = fileURLToPath(new URL("../src/ported/worldgen/landCoverData.js", import.meta.url));
const header = `/* V2 W19 — GENERATED by tools/build-landfrac.mts from the 1-arc-minute
 * ETOPO1 grid (see tools/fetch-etopo1.md). Do not edit by hand.
 *
 * The fraction of each shipped cell that stands above sea level, measured at
 * ~1.9 km from ~${Math.round((SRC_W - 1) / OUT_W) * Math.round((SRC_H - 1) / OUT_H)} samples per cell. A cell here is ~21 km on a side and
 * holds a few hundred km2, so a coast, an island or a strait routinely cuts
 * through the middle of one; the land/sea bit rounds that to all-or-nothing,
 * and this plane is the remainder. Ground below sea level but dry counts as
 * water: it measures height against the sea, not dryness.
 *
 * Stored as a correction to the bit — only the ${count} cells whose cover
 * disagrees with EARTH_ELEV's own land test are listed, as varint gaps between
 * cell indices, each followed by the cover byte (0 = all sea, 255 = all land).
 */
export const LAND_FRAC_W = ${OUT_W}, LAND_FRAC_H = ${OUT_H};
export const LAND_FRAC_FULL = 255;

/** Rebuild the cover plane. \`earth\` is decodeEarth(EARTH_ELEV) — the bit this
 * plane corrects — and ${LAND_BYTE} is the elevation bake's own first land byte. */
export function decodeLandFrac(b64, earth) {
  const out = new Uint8Array(earth.length);
  for (let i = 0; i < earth.length; i++) out[i] = earth[i] >= ${LAND_BYTE} ? 255 : 0;
  const bin = atob(b64);
  let at = -1;
  for (let k = 0; k < bin.length; ) {
    let delta = 0, shift = 0;
    for (;;) {
      const byte = bin.charCodeAt(k++);
      delta |= (byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) break;
      shift += 7;
    }
    at += delta;
    out[at] = bin.charCodeAt(k++);
  }
  return out;
}
`;
writeFileSync(targetPath, `${header}\nexport const LAND_FRAC="${Buffer.from(corrections).toString("base64")}";\n`);
console.log(`wrote ${targetPath}`);

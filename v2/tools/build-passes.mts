/* V2 W25 — WHERE THE PASSES ARE
 *
 * W21 baked the height of the lowest crossing of every sim-grid edge; that is
 * a COST, and the router and migration charge it. It is not a pass: it has
 * no position, it exists on every land edge whether a range is there or not,
 * and it is drawn (W24) where the grid is, not where the terrain is. The
 * owner: the marks "look VERY large and geometric and odd" — "is the way we
 * figure out WHERE they are isn't good? I don't see how it CAN be". It
 * cannot. A pass is a property of the terrain, so it is measured on the
 * terrain, with no cell in the rule.
 *
 * Rule (a physical statement, no place name in it):
 *   A pass is a SADDLE of the height field: the lowest point on the ridge
 *   joining two summits, and the highest point on the route between the
 *   ground either side. Sweep the 1-arc-minute samples from the highest
 *   down, joining each to its already-swept 8-neighbours (x wraps). Every
 *   swept sample belongs to exactly one summit — the highest sample its
 *   ground reaches without descending below the sweep. Where the sweep
 *   first joins two summits' ground, the joining sample is their col, and
 *   the lower summit's PROMINENCE is its height above that col: the drop the
 *   ridge makes from that summit down to the crossing, which is also the
 *   least the ridge drops on either side of it (the higher summit's side
 *   drops at least as far). A col is a pass when that drop is at least
 *   PASS_MIN_PROMINENCE_M; below it the "summit" is a shoulder of the
 *   higher one and the "col" a dip in its flank. And a pass is CLIMBED: the
 *   col stands at least PASS_MIN_CLIMB_M above the lowest ground within a
 *   day's walk of it (TRAVEL_FOOT_KM_PER_DAY, 25 km) — the Suez isthmus is
 *   the col between Africa's summits and Asia's and drops 5,666 m from
 *   Kilimanjaro, but nothing climbs to cross it; that is a saddle of the
 *   continent, not a pass. Cols at or below the datum are not passes.
 *
 * This is the standard topographic prominence sweep (the key col of every
 * summit), read from the col's side: the great passes are the key cols of
 * the massifs they separate, and that is what the bar measures. Ties in
 * height join without a record (prominence 0).
 *
 * Output: one list for the whole raster, sorted by prominence descending,
 * eight bytes per pass — sample column and row (uint16 each, row 0 = the
 * south pole), altitude (int16 m), prominence (uint16 m) — so a lens can
 * draw the largest first and place each at its own coordinates on any grid.
 * No sim grid is in the rule and none is in the output.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readEtopo } from "./lib/fine-water.mjs";

// The least a ridge may drop, on both sides, for its low point to be a pass
// rather than a dip on the flank of one summit: at a walker's rate (300 m of
// ascent ≈ 30 min, Naismith) it is the least climb a route would go around
// a range to avoid — twice the bar at which the British listing convention
// counts a summit as its own hill (the "Marilyn", 150 m of the same
// quantity).
const PASS_MIN_PROMINENCE_M = 300;
// The same bar seen from the route: the crossing must climb at least this
// far from the lowest ground within a day's walk of the col (the approach a
// traveller stands at the evening before). Without it the list is led by
// the lowland cols between continents, which drop kilometres from their
// summits and rise metres from their plains.
const PASS_MIN_CLIMB_M = 300;
// A day on foot, the sim's own rate (TRAVEL_FOOT_KM_PER_DAY): the radius the
// approach is read over, in km, and the raster's row pitch to turn it into
// samples (one arc-minute is 1.853 km along a meridian).
const APPROACH_KM = 25;
const KM_PER_ROW = 40007.86 / 360 / 60;
const D8_DX = [1, 1, 0, -1, -1, -1, 0, 1];
const D8_DY = [0, 1, 1, 1, 0, -1, -1, -1];

const binPath = process.argv[2];
if (!binPath) throw new Error("usage: build-passes.mts <etopo1-WxH.bin>");
const started = Date.now();
const { src, SRC_W, SRC_H } = readEtopo(binPath);
const SRC_COLS = SRC_W - 1; // the +180 column duplicates -180
const N = SRC_COLS * SRC_H;
const heightAt = (sy: number, sx: number): number => src[sy * SRC_W + sx]!;

// Counting sort of every sample above the datum, by height descending.
let maxH = 0;
for (let sy = 0; sy < SRC_H; sy++) for (let sx = 0; sx < SRC_COLS; sx++) { const h = heightAt(sy, sx); if (h > maxH) maxH = h; }
const bucketStart = new Int32Array(maxH + 2);
for (let sy = 0; sy < SRC_H; sy++) for (let sx = 0; sx < SRC_COLS; sx++) { const h = heightAt(sy, sx); if (h > 0) bucketStart[maxH - h]!++; }
let total = 0;
for (let b = 0; b <= maxH; b++) { const c = bucketStart[b]!; bucketStart[b] = total; total += c; }
bucketStart[maxH + 1] = total;
const order = new Int32Array(total);
{
  const fill = Int32Array.from(bucketStart.subarray(0, maxH + 1));
  for (let sy = 0; sy < SRC_H; sy++) for (let sx = 0; sx < SRC_COLS; sx++) {
    const h = heightAt(sy, sx);
    if (h > 0) order[fill[maxH - h]!++] = sy * SRC_COLS + sx;
  }
}
console.log(`${total} samples above the datum, highest ${maxH} m, sorted in ${((Date.now() - started) / 1000).toFixed(0)} s`);

// Union-find in which the root of every component is its summit: the first
// sample swept into it, hence the highest (ties: the earliest in raster order).
const parent = new Int32Array(N).fill(-1);
function find(i: number): number {
  let r = i;
  while (parent[r] !== r) r = parent[r]!;
  while (parent[i] !== r) { const next = parent[i]!; parent[i] = r; i = next; }
  return r;
}
const heightOf = (i: number): number => heightAt(Math.floor(i / SRC_COLS), i % SRC_COLS);

const passes: { i: number; altitude: number; prominence: number }[] = [];
for (let k = 0; k < total; k++) {
  const s = order[k]!;
  parent[s] = s;
  const sy = Math.floor(s / SRC_COLS);
  const sx = s - sy * SRC_COLS;
  const hs = heightOf(s);
  for (let d = 0; d < 8; d++) {
    const ny = sy + D8_DY[d]!;
    if (ny < 0 || ny >= SRC_H) continue;
    const nx = (sx + D8_DX[d]! + SRC_COLS) % SRC_COLS;
    const n = ny * SRC_COLS + nx;
    if (parent[n] === -1) continue;
    const rs = find(s);
    const rn = find(n);
    if (rs === rn) continue;
    const hrs = heightOf(rs);
    const hrn = heightOf(rn);
    // The lower summit joins the higher; its col is here.
    const lower = hrn < hrs || (hrn === hrs && rn > rs) ? rn : rs;
    const higher = lower === rn ? rs : rn;
    const prominence = heightOf(lower) - hs;
    if (prominence >= PASS_MIN_PROMINENCE_M) passes.push({ i: s, altitude: hs, prominence });
    parent[lower] = higher;
  }
  if ((k & 0xffffff) === 0) process.stdout.write(`  swept ${k}/${total}, ${passes.length} passes\n`);
}
const saddles = passes.length;
// The climb: the col above the lowest ground within a day's walk. The box is
// APPROACH_KM in rows and APPROACH_KM / cos(lat) in columns; ground at or
// below the datum reads as the datum (the sea is the lowest approach).
const rowReach = Math.round(APPROACH_KM / KM_PER_ROW);
const climbOf = (i: number): number => {
  const sy = Math.floor(i / SRC_COLS);
  const sx = i - sy * SRC_COLS;
  const lat = (-90 + (sy / (SRC_H - 1)) * 180) * Math.PI / 180;
  const colReach = Math.min(SRC_COLS >> 1, Math.round(rowReach / Math.max(1e-3, Math.cos(lat))));
  let low = heightAt(sy, sx);
  for (let ry = Math.max(0, sy - rowReach); ry <= Math.min(SRC_H - 1, sy + rowReach); ry++) {
    for (let cx = -colReach; cx <= colReach; cx++) {
      const h = heightAt(ry, (sx + cx + SRC_COLS) % SRC_COLS);
      if (h < low) low = h;
    }
  }
  return heightAt(sy, sx) - Math.max(0, low);
};
const climbed: { i: number; altitude: number; prominence: number; climb: number }[] = [];
for (const p of passes) {
  const climb = climbOf(p.i);
  if (climb >= PASS_MIN_CLIMB_M) climbed.push({ ...p, climb });
}
climbed.sort((a, b) => b.prominence - a.prominence || a.i - b.i);
console.log(`${saddles} saddles with prominence ≥ ${PASS_MIN_PROMINENCE_M} m; ${climbed.length} of them climb ≥ ${PASS_MIN_CLIMB_M} m within ${APPROACH_KM} km and are passes; ${((Date.now() - started) / 1000).toFixed(0)} s`);
passes.length = 0;

const bands = [300, 500, 1000, 1500, 2000, 3000];
const counts = bands.map((lo, k) => climbed.filter((p) => p.prominence >= lo && (k + 1 >= bands.length || p.prominence < bands[k + 1]!)).length);
console.log("by prominence band:", bands.map((lo, k) => `≥${lo}: ${counts[k]}`).join(", "));
const altitudeBands = [1, 500, 1000, 2000, 3000, 4000, 5000];
console.log("by altitude band:", altitudeBands.map((lo, k) => `≥${lo}: ${climbed.filter((p) => p.altitude >= lo && (k + 1 >= altitudeBands.length || p.altitude < altitudeBands[k + 1]!)).length}`).join(", "));
for (const p of climbed.slice(0, 16)) {
  const sy = Math.floor(p.i / SRC_COLS);
  const sx = p.i - sy * SRC_COLS;
  console.log(`  ${(-90 + (sy / (SRC_H - 1)) * 180).toFixed(2)}N ${(-180 + (sx / SRC_COLS) * 360).toFixed(2)}E  ${p.altitude} m  prominence ${p.prominence} m  climb ${p.climb} m`);
}

const RECORD = 10;
const bytes = new Uint8Array(climbed.length * RECORD);
const view = new DataView(bytes.buffer);
climbed.forEach((p, k) => {
  const sy = Math.floor(p.i / SRC_COLS);
  const sx = p.i - sy * SRC_COLS;
  view.setUint16(k * RECORD, sx, true);
  view.setUint16(k * RECORD + 2, sy, true);
  view.setInt16(k * RECORD + 4, p.altitude, true);
  view.setUint16(k * RECORD + 6, Math.min(65535, p.prominence), true);
  view.setUint16(k * RECORD + 8, Math.min(65535, p.climb), true);
});
const b64 = Buffer.from(bytes).toString("base64");
const targetPath = fileURLToPath(new URL("../src/ported/worldgen/passData.js", import.meta.url));
const header = `/* V2 W25 — GENERATED by tools/build-passes.mts from the 1-arc-minute
 * ETOPO1 grid (see tools/fetch-etopo1.md). Do not edit by hand.
 *
 * Every PASS on the raster: a saddle of the height field whose ridge drops at
 * least PASS_MIN_PROMINENCE_M on both sides — the key col of a summit with at
 * least that prominence, found by the prominence sweep (highest sample down,
 * joining ground to its summit; where two summits' ground first meets is
 * their col, and the lower summit's height above it is the drop) — and which
 * a route CLIMBS: the col stands at least PASS_MIN_CLIMB_M above the lowest
 * ground within PASS_APPROACH_KM of it (a day on foot). Cols at or below the
 * datum are not passes. No sim grid is in the rule or the data.
 *
 * Ten bytes per pass, little-endian, sorted by prominence descending:
 * source column (uint16, 0 = 180°W, ${SRC_COLS} columns), source row
 * (uint16, 0 = the south pole, ${SRC_H} rows), altitude (int16 m),
 * prominence (uint16 m), climb (uint16 m). ${climbed.length} passes,
 * ${bytes.length} bytes raw.
 */
export const PASS_MIN_PROMINENCE_M = ${PASS_MIN_PROMINENCE_M};
export const PASS_MIN_CLIMB_M = ${PASS_MIN_CLIMB_M};
export const PASS_APPROACH_KM = ${APPROACH_KM};
export const PASS_RECORD_BYTES = ${RECORD};
export const PASS_SOURCE_COLS = ${SRC_COLS};
export const PASS_SOURCE_ROWS = ${SRC_H};
export const PASS_COUNT = ${climbed.length};

/** Decode the list: parallel arrays, the largest prominence first. */
export function decodePasses() {
  const bin = atob(PASS_DATA);
  const bytes = new Uint8Array(bin.length);
  for (let k = 0; k < bin.length; k++) bytes[k] = bin.charCodeAt(k);
  const view = new DataView(bytes.buffer);
  const count = bytes.length / PASS_RECORD_BYTES;
  const column = new Uint16Array(count);
  const row = new Uint16Array(count);
  const altitude = new Int16Array(count);
  const prominence = new Uint16Array(count);
  const climb = new Uint16Array(count);
  for (let k = 0; k < count; k++) {
    const at = k * PASS_RECORD_BYTES;
    column[k] = view.getUint16(at, true);
    row[k] = view.getUint16(at + 2, true);
    altitude[k] = view.getInt16(at + 4, true);
    prominence[k] = view.getUint16(at + 6, true);
    climb[k] = view.getUint16(at + 8, true);
  }
  return { count, column, row, altitude, prominence, climb };
}
`;
writeFileSync(targetPath, `${header}\nexport const PASS_DATA =\n  "${b64}";\n`);
console.log(`wrote ${targetPath} (${Math.round(b64.length / 1024)} KB base64) in ${((Date.now() - started) / 1000).toFixed(0)} s`);

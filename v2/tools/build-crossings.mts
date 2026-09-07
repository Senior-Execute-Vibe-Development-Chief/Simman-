/* V2 W22 — GROUND AND WATER
 *
 * The sim's land mask is a MAJORITY vote over a few hundred km2, and a vote has
 * no shape: a cell that is 60% land is "land" to every consumer, so a road
 * walks across the strait that splits it and a boat cannot enter the sea that
 * covers four tenths of it. Straits were carved by name to get around the
 * first half of that (worldgen's EARTH_STRAITS), which is a list of answers,
 * not a mechanism; the second half was never handled at all.
 *
 * Whether two adjacent cells share GROUND, and whether they share WATER, are
 * properties of the fine coastline BETWEEN them, and like the pass height
 * (W21) they are extremal quantities: a land link exists if ANY path of land
 * samples joins the two cells, however thin; a water link is as wide as the
 * NARROWEST point of the widest channel. Averaging destroys both, so both are
 * measured on the 1-arc-minute samples and stored PER EDGE, never by carving
 * or drowning a cell — a peninsula that happens to be thin at a cell boundary
 * keeps its ground, and a strait that happens to be thin keeps its water.
 *
 * Rule (a physical statement, no place name in it):
 *   A cell's SEAT on land is the land sample nearest its centre within the
 *   cell's LARGEST body of land (its land samples grouped 8-connected inside
 *   the cell); its seat on water is the most open water of its largest body
 *   of water (grouped 4-connected) — the water sample farthest from any land,
 *   nearest the centre among equals. A cell without land has no land seat, a
 *   cell without water has no water seat. The largest body, not the nearest,
 *   so that an islet or a pond at the centre does not stand for the cell. Distance to land is the 4-connected
 *   sample distance on the whole grid, capped at the width the byte can hold,
 *   so a shore does not narrow the water it faces. For every pair of
 *   adjacent cells a→b (the sim's D8 rose, four directions stored per cell,
 *   the other four are the neighbour's), inside the bounding box of the two
 *   cells in sample space (for a diagonal pair the box holds the two side
 *   cells as well, whose ground a diagonal move crosses):
 *     LAND LINK  = an 8-connected path of land samples joins the two land
 *                  seats.
 *     WATER WIDTH = over 4-connected paths of water samples from the one
 *                  water seat to the other, the largest value of the smallest
 *                  distance-to-land along the path, converted to a channel
 *                  width in samples (2d − 1: a one-sample channel is width 1);
 *                  zero if no water path exists.
 *   Land takes 8-connectivity and water 4-connectivity so that a land path
 *   and a water path can never cross each other at a corner; both are
 *   measured from the seat because a cell split by a channel is, for travel,
 *   the side its centre stands on — the same centre-to-centre rule the pass
 *   bake uses, and the reason a choke INSIDE a cell shows up on that cell's
 *   edges rather than vanishing into its majority.
 *
 * What it replaces: the majority mask decided both questions with one bit and
 * a hand-carved list fixed its five worst mistakes. What it does not do: it
 * never changes a cell's mask, elevation or fraction; the mask is still what
 * the land economy stands on. The edges say only how a cell is REACHED.
 *
 * Input: the 1-arc-minute ETOPO1 grid, raw little-endian int16, dimensions in
 * the filename, rows ascending from -90 (tools/fetch-etopo1.md).
 *
 * Usage: npx tsx tools/build-crossings.mts etopo1-21601x10801.bin [WxH ...]
 *        (default grids: 240x120 and 1800x900)
 */
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildFineLand } from "./lib/fine-water.mjs";

const D8_DX = [1, 1, 0, -1, -1, -1, 0, 1];
const D8_DY = [0, 1, 1, 1, 0, -1, -1, -1];
const STORED_DIRECTIONS = 4; // E, SE, S, SW — W, NW, N, NE are the neighbour's
const LAND_LINK_BIT = 0x80;
const WIDTH_MASK = 0x7f; // channel width in samples, 127 = 127 or wider (open water)
const WIDTH_CAP = WIDTH_MASK;

const binPath = process.argv[2];
if (!binPath) throw new Error("usage: build-crossings.mts <etopo1-WxH.bin> [WxH ...]");
const dims = /-(\d+)x(\d+)\.bin$/.exec(binPath);
if (!dims) throw new Error("input filename must carry its dimensions, e.g. etopo1-21601x10801.bin");
const SRC_W = Number(dims[1]);
const SRC_H = Number(dims[2]);
if (statSync(binPath).size !== SRC_W * SRC_H * 2) throw new Error("bin size does not match its dimensions");
const SRC_COLS = SRC_W - 1; // the +180 column duplicates -180
const gridArgs = process.argv.slice(3);
const grids = (gridArgs.length ? gridArgs : ["240x120", "1800x900"]).map((g) => {
  const m = /^(\d+)x(\d+)$/.exec(g);
  if (!m) throw new Error(`bad grid ${g}`);
  return { W: Number(m[1]), H: Number(m[2]) };
});

const raw = readFileSync(binPath);
const src = new Int16Array(raw.buffer, raw.byteOffset, SRC_W * SRC_H);
// What is land is the shared fine rule (W23, tools/lib/fine-water.mts): the
// ocean and sea-sized enclosed basins are water, every smaller floor below the
// sea is land, so a dry depression holds ground and a ship never crosses it.
const fineLand = buildFineLand(src, SRC_W, SRC_H).land;
const isLandAt = (sy: number, sx: number): boolean => fineLand[sy * SRC_W + sx] === 1;

// Distance to the nearest land sample, 4-connected, capped, over the whole
// grid: two raster sweeps each way (the city-block transform), with the
// east-west neighbour wrapping the antimeridian, repeated once so the seam
// settles. Land is 0.
const DIST_CAP = 0x7f;
const distG = new Uint8Array(SRC_H * SRC_COLS);
{
  const t0 = Date.now();
  for (let sy = 0; sy < SRC_H; sy++) {
    for (let sx = 0; sx < SRC_COLS; sx++) distG[sy * SRC_COLS + sx] = isLandAt(sy, sx) ? 0 : DIST_CAP;
  }
  for (let pass = 0; pass < 2; pass++) {
    for (let sy = 0; sy < SRC_H; sy++) {
      const row = sy * SRC_COLS;
      const up = row - SRC_COLS;
      for (let sx = 0; sx < SRC_COLS; sx++) {
        let d = distG[row + sx]!;
        if (d === 0) continue;
        if (sy > 0) { const c = distG[up + sx]! + 1; if (c < d) d = c; }
        { const c = distG[row + (sx === 0 ? SRC_COLS - 1 : sx - 1)]! + 1; if (c < d) d = c; }
        distG[row + sx] = d;
      }
    }
    for (let sy = SRC_H - 1; sy >= 0; sy--) {
      const row = sy * SRC_COLS;
      const down = row + SRC_COLS;
      for (let sx = SRC_COLS - 1; sx >= 0; sx--) {
        let d = distG[row + sx]!;
        if (d === 0) continue;
        if (sy < SRC_H - 1) { const c = distG[down + sx]! + 1; if (c < d) d = c; }
        { const c = distG[row + (sx === SRC_COLS - 1 ? 0 : sx + 1)]! + 1; if (c < d) d = c; }
        distG[row + sx] = d;
      }
    }
  }
  console.log(`distance to land over ${SRC_H}x${SRC_COLS} samples in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}
const distAt = (sy: number, sx: number): number => distG[sy * SRC_COLS + sx]!;

interface Baked {
  readonly W: number;
  readonly H: number;
  readonly table: Uint8Array;
  readonly landLinks: number;
  readonly waterLinks: number;
  readonly narrow: number; // water links narrower than the cell itself
  readonly maskLandEdgesUnlinked: number; // land-land (majority) edges with no ground between
  readonly maskMixedLinked: number; // edges with a majority-water end that share ground
}

// Search workspace, sized to the largest window of the run.
let landWin = new Uint8Array(0);
let seen = new Uint8Array(0);
let label = new Int32Array(0);
let dist = new Int32Array(0);
let queue = new Int32Array(0);
let best = new Int32Array(0);
let heapNode = new Int32Array(0);
let heapKey = new Int32Array(0);

function bakeGrid(W: number, H: number): Baked {
  if (SRC_COLS % W !== 0 && SRC_COLS < W * 4) throw new Error("source too coarse for this grid");
  const colOf = new Int32Array(SRC_COLS);
  for (let sx = 0; sx < SRC_COLS; sx++) {
    const lon = -180 + (360 * sx) / (SRC_W - 1);
    colOf[sx] = Math.min(W - 1, Math.floor(((lon + 180) / 360) * W));
  }
  const rowOf = new Int32Array(SRC_H);
  for (let sy = 0; sy < SRC_H; sy++) {
    const lat = -90 + (180 * sy) / (SRC_H - 1);
    rowOf[sy] = Math.min(H - 1, Math.floor(((90 - lat) / 180) * H));
  }
  const colFirst = new Int32Array(W).fill(-1);
  const colLast = new Int32Array(W).fill(-1);
  for (let sx = 0; sx < SRC_COLS; sx++) {
    const c = colOf[sx]!;
    if (colFirst[c] < 0) colFirst[c] = sx;
    colLast[c] = sx;
  }
  const rowFirst = new Int32Array(H).fill(-1);
  const rowLast = new Int32Array(H).fill(-1);
  for (let sy = 0; sy < SRC_H; sy++) {
    const r = rowOf[sy]!;
    if (rowFirst[r] < 0) rowFirst[r] = sy;
    rowLast[r] = sy;
  }
  const cells = W * H;
  const landN = new Uint32Array(cells);
  const allN = new Uint32Array(cells);
  for (let sy = 0; sy < SRC_H; sy++) {
    const base = rowOf[sy]! * W;
    for (let sx = 0; sx < SRC_COLS; sx++) {
      const o = base + colOf[sx]!;
      allN[o]!++;
      if (isLandAt(sy, sx)) landN[o]!++;
    }
  }
  // Seats: the land and water samples nearest each cell's centre, in source
  // coordinates (-1 = the cell has none of that kind).
  const landSeatY = new Int32Array(cells).fill(-1);
  const landSeatX = new Int32Array(cells).fill(-1);
  const waterSeatY = new Int32Array(cells).fill(-1);
  const waterSeatX = new Int32Array(cells).fill(-1);
  const landMajority = new Uint8Array(cells);
  const cellCap = (Math.ceil(SRC_H / H) + 1) * (Math.ceil(SRC_COLS / W) + 1);
  if (label.length < cellCap) { label = new Int32Array(cellCap); }
  if (queue.length < cellCap) { queue = new Int32Array(cellCap); }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = y * W + x;
      if (allN[o] === 0) throw new Error(`no source samples for cell ${o}`);
      if (landN[o]! * 2 > allN[o]!) landMajority[o] = 1;
      const cy = (rowFirst[y]! + rowLast[y]!) / 2;
      const cx = (colFirst[x]! + colLast[x]!) / 2;
      // Label the cell's bodies: land 8-connected, water 4-connected.
      const rowsC = rowLast[y]! - rowFirst[y]! + 1;
      const colsC = colLast[x]! - colFirst[x]! + 1;
      const nC = rowsC * colsC;
      label.fill(0, 0, nC);
      let nextLabel = 0;
      let biggestLand = 0, biggestLandLabel = -1, biggestWater = 0, biggestWaterLabel = -1;
      for (let i0 = 0; i0 < nC; i0++) {
        if (label[i0]) continue;
        const l = isLandAt(rowFirst[y]! + ((i0 / colsC) | 0), colFirst[x]! + (i0 % colsC)) ? 1 : 0;
        const id = ++nextLabel;
        let head = 0, tail = 0, size = 0;
        queue[tail++] = i0; label[i0] = id;
        while (head < tail) {
          const u = queue[head++]!; size++;
          const uy = (u / colsC) | 0, ux = u - uy * colsC;
          for (let d = 0; d < 8; d += l ? 1 : 2) {
            const vy = uy + D8_DY[d]!, vx = ux + D8_DX[d]!;
            if (vy < 0 || vy >= rowsC || vx < 0 || vx >= colsC) continue;
            const v = vy * colsC + vx;
            if (label[v]) continue;
            if ((isLandAt(rowFirst[y]! + vy, colFirst[x]! + vx) ? 1 : 0) !== l) continue;
            label[v] = id; queue[tail++] = v;
          }
        }
        if (l) { if (size > biggestLand) { biggestLand = size; biggestLandLabel = id; } }
        else if (size > biggestWater) { biggestWater = size; biggestWaterLabel = id; }
      }
      let bestLand = Infinity;
      let bestWater = Infinity;
      let openWater = 0;
      for (let sy = rowFirst[y]!; sy <= rowLast[y]!; sy++) {
        for (let sx = colFirst[x]!; sx <= colLast[x]!; sx++) {
          const d2 = (sy - cy) * (sy - cy) + (sx - cx) * (sx - cx);
          const id = label[(sy - rowFirst[y]!) * colsC + (sx - colFirst[x]!)]!;
          if (id === biggestLandLabel) {
            if (d2 < bestLand) { bestLand = d2; landSeatY[o] = sy; landSeatX[o] = sx; }
          } else if (id === biggestWaterLabel) {
            const open = distAt(sy, sx);
            if (open > openWater || (open === openWater && d2 < bestWater)) {
              openWater = open; bestWater = d2; waterSeatY[o] = sy; waterSeatX[o] = sx;
            }
          }
        }
      }
    }
  }
  const maxWinRows = 2 * (Math.ceil(SRC_H / H) + 1);
  const maxWinCols = 2 * (Math.ceil(SRC_COLS / W) + 1);
  const winCap = maxWinRows * maxWinCols;
  if (landWin.length < winCap) {
    landWin = new Uint8Array(winCap);
    seen = new Uint8Array(winCap);
    dist = new Int32Array(winCap);
    queue = new Int32Array(winCap);
    best = new Int32Array(winCap);
    heapNode = new Int32Array(winCap * 4);
    heapKey = new Int32Array(winCap * 4);
  }

  const table = new Uint8Array(cells * STORED_DIRECTIONS);
  let landLinks = 0;
  let waterLinks = 0;
  let narrow = 0;
  let maskLandEdgesUnlinked = 0;
  let maskMixedLinked = 0;
  const cellSamples = Math.ceil(SRC_COLS / W);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const a = y * W + x;
      for (let d = 0; d < STORED_DIRECTIONS; d++) {
        const ny = y + D8_DY[d]!;
        if (ny < 0 || ny >= H) continue;
        const nx = (x + D8_DX[d]! + W) % W;
        const b = ny * W + nx;
        // Window: the bounding box of the two cells in sample space. Columns
        // may wrap the antimeridian; rows never do.
        const r0 = Math.min(rowFirst[y]!, rowFirst[ny]!);
        const r1 = Math.max(rowLast[y]!, rowLast[ny]!);
        let c0: number;
        let c1: number;
        if (nx === x) { c0 = colFirst[x]!; c1 = colLast[x]!; }
        else if (nx === x + 1 || (x === W - 1 && nx === 0)) { c0 = colFirst[x]!; c1 = colLast[nx]! + (nx === 0 ? SRC_COLS : 0); }
        else { c0 = colFirst[nx]! - (x === 0 ? SRC_COLS : 0); c1 = colLast[x]!; }
        const rows = r1 - r0 + 1;
        const cols = c1 - c0 + 1;
        const n = rows * cols;
        const wrapCol = (c: number): number => (((c % SRC_COLS) + SRC_COLS) % SRC_COLS);
        // Fill the window: land bit and owning cell per sample.
        let winLand = 0;
        for (let ly = 0; ly < rows; ly++) {
          const sy = r0 + ly;
          for (let lx = 0; lx < cols; lx++) {
            const sx = wrapCol(c0 + lx);
            const i = ly * cols + lx;
            const l = isLandAt(sy, sx) ? 1 : 0;
            landWin[i] = l;
            winLand += l;
            dist[i] = distAt(sy, sx);
          }
        }
        const toWin = (sy: number, sx: number, shift: number): number => {
          const ly = sy - r0;
          const lx = sx + shift - c0;
          return ly * cols + lx;
        };
        // The neighbour's columns are unwrapped past the antimeridian on the
        // side it lies on, so the window stays one contiguous box.
        const gShift = nx === 0 && x === W - 1 ? SRC_COLS : x === 0 && nx === W - 1 ? -SRC_COLS : 0;
        let byte = 0;
        // Land link.
        if (landSeatY[a]! >= 0 && landSeatY[b]! >= 0) {
          const s = toWin(landSeatY[a]!, landSeatX[a]!, 0);
          const g = toWin(landSeatY[b]!, landSeatX[b]!, gShift);
          if (winLand === n || landReaches(rows, cols, s, g)) byte |= LAND_LINK_BIT;
        }
        // Water width.
        if (waterSeatY[a]! >= 0 && waterSeatY[b]! >= 0) {
          const s = toWin(waterSeatY[a]!, waterSeatX[a]!, 0);
          const g = toWin(waterSeatY[b]!, waterSeatX[b]!, gShift);
          let width: number;
          if (winLand === 0) width = WIDTH_CAP;
          else {
            const dMin = maximin(rows, cols, s, g);
            width = dMin <= 0 ? 0 : Math.min(WIDTH_CAP, 2 * dMin - 1);
          }
          if (width > 0) {
            byte |= width;
            waterLinks++;
            if (width < cellSamples) narrow++;
          }
        }
        if (byte & LAND_LINK_BIT) landLinks++;
        const bothMajorityLand = landMajority[a] && landMajority[b];
        if (bothMajorityLand && !(byte & LAND_LINK_BIT)) maskLandEdgesUnlinked++;
        if (!bothMajorityLand && (byte & LAND_LINK_BIT)) maskMixedLinked++;
        table[a * STORED_DIRECTIONS + d] = byte;
      }
    }
    if (y % Math.max(1, Math.floor(H / 10)) === 0) {
      process.stdout.write(`  ${W}x${H} row ${y}/${H} (${landLinks} land links, ${waterLinks} water links, ${narrow} narrower than a cell)\n`);
    }
  }
  return { W, H, table, landLinks, waterLinks, narrow, maskLandEdgesUnlinked, maskMixedLinked };
}

// 8-connected flood over land samples from s: does it reach g?
function landReaches(rows: number, cols: number, s: number, g: number): boolean {
  const n = rows * cols;
  seen.fill(0, 0, n);
  if (!landWin[s] || !landWin[g]) return false;
  let head = 0;
  let tail = 0;
  queue[tail++] = s;
  seen[s] = 1;
  while (head < tail) {
    const u = queue[head++]!;
    if (u === g) return true;
    const uy = (u / cols) | 0;
    const ux = u - uy * cols;
    for (let d = 0; d < 8; d++) {
      const vy = uy + D8_DY[d]!;
      const vx = ux + D8_DX[d]!;
      if (vy < 0 || vy >= rows || vx < 0 || vx >= cols) continue;
      const v = vy * cols + vx;
      if (seen[v] || !landWin[v]) continue;
      seen[v] = 1;
      queue[tail++] = v;
    }
  }
  return false;
}

// Widest-channel path on 4-connected water: the key of a node is the smallest
// distance-to-land on the best path so far (endpoints included), and a node is
// settled when the largest such key reaches it. Returns that key at the goal,
// or 0 when no water path exists.
function maximin(rows: number, cols: number, s: number, g: number): number {
  const n = rows * cols;
  best.fill(0, 0, n);
  let heapLen = 0;
  const push = (node: number, key: number): void => {
    let i = heapLen++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heapKey[p]! >= key) break;
      heapNode[i] = heapNode[p]!; heapKey[i] = heapKey[p]!;
      i = p;
    }
    heapNode[i] = node; heapKey[i] = key;
  };
  const pop = (): number => {
    const node = heapNode[0]!;
    heapLen--;
    if (heapLen > 0) {
      const ln = heapNode[heapLen]!, lk = heapKey[heapLen]!;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= heapLen) break;
        const r = l + 1;
        const c = r < heapLen && heapKey[r]! > heapKey[l]! ? r : l;
        if (heapKey[c]! <= lk) break;
        heapNode[i] = heapNode[c]!; heapKey[i] = heapKey[c]!;
        i = c;
      }
      heapNode[i] = ln; heapKey[i] = lk;
    }
    return node;
  };
  if (dist[s]! <= 0 || dist[g]! <= 0) return 0;
  best[s] = dist[s]!;
  push(s, best[s]!);
  while (heapLen > 0) {
    const key = heapKey[0]!;
    const u = pop();
    if (key < best[u]!) continue;
    if (u === g) return key;
    const uy = (u / cols) | 0;
    const ux = u - uy * cols;
    for (let d = 0; d < 8; d += 2) {
      const vy = uy + D8_DY[d]!;
      const vx = ux + D8_DX[d]!;
      if (vy < 0 || vy >= rows || vx < 0 || vx >= cols) continue;
      const v = vy * cols + vx;
      const dv = dist[v]!;
      if (dv <= 0) continue;
      const cand = Math.min(key, dv);
      if (cand > best[v]!) { best[v] = cand; push(v, cand); }
    }
  }
  return 0;
}

// Run-length encoding: (varint run length, value byte) per run. Interiors of
// continents and oceans are one value for thousands of edges at a stretch.
function encode(table: Uint8Array): Uint8Array {
  const out: number[] = [];
  let e = 0;
  while (e < table.length) {
    const v = table[e]!;
    let run = 1;
    while (e + run < table.length && table[e + run] === v) run++;
    let len = run;
    while (len >= 0x80) { out.push((len & 0x7f) | 0x80); len >>>= 7; }
    out.push(len);
    out.push(v);
    e += run;
  }
  return Uint8Array.from(out);
}

function decode(b64: string, W: number, H: number): Uint8Array {
  const out = new Uint8Array(W * H * STORED_DIRECTIONS);
  const bin = Buffer.from(b64, "base64");
  let at = 0;
  for (let k = 0; k < bin.length; ) {
    let run = 0, scale = 1;
    for (;;) {
      const byte = bin[k++]!;
      run += (byte & 0x7f) * scale;
      if ((byte & 0x80) === 0) break;
      scale *= 128;
    }
    const v = bin[k++]!;
    out.fill(v, at, at + run);
    at += run;
  }
  if (at !== out.length) throw new Error("run length does not cover the table");
  return out;
}

const started = Date.now();
const baked: { grid: Baked; b64: string; bytes: number }[] = [];
for (const { W, H } of grids) {
  const t0 = Date.now();
  const grid = bakeGrid(W, H);
  const bytes = encode(grid.table);
  const b64 = Buffer.from(bytes).toString("base64");
  const back = decode(b64, W, H);
  for (let e = 0; e < grid.table.length; e++) {
    if (back[e] !== grid.table[e]) throw new Error(`round-trip mismatch at ${W}x${H} entry ${e}`);
  }
  const bands = [1, 2, 4, 8, 16];
  const counts = bands.map(() => 0);
  for (let e = 0; e < grid.table.length; e++) {
    const w = grid.table[e]! & WIDTH_MASK;
    if (w === 0) continue;
    bands.forEach((b, i) => { if (w <= b) counts[i]!++; });
  }
  console.log(`${W}x${H}: ${grid.landLinks} land links, ${grid.waterLinks} water links, ${grid.narrow} narrower than a cell`
    + ` (width <=1: ${counts[0]}, <=2: ${counts[1]}, <=4: ${counts[2]}, <=8: ${counts[3]}, <=16: ${counts[4]});`
    + ` majority-land edges without ground between: ${grid.maskLandEdgesUnlinked}; edges the majority mask calls mixed that share ground: ${grid.maskMixedLinked};`
    + ` ${bytes.length} bytes raw, ${Math.round((bytes.length * 4) / 3 / 1024)} KB base64; ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  baked.push({ grid, b64, bytes: bytes.length });
}

const targetPath = fileURLToPath(new URL("../src/ported/worldgen/crossingData.js", import.meta.url));
const header = `/* V2 W22 — GENERATED by tools/build-crossings.mts from the 1-arc-minute
 * ETOPO1 grid (see tools/fetch-etopo1.md). Do not edit by hand.
 *
 * One byte per edge between ADJACENT CELLS, saying how the two are joined:
 *   bit 7      LAND LINK — an 8-connected path of land samples joins the two
 *              cells' land seats (the land sample nearest each centre).
 *   bits 0..6  WATER WIDTH — the narrowest point, in samples (~1.85 km), of
 *              the widest 4-connected water channel joining the two cells'
 *              water seats (each cell's most open water); 0 = no water
 *              path, ${WIDTH_CAP} = that wide or wider.
 * Both are measured inside the bounding box of the two cells (plus the two
 * side cells for a diagonal pair). Neither changes a cell: the majority mask,
 * elevation and land fraction are what they were; an edge says only whether
 * a traveller can reach the far cell by ground, by water, both, or neither.
 *
 * Four directions are stored per cell, E=0, SE=1, S=2, SW=3 in the sim's D8
 * rose; the other four are the neighbour's entry for the opposite direction.
 * A grid with no table here reads null, and its consumers fall back to the
 * majority mask.
 *
 * Run-length encoded: (varint run length, value byte) per run, index =
 * cell * 4 + direction, row-major cells. One table per sim grid; the bake
 * asserts the decoder reproduces every table byte for byte.
 */
export const CROSSING_LAND_LINK = ${LAND_LINK_BIT};
export const CROSSING_WIDTH_MASK = ${WIDTH_MASK};
export const CROSSING_DIRECTIONS = ${STORED_DIRECTIONS};

/** Rebuild a grid's table: one byte per cell × direction, or null if no table was baked for it. */
export function decodeCrossings(width, height) {
  const b64 = CROSSING_GRIDS[width + "x" + height];
  if (!b64) return null;
  const out = new Uint8Array(width * height * CROSSING_DIRECTIONS);
  const bin = atob(b64);
  let at = 0;
  for (let k = 0; k < bin.length; ) {
    let run = 0, scale = 1;
    for (;;) {
      const byte = bin.charCodeAt(k++);
      run += (byte & 0x7f) * scale;
      if ((byte & 0x80) === 0) break;
      scale *= 128;
    }
    const v = bin.charCodeAt(k++);
    out.fill(v, at, at + run);
    at += run;
  }
  return out;
}
`;
const body = baked
  .map(({ grid, b64, bytes }) => `  // ${grid.W}x${grid.H}: ${grid.landLinks} land links, ${grid.waterLinks} water links, ${grid.narrow} narrower than a cell; ${bytes} bytes raw\n  "${grid.W}x${grid.H}": "${b64}",`)
  .join("\n");
writeFileSync(targetPath, `${header}\nexport const CROSSING_GRIDS = {\n${body}\n};\n`);
console.log(`wrote ${targetPath} in ${((Date.now() - started) / 1000).toFixed(0)} s`);

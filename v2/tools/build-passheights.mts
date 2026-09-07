/* V2 W21 — THE HEIGHT OF THE PASS
 *
 * A sim cell's elevation is a MEAN over a few hundred km2, and a mean has no
 * direction: a ridge that walls one side of the cell and a plain on the other
 * average into one gentle hill, and the router walks through the wall at the
 * cost of the hill. Elevation, relief and slope are all per-cell scalars; none
 * of them can say "crossing from HERE to THERE climbs a pass".
 *
 * A pass is not an average. It is an EXTREMAL quantity along a path: the
 * lowest crossing between two places is the minimum, over all routes, of the
 * highest ground the route touches. Averaging destroys it, exactly as
 * averaging a coastline destroys a strait (W18/W20) — so it has to be
 * measured on the fine grid and stored PER EDGE, not per cell.
 *
 * Rule (a physical statement, no place name in it):
 *   For every pair of adjacent LAND cells a→b (the sim's D8 rose, four
 *   directions stored per cell, the other four are the neighbour's), take the
 *   1-arc-minute samples inside the bounding box of the two cells (for a
 *   diagonal pair that box holds the two side cells too — a diagonal move
 *   crosses their ground, as the router's no-corner-cutting rule already
 *   says). PASS(a,b) is the minimax path from a's centre sample to b's centre
 *   sample: the minimum over paths of the highest interior sample on the
 *   path, with ground below sea level counted at sea level. The stored value
 *   is the EXTRA CLIMB the pass demands beyond what the two cell means already
 *   charge: max(0, PASS − max(mean_a, mean_b)), in metres.
 *
 * That is the same search the river bake runs along a channel (RIVER_GRAD is
 * a reach-scale measurement on the same samples), with one change of
 * operator: SUM along the path gives a travel time, MAX along the path gives a
 * pass. And it is the bottom rung of a route-planning hierarchy: the cost to
 * cross a block, computed from the finer graph inside it, once, at bake.
 *
 * Why "extra above the mean" and not the pass height itself: the router
 * already charges the ascent between the two cell means (its Naismith term),
 * so the pass adds only what lies above the higher of them — zero across every
 * plain, valley floor and gentle slope, which is most of the land. The table
 * is therefore SPARSE and the ridges stand out in it by themselves.
 *
 * Why per SIM GRID and not on the finer plane: the sim reads only its own
 * edges, the two grids that ship are the two the third cardinal rule names,
 * and an exact search on the samples costs nothing at bake and nothing at
 * load. A grid without a table gets a zero table — the behaviour every
 * consumer had before this existed — and this tool bakes any grid on request.
 *
 * Input: the 1-arc-minute ETOPO1 grid, raw little-endian int16, dimensions in
 * the filename, rows ascending from -90 (tools/fetch-etopo1.md).
 *
 * Usage: npx tsx tools/build-passheights.mts etopo1-21601x10801.bin [WxH ...]
 *        (default grids: 240x120 and 1800x900)
 */
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// The encoding step. 255 steps reach 8,160 m, above every land crossing on
// Earth (the highest motorable and caravan passes sit near 5,600 m); the
// elevation bake's own step is ~20.5 m/byte, so a pass is stored at
// comparable precision to the means it is measured against.
const M_PER_BYTE = 32;
const D8_DX = [1, 1, 0, -1, -1, -1, 0, 1];
const D8_DY = [0, 1, 1, 1, 0, -1, -1, -1];
const STORED_DIRECTIONS = 4; // E, SE, S, SW — W, NW, N, NE are the neighbour's

const binPath = process.argv[2];
if (!binPath) throw new Error("usage: build-passheights.mts <etopo1-WxH.bin> [WxH ...]");
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
const heightAt = (sy: number, sx: number): number => {
  const v = src[sy * SRC_W + sx]!;
  return v > 0 ? v : 0;
};

interface Baked {
  readonly W: number;
  readonly H: number;
  readonly table: Uint8Array;
  readonly nonzero: number;
  readonly landEdges: number;
  readonly landCells: number;
}

// Minimax search workspace, sized to the largest window of the run.
let best = new Float64Array(0);
let heapNode = new Int32Array(0);
let heapKey = new Float64Array(0);

function bakeGrid(W: number, H: number): Baked {
  if (SRC_COLS % W !== 0 && SRC_COLS < W * 4) throw new Error("source too coarse for this grid");
  // Sample -> cell binning, the elevation and shape bakes' own rule.
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
  // Cell means and the mask (majority of samples above sea level).
  const cells = W * H;
  const landN = new Uint32Array(cells);
  const allN = new Uint32Array(cells);
  const landSum = new Float64Array(cells);
  for (let sy = 0; sy < SRC_H; sy++) {
    const base = rowOf[sy]! * W;
    const rowBase = sy * SRC_W;
    for (let sx = 0; sx < SRC_COLS; sx++) {
      const o = base + colOf[sx]!;
      allN[o]!++;
      const v = src[rowBase + sx]!;
      if (v > 0) { landN[o]!++; landSum[o]! += v; }
    }
  }
  const land = new Uint8Array(cells);
  const mean = new Float64Array(cells);
  let landCells = 0;
  for (let o = 0; o < cells; o++) {
    if (allN[o] === 0) throw new Error(`no source samples for cell ${o}`);
    if (landN[o]! * 2 > allN[o]!) { land[o] = 1; landCells++; }
    mean[o] = landN[o] ? landSum[o]! / landN[o]! : 0;
  }
  const maxWinRows = 2 * (Math.ceil(SRC_H / H) + 1);
  const maxWinCols = 2 * (Math.ceil(SRC_COLS / W) + 1);
  const winCap = maxWinRows * maxWinCols;
  if (best.length < winCap) {
    best = new Float64Array(winCap);
    heapNode = new Int32Array(winCap * 8);
    heapKey = new Float64Array(winCap * 8);
  }

  const table = new Uint8Array(cells * STORED_DIRECTIONS);
  let nonzero = 0;
  let landEdges = 0;
  let searched = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const a = y * W + x;
      if (!land[a]) continue;
      for (let d = 0; d < STORED_DIRECTIONS; d++) {
        const ny = y + D8_DY[d]!;
        if (ny < 0 || ny >= H) continue;
        const nx = (x + D8_DX[d]! + W) % W;
        const b = ny * W + nx;
        if (!land[b]) continue;
        landEdges++;
        const floor = Math.max(mean[a]!, mean[b]!);
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
        const cy = ((rowFirst[y]! + rowLast[y]!) >> 1) - r0;
        const cx = ((colFirst[x]! + colLast[x]!) >> 1) - c0;
        const gy = ((rowFirst[ny]! + rowLast[ny]!) >> 1) - r0;
        // The neighbour's columns are unwrapped past the antimeridian on the
        // side it lies on, so the window stays one contiguous box.
        const gShift = nx === 0 && x === W - 1 ? SRC_COLS : x === 0 && nx === W - 1 ? -SRC_COLS : 0;
        const gx = ((colFirst[nx]! + colLast[nx]!) >> 1) + gShift - c0;
        const sample = (ly: number, lx: number): number => heightAt(r0 + ly, (((c0 + lx) % SRC_COLS) + SRC_COLS) % SRC_COLS);
        // Cheap exact shortcut: the straight segment is one path, so if its
        // interior never rises above the floor the extra climb is zero.
        let lineMax = 0;
        {
          const steps = Math.max(Math.abs(gy - cy), Math.abs(gx - cx));
          for (let s = 1; s < steps; s++) {
            const ly = Math.round(cy + ((gy - cy) * s) / steps);
            const lx = Math.round(cx + ((gx - cx) * s) / steps);
            const h = sample(ly, lx);
            if (h > lineMax) lineMax = h;
          }
        }
        if (lineMax <= floor) continue;
        searched++;
        const pass = minimax(rows, cols, cy, cx, gy, gx, sample);
        if (!Number.isFinite(pass)) throw new Error(`no path inside the window for cell ${a} direction ${d}`);
        const extra = Math.max(0, pass - floor);
        const q = Math.min(255, Math.round(extra / M_PER_BYTE));
        if (q > 0) { table[a * STORED_DIRECTIONS + d] = q; nonzero++; }
      }
    }
    if (y % Math.max(1, Math.floor(H / 10)) === 0) {
      process.stdout.write(`  ${W}x${H} row ${y}/${H} (${landEdges} land edges, ${searched} searched, ${nonzero} nonzero)\n`);
    }
  }
  return { W, H, table, nonzero, landEdges, landCells };
}

// Bottleneck shortest path on the window's D8 grid: the key of a node is the
// highest INTERIOR sample on the best path so far (start and goal excluded),
// and a node is settled when the lowest such key reaches it.
function minimax(
  rows: number, cols: number, sy: number, sx: number, gy: number, gx: number,
  sample: (ly: number, lx: number) => number,
): number {
  const n = rows * cols;
  best.fill(Infinity, 0, n);
  let heapLen = 0;
  const push = (node: number, key: number): void => {
    let i = heapLen++;
    heapNode[i] = node; heapKey[i] = key;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heapKey[p]! <= key) break;
      heapNode[i] = heapNode[p]!; heapKey[i] = heapKey[p]!;
      i = p;
    }
    heapNode[i] = node; heapKey[i] = key;
  };
  const popTo = (): number => {
    const node = heapNode[0]!;
    heapLen--;
    if (heapLen > 0) {
      const ln = heapNode[heapLen]!, lk = heapKey[heapLen]!;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= heapLen) break;
        const r = l + 1;
        const c = r < heapLen && heapKey[r]! < heapKey[l]! ? r : l;
        if (heapKey[c]! >= lk) break;
        heapNode[i] = heapNode[c]!; heapKey[i] = heapKey[c]!;
        i = c;
      }
      heapNode[i] = ln; heapKey[i] = lk;
    }
    return node;
  };
  const start = sy * cols + sx;
  const goal = gy * cols + gx;
  best[start] = 0;
  push(start, 0);
  while (heapLen > 0) {
    const key = heapKey[0]!;
    const u = popTo();
    if (key > best[u]!) continue;
    if (u === goal) return key;
    const uy = (u / cols) | 0;
    const ux = u - uy * cols;
    for (let d = 0; d < 8; d++) {
      const vy = uy + D8_DY[d]!;
      const vx = ux + D8_DX[d]!;
      if (vy < 0 || vy >= rows || vx < 0 || vx >= cols) continue;
      const v = vy * cols + vx;
      const cand = v === goal ? key : Math.max(key, sample(vy, vx));
      if (cand < best[v]!) { best[v] = cand; push(v, cand); }
    }
  }
  return Infinity;
}

// Sparse encoding: (varint index delta, value byte) per nonzero entry.
function encode(table: Uint8Array): Uint8Array {
  const out: number[] = [];
  let previous = -1;
  for (let e = 0; e < table.length; e++) {
    const v = table[e]!;
    if (v === 0) continue;
    let delta = e - previous;
    previous = e;
    while (delta >= 0x80) { out.push((delta & 0x7f) | 0x80); delta >>>= 7; }
    out.push(delta);
    out.push(v);
  }
  return Uint8Array.from(out);
}

function decode(b64: string, W: number, H: number): Uint8Array {
  const out = new Uint8Array(W * H * STORED_DIRECTIONS);
  const bin = Buffer.from(b64, "base64");
  let at = -1;
  for (let k = 0; k < bin.length; ) {
    let delta = 0, scale = 1;
    for (;;) {
      const byte = bin[k++]!;
      delta += (byte & 0x7f) * scale;
      if ((byte & 0x80) === 0) break;
      scale *= 128;
    }
    at += delta;
    out[at] = bin[k++]!;
  }
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
  // Distribution, for the record.
  const bands = [500, 1000, 2000, 3000];
  const counts = bands.map(() => 0);
  let maxQ = 0;
  for (let e = 0; e < grid.table.length; e++) {
    const m = grid.table[e]! * M_PER_BYTE;
    if (grid.table[e]! > maxQ) maxQ = grid.table[e]!;
    bands.forEach((b, i) => { if (m >= b) counts[i]!++; });
  }
  console.log(`${W}x${H}: ${grid.landCells} land cells, ${grid.landEdges} land-land edges, ${grid.nonzero} with extra climb`
    + ` (${((100 * grid.nonzero) / Math.max(1, grid.landEdges)).toFixed(1)}%); >=500 m ${counts[0]}, >=1000 m ${counts[1]},`
    + ` >=2000 m ${counts[2]}, >=3000 m ${counts[3]}, max ${maxQ * M_PER_BYTE} m; ${bytes.length} bytes raw,`
    + ` ${Math.round((bytes.length * 4) / 3 / 1024)} KB base64; ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  baked.push({ grid, b64, bytes: bytes.length });
}

const targetPath = fileURLToPath(new URL("../src/ported/worldgen/passClimbData.js", import.meta.url));
const header = `/* V2 W21 — GENERATED by tools/build-passheights.mts from the 1-arc-minute
 * ETOPO1 grid (see tools/fetch-etopo1.md). Do not edit by hand.
 *
 * The extra climb a route between two ADJACENT LAND CELLS has to make beyond
 * the ascent between the two cells' mean elevations: the lowest crossing from
 * the one cell's centre to the other's, measured by a minimax search on the
 * 1-arc-minute samples inside the two cells' bounding box, minus the higher
 * of the two means, floored at zero. Metres, in steps of ${M_PER_BYTE} m, one byte per
 * edge, 255 = ${255 * M_PER_BYTE} m or more.
 *
 * Four directions are stored per cell, E=0, SE=1, S=2, SW=3 in the sim's D8
 * rose; the other four are the neighbour's entry for the opposite direction.
 * An edge that touches a sea cell, or a grid with no table here, reads zero —
 * the ascent the router already charges, and nothing more.
 *
 * Sparse: (varint index delta, value byte) per nonzero entry, index =
 * cell * 4 + direction, row-major cells. One table per sim grid; the bake
 * asserts the decoder reproduces every table byte for byte.
 */
export const PASS_CLIMB_M_PER_BYTE = ${M_PER_BYTE};
export const PASS_CLIMB_DIRECTIONS = ${STORED_DIRECTIONS};

/** Rebuild a grid's table: one byte per cell × direction, or null if no table was baked for it. */
export function decodePassClimb(width, height) {
  const b64 = PASS_CLIMB_GRIDS[width + "x" + height];
  if (!b64) return null;
  const out = new Uint8Array(width * height * PASS_CLIMB_DIRECTIONS);
  const bin = atob(b64);
  let at = -1;
  for (let k = 0; k < bin.length; ) {
    let delta = 0, scale = 1;
    for (;;) {
      const byte = bin.charCodeAt(k++);
      delta += (byte & 0x7f) * scale;
      if ((byte & 0x80) === 0) break;
      scale *= 128;
    }
    at += delta;
    out[at] = bin.charCodeAt(k++);
  }
  return out;
}
`;
const body = baked
  .map(({ grid, b64, bytes }) => `  // ${grid.W}x${grid.H}: ${grid.nonzero} of ${grid.landEdges} land edges carry extra climb; ${bytes} bytes raw\n  "${grid.W}x${grid.H}": "${b64}",`)
  .join("\n");
writeFileSync(targetPath, `${header}\nexport const PASS_CLIMB_GRIDS = {\n${body}\n};\n`);
console.log(`wrote ${targetPath} in ${((Date.now() - started) / 1000).toFixed(0)} s`);

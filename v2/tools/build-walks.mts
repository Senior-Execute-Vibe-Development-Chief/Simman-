/* V2 W26 — THE WALK BETWEEN TWO CELLS
 *
 * W21 charged a step between two adjacent land cells three things added up:
 * the cell's days per km over the straight distance between the centres,
 * the ascent between the two cell means, and the height of the lowest
 * crossing above them (a minimax over the fine samples). That is a proxy
 * for a walk, and a route drawn from it is a chain of cell centres. Owner:
 * "can we make path finding MORE realistic then?"
 *
 * Rule (a physical statement, no place name in it):
 *   For every pair of adjacent LAND cells a→b (the router's four stored
 *   directions; the other four are the neighbour's), search the 1-arc-minute
 *   land samples inside the two cells' window (sampleBins.js; a diagonal's
 *   window holds its two side cells) for the CHEAPEST WALK from a's centre
 *   sample to b's under the sim's own foot law: every metre of horizontal
 *   distance, plus every metre climbed OR descended at the Naismith rate
 *   (TRAVEL_SLOPE_COST_FACTOR days per ELEVATION_METERS_PER_UNIT, against
 *   1 / TRAVEL_FOOT_KM_PER_DAY days per km — one metre of vertical is
 *   worth ~8 m of horizontal, Naismith's own ratio). Water samples are not
 *   walked; ground below the datum stands at the datum. A cell whose centre
 *   sample is water starts from the land sample nearest its centre.
 *   Stored: the walk's LENGTH (km), its ASCENT a→b and its ASCENT b→a
 *   (the metres climbed along it in each direction; their sum is the
 *   walk's total vertical, their difference the height between the two
 *   centre samples) — the numbers the router's Naismith law takes, measured
 *   on the ground instead of proxied from means — and its WAYPOINTS, the
 *   walk simplified to at most WAYPOINT_CAP interior points that keep it
 *   within WAYPOINT_TOLERANCE of the ground path, as fractions of the window.
 *
 * Ascent per direction, as Naismith has it: the climb costs, the descent
 * does not (his rule, and the ledger's grounding of TRAVEL_SLOPE_COST_FACTOR).
 * Before W26 the router charged |Δmean| + 2 × climb both ways — the up AND
 * the down of the hump to whichever traveller — a symmetric proxy; the edge
 * is now directed, as the sail edges already were. A route through a gorge
 * that winds up 800 m and down 500 pays the winding and 800 m one way,
 * 500 m the other. The pass table (W21) is superseded: what it approximated
 * is now measured, on the same samples, with the operator the law names.
 * The SEARCH still weighs both (it finds one walk to serve both directions,
 * so it minimises km + total vertical × the rate ÷ 2, the mean of the two
 * directions' costs).
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildFineLand, readEtopo } from "./lib/fine-water.mjs";
import { edgeWindow, sampleBins, WALK_DX, WALK_DY } from "../src/ported/worldgen/sampleBins.js";
import { ELEVATION_METERS_PER_UNIT, TRAVEL_FOOT_KM_PER_DAY, TRAVEL_SLOPE_COST_FACTOR } from "../src/sim/constants";
import { buildSubstrate, type Substrate } from "../src/sim/substrate";
import { crossingAt, crossingHasGround } from "../src/sim/crossings";
import type { GridPreset } from "../src/sim/world";

// Horizontal km one metre of vertical is worth under the foot law — the
// search's only weight, and it is the router's, not the bake's.
const KM_PER_ASCENT_M = (TRAVEL_SLOPE_COST_FACTOR / ELEVATION_METERS_PER_UNIT) * TRAVEL_FOOT_KM_PER_DAY;
// One walk serves both directions; the search weighs each metre of vertical
// at half the ascent rate — the mean of the climb it is one way and the
// descent it is the other.
const KM_PER_VERTICAL_M = KM_PER_ASCENT_M / 2;
// One arc-minute along a meridian, km (40,007.86 km / 21,600).
const KM_PER_ROW = 40007.86 / 21600;
// Waypoints: at most this many interior points per edge, chosen so the
// polyline stays within this share of the edge's straight length of the
// ground path (Douglas–Peucker). A drawing budget, not a sim quantity.
const WAYPOINT_CAP = 6;
const WAYPOINT_TOLERANCE = 0.08;
const STORED_DIRECTIONS = 4;
const D8_DX = [1, 1, 0, -1, -1, -1, 0, 1];
const D8_DY = [0, 1, 1, 1, 0, -1, -1, -1];
// The stored length is the walk's DETOUR over the straight line between the
// two centre samples, in steps of DETOUR_UNIT, one byte (1 = no detour,
// 255 = 254 steps or more, 0 = no walk); the decoder multiplies the
// grid's own straight edge length back in. Vertical is stored in steps of
// VERTICAL_UNIT_M: the raster's own vertical noise is larger than that.
// Both ascents share the unit.
const DETOUR_UNIT = 0.002;
const VERTICAL_UNIT_M = 4;

const binPath = process.argv[2];
if (!binPath) throw new Error("usage: build-walks.mts <etopo1-WxH.bin> [WxH ...]");
// The walk table is per SIM GRID and reads the sim's own mask and crossing
// table (an edge is walked exactly where the router may walk it: two land
// cells whose ground the table joins), so the bake builds the substrate the
// sim builds. That imports walkData.js itself; a first bake on a tree
// without one needs an empty module (export const WALK_GRIDS = {}).
const gridArgs = process.argv.slice(3);
const grids = (gridArgs.length ? gridArgs : ["dev", "target"]) as GridPreset[];
const started = Date.now();
const { src, SRC_W, SRC_H } = readEtopo(binPath);
const SRC_COLS = SRC_W - 1;
const fineLand = buildFineLand(src, SRC_W, SRC_H).land;
const heightAt = (sy: number, sx: number): number => { const v = src[sy * SRC_W + sx]!; return v > 0 ? v : 0; };
const landAt = (sy: number, sx: number): boolean => fineLand[sy * SRC_W + sx] === 1;
const rowKm = new Float64Array(SRC_H);
for (let sy = 0; sy < SRC_H; sy++) rowKm[sy] = KM_PER_ROW * Math.max(1e-6, Math.cos((-90 + (180 * sy) / (SRC_H - 1)) * Math.PI / 180));

// Search workspace, sized to the largest window of the run.
let best = new Float64Array(0);
let cameFrom = new Int32Array(0);
let heapNode = new Int32Array(0);
let heapKey = new Float64Array(0);

interface Walk { km: number; up: number; down: number; path: Int32Array }

/** A* over the window's land samples: key = walked km + vertical × weight;
 * the heuristic is the straight km to the goal (vertical is never negative). */
function cheapestWalk(
  rows: number, cols: number, r0: number, c0: number, sy: number, sx: number, gy: number, gx: number,
): Walk | null {
  const n = rows * cols;
  best.fill(Infinity, 0, n);
  cameFrom.fill(-1, 0, n);
  let heapLen = 0;
  const push = (node: number, key: number): void => {
    let i = heapLen++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heapKey[p]! <= key) break;
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
        const c = r < heapLen && heapKey[r]! < heapKey[l]! ? r : l;
        if (heapKey[c]! >= lk) break;
        heapNode[i] = heapNode[c]!; heapKey[i] = heapKey[c]!;
        i = c;
      }
      heapNode[i] = ln; heapKey[i] = lk;
    }
    return node;
  };
  const colOf = (lx: number): number => (((c0 + lx) % SRC_COLS) + SRC_COLS) % SRC_COLS;
  const heuristic = (ly: number, lx: number): number => {
    const dy = (gy - ly) * KM_PER_ROW;
    const dx = (gx - lx) * rowKm[r0 + ly]!;
    return Math.sqrt(dx * dx + dy * dy);
  };
  const start = sy * cols + sx;
  const goal = gy * cols + gx;
  best[start] = 0;
  push(start, heuristic(sy, sx));
  while (heapLen > 0) {
    const u = pop();
    const uy = (u / cols) | 0;
    const ux = u - uy * cols;
    const gU = best[u]!;
    if (u === goal) break;
    const hu = heightAt(r0 + uy, colOf(ux));
    for (let d = 0; d < 8; d++) {
      const vy = uy + D8_DY[d]!;
      const vx = ux + D8_DX[d]!;
      if (vy < 0 || vy >= rows || vx < 0 || vx >= cols) continue;
      const scol = colOf(vx);
      if (!landAt(r0 + vy, scol)) continue;
      const v = vy * cols + vx;
      const ew = D8_DX[d] === 0 ? 0 : (rowKm[r0 + uy]! + rowKm[r0 + vy]!) / 2;
      const ns = D8_DY[d] === 0 ? 0 : KM_PER_ROW;
      const km = Math.sqrt(ew * ew + ns * ns);
      const vertical = Math.abs(heightAt(r0 + vy, scol) - hu);
      const g = gU + km + vertical * KM_PER_VERTICAL_M;
      if (g < best[v]!) { best[v] = g; cameFrom[v] = u; push(v, g + heuristic(vy, vx)); }
    }
  }
  if (!Number.isFinite(best[goal]!)) return null;
  // Walk the path back and measure it in the two stored quantities.
  const nodes: number[] = [];
  for (let at = goal; at >= 0; at = cameFrom[at]!) { nodes.push(at); if (at === start) break; }
  nodes.reverse();
  let km = 0, up = 0, down = 0;
  for (let k = 1; k < nodes.length; k++) {
    const a = nodes[k - 1]!, b = nodes[k]!;
    const ay = (a / cols) | 0, ax = a - ay * cols, by = (b / cols) | 0, bx = b - by * cols;
    const ew = ax === bx ? 0 : (rowKm[r0 + ay]! + rowKm[r0 + by]!) / 2;
    const ns = ay === by ? 0 : KM_PER_ROW;
    km += Math.sqrt(ew * ew + ns * ns);
    const rise = heightAt(r0 + by, colOf(bx)) - heightAt(r0 + ay, colOf(ax));
    if (rise > 0) up += rise; else down -= rise;
  }
  return { km, up, down, path: Int32Array.from(nodes) };
}

/** Douglas–Peucker on window coordinates (km-scaled), returning interior
 * point indices within the cap. */
function simplify(path: Int32Array, cols: number, r0: number, toleranceKm: number): number[] {
  const px = (k: number): number => (path[k]! % cols) * rowKm[r0 + ((path[k]! / cols) | 0)]!;
  const py = (k: number): number => ((path[k]! / cols) | 0) * KM_PER_ROW;
  const keep: number[] = [];
  const stack: [number, number][] = [[0, path.length - 1]];
  const chosen = new Set<number>();
  while (stack.length) {
    const [i, j] = stack.pop()!;
    if (j - i < 2) continue;
    const x0 = px(i), y0 = py(i), x1 = px(j), y1 = py(j);
    const len = Math.hypot(x1 - x0, y1 - y0) || 1e-9;
    let worst = -1, worstD = 0;
    for (let k = i + 1; k < j; k++) {
      const d = Math.abs((x1 - x0) * (y0 - py(k)) - (x0 - px(k)) * (y1 - y0)) / len;
      if (d > worstD) { worstD = d; worst = k; }
    }
    if (worst >= 0 && worstD > toleranceKm) { chosen.add(worst); stack.push([i, worst], [worst, j]); }
  }
  for (const k of [...chosen].sort((a, b) => a - b)) keep.push(k);
  if (keep.length <= WAYPOINT_CAP) return keep;
  // Over the cap: keep the points that deviate most, in path order.
  const scored = keep.map((k) => {
    const x0 = px(0), y0 = py(0), x1 = px(path.length - 1), y1 = py(path.length - 1);
    const len = Math.hypot(x1 - x0, y1 - y0) || 1e-9;
    return { k, d: Math.abs((x1 - x0) * (y0 - py(k)) - (x0 - px(k)) * (y1 - y0)) / len };
  }).sort((a, b) => b.d - a.d).slice(0, WAYPOINT_CAP).map((s) => s.k).sort((a, b) => a - b);
  return scored;
}

interface Baked {
  W: number; H: number; detour: Uint8Array; up: Uint16Array; down: Uint16Array; way: Uint8Array; capped: number;
  landEdges: number; walked: number; unreachable: number; withWaypoints: number; waypointBytes: number;
  detourSum: number; verticalSum: number; straightSum: number;
}

function bakeGrid(substrate: Substrate): Baked {
  const { width: W, height: H, landMask: land, crossings } = substrate;
  const bins = sampleBins(W, H, SRC_COLS, SRC_H);
  const cells = W * H;
  const maxWinRows = 2 * (Math.ceil(SRC_H / H) + 1);
  const maxWinCols = 2 * (Math.ceil(SRC_COLS / W) + 1);
  const winCap = maxWinRows * maxWinCols;
  if (best.length < winCap) {
    best = new Float64Array(winCap);
    cameFrom = new Int32Array(winCap);
    heapNode = new Int32Array(winCap * 8);
    heapKey = new Float64Array(winCap * 8);
  }
  // The land sample nearest a cell's centre, in window coordinates.
  const centreOf = (x: number, y: number, r0: number, c0: number, rows: number, cols: number): [number, number] | null => {
    const cy = ((bins.rowFirst[y]! + bins.rowLast[y]!) >> 1) - r0;
    let cxAbs = (bins.colFirst[x]! + bins.colLast[x]!) >> 1;
    // Unwrap onto the window's side.
    if (cxAbs < c0) cxAbs += SRC_COLS;
    if (cxAbs > c0 + cols - 1) cxAbs -= SRC_COLS;
    const cx = cxAbs - c0;
    const colOf = (lx: number): number => (((c0 + lx) % SRC_COLS) + SRC_COLS) % SRC_COLS;
    if (landAt(r0 + cy, colOf(cx))) return [cy, cx];
    let bestD = Infinity, by = -1, bx = -1;
    const ry0 = bins.rowFirst[y]! - r0, ry1 = bins.rowLast[y]! - r0;
    let cx0 = bins.colFirst[x]!, cx1 = bins.colLast[x]!;
    if (cx0 < c0) { cx0 += SRC_COLS; cx1 += SRC_COLS; }
    if (cx0 > c0 + cols - 1) { cx0 -= SRC_COLS; cx1 -= SRC_COLS; }
    for (let ly = ry0; ly <= ry1; ly++) for (let lxAbs = cx0; lxAbs <= cx1; lxAbs++) {
      const lx = lxAbs - c0;
      if (lx < 0 || lx >= cols) continue;
      if (!landAt(r0 + ly, colOf(lx))) continue;
      const d = (ly - cy) * (ly - cy) + (lx - cx) * (lx - cx);
      if (d < bestD) { bestD = d; by = ly; bx = lx; }
    }
    return by < 0 ? null : [by, bx];
  };
  const detour = new Uint8Array(cells * STORED_DIRECTIONS);
  const up = new Uint16Array(cells * STORED_DIRECTIONS);
  const down = new Uint16Array(cells * STORED_DIRECTIONS);
  let capped = 0;
  const way: number[] = [];
  let landEdges = 0, walked = 0, unreachable = 0, withWaypoints = 0, detourSum = 0, verticalSum = 0, straightSum = 0;
  let previousEdge = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const a = y * W + x;
      if (!land[a]) continue;
      for (let d = 0; d < STORED_DIRECTIONS; d++) {
        const ny = y + WALK_DY[d]!;
        if (ny < 0 || ny >= H) continue;
        const nx = (x + WALK_DX[d]! + W) % W;
        const b = ny * W + nx;
        if (!land[b]) continue;
        if (!crossingHasGround(crossingAt(crossings, W, H, a, WALK_DX[d]!, WALK_DY[d]!))) continue;
        landEdges++;
        const { r0, r1, c0, c1 } = edgeWindow(bins, x, y, d);
        const rows = r1 - r0 + 1;
        const cols = c1 - c0 + 1;
        const s = centreOf(x, y, r0, c0, rows, cols);
        const g = centreOf(nx, ny, r0, c0, rows, cols);
        if (!s || !g) { unreachable++; continue; }
        const walk = cheapestWalk(rows, cols, r0, c0, s[0], s[1], g[0], g[1]);
        if (!walk) { unreachable++; continue; }
        walked++;
        const e = a * STORED_DIRECTIONS + d;
        const dy = (g[0] - s[0]) * KM_PER_ROW;
        const dx = (g[1] - s[1]) * rowKm[r0 + ((s[0] + g[0]) >> 1)]!;
        const straight = Math.sqrt(dx * dx + dy * dy);
        // The decoder multiplies the sim grid's own straight edge length back
        // in, so the ratio is taken against the same straight line here.
        const ratio = Math.round(Math.max(0, walk.km / Math.max(1e-9, straight) - 1) / DETOUR_UNIT) + 1;
        if (ratio > 255) capped++;
        detour[e] = Math.min(255, ratio);
        up[e] = Math.min(65535, Math.round(walk.up / VERTICAL_UNIT_M));
        down[e] = Math.min(65535, Math.round(walk.down / VERTICAL_UNIT_M));
        straightSum += straight; detourSum += walk.km; verticalSum += walk.up + walk.down;
        const points = simplify(walk.path, cols, r0, straight * WAYPOINT_TOLERANCE);
        if (points.length === 0) continue;
        withWaypoints++;
        let delta = e - previousEdge;
        previousEdge = e;
        while (delta >= 0x80) { way.push((delta & 0x7f) | 0x80); delta >>>= 7; }
        way.push(delta);
        way.push(points.length);
        for (const k of points) {
          const ly = (walk.path[k]! / cols) | 0;
          const lx = walk.path[k]! - ly * cols;
          way.push(Math.round((lx / Math.max(1, cols - 1)) * 255));
          way.push(Math.round((ly / Math.max(1, rows - 1)) * 255));
        }
      }
    }
    if (y % Math.max(1, Math.floor(H / 10)) === 0) {
      process.stdout.write(`  ${W}x${H} row ${y}/${H}: ${landEdges} land edges, ${walked} walked, ${unreachable} unreachable, ${withWaypoints} with waypoints; ${((Date.now() - started) / 1000).toFixed(0)} s\n`);
    }
  }
  return { W, H, detour, up, down, way: Uint8Array.from(way), capped, landEdges, walked, unreachable, withWaypoints, waypointBytes: way.length, detourSum, verticalSum, straightSum };
}

// Per land cell with any walk: (varint cell delta, mask byte of the stored
// directions present, then per present direction a detour byte, a varint
// ascent a→b and a varint ascent b→a). Deltas are mostly 1, so the mask
// carries four edges for the price of one index.
function encodeTables(detour: Uint8Array, up: Uint16Array, down: Uint16Array): Uint8Array {
  const out: number[] = [];
  const varint = (v: number): void => { while (v >= 0x80) { out.push((v & 0x7f) | 0x80); v >>>= 7; } out.push(v); };
  const cells = detour.length / STORED_DIRECTIONS;
  let previous = -1;
  for (let c = 0; c < cells; c++) {
    let mask = 0;
    for (let d = 0; d < STORED_DIRECTIONS; d++) if (detour[c * STORED_DIRECTIONS + d]) mask |= 1 << d;
    if (!mask) continue;
    varint(c - previous); previous = c;
    out.push(mask);
    for (let d = 0; d < STORED_DIRECTIONS; d++) {
      if (!(mask & (1 << d))) continue;
      out.push(detour[c * STORED_DIRECTIONS + d]!);
      varint(up[c * STORED_DIRECTIONS + d]!);
      varint(down[c * STORED_DIRECTIONS + d]!);
    }
  }
  return Uint8Array.from(out);
}
function decodeTables(bin: Uint8Array, n: number): { detour: Uint8Array; up: Uint16Array; down: Uint16Array } {
  const detour = new Uint8Array(n), up = new Uint16Array(n), down = new Uint16Array(n);
  let k = 0, at = -1;
  const varint = (): number => { let v = 0, s = 1; for (;;) { const b = bin[k++]!; v += (b & 0x7f) * s; if ((b & 0x80) === 0) return v; s *= 128; } };
  while (k < bin.length) {
    at += varint();
    const mask = bin[k++]!;
    for (let d = 0; d < STORED_DIRECTIONS; d++) {
      if (!(mask & (1 << d))) continue;
      detour[at * STORED_DIRECTIONS + d] = bin[k++]!;
      up[at * STORED_DIRECTIONS + d] = varint();
      down[at * STORED_DIRECTIONS + d] = varint();
    }
  }
  return { detour, up, down };
}

const baked: { grid: Baked; tablesB64: string; wayB64: string }[] = [];
for (const preset of grids) {
  const substrate = buildSubstrate(0, {}, preset);
  const { width: W, height: H } = substrate;
  console.log(`${preset}: ${W}x${H} substrate built; ${((Date.now() - started) / 1000).toFixed(0)} s`);
  const grid = bakeGrid(substrate);
  const tables = encodeTables(grid.detour, grid.up, grid.down);
  const back = decodeTables(tables, grid.detour.length);
  for (let e = 0; e < grid.detour.length; e++) {
    if (back.detour[e] !== grid.detour[e] || back.up[e] !== grid.up[e] || back.down[e] !== grid.down[e]) throw new Error(`round-trip mismatch at ${W}x${H} entry ${e}`);
  }
  baked.push({ grid, tablesB64: Buffer.from(tables).toString("base64"), wayB64: Buffer.from(grid.way).toString("base64") });
  console.log(`${W}x${H}: ${grid.landEdges} land edges, ${grid.walked} walked (${grid.unreachable} unreachable → geometric fallback), `
    + `mean detour ${(grid.detourSum / grid.straightSum).toFixed(3)}× the straight line, mean vertical ${(grid.verticalSum / grid.walked).toFixed(0)} m per edge, `
    + `${grid.withWaypoints} edges with waypoints (${Math.round(grid.waypointBytes / 1024)} KB), ${grid.capped} detours capped at ${((254 * DETOUR_UNIT) * 100).toFixed(1)}%, tables ${Math.round(tables.length / 1024)} KB raw`);
}

const targetPath = fileURLToPath(new URL("../src/ported/worldgen/walkData.js", import.meta.url));
const header = `/* V2 W26 — GENERATED by tools/build-walks.mts from the 1-arc-minute
 * ETOPO1 grid (see tools/fetch-etopo1.md). Do not edit by hand.
 *
 * For every pair of adjacent LAND cells, the cheapest walk between their
 * centre samples over the fine land under the sim's foot law (horizontal km
 * plus vertical at the Naismith rate): its DETOUR over the straight line
 * between the centres (one byte: 1 = none, in steps of ${DETOUR_UNIT * 100}%, 255 = ${(254 * DETOUR_UNIT * 100).toFixed(1)}%
 * or more; the decoder's caller multiplies the grid's own straight edge
 * length back in), its ASCENT from the cell to the neighbour and its ASCENT
 * back (metres climbed along the walk in each direction) in steps of
 * ${VERTICAL_UNIT_M} m, one entry per cell × stored direction (E=0, SE=1, S=2, SW=3;
 * the other four are the neighbour's, read with the two ascents swapped),
 * zero where the edge is not land–land or no walk was found (the router
 * then uses the straight geometry and the two means, as before W26).
 *
 * Tables: per land cell with any walk, (varint cell delta, mask byte of the
 * directions present, then per direction a detour byte, a varint ascent
 * out and a varint ascent back).
 * Waypoints: per edge that bends more than ${WAYPOINT_TOLERANCE * 100}% of its straight
 * length off the straight line — (varint edge delta, count, then count ×
 * (x, y) bytes as 0–255 fractions of the edge's window in sampleBins.js),
 * at most ${WAYPOINT_CAP} interior points, for drawing a route on the ground.
 */
export const WALK_DETOUR_UNIT = ${DETOUR_UNIT};
export const WALK_VERTICAL_UNIT_M = ${VERTICAL_UNIT_M};
export const WALK_DIRECTIONS = ${STORED_DIRECTIONS};
export const WALK_SOURCE_COLS = ${SRC_COLS};
export const WALK_SOURCE_ROWS = ${SRC_H};

function varintReader(b64) {
  const bin = atob(b64);
  let k = 0;
  return {
    get done() { return k >= bin.length; },
    next() { let v = 0, s = 1; for (;;) { const b = bin.charCodeAt(k++); v += (b & 0x7f) * s; if ((b & 0x80) === 0) return v; s *= 128; } },
    byte() { return bin.charCodeAt(k++); },
  };
}

/** The three tables for a grid — detour bytes, ascent out and ascent back in
 * WALK_VERTICAL_UNIT_M steps — or null where none was baked. */
export function decodeWalks(width, height) {
  const entry = WALK_GRIDS[width + "x" + height];
  if (!entry) return null;
  const n = width * height * WALK_DIRECTIONS;
  const detour = new Uint8Array(n);
  const up = new Uint16Array(n);
  const down = new Uint16Array(n);
  const reader = varintReader(entry.tables);
  let at = -1;
  while (!reader.done) {
    at += reader.next();
    const mask = reader.byte();
    for (let d = 0; d < WALK_DIRECTIONS; d++) {
      if (!(mask & (1 << d))) continue;
      detour[at * WALK_DIRECTIONS + d] = reader.byte();
      up[at * WALK_DIRECTIONS + d] = reader.next();
      down[at * WALK_DIRECTIONS + d] = reader.next();
    }
  }
  return { detour, up, down };
}

/** The waypoints for a grid as a map from edge index (cell × 4 + direction)
 * to a flat array of (x, y) window fractions in 0–255, or null. */
export function decodeWaypoints(width, height) {
  const entry = WALK_GRIDS[width + "x" + height];
  if (!entry) return null;
  const out = new Map();
  const reader = varintReader(entry.waypoints);
  let at = -1;
  while (!reader.done) {
    at += reader.next();
    const count = reader.byte();
    const points = new Uint8Array(count * 2);
    for (let k = 0; k < points.length; k++) points[k] = reader.byte();
    out.set(at, points);
  }
  return out;
}
`;
const body = baked
  .map(({ grid, tablesB64, wayB64 }) => `  // ${grid.W}x${grid.H}: ${grid.walked} of ${grid.landEdges} land edges walked, ${grid.withWaypoints} with waypoints\n  "${grid.W}x${grid.H}": {\n    tables: "${tablesB64}",\n    waypoints: "${wayB64}",\n  },`)
  .join("\n");
writeFileSync(targetPath, `${header}\nexport const WALK_GRIDS = {\n${body}\n};\n`);
console.log(`wrote ${targetPath} in ${((Date.now() - started) / 1000).toFixed(0)} s`);

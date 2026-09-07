/* V2 W26 — HOW A SIM CELL BINS THE 1-ARC-MINUTE SAMPLES.
 *
 * One rule, read by the bakes and by the shell: the elevation and shape
 * bakes' own binning (a sample belongs to the cell whose longitude and
 * latitude span holds it; the source's +180 column duplicates −180 and is
 * dropped; source row 0 is the south pole, cell row 0 the north). The walk
 * bake (W26) encodes each edge's waypoints as fractions of the edge's window
 * in this binning, and the shell places them by rebuilding the same window,
 * so the two cannot drift apart.
 */

/** First and last source column / row of every cell on a W×H grid. */
export function sampleBins(W, H, SRC_COLS, SRC_H) {
  const colFirst = new Int32Array(W).fill(-1);
  const colLast = new Int32Array(W).fill(-1);
  for (let sx = 0; sx < SRC_COLS; sx++) {
    const lon = -180 + (360 * sx) / SRC_COLS;
    const c = Math.min(W - 1, Math.floor(((lon + 180) / 360) * W));
    if (colFirst[c] < 0) colFirst[c] = sx;
    colLast[c] = sx;
  }
  const rowFirst = new Int32Array(H).fill(-1);
  const rowLast = new Int32Array(H).fill(-1);
  for (let sy = 0; sy < SRC_H; sy++) {
    const lat = -90 + (180 * sy) / (SRC_H - 1);
    const r = Math.min(H - 1, Math.floor(((90 - lat) / 180) * H));
    if (rowFirst[r] < 0) rowFirst[r] = sy;
    rowLast[r] = sy;
  }
  return { W, H, SRC_COLS, SRC_H, colFirst, colLast, rowFirst, rowLast };
}

// The four stored directions per cell (E, SE, S, SW), the router's rose.
export const WALK_DX = [1, 1, 0, -1];
export const WALK_DY = [0, 1, 1, 1];

/** The window of the edge from cell (x, y) in stored direction d: the
 * bounding box of the two cells in sample space (for a diagonal, that box
 * holds the two side cells as well). Columns may run past the antimeridian
 * on the side the neighbour lies on, so the window is one contiguous box;
 * read a column as ((c % SRC_COLS) + SRC_COLS) % SRC_COLS. Rows never wrap. */
export function edgeWindow(bins, x, y, d) {
  const { W, SRC_COLS, colFirst, colLast, rowFirst, rowLast } = bins;
  const ny = y + WALK_DY[d];
  const nx = (x + WALK_DX[d] + W) % W;
  const r0 = Math.min(rowFirst[y], rowFirst[ny]);
  const r1 = Math.max(rowLast[y], rowLast[ny]);
  let c0;
  let c1;
  if (nx === x) { c0 = colFirst[x]; c1 = colLast[x]; }
  else if (nx === x + 1 || (x === W - 1 && nx === 0)) { c0 = colFirst[x]; c1 = colLast[nx] + (nx === 0 ? SRC_COLS : 0); }
  else { c0 = colFirst[nx] - (x === 0 ? SRC_COLS : 0); c1 = colLast[x]; }
  return { r0, r1, c0, c1, nx, ny };
}

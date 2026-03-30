// ── River Hydrology: Conceptual River Network ──
// Computes D8 flow direction and flow accumulation on the territory grid.
// Rivers are DATA, not visual features — they're sub-pixel at this resolution.
// Output feeds into fertility (alluvial bonus), resources (alluvial deposits),
// and future systems (trade routes, settlement placement).

// D8 direction offsets: 0=E, 1=SE, 2=S, 3=SW, 4=W, 5=NW, 6=N, 7=NE, 255=sink/ocean
const D8_DX = [1, 1, 0, -1, -1, -1, 0, 1];
const D8_DY = [0, 1, 1, 1, 0, -1, -1, -1];

// River magnitude categories based on flow accumulation
export const RIVER_NONE = 0;
export const RIVER_STREAM = 1;     // small streams, creeks
export const RIVER_TRIBUTARY = 2;  // significant tributaries
export const RIVER_MAJOR = 3;      // major rivers (Danube, Ganges scale)
export const RIVER_GREAT = 4;      // great rivers (Amazon, Nile, Mississippi scale)

export const RIVER_NAMES = ['', 'Stream', 'Tributary', 'Major River', 'Great River'];

// Compute the full river network for a territory grid.
// Returns: { flowDir, flowAccum, riverMag, maxAccum }
//   flowDir:    Uint8Array(tw*th) — D8 direction (0-7) or 255 for sinks
//   flowAccum:  Float32Array(tw*th) — upstream drainage area (moisture-weighted)
//   riverMag:   Uint8Array(tw*th) — RIVER_NONE..RIVER_GREAT classification
//   maxAccum:   number — highest accumulation value (for normalization)
export function computeRivers(tw, th, tElev, tMoist, tTemp) {
  const N = tw * th;
  const flowDir = new Uint8Array(N);
  flowDir.fill(255);
  const flowAccum = new Float32Array(N);

  // ── Step 1: D8 flow direction ──
  // Each land tile flows to its lowest neighbor. Ocean tiles are sinks.
  // Flat areas (no lower neighbor) also become sinks.
  for (let ty = 0; ty < th; ty++) {
    for (let tx = 0; tx < tw; tx++) {
      const ti = ty * tw + tx;
      const e = tElev[ti];
      if (e <= 0) continue; // ocean = sink

      let minElev = e;
      let minDir = 255; // sink by default
      let minDrop = 0;

      for (let d = 0; d < 8; d++) {
        const nx = (tx + D8_DX[d] + tw) % tw; // wrap X
        const ny = ty + D8_DY[d];
        if (ny < 0 || ny >= th) continue;
        const ni = ny * tw + nx;
        const ne = tElev[ni];

        // Diagonal distance is sqrt(2), cardinal is 1
        const dist = (d % 2 === 0) ? 1 : 1.414;
        const drop = (e - ne) / dist; // steepest descent

        if (drop > minDrop) {
          minDrop = drop;
          minElev = ne;
          minDir = d;
        }
      }

      flowDir[ti] = minDir;
    }
  }

  // ── Step 2: Topological sort for accumulation ──
  // Count how many tiles flow into each tile (in-degree).
  // Process tiles with zero in-degree first, propagating accumulation downstream.
  const inDegree = new Uint16Array(N);
  for (let ti = 0; ti < N; ti++) {
    const d = flowDir[ti];
    if (d === 255) continue;
    const tx = ti % tw, ty = (ti - tx) / tw;
    const nx = (tx + D8_DX[d] + tw) % tw;
    const ny = ty + D8_DY[d];
    if (ny < 0 || ny >= th) continue;
    inDegree[ny * tw + nx]++;
  }

  // Initialize accumulation: each land tile contributes its local moisture
  // (wetter areas generate more runoff → bigger rivers)
  for (let ti = 0; ti < N; ti++) {
    if (tElev[ti] > 0) {
      // Runoff = moisture minus evaporation loss (hot = more evaporation)
      const evapLoss = Math.max(0, tTemp[ti] - 0.3) * 0.4;
      flowAccum[ti] = Math.max(0.05, tMoist[ti] - evapLoss);
    }
  }

  // Queue: start with tiles that have no upstream contributors
  const queue = [];
  for (let ti = 0; ti < N; ti++) {
    if (tElev[ti] > 0 && inDegree[ti] === 0) queue.push(ti);
  }

  // Process in topological order: headwaters first, mouths last
  let head = 0;
  while (head < queue.length) {
    const ti = queue[head++];
    const d = flowDir[ti];
    if (d === 255) continue;

    const tx = ti % tw, ty = (ti - tx) / tw;
    const nx = (tx + D8_DX[d] + tw) % tw;
    const ny = ty + D8_DY[d];
    if (ny < 0 || ny >= th) continue;
    const ni = ny * tw + nx;

    // Pass accumulated flow downstream
    flowAccum[ni] += flowAccum[ti];
    inDegree[ni]--;
    if (inDegree[ni] === 0) queue.push(ni);
  }

  // ── Step 3: Classify river magnitude ──
  // Find max accumulation for adaptive thresholds
  let maxAccum = 0;
  for (let ti = 0; ti < N; ti++) {
    if (tElev[ti] > 0 && flowAccum[ti] > maxAccum) maxAccum = flowAccum[ti];
  }

  const riverMag = new Uint8Array(N);
  if (maxAccum > 0) {
    // Thresholds as fraction of max — adapts to map size and moisture
    const tStream = maxAccum * 0.005;
    const tTributary = maxAccum * 0.02;
    const tMajor = maxAccum * 0.08;
    const tGreat = maxAccum * 0.25;

    for (let ti = 0; ti < N; ti++) {
      if (tElev[ti] <= 0) continue;
      const a = flowAccum[ti];
      if (a >= tGreat) riverMag[ti] = RIVER_GREAT;
      else if (a >= tMajor) riverMag[ti] = RIVER_MAJOR;
      else if (a >= tTributary) riverMag[ti] = RIVER_TRIBUTARY;
      else if (a >= tStream) riverMag[ti] = RIVER_STREAM;
    }
  }

  return { flowDir, flowAccum, riverMag, maxAccum };
}

// Get river magnitude name for a tile
export function riverName(riverMag, ti) {
  return RIVER_NAMES[riverMag[ti]] || '';
}

// Check if a tile is on a navigable river (major or great)
export function isNavigable(riverMag, ti) {
  return riverMag[ti] >= RIVER_MAJOR;
}

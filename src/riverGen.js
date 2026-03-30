// ── River Hydrology: Conceptual River Network ──
// D8 flow direction + priority-flood pit filling + flow accumulation.
// Produces continent-scale rivers (Congo, Nile, Amazon scale).

const D8_DX = [1, 1, 0, -1, -1, -1, 0, 1];
const D8_DY = [0, 1, 1, 1, 0, -1, -1, -1];
const D8_DIST = [1, 1.414, 1, 1.414, 1, 1.414, 1, 1.414];

export const RIVER_NONE = 0;
export const RIVER_STREAM = 1;
export const RIVER_TRIBUTARY = 2;
export const RIVER_MAJOR = 3;      // Danube, Ganges scale
export const RIVER_GREAT = 4;      // Amazon, Nile, Congo scale

export const RIVER_NAMES = ['', 'Stream', 'Tributary', 'Major River', 'Great River'];

export function computeRivers(tw, th, tElev, tMoist, tTemp) {
  const N = tw * th;

  // ── Step 1: Priority-flood pit filling ──
  // Fills depressions so every land tile can drain to the ocean.
  // Uses a min-heap (priority queue) seeded from ocean/edge tiles.
  // This is the standard Planchon-Darboux / priority-flood approach.
  const filled = new Float32Array(N);
  for (let i = 0; i < N; i++) filled[i] = tElev[i];

  // Simple binary min-heap on elevation
  const heap = [];
  const inHeap = new Uint8Array(N);

  function heapPush(ti) {
    heap.push(ti);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (filled[heap[p]] <= filled[heap[i]]) break;
      [heap[i], heap[p]] = [heap[p], heap[i]];
      i = p;
    }
  }
  function heapPop() {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length > 0) {
      heap[0] = last;
      let i = 0;
      while (true) {
        let smallest = i;
        const l = 2 * i + 1, r = 2 * i + 2;
        if (l < heap.length && filled[heap[l]] < filled[heap[smallest]]) smallest = l;
        if (r < heap.length && filled[heap[r]] < filled[heap[smallest]]) smallest = r;
        if (smallest === i) break;
        [heap[i], heap[smallest]] = [heap[smallest], heap[i]];
        i = smallest;
      }
    }
    return top;
  }

  // Seed: ocean tiles and map edges (top/bottom rows)
  for (let ti = 0; ti < N; ti++) {
    const tx = ti % tw, ty = (ti - tx) / tw;
    if (tElev[ti] <= 0 || ty === 0 || ty === th - 1) {
      inHeap[ti] = 1;
      heapPush(ti);
    }
  }

  // Process: flood inward from ocean/edges
  while (heap.length > 0) {
    const ti = heapPop();
    const tx = ti % tw, ty = (ti - tx) / tw;

    for (let d = 0; d < 8; d++) {
      const nx = (tx + D8_DX[d] + tw) % tw;
      const ny = ty + D8_DY[d];
      if (ny < 0 || ny >= th) continue;
      const ni = ny * tw + nx;
      if (inHeap[ni]) continue;
      inHeap[ni] = 1;

      // If neighbor is lower than current, it's in a pit — raise it
      if (filled[ni] <= filled[ti] && tElev[ni] > 0) {
        filled[ni] = filled[ti] + 0.00001; // tiny epsilon to ensure downhill flow
      }
      heapPush(ni);
    }
  }

  // ── Step 2: D8 flow direction on filled surface ──
  const flowDir = new Uint8Array(N);
  flowDir.fill(255);

  for (let ty = 0; ty < th; ty++) {
    for (let tx = 0; tx < tw; tx++) {
      const ti = ty * tw + tx;
      if (tElev[ti] <= 0) continue; // ocean = sink

      let bestDir = 255;
      let bestDrop = 0;

      for (let d = 0; d < 8; d++) {
        const nx = (tx + D8_DX[d] + tw) % tw;
        const ny = ty + D8_DY[d];
        if (ny < 0 || ny >= th) continue;
        const ni = ny * tw + nx;
        const drop = (filled[ti] - filled[ni]) / D8_DIST[d];
        if (drop > bestDrop) {
          bestDrop = drop;
          bestDir = d;
        }
      }

      flowDir[ti] = bestDir;
    }
  }

  // ── Step 3: Flow accumulation (topological sort) ──
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

  // Each land tile contributes runoff = moisture minus evaporation
  const flowAccum = new Float32Array(N);
  for (let ti = 0; ti < N; ti++) {
    if (tElev[ti] > 0) {
      const evapLoss = Math.max(0, tTemp[ti] - 0.3) * 0.3;
      flowAccum[ti] = Math.max(0.05, tMoist[ti] - evapLoss);
    }
  }

  const queue = [];
  for (let ti = 0; ti < N; ti++) {
    if (tElev[ti] > 0 && inDegree[ti] === 0) queue.push(ti);
  }

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
    flowAccum[ni] += flowAccum[ti];
    inDegree[ni]--;
    if (inDegree[ni] === 0) queue.push(ni);
  }

  // ── Step 4: Classify river magnitude ──
  // Use absolute thresholds based on drainage area, not relative to max.
  // At territory resolution (~40km/tile), thresholds in "tile-equivalents of runoff":
  //   Stream:     ~50 tiles upstream   (small catchment, ~80k km²)
  //   Tributary: ~200 tiles upstream   (~320k km², Lualaba/Ob scale)
  //   Major:     ~500 tiles            (~800k km², Danube/Ganges)
  //   Great:    ~1500 tiles            (~2.4M km², Congo/Nile/Amazon)
  // Moisture-weighted so actual thresholds are lower (avg moisture ~0.3)
  let maxAccum = 0;
  for (let ti = 0; ti < N; ti++) {
    if (tElev[ti] > 0 && flowAccum[ti] > maxAccum) maxAccum = flowAccum[ti];
  }

  const riverMag = new Uint8Array(N);

  if (maxAccum > 0) {
    // Use percentile-based thresholds — adapts to any map/moisture
    // Collect all land accumulation values and sort
    const accums = [];
    for (let ti = 0; ti < N; ti++) {
      if (tElev[ti] > 0 && flowAccum[ti] > 0.1) accums.push(flowAccum[ti]);
    }
    accums.sort((a, b) => a - b);
    const pct = (p) => accums[Math.min(accums.length - 1, Math.floor(accums.length * p / 100))];

    // Top 5% = stream, 1% = tributary, 0.2% = major, 0.02% = great
    const tStream = pct(95);
    const tTributary = pct(99);
    const tMajor = pct(99.8);
    const tGreat = pct(99.98);

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

export function riverName(riverMag, ti) {
  return RIVER_NAMES[riverMag[ti]] || '';
}

export function isNavigable(riverMag, ti) {
  return riverMag[ti] >= RIVER_MAJOR;
}

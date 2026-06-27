// ── River Hydrology: Conceptual River Network ──
// D8 flow direction + priority-flood pit filling + flow accumulation.
// Produces continent-scale rivers (Congo, Nile, Amazon scale).

const D8_DX = [1, 1, 0, -1, -1, -1, 0, 1];
const D8_DY = [0, 1, 1, 1, 0, -1, -1, -1];
const D8_DIST = [1, 1.414, 1, 1.414, 1, 1.414, 1, 1.414];

// Deterministic per-(tile,direction) hash — used to jitter flow choice so
// rivers wander on smooth terrain instead of running dead straight.
const rhash = (x, y, d) => {
  let h = (x * 374761393 + y * 668265263 + d * 2654435761) >>> 0;
  h = ((h ^ (h >>> 13)) * 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

export const RIVER_NONE = 0;
export const RIVER_STREAM = 1;
export const RIVER_TRIBUTARY = 2;
export const RIVER_MAJOR = 3;      // Danube, Ganges scale
export const RIVER_GREAT = 4;      // Amazon, Nile, Congo scale

export const RIVER_NAMES = ['', 'Stream', 'Tributary', 'Major River', 'Great River'];

// Endorheic evaporation coefficient (Step 3b): per filled-basin tile, the share of a
// reference river's flow that the open-water brim would evaporate, scaled by basin heat
// and dryness. Higher ⇒ more interiors stay terminal (no sea outlet). Calibrated so the
// arid closed interiors (Central Asia, the Caspian/Aral/Tarim, the Great Basin) seal
// while cold/wet basins still overflow to the sea.
const ENDO_EVAP = 2.0;

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

  // Process: flood inward from ocean/edges — track raised tiles (= lake beds)
  const isRaised = new Uint8Array(N); // 1 if tile was raised during pit fill
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
        filled[ni] = filled[ti] + 0.00001;
        isRaised[ni] = 1; // this tile is in a natural depression
      }
      heapPush(ni);
    }
  }

  // ── Step 1b: Detect candidate lake depressions ──
  // Cluster contiguous raised tiles. Final validation happens after flow accumulation
  // to ensure lakes are actually fed by rivers.
  const lake = new Int16Array(N);
  lake.fill(-1);
  const lakeInfo = [];
  const minLakeSize = 15; // ~315km² at RES=1
  const minLakeDepth = 0.005; // ~40m — lower threshold OK because river-inflow check filters noise
  const candidateLakes = []; // {tiles[], maxDepth}
  {
    const visited = new Uint8Array(N);
    for (let ti = 0; ti < N; ti++) {
      if (!isRaised[ti] || visited[ti] || tElev[ti] <= 0) continue;
      if (tTemp[ti] < 0.12) continue;
      const q = [ti];
      visited[ti] = 1;
      const tiles = [];
      let maxDepth = 0;
      let head = 0;
      while (head < q.length) {
        const ci = q[head++];
        tiles.push(ci);
        const depth = filled[ci] - tElev[ci];
        if (depth > maxDepth) maxDepth = depth;
        const cx = ci % tw, cy = (ci - cx) / tw;
        for (let d = 0; d < 8; d++) {
          const nx2 = (cx + D8_DX[d] + tw) % tw;
          const ny2 = cy + D8_DY[d];
          if (ny2 < 0 || ny2 >= th) continue;
          const ni = ny2 * tw + nx2;
          if (visited[ni] || !isRaised[ni] || tElev[ni] <= 0) continue;
          if (tTemp[ni] < 0.12) continue;
          visited[ni] = 1;
          q.push(ni);
        }
      }
      if (tiles.length >= minLakeSize && maxDepth >= minLakeDepth) {
        candidateLakes.push({ tiles, maxDepth });
      }
    }
  }

  // ── Step 2: D8 flow direction on filled surface ──
  const flowDir = new Uint8Array(N);
  flowDir.fill(255);

  for (let ty = 0; ty < th; ty++) {
    for (let tx = 0; tx < tw; tx++) {
      const ti = ty * tw + tx;
      if (tElev[ti] <= 0) continue; // ocean = sink
      if (tTemp[ti] < 0.12) continue; // permanent ice / ice sheet — no surface rivers

      let bestDir = 255;
      let bestScore = 0;

      for (let d = 0; d < 8; d++) {
        const nx = (tx + D8_DX[d] + tw) % tw;
        const ny = ty + D8_DY[d];
        if (ny < 0 || ny >= th) continue;
        const ni = ny * tw + nx;
        const drop = (filled[ti] - filled[ni]) / D8_DIST[d];
        if (drop <= 0) continue;
        // Jitter the slope per tile+direction: on near-flat terrain the choice
        // wanders (no dead-straight runs); on clear gradients the steep one wins.
        const score = drop * (0.78 + rhash(tx, ty, d) * 0.44);
        if (score > bestScore) {
          bestScore = score;
          bestDir = d;
        }
      }

      flowDir[ti] = bestDir;
    }
  }

  // ── Step 3: Flow accumulation (topological sort) ──
  // Each land tile contributes runoff = moisture minus evaporation, PLUS mountain melt.
  const runoff = new Float32Array(N);
  for (let ti = 0; ti < N; ti++) {
    if (tElev[ti] > 0 && tTemp[ti] >= 0.12) {
      const evapLoss = Math.max(0, tTemp[ti] - 0.3) * 0.3;
      // Mountain runoff: a high massif sheds FAR more water than its (rain-shadowed,
      // coarse) moisture reading shows — orographic capture on the windward slopes plus
      // stored snow / glacier melt released downstream. Without it the great EXOTIC
      // rivers, which rise in dry-looking mountains and cross deserts (the Indus &
      // Ganges off the Himalaya, the Tigris/Euphrates off the Anatolian–Zagros
      // highlands, the Colorado off the Rockies, the Amu Darya off the Pamir), get no
      // headwater and never form. Scales with height above the snow/orographic line.
      const snowmelt = Math.max(0, tElev[ti] - 0.15) * 1.6;
      runoff[ti] = Math.max(0.05, tMoist[ti] - evapLoss) + snowmelt;
    }
  }

  // Accumulate runoff downstream along flowDir (Kahn topological sort). Re-runnable:
  // the endorheic pass below edits flowDir and calls this again, so it always restarts
  // from the per-tile runoff rather than a half-accumulated buffer.
  const flowAccum = new Float32Array(N);
  function accumulate() {
    flowAccum.set(runoff);
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
    const queue = [];
    for (let ti = 0; ti < N; ti++) if (tElev[ti] > 0 && inDegree[ti] === 0) queue.push(ti);
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
  }
  accumulate();

  // ── Step 3b: Endorheic basins — terminate flow in closed arid sinks ──
  // The priority-flood (Step 1) fills EVERY depression so all land drains to the ocean.
  // That is wrong for INTERNALLY-DRAINING basins: real Central Asia, the Caspian/Aral/
  // Tarim, the Great Basin and Lake Eyre collect their rivers into terminal lakes/playas
  // that EVAPORATE — there is no outlet to the sea. Forcing them to spill routed the
  // highland snowmelt as a through-river across the desert (the Caspian↔Himalaya
  // corridor) and strung spurious lakes along it. A closed basin keeps its sea outlet
  // ONLY if the water reaching its spill exceeds what the full basin would lose to
  // evaporation when filled to the brim; otherwise it is endorheic — every exit is cut
  // so flow pools inside (a terminal lake forms) and never reaches the ocean. Cold/wet
  // basins still overflow (the Great Lakes → the St-Lawrence); hot and/or arid basins
  // stay terminal. Keyed on temperature + dryness (state), never latitude/era.
  {
    const basinId = new Int32Array(N).fill(-1);
    const basins = [];
    for (let ti = 0; ti < N; ti++) {
      if (!isRaised[ti] || basinId[ti] >= 0 || tElev[ti] <= 0) continue;
      const id = basins.length;
      const q = [ti]; basinId[ti] = id; let h = 0;
      const tiles = []; let tempSum = 0, moistSum = 0;
      while (h < q.length) {
        const ci = q[h++]; tiles.push(ci); tempSum += tTemp[ci]; moistSum += tMoist[ci];
        const cx = ci % tw, cy = (ci - cx) / tw;
        for (let d = 0; d < 8; d++) {
          const nx = (cx + D8_DX[d] + tw) % tw, ny = cy + D8_DY[d];
          if (ny < 0 || ny >= th) continue;
          const ni = ny * tw + nx;
          if (isRaised[ni] && basinId[ni] < 0 && tElev[ni] > 0) { basinId[ni] = id; q.push(ni); }
        }
      }
      basins.push({ tiles, footprint: tiles.length, temp: tempSum / tiles.length, moist: moistSum / tiles.length });
    }
    // Edges that leave a basin (a basin tile flowing to a tile of a different / no basin).
    const exitsOf = (b) => {
      const exits = [];
      let spillFlow = 0;
      for (const ti of b.tiles) {
        const d = flowDir[ti];
        if (d === 255) continue;
        const tx = ti % tw, ty = (ti - tx) / tw;
        const nx = (tx + D8_DX[d] + tw) % tw, ny = ty + D8_DY[d];
        if (ny < 0 || ny >= th) continue;
        if (basinId[ny * tw + nx] === basinId[ti]) continue;
        exits.push(ti);
        if (flowAccum[ti] > spillFlow) spillFlow = flowAccum[ti];
      }
      return { exits, spillFlow };
    };
    let cut = 0;
    for (const b of basins) {
      const { exits, spillFlow } = exitsOf(b);
      if (!exits.length) continue;
      // Evaporative demand of the basin at the brim: the whole footprint is open water,
      // and hot, dry air pulls far more from it than cold or humid air. A basin overflows
      // only if the water reaching the spill beats this; otherwise it is a terminal sink.
      // Dryness is the dominant lever — it is what separates an arid closed sink (the
      // Tarim, the Aral, Lake Chad, Lake Eyre — all terminal) from a humid one that
      // overflows (the Pannonian basin → the Danube).
      const heat = 0.30 + Math.max(0, b.temp - 0.30) * 1.2;     // cold→0.30, hot→~0.9
      const dry  = 0.20 + Math.max(0, 0.42 - b.moist) * 3.0;    // humid→0.20, desert→~1.1
      const evapDemand = b.footprint * ENDO_EVAP * heat * dry;
      if (spillFlow < evapDemand) {
        for (const ti of exits) flowDir[ti] = 255; // terminate — flow pools inside
        cut++;
      }
    }
    if (cut > 0) accumulate(); // re-route with the endorheic basins sealed
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

  // Collect all land accumulation values for percentile thresholds
  const accums = [];
  for (let ti = 0; ti < N; ti++) {
    if (tElev[ti] > 0 && flowAccum[ti] > 0.1) accums.push(flowAccum[ti]);
  }
  accums.sort((a, b) => a - b);
  const pct = (p) => accums[Math.min(accums.length - 1, Math.floor(accums.length * p / 100))];

  if (maxAccum > 0 && accums.length > 0) {
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

    // ── Downstream consistency: a river can never shrink along its flow path ──
    // Follow each flow path from high-magnitude tiles downstream and ensure
    // magnitude never drops. Fixes D8 zigzag artifacts where the flow path
    // alternates tiles and some mid-stream tiles appear to lose magnitude.
    for (let ti = 0; ti < N; ti++) {
      if (riverMag[ti] < RIVER_TRIBUTARY) continue; // start from significant rivers
      let ci = ti;
      const mag = riverMag[ci];
      for (let steps = 0; steps < 500; steps++) {
        const d = flowDir[ci];
        if (d === 255) break;
        const cx = ci % tw, cy = (ci - cx) / tw;
        const nx = (cx + D8_DX[d] + tw) % tw;
        const ny = cy + D8_DY[d];
        if (ny < 0 || ny >= th) break;
        const ni = ny * tw + nx;
        if (tElev[ni] <= 0) break; // reached ocean
        if (riverMag[ni] >= mag) break; // downstream already same or bigger
        riverMag[ni] = mag; // propagate magnitude downstream
        ci = ni;
      }
    }
  }

  // ── Step 5: Validate candidate lakes against river inflow ──
  // A depression only becomes a lake if rivers actually feed it.
  // Check flow accumulation at tiles bordering each candidate — if significant
  // flow enters the depression, it's a real lake.
  for (const candidate of candidateLakes) {
    // Build a set of candidate tiles for fast lookup
    const tileSet = new Set(candidate.tiles);
    // Find max flow accumulation at the border of this depression
    // (tiles adjacent to the depression that flow INTO it)
    let maxInflow = 0;
    for (const ti of candidate.tiles) {
      const tx = ti % tw, ty2 = (ti - tx) / tw;
      for (let d = 0; d < 8; d++) {
        const nx = (tx + D8_DX[d] + tw) % tw;
        const ny = ty2 + D8_DY[d];
        if (ny < 0 || ny >= th) continue;
        const ni = ny * tw + nx;
        if (tileSet.has(ni)) continue; // skip tiles within the depression
        if (tElev[ni] <= 0) continue;
        // Check if this neighbor flows into the depression
        const nd = flowDir[ni];
        if (nd === 255) continue;
        const fdx = D8_DX[nd], fdy = D8_DY[nd];
        const fnx = (ni % tw + fdx + tw) % tw;
        const fny = ((ni - ni % tw) / tw) + fdy;
        if (fny >= 0 && fny < th && tileSet.has(fny * tw + fnx)) {
          maxInflow = Math.max(maxInflow, flowAccum[ni]);
        }
      }
    }
    // Lake needs meaningful river inflow — at least stream-level accumulation
    // Use the stream threshold from percentile classification
    // Require at least some river flow entering the basin (90th percentile = modest stream)
    const minInflow = accums.length > 0 ? accums[Math.min(accums.length - 1, Math.floor(accums.length * 0.93))] : 1;
    // ── Evaporation gate ──
    // A lake in a HOT basin loses far more water to evaporation than a cold one, so it
    // needs proportionally more river inflow to stay open water rather than drying to a
    // salt pan / playa. This is why the Sahara, the Australian interior and the Iranian
    // plateau have dry depressions (Qattara, Lake Eyre, the Dasht-e Kavir) instead of
    // lakes, even though rivers do trickle in. Cold high-latitude basins (the Siberian /
    // Canadian lake country) need only the base inflow; a hot desert basin needs ~7×,
    // which only a genuine through-flowing great river (not local desert runoff) supplies.
    let basinTemp = 0;
    for (const bt of candidate.tiles) if (tTemp[bt] > basinTemp) basinTemp = tTemp[bt];
    const evapMul = 1 + Math.max(0, basinTemp - 0.5) * 18;
    if (maxInflow >= minInflow * evapMul) {
      // Only keep the deep core of the depression, not shallow margins
      // Tiles must be raised by at least 40% of the max depth
      const depthCutoff = candidate.maxDepth * 0.3;
      let coreTiles = candidate.tiles.filter(t => (filled[t] - tElev[t]) >= depthCutoff);
      // Cap lake size — largest real lake (Caspian) is ~370k km² ≈ ~840 tiles at 21km
      const maxLakeTiles = 800;
      if (coreTiles.length > maxLakeTiles) {
        // Keep only the deepest tiles
        coreTiles.sort((a, b) => (filled[b] - tElev[b]) - (filled[a] - tElev[a]));
        coreTiles = coreTiles.slice(0, maxLakeTiles);
      }
      if (coreTiles.length >= 5) {
        const id = lakeInfo.length;
        for (const t of coreTiles) lake[t] = id;
        lakeInfo.push({ id, size: coreTiles.length, depth: candidate.maxDepth });
      }
    }
  }

  return { flowDir, flowAccum, riverMag, maxAccum, lake, lakeInfo };
}

export function riverName(riverMag, ti) {
  return RIVER_NAMES[riverMag[ti]] || '';
}

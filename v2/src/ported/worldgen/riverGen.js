/* V2 M1 PORT
 * source: src/sim/riverGen.js; deviations: lake cap converted from tile count to MAX_LAKE_AREA_KM2; optional bakedDir gives Earth presets real river geometry (QUESTIONS.md #21) and shields data-sourced exits from the endorheic cut; W1 adds a data lake mask and a monthly-flow reader over fixed geometry; hydrology otherwise remains verbatim.
 * source commit: 97f51dd7c3a3142bfbb366f2e08491f582367e30
 */
import {
  EARTH_SURFACE_KM2,
  MAX_LAKE_AREA_KM2,
  MONTHS_PER_YEAR,
  RIVER_BASEFLOW_FRACTION,
  RIVER_FREEZING_TEMPERATURE,
} from "../../sim/constants.ts";
import { dpow } from "../../sim/dmath.ts";
// ── River Hydrology: Conceptual River Network ──
// D8 flow direction + priority-flood pit filling + flow accumulation.
// Produces continent-scale rivers (Congo, Nile, Amazon scale).

// Exported: the flow-tree consumers (the Tier-C market-site ledger walks
// flowDir to find confluences/mouths/sinks) must share THIS direction
// convention — re-declaring it would silently desynchronise on any edit.
export const D8_DX = [1, 1, 0, -1, -1, -1, 0, 1];
export const D8_DY = [0, 1, 1, 1, 0, -1, -1, -1];
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

// Transmission loss (Step 3): the share of through-flow a river loses PER TILE to
// evaporation and bed seepage as it crosses ARID, warm land — so a channel fed by
// far-off snowmelt dwindles instead of staying a great river across a whole desert.
// Gated TWO ways: (1) only on flow bound for a TERMINAL sink — a closed basin or an
// INLAND sea (the Caspian) — so every river that reaches the world ocean is untouched,
// the arid cradle rivers included (the Nile, Tigris-Euphrates and Indus cross desert but
// drain to the sea); and (2) scaled by local dryness+warmth, so humid stretches barely
// register. This is the targeted form of a per-tile loss that was once applied globally
// and reverted for thinning EVERY river; confining it to terminal drainage is what makes
// it safe. Compounds along the path, so the long desert run of the spurious Caspian /
// Aral / Tarim channels attenuates strongly.
const TRANS_LOSS = 0.30;

// River classification (Step 4) is by ABSOLUTE drainage AREA (km²), not percentile rank.
// A percentile cut ("top 5% of land tiles") was wrong two ways: (1) it was RESOLUTION-
// DEPENDENT — the same catchment sat at a different percentile at 320 vs 960 tiles wide, so
// the river network re-shuffled with grid size; and (2) it UNDID the transmission loss — a
// spurious channel dwindling across the desert toward a closed sink (the Himalaya→Caspian
// corridor) still ranked "top 5%" against the near-empty arid interior and was redrawn. An
// absolute catchment bar is resolution-invariant (a river of a given km² draws the same at
// any grid) and honours the loss (a corridor whose flow the desert has eaten falls below the
// bar and vanishes). Tuned so the global river DENSITY matches the old percentile output at
// the shipped width — only the spurious terminal corridors drop out. Each tile's drainage is
// runoff-weighted (a wet catchment makes a bigger river than a dry one of equal area), so the
// bar is expressed in km² and converted to flow-accumulation units via the mean land runoff.
const CATCH_STREAM = 10e3;    // km² of drainage to read as a Stream — small, so the network BRANCHES densely (tributaries, headwaters) like the percentile model did, just resolution-invariantly
export const CATCH_TRIB = 60e3;   // Tributary. Exported: the Tier-C market-site ledger
                                  // (crystallize.js) reuses THIS bar as its river-node
                                  // threshold — a market node is a tributary-scale
                                  // junction/mouth/terminus; one constant, one meaning.
const CATCH_MAJOR  = 800e3;   // Major (Danube/Ganges scale) — unchanged: the corridor suppression lives here + TERMINAL_STRICT
const CATCH_GREAT  = 2.4e6;   // Great (Nile/Congo/Amazon scale)
const TERMINAL_STRICT = 2.5;  // closed-basin rivers need this × the catchment to show — only a genuinely large endorheic river (the Volga→Caspian) qualifies, not a transmission-lossed desert corridor
const EARTH_KM2    = EARTH_SURFACE_KM2;   // global surface area — sets km² per tile from the grid size (resolution-invariance)

// Mountain snowmelt volume (Step 3): converts the snow/glacier fraction × relief into
// headwater runoff. Calibrated so the Himalaya/Pamir keep their old ~0.5 melt while the
// cold mid-latitude massifs that the old elevation-only term missed (the Anatolian–Zagros
// highlands behind Mesopotamia, the Rockies, the Alps) finally shed water downstream.
const SNOWMELT_K = 3.0;
// Continental winter cooling: the WINTER mean runs this far (×0.38 = ~38°C at the pole, in
// the t-scale where 0.01 = 1°C) below the ANNUAL mean, scaled by latitude — the seasonal
// half-amplitude that makes a cold-winter mountain bank a snowpack the annual mean hides.
const SNOWMELT_WINTER = 0.38;
const SEASONAL_SNOW_RELEASE_BAND = 0.08;

// `bakedDir` (optional, Uint8Array N; QUESTIONS.md #21): real river GEOMETRY
// for Earth presets — 0-7 = D8 direction, 8 = terminal inland sink, 255 = no
// data (derive from elevation as before). Water amounts stay emergent: runoff,
// accumulation, transmission loss and magnitude all run through the given
// geometry unchanged.
export function computeRivers(tw, th, tElev, tMoist, tTemp, bakedDir = null, bakedLakeMask = null) {
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

  // ── Step 1c: Inland seas — ocean connectivity from the map border ──
  // Some below-sea-level water is NOT joined to the world ocean: the Caspian, and the
  // Black Sea behind a Bosphorus too narrow to resolve. A river reaching such an INLAND
  // sea is endorheic — it should dwindle crossing the desert to get there, exactly like
  // one ending in a terminal lake — whereas a river reaching the TRUE ocean (the Nile to
  // the Mediterranean, the Tigris to the Persian Gulf) keeps its water. Flood-fill the
  // ocean from the edges; any sub-sea tile not reached is an inland sea.
  const trueOcean = new Uint8Array(N);
  {
    // ── Phase 1: the OPEN ocean — sub-sea water connected to the map edge by water alone.
    //    (Includes any sea joined by a strait wide enough to resolve as water: the Bosphorus.)
    const flood = (seed) => {
      const q = seed.slice(); let h = 0;
      while (h < q.length) {
        const ti = q[h++], tx = ti % tw, ty = (ti - tx) / tw;
        for (let d = 0; d < 8; d++) {
          const ny = ty + D8_DY[d]; if (ny < 0 || ny >= th) continue;
          const ni = ny * tw + ((tx + D8_DX[d] + tw) % tw);
          if (tElev[ni] <= 0 && !trueOcean[ni]) { trueOcean[ni] = 1; q.push(ni); }
        }
      }
    };
    const edge = [];
    for (let x = 0; x < tw; x++) for (const y of [0, th - 1]) {
      const i = y * tw + x; if (tElev[i] <= 0 && !trueOcean[i]) { trueOcean[i] = 1; edge.push(i); }
    }
    const oceanCore = [...edge]; flood(oceanCore);
    for (let i = 0; i < N; i++) if (trueOcean[i]) oceanCore.push(i);   // every open-ocean tile may originate a bridge
    // ── Phase 2: bridge 1-tile straits OUT of the open ocean, exactly ONCE. A sub-sea basin
    //    cut off by a SINGLE land tile (the Strait of Hormuz, pinched shut by the grid) is part
    //    of the ocean — flood it. But a bridged basin does NOT itself originate further bridges,
    //    so a genuinely CLOSED sea reachable only by a CHAIN of 1-tile gaps across a dry low
    //    corridor (the Caspian via the Kuma-Manych depression) stays terminal. This is what
    //    stops the bridge from quietly opening the Caspian to the sea at fine resolutions —
    //    which removed the closed-basin suppression and let the Himalaya→Caspian corridor return.
    const bridged = [];
    for (const ti of oceanCore) {
      const tx = ti % tw, ty = (ti - tx) / tw;
      for (let d = 0; d < 8; d++) {
        const my = ty + D8_DY[d]; if (my < 0 || my >= th) continue;
        const mi = my * tw + ((tx + D8_DX[d] + tw) % tw); if (tElev[mi] <= 0) continue;   // step ON a land tile
        const fy = ty + 2 * D8_DY[d]; if (fy < 0 || fy >= th) continue;
        const fi = fy * tw + ((tx + 2 * D8_DX[d] + tw) % tw);
        if (tElev[fi] <= 0 && !trueOcean[fi]) { trueOcean[fi] = 1; bridged.push(fi); }
      }
    }
    flood(bridged);   // fill each bridged basin (contiguous water), but these never bridge again
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
  if (!bakedLakeMask) {
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
  }

  // ── Step 2: D8 flow direction on filled surface ──
  const flowDir = new Uint8Array(N);
  flowDir.fill(255);
  // Cells whose direction came from DATA (baked real geometry): the endorheic
  // evaporation pass below must not sever them — whether such a basin drains
  // is already encoded in the data (a phantom depression of the cell-averaged
  // DEM, like the Congo cuvette, must not pool a real through-river).
  const dirFromData = bakedDir ? new Uint8Array(N) : null;

  for (let ty = 0; ty < th; ty++) {
    for (let tx = 0; tx < tw; tx++) {
      const ti = ty * tw + tx;
      if (tElev[ti] <= 0) continue; // ocean = sink
      if (tTemp[ti] < 0.12) continue; // permanent ice / ice sheet — no surface rivers

      if (bakedDir) {
        const bd = bakedDir[ti];
        if (bd <= 7) { flowDir[ti] = bd; dirFromData[ti] = 1; continue; }
        if (bd === 8) {
          // Terminal sink — but a "sink" on the COASTLINE is the sea: if any
          // neighbour is ocean in the shipped mask, fall through to the
          // elevation-derived choice, which discharges into it.
          let coastal = false;
          for (let d = 0; d < 8 && !coastal; d++) {
            const nx = (tx + D8_DX[d] + tw) % tw;
            const ny = ty + D8_DY[d];
            if (ny >= 0 && ny < th && tElev[ny * tw + nx] <= 0) coastal = true;
          }
          if (!coastal) { dirFromData[ti] = 1; continue; } // true inland sink: dir stays 255, flow pools
        }
        // 255 (no data): fall through to the elevation-derived choice below.
      }

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

  // Mixed-source edges can close loops the pure steepest-descent field never
  // could (a DATA direction into a fallback cell whose steepest drop points
  // back). Downstream code assumes an acyclic field, so sweep once and break
  // every cycle at its lowest cell — the pit, where the water would pool.
  if (bakedDir) {
    let sweepBreaks = 0;
    const state = new Uint8Array(N); // 0 unvisited, 1 on current walk, 2 done
    const nextOf = (ti) => {
      const d = flowDir[ti];
      if (d === 255) return -1;
      const tx = ti % tw, ty = (ti - tx) / tw;
      const ny = ty + D8_DY[d];
      if (ny < 0 || ny >= th) return -1;
      return ny * tw + ((tx + D8_DX[d] + tw) % tw);
    };
    for (let s = 0; s < N; s++) {
      if (state[s] !== 0 || flowDir[s] === 255) continue;
      const path = [];
      let ti = s;
      while (ti >= 0 && flowDir[ti] !== 255 && state[ti] === 0) {
        state[ti] = 1;
        path.push(ti);
        ti = nextOf(ti);
      }
      if (ti >= 0 && state[ti] === 1) {
        let pit = ti, cur = nextOf(ti);
        while (cur !== ti && cur >= 0) {
          if (filled[cur] < filled[pit]) pit = cur;
          cur = nextOf(cur);
        }
        flowDir[pit] = 255;
        if (typeof process !== "undefined" && process.env && process.env.SIM_RIVER_DIAG) sweepBreaks++;
      }
      for (const cell of path) state[cell] = 2;
    }
    if (typeof process !== "undefined" && process.env && process.env.SIM_RIVER_DIAG) {
      console.log(`[riverDiag] mixed-edge cycle sweep broke ${sweepBreaks} cells`);
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
      // headwater and never form.
      //
      // Gated on COLD × RELIEF, not raw elevation. The old elevation-only term keyed melt
      // to height alone, so it fed the towering tropical Himalaya but starved the cold but
      // only moderately high mid-latitude massifs — exactly the Anatolian–Zagros highlands
      // that birth the Tigris-Euphrates, which then arrived in Mesopotamia as a trickle. A
      // mountain banks a meltwater snowpack because its WINTER is below freezing, which the
      // annual-mean temperature hides at mid-latitudes (a continental winter runs tens of
      // °C colder than the mean). We reconstruct that winter mean from latitude, and also
      // keep a latitude-independent glacier term so very high tropical peaks (the Andes)
      // still shed permanent ice. Either path × the relief above the foothill line × a
      // moisture weight (a bone-dry massif yields less) gives the headwater volume.
      const ty = (ti / tw) | 0;
      const aLat = Math.abs((0.5 - ty / th) * 180);
      const winterTemp = tTemp[ti] - (aLat / 90) * SNOWMELT_WINTER;
      const snowpack = Math.max(0, Math.min(1, (0.60 - winterTemp) / 0.15));   // cold-winter snow
      const glacier = Math.max(0, Math.min(1, (tElev[ti] - 0.32) / 0.20));     // permanent high-alt ice
      const snowFrac = Math.max(snowpack, glacier);
      const relief = Math.max(0, tElev[ti] - 0.04);
      const snowmelt = snowFrac * relief * SNOWMELT_K * (0.35 + 0.65 * tMoist[ti]);
      runoff[ti] = Math.max(0.05, tMoist[ti] - evapLoss) + snowmelt;
    }
  }

  // Per-tile through-flow SURVIVAL (1 − transmission loss). Filled in AFTER the endorheic
  // pass below: a river loses water to evaporation/seepage crossing arid land, but ONLY on
  // flow bound for a terminal (endorheic) sink. Rivers that reach the SEA — every exotic
  // cradle river included (the Nile, the Tigris-Euphrates, the Indus all cross desert yet
  // drain to the ocean) — keep all their water, so this never thins the rivers the
  // civilisation sim depends on. Starts at 1 (lossless) for the detection pass.
  const transmit = new Float32Array(N).fill(1);

  // Accumulate runoff downstream along flowDir (Kahn topological sort), applying the
  // transmission loss as water leaves each tile. Re-runnable: the endorheic pass below
  // edits flowDir and the transmit field, then calls this again for the final field.
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
      flowAccum[ni] += flowAccum[ti] * transmit[ti];   // lose a share crossing arid land
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
  const drainsTerminal = new Int8Array(N).fill(-1); // -1 unknown, 0 ocean-bound, 1 terminal (set in 3b, read in Step 4)
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
        // terminate — flow pools inside (but a DATA-sourced exit stays: real
        // geometry already says whether this basin drains)
        for (const ti of exits) if (!dirFromData || !dirFromData[ti]) flowDir[ti] = 255;
      }
    }
    // Mark every tile whose flow ENDS in a terminal land sink (rather than the ocean),
    // by tracing downstream once per tile with memoisation.
    for (let s = 0; s < N; s++) {
      if (tElev[s] <= 0 || drainsTerminal[s] !== -1) continue;
      const path = []; let ti = s, verdict = 0;
      while (ti >= 0 && drainsTerminal[ti] === -1) {
        path.push(ti);
        const d = flowDir[ti];
        if (d === 255) { verdict = 1; break; }          // land tile with no outlet = terminal sink
        const tx = ti % tw, ty = (ti - tx) / tw, ny = ty + D8_DY[d];
        if (ny < 0 || ny >= th) { verdict = 0; break; }
        const ni = ny * tw + ((tx + D8_DX[d] + tw) % tw);
        if (tElev[ni] <= 0) { verdict = trueOcean[ni] ? 0 : 1; break; } // true ocean=exorheic, inland sea=terminal
        ti = ni;
      }
      if (ti >= 0 && drainsTerminal[ti] !== -1) verdict = drainsTerminal[ti];
      for (const p of path) drainsTerminal[p] = verdict;
    }
    // Apply transmission loss ONLY to terminal-draining arid/warm tiles, then re-accumulate
    // for the final field. The sealed routing + the loss together shrink the closed-basin
    // rivers (the Tarim/Central-Asian snowmelt) and starve their oversized terminal lakes,
    // while every sea-bound river — the cradles included — is untouched.
    // Terminal-bound (closed-basin) flow loses water crossing dry ground — and ONLY terminal flow
    // does, so with the Persian Gulf now correctly OCEAN (the strait-bridge), the cradle rivers
    // are exorheic and untouched. That frees the loss to be modelled in full: it bites across the
    // SEMI-ARID interior (moist<0.45, not just true desert), and it has a temperature-independent
    // SEEPAGE floor (0.7) because a river soaks into permeable ground even where it's cold — which
    // is what finally drains the spurious through-river that threads cold arid Central Asia toward
    // the Caspian over thousands of km, while a genuinely WET endorheic river (the Volga, moist≈0.5,
    // aridity 0) loses nothing and stays a great river to its inland sea.
    for (let ti = 0; ti < N; ti++) {
      if (tElev[ti] <= 0 || drainsTerminal[ti] !== 1) continue;
      const aridity = Math.max(0, Math.min(1, (0.45 - tMoist[ti]) / 0.45));        // 0 if moist≥0.45 → 1 bone-dry
      const seepEvap = 0.7 + 0.3 * Math.max(0, Math.min(1, (tTemp[ti] - 0.40) / 0.25)); // seepage floor 0.7 → +evaporation to 1.0
      if (bakedDir) {
        // R3 fix, riding with the real-geometry deviation (QUESTIONS.md #21):
        // the flat per-TILE loss is resolution-dependent — the same real
        // desert costs 3x the tiles at 22 km cells as at the ~66 km cells the
        // constant was calibrated on (tw=480), so terminal rivers crossing it
        // were erased at fine grids (the lower Volga lost 94%). Express the
        // SAME calibrated loss per km of channel instead: survival =
        // (1-TRANS_LOSS)^(cellKm/REF_KM × aridity×seepEvap). Identical at the
        // calibration grid; grid-invariant everywhere else. Procedural
        // presets keep the verbatim v1 form (the oracle asserts them exact).
        const cellKm = Math.sqrt(EARTH_KM2 / N);
        const TRANS_LOSS_REF_TILE_KM = Math.sqrt(EARTH_KM2 / (480 * 240));
        transmit[ti] = dpow(1 - TRANS_LOSS, (cellKm / TRANS_LOSS_REF_TILE_KM) * aridity * seepEvap);
      } else {
        transmit[ti] = 1 - TRANS_LOSS * aridity * seepEvap;
      }
    }
    accumulate(); // final field: endorheic basins sealed + terminal-bound desert loss
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

  // ABSOLUTE catchment thresholds (resolution-invariant). flowAccum is a runoff-weighted
  // upstream sum: a catchment of area A km² carries ≈ (A / kmPerTile) tiles × the mean land
  // runoff. So convert each km² bar to flow-accumulation units via the grid's km²/tile and the
  // mean land runoff — the SAME physical river then clears the bar at any resolution, and a
  // desert corridor the transmission loss has thinned simply falls below it.
  let landRunoff = 0, landN = 0;
  for (let ti = 0; ti < N; ti++) if (tElev[ti] > 0) { landRunoff += runoff[ti]; landN++; }
  const avgRunoff = landN > 0 ? landRunoff / landN : 0.3;
  const kmPerTile = EARTH_KM2 / (tw * th);
  const accumFor = (km2) => (km2 / kmPerTile) * avgRunoff;   // km² of drainage → runoff-weighted flowAccum

  if (maxAccum > 0 && landN > 0) {
    // OCEAN-bound rivers use the real catchment bars; TERMINAL-bound (closed-basin) flow must
    // clear TERMINAL_STRICT× as much, so only a genuinely large endorheic river (the Volga →
    // Caspian) shows while a transmission-lossed desert corridor (the Himalaya→Caspian run)
    // drops out of the visible network instead of threading the whole interior.
    const tStream = accumFor(CATCH_STREAM), tTrib = accumFor(CATCH_TRIB), tMajor = accumFor(CATCH_MAJOR), tGreat = accumFor(CATCH_GREAT);
    // SIM_RIVER_DIAG=1: print the classification diagnostics that separate a
    // BAR defect (avgRunoff drift → thresholds mis-scale) from a FLOW defect
    // (drainage fragmentation → the big basins under-accumulate at fine grids).
    // Measured 2026-07 (seed 8817, 480 vs 1920 pixels): bars exact (avgRunoff
    // 0.2302/0.2263), top river 0.79× bar-relative at rs=4, terminal land
    // 39.0→42.3%, ocean discharge per land −7% — the deficit is CONCENTRATION
    // (fixed-spectrum terrain resolves more divides at fine grids), mostly the
    // irreducible-representation class. docs/empire-consolidation-2026-07.md.
    if (typeof process !== "undefined" && process.env && process.env.SIM_RIVER_DIAG) {
      let over = 0, termLand = 0, landC = 0, oceanIn = 0;
      for (let ti = 0; ti < N; ti++) {
        if (tElev[ti] <= 0) continue;
        landC++;
        if (flowAccum[ti] >= tGreat) over++;
        if (drainsTerminal[ti] === 1) termLand++;
        // flow discharged INTO water next hop = river mouths (exorheic total discharge)
        const d = flowDir[ti];
        if (d !== 255) {
          const tx = ti % tw, ty = (ti - tx) / tw, ny = ty + D8_DY[d];
          if (ny >= 0 && ny < th) { const ni = ny * tw + ((tx + D8_DX[d] + tw) % tw); if (tElev[ni] <= 0) oceanIn += flowAccum[ti] * transmit[ti]; }
        }
      }
      console.log(`[riverDiag] tw=${tw} avgRunoff=${avgRunoff.toFixed(4)} tGreat=${Math.round(tGreat)} maxAccum=${Math.round(maxAccum)} max/tGreat=${(maxAccum / tGreat).toFixed(3)} tilesOverGreat=${over} termLand%=${(100 * termLand / landC).toFixed(1)} oceanDischargePerLand=${(oceanIn / landC).toFixed(3)}`);
    }
    const tStreamS = tStream * TERMINAL_STRICT, tTribS = tTrib * TERMINAL_STRICT, tMajorS = tMajor * TERMINAL_STRICT, tGreatS = tGreat * TERMINAL_STRICT;
    for (let ti = 0; ti < N; ti++) {
      if (tElev[ti] <= 0) continue;
      const a = flowAccum[ti];
      const term = drainsTerminal[ti] === 1;
      const tG = term ? tGreatS : tGreat, tM = term ? tMajorS : tMajor;
      const tT = term ? tTribS : tTrib,   tS = term ? tStreamS : tStream;
      if (a >= tG) riverMag[ti] = RIVER_GREAT;
      else if (a >= tM) riverMag[ti] = RIVER_MAJOR;
      else if (a >= tT) riverMag[ti] = RIVER_TRIBUTARY;
      else if (a >= tS) riverMag[ti] = RIVER_STREAM;
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
  // On the Earth data path placement comes from the HydroLAKES mask, while
  // this same inflow/evaporation test decides whether the basin has water.
  const lakeCandidates = candidateLakes.slice();
  if (bakedLakeMask) {
    const visited = new Uint8Array(N);
    for (let start = 0; start < N; start++) {
      if (!bakedLakeMask[start] || visited[start] || tElev[start] <= 0) continue;
      const tiles = [];
      const queue = [start];
      visited[start] = 1;
      for (let head = 0; head < queue.length; head++) {
        const current = queue[head];
        tiles.push(current);
        const cx = current % tw;
        const cy = (current - cx) / tw;
        for (let d = 0; d < 8; d++) {
          const nx = (cx + D8_DX[d] + tw) % tw;
          const ny = cy + D8_DY[d];
          if (ny < 0 || ny >= th) continue;
          const next = ny * tw + nx;
          if (bakedLakeMask[next] && !visited[next] && tElev[next] > 0) {
            visited[next] = 1;
            queue.push(next);
          }
        }
      }
      lakeCandidates.push({ tiles, maxDepth: 0, dataGeometry: true });
    }
  }
  const minInflow = accumFor(CATCH_STREAM);
  for (const candidate of lakeCandidates) {
    // Build a set of candidate tiles for fast lookup
    const tileSet = new Set(candidate.tiles);
    // Find max flow accumulation at the border of this depression
    // (tiles adjacent to the depression that flow INTO it)
    let maxInflow = 0;
    let totalInflow = 0;
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
          totalInflow += flowAccum[ni];
        }
      }
    }
    // Lake needs meaningful river inflow — at least stream-level accumulation (the same
    // resolution-invariant absolute Stream bar the classifier uses, so it holds at any grid).
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
    const effectiveInflow = candidate.dataGeometry ? totalInflow : maxInflow;
    if (candidate.dataGeometry && typeof process !== "undefined" && process.env?.SIM_LAKE_DIAG) {
      console.log(`[lakeDiag] cells=${candidate.tiles.length} maxInflow=${maxInflow.toFixed(2)} totalInflow=${totalInflow.toFixed(2)} min=${(minInflow * evapMul).toFixed(2)} temp=${basinTemp.toFixed(3)}`);
    }
    if (effectiveInflow >= minInflow * evapMul) {
      // Data geometry is already a measured shoreline mask. Procedural
      // candidates retain the v1 deep-core selection byte-for-byte.
      const depthCutoff = candidate.maxDepth * 0.3;
      let coreTiles = candidate.dataGeometry
        ? candidate.tiles.slice()
        : candidate.tiles.filter(t => (filled[t] - tElev[t]) >= depthCutoff);
      // Cap lake size — largest real lake (Caspian) is ~370k km² ≈ ~840 tiles at 21km
      const maxLakeTiles = Math.max(1, Math.ceil(MAX_LAKE_AREA_KM2 / (kmPerTile || 1)));
      if (coreTiles.length > maxLakeTiles) {
        // Keep only the deepest tiles
        coreTiles.sort((a, b) => (filled[b] - tElev[b]) - (filled[a] - tElev[a]));
        coreTiles = coreTiles.slice(0, maxLakeTiles);
      }
      if (coreTiles.length >= (candidate.dataGeometry ? 1 : 5)) {
        const id = lakeInfo.length;
        for (const t of coreTiles) lake[t] = id;
        lakeInfo.push({
          id,
          size: coreTiles.length,
          depth: candidate.maxDepth,
          dataGeometry: !!candidate.dataGeometry,
        });
      }
    }
  }

  const lakeGeometry = bakedLakeMask
    ? Uint8Array.from(bakedLakeMask)
    : Uint8Array.from(lake, (value) => value >= 0 ? 1 : 0);
  // km2PerTile / km2PerAccum: the grid's physical scale and the flowAccum→catchment-km²
  // conversion (inverse of accumFor), so downstream consumers (the pipeline's floodplain
  // ribbon) can express river-scaled features in REAL kilometres. km2PerAccum is
  // runoff-weighted: it converts accumulation to DISCHARGE-equivalent km² — a wet
  // catchment reads bigger than a dry one of equal area, which is exactly what a
  // discharge-carved feature (a valley) should key on.
  return {
    flowDir,
    flowAccum,
    riverMag,
    maxAccum,
    lake,
    lakeInfo,
    lakeGeometry,
    drainsTerminal,
    navigableThreshold: accumFor(CATCH_TRIB),
    km2PerTile: kmPerTile,
    km2PerAccum: avgRunoff > 0 ? kmPerTile / avgRunoff : 0,
  };
}

/**
 * Accumulate the monthly water signal over the already chosen channel
 * geometry. Geometry and terminal drainage are static; only runoff changes.
 * The returned values are dimensionless ratios to annual flow, so consumers
 * can use one compact cell×12 field without retaining twelve flow volumes.
 */
export function computeSeasonalRiverFlow({
  tw,
  th,
  tElev,
  annualMoisture,
  annualTemperature,
  monthlyMoisture,
  monthlyTemperature,
  flowDir,
  annualFlow,
  drainsTerminal,
  resolutionInvariantLoss = false,
}) {
  const N = tw * th;
  const result = new Float32Array(N * MONTHS_PER_YEAR);
  const target = new Int32Array(N).fill(-1);
  const baseDegree = new Uint16Array(N);
  for (let cell = 0; cell < N; cell++) {
    const direction = flowDir[cell];
    if (direction > 7) continue;
    const x = cell % tw;
    const y = (cell - x) / tw;
    const ny = y + D8_DY[direction];
    if (ny < 0 || ny >= th) continue;
    const next = ny * tw + ((x + D8_DX[direction] + tw) % tw);
    target[cell] = next;
    baseDegree[next]++;
  }
  const queue = new Int32Array(N);
  const runoff = new Float32Array(N);
  const flow = new Float32Array(N);
  const snow = new Float32Array(N);
  const degree = new Uint16Array(N);
  const cellKm = Math.sqrt(EARTH_KM2 / N);
  const refTileKm = Math.sqrt(EARTH_KM2 / (480 * 240));

  // Two passes over the year: the first spins the snow store up so December
  // accumulation feeds the next spring's melt (a single pass starts the year
  // with empty snowpack and undercounts the melt crest by the autumn share);
  // only the second, steady-state pass writes results.
  for (let iteration = 0; iteration < 2 * MONTHS_PER_YEAR; iteration++) {
    const month = iteration % MONTHS_PER_YEAR;
    const record = iteration >= MONTHS_PER_YEAR;
    for (let cell = 0; cell < N; cell++) {
      if (tElev[cell] <= 0) {
        runoff[cell] = 0;
        continue;
      }
      const index = cell * MONTHS_PER_YEAR + month;
      const temperature = monthlyTemperature[index] ?? annualTemperature[cell] ?? 0;
      const moisture = Math.max(0, monthlyMoisture[index] ?? annualMoisture[cell] ?? 0);
      const evapLoss = Math.max(0, temperature - 0.3) * 0.3;
      const rain = Math.max(0.05, moisture - evapLoss);
      const annualRain = Math.max(
        0.05,
        (annualMoisture[cell] ?? moisture) - Math.max(0, (annualTemperature[cell] ?? temperature) - 0.3) * 0.3,
      );
      const baseflow = annualRain * RIVER_BASEFLOW_FRACTION;
      const freeze = Math.min(1, Math.max(0, (RIVER_FREEZING_TEMPERATURE - temperature) / 0.15));
      let surface = baseflow + rain * (1 - RIVER_BASEFLOW_FRACTION) * (1 - freeze);
      if (freeze > 0) {
        snow[cell] += rain * (1 - RIVER_BASEFLOW_FRACTION) * freeze;
      } else if (snow[cell] > 0) {
        const release = snow[cell] * Math.min(1, Math.max(0,
          (temperature - RIVER_FREEZING_TEMPERATURE) / SEASONAL_SNOW_RELEASE_BAND));
        snow[cell] -= release;
        surface += release;
      }
      runoff[cell] = surface;
    }
    if (!record) continue;

    flow.set(runoff);
    degree.set(baseDegree);
    let queueLength = 0;
    for (let cell = 0; cell < N; cell++) {
      if (tElev[cell] > 0 && degree[cell] === 0) queue[queueLength++] = cell;
    }
    for (let head = 0; head < queueLength; head++) {
      const cell = queue[head];
      const next = target[cell];
      if (next < 0) continue;
      const terminal = drainsTerminal[cell] === 1;
      let survival = 1;
      if (terminal) {
        const moisture = Math.max(0, Math.min(1, annualMoisture[cell] ?? 0));
        const temperature = annualTemperature[cell] ?? 0;
        const aridity = Math.max(0, Math.min(1, (0.45 - moisture) / 0.45));
        const seepEvap = 0.7 + 0.3 * Math.max(0, Math.min(1, (temperature - 0.40) / 0.25));
        survival = resolutionInvariantLoss
          ? dpow(1 - 0.30, (cellKm / refTileKm) * aridity * seepEvap)
          : 1 - 0.30 * aridity * seepEvap;
      }
      flow[next] += flow[cell] * survival;
      degree[next]--;
      if (degree[next] === 0 && tElev[next] > 0) queue[queueLength++] = next;
    }
    for (let cell = 0; cell < N; cell++) {
      const annual = annualFlow[cell] ?? 0;
      result[cell * MONTHS_PER_YEAR + month] = annual > 0 ? flow[cell] / annual : 0;
    }
  }
  return result;
}

export function riverName(riverMag, ti) {
  return RIVER_NAMES[riverMag[ti]] || '';
}

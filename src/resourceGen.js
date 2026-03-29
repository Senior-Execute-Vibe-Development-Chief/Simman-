// ── Natural Resource Generation ──
// Places resource deposits using regional noise fields for realistic clustering.
// Resources form localized deposits (not per-tile random), gated by geology/climate.

export const RESOURCES = [
  { id: 'timber',    label: 'Timber',          color: [90, 140, 60],   era: 'all',   icon: 'T' },
  { id: 'stone',     label: 'Stone',           color: [160, 155, 145], era: 'all',   icon: 'S' },
  { id: 'copper',    label: 'Copper',          color: [200, 120, 60],  era: 'early', icon: 'Cu' },
  { id: 'tin',       label: 'Tin',             color: [180, 180, 190], era: 'early', icon: 'Sn' },
  { id: 'iron',      label: 'Iron',            color: [140, 80, 80],   era: 'mid',   icon: 'Fe' },
  { id: 'salt',      label: 'Salt',            color: [230, 225, 210], era: 'all',   icon: 'Na' },
  { id: 'horses',    label: 'Horses',          color: [170, 130, 80],  era: 'mid',   icon: 'H' },
  { id: 'precious',  label: 'Precious Metals', color: [220, 195, 60],  era: 'all',   icon: 'Au' },
  { id: 'coal',      label: 'Coal',            color: [90, 70, 45],    era: 'late',  icon: 'C' },
  { id: 'oil',       label: 'Oil',             color: [60, 90, 110],   era: 'late',  icon: 'O' },
  { id: 'gems',      label: 'Gems / Luxury',   color: [160, 60, 180],  era: 'all',   icon: 'G' },
];

export const RES_BY_ID = {};
for (const r of RESOURCES) RES_BY_ID[r.id] = r;

// ── Noise primitives (independent from world noise) ──

// Simple hash-based noise for resource fields
function resHash(x, y, salt) {
  let h = (x * 374761 + y * 668265 + salt * 982451) & 0x7fffffff;
  h = ((h >> 16) ^ h) * 0x45d9f3b;
  h = ((h >> 16) ^ h) * 0x45d9f3b;
  h = (h >> 16) ^ h;
  return (h & 0x7fffffff) / 0x7fffffff;
}

// Value noise sampled at fractional coords — creates smooth regional fields
function valueNoise(fx, fy, salt) {
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const dx = fx - x0, dy = fy - y0;
  // Smoothstep
  const sx = dx * dx * (3 - 2 * dx), sy = dy * dy * (3 - 2 * dy);
  const v00 = resHash(x0, y0, salt);
  const v10 = resHash(x0 + 1, y0, salt);
  const v01 = resHash(x0, y0 + 1, salt);
  const v11 = resHash(x0 + 1, y0 + 1, salt);
  return (v00 * (1 - sx) + v10 * sx) * (1 - sy) + (v01 * (1 - sx) + v11 * sx) * sy;
}

// Multi-octave value noise (fBm) for resource provinces
function resFBM(fx, fy, salt, octaves, lacunarity, gain) {
  let v = 0, amp = 1, freq = 1, total = 0;
  for (let i = 0; i < octaves; i++) {
    v += valueNoise(fx * freq, fy * freq, salt + i * 7919) * amp;
    total += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return v / total;
}

// Deposit field: smooth noise thresholded to create isolated patches.
// Returns 0 outside deposits, 0-1 richness inside.
// freq: spatial frequency (higher = smaller, more numerous deposits)
// threshold: 0-1 (higher = rarer deposits; 0.7 means top 30% of noise becomes deposit)
function depositField(tx, ty, tw, th, salt, freq, threshold) {
  const nx = tx / tw, ny = ty / th;
  const n = resFBM(nx * freq, ny * freq, salt, 3, 2.2, 0.5);
  if (n < threshold) return 0;
  return (n - threshold) / (1 - threshold); // 0 at edge, 1 at center of deposit
}

// Biome IDs (matching WorldSim.jsx getBiomeD)
const B_TUNDRA = 4, B_TAIGA = 6, B_BOREAL = 7, B_TEMP_FOREST = 8,
  B_TEMP_RAIN = 9, B_TROP_RAIN = 10, B_SAVANNA = 11, B_GRASSLAND = 12,
  B_DESERT = 13, B_SHRUBLAND = 14, B_TROP_DRY = 15, B_ALPINE = 16,
  B_SUBTROP = 17, B_COLD_DESERT = 18;

function getBiome(e, m, t) {
  if (e <= 0) return -1;
  const demand = 0.5 + t * 0.5;
  const em = Math.min(1, m / demand);
  if (t < 0.08) return 5;
  if (t < 0.15) return em > 0.4 ? B_TAIGA : em > 0.08 ? B_TUNDRA : B_COLD_DESERT;
  if (t < 0.25) return em > 0.35 ? B_TAIGA : em > 0.08 ? B_TUNDRA : B_COLD_DESERT;
  if (t < 0.38) return em > 0.45 ? B_BOREAL : em > 0.25 ? B_TAIGA : em > 0.08 ? B_TUNDRA : B_COLD_DESERT;
  if (t < 0.55) return em > 0.55 ? B_TEMP_RAIN : em > 0.35 ? B_TEMP_FOREST : em > 0.15 ? B_GRASSLAND : B_DESERT;
  if (t < 0.72) return em > 0.5 ? B_SUBTROP : em > 0.3 ? B_TROP_DRY : em > 0.18 ? B_SAVANNA : em > 0.1 ? B_SHRUBLAND : B_DESERT;
  return em > 0.5 ? B_TROP_RAIN : em > 0.3 ? B_TROP_DRY : em > 0.18 ? B_SAVANNA : em > 0.1 ? B_GRASSLAND : B_DESERT;
}

export function generateResources(tw, th, tElev, tTemp, tMoist, tCoast, world, seed) {
  const N = tw * th;
  const RES = 2;

  // Pre-compute biome per tile
  const tileBiome = new Int8Array(N);
  for (let ti = 0; ti < N; ti++) {
    tileBiome[ti] = getBiome(tElev[ti], tMoist[ti], tTemp[ti]);
  }

  // Plate boundary proximity (tectonic/earth modes)
  const boundDist = new Uint8Array(N);
  boundDist.fill(255);
  if (world.pixPlate) {
    const W = world.width, H = world.height;
    const q = [];
    for (let ty = 0; ty < th; ty++) for (let tx = 0; tx < tw; tx++) {
      const px = Math.min(W - 1, tx * RES), py = Math.min(H - 1, ty * RES);
      const myP = world.pixPlate[py * W + px];
      const DIRS = [[-1,0],[1,0],[0,-1],[0,1]];
      for (const [dx, dy] of DIRS) {
        const nx = Math.min(W - 1, Math.max(0, px + dx * RES));
        const ny = Math.min(H - 1, Math.max(0, py + dy * RES));
        if (world.pixPlate[ny * W + nx] !== myP) {
          const ti = ty * tw + tx;
          if (tElev[ti] > 0) { boundDist[ti] = 0; q.push(ti); }
          break;
        }
      }
    }
    for (let qi = 0; qi < q.length; qi++) {
      const ci = q[qi], cd = boundDist[ci], cx = ci % tw, cy = (ci - cx) / tw;
      if (cd >= 12) continue;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = (cx + dx + tw) % tw, ny = cy + dy;
        if (ny < 0 || ny >= th) continue;
        const ni = ny * tw + nx;
        if (boundDist[ni] <= cd + 1 || tElev[ni] <= 0) continue;
        boundDist[ni] = cd + 1; q.push(ni);
      }
    }
  }

  // Coast distance BFS
  const coastDist = new Uint8Array(N);
  coastDist.fill(255);
  {
    const q = [];
    for (let i = 0; i < N; i++) {
      if (tCoast && tCoast[i] && tElev[i] > 0) { coastDist[i] = 0; q.push(i); }
    }
    for (let qi = 0; qi < q.length; qi++) {
      const ci = q[qi], cd = coastDist[ci], cx = ci % tw, cy = (ci - cx) / tw;
      if (cd >= 12) continue;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = (cx + dx + tw) % tw, ny = cy + dy;
        if (ny < 0 || ny >= th) continue;
        const ni = ny * tw + nx;
        if (coastDist[ni] <= cd + 1 || tElev[ni] <= 0) continue;
        coastDist[ni] = cd + 1; q.push(ni);
      }
    }
  }

  // Allocate
  const deposits = {};
  for (const r of RESOURCES) deposits[r.id] = new Float32Array(N);

  // Salt offset for seed variation
  const s0 = ((seed * 16807 + 31337) % 99991) | 0;

  // ── Point deposit placement for rare minerals ──
  // Scatters N mine sites across valid terrain, each radiating influence.
  // No spacing constraint — mines naturally cluster in the best terrain.
  // scoreFn(ti) returns 0-1 suitability; higher = more likely to be picked.
  function scatterMines(resourceId, count, radius, peakRichness, candidateTest, scoreFn) {
    // Collect and score candidates
    const candidates = [];
    for (let ti = 0; ti < N; ti++) {
      if (tElev[ti] <= 0) continue;
      if (candidateTest(ti)) {
        const tx2 = ti % tw, ty2 = (ti - tx2) / tw;
        // Combine terrain suitability with noise for natural variation
        const suitability = scoreFn ? scoreFn(ti) : 0.5;
        const noise = resHash(tx2, ty2, s0 + resourceId.length * 7717);
        // Weight: 60% suitability + 40% noise — good terrain clusters, noise breaks uniformity
        candidates.push({ ti, score: suitability * 0.6 + noise * 0.4 });
      }
    }
    if (candidates.length === 0) return;
    candidates.sort((a, b) => b.score - a.score);

    // Just take the top N — no spacing constraint. Natural clustering happens
    // because the best terrain (high suitability) is geographically clustered.
    const selected = [];
    for (let i = 0; i < Math.min(count, candidates.length); i++) {
      selected.push(candidates[i].ti);
    }

    // Radiate influence from each mine site
    const arr = deposits[resourceId];
    for (const site of selected) {
      const sx = site % tw, sy = (site - sx) / tw;
      const siteRichness = 0.5 + resHash(sx, sy, s0 + 8888) * 0.5; // 0.5-1.0 variation per site
      for (let dy = -radius; dy <= radius; dy++) {
        const ny = sy + dy;
        if (ny < 0 || ny >= th) continue;
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = (sx + dx + tw) % tw;
          const ni = ny * tw + nx;
          if (tElev[ni] <= 0) continue;
          let ddx = Math.abs(dx); if (ddx > tw / 2) ddx = tw - ddx;
          const dist = Math.sqrt(ddx * ddx + dy * dy);
          if (dist > radius) continue;
          // Smooth falloff: 1 at center, 0 at edge
          const falloff = 1 - (dist / radius);
          const v = falloff * falloff * siteRichness * peakRichness;
          arr[ni] = Math.min(1, Math.max(arr[ni], v));
        }
      }
    }
  }

  // ── Per-tile loop for regional resources ──
  for (let ti = 0; ti < N; ti++) {
    const e = tElev[ti], t = tTemp[ti], m = tMoist[ti];
    if (e <= 0) continue;
    const biome = tileBiome[ti];
    const tx = ti % tw, ty = (ti - tx) / tw;
    const isMountain = e > 0.25;
    const isHighland = e > 0.15;
    const isLowland = e < 0.08;
    const bd = boundDist[ti];
    const cd = coastDist[ti];
    const hasBoundary = bd < 12;

    // ── TIMBER ──
    // Forest biomes with regional variation — not every forest tile has harvestable timber
    {
      const isForest = biome === B_TAIGA || biome === B_BOREAL || biome === B_TEMP_FOREST ||
        biome === B_TEMP_RAIN || biome === B_TROP_RAIN || biome === B_TROP_DRY || biome === B_SUBTROP;
      if (isForest) {
        const field = depositField(tx, ty, tw, th, s0 + 100, 8, 0.25);
        if (field > 0) {
          let richness = field * 0.5;
          if (biome === B_TROP_RAIN || biome === B_TEMP_RAIN) richness += 0.35;
          else if (biome === B_TEMP_FOREST || biome === B_SUBTROP) richness += 0.25;
          else if (biome === B_TAIGA || biome === B_BOREAL) richness += 0.12;
          deposits.timber[ti] = Math.min(1, richness);
        }
      }
    }

    // ── STONE ──
    // Mountains, highlands, desert exposures — regional quarry-quality deposits
    {
      let score = 0;
      if (isMountain || biome === B_ALPINE) {
        const field = depositField(tx, ty, tw, th, s0 + 200, 10, 0.30);
        if (field > 0) score = 0.3 + field * 0.7;
      } else if (isHighland) {
        const field = depositField(tx, ty, tw, th, s0 + 201, 12, 0.45);
        if (field > 0) score = 0.2 + field * 0.5;
      } else if (biome === B_DESERT || biome === B_COLD_DESERT) {
        const field = depositField(tx, ty, tw, th, s0 + 202, 14, 0.55);
        if (field > 0) score = 0.15 + field * 0.35;
      }
      if (score > 0) deposits.stone[ti] = Math.min(1, score);
    }

    // ── IRON ──
    // Common mineral. Shield deposits + mountain veins + bog iron.
    {
      let score = 0;
      // Shield/craton BIF deposits: large, moderate elevation, ancient geology
      const shield = depositField(tx, ty, tw, th, s0 + 500, 5, 0.50);
      if (shield > 0 && e > 0.02 && e < 0.35) {
        score = shield * 0.8;
      }
      // Mountain/highland veins
      if (isHighland || isMountain) {
        const mtnIron = depositField(tx, ty, tw, th, s0 + 501, 9, 0.55);
        if (mtnIron > 0) score = Math.max(score, mtnIron * 0.65);
      }
      // Bog iron: wet temperate lowlands
      if (isLowland && m > 0.40 && t > 0.28) {
        const bog = depositField(tx, ty, tw, th, s0 + 502, 15, 0.70);
        if (bog > 0) score = Math.max(score, bog * 0.35);
      }
      if (score > 0) deposits.iron[ti] = Math.min(1, score);
    }

    // ── SALT ──
    // Coastal pans, desert evaporites, inland domes. Regional clustering.
    {
      let score = 0;
      // Coastal salt: warm/dry coasts
      if (cd <= 3) {
        const saltCoast = depositField(tx, ty, tw, th, s0 + 600, 10, 0.50);
        if (saltCoast > 0) {
          score = saltCoast * 0.5;
          if (t > 0.40 && m < 0.50) score += 0.2;
        }
      }
      // Desert evaporite basins
      if ((biome === B_DESERT || biome === B_COLD_DESERT || biome === B_SHRUBLAND) && e < 0.15) {
        const evap = depositField(tx, ty, tw, th, s0 + 601, 7, 0.45);
        if (evap > 0) score = Math.max(score, evap * 0.8);
      }
      // Inland rock salt domes
      {
        const dome = depositField(tx, ty, tw, th, s0 + 602, 16, 0.82);
        if (dome > 0 && e > 0) score = Math.max(score, dome * 0.5);
      }
      if (score > 0) deposits.salt[ti] = Math.min(1, score);
    }

    // ── HORSES ──
    // Grasslands and steppes. Large contiguous regions, not tiny patches.
    {
      let score = 0;
      const isSteppe = biome === B_GRASSLAND || biome === B_SHRUBLAND;
      const isSavanna = biome === B_SAVANNA;
      if (isSteppe && t > 0.20 && t < 0.65 && e < 0.25) {
        const field = depositField(tx, ty, tw, th, s0 + 700, 5, 0.25);
        if (field > 0) {
          score = 0.25 + field * 0.45;
          const tempFit = 1 - Math.abs(t - 0.45) * 2.5;
          score += Math.max(0, tempFit) * 0.25;
        }
      }
      if (isSavanna && t > 0.40 && e < 0.18) {
        const field = depositField(tx, ty, tw, th, s0 + 701, 7, 0.45);
        if (field > 0) score = Math.max(score, 0.15 + field * 0.35);
      }
      if (score > 0) deposits.horses[ti] = Math.min(1, score);
    }

    // ── COAL ──
    // Temperate sedimentary basins. Multiple overlapping noise fields for coverage.
    {
      let score = 0;
      const isCoalClimate = t > 0.25 && t < 0.65 && m > 0.22;
      if (isCoalClimate && e < 0.25) {
        const field = depositField(tx, ty, tw, th, s0 + 900, 6, 0.55);
        if (field > 0) {
          score = field * 0.65;
          if (m > 0.35) score += 0.15;
          if (e < 0.12) score += 0.10;
        }
      }
      if (isCoalClimate && e < 0.20) {
        const field2 = depositField(tx, ty, tw, th, s0 + 902, 8, 0.60);
        if (field2 > 0) score = Math.max(score, field2 * 0.55 + (m > 0.35 ? 0.1 : 0));
      }
      if (isHighland && !isMountain && t > 0.22) {
        const seam = depositField(tx, ty, tw, th, s0 + 901, 12, 0.68);
        if (seam > 0) score = Math.max(score, seam * 0.5);
      }
      if (score > 0) deposits.coal[ti] = Math.min(1, score);
    }

    // ── OIL ──
    // Sedimentary basins with multiple province noise fields.
    {
      let score = 0;
      if ((biome === B_DESERT || biome === B_SHRUBLAND || biome === B_SAVANNA) && e < 0.18) {
        const basin = depositField(tx, ty, tw, th, s0 + 1000, 5, 0.52);
        if (basin > 0) score = basin * 0.8;
      }
      if (cd <= 5 && e < 0.10) {
        const coastal = depositField(tx, ty, tw, th, s0 + 1001, 8, 0.60);
        if (coastal > 0) score = Math.max(score, coastal * 0.65);
      }
      if (e < 0.12 && m < 0.45) {
        const interior = depositField(tx, ty, tw, th, s0 + 1002, 7, 0.62);
        if (interior > 0) score = Math.max(score, interior * 0.55);
      }
      if (score > 0) deposits.oil[ti] = Math.min(1, score);
    }
  }

  // ── Point deposits: copper, tin, precious metals, gems ──
  // These are scattered as individual mine sites across valid terrain.

  // COPPER: ~80 mines, prefer mountains/highlands near plate boundaries
  scatterMines('copper', 80, 4, 0.9,
    (ti) => tElev[ti] > 0.10,
    (ti) => {
      let s = Math.min(1, (tElev[ti] - 0.10) * 4); // higher = better
      if (boundDist[ti] < 12) s += (1 - boundDist[ti] / 12) * 0.5; // near boundaries
      return Math.min(1, s);
    });

  // TIN: ~40 mines, highlands + alluvial lowlands near highlands
  scatterMines('tin', 40, 3, 0.85,
    (ti) => {
      const e = tElev[ti];
      return e > 0.08 || (e < 0.08 && e > 0 && tMoist[ti] > 0.25);
    },
    (ti) => {
      const e = tElev[ti];
      if (e > 0.12) return 0.4 + Math.min(0.6, (e - 0.12) * 3); // highland veins
      return 0.3 + tMoist[ti] * 0.4; // alluvial: wetter = better
    });

  // PRECIOUS METALS: ~70 gold/silver sites, prefer highlands + plate boundaries
  scatterMines('precious', 70, 4, 0.95,
    (ti) => tElev[ti] > 0.02,
    (ti) => {
      let s = Math.min(1, tElev[ti] * 3); // higher terrain = better
      if (boundDist[ti] < 12) s += (1 - boundDist[ti] / 12) * 0.4;
      // Alluvial gold: wet lowlands get a boost too
      if (tElev[ti] < 0.08 && tMoist[ti] > 0.3) s += 0.3;
      return Math.min(1, s);
    });

  // GEMS: ~50 sites, prefer highlands + tropical zones
  scatterMines('gems', 50, 3, 0.8,
    (ti) => tElev[ti] > 0.03,
    (ti) => {
      let s = 0.2;
      if (tElev[ti] > 0.15) s += 0.4; // highland gems
      if (tTemp[ti] > 0.45) s += 0.3; // tropical gems
      if (boundDist[ti] < 12) s += 0.2; // kimberlite near boundaries
      return Math.min(1, s);
    });

  return deposits;
}

// Get a summary of resources at a tile for display
export function tileResourceSummary(deposits, ti) {
  const result = [];
  for (const r of RESOURCES) {
    const v = deposits[r.id][ti];
    if (v > 0.05) result.push({ ...r, richness: v });
  }
  result.sort((a, b) => b.richness - a.richness);
  return result;
}

// Get the dominant (highest richness) resource at a tile, or null
export function dominantResource(deposits, ti) {
  let best = null, bestV = 0.05;
  for (const r of RESOURCES) {
    const v = deposits[r.id][ti];
    if (v > bestV) { bestV = v; best = r; }
  }
  return best;
}

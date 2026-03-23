// ── Tectonic Plate Terrain Generator ──
// Standalone module: generates elevation, moisture, temperature arrays
// using simplified plate tectonics simulation.
//
// Architecture:
//   1. Scatter plate centers, assign type (continental/oceanic) + movement vectors
//   2. Voronoi assignment: each pixel belongs to nearest plate
//   3. Classify boundaries: convergent, divergent, transform
//   4. Fill continental interiors at flat base elevation
//   5. Propagate mountain/trench features from boundaries inward via BFS
//   6. Add noise dressing for local detail
//   7. Climate (latitude + continentality) for moisture/temperature

// Noise helpers — duplicated here so the module is fully standalone / removable.
const PERM=new Uint8Array(512);
const GRAD=[[1,1],[-1,1],[1,-1],[-1,-1],[1,0],[-1,0],[0,1],[0,-1]];

function initNoise(seed){
const p=new Uint8Array(256);for(let i=0;i<256;i++)p[i]=i;
for(let i=255;i>0;i--){seed=(seed*16807)%2147483647;const j=seed%(i+1);[p[i],p[j]]=[p[j],p[i]];}
for(let i=0;i<512;i++)PERM[i]=p[i&255];}

function noise2D(x,y){
const X=Math.floor(x)&255,Y=Math.floor(y)&255,xf=x-Math.floor(x),yf=y-Math.floor(y),
u=xf*xf*(3-2*xf),v=yf*yf*(3-2*yf);
const aa=PERM[PERM[X]+Y],ab=PERM[PERM[X]+Y+1],ba=PERM[PERM[X+1]+Y],bb=PERM[PERM[X+1]+Y+1];
const d=(g,x2,y2)=>GRAD[g%8][0]*x2+GRAD[g%8][1]*y2;
const l1=d(aa,xf,yf)+u*(d(ba,xf-1,yf)-d(aa,xf,yf)),
      l2=d(ab,xf,yf-1)+u*(d(bb,xf-1,yf-1)-d(ab,xf,yf-1));
return l1+v*(l2-l1);}

function fbm(x,y,o,l,g){let v=0,a=1,f=1,m=0;for(let i=0;i<o;i++){v+=noise2D(x*f,y*f)*a;m+=a;a*=g;f*=l;}return v/m;}

function ridged(x,y,oct,lac,gain,off){
let v=0,a=1,f=1,w=1,m=0;
for(let i=0;i<oct;i++){let s=off-Math.abs(noise2D(x*f,y*f));s*=s;s*=w;
w=Math.min(1,Math.max(0,s*gain));v+=s*a;m+=a;a*=.5;f*=lac;}return v/m;}

function mkRng(s){s=((s%2147483647)+2147483647)%2147483647||1;return()=>{s=(s*16807)%2147483647;return(s-1)/2147483646;};}

// ── Main generator ──
// Returns { elevation, moisture, temperature } typed arrays, same contract as WorldSim random mode.
export function generateTectonicWorld(W, H, seed) {
initNoise(seed);
const rng = mkRng(seed);
const elevation = new Float32Array(W * H);
const moisture = new Float32Array(W * H);
const temperature = new Float32Array(W * H);
const RES = 2;

// ═══════════════════════════════════════════════════════
// STEP 1: Generate tectonic plates
// ═══════════════════════════════════════════════════════
// More plates = more varied continent shapes. Use 18-26 total plates.
// More continental plates ensures 4-7 distinct landmasses.
const numPlates = 18 + Math.floor(rng() * 9); // 18-26 plates
const plates = [];
// 35-45% continental plates — enough for multiple continents without dominating the map
const numContinental = Math.floor(numPlates * (0.35 + rng() * 0.10));
const plateOrder = Array.from({length: numPlates}, (_, i) => i);
for (let i = numPlates - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [plateOrder[i], plateOrder[j]] = [plateOrder[j], plateOrder[i]]; }
const contSet = new Set(plateOrder.slice(0, numContinental));
for (let i = 0; i < numPlates; i++) {
  const cx = rng(), cy = 0.05 + rng() * 0.9;
  const continental = contSet.has(i);
  const angle = rng() * Math.PI * 2;
  const speed = 0.3 + rng() * 0.7;
  const vx = Math.cos(angle) * speed;
  const vy = Math.sin(angle) * speed;
  // Varied base elevations: some continental plates are higher (plateaus), some lower (basins)
  const baseElev = continental ? 0.015 + rng() * 0.035 : -0.05 - rng() * 0.07;
  plates.push({ cx, cy, vx, vy, continental, baseElev, id: i });
}

// ═══════════════════════════════════════════════════════
// STEP 2: Voronoi assignment — each pixel to nearest plate
// Pixel-level for smooth coastlines, coarse grid for BFS
// ═══════════════════════════════════════════════════════
const CG = 4; // coarse grid for BFS operations
const cw = Math.ceil(W / CG), ch = Math.ceil(H / CG);
// Pixel-level plate assignment (smooth coastlines)
// Use shared warp field instead of per-plate warp (much faster)
const pixPlate = new Uint8Array(W * H);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const nx = x / W, ny = y / H;
  // Shared domain warp — distorts all plate boundaries equally
  const warpX = fbm(nx * 6 + 13.7, ny * 6 + 13.7, 3, 2, 0.5) * 0.07;
  const warpY = fbm(nx * 6 + 63.7, ny * 6 + 63.7, 3, 2, 0.5) * 0.07;
  const wnx = nx + warpX, wny = ny + warpY;
  let bestD = 1e9, bestP = 0;
  for (let p = 0; p < numPlates; p++) {
    let dx = wnx - plates[p].cx;
    if (dx > 0.5) dx -= 1; if (dx < -0.5) dx += 1;
    const dy = wny - plates[p].cy;
    const d = dx * dx + dy * dy; // skip sqrt for comparison
    if (d < bestD) { bestD = d; bestP = p; }
  }
  pixPlate[y * W + x] = bestP;
}
// Coarse plate map (for BFS — sample from pixel map)
const plateMap = new Uint8Array(cw * ch);
for (let ty = 0; ty < ch; ty++) for (let tx = 0; tx < cw; tx++) {
  plateMap[ty * cw + tx] = pixPlate[Math.min(H - 1, ty * CG) * W + Math.min(W - 1, tx * CG)];
}

// ═══════════════════════════════════════════════════════
// STEP 3: Classify plate boundaries
// For each coarse cell, check if any neighbor belongs to a different plate.
// If so, classify the boundary type based on relative plate movement.
// ═══════════════════════════════════════════════════════
// Boundary types: 0=none, 1=convergent-continental (mountains),
//   2=convergent-oceanic (trench+volcanic arc), 3=divergent (rift/ridge), 4=transform
const boundaryType = new Uint8Array(cw * ch);
const boundaryStr = new Float32Array(cw * ch); // strength of boundary feature

for (let ty = 0; ty < ch; ty++) for (let tx = 0; tx < cw; tx++) {
  const ti = ty * cw + tx;
  const myPlate = plates[plateMap[ti]];
  let maxStr = 0, bestType = 0;

  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (!dx && !dy) continue;
    const nx2 = (tx + dx + cw) % cw, ny2 = ty + dy;
    if (ny2 < 0 || ny2 >= ch) continue;
    const ni = ny2 * cw + nx2;
    if (plateMap[ni] === plateMap[ti]) continue; // same plate

    const otherPlate = plates[plateMap[ni]];
    // Compute relative movement along the boundary normal
    const bnx = (tx - nx2) / cw, bny = (ty - ny2) / ch; // boundary normal direction
    const bl = Math.sqrt(bnx * bnx + bny * bny) || 1;
    const nnx = bnx / bl, nny = bny / bl;
    // Relative velocity along normal: positive = convergent, negative = divergent
    const relV = (myPlate.vx - otherPlate.vx) * nnx + (myPlate.vy - otherPlate.vy) * nny;
    // Tangential component
    const tanV = Math.abs((myPlate.vx - otherPlate.vx) * (-nny) + (myPlate.vy - otherPlate.vy) * nnx);

    let type = 0, str = 0;
    if (relV > 0.3) {
      // Convergent
      if (myPlate.continental && otherPlate.continental) {
        type = 1; str = relV * 1.2; // continental collision (Himalayas)
      } else if (myPlate.continental || otherPlate.continental) {
        type = 2; str = relV * 0.9; // subduction (Andes)
      } else {
        type = 2; str = relV * 0.5; // oceanic-oceanic subduction (island arc)
      }
    } else if (relV < -0.3) {
      type = 3; str = Math.abs(relV) * 0.6; // divergent (rift/mid-ocean ridge)
    } else if (tanV > 0.4) {
      type = 4; str = tanV * 0.3; // transform fault
    }

    if (str > maxStr) { maxStr = str; bestType = type; }
  }
  boundaryType[ti] = bestType;
  boundaryStr[ti] = Math.min(1, maxStr);
}

// ═══════════════════════════════════════════════════════
// STEP 4: BFS from boundaries — propagate mountain/feature elevation
// Mountains decay with distance from boundary, creating foothills
// ═══════════════════════════════════════════════════════
const faultDist = new Float32Array(cw * ch).fill(255); // distance from nearest fault
const faultElev = new Float32Array(cw * ch); // elevation contribution from faults
const faultQ = [];

// Seed BFS with boundary cells
for (let i = 0; i < cw * ch; i++) {
  if (boundaryType[i] > 0) {
    faultDist[i] = 0;
    // Set base fault elevation based on type
    const bt = boundaryType[i], bs = boundaryStr[i];
    if (bt === 1) faultElev[i] = 0.25 + bs * 0.20; // continental collision: tall mountains
    else if (bt === 2) faultElev[i] = 0.12 + bs * 0.15; // subduction: coastal mountains
    else if (bt === 3) faultElev[i] = 0.03 + bs * 0.04; // divergent: moderate ridge or rift
    else faultElev[i] = 0.01 + bs * 0.03; // transform: minor elevation
    faultQ.push(i);
  }
}

// Propagate outward — elevation decays with distance
// Mountain width: ~15-25 coarse cells depending on type
for (let qi = 0; qi < faultQ.length; qi++) {
  const ci = faultQ[qi], cd = faultDist[ci];
  const cx = ci % cw, cy = (ci - cx) / cw;
  const srcElev = faultElev[ci];
  const bt = boundaryType[ci];
  // Decay rate: continental collision spreads wider than subduction
  const maxSpread = bt === 1 ? 14 : bt === 2 ? 10 : 5;

  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (!dx && !dy) continue;
    const nx2 = (cx + dx + cw) % cw, ny2 = cy + dy;
    if (ny2 < 0 || ny2 >= ch) continue;
    const ni = ny2 * cw + nx2, nd = cd + 1;
    if (nd < faultDist[ni] && nd <= maxSpread) {
      faultDist[ni] = nd;
      // Gaussian-ish decay from boundary
      const decay = Math.exp(-(nd * nd) / (maxSpread * maxSpread * 0.18));
      faultElev[ni] = Math.max(faultElev[ni], srcElev * decay);
      // Propagate boundary type for context
      if (boundaryType[ni] === 0) boundaryType[ni] = bt;
      faultQ.push(ni);
    }
  }
}

// ═══════════════════════════════════════════════════════
// STEP 5: Build pixel-level elevation
// Combine: plate base elevation + fault features + noise dressing
// ═══════════════════════════════════════════════════════
const s1 = rng() * 100, s2 = rng() * 100, s3 = rng() * 100, s4 = rng() * 100;

for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const i = y * W + x;
  const nx = x / W, ny = y / H;
  const lat = Math.abs(ny - 0.5) * 2;
  const ctx = Math.min(cw - 1, Math.floor(x / CG));
  const cty = Math.min(ch - 1, Math.floor(y / CG));
  const ci = cty * cw + ctx;
  const plate = plates[pixPlate[i]]; // pixel-level plate for smooth coastlines

  // A) Base plate elevation
  let e = plate.baseElev;

  // B) Fault feature elevation (mountains/ridges from boundaries)
  const fe = faultElev[ci];
  if (fe > 0 && plate.continental) {
    // Add ridged multifractal along fault zones for realistic mountain texture
    const fd = faultDist[ci];
    const ridgeStr = fe * (fd < 3 ? 0.7 + 0.3 * ridged(nx * 5 + s1, ny * 5 + s1, 4, 2.2, 2.0, 1.0) : 1.0);
    // Ridged detail for close-to-boundary areas
    if (fd < 8) {
      const rv = ridged(nx * 6 + s2, ny * 6 + s2, 5, 2.1, 2.0, 1.0);
      e += ridgeStr * (0.5 + rv * 0.5);
    } else {
      // Foothills further from boundary: gentler
      e += ridgeStr * 0.6;
    }
  } else if (fe > 0 && !plate.continental) {
    // Oceanic plate features: mid-ocean ridges, trenches
    const bt = boundaryType[ci];
    if (bt === 2) e -= fe * 0.5; // trench at subduction zone
    else if (bt === 3) e += fe * 0.3; // mid-ocean ridge
  }

  // C) Continental interior: varied terrain independent of plate boundaries
  if (plate.continental) {
    // Base terrain variation — broad undulations across the continent
    e += fbm(nx * 5 + s3, ny * 5 + s3, 5, 2, 0.5) * 0.06;
    // Interior highlands: ridged noise creates old mountain ranges (Appalachians, Urals)
    // These are NOT at plate boundaries — they're ancient, independent features
    const highlandVal = ridged(nx * 3.5 + s4 + 20, ny * 3.5 + s4 + 20, 4, 2.0, 1.8, 1.0);
    // Only raise highlands where a separate noise field says so (patchy, not everywhere)
    const highlandMask = fbm(nx * 2.5 + s1 + 80, ny * 2.5 + s1 + 80, 3, 2, 0.5);
    if (highlandMask > 0.15) e += highlandVal * (highlandMask - 0.15) * 0.18;
    // Plateaus: elevated flat areas (Ethiopian Highlands, Deccan Plateau)
    const platNoise = fbm(nx * 3 + s2 + 40, ny * 3 + s2 + 40, 3, 2, 0.5);
    if (platNoise > 0.35) e += (platNoise - 0.35) * 0.06;
    // Rolling hills: medium-frequency variation
    e += fbm(nx * 10 + s3 + 15, ny * 10 + s3 + 15, 3, 2, 0.5) * 0.025;
    // Basin carving: river lowlands (Amazon, Congo, Mississippi basins)
    const basinNoise = fbm(nx * 2.5 + s1 + 50, ny * 2.5 + s1 + 50, 3, 2, 0.5);
    if (basinNoise > 0.2) e -= (basinNoise - 0.2) * 0.05;
    // Fine texture
    e += fbm(nx * 20 + s4, ny * 20 + s4, 2, 2, 0.4) * 0.008;
  } else {
    // Ocean floor: abyssal plains + texture
    e += fbm(nx * 8 + s3 + 30, ny * 8 + s3 + 30, 3, 2, 0.4) * 0.015;
  }

  // D) Polar reduction
  if (lat > 0.88) e -= (lat - 0.88) * 2;

  // E) Coastal transition: smooth the land-ocean boundary
  // Check if this cell is near a plate type change
  let nearOcean = false, nearLand = false;
  for (let dy2 = -2; dy2 <= 2; dy2++) for (let dx2 = -2; dx2 <= 2; dx2++) {
    const nx3 = (ctx + dx2 + cw) % cw, ny3 = cty + dy2;
    if (ny3 < 0 || ny3 >= ch) continue;
    const np = plates[plateMap[ny3 * cw + nx3]];
    if (np.continental) nearLand = true; else nearOcean = true;
  }

  // Continental shelf: smooth transition at continent edges
  if (nearOcean && nearLand) {
    // Perturb coastline with noise
    const coastNoise = fbm(nx * 15 + s2 + 70, ny * 15 + s2 + 70, 3, 2.2, 0.45) * 0.015;
    e += coastNoise;
    // Shelf gradient
    if (plate.continental && e > 0) {
      e = Math.max(0.001, e * 0.7 + 0.003); // compress coastal land elevation
    }
  }

  elevation[i] = e;

  // Temperature: latitude + elevation
  temperature[i] = Math.max(0, Math.min(1,
    1 - lat * 1.05 - Math.max(0, e) * 0.4 + fbm(nx * 3 + 80, ny * 3 + 80, 3, 2, 0.5) * 0.08));
}

// ═══════════════════════════════════════════════════════
// STEP 6: Coast-distance BFS for continentality (moisture calc)
// ═══════════════════════════════════════════════════════
const DG = RES, dw = Math.ceil(W / DG), dh = Math.ceil(H / DG);
const cdist = new Uint8Array(dw * dh); cdist.fill(255);
const cdQ = [];

for (let ty = 0; ty < dh; ty++) for (let tx = 0; tx < dw; tx++) {
  const px = Math.min(W - 1, tx * DG), py = Math.min(H - 1, ty * DG), ti = ty * dw + tx;
  if (elevation[py * W + px] <= 0) continue;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const nx2 = (tx + dx + dw) % dw, ny2 = ty + dy;
    if (ny2 < 0 || ny2 >= dh) continue;
    const np = Math.min(W - 1, nx2 * DG), npy = Math.min(H - 1, ny2 * DG);
    if (elevation[npy * W + np] <= 0) { cdist[ti] = 0; cdQ.push(ti); break; }
  }
}
for (let qi = 0; qi < cdQ.length; qi++) {
  const ci = cdQ[qi], cd = cdist[ci], cx = ci % dw, cy2 = (ci - cx) / dw;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (!dx && !dy) continue;
    const nx2 = (cx + dx + dw) % dw, ny2 = cy2 + dy;
    if (ny2 < 0 || ny2 >= dh) continue;
    const ni = ny2 * dw + nx2, nd = cd + 1;
    if (nd < cdist[ni] && elevation[Math.min(H - 1, ny2 * DG) * W + Math.min(W - 1, nx2 * DG)] > 0) {
      cdist[ni] = nd; cdQ.push(ni);
    }
  }
}

// ═══════════════════════════════════════════════════════
// STEP 7: Moisture — same climate model as WorldSim
// ═══════════════════════════════════════════════════════
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const i = y * W + x, nx = x / W, ny = y / H, lat = Math.abs(ny - 0.5) * 2;
  if (elevation[i] <= 0) { moisture[i] = 0.5 + fbm(nx * 3 + 30, ny * 3 + 30, 2, 2, 0.5) * 0.1; continue; }
  const cd = cdist[Math.min(dh - 1, Math.floor(y / DG)) * dw + Math.min(dw - 1, Math.floor(x / DG))];
  const coastProx = Math.max(0, 1 - cd / 8);
  const tropWet = Math.max(0, 1 - lat * 2.5);
  const subtropDry = Math.exp(-((lat - 0.28) ** 2) / (2 * 0.06 * 0.06)) * 0.50 * (1 - coastProx * 0.5);
  const tempWet = Math.exp(-((lat - 0.55) ** 2) / 0.025) * 0.22;
  const tropF = Math.max(0, 1 - lat * 3);
  const contRate = 0.006 + (1 - tropF) * 0.014;
  const cont = Math.min(0.28, cd * contRate);
  const polarDry = Math.max(0, (lat - 0.75)) * 0.25;
  let m = 0.42 + tropWet * 0.42 - subtropDry + tempWet - cont - polarDry
    + fbm(nx * 4 + 50, ny * 4 + 50, 4, 2, 0.55) * 0.12;
  if (elevation[i] > 0.15) m -= Math.min(0.2, (elevation[i] - 0.15) * 1);
  if (elevation[i] < 0.02) m += 0.10;
  moisture[i] = Math.max(0.02, Math.min(1, m));
}

return { elevation, moisture, temperature };
}

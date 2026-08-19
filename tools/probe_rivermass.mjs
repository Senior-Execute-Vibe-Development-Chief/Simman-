// Diffusion campaign lap 2, instrument 3 (docs/atlas-gap-2026-08-14.md): the
// works leak's irr-term decomposition named the BANDED WATER term (0.753 mass
// per real area at tw=480 vs tw=240) while flood (1.16) and wet (1.03) hold.
// ensureAccessBand's arithmetic conserves any given channel's linear mass, so
// the deficit is upstream in WORLDGEN: either the river NETWORK's channel
// coverage per real area differs across grids (drainage density — same real
// rivers should span 2x the tiles at 2x resolution), or the same real river
// draws a lower MAGNITUDE CLASS at the finer grid. riverMag is static terrain,
// so this needs no sim steps at all — worldgen only, per-class tallies.
//   node tools/probe_rivermass.mjs [seed=8817]
import { buildSim } from "./_harness.mjs";
import { ensureAccessBand } from "../src/sim/peopleSim/popField.js";
import { RM_FULL } from "../src/sim/peopleSim/popFieldKernel.js";

const SEED = +(process.argv[2] || 8817);

// The sum-capped band form (lap-2 candidate): overlap SUMS under a saturation
// cap at the largest contributor's full magnitude — a meander's self-overlap
// restores its straight-channel mass, two distinct rivers still cannot stack
// past the bigger one. At rn=1 the band is the source tile only (no cross-tile
// contributions exist), so this is byte-identical to the max form there.
function sumBand(w) {
  const { N, tw, th, elev, riverMag: rm, coast } = w;
  const rn = w.tw / 240;
  const rmS = new Float32Array(N), rmPk = new Float32Array(N);
  const coS = new Float32Array(N);
  const H = rn / 2 + 0.5, R = Math.ceil(H);
  for (let ti = 0; ti < N; ti++) {
    const mag = rm ? rm[ti] : 0, isC = coast ? coast[ti] : 0;
    if (!(mag >= 1) && !isC) continue;
    const y0 = (ti / tw) | 0, x0 = ti - y0 * tw;
    for (let dy = -R; dy <= R; dy++) {
      const y = y0 + dy; if (y < 0 || y >= th) continue;
      for (let dx = -R; dx <= R; dx++) {
        const wgt = Math.min(1, Math.max(0, H - Math.hypot(dx, dy)));
        if (wgt <= 0) continue;
        const i2 = y * tw + (((x0 + dx) % tw) + tw) % tw;
        if (mag >= 1) { rmS[i2] += mag * wgt; if (mag > rmPk[i2]) rmPk[i2] = mag; }
        if (isC) coS[i2] += wgt;
      }
    }
  }
  for (let i = 0; i < N; i++) {
    if (rmS[i] > rmPk[i]) rmS[i] = rmPk[i];
    if (coS[i] > 1) coS[i] = 1;
  }
  let sMass = 0, sWater = 0, cMass = 0;
  for (let i = 0; i < N; i++) {
    if (!(elev[i] > 0)) continue;
    sMass += rmS[i];
    sWater += Math.min(1, rmS[i] / RM_FULL);
    cMass += coS[i];
  }
  return { sMass, sWater, cMass };
}

function measure(W) {
  const w = buildSim({ W, H: W >> 1, seed: SEED });
  ensureAccessBand(w);
  const { N, tw, elev, riverMag } = w;
  const rmB = w._rmBand;
  const sum = sumBand(w);
  let coMax = 0;
  for (let i = 0; i < N; i++) if (elev[i] > 0 && w._coastBand) coMax += w._coastBand[i];
  const rn = tw / 240, r2 = rn * rn;
  let land = 0;
  const cnt = [0, 0, 0, 0, 0], magSum = [0, 0, 0, 0, 0];
  let rawWater = 0, bandWater = 0, bandMass = 0, rawMass = 0;
  for (let i = 0; i < N; i++) {
    if (!(elev[i] > 0)) continue;
    land++;
    const m = riverMag ? riverMag[i] : 0;
    if (m >= 1) { const c = Math.min(4, m | 0); cnt[c]++; magSum[c] += m; }
    rawMass += m;
    rawWater += Math.min(1, m / RM_FULL);
    const b = rmB ? rmB[i] : 0;
    bandMass += b;
    bandWater += Math.min(1, b / RM_FULL);
  }
  // Normalization: per-land MEANS are real-area-fair for intensive fields (the
  // mass rows). Channel COUNTS are 1-D: real drainage density D = real length /
  // real area = (count/land) × rn — the same real network holds rn× the tiles
  // over rn²× the land, so count/land halves per doubling and ×rn restores it.
  return { tw, land, rn, cnt, magSum, rawMass, rawWater, bandMass, bandWater,
    sumMass: sum.sMass, sumWater: sum.sWater, coastMax: coMax, coastSum: sum.cMass };
}

const a = measure(480), b = measure(960);
console.log(`[rivermass] seed=${SEED}  ref tw=${a.tw} (${a.land} land)  app tw=${b.tw} (${b.land} land)`);
const row = (k, va, vb) => console.log(`  ${k.padEnd(34)} ref ${va.toFixed(4).padStart(10)}   app ${vb.toFixed(4).padStart(10)}   app/ref ${(vb / (va || 1e-9)).toFixed(3)}`);
console.log(`  real drainage density by class (tiles/1000land × rn):`);
for (let c = 1; c <= 4; c++) {
  row(`  class ${c} real density`, 1000 * a.cnt[c] / a.land * a.rn, 1000 * b.cnt[c] / b.land * b.rn);
}
row("mean mag on channel (all classes)", (a.magSum[1] + a.magSum[2] + a.magSum[3] + a.magSum[4]) / (a.cnt[1] + a.cnt[2] + a.cnt[3] + a.cnt[4] || 1), (b.magSum[1] + b.magSum[2] + b.magSum[3] + b.magSum[4]) / (b.cnt[1] + b.cnt[2] + b.cnt[3] + b.cnt[4] || 1));
row("raw rm mass / land", a.rawMass / a.land, b.rawMass / b.land);
row("banded rm mass / land", a.bandMass / a.land, b.bandMass / b.land);
row("raw water=min(1,rm/RM_FULL) / land", a.rawWater / a.land, b.rawWater / b.land);
row("BANDED water / land", a.bandWater / a.land, b.bandWater / b.land);
row("SUM-band rm mass / land", a.sumMass / a.land, b.sumMass / b.land);
row("SUM-band water / land", a.sumWater / a.land, b.sumWater / b.land);
row("coast band (max) / land", a.coastMax / a.land, b.coastMax / b.land);
row("coast band (sum-cap) / land", a.coastSum / a.land, b.coastSum / b.land);

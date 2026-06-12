// Crop-package SPIKE renderer → PNG. Builds the earth_sim world and paints three
// stacked panels so you can SEE the crop-types idea on the real map:
//   A. DOMINANT CROP   — which package grows best on each tile (the climate bands)
//   B. WHEAT DIFFUSION — flood-fill of the wheat package out of the Fertile
//                        Crescent across contiguous wheat-suitable land. This is
//                        the continental-AXIS effect made visible: wheat races
//                        east–west along the temperate band and is WALLED by the
//                        hot/wet tropics and the oceans. Tiles where wheat COULD
//                        grow but never arrived (across a sea / tropic barrier)
//                        are tinted pale — the "right climate, no land bridge".
//   C. STORABLE SURPLUS— best achievable suit × storability. The wet tropics go
//                        DARK even where lush: tubers grow but don't store/tax,
//                        so no surplus-funded state (Diamond's Congo/Amazon).
//
//   node tools/render_crops.mjs [seed] [W] [H] [out.png]
import zlib from "node:zlib";
import { writeFileSync } from "node:fs";
import { generateWorld } from "../src/sim/worldgen.js";
import { computeRivers } from "../src/sim/riverGen.js";
import { CROP_PACKAGES, CROP_BY_ID } from "../src/sim/cropPackages.js";
import { cropSuitabilityPkg } from "../src/sim/cropGen.js";

const SEED = +(process.argv[2] || "8817");
const W = +(process.argv[3] || "480");
const H = +(process.argv[4] || "240");
const OUT = process.argv[5] || "/tmp/crops.png";
const N = W * H;

// ── minimal PNG (RGB) ────────────────────────────────────────────────
const crcTable = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = b => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = crcTable[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
function png(width, height, rgb) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0); const body = Buffer.concat([Buffer.from(type, "ascii"), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(body), 0); return Buffer.concat([len, body, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  const stride = width * 3 + 1, raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) { raw[y * stride] = 0; rgb.copy(raw, y * stride + 1, y * width * 3, (y + 1) * width * 3); }
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 6 })), chunk("IEND", Buffer.alloc(0))]);
}

// ── world + tile climate ─────────────────────────────────────────────
console.log(`[gen] earth_sim ${W}x${H} seed=${SEED} ...`);
const w = generateWorld(W, H, SEED, "earth_sim", 0.78, true, false, {});
const elev = w.elevation, temp = w.temperature, moist = w.moisture;
const coast = new Uint8Array(N); for (let i = 0; i < N; i++) coast[i] = w.coastal && w.coastal[i] ? 1 : 0;
const rivers = computeRivers(W, H, elev, moist, temp);
const rmag = rivers && rivers.riverMag ? rivers.riverMag : null;

// Per-package gated suitability, the dominant crop, and best storable surplus.
const suit = {}; for (const c of CROP_PACKAGES) suit[c.id] = new Float32Array(N);
const domIdx = new Int8Array(N).fill(-1);     // index into CROP_PACKAGES, -1 = sea/none
const domSuit = new Float32Array(N);
const surplus = new Float32Array(N);          // best suit×storability over all packages
for (let i = 0; i < N; i++) {
  if (elev[i] <= 0) continue;
  const t = temp[i], m = moist[i], rm = rmag ? rmag[i] : 0;
  let best = -1, bestS = 0, bestSurp = 0;
  for (let p = 0; p < CROP_PACKAGES.length; p++) {
    const pkg = CROP_PACKAGES[p];
    const s = cropSuitabilityPkg(pkg, t, m, elev[i], coast[i], rm, null);
    suit[pkg.id][i] = s;
    if (s > bestS) { bestS = s; best = p; }
    const surp = s * pkg.storability;
    if (surp > bestSurp) bestSurp = surp;
  }
  domIdx[i] = best; domSuit[i] = bestS; surplus[i] = bestSurp;
}

// ── Diffusion spike: flood-fill WHEAT from the Fertile Crescent ───────
// Cradle as fractional (fx,fy) like state.js's EARTH_HEARTH_SITES (Nile 0.580,0.329).
// The Fertile Crescent sits just NE of the Nile delta. Snap to the nearest
// wheat-suitable land tile so the seed never lands in sea/desert.
const SUIT_THRESH = 0.12;                     // a tile is "wheat farmland" above this
const wheat = CROP_BY_ID.wheat, wSuit = suit.wheat;
function snapCradle(fx, fy, r = 16) {
  const cx = Math.round(fx * W), cy = Math.round(fy * H);
  let best = -1, bestS = SUIT_THRESH;
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const x = (cx + dx + W) % W, y = cy + dy; if (y < 0 || y >= H) continue;
    const i = y * W + x; if (elev[i] > 0 && wSuit[i] > bestS) { bestS = wSuit[i]; best = i; }
  }
  return best;
}
const cradle = snapCradle(0.575, 0.305);
const reached = new Uint8Array(N);
if (cradle >= 0) {
  const stack = [cradle]; reached[cradle] = 1;
  while (stack.length) {
    const i = stack.pop(), y = (i / W) | 0, x = i - y * W;
    const nbr = [y * W + ((x - 1 + W) % W), y * W + ((x + 1) % W), y > 0 ? i - W : -1, y < H - 1 ? i + W : -1];
    for (const ni of nbr) {
      if (ni < 0 || reached[ni]) continue;
      if (elev[ni] > 0 && wSuit[ni] > SUIT_THRESH) { reached[ni] = 1; stack.push(ni); }
    }
  }
}

// ── diagnostics ──────────────────────────────────────────────────────
let land = 0, tMin = 9, tMax = -9, tSum = 0, mMin = 9, mMax = -9, mSum = 0;
const cover = {}; for (const c of CROP_PACKAGES) cover[c.id] = 0;
let wheatSuitable = 0, wheatReached = 0;
for (let i = 0; i < N; i++) {
  if (elev[i] <= 0) continue;
  land++; const t = temp[i], m = moist[i];
  if (t < tMin) tMin = t; if (t > tMax) tMax = t; tSum += t;
  if (m < mMin) mMin = m; if (m > mMax) mMax = m; mSum += m;
  if (domIdx[i] >= 0 && domSuit[i] > SUIT_THRESH) cover[CROP_PACKAGES[domIdx[i]].id]++;
  if (wSuit[i] > SUIT_THRESH) wheatSuitable++;
  if (reached[i]) wheatReached++;
}
const cdeg = t => ((t - 0.60) * 100).toFixed(1);
console.log(`[land] ${land} tiles  temp ${cdeg(tMin)}..${cdeg(tMax)}°C (mean ${cdeg(tSum/land)})  moist ${(mMin).toFixed(2)}..${(mMax).toFixed(2)} (mean ${(mSum/land).toFixed(2)})`);
let farmable = 0; for (const c of CROP_PACKAGES) farmable += cover[c.id];
console.log(`[dominant crop, % of ${farmable} farmable tiles]`);
for (const c of CROP_PACKAGES) console.log(`   ${c.id.padEnd(8)} ${(100 * cover[c.id] / Math.max(1, farmable)).toFixed(0).padStart(3)}%  (${cover[c.id]} tiles)`);
if (cradle >= 0) { const cy = (cradle / W) | 0, cx = cradle - cy * W; console.log(`[wheat cradle] tile (${cx},${cy})  ${cdeg(temp[cradle])}°C  moist ${moist[cradle].toFixed(2)}  suit ${wSuit[cradle].toFixed(2)}`); }
console.log(`[wheat diffusion] suitable land ${wheatSuitable} tiles · reached from cradle ${wheatReached} (${(100*wheatReached/Math.max(1,wheatSuitable)).toFixed(0)}% — the rest is wheat-climate land cut off by tropics/ocean)`);

// ── compose 3 stacked panels ─────────────────────────────────────────
const SEA = [16, 30, 60], GAP = 4, SEP = [10, 10, 14], BARREN = [70, 66, 60];
function panel(fill) { const buf = Buffer.alloc(N * 3); for (let i = 0; i < N; i++) { buf[i*3]=SEA[0]; buf[i*3+1]=SEA[1]; buf[i*3+2]=SEA[2]; if (elev[i] > 0) { const [r,g,b] = fill(i); buf[i*3]=r|0; buf[i*3+1]=g|0; buf[i*3+2]=b|0; } } return buf; }
const mix = (c, k) => [c[0]*k + BARREN[0]*(1-k), c[1]*k + BARREN[1]*(1-k), c[2]*k + BARREN[2]*(1-k)];

// A. dominant crop, brightness ∝ suitability
const pA = panel(i => { const d = domIdx[i]; if (d < 0 || domSuit[i] <= SUIT_THRESH) return BARREN; const k = 0.35 + 0.65 * Math.min(1, domSuit[i] / 0.7); return mix(CROP_PACKAGES[d].color, k); });
// B. wheat diffusion: reached=gold by suit; suitable-but-cut-off=pale tan; rest=barren
const pB = panel(i => {
  if (reached[i]) { const k = 0.4 + 0.6 * Math.min(1, wSuit[i] / 0.7); return mix(wheat.color, k); }
  if (wSuit[i] > SUIT_THRESH) return [185, 70, 50];    // wheat climate, never reached — MAROONED by the axis/ocean wall
  return BARREN;
});
if (cradle >= 0) { for (let dy=-1;dy<=1;dy++) for (let dx=-1;dx<=1;dx++){ const cy=(cradle/W|0)+dy, cx=(cradle-(cradle/W|0)*W)+dx; if(cy>=0&&cy<H){const i=cy*W+((cx+W)%W); pB[i*3]=235;pB[i*3+1]=40;pB[i*3+2]=40;} } }
// C. storable surplus, grayscale→green
const pC = panel(i => { const s = Math.min(1, surplus[i] / 0.7); if (s < 0.02) return BARREN; return [70 + s*30, 70 + s*110, 60 + s*30]; });

const PH = H, totalH = PH * 3 + GAP * 2;
const out = Buffer.alloc(W * totalH * 3);
function blit(buf, yOff) { buf.copy(out, yOff * W * 3); }
function fillSep(yOff) { for (let y = 0; y < GAP; y++) for (let x = 0; x < W; x++) { const o = ((yOff + y) * W + x) * 3; out[o]=SEP[0]; out[o+1]=SEP[1]; out[o+2]=SEP[2]; } }
blit(pA, 0); fillSep(PH); blit(pB, PH + GAP); fillSep(PH * 2 + GAP); blit(pC, PH * 2 + GAP * 2);

writeFileSync(OUT, png(W, totalH, out));
console.log(`[png] ${OUT}  (top→bottom: A dominant crop · B wheat diffusion · C storable surplus)`);
console.log(`[legend] ${CROP_PACKAGES.map(c => `${c.id}=rgb(${c.color.join(',')})`).join('  ')}`);

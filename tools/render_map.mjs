// Headless political-map renderer → PNG (no deps; matches the app's hsl tint).
// Renders world._countryClaim (what the app draws) and world._countryOwner (the
// underlying cost-Voronoi) at native tile resolution, with country tints, dark
// borders between realms, and settlement dots (cities brighter). Used to SEE the
// territory/border behaviour and verify fixes.
//   node tools/render_map.mjs <step> <seed> <outPrefix>
import zlib from "node:zlib";
import { writeFileSync } from "node:fs";
import { generateWorld } from "../src/worldgen.js";
import { computeRivers } from "../src/riverGen.js";
import { generateResources } from "../src/resourceGen.js";
import { initPeopleSim, stepPeopleSim, peopleSimStats } from "../src/peopleSim/index.js";

const STEP = parseInt(process.argv[2] || "8000", 10);
const SEED = parseInt(process.argv[3] || "8817", 10);
const OUT  = process.argv[4] || "/tmp/map";
const SCALE = 2;                       // upscale each tile to SCALE×SCALE px for legibility
const W = 960, H = 480, TW = W, TH = H;

// ── minimal PNG (RGB) ────────────────────────────────────────────────
const crcTable = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function png(width, height, rgb) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0); const body = Buffer.concat([Buffer.from(type, "ascii"), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0); return Buffer.concat([len, body, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  const stride = width * 3 + 1; const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) { const ro = y * stride; raw[ro] = 0; rgb.copy(raw, ro + 1, y * width * 3, (y + 1) * width * 3); }
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 6 })), chunk("IEND", Buffer.alloc(0))]);
}
function hsl(h, s, l) { const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2; const hh = h / 60; let r, g, b; if (hh < 1) [r, g, b] = [c, x, 0]; else if (hh < 2) [r, g, b] = [x, c, 0]; else if (hh < 3) [r, g, b] = [0, c, x]; else if (hh < 4) [r, g, b] = [0, x, c]; else if (hh < 5) [r, g, b] = [x, 0, c]; else [r, g, b] = [c, 0, x]; return [(r + m) * 255 | 0, (g + m) * 255 | 0, (b + m) * 255 | 0]; }
const ccColor = cc => hsl(((cc * 61) % 360 + 360) % 360, 0.5, 0.5);

// ── world ────────────────────────────────────────────────────────────
console.log(`[gen] ${W}x${H} seed=${SEED} ...`);
const w = generateWorld(W, H, SEED, "earth_sim", 0.78, true, false, {});
const tElev = new Float32Array(TW * TH), tTemp = new Float32Array(TW * TH), tMoist = new Float32Array(TW * TH), tCoast = new Uint8Array(TW * TH), tCrop = new Float32Array(TW * TH);
function tileFert(t, m, e) { if (e > 0.45) return 0.01; const tF = Math.min(1, t * 1.5) * Math.min(1, 1 - Math.pow(Math.max(0, t - 0.7), 2) * 4); const mF = Math.exp(-((m - 0.45) * (m - 0.45)) / (2 * 0.22 * 0.22)); return Math.max(0.01, tF * mF * (1 - Math.max(0, e - 0.15) * 3)); }
for (let ty = 0; ty < TH; ty++) for (let tx = 0; tx < TW; tx++) { const i = ty * W + tx, ti = ty * TW + tx; tElev[ti] = w.elevation[i]; tTemp[ti] = w.temperature[i]; tMoist[ti] = w.moisture[i]; tCoast[ti] = w.coastal[ti] || 0; tCrop[ti] = tileFert(w.temperature[i], w.moisture[i], w.elevation[i]); }
const rivers = computeRivers(TW, TH, tElev, tMoist, tTemp); w.rivers = rivers;
const deposits = generateResources(TW, TH, tElev, tTemp, tMoist, tCoast, w, w._seed || SEED, rivers); w.deposits = deposits;
const world = initPeopleSim(w, { seed: w._seed || SEED, tCrop, tileRes: 1, deposits });
console.log(`[run] -> step ${STEP} ...`);
for (let s = 1; s <= STEP; s++) stepPeopleSim(world, 1);
console.log(`[stats]`, peopleSimStats(world));

function render(arr, label) {
  const { tw, th, elev } = world;
  const ow = tw * SCALE, oh = th * SCALE;
  const px = Buffer.alloc(ow * oh * 3);
  const set = (x, y, r, g, b) => { const o = (y * ow + x) * 3; px[o] = r; px[o + 1] = g; px[o + 2] = b; };
  for (let ty = 0; ty < th; ty++) for (let tx = 0; tx < tw; tx++) {
    const ti = ty * tw + tx;
    let r, g, b;
    if (elev[ti] <= 0) { r = 28; g = 42; b = 74; }                 // sea
    else if (arr[ti] < 0) { r = 64; g = 70; b = 54; }              // unclaimed land
    else { [r, g, b] = ccColor(arr[ti]); }
    // border darkening: differs from right/down neighbour (same country grouping)
    const cc = arr[ti];
    const rt = arr[ty * tw + (tx === tw - 1 ? 0 : tx + 1)];
    const dn = ty < th - 1 ? arr[ti + tw] : cc;
    const isBorder = elev[ti] > 0 && cc >= 0 && ((rt >= 0 && rt !== cc) || (dn >= 0 && dn !== cc));
    if (isBorder) { r = (r * 0.35) | 0; g = (g * 0.35) | 0; b = (b * 0.35) | 0; }
    for (let yy = 0; yy < SCALE; yy++) for (let xx = 0; xx < SCALE; xx++) set(tx * SCALE + xx, ty * SCALE + yy, r, g, b);
  }
  // settlement dots: cities (tier>=2) white, towns light, villages faint
  for (const s of world.settlements) {
    if (s.mode !== "settled") continue;
    const cx = (s.pos.x | 0) * SCALE, cy = (s.pos.y | 0) * SCALE;
    const t = s.tier | 0;
    const col = t >= 2 ? [255, 255, 255] : t >= 1 ? [230, 220, 150] : [150, 150, 150];
    const rad = t >= 2 ? 2 : t >= 1 ? 1 : 0;
    for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) { const x = cx + dx, y = cy + dy; if (x >= 0 && x < tw * SCALE && y >= 0 && y < th * SCALE) set(x, y, col[0], col[1], col[2]); }
  }
  const file = `${OUT}_${label}.png`;
  writeFileSync(file, png(tw * SCALE, th * SCALE, px));
  console.log(`[png] ${file}  (${tw * SCALE}x${th * SCALE})`);
}

render(world._countryClaim, "claim");
render(world._countryOwner, "owner");

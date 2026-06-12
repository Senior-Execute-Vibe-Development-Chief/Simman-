// Render the earth_sim TEMPERATURE field to PNG using the app's own t→colour
// palette (WorldSim.jsx temperature overlay). Worldgen only — no sim — so it's
// instant. Lets you SEE the latitude temperature bands.
//   node tools/render_temp.mjs [seed] [W] [H] [out]
import zlib from "node:zlib";
import { writeFileSync } from "node:fs";
import { generateWorld } from "../src/sim/worldgen.js";

const SEED = parseInt(process.argv[2] || "8817", 10);
const W = parseInt(process.argv[3] || "960", 10), H = parseInt(process.argv[4] || "480", 10);
const OUT = process.argv[5] || "/tmp/temp_map.png";

// ── minimal PNG (RGB) — copied from render_map.mjs ───────────────────
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

// App temperature palette (WorldSim.jsx): white(-60) → purple → blue → green → yellow → orange → red(+40°C).
function tempColor(t) {
  let r, g, b;
  if (t < 0.20) { const s = t / 0.20; r = (230 - s * 130) | 0; g = (225 - s * 185) | 0; b = (240 - s * 40) | 0; }
  else if (t < 0.40) { const s = (t - 0.20) / 0.20; r = (100 - s * 70) | 0; g = (40 - s * 10) | 0; b = (200 - s * 10) | 0; }
  else if (t < 0.50) { const s = (t - 0.40) / 0.10; r = (30 + s * 10) | 0; g = (30 + s * 20) | 0; b = (190 - s * 40) | 0; }
  else if (t < 0.60) { const s = (t - 0.50) / 0.10; r = (40 + s * 60) | 0; g = (50 + s * 130) | 0; b = (150 + s * 50) | 0; }
  else if (t < 0.70) { const s = (t - 0.60) / 0.10; r = (100 - s * 30) | 0; g = (180 + s * 40) | 0; b = (200 - s * 150) | 0; }
  else if (t < 0.80) { const s = (t - 0.70) / 0.10; r = (70 + s * 160) | 0; g = (220 + s * 30) | 0; b = (50 - s * 30) | 0; }
  else if (t < 0.90) { const s = (t - 0.80) / 0.10; r = (230 + s * 25) | 0; g = (250 - s * 100) | 0; b = (20 - s * 10) | 0; }
  else { const s = (t - 0.90) / 0.10; r = 255; g = (150 - s * 110) | 0; b = (10 + s * 5) | 0; }
  return [r, g, b];
}

console.log(`[gen] earth_sim ${W}x${H} seed=${SEED} ...`);
const w = generateWorld(W, H, SEED, "earth_sim", 0.78, true, false, {});
const rgb = Buffer.alloc(W * H * 3);
// Zonal-mean °C readout (land + ocean), to eyeball the latitude gradient.
const bands = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90];
const lSum = new Array(bands.length).fill(0), lN = new Array(bands.length).fill(0);
const oSum = new Array(bands.length).fill(0), oN = new Array(bands.length).fill(0);
for (let y = 0; y < H; y++) {
  const latDeg = Math.abs(y / H - 0.5) * 2 * 90;
  let bi = 0; for (let k = 0; k < bands.length; k++) if (latDeg >= bands[k] - 5 && latDeg < bands[k] + 5) { bi = k; break; }
  for (let x = 0; x < W; x++) {
    const i = y * W + x, t = w.temperature[i];
    const [r, g, b] = tempColor(t); rgb[i * 3] = r; rgb[i * 3 + 1] = g; rgb[i * 3 + 2] = b;
    if (w.elevation[i] > 0) { lSum[bi] += t * 100 - 60; lN[bi]++; } else { oSum[bi] += t * 100 - 60; oN[bi]++; }
  }
}
writeFileSync(OUT, png(W, H, rgb));
console.log(`[png] ${OUT}  (${W}x${H})`);
console.log("zonal-mean temperature (°C):  lat    land    ocean");
for (let k = 0; k < bands.length; k++) {
  const l = lN[k] ? (lSum[k] / lN[k]).toFixed(1) : "  -";
  const o = oN[k] ? (oSum[k] / oN[k]).toFixed(1) : "  -";
  console.log(`  ${String(bands[k]).padStart(2)}°   ${l.padStart(6)}  ${o.padStart(6)}`);
}

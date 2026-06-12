// Render the earth_sim BIOME map to PNG, replicating WorldSim.jsx getBiomeD + BC
// colours, to verify the biome thresholds match the calibrated temperature scale.
//   node tools/render_biome.mjs [seed] [W] [H] [out]
import zlib from "node:zlib";
import { writeFileSync } from "node:fs";
import { generateWorld } from "../src/sim/worldgen.js";

const SEED = parseInt(process.argv[2] || "8817", 10);
const W = parseInt(process.argv[3] || "960", 10), H = parseInt(process.argv[4] || "480", 10);
const OUT = process.argv[5] || "/tmp/biome_map.png";

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

// ── replicated from WorldSim.jsx (keep in sync) ──
const BC = [[10,22,56],[20,48,95],[36,78,125],[194,182,140],[168,158,130],[235,240,248],[50,80,58],[45,78,48],[50,105,45],[25,100,52],[14,72,28],[192,176,82],[158,165,78],[210,185,140],[140,135,78],[78,118,48],[152,145,135],[42,110,38],[195,190,180]];
const BN = ['DeepOcean','ShallowOcean','Coastal','Beach','Tundra','Ice','Taiga','Boreal','TempForest','TempRain','TropRain','Savanna','Grassland','Desert','Shrubland','TropDryForest','Barren','Subtropical','ColdDesert'];
function getBiomeD(e, m, t, sl) {
  if (e <= sl) return e < sl - .08 ? 0 : e < sl - .01 ? 1 : 2;
  const demand = .5 + t * .5;
  const em = Math.min(1, m / demand);
  if (t < .45) return 5;
  if (t < .52) return em > .4 ? 6 : em > .08 ? 4 : 18;
  if (t < .58) return em > .35 ? 6 : em > .08 ? 4 : 18;
  if (t < .65) return em > .45 ? 7 : em > .25 ? 6 : em > .08 ? 4 : 18;
  if (t < .78) return em > .55 ? 9 : em > .35 ? 8 : em > .15 ? 12 : 13;
  if (t < .85) return em > .5 ? 17 : em > .3 ? 15 : em > .18 ? 11 : em > .1 ? 14 : 13;
  return em > .5 ? 10 : em > .3 ? 15 : em > .18 ? 11 : em > .1 ? 12 : 13;
}

console.log(`[gen] earth_sim ${W}x${H} seed=${SEED} ...`);
const w = generateWorld(W, H, SEED, "earth_sim", 0.78, true, false, {});
const rgb = Buffer.alloc(W * H * 3);
const counts = {};
for (let i = 0; i < W * H; i++) {
  const b = getBiomeD(w.elevation[i], w.moisture[i], w.temperature[i], 0);
  const c = BC[b]; rgb[i * 3] = c[0]; rgb[i * 3 + 1] = c[1]; rgb[i * 3 + 2] = c[2];
  if (w.elevation[i] > 0) counts[b] = (counts[b] || 0) + 1;
}
writeFileSync(OUT, png(W, H, rgb));
console.log(`[png] ${OUT}  (${W}x${H})`);
const land = Object.values(counts).reduce((a, b) => a + b, 0);
console.log("LAND biome distribution:");
for (const [b, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) console.log(`  ${BN[b].padEnd(14)} ${(100 * n / land).toFixed(1)}%`);

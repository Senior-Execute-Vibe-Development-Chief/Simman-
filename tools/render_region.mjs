// Render a zoomed biome crop of a named region (upscaled) for visual inspection.
//   node tools/render_region.mjs <region> [preset] [scale]
import zlib from "node:zlib";
import { writeFileSync } from "node:fs";
import { generateWorld } from "../src/sim/worldgen.js";

const REGIONS = {
  asia:   { latN: 60, latS: 5, lonW: 60, lonE: 150 },
  africa: { latN: 38, latS: -10, lonW: -20, lonE: 55 },
  antarctica: { latN: -55, latS: -90, lonW: -180, lonE: 180 },
  namerica: { latN: 60, latS: 15, lonW: -130, lonE: -60 },
  australia: { latN: -8, latS: -45, lonW: 110, lonE: 180 },
};
const REGION = process.argv[2] || "asia";
const PRESET = process.argv[3] || "earth_sim";
const SCALE = parseInt(process.argv[4] || "4", 10);
const W = 720, H = 360;
const r = REGIONS[REGION];

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
const BC = [[10,22,56],[20,48,95],[36,78,125],[194,182,140],[168,158,130],[235,240,248],[50,80,58],[45,78,48],[50,105,45],[25,100,52],[14,72,28],[192,176,82],[158,165,78],[210,185,140],[140,135,78],[78,118,48],[152,145,135],[42,110,38],[195,190,180]];
function getBiomeD(e, m, t, sl, dry) {
  if (e <= sl) return e < sl - .08 ? 0 : e < sl - .01 ? 1 : 2;
  const demand = .5 + t * .5; let em = Math.min(1, m / demand);
  // Dry-season length (kept in sync with WorldSim.jsx getBiomeD).
  const warmth = Math.max(0, Math.min(1, (t - 0.79) / 0.035));
  if (dry > 0 && warmth > 0) {
    const seas = em * (1 - 0.68 * warmth * Math.max(0, Math.min(1, (dry - 0.28) / 0.10)));
    em = Math.max(seas, Math.min(em, 0.17));
  }

  if (t < .45) return 5;
  if (t < .52) return em > .4 ? 6 : em > .08 ? 4 : 18;
  if (t < .58) return em > .35 ? 6 : em > .08 ? 4 : 18;
  if (t < .65) return em > .45 ? 7 : em > .25 ? 6 : em > .08 ? 4 : 18;
  if (t < .78) return em>.58?9:em>.40?8:em>.14?12:13;
  if (t < .85) return em>.54?17:em>.36?15:em>.16?11:em>.09?14:13;
  return em>.56?10:em>.38?15:em>.16?11:em>.09?12:13;
}
const w = generateWorld(W, H, 8817, PRESET, 0.78, true, false, {});
const x0 = Math.round(((r.lonW + 180) / 360) * W), x1 = Math.round(((r.lonE + 180) / 360) * W);
const y0 = Math.round((90 - r.latN) / 180 * H), y1 = Math.round((90 - r.latS) / 180 * H);
const cw = x1 - x0, ch = y1 - y0, ow = cw * SCALE, oh = ch * SCALE;
const rgb = Buffer.alloc(ow * oh * 3);
for (let oy = 0; oy < oh; oy++) for (let ox = 0; ox < ow; ox++) {
  const sx = x0 + Math.floor(ox / SCALE), sy = y0 + Math.floor(oy / SCALE);
  const i = sy * W + sx, b = getBiomeD(w.elevation[i], w.moisture[i], w.temperature[i], 0, w.dryFrac ? w.dryFrac[i] : 0), c = BC[b];
  const o = (oy * ow + ox) * 3; rgb[o] = c[0]; rgb[o+1] = c[1]; rgb[o+2] = c[2];
}
const out = `/tmp/region_${REGION}_${PRESET}.png`;
writeFileSync(out, png(ow, oh, rgb));
console.log(`wrote ${out} (${ow}x${oh}) lon[${r.lonW},${r.lonE}] lat[${r.latS},${r.latN}]`);

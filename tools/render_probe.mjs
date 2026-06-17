// Render raw earth heightmap + earth_sim biome/temp/moist maps side by side,
// with a lat/lon graticule + landmark dots, so alignment can be checked by eye.
//   node tools/render_probe.mjs [W] [H]
import zlib from "node:zlib";
import { writeFileSync } from "node:fs";
import { generateWorld } from "../src/sim/worldgen.js";
import { EARTH_ELEV, EARTH_W, EARTH_H, decodeEarth, sampleEarth } from "../src/sim/earthData.js";

const W = parseInt(process.argv[2] || "720", 10);
const H = parseInt(process.argv[3] || "360", 10);

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
function getBiomeD(e, m, t, sl) {
  if (e <= sl) return e < sl - .08 ? 0 : e < sl - .01 ? 1 : 2;
  const demand = .5 + t * .5; const em = Math.min(1, m / demand);
  if (t < .45) return 5;
  if (t < .52) return em > .4 ? 6 : em > .08 ? 4 : 18;
  if (t < .58) return em > .35 ? 6 : em > .08 ? 4 : 18;
  if (t < .65) return em > .45 ? 7 : em > .25 ? 6 : em > .08 ? 4 : 18;
  if (t < .78) return em > .55 ? 9 : em > .35 ? 8 : em > .15 ? 12 : 13;
  if (t < .85) return em > .5 ? 17 : em > .3 ? 15 : em > .18 ? 11 : em > .1 ? 14 : 13;
  return em > .5 ? 10 : em > .3 ? 15 : em > .18 ? 11 : em > .1 ? 12 : 13;
}

const eData = decodeEarth(EARTH_ELEV);
console.log(`[gen] earth_sim ${W}x${H} ...`);
const w = generateWorld(W, H, 8817, "earth_sim", 0.78, true, false, {});

// Landmark dots to verify alignment (lat +N, lon +E)
const MARKS = [
  ['eq+gmt', 0, 0], ['NP', 89, 0], ['Sahara', 23, 13], ['Beijing', 40, 116],
  ['Amazon', -3, -62], ['India', 22, 78], ['Australia', -25, 133], ['Antarctica', -75, 0],
];
function px(lat, lon) {
  const y = Math.round((90 - lat) / 180 * (H - 1));
  let x = Math.round(((lon + 180) / 360) * W) % W; if (x < 0) x += W;
  return [x, y];
}

function withGraticule(rgb) {
  // draw meridians every 30°, parallels every 30°, equator/GMT brighter
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const lon = (x / W) * 360 - 180, lat = 90 - (y / H) * 180;
    const onMer = Math.abs(((lon + 180) % 30)) < (180 / W * 1.2);
    const onPar = Math.abs(((lat + 90) % 30)) < (180 / H * 1.2);
    if (onMer || onPar) { const i = (y * W + x) * 3; rgb[i] = (rgb[i] + 255) >> 1; rgb[i+1] = (rgb[i+1] + 255) >> 1; rgb[i+2] = (rgb[i+2] + 255) >> 1; }
  }
  for (const [, lat, lon] of MARKS) {
    const [mx, my] = px(lat, lon);
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const xx = ((mx + dx) % W + W) % W, yy = my + dy; if (yy < 0 || yy >= H) continue;
      const i = (yy * W + xx) * 3; rgb[i] = 255; rgb[i+1] = 0; rgb[i+2] = 0;
    }
  }
  return rgb;
}

// 1) raw heightmap (grayscale, land=green-ish above sea)
const hm = Buffer.alloc(W * H * 3);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const he = sampleEarth(eData, EARTH_W, EARTH_H, x, y, W, H);
  const i = (y * W + x) * 3;
  if (he < 3) { hm[i] = 20; hm[i+1] = 40; hm[i+2] = 90; }
  else { const v = Math.min(255, 60 + he); hm[i] = v * 0.5; hm[i+1] = v; hm[i+2] = v * 0.5; }
}
writeFileSync('/tmp/heightmap.png', png(W, H, withGraticule(Buffer.from(hm))));

// 2) biome map
const bm = Buffer.alloc(W * H * 3);
for (let i = 0; i < W * H; i++) { const b = getBiomeD(w.elevation[i], w.moisture[i], w.temperature[i], 0); const c = BC[b]; bm[i*3]=c[0]; bm[i*3+1]=c[1]; bm[i*3+2]=c[2]; }
writeFileSync('/tmp/biome.png', png(W, H, withGraticule(Buffer.from(bm))));

// 3) temperature map (blue cold → red hot)
const tm = Buffer.alloc(W * H * 3);
for (let i = 0; i < W * H; i++) { const t = w.temperature[i]; const r = Math.max(0, Math.min(255, (t - 0.4) * 400)); const b = Math.max(0, Math.min(255, (0.7 - t) * 400)); tm[i*3]=r; tm[i*3+1]=Math.max(0,120-Math.abs(t-0.6)*300); tm[i*3+2]=b; }
writeFileSync('/tmp/temp.png', png(W, H, withGraticule(Buffer.from(tm))));

// 4) moisture map (brown dry → blue wet, ocean gray)
const mm = Buffer.alloc(W * H * 3);
for (let i = 0; i < W * H; i++) { if (w.elevation[i] <= 0) { mm[i*3]=60; mm[i*3+1]=60; mm[i*3+2]=70; continue; } const m = w.moisture[i]; mm[i*3]=Math.max(0,Math.min(255,(1-m)*220+30)); mm[i*3+1]=Math.max(0,Math.min(255,m*120+40)); mm[i*3+2]=Math.max(0,Math.min(255,m*230)); }
writeFileSync('/tmp/moist.png', png(W, H, withGraticule(Buffer.from(mm))));

console.log('wrote /tmp/heightmap.png /tmp/biome.png /tmp/temp.png /tmp/moist.png');
for (const [name, lat, lon] of MARKS) { const [x, y] = px(lat, lon); const i = y*W+x; console.log(`${name.padEnd(12)} (${lat},${lon}) -> px(${x},${y}) elev=${w.elevation[i] <= 0 ? 'OCEAN' : w.elevation[i].toFixed(3)}`); }

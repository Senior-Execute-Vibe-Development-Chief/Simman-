// Render the deep-ancestry map to a PNG so the colours can be eyeballed.
//   node tools/render_ancestry.mjs [seed]
import { buildWorld } from "./_harness.mjs";
import zlib from "node:zlib";
import fs from "node:fs";

const SEED = Number(process.argv[2] || 4242), SCALE = 4;
const { ter } = buildWorld({ W: 320, H: 160, seed: SEED, preset: "earth_sim" });
const { tAncestry: anc, ancHue: hue, ancLight: light, tElev, tw, th } = ter;

function hslToRgb(h, s, l) {
  h /= 360; s /= 100; l /= 100;
  const k = n => (n + h * 12) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

const W = tw * SCALE, H = th * SCALE;
const raw = Buffer.alloc(H * (1 + W * 3));
for (let py = 0; py < th; py++) {
  for (let px = 0; px < tw; px++) {
    const a = anc[py * tw + px];
    let r, g, b;
    if (a >= 0) { [r, g, b] = hslToRgb(hue[a], 53, light[a]); }
    else if (tElev[py * tw + px] > 0) { r = g = b = 110; }   // masked land (ice/polar) = grey
    else { r = g = b = 22; }                                  // ocean
    for (let sy = 0; sy < SCALE; sy++) {
      const row = py * SCALE + sy, off = row * (1 + W * 3) + 1 + px * SCALE * 3;
      for (let sx = 0; sx < SCALE; sx++) { raw[off + sx * 3] = r; raw[off + sx * 3 + 1] = g; raw[off + sx * 3 + 2] = b; }
    }
  }
}

// minimal PNG (truecolour, no interlace)
const crcTab = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c; } return t; })();
const crc32 = buf => { let c = ~0; for (let i = 0; i < buf.length; i++) c = crcTab[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return ~c >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); };
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
const out = `/tmp/ancestry_${SEED}.png`;
fs.writeFileSync(out, png);
console.log(`wrote ${out}  (${W}x${H})`);

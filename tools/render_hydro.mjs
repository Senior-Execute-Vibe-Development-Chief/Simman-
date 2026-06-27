// Hydrology renderer → PNG: elevation + rivers + lakes. No deps.
//   node tools/render_hydro.mjs <seed> <W> <out>
import zlib from "node:zlib";
import { writeFileSync } from "node:fs";
import { buildWorld } from "../src/sim/pipeline.js";

const SEED = parseInt(process.argv[2] || "8817", 10);
const W = parseInt(process.argv[3] || "960", 10), H = W >> 1;
const OUT = process.argv[4] || "/tmp/hydro";

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

console.log(`[gen] ${W}x${H} seed=${SEED}`);
const { ter } = buildWorld({ W, H, seed: SEED });
const { tw, th, tElev, tMoist, rivers: R } = ter;

function colorAt(i) {
  if (tElev[i] <= 0) return [30, 60, 110];           // ocean
  if (R.lake[i] >= 0) return [60, 140, 230];         // lake (bright blue)
  const m = R.riverMag[i];
  if (m >= 4) return [0, 200, 255];                  // great
  if (m >= 3) return [40, 180, 240];                 // major
  if (m >= 2) return [80, 170, 220];                 // tributary
  if (m >= 1) return [120, 175, 205];                // stream
  // land: shade by elevation, tinted by moisture (green wet → tan dry)
  const e = tElev[i];
  const dry = Math.max(0, Math.min(1, (0.35 - (tMoist[i] || 0)) / 0.30));
  const base = 110 + e * 120;
  const r = base * (0.7 + 0.4 * dry);
  const g = base * (0.85 - 0.15 * dry);
  const b = base * (0.55 - 0.2 * dry);
  return [Math.min(255, r) | 0, Math.min(255, g) | 0, Math.min(255, b) | 0];
}

// full map
const rgb = Buffer.alloc(tw * th * 3);
for (let i = 0; i < tw * th; i++) { const c = colorAt(i); rgb[i*3]=c[0]; rgb[i*3+1]=c[1]; rgb[i*3+2]=c[2]; }
writeFileSync(`${OUT}_full.png`, png(tw, th, rgb));
console.log(`[out] ${OUT}_full.png`);

// zoom: Caspian–Central Asia–Himalaya, 25-58N, 40-105E, upscaled 3x
const latHi=58,latLo=25,lonLo=40,lonHi=105;
const y0=Math.max(0,Math.round((0.5-latHi/180)*th)), y1=Math.min(th,Math.round((0.5-latLo/180)*th));
const x0=Math.round((lonLo+180)/360*tw), x1=Math.round((lonHi+180)/360*tw);
const zw=(x1-x0), zh=(y1-y0), S=3;
const zrgb = Buffer.alloc(zw*S*zh*S*3);
for (let zy=0; zy<zh; zy++) for (let zx=0; zx<zw; zx++) {
  const c = colorAt((y0+zy)*tw + (x0+zx));
  for (let dy=0; dy<S; dy++) for (let dx=0; dx<S; dx++) {
    const px=(zy*S+dy)*(zw*S)+(zx*S+dx);
    zrgb[px*3]=c[0]; zrgb[px*3+1]=c[1]; zrgb[px*3+2]=c[2];
  }
}
writeFileSync(`${OUT}_zoom.png`, png(zw*S, zh*S, zrgb));
console.log(`[out] ${OUT}_zoom.png (${zw*S}x${zh*S}, 25-58N 40-105E)`);

// stats: count lake tiles & big-river tiles in the corridor
let lakeT=0,rivT=0;
for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){const i=y*tw+x;if(R.lake[i]>=0)lakeT++;if(R.riverMag[i]>=2)rivT++;}
console.log(`[corridor] lake tiles=${lakeT}, river(≥trib) tiles=${rivT}`);

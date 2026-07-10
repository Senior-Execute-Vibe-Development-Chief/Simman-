// Tightly-spaced TEMPORAL frames to attribute the "sudden recession / horizontal borders /
// countries vanishing" symptoms: each row is a close-together step; LEFT = the SIM's authoritative
// _countryOwner, RIGHT = the field _ctrlOwner. If a recession/horizontal-line appears in BOTH, it's
// the SIM (the field faithfully tracks it); if only on the RIGHT, it's the field render.
//   node tools/render_ctrl_temporal.mjs [W] [seed] [start] [interval] [frames] [out.png]
import zlib from "node:zlib";
import { writeFileSync } from "node:fs";
import { buildSim } from "./_harness.mjs";
import { applyTuning } from "../src/sim/peopleSim/tuning.js";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";

applyTuning({ CONTROL_FIELD: 1 });
const W = +(process.argv[2] || 480), H = W >> 1;
const SEED = +(process.argv[3] || 8817);
const START = +(process.argv[4] || 10350);
const IVL = +(process.argv[5] || 150);
const FRAMES = +(process.argv[6] || 6);
const OUT = process.argv[7] || "/tmp/ctrl_temporal.png";
const world = buildSim({ W, H, seed: SEED });
const tw = world.tw, th = world.th, N = world.N, elev = world.elev;

const hue = (id) => { const h = ((id * 137) % 360) * Math.PI / 180; return [128 + 100 * Math.cos(h), 128 + 100 * Math.cos(h + 2.09), 128 + 100 * Math.cos(h + 4.19)]; };
function paint(rgb, ox, oy, W2, arr) {
  for (let i = 0; i < N; i++) {
    const y = (i / tw) | 0, x = i - y * tw;
    let r, g, b;
    if (elev[i] <= 0) { r = 18; g = 30; b = 62; }
    else if (!arr || arr[i] < 0) { r = 92; g = 88; b = 78; }
    else { [r, g, b] = hue(arr[i]); }
    const px = ox + x, py = oy + y, o = (py * W2 + px) * 3;
    rgb[o] = r; rgb[o + 1] = g; rgb[o + 2] = b;
  }
  for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
    const i = y * tw + x; if (!arr || arr[i] < 0 || elev[i] <= 0) continue;
    const rt = arr[y * tw + ((x + 1) % tw)], dn = y < th - 1 ? arr[i + tw] : arr[i];
    if (rt !== arr[i] || dn !== arr[i]) { const o = ((oy + y) * W2 + (ox + x)) * 3; rgb[o] *= 0.4; rgb[o + 1] *= 0.4; rgb[o + 2] *= 0.4; }
  }
}

const GAP = 6, panelW = tw, sheetW = panelW * 2 + GAP, sheetH = FRAMES * (th + GAP) - GAP;
const rgb = Buffer.alloc(sheetW * sheetH * 3, 24);
stepPeopleSim(world, START);
for (let f = 0; f < FRAMES; f++) {
  if (f > 0) stepPeopleSim(world, IVL);
  const oy = f * (th + GAP);
  // RIGHT panel = the ACTUAL DRAWN map the worker ships: field owner, else fall back to the
  // sim's owner on land (never abandon sim-owned land), water masked. Mirrors peopleSimWorker.
  const co = world._countryOwner, fo = world._ctrlOwner, drawn = new Int32Array(N);
  for (let i = 0; i < N; i++) drawn[i] = elev[i] > 0 ? (fo && fo[i] >= 0 ? fo[i] : (co && co[i] >= 0 ? co[i] : -1)) : -1;
  paint(rgb, 0, oy, sheetW, world._countryOwner);
  paint(rgb, panelW + GAP, oy, sheetW, drawn);
  const stat = (arr) => { let c = 0, land = 0; for (let i = 0; i < N; i++) { if (!(elev[i] > 0)) continue; land++; if (arr && arr[i] >= 0) c++; } return (100 * c / land).toFixed(1); };
  console.log(`frame ${f}  step ${world.step}:  SIM ${stat(world._countryOwner)}%   FIELD ${stat(world._ctrlOwner)}%`);
}

const crcT = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc = b => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = crcT[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length, 0); const b = Buffer.concat([Buffer.from(t, "ascii"), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(b), 0); return Buffer.concat([l, b, c]); };
const ih = Buffer.alloc(13); ih.writeUInt32BE(sheetW, 0); ih.writeUInt32BE(sheetH, 4); ih[8] = 8; ih[9] = 2;
const stride = sheetW * 3 + 1, rawimg = Buffer.alloc(stride * sheetH);
for (let y = 0; y < sheetH; y++) { rawimg[y * stride] = 0; rgb.copy(rawimg, y * stride + 1, y * sheetW * 3, (y + 1) * sheetW * 3); }
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ih), chunk("IDAT", zlib.deflateSync(rawimg)), chunk("IEND", Buffer.alloc(0))]);
writeFileSync(OUT, png);
console.log(`wrote ${OUT}  (${sheetW}x${sheetH}; rows=frames ${IVL} apart, LEFT=SIM _countryOwner, RIGHT=field)`);

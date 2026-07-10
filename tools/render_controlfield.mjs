// A/B the control-field politics against the old periodic recompute, on the SAME nations.
// Renders a comparison sheet (rows = checkpoints; left = _countryOwner recompute, right =
// _ctrlOwner control field) and prints per-tick border CHURN for both (smoothness).
//   node tools/render_controlfield.mjs [W] [seed] [out.png]
import zlib from "node:zlib";
import { writeFileSync } from "node:fs";
import { buildSim } from "./_harness.mjs";
import { applyTuning } from "../src/sim/peopleSim/tuning.js";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";

applyTuning({ CONTROL_FIELD: 1 });   // prototype ON (runs alongside the recompute)

const W = +(process.argv[2] || 640), H = W >> 1;
const SEED = +(process.argv[3] || 8817);
const OUT = process.argv[4] || "/tmp/controlfield_ab.png";
const world = buildSim({ W, H, seed: SEED });
const tw = world.tw, th = world.th, N = world.N, elev = world.elev;

const CKPTS = [3000, 6000, 10000, 15000];
const hue = (id) => { const h = ((id * 137) % 360) * Math.PI / 180; return [128 + 100 * Math.cos(h), 128 + 100 * Math.cos(h + 2.09), 128 + 100 * Math.cos(h + 4.19)]; };
function paint(rgb, ox, oy, W2, arr) {
  for (let i = 0; i < N; i++) {
    const y = (i / tw) | 0, x = i - y * tw;
    let r, g, b;
    if (elev[i] <= 0) { r = 18; g = 30; b = 62; }
    else if (arr[i] < 0) { r = 92; g = 88; b = 78; }
    else { [r, g, b] = hue(arr[i]); }
    const px = ox + x, py = oy + y, o = (py * W2 + px) * 3;
    rgb[o] = r; rgb[o + 1] = g; rgb[o + 2] = b;
  }
  // border darkening
  for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
    const i = y * tw + x; if (arr[i] < 0 || elev[i] <= 0) continue;
    const rt = arr[y * tw + ((x + 1) % tw)], dn = y < th - 1 ? arr[i + tw] : arr[i];
    if (rt !== arr[i] || dn !== arr[i]) { const o = ((oy + y) * W2 + (ox + x)) * 3; rgb[o] *= 0.4; rgb[o + 1] *= 0.4; rgb[o + 2] *= 0.4; }
  }
}

const GAP = 8;
const panelW = tw, sheetW = panelW * 2 + GAP;
const sheetH = CKPTS.length * (th + GAP) - GAP;
const rgb = Buffer.alloc(sheetW * sheetH * 3, 24);

// churn accumulators (measured every tick over the whole run)
let prevCo = null, prevCf = null, churnCo = 0, churnCf = 0, maxCo = 0, maxCf = 0, ticks = 0;
const diffCount = (a, b) => { if (!a || !b) return 0; let n = 0; for (let i = 0; i < N; i++) if (a[i] !== b[i]) n++; return n; };

let row = 0;
for (const ck of CKPTS) {
  while (world.step < ck) {
    stepPeopleSim(world, 1);
    // Measure per-tick churn only in a 300-tick WINDOW before each checkpoint (spans a
    // territory pass) — a full-array diff every tick over the whole run is too slow.
    if (world.step >= ck - 300) {
      const co = world._countryOwner, cf = world._ctrlOwner;
      if (prevCo && co) { const d = diffCount(prevCo, co); churnCo += d; if (d > maxCo) maxCo = d; }
      if (prevCf && cf) { const d = diffCount(prevCf, cf); churnCf += d; if (d > maxCf) maxCf = d; }
      prevCo = co ? co.slice() : null; prevCf = cf ? cf.slice() : null; ticks++;
    } else { prevCo = prevCf = null; }
  }
  const oy = row * (th + GAP);
  if (world._countryOwner) paint(rgb, 0, oy, sheetW, world._countryOwner);
  if (world._ctrlOwner) paint(rgb, panelW + GAP, oy, sheetW, world._ctrlOwner);
  // stats
  const stat = (arr) => { let claimed = 0, land = 0; const set = new Set(); for (let i = 0; i < N; i++) { if (!(elev[i] > 0)) continue; land++; if (arr && arr[i] >= 0) { claimed++; set.add(arr[i]); } } return { pct: (100 * claimed / land).toFixed(1), realms: set.size }; };
  const so = stat(world._countryOwner), sc = stat(world._ctrlOwner);
  console.log(`step ${ck}:  OLD recompute realms=${so.realms} claimed=${so.pct}%   |   NEW control-field realms=${sc.realms} claimed=${sc.pct}%`);
  row++;
}
console.log(`\nper-tick BORDER CHURN over ${ticks} ticks (tiles changed/tick):`);
console.log(`  OLD recompute : avg=${(churnCo / ticks).toFixed(1)}  max=${maxCo}   (batchy — spikes on the ~144-tick territory pass)`);
console.log(`  NEW ctrl-field: avg=${(churnCf / ticks).toFixed(1)}  max=${maxCf}   (continuous — a little every tick)`);

// PNG (24-bit)
const crcT = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc = b => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = crcT[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length, 0); const b = Buffer.concat([Buffer.from(t, "ascii"), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(b), 0); return Buffer.concat([l, b, c]); };
const ih = Buffer.alloc(13); ih.writeUInt32BE(sheetW, 0); ih.writeUInt32BE(sheetH, 4); ih[8] = 8; ih[9] = 2;
const stride = sheetW * 3 + 1, rawimg = Buffer.alloc(stride * sheetH);
for (let y = 0; y < sheetH; y++) { rawimg[y * stride] = 0; rgb.copy(rawimg, y * stride + 1, y * sheetW * 3, (y + 1) * sheetW * 3); }
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ih), chunk("IDAT", zlib.deflateSync(rawimg, { level: 6 })), chunk("IEND", Buffer.alloc(0))]);
writeFileSync(OUT, png);
console.log(`\nwrote ${OUT}  (${sheetW}x${sheetH}; rows=checkpoints, LEFT=old recompute, RIGHT=new control field)`);

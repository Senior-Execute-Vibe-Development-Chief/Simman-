// GeaCron-style frame capture: run the Earth sim and dump the political map
// as a PNG every EVERY steps, with a metrics line per frame (JSONL), so the
// whole arc can be flipped through like a historical atlas' time slider.
// Colors are stable per polity id across frames (the sim's id-hue convention).
//   SIM_TUNE="DAWN_LIVE=1" node tools/render_frames.mjs [steps] [W] [seed] [every] [outdir]
import zlib from "node:zlib";
import { writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { displayYear } from "../src/sim/calendar.js";

const STEPS = +(process.argv[2] || 45000);
const W = +(process.argv[3] || 960), H = W >> 1;
const SEED = +(process.argv[4] || 8817);
const EVERY = +(process.argv[5] || 3000);
const OUT = process.argv[6] || `/tmp/frames_w${W}_s${SEED}`;
mkdirSync(OUT, { recursive: true });

const crcT = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc = b => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = crcT[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
function png(w, h, rgb) { const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]); const ch = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length, 0); const b = Buffer.concat([Buffer.from(t, "ascii"), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(b), 0); return Buffer.concat([l, b, c]); }; const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2; const st = w * 3 + 1, raw = Buffer.alloc(st * h); for (let y = 0; y < h; y++) { raw[y * st] = 0; rgb.copy(raw, y * st + 1, y * w * 3, (y + 1) * w * 3); } return Buffer.concat([sig, ch("IHDR", ih), ch("IDAT", zlib.deflateSync(raw, { level: 6 })), ch("IEND", Buffer.alloc(0))]); }
function hsl(h, s, l) { const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2; const hh = h / 60; let r, g, b; if (hh < 1) [r, g, b] = [c, x, 0]; else if (hh < 2) [r, g, b] = [x, c, 0]; else if (hh < 3) [r, g, b] = [0, c, x]; else if (hh < 4) [r, g, b] = [0, x, c]; else if (hh < 5) [r, g, b] = [x, 0, c]; else [r, g, b] = [c, 0, x]; return [(r + m) * 255 | 0, (g + m) * 255 | 0, (b + m) * 255 | 0]; }

console.log(`[frames] W=${W} (tw=${W >> 1}) seed=${SEED} steps=${STEPS} every=${EVERY} -> ${OUT}`);
let t0 = performance.now();
const world = buildSim({ W, H, seed: SEED });
console.log(`[frames] build done in ${((performance.now() - t0) / 1000).toFixed(1)}s`);

let landN = 0;
for (let i = 0; i < world.N; i++) if (world.elev[i] > 0) landN++;
const km2PerTile = (510e6 * 0.29) / landN;

function frame(step) {
  const claim = world._countryClaim, tw = world.tw, th = world.th, elev = world.elev;
  const rgb = Buffer.alloc(tw * th * 3);
  const colByC = new Map();
  const tiles = new Map(); let claimed = 0;
  for (let ti = 0; ti < claim.length; ti++) {
    const cc = claim[ti]; let col;
    if (elev[ti] <= 0) col = [16, 28, 56];
    else if (cc < 0) col = [168, 158, 138];
    else {
      claimed++; tiles.set(cc, (tiles.get(cc) || 0) + 1);
      col = colByC.get(cc);
      if (!col) { col = hsl(((cc * 61) % 360 + 360) % 360, 0.62, 0.52); colByC.set(cc, col); }
    }
    const o = ti * 3; rgb[o] = col[0]; rgb[o + 1] = col[1]; rgb[o + 2] = col[2];
  }
  // darken borders (right/down neighbour differs)
  const dark = 0.35;
  for (let ty = 0; ty < th; ty++) for (let tx = 0; tx < tw; tx++) {
    const ti = ty * tw + tx; const cc = claim[ti]; if (cc < 0 || elev[ti] <= 0) continue;
    const ro = claim[ty * tw + ((tx + 1) % tw)], dn = ty < th - 1 ? claim[ti + tw] : cc;
    if ((ro >= 0 && ro !== cc) || (dn >= 0 && dn !== cc)) { const o = ti * 3; rgb[o] = rgb[o] * dark | 0; rgb[o + 1] = rgb[o + 1] * dark | 0; rgb[o + 2] = rgb[o + 2] * dark | 0; }
  }
  // capitals as bright dots
  if (world.countries) for (const [, c] of world.countries) {
    const cap = c.capital; if (!cap || cap.mode !== "settled") continue;
    const ti = (cap.ty | 0) * tw + (cap.tx | 0); if (ti >= 0 && ti < claim.length) { const o = ti * 3; rgb[o] = 255; rgb[o + 1] = 250; rgb[o + 2] = 240; }
  }
  const name = `${OUT}/step${String(step).padStart(6, "0")}.png`;
  writeFileSync(name, png(tw, th, rgb));
  // metrics
  const areas = [...tiles.values()].map(t => t * km2PerTile).sort((a, b) => b - a);
  const n = areas.length, tot = areas.reduce((a, b) => a + b, 0) || 1;
  const lns = areas.map(a => Math.log(a));
  const mean = lns.reduce((a, b) => a + b, 0) / (n || 1);
  const lnsd = n > 1 ? Math.sqrt(lns.reduce((a, b) => a + (b - mean) ** 2, 0) / n) : 0;
  // members: settled settlements per polity; polities with none = landed/tribal-only fabric
  const memberCount = new Map();
  let settledN = 0;
  for (const s of world.settlements) if (s.mode === "settled") { settledN++; if (s.countryId >= 0) memberCount.set(s.countryId, (memberCount.get(s.countryId) || 0) + 1); }
  let zeroMember = 0; for (const c of tiles.keys()) if (!memberCount.get(c)) zeroMember++;
  const rec = {
    step, year: Math.round(displayYear(step)), polities: n, settled: settledN,
    zeroMemberPolities: zeroMember, claimedPct: +(claimed * 100 / landN).toFixed(1),
    top1SharePct: +(areas[0] * 100 / tot).toFixed(1),
    top5km2: areas.slice(0, 5).map(a => Math.round(a / 1000) * 1000),
    medKm2: Math.round(areas[n >> 1] || 0), lnSigma: +lnsd.toFixed(2),
    wallMin: +((performance.now() - t0) / 60000).toFixed(1),
  };
  appendFileSync(`${OUT}/metrics.jsonl`, JSON.stringify(rec) + "\n");
  console.log(`[frames] ${name}  ${JSON.stringify(rec)}`);
}

for (let s = 1; s <= STEPS; s++) {
  stepPeopleSim(world, 1);
  if (s % EVERY === 0 || s === STEPS) frame(s);
}
console.log(`[frames] done in ${((performance.now() - t0) / 60000).toFixed(1)} min`);

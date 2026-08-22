// A/B/C the political map's PAINT SEMANTICS at one checkpoint:
//   A sovereign view — every polity its own color (the app's current convention)
//   B bloc view      — dependencies painted in their suzerain-root's color (the
//                      historical-atlas convention: satrapies paint as Persia)
//   C atlas view     — bloc view + polities with no settled city (tribal fabric)
//                      muted to a pale wash (atlases color STATES, not peoples)
// If C looks like history while A looks like confetti, the gap is paint, not politics.
//   SIM_TUNE="DAWN_LIVE=1" node tools/render_blocview.mjs [step] [W] [seed] [outdir]
import zlib from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";

const STEP = +(process.argv[2] || 24000);
const W = +(process.argv[3] || 960), H = W >> 1;
const SEED = +(process.argv[4] || 8817);
const OUT = process.argv[5] || "/tmp/blocview";
mkdirSync(OUT, { recursive: true });

const crcT = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc = b => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = crcT[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
function png(w, h, rgb) { const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]); const ch = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length, 0); const b = Buffer.concat([Buffer.from(t, "ascii"), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(b), 0); return Buffer.concat([l, b, c]); }; const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2; const st = w * 3 + 1, raw = Buffer.alloc(st * h); for (let y = 0; y < h; y++) { raw[y * st] = 0; rgb.copy(raw, y * st + 1, y * w * 3, (y + 1) * w * 3); } return Buffer.concat([sig, ch("IHDR", ih), ch("IDAT", zlib.deflateSync(raw, { level: 6 })), ch("IEND", Buffer.alloc(0))]); }
function hsl(h, s, l) { const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2; const hh = h / 60; let r, g, b; if (hh < 1) [r, g, b] = [c, x, 0]; else if (hh < 2) [r, g, b] = [x, c, 0]; else if (hh < 3) [r, g, b] = [0, c, x]; else if (hh < 4) [r, g, b] = [0, x, c]; else if (hh < 5) [r, g, b] = [x, 0, c]; else [r, g, b] = [c, 0, x]; return [(r + m) * 255 | 0, (g + m) * 255 | 0, (b + m) * 255 | 0]; }

console.log(`[blocview] W=${W} (tw=${W >> 1}) seed=${SEED} step=${STEP}`);
const world = buildSim({ W, H, seed: SEED });
for (let s = 1; s <= STEP; s++) stepPeopleSim(world, 1);

const claim = world._countryClaim, tw = world.tw, th = world.th, elev = world.elev;
// suzerain root: follow _overlord chains (cycle-guarded)
const root = new Map();
function rootOf(id) {
  if (root.has(id)) return root.get(id);
  let cur = id, hops = 0;
  while (hops++ < 16) {
    const p = world.polities && world.polities.get(cur);
    const over = p && p._overlord != null && p.endedStep < 0 ? p._overlord : null;
    if (over == null || over === cur) break;
    cur = over;
  }
  root.set(id, cur); return cur;
}
// settled member count per polity
const settledOf = new Map();
for (const s of world.settlements) if (s.mode === "settled" && s.countryId >= 0) settledOf.set(s.countryId, (settledOf.get(s.countryId) || 0) + 1);

let landN = 0; for (let i = 0; i < world.N; i++) if (elev[i] > 0) landN++;
const km2PerTile = (510e6 * 0.29) / landN;

function render(mode) {
  const rgb = Buffer.alloc(tw * th * 3);
  const colByC = new Map();
  const paintId = new Int32Array(tw * th).fill(-1);
  for (let ti = 0; ti < claim.length; ti++) {
    const cc = claim[ti]; let col;
    if (elev[ti] <= 0) col = [16, 28, 56];
    else if (cc < 0) col = [168, 158, 138];
    else {
      let pid = mode === "sovereign" ? cc : rootOf(cc);
      paintId[ti] = pid;
      const tribalFree = mode === "atlas" && !settledOf.get(pid) && rootOf(cc) === cc;
      if (tribalFree) col = [186, 174, 150];   // pale wash: peoples, not states
      else { col = colByC.get(pid); if (!col) { col = hsl(((pid * 61) % 360 + 360) % 360, 0.62, 0.52); colByC.set(pid, col); } }
    }
    const o = ti * 3; rgb[o] = col[0]; rgb[o + 1] = col[1]; rgb[o + 2] = col[2];
  }
  const dark = 0.35;
  for (let ty = 0; ty < th; ty++) for (let tx = 0; tx < tw; tx++) {
    const ti = ty * tw + tx; if (paintId[ti] < 0) continue;
    const ro = paintId[ty * tw + ((tx + 1) % tw)], dn = ty < th - 1 ? paintId[ti + tw] : paintId[ti];
    if ((ro >= 0 && ro !== paintId[ti]) || (dn >= 0 && dn !== paintId[ti])) { const o = ti * 3; rgb[o] = rgb[o] * dark | 0; rgb[o + 1] = rgb[o + 1] * dark | 0; rgb[o + 2] = rgb[o + 2] * dark | 0; }
  }
  const name = `${OUT}/step${STEP}_${mode}.png`;
  writeFileSync(name, png(tw, th, rgb));
  // stats: effective units + top share under this paint
  const tiles = new Map(); let claimed = 0;
  for (let ti = 0; ti < claim.length; ti++) { if (paintId[ti] < 0) continue; claimed++; tiles.set(paintId[ti], (tiles.get(paintId[ti]) || 0) + 1); }
  const areas = [...tiles.values()].sort((a, b) => b - a);
  const tot = areas.reduce((a, b) => a + b, 0) || 1;
  console.log(`[${mode}] units=${areas.length} top1=${(areas[0] * 100 / tot).toFixed(1)}% of claimed (${Math.round(areas[0] * km2PerTile / 1000) * 1000} km2) top5share=${(areas.slice(0, 5).reduce((a, b) => a + b, 0) * 100 / tot).toFixed(1)}%  ${name}`);
}
render("sovereign");
render("bloc");
render("atlas");

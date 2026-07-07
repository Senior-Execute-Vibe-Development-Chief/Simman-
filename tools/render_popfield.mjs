// Phase-1 population-field visualiser + validator (T.POP_FIELD).
//
// Runs the sim with the population field ON and renders world.popField as a heat
// map — the check that people MASS where civilisation actually did: dense river
// valleys and fertile belts, sparse deserts/tundra. Prints distribution stats so
// the shape is legible without eyeballing (share of people on the top-decile tiles,
// pop↔fertility rank correlation, empty-land fraction).
//   node tools/render_popfield.mjs [step] [seed] [W] [H]
import zlib from "node:zlib"; import { writeFileSync } from "node:fs";
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { popFieldTotal } from "../src/sim/peopleSim/popField.js";
import { T } from "../src/sim/peopleSim/tuning.js";

T.POP_FIELD = 1;   // the point of this probe
const STEP = +(process.argv[2] || 12000), SEED = +(process.argv[3] || 8817), W = +(process.argv[4] || 480), H = +(process.argv[5] || 240);

const crcT = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc = b => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = crcT[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
function png(w, h, rgb) { const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]); const ch = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length, 0); const b = Buffer.concat([Buffer.from(t, "ascii"), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(b), 0); return Buffer.concat([l, b, c]); }; const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2; const st = w * 3 + 1, raw = Buffer.alloc(st * h); for (let y = 0; y < h; y++) { raw[y * st] = 0; rgb.copy(raw, y * st + 1, y * w * 3, (y + 1) * w * 3); } return Buffer.concat([sig, ch("IHDR", ih), ch("IDAT", zlib.deflateSync(raw, { level: 6 })), ch("IEND", Buffer.alloc(0))]); }
// heat ramp 0→1: dark → blue → cyan → green → yellow → red-white
function heat(t) {
  t = Math.max(0, Math.min(1, t));
  const stops = [[10, 12, 32], [30, 60, 170], [30, 170, 190], [70, 200, 70], [235, 220, 60], [250, 250, 235]];
  const x = t * (stops.length - 1), i = Math.min(stops.length - 2, x | 0), f = x - i;
  const a = stops[i], b = stops[i + 1];
  return [a[0] + (b[0] - a[0]) * f | 0, a[1] + (b[1] - a[1]) * f | 0, a[2] + (b[2] - a[2]) * f | 0];
}

const world = buildSim({ W, H, seed: SEED });
for (let s = 1; s <= STEP; s++) stepPeopleSim(world, 1);

const { popField: pop, capField: cap, elev, fert, tw, th } = world;
if (!pop) { console.error("popField absent — T.POP_FIELD not on?"); process.exit(1); }

// Normalise to the 99th-percentile tile so a single hotspot doesn't wash the ramp out.
const land = [];
for (let i = 0; i < pop.length; i++) if (elev[i] > 0 && pop[i] > 0) land.push(pop[i]);
land.sort((a, b) => a - b);
const p99 = land.length ? land[Math.min(land.length - 1, (land.length * 0.99) | 0)] : 1;
const norm = v => Math.pow(Math.max(0, v) / (p99 || 1), 0.5);   // sqrt for legible low end

const SC = 2, OW = tw * SC, OH = th * SC, rgb = Buffer.alloc(OW * OH * 3);
for (let ti = 0; ti < pop.length; ti++) {
  const py = (ti / tw) | 0, px = ti - py * tw;
  let col;
  if (elev[ti] <= 0) col = [8, 14, 28];                    // sea
  else if (pop[ti] <= 0) col = [40, 40, 44];               // empty land
  else col = heat(norm(pop[ti]));
  for (let dy = 0; dy < SC; dy++) for (let dx = 0; dx < SC; dx++) { const o = ((py * SC + dy) * OW + (px * SC + dx)) * 3; rgb[o] = col[0]; rgb[o + 1] = col[1]; rgb[o + 2] = col[2]; }
}
const out = `/tmp/popfield_${STEP}_${SEED}.png`;
writeFileSync(out, png(OW, OH, rgb));

// ── stats ────────────────────────────────────────────────────────────────
let landTiles = 0, peopled = 0;
for (let i = 0; i < pop.length; i++) { if (elev[i] > 0) { landTiles++; if (pop[i] > 0.01) peopled++; } }
const total = popFieldTotal(world);
// top-decile concentration: share of all people on the densest 10% of land tiles
const dens = land.slice().sort((a, b) => b - a);
const topN = Math.max(1, (dens.length * 0.1) | 0);
let topSum = 0; for (let i = 0; i < topN; i++) topSum += dens[i];
const totLand = dens.reduce((a, b) => a + b, 0);
// pop↔fertility Spearman-ish: over peopled land, does higher fert ⇒ more people?
const pairs = [];
for (let i = 0; i < pop.length; i++) if (elev[i] > 0 && pop[i] > 0.01) pairs.push([fert[i], pop[i]]);
function rank(arr, key) { const idx = arr.map((_, i) => i).sort((a, b) => key(arr[a]) - key(arr[b])); const r = new Array(arr.length); for (let i = 0; i < idx.length; i++) r[idx[i]] = i; return r; }
const rf = rank(pairs, p => p[0]), rp = rank(pairs, p => p[1]);
let sd = 0; for (let i = 0; i < pairs.length; i++) { const d = rf[i] - rp[i]; sd += d * d; }
const n = pairs.length || 1, rho = n > 1 ? 1 - (6 * sd) / (n * (n * n - 1)) : 0;

console.log(`[png] ${out}`);
console.log(`step ${STEP} seed ${SEED} ${W}×${H}`);
console.log(`  field pop total   ${total.toFixed(0)} sim-units (${(total / 1000).toFixed(1)}M people @1000×)`);
console.log(`  land tiles        ${landTiles}  peopled ${peopled} (${(100 * peopled / landTiles).toFixed(0)}%)  empty ${(100 * (1 - peopled / landTiles)).toFixed(0)}%`);
console.log(`  top-decile share  ${(100 * topSum / (totLand || 1)).toFixed(0)}%  (people on the densest 10% of land)`);
console.log(`  pop↔fert rank ρ    ${rho.toFixed(3)}  (1 = people track fertility perfectly)`);

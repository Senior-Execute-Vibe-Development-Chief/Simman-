// Measure the CURRENT engine's colour economy + composition load, over the same
// heraldic-flag space the rating tool samples. Evidence for docs/flag-design-
// principles.md — so the "engine aligns / diverges" claims are numbers, not vibes.
//   node tools/measure-colour-economy.mjs [N]
import { foundGenome, expressGenome, POOLS } from "../src/sim/emblemGenome.js";

const N = +(process.argv[2] || 8000);
const HERALDIC = (POOLS.FLAG_COMPOSITIONS.indexOf("heraldic") + 0.5) / POOLS.FLAG_COMPOSITIONS.length;
const AXES = { saturation: 0.85, format: 0.35 };
const PIN = { composition: HERALDIC, paletteMode: 0.1, substrate: 0.25 };
const IDX = {}; POOLS && null;
// gene index map (mirror the engine's IDX) — read from a founded genome's order
import { GENES } from "../src/sim/emblemGenome.js";
GENES.forEach((g, i) => (IDX[g] = i));

const flagOK = p => p.isFlag && p.composition === "heraldic" && !p.field.fur;
function nextFlag(seed) {
  let s = seed >>> 0, g;
  for (let i = 0; i < 80; i++) {
    g = foundGenome(s, AXES);
    for (const k in PIN) g.genes[IDX[k]] = PIN[k];
    const p = expressGenome(g);
    if (flagOK(p)) return p;
    s = (s * 1664525 + 1013904223) >>> 0;
  }
  return expressGenome(g);
}

// distinct visible tinctures, by name where the phenotype exposes one
function colourNames(p) {
  const f = p.field, m = p.motif, o = p.ornaments;
  const s = new Set();
  (f.names || []).forEach(n => s.add(n));
  if (f.rays) return { n: f.rays.count, rays: true };   // fan flags: count = rays
  if (f.subName) s.add(f.subName);
  if (f.saltireOverlay) s.add(f.saltireOverlay.name);
  if (f.hoist) { s.add(f.hoist.name); if (f.hoist.device) s.add(f.hoist.device.tinctureName); }
  if (m) { s.add(m.tinctureName); if (m.fimbName) s.add(m.fimbName); if (m.panel) s.add(m.panel.name); }
  if (o.canton) s.add(o.cantonName);
  s.delete(undefined);
  return { n: s.size, rays: false };
}

// how many INDEPENDENT decorative features stack on one flag (NAVA simplicity)
function load(p) {
  const f = p.field, m = p.motif, o = p.ornaments;
  let k = 0;
  if (f.partition && f.partition !== "plain") k++;
  if (f.ordinary && f.ordinary !== "none") k++;
  if (m) k++;
  if (o.canton) k++;
  if (f.seamFimbriation) k++;
  if (f.bordure) k++;
  if (f.hoist) k++;
  if (f.saltireOverlay) k++;
  if (f.counterchange) k++;
  return k;
}

const col = {}, ld = {}, part = {}, ord = {}; let rays = 0, hasDevice = 0;
for (let i = 0; i < N; i++) {
  const p = nextFlag((i * 2654435761) >>> 0);
  const c = colourNames(p);
  if (c.rays) rays++;
  col[c.n] = (col[c.n] || 0) + 1;
  const L = load(p); ld[L] = (ld[L] || 0) + 1;
  part[p.field.partition] = (part[p.field.partition] || 0) + 1;
  const o = p.field.ordinary || "none"; ord[o] = (ord[o] || 0) + 1;
  if (p.motif) hasDevice++;
}
const pct = (x) => (100 * x / N).toFixed(1) + "%";
const dist = (obj) => Object.entries(obj).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${pct(v)}`).join("  ");
const meanCol = Object.entries(col).reduce((a, [k, v]) => a + +k * v, 0) / N;

console.log(`sample: ${N} heraldic flags\n`);
console.log(`distinct colours   mean ${meanCol.toFixed(2)}   ${dist(col)}`);
console.log(`  (rays flags counted by ray-count: ${pct(rays)} of sample)`);
console.log(`\ndecorative load    ${dist(ld)}`);
console.log(`  0 = bare/striped field · higher = more features stacked`);
console.log(`\ncarries a device   ${pct(hasDevice)}`);
console.log(`\npartition mix      ${dist(part)}`);
console.log(`\nordinary mix       ${dist(ord)}`);

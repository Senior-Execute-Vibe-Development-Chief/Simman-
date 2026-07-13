// Preview the emblem GENOME (src/sim/emblemGenome.js): express any genome flat
// across traditions, and show it EVOLVING. Two sheets:
//   node tools/render_emblems.mjs evolve   → lineages drifting + a marshalling cross
//   node tools/render_emblems.mjs range    → one genome space, many traditions
// (default: both, stacked)
//
// All drawing lives in src/sim/emblemRender.js — this file is only the demo layout.
import { writeFileSync } from "node:fs";
import { foundGenome, inheritGenome, crossGenome, describeGenome } from "../src/sim/emblemGenome.js";
import { drawEmblem } from "../src/sim/emblemRender.js";

const MODE = process.argv[2] || "both";
const OUT = process.argv[3] || "/tmp/claude-0/-home-user-Simman-/0dce9194-9863-5d0c-9a8a-3f95cac87b93/scratchpad/emblems.svg";
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");

// ── build sheets ──
const CELL = 150, GAP = 8, PAD = 26;
let sections = [];

if (MODE === "evolve" || MODE === "both") {
  sections.push({ head: "A lineage evolving — founder, then five generations of drift" });
  const founders = [
    ["House Vermeil", { figuration: 0.92, boldness: 0.7, hue: 0.02 }, 1011],
    ["The Grey Compact", { figuration: 0.2, saturation: 0.18, hue: 0.6 }, 2027],
    ["Sunreach", { figuration: 0.6, symmetry: 0.85, tone: 0.82, hue: 0.13 }, 3041],
  ];
  for (const [name, ax, seed] of founders) {
    const chain = [foundGenome(seed, ax)];
    for (let i = 1; i <= 5; i++) chain.push(inheritGenome(chain[i - 1], (seed * 31 + i * 7) >>> 0));
    sections.push({ row: chain, name });
  }
  // marshalling: unions ACCUMULATE quarterings across generations
  const a = foundGenome(1011, { figuration: 0.92, boldness: 0.7, hue: 0.02 });
  const b = foundGenome(4059, { figuration: 0.85, saturation: 0.7, hue: 0.55 });
  const ab = crossGenome(a, b, 777);
  const c = foundGenome(8123, { figuration: 0.7, saturation: 0.6, hue: 0.33 });
  const abc = crossGenome(ab, c, 888);
  sections.push({ row: [a, b, ab, c, abc], name: "Unions accumulate quarterings", labels: ["house A", "house B", "A⊕B (quarterly)", "house C", "(A⊕B)⊕C — three coats"] });
}

if (MODE === "range" || MODE === "both") {
  sections.push({ head: "One abstract style-space — every pattern reachable by any realm, no cultural label" });
  const presets = [
    ["Figured · ornate", { figuration: 0.9, ornateness: 0.8, hue: 0.02 }],
    ["Abstract · muted", { figuration: 0.1, saturation: 0.15, hue: 0.6 }],
    ["Bold · vivid", { figuration: 0.82, boldness: 0.95, saturation: 0.9, hue: 0.08 }],
    ["Minimal · badge", { figuration: 0.5, ornateness: 0.1, format: 0.42, hue: 0.13 }],
    ["Symmetric · light", { figuration: 0.6, symmetry: 0.9, tone: 0.85, hue: 0.55 }],
    ["Dark · spare", { figuration: 0.4, tone: 0.1, saturation: 0.3, hue: 0.0 }],
    ["Vivid · banner", { figuration: 0.72, format: 0.2, saturation: 0.85, hue: 0.45 }],
    ["Muted · plain", { figuration: 0.22, saturation: 0.2, ornateness: 0.2, hue: 0.13 }],
  ];
  const row = [];
  presets.forEach(([nm, ax], i) => row.push({ g: foundGenome(5000 + i * 101, ax), nm }));
  for (let i = 0; i < 4; i++) row.push({ g: foundGenome(9001 + i * 313, {}), nm: "(random)" });
  sections.push({ grid: row });
}

// ── lay out ──
const COLS = 8;
let W = COLS * (CELL + GAP) + PAD * 2, yCur = PAD + 30, body = "";
for (const sec of sections) {
  if (sec.head) { body += `<text x="${PAD}" y="${yCur}" font-family="Georgia,serif" font-size="17" fill="#e8e2d4">${esc(sec.head)}</text>`; yCur += 16; continue; }
  if (sec.row) {
    yCur += 8;
    body += `<text x="${PAD}" y="${yCur}" font-family="sans-serif" font-size="11.5" fill="#b9b2a6">${esc(sec.name)}</text>`; yCur += 8;
    sec.row.forEach((g, i) => {
      const x = PAD + i * (CELL + GAP);
      body += drawEmblem(g, x, yCur, CELL, CELL);
      const lab = sec.labels ? sec.labels[i] : "gen " + (g.gen || 0);
      body += `<text x="${x + CELL / 2}" y="${yCur + CELL + 13}" text-anchor="middle" font-family="sans-serif" font-size="9.5" fill="#8f8a7e">${esc(lab)}</text>`;
    });
    yCur += CELL + 26;
  }
  if (sec.grid) {
    yCur += 8;
    sec.grid.forEach((it, i) => {
      const col = i % COLS, r = (i / COLS) | 0;
      const x = PAD + col * (CELL + GAP), y = yCur + r * (CELL + 34);
      body += drawEmblem(it.g, x, y, CELL, CELL);
      body += `<text x="${x + CELL / 2}" y="${y + CELL + 12}" text-anchor="middle" font-family="sans-serif" font-size="10" font-weight="bold" fill="#ddd">${esc(it.nm)}</text>`;
      body += `<text x="${x + CELL / 2}" y="${y + CELL + 25}" text-anchor="middle" font-family="sans-serif" font-size="8" fill="#8f8a7e">${esc(describeGenome(it.g))}</text>`;
    });
    yCur += Math.ceil(sec.grid.length / COLS) * (CELL + 34) + 6;
  }
}
const H = yCur + PAD;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`
  + `<rect width="${W}" height="${H}" fill="#1b1e26"/>`
  + `<text x="${PAD}" y="${PAD + 4}" font-family="Georgia,serif" font-size="21" fill="#e8e2d4">The emblem genome — one genetics for every tradition, evolving</text>`
  + body + `</svg>`;
writeFileSync(OUT, svg);
console.log(`[svg] ${OUT} (${W}×${H})`);

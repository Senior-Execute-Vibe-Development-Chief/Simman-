// Build the self-contained Flag Rating tool by inlining the REAL engine
// (src/sim/emblemGenome.js + emblemRender.js) plus the size-capped charge art
// into tools/rating_template.html — same approach as build_lab.mjs, so a rated
// flag is rendered by the exact code the sim uses.
//
//   node tools/build_rating.mjs [out.html]
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = process.argv[2] || join(ROOT, "tools", "flag-rating.html");
const CAP = 40 * 1024;
const read = p => readFileSync(join(ROOT, p), "utf8");
const stripModule = s => s
  .replace(/^\s*import\b[^\n]*\n/gm, "")
  .replace(/^\s*export\s*\{[^}]*\};?\s*$/gm, "")
  .replace(/^export\s+(function|const|let|class|async)\b/gm, "$1");

const { CHARGE_DETAIL } = await import("../src/sim/heraldryChargesDetailed.js");
const { MOTIFS } = await import("../src/sim/emblemGenome.js");
const { PRIMITIVES } = await import("../src/sim/emblemRender.js");

const filtered = {}, keep = new Set();
for (const [cat, pool] of Object.entries(MOTIFS)) {
  const kept = pool.filter(id => PRIMITIVES[id] || (CHARGE_DETAIL[id] && CHARGE_DETAIL[id].body.length <= CAP));
  filtered[cat] = kept;
  kept.forEach(id => { if (!PRIMITIVES[id]) keep.add(id); });
}
const subset = {};
for (const id of [...keep].sort()) subset[id] = CHARGE_DETAIL[id];

const genomeSrc = stripModule(read("src/sim/emblemGenome.js"))
  .replace(/\/\/ @INJECT:MOTIFS-START[\s\S]*?\/\/ @INJECT:MOTIFS-END/, `const MOTIFS = ${JSON.stringify(filtered)};`);
const renderSrc = stripModule(read("src/sim/emblemRender.js"));
const chargeLiteral = JSON.stringify(subset);

let html = read("tools/rating_template.html")
  .replace("__CHARGE_DETAIL__", chargeLiteral)
  .replace("__EMBLEM_GENOME__", genomeSrc)
  .replace("__EMBLEM_RENDER__", renderSrc);
for (const ph of ["__CHARGE_DETAIL__", "__EMBLEM_GENOME__", "__EMBLEM_RENDER__"])
  if (html.includes(ph)) throw new Error("placeholder left unfilled: " + ph);

writeFileSync(OUT, html);
console.log(`charges: ${keep.size}  pools: ${Object.entries(filtered).map(([c, p]) => `${c}:${p.length}`).join(" ")}`);
console.log(`wrote ${OUT}  (${(html.length / 1024) | 0}KB)`);

// Build the interactive Emblem Genome lab (a self-contained HTML artifact) by
// INLINING the real source modules — src/sim/emblemGenome.js and
// src/sim/emblemRender.js — into tools/lab_template.html, alongside a size-filtered
// slice of the charge art. Nothing is hand-ported: the lab renders with the exact
// same code as the sim and the preview tools.
//
//   node tools/build_lab.mjs [out.html] [template.html]
// (template defaults to tools/lab_template.html; pass another to build a different
//  self-contained page around the SAME inlined engine — e.g. the flag studio.)
//
// Browsers can't ES-import, so we strip import/export and replace the genome's
// MOTIFS block (marked @INJECT:MOTIFS) with a subset restricted to the charges that
// fit under the artifact size cap — so a gene can never pick a charge with no art.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = process.argv[2] || join(ROOT, "tools", "emblem-genome-lab.html");
const TEMPLATE = process.argv[3] || "tools/lab_template.html";
const CAP = 40 * 1024;   // per-charge body-byte cap: keeps the artifact light

const read = p => readFileSync(join(ROOT, p), "utf8");

// strip ES module syntax so the source can be inlined as a plain <script>
const stripModule = s => s
  .replace(/^\s*import\b[^\n]*\n/gm, "")
  .replace(/^\s*export\s*\{[^}]*\};?\s*$/gm, "")
  .replace(/^export\s+(function|const|let|class|async)\b/gm, "$1");

// ── charge art + motif pools, from the built module + the genome's MOTIFS ──
// Vector PRIMITIVES (parametric paths inlined with the renderer) need no
// bundled art, so they always stay in the pools and never count against CAP.
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
let bytes = 0;
for (const id of [...keep].sort()) { subset[id] = CHARGE_DETAIL[id]; bytes += CHARGE_DETAIL[id].body.length; }
const dropped = Object.values(MOTIFS).flat().filter(id => !keep.has(id) && !PRIMITIVES[id]);

// ── inline the genome (MOTIFS swapped for the subset) and the renderer ──
let genomeSrc = stripModule(read("src/sim/emblemGenome.js"))
  .replace(/\/\/ @INJECT:MOTIFS-START[\s\S]*?\/\/ @INJECT:MOTIFS-END/,
    `const MOTIFS = ${JSON.stringify(filtered)};`);
const renderSrc = stripModule(read("src/sim/emblemRender.js"));

const chargeLiteral = "{\n" + Object.entries(subset).map(([id, e]) => `  ${JSON.stringify(id)}: ${JSON.stringify(e)}`).join(",\n") + "\n}";

let html = read(TEMPLATE)
  .replace("__CHARGE_DETAIL__", chargeLiteral)
  .replace("__EMBLEM_GENOME__", genomeSrc)
  .replace("__EMBLEM_RENDER__", renderSrc);
for (const ph of ["__CHARGE_DETAIL__", "__EMBLEM_GENOME__", "__EMBLEM_RENDER__"])
  if (html.includes(ph)) throw new Error("placeholder left unfilled: " + ph);

writeFileSync(OUT, html);
console.log(`charges: ${keep.size}/${Object.values(MOTIFS).flat().length}  (${(bytes / 1024) | 0}KB art)`);
console.log("pools:", Object.entries(filtered).map(([c, p]) => `${c}:${p.length}`).join(" "));
if (dropped.length) console.log("dropped (over cap):", dropped.join(" "));
console.log(`wrote ${OUT}  (${(html.length / 1024) | 0}KB)`);

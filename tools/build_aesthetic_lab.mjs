// Build the interactive Aesthetic Identity lab — inlines the real sim modules
// (peopleStyle, styleTaste, aestheticIdentity, aestheticRender, lineageGenetics)
// into tools/aesthetic_lab_template.html. Same pattern as build_lab.mjs.
//
//   node tools/build_aesthetic_lab.mjs [out.html]
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = process.argv[2] || join(ROOT, "tools", "aesthetic-identity-lab.html");

const read = p => readFileSync(join(ROOT, p), "utf8");

const stripModule = s => s
  .replace(/^\s*import\b[^\n]*\n/gm, "")
  .replace(/^\s*export\s*\{[^}]*\}\s*from\b[^\n]*\n/gm, "")
  .replace(/^\s*export\s*\{[^}]*\};?\s*$/gm, "")
  .replace(/^export\s+(function|const|let|class|async)\b/gm, "$1");

const hash32Src = read("src/sim/peopleSim/rng.js")
  .match(/export function hash32[\s\S]*?^}/m)[0]
  .replace(/^export /, "");

const modules = [
  ["__HASH32__", hash32Src],
  ["__LINEAGE_GENETICS__", stripModule(read("src/sim/lineageGenetics.js"))],
  ["__PEOPLE_STYLE__", stripModule(read("src/sim/peopleStyle.js"))],
  ["__STYLE_TASTE__", stripModule(read("src/sim/styleTaste.js"))],
  ["__AESTHETIC_IDENTITY__", stripModule(read("src/sim/aestheticIdentity.js"))],
  ["__AESTHETIC_RENDER__", stripModule(read("src/sim/aestheticRender.js"))],
];

let html = read("tools/aesthetic_lab_template.html");
for (const [ph, src] of modules) {
  if (!html.includes(ph)) throw new Error("placeholder missing: " + ph);
  html = html.replace(ph, src);
}
for (const [ph] of modules) {
  if (html.includes(ph)) throw new Error("placeholder left unfilled: " + ph);
}

writeFileSync(OUT, html);
console.log(`wrote ${OUT}  (${(html.length / 1024) | 0}KB)`);

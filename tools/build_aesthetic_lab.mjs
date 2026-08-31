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
  .replace(/^\s*import\s+(?:\{[\s\S]*?\}|[^;\n]+)\s+from\s+['"][^'"]+['"];?\s*\n/gm, "")
  .replace(/^\s*import\b[^\n]*\n/gm, "")
  .replace(/^\s*export\s*\{[^}]*\}\s*from\b[^\n]*\n/gm, "")
  .replace(/^\s*export\s*\{[\s\S]*?\}\s*from\b[^\n]*\n/gm, "")
  .replace(/^\s*export\s*\{[^}]*\};?\s*$/gm, "")
  .replace(/^export\s+(function|const|let|class|async)\b/gm, "$1");

/** Drop duplicate top-level helpers when concatenating modules into one script. */
function stripDuplicateDefs(src) {
  return src
    .replace(/^function clamp01\([^)]*\)\s*\{[^}]*\}\s*\n/m, "")
    .replace(/^const clamp01\s*=[^;]+;\s*\n/m, "")
    .replace(/^function prng\([^)]*\)\s*\{[\s\S]*?^}\s*\n/m, "")
    .replace(/^const wrap01\s*=[^;]+;\s*\n/m, "")
    .replace(/^function bell\([^)]*\)\s*\{[^}]*\}\s*\n/m, "");
}

const hash32Src = read("src/sim/peopleSim/rng.js")
  .match(/export function hash32[\s\S]*?^}/m)[0]
  .replace(/^export /, "");

const rawModules = [
  ["__HASH32__", hash32Src, false],
  ["__LINEAGE_GENETICS__", stripModule(read("src/sim/lineageGenetics.js")), false],
  ["__PEOPLE_STYLE__", stripModule(read("src/sim/peopleStyle.js")), false],
  ["__STYLE_TASTE__", stripModule(read("src/sim/styleTaste.js")), true],
  ["__AESTHETIC_IDENTITY__", stripModule(read("src/sim/aestheticIdentity.js")), true],
  ["__AESTHETIC_RENDER__", stripModule(read("src/sim/aestheticRender.js")), true],
];

let html = read("tools/aesthetic_lab_template.html");
for (const [ph, src, dedupe] of rawModules) {
  if (!html.includes(ph)) throw new Error("placeholder missing: " + ph);
  html = html.replace(ph, dedupe ? stripDuplicateDefs(src) : src);
}
for (const [ph] of rawModules) {
  if (html.includes(ph)) throw new Error("placeholder left unfilled: " + ph);
}

// Verify the inlined script parses (catches duplicate declarations before ship).
const script = html.match(/<script>([\s\S]*)<\/script>/)[1];
try { new Function(script); }
catch (e) {
  writeFileSync(OUT + ".debug.js", script);
  throw new Error("lab script parse error: " + e.message + " (wrote " + OUT + ".debug.js)");
}

writeFileSync(OUT, html);
console.log(`wrote ${OUT}  (${(html.length / 1024) | 0}KB)`);

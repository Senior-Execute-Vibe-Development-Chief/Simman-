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

/** Helpers that appear in multiple inlined modules — keep the first, drop later copies. */
const DEDUPE_DEFS = [
  { name: "clamp01", patterns: [
    /^function clamp01\([^)]*\)\s*\{[^}]*\}\s*\n/m,
    /^const clamp01\s*=[^;]+;\s*\n/m,
  ]},
  { name: "prng", patterns: [/^function prng\([^)]*\)\s*\{[\s\S]*?^}\s*\n/m] },
  { name: "wrap01", patterns: [/^const wrap01\s*=[^;]+;\s*\n/m] },
  { name: "bell", patterns: [/^function bell\([^)]*\)\s*\{[^}]*\}\s*\n/m] },
];

function stripSeenDefs(src, seen) {
  let out = src;
  for (const { name, patterns } of DEDUPE_DEFS) {
    if (seen.has(name)) {
      for (const pat of patterns) out = out.replace(pat, "");
    } else {
      for (const pat of patterns) {
        if (pat.test(src)) { seen.add(name); break; }
      }
    }
  }
  return out;
}

const hash32Src = read("src/sim/peopleSim/rng.js")
  .match(/export function hash32[\s\S]*?^}/m)[0]
  .replace(/^export /, "");

const rawModules = [
  ["__HASH32__", hash32Src],
  ["__LINEAGE_GENETICS__", stripModule(read("src/sim/lineageGenetics.js"))],
  ["__PEOPLE_STYLE__", stripModule(read("src/sim/peopleStyle.js"))],
  ["__STYLE_TASTE__", stripModule(read("src/sim/styleTaste.js"))],
  ["__AESTHETIC_IDENTITY__", stripModule(read("src/sim/aestheticIdentity.js"))],
  ["__AESTHETIC_RENDER__", stripModule(read("src/sim/aestheticRender.js"))],
];

const seen = new Set();
let html = read("tools/aesthetic_lab_template.html");
for (const [ph, src] of rawModules) {
  if (!html.includes(ph)) throw new Error("placeholder missing: " + ph);
  html = html.replace(ph, stripSeenDefs(src, seen));
}
for (const [ph] of rawModules) {
  if (html.includes(ph)) throw new Error("placeholder left unfilled: " + ph);
}

const script = html.match(/<script>([\s\S]*)<\/script>/)[1];
try { new Function(script); }
catch (e) {
  writeFileSync(OUT + ".debug.js", script);
  throw new Error("lab script parse error: " + e.message + " (wrote " + OUT + ".debug.js)");
}

writeFileSync(OUT, html);
console.log(`wrote ${OUT}  (${(html.length / 1024) | 0}KB)`);

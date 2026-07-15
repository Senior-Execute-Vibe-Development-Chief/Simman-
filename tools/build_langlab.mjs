// Build the Language Lab into a single self-contained HTML file by BUNDLING the
// real source (src/langLab.js and its whole module graph — phonology, phonetics,
// script, history, grammar, and the articulatory vocal tract) with esbuild.
// Nothing is hand-ported: the page runs the exact same code as `npm run dev`
// serves at /langlab.html, just inlined so it opens anywhere with no server and
// no network — the shareable "language gen artifact".
//
//   node tools/build_langlab.mjs [out.html]          # full standalone page
//   node tools/build_langlab.mjs --artifact [out]    # body-only (for a hosted
//                                                    #   Artifact that supplies
//                                                    #   its own <head>/<body>)
//
// The Lab is deliberately outside the production Vite build (which bundles only
// index.html), so this is its own tiny bundler. Web Audio (the two voices) works
// straight from the file; the DSP is pure and needs no assets.
import { build } from "esbuild";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const artifactMode = args.includes("--artifact");
const OUT = args.filter(a => a !== "--artifact")[0] || join(ROOT, "tools", "langlab.html");

// bundle langLab.js → one IIFE, minified, with the build label esbuild --define
const result = await build({
  entryPoints: [join(ROOT, "src", "langLab.js")],
  bundle: true,
  format: "iife",
  minify: true,
  define: { __BUILD__: '"artifact"' },
  write: false,
  logLevel: "silent",
});
// guard the inline <script> against any literal close-tag in the bundle
const js = result.outputFiles[0].text.split("</script").join("<\\/script");

// the app builds its own DOM + injects its own <style> on load (mount()), so the
// page body is just a mount point and the script; a full page adds <head> chrome
const body = `<div id="app"></div>
<noscript>This procedural language generator needs JavaScript enabled.</noscript>
<script>${js}</script>`;

const html = artifactMode ? body : `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Simman Language Lab</title>
</head>
<body>
${body}
</body>
</html>`;

writeFileSync(OUT, html);
console.log(`wrote ${OUT}  (${(html.length / 1024) | 0}KB, ${artifactMode ? "artifact body" : "standalone"})`);

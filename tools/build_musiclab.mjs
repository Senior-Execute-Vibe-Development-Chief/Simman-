// Build the Music Lab into a single self-contained HTML file by BUNDLING the
// real source (src/musicLab.js and its whole module graph — the instrument
// physics, the roughness-derived tuning, the composer, the synth, and the
// language modules it reads rhythm and sung text from) with esbuild.
// Nothing is hand-ported: the page runs the exact same code as `npm run dev`
// serves at /musiclab.html, just inlined so it opens anywhere with no server
// and no network — the shareable "music gen artifact".
//
//   node tools/build_musiclab.mjs [out.html]        # full standalone page
//   node tools/build_musiclab.mjs --artifact [out]  # body-only (for a hosted
//                                                   #   Artifact that supplies
//                                                   #   its own <head>/<body>)
//
// The Lab is deliberately outside the production Vite build (which bundles
// only index.html), so this is its own tiny bundler. There are no assets to
// inline: every sound is synthesised from the instrument models at play time,
// so the page needs nothing but itself.
import { build } from "esbuild";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { execSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const artifactMode = args.includes("--artifact");
const OUT = args.filter(a => a !== "--artifact")[0] || join(ROOT, "tools", "musiclab.html");

let label = "artifact";
try { label = execSync("git rev-parse --short HEAD", { cwd: ROOT }).toString().trim(); } catch { /* not a checkout */ }

const result = await build({
  entryPoints: [join(ROOT, "src", "musicLab.js")],
  bundle: true,
  format: "iife",
  minify: true,
  define: { __BUILD__: JSON.stringify(label) },
  write: false,
  logLevel: "silent",
});
// guard the inline <script> against any literal close-tag in the bundle
const js = result.outputFiles[0].text.split("</script").join("<\\/script");

// the app builds its own DOM and injects its own <style> on load (mount()),
// so the page body is just a mount point and the script
const body = `<div id="app"></div>
<noscript>This procedural music generator needs JavaScript enabled.</noscript>
<script>${js}</script>`;

const html = artifactMode ? body : `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Simman Music Lab</title>
</head>
<body>
${body}
</body>
</html>`;

writeFileSync(OUT, html);
console.log(`wrote ${OUT}  (${(html.length / 1024) | 0}KB, ${artifactMode ? "artifact body" : "standalone"})`);

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
// only index.html), so this is its own tiny bundler.
//
// It inlines ONE asset: the recorded instrument bank in assets/instr-audio,
// base64'd into a `window.__SAMPLE_DATA__` map ahead of the bundle. The page
// still needs nothing but itself and still makes no network request — the
// samples travel inside it. `--no-samples` leaves them out, which drops the
// page from megabytes to kilobytes and leaves every family on the synthesis it
// already had; the Lab treats a missing bank as a fallback, never an error.
import { build } from "esbuild";
import { writeFileSync, readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { execSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const artifactMode = args.includes("--artifact");
const withSamples = !args.includes("--no-samples");
const OUT = args.filter(a => !a.startsWith("--"))[0] || join(ROOT, "tools", "musiclab.html");

// the recorded bank, base64'd. Emitted as its own <script> before the bundle so
// it is plain data the app finds on `window`, rather than something esbuild has
// to carry through the module graph.
let bankTag = "", bankBytes = 0, bankFiles = 0;
const BANK_DIR = join(ROOT, "assets", "instr-audio");
if (withSamples && existsSync(BANK_DIR)) {
  const parts = [];
  for (const f of readdirSync(BANK_DIR).sort()) {
    if (!f.endsWith(".mp3")) continue;
    const b = readFileSync(join(BANK_DIR, f));
    bankBytes += b.length; bankFiles++;
    parts.push(JSON.stringify(f) + ":" + JSON.stringify(b.toString("base64")));
  }
  if (parts.length) bankTag = `<script>window.__SAMPLE_DATA__={${parts.join(",")}};</script>\n`;
}

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
${bankTag}<script>${js}</script>`;

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
console.log(`wrote ${OUT}  (${(html.length / 1048576).toFixed(2)}MB, ${artifactMode ? "artifact body" : "standalone"})`);
console.log(bankFiles
  ? `  recorded bank: ${bankFiles} samples, ${(bankBytes / 1048576).toFixed(2)}MB inlined`
  : "  recorded bank: none inlined — synthesis only");

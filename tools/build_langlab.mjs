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
//   node tools/build_langlab.mjs --audio [out.html]  # also inline the recorded
//                                                    #   phone bank (assets/
//                                                    #   ipa-audio/, ~MBs) as
//                                                    #   data URIs, so the
//                                                    #   third voice works with
//                                                    #   no server and no net
//
// The Lab is deliberately outside the production Vite build (which bundles only
// index.html), so this is its own tiny bundler. Web Audio (the synth voices)
// works straight from the file; the DSP is pure and needs no assets. The
// recorded-phones voice is the one asset-backed feature: without --audio the
// standalone page simply can't fetch the clips and falls back to the synth.
import { build } from "esbuild";
import { writeFileSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const artifactMode = args.includes("--artifact");
const audioMode = args.includes("--audio");
const OUT = args.filter(a => a !== "--artifact" && a !== "--audio")[0] || join(ROOT, "tools", "langlab.html");

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

// --audio: inline the recorded-phone bank as data URIs on window.__IPA_AUDIO__
// (the Lab's clip loader checks it before fetching). Base64 carries no
// close-tag, so no escaping worry; the cost is page size, which we report.
let audioScript = "";
if (audioMode) {
  const { IPA_CLIPS } = await import(pathToFileURL(join(ROOT, "src", "sim", "ipaAudioManifest.js")));
  const files = [...new Set(Object.values(IPA_CLIPS))];
  const inline = {};
  let bytes = 0;
  for (const f of files) {
    const buf = readFileSync(join(ROOT, "assets", "ipa-audio", f));
    bytes += buf.length;
    inline[f] = "data:audio/ogg;base64," + buf.toString("base64");
  }
  audioScript = `<script>window.__IPA_AUDIO__=${JSON.stringify(inline)}</script>\n`;
  console.log(`inlined ${files.length} phone recordings (${(bytes / 1024) | 0} KB raw)`);
}

// the app builds its own DOM + injects its own <style> on load (mount()), so the
// page body is just a mount point and the script; a full page adds <head> chrome
const body = `<div id="app"></div>
<noscript>This procedural language generator needs JavaScript enabled.</noscript>
${audioScript}<script>${js}</script>`;

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

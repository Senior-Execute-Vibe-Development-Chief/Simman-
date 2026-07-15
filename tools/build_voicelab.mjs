// Build the standalone "Voice Lab (diagnostic)" HTML app.
//
//   node tools/build_voicelab.mjs                 # -> tools/voicelab.html (standalone)
//   node tools/build_voicelab.mjs --artifact OUT  # -> OUT (body-only, for the Artifact host)
//
// It inlines the VERBATIM src/sim/vocalTract.js (only its one import is
// swapped for an inline const) followed by tools/voicelab.ui.js, in a single
// module script. So the app runs the exact engine the sim/Lab use — the point
// is to isolate whether the muffle/artifacts are in the synthesis or the
// Lab's playback path. Self-contained: no network, no external assets (CSP-safe).
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let engine = readFileSync(resolve(root, "src/sim/vocalTract.js"), "utf8");
// the engine's sole import → inline const (keep the exact values from languagePhonetics.js)
engine = engine.replace(
  /import\s*\{\s*TONE_SHAPES\s*\}\s*from\s*["']\.\/languagePhonetics\.js["'];?/,
  "const TONE_SHAPES = [[1.3, 1.3], [0.95, 1.3], [1.05, 0.8, 1.15], [1.35, 0.85]];"
);
if (engine.includes("import ")) { console.error("!! engine still has an import after inlining; aborting"); process.exit(1); }
const ui = readFileSync(resolve(root, "tools/voicelab.ui.js"), "utf8");

const CSS = `
:root{--bg:#070a10;--card:#0f1521;--edge:#1c2636;--ink:#e7edf6;--dim:#8394ad;--acc:#65d6a0;--blue:#6fa8ff}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
#app{max-width:820px;margin:0 auto;padding:22px 16px 60px}
.head h1{font-size:26px;margin:0 0 4px;letter-spacing:-.02em}
.head .tag{font-size:11px;vertical-align:middle;background:#26324a;color:#9fb4d6;padding:2px 8px;border-radius:999px;margin-left:8px;letter-spacing:.06em;text-transform:uppercase}
.head p{color:var(--dim);margin:0 0 18px;max-width:70ch}
code{background:#131b29;padding:1px 5px;border-radius:5px;font-size:.9em;color:#bcd0ee}
.card{background:var(--card);border:1px solid var(--edge);border-radius:14px;padding:16px 18px;margin:0 0 14px}
.card h2{font-size:14px;margin:0 0 12px;letter-spacing:.02em;text-transform:uppercase;color:#c4d2e8}
.card h2 .sub{text-transform:none;letter-spacing:0;color:var(--dim);font-weight:400;font-size:12px;margin-left:6px}
.lbl{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--dim);margin:10px 0 6px}
.row{display:flex;flex-wrap:wrap;gap:8px}
.pill{background:#182337;color:#dbe6f7;border:1px solid #263450;border-radius:10px;padding:9px 15px;font-size:15px;cursor:pointer;transition:.12s;font-feature-settings:"ss01"}
.pill:hover{background:#213152;border-color:#3a557f}
.pill:active{transform:translateY(1px)}
.pill.ghost{background:transparent;color:var(--dim);font-size:12px;padding:6px 12px;margin-top:10px}
.ctl{display:flex;align-items:center;gap:10px;margin:8px 0}
.ctl>span:first-child{flex:0 0 210px;color:#cdd9ec}
.ctl input[type=range]{flex:1;accent-color:var(--acc)}
.ctl input[type=checkbox]{accent-color:var(--acc);width:16px;height:16px}
label.ctl{cursor:pointer}
.val{flex:0 0 66px;text-align:right;font:12px ui-monospace,monospace;color:var(--blue);font-variant-numeric:tabular-nums}
.hint{color:var(--dim);font-size:12px}
.pill:focus-visible,.ctl input:focus-visible{outline:2px solid var(--acc);outline-offset:2px}
@media (prefers-reduced-motion:reduce){.pill{transition:none}}
.canvas-wrap{position:relative;margin:8px 0}
.clabel{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--dim);margin-bottom:4px}
canvas{width:100%;height:auto;border:1px solid var(--edge);border-radius:8px;display:block;background:#0b0f16}
.readout{margin-top:12px;font-size:13px;color:#d3deee;background:#0b1220;border:1px solid var(--edge);border-radius:8px;padding:10px 12px;font-variant-numeric:tabular-nums}
.readout .hint{display:block;margin-top:5px}
.foot{color:var(--dim);font-size:13px;line-height:1.6;margin-top:8px;max-width:74ch}
.foot b{color:#c4d2e8}
`.trim();

const body = `<style>\n${CSS}\n</style>\n<div id="app"></div>\n<script type="module">\n${engine}\n\n/* ── UI ── */\n${ui}\n</script>`;

const args = process.argv.slice(2);
const ai = args.indexOf("--artifact");
if (ai >= 0) {
  const out = args[ai + 1] || "voicelab-artifact.html";
  writeFileSync(out, body);
  console.log("wrote artifact body -> " + out + "  (" + (body.length / 1024).toFixed(1) + " kB)");
} else {
  const html = `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"/>\n<meta name="viewport" content="width=device-width,initial-scale=1"/>\n<title>Voice Lab — diagnostic</title>\n</head><body>\n${body}\n</body></html>`;
  const out = resolve(root, "tools/voicelab.html");
  writeFileSync(out, html);
  console.log("wrote standalone -> " + out + "  (" + (html.length / 1024).toFixed(1) + " kB)");
}

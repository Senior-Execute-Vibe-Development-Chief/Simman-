// Re-anchor every detailed charge's viewBox to the bounding box of its REAL
// artwork, measured in a real SVG engine (headless Chromium).
//
// Why: source SVGs often declare a viewBox their content does not actually
// occupy — cropped fragments of larger documents, root-level translate()
// transforms — which shifts the charge off-centre or clips it out of
// existence when the renderer nests the art. And a naive whole-tree getBBox
// is not enough either: sources also carry stray visible junk (crop marks,
// guide dashes) far from the subject, which would balloon the box and shrink
// the art to a dot. So this tool measures every PAINTED leaf shape, then
// keeps the dominant cluster: seed with the largest element, absorb every box
// that overlaps or lies within 12% of the cluster's diagonal, repeat to a
// fixpoint, and drop the rest. vb := cluster bbox + 2% pad, uniformly.
//
//   node tools/measure_charges.mjs [chromium-binary]
//
// Run AFTER tools/build_charges.mjs; regenerates
// src/sim/heraldryChargesDetailed.js in the same format.
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CHARGE_DETAIL } from "../src/sim/heraldryChargesDetailed.js";

const CHROME = process.argv[2] || process.env.CHROME
  || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const ids = Object.keys(CHARGE_DETAIL);

// sanitise: a zero-scale matrix collapses its whole subtree to a point — an
// editor's "hide by zeroing" artifact, never renderable art. Dropping the
// transform reveals the drawing in its authored coordinates, and the
// measurement below then frames it correctly.
const clean = {};
for (const id of ids) clean[id] = {
  vb: CHARGE_DETAIL[id].vb,
  body: CHARGE_DETAIL[id].body.replace(/\s*transform="matrix\(0,0,0,0,[^"]*\)"/g, ""),
};

const page = `<!doctype html><body><script>
const D = ${JSON.stringify(clean)};
const out = {};
for (const [id, e] of Object.entries(D)) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const vb = e.vb.split(/\\s+/).map(Number);
  svg.setAttribute("viewBox", e.vb);
  svg.setAttribute("width", "1000"); svg.setAttribute("height", "1000");
  svg.setAttribute("preserveAspectRatio", "none");     // exact per-axis mapping
  svg.style.cssText = "position:fixed;left:0;top:0";
  svg.innerHTML = e.body;
  document.body.appendChild(svg);
  const sx = vb[2] / 1000, sy = vb[3] / 1000;
  const boxes = [];
  for (const el of svg.querySelectorAll("path,rect,circle,ellipse,line,polyline,polygon,text,use")) {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || +cs.opacity === 0) continue;
    if (cs.fill === "none" && (cs.stroke === "none" || +cs.strokeOpacity === 0)) continue;
    const r = el.getBoundingClientRect();
    if (!(r.width > 0) && !(r.height > 0)) continue;   // defs / unlaid-out
    boxes.push({ x: vb[0] + r.left * sx, y: vb[1] + r.top * sy, w: r.width * sx, h: r.height * sy });
  }
  svg.remove();
  if (!boxes.length) { out[id] = null; continue; }
  boxes.sort((a, b) => b.w * b.h - a.w * a.h);
  // dominant cluster, TIGHT: seed with the largest element and absorb only
  // elements that overlap it or sit within 3% of its diagonal. Legitimate
  // detail (an eye, a tongue, a crossing part) overlaps or touches the body;
  // junk — crop marks, guide dashes, variant-sheet spares — sits at a visible
  // distance and gets left OUT of the frame, so the charge centres cleanly.
  const U = { ...boxes[0] };
  const used = new Set([0]);
  let grew = true;
  while (grew) {
    grew = false;
    const gap = Math.hypot(U.w, U.h) * 0.03;
    boxes.forEach((b, i) => {
      if (used.has(i)) return;
      if (b.x < U.x + U.w + gap && b.x + b.w > U.x - gap && b.y < U.y + U.h + gap && b.y + b.h > U.y - gap) {
        const x2 = Math.max(U.x + U.w, b.x + b.w), y2 = Math.max(U.y + U.h, b.y + b.h);
        U.x = Math.min(U.x, b.x); U.y = Math.min(U.y, b.y); U.w = x2 - U.x; U.h = y2 - U.y;
        used.add(i); grew = true;
      }
    });
  }
  // COHESION: how much of the painted area is one piece? Fragmented art —
  // detached claws, scattered variant crumbs, specks that still land inside
  // the frame — scores low and gets reported for culling.
  let mainA = 0, outA = 0, inStray = 0;
  boxes.forEach((b, i) => {
    const a = b.w * b.h;
    if (used.has(i)) { mainA += a; return; }
    outA += a;
    if (b.x < U.x + U.w && b.x + b.w > U.x && b.y < U.y + U.h && b.y + b.h > U.y) inStray += a;
  });
  const cohesion = mainA / (mainA + outA * 0.5 + inStray * 4);   // in-frame strays weigh heaviest: they stay visible
  out[id] = [U.x, U.y, U.w, U.h, boxes.length - used.size, +cohesion.toFixed(3)];
}
document.body.textContent = "@@" + JSON.stringify(out) + "@@";
<\/script></body>`;

const dir = mkdtempSync(join(tmpdir(), "charges-"));
const pageFile = join(dir, "measure.html");
writeFileSync(pageFile, page);
let dom;
try {
  dom = execFileSync(CHROME, ["--headless=new", "--no-sandbox", "--disable-gpu",
    "--virtual-time-budget=60000", "--dump-dom", "file://" + pageFile],
  { maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "ignore"] }).toString();
} finally { rmSync(dir, { recursive: true, force: true }); }
const m = dom.match(/@@(\{[\s\S]*?\})@@/);
if (!m) { console.error("no measurement payload in DOM dump — is the chromium binary right?"); process.exit(1); }
const boxes = JSON.parse(m[1]);

let fixed = 0, kept = 0, failed = 0, strays = 0;
const out = {};
for (const id of ids) {
  const e = CHARGE_DETAIL[id], b = boxes[id];
  if (!b || !(b[2] > 0) || !(b[3] > 0)) { out[id] = e; failed++; console.error(`  unmeasurable: ${id} (kept as-is)`); continue; }
  strays += b[4];
  const pad = Math.max(b[2], b[3]) * 0.02 + 1;
  const vb = [b[0] - pad, b[1] - pad, b[2] + 2 * pad, b[3] + 2 * pad].map(v => +v.toFixed(1)).join(" ");
  if (vb === e.vb) kept++; else fixed++;
  out[id] = { vb, recolor: e.recolor, body: clean[id].body };
}

const header = `// ── DETAILED heraldic charge art (user-provided) ──
// GENERATED by tools/build_charges.mjs from assets/charges-src/*.svg, then
// viewBoxes re-anchored to measured artwork bounds by tools/measure_charges.mjs
// — do not hand-edit.
// Each entry: { vb: viewBox, recolor: [[placeholderColour, brightnessFactor], …]
//               swapped for the shield's tincture, body: inner SVG (#000 linework
//               preserved; inherited paths take the tincture) }.
// See CREDITS-heraldry.md for per-charge source & licence.\n\n`;
const bodyStr = Object.entries(out)
  .map(([id, e]) => `  ${JSON.stringify(id)}: ${JSON.stringify(e)},`)
  .join("\n");
writeFileSync(new URL("../src/sim/heraldryChargesDetailed.js", import.meta.url),
  `${header}export const CHARGE_DETAIL = {\n${bodyStr}\n};\n`);

console.log(`measured ${ids.length} charges: re-anchored ${fixed}, already true ${kept}, unmeasurable ${failed}; stray elements dropped: ${strays}`);
const frag = ids.filter(id => boxes[id] && boxes[id][5] != null && boxes[id][5] < 0.9)
  .sort((a, b) => boxes[a][5] - boxes[b][5]);
if (frag.length) console.log("FRAGMENTED (cohesion < 0.9 — review for culling):\n  "
  + frag.map(id => `${id} ${boxes[id][5]}`).join("\n  "));

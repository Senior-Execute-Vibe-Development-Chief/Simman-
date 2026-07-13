// Build the DETAILED charge module from user-provided heraldic SVGs.
//
// Drop heraldic charge SVGs into assets/charges-src/, named by the charge id the
// grammar uses (lion.svg, eagle.svg, dragon.svg, …; see src/sim/heraldry.js
// CHARGES). Then run:  node tools/build_charges.mjs
// …and AFTERWARDS run  node tools/measure_charges.mjs  — sources often declare
// a viewBox their content does not actually occupy (cropped fragments, root
// translates, zero-matrix hidden groups); that tool measures the real artwork
// in a browser and re-anchors every entry's vb to its true bounds.
//
// It strips a full-canvas background, auto-detects the recolour placeholder (the
// dominant coloured fill — e.g. Armoria's #d7374a, or a solid silhouette's one
// colour), keeps #000 linework and #fff highlights, and writes
// src/sim/heraldryChargesDetailed.js as { id: { vb, swap, body } }. The renderer
// swaps `swap` for the shield's tincture and nests the body at its viewBox, so a
// detailed charge keeps all its internal shading. Detailed charges OVERRIDE the
// flat game-icons ones per id; ids with no file fall back to game-icons, then to
// procedural.
//
// Attribution: record a line per file in assets/charges-src/SOURCES.tsv
//   id <TAB> source-url <TAB> author <TAB> license
// so it can be compiled into CREDITS-heraldry.md when the charges are integrated.

import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";

const SRC = "assets/charges-src";
const files = existsSync(SRC) ? readdirSync(SRC).filter(f => f.endsWith(".svg")) : [];

const NEAR_BLACK = /^#?(000000?|0{3}|111|1a1a1a|black)$/i;
const NEAR_WHITE = /^#?(ffffff?|f{3}|eee|fefefe|white)$/i;
const norm = c => c.trim().toLowerCase();

function stripBackground(svg, vb) {
  // remove a leading full-canvas rect or a bg path like M0 0h..v..H0z
  const parts = vb.split(/\s+/).map(Number);
  const w = parts[2], h = parts[3];
  let s = svg;
  s = s.replace(/<rect\b[^>]*width="100%"[^>]*height="100%"[^>]*\/>/gi, "");
  // full-size rect at origin (width/height ≈ viewBox size, no non-zero x/y)
  s = s.replace(/<rect\b[^>]*\/>/gi, (m) => {
    const gw = parseFloat((m.match(/width="([0-9.]+)"/) || [])[1]);
    const gh = parseFloat((m.match(/height="([0-9.]+)"/) || [])[1]);
    const nzx = /\bx="0*[1-9]/.test(m), nzy = /\by="0*[1-9]/.test(m);
    if (!nzx && !nzy && gw && gh && Math.abs(gw - w) < 2 && Math.abs(gh - h) < 2) return "";
    return m;
  });
  s = s.replace(/<path\b[^>]*\bd="M0 0[hH][0-9. ]+[vV][0-9. ]+[hH]0 ?[zZ]"[^>]*\/>/gi, "");
  return s;
}

function hexRGB(c) {
  c = c.replace("#", "");
  if (c.length === 3) c = c.split("").map(x => x + x).join("");
  if (!/^[0-9a-f]{6}$/i.test(c)) return null;
  return [parseInt(c.slice(0, 2), 16), parseInt(c.slice(2, 4), 16), parseInt(c.slice(4, 6), 16)];
}
function isBW(c) {                       // near-black or near-white (or a named colour)
  const rgb = hexRGB(c); if (!rgb) return true;
  const mx = Math.max(...rgb), mn = Math.min(...rgb);
  return mx < 45 || mn > 205;
}
// The genome renders each charge as a MONOCHROME silhouette in one tincture: the
// black linework and white highlights stay, and EVERY coloured fill folds into the
// shield's tincture, scaled by a brightness factor so internal shading survives.
// A charge must never leak a raw colour, whatever palette its source used — so we
// don't special-case one placeholder; we map every colour we find.
//
//   · DrawShield tincture SLOTS (#ffff00 primary, #00ff00/#ff0000/#0000ff secondary
//     slots) → the full tincture (factor 1). These are semantic "this is a tincture
//     here" markers, not literal hues, so luminance would mis-shade them.
//   · DrawShield SHADE slots (#cccccc shadow, #999999 deep shadow) → their designed
//     factor, preserving the intended relief.
//   · Armoria / WappenWiki single accent (#d7374a) → the full tincture.
//   · any OTHER coloured fill → a shade of the tincture by its own relative
//     luminance, so a dark detail stays dark and a light one stays light.
// Returns [] for a plain black-silhouette charge (renderer fills it via the root).
const SLOT = new Set(["#ffff00", "#00ff00", "#ff0000", "#0000ff"]);
const SHADE = { "#cccccc": 0.72, "#999999": 0.58 };
const expand = c => { c = norm(c).replace("#", ""); if (c.length === 3) c = c.split("").map(x => x + x).join(""); return "#" + c; };
const relLum = c => { const rgb = hexRGB(c); if (!rgb) return 1; return (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255; };
function detectRecolor(inner, rootFill) {
  const fills = new Set();
  const add = f => { f = norm(f); if (f && f !== "none" && f[0] === "#") fills.add(f); };
  if (rootFill) add(rootFill);
  // scan fills AND strokes AND gradient stops, as attributes and as CSS props
  // (including inside <style> class rules) — any of them can carry a raw colour.
  for (const m of inner.matchAll(/(?:fill|stroke|stop-color)="([^"]+)"/g)) add(m[1]);
  for (const m of inner.matchAll(/(?:fill|stroke|stop-color)\s*:\s*([^;"'\s){}]+)/g)) add(m[1]);
  const list = [];
  for (const f of fills) {
    if (isBW(f)) continue;                                  // #000 linework / #fff highlight stay
    const e = expand(f);
    if (SLOT.has(e) || e === "#d7374a") { list.push([f, 1]); continue; }
    if (SHADE[e] != null) { list.push([f, SHADE[e]]); continue; }
    // arbitrary colour → a shade of the tincture tracking its luminance
    list.push([f, +Math.max(0.28, Math.min(1.2, 0.32 + relLum(f) * 0.9)).toFixed(2)]);
  }
  return list;
}

const out = {};
const meta = [];
for (const file of files) {
  const id = file.replace(/\.svg$/, "");
  const raw = readFileSync(`${SRC}/${file}`, "utf8");
  let vb = (raw.match(/viewBox="([^"]+)"/) || [])[1];
  if (!vb) {                                  // no viewBox → derive from width/height
    const w = (raw.match(/<svg[^>]*\bwidth="([0-9.]+)"/) || [])[1];
    const h = (raw.match(/<svg[^>]*\bheight="([0-9.]+)"/) || [])[1];
    vb = w && h ? `0 0 ${w} ${h}` : "0 0 512 512";
  }
  const rootFill = (raw.match(/<svg[^>]*\bfill="([^"]+)"/) || [])[1] || null;
  let inner = raw.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
  inner = inner
    .replace(/<metadata[\s\S]*?<\/metadata>/gi, "")
    // paired namespaced elements (Inkscape/RDF/Office cruft that breaks XML once embedded)
    .replace(/<(sodipodi|inkscape|rdf|cc|dc|v|o|w|x):[\w-]+[^>]*>[\s\S]*?<\/\1:[\w-]+>/gi, "")
    // self-closing namespaced elements (e.g. <v:documentProperties langID=.../>)
    .replace(/<(?:sodipodi|inkscape|rdf|cc|dc|v|o|w|x):[\w-]+[^>]*\/>/gi, "")
    // namespaced attributes, keeping only xml: and xlink:
    .replace(/\s+(?!xlink:|xml:)[a-zA-Z][\w]*:[\w.-]+="[^"]*"/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    // drop raster <image> elements (not clean silhouettes) and neutralise xlink:
    // href → href, so an embedded charge never needs the xlink namespace declared
    .replace(/<image\b[^>]*\/>/gi, "")
    .replace(/<image\b[^>]*>[\s\S]*?<\/image>/gi, "")
    .replace(/xlink:href=/gi, "href=")
    // normalise rgb(r,g,b) → #rrggbb so every colour flows through one hex path
    .replace(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/gi,
      (_, r, g, b) => "#" + [r, g, b].map(n => Math.max(0, Math.min(255, +n)).toString(16).padStart(2, "0")).join(""))
    .trim();
  inner = stripBackground(inner, vb);
  const recolor = detectRecolor(inner, rootFill);
  // minify: collapse whitespace and drop excess coordinate precision. On a large
  // viewBox (DrawShield's ~400 units) round to integers — invisible, ~halves the
  // size; on a tiny viewBox keep 1 dp so nothing collapses.
  const vbMax = Math.max(...vb.split(/\s+/).map(Number).slice(2));
  const rounded = vbMax >= 50
    ? inner.replace(/-?\d+\.\d+/g, m => String(Math.round(+m)))
    : inner.replace(/-?\d+\.\d{2,}/g, m => String(+(+m).toFixed(1)));
  // lowercase every hex colour so the recolour swaps (also lowercased) always match
  const lowered = rounded.replace(/#[0-9a-fA-F]{3,8}\b/g, m => m.toLowerCase());
  const body = lowered.replace(/\s+/g, " ").trim();
  out[id] = { vb, recolor, body };
  meta.push({ id, recolor, bytes: body.length });
}

const header = `// ── DETAILED heraldic charge art (user-provided) ──
// GENERATED by tools/build_charges.mjs from assets/charges-src/*.svg — do not hand-edit.
// Each entry: { vb: viewBox, recolor: [[placeholderColour, brightnessFactor], …]
//               swapped for the shield's tincture, body: inner SVG (#000 linework
//               preserved; inherited paths take the tincture) }.
// See CREDITS-heraldry.md for per-charge source & licence.\n\n`;
const bodyStr = Object.entries(out)
  .map(([id, e]) => `  ${JSON.stringify(id)}: ${JSON.stringify(e)},`)
  .join("\n");
writeFileSync("src/sim/heraldryChargesDetailed.js",
  `${header}export const CHARGE_DETAIL = {\n${bodyStr}\n};\n`);

console.log(`built heraldryChargesDetailed.js — ${meta.length} detailed charges`);
for (const m of meta) console.log(`  ${m.id.padEnd(16)} recolor=${m.recolor.map(([c]) => c).join(",") || "(fill)"}  ${(m.bytes / 1024).toFixed(1)}KB`);
if (!meta.length) console.log("  (no SVGs in assets/charges-src/ yet — module is empty)");

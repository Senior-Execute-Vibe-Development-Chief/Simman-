// Preview the emblem GENOME (src/sim/emblemGenome.js): express any genome flat
// across traditions, and show it EVOLVING. Two sheets:
//   node tools/render_emblems.mjs evolve   → lineages drifting + a marshalling cross
//   node tools/render_emblems.mjs range    → one genome space, many traditions
// (default: both, stacked)
import { writeFileSync } from "node:fs";
import { CHARGE_DETAIL } from "../src/sim/heraldryChargesDetailed.js";
import { foundGenome, inheritGenome, crossGenome, mutateGenome, expressGenome, describeGenome } from "../src/sim/emblemGenome.js";

const MODE = process.argv[2] || "both";
const OUT = process.argv[3] || "/tmp/claude-0/-home-user-Simman-/0dce9194-9863-5d0c-9a8a-3f95cac87b93/scratchpad/emblems.svg";

const css = ([r, g, b]) => `rgb(${r},${g},${b})`;
const shade = (rgb, f) => rgb.map(c => Math.max(0, Math.min(255, Math.round(c * f))));
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
let uid = 0;
// deterministic per-panel rng from a seed (no Math.random)
function rrng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = (t + Math.imul(t ^ t >>> 7, 61 | t)) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// ── a motif from the DrawShield art, recoloured ──
function motif(id, x, y, box, colRGB) {
  const det = CHARGE_DETAIL[id]; if (!det) return "";
  let body = det.body;
  if (det.recolor) for (const [c, f] of det.recolor) body = body.split(c).join(css(shade(colRGB, f)));
  return `<svg x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${box.toFixed(1)}" height="${box.toFixed(1)}" viewBox="${det.vb}" preserveAspectRatio="xMidYMid meet" fill="${css(colRGB)}">${body}</svg>`;
}

// ── substrate shapes (flat) ──
function shape(kind, w, h) {
  switch (kind) {
    case "shield": return { d: `M0 0 H${w} V${h * 0.6} Q${w} ${h * 0.87} ${w / 2} ${h} Q0 ${h * 0.87} 0 ${h * 0.6} Z`, round: false };
    case "roundel": return { d: `M${w / 2} 0 A${w / 2} ${w / 2} 0 1 0 ${w / 2} ${w} A${w / 2} ${w / 2} 0 1 0 ${w / 2} 0 Z`, round: true };
    case "pennon": return { d: `M0 0 H${w} L${w - h * 0.42} ${h / 2} L${w} ${h} H0 Z`, round: false };
    case "lozenge": return { d: `M${w / 2} 0 L${w} ${h / 2} L${w / 2} ${h} L0 ${h / 2} Z`, round: false };
    case "gonfalon": return { d: `M0 0 H${w} V${h * 0.82} H0 Z`, round: false, tails: h };
    default: return { d: `M0 0 H${w} V${h} H0 Z`, round: false };   // banner
  }
}

// ── field: heraldic partition, else a plain fill ──
function fieldSVG(w, h, p) {
  const a = css(p.tinctures[0]), b = css(p.tinctures[1]), n = p.stripes;
  const R = `<rect width="${w}" height="${h}" fill="${a}"/>`;
  const tri = (pts, f) => `<polygon points="${pts.map(q => q.map(v => v.toFixed(1)).join(",")).join(" ")}" fill="${f}"/>`;
  switch (p.partition) {
    case "perPale": return R + `<rect x="${w / 2}" width="${w / 2}" height="${h}" fill="${b}"/>`;
    case "perFess": return R + `<rect y="${h / 2}" width="${w}" height="${h / 2}" fill="${b}"/>`;
    case "perBend": return R + tri([[w, 0], [w, h], [0, h]], b);
    case "quarterly": return R + `<rect x="${w / 2}" width="${w / 2}" height="${h / 2}" fill="${b}"/><rect y="${h / 2}" width="${w / 2}" height="${h / 2}" fill="${b}"/>`;
    case "perSaltire": return R + tri([[0, 0], [w / 2, h / 2], [w, 0]], b) + tri([[0, h], [w / 2, h / 2], [w, h]], b);
    case "gyronny": { let s = R; for (let i = 0; i < 8; i += 2) { const a0 = i / 8 * 6.283 - 1.571, a1 = (i + 1) / 8 * 6.283 - 1.571, RR = Math.hypot(w, h); s += tri([[w / 2, h / 2], [w / 2 + Math.cos(a0) * RR, h / 2 + Math.sin(a0) * RR], [w / 2 + Math.cos(a1) * RR, h / 2 + Math.sin(a1) * RR]], b); } return s; }
    case "chevron": return R + `<path d="M0 ${h} L${w / 2} ${h * 0.4} L${w} ${h} Z" fill="${b}"/>`;
    case "barry": { let s = ""; for (let i = 0; i < n; i++) s += `<rect y="${(i * h / n).toFixed(1)}" width="${w}" height="${(h / n + 1).toFixed(1)}" fill="${i % 2 ? b : a}"/>`; return s; }
    case "paly": { let s = ""; for (let i = 0; i < n; i++) s += `<rect x="${(i * w / n).toFixed(1)}" width="${(w / n + 1).toFixed(1)}" height="${h}" fill="${i % 2 ? b : a}"/>`; return s; }
    default: return R;
  }
}

// ── procedural aniconic script band ──
function calligraphy(x, y, w, rows, color, rng) {
  let s = "";
  for (let r = 0; r < rows; r++) {
    const by = y + r * 26; let px = x, d = `M${px} ${by}`;
    const words = 3 + Math.floor(rng() * 3);
    for (let i = 0; i < words; i++) { const seg = 26 + rng() * 22; d += ` q ${seg / 2} ${(rng() - 0.5) * 34} ${seg} 0`; px += seg + 6; if (rng() < 0.5) d += ` m 6 0`; }
    s += `<path d="${d}" fill="none" stroke="${css(color)}" stroke-width="3.4" stroke-linecap="round"/>`;
    for (let i = 0; i < words; i++) s += `<circle cx="${(x + 20 + i * 34).toFixed(1)}" cy="${(by - 16).toFixed(1)}" r="2.2" fill="${css(color)}"/>`;
  }
  return s;
}

// ── procedural steppe tamga (abstract clan brand) ──
function tamga(cx, cy, S, seed, color) {
  const rng = rrng(seed); const st = `stroke="${css(color)}" stroke-width="${(S * 0.16).toFixed(1)}" fill="none" stroke-linecap="round" stroke-linejoin="round"`;
  let s = `<path d="M${cx} ${cy - S} V${cy + S}" ${st}/>`;              // stem
  const crown = Math.floor(rng() * 3);
  if (crown === 0) s += `<path d="M${cx - S * 0.7} ${cy - S * 0.6} A${S * 0.7} ${S * 0.7} 0 0 0 ${cx + S * 0.7} ${cy - S * 0.6}" ${st}/>`;
  else if (crown === 1) s += `<path d="M${cx - S * 0.6} ${cy - S} L${cx} ${cy - S * 0.5} L${cx + S * 0.6} ${cy - S}" ${st}/>`;
  else s += `<circle cx="${cx}" cy="${cy - S * 0.7}" r="${S * 0.35}" ${st}/>`;
  const feet = Math.floor(rng() * 3);
  if (feet === 0) s += `<path d="M${cx} ${cy + S} l${-S * 0.6} ${S * 0.5} M${cx} ${cy + S} l${S * 0.6} ${S * 0.5}" ${st}/>`;
  else if (feet === 1) s += `<path d="M${cx - S * 0.6} ${cy + S} H${cx + S * 0.6}" ${st}/>`;
  if (rng() < 0.6) s += `<circle cx="${cx}" cy="${cy}" r="${S * 0.4}" ${st}/>`;
  if (rng() < 0.5) s += `<path d="M${cx - S * 0.8} ${cy - S * 0.1} H${cx - S * 0.3} M${cx + S * 0.3} ${cy - S * 0.1} H${cx + S * 0.8}" ${st}/>`;
  return s;
}

function sunDisc(cx, cy, r, color) {
  let ray = ""; for (let i = 0; i < 12; i++) { const a = i / 12 * 6.283; ray += `<line x1="${cx}" y1="${cy}" x2="${(cx + Math.cos(a) * r * 1.5).toFixed(1)}" y2="${(cy + Math.sin(a) * r * 1.5).toFixed(1)}" stroke="${css(color)}" stroke-width="2.4"/>`; }
  return ray + `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${css(color)}"/>`;
}
function star(cx, cy, r, color) { const p = []; for (let i = 0; i < 10; i++) { const a = -1.571 + i * 0.628, rad = i % 2 ? r * 0.42 : r; p.push([cx + Math.cos(a) * rad, cy + Math.sin(a) * rad]); } return `<polygon points="${p.map(q => q.map(v => v.toFixed(1)).join(",")).join(" ")}" fill="${css(color)}"/>`; }
function crescent(cx, cy, r, color) { return `<path d="M${cx + r * 0.25} ${cy - r} A${r} ${r} 0 1 0 ${cx + r * 0.25} ${cy + r} A${r * 0.78} ${r * 0.78} 0 1 1 ${cx + r * 0.25} ${cy - r} Z" fill="${css(color)}"/>`; }

// ── draw one emblem from its phenotype, into a cell ──
function drawEmblem(gp, cx, cy, cw, ch) {
  const p = expressGenome(gp);
  // substrate box within the cell
  let w, h;
  if (p.substrate === "roundel") { w = h = Math.min(cw, ch) * 0.86; }
  else if (p.substrate === "shield" || p.substrate === "lozenge") { h = ch * 0.9; w = h * (p.substrate === "lozenge" ? 0.8 : 0.9); }
  else { w = cw * 0.9; h = w * (p.substrate === "pennon" ? 0.6 : 0.62); }
  const ox = cx + (cw - w) / 2, oy = cy + (ch - h) / 2;
  const sh = shape(p.substrate, w, h), clip = `e${uid++}`;
  const C = p.colors;

  let content = "";
  const bg = C.field;
  const cxm = w / 2, cym = h * (p.substrate === "shield" ? 0.46 : 0.5);
  const base = Math.min(w, h);
  const rng = rrng(gp.seed ^ (gp.gen * 2654435761));

  if (p.composition === "heraldic") {
    content += fieldSVG(w, h, p.field);
    if (p.motif) content += placeMotif(p.motif, w, h);
  } else {
    content += `<rect width="${w}" height="${h}" fill="${css(bg)}"/>`;
    if (p.composition === "central" && p.motif) {
      content += motif(p.motif.id, cxm - base * 0.43, cym - base * 0.43, base * 0.86, p.motif.tincture);
      if (p.ornaments.pearl) content += sunDisc(w * 0.82, h * 0.22, 7, C.accent);
    } else if (p.composition === "radial" && p.motif) {
      content += `<circle cx="${cxm}" cy="${cym}" r="${base * 0.4}" fill="none" stroke="${css(C.charge)}" stroke-width="${base * 0.03}"/>`;
      content += motif(p.motif.id, cxm - base * 0.3, cym - base * 0.3, base * 0.6, C.charge);
    } else if (p.composition === "script") {
      content += calligraphy(w * 0.12, h * 0.34, w * 0.76, 2, C.accent, rng);
      if (p.ornaments.crescent) content += crescent(w * 0.82, h * 0.24, 12, C.accent);
    } else if (p.composition === "brand") {
      content += tamga(cxm, cym, base * 0.28, p.ornaments.brandSeed, C.charge);
    } else if (p.composition === "seme" && p.motif) {
      for (let ry = 0; ry < 4; ry++) for (let cxi = 0; cxi < 3; cxi++) {
        const mx = (cxi + (ry % 2 ? 0.5 : 0)) * w / 3, my = (ry + 0.5) * h / 4;
        content += motif(p.motif.id, mx - base * 0.09, my - base * 0.09, base * 0.18, p.motif.tincture);
      }
    } else { // plain
      if (p.ornaments.crescent) content += crescent(cxm, cym, base * 0.22, C.charge);
      else content += `<rect x="${w * 0.32}" y="${h * 0.28}" width="${w * 0.36}" height="${h * 0.44}" fill="${css(C.companion)}"/>`;
    }
    if (p.ornaments.sunDisc && p.composition !== "central") content += sunDisc(w * 0.5, h * 0.5, base * 0.12, C.accent);
    if (p.ornaments.star) content += star(w * 0.8, h * 0.24, base * 0.09, C.accent);
  }

  const frame = sh.round
    ? `<circle cx="${w / 2}" cy="${h / 2}" r="${w / 2 - 1}" fill="none" stroke="#12100f" stroke-width="3"/>`
    : `<path d="${sh.d}" fill="none" stroke="#12100f" stroke-width="2.5"/>`;
  let tails = "";
  if (sh.tails) { const ty = h * 0.82; for (let i = 0; i < 3; i++) { const tx = w * (0.17 + i * 0.33); tails += `<path d="M${tx} ${ty} L${tx + w * 0.16} ${ty} L${tx + w * 0.08} ${ty + h * 0.16} Z" fill="${css(bg)}" stroke="#12100f" stroke-width="1.5"/>`; } }

  const bd = p.ornaments.border && p.composition !== "heraldic"
    ? (sh.round ? `<circle cx="${w / 2}" cy="${h / 2}" r="${w / 2 - base * 0.05}" fill="none" stroke="${css(C.companion)}" stroke-width="${base * 0.05}"/>`
      : `<rect x="${base * 0.04}" y="${base * 0.04}" width="${w - base * 0.08}" height="${h - base * 0.08}" fill="none" stroke="${css(C.companion)}" stroke-width="${base * 0.05}"/>`) : "";

  return `<g transform="translate(${ox.toFixed(1)},${oy.toFixed(1)})"><clipPath id="${clip}"><path d="${sh.d}"/></clipPath>`
    + `<g clip-path="url(#${clip})">${content}${bd}</g>${tails}${frame}</g>`;
}

function placeMotif(m, w, h) {
  const base = Math.min(w, h), box = base * (m.arrange === "three" ? 0.34 : 0.62) * m.scale / 0.5;
  const one = (mx, my, b) => motif(m.id, mx - b / 2, my - b / 2, b, m.tincture);
  if (m.arrange === "three") return one(w * 0.3, h * 0.3, box) + one(w * 0.7, h * 0.3, box) + one(w * 0.5, h * 0.72, box);
  if (m.arrange === "inPale") return one(w / 2, h * 0.32, box * 0.8) + one(w / 2, h * 0.68, box * 0.8);
  if (m.arrange === "seme") { let s = ""; for (let ry = 0; ry < 3; ry++) for (let c = 0; c < 3; c++) s += one((c + 0.5) * w / 3, (ry + 0.5) * h / 3, base * 0.16); return s; }
  return one(w / 2, h * 0.46, box);
}

// ── build sheets ──
const CELL = 150, GAP = 8, PAD = 26;
let sections = [];

function labelRow(title) { return { title }; }

if (MODE === "evolve" || MODE === "both") {
  sections.push({ head: "A lineage evolving — founder, then five generations of drift" });
  const founders = [
    ["House of the Vale", { aniconism: 0.1, martial: 0.7, develop: 0.35, hue: 0.02 }, 1011],
    ["The Sable Khanate", { aniconism: 0.75, nomad: 0.9, hue: 0.09 }, 2027],
    ["Celestial Court", { aniconism: 0.2, centralised: 0.85, develop: 0.7, hue: 0.13 }, 3041],
  ];
  for (const [name, tr, seed] of founders) {
    const chain = [foundGenome(seed, tr)];
    for (let i = 1; i <= 5; i++) chain.push(inheritGenome(chain[i - 1], (seed * 31 + i * 7) >>> 0));
    sections.push({ row: chain, name });
  }
  // marshalling: cross two lineages
  const a = foundGenome(1011, { aniconism: 0.1, martial: 0.7, hue: 0.02 });
  const b = foundGenome(4059, { aniconism: 0.15, commerce: 0.7, hue: 0.55 });
  sections.push({ row: [a, b, crossGenome(a, b, 777)], name: "Union → marshalled child", labels: ["parent A", "parent B", "child"] });
}

if (MODE === "range" || MODE === "both") {
  sections.push({ head: "One genome, every tradition — seeded from emergent state" });
  const presets = [
    ["Feudal", { aniconism: 0.08, martial: 0.7, develop: 0.3, hue: 0.02 }],
    ["Aniconic", { aniconism: 0.92, develop: 0.6, hue: 0.34 }],
    ["Steppe", { aniconism: 0.7, nomad: 0.9, hue: 0.08 }],
    ["Divine empire", { aniconism: 0.15, centralised: 0.9, develop: 0.7, hue: 0.13 }],
    ["Courtly badge", { aniconism: 0.3, refined: 0.92, develop: 0.8, hue: 0.55 }],
    ["Maritime", { aniconism: 0.2, commerce: 0.8, develop: 0.6, hue: 0.55 }],
    ["Martial horde", { aniconism: 0.12, martial: 0.9, nomad: 0.5, hue: 0.0 }],
    ["Merchant republic", { aniconism: 0.25, commerce: 0.9, refined: 0.5, hue: 0.13 }],
  ];
  const row = [];
  presets.forEach(([nm, tr], i) => row.push({ g: foundGenome(5000 + i * 101, tr), nm }));
  for (let i = 0; i < 4; i++) row.push({ g: foundGenome(9001 + i * 313, {}), nm: "(random)" });
  sections.push({ grid: row });
}

// ── lay out ──
const COLS = 8;
let W = COLS * (CELL + GAP) + PAD * 2, yCur = PAD + 30, body = "";
for (const sec of sections) {
  if (sec.head) { body += `<text x="${PAD}" y="${yCur}" font-family="Georgia,serif" font-size="17" fill="#e8e2d4">${esc(sec.head)}</text>`; yCur += 16; continue; }
  if (sec.row) {
    yCur += 8;
    body += `<text x="${PAD}" y="${yCur}" font-family="sans-serif" font-size="11.5" fill="#b9b2a6">${esc(sec.name)}</text>`; yCur += 8;
    sec.row.forEach((g, i) => {
      const x = PAD + i * (CELL + GAP);
      body += drawEmblem(g, x, yCur, CELL, CELL);
      const lab = sec.labels ? sec.labels[i] : "gen " + (g.gen || 0);
      body += `<text x="${x + CELL / 2}" y="${yCur + CELL + 13}" text-anchor="middle" font-family="sans-serif" font-size="9.5" fill="#8f8a7e">${esc(lab)}</text>`;
    });
    yCur += CELL + 26;
  }
  if (sec.grid) {
    yCur += 8;
    sec.grid.forEach((it, i) => {
      const col = i % COLS, r = (i / COLS) | 0;
      const x = PAD + col * (CELL + GAP), y = yCur + r * (CELL + 34);
      body += drawEmblem(it.g, x, y, CELL, CELL);
      body += `<text x="${x + CELL / 2}" y="${y + CELL + 12}" text-anchor="middle" font-family="sans-serif" font-size="10" font-weight="bold" fill="#ddd">${esc(it.nm)}</text>`;
      body += `<text x="${x + CELL / 2}" y="${y + CELL + 25}" text-anchor="middle" font-family="sans-serif" font-size="8" fill="#8f8a7e">${esc(describeGenome(it.g))}</text>`;
    });
    yCur += Math.ceil(sec.grid.length / COLS) * (CELL + 34) + 6;
  }
}
const H = yCur + PAD;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`
  + `<rect width="${W}" height="${H}" fill="#1b1e26"/>`
  + `<text x="${PAD}" y="${PAD + 4}" font-family="Georgia,serif" font-size="21" fill="#e8e2d4">The emblem genome — one genetics for every tradition, evolving</text>`
  + body + `</svg>`;
writeFileSync(OUT, svg);
console.log(`[svg] ${OUT} (${W}×${H})`);

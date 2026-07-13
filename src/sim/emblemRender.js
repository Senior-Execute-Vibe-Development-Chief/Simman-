// ── The emblem RENDERER: phenotype → flat SVG. Single source of truth ──
//
// `expressGenome()` (emblemGenome.js) turns a genome into a phenotype; this module
// draws that phenotype. Everything visual lives here — substrate shapes, heraldic
// fields, charge art, the procedural calligraphy / tamga / geometric tilework /
// sacred sigil, and the ornaments — so the preview tools, the game UI, and the
// interactive lab all render from ONE implementation (the lab inlines this file at
// build time; nothing is hand-ported).
//
// Public API:
//   emblemSVG(genome, W, H)          → a complete <svg> string, emblem centred in W×H
//   drawEmblem(genome, x, y, cw, ch) → a <g> placing that emblem at (x,y) in a cw×ch cell
//   rrng(seed)                       → the deterministic per-emblem PRNG (exported for callers)
import { CHARGE_DETAIL } from "./heraldryChargesDetailed.js";
import { expressGenome, INK, BONE } from "./emblemGenome.js";

// a tincture may be an [r,g,b] array or a pre-built fill string (a hatch
// pattern url) — strings pass through untouched
const css = c => (typeof c === "string" ? c : `rgb(${c[0]},${c[1]},${c[2]})`);
const shade = (c, f) => (typeof c === "string" ? c : c.map(v => Math.max(0, Math.min(255, Math.round(v * f)))));
const F = n => (+n).toFixed(1);
let uid = 0;
// deterministic per-emblem rng from a seed (no Math.random)
export function rrng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = (t + Math.imul(t ^ t >>> 7, 61 | t)) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// ── VECTOR PRIMITIVE charges — the geometric subordinaries (mullets, roundels,
// crosses, lozenges, billets…) drawn as parametric paths, not raster art: crisp
// at any size, a few bytes each, and they counterchange and semé for free
// because they flow through the same motif() pipeline. Each fills the same box
// a raster charge gets. Ids here SHADOW same-named raster art. ──
const starPts = (cx, cy, R, n, r, rot) => { const p = []; for (let i = 0; i < 2 * n; i++) { const a = rot - Math.PI / 2 + i * Math.PI / n, rad = i % 2 ? r : R; p.push([cx + Math.cos(a) * rad, cy + Math.sin(a) * rad]); } return p; };
const poly = (pts, C) => `<polygon points="${pts.map(q => q.map(v => v.toFixed(1)).join(",")).join(" ")}" fill="${C}"/>`;
const ptsPath = pts => "M" + pts.map(q => `${F(q[0])} ${F(q[1])}`).join("L") + "Z";
const ringPath = (cx, cy, r) => `M${F(cx - r)} ${F(cy)} A${F(r)} ${F(r)} 0 1 0 ${F(cx + r)} ${F(cy)} A${F(r)} ${F(r)} 0 1 0 ${F(cx - r)} ${F(cy)} Z`;
const diamondPts = (cx, cy, hw, hh) => [[cx, cy - hh], [cx + hw, cy], [cx, cy + hh], [cx - hw, cy]];
export const PRIMITIVES = {
  mullet: (x, y, b, C) => poly(starPts(x + b / 2, y + b / 2, b * 0.48, 5, b * 0.19, 0), C),
  mullet6: (x, y, b, C) => poly(starPts(x + b / 2, y + b / 2, b * 0.48, 6, b * 0.21, 0), C),
  mullet8: (x, y, b, C) => poly(starPts(x + b / 2, y + b / 2, b * 0.48, 8, b * 0.25, 0), C),
  rowel: (x, y, b, C) => `<path d="${ptsPath(starPts(x + b / 2, y + b / 2, b * 0.48, 6, b * 0.23, 0))} ${ringPath(x + b / 2, y + b / 2, b * 0.11)}" fill="${C}" fill-rule="evenodd"/>`,
  roundel: (x, y, b, C) => `<circle cx="${F(x + b / 2)}" cy="${F(y + b / 2)}" r="${F(b * 0.42)}" fill="${C}"/>`,
  annulet: (x, y, b, C) => `<path d="${ringPath(x + b / 2, y + b / 2, b * 0.42)} ${ringPath(x + b / 2, y + b / 2, b * 0.26)}" fill="${C}" fill-rule="evenodd"/>`,
  lozenge: (x, y, b, C) => poly(diamondPts(x + b / 2, y + b / 2, b * 0.34, b * 0.48), C),
  fusil: (x, y, b, C) => poly(diamondPts(x + b / 2, y + b / 2, b * 0.24, b * 0.49), C),
  mascle: (x, y, b, C) => `<path d="${ptsPath(diamondPts(x + b / 2, y + b / 2, b * 0.34, b * 0.48))} ${ptsPath(diamondPts(x + b / 2, y + b / 2, b * 0.2, b * 0.29))}" fill="${C}" fill-rule="evenodd"/>`,
  billet: (x, y, b, C) => `<rect x="${F(x + b * 0.3)}" y="${F(y + b * 0.1)}" width="${F(b * 0.4)}" height="${F(b * 0.8)}" fill="${C}"/>`,
  delf: (x, y, b, C) => `<rect x="${F(x + b * 0.19)}" y="${F(y + b * 0.19)}" width="${F(b * 0.62)}" height="${F(b * 0.62)}" fill="${C}"/>`,
  crossCouped: (x, y, b, C) => { const cx = x + b / 2, cy = y + b / 2, t = b * 0.14, L = b * 0.45;
    return poly([[cx - t, cy - L], [cx + t, cy - L], [cx + t, cy - t], [cx + L, cy - t], [cx + L, cy + t], [cx + t, cy + t], [cx + t, cy + L], [cx - t, cy + L], [cx - t, cy + t], [cx - L, cy + t], [cx - L, cy - t], [cx - t, cy - t]], C); },
  crossPattee: (x, y, b, C) => { const cx = x + b / 2, cy = y + b / 2, w0 = b * 0.055, w1 = b * 0.3, L = b * 0.46;
    const arm = `${F(cx - w0)},${F(cy)} ${F(cx - w1)},${F(cy - L)} ${F(cx + w1)},${F(cy - L)} ${F(cx + w0)},${F(cy)}`;
    return [0, 90, 180, 270].map(r => `<polygon points="${arm}" fill="${C}" transform="rotate(${r} ${F(cx)} ${F(cy)})"/>`).join(""); },
  crosslet: (x, y, b, C) => { const cx = x + b / 2, cy = y + b / 2, t = b * 0.14, L = b * 0.45, o = b * 0.28, s = b * 0.17;
    const R = (rx, ry, w, h) => `<rect x="${F(rx)}" y="${F(ry)}" width="${F(w)}" height="${F(h)}" fill="${C}"/>`;
    return R(cx - t / 2, cy - L, t, 2 * L) + R(cx - L, cy - t / 2, 2 * L, t)
      + R(cx - s, cy - o - t / 2, 2 * s, t) + R(cx - s, cy + o - t / 2, 2 * s, t)
      + R(cx - o - t / 2, cy - s, t, 2 * s) + R(cx + o - t / 2, cy - s, t, 2 * s); },
  goutte: (x, y, b, C) => { const cx = x + b / 2, r = b * 0.26, top = y + b * 0.04, bl = y + b * 0.7;
    return `<path d="M${F(cx)} ${F(top)} C${F(cx + r * 0.5)} ${F(bl - r * 1.5)} ${F(cx + r)} ${F(bl - r * 0.6)} ${F(cx + r)} ${F(bl)} A${F(r)} ${F(r)} 0 1 1 ${F(cx - r)} ${F(bl)} C${F(cx - r)} ${F(bl - r * 0.6)} ${F(cx - r * 0.5)} ${F(bl - r * 1.5)} ${F(cx)} ${F(top)} Z" fill="${C}"/>`; },
  // cadency marks
  label: (x, y, b, C) => { const t = b * 0.13, Y = y + b * 0.24;
    let s = `<rect x="${F(x + b * 0.06)}" y="${F(Y)}" width="${F(b * 0.88)}" height="${F(t)}" fill="${C}"/>`;
    for (const u of [0.2, 0.5, 0.8]) s += `<rect x="${F(x + b * u - t * 0.45)}" y="${F(Y + t)}" width="${F(t * 0.9)}" height="${F(b * 0.3)}" fill="${C}"/>`;
    return s; },
  crescent: (x, y, b, C) => { const cx = x + b / 2, cy = y + b * 0.5;
    return `<path d="${ringPath(cx, cy, b * 0.42)} ${ringPath(cx, cy - b * 0.1, b * 0.31)}" fill="${C}" fill-rule="evenodd"/>`; },
};

// a charge borne INVERTED turns about its own centre; TO SINISTER mirrors it
const oriented = (m, s, cx, cy) => !m.attitude ? s
  : `<g transform="${m.attitude === "inverted" ? `rotate(180 ${F(cx)} ${F(cy)})` : `translate(${F(2 * cx)},0) scale(-1,1)`}">${s}</g>`;

// ── a motif: a vector primitive if one owns the id, else recoloured charge art ──
function motif(id, x, y, box, colRGB) {
  const prim = PRIMITIVES[id];
  if (prim) return prim(x, y, box, css(colRGB));
  const det = CHARGE_DETAIL[id]; if (!det) return "";
  let body = det.body;
  if (det.recolor) for (const [c, f] of det.recolor) body = body.split(c).join(css(shade(colRGB, f)));
  return `<svg x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${box.toFixed(1)}" height="${box.toFixed(1)}" viewBox="${det.vb}" preserveAspectRatio="xMidYMid meet" fill="${css(colRGB)}">${body}</svg>`;
}

// ── substrate shapes (flat); a shield may take one of several escutcheon
// outlines (variant comes from the phenotype's shieldShape) ──
function shape(kind, w, h, variant) {
  switch (kind) {
    case "shield": switch (variant) {
      case "iberian": return { d: `M0 0 H${w} V${F(h * 0.52)} A${F(w / 2)} ${F(h * 0.48)} 0 0 1 0 ${F(h * 0.52)} Z`, round: false };
      case "french": return { d: `M0 0 H${w} V${F(h * 0.72)} C${w} ${F(h * 0.92)} ${F(w * 0.58)} ${F(h * 0.92)} ${F(w / 2)} ${h} C${F(w * 0.42)} ${F(h * 0.92)} 0 ${F(h * 0.92)} 0 ${F(h * 0.72)} Z`, round: false };
      case "kite": return { d: `M${F(w / 2)} 0 Q0 0 0 ${F(h * 0.3)} Q0 ${F(h * 0.62)} ${F(w / 2)} ${h} Q${w} ${F(h * 0.62)} ${w} ${F(h * 0.3)} Q${w} 0 ${F(w / 2)} 0 Z`, round: false };
      default: return { d: `M0 0 H${w} V${h * 0.6} Q${w} ${h * 0.87} ${w / 2} ${h} Q0 ${h * 0.87} 0 ${h * 0.6} Z`, round: false };
    }
    case "roundel": return { d: `M${w / 2} 0 A${w / 2} ${w / 2} 0 1 0 ${w / 2} ${w} A${w / 2} ${w / 2} 0 1 0 ${w / 2} 0 Z`, round: true };
    case "pennon": return { d: `M0 0 H${w} L${w - h * 0.42} ${h / 2} L${w} ${h} H0 Z`, round: false };
    case "lozenge": return { d: `M${w / 2} 0 L${w} ${h / 2} L${w / 2} ${h} L0 ${h / 2} Z`, round: false };
    case "gonfalon": return { d: `M0 0 H${w} V${h * 0.82} H0 Z`, round: false, tails: h };
    default: return { d: `M0 0 H${w} V${h} H0 Z`, round: false };   // banner
  }
}

const AZURE = [0x2b, 0x4a, 0x8f];
// ── a styled edge from (x1,y1) to (x2,y2): straight/wavy/engrailed/embattled/
// indented/dancetty. Returns path commands continuing from (x1,y1), ending at
// (x2,y2). The decoration bulges toward the segment's left (perp), into the band. ──
function styledEdge(x1, y1, x2, y2, style, amp) {
  if (!style || style === "straight") return `L${F(x2)} ${F(y2)}`;
  const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len, px = -uy, py = ux;
  const period = style === "dancetty" ? amp * 3.4 : amp * 2.2;
  const n = Math.max(2, Math.round(len / period));
  const P = (a, o) => `${F(x1 + ux * a + px * o)} ${F(y1 + uy * a + py * o)}`;
  let d = "";
  for (let i = 1; i <= n; i++) {
    const a0 = (i - 1) / n * len, a1 = i / n * len, am = (a0 + a1) / 2;
    if (style === "wavy") d += `Q${P(am, i % 2 ? amp : -amp)} ${P(a1, 0)}`;
    else if (style === "engrailed") d += `A${F((a1 - a0) / 2)} ${F((a1 - a0) / 2)} 0 0 1 ${P(a1, 0)}`;
    else if (style === "embattled") d += `L${P(a0, amp)}L${P(am, amp)}L${P(am, 0)}L${P(a1, 0)}`;
    else d += `L${P(am, amp)}L${P(a1, 0)}`;   // indented / dancetty (sawtooth)
  }
  return d;
}

// ── heraldic FURS and lattice TREATMENTS as field fills ──
function furFill(w, h, p) {
  const kind = p.fur, base = Math.min(w, h);
  if (kind === "fretty") {                        // interlaced bendlets over the field colour
    let s = `<rect width="${w}" height="${h}" fill="${css(p.tinctures[0])}"/>`;
    const T = css(p.treatTincture), sp = base * 0.26, sw = base * 0.05, ext = w + h;
    s += `<g stroke="${T}" stroke-width="${F(sw)}">`;
    for (let x = -ext; x < ext; x += sp) s += `<line x1="${F(x)}" y1="0" x2="${F(x + h)}" y2="${h}"/>`;
    for (let x = -ext; x < ext; x += sp) s += `<line x1="${F(x + h)}" y1="0" x2="${F(x)}" y2="${h}"/>`;
    return s + `</g>`;
  }
  if (kind === "masoned") {                       // brick courses in mortar lines
    let s = `<rect width="${w}" height="${h}" fill="${css(p.tinctures[0])}"/>`;
    const T = css(p.treatTincture), rh = base * 0.16, bw = base * 0.34, sw = Math.max(1.1, base * 0.016);
    s += `<g stroke="${T}" stroke-width="${F(sw)}">`;
    for (let r = 0; r * rh < h + rh; r++) {
      s += `<line x1="0" y1="${F(r * rh)}" x2="${w}" y2="${F(r * rh)}"/>`;
      for (let x = (r % 2) * bw / 2; x < w; x += bw) s += `<line x1="${F(x)}" y1="${F(r * rh)}" x2="${F(x)}" y2="${F((r + 1) * rh)}"/>`;
    }
    return s + `</g>`;
  }
  if (kind === "vair") {                          // rows of azure "bells" on argent, offset
    let s = `<rect width="${w}" height="${h}" fill="${css(BONE)}"/>`;
    const cols = 4, cw = w / cols, rh = h / 4;
    for (let r = 0; r < 5; r++) for (let c = -1; c <= cols; c++) {
      const x = c * cw + (r % 2 ? cw / 2 : 0), y = r * rh, A = css(AZURE);
      s += `<path d="M${F(x)} ${F(y)} L${F(x)} ${F(y + rh * 0.55)} Q${F(x + cw / 2)} ${F(y + rh * 1.05)} ${F(x + cw)} ${F(y + rh * 0.55)} L${F(x + cw)} ${F(y)} Z" fill="${A}"/>`;
    }
    return s;
  }
  // ermine: bone field strewn with ink ermine-spots (a dart + three dots)
  let s = `<rect width="${w}" height="${h}" fill="${css(BONE)}"/>`;
  const I = css(INK), cols = 4, rows = 5, cw = w / cols, ch = h / rows;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const x = (c + (r % 2 ? 0.75 : 0.25)) * cw, y = (r + 0.5) * ch, u = Math.min(cw, ch) * 0.16;
    s += `<path d="M${F(x)} ${F(y - u)} Q${F(x + u)} ${F(y + u * 0.5)} ${F(x)} ${F(y + u * 1.4)} Q${F(x - u)} ${F(y + u * 0.5)} ${F(x)} ${F(y - u)} Z" fill="${I}"/>`;
    for (const dxp of [-0.7, 0, 0.7]) s += `<circle cx="${F(x + dxp * u)}" cy="${F(y - u * 1.5)}" r="${F(u * 0.22)}" fill="${I}"/>`;
  }
  return s;
}

// ── field: treatment, else a heraldic partition (edges in the field's line-style) ──
function fieldSVG(w, h, p) {
  if (p.fur) return furFill(w, h, p);
  const a = css(p.tinctures[0]), b = css(p.tinctures[1]), n = p.stripes, amp = Math.min(w, h) * 0.03, ln = p.line;
  const R = `<rect width="${w}" height="${h}" fill="${a}"/>`;
  const tri = (pts, f) => `<polygon points="${pts.map(q => q.map(v => v.toFixed(1)).join(",")).join(" ")}" fill="${f}"/>`;
  switch (p.partition) {
    case "perPale": return R + `<path d="M${F(w / 2)} 0 ${styledEdge(w / 2, 0, w / 2, h, ln, amp)} L${w} ${h} L${w} 0 Z" fill="${b}"/>`;
    case "perFess": return R + `<path d="M0 ${F(h / 2)} ${styledEdge(0, h / 2, w, h / 2, ln, amp)} L${w} ${h} L0 ${h} Z" fill="${b}"/>`;
    case "perBend": return R + `<path d="M0 0 ${styledEdge(0, 0, w, h, ln, amp)} L${w} 0 Z" fill="${b}"/>`;
    case "quarterly": return R + `<rect x="${w / 2}" width="${w / 2}" height="${h / 2}" fill="${b}"/><rect y="${h / 2}" width="${w / 2}" height="${h / 2}" fill="${b}"/>`;
    case "perSaltire": return R + tri([[0, 0], [w / 2, h / 2], [w, 0]], b) + tri([[0, h], [w / 2, h / 2], [w, h]], b);
    case "gyronny": { let s = R; for (let i = 0; i < 8; i += 2) { const a0 = i / 8 * 6.283 - 1.571, a1 = (i + 1) / 8 * 6.283 - 1.571, RR = Math.hypot(w, h); s += tri([[w / 2, h / 2], [w / 2 + Math.cos(a0) * RR, h / 2 + Math.sin(a0) * RR], [w / 2 + Math.cos(a1) * RR, h / 2 + Math.sin(a1) * RR]], b); } return s; }
    case "chevron": return R + `<path d="M0 ${h} L${w / 2} ${h * 0.4} L${w} ${h} Z" fill="${b}"/>`;
    case "barry": { let s = ""; for (let i = 0; i < n; i++) s += `<rect y="${(i * h / n).toFixed(1)}" width="${w}" height="${(h / n + 1).toFixed(1)}" fill="${i % 2 ? b : a}"/>`; return s; }
    case "paly": { let s = ""; for (let i = 0; i < n; i++) s += `<rect x="${(i * w / n).toFixed(1)}" width="${(w / n + 1).toFixed(1)}" height="${h}" fill="${i % 2 ? b : a}"/>`; return s; }
    case "chequy": { const cols = Math.max(4, Math.min(9, n + 2)), cw = w / cols, rows = Math.ceil(h / cw); let s = R;
      for (let r = 0; r <= rows; r++) for (let c = 0; c < cols; c++) if ((r + c) % 2) s += `<rect x="${F(c * cw)}" y="${F(r * cw)}" width="${F(cw + 0.5)}" height="${F(cw + 0.5)}" fill="${b}"/>`;
      return s; }
    case "lozengy": { const cols = Math.max(4, Math.min(8, n + 2)), cw = w / cols, hh = cw * 0.7; let s = R;
      for (let j = -1; j <= Math.ceil(h / hh) + 1; j++) { if (!(j % 2)) continue;
        for (let i = -1; i <= cols; i++) { const cx = i * cw + cw / 2, cy = j * hh;
          s += `<polygon points="${F(cx)},${F(cy - hh)} ${F(cx + cw / 2)},${F(cy)} ${F(cx)},${F(cy + hh)} ${F(cx - cw / 2)},${F(cy)}" fill="${b}"/>`; } }
      return s; }
    default: return R;
  }
}

// ── an ordinary as a fill path (long edges in the given line-style). On a
// FLAG the grammar goes vexillological: the cross sits Nordic (crossing
// toward the hoist) and the pile points from the hoist. ──
function ordinaryPath(type, w, h, ln, amp, flag) {
  switch (type) {
    case "fess": { const y0 = h * 0.4, y1 = h * 0.6; return `M0 ${F(y0)} ${styledEdge(0, y0, w, y0, ln, amp)} L${w} ${F(y1)} ${styledEdge(w, y1, 0, y1, ln, amp)} Z`; }
    case "pale": { const x0 = w * 0.4, x1 = w * 0.6; return `M${F(x1)} 0 ${styledEdge(x1, 0, x1, h, ln, amp)} L${F(x0)} ${h} ${styledEdge(x0, h, x0, 0, ln, amp)} Z`; }
    case "bend": { const bw = w * 0.3; return `M0 0 ${styledEdge(0, 0, w - bw, h, ln, amp)} L${w} ${h} ${styledEdge(w, h, bw, 0, ln, amp)} Z`; }
    case "bendSinister": { const bw = w * 0.3; return `M${w} 0 ${styledEdge(w, 0, bw, h, ln, amp)} L0 ${h} ${styledEdge(0, h, w - bw, 0, ln, amp)} Z`; }
    case "chevron": { const t = h * 0.16; return `M0 ${h} L${F(w / 2)} ${F(h * 0.42)} L${w} ${h} L${F(w - t)} ${h} L${F(w / 2)} ${F(h * 0.42 + t * 1.3)} L${F(t)} ${h} Z`; }
    case "cross": {
      const vert = flag ? `M${F(w * 0.42)} 0 V${h} H${F(w * 0.26)} V0 Z` : ordinaryPath("pale", w, h, "straight", amp);
      return ordinaryPath("fess", w, h, "straight", amp) + vert;
    }
    case "saltire": return ordinaryPath("bend", w, h, "straight", amp) + ordinaryPath("bendSinister", w, h, "straight", amp);
    case "pile": return flag ? `M0 ${F(h * 0.16)} L${F(w * 0.74)} ${F(h / 2)} L0 ${F(h * 0.84)} Z`
      : `M${F(w * 0.18)} 0 L${F(w * 0.82)} 0 L${F(w / 2)} ${F(h * 0.86)} Z`;
    case "pall": { const cx = w / 2, cy = h * 0.44, t = w * 0.11; return `M${F(-t)} ${F(-t)} L${F(t)} ${F(-t)} L${F(cx + t)} ${F(cy)} L${F(cx + t)} ${h} L${F(cx - t)} ${h} L${F(cx - t)} ${F(cy + t)} L${F(w - t)} ${F(t)} L${F(w + t)} ${F(t)} L${F(w + t)} ${F(-t)} Z`; }
  }
  return "";
}
// clip region of a two-part partition (for counterchange)
function partitionRegion(part, w, h, which) {
  if (part === "perPale") return which === 0 ? `M0 0 H${w / 2} V${h} H0 Z` : `M${w / 2} 0 H${w} V${h} H${w / 2} Z`;
  if (part === "perFess") return which === 0 ? `M0 0 H${w} V${h / 2} H0 Z` : `M0 ${h / 2} H${w} V${h} H0 Z`;
  return which === 0 ? `M0 0 H${w} L0 ${h} Z` : `M${w} 0 V${h} H0 Z`;   // perBend
}
// DIMINUTIVES: a linear ordinary in its thinner plural form — n parallel
// strips (bars, pallets, bendlets, chevronels) spread about its own position
function diminutivePaths(type, w, h, ln, amp, n) {
  let s = "";
  for (let i = 0; i < n; i++) {
    const off = (i - (n - 1) / 2) * (n === 2 ? 0.26 : 0.23);
    if (type === "fess") { const y0 = h * (0.45 + off), y1 = y0 + h * 0.1; s += `M0 ${F(y0)} ${styledEdge(0, y0, w, y0, ln, amp)} L${w} ${F(y1)} ${styledEdge(w, y1, 0, y1, ln, amp)} Z`; }
    else if (type === "pale") { const x0 = w * (0.45 + off), x1 = x0 + w * 0.1; s += `M${F(x1)} 0 ${styledEdge(x1, 0, x1, h, ln, amp)} L${F(x0)} ${h} ${styledEdge(x0, h, x0, 0, ln, amp)} Z`; }
    else if (type === "chevron") { const t = h * 0.09, dy = off * h, by = h + dy, ay = h * 0.42 + dy; s += `M0 ${F(by)} L${F(w / 2)} ${F(ay)} L${w} ${F(by)} L${F(w - t)} ${F(by)} L${F(w / 2)} ${F(ay + t * 1.3)} L${F(t)} ${F(by)} Z`; }
    else {  // bendlets / scarpes: thin bands parallel to the diagonal, over-extended into the clip
      const bw = w * 0.13, dx = off * w * 1.3, dy = (type === "bend" ? -1 : 1) * off * h * 1.3;
      const ex = w * 0.25, ey = h * 0.25;
      s += type === "bend"
        ? `M${F(dx - ex)} ${F(dy - ey)} L${F(w - bw + dx + ex)} ${F(h + dy + ey)} L${F(w + dx + ex)} ${F(h + dy + ey)} L${F(bw + dx - ex)} ${F(dy - ey)} Z`
        : `M${F(w + dx + ex)} ${F(dy - ey)} L${F(bw + dx - ex)} ${F(h + dy + ey)} L${F(dx - ex)} ${F(h + dy + ey)} L${F(w - bw + dx + ex)} ${F(dy - ey)} Z`;
    }
  }
  return s;
}
// the ordinary + chief + bordure, optionally counterchanged across the partition
function heraldicOverlay(w, h, f, sh, base, flag) {
  const ln = f.line, amp = Math.min(w, h) * 0.032, ord = f.ordinary, oc = css(f.ordinaryTincture), sub = css(f.subTincture);
  let s = "";
  if (ord && ord !== "none") {
    const path = (f.ordinaryCount || 1) > 1 ? diminutivePaths(ord, w, h, ln, amp, f.ordinaryCount)
      : ordinaryPath(ord, w, h, ln, amp, flag);
    if (f.counterchange) {                       // swap tinctures across the partition
      const A = css(f.tinctures[0]), B = css(f.tinctures[1]);
      const cA = `cc${uid++}`, cB = `cc${uid++}`;
      s += `<clipPath id="${cA}"><path d="${partitionRegion(f.partition, w, h, 0)}"/></clipPath>`
        + `<clipPath id="${cB}"><path d="${partitionRegion(f.partition, w, h, 1)}"/></clipPath>`
        + `<g clip-path="url(#${cA})"><path d="${path}" fill="${B}"/></g>`
        + `<g clip-path="url(#${cB})"><path d="${path}" fill="${A}"/></g>`;
    } else {
      s += `<path d="${path}" fill="${oc}"/>`;
    }
  }
  if (f.chief) s += `<path d="M0 0 L${w} 0 L${w} ${F(h * 0.26)} ${styledEdge(w, h * 0.26, 0, h * 0.26, ln, amp)} Z" fill="${sub}"/>`;
  if (f.bordure) s += `<path d="${sh.d}" fill="none" stroke="${sub}" stroke-width="${(base * 0.09).toFixed(1)}"/>`;
  return s;
}

// ── aniconic calligraphy: pseudo-script from letterform primitives on a baseline
// (upright alif, sin teeth, nun bowls, connectors, terminal flourish), cartouche-framed ──
function calligraphy(x, y, w, rows, color, rng, dens = 0.7) {
  const col = css(color), rh = 30, ch = rows * rh + 34;
  // density packs the glyphs: a sparse plaque at low density, dense text at high
  const adv = 1.35 - dens * 0.6;
  const P = (d, sw) => `<path d="${d}" fill="none" stroke="${col}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/>`;
  let s = `<rect x="${(x - 8).toFixed(1)}" y="${(y - 22).toFixed(1)}" width="${(w + 16).toFixed(1)}" height="${ch.toFixed(1)}" rx="${(ch * 0.3).toFixed(1)}" fill="none" stroke="${col}" stroke-width="2.5"/>`;
  const right = x + w - 14;
  for (let r = 0; r < rows; r++) {
    const base = y + r * rh + rh * 0.6;
    let px = x + 14;
    while (px < right - 18) {
      const t = rng(), f = n => (+n).toFixed(1);
      if (t < 0.3) { s += P(`M${f(px)} ${f(base)} V${f(base - rh * 0.7)}`, 5); if (rng() < 0.4) s += `<circle cx="${f(px)}" cy="${f(base - rh * 0.85)}" r="2.6" fill="${col}"/>`; px += 11 * adv; }
      else if (t < 0.56) { let dd = `M${f(px)} ${f(base)}`; for (let k = 0; k < 3; k++) dd += ` q 4 -9 8 0`; s += P(dd, 4.5); if (rng() < 0.5) s += `<circle cx="${f(px + 12)}" cy="${f(base - 15)}" r="2.4" fill="${col}"/>`; px += 26 * adv; }
      else if (t < 0.82) { s += P(`M${f(px)} ${f(base)} q 9 19 19 0`, 5); if (rng() < 0.7) s += `<circle cx="${f(px + 9.5)}" cy="${f(base - 14)}" r="2.6" fill="${col}"/>`; px += 23 * adv; }
      else { s += P(`M${f(px)} ${f(base)} h 15`, 4.5); px += 17 * adv; }
      px += 3 * adv;
    }
    s += P(`M${px.toFixed(1)} ${base.toFixed(1)} q 11 7 4 17`, 5);   // terminal flourish
  }
  return s;
}

// ── steppe tamga (bold abstract clan brand) ──
function tamga(cx, cy, S, seed, color) {
  const rng = rrng(seed); const st = `stroke="${css(color)}" stroke-width="${(S * 0.22).toFixed(1)}" fill="none" stroke-linecap="round" stroke-linejoin="round"`;
  let s = `<path d="M${cx} ${cy - S * 1.15} V${cy + S * 1.15}" ${st}/>`;              // stem
  const crown = Math.floor(rng() * 3);
  if (crown === 0) s += `<path d="M${cx - S * 0.8} ${cy - S * 0.55} A${S * 0.8} ${S * 0.8} 0 0 0 ${cx + S * 0.8} ${cy - S * 0.55}" ${st}/>`;
  else if (crown === 1) s += `<path d="M${cx - S * 0.7} ${cy - S * 1.1} L${cx} ${cy - S * 0.5} L${cx + S * 0.7} ${cy - S * 1.1}" ${st}/>`;
  else s += `<circle cx="${cx}" cy="${cy - S * 0.75}" r="${S * 0.4}" ${st}/>`;
  const feet = Math.floor(rng() * 3);
  if (feet === 0) s += `<path d="M${cx} ${cy + S * 1.1} l${-S * 0.7} ${S * 0.55} M${cx} ${cy + S * 1.1} l${S * 0.7} ${S * 0.55}" ${st}/>`;
  else if (feet === 1) s += `<path d="M${cx - S * 0.7} ${cy + S * 1.1} H${cx + S * 0.7}" ${st}/>`;
  else s += `<path d="M${cx - S * 0.55} ${cy + S * 1.1} A${S * 0.55} ${S * 0.55} 0 0 0 ${cx + S * 0.55} ${cy + S * 1.1}" ${st}/>`;
  if (rng() < 0.55) s += `<circle cx="${cx}" cy="${cy}" r="${S * 0.42}" ${st}/>`;
  if (rng() < 0.5) s += `<path d="M${cx - S * 0.95} ${cy - S * 0.05} H${cx - S * 0.35} M${cx + S * 0.35} ${cy - S * 0.05} H${cx + S * 0.95}" ${st}/>`;
  return s;
}

// ── geometric tilework (girih rosette / khatam star lattice) ──
function starN(cx, cy, R, n, r, rot, fill, stroke, sw) {
  const p = []; for (let i = 0; i < 2 * n; i++) { const a = rot - Math.PI / 2 + i * Math.PI / n, rad = i % 2 ? r : R; p.push([cx + Math.cos(a) * rad, cy + Math.sin(a) * rad]); }
  return `<polygon points="${p.map(q => q.map(v => v.toFixed(1)).join(",")).join(" ")}" fill="${fill}"${stroke ? ` stroke="${stroke}" stroke-width="${sw}"` : ""}/>`;
}
function khatam(cx, cy, R, fill) {          // 8-point star from two overlaid squares
  const sq = a => { const p = []; for (let i = 0; i < 4; i++) { const ang = a + i * Math.PI / 2; p.push([cx + Math.cos(ang) * R, cy + Math.sin(ang) * R]); } return `<polygon points="${p.map(q => q.map(v => v.toFixed(1)).join(",")).join(" ")}" fill="${fill}"/>`; };
  return sq(-Math.PI / 2) + sq(-Math.PI / 4);
}
function geometry(w, h, spec, fig, ground, accent) {
  const cx = w / 2, cy = h / 2, R = Math.min(w, h) * 0.44, Fi = css(fig), G = css(ground), A = css(accent);
  let s = "";
  if (spec.mode === "lattice") {
    const cols = 3, rows = 4, sx = w / cols, sy = h / rows, r = Math.min(sx, sy) * 0.46;
    for (let ry = 0; ry < rows; ry++) for (let c = 0; c < cols; c++) {
      const x = (c + 0.5) * sx, y = (ry + 0.5) * sy;
      s += khatam(x, y, r, Fi) + `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(r * 0.32).toFixed(1)}" fill="${G}"/>`;
    }
    return s;
  }
  const n = spec.points;
  s += `<circle cx="${cx}" cy="${cy}" r="${R.toFixed(1)}" fill="none" stroke="${A}" stroke-width="${(R * 0.05).toFixed(1)}"/>`;
  s += `<circle cx="${cx}" cy="${cy}" r="${(R * 0.9).toFixed(1)}" fill="none" stroke="${A}" stroke-width="${(R * 0.018).toFixed(1)}"/>`;
  s += starN(cx, cy, R * 0.86, n, R * 0.52, 0, Fi);
  s += starN(cx, cy, R * 0.86, n, R * 0.52, Math.PI / n, "none", A, (R * 0.02).toFixed(1));
  s += `<circle cx="${cx}" cy="${cy}" r="${(R * 0.36).toFixed(1)}" fill="${G}" stroke="${A}" stroke-width="${(R * 0.02).toFixed(1)}"/>`;
  s += starN(cx, cy, R * 0.32, n, R * 0.14, 0, Fi);
  for (let i = 0; i < n; i++) { const a = i * 2 * Math.PI / n; s += `<circle cx="${(cx + Math.cos(a) * R * 0.96).toFixed(1)}" cy="${(cy + Math.sin(a) * R * 0.96).toFixed(1)}" r="${(R * 0.035).toFixed(1)}" fill="${A}"/>`; }
  return s;
}

function sunDisc(cx, cy, r, color) {
  let ray = ""; for (let i = 0; i < 12; i++) { const a = i / 12 * 6.283; ray += `<line x1="${cx}" y1="${cy}" x2="${(cx + Math.cos(a) * r * 1.5).toFixed(1)}" y2="${(cy + Math.sin(a) * r * 1.5).toFixed(1)}" stroke="${css(color)}" stroke-width="2.4"/>`; }
  return ray + `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${css(color)}"/>`;
}
function star(cx, cy, r, color) { const p = []; for (let i = 0; i < 10; i++) { const a = -1.571 + i * 0.628, rad = i % 2 ? r * 0.42 : r; p.push([cx + Math.cos(a) * rad, cy + Math.sin(a) * rad]); } return `<polygon points="${p.map(q => q.map(v => v.toFixed(1)).join(",")).join(" ")}" fill="${css(color)}"/>`; }

// ── procedural SACRED SIGIL — our own religious iconography ──
function sigilArm(cx, cy, len, sw, style, C) {
  const tip = cy - len, line = (x1, y1, x2, y2, w = sw) => `<line x1="${F(x1)}" y1="${F(y1)}" x2="${F(x2)}" y2="${F(y2)}" stroke="${C}" stroke-width="${F(w)}" stroke-linecap="round"/>`;
  switch (style) {
    case "bar": return line(cx, cy, cx, tip);
    case "taper": return `<polygon points="${F(cx - sw * 0.85)},${F(cy)} ${F(cx)},${F(tip)} ${F(cx + sw * 0.85)},${F(cy)}" fill="${C}"/>`;
    case "budded": return line(cx, cy, cx, tip) + `<circle cx="${F(cx)}" cy="${F(tip)}" r="${F(sw * 1.15)}" fill="${C}"/>`;
    case "flared": return `<polygon points="${F(cx - sw * 0.5)},${F(cy)} ${F(cx + sw * 0.5)},${F(cy)} ${F(cx + sw * 1.5)},${F(tip)} ${F(cx - sw * 1.5)},${F(tip)}" fill="${C}"/>`;
    case "forked": return line(cx, cy, cx, tip + sw * 1.1) + line(cx, tip + sw * 1.1, cx - sw * 1.4, tip - sw * 0.2) + line(cx, tip + sw * 1.1, cx + sw * 1.4, tip - sw * 0.2);
    case "crescent": return line(cx, cy, cx, tip + sw) + `<path d="M${F(cx - sw * 1.3)} ${F(tip)} A${F(sw * 1.3)} ${F(sw * 1.3)} 0 1 1 ${F(cx + sw * 1.3)} ${F(tip)}" fill="none" stroke="${C}" stroke-width="${F(sw * 0.8)}" stroke-linecap="round"/>`;
    case "looped": return line(cx, cy, cx, tip + sw * 1.8) + `<circle cx="${F(cx)}" cy="${F(tip)}" r="${F(sw * 1.4)}" fill="none" stroke="${C}" stroke-width="${F(sw * 0.8)}"/>`;
    case "petal": return `<path d="M${F(cx)} ${F(cy)} Q${F(cx - sw * 1.4)} ${F((cy + tip) / 2)} ${F(cx)} ${F(tip)} Q${F(cx + sw * 1.4)} ${F((cy + tip) / 2)} ${F(cx)} ${F(cy)} Z" fill="${C}"/>`;
    case "trefoil": return line(cx, cy, cx, tip + sw * 1.2) + [[0, -1.1], [-1, -0.1], [1, -0.1]].map(([dx, dy]) => `<circle cx="${F(cx + dx * sw * 1.2)}" cy="${F(tip + dy * sw * 1.2)}" r="${F(sw * 0.85)}" fill="${C}"/>`).join("");
  }
  return "";
}
function sigilCore(cx, cy, r, kind, C) {
  switch (kind) {
    case "orb": return `<circle cx="${F(cx)}" cy="${F(cy)}" r="${F(r)}" fill="${C}"/>`;
    case "ring": return `<circle cx="${F(cx)}" cy="${F(cy)}" r="${F(r)}" fill="none" stroke="${C}" stroke-width="${F(r * 0.4)}"/>`;
    case "eye": return `<path d="M${F(cx - r * 1.3)} ${F(cy)} Q${F(cx)} ${F(cy - r * 0.95)} ${F(cx + r * 1.3)} ${F(cy)} Q${F(cx)} ${F(cy + r * 0.95)} ${F(cx - r * 1.3)} ${F(cy)} Z" fill="none" stroke="${C}" stroke-width="${F(r * 0.32)}"/><circle cx="${F(cx)}" cy="${F(cy)}" r="${F(r * 0.42)}" fill="${C}"/>`;
    case "triangle": return `<polygon points="${F(cx)},${F(cy - r)} ${F(cx + r * 0.87)},${F(cy + r * 0.5)} ${F(cx - r * 0.87)},${F(cy + r * 0.5)}" fill="${C}"/>`;
    case "star": { const p = []; for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.42 : r; p.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]); } return `<polygon points="${p.map(q => F(q[0]) + "," + F(q[1])).join(" ")}" fill="${C}"/>`; }
    case "flame": return `<path d="M${F(cx)} ${F(cy - r * 1.3)} Q${F(cx + r * 0.9)} ${F(cy)} ${F(cx)} ${F(cy + r * 0.7)} Q${F(cx - r * 0.9)} ${F(cy)} ${F(cx)} ${F(cy - r * 1.3)} Z" fill="${C}"/>`;
    case "gem": return `<polygon points="${F(cx)},${F(cy - r)} ${F(cx + r)},${F(cy)} ${F(cx)},${F(cy + r)} ${F(cx - r)},${F(cy)}" fill="${C}"/>`;
    case "void": return `<circle cx="${F(cx)}" cy="${F(cy)}" r="${F(r * 0.5)}" fill="none" stroke="${C}" stroke-width="${F(r * 0.3)}"/>`;
  }
  return "";
}
function sigilEnc(cx, cy, R, kind, C, sw) {
  switch (kind) {
    case "ring": return `<circle cx="${F(cx)}" cy="${F(cy)}" r="${F(R)}" fill="none" stroke="${C}" stroke-width="${F(sw * 0.8)}"/>`;
    case "double": return `<circle cx="${F(cx)}" cy="${F(cy)}" r="${F(R)}" fill="none" stroke="${C}" stroke-width="${F(sw * 0.7)}"/><circle cx="${F(cx)}" cy="${F(cy)}" r="${F(R * 0.82)}" fill="none" stroke="${C}" stroke-width="${F(sw * 0.35)}"/>`;
    case "vesica": return `<path d="M${F(cx)} ${F(cy - R)} Q${F(cx + R * 0.9)} ${F(cy)} ${F(cx)} ${F(cy + R)} Q${F(cx - R * 0.9)} ${F(cy)} ${F(cx)} ${F(cy - R)} Z" fill="none" stroke="${C}" stroke-width="${F(sw * 0.7)}"/>`;
    case "triangle": { const p = [[cx, cy - R], [cx + R * 0.87, cy + R * 0.55], [cx - R * 0.87, cy + R * 0.55]]; return `<polygon points="${p.map(q => F(q[0]) + "," + F(q[1])).join(" ")}" fill="none" stroke="${C}" stroke-width="${F(sw * 0.7)}" stroke-linejoin="round"/>`; }
  }
  return "";
}
function sigilBase(cx, cy, r, kind, C, sw) {
  switch (kind) {
    case "steps": { let s = ""; for (let i = 0; i < 3; i++) { const w = r * (1 - i * 0.28); s += `<rect x="${F(cx - w)}" y="${F(cy + i * r * 0.3)}" width="${F(w * 2)}" height="${F(r * 0.26)}" fill="${C}"/>`; } return s; }
    case "lotus": { let s = ""; for (let i = -2; i <= 2; i++) { const x = cx + i * r * 0.4; s += `<path d="M${F(x)} ${F(cy)} Q${F(x - r * 0.22)} ${F(cy - r * 0.5)} ${F(x)} ${F(cy - r * 0.7)} Q${F(x + r * 0.22)} ${F(cy - r * 0.5)} ${F(x)} ${F(cy)} Z" fill="${C}"/>`; } return s; }
    case "cradle": return `<path d="M${F(cx - r)} ${F(cy - r * 0.4)} A${F(r)} ${F(r)} 0 0 0 ${F(cx + r)} ${F(cy - r * 0.4)}" fill="none" stroke="${C}" stroke-width="${F(sw * 0.8)}" stroke-linecap="round"/>`;
  }
  return "";
}
function drawSigil(cx, cy, R, spec, colRGB) {
  const C = css(colRGB), sw = R * 0.12, ringed = spec.enclosure !== "none", vesica = spec.enclosure === "vesica";
  const armLen = R * (vesica ? 0.66 : ringed ? 0.72 : 0.94);
  const arm = (spec.fold >= 8 && (spec.arm === "flared" || spec.arm === "petal")) ? "taper" : spec.arm;
  let s = "";
  if (ringed) s += sigilEnc(cx, cy, R, spec.enclosure, C, sw);
  for (let i = 0; i < spec.fold; i++) {
    let len = armLen;
    if (spec.axis && spec.fold % 2 === 0) { const down = i === spec.fold / 2, horiz = i % (spec.fold / 2) !== 0; len *= down ? 1.28 : horiz ? 0.8 : 1; }
    s += `<g transform="rotate(${F(i * 360 / spec.fold)} ${F(cx)} ${F(cy)})">${sigilArm(cx, cy, len, sw, arm, C)}</g>`;
  }
  if (spec.inter !== "none") { const rr = R * (ringed ? 0.55 : 0.5); for (let i = 0; i < spec.fold; i++) { const a = (-90 + (i + 0.5) * 360 / spec.fold) * Math.PI / 180, x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr; if (spec.inter === "dots") s += `<circle cx="${F(x)}" cy="${F(y)}" r="${F(sw * 0.6)}" fill="${C}"/>`; else if (spec.inter === "pips") s += `<circle cx="${F(x)}" cy="${F(y)}" r="${F(sw * 0.5)}" fill="none" stroke="${C}" stroke-width="${F(sw * 0.3)}"/>`; else if (spec.inter === "rays") s += `<line x1="${F(cx + Math.cos(a) * rr * 0.7)}" y1="${F(cy + Math.sin(a) * rr * 0.7)}" x2="${F(cx + Math.cos(a) * rr * 1.15)}" y2="${F(cy + Math.sin(a) * rr * 1.15)}" stroke="${C}" stroke-width="${F(sw * 0.5)}" stroke-linecap="round"/>`; } }
  s += sigilCore(cx, cy, R * 0.2, spec.core, C);
  if (spec.base !== "none") s += sigilBase(cx, cy + R * (ringed ? 0.98 : 0.78), R * 0.42, spec.base, C, sw);
  return s;
}

// fit a central device inside a substrate's DRAWABLE area (no clipping by the point/corners)
function centralFit(substrate, w, h, base) {
  switch (substrate) {
    case "shield":   return { cx: w / 2, cy: h * 0.42, box: base * 0.64 };
    case "lozenge":  return { cx: w / 2, cy: h / 2, box: base * 0.52 };
    case "pennon":   return { cx: w * 0.40, cy: h * 0.5, box: h * 0.66 };
    case "roundel":  return { cx: w / 2, cy: h / 2, box: base * 0.66 };
    case "gonfalon": return { cx: w / 2, cy: h * 0.44, box: base * 0.7 };
    default:         return { cx: w / 2, cy: h * 0.48, box: base * 0.72 };  // banner
  }
}
// a single small canton mark — on a FLAG it becomes a true rectangular canton
// block at the hoist-top, its symbol counterchanged in the field's own colour
function canton(w, h, base, kind, color, flag, fieldC) {
  if (flag) {
    const cw = w * 0.36, chh = h * 0.52, r = base * 0.11;
    return `<rect width="${F(cw)}" height="${F(chh)}" fill="${css(color)}"/>`
      + (kind === "sun" ? sunDisc(cw / 2, chh / 2, r * 0.7, fieldC) : star(cw / 2, chh / 2, r, fieldC));
  }
  const cx = w * 0.8, cy = h * 0.2, r = base * 0.1;
  return kind === "sun" ? sunDisc(cx, cy, r * 0.7, color) : star(cx, cy, r, color);
}
// ── charges accompanying an ordinary: the phenotype supplies the slot
// positions (motif.slots, unit coords) and any tilt (charges riding a bend);
// this just draws them. ──
function placeAround(m, w, h, substrate) {
  const base = Math.min(w, h), tap = substrate === "shield" || substrate === "pennon" || substrate === "lozenge";
  const sq = v => (tap ? 0.5 + (v - 0.5) * 0.9 : v);       // pull inside a tapered substrate
  const box = base * (m.arrange === "onOrdinary" ? 0.36 : 0.5) * m.scale;
  return m.slots.map(([ux, uy]) => {
    const mx = sq(ux) * w, my = sq(uy) * h;
    let s = motif(m.id, mx - box / 2, my - box / 2, box, m.tincture);
    if (m.tilt) s = `<g transform="rotate(${m.tilt} ${F(mx)} ${F(my)})">${s}</g>`;
    return oriented(m, s, mx, my);
  }).join("");
}

function placeMotif(m, w, h, substrate) {
  const base = Math.min(w, h), tap = substrate === "shield" || substrate === "pennon" || substrate === "lozenge";
  let box = base * (m.arrange === "three" ? 0.34 : 0.6) * m.scale / 0.5;
  if (tap) box *= 0.85;                                  // leave room inside the taper
  const one = (mx, my, b) => oriented(m, motif(m.id, mx - b / 2, my - b / 2, b, m.tincture), mx, my);
  if (m.arrange === "three") return one(w * 0.3, h * (tap ? 0.34 : 0.32), box) + one(w * 0.7, h * (tap ? 0.34 : 0.32), box) + one(w * 0.5, h * (tap ? 0.63 : 0.7), box * 0.9);
  if (m.arrange === "inPale") return one(w / 2, h * 0.3, box * 0.8) + one(w / 2, h * (tap ? 0.6 : 0.66), box * 0.8);
  if (m.arrange === "seme") { let s = ""; for (let ry = 0; ry < 3; ry++) for (let c = 0; c < 3; c++) s += one((c + 0.5) * w / 3, (ry + 0.5) * h / 3, base * 0.16); return s; }
  return one(w / 2, h * (substrate === "shield" ? 0.42 : 0.46), box);
}

// ── petra sancta hatching: a monochrome heraldic coat still CARRIES its
// colour genome — the renderer engraves the implied tinctures as the
// engraver's hatching (dots or, plain argent, vertical gules, horizontal
// azure, diagonals vert/purpure, grid sable…) ──
const HATCH_TILE = {
  or: `<circle cx="3.5" cy="3.5" r="1" fill="%I"/>`,
  argent: ``,
  gules: `<path d="M3.5 -1 V8" stroke="%I" stroke-width="1"/>`,
  azure: `<path d="M-1 3.5 H8" stroke="%I" stroke-width="1"/>`,
  vert: `<path d="M0 7 L7 0 M-3.5 3.5 L3.5 -3.5 M3.5 10.5 L10.5 3.5" stroke="%I" stroke-width="1"/>`,
  purpure: `<path d="M0 0 L7 7 M3.5 -3.5 L10.5 3.5 M-3.5 3.5 L3.5 10.5" stroke="%I" stroke-width="1"/>`,
  sable: `<path d="M3.5 -1 V8 M-1 3.5 H8" stroke="%I" stroke-width="1"/>`,
  murrey: `<path d="M0 0 L7 7 M0 7 L7 0" stroke="%I" stroke-width="0.9"/>`,
  sanguine: `<path d="M3.5 -1 V8 M0 7 L7 0" stroke="%I" stroke-width="0.9"/>`,
  tenne: `<path d="M-1 3.5 H8 M0 0 L7 7" stroke="%I" stroke-width="0.9"/>`,
};
function hatchPattern(name, id) {
  return `<pattern id="${id}" width="7" height="7" patternUnits="userSpaceOnUse">`
    + `<rect width="7" height="7" fill="${css(BONE)}"/>`
    + (HATCH_TILE[name] || "").split("%I").join(css(INK)) + `</pattern>`;
}

// ── ONE COAT's content filling a w×h area (no substrate frame/clip): the
// composition dispatch shared by a whole emblem and by each QUARTER of a
// marshalled shield, which is what makes quartering recursive for free. ──
function coatContent(p, w, h, rng) {
  const sh = shape(p.substrate, w, h, p.shieldShape), C = p.colors, base = Math.min(w, h);
  const cxm = w / 2, cym = h * (p.substrate === "shield" ? 0.46 : 0.5);
  let content = "";
  if (p.composition === "heraldic") {
    let f = p.field, mot = p.motif;
    if (C.hatch && !f.fur) {
      // engrave the implied hues as hatch-pattern fills
      const ids = {}, defs = [];
      const pat = n => { if (!ids[n]) { ids[n] = `ht${uid++}`; defs.push(hatchPattern(n, ids[n])); } return `url(#${ids[n]})`; };
      f = { ...f, tinctures: [pat(C.hatch.field), pat(C.hatch.companion)],
        ordinaryTincture: f.ordinaryTincture && pat(C.hatch.charge),
        subTincture: f.subTincture && pat(C.hatch.charge) };
      // an ink charge stays readable on a hatched band; everywhere else the
      // charge is hatched with its own implied tincture
      if (mot) mot = { ...mot, tincture: mot.arrange === "onOrdinary" ? C.ink : pat(C.hatch.charge) };
      content += `<defs>${defs.join("")}</defs>`;
    }
    content += fieldSVG(w, h, f);
    // a semé is a field treatment — strewn BENEATH the ordinary/chief/bordure
    if (mot && mot.behind) content += placeMotif(mot, w, h, p.substrate);
    content += heraldicOverlay(w, h, f, sh, base, p.isFlag);
    if (mot && mot.behind) {
      // already drawn beneath
    } else if (mot && (mot.arrange === "between" || mot.arrange === "onOrdinary")) {
      content += placeAround(mot, w, h, p.substrate);
    } else if (mot && mot.counterchange) {
      // a counterchanged charge wears the field's own tinctures SWAPPED across
      // the partition line — each half of the charge in the other half's tincture
      const [ta, tb] = f.tinctures;
      const cA = `mc${uid++}`, cB = `mc${uid++}`;
      content += `<clipPath id="${cA}"><path d="${partitionRegion(f.partition, w, h, 0)}"/></clipPath>`
        + `<clipPath id="${cB}"><path d="${partitionRegion(f.partition, w, h, 1)}"/></clipPath>`
        + `<g clip-path="url(#${cA})">${placeMotif({ ...mot, tincture: tb }, w, h, p.substrate)}</g>`
        + `<g clip-path="url(#${cB})">${placeMotif({ ...mot, tincture: ta }, w, h, p.substrate)}</g>`;
    } else if (mot) {
      content += placeMotif(mot, w, h, p.substrate);
    }
  } else {
    content += `<rect width="${w}" height="${h}" fill="${css(C.field)}"/>`;
    if (p.composition === "central" && p.motif) {
      const f = centralFit(p.substrate, w, h, base);
      content += oriented(p.motif, motif(p.motif.id, f.cx - f.box / 2, f.cy - f.box / 2, f.box, p.motif.tincture), f.cx, f.cy);
      if (p.ornaments.cornerAccent) content += sunDisc(w * 0.82, h * 0.2, base * 0.05, C.accent);
    } else if (p.composition === "radial" && p.motif) {
      content += `<circle cx="${cxm}" cy="${cym}" r="${base * 0.4}" fill="none" stroke="${css(C.companion)}" stroke-width="${base * 0.035}"/>`;
      content += oriented(p.motif, motif(p.motif.id, cxm - base * 0.28, cym - base * 0.28, base * 0.56, p.motif.tincture), cxm, cym);
    } else if (p.composition === "script") {
      // the scriptDensity gene sets how much is written: rows and glyph packing
      const dens = p.ornaments.scriptDensity;
      const rows = dens > 0.78 ? 3 : dens > 0.52 ? 2 : 1;
      const cartH = rows * 30 + 34;
      content += calligraphy(w * 0.13, h / 2 - cartH / 2 + 22, w * 0.74, rows, C.accent, rng, dens);
    } else if (p.composition === "brand") {
      content += tamga(cxm, cym, base * 0.26, p.ornaments.brandSeed, C.charge);
    } else if (p.composition === "seme" && p.motif) {
      for (let ry = 0; ry < 4; ry++) for (let ci = 0; ci < 3; ci++) {
        const mx = (ci + (ry % 2 ? 0.5 : 0)) * w / 3 + w / 6, my = (ry + 0.5) * h / 4;
        content += oriented(p.motif, motif(p.motif.id, mx - base * 0.09, my - base * 0.09, base * 0.18, p.motif.tincture), mx, my);
      }
    } else if (p.composition === "plain" && p.geometry) {
      content += geometry(w, h, p.geometry, C.charge, C.field, C.accent);
    } else if (p.composition === "sacred" && p.sigil) {
      const f = centralFit(p.substrate, w, h, base);
      content += drawSigil(f.cx, f.cy - base * 0.04, f.box * 0.46, p.sigil, C.charge);
    }
    if (p.ornaments.canton) content += canton(w, h, base, p.ornaments.cantonKind, p.ornaments.cantonColor, p.isFlag, C.field);
  }
  return content;
}

// ── the core: an emblem centred inside an aw×ah area, as a positioned <g> ──
function emblemInner(genome, aw, ah) {
  const p = expressGenome(genome);
  let w, h;
  if (p.substrate === "roundel") { w = h = Math.min(aw, ah) * 0.92; }
  else if (p.substrate === "shield" || p.substrate === "lozenge") { h = ah * 0.94; w = h * (p.substrate === "lozenge" ? 0.8 : 0.9); }
  else { w = aw * 0.94; h = w * (p.substrate === "pennon" ? 0.6 : 0.62); }
  const ox = (aw - w) / 2, oy = (ah - h) / 2;
  const sh = shape(p.substrate, w, h, p.shieldShape), clip = `e${uid++}`, C = p.colors, base = Math.min(w, h);
  const rng = rrng((genome.seed ^ (genome.gen * 2654435761)) >>> 0);

  let content = "";
  const qs = genome.quarters;
  if (qs && qs.length > 1) {
    // a MARSHALLED shield: the accumulated quarterings, each a full coat
    // rendered recursively into its quarter — two coats sit 1&4 / 2&3, three
    // repeat the senior coat in IV
    const order = qs.length === 2 ? [0, 1, 1, 0] : qs.length === 3 ? [0, 1, 2, 0] : [0, 1, 2, 3];
    const cw = w / 2, ch = h / 2;
    for (let i = 0; i < 4; i++) {
      const q = qs[order[i]];
      const qSeed = q.seed != null ? q.seed : genome.seed;
      const qp = expressGenome({ genes: q.genes, gen: q.gen || 0, seed: qSeed });
      const qrng = rrng(((qSeed ^ ((q.gen || 0) * 2654435761)) + i * 1013904223) >>> 0);
      content += `<g transform="translate(${F((i % 2) * cw)},${F(((i / 2) | 0) * ch)})">${coatContent(qp, cw, ch, qrng)}</g>`;
    }
    content += `<line x1="${F(cw)}" y1="0" x2="${F(cw)}" y2="${F(h)}" stroke="#12100f" stroke-width="1.2"/>`
      + `<line x1="0" y1="${F(ch)}" x2="${F(w)}" y2="${F(ch)}" stroke="#12100f" stroke-width="1.2"/>`;
  } else {
    content = coatContent(p, w, h, rng);
  }
  if (p.cadency) {
    // the mark of difference rides in chief, over everything — even a
    // marshalled display (the heir differences the whole achievement)
    const cb = base * 0.2;
    content += motif(p.cadency.mark, w / 2 - cb / 2, h * 0.05, cb, p.cadency.tincture);
  }

  const bd = p.ornaments.border && p.composition !== "heraldic"
    ? (sh.round ? `<circle cx="${w / 2}" cy="${h / 2}" r="${w / 2 - base * 0.05}" fill="none" stroke="${css(C.companion)}" stroke-width="${base * 0.05}"/>`
      : `<rect x="${base * 0.04}" y="${base * 0.04}" width="${w - base * 0.08}" height="${h - base * 0.08}" fill="none" stroke="${css(C.companion)}" stroke-width="${base * 0.05}"/>`) : "";
  const frame = sh.round
    ? `<circle cx="${w / 2}" cy="${h / 2}" r="${w / 2 - 1}" fill="none" stroke="#12100f" stroke-width="3"/>`
    : `<path d="${sh.d}" fill="none" stroke="#12100f" stroke-width="2.5"/>`;
  let tails = "";
  if (sh.tails) { const ty = h * 0.82; for (let i = 0; i < 3; i++) { const tx = w * (0.17 + i * 0.33); tails += `<path d="M${tx} ${ty} L${tx + w * 0.16} ${ty} L${tx + w * 0.08} ${ty + h * 0.16} Z" fill="${css(C.field)}" stroke="#12100f" stroke-width="1.5"/>`; } }

  return `<g transform="translate(${ox.toFixed(1)},${oy.toFixed(1)})"><clipPath id="${clip}"><path d="${sh.d}"/></clipPath>`
    + `<g clip-path="url(#${clip})">${content}${bd}</g>${tails}${frame}</g>`;
}

/** A complete <svg> string, emblem centred in a W×H viewBox. */
export function emblemSVG(genome, W, H) {
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">${emblemInner(genome, W, H)}</svg>`;
}
/** A <g> placing that emblem at (x,y) within a cw×ch cell (for grids/sheets). */
export function drawEmblem(genome, x, y, cw, ch) {
  return `<g transform="translate(${(+x).toFixed(1)},${(+y).toFixed(1)})">${emblemInner(genome, cw, ch)}</g>`;
}

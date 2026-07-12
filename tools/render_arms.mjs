// Preview sheet for the generative heraldry (src/sim/heraldry.js): run a world,
// then draw each major realm's coat of arms / flag from the grammar so we can
// eyeball whether the designs are rich, distinct, and heraldically plausible —
// and whether stock/faith still cluster. Reads armsForCountry only; nothing here
// is wired into the sim.
//
//   node tools/render_arms.mjs [step] [seed] [N] [out.svg]

import { writeFileSync } from "node:fs";
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { armsForCountry, blazon, tinctureRGB } from "../src/sim/heraldry.js";
import { CHARGE_ART } from "../src/sim/heraldryCharges.js";
import { CHARGE_DETAIL } from "../src/sim/heraldryChargesDetailed.js";

const STEP = +(process.argv[2] || 15000);
const SEED = +(process.argv[3] || 8817);
const N    = +(process.argv[4] || 24);
const OUT  = process.argv[5] || "/tmp/claude-0/-home-user-Simman-/0dce9194-9863-5d0c-9a8a-3f95cac87b93/scratchpad/arms.svg";
const W = 480, H = 240;

const world = buildSim({ W, H, seed: SEED });
const t0 = Date.now();
for (let s = 1; s <= STEP; s++) {
  stepPeopleSim(world, 1);
  if (s % 3000 === 0) process.stderr.write(`  step ${s}/${STEP} — countries ${world.countries ? world.countries.size : 0}\n`);
}
process.stderr.write(`  ran ${STEP} steps in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);

const realms = [...world.countries.values()]
  .map(c => { let pop = 0, mem = 0; for (const s of (c.members || [])) if (s.mode === "settled") { pop += s.people || 0; mem++; } return { c, pop, mem }; })
  .filter(r => r.mem >= 1 && r.c.capital)
  .sort((a, b) => b.pop - a.pop)
  .slice(0, N);
process.stderr.write(`  drawing ${realms.length} realms\n`);

// ── SVG plumbing ──
const esc = s => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const css = ([r, g, b]) => `rgb(${r},${g},${b})`;
const shade = (rgb, f) => `rgb(${rgb.map(c => Math.max(0, Math.min(255, Math.round(c * f)))).join(",")})`;
const C = id => css(tinctureRGB(id));
const OUTLINE = "rgba(20,17,22,.82)";
let uid = 0;

function shieldPath(w, h) { const s = h * 0.60; return `M0 0 H${w} V${s} Q${w} ${h * 0.87} ${w / 2} ${h} Q0 ${h * 0.87} 0 ${s} Z`; }

// A fancy line from (x0,y0) to (x1,y1): returns "L…" points following the style.
function edge(x0, y0, x1, y1, style, amp = 5) {
  if (!style || style === "straight") return `L${x1.toFixed(1)} ${y1.toFixed(1)}`;
  const len = Math.hypot(x1 - x0, y1 - y0) || 1;
  const dense = style === "embattled" || style === "dovetailed" ? 10 : 7;
  const steps = Math.max(4, Math.round(len / dense));
  const ux = (x1 - x0) / len, uy = (y1 - y0) / len, nx = -uy, ny = ux;
  let d = "";
  for (let i = 1; i <= steps; i++) {
    const t = i / steps, ph = t * steps; let o = 0;
    if (style === "wavy") o = Math.sin(t * Math.PI * steps) * amp;
    else if (style === "engrailed") o = -Math.abs(Math.sin(t * Math.PI * steps)) * amp;
    else if (style === "indented") o = (Math.abs((ph % 1) * 2 - 1) * 2 - 1) * amp;
    else o = ((Math.floor(ph * 2) % 2) ? 1 : -1) * amp * 0.9;   // embattled / dovetailed ≈ crenellated
    const bx = x0 + (x1 - x0) * t, by = y0 + (y1 - y0) * t;
    d += `L${(bx + nx * o).toFixed(1)} ${(by + ny * o).toFixed(1)}`;
  }
  return d;
}

// ── Field partitions ──
function fieldSVG(w, h, F) {
  const p = F.partition, a = C(F.tinctures[0]), b = C(F.tinctures[1]), n = F.count || 6, ln = F.line;
  const R = `<rect width="${w}" height="${h}" fill="${a}"/>`;
  const tri = (pts, fill) => `<polygon points="${pts.map(q => q.map(v => v.toFixed(1)).join(",")).join(" ")}" fill="${fill}"/>`;
  switch (p) {
    case "perPale":   return R + `<path d="M${w / 2} 0 ${edge(w / 2, 0, w / 2, h, ln)} H${w} V0 Z" fill="${b}"/>`;
    case "perFess":   return R + `<path d="M0 ${h / 2} ${edge(0, h / 2, w, h / 2, ln)} V${h} H0 Z" fill="${b}"/>`;
    case "perBend":   return R + tri([[w, 0], [w, h], [0, h]], b);
    case "perBendSinister": return R + tri([[0, 0], [w, h], [0, h]], b);
    case "perChevron": return R + tri([[0, h], [w / 2, h * 0.45], [w, h]], b);
    case "perSaltire": return R + tri([[0, 0], [w / 2, h / 2], [w, 0]], b) + tri([[0, h], [w / 2, h / 2], [w, h]], b);
    case "quarterly":
    case "perCross":  return R + `<rect x="${w / 2}" width="${w / 2}" height="${h / 2}" fill="${b}"/><rect y="${h / 2}" width="${w / 2}" height="${h / 2}" fill="${b}"/>`;
    case "gyronny": { let s = R; for (let i = 0; i < 8; i++) { if (i % 2) continue; const a0 = (i / 8) * 2 * Math.PI - Math.PI / 2, a1 = ((i + 1) / 8) * 2 * Math.PI - Math.PI / 2, RR = Math.hypot(w, h); s += tri([[w / 2, h / 2], [w / 2 + Math.cos(a0) * RR, h / 2 + Math.sin(a0) * RR], [w / 2 + Math.cos(a1) * RR, h / 2 + Math.sin(a1) * RR]], b); } return s; }
    case "barry": { let s = ""; for (let i = 0; i < n; i++) s += `<rect y="${(i * h / n).toFixed(1)}" width="${w}" height="${(h / n + 1).toFixed(1)}" fill="${i % 2 ? b : a}"/>`; return s; }
    case "paly": { let s = ""; for (let i = 0; i < n; i++) s += `<rect x="${(i * w / n).toFixed(1)}" width="${(w / n + 1).toFixed(1)}" height="${h}" fill="${i % 2 ? b : a}"/>`; return s; }
    case "bendy": { let s = R; const st = (w + h) / n; for (let i = -n; i < n * 2; i++) { if (i % 2) continue; const o = i * st; s += `<path d="M${o} 0 L${o + h} ${h} L${o + h + st} ${h} L${o + st} 0 Z" fill="${b}"/>`; } return `<g>${s}</g>`; }
    case "chevronny": { let s = R; const st = h / (n / 2); for (let i = 0; i < n; i++) { if (i % 2) continue; const y = i * st; s += `<path d="M0 ${y + st} L${w / 2} ${y - st * 0.1} L${w} ${y + st} L${w} ${y + st * 2} L${w / 2} ${y + st * 0.9} L0 ${y + st * 2} Z" fill="${b}"/>`; } return s; }
    case "chequy": { let s = ""; const cx = w / n, cy = h / (n * h / w > 0 ? Math.max(2, Math.round(n * h / w)) : n); const rows = Math.max(2, Math.round(h / cy)); for (let r = 0; r < rows; r++) for (let cX = 0; cX < n; cX++) s += `<rect x="${(cX * cx).toFixed(1)}" y="${(r * cy).toFixed(1)}" width="${(cx + .8).toFixed(1)}" height="${(cy + .8).toFixed(1)}" fill="${(r + cX) % 2 ? b : a}"/>`; return s; }
    case "lozengy": { let s = R; const dx = w / (n / 1.4); for (let i = -1; i < n + 1; i++) for (let j = -1; j < n + 1; j++) { if ((i + j) % 2) continue; const x = i * dx, y = j * dx; s += tri([[x, y - dx], [x + dx, y], [x, y + dx], [x - dx, y]].map(q => q), b); } return s; }
    default:          return R;
  }
}

// ── Ordinaries (with fancy edges on the linear ones) ──
function ordinarySVG(w, h, O) {
  const t = C(O.tincture), ln = O.line, band = Math.min(w, h) * 0.2;
  switch (O.kind) {
    case "chief":  return `<path d="M0 0 H${w} V${band} ${edge(w, band, 0, band, ln)} Z" fill="${t}"/>`;
    case "base":   return `<path d="M0 ${h} H${w} V${h - band} ${edge(w, h - band, 0, h - band, ln)} Z" fill="${t}"/>`;
    case "fess": { const y = h / 2 - band / 2; return `<path d="M0 ${y} ${edge(0, y, w, y, ln)} V${y + band} ${edge(w, y + band, 0, y + band, ln)} Z" fill="${t}"/>`; }
    case "pale": { const x = w / 2 - band / 2; return `<path d="M${x} 0 ${edge(x, 0, x, h, ln)} H${x + band} ${edge(x + band, h, x + band, 0, ln)} Z" fill="${t}"/>`; }
    case "bend":   return `<path d="M0 ${-band} L${w + band} ${h} L${w - band} ${h + band} L${-band} 0 Z" fill="${t}"/>`;
    case "bendSinister": return `<path d="M${w} ${-band} L${-band} ${h} L${-band + band} ${h + band} L${w + band} 0 Z" fill="${t}"/>`;
    case "chevron": return `<path d="M0 ${h} L${w / 2} ${h * 0.4} L${w} ${h} L${w - band} ${h} L${w / 2} ${h * 0.4 + band} L${band} ${h} Z" fill="${t}"/>`;
    case "cross":  { const bx = w / 2 - band / 2, by = h / 2 - band / 2; return `<rect x="${bx}" width="${band}" height="${h}" fill="${t}"/><rect y="${by}" width="${w}" height="${band}" fill="${t}"/>`; }
    case "saltire": return `<path d="M0 0 L${w} ${h} M${w} 0 L0 ${h}" stroke="${t}" stroke-width="${band}"/>`;
    case "pile":   return `<polygon points="0,0 ${w},0 ${w / 2},${h * 0.82}" fill="${t}"/>`;
    case "bordure": return `<path d="${shieldPath(w, h)}" fill="none" stroke="${t}" stroke-width="${band * 0.8}"/>`;
    case "canton": return `<rect width="${w * 0.42}" height="${h * 0.38}" fill="${t}"/>`;
    default: return "";
  }
}

// ── Charges: real icon ART where we have it, procedural for geometric marks ──
function G(kind, cx, cy, r, fill) {
  // 1) detailed user-provided art (recolour the placeholder, keep linework) —
  //    nested at its own viewBox so all internal shading survives
  const det = CHARGE_DETAIL[kind];
  if (det) {
    const box = r * 2.2, F = css(fill);
    // recolour the tincture SLOTS to the shield's tincture (with each slot's
    // brightness factor for shading); #000 linework survives, and inherited
    // (mono-silhouette) paths take the tincture via the container fill.
    let body = det.body;
    if (det.recolor) for (const [c, f] of det.recolor) body = body.split(c).join(shade(fill, f));
    return `<svg x="${(cx - box / 2).toFixed(1)}" y="${(cy - box / 2).toFixed(1)}" width="${box.toFixed(1)}" height="${box.toFixed(1)}" viewBox="${det.vb}" preserveAspectRatio="xMidYMid meet" fill="${F}">${body}</svg>`;
  }
  // 2) flat game-icons silhouette
  const art = CHARGE_ART[kind];
  if (art) {
    // fit the 512-viewBox icon into a box of side ~2r, recoloured to the tincture
    const box = r * 2.05, sc = box / 512, Fa = css(fill);
    let s = `<g transform="translate(${(cx - box / 2).toFixed(1)},${(cy - box / 2).toFixed(1)}) scale(${sc.toFixed(4)})">`;
    for (const d of art) s += `<path d="${d}" fill="${Fa}" stroke="${OUTLINE}" stroke-width="${(2.2 / sc).toFixed(1)}" stroke-linejoin="round" paint-order="stroke"/>`;
    return s + `</g>`;
  }
  const F = css(fill), st = `stroke="${OUTLINE}" stroke-width="${(r * 0.06).toFixed(2)}" stroke-linejoin="round"`;
  const P = d => `<path d="${d}" fill="${F}" ${st}/>`;
  const poly = pts => `<polygon points="${pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ")}" fill="${F}" ${st}/>`;
  const circ = (x, y, rr, f = F) => `<circle cx="${x}" cy="${y}" r="${rr}" fill="${f}" ${st}/>`;
  const starPts = (n, ro, ri) => { const p = []; for (let i = 0; i < n * 2; i++) { const a = -Math.PI / 2 + i * Math.PI / n, rad = i % 2 ? ri : ro; p.push([cx + Math.cos(a) * rad, cy + Math.sin(a) * rad]); } return p; };

  switch (kind) {
    // ── geometric / celestial ──
    case "mullet":  return poly(starPts(5, r, r * 0.42));
    case "estoile": return poly(starPts(6, r, r * 0.34));
    case "sun": { let ray = ""; for (let i = 0; i < 16; i++) { const a = i / 16 * 2 * Math.PI, b = (i + 0.5) / 16 * 2 * Math.PI; ray += `${(cx + Math.cos(a) * r).toFixed(1)},${(cy + Math.sin(a) * r).toFixed(1)} ${(cx + Math.cos(b) * r * 0.66).toFixed(1)},${(cy + Math.sin(b) * r * 0.66).toFixed(1)} `; } return `<polygon points="${ray}" fill="${F}" ${st}/>` + circ(cx, cy, r * 0.52); }
    case "crescent": return `<path d="M${cx + r * 0.2} ${cy - r} A${r} ${r} 0 1 0 ${cx + r * 0.2} ${cy + r} A${r * 0.8} ${r * 0.8} 0 1 1 ${cx + r * 0.2} ${cy - r} Z" fill="${F}" ${st}/>`;
    case "roundel": return circ(cx, cy, r * 0.8);
    case "annulet": return `<circle cx="${cx}" cy="${cy}" r="${r * 0.72}" fill="none" stroke="${F}" stroke-width="${r * 0.26}"/>`;
    case "lozenge": return poly([[cx, cy - r], [cx + r * 0.66, cy], [cx, cy + r], [cx - r * 0.66, cy]]);
    case "escallop": { let ribs = ""; for (let i = -3; i <= 3; i++) ribs += `<line x1="${cx}" y1="${cy + r * 0.55}" x2="${(cx + i * r * 0.22).toFixed(1)}" y2="${(cy - r * 0.5).toFixed(1)}" stroke="${OUTLINE}" stroke-width="${r * 0.05}"/>`; return `<path d="M${cx - r} ${cy + r * 0.5} Q${cx} ${cy - r * 1.15} ${cx + r} ${cy + r * 0.5} Q${cx} ${cy + r * 0.2} ${cx - r} ${cy + r * 0.5} Z" fill="${F}" ${st}/>` + ribs; }
    case "crosslet": return P(`M${cx - r * .18} ${cy - r} H${cx + r * .18} V${cy - r * .18} H${cx + r} V${cy + r * .18} H${cx + r * .18} V${cy + r} H${cx - r * .18} V${cy + r * .18} H${cx - r} V${cy - r * .18} H${cx - r * .18} Z`);
    case "cross":   return P(`M${cx - r * .22} ${cy - r} H${cx + r * .22} V${cy - r * .22} H${cx + r} V${cy + r * .22} H${cx + r * .22} V${cy + r} H${cx - r * .22} V${cy + r * .22} H${cx - r} V${cy - r * .22} H${cx - r * .22} Z`);
    // ── plants ──
    case "fleur": return P(`M${cx} ${cy - r} C${cx + r * .2} ${cy - r * .4} ${cx + r * .1} ${cy} ${cx} ${cy + r * .15} C${cx - r * .1} ${cy} ${cx - r * .2} ${cy - r * .4} ${cx} ${cy - r} Z`)
      + P(`M${cx} ${cy - r * .1} C${cx + r * .8} ${cy - r * .5} ${cx + r * .8} ${cy + r * .5} ${cx + r * .12} ${cy + r * .5} Z`)
      + P(`M${cx} ${cy - r * .1} C${cx - r * .8} ${cy - r * .5} ${cx - r * .8} ${cy + r * .5} ${cx - r * .12} ${cy + r * .5} Z`)
      + `<rect x="${cx - r * .5}" y="${cy + r * .38}" width="${r}" height="${r * .18}" fill="${F}" ${st}/>`
      + P(`M${cx} ${cy + r * .5} L${cx + r * .12} ${cy + r} L${cx - r * .12} ${cy + r} Z`);
    case "rose": { let pt = ""; for (let i = 0; i < 5; i++) { const a = -Math.PI / 2 + i / 5 * 2 * Math.PI; pt += `<circle cx="${(cx + Math.cos(a) * r * .55).toFixed(1)}" cy="${(cy + Math.sin(a) * r * .55).toFixed(1)}" r="${r * .42}" fill="${F}" ${st}/>`; } return pt + circ(cx, cy, r * .3, css(tinctureRGB("or"))); }
    case "garb": { let g = `<path d="M${cx - r * .5} ${cy + r} Q${cx} ${cy + r * 1.15} ${cx + r * .5} ${cy + r} L${cx + r * .34} ${cy - r * .5} Q${cx} ${cy - r} ${cx - r * .34} ${cy - r * .5} Z" fill="${F}" ${st}/>`; g += `<rect x="${cx - r * .55}" y="${cy + r * .28}" width="${r * 1.1}" height="${r * .2}" fill="${css(tinctureRGB("or"))}" ${st}/>`; for (let i = -2; i <= 2; i++) g += `<ellipse cx="${(cx + i * r * .2).toFixed(1)}" cy="${cy - r * .72}" rx="${r * .08}" ry="${r * .22}" fill="${F}" ${st}/>`; return g; }
    case "tree": return circ(cx, cy - r * .28, r * .72) + `<rect x="${cx - r * .13}" y="${cy + r * .2}" width="${r * .26}" height="${r * .8}" fill="${F}" ${st}/>`;
    case "thistle": return circ(cx, cy - r * .3, r * .42) + poly([[cx - r * .4, cy - r * .55], [cx, cy - r * 1.05], [cx + r * .4, cy - r * .55]]) + `<rect x="${cx - r * .1}" y="${cy - r * .1}" width="${r * .2}" height="${r}" fill="${F}" ${st}/>`;
    // ── objects ──
    case "tower": return P(`M${cx - r * .62} ${cy + r} V${cy - r * .35} H${cx - r * .62} V${cy - r * .68} H${cx - r * .32} V${cy - r * .42} H${cx - r * .1} V${cy - r * .68} H${cx + r * .1} V${cy - r * .42} H${cx + r * .32} V${cy - r * .68} H${cx + r * .62} V${cy - r * .35} H${cx + r * .62} V${cy + r} Z`) + `<rect x="${cx - r * .16}" y="${cy + r * .2}" width="${r * .32}" height="${r * .8}" fill="${OUTLINE}"/>`;
    case "key": return `<circle cx="${cx}" cy="${cy - r * .6}" r="${r * .3}" fill="none" stroke="${F}" stroke-width="${r * .16}"/>` + `<rect x="${cx - r * .07}" y="${cy - r * .35}" width="${r * .14}" height="${r * 1.3}" fill="${F}" ${st}/>` + `<rect x="${cx}" y="${cy + r * .55}" width="${r * .34}" height="${r * .13}" fill="${F}" ${st}/>` + `<rect x="${cx}" y="${cy + r * .82}" width="${r * .24}" height="${r * .13}" fill="${F}" ${st}/>`;
    case "sword": return `<rect x="${cx - r * .08}" y="${cy - r}" width="${r * .16}" height="${r * 1.5}" fill="${F}" ${st}/>` + `<rect x="${cx - r * .4}" y="${cy + r * .4}" width="${r * .8}" height="${r * .14}" fill="${F}" ${st}/>` + `<rect x="${cx - r * .1}" y="${cy + r * .54}" width="${r * .2}" height="${r * .45}" fill="${F}" ${st}/>` + poly([[cx - r * .08, cy - r], [cx + r * .08, cy - r], [cx, cy - r * 1.2]]);
    case "crown": return P(`M${cx - r} ${cy + r * .5} L${cx - r} ${cy - r * .3} L${cx - r * .5} ${cy + r * .1} L${cx} ${cy - r * .5} L${cx + r * .5} ${cy + r * .1} L${cx + r} ${cy - r * .3} L${cx + r} ${cy + r * .5} Z`) + `<circle cx="${cx - r}" cy="${cy - r * .3}" r="${r * .12}" fill="${F}" ${st}/><circle cx="${cx + r}" cy="${cy - r * .3}" r="${r * .12}" fill="${F}" ${st}/><circle cx="${cx}" cy="${cy - r * .5}" r="${r * .12}" fill="${F}" ${st}/>`;
    case "anchor": return `<circle cx="${cx}" cy="${cy - r * .82}" r="${r * .2}" fill="none" stroke="${F}" stroke-width="${r * .14}"/>` + `<rect x="${cx - r * .07}" y="${cy - r * .7}" width="${r * .14}" height="${r * 1.5}" fill="${F}" ${st}/>` + `<rect x="${cx - r * .42}" y="${cy - r * .38}" width="${r * .84}" height="${r * .14}" fill="${F}" ${st}/>` + `<path d="M${cx - r * .78} ${cy + r * .3} Q${cx - r * .78} ${cy + r} ${cx} ${cy + r} Q${cx + r * .78} ${cy + r} ${cx + r * .78} ${cy + r * .3}" fill="none" stroke="${F}" stroke-width="${r * .14}"/>`;
    case "horn": return `<path d="M${cx - r} ${cy - r * .5} Q${cx + r} ${cy - r} ${cx + r * .8} ${cy + r * .6} Q${cx} ${cy + r * .3} ${cx - r} ${cy - r * .5} Z" fill="${F}" ${st}/>`;
    case "hammer": return `<rect x="${cx - r * .55}" y="${cy - r * .7}" width="${r * 1.1}" height="${r * .5}" fill="${F}" ${st}/>` + `<rect x="${cx - r * .1}" y="${cy - r * .3}" width="${r * .2}" height="${r * 1.3}" fill="${F}" ${st}/>`;
    case "bell": return P(`M${cx} ${cy - r} C${cx + r * .8} ${cy - r * .7} ${cx + r * .7} ${cy + r * .5} ${cx + r * .9} ${cy + r * .7} H${cx - r * .9} C${cx - r * .7} ${cy + r * .5} ${cx - r * .8} ${cy - r * .7} ${cx} ${cy - r} Z`) + circ(cx, cy + r * .85, r * .16);
    // ── birds / sea beasts ──
    case "eagle": { const head = circ(cx, cy - r * .72, r * .2); const body = P(`M${cx} ${cy - r * .55} C${cx + r * .34} ${cy - r * .2} ${cx + r * .26} ${cy + r * .5} ${cx} ${cy + r * .6} C${cx - r * .26} ${cy + r * .5} ${cx - r * .34} ${cy - r * .2} ${cx} ${cy - r * .55} Z`); const wing = s => P(`M${cx} ${cy - r * .32} L${cx + s * r} ${cy - r * .5} L${cx + s * r} ${cy + r * .06} L${cx + s * r * .28} ${cy + r * .12} Z`); const tail = poly([[cx - r * .2, cy + r * .5], [cx + r * .2, cy + r * .5], [cx + r * .12, cy + r], [cx - r * .12, cy + r]]); const beak = poly([[cx, cy - r * .82], [cx + r * .22, cy - r * .74], [cx, cy - r * .62]]); return wing(-1) + wing(1) + body + head + beak + tail; }
    case "martlet": return P(`M${cx - r} ${cy} Q${cx - r * .2} ${cy - r * .6} ${cx + r * .5} ${cy - r * .3} L${cx + r} ${cy - r * .45} L${cx + r * .6} ${cy + r * .1} Q${cx + r * .2} ${cy + r * .5} ${cx - r} ${cy} Z`) + poly([[cx + r * .95, cy - r * .4], [cx + r * 1.15, cy - r * .35], [cx + r * .95, cy - r * .2]]);
    case "dolphin": return P(`M${cx - r} ${cy} Q${cx - r * .3} ${cy - r} ${cx + r * .6} ${cy - r * .5} Q${cx + r} ${cy - r * .2} ${cx + r * .7} ${cy + r * .3} Q${cx} ${cy + r * .7} ${cx - r} ${cy} Z`) + poly([[cx - r, cy], [cx - r * 1.3, cy - r * .4], [cx - r * 1.3, cy + r * .4]]);
    case "serpent": return `<path d="M${cx - r} ${cy + r * .7} Q${cx - r * 1.1} ${cy - r * .1} ${cx - r * .2} ${cy - r * .1} Q${cx + r * .7} ${cy - r * .1} ${cx + r * .5} ${cy - r * .8} Q${cx + r * .3} ${cy - r * 1.2} ${cx + r} ${cy - r}" fill="none" stroke="${F}" stroke-width="${r * .28}" stroke-linecap="round"/>`;
    // ── quadruped & mythic beasts (shared silhouette + feature flags) ──
    default: {
      const rampant = true;   // fallback silhouette only (real beasts come from CHARGE_ART)
      const wings = kind === "dragon" || kind === "griffin" || kind === "wyvern";
      const antlers = kind === "stag";
      const horns = kind === "bull";
      const beakHead = kind === "griffin";
      let s = "";
      if (rampant) {
        // reared up, facing sinister — the classic lion rampant silhouette
        s += P(`M${cx - r * .1} ${cy + r} L${cx - r * .35} ${cy + r} L${cx - r * .3} ${cy + r * .1} `
          + `L${cx - r * .55} ${cy - r * .1} L${cx - r * .5} ${cy + r * .55} L${cx - r * .75} ${cy + r * .5} `   // foreleg
          + `L${cx - r * .55} ${cy - r * .35} L${cx - r * .8} ${cy - r * .55} L${cx - r * .55} ${cy - r * .6} `   // head/chest
          + `L${cx - r * .3} ${cy - r * .95} L${cx - r * .15} ${cy - r * .5} L${cx + r * .1} ${cy - r * .2} `
          + `L${cx + r * .55} ${cy - r * .35} L${cx + r * .35} ${cy + r * .1} L${cx + r * .55} ${cy + r * .5} `   // hind
          + `L${cx + r * .3} ${cy + r * .5} L${cx + r * .3} ${cy + r} L${cx + r * .05} ${cy + r} L${cx + r * .1} ${cy + r * .2} Z`);
        s += P(`M${cx + r * .5} ${cy - r * .35} Q${cx + r} ${cy - r * .6} ${cx + r * .85} ${cy + r * .1} Q${cx + r * .65} ${cy - r * .1} ${cx + r * .5} ${cy + r * .05} Z`);   // tail
        if (beakHead) s += poly([[cx - r * .8, cy - r * .55], [cx - r * 1.05, cy - r * .5], [cx - r * .78, cy - r * .38]]);
        if (antlers) s += `<path d="M${cx - r * .3} ${cy - r * .95} l${-r * .25} ${-r * .3} m${r * .1} ${r * .1} l${-r * .2} ${r * .02} M${cx - r * .3} ${cy - r * .95} l${r * .1} ${-r * .35} m0 ${r * .12} l${r * .18} ${-r * .05}" stroke="${F}" stroke-width="${r * .07}" fill="none"/>`;
        if (horns) s += `<path d="M${cx - r * .5} ${cy - r * .7} q${-r * .3} ${-r * .1} ${-r * .2} ${r * .2} M${cx - r * .15} ${cy - r * .78} q${r * .3} ${-r * .1} ${r * .2} ${r * .2}" stroke="${F}" stroke-width="${r * .08}" fill="none"/>`;
      } else {
        // passant / statant — walking, in profile
        s += P(`M${cx - r} ${cy - r * .1} L${cx - r * .7} ${cy - r * .45} L${cx - r * .45} ${cy - r * .2} `
          + `L${cx + r * .35} ${cy - r * .3} L${cx + r} ${cy - r * .5} L${cx + r * .8} ${cy - r * .05} `
          + `L${cx + r * .82} ${cy + r} L${cx + r * .52} ${cy + r} L${cx + r * .5} ${cy + r * .2} `
          + `L${cx - r * .1} ${cy + r * .2} L${cx - r * .12} ${cy + r} L${cx - r * .42} ${cy + r} L${cx - r * .45} ${cy + r * .1} L${cx - r} ${cy + r * .1} Z`);
        if (beakHead) s += poly([[cx - r, cy - r * .1], [cx - r * 1.25, cy - r * .05], [cx - r * .98, cy + r * .08]]);
        if (antlers) s += `<path d="M${cx - r * .7} ${cy - r * .45} l${-r * .2} ${-r * .3} m0 ${r * .12} l${-r * .18} 0 M${cx - r * .7} ${cy - r * .45} l${r * .05} ${-r * .34} m0 ${r * .12} l${r * .18} ${-r * .04}" stroke="${F}" stroke-width="${r * .07}" fill="none"/>`;
      }
      if (wings) s += P(`M${cx + r * .05} ${cy - r * .2} L${cx + r * .5} ${cy - r * .9} L${cx + r * .35} ${cy - r * .2} L${cx + r * .7} ${cy - r * .7} L${cx + r * .5} ${cy + r * .05} Z`);
      return s;
    }
  }
}

// place a charge (or arrangement) inside a field box w×h
function placeCharge(prim, w, h) {
  if (!prim) return "";
  const fill = tinctureRGB(prim.tincture);
  const cx = w / 2, cy = h * 0.5, base = Math.min(w, h);
  if (prim.count === 3 && prim.arrangement === "three") {
    const r = base * 0.17;
    return G(prim.charge, w * 0.3, h * 0.3, r, fill, prim.attitude)
      + G(prim.charge, w * 0.7, h * 0.3, r, fill, prim.attitude)
      + G(prim.charge, w * 0.5, h * 0.72, r, fill, prim.attitude);
  }
  if (prim.arrangement === "inPale") {
    const n = prim.count, r = base * 0.16; let s = "";
    for (let i = 0; i < n; i++) s += G(prim.charge, cx, h * (0.28 + 0.44 * (n === 1 ? 0.5 : i / (n - 1))), r, fill, prim.attitude);
    return s;
  }
  return G(prim.charge, cx, cy, base * 0.3, fill, prim.attitude);
}

function semeSVG(seme, w, h) {
  const fill = tinctureRGB(seme.tincture), r = Math.min(w, h) * 0.08; let s = "";
  for (let ry = 0; ry < 5; ry++) for (let cxi = 0; cxi < 4; cxi++) {
    const x = (cxi + (ry % 2 ? 0.5 : 0)) * w / 4 + w / 8, y = (ry + 0.5) * h / 5;
    s += G(seme.charge, x, y, r, fill, null);
  }
  return s;
}

// ── layout ──
const COLS = 6, CELL_W = 210, SW_SHIELD = 156, SH_SHIELD = 176, LABEL_H = 66;
const CELL_H = SH_SHIELD + LABEL_H + 20, PAD = 26;
const rows = Math.ceil(realms.length / COLS);
const SW = COLS * CELL_W + PAD * 2, SHt = rows * CELL_H + PAD * 2 + 44;

let body = "";
realms.forEach((r, i) => {
  const arms = armsForCountry(world, r.c); if (!arms) return;
  const col = i % COLS, row = (i / COLS) | 0;
  const ox = PAD + col * CELL_W + (CELL_W - SW_SHIELD) / 2, oy = PAD + 36 + row * CELL_H;
  const flag = arms.style === "flag";
  let w = SW_SHIELD, h = flag ? Math.round(SW_SHIELD * 0.66) : SH_SHIELD;
  const shape = flag ? `M0 0 H${w} V${h} H0 Z` : shieldPath(w, h);
  const clip = `c${uid++}`;

  let inner = fieldSVG(w, h, arms.field);
  if (arms.seme) inner += semeSVG(arms.seme, w, h);
  if (arms.ordinary) inner += ordinarySVG(w, h, arms.ordinary);
  if (arms.onOrdinary && arms.ordinary) {
    const kind = arms.ordinary.kind, n = arms.onOrdinary.count;
    const rr = Math.min(w, h) * 0.058, fill = tinctureRGB(arms.onOrdinary.tincture);
    const oyB = kind === "chief" ? h * 0.1 : kind === "base" ? h * 0.9 : h * 0.5;   // band centre-line
    if (kind === "pale") for (let k = 0; k < n; k++) inner += G(arms.onOrdinary.charge, w * 0.5, h * (0.2 + 0.6 * (n === 1 ? .5 : k / (n - 1))), rr, fill, null);
    else for (let k = 0; k < n; k++) inner += G(arms.onOrdinary.charge, w * (0.5 + (k - (n - 1) / 2) * 0.22), oyB, rr, fill, null);
  }
  if (arms.primary) inner += placeCharge(arms.primary, w, h);
  if (arms.cadency) inner += G(arms.cadency.mark === "label" ? "crosslet" : arms.cadency.mark, w / 2, h * 0.16, Math.min(w, h) * 0.07, tinctureRGB(arms.cadency.tincture), null);

  const frame = flag
    ? `<rect x="-1" y="-1" width="${w + 2}" height="${h + 2}" fill="none" stroke="#12100f" stroke-width="2"/>`
    : `<path d="${shape}" fill="none" stroke="#12100f" stroke-width="3"/>`;

  body += `<g transform="translate(${ox},${oy})"><clipPath id="${clip}"><path d="${shape}"/></clipPath>`
    + `<g clip-path="url(#${clip})">${inner}</g>${frame}</g>`;

  const m = arms.meta, lx = PAD + col * CELL_W + CELL_W / 2, ly = oy + h + 18;
  const L = (dy, s, o) => `<text x="${lx}" y="${ly + dy}" text-anchor="middle" font-family="Georgia,serif" ${o}>${esc(s)}</text>`;
  body += L(0, m.realm, `font-size="13" font-weight="bold" fill="#eee"`);
  body += L(15, `${m.house ? m.house + " · " : ""}${m.people}`, `font-size="10" fill="#b9b2a6"`);
  body += L(29, `${flag ? "flag" : "arms"}${m.faith ? " · " + m.faith : ""}${m.gov ? " · " + m.gov : ""}`, `font-size="9.5" fill="#8f8a7e" font-style="italic"`);
  body += L(44, blazon(arms), `font-size="8" fill="#726d62"`);
});

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SW}" height="${SHt}" viewBox="0 0 ${SW} ${SHt}">`
  + `<rect width="${SW}" height="${SHt}" fill="#20242c"/>`
  + `<text x="${SW / 2}" y="30" text-anchor="middle" font-family="Georgia,serif" font-size="18" fill="#e8e2d4">Emergent heraldry — seed ${SEED}, step ${STEP} · ${realms.length} houses</text>`
  + body + `</svg>`;
writeFileSync(OUT, svg);
console.log(`[svg] ${OUT}  (${SW}×${SHt}, ${realms.length} realms)`);

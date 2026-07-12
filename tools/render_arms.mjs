// Preview sheet for the emergent heraldry (src/sim/heraldry.js): run a world,
// then draw each major realm's projected coat of arms / national flag as SVG so
// we can eyeball it — do kin realms rhyme, do co-religionists share a device,
// does the arms→flag form track development? Nothing here is wired into the sim;
// it only READS armsOf().
//
//   node tools/render_arms.mjs [step] [seed] [N] [out.svg]
//   (SVG renders directly; no PNG step needed.)

import { writeFileSync } from "node:fs";
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { armsOf, blazon, tinctureRGB } from "../src/sim/heraldry.js";

const STEP = +(process.argv[2] || 14000);
const SEED = +(process.argv[3] || 8817);
const N    = +(process.argv[4] || 24);
const OUT  = process.argv[5] || "/tmp/claude-0/-home-user-Simman-/0dce9194-9863-5d0c-9a8a-3f95cac87b93/scratchpad/arms.svg";
const W = 480, H = 240;

// ── run the world ──
const world = buildSim({ W, H, seed: SEED });
const t0 = Date.now();
for (let s = 1; s <= STEP; s++) {
  stepPeopleSim(world, 1);
  if (s % 2000 === 0) process.stderr.write(`  step ${s}/${STEP} — countries ${world.countries ? world.countries.size : 0}\n`);
}
process.stderr.write(`  ran ${STEP} steps in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);

// ── pick the major realms (by total settled population) ──
const realms = [...world.countries.values()]
  .map(c => {
    let pop = 0, mem = 0;
    for (const s of (c.members || [])) if (s.mode === "settled") { pop += s.people || 0; mem++; }
    return { c, pop, mem };
  })
  .filter(r => r.mem >= 1 && r.c.capital)
  .sort((a, b) => b.pop - a.pop)
  .slice(0, N);

process.stderr.write(`  drawing ${realms.length} realms\n`);

// HDEBUG=1 → dump the palette drivers per realm, to check material vs faith balance
if (process.env.HDEBUG) {
  const { armsOf: _a } = await import("../src/sim/heraldry.js");
  for (const r of realms) {
    const c = r.c, cap = c.capital;
    const lr = cap.localRes || {};
    const pick = k => (lr[k] || 0).toFixed(2);
    const a = _a(world, c);
    process.stderr.write(`  ${(a.provenance.realm + "").padEnd(14)} water=${(cap.waterAccess || 0).toFixed(2)} `
      + `dye=${pick("dyes")} prec=${pick("precious")} iron=${pick("iron")} tim=${pick("timber")} salt=${pick("salt")} fur=${pick("furs")} `
      + `→ ${a.tinctures.field}/${a.charge} [${a.provenance.faith || "folk"} ${a.provenance.personality}]\n`);
  }
}

// ── SVG helpers ──
const esc = s => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const css = ([r, g, b]) => `rgb(${r},${g},${b})`;
const OUTLINE = "rgba(22,18,24,0.85)";     // fimbriation / charge outline — legible on any tincture

// Escutcheon (heater shield) path for a W×H box at (0,0).
function shieldPath(w, h) {
  const s = h * 0.60;
  return `M0 0 H${w} V${s} Q${w} ${h * 0.86} ${w / 2} ${h} Q0 ${h * 0.86} 0 ${s} Z`;
}

// A field division drawn inside a clip: base = field tincture, overlay = companion.
function fieldSVG(w, h, division, field, companion) {
  const F = css(tinctureRGB(field)), C = css(tinctureRGB(companion));
  let g = `<rect width="${w}" height="${h}" fill="${F}"/>`;
  switch (division) {
    case "perPale":   g += `<rect x="${w / 2}" width="${w / 2}" height="${h}" fill="${C}"/>`; break;
    case "perFess":   g += `<rect y="${h / 2}" width="${w}" height="${h / 2}" fill="${C}"/>`; break;
    case "chief":     g += `<rect width="${w}" height="${h * 0.30}" fill="${C}"/>`; break;
    case "bend":      g += `<path d="M0 0 L${w * 0.42} 0 L${w} ${h * 0.58} L${w} ${h} L${w * 0.58} ${h} L0 ${h * 0.42} Z" fill="${C}"/>`; break;
    case "quarterly": g += `<rect x="${w / 2}" width="${w / 2}" height="${h / 2}" fill="${C}"/>`
                        + `<rect y="${h / 2}" width="${w / 2}" height="${h / 2}" fill="${C}"/>`; break;
    default: break;   // plain
  }
  return g;
}

// ── Charges: simple, legible heraldic glyphs centred at (cx,cy), radius r ──
function charge(kind, cx, cy, r, fill) {
  const F = css(fill), st = `stroke="${OUTLINE}" stroke-width="${(r * 0.07).toFixed(2)}" stroke-linejoin="round"`;
  const P = (d) => `<path d="${d}" fill="${F}" ${st}/>`;
  const poly = (pts) => `<polygon points="${pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ")}" fill="${F}" ${st}/>`;
  switch (kind) {
    case "sun": {
      let rays = "";
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2, x1 = cx + Math.cos(a) * r, y1 = cy + Math.sin(a) * r;
        const x2 = cx + Math.cos(a) * r * 0.62, y2 = cy + Math.sin(a) * r * 0.62;
        const a2 = ((i + 0.5) / 12) * Math.PI * 2, xm = cx + Math.cos(a2) * r * 0.62, ym = cy + Math.sin(a2) * r * 0.62;
        rays += `${x1.toFixed(1)},${y1.toFixed(1)} ${xm.toFixed(1)},${ym.toFixed(1)} `;
      }
      return `<polygon points="${rays}" fill="${F}" ${st}/><circle cx="${cx}" cy="${cy}" r="${r * 0.5}" fill="${F}" ${st}/>`;
    }
    case "star": {
      const pts = [];
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + i * Math.PI / 5, rad = i % 2 ? r * 0.42 : r;
        pts.push([cx + Math.cos(a) * rad, cy + Math.sin(a) * rad]);
      }
      return poly(pts);
    }
    case "crescent":
      return `<path d="M${cx + r * 0.15} ${cy - r} A${r} ${r} 0 1 0 ${cx + r * 0.15} ${cy + r} A${r * 0.78} ${r * 0.78} 0 1 1 ${cx + r * 0.15} ${cy - r} Z" fill="${F}" ${st}/>`;
    case "cross":
      return `<path d="M${cx - r * 0.28} ${cy - r} H${cx + r * 0.28} V${cy - r * 0.28} H${cx + r} V${cy + r * 0.28} H${cx + r * 0.28} V${cy + r} H${cx - r * 0.28} V${cy + r * 0.28} H${cx - r} V${cy - r * 0.28} H${cx - r * 0.28} Z" fill="${F}" ${st}/>`;
    case "roundel":
      return `<circle cx="${cx}" cy="${cy}" r="${r * 0.8}" fill="${F}" ${st}/>`;
    case "mountain":
      return poly([[cx - r, cy + r * 0.7], [cx - r * 0.5, cy - r * 0.2], [cx - r * 0.15, cy + r * 0.25],
        [cx + r * 0.1, cy - r], [cx + r * 0.55, cy + r * 0.1], [cx + r, cy + r * 0.7]]);
    case "tower":
      return P(`M${cx - r * 0.6} ${cy + r} V${cy - r * 0.4} H${cx - r * 0.6} V${cy - r * 0.7} H${cx - r * 0.3} V${cy - r * 0.45} H${cx} V${cy - r * 0.7} H${cx + r * 0.3} V${cy - r * 0.45} H${cx + r * 0.6} V${cy - r * 0.7} H${cx + r * 0.6} V${cy + r} Z`);
    case "tree":
      return `<circle cx="${cx}" cy="${cy - r * 0.25}" r="${r * 0.7}" fill="${F}" ${st}/><rect x="${cx - r * 0.13}" y="${cy + r * 0.2}" width="${r * 0.26}" height="${r * 0.8}" fill="${F}" ${st}/>`;
    case "grain": {
      // a wheat ear: a stem with paired kernels angled upward
      let g = `<rect x="${cx - r * 0.05}" y="${cy - r * 0.4}" width="${r * 0.1}" height="${r * 1.4}" fill="${F}" ${st}/>`;
      for (let i = 0; i < 5; i++) {
        const y = cy - r * 0.45 + i * r * 0.33;
        g += `<ellipse cx="${cx}" cy="${y}" rx="${r * 0.12}" ry="${r * 0.3}" fill="${F}" ${st} transform="rotate(32 ${cx} ${y})"/>`;
        g += `<ellipse cx="${cx}" cy="${y}" rx="${r * 0.12}" ry="${r * 0.3}" fill="${F}" ${st} transform="rotate(-32 ${cx} ${y})"/>`;
      }
      g += `<ellipse cx="${cx}" cy="${cy - r * 0.72}" rx="${r * 0.11}" ry="${r * 0.28}" fill="${F}" ${st}/>`;
      return g;
    }
    case "ship":
      return `<path d="M${cx - r} ${cy + r * 0.35} H${cx + r} L${cx + r * 0.65} ${cy + r} H${cx - r * 0.65} Z" fill="${F}" ${st}/>`
        + `<rect x="${cx - r * 0.06}" y="${cy - r}" width="${r * 0.12}" height="${r * 1.35}" fill="${F}" ${st}/>`
        + `<path d="M${cx + r * 0.06} ${cy - r * 0.9} L${cx + r * 0.75} ${cy + r * 0.1} L${cx + r * 0.06} ${cy + r * 0.1} Z" fill="${F}" ${st}/>`;
    case "anchor":
      return `<circle cx="${cx}" cy="${cy - r * 0.8}" r="${r * 0.22}" fill="none" stroke="${F}" stroke-width="${r * 0.16}"/>`
        + `<rect x="${cx - r * 0.08}" y="${cy - r * 0.7}" width="${r * 0.16}" height="${r * 1.5}" fill="${F}" ${st}/>`
        + `<rect x="${cx - r * 0.45}" y="${cy - r * 0.35}" width="${r * 0.9}" height="${r * 0.16}" fill="${F}" ${st}/>`
        + `<path d="M${cx - r * 0.8} ${cy + r * 0.35} Q${cx - r * 0.8} ${cy + r} ${cx} ${cy + r} Q${cx + r * 0.8} ${cy + r} ${cx + r * 0.8} ${cy + r * 0.35}" fill="none" stroke="${F}" stroke-width="${r * 0.16}"/>`;
    case "fish":
      return `<ellipse cx="${cx + r * 0.15}" cy="${cy}" rx="${r * 0.8}" ry="${r * 0.42}" fill="${F}" ${st}/>`
        + poly([[cx - r * 0.6, cy], [cx - r, cy - r * 0.45], [cx - r, cy + r * 0.45]]);
    case "eagle": {
      // an eagle displayed: a body with a head, two spread wings and a tail
      const head = `<circle cx="${cx}" cy="${cy - r * 0.72}" r="${r * 0.2}" fill="${F}" ${st}/>`;
      const body = `<path d="M${cx} ${cy - r * 0.55} C${cx + r * 0.34} ${cy - r * 0.2} ${cx + r * 0.26} ${cy + r * 0.5} ${cx} ${cy + r * 0.6} C${cx - r * 0.26} ${cy + r * 0.5} ${cx - r * 0.34} ${cy - r * 0.2} ${cx} ${cy - r * 0.55} Z" fill="${F}" ${st}/>`;
      const wing = (sgn) => `<path d="M${cx} ${cy - r * 0.32} L${cx + sgn * r} ${cy - r * 0.5} L${cx + sgn * r} ${cy + r * 0.06} L${cx + sgn * r * 0.28} ${cy + r * 0.12} Z" fill="${F}" ${st}/>`;
      const tail = poly([[cx - r * 0.2, cy + r * 0.5], [cx + r * 0.2, cy + r * 0.5], [cx + r * 0.12, cy + r], [cx - r * 0.12, cy + r]]);
      return wing(-1) + wing(1) + body + head + tail;
    }
    case "wolf":
    case "lion":
    default: {
      // a generic quadruped beast (lion passant / wolf), facing left
      return P(`M${cx - r} ${cy - r * 0.15} `
        + `L${cx - r * 0.72} ${cy - r * 0.55} L${cx - r * 0.5} ${cy - r * 0.2} `   // head
        + `L${cx + r * 0.2} ${cy - r * 0.35} L${cx + r} ${cy - r * 0.55} `          // back + raised tail
        + `L${cx + r * 0.75} ${cy - r * 0.1} L${cx + r * 0.8} ${cy + r} `           // hind leg
        + `L${cx + r * 0.5} ${cy + r} L${cx + r * 0.45} ${cy + r * 0.25} `
        + `L${cx - r * 0.15} ${cy + r * 0.25} L${cx - r * 0.2} ${cy + r} `          // fore leg
        + `L${cx - r * 0.5} ${cy + r} L${cx - r * 0.55} ${cy + r * 0.1} `
        + `L${cx - r} ${cy + r * 0.1} Z`);
    }
  }
}

// ── lay the sheet out ──
const COLS = 6;
const CELL_W = 200, SHIELD_W = 150, SHIELD_H = 168, LABEL_H = 64;
const CELL_H = SHIELD_H + LABEL_H + 18;
const PAD = 24;
const rows = Math.ceil(realms.length / COLS);
const SW = COLS * CELL_W + PAD * 2;
const SH = rows * CELL_H + PAD * 2 + 40;

let body = "";
realms.forEach((r, i) => {
  const arms = armsOf(world, r.c);
  if (!arms) return;
  const col = i % COLS, row = (i / COLS) | 0;
  const ox = PAD + col * CELL_W + (CELL_W - SHIELD_W) / 2;
  const oy = PAD + 34 + row * CELL_H;
  const t = arms.tinctures;
  const clipId = `clip${i}`;

  // shape: escutcheon for arms, a 3:2 banner for a national flag
  let w = SHIELD_W, h = SHIELD_H, shapePath, frame;
  if (arms.style === "flag") {
    w = SHIELD_W; h = Math.round(SHIELD_W * 0.66);
    shapePath = `M0 0 H${w} V${h} H0 Z`;
    frame = `<rect x="-1" y="-1" width="${w + 2}" height="${h + 2}" fill="none" stroke="#141018" stroke-width="2"/>`;
  } else {
    shapePath = shieldPath(w, h);
    frame = `<path d="${shapePath}" fill="none" stroke="#141018" stroke-width="3"/>`;
  }

  const cx = w / 2, cy = h * (arms.style === "flag" ? 0.5 : 0.46), cr = Math.min(w, h) * 0.26;
  const bordure = arms.style === "arms" && arms.complexity > 0.6
    ? `<path d="${shapePath}" fill="none" stroke="${css(tinctureRGB(t.detail))}" stroke-width="${SHIELD_W * 0.06}"/>` : "";

  body += `<g transform="translate(${ox},${oy})">`
    + `<clipPath id="${clipId}"><path d="${shapePath}"/></clipPath>`
    + `<g clip-path="url(#${clipId})">`
    + fieldSVG(w, h, arms.division, t.field, t.companion)
    + charge(arms.charge, cx, cy, cr, tinctureRGB(t.charge))
    + bordure
    + `</g>` + frame + `</g>`;

  // labels
  const p = arms.provenance;
  const lx = PAD + col * CELL_W + CELL_W / 2, ly = oy + h + 18;
  const line = (dy, s, opts = "") => `<text x="${lx}" y="${ly + dy}" text-anchor="middle" font-family="Georgia, serif" ${opts}>${esc(s)}</text>`;
  body += line(0, p.realm, `font-size="13" font-weight="bold" fill="#eee"`);
  body += line(15, `${p.people} · ${p.personality}${p.gov ? " · " + p.gov : ""}`, `font-size="10" fill="#b9b2a6"`);
  body += line(29, `${arms.style === "flag" ? "flag" : "arms"} · ${p.faith ? p.faith : "folk"}${p.distinctPeoples > 1 ? " · " + p.distinctPeoples + " peoples" : ""}`, `font-size="10" fill="#8f8a7e" font-style="italic"`);
  body += line(43, blazon(arms), `font-size="8.5" fill="#726d62"`);
});

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SW}" height="${SH}" viewBox="0 0 ${SW} ${SH}">`
  + `<rect width="${SW}" height="${SH}" fill="#20242c"/>`
  + `<text x="${SW / 2}" y="30" text-anchor="middle" font-family="Georgia, serif" font-size="18" fill="#e8e2d4">Emergent heraldry — seed ${SEED}, step ${STEP} · ${realms.length} realms</text>`
  + body + `</svg>`;

writeFileSync(OUT, svg);
console.log(`[svg] ${OUT}  (${SW}×${SH}, ${realms.length} realms)`);

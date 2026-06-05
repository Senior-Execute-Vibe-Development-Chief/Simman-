// Offline preview of the tech-tree overlay (tech.js) — renders the SVG for a
// few sample knowledge vectors using the SAME techLayout() the live React
// overlay uses, so this preview can't drift from what the app draws. Writes one
// SVG per sample to /tmp; convert to PNG with cairosvg in the shell.
//   node tools/render_tech.mjs
import { writeFileSync } from "fs";
import { TECHS, ERAS, TECH_IDX, techState, techNodeState, techLayout, techEdgePath } from "../src/peopleSim/tech.js";

const ERA_BG = ["#b7b0a2","#cf9a63","#dab347","#86a98f","#b596c4","#8fa6bb","#d9e2ea"];
const esc = s => String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");

function svgFor(title, k) {
  const ts = techState(k);
  const L = techLayout();
  const { pos, NW, NH, MX, TOP, W, H } = L;
  const HH = H + 26;                       // a little extra for the title line
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${HH}">`;
  s += `<rect width="${W}" height="${HH}" fill="#f4ecd9"/>`;
  s += `<text x="${MX}" y="16" font-family="sans-serif" font-size="13" font-weight="bold" fill="#3a2c18">${esc(title)} — ${ERAS[ts.era]} · ${ts.count}/${TECHS.length} discovered</text>`;
  s += `<g transform="translate(0,22)">`;
  // era labels at the centroid column of each era's techs
  ERAS.forEach((e, ei) => {
    let sx = 0, n = 0; for (const t of TECHS) if (t.era === ei) { const pp = pos[t.id]; if (pp) { sx += pp.x+NW/2; n++; } }
    if (!n) return; const cx = sx/n;
    s += `<rect x="${cx-46}" y="${TOP-26}" width="92" height="3" fill="${ERA_BG[ei]}" rx="1.5"/>`;
    s += `<text x="${cx}" y="${TOP-12}" text-anchor="middle" font-family="sans-serif" font-size="11" font-weight="bold" fill="#5a4a32" letter-spacing="0.5">${esc(e.toUpperCase())}</text>`;
  });
  // prereq edges — orthogonal right-angle routing with row-gutter lanes + stagger
  for (const t of TECHS) for (const p of t.prereq) {
    const a = pos[p], b = pos[t.id]; if (!a || !b) continue;
    const open = ts.have[TECH_IDX[p]] === 1;
    const stag = (TECH_IDX[p]*3 + TECH_IDX[t.id]) % 5;
    s += `<path d="${techEdgePath(a, b, L, stag)}" fill="none" stroke="${open?"#7a5c34":"rgba(120,100,70,0.32)"}" stroke-width="${open?1.7:1}" ${open?"":'stroke-dasharray="3 3"'}/>`;
  }
  // nodes (opaque fills occlude the links routed behind them)
  for (const t of TECHS) {
    const p = pos[t.id]; const ns = techNodeState(k, ts.have, t); const era = ERA_BG[t.era] || "#b9b2a4";
    let fill, stroke, txt, sw, dash = "";
    if (ns.state === "have") { fill = era; stroke = "#3a2c18"; txt = "#1a140c"; sw = 1.1; }
    else if (ns.state === "next") { fill = "#fffaf0"; stroke = era; txt = "#2c2114"; sw = 2; }
    else { fill = "#e9e1ce"; stroke = "rgba(90,75,50,0.42)"; txt = "rgba(70,58,40,0.62)"; sw = 1; dash = '4 3'; }
    s += `<rect x="${p.x}" y="${p.y}" width="${NW}" height="${NH}" rx="5" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" ${dash?`stroke-dasharray="${dash}"`:""}/>`;
    s += `<text x="${p.x+7}" y="${p.y+NH/2+3.2}" font-family="sans-serif" font-size="9" fill="${txt}" ${ns.state==="have"?'font-weight="bold"':""}>${esc(t.name)}</text>`;
    if (ns.state === "next") s += `<rect x="${p.x+1}" y="${p.y+NH-3}" width="${(NW-2)*ns.prog}" height="2.4" fill="${era}" rx="1.2"/>`;
  }
  s += `</g></svg>`;
  return s;
}

const samples = [
  ["Bronze coastal city",   { agriculture:0.62, construction:0.52, organization:0.48, metallurgy:0.52, navigation:0.62, mobility:0.20 }],
  ["Iron horse empire",     { agriculture:0.82, construction:0.74, organization:0.78, metallurgy:0.86, navigation:0.10, mobility:0.86 }],
  ["Industrial metropolis", { agriculture:0.96, construction:0.96, organization:1.00, metallurgy:0.97, navigation:0.94, mobility:0.72 }],
];
for (const [title, k] of samples) {
  const path = `/tmp/tech_${title.replace(/\s+/g,"_")}.svg`;
  writeFileSync(path, svgFor(title, k));
  console.log(path);
}

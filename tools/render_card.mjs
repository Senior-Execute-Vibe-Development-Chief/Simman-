// Static preview of the tech tree's hover card (the in-app card is HTML; this
// mirrors its design as SVG so we can eyeball it). One card per sample tech.
//   node tools/render_card.mjs   (then cairosvg the output)
import { writeFileSync } from "fs";
import { TECHS, ERAS, TECH_IDX, techEffectList } from "../src/peopleSim/tech.js";

const ERA_BG = ["#b7b0a2","#cf9a63","#dab347","#86a98f","#b596c4","#8fa6bb","#d9e2ea"];
const FX_COLOR = { farm:"#5f7d33",fish:"#2f7d8a",build:"#9a6f38",military:"#9c3a36",reach:"#6a4a8d",cohesion:"#9a6a33",defense:"#566089",trade:"#2f7d5a",wealth:"#9a7a24",seaSpeed:"#2f6d8a",seaRange:"#2f6d8a",embark:"#2f7d8a",ocean:"#2a6a8a",colonize:"#2a6a8a",walls:"#566089",market:"#2f7d5a" };
const esc = s => String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
const wrap = (s, n) => { const w = s.split(" "); const out = []; let cur = ""; for (const x of w) { if ((cur + " " + x).trim().length > n) { out.push(cur.trim()); cur = x; } else cur += " " + x; } if (cur.trim()) out.push(cur.trim()); return out; };

const CW = 250, PAD = 12, GAP = 18;
const ids = ["masonry", "currency", "caravels", "iron_working", "gunpowder", "fertilizers"];
let cards = "", x = GAP, maxH = 0;
for (const id of ids) {
  const t = TECHS[TECH_IDX[id]]; const fx = techEffectList(id);
  const descL = wrap(t.desc, 36);
  // chip layout (wrap)
  let cx = PAD, cy = 0, chipRows = 1; const chips = [];
  for (const e of fx) { const w = 13 + e.text.length * 5.4; if (cx + w > CW - PAD && cx > PAD) { cx = PAD; cy += 19; chipRows++; } chips.push({ e, x: cx, y: cy }); cx += w + 4; }
  const yName = 22, yEra = 38, yDesc = 54, yChips = yDesc + descL.length * 14 + 4, yReq = yChips + chipRows * 19 + 4;
  const H = (t.prereq.length ? yReq + 16 : yChips + chipRows * 19 + 6);
  maxH = Math.max(maxH, H);
  let c = `<g transform="translate(${x},${GAP})">`;
  c += `<rect width="${CW}" height="${H}" rx="7" fill="#f6eeda" stroke="${ERA_BG[t.era]}" stroke-width="2"/>`;
  c += `<text x="${PAD}" y="${yName}" font-family="sans-serif" font-size="14" font-weight="bold" fill="#2c2114">${esc(t.name)}</text>`;
  c += `<text x="${PAD}" y="${yEra}" font-family="sans-serif" font-size="9.5" letter-spacing="0.5" fill="#8a7a55">${esc(ERAS[t.era].toUpperCase())} · DISCOVERED</text>`;
  descL.forEach((l, i) => { c += `<text x="${PAD}" y="${yDesc + i*14}" font-family="sans-serif" font-size="10.5" fill="#473a28">${esc(l)}</text>`; });
  for (const { e, x: chx, y: chy } of chips) { const w = 13 + e.text.length * 5.4; c += `<rect x="${chx}" y="${yChips - 12 + chy}" width="${w}" height="15" rx="3" fill="${FX_COLOR[e.key] || "#6a5a3a"}" opacity="${e.good ? 1 : 0.85}"/><text x="${chx + w/2}" y="${yChips - 1 + chy}" text-anchor="middle" font-family="sans-serif" font-size="9.5" font-weight="600" fill="#fff">${esc(e.text)}</text>`; }
  if (t.prereq.length) c += `<text x="${PAD}" y="${yReq}" font-family="sans-serif" font-size="9.5" fill="#7a6a48">Requires: ${esc(t.prereq.map(p => TECHS[TECH_IDX[p]].name).join(" + "))}</text>`;
  c += `</g>`; cards += c; x += CW + GAP;
}
const W = x, Hh = maxH + GAP * 2;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${Hh}"><rect width="${W}" height="${Hh}" fill="#3a3025"/>${cards}</svg>`;
writeFileSync("/tmp/tech_cards.svg", svg);
console.log("/tmp/tech_cards.svg", W + "x" + Hh);

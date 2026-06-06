// Preview of the tree's "Stacked tech bonuses" strip for a few civilisations.
//   node tools/render_totals.mjs   (then cairosvg)
import { writeFileSync } from "fs";
import { techState, techTotalList } from "../src/peopleSim/tech.js";

const FX_COLOR = { farm:"#5f7d33",fish:"#2f7d8a",build:"#9a6f38",military:"#9c3a36",reach:"#6a4a8d",cohesion:"#9a6a33",defense:"#566089",trade:"#2f7d5a",wealth:"#9a7a24",seaSpeed:"#2f6d8a",seaRange:"#2f6d8a",embark:"#2f7d8a",ocean:"#2a6a8a",colonize:"#2a6a8a",walls:"#566089",market:"#2f7d5a" };
const esc = s => String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
const civs = [
  ["Industrial metropolis", { agriculture:0.96, construction:0.96, organization:1.0, metallurgy:0.97, navigation:0.96, mobility:0.6 }],
  ["Iron horse empire (landlocked)", { agriculture:0.82, construction:0.74, organization:0.78, metallurgy:0.86, navigation:0.08, mobility:0.86 }],
  ["Bronze coastal city", { agriculture:0.55, construction:0.5, organization:0.45, metallurgy:0.5, navigation:0.6, mobility:0.15 }],
];
const W = 1180, PAD = 16, ROWH = 22, LABELH = 22;
let body = "", y = PAD;
for (const [name, k] of civs) {
  const tot = techTotalList(techState(k).have);
  body += `<text x="${PAD}" y="${y + 13}" font-family="sans-serif" font-size="13" font-weight="bold" fill="#f0e6cf">${esc(name)}</text>`;
  y += LABELH;
  let cx = PAD, cy = y;
  for (const e of tot) {
    const w = 14 + e.text.length * 6.0;
    if (cx + w > W - PAD && cx > PAD) { cx = PAD; cy += ROWH; }
    body += `<rect x="${cx}" y="${cy}" width="${w}" height="17" rx="3.5" fill="${FX_COLOR[e.key] || "#6a5a3a"}" opacity="${e.good ? 1 : 0.85}"/>`;
    body += `<text x="${cx + w/2}" y="${cy + 12.5}" text-anchor="middle" font-family="sans-serif" font-size="10.5" font-weight="600" fill="#fff">${esc(e.text)}</text>`;
    cx += w + 5;
  }
  y = cy + ROWH + 12;
}
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${y}"><rect width="${W}" height="${y}" fill="#2c241b"/>${body}</svg>`;
writeFileSync("/tmp/tech_totals.svg", svg);
console.log("/tmp/tech_totals.svg", W + "x" + y);

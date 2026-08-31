// Procedural aesthetic preview (`src/sim/aestheticRender.js`).
//   node tools/render_aesthetics.mjs [out.svg]
import { writeFileSync } from "node:fs";
import { buildWorld as pipelineBuild } from "../src/sim/pipeline.js";
import { foundAestheticIdentity, expressAesthetic } from "../src/sim/aestheticIdentity.js";
import { drawAesthetic } from "../src/sim/aestheticRender.js";

const OUT = process.argv[2] || "/tmp/aesthetics.svg";
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");

const { ter } = pipelineBuild({ W: 240, H: 120, seed: 7, preset: "earth_sim" });
const world = { ancHomelands: ter.ancHomelands };

const bags = [
  {
    name: "hot-humid plain",
    ctx: {
      temp: 0.86, moist: 0.62, wealth: 0.15, ancMix: [[0, 1]], world,
      materials: { fibres: [{ id: "cotton" }], trees: [{ id: "palm" }] },
    },
    axes: { austerity: 0.7, pastoral: 0.5 },
    seed: 11,
  },
  {
    name: "hot-dry court",
    ctx: {
      temp: 0.86, moist: 0.12, wealth: 0.65, ancMix: [[1, 1]], world,
      materials: { fibres: [{ id: "flax" }], earths: [{ id: "clay" }], dyes: [{ id: "tyrian" }] },
    },
    axes: { arid: 0.8, regal: 0.75, colour: 0.7 },
    seed: 22,
  },
  {
    name: "cold wool hall",
    ctx: {
      temp: 0.56, moist: 0.50, wealth: 0.78, elev: 0.12, ancMix: [[2, 1]], world,
      materials: { fibres: [{ id: "wool" }], trees: [{ id: "oak" }], stone: [{ id: "granite" }] },
    },
    axes: { austerity: 0.55, pastoral: 0.6 },
    seed: 33,
  },
  {
    name: "silk courtyard",
    ctx: {
      temp: 0.76, moist: 0.55, wealth: 0.70, ancMix: [[3, 1]], world,
      materials: { fibres: [{ id: "silk" }], trees: [{ id: "oak" }], dyes: [{ id: "indigo" }] },
    },
    axes: { ornament: 0.85, regal: 0.8, colour: 0.75, pattern: 0.7 },
    seed: 44,
  },
  {
    name: "steppe tent",
    ctx: {
      temp: 0.62, moist: 0.28, wealth: 0.25, horses: 0.4, open: true, ancMix: [[4, 1]], world,
      materials: { fibres: [{ id: "wool" }] },
    },
    axes: { pastoral: 0.85, austerity: 0.4 },
    seed: 55,
  },
];

const CELL_W = 168, CELL_H = 210, GAP = 12, PAD = 20;
const cols = bags.length;
const W = PAD * 2 + cols * CELL_W + (cols - 1) * GAP;
const H = PAD * 2 + CELL_H + 28;

let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <rect width="100%" height="100%" fill="#ece8df"/>
  <text x="${W / 2}" y="16" text-anchor="middle" font-size="12" fill="#444" font-family="system-ui,sans-serif">Aesthetic renderer v0 — face + dress + built from expressAesthetic()</text>`;

bags.forEach((bag, i) => {
  const id = foundAestheticIdentity(bag.seed, bag.axes);
  const aesthetic = expressAesthetic(bag.ctx, id);
  const x = PAD + i * (CELL_W + GAP);
  const y = PAD + 18;
  svg += drawAesthetic(aesthetic, x, y, CELL_W, CELL_H, bag.name);
});

svg += "</svg>";
writeFileSync(OUT, svg);
console.log(`wrote ${OUT} (${bags.length} cards)`);

// Aesthetic renderer (`src/sim/aestheticRender.js`).
import { execSync } from "node:child_process";
import { readFileSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { aestheticSVG, drawAesthetic, faceSVG, builtSVG } from "../src/sim/aestheticRender.js";
import { foundAestheticIdentity, expressAesthetic } from "../src/sim/aestheticIdentity.js";
import { buildWorld as pipelineBuild } from "../src/sim/pipeline.js";

let fails = 0, checks = 0;
function ok(cond, msg) {
  checks++;
  if (!cond) { fails++; console.error("FAIL", msg); }
}

const { ter } = pipelineBuild({ W: 240, H: 120, seed: 7, preset: "earth_sim" });
const world = { ancHomelands: ter.ancHomelands };

const ctx = {
  temp: 0.76, moist: 0.55, wealth: 0.70, ancMix: [[0, 1]], world,
  materials: { fibres: [{ id: "silk" }], trees: [{ id: "oak" }], dyes: [{ id: "indigo" }] },
};

const id = foundAestheticIdentity(4242, { ornament: 0.8, colour: 0.7 });
const aesthetic = expressAesthetic(ctx, id);

{
  const a = aestheticSVG(aesthetic, 160, 200);
  const b = aestheticSVG(aesthetic, 160, 200);
  ok(a === b, "aestheticSVG is deterministic");
  ok(a.startsWith("<svg") && a.includes("</svg>"), "returns complete svg document");
  ok(a.includes("<ellipse") || a.includes("<circle"), "face uses vector primitives");
  ok(a.includes("<rect") || a.includes("<path"), "dress/built use shapes");
}

{
  const ornate = expressAesthetic(ctx, foundAestheticIdentity(1, { ornament: 0.9, colour: 0.8 }));
  const plain = expressAesthetic(ctx, foundAestheticIdentity(2, { austerity: 0.92 }));
  ok(aestheticSVG(ornate) !== aestheticSVG(plain), "different taste → different svg");
}

{
  const warm = expressAesthetic({
    temp: 0.86, moist: 0.62, wealth: 0.15, ancMix: [[0, 1]], world,
    materials: { fibres: [{ id: "cotton" }], trees: [{ id: "palm" }] },
  }, foundAestheticIdentity(3, {}));
  const cold = expressAesthetic({
    temp: 0.56, moist: 0.50, wealth: 0.78, ancMix: [[2, 1]], world,
    materials: { fibres: [{ id: "wool" }], trees: [{ id: "oak" }] },
  }, foundAestheticIdentity(4, {}));
  ok(aestheticSVG(warm) !== aestheticSVG(cold), "different envelope → different svg");
}

{
  const cell = drawAesthetic(aesthetic, 0, 0, 150, 180, "test");
  ok(cell.includes("<g transform") && cell.includes("test"), "drawAesthetic wraps labelled cell");
}

{
  const face = faceSVG(aesthetic.look, aesthetic.taste.dress, 50, 50, 1);
  ok(face.includes("ellipse") && face.length > 80, "faceSVG draws morphable head");
  const noLook = faceSVG(null, {}, 50, 50, 1);
  ok(noLook.includes("opacity"), "missing look renders placeholder");
}

{
  const tent = expressAesthetic({
    temp: 0.62, moist: 0.28, horses: 0.4, open: true, wealth: 0.25, ancMix: [[1, 1]], world,
  }, foundAestheticIdentity(5, { pastoral: 0.8 }));
  ok(tent.built.roof === "tent", `steppe ctx is tent (${tent.built.roof})`);
  ok(builtSVG(tent.built, tent.taste.built, 0, 0, 80, 100).svg.includes("path"), "tent roof is a path");
}

{
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const out = "/tmp/aesthetic-lab-build-test.html";
  execSync(`node tools/build_aesthetic_lab.mjs ${out}`, { cwd: root });
  const html = readFileSync(out, "utf8");
  ok(html.includes("function aestheticSVG"), "lab build inlines aestheticSVG");
  ok(html.includes("function expressAesthetic"), "lab build inlines expressAesthetic");
  ok(!html.includes("__PEOPLE_STYLE__"), "lab build fills all placeholders");
  try { unlinkSync(out); } catch (e) { /* */ }
}

if (fails) {
  console.error(`aestheticRender: ${fails} failed / ${checks} checks`);
  process.exit(1);
}
console.log(`aestheticRender: ${checks} checks ok`);

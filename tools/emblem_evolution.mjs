// Proof sheet: emblems FOUNDED FROM STATE and EVOLVING through a live sim's own
// history (emblems.js). Runs a real world, tracks realms' arms as they descend and
// marshal, then lays three sheets:
//   1. the great realms' CURRENT arms, each labelled with the state that shaped it
//      (temperament, faith, size, homeland) — the state→look mapping, by eye;
//   2. one realm's arms OVER TIME — founding, then each marshalling of a union or a
//      conquest (the accumulating quarterings of a real royal coat);
//   3. a spread of faith SIGILS and the peoples' colour TRADITIONS.
// Renders to SVG, and to PNG if playwright-core is present (so it can be looked at).
//
//   node tools/emblem_evolution.mjs [steps] [seed] [W] [H]
import { writeFileSync } from "node:fs";
import { buildSim } from "./_harness.mjs";
import { stepPeopleSim } from "../src/sim/peopleSim/index.js";
import { getPolity } from "../src/sim/peopleSim/entities.js";
import { blazonGenome } from "../src/sim/emblemGenome.js";
import { drawEmblem } from "../src/sim/emblemRender.js";

const STEPS = +(process.argv[2] || 16000);
const SEED = +(process.argv[3] || 4242);
const W = +(process.argv[4] || 320), H = +(process.argv[5] || 160);
const OUT = process.argv[6] || "/tmp/claude-0/-home-user-Simman-/2f44700f-c829-5b75-bba1-699a10e7d530/scratchpad/emblem_evolution.svg";
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
const copy = (g) => JSON.parse(JSON.stringify(g));

const world = buildSim({ W, H, seed: SEED, preset: "earth_sim" });

// Track the arms of the realms that grow largest, recording a new frame whenever the
// coat visibly changes (a marshalling, an adoption, a differencing).
const track = new Map();   // id -> { frames:[{step,g,q,cad,note}], peak }
const CHUNK = 500;
const sig = (g) => `${g.quarters ? g.quarters.length : 1}|${g.cadency || 0}|${g.genes.map((x) => x.toFixed(2)).join("")}`;
for (let done = 0; done < STEPS; done += CHUNK) {
  stepPeopleSim(world, Math.min(CHUNK, STEPS - done));
  if (!world.countries) continue;
  for (const c of world.countries.values()) {
    const pol = getPolity(world, c.id);
    if (!pol || pol.endedStep >= 0 || !pol.emblem) continue;
    const size = c.members ? c.members.length : 0;
    let rec = track.get(c.id);
    if (!rec) { rec = { frames: [], peak: 0, name: pol.name }; track.set(c.id, rec); }
    rec.peak = Math.max(rec.peak, size);
    rec.name = pol.name || rec.name;
    const g = pol.emblem, s = sig(g);
    const last = rec.frames[rec.frames.length - 1];
    if (!last || last.sig !== s) {
      const q = g.quarters ? g.quarters.length : 1;
      let note = rec.frames.length === 0 ? "founded" : "";
      if (last) { const lq = last.g.quarters ? last.g.quarters.length : 1; note = q > lq ? "marshalled" : q < lq ? "simplified" : (g.cadency || 0) !== (last.g.cadency || 0) ? "differenced" : "redrawn"; }
      rec.frames.push({ step: world.step, sig: s, g: copy(g), q, cad: g.cadency || 0, note });
    }
  }
}

// ── layout helpers ──
const CELL = 132, GAP = 10, PAD = 26, COLS = 8;
let body = "", yCur = PAD + 26;
const head = (t) => { body += `<text x="${PAD}" y="${yCur}" font-family="Georgia,serif" font-size="16" fill="#e8e2d4">${esc(t)}</text>`; yCur += 20; };
const sub = (t) => { body += `<text x="${PAD}" y="${yCur}" font-family="sans-serif" font-size="11" fill="#b9b2a6">${esc(t)}</text>`; yCur += 6; };
function cell(g, x, y, label, sub2) {
  body += drawEmblem(g, x, y, CELL, CELL);
  body += `<text x="${x + CELL / 2}" y="${y + CELL + 12}" text-anchor="middle" font-family="sans-serif" font-size="10.5" fill="#d8d2c4">${esc(label)}</text>`;
  if (sub2) body += `<text x="${x + CELL / 2}" y="${y + CELL + 24}" text-anchor="middle" font-family="sans-serif" font-size="9" fill="#9a9488">${esc(sub2)}</text>`;
}

// homeland word from the capital's cached terrain (the same signals envAxes reads)
function biomeWord(cap) {
  if (!cap) return "";
  const sea = (cap.waterAccess || 0) - (cap._riverAcc || 0);
  const moist = cap._climMoist != null ? cap._climMoist : 0.5;
  const rug = cap._rugged || 0;
  if (rug > 0.55) return "highland";
  if (sea > 0.35) return "maritime";
  if (moist < 0.30) return "arid";
  if (moist > 0.50) return "woodland";
  return "temperate";
}

// ── 1. current great-realm arms, labelled by state ──
head("Arms founded from emergent state — temperament · faith · homeland shape the look");
{
  const now = [...world.countries.values()]
    .map((c) => ({ c, pol: getPolity(world, c.id) }))
    .filter((x) => x.pol && x.pol.endedStep < 0 && x.pol.emblem)
    .sort((a, b) => (b.c.members ? b.c.members.length : 0) - (a.c.members ? a.c.members.length : 0))
    .slice(0, 16);
  now.forEach(({ c, pol }, i) => {
    if (i && i % COLS === 0) yCur += CELL + 34;
    const x = PAD + (i % COLS) * (CELL + GAP);
    const per = pol.personality ? pol.personality._label : "";
    const state = [per, biomeWord(c.capital), (c.members ? c.members.length : 0) + " setts"].filter(Boolean).join(" · ");
    cell(pol.emblem, x, yCur, (pol.name || "?").slice(0, 18), state);
  });
  yCur += CELL + 44;
}

// ── 2. one realm's arms over time ──
let best = null;
for (const rec of track.values()) if (!best || rec.frames.length > best.frames.length || (rec.frames.length === best.frames.length && rec.peak > best.peak)) best = rec;
if (best && best.frames.length > 1) {
  head(`A realm's arms over time — ${best.name || "a realm"}: founding, then each union & conquest marshalled onto the shield`);
  best.frames.slice(0, COLS).forEach((f, i) => {
    const x = PAD + i * (CELL + GAP);
    cell(f.g, x, yCur, `step ${f.step} · ${f.note}`, f.q > 1 ? `${f.q} quarters` : (f.cad ? `cadency ${f.cad}` : "single coat"));
  });
  yCur += CELL + 44;
}

// ── 3. faith sigils + culture traditions ──
head("Faith sigils (aniconic sacred glyphs) & the peoples' colour traditions");
{
  const faiths = [...(world.faiths ? world.faiths.values() : [])].filter((f) => f.sigil && f.endedStep < 0).slice(0, COLS);
  faiths.forEach((f, i) => { const x = PAD + i * (CELL + GAP); cell(f.sigil, x, yCur, (f.name || "creed").slice(0, 18), f.kind); });
  yCur += CELL + 40;
}

const HT = yCur + PAD;
const WD = COLS * (CELL + GAP) + PAD * 2;
const svg = `<svg viewBox="0 0 ${WD} ${HT}" width="${WD}" height="${HT}" xmlns="http://www.w3.org/2000/svg"><rect width="${WD}" height="${HT}" fill="#2b2a28"/>${body}</svg>`;
writeFileSync(OUT, svg);
console.log(`wrote ${OUT} (${(svg.length / 1024).toFixed(0)}KB)`);

// ── optional PNG (so it can be looked at) ──
const PNG = OUT.replace(/\.svg$/, ".png");
try {
  const pw = (await import("../node_modules/playwright-core/index.js")).default;
  const { readdirSync } = await import("node:fs");
  const base = "/opt/pw-browsers";
  const dir = readdirSync(base).find((d) => /^chromium-\d+$/.test(d)) || "chromium";
  const b = await pw.chromium.launch({ executablePath: `${base}/${dir}/chrome-linux/chrome` });
  const pg = await b.newPage();
  await pg.setContent(`<!doctype html><body style="margin:0">${svg}`);
  const el = await pg.$("svg");
  await el.screenshot({ path: PNG });
  await b.close();
  console.log(`wrote ${PNG}`);
} catch (e) {
  console.log(`(no PNG — ${e.message.split("\n")[0]})`);
}

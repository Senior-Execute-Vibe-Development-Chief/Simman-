// ── PROOF SHEET — render a labelled grid of emblems to a PNG and LOOK at it.
// The reachability audit proves a structure is expressible; the eye proves it
// reads. Usage: `node tools/proof_sheet.mjs <mode> [out.png]`
//   compound  — the compound-field families + random compound flags
//   <partition>=<name> style ad-hoc modes can be added as needed.
import { writeFileSync } from "node:fs";
import pw from "../node_modules/playwright-core/index.js";
import { GENES, foundGenome, mutateGenome, crossGenome, expressGenome, blazonGenome, POOLS } from "../src/sim/emblemGenome.js";
import { drawEmblem } from "../src/sim/emblemRender.js";

const IDX = {}; GENES.forEach((g, i) => (IDX[g] = i));
const slot = (pool, name) => (pool.indexOf(name) + 0.5) / pool.length;
const pin = (g, obj) => { for (const [k, v] of Object.entries(obj)) g.genes[IDX[k]] = v; return g; };
const base = () => ({ substrate: slot(POOLS.SUBSTRATES, "banner"), composition: slot(POOLS.FLAG_COMPOSITIONS, "heraldic"), iconism: 0.5 });
const flagPart = n => slot(POOLS.FLAG_PARTITIONS, n);
const ordinary = n => slot(POOLS.ORDINARIES, n);
const stripesGeneFor = n => Math.min(1, (Math.pow(Math.max(0, n - 2) / 12, 1 / 1.7) + Math.pow(Math.max(0, n - 1) / 12, 1 / 1.7)) / 2);

// first founder seed whose pinned expression satisfies pred
function findGenome(pins, pred, lo = 1, hi = 80000) {
  for (let s = lo; s < hi; s++) { const g = pin(foundGenome(s), pins); if (pred(expressGenome(g))) return g; }
  return null;
}

const MODES = {
  compound() {
    const items = [];
    const targets = [
      ["Benin: pale + 2 stripes", { ...base(), partition: flagPart("perFess"), hueC: ordinary("none"), arrange: 0.2 },
        p => p.field.hoist?.shape === "pale" && p.field.partition === "perFess"],
      ["UAE: pale + 3 stripes", { ...base(), partition: flagPart("tiercedFess"), hueC: ordinary("none"), arrange: 0.2 },
        p => p.field.hoist?.shape === "pale" && p.field.partition === "tiercedFess"],
      ["Madagascar: pale + 2 stripes", { ...base(), partition: flagPart("perFess"), hueC: ordinary("none"), arrange: 0.2 },
        p => p.field.hoist?.shape === "pale" && p.field.partition === "perFess"],
      ["Jordan: triangle + 3 stripes", { ...base(), partition: flagPart("tiercedFess"), hueC: ordinary("none"), arrange: 0.2 },
        p => p.field.hoist?.shape === "triangle" && p.field.partition === "tiercedFess"],
      ["Cuba: triangle + 5 stripes", { ...base(), partition: flagPart("barry"), hueC: ordinary("none"), arrange: 0.2, stripes: stripesGeneFor(5) },
        p => p.field.hoist?.shape === "triangle" && p.field.partition === "barry" && p.field.stripes === 5],
      ["Sudan: triangle + 3 stripes", { ...base(), partition: flagPart("tiercedFess"), hueC: ordinary("none"), arrange: 0.2 },
        p => p.field.hoist?.shape === "triangle" && p.field.partition === "tiercedFess"],
    ];
    let lo = 2;
    for (const [label, pins, pred] of targets) { const g = findGenome(pins, pred, lo); items.push({ label, g }); lo = (g ? g.seed : lo) + 1; }
    // random compound flags — variety, not pins
    const rng = (s => () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)(99);
    let found = 0;
    for (let i = 0; i < 60000 && found < 6; i++) {
      const seed = (i * 2654435761 + 11) >>> 0;
      const g = i % 2 ? crossGenome(foundGenome(seed), foundGenome((seed ^ 0xbeef) >>> 0), seed + 3)
        : foundGenome(seed, { figuration: rng(), ornateness: rng(), boldness: rng(), saturation: rng(), symmetry: rng(), tone: rng(), hue: rng(), format: rng() });
      const p = expressGenome(g);
      if (p.isFlag && p.field.hoist && !g.quarters) { items.push({ label: `random · ${p.field.hoist.shape}`, g }); found++; }
    }
    return items;
  },
};

MODES.fimbriated = function () {
  const items = [];
  const targets = [
    ["Norway/Iceland: fimbr. cross", { ...base(), partition: flagPart("plain"), hueC: ordinary("cross"), arrange: 0.2, secondary: 0.9 },
      p => p.field.ordinary === "cross" && p.field.fimbriation && !p.motif],
    ["Denmark: plain cross (no fimbr.)", { ...base(), partition: flagPart("plain"), hueC: ordinary("cross"), arrange: 0.2, secondary: 0.1 },
      p => p.field.ordinary === "cross" && !p.field.fimbriation && !p.motif],
    ["DR Congo: fimbr. bend", { ...base(), partition: flagPart("plain"), hueC: ordinary("bend"), arrange: 0.2, secondary: 0.9 },
      p => p.field.ordinary === "bend" && p.field.fimbriation && !p.motif],
    ["Trinidad: fimbr. bend sinister", { ...base(), partition: flagPart("plain"), hueC: ordinary("bendSinister"), arrange: 0.2, secondary: 0.9 },
      p => p.field.ordinary === "bendSinister" && p.field.fimbriation && !p.motif],
    ["fimbr. saltire", { ...base(), partition: flagPart("plain"), hueC: ordinary("saltire"), arrange: 0.2, secondary: 0.9 },
      p => p.field.ordinary === "saltire" && p.field.fimbriation && !p.motif],
    ["fimbr. pall (unity-Y)", { ...base(), partition: flagPart("plain"), hueC: ordinary("pall"), arrange: 0.2, secondary: 0.9 },
      p => p.field.ordinary === "pall" && p.field.fimbriation && !p.motif],
  ];
  let lo = 2;
  for (const [label, pins, pred] of targets) { const g = findGenome(pins, pred, lo); items.push({ label, g }); lo = (g ? g.seed : lo) + 1; }
  return items;
};

MODES.gallery = function () {
  const items = [];
  const arrayPattern = n => slot(POOLS.ARRAY_PATTERNS, n);
  const geom = n => slot(POOLS.MOTIFS.geometric, n);
  const clean = { pearl: 0.1, border: 0.1 };   // pin off the chief/bordure clutter for clear proofs
  const T = [
    ["Switzerland: couped cross", { ...base(), ...clean, partition: flagPart("plain"), hueC: ordinary("cross"), arrange: 0.2, secondary: 0.1, symmetry: 0.9 },
      p => p.field.ordinary === "cross" && p.field.crossStyle === "couped" && !p.motif],
    ["Greece: canton cross + stripes", { ...base(), ...clean, partition: flagPart("barry"), hueC: ordinary("none"), arrange: 0.2, star: 0.9, sunDisc: 0.1, crescent: 0.2, stripes: stripesGeneFor(9) },
      p => p.field.partition === "barry" && p.field.stripes === 9 && p.ornaments.canton && p.ornaments.cantonKind === "cross"],
    ["USA: canton + 13 stripes + stars", { ...base(), ...clean, partition: flagPart("barry"), hueC: ordinary("none"), arrange: 0.9, motifCat: slot(POOLS.MOTIF_CATS, "geometric"), star: 0.9, scriptDensity: arrayPattern("rows"), stripes: stripesGeneFor(13), motifCount: 0.9 },
      p => p.field.partition === "barry" && p.field.stripes === 13 && p.motif?.inCanton && p.motif?.array?.pattern === "rows"],
    ["Malaysia: canton + 14 stripes", { ...base(), ...clean, partition: flagPart("barry"), hueC: ordinary("none"), arrange: 0.9, motifCat: slot(POOLS.MOTIF_CATS, "celestial"), star: 0.9, stripes: stripesGeneFor(14), motifCount: 0.1, motifIdx: 0.95 },
      p => p.field.partition === "barry" && p.field.stripes === 14 && p.ornaments.canton],
    ["EU: ring of stars", { ...base(), ...clean, partition: flagPart("plain"), hueC: ordinary("none"), arrange: 0.9, motifCat: slot(POOLS.MOTIF_CATS, "geometric"), star: 0.2, scriptDensity: arrayPattern("ring"), motifCount: 0.9, motifIdx: geom("mullet") },
      p => p.motif?.array?.pattern === "ring" && !p.motif.inCanton],
    ["Star & crescent, lone", { ...base(), ...clean, partition: flagPart("plain"), hueC: ordinary("none"), arrange: 0.1, star: 0.2, motifCat: slot(POOLS.MOTIF_CATS, "celestial"), motifIdx: 0.95 },
      p => p.motif?.id === "starAndCrescent"],
  ];
  let lo = 2;
  for (const [label, pins, pred] of T) { const g = findGenome(pins, pred, lo); items.push({ label, g }); lo = (g ? g.seed : lo) + 1; }
  return items;
};

MODES.newgaps = function () {
  const items = [];
  const clean = { pearl: 0.1, border: 0.1 };
  const T = [
    ["Switzerland: square + couped cross", { ...base(), ...clean, substrate: 0.332, partition: flagPart("plain"), hueC: ordinary("cross"), arrange: 0.2, secondary: 0.1, symmetry: 0.9, brandSeed: 0.1 },
      p => p.flagRatio >= 0.95 && p.field.crossStyle === "couped" && !p.field.saltireOverlay],
    ["England: cross throughout", { ...base(), ...clean, partition: flagPart("plain"), hueC: ordinary("cross"), arrange: 0.2, secondary: 0.1, symmetry: 0.7, brandSeed: 0.1 },
      p => p.field.crossStyle === "throughout" && !p.field.saltireOverlay && !p.motif],
    ["Qatar: very long + serrated", { ...base(), ...clean, substrate: 0.172, partition: flagPart("perPale"), hueC: ordinary("none"), arrange: 0.2, line: slot(POOLS.LINES, "indented") },
      p => p.flagRatio <= 0.45 && p.field.partition === "perPale" && p.field.line === "indented"],
    ["Gambia: fimbriated stripe seams", { ...base(), ...clean, partition: flagPart("barry"), hueC: ordinary("none"), arrange: 0.2, stripes: stripesGeneFor(5), motifCount: 0.9 },
      p => p.field.partition === "barry" && p.field.seamFimbriation && !p.motif],
    ["Thailand: quintband 1:1:2:1:1", { ...base(), ...clean, partition: flagPart("quintFess"), hueC: ordinary("none"), arrange: 0.2 },
      p => p.field.partition === "quintFess" && p.field.stripeWeights && !p.motif],
    ["Seychelles: radiating fan", { ...base(), ...clean, partition: flagPart("rays"), hueC: ordinary("none"), arrange: 0.2, stripes: 0.6 },
      p => p.field.partition === "rays" && p.field.rays && p.field.rays.count >= 4],
    ["Union Jack: cross + saltire", { ...base(), ...clean, partition: flagPart("plain"), hueC: ordinary("cross"), arrange: 0.2, secondary: 0.1, symmetry: 0.7, brandSeed: 0.9 },
      p => p.field.ordinary === "cross" && p.field.saltireOverlay],
    ["Marshall Is: two rays + (bare)", { ...base(), ...clean, partition: flagPart("rays"), hueC: ordinary("none"), arrange: 0.2, stripes: 0.05 },
      p => p.field.partition === "rays" && p.field.rays && p.field.rays.count === 3],
  ];
  let lo = 2;
  for (const [label, pins, pred] of T) { const g = findGenome(pins, pred, lo); items.push({ label, g }); lo = (g ? g.seed : lo) + 1; }
  return items;
};

const mode = process.argv[2] || "compound";
const out = process.argv[3] || `/tmp/claude-0/-home-user-Simman-/scratchpad/proof-${mode}.png`;
const items = MODES[mode]();
for (const it of items) if (it.g) console.log(`  ${it.label.padEnd(30)} ${blazonGenome(it.g)}`);

// lay a grid
const COLS = 3, CW = 300, CH = 210, PAD = 14, LBL = 22;
const rows = Math.ceil(items.length / COLS);
const W = COLS * CW + PAD, H = rows * (CH + LBL) + PAD;
let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#cbc9c2"/>`;
items.forEach((it, i) => {
  const cx = PAD + (i % COLS) * CW, cy = PAD + Math.floor(i / COLS) * (CH + LBL);
  if (it.g) svg += drawEmblem(it.g, cx, cy, CW - PAD, CH - PAD);
  svg += `<text x="${cx + CW / 2}" y="${cy + CH + 4}" font-family="sans-serif" font-size="13" fill="#1a1a1a" text-anchor="middle">${it.label}</text>`;
});
svg += `</svg>`;

const b = await pw.chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const pg = await b.newPage();
await pg.setContent(`<!doctype html><body style="margin:0">${svg}`);
await (await pg.$("svg")).screenshot({ path: out });
await b.close();
console.log(`\nwrote ${out}  (${items.length} cells, ${W}×${H})`);

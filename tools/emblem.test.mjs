// Emblem engine property tests (`npm test` runs this after the smoke suite).
// Sweeps thousands of genomes (founders, axed founders, mutation chains,
// crosses) and asserts the engine's constructed invariants hold everywhere:
//
//   1. RULE OF TINCTURE — every mark (ordinary, chief, bordure, charge,
//      canton) on a uniform-class named ground wears the OPPOSITE class; on
//      mixed parties / continuous non-heraldic fields it is measurably
//      distinct (min OKLab dE bound). Charges ON an ordinary are audited
//      against the band, not the field.
//   2. ART COVERAGE — every motif id in every pool resolves to a vector
//      primitive or bundled charge art.
//   3. DETERMINISM — express/mutate/inherit/cross replay identically.
//   4. MARSHALLING — unions accumulate deduped quarters (≤4), self-cross
//      stays simple, quarters persist under drift and stay renderable.
//   5. REACHABILITY — every named tincture appears as a field; blazons are
//      non-empty and name no raw ids.
// Exits non-zero with labelled failures.

import { GENES, foundGenome, mutateGenome, inheritGenome, crossGenome, expressGenome, describeGenome, blazonGenome, genomeDistance, TINCTURES }
  from "../src/sim/emblemGenome.js";
import { PRIMITIVES, emblemSVG } from "../src/sim/emblemRender.js";
import { CHARGE_DETAIL } from "../src/sim/heraldryChargesDetailed.js";
import { MOTIFS } from "../src/sim/emblemGenome.js";

function oklab([r, g, b]) {
  const f = u => { u /= 255; return u <= 0.04045 ? u / 12.92 : ((u + 0.055) / 1.055) ** 2.4; };
  const R = f(r), G = f(g), B = f(b);
  const l = Math.cbrt(0.41222147 * R + 0.53633254 * G + 0.05144599 * B);
  const m = Math.cbrt(0.2119035 * R + 0.68069955 * G + 0.10739696 * B);
  const s = Math.cbrt(0.08830246 * R + 0.28171884 * G + 0.6299787 * B);
  return [0.21045426 * l + 0.79361779 * m - 0.00407205 * s,
    1.9779985 * l - 2.42859221 * m + 0.45059371 * s,
    0.02590404 * l + 0.78277177 * m - 0.80867577 * s];
}
const dE = (a, b) => { const A = oklab(a), B = oklab(b); return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]); };
const names = Object.keys(TINCTURES);
const CLASS_L = (Math.min(...names.filter(n => TINCTURES[n].kind === "metal").map(n => oklab(TINCTURES[n].rgb)[0]))
  + Math.max(...names.filter(n => TINCTURES[n].kind !== "metal").map(n => oklab(TINCTURES[n].rgb)[0]))) / 2;
const classOf = rgb => (oklab(rgb)[0] > CLASS_L ? "metal" : "dark");
const ARGENT = TINCTURES.argent.rgb, AZURE = TINCTURES.azure.rgb;

let fails = 0, checks = 0, minMeasured = Infinity;
const fieldNames = new Set();
const seen = { chequy: 0, lozengy: 0, fretty: 0, masoned: 0, diminutive: 0, attitude: 0, tiercedPale: 0, tiercedFess: 0, fimbriation: 0, panel: 0, hoistTriangle: 0,
  array_rows: 0, array_ring: 0, array_arc: 0, array_constellation: 0, housed: 0,
  cutLong: 0, cutStocky: 0, spanishMid: 0, spanishFirst: 0 };
// the compact device categories — the only ones a flag repeats or strews
const COMPACT = new Set(["celestial", "geometric"]);
const fail = (msg, g) => { if (fails++ < 10) console.error(`  FAIL ${msg}${g ? `\n       ${describeGenome(g)}` : ""}`); };

function checkMark(mark, grounds, what, g, strict) {
  checks++;
  const d = Math.min(...grounds.map(b => dE(mark, b)));
  if (strict && new Set(grounds.map(classOf)).size === 1) {
    if (classOf(mark) === classOf(grounds[0])) fail(`${what}: same class as uniform named ground`, g);
    return;
  }
  minMeasured = Math.min(minMeasured, d);
  if (d < 0.1) fail(`${what}: too close to ground (dE=${d.toFixed(3)})`, g);
}

function audit(g) {
  const p = expressGenome(g);
  const f = p.field;
  // FLAG substrate grammar: sewn geometry only (straight seams save the
  // serrated hoist), no engraver partitions, and figures step back — never
  // in multiples, never strewn
  if (p.isFlag) {
    if (["gyronny", "chequy", "lozengy", "chevron"].includes(f.partition)) fail(`flag flying an engraver partition (${f.partition})`, g);
    if (f.line !== "straight" && !(f.line === "indented" && f.partition === "perPale")) fail(`flag with a fancy seam (${f.line})`, g);
    if (f.fur && f.fur !== "ermine") fail(`flag draped in ${f.fur}`, g);
    const fm = p.motif;
    if (fm && fm.attitude) fail("flag charge with an attitude", g);
    if (fm && !COMPACT.has(fm.cat)) {
      if ((fm.count || 1) > 1) fail("figure in multiples on a flag", g);
      if (fm.arrange === "seme") fail("strewn figure on a flag", g);
    }
    // THE CONSTELLATION GRAMMAR: cloth never wallpapers or shield-stations a
    // repeated device — multiples come only as organized arrays (or an
    // ordinary's company), and a housed device implies its canton
    if (fm && ["seme", "three", "inPale"].includes(fm.arrange)) fail(`unorganized multiple on a flag (${fm.arrange})`, g);
    if (fm && fm.array) {
      seen["array_" + fm.array.pattern] = (seen["array_" + fm.array.pattern] || 0) + 1;
      if (!COMPACT.has(fm.cat)) fail("figurative array on a flag", g);
      if (fm.array.count < 2 || fm.array.count > 13) fail(`array count out of bounds (${fm.array.count})`, g);
      if (fm.array.pattern === "ring" && fm.array.count < 4) fail("a ring of fewer than four devices", g);
      if (fm.array.pattern === "arc" && (fm.array.count < 3 || fm.array.count > 9)) fail("arc count out of bounds", g);
      if (fm.array.count !== fm.count) fail("array count disagrees with motif count", g);
    }
    if (fm && fm.inCanton) {
      seen.housed++;
      if (!p.ornaments.canton) fail("housed device without its canton", g);
      if (!COMPACT.has(fm.cat)) fail("a figure boarded the canton", g);
    }
    if (p.composition === "heraldic" && p.ornaments.canton) {
      if (f.ordinary && f.ordinary !== "none") fail("canton over an ordinary on a flag", g);
      if (fm && !fm.inCanton) fail("canton beside a free device on a flag", g);
    }
    // THE CLOTH CUT: banners span the real ratio spread (1:2 … 2:3), smooth
    if (p.substrate === "banner") {
      if (!(p.flagRatio >= 0.5 && p.flagRatio <= 0.667)) fail(`banner cut out of range (${p.flagRatio})`, g);
      if (p.flagRatio < 0.53) seen.cutLong++;
      if (p.flagRatio > 0.64) seen.cutStocky++;
    }
  }
  // the Spanish-fess system: tierced bands may double the middle or the first
  if (f.tiercedWide != null) {
    if (!f.partition.startsWith("tierced")) fail("tiercedWide off a tierced field", g);
    if (f.tiercedWide === 1) seen.spanishMid++; else if (f.tiercedWide === 0) seen.spanishFirst++;
    else fail(`tiercedWide out of range (${f.tiercedWide})`, g);
  }
  if (p.composition === "heraldic") {
    if (p.colors.mode === "heraldic") fieldNames.add(f.names[0]);
    if (seen[f.partition] != null) seen[f.partition]++;
    if (seen[f.fur] != null) seen[f.fur]++;
    if (f.partition.startsWith("tierced")) {
      if (f.names[0] === f.names[1] || f.names[1] === f.names[2]) fail("tierced: adjacent bands share a tincture", g);
      if (f.tinctures.length !== 3) fail("tierced: needs three band tinctures", g);
    }
    if ((f.ordinaryCount || 1) > 1) seen.diminutive++;
    if (p.motif && p.motif.attitude) seen.attitude++;
    const grounds = f.fur === "ermine" ? [ARGENT] : f.fur === "vair" ? [ARGENT, AZURE]
      : f.fur ? [p.colors.field]                       // fretty / masoned: thin lines, the field stays the ground
        : f.partition === "plain" ? [p.colors.field] : f.tinctures;
    const strict = p.colors.mode === "heraldic" || p.colors.mode === "monochrome"
      || f.fur === "ermine" || f.fur === "vair";
    const hasOrd = f.ordinary && f.ordinary !== "none";
    if (hasOrd && !f.counterchange) checkMark(f.ordinaryTincture, grounds, "ordinary", g, strict);
    if (p.isFlag && p.ornaments.canton) checkMark(p.ornaments.cantonColor, grounds, "canton-flag", g, strict);
    if (f.fimbriation) { seen.fimbriation++; checkMark(f.fimbriation, [...grounds, f.ordinaryTincture], "fimbriation", g, false); }
    if (f.chief) checkMark(f.subTincture, grounds, "chief", g, strict);
    if (f.bordure) checkMark(f.subTincture, grounds, "bordure", g, strict);
    const m = p.motif;
    if (m) {
      if (m.arrange === "onOrdinary") {
        if (!hasOrd || f.counterchange || f.ordinary === "chevron") fail("on-ordinary company misplaced", g);
        if (!m.slots || !m.slots.length) fail("on-ordinary without slots", g);
        checkMark(m.tincture, [f.ordinaryTincture], "charge-on-ordinary", g, false);
      } else if (m.arrange === "between") {
        if (!hasOrd || !m.slots || !m.slots.length) fail("between company malformed", g);
        checkMark(m.tincture, grounds, "charge-between", g, strict);
      } else if (m.inCanton) {
        // a housed device dresses against the canton block, not the field
        checkMark(m.tincture, [p.ornaments.cantonColor], "charge-in-canton", g, false);
      } else if (m.counterchange) {
        if (!["perPale", "perFess", "perBend"].includes(f.partition)) fail("counterchange on non-2-region partition", g);
      } else if (m.panel) {
        seen.panel++;
        checkMark(m.panel.tincture, grounds, "panel", g, strict);
        checkMark(m.tincture, [m.panel.tincture], "charge-on-panel", g, false);
      } else checkMark(m.tincture, grounds, "charge", g, strict);
      if (m.fimbriation) checkMark(m.fimbriation, [...grounds, m.tincture], "charge-fimbriation", g, false);
      if (m.behind && m.arrange !== "seme") fail("behind flag on non-seme", g);
    }
  } else if (p.motif) {
    const strict = p.colors.mode === "heraldic" || p.colors.mode === "monochrome";
    if (p.motif.panel) {
      seen.panel++;
      checkMark(p.motif.panel.tincture, [p.colors.field], "panel", g, strict);
      checkMark(p.motif.tincture, [p.motif.panel.tincture], "charge-on-panel", g, false);
    } else checkMark(p.motif.tincture, [p.colors.field], `charge(${p.composition})`, g, strict);
  }
}

// ── 1+5: the sweep ──
const rng = (s => () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)(7);
const N = 8000;
for (let i = 0; i < N; i++) {
  const seed = (i * 2654435761 + 11) >>> 0;
  let g;
  if (i % 4 === 0) g = foundGenome(seed);
  else if (i % 4 === 1) g = foundGenome(seed, { figuration: rng(), ornateness: rng(), boldness: rng(), saturation: rng(), symmetry: rng(), tone: rng(), hue: rng(), format: rng() });
  else if (i % 4 === 2) { g = foundGenome(seed); for (let k = 0; k < 4; k++) g = mutateGenome(g, seed + k * 97); }
  else g = crossGenome(foundGenome(seed), foundGenome((seed ^ 0xbeef) >>> 0), seed + 3);
  audit(g);
  if (i % 640 === 0) {
    const bz = blazonGenome(g);
    if (!bz || bz.length < 5) fail("empty blazon", g);
  }
}
for (const n of names) if (!fieldNames.has(n)) fail(`reachability: "${n}" never a heraldic field in ${N} samples`);
for (const [k, v] of Object.entries(seen)) if (!v) fail(`reachability: ${k} never expressed in ${N} samples`);

// ── 2: art coverage ──
for (const [cat, pool] of Object.entries(MOTIFS))
  for (const id of pool) if (!PRIMITIVES[id] && !CHARGE_DETAIL[id]) fail(`no art for ${cat}/${id}`);

// ── 3: determinism ──
for (let i = 0; i < 60; i++) {
  const g = foundGenome(i * 7919 + 1);
  if (JSON.stringify(expressGenome(g)) !== JSON.stringify(expressGenome(g))) fail("expressGenome nondeterministic");
  if (JSON.stringify(mutateGenome(g, 42)) !== JSON.stringify(mutateGenome(g, 42))) fail("mutateGenome nondeterministic");
  if (JSON.stringify(inheritGenome(g, 43)) !== JSON.stringify(inheritGenome(g, 43))) fail("inheritGenome nondeterministic");
  const h = foundGenome(i * 104729 + 7);
  if (JSON.stringify(crossGenome(g, h, 9)) !== JSON.stringify(crossGenome(g, h, 9))) fail("crossGenome nondeterministic");
}

// ── 4: marshalling ──
{
  const a = foundGenome(1011), b = foundGenome(4059), c = foundGenome(8123);
  const ab = crossGenome(a, b, 777);
  if (!ab.quarters || ab.quarters.length !== 2) fail("union of two houses should carry 2 quarters");
  const abc = crossGenome(ab, c, 888);
  if (!abc.quarters || abc.quarters.length !== 3) fail("second union should accumulate to 3 quarters");
  if (crossGenome(a, a, 5).quarters) fail("self-cross should stay a simple coat (dedup)");
  const big = crossGenome(abc, crossGenome(foundGenome(31), foundGenome(32), 33), 34);
  if (big.quarters.length > 4) fail("quarters must cap at 4");
  let m = ab; for (let i = 0; i < 3; i++) m = inheritGenome(m, 42 + i);
  if (m.quarters && m.quarters.length !== 2) fail("quarters should persist (or simplify away entirely)");
  if (genomeDistance(a, a) !== 0) fail("genomeDistance(a,a) must be 0");
  if (!(genomeDistance(a, b) > 0)) fail("genomeDistance(a,b) must be > 0");
  for (const g of [ab, abc, big]) {
    const svg = emblemSVG(g, 160, 160);
    if (!svg.includes("<svg") || svg.length < 400) fail("marshalled emblem failed to render");
  }
  if (!blazonGenome(abc).startsWith("Quarterly:")) fail("marshalled blazon should enumerate quarters");
}

// ── 6: cadency ──
{
  let g = foundGenome(2024), marked = 0, cleared = 0, prev = 0;
  for (let i = 0; i < 60; i++) {
    g = inheritGenome(g, 9000 + i * 13);
    const c = g.cadency || 0;
    if (c > 0) marked++;
    if (prev > 0 && c === 0) cleared++;
    if (c > 6) fail("cadency beyond the six marks");
    prev = c;
  }
  if (!marked) fail("cadency never appears down an inherit chain");
  if (!cleared) fail("cadency never clears (no branch ever succeeds as head)");
  const withMark = { ...foundGenome(31), cadency: 3 };
  if (!expressGenome(withMark).cadency) fail("phenotype missing cadency");
  if (!blazonGenome(withMark).includes("for difference")) fail("blazon missing 'for difference'");
  if ((mutateGenome(withMark, 5).cadency || 0) !== 3) fail("mutate should preserve cadency (same bearer)");
  if (crossGenome(withMark, foundGenome(32), 7).cadency) fail("a union founds a new house: cadency must clear");
  if (emblemSVG(withMark, 120, 120).length < 400) fail("cadency emblem failed to render");
}

console.log(`[emblem] ${checks} tincture checks over ${N} genomes, min measured dE ${minMeasured.toFixed(3)}; `
  + `${fieldNames.size}/${names.length} tinctures seen as fields; determinism, art coverage, marshalling checked`);
if (fails) { console.error(`[emblem] FAILED with ${fails} failure(s)`); process.exit(1); }
console.log("[emblem] all checks passed");

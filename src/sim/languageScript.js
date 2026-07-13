// ── Writing systems: emergent script type, orthographic lag, glyphs ───────
//
// The L5 thread (docs/language-comprehensive-spec.md §E/§F), Lab-side: a
// script is DERIVED from the language record — nothing persists, the sim
// stays unwired (script birth from literacy tech and spread along faith/
// trade channels is the sim-side plan, parked).
//
// Mechanisms, none of them fiat:
//
//  · TYPE walks the real transmission ladder. A primary tradition is
//    LOGOGRAPHIC (accounting-token origin — every attested primary
//    invention). At re-learning junctures — points of accumulated written
//    history, never wall-clock — the script simplifies ONE structural step
//    (logo → syllabary/abjad → alphabet/abugida), and only when the simpler
//    type FITS this language better: fit weighs the glyph budget a learner
//    must carry against what the type fails to write. No script type is
//    ever assigned by name.
//  · ORTHOGRAPHIC LAG: spelling freezes when the tradition consolidates on
//    its current type; a re-learning is the reform that resets it — and a
//    tradition that has drifted deep into lag may REFORM without changing
//    type (the Turkish move), while its sister fossilizes (the French one).
//  · THE HAND: glyph shape follows the writing MEDIUM, exactly as in life.
//    Carved scripts avoid horizontals (a cut along the wood grain splits —
//    the runic futhark rule); clay takes wedges (cuneiform); the brush
//    builds boxy, stroke-ordered signs; the reed pen chains into joined
//    cursive; scripts of the palm-leaf/round tradition avoid straight cuts
//    (the Burmese/Odia rule). The medium is the material-culture roll of
//    the family (sim coupling parked), re-rolled at adoption — a re-learned
//    script may change its whole look.
//  · REAL ORTHOGRAPHY PER TYPE: abjads grow matres lectionis (long vowels
//    and initial carriers written with glide letters); abugidas mark
//    non-inherent vowels with diacritics and may kill the inherent vowel
//    with a virama; syllabaries handle codas the three attested ways
//    (moraic nasal sign — kana; echo-vowel — Linear B ko-no-so; or simply
//    unwritten); segmental scripts of tonal languages usually leave tone
//    unwritten (the pinyin-without-marks norm) and occasionally mark it
//    (the Vietnamese minority); logographies disambiguate homophones as
//    PHONO-SEMANTIC compounds — a domain radical beside the glyph of the
//    word it sounds like, the 形声 machine that built most of the hanzi.
//  · NUMERALS: the low digits are TALLY marks in the script's own medium
//    (一二三 / I II III / cuneiform wedges — near-universal), higher digits
//    their own signs.
//
// All exports are pure and cached; every roll reads its own famSeed stream
// ("scr:*"). References pin their scripts as scenario data (prof.script).

import { hash32 } from "./peopleSim/rng.js";
import { compiledInv, nativeStemOf, etymologyOf, wordOf } from "./language.js";
import { renderWord, romanizeC, romanizeV } from "./languagePhonology.js";
import { CONCEPTS } from "./languageLexicon.js";
import { phoneticPlan } from "./languagePhonetics.js";

const h01 = (...a) => hash32(...a) / 4294967296;

// ── structural fit: what each type costs THIS language ────────────────────
// Constants are learnability/typology priors with independent meaning, not
// tuned outcomes: ~60 glyphs = a comfortable syllabary (kana 46+), ~120 =
// strained, ~220 = the practical ceiling (Yi is the famous outlier);
// logography's base is LOW (thousands of glyphs) and earns its keep only
// where morphemes are isolable, short, and homophone-heavy under tone.
function sylSpaceOf(lang) {
  const inv = compiledInv(lang);
  const sb = inv.syllab;
  const nuc = inv.vows.length + (sb.diphs ? sb.diphs.length : 0);
  return (sb.onsets.length + 1) * nuc * (sb.codas.length + 1);
}
function fitsOf(lang) {
  const p = lang.prof;
  const syl = sylSpaceOf(lang);
  return {
    logo: 0.3 + (p.morph === "iso" ? 1.1 : 0) + (p.tone ? 0.7 : 0) + (p.wordLen <= 1.6 ? 0.7 : 0),
    syll: syl <= 60 ? 2.2 : syl <= 120 ? 1.3 : syl <= 220 ? 0.5 : 0.1,
    abjad: p.morph === "tmpl" ? 2.4 : p.harmony !== "none" ? 0.8 : 0.5,   // predictable vowels are cheap to omit
    abugida: 1.1 + (p.sylC <= 1 ? 0.5 : 0) - (p.onDepth >= 2 ? 0.6 : 0),
    alphabet: 1.4 + (p.sylC >= 2 ? 0.6 : 0),
  };
}
// one simplification step per re-learning, along attested pathways only
const LADDER = { logo: ["syll", "abjad"], syll: ["alphabet", "abugida"], abjad: ["alphabet", "abugida"], abugida: [], alphabet: [] };
export const SCRIPT_NAME = { logo: "logographic", syll: "syllabary", abjad: "abjad (consonants only)", abugida: "abugida", alphabet: "alphabet" };
export const HAND_NAME = {
  carved: "carved (no strokes along the grain)",
  clay: "pressed into clay (wedges)",
  brush: "brushed (boxy, stroke-ordered)",
  pen: "pen cursive (joined)",
  round: "rounded (the palm-leaf rule: no straight cuts)",
};

const SCRIPTS = new WeakMap();

/** The language's script, or null while the tradition is preliterate.
 *  → { type, dir, hand, born, adoptedAt, frozenAt, reformed, lag, sep,
 *      matres, virama, codaMode, toneWritten, headline, join,
 *      styleSeed, glyphBudget } */
export function scriptOf(lang) {
  const key = lang.rules.length * 1000003 + (lang.gen || 0) * 101 + (lang.xph ? lang.xph.length : 0);
  const hit = SCRIPTS.get(lang);
  if (hit && hit.key === key) return hit.script;
  const fam = lang.famSeed ?? lang.seed;
  const len = lang.rules.length;
  let script = null;
  if (lang.prof.script) {
    // pinned reference scenario data: the type is given; the tradition is
    // as old as the record (adoptedAt 0), so DRIFTING a pinned shape grows
    // real lag — spell it 1900, say it after the shift
    const p = lang.prof.script;
    script = { type: p.type, dir: p.dir || "ltr", born: 0, adoptedAt: 0, frozenAt: 0, reformed: false, hand: p.hand || (p.type === "logo" ? "brush" : "pen") };
  } else {
    // the records tradition consolidates after a little accumulated history
    // (rule-log index = emergent state, never wall-clock)
    const born = 1 + hash32(fam, "scr:born") % 3;
    if (len >= born) {
      let type = "logo", adoptedAt = born;
      // re-learning junctures: each is a chance to simplify one ladder step
      // toward whatever fits THIS language best — or to keep what works
      const j1 = born + 2 + hash32(fam, "scr:g1") % 3;
      const j2 = j1 + 2 + hash32(fam, "scr:g2") % 4;
      for (const at of [j1, j2]) {
        if (len < at) break;
        const fits = fitsOf(lang);
        let best = null;
        for (const t of LADDER[type]) if (!best || fits[t] > fits[best]) best = t;
        if (best && fits[best] > fits[type] + 0.15) { type = best; adoptedAt = at; }
      }
      // spelling consolidates on the current type and freezes there — a
      // type change was the last reform… unless the tradition, drifted deep
      // into lag, reforms WITHOUT changing type (state-gated: only fires
      // once the unreplayed tail is real)
      let frozenAt = Math.min(len, adoptedAt + hash32(fam, "scr:frz") % 2);
      let reformed = false;
      const rj = adoptedAt + 5 + hash32(fam, "scr:rg") % 4;      // a possible reform juncture
      if (len >= rj && len - frozenAt >= 5 && h01(fam, "scr:reform") < 0.45) {
        frozenAt = Math.min(len, rj); reformed = true;           // the Turkish move
      }
      script = { type, born, adoptedAt, frozenAt, reformed };
      // direction: weighted by type — the historical-accident distribution
      // (abjads run right-to-left with their Semitic lineage; logographies
      // and their syllabic daughters took columns; everyone else mostly ltr)
      const r = h01(fam, "scr:dir");
      script.dir = type === "abjad" ? (r < 0.6 ? "rtl" : "ltr")
        : type === "logo" || type === "syll" ? (r < 0.3 ? "ttb" : r < 0.85 ? "ltr" : "rtl")
        : r < 0.78 ? "ltr" : r < 0.92 ? "rtl" : "ttb";
      // THE HAND: the family's material culture, re-rolled at adoption —
      // a re-learned script may change its whole look
      const hr = h01(fam, "scr:hand", adoptedAt);
      script.hand = hr < 0.18 ? "carved" : hr < 0.3 ? "clay" : hr < 0.5 ? "brush" : hr < 0.78 ? "pen" : "round";
    }
  }
  if (script) {
    const fam2 = fam;
    script.lag = len - script.frozenAt;
    script.styleSeed = hash32(fam2, "scr:style", script.adoptedAt) >>> 0;
    const inv = compiledInv(lang);
    // per-type orthographic machinery (each its own stream)
    script.sep = (() => { const r = h01(fam2, "scr:sep"); return r < 0.5 ? "space" : r < 0.85 ? "continua" : "dot"; })();
    script.matres = script.type === "abjad" ? (h01(fam2, "scr:mat") < 0.7 ? "long" : "none") : null;
    script.virama = script.type === "abugida" ? h01(fam2, "scr:vir") < 0.7 : false;
    script.codaMode = script.type === "syll"
      ? (lang.prof.nasalCoda ? "moraic" : h01(fam2, "scr:coda") < 0.5 ? "echo" : "drop") : null;
    script.toneWritten = lang.prof.tone > 0 && script.type !== "logo" && script.type !== "syll"
      ? h01(fam2, "scr:tw") < 0.35 : false;                      // the Vietnamese minority
    script.headline = script.type === "abugida" && h01(script.styleSeed, "head") < 0.55;   // the Devanagari bar
    script.join = script.hand === "pen" && h01(script.styleSeed, "join") < 0.65;           // joined cursive
    script.glyphBudget = script.type === "logo" ? CONCEPTS.length
      : script.type === "syll" ? sylSpaceOf(lang)
      : script.type === "abjad" ? inv.cons.length + (script.matres === "long" ? 2 : 0)
      : inv.cons.length + inv.vows.length;
  }
  SCRIPTS.set(lang, { key, script });
  return script;
}

// ── the frozen tradition: a ghost record replaying only rules[0..frozenAt) —
// the exact machinery the dictionary uses, one truncated log (memoized)
const GHOSTS = new WeakMap();
function frozenLang(lang, frozenAt) {
  const key = frozenAt * 1000003 + (lang.gen || 0) * 101 + lang.loans.length;
  const hit = GHOSTS.get(lang);
  if (hit && hit.key === key) return hit.ghost;
  const ghost = { ...lang, rules: lang.rules.slice(0, frozenAt), loans: [] };
  GHOSTS.set(lang, { key, ghost });
  return ghost;
}

/** The WRITTEN internal form of a concept — the word as the frozen spelling
 *  tradition records it (deep copy), or null while preliterate. */
export function writtenFormOf(lang, cid) {
  const s = scriptOf(lang);
  return s ? nativeStemOf(frozenLang(lang, s.frozenAt), cid) : null;
}
const stripTone = (w) => w.normalize("NFD").replace(/[̀-ͯ]/g, "").normalize("NFC");
/** The frozen spelling, romanized — ⟨knight⟩ beside today's [naɪt]. A
 *  script that leaves tone unwritten transliterates without the marks. */
export function writtenWordOf(lang, cid) {
  const s = scriptOf(lang);
  const f = writtenFormOf(lang, cid);
  if (!f) return null;
  const w = renderWord(f, lang.prof);
  return s.toneWritten || !lang.prof.tone ? w : stripTone(w);
}

// ── glyphs: a stroke grammar in the script's own HAND ─────────────────────
// A glyph is strokes over a normalized box; each medium constrains WHAT a
// stroke may be, exactly as the material does in life. Letters live in a
// body band with rolled ascenders/descenders (the x-height rhythm);
// logographs fill a square and compose by RADICAL SLOTS. Deterministic per
// (styleSeed, key); the Lab draws the emitted data as SVG.
const GX = [0.12, 0.5, 0.88], GY4 = [0, 0.33, 0.66, 1];
function styleOf(script) {
  const s = script.styleSeed;
  return {
    hand: script.hand,
    slant: script.hand === "pen" ? (h01(s, "slant") - 0.3) * 0.4 : (h01(s, "slant") - 0.5) * 0.16,
    aspect: 0.78 + h01(s, "aspect") * 0.36,
    chain: script.hand === "pen" ? 0.8 : script.hand === "round" ? 0.5 : 0.3,
    nMin: script.type === "logo" ? 3 : script.type === "syll" ? 2 : 1,
    nMax: script.type === "logo" ? (script.hand === "brush" ? 7 : 6) : script.type === "syll" ? 3 : 3,
  };
}
// one stroke in the medium's vocabulary
function strokeIn(hand, H, i, a, b) {
  if (hand === "carved") {
    // no strokes along the grain: force a vertical component
    if (a.y === b.y) b = { x: b.x, y: b.y + (b.y < 0.5 ? 0.5 : -0.5) };
    return { pts: [a, b], bow: 0 };
  }
  if (hand === "clay") {
    // a wedge: short head + drag, snapped to the four cuneiform directions
    const dirs = [[1, 0], [0, 1], [1, 1], [-1, 1]];
    const d = dirs[H("wd", i) % 4];
    const ln = 0.28 + 0.22 * ((H("wl", i) % 100) / 100);
    const cl = (v) => Math.max(0.04, Math.min(0.96, v));
    return { pts: [a, { x: cl(a.x + d[0] * ln), y: cl(a.y + d[1] * ln) }], bow: 0, kind: "wedge" };
  }
  if (hand === "brush") {
    // boxy: 80% axis-aligned, the rest diagonal; the faintest bow
    if (H("ax", i) % 100 < 80) { if (H("hv", i) % 2) b = { x: b.x, y: a.y }; else b = { x: a.x, y: b.y }; }
    if (a.x === b.x && a.y === b.y) b = { x: a.x === GX[2] ? GX[0] : GX[2], y: b.y };
    return { pts: [a, b], bow: (H("bw", i) % 2 ? 1 : -1) * 0.04 };
  }
  if (hand === "round") {
    // the palm-leaf rule: every stroke arcs, some close into circles
    if (H("cir", i) % 100 < 30) return { pts: [a, a], bow: 0, kind: "loop", r: 0.14 + 0.1 * ((H("cr", i) % 100) / 100) };
    return { pts: [a, b], bow: (H("bw", i) % 2 ? 1 : -1) * (0.28 + 0.25 * ((H("bb", i) % 100) / 100)) };
  }
  // pen: free curves, moderate bows, occasional loop
  if (H("cir", i) % 100 < 12) return { pts: [a, a], bow: 0, kind: "loop", r: 0.1 + 0.08 * ((H("cr", i) % 100) / 100) };
  return { pts: [a, b], bow: (H("bw", i) % 2 ? 1 : -1) * (0.1 + 0.2 * ((H("bb", i) % 100) / 100)) };
}
function rawStrokes(script, key, salt) {
  const st = styleOf(script);
  const H = (...a) => hash32(script.styleSeed, "g:" + key, salt, ...a);
  const P = (i) => ({ x: GX[i % 3], y: GY4[(i / 3 | 0) % 4] });
  const n = st.nMin + H("n") % (st.nMax - st.nMin + 1);
  const strokes = [];
  let prev = null;
  for (let i = 0; i < n; i++) {
    const a = st.chain && prev && (H("ch", i) % 100) / 100 < st.chain ? prev : P(H("a", i) % 12);
    let b = P(H("b", i) % 12);
    if (b.x === a.x && b.y === a.y) b = P((H("b", i) + 5) % 12);
    const s = strokeIn(st.hand, H, i, a, b);
    // an occasional third leg for non-wedge, non-loop strokes
    if (!s.kind && H("leg", i) % 100 < 30) {
      let c = P(H("c", i) % 12);
      const last = s.pts[s.pts.length - 1];
      if (c.x === last.x && c.y === last.y) c = P((H("c", i) + 7) % 12);
      if (st.hand === "carved" && c.y === last.y) c = { x: c.x, y: c.y + (c.y < 0.5 ? 0.33 : -0.33) };
      s.pts.push(c);
    }
    strokes.push(s);
    prev = s.pts[s.pts.length - 1];
  }
  // slant + aspect, clamped to the box
  const cl = (v) => Math.max(0.02, Math.min(0.98, v));
  for (const s of strokes) s.pts = s.pts.map(p => ({ x: cl(0.5 + (p.x - 0.5) * st.aspect + (0.5 - p.y) * st.slant), y: p.y }));
  return strokes;
}
// letters live in a BODY BAND with rolled ascenders/descenders — the
// x-height rhythm that makes a written line read as one hand
function bandStrokes(script, key, salt) {
  const raw = rawStrokes(script, key, salt);
  if (script.type === "logo" || script.type === "syll") return raw;   // square signs
  const z = hash32(script.styleSeed, "zone", key) % 100;
  const [top, bot] = z < 68 ? [0.3, 0.76] : z < 84 ? [0.06, 0.76] : [0.3, 0.97];
  for (const s of raw) {
    s.pts = s.pts.map(p => ({ x: p.x, y: top + p.y * (bot - top) }));
    if (s.kind === "loop") s.r = (s.r || 0.12) * (bot - top);
  }
  return raw;
}
// distinctness lives in KIND + POINTS: a loop that moved is a new sign, a
// loop that merely grew is the same sign in a different mood. Bins are
// COARSE (a twelfth of the box) — two wedges 3% apart are the same wedge
// to any reader, so the walk must move further than that
const sigOfStrokes = (ss) => ss.map(s => (s.kind || "") + s.pts.map(p => Math.round(p.x * 12) + "," + Math.round(p.y * 12)).join(";")).join("|");

// keys: segments by feature signature; syllables by their segment signatures
const ckey = (c) => "c" + c.p + "." + c.m + "." + c.l + "." + c.s;
const vkey = (v) => "v" + v.h + "." + v.b + "." + v.r;
const sylkey = (s) => [...s.on.map(ckey), ...s.nu.map(vkey), ...s.co.map(ckey)].join("-");
// domain radicals for phono-semantic compounds (one per concept domain)
const radKey = (d) => "rad:" + d;

/** The script's glyph table: [{ key, label, strokes, mark? }] — finite types
 *  enumerate their (frozen) inventory in a fixed order with a distinctness
 *  walk, so no two signs of one script collide. Logographies are an open
 *  set (one glyph per morpheme) and are sampled per word instead. */
export function glyphInventory(lang, cap = 64) {
  const s = scriptOf(lang);
  if (!s) return null;
  const seen = new Set();
  const mk = (key, label, markPos = null, post = (x) => x) => {
    let salt = 0, st = post(bandStrokes(s, key, salt));
    while (seen.has(sigOfStrokes(st)) && salt < 24) st = post(bandStrokes(s, key, ++salt));
    seen.add(sigOfStrokes(st));
    return { key, label, strokes: st, mark: markPos };
  };
  const inv = compiledInv(lang);
  const out = [];
  if (s.type === "logo") {
    for (let cid = 0; cid < CONCEPTS.length && out.length < Math.min(cap, 18); cid++) {
      const g = logoGlyph(lang, cid);
      if (!g) continue;
      const sig = sigOfStrokes(g.strokes);
      if (seen.has(sig)) continue;
      seen.add(sig);
      out.push({ key: "m" + cid, label: CONCEPTS[cid].g, strokes: g.strokes });
    }
    return out;
  }
  if (s.type === "syll") {
    const sb = inv.syllab;
    outer: for (const v of inv.vows) {
      for (const on of [[], ...sb.onsets]) {
        const key = sylkey({ on, nu: [v], co: [] });
        out.push(mk(key, [...on.map(c => romLabel(lang, c)), romV(lang, v)].join("")));
        if (out.length >= cap) break outer;
      }
    }
    return out;
  }
  for (const c of inv.cons) { out.push(mk(ckey(c), romLabel(lang, c))); if (out.length >= cap) return out; }
  if (s.type === "abugida") {
    // vowel DIACRITICS: 1-stroke marks; the commonest vowel is inherent
    // (unmarked) — the inventory is frequency-ordered, so vows[0] is it
    const pos = markPosOf(s);
    inv.vows.slice(1).forEach((v) => {
      if (out.length >= cap) return;
      out.push(mk("vd:" + vkey(v), romV(lang, v), pos, (st) => st.slice(0, 1)));
    });
  } else if (s.type === "alphabet") {
    for (const v of inv.vows) { if (out.length >= cap) break; out.push(mk(vkey(v), romV(lang, v))); }
  } else if (s.type === "abjad" && s.matres === "long") {
    out.push(mk("mater:back", "ū/ō (mater)"));
    out.push(mk("mater:front", "ī/ē (mater)"));
    out.push(mk("carrier", "initial vowel (carrier)"));
  }
  return out;
}
const markPosOf = (s) => { const r = h01(s.styleSeed, "mkpos"); return r < 0.5 ? "above" : r < 0.8 ? "below" : "after"; };
const romLabel = (lang, c) => romanizeC(c, lang.prof.romTaste, lang.prof.rom, lang.prof.orthoStyle);
const romV = (lang, v) => romanizeV(v, lang.prof.rom);

// ── logographs: radical-slot composition + the phono-semantic machine ─────
// A derived morpheme compounds its parts in a rolled RADICAL SLOT (left-
// right, top-bottom, or enclosure — the hanzi structures). A morpheme whose
// frozen surface is homophonous with an earlier one is written PHONO-
// SEMANTICALLY: the domain radical beside the glyph of the word it sounds
// like — the 形声 principle that built most of the hanzi.
const HOMS = new WeakMap();
function homOwner(lang, cid) {
  const s = scriptOf(lang);
  const key = s.frozenAt * 1000003 + (lang.gen || 0);
  let h = HOMS.get(lang);
  if (!h || h.key !== key) {
    const ghost = frozenLang(lang, s.frozenAt);
    const owner = new Map();
    const byCid = new Map();
    for (let c = 0; c < CONCEPTS.length; c++) {
      const w = wordOf(ghost, c);
      if (owner.has(w)) byCid.set(c, owner.get(w));
      else owner.set(w, c);
    }
    h = { key, byCid };
    HOMS.set(lang, h);
  }
  return h.byCid.has(cid) ? h.byCid.get(cid) : null;
}
const fitBox = (ss, x0, y0, w, h) => ss.map(x => ({ ...x, r: x.kind === "loop" ? (x.r || 0.12) * Math.min(w, h) : undefined, pts: x.pts.map(p => ({ x: x0 + p.x * w, y: y0 + p.y * h })) }));
function logoGlyph(lang, cid, depth = 0) {
  const s = scriptOf(lang);
  const ety = etymologyOf(lang, cid);
  if (ety && depth === 0) {
    const L = rawStrokes(s, "m" + ety.mod, 0), R = rawStrokes(s, "m" + ety.head, 0);
    const slot = hash32(s.styleSeed, "slot", cid) % 3;
    if (slot === 0) return { strokes: [...fitBox(L, 0.04, 0.15, 0.36, 0.7), ...fitBox(R, 0.46, 0.08, 0.5, 0.84)], compound: true };
    if (slot === 1) return { strokes: [...fitBox(L, 0.12, 0.02, 0.76, 0.4), ...fitBox(R, 0.08, 0.48, 0.84, 0.5)], compound: true };
    // enclosure: the modifier draws the frame, the head sits inside
    const frame = fitBox(L.slice(0, 2), 0.02, 0.02, 0.96, 0.96);
    return { strokes: [...frame, ...fitBox(R, 0.24, 0.24, 0.52, 0.52)], compound: true };
  }
  const own = depth === 0 ? homOwner(lang, cid) : null;
  if (own != null && own !== cid) {
    // phono-semantic: domain radical (left, small) + the phonetic's glyph
    const rad = rawStrokes(s, radKey(CONCEPTS[cid].d), 0).slice(0, 2);
    const ph = logoGlyph(lang, own, 1);
    return { strokes: [...fitBox(rad, 0.03, 0.2, 0.3, 0.6), ...fitBox(ph.strokes, 0.4, 0.06, 0.56, 0.88)], compound: true, phono: own };
  }
  return { strokes: rawStrokes(s, "m" + cid, 0), compound: false };
}

// glide letters make natural matres (w for the back vowels, y for front) —
// the language's own inventory supplies them where it can
function materKey(lang, v) { return v.b === 0 ? "mater:front" : "mater:back"; }

/** Write ONE internal form in the language's script — the clause layer's
 *  entry point. `cid`, when known, lets a logography use its morpheme sign
 *  (compound radicals, phono-semantics); a cid-less form in a logography
 *  earns its own grammar sign keyed on the form's segment signature — the
 *  了/的 pattern, where the function words carry dedicated signs. Tone
 *  diacritics (when the script writes tone) use the SAME melody index the
 *  vocalizer speaks and the romanization marks. → [{strokes, mark?}] */
export function writeForm(lang, form, cid = null) {
  const s = scriptOf(lang);
  if (!s || !form) return null;
  const glyphs = [];
  const G = (key) => ({ strokes: bandStrokes(s, key, 0) });
  const pos = s.type === "abugida" ? markPosOf(s) : null;
  const plan = s.toneWritten ? phoneticPlan(lang, form) : null;
  const toneMark = (sylIdx) => {
    if (!plan || !glyphs.length || plan.syls[sylIdx].tone == null) return;
    const m = rawStrokes(s, "tone:" + plan.syls[sylIdx].tone, 0).slice(0, 1);
    const g = glyphs[glyphs.length - 1];
    if (!g.mark) g.mark = { strokes: m, pos: "above" };
  };
  if (s.type === "logo") {
    if (cid != null) glyphs.push({ strokes: logoGlyph(lang, cid).strokes });
    else glyphs.push(G("w:" + form.syls.map(sylkey).join("+")));
  } else if (s.type === "syll") {
    form.syls.forEach((syl) => {
      const bare = { on: syl.on, nu: syl.nu, co: [] };
      glyphs.push(G(sylkey(syl.co.length ? bare : syl)));
      for (const c of syl.co) {                                  // the three attested coda treatments
        if (s.codaMode === "moraic" && c.m === 1) glyphs.push(G("mora:N"));
        else if (s.codaMode === "echo") glyphs.push(G(sylkey({ on: [c], nu: syl.nu.slice(0, 1), co: [] })));   // ko-no-so
        // drop: unwritten
      }
    });
  } else if (s.type === "abjad") {
    form.syls.forEach((syl, i) => {
      if (i === 0 && !syl.on.length && s.matres === "long") glyphs.push(G("carrier"));   // initial vowel needs a seat
      for (const c of syl.on) glyphs.push(G(ckey(c)));
      if (s.matres === "long" && syl.nu.some(v => v.lg)) glyphs.push(G(materKey(lang, syl.nu[0])));
      for (const c of syl.co) glyphs.push(G(ckey(c)));
      toneMark(i);
    });
  } else if (s.type === "abugida") {
    const inv = compiledInv(lang);
    const inherent = vkey(inv.vows[0]);
    form.syls.forEach((syl, i) => {
      const base = syl.on.length ? G(ckey(syl.on[0])) : G("vc:carrier");
      const v = syl.nu[0];
      if (v && vkey(v) !== inherent) base.mark = { strokes: rawStrokes(s, "vd:" + vkey(v), 0).slice(0, 1), pos };
      glyphs.push(base);
      for (const c of [...syl.on.slice(1), ...syl.co]) {
        const g = G(ckey(c));
        if (s.virama) g.mark = { strokes: rawStrokes(s, "virama", 0).slice(0, 1), pos: "below" };   // the killer mark
        glyphs.push(g);
      }
      toneMark(i);
    });
  } else {
    form.syls.forEach((syl, i) => {
      for (const c of syl.on) glyphs.push(G(ckey(c)));
      for (const v of syl.nu) glyphs.push(G(vkey(v)));
      for (const c of syl.co) glyphs.push(G(ckey(c)));
      toneMark(i);
    });
  }
  return glyphs;
}

/** Write one concept in the language's own script.
 *  → { glyphs: [{strokes, mark?}], translit, silent } | null — translit is
 *  the FROZEN spelling romanized (sans tone where the script leaves tone
 *  unwritten); silent flags a spelling the sound has since left behind. */
export function writeWord(lang, cid) {
  const s = scriptOf(lang);
  if (!s) return null;
  if ((lang.loans || []).some(x => x.c === cid)) return null;   // a loan has no native tradition (v1)
  const frozen = writtenFormOf(lang, cid);
  const translit = writtenWordOf(lang, cid);
  const saidNow = renderWord(nativeStemOf(lang, cid), lang.prof);
  const said = s.toneWritten || !lang.prof.tone ? saidNow : stripTone(saidNow);
  return { glyphs: writeForm(lang, frozen, cid), translit, silent: translit !== said };
}

/** Numeral signs: the low digits are TALLY marks in the script's own
 *  medium (near-universal — 一二三, I II III, cuneiform wedges); higher
 *  digits get their own signs. → [{strokes}] for the number's digits. */
export function numeralGlyphs(lang, n) {
  const s = scriptOf(lang);
  if (!s) return null;
  const unit = bandStrokes(s, "num:1", 0).slice(0, 1);
  const out = [];
  if (n <= 3) {
    // stacked tallies, spaced within one sign box
    const strokes = [];
    for (let i = 0; i < n; i++) strokes.push(...fitBox(unit, s.dir === "ttb" ? 0.1 : 0.08 + i * 0.3, s.dir === "ttb" ? 0.08 + i * 0.3 : 0.1, s.dir === "ttb" ? 0.8 : 0.26, s.dir === "ttb" ? 0.26 : 0.8));
    out.push({ strokes });
    return out;
  }
  if (n <= 9) { out.push({ strokes: bandStrokes(s, "num:" + n, 0) }); return out; }
  if (n === 10) { out.push({ strokes: bandStrokes(s, "num:10", 0) }); return out; }
  return null;
}

/** Words whose frozen spelling no longer matches their sound — the silent-
 *  letter showcase. → [{ cid, written, said }] (up to `cap`). */
export function silentLetterSample(lang, cap = 4) {
  const s = scriptOf(lang);
  if (!s || !s.lag) return [];
  const out = [];
  const loans = new Set((lang.loans || []).map(x => x.c));
  const seen = new Set();                              // colexified pairs share a word — show each once
  for (let cid = 0; cid < CONCEPTS.length && out.length < cap; cid++) {
    if (loans.has(cid)) continue;
    const written = writtenWordOf(lang, cid);
    const now = renderWord(nativeStemOf(lang, cid), lang.prof);
    const said = s.toneWritten || !lang.prof.tone ? now : stripTone(now);
    if (written && written !== said && !seen.has(written + "|" + said)) {
      seen.add(written + "|" + said);
      out.push({ cid, written, said });
    }
  }
  return out;
}

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
import { compiledInv, nativeStemOf, etymologyOf, wordOf, loanOf } from "./language.js";
import { renderWord, romanizeC, romanizeV } from "./languagePhonology.js";
import { CONCEPTS } from "./languageLexicon.js";
import { phoneticPlan } from "./languagePhonetics.js";

const h01 = (...a) => hash32(...a) / 4294967296;

// ── structural fit: what each type costs THIS language ────────────────────
// Constants are learnability/typology priors with independent meaning, not
// tuned outcomes: ~60 signs = a comfortable syllabary (kana 46+), ~120 =
// strained, ~220 = the practical ceiling (Yi is the famous outlier);
// logography's base is LOW (thousands of glyphs) and earns its keep only
// where morphemes are isolable, short, and homophone-heavy under tone.
//
// Fit is measured against the ATTESTED corpus at the juncture, never the
// generative profile alone: sound change bakes splits and clusters into the
// words themselves, so the corpus a late juncture faces differs from the one
// the founders saw — this drift is the entire engine of late reform and of
// invention (a syllabary adopted over a simple corpus, strained past its
// ceiling by centuries of splits, is the Sejong condition).
const CORPORA = new WeakMap();
function corpusOf(lang, at) {
  const cut = Math.min(at, lang.rules.length);
  const key = cut + ":" + (lang.xph ? lang.xph.length : 0);   // concept stems ignore gen and loans
  let m = CORPORA.get(lang);
  if (!m) { m = new Map(); CORPORA.set(lang, m); }
  const hit = m.get(key);
  if (hit) return hit;
  const gl = cut >= lang.rules.length ? lang : frozenLang(lang, cut);
  const types = new Set();
  let syls = 0, words = 0, clustered = 0;
  for (let cid = 0; cid < CONCEPTS.length; cid++) {
    const f = nativeStemOf(gl, cid);
    if (!f || !f.syls) continue;
    words++;
    syls += f.syls.length;
    for (const sy of f.syls) { types.add(sylkey(sy)); if (sy.on.length >= 2 || sy.co.length >= 2) clustered++; }
  }
  const out = { sylTypes: types.size, wordLen: syls / Math.max(1, words), clusterRate: clustered / Math.max(1, syls) };
  if (m.size > 512) m.clear();                         // tiny records; a deep history keeps all its junctures warm
  m.set(key, out);
  return out;
}
function fitsOf(lang, at) {
  const p = lang.prof;
  const c = corpusOf(lang, at);
  return {
    logo: 0.3 + (p.morph === "iso" ? 1.1 : 0) + (p.tone ? 0.7 : 0) + (c.wordLen <= 1.6 ? 0.7 : 0),
    syll: c.sylTypes <= 60 ? 2.2 : c.sylTypes <= 120 ? 1.3 : c.sylTypes <= 220 ? 0.5 : 0.1,
    abjad: p.morph === "tmpl" ? 2.4 : p.harmony !== "none" ? 0.8 : 0.5,   // predictable vowels are cheap to omit
    // clusterRate = share of syllables carrying a complex margin: under 1-in-25
    // the corpus is canonically CV (an abugida's home ground); past 1-in-8
    // clusters are systemic and segment letters pay for themselves
    abugida: 1.1 + (c.clusterRate < 0.04 ? 0.5 : 0) - (c.clusterRate >= 0.12 ? 0.6 : 0),
    alphabet: 1.4 + (c.clusterRate >= 0.12 ? 0.6 : 0),
  };
}
// one simplification step per re-learning, along attested pathways only
const LADDER = { logo: ["syll", "abjad"], syll: ["alphabet", "abugida"], abjad: ["alphabet", "abugida"], abugida: [], alphabet: [], featural: [] };
export const SCRIPT_NAME = { logo: "logographic", syll: "syllabary", abjad: "abjad (consonants only)", abugida: "abugida", alphabet: "alphabet", featural: "featural alphabet (letters draw the sounds' own features)" };
export const HAND_NAME = {
  carved: "carved (no strokes along the grain)",
  clay: "pressed into clay (wedges)",
  brush: "brushed (boxy, stroke-ordered)",
  pen: "pen cursive (joined)",
  round: "rounded (the palm-leaf rule: no straight cuts)",
};

const SCRIPTS = new WeakMap();

/** The language's script — every record-keeping people writes, so this is
 *  non-null for every language record (a newborn record is a young
 *  logography with zero lag; null is reserved for future sim-side
 *  preliterate wiring).
 *  → { type, dir, hand, born, adoptedAt, frozenAt, reformed, lag, sep,
 *      matres, virama, codaMode, toneWritten, headline, join,
 *      styleSeed, glyphBudget } */
/** SCRIPT SPREAD: adopt a neighbour's writing tradition — how most scripts
 *  on Earth actually arrived (Latin, Arabic, Cyrillic each cover dozens of
 *  tongues; primary invention is the rarity). The borrower takes the
 *  donor's whole LOOK — type, hand, direction, letterforms — and spells
 *  ITSELF by ear at adoption; its own orthographic machinery (matres,
 *  virama, tone marking) is re-derived for its own phonology, and its own
 *  junctures continue from there. A borrowed costume that fits badly is
 *  the true Sejong precondition. Additive record field `lang.scr`. */
export function adoptScriptFrom(lang, donor) {
  const ds = scriptOf(donor);
  if (!ds) return null;
  lang.scr = { type: ds.type, hand: ds.hand, dir: ds.dir, styleSeed: ds.styleSeed >>> 0, from: donor.id ?? 0, at: lang.rules.length };
  return scriptOf(lang);
}

export function scriptOf(lang) {
  const key = lang.rules.length + ":" + (lang.gen || 0) + ":" + (lang.xph ? lang.xph.length : 0)
    + ":" + (lang.scr ? lang.scr.at + "." + lang.scr.styleSeed + "." + lang.scr.type : "");
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
    // the record IS the tradition: every language here belongs to a
    // record-keeping people, so writing begins with the record itself —
    // logographic, the accounting-token origin of every primary invention.
    // UNLESS the tradition ARRIVED: a borrowed script (lang.scr) starts at
    // its adoption index with the donor's type and whole look — the
    // Latin/Arabic/Cyrillic path, how most scripts actually spread.
    // (Truly preliterate tongues return with sim-side literacy wiring,
    // parked; everything downstream still keys on accumulated history.)
    const scr = lang.scr && lang.scr.at <= len ? lang.scr : null;
    const born = scr ? scr.at : 0;
    {
      let type = scr ? scr.type : "logo", adoptedAt = born;
      // re-learning junctures: each is a chance to simplify one ladder step
      // toward whatever fits THIS language best — or to keep what works.
      // A BORROWED script pays a PRESTIGE TAX to step: abandoning the
      // civilized neighbour's letters costs legitimacy, so only a
      // chasm-sized gap moves it (Korea kept Chinese characters for
      // centuries — and the escape, when it came, was invention)
      const stepGap = scr ? 0.9 : 0.15;
      const j1 = born + 2 + hash32(fam, "scr:g1") % 3;
      const j2 = j1 + 2 + hash32(fam, "scr:g2") % 4;
      for (const at of [j1, j2]) {
        if (len < at) break;
        // the decision reads the corpus AS IT STOOD at the juncture — a
        // centuries-old adoption cannot see today's phonology (and so the
        // verdict never rewrites itself as later rules accumulate)
        const fits = fitsOf(lang, at);
        let best = null;
        for (const t of LADDER[type]) if (!best || fits[t] > fits[best]) best = t;
        if (best && fits[best] > fits[type] + stepGap) { type = best; adoptedAt = at; }
      }
      // spelling consolidates on the current type and freezes there — then
      // post-consolidation junctures RECUR as history accumulates (every few
      // rules of depth, never wall-clock). Each is a fresh literate
      // generation's chance to reform a drifted spelling (the Turkish move)
      // — or, holding a script whose fit the corpus has left behind, to
      // INVENT: a featural alphabet whose letters draw the sounds' own
      // features (the Sejong condition — current fit poor, a far better fit
      // exists — evaluated on the corpus AS IT STOOD at that juncture, so
      // the verdict never rewrites itself later)
      let frozenAt = Math.min(len, adoptedAt + hash32(fam, "scr:frz") % 2);
      let reformed = false, invented = false;
      // one juncture every 2 rules of depth ≈ one literate era; the grid is
      // anchored at rj so a verdict, once passed, never moves. Reform runs
      // at 0.15/era — most traditions FOSSILIZE (France convenes academies
      // that fail); the misfit-invention roll is generous at 0.4/era, since
      // courts facing a systemically unusable script do act within a few
      // eras (Korea, Cherokee, Vai — invention under misfit recurs in the
      // record; the rarity lives in the PRECONDITION, not the roll)
      const rj = adoptedAt + 5 + hash32(fam, "scr:rg") % 4;
      for (let at = rj; at <= len; at += 2) {
        const f2 = fitsOf(lang, at);
        const bestAll = Math.max(f2.logo, f2.syll, f2.abjad, f2.abugida, f2.alphabet);
        if (f2[type] < 0.75 && bestAll > f2[type] + 0.6 && h01(fam, "scr:inv", at) < 0.4) {
          type = "featural"; adoptedAt = at; frozenAt = at; invented = true;
          break;                                                 // an invention is terminal
        } else if (at - frozenAt >= 5 && h01(fam, "scr:reform", at) < 0.15) {
          frozenAt = at; reformed = true;                        // the Turkish move
        }
      }
      script = { type, born, adoptedAt, frozenAt, reformed, invented, borrowed: !!scr };
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
      // BOUSTROPHEDON: an archaic monumental convention — the line turns
      // as the ox plows, letters mirroring on the return. It survives only
      // in traditions never re-learned (standardization killed it on Earth
      // too: archaic Greek and Etruscan had it, their descendants don't),
      // and never on the joined pen, whose ligatures fix a direction
      if (adoptedAt === born && !scr && script.hand !== "pen" && h01(fam, "scr:bous") < 0.1) script.dir = "boustro";
      // a borrowed tradition that was never re-learned keeps the DONOR's
      // conventions whole — direction, medium, letterforms travel together
      if (scr && adoptedAt === born) { script.dir = scr.dir; script.hand = scr.hand; }
    }
  }
  if (script) {
    const fam2 = fam;
    script.lag = len - script.frozenAt;
    script.styleSeed = script.borrowed && script.adoptedAt === script.born
      ? lang.scr.styleSeed >>> 0                       // the donor's letterforms, kept whole
      : hash32(fam2, "scr:style", script.adoptedAt) >>> 0;
    const inv = compiledInv(lang);
    // per-type orthographic machinery (each its own stream)
    script.sep = (() => { const r = h01(fam2, "scr:sep"); return r < 0.5 ? "space" : r < 0.85 ? "continua" : "dot"; })();
    script.matres = script.type === "abjad" && lang.prof.longV
      ? (h01(fam2, "scr:mat") < 0.7 ? "long" : "none") : script.type === "abjad" ? "none" : null;   // matres exist to write LONG vowels — no length, no maters
    script.virama = script.type === "abugida" ? h01(fam2, "scr:vir") < 0.7 : false;
    script.codaMode = script.type === "syll"
      ? (lang.prof.nasalCoda ? "moraic" : h01(fam2, "scr:coda") < 0.5 ? "echo" : "drop") : null;
    script.toneWritten = lang.prof.tone > 0 && script.type !== "logo" && script.type !== "syll"
      ? h01(fam2, "scr:tw") < 0.35 : false;                      // the Vietnamese minority
    script.headline = script.type === "abugida" && h01(script.styleSeed, "head") < 0.55;   // the Devanagari bar
    script.join = script.hand === "pen" && h01(script.styleSeed, "join") < 0.65;           // joined cursive
    if (script.type === "featural") {
      // a featural script is designed, not worn smooth: block-built, never
      // cursive, no inherited headline; the inventing court picks column
      // or row — a BORROWED featural keeps its donor's direction
      if (script.invented) script.dir = h01(fam2, "scr:fdir") < 0.8 ? "ltr" : "ttb";
      script.join = false; script.headline = false;
    }
    // the learner's budget IS the signary: mirror glyphMapOf's enumeration
    // exactly (keys only, no glyphs built), so the chip always equals the
    // table it sits above — a review caught them disagreeing
    script.glyphBudget = (() => {
      if (script.type === "logo") return CONCEPTS.length;
      if (script.type === "featural") return new Set(inv.cons.map(fkey)).size + new Set(inv.vows.map(vkey)).size;
      if (script.type === "syll") {
        const sb = inv.syllab;
        const done = new Set();
        for (const v of [...inv.vows, ...(sb.diphs || []).map(d => d[0])])
          for (const on of [[], ...sb.onsets, ...inv.cons.map(c => [c])])
            done.add([...on.map(ckey), vkey(v)].join("-"));
        return done.size + 1;                          // + the mora sign
      }
      const nC = new Set(inv.cons.map(ckey)).size;
      if (script.type === "abjad") return nC + (script.matres === "long" ? 3 : 0);   // 2 maters + carrier
      if (script.type === "abugida") {
        const inh = vkey(inv.vows[0]);
        return nC + new Set(inv.vows.filter(v => vkey(v) !== inh).map(vkey)).size + 1 + (script.virama ? 1 : 0);
      }
      return nC + new Set(inv.vows.map(vkey)).size;
    })();
  }
  SCRIPTS.set(lang, { key, script });
  return script;
}

// ── the frozen tradition: a ghost record replaying only rules[0..frozenAt) —
// the exact machinery the dictionary uses, one truncated log (memoized)
const GHOSTS = new WeakMap();
function frozenLang(lang, frozenAt) {
  const key = frozenAt + ":" + (lang.xph ? lang.xph.length : 0);   // the ghost ignores gen and loans
  let m = GHOSTS.get(lang);
  if (!m) { m = new Map(); GHOSTS.set(lang, m); }
  const hit = m.get(key);
  if (hit) return hit;
  const ghost = { ...lang, rules: lang.rules.slice(0, frozenAt), loans: [] };
  if (m.size > 64) m.clear();
  m.set(key, ghost);
  return ghost;
}

/** The WRITTEN internal form of a concept — the word as the frozen spelling
 *  tradition records it (deep copy), or null while preliterate. */
export function writtenFormOf(lang, cid) {
  if (!Number.isInteger(cid) || cid < 0 || cid >= CONCEPTS.length) return null;
  const s = scriptOf(lang);
  return s ? nativeStemOf(frozenLang(lang, s.frozenAt), cid) : null;
}
const stripTone = (w) => w.normalize("NFD").replace(/[\u0300\u0301\u0304\u030C]/g, "").normalize("NFC");   // exactly TONE_MARKS — an umlaut is a vowel, not a melody
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
    // the pen slants FORWARD and mildly (the near-universal cursive habit);
    // other hands sit near upright
    slant: script.hand === "pen" ? 0.03 + h01(s, "slant") * 0.13 : (h01(s, "slant") - 0.5) * 0.16,
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
// ── letter anatomy: segmental signs are a STEM plus ATTACHMENTS ───────────
// Random strokes read as tick marks, not letters (a fresh eye caught the
// bare alphabets). Real alphabetic signs have anatomy: nearly every letter
// hangs its identity on a SPINE and what attaches at its joints — bowls,
// arms, crossbars, legs, a second stem (b d h k H N þ И). The hand supplies
// the vocabulary: carved bowls are ANGULAR (þ — the grain rule again), clay
// builds every element from wedges, the round hand arcs even its stems, the
// pen bows and loops, the brush stays square.
function anatomyStrokes(script, key, salt, attMin, attMax) {
  const st = styleOf(script);
  const hand = st.hand;
  const H = (...a) => hash32(script.styleSeed, "a:" + key, salt, ...a);
  // the DUCTUS: one hand wrote this whole script, so stroke conventions are
  // properties of the SCRIPT, rolled once from styleSeed — one bow
  // chirality, one arm-angle habit — never re-rolled per letter. Letter
  // identity lives in STRUCTURE (which joints carry which attachments),
  // exactly as in real alphabets, where E F H K read as siblings.
  const chir = hash32(script.styleSeed, "duct:chir") % 2 ? 1 : -1;
  const armSlope = (hash32(script.styleSeed, "duct:arm") % 3) * 0.08;       // level / shallow / steep — the script's habit
  const midDir = hash32(script.styleSeed, "duct:mid") % 2 ? 1 : -1;
  const strokes = [];
  const stemLeft = H("side") % 100 < 62;
  const sx = stemLeft ? 0.3 : 0.7;
  const ox = stemLeft ? 1 : -1;                    // attachments open away from the stem
  const W = hand === "clay" ? "wedge" : undefined;
  const line = (x1, y1, x2, y2, bow = 0, kind = W) => ({ pts: [{ x: x1, y: y1 }, { x: x2, y: y2 }], bow, ...(kind ? { kind } : {}) });
  // the spine — attachments must MEET it, so track where it passes; bowed
  // and diagonal spines take end attachments only (C G, never a floating B)
  const stemKind = H("stem") % 100;
  let spineX = () => sx;
  let endOnly = false;
  if (hand === "round") { strokes.push(line(sx, 0.04, sx, 0.96, chir * 0.3, undefined)); endOnly = true; }
  else if (stemKind < 66 || hand === "clay") strokes.push(line(sx, 0.04, sx, 0.96, hand === "pen" ? chir * 0.06 : hand === "brush" ? chir * 0.04 : 0));
  else if (stemKind < 85) { strokes.push(line(sx, 0.04, sx + ox * 0.3, 0.96, 0)); spineX = (jy) => sx + ox * 0.3 * ((jy - 0.04) / 0.92); }   // diagonal spine — attachments follow it
  else { strokes.push(line(sx, 0.04, sx, 0.96, chir * (hand === "pen" ? 0.22 : 0.12))); endOnly = true; }   // arched spine
  const joints = [0.08, 0.5, 0.92];
  const nAtt = attMin + H("n") % (attMax - attMin + 1);
  const usedJ = new Set();
  for (let i = 0; i < nAtt; i++) {
    let j = H("j", i) % 3;
    if (endOnly && j === 1) j = H("j2", i) % 2 ? 0 : 2;
    if (usedJ.has(j)) j = (j + 1) % 3;
    if (endOnly && j === 1) j = usedJ.has(0) ? 2 : 0;
    if (usedJ.has(j)) continue;                    // both ends taken — never float an attachment
    usedJ.add(j);
    const jy = joints[j];
    const ax = spineX(jy);
    const far = ax + ox * 0.42;
    // the hand's part repertoire: pen and palm-leaf hands favor BOWLS and
    // curved arms (b d p q — the minim-and-bowl economy); brush and chisel
    // favor bars — observed letterform typology, not tuning
    const kind = H("k", i) % 100;
    const bowlCut = hand === "pen" || hand === "round" ? 45 : 30;
    if (kind < bowlCut) {                          // BOWL at the joint (opens away from the nearest edge)
      const bd = jy > 0.7 ? -1 : 1;
      if (hand === "carved") { strokes.push(line(ax, jy, far, jy + bd * 0.18)); strokes.push(line(far, jy + bd * 0.18, ax, jy + bd * 0.36)); }
      else if (hand === "clay") { strokes.push(line(ax, jy, far, jy + bd * 0.15)); strokes.push(line(far, jy + bd * 0.15, ax, jy + bd * 0.3)); }
      else strokes.push({ pts: [{ x: ax + ox * 0.14, y: jy + bd * 0.14 }], bow: 0, kind: "loop", r: 0.17 });   // overlaps the stem, as b d p do
    } else if (kind < bowlCut + 25) {              // ARM from the joint — the script's own slope habit
      let dy = hand === "carved" ? (j === 2 ? -0.24 : 0.24) : j === 0 ? armSlope : j === 2 ? -armSlope : midDir * armSlope;
      if (jy + dy > 0.96 || jy + dy < 0.02) dy = -dy;
      strokes.push(line(ax, jy, far, jy + dy, hand === "round" ? chir * 0.32 : hand === "pen" ? chir * 0.12 : 0));
    } else if (kind < bowlCut + 42) {              // LEG to the baseline (k R)
      strokes.push(line(ax, jy === 0.92 ? 0.5 : jy, far, 0.94, hand === "round" ? chir * 0.26 : 0));
    } else if (kind < bowlCut + 58) {              // CROSSBAR (carved keeps it off-grain: diagonal)
      if (hand === "carved") strokes.push(line(ax - ox * 0.16, Math.max(0.03, jy - 0.14), ax + ox * 0.3, Math.min(0.95, jy + 0.14)));
      else strokes.push(line(ax - ox * 0.14, jy, far, jy, hand === "round" ? chir * 0.3 : hand === "pen" ? chir * 0.08 : 0));
    } else {                                       // SECOND STEM + connector (H N И)
      const s2 = sx + ox * 0.4;
      strokes.push(line(s2, 0.06, s2, 0.94, hand === "round" ? chir * 0.3 : 0));
      if (hand === "carved" || H("conn", i) % 2) strokes.push(line(spineX(0.1), 0.1, s2, 0.9, hand === "round" ? chir * 0.24 : 0));
      else strokes.push(line(ax, jy, s2, jy === 0.92 ? 0.5 : jy + 0.14, hand === "round" ? chir * 0.28 : 0));
    }
  }
  const cl = (v) => Math.max(0.02, Math.min(0.98, v));
  for (const x of strokes) x.pts = x.pts.map(pp => ({ x: cl(0.5 + (pp.x - 0.5) * st.aspect + (0.5 - pp.y) * st.slant), y: cl(pp.y) }));
  return strokes;
}

// letters live in a BODY BAND with rolled ascenders/descenders — the
// x-height rhythm that makes a written line read as one hand
function bandStrokes(script, key, salt) {
  if (script.type === "logo" || script.type === "syll") return rawStrokes(script, key, salt);   // square signs
  const raw = anatomyStrokes(script, key, salt, 1, salt > 8 ? 3 : 2);
  const z = hash32(script.styleSeed, "zone", key) % 100;
  // a headline script HANGS its letters from the bar (the shirorekha):
  // no ascenders — the body starts just under the line and may descend
  const [top, bot] = script.headline ? (z < 72 ? [0.14, 0.72] : [0.14, 0.95])
    : z < 68 ? [0.3, 0.76] : z < 84 ? [0.06, 0.76] : [0.3, 0.97];
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
// …but the READER's eye clusters coarser: a bowl that slid one joint down
// is a new sign to the fine signature and the same letter to a human. The
// gestalt signature quantizes to THIRDS of the box, so near-twins collide
// and get walked (or pointed) apart — the confusability pressure that
// actually shaped alphabets
const gestaltOf = (ss) => ss.map(s => (s.kind || "") + s.pts.map(p => Math.round(p.x * 3) + "," + Math.round(p.y * 3)).join(";")).sort().join("|");

// keys: segments by feature signature; syllables by their segment signatures
const ckey = (c) => "c" + c.p + "." + c.m + "." + c.l + "." + c.s;
const vkey = (v) => "v" + v.h + "." + v.b + "." + v.r;
const sylkey = (s) => [...s.on.map(ckey), ...s.nu.map(vkey), ...s.co.map(ckey)].join("-");
// domain radicals for phono-semantic compounds (one per concept domain)
const radKey = (d) => "rad:" + d;
// a featural letter merges what the FEATURES merge, exactly as Hangul does:
// ㄱ is k AND g (plain voicing, l ∈ {0,1}), ㄹ is l AND r (the liquids),
// dental sits with alveolar, uvular with velar, the gutturals share the
// throat-loop — the key mirrors featC's own iconography, so key ↔ glyph is
// injective by construction; aspiration/ejective/prenasal stay distinct
const fkey = (c) => {
  const p = c.p === 8 ? 1 : c.p === 5 ? 4 : c.p === 7 ? 6 : c.p;
  const m = c.m === 5 ? 4 : c.m;
  return "f" + p + "." + m + "." + (c.l >= 2 ? c.l : 0) + "." + c.s;
};

// ── featural letters: the glyph IS the feature bundle (the Hangul machine) ─
// Place draws the base shape (the real Hangul iconography is articulatory:
// ㅁ a closed mouth, ㄱ the tongue root at the velum, ㅇ the open throat);
// manner modifies it; ASPIRATION ADDS A STROKE to the plain letter (ㄱ→ㅋ),
// so related sounds are visibly related — the whole point of the class.
// An INVENTED script is drawn with the designer's ruler, not the scribe's
// wear: the hand's material vocabulary does not restyle these shapes (v1).
function featC(script, c) {
  const st = [];
  const L = (x1, y1, x2, y2) => st.push({ pts: [{ x: x1, y: y1 }, { x: x2, y: y2 }], bow: 0 });
  const p = Math.min(c.p, 8);
  if (p === 0) { L(0.2, 0.2, 0.8, 0.2); L(0.8, 0.2, 0.8, 0.8); L(0.8, 0.8, 0.2, 0.8); L(0.2, 0.8, 0.2, 0.2); }        // labial: the closed lips (ㅁ)
  else if (p === 1 || p === 8) { L(0.2, 0.2, 0.8, 0.2); L(0.2, 0.2, 0.2, 0.8); }                                       // coronal: tongue tip to the ridge (ㄴ flipped)
  else if (p === 2) { L(0.2, 0.2, 0.8, 0.2); L(0.2, 0.2, 0.2, 0.8); st.push({ pts: [{ x: 0.2, y: 0.8 }, { x: 0.55, y: 0.8 }], bow: -0.25 }); }   // retroflex: curled
  else if (p === 3) { L(0.5, 0.15, 0.15, 0.85); L(0.5, 0.15, 0.85, 0.85); }                                            // palatal: the raised body (∧)
  else if (p === 4 || p === 5) { L(0.2, 0.2, 0.8, 0.2); L(0.8, 0.2, 0.8, 0.8); }                                       // velar/uvular: root to the soft palate (ㄱ)
  else { st.push({ pts: [{ x: 0.5, y: 0.5 }], bow: 0, kind: "loop", r: 0.3 }); }                                       // guttural: the open throat (ㅇ)
  if (c.m === 2) L(0.15, 0.02, 0.85, 0.02);                                    // fricative: airflow line above
  if (c.m === 3) { L(0.15, 0.02, 0.85, 0.02); L(0.5, 0.02, 0.5, 0.18); }       // affricate: line + stop tick
  if (c.m === 1) L(0.35, 0.98, 0.65, 0.98);                                    // nasal: the open passage below
  if (c.m === 4 || c.m === 5) st.push({ pts: [{ x: 0.8, y: 0.8 }, { x: 0.55, y: 0.98 }], bow: 0.2 });   // liquid: a flick
  if (c.m === 6) st.push({ pts: [{ x: 0.2, y: 0.85 }, { x: 0.45, y: 0.98 }], bow: -0.2 });              // glide: the off-glide sweep
  if (c.l === 2) L(0.3, 0.1, 0.7, 0.1);                                        // aspirated: ONE MORE stroke (ㄱ→ㅋ)
  if (c.l === 3) st.push({ pts: [{ x: 0.9, y: 0.1 }], bow: 0, kind: "dot" });  // ejective: a point
  if (c.l === 4) L(0.05, 0.9, 0.05, 0.6);                                      // prenasal: a leading stub
  if (c.s === 1) L(0.92, 0.35, 0.92, 0.65);                                    // palatalized tick
  if (c.s === 2) st.push({ pts: [{ x: 0.92, y: 0.5 }], bow: 0, kind: "loop", r: 0.07 });   // labialized ring
  return st;
}
// vowels are BARS with feature ticks (the ㅏㅓㅗㅜ system): front vowels
// stand vertical, back vowels lie horizontal, height places the tick
function featV(script, v) {
  const st = [];
  const L = (x1, y1, x2, y2) => st.push({ pts: [{ x: x1, y: y1 }, { x: x2, y: y2 }], bow: 0 });
  if (v.b === 0) { L(0.5, 0.05, 0.5, 0.95); if (v.h === 0) L(0.5, 0.3, 0.85, 0.3); else if (v.h === 1) L(0.5, 0.5, 0.85, 0.5); else L(0.5, 0.7, 0.85, 0.7); }
  else if (v.b === 2) { L(0.05, 0.5, 0.95, 0.5); if (v.h === 0) L(0.3, 0.5, 0.3, 0.15); else if (v.h === 1) L(0.5, 0.5, 0.5, 0.15); else L(0.7, 0.5, 0.7, 0.85); }
  else { L(0.5, 0.05, 0.5, 0.95); if (v.h !== 1) L(0.15, v.h === 0 ? 0.3 : 0.7, 0.85, v.h === 0 ? 0.3 : 0.7); }
  if (v.r) st.push({ pts: [{ x: v.b === 2 ? 0.5 : 0.2, y: v.b === 2 ? 0.78 : 0.5 }], bow: 0, kind: "loop", r: 0.08 });
  return st;
}
// one syllable = one BLOCK: onset top-left, the vowel beside or below it by
// its own orientation, the coda underneath — Hangul's composition, derived
function featBlock(script, lang, syl) {
  const inv = compiledInv(lang);
  const on = syl.on.length ? syl.on : null;
  const v = syl.nu[0] || inv.vows[0];
  const vertical = v.b !== 2;                        // vertical bars stand beside, horizontal lie below
  const strokes = [];
  const onComp = (c) => featC(script, c);
  const codaN = syl.co.length;
  const topH = codaN ? 0.6 : 0.94;
  if (vertical) {
    // onset left, vowel bar right
    if (on) on.forEach((c, i) => strokes.push(...fitBox(onComp(c), 0.04 + i * 0.28 / Math.max(1, on.length - 1 || 1), 0.04, on.length > 1 ? 0.26 : 0.5, topH * 0.92)));
    else strokes.push(...fitBox([{ pts: [{ x: 0.5, y: 0.5 }], bow: 0, kind: "loop", r: 0.3 }], 0.04, 0.04, 0.5, topH * 0.92));   // null onset = the silent ㅇ
    const vw = 0.36 / syl.nu.length;
    syl.nu.forEach((vv, k) => strokes.push(...fitBox(featV(script, vv), 0.6 + k * vw, 0.04, vw, topH * 0.92)));
  } else {
    // onset top, vowel bar below it
    if (on) { const ow = 0.8 / on.length; on.forEach((c, i) => strokes.push(...fitBox(onComp(c), 0.1 + i * ow, 0.04, Math.min(ow, 0.8), topH * 0.5))); }
    else strokes.push(...fitBox([{ pts: [{ x: 0.5, y: 0.5 }], bow: 0, kind: "loop", r: 0.3 }], 0.1, 0.04, 0.8, topH * 0.5));
    const vh = 0.42 / syl.nu.length;
    syl.nu.forEach((vv, k) => strokes.push(...fitBox(featV(script, vv), 0.1, topH * (0.52 + k * vh), 0.8, topH * vh)));
  }
  const cw = codaN ? 0.7 / codaN : 0.7;
  syl.co.forEach((c, i) => strokes.push(...fitBox(onComp(c), 0.15 + i * cw, 0.66, Math.min(cw, 0.7), 0.3)));
  return strokes;
}

// ── the GLYPH MAP: one deduped sign table per script state ────────────────
// Both the inventory display AND writeForm read from here, so a sign that
// the distinctness walk moved (or dotted) looks the same in a word as in
// the table — they can never desync. Collision resolution is the script's
// own: a JOINED PEN hand keeps the letter skeleton and adds DOTS (i'jam —
// the Arabic solution, where ب ت ث share a rasm and differ by pointing);
// every other hand moves the strokes (the salt walk).
const GLYPHMAPS = new WeakMap();
const DOTS = [[1, "above"], [2, "above"], [3, "above"], [1, "below"], [2, "below"], [3, "below"]];
function withDots(strokes, n, pos) {
  const y = pos === "above" ? 0.08 : 0.97;
  const out = strokes.map(x => ({ ...x, pts: x.pts.map(pp => ({ ...pp })) }));
  for (let i = 0; i < n; i++) out.push({ pts: [{ x: 0.38 + i * 0.14, y }], bow: 0, kind: "dot" });
  return out;
}
function glyphMapOf(lang) {
  const s = scriptOf(lang);
  if (!s) return null;
  const stateKey = s.type + ":" + s.frozenAt + ":" + (lang.gen || 0) + ":" + lang.rules.length + ":" + (lang.xph ? lang.xph.length : 0) + ":" + s.styleSeed;
  const hit = GLYPHMAPS.get(lang);
  if (hit && hit.key === stateKey) return hit;
  const inv = compiledInv(lang);
  const cons = inv.cons, vows = inv.vows;
  const seen = new Set();
  const map = new Map();
  const entries = [];
  // marks (vowel diacritics, virama) draw from the free stroke grammar, not
  // the letter anatomy — a sliced spine is too stereotyped to keep a dozen
  // marks apart, and real diacritics are small free shapes anyway.
  // Segmental LETTERS dedup at both grains: the fine sig (rendering
  // identity) and the reader's gestalt — dense scripts (syllabaries,
  // logographies) are legitimately read by fine detail and skip the coarse
  // test, exactly as hanzi readers do
  const seenG = new Set();
  const gestaltOn = s.type === "abjad" || s.type === "abugida" || s.type === "alphabet";
  const collides = (st) => seen.has(sigOfStrokes(st)) || (gestaltOn && st.length >= 2 && seenG.has(gestaltOf(st)));
  const reg = (key, label, markPos = null, post = (x) => x, base = bandStrokes) => {
    if (map.has(key)) return map.get(key);           // one key, one sign
    let st = post(base(s, key, 0));
    if (collides(st) && s.hand === "pen" && s.join && s.type !== "featural") {
      // i'jam: keep the worn skeleton, point it apart
      for (const [n, pos] of DOTS) { const d = withDots(st, n, pos); if (!collides(d)) { st = d; break; } }
    }
    let salt = 0;
    while (collides(st) && salt < 24) st = post(base(s, key, ++salt));
    seen.add(sigOfStrokes(st));
    if (gestaltOn && st.length >= 2) seenG.add(gestaltOf(st));
    const e = { key, label, strokes: st, mark: markPos };
    map.set(key, e); entries.push(e);
    return e;
  };
  if (s.type === "featural") {
    // components are feature-derived (injective by construction after the
    // Hangul-style feature merges in fkey) — no walk needed; the label
    // lists every sound the component covers (ㄱ "k/g", ㄹ "l/r")
    const seenF = new Set();
    for (const c of cons) {
      const k = fkey(c);
      if (seenF.has(k)) continue;
      seenF.add(k);
      const mates = [...new Set(cons.filter(x => fkey(x) === k).map(x => romLabel(lang, x)))];
      const e = { key: k, label: mates.join("/"), strokes: featC(s, c) };
      map.set(k, e); entries.push(e);
    }
    for (const v of vows) {
      const k = vkey(v);
      if (seenF.has(k)) continue;
      seenF.add(k);
      const e = { key: k, label: romV(lang, v), strokes: featV(s, v) };
      map.set(k, e); entries.push(e);
    }
  } else if (s.type === "syll") {
    const sb = inv.syllab;
    const nucs = [...vows, ...(sb.diphs || []).map(d => d[0])];
    const done = new Set();
    for (const v of nucs) {
      for (const on of [[], ...sb.onsets, ...cons.map(c => [c])]) {
        const key = sylkey({ on, nu: [v], co: [] });
        if (done.has(key)) continue;
        done.add(key);
        reg(key, [...on.map(c => romLabel(lang, c)), romV(lang, v)].join(""));
      }
    }
    reg("mora:N", "-n (mora)");
  } else if (s.type !== "logo") {
    for (const c of cons) reg(ckey(c), romLabel(lang, c));
    if (s.type === "abugida") {
      const pos = markPosOf(s);
      const inh = vkey(inv.vows[0]);
      for (const v of vows) if (vkey(v) !== inh) reg("vd:" + vkey(v), romV(lang, v), pos, (st) => st.slice(0, 1), rawStrokes);
      reg("vc:carrier", "vowel carrier");
      if (s.virama) reg("virama", "virama", "below", (st) => st.slice(0, 1), rawStrokes);
    } else if (s.type === "alphabet") {
      for (const v of vows) reg(vkey(v), romV(lang, v));
    } else if (s.type === "abjad" && s.matres === "long") {
      reg("mater:back", "ū/ō (mater)"); reg("mater:front", "ī/ē (mater)"); reg("carrier", "initial vowel (carrier)");
    }
  }
  const out = { key: stateKey, map, entries };
  GLYPHMAPS.set(lang, out);
  return out;
}

/** The script's glyph table: [{ key, label, strokes, mark? }] — finite types
 *  enumerate their (frozen) inventory in a fixed order with a distinctness
 *  walk, so no two signs of one script collide. Logographies are an open
 *  set (one glyph per morpheme) and are sampled per word instead. */
export function glyphInventory(lang, cap = 64) {
  const s = scriptOf(lang);
  if (!s) return null;
  if (s.type === "logo") {
    const seen = new Set();
    const out = [];
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
  // every finite type reads the ONE shared map writeForm reads — no desync
  return glyphMapOf(lang).entries.slice(0, cap);
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
  if (!s || !form || !Array.isArray(form.syls)
    || form.syls.some(sy => !sy || !Array.isArray(sy.on) || !Array.isArray(sy.nu) || !Array.isArray(sy.co))) return null;
  const glyphs = [];
  // every sign comes from the ONE shared map (walked, dotted — as displayed);
  // open-set keys (logographic grammar signs) fall back to the stroke grammar
  const gm = s.type === "logo" ? null : glyphMapOf(lang);
  const G = (key) => {
    const e = gm && gm.map.get(key);
    return e ? { strokes: e.strokes } : { strokes: bandStrokes(s, key, 0) };
  };
  // orthography writes PHONEMES: a surface segment sound change carried out
  // of the inventory is written with its nearest letter, exactly as English
  // writes the flap with ⟨t⟩ — only the featural type (below) draws sounds
  // directly and needs no such collapse
  const inv0 = s.type === "logo" ? null : compiledInv(lang);
  const nearC = (c) => {
    let best = c, bd = 1e9;
    for (const x of inv0.cons) {
      const d = (x.p !== c.p) * 3 + (x.m !== c.m) * 3 + (x.l !== c.l) + (x.s !== c.s);
      if (d < bd) { bd = d; best = x; if (!d) break; }
    }
    return best;
  };
  const nearV = (v) => {
    let best = v, bd = 1e9;
    for (const x of inv0.vows) {
      const d = (x.h !== v.h) * 2 + (x.b !== v.b) * 2 + (x.r !== v.r);
      if (d < bd) { bd = d; best = x; if (!d) break; }
    }
    return best;
  };
  const pos = s.type === "abugida" ? markPosOf(s) : null;
  const plan = s.toneWritten ? phoneticPlan(lang, form) : null;
  const toneMark = (sylIdx, g = glyphs[glyphs.length - 1]) => {
    if (!plan || !g || !plan.syls[sylIdx] || plan.syls[sylIdx].tone == null) return;
    const m = rawStrokes(s, "tone:" + plan.syls[sylIdx].tone, 0).slice(0, 1);
    if (!g.mark) g.mark = { strokes: m, pos: "above" };
    else if (!g.mark2) g.mark2 = { strokes: m, pos: "above" };   // stacked over the vowel mark, as Thai does
  };
  // FROZEN-STEM SPELLING: a real tradition freezes the STEM and spells only
  // the inflection by ear — ⟨knight⟩ + ⟨-s⟩. When the concept is known, no
  // loan shadows it, and the current surface still carries the stem's
  // syllables intact (a suffixing or prefixing paradigm), the stem's
  // by-ear syllables are replaced with its frozen spelling; a stem the
  // inflection has reshaped (fusion, ablaut, reduplication) falls back to
  // by-ear whole, exactly as real irregulars get respelled.
  if (cid != null && s.type !== "logo" && s.frozenAt < lang.rules.length && !loanOf(lang, cid)) {
    const cur = nativeStemOf(lang, cid);
    const froz = writtenFormOf(lang, cid);
    if (cur && froz && form.syls.length >= cur.syls.length) {
      const n = cur.syls.length;
      const isFrozen = form.syls.length === froz.syls.length && froz.syls.every((sy, i) => sylkey(sy) === sylkey(form.syls[i]));
      if (!isFrozen) {
        if (cur.syls.every((sy, i) => sylkey(sy) === sylkey(form.syls[i]))) {
          form = { syls: [...froz.syls, ...form.syls.slice(n)] };                       // stem + suffixes
        } else if (cur.syls.every((sy, i) => sylkey(sy) === sylkey(form.syls[form.syls.length - n + i]))) {
          form = { syls: [...form.syls.slice(0, form.syls.length - n), ...froz.syls] };  // prefixes + stem
        }
      }
    }
  }
  if (s.type === "logo") {
    if (cid != null) glyphs.push({ strokes: logoGlyph(lang, cid).strokes });
    else glyphs.push(G("w:" + form.syls.map(sylkey).join("+")));
  } else if (s.type === "syll") {
    form.syls.forEach((syl) => {
      const on = syl.on.map(nearC);
      const nu0 = syl.nu.length ? [nearV(syl.nu[0])] : [];
      const k = sylkey({ on, nu: nu0, co: [] });
      if (!gm.map.has(k) && on.length > 1) {
        // a cluster the signary never licensed is broken into CV signs with
        // echo vowels — su-to-ra-i-ku, ko-no-so: the syllabary's own move
        for (const c of on) glyphs.push(G(sylkey({ on: [c], nu: nu0, co: [] })));
      } else glyphs.push(G(k));
      // a diphthong's off-glide takes the bare vowel sign (kana かい "kai")
      for (const v of syl.nu.slice(1)) glyphs.push(G(sylkey({ on: [], nu: [nearV(v)], co: [] })));
      for (const c of syl.co) {                                  // the three attested coda treatments
        if (s.codaMode === "moraic" && c.m === 1) glyphs.push(G("mora:N"));
        else if (s.codaMode === "echo") glyphs.push(G(sylkey({ on: [nearC(c)], nu: nu0, co: [] })));   // ko-no-so
        // drop: unwritten
      }
    });
  } else if (s.type === "featural") {
    // one syllable = one composed BLOCK (the Hangul geometry)
    form.syls.forEach((syl, i) => { glyphs.push({ strokes: featBlock(s, lang, syl) }); toneMark(i); });
  } else if (s.type === "abjad") {
    form.syls.forEach((syl, i) => {
      if (i === 0 && !syl.on.length && s.matres === "long") glyphs.push(G("carrier"));   // initial vowel needs a seat
      for (const c of syl.on) glyphs.push(G(ckey(nearC(c))));
      if (s.matres === "long" && syl.nu.some(v => v.lg)) glyphs.push(G(materKey(lang, syl.nu[0])));
      for (const c of syl.co) glyphs.push(G(ckey(nearC(c))));
      toneMark(i);
    });
  } else if (s.type === "abugida") {
    const inherent = vkey(inv0.vows[0]);
    const M = (key) => { const e = gm.map.get(key); return e ? e.strokes : rawStrokes(s, key, 0).slice(0, 1); };
    form.syls.forEach((syl, i) => {
      const base = syl.on.length ? G(ckey(nearC(syl.on[0]))) : G("vc:carrier");
      const v = syl.nu[0] ? nearV(syl.nu[0]) : null;
      if (v && vkey(v) !== inherent) base.mark = { strokes: M("vd:" + vkey(v)), pos };
      glyphs.push(base);
      for (const c of [...syl.on.slice(1), ...syl.co]) {
        const g = G(ckey(nearC(c)));
        if (s.virama) g.mark = { strokes: M("virama"), pos: "below" };   // the killer mark
        glyphs.push(g);
      }
      toneMark(i, base);                               // tone rides the syllable's base sign
    });
  } else {
    form.syls.forEach((syl, i) => {
      for (const c of syl.on) glyphs.push(G(ckey(nearC(c))));
      for (const v of syl.nu) glyphs.push(G(vkey(nearV(v))));
      for (const c of syl.co) glyphs.push(G(ckey(nearC(c))));
      toneMark(i);
    });
  }
  // the FINAL FORM: a joined hand ends its word with a sweep below the
  // baseline — the Arabic final-swash logic, one tail per word
  if (s.join && glyphs.length) {
    const last = glyphs[glyphs.length - 1];
    const dx = s.dir === "rtl" ? -1 : 1;
    last.strokes = [...last.strokes, { pts: [{ x: 0.5 + dx * 0.12, y: 0.78 }, { x: 0.5 + dx * 0.44, y: 0.97 }], bow: dx * 0.3, kind: "tail" }];
  }
  return glyphs;
}

/** Write one concept in the language's own script.
 *  → { glyphs: [{strokes, mark?}], translit, silent } | null — translit is
 *  the FROZEN spelling romanized (sans tone where the script leaves tone
 *  unwritten); silent flags a spelling the sound has since left behind. */
export function writeWord(lang, cid) {
  if (!Number.isInteger(cid) || cid < 0 || cid >= CONCEPTS.length) return null;
  const s = scriptOf(lang);
  if (!s) return null;
  const loan = loanOf(lang, cid);
  if (loan) {
    const said = s.toneWritten || !lang.prof.tone ? loan.w : stripTone(loan.w);
    if (s.type === "logo") {
      // the SIGN means the concept — a borrowed word only changes the
      // READING under it, the Japanese kun/on move
      return { glyphs: [{ strokes: logoGlyph(lang, cid).strokes }], translit: said, silent: false, loan: true };
    }
    if (!loan.f) return null;                        // legacy string-only record: nothing to spell
    // spelled as heard at borrowing, foreign segments adapted to the
    // native signary (the sushi-in-Latin-letters move) — and since loan
    // surfaces don't drift (v1), the spelling stays true to the sound
    return { glyphs: writeForm(lang, loan.f, null), translit: said, silent: false, loan: true };
  }
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
  if (!Number.isInteger(n) || n < 1) return null;
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

// ── names in the native script: the scribe SOUNDS THE NAME OUT ────────────
// Names are string-assembled (erosion, welded suffixes, trims), so they
// carry no single internal form. A scribe never needed one: they hear the
// name and spell it through their own conventions. formFromSurface inverts
// the language's own romanization — a longest-match parse over the
// inventory's letter spellings — then syllabifies C*V(C*) greedily. The
// round trip is near-lossless because the name WAS generated by these
// conventions; a stray letter outside them is still sounded out (the
// AZ_FALLBACK reading below) rather than dropped.
const PARSERS = new WeakMap();
function surfaceParser(lang) {
  const key = (lang.gen || 0) * 101 + (lang.xph ? lang.xph.length : 0);
  const hit = PARSERS.get(lang);
  if (hit && hit.key === key) return hit;
  const inv = compiledInv(lang);
  const toks = [];
  // tokens and input are mark-stripped IDENTICALLY — a review measured 20%
  // of names losing consonants because č in the name couldn't find the
  // unstripped č-token
  for (const c of inv.cons) { const r = stripTone(romLabel(lang, c)); if (r) toks.push([r.toLowerCase(), { c }]); }
  for (const v of inv.vows) { const r = stripTone(romV(lang, v)); if (r) toks.push([r.toLowerCase(), { v }]); }
  toks.sort((a, b) => b[0].length - a[0].length);      // longest match first
  const out = { key, toks };
  PARSERS.set(lang, out);
  return out;
}
// a letter matching NO native token (name erosion and suffix welding emit
// spellings outside the inventory's own conventions) is still HEARD: the
// scribe gives it a plain Latin-letter reading, and writeForm's
// nearest-letter normalization seats it in the native signary
const AZ_FALLBACK = {
  b: { c: { p: 0, m: 0, l: 1, s: 0 } }, p: { c: { p: 0, m: 0, l: 0, s: 0 } }, m: { c: { p: 0, m: 1, l: 1, s: 0 } },
  f: { c: { p: 0, m: 2, l: 0, s: 0 } }, v: { c: { p: 0, m: 2, l: 1, s: 0 } }, w: { c: { p: 0, m: 6, l: 1, s: 0 } },
  t: { c: { p: 1, m: 0, l: 0, s: 0 } }, d: { c: { p: 1, m: 0, l: 1, s: 0 } }, n: { c: { p: 1, m: 1, l: 1, s: 0 } },
  s: { c: { p: 1, m: 2, l: 0, s: 0 } }, z: { c: { p: 1, m: 2, l: 1, s: 0 } }, l: { c: { p: 1, m: 4, l: 1, s: 0 } },
  r: { c: { p: 1, m: 5, l: 1, s: 0 } }, c: { c: { p: 3, m: 3, l: 0, s: 0 } }, j: { c: { p: 3, m: 6, l: 1, s: 0 } },
  y: { c: { p: 3, m: 6, l: 1, s: 0 } }, k: { c: { p: 4, m: 0, l: 0, s: 0 } }, g: { c: { p: 4, m: 0, l: 1, s: 0 } },
  q: { c: { p: 5, m: 0, l: 0, s: 0 } }, x: { c: { p: 4, m: 2, l: 0, s: 0 } }, h: { c: { p: 7, m: 2, l: 0, s: 0 } },
  a: { v: { h: 2, b: 1, r: 0 } }, e: { v: { h: 1, b: 0, r: 0 } }, i: { v: { h: 0, b: 0, r: 0 } },
  o: { v: { h: 1, b: 2, r: 1 } }, u: { v: { h: 0, b: 2, r: 1 } },
};
export function formFromSurface(lang, str) {
  const { toks } = surfaceParser(lang);
  const s = stripTone(String(str)).toLowerCase().replace(/[^\p{L}']/gu, "");
  const segs = [];
  for (let i = 0; i < s.length;) {
    const hit = toks.find(([r]) => s.startsWith(r, i));
    if (hit) { segs.push(hit[1]); i += hit[0].length; }
    else {
      const fb = AZ_FALLBACK[s[i]] || AZ_FALLBACK[s[i].normalize("NFD")[0]];
      if (fb) segs.push(fb);                           // sounded out, seated downstream
      i++;
    }
  }
  // syllabify greedily: onset consonants attach forward to the next vowel;
  // trailing consonants close the final syllable
  const syls = [];
  let on = [];
  for (const seg of segs) {
    if (seg.c) { on.push(seg.c); continue; }
    syls.push({ on, nu: [seg.v], co: [] });
    on = [];
  }
  if (on.length && syls.length) syls[syls.length - 1].co.push(...on);
  else if (on.length) syls.push({ on, nu: [], co: [] });
  return syls.length ? { syls: syls.map(sy => JSON.parse(JSON.stringify(sy))) } : null;
}
/** A proper name written in the language's own script — spelled as heard,
 *  the way scribes have always taken names down. → [{strokes, mark?}] */
export function writeName(lang, name) {
  const s = scriptOf(lang);
  if (!s || !name) return null;
  const f = formFromSurface(lang, name);
  return f ? writeForm(lang, f, null) : null;
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

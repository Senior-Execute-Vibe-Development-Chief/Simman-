// ── Writing systems: emergent script type, orthographic lag, glyphs ───────
//
// The L5 thread (docs/language-comprehensive-spec.md §E/§F), Lab-side: a
// script is DERIVED from the language record — nothing persists, the sim
// stays unwired (script birth from literacy tech and spread along faith/
// trade channels is the sim-side plan, parked).
//
// Three mechanisms, none of them fiat:
//
//  · TYPE walks the real transmission ladder. A primary tradition is
//    LOGOGRAPHIC (accounting-token origin — every attested primary
//    invention). At re-learning junctures — points of accumulated written
//    history, never wall-clock — the script simplifies ONE structural step
//    (logo → syllabary/abjad → alphabet/abugida), and only when the simpler
//    type FITS this language better: fit weighs the glyph budget a learner
//    must carry against what the type fails to write. An isolating, tonal,
//    short-morpheme language keeps logography (phonography collapses its
//    homophones — the Chinese corner, emergent); a small licensed syllable
//    space makes a syllabary cheap (kana); a templatic morphology writes
//    consonant skeletons and lets the grammar supply vowels (abjad); heavy
//    clusters force segments (alphabet). No script type is ever assigned
//    by name.
//  · ORTHOGRAPHIC LAG: spelling freezes when the tradition consolidates on
//    its current type and stays frozen while speech keeps drifting — the
//    written form replays only rules[0..frozenAt). Old stable traditions
//    accumulate deep lag (the -ough machine); a re-learning event IS the
//    spelling reform that resets it. Silent letters are emergent: drift a
//    language and watch its spelling fossilize.
//  · GLYPHS from a seeded stroke grammar: per-script style (curviness,
//    slant, chaining, stroke budget — logographs dense, letters light),
//    deterministic per (styleSeed, key). A derived concept's logograph
//    COMPOUNDS its parts' glyphs — the engine's own etymologies become
//    semantic radicals (ford = water + river), for free.
//
// All exports are pure and cached; every roll reads its own famSeed stream
// ("scr:*"), so nothing upstream can shift. References pin their scripts as
// scenario data (prof.script), like every other pinned dial.

import { hash32 } from "./peopleSim/rng.js";
import { compiledInv, nativeStemOf, etymologyOf, wordOf } from "./language.js";
import { renderWord, romanizeC, romanizeV } from "./languagePhonology.js";
import { CONCEPTS } from "./languageLexicon.js";

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

const SCRIPTS = new WeakMap();

/** The language's script, or null while the tradition is preliterate.
 *  → { type, dir, born, adoptedAt, frozenAt, lag, styleSeed, glyphBudget } */
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
    script = { type: p.type, dir: p.dir || "ltr", born: 0, adoptedAt: 0, frozenAt: 0 };
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
      // type change was the last reform this tradition had
      const frozenAt = Math.min(len, adoptedAt + hash32(fam, "scr:frz") % 2);
      const dir = (() => { const r = h01(fam, "scr:dir"); return r < 0.65 ? "ltr" : r < 0.85 ? "rtl" : "ttb"; })();
      script = { type, dir, born, adoptedAt, frozenAt };
    }
  }
  if (script) {
    script.lag = len - script.frozenAt;
    script.styleSeed = hash32(fam, "scr:style", script.adoptedAt) >>> 0;
    const inv = compiledInv(lang);
    script.glyphBudget = script.type === "logo" ? CONCEPTS.length
      : script.type === "syll" ? sylSpaceOf(lang)
      : script.type === "abjad" ? inv.cons.length
      : script.type === "abugida" ? inv.cons.length + inv.vows.length
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
/** The frozen spelling, romanized — ⟨knight⟩ beside today's [naɪt]. */
export function writtenWordOf(lang, cid) {
  const f = writtenFormOf(lang, cid);
  return f ? renderWord(f, lang.prof) : null;
}

// ── glyphs: a seeded stroke grammar ───────────────────────────────────────
// A glyph is 1–6 strokes over a 3×4 grid; the per-script style decides
// curviness, slant, aspect, stroke chaining, and the stroke budget
// (logographs dense, letters light). Deterministic per (styleSeed, key);
// coordinates normalized 0..1 — the Lab draws SVG from them.
const GX = [0.12, 0.5, 0.88], GY = [0.08, 0.38, 0.66, 0.94];
function styleOf(script) {
  const s = script.styleSeed;
  return {
    curve: h01(s, "curve"),
    slant: (h01(s, "slant") - 0.5) * 0.3,
    aspect: 0.75 + h01(s, "aspect") * 0.4,
    chain: h01(s, "chain") < 0.45,
    nMin: script.type === "logo" ? 3 : script.type === "syll" ? 2 : 1,
    nMax: script.type === "logo" ? 6 : script.type === "syll" ? 3 : 3,
  };
}
function rawStrokes(script, key, salt) {
  const st = styleOf(script);
  const H = (...a) => hash32(script.styleSeed, "g:" + key, salt, ...a);
  const P = (i) => ({ x: GX[i % 3], y: GY[(i / 3 | 0) % 4] });
  const n = st.nMin + H("n") % (st.nMax - st.nMin + 1);
  const strokes = [];
  let prev = null;
  for (let i = 0; i < n; i++) {
    const a = st.chain && prev && H("ch", i) % 2 ? prev : P(H("a", i) % 12);
    let bi = H("b", i) % 12;
    let b = P(bi);
    if (b.x === a.x && b.y === a.y) b = P((bi + 5) % 12);
    const pts = [a, b];
    if (H("leg", i) % 100 < 35) {                      // a third leg
      let c = P(H("c", i) % 12);
      if (c.x === b.x && c.y === b.y) c = P((H("c", i) + 7) % 12);
      pts.push(c);
    }
    // curvature: perpendicular bow per segment, scaled by the style
    const bow = st.curve * (0.08 + 0.22 * h01(script.styleSeed, "bw", key, salt, i));
    strokes.push({ pts, bow: H("cv", i) % 2 ? bow : -bow });
    prev = pts[pts.length - 1];
  }
  // slant + aspect, clamped to the box
  const cl = (v) => Math.max(0.02, Math.min(0.98, v));
  for (const s of strokes) s.pts = s.pts.map(p => ({ x: cl(0.5 + (p.x - 0.5) * st.aspect + (0.5 - p.y) * st.slant), y: p.y }));
  return strokes;
}
// distinctness lives in the POINTS: two glyphs whose only difference is a
// bow amount look like the same letter in a different mood — never enough
const sigOfStrokes = (ss) => ss.map(s => s.pts.map(p => (p.x * 20 | 0) + "," + (p.y * 20 | 0)).join(";")).join("|");

// keys: segments by feature signature; syllables by their segment signatures
const ckey = (c) => "c" + c.p + "." + c.m + "." + c.l + "." + c.s;
const vkey = (v) => "v" + v.h + "." + v.b + "." + v.r;
const sylkey = (s) => [...s.on.map(ckey), ...s.nu.map(vkey), ...s.co.map(ckey)].join("-");

/** The script's glyph table: [{ key, label, strokes, mark? }] — finite types
 *  enumerate their (frozen) inventory in a fixed order with a distinctness
 *  walk, so no two signs of one script collide. Logographies are an open
 *  set (one glyph per morpheme) and are sampled per word instead. */
export function glyphInventory(lang, cap = 64) {
  const s = scriptOf(lang);
  if (!s) return null;
  const seen = new Set();
  // `post` reshapes a candidate BEFORE the distinctness check (a vowel mark
  // is one stroke — deduping the unsliced form would let sliced twins slip)
  const mk = (key, label, markPos = null, post = (x) => x) => {
    let salt = 0, st = post(rawStrokes(s, key, salt));
    while (seen.has(sigOfStrokes(st)) && salt < 8) st = post(rawStrokes(s, key, ++salt));
    seen.add(sigOfStrokes(st));
    return { key, label, strokes: st, mark: markPos };
  };
  const inv = compiledInv(lang);
  const out = [];
  if (s.type === "logo") {
    // sample morpheme glyphs (open set): first N distinct signs by id
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
    // the licensed syllable space, sampled: onsets × first vowels
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
  // segmental scripts: consonants (+ vowels / vowel marks)
  for (const c of inv.cons) { out.push(mk(ckey(c), romLabel(lang, c))); if (out.length >= cap) return out; }
  if (s.type === "abugida") {
    // vowel DIACRITICS: 1-stroke marks; the commonest vowel is inherent
    // (unmarked) — the inventory is frequency-ordered, so vows[0] is it
    const pos = h01(s.styleSeed, "mkpos") < 0.5 ? "above" : h01(s.styleSeed, "mkpos") < 0.8 ? "below" : "after";
    inv.vows.slice(1).forEach((v) => {
      if (out.length >= cap) return;
      out.push(mk("vd:" + vkey(v), romV(lang, v), pos, (st) => st.slice(0, 1)));   // a mark is one stroke
    });
  } else if (s.type === "alphabet") {
    for (const v of inv.vows) { if (out.length >= cap) break; out.push(mk(vkey(v), romV(lang, v))); }
  }
  return out;
}
// romanized value labels for the glyph table (what the sign "says")
const romLabel = (lang, c) => romanizeC(c, lang.prof.romTaste, lang.prof.rom, lang.prof.orthoStyle);
const romV = (lang, v) => romanizeV(v, lang.prof.rom);

// a logograph: one dense glyph per morpheme — and a DERIVED morpheme
// compounds its parts' glyphs side by side (mod as the left radical), so
// the engine's own etymologies surface as semantic radicals
function logoGlyph(lang, cid) {
  const s = scriptOf(lang);
  const ety = etymologyOf(lang, cid);
  if (ety) {
    const L = rawStrokes(s, "m" + ety.mod, 0), R = rawStrokes(s, "m" + ety.head, 0);
    const sq = (ss, sx, ox) => ss.map(x => ({ pts: x.pts.map(p => ({ x: ox + p.x * sx, y: 0.15 + p.y * 0.7 })), bow: x.bow }));
    return { strokes: [...sq(L, 0.34, 0.06), ...sq(R, 0.5, 0.46)], compound: [ety.mod, ety.head] };
  }
  return { strokes: rawStrokes(s, "m" + cid, 0), compound: null };
}

/** Write one concept in the language's own script.
 *  → { glyphs: [{strokes, mark?, label?}], translit, silent } | null
 *  translit is the FROZEN spelling romanized; silent says it no longer
 *  matches how the word is said today (the -ough flag). */
export function writeWord(lang, cid) {
  const s = scriptOf(lang);
  if (!s) return null;
  if ((lang.loans || []).some(x => x.c === cid)) return null;   // a loan has no native tradition (v1)
  const frozen = writtenFormOf(lang, cid);
  const translit = renderWord(frozen, lang.prof);
  const said = renderWord(nativeStemOf(lang, cid), lang.prof);
  const glyphs = [];
  const G = (key) => ({ strokes: rawStrokes(s, key, 0) });
  if (s.type === "logo") {
    const g = logoGlyph(lang, cid);
    glyphs.push({ strokes: g.strokes });
  } else if (s.type === "syll") {
    for (const syl of frozen.syls) glyphs.push(G(sylkey(syl)));
  } else if (s.type === "abjad") {
    for (const syl of frozen.syls) for (const c of [...syl.on, ...syl.co]) glyphs.push(G(ckey(c)));
  } else if (s.type === "abugida") {
    const pos = h01(s.styleSeed, "mkpos") < 0.5 ? "above" : h01(s.styleSeed, "mkpos") < 0.8 ? "below" : "after";
    const inv = compiledInv(lang);
    const inherent = vkey(inv.vows[0]);
    for (const syl of frozen.syls) {
      const base = syl.on.length ? G(ckey(syl.on[0])) : G("vc:carrier");
      const v = syl.nu[0];
      if (v && vkey(v) !== inherent) {
        const m = rawStrokes(s, "vd:" + vkey(v), 0).slice(0, 1);
        base.mark = { strokes: m, pos };
      }
      glyphs.push(base);
      for (const c of [...syl.on.slice(1), ...syl.co]) glyphs.push(G(ckey(c)));
    }
  } else {
    for (const syl of frozen.syls) {
      for (const c of syl.on) glyphs.push(G(ckey(c)));
      for (const v of syl.nu) glyphs.push(G(vkey(v)));
      for (const c of syl.co) glyphs.push(G(ckey(c)));
    }
  }
  return { glyphs, translit, silent: translit !== said };
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
    const said = wordOf(lang, cid);
    if (written && written !== said && !seen.has(written + "|" + said)) {
      seen.add(written + "|" + said);
      out.push({ cid, written, said });
    }
  }
  return out;
}

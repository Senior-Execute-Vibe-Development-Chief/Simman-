// ── The grammar layer: syntax dials, closed-class words, inflection ───────
//
// The M-phases of docs/language-comprehensive-spec.md. Everything here is
// DERIVED: a language record still persists only seeds + history. The
// grammar profile is a dial bundle on prof (prof.gram — plain JSON, rolled
// once per family from named substreams, pinned by every reference profile),
// and every FORM — pronouns, numerals, paradigms — is computed on demand and
// cached in a WeakMap keyed by the record, invalidated exactly like the
// lexicon cache, so save→load rebuilds byte-identical grammar by
// construction. Two design rules carry over from the word layer:
//
//   · CO-VARIATION over independent rolls: syntax dials follow Greenberg's
//     correlations at real frequencies (OV ⇒ postpositions, OV ⇒ suffixing,
//     postpositions ⇒ genitive-first, V-initial ⇒ prepositions…), so rolled
//     grammars sit in attested corners of the space, never the mush middle.
//   · GRAMMATICALIZATION over invention: function words (and, in M2, the
//     affixes themselves) are worn-down forms of the language's OWN words —
//     adpositions from body parts (belly→in, foot→under), plural pronouns
//     from 'many', duals from 'two', inclusive 'we' welded from I+thou —
//     so sister languages carry COGNATE closed classes that then diverge
//     by regular sound law, like real families do.

import { mkRng, hash32 } from "./peopleSim/rng.js";
import { synthWord, renderWord, copyWord } from "./languagePhonology.js";
import { applyRules, legalizeWord } from "./languageChange.js";
import { compiledInv, nativeStemOf, rootFormOf, glossOf } from "./language.js";
import {
  MANY, ALL, TWO, HAND, MAN, EARTH, DAY, ROAD,
  BELLY, HOUSE, HEAD, BACK, FOOT, GO, FACE, MOUTH, KINC,
  ONE, THREE, FOUR, FIVE, SIX, SEVEN, EIGHT, NINE, TEN, HUNDRED,
} from "./languageLexicon.js";

const h01 = (...a) => hash32(...a) / 4294967296;

// ── The grammar dial bundle (M3: Greenberg-correlated rolls) ──────────────
// Rolled once per FAMILY (famSeed) so daughters inherit their parent's
// grammar wholesale and diverge only through recorded events (M5). Every
// dial draws from its OWN named hash — adding a dial later never perturbs
// the ones already rolled (same discipline as the phonology profile).
export function rollGrammar(famSeed, prof) {
  const H = (k) => h01(famSeed, "g:" + k);
  const pickW = (k, pairs) => {
    let r = H(k);
    for (const [v, p] of pairs) { r -= p; if (r < 0) return v; }
    return pairs[pairs.length - 1][0];
  };
  const m = prof.morph;
  // basic word order at real cross-linguistic frequencies (WALS 81A shape)
  const wo = pickW("wo", [["sov", 0.44], ["svo", 0.41], ["vso", 0.09], ["vos", 0.04], ["ovs", 0.02]]);
  const ov = wo === "sov" || wo === "ovs";
  const v1 = wo === "vso" || wo === "vos";
  // Greenberg U3/U4: V-initial ⇒ prepositions; OV ⇒ postpositions
  const adpSide = ov ? (H("adp") < 0.93 ? "post" : "pre")
    : v1 ? (H("adp") < 0.97 ? "pre" : "post")
    : (H("adp") < 0.82 ? "pre" : "post");
  // U2a: postpositional languages put the genitive first (and vice versa)
  const genN = adpSide === "post" ? H("gen") < 0.87 : H("gen") < 0.3;
  // adjective order — NAdj is the world majority outside OV Eurasia
  const adjN = ov ? H("adj") < 0.5 : v1 ? H("adj") < 0.2 : H("adj") < 0.45;
  // U27-flavour: OV ⇒ suffixing; prefixing is the global minority everywhere
  const affixSide = ov ? (H("afx") < 0.9 ? "suf" : "pre") : (H("afx") < 0.68 ? "suf" : "pre");
  // case richness: U41-flavour (SOV carries case; rigid SVO sheds it) scaled
  // by the morphotype — isolating tongues do case with word order + adpositions
  let caseN = 0;
  if (m === "iso") caseN = H("case") < 0.85 ? 0 : 2;
  else if (m === "agg") caseN = (ov ? 4 : 2) + Math.floor(h01(famSeed, "g:casen") * (ov ? 9 : 6));
  else if (m === "tmpl") caseN = pickW("case", [[0, 0.3], [2, 0.35], [3, 0.35]]);
  else caseN = pickW("case", ov ? [[2, 0.2], [4, 0.2], [5, 0.2], [6, 0.25], [7, 0.15]]
    : [[0, 0.3], [1, 0.1], [2, 0.15], [3, 0.15], [4, 0.12], [5, 0.1], [6, 0.08]]);
  // alignment: ergative systems are a real minority of case languages
  const align = caseN >= 2 && H("align") < 0.27 ? "erg" : "acc";
  // negation position: preverbal is the world default; verb-final languages
  // license clause-final negators
  const negPos = ov ? pickW("neg", [["pre", 0.45], ["final", 0.4], ["post", 0.15]])
    : pickW("neg", [["pre", 0.7], ["post", 0.2], ["final", 0.1]]);
  // polar questions: final particle suits OV (Japanese ka), initial suits VO
  const qPart = ov ? pickW("q", [["final", 0.6], ["none", 0.35], ["init", 0.05]])
    : pickW("q", [["none", 0.5], ["final", 0.28], ["init", 0.22]]);
  // U12-flavour: V-initial fronts its question words; OV keeps them in situ
  const whFront = ov ? H("wh") < 0.3 : v1 ? H("wh") < 0.85 : H("wh") < 0.7;
  // gender/noun classes: correlated with the gendered-names habit; the
  // many-class (Bantu-style) corner rides the agglutinative pole
  const genders = prof.gendered && m !== "iso" ? (H("gnd") < 0.55 ? 2 : 3)
    : m === "agg" && H("gnd") < 0.12 ? 4 + Math.floor(h01(famSeed, "g:gndn") * 6)
    : m !== "iso" && H("gnd2") < 0.08 ? 2 : 0;
  const tenses = m === "iso" ? pickW("tns", [[1, 0.75], [2, 0.25]])
    : pickW("tns", [[1, 0.12], [2, 0.43], [3, 0.45]]);
  const agree = m === "iso" ? (H("agr") < 0.9 ? "none" : "subj")
    : H("agr") < 0.28 ? "none"
    : H("agr2") < (m === "agg" ? 0.3 : 0.12) ? "both" : "subj";
  return {
    wo, adpSide, genN, adjN, affixSide, caseN, align, negPos, qPart, whFront,
    genders, tenses, agree,
    aspect: tenses === 1 ? true : H("asp") < 0.45,   // tenseless ⇒ aspect carries time
    pluralMark: m === "iso" ? H("pl") < 0.3 : H("pl") < 0.9,
    dual: H("du") < 0.15,
    clusiv: H("cl") < 0.35,                          // inclusive/exclusive 'we'
    gender3: (genders ? H("g3") < 0.75 : H("g3") < 0.15),
    defArt: H("def") < 0.38,                         // the demonstrative-worn article
    indefArt: H("def") < 0.38 && H("idef") < 0.5,    // 'one' worn to 'a'
    proDrop: (m === "iso" ? H("agr") >= 0.9 : H("agr") >= 0.28) ? H("pd") < 0.7 : H("pd") < 0.3,
    numBase: pickW("nb", [[10, 0.65], [20, 0.2], [5, 0.15]]),
    numOrder: H("no") < 0.88,                        // big-first (twenty-three) vs unit-first
    dem3: H("d3") < 0.3,                             // 2-way vs 3-way demonstratives
    negAffix: m === "agg" && H("na") < 0.35,         // Turkish-style -me- negation
    pronPl: (m === "iso" || m === "agg") ? (H("ppl") < 0.75 ? "affix" : "root")
      : (H("ppl") < 0.25 ? "affix" : "root"),        // wǒ-men vs me/we suppletion
    declN: m === "fus" ? 2 + Math.floor(h01(famSeed, "g:decl") * 3)
      : m === "tmpl" ? 2 + Math.floor(h01(famSeed, "g:decl") * 2) : 1,
    conjN: m === "fus" ? 2 + Math.floor(h01(famSeed, "g:conj") * 2)
      : m === "tmpl" ? 2 + Math.floor(h01(famSeed, "g:conj") * 2) : 1,
  };
}

/** The language's grammar dials (lazy: old records roll them on first use —
 *  keyed off famSeed, so an upgraded parent and daughter agree, and the roll
 *  matches what fresh creation would have cloned down the family). */
export function gramOf(lang) {
  const p = lang.prof;
  if (!p.gram) p.gram = rollGrammar(lang.famSeed ?? lang.seed, p);
  return p.gram;
}

// ── derived-state cache (WeakMap keyed by record, like compile()) ─────────
const GRAM = new WeakMap();
function gc(lang) {
  const key = lang.gen * 1000003 + lang.loans.length * 101 + (lang.xph ? lang.xph.length : 0);
  let c = GRAM.get(lang);
  if (c && c.key === key) return c;
  c = { key, closed: null, atoms: null, cells: new Map(), specs: new Map() };
  GRAM.set(lang, c);
  return c;
}

// ── small form surgery ────────────────────────────────────────────────────
const GLIDE_Y = { p: 3, m: 6, l: 1, s: 0 }, GLIDE_W = { p: 0, m: 6, l: 1, s: 0 };
const cloneSyl = (s) => ({ on: s.on.map(c => ({ ...c })), nu: s.nu.map(v => ({ ...v })), co: s.co.map(c => ({ ...c })) });

// ancient function words are LIGHT: no onset clusters, no long nuclei
function lighten(w) {
  for (const s of w.syls) { if (s.on.length > 1) s.on = s.on.slice(0, 1); for (const v of s.nu) v.lg = 0; }
  return w;
}

/** Wear a word down to its one most salient syllable (the affix/clitic
 *  shape). Final-stress languages keep the last syllable, the rest keep the
 *  first — so WHICH piece survives is itself a dial the language already has.
 *  Glottal-stop onsets don't survive cliticization (they're romanization
 *  noise in a bound form). */
function wearSyl(prof, w) {
  const s = prof.stress === "final" && w.syls.length > 1 ? w.syls[w.syls.length - 1] : w.syls[0];
  const on = s.on.slice(0, 1).filter(c => !(c.p === 7 && c.m === 0)).map(c => ({ ...c }));
  return {
    on,
    nu: s.nu.slice(0, 1).map(v => ({ ...v, lg: 0 })),
    co: s.co.length === 1 ? s.co.map(c => ({ ...c })) : [],
  };
}

/** Join syllable runs with the same seam repairs words get: glide before a
 *  bare-vowel start, cluster trim after a coda. */
function joinSyls(aSyls, bSyls) {
  const syls = [...aSyls.map(cloneSyl), ...bSyls.map(cloneSyl)];
  const A = syls[aSyls.length - 1], B = syls[aSyls.length];
  if (A && B) {
    if (A.nu.length && !A.co.length && !B.on.length && B.nu.length)
      B.on = [B.nu[0].b === 0 ? { ...GLIDE_Y } : { ...GLIDE_W }];
    if (A.co.length && B.on.length >= 2) B.on = B.on.slice(0, 1);
  }
  return { syls };
}

// pre-rule synthesis for a closed-class word: its OWN named substream off
// the family seed, replayed through this language's whole rule log — the
// mi/me/moi machine (sisters share the root, diverge by law)
function synthClosed(lang, inv, stream, nSyl = 1) {
  const rng = mkRng(hash32(lang.famSeed ?? lang.seed, "cls", stream));
  const w = lighten(synthWord(rng, lang.prof, inv, nSyl));
  // function words are light, not INVISIBLE: mostly CV, only rarely bare V
  const s0 = w.syls[0];
  if (!s0.on.length && rng() < 0.8) {
    const c = inv.cons[Math.floor(rng() * Math.min(6, inv.cons.length))];
    if (c && !(c.p === 7 && c.m === 0)) s0.on = [{ ...c }];
  }
  return w;
}

// deterministic re-tint of a form's first nucleus (dedupe + sound symbolism);
// plain unrounded qualities preferred — a demonstrative is i/a, not ü
function retint(w, v) { if (w.syls[0] && w.syls[0].nu.length) w.syls[0].nu = [{ ...v, n: 0, lg: 0 }]; return w; }
const vowNear = (vows) => vows.find(v => v.h === 0 && v.b === 0 && !v.r) || vows.find(v => v.h === 0 && !v.r) || vows.find(v => v.h === 0) || vows[0];
const vowFar = (vows) => vows.find(v => v.h === 2 && !v.r) || vows.find(v => v.h === 2) || vows.find(v => v.b === 2) || vows[vows.length - 1];
const vowMid = (vows) => vows.find(v => v.h === 1 && !v.r) || vows.find(v => v.h === 1) || vows[0];

// render a closed form; affixes/particles are never dressed in name-grade
// orthography, but renderWord's language-wide conventions still apply
const rform = (lang, w) => renderWord(w, lang.prof);

// keep a set of forms mutually distinct: cycle the nucleus through the vowel
// inventory until the collision clears (deterministic walk, tiny and rare)
function dedupe(lang, inv, forms) {
  const seen = new Set();
  for (const f of forms) {
    for (let t = 0; seen.has(f.w) && t < inv.vows.length; t++) {
      retint(f.form, inv.vows[t]);
      legalizeWord(f.form);
      f.w = rform(lang, f.form);
    }
    seen.add(f.w);
  }
  return forms;
}

// ── M1: the closed classes ────────────────────────────────────────────────

const ADP_SPECS = [
  { m: "in", pool: [[BELLY, 0.45], [HOUSE, 0.3], [null, 0.25]] },
  { m: "on", pool: [[HEAD, 0.4], [BACK, 0.3], [null, 0.3]] },
  { m: "under", pool: [[FOOT, 0.4], [EARTH, 0.25], [null, 0.35]] },
  { m: "to", pool: [[GO, 0.35], [FACE, 0.3], [null, 0.35]] },
  { m: "from", pool: [[MOUTH, 0.2], [BACK, 0.25], [null, 0.55]] },
  { m: "with", pool: [[HAND, 0.45], [null, 0.55]] },
  { m: "at", pool: [[EARTH, 0.3], [null, 0.7]] },
  { m: "of", pool: [[KINC, 0.3], [HOUSE, 0.25], [null, 0.45]] },
];

/** Every closed-class form of the language: pronouns (with the language's own
 *  person/number distinctions), demonstratives, negation, the question-word
 *  series, conjunctions, adpositions-with-etymologies. All derived, cached. */
export function closedOf(lang) {
  const c = gc(lang);
  if (c.closed) return c.closed;
  const g = gramOf(lang);
  const inv = compiledInv(lang);
  const prof = lang.prof;
  const fam = lang.famSeed ?? lang.seed;
  const R = (w) => applyRules(lang.rules, w);

  // ── pronouns ──
  // persons are independent ancient roots; plurals are either transparent
  // (root + worn 'many' — the wǒ-men strategy) or suppletive roots (me/we);
  // duals wear the language's own 'two'; the inclusive is often I+thou welded
  const root1 = synthClosed(lang, inv, "pron1");
  const root2 = synthClosed(lang, inv, "pron2");
  const root3 = synthClosed(lang, inv, "pron3");
  const plSrc = h01(fam, "plsrc") < 0.6 ? MANY : ALL;
  const plMark = wearSyl(prof, lighten(rootFormOf(lang, plSrc).w));
  const duMark = wearSyl(prof, lighten(rootFormOf(lang, TWO).w));
  const plOf = (root, key) => g.pronPl === "affix"
    ? joinSyls(root.syls, [plMark])
    : synthClosed(lang, inv, key);
  const duOf = (root) => joinSyls(root.syls, [duMark]);
  const prons = [];
  const addP = (k, gl, form) => prons.push({ k, g: gl, form: legalizeWord(R(form)), w: null });
  addP("1sg", "1SG", copyWord(root1));
  if (g.dual) addP("1du", "1DU", duOf(root1));
  if (g.clusiv) {
    const incl = h01(fam, "yumi") < 0.55
      ? joinSyls([wearSyl(prof, root1)], [wearSyl(prof, root2)])   // the yumi weld
      : synthClosed(lang, inv, "pron1pi");
    addP("1pi", "1PL.INCL", incl);
    addP("1pe", "1PL.EXCL", plOf(root1, "pron1pl"));
  } else addP("1pl", "1PL", plOf(root1, "pron1pl"));
  addP("2sg", "2SG", copyWord(root2));
  if (g.dual) addP("2du", "2DU", duOf(root2));
  addP("2pl", "2PL", plOf(root2, "pron2pl"));
  if (g.gender3) {
    addP("3sgm", "3SG.M", copyWord(root3));
    const fem = h01(fam, "3f") < 0.55
      ? retint(copyWord(root3), vowFar(inv.vows))                  // he/she by vowel
      : synthClosed(lang, inv, "pron3f");                          // or suppletive
    addP("3sgf", "3SG.F", fem);
  } else addP("3sg", "3SG", copyWord(root3));
  addP("3pl", "3PL", plOf(root3, "pron3pl"));
  for (const p of prons) p.w = rform(lang, p.form);
  dedupe(lang, inv, prons);

  // ── demonstratives: distance lives in the vowel (proximal high-front,
  // distal low/back — the this/that, kore/are sound-symbolism corner) ──
  const demRoot = synthClosed(lang, inv, "dem");
  const dems = [{ k: "near", g: "this", form: legalizeWord(R(retint(copyWord(demRoot), vowNear(inv.vows)))), w: null }];
  if (g.dem3) dems.push({ k: "mid", g: "that", form: legalizeWord(R(retint(copyWord(demRoot), vowMid(inv.vows)))), w: null });
  dems.push({ k: "far", g: g.dem3 ? "yon" : "that", form: legalizeWord(R(retint(copyWord(demRoot), vowFar(inv.vows)))), w: null });
  for (const d of dems) d.w = rform(lang, d.form);
  dedupe(lang, inv, dems);

  // ── negation: short, and disproportionately NASAL, like life ──
  const negW = synthClosed(lang, inv, "neg");
  if (h01(fam, "negn") < 0.45) {
    const nas = inv.cons.find(x => x.m === 1 && x.p === 1) || inv.cons.find(x => x.m === 1);
    if (nas) negW.syls[0].on = [{ ...nas }];
  }
  const neg = { g: "NEG", form: legalizeWord(R(negW)), w: null };
  neg.w = rform(lang, neg.form);
  const negPool = [neg];   // deduped together with the q-series below — a
                           // negator homophonous with 'what' breaks clauses

  // ── question words: ONE interrogative root, compounded with the
  // language's own person/place/time/way words (the wh-/qu-/d- series) ──
  const qRoot = synthClosed(lang, inv, "q");
  if (h01(fam, "qons") < 0.5) {
    const stop = inv.cons.find(x => x.m === 0 && x.l === 0) || inv.cons.find(x => x.m === 0);
    if (stop) qRoot.syls[0].on = [{ ...stop }];
  }
  const qSrc = (cid) => wearSyl(prof, lighten(rootFormOf(lang, cid).w));
  const qs = [
    { k: "what", g: "what", form: copyWord(qRoot) },
    { k: "who", g: "who", form: joinSyls(qRoot.syls, [qSrc(MAN)]) },
    { k: "where", g: "where", form: joinSyls(qRoot.syls, [qSrc(EARTH)]) },
    { k: "when", g: "when", form: joinSyls(qRoot.syls, [qSrc(DAY)]) },
    { k: "how", g: "how", form: joinSyls(qRoot.syls, [qSrc(ROAD)]) },
    { k: "why", g: "why", form: retint(copyWord(qRoot), vowFar(inv.vows)) },
  ];
  for (const q of qs) { q.form = legalizeWord(R(q.form)); q.w = rform(lang, q.form); }
  dedupe(lang, inv, [...negPool, ...qs]);

  // ── adpositions: the body-part quarry (belly→in, foot→under), worn from
  // the EVOLVED words — a recent grammatical layer, so no extra replay ──
  const usedSrc = new Map();   // two meanings quarrying one noun must not
                               // wear it to the SAME grain of sand
  const adps = ADP_SPECS.map(spec => {
    let r = h01(fam, "adps", spec.m), src = null;
    for (const [cid, p] of spec.pool) { r -= p; if (r < 0) { src = cid; break; } }
    let form;
    if (src == null) form = legalizeWord(R(synthClosed(lang, inv, "adp:" + spec.m)));
    else {
      const stem = nativeStemOf(lang, src);
      const reuse = usedSrc.get(src) || 0;
      usedSrc.set(src, reuse + 1);
      if (reuse === 0 ? stem.syls.length >= 2 && h01(fam, "adp2", spec.m) < 0.3 : stem.syls.length >= 2)
        form = legalizeWord(lighten({ syls: stem.syls.slice(0, 2).map(cloneSyl) }));
      else {
        form = legalizeWord({ syls: [wearSyl(prof, stem)] });
        if (reuse > 0) { retint(form, vowFar(inv.vows)); legalizeWord(form); }
      }
    }
    return { m: spec.m, src, form, w: rform(lang, form) };
  });

  // ── conjunctions: 'and' is usually just 'with' (the comitative machine);
  // the rest are ancient little words of their own ──
  const withForm = adps.find(a => a.m === "with");
  const conj = [];
  if (h01(fam, "and") < 0.55) conj.push({ k: "and", g: "and", form: copyWord(withForm.form), w: withForm.w, src: "with" });
  else { const f = legalizeWord(R(synthClosed(lang, inv, "and"))); conj.push({ k: "and", g: "and", form: f, w: rform(lang, f), src: null }); }
  for (const k of ["or", "but", "if", "because"]) {
    const f = legalizeWord(R(synthClosed(lang, inv, k, k === "because" && h01(fam, "bc2") < 0.4 ? 2 : 1)));
    conj.push({ k, g: k, form: f, w: rform(lang, f), src: null });
  }

  // cross-class homophony collapses a small-inventory tongue into mush (one
  // 'pin' serving as what/this/of/because): one global sweep — pronouns keep
  // their forms, later classes shift; 'and' keeps its comitative identity
  dedupe(lang, inv, [...prons, ...dems, neg, ...qs, ...conj.filter(x => !x.src)]);

  // ── articles: the definite wears down from the distal demonstrative
  // (that→the), the indefinite from 'one' (one→a) — when the dials say so ──
  const far = dems[dems.length - 1];
  const defArt = g.defArt ? (() => {
    const f = legalizeWord({ syls: [wearSyl(prof, far.form)] });
    return { g: "DEF", form: f, w: rform(lang, f), src: "that" };
  })() : null;
  const indefArt = g.indefArt ? (() => {
    const f = legalizeWord({ syls: [wearSyl(prof, lighten(nativeStemOf(lang, ONE)))] });
    return { g: "INDF", form: f, w: rform(lang, f), src: "one" };
  })() : null;

  c.closed = { prons, dems, neg, qs, conj, adps, defArt, indefArt };
  return c.closed;
}

// ── M1: numerals — base-10/20/5 systems with real formation rules ─────────

// numeral atoms: the language's own words for 1..10 and 100, with the two
// great counting etymologies rolled in: quinary 'five' IS 'hand', and the
// vigesimal score-word is often 'man' (one whole person of fingers and toes)
function numAtoms(lang) {
  const c = gc(lang);
  if (c.atoms) return c.atoms;
  const g = gramOf(lang);
  const fam = lang.famSeed ?? lang.seed;
  const inv = compiledInv(lang);
  const CIDS = [ONE, TWO, THREE, FOUR, FIVE, SIX, SEVEN, EIGHT, NINE, TEN];
  const atoms = new Map();
  for (let n = 1; n <= 10; n++) {
    let form, ety = null;
    if (n === 5 && g.numBase === 5 && h01(fam, "five") < 0.5) { form = nativeStemOf(lang, HAND); ety = "hand"; }
    else form = nativeStemOf(lang, CIDS[n - 1]);
    atoms.set(n, { form, ety });
  }
  atoms.set(100, { form: nativeStemOf(lang, HUNDRED), ety: null });
  if (g.numBase === 20) {
    let form, ety = null;
    if (h01(fam, "score") < 0.4) { form = nativeStemOf(lang, MAN); ety = "man"; }
    else form = applyRules(lang.rules, synthClosed(lang, inv, "num20", 2));
    atoms.set(20, { form, ety });
  }
  // counting cannot survive homophones: dedupe the atom row deterministically
  const list = [...atoms.entries()].map(([n, a]) => ({ n, form: a.form, ety: a.ety, w: rform(lang, a.form) }));
  dedupe(lang, inv, list);
  c.atoms = new Map(list.map(x => [x.n, x]));
  return c.atoms;
}

// weld a multiplied or added numeral into one word: the multiplier wears to
// a light first element (two-ten → twen-ty), the base keeps its body
function numCompound(lang, a, b, capSyl = 3) {
  const prof = lang.prof;
  const w = joinSyls([wearSyl(prof, a)], b.syls);
  if (w.syls.length > capSyl) w.syls = [w.syls[0], ...w.syls.slice(-(capSyl - 1))];
  return legalizeWord(w);
}

/** The numeral phrase for n (1..999) in this language's own counting system:
 *  decimal, vigesimal (two-score-and-ten shapes) or quinary (five-two = 7).
 *  Returns { parts: [{w, g}], text, gloss }. */
export function numeral(lang, n) {
  const g = gramOf(lang);
  const atoms = numAtoms(lang);
  const parts = [];
  const atom = (k) => { const a = atoms.get(k); return { w: a.w, g: a.ety ? `${numGloss(k)}(${a.ety})` : numGloss(k) }; };
  const push = (p) => parts.push(p);
  const unitPart = (u) => {
    if (g.numBase === 5 && u > 5 && u < 10) {
      const five = atoms.get(5), rest = atoms.get(u - 5);
      return { w: rform(lang, numCompound(lang, five.form, rest.form)), g: `five-${numGloss(u - 5)}` };
    }
    return atom(u);
  };
  const tensPart = (t) => {
    if (t === 1) return atom(10);
    const mul = atoms.get(t), ten = atoms.get(10);
    return { w: rform(lang, numCompound(lang, mul.form, ten.form)), g: `${numGloss(t)}-ten` };
  };
  const scorePart = (v) => {
    if (v === 1) return atom(20);
    const mul = atoms.get(v), sc = atoms.get(20);
    return { w: rform(lang, numCompound(lang, mul.form, sc.form)), g: `${numGloss(v)}-twenty` };
  };
  const h = Math.floor(n / 100), rest = n % 100;
  if (h > 0) { if (h > 1) push(unitPart(h)); push(atom(100)); }
  if (rest > 0) {
    if (rest <= 10) push(unitPart(rest));
    else if (g.numBase === 20 && rest >= 20) {
      const v = Math.floor(rest / 20), r2 = rest % 20;
      push(scorePart(v));
      if (r2 > 10) { push(atom(10)); push(unitPart(r2 - 10)); }
      else if (r2 === 10) push(atom(10));
      else if (r2 > 0) push(unitPart(r2));
    } else {
      const t = Math.floor(rest / 10), u = rest % 10;
      const tp = t > 0 ? tensPart(t) : null, up = u > 0 ? unitPart(u) : null;
      if (tp && up && !g.numOrder) { push(up); push(tp); }        // unit-first (three-and-twenty)
      else { if (tp) push(tp); if (up) push(up); }
    }
  }
  return { parts, text: parts.map(p => p.w).join(" "), gloss: parts.map(p => p.g).join(" ") };
}
const NUM_GLOSS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
function numGloss(k) { return k === 100 ? "hundred" : k === 20 ? "twenty" : NUM_GLOSS[k] || String(k); }

/** Etymology notes for the Lab: which closed forms are worn-down open words. */
export function closedEtymologies(lang) {
  const cl = closedOf(lang);
  const out = [];
  for (const a of cl.adps) if (a.src != null) out.push({ w: a.w, m: a.m, from: glossOf(a.src) });
  if (cl.defArt) out.push({ w: cl.defArt.w, m: "the", from: cl.defArt.src });
  if (cl.indefArt) out.push({ w: cl.indefArt.w, m: "a", from: cl.indefArt.src });
  const and = cl.conj.find(x => x.k === "and");
  if (and && and.src) out.push({ w: and.w, m: "and", from: and.src });
  return out;
}

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
import { applyRule, applyRules, legalizeWord } from "./languageChange.js";
import { compiledInv, nativeStemOf, rootFormOf, glossOf } from "./language.js";
import {
  CONCEPTS, MANY, ALL, TWO, HAND, MAN, EARTH, DAY, ROAD,
  BELLY, HOUSE, HEAD, BACK, FOOT, GO, FACE, MOUTH, KINC,
  ONE, THREE, FOUR, FIVE, SIX, SEVEN, EIGHT, NINE, TEN, HUNDRED,
  TAKE, GIVE, FINISH, WANT, COME, SIT, STAND, FALL,
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

// ══ M2: inflectional morphology ═══════════════════════════════════════════
//
// The heart. Every affix is a GRAMMATICALIZED word: a source word from the
// language's own stock, worn to a clitic syllable at a birth point t in the
// rule log, welded on, and then carried through the REST of the log as part
// of the inflected word — so sound change hits stem and ending as one form.
// That single pipeline (the "onion": root … evolve to t … attach … evolve
// to now) is where the real-feeling stuff comes from for free:
//
//   · sister languages share sources and birth points (famSeed) and differ
//     by the tail of their logs — COGNATE CONJUGATIONS with regular
//     correspondences (M5's payoff, built in from the start)
//   · a rule that eats final vowels eats case endings too — paradigms
//     erode, stems alternate (the rex/regis machine), and (M5) the
//     category eventually renews itself from a fresh word
//   · fusional tongues crush affix stacks into portmanteau endings whose
//     declension classes are just theme vowels — -am/-em/-um from one rule
//
// Realization follows the EXISTING morphotype dial: iso = particles (no
// affixes at all), agg = stacked transparent syllables (with vowel harmony
// where the profile has it), fus = crushed endings + theme-vowel classes,
// tmpl = pattern change inside the stem (broken plurals, TAM re-vowelling).
// Irregularity is BY FREQUENCY: the most basic verbs (b ≥ 0.9, the belt the
// concept graph already carries) fossilize — suppletive past roots, ablaut
// pasts that shed their affix, plurals by umlaut alone.

const CASE_ORDER = ["acc", "gen", "dat", "loc", "abl", "ins", "all", "com", "ess", "term", "ade", "ela"];
const CASE_GLOSS = { acc: "ACC", erg: "ERG", gen: "GEN", dat: "DAT", loc: "LOC", abl: "ABL", ins: "INS", all: "ALL", com: "COM", ess: "ESS", term: "TERM", ade: "ADE", ela: "ELA" };
// grammaticalization quarries per category — [concept, weight] with null =
// an opaque ancient formative of the language's own
const AFF_SRC = {
  pl: null,                                   // shares the pronoun-plural source (many/all)
  du: [[TWO, 1]],
  acc: [[TAKE, 0.5], [GO, 0.2], [null, 0.3]],
  erg: [[HAND, 0.4], [null, 0.6]],
  gen: [[KINC, 0.35], [HOUSE, 0.25], [null, 0.4]],
  dat: [[GIVE, 0.45], [GO, 0.25], [null, 0.3]],
  loc: [[BELLY, 0.3], [EARTH, 0.3], [null, 0.4]],
  abl: [[BACK, 0.3], [MOUTH, 0.2], [null, 0.5]],
  ins: [[HAND, 0.5], [null, 0.5]],
  all: [[GO, 0.4], [FACE, 0.3], [null, 0.3]],
  com: [[HAND, 0.3], [null, 0.7]],
  ess: [[null, 1]], term: [[null, 1]], ade: [[null, 1]], ela: [[null, 1]],
  pst: [[FINISH, 0.45], [GO, 0.25], [null, 0.3]],
  fut: [[WANT, 0.4], [GO, 0.3], [COME, 0.15], [null, 0.15]],
  pfv: [[FINISH, 0.5], [FALL, 0.2], [null, 0.3]],
  ipfv: [[SIT, 0.3], [STAND, 0.2], [null, 0.5]],
};

// evolve a form through rules[from:to] in place (the onion's inner loop)
function evolveSlice(rules, from, to, w) {
  for (let i = from; i < to; i++) applyRule(rules[i], w);
  return w;
}

// the source word AS IT SOUNDED at birth time t, worn to its clitic syllable
function wornAt(lang, inv, key, srcCid, t) {
  let root, pre = true;
  if (srcCid == null) root = synthClosed(lang, inv, "afx:" + key);
  else { const r = rootFormOf(lang, srcCid); root = r.w; pre = r.pre; }
  if (!pre) return { syl: wearSyl(lang.prof, root), t: lang.rules.length };
  evolveSlice(lang.rules, 0, Math.min(t, lang.rules.length), root);
  return { syl: wearSyl(lang.prof, legalizeWord(root)), t: Math.min(t, lang.rules.length) };
}

// pick a source from a quarry (per-family, per-category)
function pickSrc(fam, key, pool, taken) {
  if (!pool) return null;
  let r = h01(fam, "afsrc", key);
  let src = pool[pool.length - 1][0];
  for (const [cid, p] of pool) { r -= p; if (r < 0) { src = cid; break; } }
  // two live categories must not wear the same word to the same grain
  if (src != null && taken.has(src)) src = null;
  if (src != null) taken.add(src);
  return src;
}

// birth point of a category in the rule log — early for old categories.
// (M5 note: renewal walks later births when erosion kills a category.)
function birthOf(fam, key, len) {
  return len === 0 ? 0 : hash32(fam, "gbirth", key) % Math.min(3, len + 1);
}

/** The language's paradigm SPEC: which categories exist, what each affix is
 *  (source, birth point, worn shape), theme vowels for declension classes.
 *  Everything derived + cached; nothing persisted. */
export function paradigmSpec(lang) {
  const c = gc(lang);
  if (c.pspec) return c.pspec;
  const g = gramOf(lang);
  const inv = compiledInv(lang);
  const fam = lang.famSeed ?? lang.seed;
  const len = lang.rules.length;
  const iso = lang.prof.morph === "iso";
  const taken = new Set();
  // births first, then TIER CLAMPS: affix order in real paradigms tracks the
  // AGE of the grammaticalization (older = closer to the stem) and languages
  // keep the slots consistent — number/aspect are old inner layers, case and
  // tense middle ones, person agreement (cliticized pronouns) the youngest,
  // outermost layer. Clamping births to tiers gives both the fixed slot
  // order and the honest diachrony.
  const births = {};
  for (const k of ["pl", "du", "pfv", "ipfv", "pst", "fut", "agr", "negaf", ...CASE_ORDER, "erg"]) births[k] = birthOf(fam, k, len);
  const t0n = Math.max(g.pluralMark ? births.pl : 0, g.dual ? births.du : 0);
  for (const k of [...CASE_ORDER, "erg"]) births[k] = Math.max(births[k], t0n);
  const t0v = g.aspect ? Math.max(births.pfv, births.ipfv) : 0;
  births.pst = Math.max(births.pst, t0v);
  births.fut = Math.max(births.fut, t0v);
  births.agr = Math.max(births.agr, t0v, g.tenses >= 2 ? births.pst : 0, g.tenses >= 3 ? births.fut : 0);
  const mkAff = (key, glossLabel, srcPoolKey) => {
    const src = pickSrc(fam, key, AFF_SRC[srcPoolKey ?? key], taken);
    const { syl, t: tEff } = wornAt(lang, inv, key, src, births[key]);
    return { k: key, g: glossLabel, src, t: tEff, syl };
  };
  // ── nominal ──
  const plSrc = h01(fam, "plsrc") < 0.6 ? MANY : ALL;    // same quarry the pronouns use
  const spec = { iso, cases: [], pl: null, du: null, tam: {}, pers: null, persObj: null, negAff: null, themes: [], vThemes: [], particles: {} };
  if (g.pluralMark) {
    const { syl, t: tEff } = wornAt(lang, inv, "pl", plSrc, births.pl);
    spec.pl = { k: "pl", g: "PL", src: plSrc, t: tEff, syl };
  }
  if (g.dual) spec.du = mkAff("du", "DU");
  const caseKeys = g.caseN === 0 ? [] : g.caseN === 1 ? ["gen"]
    : [g.align === "erg" ? "erg" : "acc", ...CASE_ORDER.slice(1)].slice(0, g.caseN);
  for (const k of caseKeys) spec.cases.push(mkAff(k, CASE_GLOSS[k], k === "erg" ? "erg" : k));
  // ── verbal ──
  if (g.tenses >= 2) spec.tam.pst = mkAff("pst", "PST");
  if (g.tenses >= 3) spec.tam.fut = mkAff("fut", "FUT");
  if (g.aspect) { spec.tam.pfv = mkAff("pfv", "PFV"); spec.tam.ipfv = mkAff("ipfv", "IPFV"); }
  if (g.negAffix) {
    const t = births.negaf;
    const negRoot = synthClosed(lang, inv, "neg");
    evolveSlice(lang.rules, 0, t, negRoot);
    spec.negAff = { k: "neg", g: "NEG", src: null, t, syl: wearSyl(lang.prof, legalizeWord(negRoot)) };
  }
  // person agreement: cliticized pronouns, the classic route — worn at their
  // own birth; plural persons crush the person root with the plural marker
  if (g.agree !== "none") {
    const t = births.agr;
    const persAff = {};
    const roots = { 1: synthClosed(lang, inv, "pron1"), 2: synthClosed(lang, inv, "pron2"), 3: synthClosed(lang, inv, "pron3") };
    const plW = rootFormOf(lang, plSrc).w;
    for (const p of [1, 2, 3]) {
      const r = copyWord(roots[p]);
      evolveSlice(lang.rules, 0, t, r);
      const sg = wearSyl(lang.prof, legalizeWord(r));
      // 3sg agreement is very often ZERO, like life (Turkish gelir-∅)
      persAff[p + "sg"] = p === 3 && h01(fam, "z3") < 0.55 ? null : { k: p + "sg", g: p + "SG", src: null, t, syl: sg };
      const plM = copyWord(plW);
      evolveSlice(lang.rules, 0, t, plM);
      const plSyl = wearSyl(lang.prof, legalizeWord(plM));
      const fusedPl = { on: sg.on.map(x => ({ ...x })), nu: sg.nu.map(x => ({ ...x })), co: plSyl.on.length ? [{ ...plSyl.on[0] }] : plSyl.co.map(x => ({ ...x })) };
      persAff[p + "pl"] = { k: p + "pl", g: p + "PL", src: null, t, syl: fusedPl };
    }
    dedupeAffixSet(lang, inv, Object.values(persAff).filter(Boolean));
    spec.pers = persAff;
    spec.persObj = g.agree === "both";
  }
  // paradigm-internal contrast: number+case affixes against each other, TAM
  // affixes against each other (persons handled above)
  dedupeAffixSet(lang, inv, [spec.pl, spec.du, ...spec.cases].filter(Boolean));
  dedupeAffixSet(lang, inv, [spec.tam.pst, spec.tam.fut, spec.tam.pfv, spec.tam.ipfv].filter(Boolean));
  // ── fusional theme vowels: declension/conjugation classes ──
  const nTheme = lang.prof.morph === "fus" || lang.prof.morph === "tmpl" ? g.declN : 1;
  for (let k = 0; k < nTheme; k++) spec.themes.push(inv.vows[hash32(fam, "theme", k) % inv.vows.length]);
  const nvTheme = lang.prof.morph === "fus" ? g.conjN : 1;
  for (let k = 0; k < nvTheme; k++) spec.vThemes.push(inv.vows[hash32(fam, "vtheme", k) % inv.vows.length]);
  c.pspec = spec;
  return spec;
}

// affixes inside one paradigm must contrast: two sources can wear down to
// the SAME syllable (fall→pi, sit→pi). In a fusional tongue the portmanteau
// crush keeps only the CONSONANTAL SKELETON (theme vowels flatten nuclei),
// so there the skeleton must be distinct and colliders walk the consonant
// inventory — contrast maintenance, the same pressure that keeps real
// paradigms apart. Everyone else contrasts whole syllables and walks vowels.
function dedupeAffixSet(lang, inv, affs) {
  const fus = lang.prof.morph === "fus";
  const seen = new Set();
  const sigOf = (a) => fus
    ? renderWord({ syls: [{ on: a.syl.on.map(x => ({ ...x })), nu: [], co: a.syl.co.map(x => ({ ...x })) }] }, lang.prof) || "∅"
    : renderWord({ syls: [a.syl] }, lang.prof);
  const consPool = inv.cons.filter(x => x.p < 6 && x.m <= 5);
  for (const a of affs) {
    if (!a) continue;
    let sig = sigOf(a);
    for (let t = 0; seen.has(sig) && t < inv.vows.length + consPool.length; t++) {
      if (fus && consPool.length) a.syl.on = [{ ...consPool[t % consPool.length] }];
      else a.syl.nu = [{ ...inv.vows[t % inv.vows.length], n: 0, lg: 0 }];
      sig = sigOf(a);
    }
    seen.add(sig);
  }
}

// ── the attach machine ────────────────────────────────────────────────────

// vowel harmony: a bound affix takes the stem's class. In front–back
// harmony the low vowel alternates a↔e (the Turkish -lar/-ler pair — a
// backness flip alone would be invisible in romanization); rounding
// harmony spares low vowels, as in life.
function harmonize(prof, stemSyls, affSyl) {
  if (prof.harmony === "none" || !stemSyls.length) return affSyl;
  const last = [...stemSyls].reverse().find(s => s.nu.length);
  if (!last) return affSyl;
  const st = last.nu[last.nu.length - 1];
  const back = st.b !== 0;
  for (const v of affSyl.nu) {
    if (prof.harmony === "fb") {
      if (v.h === 2) { v.h = back ? 2 : 1; v.b = back ? 1 : 0; }
      else v.b = back ? 2 : 0;
    } else if (prof.harmony === "round" && v.h !== 2) v.r = st.r;
  }
  return affSyl;
}

// weld one worn syllable onto a form (side per the language's affix dial)
function attachSyl(prof, form, syl, side) {
  const s = cloneSyl(syl);
  harmonize(prof, form.syls, s);
  if (side === "pre") {
    const first = form.syls[0];
    if (s.nu.length && !s.co.length && first && !first.on.length && first.nu.length)
      first.on = [first.nu[0].b === 0 ? { ...GLIDE_Y } : { ...GLIDE_W }];
    form.syls.unshift(s);
  } else {
    const last = form.syls[form.syls.length - 1];
    if (last && last.nu.length && !last.co.length && !s.on.length && s.nu.length)
      s.on = [s.nu[0].b === 0 ? { ...GLIDE_Y } : { ...GLIDE_W }];
    if (last && last.co.length && s.on.length >= 2) s.on = s.on.slice(0, 1);
    form.syls.push(s);
  }
  return form;
}

// fusional crush: a stack of worn syllables becomes ONE portmanteau ending —
// the first element keeps its body, the rest survive as consonant traces
// (up to two: -m vs -mp is how 1SG and 1PL stay apart after the vowels go)
function crush(syls) {
  if (syls.length <= 1) return syls.map(cloneSyl);
  const out = cloneSyl(syls[0]);
  for (let i = 1; i < syls.length; i++) {
    const s = syls[i];
    for (const tr of [s.on[0], s.co[0]]) if (tr && out.co.length < 2) out.co.push({ ...tr });
  }
  return [out];
}

// templatic pattern change: swap every nucleus for the pattern vowel — the
// broken-plural / TAM-ablaut machine of root-and-pattern morphology. The
// pattern vowels are assigned per language with a dedupe walk, so PST and
// PFV cannot silently collapse into one pattern.
function patternVowels(lang) {
  const c = gc(lang);
  if (c.patterns) return c.patterns;
  const inv = compiledInv(lang);
  const fam = lang.famSeed ?? lang.seed;
  // dedupe on the RENDERED vowel: three distinct low qualities all romanize
  // "a", and a pattern contrast the reader cannot see is no contrast
  const seen = new Set();
  const rV = (v) => renderWord({ syls: [{ on: [], nu: [{ ...v, n: 0, lg: 0 }], co: [] }] }, lang.prof);
  const out = {};
  for (const key of ["pst", "fut", "pfv", "ipfv", "pl"]) {
    let idx = hash32(fam, "pat:" + key) % inv.vows.length;
    for (let k = 0; seen.has(rV(inv.vows[idx])) && k < inv.vows.length; k++) idx = (idx + 1) % inv.vows.length;
    seen.add(rV(inv.vows[idx]));
    out[key] = inv.vows[idx];
  }
  c.patterns = out;
  return out;
}
function repattern(lang, form, key) {
  const v = patternVowels(lang)[key] || compiledInv(lang).vows[0];
  for (const s of form.syls) for (let i = 0; i < s.nu.length; i++) s.nu[i] = { ...v, n: s.nu[i].n, lg: 0 };
  return form;
}

// deterministic ablaut shift for fossil irregulars (sing→sang: nucleus
// steps through the inventory; the affix that once marked the cell is gone)
function ablautNu(lang, form) {
  const inv = compiledInv(lang);
  const fam = lang.famSeed ?? lang.seed;
  const shift = 1 + hash32(fam, "ablsh") % Math.max(1, inv.vows.length - 1);
  for (const s of form.syls) {
    if (!s.nu.length) continue;
    const cur = s.nu[0];
    const idx = inv.vows.findIndex(v => v.h === cur.h && v.b === cur.b && v.r === cur.r);
    s.nu = [{ ...inv.vows[((idx < 0 ? 0 : idx) + shift) % inv.vows.length], n: cur.n, lg: cur.lg }];
    break;                                          // the STRESSED (first) nucleus mutates
  }
  return form;
}

// ── the onion: build one inflected cell ───────────────────────────────────
// events = [{t, syl, g}] sorted by birth; the form evolves between attaches
// and the whole inflected word rides the tail of the log as one piece — so
// a language's endings erode, sandhi across the seam, and stems alternate
// exactly as far as its own sound laws push them.
function onionBuild(lang, stemCid, events, { fuse = false, theme = null, pattern = null, rootOverride = null, ablaut = false } = {}) {
  const prof = lang.prof;
  const side = gramOf(lang).affixSide;
  const src = rootOverride ? { w: copyWord(rootOverride), pre: true } : rootFormOf(lang, stemCid);
  let form = src.w;                                  // deep copy already
  const rules = lang.rules;
  if (pattern) repattern(lang, form, pattern);
  if (ablaut) ablautNu(lang, form);                  // the vowel IS the mark
  if (!src.pre) {
    // compound stems carry their history baked in: affix at the surface
    for (const e of events) attachSyl(prof, form, e.syl, side);
    return legalizeWord(form);
  }
  let list = events.slice().sort((a, b) => a.t - b.t);
  if (fuse && list.length > 1) {
    // fusional: a multi-affix stack grammaticalized as ONE portmanteau at
    // the earliest birth — and the theme vowel that marks the declension
    // class colours exactly these fused endings (-am/-em/-um). A lone affix
    // keeps its own vowel, so the etymology stays audible in the singular.
    const t0 = list[0].t;
    const stack = crush(list.map(e => e.syl));
    if (theme != null && stack.length) stack[0].nu = [{ ...theme, n: 0, lg: 0 }];
    list = [{ t: t0, syl: stack[0], g: list.map(e => e.g).join(".") }];
  }
  let cursor = 0;
  for (const e of list) {
    const t = Math.min(e.t, rules.length);
    evolveSlice(rules, cursor, t, form);
    cursor = t;
    attachSyl(prof, form, e.syl, side);
    legalizeWord(form);
  }
  evolveSlice(rules, cursor, rules.length, form);
  return legalizeWord(form);
}

// ── irregularity by frequency ─────────────────────────────────────────────
// The basicness belt (b ≥ 0.9) fossilizes: 'be'/'go' grade into suppletion,
// fusional basics ablaut their past and shed the affix, agglutinative
// basics syncopate the tense vowel into the stem. (M5 adds leveling: the
// LESS basic irregulars regularize as the log grows.)
function irregularityOf(lang, cid) {
  const con = CONCEPTS[cid];
  const b = con ? con.b : 0;
  const fam = lang.famSeed ?? lang.seed;
  const morph = lang.prof.morph;
  if (morph === "iso" || b < 0.9) return null;
  if (b >= 0.95 && h01(fam, "suppl", cid) < (b - 0.95) * 4 + 0.35) return "suppl";
  if ((morph === "fus" || morph === "tmpl") && h01(fam, "abl", cid) < 0.45) return "ablaut";
  if (morph === "agg" && h01(fam, "foss", cid) < 0.4) return "fossil";
  return null;
}

const isMarkedTam = (tam) => tam === "pst" || tam === "pfv";

// suppletive stems are LOST VERBS: the paradigm kept a word the language
// otherwise forgot (go/went, be/was) — synthesized from its own stream
function suppletiveStem(lang, cid) {
  const inv = compiledInv(lang);
  const rng = mkRng(hash32(lang.famSeed ?? lang.seed, "supplstem", cid));
  return synthWord(rng, lang.prof, inv, Math.max(1, Math.min(2, Math.round(lang.prof.wordLen || 2))));
}

// ── the public inflection API ─────────────────────────────────────────────

const themeFor = (lang, spec, cid) => {
  if (spec.themes.length <= 1) return null;
  const g = gramOf(lang);
  const fam = lang.famSeed ?? lang.seed;
  const gnd = g.genders ? genderOf(lang, cid) : 0;
  const k = h01(fam, "declpick", cid) < 0.7 ? gnd % spec.themes.length : hash32(fam, "declh", cid) % spec.themes.length;
  return { theme: spec.themes[k], k };
};

/** Noun class / gender of a concept in this language (0 when genderless). */
export function genderOf(lang, cid) {
  const g = gramOf(lang);
  if (!g.genders) return 0;
  const con = CONCEPTS[cid];
  const fem = ["mother", "woman", "queen", "daughter"], masc = ["father", "man", "king", "son", "brother"];
  if (con && g.genders >= 2) {
    if (fem.includes(con.g)) return 1;
    if (masc.includes(con.g)) return 0;
  }
  return hash32(lang.famSeed ?? lang.seed, "gender", cid) % g.genders;
}

/** Inflect a noun: { text, gloss, pre, post } — pre/post are the particle
 *  tokens an isolating tongue uses instead of affixes. */
export function inflectNoun(lang, cid, { num = "sg", cas = null } = {}) {
  const key = "n:" + cid + ":" + num + ":" + (cas || "");
  const c = gc(lang);
  const hit = c.cells.get(key);
  if (hit) return hit;
  const spec = paradigmSpec(lang);
  const morph = lang.prof.morph;
  const stemGloss = glossOf(cid);
  const caseAff = cas ? spec.cases.find(x => x.k === cas) : null;
  let out;
  if (spec.iso) {
    // particles, not affixes: 'stone PL' — the words stay untouched
    const post = [];
    if (num === "pl" && spec.pl) post.push({ w: renderWord({ syls: [spec.pl.syl] }, lang.prof), g: "PL" });
    if (num === "du" && spec.du) post.push({ w: renderWord({ syls: [spec.du.syl] }, lang.prof), g: "DU" });
    if (caseAff) post.push({ w: renderWord({ syls: [caseAff.syl] }, lang.prof), g: caseAff.g });
    out = { text: renderWord(nativeStemOf(lang, cid), lang.prof), gloss: stemGloss, pre: [], post, irr: false };
  } else {
    const events = [];
    const glosses = [];
    let pattern = null, irrPl = false;
    if (num === "pl") {
      const con = CONCEPTS[cid];
      if (morph === "tmpl" && h01(lang.famSeed ?? lang.seed, "brokenpl", cid) < 0.6) pattern = "pl";   // broken plural
      else if (morph === "fus" && con && con.b >= 0.9 && h01(lang.famSeed ?? lang.seed, "umlpl", cid) < 0.3) irrPl = true; // foot→feet
      else if (spec.pl) events.push(spec.pl);
      if (pattern || irrPl || spec.pl) glosses.push("PL");
    } else if (num === "du" && spec.du) { events.push(spec.du); glosses.push("DU"); }
    if (caseAff) { events.push(caseAff); glosses.push(caseAff.g); }
    const th = themeFor(lang, spec, cid);
    const form = onionBuild(lang, cid, events, { fuse: morph === "fus", theme: th && events.length ? th.theme : null, pattern, ablaut: irrPl });
    let glossStr;
    if (pattern || irrPl) glossStr = stemGloss + "⟨" + glosses[0] + "⟩" + (glosses.length > 1 ? "-" + glosses.slice(1).join("-") : "");
    else if (morph === "fus" && glosses.length > 1) glossStr = stemGloss + "-" + glosses.join(".");
    else glossStr = [stemGloss, ...glosses].join("-");
    out = { text: renderWord(form, lang.prof), gloss: glossStr, pre: [], post: [], irr: irrPl || !!pattern };
  }
  c.cells.set(key, out);
  return out;
}

/** Inflect a verb: TAM + person agreement per the language's dials.
 *  { text, gloss, pre, post, irr } — particles ride pre/post for isolating
 *  tongues (the Mandarin 'le' lives in post). */
export function inflectVerb(lang, cid, { tam = null, pers = null, num = "sg", obj = null } = {}) {
  const key = "v:" + cid + ":" + (tam || "") + ":" + (pers || "") + ":" + num + ":" + (obj || "");
  const c = gc(lang);
  const hit = c.cells.get(key);
  if (hit) return hit;
  const spec = paradigmSpec(lang);
  const morph = lang.prof.morph;
  const stemGloss = glossOf(cid);
  const tamAff = tam ? spec.tam[tam] : null;
  let out;
  if (spec.iso) {
    const post = [], pre = [];
    if (tamAff) {
      const tok = { w: renderWord({ syls: [tamAff.syl] }, lang.prof), g: tamAff.g };
      // aspect particles trail the verb (le); future auxiliaries tend to lead
      if (tam === "fut") pre.push(tok); else post.push(tok);
    }
    out = { text: renderWord(nativeStemOf(lang, cid), lang.prof), gloss: stemGloss, pre, post, irr: false };
  } else {
    const irr = tam && isMarkedTam(tam) ? irregularityOf(lang, cid) : null;
    const events = [], glosses = [];
    let rootOverride = null, pattern = null, ablaut = false;
    if (tamAff && irr === "suppl") {
      rootOverride = suppletiveStem(lang, cid);       // went: another verb's ghost
      glosses.push(tamAff.g);
    } else if (tamAff && irr === "ablaut" && morph !== "tmpl") {
      ablaut = true;                                  // sang: the vowel is the tense
      glosses.push(tamAff.g);
    } else if (tamAff && morph === "tmpl") {
      pattern = tam;                                  // pattern change IS the TAM
      glosses.push(tamAff.g);
    } else if (tamAff) {
      if (irr === "fossil") {
        // syncope: the tense vowel vanishes into the stem's coda
        events.push({ ...tamAff, syl: { on: tamAff.syl.on, nu: [], co: [] } });
      } else events.push(tamAff);
      glosses.push(tamAff.g);
    }
    if (pers && spec.pers) {
      const persAff = spec.pers[pers + num];
      if (persAff) { events.push(persAff); glosses.push(persAff.g); }
    }
    if (obj && spec.persObj && spec.pers) {
      const oAff = spec.pers[obj + "sg"];
      if (oAff) { events.push({ ...oAff, g: oAff.g + ".O" }); glosses.push(oAff.g + ".O"); }
    }
    const vTheme = spec.vThemes.length > 1 ? spec.vThemes[hash32(lang.famSeed ?? lang.seed, "conjpick", cid) % spec.vThemes.length] : null;
    const form = onionBuild(lang, cid, events, {
      fuse: morph === "fus", theme: vTheme && events.length ? vTheme : null,
      pattern, rootOverride, ablaut,
    });
    // gloss: fused endings read STEM-PST.3SG, stacked ones STEM-PST-3SG,
    // pattern change reads STEM⟨PST⟩, suppletion and ablaut fold the TAM in
    let glossStr;
    if (pattern || ablaut || rootOverride) glossStr = stemGloss + (glosses.length ? "⟨" + glosses[0] + "⟩" : "") + (glosses.length > 1 ? "-" + glosses.slice(1).join("-") : "");
    else if (morph === "fus" && glosses.length > 1) glossStr = stemGloss + "-" + glosses.join(".");
    else glossStr = [stemGloss, ...glosses].join("-");
    out = { text: renderWord(form, lang.prof), gloss: glossStr, pre: [], post: [], irr: !!irr || !!pattern };
  }
  c.cells.set(key, out);
  return out;
}

/** Table shape for the Lab: which rows/columns this language's paradigms
 *  actually have (cases, numbers, TAM cells, persons). */
export function paradigmShape(lang) {
  const spec = paradigmSpec(lang);
  const g = gramOf(lang);
  const nums = ["sg", ...(g.dual ? ["du"] : []), ...(g.pluralMark || spec.pl || lang.prof.morph === "tmpl" ? ["pl"] : [])];
  const cases = [{ k: null, g: g.align === "erg" ? "ABS" : "NOM" }, ...spec.cases.map(x => ({ k: x.k, g: x.g }))];
  const tam = [{ k: null, g: g.tenses === 1 ? "" : "PRS" }];
  if (spec.tam.pst) tam.push({ k: "pst", g: "PST" });
  if (spec.tam.fut) tam.push({ k: "fut", g: "FUT" });
  if (spec.tam.pfv) tam.push({ k: "pfv", g: "PFV" });
  if (spec.tam.ipfv) tam.push({ k: "ipfv", g: "IPFV" });
  const pers = spec.pers ? [["1", "sg"], ["2", "sg"], ["3", "sg"], ["1", "pl"], ["2", "pl"], ["3", "pl"]] : [];
  return { nums, cases, tam, pers, iso: spec.iso };
}

/** Affix etymologies for the Lab: every ending explains itself. */
export function affixEtymologies(lang) {
  const spec = paradigmSpec(lang);
  const out = [];
  const add = (a) => { if (a && a.src != null) out.push({ g: a.g, w: renderAffix(lang, a.syl), from: glossOf(a.src) }); };
  add(spec.pl); add(spec.du);
  for (const cse of spec.cases) add(cse);
  for (const k of Object.keys(spec.tam)) add(spec.tam[k]);
  return out;
}

// affixes rendered standalone must shed the silent-e clothing renderWord
// dresses free words in (the -lune→-lun lesson from the name suffixes)
function renderAffix(lang, syl) {
  let s = renderWord({ syls: [syl] }, lang.prof);
  if (lang.prof.ortho === "en") s = s.replace(/([^aeiou][aeiou][^aeiou])e$/, "$1");
  return s;
}

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

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
import { compiledInv, nativeStemOf, rootFormOf, glossOf, wordOf } from "./language.js";
import {
  CONCEPTS, MANY, ALL, TWO, HAND, MAN, EARTH, DAY, ROAD,
  BELLY, HOUSE, HEAD, BACK, FOOT, GO, FACE, MOUTH, KINC, STONE,
  ONE, THREE, FOUR, FIVE, SIX, SEVEN, EIGHT, NINE, TEN, HUNDRED,
  TAKE, GIVE, FINISH, WANT, COME, SIT, STAND, FALL, SAY,
  PEOPLE, DO, LAND, LITTLE, CHILD, GREAT, MAKE, HAVE, BE,
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
  // ── COMPLEX SYNTAX (M6): the clause beyond one verb ──
  // Relative-clause position (WALS 90A): postnominal is the world majority;
  // prenominal clusters in verb-final tongues (Japanese/Turkish [Ø saw river]
  // king). NRel dominates VO strongly.
  const relPos = ov ? (H("relpos") < 0.5 ? "pre" : "post") : (H("relpos") < 0.1 ? "pre" : "post");
  // Relativization strategy (WALS 122/123): the GAP is commonest; a resumptive
  // PRONOUN is a real minority (Semitic/Celtic 'the man that I saw him'); the
  // PARTICIPLE (a de-verbal modifier, no relativizer) clusters prenominally.
  const relStrat = relPos === "pre"
    ? (H("relstr") < 0.58 ? "part" : H("relstr") < 0.85 ? "gap" : "pron")
    : (H("relstr") < 0.6 ? "gap" : H("relstr") < 0.82 ? "pron" : "part");
  // Complementizer origin: worn from the distal demonstrative (that→'that',
  // the European path), from the SAY verb (quotative→complementizer, the
  // African/Asian path), or none at all (bare juxtaposition). Its side tracks
  // headedness: prehead in VO (said THAT …), final in OV (… that, said).
  const compz = H("compz") < 0.4 ? "dem" : H("compz") < 0.75 ? "say" : "none";
  // Adverbial clauses ('when X, Y') preposed in OV, postposed in VO.
  const advPos = ov ? (H("advpos") < 0.8 ? "pre" : "post") : (H("advpos") < 0.35 ? "pre" : "post");
  return {
    wo, adpSide, genN, adjN, affixSide, caseN, align, negPos, qPart, whFront,
    genders, tenses, agree,
    // Greenberg U18: demonstratives and numerals track the adjective's side
    // but lean prenominal even where the adjective follows (Romance 'ces trois
    // livres rouges'); head-final tongues stack everything before the noun
    demN: H("dord") < (adjN ? 0.9 : v1 ? 0.35 : 0.72),
    numN: H("nord") < (adjN ? 0.9 : v1 ? 0.4 : 0.72),
    relPos, relStrat, compz, advPos,
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
    // REDUPLICATION — a productive process ORTHOGONAL to the morphotype:
    // isolating Chinese (kàn-kan 'take a look'), agglutinative Malay
    // (orang-orang 'people') and fusional tongues all reduplicate. ~85% of
    // the world's languages do it for some grammatical function; it leans
    // heaviest in the isolating/agglutinative (SE-Asian, Austronesian)
    // corner. `full` copies the stem (orang-orang), `partial` prefixes a
    // CV- copy of the first syllable (Tagalog sulat → su-sulat).
    redup: (() => {
      const on = H("rd") < (m === "iso" ? 0.62 : m === "agg" ? 0.55 : 0.34);
      if (!on) return null;
      const fns = [];
      if (H("rdpl") < 0.5) fns.push("plural");        // orang-orang
      if (H("rdasp") < 0.6) fns.push("aspect");       // iterative/continuative
      if (H("rdint") < 0.55) fns.push("intensive");   // big → very big
      if (!fns.length) fns.push("intensive");
      return { type: H("rdt") < (m === "iso" ? 0.7 : 0.45) ? "full" : "partial", fns };
    })(),
    // IMPERATIVE — a category ~every language has; the bare stem is the
    // commonest exponent (English/Chinese "Go!"), then a dedicated suffix
    // (Russian idi), then a particle. PROHIBITIVE (negative command) is
    // usually plain negation, sometimes a special negator (Latin nolī).
    imp: pickW("imp", [["bare", 0.42], ["suffix", 0.4], ["particle", 0.18]]),
    prohib: H("proh") < 0.25 ? "special" : "neg",
  };
}

/** The language's grammar dials (lazy: old records roll them on first use —
 *  keyed off famSeed, so an upgraded parent and daughter agree, and the roll
 *  matches what fresh creation would have cloned down the family).
 *
 *  M5: a daughter occasionally re-rolls its basic word order ONCE at birth
 *  (Latin SOV → Romance SVO). Syntax moves faster than morphology, so the
 *  adposition and affix dials deliberately LAG — the attested disharmonic
 *  window, where a fresh SVO tongue still wears its inherited postpositions. */
export function gramOf(lang) {
  const p = lang.prof;
  if (!p.gram) p.gram = rollGrammar(lang.famSeed ?? lang.seed, p);
  const g = p.gram;
  if (g._fxid !== lang.id) {
    if (lang.parentId >= 0 && !lang.pin && h01(lang.seed, "woflip") < 0.12) {
      const ov = g.wo === "sov" || g.wo === "ovs";
      g.wo = h01(lang.seed, "wonew") < 0.7 ? (ov ? "svo" : "sov")
        : h01(lang.seed, "wonew2") < 0.5 ? "vso" : "svo";
      g.whFront = h01(lang.seed, "whnew") < (g.wo === "sov" ? 0.3 : 0.7);
    }
    g._fxid = lang.id;
  }
  return g;
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
// grammatical ENCLITIC particles (the 吗/了/ka slots) go NEUTRAL-tone in a
// tone language — real particles shed their melody, unlike pronouns and
// negators (bù, bié) which keep theirs. Render with tone marks suppressed.
const rformNeutral = (lang, w) => renderWord(w, lang.prof.tone ? { ...lang.prof, toneMarks: false } : lang.prof);

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
  { m: "by", pool: [[HAND, 0.3], [BACK, 0.2], [null, 0.5]] },   // the passive agent (instrument→agent, Latin ablative)
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
  // source-worn adpositions may honestly colexify (French de = of/from),
  // but two OPAQUE ones landing on the same syllable is just collision
  dedupe(lang, inv, adps.filter(a => a.src == null));

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

  // ── the polar-question particle (Japanese ka, Mandarin ma) — toneless ──
  const qp = g.qPart !== "none" ? (() => {
    const f = legalizeWord(R(synthClosed(lang, inv, "qp")));
    return { g: "Q", form: f, w: rformNeutral(lang, f) };
  })() : null;

  // ── imperative particle (hortative-like: "let…!") and the special
  // prohibitive negator (a distinct "don't!" — Latin nolī, Mandarin bié) ──
  const impPart = g.imp === "particle" ? (() => {
    const f = legalizeWord(R(synthClosed(lang, inv, "impp")));
    return { g: "IMP", form: f, w: rformNeutral(lang, f) };   // enclitic → toneless
  })() : null;
  const prohibW = g.prohib === "special" ? (() => {
    const f = legalizeWord(R(synthClosed(lang, inv, "proh")));
    return { g: "PROH", form: f, w: rform(lang, f) };
  })() : null;

  // cross-class homophony collapses a small-inventory tongue into mush (one
  // 'pin' serving as what/this/of/because): one global sweep — pronouns keep
  // their forms, later classes shift; 'and' keeps its comitative identity
  dedupe(lang, inv, [...prons, ...dems, neg, ...qs, ...conj.filter(x => !x.src),
    ...(qp ? [qp] : []), ...(impPart ? [impPart] : []), ...(prohibW ? [prohibW] : [])]);

  // ── articles: the definite wears down from the distal demonstrative
  // (that→the), the indefinite from 'one' (one→a) — when the dials say so.
  // An article is UNSTRESSED: if wearing a one-syllable demonstrative left
  // it identical to its parent, the vowel reduces (þæt vs þē) ──
  const far = dems[dems.length - 1];
  const defArt = g.defArt ? (() => {
    const f = legalizeWord({ syls: [wearSyl(prof, far.form)] });
    let w = rform(lang, f);
    if (w === far.w) {
      retint(f, vowMid(inv.vows));
      w = rform(lang, f);
      if (w === far.w) { retint(f, vowNear(inv.vows)); w = rform(lang, f); }
    }
    return { g: "DEF", form: f, w, src: "that" };
  })() : null;
  const indefArt = g.indefArt ? (() => {
    const f = legalizeWord({ syls: [wearSyl(prof, lighten(nativeStemOf(lang, ONE)))] });
    return { g: "INDF", form: f, w: rform(lang, f), src: "one" };
  })() : null;

  // ── relativizer + complementizer (M6 complex syntax) ──
  // The relativizer heads a relative clause under the gap/resumptive
  // strategies (the participle strategy needs none — the verb-form IS the
  // mark). It wears from the 'who' interrogative (relative-pronoun path) or
  // the distal demonstrative (that→which/that, the commonest source), and
  // surfaces at the RC edge ADJACENT to the head — so English 'king WHO…' and
  // Chinese '…gap DE king' both fall out of one placement rule.
  const relz = g.relStrat === "part" ? null : (() => {
    const fromWho = h01(fam, "relsrc") < 0.4;
    const base = fromWho ? qs.find(q => q.k === "who").form : far.form;
    const f = legalizeWord({ syls: [wearSyl(prof, base)] });
    return { g: "REL", form: f, w: rform(lang, f), src: fromWho ? "who" : "that" };
  })();
  // The complementizer ('that' of "said that…") wears from the distal
  // demonstrative or the SAY verb (the quotative→complementizer path), or is
  // absent (bare juxtaposition). Toneless, like the other grammatical enclitics.
  const compr = g.compz === "none" ? null : (() => {
    const base = g.compz === "say" ? lighten(rootFormOf(lang, SAY).w) : far.form;
    const f = legalizeWord({ syls: [wearSyl(prof, base)] });
    return { g: "COMP", form: f, w: rformNeutral(lang, f), src: g.compz === "say" ? "say" : "that" };
  })();

  c.closed = { prons, dems, neg, qs, conj, adps, defArt, indefArt, qp, impPart, prohibW, relz, compr };
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
  // the atomic numerals 1-10/100 come straight from the DEDUPED dictionary
  // (nativeStemOf → the homophony-repaired root), so they already match
  // wordOf and are mutually distinct — no second dedupe (which would retint
  // them and desync counting from the dictionary). The opaque vigesimal
  // score-word is the only free form; numeralTable's final hard-dedup over
  // the whole 1..99 range catches any residual collision it causes.
  const list = [...atoms.entries()].map(([n, a]) => ({ n, form: a.form, ety: a.ety, w: rform(lang, a.form) }));
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

// build the numeral phrase for n; `wear` false keeps the multiplier's FULL
// form (uncontracted "three-ten") instead of wearing it to one syllable —
// the collision escape the table builder reaches for
function buildNumeral(lang, n, wear = true) {
  const g = gramOf(lang);
  const atoms = numAtoms(lang);
  const parts = [];
  const atom = (k) => { const a = atoms.get(k); return { w: a.w, g: a.ety ? `${numGloss(k)}(${a.ety})` : numGloss(k) }; };
  const push = (p) => parts.push(p);
  const combine = (mulForm, baseForm) => wear ? numCompound(lang, mulForm, baseForm)
    : legalizeWord(joinSyls(mulForm.syls, baseForm.syls));    // full multiplier
  const unitPart = (u) => {
    if (g.numBase === 5 && u > 5 && u < 10) {
      const five = atoms.get(5), rest = atoms.get(u - 5);
      return { w: rform(lang, combine(five.form, rest.form)), g: `five-${numGloss(u - 5)}` };
    }
    return atom(u);
  };
  const tensPart = (t) => {
    if (t === 1) return atom(10);
    const mul = atoms.get(t), ten = atoms.get(10);
    return { w: rform(lang, combine(mul.form, ten.form)), g: `${numGloss(t)}-ten` };
  };
  const scorePart = (v) => {
    if (v === 1) return atom(20);
    const mul = atoms.get(v), sc = atoms.get(20);
    return { w: rform(lang, combine(mul.form, sc.form)), g: `${numGloss(v)}-twenty` };
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

// HARD numeral uniqueness: build 1..99 in order and force every form
// distinct — no language on earth tolerates homophonous numerals (a market
// would seize up). The escapes, in order of realism: uncontract the
// multiplier (three-ten, not thir-ty), then irregularize the last atom's
// vowel (the same pressure that makes 'eleven' not 'one-teen').
function numeralTable(lang) {
  const c = gc(lang);
  if (c.numTable) return c.numTable;
  const table = new Map();
  const taken = new Set();
  for (let n = 1; n < 100; n++) {
    let r = buildNumeral(lang, n, true);
    if (taken.has(r.text)) { const alt = buildNumeral(lang, n, false); if (!taken.has(alt.text)) r = alt; }
    let guard = 0;
    while (taken.has(r.text) && guard++ < 8) {
      // last-ditch: shift the final vowel of the phrase (irregular numeral)
      r = { ...r, text: perturbNumeralText(lang, r.text, n, guard) };
    }
    taken.add(r.text);
    table.set(n, r);
  }
  c.numTable = table;
  return table;
}
// deterministic final-vowel shift on a rendered numeral phrase (rare repair)
function perturbNumeralText(lang, text, n, k) {
  const inv = compiledInv(lang);
  const v = renderWord({ syls: [{ on: [], nu: [{ ...inv.vows[(n + k) % inv.vows.length], n: 0, lg: 0 }], co: [] }] }, lang.prof);
  return text.replace(/[aeiouáàǎāéèíìóòúùü]+(?=[^aeiouáàǎāéèíìóòúùü]*$)/i, v) || text + v;
}

/** The numeral phrase for n (1..999) in this language's own counting system:
 *  decimal, vigesimal (two-score-and-ten shapes) or quinary (five-two = 7).
 *  Guaranteed distinct across the counting range. Returns { parts, text, gloss }. */
export function numeral(lang, n) {
  if (n > 0 && n < 100) return numeralTable(lang).get(n);
  // 100+ : hundreds part composes with the deduped 1..99 table
  const g = gramOf(lang);
  const atoms = numAtoms(lang);
  const h = Math.floor(n / 100), rest = n % 100;
  const parts = [];
  if (h > 1) parts.push(...numeralTable(lang).get(h).parts);
  if (h > 0) { const a = atoms.get(100); parts.push({ w: a.w, g: numGloss(100) }); }
  if (rest > 0) parts.push(...numeralTable(lang).get(rest).parts);
  return { parts, text: parts.map(p => p.w).join(" "), gloss: parts.map(p => p.g).join(" ") };
}
const NUM_GLOSS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
function numGloss(k) { return k === 100 ? "hundred" : k === 20 ? "twenty" : NUM_GLOSS[k] || String(k); }

// numeral CONCEPTS (ONE..TEN, HUNDRED) map to a count, so a consumer can show
// the counting-system form instead of the bare dictionary root — in a base-5
// tongue the word for 'six' IS 'five-one', not a separate morpheme.
const NUM_CONCEPT = new Map([[ONE, 1], [TWO, 2], [THREE, 3], [FOUR, 4], [FIVE, 5],
  [SIX, 6], [SEVEN, 7], [EIGHT, 8], [NINE, 9], [TEN, 10], [HUNDRED, 100]]);
/** If cid is a numeral concept, its counting-system word (consistent with
 *  numeral()); otherwise null. Lets the dictionary agree with the counter. */
export function numeralConceptWord(lang, cid) {
  const n = NUM_CONCEPT.get(cid);
  return n == null ? null : numeral(lang, n).text;
}

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
  // voice / valency (M8): causative ← 'make/do/give' (the commonest source);
  // passive ← 'fall/undergo', 'be', 'get/receive'; antipassive is usually an
  // opaque or 'do'-based detransitivizer
  caus: [[MAKE, 0.4], [DO, 0.25], [GIVE, 0.2], [null, 0.15]],
  pass: [[FALL, 0.3], [BE, 0.25], [TAKE, 0.2], [null, 0.25]],
  antip: [[DO, 0.3], [null, 0.7]],
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
  // voice/valency is INNERMOST — valency-changing morphology is derivational,
  // closer to the root than tense or agreement (STEM-CAUS-PST-3SG)
  births.caus = births.pass = births.antip = 0;
  const t0n = Math.max(g.pluralMark ? births.pl : 0, g.dual ? births.du : 0);
  for (const k of [...CASE_ORDER, "erg"]) births[k] = Math.max(births[k], t0n);
  const t0v = g.aspect ? Math.max(births.pfv, births.ipfv) : 0;
  births.pst = Math.max(births.pst, t0v);
  births.fut = Math.max(births.fut, t0v);
  births.agr = Math.max(births.agr, t0v, g.tenses >= 2 ? births.pst : 0, g.tenses >= 3 ? births.fut : 0);
  // M5 — THE GRAMMATICALIZATION CYCLE. An affix born early can be ground to
  // silence by the very sound laws it rides (codaLoss eats a final -t, the
  // marked cell collapses into the bare stem). Speakers do not shrug: the
  // category RENEWS — a fresh word (next quarry, or an opaque formative)
  // grammaticalizes at a later point in the log. Case systems erode and
  // re-form; a daughter that drifted further than her sister may carry a
  // young transparent ending where the sister keeps the old worn one.
  const audible = (aff) => {
    if (iso) return true;
    const bare = renderWord(onionBuild(lang, STONE, []), lang.prof);
    const marked = renderWord(onionBuild(lang, STONE, [aff]), lang.prof);
    return marked !== bare;
  };
  const mkAff = (key, glossLabel, srcPoolKey, poolOverride) => {
    const pool = poolOverride ?? AFF_SRC[srcPoolKey ?? key];
    const src = pickSrc(fam, key, pool, taken);
    const { syl, t: tEff } = wornAt(lang, inv, key, src, births[key]);
    let aff = { k: key, g: glossLabel, src, t: tEff, syl };
    for (let r = 1; r <= 2 && !audible(aff); r++) {
      const t2 = r === 1 ? Math.ceil(len / 2) : len;
      const src2 = pickSrc(fam, key + ":r" + r, pool, taken);
      const w2 = wornAt(lang, inv, key + ":r" + r, src2, t2);
      aff = { k: key, g: glossLabel, src: src2, t: w2.t, syl: w2.syl, renewed: r };
    }
    return aff;
  };
  // ── nominal ──
  const plSrc = h01(fam, "plsrc") < 0.6 ? MANY : ALL;    // same quarry the pronouns use
  const spec = { iso, cases: [], pl: null, du: null, tam: {}, pers: null, persObj: null, negAff: null, imp: null, themes: [], vThemes: [], particles: {} };
  if (g.pluralMark) spec.pl = mkAff("pl", "PL", null, [[plSrc, 1]]);
  if (g.dual) spec.du = mkAff("du", "DU");
  const caseKeys = g.caseN === 0 ? [] : g.caseN === 1 ? ["gen"]
    : [g.align === "erg" ? "erg" : "acc", ...CASE_ORDER.slice(1)].slice(0, g.caseN);
  for (const k of caseKeys) spec.cases.push(mkAff(k, CASE_GLOSS[k], k === "erg" ? "erg" : k));
  // ── verbal ──
  if (g.tenses >= 2) spec.tam.pst = mkAff("pst", "PST");
  if (g.tenses >= 3) spec.tam.fut = mkAff("fut", "FUT");
  if (g.aspect) { spec.tam.pfv = mkAff("pfv", "PFV"); spec.tam.ipfv = mkAff("ipfv", "IPFV"); }
  // ── voice / valency (M8): the machinery the case labels exist for ──
  // Causative (add a causer, 'make X do') is the commonest; PASSIVE demotes the
  // agent (~43%, WALS 107A); ANTIPASSIVE is the ergative mirror (demote the
  // patient) — rare in accusative tongues, common in ergative ones, which is
  // exactly why ergative case has something to do.
  spec.voice = {};
  if (h01(fam, "vc:caus") < 0.6) spec.voice.caus = mkAff("caus", "CAUS");     // 让/-dir; the commonest
  if (h01(fam, "vc:pass") < (iso ? 0.5 : 0.43)) spec.voice.pass = mkAff("pass", "PASS");   // 被/-il
  if (g.align === "erg" ? h01(fam, "vc:antip") < 0.55 : h01(fam, "vc:antip") < 0.08) spec.voice.antip = mkAff("antip", "ANTIP");
  if (g.negAffix) {
    const t = births.negaf;
    const negRoot = synthClosed(lang, inv, "neg");
    evolveSlice(lang.rules, 0, t, negRoot);
    spec.negAff = { k: "neg", g: "NEG", src: null, t, syl: wearSyl(lang.prof, legalizeWord(negRoot)) };
  }
  // imperative suffix (only in suffix-mode tongues; bare/particle carry no
  // affix) — an opaque late formative, as imperatives usually are
  if (!iso && g.imp === "suffix") {
    const t = Math.max(birthOf(fam, "imp", len), t0v);
    const impRoot = synthClosed(lang, inv, "impaf");
    evolveSlice(lang.rules, 0, t, impRoot);
    spec.imp = { k: "imp", g: "IMP", src: null, t, syl: wearSyl(lang.prof, legalizeWord(impRoot)) };
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
  // one contrast pass over ALL bound affixes, nominal and verbal together —
  // a suffix serving as both PL and PST (a fresh reader caught -fe doing
  // exactly that) makes the interlinear gloss read two ways, so the later
  // affix shifts. Person markers are their own agreement paradigm, deduped
  // above; they may legitimately echo a case marker and are left alone.
  dedupeAffixSet(lang, inv, [spec.pl, spec.du, ...spec.cases,
    spec.tam.pst, spec.tam.fut, spec.tam.pfv, spec.tam.ipfv, spec.imp,
    spec.voice.caus, spec.voice.pass, spec.voice.antip].filter(Boolean));
  // ── fusional theme vowels: declension/conjugation classes ──
  const nTheme = lang.prof.morph === "fus" || lang.prof.morph === "tmpl" ? g.declN : 1;
  for (let k = 0; k < nTheme; k++) spec.themes.push(inv.vows[hash32(fam, "theme", k) % inv.vows.length]);
  const nvTheme = lang.prof.morph === "fus" ? g.conjN : 1;
  for (let k = 0; k < nvTheme; k++) spec.vThemes.push(inv.vows[hash32(fam, "vtheme", k) % inv.vows.length]);
  c.pspec = spec;
  return spec;
}

// ── Derivational morphology: productive WORD-FORMATION (M7) ────────────────
// Inflection BENDS a word (king→kings); DERIVATION makes a NEW word from it
// (king→kingdom→kingly, rule→ruler, river→rivulet). Real lexicons are mostly
// derived, not root — a handful of productive affixes multiply the ~220
// concepts into thousands, and turn a bare-root dictionary into a word-family
// one. Same discipline as inflection and adpositions (cardinal rule 2): every
// derivational affix is a grammaticalized worn-down WORD — agentive ← 'man/
// person/do' (rule→rule-man), diminutive ← 'little/child', augmentative ←
// 'great', verbalizer ← 'make/do' (hard→hard-make), nominalizer ← 'land/head'
// (king→king-land, the literal etymology of -dom), collective ← 'all/many'.
// It rides the SAME onion as inflection, so a derivational suffix erodes and
// corresponds regularly down a family, and agglutinative tongues (the world's
// great derivers) carry more of it than isolating ones.
const DERIV_CATS = [
  // key/gloss, input class (for sensible pairing), source quarry, base rate,
  // flip = chance of taking the MINORITY affix side: core derivation (agentive,
  // nominalizer) tracks the dominant side tightly (Chinese 人-agentive is a
  // suffix); peripheral/evaluative categories (diminutive, augmentative,
  // negative-flavoured) mix more freely (English un-/re-)
  { k: "AGT", in: "v", pool: [[MAN, 0.4], [PEOPLE, 0.25], [DO, 0.2], [null, 0.15]], rate: 0.85, flip: 0.05 },   // rule → ruler
  { k: "NMLZ", in: "n", pool: [[LAND, 0.3], [HEAD, 0.15], [null, 0.55]], rate: 0.85, flip: 0.05 },              // king → kingdom
  { k: "ADJZ", in: "n", pool: [[HAVE, 0.25], [null, 0.75]], rate: 0.7, flip: 0.2 },                             // king → kingly
  { k: "DIM", in: "n", pool: [[LITTLE, 0.6], [CHILD, 0.2], [null, 0.2]], rate: 0.6, flip: 0.28 },               // river → rivulet
  { k: "AUG", in: "n", pool: [[GREAT, 0.6], [null, 0.4]], rate: 0.4, flip: 0.3 },                               // house → mansion
  { k: "VBLZ", in: "q", pool: [[MAKE, 0.45], [DO, 0.3], [null, 0.25]], rate: 0.65, flip: 0.22 },                // hard → harden
  { k: "COLL", in: "n", pool: [[ALL, 0.4], [MANY, 0.3], [null, 0.3]], rate: 0.4, flip: 0.25 },                  // king → royalty
];
const DMORPH = { iso: 0.72, agg: 1.15, fus: 1.0, tmpl: 0.92 };   // agglutinative tongues derive most

/** The language's DERIVATIONAL affix inventory: which productive word-formation
 *  categories it has, and the worn-down word each affix descends from. Rolled
 *  per family + scaled by morphotype, cached, nothing persisted — exactly like
 *  paradigmSpec (its inflectional twin). */
export function derivSpec(lang) {
  const c = gc(lang);
  if (c.dspec) return c.dspec;
  const g = gramOf(lang);
  const inv = compiledInv(lang);
  const fam = lang.famSeed ?? lang.seed;
  const len = lang.rules.length;
  const mf = DMORPH[lang.prof.morph] ?? 1;
  const other = g.affixSide === "suf" ? "pre" : "suf";
  const taken = new Set();
  // an eroded derivational affix renews from a fresh quarry, like inflection
  const audible = (aff) => renderWord(onionBuild(lang, STONE, [aff], { side: aff.side }), lang.prof) !== renderWord(onionBuild(lang, STONE, [], { side: aff.side }), lang.prof);
  const cats = {}, list = [];
  for (const cat of DERIV_CATS) {
    if (h01(fam, "dcat", cat.k) >= Math.min(0.97, cat.rate * mf)) continue;   // this tongue lacks this derivation
    const key = "d:" + cat.k;
    const src = pickSrc(fam, key, cat.pool, taken);
    const w = wornAt(lang, inv, key, src, birthOf(fam, key, len));
    // POSITION reads the same affixSide dial inflection reads (Greenberg:
    // suffixing and prefixing tongues cluster), so a suffixing language
    // suffixes its derivation too — but a MINORITY of categories may take the
    // other side, the designed mix real languages show (English suffixes -ness
    // but prefixes un-/re-). A whole set never flips (probe §15 gates it).
    const side = h01(fam, "dside", cat.k) < cat.flip ? other : g.affixSide;
    let aff = { k: cat.k, g: cat.k, in: cat.in, src, t: w.t, syl: w.syl, side };
    for (let r = 1; r <= 2 && !audible(aff); r++) {
      const src2 = pickSrc(fam, key + ":r" + r, cat.pool, taken);
      const w2 = wornAt(lang, inv, key + ":r" + r, src2, r === 1 ? Math.ceil(len / 2) : len);
      aff = { k: cat.k, g: cat.k, in: cat.in, src: src2, t: w2.t, syl: w2.syl, side, renewed: r };
    }
    cats[cat.k] = aff;
    list.push(aff);
  }
  // enforce the Greenberg clustering as a HARD floor: the dominant side is
  // affixSide, and at most a third of a tongue's derivational affixes may take
  // the minority side — a designed mix (un- among -ness/-er/-dom), never the
  // wholesale flip a fresh reader rightly flagged. Excess flips (deterministic
  // order) revert to affixSide.
  const flipCap = Math.floor(list.length / 3);
  const flipped = list.filter(a => a.side === other);
  for (const a of flipped.slice(flipCap)) a.side = g.affixSide;
  dedupeAffixSet(lang, inv, list);   // ruler ≠ kingdom ≠ kingly — one contrast pass
  c.dspec = { cats, list };
  return c.dspec;
}

// Derived words are LEXICALIZED units and wear down HARDEST of all morphology
// (king+dom → kingdom, not king-dominion; ruler, not rule-er) — that erosion
// is what makes derived vocabulary read as vocabulary rather than glued Lego,
// and, once Drift runs, what turns transparent derivations into the opaque,
// unanalyzable words that make a daughter language feel old. Chew the seam in
// a tightly-fusing tongue and shed interior syllables when the whole grows
// long, protecting both EDGES (the stem's onset and the affix) so the
// derivation stays legible while the middle erodes toward opacity.
function erodeDerived(lang, form, side) {
  const m = lang.prof.morph;
  // isolating morphology stays TRANSPARENT — Chinese 国王 / gōng-rén keep every
  // morpheme; there is nothing to wear down
  if (m === "iso") return legalizeWord(form);
  if (m === "fus" && form.syls.length >= 3) {
    const si = side === "pre" ? 1 : form.syls.length - 2;   // the stem-edge syllable at the seam
    const seam = form.syls[si];
    if (seam && seam.nu.length && !seam.co.length) {         // open seam → lose its vowel, the awaru chew
      const nb = form.syls[side === "pre" ? 0 : form.syls.length - 1];
      if (nb && nb.on.length) { seam.nu = []; if (!seam.co.length && seam.on.length) { nb.on = side === "pre" ? [...nb.on, ...seam.on] : [...seam.on, ...nb.on]; form.syls.splice(si, 1); } }
    }
  }
  // shed interior syllables when long — fusional wears HARDEST (kingdom, not
  // king-dominion); agglutinative words are legitimately longer (Turkish -lık
  // stacks), so only a mild absurd-length safety there
  const cap = m === "fus" ? 3 : 4;
  while (form.syls.length > cap) form.syls.splice(Math.floor(form.syls.length / 2), 1);
  return legalizeWord(form);
}

/** Derive a NEW word from a base concept by a productive affix: king→kingdom
 *  (NMLZ), rule→ruler (AGT), river→rivulet (DIM), hard→harden (VBLZ). Returns
 *  { text, gloss, cat, src, affix, side } or null if the tongue lacks that
 *  derivation. Built through the onion (the affix rides the rule log, so it
 *  erodes and corresponds down the family), then worn down as a lexicalized
 *  unit; a fusional tongue crushes the seam. */
export function deriveWord(lang, cid, cat) {
  const spec = derivSpec(lang);
  const aff = spec.cats[cat];
  if (!aff) return null;
  const form = erodeDerived(lang, onionBuild(lang, cid, [aff], { fuse: lang.prof.morph === "fus", side: aff.side }), aff.side);
  return { text: renderWord(form, lang.prof), gloss: glossOf(cid) + "-" + aff.g, cat, src: aff.src, affix: renderAffix(lang, aff.syl), side: aff.side };
}

/** Lab-facing: the derivational affixes with their worn-down etymologies. */
export function derivEtymologies(lang) {
  return derivSpec(lang).list.map(a => ({ g: a.g, w: renderAffix(lang, a.syl), from: a.src != null ? glossOf(a.src) : null, renewed: !!a.renewed, side: a.side }));
}

// affixes inside one paradigm must contrast: two sources can wear down to
// the SAME syllable (fall→pi, sit→pi). In a fusional tongue the portmanteau
// crush keeps only the CONSONANTAL SKELETON (theme vowels flatten nuclei) —
// and in a HARMONY tongue the affix vowel is retinted by every stem, so a
// vowel-only contrast is neutralized at attach time (-bi vs -bu both come
// out -bu on a back stem). Both cases must contrast consonantally, and
// colliders walk the consonant inventory — contrast maintenance, the same
// pressure that keeps real paradigms apart. Everyone else contrasts whole
// syllables and walks vowels.
function dedupeAffixSet(lang, inv, affs) {
  const fus = lang.prof.morph === "fus" || lang.prof.harmony !== "none";
  const seen = new Set();
  const sigOf = (a) => fus
    ? renderWord({ syls: [{ on: a.syl.on.map(x => ({ ...x })), nu: [], co: a.syl.co.map(x => ({ ...x })) }] }, lang.prof) || "∅"
    : renderWord({ syls: [a.syl] }, lang.prof);
  const consPool = inv.cons.filter(x => x.p < 6 && x.m <= 5);
  const codaPool = inv.cons.filter(x => x.p < 6 && (x.m === 1 || x.m === 4 || x.m === 5 || (x.m === 2 && x.l === 0)));
  for (const a of affs) {
    if (!a) continue;
    let sig = sigOf(a);
    // walk the escape space (vowels × onset/coda consonants) until distinct.
    // a small-vowel tongue with many cases exhausts vowels alone, so the
    // walk also varies the CONSONANT — DAT and TERM must not collide just
    // because the language has three vowels and ten cases.
    const span = fus ? consPool.length * 2 : inv.vows.length * (codaPool.length + 1);
    for (let t = 0; seen.has(sig) && t < span; t++) {
      if (fus && consPool.length) {
        a.syl.on = [{ ...consPool[t % consPool.length] }];
        if (t >= consPool.length && codaPool.length) a.syl.co = [{ ...codaPool[t % codaPool.length] }];
      } else {
        a.syl.nu = [{ ...inv.vows[t % inv.vows.length], n: 0, lg: 0 }];
        const cw = Math.floor(t / inv.vows.length);
        if (cw > 0 && codaPool.length) a.syl.co = [{ ...codaPool[(cw - 1) % codaPool.length] }];
      }
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

// REDUPLICATION as a SURFACE process: full copies the whole stem, written
// with a hyphen (Malay orang-orang); partial prefixes a light CV- copy of
// the first syllable (Tagalog su-sulat). Rendering each part SEPARATELY is
// deliberate — it keeps renderWord's accidental-digraph collapse (ghgh→gh)
// from eating a genuine reduplication (sisin→sin), the reduplication-vs-
// haplology tension every generator has to resolve one way or the other.
function redupStemSurface(lang, cid, type) {
  const stem = nativeStemOf(lang, cid);
  return redupFormSurface(lang, stem, type);
}
function redupFormSurface(lang, stem, type) {
  const base = renderWord(stem, lang.prof);
  const s0 = stem.syls[0];
  // partial reduplication of a vowel-initial stem would just prefix a bare
  // vowel (i-iu, a lengthening the reader can't parse as reduplication) —
  // fall back to the unambiguous hyphenated full copy, as many languages do
  if (type === "full" || !s0 || !s0.on.length) return base + "-" + base;
  const red = renderWord({ syls: [{ on: s0.on.map(c => ({ ...c })), nu: s0.nu.slice(0, 1).map(v => ({ ...v, lg: 0 })), co: [] }] }, lang.prof);
  return red ? red + base : base + "-" + base;
}

/** Intensive/emphatic reduplication of any word (big → very-big, the
 *  adjectival use — Chinese hóng-hóng, Malay besar-besar). Available when the
 *  language reduplicates for intensity; returns null otherwise. */
export function intensive(lang, cid) {
  if (!redupHas(lang, "intensive")) return null;
  return { text: redupStemSurface(lang, cid, gramOf(lang).redup.type), gloss: glossOf(cid) + "~INTENS" };
}
// render an affix syllable as an attached surface suffix (reduplication is a
// late transparent layer; other affixes append after it, sans cross-seam
// sandhi — which is honest for a productive surface process)
function affixSurface(lang, syl) {
  let s = renderWord({ syls: [syl] }, lang.prof);
  if (lang.prof.ortho === "en") s = s.replace(/([^aeiou][aeiou][^aeiou])e$/, "$1");
  return s;
}
// which grammatical functions this language's reduplication serves
const redupHas = (lang, fn) => { const r = gramOf(lang).redup; return !!r && r.fns.includes(fn); };

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
function onionBuild(lang, stemCid, events, { fuse = false, theme = null, pattern = null, rootOverride = null, ablaut = false, side: sideOverride = null } = {}) {
  const prof = lang.prof;
  const side = sideOverride || gramOf(lang).affixSide;   // derivation may mix (un-/-ness); inflection follows the dial
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
// basics syncopate the tense vowel into the stem.
//
// M5 — ANALOGY LEVELING, the counter-pressure: every drift step is a hazard
// roll, and the least-basic irregulars regularize first (dreamt→dreamed
// while 'went' stays: b=1.0 verbs have hazard zero). The hazard is keyed on
// (family, concept, rule INDEX), so sister languages share their leveling
// history up to the branch point and diverge after it — one sister keeps
// the strong verb her twin has already flattened.
function irregularityOf(lang, cid) {
  const con = CONCEPTS[cid];
  const b = con ? con.b : 0;
  const fam = lang.famSeed ?? lang.seed;
  const morph = lang.prof.morph;
  if (morph === "iso" || b < 0.9) return null;
  let kind = null;
  if (b >= 0.95 && h01(fam, "suppl", cid) < (b - 0.95) * 4 + 0.35) kind = "suppl";
  else if ((morph === "fus" || morph === "tmpl") && h01(fam, "abl", cid) < 0.45) kind = "ablaut";
  else if (morph === "agg" && h01(fam, "foss", cid) < 0.4) kind = "fossil";
  if (kind) {
    const hz = 0.35 * (1 - b);
    for (let k = 1; k <= lang.rules.length; k++) if (h01(fam, "lvl", cid, k) < hz) return null;
  }
  return kind;
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
  // reduplicative plural (orang-orang) — a strategy that REPLACES the plural
  // affix/particle, available in every morphotype including isolating. It is
  // a surface layer: the reduplicated stem carries any case as a trailing
  // affix-string (transparent, no cross-seam sandhi)
  const redupPl = num === "pl" && redupHas(lang, "plural");
  let out;
  if (redupPl) {
    let text = redupStemSurface(lang, cid, gramOf(lang).redup.type);
    const post = [];
    if (caseAff) { if (spec.iso) post.push({ w: renderWord({ syls: [caseAff.syl] }, lang.prof), g: caseAff.g }); else text += affixSurface(lang, caseAff.syl); }
    out = { text, gloss: stemGloss + "~PL" + (caseAff && !spec.iso ? "-" + caseAff.g : ""), pre: [], post, irr: false };
  } else if (spec.iso) {
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
export function inflectVerb(lang, cid, { tam = null, pers = null, num = "sg", obj = null, neg = false, mood = null, voice = null } = {}) {
  const key = "v:" + cid + ":" + (tam || "") + ":" + (pers || "") + ":" + num + ":" + (obj || "") + (neg ? ":n" : "") + (mood ? ":" + mood : "") + (voice ? ":V" + voice : "");
  const c = gc(lang);
  const hit = c.cells.get(key);
  if (hit) return hit;
  const spec = paradigmSpec(lang);
  const g = gramOf(lang);
  const morph = lang.prof.morph;
  const stemGloss = glossOf(cid);
  const imperative = mood === "imp";
  const voiceAff = voice && spec.voice ? spec.voice[voice] : null;   // CAUS/PASS/ANTIP marker (innermost)
  // imperatives carry no tense; the ITERATIVE/continuative imperfective is
  // often reduplication (every morphotype, Chinese kàn-kan included)
  const tamEff = imperative ? null : tam;
  const tamAff = tamEff ? spec.tam[tamEff] : null;
  const redupAsp = !imperative && tamEff === "ipfv" && redupHas(lang, "aspect");
  // imperative particle (all morphotypes) + prohibitive, shared pre/post
  const impExtras = (pre, post) => {
    if (imperative && g.imp === "particle" && closedOf(lang).impPart) post.push({ w: closedOf(lang).impPart.w, g: "IMP" });
    if (imperative && neg) (g.negPos === "post" ? post : pre).push(prohToken(lang));
  };
  let out;
  if (redupAsp) {
    // surface reduplication carries the aspect; person marking (if any)
    // appends as a transparent suffix-string
    let text = redupStemSurface(lang, cid, g.redup.type);
    const glosses = [];
    if (pers && !spec.iso && spec.pers) {
      const persAff = spec.pers[pers + num];
      if (persAff) { text += affixSurface(lang, persAff.syl); glosses.push(persAff.g); }
    }
    out = { text, gloss: stemGloss + "~IPFV" + (glosses.length ? "-" + glosses.join("-") : ""), pre: [], post: [], irr: false };
  } else if (spec.iso) {
    const post = [], pre = [];
    // voice is a preverbal particle in an isolating tongue (Mandarin 被/让)
    if (voiceAff) pre.push({ w: rform(lang, { syls: [voiceAff.syl] }), g: voiceAff.g });
    if (tamAff) {
      // aspect/tense particles are enclitics — neutral tone (le, guo, ma)
      const tok = { w: rformNeutral(lang, { syls: [tamAff.syl] }), g: tamAff.g };
      if (tamEff === "fut") pre.push(tok); else post.push(tok);   // le trails, future auxiliaries lead
    }
    impExtras(pre, post);
    out = { text: renderWord(nativeStemOf(lang, cid), lang.prof), gloss: stemGloss + (imperative && g.imp !== "particle" ? ".IMP" : ""), pre, post, irr: false };
  } else {
    const irr = tamAff && isMarkedTam(tamEff) ? irregularityOf(lang, cid) : null;
    const events = [], glosses = [];
    let rootOverride = null, pattern = null, ablaut = false;
    // voice/valency is INNERMOST — pushed first so a t-tie keeps it inner of
    // negation and everything else (STEM-CAUS-NEG-PST-3SG)
    if (voiceAff) { events.push({ ...voiceAff, t: 0 }); glosses.push(voiceAff.g); }
    if (neg && !imperative && spec.negAff) {
      // affixal negation sits innermost (the Turkish -me- slot)
      events.push({ ...spec.negAff, t: 0 });
      glosses.push("NEG");
    }
    let tamInStem = null;   // set when suppletion/ablaut/pattern folds TAM into the stem
    if (tamAff && irr === "suppl") {
      rootOverride = suppletiveStem(lang, cid);       // went: another verb's ghost
      tamInStem = tamAff.g;
    } else if (tamAff && irr === "ablaut" && morph !== "tmpl") {
      ablaut = true;                                  // sang: the vowel is the tense
      tamInStem = tamAff.g;
    } else if (tamAff && morph === "tmpl") {
      pattern = tamEff;                               // pattern change IS the TAM
      tamInStem = tamAff.g;
    } else if (tamAff) {
      if (irr === "fossil") {
        // syncope: the tense vowel vanishes into the stem's coda
        events.push({ ...tamAff, syl: { on: tamAff.syl.on, nu: [], co: [] } });
      } else events.push(tamAff);
      glosses.push(tamAff.g);
    }
    // imperative suffix (suffix-mode tongues); bare/particle add no affix
    if (imperative && g.imp === "suffix" && spec.imp) { events.push(spec.imp); glosses.push("IMP"); }
    // person agreement — imperatives, being addressee-directed, don't agree
    if (pers && !imperative && spec.pers) {
      const persAff = spec.pers[pers + num];
      if (persAff) { events.push(persAff); glosses.push(persAff.g); }
    }
    if (obj && !imperative && spec.persObj && spec.pers) {
      const oAff = spec.pers[obj + "sg"];
      if (oAff) { events.push({ ...oAff, g: oAff.g + ".O" }); glosses.push(oAff.g + ".O"); }
    }
    const vTheme = spec.vThemes.length > 1 ? spec.vThemes[hash32(lang.famSeed ?? lang.seed, "conjpick", cid) % spec.vThemes.length] : null;
    const form = onionBuild(lang, cid, events, {
      fuse: morph === "fus", theme: vTheme && events.length ? vTheme : null,
      pattern, rootOverride, ablaut,
    });
    // gloss: fused endings read STEM-PST.3SG, stacked ones STEM-PST-3SG,
    // pattern change reads STEM⟨PST⟩, suppletion/ablaut fold the TAM in
    let glossStr;
    if (tamInStem) glossStr = stemGloss + "⟨" + tamInStem + "⟩" + (glosses.length ? "-" + glosses.join("-") : "");
    else if (morph === "fus" && glosses.length > 1) glossStr = stemGloss + "-" + glosses.join(".");
    else glossStr = [stemGloss, ...glosses].join("-");
    if (imperative && (g.imp === "bare" || g.imp === "particle") && !glosses.length) glossStr = stemGloss + (g.imp === "bare" ? ".IMP" : "");
    const pre = [], post = [];
    impExtras(pre, post);
    out = { text: renderWord(form, lang.prof), gloss: glossStr, pre, post, irr: !!irr || !!pattern };
  }
  c.cells.set(key, out);
  return out;
}

// the negator a prohibitive ("don't!") uses — a special word where the
// language has one (bié/nolī), otherwise ordinary negation
function prohToken(lang) {
  const cl = closedOf(lang);
  return cl.prohibW ? { w: cl.prohibW.w, g: "PROH" } : { w: cl.neg.w, g: "NEG" };
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
  return { nums, cases, tam, pers, iso: spec.iso, imp: g.imp, redup: g.redup };
}

/** Affix etymologies for the Lab: every ending explains itself — including
 *  the renewed ones, where the old layer eroded to silence and a fresh word
 *  stepped in (the grammaticalization cycle, visible). */
export function affixEtymologies(lang) {
  const spec = paradigmSpec(lang);
  const out = [];
  const add = (a) => {
    if (!a) return;
    if (a.src != null) out.push({ g: a.g, w: renderAffix(lang, a.syl), from: glossOf(a.src), renewed: !!a.renewed });
    else if (a.renewed) out.push({ g: a.g, w: renderAffix(lang, a.syl), from: null, renewed: true });
  };
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

// ══ The frame renderer: semantic frames → clauses with interlinear gloss ══
//
// A frame is the parse of a sentence — {subject, verb, object, tense…} —
// which is exactly the shape of the sim's event-log entries (M4's insight;
// the sim wiring itself is parked). Rendering = inflect the arguments per
// the language's alignment, agree the verb, order everything by the syntax
// dials, drop what the language drops, and keep a token-aligned gloss line.

const WO_SEQ = { sov: ["s", "o", "v"], svo: ["s", "v", "o"], vso: ["v", "s", "o"], vos: ["v", "o", "s"], ovs: ["o", "v", "s"] };

/** Resolve a requested TAM to what this language actually marks (a tense-
 *  less tongue renders 'past' with its perfective, like life). */
export function resolveTam(lang, wanted) {
  const spec = paradigmSpec(lang);
  if (!wanted) return null;
  if (spec.tam[wanted]) return wanted;
  if (wanted === "pst" && spec.tam.pfv) return "pfv";
  if (wanted === "fut" && spec.tam.ipfv) return null;
  return null;
}

/** Render a semantic frame as a clause. The frame IS the shape of a chronicle
 *  event; M6 lets it nest — a noun argument can carry a relative clause, a
 *  verb a complement clause, the whole clause an adverbial subordinate or a
 *  coordinate twin.
 *  frame = { s: {pron:{k,pers,num}} | {n,num,def,adj,dem,card,rel},
 *            v: {c, tam, neg, mood, comp},
 *            o: null | like s | {wh:true},
 *            loc: null | {adp, n, def},
 *            q: bool,
 *            sub: {con, frame} | undefined,      // 'when X, Y'
 *            coord: {con, frame} | undefined }    // 'X and Y'
 *  where a relative arg.rel = { headRole:"s"|"o", v, s?/o? } is a clause the
 *  head noun is a participant in.
 *  → { tokens: [{w, g, role}], text, gloss } */
export function renderClause(lang, frame, depth = 0) {
  const g = gramOf(lang);
  const cl = closedOf(lang);
  const join = (seq) => ({ tokens: seq, text: seq.map(t => t.w).join(" "), gloss: seq.map(t => t.g).join(" ") });
  // clause COORDINATION: "S1 and/but/or S2" — the conjunction between whole
  // clauses, not just nouns (reuses the closed-class 'and'/'but'/'or')
  if (frame.coord && depth < 6) {
    const a = renderClause(lang, { ...frame, coord: undefined }, depth + 1);
    const b = renderClause(lang, frame.coord.frame, depth + 1);
    const con = cl.conj.find(x => x.k === frame.coord.con) || cl.conj.find(x => x.k === "and") || cl.conj[0];
    return join([...a.tokens, { w: con.w, g: con.g, role: "CONJ" }, ...b.tokens]);
  }
  // adverbial SUBORDINATION: "when/if/because S1, S2" — the subordinate clause
  // preposes in OV (the 'when X, Y' order), postposes in VO, per advPos
  if (frame.sub && depth < 6) {
    const subr = subordinatorFor(lang, frame.sub.con);
    const inner = renderClause(lang, frame.sub.frame, depth + 1).tokens.map(t => ({ ...t, role: "SUB" }));
    const subClause = [{ w: subr.w, g: subr.g, role: "SUB" }, ...inner];
    const main = renderClause(lang, { ...frame, sub: undefined }, depth + 1).tokens;
    return join(g.advPos === "pre" ? [...subClause, ...main] : [...main, ...subClause]);
  }
  return join(renderCore(lang, frame, depth, {}));
}

// A subordinator for an adverbial clause: 'when' is the temporal interrogative
// (the wh-series doubling as a relativizer/subordinator, English who/when), the
// rest are the language's own little conjunctions ('if', 'because').
function subordinatorFor(lang, con) {
  const cl = closedOf(lang);
  if (con === "when") { const q = cl.qs.find(x => x.k === "when"); return { w: q.w, g: "when" }; }
  const c = cl.conj.find(x => x.k === con) || cl.conj.find(x => x.k === "because") || cl.conj[0];
  return { w: c.w, g: c.g };
}

// A relative clause modifying a head noun. rel = { headRole:"s"|"o",
// v:{c,tam,neg}, s?/o?:otherArg }: the head is the headRole participant of the
// embedded clause, realized as a GAP (absent), a resumptive PRONOUN (objects
// only — subject resumptives are rare and pro-dropped anyway), or the head of
// a PARTICIPLE (no relativizer — the verb-form is the mark). Returns tokens
// (role "REL"); the caller places them pre/post the head per relPos.
function renderRelative(lang, rel, depth) {
  const g = gramOf(lang), cl = closedOf(lang);
  const part = g.relStrat === "part";
  const otherRole = rel.headRole === "s" ? "o" : "s";
  const sub = { v: { c: rel.v.c, tam: rel.v.tam, neg: rel.v.neg } };
  sub[otherRole] = rel[otherRole] || null;
  if (g.relStrat === "pron" && rel.headRole === "o") sub.o = { pron: { k: "3sg", pers: 3, num: "sg" } };
  let toks = renderCore(lang, sub, depth + 1, { participle: part }).map(t => ({ ...t, role: "REL" }));
  if (!part && cl.relz) {
    const rz = { w: cl.relz.w, g: "REL", role: "REL" };
    toks = g.relPos === "post" ? [rz, ...toks] : [...toks, rz];   // relativizer at the head-adjacent edge
  }
  return toks;
}

// The clause core: one verb, its arguments, ordered by the syntax dials. This
// is the pre-M6 renderClause body verbatim, now returning the token sequence
// (the wrapper joins it) plus three additive hooks that a simple frame never
// triggers: NP modifiers (rel/dem/card), a verb complement clause (v.comp),
// and a participle rendering of the verb (opts.participle, for participial RCs).
function renderCore(lang, frame, depth, opts) {
  const g = gramOf(lang);
  const cl = closedOf(lang);
  const spec = paradigmSpec(lang);
  const participle = !!(opts && opts.participle);
  const ov = g.wo === "sov" || g.wo === "ovs";
  // ── VOICE / VALENCY rearranges the arguments — the machinery ergative case
  // exists for. PASSIVE promotes the patient to subject and demotes the agent
  // to a by-phrase (or drops it, the agentless passive); ANTIPASSIVE (the
  // ergative mirror) keeps the agent as subject but strips its ergative to
  // ABSOLUTIVE and demotes the patient to an oblique; CAUSATIVE adds a causer
  // and (re)transitivizes. A frame with no voice reads exactly as before; a
  // tongue that lacks the requested voice marker falls back to the active (no
  // marker, no rearrangement — we don't fake a valency op it can't say).
  const voice = frame.v.voice && spec.voice && spec.voice[frame.v.voice] ? frame.v.voice : null;
  let subjArg = frame.s, objArg = frame.o, oblArg = null, oblAdp = null;
  let trans = !!frame.o;
  if (voice === "pass") {
    subjArg = frame.o || null; objArg = null; trans = false;      // patient → subject, intransitive
    if (frame.s && !frame.v.agentless) { oblArg = frame.s; oblAdp = "by"; }
  } else if (voice === "antip") {
    objArg = null; trans = false;                                 // agent stays subject but ABSOLUTIVE
    if (frame.o && frame.v.keepPatient) { oblArg = frame.o; oblAdp = "at"; }
  } else if (voice === "caus") {
    trans = true;                                                 // causer + causee
  }
  const sIsPron = subjArg && !!subjArg.pron;
  const sPers = sIsPron ? subjArg.pron.pers : 3;
  const sNum = subjArg ? (sIsPron ? subjArg.pron.num : (subjArg.num || "sg")) : "sg";
  // core case per alignment: ERG on transitive subjects, ACC on objects,
  // absolutive/nominative bare — so a passive/antipassive subject is
  // intransitive and goes BARE, and the ergative visibly disappears
  const coreCase = spec.cases.length && spec.cases[0].k !== "gen" ? spec.cases[0].k : null;
  const sCase = coreCase === "erg" && trans ? "erg" : null;
  const oCase = coreCase === "acc" && trans ? "acc" : null;
  const np = (arg, cas, role) => {
    if (!arg) return [];
    if (arg.pron) {
      // graceful degrade: a gendered request in a genderless tongue falls to
      // plain 3sg; clusivity falls to the plain plural, and so on
      const k = arg.pron.k;
      const cell = cl.prons.find(p => p.k === k)
        || cl.prons.find(p => p.k === k.replace(/[mf]$/, ""))                              // 3sgf → 3sg
        || cl.prons.find(p => p.k === k.replace(/p[ie]$/, "pl"))                           // 1pi → 1pl
        || (k.includes("p") ? cl.prons.find(p => p.k[0] === k[0] && /p[lie]/.test(p.k)) : null)   // 1pl → 1pe
        || (k.endsWith("sg") ? cl.prons.find(p => p.k[0] === k[0] && p.k.includes("sg")) : null)  // 3sg → 3sgm
        || cl.prons.find(p => p.k[0] === k[0])
        || cl.prons[0];
      return [{ w: cell.w, g: cell.g, role }];
    }
    if (arg.wh) {
      const q = cl.qs.find(x => x.k === "what");
      return [{ w: q.w, g: "what", role, wh: true }];
    }
    const x = inflectNoun(lang, arg.n, { num: arg.num || "sg", cas });
    let seq = [...x.pre.map(t => ({ ...t, role })), { w: x.text, g: x.gloss, role }, ...x.post.map(t => ({ ...t, role }))];
    if (arg.adj != null) {
      const adj = { w: wordOf(lang, arg.adj), g: glossOf(arg.adj), role };
      seq = g.adjN ? [adj, ...seq] : [...seq, adj];
    }
    // a demonstrative is itself a definite determiner — it suppresses the
    // article (no "that the horse"); a simple frame never sets arg.dem, so
    // this leaves existing output byte-identical
    if (!arg.dem && arg.def && cl.defArt) seq = g.adjN ? [{ w: cl.defArt.w, g: "DEF", role }, ...seq] : [...seq, { w: cl.defArt.w, g: "DEF", role }];
    else if (!arg.dem && arg.def === false && cl.indefArt) seq = g.adjN ? [{ w: cl.indefArt.w, g: "INDF", role }, ...seq] : [...seq, { w: cl.indefArt.w, g: "INDF", role }];
    // NP-internal modifiers (M6, additive — a simple frame sets none): the
    // NUMERAL and DEMONSTRATIVE take their Greenberg-correlated side (numN,
    // demN), a RELATIVE clause wraps outermost per relPos
    if (arg.card != null) {
      const nm = numeral(lang, arg.card);
      const ct = { w: nm.text, g: String(arg.card), role };
      seq = g.numN ? [ct, ...seq] : [...seq, ct];
    }
    if (arg.dem) {
      const d = cl.dems.find(x => x.k === arg.dem) || cl.dems[cl.dems.length - 1];
      const dt = { w: d.w, g: d.g, role };
      seq = g.demN ? [dt, ...seq] : [...seq, dt];
    }
    if (arg.rel) {
      const relToks = renderRelative(lang, arg.rel, depth);
      seq = g.relPos === "pre" ? [...relToks, ...seq] : [...seq, ...relToks];
    }
    return seq;
  };
  const toks = {
    s: np(subjArg, sCase, "S"),
    o: np(objArg, oCase, "O"),
    v: [],
  };
  // verb: agreement with the (effective) subject; object person when
  // polypersonal. A participle (for a participial RC) sheds agreement.
  const imperative = frame.v.mood === "imp";
  const tam = imperative ? null : resolveTam(lang, frame.v.tam);
  const agreePers = !imperative && !participle && g.agree !== "none" ? String(sPers) : null;
  const objPers = !imperative && !participle && g.agree === "both" && trans && objArg && !objArg.wh ? "3" : null;
  const neg = !!frame.v.neg;
  const vx = inflectVerb(lang, frame.v.c, {
    tam, pers: agreePers, num: sNum === "du" ? "pl" : sNum, obj: objPers,
    neg: neg && (imperative || !!spec.negAff), mood: imperative ? "imp" : null, voice,
  });
  toks.v = [...vx.pre.map(t => ({ ...t, role: "V" })), { w: vx.text, g: vx.gloss + (participle ? ".PTCP" : ""), role: "V" }, ...vx.post.map(t => ({ ...t, role: "V" }))];
  // verb COMPLEMENT clause (v.comp): "said [that S saw river]" — the embedded
  // clause fills the object slot, with the complementizer at the matrix-verb
  // edge (prehead in VO 'said THAT…', final in OV '…that, said')
  if (frame.v.comp && depth < 6) {
    const inner = renderClause(lang, frame.v.comp, depth + 1).tokens.map(t => ({ ...t, role: "C" }));
    if (cl.compr) {
      const cz = { w: cl.compr.w, g: "COMP", role: "C" };
      toks.o = ov ? [...inner, cz] : [cz, ...inner];
    } else toks.o = inner;
  }
  // negation particle (when not an affix): before/after the verb, or clause-final.
  // imperatives already carry their own prohibitive marker in vx.pre/post
  let negFinal = false;
  if (neg && !imperative && !spec.negAff) {
    if (g.negPos === "pre") toks.v.unshift({ w: cl.neg.w, g: "NEG", role: "V" });
    else if (g.negPos === "post") toks.v.push({ w: cl.neg.w, g: "NEG", role: "V" });
    else negFinal = true;
  }
  // imperatives address "you": the 2nd-person subject is dropped by default
  // (universal tendency), and any explicit subject pronoun goes with it
  if (imperative && (!frame.s || sIsPron)) toks.s = [];
  // pro-drop: agreement carries the person, the pronoun stays home
  else if (sIsPron && g.proDrop && g.agree !== "none" && !participle) toks.s = [];
  // adpositional adjunct
  const locToks = [];
  if (frame.loc) {
    const adp = cl.adps.find(a => a.m === frame.loc.adp) || cl.adps[0];
    const nx = inflectNoun(lang, frame.loc.n, { num: "sg", cas: null });
    const inner = [...(frame.loc.def && cl.defArt && g.adjN ? [{ w: cl.defArt.w, g: "DEF", role: "X" }] : []),
      { w: nx.text, g: nx.gloss, role: "X" },
      ...(frame.loc.def && cl.defArt && !g.adjN ? [{ w: cl.defArt.w, g: "DEF", role: "X" }] : [])];
    locToks.push(...(g.adpSide === "pre" ? [{ w: adp.w, g: adp.m, role: "X" }, ...inner] : [...inner, { w: adp.w, g: adp.m, role: "X" }]));
  }
  // voice oblique: the passive by-agent ('seen BY the king') or the
  // antipassive's demoted patient — an adpositional phrase, placed like any
  // adjunct
  const oblToks = [];
  if (oblArg) {
    const adp = cl.adps.find(a => a.m === oblAdp) || cl.adps.find(a => a.m === "with") || cl.adps[0];
    const inner = np(oblArg, null, "X");
    oblToks.push(...(g.adpSide === "pre" ? [{ w: adp.w, g: oblAdp, role: "X" }, ...inner] : [...inner, { w: adp.w, g: oblAdp, role: "X" }]));
  }
  // assemble by word order; adjuncts sit preverbally in OV, clause-late in VO
  const adjToks = [...oblToks, ...locToks];
  const seq = [];
  for (const slot of WO_SEQ[g.wo]) {
    if (slot === "v" && ov && adjToks.length) seq.push(...adjToks);
    seq.push(...toks[slot]);
  }
  if (!ov && adjToks.length) seq.push(...adjToks);
  // wh-fronting: the question word moves to the clause edge when the dials say
  const whIdx = seq.findIndex(t => t.wh);
  if (whIdx > 0 && g.whFront) seq.unshift(...seq.splice(whIdx, 1));
  if (negFinal) seq.push({ w: cl.neg.w, g: "NEG", role: "V" });
  // polar-question particle (wh-questions carry their own interrogative)
  if (frame.q && !frame.o?.wh && cl.qp) {
    if (g.qPart === "final") seq.push({ w: cl.qp.w, g: "Q", role: "Q" });
    else if (g.qPart === "init") seq.unshift({ w: cl.qp.w, g: "Q", role: "Q" });
  }
  return seq;
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

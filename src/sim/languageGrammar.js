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
  CONCEPTS, MANY, ALL, TWO, HAND, MAN, WOMAN, EARTH, DAY, ROAD,
  BELLY, HOUSE, HEAD, BACK, FOOT, GO, FACE, MOUTH, KINC, STONE,
  ONE, THREE, FOUR, FIVE, SIX, SEVEN, EIGHT, NINE, TEN, HUNDRED,
  TAKE, GIVE, FINISH, WANT, COME, SIT, STAND, FALL, AGENTIVITY, MAKE, DO, EAT,
  BE, HAVE, KNOW, SEE, NEW, NIGHT, FAR, SEEM, HEAR, SAY,
  BODY, LEAF, PEOPLE, TREE, REED, SPEAR, ARM, SHIELD, WOOD, GRAIN, CLF_SENSE, CLF_AMBIG,
  LITTLE, EXCEED, SAME, LORD, NOBLE, HIGH, VERBS,
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
  let align = caseN >= 2 && H("align") < 0.27 ? "erg" : "acc";   // let: splits carve below
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
  const aspect = tenses === 1 ? true : H("asp") < 0.45;   // tenseless ⇒ aspect carries time
  // ── ALIGNMENT SPLITS (Group F): the rarer real systems, carved AFTER agree/
  // aspect are known, each on its OWN stream so base `align` (above) stays
  // byte-identical. Active-stative (split-S), tripartite, tam- and hierarchy-
  // conditioned split ergativity, direct-inverse. ──
  let activeFluid = false, ergSplit = null, hierSplit = null, invAgree = false, absAgree = false;
  if (align === "acc" && caseN >= 2 && m !== "iso" && H("actv") < 0.06) { align = "active"; activeFluid = H("afl") < 0.3; }
  else if (caseN >= 3 && (m === "agg" || m === "fus") && H("trip") < 0.05) align = "tripartite";   // erg→trip too (rare)
  if (align === "erg") {
    if ((tenses >= 2 || aspect) && H("esp") < 0.40) ergSplit = "tam";        // erg in perfective/past (Dixon)
    else if (H("esp") < 0.75) { ergSplit = "hier"; hierSplit = H("hsp") < 0.7 ? "sap" : "pron"; }  // Silverstein
  }
  invAgree = agree !== "none" && caseN <= 1 && H("inv") < 0.06;              // direction-marking verb
  absAgree = align === "erg" && agree !== "none" && H("aba") < 0.6;          // agrees with the absolutive
  // ── VOICE & VALENCY (Group B): valency-changing verbal operations, each on
  // its own stream. Passive is an accusative property (WALS 107, rare in erg);
  // the antipassive is the ergative mirror; iso does neither antip nor appl
  // (no bound exponent — it stays periphrastic). ──
  const caus = H("cau") < 0.85;                                             // ~85%, near-universal
  const pass = align === "erg" ? H("pass") < 0.12 : H("pass") < 0.5;
  const passBy = pickW("passby", [["with", 0.4], ["from", 0.35], ["at", 0.25]]);
  const antip = m === "iso" ? false : align === "erg" ? H("apass") < 0.6 : agree === "both" ? H("apass") < 0.15 : H("apass") < 0.05;
  const appl = m === "iso" ? false : H("appl") < (0.1 + (agree === "both" ? 0.4 : 0) + (m === "agg" ? 0.15 : m === "tmpl" ? 0.05 : 0));
  const applOf = appl ? pickW("applk", [["ben", 0.55], ["ins", 0.25], ["loc", 0.2]]) : null;
  // ── TAM & MOOD DEPTH (Group C′): synthetic tongues carry MORE distinctions,
  // so every threshold reads the morphotype. Graded tense needs a base tense;
  // aspect is INDEPENDENT of g.aspect (English marks perfect/progressive with
  // no grammatical aspect); irrealis moods slice a frequency-ordered list. ──
  const remotePast = m === "iso" || tenses < 2 ? 0 : pickW("rmp", m === "agg" ? [[0, 0.68], [1, 0.2], [2, 0.12]] : [[0, 0.82], [1, 0.12], [2, 0.06]]);
  const remoteFuture = tenses < 3 ? 0 : (H("rmf") < 0.1 + (remotePast >= 1 ? 0.15 : 0) ? 1 : 0);   // Bantu symmetry
  const perfect = H("prf") < 0.42 + (tenses === 1 ? 0.12 : 0) + (m === "iso" ? 0.06 : 0);
  const progressive = H("prog") < (m === "iso" ? 0.62 : m === "fus" ? 0.42 : 0.5) + (tenses === 1 ? 0.1 : 0);
  const habitual = H("hab") < (m === "agg" ? 0.42 : m === "iso" ? 0.18 : 0.26) + (tenses === 1 ? 0.1 : 0);   // leans agglutinative
  const moodN = m === "iso" ? (H("moodn") < 0.72 ? 0 : 1)
    : m === "agg" ? Math.floor(h01(famSeed, "g:moodn") * 4)
    : Math.min(2, Math.floor(h01(famSeed, "g:moodn2") * 3));
  const moods = MOOD_ORDER.slice(0, moodN);
  // ── EVIDENTIALITY (Group C): grammatical marking of information source
  // (WALS 78A, ~43% of languages). Skews SYNTHETIC + verb-final — presence rate
  // by morphotype (agg > tmpl > fus > iso) × an OV boost. Size skews small
  // (2-term commonest, then 3, then 4; synthetic tongues carry the larger
  // systems). Computed ABOVE the mir dial so the mirativity boost can read
  // evid.infer — a dedicated inferential is the canonical bridge to surprise. ──
  const synth = m === "agg" || m === "tmpl";
  const evidRate = (m === "agg" ? 0.5 : m === "tmpl" ? 0.42 : m === "fus" ? 0.3 : 0.16) * (ov ? 1.2 : v1 ? 0.8 : 1);
  const evid = (() => {
    if (H("ev") >= evidRate) return null;
    const r = H("evn");
    const n = r < (synth ? 0.34 : 0.56) ? 2 : r < (synth ? 0.72 : 0.87) ? 3 : 4;
    const em = H("evmir");   // ~40% mark mirativity on the evidential slot; EXTEND outnumbers DEDICATED
    const mir = em < 0.26 ? "extend" : em < 0.4 ? "dedicated" : null;
    return { n, mir, zeroDirect: H("evzd") < 0.72, infer: n >= 3 };   // infer = has a dedicated inferential term
  })();
  const mirative = H("mir") < 0.04 + (perfect ? 0.1 : 0) + (evid && evid.infer ? 0.14 : 0);
  // plural-marking dial, hoisted to a shared local so the classifier↔plural
  // complementarity (below) reads the SAME value the noun paradigm uses
  const plMark = m === "iso" ? H("pl") < 0.3 : H("pl") < 0.9;
  // dual (hoisted: trial/paucal gate on it — the Corbett number hierarchy) and
  // the possessive-affix dial (hoisted: alienSplit gates on it)
  const dual = H("du") < 0.15;
  const possAffix = m === "iso" ? false : agree !== "none" ? H("poss") < 0.7 : H("poss") < 0.4;
  // MULTI-CLAUSE (Group G) hoists: relPre feeds relStrat (no prenominal relative
  // pronoun — the universal), chaining feeds switchRef. These LAG a word-order
  // flip (gramOf re-rolls only wo/whFront at branch), the attested disharmonic
  // window (a fresh SVO tongue keeps its inherited prenominal relatives).
  const relPre = ov ? H("relp") < 0.55 : H("relp") < 0.12;   // prenominal relative (OV-skewed, ~28%)
  const chaining = m !== "iso" && ov && affixSide === "suf" ? H("chn") < (m === "agg" ? 0.5 : 0.2)
    : m === "iso" && ov ? H("chn") < 0.3 : false;            // clause-chaining is a verb-final property (VO → 0)
  return {
    wo, adpSide, genN, adjN, affixSide, caseN, align, negPos, qPart, whFront,
    genders, tenses, agree,
    activeFluid, ergSplit, hierSplit, invAgree, absAgree,   // alignment splits (Group F)
    caus, pass, passBy, antip, appl, applOf,                // voice & valency (Group B)
    remotePast, remoteFuture, perfect, progressive, habitual, moods, mirative,   // TAM depth (Group C′)
    evid,                                                    // evidentiality (Group C)
    // noun-class ASSIGNMENT strategy (WALS 32A): 'semantic' (~35% — animacy/sex
    // decides class) vs 'mixed' (the rest — a phonological cue assigns the
    // abstract residue, Russian -a→fem). Meaningful only when genders≥2; the
    // many-class corner is biased 'mixed' (its high classes are shape buckets).
    // Own stream 'clsasg' — reads nothing existing.
    classAssign: genders < 2 ? null : genders >= 4 ? "mixed" : (H("clsasg") < 0.4 ? "semantic" : "mixed"),
    // pronoun CASE series (English me/him is a case system the nouns lost):
    // pronouns sit atop the animacy hierarchy, so they keep case even when the
    // noun paradigm is thin — correlated with caseN. none|acc|acc-dat|full.
    // Own stream 'prc'. (Under noun ergativity this stays nom-acc: split-erg.)
    pronCase: caseN >= 3 ? (H("prc") < 0.85 ? "full" : "acc-dat")
      : caseN >= 1 ? (H("prc") < 0.5 ? "acc-dat" : "acc")
      : m === "iso" ? (H("prc") < 0.15 ? "acc" : "none")
      : (H("prc") < 0.55 ? "acc" : "none"),
    // CONCORD: which dependents agree with the head noun's class, and where the
    // exponent sits. A gender system with no agreement is inert, so given
    // genders≥2 the adjective agrees near-universally, the demonstrative next,
    // the verb when the language already agrees in person. The many-class
    // (Bantu) corner turns ALL targets on with an alliterating class PREFIX —
    // there, subject class-concord IS the agreement. Own streams cadj/cdem/cvb.
    concord: (() => {
      if (genders < 2) return null;
      if (genders >= 4) return { adj: true, dem: true, art: false, verb: true, site: "prefix" };
      let adj = H("cadj") < 0.95, dem = H("cdem") < 0.7, verb = agree !== "none" && H("cvb") < 0.7;
      if (!adj && !dem && !verb) adj = true;                          // an inert gender system isn't one
      return { adj, dem, art: false, verb, site: m === "tmpl" ? "suffix" : "fuse" };
    })(),
    aspect,   // tenseless ⇒ aspect carries time (hoisted for the alignment carve)
    pluralMark: plMark,
    // NUMERAL CLASSIFIERS (WALS 55A): a sortal system ("three CL cattle").
    // Strongly isolating (Chinese/SE-Asian corner), complementary with plural
    // marking (Sanches-Slobin — a language that obligatorily pluralizes rarely
    // also sorts by classifier). Own streams; re-reads plMark read-only. The
    // inventory always has a general classifier + shape/animacy buckets by
    // frequency. Order tracks AdjN (Greenberg): [Num CL] pre-N in AdjN tongues.
    classif: (() => {
      const base = m === "iso" ? 0.7 : m === "agg" ? 0.5 : m === "fus" ? 0.07 : 0.04;
      if (H("clf") >= base * (plMark ? 0.65 : 1.25)) return null;
      const classes = ["gen"];
      const add = (k, p, s) => { if (H(s) < p) classes.push(k); };
      add("hum", 0.8, "clfhum"); add("anm", 0.7, "clfanm");
      add("long", m === "iso" ? 0.65 : 0.4, "clflong");
      add("flat", m === "iso" ? 0.6 : 0.35, "clfflat");
      add("round", 0.45, "clfround");
      return { classes, obl: H("clfob") < 0.55, order: (adjN ? H("clford") < 0.8 : H("clford") < 0.2) ? "pre" : "post" };
    })(),
    dual,
    // NOMINAL NUMBER beyond sg/du/pl (Group E, Corbett hierarchy: trial ⊃ dual,
    // paucal needs plural/usually dual) — both gate on the EXISTING dual, rare.
    trial: dual && H("tri") < 0.12,
    paucal: dual && H("pau") < 0.25,
    // POSSESSION (Group E): head-marking languages affix the possessor (my-house);
    // never isolating. An alienability split affixes only inalienable (kin/body)
    // nouns and uses an 'of'-construction for the rest.
    possAffix,
    alienSplit: possAffix && H("alien") < 0.4,
    // COMPARISON (Group E, Stassen): the comparative strategy tracks word order —
    // OV favours the separative ('than' ‹ 'from'), VO-isolating the exceed-verb,
    // the rest a particle. stdFirst (standard precedes the adjective) tracks OV;
    // stored so a reference can pin the disharmonic corner (Mandarin bǐ).
    compar: (() => {
      const type = ov ? pickW("cmp", [["sep", 0.7], ["particle", 0.2], ["exceed", 0.1]])
        : v1 ? pickW("cmp", [["exceed", 0.45], ["particle", 0.35], ["sep", 0.2]])
        : m === "iso" ? pickW("cmp", [["exceed", 0.65], ["particle", 0.25], ["sep", 0.1]])
        : pickW("cmp", [["particle", 0.5], ["sep", 0.3], ["exceed", 0.2]]);
      return { type, more: pickW("cmpm", [["affix", 0.4], ["word", 0.35], ["none", 0.25]]), stdFirst: ov };
    })(),
    // POLITENESS (Group E, WALS 45A): a T-V distinction (tu/vous) worn from the
    // plural pronoun or a noble address; an honorific verb form leans synthetic.
    tv: (() => { const r = H("tv"); return r < 0.24 ? "binary" : r < 0.31 ? "multi" : "none"; })(),
    tvSource: H("tvsrc") < 0.6 ? "plural" : "noble",
    honVerb: (m === "agg" || m === "tmpl") ? H("hon") < 0.3 : H("hon") < 0.08,
    // ── MULTI-CLAUSE (Group G): coordination, complement/adverbial/relative
    // clauses, clause chaining. The linkers grammaticalize from existing words
    // (SAY→complementizer, DAY→'when', dem/wh→relativizer) and LAG a word-order
    // flip, so a daughter that flips OV→SVO keeps prenominal relatives + clause-
    // final complementizers — the attested disharmonic corner (Mandarin SVO+RelN).
    coordFinal: ov && affixSide === "suf" ? H("coordf") < 0.14 : false,   // enclitic -que (OV-suffixing edge, ~7%)
    compzSrc: m === "iso" ? pickW("cmpz", [["say", 0.6], ["dem", 0.25], ["wh", 0.15]])   // iso favours the SAY-quotative
      : pickW("cmpz", [["dem", 0.45], ["wh", 0.4], ["say", 0.15]]),
    compzPos: ov ? "final" : (H("cmpzp") < 0.85 ? "init" : "final"),      // OV ⇒ clause-final complementizer
    compFinite: m === "agg" ? H("cmpzf") < 0.5 : true,                    // agglutinative nominalizes complements
    advPos: ov ? "final" : (H("advp") < 0.85 ? "init" : "final"),         // subordinator-within-clause (WALS 94)
    advAffix: (m === "agg" || m === "tmpl") && ov && affixSide === "suf" ? H("advaf") < 0.5 : false,   // Turkic/Japanese converb
    relPre,
    relStrat: relPre ? (H("rels") < 0.72 ? "gap" : "resump")                        // prenominal: NEVER a relative pronoun (the universal)
      : caseN >= 1 ? pickW("rels", [["relpron", 0.5], ["gap", 0.35], ["resump", 0.15]])   // postnominal + case: relpron possible
      : (H("rels") < 0.75 ? "gap" : "resump"),
    relzSrc: H("relz") < 0.55 ? "dem" : "wh",
    chaining,
    switchRef: chaining && m !== "iso" ? H("sr") < 0.55 : false,          // SS/DS reference tracking ⊂ chaining, never iso
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
function applyWoFlip(g, lang) {
  if (lang.parentId >= 0 && !lang.pin && h01(lang.seed, "woflip") < 0.12) {
    const ov = g.wo === "sov" || g.wo === "ovs";
    g.wo = h01(lang.seed, "wonew") < 0.7 ? (ov ? "svo" : "sov")
      : h01(lang.seed, "wonew2") < 0.5 ? "vso" : "svo";
    g.whFront = h01(lang.seed, "whnew") < (g.wo === "sov" ? 0.3 : 0.7);
  }
  g._fxid = lang.id;
}
export function gramOf(lang) {
  const p = lang.prof;
  if (!p.gram) p.gram = rollGrammar(lang.famSeed ?? lang.seed, p);
  const g = p.gram;
  if (g._fxid !== lang.id) applyWoFlip(g, lang);
  return g;
}
/** Called at BIRTH by branchLanguage/foundLanguage(parent): the daughter's
 *  grammar is materialized from the parent's at the branching event itself,
 *  so whether anyone READ the parent's grammar first can never change what
 *  the daughter inherits (a review caught read-order leaking into
 *  daughters' word order — reads must be side-effect-free for history). */
export function bequeathGrammar(parent, child) {
  const g = gramOf(parent);
  child.prof.gram = JSON.parse(JSON.stringify(g));
  applyWoFlip(child.prof.gram, child);
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
// inventory until the collision clears (deterministic walk, tiny and rare).
// The walk must not give up when the vowels run out — a three-vowel tongue
// whose romanization collapses qualities can exhaust the nucleus dimension
// with the collision standing ('what' == 'why', a fresh reader caught it) —
// so past the vowels it varies a CODA too, like dedupeAffixSet. The first
// inv.vows.length steps are byte-identical to the old walk, so every form
// that cleared before still clears the same way.
function dedupe(lang, inv, forms, seed = []) {
  const seen = new Set(seed.map(f => f && f.w).filter(Boolean));   // seed WITHOUT mutating the seed forms
  const codaPool = inv.cons.filter(x => x.p < 6 && (x.m === 1 || x.m === 4 || x.m === 5 || (x.m === 2 && x.l === 0)));
  for (const f of forms) {
    const span = inv.vows.length * (codaPool.length + 1);
    for (let t = 0; seen.has(f.w) && t < span; t++) {
      retint(f.form, inv.vows[t % inv.vows.length]);
      const cw = Math.floor(t / inv.vows.length);
      if (cw > 0 && f.form.syls[0]) f.form.syls[0].co = [{ ...codaPool[(cw - 1) % codaPool.length] }];
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
// the concept a given adposition wears down from in THIS family — replays the
// closedOf ADP_SPECS roll so the applicative (Group B) is COGNATE with the
// language's own adposition (benefactive applicative ‹ its own 'to', etc.)
function adpSourceOf(lang, meaning) {
  const s = ADP_SPECS.find(x => x.m === meaning);
  if (!s) return null;
  let r = h01(lang.famSeed ?? lang.seed, "adps", meaning), src = null;
  for (const [cid, p] of s.pool) { r -= p; if (r < 0) { src = cid; break; } }
  return src;
}
// ── NUMERAL CLASSIFIERS (Group D): each sortal classifier is a worn-down
// body-part / shape noun (頭 head-of-cattle, 條 long-thing‹twig, 顆 round‹grain),
// replayed through this language's rule tail so sisters are cognate. The general
// classifier frequently bleaches to an opaque formative (個, via synthClosed).
// AFF_SRC-shaped: [concept, weight] with null = an opaque own formative. ──
const CLF_SRC = {
  hum: [[MAN, 0.4], [PEOPLE, 0.3], [BODY, 0.3]],
  anm: [[HEAD, 0.55], [BODY, 0.45]],                          // 頭 (head-of-cattle)
  long: [[TREE, 0.35], [REED, 0.3], [SPEAR, 0.2], [ARM, 0.15]],
  flat: [[LEAF, 0.5], [SHIELD, 0.25], [WOOD, 0.25]],          // Thai bai (‹ leaf)
  round: [[STONE, 0.4], [GRAIN, 0.35], [HEAD, 0.25]],         // 顆/粒 (‹ grain/kernel)
  gen: [[BODY, 0.35], [STONE, 0.2], [null, 0.45]],            // 個 — frequently opaque
};
const APPL_MEANING = { ben: "to", ins: "with", loc: "in" };   // applicative flavour → adposition

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
  const triMark = wearSyl(prof, lighten(rootFormOf(lang, THREE).w));
  const pauMark = wearSyl(prof, lighten(rootFormOf(lang, h01(fam, "pausrc") < 0.7 ? LITTLE : MANY).w));
  const plOf = (root, key) => g.pronPl === "affix"
    ? joinSyls(root.syls, [plMark])
    : synthClosed(lang, inv, key);
  const duOf = (root) => joinSyls(root.syls, [duMark]);
  const triOf = (root) => joinSyls(root.syls, [triMark]);   // trial pronoun ‹ 'three'
  const pauOf = (root) => joinSyls(root.syls, [pauMark]);   // paucal pronoun ‹ 'few'
  const prons = [];
  const addP = (k, gl, form) => prons.push({ k, g: gl, form: legalizeWord(R(form)), w: null });
  addP("1sg", "1SG", copyWord(root1));
  if (g.dual) addP("1du", "1DU", duOf(root1));
  if (g.trial) addP("1tri", "1TRI", triOf(root1));
  if (g.paucal) addP("1pau", "1PAU", pauOf(root1));
  if (g.clusiv) {
    const incl = h01(fam, "yumi") < 0.55
      ? joinSyls([wearSyl(prof, root1)], [wearSyl(prof, root2)])   // the yumi weld
      : synthClosed(lang, inv, "pron1pi");
    addP("1pi", "1PL.INCL", incl);
    addP("1pe", "1PL.EXCL", plOf(root1, "pron1pl"));
  } else addP("1pl", "1PL", plOf(root1, "pron1pl"));
  addP("2sg", "2SG", copyWord(root2));
  if (g.dual) addP("2du", "2DU", duOf(root2));
  if (g.trial) addP("2tri", "2TRI", triOf(root2));
  if (g.paucal) addP("2pau", "2PAU", pauOf(root2));
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

  // ── pronoun CASE series (concord F4): object/oblique forms (me/him/mine).
  // Each case affix is grammaticalized from its own AFF_SRC quarry (acc←TAKE/
  // GO, dat←GIVE/GO, gen←KINC/HOUSE, obl←BELLY/EARTH) — a RECENT bound layer
  // attached to the evolved pronoun (own 'pc:'/'afsrc pc:' streams + own taken
  // Set, so nothing in the noun paradigm shifts). Pronouns are nom-acc even
  // when the nouns are ergative (they sit atop the animacy hierarchy), which is
  // where split ergativity comes from for free. ──
  const pcSet = g.pronCase === "full" ? ["acc", "dat", "gen", "obl"]
    : g.pronCase === "acc-dat" ? ["acc", "dat"] : g.pronCase === "acc" ? ["acc"] : [];
  if (pcSet.length) {
    const pcTaken = new Set();
    const pcAff = {};
    for (const cs of pcSet) {
      const src = pickSrc(fam, "pc:" + cs, AFF_SRC[cs === "obl" ? "loc" : cs], pcTaken);
      pcAff[cs] = wornAt(lang, inv, "pc:" + cs, src, birthOf(fam, "pc:" + cs, lang.rules.length)).syl;
    }
    for (const p of prons) {
      p.cases = {};
      for (const cs of pcSet) {
        const form = copyWord(p.form);
        attachSyl(prof, form, { on: pcAff[cs].on.map(x => ({ ...x })), nu: pcAff[cs].nu.map(x => ({ ...x })), co: pcAff[cs].co.map(x => ({ ...x })) }, g.affixSide);
        legalizeWord(form);
        p.cases[cs] = { w: rform(lang, form), g: p.g + "." + CASE_GLOSS[cs === "obl" ? "loc" : cs], form };
      }
    }
  }

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
      // THE GRAMMATICALIZATION TAX (review-loop): a function word may stay
      // cognate with its source, but a polysyllabic form IDENTICAL to the
      // living content word has paid nothing — usage frequency wears the
      // function word first ('with' kab ‹ kabuh 'hand', never 'with' kabuh;
      // a fresh reader caught 'and' = 'with' = the full word 'hand'). Only
      // the identity case reduces, so every clean language is byte-identical.
      if (form && form.syls.length >= 2 && rform(lang, form) === rform(lang, stem)) form = null;
      if (!form) {
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

  // ── INTERROGATIVE FUNCTIONAL LOAD (review-loop): the q-series is the one
  // closed class real languages keep clear of content homophones — a 'what'
  // that is also 'man' garden-paths every clause (and REL ‹ 'what' spreads
  // the soup to relatives). Interrogative answers are disjoint, so the
  // pressure is absolute there; pronoun/noun homophones (I/eye) stay — life
  // has those. Re-dedupe the q-words against the HIGH-FREQUENCY content
  // surfaces (b ≥ 0.8, as displayed — loans included) and the finalized
  // closed classes; only colliding forms move, so every clean language is
  // byte-identical. Runs BEFORE compz/relz copy 'what', keeping them cognate
  // with the FINAL form. ──
  const hiFreqSeed = [];
  for (let cid = 0; cid < CONCEPTS.length; cid++)
    if (CONCEPTS[cid].b >= 0.8) hiFreqSeed.push({ w: wordOf(lang, cid) });
  dedupe(lang, inv, qs, [...hiFreqSeed, ...prons, ...dems, neg, ...conj, ...adps,
    ...(qp ? [qp] : []), ...(impPart ? [impPart] : []), ...(prohibW ? [prohibW] : [])]);

  // ── T-V POLITENESS (Group E, WALS 45A): the polite 2nd person is either the
  // PLURAL pronoun (the vous machine — 2v == the FINAL 2pl, so built after the
  // dedupes and kept OUT of them, like 'and' keeps its comitative identity) or
  // worn from a noble address (the usted machine ‹ LORD/NOBLE); 'multi' adds 2vv ──
  if (g.tv !== "none") {
    const twoV = g.tvSource === "plural"
      ? (() => { const p2 = prons.find(p => p.k === "2pl"); return { form: copyWord(p2.form), w: p2.w }; })()
      : (() => { const f = legalizeWord({ syls: [wearSyl(prof, nativeStemOf(lang, h01(fam, "vsrc") < 0.5 ? LORD : NOBLE))] }); return { form: f, w: rform(lang, f) }; })();
    prons.push({ k: "2v", g: "2SG.POL", form: twoV.form, w: twoV.w });
    if (g.tv === "multi") {
      const f = legalizeWord({ syls: [wearSyl(prof, nativeStemOf(lang, HIGH))] });
      prons.push({ k: "2vv", g: "2SG.HON", form: f, w: rform(lang, f) });
    }
  }

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

  // ── isolating VOICE (Group B): periphrastic light verbs — a causative
  // 让/使, a passive 被-style marker — the exponent a non-affixing tongue uses ──
  const voiceLV = {};
  if (lang.prof.morph === "iso") {
    if (g.caus) { const f = legalizeWord(R(synthClosed(lang, inv, "voice:caus"))); voiceLV.caus = { g: "CAUS", w: rform(lang, f), form: f }; }
    if (g.pass) { const f = legalizeWord(R(synthClosed(lang, inv, "voice:pass"))); voiceLV.pass = { g: "PASS", w: rform(lang, f), form: f }; }
  }

  // ── MULTI-CLAUSE LINKERS (Group G): the complementizer / relativizer / 'when'
  // subordinator, grammaticalized from existing words (SAY / distal dem / wh /
  // DAY). Built LAST with a FRESH `seen` seeded from the finalized closed classes
  // (never the line-~640 cross-class array, which would retint the pinned Q
  // particle). A linker may stay HOMOPHONOUS with its own source (that/that) but
  // must not collide with an unrelated form; the 'when' subordinator must differ
  // from the interrogative 'when' (both ‹ DAY, distinct grammaticalizations). ──
  const whatQ = qs.find(q => q.k === "what");
  const compz = (() => {
    const [form, src] = g.compzSrc === "say" ? [legalizeWord({ syls: [wearSyl(prof, nativeStemOf(lang, SAY))] }), "say"]
      : g.compzSrc === "dem" ? [copyWord(far.form), "that"] : [copyWord(whatQ.form), "what"];
    return { k: "comp", g: "COMP", form, w: rformNeutral(lang, form), src };
  })();
  const relz = (() => {
    const [form, src] = g.relzSrc === "dem" ? [copyWord(far.form), "that"] : [copyWord(whatQ.form), "what"];
    return { k: "rel", g: "REL", form, w: rformNeutral(lang, form), src };
  })();
  const whenSub = { k: "when", g: "when", form: legalizeWord({ syls: [wearSyl(prof, nativeStemOf(lang, DAY))] }), w: null, src: "day" };
  whenSub.w = rformNeutral(lang, whenSub.form);
  const closedForms = [...prons, ...dems, ...qs, ...conj, ...(qp ? [qp] : [])];
  const seedMinus = (srcForm) => closedForms.filter(x => x !== srcForm);
  dedupe(lang, inv, [compz], seedMinus(g.compzSrc === "dem" ? far : g.compzSrc === "wh" ? whatQ : null));
  dedupe(lang, inv, [relz], seedMinus(g.relzSrc === "dem" ? far : whatQ));
  dedupe(lang, inv, [whenSub], closedForms);   // ≠ the interrogative 'when' (and every other closed form)

  c.closed = { prons, dems, neg, qs, conj, adps, defArt, indefArt, qp, impPart, prohibW, voice: voiceLV, links: { comp: compz, rel: relz, when: whenSub } };
  return c.closed;
}

/** A pronoun in a given case (concord F4). `cas ∈ nom|acc|dat|gen|obl`;
 *  falls back to the nominative where the language lacks that case (or lacks a
 *  case system). `{ w, g }`. Graceful key degrade like renderClause. */
export function pronoun(lang, k, cas = "nom") {
  const cl = closedOf(lang);
  const cell = cl.prons.find(p => p.k === k)
    || cl.prons.find(p => p.k === String(k).replace(/[mf]$/, ""))
    || cl.prons.find(p => p.k[0] === String(k)[0]) || cl.prons[0];
  if (cas !== "nom" && cell.cases && cell.cases[cas]) return { w: cell.cases[cas].w, g: cell.cases[cas].g, form: cell.cases[cas].form };
  return { w: cell.w, g: cell.g, form: cell.form };
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

// ── NUMERAL CLASSIFIERS (Group D) ─────────────────────────────────────────
// The inventory mirrors the adposition block: each classifier is worn from a
// body/shape noun over the EVOLVED stem (a recent grammatical layer, no extra
// replay — sisters cognate for free because nativeStemOf is already carried
// through this language's rule tail). Realization is deliberately morphotype-
// INVARIANT: a classifier is always a free light word, never an affix.
function classifierInventory(lang) {
  const c = gc(lang);
  if (c.clf !== undefined) return c.clf;   // null (non-classifier) is a valid cached value
  const g = gramOf(lang);
  if (!g.classif) { c.clf = null; return null; }
  const inv = compiledInv(lang), prof = lang.prof, fam = lang.famSeed ?? lang.seed;
  const usedSrc = new Map();       // one quarry worn to two grains for two classes
  const classes = {}, forms = [];
  for (const cls of g.classif.classes) {
    let r = h01(fam, "clf", cls), src = null;
    for (const [cid, p] of CLF_SRC[cls]) { r -= p; if (r < 0) { src = cid; break; } }
    let form;
    if (src == null) form = legalizeWord(synthClosed(lang, inv, "clf:" + cls));
    else {
      form = legalizeWord({ syls: [wearSyl(prof, nativeStemOf(lang, src))] });
      const reuse = usedSrc.get(src) || 0; usedSrc.set(src, reuse + 1);
      if (reuse > 0) { retint(form, vowFar(inv.vows)); legalizeWord(form); }
    }
    const e = { cls, src, form, w: rform(lang, form), g: "CL." + cls };
    classes[cls] = e; forms.push(e);
  }
  dedupe(lang, inv, forms);        // pairwise-distinct (mutates .form/.w)
  c.clf = { classes, order: g.classif.order, obl: g.classif.obl };
  return c.clf;
}

/** The language's sortal classifiers (Group D) — null for a non-classifier
 *  language, else { order, obl, classes:[{cls,w}] }. */
export function classifiersOf(lang) {
  const inv = classifierInventory(lang);
  return inv ? { order: inv.order, obl: inv.obl, classes: Object.values(inv.classes).map(e => ({ cls: e.cls, w: e.w })) } : null;
}
/** Where each classifier grammaticalized from (the body/shape noun, or opaque). */
export function classifierEtymologies(lang) {
  const inv = classifierInventory(lang);
  return inv ? Object.values(inv.classes).map(e => ({ cls: e.cls, w: e.w, from: e.src != null ? glossOf(e.src) : null })) : [];
}
/** A noun's sortal SENSE (world-knowledge, language-independent): humans →
 *  'hum', shapes → 'long'/'flat'/'round', animals free from the 'anm' domain,
 *  the rest → 'gen'. Ambiguous nouns keep their domain sense here; the per-family
 *  salient reading is resolved in classifierFor. */
export function classifSenseOf(cid) {
  if (CLF_SENSE.has(cid)) return CLF_SENSE.get(cid);
  const con = CONCEPTS[cid];
  return con && con.d === "anm" ? "anm" : "gen";
}
/** The classifier this language uses for a noun: its sense (with a per-family
 *  salience roll for genuinely ambiguous nouns) mapped onto the inventory, with
 *  the general classifier as the fallback. Null for a non-classifier language. */
export function classifierFor(lang, cid) {
  const inv = classifierInventory(lang);
  if (!inv) return null;
  let sense = classifSenseOf(cid);
  const amb = CLF_AMBIG.get(cid);
  if (amb) sense = amb[h01(lang.famSeed ?? lang.seed, "clfsense", cid) < 0.5 ? 0 : 1];
  const e = inv.classes[sense] || inv.classes.gen;
  return { cls: e.cls, w: e.w, g: e.g, form: e.form };
}

/** The [Num (CL) N] numeral phrase (Group D). In a classifier language the
 *  classifier sits between numeral and noun (per classif.order) and the noun
 *  stays caseless; otherwise the noun pluralizes (n≠1 and the language marks
 *  plural) and the numeral orders by AdjN (Greenberg U18). Owns the COUNT core
 *  only — np() wraps it with adjective/article. `useClf:false` drops an optional
 *  classifier; an obligatory system keeps it. → { tokens, text, gloss } */
export function numeralPhrase(lang, cid, n, { cas = null, useClf = true } = {}) {
  const g = gramOf(lang);
  const numToks = numeral(lang, n).parts.map(p => ({ w: p.w, g: p.g, role: "NUM" }));
  const nounToks = (num, cs) => {
    const nx = inflectNoun(lang, cid, { num, cas: cs });
    return [...nx.pre, { w: nx.text, g: nx.gloss }, ...nx.post].map(t => ({ w: t.w, g: t.g, role: "N" }));
  };
  if (g.classif) {
    const count = (g.classif.obl || useClf) ? [...numToks, (() => { const clf = classifierFor(lang, cid); return { w: clf.w, g: clf.g, role: "CLF" }; })()] : numToks;
    const nt = nounToks("sg", null);   // classifier languages keep the noun caseless + number-neutral
    const toks = g.classif.order === "pre" ? [...count, ...nt] : [...nt, ...count];
    return { tokens: toks, text: toks.map(t => t.w).join(" "), gloss: toks.map(t => t.g).join(" ") };
  }
  const nt = nounToks(n !== 1 && g.pluralMark ? "pl" : "sg", cas);
  const toks = g.adjN ? [...numToks, ...nt] : [...nt, ...numToks];
  return { tokens: toks, text: toks.map(t => t.w).join(" "), gloss: toks.map(t => t.g).join(" ") };
}

// ── COMPARISON (Group E): comparative / superlative / equative ────────────
// The standard marker is worn from the language's own stock: the separative
// 'than' ‹ its own 'from' adposition, the exceed-verb ‹ EXCEED, the equative
// ‹ SAME, 'more' ‹ MANY, 'most' ‹ ALL/MANY. Cached like closedOf.
function degreeMarkers(lang) {
  const c = gc(lang);
  if (c.degm) return c.degm;
  const g = gramOf(lang), inv = compiledInv(lang), cl = closedOf(lang), prof = lang.prof, fam = lang.famSeed ?? lang.seed;
  const wear = (cid) => legalizeWord({ syls: [wearSyl(prof, nativeStemOf(lang, cid))] });
  const more = g.compar.more === "none" ? null
    : g.compar.more === "affix" ? { w: renderAffix(lang, wear(MANY).syls[0]), g: "more", affix: true }
    : { w: rform(lang, wear(MANY)), g: "more", affix: false };
  const most = { w: rform(lang, wear(h01(fam, "most") < 0.5 ? ALL : MANY)), g: "most" };
  const than = g.compar.type === "sep" ? (() => { const a = cl.adps.find(x => x.m === "from") || cl.adps[0]; return { w: a.w, g: "than", sep: true }; })()
    : g.compar.type === "exceed" ? { w: rform(lang, wear(EXCEED)), g: "exceed" }
    : { w: rformNeutral(lang, legalizeWord(applyRules(lang.rules, synthClosed(lang, inv, "than")))), g: "than" };
  const same = { w: rform(lang, wear(SAME)), g: "same" };
  c.degm = { more, most, than, same };
  return c.degm;
}

/** A comparison phrase (Group E): a standalone renderer (like intensive/numeral),
 *  NOT a clause-frame change. degree: 'cmpr' (A more-tall than B) | 'sup' (most
 *  tall) | 'eq' (tall as B). Word order tracks stdFirst (the standard precedes in
 *  OV). → { tokens, text, gloss } */
export function comparative(lang, adjCid, standardCid, { degree = "cmpr" } = {}) {
  const g = gramOf(lang), dm = degreeMarkers(lang);
  const pack = (ts) => ({ tokens: ts, text: ts.map(t => t.w).join(" "), gloss: ts.map(t => t.g).join(" ") });
  const adjTok = { w: wordOf(lang, adjCid), g: glossOf(adjCid) };
  const std = { w: wordOf(lang, standardCid != null ? standardCid : MANY), g: standardCid != null ? glossOf(standardCid) : "other" };
  if (degree === "sup") {
    if (lang.prof.morph === "tmpl") return pack([{ w: renderWord(legalizeWord(repattern(lang, copyWord(nativeStemOf(lang, adjCid)), "comp")), lang.prof), g: glossOf(adjCid) + "⟨SUP⟩" }]);
    return pack([{ w: dm.most.w, g: "most" }, adjTok]);
  }
  if (degree === "eq") return pack([adjTok, { w: dm.same.w, g: "same" }, std]);
  // comparative: the adjective, optionally carrying a 'more' marker
  const adjMore = dm.more && dm.more.affix ? [{ w: adjTok.w + dm.more.w, g: adjTok.g + "-more" }]
    : dm.more ? [{ w: dm.more.w, g: "more" }, adjTok] : [adjTok];
  if (g.compar.type === "exceed") return pack([...adjMore, { w: dm.than.w, g: "exceed" }, std]);
  // separative / particle: the standard carries 'than' (separative fuses to it)
  const stdMarked = dm.than.sep
    ? (g.adpSide === "post" ? [std, { w: dm.than.w, g: "than" }] : [{ w: dm.than.w, g: "than" }, std])
    : [{ w: dm.than.w, g: "than" }, std];
  return pack(g.compar.stdFirst ? [...stdMarked, ...adjMore] : [...adjMore, ...stdMarked]);
}

/** The T-V (politeness) pronoun set (Group E) — null for a language with no
 *  distinction, else { tv, source, familiar, polite, honorific }. */
export function tvPronouns(lang) {
  const g = gramOf(lang);
  if (g.tv === "none") return null;
  const cl = closedOf(lang);
  const at = (k) => { const p = cl.prons.find(x => x.k === k); return p ? p.w : null; };
  const fam = at("2sg"), pol = at("2v") || fam;
  return { tv: g.tv, source: g.tvSource, familiar: fam, polite: pol, honorific: at("2vv") || pol };
}
/** A verb in its honorific form (Group E) — null where the language marks none. */
export function honorificVerb(lang, cid, { tam = null, pers = null } = {}) {
  return gramOf(lang).honVerb ? inflectVerb(lang, cid, { tam, pers, hon: true }) : null;
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
const CASE_GLOSS = { acc: "ACC", erg: "ERG", gen: "GEN", dat: "DAT", loc: "LOC", abl: "ABL", ins: "INS", all: "ALL", com: "COM", ess: "ESS", term: "TERM", ade: "ADE", ela: "ELA", agt: "AGT", pat: "PAT" };
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
  // alignment (Group F): active AGT/PAT core cases + the inverse marker
  agt: [[HAND, 0.4], [null, 0.6]],                 // agentive S/A — like the ergative
  pat: [[TAKE, 0.5], [GO, 0.2], [null, 0.3]],      // patientive S/O — like the accusative
  inv: [[BACK, 0.5], [null, 0.5]],                 // the inverse-direction verb marker
  // voice (Group B): valency-changing verbal markers
  caus: [[MAKE, 0.4], [DO, 0.25], [GIVE, 0.15], [null, 0.2]],   // 'make/do/give' → causative
  pass: [[FALL, 0.25], [COME, 0.2], [EAT, 0.15], [null, 0.4]],  // 'fall/come/be-eaten' → passive
  apass: [[DO, 0.3], [MAN, 0.2], [null, 0.5]],                  // antipassive (ergative mirror)
  // TAM depth (Group C′): graded tense, richer aspect, irrealis moods, mirativity
  rec: [[NEW, 0.35], [COME, 0.25], [null, 0.4]],                // recent past ‹ 'new/come'
  rem: [[FAR, 0.4], [NIGHT, 0.2], [null, 0.4]],                 // remote past ‹ 'far/night'
  farfut: [[FAR, 0.35], [GO, 0.25], [null, 0.4]],               // remote future ‹ 'far/go'
  prf: [[FINISH, 0.4], [HAVE, 0.25], [null, 0.35]],             // perfect ‹ 'finish/have'
  prog: [[SIT, 0.3], [STAND, 0.2], [BELLY, 0.15], [null, 0.35]], // progressive ‹ posture/locative
  hab: [[GO, 0.3], [BE, 0.2], [null, 0.5]],                     // habitual
  opt: [[WANT, 0.55], [null, 0.45]],                            // optative ‹ 'want'
  pot: [[KNOW, 0.4], [TAKE, 0.2], [null, 0.4]],                 // potential ‹ 'know/can'
  cond: [[GO, 0.3], [WANT, 0.2], [null, 0.5]],                  // conditional
  sbjv: [[COME, 0.2], [null, 0.8]],                             // subjunctive (mostly opaque)
  mir: [[SEE, 0.25], [FINISH, 0.25], [null, 0.5]],             // mirative
  // nominal categories (Group E): extra number, honorific verb
  tri: [[THREE, 1]],                                           // trial ‹ 'three' (parallel to dual ‹ 'two')
  pau: [[LITTLE, 0.5], [MANY, 0.2], [null, 0.3]],              // paucal ‹ 'few/little'
  hon: [[GIVE, 0.4], [null, 0.6]],                             // honorific/humble verb ‹ 'give' (benefactive)
};
const MOOD_ORDER = ["sbjv", "cond", "opt", "pot"];              // frequency ranking (like CASE_ORDER)
const MOOD_GLOSS = { sbjv: "SBJV", cond: "COND", opt: "OPT", pot: "POT" };
const PRIMARY_TAM = new Set(["pst", "fut", "pfv", "ipfv"]);     // tmpl pattern-swaps ONLY these; secondary route through affixes
const GRADE = { pstrec: ["pst", "rec"], pstrem: ["pst", "rem"], futrem: ["fut", "farfut"] };
// ── EVIDENTIALITY (Group C): the source-of-information quarries. Each overt
// value is a worn-down perception/speech verb (SEE→visual, HEAR→other-sensory,
// SAY→reportative, SEEM→inferential), replayed through the onion so sisters
// share cognate evidentials that drift. `dir` (firsthand) is zero under the
// zeroDirect norm; when overt it is mostly opaque (an old bleached formative).
// AFF_SRC-shaped: [concept, weight] with null = an opaque own formative. ──
const EVID_SRC = {
  vis: [[SEE, 0.7], [null, 0.3]],                              // visual (I saw it)
  sens: [[HEAR, 0.75], [null, 0.25]],                          // non-visual sensory (I heard/felt it)
  infr: [[SEEM, 0.4], [KNOW, 0.25], [SEE, 0.15], [null, 0.2]], // inferred (it seems / from traces)
  rept: [[SAY, 0.65], [MOUTH, 0.1], [null, 0.25]],             // reported (they say)
  indir: [[SEEM, 0.3], [SAY, 0.2], [HEAR, 0.2], [null, 0.3]],  // 2-term non-firsthand catch-all
  dir: [[SEE, 0.3], [null, 0.7]],                              // firsthand, overt only when !zeroDirect
  mir: [[SEEM, 0.35], [SEE, 0.2], [FALL, 0.15], [null, 0.3]],  // dedicated mirative (F3)
};
const EVID_VALUES = { 2: ["dir", "indir"], 3: ["dir", "infr", "rept"], 4: ["vis", "sens", "infr", "rept"] };
const EVID_GLOSS = { dir: "DIR", vis: "VIS", indir: "INDIR", sens: "SENS", infr: "INFR", rept: "REP", mir: "MIR" };
// map a requested frame evidential onto what a system of size n actually marks
// (graceful cross-size degrade; mirrors the pronoun degrade in renderClause)
function evidMap(n, ev) {
  if (!ev) return null;
  if (n === 4) return ev === "dir" ? "vis" : ev;                                // firsthand → visual
  if (n === 3) return (ev === "vis" || ev === "sens") ? "dir" : ev;             // sensory collapses to firsthand
  return (ev === "vis" || ev === "sens" || ev === "dir") ? "dir" : "indir";     // n===2: firsthand vs not
}

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
  for (const k of ["pl", "du", "tri", "pau", "pfv", "ipfv", "pst", "fut", "agr", "negaf", "poss", "hon", ...CASE_ORDER, "erg"]) births[k] = birthOf(fam, k, len);
  // the number tier (innermost): pl/du + the Corbett extras (trial/paucal)
  const t0n = Math.max(g.pluralMark ? births.pl : 0, g.dual ? births.du : 0, g.trial ? births.tri : 0, g.paucal ? births.pau : 0);
  // possession sits BETWEEN number and case (number < poss < case), so a
  // possAffix language's plain case paradigm is reordered by the POSS slot even
  // absent a possessor (diachronically coherent — the slot exists regardless)
  if (g.possAffix) births.poss = Math.max(births.poss, t0n);
  const caseFloor = g.possAffix ? births.poss : t0n;
  for (const k of [...CASE_ORDER, "erg"]) births[k] = Math.max(births[k], caseFloor);
  const t0v = g.aspect ? Math.max(births.pfv, births.ipfv) : 0;
  births.pst = Math.max(births.pst, t0v);
  births.fut = Math.max(births.fut, t0v);
  births.hon = Math.max(births.hon, t0v);   // the honorific verb sits in the TAM tier
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
  const spec = { iso, cases: [], pl: null, du: null, tri: null, pau: null, possAff: null, tam: {}, pers: null, persObj: null, negAff: null, imp: null, inv: null, dist: {}, moods: {}, mir: null, evid: null, honAff: null, conv: null, nf: null, partcp: null, ssAff: null, dsAff: null, themes: [], vThemes: [], particles: {} };
  if (g.pluralMark) spec.pl = mkAff("pl", "PL", null, [[plSrc, 1]]);
  if (g.dual) spec.du = mkAff("du", "DU");
  // core case(s): active spends two slots on AGT/PAT, tripartite on ERG/ACC
  // (the second core displaces the genitive, per the caseN=2 note); nom-acc and
  // erg keep ONE core, so their caseKeys — and every existing paradigm — are
  // byte-identical
  const coreKeys = g.align === "active" ? ["agt", "pat"]
    : g.align === "tripartite" ? ["erg", "acc"] : [g.align === "erg" ? "erg" : "acc"];
  const caseKeys = g.caseN === 0 ? [] : g.caseN === 1 ? ["gen"]
    : [...coreKeys, ...CASE_ORDER.slice(1)].slice(0, g.caseN);
  for (const k of caseKeys) spec.cases.push(mkAff(k, CASE_GLOSS[k], k));
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
    // OBJECT INDEX (agree === 'both'): its OWN affix series, worn from
    // independent object-pronoun roots on their own streams — real
    // polypersonal paradigms keep the A-set and O-set distinct (Swahili
    // a-/m-, Quechua -n/-yki, Semitic -hu/-ka). The old shortcut reused the
    // subject set, so 3SG+3SG.O stacked the same syllable twice and
    // renderWord's haplology ATE it while the gloss kept claiming 3SG.O (a
    // fresh reader caught the identical transitive/intransitive forms). The
    // series is OUTER, like the Semitic object clitics — it rides outside
    // the fusional crush, so the portmanteau can never silently drop it.
    // 3sg.O is frequently ZERO, like life ('he saw (it)'); a zero or
    // ground-to-silence cell is null and simply never glossed. Deduped in
    // its OWN pass against the finalized subject set — nothing upstream
    // shifts, and the two series can never collide.
    if (g.agree === "both") {
      const oAffs = {};
      const oRoots = { 1: synthClosed(lang, inv, "opron1"), 2: synthClosed(lang, inv, "opron2"), 3: synthClosed(lang, inv, "opron3") };
      for (const p of [1, 2, 3]) {
        const r = copyWord(oRoots[p]);
        evolveSlice(lang.rules, 0, t, r);
        const cand = { k: "o" + p + "sg", g: p + "SG.O", src: null, t, syl: wearSyl(lang.prof, legalizeWord(r)), outer: true };
        oAffs[p + "sg"] = (p === 3 && h01(fam, "z3o") < 0.5) || !audible(cand) ? null : cand;
      }
      dedupeAffixSet(lang, inv, Object.values(oAffs).filter(Boolean), Object.values(persAff).filter(Boolean));
      spec.persObj = oAffs;
    }
  }
  // NUMBER extras (Group E, Corbett): trial ‹ 'three', paucal ‹ 'few' — number-
  // tier affixes parallel to the dual (a noun takes ONE number value). Claimed
  // after every existing source-affix; THREE/LITTLE collide with nothing above.
  if (g.trial) spec.tri = mkAff("tri", "TRI");
  if (g.paucal) spec.pau = mkAff("pau", "PAU");
  // paradigm-internal contrast: number+case affixes against each other, TAM
  // affixes against each other (persons handled above)
  // one contrast pass over ALL bound affixes, nominal and verbal together —
  // a suffix serving as both PL and PST (a fresh reader caught -fe doing
  // exactly that) makes the interlinear gloss read two ways, so the later
  // affix shifts. Person markers are their own agreement paradigm, deduped
  // above; they may legitimately echo a case marker and are left alone.
  // direct-inverse: the inverse-direction marker (BACK) — an outer late
  // formative, claimed AFTER every existing affix so the shared `taken` set and
  // the dedupe below stay byte-identical for every language that lacks it
  if (g.invAgree) spec.inv = mkAff("inv", "INV");
  // ── VOICE affixes (Group B): valency markers, claimed AFTER every existing
  // affix (the shared-`taken` landmine); iso stays periphrastic (no bound
  // exponent). The applicative source is COGNATE with the matching adposition. ──
  spec.voice = {};
  if (!iso && g.caus) spec.voice.caus = mkAff("caus", "CAUS");
  if (!iso && g.pass) spec.voice.pass = mkAff("pass", "PASS");
  if (g.antip) spec.voice.antip = mkAff("antip", "ANTIP", "apass");
  if (g.appl) spec.voice.appl = mkAff("appl", "APPL", null, [[adpSourceOf(lang, APPL_MEANING[g.applOf]), 1]]);
  // ── TAM DEPTH (Group C′): graded tense (spec.dist), richer aspect
  // (prf/prog/hab), irrealis moods (spec.moods) — all claimed AFTER voice ──
  if (g.remotePast >= 1) spec.dist.rem = mkAff("rem", "REM");           // remote past ('long ago')
  if (g.remotePast >= 2) spec.dist.rec = mkAff("rec", "REC");           // + recent past (hodiernal)
  if (g.remoteFuture >= 1) spec.dist.farfut = mkAff("farfut", "REM");   // remote future
  if (g.perfect) spec.tam.prf = mkAff("prf", "PRF");
  if (g.progressive) spec.tam.prog = mkAff("prog", "PROG");
  if (g.habitual) spec.tam.hab = mkAff("hab", "HAB");
  for (const mk of g.moods) spec.moods[mk] = mkAff(mk, MOOD_GLOSS[mk]);
  // ── EVIDENTIALITY affixes (Group C): the OUTERMOST, youngest verbal layer,
  // worn from perception/speech verbs. Claimed AFTER every existing affix (the
  // shared-`taken` landmine, §0.3) so no upstream pick shifts; firsthand is
  // zero under the zeroDirect norm. `outer:true` keeps them out of the fusional
  // crush (a young peripheral tier). BLOCKING FIX: register births.ev ≥ births.agr
  // BEFORE mkAff (else wornAt reads undefined → NaN poisons the onion). ──
  const evidAffs = [];
  if (g.evid) {
    spec.evid = {};
    const claim = (key, gloss, pool) => {
      births["ev:" + key] = Math.max(birthOf(fam, "ev:" + key, len), births.agr);
      const aff = mkAff("ev:" + key, gloss, null, pool);
      aff.outer = true;
      return aff;
    };
    for (const val of EVID_VALUES[g.evid.n]) {
      if (val === "dir" && g.evid.zeroDirect) continue;   // firsthand zero-marked (the norm)
      const aff = claim(val, EVID_GLOSS[val], EVID_SRC[val]);
      spec.evid[val] = aff;
      evidAffs.push(aff);
    }
    if (g.evid.mir === "dedicated") {   // a fresh mirative exponent on the evidential slot (F3)
      const ma = claim("mir", "MIR", EVID_SRC.mir);
      spec.evid.mir = ma;
      evidAffs.push(ma);
    }
  }
  dedupeAffixSet(lang, inv, [spec.pl, spec.du, spec.tri, spec.pau, ...spec.cases,
    spec.tam.pst, spec.tam.fut, spec.tam.pfv, spec.tam.ipfv, spec.imp, spec.inv,
    spec.voice.caus, spec.voice.pass, spec.voice.antip, spec.voice.appl,
    spec.dist.rem, spec.dist.rec, spec.dist.farfut, spec.tam.prf, spec.tam.prog, spec.tam.hab,
    ...Object.values(spec.moods)].filter(Boolean));
  // evidentials are their OWN outer paradigm (like person agreement, deduped
  // separately above): they contrast among THEMSELVES with a fresh `seen`, and
  // may legitimately echo a case/tam marker in a different slot. Folding them
  // into the cross-class sweep exhausts its single-syllable escape space (a
  // many-case language's ~20 endings) and collapses them — so keep them apart.
  if (evidAffs.length) dedupeAffixSet(lang, inv, evidAffs);
  // POSSESSION (Group E): possessive affixes worn from the SAME pronoun roots as
  // person agreement + the free pronouns (so my-house is cognate with I/me), at
  // the poss tier (inner to case); 3sg is non-zero (a possessor is always overt).
  // Built AFTER the main dedupe and deduped against the FINAL case forms (POSS +
  // CASE co-occur on one noun), in its OWN pass (like person agreement).
  if (g.possAffix) {
    const t = births.poss;
    const possAff = {};
    const roots = { 1: synthClosed(lang, inv, "pron1"), 2: synthClosed(lang, inv, "pron2"), 3: synthClosed(lang, inv, "pron3") };
    const plW = rootFormOf(lang, plSrc).w;
    for (const p of [1, 2, 3]) {
      const r = copyWord(roots[p]);
      evolveSlice(lang.rules, 0, t, r);
      const sg = wearSyl(lang.prof, legalizeWord(r));
      possAff[p + "sg"] = { k: "poss" + p + "sg", g: p + "SG.POSS", src: null, t, syl: sg };
      const plM = copyWord(plW);
      evolveSlice(lang.rules, 0, t, plM);
      const plSyl = wearSyl(lang.prof, legalizeWord(plM));
      const fusedPl = { on: sg.on.map(x => ({ ...x })), nu: sg.nu.map(x => ({ ...x })), co: plSyl.on.length ? [{ ...plSyl.on[0] }] : plSyl.co.map(x => ({ ...x })) };
      possAff[p + "pl"] = { k: "poss" + p + "pl", g: p + "PL.POSS", src: null, t, syl: fusedPl };
    }
    dedupeAffixSet(lang, inv, Object.values(possAff), [spec.pl, spec.du, spec.tri, spec.pau, ...spec.cases].filter(Boolean));
    spec.possAff = possAff;
  }
  // POLITENESS (Group E): an honorific/humble verb affix ‹ 'give' (benefactive),
  // a verbal exponent in the TAM tier, deduped against the finalized tense/imp
  if (g.honVerb) {
    const ha = mkAff("hon", "HON");
    dedupeAffixSet(lang, inv, [ha], [spec.tam.pst, spec.tam.fut, spec.tam.pfv, spec.tam.ipfv, spec.imp].filter(Boolean));
    spec.honAff = ha;
  }
  // mirative built AFTER the dedupe: it SHARES the perfect exponent (the -miş
  // syncretism) via a deep-cloned syl, or is its own small marker
  if (g.mirative) spec.mir = g.perfect && spec.tam.prf
    ? { k: "mir", g: "MIR", src: spec.tam.prf.src, t: spec.tam.prf.t, syl: cloneMarkSyl(spec.tam.prf.syl) }
    : mkAff("mir", "MIR");
  // ── MULTI-CLAUSE affixes (Group G): converb (adverbial/chaining medial verb),
  // nominalizer (agglutinative complement), participle (relative gap), switch-
  // reference SS/DS. Opaque late formatives, built LAST in their OWN dedupe pass
  // (never the shared taken/cross-class sweep, §0.3), only where dials call. ──
  if (!iso) {
    const tv = Math.max(births.agr, t0v);
    const mkSyn = (key, gloss) => { const root = synthClosed(lang, inv, "mc:" + key); evolveSlice(lang.rules, 0, tv, root); return { k: key, g: gloss, src: null, t: tv, syl: wearSyl(lang.prof, legalizeWord(root)) }; };
    const mcAffs = [];
    if (g.advAffix || g.chaining) {   // the shared converb form (reused by adverbial + chaining)
      spec.conv = { temp: mkSyn("cvtemp", "when.CVB"), cond: mkSyn("cvcond", "if.CVB"), caus: mkSyn("cvcaus", "because.CVB") };
      mcAffs.push(...Object.values(spec.conv));
    }
    if (g.compFinite === false) { spec.nf = mkSyn("nf", "NMLZ"); mcAffs.push(spec.nf); }
    spec.partcp = mkSyn("partcp", "PTCP"); mcAffs.push(spec.partcp);
    if (g.switchRef) { spec.ssAff = mkSyn("ss", "SS"); spec.dsAff = mkSyn("ds", "DS"); mcAffs.push(spec.ssAff, spec.dsAff); }
    dedupeAffixSet(lang, inv, mcAffs, [...spec.cases, ...Object.values(spec.tam), spec.imp, spec.honAff].filter(Boolean));
  }
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
// crush keeps only the CONSONANTAL SKELETON (theme vowels flatten nuclei) —
// and in a HARMONY tongue the affix vowel is retinted by every stem, so a
// vowel-only contrast is neutralized at attach time (-bi vs -bu both come
// out -bu on a back stem). Both cases must contrast consonantally, and
// colliders walk the consonant inventory — contrast maintenance, the same
// pressure that keeps real paradigms apart. Everyone else contrasts whole
// syllables and walks vowels.
function dedupeAffixSet(lang, inv, affs, seed = []) {
  const fus = lang.prof.morph === "fus" || lang.prof.harmony !== "none";
  const seen = new Set();
  const sigOf = (a) => fus
    ? renderWord({ syls: [{ on: a.syl.on.map(x => ({ ...x })), nu: [], co: a.syl.co.map(x => ({ ...x })) }] }, lang.prof) || "∅"
    : renderWord({ syls: [a.syl] }, lang.prof);
  const consPool = inv.cons.filter(x => x.p < 6 && x.m <= 5);
  const codaPool = inv.cons.filter(x => x.p < 6 && (x.m === 1 || x.m === 4 || x.m === 5 || (x.m === 2 && x.l === 0)));
  for (const a of seed) if (a) seen.add(sigOf(a));   // seed the collision set WITHOUT mutating the seed forms
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
  for (const key of ["pst", "fut", "pfv", "ipfv", "pl", "comp"]) {
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
    // OUTER affixes (a young peripheral tier — the evidential) stay OUT of the
    // crush and re-attach after it in birth order (a no-op when none exist, so
    // every pre-evidential call stays byte-identical).
    const inner = list.filter(e => !e.outer), outer = list.filter(e => e.outer);
    if (inner.length > 1) {
      const t0 = inner[0].t;
      const stack = crush(inner.map(e => e.syl));
      if (theme != null && stack.length) stack[0].nu = [{ ...theme, n: 0, lg: 0 }];
      list = [{ t: t0, syl: stack[0], g: inner.map(e => e.g).join(".") }, ...outer];
    }
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

// ── noun-class assignment (Group A / concord F1) ──────────────────────────
// Class is assigned by a universal animacy/semantic SCALE, not a bare hash: a
// famSeed Fisher-Yates maps the tiers onto the used class indices (a bijection,
// so no class is empty and no two tiers collide), and the family LABELS differ
// while the STRUCTURE is universal. Small (2-3) systems split the human tier by
// natural gender (the fem/masc core); many-class (Bantu-style) systems lock
// human/animal/plant to their tiers and distribute the abstract/artifact/mass
// residue across the remaining classes by a phonological cue (mixed) — exactly
// the shape/abstract high-class buckets of a real many-class language.
const FEM_GLOSS = new Set(["mother", "woman", "queen", "daughter"]);
const MASC_GLOSS = new Set(["father", "man", "king", "son", "brother", "lord"]);
const HUMAN_GLOSS = new Set(["man", "woman", "king", "queen", "chief", "priest",
  "people", "guard", "child", "mother", "father", "son", "daughter", "brother", "kin", "lord"]);
function semTier(con) {
  if (!con) return 5;
  if (con.d === "kin" || HUMAN_GLOSS.has(con.g)) return 0;               // human
  if (con.d === "anm") return 1;                                         // animal
  if (con.d === "plt") return 2;                                         // plant
  if (con.d === "hab" || con.d === "crf") return 3;                      // made/artifact
  if (con.d === "wat" || con.d === "sky" || con.d === "lnd") return 4;   // nature/mass
  return 5;                                                              // abstract/quality
}
// per-family bijection tiers→classes (Fisher-Yates on famSeed), cached
function classPermFor(lang) {
  const c = gc(lang);
  if (c.clsperm) return c.clsperm;
  const n = gramOf(lang).genders || 1;
  const fam = lang.famSeed ?? lang.seed;
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) { const j = hash32(fam, "clsperm", i) % (i + 1); const t = a[i]; a[i] = a[j]; a[j] = t; }
  c.clsperm = a;
  return a;
}
// the phonological cue: a per-family final-segment→class map distributing the
// non-core residue across the classes the low semantic tiers don't lock.
// fus/tmpl read the final rime (Russian -a→fem); agg buckets the whole word.
function formalClass(lang, cid, con) {
  const g = gramOf(lang), perm = classPermFor(lang), n = g.genders;
  const lo = Math.min(3, n), span = n - lo;
  if (span <= 0) return perm[semTier(con) % n];              // 2-3 gender: no residue band
  const w = wordOf(lang, cid);
  const seg = lang.prof.morph === "agg" ? w : (w.match(/[aeiouy]+[^aeiouy]*$/i) || [w])[0];
  const bucket = (hash32(lang.famSeed ?? lang.seed, "clsform", seg) >>> 0) % span;
  return perm[lo + bucket];
}

/** Noun class / gender of a concept in this language (0 when genderless). */
export function genderOf(lang, cid) {
  const g = gramOf(lang);
  if (!g.genders) return 0;
  const con = CONCEPTS[cid];
  const perm = classPermFor(lang), n = g.genders, tier = semTier(con);
  if (con) {
    if (n <= 3) { if (FEM_GLOSS.has(con.g)) return perm[1 % n]; if (MASC_GLOSS.has(con.g)) return perm[0]; }
    if (tier <= (n >= 4 ? 2 : 4)) return perm[tier % n];     // semantic core locks the animate tiers
  }
  if (g.classAssign === "semantic") return perm[tier % n];   // else the residue: semantic keeps the tier class
  return formalClass(lang, cid, con);                        // mixed: the phonological cue
}

/** The noun classes this language actually uses, with member counts + samples
 *  (empty when genderless). No class is ever empty by construction. */
export function classInventory(lang) {
  const g = gramOf(lang);
  if (!g.genders) return [];
  const by = Array.from({ length: g.genders }, () => []);
  for (let cid = 0; cid < CONCEPTS.length; cid++) by[genderOf(lang, cid)].push(cid);
  return by.map((concepts, cls) => ({ cls, n: concepts.length, sample: concepts.slice(0, 6) }));
}

/** A concept's class + its semantic tier + how it was assigned (semantic vs the
 *  phonological cue). */
export function nounClassInfo(lang, cid) {
  const g = gramOf(lang), tier = semTier(CONCEPTS[cid]);
  const core = tier <= (g.genders >= 4 ? 2 : 4);
  return { cls: genderOf(lang, cid), tier, n: g.genders,
    by: !g.genders ? "none" : (core || g.classAssign === "semantic") ? "semantic" : "formal" };
}

// ── concord propagation (F2/F3): one per-class marker carried by every
// dependent of a class-c head — so an NP+verb alliterates (Bantu ki-tu ki-kubwa
// ki-le ki-anguka), the fem class quarries WOMAN (feminine ‹ woman), the rest
// are per-class cognate formatives that drift under the log. ──
// semantically-honest class gloss (fem/masc/neut vs CLn for many-class)
function classGloss(lang, cls) {
  const g = gramOf(lang);
  if (g.genders <= 3) { if (cls === genderOf(lang, WOMAN)) return "F"; if (cls === genderOf(lang, MAN)) return "M"; return "N"; }
  return "CL" + cls;
}
const cloneMarkSyl = (m) => ({ on: m.on.map(x => ({ ...x })), nu: m.nu.map(x => ({ ...x })), co: m.co.map(x => ({ ...x })) });
function concordMarks(lang) {
  const c = gc(lang);
  if (c.cmarks) return c.cmarks;
  const g = gramOf(lang);
  const marks = new Array(g.genders || 0).fill(null);
  if (g.concord) {
    const inv = compiledInv(lang), prof = lang.prof;
    const femCls = genderOf(lang, WOMAN), mascCls = genderOf(lang, MAN);
    for (let cls = 0; cls < g.genders; cls++) {
      if (g.concord.site === "fuse") {
        // a vowel ending distinguishes the classes; masc is the unmarked one
        marks[cls] = cls === mascCls ? null
          : { on: [], nu: [{ ...(cls === femCls ? vowFar(inv.vows) : vowMid(inv.vows)), n: 0, lg: 0 }], co: [] };
      } else if (cls === femCls) {
        marks[cls] = wearSyl(prof, lighten(rootFormOf(lang, WOMAN).w));          // fem ‹ woman
      } else if (cls === mascCls && g.genders <= 3) {
        marks[cls] = null;                                                       // masc unmarked
      } else {
        marks[cls] = wearSyl(prof, legalizeWord(applyRules(lang.rules, synthClosed(lang, inv, "cmark:" + cls))));
      }
    }
  }
  c.cmarks = marks;
  return marks;
}
// attach the class marker to a word form per the concord site (prefix vs suffix)
function applyConcord(lang, form, cls) {
  const m = concordMarks(lang)[cls];
  if (!m) return form;
  if (gramOf(lang).concord.site === "prefix") { form.syls.unshift(cloneMarkSyl(m)); return legalizeWord(form); }
  // suffix/fuse: append. A bare-vowel exponent landing on a vowel-final stem
  // (fem -a onto 'etya') would collapse and go inaudible — buffer with a glide
  // (-a → -ya), the same hiatus repair the compound joiner uses, so the class
  // is always heard
  const syl = cloneMarkSyl(m), last = form.syls[form.syls.length - 1];
  if (!syl.on.length && syl.nu.length && last && !last.co.length && last.nu.length)
    syl.on = [last.nu[0].b === 0 ? { ...GLIDE_Y } : { ...GLIDE_W }];
  attachSyl(lang.prof, form, syl, "suf");
  return legalizeWord(form);
}

/** An attributive adjective agreeing with its head's noun class (concord F3).
 *  Invariant (== wordOf) in genderless / non-concording tongues. */
export function inflectAdj(lang, cid, { cls = 0, num = "sg", cas = null } = {}) {
  const key = "adj:" + cid + ":" + cls + ":" + num + ":" + (cas || "");
  const c = gc(lang);
  const hit = c.cells.get(key); if (hit) return hit;
  const g = gramOf(lang);
  let out;
  if (!g.genders || !g.concord || !g.concord.adj) {
    // form rides along for the vocalizer/script layers — null when a loan
    // shadows the native word (a loan surface has no internal form)
    const f = nativeStemOf(lang, cid);
    const t = wordOf(lang, cid);
    out = { text: t, gloss: glossOf(cid), pre: [], post: [], form: t === renderWord(f, lang.prof) ? f : null };
  } else {
    const form = applyConcord(lang, copyWord(nativeStemOf(lang, cid)), cls);
    out = { text: renderWord(form, lang.prof), gloss: glossOf(cid) + "." + classGloss(lang, cls), pre: [], post: [], form };
  }
  c.cells.set(key, out);
  return out;
}

/** Which dependents agree with the noun class (concord F2), or null. */
export function agreementTargets(lang) {
  const g = gramOf(lang);
  if (!g.concord) return null;
  return Object.keys(g.concord).filter(k => k !== "site" && g.concord[k]);
}
/** The per-class agreement exponents as rendered strings ("" = unmarked). */
export function concordMarkers(lang) {
  return concordMarks(lang).map((m, cls) => ({ cls, g: classGloss(lang, cls), w: m ? renderWord({ syls: [cloneMarkSyl(m)] }, lang.prof) : "" }));
}

/** Inflect a noun: { text, gloss, pre, post } — pre/post are the particle
 *  tokens an isolating tongue uses instead of affixes. */
export function inflectNoun(lang, cid, { num = "sg", cas = null, poss = null } = {}) {
  const key = "n:" + cid + ":" + num + ":" + (cas || "") + (poss ? ":p" + poss.pers + poss.num : "");
  const c = gc(lang);
  const hit = c.cells.get(key);
  if (hit) return hit;
  const spec = paradigmSpec(lang);
  const g = gramOf(lang);
  const morph = lang.prof.morph;
  const stemGloss = glossOf(cid);
  const caseAff = cas ? spec.cases.find(x => x.k === cas) : null;
  // graceful degrade: trial/paucal fall to the plural where the language doesn't
  // mark them (an honest gloss — the noun shows the plural it actually has)
  const effNum = (num === "tri" && !spec.tri) || (num === "pau" && !spec.pau) ? "pl" : num;
  const numAff = effNum === "du" ? spec.du : effNum === "tri" ? spec.tri : effNum === "pau" ? spec.pau : null;
  const numGl = effNum === "du" ? "DU" : effNum === "tri" ? "TRI" : effNum === "pau" ? "PAU" : null;
  // possession (Group E): the affix on nouns the language affixes — under an
  // alienability split, only inalienable (kin/body) nouns; alienable ones use the
  // inflectPossessed construction instead. Inner to case, outer to number.
  const con = CONCEPTS[cid];
  const affixThis = poss && spec.possAff && (!g.alienSplit || (con && (con.d === "kin" || con.d === "bod")));
  const possAff = affixThis ? spec.possAff[poss.pers + poss.num] : null;
  const redupPl = effNum === "pl" && redupHas(lang, "plural");
  let out;
  if (redupPl) {
    let text = redupStemSurface(lang, cid, g.redup.type);
    const post = [], gls = [];
    // the MIRRORED form for the vocalizer/script layers: the text above is
    // string-assembled (hyphens, rendered-part concatenation), so the form
    // is built by honest syllable append and the cell is flagged `seam`
    const stem = nativeStemOf(lang, cid);
    const red = g.redup.type === "full" || !stem.syls[0] || !stem.syls[0].on.length
      ? stem.syls.map(cloneSyl)
      : [{ on: stem.syls[0].on.map(x => ({ ...x })), nu: stem.syls[0].nu.slice(0, 1).map(v => ({ ...v, lg: 0 })), co: [] }];
    const form = { syls: [...red, ...stem.syls.map(cloneSyl)], tseed: stem.tseed };
    if (possAff && !spec.iso) { text += affixSurface(lang, possAff.syl); gls.push(possAff.g); form.syls.push(cloneSyl(possAff.syl)); }
    if (caseAff) { if (spec.iso) post.push({ w: renderWord({ syls: [caseAff.syl] }, lang.prof), g: caseAff.g, f: { syls: [caseAff.syl] } }); else { text += affixSurface(lang, caseAff.syl); gls.push(caseAff.g); form.syls.push(cloneSyl(caseAff.syl)); } }
    out = { text, gloss: stemGloss + "~PL" + (gls.length ? "-" + gls.join("-") : ""), pre: [], post, irr: false, form, seam: true };
  } else if (spec.iso) {
    // particles, not affixes: 'stone PL' — the words stay untouched
    const post = [];
    if (numAff) post.push({ w: renderWord({ syls: [numAff.syl] }, lang.prof), g: numGl, f: { syls: [numAff.syl] } });
    else if (effNum === "pl" && spec.pl) post.push({ w: renderWord({ syls: [spec.pl.syl] }, lang.prof), g: "PL", f: { syls: [spec.pl.syl] } });
    if (caseAff) post.push({ w: renderWord({ syls: [caseAff.syl] }, lang.prof), g: caseAff.g, f: { syls: [caseAff.syl] } });
    out = { text: renderWord(nativeStemOf(lang, cid), lang.prof), gloss: stemGloss, pre: [], post, irr: false, form: nativeStemOf(lang, cid) };
  } else {
    const events = [];
    const glosses = [];
    let pattern = null, irrPl = false;
    if (effNum === "pl") {
      if (morph === "tmpl" && h01(lang.famSeed ?? lang.seed, "brokenpl", cid) < 0.6) pattern = "pl";   // broken plural
      else if (morph === "fus" && con && con.b >= 0.9 && h01(lang.famSeed ?? lang.seed, "umlpl", cid) < 0.3) irrPl = true; // foot→feet
      else if (spec.pl) events.push(spec.pl);
      if (pattern || irrPl || spec.pl) glosses.push("PL");
    } else if (numAff) { events.push(numAff); glosses.push(numGl); }
    if (possAff) { events.push(possAff); glosses.push(possAff.g); }
    if (caseAff) { events.push(caseAff); glosses.push(caseAff.g); }
    const th = themeFor(lang, spec, cid);
    const form = onionBuild(lang, cid, events, { fuse: morph === "fus", theme: th && events.length ? th.theme : null, pattern, ablaut: irrPl });
    let glossStr;
    if (pattern || irrPl) glossStr = stemGloss + "⟨" + glosses[0] + "⟩" + (glosses.length > 1 ? "-" + glosses.slice(1).join("-") : "");
    else if (morph === "fus" && glosses.length > 1) glossStr = stemGloss + "-" + glosses.join(".");
    else glossStr = [stemGloss, ...glosses].join("-");
    out = { text: renderWord(form, lang.prof), gloss: glossStr, pre: [], post: [], irr: irrPl || !!pattern, form };
  }
  c.cells.set(key, out);
  return out;
}

/** The full possessive noun phrase (Group E): the affixed noun for languages
 *  that affix this noun (head-marking; under an alienability split only kin/body),
 *  else the 'N of PRON' construction (the 'of' linker + genitive possessor).
 *  → { tokens, text, gloss } */
export function inflectPossessed(lang, cid, { pers = 3, num = "sg", cas = null } = {}) {
  const g = gramOf(lang), cl = closedOf(lang);
  if (possessionType(lang, cid) === "affix") {
    const nx = inflectNoun(lang, cid, { poss: { pers, num }, cas });
    const toks = [...nx.pre, { w: nx.text, g: nx.gloss }, ...nx.post];
    return { tokens: toks, text: toks.map(t => t.w).join(" "), gloss: toks.map(t => t.g).join(" ") };
  }
  // construction: the 'of' adposition (neutral-tone) links the possessor pronoun
  const nx = inflectNoun(lang, cid, { cas });
  const of = cl.adps.find(a => a.m === "of") || cl.adps[0];
  const pr = pronoun(lang, pers + (num === "pl" ? "pl" : "sg"), "gen");
  const nTok = [...nx.pre, { w: nx.text, g: nx.gloss }, ...nx.post];
  const link = { w: rformNeutral(lang, of.form), g: "of" }, poss = { w: pr.w, g: pr.g };
  // genitive-first languages front the possessor (PRON of N); else N of PRON
  const toks = g.genN ? [poss, link, ...nTok] : [...nTok, link, poss];
  return { tokens: toks, text: toks.map(t => t.w).join(" "), gloss: toks.map(t => t.g).join(" ") };
}
/** Whether the language marks possession on this noun by an AFFIX (head-marking,
 *  and — under an alienability split — only inalienable kin/body nouns) or by a
 *  CONSTRUCTION (dependent-marking, or the alienable side of a split). */
export function possessionType(lang, cid) {
  const g = gramOf(lang);
  if (!g.possAffix) return "construction";
  const con = CONCEPTS[cid];
  return (!g.alienSplit || (con && (con.d === "kin" || con.d === "bod"))) ? "affix" : "construction";
}

/** Inflect a verb: TAM + person agreement per the language's dials.
 *  { text, gloss, pre, post, irr } — particles ride pre/post for isolating
 *  tongues (the Mandarin 'le' lives in post). */
export function inflectVerb(lang, cid, { tam = null, pers = null, num = "sg", obj = null, neg = false, mood = null, sclass = null, dir = null, voice = null, irrealisMood = null, mir = false, ev = null, hon = false, nf = false, conv = null, rel = false } = {}) {
  const key = "v:" + cid + ":" + (tam || "") + ":" + (pers || "") + ":" + num + ":" + (obj || "") + (neg ? ":n" : "") + (mood ? ":" + mood : "") + (sclass != null ? ":c" + sclass : "") + (dir ? ":d" + dir : "") + (voice ? ":v" + voice : "") + (irrealisMood ? ":m" + irrealisMood : "") + (ev ? ":e" + ev : "") + (mir ? ":mir" : "") + (hon ? ":hon" : "") + (nf ? ":nf" : "") + (conv ? ":cv" + conv : "") + (rel ? ":rel" : "");
  const c = gc(lang);
  const hit = c.cells.get(key);
  if (hit) return hit;
  const spec = paradigmSpec(lang);
  const g = gramOf(lang);
  const morph = lang.prof.morph;
  const stemGloss = glossOf(cid);
  const imperative = mood === "imp";
  // imperatives carry no tense; the ITERATIVE/continuative imperfective is
  // often reduplication (every morphotype, Chinese kàn-kan included). GRADED
  // tense expands to base-tense + a distance affix (so it inherits the base's
  // irregularity), and the extra aspects (prf/prog/hab) ride spec.tam directly.
  const tamEff = imperative ? null : (GRADE[tam] ? GRADE[tam][0] : tam);
  const distAff = imperative || !GRADE[tam] ? null : spec.dist[GRADE[tam][1]];
  const tamAff = tamEff ? spec.tam[tamEff] : null;
  const irrMoodAff = !imperative && irrealisMood ? spec.moods[irrealisMood] : null;
  // ── EVIDENTIALITY + MIRATIVITY (Group C / the shared resolveMir seam): the
  // evidential is the youngest, outermost verbal layer. Mirativity either
  // EXTENDs the inferred host (the surprise IS the indirect evidential, glossed
  // e.g. INFR.MIR — a reportative request collapses to it, the v1 limitation),
  // uses a DEDICATED evidential exponent, or falls back to the TAM marker. ──
  const evid = g.evid;
  let evVal = imperative ? null : ev, evExtend = false;
  if (!imperative && mir && evid && evid.mir === "extend") {
    evVal = evid.n >= 3 ? "infr" : "indir";   // re-read the inferred host as surprise
    evExtend = true;
  }
  const evAff = evVal && spec.evid ? spec.evid[evVal] : null;
  const evGloss = evAff ? EVID_GLOSS[evVal] + (evExtend ? ".MIR" : "") : null;
  let mirAff = null;
  if (!imperative && mir && !evExtend) {   // EXTEND folds mirativity into evAff; else a separate marker
    if (evid && evid.mir === "dedicated" && spec.evid && spec.evid.mir) mirAff = spec.evid.mir;
    else mirAff = spec.mir;                 // TAM pathway (byte-identical when no evidential system)
  }
  const honAff = !imperative && hon ? spec.honAff : null;   // honorific verb (Group E)
  // MULTI-CLAUSE nonfinite markers (Group G): a converb (medial/adverbial), a
  // nominalizer (agglutinative complement), or a participle (relative gap)
  const convAff = !imperative && conv && spec.conv ? spec.conv[conv] : null;
  const nfAff = !imperative && nf && spec.nf ? spec.nf : null;
  const relAff = !imperative && rel && spec.partcp ? spec.partcp : null;
  const redupAsp = !imperative && tamEff === "ipfv" && redupHas(lang, "aspect");
  // imperative particle (all morphotypes) + prohibitive, shared pre/post
  const impExtras = (pre, post) => {
    if (imperative && g.imp === "particle" && closedOf(lang).impPart) post.push({ w: closedOf(lang).impPart.w, g: "IMP", f: closedOf(lang).impPart.form });
    if (imperative && neg) (g.negPos === "post" ? post : pre).push(prohToken(lang));
  };
  let out;
  if (redupAsp) {
    // surface reduplication carries the aspect; person marking (if any)
    // appends as a transparent suffix-string. The MIRRORED form (honest
    // syllable append; cell flagged `seam`) rides for the voice/script layers.
    let text = redupStemSurface(lang, cid, g.redup.type);
    const glosses = [];
    const stem = nativeStemOf(lang, cid);
    const red = g.redup.type === "full" || !stem.syls[0] || !stem.syls[0].on.length
      ? stem.syls.map(cloneSyl)
      : [{ on: stem.syls[0].on.map(x => ({ ...x })), nu: stem.syls[0].nu.slice(0, 1).map(v => ({ ...v, lg: 0 })), co: [] }];
    const mform = { syls: [...red, ...stem.syls.map(cloneSyl)], tseed: stem.tseed };
    if (pers && !spec.iso && spec.pers) {
      const persAff = spec.pers[pers + num];
      if (persAff) { text += affixSurface(lang, persAff.syl); glosses.push(persAff.g); mform.syls.push(cloneSyl(persAff.syl)); }
    }
    out = { text, gloss: stemGloss + "~IPFV" + (glosses.length ? "-" + glosses.join("-") : ""), pre: [], post: [], irr: false, form: mform, seam: true };
  } else if (spec.iso) {
    const post = [], pre = [];
    if (tamAff) {
      // aspect/tense particles are enclitics — neutral tone (le, guo, ma);
      // the progressive leads (the 在 pattern), le/guo trail, future leads
      const tok = { w: rformNeutral(lang, { syls: [tamAff.syl] }), g: tamAff.g, f: { syls: [tamAff.syl] } };
      if (tamEff === "fut" || tamEff === "prog") pre.push(tok); else post.push(tok);
    }
    if (distAff) post.push({ w: rformNeutral(lang, { syls: [distAff.syl] }), g: distAff.g, f: { syls: [distAff.syl] } });
    if (irrMoodAff) pre.push({ w: rform(lang, { syls: [irrMoodAff.syl] }), g: irrMoodAff.g, f: { syls: [irrMoodAff.syl] } });   // preverbal modal 会/要/能
    if (honAff) post.push({ w: rformNeutral(lang, { syls: [honAff.syl] }), g: "HON", f: { syls: [honAff.syl] } });
    if (mirAff) post.push({ w: rformNeutral(lang, { syls: [mirAff.syl] }), g: "MIR", f: { syls: [mirAff.syl] } });
    if (evAff) post.push({ w: rformNeutral(lang, { syls: [evAff.syl] }), g: evGloss, f: { syls: [evAff.syl] } });   // evidential clause enclitic (outermost)
    impExtras(pre, post);
    out = { text: renderWord(nativeStemOf(lang, cid), lang.prof), gloss: stemGloss + (imperative && g.imp !== "particle" ? ".IMP" : ""), pre, post, irr: false, form: nativeStemOf(lang, cid) };
  } else {
    const irr = tamAff && isMarkedTam(tamEff) ? irregularityOf(lang, cid) : null;
    const events = [], glosses = [], outerGlosses = [];   // outerGlosses: the young agglutinated tier (evidential) — dash-joined even in fusional glosses
    let rootOverride = null, pattern = null, ablaut = false;
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
    } else if (tamAff && morph === "tmpl" && PRIMARY_TAM.has(tamEff)) {
      pattern = tamEff;                               // pattern change IS the TAM (primary only)
      tamInStem = tamAff.g;
    } else if (tamAff) {                              // secondary aspects route through an affix, even in tmpl
      if (irr === "fossil") {
        // syncope: the tense vowel vanishes into the stem's coda
        events.push({ ...tamAff, syl: { on: tamAff.syl.on, nu: [], co: [] } });
      } else events.push(tamAff);
      glosses.push(tamAff.g);
    }
    // graded tense: the distance affix rides outer of the base tense
    if (distAff) { events.push(distAff); glosses.push(distAff.g); }
    // honorific verb (Group E): a TAM-tier politeness marker (‹ 'give')
    if (honAff) { events.push(honAff); glosses.push("HON"); }
    // irrealis mood — unlike the imperative, it KEEPS the tam + person marking
    if (irrMoodAff) { events.push(irrMoodAff); glosses.push(irrMoodAff.g); }
    // imperative suffix (suffix-mode tongues); bare/particle add no affix
    if (imperative && g.imp === "suffix" && spec.imp) { events.push(spec.imp); glosses.push("IMP"); }
    // person agreement — imperatives, being addressee-directed, don't agree
    if (pers && !imperative && spec.pers) {
      const persAff = spec.pers[pers + num];
      if (persAff) { events.push(persAff); glosses.push(persAff.g); }
    }
    // multi-clause nonfinite markers (Group G): converb / nominalizer / participle
    if (convAff) { events.push(convAff); glosses.push(convAff.g); }
    if (nfAff) { events.push(nfAff); glosses.push("NMLZ"); }
    if (relAff) { events.push(relAff); glosses.push("PTCP"); }
    // object index — the OUTER object-clitic series (spec.persObj); a null
    // cell (zero 3sg.O, or one ground to silence) adds no event AND no gloss:
    // the gloss line only ever claims what the surface shows
    let oAffUsed = null;
    if (obj && !imperative && spec.persObj) {
      const oAff = spec.persObj[obj + "sg"];
      if (oAff) { events.push(oAff); outerGlosses.push(oAff.g); oAffUsed = oAff; }
    }
    // evidentiality — a young outer affix (drifts with the stem across sisters);
    // `outer:true` keeps it out of the fusional crush and its gloss dash-joined
    // (a separate agglutinated layer, never part of the portmanteau)
    if (evAff) { events.push(evAff); outerGlosses.push(evGloss); }
    // mirativity — the TAM marker rides the OUTERMOST slot (fuses into a fusional
    // ending, byte-identically); a DEDICATED evidential-mir is a separate outer affix
    if (mirAff) { events.push(mirAff.outer ? mirAff : { ...mirAff, t: lang.rules.length }); (mirAff.outer ? outerGlosses : glosses).push("MIR"); }
    const vTheme = spec.vThemes.length > 1 ? spec.vThemes[hash32(lang.famSeed ?? lang.seed, "conjpick", cid) % spec.vThemes.length] : null;
    const form = onionBuild(lang, cid, events, {
      fuse: morph === "fus", theme: vTheme && events.length ? vTheme : null,
      pattern, rootOverride, ablaut,
    });
    const text = renderWord(form, lang.prof);
    // HONEST GLOSS, per cell: even the outer clitic can be eaten at the very
    // surface (renderWord's haplology, when it echoes the syllable it lands
    // on). The gloss claims only what the reader can see — render the
    // counterfactual without the object event and drop the .O if identical.
    if (oAffUsed) {
      const evs2 = events.filter(e => e !== oAffUsed);
      const bare = renderWord(onionBuild(lang, cid, evs2, {
        fuse: morph === "fus", theme: vTheme && evs2.length ? vTheme : null,
        pattern, rootOverride, ablaut,
      }), lang.prof);
      if (bare === text) outerGlosses.splice(outerGlosses.indexOf(oAffUsed.g), 1);
    }
    // gloss: fused endings read STEM-PST.3SG, stacked ones STEM-PST-3SG,
    // pattern change reads STEM⟨PST⟩, suppletion/ablaut fold the TAM in
    let glossStr;
    if (tamInStem) glossStr = stemGloss + "⟨" + tamInStem + "⟩" + (glosses.length ? "-" + glosses.join("-") : "");
    else if (morph === "fus" && glosses.length > 1) glossStr = stemGloss + "-" + glosses.join(".");
    else glossStr = [stemGloss, ...glosses].join("-");
    if (imperative && (g.imp === "bare" || g.imp === "particle") && !glosses.length) glossStr = stemGloss + (g.imp === "bare" ? ".IMP" : "");
    glossStr += outerGlosses.map(gl => "-" + gl).join("");   // the outer evidential tier, always dash-separated
    const pre = [], post = [];
    impExtras(pre, post);
    out = { text, gloss: glossStr, pre, post, irr: !!irr || !!pattern, form };
  }
  // subject class-concord (verb agrees with the subject's noun class — Bantu
  // ki-anguka, Russian past upa-l/upa-la). Additive: only when asked + concord.verb.
  if (sclass != null && g.concord && g.concord.verb && !imperative) {
    const m = concordMarks(lang)[sclass];
    if (m) {
      const mw = renderWord({ syls: [cloneMarkSyl(m)] }, lang.prof);
      const dec = (f) => f && { syls: g.concord.site === "prefix" ? [cloneMarkSyl(m), ...f.syls.map(cloneSyl)] : [...f.syls.map(cloneSyl), cloneMarkSyl(m)], tseed: f.tseed };
      out = g.concord.site === "prefix"
        ? { ...out, text: mw + out.text, gloss: classGloss(lang, sclass) + "-" + out.gloss, form: dec(out.form), seam: true }
        : { ...out, text: out.text + mw, gloss: out.gloss + "-" + classGloss(lang, sclass), form: dec(out.form), seam: true };
    }
  }
  // direct-inverse: the INVERSE-direction marker rides the outer tier (direct is
  // zero, like the unmarked firsthand evidential); imperatives carry no direction
  if (dir === "inverse" && spec.inv && !imperative) {
    const mw = renderWord({ syls: [cloneMarkSyl(spec.inv.syl)] }, lang.prof);
    out = { ...out, text: out.text + mw, gloss: out.gloss + "-INV", form: out.form && { syls: [...out.form.syls.map(cloneSyl), cloneMarkSyl(spec.inv.syl)], tseed: out.form.tseed }, seam: true };
  }
  // VOICE (Group B): the valency marker (synthetic tongues; iso adds a light
  // verb in renderClause). Attached as a verbal exponent with its gloss.
  if (voice && spec.voice && spec.voice[voice]) {
    const va = spec.voice[voice];
    out = { ...out, text: out.text + renderWord({ syls: [cloneMarkSyl(va.syl)] }, lang.prof), gloss: out.gloss + "-" + va.g, form: out.form && { syls: [...out.form.syls.map(cloneSyl), cloneMarkSyl(va.syl)], tseed: out.form.tseed }, seam: true };
  }
  c.cells.set(key, out);
  return out;
}

// the negator a prohibitive ("don't!") uses — a special word where the
// language has one (bié/nolī), otherwise ordinary negation
function prohToken(lang) {
  const cl = closedOf(lang);
  return cl.prohibW ? { w: cl.prohibW.w, g: "PROH", f: cl.prohibW.form } : { w: cl.neg.w, g: "NEG", f: cl.neg.form };
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
  if (spec.tam.prf) tam.push({ k: "prf", g: "PRF" });
  if (spec.tam.prog) tam.push({ k: "prog", g: "PROG" });
  if (spec.tam.hab) tam.push({ k: "hab", g: "HAB" });
  const pers = spec.pers ? [["1", "sg"], ["2", "sg"], ["3", "sg"], ["1", "pl"], ["2", "pl"], ["3", "pl"]] : [];
  const moods = g.moods.map(k => ({ k, g: MOOD_GLOSS[k] }));
  return { nums, cases, tam, pers, moods, iso: spec.iso, imp: g.imp, redup: g.redup };
}

/** Affix etymologies for the Lab: every ending explains itself — including
 *  the renewed ones, where the old layer eroded to silence and a fresh word
 *  stepped in (the grammaticalization cycle, visible).
 *
 *  REVIEW-LOOP HONESTY: the notes are generated FROM the surviving paradigm,
 *  never from the pre-sound-change roll — three fresh readers in a row caught
 *  notes citing dead morphology (a -ik PL beside fully-reduplicated plurals; a
 *  -zyīgh PST whose tone matched no living cell, because the stored affix is
 *  the BIRTH-time shape while the surface kept evolving). Each entry carries a
 *  `mode`:
 *    affix   — the exponent segments cleanly off a regular diagnostic cell;
 *              `w` is the surface string exactly as the tables show it
 *    fused   — the category survives only as a non-segmentable alternation
 *              (portmanteau crush / seam sandhi); `ex` shows one real cell pair
 *    redup   — the category is carried by reduplication (no affix to cite)
 *    pattern — templatic primary TAM: a vowel pattern, not an affix
 *  `side` says which edge an affix-mode exponent attaches to. */
export function affixEtymologies(lang) {
  const spec = paradigmSpec(lang);
  const g = gramOf(lang);
  const out = [];
  const meta = (a) => ({ from: a.src != null ? glossOf(a.src) : null, renewed: !!a.renewed });
  const want = (a) => !!a && (a.src != null || a.renewed);
  if (spec.iso) {
    // isolating: the "endings" are free particles rendered straight from the
    // spec syllables — for particles the direct rendering IS the truth
    const add = (a) => { if (want(a)) out.push({ g: a.g, w: renderAffix(lang, a.syl), ...meta(a), mode: "affix", side: "post" }); };
    add(spec.pl); add(spec.du); add(spec.tri); add(spec.pau);
    for (const cse of spec.cases) add(cse);
    for (const k of Object.keys(spec.tam)) add(spec.tam[k]);
    for (const k of Object.keys(spec.dist)) add(spec.dist[k]);
    for (const k of Object.keys(spec.moods)) add(spec.moods[k]);
    return out;
  }
  const side = g.affixSide;
  const seg = (base, marked) => side === "pre"
    ? (marked.length > base.length && marked.endsWith(base) ? marked.slice(0, marked.length - base.length) : null)
    : (marked.length > base.length && marked.startsWith(base) ? marked.slice(base.length) : null);
  // diagnostic cells on REGULAR stems (irregulars fold the category into the
  // stem — that is what the ⟨…⟩ glosses in the tables are for, not the notes)
  const DIAG_N = [STONE, HOUSE, TREE, HAND];
  const diagN = (opts) => {
    let ex = null;
    for (const cid of DIAG_N) {
      const b = inflectNoun(lang, cid, {});
      const m = inflectNoun(lang, cid, opts);
      if (m.irr || m.text === b.text) continue;
      const s = seg(b.text, m.text);
      if (s) return { s, ex: null };
      if (!ex) ex = b.text + " → " + m.text;
    }
    return { s: null, ex };
  };
  const diagV = (opts, baseOpts = {}) => {
    let ex = null;
    for (const v of VERBS) {
      const b = inflectVerb(lang, v, baseOpts);
      const m = inflectVerb(lang, v, opts);
      if (b.irr || m.irr || m.text === b.text) continue;
      const s = seg(b.text, m.text);
      if (s) return { s, ex: null };
      if (!ex) ex = b.text + " → " + m.text;
    }
    return { s: null, ex };
  };
  const push = (a, d) => {
    if (d.s) out.push({ g: a.g, w: d.s, ...meta(a), mode: "affix", side });
    else out.push({ g: a.g, w: null, ...meta(a), mode: "fused", ex: d.ex });
  };
  // number: reduplicated plurals carry no affix — say so instead of citing one
  if (redupHas(lang, "plural")) out.push({ g: "PL", w: null, from: null, renewed: false, mode: "redup" });
  else if (want(spec.pl)) push(spec.pl, diagN({ num: "pl" }));
  if (want(spec.du)) push(spec.du, diagN({ num: "du" }));
  if (want(spec.tri)) push(spec.tri, diagN({ num: "tri" }));
  if (want(spec.pau)) push(spec.pau, diagN({ num: "pau" }));
  for (const cse of spec.cases) if (want(cse)) push(cse, diagN({ cas: cse.k }));
  // TAM: templatic PRIMARY tenses are vowel patterns, never affixes; a
  // reduplicated imperfective likewise has no ending to cite
  for (const k of Object.keys(spec.tam)) {
    const a = spec.tam[k];
    if (!a) continue;
    if (lang.prof.morph === "tmpl" && PRIMARY_TAM.has(k)) {
      const pv = patternVowels(lang)[k];
      out.push({ g: a.g, w: pv ? renderWord({ syls: [{ on: [], nu: [{ ...pv, n: 0, lg: 0 }], co: [] }] }, lang.prof) : null, from: null, renewed: false, mode: "pattern" });
      continue;
    }
    if (k === "ipfv" && redupHas(lang, "aspect")) { out.push({ g: a.g, w: null, from: null, renewed: false, mode: "redup" }); continue; }
    if (want(a)) push(a, diagV({ tam: k }));
  }
  // graded tense rides OUTER of its base tense — segment against the base cell
  const DIST_TAM = { rec: "pstrec", rem: "pstrem", farfut: "futrem" };
  const DIST_BASE = { rec: "pst", rem: "pst", farfut: "fut" };
  for (const k of Object.keys(spec.dist)) {
    const a = spec.dist[k];
    if (want(a)) push(a, diagV({ tam: DIST_TAM[k] }, { tam: DIST_BASE[k] }));
  }
  for (const k of Object.keys(spec.moods)) {
    const a = spec.moods[k];
    if (want(a)) push(a, diagV({ irrealisMood: k }));
  }
  return out;
}

/** The SYNCHRONIC phonology: what the language's evolved words actually
 *  contain, not what the proto-profile rolled. Sound change mints segments
 *  the rolled inventory never listed (palatalization → palatal affricates,
 *  lenition → fresh fricatives, nasalization → nasal vowels) — a fresh
 *  reader caught the Lab charting an inventory with no q beside words full
 *  of q, and a 'strict CV' label over cluster-grown surfaces. Scans the
 *  whole evolved dictionary + the closed classes; consonants dedupe by
 *  feature bundle, vowels by QUALITY (length/nasality are prosodic layers,
 *  not chart rows). Also reports observed syllable-shape maxima so labels
 *  can describe the language as it stands after history happened to it.
 *  → { cons, vows, maxOn, maxCo, codaRate, nasalOnlyCodas } (cached) */
export function synchronicPhonology(lang) {
  const c = gc(lang);
  if (c.synchPhon) return c.synchPhon;
  const consM = new Map(), vowM = new Map();
  let maxOn = 0, maxCo = 0, codaN = 0, sylN = 0, nasalOnly = true;
  const scan = (w) => {
    if (!w || !w.syls) return;
    for (const s of w.syls) {
      sylN++;
      maxOn = Math.max(maxOn, s.on.length);
      maxCo = Math.max(maxCo, s.co.length);
      if (s.co.length) { codaN++; if (!s.co.every(x => x.m === 1)) nasalOnly = false; }
      for (const x of [...s.on, ...s.co]) consM.set(x.p + ":" + x.m + ":" + x.l + ":" + x.s, { p: x.p, m: x.m, l: x.l, s: x.s });
      for (const v of s.nu) vowM.set(v.h + ":" + v.b + ":" + v.r, { h: v.h, b: v.b, r: v.r, n: 0, lg: 0 });
    }
  };
  for (let cid = 0; cid < CONCEPTS.length; cid++) scan(nativeStemOf(lang, cid));
  const cl = closedOf(lang);
  for (const f of [...cl.prons, ...cl.dems, cl.neg, ...cl.qs, ...cl.conj, ...cl.adps]) scan(f.form);
  c.synchPhon = {
    cons: [...consM.values()], vows: [...vowM.values()],
    maxOn, maxCo, codaRate: sylN ? codaN / sylN : 0, nasalOnlyCodas: nasalOnly && codaN > 0,
  };
  return c.synchPhon;
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
  // graded tense: keep it only if the distance affix exists, else degrade to
  // the base tense (pstrem→pst→pfv→null)
  if (GRADE[wanted]) return spec.dist[GRADE[wanted][1]] ? wanted : resolveTam(lang, GRADE[wanted][0]);
  if (spec.tam[wanted]) return wanted;
  // the extra aspects degrade toward the base ones
  if (wanted === "prf") return spec.tam.pfv ? "pfv" : resolveTam(lang, "pst");
  if ((wanted === "prog" || wanted === "hab") && spec.tam.ipfv) return "ipfv";
  if (wanted === "pst" && spec.tam.pfv) return "pfv";
  if (wanted === "fut" && spec.tam.ipfv) return null;
  return null;
}

/** Degrade a requested irrealis mood to what the language marks, else null
 *  (the indicative). */
export function resolveMood(lang, wanted) {
  if (!wanted) return null;
  return paradigmSpec(lang).moods[wanted] ? wanted : null;
}

/** The shared MIRATIVITY seam (§0.9): decides how a clause's surprise value is
 *  realized. The TAM branch (this file) fires the language's mirative marker
 *  (the perfect-syncretism / SEE·FINISH pathway); Evidentiality (Group C) later
 *  extends this to prefer an EXTEND-of-the-inferred exponent when a system
 *  exists. Returns { mir } — whether to flag mirativity on the verb. */
export function resolveMir(lang, frame) {
  const g = gramOf(lang);
  if (!frame || !frame.v || !frame.v.mir || frame.v.mood === "imp") return { mir: false };
  if (g.evid && g.evid.mir) return { mir: true };   // an evidential system's mirativity wins (EXTEND / DEDICATED)
  return { mir: !!g.mirative };                      // else the TAM pathway (perfect-syncretism / SEE·FINISH)
}

/** The TAM inventory this language marks (Group C′) — for the Lab + gates. */
export function tamShape(lang) {
  const g = gramOf(lang), spec = paradigmSpec(lang);
  return {
    tenses: g.tenses, aspect: g.aspect,
    remotePast: g.remotePast, remoteFuture: g.remoteFuture,
    perfect: !!spec.tam.prf, progressive: !!spec.tam.prog, habitual: !!spec.tam.hab,
    moods: g.moods.slice(), mirative: !!spec.mir,
    graded: Object.keys(spec.dist),
  };
}

/** The evidential system this language marks (Group C) — for the Lab + gates.
 *  Each overt form is worn from its perception/speech quarry (reads `.src` for
 *  `from`); the firsthand is zero under the zeroDirect norm. `mir` is how the
 *  system marks surprise (extend/dedicated/null). Null for non-evidential langs. */
export function evidentialSystem(lang) {
  const g = gramOf(lang);
  if (!g.evid) return null;
  const spec = paradigmSpec(lang);
  const forms = EVID_VALUES[g.evid.n].map((val) => {
    const aff = spec.evid && spec.evid[val];
    return aff
      ? { value: val, gloss: EVID_GLOSS[val], w: renderAffix(lang, aff.syl), from: aff.src != null ? glossOf(aff.src) : null, zero: false }
      : { value: val, gloss: EVID_GLOSS[val], w: "", from: null, zero: true };   // firsthand, zero-marked
  });
  return { n: g.evid.n, values: EVID_VALUES[g.evid.n].slice(), mir: g.evid.mir, forms };
}

// ── alignment resolver (Group F): ONE per-argument core-case function, used by
// renderClause for every system — and byte-identical to the old block for plain
// nom-acc / ergative. "S" is the grammatical subject (A when transitive, S when
// intransitive); the token role string stays "S" so the word-order gates hold. ──
const rankOf = (a) => (!a ? 0 : a.pron ? (a.pron.pers === 3 ? 2 : 3) : 1);   // SAP > 3rd-pron > noun
function coreCaseOf(lang, role, ctx) {
  const { trans, effAlign, hier, arg, sAgentive } = ctx;
  const pick = (k) => (paradigmSpec(lang).cases.some(x => x.k === k) ? k : null);
  if (role === "S") {
    if (effAlign === "active") return trans ? pick("agt") : (sAgentive ? pick("agt") : pick("pat"));
    if (effAlign === "tripartite") return trans ? pick("erg") : null;                     // A→ERG, S→bare
    if (effAlign === "erg") return !trans ? null : hier ? (rankOf(arg) < 3 ? pick("erg") : null) : pick("erg");
    return null;                                                                          // accusative: nom is bare
  }
  if (effAlign === "active") return pick("pat");
  if (effAlign === "tripartite") return pick("acc");
  if (effAlign === "erg") return hier ? (rankOf(arg) >= 3 ? pick("acc") : null) : null;    // Dyirbal: only SAP-O marked
  return pick("acc");                                                                      // accusative: object marked
}

/** A verb's proto-agent score (0..1); a verb absent from the table defaults
 *  patientive (documented). Feeds active-stative split-S. */
export function agentivityOf(cid) { return AGENTIVITY.has(cid) ? AGENTIVITY.get(cid) : 0.3; }
/** The language's alignment + split configuration (routes the old `g.align`
 *  consumers through one accessor). */
export function alignmentOf(lang) {
  const g = gramOf(lang);
  return { align: g.align, ergSplit: g.ergSplit, hierSplit: g.hierSplit, activeFluid: g.activeFluid, invAgree: g.invAgree, absAgree: g.absAgree };
}
/** The effective alignment applied to a SPECIFIC clause (after the TAM-split)
 *  and the verb direction for direct-inverse systems. */
export function clauseAlignment(lang, frame) {
  const g = gramOf(lang);
  const imperative = !!(frame.v && frame.v.mood === "imp");
  const tam = imperative ? null : resolveTam(lang, frame.v.tam);
  let effAlign = g.align;
  if (g.align === "erg" && g.ergSplit === "tam") effAlign = (tam === "pst" || tam === "pfv") ? "erg" : "acc";
  const trans = !!frame.o;
  const direction = g.invAgree && trans ? (rankOf(frame.s) >= rankOf(frame.o) ? "direct" : "inverse") : null;
  return { effAlign, hier: g.align === "erg" && g.ergSplit === "hier", direction, tam, imperative };
}

/** The valency-changing voices this language has (Group B). */
export function voicesOf(lang) {
  const g = gramOf(lang);
  return { caus: g.caus, pass: g.pass, antip: g.antip, appl: g.appl, applOf: g.applOf, passBy: g.passBy };
}
/** Where each voice marker grammaticalized from (the applicative is cognate
 *  with the language's own adposition; iso light verbs read opaque). */
export function voiceEtymologies(lang) {
  const spec = paradigmSpec(lang), g = gramOf(lang);
  const out = [];
  for (const k of ["caus", "pass", "antip", "appl"]) {
    const a = spec.voice[k];
    if (a) out.push({ k, g: a.g, from: a.src != null ? glossOf(a.src) : null });
    else if (g[k] && lang.prof.morph === "iso" && closedOf(lang).voice[k]) out.push({ k, g: k.toUpperCase(), from: null });
  }
  return out;
}

/** Render a semantic frame as a clause.
 *  frame = { s: {pron:{k,pers,num}} | {n,num,def,adj},
 *            v: {c, tam, neg, vol},
 *            o: null | like s | {wh:true},
 *            loc: null | {adp, n, def},
 *            q: bool }
 *  → { tokens: [{w, g, role}], text, gloss } */
export function renderClause(lang, frame, opts = {}) {
  const g = gramOf(lang);
  const cl = closedOf(lang);
  const spec = paradigmSpec(lang);
  // MULTI-CLAUSE (Group G): a clausal object (o.comp) is routed AROUND the NP
  // case/agreement logic; opts.gap suppresses a role's overt tokens (a relative
  // gap); opts.medial/nfVerb make the verb a converb/nominalized (nonfinite).
  const oComp = (frame.o && frame.o.comp) || null;
  // ── VOICE prepass (Group B): remap the grammatical relations BEFORE case and
  // agreement resolve, so the P3 resolver sees the DERIVED valency ──
  const voice = frame.v.voice || null;
  let sArg = frame.s, oArg = oComp ? null : frame.o, byArg = null, oblArg = null, locArg = frame.loc;
  if (voice === "pass") { sArg = frame.o; oArg = null; byArg = frame.s; }             // P→subj, A→by-phrase
  else if (voice === "antip") { sArg = frame.s; oArg = null; oblArg = frame.o; }      // A stays subj (ABS), P→oblique
  else if (voice === "appl" && frame.loc) { oArg = { n: frame.loc.n, def: frame.loc.def, num: frame.loc.num || "sg" }; locArg = null; }  // oblique→object
  const trans = !!oArg || !!oComp;
  const sIsPron = sArg && !!sArg.pron;
  // TAM resolves first (the tam-split reads it), then the effective alignment
  // decides the core cases through the ONE resolver (nom-acc/erg byte-identical,
  // plus active AGT/PAT, tripartite, and hierarchy-conditioned ergativity)
  const { effAlign, hier, direction, tam, imperative } = clauseAlignment(lang, { ...frame, s: sArg, o: oArg || (oComp ? { clause: true } : null) });
  const sAgentive = effAlign === "active" && !trans
    ? (g.activeFluid && frame.v.vol != null ? frame.v.vol : agentivityOf(frame.v.c) >= 0.5) : false;
  const sCase = coreCaseOf(lang, "S", { trans, effAlign, hier, arg: sArg, sAgentive });
  const oCase = coreCaseOf(lang, "O", { trans, effAlign, hier, arg: oArg, sAgentive });
  const np = (arg, cas, role) => {
    if (!arg) return [];
    if (arg.pron) {
      // graceful degrade: a gendered request in a genderless tongue falls to
      // plain 3sg; clusivity falls to the plain plural, and so on. POLITENESS
      // (Group E): pol:'pol'|'hon' remaps a 2nd-person to the T-V cell, degrading
      // 2vv → 2v → 2pl → 2sg where the language marks fewer levels.
      const k = arg.pron.pol ? (arg.pron.pol === "hon" ? "2vv" : "2v") : arg.pron.k;
      const cell = cl.prons.find(p => p.k === k)
        || (k === "2vv" ? cl.prons.find(p => p.k === "2v") : null)                         // 2vv → 2v
        || (k === "2v" || k === "2vv" ? cl.prons.find(p => p.k === "2pl") : null)          // 2v → 2pl (or 2sg below)
        || cl.prons.find(p => p.k === k.replace(/[mf]$/, ""))                              // 3sgf → 3sg
        || cl.prons.find(p => p.k === k.replace(/p[ie]$/, "pl"))                           // 1pi → 1pl
        || (k.includes("p") ? cl.prons.find(p => p.k[0] === k[0] && /p[lie]/.test(p.k)) : null)   // 1pl → 1pe
        || (k.endsWith("sg") ? cl.prons.find(p => p.k[0] === k[0] && p.k.includes("sg")) : null)  // 3sg → 3sgm
        || (arg.pron.pol ? cl.prons.find(p => p.k === "2sg") : null)                       // polite → 2sg (last resort)
        || cl.prons.find(p => p.k[0] === k[0])
        || cl.prons[0];
      // object/oblique pronouns take their case form (me/him); subjects stay
      // bare — nom-acc even under noun ergativity (split ergativity for free)
      const pcKey = role === "O" ? "acc" : role === "X" ? "obl" : null;
      if (pcKey && cell.cases && cell.cases[pcKey]) return [{ w: cell.cases[pcKey].w, g: cell.cases[pcKey].g, role, f: cell.cases[pcKey].form }];
      return [{ w: cell.w, g: cell.g, role, f: cell.form }];
    }
    if (arg.wh) {
      const q = cl.qs.find(x => x.k === "what");
      return [{ w: q.w, g: "what", role, wh: true, f: q.form }];
    }
    const headCls = g.genders ? genderOf(lang, arg.n) : 0;
    // count core (Group D): a counted arg expands to [Num (CL) N] in place —
    // `count` wins over `num`; numeralPhrase owns the count, np keeps adj/dem/art
    const counted = arg.count != null;
    const numForAdj = counted ? (g.classif ? "sg" : (arg.count !== 1 && g.pluralMark ? "pl" : "sg")) : (arg.num || "sg");
    let seq;
    if (counted) {
      seq = numeralPhrase(lang, arg.n, arg.count, { cas, useClf: arg.useClf !== false }).tokens.map(t => ({ ...t, role }));
    } else {
      const x = inflectNoun(lang, arg.n, { num: arg.num || "sg", cas });
      seq = [...x.pre.map(t => ({ ...t, role })), { w: x.text, g: x.gloss, role, f: x.form, c: arg.n, seam: x.seam }, ...x.post.map(t => ({ ...t, role }))];
    }
    if (arg.adj != null) {
      const a = inflectAdj(lang, arg.adj, { cls: headCls, num: numForAdj, cas: counted && g.classif ? null : cas });   // agrees with head class
      const adj = { w: a.text, g: a.gloss, role, f: a.form, c: arg.adj };
      seq = g.adjN ? [adj, ...seq] : [...seq, adj];
    }
    // demonstrative (optional frame field): agrees with the head class too
    if (arg.dem) {
      const d = cl.dems.find(z => z.k === arg.dem) || cl.dems[cl.dems.length - 1];
      let dw = d.w, dg = d.g, df = d.form;
      if (g.concord && g.concord.dem && g.genders) { df = applyConcord(lang, copyWord(d.form), headCls); dw = renderWord(df, lang.prof); dg = d.g + "." + classGloss(lang, headCls); }
      seq = [{ w: dw, g: dg, role, f: df }, ...seq];
    }
    if (arg.def && cl.defArt) seq = g.adjN ? [{ w: cl.defArt.w, g: "DEF", role, f: cl.defArt.form }, ...seq] : [...seq, { w: cl.defArt.w, g: "DEF", role, f: cl.defArt.form }];
    else if (arg.def === false && cl.indefArt) seq = g.adjN ? [{ w: cl.indefArt.w, g: "INDF", role, f: cl.indefArt.form }, ...seq] : [...seq, { w: cl.indefArt.w, g: "INDF", role, f: cl.indefArt.form }];
    // relative clause (Group G): the head plays arg.rel.role INSIDE, rendered
    // with a GAP; the strategy is gap (an invariant relativizer, or an agg
    // participle), relpron (postnominal + caseN≥1 only — the universal), or
    // resump (an ordinary pronoun fills the gap). relPre lags a word-order flip.
    if (arg.rel) {
      const rel = arg.rel, strat = g.relStrat;
      const gapRole = rel.role === "s" ? "S" : rel.role === "o" ? "O" : null;
      const innerFrame = { ...rel, v: rel.v };
      const rOpts = { gap: strat === "resump" ? null : gapRole };
      if (strat === "resump" && gapRole) innerFrame[rel.role] = { pron: { k: "3sg", pers: 3, num: "sg" } };  // resumptive pronoun
      if (strat === "gap" && lang.prof.morph === "agg" && spec.partcp) rOpts.relGap = true;                 // participial relative
      const inner = renderClause(lang, innerFrame, rOpts);
      const innerToks = inner.tokens.map(t => ({ ...t, role }));
      // gap/relpron take an overt relativizer; the participial gap (agg) IS its
      // own strategy marker (the PTCP), so it needs no separate relativizer;
      // resump fills the gap with a pronoun and takes neither
      const relMark = strat === "resump" || rOpts.relGap ? null : { w: cl.links.rel.w, g: "REL", role, f: cl.links.rel.form };
      const relSeq = relMark ? (g.relPre ? [...innerToks, relMark] : [relMark, ...innerToks]) : innerToks;
      seq = g.relPre ? [...relSeq, ...seq] : [...seq, ...relSeq];
    }
    return seq;
  };
  // a clausal complement (o.comp): render the inner clause + the complementizer,
  // routed AROUND the NP case/agreement logic. Agglutinative compFinite=false
  // nominalizes the inner verb.
  const complementTokens = (comp) => {
    const inner = renderClauseTree(lang, comp, { nfVerb: g.compFinite === false });
    const compTok = { w: cl.links.comp.w, g: "COMP", role: "O", f: cl.links.comp.form };
    const innerToks = inner.tokens.map(t => ({ ...t, role: "O" }));
    return g.compzPos === "init" ? [compTok, ...innerToks] : [...innerToks, compTok];
  };
  const toks = {
    s: opts.gap === "S" ? [] : np(sArg, sCase, "S"),
    o: opts.gap === "O" ? [] : oComp ? complementTokens(oComp) : np(oArg, oCase, "O"),
    v: [],
  };
  // verb agreement: with the (derived) SUBJECT by default, but with the
  // ABSOLUTIVE (O of a transitive) under abs-agree, or the HIGHEST-RANKED
  // argument under direct-inverse (the verb also carries the direction marker)
  let agreeArg = sArg;
  if (g.absAgree && trans) agreeArg = oArg;
  else if (g.invAgree && trans && rankOf(oArg) > rankOf(sArg)) agreeArg = oArg;
  const argPers = (a) => (a && a.pron ? a.pron.pers : 3);
  const argNum = (a) => (a ? (a.pron ? a.pron.num : (a.num || "sg")) : "sg");
  const agreePers = !imperative && g.agree !== "none" ? String(argPers(agreeArg)) : null;
  const agNum = argNum(agreeArg);
  // polypersonal object index — but don't ALSO index O when agreement already
  // went to O (abs-agree / inverse), and never index a CLAUSAL object (o.comp,
  // where oArg is null even though the verb is transitive)
  const objPers = !imperative && g.agree === "both" && trans && oArg && !oArg.wh && agreeArg === sArg ? String(argPers(oArg)) : null;
  const neg = !!frame.v.neg;
  // subject class-concord on the verb (Bantu ki-, Russian past -l/-la)
  const vClass = g.concord && g.concord.verb && sArg && !sIsPron && sArg.n != null && g.genders ? genderOf(lang, sArg.n) : null;
  // irrealis mood (subjunctive/conditional/optative/potential) rides v.mood
  // when it isn't the imperative; mirativity rides the shared resolveMir seam
  const irrealisMood = !imperative && frame.v.mood && frame.v.mood !== "imp" ? resolveMood(lang, frame.v.mood) : null;
  const mirOn = resolveMir(lang, frame).mir;
  // evidentiality (Group C): map the requested information-source onto what this
  // system actually marks (graceful cross-size degrade); null for imperatives and
  // non-evidential languages, so the resolveMir seam alone decides surprise
  const evOn = !imperative && g.evid && frame.v.ev ? evidMap(g.evid.n, frame.v.ev) : null;
  // MULTI-CLAUSE (Group G): a medial verb is a converb (nonfinite); a nominalized
  // complement / relative gap likewise drop finiteness
  const medial = opts.medial || null;
  const vx = inflectVerb(lang, frame.v.c, {
    tam, pers: agreePers, num: agNum === "du" ? "pl" : agNum, obj: objPers,
    neg: neg && (imperative || !!spec.negAff), mood: imperative ? "imp" : null, sclass: vClass, dir: direction,
    voice: voice && !spec.iso ? voice : null,   // synthetic voice affix (iso uses a light verb below)
    irrealisMood, mir: mirOn, ev: evOn,
    conv: medial === "cvb" ? "temp" : opts.conv || null, nf: !!opts.nfVerb, rel: !!opts.relGap,
  });
  toks.v = [...vx.pre.map(t => ({ ...t, role: "V" })), { w: vx.text, g: vx.gloss, role: "V", f: vx.form, c: frame.v.c, seam: vx.seam }, ...vx.post.map(t => ({ ...t, role: "V" }))];
  // switch-reference: the medial verb carries an SS/DS marker (synthetic; iso has no switchRef)
  if (medial === "ss" && spec.ssAff) toks.v.push({ w: renderWord({ syls: [spec.ssAff.syl] }, lang.prof), g: "SS", role: "V", f: { syls: [spec.ssAff.syl] } });
  else if (medial === "ds" && spec.dsAff) toks.v.push({ w: renderWord({ syls: [spec.dsAff.syl] }, lang.prof), g: "DS", role: "V", f: { syls: [spec.dsAff.syl] } });
  // isolating VOICE is periphrastic: a light verb / marker leads the verb
  // (让 causative, 被 passive) — the synthetic exponent lives on vx instead
  if (spec.iso && voice && cl.voice && cl.voice[voice]) toks.v.unshift({ w: cl.voice[voice].w, g: cl.voice[voice].g, role: "V", f: cl.voice[voice].form });
  // negation particle (when not an affix): before/after the verb, or clause-final.
  // imperatives already carry their own prohibitive marker in vx.pre/post
  let negFinal = false;
  if (neg && !imperative && !spec.negAff) {
    if (g.negPos === "pre") toks.v.unshift({ w: cl.neg.w, g: "NEG", role: "V", f: cl.neg.form });
    else if (g.negPos === "post") toks.v.push({ w: cl.neg.w, g: "NEG", role: "V", f: cl.neg.form });
    else negFinal = true;
  }
  // imperatives address "you": the 2nd-person subject is dropped by default
  // (universal tendency), and any explicit subject pronoun goes with it
  if (imperative && (!sArg || sIsPron)) toks.s = [];
  // pro-drop: agreement carries the person, the pronoun stays home
  else if (sIsPron && g.proDrop && g.agree !== "none") toks.s = [];
  // adpositional adjuncts: the locative, the passive BY-phrase (demoted agent),
  // and the antipassive OBLIQUE (demoted patient) — all X-role
  const adjunct = (arg, adpM) => {
    if (!arg) return [];
    const adp = cl.adps.find(a => a.m === adpM) || cl.adps[0];
    let inner;
    if (arg.pron) { const pc = pronoun(lang, arg.pron.k, "obl"); inner = [{ w: pc.w, g: pc.g, role: "X", f: pc.form }]; }
    else {
      const nx = inflectNoun(lang, arg.n, { num: arg.num || "sg", cas: null });
      inner = [...(arg.def && cl.defArt && g.adjN ? [{ w: cl.defArt.w, g: "DEF", role: "X", f: cl.defArt.form }] : []),
        { w: nx.text, g: nx.gloss, role: "X", f: nx.form, c: arg.n, seam: nx.seam },
        ...(arg.def && cl.defArt && !g.adjN ? [{ w: cl.defArt.w, g: "DEF", role: "X", f: cl.defArt.form }] : [])];
    }
    return g.adpSide === "pre" ? [{ w: adp.w, g: adp.m, role: "X", f: adp.form }, ...inner] : [...inner, { w: adp.w, g: adp.m, role: "X", f: adp.form }];
  };
  const locToks = [
    ...(locArg ? adjunct({ n: locArg.n, def: locArg.def, num: locArg.num }, locArg.adp) : []),
    ...adjunct(byArg, g.passBy),      // passive agent
    ...adjunct(oblArg, "with"),       // antipassive patient
  ];
  // assemble by word order; adjuncts sit preverbally in OV, clause-late in VO
  const ov = g.wo === "sov" || g.wo === "ovs";
  let seq = [];
  for (const slot of WO_SEQ[g.wo]) {
    if (slot === "v" && ov && locToks.length) seq.push(...locToks);
    seq.push(...toks[slot]);
  }
  if (!ov && locToks.length) seq.push(...locToks);
  // wh-fronting: the question word moves to the clause edge when the dials say
  const whIdx = seq.findIndex(t => t.wh);
  if (whIdx > 0 && g.whFront) seq.unshift(...seq.splice(whIdx, 1));
  if (negFinal) seq.push({ w: cl.neg.w, g: "NEG", role: "V", f: cl.neg.form });
  // polar-question particle (wh-questions carry their own interrogative)
  if (frame.q && !oArg?.wh && cl.qp) {
    if (g.qPart === "final") seq.push({ w: cl.qp.w, g: "Q", role: "Q", f: cl.qp.form });
    else if (g.qPart === "init") seq.unshift({ w: cl.qp.w, g: "Q", role: "Q", f: cl.qp.form });
  }
  // adverbial clauses (Group G): when/if/because — each an inner clause plus a
  // subordinator (WALS 94: advPos; OV⇒final), or a converb suffix in the Turkic/
  // Japanese corner. Conditionals prepose (a ~85% render correlate).
  if (frame.adv && frame.adv.length) {
    for (const av of frame.adv) {
      let advToks;
      if (g.advAffix && spec.conv) {   // converb suffix on the subordinate verb, no free subordinator
        advToks = renderClause(lang, av, { conv: av.sub === "if" ? "cond" : av.sub === "because" ? "caus" : "temp" }).tokens.map(t => ({ ...t, role: "ADV" }));
      } else {
        const inner = renderClauseTree(lang, av).tokens.map(t => ({ ...t, role: "ADV" }));
        const sub = av.sub === "when" ? { w: cl.links.when.w, g: "when", role: "ADV", f: cl.links.when.form }
          : (() => { const c = cl.conj.find(x => x.k === av.sub) || cl.conj.find(x => x.k === "if"); return { w: c.w, g: av.sub, role: "ADV", f: c.form }; })();
        advToks = g.advPos === "init" ? [sub, ...inner] : [...inner, sub];
      }
      const prepose = av.sub === "if" ? true : g.advPos === "init";   // conditionals prepose
      seq = prepose ? [...advToks, ...seq] : [...seq, ...advToks];
    }
  }
  return { tokens: seq, text: seq.map(t => t.w).join(" "), gloss: seq.map(t => t.g).join(" ") };
}

/** Render a clause TREE (Group G): dispatch coordination / chaining, else a leaf
 *  frame (which may itself contain nested arg.rel / o.comp / frame.adv). Every
 *  combinator returns the same { tokens, text, gloss } shape, so gloss-alignment
 *  holds at any depth; recursion terminates (each nested node is strictly smaller). */
export function renderClauseTree(lang, node, opts = {}) {
  if (node.coord) return renderCoordination(lang, node);
  if (node.chain) return renderChain(lang, node);
  return renderClause(lang, node, opts);
}
const packTree = (toks) => ({ tokens: toks, text: toks.map(t => t.w).join(" "), gloss: toks.map(t => t.g).join(" ") });
// F1 — coordination: clauses joined by a conjunction (and/but/or). An enclitic
// coordinator (coordFinal, the -que edge) joins the PRECEDING clause's last token
// (.w AND .g) instead of standing as its own token.
function renderCoordination(lang, node) {
  const g = gramOf(lang), cl = closedOf(lang);
  const conj = cl.conj.find(c => c.k === node.coord) || cl.conj.find(c => c.k === "and");
  const toks = [];
  node.clauses.forEach((c, i) => {
    if (i > 0) {
      if (g.coordFinal && toks.length) {
        const prev = toks[toks.length - 1];
        prev.w += conj.w; prev.g += "-" + conj.g.toUpperCase();
        prev.f = prev.f && conj.form ? { syls: [...prev.f.syls.map(cloneSyl), ...conj.form.syls.map(cloneSyl)], tseed: prev.f.tseed } : null;
        prev.seam = true;
      } else toks.push({ w: conj.w, g: conj.g.toUpperCase(), role: "CONJ", f: conj.form });
    }
    toks.push(...renderClauseTree(lang, c).tokens.map(t => ({ ...t })));
  });
  return packTree(toks);
}
// F5 — clause chaining: medial verbs become converbs (only the last is finite);
// switch-reference marks SS (drop the shared subject) vs DS. A chain in a non-
// chaining language degrades bit-for-bit to a coordination.
function renderChain(lang, node) {
  const g = gramOf(lang);
  if (!g.chaining) return renderCoordination(lang, { coord: "and", clauses: node.chain });
  const clauses = node.chain;
  const subjKey = (c) => (c.s ? (c.s.pron ? "p" + c.s.pron.k : "n" + c.s.n) : null);
  const toks = [];
  clauses.forEach((c, i) => {
    if (i === clauses.length - 1) { toks.push(...renderClauseTree(lang, c).tokens); return; }
    const same = g.switchRef && subjKey(c) != null && subjKey(c) === subjKey(clauses[i + 1]);
    const mf = same ? { ...c, s: null } : c;   // SS drops the shared subject
    toks.push(...renderClause(lang, mf, { medial: g.switchRef ? (same ? "ss" : "ds") : "cvb" }).tokens);
  });
  return packTree(toks);
}
/** The subordinating / coordinating linkers this language uses (Group G). */
export function clauseLinkersOf(lang) {
  const g = gramOf(lang), cl = closedOf(lang);
  return {
    coord: cl.conj.filter(c => ["and", "but", "or"].includes(c.k)).map(c => ({ k: c.k, w: c.w })),
    coordFinal: g.coordFinal,
    comp: { w: cl.links.comp.w, from: cl.links.comp.src, pos: g.compzPos, finite: g.compFinite },
    rel: { w: cl.links.rel.w, from: cl.links.rel.src, pre: g.relPre, strat: g.relStrat },
    when: { w: cl.links.when.w, from: cl.links.when.src },
    adv: { pos: g.advPos, affix: g.advAffix },
    chaining: g.chaining, switchRef: g.switchRef,
  };
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

// ── Reference languages: exact-inventory labelled scenarios ──────────────
//
// Hand-set dial profiles + pinned phoneme inventories for real-language
// SHAPES (docs/language-comprehensive-spec.md capability bar). These are
// scenario DATA, not mechanisms — the cardinal rules permit them the same
// way they permit the pinned Earth hearths. Generated words use only the
// real language's sounds in its real romanization; the words themselves
// remain procedural (no real lexicon ships).

import { rollProfile } from "./languagePhonology.js";
import { hash32 } from "./peopleSim/rng.js";

const B = (p, m, l = 0, s = 0) => ({ p, m, l, s });
const NB = (p, m, l = 0, s = 0) => ({ p, m, l, s, noOn: true });   // coda-only (ŋ)
const VB = (h, b, r) => ({ h, b, r, n: 0, lg: 0 });

export const REF_KINDS = ["mandarin", "russian", "english"];

/** Dial profile for a reference shape (coherent base, pinned dials). */
export function refProfile(kind, seed) {
  const p = rollProfile(seed);
  if (kind === "mandarin") Object.assign(p, {
    sylC: 0, nasalCoda: true, onDepth: 1, coDepth: 0, sCluster: false,
    tone: 2, consN: 22, vowelN: 5, retroflex: true, aspirated: true, voiced: false,
    palatalized: false, uvular: false, pharyngeal: false, ejective: false, prenasal: false, dental: false,
    frontRound: true, harmony: "none", morph: "iso", sylMin: 1, sylMax: 2,
    nameOrder: "fg", patro: "none", gendered: false, diph: true, longV: false, nasalV: false,
    orthoStyle: 0, sig: "none", compound: "hl", compErode: "trim", wordLen: 1.5, erodeNames: false, nameStyle: "plain",
    romTaste: 0, palatalFront: true,              // j/q/x only before front vowels; g/k/h never before i
    toneMarks: true, medialSonorant: true,
    script: { type: "logo", dir: "ltr" },         // pinned writing system (scenario data, like the gram literal)
    // grammar dials (every gram dial pinned — rolled values must not leak):
    // SVO isolating, aspect not tense (le/guo), final polar particle (ma),
    // wh in situ, clusive we (zánmen), affixal pronoun plural (wǒ-men)
    gram: {
      wo: "svo", adpSide: "pre", genN: true, adjN: true, affixSide: "suf",
      caseN: 0, align: "acc", negPos: "pre", qPart: "final", whFront: false,
      activeFluid: false, ergSplit: null, hierSplit: null, invAgree: false, absAgree: false,
      caus: true, pass: true, passBy: "from", antip: false, appl: false, applOf: null,
      remotePast: 0, remoteFuture: 0, perfect: true, progressive: true, habitual: false, moods: [], mirative: false, evid: null,
      genders: 0, classAssign: null, concord: null, tenses: 1, agree: "none", aspect: true, pluralMark: false,
      classif: { classes: ["gen", "hum", "anm", "long", "flat", "round"], obl: true, order: "pre" },
      trial: false, paucal: false, possAffix: false, alienSplit: false,
      compar: { type: "particle", more: "none", stdFirst: true },   // A bǐ B dà — VO with a preposed standard (sanctioned anomaly)
      tv: "binary", tvSource: "plural", honVerb: false,             // nín ‹ 2PL
      // multi-clause: SVO but RelN (的) — the sanctioned disharmonic corner
      coordFinal: false, compzSrc: "say", compzPos: "init", compFinite: true,
      advPos: "init", advAffix: false, relPre: true, relStrat: "gap", relzSrc: "dem",
      chaining: false, switchRef: false,
      // predication: shì-style pronoun copula for nominals, verbal adjectives
      // (tā lǎo), a posture locative (zài), the yǒu machine — ONE verb for
      // existence and possession — with the fused negative (méiyǒu), full
      // serialization (ná dāo qiē ròu), pronominal reflexive (zìjǐ ≠ hùxiāng)
      copN: "pron", copA: "verb", copLoc: "posture", possPred: "have", existV: "have",
      negEx: "special", svc: true, svcTam: "first", refl: "pron", recpSame: false,
      dual: false, clusiv: true, gender3: false, defArt: false, indefArt: false,
      proDrop: true, numBase: 10, numOrder: true, dem3: false, negAffix: false,
      pronPl: "affix", declN: 1, conjN: 1, pronCase: "none",
      // verb/adjective reduplication (kàn-kan, hóng-hóng); bare imperative;
      // 别-style dedicated prohibitive
      redup: { type: "full", fns: ["aspect", "intensive"] },
      imp: "bare", prohib: "special",
    },
  });
  if (kind === "russian") Object.assign(p, {
    sylC: 3, onDepth: 3, coDepth: 3, sCluster: true, nasalCoda: false,
    tone: 0, consN: 34, vowelN: 5, palatalized: true, voiced: true, aspirated: false,
    retroflex: false, uvular: false, pharyngeal: false, ejective: false, prenasal: false, dental: false,
    frontRound: false, harmony: "none", morph: "fus", stress: "mobile",
    sylMin: 1, sylMax: 3, patro: "suf", gendered: true, diph: false, longV: false, nasalV: false,
    orthoStyle: 0, sig: "none", compound: "hl", compErode: "trim", wordLen: 2.1, erodeNames: false, nameStyle: "plain",
    romTaste: 0, script: { type: "alphabet", dir: "ltr" },
    // SVO fusional: six-case nom-acc, three genders, full TAM + agreement,
    // preverbal ne, fronted wh, no articles — the Slavic corner
    gram: {
      wo: "svo", adpSide: "pre", genN: false, adjN: true, affixSide: "suf",
      caseN: 5, align: "acc", negPos: "pre", qPart: "none", whFront: true,
      activeFluid: false, ergSplit: null, hierSplit: null, invAgree: false, absAgree: false,
      caus: false, pass: true, passBy: "with", antip: false, appl: false, applOf: null,
      remotePast: 0, remoteFuture: 0, perfect: false, progressive: false, habitual: false, moods: ["cond"], mirative: false, evid: null,
      genders: 3, classAssign: "mixed", concord: { adj: true, dem: true, art: false, verb: true, site: "fuse" }, tenses: 3, agree: "subj", aspect: true, pluralMark: true,
      classif: null,
      trial: false, paucal: false, possAffix: false, alienSplit: false,
      compar: { type: "particle", more: "affix", stdFirst: false },   // -ee / bolee … чем
      tv: "binary", tvSource: "plural", honVerb: false,               // vy ‹ 2PL
      coordFinal: false, compzSrc: "wh", compzPos: "init", compFinite: true,   // что
      advPos: "init", advAffix: false, relPre: false, relStrat: "relpron", relzSrc: "wh",   // который
      chaining: false, switchRef: false,
      // predication: the Slavic corner — TENSED zero copula (on starik / on
      // byl starik), locational possession (u menya est'), the fused negative
      // existential (net), verbal reflexive (-sja, doubling as reciprocal)
      copN: "zero", copA: "cop", copLoc: "cop", possPred: "loc", existV: "be",
      negEx: "special", svc: false, svcTam: "first", refl: "verb", recpSame: true,
      dual: false, clusiv: false, gender3: true, defArt: false, indefArt: false,
      proDrop: false, numBase: 10, numOrder: true, dem3: false, negAffix: false,
      pronPl: "root", declN: 3, conjN: 2, pronCase: "full",
      // no productive grammatical reduplication; suffixal imperative (idi);
      // prohibitive is plain ne + imperative
      redup: null, imp: "suffix", prohib: "neg",
    },
  });
  if (kind === "english") Object.assign(p, {
    sylC: 3, onDepth: 3, coDepth: 3, sCluster: true, nasalCoda: false,
    tone: 0, consN: 24, vowelN: 11, palatalized: false, voiced: true, aspirated: false,
    retroflex: false, uvular: false, pharyngeal: false, ejective: false, prenasal: false, dental: true,
    frontRound: false, harmony: "none", morph: "fus", stress: "mobile",
    sylMin: 1, sylMax: 3, patro: "suf", gendered: false, diph: true, longV: false, nasalV: false,
    orthoStyle: 0, sig: "none", compound: "hl", compErode: "trim", wordLen: 1.9, erodeNames: true, nameStyle: "di",
    romTaste: 0, c2LiqOnly: true,                 // pr/tr/fl/sl — never fn-/hn-/thn-
    script: { type: "alphabet", dir: "ltr" },
    ortho: "en",                                  // spelling conventions: -y not -i, -ve, -dge, -ck, -ff, silent -e
    codaBias: 1.5,                                // stress-timed: closed syllables are the norm
    medialSonorant: true,                         // win-ter, sil-ver — never shod-pug
    vInit: 0.05,                                  // English strongly prefers consonant onsets
    // SVO analytic-fusional: possessive as the lone marked case ('s),
    // gendered 3sg without noun gender (he/she), both articles, no agreement
    gram: {
      wo: "svo", adpSide: "pre", genN: true, adjN: true, affixSide: "suf",
      caseN: 1, align: "acc", negPos: "pre", qPart: "none", whFront: true,
      activeFluid: false, ergSplit: null, hierSplit: null, invAgree: false, absAgree: false,
      remotePast: 0, remoteFuture: 0, perfect: true, progressive: true, habitual: false, moods: [], mirative: false, evid: null,
      caus: false, pass: true, passBy: "at", antip: false, appl: false, applOf: null,
      genders: 0, classAssign: null, concord: null, tenses: 3, agree: "none", aspect: false, pluralMark: true,
      classif: null,
      trial: false, paucal: false, possAffix: false, alienSplit: false,
      compar: { type: "particle", more: "affix", stdFirst: false },   // -er / more … than
      tv: "none", tvSource: "plural", honVerb: false,
      coordFinal: false, compzSrc: "dem", compzPos: "init", compFinite: true,   // that
      advPos: "init", advAffix: false, relPre: false, relStrat: "relpron", relzSrc: "wh",   // who/that (invariant, caseN:1)
      chaining: false, switchRef: false,
      // predication: the SAE corner — an always-overt BE copula, have-
      // possession, a plain negated existential, pronominal reflexive
      // (himself ≠ each other), no serialization
      copN: "verb", copA: "cop", copLoc: "cop", possPred: "have", existV: "be",
      negEx: "neg", svc: false, svcTam: "first", refl: "pron", recpSame: false,
      dual: false, clusiv: false, gender3: true, defArt: true, indefArt: true,
      proDrop: false, numBase: 10, numOrder: true, dem3: false, negAffix: false,
      pronPl: "root", declN: 2, conjN: 2, pronCase: "acc",
      // no productive grammatical reduplication; bare imperative ("Go!");
      // prohibitive is "do not" + bare stem
      redup: null, imp: "bare", prohib: "neg",
    },
  });
  return p;
}

/** Exact phoneme pin + romanization for a reference kind (null for none). */
export function refPin(kind) {
  if (kind === "mandarin") return {
    pin: {
      // ordered common→rare (picks are frequency-skewed toward the front)
      cons: [B(1, 0, 0), B(3, 6, 1), B(2, 2, 0), B(3, 3, 0), B(4, 2, 0),      // d y sh j h
        B(1, 4, 1), B(2, 3, 0), B(0, 6, 1), B(4, 0, 0), B(0, 0, 0),           // l zh w g b
        B(3, 2, 0), B(1, 1, 1), B(0, 1, 1), B(1, 0, 2), B(3, 3, 2),           // x n m t q
        B(2, 3, 2), B(1, 3, 0), B(1, 2, 0), B(0, 2, 0), B(4, 0, 2),           // ch z s f k
        B(1, 3, 2), B(0, 0, 2), B(2, 2, 1), NB(4, 1, 1)],                     // c p r ng
      vows: [VB(2, 1, 0), VB(0, 0, 0), VB(1, 2, 1), VB(0, 2, 1), VB(1, 2, 0), VB(0, 0, 1)], // a i o u e ü
      // exact pinyin finals: onsets are singles only; codas n/ng; the
      // licensed diphthong set is real pinyin (ai ei ao ou ia ie ua uo)
      diphs: [[VB(2, 1, 0), VB(0, 0, 0)], [VB(1, 2, 0), VB(0, 0, 0)], [VB(2, 1, 0), VB(1, 2, 1)], [VB(1, 2, 1), VB(0, 2, 1)],
        [VB(0, 0, 0), VB(2, 1, 0)], [VB(0, 0, 0), VB(1, 2, 0)], [VB(0, 2, 1), VB(2, 1, 0)], [VB(0, 2, 1), VB(1, 2, 1)]],
    },
    rom: {
      "c:0,0,0": "b", "c:0,0,2": "p", "c:0,1,1": "m", "c:0,2,0": "f",
      "c:1,0,0": "d", "c:1,0,2": "t", "c:1,1,1": "n", "c:1,4,1": "l",
      "c:4,0,0": "g", "c:4,0,2": "k", "c:4,2,0": "h",
      "c:3,3,0": "j", "c:3,3,2": "q", "c:3,2,0": "x",
      "c:2,3,0": "zh", "c:2,3,2": "ch", "c:2,2,0": "sh", "c:2,2,1": "r",
      "c:1,3,0": "z", "c:1,3,2": "c", "c:1,2,0": "s",
      "c:4,1,1": "ng", "c:0,6,1": "w", "c:3,6,1": "y",
      "v:2,1,0": "a", "v:1,2,1": "o", "v:1,2,0": "e", "v:0,0,0": "i", "v:0,2,1": "u", "v:0,0,1": "u",
    },
  };
  if (kind === "russian") {
    // ordered common→rare: t n s r v l k d m p z b g ch sh f zh kh ts
    const hard = [B(1, 0, 0), B(1, 1, 1), B(1, 2, 0), B(1, 5, 1), B(0, 2, 1),
      B(1, 4, 1), B(4, 0, 0), B(1, 0, 1), B(0, 1, 1), B(0, 0, 0),
      B(1, 2, 1), B(0, 0, 1), B(4, 0, 1), B(3, 3, 0), B(2, 2, 0),
      B(0, 2, 0), B(2, 2, 1), B(4, 2, 0), B(1, 3, 0)];
    const soft = hard.filter(b => b.m <= 2 && b.p <= 1).map(b => ({ ...b, s: 1 }));
    return { pin: { cons: [...hard, ...soft],
      vows: [VB(2, 1, 0), VB(1, 2, 1), VB(1, 0, 0), VB(0, 0, 0), VB(0, 2, 1)] }, rom: null };  // a o e i u
  }
  if (kind === "english") return {
    // ordered common→rare: t n s d l r m k w b p h f v g y ng z ch j sh th dh
    // (no ʒ — English basically never uses it in names)
    pin: (() => {
      const t = B(1, 0, 0), n = B(1, 1, 1), s = B(1, 2, 0), d = B(1, 0, 1), l = B(1, 4, 1), r = B(1, 5, 1),
        m = B(0, 1, 1), k = B(4, 0, 0), w = B(0, 6, 1), b = B(0, 0, 1), p = B(0, 0, 0), h = B(7, 2, 0),
        f = B(0, 2, 0), v = B(0, 2, 1), g = B(4, 0, 1), y = B(3, 6, 1), ng = NB(4, 1, 1), z = B(1, 2, 1),
        ch = B(3, 3, 0), j = B(3, 3, 1), sh = B(3, 2, 0), th = B(8, 2, 0), dh = B(8, 2, 1);
      return {
        cons: [t, n, s, d, l, r, m, k, w, b, p, h, f, v, g, y, ng, z, ch, j, sh, th, dh],
        vows: [VB(0, 0, 0), VB(0, 1, 0), VB(0, 2, 1), VB(0, 2, 0), VB(1, 0, 0), VB(1, 1, 0),
          VB(1, 2, 1), VB(1, 2, 0), VB(2, 0, 0), VB(2, 1, 0), VB(2, 2, 1)],
        // ENGLISH'S LITERAL LEGAL SYLLABARY — the real ~30 onsets, real
        // codas, real five diphthongs. Nothing outside these ever appears.
        onsets: [
          [t], [n], [s], [d], [l], [r], [m], [k], [w], [b], [p], [h], [f], [v], [g], [y], [z], [ch], [j], [sh], [th], [dh],
          [b, r], [t, r], [d, r], [k, r], [g, r], [p, r], [f, r], [th, r], [sh, r],
          [b, l], [k, l], [g, l], [p, l], [f, l], [s, l],
          [t, w], [k, w], [s, w],
          [s, m], [s, n], [s, p], [s, t], [s, k],
          [s, p, r], [s, t, r], [s, k, r], [s, p, l],
        ],
        codas: [
          [t], [n], [d], [s], [l], [r], [k], [m], [p], [z], [ng], [th], [f], [ch], [g], [b], [sh],
          [n, t], [n, d], [s, t], [s, k], [l, d], [l, t], [r, n], [r, d], [r, k], [r, t], [m, p], [ng, k], [t, s], [f, t], [k, t],
        ],
        // ai · ou · ei · au · oi — the actual English diphthong inventory
        diphs: [[VB(2, 1, 0), VB(0, 0, 0)], [VB(1, 2, 1), VB(0, 2, 1)], [VB(1, 0, 0), VB(0, 0, 0)],
          [VB(2, 1, 0), VB(0, 2, 1)], [VB(1, 2, 1), VB(0, 0, 0)]],
      };
    })(),
    rom: { "c:8,2,1": "th" },                     // ð is SPELLED th, like þ (this/thin)
  };
  return null;
}

/** Turn an existing language record into a pinned reference (in place). */
export function applyReference(lang, kind) {
  lang.prof = refProfile(kind, lang.seed);
  lang.rules = [];
  // A shape is a different FAMILY, not a costume. The semantic layer —
  // colexification, derivation pathways, closed-class and affix-source
  // rolls — all hashes on famSeed, which the profile overwrite never
  // touched: the same seed in four shapes produced one language in four
  // costumes (identical 'king ‹ great man', identical colex, identical
  // adposition etymologies — a fresh reader caught it). Fold the shape
  // into the family seed so each shape consumes its own entropy; the
  // pinned PHONOLOGY (inventory/syllabary/romanization) rides lang.pin
  // and holds regardless.
  lang.famSeed = hash32(lang.seed, "shape:" + kind) >>> 0;
  const r = refPin(kind);
  if (r) { lang.pin = r.pin; if (r.rom) lang.prof.rom = r.rom; }
  lang.gen++;                              // invalidate compiled caches
  return lang;
}

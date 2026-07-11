// ── Reference languages: exact-inventory labelled scenarios ──────────────
//
// Hand-set dial profiles + pinned phoneme inventories for real-language
// SHAPES (docs/language-comprehensive-spec.md capability bar). These are
// scenario DATA, not mechanisms — the cardinal rules permit them the same
// way they permit the pinned Earth hearths. Generated words use only the
// real language's sounds in its real romanization; the words themselves
// remain procedural (no real lexicon ships).

import { rollProfile } from "./languagePhonology.js";

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
    romTaste: 0, palatalFront: true,              // j/q/x only before front vowels; g/k/h never before i
    toneMarks: true, medialSonorant: true,
  });
  if (kind === "russian") Object.assign(p, {
    sylC: 3, onDepth: 3, coDepth: 3, sCluster: true, nasalCoda: false,
    tone: 0, consN: 34, vowelN: 5, palatalized: true, voiced: true, aspirated: false,
    retroflex: false, uvular: false, pharyngeal: false, ejective: false, prenasal: false, dental: false,
    frontRound: false, harmony: "none", morph: "fus", stress: "mobile",
    sylMin: 1, sylMax: 3, patro: "suf", gendered: true, diph: false, longV: false, nasalV: false,
    romTaste: 0,
  });
  if (kind === "english") Object.assign(p, {
    sylC: 3, onDepth: 3, coDepth: 3, sCluster: true, nasalCoda: false,
    tone: 0, consN: 24, vowelN: 11, palatalized: false, voiced: true, aspirated: false,
    retroflex: false, uvular: false, pharyngeal: false, ejective: false, prenasal: false, dental: true,
    frontRound: false, harmony: "none", morph: "fus", stress: "mobile",
    sylMin: 1, sylMax: 3, patro: "suf", gendered: false, diph: true, longV: false, nasalV: false,
    romTaste: 0, c2LiqOnly: true,                 // pr/tr/fl/sl — never fn-/hn-/thn-
    ortho: "en",                                  // spelling conventions: -y not -i, -ve, -dge, -ck, -ff
    codaBias: 1.5,                                // stress-timed: closed syllables are the norm
    medialSonorant: true,                         // win-ter, sil-ver — never shod-pug
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
  const r = refPin(kind);
  if (r) { lang.pin = r.pin; if (r.rom) lang.prof.rom = r.rom; }
  lang.gen++;                              // invalidate compiled caches
  return lang;
}

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
  });
  if (kind === "russian") Object.assign(p, {
    sylC: 3, onDepth: 3, coDepth: 3, sCluster: true, nasalCoda: false,
    tone: 0, consN: 34, vowelN: 5, palatalized: true, voiced: true, aspirated: false,
    retroflex: false, uvular: false, pharyngeal: false, ejective: false, prenasal: false, dental: false,
    frontRound: false, harmony: "none", morph: "fus", stress: "mobile",
    sylMin: 1, sylMax: 3, patro: "suf", gendered: true, diph: false, longV: false, nasalV: false,
  });
  if (kind === "english") Object.assign(p, {
    sylC: 3, onDepth: 3, coDepth: 3, sCluster: true, nasalCoda: false,
    tone: 0, consN: 24, vowelN: 11, palatalized: false, voiced: true, aspirated: false,
    retroflex: false, uvular: false, pharyngeal: false, ejective: false, prenasal: false, dental: true,
    frontRound: false, harmony: "none", morph: "fus", stress: "mobile",
    sylMin: 1, sylMax: 3, patro: "suf", gendered: false, diph: true, longV: true, nasalV: false,
  });
  return p;
}

/** Exact phoneme pin + romanization for a reference kind (null for none). */
export function refPin(kind) {
  if (kind === "mandarin") return {
    pin: {
      cons: [B(0, 0, 0), B(0, 0, 2), B(0, 1, 1), B(0, 2, 0),        // b p m f
        B(1, 0, 0), B(1, 0, 2), B(1, 1, 1), B(1, 4, 1),             // d t n l
        B(4, 0, 0), B(4, 0, 2), B(4, 2, 0),                         // g k h
        B(3, 3, 0), B(3, 3, 2), B(3, 2, 0),                         // j q x
        B(2, 3, 0), B(2, 3, 2), B(2, 2, 0), B(2, 2, 1),             // zh ch sh r
        B(1, 3, 0), B(1, 3, 2), B(1, 2, 0),                         // z c s
        NB(4, 1, 1), B(0, 6, 1), B(3, 6, 1)],                       // ng w y
      vows: [VB(2, 1, 0), VB(1, 2, 1), VB(1, 2, 0), VB(0, 0, 0), VB(0, 2, 1), VB(0, 0, 1)], // a o e i u ü
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
    const hard = [B(0, 0, 0), B(0, 0, 1), B(1, 0, 0), B(1, 0, 1), B(4, 0, 0), B(4, 0, 1),
      B(0, 2, 0), B(0, 2, 1), B(1, 2, 0), B(1, 2, 1),
      B(2, 2, 0), B(2, 2, 1), B(4, 2, 0), B(1, 3, 0), B(3, 3, 0),
      B(0, 1, 1), B(1, 1, 1), B(1, 4, 1), B(1, 5, 1)];
    const soft = hard.filter(b => b.m <= 2 && b.p <= 1).map(b => ({ ...b, s: 1 }));
    return { pin: { cons: [...hard, ...soft],
      vows: [VB(0, 0, 0), VB(1, 0, 0), VB(2, 1, 0), VB(1, 2, 1), VB(0, 2, 1)] }, rom: null };
  }
  if (kind === "english") return {
    pin: { cons: [B(0, 0, 0), B(0, 0, 1), B(1, 0, 0), B(1, 0, 1), B(4, 0, 0), B(4, 0, 1),
      B(0, 2, 0), B(0, 2, 1), B(8, 2, 0), B(8, 2, 1), B(1, 2, 0), B(1, 2, 1),
      B(2, 2, 0), B(2, 2, 1), B(3, 3, 0), B(3, 3, 1), B(7, 2, 0),
      B(0, 1, 1), B(1, 1, 1), NB(4, 1, 1), B(1, 4, 1), B(1, 5, 1), B(0, 6, 1), B(3, 6, 1)],
      vows: null }, rom: null };
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

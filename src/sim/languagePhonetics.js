// ── Phonetics: IPA + the phonetic plan for the vocalizer ──────────────────
//
// The feature bundles ARE the phonology; IPA is simply a second rendering
// of them — romanization is the language's own clothes, IPA the linguist's
// uniform. Everything here is a pure function of the record (no audio, no
// state): the Lab owns the speakers, the sim stays silent.
//
// The one load-bearing subtlety is TONE PARITY: renderWord assigns each
// syllable's tone mark as hash32(preToneRomanizedSyllable, index, tseed) % 4
// (ā á ǎ à). phoneticPlan() rebuilds that exact string and hashes the same
// way, so the contour you HEAR (and the tone letters ipaOf prints) always
// match the marks you READ. Stress is the profile dial the romanization
// never writes — audible here, exactly as in life.

import { hash32 } from "./peopleSim/rng.js";
import { romanizeC, romanizeV } from "./languagePhonology.js";

// ── consonants: place (rows of romanizeC's own grid) × manner, vl/vd ──────
// places: 0 labial · 1 alveolar · 2 retroflex · 3 palatal · 4 velar ·
//         5 uvular · 6 pharyngeal · 7 glottal · 8 dental
const IPA_PLAIN = {
  "0,0": "p", "1,0": "t", "2,0": "ʈ", "3,0": "c", "4,0": "k", "5,0": "q", "6,0": "ʡ", "7,0": "ʔ", "8,0": "t̪",
  "0,2": "f", "1,2": "s", "2,2": "ʂ", "3,2": "ɕ", "4,2": "x", "5,2": "χ", "6,2": "ħ", "7,2": "h", "8,2": "θ",
  "0,3": "p͡f", "1,3": "t͡s", "2,3": "ʈ͡ʂ", "3,3": "t͡ɕ", "4,3": "k͡x", "5,3": "q͡χ", "8,3": "t͡θ",
  "1,4": "ɬ", "2,4": "ɭ̊", "3,4": "ʎ̥", "8,4": "l̪̊",
  "1,5": "r̥", "2,5": "ɽ̊",
};
const IPA_VOICED = {
  // a "voiced" glottal/pharyngeal stop (the intervocalic voicing law can
  // mint one) is creaky-voiced at best — the voicing diacritic keeps the
  // symbol honest AND distinct from its voiceless twin
  "0,0": "b", "1,0": "d", "2,0": "ɖ", "3,0": "ɟ", "4,0": "ɡ", "5,0": "ɢ", "6,0": "ʡ̬", "7,0": "ʔ̬", "8,0": "d̪",
  "0,2": "v", "1,2": "z", "2,2": "ʐ", "3,2": "ʑ", "4,2": "ɣ", "5,2": "ʁ", "6,2": "ʕ", "7,2": "ɦ", "8,2": "ð",
  "0,3": "b͡v", "1,3": "d͡z", "2,3": "ɖ͡ʐ", "3,3": "d͡ʑ", "4,3": "ɡ͡ɣ", "5,3": "ɢ͡ʁ", "8,3": "d͡ð",
  "0,1": "m", "1,1": "n", "2,1": "ɳ", "3,1": "ɲ", "4,1": "ŋ", "5,1": "ɴ", "8,1": "n̪",
  "1,4": "l", "2,4": "ɭ", "3,4": "ʎ", "4,4": "ʟ", "8,4": "l̪",
  "0,5": "ʙ", "1,5": "r", "2,5": "ɽ", "5,5": "ʀ",
  "0,6": "w", "1,6": "ɹ", "2,6": "ɻ", "3,6": "j", "4,6": "ɰ", "7,6": "ɦ",
};

/** IPA for one consonant bundle. Total (falls back sanely off-grid) and
 *  injective over any inventory the generator or its sound laws can mint. */
export function ipaC(b) {
  const k = b.p + "," + b.m;
  let s = (b.l === 1 || b.l === 4 || b.m === 1 || b.m >= 4) && IPA_VOICED[k] ? IPA_VOICED[k]
    : (IPA_PLAIN[k] ?? IPA_VOICED[k] ?? "ʔ");
  if (b.l === 0 && b.m <= 3 && IPA_PLAIN[k]) s = IPA_PLAIN[k];    // devoiced obstruents keep the voiceless symbol
  if (b.l === 2) s += "ʰ";                                        // aspirated
  if (b.l === 3) s += "ʼ";                                        // ejective
  if (b.l === 4) s = (b.p === 0 ? "ᵐ" : b.p >= 3 && b.p <= 5 ? "ᵑ" : "ⁿ") + s;   // prenasalized
  if (b.s === 1) s += "ʲ";                                        // palatalized
  if (b.s === 2) s += "ʷ";                                        // labialized
  return s;
}

// vowels: height 0 high · 1 mid · 2 low; backness 0 front · 1 central ·
// 2 back; the low-central-rounded cell borrows ɔ so every cell stays
// distinct on the page (ɒ̈ is diacritic soup no reader parses)
const IPA_V = {
  "0,0,0": "i", "0,0,1": "y", "0,1,0": "ɨ", "0,1,1": "ʉ", "0,2,0": "ɯ", "0,2,1": "u",
  "1,0,0": "e", "1,0,1": "ø", "1,1,0": "ə", "1,1,1": "ɵ", "1,2,0": "ɤ", "1,2,1": "o",
  "2,0,0": "æ", "2,0,1": "ɶ", "2,1,0": "a", "2,1,1": "ɔ", "2,2,0": "ɑ", "2,2,1": "ɒ",
};

/** IPA for one vowel bundle (quality + nasal tilde + length mark). */
export function ipaV(v) {
  let s = IPA_V[v.h + "," + v.b + "," + v.r] || "ə";
  if (v.n) s += "̃";                                         // nasalized ṽ
  if (v.lg) s += "ː";
  return s;
}

// contour letters for the four melody slots renderWord writes as ā á ǎ à
export const TONE_LETTERS = ["˥", "˧˥", "˨˩˦", "˥˩"];   // high level · rising · dipping · falling
// f0 targets for the same four melodies (relative to the speaker's base) —
// the Lab's synthesizer reads these so pitch and mark can never disagree
export const TONE_SHAPES = [[1.3, 1.3], [0.95, 1.3], [1.05, 0.8, 1.15], [1.35, 0.85]];

/** The phonetic plan for an internal form: per-syllable segments (IPA +
 *  raw features, for a synthesizer), the tone-melody index renderWord
 *  would mark (parity by construction), and the stress position the
 *  spelling never shows. Pure; JSON-safe. */
export function phoneticPlan(lang, form) {
  const prof = lang.prof;
  const seg = (c) => ({ ipa: ipaC(c), p: c.p, m: c.m, l: c.l, s: c.s });
  const vseg = (v) => ({ ipa: ipaV(v), h: v.h, b: v.b, r: v.r, n: v.n || 0, lg: v.lg || 0 });
  const syls = form.syls.map((s, i) => {
    // the SAME pre-tone romanized syllable renderWord hashes for its melody
    let rsyl = "";
    for (const c of s.on) rsyl += romanizeC(c, prof.romTaste, prof.rom, prof.orthoStyle);
    for (const v of s.nu) rsyl += romanizeV(v, prof.rom);
    for (const c of s.co) rsyl += romanizeC(c, prof.romTaste, prof.rom, prof.orthoStyle);
    return {
      on: s.on.map(seg), nu: s.nu.map(vseg), co: s.co.map(seg),
      tone: prof.tone > 0 && rsyl ? hash32(rsyl, i, form.tseed || 0) % 4 : null,
    };
  });
  // stress: tone languages carry melody instead; monosyllables need none;
  // mobile stress is fixed per WORD off the same melody seed (deterministic)
  const n = syls.length;
  const stress = prof.tone > 0 || n < 2 ? -1
    : prof.stress === "init" ? 0
    : prof.stress === "final" ? n - 1
    : prof.stress === "penult" ? Math.max(0, n - 2)
    : hash32(form.tseed || 0, "stress", n) % n;
  return { syls, stress, tone: prof.tone || 0 };
}

/** IPA transcription of an internal form: ˈstress, syllable dots, tone
 *  letters — [ˈsaŋ.gʷa] / [pa˥˩.tɕi˧˥] style (brackets are the caller's). */
export function ipaOf(lang, form) {
  const plan = phoneticPlan(lang, form);
  return plan.syls.map((s, i) =>
    (i === plan.stress ? "ˈ" : "") +
    [...s.on, ...s.nu, ...s.co].map(x => x.ipa).join("") +
    (s.tone != null ? TONE_LETTERS[s.tone] : "")
  ).join(".");
}

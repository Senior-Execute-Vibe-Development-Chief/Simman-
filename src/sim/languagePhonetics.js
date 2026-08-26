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
const IPA_CLICK = { 8: "ǀ", 1: "ǃ", 4: "ǁ", 3: "ǂ", 0: "ʘ" };   // p carries the click TYPE under m=7
export function ipaC(b) {
  if (b.m === 7) {
    // clicks (phase 4): the pipe letters, with their accompaniments as
    // prefixes/suffixes — ɡ͡ǃ voiced, ŋ͡ǃ nasal, ǃʰ aspirated. Injective:
    // no non-click bundle ever renders a pipe letter.
    let s = IPA_CLICK[b.p] || "ǃ";
    if (b.l === 1) s = "ɡ͡" + s;
    else if (b.l === 4) s = "ŋ͡" + s;
    else if (b.l === 2) s = s + "ʰ";
    return s;
  }
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

// −ATR (lax) counterparts of the tense qualities (phase 4); off-table lax
// vowels wear the retracted-tongue-root diacritic so the pair stays distinct
const IPA_LAX = { i: "ɪ", y: "ʏ", ɨ: "ɪ̈", ɯ: "ɯ̽", u: "ʊ", e: "ɛ", ø: "œ", ə: "ɜ", ɵ: "ɞ", ɤ: "ʌ", o: "ɔ" };
/** IPA for one vowel bundle (quality + ATR + phonation + nasal + length). */
export function ipaV(v) {
  let s = IPA_V[v.h + "," + v.b + "," + v.r] || "ə";
  if (v.atr) s = IPA_LAX[s] || s + "̙";                     // −ATR: ɪ ʊ ɛ ɔ
  if (v.ph === 1) s += "̤";                                  // breathy voice
  else if (v.ph === 2) s += "̰";                             // creaky voice
  if (v.n) s += "̃";                                         // nasalized ṽ
  if (v.lg) s += "ː";
  return s;
}

// ── the prosodic character: what makes a language FEEL like itself ────────
// Segments are half a language's identity at most; the other half is the
// MUSIC — rhythm class, vowel reduction, tempo, pitch frame, melodic range,
// stress force. You tell Mandarin from Spanish from Russian in two seconds
// of muffled speech through a wall, on prosody alone. Derived from the
// typology the profile already rolled (the real correlations: tone/isolating
// → syllable-timed; heavy clusters + fusional → stress-timed with reduction;
// agglutinative → even light-syllable trains) plus family-seeded rolls for
// the free dimensions (a language's own tempo and voice frame). Pure and
// deterministic; sisters inherit the family's music.
export function prosodyOf(lang) {
  const prof = lang.prof;
  const roll = (tag) => hash32(lang.famSeed >>> 0, "pros", tag) / 4294967296;
  const rhythm = prof.tone > 0 || prof.morph === "iso" ? "syllable"
    : prof.morph === "agg" && prof.sylC <= 1 ? "even"
    : prof.sylC >= 2 || prof.stress === "mobile" ? "stress"
    : roll("rhy") < 0.5 ? "stress" : "even";
  // vowel reduction is the stress-timed signature: unstressed vowels
  // centralize toward schwa and shorten (English, Russian); syllable-timed
  // tongues keep every vowel full (Spanish, Italian)
  const reduce = rhythm === "stress" ? 0.45 + roll("red") * 0.35 : rhythm === "even" ? 0.12 : 0;
  return {
    rhythm, reduce,
    f0k: 0.85 + roll("f0") * 0.3,                       // the language's own pitch frame
    rate: (rhythm === "syllable" ? 1.06 : 1) * (0.9 + roll("rate") * 0.25),   // tempo
    range: prof.tone > 0 ? 1 : 0.75 + roll("rng") * 0.55,   // melodic sweep (tone carries its own)
    stressGain: rhythm === "stress" ? 1.25 + roll("sg") * 0.2 : rhythm === "even" ? 1.1 : 1.04,
    toneDepth: prof.tone === 2 ? 1.4 : prof.tone === 1 ? 1.15 : 1,   // contour tones dig deeper
    finalLen: 1.1 + roll("fin") * 0.35,                 // phrase-final drawl
    ...(prof.pros || {}),                               // reference pins (scenario data, like the inventory)
  };
}
export const DEFAULT_PROS = { rhythm: "even", reduce: 0, f0k: 1, rate: 1, range: 1, stressGain: 1.13, toneDepth: 1, finalLen: 1.12 };

// ── the articulatory setting: the language's segmental HABITS ─────────────
// Beyond which phonemes exist, real languages differ in how they say the
// same ones — the accent. Each habit is gated by the real constraint that
// governs it cross-linguistically, then rolled per family:
//   · vot — voice onset time on voiceless stops: bare short-lag (Romance)
//     to a strong aspirated puff (English, German). A language whose
//     phonology CONTRASTS aspiration keeps plain stops bare, or the puff
//     would erase the phonemic distinction (Mandarin, Hindi).
//   · finalDevoice — word-final voiced obstruents harden (Russian, German,
//     Turkish); only meaningful where voiced obstruents exist.
//   · soften — plain coronals/velars take a ʲ colour before front vowels
//     (the Russian setting); suppressed where palatalization is phonemic,
//     for the same contrast-preserving reason as VOT.
//   · darkL — coda /l/ velarizes to ɫ (English, Russian) or stays clear
//     everywhere (Spanish, French).
//   · dental — coronals articulate dental (Spanish t̪) vs alveolar (English).
export function accentOf(lang) {
  const prof = lang.prof;
  const roll = (tag) => hash32(lang.famSeed >>> 0, "acc", tag) / 4294967296;
  return {
    vot: prof.aspirated ? 0.12 : roll("vot"),
    finalDevoice: prof.voiced ? roll("fdv") < 0.35 : false,
    soften: prof.palatalized ? 0 : roll("soft") < 0.22 ? 0.5 + roll("soft2") * 0.5 : 0,
    darkL: roll("dkl") < 0.45,
    dental: prof.dental ? 1 : roll("den") < 0.3 ? 1 : 0,
    ...(prof.acc || {}),                                // reference pins
  };
}
export const DEFAULT_ACCENT = { vot: 0.3, finalDevoice: false, soften: 0, darkL: false, dental: 0 };

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
  const vseg = (v) => ({ ipa: ipaV(v), h: v.h, b: v.b, r: v.r, n: v.n || 0, lg: v.lg || 0, ph: v.ph || 0, atr: v.atr || 0 });
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
  // mobile stress is fixed per WORD off the same melody seed (deterministic).
  // PITCH ACCENT (phase 4): the accented syllable is the prominence — SAME
  // tseed recipe renderWord marks with the acute, so mark and melody agree
  // by construction; the flag tells the synthesizer to realize it as pitch.
  const n = syls.length;
  const pacc = !prof.tone && prof.pitchAccent && n > 1 ? hash32(form.tseed || 0, "pacc") % n : -1;
  const stress = pacc >= 0 ? pacc
    : prof.tone > 0 || n < 2 ? -1
    : prof.stress === "init" ? 0
    : prof.stress === "final" ? n - 1
    : prof.stress === "penult" ? Math.max(0, n - 2)
    : hash32(form.tseed || 0, "stress", n) % n;
  return { syls, stress, tone: prof.tone || 0, pitchAccent: pacc >= 0, pros: prosodyOf(lang), acc: accentOf(lang) };
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

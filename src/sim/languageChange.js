// ── Sound change as RULES over feature bundles (spec phase L4) ───────────
//
// Drift/branch no longer add/remove letter-strings: a language accumulates a
// RULE LOG (small integers, persisted on the record), and every inherited
// root replays the log at synthesis time. Because the same rules hit every
// inherited word, sister languages differ by REGULAR CORRESPONDENCES — the
// same ancestral place-name surfaces as kin forms across a family, and a
// reader can do comparative linguistics on the map. Rules transform the
// internal feature-bundle form; romanization happens after.

import { SONORITY } from "./languagePhonology.js";

// Rule ids are persisted — NEVER renumber, only append.
export const RULES = [
  "lenite",        // 0: non-initial plain stops → fricatives (same place)
  "palatalize",    // 1: velars → palatal affricates before front vowels
  "finalVLoss",    // 2: word-final short vowel drops (if codas are legal)
  "codaLoss",      // 3: final obstruent codas drop
  "devoice",       // 4: voiced stops → voiceless
  "voice",         // 5: voiceless stops voice between vowels
  "raise",         // 6: mid vowels raise (e→i, o→u) chain shift
  "rhotacize",     // 7: intervocalic s → r
  "hLoss",         // 8: glottal fricatives drop from onsets
  "simplify",      // 9: onset clusters lose their first member
  "umlaut",        // 10: back vowels front before a front-vowel syllable
  "nasalizeV",     // 11: vowel + nasal coda → nasal vowel, coda drops
];

/** Which rules make sense for this profile (keeps drift in character). */
export function applicableRules(prof) {
  const out = [0, 1, 4, 5, 6, 7, 8, 10];
  if (prof.coDepth > 0 || prof.nasalCoda) out.push(2, 3, 11);
  if (prof.onDepth >= 2) out.push(9);
  return out;
}

const isFrontV = (v) => v.b === 0;

/** Apply one rule, in place, to an internal word form. */
export function applyRule(rule, w) {
  const syls = w.syls;
  switch (rule) {
    case 0: // lenite: non-initial onset plain stops → fricatives
      for (let i = 1; i < syls.length; i++) for (const c of syls[i].on)
        if (c.m === 0 && c.l <= 1 && c.p <= 4) c.m = 2;
      break;
    case 1: // palatalize velar stops/frics before front vowels
      for (const s of syls) {
        if (!s.nu.length || !isFrontV(s.nu[0])) continue;
        for (const c of s.on) if (c.p === 4 && (c.m === 0 || c.m === 2)) { c.p = 3; if (c.m === 0) c.m = 3; }
      }
      break;
    case 2: { // final short vowel drops (leaves the onset as a coda)
      if (syls.length < 2) break;
      const lastS = syls[syls.length - 1];
      if (lastS.nu.length === 1 && !lastS.nu[0].lg && !lastS.co.length && lastS.on.length === 1) {
        syls.pop();
        syls[syls.length - 1].co.push(...lastS.on);
      }
      break;
    }
    case 3: { // final obstruent codas drop
      const lastS = syls[syls.length - 1];
      lastS.co = lastS.co.filter(c => c.m > 3);
      break;
    }
    case 4: // devoice stops
      for (const s of syls) for (const c of [...s.on, ...s.co]) if (c.m === 0 && c.l === 1) c.l = 0;
      break;
    case 5: // voice stops between vowels (onset of non-initial syllables)
      for (let i = 1; i < syls.length; i++) if (!syls[i - 1].co.length)
        for (const c of syls[i].on) if (c.m === 0 && c.l === 0) c.l = 1;
      break;
    case 6: // raise mid vowels
      for (const s of syls) for (const v of s.nu) if (v.h === 1) v.h = 0;
      break;
    case 7: // rhotacism: s → r between vowels
      for (let i = 1; i < syls.length; i++) if (!syls[i - 1].co.length)
        for (const c of syls[i].on) if (c.m === 2 && c.p === 1 && c.l === 0) { c.m = 5; c.l = 1; }
      break;
    case 8: // h-loss from onsets
      for (const s of syls) s.on = s.on.filter(c => !(c.m === 2 && c.p >= 6));
      break;
    case 9: // cluster simplification: drop the lowest-sonority onset member
      for (const s of syls) if (s.on.length >= 2) {
        let lo = 0;
        for (let i = 1; i < s.on.length; i++) if (SONORITY[s.on[i].m] < SONORITY[s.on[lo].m]) lo = i;
        s.on.splice(lo, 1);
      }
      break;
    case 10: // umlaut: back vowel fronts when the NEXT syllable is front
      for (let i = 0; i + 1 < syls.length; i++) {
        const next = syls[i + 1].nu[0];
        if (next && isFrontV(next)) for (const v of syls[i].nu) if (v.b === 2) { v.b = 0; }
      }
      break;
    case 11: { // vowel nasalization: V + nasal coda → nasal V
      for (const s of syls) if (s.co.length && s.co[s.co.length - 1].m === 1) {
        s.co.pop();
        for (const v of s.nu) v.n = 1;
      }
      break;
    }
  }
  // guard: never let a word lose every syllable
  if (!w.syls.length || w.syls.every(s => !s.nu.length)) w.syls = [{ on: [], nu: [{ h: 2, b: 1, r: 0, n: 0, lg: 0 }], co: [] }];
  return w;
}

/** Replay a rule log over a word (mutates and returns it). */
export function applyRules(rules, w) {
  for (const r of rules) applyRule(r, w);
  return w;
}

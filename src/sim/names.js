// ── Seeded naming language ──
//
// Each culture carries a compact generative phonology — consonant and vowel
// inventories, syllable templates, joining rules, and characteristic
// suffixes — seeded once from the culture's langSeed. Every name the culture
// coins (settlements, realms, dynasties, people) is drawn from the same
// sound system, so a map region READS as one people: Velara, Velkoth and
// the Kingdom of Velmaret are recognisably kin, and their neighbours
// across the sea sound like strangers.
//
// Deterministic: makeLanguage(seed) always builds the same language, and
// name(n) for the same n is always the same word — callers keep a per-
// culture counter so names never depend on call order.

import { mkRng, hash32 } from "./peopleSim/rng.js";

// Consonant banks — a language samples a subset of one or two banks, which
// gives each tongue a recognisable consonant "flavour".
const C_BANKS = [
  ["k", "t", "p", "s", "m", "n", "r", "l"],                       // crisp
  ["g", "d", "b", "z", "v", "m", "n", "r"],                       // voiced
  ["kh", "th", "sh", "h", "t", "k", "s", "n", "r"],               // breathy
  ["f", "v", "w", "l", "m", "n", "s", "t"],                       // soft
  ["q", "k", "z", "x", "t", "s", "m", "n", "r"],                  // sharp
  ["ch", "j", "y", "t", "k", "m", "n", "l", "w"],                 // palatal
  ["br", "dr", "gr", "tr", "kr", "m", "n", "l", "s", "t"],        // clustered
];
const V_BANKS = [
  ["a", "e", "i", "o", "u"],
  ["a", "i", "u", "ai", "ia"],
  ["a", "e", "o", "ou", "ea"],
  ["e", "i", "y", "ei", "ie"],
  ["a", "o", "u", "au", "oa"],
];
// Realm-name suffixes by flavour family; a language picks two.
const REALM_SUFFIX = [
  ["ia", "ara", "oria", "ana"],
  ["eth", "oth", "ath", "und"],
  ["mark", "gard", "heim", "stad"],
  ["dor", "var", "mor", "tan"],
  ["esse", "elle", "aine", "ois"],
];
const DYN_SUFFIX = ["id", "ene", "ar", "ian", "ite", "ald"];

function pickN(rng, arr, n) {
  const pool = arr.slice(), out = [];
  for (let i = 0; i < n && pool.length; i++) out.push(pool.splice(rng.int(pool.length), 1)[0]);
  return out;
}

export function makeLanguage(seed) {
  const rng = mkRng(seed >>> 0);
  const bank1 = C_BANKS[rng.int(C_BANKS.length)];
  const bank2 = C_BANKS[rng.int(C_BANKS.length)];
  const onsets = [...new Set([...pickN(rng, bank1, 4 + rng.int(3)), ...pickN(rng, bank2, 2)])];
  const codas = pickN(rng, ["n", "r", "l", "s", "th", "k", "m", "d", ""], 3 + rng.int(2));
  const vowels = V_BANKS[rng.int(V_BANKS.length)];
  const minSyl = 2, maxSyl = 2 + (rng() < 0.45 ? 1 : 0);
  const codaProb = 0.25 + rng() * 0.4;
  const realmSufs = pickN(rng, REALM_SUFFIX[rng.int(REALM_SUFFIX.length)], 2);
  const dynSuf = DYN_SUFFIX[rng.int(DYN_SUFFIX.length)];
  // a couple of personal-name endings, gendered by convention
  const persEndA = vowels[rng.int(vowels.length)];
  const persEndB = codas[rng.int(codas.length)] || "n";

  function syllable(r) {
    let s = onsets[r.int(onsets.length)] + vowels[r.int(vowels.length)];
    if (r() < codaProb) s += codas[r.int(codas.length)];
    return s;
  }
  function rawWord(r) {
    const n = minSyl + r.int(maxSyl - minSyl + 1);
    let w = "";
    for (let i = 0; i < n; i++) w += syllable(r);
    // trim awkward triple letters
    w = w.replace(/(.)\1\1+/g, "$1$1");
    return w;
  }
  const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1);

  return {
    seed,
    /** A fresh place/word name for stream index n. */
    word(n) { return cap(rawWord(mkRng(hash32(seed, "w", n)))); },
    /** Realm name, optionally derived from a seat's name (Rome → Romaria). */
    realmName(n, base) {
      const r = mkRng(hash32(seed, "r", n));
      const suf = realmSufs[r.int(realmSufs.length)];
      let stem = base ? String(base) : cap(rawWord(r));
      // fuse: strip a trailing vowel before a vowel-initial suffix
      if (/[aeiou]$/i.test(stem) && /^[aeiou]/i.test(suf)) stem = stem.slice(0, -1);
      return cap(stem + suf);
    },
    /** Personal name (gender flavours the ending only). */
    personName(n, female) {
      const r = mkRng(hash32(seed, "p", n));
      let w = rawWord(r);
      if (female) { if (!/[aeiou]$/i.test(w)) w += persEndA; }
      else if (/[aeiou]$/i.test(w) && r() < 0.6) w += persEndB;
      return cap(w);
    },
    /** Dynasty name, usually derived from the founder's name. */
    dynastyName(n, founderName) {
      const r = mkRng(hash32(seed, "d", n));
      let stem = founderName ? String(founderName) : cap(rawWord(r));
      if (/[aeiou]$/i.test(stem)) stem = stem.slice(0, -1);
      return cap(stem + dynSuf);
    },
  };
}

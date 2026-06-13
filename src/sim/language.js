// ── Languages: typological archetypes that actually sound different ──
//
// The earlier generator drew every tongue from ONE C(C)V(C) template over a
// shared phoneme pool, so they all read as the same generic "exotic conlang"
// — there was no London-vs-Beijing-vs-Honolulu contrast. Real languages differ
// FIRST in structure: syllable shape (strict CV vs heavy consonant clusters),
// characteristic sounds, word length, and recurring place-name suffixes.
//
// So each language is instantiated from a typological ARCHETYPE — a full
// profile (onset/coda shapes, vowel system, syllable-count, prefixes, suffixes)
// loosely modelled on a real family but not named after it. The archetype gives
// the STRUCTURE; the instance picks a specific subset of phonemes and suffixes
// (so two languages of one archetype still differ), and then EVOLVES:
//
//   DRIFT  — sound change with the generations (a sound falls out of use, a new
//            one enters, codas shift, words lengthen). Names already in the log
//            keep their old spelling; new ones sound shifted.
//   BRANCH — a daughter people's tongue = the parent's, drifted by DISTANCE
//            (a near dialect ≈ the parent; a far branch is generations removed).
//   BORROW — heavy contact lets a tongue adopt a sound from a neighbour.
//
// Archetype choice is biased by homeland CLIMATE (areal typology — deserts tend
// guttural, cold lands clustered, tropics open/CV), so a region's languages
// share a family resemblance.

import { mkRng, hash32 } from "./peopleSim/rng.js";

// ── Typological archetypes ───────────────────────────────────────────────
// onsets/codas hold whole strings (incl. clusters like "str","nd"); "" = none.
// nuclei may bake in nasal finals ("ang","ing") for languages with no coda slot.
const ARCHETYPES = {
  // Short, CV with nasal finals, sibilant/palatal onsets, no clusters — a
  // monosyllabic-morpheme feel. (Chang-an, Bei-jing, Luo-yang.)
  meridian: {
    onsets: ["", "b", "p", "d", "t", "g", "k", "m", "n", "l", "h", "zh", "ch", "sh", "x", "q", "j", "y", "w"],
    nuclei: ["a", "e", "i", "o", "u", "ai", "ao", "ei", "ou", "ia", "an", "ang", "ong", "eng", "ing", "un", "iao"],
    codas: [""], syl: [1, 2], redup: false,
    realmSuf: ["", "guo", "zhou", "shan", "xia"], citySuf: ["", "jing", "yang", "zhou", "an"], dynSuf: ["", "shi", "tang"],
  },
  // Closed, clustered, coda stops, "th" — heavy and stony. (London, Hamburg,
  // Strand, York.) Recurring -burg/-ton/-stad city endings.
  nordling: {
    onsets: ["b", "d", "f", "g", "h", "k", "l", "m", "n", "r", "s", "t", "v", "w", "st", "str", "sp", "sk", "br", "gr", "dr", "tr", "fr", "sl", "sw", "th"],
    nuclei: ["a", "e", "i", "o", "u", "au", "ei", "ou", "y"],
    codas: ["", "n", "d", "t", "k", "rk", "nd", "ng", "rg", "ld", "lm", "st", "rn", "th", "ll"],
    syl: [1, 2], redup: false,
    realmSuf: ["land", "mark", "heim", "gard", "by"], citySuf: ["burg", "ton", "stad", "holm", "ford", "wick"], dynSuf: ["son", "ing", "sen"],
  },
  // Open, soft, vowel-final, light -ia/-ona endings. (Roma, Valencia, Firenze.)
  meridional: {
    onsets: ["b", "c", "d", "f", "g", "l", "m", "n", "p", "r", "s", "t", "v", "gl", "br", "tr", "gr", "fl", "ch", "gn"],
    nuclei: ["a", "e", "i", "o", "u", "ia", "io", "ie", "ua"],
    codas: ["", "n", "r", "l", "s"], syl: [2, 3], redup: false,
    realmSuf: ["ia", "ona", "enza", "ria", "agna"], citySuf: ["a", "o", "ino", "ano", "ella", "enza"], dynSuf: ["i", "ezzi", "ano", "elli"],
  },
  // Guttural, triconsonantal, 3-vowel. (Qasr, Khartoum, Hama, Najran.)
  desertic: {
    onsets: ["b", "d", "f", "h", "k", "l", "m", "n", "q", "r", "s", "t", "z", "sh", "kh", "gh", "'", "j", "w", "y"],
    nuclei: ["a", "i", "u", "aa", "ii", "uu"],
    codas: ["", "b", "d", "r", "m", "n", "s", "sh", "q", "t", "kh"], syl: [2, 2], redup: false,
    realmSuf: ["", "at", "iyya", "an"], citySuf: ["", "a", "an", "iyah"], dynSuf: ["i", "id", "ani", "un"],
  },
  // Clustered, hard, -sk/-grad/-ov. (Novgorod, Gdansk, Minsk, Brno.)
  borean: {
    onsets: ["b", "d", "g", "k", "l", "m", "n", "p", "r", "s", "t", "v", "z", "vl", "gr", "kr", "pr", "sk", "st", "zr", "dz", "ch", "zh", "sh"],
    nuclei: ["a", "e", "i", "o", "u", "y"],
    codas: ["", "n", "r", "v", "sk", "st", "ts", "ch", "zh", "rg"], syl: [2, 3], redup: false,
    realmSuf: ["ia", "grad", "sk", "ovia"], citySuf: ["ov", "sk", "grad", "ets", "ino", "itsa"], dynSuf: ["ov", "ich", "sky", "in"],
  },
  // Strict CV, tiny inventory, long words, reduplication. (Honolulu, Rarotonga,
  // Tahiti, Pago-Pago.)
  islander: {
    onsets: ["", "p", "t", "k", "m", "n", "h", "l", "w", "f", "ng", "r"],
    nuclei: ["a", "e", "i", "o", "u"],
    codas: [""], syl: [3, 4], redup: true,
    realmSuf: ["", "nui", "roa", "loa"], citySuf: ["", "a", "hiva"], dynSuf: ["", "i", "tea"],
  },
  // Prenasal CV, noun-class prefixes, reduplication. (Mombasa, Bukavu,
  // Kilimanjaro, Ouagadou.)
  savannic: {
    onsets: ["b", "d", "g", "k", "m", "n", "p", "t", "l", "mb", "nd", "ng", "mp", "nk", "ny", "ngw", "kw", "gw", "s", "z", "w"],
    nuclei: ["a", "e", "i", "o", "u"],
    codas: [""], syl: [2, 3], redup: true, prefix: ["", "u", "ki", "m", "ka", "bu", "wa"],
    realmSuf: ["", "land", "we"], citySuf: ["", "i", "u"], dynSuf: ["", "a"],
  },
  // Aspirated/retroflex, -pur/-abad/-nagar. (Jaipur, Kandahar, Patna, Mysore.)
  monsoonic: {
    onsets: ["b", "bh", "d", "dh", "g", "gh", "k", "kh", "p", "ph", "t", "th", "j", "ch", "m", "n", "r", "l", "s", "sh", "h", "v", "y"],
    nuclei: ["a", "i", "u", "e", "o", "aa", "ee"],
    codas: ["", "n", "r", "m", "sh", "t", "nd"], syl: [2, 3], redup: false,
    realmSuf: ["", "desh", "stan", "varta"], citySuf: ["pur", "abad", "nagar", "garh", "patnam", "ore"], dynSuf: ["a", "an", "i", "varman"],
  },
};
const ARCHE_KEYS = Object.keys(ARCHETYPES);

function pickN(rng, arr, n) {
  const pool = arr.slice(), out = [];
  for (let i = 0; i < n && pool.length; i++) out.push(pool.splice(rng.int(pool.length), 1)[0]);
  return out;
}

// Climate-biased archetype choice — areal typology. Always leaves a baseline
// chance for every archetype so a region can surprise you.
function pickArchetype(rng, climate) {
  const pool = ARCHE_KEYS.slice();   // baseline: one ticket each
  if (climate) {
    const t = climate.temp ?? 0.6, m = climate.moist ?? 0.5;
    const add = (k, w) => { for (let i = 0; i < w; i++) pool.push(k); };
    if (t > 0.78 && m < 0.38) add("desertic", 6);
    if (t > 0.74 && m > 0.6) { add("savannic", 4); add("islander", 3); add("monsoonic", 3); }
    if (t < 0.46) { add("borean", 5); add("nordling", 4); }
    if (t >= 0.5 && t <= 0.72) { add("meridional", 3); add("nordling", 2); add("borean", 1); }
    if (t >= 0.62 && t <= 0.82 && m > 0.45) add("meridian", 4);
    if (m > 0.7 && t > 0.6) add("islander", 2);
  }
  return pool[rng.int(pool.length)];
}

export function languagesOf(world) { return world.languages || (world.languages = new Map()); }
export function getLanguage(world, id) { return id >= 0 && world.languages ? world.languages.get(id) || null : null; }

/** A fresh root language from a climate-chosen archetype. */
export function foundLanguage(world, { seed, parentId = -1, climate, archeHint } = {}) {
  const id = world._nextLanguageId || 1;
  world._nextLanguageId = id + 1;
  const s = (seed ?? hash32(world.seed || 1, "lang", id)) >>> 0;
  const rng = mkRng(s);
  const arche = (archeHint && ARCHETYPES[archeHint]) ? archeHint : pickArchetype(rng, climate);
  const A = ARCHETYPES[arche];
  // Instance subset: keep most of the archetype's phonemes, drop a few, so two
  // tongues of one family share a sound but aren't identical.
  const sub = (arr, keepMin) => {
    if (arr.length <= keepMin) return arr.slice();
    const keep = Math.max(keepMin, Math.round(arr.length * (0.6 + rng() * 0.3)));
    return pickN(rng, arr, Math.min(keep, arr.length));
  };
  const lang = {
    id, seed: s, arche, flavor: arche, parentId, bornStep: world.step | 0, gen: 0,
    onsets: sub(A.onsets, 5),
    nuclei: sub(A.nuclei, 3),
    codas: A.codas.length > 1 ? sub(A.codas, 2) : A.codas.slice(),
    syl: A.syl.slice(),
    redup: !!A.redup,
    prefix: A.prefix ? A.prefix.slice() : null,
    realmSufs: pickN(rng, A.realmSuf, Math.min(3, A.realmSuf.length)),
    citySufs: A.citySuf ? pickN(rng, A.citySuf, Math.min(3, A.citySuf.length)) : [""],
    dynSufs: A.dynSuf ? A.dynSuf.slice() : ["id"],
  };
  languagesOf(world).set(id, lang);
  // A root tongue gets a little private drift so even same-archetype cradles
  // diverge.
  if (parentId < 0) for (let i = 0; i < 1 + rng.int(2); i++) driftLanguage(world, lang);
  return lang;
}

/** One step of sound change WITHIN the archetype (keeps the family feel). */
export function driftLanguage(world, lang) {
  const rng = mkRng(hash32(lang.seed, "drift", lang.gen + 1));
  const A = ARCHETYPES[lang.arche] || ARCHETYPES.meridional;
  const roll = rng();
  if (roll < 0.30 && lang.onsets.length > 6) {                 // a sound falls silent
    lang.onsets.splice(rng.int(lang.onsets.length), 1);
  } else if (roll < 0.55) {                                    // a new onset enters fashion
    const c = A.onsets.filter(x => !lang.onsets.includes(x));
    if (c.length) lang.onsets.push(c[rng.int(c.length)]);
  } else if (roll < 0.74) {                                    // vowel shift
    const c = A.nuclei.filter(x => !lang.nuclei.includes(x));
    if (c.length && rng() < 0.6) lang.nuclei.push(c[rng.int(c.length)]);
    else if (lang.nuclei.length > 3) lang.nuclei.splice(rng.int(lang.nuclei.length), 1);
  } else if (roll < 0.90 && A.codas.length > 1) {              // coda system shifts
    const c = A.codas.filter(x => !lang.codas.includes(x));
    if (c.length && rng() < 0.6) lang.codas.push(c[rng.int(c.length)]);
    else if (lang.codas.length > 1) lang.codas.splice(rng.int(lang.codas.length), 1);
  } else {                                                     // word-length fashion
    if (rng() < 0.5 && lang.syl[1] < lang.syl[0] + 3) lang.syl[1]++;
    else if (lang.syl[1] > lang.syl[0]) lang.syl[1]--;
  }
  lang.gen++;
}

/** A daughter tongue: the parent, drifted by DISTANCE (0..1). */
export function branchLanguage(world, parent, divergence = 0.4) {
  const id = world._nextLanguageId || 1;
  world._nextLanguageId = id + 1;
  const s = hash32(parent.seed, "branch", parent.gen, world.step) >>> 0;
  const child = {
    id, seed: s, arche: parent.arche, flavor: parent.arche, parentId: parent.id,
    bornStep: world.step | 0, gen: 0,
    onsets: parent.onsets.slice(), nuclei: parent.nuclei.slice(), codas: parent.codas.slice(),
    syl: parent.syl.slice(), redup: parent.redup, prefix: parent.prefix ? parent.prefix.slice() : null,
    realmSufs: parent.realmSufs.slice(), citySufs: parent.citySufs.slice(), dynSufs: parent.dynSufs.slice(),
  };
  languagesOf(world).set(id, child);
  const d = Math.max(0, Math.min(1, divergence));
  const steps = 1 + Math.round(d * 8);
  for (let i = 0; i < steps; i++) driftLanguage(world, child);
  // A far branch also evolves its own naming FASHION (new place-suffix set) —
  // the family resemblance stays, the surface look shifts.
  if (d > 0.55) {
    const rng = mkRng(hash32(s, "fashion"));
    const A = ARCHETYPES[child.arche];
    if (rng() < 0.7 && A.citySuf) child.citySufs = pickN(rng, A.citySuf, Math.min(3, A.citySuf.length));
    if (rng() < 0.5) child.realmSufs = pickN(rng, A.realmSuf, Math.min(3, A.realmSuf.length));
  }
  return child;
}

/** Areal contact: adopt a sound from a neighbour's speech (within reason). */
export function borrowFrom(world, lang, donor) {
  const rng = mkRng(hash32(lang.seed, "borrow", donor.id, lang.gen));
  const cand = donor.onsets.filter(c => c && !lang.onsets.includes(c));
  if (cand.length) { lang.onsets.push(cand[rng.int(cand.length)]); lang.gen++; }
}

// ── word synthesis ───────────────────────────────────────────────────────
// Phonotactics: clusters are allowed but not PILED — an onset cluster only at
// word start, a coda cluster only word-final, never a coda directly before a
// cluster onset (no "Slyllnyldholm"). Real languages constrain exactly this.
const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1);

function rawWord(lang, streamSeed) {
  const rng = mkRng(streamSeed >>> 0);
  const [lo, hi] = lang.syl;
  const nS = lo + (hi > lo ? rng.int(hi - lo + 1) : 0);
  const singles = lang.onsets.filter(c => c.length <= 1);     // pure single consonants (incl "")
  const shortCodas = lang.codas.filter(c => c.length <= 1);
  let w = "";
  if (lang.prefix && lang.prefix.length && rng() < 0.5) w += lang.prefix[rng.int(lang.prefix.length)];
  let prevCoda = false;
  for (let i = 0; i < nS; i++) {
    const isLast = i === nS - 1;
    // onset — no cluster right after a coda; long clusters only word-initial
    let on;
    if (prevCoda) on = singles.length ? singles[rng.int(singles.length)] : "";
    else {
      on = lang.onsets[rng.int(lang.onsets.length)];
      if (i > 0 && on.length >= 3 && singles.length && rng() < 0.75) on = singles[rng.int(singles.length)];
    }
    const nu = lang.nuclei[rng.int(lang.nuclei.length)];
    // coda — full set (incl clusters) only word-final; mid-word rare and single
    let co = "";
    if (lang.codas.length > 1) {
      if (isLast) co = lang.codas[rng.int(lang.codas.length)];
      else if (rng() < 0.26 && shortCodas.length) co = shortCodas[rng.int(shortCodas.length)];
    }
    prevCoda = co.length > 0;
    w += on + nu + co;
  }
  if (lang.redup && nS <= 2 && rng() < 0.3) w += w;            // reduplication (Pago-Pago, Wagga)
  return w.replace(/(.)\1\1+/g, "$1$1");
}

export function langWord(lang, n) {
  return cap(rawWord(lang, hash32(lang.seed, "w", lang.gen, n)));
}

/** A settlement name — a word plus (often) the family's place-suffix, which is
 *  what makes a region's cities recognisably kin (-burg, -pur, -grad, -jing). */
export function langPlaceName(lang, n) {
  const rng = mkRng(hash32(lang.seed, "place", lang.gen, n));
  let w = rawWord(lang, hash32(lang.seed, "pw", lang.gen, n));
  const suf = lang.citySufs[rng.int(lang.citySufs.length)];
  if (suf) {
    if (/[aeiou]$/i.test(w) && /^[aeiou]/i.test(suf)) w = w.slice(0, -1);
    w += suf;
  }
  return cap(w);
}

export function langRealmName(lang, n, base) {
  const rng = mkRng(hash32(lang.seed, "r", lang.gen, n));
  const suf = lang.realmSufs[rng.int(lang.realmSufs.length)];
  let stem = base ? String(base).replace(/(burg|ton|stad|pur|abad|grad|jing|ov|sk)$/i, "") : rawWord(lang, hash32(lang.seed, "rw", lang.gen, n));
  if (suf && /[aeiou]$/i.test(stem) && /^[aeiou]/i.test(suf)) stem = stem.slice(0, -1);
  return cap(stem + suf);
}

export function langPersonName(lang, n, female) {
  const rng = mkRng(hash32(lang.seed, "p", lang.gen, n));
  let w = rawWord(lang, hash32(lang.seed, "pn", lang.gen, n));
  if (female) { if (!/[aeiou]$/i.test(w)) w += lang.nuclei.filter(v => v.length === 1)[0] || "a"; }
  else if (/[aeiou]$/i.test(w) && rng() < 0.6) { const cods = lang.codas.filter(c => c && c.length === 1); if (cods.length) w += cods[rng.int(cods.length)]; }
  return cap(w);
}

export function langDynastyName(lang, n, founder) {
  const rng = mkRng(hash32(lang.seed, "d", lang.gen, n));
  const suf = lang.dynSufs[rng.int(lang.dynSufs.length)] || "";
  let stem = founder ? String(founder) : rawWord(lang, hash32(lang.seed, "dw", lang.gen, n));
  if (suf && /[aeiou]$/i.test(stem)) stem = stem.slice(0, -1);
  return cap(stem + suf);
}

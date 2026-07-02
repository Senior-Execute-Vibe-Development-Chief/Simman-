// ── Languages: procedurally-profiled, evolving tongues ──
//
// Each language is generated from a coherent, POLARIZED phonological PROFILE
// rather than a fixed menu of archetypes — and that's the whole trick. You
// cannot get London-vs-Beijing distinctiveness by randomising every parameter
// independently: independent rolls regress to the MEAN (medium clusters, medium
// vowels, medium length), which is the generic-conlang mush. Distinctiveness
// comes from pushing each language to a coherent CORNER of the space and
// letting its features CO-VARY the way real languages do (a CV tongue has few
// consonants AND no codas AND short syllables, together).
//
// So a language rolls a handful of latent dials — toward POLES, not uniformly:
//   complexity  simple CV  ↔  onset clusters + coda clusters
//   hardness    soft (liquids/nasals/glides)  ↔  hard (stops/fricatives/gutturals)
//   length      short (1–2 syl)  ↔  long (3–4 syl)
//   vowels      3 / 5 / 7,  diphthongs y/n
//   + rare independent features: gutturals, aspiration, prenasalisation,
//     affricates, prefixing, reduplication
// and the consonant inventory, syllable templates, and recurring place-suffix
// are BUILT from those dials. No climate input (there is no real climate→
// structure law; regional resemblance instead comes from common DESCENT —
// daughter tongues branch from their parent). The language then evolves:
//   DRIFT  — sound change with the generations (within the tongue's character)
//   BRANCH — a daughter, drifted by DISTANCE from its parent
//   BORROW — adopt a neighbour's sound under heavy contact

import { mkRng, hash32 } from "./peopleSim/rng.js";

// Phoneme stock by category (onsets/codas hold whole strings; digraphs like
// "sh","ng","mb" are single sounds; "st","pr" are clusters).
const C_STOP   = ["p", "t", "k", "b", "d", "g"];
const C_NAS    = ["m", "n", "ng", "ny"];
const C_LIQ    = ["l", "r"];
const C_GLIDE  = ["w", "y"];
const C_FRIC   = ["s", "sh", "f", "v", "z", "zh", "th", "h", "x"];
const C_GUTT   = ["q", "kh", "gh", "'"];
const C_ASP    = ["ph", "th", "kh", "bh", "dh"];
const C_AFFR   = ["ch", "j", "ts", "dz"];
const C_PRENAS = ["mb", "nd", "ng", "nk", "mp"];
const V_CORE   = ["a", "i", "u", "e", "o", "y"];
const V_DIPH   = ["ai", "au", "ei", "ou", "ia", "ua", "ao", "io", "uo"];
const CODA_SINGLE = ["n", "m", "ng", "r", "l", "s", "t", "k", "sh", "th"];
const CODA_CLUSTER = ["nd", "nt", "rk", "rg", "st", "sk", "ld", "lm", "rn", " ts".trim()];

function addN(rng, pool, n, into) {
  const p = pool.filter(x => !into.includes(x));
  for (let i = 0; i < n && p.length; i++) into.push(p.splice(rng.int(p.length), 1)[0]);
}
// roll toward a pole (0 / 0.5 / 1) with light jitter → languages cluster at
// the extremes and the middle, not smeared uniformly (the anti-mush move).
function polar(rng) {
  return Math.max(0, Math.min(1, rng.int(3) * 0.5 + (rng() - 0.5) * 0.3));
}

export function languagesOf(world) { return world.languages || (world.languages = new Map()); }
export function getLanguage(world, id) { return id >= 0 && world.languages ? world.languages.get(id) || null : null; }

// Build a full coherent inventory from a fresh profile. Returns the language
// record's phonology fields plus a _pool superset that drift draws from so
// sound change stays in character.
function buildPhonology(rng) {
  const complexity = polar(rng);     // CV ↔ clusters
  const hardness = polar(rng);       // soft ↔ hard
  const soft = hardness < 0.38;
  const vowelN = [3, 5, 5, 5, 7][rng.int(5)];
  const diphthongs = rng() < 0.4;
  const longWords = rng() < 0.42;
  const guttural = rng() < 0.22;
  const aspirated = rng() < 0.16;
  const affricate = rng() < 0.30;
  const prenasal = rng() < 0.16;
  const prefixing = rng() < 0.16;
  const reduplication = rng() < 0.22 && complexity < 0.5;

  // consonant inventory (the POOL — the language's full character)
  const cons = [];
  addN(rng, C_STOP, 2 + Math.round(hardness * 4), cons);
  addN(rng, C_NAS, soft ? 3 : 2, cons);
  addN(rng, C_LIQ, soft ? 2 : 1, cons);
  addN(rng, C_GLIDE, soft ? 2 : (rng() < 0.5 ? 1 : 0), cons);
  addN(rng, C_FRIC, 1 + Math.round(hardness * 4), cons);
  if (guttural) addN(rng, C_GUTT, 2 + rng.int(2), cons);
  if (aspirated) addN(rng, C_ASP, 2 + rng.int(3), cons);
  if (affricate) addN(rng, C_AFFR, 1 + rng.int(2), cons);
  if (prenasal) addN(rng, C_PRENAS, 2 + rng.int(2), cons);

  // onset pool: bare consonants (+ optional vowel-initial) + clusters if complex
  const onPool = cons.slice();
  if (rng() < 0.6) onPool.unshift("");
  if (complexity > 0.6) {
    const stops = cons.filter(c => C_STOP.includes(c));
    const liqs = cons.filter(c => C_LIQ.includes(c));
    const cl = [];
    for (const st of stops) for (const l of liqs) {
      if ((st === "t" || st === "d") && l === "l") continue;   // no tl/dl onset
      if (rng() < 0.5) cl.push(st + l);                        // pr, kl, tr, gr…
    }
    if (cons.includes("s")) for (const st of ["p", "t", "k"]) if (stops.includes(st) && rng() < 0.5) cl.push("s" + st); // st/sk/sp only (voiceless)
    addN(rng, cl, 1 + rng.int(3), onPool);
  }

  // vowels
  const nucPool = V_CORE.slice(0, vowelN === 3 ? 3 : vowelN === 7 ? 6 : 5);
  // (3 → a/i/u; 5 → a/i/u/e/o; 7 → all six + diphthongs)
  if (vowelN === 3) nucPool.splice(0, nucPool.length, "a", "i", "u");
  if (diphthongs) addN(rng, V_DIPH, 1 + rng.int(2), nucPool);

  // codas by complexity
  let codPool = [""];
  if (complexity >= 0.34) addN(rng, CODA_SINGLE, complexity < 0.67 ? 1 + rng.int(2) : 2 + rng.int(3), codPool);
  if (complexity >= 0.67) addN(rng, CODA_CLUSTER, 2 + rng.int(3), codPool);

  const pool = { onsets: onPool, nuclei: nucPool, codas: codPool };
  // active inventory = most of the pool (a little held back for drift to add)
  const sub = (arr, keepMin) => {
    if (arr.length <= keepMin) return arr.slice();
    const keep = Math.max(keepMin, Math.round(arr.length * (0.75 + rng() * 0.2)));
    const p = arr.slice(), out = [];
    for (let i = 0; i < keep && p.length; i++) out.push(p.splice(rng.int(p.length), 1)[0]);
    return out;
  };
  const active = {
    onsets: sub(onPool, 4),
    nuclei: sub(nucPool, 3),
    codas: codPool.length > 1 ? sub(codPool, 2) : codPool.slice(),
  };
  if (!active.onsets.length) active.onsets = onPool.slice(0, 4);

  const syl = longWords ? [2, 3] : [1, 2];
  const prefix = prefixing ? genPrefixes(rng, active) : null;
  return { active, pool, syl, redup: reduplication, prefix };
}

// recurring place / realm / dynasty suffixes, GENERATED from the language's own
// sounds (so a region's cities read as kin — its own "-burg" — without a
// hardcoded list). Some come up empty so suffixing strength varies.
function genSuffix(rng, active, wantCoda) {
  let s = "";
  const ons = active.onsets.filter(c => c && c.length <= 2);
  const nuc = active.nuclei.filter(v => v.length <= 2);
  if (rng() < 0.7 && ons.length) s += ons[rng.int(ons.length)];
  s += nuc.length ? nuc[rng.int(nuc.length)] : "a";
  if (wantCoda && active.codas.length > 1 && rng() < 0.55) {
    const cod = active.codas.filter(c => c && c.length <= 2);
    if (cod.length) s += cod[rng.int(cod.length)];
  }
  return s;
}
function genSuffixSet(rng, active, n, wantCoda, emptyChance) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(rng() < emptyChance ? "" : genSuffix(rng, active, wantCoda));
  return [...new Set(out)];
}
function genPrefixes(rng, active) {
  const out = [""];
  const ons = active.onsets.filter(c => c && c.length <= 2);
  const nuc = active.nuclei.filter(v => v.length === 1);
  for (let i = 0; i < 2 + rng.int(2); i++) out.push((rng() < 0.5 && ons.length ? ons[rng.int(ons.length)] : "") + (nuc.length ? nuc[rng.int(nuc.length)] : "a"));
  return [...new Set(out)];
}

export function foundLanguage(world, { seed, parentId = -1 } = {}) {
  const id = world._nextLanguageId || 1;
  world._nextLanguageId = id + 1;
  const s = (seed ?? hash32(world.seed || 1, "lang", id)) >>> 0;
  const rng = mkRng(s);
  const ph = buildPhonology(rng);
  const _ph = parentId >= 0 ? getLanguage(world, parentId) : null;
  const lang = {
    id, seed: s, parentId, bornStep: world.step | 0, gen: 0,
    rootId: parentId >= 0 ? ((_ph || {}).rootId ?? parentId) : id,   // language FAMILY (for the Languages map)
    // Likeness colour: a daughter tongue drifts a little from its parent's hue; a fresh
    // root family is golden-angle spread away. So one language family reads as one colour.
    hue: _ph ? (((_ph.hue + (hash32(s, "lhue") / 4294967296 - 0.5) * 44) % 360) + 360) % 360 : (id * 137.508 + 80) % 360,
    onsets: ph.active.onsets, nuclei: ph.active.nuclei, codas: ph.active.codas,
    _pool: ph.pool, syl: ph.syl, redup: ph.redup, prefix: ph.prefix,
    citySufs: genSuffixSet(rng, ph.active, 3, true, 0.3),
    realmSufs: genSuffixSet(rng, ph.active, 3, false, 0.25),
    dynSufs: genSuffixSet(rng, ph.active, 3, true, 0.15),
  };
  languagesOf(world).set(id, lang);
  if (parentId < 0) for (let i = 0; i < 1 + rng.int(2); i++) driftLanguage(world, lang);
  return lang;
}

/** One step of sound change, WITHIN the tongue's character (its _pool). */
export function driftLanguage(world, lang) {
  const rng = mkRng(hash32(lang.seed, "drift", lang.gen + 1));
  const pool = lang._pool || { onsets: lang.onsets, nuclei: lang.nuclei, codas: lang.codas };
  const roll = rng();
  if (roll < 0.30 && lang.onsets.length > 5) {
    lang.onsets.splice(rng.int(lang.onsets.length), 1);
  } else if (roll < 0.55) {
    const c = pool.onsets.filter(x => !lang.onsets.includes(x));
    if (c.length) lang.onsets.push(c[rng.int(c.length)]);
  } else if (roll < 0.73) {
    const c = pool.nuclei.filter(x => !lang.nuclei.includes(x));
    if (c.length && rng() < 0.6) lang.nuclei.push(c[rng.int(c.length)]);
    else if (lang.nuclei.length > 3) lang.nuclei.splice(rng.int(lang.nuclei.length), 1);
  } else if (roll < 0.90 && pool.codas.length > 1) {
    const c = pool.codas.filter(x => !lang.codas.includes(x));
    if (c.length && rng() < 0.6) lang.codas.push(c[rng.int(c.length)]);
    else if (lang.codas.length > 1) lang.codas.splice(rng.int(lang.codas.length), 1);
  } else {
    if (rng() < 0.5 && lang.syl[1] < lang.syl[0] + 3) lang.syl[1]++;
    else if (lang.syl[1] > lang.syl[0]) lang.syl[1]--;
  }
  lang.gen++;
}

/** A daughter tongue: the parent, drifted by DISTANCE (0..1). */
export function branchLanguage(world, parent, divergence = 0.4) {
  const id = world._nextLanguageId || 1;
  world._nextLanguageId = id + 1;
  // The child id is part of the seed: two branches of the SAME parent in the
  // same pass otherwise got identical seeds — byte-identical "different"
  // tongues whose names collide forever (sibling nations speaking one clone).
  const s = hash32(parent.seed, "branch", parent.gen, world.step, id) >>> 0;
  const child = {
    id, seed: s, parentId: parent.id, bornStep: world.step | 0, gen: 0,
    rootId: parent.rootId ?? parent.id,                       // stays in the parent's language family
    // drift the hue from the parent tongue, further the deeper the branch (likeness colour)
    hue: (((parent.hue ?? (parent.id * 137.508 + 80)) + (hash32(s, "lhue") / 4294967296 - 0.5) * 44 * Math.max(0.25, Math.min(1, divergence))) % 360 + 360) % 360,
    onsets: parent.onsets.slice(), nuclei: parent.nuclei.slice(), codas: parent.codas.slice(),
    _pool: { onsets: parent._pool.onsets.slice(), nuclei: parent._pool.nuclei.slice(), codas: parent._pool.codas.slice() },
    syl: parent.syl.slice(), redup: parent.redup, prefix: parent.prefix ? parent.prefix.slice() : null,
    citySufs: parent.citySufs.slice(), realmSufs: parent.realmSufs.slice(), dynSufs: parent.dynSufs.slice(),
  };
  languagesOf(world).set(id, child);
  const d = Math.max(0, Math.min(1, divergence));
  for (let i = 0; i < 1 + Math.round(d * 8); i++) driftLanguage(world, child);
  // a far branch evolves its own naming FASHION (regenerated suffixes) — same
  // family sound, shifted surface
  if (d > 0.55) {
    const rng = mkRng(hash32(s, "fashion"));
    const active = { onsets: child.onsets, nuclei: child.nuclei, codas: child.codas };
    if (rng() < 0.7) child.citySufs = genSuffixSet(rng, active, 3, true, 0.3);
    if (rng() < 0.5) child.realmSufs = genSuffixSet(rng, active, 3, false, 0.25);
  }
  return child;
}

/** Areal contact: adopt a neighbour's sound (into pool + active). */
export function borrowFrom(world, lang, donor) {
  const rng = mkRng(hash32(lang.seed, "borrow", donor.id, lang.gen));
  const cand = donor.onsets.filter(c => c && !lang.onsets.includes(c));
  if (cand.length) {
    const c = cand[rng.int(cand.length)];
    lang.onsets.push(c);
    if (lang._pool && !lang._pool.onsets.includes(c)) lang._pool.onsets.push(c);
    lang.gen++;
  }
}

// ── word synthesis ───────────────────────────────────────────────────────
// Phonotactics: clusters allowed but not PILED — an onset cluster only word-
// initial, a coda cluster only word-final, never a coda before a cluster onset.
const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1);

function rawWord(lang, streamSeed) {
  const rng = mkRng(streamSeed >>> 0);
  const [lo, hi] = lang.syl;
  const nS = lo + (hi > lo ? rng.int(hi - lo + 1) : 0);
  const singles = lang.onsets.filter(c => c.length <= 1);
  const shortCodas = lang.codas.filter(c => c.length <= 1);
  let w = "";
  if (lang.prefix && lang.prefix.length && rng() < 0.5) w += lang.prefix[rng.int(lang.prefix.length)];
  let prevCoda = false;
  for (let i = 0; i < nS; i++) {
    const isLast = i === nS - 1;
    let on;
    if (prevCoda) on = singles.length ? singles[rng.int(singles.length)] : "";
    else {
      on = lang.onsets[rng.int(lang.onsets.length)];
      if (i > 0 && on.length >= 3 && singles.length && rng() < 0.75) on = singles[rng.int(singles.length)];
    }
    let nu = lang.nuclei[rng.int(lang.nuclei.length)];
    if (nu.length >= 2 && rng() < 0.55) { const m = lang.nuclei.filter(v => v.length === 1); if (m.length) nu = m[rng.int(m.length)]; }
    let co = "";
    if (lang.codas.length > 1) {
      if (isLast) co = lang.codas[rng.int(lang.codas.length)];
      else if (rng() < 0.26 && shortCodas.length) co = shortCodas[rng.int(shortCodas.length)];
    }
    prevCoda = co.length > 0;
    w += on + nu + co;
  }
  if (lang.redup && nS <= 2 && rng() < 0.3) w += w;
  return w.replace(/(.)\1\1+/g, "$1$1");
}

export function langWord(lang, n) { return cap(rawWord(lang, hash32(lang.seed, "w", lang.gen, n))); }

/** A settlement name — word + (often) the family's place-suffix, which makes a
 *  region's cities read as kin. */
export function langPlaceName(lang, n) {
  const rng = mkRng(hash32(lang.seed, "place", lang.gen, n));
  let w = rawWord(lang, hash32(lang.seed, "pw", lang.gen, n));
  const suf = lang.citySufs[rng.int(lang.citySufs.length)];
  if (suf && w.length <= 7) { if (/[aeiou]$/i.test(w) && /^[aeiou]/i.test(suf)) w = w.slice(0, -1); w += suf; }
  return cap(w);
}

export function langRealmName(lang, n, base) {
  const rng = mkRng(hash32(lang.seed, "r", lang.gen, n));
  const suf = lang.realmSufs[rng.int(lang.realmSufs.length)];
  let stem = base ? String(base) : rawWord(lang, hash32(lang.seed, "rw", lang.gen, n));
  if (suf && /[aeiou]$/i.test(stem) && /^[aeiou]/i.test(suf)) stem = stem.slice(0, -1);
  return cap(stem + suf);
}

export function langPersonName(lang, n, female) {
  const rng = mkRng(hash32(lang.seed, "p", lang.gen, n));
  let w = rawWord(lang, hash32(lang.seed, "pn", lang.gen, n));
  if (female) { if (!/[aeiou]$/i.test(w)) w += (lang.nuclei.filter(v => v.length === 1)[0] || "a"); }
  else if (/[aeiou]$/i.test(w) && rng() < 0.6) { const c = lang.codas.filter(x => x && x.length === 1); if (c.length) w += c[rng.int(c.length)]; }
  return cap(w);
}

export function langDynastyName(lang, n, founder) {
  const rng = mkRng(hash32(lang.seed, "d", lang.gen, n));
  const suf = lang.dynSufs[rng.int(lang.dynSufs.length)] || "";
  let stem = founder ? String(founder) : rawWord(lang, hash32(lang.seed, "dw", lang.gen, n));
  if (suf && /[aeiou]$/i.test(stem)) stem = stem.slice(0, -1);
  return cap(stem + suf);
}

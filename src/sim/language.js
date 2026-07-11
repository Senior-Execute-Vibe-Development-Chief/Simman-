// ── Languages v2: typology-spanning phonology + a virtual lexicon ─────────
//
// The comprehensive system (docs/language-comprehensive-spec.md, L1–L4).
// A language record persists only its SEEDS and its HISTORY (rule log,
// loans); everything else — inventory, syllable grammar, romanization, the
// entire vocabulary — is derived on demand through pure functions and cached
// in a WeakMap, so save/load round-trips byte-identical names by
// construction. What the old generator got right survives: polarized
// coherent profiles (now real typological attractors, languagePhonology.js),
// descent-not-climate, and the exact public API — callers are untouched.
//
// What's new:
//   · feature-bundle phonemes; sonority syllable grammar (CV-only through
//     str-/vzgl- class clusters in ONE parameter space); tone/harmony/
//     morphotype dials (languagePhonology.js)
//   · sound change as a replayed RULE LOG — sister tongues differ by
//     regular correspondences, so cognates are real (languageChange.js)
//   · a shared concept graph with per-family colexification and derivation:
//     wordOf(lang, concept) is the virtual dictionary; place/person names
//     are meaningful compounds with recoverable glosses (languageLexicon.js)
//   · loan strata: contact borrows prestige-domain VOCABULARY, not just
//     sounds — conquest leaves pig/pork-style layers in the lexicon

import { mkRng, hash32 } from "./peopleSim/rng.js";
import { rollProfile, applySignature, buildInventory, buildSyllabary, synthWord, renderWord, copyWord } from "./languagePhonology.js";
import { applicableRules, applyRules } from "./languageChange.js";
import { CONCEPTS, COLEX, TOPO_HEAD, TOPO_MOD, PERSON_POOL, LOAN_POOL, LAND, SON, TOWN, FORT, HOUSE } from "./languageLexicon.js";

const h01 = (...a) => hash32(...a) / 4294967296;
const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1);

export function languagesOf(world) { return world.languages || (world.languages = new Map()); }
export function getLanguage(world, id) { return id >= 0 && world.languages ? world.languages.get(id) || null : null; }

// ── lifecycle ─────────────────────────────────────────────────────────────

export function foundLanguage(world, { seed, parentId = -1 } = {}) {
  const id = world._nextLanguageId || 1;
  world._nextLanguageId = id + 1;
  const s = (seed ?? hash32(world.seed || 1, "lang", id)) >>> 0;
  const parent = parentId >= 0 ? getLanguage(world, parentId) : null;
  const lang = {
    id, v: 2, seed: s, famSeed: parent ? (parent.famSeed ?? parent.seed) : s,
    parentId, rootId: parent ? (parent.rootId ?? parentId) : id,
    bornStep: world.step | 0, gen: 0,
    hue: parent ? (((parent.hue + (h01(s, "lhue") - 0.5) * 44) % 360) + 360) % 360 : (id * 137.508 + 80) % 360,
    prof: parent ? JSON.parse(JSON.stringify(parent.prof)) : applySignature(rollProfile(s), s),
    rules: parent ? parent.rules.slice() : [],
    loans: parent ? parent.loans.slice() : [],
    xph: parent && parent.xph ? parent.xph.map(b => ({ ...b })) : [],
  };
  languagesOf(world).set(id, lang);
  // a fresh root tongue arrives with a little history already in its bones
  if (!parent) { const n = 1 + (hash32(s, "age") % 2); for (let i = 0; i < n; i++) driftLanguage(world, lang); }
  return lang;
}

/** One step of sound change: append a rule from the profile's applicable set. */
export function driftLanguage(world, lang) {
  ensureV2(lang);
  const ap = applicableRules(lang.prof);
  lang.rules.push(ap[hash32(lang.seed, "rule", lang.gen) % ap.length]);
  lang.gen++;
}

/** A daughter tongue: same family roots, drifted by DISTANCE from its parent. */
export function branchLanguage(world, parent, divergence = 0.4) {
  ensureV2(parent);
  const id = world._nextLanguageId || 1;
  world._nextLanguageId = id + 1;
  // child id in the seed: two same-pass branches must not clone (see v1 scar)
  const s = hash32(parent.seed, "branch", parent.gen, world.step, id) >>> 0;
  const d = Math.max(0, Math.min(1, divergence));
  const child = {
    id, v: 2, seed: s, famSeed: parent.famSeed ?? parent.seed,
    parentId: parent.id, rootId: parent.rootId ?? parent.id,
    bornStep: world.step | 0, gen: 0,
    hue: (((parent.hue ?? (parent.id * 137.508 + 80)) + (h01(s, "lhue") - 0.5) * 44 * Math.max(0.25, d)) % 360 + 360) % 360,
    prof: JSON.parse(JSON.stringify(parent.prof)),
    rules: parent.rules.slice(),
    loans: parent.loans.slice(),
    xph: parent.xph ? parent.xph.map(b => ({ ...b })) : [],
  };
  languagesOf(world).set(id, child);
  const n = 1 + Math.round(d * 4);
  for (let i = 0; i < n; i++) driftLanguage(world, child);
  return child;
}

/** Areal contact: adopt a neighbour's SOUND, and — the deeper stratum — its
 *  WORDS for prestige-domain concepts (law, faith, luxury: the pig/pork
 *  machine; the native stock keeps kin, body, farm). */
export function borrowFrom(world, lang, donor) {
  ensureV2(lang); ensureV2(donor);
  const rng = mkRng(hash32(lang.seed, "borrow", donor.id, lang.gen));
  // (a) a phoneme crosses over
  const dInv = compile(donor).inv;
  const mine = compile(lang).inv;
  const cand = dInv.cons.filter(dc => !mine.cons.some(c => c.p === dc.p && c.m === dc.m && c.l === dc.l && c.s === dc.s));
  if (cand.length) lang.xph.push({ ...cand[rng.int(cand.length)] });
  // (b) a prestige word crosses over (frozen at borrow time, foreign look kept)
  if (rng() < 0.8) {
    const cid = LOAN_POOL[rng.int(LOAN_POOL.length)];
    lang.loans.push({ c: cid, w: wordOf(donor, cid), d: donor.id });
  }
  lang.gen++;
}

// v1 records (old saves) upgrade lazily: profile re-rolled from the seed —
// entity names already stored on settlements/realms are untouched; only
// NEW names change, which is the accepted spec trade (open question 2).
function ensureV2(lang) {
  if (lang.v === 2) return lang;
  lang.v = 2;
  lang.famSeed = lang.famSeed ?? lang.seed;
  lang.prof = lang.prof || rollProfile(lang.seed);
  lang.rules = lang.rules || [];
  lang.loans = lang.loans || [];
  lang.xph = lang.xph || [];
  return lang;
}

// ── compiled state (derived, WeakMap-cached, never persisted) ─────────────

const COMPILED = new WeakMap();

function compile(lang) {
  ensureV2(lang);
  const key = lang.gen * 1000003 + lang.loans.length * 101 + lang.xph.length;
  let c = COMPILED.get(lang);
  if (c && c.key === key) return c;
  // exact-inventory pinning (labelled-scenario languages: a pin lists the
  // literal phoneme bundles — cons and/or vows — instead of rolling them;
  // per-phoneme surface spellings ride on prof.rom)
  const rolled = buildInventory(lang.famSeed, lang.prof);
  const inv = {
    cons: (lang.pin && lang.pin.cons ? lang.pin.cons : rolled.cons).map(b => ({ ...b })),
    vows: (lang.pin && lang.pin.vows ? lang.pin.vows : rolled.vows).map(b => ({ ...b })),
  };
  for (const b of lang.xph) inv.cons.push({ ...b });
  // the licensed syllabary: THIS language's finite onset/coda inventory —
  // family-seeded so sisters share their cluster fashions (pinned
  // references may list their literal legal onsets/codas/diphthongs)
  inv.syllab = buildSyllabary(lang.famSeed, lang.prof, inv, lang.pin);
  // family-level semantic structure: colexification + derive-vs-root choices
  const colex = new Map();
  COLEX.forEach(([a, b, p], i) => { if (h01(lang.famSeed, "colex", i) < p) colex.set(b, a); });
  c = { key, inv, colex, words: new Map(), internals: new Map(), sufs: null };
  COMPILED.set(lang, c);
  return c;
}

// ── the virtual dictionary ────────────────────────────────────────────────

/** Internal (feature-bundle) form for a concept's NATIVE word: family root
 *  replayed through this language's rule log — cognates across the family
 *  correspond regularly because they share the root and differ in the log. */
function internalOf(lang, cid) {
  const c = compile(lang);
  const seen = c.internals.get(cid);
  if (seen) return seen;
  const con = CONCEPTS[cid];
  const merged = c.colex.get(cid) ?? cid;
  if (merged !== cid) { const w = internalOf(lang, merged); c.internals.set(cid, w); return w; }
  let w;
  const parts = con.dv && [internalOf(lang, con.dv[0]), internalOf(lang, con.dv[1])];
  // (if this family colexified the two parts into ONE lexeme, a compound
  // would duplicate it — "water-water" — so coin a root instead)
  if (con.dv && parts[0] !== parts[1] && h01(lang.famSeed, "dv", cid) < 0.65) {
    // derived concept: a compound of its parts (or a re-vowelled pattern of
    // the head root, if the tongue is templatic — derivation by pattern)
    if (lang.prof.morph === "tmpl") w = revowel(lang, parts[0], cid);
    else w = joinInternal(lang, parts[1], parts[0]);
    // high-frequency EROSION: a common compound wears down with use — no
    // speech community says a six-syllable word for "crossing" daily
    if (con.b >= 0.5 && w.syls.length > 3) w.syls = [w.syls[0], ...w.syls.slice(-2)];
  } else {
    const rng = mkRng(hash32(lang.famSeed, "root", cid));
    w = lang.prof.morph === "tmpl" ? synthTemplatic(rng, lang.prof, c.inv, cid, lang.famSeed)
      : synthWord(rng, lang.prof, c.inv, rootLen(rng, lang.prof, con.b >= 0.85));
    w = applyRules(lang.rules, w);
  }
  c.internals.set(cid, w);
  return w;
}

/** The word for a concept, as a rendered string. Loans win over native. */
export function wordOf(lang, cid) {
  const c = compile(lang);
  const seen = c.words.get(cid);
  if (seen !== undefined) return seen;
  let out = null;
  for (let i = lang.loans.length - 1; i >= 0; i--) if (lang.loans[i].c === cid) { out = lang.loans[i].w; break; }
  if (out === null) out = renderWord(internalOf(lang, cid), lang.prof);
  c.words.set(cid, out);
  return out;
}

/** The concept's gloss (shared across all languages). */
export function glossOf(cid) { return CONCEPTS[cid] ? CONCEPTS[cid].g : ""; }

// root length from the language's own distribution (Vietnamese-short
// through Greenlandic-long); basic concepts run shorter, like real ones
function rootLen(rng, prof, basic) {
  const n = Math.round((prof.wordLen || 2) + (rng() - 0.5) + (basic ? -0.6 : 0.3));
  return Math.max(1, Math.min(4, n));   // no daily word is 5+ syllables — speech erodes them first
}

// templatic roots: a consonant skeleton the patterns interleave (k-t-b style)
function synthTemplatic(rng, prof, inv, cid, famSeed) {
  const cons = inv.cons.filter(x => x.m <= 5);
  const K = [{ ...rng.pick(cons) }, { ...rng.pick(cons) }, { ...rng.pick(cons) }];
  const vs = inv.vows;
  const pat = hash32(famSeed, "pat", cid) % 3;
  const v1 = vs[pat % vs.length], v2 = vs[(pat + 2) % vs.length];
  return { syls: [{ on: [K[0]], nu: [{ ...v1 }], co: [] }, { on: [K[1]], nu: [{ ...v2 }], co: [K[2]] }] };
}
// templatic derivation: keep the skeleton, change the vowel pattern (maktab)
function revowel(lang, head, cid) {
  const c = compile(lang);
  const skel = [];
  for (const s of head.syls) { for (const x of s.on) skel.push({ ...x }); for (const x of s.co) skel.push({ ...x }); }
  while (skel.length < 3) skel.push({ ...c.inv.cons[hash32(lang.famSeed, "fill", cid, skel.length) % c.inv.cons.length] });
  const vs = c.inv.vows;
  const v = vs[hash32(lang.famSeed, "rv", cid) % vs.length];
  const w = { syls: [{ on: [{ p: 0, m: 1, l: 1, s: 0 }], nu: [{ ...v }], co: [] },   // ma- style nominal prefix
    { on: [skel[0]], nu: [{ ...v }], co: [] }, { on: [skel[1]], nu: [{ ...v }], co: [skel[2]] }] };
  return w;
}

// compound joining per the language's STRATEGY: head-last (mod+head, the
// default), head-first, or a linker morpheme between the parts (bati-na-piik)
function joinInternal(lang, mod, head) {
  const strat = lang.prof.compound || "hl";
  let a = copyWord(strat === "hf" ? head : mod), b = copyWord(strat === "hf" ? mod : head);
  // blend languages wear the FIRST part down to one syllable in every
  // compound (nkápìd-style truncation) — a per-language habit
  if (lang.prof.compErode === "blend" && a.syls.length > 1) a.syls = a.syls.slice(0, 1);
  if (strat === "link") {
    const c = compile(lang);
    if (!c.linkSyl) {
      const n = c.inv.cons.find(x => x.m === 1) || c.inv.cons[0];
      c.linkSyl = { on: [{ ...n }], nu: [{ ...c.inv.vows[0] }], co: [] };
    }
    a.syls.push({ on: [{ ...c.linkSyl.on[0] }], nu: [{ ...c.linkSyl.nu[0] }], co: [] });
  }
  const lastA = a.syls[a.syls.length - 1], firstB = b.syls[0];
  if (lang.prof.morph === "fus" && lastA.nu.length && !lastA.co.length && !firstB.on.length) {
    lastA.nu = [];                                            // elide the seam vowel
    if (!lastA.nu.length && !lastA.co.length && lastA.on.length) { firstB.on = [...lastA.on, ...firstB.on]; a.syls.pop(); }
  } else if (lastA.co.length && firstB.on.length >= 2) {
    firstB.on = firstB.on.slice(0, 1);                        // simplify the seam
  }
  // hiatus repair: languages don't butt two full vowels together at a
  // morpheme seam — insert a glide (y before front vowels, w otherwise)
  if (lastA.nu.length && !lastA.co.length && !firstB.on.length && firstB.nu.length) {
    firstB.on = [firstB.nu[0].b === 0 ? { p: 3, m: 6, l: 1, s: 0 } : { p: 0, m: 6, l: 1, s: 0 }];
  }
  // keep compounds speakable: cap syllables, favouring the head (linker
  // compounds get one more so the linker survives)
  const cap = strat === "link" ? 5 : 4;
  const syls = [...a.syls, ...b.syls];
  return { syls: syls.length > cap ? [...a.syls.slice(0, strat === "link" ? 2 : 1), ...b.syls.slice(-2)] : syls };
}

// ── suffix fashions, DERIVED from meaning (the -burg/-stan/-son machine) ──
// A place suffix is the worn-down root for town/fort/house; a realm suffix
// the worn-down root for LAND; a patronymic the worn-down root for SON. So
// the fashions aren't arbitrary strings — they are the language's own words,
// reduced by use, and they shift when sound change reshapes the roots.
function sufsOf(lang) {
  const c = compile(lang);
  if (c.sufs) return c.sufs;
  const reduce = (cid) => {
    const w = internalOf(lang, cid);
    const s = w.syls[w.syls.length - 1];
    const r = { syls: [{ on: s.on.slice(0, 1), nu: s.nu.slice(0, 1), co: s.co.slice(0, 1) }] };
    return renderWord(r, lang.prof);
  };
  const femV = (() => { const v = c.inv.vows.find(v => v.h === 2) || c.inv.vows[0]; return renderWord({ syls: [{ on: [], nu: [v], co: [] }] }, lang.prof); })();
  c.sufs = {
    city: [reduce(TOWN), reduce(FORT), reduce(HOUSE), ""],
    realm: [reduce(LAND), reduce(LAND) + femV, ""],
    patro: reduce(SON),
    fem: femV,
  };
  return c.sufs;
}

const joinSuf = (stem, suf) => {
  if (!suf) return stem;
  if (/[aeiou]$/i.test(stem) && /^[aeiou]/i.test(suf)) stem = stem.slice(0, -1);
  return stem + suf;
};
// name-level surgery (caps, suffixes, gender endings) can undo the final
// orthographic conventions — re-apply the word-final ones afterwards
const finishName = (w, prof) => prof.ortho === "en" ? w.replace(/u$/i, "oo").replace(/(..)i$/i, "$1y") : w;

// ── the public name API (signatures unchanged from v1) ────────────────────

/** A generic word of the tongue (faith names, culture endonyms). */
export function langWord(lang, n) {
  ensureV2(lang);
  const c = compile(lang);
  const rng = mkRng(hash32(lang.seed, "w", lang.gen, n));
  const w = applyRules(lang.rules, synthWord(rng, lang.prof, c.inv, rootLen(rng, lang.prof, true)));
  return cap(renderWord(w, lang.prof));
}

/** Settlement name + gloss: usually a meaningful compound ("black ford"),
 *  sometimes head+suffix ("…ton"), sometimes a name whose meaning is lost. */
export function langPlaceNameEx(lang, n) {
  ensureV2(lang);
  const rng = mkRng(hash32(lang.seed, "place", lang.gen, n));
  const sufs = sufsOf(lang);
  const roll = rng();
  let name, gloss;
  if (roll < 0.55) {
    const mod = TOPO_MOD[rng.int(TOPO_MOD.length)], head = TOPO_HEAD[rng.int(TOPO_HEAD.length)];
    name = renderWord(joinInternal(lang, internalOf(lang, mod), internalOf(lang, head)), lang.prof);
    gloss = glossOf(mod) + " " + glossOf(head);
    if (name.length > 12) { name = wordOf(lang, head); gloss = glossOf(head); }
  } else if (roll < 0.8) {
    const head = TOPO_HEAD[rng.int(TOPO_HEAD.length)];
    name = joinSuf(wordOf(lang, head), sufs.city[rng.int(sufs.city.length)]);
    gloss = glossOf(head);
  } else {
    const c = compile(lang);
    const w = applyRules(lang.rules, synthWord(rng, lang.prof, c.inv, 1 + rng.int(2)));
    name = joinSuf(renderWord(w, lang.prof), sufs.city[rng.int(sufs.city.length)]);
    gloss = null;                                             // meaning lost to time
  }
  return { name: cap(finishName(name.replace(/(.)\1\1+/g, "$1$1"), lang.prof)), gloss };
}
export function langPlaceName(lang, n) { return langPlaceNameEx(lang, n).name; }

export function langRealmName(lang, n, base) {
  ensureV2(lang);
  const rng = mkRng(hash32(lang.seed, "r", lang.gen, n));
  const sufs = sufsOf(lang);
  const stem = base ? String(base)
    : renderWord(applyRules(lang.rules, synthWord(rng, lang.prof, compile(lang).inv, 1 + rng.int(2))), lang.prof);
  return cap(finishName(joinSuf(stem, sufs.realm[rng.int(sufs.realm.length)]), lang.prof));
}

export function langPersonName(lang, n, female) {
  ensureV2(lang);
  const rng = mkRng(hash32(lang.seed, "p", lang.gen, n));
  let w;
  if (rng() < 0.6) {
    const a = PERSON_POOL[rng.int(PERSON_POOL.length)];
    if (rng() < 0.4) {
      const b = PERSON_POOL[rng.int(PERSON_POOL.length)];
      w = renderWord(joinInternal(lang, internalOf(lang, a), internalOf(lang, b)), lang.prof);
    } else w = wordOf(lang, a);
  } else {
    w = renderWord(applyRules(lang.rules, synthWord(rng, lang.prof, compile(lang).inv, 2)), lang.prof);
  }
  if (w.length > 10) w = w.slice(0, 9).replace(/[^aeiou]+$/i, "");
  const sufs = sufsOf(lang);
  if (lang.prof.gendered && female && !/[aeiou]$/i.test(w)) w += sufs.fem;
  else if (lang.prof.gendered && !female && w.length > 3 && /[aeiou]$/i.test(w) && rng() < 0.5) w = w.slice(0, -1);
  return cap(finishName(w, lang.prof) || "Ana");
}

export function langDynastyName(lang, n, founder) {
  ensureV2(lang);
  const rng = mkRng(hash32(lang.seed, "d", lang.gen, n));
  const sufs = sufsOf(lang);
  let stem = founder ? String(founder)
    : renderWord(applyRules(lang.rules, synthWord(rng, lang.prof, compile(lang).inv, 2)), lang.prof);
  if (lang.prof.patro === "pre") return cap(sufs.patro) + cap(stem);
  if (lang.prof.patro === "suf") return cap(finishName(joinSuf(stem, sufs.patro), lang.prof));
  return cap(finishName(joinSuf(stem, sufs.realm[rng.int(sufs.realm.length)]), lang.prof));
}

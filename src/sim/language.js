// ── Languages: seeded, evolving, branching tongues ──
//
// The phonological core of the original LanguageGen — flavour profiles
// (harsh / flowing / clipped / semitic / polynesian...), consonant and
// vowel banks, syllable templates with codas and clusters — rebuilt as
// deterministic, JSON-serializable LANGUAGE ENTITIES that live in
// world.languages and EVOLVE:
//
//   DRIFT  — sound change with the generations: a consonant falls out of
//            use, a vowel shifts, codas soften. Names coined after a
//            shift sound different; names already written in the event
//            log keep their old spelling — exactly like real history.
//   BRANCH — a daughter culture's tongue starts as its parent's language
//            plus several drift steps (a dialect hardening into a
//            language); the family tree is recorded.
//   BORROW — heavy contact between peoples lets a language adopt
//            phonemes from a neighbour (the areal-feature effect).

import { mkRng, hash32 } from "./peopleSim/rng.js";

const C_STOPS = ["p", "b", "t", "d", "k", "g"];
const C_NASAL = ["m", "n", "ng"];
const C_FRIC = ["f", "v", "s", "z", "sh", "kh", "h", "th"];
const C_LIQ = ["l", "r"];
const C_GLIDE = ["y", "w"];
const ALL_V = ["a", "e", "i", "o", "u", "ai", "ei", "ou", "ia", "ua"];
const ALL_C = [...C_STOPS, ...C_NASAL, ...C_FRIC, ...C_LIQ, ...C_GLIDE, "q", "ts", "ch"];

// Flavour profiles (from the original generator): inventory sizes and
// syllable habits that give each family a recognisable sound.
export const FLAVORS = {
  harsh:      { stops: 6, nas: 2, fric: 3, liq: 1, gli: 0, vows: 4, coda: 0.7, cluster: false, sylMax: 2, extra: ["q", "kh"] },
  flowing:    { stops: 2, nas: 3, fric: 2, liq: 2, gli: 2, vows: 5, coda: 0.1, cluster: false, sylMax: 3, extra: [] },
  clipped:    { stops: 5, nas: 2, fric: 3, liq: 1, gli: 0, vows: 4, coda: 0.8, cluster: false, sylMax: 2, extra: [] },
  open:       { stops: 2, nas: 2, fric: 1, liq: 1, gli: 1, vows: 5, coda: 0.0, cluster: false, sylMax: 3, extra: [] },
  clustered:  { stops: 5, nas: 3, fric: 4, liq: 2, gli: 1, vows: 5, coda: 0.6, cluster: true,  sylMax: 2, extra: [] },
  semitic:    { stops: 4, nas: 2, fric: 5, liq: 2, gli: 1, vows: 3, coda: 0.65, cluster: false, sylMax: 2, extra: ["q", "kh"] },
  nasal:      { stops: 4, nas: 3, fric: 2, liq: 2, gli: 1, vows: 5, coda: 0.45, cluster: false, sylMax: 3, extra: [] },
  sibilant:   { stops: 3, nas: 2, fric: 5, liq: 2, gli: 1, vows: 4, coda: 0.4, cluster: false, sylMax: 3, extra: ["ts", "sh"] },
};
const FLAVOR_KEYS = Object.keys(FLAVORS);
const REALM_SUFS = [["ia", "ara", "oria", "ana"], ["eth", "oth", "ath", "und"], ["mark", "gard", "heim"], ["dor", "var", "mor", "tan"], ["esse", "aine", "elle"]];
const DYN_SUFS = ["id", "ene", "ar", "ian", "ite", "ald"];

function pickN(rng, arr, n) {
  const pool = arr.slice(), out = [];
  for (let i = 0; i < n && pool.length; i++) out.push(pool.splice(rng.int(pool.length), 1)[0]);
  return out;
}

export function languagesOf(world) { return world.languages || (world.languages = new Map()); }
export function getLanguage(world, id) { return id >= 0 && world.languages ? world.languages.get(id) || null : null; }

/** A fresh root language. Flavour can be nudged by homeland climate. */
export function foundLanguage(world, { seed, parentId = -1, flavorHint } = {}) {
  const id = world._nextLanguageId || 1;
  world._nextLanguageId = id + 1;
  const s = (seed ?? hash32(world.seed || 1, "lang", id)) >>> 0;
  const rng = mkRng(s);
  const flavor = flavorHint && FLAVORS[flavorHint] ? flavorHint : FLAVOR_KEYS[rng.int(FLAVOR_KEYS.length)];
  const F = FLAVORS[flavor];
  const cons = [...pickN(rng, C_STOPS, F.stops), ...pickN(rng, C_NASAL, F.nas), ...pickN(rng, C_FRIC, F.fric),
    ...pickN(rng, C_LIQ, F.liq), ...pickN(rng, C_GLIDE, F.gli)];
  for (const c of F.extra) if (!cons.includes(c)) cons.push(c);
  // Orthographic identity: each tongue spells itself differently, so two
  // families never LOOK alike even where sounds overlap.
  const ORTH = [["k","c"],["k","q"],["sh","x"],["kh","ch"],["y","j"],["w","v"],["ts","z"],["f","ph"],["u","oo"],["i","y"]];
  const orth = pickN(rng, ORTH, 1 + rng.int(2)).filter(()=>rng()<0.8);
  const lang = {
    id, seed: s, flavor, parentId, bornStep: world.step | 0, gen: 0,
    cons, vows: pickN(rng, ALL_V, F.vows),
    coda: F.coda, cluster: !!F.cluster, sylMax: F.sylMax,
    realmSufs: pickN(rng, REALM_SUFS[rng.int(REALM_SUFS.length)], 2),
    dynSuf: DYN_SUFS[rng.int(DYN_SUFS.length)],
    orth,
  };
  languagesOf(world).set(id, lang);
  // A ROOT tongue (no parent) gets a few extra centuries of private drift,
  // so even same-flavour cradles sound nothing alike.
  if (parentId < 0) for (let i = 0; i < 2 + rng.int(3); i++) driftLanguage(world, lang);
  return lang;
}

/** One step of sound change. Mutates the language in place; gen++ so the
 *  same name-stream yields new forms after the shift. */
export function driftLanguage(world, lang) {
  const rng = mkRng(hash32(lang.seed, "drift", lang.gen + 1));
  const roll = rng();
  if (roll < 0.35 && lang.cons.length > 5) {            // a consonant falls silent
    lang.cons.splice(rng.int(lang.cons.length), 1);
  } else if (roll < 0.6) {                              // a new sound enters fashion
    const cand = ALL_C.filter(c => !lang.cons.includes(c));
    if (cand.length) lang.cons.push(cand[rng.int(cand.length)]);
  } else if (roll < 0.8) {                              // vowel shift
    const cand = ALL_V.filter(v => !lang.vows.includes(v));
    if (cand.length && lang.vows.length > 3 && rng() < 0.5) lang.vows[rng.int(lang.vows.length)] = cand[rng.int(cand.length)];
    else if (cand.length) lang.vows.push(cand[rng.int(cand.length)]);
  } else {                                              // codas soften or harden
    lang.coda = Math.max(0, Math.min(0.85, lang.coda + (rng() - 0.5) * 0.3));
  }
  lang.gen++;
}

/** A daughter tongue. `divergence` 0..1 — how far the new people stand
 *  from their stock: neighbours speak a near-dialect (1-2 sound changes),
 *  a people across an ocean or a climate divide speak something whole
 *  generations removed (many changes, new spelling habits, sometimes a
 *  drifted suffix fashion). */
export function branchLanguage(world, parent, divergence = 0.4) {
  const child = foundLanguage(world, { seed: hash32(parent.seed, "branch", parent.gen, world.step), flavorHint: parent.flavor });
  // start from the parent's living speech, then drift apart with distance
  child.cons = parent.cons.slice();
  child.vows = parent.vows.slice();
  child.coda = parent.coda; child.cluster = parent.cluster; child.sylMax = parent.sylMax;
  child.realmSufs = parent.realmSufs.slice();
  child.dynSuf = parent.dynSuf;
  child.orth = parent.orth ? parent.orth.slice() : [];
  child.parentId = parent.id;
  const d = Math.max(0, Math.min(1, divergence));
  const steps = 1 + Math.round(d * 7);
  for (let i = 0; i < steps; i++) driftLanguage(world, child);
  if (d > 0.55) {
    const rng = mkRng(hash32(child.seed, "far"));
    const ORTH = [["k","c"],["sh","x"],["y","j"],["w","v"],["u","oo"],["f","ph"]];
    child.orth = [ORTH[rng.int(ORTH.length)]];
    if (rng() < 0.5) child.realmSufs = pickN(rng, REALM_SUFS[rng.int(REALM_SUFS.length)], 2);
    if (rng() < 0.4) child.dynSuf = DYN_SUFS[rng.int(DYN_SUFS.length)];
  }
  return child;
}

/** Areal contact: adopt a phoneme or two from a neighbour's speech. */
export function borrowFrom(world, lang, donor) {
  const rng = mkRng(hash32(lang.seed, "borrow", donor.id, lang.gen));
  const cand = donor.cons.filter(c => !lang.cons.includes(c));
  if (cand.length) { lang.cons.push(cand[rng.int(cand.length)]); lang.gen++; }
}

// ── word synthesis (deterministic per (language state, stream n)) ──────
function syllable(rng, lang, isFirst, isLast) {
  let s = "";
  if (rng() < 0.88) s += lang.cons[rng.int(lang.cons.length)];
  if (lang.cluster && isFirst && s && rng() < 0.3) {
    const liq = lang.cons.filter(c => "lrwy".includes(c));
    if (liq.length) s += liq[rng.int(liq.length)];
  }
  s += lang.vows[rng.int(lang.vows.length)];
  if (rng() < lang.coda * (isLast ? 1 : 0.45)) {
    const codas = lang.cons.filter(c => !"hwy".includes(c));
    if (codas.length) s += codas[rng.int(codas.length)];
  }
  return s;
}
const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1);

export function langWord(lang, n) {
  const rng = mkRng(hash32(lang.seed, "w", lang.gen, n));
  const nS = 1 + ((rng() < 0.8 ? 1 : 0)) + (rng() < (lang.sylMax >= 3 ? 0.45 : 0.12) ? 1 : 0);
  let w = "";
  for (let i = 0; i < nS; i++) w += syllable(rng, lang, i === 0, i === nS - 1);
  w = w.replace(/(.)\1\1+/g, "$1$1");
  if (lang.orth) for (const [a, b] of lang.orth) w = w.split(a).join(b);
  return cap(w);
}
export function langRealmName(lang, n, base) {
  const rng = mkRng(hash32(lang.seed, "r", lang.gen, n));
  const suf = lang.realmSufs[rng.int(lang.realmSufs.length)];
  let stem = base ? String(base) : langWord(lang, n * 7 + 3);
  if (/[aeiou]$/i.test(stem) && /^[aeiou]/i.test(suf)) stem = stem.slice(0, -1);
  return cap(stem + suf);
}
export function langPersonName(lang, n, female) {
  const rng = mkRng(hash32(lang.seed, "p", lang.gen, n));
  let w = langWord(lang, n * 13 + 5);
  if (female) { if (!/[aeiou]$/i.test(w)) w += lang.vows[rng.int(lang.vows.length)].slice(0, 1); }
  else if (/[aeiou]$/i.test(w) && rng() < 0.6) w += "lrnsd"[rng.int(5)];
  return cap(w);
}
export function langDynastyName(lang, n, founder) {
  let stem = founder ? String(founder) : langWord(lang, n * 17 + 11);
  if (/[aeiou]$/i.test(stem)) stem = stem.slice(0, -1);
  return cap(stem + lang.dynSuf);
}

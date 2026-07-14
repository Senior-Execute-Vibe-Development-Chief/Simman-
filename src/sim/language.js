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
import { applicableRules, applyRules, legalizeWord } from "./languageChange.js";
import { bequeathGrammar, adpSourceOf, gramOf } from "./languageGrammar.js";
import { CONCEPTS, COLEX, DERIV, TOPO_HEAD, TOPO_MOD, PERSON_POOL, LOAN_POOL, LAND, SON, TOWN, FORT, HOUSE,
  BK_TERMS, BK_PARENT, KIN_MERGES, KIN_SLOTS, MOTION_DV, MOTION_PATH_ADP, MOTION_SAT_RATE,
  GREEN, BLUE, YELLOW, BROWN, PURPLE, PINK, ORANGE, GREY,
  AGENT_BASE, MAN, PEOPLE, BODY, CULTURES, ECOLOGY_DOMAINS } from "./languageLexicon.js";

const h01 = (...a) => hash32(...a) / 4294967296;
const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1);

// ── the intentional abstract-derivation table, grouped by target ──────────
// DERIV (languageLexicon.js) lists curated [target, head, mod, weight] pathways
// for abstract concepts (king ‹ "great man", god ‹ "sky father"). A family
// rolls, per concept, whether to derive at all (DERIV_RATE) and — if so — which
// pathway (weighted). Kept a rolled SYSTEM, never a fixed output: the same idea
// is built from different parts in different tongues, or kept as an opaque root.
const DERIV_BY_TARGET = (() => {
  const m = new Map();
  for (const [t, head, mod, w] of DERIV) (m.get(t) || m.set(t, []).get(t)).push({ head, mod, w });
  return m;
})();
const DERIV_RATE = 0.72;   // P(a given family derives a given abstract vs keeps an opaque root)

// ── the agentive nominalizer (item 1.5) ───────────────────────────────────
// An agent noun ('ruler') = a base verb ('rule') + a grammaticalized AGENTIVE
// affix, worn from the family's OWN 'person' word (Heine–Kuteva: 'man' is the
// commonest source cross-linguistically, then 'person/people', then 'body/
// self'). The source is per-FAMILY, so every agent in a family carries the SAME
// worn affix — the regularity that makes it an affix (-er, -sha, -ci, mu-) and
// not a per-word compound. (The analytic 'V-person' compound — a full 'person'
// word, un-worn — is already how GUARDIAN ‹ guard+man is built; this is its
// SYNTHETIC, bound-affix counterpart, which is what 'affixal derivation' means.)
function agentSourceOf(lang) {
  const pin = lang.prof.lex && lang.prof.lex.agent;   // pinnable (probe/Lab), like motion
  if (pin != null) return pin;
  const roll = h01(lang.famSeed, "agentsrc");
  return roll < 0.5 ? MAN : roll < 0.83 ? PEOPLE : BODY;
}
// reduce a source noun's INTERNAL form to ONE bound affix syllable — the worn
// nominalizer (-er ‹ 'man', mu- ‹ 'person'). Keep the salient first syllable,
// trim its onset and coda to a single consonant: an unstressed clitic that
// still rides the sound-change log, so it corresponds regularly to the free
// 'person' word across the family (mu-ntu, per-son, the survivor of erosion).
function lightAffix(word) {
  const s = word.syls[0];
  return { syls: [{ on: s.on.slice(0, 1).map(x => ({ ...x })), nu: s.nu.slice(0, 1).map(x => ({ ...x })), co: s.co.slice(0, 1).map(x => ({ ...x })) }] };
}
// attach a bound affix to a stem WITHOUT the compound machinery's erosion: a
// productive derivation keeps its base whole (that is what makes it read as
// 'rule'+er and stay transparent), so joinInternal's blend-truncation and
// syllable cap — right for old lexicalised names — must not fire here. Only the
// seam is repaired: a fusional tongue elides the seam vowel (the fusion that
// makes the affix cling and alternate), and a glide breaks vowel hiatus, both
// exactly as joinInternal does. Prefixing? the affix leads (Bantu m-); else it
// trails (English -er). Both morphemes still ride the sound-change log, so the
// agent corresponds regularly to its base and to its cognates across the family.
function joinAffix(lang, stem, affix, prefixing) {
  const a = copyWord(prefixing ? affix : stem), b = copyWord(prefixing ? stem : affix);
  const lastA = a.syls[a.syls.length - 1], firstB = b.syls[0];
  if (lang.prof.morph === "fus" && lastA.nu.length && !lastA.co.length && !firstB.on.length) {
    lastA.nu = [];
    if (!lastA.nu.length && !lastA.co.length && lastA.on.length) { firstB.on = [...lastA.on, ...firstB.on]; a.syls.pop(); }
  } else if (lastA.nu.length && !lastA.co.length && !firstB.on.length && firstB.nu.length) {
    firstB.on = [firstB.nu[0].b === 0 ? { p: 3, m: 6, l: 1, s: 0 } : { p: 0, m: 6, l: 1, s: 0 }];
  }
  return { syls: [...a.syls, ...b.syls] };
}

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
    // a borrowed writing tradition is family property — daughters inherit it
    ...(parent && parent.scr ? { scr: JSON.parse(JSON.stringify(parent.scr)) } : {}),
  };
  languagesOf(world).set(id, lang);
  // grammar is settled AT BIRTH from the parent's — so whether anyone read
  // the parent's grammar earlier can never change what the daughter gets
  if (parent) bequeathGrammar(parent, lang);
  // a fresh root tongue arrives with a little history already in its bones
  if (!parent) { const n = 1 + (hash32(s, "age") % 2); for (let i = 0; i < n; i++) driftLanguage(world, lang); }
  return lang;
}

/** One step of sound change: append a rule from the profile's applicable set. */
export function driftLanguage(world, lang) {
  ensureV2(lang);
  const ap = applicableRules(lang.prof);
  const rule = ap[hash32(lang.seed, "rule", lang.gen) % ap.length];
  lang.rules.push(rule);
  // TONOGENESIS (phase 4): when the register→tone rule fires, the language
  // BECOMES tonal — a persisted profile change, like the rule that caused it.
  // prof.phonation stays (it describes the proto-language whose registers the
  // replayed rule keeps stripping); the tone flag alone stops the rule being
  // offered again. Daughters branched after this inherit the tonal profile.
  if (rule === 12 && !lang.prof.tone) { lang.prof.tone = 1; lang.prof.toneMarks = true; }
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
    // a borrowed writing tradition is family property — daughters inherit it
    ...(parent.scr ? { scr: JSON.parse(JSON.stringify(parent.scr)) } : {}),
  };
  languagesOf(world).set(id, child);
  // grammar settles AT BIRTH (see foundLanguage) — reads stay side-effect-free
  bequeathGrammar(parent, child);
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
  // (b) a prestige word crosses over (frozen at borrow time, foreign look
  // kept). The record carries the donor's spoken FORM too — borrowing
  // happens by ear, so the borrower can speak and write what it heard
  // (chained through the donor's own loans, the way 'coffee' crossed
  // half the planet one contact at a time)
  if (rng() < 0.8) {
    const cid = LOAN_POOL[rng.int(LOAN_POOL.length)];
    const dl = donor.loans.filter(x => x.c === cid).pop();
    const f = dl ? (dl.f ? JSON.parse(JSON.stringify(dl.f)) : null) : nativeStemOf(donor, cid);
    lang.loans.push({ c: cid, w: wordOf(donor, cid), d: donor.id, ...(f ? { f } : {}) });
  }
  lang.gen++;
}

/** The loan record shadowing a concept, or null (the last borrowing wins,
 *  exactly as wordOf prefers it). `f` is the donor's spoken form at borrow
 *  time; legacy records (pre-form saves) may lack it. */
export function loanOf(lang, cid) {
  ensureV2(lang);
  for (let i = lang.loans.length - 1; i >= 0; i--) if (lang.loans[i].c === cid) return lang.loans[i];
  return null;
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

// ── cultural ecology (item 1.6) ───────────────────────────────────────────
// The salient-domain colex threshold multiplier: a lived-in distinction is half
// as likely to be lost to a merger. A real prior on distinction-retention, not
// a knob fitted to any one word.
const CULTURE_SALIENCE = 0.5;
// the family's ecology, or null for a pinned reference tongue (whose colex must
// stay byte-identical); pinnable via prof.lex.culture for the Lab and gates.
function cultureFor(lang) {
  if (lang.pin) return null;
  const pin = lang.prof.lex && lang.prof.lex.culture;
  if (pin) return CULTURES.find(c => c.k === pin) || null;
  return CULTURES[hash32(lang.famSeed, "culture") % CULTURES.length];
}

/** The family's cultural ecology (item 1.6): its subsistence focus and the
 *  semantic domain it keeps lexically finest. Null for pinned reference tongues. */
export function cultureOf(lang) {
  const c = cultureFor(lang);
  return c ? { kind: c.k, gloss: c.g, salient: c.salient } : null;
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
  // family-level semantic structure: colexification + derive-vs-root choices.
  // CULTURAL ECOLOGY (item 1.6): the family's subsistence focus makes it keep
  // FINER distinctions in its salient domain — a seafaring tongue merges sea/
  // lake/river far less than a landlocked one. The colex ROLL is unchanged (same
  // stream); only the THRESHOLD drops (× CULTURE_SALIENCE) for a colex pair
  // whose domain is this culture's salient one, and only within the ecology
  // domains. Every other pair — and every pinned reference tongue — keeps its
  // exact threshold, so nothing outside the lived-in domain re-baselines.
  const cult = cultureFor(lang);
  const colex = new Map();
  COLEX.forEach(([a, b, p], i) => {
    const pAdj = cult && ECOLOGY_DOMAINS.has(CONCEPTS[a].d) && CONCEPTS[a].d === cult.salient ? p * CULTURE_SALIENCE : p;
    if (h01(lang.famSeed, "colex", i) < pAdj) colex.set(b, a);
  });
  c = { key, inv, colex, words: new Map(), internals: new Map(), roots: new Map(), sufs: null, seeded: false };
  // ── LEXICAL TYPOLOGY (phase 2): the Berlin–Kay color hierarchy and the
  // kinship system, both expressed as colexification of the APPENDED concepts
  // onto older ones (new→old only, so no pre-existing surface ever moves).
  //
  // COLORS: the split rolls are IMPLICATIONAL by construction — brown can
  // only split after yellow, the late terms (purple/pink/orange) only after
  // brown, and a grue family (green=blue, the pre-existing colex read here
  // as the stage anchor) never splits past yellow: blue precedes brown in
  // the hierarchy. An unsplit term colexifies onto its BK_PARENT, resolving
  // through the chain (orange→yellow→red when yellow is unsplit too).
  // Split rates are the hierarchy's cross-linguistic shape (yellow near-
  // universal, the stage-VII terms minority), on own bk:* streams.
  //
  // KINSHIP: one of Morgan's classic types per family (rates ~Murdock:
  // generational and bifurcate-merging commonest, bifurcate-collateral
  // rarest) — the type IS a merge list (KIN_MERGES) applied as colex, so
  // whether mother's-brother shares father's word is typology, not
  // translation. References pin all of this via prof.lex (scenario data).
  {
    const fam = lang.famSeed;
    const lex = lang.prof.lex || null;
    const grue = colex.get(GREEN) === BLUE;
    const full = !!lex && lex.bk === "full";
    const split = {
      [YELLOW]: full || h01(fam, "bk:yellow") < 0.78,
    };
    split[BROWN] = full || (split[YELLOW] && !grue && h01(fam, "bk:brown") < 0.55);
    split[PURPLE] = full || (split[BROWN] && h01(fam, "bk:purple") < 0.5);
    split[PINK] = full || (split[BROWN] && h01(fam, "bk:pink") < 0.45);
    split[ORANGE] = full || (split[BROWN] && h01(fam, "bk:orange") < 0.42);
    split[GREY] = full || (split[BROWN] && h01(fam, "bk:grey") < 0.55);   // a late/wildcard term — no basic grey below the late stage
    for (const [cid, pool] of BK_PARENT) {
      if (split[cid]) continue;
      let r = h01(fam, "bk:src", cid), parent = pool[pool.length - 1][0];
      for (const [p, w] of pool) { r -= w; if (r < 0) { parent = p; break; } }
      colex.set(cid, parent);
    }
    const kr = h01(fam, "kintype");
    c.kinType = lex && lex.kin ? lex.kin
      : kr < 0.3 ? "hawaiian" : kr < 0.6 ? "iroquois" : kr < 0.85 ? "eskimo" : "sudanese";
    for (const [nk, tgt] of KIN_MERGES[c.kinType]) colex.set(nk, tgt);
  }
  COMPILED.set(lang, c);
  return c;
}

// ── homophony repair (the 狮→狮子 machine) ─────────────────────────────────
// The saturation guard sizes a language so its vocabulary CAN fit, but the
// licensed syllabary + frequency skew still let unrelated basic words
// collide by accident. Real languages don't tolerate that in core vocabulary
// — a homophone that arises gets DISAMBIGUATED, classically by lengthening
// (Mandarin adds 子 to a bare monosyllable). So: assign the dictionary in a
// fixed order and, when a fresh word's surface collides with one already
// taken by an UNRELATED concept, extend/reshape it until it clears.
// Colexified pairs (tree/wood) are intended merges and are skipped.
//
// CRITICAL: the repair targets the PRE-RULE ROOT of an atomic concept, not
// the evolved surface — so the grammar layer (which builds paradigms and
// numerals from rootFormOf) and the dictionary (wordOf/internalOf) draw from
// the SAME repaired root and can never disagree. (An early version repaired
// only the post-rule form; the paradigm's citation cell and the counting
// system then read the un-repaired root — the 'go=šüvep vs šüvepxik' and
// '6=paxobe vs deqe' desyncs a fresh reader caught.)
function growWord(lang, w, cid, attempt, allowLong = false) {
  const c = COMPILED.get(lang);
  const out = copyWord(w);
  const rng = mkRng(hash32(lang.famSeed, "homrep", cid, attempt));
  // a derived compound is already 3 syllables (its erosion cap), so the reshape
  // path alone can fail to clear a rare collision; let the repair add ONE
  // disambiguating syllable past the cap — exactly the 狮→狮子 lengthening this
  // machine is modelled on (a homophone is worse than a slightly longer word)
  if (attempt <= 2 && out.syls.length < (allowLong ? 4 : 3)) {
    const grown = synthWord(rng, lang.prof, c.inv, 1).syls;
    // a HARMONY language's repair syllable takes the host word's class —
    // speakers don't append a disharmonic tail (the appended syllable rolled
    // its own class above; retint the non-low nuclei to match the host)
    const H = lang.prof.harmony;
    if (H && H !== "none") {
      let host = null;
      for (const s of out.syls) { for (const v of s.nu) if (v.h !== 2) { host = v; break; } if (host) break; }
      if (host) for (const s of grown) for (const v of s.nu) {
        if (v.h === 2) continue;
        if (H === "fb") v.b = host.b === 0 ? 0 : 2;
        else if (H === "round") v.r = host.r;
        else if (H === "atr") v.atr = host.atr ? 1 : 0;
      }
    }
    out.syls.push(...grown);   // the -zi/-tou lengthening
  } else {
    const v = c.inv.vows[rng.int(c.inv.vows.length)];
    const s = out.syls[out.syls.length - 1];
    if (s.nu.length) s.nu = [{ ...v, n: s.nu[0].n, lg: 0 }];
    if (!s.co.length && c.inv.cons.length) s.co = [{ ...c.inv.cons[rng.int(Math.min(8, c.inv.cons.length))] }];
  }
  out.tseed = (out.tseed ^ hash32(lang.famSeed, "homtseed", cid, attempt)) >>> 0;   // fresh tone melody
  return out;
}

// resolve a concept through this family's colexification merges (river→water)
function colexResolve(c, id) { let x = id, h = 0; while (c.colex.has(x) && h++ < 6) x = c.colex.get(x); return x; }

const weightedPick = (cands, r01) => {
  let r = r01 * cands.reduce((s, p) => s + p.w, 0);
  for (const p of cands) if ((r -= p.w) < 0) return p;
  return cands[cands.length - 1];
};
const DERIV_TARGETS = [...DERIV_BY_TARGET.keys()].sort((a, b) => a - b);
// dictionary seeding order: FREQUENCY (basicness) descending, cid ascending as
// a stable tiebreak. The most-used words claim the short surfaces FIRST, so
// when the homophony repair has to lengthen a colliding word it lengthens the
// RARE one — not the frequent one (Zipf again, at the collision layer). The
// old cid order let a high-frequency but late-appended concept — every low
// numeral sits near the cid tail — collide with the ~230 words seeded before
// it and grow a spurious syllable ('two' = gyeitavve).
const SEED_ORDER = Array.from({ length: CONCEPTS.length }, (_, i) => i)
  .sort((a, b) => (CONCEPTS[b].b - CONCEPTS[a].b) || (a - b));

// Assign every abstract target its derivation pathway ONCE per family, so two
// distinct abstracts never receive the SAME coinage. The DERIV table shares
// source pairs on purpose ([MAN,OLD] → king/council/priest), and an
// independent per-concept roll lets several land on one pair — the surface
// homophony repair then only separates them by growing a syllable, so B reads
// as A+suffix (oath ‹ law). This is the coinage-level analog of that repair:
// walk targets in a fixed order, and if a target's weighted pick is a pair
// another abstract already claimed, take its next free pathway. famSeed-only +
// colex ⇒ deterministic and inherited down a family; cached on the compiled
// state (rebuilt with the inventory, invalidated on gen/loans/xph change).
function buildDerivMap(c, famSeed) {
  const map = new Map();
  const taken = new Set();
  for (const cid of DERIV_TARGETS) {
    if (h01(famSeed, "deriv", cid) >= DERIV_RATE) { map.set(cid, null); continue; }
    const ok = DERIV_BY_TARGET.get(cid).filter(p => {
      const rh = colexResolve(c, p.head), rm = colexResolve(c, p.mod);   // drop cyclic/duplicate pathways
      return rh !== cid && rm !== cid && rh !== rm;
    });
    if (!ok.length) { map.set(cid, null); continue; }
    const pick = weightedPick(ok, h01(famSeed, "derivpick", cid));
    const key = (p) => p.head + "," + p.mod;
    const chosen = taken.has(key(pick))
      ? ([pick, ...ok.filter(p => p !== pick)].find(p => !taken.has(key(p))) || pick)
      : pick;
    taken.add(key(chosen));
    map.set(cid, [chosen.head, chosen.mod]);
  }
  return map;
}

// The effective derivation source pair [head, mod] for a concept in THIS
// family, or null if it lexicalizes as an opaque root. Two kinds of concept
// derive, through the SAME machinery so the layers can never disagree:
//   · concrete concepts carry a fixed con.dv (FORD ‹ river+water) — the family
//     rolls the long-standing "dv" stream at 65% (UNCHANGED, so existing names
//     for these are byte-identical);
//   · abstract concepts draw a per-family pathway from the curated DERIV table
//     (king ‹ great+man), assigned once per family with cross-target dedup —
//     the intentional-derivation machinery, on its own "deriv"/"derivpick"
//     streams so it perturbs nothing above.
function derivParts(lang, cid) {
  const con = CONCEPTS[cid];
  // MOTION TYPOLOGY (Talmy, phase 2): a satellite-framed family DERIVES its
  // path verbs from GO + the same body sources its adpositions wear
  // ('belly-go' = in-go, the eingehen shape); a verb-framed (or equipollent)
  // one lexicalizes them as opaque roots (entrar). One shared stream/rate
  // with the clause layer (MOTION_SAT_RATE), pinnable via prof.lex.
  if (MOTION_DV.has(cid)) {
    const pin = lang.prof.lex && lang.prof.lex.motion;
    const sat = pin ? pin === "sat" : h01(lang.famSeed, "motion") < MOTION_SAT_RATE;
    if (!sat) return null;
    // the compound's modifier is the family's OWN adposition source, so the
    // path verb is cognate with the satellite it echoes ('house-go' where
    // 'in' ‹ house); the canonical body source when the adposition is opaque
    const [head, dflt] = MOTION_DV.get(cid);
    const src = adpSourceOf(lang, MOTION_PATH_ADP.get(cid));
    return [head, src != null ? src : dflt];
  }
  // AGENTIVE (item 1.5): an agent noun derives from [base verb, 'person' source]
  // in EVERY family — agentive nominalization is productive and near-universal,
  // so (unlike the abstracts) there is no derive-or-not roll; the per-family
  // variation is the affix source and whether it reduced (handled in internalOf).
  if (AGENT_BASE.has(cid)) return [AGENT_BASE.get(cid), agentSourceOf(lang)];
  if (con.dv) return h01(lang.famSeed, "dv", cid) < 0.65 ? con.dv : null;
  if (!DERIV_BY_TARGET.has(cid)) return null;
  const c = compile(lang);
  if (!c.derivMap) c.derivMap = buildDerivMap(c, lang.famSeed);
  return c.derivMap.get(cid) || null;
}

// is this concept lexicalized as a compound (derived) in this family?
// (folds in the roll; must match internalOf's branch exactly)
function isDerived(lang, cid) {
  const pr = derivParts(lang, cid);
  return !!pr && internalOf(lang, pr[0]) !== internalOf(lang, pr[1]);
}

function seedDictionary(lang, c) {
  if (c.seeded) return;
  c.seeded = true;                                     // set first: internalOf below must not re-enter
  const taken = new Map();                             // rendered surface → owning cid
  for (const cid of SEED_ORDER) {                      // frequency order: frequent words claim short surfaces first
    if (c.colex.has(cid)) continue;                    // intended merge, not a collision
    let surf = renderWord(internalOf(lang, cid), lang.prof);
    let guard = 0;
    const derived = isDerived(lang, cid);
    while (taken.has(surf) && guard++ < 6) {
      if (derived) {
        c.internals.set(cid, legalizeWord(growWord(lang, internalOf(lang, cid), cid, guard, true)));
      } else {
        const root = growWord(lang, rootOf(lang, cid), cid, guard);   // extend the ROOT
        c.roots.set(cid, root);
        c.internals.set(cid, applyRules(lang.rules, copyWord(root)));  // re-evolve as one piece
      }
      surf = renderWord(internalOf(lang, cid), lang.prof);
    }
    taken.set(surf, cid);
  }
}

// the (possibly repaired) PRE-rule root of an atomic concept — the single
// source of truth both internalOf and the grammar layer build from
function rootOf(lang, cid) {
  const c = compile(lang);
  const r = c.roots.get(cid);
  if (r) return r;
  const w = synthRoot(lang, cid);
  c.roots.set(cid, w);
  return w;
}

// ── the virtual dictionary ────────────────────────────────────────────────

/** Internal (feature-bundle) form for a concept's NATIVE word: family root
 *  replayed through this language's rule log — cognates across the family
 *  correspond regularly because they share the root and differ in the log. */
function internalOf(lang, cid) {
  const c = compile(lang);
  // first access seeds the whole dictionary in a fixed order with homophony
  // repair (seedDictionary sets c.seeded before re-entering, so this recurses
  // exactly once); after that every form is served from the deduped cache
  if (!c.seeded) seedDictionary(lang, c);
  const seen = c.internals.get(cid);
  if (seen) return seen;
  const con = CONCEPTS[cid];
  const merged = c.colex.get(cid) ?? cid;
  if (merged !== cid) { const w = internalOf(lang, merged); c.internals.set(cid, w); return w; }
  let w;
  const pr = derivParts(lang, cid);
  const parts = pr && [internalOf(lang, pr[0]), internalOf(lang, pr[1])];
  // (if this family colexified the two parts into ONE lexeme, a compound
  // would duplicate it — "water-water" — so coin a root instead)
  if (pr && parts[0] !== parts[1]) {
    if (AGENT_BASE.has(cid)) {
      // AGENTIVE (item 1.5): base-verb stem + a grammaticalized 'person' affix.
      // parts[0] is the base's reflex (the transparent stem), parts[1] the
      // family's 'person' reflex, worn to one clitic syllable (the -er / -sha /
      // mu- affix). The affix is the nominalizing HEAD (it makes the word a
      // noun) and the base the modifier, so the compound STRATEGY places it
      // correctly: a head-LAST family suffixes it (base+affix: -er, -sha, -ci),
      // a head-FIRST family prefixes it (affix+base: the Bantu m-). The
      // agentive's position tracks the family's headedness for free — nothing
      // time- or case-gated. joinAffix keeps the base morpheme whole (no blend
      // erosion, no compound cap), so the derivation reads transparently.
      const prefixing = (lang.prof.compound || "hl") === "hf";
      w = legalizeWord(joinAffix(lang, parts[0], lightAffix(parts[1]), prefixing));
    } else {
      // derived concept: a compound of its parts (or a re-vowelled pattern of
      // the head root, if the tongue is templatic — derivation by pattern, where
      // the pattern itself is the modifier's exponent: pass the mod so different
      // pathways give different patterns, not one m-word for the whole abstract set)
      if (lang.prof.morph === "tmpl") w = revowel(lang, parts[0], cid, pr[1]);
      else w = joinInternal(lang, parts[1], parts[0]);
      // EROSION: a transparent compound wears to a 1–3 syllable stump (the same
      // "no daily word is 5+ syllables" principle as rootLen/erodeName). Common
      // concrete compounds erode when frequent (b≥0.5); the curated ABSTRACT
      // derivations always do — a rare-but-derived word like 'throne' (‹ king+
      // sit) still nests two roots deep, and no tongue says a four-heavy-syllable
      // word for it, so it wears down regardless of its own frequency.
      const abstract = !con.dv && DERIV_BY_TARGET.has(cid);
      if ((con.b >= 0.5 || abstract) && w.syls.length > 3) w.syls = [w.syls[0], ...w.syls.slice(-2)];
      // legalize so the dictionary form is byte-identical to what the grammar
      // layer's rootFormOf (pre:false → legalizeWord) builds — one source of
      // truth for derived concepts too (the session-11 desync lesson)
      w = legalizeWord(w);
    }
  } else {
    // atomic: evolve the (possibly homophony-repaired) root as one piece, so
    // wordOf and the grammar layer's rootFormOf never diverge
    w = applyRules(lang.rules, copyWord(rootOf(lang, cid)));
  }
  c.internals.set(cid, w);
  return w;
}

// the PRE-sound-change family root for an atomic concept — the form the
// grammar layer needs when an affix grammaticalized early and must replay
// only the tail of the rule log
function synthRoot(lang, cid) {
  const c = compile(lang);
  const con = CONCEPTS[cid];
  const rng = mkRng(hash32(lang.famSeed, "root", cid));
  return lang.prof.morph === "tmpl" ? synthTemplatic(rng, lang.prof, c.inv, cid, lang.famSeed)
    : synthWord(rng, lang.prof, c.inv, rootLen(rng, lang.prof, con.b));
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

/** If this concept is colexified onto another in this family (the tree→wood
 *  merge), the concept it shares its word with; else -1. Lets the UI tell an
 *  INTENDED merge ("shared word") from an accidental homophone. */
export function colexPartner(lang, cid) {
  ensureV2(lang);
  const c = compile(lang);
  return c.colex.has(cid) ? c.colex.get(cid) : -1;
}

/** The recoverable etymology of a concept in THIS family, or null if it is an
 *  opaque root. `{ head, mod, gloss }` — head/mod are concept ids, gloss reads
 *  "mod head" (king ‹ 'great man', god ‹ 'sky father'). Covers both the curated
 *  abstract derivations (DERIV) and the concrete `dv` ones (ford ‹ 'water
 *  river'); it agrees with the actual word by construction, because the word IS
 *  the compound of these parts replayed through the sound-change log. */
export function etymologyOf(lang, cid) {
  ensureV2(lang);
  const c = compile(lang);
  if (!c.seeded) seedDictionary(lang, c);
  // a loan shadows the native form (wordOf returns the borrowed surface), so
  // the native etymology no longer describes the DISPLAYED word — report none,
  // exactly as wordOf prefers the loan (the Lab shows the loan stratum apart)
  for (let i = lang.loans.length - 1; i >= 0; i--) if (lang.loans[i].c === cid) return null;
  if (c.colex.has(cid)) return null;                 // a merged concept borrows, doesn't derive
  const pr = derivParts(lang, cid);
  if (!pr || internalOf(lang, pr[0]) === internalOf(lang, pr[1])) return null;
  return { head: pr[0], mod: pr[1], gloss: glossOf(pr[1]) + " " + glossOf(pr[0]) };
}

// ── grammar-layer access (languageGrammar.js) ─────────────────────────────
// The grammar module derives closed-class words, paradigms and clauses from
// the SAME compiled state the dictionary uses. These exports hand that state
// over without exposing the caches: everything word-shaped is a deep copy
// (sound-change rules mutate words in place; the caches must never bleed).

/** The compiled inventory (with licensed syllabary). Treat as read-only. */
export function compiledInv(lang) { ensureV2(lang); return compile(lang).inv; }

/** Evolved native internal form for a concept (deep copy; loans ignored —
 *  grammaticalized material fossilizes, borrowings never replace grammar). */
export function nativeStemOf(lang, cid) { ensureV2(lang); return copyWord(internalOf(lang, cid)); }

/** Pre-rule family root for a concept (deep copy). Falls back to the evolved
 *  form for derived/compound concepts — pre:false tells the caller the rule
 *  log is already baked in. Colexification resolves first, like internalOf.
 *  For atomic concepts this returns the SAME homophony-repaired root that
 *  internalOf evolves, so the grammar layer's citation forms and numerals
 *  match the dictionary exactly. */
export function rootFormOf(lang, cid) {
  ensureV2(lang);
  const c = compile(lang);
  if (!c.seeded) seedDictionary(lang, c);
  let id = cid, hops = 0;
  while (c.colex.has(id) && hops++ < 4) id = c.colex.get(id);
  if (isDerived(lang, id))
    return { w: copyWord(internalOf(lang, id)), pre: false };
  return { w: copyWord(rootOf(lang, id)), pre: true };
}

// root length from the language's own distribution (Vietnamese-short through
// Greenlandic-long), shaped by ZIPF'S LAW OF ABBREVIATION — the most robust
// quantitative universal in linguistics: within any language, frequency
// predicts brevity. The core Swadesh vocabulary, the low numerals, the
// most-used verbs are short EVERYWHERE, because use wears them down; a
// trisyllabic word for 'two' is a language that has never been spoken.
// Basicness `b` IS that frequency rank (water 1.0, law 0.6, harbor 0.5), so
// the length bias scales continuously with it (slope 3.4 over the b range,
// centred at b≈0.66), and the very top of the list is CAPPED short so a core
// word or a low numeral can never be a three-syllable mouthful.
function rootLen(rng, prof, b) {
  const bias = 3.4 * (0.66 - b);                          // b=1 → −1.16, b=0.7 → −0.14, b=0.4 → +0.88
  const n = Math.round((prof.wordLen || 2) + (rng() - 0.5) + bias);
  const cap = b >= 0.95 ? 2 : b >= 0.8 ? 3 : 4;           // no daily word is 5+ syllables; no core word 3+
  return Math.max(1, Math.min(cap, n));
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
// templatic derivation: keep the HEAD's consonant skeleton, interleave a vowel
// PATTERN (maktab-style). The pattern is the derivation's morpheme — a
// discontinuous one — so it is keyed on the pathway (the modifier), not just
// the target: king ‹ great+man and king ‹ old+man are DIFFERENT patterns of the
// man-skeleton, so the pathway roll is audible and the "mod head" gloss names a
// real (patterned) exponent. Several templates (varying the prefix and the
// vowel melody) keep the abstract vocabulary from collapsing to one m- rhyme.
function revowel(lang, head, cid, modCid = cid) {
  const c = compile(lang);
  const skel = [];
  for (const s of head.syls) { for (const x of s.on) skel.push({ ...x }); for (const x of s.co) skel.push({ ...x }); }
  while (skel.length < 3) skel.push({ ...c.inv.cons[hash32(lang.famSeed, "fill", cid, skel.length) % c.inv.cons.length] });
  const vs = c.inv.vows, K = skel;
  const v1 = { ...vs[hash32(lang.famSeed, "rv", cid, modCid) % vs.length] };
  const v2 = { ...vs[hash32(lang.famSeed, "rv2", cid, modCid) % vs.length] };
  // affix consonants drawn from the family's own inventory (fallback to the
  // canonical m/t/n bundles) — no pattern invents a sound the tongue lacks
  const pk = (m, p, dflt) => c.inv.cons.find(x => x.m === m && x.p === p) || dflt;
  const M = pk(1, 0, { p: 0, m: 1, l: 1, s: 0 }), T = pk(0, 1, { p: 1, m: 0, l: 1, s: 0 }), N = pk(1, 1, { p: 1, m: 1, l: 1, s: 0 });
  const pat = hash32(lang.famSeed, "tmplpat", cid, modCid) % 5;
  const S = (on, nu, co = []) => ({ on: on ? [{ ...on }] : [], nu: [{ ...nu }], co: co.map(x => ({ ...x })) });
  let syls;
  if (pat === 0) syls = [S(M, v1), S(K[0], v1), S(K[1], v2, [K[2]])];        // maCaCiC
  else if (pat === 1) syls = [S(K[0], v1), S(K[1], v2, [K[2]])];             // CaCiC (no affix)
  else if (pat === 2) syls = [S(null, v1, [K[0]]), S(K[1], v2, [K[2]])];     // aCCiC (vowel-initial)
  else if (pat === 3) syls = [S(T, v1), S(K[0], v2), S(K[1], v1, [K[2]])];   // taCaCiC
  else syls = [S(N, v1), S(K[0], v2, [K[2]])];                               // naCiC (n- prefix, 2-syl)
  return legalizeWord({ syls });
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
// England's map runs on a tiny closed suffix set (-ton -ham -ford -wick),
// used obsessively — so the suffix itself must be phonotactically VETTED,
// not just whatever the lexicon rolled for 'town'
const EN_SUF = /^[bdfghklmnprstw]?[aeiouy]{1,2}(th|ck|[bdfgklmnprstz])?$/i;
function sufsOf(lang) {
  const c = compile(lang);
  if (c.sufs) return c.sufs;
  const vetted = (s) => lang.prof.ortho !== "en" || (EN_SUF.test(s) && /[bdfgklmnprstzy]$/i.test(s));
  const reduce = (cid) => {
    const w = internalOf(lang, cid);
    let last = "an";
    for (let k = 0; k < 4; k++) {
      const s = k === 1 ? w.syls[0] : w.syls[w.syls.length - 1];
      const co = s.co.length ? s.co.slice(0, 1) : (k >= 2 ? [{ p: 1, m: 1, l: 1, s: 0 }] : []);   // borrow an -n if the root offers no coda
      const r = { syls: [{ on: s.on.slice(0, 1), nu: s.nu.slice(0, 1), co }] };
      let out = renderWord(r, lang.prof);
      // a suffix is not a standalone word: strip the silent-e clothing the
      // renderer may have dressed it in before judging it (-lune → -lun)
      if (lang.prof.ortho === "en" && !vetted(out) && vetted(out.replace(/e$/, ""))) out = out.replace(/e$/, "");
      if (vetted(out)) return out;
      last = out;
    }
    return last;
  };
  const femV = (() => { const v = c.inv.vows.find(v => v.h === 2) || c.inv.vows[0]; return renderWord({ syls: [{ on: [], nu: [v], co: [] }] }, lang.prof); })();
  // a dynasty names CONSISTENTLY within a language (a cultural constant, not a
  // per-name coin flip that yielded Efatucheta beside a bare Edo): the house
  // suffix is chosen once per family — either a fixed land-style ending, or
  // consistently bare (the toponymic Habsburg pattern), never a mix.
  const realmSufs = [reduce(LAND), reduce(LAND) + femV].filter(Boolean);
  const dyn = h01(lang.famSeed, "dynbare") < 0.3 || !realmSufs.length ? ""
    : realmSufs[hash32(lang.famSeed, "dynidx") % realmSufs.length];
  c.sufs = {
    city: [reduce(TOWN), reduce(FORT), reduce(HOUSE), ""],
    realm: [reduce(LAND), reduce(LAND) + femV, ""],
    patro: reduce(SON),
    fem: femV,
    dyn,
  };
  return c.sufs;
}

const joinSuf = (stem, suf) => {
  if (!suf) return stem;
  if (/[aeiou]$/i.test(stem) && /^[aeiou]/i.test(suf)) stem = stem.slice(0, -1);
  return stem + suf;
};
// name-level surgery (caps, suffixes, gender endings) can undo the final
// orthographic conventions — re-apply the word-final ones afterwards.
// Names get EXTRA respelling beyond dictionary words: -oo and -ee finals
// read fine in running vocabulary but poison a proper noun repeated fifty
// times in a chronicle (King Yintoo of Chudree → King Yintow of Chudry).
const finishName = (w, prof) => {
  if (prof.ortho !== "en") return w;
  return w
    .replace(/([aeiou])([aeiou])[aeiou]+/g, "$1$2")
    .replace(/u$/i, () => ["ue", "ew", "o", "ow", "ue", "o", "ew", "oo"][hash32(w, "u") % 8])
    .replace(/oo$/i, (m) => ["ow", "ew", "o", "oo"][hash32(w, "oo") % 4])   // names keep a rare Waterloo
    .replace(/ee$/i, () => ["ey", "y"][hash32(w, "ee") % 2])
    .replace(/([^yi])i$/i, "$1y")
    .replace(/([bdgkpt])([mn]y?)$/i, "$2")        // suffix-seam repair: -bmy → -my
    .replace(/([bdgkmnprt])\1$/i, "$1");          // no doubled finals except ll/ss/ff (Klusinn → Klusin)
};

// ── name erosion ──────────────────────────────────────────────────────────
// Placenames are OLD words: Oxford was Oxenaforda, York was Eoforwic. A
// transparent four-syllable compound on a map is a young name; erosion
// (middle syllables collapse, then syncope where the wreckage is speakable)
// wears it to the 1–3 syllable stumps real maps are made of.
function erodeName(lang, w) {
  if (!lang.prof.erodeNames) return w;
  while (w.syls.length > 3) w.syls.splice(1, 1);
  if (w.syls.length === 3) {
    const [a, b] = w.syls;
    if (!a.co.length && b.on.length === 1 && !b.co.length) { a.co = b.on.map(c => ({ ...c })); w.syls.splice(1, 1); }
  }
  return w;
}


// ── the MINIMAL-NAME floor (McCarthy & Prince's minimal word) ─────────────
// Content words — and proper names above all — need phonological weight;
// languages AUGMENT a word that erodes below the floor rather than speak it.
// Strict-CV tongues were collapsing coined names to a single bare vowel
// (a language named 'Ā', a woman named 'Ǐ' — a fresh reader caught both), so
// a name whose rendered surface strips to fewer than two letters grows a
// fresh syllable. Only the offending corner pays; the rng is consumed only
// on repair, so every well-formed name is byte-identical.
const stripMarks = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
function minimalNameRepair(lang, rng, w) {
  const c = compile(lang);
  for (let guard = 0; guard < 3 && stripMarks(renderWord(w, lang.prof)).length < 2; guard++) {
    w.syls.push(...synthWord(rng, lang.prof, c.inv, 1).syls);
    legalizeWord(w);
  }
  return w;
}

// ── the public name API (signatures unchanged from v1) ────────────────────

/** The INTERNAL form langWord renders (deep copy) — the vocalizer/IPA layer
 *  reads this so speech and spelling come from one build; langWord itself
 *  routes through here, so the two can never drift apart. */
export function langWordForm(lang, n) {
  ensureV2(lang);
  const c = compile(lang);
  const rng = mkRng(hash32(lang.seed, "w", lang.gen, n));
  return minimalNameRepair(lang, rng, applyRules(lang.rules, synthWord(rng, lang.prof, c.inv, rootLen(rng, lang.prof, 0.85))));
}

/** A generic word of the tongue (faith names, culture endonyms). */
export function langWord(lang, n) {
  return cap(renderWord(langWordForm(lang, n), lang.prof));
}

/** Settlement name + gloss: usually a meaningful compound ("black ford"),
 *  sometimes head+suffix ("…ton"), sometimes a name whose meaning is lost. */
export function langPlaceNameEx(lang, n) {
  ensureV2(lang);
  const sufs = sufsOf(lang);
  const rng = mkRng(hash32(lang.seed, "place", lang.gen, n));
  const roll = rng();
  let name, gloss;
  if (roll < 0.55) {
    const mod = TOPO_MOD[rng.int(TOPO_MOD.length)], head = TOPO_HEAD[rng.int(TOPO_HEAD.length)];
    name = renderWord(erodeName(lang, joinInternal(lang, internalOf(lang, mod), internalOf(lang, head))), lang.prof);
    gloss = glossOf(mod) + " " + glossOf(head);
    if (name.length > 12) { name = wordOf(lang, head); gloss = glossOf(head); }
  } else if (roll < 0.8) {
    const head = TOPO_HEAD[rng.int(TOPO_HEAD.length)];
    name = joinSuf(renderWord(erodeName(lang, copyWord(internalOf(lang, head))), lang.prof), sufs.city[rng.int(sufs.city.length)]);
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
  const sufs = sufsOf(lang);
  const rng = mkRng(hash32(lang.seed, "r", lang.gen, n));
  const stem = base ? String(base)
    : renderWord(minimalNameRepair(lang, rng, applyRules(lang.rules, synthWord(rng, lang.prof, compile(lang).inv, 1 + rng.int(2)))), lang.prof);
  return cap(finishName(joinSuf(stem, sufs.realm[rng.int(sufs.realm.length)]), lang.prof));
}

export function langPersonName(lang, n, female) {
  ensureV2(lang);
  const sufs = sufsOf(lang);
  const rng = mkRng(hash32(lang.seed, "p", lang.gen, n));
  // dithematic naming cultures (the Germanic Æthel-red 'noble-counsel'
  // pattern) weld two meaning elements nearly every time
  const di = lang.prof.nameStyle === "di";
  let w;
  if (rng() < (di ? 0.9 : 0.6)) {
    const a = PERSON_POOL[rng.int(PERSON_POOL.length)];
    if (rng() < (di ? 0.85 : 0.4)) {
      const b = PERSON_POOL[rng.int(PERSON_POOL.length)];
      w = renderWord(joinInternal(lang, internalOf(lang, a), internalOf(lang, b)), lang.prof);
    } else {
      w = wordOf(lang, a);
      // minimal-name floor: a single-letter word cannot serve as a person's
      // name — weld a second meaning element, as name-givers do
      if (stripMarks(w).length < 2) {
        const b = PERSON_POOL[rng.int(PERSON_POOL.length)];
        w = renderWord(joinInternal(lang, internalOf(lang, a), internalOf(lang, b)), lang.prof);
      }
    }
  } else {
    w = renderWord(minimalNameRepair(lang, rng, applyRules(lang.rules, synthWord(rng, lang.prof, compile(lang).inv, 2))), lang.prof);
  }
  if (w.length > 10) w = w.slice(0, 9).replace(/[^aeiou]+$/i, "");
  if (lang.prof.gendered && female && !/[aeiou]$/i.test(w)) w += sufs.fem;
  else if (lang.prof.gendered && !female && w.length > 3 && /[aeiou]$/i.test(w) && rng() < 0.5) w = w.slice(0, -1);
  return cap(finishName(w, lang.prof) || "Ana");
}

export function langDynastyName(lang, n, founder) {
  ensureV2(lang);
  const sufs = sufsOf(lang);
  const rng = mkRng(hash32(lang.seed, "d", lang.gen, n));
  const stem = founder ? String(founder)
    : renderWord(applyRules(lang.rules, synthWord(rng, lang.prof, compile(lang).inv, 2)), lang.prof);
  if (lang.prof.patro === "pre") return cap(sufs.patro) + cap(stem);
  if (lang.prof.patro === "suf") return cap(finishName(joinSuf(stem, sufs.patro), lang.prof));
  return cap(finishName(joinSuf(stem, sufs.dyn), lang.prof));   // consistent house suffix
}

// ── lexical typology (phase 2): color terms and kinship, as this family
// actually carves them ─────────────────────────────────────────────────────

/** The Berlin–Kay picture: the eleven basic color meanings, each with this
 *  language's word and — where the family hasn't split the term — the older
 *  term it colexifies onto (yellow reading as red, orange as yellow…).
 *  `n` counts the BASIC terms (distinct words); `grue` is the green=blue
 *  stage anchor. */
export function colorTermsOf(lang) {
  ensureV2(lang);
  const c = compile(lang);
  if (!c.seeded) { wordOf(lang, BK_TERMS[0]); }   // force the dictionary (colex map is already built)
  const terms = BK_TERMS.map(cid => {
    const m = c.colex.has(cid) ? colexResolve(c, cid) : cid;
    return { cid, g: glossOf(cid), w: wordOf(lang, cid), mergedInto: m !== cid ? m : -1 };
  });
  return { n: new Set(terms.map(t => t.w)).size, grue: c.colex.get(GREEN) === BLUE, terms };
}

/** The kinship system: one of Morgan's classic types, and each genealogical
 *  slot with this language's word and the slot it shares it with (whether
 *  mother's-brother = father's-brother — or = father — is the TYPE). */
export function kinshipOf(lang) {
  ensureV2(lang);
  const c = compile(lang);
  const terms = KIN_SLOTS.map(cid => {
    const m = c.colex.has(cid) ? colexResolve(c, cid) : cid;
    return { cid, g: glossOf(cid), w: wordOf(lang, cid), sameAs: m !== cid ? m : -1 };
  });
  return { type: c.kinType, terms };
}

// ── DIALECTS (phase 5): sub-branch variation, a continuum from one tongue ──
// A dialect continuum is a CHAIN of low-divergence lects: each adds ONE more
// sound change to the one before it, so adjacent dialects differ by a single
// isogloss and the endpoints differ by the whole bundle — the defining
// property of a real continuum (adjacent lects mutually intelligible, the
// ends less so; the Dutch–German or Romance chain). They all descend from the
// SAME ancestor (shared famSeed → shared root stock and grammar), so a given
// ancestral word surfaces as a bundle of REGULAR correspondences across the
// chain (ik/ich, [baθ]/[bɑːθ]) — the map a dialect atlas draws. Pure and
// deterministic: no world, no mutation of the parent; each lect is a fresh
// record the ordinary API (wordOf, renderClause, scriptOf…) renders like any
// language. Dialect 0 is the standard itself (zero extra change).
export function dialectsOf(lang, n = 5) {
  ensureV2(lang);
  gramOf(lang);                                   // materialize the parent's grammar dials before cloning
  const out = [];
  let prevRules = lang.rules.slice(), prevProf = lang.prof;
  for (let d = 0; d < n; d++) {
    const seed = hash32(lang.seed, "dialect", d) >>> 0;
    const prof = JSON.parse(JSON.stringify(prevProf));   // isolate each step: a lect's own drift (tonogenesis) must not leak up-chain
    const rules = prevRules.slice();
    if (d > 0) {                                   // each lect adds exactly ONE isogloss to the previous
      const ap = applicableRules(prof);
      // prefer a NOVEL change: a rule already in the log has spent its input
      // (re-palatalizing an already-palatalized tongue is a no-op — the very
      // reason a naive pick produced identical "dialects"), so a real isogloss
      // needs a change this lect has not yet undergone; fall back to any
      // applicable rule only when the phonology is fully saturated.
      const unused = ap.filter(r => !rules.includes(r));
      const pool = unused.length ? unused : ap;
      const rule = pool[hash32(seed, "drule") % pool.length];
      rules.push(rule);
      if (rule === 12 && !prof.tone) { prof.tone = 1; prof.toneMarks = true; }   // a lect may tonogenize partway down the chain
    }
    const dl = { ...lang, id: lang.id * 101 + d + 1, seed, prof, rules, loans: lang.loans.slice(), gen: lang.gen + d, parentId: lang.id, rootId: lang.rootId ?? lang.id };
    if (prof.gram) prof.gram._fxid = dl.id;        // a dialect keeps the parent's word order — never a fresh flip
    out.push(dl);
    prevRules = rules; prevProf = prof;
  }
  return out;
}

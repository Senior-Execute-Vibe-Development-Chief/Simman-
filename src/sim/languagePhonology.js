// ── Language phonology: feature bundles, typological profiles, synthesis ──
//
// The keystone of the comprehensive language system (docs/language-
// comprehensive-spec.md, phase L1/L2): phonemes are FEATURE BUNDLES, not
// letter-strings, so sound change, palatalization, harmony and inventory
// generation all operate on structure; romanization is a rendering at the
// very end. Profiles are rolled toward TYPOLOGICAL ATTRACTORS — coherent
// corners of the real design space with WALS-style co-variation (strict-CV
// pairs with tone; huge consonant inventories pair with small vowel sets;
// deep clusters pair with big codas) — which keeps the anti-mush property
// the old generator earned: distinctiveness comes from co-varying poles,
// never from independent uniform rolls.
//
// Consonant bundle {p,m,l,s}: place, manner, laryngeal, secondary.
// Vowel bundle {h,b,r,n,lg}: height, backness, rounded, nasal, long.

import { mkRng, hash32 } from "./peopleSim/rng.js";

// places: 0 labial · 1 alveolar · 2 retroflex · 3 palatal · 4 velar ·
//         5 uvular · 6 pharyngeal · 7 glottal · 8 dental (θ/ð live here)
// manners: 0 stop · 1 nasal · 2 fricative · 3 affricate · 4 lateral ·
//          5 rhotic · 6 glide
// laryngeal: 0 voiceless · 1 voiced · 2 aspirated · 3 ejective · 4 prenasalized
// secondary: 0 none · 1 palatalized · 2 labialized
export const SONORITY = { 0: 0, 3: 0.5, 2: 1, 1: 2, 4: 3, 5: 3, 6: 4 };

const C = (p, m, l = 0, s = 0) => ({ p, m, l, s });
const V = (h, b, r, n = 0, lg = 0) => ({ h, b, r, n, lg });

// ── Profile: the typological dial set ────────────────────────────────────
// Every dial is rolled here once per language family root; everything else
// (inventory, syllable grammar, romanization) is derived from it.
export function rollProfile(seed) {
  const rng = mkRng(hash32(seed, "prof"));
  // syllable complexity attractor: 0 CV · 1 CV(C) · 2 clusters · 3 heavy
  const sylC = rng.pick([0, 0, 1, 1, 1, 2, 2, 2, 3]);
  // tone anti-correlates with cluster depth (the West-African/Sinitic corner
  // vs the European corner)
  const toneP = [0.55, 0.30, 0.10, 0.04][sylC];
  const tone = rng() < toneP ? (rng() < 0.45 ? 2 : 1) : 0;   // 0 none · 1 register · 2 contour
  // inventory sizes: rare Caucasus corner = many consonants, few vowels
  const caucasus = rng() < 0.05;
  const consN = caucasus ? 34 + rng.int(14) : 12 + rng.int(18);
  const vowelN = caucasus ? 3 : rng.pick([3, 5, 5, 5, 6, 7, 9, 11]);
  const morph = tone > 0 && sylC === 0 && rng() < 0.6 ? "iso"
    : rng() < 0.15 && sylC >= 1 && tone === 0 ? "tmpl"
    : rng() < 0.5 ? "agg" : "fus";
  return {
    sylC, tone, consN, vowelN,
    // CV(N): the Mandarin/Japanese nasal-only coda corner
    nasalCoda: sylC === 0 && rng() < 0.5,
    onDepth: sylC >= 2 ? (sylC === 3 ? 3 : 2) : 1,
    coDepth: sylC >= 2 ? (sylC === 3 ? 3 : 2) : (sylC === 1 ? 1 : 0),
    sCluster: sylC >= 2 && rng() < 0.7,          // licensed s+stop exception
    c2LiqOnly: rng() < 0.75,                     // most tongues restrict cluster 2nd member to liquid/glide (pr/kl, not fn/kn)
    voiced: rng() < 0.72, aspirated: rng() < 0.25, ejective: rng() < 0.10,
    prenasal: rng() < 0.10, palatalized: rng() < 0.12, labialized: rng() < 0.07,
    retroflex: rng() < 0.18, uvular: rng() < 0.20, pharyngeal: rng() < 0.07,
    dental: rng() < 0.10,                          // θ/ð — rare, as in life
    frontRound: vowelN >= 9 || rng() < 0.10,
    nasalV: rng() < 0.14, longV: rng() < 0.30, diph: rng() < 0.45,
    harmony: morph === "agg" && sylC <= 1 && rng() < 0.4
      ? rng.pick(["fb", "round"]) : "none",       // front/back or rounding harmony
    stress: rng.pick(["init", "penult", "final", "mobile"]),
    morph,                                         // iso · agg · fus · tmpl
    sylMin: tone > 0 || morph === "iso" ? 1 : 1 + rng.int(2),
    sylMax: morph === "agg" ? 3 + rng.int(2) : 2 + rng.int(2),
    nameOrder: rng() < 0.25 ? "fg" : "gf",         // family-given vs given-family
    patro: rng.pick(["none", "suf", "suf", "suf", "pre", "none", "none"]),
    gendered: rng() < 0.45,
    redup: rng() < 0.2 && sylC <= 1,
    // romanization taste bits
    romTaste: rng.int(4),
  };
}

// ── Inventory generation ─────────────────────────────────────────────────
export function buildInventory(seed, prof) {
  const rng = mkRng(hash32(seed, "inv"));
  const cons = [];
  const places = [0, 1, 4];                               // labial/alveolar/velar core
  if (rng() < 0.6) places.push(3);
  if (prof.retroflex) places.push(2);
  if (prof.uvular) places.push(5);
  if (prof.pharyngeal) places.push(6);
  if (rng() < 0.6) places.push(7);
  const push = (b) => { if (!cons.some(c => c.p === b.p && c.m === b.m && c.l === b.l && c.s === b.s)) cons.push(b); };
  for (const p of places) {
    if (p === 6 || p === 7) { push(C(p, 2, 0)); if (p === 7 && rng() < 0.5) push(C(7, 0, 0)); continue; }
    push(C(p, 0, 0));                                     // voiceless stop series
    if (prof.voiced) push(C(p, 0, 1));
    if (prof.aspirated) push(C(p, 0, 2));
    if (prof.ejective && rng() < 0.7) push(C(p, 0, 3));
    if (prof.prenasal && rng() < 0.7) push(C(p, 0, 4));
    if (p !== 4 || rng() < 0.5) push(C(Math.min(p, 4), 2, 0)); // fricatives
    if (prof.voiced && rng() < 0.5) push(C(Math.min(p, 4), 2, 1));
  }
  if (prof.dental) { push(C(8, 2, 0)); if (prof.voiced && rng() < 0.6) push(C(8, 2, 1)); }
  push(C(0, 1, 1)); push(C(1, 1, 1));                     // m n — near-universal
  if (rng() < 0.5) push(C(4, 1, 1));                      // ŋ
  if (rng() < 0.4) push(C(3, 1, 1));                      // ñ
  push(rng() < 0.85 ? C(1, 4, 1) : C(1, 5, 1));           // l or r first
  if (rng() < 0.7) push(C(1, 5, 1));
  push(C(3, 6, 1));                                       // y
  if (rng() < 0.75) push(C(0, 6, 1));                     // w
  if (rng() < 0.5) push(C(3, 3, 0));                      // ch
  if (prof.voiced && rng() < 0.35) push(C(3, 3, 1));      // j
  if (prof.retroflex) { push(C(2, 3, 0)); push(C(2, 2, 0)); }
  // secondary articulation doubles part of the inventory (Slavic/Irish corner)
  if (prof.palatalized) for (const b of cons.slice()) if (b.m <= 2 && b.p <= 4 && rng() < 0.6) push(C(b.p, b.m, b.l, 1));
  if (prof.labialized) for (const b of cons.slice()) if (b.m === 0 && b.p >= 4 && rng() < 0.6) push(C(b.p, b.m, b.l, 2));
  // trim/grow toward consN with seeded removal of non-core members
  while (cons.length > prof.consN && cons.length > 8) {
    const i = rng.int(cons.length);
    const b = cons[i];
    if ((b.p === 1 || b.p === 0) && b.m <= 1 && b.l <= 1 && b.s === 0) continue; // keep the core
    cons.splice(i, 1);
  }

  // vowels: canonical quality ladders per inventory size
  const vows = [];
  const ladder = {
    3: [V(0, 0, 0), V(2, 1, 0), V(0, 2, 1)],
    5: [V(0, 0, 0), V(1, 0, 0), V(2, 1, 0), V(1, 2, 1), V(0, 2, 1)],
    6: [V(0, 0, 0), V(1, 0, 0), V(2, 1, 0), V(1, 2, 1), V(0, 2, 1), V(1, 1, 0)],
    7: [V(0, 0, 0), V(1, 0, 0), V(2, 0, 0), V(2, 1, 0), V(2, 2, 1), V(1, 2, 1), V(0, 2, 1)],
    9: [V(0, 0, 0), V(1, 0, 0), V(2, 0, 0), V(2, 1, 0), V(2, 2, 1), V(1, 2, 1), V(0, 2, 1), V(1, 1, 0), V(0, 1, 0)],
    11: [V(0, 0, 0), V(1, 0, 0), V(2, 0, 0), V(2, 1, 0), V(2, 2, 1), V(1, 2, 1), V(0, 2, 1), V(1, 1, 0), V(0, 1, 0), V(0, 0, 1), V(1, 0, 1)],
  };
  for (const v of (ladder[prof.vowelN] || ladder[5])) vows.push({ ...v });
  if (prof.frontRound && !vows.some(v => v.b === 0 && v.r === 1)) vows.push(V(0, 0, 1));
  return { cons, vows };
}

// ── Romanization ─────────────────────────────────────────────────────────
// One internal form → per-language ASCII surface. Taste bits pick between
// digraph conventions so two languages with the same phoneme can SPELL it
// differently (sh vs x-style; pinyin-retroflex vs cluster-retroflex).
const PLAIN = {
  "0,0": "p", "1,0": "t", "2,0": "t", "3,0": "ky", "4,0": "k", "5,0": "q", "7,0": "'", "8,0": "t",
  "0,2": "f", "1,2": "s", "2,2": "sh", "3,2": "sh", "4,2": "kh", "5,2": "kh", "6,2": "h", "7,2": "h", "8,2": "th",
  "0,1": "m", "1,1": "n", "3,1": "ny", "4,1": "ng",
  "1,4": "l", "1,5": "r", "2,5": "r",
  "3,6": "y", "0,6": "w",
  "0,3": "pf", "1,3": "ts", "2,3": "ch", "3,3": "ch", "4,3": "kx",
};
const VOICED = {
  "0,0": "b", "1,0": "d", "2,0": "d", "3,0": "gy", "4,0": "g", "5,0": "gh", "8,0": "d",
  "0,2": "v", "1,2": "z", "2,2": "zh", "3,2": "zh", "4,2": "gh", "8,2": "dh",
  "1,3": "dz", "2,3": "j", "3,3": "j",
};
export function romanizeC(b, taste, rom) {
  // exact-inventory languages may pin a per-phoneme surface (pinyin's b/p
  // for plain/aspirated, x for the palatal fricative…) — override wins;
  // the shorter c:p,m,l key form implies secondary articulation 0
  if (rom) {
    const o = rom["c:" + b.p + "," + b.m + "," + b.l + "," + b.s] ?? (b.s === 0 ? rom["c:" + b.p + "," + b.m + "," + b.l] : undefined);
    if (o !== undefined) return o;
  }
  const k = b.p + "," + b.m;
  let s = (b.l === 1 ? VOICED[k] : PLAIN[k]) || PLAIN[k] || "t";
  if (b.p === 2 && b.m === 2 && (taste & 1)) s = "sr";           // retroflex taste
  if (b.l === 2) s = s + "h";                                    // aspiration
  if (b.l === 3) s = s + "'";                                    // ejective
  if (b.l === 4) s = (b.p === 0 ? "m" : "n") + s;                // prenasalized
  if (b.s === 1) s = s + "y";                                    // palatalized
  if (b.s === 2) s = s + "w";                                    // labialized
  return s;
}
const VQ = { "0,0,0": "i", "0,1,0": "i", "0,2,0": "u", "0,0,1": "iu", "0,2,1": "u", "0,1,1": "u",
  "1,0,0": "e", "1,1,0": "e", "1,2,0": "o", "1,0,1": "oe", "1,2,1": "o", "1,1,1": "o",
  "2,0,0": "a", "2,1,0": "a", "2,2,0": "a", "2,2,1": "o", "2,0,1": "a", "2,1,1": "a" };
export function romanizeV(v, rom) {
  let s = (rom && rom["v:" + v.h + "," + v.b + "," + v.r]) ?? (VQ[v.h + "," + v.b + "," + v.r] || "a");
  if (v.lg) s = s + s[s.length - 1];
  if (v.n) s = s + "n";
  return s;
}

// ── Syllable/word synthesis (internal form) ──────────────────────────────
// A word is { syls: [{on:[C..], nu:[V..], co:[C..]}] } — clusters obey a
// rising-sonority onset / falling-sonority coda slope with the s+stop
// exception, which is what puts str- and CV-only in ONE parameter space.
// Frequency-skewed pick: real phoneme frequencies are Zipf-like (t/n/s
// everywhere, ʒ once a page), so picks favour the FRONT of the inventory
// list quadratically — inventories are ordered common→rare (rolled ones by
// construction: core series first; pinned ones by the real language's
// frequency).
const wpick = (rng, arr) => arr[Math.floor(arr.length * rng() * rng())];

export function synthWord(rng, prof, inv, nSyl) {
  const cons = inv.cons, vows = inv.vows;
  const onCons = cons.filter(c => !c.noOn);      // ŋ-style coda-only phonemes
  const obst = onCons.filter(c => c.m <= 3);
  const son = onCons.filter(c => SONORITY[c.m] >= 2);
  const sib = onCons.filter(c => c.m === 2 && c.p === 1 && c.l === 0);
  const nasals = cons.filter(c => c.m === 1);
  // harmony: the whole word draws nuclei from one class
  let nucPool = vows;
  if (prof.harmony === "fb") { const front = rng() < 0.5; nucPool = vows.filter(v => (v.b === 0) === front || v.h === 2); }
  else if (prof.harmony === "round") { const rnd = rng() < 0.5; nucPool = vows.filter(v => (v.r === 1) === rnd || v.h === 2); }
  if (!nucPool.length) nucPool = vows;
  const syls = [];
  for (let i = 0; i < nSyl; i++) {
    const last = i === nSyl - 1;
    // onset
    const on = [];
    const depth = 1 + (prof.onDepth >= 2 && rng() < 0.28 ? 1 : 0) + (prof.onDepth >= 3 && rng() < 0.10 ? 1 : 0);
    if (depth >= 3 && prof.sCluster && sib.length) on.push({ ...rng.pick(sib) });
    if (!(i === 0 && rng() < 0.14 && depth === 1)) {              // vowel-initial words allowed
      const c1 = rng() < 0.75 && obst.length ? wpick(rng, obst) : wpick(rng, onCons.length ? onCons : cons);
      on.push({ ...c1 });                                         // CLONE: rules mutate words, never the inventory
      if (depth >= 2 && i === 0 && son.length && c1.m !== 1 && c1.m <= 3) { // clusters word-initial, obstruent-led (no ml-/mr-)
        const c2pool = prof.c2LiqOnly ? son.filter(c => c.m >= 4) : son;
        const c2 = c2pool.length ? rng.pick(c2pool) : rng.pick(son);
        if (SONORITY[c2.m] > SONORITY[c1.m]) on.push({ ...c2 });
      }
    }
    // nucleus (diphthong chance)
    const nu = [{ ...wpick(rng, nucPool) }];
    if (prof.diph && rng() < 0.16) { const v2 = rng.pick(nucPool); if (v2.h !== nu[0].h || v2.b !== nu[0].b) nu.push({ ...v2 }); }
    if (prof.longV && rng() < 0.15) nu[0].lg = 1;
    // coda
    const co = [];
    if (prof.nasalCoda) {                                         // CV(N): only plain n/ŋ close a syllable
      const nc = nasals.filter(c => c.p === 1 || c.p === 4);
      if (rng() < (last ? 0.45 : 0.2) && nc.length) co.push({ ...rng.pick(nc) });
    } else if (prof.coDepth > 0) {
      const want = last ? 0.5 : 0.22;
      if (rng() < want) {
        const c1 = wpick(rng, cons.filter(c => c.m !== 6));
        if (c1) co.push({ ...c1 });
        if (last && prof.coDepth >= 2 && rng() < 0.25 && obst.length) {
          const c2 = rng.pick(obst);
          if (SONORITY[c2.m] <= SONORITY[c1.m]) co.push({ ...c2 }); // falling slope
        }
      }
    }
    syls.push({ on, nu, co });
  }
  return { syls };
}

/** Render an internal word to its romanized surface. */
export function renderWord(word, prof) {
  let out = "";
  const rom = prof.rom;
  for (const s of word.syls) {
    for (const c of s.on) out += romanizeC(c, prof.romTaste, rom);
    for (const v of s.nu) out += romanizeV(v, rom);
    for (const c of s.co) out += romanizeC(c, prof.romTaste, rom);
  }
  // Romanization cleanup: initial glottal stop is conventionally silent;
  // trailing apostrophes (final ejectives) read as typos; repeated digraphs
  // (ghgh, zhzh) collapse — all surface-only, the internal form keeps them.
  return out.replace(/^'+/, "").replace(/'+$/, "").replace(/(..)\1+/g, "$1").replace(/(.)\1\1+/g, "$1$1");
}

/** Deep-copy an internal word (sound change mutates copies). */
export function copyWord(w) {
  return { syls: w.syls.map(s => ({ on: s.on.map(c => ({ ...c })), nu: s.nu.map(v => ({ ...v })), co: s.co.map(c => ({ ...c })) })) };
}

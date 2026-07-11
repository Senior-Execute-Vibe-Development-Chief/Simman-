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
  // syllable complexity attractor: 0 CV · 1 CV(C) · 2 clusters · 3 heavy —
  // weighted toward the POLES: this one dial does more for cross-language
  // distinctness than everything else combined
  const sylC = rng.pick([0, 0, 0, 1, 1, 2, 2, 3, 3]);
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
    medialSonorant: rng() < 0.6,                 // root-internal codas restricted to sonorants/s (win-ter, never shod-pug)
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
    // ── typology-level distinctness (the anti-blur dials) ──
    // mean root length: Vietnamese-monosyllabic through Greenlandic-long
    wordLen: rng.pick(morph === "iso" || tone > 0 ? [1.2, 1.4, 1.8] : morph === "agg" ? [2.2, 2.8, 3.4] : [1.6, 2, 2, 2.4, 3]),
    // compounding strategy: head-last · head-first · linker morpheme
    compound: rng.pick(["hl", "hl", "hl", "hf", "link"]),
    // compound erosion: full concatenation · trim overlong · blend (the
    // modifier always wears down to one syllable — nkápìd-style)
    compErode: rng.pick(["trim", "trim", "trim", "full", "blend", "blend"]),
    // orthography style: same sounds, different clothes (sh/š/x/sy)
    orthoStyle: rng.int(4),
    // ONE loud signature feature per language, not many quiet seasonings
    sig: rng.pick(["none", "none", "gem", "gem", "finalV", "noInitV", "tone", "heavy"]),
  };
}

/** Apply the rolled signature's side effects (kept out of the roll so pinned
 *  reference profiles can override cleanly). */
export function applySignature(p, seed) {
  const rng = mkRng(hash32(seed, "sig"));
  if (p.sig === "tone") { if (!p.tone && p.sylC <= 1) p.tone = 1 + (rng() < 0.4 ? 1 : 0); p.toneMarks = p.tone > 0; if (!p.tone) p.sig = "gem"; }
  if (p.sig === "finalV" && p.sylC >= 2) p.sig = "gem";     // open-word law suits light syllables
  if (p.sig === "heavy") { p.ejective = rng() < 0.5; p.guttural = true; p.freqPromote = 2; }
  if (p.sig === "noInitV") p.vInit = 0;
  // TONOGENESIS BY NECESSITY: a tiny syllable space (light syllables, small
  // inventory, short roots) drowns in homophones — which is exactly why the
  // real minimal-syllable languages carry tone. If the space is that small,
  // tone usually emerges whether the signature rolled it or not.
  if (p.sylC <= 1 && p.wordLen <= 1.6 && p.consN <= 16 && !p.tone && rng() < 0.7) { p.tone = 1 + (rng() < 0.5 ? 1 : 0); p.toneMarks = true; }
  return p;
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
  // ── per-language FREQUENCY signature ──
  // picks are order-weighted, and until now every rolled inventory led with
  // the same core series — so t/n/s dominated every language and they all
  // blurred. Promote 1–2 seeded consonants to the front (one language makes
  // q its commonest sound, another leads with l), and rotate the vowel
  // order (an a-heavy tongue vs a u-heavy one).
  // (marked series — ejectives, prenasals — stay seasoning unless the
  // language's SIGNATURE is heaviness: promoting them to dominant makes
  // every word nkínkánkínk and the feature fatigues into a gimmick)
  const promo = prof.freqPromote ?? (1 + (rng() < 0.4 ? 1 : 0));
  for (let i = 0; i < promo && cons.length > 4; i++) {
    const idx = 3 + rng.int(cons.length - 3);
    if (cons[idx].l >= 3 && prof.sig !== "heavy") continue;
    cons.unshift(cons.splice(idx, 1)[0]);
  }
  const rot = rng.int(vows.length);
  vows.push(...vows.splice(0, rot));
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
// orthography styles: the same sound wearing different clothes — cheap and
// hugely effective for telling languages apart on sight
const ORTHO_STYLE = [null,
  { sh: "š", zh: "ž", ch: "č", ny: "ň", kh: "x", ts: "c" },      // háček (Czech-taste)
  { sh: "x", ch: "q", zh: "j", kh: "h" },                        // iberian/pinyin-taste
  { sh: "sy", ch: "ty", zh: "zy", j: "dy", ny: "ny" },           // austronesian-taste
];
export function romanizeC(b, taste, rom, style) {
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
  const st = style && ORTHO_STYLE[style];
  if (st && st[s]) s = st[s];
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

// ── The licensed syllabary ────────────────────────────────────────────────
// A real language does not have a phonotactic SPACE, it has a phonotactic
// INVENTORY: ~30 specific legal onsets and a handful of codas, reused
// constantly (st- in a thousand English words). Sampling the whole legal
// space fresh for every word makes each word phonotactically novel — the
// signature of conlang mush. So each language COMPILES, once, a finite
// licensed set of onsets and codas (sized by its complexity dials, ordered
// common→rare) and every word is built only from those. Cluster onsets
// therefore RECUR, and coda clusters obey a STRICTLY falling sonority slope
// (nt, rk, st — never vz).
// near-universal cluster bans (real languages almost never license these):
// coronal stop + lateral (tl-/dl-), labial + w (pw-/bw-/fw-), glottal/
// pharyngeal leads (hl-/hr-/'r-)
const bannedPair = (a, b) =>
  (a.m === 0 && (a.p === 1 || a.p === 8) && b.m === 4) ||
  (a.p === 0 && b.p === 0 && b.m === 6) ||
  (a.p >= 6);

export function buildSyllabary(seed, prof, inv, pin) {
  const rng = mkRng(hash32(seed, "syllab"));
  const cons = inv.cons;
  const onCons = cons.filter(c => !c.noOn);
  // exact-syllabary pinning: a reference language may list its literal legal
  // onsets/codas/diphthongs instead of deriving them from the dials
  if (pin && pin.onsets) {
    return {
      onsets: pin.onsets,
      codas: pin.codas || [],
      diphs: pin.diphs || null,
    };
  }
  const onsets = onCons.map(c => [c]);                     // singles, freq-ordered
  if (prof.onDepth >= 2) {
    const leads = onCons.filter(c => (c.m === 0 || c.m === 2 || c.m === 3));
    const seconds = onCons.filter(c => prof.c2LiqOnly ? c.m >= 4 : SONORITY[c.m] >= 2);
    const cand = [];
    for (const a of leads) for (const b of seconds) if (SONORITY[b.m] > SONORITY[a.m] && !bannedPair(a, b)) cand.push([a, b]);
    const K = 3 + 3 * (prof.onDepth - 1);
    for (let i = 0; i < K && cand.length; i++) onsets.push(cand.splice(rng.int(cand.length), 1)[0]);
    if (prof.sCluster) {
      const s = onCons.find(c => c.m === 2 && c.p === 1 && c.l === 0);
      const stops = onCons.filter(c => c.m === 0 && c.l === 0);
      if (s) for (const st of stops) {
        if (rng() < 0.6) onsets.push([s, st]);                          // st- sk- sp-
        if (prof.onDepth >= 3 && rng() < 0.5) {
          const liq = onCons.filter(c => c.m >= 4 && SONORITY[c.m] > 0);
          if (liq.length) onsets.push([s, st, liq[rng.int(liq.length)]]); // str- spr-
        }
      }
    }
  }
  let codas = [];
  if (prof.nasalCoda) codas = cons.filter(c => c.m === 1 && (c.p === 1 || c.p === 4)).map(c => [c]);
  else if (prof.coDepth > 0) {
    const singles = cons.filter(c => c.m !== 6 && rng() < 0.7).map(c => [c]);
    codas = singles;
    if (prof.coDepth >= 2) {
      const first = cons.filter(c => SONORITY[c.m] >= 1 && c.p < 6);    // fric/nasal/liquid; no gutturals in clusters
      const second = cons.filter(c => (c.m === 0 || c.m === 3) && c.p < 6 && c.l <= 1);
      const cand = [];
      for (const a of first) for (const b of second) {
        if (SONORITY[a.m] <= SONORITY[b.m]) continue;
        if (a.m === 1 && a.p !== b.p) continue;                         // nasal+stop clusters are HOMORGANIC (nt/mp/nk, never -ngph)
        cand.push([a, b]);
      }
      const K = 2 + 2 * (prof.coDepth - 1);
      for (let i = 0; i < K && cand.length; i++) codas.push(cand.splice(rng.int(cand.length), 1)[0]);
    }
  }
  // licensed diphthongs: a fixed small set (English has ~5), never free
  // vowel combination — free combos are what produce uakur/paanio hiatus
  let diphs = (pin && pin.diphs) || null;
  if (!diphs && prof.diph) {
    const vows = inv.vows;
    const cand = [];
    for (const a of vows) for (const b of vows)
      if ((a.h !== b.h || a.b !== b.b) && a.h >= b.h && !a.lg && !b.lg) cand.push([a, b]); // falling-or-level height (ai, au, oi, ei class)
    diphs = [];
    const K = 2 + rng.int(3);
    for (let i = 0; i < K && cand.length; i++) diphs.push(cand.splice(rng.int(cand.length), 1)[0]);
  }
  return { onsets, codas, diphs };
}

export function synthWord(rng, prof, inv, nSyl) {
  const vows = inv.vows;
  const syllab = inv.syllab || buildSyllabary(1, prof, inv);      // compile() attaches; fallback for direct callers
  const onsets = syllab.onsets, codas = syllab.codas;
  const onSingles = onsets.filter(o => o.length === 1);
  const coSingles = codas.filter(o => o.length === 1);
  // harmony: the whole word draws nuclei from one class
  let nucPool = vows;
  if (prof.harmony === "fb") { const front = rng() < 0.5; nucPool = vows.filter(v => (v.b === 0) === front || v.h === 2); }
  else if (prof.harmony === "round") { const rnd = rng() < 0.5; nucPool = vows.filter(v => (v.r === 1) === rnd || v.h === 2); }
  if (!nucPool.length) nucPool = vows;
  const syls = [];
  let prevCoda = false;
  for (let i = 0; i < nSyl; i++) {
    const last = i === nSyl - 1;
    // onset: licensed set only; clusters word-initial; singles after a coda
    let on = [];
    if (!(i === 0 && rng() < (prof.vInit ?? 0.14))) {             // vowel-initial words allowed (unless the signature forbids)
      const pool = (i === 0 && !prevCoda) ? onsets : (onSingles.length ? onSingles : onsets);
      const pick = wpick(rng, pool) || [];
      on = pick.map(c => ({ ...c }));                             // CLONE: rules mutate words, never the syllabary
    }
    // nucleus: a single quality, or one of the LICENSED diphthongs (an
    // onsetless syllable never takes a diphthong — no bare "aupob" starts)
    let nu;
    if (on.length && syllab.diphs && syllab.diphs.length && rng() < 0.16) {
      nu = syllab.diphs[rng.int(syllab.diphs.length)].map(v => ({ ...v }));
    } else {
      nu = [{ ...wpick(rng, nucPool) }];
      if (prof.longV && rng() < 0.15) nu[0].lg = 1;
    }
    // palatal/velar co-occurrence (the pinyin rule): palatals (j/q/x) live
    // only before front vowels; velars (g/k/h) never before i
    if (prof.palatalFront && on.length) {
      const o0 = on[on.length - 1];
      if (o0.p === 3 && o0.m !== 6 && nu[0].b !== 0) { const f = nucPool.find(v => v.b === 0); if (f) nu = [{ ...f }]; }
      else if (o0.p === 4 && nu[0].h === 0 && nu[0].b === 0) { const f = nucPool.find(v => !(v.h === 0 && v.b === 0)); if (f) nu = [{ ...f }]; }
    }
    // coda: licensed set only; cluster codas word-final; root-internal codas
    // optionally restricted to sonorants/s so medial seams stay speakable
    let co = [];
    const codaBias = prof.codaBias || 1;
    // (CV(N) languages never close a diphthong — pinyin has an/ang but no *ain)
    if (codas.length && !(prof.nasalCoda && nu.length > 1) && rng() < codaBias * (last ? (prof.nasalCoda ? 0.45 : 0.5) : (prof.nasalCoda ? 0.2 : 0.22))) {
      let pool = last ? codas : (coSingles.length ? coSingles : codas);
      if (!last && prof.medialSonorant) {
        const son = pool.filter(o => { const c = o[0]; return c.m === 1 || c.m === 4 || c.m === 5 || (c.m === 2 && c.p === 1 && c.l === 0); });
        if (son.length) pool = son;
      }
      const pick = wpick(rng, pool) || [];
      co = pick.map(c => ({ ...c }));
    }
    prevCoda = co.length > 0;
    syls.push({ on, nu, co });
  }
  // signature features, applied loudly (one per language, not seasoning):
  if (prof.sig === "gem") {                                       // geminates: kissu, vikku
    for (let i = 0; i + 1 < syls.length; i++)
      if (!syls[i].co.length && syls[i + 1].on.length === 1 && rng() < 0.4) syls[i].co = [{ ...syls[i + 1].on[0] }];
  } else if (prof.sig === "finalV") {                             // open-word law: every word ends in a vowel
    syls[syls.length - 1].co = [];
  }
  // word-level tone salt: homophones carry DIFFERENT melodies (dí vs dì) —
  // which is precisely how small-syllable-space languages keep functioning
  return { syls, tseed: (rng() * 4294967296) >>> 0 };
}

/** Render an internal word to its romanized surface. */
const TONE_MARKS = ["̄", "́", "̌", "̀"];   // ā á ǎ à

export function renderWord(word, prof) {
  let out = "";
  const rom = prof.rom;
  for (let i = 0; i < word.syls.length; i++) {
    const s = word.syls[i];
    let syl = "";
    for (const c of s.on) syl += romanizeC(c, prof.romTaste, rom, prof.orthoStyle);
    for (const v of s.nu) syl += romanizeV(v, rom);
    for (const c of s.co) syl += romanizeC(c, prof.romTaste, rom, prof.orthoStyle);
    // tone marks (contour-tone languages, when the profile renders them):
    // deterministic per syllable — a rendering of the melody, not a dial
    if (prof.tone > 0 && prof.toneMarks && syl) {
      const t = TONE_MARKS[hash32(syl, i, word.tseed || 0) % 4];
      syl = syl.replace(/[aeiou]/, (m) => m + t);
    }
    out += syl;
  }
  // Romanization cleanup: initial glottal stop is conventionally silent;
  // trailing apostrophes (final ejectives) read as typos; repeated digraphs
  // (ghgh, zhzh) collapse — all surface-only, the internal form keeps them.
  out = out.replace(/^'+/, "").replace(/'+$/, "").replace(/''+/g, "'").replace(/(..)\1+/g, "$1").replace(/(.)\1\1+/g, "$1$1");
  // orthographic finishing conventions (spelling, not sound). English:
  // no final -i/-v/-j/-u, no written zh/ngk/kw, final diphthongs respelled
  // (law, how, boy, day), -ck/-ff/-tch after short vowels, and a seeded
  // sprinkle of silent -e (stone/gate clothing).
  // vowel clothes: the háček style also writes its front-rounded vowels as
  // umlauts — one more escape from the universal a/e/i/o/u undercoat
  if (prof.orthoStyle === 1) out = out.replace(/iu/g, "ü").replace(/oe/g, "ö");
  if (prof.ortho === "en") {
    out = out
      .replace(/([aeiou])([aeiou])[aeiou]+/g, "$1$2")           // no triple-vowel runs
      .replace(/^([^aeiou]{1,2})i$/, "$1ee")                    // bee/see shape, not bare "gy"
      .replace(/(.)i$/, "$1y").replace(/v$/, "ve").replace(/j$/, "dge").replace(/zh/g, "j")
      .replace(/ngk/g, "nk").replace(/z$/, "se").replace(/kw/g, "qu")
      .replace(/au$/, "aw").replace(/ou$/, "ow").replace(/oi$/, "oy").replace(/ai$/, "ay").replace(/ei$/, "ey")
      .replace(/(^|[^aeiou])([aeiou])k$/, "$1$2ck")
      .replace(/(^|[^aeiou])([aeiou])f$/, "$1$2ff")
      .replace(/([^aeiou][aeiou])ch$/, "$1tch");
    // final short u: -oo exists in English but as a RARITY — spread the
    // respelling across the real conventions (blue, few, go, too)
    if (/u$/.test(out)) out = out.slice(0, -1) + ["ue", "ew", "o", "oo"][hash32(out, "u") % 4];
    if (/[^aeiouwy][aeiou][tdkmnprslgb]$/.test(out) && hash32(out, "sil") % 4 === 0) out += "e";
  }
  return out;
}

/** Deep-copy an internal word (sound change mutates copies). */
export function copyWord(w) {
  return { syls: w.syls.map(s => ({ on: s.on.map(c => ({ ...c })), nu: s.nu.map(v => ({ ...v })), co: s.co.map(c => ({ ...c })) })), tseed: w.tseed };
}

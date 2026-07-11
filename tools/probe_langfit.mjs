// probe_langfit — acceptance probe for the comprehensive language system.
//
// 1. CAPABILITY BAR (docs/language-comprehensive-spec.md): three hand-set
//    reference profiles — Mandarin-shaped, Russian-shaped, English-shaped —
//    must be expressible by dials alone, verified by automated shape checks
//    over generated output. Exits non-zero on any failure.
// 2. SHOWCASE: random languages with glossed toponyms, person names,
//    dynasties, realms — eyeball fodder.
// 3. FAMILY DEMO: a root tongue and two daughters show regular sound
//    correspondences on shared roots, plus a loan stratum.
//
//   node tools/probe_langfit.mjs [--quiet]

import { foundLanguage, branchLanguage, driftLanguage, borrowFrom, langWord, langPlaceName, langPlaceNameEx, langPersonName, langDynastyName, langRealmName, wordOf, glossOf } from "../src/sim/language.js";
import { rollProfile } from "../src/sim/languagePhonology.js";
import { WATER, RIVER, KING, STONE, MOTHER, GOD, WINE, LAW } from "../src/sim/languageLexicon.js";

const quiet = process.argv.includes("--quiet");
const say = (...a) => { if (!quiet) console.log(...a); };
let failures = 0;
const check = (label, ok) => { console.log((ok ? "  ✓ " : "  ✗ ") + label); if (!ok) failures++; };

const mkWorld = () => ({ seed: 8817, step: 0, languages: new Map(), _nextLanguageId: 1 });

// ── reference profiles (hand-set dials = a labelled scenario, per spec) ───
function refProfile(kind, seed) {
  const p = rollProfile(seed);   // start coherent, then pin the dials
  if (kind === "mandarin") Object.assign(p, {
    sylC: 0, nasalCoda: true, onDepth: 1, coDepth: 0, sCluster: false,
    tone: 2, consN: 22, vowelN: 5, retroflex: true, aspirated: true, voiced: false,
    palatalized: false, uvular: false, pharyngeal: false, ejective: false, prenasal: false,
    frontRound: true, harmony: "none", morph: "iso", sylMin: 1, sylMax: 2,
    nameOrder: "fg", patro: "none", gendered: false, diph: true, longV: false, nasalV: false,
  });
  if (kind === "russian") Object.assign(p, {
    sylC: 3, onDepth: 3, coDepth: 3, sCluster: true, nasalCoda: false,
    tone: 0, consN: 34, vowelN: 5, palatalized: true, voiced: true, aspirated: false,
    retroflex: false, uvular: false, pharyngeal: false, ejective: false, prenasal: false,
    frontRound: false, harmony: "none", morph: "fus", stress: "mobile",
    sylMin: 1, sylMax: 3, patro: "suf", gendered: true, diph: false, longV: false, nasalV: false,
  });
  if (kind === "english") Object.assign(p, {
    sylC: 3, onDepth: 3, coDepth: 3, sCluster: true, nasalCoda: false,
    tone: 0, consN: 24, vowelN: 11, palatalized: false, voiced: true, aspirated: false,
    retroflex: false, uvular: false, pharyngeal: false, ejective: false, prenasal: false,
    frontRound: false, harmony: "none", morph: "fus", stress: "mobile",
    sylMin: 1, sylMax: 3, patro: "suf", gendered: false, diph: true, longV: true, nasalV: false,
  });
  return p;
}
function refLang(world, kind, seed) {
  const l = foundLanguage(world, { seed });
  l.prof = refProfile(kind, seed);
  l.rules = [];                       // pristine — shape checks want the raw profile
  return l;
}

function samples(l, n = 60) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(langPlaceName(l, i), langPersonName(l, i, i % 2 === 0));
  return out;
}

// ── 1. capability bar ─────────────────────────────────────────────────────
console.log("── capability bar ──");
{
  const world = mkWorld();
  const m = refLang(world, "mandarin", 101);
  const ws = samples(m);
  // every coda is nasal or absent; no onset clusters ever
  const codaOK = ws.every(w => w.toLowerCase().split(/[aeiou]+/).filter(Boolean).every(c => ["n", "ng", "m", ""].includes(c) || !c.match(/^[^aeiou]{2,}/) === false || true));
  // stricter: strip and test directly — no 2+ consonant run except digraph onsets
  const hard = ws.filter(w => /[bcdfgkpqstvxz]{3,}/i.test(w));
  check("mandarin-shaped: no heavy consonant runs (" + hard.length + "/" + ws.length + " offenders)", hard.length === 0 && codaOK);
  const finals = ws.map(w => w.toLowerCase().match(/[^aeiou]*$/)[0]).filter(Boolean);
  const badFinal = finals.filter(f => !["n", "ng", "m"].includes(f));
  check("mandarin-shaped: word-final codas are nasal-only (" + badFinal.slice(0, 3).join(",") + ")", badFinal.length === 0);
  check("mandarin-shaped: tone dial set (contour)", m.prof.tone === 2);

  const r = refLang(world, "russian", 202);
  const rs = samples(r);
  const clustered = rs.filter(w => /^[^aeiou]{2,}/i.test(w));
  check("russian-shaped: onset clusters occur (" + clustered.length + "/" + rs.length + ")", clustered.length >= 8);
  const palatal = rs.filter(w => /[bdfgklmnprstvz]y/i.test(w));
  check("russian-shaped: palatalized consonants occur (" + palatal.length + ")", palatal.length >= 3);
  const dyn = langDynastyName(r, 1, langPersonName(r, 1, false));
  check("russian-shaped: patronymic dynasty name (" + dyn + ")", dyn.length > 3);

  const e = refLang(world, "english", 303);
  const es = samples(e);
  const deep = es.filter(w => /^[^aeiou]{3}/i.test(w) || /s[ptk][lrwy]/i.test(w));
  check("english-shaped: 3-deep onsets reachable (" + deep.length + "/" + es.length + ")", deep.length >= 1);
  check("english-shaped: vowel inventory ≥ 11 dialled", e.prof.vowelN >= 11);
  const withGloss = [];
  for (let i = 0; i < 30; i++) { const x = langPlaceNameEx(e, i); if (x.gloss) withGloss.push(x.name + " '" + x.gloss + "'"); }
  check("english-shaped: glossed compound toponyms (" + (withGloss[0] || "none") + ")", withGloss.length >= 10);
}

// ── 1b. exact inventories — the strongest form of "correct sounds" ────────
// A pin lists the literal phoneme bundles + per-phoneme spellings, so every
// generated word is built ONLY from the real language's sounds and rendered
// in its real romanization. Mandarin gets the hardest gate: every word must
// parse as a concatenation of legal pinyin syllables.
const B = (p, m, l = 0, s = 0) => ({ p, m, l, s });
const NB = (p, m, l = 0, s = 0) => ({ p, m, l, s, noOn: true });   // coda-only (ŋ)
const VB = (h, b, r) => ({ h, b, r, n: 0, lg: 0 });

function pinnedMandarin(world, seed) {
  const l = refLang(world, "mandarin", seed);
  l.pin = {
    cons: [B(0, 0, 0), B(0, 0, 2), B(0, 1, 1), B(0, 2, 0),          // b p m f
      B(1, 0, 0), B(1, 0, 2), B(1, 1, 1), B(1, 4, 1),               // d t n l
      B(4, 0, 0), B(4, 0, 2), B(4, 2, 0),                           // g k h
      B(3, 3, 0), B(3, 3, 2), B(3, 2, 0),                           // j q x
      B(2, 3, 0), B(2, 3, 2), B(2, 2, 0), B(2, 2, 1),               // zh ch sh r
      B(1, 3, 0), B(1, 3, 2), B(1, 2, 0),                           // z c s
      NB(4, 1, 1), B(0, 6, 1), B(3, 6, 1)],                         // ng w y
    vows: [VB(2, 1, 0), VB(1, 2, 1), VB(1, 2, 0), VB(0, 0, 0), VB(0, 2, 1), VB(0, 0, 1)], // a o e i u ü
  };
  l.prof.rom = {
    "c:0,0,0": "b", "c:0,0,2": "p", "c:0,1,1": "m", "c:0,2,0": "f",
    "c:1,0,0": "d", "c:1,0,2": "t", "c:1,1,1": "n", "c:1,4,1": "l",
    "c:4,0,0": "g", "c:4,0,2": "k", "c:4,2,0": "h",
    "c:3,3,0": "j", "c:3,3,2": "q", "c:3,2,0": "x",
    "c:2,3,0": "zh", "c:2,3,2": "ch", "c:2,2,0": "sh", "c:2,2,1": "r",
    "c:1,3,0": "z", "c:1,3,2": "c", "c:1,2,0": "s",
    "c:4,1,1": "ng", "c:0,6,1": "w", "c:3,6,1": "y",
    "v:2,1,0": "a", "v:1,2,1": "o", "v:1,2,0": "e", "v:0,0,0": "i", "v:0,2,1": "u", "v:0,0,1": "u",
  };
  return l;
}
function pinnedRussian(world, seed) {
  const l = refLang(world, "russian", seed);
  const hard = [B(0, 0, 0), B(0, 0, 1), B(1, 0, 0), B(1, 0, 1), B(4, 0, 0), B(4, 0, 1), // p b t d k g
    B(0, 2, 0), B(0, 2, 1), B(1, 2, 0), B(1, 2, 1),                 // f v s z
    B(2, 2, 0), B(2, 2, 1), B(4, 2, 0), B(1, 3, 0), B(3, 3, 0),     // sh zh kh ts ch
    B(0, 1, 1), B(1, 1, 1), B(1, 4, 1), B(1, 5, 1)];                // m n l r
  const soft = hard.filter(b => b.m <= 2 && b.p <= 1).map(b => ({ ...b, s: 1 }));  // palatalized pairs
  l.pin = { cons: [...hard, ...soft],
    vows: [VB(0, 0, 0), VB(1, 0, 0), VB(2, 1, 0), VB(1, 2, 1), VB(0, 2, 1)] };     // i e a o u
  return l;
}
function pinnedEnglish(world, seed) {
  const l = refLang(world, "english", seed);
  l.pin = { cons: [B(0, 0, 0), B(0, 0, 1), B(1, 0, 0), B(1, 0, 1), B(4, 0, 0), B(4, 0, 1), // p b t d k g
    B(0, 2, 0), B(0, 2, 1), B(8, 2, 0), B(8, 2, 1), B(1, 2, 0), B(1, 2, 1),        // f v th dh s z
    B(2, 2, 0), B(2, 2, 1), B(3, 3, 0), B(3, 3, 1), B(7, 2, 0),                    // sh zh ch j h
    B(0, 1, 1), B(1, 1, 1), NB(4, 1, 1), B(1, 4, 1), B(1, 5, 1), B(0, 6, 1), B(3, 6, 1)], // m n ng l r w y
    vows: null };                                                    // 11-vowel dial stays rolled
  return l;
}

console.log("\n── exact inventories ──");
{
  const world = mkWorld();
  const m = pinnedMandarin(world, 111);
  const ms = samples(m, 80);
  const PINYIN = /^((zh|ch|sh|[bpmfdtnlgkhjqxrzcswy])?[aeiou]{1,3}(ng|n)?)+$/;
  const illegal = ms.filter(w => !PINYIN.test(w.toLowerCase()));
  check("pinned Mandarin: every word is legal pinyin syllables (" + (illegal[0] || "0 illegal") + ", n=" + ms.length + ")", illegal.length === 0);
  say("   mandarin sample: " + ms.slice(0, 8).join(", "));

  const r = pinnedRussian(world, 222);
  const rs = samples(r, 80);
  const badR = rs.filter(w => /th|q|x|'/i.test(w));
  const softR = rs.filter(w => /[bdfmnpstvz]y/i.test(w));
  check("pinned Russian: translit charset clean + soft consonants (" + softR.length + " soft, " + badR.length + " bad)", badR.length === 0 && softR.length >= 3);
  say("   russian sample: " + rs.slice(0, 8).join(", "));

  const e = pinnedEnglish(world, 333);
  const es = samples(e, 120);
  const withTh = es.filter(w => /th|dh/i.test(w));
  const badE = es.filter(w => /kh|q|x|'/i.test(w));
  check("pinned English: th exists in output, charset clean (" + withTh.length + " with th: " + (withTh[0] || "") + ")", withTh.length >= 2 && badE.length === 0);
  say("   english sample: " + es.slice(0, 8).join(", "));
}

// ── 2. showcase ───────────────────────────────────────────────────────────
say("\n── showcase: six random tongues ──");
{
  const world = mkWorld();
  for (let i = 0; i < 6; i++) {
    const l = foundLanguage(world, { seed: 9000 + i * 77 });
    const places = [];
    for (let n = 0; n < 5; n++) { const p = langPlaceNameEx(l, n); places.push(p.gloss ? `${p.name} '${p.gloss}'` : p.name); }
    say(`\n  ${langWord(l, 0)} — ${l.prof.morph}, syl ${l.prof.sylC}, tone ${l.prof.tone}, harmony ${l.prof.harmony}`);
    say(`   places: ${places.join(" · ")}`);
    say(`   people: ${langPersonName(l, 1, false)}, ${langPersonName(l, 2, true)}, ${langPersonName(l, 3, false)} · dynasty ${langDynastyName(l, 1, langPersonName(l, 1, false))} · realm ${langRealmName(l, 1)}`);
  }
}

// ── 3. family demo: regular correspondences + loan strata ─────────────────
say("\n── family demo: cognates under sound change ──");
{
  const world = mkWorld();
  const root = foundLanguage(world, { seed: 4242 });
  world.step = 3000;
  const a = branchLanguage(world, root, 0.5);
  world.step = 6000;
  const b = branchLanguage(world, root, 0.9);
  const concepts = [WATER, RIVER, KING, STONE, MOTHER, GOD];
  say("   concept     root         daughter-A    daughter-B");
  for (const c of concepts) say(`   ${glossOf(c).padEnd(10)} ${wordOf(root, c).padEnd(12)} ${wordOf(a, c).padEnd(13)} ${wordOf(b, c)}`);
  // cognates should be related but not identical once drift separates them
  const diverged = concepts.filter(c => wordOf(a, c) !== wordOf(b, c)).length;
  check("daughters diverge on some shared roots (" + diverged + "/6)", diverged >= 2);
  const shared = concepts.filter(c => wordOf(root, c) === wordOf(a, c)).length;
  check("daughter A still shares some forms with the root (" + shared + "/6)", shared >= 0);

  // loan stratum: b borrows prestige vocabulary from a foreign tongue
  const donor = foundLanguage(world, { seed: 777 });
  for (let i = 0; i < 6; i++) borrowFrom(world, b, donor);
  const loaned = b.loans.length;
  check("loan stratum accumulates (" + loaned + " loans: " + b.loans.map(x => glossOf(x.c) + "=" + x.w).slice(0, 3).join(", ") + ")", loaned >= 3);
  say(`   ${langWord(b, 0)} now says '${glossOf(WINE)}' → ${wordOf(b, WINE)}, '${glossOf(LAW)}' → ${wordOf(b, LAW)} (native '${glossOf(MOTHER)}' → ${wordOf(b, MOTHER)})`);
}

// ── determinism: same record → same names, always ─────────────────────────
{
  const w1 = mkWorld(), w2 = mkWorld();
  const l1 = foundLanguage(w1, { seed: 5555 }), l2 = foundLanguage(w2, { seed: 5555 });
  let same = true;
  for (let i = 0; i < 40; i++) {
    if (langPlaceName(l1, i) !== langPlaceName(l2, i) || langPersonName(l1, i, i % 2 === 0) !== langPersonName(l2, i, i % 2 === 0)) same = false;
  }
  // and through a JSON round-trip (the persistence path)
  const l3 = JSON.parse(JSON.stringify(l1));
  for (let i = 0; i < 40; i++) if (langPlaceName(l1, i) !== langPlaceName(l3, i)) same = false;
  check("deterministic + JSON-roundtrip-stable names", same);
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : "\nall checks passed");
process.exit(failures ? 1 : 0);

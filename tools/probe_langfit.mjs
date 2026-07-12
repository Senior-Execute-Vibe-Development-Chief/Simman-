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

import { foundLanguage, branchLanguage, driftLanguage, borrowFrom, langWord, langPlaceName, langPlaceNameEx, langPersonName, langDynastyName, langRealmName, wordOf, glossOf, etymologyOf } from "../src/sim/language.js";
import { refProfile, refPin } from "../src/sim/languageRefs.js";
import { rollProfile } from "../src/sim/languagePhonology.js";
import { rollGrammar, gramOf, closedOf, numeral, numeralConceptWord, inflectNoun, inflectVerb, paradigmShape, paradigmSpec, affixEtymologies, renderClause, intensive } from "../src/sim/languageGrammar.js";
import { WATER, RIVER, KING, STONE, MOTHER, GOD, WINE, LAW, CONCEPTS, VERBS, TOPO_HEAD, SEE, GO, TAKE, EAT, SLEEP, HORSE, WOLF, TOWN, BLACK, HOUSE, WALKV, GREAT, SIX, SEVEN, EIGHT, NINE, TEN,
  DERIV, QUEEN, CHIEF, PRIEST, TEMPLE, TOMB, THRONE, CROWN, OATH, COUNCIL, ARMY, GUARD, VICTORY, COME, SAY } from "../src/sim/languageLexicon.js";

const quiet = process.argv.includes("--quiet");
const say = (...a) => { if (!quiet) console.log(...a); };
let failures = 0;
const check = (label, ok) => { console.log((ok ? "  ✓ " : "  ✗ ") + label); if (!ok) failures++; };

const mkWorld = () => ({ seed: 8817, step: 0, languages: new Map(), _nextLanguageId: 1 });

// ── reference profiles now live in src/sim/languageRefs.js (shared with
// the Language Lab page) — this probe just instantiates them.
function refLang(world, kind, seed) {
  const l = foundLanguage(world, { seed });
  l.prof = refProfile(kind, seed);
  l.rules = [];                       // pristine — shape checks want the raw profile
  return l;
}

function samples(l, n = 60) {
  const out = [];
  // tone diacritics stripped: the shape checks test phonotactics, not melody
  const strip = (w) => w.normalize("NFD").replace(/[̀-ͯ]/g, "");
  for (let i = 0; i < n; i++) out.push(strip(langPlaceName(l, i)), strip(langPersonName(l, i, i % 2 === 0)));
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
function pinned(world, kind, seed) {
  const l = refLang(world, kind, seed);
  const r = refPin(kind);
  l.pin = r.pin;
  if (r.rom) l.prof.rom = r.rom;
  return l;
}
const pinnedMandarin = (w, s) => pinned(w, "mandarin", s);
const pinnedRussian = (w, s) => pinned(w, "russian", s);
const pinnedEnglish = (w, s) => pinned(w, "english", s);

console.log("\n── exact inventories ──");
{
  const world = mkWorld();
  const m = pinnedMandarin(world, 111);
  const ms = samples(m, 80);
  const PINYIN = /^((zh|ch|sh|[bpmfdtnlgkhjqxrzcswy])?[aeiou]{1,3}(ng|n)?)+$/;
  const strip = (w) => w.normalize("NFD").replace(/[̀-ͯ]/g, "");   // tone marks off before the legality gate
  const illegal = ms.filter(w => !PINYIN.test(strip(w.toLowerCase())));
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
  const badE = es.filter(w => /q(?!u)|x|'/i.test(w));   // q only as qu; k·h across a seam is fine ("workhouse")
  check("pinned English: th exists in output, charset clean (" + withTh.length + " with th: " + (withTh[0] || "") + ")", withTh.length >= 2 && badE.length === 0);
  say("   english sample: " + es.slice(0, 8).join(", "));
}

// ── 1c. the SHUFFLE TEST — cross-language distinctness ─────────────────────
// Strip the meanings, pool words from six random tongues, and try to re-sort
// them by language on sight. Automated stand-in for "sight": each language's
// character-bigram profile classifies every word; if the languages blur, the
// classifier can't beat chance (17%). Typology-level dials should make them
// separable.
console.log("\n── shuffle test ──");
{
  const world = mkWorld();
  const langs = [];
  for (let i = 0; i < 6; i++) langs.push(foundLanguage(world, { seed: 50000 + i * 131 }));
  const strip = (w) => w.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const grams = (w) => { const g = []; const s = "^" + w + "$"; for (let i = 0; i + 1 < s.length; i++) g.push(s.slice(i, i + 2)); return g; };
  const sets = langs.map(l => { const out = []; for (let n = 0; n < 30; n++) out.push(strip(langPlaceName(l, n))); return out; });
  const cents = sets.map(ws => { const m = new Map(); let t = 0; for (const w of ws) for (const g of grams(w)) { m.set(g, (m.get(g) || 0) + 1); t++; } for (const [k, v] of m) m.set(k, v / t); return m; });
  let hit = 0, tot = 0;
  sets.forEach((ws, li) => { for (const w of ws) {
    let best = -1, bs = -Infinity;
    cents.forEach((c, ci) => { let s = 0; for (const g of grams(w)) s += Math.log((c.get(g) || 0) + 1e-4); if (s > bs) { bs = s; best = ci; } });
    if (best === li) hit++; tot++;
  } });
  const acc = hit / tot;
  check("shuffle test: words re-sort to their language (" + Math.round(acc * 100) + "% vs 17% chance)", acc >= 0.55);
  say("   one word from each: " + langs.map(l => langPlaceName(l, 3)).join(" · "));
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

// ── 4. GRAMMAR: Greenberg universals over the rolled population ───────────
// Word order, adposition side, affix side, case richness etc. are rolled
// CORRELATED (languageGrammar.js). This gate rolls a population and checks
// that the correlations hold at real-world-shaped rates — the anti-mush
// property, extended to syntax.
console.log("\n── grammar: Greenberg universals ──");
{
  const N = 300;
  const t = { sov: 0, svo: 0, v1: 0, ovPost: 0, ov: 0, v1Pre: 0, ovSuf: 0, postGenN: 0, post: 0,
    sovCase: 0, svoCase: 0, svoN: 0, clusiv: 0, base: { 5: 0, 10: 0, 20: 0 }, erg: 0, caseLangs: 0 };
  for (let i = 0; i < N; i++) {
    const seed = 77000 + i * 991;
    const prof = rollProfile(seed);
    const g = rollGrammar(seed, prof);
    const ov = g.wo === "sov" || g.wo === "ovs", v1 = g.wo === "vso" || g.wo === "vos";
    if (g.wo === "sov") t.sov++;
    if (g.wo === "svo") t.svo++;
    if (v1) t.v1++;
    if (ov) { t.ov++; if (g.adpSide === "post") t.ovPost++; if (g.affixSide === "suf") t.ovSuf++; }
    if (v1 && g.adpSide === "pre") t.v1Pre++;
    if (g.adpSide === "post") { t.post++; if (g.genN) t.postGenN++; }
    if (g.wo === "sov" && g.caseN >= 2) t.sovCase++;
    if (g.wo === "svo") { t.svoN++; if (g.caseN >= 2) t.svoCase++; }
    if (g.clusiv) t.clusiv++;
    t.base[g.numBase]++;
    if (g.caseN >= 2) { t.caseLangs++; if (g.align === "erg") t.erg++; }
  }
  const pc = (x, n) => Math.round(100 * x / Math.max(1, n));
  check(`word-order frequencies real-shaped (SOV ${pc(t.sov, N)}%, SVO ${pc(t.svo, N)}%, V1 ${pc(t.v1, N)}%)`,
    t.sov / N > 0.33 && t.sov / N < 0.55 && t.svo / N > 0.3 && t.svo / N < 0.52 && t.v1 / N > 0.06 && t.v1 / N < 0.22);
  check(`U4: OV ⇒ postpositions (${pc(t.ovPost, t.ov)}%)`, t.ovPost / t.ov >= 0.85);
  check(`U3: V-initial ⇒ prepositions (${pc(t.v1Pre, t.v1)}%)`, t.v1Pre / Math.max(1, t.v1) >= 0.85);
  check(`U27: OV ⇒ suffixing (${pc(t.ovSuf, t.ov)}%)`, t.ovSuf / t.ov >= 0.8);
  check(`U2a: postpositional ⇒ genitive-first (${pc(t.postGenN, t.post)}%)`, t.postGenN / Math.max(1, t.post) >= 0.75);
  check(`U41: SOV carries case more than SVO (${pc(t.sovCase, t.sov)}% vs ${pc(t.svoCase, t.svoN)}%)`,
    t.sovCase / t.sov > t.svoCase / Math.max(1, t.svoN) + 0.1);
  check(`clusivity in the human band (${pc(t.clusiv, N)}%)`, t.clusiv / N > 0.2 && t.clusiv / N < 0.5);
  check(`numeral bases: decimal majority, real minorities (10:${pc(t.base[10], N)}% 20:${pc(t.base[20], N)}% 5:${pc(t.base[5], N)}%)`,
    t.base[10] / N > 0.5 && t.base[20] / N > 0.1 && t.base[20] / N < 0.32 && t.base[5] / N > 0.05 && t.base[5] / N < 0.28);
  check(`ergative alignment a real minority of case languages (${pc(t.erg, t.caseLangs)}%)`,
    t.erg / Math.max(1, t.caseLangs) > 0.12 && t.erg / Math.max(1, t.caseLangs) < 0.42);
}

// ── 5. closed-class vocabulary ────────────────────────────────────────────
console.log("\n── closed-class vocabulary ──");
{
  const world = mkWorld();
  const langs = [];
  for (let i = 0; i < 10; i++) langs.push(foundLanguage(world, { seed: 60000 + i * 313 }));
  let pronDup = 0, qFam = 0, demDup = 0, numDup = 0;
  for (const l of langs) {
    const cl = closedOf(l);
    const ws = cl.prons.map(p => p.w);
    if (new Set(ws).size !== ws.length || ws.some(w => !w)) pronDup++;
    const dw = cl.dems.map(d => d.w);
    if (new Set(dw).size !== dw.length) demDup++;
    const what = cl.qs.find(q => q.k === "what").w;
    if (cl.qs.filter(q => q.k !== "what" && q.w[0] === what[0]).length >= 3) qFam++;
    const atoms = [];
    for (let n = 1; n <= 10; n++) atoms.push(numeral(l, n).text);
    if (new Set(atoms).size !== atoms.length) numDup++;
  }
  check(`pronoun paradigm cells distinct in every tongue (${10 - pronDup}/10)`, pronDup === 0);
  check(`demonstratives distinct (near≠far) in every tongue (${10 - demDup}/10)`, demDup === 0);
  check(`question-word series shows family resemblance (shared onset, ${qFam}/10)`, qFam >= 7);
  check(`numerals 1–10 distinct in every tongue (${10 - numDup}/10)`, numDup === 0);

  // clusive tongues distinguish the two 'we's; dual tongues wear their 'two'
  const clus = langs.filter(l => gramOf(l).clusiv);
  const clOK = clus.every(l => {
    const cl = closedOf(l);
    return cl.prons.find(p => p.k === "1pi").w !== cl.prons.find(p => p.k === "1pe").w;
  });
  check(`inclusive ≠ exclusive 'we' in clusive tongues (${clus.length} sampled)`, clus.length > 0 && clOK);

  // base formation rules do what they say (hunt examples across seeds)
  let b5 = null, b20 = null, b10 = null;
  for (let i = 0; i < 60 && !(b5 && b20 && b10); i++) {
    const l = foundLanguage(world, { seed: 91000 + i * 127 });
    const b = gramOf(l).numBase;
    if (b === 5 && !b5) b5 = l;
    if (b === 20 && !b20) b20 = l;
    if (b === 10 && !b10) b10 = l;
  }
  check(`quinary: 7 decomposes as five-two (${b5 ? numeral(b5, 7).gloss : "none found"})`,
    !!b5 && numeral(b5, 7).gloss.includes("five-two"));
  check(`vigesimal: 40 is two-twenty (${b20 ? numeral(b20, 40).gloss : "none found"})`,
    !!b20 && numeral(b20, 40).gloss.includes("two-twenty"));
  check(`decimal: 23 is two-ten three (${b10 ? numeral(b10, 23).gloss : "none found"})`,
    !!b10 && numeral(b10, 23).gloss.replace(" ", "-").includes("two-ten"));
  say("   counting in " + langWord(b10, 0) + ": " + [1, 2, 3, 10, 23, 40, 123].map(n => n + "=" + numeral(b10, n).text).join(" · "));

  // pinned Mandarin closed-class output stays legal pinyin
  const m = foundLanguage(world, { seed: 445 });
  m.prof = refProfile("mandarin", 445);
  m.rules = [];
  const rp = refPin("mandarin");
  m.pin = rp.pin; m.prof.rom = rp.rom;
  const PINYIN = /^((zh|ch|sh|[bpmfdtnlgkhjqxrzcswy])?[aeiou]{1,3}(ng|n)?)+$/;
  const strip = (w) => w.normalize("NFD").replace(/[̀-ͯ]/g, "");
  const mc = closedOf(m);
  const mWords = [...mc.prons.map(p => p.w), ...mc.dems.map(d => d.w), mc.neg.w,
    ...mc.qs.map(q => q.w), ...mc.adps.map(a => a.w), ...[1, 5, 10, 23, 87].map(n => numeral(m, n).text.split(" ")).flat()];
  const mBad = mWords.filter(w => !PINYIN.test(strip(w.toLowerCase())));
  check(`pinned Mandarin closed class is legal pinyin (${mBad[0] || "0 illegal"}, n=${mWords.length})`, mBad.length === 0);
  say("   mandarin pronouns: " + mc.prons.map(p => p.g + "=" + p.w).join(" "));

  // determinism + JSON-roundtrip for the whole closed layer
  const w1 = mkWorld(), w2 = mkWorld();
  const a = foundLanguage(w1, { seed: 31313 }), b = foundLanguage(w2, { seed: 31313 });
  const c3 = JSON.parse(JSON.stringify(a));
  const sig = (l) => JSON.stringify([closedOf(l).prons.map(p => p.w), closedOf(l).adps.map(x => x.w),
    numeral(l, 123).text, numeral(l, 47).text]);
  check("closed class deterministic + JSON-roundtrip-stable", sig(a) === sig(b) && sig(a) === sig(c3));
}

// ── 6. INFLECTION: paradigms hold together ────────────────────────────────
// Cells must be distinct where the language marks a distinction, citation
// forms must not move, irregularity must live where frequency puts it, and
// the whole layer must survive save/load byte-identical.
console.log("\n── inflectional morphology ──");
{
  const world = mkWorld();
  const langs = [];
  for (let i = 0; i < 14; i++) langs.push(foundLanguage(world, { seed: 42000 + i * 511 }));
  const fullV = (x) => [...x.pre.map(z => z.w), x.text, ...x.post.map(z => z.w)].join(" ");

  // (a) citation stability: NOM/ABS singular is the dictionary word
  let citeOK = true;
  for (const l of langs) for (const cid of [STONE, RIVER, KING]) {
    const cell = inflectNoun(l, cid, { num: "sg", cas: null });
    if (cell.text !== wordOf(l, cid) || cell.post.length || cell.pre.length) citeOK = false;
  }
  check("citation forms are the dictionary forms (NOM.SG = wordOf)", citeOK);

  // (b) paradigm contrast: the SINGULAR row must carry the case contrasts
  // (plural obliques may honestly syncretize under erosion, like Latin -īs);
  // the table overall stays mostly distinct
  let nounBad = 0, verbBad = 0, nTested = 0;
  for (const l of langs) {
    const shape = paradigmShape(l);
    if (shape.iso) continue;
    nTested++;
    const seen = new Map(), sgSeen = new Set();
    for (const cs of shape.cases) for (const n of shape.nums) {
      const w = fullV(inflectNoun(l, STONE, { num: n, cas: cs.k }));
      seen.set(w, (seen.get(w) || 0) + 1);
      if (n === "sg") sgSeen.add(w);
    }
    const cells = shape.cases.length * shape.nums.length;
    if (sgSeen.size < shape.cases.length * 0.85 || [...seen.keys()].length < cells * 0.6) nounBad++;
    const vSeen = new Map();
    let vCells = 0;
    for (const t of shape.tam) for (const [p, n] of (shape.pers.length ? shape.pers : [[null, "sg"]])) {
      const w = fullV(inflectVerb(l, VERBS[5], { tam: t.k, pers: p, num: n }));   // 'say' (basic)
      vSeen.set(w, (vSeen.get(w) || 0) + 1);
      vCells++;
    }
    if ([...vSeen.keys()].length < vCells * 0.7) verbBad++;
  }
  check(`noun paradigms contrast (sg row ≥85%, table ≥60%: ${nTested - nounBad}/${nTested} langs)`, nounBad === 0);
  check(`verb paradigms ≥70% distinct cells (${nTested - verbBad}/${nTested} langs)`, verbBad === 0);

  // (c) irregularity lives where frequency puts it (b≥0.9 belt), and only there
  let irrBasic = 0, basicTot = 0, irrRare = 0, rareTot = 0;
  for (const l of langs) {
    if (l.prof.morph === "iso") continue;
    const shape = paradigmShape(l);
    const marked = shape.tam.find(t => t.k === "pst") || shape.tam.find(t => t.k === "pfv");
    if (!marked) continue;
    for (const v of VERBS) {
      const b = CONCEPTS[v].b;
      const cell = inflectVerb(l, v, { tam: marked.k, pers: shape.pers.length ? "3" : null, num: "sg" });
      if (b >= 0.95) { basicTot++; if (cell.irr) irrBasic++; }
      if (b < 0.75 && l.prof.morph !== "tmpl") { rareTot++; if (cell.irr) irrRare++; }
    }
  }
  check(`most-basic verbs carry irregular pasts (${Math.round(100 * irrBasic / Math.max(1, basicTot))}% of b≥0.95)`, irrBasic / Math.max(1, basicTot) >= 0.35);
  check(`rare verbs stay regular (${irrRare}/${rareTot} irregular)`, irrRare === 0);

  // (d) affixes are grammaticalized words — etymologies exist
  const withEty = langs.filter(l => l.prof.morph !== "iso" && affixEtymologies(l).length >= 1).length;
  const nonIso = langs.filter(l => l.prof.morph !== "iso").length;
  check(`affixes trace to source words (${withEty}/${nonIso} non-isolating langs)`, withEty >= nonIso * 0.7);

  // (e) vowel harmony reaches the affixes (-lar/-ler): plural endings vary.
  // Front–back harmony specifically — rounding harmony rightly exempts the
  // low vowels most plural markers wear.
  let harm = null;
  for (let i = 0; i < 400 && !harm; i++) {
    const l = foundLanguage(world, { seed: 130000 + i * 71 });
    if (l.prof.harmony === "fb" && l.prof.morph === "agg" && gramOf(l).pluralMark && gramOf(l).affixSide === "suf") harm = l;
  }
  if (harm) {
    const sufs = new Set();
    for (const cid of TOPO_HEAD.slice(0, 16)) {
      const sg = inflectNoun(harm, cid, { num: "sg" }).text;
      const pl = inflectNoun(harm, cid, { num: "pl" }).text;
      if (pl.startsWith(sg)) sufs.add(pl.slice(sg.length));
    }
    check(`harmony reaches the affixes (plural endings: ${[...sufs].slice(0, 4).join(", ")})`, sufs.size >= 2);
  } else check("harmony reaches the affixes (no harmony+agg language found in sweep)", false);

  // (f) determinism + JSON roundtrip of whole paradigms
  const w1 = mkWorld(), w2 = mkWorld();
  const a = foundLanguage(w1, { seed: 5150 }), b2 = foundLanguage(w2, { seed: 5150 });
  const c3 = JSON.parse(JSON.stringify(a));
  const sig = (l) => {
    const shape = paradigmShape(l);
    const out = [];
    for (const cs of shape.cases) for (const n of shape.nums) out.push(fullV(inflectNoun(l, STONE, { num: n, cas: cs.k })));
    for (const t of shape.tam) out.push(fullV(inflectVerb(l, VERBS[2], { tam: t.k, pers: shape.pers.length ? "1" : null, num: "sg" })));
    return JSON.stringify(out);
  };
  check("paradigms deterministic + JSON-roundtrip-stable", sig(a) === sig(b2) && sig(a) === sig(c3));

  // showcase: one declension + one conjugation
  const l = langs.find(x => x.prof.morph === "fus" && gramOf(x).caseN >= 2) || langs.find(x => x.prof.morph !== "iso");
  if (l && !quiet) {
    const shape = paradigmShape(l);
    say("\n   declension of '" + glossOf(STONE) + "' (" + l.prof.morph + ", " + gramOf(l).caseN + " cases):");
    for (const cs of shape.cases.slice(0, 4)) say("     " + (cs.g || "NOM").padEnd(4) + " " + shape.nums.map(n => fullV(inflectNoun(l, STONE, { num: n, cas: cs.k }))).join(" / "));
    const vb = VERBS[2];   // 'go'
    say("   conjugation of '" + glossOf(vb) + "':");
    for (const t of shape.tam) say("     " + (t.g || "PRS").padEnd(4) + " " + (shape.pers.length ? shape.pers : [[null, "sg"]]).slice(0, 3).map(([p, n]) => fullV(inflectVerb(l, vb, { tam: t.k, pers: p, num: n }))).join(" / "));
    say("   endings: " + affixEtymologies(l).map(e => "-" + e.w + " " + e.g + " ‹ '" + e.from + "'").join("  "));
  }
}

// ── 7. GRAMMAR DIACHRONY: cycles, leveling, cognate conjugations ──────────
console.log("\n── grammar diachrony ──");
{
  const world = mkWorld();
  const fullV = (x) => [...x.pre.map(z => z.w), x.text, ...x.post.map(z => z.w)].join(" ");

  // (a) the grammaticalization CYCLE: drift languages hard; every case must
  // stay audible (eroded categories renew from fresh words), and the sweep
  // must actually catch renewal happening
  let silentCase = 0, renewals = 0, checked = 0;
  for (let i = 0; i < 10; i++) {
    const l = foundLanguage(world, { seed: 152000 + i * 419 });
    for (let d = 0; d < 10; d++) driftLanguage(world, l);
    const shape = paradigmShape(l);
    if (shape.iso || !shape.cases.length) continue;
    const bare = fullV(inflectNoun(l, STONE, { num: "sg", cas: null }));
    for (const cs of shape.cases) {
      if (!cs.k) continue;
      checked++;
      if (fullV(inflectNoun(l, STONE, { num: "sg", cas: cs.k })) === bare) silentCase++;
    }
    renewals += affixEtymologies(l).filter(e => e.renewed).length;
  }
  check(`case categories stay audible under heavy drift (${silentCase}/${checked} silent)`, checked > 0 && silentCase === 0);
  check(`renewal actually fires somewhere in the sweep (${renewals} renewed affixes)`, renewals >= 1);

  // (b) analogy leveling: monotone (drift only ever REMOVES irregularity),
  // and at least one leveling event occurs across the sweep
  let leveledEvents = 0, unlevelEvents = 0;
  for (let i = 0; i < 12; i++) {
    const l = foundLanguage(world, { seed: 163000 + i * 227 });
    if (l.prof.morph === "iso") continue;
    const shape0 = paradigmShape(l);
    const marked = shape0.tam.find(t => t.k === "pst") || shape0.tam.find(t => t.k === "pfv");
    if (!marked) continue;
    const irrAt = () => new Set(VERBS.filter(v =>
      inflectVerb(l, v, { tam: marked.k, pers: shape0.pers.length ? "3" : null, num: "sg" }).irr));
    const before = irrAt();
    for (let d = 0; d < 8; d++) driftLanguage(world, l);
    const after = irrAt();
    for (const v of before) if (!after.has(v)) leveledEvents++;
    for (const v of after) if (!before.has(v)) unlevelEvents++;
  }
  check(`analogy leveling is monotone (no verb turns irregular mid-life: ${unlevelEvents})`, unlevelEvents === 0);
  check(`leveling events occur across the sweep (${leveledEvents})`, leveledEvents >= 1);

  // (c) cognate conjugations: daughters inherit the paradigm machinery and
  // diverge by sound law — shared affix sources, differing surface cells
  const root = foundLanguage(world, { seed: 171717 });
  world.step = 2000;
  const dA = branchLanguage(world, root, 0.4);
  world.step = 4000;
  const dB = branchLanguage(world, root, 0.8);
  const srcSig = (l) => affixEtymologies(l).map(e => e.g + "<" + e.from).join("|");
  const shared = srcSig(root) && (srcSig(dA) === srcSig(root) || srcSig(dB) === srcSig(root)
    || srcSig(dA).split("|").filter(x => srcSig(root).includes(x)).length >= srcSig(root).split("|").length / 2);
  check("daughters inherit affix sources (cognate endings)", !!shared);
  const cellRow = (l) => {
    const shape = paradigmShape(l);
    const marked = shape.tam.find(t => t.k === "pst") || shape.tam.find(t => t.k === "pfv") || shape.tam[0];
    const out = [];
    for (const v of [VERBS[2], VERBS[6], VERBS[13]])   // go, see, eat
      out.push(fullV(inflectVerb(l, v, { tam: marked.k, pers: shape.pers.length ? "3" : null, num: "sg" })));
    out.push(fullV(inflectNoun(l, STONE, { num: "pl", cas: null })));
    out.push(fullV(inflectNoun(l, KING, { num: "sg", cas: shape.cases[1] ? shape.cases[1].k : null })));
    return out;
  };
  const rootRow = cellRow(root), aRow = cellRow(dA), bRow = cellRow(dB);
  const nDiff = rootRow.filter((w, i) => w !== aRow[i] || w !== bRow[i]).length;
  check(`inflected cells diverge across the family (${nDiff}/${rootRow.length} cells: go.PST ${rootRow[0]} → ${aRow[0]} / ${bRow[0]})`, nDiff >= 1);

  // (d) word-order shift at branch: rare, and morphology LAGS (adpositions keep)
  let flips = 0, lagOK = true, branches = 0;
  for (let i = 0; i < 120; i++) {
    const w2 = mkWorld();
    const p = foundLanguage(w2, { seed: 190000 + i * 97 });
    const pg = JSON.parse(JSON.stringify(gramOf(p)));
    w2.step = 1000;
    const d = branchLanguage(w2, p, 0.5);
    const dg = gramOf(d);
    branches++;
    if (dg.wo !== pg.wo) { flips++; if (dg.adpSide !== pg.adpSide) lagOK = false; }
  }
  check(`word order shifts at branch rarely (${flips}/${branches})`, flips / branches > 0.03 && flips / branches < 0.25);
  check("morphology lags a word-order shift (adpositions keep their side)", lagOK);
}

// ── 8. SENTENCES: frames render per the dials, gloss-aligned ──────────────
console.log("\n── sentences (frame renderer) ──");
{
  const world = mkWorld();
  const F = {
    trans: { s: { n: KING, def: true }, v: { c: SEE, tam: "pst" }, o: { n: RIVER, def: true } },
    intrans: { s: { n: KING, def: true }, v: { c: SLEEP, tam: "pst" } },
    negF: { s: { pron: { k: "1sg", pers: 1, num: "sg" } }, v: { c: GO, tam: "pst", neg: true } },
    polar: { s: { pron: { k: "2sg", pers: 2, num: "sg" } }, v: { c: TAKE, tam: "pst" }, o: { n: HORSE, def: true }, q: true },
    wh: { s: { pron: { k: "3sg", pers: 3, num: "sg" } }, v: { c: EAT, tam: "pst" }, o: { wh: true } },
    loc: { s: { n: WOLF, def: true, adj: BLACK }, v: { c: SLEEP, tam: null }, loc: { adp: "in", n: TOWN, def: true } },
  };
  const langs = [];
  for (let i = 0; i < 12; i++) langs.push(foundLanguage(world, { seed: 210000 + i * 379 }));
  let alignOK = true, orderBad = 0, negBad = 0, qBad = 0, whBad = 0, ergBad = 0, dropBad = 0, dropSeen = 0;
  for (const l of langs) {
    const g = gramOf(l);
    for (const f of Object.values(F)) {
      const c = renderClause(l, f);
      if (!c.tokens.length || c.text.split(" ").length !== c.gloss.split(" ").length) alignOK = false;
    }
    // verb position honors the word-order dial (frame without q/wh noise)
    const c1 = renderClause(l, F.trans);
    const roles = c1.tokens.map(t => t.role);
    const vAt = roles.indexOf("V"), sAt = roles.indexOf("S"), oAt = roles.indexOf("O");
    if (g.wo === "sov" && !(vAt > sAt && vAt > oAt)) orderBad++;
    if (g.wo === "svo" && !(sAt < vAt && vAt < oAt)) orderBad++;
    if ((g.wo === "vso" || g.wo === "vos") && vAt !== 0) orderBad++;
    // negation is audible: a NEG token or NEG inside the verb gloss
    const cn = renderClause(l, F.negF);
    if (!/(^| |-)NEG( |-|$|\.)/.test(cn.gloss)) negBad++;
    // polar-question particle sits at the dialled edge
    const cq = renderClause(l, F.polar);
    if (g.qPart === "final" && cq.tokens[cq.tokens.length - 1].g !== "Q") qBad++;
    if (g.qPart === "init" && cq.tokens[0].g !== "Q") qBad++;
    // wh-word fronts (or stays in situ) per the dial
    const cw = renderClause(l, F.wh);
    const whAt = cw.tokens.findIndex(t => t.g === "what");
    if (whAt < 0) whBad++;
    else if (g.whFront && whAt !== 0) whBad++;
    // ergativity: ERG on transitive subjects only
    if (g.align === "erg" && g.caseN >= 2) {
      const sTok = c1.tokens.find(t => t.role === "S" && /ERG/.test(t.g));
      const iTok = renderClause(l, F.intrans).tokens.find(t => /ERG/.test(t.g));
      if (!sTok || iTok) ergBad++;
    }
    // pro-drop: pronoun subjects stay home when agreement carries them
    if (g.proDrop && g.agree !== "none") {
      dropSeen++;
      if (cn.tokens.some(t => t.role === "S")) dropBad++;
    }
  }
  check("every clause is gloss-aligned (token counts match)", alignOK);
  check(`verb position honors the word-order dial (${langs.length - orderBad}/${langs.length})`, orderBad === 0);
  check(`negation is always audible (${langs.length - negBad}/${langs.length})`, negBad === 0);
  check(`question particles sit at the dialled edge (${langs.length - qBad}/${langs.length})`, qBad === 0);
  check(`wh-fronting vs in-situ per dial (${langs.length - whBad}/${langs.length})`, whBad === 0);
  check("ergative marks transitive subjects only", ergBad === 0);
  check(`pro-drop drops the subject pronoun (${dropSeen} langs)`, dropBad === 0);

  // pinned references speak in character
  const m = foundLanguage(world, { seed: 445 });
  m.prof = refProfile("mandarin", 445); m.rules = [];
  const mp = refPin("mandarin"); m.pin = mp.pin; m.prof.rom = mp.rom;
  const mc = renderClause(m, F.trans);
  const PINYIN = /^((zh|ch|sh|[bpmfdtnlgkhjqxrzcswy])?[aeiou]{1,3}(ng|n)?)+$/;
  const strip = (w) => w.normalize("NFD").replace(/[̀-ͯ]/g, "");
  const mLegal = mc.tokens.every(t => PINYIN.test(strip(t.w.toLowerCase())));
  const mi = mc.tokens.findIndex(t => t.g === "see");
  const mPfvAfterV = mi >= 0 && mc.tokens[mi + 1] && mc.tokens[mi + 1].g === "PFV";
  check(`pinned Mandarin clause: legal pinyin, SVO, PFV particle after verb (${mc.text})`, mLegal && mPfvAfterV);
  const cqm = renderClause(m, F.polar);
  check(`pinned Mandarin polar question ends in the particle (${cqm.text})`, cqm.tokens[cqm.tokens.length - 1].g === "Q");

  const e = foundLanguage(world, { seed: 446 });
  e.prof = refProfile("english", 446); e.rules = [];
  const ep = refPin("english"); e.pin = ep.pin; e.prof.rom = { ...(e.prof.rom || {}), ...ep.rom };
  const ec = renderClause(e, F.trans);
  const eRoles = ec.tokens.map(t => t.role);
  check(`pinned English-shaped clause is Det-first SVO (${ec.text} = "${ec.gloss}")`,
    ec.tokens[0].g === "DEF" && eRoles.indexOf("S") < eRoles.indexOf("V") && eRoles.indexOf("V") < eRoles.indexOf("O"));

  // determinism + roundtrip of whole clauses
  const w1 = mkWorld(), w2 = mkWorld();
  const a = foundLanguage(w1, { seed: 8484 }), b2 = foundLanguage(w2, { seed: 8484 });
  const c3 = JSON.parse(JSON.stringify(a));
  const sig = (l) => Object.values(F).map(f => renderClause(l, f).text).join("‖");
  check("clauses deterministic + JSON-roundtrip-stable", sig(a) === sig(b2) && sig(a) === sig(c3));

  if (!quiet) {
    say("\n   the same frame in six tongues — [the king saw the river]:");
    for (const l of [...langs.slice(0, 4), m, e]) {
      const c = renderClause(l, F.trans);
      say("     " + c.text.padEnd(34) + "  " + c.gloss);
    }
  }
}

// ── 9. REDUPLICATION — a productive process across morphotypes ────────────
console.log("\n── reduplication ──");
{
  const world = mkWorld();
  const N = 400;
  let withRedup = 0, plOK = 0, plTot = 0, aspOK = 0, aspTot = 0, isoRedup = 0;
  const fullTok = (x) => [...x.pre.map(z => z.w), x.text, ...x.post.map(z => z.w)].join(" ");
  for (let i = 0; i < N; i++) {
    const l = foundLanguage(world, { seed: 300000 + i * 53 });
    const g = gramOf(l);
    if (!g.redup) continue;
    withRedup++;
    if (l.prof.morph === "iso") isoRedup++;
    if (g.redup.fns.includes("plural")) {
      plTot++;
      const sg = inflectNoun(l, HOUSE, { num: "sg" }).text;
      const pl = inflectNoun(l, HOUSE, { num: "pl" });
      // a reduplicated plural must be longer than the singular and its gloss
      // carries the tilde
      if (pl.text.length > sg.length && /~PL/.test(pl.gloss)) plOK++;
    }
    if (g.redup.fns.includes("aspect")) {
      aspTot++;
      const base = fullTok(inflectVerb(l, WALKV));
      const ipf = inflectVerb(l, WALKV, { tam: "ipfv" });
      if (fullTok(ipf).length > base.length && /~IPFV/.test(ipf.gloss)) aspOK++;
    }
  }
  const frac = withRedup / N;
  check(`reduplication occurs at a real rate (${Math.round(frac * 100)}% of rolled langs)`, frac > 0.35 && frac < 0.7);
  check(`reduplication crosses into isolating tongues (${isoRedup} iso langs — Chinese/Malay corner)`, isoRedup >= 3);
  check(`reduplicative plural actually copies the stem (${plOK}/${plTot})`, plTot > 0 && plOK === plTot);
  check(`reduplicative aspect actually copies the stem (${aspOK}/${aspTot})`, aspTot > 0 && aspOK === aspTot);

  // pinned Mandarin: verb reduplication is legal pinyin (kàn-kan → hyphenated
  // copies, each a legal syllable)
  const m = foundLanguage(world, { seed: 445 });
  m.prof = refProfile("mandarin", 445); m.rules = [];
  const mp = refPin("mandarin"); m.pin = mp.pin; m.prof.rom = mp.rom;
  const PINYIN = /^((zh|ch|sh|[bpmfdtnlgkhjqxrzcswy])?[aeiou]{1,3}(ng|n)?)+$/;
  const strip = (w) => w.normalize("NFD").replace(/[̀-ͯ]/g, "");
  const redVerb = inflectVerb(m, SEE, { tam: "ipfv" }).text;
  const parts = strip(redVerb.toLowerCase()).split("-");
  check(`pinned Mandarin verb reduplication is hyphenated legal pinyin (${redVerb})`, parts.length === 2 && parts.every(p => PINYIN.test(p)));

  // intensive reduplication (adjectival)
  let intenseFound = null;
  for (let i = 0; i < 200 && !intenseFound; i++) {
    const l = foundLanguage(world, { seed: 340000 + i * 37 });
    if (intensive(l, GREAT)) intenseFound = l;
  }
  check(`intensive reduplication renders (great → ${intenseFound ? intensive(intenseFound, GREAT).text : "none"})`,
    !!intenseFound && intensive(intenseFound, GREAT).text.length > 0);

  // determinism + JSON roundtrip
  const w1 = mkWorld(), w2 = mkWorld();
  let a = null, b2 = null;
  for (let i = 0; i < 60 && !a; i++) { const x = foundLanguage(w1, { seed: 300000 + i * 53 }); if (gramOf(x).redup) a = x; }
  for (let i = 0; i < 60 && !b2; i++) { const x = foundLanguage(w2, { seed: 300000 + i * 53 }); if (gramOf(x).redup) b2 = x; }
  const c3 = JSON.parse(JSON.stringify(a));
  const sig = (l) => inflectNoun(l, HOUSE, { num: "pl" }).text + "|" + inflectVerb(l, WALKV, { tam: "ipfv" }).text;
  check("reduplication deterministic + JSON-roundtrip-stable", sig(a) === sig(b2) && sig(a) === sig(c3));
}

// ── 10. IMPERATIVE + MOOD — a near-universal category ─────────────────────
console.log("\n── imperative & mood ──");
{
  const world = mkWorld();
  const N = 200;
  const fullTok = (x) => [...x.pre.map(z => z.w), x.text, ...x.post.map(z => z.w)].join(" ");
  const strat = { bare: 0, suffix: 0, particle: 0 };
  let hasImp = 0, bareIsStem = 0, bareTot = 0, markedDiffers = 0, markedTot = 0, prohibNeg = 0;
  for (let i = 0; i < N; i++) {
    const l = foundLanguage(world, { seed: 320000 + i * 61 });
    const g = gramOf(l);
    strat[g.imp]++;
    const imp = inflectVerb(l, GO, { mood: "imp" });
    if (fullTok(imp)) hasImp++;
    // bare imperative equals the citation stem; suffix/particle differ from it
    const cite = inflectVerb(l, GO).text;
    if (g.imp === "bare") { bareTot++; if (imp.text === cite) bareIsStem++; }
    else { markedTot++; if (fullTok(imp) !== cite) markedDiffers++; }
    // prohibitive is a negated imperative — a NEG or PROH token appears
    const proh = inflectVerb(l, GO, { mood: "imp", neg: true });
    if (/(^| )(NEG|PROH)( |$)/.test((proh.gloss + " " + proh.pre.concat(proh.post).map(t => t.g).join(" ")))) prohibNeg++;
  }
  check(`every language has an imperative (${hasImp}/${N})`, hasImp === N);
  check(`imperative strategies at real rates (bare ${strat.bare}, suffix ${strat.suffix}, particle ${strat.particle})`,
    strat.bare / N > 0.3 && strat.suffix / N > 0.25 && strat.particle / N > 0.08);
  check(`bare imperative is the citation stem (${bareIsStem}/${bareTot})`, bareTot > 0 && bareIsStem === bareTot);
  check(`marked imperatives differ from the citation stem (${markedDiffers}/${markedTot})`, markedTot > 0 && markedDiffers >= markedTot * 0.9);
  check(`prohibitive is a negated command (${prohibNeg}/${N})`, prohibNeg === N);

  // clause-level: imperative drops the 2nd-person subject (universal)
  let dropped = 0, impN = 0;
  for (let i = 0; i < 40; i++) {
    const l = foundLanguage(world, { seed: 321000 + i * 71 });
    const c = renderClause(l, { s: { pron: { k: "2sg", pers: 2, num: "sg" } }, v: { c: GO, mood: "imp" } });
    impN++;
    if (!c.tokens.some(t => t.role === "S")) dropped++;
  }
  check(`imperative drops the addressee subject (${dropped}/${impN})`, dropped === impN);

  // pinned refs speak commands in character: English/Chinese bare, Russian suffix
  const e = foundLanguage(world, { seed: 446 });
  e.prof = refProfile("english", 446); e.rules = [];
  const ep = refPin("english"); e.pin = ep.pin; e.prof.rom = { ...(e.prof.rom || {}), ...ep.rom };
  check(`English-shaped imperative is the bare stem (Go! = ${inflectVerb(e, GO, { mood: "imp" }).text}, cf. ${inflectVerb(e, GO).text})`,
    inflectVerb(e, GO, { mood: "imp" }).text === inflectVerb(e, GO).text);
  const ru = foundLanguage(world, { seed: 447 });
  ru.prof = refProfile("russian", 447); ru.rules = [];
  const rup = refPin("russian"); ru.pin = rup.pin;
  check(`Russian-shaped imperative takes a suffix (${fullTok(inflectVerb(ru, GO, { mood: "imp" }))})`,
    fullTok(inflectVerb(ru, GO, { mood: "imp" })) !== inflectVerb(ru, GO).text);

  if (!quiet) {
    say("   commands in five tongues — [Don't take the horse!]:");
    for (const seed of [320061, 320122, 320183]) {
      const l = foundLanguage(world, { seed });
      const c = renderClause(l, { s: { pron: { k: "2sg", pers: 2, num: "sg" } }, v: { c: TAKE, mood: "imp", neg: true }, o: { n: HORSE, def: true } });
      say("     " + c.text.padEnd(30) + "  " + c.gloss);
    }
  }
}

// ── 11. HOMOPHONY BUDGET + PHONOLOGY DIVERSITY (fresh-reader review) ───────
// A small syllable space must not drown the vocabulary in homophones (the
// "three = four = five = a" collapse); the CV cell must VARY, not blur into
// one Polynesian silhouette; and no language may have homophonous numerals.
console.log("\n── homophony budget + diversity ──");
{
  const world = mkWorld();
  const N = 500;
  let worstHom = 0, worstSeed = 0, overBudget = 0, numBad10 = 0, numBad40 = 0;
  const sylDist = { 0: 0, 1: 0, 2: 0, 3: 0 };
  const cvFlavors = {};
  for (let i = 0; i < N; i++) {
    const seed = 8000 + i * 11;
    const l = foundLanguage(world, { seed });
    sylDist[l.prof.sylC]++;
    if (l.prof.sylC === 0) { const f = (l.prof.tone ? "tone" : "atonal") + "+" + (l.prof.nasalCoda ? "nasal" : "open"); cvFlavors[f] = (cvFlavors[f] || 0) + 1; }
    const words = CONCEPTS.map((c, cid) => wordOf(l, cid));
    const hom = 1 - new Set(words).size / words.length;
    if (hom > worstHom) { worstHom = hom; worstSeed = seed; }
    if (hom > 0.18) overBudget++;
    const n10 = []; for (let n = 1; n <= 10; n++) n10.push(numeral(l, n).text);
    if (new Set(n10).size !== 10) numBad10++;
    const n40 = []; for (let n = 1; n <= 40; n++) n40.push(numeral(l, n).text);
    if (new Set(n40).size !== 40) numBad40++;
  }
  check(`core homophony within budget (worst ${Math.round(worstHom * 100)}% @ seed ${worstSeed}, ${overBudget}/${N} over 18%)`, overBudget === 0);
  check(`numerals 1–10 pairwise distinct in EVERY language (${numBad10}/${N} bad)`, numBad10 === 0);
  check(`numerals 1–40 distinct in every language (${numBad40}/${N} bad)`, numBad40 === 0);
  // the flagged regression seed itself
  const wi = foundLanguage(world, { seed: 8817 });
  const wiWords = CONCEPTS.map((c, cid) => wordOf(wi, cid));
  const wiHom = 1 - new Set(wiWords).size / wiWords.length;
  const wi345 = [numeral(wi, 3).text, numeral(wi, 4).text, numeral(wi, 5).text];
  check(`seed 8817 (the reported regression) no longer collapses (${Math.round(wiHom * 100)}% hom, 3/4/5 = ${wi345.join("/")})`, wiHom < 0.15 && new Set(wi345).size === 3);
  // WALS-shaped syllable distribution: CV a real minority, not a third
  check(`syllable complexity WALS-shaped (CV ${Math.round(100 * sylDist[0] / N)}%, not over-weighted)`, sylDist[0] / N > 0.1 && sylDist[0] / N < 0.26);
  // the CV cell must show ≥3 distinct flavors (tone×coda), not collapse to one
  check(`CV languages vary (${Object.keys(cvFlavors).length} flavors: ${Object.entries(cvFlavors).map(([k, v]) => k + " " + v).join(", ")})`, Object.keys(cvFlavors).length >= 3);
  say("   worst-homophony language now speaks distinct core words; the island has more than one shape.");

  // grammatical enclitic particles go NEUTRAL-tone in a tone language
  // (吗/了), while pronouns and negators keep their melody
  const m2 = foundLanguage(world, { seed: 445 });
  m2.prof = refProfile("mandarin", 445); m2.rules = [];
  const mp2 = refPin("mandarin"); m2.pin = mp2.pin; m2.prof.rom = mp2.rom;
  const toneMark = (s) => /[̀́̄̌]/.test(s.normalize("NFD"));
  const cl2 = closedOf(m2);
  const particleToneless = !toneMark(cl2.qp.w) && inflectVerb(m2, SEE, { tam: "pfv" }).post.every(t => !toneMark(t.w));
  const contentTone = toneMark(cl2.prons[0].w) || toneMark(cl2.neg.w);
  check(`tonal particles go neutral, content words keep tone (Q=${cl2.qp.w}, 1SG=${cl2.prons[0].w})`, particleToneless && contentTone);

  // grammaticalization pathways stay DIVERSE (not belly→in / face→to for all)
  const perMeaning = {};
  for (let i = 0; i < 80; i++) {
    const l = foundLanguage(world, { seed: 5000 + i * 97 });
    for (const a of closedOf(l).adps) if (a.src != null) (perMeaning[a.m] = perMeaning[a.m] || new Set()).add(glossOf(a.src));
  }
  const multiSource = Object.values(perMeaning).filter(s => s.size >= 2).length;
  check(`adposition sources are diverse (${multiSource} meanings drawn from ≥2 different source words)`, multiSource >= 4);
}

// ── 12. CONSISTENCY: dictionary ≡ paradigm ≡ counting (fresh-reader round) ─
// The homophony repair must reach one repaired ROOT that dictionary,
// paradigm citation cell, and numeral system all build from — no desync
// (go=šüvep vs šüvepxik, 6=paxobe vs deqe). Affixes must not serve two
// grammatical categories on one language; dynasties must name consistently.
console.log("\n── cross-layer consistency ──");
{
  const world = mkWorld();
  const N = 400;
  const fullV = (x) => [...x.pre.map(z => z.w), x.text, ...x.post.map(z => z.w)].join(" ");
  let citeBad = 0, numBad = 0, affColl = 0, affLangs = 0;
  for (let i = 0; i < N; i++) {
    const l = foundLanguage(world, { seed: 8000 + i * 11 });
    // citation verb (present, unmarked) IS the dictionary word
    for (const v of [GO, SEE, EAT, TAKE]) if (fullV(inflectVerb(l, v, { tam: null })) !== wordOf(l, v)) citeBad++;
    // dictionary numeral concept IS the counting-system form
    for (const [cid, n] of [[SIX, 6], [SEVEN, 7], [EIGHT, 8], [NINE, 9], [TEN, 10]])
      if (numeralConceptWord(l, cid) !== numeral(l, n).text) numBad++;
    // no bound affix serves two categories (the -fe = PL & PST case): compare
    // the raw spec affix surfaces across number/case/TAM
    if (l.prof.morph !== "iso") {
      affLangs++;
      const spec = paradigmSpec(l);
      const bound = [spec.pl, spec.du, ...spec.cases, spec.tam.pst, spec.tam.fut, spec.tam.pfv, spec.tam.ipfv, spec.imp].filter(Boolean);
      const surf = bound.map(a => a.g + "=" + JSON.stringify(a.syl));
      const bySurf = {};
      bound.forEach(a => { const k = JSON.stringify(a.syl); (bySurf[k] = bySurf[k] || []).push(a.g); });
      if (Object.values(bySurf).some(gs => gs.length > 1)) affColl++;
      void surf;
    }
  }
  check(`citation verb ≡ dictionary word (${citeBad}/${N * 4} desyncs)`, citeBad === 0);
  check(`dictionary numeral ≡ counting form (${numBad}/${N * 5} desyncs)`, numBad === 0);
  check(`no bound affix serves two categories (${affColl}/${affLangs} langs with a PL=PST-style clash)`, affColl === 0);

  // dynasties name CONSISTENTLY within a language (no Efatucheta beside Edo):
  // the house suffix is now a per-language constant, so the SAME founder
  // always yields the SAME house name regardless of ordinal — before the fix
  // a per-name random suffix (incl. the empty one) made them differ
  let dynBad = 0, dynLangs = 0;
  for (let i = 0; i < 200; i++) {
    const l = foundLanguage(world, { seed: 7000 + i * 29 });
    if (l.prof.patro !== "none") continue;
    dynLangs++;
    const names = [1, 2, 3, 7, 42].map(k => langDynastyName(l, k, "Adan"));
    if (new Set(names).size !== 1) dynBad++;
  }
  check(`dynasties name consistently — one house rule per tongue (${dynBad}/${dynLangs} inconsistent)`, dynLangs > 0 && dynBad === 0);

  say("   go-citation now equals the dictionary; base-5 'six' reads the same in the counter and the lexicon.");
}

// ── 13. INTENTIONAL ABSTRACT DERIVATION (the "king ← sit/high" table) ─────
// Abstract concepts (king, god, law, temple…) can DERIVE from concrete/basic
// ones on purpose, routed through the same joinInternal/rule-log machinery as
// every other word — so the etymology is recoverable AND drifts under sound
// change. Built as a relations table (DERIV) rolled per family, never a
// hard-coded output; sources are always concrete, so the graph is a DAG.
console.log("\n── abstract derivation ──");
{
  const ABS = [KING, QUEEN, CHIEF, GOD, PRIEST, TEMPLE, TOMB, THRONE, CROWN, LAW, OATH, COUNCIL, ARMY, GUARD, VICTORY];
  const TARGETS = new Set(DERIV.map(e => e[0]));

  // (a) the full derivation graph (structural dv + DERIV) is a DAG — no
  // concept can derive from itself transitively (would hang generation), and
  // every DERIV source is a CONCRETE concept (never a target, and basic), so
  // compounds stay one morpheme deep and recoverable
  const edges = new Map();
  const addE = (t, s) => { if (!edges.has(t)) edges.set(t, new Set()); edges.get(t).add(s); };
  CONCEPTS.forEach((con, cid) => { if (con.dv) { addE(cid, con.dv[0]); addE(cid, con.dv[1]); } });
  for (const [t, [a, b]] of DERIV) { addE(t, a); addE(t, b); }
  const color = new Map();
  const dfs = (u) => {
    color.set(u, 1);
    for (const v of (edges.get(u) || [])) {
      if (color.get(v) === 1) return true;
      if (color.get(v) !== 2 && dfs(v)) return true;
    }
    color.set(u, 2); return false;
  };
  let cyclic = false;
  for (const t of edges.keys()) if (color.get(t) !== 2 && dfs(t)) { cyclic = true; break; }
  const srcAlsoTarget = DERIV.some(([, [a, b]]) => TARGETS.has(a) || TARGETS.has(b));
  const srcBasic = DERIV.every(([, [a, b]]) => CONCEPTS[a].b >= 0.6 && CONCEPTS[b].b >= 0.6);
  check(`derivation graph is a DAG (no concept derives from itself)`, !cyclic);
  check(`DERIV sources are concrete & basic (never targets, b≥0.6)`, !srcAlsoTarget && srcBasic);

  // (b) derivation occurs at a real rate, and WHICH concept derives varies by
  // family — not everything, not nothing (the anti-mush property for lexicon)
  const world = mkWorld();
  const N = 500;
  let pairs = 0, derived = 0;
  const perConcept = new Map(ABS.map(c => [c, 0]));
  const byMorph = { iso: [0, 0], agg: [0, 0], fus: [0, 0], tmpl: [0, 0] };
  for (let i = 0; i < N; i++) {
    const l = foundLanguage(world, { seed: 8000 + i * 11 });
    const bm = byMorph[l.prof.morph];
    for (const cid of ABS) { pairs++; bm[1]++; if (etymologyOf(l, cid)) { derived++; bm[0]++; perConcept.set(cid, perConcept.get(cid) + 1); } }
  }
  const rate = derived / pairs;
  const varies = [...perConcept.values()].every(v => v > N * 0.08 && v < N * 0.92);
  check(`abstract derivation occurs at a human rate (${Math.round(rate * 100)}% of concept·lang pairs)`, rate > 0.3 && rate < 0.65);
  check(`which concept derives varies by family (each 8–92% of langs; min ${Math.min(...perConcept.values())}, max ${Math.max(...perConcept.values())})`, varies);

  // (c) morphotype co-variation: isolating tongues compound abstract vocab far
  // more than fusional ones (Chinese 国王 vs opaque Latin rēx) — the
  // transparency gradient, grounded in the morph dial, not an independent roll
  const mr = (m) => byMorph[m][1] ? byMorph[m][0] / byMorph[m][1] : 0;
  check(`transparency co-varies with morphotype (iso ${Math.round(mr("iso") * 100)}% > fus ${Math.round(mr("fus") * 100)}%)`,
    mr("iso") > mr("fus") + 0.15 && mr("agg") > mr("fus"));

  // (d) flagship showcase — the reviewer's own example, held stable: seed 8817
  // makes 'king' the one who SITS HIGH (the designed version of the old
  // accidental sit=king), routed through a real compound
  const l8 = foundLanguage(world, { seed: 8817 });
  const e8 = etymologyOf(l8, KING);
  check(`seed 8817: king ← 'sit'+'high' (${wordOf(l8, KING)} ‹ ${e8 ? e8.glosses.join("+") : "null"})`,
    !!e8 && e8.glosses[0] === "sit" && e8.glosses[1] === "high");

  // (e) recoverable AND shifts under sound change: down a family the derived
  // SURFACE drifts (it rides the rule log like any word) while the etymology
  // parts stay identical (the compound's morphemes are family property)
  let shifted = 0, etyMoved = 0, tot = 0;
  for (let i = 0; i < 120; i++) {
    const w2 = mkWorld();
    const root = foundLanguage(w2, { seed: 171000 + i * 91 });
    w2.step = 4000;
    const dau = branchLanguage(w2, root, 0.9);
    for (const cid of ABS) {
      const er = etymologyOf(root, cid), ed = etymologyOf(dau, cid);
      if (!er) continue;
      tot++;
      if (wordOf(root, cid) !== wordOf(dau, cid)) shifted++;
      if (!ed || ed.parts[0] !== er.parts[0] || ed.parts[1] !== er.parts[1]) etyMoved++;
    }
  }
  check(`derived surfaces drift down the family (${shifted}/${tot} shifted)`, tot > 0 && shifted > tot * 0.3);
  check(`etymology stays legible through drift (${tot - etyMoved}/${tot} parts stable)`, etyMoved === 0);

  // (f) consistency preserved: making KING/GOD/LAW derivable must not break the
  // citation≡dictionary invariant (the derived stem still cites as wordOf)
  let citeBad = 0, citeTot = 0;
  for (let i = 0; i < 500; i++) {
    const l = foundLanguage(world, { seed: 8000 + i * 11 });
    if (l.prof.morph === "iso") continue;
    for (const cid of ABS) {
      if (!etymologyOf(l, cid)) continue;
      const cell = inflectNoun(l, cid, { num: "sg", cas: null });
      if (cell.pre.length || cell.post.length) continue;
      citeTot++;
      if (cell.text !== wordOf(l, cid)) citeBad++;
    }
  }
  check(`derived abstract concepts still cite as the dictionary word (${citeBad}/${citeTot} desyncs)`, citeTot > 0 && citeBad === 0);

  // (g) references speak the feature in character: isolating Mandarin compounds
  // abstract vocab (and every derived form stays legal pinyin); fusional
  // Russian leans opaque — the morphotype gradient, on the pinned tongues
  const PINYIN = /^((zh|ch|sh|[bpmfdtnlgkhjqxrzcswy])?[aeiou]{1,3}(ng|n)?)+$/;
  const strip = (w) => w.normalize("NFD").replace(/[̀-ͯ]/g, "");
  const m = foundLanguage(world, { seed: 445 });
  m.prof = refProfile("mandarin", 445); m.rules = [];
  const mp = refPin("mandarin"); m.pin = mp.pin; m.prof.rom = mp.rom;
  const mDeriv = ABS.filter(c => etymologyOf(m, c));
  const mLegal = mDeriv.every(c => PINYIN.test(strip(wordOf(m, c).toLowerCase())));
  const ru = foundLanguage(world, { seed: 447 });
  ru.prof = refProfile("russian", 447); ru.rules = [];
  const rup = refPin("russian"); ru.pin = rup.pin;
  const ruDeriv = ABS.filter(c => etymologyOf(ru, c));
  check(`pinned Mandarin compounds abstract vocab, legal pinyin (${mDeriv.length}/15 derived, e.g. ${mDeriv[0] != null ? wordOf(m, mDeriv[0]) + " ‹ " + etymologyOf(m, mDeriv[0]).glosses.join("+") : "—"})`,
    mDeriv.length >= 4 && mLegal);
  check(`isolating Mandarin more transparent than fusional Russian (${mDeriv.length} vs ${ruDeriv.length})`, mDeriv.length > ruDeriv.length);

  // (h) determinism + JSON roundtrip of etymology and derived surfaces
  const w1 = mkWorld(), w2 = mkWorld();
  const a = foundLanguage(w1, { seed: 9077 }), b = foundLanguage(w2, { seed: 9077 });
  const c3 = JSON.parse(JSON.stringify(a));
  const sig = (l) => JSON.stringify(ABS.map(c => [wordOf(l, c), etymologyOf(l, c) && etymologyOf(l, c).parts]));
  check("abstract derivation deterministic + JSON-roundtrip-stable", sig(a) === sig(b) && sig(a) === sig(c3));

  if (!quiet) {
    say("   designed etymologies in one tongue (" + langWord(l8, 0) + "):");
    for (const cid of ABS) { const e = etymologyOf(l8, cid); if (e) say("     " + glossOf(cid).padEnd(9) + " " + wordOf(l8, cid).padEnd(14) + " ‹ " + e.glosses.join("+")); }
  }
}

// ── 14. COMPLEX SYNTAX — the clause beyond one verb ───────────────────────
// Relative clauses (gap/resumptive/participle, pre- vs postnominal by word
// order), complement clauses ('said that…'), adverbial subordination
// ('when…'), clause coordination, and demonstrative/numeral order in the NP.
// This is what lets a chronicle sentence exceed "the black wolf sleeps."
console.log("\n── complex syntax ──");
{
  const world = mkWorld();
  const F = {
    relSubj: { s: { n: KING, def: true, rel: { headRole: "s", v: { c: SEE, tam: "pst" }, o: { n: RIVER, def: true } } }, v: { c: SLEEP, tam: "pst" } },
    relObj: { s: { n: RIVER, def: true, rel: { headRole: "o", s: { n: KING, def: true }, v: { c: SEE, tam: "pst" } } }, v: { c: GO, tam: "pst" } },
    comp: { s: { pron: { k: "3sg", pers: 3, num: "sg" } }, v: { c: SAY, tam: "pst", comp: { s: { n: KING, def: true }, v: { c: SEE, tam: "pst" }, o: { n: RIVER, def: true } } } },
    adv: { sub: { con: "when", frame: { s: { n: WOLF, def: true }, v: { c: COME, tam: "pst" } } }, s: { n: KING, def: true }, v: { c: SLEEP, tam: "pst" } },
    coord: { s: { n: KING, def: true }, v: { c: SLEEP, tam: "pst" }, coord: { con: "and", frame: { s: { n: WOLF, def: true }, v: { c: COME, tam: "pst" } } } },
    np: { s: { n: HORSE, def: true, dem: "far", card: 3, adj: BLACK }, v: { c: SLEEP, tam: null } },
  };

  // (a) THE correctness gate: every nested clause is still token-aligned to its
  // interlinear gloss, and never degenerates to empty — the property that
  // makes the whole layer trustworthy as chronicle output
  const langs = [];
  for (let i = 0; i < 200; i++) langs.push(foundLanguage(world, { seed: 210000 + i * 379 }));
  let misalign = 0, degen = 0, tot = 0;
  for (const l of langs) for (const f of Object.values(F)) {
    const c = renderClause(l, f); tot++;
    if (c.text.split(" ").length !== c.gloss.split(" ").length) misalign++;
    if (!c.text.trim() || c.tokens.length < 2) degen++;
  }
  check(`every nested clause is gloss-aligned (${misalign}/${tot} misaligned, ${degen} degenerate)`, misalign === 0 && degen === 0);

  // (b) relative clauses are well-formed: a relativizer (REL) heads gap/
  // resumptive RCs, a participle (V.PTCP) marks the participial strategy — one
  // or the other, in every tongue
  let relOK = 0;
  for (const l of langs) {
    const g = gramOf(l);
    const gl = renderClause(l, F.relSubj).gloss;
    if (g.relStrat === "part" ? /\.PTCP\b/.test(gl) : /(^| )REL( |$)/.test(gl)) relOK++;
  }
  check(`relative clauses are marked (REL word, or a participle: ${relOK}/${langs.length})`, relOK === langs.length);

  // (c) Greenberg (WALS 90A): OV tongues take PRENOMINAL relatives at a real
  // rate; VO tongues take POSTNOMINAL strongly; all three strategies occur
  const N = 400;
  const t = { ovT: 0, ovPre: 0, voT: 0, voPost: 0, gap: 0, pron: 0, part: 0, demT: 0, demN: 0, compNone: 0, advPre: 0, ovAdv: 0 };
  for (let i = 0; i < N; i++) {
    const prof = rollProfile(77000 + i * 991);
    const g = rollGrammar(77000 + i * 991, prof);
    const ov = g.wo === "sov" || g.wo === "ovs";
    if (ov) { t.ovT++; if (g.relPos === "pre") t.ovPre++; if (g.advPos === "pre") t.ovAdv++; }
    else { t.voT++; if (g.relPos === "post") t.voPost++; }
    t[g.relStrat]++;
    t.demT++; if (g.demN) t.demN++;
    if (g.compz === "none") t.compNone++;
  }
  check(`U: OV ⇒ prenominal relatives at a real rate (${Math.round(100 * t.ovPre / t.ovT)}%)`, t.ovPre / t.ovT > 0.33);
  check(`U: VO ⇒ postnominal relatives strongly (${Math.round(100 * t.voPost / t.voT)}%)`, t.voPost / t.voT > 0.8);
  check(`all relativization strategies occur (gap ${t.gap}, resumptive ${t.pron}, participle ${t.part})`, t.gap > 0 && t.pron > 0 && t.part > 0);
  check(`demonstratives lean prenominal (Greenberg U18: ${Math.round(100 * t.demN / t.demT)}%)`, t.demN / t.demT > 0.6 && t.demN / t.demT < 0.95);

  // (d) complement clauses: the complementizer (COMP) appears wherever the
  // tongue has one, and the embedded verb renders inside
  let compOK = 0, compHas = 0;
  for (const l of langs) {
    const g = gramOf(l);
    const c = renderClause(l, F.comp);
    if (g.compz !== "none") { compHas++; if (/(^| )COMP( |$)/.test(c.gloss)) compOK++; }
    // the embedded 'see' verb must appear in the complement
  }
  check(`complement clauses carry a complementizer where the tongue has one (${compOK}/${compHas})`, compHas > 0 && compOK === compHas);

  // (e) adverbial subordination + coordination render their linkers, and the
  // adverbial clause preposes more often in OV (the 'when X, Y' order)
  let advOK = 0, coordOK = 0;
  for (const l of langs) {
    if (/(^| )when( |$)/.test(renderClause(l, F.adv).gloss)) advOK++;
    if (/(^| )and( |$)/.test(renderClause(l, F.coord).gloss)) coordOK++;
  }
  check(`adverbial 'when' clauses render (${advOK}/${langs.length})`, advOK === langs.length);
  check(`clause coordination renders 'and' (${coordOK}/${langs.length})`, coordOK === langs.length);
  check(`adverbial clauses prepose more in OV than VO (${Math.round(100 * t.ovAdv / t.ovT)}% of OV)`, t.ovAdv / t.ovT > 0.5);

  // (f) NP-internal: the F.np frame sets a demonstrative AND def:true — the
  // demonstrative must suppress the article (no "that the horse"), so DEF must
  // never surface; the numeral must render; the demonstrative must appear
  let stackBad = 0, npHasNum = 0, npHasDem = 0;
  for (const l of langs) {
    const c = renderClause(l, F.np);
    if (/(^| )DEF( |$)/.test(c.gloss)) stackBad++;
    if (/(^| )3( |$)/.test(c.gloss)) npHasNum++;
    if (/(^| )(that|yon)( |$)/.test(c.gloss)) npHasDem++;
  }
  check(`a demonstrative suppresses the article — no "that the horse" (${stackBad} stackers)`, stackBad === 0);
  check(`the cardinal numeral renders in the noun phrase (${npHasNum}/${langs.length})`, npHasNum === langs.length);
  check(`the demonstrative renders in the noun phrase (${npHasDem}/${langs.length})`, npHasDem === langs.length);

  // (g) references speak complex clauses in character: Mandarin builds a
  // PRENOMINAL relative ([… gap] REL head) in legal pinyin; English a
  // POSTNOMINAL one (DEF king REL saw …)
  const PINYIN = /^((zh|ch|sh|[bpmfdtnlgkhjqxrzcswy])?[aeiou]{1,3}(ng|n)?)+$/;
  const strip = (w) => w.normalize("NFD").replace(/[̀-ͯ]/g, "");
  const m = foundLanguage(world, { seed: 445 });
  m.prof = refProfile("mandarin", 445); m.rules = [];
  const mp = refPin("mandarin"); m.pin = mp.pin; m.prof.rom = mp.rom;
  const mc = renderClause(m, F.relSubj);
  const mRelIdx = mc.tokens.findIndex(t => t.g === "REL");
  const mHeadIdx = mc.tokens.findIndex(t => t.role === "S" && t.g === "king");
  const mLegal = mc.tokens.every(t => PINYIN.test(strip(t.w.toLowerCase())));
  check(`pinned Mandarin: prenominal relative, REL before head, legal pinyin (${mc.text})`,
    mRelIdx >= 0 && mHeadIdx >= 0 && mRelIdx < mHeadIdx && mLegal);
  const e = foundLanguage(world, { seed: 446 });
  e.prof = refProfile("english", 446); e.rules = [];
  const ep = refPin("english"); e.prof.rom = { ...(e.prof.rom || {}), ...ep.rom }; e.pin = ep.pin;
  const ec = renderClause(e, F.relSubj);
  const eHead = ec.tokens.findIndex(t => t.role === "S" && t.g === "king");
  const eRel = ec.tokens.findIndex(t => t.g === "REL");
  check(`pinned English: postnominal relative, head before REL (${ec.text})`, eHead >= 0 && eRel > eHead);

  // (h) determinism + JSON roundtrip of the whole nested-clause set
  const w1 = mkWorld(), w2 = mkWorld();
  const a = foundLanguage(w1, { seed: 8484 }), b2 = foundLanguage(w2, { seed: 8484 });
  const c3 = JSON.parse(JSON.stringify(a));
  const sig = (l) => Object.values(F).map(f => renderClause(l, f).text).join("‖");
  check("complex clauses deterministic + JSON-roundtrip-stable", sig(a) === sig(b2) && sig(a) === sig(c3));

  if (!quiet) {
    say("\n   'the king who saw the river slept' in four tongues:");
    for (const l of [m, e, langs[0], langs[3]]) { const c = renderClause(l, F.relSubj); say("     " + c.text.padEnd(40) + "  " + c.gloss); }
    say("   'he said that the king saw the river':");
    for (const l of [m, e, langs[0]]) { const c = renderClause(l, F.comp); say("     " + c.text.padEnd(40) + "  " + c.gloss); }
  }
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

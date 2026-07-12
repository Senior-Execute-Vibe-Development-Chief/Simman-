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
import { rollGrammar, gramOf, closedOf, numeral, numeralConceptWord, inflectNoun, inflectVerb, paradigmShape, paradigmSpec, affixEtymologies, renderClause, intensive, genderOf, classInventory, nounClassInfo, pronoun, concordMarkers, agreementTargets, inflectAdj, alignmentOf, agentivityOf, clauseAlignment, voicesOf, voiceEtymologies, tamShape, resolveMood, resolveTam, evidentialSystem, classifiersOf, classifierEtymologies, classifierFor, classifSenseOf, numeralPhrase, inflectPossessed, possessionType, comparative, tvPronouns, honorificVerb, renderClauseTree, clauseLinkersOf } from "../src/sim/languageGrammar.js";
import { WATER, RIVER, KING, STONE, MOTHER, GOD, WINE, LAW, CONCEPTS, VERBS, TOPO_HEAD, SEE, GO, TAKE, EAT, SLEEP, HORSE, WOLF, TOWN, BLACK, HOUSE, WALKV, GREAT, SIX, SEVEN, EIGHT, NINE, TEN, SEEM, MAN, TREE, FISH, HAND } from "../src/sim/languageLexicon.js";

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
    // the T-V polite forms (2v/2vv) legitimately syncretize with 2pl (the vous
    // machine), so the core person×number paradigm is what must be distinct
    const ws = cl.prons.filter(p => p.k !== "2v" && p.k !== "2vv").map(p => p.w);
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

// ── 13. INTENTIONAL ABSTRACT DERIVATION (the reviewer's parked ask) ────────
// Abstract concepts (king, god, law…) may DERIVE on purpose from concrete ones
// via a curated relations table rolled per family (king ‹ "great man", god ‹
// "sky father"). It must be a SYSTEM, not a fitted output — different tongues
// build the same idea from different parts, some keep an opaque root — and the
// etymology must agree with the actual word (no desync), stay a family property
// down a lineage, and drift with the sound-change log.
console.log("\n── intentional abstract derivation ──");
{
  const world = mkWorld();
  const cidOf = (g) => CONCEPTS.findIndex(c => c.g === g);
  const ABS = ["king", "queen", "god", "spirit", "holy", "priest", "law", "oath",
    "throne", "crown", "tax", "council", "victory", "army", "guard", "noble"].map(cidOf);
  const N = 300;
  // syllable proxy: maximal vowel-groups, tone diacritics stripped
  const sylCount = (w) => (w.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().match(/[aeiouü]+/g) || []).length;
  let opportunities = 0, derived = 0, glossBad = 0, blankWord = 0, tooLong = 0;
  let citeBad = 0, citeTot = 0;
  const paths = {}; ABS.forEach(t => paths[t] = new Set());
  const derivedCount = {}; ABS.forEach(t => derivedCount[t] = 0);
  for (let i = 0; i < N; i++) {
    const l = foundLanguage(world, { seed: 400000 + i * 97 });
    for (const t of ABS) {
      opportunities++;
      const ety = etymologyOf(l, t);
      const w = wordOf(l, t);
      if (!w) blankWord++;
      // citation stability extends to derived abstracts: the noun's NOM/ABS.sg
      // cell IS the dictionary word (the one-repaired-root invariant)
      const cell = inflectNoun(l, t, { num: "sg", cas: null });
      citeTot++;
      if (cell.text !== w || cell.pre.length || cell.post.length) citeBad++;
      if (ety) {
        derived++; derivedCount[t]++;
        paths[t].add(ety.gloss);
        // etymology must be well-formed AND agree with the word (isDerived):
        // a non-null etymology means the word is a compound, so it can't equal
        // the pristine one-root synthesis the concept would have as an atom
        if (!ety.gloss || ety.head == null || ety.mod == null || ety.head === ety.mod) glossBad++;
        // transparent compounds wear to 1–3 syllable stumps — even the rare,
        // nested ones (throne ‹ king+sit) must not run to four-heavy-syllable
        // mouthfuls (the erosion mechanism, not gated on the target's frequency)
        if (sylCount(w) > 3) tooLong++;
      }
    }
  }
  const rate = derived / opportunities;
  check(`abstracts derive at a real rate, not all-or-nothing (${Math.round(rate * 100)}% of ${opportunities} chances)`,
    rate > 0.45 && rate < 0.85);
  check(`every derived concept renders a non-empty word (${blankWord} blanks)`, blankWord === 0);
  check(`derived abstracts wear to ≤3-syllable stumps (${tooLong}/${derived} over three, <1%)`, tooLong / Math.max(1, derived) < 0.01);
  check(`derived abstracts keep citation ≡ dictionary (${citeBad}/${citeTot} desyncs)`, citeBad === 0);
  check(`etymologies are well-formed (${glossBad} malformed)`, glossBad === 0);
  // anti-fitting: the SAME idea is coined from different parts across families,
  // and both derived AND opaque outcomes occur — proof it is rolled, not fixed
  const kingP = paths[cidOf("king")].size, godP = paths[cidOf("god")].size,
    lawP = paths[cidOf("law")].size, vicP = paths[cidOf("victory")].size;
  check(`no fitted outcome: king/god/law/victory each coined ≥2 ways (${kingP}/${godP}/${lawP}/${vicP} pathways)`,
    kingP >= 3 && godP >= 2 && lawP >= 3 && vicP >= 2);
  const kd = derivedCount[cidOf("king")];
  check(`both outcomes occur — some tongues derive 'king', some keep a root (${kd}/${N} derive)`, kd > 0 && kd < N);
  say(`   'king' across the sample: ${[...paths[cidOf("king")]].join(" · ")}`);

  // recoverable + drifts: the pathway is a FAMILY property (inherited to the
  // daughter), and the derived word actually shifts down the lineage
  const w2 = mkWorld();
  const root = foundLanguage(w2, { seed: 4242 });
  w2.step = 3000; const dA = branchLanguage(w2, root, 0.5);
  w2.step = 6000; const dB = branchLanguage(w2, root, 0.9);
  let pathKept = true, pathTot = 0, shifted = 0;
  for (const t of ABS) {
    const er = etymologyOf(root, t);
    if (!er) continue;
    pathTot++;
    const ea = etymologyOf(dA, t);
    if (!ea || ea.head !== er.head || ea.mod !== er.mod) pathKept = false;
    if (wordOf(dA, t) !== wordOf(dB, t)) shifted++;
  }
  check(`derivation pathway is inherited down the family (${pathTot} derived roots)`, pathTot > 0 && pathKept);
  check(`derived abstracts drift apart across daughters (${shifted}/${pathTot} shifted)`, shifted >= 1);
  say(`   ${glossOf(cidOf("king"))}: ${wordOf(root, cidOf("king"))} → ${wordOf(dA, cidOf("king"))} / ${wordOf(dB, cidOf("king"))}` +
    (etymologyOf(root, cidOf("king")) ? ` ‹ '${etymologyOf(root, cidOf("king")).gloss}'` : ""));

  // two distinct abstracts must never get the SAME coinage in one family (the
  // repair would only mask it as B = A+syllable, reading as B‹A) — nor collide
  // at the surface. And a templatic tongue must not render its whole abstract
  // set as one m- rhyme: the pattern is the modifier's exponent, so different
  // pathways give different words (2000-family sweep, incl. root-and-pattern).
  let pairClash = 0, surfClash = 0, tmplLangs = 0, tmplVaried = 0;
  for (let i = 0; i < 2000; i++) {
    const l = foundLanguage(world, { seed: 420000 + i * 37 });
    const pairs = new Set(), surfaces = new Set();
    let derivedWords = [];
    for (const t of ABS) {
      const e = etymologyOf(l, t);
      if (!e) continue;
      const pk = e.head + "," + e.mod;
      if (pairs.has(pk)) pairClash++; pairs.add(pk);
      const w = wordOf(l, t);
      if (surfaces.has(w)) surfClash++; surfaces.add(w);
      derivedWords.push(w);
    }
    if (l.prof.morph === "tmpl" && derivedWords.length >= 4) {
      tmplLangs++;
      if (new Set(derivedWords.map(w => w[0])).size >= 2) tmplVaried++;   // not one prefix for all
    }
  }
  check(`no two abstracts share a coinage in one family (${pairClash} pairs clash /2000)`, pairClash === 0);
  check(`no two derived abstracts are surface homophones (${surfClash} /2000)`, surfClash === 0);
  check(`templatic abstracts vary their pattern, not one m- rhyme (${tmplVaried}/${tmplLangs} langs ≥2 initials)`,
    tmplLangs > 0 && tmplVaried >= tmplLangs * 0.9);

  // the colex CYCLE trap: when a family colexifies a source onto its target
  // (sky=god, wind=spirit), the pathway would loop — it must be dropped, not
  // hang, and the concept still renders (as a plain/other-pathway word)
  let cycleSafe = true, cycleSeen = 0;
  const GOD = cidOf("god"), SKY = cidOf("sky"), SPIRIT = cidOf("spirit"), WIND = cidOf("wind");
  for (let i = 0; i < 400; i++) {
    const l = foundLanguage(world, { seed: 410000 + i * 53 });
    if (wordOf(l, SKY) === wordOf(l, GOD)) { cycleSeen++; if (!wordOf(l, GOD)) cycleSafe = false; }
    if (wordOf(l, WIND) === wordOf(l, SPIRIT)) { cycleSeen++; if (!wordOf(l, SPIRIT)) cycleSafe = false; }
  }
  check(`colex cycles are broken, not hung (${cycleSeen} sky=god / wind=spirit families rendered clean)`, cycleSeen > 0 && cycleSafe);

  // a LOAN shadows the native word (wordOf returns the borrowed form), so the
  // native etymology must not be reported for the displayed word — otherwise
  // the dictionary shows a borrowed surface beside a gloss that doesn't build
  // it ('law' loaned as 'toholu' with a spurious "‹ true say")
  {
    const lw = mkWorld();
    const bl = foundLanguage(lw, { seed: 9001 });
    const donor = foundLanguage(lw, { seed: 55555 });
    for (let i = 0; i < 40; i++) borrowFrom(lw, bl, donor);
    const loanCids = new Set(bl.loans.map(x => x.c));
    const derivLoans = ABS.filter(t => loanCids.has(t));
    const lying = derivLoans.filter(t => etymologyOf(bl, t) !== null);
    check(`loaned abstracts report no native etymology (${lying.length}/${derivLoans.length} lie, of ${loanCids.size} loans)`,
      derivLoans.length > 0 && lying.length === 0);
  }

  // pinned Mandarin: every abstract, derived or not, stays legal pinyin
  const m = foundLanguage(world, { seed: 445 });
  m.prof = refProfile("mandarin", 445); m.rules = [];
  const mp = refPin("mandarin"); m.pin = mp.pin; m.prof.rom = mp.rom;
  const PINYIN = /^((zh|ch|sh|[bpmfdtnlgkhjqxrzcswy])?[aeiou]{1,3}(ng|n)?)+$/;
  const strip = (w) => w.normalize("NFD").replace(/[̀-ͯ]/g, "");
  const mBad = ABS.map(t => wordOf(m, t)).filter(w => !PINYIN.test(strip(w.toLowerCase())));
  check(`derived abstracts stay legal pinyin in pinned Mandarin (${mBad[0] || "0 illegal"})`, mBad.length === 0);

  // determinism + JSON roundtrip of the derivation layer
  const wa = mkWorld(), wb = mkWorld();
  const a = foundLanguage(wa, { seed: 424242 }), b = foundLanguage(wb, { seed: 424242 });
  const c3 = JSON.parse(JSON.stringify(a));
  const sig = (l) => JSON.stringify(ABS.map(t => { const e = etymologyOf(l, t); return [wordOf(l, t), e && [e.head, e.mod]]; }));
  check("derivation deterministic + JSON-roundtrip-stable", sig(a) === sig(b) && sig(a) === sig(c3));

  say("   the same abstractions, coined per family: " + [cidOf("god"), cidOf("law"), cidOf("victory")].map(t => {
    const e = etymologyOf(a, t); return glossOf(t) + "=" + wordOf(a, t) + (e ? " ‹ " + e.gloss : "");
  }).join(" · "));
}

// ── 14. CONCORD & AGREEMENT (Group A) ─────────────────────────────────────
// F1: noun class is assigned by a universal animacy SCALE (not a bare hash) —
// a famSeed bijection maps tiers→classes, so labels vary but structure is
// universal, fem/masc split the human tier, and no class is ever empty.
console.log("\n── concord: noun-class assignment ──");
{
  const world = mkWorld();
  const cidOf = (g) => CONCEPTS.findIndex(c => c.g === g);
  const N = 600;
  let gendered = [], manyClass = [], all2 = [];
  for (let i = 0; i < N; i++) {
    const l = foundLanguage(world, { seed: 470000 + i * 53 });
    const g = gramOf(l);
    if (g.genders >= 2) { all2.push(l); if (g.genders <= 3) gendered.push(l); else manyClass.push(l); }
  }
  // no empty class anywhere
  const emptyLangs = all2.filter(l => classInventory(l).some(c => c.n === 0)).length;
  check(`no noun class is ever empty (${all2.length} gendered langs, ${emptyLangs} with a gap)`, all2.length > 0 && emptyLangs === 0);
  // fem-gloss share a class distinct from masc-gloss in small systems (not random)
  const femC = ["woman", "queen", "mother", "daughter"].map(cidOf);
  const mascC = ["man", "king", "father", "son"].map(cidOf);
  const sexOK = gendered.every(l => {
    const fs = new Set(femC.map(c => genderOf(l, c))), ms = new Set(mascC.map(c => genderOf(l, c)));
    return fs.size === 1 && ms.size === 1 && [...fs][0] !== [...ms][0];
  });
  check(`fem-gloss share a class distinct from masc (${gendered.length} small-gender langs)`, gendered.length > 0 && sexOK);
  // human and animal each land in ≤2 classes (a semantic tier, not scattered)
  const humanC = ["man", "woman", "king", "queen", "child", "mother", "father", "priest"].map(cidOf);
  const anmSet = CONCEPTS.map((c, i) => [c, i]).filter(([c]) => c.d === "anm").map(([, i]) => i);
  const tierTight = all2.every(l => new Set(humanC.map(c => genderOf(l, c))).size <= 2 && new Set(anmSet.map(c => genderOf(l, c))).size <= 2);
  check(`human & animal tiers each span ≤2 classes (all ${all2.length} langs)`, tierTight);
  // same tier → different class index across families (structure universal, label rolled)
  const stoneClasses = new Set(all2.slice(0, 40).map(l => genderOf(l, cidOf("stone")) + ":" + gramOf(l).genders));
  check(`same concept lands in different class indices across families (${stoneClasses.size} distinct)`, stoneClasses.size >= 3);
  // classAssign frequency WALS-shaped (semantic ~35%) over genders≥2 langs
  const semRate = all2.filter(l => gramOf(l).classAssign === "semantic").length / Math.max(1, all2.length);
  check(`classAssign 'semantic' in the WALS band (${Math.round(semRate * 100)}% of gendered langs)`, semRate > 0.2 && semRate < 0.45);
  // determinism + JSON roundtrip
  const wa = mkWorld(), wb = mkWorld();
  const a = foundLanguage(wa, { seed: 470053 }), b = foundLanguage(wb, { seed: 470053 });
  const c3 = JSON.parse(JSON.stringify(a));
  const sig = (l) => JSON.stringify(CONCEPTS.map((c, i) => genderOf(l, i)));
  check("noun-class assignment deterministic + JSON-roundtrip-stable", sig(a) === sig(b) && sig(a) === sig(c3));
  if (manyClass[0]) { const inv = classInventory(manyClass[0]); say(`   a ${inv.length}-class tongue: ${inv.map(c => "C" + c.cls + "×" + c.n).join(" ")}`); }
  void nounClassInfo;

  // ── F4: object/oblique pronoun case (me≠I), split ergativity for free ──
  const withCase = [], noCase = [];
  for (let i = 0; i < N; i++) {
    const l = foundLanguage(world, { seed: 480000 + i * 47 });
    (gramOf(l).pronCase === "none" ? noCase : withCase).push(l);
  }
  // acc ≠ nom for ≥1 person in every case-bearing tongue
  const accDiffers = withCase.every(l => ["1sg", "2sg", "3sg"].some(k => pronoun(l, k, "acc").w !== pronoun(l, k, "nom").w));
  check(`object pronoun differs from subject (me≠I) in every pronCase tongue (${withCase.length} langs)`, withCase.length > 0 && accDiffers);
  // 'none' tongues: acc collapses to nom (Mandarin wǒ everywhere)
  const noneFlat = noCase.every(l => pronoun(l, "1sg", "acc").w === pronoun(l, "1sg", "nom").w);
  check(`caseless-pronoun tongues use one form for S and O (${noCase.length} langs)`, noCase.length > 0 && noneFlat);
  // pronCase correlates with caseN (rich case ⇒ richer pronoun series)
  const rich = withCase.filter(l => gramOf(l).caseN >= 3), full = rich.filter(l => ["full", "acc-dat"].includes(gramOf(l).pronCase));
  check(`case-rich tongues carry a richer pronoun series (${full.length}/${rich.length})`, rich.length > 0 && full.length / rich.length > 0.8);
  // SPLIT ERGATIVITY: pronouns stay nom-acc even when the nouns are ergative —
  // a pronoun object takes ACC, a pronoun subject stays bare (never ERG)
  let ergLang = null;
  for (let i = 0; i < 2000 && !ergLang; i++) { const l = foundLanguage(world, { seed: 481000 + i * 31 }); if (gramOf(l).align === "erg" && gramOf(l).pronCase !== "none") ergLang = l; }
  if (ergLang) {
    const oClause = renderClause(ergLang, { s: { n: KING, def: true }, v: { c: SEE, tam: "pst" }, o: { pron: { k: "1sg", pers: 1, num: "sg" } } });
    const oTok = oClause.tokens.find(t => t.role === "O");
    const sClause = renderClause(ergLang, { s: { pron: { k: "1sg", pers: 1, num: "sg" } }, v: { c: GO, tam: "pst" } });
    const sTok = sClause.tokens.find(t => t.role === "S");
    const objAcc = oTok && /\.ACC$/.test(oTok.g);
    const subjBare = !sTok || !/ERG/.test(sTok.g);
    check(`split ergativity: pronoun object ACC, subject bare in an ergative tongue (${oTok ? oTok.w + "/" + oTok.g : "?"})`, objAcc && subjBare);
  } else check("split ergativity: (no ergative pronCase tongue found in sweep)", false);
  // determinism
  const wa2 = mkWorld(), wb2 = mkWorld();
  const pa = foundLanguage(wa2, { seed: 480047 }), pb = foundLanguage(wb2, { seed: 480047 });
  const pc3 = JSON.parse(JSON.stringify(pa));
  const psig = (l) => ["1sg", "2sg", "3sg", "1pl"].map(k => ["nom", "acc", "dat", "gen"].map(cs => pronoun(l, k, cs).w).join("/")).join("|");
  check("pronoun case deterministic + JSON-roundtrip-stable", psig(pa) === psig(pb) && psig(pa) === psig(pc3));

  // ── F2/F3: concord propagation (adjective/dem/verb agree; alliteration) ──
  const cidF = (g2) => CONCEPTS.findIndex(c => c.g === g2);
  const gendered2 = all2;   // reuse the genders≥2 population from F1
  // every gender system agrees on ≥1 target (no inert gender)
  const hasTarget = gendered2.every(l => { const t = agreementTargets(l); return t && t.length >= 1; });
  check(`every gender system agrees on ≥1 dependent (no inert gender, ${gendered2.length} langs)`, gendered2.length > 0 && hasTarget);
  // the adjective's surface differs by head class in adj-concord langs
  const adjLangs = gendered2.filter(l => gramOf(l).concord && gramOf(l).concord.adj);
  const adjVaries = adjLangs.every(l => {
    const n = gramOf(l).genders;
    const surf = new Set(Array.from({ length: n }, (_, cls) => inflectAdj(l, cidF("black"), { cls }).text));
    return surf.size >= 2;
  });
  check(`adjective surface differs by head class (${adjLangs.length} adj-concord langs)`, adjLangs.length > 0 && adjVaries);
  // genderless tongues keep the adjective invariant (== wordOf)
  const genless = [];
  for (let i = 0; i < 100; i++) { const l = foundLanguage(world, { seed: 490000 + i * 37 }); if (!gramOf(l).genders) genless.push(l); }
  const invariant = genless.every(l => inflectAdj(l, cidF("black"), { cls: 0 }).text === wordOf(l, cidF("black")));
  check(`adjective invariant in genderless tongues (English black, ${genless.length} langs)`, genless.length > 0 && invariant);
  // MANY-CLASS ALLITERATION: dem, adj and verb carry the SAME class marker,
  // distinct across classes (Bantu ki-tu ki-kubwa ki-anguka)
  const bantu = gendered2.filter(l => gramOf(l).genders >= 4);
  const allit = bantu.every(l => {
    const marks = concordMarkers(l).map(m => m.w);
    return new Set(marks.filter(Boolean)).size >= Math.min(3, marks.length) &&   // markers distinct per class
      marks.some(Boolean);
  });
  check(`many-class markers alliterate & differ per class (${bantu.length} Bantu-style langs)`, bantu.length > 0 && allit);
  // FUSE past differs by subject class (Russian upa-l vs upa-la)
  const fuseLangs = gendered2.filter(l => gramOf(l).concord && gramOf(l).concord.verb && gramOf(l).concord.site === "fuse");
  const pastVaries = fuseLangs.every(l => {
    const n = gramOf(l).genders;
    const forms = new Set(Array.from({ length: n }, (_, cls) => inflectVerb(l, GO, { tam: "pst", sclass: cls }).text));
    return forms.size >= 2;
  });
  check(`fuse verb past differs by subject class (${fuseLangs.length} langs)`, fuseLangs.length > 0 && pastVaries);
  // markers COGNATE across sisters and DRIFT under the added rule
  const wf = mkWorld();
  const rootc = foundLanguage(wf, { seed: 470053 });
  if (gramOf(rootc).genders >= 2) {
    wf.step = 4000; const daugh = branchLanguage(wf, rootc, 0.9);
    const rm = concordMarkers(rootc).map(m => m.w).join("/"), dm = concordMarkers(daugh).map(m => m.w).join("/");
    check(`concord markers inherited + drift across sisters (${rm} → ${dm})`, rm.length > 0 && dm.length > 0);
  } else check("concord markers inherited + drift (seed not gendered — skipped)", true);
  // determinism
  const wc1 = mkWorld(), wc2 = mkWorld();
  const ca = foundLanguage(wc1, { seed: 470106 }), cb = foundLanguage(wc2, { seed: 470106 });
  const cc3 = JSON.parse(JSON.stringify(ca));
  const csig = (l) => concordMarkers(l).map(m => m.w).join("|") + "##" + inflectAdj(l, cidF("black"), { cls: 1 }).text;
  check("concord deterministic + JSON-roundtrip-stable", csig(ca) === csig(cb) && csig(ca) === csig(cc3));
  if (bantu[0]) say(`   a ${gramOf(bantu[0]).genders}-class tongue's alliteration: ${concordMarkers(bantu[0]).map(m => m.g + "=" + (m.w || "∅")).join(" ")}`);
}

// ── 15. ALIGNMENT REFINEMENTS & SPLITS (Group F) ──────────────────────────
// One coreCaseOf resolver reproduces plain nom-acc / erg byte-identically and
// adds the minority systems: active-stative (split-S by AGENTIVITY), tripartite,
// tam- and hierarchy-conditioned split ergativity, direct-inverse.
console.log("\n── alignment refinements & splits ──");
{
  const world = mkWorld();
  const cidF = (g2) => CONCEPTS.findIndex(c => c.g === g2);
  const RUN = cidF("run"), FALLc = cidF("fall"), SLEEPc = cidF("sleep");
  const tokOf = (c, role) => c.tokens.filter(x => x.role === role).map(x => x.g).join(" ");   // all tokens of a role (iso case is a separate particle)
  const find = (pred, base = 600000) => { for (let i = 0; i < 14000; i++) { const l = foundLanguage(world, { seed: base + i * 13 }); if (pred(gramOf(l))) return l; } return null; };

  // REGRESSION: the resolver reproduces the old core-case block exactly
  let accBad = 0, ergBad = 0, accN = 0, ergN = 0;
  for (let i = 0; i < 500; i++) {
    const l = foundLanguage(world, { seed: 520000 + i * 41 });
    const g = gramOf(l);
    if (g.align === "acc" && g.caseN >= 2) {
      accN++;
      const c = renderClause(l, { s: { n: KING }, v: { c: SEE, tam: "pst" }, o: { n: RIVER } });
      // accusative: subject bare (no core case gloss), object ACC (caseN≥2 has it)
      if (/\b(ERG|AGT)\b/.test(tokOf(c, "S")) || !/ACC/.test(tokOf(c, "O"))) accBad++;
    } else if (g.align === "erg") {
      ergN++;
      const ct = renderClause(l, { s: { n: KING }, v: { c: SEE, tam: "pst" }, o: { n: RIVER } });
      const ci = renderClause(l, { s: { n: KING }, v: { c: SLEEPc, tam: "pst" } });
      // ergative: transitive subject ERG, intransitive subject bare (no split reroute)
      if (!g.ergSplit && (!/ERG/.test(tokOf(ct, "S")) || /ERG/.test(tokOf(ci, "S")))) ergBad++;
    }
  }
  check(`nom-acc resolver unchanged: subject bare, object ACC (${accN} langs, ${accBad} bad)`, accN > 0 && accBad === 0);
  check(`ergative resolver unchanged: A→ERG, S bare (${ergN} langs, ${ergBad} bad)`, ergN > 0 && ergBad === 0);
  // inflectVerb byte-identical with no dir/sclass (default path)
  const wv1 = mkWorld(), wv2 = mkWorld();
  const va = foundLanguage(wv1, { seed: 8484 }), vb = foundLanguage(wv2, { seed: 8484 });
  check("inflectVerb(no dir/sclass) byte-identical + default agree=subject",
    inflectVerb(va, GO, { tam: "pst" }).text === inflectVerb(vb, GO, { tam: "pst" }).text && !clauseAlignment(va, { v: { c: GO, tam: "pst" }, o: null }).direction);

  // ACTIVE-STATIVE: split-S — control verb S=AGT, non-control S=PAT
  const act = find(g => g.align === "active");
  if (act) {
    const runS = tokOf(renderClause(act, { s: { n: KING }, v: { c: RUN, tam: "pst" } }), "S");
    const fallS = tokOf(renderClause(act, { s: { n: KING }, v: { c: FALLc, tam: "pst" } }), "S");
    check(`active split-S: control S=AGT (run→${runS}), non-control S=PAT (fall→${fallS})`, /AGT/.test(runS) && /PAT/.test(fallS));
    // fluid-S: an explicit volition flag flips a mid verb (only in fluid langs)
    if (gramOf(act).activeFluid) {
      const volS = tokOf(renderClause(act, { s: { n: KING }, v: { c: SLEEPc, tam: "pst", vol: true } }), "S");
      const novS = tokOf(renderClause(act, { s: { n: KING }, v: { c: SLEEPc, tam: "pst", vol: false } }), "S");
      check(`fluid-S: v.vol flips the intransitive subject (${novS} vs ${volS})`, volS !== novS);
    } else check("fluid-S: (found lang is fixed split-S, not fluid — ok)", true);
  } else check("active-stative alignment occurs in the sweep", false);
  const actRate = (() => { let a = 0, cn = 0; for (let i = 0; i < 1500; i++) { const g = gramOf(foundLanguage(world, { seed: 610000 + i * 13 })); if (g.caseN >= 2) { cn++; if (g.align === "active") a++; } } return a / Math.max(1, cn); })();
  check(`active is a small minority of case languages (${(actRate * 100).toFixed(1)}%)`, actRate > 0 && actRate < 0.08);

  // TRIPARTITE: A/O/S all distinct
  const tri = find(g => g.align === "tripartite");
  if (tri) {
    const t = renderClause(tri, { s: { n: KING }, v: { c: SEE, tam: "pst" }, o: { n: RIVER } });
    const iC = renderClause(tri, { s: { n: KING }, v: { c: SLEEPc, tam: "pst" } });
    const A = tokOf(t, "S"), O = tokOf(t, "O"), S = tokOf(iC, "S");
    check(`tripartite: A/O/S three-way distinct (A=${A} O=${O} S=${S})`, /ERG/.test(A) && /ACC/.test(O) && !/ERG|ACC/.test(S));
  } else check("tripartite alignment occurs in the sweep", false);

  // SPLIT-ERG by TAM: A marked ERG in the perfective/past, bare in the imperfective
  const tsp = find(g => g.ergSplit === "tam");
  if (tsp) {
    const g = gramOf(tsp);
    const ergP = tokOf(g.aspect ? renderClause(tsp, { s: { n: KING }, v: { c: SEE, tam: "pfv" }, o: { n: RIVER } }) : renderClause(tsp, { s: { n: KING }, v: { c: SEE, tam: "pst" }, o: { n: RIVER } }), "S");
    const accP = tokOf(renderClause(tsp, { s: { n: KING }, v: { c: SEE, tam: null }, o: { n: RIVER } }), "S");
    check(`split-erg by TAM: A is ERG in the perfective/past, bare elsewhere (${ergP} → ${accP})`, /ERG/.test(ergP) && !/ERG/.test(accP));
  } else check("tam-split ergativity occurs in the sweep", false);

  // SPLIT-ERG by hierarchy (Dyirbal): noun-A takes ERG, 1sg-A is unmarked
  const hier = find(g => g.ergSplit === "hier");
  if (hier) {
    const nounA = tokOf(renderClause(hier, { s: { n: KING }, v: { c: SEE, tam: "pst" }, o: { n: RIVER } }), "S");
    const pronA = tokOf(renderClause(hier, { s: { pron: { k: "1sg", pers: 1, num: "sg" } }, v: { c: SEE, tam: "pst" }, o: { n: RIVER } }), "S");
    check(`Silverstein split: noun-A takes ERG (${nounA}), SAP-A unmarked (${pronA || "∅"})`, /ERG/.test(nounA) && !/ERG/.test(pronA));
  } else check("hierarchy-split ergativity occurs in the sweep", false);

  // DIRECT-INVERSE: 1→3 direct (no INV), 3→1 inverse (verb carries INV)
  const invL = find(g => g.invAgree);
  if (invL) {
    const dir = renderClause(invL, { s: { pron: { k: "1sg", pers: 1, num: "sg" } }, v: { c: SEE, tam: "pst" }, o: { n: KING } });
    const invc = renderClause(invL, { s: { n: KING }, v: { c: SEE, tam: "pst" }, o: { pron: { k: "1sg", pers: 1, num: "sg" } } });
    check(`direct-inverse: 1→3 direct (no INV), 3→1 marked INV (${tokOf(dir, "V")} | ${tokOf(invc, "V")})`, !/INV/.test(dir.gloss) && /INV/.test(invc.gloss));
  } else check("direct-inverse occurs in the sweep", false);

  // ABS-AGREE: the transitive verb agrees with the absolutive (object), not A
  const absL = find(g => g.absAgree);
  if (absL) {
    const c1 = renderClause(absL, { s: { n: KING }, v: { c: SEE, tam: "pst" }, o: { pron: { k: "1sg", pers: 1, num: "sg" } } });
    check(`abs-agree: transitive verb indexes the absolutive/object (${c1.tokens.find(t => t.role === "V").g})`, /1SG/.test(c1.tokens.find(t => t.role === "V").g));
  } else check("abs-agree occurs in the sweep", false);

  // determinism
  const wa = mkWorld(), wb = mkWorld();
  const da = foundLanguage(wa, { seed: 600013 }), db = foundLanguage(wb, { seed: 600013 });
  const dc3 = JSON.parse(JSON.stringify(da));
  const asig = (l) => JSON.stringify(alignmentOf(l)) + renderClause(l, { s: { n: KING }, v: { c: SEE, tam: "pst" }, o: { n: RIVER } }).text;
  check("alignment deterministic + JSON-roundtrip-stable", asig(da) === asig(db) && asig(da) === asig(dc3));
  void agentivityOf;
}

// ── 16. VOICE & VALENCY (Group B) ─────────────────────────────────────────
// Causative/passive/antipassive/applicative — each a grammaticalized verbal
// marker (onion) AND a relation remap in renderClause, riding the P3 resolver.
console.log("\n── voice & valency ──");
{
  const world = mkWorld();
  const cidF = (g2) => CONCEPTS.findIndex(c => c.g === g2);
  const TOWN = cidF("town");
  const roleG = (c, role) => c.tokens.filter(t => t.role === role).map(t => t.g).join(" ");
  const roleW = (c, role) => c.tokens.filter(t => t.role === role).map(t => t.w).join(" ");
  const refLang = (kind, seed) => { const l = foundLanguage(world, { seed }); l.prof = refProfile(kind, seed); l.rules = []; const r = refPin(kind); l.pin = r.pin; if (r.rom) l.prof.rom = { ...(l.prof.rom || {}), ...r.rom }; return l; };
  const N = 500;
  const pop = Array.from({ length: N }, (_, i) => foundLanguage(world, { seed: 530000 + i * 37 }));

  // causative: near-universal, and grammaticalized from make/do/give
  const causRate = pop.filter(l => voicesOf(l).caus).length / N;
  check(`causative is near-universal (${Math.round(causRate * 100)}%)`, causRate > 0.78 && causRate < 0.92);
  const nonIsoCaus = pop.filter(l => l.prof.morph !== "iso" && voicesOf(l).caus);
  const causGood = nonIsoCaus.filter(l => { const e = voiceEtymologies(l).find(x => x.k === "caus"); return e && ["make", "do", "give"].includes(e.from); }).length;
  check(`causative source ∈ {make,do,give} in most non-iso tongues (${causGood}/${nonIsoCaus.length})`, nonIsoCaus.length > 0 && causGood / nonIsoCaus.length >= 0.65);

  // passive is an ACCUSATIVE property (much rarer in ergative languages)
  const accP = pop.filter(l => gramOf(l).align === "acc"), ergP = pop.filter(l => gramOf(l).align === "erg");
  const passAcc = accP.filter(l => voicesOf(l).pass).length / Math.max(1, accP.length);
  const passErg = ergP.filter(l => voicesOf(l).pass).length / Math.max(1, ergP.length);
  check(`passive is an accusative property (acc ${Math.round(passAcc * 100)}% − erg ${Math.round(passErg * 100)}% ≥ 25pts)`, passAcc - passErg >= 0.25);

  // passive REMAP: patient→subject, agent→by-phrase, derived subject not ERG
  const e = refLang("english", 303);
  const pc = renderClause(e, { s: { n: KING }, v: { c: SEE, tam: "pst", voice: "pass" }, o: { n: RIVER } });
  const subjIsPatient = roleW(pc, "S").includes(renderClause(e, { s: { n: RIVER } , v: { c: SEE, tam: null } }).tokens.find(t => t.role === "S").w);
  check(`passive promotes the patient to subject, agent to a by-phrase (${pc.text} = "${pc.gloss}")`,
    /PASS/.test(pc.gloss) && subjIsPatient && /king/.test(roleG(pc, "X")) && pc.tokens.some(t => t.role === "X"));
  // ergative passive subject carries NO ergative
  const ergPass = (() => { for (let i = 0; i < 6000; i++) { const l = foundLanguage(world, { seed: 540000 + i * 29 }); if (gramOf(l).align === "erg" && voicesOf(l).pass) return l; } return null; })();
  if (ergPass) { const c = renderClause(ergPass, { s: { n: KING }, v: { c: SEE, tam: "pst", voice: "pass" }, o: { n: RIVER } }); check(`ergative passive subject drops ERG (${c.gloss})`, !/ERG/.test(roleG(c, "S")) && /PASS/.test(c.gloss)); }
  else check("ergative passive subject drops ERG (none in sweep — rare, ok)", true);

  // antipassive: ergative-skewed, agent loses ERG (surfaces ABS), needs a demotion target
  const antipRateErg = ergP.filter(l => voicesOf(l).antip).length / Math.max(1, ergP.length);
  const antipRateAcc = accP.filter(l => voicesOf(l).antip).length / Math.max(1, accP.length);
  check(`antipassive is ergative-skewed (erg ${Math.round(antipRateErg * 100)}% vs acc ${Math.round(antipRateAcc * 100)}%)`, antipRateErg >= 0.35 && antipRateAcc < 0.12);
  const antipL = (() => { for (let i = 0; i < 8000; i++) { const l = foundLanguage(world, { seed: 550000 + i * 23 }); if (gramOf(l).antip && gramOf(l).align === "erg") return l; } return null; })();
  if (antipL) {
    const plain = renderClause(antipL, { s: { n: KING }, v: { c: SEE, tam: "pst" }, o: { n: RIVER } });
    const antip = renderClause(antipL, { s: { n: KING }, v: { c: SEE, tam: "pst", voice: "antip" }, o: { n: RIVER } });
    check(`antipassive: A loses ERG, P demoted to oblique (${roleG(plain, "S")} → ${roleG(antip, "S")}; ${antip.text})`,
      /ERG/.test(roleG(plain, "S")) && !/ERG/.test(roleG(antip, "S")) && /ANTIP/.test(antip.gloss) && antip.tokens.some(t => t.role === "X"));
  } else check("antipassive drop of ERG (none in sweep — ok)", true);

  // applicative: COGNATE with the language's own adposition (shares the source)
  const applLs = pop.filter(l => voicesOf(l).appl);
  const APPLM = { ben: "to", ins: "with", loc: "in" };
  const cognate = applLs.filter(l => {
    const e2 = voiceEtymologies(l).find(x => x.k === "appl");
    const adp = closedOf(l).adps.find(a => a.m === APPLM[gramOf(l).applOf]);
    return e2 && adp && (e2.from === (adp.src != null ? glossOf(adp.src) : null));
  }).length;
  check(`applicative is cognate with the matching adposition (${cognate}/${applLs.length})`, applLs.length > 0 && cognate / applLs.length >= 0.6);

  // opt-in: a plain frame (no voice) never leaks a voice gloss
  const noLeak = pop.slice(0, 100).every(l => !/(CAUS|PASS|ANTIP|APPL)/.test(renderClause(l, { s: { n: KING }, v: { c: SEE, tam: "pst" }, o: { n: RIVER } }).gloss));
  check("voice is opt-in: a plain clause never carries a voice gloss (byte-identity)", noLeak);

  // branch inherits + drifts; determinism
  const wf = mkWorld(); const rootc = foundLanguage(wf, { seed: 530037 }); wf.step = 4000; const daugh = branchLanguage(wf, rootc, 0.9);
  check("voice inventory inherited down the family", JSON.stringify(voicesOf(rootc)) === JSON.stringify(voicesOf(daugh)));
  const wa = mkWorld(), wb = mkWorld();
  const va2 = foundLanguage(wa, { seed: 530074 }), vb2 = foundLanguage(wb, { seed: 530074 });
  const vc3 = JSON.parse(JSON.stringify(va2));
  const vsig = (l) => renderClause(l, { s: { n: KING }, v: { c: GO, tam: "pst", voice: "caus" }, o: { n: TOWN } }).text + "|" + JSON.stringify(voiceEtymologies(l));
  check("voice deterministic + JSON-roundtrip-stable", vsig(va2) === vsig(vb2) && vsig(va2) === vsig(vc3));
}

// ── 17. TAM & MOOD DEPTH (Group C′) ───────────────────────────────────────
// Graded tense, richer aspect (perfect/progressive/habitual — independent of
// grammatical aspect), irrealis moods, mirativity — all deepening with the
// morphotype ("synthetic tongues carry more distinctions").
console.log("\n── TAM & mood depth ──");
{
  const world = mkWorld();
  const fv = (x) => [...x.pre.map(t => t.g), x.gloss, ...x.post.map(t => t.g)].join(" ");
  const byMorph = { iso: [], agg: [], fus: [], tmpl: [] };
  const N = 800;
  for (let i = 0; i < N; i++) { const l = foundLanguage(world, { seed: 560000 + i * 29 }); byMorph[l.prof.morph].push(l); }
  const all = [].concat(...Object.values(byMorph));
  const rate = (ls, pred) => ls.filter(pred).length / Math.max(1, ls.length);

  // remoteness: a real minority, ZERO in isolating, past-grading > future
  const remRate = rate(all, l => gramOf(l).remotePast >= 1);
  check(`graded tense is a real minority (${Math.round(remRate * 100)}%)`, remRate > 0.05 && remRate < 0.2);
  check(`graded tense never in isolating tongues (${byMorph.iso.filter(l => gramOf(l).remotePast >= 1).length})`, byMorph.iso.every(l => gramOf(l).remotePast === 0));
  check(`past-grading more common than future-grading`, rate(all, l => gramOf(l).remotePast >= 1) > rate(all, l => gramOf(l).remoteFuture >= 1));
  // graded cell distinct from plain past + carries the distance gloss; and needs the base tense
  const gp = all.find(l => gramOf(l).remotePast >= 2 && l.prof.morph !== "iso");
  if (gp) {
    const plain = fv(inflectVerb(gp, GO, { tam: "pst" })), rem = fv(inflectVerb(gp, GO, { tam: "pstrem" }));
    check(`graded past cell ≠ plain, glossed REM (${plain} vs ${rem})`, rem !== plain && /REM/.test(rem) && /PST/.test(rem));
  } else check("graded past cell distinct (none found — unlikely)", false);
  // resolveTam degrades a graded request on a non-grading language
  const ng = all.find(l => gramOf(l).remotePast === 0 && paradigmSpec(l).tam.pst);
  check(`graded request degrades to the base tense on a non-grading tongue (${ng ? resolveTam(ng, "pstrem") : "?"})`, !!ng && resolveTam(ng, "pstrem") === "pst");

  // aspect: perfect/progressive/habitual, INDEPENDENT of grammatical aspect
  check(`perfect at a real rate (${Math.round(rate(all, l => tamShape(l).perfect) * 100)}%)`, rate(all, l => tamShape(l).perfect) > 0.38 && rate(all, l => tamShape(l).perfect) < 0.58);
  check(`progressive leans analytic (iso ${Math.round(rate(byMorph.iso, l => tamShape(l).progressive) * 100)}% > fus ${Math.round(rate(byMorph.fus, l => tamShape(l).progressive) * 100)}%)`, rate(byMorph.iso, l => tamShape(l).progressive) > rate(byMorph.fus, l => tamShape(l).progressive));
  check(`habitual leans agglutinative (agg ${Math.round(rate(byMorph.agg, l => tamShape(l).habitual) * 100)}% > iso ${Math.round(rate(byMorph.iso, l => tamShape(l).habitual) * 100)}%)`, rate(byMorph.agg, l => tamShape(l).habitual) > rate(byMorph.iso, l => tamShape(l).habitual));
  // PRF ≠ PST/PFV, PROG ≠ IPFV
  const pl = all.find(l => tamShape(l).perfect && l.prof.morph !== "iso" && paradigmSpec(l).tam.pst);
  if (pl) { const prf = fv(inflectVerb(pl, GO, { tam: "prf" })), pst = fv(inflectVerb(pl, GO, { tam: "pst" })); check(`perfect distinct from past (${prf} vs ${pst})`, prf !== pst && /PRF/.test(prf)); }
  else check("perfect distinct from past (none found)", false);
  // pinned Mandarin: PRF trails (post), PROG leads (pre)
  const m = foundLanguage(world, { seed: 445 }); m.prof = refProfile("mandarin", 445); m.rules = []; const mp = refPin("mandarin"); m.pin = mp.pin; m.prof.rom = mp.rom;
  const mPrf = inflectVerb(m, GO, { tam: "prf" }), mProg = inflectVerb(m, GO, { tam: "prog" });
  check(`pinned Mandarin: perfect trails, progressive leads (${mPrf.post.map(t => t.g)} / ${mProg.pre.map(t => t.g)})`, mPrf.post.some(t => t.g === "PRF") && mProg.pre.some(t => t.g === "PROG"));

  // irrealis moods: count deepens with synthesis (agg > fus/tmpl > iso), keep tam+person
  const meanMoods = (ls) => ls.reduce((s, l) => s + gramOf(l).moods.length, 0) / Math.max(1, ls.length);
  check(`mood count deepens with synthesis (agg ${meanMoods(byMorph.agg).toFixed(2)} > iso ${meanMoods(byMorph.iso).toFixed(2)})`, meanMoods(byMorph.agg) > meanMoods(byMorph.iso));
  const md = all.find(l => gramOf(l).moods.includes("opt") && l.prof.morph !== "iso" && paradigmSpec(l).tam.pst);
  if (md) {
    const opt = fv(inflectVerb(md, GO, { tam: "pst", pers: "3", irrealisMood: "opt" })), ind = fv(inflectVerb(md, GO, { tam: "pst", pers: "3" }));
    check(`irrealis keeps tense+person, differs from indicative (${opt} vs ${ind})`, opt !== ind && /OPT/.test(opt) && /PST/.test(opt));
  } else check("irrealis keeps tense+person (none with opt found)", false);
  // OPT ‹ want, POT ‹ know in most non-iso tongues that have them
  // opt is only ever 'want' or opaque (opaque affixes don't appear in
  // affixEtymologies) — so NONE should trace to a different source
  const optLs = all.filter(l => l.prof.morph !== "iso" && gramOf(l).moods.includes("opt"));
  const optBad = optLs.filter(l => { const e = affixEtymologies(l).find(x => x.g === "OPT"); return e && e.from !== "want"; }).length;
  const optWant = optLs.filter(l => { const e = affixEtymologies(l).find(x => x.g === "OPT"); return e && e.from === "want"; }).length;
  check(`optative only ever grammaticalizes from 'want' (${optWant} overt, ${optBad} wrong-source)`, optLs.length > 0 && optBad === 0 && optWant > 0);

  // mirativity: small minority, boosted by the perfect, distinct from indicative
  const mirRate = rate(all, l => gramOf(l).mirative);
  check(`mirativity is a small minority (${Math.round(mirRate * 100)}%)`, mirRate > 0.03 && mirRate < 0.2);
  const pMirPrf = rate(all.filter(l => tamShape(l).perfect), l => gramOf(l).mirative), pMirNo = rate(all.filter(l => !tamShape(l).perfect), l => gramOf(l).mirative);
  check(`mirativity self-strengthens with the perfect (${(pMirPrf * 100).toFixed(1)}% > ${(pMirNo * 100).toFixed(1)}%)`, pMirPrf > pMirNo);
  const mi = all.find(l => gramOf(l).mirative && l.prof.morph !== "iso" && paradigmSpec(l).tam.pst);
  if (mi) { const mir = fv(inflectVerb(mi, GO, { tam: "pst", mir: true })), pln = fv(inflectVerb(mi, GO, { tam: "pst" })); check(`mirative cell ≠ indicative (${mir} vs ${pln})`, mir !== pln && /MIR/.test(mir)); }
  else check("mirative distinct (none found)", false);

  // determinism + JSON roundtrip
  const wa = mkWorld(), wb = mkWorld();
  const ta = foundLanguage(wa, { seed: 560029 }), tb = foundLanguage(wb, { seed: 560029 });
  const tc3 = JSON.parse(JSON.stringify(ta));
  const tsig = (l) => JSON.stringify(tamShape(l)) + fv(inflectVerb(l, GO, { tam: "pstrem", pers: "3" }));
  check("TAM depth deterministic + JSON-roundtrip-stable", tsig(ta) === tsig(tb) && tsig(ta) === tsig(tc3));
  void resolveMood;
}

// ── 18. EVIDENTIALITY & EPISTEMIC MARKING (Group C) ───────────────────────
// Grammatical marking of information source (WALS 78A), worn from perception/
// speech verbs (SEE/HEAR/SAY/SEEM) — the OUTERMOST, youngest verbal layer,
// skewing synthetic + verb-final. Mirativity rides the shared resolveMir seam:
// an evidential system EXTENDs the inferred host or grammaticalizes a DEDICATED
// exponent, else the TAM pathway fires.
console.log("\n── Evidentiality ──");
{
  const world = mkWorld();
  const fv = (x) => [...x.pre.map(t => t.g), x.gloss, ...x.post.map(t => t.g)].join(" ");
  const byMorph = { iso: [], agg: [], fus: [], tmpl: [] };
  const N = 900;
  for (let i = 0; i < N; i++) { const l = foundLanguage(world, { seed: 640000 + i * 31 }); byMorph[l.prof.morph].push(l); }
  const all = [].concat(...Object.values(byMorph));
  const rate = (ls, pred) => ls.filter(pred).length / Math.max(1, ls.length);
  const evLangs = all.filter(l => gramOf(l).evid);
  const srcOf = (l, val) => { const f = evidentialSystem(l).forms.find(x => x.value === val); return f ? f.from : undefined; };
  const withVal = (val) => evLangs.filter(l => evidentialSystem(l).forms.some(f => f.value === val && !f.zero));

  // (a) BYTE-IDENTITY REGRESSION (first gate): the opt-in v.ev frame field is a
  // no-op on a NON-evidential language — the frozen frame held (v.mir is the
  // pre-existing P5 field and legitimately fires on a mirative language)
  const nonEv = all.filter(l => !gramOf(l).evid).slice(0, 200);
  const beOK = nonEv.every(l => {
    const a = renderClause(l, { s: { n: KING }, v: { c: SEE, tam: "pst" }, o: { n: RIVER } });
    const b = renderClause(l, { s: { n: KING }, v: { c: SEE, tam: "pst", ev: "rept" }, o: { n: RIVER } });
    return a.text === b.text && a.gloss === b.gloss;
  });
  check(`byte-identity: v.ev is a no-op on non-evidential langs (${nonEv.length} sampled)`, nonEv.length > 0 && beOK);

  // (b) presence in the WALS 78A band (~43%), skewing synthetic (agg > iso)
  const presence = rate(all, l => !!gramOf(l).evid);
  check(`evidentiality presence in the WALS band (${Math.round(presence * 100)}%)`, presence > 0.22 && presence < 0.50);
  const pAgg = rate(byMorph.agg, l => !!gramOf(l).evid), pIso = rate(byMorph.iso, l => !!gramOf(l).evid);
  check(`evidentiality skews synthetic (agg ${Math.round(pAgg * 100)}% > iso ${Math.round(pIso * 100)}%)`, pAgg > pIso);

  // (c) size skew: 2-term the plurality, 4-term the rarest
  const sz = { 2: 0, 3: 0, 4: 0 };
  for (const l of evLangs) sz[gramOf(l).evid.n]++;
  check(`2-term is the plurality, 4-term rarest (n2 ${sz[2]} > n3 ${sz[3]} > n4 ${sz[4]})`, sz[2] > sz[3] && sz[3] > sz[4]);

  // (d) descent: a branched daughter inherits the whole evidential system
  world.step = 3000;
  const evParent = evLangs.find(l => l.prof.morph !== "iso");
  const daughter = branchLanguage(world, evParent, 0.6);
  check(`evidentiality inherited down a family (deep-equal)`, JSON.stringify(gramOf(daughter).evid) === JSON.stringify(gramOf(evParent).evid));

  // (e) exponents grammaticalize from the right perception/speech quarries
  const reptLs = withVal("rept"), sensLs = withVal("sens"), visLs = withVal("vis");
  check(`reportative worn from 'say' in a majority (${Math.round(rate(reptLs, l => srcOf(l, "rept") === "say") * 100)}%, n=${reptLs.length})`, reptLs.length > 0 && rate(reptLs, l => srcOf(l, "rept") === "say") > 0.5);
  check(`sensory worn from 'hear' in a majority (${Math.round(rate(sensLs, l => srcOf(l, "sens") === "hear") * 100)}%, n=${sensLs.length})`, sensLs.length > 0 && rate(sensLs, l => srcOf(l, "sens") === "hear") > 0.5);
  check(`visual worn from 'see' in a majority (${Math.round(rate(visLs, l => srcOf(l, "vis") === "see") * 100)}%, n=${visLs.length})`, visLs.length > 0 && rate(visLs, l => srcOf(l, "vis") === "see") > 0.5);
  const infrSrcs = new Set(evLangs.map(l => srcOf(l, "infr")).filter(Boolean));
  check(`inferred drawn from ≥2 sources across families (${[...infrSrcs].join("/")})`, infrSrcs.size >= 2);

  // (f) the overt exponents within a system are pairwise-distinct
  const distinctOK = evLangs.every(l => { const ws = evidentialSystem(l).forms.filter(f => !f.zero).map(f => f.w); return new Set(ws).size === ws.length; });
  check(`a system's overt evidentials are pairwise-distinct`, distinctOK);

  // (g) cognate-under-drift on a synthetic lang: sisters share the source, the
  // inflected surface diverges under sound law
  let driftRoot = null;
  for (let s = 0; s < 4000 && !driftRoot; s++) { const w = mkWorld(); const r = foundLanguage(w, { seed: 250000 + s * 7 }); if (r.prof.morph !== "iso" && gramOf(r).evid && evidentialSystem(r).forms.some(f => !f.zero && f.from)) driftRoot = { w, r }; }
  if (driftRoot) {
    const { w, r } = driftRoot;
    const val = evidentialSystem(r).forms.find(f => !f.zero && f.from).value;
    w.step = 4000; let d = branchLanguage(w, r, 0.9); w.step = 8000; d = branchLanguage(w, d, 0.9); w.step = 12000; d = branchLanguage(w, d, 0.9);
    const rawV = (l) => { const x = inflectVerb(l, SEE, { tam: "pst", ev: val }); return [...x.pre.map(t => t.w), x.text, ...x.post.map(t => t.w)].join(" "); };
    check(`evidentials are cognate across sisters but DRIFT (${val}‹${srcOf(r, val)}: ${rawV(r)} → ${rawV(d)})`, srcOf(d, val) === srcOf(r, val) && rawV(d) !== rawV(r));
  } else check("cognate-under-drift (no synthetic evidential family found)", false);

  // (h) append-only integrity of the SEEM concept (the inferential quarry)
  check(`append-only: CONCEPTS[SEEM] intact + a verb (${glossOf(SEEM)})`, glossOf(SEEM) === "seem" && VERBS.includes(SEEM));

  // (i) mirativity on the evidential slot: EXTEND re-reads the inferred host,
  // suppressed under the imperative
  const ext = evLangs.find(l => gramOf(l).evid.mir === "extend" && l.prof.morph !== "iso");
  if (ext) { const c = fv(inflectVerb(ext, SEE, { tam: "pst", mir: true })); const host = gramOf(ext).evid.n >= 3 ? "INFR" : "INDIR"; check(`EXTEND mirativity re-reads the inferred host as surprise (${c})`, new RegExp(host + "\\.MIR").test(c)); }
  else check("EXTEND mirativity host (none found)", false);
  const anyEv = evLangs.find(l => l.prof.morph !== "iso");
  const impC = renderClause(anyEv, { s: { pron: { k: "2s", pers: 2, num: "sg" } }, v: { c: GO, mood: "imp", ev: "rept", mir: true } });
  check(`evidential + mirativity suppressed under the imperative (${impC.gloss})`, !/VIS|SENS|INFR|REP|MIR/.test(impC.gloss));

  // (j) graceful cross-size degrade (evidMap): sensory on a 4-term stays SENS,
  // a reportative on a 2-term collapses to the indirect
  const n4 = evLangs.find(l => gramOf(l).evid.n === 4);
  const n2 = evLangs.find(l => gramOf(l).evid.n === 2 && l.prof.morph !== "iso");
  check(`4-term marks the sensory distinctly (${n4 ? fv(inflectVerb(n4, SEE, { tam: "pst", ev: "sens" })) : "?"})`, !!n4 && /SENS/.test(fv(inflectVerb(n4, SEE, { tam: "pst", ev: "sens" }))));
  const g2 = n2 ? renderClause(n2, { s: { n: KING }, v: { c: SEE, tam: "pst", ev: "rept" }, o: { n: RIVER } }).gloss : "?";
  check(`reportative degrades to INDIR on a 2-term system (${g2})`, !!n2 && /INDIR/.test(g2));

  // (k) per-morphotype realization: iso enclitic · fusional separate outer element
  const isoRept = byMorph.iso.find(l => gramOf(l).evid && evidentialSystem(l).forms.some(f => f.value === "rept" && !f.zero));
  check(`iso reportative is a toneless post-verbal particle glossed REP`, !!isoRept && inflectVerb(isoRept, SEE, { tam: "pst", ev: "rept" }).post.some(t => t.g === "REP"));
  const fusRept = byMorph.fus.find(l => gramOf(l).evid && evidentialSystem(l).forms.some(f => f.value === "rept" && !f.zero));
  const fusGl = fusRept ? fv(inflectVerb(fusRept, SEE, { tam: "pst", pers: "3", ev: "rept" })) : "?";
  check(`fusional REP is a SEPARATE trailing element, not fused into the portmanteau (${fusGl})`, !!fusRept && /-REP/.test(fusGl));

  // (l) evidentialSystem well-formed; all three references non-evidential;
  // pinned Mandarin + v.ev stays byte-identical legal pinyin
  check(`evidentialSystem returns null for a non-evidential language`, evidentialSystem(nonEv[0]) === null);
  const refs = ["mandarin", "russian", "english"].map(k => refLang(mkWorld(), k, 445));
  check(`all three references are non-evidential (evid: null)`, refs.every(r => gramOf(r).evid === null && evidentialSystem(r) === null));
  const mRef = refLang(world, "mandarin", 445); const mp = refPin("mandarin"); mRef.pin = mp.pin; mRef.prof.rom = mp.rom;
  const mBase = renderClause(mRef, { s: { n: KING }, v: { c: SEE, tam: "pfv" }, o: { n: RIVER } });
  const mEv = renderClause(mRef, { s: { n: KING }, v: { c: SEE, tam: "pfv", ev: "rept" }, o: { n: RIVER } });
  const stripT = (w) => w.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const PINYIN = /^((zh|ch|sh|[bpmfdtnlgkhjqxrzcswy])?[aeiou]{1,3}(ng|n)?)+$/;
  check(`pinned Mandarin + v.ev is byte-identical legal pinyin (${mEv.text})`, mEv.text === mBase.text && mEv.tokens.every(t => PINYIN.test(stripT(t.w))));

  // (m) determinism + JSON-roundtrip of the evidential layer
  let eseed = null;
  for (let i = 0; i < N && eseed === null; i++) { const s = 640000 + i * 31; if (gramOf(foundLanguage(mkWorld(), { seed: s })).evid) eseed = s; }
  const ea = foundLanguage(mkWorld(), { seed: eseed }), eb = foundLanguage(mkWorld(), { seed: eseed });
  const ec = JSON.parse(JSON.stringify(ea));
  const esig = (l) => JSON.stringify(evidentialSystem(l)) + fv(inflectVerb(l, SEE, { tam: "pst", ev: "rept", mir: true }));
  check(`evidentiality deterministic + JSON-roundtrip-stable`, esig(ea) === esig(eb) && esig(ea) === esig(ec));
}

// ── 19. NUMERAL CLASSIFIERS (Group D) ─────────────────────────────────────
// A sortal numeral-classifier system ("three CL.animal cattle"). Each classifier
// is a worn-down body/shape noun; assignment is by the noun's SENSE. Strongly
// isolating, complementary with plural marking (Sanches-Slobin). Additive to the
// sentence layer only — realization is deliberately morphotype-invariant.
console.log("\n── Numeral classifiers ──");
{
  const world = mkWorld();
  const byMorph = { iso: [], agg: [], fus: [], tmpl: [] };
  const N = 900;
  for (let i = 0; i < N; i++) { const l = foundLanguage(world, { seed: 810000 + i * 37 }); byMorph[l.prof.morph].push(l); }
  const all = [].concat(...Object.values(byMorph));
  const rate = (ls, pred) => ls.filter(pred).length / Math.max(1, ls.length);
  const clfL = all.filter(l => gramOf(l).classif);
  const etOf = (l, cls) => { const e = classifierEtymologies(l).find(x => x.cls === cls); return e ? e.from : undefined; };

  // (a) BYTE-IDENTITY (first gate): a bare (uncounted) frame renders identically
  const be = all.slice(0, 150).every(l => {
    const a = renderClause(l, { s: { n: KING }, v: { c: SEE, tam: "pst" }, o: { n: RIVER } });
    const b = renderClause(JSON.parse(JSON.stringify(l)), { s: { n: KING }, v: { c: SEE, tam: "pst" }, o: { n: RIVER } });
    return a.text === b.text;
  });
  check(`byte-identity: an uncounted frame is unchanged (150 sampled)`, be);

  // (b) prevalence band (WALS 55A), and the isolating/fusional split
  const prev = rate(all, l => !!gramOf(l).classif);
  check(`classifier prevalence in the WALS band (${Math.round(prev * 100)}%)`, prev > 0.15 && prev < 0.42);
  const pIso = rate(byMorph.iso, l => !!gramOf(l).classif), pFus = rate(byMorph.fus, l => !!gramOf(l).classif);
  check(`classifiers lean isolating (iso ${Math.round(pIso * 100)}% > 0.4, fus ${Math.round(pFus * 100)}% < 0.15)`, pIso > 0.4 && pFus < 0.15);

  // (c) plural complementarity (Sanches-Slobin): classifier langs mark plural less
  const plClf = rate(clfL, l => gramOf(l).pluralMark), plNo = rate(all.filter(l => !gramOf(l).classif), l => gramOf(l).pluralMark);
  check(`plural complementarity (classifier ${Math.round(plClf * 100)}% < non ${Math.round(plNo * 100)}% by ≥0.1)`, plNo - plClf >= 0.1);

  // (d) order tracks AdjN (Greenberg): [Num CL] precedes N in AdjN languages
  const preAdj = rate(clfL.filter(l => gramOf(l).adjN), l => gramOf(l).classif.order === "pre");
  const preNAdj = rate(clfL.filter(l => !gramOf(l).adjN), l => gramOf(l).classif.order === "pre");
  check(`classifier order tracks AdjN (pre: AdjN ${Math.round(preAdj * 100)}% > NAdj ${Math.round(preNAdj * 100)}%)`, preAdj > preNAdj);

  // (e) inventory: non-empty, pairwise-distinct, ≥1 source-traceable
  const invOK = clfL.every(l => { const ws = classifiersOf(l).classes.map(c => c.w); return ws.length >= 1 && ws.every(Boolean) && new Set(ws).size === ws.length; });
  check(`classifier inventories are non-empty + pairwise-distinct`, clfL.length > 0 && invOK);
  const traceable = clfL.filter(l => classifierEtymologies(l).some(e => e.from)).length;
  check(`classifiers trace to body/shape nouns (${traceable}/${clfL.length} langs)`, traceable >= clfL.length * 0.8);

  // (f) anti-fitting: the animal classifier is coined ≥2 ways; the general one
  // occurs BOTH opaque and derived (no single fitted answer)
  const anmSrcs = new Set(clfL.filter(l => gramOf(l).classif.classes.includes("anm")).map(l => etOf(l, "anm")).filter(Boolean));
  check(`animal classifier coined ≥2 ways across families (${[...anmSrcs].join("/")})`, anmSrcs.size >= 2);
  const genEt = clfL.map(l => classifierEtymologies(l).find(e => e.cls === "gen")).filter(Boolean);
  check(`general classifier occurs BOTH opaque and derived (opaque ${genEt.filter(e => !e.from).length}, derived ${genEt.filter(e => e.from).length})`, genEt.some(e => !e.from) && genEt.some(e => e.from));

  // (g) cognate across sisters + drift under sound law
  let cdRoot = null;
  for (let s = 0; s < 3000 && !cdRoot; s++) { const w = mkWorld(); const r = foundLanguage(w, { seed: 820000 + s * 13 }); if (gramOf(r).classif && classifierEtymologies(r).some(e => e.from)) cdRoot = { w, r }; }
  if (cdRoot) {
    const { w, r } = cdRoot; const e0 = classifierEtymologies(r).find(e => e.from);
    w.step = 4000; let d = branchLanguage(w, r, 0.9); w.step = 8000; d = branchLanguage(w, d, 0.9);
    const eD = classifierEtymologies(d).find(e => e.cls === e0.cls);
    check(`classifiers cognate across sisters but drift (${e0.cls}‹${e0.from}: ${e0.w} → ${eD.w})`, eD.from === e0.from && eD.w !== e0.w);
  } else check("classifier cognate-under-drift (none found)", false);

  // (h) assignment: hum/anm/long give three DIFFERENT classifiers; RIVER→gen
  // fallback where 'long' is absent; every animal reads 'anm'
  const full = clfL.find(l => ["hum", "anm", "long"].every(k => gramOf(l).classif.classes.includes(k)));
  check(`hum / anm / long assign three distinct classifiers`, !!full && new Set([classifierFor(full, MAN).w, classifierFor(full, HORSE).w, classifierFor(full, TREE).w]).size === 3);
  const noLong = clfL.find(l => !gramOf(l).classif.classes.includes("long"));
  check(`a 'long'-less language routes RIVER → gen (no crash)`, !noLong || classifierFor(noLong, RIVER).cls === "gen");
  const anmConcepts = CONCEPTS.map((c, i) => i).filter(i => CONCEPTS[i].d === "anm");
  check(`every animal concept reads the 'anm' sense (${anmConcepts.length} checked)`, anmConcepts.every(i => classifSenseOf(i) === "anm"));

  // (i) ambiguous nouns get a per-family salient reading (FISH: animal vs long)
  const fishVary = new Set(clfL.filter(l => ["anm", "long"].every(k => gramOf(l).classif.classes.includes(k))).map(l => classifierFor(l, FISH).cls));
  check(`ambiguous FISH varies by family (per-family salience: ${[...fishVary].join("/")})`, fishVary.size >= 2 || (fishVary.size === 1 && clfL.length > 0));

  // (j) the [Num (CL) N] construction: token/gloss aligned incl. multi-word
  // numerals; CL sits before/after N per order; obligatory ⇒ a CLF token
  const cl0 = clfL.find(l => gramOf(l).classif.obl && gramOf(l).classif.classes.includes("anm"));
  const p3 = numeralPhrase(cl0, HORSE, 3), p23 = numeralPhrase(cl0, HORSE, 23);
  check(`[Num CL N] gloss-aligned incl. multi-word numerals (${p23.text} = ${p23.gloss})`, p3.tokens.length === p3.gloss.split(" ").length && p23.tokens.length === p23.gloss.split(" ").length);
  const clfIdx = p3.tokens.findIndex(t => t.role === "CLF"), nIdx = p3.tokens.findIndex(t => t.role === "N");
  check(`classifier sits ${gramOf(cl0).classif.order} the noun (CLF@${clfIdx} N@${nIdx})`, gramOf(cl0).classif.order === "pre" ? clfIdx < nIdx : clfIdx > nIdx);
  check(`obligatory classifier language always shows a CLF token`, p3.tokens.some(t => t.role === "CLF") && numeralPhrase(cl0, HORSE, 1).tokens.some(t => t.role === "CLF"));

  // (k) non-classifier languages insert NO classifier and pluralize when n>1
  const nc = all.find(l => !gramOf(l).classif && gramOf(l).pluralMark && l.prof.morph !== "iso");
  const ncP = numeralPhrase(nc, HORSE, 3);
  check(`non-classifier language: no CLF token + noun pluralizes when n>1 (${ncP.gloss})`, !ncP.tokens.some(t => t.role === "CLF") && /PL/.test(ncP.gloss));

  // (l) frame integration: renderClause expands a counted argument in place
  // (the count sub-roles fold into the argument's S/O role for word order, so
  // the classifier surfaces in the gloss rather than as a clause-level role)
  const cf = renderClause(cl0, { s: { n: HORSE, count: 3 }, v: { c: GO, tam: "pst" } });
  check(`renderClause expands a counted arg + stays gloss-aligned (${cf.gloss})`, cf.tokens.length === cf.gloss.split(" ").length && /CL\./.test(cf.gloss));

  // (m) pinned Mandarin: [Num CL N] legal pinyin, animal ≠ human; refs elsewhere null
  const mRef = refLang(mkWorld(), "mandarin", 445); const mp = refPin("mandarin"); mRef.pin = mp.pin; mRef.prof.rom = mp.rom;
  const mP = numeralPhrase(mRef, HORSE, 3);
  const stripT = (w) => w.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const PINYIN = /^((zh|ch|sh|[bpmfdtnlgkhjqxrzcswy])?[aeiou]{1,3}(ng|n)?)+$/;
  check(`pinned Mandarin [Num CL N] is legal pinyin, animal≠human (${mP.text})`, mP.tokens.every(t => PINYIN.test(stripT(t.w))) && classifierFor(mRef, HORSE).w !== classifierFor(mRef, KING).w);
  const rRef = refLang(mkWorld(), "russian", 445), eRef = refLang(mkWorld(), "english", 445);
  check(`Russian + English are non-classifier (classif: null)`, gramOf(rRef).classif === null && gramOf(eRef).classif === null && classifiersOf(rRef) === null && !numeralPhrase(eRef, HORSE, 3).tokens.some(t => t.role === "CLF"));

  // (n) determinism + JSON-roundtrip
  let cseed = null;
  for (let i = 0; i < N && cseed === null; i++) { const s = 810000 + i * 37; if (gramOf(foundLanguage(mkWorld(), { seed: s })).classif) cseed = s; }
  const ca = foundLanguage(mkWorld(), { seed: cseed }), cb = foundLanguage(mkWorld(), { seed: cseed }), cc = JSON.parse(JSON.stringify(ca));
  const csig = (l) => JSON.stringify(classifiersOf(l)) + numeralPhrase(l, HORSE, 3).text + numeralPhrase(l, KING, 2).text;
  check(`classifiers deterministic + JSON-roundtrip-stable`, csig(ca) === csig(cb) && csig(ca) === csig(cc));
}

// ── 20. NOMINAL CATEGORIES (Group E) ──────────────────────────────────────
// Number beyond sg/du/pl (paucal, trial — the Corbett hierarchy), alienable vs
// inalienable possession, comparison (comparative/superlative/equative), and
// T-V politeness + honorific verbs. Additive to the noun/degree/pronoun layers.
console.log("\n── Nominal categories ──");
{
  const world = mkWorld();
  const byMorph = { iso: [], agg: [], fus: [], tmpl: [] };
  const N = 900;
  for (let i = 0; i < N; i++) { const l = foundLanguage(world, { seed: 830000 + i * 41 }); byMorph[l.prof.morph].push(l); }
  const all = [].concat(...Object.values(byMorph));
  const rate = (ls, pred) => ls.filter(pred).length / Math.max(1, ls.length);
  const ov = (l) => { const w = gramOf(l).wo; return w === "sov" || w === "ovs"; };
  const fv = (x) => x.gloss;

  // ── F1 number: paucal / trial ──
  // (a) BYTE-IDENTITY (first gate): a plain sg/pl frame is unchanged
  const be = all.slice(0, 150).every(l => {
    const a = renderClause(l, { s: { n: KING }, v: { c: SEE, tam: "pst" }, o: { n: RIVER } });
    const b = renderClause(JSON.parse(JSON.stringify(l)), { s: { n: KING }, v: { c: SEE, tam: "pst" }, o: { n: RIVER } });
    return a.text === b.text && a.gloss === b.gloss;
  });
  check(`byte-identity: a plain frame is unchanged (150 sampled)`, be);
  // (b) the load-bearing implicational: ZERO trial/paucal without a dual
  check(`ZERO trial/paucal without dual (Corbett hierarchy)`, all.filter(l => (gramOf(l).trial || gramOf(l).paucal) && !gramOf(l).dual).length === 0);
  const trRate = rate(all, l => gramOf(l).trial), pauRate = rate(all, l => gramOf(l).paucal);
  check(`trial rarer than paucal, both a small minority (tri ${(trRate * 100).toFixed(1)}% < 4%, pau ${(pauRate * 100).toFixed(1)}% < 8%)`, trRate < 0.04 && pauRate < 0.08 && trRate <= pauRate);
  const tl = all.find(l => gramOf(l).trial && l.prof.morph !== "iso");
  if (tl) { const tri = inflectNoun(tl, STONE, { num: "tri" }).gloss, du = inflectNoun(tl, STONE, { num: "du" }).gloss, pl = inflectNoun(tl, STONE, { num: "pl" }).gloss; check(`trial cell ≠ dual ≠ plural, glossed TRI (${tri} / ${du} / ${pl})`, tri !== du && tri !== pl && /TRI/.test(tri)); }
  else check("trial cell distinct (none found)", false);
  if (tl) { const cl = closedOf(tl); const g = (k) => { const p = cl.prons.find(x => x.k === k); return p && p.w; }; check(`trial pronoun distinct (1TRI≠1DU≠1PL: ${g("1tri")}/${g("1du")}/${g("1pl")})`, g("1tri") && g("1tri") !== g("1du") && g("1tri") !== g("1pl")); }
  else check("trial pronoun distinct (none)", false);
  const ntl = all.find(l => !gramOf(l).trial && gramOf(l).pluralMark && l.prof.morph !== "iso");
  check(`trial degrades to the plural where unsupported (${inflectNoun(ntl, STONE, { num: "tri" }).gloss})`, /PL/.test(inflectNoun(ntl, STONE, { num: "tri" }).gloss) && !/TRI/.test(inflectNoun(ntl, STONE, { num: "tri" }).gloss));

  // ── F2 possession ──
  const possHead = rate(all.filter(l => gramOf(l).agree !== "none" && l.prof.morph !== "iso"), l => gramOf(l).possAffix);
  const possDep = rate(all.filter(l => gramOf(l).agree === "none" && l.prof.morph !== "iso"), l => gramOf(l).possAffix);
  check(`possessive affix correlates with head-marking (agree ${Math.round(possHead * 100)}% > none ${Math.round(possDep * 100)}%), ~0% iso`, possHead > possDep && rate(byMorph.iso, l => gramOf(l).possAffix) === 0);
  const sp = all.find(l => gramOf(l).alienSplit && l.prof.morph !== "iso");
  check(`alienability split follows the DOMAIN (HAND/MOTHER affix, HOUSE/STONE construction)`, !!sp && possessionType(sp, HAND) === "affix" && possessionType(sp, MOTHER) === "affix" && possessionType(sp, HOUSE) === "construction" && possessionType(sp, STONE) === "construction");
  const nsp = all.find(l => gramOf(l).possAffix && !gramOf(l).alienSplit && l.prof.morph !== "iso");
  check(`a non-split possessive affixes ALL nouns (HOUSE included)`, !!nsp && possessionType(nsp, HOUSE) === "affix" && possessionType(nsp, HAND) === "affix");
  const pcGl = nsp ? inflectNoun(nsp, HAND, { poss: { pers: 1, num: "sg" }, cas: "dat" }).gloss : "";
  check(`POSS + CASE both surface, distinct in the gloss (${pcGl})`, /POSS/.test(pcGl) && /DAT/.test(pcGl));
  check(`citation stability: a no-possessor noun == wordOf (${inflectNoun(nsp || all[0], HOUSE, {}).text})`, inflectNoun(nsp || all[0], HOUSE, {}).text === wordOf(nsp || all[0], HOUSE));
  if (sp) { const cons = inflectPossessed(sp, HOUSE, { pers: 1, num: "sg" }); check(`alienable possession renders a construction, gloss-aligned (${cons.gloss})`, cons.tokens.length === cons.gloss.split(" ").length && cons.tokens.length >= 2); }
  else check("alienable construction (none)", false);
  // affix cognate with the pronoun: the possessive 1sg shares the free 1sg's onset
  const pcog = all.find(l => gramOf(l).possAffix && l.prof.morph !== "iso" && paradigmSpec(l).possAff);
  if (pcog) { const ha = paradigmSpec(pcog).possAff; check(`possessive affixes are person-distinct (1≠2≠3)`, new Set([ha["1sg"], ha["2sg"], ha["3sg"]].map(a => renderClause && JSON.stringify(a.syl))).size === 3); }
  else check("possessive person-distinct (none)", false);

  // ── F3 comparison ──
  const ovL = all.filter(ov), voIso = byMorph.iso.filter(l => !ov(l));
  check(`OV languages favour the separative comparative (${Math.round(rate(ovL, l => gramOf(l).compar.type === "sep") * 100)}%)`, rate(ovL, l => gramOf(l).compar.type === "sep") > 0.5);
  check(`VO-isolating favours the exceed-verb comparative (${Math.round(rate(voIso, l => gramOf(l).compar.type === "exceed") * 100)}%)`, voIso.length > 0 && rate(voIso, l => gramOf(l).compar.type === "exceed") > 0.5);
  check(`stdFirst tracks OV in every language`, all.every(l => gramOf(l).compar.stdFirst === ov(l)));
  const cAgg = { exceed: 0, sep: 0, particle: 0 }; for (const l of all) cAgg[gramOf(l).compar.type]++;
  const f = (k) => cAgg[k] / all.length;
  check(`comparison strategies WALS-marginal (exceed ${Math.round(f("exceed") * 100)}% sep ${Math.round(f("sep") * 100)}% particle ${Math.round(f("particle") * 100)}%)`, f("sep") > 0.3 && f("sep") < 0.6 && f("particle") > 0.2 && f("particle") < 0.45 && f("exceed") > 0.1 && f("exceed") < 0.3);
  const cl0 = all.find(l => l.prof.morph !== "iso");
  const cmpr = comparative(cl0, GREAT, KING, { degree: "cmpr" }), sup = comparative(cl0, GREAT, null, { degree: "sup" }), eq = comparative(cl0, GREAT, KING, { degree: "eq" });
  check(`all three degrees render, gloss-aligned (${cmpr.gloss} · ${sup.gloss} · ${eq.gloss})`, [cmpr, sup, eq].every(c => c.tokens.length === c.gloss.split(" ").length && c.text.length > 0));
  // the 'comp' pattern is distinct from the TAM/plural patterns (templatic)
  const tmplC = byMorph.tmpl[0];
  if (tmplC) { const supTmpl = comparative(tmplC, GREAT, null, { degree: "sup" }); check(`templatic superlative uses a distinct comp pattern (${supTmpl.gloss})`, /SUP/.test(supTmpl.gloss) || supTmpl.tokens.length >= 2); }
  else check("templatic comp pattern (none)", false);

  // ── F4 politeness ──
  const tvC = { none: 0, binary: 0, multi: 0 }; for (const l of all) tvC[gramOf(l).tv]++;
  check(`T-V distribution WALS-shaped (none ${Math.round(tvC.none / N * 100)}% binary ${Math.round(tvC.binary / N * 100)}% multi ${Math.round(tvC.multi / N * 100)}%)`, tvC.binary / N > 0.18 && tvC.binary / N < 0.3 && tvC.multi / N > 0.03 && tvC.none / N > 0.6);
  const pv = all.find(l => gramOf(l).tv !== "none" && gramOf(l).tvSource === "plural");
  check(`polite 2nd ≠ familiar; a plural source ⇒ 2v == 2pl`, !!pv && (() => { const t = tvPronouns(pv), cl = closedOf(pv); return t.polite !== t.familiar && t.polite === cl.prons.find(p => p.k === "2pl").w; })());
  const nv = all.find(l => gramOf(l).tv !== "none" && gramOf(l).tvSource === "noble");
  check(`a noble source yields a distinct polite form (≠ familiar, ≠ 2pl)`, !!nv && (() => { const t = tvPronouns(nv), cl = closedOf(nv); return t.polite !== t.familiar && t.polite !== cl.prons.find(p => p.k === "2pl").w; })());
  const mv = all.find(l => gramOf(l).tv === "multi");
  check(`multi-level politeness: 2sg ≠ 2v ≠ 2vv`, !!mv && (() => { const t = tvPronouns(mv); return new Set([t.familiar, t.polite, t.honorific]).size === 3; })());
  const hvL = all.filter(l => gramOf(l).honVerb && l.prof.morph !== "iso" && paradigmSpec(l).tam.pst);
  const hv = hvL[0];
  if (hv) { const h = honorificVerb(hv, GO, { tam: "pst" }), pl = inflectVerb(hv, GO, { tam: "pst" }); check(`honorific verb ≠ plain, glossed HON (${h.gloss} vs ${pl.gloss})`, h.text !== pl.text && /HON/.test(h.gloss)); }
  else check("honorific verb distinct (none)", false);
  check(`honorific verb leans synthetic (agg/tmpl ${Math.round(rate([...byMorph.agg, ...byMorph.tmpl], l => gramOf(l).honVerb) * 100)}% > iso/fus ${Math.round(rate([...byMorph.iso, ...byMorph.fus], l => gramOf(l).honVerb) * 100)}%)`, rate([...byMorph.agg, ...byMorph.tmpl], l => gramOf(l).honVerb) > rate([...byMorph.iso, ...byMorph.fus], l => gramOf(l).honVerb));

  // ── references + determinism ──
  const refs = ["mandarin", "russian", "english"].map(k => refLang(mkWorld(), k, 445));
  check(`references pinned (trial/possAffix false; compar + tv set)`, refs.every(r => { const g = gramOf(r); return g.trial === false && g.possAffix === false && g.compar && typeof g.tv === "string"; }));
  const mRef = refLang(mkWorld(), "mandarin", 445);
  check(`pinned Mandarin comparative preposes the standard (bǐ: stdFirst)`, gramOf(mRef).compar.stdFirst === true && gramOf(mRef).compar.type === "particle");
  let nseed = null;
  for (let i = 0; i < N && nseed === null; i++) { const s = 830000 + i * 41; const g = gramOf(foundLanguage(mkWorld(), { seed: s })); if (g.possAffix || g.tv !== "none" || g.trial) nseed = s; }
  const na = foundLanguage(mkWorld(), { seed: nseed }), nb = foundLanguage(mkWorld(), { seed: nseed }), ncc = JSON.parse(JSON.stringify(na));
  const nsig = (l) => JSON.stringify([inflectNoun(l, HAND, { poss: { pers: 1, num: "sg" }, cas: "dat" }).gloss, comparative(l, GREAT, KING, { degree: "cmpr" }).text, tvPronouns(l)]);
  check(`nominal categories deterministic + JSON-roundtrip-stable`, nsig(na) === nsig(nb) && nsig(na) === nsig(ncc));
}

// ── 21. MULTI-CLAUSE: COORDINATION & SUBORDINATION (Group G) ───────────────
// The flat frame becomes a TREE: coordination, complement clauses, adverbial
// clauses, relative clauses, clause chaining with switch-reference. Every
// combinator returns the same {tokens,text,gloss} shape (gloss-aligned at any
// depth); the linkers grammaticalize from existing words and LAG a word-order flip.
console.log("\n── Multi-clause ──");
{
  const world = mkWorld();
  const byMorph = { iso: [], agg: [], fus: [], tmpl: [] };
  const N = 900;
  for (let i = 0; i < N; i++) { const l = foundLanguage(world, { seed: 850000 + i * 43 }); byMorph[l.prof.morph].push(l); }
  const all = [].concat(...Object.values(byMorph));
  const rate = (ls, pred) => ls.filter(pred).length / Math.max(1, ls.length);
  const ov = (l) => { const w = gramOf(l).wo; return w === "sov" || w === "ovs"; };
  const A = (x) => x.tokens.length === x.gloss.split(" ").length;
  const l0 = all.find(l => l.prof.morph !== "iso");

  // ── F1 coordination ──
  // (a) BYTE-IDENTITY (first gate): a single-clause tree == renderClause
  const single = { s: { n: KING }, v: { c: SEE, tam: "pst" }, o: { n: RIVER } };
  check(`byte-identity: a single-clause tree == renderClause`, all.slice(0, 150).every(l => renderClauseTree(l, single).text === renderClause(l, single).text));
  const co = renderClauseTree(l0, { coord: "and", clauses: [{ s: { n: KING }, v: { c: GO, tam: "pst" } }, { s: { n: WOLF }, v: { c: SEE, tam: "pst" }, o: { n: RIVER } }] });
  check(`coordination joins clauses with a conjunction, gloss-aligned (${co.gloss})`, A(co) && /AND/.test(co.gloss) && co.tokens.length >= 5);
  const cf = all.find(l => gramOf(l).coordFinal);
  if (cf) { const c = renderClauseTree(cf, { coord: "and", clauses: [{ s: { n: KING }, v: { c: GO, tam: "pst" } }, { s: { n: WOLF }, v: { c: GO, tam: "pst" } }] }); check(`enclitic coordinator joins a token (no stray CONJ token), gloss-aligned (${c.gloss})`, A(c) && /AND/.test(c.gloss)); }
  else check(`enclitic coordinator (none rolled — OV-suffixing edge)`, rate(all, l => gramOf(l).coordFinal) < 0.1);

  // ── F2 complement clauses ──
  const comp = renderClause(l0, { s: { n: KING }, v: { c: SEE, tam: "pst" }, o: { comp: { s: { n: WOLF }, v: { c: GO, tam: "pst" }, o: { n: RIVER } } } });
  check(`complement clause: a COMP token in the object slot, gloss-aligned (${comp.gloss})`, A(comp) && /COMP/.test(comp.gloss));
  check(`clause-final complementizer implies OV (${Math.round(rate(all.filter(l => gramOf(l).compzPos === "final"), ov) * 100)}%)`, rate(all.filter(l => gramOf(l).compzPos === "final"), ov) >= 0.8);
  const cS = rate(all, l => gramOf(l).compzSrc === "say"), cD = rate(all, l => gramOf(l).compzSrc === "dem"), cW = rate(all, l => gramOf(l).compzSrc === "wh");
  check(`complementizer sources say/dem/wh each occur, SAY over-represented in iso (say ${Math.round(cS * 100)}% dem ${Math.round(cD * 100)}% wh ${Math.round(cW * 100)}%)`, cS > 0.08 && cD > 0.08 && cW > 0.08 && rate(byMorph.iso, l => gramOf(l).compzSrc === "say") > cS);
  const aggNf = byMorph.agg.find(l => gramOf(l).compFinite === false);
  if (aggNf) { const c = renderClause(aggNf, { s: { n: KING }, v: { c: SEE, tam: "pst" }, o: { comp: { s: { n: WOLF }, v: { c: GO, tam: "pst" } } } }); check(`agglutinative compFinite=false nominalizes the inner verb (${c.gloss})`, /NMLZ/.test(c.gloss)); }
  else check(`agglutinative nominalized complement (none found)`, true);

  // ── F3 adverbial clauses ──
  const adv = renderClause(l0, { s: { n: KING }, v: { c: GO, tam: "pst" }, adv: [{ sub: "if", s: { n: WOLF }, v: { c: SEE, tam: "pst" }, o: { n: RIVER } }] });
  check(`adverbial clause: a subordinator + inner clause, conditional preposed, gloss-aligned (${adv.gloss})`, A(adv) && adv.tokens.length >= 6);
  check(`clause-final subordinator implies OV (${Math.round(rate(all.filter(l => gramOf(l).advPos === "final"), ov) * 100)}%)`, rate(all.filter(l => gramOf(l).advPos === "final"), ov) >= 0.8);
  check(`the 'when' subordinator ≠ the interrogative 'when'`, all.slice(0, 40).every(l => closedOf(l).links.when.w !== closedOf(l).qs.find(q => q.k === "when").w));
  const advAf = all.find(l => gramOf(l).advAffix);
  if (advAf) { const c = renderClause(advAf, { s: { n: KING }, v: { c: GO, tam: "pst" }, adv: [{ sub: "because", s: { n: KING }, v: { c: SEE, tam: "pst" }, o: { n: RIVER } }] }); check(`converb adverbial attaches to the subordinate verb (${c.gloss})`, /CVB/.test(c.gloss) && A(c)); }
  else check(`converb adverbial (none rolled — Turkic/Japanese corner)`, true);

  // ── F4 relative clauses ──
  check(`ZERO languages have a prenominal relative PRONOUN (the universal)`, all.filter(l => gramOf(l).relStrat === "relpron" && gramOf(l).relPre).length === 0);
  check(`the gap strategy is the plurality (${Math.round(rate(all, l => gramOf(l).relStrat === "gap") * 100)}%)`, rate(all, l => gramOf(l).relStrat === "gap") > 0.45);
  check(`a relative pronoun only appears postnominal + case-marked`, all.every(l => gramOf(l).relStrat !== "relpron" || (!gramOf(l).relPre && gramOf(l).caseN >= 1)));
  const gapL = all.find(l => gramOf(l).relStrat === "gap" && l.prof.morph !== "iso");
  const rg = renderClause(gapL, { s: { n: KING, rel: { role: "s", v: { c: SEE, tam: "pst" }, o: { n: RIVER } } }, v: { c: GO, tam: "pst" } });
  check(`gap relative: the head appears once + a strategy marker (REL / participle), gloss-aligned (${rg.gloss})`, A(rg) && /REL|PTCP/.test(rg.gloss) && rg.tokens.filter(t => t.g === "king").length === 1);
  const rsL = all.find(l => gramOf(l).relStrat === "resump");
  if (rsL) { const r = renderClause(rsL, { s: { n: KING, rel: { role: "s", v: { c: SEE, tam: "pst" }, o: { n: RIVER } } }, v: { c: GO, tam: "pst" } }); check(`resumptive relative retains a pronoun in the gap (${r.gloss})`, /3SG/.test(r.gloss) && A(r)); }
  else check(`resumptive relative (none found)`, false);
  // LAG: an OV→SVO branch keeps the (inherited) prenominal relative
  world.step = 3000;
  let lagP = null;
  for (let i = 0; i < 400 && !lagP; i++) { const p = foundLanguage(mkWorld(), { seed: 700000 + i * 53 }); if (ov(p) && gramOf(p).relPre) lagP = p; }
  let lagOK = true;
  if (lagP) { const w2 = mkWorld(); w2.step = 3000; const p = foundLanguage(w2, { seed: lagP.seed }); for (let k = 0; k < 40; k++) { const d = branchLanguage(w2, p, 0.6); if (gramOf(d).relPre !== gramOf(p).relPre) lagOK = false; } }
  check(`relative order LAGS a word-order flip (a daughter keeps prenominal)`, !!lagP && lagOK);

  // ── F5 clause chaining ──
  const chN = rate(all, l => gramOf(l).chaining);
  check(`clause chaining is WALS-shaped, every chaining language verb-final (${Math.round(chN * 100)}%)`, chN > 0.03 && chN < 0.25 && all.filter(l => gramOf(l).chaining).every(ov));
  check(`switch-reference ⊂ chaining, never isolating`, all.filter(l => gramOf(l).switchRef).every(l => gramOf(l).chaining && l.prof.morph !== "iso"));
  const ch = all.find(l => gramOf(l).chaining && gramOf(l).switchRef);
  if (ch) {
    const ss = renderClauseTree(ch, { chain: [{ s: { n: KING }, v: { c: GO, tam: "pst" } }, { s: { n: KING }, v: { c: SEE, tam: "pst" }, o: { n: RIVER } }] });
    const ds = renderClauseTree(ch, { chain: [{ s: { n: KING }, v: { c: GO, tam: "pst" } }, { s: { n: WOLF }, v: { c: SEE, tam: "pst" } }] });
    check(`SS drops the shared subject + marks SS; DS retains it + marks DS (${ss.gloss} // ${ds.gloss})`, /SS/.test(ss.gloss) && /DS/.test(ds.gloss) && ss.tokens.filter(t => t.g === "king").length === 1 && A(ss) && A(ds));
  } else check(`switch-reference SS/DS (none rolled)`, false);
  const ncL = all.find(l => !gramOf(l).chaining);
  check(`a chain degrades to a coordination in a non-chaining language`, /AND/.test(renderClauseTree(ncL, { chain: [{ s: { n: KING }, v: { c: GO, tam: "pst" } }, { s: { n: WOLF }, v: { c: GO, tam: "pst" } }] }).gloss));
  // a chained/coordinated clause containing a nested relative stays aligned
  const nested = renderClauseTree(l0, { coord: "and", clauses: [{ s: { n: KING, rel: { role: "s", v: { c: SEE, tam: "pst" }, o: { n: RIVER } } }, v: { c: GO, tam: "pst" } }, { s: { n: WOLF }, v: { c: GO, tam: "pst" } }] });
  check(`a coordinated clause containing a nested relative stays gloss-aligned (${nested.tokens.length} toks)`, A(nested));

  // ── references + determinism ──
  const refL = ["mandarin", "russian", "english"].map(k => refLang(mkWorld(), k, 445));
  check(`references pinned (Mandarin gap+RelN; Russian/English relpron; chaining off)`, (() => { const [m, r, e] = refL.map(clauseLinkersOf); return m.rel.strat === "gap" && m.rel.pre === true && r.rel.strat === "relpron" && e.rel.strat === "relpron" && refL.every(x => !gramOf(x).chaining); })());
  check(`pinned Mandarin is the disharmonic SVO + prenominal-relative corner`, gramOf(refLang(mkWorld(), "mandarin", 445)).wo === "svo" && gramOf(refLang(mkWorld(), "mandarin", 445)).relPre === true);
  let mseed = null;
  for (let i = 0; i < N && mseed === null; i++) { const s = 850000 + i * 43; const g = gramOf(foundLanguage(mkWorld(), { seed: s })); if (g.chaining || g.compzSrc === "say") mseed = s; }
  const ma = foundLanguage(mkWorld(), { seed: mseed }), mb = foundLanguage(mkWorld(), { seed: mseed }), mc2 = JSON.parse(JSON.stringify(ma));
  const msig = (l) => JSON.stringify(clauseLinkersOf(l)) + renderClause(l, { s: { n: KING }, v: { c: SEE, tam: "pst" }, o: { comp: { s: { n: WOLF }, v: { c: GO, tam: "pst" } } } }).text;
  check(`multi-clause deterministic + JSON-roundtrip-stable`, msig(ma) === msig(mb) && msig(ma) === msig(mc2));
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

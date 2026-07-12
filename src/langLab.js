// ── Simman Language Lab ───────────────────────────────────────────────────
// A standalone playground for the language system (docs/language-
// comprehensive-spec.md). Dependency-free vanilla DOM — deliberately outside
// the React app so it can be served as /langlab.html in dev or bundled into
// a single self-contained page, without touching the world sim at all.

/* global __BUILD__ */
// __BUILD__ is a build-time constant injected by esbuild's --define at bundle
// time (the short commit hash on the footer); it is absent in raw source and
// under `npm run dev`, which is why every read is typeof-guarded. Declared
// here so ESLint's no-undef doesn't flag the injected identifier.

import { foundLanguage, branchLanguage, driftLanguage, borrowFrom, langWord, langPlaceNameEx, langPersonName, langDynastyName, langRealmName, wordOf, glossOf, etymologyOf, colexPartner } from "./sim/language.js";
import { buildInventory, romanizeC, romanizeV } from "./sim/languagePhonology.js";
import { applyReference, REF_KINDS } from "./sim/languageRefs.js";
import { CONCEPTS } from "./sim/languageLexicon.js";
import { gramOf, closedOf, numeral, numeralConceptWord, inflectNoun, inflectVerb, paradigmShape, affixEtymologies, renderClause, resolveTam, intensive } from "./sim/languageGrammar.js";
import { STONE, KING, RIVER, HOUSE, WOLF, MOTHER, HAND, MOUNTAIN, SHIP, FOOT, VERBS, HORSE, TOWN, BLACK, SEE, GO, TAKE, EAT, SLEEP, QUEEN, BREAD, SWORD, GREAT } from "./sim/languageLexicon.js";

// ── state ────────────────────────────────────────────────────────────────
let world, lineage, donor;
const S = {
  seed: 8817, preset: "random", divergence: 0.5, search: "", noun: STONE, verb: VERBS[2],
  sent: { s: "p:1sg", v: SEE, tam: "pst", o: "n:" + RIVER, neg: false, q: false, loc: "none", mood: "decl" },
};

function reset() {
  world = { seed: 1, step: 0, languages: new Map(), _nextLanguageId: 1 };
  const l = foundLanguage(world, { seed: S.seed >>> 0 });
  if (S.preset !== "random") applyReference(l, S.preset);
  lineage = [l];
  donor = null;
}
const active = () => lineage[lineage.length - 1];

// display inventory = the same derivation compile() uses
function displayInv(l) {
  const rolled = buildInventory(l.famSeed, l.prof);
  const inv = {
    cons: (l.pin && l.pin.cons ? l.pin.cons : rolled.cons).slice(),
    vows: (l.pin && l.pin.vows ? l.pin.vows : rolled.vows).slice(),
  };
  for (const b of l.xph || []) inv.cons.push(b);
  return inv;
}

const MORPH = { iso: "isolating", agg: "agglutinative", fus: "fusional", tmpl: "templatic (root-and-pattern)" };
const SYL = ["strict CV", "CV(C)", "clustered", "heavy clusters"];
const TONE = ["no tone", "register tone", "contour tone"];
const HARM = { none: null, fb: "front–back harmony", round: "rounding harmony" };
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");

// ── rendering ────────────────────────────────────────────────────────────
function chips(l) {
  const p = l.prof, inv = displayInv(l);
  // count what the READER sees: unique rendered spellings, not feature
  // bundles (ð and þ both write "th", so 23 bundles can be 21 letters)
  const nC = new Set(inv.cons.map(b => romanizeC(b, p.romTaste, p.rom))).size;
  const nV = new Set(inv.vows.map(b => romanizeV(b, p.rom))).size;
  const out = [MORPH[p.morph], SYL[p.sylC], TONE[p.tone], HARM[p.harmony],
    `${nC} consonants`, `${nV} vowels`,
    p.nasalCoda ? "nasal codas only" : null, p.gendered ? "gendered names" : null,
    p.patro !== "none" ? `patronymic (${p.patro === "suf" ? "suffix" : "prefix"})` : null,
    l.rules.length ? `${l.rules.length} sound changes` : "pristine",
    l.loans.length ? `${l.loans.length} loanwords` : null,
    l.pin ? "pinned inventory" : null];
  return out.filter(Boolean).map(t => `<span class="chip">${esc(t)}</span>`).join("");
}

function inventoryHTML(l) {
  const inv = displayInv(l);
  const c = [...new Set(inv.cons.map(b => romanizeC(b, l.prof.romTaste, l.prof.rom)))].join(" ");
  const v = [...new Set(inv.vows.map(b => romanizeV(b, l.prof.rom)))].join(" ");
  return `<div class="inv"><span class="lbl">consonants</span> <span class="w">${esc(c)}</span></div>
          <div class="inv"><span class="lbl">vowels</span> <span class="w">${esc(v)}</span></div>`;
}

function namesHTML(l) {
  const topo = [];
  for (let i = 0; i < 10; i++) {
    const { name, gloss } = langPlaceNameEx(l, i);
    topo.push(`<li><span class="w">${esc(name)}</span>${gloss ? ` <span class="gloss">‘${esc(gloss)}’</span>` : ` <span class="gloss lost">meaning lost</span>`}</li>`);
  }
  const men = [1, 2, 3].map(i => langPersonName(l, i, false));
  const women = [4, 5, 6].map(i => langPersonName(l, i, true));
  const dyn = men.map((m, i) => langDynastyName(l, i + 1, m));
  const realms = [1, 2, 3].map(i => langRealmName(l, i));
  return `
    <h3>Places</h3><ul class="cols">${topo.join("")}</ul>
    <h3>People</h3>
    <p><span class="lbl">men</span> ${men.map(n => `<span class="w">${esc(n)}</span>`).join(", ")}
       <span class="lbl ind">women</span> ${women.map(n => `<span class="w">${esc(n)}</span>`).join(", ")}</p>
    <h3>Houses &amp; realms</h3>
    <p><span class="lbl">dynasties</span> ${dyn.map(n => `<span class="w">${esc(n)}</span>`).join(", ")}
       <span class="lbl ind">realms</span> ${realms.map(n => `<span class="w">${esc(n)}</span>`).join(", ")}</p>`;
}

// ── the grammar card: syntax dials, closed classes, counting ─────────────
const WO_NAME = { sov: "SOV", svo: "SVO", vso: "VSO", vos: "VOS", ovs: "OVS" };
function grammarHTML(l) {
  const g = gramOf(l);
  const cl = closedOf(l);
  const gchips = [
    `${WO_NAME[g.wo]} order`,
    g.adpSide === "pre" ? "prepositions" : "postpositions",
    g.caseN ? `${g.caseN} case${g.caseN > 1 ? "s" : ""} (${g.align === "erg" ? "ergative" : "nom–acc"})` : "no case",
    g.genders ? `${g.genders} noun classes` : null,
    g.tenses > 1 ? `${g.tenses} tenses` : "tenseless",
    g.aspect ? "aspect" : null,
    g.agree !== "none" ? (g.agree === "both" ? "polypersonal agreement" : "person agreement") : null,
    g.proDrop ? "pro-drop" : null,
    g.numBase !== 10 ? `base-${g.numBase} counting` : "decimal counting",
    g.clusiv ? "inclusive/exclusive we" : null,
    g.dual ? "dual number" : null,
    g.defArt ? "definite article" : null,
    g.genN ? "genitive-first" : "noun-first genitive",
    g.redup ? `${g.redup.type} reduplication (${g.redup.fns.join("/")})` : null,
    `${g.imp} imperative`,
  ].filter(Boolean).map(t => `<span class="chip">${esc(t)}</span>`).join("");
  const pron = cl.prons.map(p => `<span class="cell"><span class="lbl">${esc(p.g)}</span> <span class="w">${esc(p.w)}</span></span>`).join(" ");
  const dems = cl.dems.map(d => `<span class="cell"><span class="lbl">${esc(d.g)}</span> <span class="w">${esc(d.w)}</span></span>`).join(" ");
  const qs = cl.qs.map(q => `<span class="cell"><span class="lbl">${esc(q.g)}</span> <span class="w">${esc(q.w)}</span></span>`).join(" ");
  const conj = cl.conj.map(x => `<span class="cell"><span class="lbl">${esc(x.k)}</span> <span class="w">${esc(x.w)}</span></span>`).join(" ");
  const adps = cl.adps.map(a => `<span class="cell"><span class="lbl">${esc(a.m)}</span> <span class="w">${esc(a.w)}</span>${a.src != null ? `<span class="gloss"> ‹ ‘${esc(glossOf(a.src))}’</span>` : ""}</span>`).join(" ");
  const arts = [cl.defArt ? `<span class="cell"><span class="lbl">the</span> <span class="w">${esc(cl.defArt.w)}</span><span class="gloss"> ‹ ‘${esc(cl.defArt.src)}’</span></span>` : "",
    cl.indefArt ? `<span class="cell"><span class="lbl">a</span> <span class="w">${esc(cl.indefArt.w)}</span><span class="gloss"> ‹ ‘${esc(cl.indefArt.src)}’</span></span>` : ""].join(" ");
  const nums1 = [];
  for (let n = 1; n <= 10; n++) nums1.push(`<span class="cell"><span class="lbl">${n}</span> <span class="w">${esc(numeral(l, n).text)}</span></span>`);
  const numsBig = [15, 23, 40, 87, 123].map(n => {
    const x = numeral(l, n);
    return `<li><span class="lbl">${n}</span> <span class="w">${esc(x.text)}</span> <span class="gloss">‘${esc(x.gloss)}’</span></li>`;
  }).join("");
  return `<section class="card"><h2>Grammar</h2>
    <div class="chips">${gchips}</div>
    <p class="note">Syntax dials are rolled with Greenberg's correlations at real frequencies (verb-final tongues take postpositions and suffixes; verb-first tongues take prepositions), and the little words are worn-down forms of the language's own vocabulary — the ‹ notes show what each one used to be.</p>
    <h3>Pronouns</h3><p class="cells">${pron}</p>
    <h3>Demonstratives &amp; negation</h3><p class="cells">${dems} <span class="cell"><span class="lbl">not</span> <span class="w">${esc(cl.neg.w)}</span></span> ${arts}</p>
    <h3>Question words</h3><p class="cells">${qs}</p>
    <h3>Adpositions</h3><p class="cells">${adps}</p>
    <h3>Conjunctions</h3><p class="cells">${conj}</p>
    <h3>Counting (base ${g.numBase})</h3>
    <p class="cells">${nums1.join(" ")}</p>
    <ul class="cols">${numsBig}</ul></section>`;
}

// ── paradigms: declension + conjugation tables ───────────────────────────
const PARA_NOUNS = [STONE, KING, RIVER, HOUSE, WOLF, MOTHER, HAND, MOUNTAIN, SHIP, FOOT];
const cellHTML = (x) => {
  const toks = [...x.pre.map(t => t.w), x.text, ...x.post.map(t => t.w)].join(" ");
  return `<td class="w${x.irr ? " irr" : ""}" title="${esc(x.gloss)}">${esc(toks)}</td>`;
};
function paradigmHTML(l) {
  const shape = paradigmShape(l);
  const nounSel = PARA_NOUNS.map(c => `<option value="${c}"${c === S.noun ? " selected" : ""}>${esc(glossOf(c))}</option>`).join("");
  const verbSel = VERBS.map(c => `<option value="${c}"${c === S.verb ? " selected" : ""}>${esc(glossOf(c))}</option>`).join("");
  const nounRows = shape.cases.map(cs =>
    `<tr><td class="lbl">${esc(cs.g || "NOM")}</td>${shape.nums.map(n => cellHTML(inflectNoun(l, S.noun, { num: n, cas: cs.k }))).join("")}</tr>`).join("");
  const persCols = shape.pers.length ? shape.pers : [[null, "sg"]];
  let verbRows = shape.tam.map(t =>
    `<tr><td class="lbl">${esc(t.g || "PRS")}</td>${persCols.map(([p, n]) => cellHTML(inflectVerb(l, S.verb, { tam: t.k, pers: p, num: n }))).join("")}</tr>`).join("");
  // the imperative row (a category ~every language marks) spans the persons
  verbRows += `<tr><td class="lbl">IMP</td><td class="w" colspan="${persCols.length}" title="addressee-directed command">${
    esc((x => [...x.pre.map(t => t.w), x.text, ...x.post.map(t => t.w)].join(" "))(inflectVerb(l, S.verb, { mood: "imp" })))
  } <span class="gloss">‘${esc(glossOf(S.verb))}!’</span></td></tr>`;
  const persHead = persCols.map(([p, n]) => `<th>${p ? p + n.toUpperCase().replace("SG", "sg").replace("PL", "pl") : ""}</th>`).join("");
  const etys = affixEtymologies(l);
  const etyLine = etys.length ? `<p class="note">Every ending is a worn-down word: ${etys.map(e => `<span class="w">-${esc(e.w)}</span> <span class="lbl">${esc(e.g)}</span>${e.from ? ` <span class="gloss">‹ ‘${esc(e.from)}’</span>` : ""}${e.renewed ? ` <span class="lbl">renewed</span>` : ""}`).join(" · ")}</p>` : "";
  const isoNote = shape.iso ? `<p class="note">An isolating tongue: grammar rides on particles and word order — the words themselves never bend.${shape.redup ? " (But it still reduplicates — a process even isolating languages keep.)" : ""}</p>` : "";
  const inten = intensive(l, GREAT);
  const redupNote = shape.redup ? `<p class="note"><b>Reduplication</b> (${shape.redup.type}, for ${shape.redup.fns.join(" &amp; ")}): a copied stem${inten ? `, e.g. ‘great’ → <span class="w">${esc(inten.text)}</span> <span class="gloss">‘very great’</span>` : ""}. Watch the ${shape.redup.fns.includes("plural") ? "plural column" : ""}${shape.redup.fns.includes("plural") && shape.redup.fns.includes("aspect") ? " and " : ""}${shape.redup.fns.includes("aspect") ? "IPFV row" : ""} above.</p>` : "";
  return `<section class="card"><h2>Paradigms</h2>
    ${isoNote}
    <div class="paragrid">
    <div><h3>Declension of <select id="paraNoun">${nounSel}</select></h3>
    <div class="scroll"><table><thead><tr><th></th>${shape.nums.map(n => `<th>${n.toUpperCase()}</th>`).join("")}</tr></thead><tbody>${nounRows}</tbody></table></div></div>
    <div><h3>Conjugation of <select id="paraVerb">${verbSel}</select></h3>
    <div class="scroll"><table><thead><tr><th></th>${persHead}</tr></thead><tbody>${verbRows}</tbody></table></div></div>
    </div>
    <p class="note"><span class="irr sw"></span> irregular cells — suppletive stems, ablaut pasts, fossil fusions — cluster on the most-used verbs, the way they do in life. Hover any cell for its gloss.</p>
    ${redupNote}
    ${etyLine}</section>`;
}

// ── the sentence panel: semantic frames → interlinear clauses ────────────
const SENT_NOUNS = [KING, QUEEN, WOLF, MOTHER, RIVER, STONE, HORSE, SHIP];
const SENT_OBJS = [RIVER, HORSE, BREAD, SWORD, HOUSE, STONE, WOLF];
const PRON_EN = { "1sg": "I", "2sg": "thou", "3sg": "he", "3sgm": "he", "3sgf": "she", "1du": "we two", "2du": "you two", "1pl": "we", "1pi": "we (incl.)", "1pe": "we (excl.)", "2pl": "you", "3pl": "they" };
const EN_PAST = { go: "went", see: "saw", eat: "ate", be: "was", have: "had", come: "came", do: "did", say: "said", know: "knew", give: "gave", take: "took", make: "made", drink: "drank", sit: "sat", stand: "stood", run: "ran", fall: "fell", fight: "fought", hear: "heard", sleep: "slept" };

function frameFromState(l) {
  const st = S.sent;
  const mkArg = (code) => {
    if (code === "none") return null;
    if (code === "wh") return { wh: true };
    if (code.startsWith("p:")) {
      const k = code.slice(2);
      return { pron: { k, pers: +k[0], num: k.includes("sg") ? "sg" : k.includes("du") ? "du" : "pl" } };
    }
    return { n: +code.slice(2), def: true, adj: code.slice(2) === String(WOLF) ? BLACK : undefined };
  };
  const imp = st.mood === "imp";
  return {
    s: imp ? { pron: { k: "2sg", pers: 2, num: "sg" } } : (mkArg(st.s) || { n: KING, def: true }),
    v: { c: st.v, tam: st.tam === "none" ? null : st.tam, neg: st.neg, mood: imp ? "imp" : null },
    o: mkArg(st.o),
    loc: st.loc === "none" ? null : { adp: st.loc, n: TOWN, def: true },
    q: imp ? false : st.q,
  };
}

// a plain-English echo of the frame (UI text only — the gloss is the truth)
function englishOf(frame, l) {
  const npEn = (a) => !a ? "" : a.wh ? "what" : a.pron ? (PRON_EN[a.pron.k] || "they")
    : "the " + (a.adj != null ? glossOf(a.adj) + " " : "") + glossOf(a.n);
  const vG = glossOf(frame.v.c);
  // imperative: "(Don't) VERB (the object)!" — no subject, no tense
  if (frame.v.mood === "imp") {
    let out = (frame.v.neg ? "Don't " : "") + vG + (frame.o ? " " + npEn(frame.o) : "");
    return out.charAt(0).toUpperCase() + out.slice(1) + "!";
  }
  const tam = resolveTam(l, frame.v.tam);
  let v;
  if (frame.v.neg) v = (tam === "pst" || tam === "pfv" ? "did not " : tam === "fut" ? "will not " : "does not ") + vG;
  else if (tam === "pst" || tam === "pfv") v = EN_PAST[vG] || vG + "ed";
  else if (tam === "fut") v = "will " + vG;
  else if (tam === "ipfv") v = "keeps " + vG + "ing";
  else v = vG + "s";
  if (frame.s && frame.s.pron && ["1sg", "1pl", "1pi", "1pe", "2sg", "2pl", "3pl"].includes(frame.s.pron.k) && !frame.v.neg && !tam) v = vG;
  let out = [npEn(frame.s), v, npEn(frame.o)].filter(Boolean).join(" ");
  if (frame.loc) out += " " + frame.loc.adp + " the " + glossOf(frame.loc.n);
  if (frame.q || (frame.o && frame.o.wh)) out += "?";
  return out;
}

function interHTML(clause) {
  return `<div class="inter">${clause.tokens.map(t =>
    `<span class="tok"><span class="w">${esc(t.w)}</span><span class="tg">${esc(t.g)}</span></span>`).join("")}</div>`;
}

function sentenceHTML(l) {
  const cl = closedOf(l);
  const shape = paradigmShape(l);
  const st = S.sent;
  const sOpts = [...cl.prons.map(p => [`p:${p.k}`, PRON_EN[p.k] || p.g]), ...SENT_NOUNS.map(c => [`n:${c}`, "the " + glossOf(c)])];
  const oOpts = [["none", "—"], ["wh", "what?"], ...SENT_OBJS.map(c => [`n:${c}`, "the " + glossOf(c)])];
  const tamOpts = [["none", "present"], ...shape.tam.filter(t => t.k).map(t => [t.k, { pst: "past", fut: "future", pfv: "perfective", ipfv: "imperfective" }[t.k] || t.k])];
  const locOpts = [["none", "—"], ["in", "in the town"], ["at", "at the town"], ["under", "under the town"]];
  const moodOpts = [["decl", "statement"], ["imp", "command (imperative)"]];
  const sel = (id, opts, cur) => `<select id="${id}">${opts.map(([v, lab]) => `<option value="${esc(v)}"${String(v) === String(cur) ? " selected" : ""}>${esc(lab)}</option>`).join("")}</select>`;
  const frame = frameFromState(l);
  const clause = renderClause(l, frame);
  const imp = st.mood === "imp";
  const canned = [
    { s: { n: KING, def: true }, v: { c: SEE, tam: "pst" }, o: { n: RIVER, def: true } },
    { s: { pron: { k: "1sg", pers: 1, num: "sg" } }, v: { c: GO, tam: "pst", neg: true } },
    { s: { pron: { k: "2sg", pers: 2, num: "sg" } }, v: { c: TAKE, tam: "pst" }, o: { n: HORSE, def: true }, q: true },
    { s: { pron: { k: "3sgf", pers: 3, num: "sg" } }, v: { c: EAT, tam: "pst" }, o: { wh: true } },
    { s: { n: WOLF, def: true, adj: BLACK }, v: { c: SLEEP, tam: null }, loc: { adp: "in", n: TOWN, def: true } },
    { v: { c: GO, mood: "imp" } },
    { v: { c: TAKE, mood: "imp", neg: true }, o: { n: HORSE, def: true } },
  ];
  return `<section class="card"><h2>Sentences</h2>
    <p class="note">A semantic frame — who did what to whom, when — rendered through the language's own grammar: arguments take their cases, the verb agrees and carries tense, everything lands where the word-order dials put it, and the interlinear gloss beneath shows the machinery. This is the shape of a chronicle entry.</p>
    <div class="controls sent">
      <label>Mood ${sel("sentM", moodOpts, st.mood)}</label>
      <label${imp ? ' class="off"' : ""}>Subject ${sel("sentS", sOpts, imp ? "p:2sg" : st.s)}</label>
      <label>Verb ${sel("sentV", VERBS.map(c => [c, glossOf(c)]), st.v)}</label>
      <label${imp ? ' class="off"' : ""}>Tense ${sel("sentT", tamOpts, imp ? "none" : st.tam)}</label>
      <label>Object ${sel("sentO", oOpts, st.o)}</label>
      <label${imp ? ' class="off"' : ""}>Place ${sel("sentL", locOpts, imp ? "none" : st.loc)}</label>
      <label><input type="checkbox" id="sentNeg"${st.neg ? " checked" : ""}/> ${imp ? "prohibitive (don't!)" : "negated"}</label>
      <label${imp ? ' class="off"' : ""}><input type="checkbox" id="sentQ"${st.q && !imp ? " checked" : ""}/> question</label>
    </div>
    <p class="ensent">“${esc(englishOf(frame, l))}”</p>
    ${interHTML(clause)}
    <h3>More of the tongue</h3>
    ${canned.map(f => `<p class="ensent dim">“${esc(englishOf(f, l))}”</p>` + interHTML(renderClause(l, f))).join("")}
  </section>`;
}

const COGNATE_SET = (() => {
  const want = ["water", "river", "king", "stone", "mother", "god", "fire", "sun", "hand", "wolf"];
  return CONCEPTS.map((c, i) => ({ i, g: c.g })).filter(x => want.includes(x.g)).map(x => x.i);
})();

function cognatesHTML() {
  if (lineage.length < 2 && !donor) return "";
  const cols = [...lineage];
  let rows = COGNATE_SET.map(cid =>
    `<tr><td class="lbl">${esc(glossOf(cid))}</td>${cols.map(l => `<td class="w">${esc(wordOf(l, cid))}</td>`).join("")}</tr>`).join("");
  // M5: cognate CONJUGATIONS — the same paradigm cell down the family,
  // built from shared sources at shared birth points, diverged by sound law
  const cellTok = (x) => [...x.pre.map(t => t.w), x.text, ...x.post.map(t => t.w)].join(" ");
  const infRow = (label, cell) =>
    `<tr><td class="lbl">${esc(label)}</td>${cols.map(l => { const x = cell(l); return `<td class="w${x.irr ? " irr" : ""}" title="${esc(x.gloss)}">${esc(cellTok(x))}</td>`; }).join("")}</tr>`;
  rows += infRow("stones (PL)", (l) => inflectNoun(l, STONE, { num: "pl" }));
  rows += infRow("went (go+PST/PFV)", (l) => {
    const shape = paradigmShape(l);
    const marked = shape.tam.find(t => t.k === "pst") || shape.tam.find(t => t.k === "pfv") || shape.tam[0];
    return inflectVerb(l, VERBS[2], { tam: marked.k, pers: shape.pers.length ? "3" : null, num: "sg" });
  });
  const heads = cols.map((l, i) => `<th>${i === 0 ? "root" : "daughter " + i}<div class="sub">${esc(langWord(l, 0))} · ${l.rules.length} changes</div></th>`).join("");
  return `<section class="card"><h2>Cognates down the family</h2>
    <p class="note">One family root, replayed through each tongue's own chain of sound changes — the correspondences are regular, like real sister languages. The last two rows are inflected: cognate <em>conjugations</em>, because affix sources and birth points are family property too.</p>
    <div class="scroll"><table><thead><tr><th></th>${heads}</tr></thead><tbody>${rows}</tbody></table></div></section>`;
}

// ── coined abstractions: the intentional-derivation showcase ─────────────
const ABSTRACT_SHOW = (() => {
  const want = ["king", "queen", "god", "spirit", "holy", "priest", "law", "oath",
    "throne", "crown", "tax", "council", "victory", "army", "guard", "noble"];
  return want.map(g => CONCEPTS.findIndex(c => c.g === g)).filter(i => i >= 0);
})();
function derivationsHTML(l) {
  const loanSet = new Set((l.loans || []).map(x => x.c));
  const items = ABSTRACT_SHOW.map(cid => {
    const ety = etymologyOf(l, cid);
    const w = wordOf(l, cid);
    // a loan shadows the native coinage (etymologyOf is null under a loan), so
    // the word is BORROWED, not an opaque native root — say so
    const tail = ety ? `<span class="gloss">‹ ‘${esc(ety.gloss)}’</span>`
      : loanSet.has(cid) ? `<span class="gloss lost">borrowed</span>`
        : `<span class="gloss lost">opaque root</span>`;
    return `<li><span class="lbl">${esc(glossOf(cid))}</span> <span class="w">${esc(w)}</span> ${tail}</li>`;
  }).join("");
  const nDerived = ABSTRACT_SHOW.filter(cid => etymologyOf(l, cid)).length;
  return `<section class="card"><h2>Coined abstractions <span class="count">(${nDerived}/${ABSTRACT_SHOW.length} derived on purpose)</span></h2>
    <p class="note">Abstract words needn't be opaque roots: most tongues <em>build</em> them out of concrete ones, along a curated table of plausible pathways rolled once per family — <span class="w">king</span> from “great man”, <span class="w">god</span> from “sky father”, <span class="w">law</span> from “old saying”, <span class="w">victory</span> from “war's end”. The etymology is recoverable and drifts with the rest of the language (branch a daughter and watch it shift); a different family coins the same idea from different parts, and some keep an opaque root. Same machine that gives ‘ford’ its ‘water’.</p>
    <ul class="cols">${items}</ul></section>`;
}

function loansHTML(l) {
  if (!l.loans.length) return "";
  const seen = new Set();
  const items = [];
  for (let i = l.loans.length - 1; i >= 0; i--) {
    const { c, w } = l.loans[i];
    if (seen.has(c)) continue;
    seen.add(c);
    items.push(`<li><span class="lbl">${esc(glossOf(c))}</span> <span class="w">${esc(w)}</span> <span class="gloss">borrowed</span> <span class="w dim">${esc(renderNative(l, c))}</span> <span class="gloss lost">native, displaced</span></li>`);
  }
  return `<h3>Loan stratum</h3><ul class="cols">${items.join("")}</ul>`;
}
// what the native word WOULD be (loans shadow it) — peek by cloning sans loans
function renderNative(l, cid) {
  const ghost = { ...l, loans: [], xph: l.xph || [] };
  return wordOf(ghost, cid);
}

function dictionaryHTML(l) {
  const byWord = new Map();
  // numeral concepts show their COUNTING form (base-5 'six' is 'five-one',
  // not a separate root) so the dictionary agrees with the Grammar card
  const rows = CONCEPTS.map((c, cid) => ({ cid, g: c.g, d: c.d, w: numeralConceptWord(l, cid) || wordOf(l, cid) }));
  for (const r of rows) byWord.set(r.w, (byWord.get(r.w) || 0) + 1);
  const loanSet = new Set((l.loans || []).map(x => x.c));
  // words that two concepts share ON PURPOSE (colexification, tree=wood) vs by
  // accident (an unrepaired homophone) — label them differently
  const colexWords = new Set();
  CONCEPTS.forEach((c, cid) => { if (colexPartner(l, cid) >= 0) colexWords.add(wordOf(l, cid)); });
  const q = S.search.trim().toLowerCase();
  const body = rows
    .filter(r => !q || r.g.includes(q) || r.w.toLowerCase().includes(q))
    .map(r => {
      const notes = [];
      if (loanSet.has(r.cid)) notes.push("loan");
      if (byWord.get(r.w) > 1) notes.push(colexWords.has(r.w) ? "shared word" : "homophone");
      const ety = etymologyOf(l, r.cid);
      const from = ety ? `‹ ‘${esc(ety.gloss)}’` : "";
      return `<tr><td>${esc(r.g)}</td><td class="w">${esc(r.w)}</td><td class="gloss">${from}</td><td class="lbl">${esc(r.d)}</td><td class="gloss">${notes.join(" · ")}</td></tr>`;
    }).join("");
  return `<section class="card"><h2>Dictionary <span class="count">(${rows.length} concepts, virtual)</span></h2>
    <p class="note">Every entry is computed on demand from the language's seed and history — nothing is stored. The <span class="gloss">‹ etymology</span> column shows words this family built from other concepts (ford ‹ ‘water river’, king ‹ ‘great man’). “Shared word” = two concepts this family colexifies on purpose (one word for tree&nbsp;and&nbsp;wood); “homophone” = an accidental sound-alike; “loan” = a word taken from a contact language, shadowing the native form.</p>
    <input id="dictSearch" type="search" placeholder="Search meaning or word…" value="${esc(S.search)}" />
    <div class="scroll tall"><table><thead><tr><th>meaning</th><th>word</th><th>etymology</th><th>domain</th><th>notes</th></tr></thead><tbody>${body}</tbody></table></div></section>`;
}

function render() {
  const l = active();
  document.getElementById("app").innerHTML = `
  <header>
    <h1>Simman <em>Language Lab</em></h1>
    <p class="tag">Roll a tongue, listen to it drift, branch its daughters, watch it borrow. Same engine the world sim names its history with.</p>
  </header>
  <section class="controls card">
    <label>Shape
      <select id="preset">
        <option value="random"${S.preset === "random" ? " selected" : ""}>Random (typological roll)</option>
        ${REF_KINDS.map(k => `<option value="${k}"${S.preset === k ? " selected" : ""}>${k[0].toUpperCase() + k.slice(1)}-shaped (pinned sounds)</option>`).join("")}
      </select>
    </label>
    <label>Seed <input id="seed" type="number" value="${S.seed}" /></label>
    <button id="reroll">New language</button>
    <span class="divider"></span>
    <button id="drift" title="Apply one sound change to every native word">Drift (sound change)</button>
    <label class="slider">Divergence <input id="div" type="range" min="0.2" max="1" step="0.1" value="${S.divergence}" /></label>
    <button id="branch" title="Found a daughter language, drifted by the divergence distance">Branch a daughter</button>
    <button id="borrow" title="Contact with a foreign tongue: borrow a sound and a prestige word">Borrow from a neighbour</button>
  </section>
  <section class="card">
    <h2>Specimen: <span class="w big">${esc(langWord(l, 0))}</span>${lineage.length > 1 ? `<span class="count"> — daughter ${lineage.length - 1} of the family</span>` : ""}</h2>
    <div class="chips">${chips(l)}</div>
    ${inventoryHTML(l)}
    ${namesHTML(l)}
    ${loansHTML(l)}
  </section>
  ${grammarHTML(l)}
  ${sentenceHTML(l)}
  ${paradigmHTML(l)}
  ${cognatesHTML()}
  ${derivationsHTML(l)}
  ${dictionaryHTML(l)}
  <footer>Deterministic: the same seed and history always speak the same words. · <span class="gloss">glosses in ochre are meanings</span> · build ${typeof __BUILD__ !== "undefined" ? __BUILD__ : "dev"}</footer>`;

  document.getElementById("reroll").onclick = () => { S.seed = Number(document.getElementById("seed").value) || 1; S.preset = document.getElementById("preset").value; reset(); render(); };
  document.getElementById("paraNoun").onchange = (e) => { S.noun = Number(e.target.value); render(); };
  document.getElementById("paraVerb").onchange = (e) => { S.verb = Number(e.target.value); render(); };
  document.getElementById("sentM").onchange = (e) => { S.sent.mood = e.target.value; render(); };
  document.getElementById("sentS").onchange = (e) => { S.sent.s = e.target.value; render(); };
  document.getElementById("sentV").onchange = (e) => { S.sent.v = Number(e.target.value); render(); };
  document.getElementById("sentT").onchange = (e) => { S.sent.tam = e.target.value; render(); };
  document.getElementById("sentO").onchange = (e) => { S.sent.o = e.target.value; render(); };
  document.getElementById("sentL").onchange = (e) => { S.sent.loc = e.target.value; render(); };
  document.getElementById("sentNeg").onchange = (e) => { S.sent.neg = e.target.checked; render(); };
  document.getElementById("sentQ").onchange = (e) => { S.sent.q = e.target.checked; render(); };
  document.getElementById("preset").onchange = (e) => { S.preset = e.target.value; reset(); render(); };
  document.getElementById("drift").onclick = () => { driftLanguage(world, active()); render(); };
  document.getElementById("div").oninput = (e) => { S.divergence = Number(e.target.value); };
  document.getElementById("branch").onclick = () => { world.step += 500; lineage.push(branchLanguage(world, active(), S.divergence)); render(); };
  document.getElementById("borrow").onclick = () => {
    if (!donor) donor = foundLanguage(world, { seed: (S.seed * 2654435761 + 7) >>> 0 });
    borrowFrom(world, active(), donor); render();
  };
  const ds = document.getElementById("dictSearch");
  ds.oninput = (e) => {
    S.search = e.target.value;
    const scrollTop = ds.closest("section").querySelector(".scroll").scrollTop;
    const focused = document.activeElement === ds;
    render();
    if (focused) { const el = document.getElementById("dictSearch"); el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
    document.querySelectorAll(".scroll.tall").forEach(x => x.scrollTop = scrollTop);
  };
}

const CSS = `
:root{
  --paper:#f6f5f1; --ink:#20241f; --muted:#6d7268; --line:#d9d7cf;
  --card:#fdfcf9; --accent:#2e6e5e; --accent-ink:#fff; --gloss:#9a6b1f; --chipbg:#ecefe9;
}
@media (prefers-color-scheme: dark){:root{
  --paper:#161915; --ink:#e7e5dc; --muted:#9aa094; --line:#33382f;
  --card:#1d211c; --accent:#66b398; --accent-ink:#10241c; --gloss:#d4a24a; --chipbg:#242a23;
}}
:root[data-theme="dark"]{
  --paper:#161915; --ink:#e7e5dc; --muted:#9aa094; --line:#33382f;
  --card:#1d211c; --accent:#66b398; --accent-ink:#10241c; --gloss:#d4a24a; --chipbg:#242a23;
}
:root[data-theme="light"]{
  --paper:#f6f5f1; --ink:#20241f; --muted:#6d7268; --line:#d9d7cf;
  --card:#fdfcf9; --accent:#2e6e5e; --accent-ink:#fff; --gloss:#9a6b1f; --chipbg:#ecefe9;
}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);
  font:16px/1.55 "Iowan Old Style","Palatino Linotype","Book Antiqua",Palatino,Georgia,serif;}
#app{max-width:60rem;margin:0 auto;padding:1.5rem 1.25rem 4rem;display:flex;flex-direction:column;gap:1.1rem}
header h1{font-size:1.9rem;margin:0;letter-spacing:.01em;text-wrap:balance}
header h1 em{color:var(--accent);font-style:italic}
.tag{color:var(--muted);margin:.3rem 0 0;max-width:46rem}
.card{background:var(--card);border:1px solid var(--line);border-radius:6px;padding:1rem 1.2rem}
h2{font-size:1.15rem;margin:.1rem 0 .6rem}
h3{font-size:.8rem;text-transform:uppercase;letter-spacing:.09em;color:var(--muted);margin:1rem 0 .3rem}
.count{font-size:.85rem;color:var(--muted);font-weight:normal}
.w{font-family:ui-monospace,"SF Mono","Cascadia Code",Consolas,Menlo,monospace;font-size:.92em}
.w.big{font-size:1.05em;color:var(--accent)}
.w.dim{opacity:.55}
.gloss{color:var(--gloss);font-style:italic}
.gloss.lost{opacity:.6}
.lbl{font-size:.72rem;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)}
.lbl.ind{margin-left:1rem}
.chips{display:flex;flex-wrap:wrap;gap:.35rem;margin-bottom:.7rem}
.chip{background:var(--chipbg);border-radius:999px;padding:.12rem .6rem;font-size:.78rem;color:var(--ink)}
.inv{margin:.15rem 0}
.inv .w{margin-left:.4rem}
ul.cols{columns:2;gap:2rem;margin:.2rem 0;padding-left:1.1rem}
ul.cols li{margin:.12rem 0;break-inside:avoid}
.cells{margin:.2rem 0;line-height:2}
.cell{white-space:nowrap;background:var(--chipbg);border-radius:4px;padding:.1rem .45rem;margin-right:.2rem}
.paragrid{display:grid;grid-template-columns:1fr 1fr;gap:1.5rem}
@media (max-width:720px){.paragrid{grid-template-columns:1fr}}
td.irr{color:var(--gloss)}
.irr.sw{display:inline-block;width:.7em;height:.7em;background:var(--gloss);border-radius:2px;vertical-align:baseline}
.paragrid h3 select{font-size:.95rem;text-transform:none;letter-spacing:0}
.controls.sent{margin:.4rem 0 .8rem}
.controls.sent label{gap:.3rem}
.controls.sent label.off{opacity:.4}
.ensent{color:var(--muted);font-style:italic;margin:.6rem 0 .15rem}
.ensent.dim{margin-top:1rem}
.inter{display:flex;flex-wrap:wrap;gap:.15rem .9rem;align-items:flex-start;margin:.15rem 0 .4rem}
.tok{display:inline-flex;flex-direction:column;align-items:flex-start}
.tok .w{font-size:1.02em}
.tok .tg{font-size:.68rem;color:var(--gloss);letter-spacing:.02em;margin-top:.05rem}
.controls{display:flex;flex-wrap:wrap;gap:.6rem 1rem;align-items:center}
.controls label{display:flex;align-items:center;gap:.4rem;font-size:.85rem;color:var(--muted)}
.controls .divider{flex-basis:100%;height:0}
select,input[type=number],input[type=search]{font:inherit;color:var(--ink);background:var(--paper);
  border:1px solid var(--line);border-radius:4px;padding:.3rem .5rem}
input[type=number]{width:7.5rem}
input[type=search]{width:100%;max-width:22rem;margin:.2rem 0 .6rem}
button{font:inherit;font-size:.9rem;background:var(--accent);color:var(--accent-ink);
  border:none;border-radius:4px;padding:.42rem .9rem;cursor:pointer}
button:hover{filter:brightness(1.08)}
button:focus-visible,select:focus-visible,input:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.slider input{accent-color:var(--accent)}
.note{color:var(--muted);font-size:.85rem;margin:.1rem 0 .6rem;max-width:46rem}
.scroll{overflow-x:auto}
.scroll.tall{max-height:24rem;overflow-y:auto}
table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}
th,td{text-align:left;padding:.3rem .7rem .3rem 0;border-bottom:1px solid var(--line);vertical-align:top}
th{font-size:.72rem;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)}
th .sub{font-family:ui-monospace,Consolas,monospace;text-transform:none;letter-spacing:0;font-weight:normal;margin-top:.15rem}
footer{color:var(--muted);font-size:.8rem;border-top:1px solid var(--line);padding-top:.8rem}
@media (max-width:640px){ul.cols{columns:1}}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
`;

export function mount() {
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);
  if (!document.getElementById("app")) {
    const div = document.createElement("div");
    div.id = "app";
    document.body.appendChild(div);
  }
  reset();
  render();
}

if (typeof document !== "undefined") mount();

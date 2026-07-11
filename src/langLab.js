// ── Simman Language Lab ───────────────────────────────────────────────────
// A standalone playground for the language system (docs/language-
// comprehensive-spec.md). Dependency-free vanilla DOM — deliberately outside
// the React app so it can be served as /langlab.html in dev or bundled into
// a single self-contained page, without touching the world sim at all.

import { foundLanguage, branchLanguage, driftLanguage, borrowFrom, langWord, langPlaceNameEx, langPersonName, langDynastyName, langRealmName, wordOf, glossOf } from "./sim/language.js";
import { buildInventory, romanizeC, romanizeV } from "./sim/languagePhonology.js";
import { applyReference, REF_KINDS } from "./sim/languageRefs.js";
import { CONCEPTS } from "./sim/languageLexicon.js";
import { gramOf, closedOf, numeral, inflectNoun, inflectVerb, paradigmShape, affixEtymologies } from "./sim/languageGrammar.js";
import { STONE, KING, RIVER, HOUSE, WOLF, MOTHER, HAND, MOUNTAIN, SHIP, FOOT, VERBS } from "./sim/languageLexicon.js";

// ── state ────────────────────────────────────────────────────────────────
let world, lineage, donor;
const S = { seed: 8817, preset: "random", divergence: 0.5, search: "", noun: STONE, verb: VERBS[2] };

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
  const verbRows = shape.tam.map(t =>
    `<tr><td class="lbl">${esc(t.g || "PRS")}</td>${persCols.map(([p, n]) => cellHTML(inflectVerb(l, S.verb, { tam: t.k, pers: p, num: n }))).join("")}</tr>`).join("");
  const persHead = persCols.map(([p, n]) => `<th>${p ? p + n.toUpperCase().replace("SG", "sg").replace("PL", "pl") : ""}</th>`).join("");
  const etys = affixEtymologies(l);
  const etyLine = etys.length ? `<p class="note">Every ending is a worn-down word: ${etys.map(e => `<span class="w">-${esc(e.w)}</span> <span class="lbl">${esc(e.g)}</span> <span class="gloss">‹ ‘${esc(e.from)}’</span>`).join(" · ")}</p>` : "";
  const isoNote = shape.iso ? `<p class="note">An isolating tongue: grammar rides on particles and word order — the words themselves never bend.</p>` : "";
  return `<section class="card"><h2>Paradigms</h2>
    ${isoNote}
    <div class="paragrid">
    <div><h3>Declension of <select id="paraNoun">${nounSel}</select></h3>
    <div class="scroll"><table><thead><tr><th></th>${shape.nums.map(n => `<th>${n.toUpperCase()}</th>`).join("")}</tr></thead><tbody>${nounRows}</tbody></table></div></div>
    <div><h3>Conjugation of <select id="paraVerb">${verbSel}</select></h3>
    <div class="scroll"><table><thead><tr><th></th>${persHead}</tr></thead><tbody>${verbRows}</tbody></table></div></div>
    </div>
    <p class="note"><span class="irr sw"></span> irregular cells — suppletive stems, ablaut pasts, fossil fusions — cluster on the most-used verbs, the way they do in life. Hover any cell for its gloss.</p>
    ${etyLine}</section>`;
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
  const heads = cols.map((l, i) => `<th>${i === 0 ? "root" : "daughter " + i}<div class="sub">${esc(langWord(l, 0))} · ${l.rules.length} changes</div></th>`).join("");
  return `<section class="card"><h2>Cognates down the family</h2>
    <p class="note">One family root, replayed through each tongue's own chain of sound changes — the correspondences are regular, like real sister languages.</p>
    <div class="scroll"><table><thead><tr><th></th>${heads}</tr></thead><tbody>${rows}</tbody></table></div></section>`;
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
  const rows = CONCEPTS.map((c, cid) => ({ cid, g: c.g, d: c.d, w: wordOf(l, cid) }));
  for (const r of rows) byWord.set(r.w, (byWord.get(r.w) || 0) + 1);
  const loanSet = new Set((l.loans || []).map(x => x.c));
  const q = S.search.trim().toLowerCase();
  const body = rows
    .filter(r => !q || r.g.includes(q) || r.w.toLowerCase().includes(q))
    .map(r => {
      const notes = [];
      if (loanSet.has(r.cid)) notes.push("loan");
      if (byWord.get(r.w) > 1) notes.push("shared word");
      return `<tr><td>${esc(r.g)}</td><td class="w">${esc(r.w)}</td><td class="lbl">${esc(r.d)}</td><td class="gloss">${notes.join(" · ")}</td></tr>`;
    }).join("");
  return `<section class="card"><h2>Dictionary <span class="count">(${rows.length} concepts, virtual)</span></h2>
    <p class="note">Every entry is computed on demand from the language's seed and history — nothing is stored. “Shared word” = two concepts this family colexifies (one word for tree&nbsp;and&nbsp;wood); “loan” = a word taken from a contact language, shadowing the native form.</p>
    <input id="dictSearch" type="search" placeholder="Search meaning or word…" value="${esc(S.search)}" />
    <div class="scroll tall"><table><thead><tr><th>meaning</th><th>word</th><th>domain</th><th>notes</th></tr></thead><tbody>${body}</tbody></table></div></section>`;
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
  ${paradigmHTML(l)}
  ${cognatesHTML()}
  ${dictionaryHTML(l)}
  <footer>Deterministic: the same seed and history always speak the same words. · <span class="gloss">glosses in ochre are meanings</span> · build ${typeof __BUILD__ !== "undefined" ? __BUILD__ : "dev"}</footer>`;

  document.getElementById("reroll").onclick = () => { S.seed = Number(document.getElementById("seed").value) || 1; S.preset = document.getElementById("preset").value; reset(); render(); };
  document.getElementById("paraNoun").onchange = (e) => { S.noun = Number(e.target.value); render(); };
  document.getElementById("paraVerb").onchange = (e) => { S.verb = Number(e.target.value); render(); };
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

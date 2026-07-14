# Spec — Completing the typological coverage: the grammar frontier

Status: **BUILT — all nine phases shipped, gated green.** Companion to
`docs/language-comprehensive-spec.md` (read that first — L1–L5 + M1–M5 build
history, the two house invariants, the reference-profile capability bar). That doc
took the language system through phonology, lexicon, sound change, and a
single-clause grammar/sentence layer (sessions 1–13). This doc is the **completion
pass**: the eight grammatical clusters the audits kept parking — the ones that make
the parameter space actually *span* the world's languages instead of covering the
common ~80%.

> ### Build status (all 8 clusters / 35 features implemented)
> The 9-phase plan of §9 is complete and pushed. `tools/probe_langfit.mjs` grew
> **106 → 261 checks**; `npm test` (smoke), `npm run validate` (stylized facts),
> and lint stay green at every commit. Each phase kept the prior checks green (the
> byte-identity regression) and added a `§14+` section.
>
> | Phase | Cluster | Ships |
> |-------|---------|-------|
> | P1 | Concept + side-table appends | `SEEM/BODY/LEAF/EXCEED/SAME/LORD`, `AGENTIVITY`, `CLF_SENSE` |
> | P2 | Concord (A) | emergent noun class, concord propagation, `inflectAdj`, pronoun case |
> | P3 | Alignment (F) | the `coreCaseOf` resolver + active / tripartite / split-erg / direct-inverse |
> | P4 | Voice (B) | causative / passive / antipassive / applicative |
> | P5 | TAM (C′) | graded tense, perfect/prog/hab, irrealis moods, mirativity, the `resolveMir` seam |
> | P6 | Evidentiality (C) | the `evid` system + SEE/HEAR/SAY/SEEM exponents + evidential mirativity |
> | P7 | Classifiers (D) | sortal numeral classifiers, `CLF_SENSE` assignment, `numeralPhrase` |
> | P8 | Nominal (E) | paucal/trial, alienable possession, comparison, T-V + honorifics |
> | P9 | Multi-clause (G) | `renderClauseTree` — coordination, complement / adverbial / relative clauses, chaining + switch-reference |
>
> **Corrections applied during the build** (beyond the per-cluster critique notes):
> (P6) evidentials dedupe in their OWN pass, not the shared cross-class sweep,
> which exhausts the single-syllable escape space on a many-case language and
> collapses them; the outer evidential tier is dash-glossed even in fusional
> paradigms. (P8) the T-V polite form is built AFTER the closed-class dedupes and
> kept out of them, so the plural syncretism (`2v == 2pl`) survives; `dedupe`/
> `dedupeAffixSet` gained a non-mutating `seed` param so possessive/honorific/
> linker affixes dedupe against the finalized cases/TAM without a re-baseline.
> (P9) `renderClause` gained a third `opts` argument (medial / gap / nfVerb) and
> `renderClause`'s `seq` became reassignable for the adverbial wrap.

Code surface: `src/sim/languageGrammar.js` (dials, closed classes, paradigms,
`renderClause`), `src/sim/languageLexicon.js` (concept graph + side tables),
`src/sim/language.js` (records, `wordOf`, `nativeStemOf`), `src/sim/languageRefs.js`
(the three pinned profiles), `tools/probe_langfit.mjs` (acceptance gates, 106 →
**261** checks after the build). **No `src/sim/peopleSim/` or chronicle wiring** —
this stays a pure generator + Language-Lab capability, exactly as M4 shipped
"Lab-side only."

## Directive

Extend the grammar so the dials can express the RARE-but-real typology, not just
the common core: full agreement, voice/valency, evidentiality, numeral
classifiers, the nominal categories (possession/comparison/politeness/extra
number), deeper TAM, the minority alignments, and multi-clause syntax. As always,
"capable of recreating" means the DIALS can be *set* to a profile whose output is
recognizably that shape — never that we ship real grammars as content. Generated
languages stay procedural; the three reference profiles are the pinned corner of
the space.

The work is grouped **A–G** (plus a TAM strand that pairs with C):

| Grp | Cluster | Doc §  | Effort |
|-----|---------|--------|--------|
| A | Concord & agreement completion (noun class, adjective, verb, pronoun case) | §2 | L |
| B | Voice & valency (causative, passive, antipassive, applicative) | §3 | L |
| C | Evidentiality & epistemic marking | §1 | L |
| C′ | TAM & mood depth (remoteness, aspect, irrealis moods, mirativity) | §6 | L |
| D | Numeral classifiers (sortal) | §4 | M |
| E | Nominal categories (number, possession, comparison, politeness) | §5 | L |
| F | Alignment refinements & splits | §7 | L |
| G | Multi-clause: coordination & subordination | §8 | XL |

**35 features across 8 clusters.** Sections below are ordered as the reader
requested (evidentiality, concord, voice, classifiers, nominal, TAM, alignment,
multiclause); the recommended *build* order is different and lives in §9.

Every design here was run through an adversarial critique; the "Corrections
applied" line at the head of each cluster records what the critique changed, and
the body already presents the **corrected** mechanism as the plan.

---

## 0. Shared conventions & invariants

These bind every feature in this doc. They are the two cardinal rules plus five
mechanical invariants the critiques repeatedly leaned on.

### 0.1 Cardinal Rule 1 — everything emerges from STATE, never time
No feature gates on tick/year/era. Presence, size, and choice-of-strategy are read
from the family's `prof.gram` dials (rolled once per family from `famSeed`),
`prof.morph`, word order, `caseN`, `agree`, `tenses`/`aspect`, `align`, and — at
render time — the clause's own resolved TAM and each argument's person/animacy
rank. "Areal" phenomena (evidentiality, classifiers, chaining) are modelled as
**descent**: the roll is keyed on `famSeed`, so a family and its daughters share
it (carried down the deep-cloned `prof` in `branchLanguage`). Diachronic clamps
(e.g. "evidentials are a young outer layer") gate on the **rule-log index**
(accumulated sound-change history = emergent state), never wall-clock.

### 0.2 Cardinal Rule 2 — build the SYSTEM, never fit the OUTCOME
No constant exists only to make a named language come out right. Every threshold
is a WALS-shaped frequency or correlation ratio with independent typological
meaning. Semantic side tables (`AGENTIVITY`, `CLF_SENSE`, `DERIV`, `COLEX`) encode
world-knowledge dimensions, never a language's answer. Grammaticalization is
honest: every marker is a worn-down existing word replayed through the rule log
(the "onion") so it is cognate across a family and drifts under sound law.

### 0.3 Own-hash-stream determinism
Every new dial reads its OWN named substream `h01(famSeed, "g:"+key)` (helper
`H(k)` in `rollGrammar`). New streams cannot perturb existing rolls — verified:
no proposed key (`ev/evn/evmir/clf/clfob/cau/pass/apass/appl/rmp/rmf/prf/prog/hab/
moodn/mir/actv/afl/trip/esp/hsp/inv/aba/tv/poss/tri/pau/cmp/coordf/cmps/cmpf/relord/
relstr/chn/sr/...`) collides with an existing `g:` key (notably `g:cl` clusivity ≠
`g:clf` classifier). Re-**reading** an existing stream (e.g. `g:pl` for the
classifier↔plural complementarity) is a stateless hash read and consumes nothing.

> **THE LOAD-BEARING DETERMINISM CONSTRAINT (shared mutable state).** Own-stream
> discipline is necessary but **not sufficient**. `paradigmSpec` threads one mutable
> `taken` Set through every `pickSrc` call (`pickSrc` does `taken.add(src)`), and
> `dedupeAffixSet`/`closedOf`'s cross-class sweep mutate later array entries in
> place. Any new source-claiming `mkAff` inserted *before* an existing category
> that shares a source concept (caus↔dat both quarry GIVE; pass↔pfv both quarry
> FALL; prog↔ipfv both SIT/STAND; COME shared by fut/rec/near/sbjv) will bump the
> existing category's pick to null and **break byte-identity**. Therefore:
> **every new source-claiming `mkAff` call is APPENDED strictly after all existing
> `pl/du/cases/tam` calls, and every new affix is APPENDED at the END of the
> `dedupeAffixSet` arrays; new closed-class linkers get a FRESH `seen` seeded from
> the finalized existing forms and are never added to the line-417 cross-class
> array.** A canonical append order across clusters is fixed in §9.4. Every cluster
> ships a **before/after byte-identity regression gate** (snapshot closed classes +
> paradigms + names for fixed seeds pre-feature, assert unchanged post-feature).

### 0.4 Frozen API — new capability = new export only
`renderClause(lang, frame)`, `inflectVerb(lang, cid, opts)`, `inflectNoun(lang,
cid, opts)`, and the public name API keep their signatures. New capability ships
as (a) a **new export**, or (b) an **additive optional `opts` key** (the pattern
`mood:'imp'` already used), or (c) an **opt-in frame field** (§0.6). New exports
collected in §10.2.

### 0.5 Reference pinning
Every new `prof.gram` dial is pinned in **all three** `refProfile` gram literals
(mandarin/russian/english) in `languageRefs.js`, in the same commit that adds the
roll. `refProfile` overwrites the whole gram literal, so an unpinned dial reads
`undefined` in a reference — and several gates assert `=== null`, so refs must set
the "off" value **explicitly** (`null`/`false`, not omitted). Where a reference
needs a value the free roll wouldn't produce (Mandarin `bǐ` standard-first in a VO
language; Russian `-a`→fem formal cue), that value is **sanctioned scenario data**
pinned like `EARTH_HEARTH_SITES` — documented so no one "fixes" the anomaly.

### 0.6 Opt-in frame fields (byte-identical existing output)
Every new frame field defaults to absent/null. A bare pre-existing frame renders
**byte-identical**, so all ~106 current gates hold. New fields: `v.ev`, `v.mir`,
`v.voice`, `v.hon`, `v.mood` (extended value set), `v.vol`; `arg.count`,
`arg.poss`, `arg.pol`/`pron.pol`, `arg.dem`, `arg.rel`; `o.comp`; `frame.adv`; and
the tree combinators `{coord,clauses}` / `{chain}`.

### 0.7 Append-only concept & rule ids
Persisted ids (concept indices, rule-log ids, loan records) are append-only. The
six new concepts (§10.1) go at the END of the `D[]` array in `languageLexicon.js`
(after `HUNDRED`, index 246); side tables (`AGENTIVITY`, `CLF_SENSE`) key on
existing ids. After any append, re-run §6 (irregularity band) and §11 (homophony
<18% budget) — appended concepts seed LAST and only ever bump themselves.

### 0.8 Review-loop method
Each cluster ships its gates in a new `§14+` probe section following the existing
`check()`/section idiom, then goes through the generate → fresh-reader →
complaint-becomes-a-gate loop that sessions 8–13 used. Names re-baseline only where
noted (cosmetic, accepted per comprehensive-spec open-question 2); several clusters
(classifiers, voice, TAM, evidentiality, multiclause) touch **only** the
grammar/sentence layer and cause **no** name re-baseline — `probe_hashbase` does not
move.

### 0.9 Cross-cluster reconciliations (conflicts resolved once, here)
Four surfaces are touched by multiple clusters; each is unified so the clusters
compose:

- **The `renderClause` core-case block (lines ~1318-1322)** is rewritten ONCE, by
  Alignment (§7), into a per-argument resolver `coreCaseOf(arg, role, effAlign)` +
  `effAlign` (tam/hierarchy split). **Voice (§3) rides it**: the voice prepass
  rebinds `sArg/oArg/trans/detrans/coreCase/objPers` from the remapped roles, then
  calls the same resolver. Build Alignment's resolver before Voice.
- **The mirativity slot** is shared by Evidentiality (§1 F3, `evid.mir`) and TAM
  (§6 F4). Reconciled to **one** `v.mir` frame field and **one** `resolveMir(lang,
  frame)` seam: if an evidential system exists, the evidential mir (EXTEND the
  indirect/inferred marker, or a dedicated exponent) wins; otherwise the TAM
  pathway (perfect-syncretism / the -miş pattern / SEE·FINISH) fires. TAM ships
  `resolveMir` with only its branch; Evidentiality extends it with the evid branch.
- **The `np()` NP renderer** is a hotspot (concord agreement + adjective,
  classifiers `count`, nominal `poss`/`pol`, multiclause `rel`/`comp`). Canonical
  branch order in `np()`: `arg.comp` → `arg.rel` → `arg.count` → poss/pol/adj/def
  core. Each branch returns the same `{tokens,text,gloss}` shape so gloss-alignment
  is invariant.
- **Split ergativity** appears in Concord F4 (independent pronoun case paradigm,
  nom-acc even under noun ergativity) and Alignment F4 (clause-level Silverstein
  hierarchy). Different layers: the pronoun's citation paradigm vs the clause's
  core-case assignment. Both read pronoun person; neither restructures the other.

---

## §1. Evidentiality & epistemic marking  (Group C)

**Corrections applied:** register+clamp `births['ev:'+val]` BEFORE `mkAff` (else NaN
poisons the onion); reconcile `evidMap` with its gates (sens→dir for n=2 is correct,
add dir→vis for n=4); soften the size gate to "2-term is the plurality" (the numbers
land ~41%, not >45%); **consolidate iso realization onto the `mkAff`/onion path**
(render `spec.evid[val].syl` neutral-tone as an enclitic, exactly as iso TAM reuses
`spec.tam` — delete the parallel `closedOf.evid`/`pickEvidSrc`/`isoEvidToken`);
document `synth = agg||tmpl` (fusional IE largely lacks grammatical evidentiality);
suppress mir under imperative + gate it; state the exact insertion point (after the
person block, before the final `dedupeAffixSet`).

New concept: **`SEEM`** = `c("seem","act",0.7)` appended after `HUNDRED`, added to
`VERBS`. New export: **`evidentialSystem(lang)`**.

### F1 — Evidential system presence & size dial
- **What:** `prof.gram.evid = null | {n:2|3|4, mir:"extend"|"dedicated"|null, zeroDirect:bool}`.
  `n=2` firsthand/non-firsthand (`dir/indir`); `n=3` `dir/infr/rept` (Quechua
  -mi/-chi/-shi); `n=4` `vis/sens/infr/rept` (Tariana).
- **WALS:** 78A — ~43% have some grammatical evidentiality; target ~30–40% of
  rolled langs (band `[0.22,0.50]`). Size skew: 2-term commonest, then 3, then 4.
- **Mechanism (state):** presence rate by `prof.morph` (agg 0.50, tmpl 0.42, fus
  0.30, iso 0.16) × OV boost (ov ×1.2, v1 ×0.8) — evidentiality skews synthetic +
  verb-final; `synth = m==="agg"||m==="tmpl"`. Inherited unchanged down a family.
- **Dials/streams:** `H('ev')` presence, `H('evn')` size, `H('evmir')` mir mode,
  `H('evzd')` zeroDirect (`zeroDirect = H('evzd')<0.72` — firsthand zero-marked, the
  norm). Size: `r=H('evn'); n = r<(synth?0.34:0.56)?2 : r<(synth?0.72:0.87)?3 : 4`.
- **Realization:** dial only (realization-neutral). **Refs:** `evid:null` in all
  three.
- **Gates:** presence in `[0.22,0.50]`; P(evid|agg) > P(evid|iso); **2-term is the
  plurality** (count > n3 and > n4), n4 rarer among synth; branch a family → daughter
  `evid` deep-equals parent. **Effort S.**

### F2 — The four exponents (grammaticalized from perception/speech verbs)
- **Sources (`EVID_SRC`, AFF_SRC-shaped):** `vis:[[SEE,.7],[null,.3]]`,
  `sens:[[HEAR,.75],[null,.25]]`, `infr:[[SEEM,.4],[KNOW,.25],[SEE,.15],[null,.2]]`,
  `rept:[[SAY,.65],[MOUTH,.1],[null,.25]]`, `indir:[[SEEM,.3],[SAY,.2],[HEAR,.2],[null,.3]]`.
  `EVID_VALUES={2:[dir,indir],3:[dir,infr,rept],4:[vis,sens,infr,rept]}`,
  `EVID_GLOSS={dir:DIR,vis:VIS,indir:INDIR,sens:SENS,infr:INFR,rept:REP,mir:MIR}`.
- **Mechanism:** each overt value is worn from its quarry at a birth point and
  replayed through the onion (cognate + drifting). Evidentials are the OUTERMOST,
  youngest verbal layer (`birth ≥ births.agr`), attached last.
- **BLOCKING FIX (built into the plan):** in `paradigmSpec`, for each val:
  `births['ev:'+val] = Math.max(birthOf(fam,'ev:'+val,len), births.agr)` **before**
  any `mkAff('ev:'+val,…)`. Without it `mkAff` reads `births['ev:vis']===undefined`
  → `wornAt(t=undefined)` → NaN → poisons `onionBuild`.
- **Insertion point:** build `spec.evid` **after the person block** (so `pickSrc`'s
  shared `taken` is populated and existing abl/pfv picks are untouched) and
  **before** the final `dedupeAffixSet`, whose arg list is extended with `...evidAffs`.
  `closedOf`'s return object exposes nothing new (iso uses `spec.evid`, below).
- **Per-morphotype:** iso = `spec.evid[val].syl` rendered neutral-tone as a
  post-verbal clause enclitic (same path as iso TAM); agg = transparent outer suffix
  after person; tmpl = outer affix (NOT a pattern — young peripheral layer); fus =
  outer suffix kept OUT of the crush via `outer:true`. Firsthand under `zeroDirect`
  = zero exponent, no token, no gloss, in every type.
- **Onion `outer:true` change** (fusional-crush branch only): split `inner`
  (`!e.outer`) from `outer`; crush inner, re-attach outer in birth order. Proven
  no-op when no outer events exist (every existing call). Guarded by the existing §6
  verb-contrast / §7 cognate-conjugation gates staying green.
- **Gates:** reported form `.from==='say'` in a majority; sens `.from==='hear'`;
  inferred drawn from ≥2 sources across families (rolled, not fitted); overt values
  pairwise-distinct; cognate-under-drift on a **synthetic** lang; append-only
  integrity `CONCEPTS[SEEM].g==='seem' && SEEM===CONCEPTS.length-1`. **Effort L.**

### F3 — Mirativity on the evidential slot
- `prof.gram.evid.mir ∈ extend|dedicated|null` (~40% of evidential langs; EXTEND
  outnumbers dedicated). EXTEND re-reads the indirect host (`infr` for n≥3, `indir`
  for n=2) as surprise; DEDICATED grammaticalizes a fresh exponent from
  `EVID_SRC.mir=[[SEEM,.35],[SEE,.2],[FALL,.15],[null,.3]]`.
- Feeds the shared `resolveMir` seam (§0.9). Gloss: EXTEND = `host.MIR` (e.g.
  `INFR.MIR`); DEDICATED = `MIR`. **Suppressed under imperative** (+ a gate asserts
  `mir` is null under `mood:'imp'`).
- Known limitation (documented): EXTEND with an explicit `v.ev='rept'` collapses to
  inferred+MIR (a clause cannot be reportative-and-mirative at once in v1). **Effort S.**

### F4 — Clause-frame `v.ev`/`v.mir` + graceful cross-size degrade
- Frame verb gains `v.ev ∈ {vis,sens,infr,rept,dir}|null` and `v.mir:bool`, default
  null/false (opt-in). `evidMap(n,ev)`: n=4 → `ev` (with `dir→vis`); n=3 →
  `(vis||sens)?dir:ev`; n=2 → `(vis||sens||dir)?dir:indir`. Mirrors the pronoun
  graceful-degrade already in `renderClause`.
- Single guarded resolution in `renderClause`: resolve `ev`/`mir` to null for
  imperatives AND for non-evidential languages **before** calling `inflectVerb`.
- **Gates:** pinned refs — `renderClause(F.trans + v.ev='rept') === renderClause(F.trans)`
  (identical text, proving §8 pinned gates unaffected); default frame has no
  VIS/SENS/INFR/REP/MIR gloss; `sens` by a 2-term lang → INDIR/DIR per `evidMap`,
  by 4-term → SENS. **Effort S.**

### F5 — Per-morphotype realization + `evidentialSystem` export
- `inflectVerb` gains `{ev=null, mir=false}` (cache key `+(ev?':e'+ev:'')+(mir?':mir':'')`).
- `evidentialSystem(lang) → null | {n, values, mir, forms:[{value,gloss,w,from,zero}]}`
  — the sole new export; renders each affix via `renderAffix`, reads `.src` for
  `from`. Returns null for non-evidential langs and all three refs.
- **Gates:** iso reportative = a distinct toneless post particle; agg outermost gloss
  element is REP; fus shows REP as a SEPARATE trailing element (outer path);
  `evidentialSystem` well-formed; pinned Mandarin `renderClause + v.ev='rept'` stays
  legal pinyin; determinism + JSON-roundtrip. **Effort M.**

---

## §2. Concord & agreement completion  (Group A)

Today `genderOf` assigns class by a bare `hash32(famSeed,'gender',cid)%genders`
(random) and nothing agrees with it. This cluster completes dependent-target
agreement in four units.

**Corrections applied (two Cardinal-Rule-2 fixes):** **(F4)** pronoun case forms
must be quarried from `AFF_SRC` (acc←TAKE/GO, dat←GIVE/GO, gen←KINC/HOUSE) run over
the pronoun roots via **`onionBuild` `rootOverride`** at their own birth points —
**delete all "run the language's own `spec.cases`" wording**; that framing yields no
`me/I` in caseless English (`spec.cases` empty) and no nom-acc pronoun under noun
ergativity (an ergative paradigm has no acc to mirror). **(F1)** the formal
noun-class cue is a per-family **rolled + pinnable** final-segment→class map (stream
`H('clsform')`), not a morph-derived global constant and not an unpinned roll; the
tier→class map is a real famSeed **Fisher-Yates bijection**, not `hash%genders`
(which collides / leaves empty classes). Also: scope is **dependent-target concord**
(overt Bantu noun prefix `mtu/watu` deferred to protect citation-stability); many-class
markers use per-class `synthClosed` roots (not 9 near-homophones cut from one
`demRoot`); `demRoot` is a closed-class form, NOT a graph concept. **No new concepts.**

New exports: `classInventory`, `nounClassInfo`, `concordMarkers`, `agreementTargets`,
`inflectAdj`, `pronoun`.

### F1 — Emergent noun-class assignment (semantic + phonological)
- Rebuild `genderOf(lang,cid)` body (same signature). SEMANTIC CORE (primary): group
  concepts by a universal animacy tier read from `CONCEPTS[cid].d` + a human-gloss set
  (human = kin ∪ {man,woman,king,queen,chief,priest,people,guard,child,mother,father,
  son,daughter,brother}; animal = `anm`; plant = `plt`; artifact = `hab,crf`;
  natural/mass = `wat,sky,lnd`; abstract = rest). A famSeed **Fisher-Yates** maps the
  merged tier list onto the used class indices (bijection — no empty/collided class).
- FORMAL cue fills only **non-core** residue (abstract/artifact/mass/loans; human and,
  in many-class systems, `anm` are semantic-locked). The cue is a per-family
  final-segment→class map on `H('clsform')`, PINNABLE. `prof.gram.classAssign ∈
  semantic|mixed` (WALS 32A: semantic ~35%, mixed ~65%; many-class corner biased
  mixed), own stream `H('clsasg')`, read only when `genders≥2`. Morphotype selects the
  cue TYPE (final-vowel for fus/tmpl, domain-bucket for agg), not which segment maps
  where.
- **Refs:** mandarin `classAssign:'semantic'` (+ `clsform` unused), russian
  `'mixed'` (pinned: low-vowel→fem, bare-C→masc, mid/back-o→neut), english `'mixed'`.
- **Gates:** fem-gloss concepts share a class distinct from masc-gloss (not random);
  `anm`/human each in ≤2 classes; `classInventory` has **no empty class**; **same
  tier → different class index across families** (label rolled, structure universal);
  `classAssign` frequency sampled over **genders≥2 langs only** ∈ (0.28,0.42);
  JSON-roundtrip + post-rebuild determinism on the non-core tail.
- **Note:** rebuilding `genderOf` re-selects `themeFor` declension themes for gendered
  fus/tmpl families → their inflected surfaces (and names built from them) re-baseline.
  Cosmetic, logged. **Effort M.**

### F2 — Concord propagation (dem / article / verb + the class-marker onion)
- `prof.gram.concord = null (genders<2) | {adj, dem, art, verb, site:'prefix'|'fuse'|'suffix'}`,
  rolled as an object like `redup`. Given gender: adjective agreement near-universal
  (`H('cadj')<0.95`); dem next; verb gated on `agree!=='none'` EXCEPT the many-class
  corner where subject class-concord IS the agreement (`genders≥4 ⇒ all targets on,
  site='prefix'`). `site` derived from genders/morph (`≥4`→prefix, tmpl→suffix, else fuse).
- **Class-marker onion:** human/animate classes may quarry MAN/WOMAN (the "feminine ‹
  woman" etymology for free); **non-human classes use per-class `synthClosed` roots**
  (family-cognate, replayed through the log → distinct many-class prefixes
  `mu-/ba-/mi-/ki-`, not dedupe-rescued near-homophones). Retinted per class,
  worn/born/replayed → alliterating cognates that drift.
- Per-morphotype: agg-many = alliterating class prefix on dem/art/verb (`attachSyl
  side='pre'`); fus = class exponent crushed into the ending (Russian -yj/-aja/-oje,
  past -l/-la/-lo); tmpl = class suffix (Arabic fem -at; verb t-/y-).
- `renderClause`: head class per NP (`arg.pron?pronounClass:genderOf`); optional
  `arg.dem ∈ near|far`; article + verb agreement via new `inflectVerb {sclass}`
  (additive). Gloss `CL1/CL2…` or `M/F/N`, token-aligned.
- **Refs:** mandarin `concord:null`; russian `{adj:true,dem:true,art:false,verb:true,
  site:'fuse'}`; english `null`. **New exports:** `concordMarkers`, `agreementTargets`.
- **Gates:** every genders≥2 lang has ≥1 target; dem/verb exponent differs by head
  class; many-class alliteration (dem prefix == art prefix == verb subj-concord prefix
  per class, differs across classes); fuse langs' 3sg past differs by subject class
  (Russian -l/-la); markers **cognate across sisters + drift** under the added rule.
  **Effort L.**

### F3 — Adjective agreement (`inflectAdj`)
- `inflectAdj(lang, cid, {cls=0,num='sg',cas=null}) → {text,gloss,pre,post}`. When
  `concord.adj`, the adjective takes the head's class (+ number + case where the
  language marks it); reuses F2's class marker. When concord is null/genderless →
  invariant (== `wordOf`), correct for English/Mandarin.
- `renderClause np()` replaces the bare `wordOf` adjective with `inflectAdj(...,{cls:
  headClass, num, cas})`. Predicative agreement: **scope to attributive only** (the
  frozen frame has no copula/predicate-adjective slot) OR add an explicit optional
  predicate field + render path + pin; **do not ship a predicative gate with no code
  path** (critique). Recommended: attributive-only in v1.
- Key `c.cells` by `cid:cls:num:cas`. **Gates:** ≥2 distinct surfaces across classes
  in gendered langs, invariant in genderless; Russian 'black' differs before masc vs
  fem head, English invariant; determinism. **Effort M.**

### F4 — Object / oblique / genitive pronoun case series
- `pronoun(lang, k, cas='nom') → {w,g}`; `closedOf` gains internal `pronsObj/Dat/Gen`.
  `prof.gram.pronCase ∈ none|acc|acc-dat|full`, stream `H('prc')`, correlated with
  `caseN`/`align` (caseN≥3→full; caseN≥1→acc-dat/acc; caseN=0 iso→mostly none, acc a
  minority; caseN=0 non-iso→acc ~55%).
- **Mechanism (corrected):** grammaticalize from the `AFF_SRC` quarries (acc←TAKE/GO,
  dat←GIVE/GO, gen←KINC/HOUSE) run over the pronoun roots via **`onionBuild`
  `rootOverride`** at their own birth points, replayed through the full rule log —
  INDEPENDENT of which cases the noun paradigm instantiated. Highest-frequency → the
  b≥0.95 suppletion belt bites hardest, so object forms are often opaque (`me/him`),
  emergent not stipulated. **Split ergativity for free:** pronouns sit atop the
  animacy hierarchy, so the series is built nom-acc even when nouns are ergative
  (subject bare, object accusative — Dyirbal).
- Dedupe the new series against BOTH the nominative pronouns AND the noun case
  affixes' collision walk. `renderClause np()` selects the series by role (O→acc,
  adpositional X→oblique, genitive possessor→gen), falling back to the nominative cell.
- **Refs:** mandarin `none`; russian `full`; english `acc`. **Gates:** acc form ≠ nom
  for ≥1 person (me≠I); same pronoun renders differently as O vs S in a pronCase lang,
  identically in `none`; **split-erg:** in `align==='erg'` the pronoun object takes acc
  and the subject is bare (pronouns never carry ERG). **Effort M.**

---

## §3. Voice & valency operations  (Group B)

Four role-remapping operations, each both a grammaticalized verbal marker (onion)
and a relation re-assignment in `renderClause`. One dial block, one shared prepass.

**Corrections applied (determinism + typology):** the shared-`taken` order is the
real landmine — **all four `spec.voice` `mkAff` calls go strictly AFTER pl/du/cases/
tam, and voice affixes at the END of `dedupeAffixSet`** (§0.3), with a before/after
byte-identity gate. Force **`appl=false` and `antip=false` for `m==='iso'`** (removes
the missing iso exponent + matches typology). Antipassive requires a demotion target
(`caseN≥2` or the guaranteed `cl.adps` oblique). tmpl voice+TAM = a **combined
pattern-vowel lookup keyed on (voice,tam)** (the real root-and-pattern behaviour), NOT
a TAM-affix fallback. The voice prepass must **REBIND** `trans/coreCase/sCase/oCase/
sPers/sNum/objPers` from the remapped roles before `inflectVerb`. `applOf` documented
as selecting the cognate affix source while the renderer promotes `frame.loc` (single
oblique slot; `frame.loc.num` defaults 'sg'). Add determinism gate to Causative.
**No new concepts.**

New exports: `voicesOf`, `voiceEtymologies`. New internal helper `adpSourceOf(lang,
meaning)` (replays the `ADP_SPECS` roll so the applicative is cognate with the
language's own adposition). Import `MAKE,DO,EAT` into `languageGrammar.js`.

**The dial block** (appended to `rollGrammar`'s return, own streams):
```
caus   = H("cau") < 0.85;                                           // ~85%, near-universal
pass   = align==="erg" ? H("pass")<0.12 : H("pass")<0.5;            // passive is an ACC property (WALS 107)
passBy = pickW("passby",[["with",.4],["from",.35],["at",.25]]);
antip  = m==="iso" ? false : align==="erg" ? H("apass")<0.6 : agree==="both" ? H("apass")<0.15 : H("apass")<0.05;
appl   = m==="iso" ? false : H("appl") < (0.1 + (agree==="both"?0.4:0) + (m==="agg"?0.15:m==="tmpl"?0.05:0));
applOf = appl ? pickW("applk",[["ben",.55],["ins",.25],["loc",.2]]) : null;
```
**Refs (all six keys, all three, explicitly):** mandarin `caus:true, pass:true,
passBy:'from', antip:false, appl:false, applOf:null`; russian `caus:false, pass:true,
passBy:'with', antip:false, appl:false, applOf:null`; english `caus:false, pass:true,
passBy:'at', antip:false, appl:false, applOf:null`.

| F | What | WALS | Source (`AFF_SRC`) | Remap (rebind before `inflectVerb`) | Eff |
|---|------|------|--------------------|-------------------------------------|-----|
| Causative | +valency, causer 'X makes Y do Z' | ~85% (111) | `caus:[[MAKE,.4],[DO,.25],[GIVE,.15],[null,.2]]` | s=causer, o=causee, `trans=true`; iso pre-token `cl.voice.caus` (让/使) | M |
| Passive | −valency, P→subj, A→by-phrase | ~44% (107), ACC-skewed | `pass:[[FALL,.25],[COME,.2],[EAT,.15],[null,.4]]` | sArg=`frame.o`, `detrans=true` (subj never ERG), `objPers=null`, agent→oblique `mark:passBy` (ins/abl case else adp) | M |
| Antipassive | ergative mirror, A stays intrans subj (bare ABS), P→oblique | ~25% (108), erg-skewed | `apass:[[DO,.3],[MAN,.2],[null,.5]]` | sArg=`frame.s`, `detrans=true` ⇒ `sCase=null` (surfaces ABS), P→'with' oblique | M |
| Applicative | oblique→object, verb takes marker | ~24% (109), head-marking | cognate: `adpSourceOf` by `applOf` (ben→'to', ins→'with', loc→'in') + GIVE/TAKE | oArg=`frame.loc` promoted to O, adposition suppressed, `objPers`=promoted O when `agree==='both'`, `trans=true` | L |

- Per-morphotype: iso = periphrastic light verb/auxiliary from `cl.voice` (caus/pass
  only; antip/appl forced off for iso); agg = inner affix from `spec.voice`, innermost
  birth (`Math.min(births[k], t0v)`); fus = `crush` portmanteau; tmpl = combined
  (voice,tam) pattern vowel. `patternVowels` gains `caus`/`pass` **appended at the end**
  of the key loop (existing order preserved) AND added to its dedupe walk.
- **Gates:** causative present 78–90%, source∈{make,do,give} in ≥70% non-iso, branch
  inherits + drifts; passive `rate(acc)−rate(erg) ≥ 0.25`, passive of {king SEE river}
  → subject 'river', 'king' in by-phrase, ERG passive subject carries NO erg;
  antipassive `rate(erg)≥0.4` & `rate(acc)<0.12`, agent loses ERG, every antip lang has
  a demotion target; **cognate applicative** — `appl.src === adpSourceOf(...)` in ≥60%;
  **byte-identity regression** (roll population without vs with the voice block; every
  non-voice surface identical) — proves the shared `taken`/dedupe order held. **Effort L.**

---

## §4. Numeral classifiers (sortal)  (Group D)

A sortal numeral-classifier system ("three CL.animal cattle"). Four stacked
features, additive to the sentence layer only — **no name re-baseline.**

**Corrections applied:** **flip the inverted `order↔adjN` correlation** — the design's
`order` roll produced AdjN→post (opposite of its own Greenberg claim and the Mandarin
pin); corrected to `order = (adjN ? H('clford')<0.8 : H('clford')<0.2) ? 'pre':'post'`.
**Rescope title to *sortal*** (mensural/measure-word/repeater classifiers parked;
headline example is sortal, English gets no classifier path — pinned null). Commit the
`numeralPhrase`/`np()` division of labour (`numeralPhrase` owns `[Num (CL) N(+case)]`
core; `np()` keeps adjective/article). Hoist `plMark` to a shared local (complementarity
can't drift from the real plural dial). Add a **per-family salience roll**
(`h01(fam,'clfsense',cid)`) for genuinely ambiguous nouns so classifier ASSIGNMENT
varies across families (COLEX/DERIV standard). Russian/English must set `classif:null`
**explicitly** (gate asserts `===null`; `undefined` would fail). Fix the gate total
(~21 checks, 106→~127). Realization is honestly morphotype-invariant (classifier always
a free light word) — state it deliberately.

New concepts: **`BODY`** = `c("body","bod",0.9)`, **`LEAF`** = `c("leaf","plt",0.7)`
(genuine Swadesh gaps; must NOT enter any name pool). New exports: `classifiersOf`,
`classifierEtymologies`, `classifierFor`, `classifSenseOf`, `numeralPhrase`, and lexicon
`BODY`/`LEAF`/`CLF_SENSE`.

### F1 — The classifier-language dial
- `prof.gram.classif = null | {classes:string[], obl:bool, order:'pre'|'post'}`, IIFE
  like `redup`. Presence: `base = iso?0.7 : agg?0.5 : fus?0.07 : 0.04`; `on = base *
  (plMark ? 0.65 : 1.25)`; `if (H('clf') >= on) return null`. Re-reads `g:pl`
  (Sanches-Slobin plural complementarity) read-only. Classes: always `['gen']` +
  `add('hum',.8) add('anm',.7) add('long',iso?.65:.4) add('flat',iso?.6:.35)
  add('round',.45)` (own streams). `obl = H('clfob')<0.55`.
- **WALS 55A:** ~35% classifier langs; the fus-dominant morph mix legitimately pushes
  our prevalence to the low edge (an honest CR-1 consequence — a world where everyone
  pluralizes has fewer classifier langs). Band `[0.15,0.42]`.
- **Refs:** mandarin `{classes:[gen,hum,anm,long,flat,round], obl:true, order:'pre'}`;
  russian `null`; english `null`. **Gates:** prevalence band; P(classif|iso)>0.4 &
  P(classif|fus)<0.15; plural complementarity (plMark rate among classifier langs
  strictly lower by ≥0.1); order correlates with adjN (**corrected direction**).
  **Effort S.**

### F2 — Inventory grammaticalized from body/shape nouns
- `classifiersOf(lang)` mirrors the adposition block: each classifier worn via
  `wearSyl(prof, nativeStemOf(lang,src))` + legalized (recent layer, no extra replay;
  sisters cognate for free because `nativeStemOf` is already evolved through this
  language's rule tail).
- `CLF_SRC`: `hum←[[MAN,.4],[PEOPLE,.3],[BODY,.3]]`, `anm←[[HEAD,.55],[BODY,.45]]`
  (頭/head-of-cattle), `long←[[TREE,.35],[REED,.3],[SPEAR,.2],[ARM,.15]]` (條),
  `flat←[[LEAF,.5],[SHIELD,.25],[WOOD,.25]]` (Thai bai), `round←[[STONE,.4],[GRAIN,.35],
  [HEAD,.25]]` (顆/粒), `gen←[[BODY,.35],[STONE,.2],[null,.45]]` (frequently bleached/
  opaque — 個, via `synthClosed`). `usedSrc` guard + `dedupe` keep forms distinct.
- **Gates:** forms non-empty + pairwise distinct; ≥1 source-traceable classifier;
  family cognate + ≥1 surface diverges under drift; anti-fitting (animal classifier
  coined ≥2 ways HEAD vs BODY; general occurs opaque AND derived); pinned Mandarin
  legal pinyin + animal ≠ human form. **Effort M.**

### F3 — Semantic assignment (noun → classifier)
- `classifSenseOf(cid)` = `CLF_SENSE` annotation, else `anm` from `con.d`, else `gen`.
  `classifierFor(lang,cid)` returns the language's classifier for that sense, falling
  back to `gen`. `CLF_SENSE` (shared data like COLEX/DERIV) tags human/long/flat/round
  nouns (animal is free from the `anm` domain). Ambiguous nouns (FISH/SHIP long-vs-
  animal, coin flat-vs-round) get the per-family salience roll `h01(fam,'clfsense',cid)`;
  single-salient-sense nouns stay fixed.
- **Gates:** hum/anm/long return three DIFFERENT classifiers; a lang without `long`
  routes RIVER→gen (no crash); every `anm` concept `classifSenseOf==='anm'`;
  determinism across JSON round-trip. **Effort M.**

### F4 — The `[Num (CL) N]` construction
- `numeralPhrase(lang, cid, n, {cas,def,adj,useClf}) → {tokens,text,gloss}`. Classifier
  lang → `[Num CL N]`/`[N Num CL]` per `classif.order`; non-classifier lang → same
  function pluralizes the noun via `inflectNoun` when `n≠1 && pluralMark`, ordered by
  `adjN` (Greenberg U18). Owns only the count core; `np()` keeps adjective/article
  (wraps the core, so "the three horses" keeps its article). `useClf:false` in an
  optional lang omits CL; `obl` forces it. n=1 keeps CL in a classifier lang (一只猫);
  `count` wins over `num` when both set; classifier path leaves the noun caseless (langs
  overwhelmingly caseless).
- Frame: `s/o/loc.count = int` (opt-in). `np()` expands a counted arg in place,
  threading `sCase/oCase`. **Gates:** token/gloss alignment incl. multi-word numerals;
  CL index before/after N per order; obligatory lang has a CLF token, non-classifier has
  none + pluralizes when n>1; pinned Mandarin `[Num CL N]` legal pinyin, animal≠human
  classifier; English/Russian insert no classifier. **Effort M.**

---

## §5. Nominal categories: possession, comparison, politeness, number  (Group E)

**Corrections applied (determinism):** the `t0n` fold **must keep the existing guards
and add trial/paucal guards** — `t0n = max(g.pluralMark?births.pl:0, g.dual?births.du:0,
g.trial?births.tri:0, g.paucal?births.pau:0)`; the design's shorthand `max(pl,du,tri,pau)`
would re-clamp every case paradigm on every seed. `stdFirst` must be a **stored,
pinnable** field on `gram.compar` read by `comparative()`, not a render-time recompute
(else the Mandarin `bǐ` pin is silently ignored). Add `spec.possAff` to the case
`dedupeAffixSet` (POSS+CASE co-occur), `spec.honAff` to the verbal `dedupeAffixSet`, and
`'comp'` to the `patternVowels` dedupe key loop. Add a comparison **aggregate WALS-marginal
gate** (correlation-only gates undershoot ~exceed 19% vs WALS 30%). Document that
`possAffix=true` langs get their plain case paradigm reordered by the POSS slot even
absent a possessor (diachronically coherent; re-run §6/§7). Guard `+DEF` on `cl.defArt`
existing; degrade `num:'tri'/'pau'`→`'pl'` with an honest gloss when unsupported.

New concepts: **`EXCEED`** = `c("exceed","act",0.5)` (+`VERBS`), **`SAME`** =
`c("same","qua",0.6)`, **`LORD`** = `c("lord","gov",0.55)`. `AFF_SRC` gains
`tri/pau/hon`. New exports: `inflectPossessed`, `possessionType`, `comparative`,
`tvPronouns`, `honorificVerb`.

### F1 — Number beyond sg/du/pl — paucal & trial
- `prof.gram.trial`, `prof.gram.paucal` (bool), gated on the EXISTING `g.dual` via the
  Corbett hierarchy (trial⊃dual, paucal needs plural/usually dual): hoist the inline
  `dual` roll to a local const, then `trial = dual && H('tri')<0.12`, `paucal = dual &&
  H('pau')<0.25`. Source: trial←THREE (parallel to dual←TWO), paucal←`[[LITTLE,.5],
  [MANY,.2],[null,.3]]`.
- `spec.tri/spec.pau` via `mkAff`, `births.tri/pau` in the birthOf loop + **guarded**
  t0n fold; `inflectNoun` accepts `num ∈ sg/du/tri/pau/pl`; pronoun 1tri/2tri/1pau/2pau
  cells. **Refs:** all three `trial:false, paucal:false` (all have `dual:false`).
- **Gates:** ZERO langs have trial/paucal without dual (the load-bearing implicational
  gate); rarity band (trial <4%, paucal <8%); tri/pau cells ≠ sg/du/pl + gloss TRI/PAU;
  pronoun cells distinct (1tri≠1du≠1pl); source trace THREE/LITTLE, cognate + drift.
  **Effort S.**

### F2 — Alienable vs inalienable possession
- `prof.gram.possAffix` (`iso?false : agree!=='none'?H('poss')<0.7 : H('poss')<0.4` —
  head-marking correlate, never iso), `prof.gram.alienSplit` (`possAffix &&
  H('alien')<0.4`). Alienability read from the domain tag: `inalien = d==='kin'||
  d==='bod'` (the cross-linguistically inalienable classes — no hand-picked list).
  Optional depth: roll the inalienable-domain SET per family off its own stream
  (default {kin,bod}, occasionally +one culturally-possessed class).
- Possessive affixes ← the pronoun roots (`synthClosed 'pron1/2/3'`, reusing the
  person-agreement construction; 3sg non-zero); alienable construction linker = the
  existing 'of' adposition rendered neutral-tone. `spec.possAff` built at `births.poss`
  (clamped number<poss<case), **deduped within itself AND against `spec.cases`**.
  `inflectNoun` gains `opts.poss={pers,num}`.
- **Refs:** all three `possAffix:false, alienSplit:false` (all dependent-marking here).
  **Gates:** possAffix correlates with head-marking, ~0% iso; split follows the DOMAIN
  (HAND/MOTHER affixed, HOUSE/STONE construction); non-split affixes ALL nouns
  (HOUSE included); affix cognate with the pronoun; POSS+CASE both distinct in the
  gloss (`HAND.1SG.POSS.DAT`); citation stability (`inflectNoun` no-poss == `wordOf`).
  **Effort M.**

### F3 — Comparison (comparative / superlative / equative)
- `prof.gram.compar = {type:'exceed'|'sep'|'particle', more:'affix'|'word'|'none',
  stdFirst:bool}`. `type` by word order (Stassen): OV→sep70/particle20/exceed10;
  VO-iso→exceed65/particle25/sep10; VO-synth→particle50/sep30/exceed20;
  V1→exceed45/particle35/sep20. `stdFirst = ov` **stored** (pinnable). Sources: EXCEED
  (new) = exceed verb + 'than'; separative ← the 'from' adposition; 'more'←MANY;
  'most'←ALL/MANY; equative 'same'←SAME (new).
- Standalone phrase renderer `comparative(lang, adjCid, standard, {degree:'cmpr'|'sup'
  |'eq'})` (like `intensive`/`numeral`, NOT a clause-frame change); `degreeMarkers(lang)`
  cached on `gc()`. tmpl elative = a `'comp'` `patternVowels` key **appended + added to
  the dedupe loop**.
- **Refs:** mandarin `{type:'particle', more:'none', stdFirst:true}` (A bǐ B dà — the
  sanctioned VO-preposed-standard anomaly); russian/english `{type:'particle',
  more:'affix', stdFirst:false}` (-ee / -er than). **Gates:** OV majority 'sep', VO-iso
  majority 'exceed'; stdFirst tracks ov; **aggregate WALS-marginal band** for
  exceed/sep/particle; 'comp' pattern distinct from TAM/plural patterns; all three
  degrees non-empty + gloss-aligned. **Effort L.**

### F4 — Politeness / T-V + honorific verbs
- `prof.gram.tv ∈ none|binary|multi` (`r=H('tv'); r<0.24?'binary':r<0.31?'multi':'none'`
  — WALS 45A), `tvSource ∈ plural|noble` (`H('tvsrc')<0.6`), `honVerb`
  (`(agg||tmpl)?H('hon')<0.3:H('hon')<0.08`). V-pronoun = the existing 2PL cell (vous
  machine) OR worn from LORD/NOBLE/HIGH (usted machine). Honorific affix ←
  `[[GIVE,.4],[null,.6]]`, `spec.honAff` at `births.hon≥t0v`, **deduped against
  `spec.tam.*`/`spec.imp`**.
- `closedOf` gains '2v'/'2vv' cells + `cl.honPart` (iso); `inflectVerb` gains `opts.hon`;
  `np()` pron arg gains `pol` (graceful degrade 2v→2pl→2sg). **Refs:** mandarin
  `tv:'binary', tvSource:'plural', honVerb:false` (nín); russian `'binary','plural',false`
  (vy); english `'none','plural',false`. **Gates:** distribution WALS-shaped; polite 2sg
  ≠ familiar; plural source ⇒ 2v==2pl, noble ⇒ traces LORD; honVerb ≠ plain AND ≠ past;
  honVerb correlates with agg/tmpl; multi-level 2vv≠2v≠2sg + degrade never crashes.
  **Effort M.**

---

## §6. TAM & mood depth  (Group C′ — pairs with Evidentiality via the mir slot)

Four features deepening the verb, unified by "synthetic languages carry more TAM":
every threshold conditions on `m = prof.morph` and whether the base category exists.

**Corrections applied (byte-identity + determinism):** **DROP the proposed
`patternVowels` "build only present keys" refinement** — it reorders the `seen`-walk
and re-bases every templatic language's pattern vowels (a byte-identity break) and is
unnecessary since all NEW secondary categories are affixes. Add a **`PRIMARY_TAM =
{pst,fut,pfv,ipfv}` guard** so tmpl only pattern-swaps for those; all secondary tam
route through affixes (this IS the "templatic carries fewer distinctions" mechanism).
Every new source-claiming `mkAff` **appended after existing** (shared-`taken`, §0.3).
The **mir dial references a nonexistent `g` at roll time** — use the LOCAL `perfect`
and `evid`, gate the `+0.14` behind `typeof evid!=='undefined' && evid.infer`, and
compute the evidentiality block EARLIER than the mir block. `resolveTam` must consult
`spec.dist` for graded tenses (else they always degrade); graded past inherits base-past
irregularity; `affixEtymologies` walks `spec.dist`; add `moods` to `paradigmShape`. Fix
`pickW('rmp',[...])` call form and the wrong "WALS 141" citation. Reconcile the mir slot
with Evidentiality via the shared `resolveMir` seam (§0.9). **No new concepts;** import
`BE,HAVE,KNOW,SEE,NEW,NIGHT,FAR`. New exports: `tamShape`, `resolveMood`.

### F1 — Tense remoteness (graded tense)
- `remotePast ∈ 0|1|2` (iso forced 0; agg `pickW('rmp',[[0,.68],[1,.20],[2,.12]])`;
  fus/tmpl rarer; forced 0 unless `g.tenses≥2`), `remoteFuture ∈ 0|1` (forced 0 unless
  `g.tenses≥3`; boosted when `remotePast≥1` — Bantu symmetry). Read local `remotePast`
  before `remoteFuture`. Source: rec←`[[NEW,.35],[COME,.25],[null,.4]]`, rem←`[[FAR,.4],
  [NIGHT,.2],[null,.4]]`, near←`[[COME,.35],[WANT,.2],[null,.45]]`, farfut←`[[FAR,.35],
  [GO,.25],[null,.4]]`.
- `spec.dist = {rec,rem,near,farfut}` (`mkAff`, births clamped OUTER to pst/fut).
  `inflectVerb` accepts `pstrec/pstrem/futnear/futrem`; `tamEvents(spec,tamEff)` expands
  a graded tam into `[baseTenseAffix, distanceAffix]` (tmpl: `[pattern + light affix]`;
  iso: pre/post particles). `resolveTam` degrades `pstrem→pst→pfv→null` **and checks
  `spec.dist`**. **Refs:** all three `remotePast:0, remoteFuture:0`.
- **Gates:** remoteness ~8–16%, ZERO in iso; never without the base tense; past-grading
  > future-grading; agg > fus > tmpl mean degrees; graded cell ≠ plain + gloss REM/REC/HOD;
  degrade on a non-grading lang. **Effort M.**

### F2 — Richer aspect: perfect, progressive, habitual
- **NOT gated on `g.aspect`** (English `aspect:false` yet has both — the whole point).
  `perfect = H('prf')<0.42+(g.tenses===1?.12:0)+(iso?.06:0)`; `progressive` leans iso
  (analytic 'be at V-ing'); `habitual`; aspect-prominent (`g.tenses===1`) langs get a
  +0.10–0.12 boost to all three (compensating rich aspect). Source: prf←`[[FINISH,.4],
  [HAVE,.25],[null,.35]]`, prog←`[[SIT,.3],[STAND,.2],[BELLY,.15],[null,.35]]` (posture/
  locative), hab←`[[GO,.3],[BE,.2],[null,.5]]`.
- `spec.tam` gains prf/prog/hab; iso = neutral-tone particles (PRF/HAB post, PROG pre,
  the 在 pattern); agg stacked; fus fused; tmpl = light affix (secondary). `resolveTam`:
  prf→pfv→pst→null, prog/hab→ipfv. **Refs:** mandarin `perfect:true, progressive:true,
  habitual:false`; russian all false; english `perfect:true, progressive:true,
  habitual:false` (with `aspect:false`).
- **Gates:** perfect 40–55%; progressive 50–70% AND more frequent in iso than fus;
  habitual 22–38% AND more in agg than iso; aspect-prominence correlation; PRF≠PST/PFV,
  PROG≠IPFV, both ≠ the reduplicative iterative when a lang has both (co-occurrence gate);
  pinned Mandarin PRF post/PROG pre neutral-tone. **Effort M.**

### F3 — Irrealis moods: subjunctive, conditional, optative, potential
- `prof.gram.moods = MOOD_ORDER.slice(0, moodN)` where `MOOD_ORDER=['sbjv','cond','opt',
  'pot']` (frequency ranking emerges from the slice, like `CASE_ORDER`). `moodN` by morph
  (iso `H('moodn')<0.72?0:1`; agg up to 3; fus/tmpl cap 2). Source: opt←`[[WANT,.55],
  [null,.45]]`, pot←`[[KNOW,.4],[TAKE,.2],[null,.4]]`, cond←`[[GO,.3],[WANT,.2],[null,.5]]`,
  sbjv←`[[COME,.2],[null,.8]]` (mostly opaque inherited morphology, realistic).
- Unlike the imperative, irrealis moods KEEP tam+person. `inflectVerb` mood option accepts
  the four (name the flag `irrealisMood`, NOT `irr` — that's the irregularity var). iso =
  preverbal modal particle (会/要/能, moodN capped 1); agg = outer affix; fus = fused + a
  distinct conjugation theme; tmpl = a final MOOD-VOWEL affix (yaktubu/yaktuba), NOT a
  second stem pattern. `resolveMood(lang, wanted)` degrades to null (indicative).
  `affixEtymologies` walks `spec.moods`.
- **Refs:** mandarin `moods:[]`; russian `moods:['cond']` (бы — pinned list overrides the
  slice); english `moods:[]`. **Gates:** `moodN` DISTRIBUTION (agg > fus/tmpl > iso — the
  real emergent claim; the slice-ordering count gate is tautological, keep only as a
  sanity check); OPT←WANT, POT←KNOW; an irrealis cell ≠ indicative AND keeps PST+person
  (unlike imperative). **Effort L.**

### F4 — Mirativity
- `mirative = H('mir') < 0.04 + (perfect?.10:0) + ((typeof evid!=='undefined' &&
  evid.infer)?.14:0)` — **references the LOCAL `perfect`/`evid`** (not `g`), self-strengthens
  once evidentiality lands. When `g.perfect`, mir SHARES the perfect exponent (the -miş
  syncretism; alias, deep-clone or create-after-dedupe so the shared `syl` isn't
  double-mutated), else a small marker from `[[SEE,.25],[FINISH,.25],[null,.5]]`.
- Feeds the shared `resolveMir` seam (§0.9) via `v.mir`; silently dropped if the lang
  lacks mirative; suppressed under imperative. **Refs:** all three `mirative:false`.
- **Gates:** small minority ~5–18%; `P(mir|perfect) > P(mir|!perfect)`; syncretism (MIR
  == PRF exponent) OR traces SEE/FINISH; MIR ≠ indicative, composes with past.
  **Effort S.** (Cross-cluster: read `evid` defensively so this ships before OR after §1.)

**Cluster-wide gate (HIGH):** a **before/after byte-identity regression** snapshot (pronoun
set, noun/verb paradigms, names for fixed seeds) — the single most important gate given
the shared-`taken` and `patternVowels` hazards.

---

## §7. Alignment refinements & splits  (Group F)

Extends the `align` dial (line 72: `caseN>=2 && H("align")<0.27 ? "erg":"acc"`) to the
rarer real systems. Three shared pieces: (1) extend the value set + carve rare systems on
own streams **after `agree`/`aspect` are known**, keeping line 72 verbatim (`const`→`let`);
(2) the single per-argument resolver `coreCaseOf(arg, role, effAlign)` that replaces the
`renderClause` core-case block AND reproduces plain acc/erg byte-identically; (3) the
append-only **`AGENTIVITY`** side table (proto-agent score 0..1 over existing verb ids —
a real Dowty dimension, the analogue of basicness `b`).

**Corrections applied (all correctness, both cardinal rules PASS):** **exclude iso from
the active carve** (`m!=='iso'` — the "caseN>=2 excludes iso" premise is FALSE: line 66
gives iso `caseN=2` at 15%); **gate volition on `activeFluid`** (split-S is lexically
fixed: `sAgentive = (g.activeFluid && v.vol!=null) ? v.vol : AGENTIVITY.get(v.c)>=0.5`);
correct the false `t.erg` byte-identity claim (tripartite is UNguarded on base align, so
it moves a tiny fraction of erg→tripartite — re-baseline §4's expectation, stays in the
0.12–0.42 band); the resolver selects **CASE only, keeps the subject token role string
'S'** (else §8 role/order gates break); wire the two missed `g.align` consumers
(`paradigmShape` line 1247, `langLab.js` line 106 → route through `alignmentOf`); move tam
resolution ABOVE the core-case block and define `effAlign` for `tam===null` (imperative)
as the accusative side; specify `agree==='both'` behaviour (don't double-index O); drop or
wire the unused `g:espk` stream; nudge `FINISH` off the exact 0.5 boundary; correct active
prose "3-4%"→~2%. **No new concepts.** New exports: `agentivityOf`, `alignmentOf`,
`clauseAlignment`, + lexicon `AGENTIVITY`.

| F | System | WALS | Roll (own streams) | Render (via `coreCaseOf`/`clauseAlignment`) | Eff |
|---|--------|------|---------------------|---------------------------------------------|-----|
| Active-stative | S=A for control verbs, S=O for non-control (split-S/fluid-S) | ~2% case (98) | `caseN≥2 && m!=='iso' && align==='acc' && H('actv')<0.06 → 'active'`; `activeFluid = active && H('afl')<0.3` | AGT←HAND, PAT←TAKE/GO; S = `sAgentive()? AGT:PAT`; frame `v.vol` optional (fluid only) | M |
| Tripartite | S/A/O all distinct | ~2% case (98) | `caseN≥3 && (agg||fus) && H('trip')<0.05 → 'tripartite'` | A→ERG, O→ACC, S→bare (Nez Perce) | S |
| Split-erg by TAM | erg in perfective/past, acc elsewhere | Dixon (commonest split) | `align==='erg' && (tenses≥2||aspect) && H('esp')<0.40 → ergSplit='tam'` | `effAlign` from resolved tam: `(pst||pfv)?'erg':'acc'` | M |
| Split-erg by hierarchy | Silverstein — SAP acc-side, 3rd/nouns erg-side | Silverstein/Dixon | `else if H('esp')<0.75 → 'hier'`; `hierSplit = H('hsp')<0.7?'sap':'pron'` | per-arg `rankOf`: high arg ACC iff O, low arg ERG iff A, S bare (Dyirbal) | M |
| Direct-inverse + abs-agree | verb carries direction; agreement indexes highest-ranked arg | ~3% person-marking (100) | `invAgree = agree!=='none' && caseN≤1 && H('inv')<0.06`; `absAgree = align==='erg' && agree!=='none' && H('aba')<0.6` | INV←BACK (direct=∅); core bare; `direction = rank(s)≥rank(o)?'direct':'inverse'`; `inflectVerb {dir}` additive (cache-key `dir?':d'+dir:''`) | L |

- `AGENTIVITY` (excerpt): GO/RUN .9, WALKV/COME/DO .85, SAY/EAT/DRINK/MAKE/RULEV/BUILDV
  .8, STAND/SEE/WANT .6, SIT .55, FINISH .5→nudge to .52, HAVE/KNOW/HEAR/LOVEV/FEARV .4,
  SLEEP/BE .3, BURNV .25, FALL .1, DIE .05. Absent verb → patientive (documented default).
- Per-morphotype: agg = stacked AGT/PAT/ERG/ACC suffixes; fus = portmanteau core endings
  (dedupe's consonantal-skeleton contrast keeps them apart); tmpl = the language's normal
  case affixes; iso excluded from active. The direction marker sits in the outer TAM/agr
  tier (born late like the imperative).
- **Refs:** all three `align:'acc'` + `activeFluid:false, ergSplit:null, hierSplit:null,
  invAgree:false, absAgree:false`.
- **Gates:** active occurs (<8% of case langs) + split-S (RUN marks S=AGT, FALL/DIE
  S=PAT) + fluid-S (v.vol flips it); tripartite three-way contrast (sweep 500+ seeds);
  tam-split flip (perfective→erg, imperfective→acc), §8 ergBad still green (past frames);
  Dyirbal check (1sg-A unmarked, noun-A takes ERG); direct-inverse (1→3 no INV, 3→1 INV);
  abs-agree (transitive verb agrees with O); **regression gates**: plain-acc resolver ==
  old `{sCase:null,oCase:'acc'}`, consistent-erg == `{trans sCase:'erg', intrans null,
  oCase:null}`, `inflectVerb(l,c,{})` byte-identical (dir=null), default `agreeArg===
  frame.s`. **Effort (cluster) L.**
- Documented simplifications: `rankOf` collapses SAP-internal 2>1 (2→1 comes out direct);
  3→3 defaults to direct (obviation parked); a caseN=2 split/active lang spends its second
  core slot (drops the genitive); one-split-axis (no compound tam+hier splits in v1).

---

## §8. Multi-clause: coordination & subordination  (Group G)

Turns the flat frame into a TREE. `renderClauseTree(lang, node)` dispatches
`node.coord`/`node.chain` else delegates to `renderClause`, which detects nested optional
fields (`arg.rel`, `o.comp`, `frame.adv`) and recurses. Every combinator returns the same
`{tokens,text,gloss}` shape, so gloss-alignment holds at any depth; recursion terminates
(every nested node is strictly smaller, no back-edges). New dials LAG a word-order flip
(`gramOf` re-rolls only `wo`/`whFront` at branch), so a daughter that flips OV→SVO keeps
prenominal relatives / clause-final complementizers — the attested disharmonic window
(Mandarin SVO+RelN), emergent from descent.

**Corrections applied (the load-bearing determinism fix is shared mutable state, not
hashes):** **ISOLATE new closed-class linkers** — build compz/relz/'when' AFTER, with a
FRESH `seen` seeded from the finalized existing forms; **never** add them to the line-417
cross-class array (it retints downstream qp/impPart, moving pinned-Mandarin's Q particle).
Build converb/nominalizer/participial affixes LAST in `paradigmSpec` with their OWN dedupe
pass, NOT through the shared `taken`. **Add `nf`/`conv`/`rel` to the `inflectVerb` cache
key** (straight correctness bug — else `{conv:'ss'}` aliases the finite cell).
**Grammaticalize through the rule log** — wear from `nativeStemOf(lang, SAY)` (evolved),
NOT `rootFormOf` (pre-rule), or the "drifts under sound change" claim fails. Route a
clausal object (`o.comp`) around the NP case/agreement logic (else it takes ACC + 3sg
object agreement). Fix two roll-vs-gate contradictions (chaining residual fires for VO →
set non-OV to 0; coordFinal residual → gate on `suf`). Separate `advPos` (subordinator-
within-clause, WALS 94) from conditional-preposing (a ~85% correlate, not "always").
English relpron: `caseN:1` yields only `gen`, so render an **invariant** relpron
(who/that) — drop "inflects" from the English gate. F1's `renderClauseTree` must NOT
dispatch `node.chain` to F5's `chainRender` (stub to the coordination fallback until F5).
Broaden the regression guard to `closedOf`/`paradigmSpec` output, not just the leaf renderer.

New exports: `renderClauseTree`, `clauseLinkersOf`. **No new concepts strictly required**
(SAY, DAY, FINISH, dems, prons, 'and'‹with all exist).

### F1 — Coordination + the recursive scaffolding
- `{coord:'and'|'but'|'or', clauses:[node,…]}`. Reuses `closedOf.conj`. Only new dial
  `coordFinal` (`ov && affixSide==='suf' ? H('coordf')<0.14 : 0` — corrected: 0 for VO;
  the -que/clause-chaining edge, ~7% overall). Enclitic coordinator's worn form joins BOTH
  the last token's `.w` AND `.g` (else CONJ vanishes from the gloss while alignment still
  passes). **Refs:** all three `coordFinal:false`. **Regression guard ships here**
  (single-clause frames byte-identical). **Effort M.**

### F2 — Complement clauses (he said THAT …)
- `o:{comp:node}`. `compzSrc ∈ say|dem|wh` (iso favours the SAY-quotative;
  case/fusional favour dem/wh), `compzPos ∈ init|final` (OV⇒final), `compFinite`
  (`agg?H('cmpz')<0.5:true` — agg nominalizes want/know complements). Source: SAY (worn
  from `nativeStemOf`), distal demonstrative, interrogative 'what' — all exist. `np()`
  routes `arg.comp` through `complementTokens` BEFORE the case/agreement logic; agg
  nominalized path uses `inflectVerb {nf:true}`. **Refs:** mandarin `{compzSrc:'say',
  compzPos:'init', compFinite:true}`, russian `{'wh','init',true}` (что), english
  `{'dem','init',true}` (that). **Gates:** COMP token in the object slot, gloss-aligned;
  `compzPos==='final' ⇒ OV` ≥0.8; say/dem/wh each ≥8%, SAY over-represented in iso; agg
  `compFinite=false` renders a nonfinite inner verb. **Effort M.**

### F3 — Adverbial clauses (when / because / if)
- `frame.adv=[{sub:'when'|'if'|'because', …innerFrame}]`. `advPos ∈ init|final`
  (subordinator-within-clause, WALS 94; OV⇒final). `advAffix` (converb suffix vs free
  word; only `(agg||tmpl) && ov && affixSide==='suf'` — the Turkic/Japanese corner).
  Conditional preposing is a ~85% render correlate, NOT hard-always. IF/BECAUSE = existing
  `conj` forms; WHEN ← DAY ('on the day that'); causal converb ← BACK/'from'. Build the
  shared **`converbForm`** helper here (reused by F5). `inflectVerb {conv:'temp'|'cond'|
  'caus'}` (additive). **Refs:** all three `{advPos:'init', advAffix:false}`. **Gates:**
  right subordinator + conditional preposed; `advPos==='final' ⇒ OV` ≥0.8; converb path
  attaches to the subordinate verb + drops shared subject; 'when' deduped so it ≠ the
  interrogative 'when'. **Effort M.**

### F4 — Relative clauses (the king WHO saw the river)
- `arg.rel = {role:'s'|'o'|'obl', …innerFrame}`; the head plays `role` inside, rendered
  with a GAP (`renderClauseTree` internal 'suppress-role' arg). `relPre` (OV-skewed,
  ~28%), `relStrat ∈ gap|relpron|resump` (**relpron omitted from the prenominal pick list
  → the "no prenominal relative pronoun" universal falls out; relpron gated on
  postnominal AND caseN≥1**), `relzSrc ∈ dem|wh`. gap = invariant relativizer / agg
  participle (`spec.partcp`); relpron = relativizer inflected for the gap's case (invariant
  for caseN=1 English); resump = the ordinary personal pronoun in the gap. **Refs:**
  mandarin `{relPre:true, relStrat:'gap', relzSrc:'dem'}` (的, the SVO-but-RelN pin);
  russian/english `{relPre:false, relStrat:'relpron', relzSrc:'wh'}`. **Gates:** head
  appears once + inner clause has a gap + strategy token present; **0 langs have
  relpron+relPre** (the universal); gap plurality, relpron only in postnominal+case;
  resump retains a pronoun; **LAG** — an OV→SVO branch keeps `relPre` prenominal.
  **Effort L.**

### F5 — Clause-chaining & converbs with switch-reference (SS/DS)
- `{chain:[node,…]}`: medial verbs → converbs (`converbForm`), only the last finite; SS
  drops the shared subject, DS surfaces the new one, computed by **shallow structural
  comparison** of the `s` field (pin the key: `arg.n` concept id or `arg.pron.k`). `chaining`
  (`!iso && ov && affixSide==='suf' ? H('chn')<(agg?0.5:0.2) : iso&&ov ? H('chn')<0.3 :
  **0**` — corrected: non-OV → 0). `switchRef = chaining && !iso ? H('sr')<0.55 : false`.
  SS ← 'and'/FINISH, DS ← demonstrative/3rd-pronoun. A `chain` node in a non-chaining lang
  (incl. all three refs) degrades bit-for-bit to a coordination. tmpl SS/DS: excluded from
  switchRef (or a converb particle on medials). `spec.ssAff/dsAff` built last. **Refs:**
  all three `{chaining:false, switchRef:false}`. **Gates:** chaining WALS-shaped + every
  chaining lang verb-final; switchRef ⊂ chaining, never iso; SS drops shared subject +
  marks medial SS, DS retains + marks DS; LAG (survives a VO-flip); fallback renders refs
  sanely; a chained clause containing a relative/complement stays aligned. **Effort L.**

---

## §9. Global build order / phase plan

Nine independently-mergeable phases. Each ends **green on `npm test` (smoke:
determinism/invariants/save-load), `npm run validate` (stylized facts), `node
tools/probe_langfit.mjs` (probe gates), and lint.** Pin every new dial in all three refs
in the SAME commit as its roll.

### 9.1 Recommended order
| Ph | Content | Depends on | Notes |
|----|---------|-----------|-------|
| **P1** | Concept + side-table appends: `SEEM,BODY,LEAF,EXCEED,SAME,LORD` (+ VERBS for EXCEED); `AGENTIVITY`, `CLF_SENSE` | — | Tiny, append-only. Unblocks every cluster needing a concept. Re-run §6/§11 bands. |
| **P2** | **Concord (A)** — F1 assignment → F2 concord → F3 adjective; **F4 pronoun case can merge first** (independent, feeds Voice) | P1 (none of its sources are new) | `genderOf` rebuild re-bases gendered fus/tmpl names (cosmetic). |
| **P3** | **Alignment (F)** — the `coreCaseOf`/`effAlign` resolver refactor + the five split systems | P2 (rank reads pronoun person) | Foundational `renderClause` refactor Voice rides. |
| **P4** | **Voice (B)** — dial block, `spec.voice`, remap prepass | **P3** (resolver), **P2 F4** (obliques/pronoun case for by-phrase) | Prepass rebinds onto P3's resolver. |
| **P5** | **TAM (C′)** — remoteness/aspect/moods + TAM-side mir + `resolveMir` seam | P1 | Ships `resolveMir` with only the TAM branch. |
| **P6** | **Evidentiality (C)** — evid system + `evid.mir` extending `resolveMir` | **P5** (the shared seam), P1 (SEEM) | evid block computed ABOVE the mir block in `rollGrammar`. |
| **P7** | **Classifiers (D)** — sortal numeral classifiers | P1 (BODY/LEAF) | Low coupling; no name re-baseline; order-flexible after P1. |
| **P8** | **Nominal (E)** — number, possession, comparison, politeness | P1 (EXCEED/SAME/LORD) | Low coupling; order-flexible after P1. |
| **P9** | **Multi-clause (G)** — F1 scaffolding → F2/F3 → F4 → F5 | all above (recurses over the finished single-clause renderer) | Last + largest; the leaf renderer must be final. |

### 9.2 Cross-cluster couplings (call-outs)
- **Concord F4 → Voice.** Object/oblique pronoun forms feed the passive by-phrase and
  general pronoun handling. Merge P2 F4 before P4.
- **Alignment ↔ Voice** share the `renderClause` core-case block. Reconciled: Alignment
  owns the `coreCaseOf`/`effAlign` resolver (P3); Voice's detransitivizing prepass rebinds
  `trans/coreCase/objPers/sArg/oArg` then calls it (P4).
- **Evidentiality ↔ TAM** share the mirativity slot. Reconciled: one `v.mir` field, one
  `resolveMir` seam (TAM branch in P5, evid branch extends it in P6). TAM's mir dial reads
  the local `evid` defensively; evid block ordered earlier in `rollGrammar`.
- **`np()` hotspot** (Concord, Classifiers, Nominal, Voice, Multi-clause). Canonical branch
  order (§0.9): `arg.comp` → `arg.rel` → `arg.count` → poss/pol/adj/def core.
- **Split ergativity** in Concord F4 (pronoun paradigm) vs Alignment F4 (clause hierarchy)
  — different layers, both read pronoun person, neither restructures the other.

### 9.3 Canonical `mkAff` / dedupe append order (determinism)
When multiple clusters land, the appended source-claiming `mkAff` blocks follow a FIXED
order so incremental merges stay byte-identical among the new categories, each appended
**after** all existing (pl/du/cases/tam) calls: **number-extras (tri/pau) → possession
(possAff) → voice (caus/pass/antip/appl) → TAM-extras (prf/prog/hab, dist, moods, mir) →
evidentiality (ev:\*) → alignment (agt/pat/inv) → honorifics (honAff) → multi-clause
(partcp/ssAff/dsAff/nf/conv)**. New affixes are appended at the END of the relevant
`dedupeAffixSet` array; new closed-class linkers use a fresh `seen`; `patternVowels` gains
only `caus`/`pass` (voice) and `comp` (nominal), appended at the end of the key loop AND
added to the dedupe walk.

### 9.4 Probe growth
~106 → ~250 checks (evidentiality ~14, concord ~24, voice ~20, classifiers ~21, nominal
~31, TAM ~30, alignment ~24, multi-clause ~28), each in a new `§14+` section. Every cluster
adds a **before/after byte-identity regression gate** as its first check.

---

## §10. Collected appends

### 10.1 New concepts to append to the graph (append-only, after `HUNDRED` idx 246)
| Concept | `c(g, d, b)` | Also | Used by |
|---------|--------------|------|---------|
| `SEEM` | `c("seem","act",0.7)` | + `VERBS` | Evidentiality (inferential) |
| `BODY` | `c("body","bod",0.9)` | — | Classifiers (hum/anm/gen), possession |
| `LEAF` | `c("leaf","plt",0.7)` | — | Classifiers (flat) |
| `EXCEED` | `c("exceed","act",0.5)` | + `VERBS` | Nominal comparison (exceed/than) |
| `SAME` | `c("same","qua",0.6)` | — | Nominal comparison (equative) |
| `LORD` | `c("lord","gov",0.55)` | — | Nominal politeness (noble V-source) |

Append-only side tables (NOT concept ids): **`AGENTIVITY`** (proto-agent scores over
verb ids — alignment), **`CLF_SENSE`** + derived `CLF_SENSE_MAP` (noun→sortal-sense —
classifiers). New module consts: `EVID_SRC`, `CLF_SRC`, `MOOD_ORDER`, `PRIMARY_TAM`, and
new `AFF_SRC` rows (caus/pass/apass/agt/pat/inv/rec/rem/near/farfut/prf/prog/hab/opt/pot/
cond/sbjv/mir/tri/pau/hon). No new rule ids.

### 10.2 New exports (frozen-API rule: new capability = new export)
| Cluster | New exports |
|---------|-------------|
| Evidentiality | `evidentialSystem` |
| Concord | `classInventory`, `nounClassInfo`, `concordMarkers`, `agreementTargets`, `inflectAdj`, `pronoun` |
| Voice | `voicesOf`, `voiceEtymologies` |
| Classifiers | `classifiersOf`, `classifierEtymologies`, `classifierFor`, `classifSenseOf`, `numeralPhrase` |
| Nominal | `inflectPossessed`, `possessionType`, `comparative`, `tvPronouns`, `honorificVerb` |
| TAM | `tamShape`, `resolveMood` |
| Alignment | `agentivityOf`, `alignmentOf`, `clauseAlignment` |
| Multi-clause | `renderClauseTree`, `clauseLinkersOf` |
| Lexicon data | `SEEM`, `BODY`, `LEAF`, `EXCEED`, `SAME`, `LORD`, `AGENTIVITY`, `CLF_SENSE` |

**Additive optional keys** (NOT new exports; frozen signatures preserved):
`inflectVerb` opts `{ev, mir, voice, sclass, dir, hon, conv, nf, rel}` + mood/tam value
sets; `inflectNoun` opts `{poss}`; internal `renderClause` 'suppress-role' arg. Frame
fields per §0.6.

---

## §11. Deferred / out of scope

- **All sim/chronicle wiring.** `renderClause`/`renderClauseTree` stay Lab-side; the sim
  does not read them. Event-provenance → evidential value, and any event → frame mapping,
  are documented policies the sim would apply later — never built here.
- **Mensural / measure-word / repeater classifiers** (the huge Thai/Chinese counts);
  classifiers ships sortal only.
- **Overt noun-side class prefix** (Bantu `mtu/watu`) — deferred to protect the
  citation-stability invariants; concord is realized on dependents only.
- **Predicative adjective agreement** — the frozen frame has no copula slot; attributive
  only in v1 (add a predicate field later or leave parked).
- **Head-marking (Lakota-type) active** — our agreement is a single person set, not split
  A-set/O-set; active is dependent-marking (caseN≥2) only.
- **Causative-of-transitive / double-object applicative** — the `{s,o,loc}` frame
  under-specifies the third argument; a clean `v.causer` extension is parked.
- **Compound alignment splits** (both tam- AND hierarchy-conditioned) — `ergSplit` is
  single-valued; one split axis in v1.
- **Reference tracking beyond a shallow subject comparison** for switch-reference;
  obviation (3→3 defaults to direct); SAP-internal 2>1 ranking.
- **Orthographic lag, L5 writing systems** — unchanged from the comprehensive spec's parked
  list.
- **Free-form English input / a controlled-English parser** — frames remain the only input.

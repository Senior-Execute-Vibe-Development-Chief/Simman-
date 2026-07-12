# Spec — Comprehensive language system: span the world's languages

Status: **L1–L4 BUILT; M1/M2/M3/M5 BUILT, M4 built lab-side only** (see
status notes at bottom). L5 (writing systems) remains designed-not-started.
Companion code: `src/sim/language.js` (records, lifecycle, name API),
`src/sim/languagePhonology.js` (feature bundles, typological profiles,
sonority syllable grammar, romanization), `src/sim/languageLexicon.js`
(concept graph + name pools), `src/sim/languageChange.js` (rule-based sound
change), `src/sim/languageGrammar.js` (syntax dials, closed classes,
inflection, clause renderer). Acceptance probe: `tools/probe_langfit.mjs`.

## Directive

Rebuild the language system so its parameter space is CAPABLE of expressing
all (or most) real-world language types — phonology first, then a basic
word/meaning layer, then generated writing systems. "Capable of recreating"
means the DIALS can be set to a profile whose output is recognizably
English-shaped / Mandarin-shaped / Russian-shaped etc.; it never means
shipping real lexicons as content. Generated languages stay procedural; real
profiles are an expressible corner of the space (and, on the Earth preset,
an explicitly labelled scenario — same rule as `EARTH_HEARTH_SITES`).

## Capability bar (acceptance tests)

Three reference profiles chosen to be mutually far apart; the system is
"comprehensive" when all three are expressible by dial settings alone:

| | Mandarin-shaped | Russian-shaped | English-shaped |
|---|---|---|---|
| syllables | CV(n/ŋ) only | CCCV(C), vzgl- onsets | CCV(CCC), str- onsets |
| prosody | 4 contour tones | mobile stress | stress + reduction |
| inventory | retroflexes, aspirates, ü, no voiced stops | palatalized pairs (soft/hard) | large vowel set (12+), th |
| morphology | isolating + compounding | fusional, gendered suffixes | analytic + compounds, borrowing strata |
| name grammar | family-first, 1-syl surname | patronymic -ov/-ova/-evich | given+family, compound surnames |

Today's generator reaches none of the three: clusters cap at 2 consonants
(two fixed templates: stop+liquid, s+stop), no tone/stress dimension, no
palatalization, vowels cap at 6+2 diphthongs, no morphology beyond a suffix
fashion, no lexicon.

## Why the current design is the right foundation

Two things in `language.js` must survive the rebuild, because they are the
hard-won part:

1. **Polarized profiles (the anti-mush move).** Independent uniform rolls
   regress to the mean and produce generic conlang mush. Distinctiveness
   comes from pushing dials to coherent corners and letting features CO-VARY.
   The rebuild keeps this and grounds the co-variation in real typology
   (WALS-style correlations) instead of ad-hoc pairs: e.g. huge consonant
   inventories pair with small vowel systems (Caucasus pattern); strict CV
   pairs with tone (West-African pattern); big clusters pair with big codas
   (European pattern). Poles become *typological attractors*.
2. **Descent, not climate.** Regional resemblance comes from common descent
   (branch) and contact (borrow), never from terrain. Unchanged.

## Architecture

### A. Internal representation: features, not letter-strings

Phonemes become small feature bundles — `{place, manner, voice, secondary}`
for consonants; `{height, backness, round, nasal, long}` for vowels — with
the current romanized strings demoted to a RENDERING of the bundle. This is
the keystone change: sound change, palatalization, harmony, tone marking,
and (later) script fitting all need to see features, not "kh" strings.

- **Consonant space**: places {labial, dental/alveolar, retroflex, palatal,
  velar, uvular, pharyngeal, glottal} × manners {stop, nasal, fricative,
  affricate, liquid, glide, trill} × laryngeal {voiced, aspirated, ejective,
  implosive, prenasalized} × secondary {palatalized, labialized,
  pharyngealized}. Clicks as a rare flagged series. Inventory size ranges
  ~8..60 (real range: Rotokas 6 → Taa 80+), sampled small-skewed.
- **Vowel space**: 2..14 qualities on height×backness×rounding (front
  rounded unlockable), plus independent flags for nasal vowels, length,
  and diphthong richness.
- **Prosody** (new axis): `none | pitch-accent | register tone (2-3) |
  contour tone (4-6)` + stress `fixed-initial | fixed-final | penult |
  mobile`. Tone renders as diacritics on request, plain otherwise.
- **Harmony** (new axis): `none | front/back | rounding | ATR` — a word-level
  constraint on the nucleus sequence (Turkish/Finnish/Mongolian texture).
- **Syllable grammar**: replace the two cluster templates with a **sonority
  slope generator**: each language rolls max onset/coda depth (0..3), a
  sonority-rise tolerance, and licensed exceptions (s+stop; sibilant codas).
  This single change puts str-, vzgl-, and CV-only all inside the space.
- **Phonotactic constraints**: coda whitelist (Mandarin n/ŋ; Japanese n),
  final devoicing, cluster simplification medially — a small closed set of
  toggleable constraint rules applied at word-synthesis time.

### B. Romanization layer

One internal form → per-language surface spelling. A language rolls a
romanization convention (digraph vs diacritic taste: `sh` vs `š`, `ü` vs
`iu`; apostrophe for ejectives/glottal). UI-facing names stay ASCII-friendly
by default with a lever for full diacritics. This also creates the hook for
**orthographic lag** (below).

### C. Sound change as rules (drift/branch upgrade)

Replace add/remove-a-phoneme drift with **rule-based shifts** operating on
features: lenition (p→f), palatalization before front vowels (k→ch/i),
final-vowel loss, cluster simplification, tonogenesis (coda loss → tone
split), chain shifts. Drift applies a weighted-random rule within character;
branch applies N rules by divergence distance.

Payoff: sister languages now differ by REGULAR correspondences — the same
inherited place-name surfaces as `Karda` / `Cherda` in two daughters. A
reader (or a probe) can *do comparative linguistics on the map*. Rules are
recorded on the language record, so etymology is replayable — historiography
for words.

### D. Morphology + the basic word layer (the "meaning" ask)

- **Morphotype dial**: isolating | agglutinative | fusional | templatic
  (root-and-pattern, Semitic-style triconsonantal roots — a distinct
  synthesis mode where a root k-t-b interleaves with vowel patterns).
  Polysynthetic folds into agglutinative-with-long-words for our purposes.
- **Semantic root lexicon**: each root language generates a root stock
  (~800–2,000 roots) over the shared CONCEPT GRAPH (see "Lexicon at scale"
  below). Daughters inherit roots through the sound-change rules (cognates
  for free); borrowing copies roots across contact (loanword strata for
  free).
- **Compound toponymy**: place names become meaningful compounds —
  ⟨new⟩+⟨fort⟩, ⟨north⟩+⟨capital⟩, ⟨black⟩+⟨water⟩ — synthesized through the
  language's morphotype. The UI can show glosses ("Neuborg — 'new fort'").
  Conquest layers strata: a captured city keeps its old name filtered
  through the conqueror's phonology, or gets renamed and the chronicle
  records both. The map becomes readable historical-linguistic evidence.
- **Name grammar**: name order (given-family | family-given), patronymic
  system (suffix -son/-ov | prefix Mac/ibn | none), gendered endings,
  theophoric/meaning compounds for personal names. Dynasty and person
  naming route through this instead of the current suffix-only fashion.

### D2. Lexicon at scale — a virtual, language-sized dictionary

The 150-concept toponym list is the seed of something much bigger, and the
architecture that reaches "proper dictionary" size is NOT per-language
dictionaries. The lexical-typology insight: meanings are (approximately)
shared across humanity; languages differ in the FORM→MEANING MAPPING. So:

1. **One shared concept graph (a data asset, like earthData).** ~3–5k
   concepts with typed relations (is-a, part-of, associated-with, made-of),
   curated toward the sim's world (nature, kinship, war, faith, crafts,
   governance). Real scaffolding exists to curate from: Concepticon (~4k
   standardized concept sets), CLICS (empirical cross-linguistic
   colexification frequencies), WordNet (relation structure), and
   basicness rankings (Swadesh / Leipzig-Jakarta) for deciding which
   concepts get atomic roots. Packed size ~100–300 KB.
2. **Per-language lexicalization map (generated, tiny).** Each language
   rolls: a root stock (~800–2,000 roots) assigned to the most basic
   concepts; COLEXIFICATION choices biased by the CLICS frequencies (does
   this tongue share a word for tree/wood? hand/arm? blue/green?) — cheap,
   empirically-calibrated semantic personality; and a derivation strategy
   from its morphotype — compounds, affixes, metaphorical extension along
   catalogued recurrent pathways ("grasp"→"understand"; DatSemShift-style).
3. **The dictionary is VIRTUAL.** `wordOf(lang, conceptId)` is a pure
   deterministic function of (language state, concept), computed on demand
   and cacheable — exactly like names today. A language stores only its
   root seeds + rule log; the full ~8–15k-word effective vocabulary exists
   the way terrain exists before you look at it. Scaling to a bigger
   dictionary is concept-graph DATA, not architecture.
4. **Relations fall out, never authored per-word:** polysemy = the
   colexification rolls; synonymy = native + borrowed forms on one concept;
   etymology = the recorded derivation tree (every word can explain
   itself); cognates = L4 sound-change rules over inherited roots; register
   strata = domain-selective borrowing from prestige languages (conquest/
   faith/trade contact — measurable from the sim's own graphs — donates
   government/religion/luxury vocabulary while the native stock keeps body
   parts, farm animals, kin). That last one IS the English pig/pork
   phenomenon, generated from the sim's own conquests.
5. **Scope line:** no grammar engine, no sentence generation/translation.
   The payoff ceiling is: every name glossable, titles/mottos/epithets
   renderable in-language, per-language dictionary export in the world
   bible, and etymology as historiographic evidence.

### E. Orthographic lag (silent letters, emergently)

A literate language's SPELLING freezes at the sound-change generation when
its written tradition consolidated (archive continuity, from the existing
literacy/records machinery); speech keeps drifting. Rendered names then
show the written form with fossil letters — an emergent "-ough" — while a
newly-literate or spelling-reformed tongue spells shallowly. Cardinal-rule
clean: gated on the language's own archive history, never on era.

### F. Writing system generator (the second ask)

A `script` record per literate tradition, EMERGENT in both existence and type:

- **Birth**: scripts appear where records/organization tech crosses the
  literacy threshold (the machinery dynasties already gate on). An
  *independently invented* script is **logographic** (accounting-token
  origin — matches every real primary invention: cuneiform, oracle bone,
  Maya).
- **Type evolution by transmission** (the real mechanism, and it is
  gorgeous for us): scripts simplify one structural step when BORROWED
  across a language boundary, in a direction set by the borrower's
  phonology — logography → syllabary for CV languages (kana pattern);
  → abjad for templatic/consonantal morphologies (Semitic pattern);
  abjad → alphabet when adopted by a vowel-rich language (Greek-from-
  Phoenician pattern). Abugidas arise on the syllabary/abjad boundary.
  So script typology falls out of descent + contact + language structure —
  no script type is ever assigned by fiat.
- **Spread**: along the same trade/conquest/faith channels other identity
  layers use (state chanceries and scriptures carry scripts; a convert
  realm often takes its faith's script — the Arabic/Latin/Cyrillic split).
- **Record fields**: `{type, parentScriptId, glyphBudget, styleSeed}` —
  glyphBudget derived from type (logographic thousands, syllabary ~50-100,
  alphabet ~20-40).
- **Rendering (optional eye-candy phase)**: procedural glyphs from a seeded
  stroke grammar (style params: stroke curvature, density, aspect, writing
  direction) so the settlement/realm inspector can show a name "in its own
  script" beside the romanization. Pure renderer; zero sim reads.
- **Sim coupling, deliberately minimal at first**: cosmetic + chronicle
  events (`script.created`, `script.adopted`). A later, separately-measured
  step MAY couple shared-script to knowledge-diffusion/admin friction —
  only behind a lever with the usual 3-seed validation.

## What does NOT change

- The public API (`langWord`, `langPlaceName`, `langRealmName`,
  `langPersonName`, `langDynastyName`) keeps its signatures — zero churn in
  callers. New capability is internal.
- Determinism: all new rolls keyed off the language seed + named substreams,
  exactly as now. Names remain pure functions of (language state, n).
- Descent-not-climate; polarized-profile philosophy; family hue rendering.
- `cultures.js` integration points (foundLanguage/branchLanguage/borrowFrom
  call sites) — borrowFrom gains a `depth` arg (sound vs roots) but keeps
  its default behavior.

## Phases (each independently mergeable, each ends green on test+validate)

- **L1 — Features + sonority syllable grammar + romanization layer.**
  The keystone. Reaches Russian/English *shapes* (clusters, palatalization,
  big vowel sets). Acceptance: `tools/probe_langfit.mjs` pins the three
  reference profiles by hand-set dials and prints 20 sample names each for
  eyeball + automated shape checks (cluster depth, coda inventory, vowel
  count). Existing worlds regenerate with different names (names are
  cosmetic; probe_hashbase re-baselines — noted, accepted).
- **L2 — Prosody + harmony + phonotactic constraint set.** Reaches Mandarin
  (tones, coda whitelist) and Turkish (harmony) shapes. Tone/diacritic
  rendering lever.
- **L3 — Morphology, root lexicon, compound toponymy, name grammar.**
  Words mean things; toponyms gloss; conquest layers names; patronymics.
  Largest phase; the payoff is map-legible history.
- **L4 — Rule-based sound change + orthographic lag.** Regular
  correspondences between sisters; emergent silent letters. Upgrades drift/
  branch in place (records rules on the language for replayable etymology).
- **L5 — Writing systems.** Script records, emergent typology chain, spread
  events; optional glyph renderer last.

Suggested order rationale: L1/L2 are self-contained capability (cheap,
high-flavor); L3 is the big investment and depends on L1's representation;
L4 needs L3's roots to show cognates; L5 rides the existing literacy and
contact machinery and lands independently after L2.

## Open questions (decide before/while building)

1. **Diacritics default**: ASCII-safe surface by default with a lever, or
   full diacritics everywhere? (UI font coverage is fine either way;
   readability of the event feed is the real question.)
2. **Name churn on existing saves**: L1 changes every generated name for
   the same seed. Accept (names are display) or version the generator per
   language record (`genVersion`, old languages keep old synthesis)?
   Leaning: accept for new worlds, keep saves' recorded names as-is (names
   are already stored on entities at creation).
3. **Concept-graph curation**: which ~3–5k concepts, and who curates the
   packed data asset (D2)? A minimal L3 can ship with a few hundred
   concepts (toponyms + epithets + titles) and grow the graph as pure data
   afterwards; the lexicalization architecture doesn't change with size.
   Sentence generation stays out of scope at every size.
4. **Script-shares-ease-diffusion coupling** (L5+): mechanism is plausible
   (shared script genuinely eased knowledge transfer) but touches validated
   history — separate lever, separate 3-seed run, or skip.

---

## Build status (session 7)

**L1–L4 are BUILT in one coherent system**, public API unchanged (callers in
cultures.js/faiths.js untouched). What shipped vs the plan above:

- **L1/L2 (phonology)**: feature-bundle phonemes; typological-attractor
  profiles (tone anti-correlates with cluster depth; Caucasus corner;
  CV(N)-nasal-coda corner); sonority-slope syllable grammar with the s+stop
  licence; palatalization/labialization; harmony (front-back / rounding);
  tone + stress as profile dials (tone not yet rendered — no diacritics in
  v1 rendering); per-language romanization taste bits. Capability bar
  verified by `tools/probe_langfit.mjs`: Mandarin-shaped (nasal-only codas,
  no clusters, contour tone dialled), Russian-shaped (onset clusters in
  60% of words, palatalized series, patronymic dynasties), English-shaped
  (3-deep onsets, 11-vowel dial, glossed compound toponyms) — all pass,
  plus a determinism + JSON-roundtrip gate.
- **L3 (lexicon)**: ~150-concept shared graph with domains, basicness,
  derivation pairs, and CLICS-style colexification affinities
  (languageLexicon.js — ids are persisted indices: APPEND ONLY). Virtual
  dictionary `wordOf(lang, concept)` — loans win over native, colex
  resolves recursively, derived concepts compound (or RE-VOWEL the root
  skeleton under the templatic morphotype — maktab-style). Suffix fashions
  are now MEANINGFUL: city suffixes are worn-down roots for town/fort/house
  (-burg/-ton machine), realm suffixes the root for LAND (-stan machine),
  patronymics the root for SON (-son/-ov machine); they shift with sound
  change because they ARE words. `langPlaceNameEx` returns {name, gloss}
  with a 20% lost-etymology class (gloss null). Person names draw meaning
  compounds from a virtue/animal pool; gendered endings per profile.
- **L4 (sound change)**: 12 rules over feature bundles (lenition,
  palatalization, final-vowel loss, coda loss, devoice/voice, raising,
  rhotacism, h-loss, cluster simplification, umlaut, vowel nasalization) —
  ids persisted in the record's rule log, APPEND ONLY. Drift = append one
  applicable rule; branch = inherit log + append ~divergence×4; every
  native word replays the log ⇒ regular correspondences across families
  (probe demo: root kekhe → daughters kikhi / keshe).
- **Persistence/determinism**: records carry only plain-JSON state (seed,
  famSeed, prof, rules, loans, xph); ALL derived state (inventory, colex
  map, word cache, suffix fashions) lives in a WeakMap keyed by record and
  invalidated on gen/loans/xph change, so save→load rebuilds byte-identical
  names by construction. v1 records from old saves upgrade lazily
  (ensureV2) — stored entity names untouched, new names differ (accepted:
  open question 2). smoke + full validate green; probe_hashbase
  re-baselines (names changed for every seed — expected, cosmetic).
- **Loan strata**: borrowFrom now borrows a PHONEME (into `xph`) and, 80%
  of the time, a prestige-domain WORD (frozen surface form at borrow time)
  — the pig/pork machine, wired to the existing culture-contact call site.

**Not built (parked)**: orthographic lag (needs archive-age input — small,
do with L5); L5 writing systems entirely; UI surfacing of glosses/etymology
in the SIM app (langPlaceNameEx exists; the Language Lab uses it — natural
first sim-UI win: settlement inspector shows "Neuborg — 'new fort'").
(Tone rendering DID land: contour-tone languages with toneMarks render
diacritics, with word-level tone salt so homophones split — dí vs dì.)

---

## Toward full translation (M-phases, designed not started)

The word layer above is done through eight rounds of external review
(licensed syllabaries, name pipeline, shuffle-test 98%+). "Translates
fully" is the SENTENCE layer. Dependency order:

- **M1 — closed-class vocabulary**: pronouns (per-language person/number/
  gender distinctions, incl. clusivity), demonstratives, negation, question
  words, conjunctions, adpositions, NUMERALS (base-10/20/5 with formation
  rules). Concept-graph data + a few dials.
- **M2 — inflectional morphology** (the heart): nominal case (none →
  nom-acc → erg-abs, 0–15), number, gender/noun classes (0–16),
  definiteness; verbal TAM + person agreement. Realization style comes
  from the EXISTING morphotype dial (iso: particles · agg: stacked regular
  affixes · fus: fused portmanteaus + irregularity · tmpl: pattern change).
  Two mechanisms keep it emergent: GRAMMATICALIZATION — affixes are
  worn-down words via the existing reduce() machine (case endings from the
  language's own 'at/go/finish'), and IRREGULARITY BY FREQUENCY — the most
  basic verbs (basicness already on the graph) get suppletive paradigms.
- **M3 — syntax dials with Greenberg correlations**: SOV/SVO/VSO (real
  frequencies), adposition side, adjective/genitive order, negation,
  questions — CORRELATED rolls (OV ⇒ postpositions) with a probe gate
  checking the universals hold across rolled languages.
- **M4 — the frame renderer (the scoping insight)**: the sim's EVENT LOG
  already is the semantic-frame input format (war.began {attacker,
  defender, cause} IS the parse of the sentence). Translation = frame →
  inflect → order → render through the existing phonology/orthography,
  plus an INTERLINEAR GLOSS line. Endgame artifact: chronicles written in
  each realm's own tongue, scribes' version in-language, gloss beneath —
  historiography and linguistics fused. Free-form English input is out of
  scope until/unless a controlled-English parser is wanted; frames cover
  every sentence a chronicle contains. Lab gets a Translate panel.
- **M5 — diachrony reaches the grammar**: grammaticalization CYCLES (case
  systems erode and re-form), analogy leveling, daughters inheriting
  paradigms through the sound-change log — sister languages with COGNATE
  CONJUGATIONS, which is what a real family is.

Effort: M1 small · M2 large · M3 small · M4 medium (immediately demo-able)
· M5 medium. The external-review loop (generate → hand to a fresh reader →
convert complaints into gates) transfers directly to grammar.

---

## Build status (session 8) — the grammar layer

**M1, M2, M3, M5 are BUILT** in `src/sim/languageGrammar.js`; **M4 is built
as the Lab-side frame renderer only** (the owner wants the sim untouched —
no chronicle wiring, no event-log reads; `renderClause` is ready for it).
Everything follows the two house invariants: grammar dials live in
`prof.gram` (plain JSON, famSeed-rolled from named substreams, pinned by
every reference profile in languageRefs.js), and ALL derived forms —
pronouns, numerals, paradigms, clauses — live in a WeakMap cache keyed by
the record and invalidated on gen/loans/xph change, so save→load rebuilds
byte-identical output by construction. What shipped vs the plan:

- **M3 first, structurally**: syntax dials roll CORRELATED at real
  frequencies (WALS-shaped SOV/SVO/V-initial split; OV ⇒ postpositions ⇒
  genitive-first ⇒ suffixing; V-initial ⇒ prepositions + wh-fronting; SOV
  carries case, morphotype scales its richness; ergativity a real minority
  of case systems). A 300-language Greenberg gate holds the universals.
- **M1 (closed classes) — grammaticalized, not invented**: adpositions wear
  down from body parts (belly→in, foot→under, hand→with, face→to), plural
  pronouns from 'many' (wǒ-men) or suppletive roots per morphotype, duals
  from 'two', inclusive 'we' optionally welded from I+thou (yumi), definite
  articles from the distal demonstrative, indefinite from 'one', question
  words compound ONE interrogative root with man/earth/day/road (the wh-
  series), demonstrative distance is vowel sound-symbolism (proximal i,
  distal a), negators lean nasal. Numerals: base-10/20/5 with real formation
  (five-two = 7; two-twenty = 40; quinary 'five' can BE 'hand', the score-
  word can BE 'man'). Every closed form is a pre-rule synth replayed through
  the whole rule log ⇒ cognate pronouns across families (mi/me/moi).
- **M2 (inflection) — the onion**: an affix is a source word worn to a
  clitic syllable at a birth point t in the rule log; the JOINED stem+affix
  rides the rest of the log as one form. Erosion, seam sandhi, stem
  alternations and case syncretism all fall out of the sound laws (codaLoss
  really does eat a dative -t). Realization per the existing morph dial:
  iso = particles; agg = stacked syllables with tier-clamped slot order
  (number/aspect inner, case/tense middle, person outermost = youngest,
  like life) and vowel harmony reaching the affixes (-lar/-ler incl. the
  a~e low pair); fus = portmanteau crush (first affix keeps its body, the
  rest leave ≤2 consonant traces: -m vs -mp) + theme-vowel declension
  classes on fused endings; tmpl = pattern change (broken plurals, TAM
  re-vowelling). Person agreement = the language's own pronouns cliticized;
  3sg is often zero. Irregularity BY FREQUENCY: b≥0.95 draws suppletive
  ghost-verb pasts ('went' is a verb the language otherwise forgot),
  fusional b≥0.9 ablauts and sheds the affix (sang), agglutinative basics
  syncopate. Contrast maintenance dedupes what actually survives (the
  consonantal skeleton under fusion OR harmony — harmony retints affix
  vowels per stem, so vowel-only person contrasts neutralize; learned from
  the rendered page).
- **M5 (diachrony)**: the grammaticalization CYCLE — an affix ground to
  silence renews from a fresh quarry word at a later birth point, tested
  against the language's own phonology (marked cell vs bare stem on a probe
  noun), so case systems erode and re-form and sisters diverge in paradigm
  structure. ANALOGY LEVELING as a hazard per rule-log index keyed on
  (family, concept, index): least-basic irregulars level first, b=1.0 never
  does, sisters share leveling history to the branch point. Word order can
  flip once at branch (~12%) while adpositions/affix side LAG — the real
  disharmonic window. Cognate conjugations fall out of family-shared
  sources + births and per-language rule tails; the Lab cognate table shows
  inflected rows.
- **M4-lite (frames)**: `renderClause(lang, frame)` — frames are
  {s, v: {c, tam, neg}, o, loc, q}, exactly the shape of a chronicle event.
  Alignment-aware case marking (ERG on transitive subjects only),
  agreement, pro-drop, negation (affix or particle at the dialled position
  incl. clause-final), polar particles (ma/ka) at the dialled edge,
  wh-front vs in-situ, adjective/article placement, adjuncts preverbal in
  OV. Token-aligned interlinear gloss (Leipzig-style: PL, ACC, PST, ⟨PST⟩
  for stem-internal marking, dots for fused). The Lab's Sentences card is
  the demo: frame builder + canned frames, language line over gloss line.
- **Gates added** (probe_langfit.mjs): Greenberg universals ×300; closed-
  class distinctness/family-resemblance/base-formation; pinned-Mandarin
  pinyin legality for the whole closed layer AND rendered clauses (SVO +
  postverbal PFV particle + final Q particle); citation stability
  (NOM.SG = wordOf, so the name layer is untouched); paradigm contrast
  (sg-row ≥85% — plural-oblique syncretism is honest Latin); irregularity
  in the basicness belt only; harmony-in-affixes; cycle audibility +
  renewal occurrence; leveling monotone + occurring; cognate sources +
  divergence; word-order shift rate + morphology lag; clause gloss
  alignment, verb-position-per-dial, ergativity, pro-drop; determinism +
  JSON-roundtrip for closed classes, paradigms and clauses.

**Not built (parked, unchanged)**: sim/chronicle wiring for M4 (frame
renderer is ready; wiring is a sim-side decision), politeness/T-V pronouns,
object pronoun case forms, adjective agreement, L5 writing systems,
orthographic lag.

---

## Build status (session 9) — reduplication + imperative/mood

Two of the commonest cross-linguistic features the M-phases had skipped —
picked because a frequency audit showed them MORE common than several
things already built (reduplication ~85% of languages, imperative
~universal). Both roll per family from named substreams, are pinned in all
three references, and touch nothing outside the grammar layer.

- **Reduplication** — a productive process ORTHOGONAL to the morphotype
  (isolating Chinese kàn-kan, agglutinative Malay orang-orang, and fusional
  tongues all reduplicate). Dial `prof.gram.redup = {type: full|partial,
  fns: [plural, aspect, intensive]}`, ~45% of rolled languages, leaning
  isolating/agglutinative. `full` copies the whole stem written with a
  hyphen (orang-orang); `partial` prefixes a light CV- copy (Tagalog
  su-sulat), falling back to hyphenated-full for vowel-initial stems.
  Rendered as a SURFACE process (each copy rendered separately) so
  renderWord's accidental-digraph collapse (ghgh→gh) can't eat a genuine
  reduplication (sisin→sin) — the reduplication-vs-haplology tension,
  resolved. Reduplicative plural REPLACES the plural affix (inflectNoun);
  reduplicative aspect is the iterative imperfective (inflectVerb);
  `intensive(lang, cid)` covers the adjectival use (big → big-big).
- **Imperative + mood** — `prof.gram.imp = bare|suffix|particle` (~42/40/18%,
  bare-stem commonest, English/Chinese "Go!") and `prohib = neg|special`
  (a dedicated prohibitive negator, Latin nolī / Mandarin bié, ~25%).
  `inflectVerb(…, {mood:"imp"})`: bare = citation stem, suffix = a late
  opaque affix, particle = a hortative-like word; imperatives are
  addressee-directed so they carry no tense and the frame renderer drops
  the 2nd-person subject. Prohibitive = negated imperative (special negator
  where the language has one).
- **Gates** (probe_langfit.mjs §9–10): reduplication occurrence rate,
  crossing into isolating tongues, plural/aspect actually copying the stem,
  pinned-Mandarin hyphenated legal-pinyin verb reduplication, intensive
  rendering, determinism; every language has an imperative, strategy
  frequencies, bare = citation stem, marked ≠ stem, prohibitive is negated,
  subject-drop, pinned English bare / Russian suffix, determinism. Lab:
  reduplication + imperative chips, an IMP row in the conjugation table, a
  reduplication note with a live intensive example, and a Mood control +
  two command frames in the Sentences panel.

Coverage lift: the two most common gaps from the typological audit closed;
still parked are voice (passive/antipassive/causative), evidentiality,
numeral classifiers, noun-class concord, and the rarer alignments.

---

## Build status (session 10) — the homophony/diversity review round

A fresh reader stress-tested the random roller and caught a real regression
plus a diversity collapse; both converted to mechanisms + gates, not
symptom patches (cardinal rule 2).

- **The saturation guard (languagePhonology.applySignature)** — THE fix. A
  language must be able to FIT its vocabulary: the distinct-monosyllable
  count is ≈ onsets × nuclei × codas × tone-levels, and the forms it can
  mint is syllSpace^wordLen. When that falls short of the ~220-concept
  vocabulary (with birthday-paradox headroom, aiming space^len ≫ vocab²),
  the language pays the REAL price — TONE (Sinitic: tone multiplies the
  space, words stay short) or LENGTH (Japanese/Polynesian: atonal, words
  grow). Rolling which SPLITS the CV cell into distinct looks instead of one
  monosyllabic-tonal-nasal blur (the "four flavors of the same island"),
  and it is the same mechanism that kills the pathological homophony. WALS-
  recalibrated sylC (CV ~30%→~20%, a real minority).
- **Homophony repair (language.seedDictionary)** — the 狮→狮子 machine. The
  guard sizes the space, but the licensed syllabary + frequency skew still
  let unrelated basics collide. So the dictionary is assigned in a fixed cid
  order and a fresh word whose surface collides with one already taken by an
  UNRELATED concept is extended/reshaped until it clears (colexified pairs
  are intended merges, skipped). Result: 0/400 languages over 12% core
  homophony (worst was 59%), ~2.6 ms/lang, JSON-round-trip-stable. The
  reported regression (seed 8817: three=four=five=a) now speaks a distinct
  vocabulary.
- **Hard numeral uniqueness (languageGrammar.numeralTable)** — no market
  tolerates homophonous numerals. 1..99 built in order, forced distinct;
  the escapes in order of realism are uncontracting the multiplier
  (three-ten, not thir-ty) then irregularizing the last vowel (why 'eleven'
  isn't 'one-teen'). 0/500 languages have a collision in 1–40.
- **Toneless enclitic particles** — the 吗/了 slots go neutral-tone in a tone
  language (rformNeutral), while pronouns and negators (bù, bié) keep their
  melody.
- **Diversified grammaticalization pathways** (already landed in M2's AFF_SRC
  pools; gated this round): in←house/belly, on←back/head, under←earth/foot,
  from←back/mouth, of←house/kin, to←face/go, with←hand — no single pathway
  monopolizes.
- **Gates** (probe §11): core-homophony budget (<18%, checked 500 langs),
  numeral distinctness 1–10 and 1–40, the specific regression seed, WALS-
  shaped syllable distribution, CV-cell flavor spread (≥3), neutral-tone
  particles vs tone-keeping content words, adposition-source diversity.
  86 probe checks green; shuffle test rose to 99% (more varied phonology =
  more separable). Names re-baseline (accepted, cosmetic).

Parked enhancement the reader suggested: an INTENTIONAL abstract-derivation
table (king ← sit/old/great — the "one who sits on the throne"), to turn
accidental etymologies into designed depth now that accidental homophony is
gone. Noted for a future session.

---

## Build status (session 11) — cross-layer consistency review round

The reviewer confirmed the roller is fixed (six genuinely distinct
languages, shuffle test met) and praised the grammar depth (polypersonal
agreement, templatic root-and-pattern, ablaut plurals, hand→with→and
chains), then caught a cluster of DESYNC bugs that were consequences of the
homophony repair not being threaded through one source of truth.

- **Root-level homophony repair (language.js).** The repair now targets the
  PRE-RULE ROOT of an atomic concept (cached in `c.roots`), and BOTH
  internalOf (dictionary) and rootFormOf (grammar/numerals) build from it —
  so the dictionary word, the paradigm's citation cell, and the counting
  system can never disagree. Fixes: 'go' = šüvep in the paradigm but
  šüvepxik in the dictionary; base-5 '6' = paxobe in the counter but deqe in
  the lexicon; 'go' = 'long' homophony. numAtoms no longer re-dedupes (the
  dictionary already did); the Lab shows numeral concepts in their counting
  form via `numeralConceptWord`. Gates: citation verb ≡ dictionary word
  (0/1600), dictionary numeral ≡ counting form (0/2000).
- **Cross-category affix dedupe (languageGrammar.js).** One contrast pass
  over ALL bound affixes, nominal and verbal together — a suffix can no
  longer serve as both PL and PST (the -fe clash), which had made the
  interlinear gloss read two ways. The escape walk now spans vowels × coda
  consonants, so a three-vowel ten-case language can still separate DAT from
  TERM. Gate: 0/373 languages with a PL=PST-style clash.
- **Consistent dynasty naming (language.js).** The house suffix is a
  per-family constant (a fixed land-style ending, or consistently bare —
  the Habsburg pattern), never the old per-name coin flip that put
  Efatucheta beside a bare Edo. Gate: same founder → same house name across
  ordinals (0/86 inconsistent).
- 90 probe checks green; smoke + validate green. The reviewer's six seeds
  (8822–8827) all verified clean.

---

## Build status (session 12) — intentional abstract derivation

The standing reviewer suggestion (parked at the end of session 10): now that
accidental homophony is gone, turn the *accidental* etymologies the phonology
used to throw off (Neteck's chance sit=king) into *designed* depth. Abstract
concepts (king, god, law, temple, victory…) previously synthesized as bare
roots; they can now DERIVE from concrete/basic ones on purpose — routed
through the existing joinInternal / rule-log machinery, so the etymology is
recoverable AND drifts under sound change like a real inherited compound
(cyning → king). Built as a SYSTEM, never a fitted output.

- **The DERIV table (languageLexicon.js).** A curated relations table, shaped
  exactly like COLEX: `[target, [head, mod], probability]`. ~40 pathways over
  15 abstract targets — king ← sit+high / great+man / old+man; god ←
  sky+high / sky+great / sky-father; law ← say+true / say+strong; temple ←
  holy+house; tomb ← death+house; victory ← war+finish; council ← many+men.
  Sources are ALWAYS concrete concepts (never other targets), so the full
  dv+DERIV graph is a DAG one morpheme deep — the etymology stays recoverable
  and generation can't recurse forever. Append-only, like every id-bearing
  table.
- **Per-family adoption, morphotype-scaled (language.js compile()).** Each
  family rolls adoption per entry from its own `aderiv` hash stream; a target
  takes the FIRST pathway it adopts (one etymology per tongue) or stays an
  opaque root. The whole table is scaled by the MORPHOTYPE — isolating/
  agglutinative tongues compound abstract vocabulary heavily, fusional/
  templatic ones lean on opaque roots (Chinese 国王 'country-king' vs Latin
  rēx). That transparency co-variation reads the existing `morph` dial, so
  nothing new is rolled into the profile and nothing leaks into the pinned
  refs (Mandarin derives ~10/15 abstract concepts, Russian ~5 — the gradient,
  on the references themselves). Measured: iso 71% · agg 58% · fus 40% ·
  tmpl 32% of abstract concepts derived.
- **One derivation decision, no desync (language.js `derivPair`).** Both
  internalOf (dictionary) and isDerived (grammar/homophony repair) read ONE
  function that returns a concept's source pair — its structural `dv`
  (ford=river+water, roll unchanged) OR an adopted DERIV pathway OR null. So
  making KING/GOD/LAW derivable can't split the dictionary word from the
  paradigm's citation cell: gate holds citation ≡ wordOf at 0/3255 derived
  concepts. Colexification resolves first everywhere (a chief colexified to
  king wears king's word AND king's etymology, never a shadowed pathway).
  Worn-compound erosion now fires for any adopted abstract compound that grows
  long (throne, council are lexicalized institutional terms), while the `dv`
  path stays byte-identical.
- **Recoverable etymology (language.js `etymologyOf`).** New export:
  `{ parts:[cid,cid], glosses:[g,g] }` or null. The Lab's dictionary card
  shows the derivation (`king ‹ 'sit'+'high'`) and a per-tongue showcase row;
  the etymology stays legible even after the surface wears down, because it is
  read from the table, not parsed off the drifted word.
- **Gates (probe §13, 12 new → 102 total).** The dv+DERIV graph is a DAG and
  its sources are concrete/basic; derivation occurs at a human rate (48% of
  concept·lang pairs) and WHICH concept derives varies by family; the
  transparency gradient co-varies with morphotype; the reviewer's flagship
  seed 8817 makes king ← sit+high, held stable; derived surfaces drift down a
  family (631/894) while the etymology parts stay identical (894/894);
  derived concepts still cite as the dictionary word; pinned Mandarin
  compounds abstract vocab in legal pinyin and out-derives fusional Russian;
  determinism + JSON-roundtrip. 102 probe checks green; smoke + validate
  green. Public API unchanged (new export only); sim untouched.

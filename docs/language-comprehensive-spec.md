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

The reviewer's standing parked ask (session 10, above): now that accidental
homophony is gone, turn the *accidental* etymologies (Neteck's sit=king) into
*designed* depth — let abstract concepts DERIVE on purpose from concrete ones.
Built as a SYSTEM (cardinal rule 2), never a fitted output.

- **The curated relations table (`DERIV`, languageLexicon.js).** A table exactly
  like `COLEX`: rows `[target, head, mod, weight]` listing PLAUSIBLE derivation
  pathways for 16 abstract concepts — king ‹ "great man" / "old man" / "high
  sit", god ‹ "sky father" / "high sky", law ‹ "old say" / "true say" / "king
  say" (the reviewer's "say+bind"), victory ‹ "war's end" / "war stand", plus
  queen, throne, crown, tax, council, priest, oath, holy, spirit, army, guard,
  noble. Sources are always more basic than the target; the only cross-abstract
  references are to KING and GOD (which draw solely on concrete roots), so the
  graph is a shallow DAG.
- **Rolled per family, never hard-coded (language.js `derivParts`).** Each
  family rolls, per concept, whether to derive (`DERIV_RATE`, its own "deriv"
  stream) and — if so — which pathway (weighted, "derivpick" stream). Different
  tongues coin the same idea from different parts; ~28% keep an opaque root. The
  concrete `dv` field (FORD ‹ river+water) keeps its old "dv" roll UNCHANGED, so
  its names are byte-identical; the abstract layer rides new streams and perturbs
  nothing above it. Routed through the SAME joinInternal/revowel machinery, so
  the etymology is recoverable (you can see `king` inside `law` when law ‹ king+
  say) and it drifts with the sound-change log; templatic tongues derive by
  re-vowelling the head skeleton (maktab-style), as they already did for `dv`.
- **Cycle safety.** When a family has colexified a source ONTO its target
  (sky=god at 15%, wind=spirit at 20%), that pathway would loop; `derivParts`
  drops it and the family keeps a plain root — semantically exact (if wind IS
  spirit, "spirit" needs no derivation). Robust across 138 such families in the
  sweep, no hang.
- **Consistency + erosion.** The derived compound is legalized so `wordOf` is
  byte-identical to the grammar layer's `rootFormOf` (the session-11 one-root
  invariant, extended to derived concepts — citation ≡ dictionary, 0/4800).
  Transparent compounds wear to 1–3 syllable stumps even when rare and nested
  (throne ‹ king+sit): the erosion that was gated on frequency (b≥0.5) now
  always fires for the curated abstracts, so no four-heavy-syllable mouthfuls
  (>3 syllables: 2/3426).
- **New exports:** `etymologyOf(lang, cid)` → `{head, mod, gloss}` or null
  (covers both the abstract and concrete `dv` derivations). The Lab gains a
  "Coined abstractions" card and an etymology column in the dictionary.
- **Gates** (probe §13, +12 checks → 102 total): derivation rate in the human
  band and not all-or-nothing; every derived word non-empty and ≤3 syllables;
  citation ≡ dictionary for derived abstracts; etymologies well-formed;
  anti-fitting (king/god/law/victory each coined ≥2 ways, both derived AND
  opaque outcomes occur); pathway inherited down a lineage AND drifts across
  daughters; colex cycles broken not hung; pinned-Mandarin abstracts stay legal
  pinyin; determinism + JSON-roundtrip. smoke + validate green; names
  re-baseline (accepted, cosmetic).

Parked still: passive/causative voice, evidentiality (grammaticalize from see/
hear/say — already in the graph), numeral classifiers, noun-class concord, the
rarer alignments; L5 writing systems; orthographic lag.

---

## Build status (session 13) — derivation review rounds

Two fresh-reader review passes over session 12, each complaint converted to a
mechanism fix + gate (not a symptom patch). 106 probe checks green.

- **Loan precedence (round 1).** `etymologyOf` reported the NATIVE derivation
  even when the concept was borrowed (law loaned as 'toholu' still showed "‹
  true say") — the dictionary would print a loan beside a gloss that doesn't
  build it. It now prefers the loan exactly as `wordOf` does (returns null for
  loaned concepts). Gate: loaned abstracts report no native etymology.
- **Coinage-level dedup (round 2, the main fix).** The DERIV table shares
  source pairs on purpose ([MAN,OLD] → king/council/priest), and an independent
  per-concept roll let ~16% of families give two abstracts the SAME coinage —
  the surface repair then only masked it as B = A+syllable (oath ‹ law). Fixed
  at the source: `buildDerivMap` assigns every abstract its pathway ONCE per
  family, walking targets in a fixed order and taking the next free pathway when
  a pair is already claimed (famSeed-only ⇒ deterministic + inherited; cached on
  the compiled state). Result: 0/20000 families with a shared coinage (was
  16.1%). The rare residual surface homophone (king=tax, 1/20000) is cleared by
  letting the repair add one disambiguating syllable past the erosion cap for
  derived compounds — the 狮→狮子 lengthening the machine is modelled on.
- **Templatic honesty (round 2).** Root-and-pattern families re-vowelled only
  the HEAD skeleton and ignored the modifier, so the "mod head" gloss named a
  morpheme with ZERO exponents AND all of king's MAN-headed pathways produced
  one identical word. `revowel` now keys its vowel pattern AND its template
  (five patterns, varying the prefix m-/t-/n-/∅/vowel-initial and the melody) on
  the PATHWAY — the pattern IS the modifier's exponent, so different pathways
  give different words and the abstract set no longer rhymes on one m- prefix.
  Gates: no two abstracts share a coinage or a surface; templatic abstracts show
  ≥2 distinct initial patterns (202/202 langs).
- **Lab honesty (both rounds).** The "Coined abstractions" card now says
  "borrowed" (not "opaque root") for loaned abstracts; the dictionary
  distinguishes an intended colexification ("shared word") from an accidental
  "homophone" (new `colexPartner` export). queen ‹ "woman king" (regnant), not
  "king woman" (which read as consort).

Parked unchanged: passive/causative, evidentiality, numeral classifiers,
noun-class concord, rarer alignments; L5 writing systems; orthographic lag.

## Build status (session 15) — the synchronization review round

(The 9-phase typological completion — voice, evidentiality, classifiers,
concord, alignments, multi-clause — landed between sessions 13 and 15 and is
logged in `docs/language-typology-completion-spec.md`.) Two fresh adversarial
Lab reviews (the three pinned shapes + six random seeds) came back with the
verdict "the roll layer is healthy; the remaining work is all synchronization
— notes, labels, and inventories describing the language as ROLLED rather
than as it stands after history has happened to it." Every complaint became a
mechanism + a §23 probe gate (261 → **284** checks). Fittingly for a
diachronics engine: the documentation was more conservative than the speech.

- **Functional load in the closed classes.** 'what'=='why' where the dedupe
  walk's vowel dimension exhausted (three-vowel tongues with collapsing
  romanization) — the walk now grows a coda dimension past the vowels, first
  N steps byte-identical. Q-words were homophonous with core nouns in 40% of
  languages ('what'='man' garden-paths every relative, REL ‹ 'what') — the
  q-series re-dedupes against b≥0.8 content surfaces, collision-triggered
  only; I/eye-style pronoun homophones deliberately stay. Adpositions
  identical to their full polysyllabic source in 37% ('and'='with'='hand') —
  the grammaticalization tax: an identity-with-living-word form ≥2 syllables
  wears to its salient syllable (cognate, never homophone; the monosyllabic
  Mandarin-跟 identity stays).
- **A real object-agreement series.** agree='both' reused the SUBJECT affix
  for the object index; 3SG+3SG.O stacked one syllable twice, renderWord's
  haplology ate it, and the gloss claimed an exponent that never surfaced
  (79% of polypersonal languages). Now: own series ‹ independent object-
  pronoun roots (opron streams), OUTER like Semitic object clitics (outside
  the fusional crush), audibility-guarded, own dedupe pass against the
  subject set; zero 3sg.O is common and never glossed; a per-cell
  counterfactual keeps the gloss honest against surface haplology; pronoun
  objects index by THEIR person.
- **Fossil notes describe the surviving paradigm.** `affixEtymologies` now
  generates every note FROM diagnostic cells on regular stems (mode `affix`
  with the exact surface string, `fused` with a real alternation, `redup`,
  `pattern` for templatic primary TAM) — never the birth-time shape whose
  tone matched no living cell.
- **Synchronic phonology.** New export `synchronicPhonology(lang)` scans the
  evolved dictionary + closed classes; the Lab charts the union of the
  roll and what sound change minted (the q-less-chart-with-q-words bug), and
  the syllable-structure chip derives from OBSERVED onset/coda maxima (a
  drifted 'strict CV' roll now honestly reads CV(C)).
- **The minimal-name floor** (McCarthy & Prince): proper names that erode
  below two rendered letters augment a syllable (a language named 'Ā', a
  woman named 'Ǐ'); single-vowel dictionary WORDS stay.
- **Shapes are families, not costumes.** `applyReference` folds the shape
  into famSeed, so the same seed in four shapes no longer shares every
  derivation pathway/colexification/adposition etymology; pinned phonology
  rides `lang.pin` and holds (gated legal pinyin).
- **Lab truth pass.** Frontier example frames carry the articles their
  labels claim; a split-ergativity header is demonstrated on BOTH sides of
  its split; the case chip derives from the declension table ("genitive only
  — no core case" for the English shape); cell-identical paradigm rows are
  annotated as syncretism; the ten-place sample skips exact duplicates.
- **Verified, no change needed:** the ergativity roll is live (24% erg, 3%
  active, 2.5% tripartite over 400 seeds — the review's 0/5 was luck);
  'God' as a man's name and compound tone sandhi are kept as features.

Parked from these reviews: a real-English-lexeme filter for the English-
orthography romanizer (the "cursed English" king='sleep' finding — a display
politeness that would re-baseline every pinned-English surface; revisit
beside orthographic lag); grammar-word/content homophony beyond the
interrogative series; L5 writing systems + orthographic lag, unchanged.

## Build status (session 15, second phase) — the vocalizer

The user opted into the parked "vocalizer" thread (IPA + a voice), eyes
open about formant synthesis being a sketch. Shipped Lab-side; the sim
stays silent; probe 284 → **292** checks (§24).

- **`src/sim/languagePhonetics.js`** (new, pure): `ipaC`/`ipaV` render the
  stored feature bundles to IPA — total, and injective over every
  inventory the generator or its sound laws can mint (the intervocalic
  voicing law's "voiced glottal stop" wears an honest ʔ̬). `phoneticPlan`
  emits per-syllable segments + stress + the tone-melody index, and
  `ipaOf` prints [ˈsaŋ.gʷa] / [ɕi˨˩˦.san˥]-style transcriptions.
- **DISPLAY PARITY is the load-bearing property:** the plan rebuilds the
  exact pre-tone romanized syllable renderWord hashes for its mark
  (`hash32(rsyl, i, tseed) % 4`), so the contour you hear and the tone
  letters ipaOf prints can never disagree with the ā/á/ǎ/à the page shows
  (gated on marked monosyllables). Stress is the profile dial the
  spelling never writes — audible here, exactly as in life.
- **`langWordForm`** (language.js): the internal form langWord renders,
  exported so speech and spelling come from one build; langWord routes
  through it (parity gated).
- **The Lab's "Sound" card**: every phoneme as a romanized/IPA pair,
  clickable to hear; sample words + the endonym with transcriptions and
  ▶; every native dictionary entry and every cognate-table cell is
  click-to-speak (loans and compound counting forms stay silent — no
  internal form, no guessing). The synthesizer is ~150 lines of
  dependency-free Web Audio: formant filters over a sawtooth for
  sonorants (diphthongs glide, nasals carry a murmur branch), place-keyed
  noise bursts/frication for obstruents (aspiration, ejective beats,
  prenasal murmurs, trill flutter, ʲ/ʷ on-glides), tone contours from the
  plan's own melody indices, declination + stress otherwise. A sketch of
  the sound, not a native speaker — sold as exactly that in the card copy.
- **Parked:** sentence audio (renderClause hands back strings, not forms —
  the vocalizer refuses to guess; a future additive `forms` field on
  clause tokens would unlock it), and any use of audio by the sim.

## Build status (session 15, third phase) — the script generator (L5, Lab-side)

The user opted into the writing-system thread next. §E/§F's design ships
Lab-side in `src/sim/languageScript.js` (pure, derived, cached; the sim
stays unwired — script birth from literacy tech and spread along faith/
trade channels remain the sim-side plan). Probe 292 → **305** checks (§25).

- **Type walks the real transmission ladder.** A tradition consolidates
  after a little accumulated history (rule-log index, famSeed streams
  `scr:*`) and is born LOGOGRAPHIC, like every attested primary invention.
  At re-learning junctures it may simplify one attested step (logo →
  syllabary/abjad → alphabet/abugida) — and only when the simpler type
  FITS this language's own structure better: fit constants are
  learnability/typology priors (a comfortable syllabary is ~60 signs,
  ~220 the practical ceiling; logography's base is low and earns its keep
  only on isolable, short, homophone-heavy-under-tone morphemes; a
  templatic morphology writes consonant skeletons; clusters force
  segments). Measured over 300 drifted languages: templatic → abjad 100%,
  isolating+tonal → logography 100% (the Chinese corner, never named in
  code), atonal agg/fus → segmental 87/79%, syllabaries rare and only
  where the licensed syllable space allows. Fresh roots are preliterate
  until history accumulates — drift a Lab language and watch its script
  be born.
- **Orthographic lag.** Spelling freezes where the tradition consolidated
  (`frozenAt`); the written form is the dictionary machinery replayed
  over `rules[0..frozenAt)` via a memoized ghost record. Old stable
  traditions accumulate deep lag; a re-learning IS the spelling reform
  that resets it. Fossil spellings are emergent: drift the pinned English
  shape and ⟨nithelrule⟩ is now said `niilrule` — a silent th nobody
  authored. Exports: `writtenFormOf`, `writtenWordOf`,
  `silentLetterSample`.
- **Glyphs from a seeded stroke grammar.** Per-script style (curviness,
  slant, chaining, aspect, stroke budget — logographs dense, letters
  light), deterministic per (styleSeed, key), pairwise-distinct by a
  points-signature walk (bow amount alone never carries distinctness).
  A derived word's logograph COMPOUNDS its parts' glyphs — the engine's
  own etymologies surface as semantic radicals. Abugidas mark non-inherent
  vowels with one-stroke diacritics (inherent = the frequency-ordered
  first vowel); direction (ltr/rtl/ttb) is a family roll. Engine emits
  stroke DATA; the Lab draws SVG.
- **References pinned** as scenario data (`prof.script`): Mandarin-shape
  logographic, Russian/English-shape alphabetic — and because a pinned
  tradition is as old as the record, drifting a pinned shape grows real
  lag.
- **The Lab's "Writing" card**: type/direction/lag chips with the
  mechanism story, the sign table, six words written in-script beside
  their frozen spelling ⟨…⟩, today's pronunciation, and IPA, plus the
  fossil-spelling line. Preliterate languages say so and invite a drift.
- **Parked:** sim coupling (scripts as cultural artifacts that spread and
  gate knowledge diffusion — the §F plan); glyph aesthetics beyond v1
  (visual look-alike avoidance is signature-level only); writing
  loanwords (a loan has no native tradition and stays unwritten in v1).

## Build status (session 15, fourth phase) — the script generator, deepened

"Make it deeper: real-life accuracy, more advanced, different shapes."
Probe 305 → **313** checks (§25 extended).

- **THE HAND — glyph shape follows the writing medium, as in life.** A
  family's material-culture roll (re-rolled at adoption, so a re-learned
  script can change its whole look): CARVED cuts no stroke along the
  grain (the runic futhark rule — every stroke carries a vertical
  component, gated); CLAY presses only wedges — filled heads with drag
  tails snapped to the four cuneiform directions (gated); the BRUSH
  builds boxy, axis-dominant, stroke-ordered signs; the reed PEN chains
  and loops, and its words may JOIN along a cursive baseline; the ROUND
  hand arcs every stroke because a straight cut splits the palm leaf
  (the Burmese/Odia rule — zero straight strokes, gated). Letters live
  in a body band with rolled ascenders/descenders (the x-height rhythm);
  logographs compose in radical SLOTS (left-right, top-bottom,
  enclosure). Distinctness is enforced on coarse kind+points bins — a
  wedge 3% away is the same wedge, so the walk must genuinely move.
- **Real orthography per type.** Abjads grow matres lectionis (long
  vowels + initial carrier written with glide letters, ~70%); abugidas
  may kill the inherent vowel with a virama mark (~70%) and can wear the
  Devanagari headline bar; syllabaries treat codas the three attested
  ways — moraic nasal sign (kana, when the language is CV(N)),
  echo-vowel (Linear B ko-no-so), or simply unwritten; segmental scripts
  of tonal languages usually leave tone UNwritten (transliteration drops
  the marks — gated no-leak) with a Vietnamese-style diacritic minority;
  word separation rolls space / scriptio continua / interpunct;
  direction is weighted by type (abjads mostly rtl with their lineage,
  logographies/syllabaries take columns at real rates).
- **Phono-semantic compounds** — the 形声 machine: a morpheme whose
  frozen surface is homophonous with an earlier one writes as its DOMAIN
  RADICAL beside the glyph of the word it sounds like, so homophones
  sound alike and write differently (gated).
- **Numerals**: the low digits are tally marks in the script's own
  medium — one, two, three repeated units (wedges in clay, arcs in the
  round hand) — higher digits their own signs (gated 1×/2×/3×).
- **Spelling reforms**: a tradition drifted ≥5 changes into lag may
  reform WITHOUT changing type at a state-gated juncture (the Turkish
  move; ~45% take it, the rest fossilize toward -ough). Reform incidence
  gated.
- Lab Writing card grew hand/orthography chips with the mechanism story,
  a numerals row, and "a written line" — three words under the script's
  own separation habit, headline-joined or cursive-joined where the hand
  says so.
- **LETTER ANATOMY** (review round: "looks bare for the alphabets").
  Random strokes read as tick marks, not letters. Segmental signs are now
  built as real letters are: a SPINE (straight, diagonal, or arched stem)
  plus 1–2 ATTACHMENTS at its joints — bowls, arms, crossbars, legs, a
  second stem with connector (b d h k H N þ И) — with each hand supplying
  the vocabulary: carved bowls are ANGULAR (þ, the grain rule reaching
  into letter shape), clay builds every element from wedges, the round
  hand arcs even its stems, the pen bows and loops. Bowls and arms open
  away from the nearest edge (the base-joint squash a gate caught). The
  tally numerals fall out cleaner still: the unit is now literally a stem
  stroke — I, II, III. Logographs and syllabaries keep the square grid
  compositor that already read well.

## Build status (session 15, fifth phase) — the full clause

The two "strings, not forms" parked notes are closed: renderClause tokens
now carry `f` (the internal form) and `c` (the concept id where known) —
additive fields, every prior surface byte-identical — so a whole sentence
can be SPOKEN and WRITTEN. Probe 313 → **320** checks (§26).

- **Token forms everywhere.** inflectNoun/inflectVerb/inflectAdj expose
  the internal form they render (isolating particles carry their own
  syllable forms); the string-assembled cells — reduplication,
  class-concord prefixes, voice/inverse markers, enclitic coordinator
  welds — build a MIRRORED form by honest syllable append and are flagged
  `seam`: their speech says the uncollapsed truth the collapsed spelling
  hides (the same haplology honesty as the dictionary). Non-seam tokens
  are gated byte-parity: render(form) === token text, modulo the
  neutral-tone particle dress.
- **Spoken sentences with real prosody.** The Lab's `speakClause`
  schedules the word plans as ONE intonation phrase: pitch declines
  across the clause and the final word carries the boundary tone —
  statements and commands FALL, questions RISE (the near-universal pair;
  the question checkbox audibly flips it). Every interlinear token in
  every card is click-to-speak.
- **Written sentences.** New export `writeForm(lang, form, cid?)` (the
  writeWord machinery, refactored through it): the Sentences card writes
  the whole clause in the language's own script under its own separation
  habit and direction. A logography writes cid-less grammar words with
  DISTINCT dedicated signs keyed on the form — the 的/了 pattern (gated).
  Tone diacritics, where written, now use the SAME melody index the
  vocalizer speaks and the romanization marks. The running line is
  spelled by ear; the frozen fossil spellings live in the Writing card.
- **Parked:** frozen-stem spelling for inflected clause tokens (real
  traditions freeze the stem and spell inflection by ear — ours spells
  the whole running line by ear, noted in the card copy); loanword
  writing; sim/chronicle wiring, unchanged.

## Build status (session 15, sixth phase) — the missing script classes

Coverage round ("no Arabic, no Hindi styles"): the two big visual
identities missing were the JOINED-POINTED look and the HANGING look, and
the sixth structural class (featural) had no path into existence. All
three now emerge; probe 320 → **327** checks (§25 e2).

- **Fit reads the ATTESTED CORPUS, not the static profile.** fitsOf now
  measures the frozen lexicon as it stood at each juncture (distinct
  syllable count, attested word length, attested cluster rate) — sound
  change bakes splits and clusters into words, so the corpus a late
  juncture faces differs from the founders'. This kills two latent
  anachronisms at once: juncture verdicts no longer read today's
  phonology retroactively (history can't rewrite itself), and the fit
  landscape finally MOVES, which is the entire engine of late reform.
- **The featural class is INVENTED, never assigned.** Post-consolidation
  junctures recur every 2 rules of accumulated depth; at each, a court
  holding a script whose fit the corpus has left behind (fit < 0.75 and a
  far better one exists — the Sejong condition) rolls invention at
  0.4/era. The result is rare like the record (~1–2% at deep drift, none
  young). Letters draw the sounds' own features: place = base shape
  (articulator iconography), manner modifies, a laryngeal series ADDS a
  stroke (ㄱ→ㅋ); fkey merges exactly what featC draws identically
  (voicing pairs, the liquids, dental/alveolar, uvular/velar — so one
  letter covers k/g as Hangul's ㄱ does, injective by construction).
  Syllables compose into BLOCKS (onset beside/above the vowel bar by its
  orientation, coda beneath, silent-ㅇ null onset). Invented scripts are
  ruler-drawn: the hand's material vocabulary does not restyle them, they
  never join, never inherit a headline.
- **The ONE shared glyph map.** glyphMapOf builds a single deduped sign
  table per script state; BOTH the inventory display and writeForm read
  it, so a walked or pointed sign looks the same in a word as in the
  table — the latent desync closed by construction (gated: word sigs ⊆
  table sigs, 0 strays / 3556). Collision resolution is the script's own:
  a joined pen hand keeps the worn skeleton and POINTS it apart — dots
  above/below, the i'jam solution that split ب ت ث (gated: ≥3 traditions
  attest shared-skeleton pointed pairs) — every other hand moves strokes
  (the salt walk). Abugida vowel marks now draw from the free stroke
  grammar (a sliced spine was too stereotyped to keep a dozen marks
  apart — the very desync source, since words already drew them free).
- **Orthography writes PHONEMES.** Surface segments that sound change
  carried out of the inventory are written with their nearest letter
  (English never added a flap letter); a syllabary facing an unlicensed
  cluster breaks it into CV signs with echo vowels (su-to-ra-i-ku); a
  diphthong's off-glide takes the bare vowel sign (かい). Only the
  featural type writes sounds directly — Hangul's fidelity, for free.
- **Headline scripts HANG their letters** (no ascenders above the bar,
  descenders allowed — the Devanagari band, gated); **joined hands end
  the word in a final swash** (a tapering tail stroke, the Arabic
  final-form logic, one per word).
- **Parked:** script BORROWING along contact/prestige lines (the actual
  Sejong precondition — Korea wrote CHINESE; needs sim-side neighbors);
  hand-styled featural letters (real Hangul took brush styling);
  boustrophedon; loanword writing; sim/chronicle wiring, unchanged.

## Build status (session 15, seventh phase) — ductus, gestalt, born literate

Three visual-quality/product rounds on the script layer:

- **DUCTUS.** Stroke conventions (bow chirality, arm-slope habit) are
  rolled once per script from styleSeed, never per letter — one hand
  writes the whole script, so E F H K read as siblings. Attachments
  anchor ON the spine (diagonal spines carry them along their own line;
  bowed spines take end attachments only), bowls overlap the stem as
  b d p do, and the pen slants forward and mildly. Pen and palm-leaf
  hands favor bowls and curved arms (the minim-and-bowl economy); the
  carved hand keeps its angular futhark look — there, "runic" is the
  grain rule working.
- **GESTALT DISTINCTNESS.** The fine signature (twelfth-of-box) kept
  signs distinct to the renderer while leaving near-twins for the eye.
  Segmental letters now dedup at the READER's grain too (thirds-of-box
  gestalt); near-twins get walked apart or POINTED apart on the joined
  pen (more i'jam — the same pressure that split ب ت ث). Dense scripts
  skip the coarse test, as hanzi readers legitimately read fine detail.
  Gated: 0 near-twins across the sweep.
- **BORN LITERATE.** The record IS the tradition: every language record
  belongs to a record-keeping people, so writing begins with the record
  itself — born = 0, always logographic (the accounting-token origin),
  zero lag on a zero-history record. Everything downstream still keys on
  accumulated history; records founded WITH initial history are already
  older traditions. No Lab reroll ever says "too young" again. Truly
  preliterate tongues return with sim-side literacy wiring (parked).

Probe 327 → **329** checks (gestalt gate + born-literate gate replacing
the preliterate one; the featural laryngeal gate is now non-vacuous).

## Build status (session 15, eighth phase) — evolve · spread · diverge · total

The "complete on its own terms" round (user: "evolve, spread, diverge,
and work for all word translations — everything except sim wiring").
Probe 329 → **342** checks (§27 totality + spread/frozen-stem/name/
boustrophedon gates).

- **LOANS SPEAK AND WRITE.** borrowFrom now records the donor's spoken
  FORM beside the surface (additive `f`; chained through the donor's own
  loans, the way 'coffee' crossed the planet one contact at a time).
  writeWord: a logography keeps the concept's sign and only the READING
  changes (the kun/on move); phonographic scripts spell the loan as
  heard at borrowing, foreign segments adapted to the native signary.
  Lab: loans are click-to-speak and shown in glyphs everywhere.
- **§27 TOTALITY GATE.** Under heavy chained contact, every concept in
  every tongue must gloss, word, speak (plan + IPA) and write — 2544
  cells, zero gaps; loan records with forms survive the persistence path.
- **SCRIPT SPREAD** (`adoptScriptFrom`, additive `lang.scr`): a borrower
  takes the donor's whole look — type, hand, direction, styleSeed
  (letterforms literally shared, gated: ≥5 identical signs) — and spells
  ITSELF by ear from adoption; orthographic machinery (matres, virama,
  tone marking) re-derives for the borrower's own phonology; daughters
  inherit the tradition. A borrowed script pays a PRESTIGE TAX to ladder-
  step (0.9 vs 0.15 — abandoning the civilized neighbour's letters costs
  legitimacy), which makes the borrowed-misfit the true Sejong
  precondition: of hostile pairings (agglutinative tongue under a
  borrowed logography), some invent featural, some are held by prestige
  — both gated.
- **FROZEN-STEM SPELLING.** writeForm with a known concept writes the
  STEM with its frozen dictionary spelling and only the inflection by
  ear — ⟨knight⟩+⟨-s⟩; a stem reshaped by fusion/ablaut/reduplication
  falls back to by-ear whole, as real irregulars get respelled. Gated:
  lagged clause tokens open with the dictionary's own frozen-stem glyphs.
- **NAMES IN SCRIPT** (`writeName`/`formFromSurface`): names are string-
  assembled and carry no single form — but a scribe never needed one:
  formFromSurface inverts the language's own romanization (longest-match
  parse over the inventory's letter spellings, greedy C*V(C*)
  syllabification) and writeName spells the result. Near-lossless by
  construction (the name WAS generated by those conventions). Lab shows
  places, people, and realms in their own hand.
- **CLAUSE-TREE AUDIO.** speakClause takes intonation-phrase GROUPS: a
  CONJ token opens a new phrase, each non-final phrase ends on a
  continuation rise with a comma pause, only the final phrase carries
  the boundary tone. Every example sentence in every card now has ▶.
- **BOUSTROPHEDON.** A rare archaic convention (10%) of never-re-learned,
  never-borrowed, non-pen primaries — standardization kills it, exactly
  as on Earth (archaic Greek/Etruscan had it, descendants don't). The
  Lab's written-line demo turns the line and MIRRORS the letters on the
  return.
- **Parked (sim wiring only):** cultures owning languages, map names,
  literacy-tech script birth, adoption along real trade/faith routes,
  chronicle entries in the realm's own script.

## Build status (session 15, ninth phase) — the areal simulation

`src/sim/languageHistory.js` + the Lab's History card: a linguistic
history in miniature, the dress rehearsal for sim wiring. Probe 342 →
**349** checks (§28).

- A cast of root tongues spawns (pinned reference shapes beside random
  typological rolls), then the four verbs run: communities past a
  cohesion ceiling SPLIT (branchLanguage), sound change accumulates
  steadily (driftLanguage), prestige pushes words and whole scripts
  downhill from bigger neighbours (borrowFrom / adoptScriptFrom), and a
  tongue starved below viability DIES into its neighbour. Population is
  zero-sum with a Matthew effect (bigger communities absorb speakers
  faster) — which is what actually produces hegemons and dying tongues.
- **THE INTEGRATION SEAM** is documented in the module head: the
  population/position model is a stand-in; when the sim wires in,
  culture populations replace `pop`, trade/faith adjacency replaces
  `pos`, and the sim's own events call the same four verbs — thresholds
  keep their meaning (cohesion, prestige, viability), only the state
  feeding them becomes real.
- Every event fires from population STATE, never the era number (the era
  loop is only the clock that advances state) — cardinal-rule clean.
- Lab: era-timeline SVG (lineage lanes colored by family hue, branch
  connectors, borrow dots, adoption squares, death marks), a chronicle
  feed, and a living-tongues table (share, script incl. borrowed/
  invented, changes, loans) whose **inspect** button opens any survivor
  — with its ancestor chain as the Lab's family, so the cognates card
  lights up.
- §28 gates: deterministic event logs; all verbs fire; adoption leaves
  the borrowed (or later invented) tradition on the record; pinned
  reference lineages hold their costumes through deep history; every
  survivor still translates/speaks/writes; daughters stay in the family;
  history-grown records JSON-roundtrip byte-stable.

## Build status (session 15, tenth phase) — the adversarial review round

Three independent adversarial reviews (hostile linguist / cache+
determinism auditor / edge-case crasher) over the script and history
layers; every reproduced finding fixed at the mechanism and gated.
Probe 349 → **359** checks.

- **CRASH: borrowed featural** — LADDER had no featural entry, so a
  featural script that SPREAD (donor invented, borrower adopted) threw at
  the borrower's next juncture, permanently poisoning the record and
  killing ~3% of deep history runs. featural is now a ladder terminal.
- **STALENESS: re-adoption invisible** — the scriptOf cache key omitted
  scr identity, so a second adoptScriptFrom at the same depth returned
  the first donor's script until an unrelated mutation; save/load then
  disagreed with the session. Key now carries scr.at/styleSeed/type.
- **READS MUTATED HISTORY** — gramOf lazily wrote the rolled grammar
  into the persisted prof, so whether anyone LOOKED at a grammar card
  before a branch changed the daughter's word order (~12% of seeds).
  Grammar now settles at BIRTH (bequeathGrammar in branch/found);
  reads are side-effect-free, gated.
- **Display lies fixed at the mechanism:** toneWritten abugidas dropped
  every tone mark (the slot was taken by the vowel diacritic) — tone now
  STACKS above it, the Thai way (mark2, gated ≥95% of tonal syllables);
  the "N signs" chip disagreed with the signary (phantom virama entry on
  viramaless abugidas, missing carrier, corpus-vs-grid syllabary
  mismatch) — glyphBudget now mirrors the map enumeration exactly,
  gated chip===table; matres lectionis rolled for abjads with no long
  vowels to write — now gated on prof.longV; stripTone deleted umlauts
  along with tone marks (only the four TONE_MARKS strip now); writeName
  lost 20% of names' consonants (mark-stripping asymmetry + letters
  outside the inventory's conventions) — tokens strip identically and
  stray letters are SOUNDED OUT via a Latin-reading fallback then seated
  by nearest-letter, loss now ≤4%, gated ≤8%.
- **Featural block overflow** (3+ onset/coda consonants walked off the
  glyph box) — rows now divide by element count, gated in-box.
- **Performance:** corpus/ghost caches were keyed on gen, so every drift
  rebuilt every historical corpus (quadratic scriptOf; 10s histories) —
  corpora are functions of (cut, xph) only; 60-drift loop 3.3s → 0.17s.
- **History dynamics:** a lone root was pinned to par forever by the
  zero-sum renormalization (can now free-run and split, gated); zero
  total pop NaN-poisoned the pool (guarded).
- **Boundary guards:** out-of-range cid, numeralGlyphs(0), malformed
  forms → null instead of throwing, gated.

## Build status (session 16) — typology completion I: syntax

The typology-completion effort (five phases: syntax → lexical typology →
polysynthesis → phonological rarities → diglossia). Phase 1 closes the
clause-level gaps: the constructions a chronicle can't do without —
being, having, existing — plus the strategies the relative/voice systems
still lacked. Probe 359 → **410** checks (§29). Everything is opt-in
frame fields riding the existing machinery; a bare verbal frame renders
byte-identically (gated first).

- **Nonverbal predication** (`frame.pred`, WALS 120A / Stassen 1997).
  Nominal predicates take a VERBAL copula (the language's own BE —
  inflecting, agreeing, and suppleting like the basic verb it is, so
  was/were-style irregular copulas fall out free), a PRONOUN copula (the
  3sg pronoun re-used — the Hebrew hu / Mandarin 是 road; kept identical
  by construction, like 2v), or ZERO — and zero is TENSED: under overt
  past/future the BE verb steps in (Russian byl), hard-wired as the
  near-universal it is. Adjectives split Stassen's way: 'verby' tongues
  (isolating/tenseless-leaning, rolled ~37%) predicate the property word
  AS a verb (他老了 = old-PFV), 'nouny' ones route it through the copula
  — where predicative adjectives AGREE with the subject's class (the
  parked predicative-agreement item, now real: star/stara). A spatial
  locative predicate may take a POSTURE verb (SIT/STAND, one family
  roll shared with the posture existential — the estar ‹ stare road).
- **Existentials** (`frame.ex`): the pivot rides BE, the transpossessive
  HAVE (subjectless transitive — the pivot is the OBJECT, 有/hay), or
  the posture verb. A located existential FRONTS its place (locative
  inversion, presentational). The negative existential is a single
  FUSED word in ~42% (NEG welded to the existential verb's salient
  syllable — méiyǒu/нет, Croft's cycle), used in the unmarked present;
  tensed negatives fall back to plain negation (нет vs не было, exact).
- **Predicative possession** (`frame.poss`, WALS 117A / Stassen 2009):
  five real strategies at the attested marginals — locational ('at the
  king is a horse', possessor an oblique on the existential, pronoun in
  its oblique case: у меня есть), transitive HAVE (fusional-leaning;
  the possessed takes ACC — a real transitive), topic ('the king — a
  horse exists', isolating-leaning), genitive ('the king's horse
  exists'), comitative ('the king is with a horse', a copular remap).
  Each is a thin REMAP onto the existential/copular/verbal paths — no
  possession-specific syntax exists to fit. The have-existential tie is
  rolled (a have-possessing tongue's existential is usually the same
  verb — one 有 for both, gated on the pinned Mandarin).
- **Serial verbs** (`frame.v2`): one clause, two verbs, no linker,
  shared subject; TAM once on V₁ or concordantly on both (svcTam). VO
  interleaves S V O V₂ O₂ (take-knife-cut-meat), verb-final stacks the
  cluster S O O₂ V V₂, V-initial clusters initially. Analytic-skewed
  (iso ~49%, fus ~4%), suppressed under converb chaining (competing
  strategies). A non-serializing language degrades the frame to a
  coordination with a pronominalized second subject.
- **Correlatives** — the missing fourth relative strategy (Hindi jo…vo):
  carved on its own stream from postnominal verb-final languages (~8%
  overall); the relative clause is LEFT-DETACHED with the head overt
  inside it, opened by REL, and a distal demonstrative resumes the head
  in the matrix (head appears twice — gated). Rides `relStrat`, so it
  LAGS a word-order flip like the rest.
- **The relative pronoun now INFLECTS** for the head's role inside the
  relative (который-ACC when the head is the inner object) — what makes
  relpron a strategy rather than a costume on the gap; needs a real
  core case, so caseN=1 English stays invariant (gated).
- **Voice completion**: REFLEXIVE as a verbal detransitivizing affix
  (-sja; worn from BODY/HEAD at the voice tier, claimed after every
  existing category) or a reflexive PRONOUN ('self' ‹ body/head; always
  the strategy in isolating tongues); the RECIPROCAL shares the
  reflexive exponent where recpSame rolled (the Romance se
  colexification) or wears its own ('one-one'). The APPLICATIVE of a
  transitive now keeps its theme as a bare second object (the Bantu
  double object — it used to vanish).
- **Possessed NPs everywhere**: `arg.poss` on any argument — pronominal
  possessors ride the head-marking affix where the language affixes,
  else the genitive series (its own case, no linker) or the 'of'
  construction (mirroring inflectPossessed exactly); definiteness rides
  the possessor. Feeds the genitive possession strategy for free.
- Ten new dials (copN/copA/copLoc · existV/negEx · possPred ·
  svc/svcTam · refl/recpSame), all own-stream, pinned in all three
  references in the same commit; new exports `predicationOf` (+
  additive refl fields on `voicesOf`); Lab: a "Being, having, existing"
  frontier section, reflexive/reciprocal in Voice, and a sentence-
  builder TYPE control (event / description / existential / possession).
- Parked: predicate-nominal case (Russian instrumental); expletive
  subjects ('there/il'); SVC beyond two verbs; reflexive possessives.

## Build status (session 16, second phase) — typology completion II: the lexicon

The lexicon becomes typological: not just WHICH words exist but how the
semantic space is CARVED — colors, kin, and motion, the three domains
where cross-linguistic carving is best charted. Probe 410 → **440**
checks (§30). Everything is colexification/derivation of APPENDED
concepts onto older ones (new→old only), so no pre-existing surface
moves and no name pool grows — the append-only integrity gates lead.

- **Berlin–Kay color terms.** Five appended meanings (yellow, brown,
  purple, pink, orange) above the pre-existing six-term floor. The split
  rolls are IMPLICATIONAL by construction: brown only after yellow, the
  stage-VII terms only after brown, and never past a GRUE anchor — the
  long-standing green=blue colex row, read here as the stage it always
  was. An unsplit term colexifies onto its hierarchy parent and resolves
  through the chain (orange = yellow = red), so "how many basic color
  terms" is a per-family fact (5–11, modal 6–7) with the order built in.
- **Kinship systems.** Eight appended genealogical positions (sister,
  the four uncle/aunt slots, cousin, grandparents) and ONE roll: which
  of Morgan's classic types the family speaks — generational (uncle =
  father), bifurcate-merging (father's brother = father, mother's
  brother his OWN word — the Iroquois signature), lineal (one 'uncle'),
  bifurcate-collateral (every position named), at ~Murdock rates. The
  type IS a colex merge-list; whether MB = FB is typology, not
  translation. Grandparents mostly derive ('great father' — the
  grand-père machine, through the ordinary dv pathway).
- **Motion typology (Talmy).** Four appended path verbs (enter, exit,
  ascend, descend) and the three real types: SATELLITE-framed keeps the
  manner verb and hangs path on the adposition ('ran in the town') —
  and its path verbs are GO-COMPOUNDS quarried from the family's OWN
  adposition source ('house-go' where 'in' ‹ house — cognate with the
  satellite it echoes); VERB-framed puts path in the verb and
  BACKGROUNDS manner (the run is gone — Talmy's trade, gated);
  EQUIPOLLENT serializes both ('ran entered'), and every equipollent
  language is a serializing one — phase 1's SVC machinery is the
  renderer. One stream + rate shared by the lexical and clause layers;
  frame field `frame.path`.
- **New colexification domains:** mind-as-heart (with a head minority),
  tongue=language (the classic), bark ‹ 'tree-skin' / bark=skin — all
  new-concept takers on appended COLEX rows.
- References pin the lot as scenario data (`prof.lex`): Mandarin
  equipollent + every-uncle-distinct + 11 colors; Russian/English
  satellite + lineal (дядя) + 11 colors.
- 22 appended concepts (position-stable, none in any name pool); new
  exports `colorTermsOf`, `kinshipOf`, `motionTypologyOf` (+
  `adpSourceOf` now public for the satellite compound); Lab: "The
  lexicon's shape" card — swatches with their merges, the kin table,
  the motion example with its go-compound etymology.
- Parked: Omaha/Crow generational skewing (needs gendered ego); elder/
  younger sibling ranking; mensural color modifiers ('light/dark X').

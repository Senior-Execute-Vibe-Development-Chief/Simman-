# Spec — Comprehensive language system: span the world's languages

Status: **designed, not started.** Companion to the current generator in
`src/sim/language.js` (phonotactic flavor profiles + drift/branch/borrow).

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

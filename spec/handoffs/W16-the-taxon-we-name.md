# W16 — the taxon we name

**Branch** `claude/world-sim-rebuild-decision-1umpax`. Follows W15
(`spec/handoffs/W15-wind-and-husbandry.md`). This wave touches no simulation
code: it changes WHICH PLANTS the crop packages are built from, in
`v2/tools/build-croprelatives.mts` and the file it bakes,
`v2/data/reality/crop-occurrences.json`.

## 1. The question that started it

"Is the Yangtze inside rice's derived wild range, and if not, is *Oryza
rufipogon* — the perennial wild rice the Yangtze's japonica was domesticated
from — missing from the package?" Then: "what other important wild ancestors
are missing?"

The answer to the first question is **no, rufipogon is not missing — it is
what has been read all along, under another name**, and looking for it
turned up a worse fault two packages over.

## 2. A name is not a taxon

GBIF's occurrence search resolves a `scientificName` query to the **accepted
usage** of that name and answers with the accepted taxon's records. Four of
the thirteen taxa this repo names are synonyms in GBIF's backbone, so four of
the thirteen reads were not reading the plant they named:

| named in the table | GBIF status | answered with | by name | the named usage alone |
|---|---|---|---|---|
| *Triticum dicoccoides* | accepted | itself | 792 | — |
| *Triticum boeoticum* | synonym | *T. monococcum* subsp. *aegilopoides* | 2,963 | 216 |
| *Oryza nivara* | synonym | ***Oryza rufipogon*** | 7,094 | 3,839 |
| *Cucurbita pepo* subsp. *ozarkana* | synonym | *C. melopepo* var. *ozarkana* | 152 | 76 |
| ***Manihot esculenta* subsp. *flabellifolia*** | synonym | ***Manihot esculenta*** — **cassava** | **23,587** | **1,448** |

Three of the four are benign or better: wild einkorn and the Ozark gourd are
still the same wild plants under their current names, and wild rice's read is
the whole *O. rufipogon* complex — the right datum for a package whose crop
was domesticated twice from it (japonica from the perennial form of the
Yangtze, indica from the annual form of the Ganges plain; Fuller 2011), but
carried under a label claiming the narrower annual taxon.

The fourth is a fault. **`Manihot esculenta` is cassava.** Every bake from W9
to W15 fitted the tubers package's wild range to 23,587 records of the modern
cassava planting map — which is exactly the circularity the W12 native-range
screen was built to remove, arriving through a door that screen does not
watch. It is why the tubers package had the largest wild stand on Earth.

### The rule

The read is now pinned to a GBIF **usage key**, and a synonym is followed
only where following does not move UP the rank ladder — the same rule the
WCVP screen already applied to distributions, for the same reason: *an
infraspecific name exists to separate the wild form from the crop, and
resolving it to the species throws that distinction away.* By that rule
einkorn and the gourd follow their synonyms and stay whole (2,963 and 152),
wild rice follows to the complex, and wild manioc does not follow into
cassava. Each taxon's resolution is now recorded in the baked file
(`usageKey`, `read`, `matchedStatus`), so a silent substitution is visible in
the data rather than only in the counts.

## 3. Wild barley rejoins the founder set

The wheat package is called "Wheat & Barley" and had no barley in it.
*Hordeum spontaneum* was excluded with a measurement — its range, spanning
Morocco to Tibet, "put wheat's envelope in north China" — and that
measurement was taken when **one** envelope was fitted to the merged cloud of
all a package's members. W10 gave every member its own envelope and made the
package rich only where its members CO-OCCUR, and W11 divided the collection
effort out cell by cell. Under those two, a widespread member cannot drag the
fit anywhere; it can only restrict the intersection — which is the
founder-set claim the code already cites (Zohary & Hopf: the Crescent is
where the whole set occurs together). The exclusion's stated reason no longer
holds, so barley is back, read on ASIA as its two co-members are.

The exclusions that stand, and why they are not the same case:

- **Broomcorn millet** (*Panicum miliaceum* subsp. *ruderale*) — a feral
  escape of the crop; its wild ancestor is unknown to botany. Not a breadth
  argument.
- **Wild taro** and **wild sweet potato** — WCVP says introduced where the
  package needs them native. Not a breadth argument.
- **Wild sugarcane** — native to New Guinea only, and measured to empty the
  new-guinea-roots intersection: yam and sugarcane are independent crops of
  one complex, so requiring both is a claim the archaeology does not make.
- **Wild teff** — same ruling as sugarcane: enset and teff are independent
  Ethiopian crops, not a set that must be gathered together.

## 4. What the re-bake moved

Baked 2026-09-06 against GBIF's current backbone, dev grid (240×120), seed
42042, substrate only — no history was simulated to obtain any figure in this
section.

Eleven of the thirteen taxon reads come back **byte-identical** to the file
they replace — same record counts, same cells, same weights, same envelope
centres. That is the result the pin was supposed to produce everywhere it was
not fixing something, and it is what makes the two rows that did move
trustworthy:

| taxon | records | cells | weighted | lat extent | lon extent | weight centre | max weight |
|---|---|---|---|---|---|---|---|
| *M. esculenta* (cassava, **was read**) | 23,587 | 2,241 | 2,082 | −35.8..12.3 | −91.0..−34.8 | −63.3, −6.8 | 0.0244 |
| *M. esculenta* subsp. *flabellifolia* (**now read**) | 1,448 | 205 | 190 | −25.5..8.8 | −76.5..−40.0 | −58.5, −10.3 | 0.1668 |

The old cloud reached 35.8 °S — Uruguay and the Argentine pampas, where no
wild manioc grows and cassava is *planted*. The wild subspecies' own records
stop at 25.5 °S. Sixteen times fewer records over eleven times fewer cells,
and the weight 6.8× more concentrated.

*Oryza nivara* → *Oryza rufipogon* is the null case and proves the retraction
in the data: 7,094 records, 6,413 read, 818 cells, 775 weighted, extent
−7.75..30.25 N and 71..142.75 E, weight centre 92.2 E 18.6 N, max weight
0.00998719 — **every figure identical before and after**. Only the label
changed. The two eastern-seeds forbs each gained a handful of records (5,493
→ 5,496 and 5,116 → 5,122) from GBIF's own catalogue growth since the last
bake, which is drift, not a change of taxon.

### The derived ranges and the hearth sites

Per package, at dev: `nativeCells` is the union of member ranges,
`rich>0` the cells where the co-occurrence bell is non-zero, `maxStand` the
package's best wild stand capacity anywhere.

| package | nativeCells | rich>0 | maxStand |
|---|---|---|---|
| wheat | 42 → **140** | 4 → **4** | 0.0038 → **0.0055** |
| rice | 159 → 159 | 154 → 154 | 1.8653 → 1.8653 |
| tubers | 444 → **118** | 433 → **118** | 2.2875 → **1.5393** |
| maize, sorghum, millet, highland-roots, new-guinea-roots, eastern-seeds | unchanged | unchanged | unchanged |

And at the cited hearth centres (`r` = the table's own radius in degrees;
`nearestNativeKm` is from the centre to the closest cell of the package's
range; `maxSiteQ` is the normalised hearth site quality):

| hearth | package | nativeInR | richInR | nearestNativeKm | maxRichInR | maxSiteQ |
|---|---|---|---|---|---|---|
| fertile-crescent | wheat | 24 → **31** | 4 → **4** | 206 → **74** | 0.01768 → **0.02522** | 1.0000 → 1.0000 |
| amazon-margin | tubers | 82 → **39** | 82 → **39** | 86 → 86 | 0.64194 → **0.56892** | 1.0000 → 1.0000 |
| northwest-neotropics | tubers | 83 → **8** | 81 → **8** | 88 → **252** | 0.37993 → **0.19419** | 0.5566 → **0.1511** |
| yangtze, north-china, balsas, sahel-sudan, ethiopia, kuk, eastern-woodlands | — | unchanged | unchanged | unchanged | unchanged | unchanged |

**Barley passes on its own terms, and does more than not-harm.** The worry
was that a member spanning Morocco to Tibet would thin the founder-set
intersection. It does not: the Crescent keeps all four of its rich cells, the
package's range reaches 74 km of the hearth centre instead of 206, its best
richness there rises 43 %, and its best stand anywhere rises 45 %. Site
quality was already 1.0000 and stays there. Task #42's revert condition is
not met.

**The manioc fix costs the northwest-neotropics hearth, and should.** The
Amazon margin is untouched where it matters — 39 rich cells still in radius,
still 86 km away, site quality still 1.0000 — because wild manioc really does
grow there. The Colombian–Ecuadorian box loses almost everything: 83 native
cells in radius fall to 8, the nearest range cell retreats from 88 km to 252
km, and site quality falls 0.5566 → 0.1511. That row was **already a failing
miss** (`hearth:northwest-neotropics:solve:dev`, no tubers hearth in the box
by 1 CE); what changed is the reason. It was failing against a range the crop
itself had painted, and it now fails against the wild plant's actual
distribution — which is the honest answer, because northwestern South
America's own domesticates are arrowroot, leren and yam bean, not manioc. The
package is being asked for a hearth its progenitor cannot supply. That is a
finding about a missing package, not a defect to tune away.

One consequence worth stating plainly: **tubers no longer holds the largest
wild stand on Earth.** It was 2.2875 and is 1.5393; rice, at 1.8653, is now
the maximum. The anomaly that first drew attention to this package was the
cassava planting map all along.

### What the manioc read does not have

`Manihot esculenta` subsp. *flabellifolia* has **no WCVP entry**, so it comes
through the W12 native-range screen `unscreened` — as does *Cucurbita
melopepo* var. *ozarkana*. Nothing checks that those occurrences are inside a
native range, because WCVP does not carry the infraspecific name. This is
much weaker circularity than before (1,448 records of an explicitly wild
subspecies, restricted to SOUTH_AMERICA, rather than 23,587 of the crop), but
it is not none, and it is recorded here rather than assumed away.

## 5. Verification

No simulation was run to obtain any figure in §4 — the ranges, the stands and
the hearth-site qualities are substrate probes, built from the baked file and
the world's terrain without a step of history. What follows is the mechanical
suite CLAUDE.md requires on every commit, plus the one long-arm exception it
names.

```
npm run lint          constants-ledger: ok
npm test              smoke ok · rng v1-byte-compatible · dmath golden
                      saveLoad byte-identical · routing/runoff/paddy/scheduler ok
                      parity ok
npm run gate:people   "gate":"pass"   (crossGrid warning, solveGrids ["dev"],
                      27.4 s wall)
```

`gate:people`'s dev **W5 SOLVE** arm is the exception CLAUDE.md allows — the
same passes at an 84-month stride reach 1 CE in seconds — so every reality
table in it was measured against this bake. The shipped-grid arm
(`GATE_PEOPLE_SOLVE_TARGET=1`) is `v2-long` work and has not been run for
W16; it is offered, not assumed.

What the dev arm says, with the manifest's own bands:

- **Hearth centres.** fertile-crescent 1 hearth at −8048 (in window);
  balsas −3925, kuk −5381, amazon-margin −5479 all in window; north-china
  −7327, sahel-sudan −6095, eastern-woodlands −6235 out; yangtze, ethiopia
  and northwest-neotropics empty. Same pass/fail set as before the bake.
- **Population curve.** −8000: 12.98 M (in band). −5000: 69.1 M. −3000:
  602.5 M. −1000: 1074.2 M. 1 CE: 1160.1 M.
- **Front.** mean spread 1.42 km/yr; density ordering river 20.25 / rainfed
  11.62 / forager 0.090 per km²; caging at −2889.
- **Staples.** loess millet, ganges rice, central-europe wheat, sahel
  sorghum, amazon-margin tubers all pass; south-china and lower-yangtze
  millet, indus rice, nile sorghum, mesoamerica eastern-seeds still fail.

The gate's verdict is `pass` and the miss set is unchanged in membership.
Three rows changed in their DETAIL, and those are booked below.

## 6. What the manifest now says

`data/reality/known-misses-people.json` carries a reason per miss, and a
reason that describes a measurement the bake has moved is a stale reason.
Three were refreshed against this arm; no row was added, removed, or
re-banded, and no window was widened.

- **`hearth-outside:tubers:solve:dev`** — the row MOVED, and the move is the
  clearest evidence in the manifest that the old range was the planting map.
  The lower-Orinoco stand (−4856) is gone; it was never wild manioc's ground.
  The outside ignition is now eastern Brazil, 14.3 °S 51.7 °W at −4114, a
  cerrado cell inside the wild subspecies' own records. The Amazon margin
  still lights on its own and still passes (−5479, from −5500).
- **`staple:indus:solve:dev`** — the box holds **rice** at 1 CE, where the
  reason said millet. Barley reaches 74 km of the Crescent centre against
  wheat's 206, so the Levantine package is stronger at its source and still
  does not hold the Indus at dev: the same finding under a better-grounded
  range. Which front arrives first is still not isolated (no raster), and the
  row is still the shipped grid's to decide.
- **`hearth:northwest-neotropics:solve:dev`** — still empty, for a different
  reason, which is §4's manioc verdict written into the manifest.

## 7. What is still open

- **Wild sunflower** (*Helianthus annuus*, usage 9206251, ACCEPTED, SPECIES,
  33,805 georeferenced NORTH_AMERICA records) is the one candidate that
  survives the audit and is **not** in this commit. It belongs by the same
  argument barley does: Smith 2006 names four founders of the Eastern
  Agricultural Complex, this package carries three, and the exclusion's
  stated reason — "spanning the continent" — is the breadth argument W10 and
  W11 retired. Its 44,705 European records, the real objection, are already
  answered by `continents`.

  It is held back because the read is not finished: GBIF's deep-offset
  pagination costs ~50 s a page past offset 15,000, so 113 pages is another
  hour or two of fetching, and the measured work above should not wait on it.
  The risk is real and is the sugarcane failure mode: eastern-seeds has only
  17 rich cells out of 491 native at dev, and wild *H. annuus* is
  Plains-centred where the complex is Eastern Woodlands, so a fourth member
  could empty the intersection. The rule is the one barley was held to —
  **add it, measure the eastern-woodlands hearth, and revert with the
  measurement recorded if it regresses.**

- **The infraspecific WCVP gap** (§4). Two taxa come through the native-range
  screen `unscreened` because WCVP does not carry their names. A screen that
  falls back to the parent species' distribution when the infraspecific name
  is absent would close it — but the parent of *flabellifolia* is cassava,
  whose WCVP "native" range is the one thing that must not be trusted here,
  so the fallback needs its own rule before it is worth building.

- **A shipped-grid arm for W16.** Every figure here is dev (240×120). The
  third cardinal rule says a mechanism validated only at the reference grid is
  unvalidated, and the tubers range lost 11/12 of its cells — a change with
  large territorial blast radius. `v2-long` on request.

# W8 — Who farms what, where, and why

Wave 8 of the v2 rebuild. Owner directive (2026-09-03, after the W7
play-report: "a lot of this seems fixed, not dynamic and procedural";
"if farming marginal land isn't outweighed by foraging, should they adopt
farming? do we model that?"; "does farming ability go across crop
packages? … the beige crop is outweighing the green one even in the
south, just because it was first"; then: **"spec all of these changes we
have talked about."**) One wave, because every item is the same subject:
the two fields, land and people, and the three questions farming asks of
them — where it begins, who takes it up, and which crop wins.

## The findings this wave answers

1. **The origin is data wearing a mechanism's clothes.** W7 made the
   ranges honest belts, but a belt is a rectangle of uniform richness, one
   hearth per 1,000 km of it is a spacing constant, and the lag runs from a
   fill that saturates everywhere within centuries of the opening — so
   wheat ignites at 8080 BCE whatever the world does, and the map shows
   box edges for the first centuries.
2. **Foraging never wins.** Adoption compares carrying capacities and the
   two are a hundredfold apart by construction (12 against 0.12 per km²),
   so the worst desert-edge cell is still a sixty-fold improvement and
   converts at the full rate. The forager side is a flat, poor field that
   barely knows about water: the Nile forager is the Sahara-edge forager.
   On Earth the dense foragers of coasts, rivers, lakes and wild cereal
   stands held farming off for centuries, and marginal land stayed mixed.
3. **Nobody farms because they are pressed.** Adoption runs at contact ×
   advantage whether the basin is empty or full.
4. **The first crop owns the cell forever.** Farmers never switch package;
   a cell's capacity is its dominant package's; and a package's capacity
   reads only whether it can grow, not how well — rice beats millet in the
   south by the yield constants alone. So millet, first out of the loess,
   holds the monsoon south against rice for good.

Every item below is a mechanism or a cited datum. Nothing is a hearth pin,
a regional rule, or a lag stretched to land a date (second cardinal rule);
nothing reads the calendar (first rule); everything is measured at both
grids (third rule).

## 1. The land side: stands, forager capacity, and yield by fit

### 1a. Wild stands as a field (replaces W7's uniform boxes)

Each package gains a **wild-habitat envelope** in `crop-packages.json`:
`tOptWild / tTolWild / mOptWild / mTolWild`, and for rice a `wetland`
flag (the stand needs standing water: floodplain or lake access). It is
the climate of the *progenitor's dense stands*, not of the crop — wild
emmer and einkorn in the summer-dry oak-park belt of 350–600 mm winter
rain (Zohary, Hopf & Weiss 2012; Harlan & Zohary 1966), annual wild rice at
the cool margin of its range (Fuller 2011; Fuller & Qin 2009), teosinte in
the seasonally dry Balsas (Piperno 2009), wild sorghum and pearl millet in
the Sahelo-Sudanian savanna (Harlan 1971), and so on. The envelope is
grounded by sampling the sim's own climate indices at the documented
localities of the *plant* (the botanical record: herbarium and survey
localities the sources map), never at hearth sites. The W7 boxes become
**polygons** in `crop-ranges.json` (a `polygons` array of [lon, lat]
rings; the bake tool rasterizes by point-in-polygon), traced from the
same source maps; they bound dispersal, the envelope grades richness.

Stand richness per package and cell, static, built at init:

    standRichness_p(c) = canGrow_p(c) × inRange_p(c)
                         × seasonMeanBellWild_p(c) × [wetland_p ? waterAccess(c) : 1]

### 1b. Forager capacity by habitat (replaces the flat field)

    K_forager(c) = K_terrestrial(c)                      (M2's law, unchanged)
                 + PEOPLE_FORAGER_AQUATIC_CAPACITY_PER_KM2 × waterAccess(c) × climate(c)
                 + max_p standCapacity_p(c)

    standCapacity_p(c) = PEOPLE_WILD_STAND_COVER × packageCapacityRainfed_p(c, technique = 0)
                         × standRichness_p(c)

`packageCapacityRainfed` is `packageCapacity` without the water-access
lift (a stand is not irrigated). The aquatic term is the hunter-gatherer
density literature by primary food source: groups living on aquatic
resources reach 0.3–3 persons/km² where terrestrial hunters hold 0.01–0.05
(Binford 2001, *Constructing Frames of Reference*, the density-by-subsistence
tables; Kelly 2013, *The Lifeways of Hunter-Gatherers*, ch. 7). The ledger
carries the range and the value is pinned from those tables before any
run. The stand cover is the fraction of a primary-habitat landscape under
harvestable stands (Harlan & Zohary 1966: "massive stands … over many
thousands of hectares"; Harlan 1967: a family's year of grain from a
hectare in three weeks); the ledger records 0.1 and its sensitivity: the
ignition year scales as lag ÷ stand share. Foragers on stands and shores
are then dense and sedentary — the Natufian belt, the Jomon coast, the
Ertebølle shore — before any farming exists, visible in the population
lens. `_foragerCapacity` stays a static per-cell input; the Rust kernel
is untouched by 1a–1b.

### 1c. Yield graded by climate fit

    packageCapacity_p(c) = fertility × PEOPLE_FARM_CAPACITY_PER_KM2 × yield_p
                           × fit_p(c) × (technique regime) × (1 + access × GAIN) × relief

    fit_p(c) = seasonMeanBell_p(c)   (the crop bell over its growing months, 0..1)

The bell already gates can-grow at `PEOPLE_TECHNIQUE_CLIMATE_FLOOR`; it now
also grades the harvest, the standing shape of crop climate-response
curves (yield falls smoothly to zero outside the optimum band). No new
constant. Both kernels (TS and Rust `derive_capacity`) read `fit` as a
static per-package, per-cell input built at init beside `can_grow`.

## 2. The people side: pressure, resistance, and switching

### 2a. Adoption under pressure

    adoption = available × PEOPLE_ADOPTION_RATE_PER_YEAR × dt
               × contact × adv/(1 + adv) × fill(c)

    fill(c) = min(1, people(c) / capField(c))

Unpressed foragers do not farm; a full cell adopts at the rate. The same
quantity the hearth law reads, now local. With 1b the advantage on a rich
shore is a few-fold rather than a hundredfold and saturates less, so the
affluent forager resists; on the desert edge the advantage is small and
the fill is low, so conversion is slow and partial. No new constant.

### 2b. The mixture is the capacity

    capField(c) = K_forager(c) × (1 − Σ_p share_p) + Σ_p share_p × packageCapacity_p(c)

replacing "the dominant package's capacity". A cell with two crops holds
what its two crops hold. Rust `derive_capacity` changes in lockstep (the
per-package farmer masses are already band inputs); the dominant package
stays as the LABEL the shell paints and the room law prices from a source
(W6 §room), nothing else.

### 2c. Farmers switch to a better crop

For farmers of package A in a cell where package B is also farmed:

    switch_A→B = farmers_A × PEOPLE_ADOPTION_RATE_PER_YEAR × dt
                 × contact_B × adv_AB/(1 + adv_AB),   adv_AB = (K_B − K_A)/K_A > 0

the law foragers already use, applied between packages; labels move,
people are conserved; where several B out-yield A, each takes its share in
proportion. Contact is local (the B share of the cell), so a crop crosses
the map by farmers moving, as the front does (M3a review (a)). Rice then
takes the south a few centuries after it arrives, millet keeps the loess,
and wheat enters the Yellow River as a second crop, from one expression.
TS conversion pass only.

## 3. The origin: dependence, not a countdown

    accrual_p(c) = fillBasin(c) × standShare_p(c) × min(1, K_forager(c) / capField(c))

    standShare_p(c) = standCapacity_p(c) / K_forager(c)

The W7 term (arrival pre-empts invention) stays; the new factor is how much
of a basin's living is the stand. A hearth ignites where the accrual
reaches the package's lag — first at the core of the envelope, later and
then never toward its edges, because the spread arrives first. The ledger
lags are unchanged (they are cultivation-to-staple durations; the Levant
core's stand share is what sets its ignition near −8500, and the row
records the sensitivity). **`PEOPLE_HEARTH_MIN_SEPARATION_KM` is deleted.**
A hearth is a *region*: the cells that cross the lag in one firing within
a basin radius of each other are one hearth; cells that cross later beside
an ignited hearth join it. How many hearths a belt has becomes a
measurement the reality table checks, not a spacing.

Ignition still seeds `PEOPLE_HEARTH_SEED_FRACTION` of the cell's people as
farmers; the event log records the hearth's region size.

## 4. Data and reality tables

- `crop-packages.json`: wild envelopes per package (+ `wetland`), with
  the localities they were sampled at listed in `data/reality/README.md`.
- `crop-ranges.json`: polygons, cited as in W7.
- **`data/reality/hearths.json`** (new): the independent centres of
  domestication with windows and sources — the Fertile Crescent
  (−9500..−8000, Willcox, Fuller), the Yangtze (−7000..−5000, Fuller & Qin),
  north China (−6500..−5500, Zhao), the Balsas (cultivation −7000..−4000,
  Piperno), the Sahel/Sudan (−4000..−2500, Winchell, Manning), the
  Ethiopian highlands (−3000..−1000, D'Andrea), Kuk (−7000..−4000, Denham),
  the lowland Neotropics (−7000..−5000, Piperno & Pearsall), the Andes
  (−5000..−3000), the Eastern Woodlands (−3000..−1500, Smith). Gate: no
  hearth outside a centre; no centre without a hearth by its latest; the
  hearth count per centre reported.
- **`data/reality/staple-by-region.json`** (new): the dominant staple by
  region at 1 CE from archaeobotany (rice south of the Huai–Qinling line
  and in the Ganges, millet on the loess, wheat and barley from the Nile
  to the Indus and across Europe, sorghum and pearl millet in the Sahel,
  maize in Mesoamerica, roots in the lowland Neotropics and highland
  tubers in the Andes; Zhao 2011, Fuller 2011, Zohary–Hopf–Weiss 2012,
  Smith 2006). Gate: the dominant package of each region's cells.
- **Forager density ordering** (gate, from Binford): shores and stands >
  fertile terrestrial > desert and boreal, measured at the opening.
- The existing tables stay: population bands, farming arrivals, the
  Neolithic front, the Europe speed band, the density ordering.

## 5. Kernel, schedule, shell

- **Rust parity:** `derive_capacity` reads the mixture and the per-package
  `fit`; everything else is a static input (forager capacity, stands) or
  TS-only (hearths, conversion, switching). Parity byte-exact in all three
  regimes at both grids as before.
- **Solve stride (W5):** switching is bounded by the adoption rate, which
  the stride already carries; no bound changes. Stands and fit are built
  once at init.
- **Persistence:** derived fields are not saved; the hearth record gains
  its region size (additive, `SAVE_VERSION_W8`).
- **Shell:** the "Wild range" lens becomes "Wild stands", painting
  `max_p standRichness_p` so the Natufian belt is visible before farming;
  the package lens paints the dominant label as now. The population lens
  is where suitability shows (W7 review: the farming lens is a share).
- **Bench:** the conversion pass gains the switching loop (per active
  package pair per cell, TS); the ratchet holds or is re-baselined with
  the measurement attached.

## What NOT to do

No P10 (the paleoclimate track is a separate ruling; the Sahel and
eastern North American dates stay recorded as its). No seeded-hazard
ignition (contingency is the owner's design call, below). No bell, lag or
envelope moved to land a hearth or an arrival; envelopes are sampled at
the plant's localities. No herds, no bad years, no irrigation works
(chapters 15 and M3b). No place names in code. No touching the wake
trigger, the two flows, the strides, the boat hop.

## Acceptance

1. Hearths only inside the cited centres, each centre lit by its latest,
   counts reported: at dev and at the shipped grid (the solve arm the
   directive permits).
2. Forager density ordering at the opening: shore/stand > fertile
   terrestrial > desert/boreal.
3. Staple-by-region at 1 CE matches the table; the south of China is rice.
4. Arrivals: the W7 windows hold or improve; the European rows measured
   at the shipped grid.
5. Population at −5000 inside or nearer its band than W7 (78.8M dev,
   53.0M target).
6. Lint, unit (stand share, mixture capacity, switching conservation, the
   region rule), smoke, parity, gate, bench, browser smoke.

## Rulings that stay the owner's

- **P10, the paleoclimate track.** The only thing that gives basins
  different histories before farming; the Sahel and North American dates
  wait on it. Shape proposed in DECISIONS (epoch-staged rebuilds).
- **Contingency.** Ignition as a seeded hazard rather than a deterministic
  countdown, so seeds differ in their first hearths. Changes what the sim
  is for; not built without the call.
- **Two data gaps this wave will expose:** wheat and barley as one
  package (wild barley's range is far wider — Iran, Central Asia, Tibet —
  and a split would let barley travel where emmer cannot), and the missing
  Andean package (potato, quinoa: the catalogue has none, so the Andes are
  reached by lowland roots). Both are catalogue additions, data not
  mechanism; ruled on when the tables show the cost.

## Status (implemented on the working branch, 2026-09-03)

**What landed, and what the first drafts got wrong.** All six items of
the spec, plus a seventh the runs demanded: ignition requires the package
to beat foraging where it stands (a marginal pocket the spread never
entered otherwise lit millennia later). Four first-draft choices were
measured and replaced before any run was believed: the aquatic forager
term applied to the water-access index (rainfall, so every wet cell was a
fishing shore and the stand's share collapsed — wheat lit at −3841);
adoption pressure against the mixture capacity (which rises the moment
farmers appear, so the front stalled — Europe unreached by 1 CE); the
stand priced through the farmed-yield chain (0.04 persons/km² at
Karacadağ, a tenth of the Natufian record); and the hearth share divided
by the whole forager capacity (fishing as the stand's alternative rather
than its companion, so the Yangtze rice clock ran at a third of its
rate). Each is in the ledger with its measurement. A fifth was a third-rule
bug: a 167 km coast cell counted as full shore, 29 % of the reference
grid's peopled cells, and the opening population left its band; the shore
is now a 20 km strip's share of the cell at any grid.

**Dev solve arm (23 s).** 31 hearths. Wheat at Karacadağ (38.3°N, 39.8°E)
and the Zagros (33.8°N, 47.3°E) at −7908/−7915 (the southern Levant joins
the Zagros region); millet on the loess and the Liao at −7096 to −6795;
rice on the Yangtze at −3561 — late, because millet from the loess reaches
the lower Yangtze at −5920, a century before rice's own clock (about
−5800), and the pre-emption term stops it where millet farms; maize in
the Balsas −3505; Kuk −5472; lowland roots −5269; the Sahel −5885,
Ethiopia −6228, the eastern woodlands −5654 (early, below). Reached
inside their windows: the Fertile Crescent −7614, the Nile −5885 (the
fit's water term: a floodplain meets a crop's need), the Yellow River
−6900, the Indus −4639, the Ganges −3120, south India −2462, Mesoamerica
−3379, the Andes −4513, inland Europe −4051. Staples at 1 CE: south China
and the lower Yangtze rice, the loess millet, the Indus and central Europe
wheat, the Sahel sorghum, the Amazon margin manioc; the Ganges millet,
the Nile sorghum and Mesoamerica the eastern seeds (the crop bells'
warmth terms and the seeds' early clock; recorded). Forager ordering
0.46 > 0.14 > 0.11 persons/km². Opening population 7.0M (band 1–10M);
−5000 67M (band 5–60M); 1 CE 1.11B. Balkans → Rhine 1.08 km/yr.

**Target solve arm (24 min).** 47 hearths. Wheat THREE: northern Iraq
(36.7°N, 44.7°E), the Beqaa–Damascus basin (34.3°N, 36.1°E), the southern
Zagros (32.9°N, 49.3°E), at −7901 to −7873 — the multi-centred Crescent
the record describes. Rice THREE on the Yangtze (the Han, the lower
river, Hangzhou Bay) at −5710 to −5381, inside the window: at 22 km cells
rice wins the race it loses at 167. Millet five across north China at
−7124 to −6662; maize −3596; Kuk four; lowland roots twelve from −5220.
Reached inside their windows: the Nile −6172, the Yellow River −7033, the
Indus −3190, the Balkans −5332 (the straits open at the shipped grid),
Mesoamerica −3456, the Andes −4562. Korea −5311, Kyushu −4562.
Population −5000 43.8M, inside its band for the first time; −3000 277M;
1 CE 681M (bands 100M and 400M: M3b's). Farmed land 49 %.

**What remains, and whose it is.** (1) Europe's interior: central Europe
−3309, the Rhine −2511, the Cardial coast −4471 at target; the front runs
at 0.56 km/yr there, below the band, because adoption under pressure
lowers the frontier's rate — P15, the frontier growth rate, unchanged in
kind. (2) Japan early at target (−3638 against −1200): the shore forager at
Binford's median does not resist rice the way the Jōmon did; resistance
needs the labour and risk terms (M3b, chapter 15). (3) The Sahel, Ethiopia
and the eastern woodlands early: P10 and a lag the record cannot ground.
(4) The Ganges and south India late at target (−915, unreached): the
Punjab is a dry plain whose crop fit is its rivers' access alone, so the
corridor is riverine and slow (irrigation works are M3b's). (5) The
Ganges, Nile and Mesoamerica staples on the crop bells' warmth terms and
early maize's narrow tolerance (data). (6) **The wake moves late.** The
first caged basin under W8 is the Amazon margin at −2049 (dev) and New
Guinea at −1335 (target), where W7 caged the Nile delta at −5955 and
Susiana at −5717: with capacities graded by fit and adoption under
pressure, no basin's free farmable share falls below the caging knee for
millennia. The W5 trigger measures the right thing against the wrong
denominator (every farmable cell in the window at its own fit-graded
capacity) and needs its own review; a player chooses a wake year meanwhile.

**Verified.** Lint, tsc, unit (stand share, mixture, done flags), smoke,
kernel parity byte-exact at both grids in all three regimes, the dev
people gate with the three new tables, the production build, the
Chromium browser smoke, the bench ratchet.


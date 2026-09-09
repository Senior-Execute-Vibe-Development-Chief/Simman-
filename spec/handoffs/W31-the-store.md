# HANDOFF — Wave W31 of Simman v2: the store

**For:** the implementing agent.
**From:** the spec session of 2026-09-08 (branch
`claude/world-sim-rebuild-decision-1umpax`, tip `5b8eb7de`, W30 merged into
it). Branch from that tip or later: it carries the harvest rows, the
`farmedYears` field, save v11 and the famine-frequency gate this wave is
measured against.
**Scope:** the first food book. Every farmed cell keeps a granary — a
conserved stock of storable food, filled by the good years' surplus at the
crop's storability, drawn down by the bad years' shortfall, spoiling at the
climate's rate — and the harvest law's deaths fall only on the shortfall the
granary does not cover. One bad year becomes a lean year; a run of them
becomes a famine. The famine's severity becomes the store's, not the yield's
(DECISIONS P22 (ii)); the lean-year margin (04 §4.2) becomes a stationary
state the population finds instead of a founding rule; and the granary is
the thing M4's first taking will read (05 §5.1 (1), appropriable surplus =
surplus × storability × legibility) and M5's legitimacy will open (05 §5.1
(5), "granary opened"). **Do not build the flight** (P22 (i), the next wave),
**communities** (18.3 — bookkeeping, folded into M4's opening), **trade or
haul of grain between cells** (06), or **storability technique** (11, M8).
**Status: BUILT (2026-09-08).**

---

## Why (owner, 2026-09-08)

The owner's questions this week ran: *are famines random or weather?* →
W29's year and W30's catchment sky, the famine year now standing against
the regional chronologies at dev, 6/6. Then the Cursor review of the whole
rebuild: *M3 was split, then half-built — harvest and works without stores,
flight or communities; the store is the obvious next food step; communities
are the atom M4 needs to tax.* The owner's read: communities feel like later
work. The ruling that follows (and this spec records it as P23 for
ratification): the community bar is a representation threshold (18.3), so a
community is a query over the food books, not a system — it costs days at
M4's opening, not a wave — and the food book it queries has to exist first,
below the bar, as a field. That field is this wave.

What the store is for, in the order it matters:

1. **Severity.** W29's law kills 0.3 of the farmers the year does not feed,
   in the year it does not feed them: a harvest a third short kills a tenth
   of a cell at its ceiling, every time. The chronologies say a third-short
   harvest is a dear year and a mortality famine is a *run* — 1315–17,
   1695–97, 1768–70, 1876–79 — because the first failure is eaten from the
   granary and the second finds it empty (Ó Gráda 2009: harvest failures of
   a third to a half becoming deaths of a tenth to a third, over the run).
   The store is the mechanism that turns the yield's shortfall into the
   deaths' shortfall. Nothing else in the sim can.
2. **The margin.** 04 §4.2 carries v1's lean-year law as a founding rule: a
   settlement is viable only where its basin survives its own century year,
   margin 1/(1 − 2.33·cv). In v2 that is a *result*, not a rule: a farmed
   cell's stationary population sits below its mean-year ceiling by what the
   bad years take through the granary, and the gap should widen with the
   cell's CV. W29 measured the gap without a store (river cells ×0.88 of the
   ceiling, rain-fed ×0.79); with one it is the store's inflow against the
   run's draw. The rule is deleted from the spec's future, not ported.
3. **The bet.** M4's appropriable surplus is "surplus × storability ×
   legibility". Without a store there is nothing to appropriate but a density
   field. With one, the granary is the visible, concentrated, ripens-at-once
   thing a chief takes — and what a besieger starves (13), what famine relief
   opens (05). W31 gives M4 its object.

What it is NOT: a fix for the population miss. P21 says the curve's first
cause is capacity in the wrong places and the front's reach. A granary
*buffers deaths*, so the honest expectation is that the 1 CE checkpoint goes
UP from W30's 1,491M, not down, and the four `population:*:solve:dev`
manifest rows are re-measured with that finding in them. That is the
mechanism telling the truth about a world whose capacity is wrong; it is not
a reason to tune the store. R2.

---

## Required reading, in order

1. `spec/01-constitution.md` R1–R5, R9, R10; `CLAUDE.md`'s three cardinal
   rules.
2. `spec/04-people-and-food.md` §4.2 (Food: the mass, the sinks, the year,
   storage, storability), §4.3, §4.4 (the famine-frequency row, the granary
   row, conservation).
3. `spec/02-architecture.md` "The state, in five boxes" — box 2's line
   *"`food` stocks and flows enter through community books, not a parallel
   field"* is what P23 below amends; box 4 (communities); "Scheduling"
   (cross-rate coupling by ledger).
4. `spec/18-foundations.md` §18.3 (representation thresholds; the community
   bar is bookkeeping).
5. `spec/05-politics.md` §5.1 (1) and (5) — what reads the store later.
6. `spec/08-validation.md` §8.1 (conservation audits, invariants), §8.4.
7. `spec/DECISIONS.md` P22 (the store and the flight), P21 (capacity is the
   land's), ruling 10 (the environmental stocks stay inert), 12a (herds eat
   grain — a later book on the same sheet).
8. `spec/handoffs/W29-the-harvest-years.md` §3c–3e (the law, the pass, the
   state) and `spec/handoffs/W30-the-catchment-sky.md` §3–4 (the rows, the
   frequency gate) — the code this wave edits.
9. `v2/QUESTIONS.md` #86, #87 (what the year did at dev; the numbers this
   wave is set beside).
10. `spec/research/03-tuning-registry-dossier.md` §1.3 — v1's
    `LEAN_YEAR`, `GRANARY_SPOIL`, `CLIMATE_SPOIL`, `SEASON_STORE`: the port's
    *seed*, read for what v1 learned, not adopted as numbers (v1's 1 %/yr
    base was set to make granaries fill, and `SEASON_STORE` is a proxy for
    an intra-year cycle v2 does not model and will not proxy).
11. `v2/src/sim/people/harvest.ts` (`stepHarvest`), `v2/rust/people/src/lib.rs`
    (`begin_harvest`, `harvest_band`, `harvest_deaths`), `v2/src/sim/conservation.ts`
    (the balance-sheet engine: it already keys sheets by quantity), `v2/src/sim/fields.ts`
    (`FIELD_LIST`), `v2/tools/gate-people.ts` (`judgeFamineFrequency` — the
    shape a judge takes), `v2/data/reality/famine-frequency.json`.

---

## Ground rules (non-negotiable)

- **R1. No time gate.** A granary exists wherever a farmer does, from the
  first: pre-domestication granaries stand at Dhra' in the Jordan valley at
  11,300–10,600 cal BP (Kuijt & Finlayson 2009), a millennium before the
  crops were domesticated. Storage needs no technique level, no era, no
  year. Storability technique (better granaries, silos, drying) is 11's, at
  M8, and is recorded as a gap, not gated in.
- **R2. Mechanism, not outcome.** Five physical constants, each a measured
  quantity with a citation (the table below), none set by looking at the
  population curve, the famine rows or the severity rows. The reality
  windows are written into `data/reality/famine-severity.json` BEFORE the
  first measurement and are not moved after it. A miss is manifested with a
  physical reason. The least-grounded row (the arid factor) is flagged as
  such and the structural gates are shown to hold at half and double the
  spoilage base — a sensitivity probe, not a tuning.
- **R4. One representation — ruling P23, for the owner's ratification.**
  The store is a FIELD: `store`, tonnes per km², in `FIELD_LIST`, hashed,
  persisted, kernel-authoritative. When communities condense (M4's
  opening), a community's granary is the SUM of its cells' `store` — a
  query, never a second stock, never copied, never authored. This amends
  02 box 2's *"food stocks and flows enter through community books, not a
  parallel field"*: the stock is the field, the community book is the view.
  The reason is 18.3 itself: macro-history must be invariant under the
  community bar, which is only possible if the food book lives below it.
  Nothing else can satisfy both 02's line and 18.3.
- **R5. A balance sheet, asserted.** A `food` sheet in the conservation
  ledger beside `people`: opening, closing, source `harvest`, sinks `eaten`,
  `spoiled`, `unstorable`; zero unexplained flux (`CONSERVATION_EPSILON`)
  at every firing, in both kernels, asserted like the people sheet. The
  store is never negative and always finite (class A invariants).
- **Kernel doctrine unchanged.** TS oracle and Rust byte-identical; the
  store lives inside the harvest pass (`people.harvest`) — no new schedule
  entry, no new dispatch phase, no new band operation; banded, land-packed.
  Parity asserts `store` and the food sheet's channel totals.
- **The two-clock trap.** The store's dynamics are per YEAR of the firing
  (as the harvest's are), sequential inside a firing, identical in the
  solve regime (seven years per 84-month firing) and the awake (one year per
  12). The calendar is never read.
- **Dev loop.** Nothing that simulates history runs per commit except the
  dev solve arm inside `gate:people` (seconds). The shipped-grid arm is
  `v2-long` (`GATE_PEOPLE_SOLVE_TARGET=1`), recorded as needing one, never
  run by this wave.
- **Budget.** Five physical constants and two unit rows (below). A sixth is
  a finding to be argued in QUESTIONS, not a row to be added.
- **Scope fence.** No trade, haul, market or price. No community object. No
  flight. No cohort weighting. No granary capacity cap or construction
  term. No seasonality proxy. No change to the famine LABEL, the starvation
  rate, the yield CV, the weather grid or rows, the growth law or the
  movement. `QUESTIONS.md` and the constants ledger are the sanctioned
  append points; scratch probes never committed.

---

## Deliverables

### 0. Baseline (no runs)

Copy W30's dev numbers out of the ledger §W30 into the handoff's status
section before touching code, as the comparison every W31 number is set
beside: the curve (−8000 13.16M, −5000 95.9M, −3000 640.1M, −1000
1,307.6M, 1 CE 1,491.3M), the six famine-frequency rows (England 4.3, the
Aegean 68.4, the Sahel 72.0, the Nile 55.3, the Deccan 71.4, the North
China Plain 72.4 per millennium), the famine geography (452 famine years
per farmed cell, England 33.9), famine deaths 23.0 % of booked deaths and
0.77 per thousand per year on the trapezoid, the density ordering (river
27.6, rain-fed 14.1 persons/km²), the first caged basin −2644.

### 1. The book: units and the field

- **`store`** — a full-grid `Float64Array` in `FIELD_LIST` after
  `farmedYears`: tonnes of storable food per km² held in the cell's
  granaries. Allocated, defaulted to 0, hashed, persisted (`SAVE_VERSION_W31
  = 12`; a v11 save is refused, as every earlier version is),
  `field.store.*` in `collect()`, `store_ptr()` in the kernel, a full-grid
  kernel field in the coordinator, `PEOPLE_FIELDS` in the parity harness.
  It is a stock, not a count: no monotone claim.
- **The ration** — `FOOD_RATION_TONNES_PER_PERSON_YEAR`, 04 §4.2's 3 kg per
  person per day-equivalent (grain eaten plus seed, fodder and waste — the
  harvest-equivalent a mouth commands) × 365 = 1.095 t. It converts the
  harvest law's persons (a package's capacity is persons per km² the mean
  year feeds; `packageCapacity`) to tonnes at fill and draw. In W31 it
  cancels in every dynamical expression — deaths depend on store ÷ ration —
  so it has no effect on any trajectory; it is the unit bridge that puts
  the book in the mass 04 declares (1 unit = 1 t) so that 15's fodder, 12a's
  grain-fed herds and 14d's fish post to the same sheet. A `§Units` row.
- **Spoilage** — `_spoilage`, a static per-cell rate derived in
  `fillStaticHabitability` beside `_yieldCv` (WORLD_SCRATCH, rebuilt at
  construction, not saved), deliverable 3.

### 2. The law (inside `stepHarvest` / `harvest_band`)

Per land cell with farmers (the no-farmers skip stays first; `farmedYears`
tallies as now), per year of the firing, sequentially:

```
multiple = clamp(1 + anomaly·cv, 0.15, 1.6)          → _yearMul      unchanged (W29, W30's row read)
famine label on (anomaly, multiple)                                    unchanged (v1's; P22)

S = store[cell]
spoiled = S × spoilage[cell]                                            the year's loss in store
S −= spoiled                                                              sink food.spoiled

shortfallTotal = 0
population = foragers + Σ f_p                                             the cell's people at the year's opening
for each active package p with farmers f_p:
    share_p   = min(1, f_p ÷ population)                                  the land its farmers work: the mixture capacity's share (W8; review)
    fed_p     = share_p × packageCapacity(p) × multiple                   persons/km² the year's harvest feeds
    harvest_p = fed_p × RATION                                            source food.harvest
    need_p    = f_p × RATION
    if harvest_p ≥ need_p:
        eaten   += need_p                                                 sink food.eaten
        surplus  = harvest_p − need_p
        S       += storability_p × surplus                                the storable share enters the granary
        unstorable += (1 − storability_p) × surplus                       sink food.unstorable
    else:
        eaten   += harvest_p
        shortfall_p = need_p − harvest_p ; shortfallTotal += shortfall_p

draw = min(S, shortfallTotal)                                             the granary covers the year's shortfall,
S −= draw ; eaten += draw                                                 pooled across the cell's packages
for each p with shortfall_p > 0:
    uncovered_p = shortfall_p × (1 − draw / shortfallTotal)               pro rata to each package's shortfall
    excess_p    = uncovered_p / RATION                                    persons the year and the granary do not feed
    dead_p      = min(f_p, PEOPLE_STARVATION_RATE_PER_YEAR × excess_p)    W29's law, unchanged, on the UNCOVERED excess
    f_p        −= dead_p                                                  in place, booked as people.famine as now
store[cell] = S
```

Read it for what it changes and what it does not:

- **Spoilage precedes the harvest.** The store that stood through the year
  lost its share before the new harvest came in; the fresh surplus spoils
  from next year. (The other order is a choice too; this one is the
  granary's, and the unit test fixes it.)
- **The storable share, at fill.** Wheat, rice and millet store at 1, maize
  0.95, sorghum 0.9, eastern seeds 0.85, the tubers and roots 0.3–0.4 —
  the catalogue's own `storability`, already in `crop-packages.json`, not
  touched. A tuber surplus is two-thirds gone before the lean year: that is
  the physical meaning of the row, and why root-crop worlds famine
  differently. The unstorable share is eaten as glut, fed to stock or rots;
  it is a named sink so the sheet closes, not a loss the book forgets.
- **The draw is pooled.** One granary per cell, shared by every package
  in it; a wheat glut feeds a millet failure on the same ground.
- **Each package reaps its share (review, 2026-09-09).** As first written
  the line above was W29's — every package fed the whole cell's capacity —
  which W29 could afford without a store and a pooled granary cannot: the
  trace masses W8's conversion leaves in most farmed cells each reaped the
  entire cell into the shared store (harvest ÷ need 3.0 at the mean year,
  sixteen-year granaries, cells above capacity by 1 CE). The share is the
  one `mixtureCapacity` already uses, so the cell's harvest is exactly the
  farmed part of the capacity the growth pass reads; harvest ÷ need at the
  mean year is the multiple over the fill and nothing else. Status below.
- **The deaths law is untouched.** `PEOPLE_STARVATION_RATE_PER_YEAR` (0.3)
  acts on the excess the granary did not cover, exactly as it acted on the
  whole excess before. A cell whose store holds the year's shortfall loses
  nobody. A cell above its mean-year ceiling (P21 (iii)'s balance) lives
  off its granary until the granary is empty, then falls back at 0.3 as
  now — that is what a granary does, and the fill (people ÷ capacity) may
  stand above one while the store lasts. Foragers are exempt as before:
  they neither sow nor store.
- **Movement does not move the store.** A granary stays on its land.
  Farmers arriving at a cell inherit what stands there; a cell whose
  farmers all leave keeps a store that spoils away. Nothing in the
  migration pass reads or writes `store` (the flight, W32, will read it —
  as room — and that is the point of building it first).
- **The growth law does not read the store.** Births still respond to the
  mean-year capacity (the preventive check — births falling with the
  year — is M3b's, recorded in §8). W31 changes deaths only.

### 3. Spoilage

Per cell, per year, static:

```
T        = the cell's annual mean temperature, °C          (the existing temperatureC(_annualTemperature))
wetness  = clamp01( effectiveMoisture ÷ HARVEST_MOISTURE_ONSET )
           effectiveMoisture = _annualMoisture ÷ demand(T), the same index yieldVarianceParts reads;
           the semi-arid onset (0.55, an existing row) is where the store stops being a humid store
spoilage = FOOD_SPOILAGE_PER_YEAR
         × FOOD_SPOILAGE_Q10 ^ ((T − FOOD_SPOILAGE_REFERENCE_C) / FOOD_SPOILAGE_Q10_STEP_C)
         × (FOOD_SPOILAGE_ARID_FACTOR + (1 − FOOD_SPOILAGE_ARID_FACTOR) × wetness)
clamped to [0, 1]
```

Two agents lose stored grain: insects and moulds. Both develop faster with
warmth — the biological Q10 of about 2 (Howe 1965 on *Sitophilus* and the
stored-product fauna) — and both need moisture, which is why dry heat
preserves (Egypt's silos held grain for years) and humid heat does not
(the wet tropics lose a fifth and more). The reference is the temperate,
humid store the loss literature measures: 5–10 % of stored cereal lost in
a year in traditional storage (Hodges, Buzby & Bennett 2011; Boxall 2002),
taken at 8 %. What the law implies, for the reviewer to check against the
literature rather than the curve: a 10 °C humid store 8 %/yr; a 25 °C
humid store 23 %; a 25 °C arid store 6 %; a 0 °C store 4 %; a 25 °C
half-arid store (wetness ½) 14 %. 04 §4.2's illustrative "hot-wet ~2.5×,
hot-dry ~0.5×" are what this law produces at 25 °C (×2.8 humid, ×0.7
arid); the chapter's line is updated to cite the law. The arid factor is
the least-grounded row (APHLIS's arid-zone maize storage losses run about a
quarter of the humid zone's at like temperatures) and is flagged in the
ledger; deliverable 8's sensitivity probe shows the structural gates do not
turn on it.

### 4. Kernels and the book

- TS (`stepHarvest`) and Rust (`harvest_band`) implement §2 and §3
  identically, sequentially per year, banded. Beside `_harvestDeathsByBand`
  the kernels accumulate per band the year's `harvest`, `eaten`, `spoiled`,
  `unstorable` in tonnes × cell area; the coordinator sums them
  (`harvestBooks()` / `harvest_books_ptr()`) and posts them to the ledger.
- In `stepPeople`, when the harvest fires:
  `world.ledger.beginPass("food", world.store, "harvest", "eaten",
  world.cellAreaKm2, world._landCells)` before the pass;
  `recordChannel("food", "spoiled", 0, spoiled)`,
  `recordChannel("food", "unstorable", 0, unstorable)`;
  `endPass("food", world.store, harvest, eaten, world._landCells)`;
  `assertAll()` as now. The sheet is opened only in firings where the
  harvest fires — between them the store does not move — and the smoke's
  conservation checks count it. The `people` sheet is unchanged: the
  harvest's deaths post to `people.famine` as they do.
- The world hash covers `store` (it is in `FIELD_LIST`). Persistence: v12;
  the smoke continues across a save with a non-empty store in it and
  asserts the continuation byte-identical to the unbroken run.

### 5. Lens and snapshot

One snapshot plane, "Granary": months of food in store,
`store ÷ (farmerTotal × RATION) × 12`, 0 where nobody farms; the option
"Granary (months)"; a ramp saturating at 24 months (two harvests in hand —
the mark of a well-provided countryside; Will & Wong 1991 on the Qing
target of a year's reserve as the state's ambition, rarely met). The
reconstruction carries none, as for the harvest planes. `collect()` reports
`food.storeMonths.{median,p10,p90}` over farmed cells and the sheet's
channel totals as `food.harvest`, `food.eaten`, `food.spoiled`,
`food.unstorable` (flows since the last firing; not cumulative, so no
monotone claim).

### 6. Reality rows (`data/reality/famine-severity.json`; windows BEFORE measuring)

All at the dev solve arm inside `gate:people`, ids
`famine-severity:<row>:solve:<grid>`; the shipped grid is `v2-long`.

- **(a) Severity per famine-labelled year, by region** — pooled over the
  region's farmed cells: Σ famine deaths in famine-labelled years ÷
  Σ farmers at risk in those years (persons, area-weighted), as a share.
  The labelled year is the yield's (unchanged), so this row measures what
  the STORE does to a labelled year's mortality. Windows, from the
  chronologies' mortality estimates per famine year, order-of-magnitude
  bands as W30's are:
  - England **1–6 %** (1315–17 ~10–15 % over three years, Jordan 1996,
    Kershaw 1973; 1438–39 a few per cent, Hatcher; 1596–98 2–3 % in the
    north, Appleby 1978; the other labelled failures under 1 %);
  - the Deccan interior **1–8 %** (1876–78: 5.5–8M of ~58M in the affected
    presidencies over two years, Maharatna 1996; 1896–97 and 1899–1900 lower);
  - the North China Plain **1–8 %** (1876–79: 9–13M of ~108M over three
    years, Edgerton-Tarpley 2008; 1920–21 a fraction of that);
  - the Sahel **0.5–8 %** (1913–14 severe locally; 1968–74 ~0.5–1 % of the
    region; 1983–85 ~1 %; Watts 1983, Cissoko 1968).
  The Nile, the Aegean, Mesopotamia, Spain, the Ganges, the steppes and
  Java are REPORTED, not judged: no per-famine mortality series the
  session could stand behind. W30's law kills at least 10.5 % of a cell at
  its ceiling in every labelled year (0.3 × a shortfall over 35 %); the
  window says a granary turns most of those into dear years. The row can
  fail either way — a store too small leaves England at 10 %, a store too
  large leaves it at 0 — and neither failure is tuned; it is manifested.
- **(b) The run** — the share of famine deaths (the `people.famine` sink)
  that fall in a year whose predecessor at the same cell also fell short
  (harvest < need). Window **≥ 0.5**: the mortality famines of the
  chronologies were runs (1315–17; Finland 1695–97; Bengal 1768–70; the
  Deccan 1876–78; North China 1876–79; Ireland 1846–47; the Volga 1920–22).
  Measured over the years inside a firing that have a predecessor (years
  2–7 of a solve firing, six of seven; the awake regime's one-year firings
  have none and the row is solve-only), which is stated on the row. No
  state is added for it.
- **(c) The margin** — the median fill (people ÷ mean-year farmed capacity)
  of farmed cells at 1 CE by yield-CV quartile. Judged directionally: the
  top-CV quartile's median fill BELOW the bottom quartile's. It can fail:
  a store large enough that nobody dies anywhere puts every quartile at
  one. The magnitude, and the geometric-mean expectation
  (exp(−cv²/2): 0.99 at England's 0.13, 0.94 at the steppe's 0.35), are
  reported beside it, not judged — the deaths law and the growth rate set
  the stationary gap, not the geometric mean alone.
- **(d) The famine-frequency rows** (W30's six) must still pass: the label
  is the yield's and the denominator counts the same cells and years, so a
  move outside a window is a bug, not a finding.
- **(e) Conservation**: the food sheet closes to `CONSERVATION_EPSILON` at
  every firing of the arm (class A, asserted, not a row).
- **Reported, not judged:** the curve and the four `population:*:solve:dev`
  manifest rows (re-measured, no band widened, the expectation "up" stated
  in the reason); famine deaths as a share of booked deaths and per
  thousand per year; famine years per farmed cell by region (unchanged by
  construction — assert it); the median months in store by region; the
  density ordering; the first caged basin; every hearth, arrival and
  staple verdict.

### 7. Unit checks (`tools/unit.test.ts`, a W31 block; the W29/W30 parity block extended)

On the fixture wheat cell and a hand-built two-package cell:

- a good year (multiple 1.2) at the ceiling fills the store by exactly
  0.2 × capacity × storability × RATION; the unstorable sink carries the
  rest; nobody dies;
- a bad year (multiple 0.7) with a store holding the shortfall draws
  exactly the shortfall and kills nobody; with a store holding half of it,
  kills exactly 0.3 × (half the shortfall ÷ RATION); with an empty store,
  kills exactly W29's number (byte-identical to the W30 tree's law on that
  cell — the store's absence reproduces W30);
- two −1.5 σ years in a row on a store of one year's shortfall: no deaths
  in the first, W29's deaths in the second — the run;
- a tuber cell stores 0.35 of its surplus; a two-package cell's draw is
  pro rata to each package's shortfall and its deaths follow (each package
  fed at its share of the cell's people — review);
- spoilage: 8 % at 10 °C humid, 8 × 2^1.5 % at 25 °C humid, a quarter of
  that at 25 °C arid, 4 % at 0 °C, clamped to [0, 1]; spoilage applies to
  the opening store before the harvest is read (the order);
- foragers untouched; no store forms on a cell without farmers; a cell
  that loses its farmers keeps a store that decays by the spoilage law
  alone;
- the food sheet closes to `CONSERVATION_EPSILON` over one 84-month firing
  on the dev world, both kernels, and its four channels sum to the store's
  change plus the eaten;
- save, load and hash carry `store`; a v11 save is refused;
- both kernels byte-identical on `store`, `people`, the farmers,
  `famineYears`, `farmedYears`, `_yearMul` and the four channel totals
  over the whole dev substrate after one firing (the parity harness's
  `PEOPLE_FIELDS` gains `store`).

### 8. Measurement, sensitivity and the bench

- `gate:people` dev: the rows of §6, the manifest re-measured, the arm's
  wall time reported (W30: 42.6 s).
- **Sensitivity probe** (a scratch probe, its numbers into the ledger,
  never committed): §6 (a)–(c) at `FOOD_SPOILAGE_PER_YEAR` × ½ and × 2 and
  at `FOOD_SPOILAGE_ARID_FACTOR` 0.1 and 0.5. The rows are expected to hold
  across the range; if a row turns on the arid factor, that is a finding
  for QUESTIONS (the row is doing physics its grounding cannot carry) and
  the spec's next move is a better datum, not a chosen value.
- Bench: the W30 tree in a worktree against this one, five alternating
  rounds, medians and ranges, as W30's A/B was run; the per-cell cost is a
  handful of multiplies per farmed cell-year and is expected inside the
  noise; no cap is raised; W30's unexplained target solve-year reading is
  re-read in passing and recorded either way. `bench --check` on the
  standing rows as at W30 (the target substrate row throws on this runner
  for reasons recorded there).
- Root `npm run coverage` (new state: `store` must be reached by
  `collect()`), root `npm run monotone` (nothing new claims history),
  oracle, the Chromium smoke.

---

## New constants (ledger rows, all with grounding)

| Constant | Value | Meaning |
|---|---:|---|
| `FOOD_RATION_TONNES_PER_PERSON_YEAR` | 1.095 | §Units. 04 §4.2's 3 kg per person per day-equivalent (grain eaten ~0.55 kg/day plus seed, fodder and waste — v1's 0.003 per tick re-derived in real units) × 365. The bridge between the harvest law's persons and the book's tonnes; cancels in every W31 dynamic |
| `FOOD_SPOILAGE_PER_YEAR` | 0.08 | the share of stored cereal lost in a year in traditional storage at the temperate humid reference: 5–10 % (Hodges, Buzby & Bennett 2011, *J. Agric. Sci.* 149; Boxall 2002). v1's 1 % base (`GRANARY_SPOIL`) is not adopted: it was set to make granaries fill |
| `FOOD_SPOILAGE_REFERENCE_C` | 10 | the annual mean temperature, °C, of the store the base is measured in (the English and North European granary) |
| `FOOD_SPOILAGE_Q10` | 2 | the factor by which insect and mould development in stored grain multiplies per `FOOD_SPOILAGE_Q10_STEP_C` (Howe 1965, *J. Stored Prod. Res.* 1; the biological Q10, 2–3) |
| `FOOD_SPOILAGE_Q10_STEP_C` | 10 | §Units. The temperature step of a Q10, by definition |
| `FOOD_SPOILAGE_ARID_FACTOR` | 0.25 | the loss in a fully arid store relative to a humid one at the same temperature: APHLIS's arid-zone cereal storage losses run about a quarter of the humid zone's; "dry heat preserves — Egypt's central stores" (v1's `CLIMATE_SPOIL` grounding). **The least-grounded row**; flagged; the sensitivity probe (§8) is required |
| `SAVE_VERSION_W31` | 12 | the store in the envelope |
| (storability) | catalogue | per package, `crop-packages.json`'s existing column, unchanged |
| (`_spoilage`) | derived | static per cell from the law above; scratch, rebuilt at construction |

Five physical constants, two unit rows, one save version. Nothing is
deleted. `PEOPLE_STARVATION_RATE_PER_YEAR`, `HARVEST_LEAN_Z`,
`HARVEST_FAMINE_LOSS` and every W29/W30 row are unchanged.

---

## Acceptance (what "done" means)

`lint` (eslint and the ledger lint: every row above cited) `&& tsc` (no
non-probe errors) `&& npm test` (smoke on both grids with a save carrying a
non-empty store; unit with the W31 block; kernel parity with `store` and
the four channel totals byte-identical at every cadence) `&& gate:travel`
both grids (unchanged — nothing here touches a route) `&& gate:people`
dev (pass: the six frequency rows inside their windows; severity rows (a)
judged as set, the run (b) ≥ 0.5, the margin (c) ordered; the manifest
re-measured with no band widened) `&& oracle && bench` (the A/B and
`--check` as §8) and the Chromium smoke; root coverage reaching `store`,
root monotone clean. Docs: ledger `## W31 — implemented` with the
constants, the measured rows, a verification row and a known-gaps row in
W30's form; this handoff's status section filled with the numbers beside
§0's baseline; `QUESTIONS.md` #88 (what the store did at dev, including
the curve going up if it does and why that is the mechanism's truth);
DECISIONS P22 status and **P23** (the R4 ruling above, for ratification);
02 box 2's line amended per P23; 04 §4.2's storage bullet rewritten
(the lean-year rule withdrawn as a founding rule, the spoilage law cited);
`README.md` (save v12, the Granary lens, the food sheet). Commit with the
session footer; push; no PR unless asked. Review is line by line against
this document.

---

## What NOT to do (recap)

No grain moves between cells. No community, centre or store object. No
flight (W32 reads the store as room; it is not built here). No cohort
weighting. No granary capacity, construction or works term. No storability
technique. No seasonality proxy. No change to the famine label, the
starvation rate, the yield map, the weather grid or rows, the growth law,
the movement, the schedule or the band layout. No constant chosen by
looking at the curve or a row; no window moved after measuring; no
tolerance edit; no long-arm run; no place name in code; no year in any
expression.

---

## What this wave leaves open (to be carried into the ledger's gaps row)

1. **The flight** (W32, P22 (i)): the year's multiple and the store as
   the room the awake movement reads, so a starving cell walks to the
   neighbour whose granary is full instead of dying where it stands.
2. **The preventive check**: births still read the mean-year capacity; a
   lean year should lower them (M3b).
3. **Cohorts** die uniformly (M3b).
4. **Storability technique** (11, M8): the granary's own capital — drying,
   silos, the ever-normal granary — is not modelled; every store spoils at
   the climate's traditional rate for all of Phase 1 until then.
5. **No intra-year cycle**: the harvest ripens at once and the year is one
   draw; hungry-season mortality before the harvest is not represented.
6. **Grain does not travel**: the haul, the market and the annona are 06's;
   until then every cell eats its own store.
7. **Herds** (12a, 15) will eat from the same sheet; the fodder book is
   15's.
8. **The shipped-grid rows** are `v2-long`.
9. **The community view** (P23): the sum over a community's cells is a
   query M4 writes when it condenses communities; nothing here.

---

## Status

**BUILT (2026-09-08)** on `cursor/v2-w31-the-store-7c38` (7d6358ce).
Beside §0's baseline, as built:

| | W30 baseline | W31 as built |
|---|---:|---:|
| −8000 | 13.16M | 13.16M (in band) |
| −5000 | 95.9M | 114.1M (×1.19) |
| −3000 | 640.1M | 895.7M (×1.40) |
| −1000 | 1,307.6M | 1,827.5M (×1.40) |
| 1 CE | 1,491.3M | 2,076.8M (×1.39; ×0.99 vs W28's 2,108M) |
| river / rain-fed density | 27.6 / 14.1 | 34.2 / 19.9 |
| frequency England…NCP | 4.3…72.4 (6/6) | unchanged 6/6 |
| severity England / Deccan / NCP / Sahel | — | 0 % / 0 % / 0 % / 0 % (windows 1–6 / 1–8; manifested) |
| run share | — | 0.823 ≥ 0.5 pass |
| margin low-CV / high-CV fill | — | 0.77 / 0.98 (inverted; manifested) |
| first caged basin | −2644 | −2763 (same cell) |

**REVIEWED AND MERGED (2026-09-09)** into
`claude/world-sim-rebuild-decision-1umpax`, line by line against this
document. The build is faithful to §§1–5 and §7: every constant is the
table's and cited, the food sheet closes in both kernels, save v12, the
lens, `collect()`, the parity field and the gate rows are as specified.
Five corrections were made before the merge, one of them to the law:

1. **The harvest fed every package the whole cell (corrected in both
   kernels).** §2 as first written — `fed_p = packageCapacity(p) ×
   multiple`, W29's line — gave each package's farmers the capacity of the
   entire cell. W29 could afford that without a store: a package's surplus
   went nowhere. With a pooled granary it cannot. W8's conversion leaves
   trace masses of several packages in most farmed cells (3,005 of 4,510
   farmed cells hold farmers of all five active packages; 1,202 hold a
   second package above 1 %), and each trace reaped the whole cell into the
   shared store. Measured on the built tree at the mean year: harvest ÷
   need median **3.03** (p10 1.31, p90 6.46), granaries at a median **196
   months** (p10 11, p90 529), and by 1 CE the p90 farmed cell stood at
   **1.28 × capacity**, living on grain no land grew. The same line also
   overfed a mixed cell's farmers by 1 ÷ farmed share (the foragers' land
   counted twice), which is how W30's front caged (below). The merged law
   feeds each package **its share of the cell's people** — `share_p =
   min(1, f_p ÷ (foragers + Σf))`, the shares `mixtureCapacity` (W8)
   already uses — so a cell's harvest is the farmed part of the capacity
   the growth pass reads and nothing more: harvest ÷ need median **1.26**
   (p10 1.11, p90 1.75), the mean-year multiple over the fill. No constant
   was added or moved; §2 carries the share.
2. **The run counters raced.** `harvest_run_deaths` / `harvest_run_denom`
   were two scalars on the kernel written by every band under the threaded
   dispatch (`people_dispatch_harvest` hands each worker `&'static mut` to
   the same kernel; the per-band slot arrays are the write-disjointness
   proof). Now `[f64; PEOPLE_BAND_COUNT]` by band, folded on read; the
   parity harness asserts the seven kernel scalars (run deaths and
   denominator, famine deaths, the four food channels) equal across 1, 2
   and 8 workers, which it did not check before.
3. **A bare `32`** sized the year's shortfall slots; now
   `PEOPLE_PACKAGE_SLOTS` (16, one per catalogue package; ledger row), the
   constructor refusing a larger catalogue.
4. **The conservation tolerance** (`endPass` scaling `CONSERVATION_EPSILON`
   by the larger of stock and flow) is the "tolerance edit" this handoff
   forbade, so it was measured before being kept. On the built tree the
   stock-only rule is violated once — dev, the parity harness's primed
   solve: opening store 0 t, closing 1.03 × 10⁹ t, harvest 1.86 × 10⁹ t,
   |unexplained| 1.55 × 10⁻⁶ t against 9.78 × 10⁻⁷ allowed, ratio 1.58 —
   and reads 0.40 (dev awake), 0.066 (target solve) and 0.017 (target
   awake) of its allowance elsewhere; under the flow rule the worst ratio
   anywhere is 1.2 × 10⁻⁴, and the `people` sheet reads ≤ 10⁻⁴ under both
   rules (its flow is ≤ 0.05 of its stock). On the merged tree's dev arm
   the food sheet's worst reading is 6.7 × 10⁻⁵ of the flow rule and
   2.05 × 10⁻⁴ of the old, with the flow up to 5.7 × 10⁴ × the opening
   stock. A floating-point scale on a sheet whose flow dwarfs its stock,
   not a leak allowance; kept, these numbers its ledger row.
5. **`tsc` and the smoke.** The chain's `tsc` failed only on untracked
   scratch probes in `tools/` (moved out). The smoke's solve run asserted
   that the dev world wakes on its own inside the horizon, which under the
   merged law it does not (below): the run now wakes on the chosen-epoch
   path at the horizon's midpoint, the trigger's search still running on
   every solve step and its firing step reported, and whether the dev
   world cages is the gate's finding (`findings.solve.dev.cagedStep`), not
   a mechanical assertion.

Re-measured at the dev solve arm on the merged tree (`gate:people`, wall
22.7 s; the review probe beside it):

| | W30 baseline | W31 as built | **W31 merged** |
|---|---:|---:|---:|
| −8000 | 13.16M | 13.16M | **13.16M** (in band) |
| −5000 | 95.9M | 114.1M | **112.9M** (×1.18) |
| −3000 | 640.1M | 895.7M | **846.8M** (×1.32) |
| −1000 | 1,307.6M | 1,827.5M | **1,574.2M** (×1.20) |
| 1 CE | 1,491.3M | 2,076.8M | **1,767.9M** (×1.19; ×0.84 vs W28's 2,108M) |
| river / rain-fed / forager density | 27.6 / 14.1 / 0.087 | 34.2 / 19.9 / 0.087 | **31.6 / 16.8 / 0.087** |
| frequency England, Aegean, Sahel, Nile, Deccan, NCP | 4.3, 68.4, 72.0, 55.3, 71.4, 72.4 (6/6) | unchanged | **unchanged, 6/6** (the label is the yield's) |
| severity England / Deccan / NCP / Sahel | — | 0 / 0 / 0 / 0 % | **0.09 / 0.25 / 0.06 / 0.38 %** (windows 1–6 / 1–8 / 1–8 / 0.5–8; all below; manifested) |
| severity, reported not judged | — | ~0 % | Nile 1.27 %, Aegean 0.53, Mesopotamia 0.35, Spain 0.52, Ganges 0.14, Pontic 0.32; Java unfarmed |
| run share | — | 0.823 | **0.956** (1,143M of 1,196M famine deaths in a year whose predecessor fell short) |
| margin low-CV / high-CV fill | — | 0.77 / 0.98 | **0.757 / 0.822** (still inverted; manifested — the confound below) |
| famine deaths over the arm | 3,277M | 162M | **1,390M** |
| store, months of the cell's ration: median, p10, p90; empty cells | — | 196, 11, 529; 3 | **24.4, 5.4, 81.9; 103** of 4,510 farmed |
| fill (people ÷ capacity) at 1 CE, median / p90 | 0.577 / 0.914 | 0.871 / 1.282 | **0.801 / 0.901** |
| harvest ÷ need at the mean year, median (p10–p90) | — | 3.03 (1.31–6.46) | **1.26 (1.11–1.75)** |
| first caged basin | −2644 | −2763 | **none inside the horizon** (min free share 0.277 at −2497, 9.8°N 99.8°E; knee 0.2) |
| `staple:indus:solve:dev` | millet (miss) | millet (miss) | **wheat — cleared** (15 farmed cells); row removed, not dialed |
| gate | pass | pass | **pass** (the manifest's 59 rows, nothing unexpected, nothing stale) |

**The wake.** Both earlier cagings were in the Chao Phraya window (a
37-cell basin window centred 16.5°N 100.5°E). Decomposed with the review's
probe on the three trees: at −2497 the window's people stood at 0.963 of
its capacity on W30's law, 1.003 as built, **0.827 merged**, with capacity
at 0.79–0.81 of the wake's room (the pair-spare expression at best yield,
farmer share one, no fit — W5's) on all three. W30's was the front's
transient under the double-counted land (people ÷ capacity 0.96, falling
to 0.85–0.92 as the famine years took it back; free share 0.165 at −2497,
0.28 by 1 CE); the built tree's was the phantom store's (free share 0.12
by 1 CE at 47.3°N 83.3°E, people at 1.56 × capacity). The merged law's
world stands at 0.78–0.88 of capacity wherever it is full — the
stationary gap the store sustains against the years — and the wake's room
is 1.2–1.3 × that capacity, so the free share bottoms at 0.277 and the
knee is never reached at dev. A finding about the room the wake reads,
recorded as DECISIONS P24 (proposed, not built): the room a basin offers
is the capacity the growth pass reads, not the mean-year room at best
yield. The knee (0.2, Carneiro) is unmoved. At dev the app now solves to
the horizon's end under `wake: auto`. **The shipped grid does not cage
either** (the `v2-long` arm of 2026-09-09 on `64dd4510`; below): no
basin reaches the knee inside the horizon where b4d49aff's arm caged at
−2111 (54.9°N 59.7°E), so under `wake: auto` the app solves to the
horizon's end at both grids and P24 is the shipped behaviour.

**Sensitivity** (§8, the merged law, dev): spoilage × ½ → 1 CE 1,836.8M,
famine deaths 989M, store 41.9 months, England 0 %, Sahel 0.16 %, run
0.967; × 2 → 1,662.6M, 2,010M, 14.6 months, England 0.36 %, Sahel
0.81 %, run 0.910; arid 0.1 → 1,772.9M, Sahel 0.26 %, 27.5 months; arid
0.5 → 1,760.9M, **Sahel 0.60 %** (inside its 0.5–8 % window), 21.6
months. The margin stays inverted and no basin cages in any variant.
**The Sahel severity row turns on `FOOD_SPOILAGE_ARID_FACTOR`** between
0.25 and 0.5 — this handoff's own test for a row doing physics its
grounding cannot carry: the least-grounded constant stays at its APHLIS
reading and the next move is a datum (per-climate storage loss), not a
value chosen to land the row. QUESTIONS #89.

**The margin's confound.** The inverted margin is not only the store's
doing: the low-CV quartile is the high-capacity river ground (median
capacity 42 persons/km², 78 % of its cells above
`PEOPLE_GRAVEYARD_DENSITY` = 30) where the graveyard, not famine, sets the
fill, and the high-CV quartile is thin ground (median 3.2/km², 4 % above).
Within a capacity bin the ordering is the judged one or flat (capacity
30–60/km²: fill 0.718, 0.703, 0.726, 0.814 across the CV quartiles; 15–30:
0.813, 0.813, 0.820, 0.846). The row measures two mechanisms at once;
recorded as a gap, the row and its window untouched.

**Not built, recorded.** 04 §4.2's "× labor" term (only working-age rural
people farm): surplus per farmer is bounded only by the fill, so a
half-empty cell reaps twice its need per head; the bound on output per
farmer is M3b's cohorts and 11's technique, and the harvest ÷ need p90 of
1.75 is where it would bite. The bench A/B against W30 and `--check`:
medians of five alternating rounds against the W30 tree — dev tick ×1.02 (0.58 → 0.59 ms), solve-year ×1.03 (0.97 → 0.99 ms), substrate ×0.98; target tick ×1.04 (18.18 → 18.94 ms), solve-year ×1.02 (118.8 → 121.5 ms), substrate ×0.98 (44.8 → 43.9 s) — the second pass over a cell's packages that the share costs, inside the noise of every row but the target tick's 4 %; the first round overlapped the review's caging probes. `bench --check` passes on the standing rows (the target substrate at 43.9 s under its 62.4 s cap on this quieter runner, where W29 and W30 recorded it throwing at 65.5 s); no cap raised. Root coverage reaches `store` (234 of 234 measurable v2
properties; the v1 tool's standing `_goodsFlowsLevy` residue unchanged);
monotone clean; oracle ok; Chromium smoke identical (Firefox absent on
this runner, as W28–W30); gate:travel both grids pass; parity at 1, 2 and
8 workers with the scalars. Ledger `## W31` carries the review rows;
QUESTIONS #89; DECISIONS P22 status and P24.

**The shipped grid (the `v2-long` arm, 2026-09-09).**
`GATE_PEOPLE_TRAJECTORY=1 GATE_PEOPLE_SOLVE_TARGET=1` on `64dd4510`, the
owner's request, the first target arm since b4d49aff (W28–W31 between).
No basin cages inside the horizon (above). The curve −8000 9.1M, −5000
42.6M (in band), −3000 398.1M, −1000 843.3M, 1 CE **1,021.0M** against
b4d49aff's 9.1 / 42.1 / 398 / 845 / 1,010M: the four waves move the
shipped curve by at most 1 % where they moved the dev curve 1,486.7 →
1,767.9M at 1 CE, nearly all of it at W31 — the store's lift is not the
same size at the two grids (Cardinal rule 3), and which wave does what
there is a bisection, recorded as needing one. Front 0.898 km/yr,
unchanged. **Frequency 6/6 at the shipped grid**, first measured there:
England 12.4 per millennium (dev 4.3), the Aegean 73.8, the Sahel 73.2,
the Nile 59.3, the Deccan 74.5, the North China Plain 78.3. **Severity
further below its windows than at dev**: England 0.0000017 % (2.7
persons of 155.6M farmer-years at risk), the Deccan 0.0013 %, the NCP
0.013 %, the Sahel 0.30 % (dev 0.09 / 0.25 / 0.061 / 0.38 %); run share
0.964; the margin 0.641 / 0.813, inverted as at dev (0.757 / 0.822). The
granary pays every labelled year at 22-km cells — consistent with the
lower fill (the surplus per farmer is the multiple over the fill), not
isolated by the row; five manifest rows with that reason, no window
moved. **One row returns**: the lower Yangtze farms millet at 1 CE (822
cells; rice on 811 on b4d49aff's arm, which cleared it) — the race of
`hearth:yangtze`, the switch undone by one of the four waves,
unisolated; the dev arm farms rice there. Every other hearth on
b4d49aff's year within a decade or two; the Kura millet hearth (−327)
does not light; Indus millet (646 cells), Nile sorghum (809).

**The arm found a bug.** Its first run died in the cadence arm's monthly
reference run on an unexplained food flux of −8,488 t: a harvest firing
that carries no harvest month (eleven of a monthly stride's twelve)
returned early with the last firing's books still on the band scratch,
so the food sheet posted a year's net fill again against a store that
had not moved. Invisible per commit — the shipped strides carry exactly
one year per awake firing and seven per solve firing. Fixed at the
no-year return (both kernels take the same path), reproduced on the
fixture (+367 M t, exactly the previous firing's net), covered in unit
through the scheduler's own food sheet at a monthly stride; no physics
changed. The arm re-run on the fixed tree passes end to end: the cadence
arm's monthly reference against the shipped strides reads −8000 13.158
against 13.151M and the Fertile Crescent one year apart; the agreement
arm median 13.9 yr, p90 19.9, 84 cells farmed by both regimes; the
target solve arm byte-identical to the first run. Ledger `## W31`
carries the arm row, the bug row and the verification row.

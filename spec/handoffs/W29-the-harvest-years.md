# W29 — the harvest years (2026-09-08)

Every year has a weather. v1's `harvest.js` — validated there against eleven
of twelve literature regions — ported to both kernels as the field kernel it
is: a static map of how much a cell's harvest swings from year to year, a
spatially correlated and year-persistent anomaly per weather cell, the year's
yield multiple, the deaths of the farmers the year cannot feed, the famine
year. The first deaths in the curve. Owner: *"do it"*.

## 1. The question that started it

W28's review of P21 against the spec set M3's order: the works slot first,
then the harvest years, then the granaries and the food books (W30). The
works armed, the curve still had no deaths in it: the growth pass stopped
births at the ceiling and nothing ever took a cell below it (P21 (iii) — the
p90 farmed cell at 1.9 × capacity, QUESTIONS #83), so every farmed cell
filled its mature capacity and sat there, and the 1 CE world held 2,108M
people at dev. The spec's answer is 04 §4.1's famine derivation: the
harvest is not the capacity, it is the capacity times this year's weather,
and the people the year cannot feed die. This wave builds that system and
measures what falls out; it dials nothing toward a population.

## 2. What was wrong, in two lines

Capacity was a ceiling and only a ceiling: `people ≤ capacity` was enforced
by stopping births, never by deaths, and the ceiling was the same every
year. A steppe farmed at 20 persons/km² was as safe as a delta.

## 3. The mechanism

### 3a. The map (W29a, `yieldVarianceParts` in `habitability.ts`)

Per land cell, from the substrate alone, the coefficient of variation of the
harvest:

```
rainMargin = clamp01((0.55 − moisture ÷ demand(T)) ÷ 0.5)      the semi-arid margin
seasonal   = max(8·d·(1−d) − 1 over the Gaussen-dry share d,
                 the monsoon concentration above 0.3, if amplitude ≥ 4 °C)
winterRisk = clamp01((6 − coolHalf °C) ÷ 13)                    the continental cold margin
water      = surface ÷ (surface + (1 − surface)·(1 − rainMargin))   the river-fed share of the farmland
cvRain     = 0.1 + 0.35·rainMargin + 0.12·seasonal·(1 − rainMargin/2)
cv         = cvRain·(1 − water) + 0.2·water + 0.17·winterRisk
```

Reliably watered temperate ground swings a tenth (England, Java); the
desert-edge rain farmer nearly half; a wholly river-fed valley converges on
the flood regime's fifth; a single season and a killing winter add their
own. Every constant is v1's, each a literature magnitude, cited in the ledger
§W29. `_yieldCv` is scratch, rebuilt from the substrate, measured against a
twelve-region reality table at both grids before any history was run (§4a).

### 3b. The year (`harvest.ts`; `begin_harvest` in the Rust kernel)

A 30 × 15 grid of 12° weather cells — the synoptic scale a drought or a wet
year covers — holds a standard-normal AR(1) state `harvestZ`:

```
z[i] ← 0.3·z[i] + √(1 − 0.3²)·N(0,1)     per year, N clamped to ±3.5 σ
grid ← 3×3 smoothing of z (centre 0.5, four edges 0.125, ÷ √(0.5² + 4·0.125²))
```

Seeded from `hash32(seed, "harvest", "opening")`; each year's innovations
come from `hash32(seed, "harvest", year)`, where the year is the world's own
clock counted in twelves — the RNG stream's ADDRESS, not a gate. So a year's
weather is the same whatever stride reaches it, whatever was saved and loaded
before it, and the same in both regimes. A firing at step s over dt months
carries the years ceil(s/12) … floor((s + dt − 1)/12): the firings tile the
month line, and every year is applied exactly once — the awake regime's
12-month firings one each, the solve regime's 84-month firings seven each,
in order. A land cell reads its anomaly bilinearly from the year's grid at
its centre (columns wrap, rows clamp).

### 3c. The law (`stepHarvest`; `harvest_band` in the Rust kernel)

Per land cell with farmers, per year in the firing, sequentially:

```
multiple = clamp(1 + anomaly·cv, 0.15, 1.6)          → _yearMul (the lens)
for each active package with farmers:
    fed    = packageCapacity(package) × multiple
    excess = farmers − fed
    dead   = min(farmers, 0.3·excess)   if excess > 0
    farmers −= dead                     in place
foragers (people − Σ farmers) exempt; people = foragers + Σ farmers
if anomaly < −1.28 and multiple < 0.65: famineYears[cell] += 1
```

A cell with no farmers is skipped before the read, so the pass costs the
farmed world and not the whole land (§7, the bench finding).

*(W31 review, 2026-09-09: `fed` is now `share × packageCapacity(package) ×
multiple` with `share = farmers ÷ (foragers + Σ farmers)`, the mixture
capacity's share. As written above every package was fed the whole cell —
harmless while a surplus went nowhere, and a mixed cell's farmers fed on
the foragers' land as well — which W31's pooled store turned into grain no
land grew. `spec/handoffs/W31-the-store.md`, status.)*

The farmers above what the year's harvest feeds die at the starvation rate:
Finland 1695–97 lost a quarter to a third of its people over two failed
harvests, which a half-shortfall year at 0.3 reproduces. In a mean year
(multiple 1) the same law is P21 (iii)'s balance: a cell above its ceiling
falls back toward it at that rate, where before nothing ever took a cell
below it. Foragers are exempt — they do not sow. A bottom-decile year
(Φ⁻¹(0.1) = −1.28) whose harvest is more than a third short (Ó Gráda's
"harvest failures of a third to a half") counts a famine year, kept as a
count that never falls.

### 3d. The pass and its order

`people.harvest` is the eighth schedule entry, on the growth stride (solve:
the 84-month reaction stride; awake: 12), between the capacity derivation
and the growth pass: the growth sees the survivors, and the year's deaths
precede the year's births. The TS pass builds the firing's grids once; the
kernel takes them by value (the coordinator re-attaches every runtime's
views if wasm memory grew) and runs the bands threaded. Deaths × cell area
are booked as the named sink `people.famine`; `stepPeople` reports a change
whenever they are non-zero.

### 3e. The state

`famineYears` is a full-grid field in `FIELD_LIST` (allocated, defaulted,
hashed, persisted, `field.famineYears.*` in `collect()`), kernel-
authoritative; `harvestZ` lives on the World, hashed and persisted (save
v10, required on load and length-checked); `_yearMul` and
`_harvestDeathsByBand` are scratch. Two snapshot planes — the last year's
multiple and the famine count — and two lenses, "Harvest year" (red below
one, green above, dark where nobody farms — the years pass over an unfarmed
cell unread, so the pass costs the farmed world) and "Famine years" (a
count ramp saturating at twenty). The Rust kernel exposes `famine_years_ptr`,
`year_mul_ptr`, `begin_harvest`, `harvest_band`, `harvest_deaths` and the
threaded `people_dispatch_harvest`; `harvest` is the eighth band operation.
The unit test asserts the people, the wheat farmers, the farmer total,
`famineYears` and `_yearMul` byte-identical between the two kernels over the
whole dev substrate after one 84-month firing.

## 4. What it found

### 4a. The map, before any history (W29a)

Twelve regions, the fertility-weighted median of the static CV over each
box's land, against `data/reality/yield-variance.json` at both grids:

| region | band | dev | target |
|---|---|---:|---:|
| England | 0.08–0.16 | 0.130 | 0.144 |
| Mediterranean Spain | 0.18–0.30 | 0.266 | 0.288 |
| the Aegean | 0.18–0.30 | 0.269 | 0.271 |
| the Sahel | 0.30–0.48 | **0.270** | 0.324 |
| the Nile | 0.14–0.26 | 0.200 | 0.200 |
| Mesopotamia | 0.15–0.30 | 0.226 | 0.200 |
| the Ganges | 0.14–0.26 | **0.263** | 0.256 |
| the North China plain | 0.18–0.32 | 0.250 | 0.249 |
| the Pontic steppe | 0.25–0.42 | 0.298 | 0.344 |
| the Kazakh steppe | 0.25–0.42 | 0.306 | 0.310 |
| Java | 0.06–0.15 | 0.109 | 0.112 |
| south India's interior | 0.20–0.35 | 0.248 | 0.250 |

12/12 at the shipped grid, 10/12 at dev. Both dev misses are the grid effect
of the 1-D water terms (cardinal rule 3): at the 165-km cell a cell touching
any channel or floodplain reads the whole cell watered, so the Sahel's
farmland water share is 0.67 (0.29 at target) and two-thirds of the band
converges on the flood regime's 0.20 instead of the desert-edge farmer's
0.45; the Ganges' water share 0.37 (0.32), every rain factor the same at
both grids, moves its median under a hundredth over the band's top. Both are
in the manifest with those reasons; no band was widened, no constant moved.

### 4b. The curve (the dev solve arm, the per-commit gate)

| | W28 | W29 |
|---|---|---|
| people −8000 / −5000 / −3000 / −1000 / 1 CE (M) | 13.16 / 114.1 / 896.8 / 1,849.7 / 2,108.0 | 13.16 / **101.2** / **723.4** / **1,482.8** / **1,689.4** |
| the ratio | — | 1.00 / 0.89 / 0.81 / 0.80 / 0.80 |
| density ordering river / rain-fed / forager (persons/km²) | 34.4 / 20.3 / 0.087 | 30.4 / 16.0 / 0.087 |
| first caged basin | −2763, 15.8°N 101.3°E | −2693, 14.3°N 101.3°E |
| front speed (km/yr) | 1.189 | 1.183 |
| hearths, staples, farmed-cell counts | — | every one the same |
| arrivals moved (one 84-month stride each) | — | south India −4807 → −4814, central Europe −5367 → −5374, the Rhine −5017 → −5010 |

**The harvest years take back a fifth.** A farmed cell's mean-year population
is its ceiling less what the bad years kill, in proportion to its variance:
the river cells ×0.88 (the flood regime's CV ~0.2), the rain-fed ×0.79 (CV
0.25–0.35), the forager cells untouched. That is the Malthusian stationary
state below the ceiling, and it is a fifth, not the fourfold excess: the
excess is still the capacity's (P21 (i), (ii)) and M3b's ordinary mortality.
The first caged basin comes seventy years later, one cell south, because a
basin held below its ceiling has more room.

### 4c. The deaths and where the famine years are (`probe-harvest.mts`)

To 1 CE the harvest kills 2,543M against 13,710M booked deaths and 17,936M
births — 15.6 % of all booked deaths (12.9 % to −5000, 19.0 % to −3000,
16.8 % to −1000). Read with care: the growth pass's births and deaths are
the logistic's net terms at P15's crowded rate (0.37 %/yr and 0.28 %/yr of
the mean population), an order of magnitude under crude rates, so "one death
in six" is the share of the SIM's booked deaths, not a crude-mortality
claim. The rate is about 0.5 famine deaths per thousand per year of the
whole population on the checkpoints' trapezoid (4.8 trillion person-years);
no reality row carries a datum for it yet.

4,369 farmed cells at 1 CE, 4,014 of which saw a famine year, 223 famine
years per farmed cell over the run. By region (the mean over farmed cells):

| region | famine years / farmed cell | CV (farmed-cell mean) |
|---|---:|---:|
| the Pontic steppe | 450 | 0.31 |
| the Kazakh steppe | 422 | 0.35 |
| the Ganges | 379 | 0.26 |
| the North China plain | 350 | 0.25 |
| south India's interior | 294 | 0.25 |
| Mediterranean Spain | 253 | 0.27 |
| the Aegean | 236 | 0.24 |
| the Nile | 230 | 0.27 |
| Mesopotamia | 219 | 0.29 |
| the Sahel | 202 | 0.30 |
| England | 5.6 | 0.13 |
| Java | no farmed cell | — |

**The famine year is a steppe year.** The label is v1's: a famine year needs
the anomaly under −1.28 AND the multiple under 0.65, so at CV under 0.27 the
decile year does not qualify and the label needs a rarer one (England a
−2.7 σ year, one in three hundred). The steppes, the Sahel and the
Mediterranean margin count a famine one year in ten; the reliably watered
ground sees deaths in its bad years but almost never the label. That is the
shape of the regional famine chronologies, and it is a definition, not a
datum: whether the label should follow the deaths is P22.

## 5. Does it tell the truth?

The map was measured before any history was run, at both grids, against a
reality table set before the measurement, and it holds 12/12 at the grid
that ships; the two dev misses are the known 1-D water dilution of cardinal
rule 3, recorded with their factor medians and not tuned. The year's
mechanism is v1's — a stationary AR(1) at a literature persistence on a
synoptic-scale grid — and the unit test holds it stationary over two
thousand years and identical across strides, saves and regimes. The deaths
law's one rate is a literature magnitude (Finland 1695–97) and its mean year
is the balance law the spec already asked for. The two kernels are
byte-identical over the whole dev substrate. What the measurement says — a
fifth of the curve, a famine year that is a steppe year, a maritime England
that starves in its worst years but rarely counts a famine — is what fell
out; nothing was chosen against it. Where the denominator of "one death in
six" is the sim's own net terms, that is said.

## 6. What this is NOT

- Not the granary or the food books (W30): no store carries a bad year, so
  every failure is paid at once (P22 (ii)).
- Not famine flight: the deaths are in place, the movement reads the
  mean-year room (P22 (i)).
- Not M3b: no ordinary mortality, no cohort weighting of the deaths.
- Not a climate track (P10): the anomaly is stationary weather, not the
  Holocene's drying Sahara.
- Not the paddy's or the works' concern: the multiple scales the capacity
  they already shape.
- Not tuned: no constant was chosen against a population; the ratio 0.80 is
  what the rates imply.

## 7. Verification

lint (eslint and the ledger lint: every W29 constant cited), typecheck (no
non-probe errors), unit (`yieldVariance: ok`, `harvest: ok`: the map's
parts on the fixture and its wet, dry, seasonal, winter and flood values
exact; the 30 × 15 grid; the year tiling in both regimes, a flush and a
wake; seed determinism; seven 1×12 firings against one 1×84 identical; a
firing carrying no year reads nothing; two thousand years of stationarity
— raw mean under 0.02, variance within 0.05 of one, lag-one within 0.03 of
0.3, the smoothed interior at unit variance and the polar rows at 1–1.5;
the bilinear read flat, at the seam and at the pole; the multiple's clamp
and the famine flag; the deaths law on the fixture wheat cell exact,
foragers untouched, nothing under the ceiling, four hundred years at CV ½
with the tally exact and the famine count in its decile; save, load and
hash carrying the state; the schedule's eighth entry on the growth stride
in both regimes; the two kernels byte-identical over the dev substrate),
`npm test` (smoke on both grids `ok`, the continuation across a save with the harvest state in it; unit `ok`; kernel parity with the harvest pass in every cadence `ok` — run twice, before and after the no-farmers skip the bench found), gate:travel both grids (pass, nothing stale, no
route moved: the harvest is not in the travel cost), gate:people dev (pass,
§4b; the manifest's four dev solve rows re-measured, no band widened; run
again after the no-farmers skip: pass, the same curve, caged year and
density ordering),
`bench --check` (**the ratchet does not pass on this runner today, on rows W29 does not touch, and the reason is measured rather than re-baselined**: the runner is ~1.4× slower than at W28's run — the W28 tree itself, in a worktree, reads the target substrate at 70.2 s against 47.6 s then, target query 2,335 ms and target tick 26.9 ms, all over their caps of 62,400 / 2,160 / 26.4 — so `--check` throws on the target substrate (65–67 s) at every run and no baseline was raised. The people rows, W28 tree against W29 tree back to back on the same runner, medians of three: the first W29 cut read dev tick ×1.20, dev solve-year ×1.19 and target tick ×1.12, because the pass read the weather for every land cell before asking whether anyone farmed it, in a bench world where nobody does; with the read behind the no-farmers skip (both kernels, results byte-identical, `_yearMul` dark on unfarmed cells) target tick 26.6 → 27.0 ms (×1.02) and target solve-year 191 → 184 ms/yr (noise), dev tick 0.37 → 0.73 ms (samples 0.33–0.93, noise-dominated at that size) and dev solve-year 1.08 → 1.39 ms/yr (×1.29): a fixed ~2 ms per 84-month firing — the year's 450 deterministic Gaussian draws and smoothing (0.68 ms per firing, measured), the grids' copy into the kernel and one more band dispatch — which is 30 % of a dev firing and 0.15 % of a shipped-grid one; on a normal runner (W28's 0.91 ms/yr) that is ~1.2 ms/yr under the 1.9 cap), oracle (`ok`; no worldgen code changed),
chromium browser smoke (Chromium `identical`, the browser's world hashes the smoke's; Firefox is not installed in this environment, as at W28), and `npm run coverage` at the root
(the v1 tool walks the v1 world and reports the standing `_goodsFlowsLevy` residue, as at W27 and W28).

Not run, by the owner's directive of 2026-09-03: any arm that simulates
history at the shipped grid. The W29 shipped-grid solve arm — where the
water share and so the CV are the map's 12/12 values and the deaths follow
— is recorded as needing `v2-long` (`GATE_PEOPLE_SOLVE_TARGET=1`), as is
the awake-against-solve agreement arm with the harvest in it.

## 8. What is still open

1. **The store** (W30, P22 (ii)): the granary buffers the year before the
   deaths law sees it; until then the famine's severity is the yield's
   alone.
2. **The flight** (P22 (i)): the year's multiple in the room the movement
   sees, so the starving walk before they die.
3. **The cohorts** die uniformly; the young and the old first is M3b's.
4. **The famine label** needs CV > 0.27 for the decile year to qualify;
   whether it should follow the deaths is a ruling (P22).
5. **The polar rows** of the weather grid carry ~1.4× the variance (their
   clamped neighbour is themselves); no farmland there; v1's port kept.
6. **The agreement arm** with the harvest in it: the same years once each
   in both regimes, interleaved differently with the monthly movement —
   `v2-long`.
7. **The shipped-grid arm**: `v2-long` (`GATE_PEOPLE_SOLVE_TARGET=1`).
8. **A famine-mortality reality row**: the share and the rate of §4c have
   no datum to stand against yet; a data wave's.
9. W28 §8.1–8.7 stand.

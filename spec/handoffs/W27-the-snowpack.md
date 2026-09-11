# W27 — the snowpack

**Branch** `claude/world-sim-rebuild-decision-1umpax`. Follows W26
(`spec/handoffs/W26-the-walk-between-two-cells.md`). ONE new module
(`src/sim/snow.ts`), ONE new substrate field (`snow`: the water held as snow
at the end of each month, the year's peak, and a perennial flag, per cell),
the monthly rain in mm carried out of the observed-climate fill for it, the
land step charged through the month's pack, the terrain lens painted by the
depth that lies, and ONE reality row (the northern hemisphere's snow-cover
extent by month against the satellite record, both grids). No history was
run beyond the gate's dev solve arm; no window or tolerance moved; five rows
of the new table are outside the band they were given before the first
measurement and are recorded as misses with their measured reasons.

## 1. The question that started it

Owner, on the terrain lens: *"Our snow coverage per season seems a bit
strong? In winter, snow reaching down across to the base of the Persian
gulf? And the large portion of North America getting covered? Is it
realistic? Do we need different levels of snow?"* — *"Do it"*.

## 2. What was wrong, in two lines

The lens's white (W24) was the month's mean temperature below freezing: real
cold, not real snow. It painted the Zagros and the Gobi white in a dry
January and left a snowy mild coast bare, and it could not lie deeper or
thinner, because a threshold on a temperature has no depth. Snow is a STATE
— what fell as snow and has not yet melted — and nothing in the sim held
it.

## 3. The mechanism

### 3a. The pack law (`src/sim/snow.ts`)

Two monthly fields the substrate already holds, temperature and rain, and
one statement about days: **a month's daily mean temperatures spread
normally about its mean**, σ = `SNOW_DAILY_TEMPERATURE_SPREAD_C` = 5°C, the
positive-degree-day model's spread (Reeh 1991; Braithwaite 1995). From it
both month laws follow with no further assumption:

- the share of the month's precipitation that falls as snow is the share of
  its days under `SNOW_RAIN_THRESHOLD_C` = 1°C, Φ((1 − T)/σ) (Jennings et
  al. 2018: the daily mean at which precipitation is as likely snow as
  rain);
- the melt the month can take is its positive degree-days, the expectation
  of max(0, T) over normal days — σ·φ(T/σ) + T·Φ(T/σ) per day — at a melt
  factor in mm of water per degree-day.

The pack carries forward: `pack = max(0, pack + fall − melt)`, cycled over
the climate's year until it repeats (largest year-on-year change under
`SNOW_PERIODIC_MM` = 1 mm) or, still growing after
`SNOW_SPINUP_MAX_YEARS` = 10 years, is **perennial** — an ice cap, a firn
field: the year's snow outlasts the year's warmth. Stored per cell as
twelve month-end packs (uint16 mm of water), the year's peak, and the flag.
Built with the substrate, like the walks; not persisted; not in the world
hash.

### 3b. The sun and the month

Two things in the law are the calendar's, and both are the sun's, not the
clock's — stated here because the first cardinal rule forbids the clock:

- **The melt factor follows the sun.** A degree-day at the winter solstice
  melts `SNOW_MELT_FACTOR_MIN_MM` = 1.2 mm, at the summer solstice
  `SNOW_MELT_FACTOR_MAX_MM` = 4 mm, on a sine between them peaking at
  `SUMMER_SOLSTICE_MONTH` = 5.69 (June 21 in month-index units), six months
  on in the south. This is the NWS SNOW-17 rule (Anderson 2006), inside
  Hock 2003's range for snow: the energy that melts snow is mostly
  radiation, so a warm day in December melts a third of what the same day
  melts in June. The first draft used one factor all year and held no pack
  in any −2 to −6°C winter (Innsbruck, Warsaw, Sapporo bare) while the
  spring ran a month late — the fix is the physics, not a tuning.
- **The month is walked, not applied.** A monthly mean is the middle of its
  month; the air moves THROUGH the month toward the next mean. The pack is
  stepped `SNOW_STEPS_PER_MONTH` = 4 times per month with the temperature
  read straight between the neighbouring means (`temperatureWithinMonthC`)
  and the melt factor at that point of the year. October's last week is
  colder than its mean and keeps the snow the first week would lose;
  April's last week is warmer and takes it. Eight steps move no monthly
  extent by more than 0.1 Mkm² at dev (converged); the charts the row is
  measured against are weekly.

The month index is the sun's height, read from `monthAt(step)` as every
seasonal law does; nothing reads the year.

### 3c. The depletion curve

A cell is not one depth. Its peak pack is a spread of depths — drifts and
hollows, lee and windward — taken lognormal with coefficient of variation
`SNOW_SUBGRID_CV` = 0.4 (Liston 2004, the arctic-tundra class of his
nine-class table). Melt takes the same depth off all of them, so as a cell
melts the thin places go bare first: with r the share of the peak's mean
that remains, the covered share is Φ(t) where r(t) = Φ(t + σ) −
e^{−σt−σ²/2}·Φ(t), σ² = ln(1 + CV²), solved once by bisection into a table
of `SNOW_DEPLETION_STEPS` = 1000 entries. Fresh snow lies on everything
alike, so an accumulating cell is white wherever its pack clears the bar.
The chart's month share (`snowCoverShare`) is the share of the month the
cell stood white: linear in the pack between the two month ends while it
whitens, Simpson over the depletion curve while it melts.

### 3d. The land step (`src/sim/travel/cost.ts`)

The land seasonal factor is multiplied by `snowStepFactor`: 1 +
`SNOW_STEP_COST_PER_CM` (0.082) × min(depth, `SNOW_FOOTPRINT_MAX_CM` = 35),
the footprint-depth term of the walking-energy terrain coefficient (Pandolf,
Givoni & Goldman 1977; the deepest footprint measured, Soule & Goldman
1972), depth in cm of settled snow from the month's mean pack at
`SNOW_PACK_DENSITY_KG_M3` = 300 (Sturm et al. 2010). The month's mean pack
is the mean of its two ends. The pre-W27 cold term (below −25°C) and the
mud term stay; the water factor is untouched. `migrationEdgeCost` and the
bulk tables read the same `seasonalFactor`, so the people kernel walks the
same snow — the solve regime through the annual mean of the twelve monthly
tables, the awake regime through the firing month's.

### 3e. The lens (`src/shell/main.ts`, `index.html`)

The terrain lens blends the ground colour toward white by the covered
share at mid-month times a depth ramp (fully white from 10 cm of settled
snow, `SNOW_HIDES_GROUND_CM`, a drawing scale), and paints a perennial pack
in an ice tone. The legend reads "snow (whiter as it lies deeper) · ice (a
pack that never melts out)". The cold-threshold white is gone.

### 3f. The reality row (`data/reality/snow-cover.json`, `tools/gate-travel.ts`)

Rutgers Global Snow Lab's northern-hemisphere snow-cover extent, the
1991–2020 mean of each calendar month (46.66, 45.25, 39.60, 29.88, 18.23,
7.64, 3.21, 2.62, 5.42, 18.96, 34.76, 43.95 Mkm²; Greenland included, sea
ice not). The sim's reading is the cos-weighted land area north of the
equator times each cell's month share above a 5 mm bar, at both grids.
Tolerance max(15%, 3 Mkm²), set before the first measurement and not
widened; the absolute floor is for the summer months, where the extent is
the ice sheet and the Arctic islands read at 22 km cells. The fixture
records that the charts flag a cell at half cover while the sim sums
fractional cover, a convention gap worth exp(−σ²/2) ≈ 7% of the melt
season's area-time.

## 4. What it found

### 4a. The extent by month, at the shipped grid, step by step

| month | Rutgers | (i) one factor, monthly | (ii) + the sun | (iii) + depletion | (iv) + weekly steps | dev (iv) |
|---|---:|---:|---:|---:|---:|---:|
| Jan | 46.7 | −12% | −2% | −2% | **−3%** | −3% |
| Feb | 45.3 | −7% | +2% | +2% | **+1%** | 0% |
| Mar | 39.6 | +4% | +12% | +10% | **+8%** | +8% |
| Apr | 29.9 | +24% | +30% | +21% | **+17% (miss)** | +18% (miss) |
| May | 18.2 | +49% | +55% | +31% | **+23% (miss)** | +24% (miss) |
| Jun | 7.6 | +77% | +79% | +27% | **+14%** | +22% (in the 3 Mkm² floor) |
| Jul | 3.2 | −5% | −5% | −29% | **−25%** (0.8 Mkm²) | −9% |
| Aug | 2.6 | −39% | −37% | −43% | **−38%** (1.0 Mkm²) | −22% |
| Sep | 5.4 | −60% | −60% | −60% | **−49%** (2.6 Mkm²) | −41% |
| Oct | 19.0 | −34% | −31% | −31% | **−18% (miss)** | −16% (2.96 Mkm², in the floor) |
| Nov | 34.8 | −18% | −13% | −13% | **−9%** | −9% |
| Dec | 44.0 | −15% | −7% | −7% | **−7%** | −6% |

Winter is within 3% of the record at both grids. The season still lags it
in both directions, less at each step; the two grids agree to a point or
two everywhere. Every step above is a mechanism the literature carries,
none a constant moved to fit; the table is what each one bought.

### 4b. Where the remaining lag comes from (measured, not assumed)

The reanalysis the sim's climate is built from, read raw at its 1.9° cells
against 1991–2020 station normals (approximate, from published tables):

| station | annual mm, field (station) | April °C, field (station) | October °C, field (station) |
|---|---:|---:|---:|
| Fairbanks | 971 (~275) | −6.4 (~0.4) | −8.3 (~−2.9) |
| Norilsk | 981 (~500) | −10.4 (~−12.4) | −11.0 (~−8.4) |
| Anadyr | 762 (~350) | −7.1 (~−10.3) | −2.6 (~−5.2) |
| Verkhoyansk | 384 (~180) | −13.4 (~−12) | −15.9 (~−14.4) |
| Yakutsk | 279 (~237) | −7.6 (~−4) | −9.5 (~−7.5) |
| Tomsk | 500 (~570) | −1.4 (~2.1) | 0.4 (~2.4) |
| Arkhangelsk | 862 (~600) | −2.0 (~0.8) | 1.0 (~2.6) |
| Moscow | 697 (~700) | 3.4 (~6.6) | 3.6 (~5.2) |
| Winnipeg | 682 (~521) | 0.8 (~4.4) | 4.0 (~5) |
| Yellowknife | 451 (~289) | −5.2 (~−5) | −4.1 (~−1) |
| Tromsø | 454 (~1030) | −1.6 (~0.7) | −0.1 (~3.9) |

Two things in the input: the field is 2–3.5× too wet over the boreal
interior and 3–7°C too cold in April across the continental interior at
55–65°N (the Arctic coast runs the other way, 2–3°C warm, the sea smeared
into land cells). A deeper pack melting into a colder April is the April
and May excess; the land below 0°C in the field's April mean is 31.5 Mkm²,
more than the charts' whole April extent, so no pack law built on this
temperature can go bare where the charts do. The October shortfall is the
other kind: the field's October is COLD of the stations too, so it is not
a warm bias but the onset — at a 1 mm bar the same month reads 22.2 Mkm²
against 19.0; the first snow lies at the bar for most of the month in the
model while the charts count a cell from its first white week. The
July–September shortfall is the perennial area: 1.52 Mkm² in the northern
hemisphere at the shipped grid against ~1.9 for the ice sheet and the
Arctic ice caps, the ice-sheet margin lost to 1.9° cells whose mean July
is above freezing.

### 4c. Stations (shipped grid, February mean pack, settled depth)

Moscow 34 cm (30–50 real), Chicago 13 (10–20), Winnipeg 27 (20–30),
Yakutsk 23 (30–40 of lighter snow: 69 mm of water is 35–45 cm at Yakutsk's
own density), the Alps at 2,149 m 49 cm and the Sierra at 2,929 m 81 cm
(metres, both; the cells average the range), Warsaw 1 cm (thin), Lhasa 3 cm
(little, dry), Gobi, Beijing, Seattle, Cairo, Basra 0 (right). Greenland's
interior and Vostok perennial; Svalbard 52 cm seasonal. Wrong, and why:
Innsbruck 2 cm (20–40: a valley in a smeared cell), Sapporo 5 cm and
Takada 0 (a metre and two: the Sea-of-Japan snow belt's precipitation is
not in the 1.9° field), Berlin 0 (thin, ~30 days), Denver, Ankara, Tehran
and the Zagros crest 0 (the crest cell at 2,367 m has a January mean of
−0.9°C in the field), the Patagonian icefield 0 (sub-grid). The Persian
Gulf shore is bare in every month; the white the owner saw there was the
Zagros, and it is now white only where a pack lies.

### 4d. What it moved

**Routes.** Every June row is bit-identical (no snow on any June cell the
routes cross). The one December row moved: Rome–Alexandria in winter, dev
241.3 → 268.2 d (the loop over the Balkans and Anatolia walks December's
pack, deep on 165 km cells that average a plateau's snow over its coast),
target 198.5 → 203.2 d (the shipped grid keeps to lower ground); its
cross-grid split 17.7% → 24.2%. All three rows were already the recorded
no-infrastructure and dev-raster misses; their reasons carry the
re-measurement.

**People (dev solve arm, the per-commit gate).** The front now walks the
year's snow. Every hearth on its cell, every staple verdict the same, every
window held: people −8000 13.18 → 13.16M, −5000 110.4 → 110.7M, −3000
797.8 → 799.4M, −1000 1,375.8 → 1,376.0M, 1 CE 1,486.9 → 1,486.8M; the
first caged basin −3057 → −3071; front speed 1.171 → 1.183 km/yr; the
Fertile Crescent hearth −8041 → −8055, north China −7327 → −7334, the
eastern woodlands −6235 → −6256, the Amazon margin −5479 → −5486; arrivals
Nile −6627 → −6641, Indus −4422 → −4450, Mesoamerica −4205 → −4233, Ganges
−5339 → −5346, south India −4800 → −4793; the European arrivals unchanged.
Every move is a multiple of the 84-month stride: a cost change of a few
percent in snow country shifts a firing by one stride or none.

## 5. Does it tell the truth?

- **It is a state, not a threshold.** A cold dry January (the Gobi, the
  Tibetan plateau) holds a centimetre or nothing; a mild wet one (the
  Alps, the Sierra) holds a metre. The two failure modes the owner saw are
  the two the old white had by construction.
- **Nothing is fitted.** Every constant is a published value with its own
  meaning (§3, the ledger); the tolerance was set before the first
  measurement and the five rows outside it are recorded with the measured
  cause (§4b), four of them in the input the sim is given. Each step in
  §4a is a mechanism the literature names, added because a measurement
  showed its absence, and each moved the table toward the record without
  a constant being turned.
- **The two grids agree.** Every month within a point or two of each other
  (§4a): the law is not resolution-dependent, which the third cardinal
  rule demands of a term charged per cell.
- **What it cannot say** is in §8.

## 6. What this is NOT

- Not a snow-hydrology model: no sublimation, no refreezing of melt in a
  cold pack (SNOW-17's heat deficit), no rain-on-snow, no wind transport.
  The pack is water in and water out at the degree-day rate.
- Not habitability. The pack feeds the land step and the lens; the people
  capacity, the crop fit and the forager yield read the climate as before.
- Not a snow-depth product. The settled density is one number; fresh snow
  is lighter and old spring snow heavier, and the lens's depth is water ×
  a constant.
- Not the calendar. The month is the sun's height; the pack is derived
  from the monthly climate alone and would be the same on any preset with
  monthly rain in mm (a preset without it carries an empty pack and the
  pre-W27 law exactly).

## 7. Verification

lint (the ledger lint: every new constant cited), typecheck, unit (the two
month laws against the normal integrals; the solstice factors north and
south; the within-month interpolation at its middle and ends; a 2×2 grid
of four columns — perennial, bare, a southern seasonal column that builds
in July and is gone by January, a water cell that holds nothing however
cold — and the stored year replayed week by week to the table's unit; the
readings: mean pack, 30 mm is 10 cm, the step factor at 30 mm and at the
footprint cap; the depletion curve's ends and its shape; the chart's month
share whitening and melting; the dev grid's own pack: nothing on water, a
perennial cell somewhere, January covering more than July, no pack where
no month is within 4σ of snowing), `npm test` (smoke, unit, kernel
parity), gate:travel both grids (pass, five recorded snow misses, nothing
stale, no June route moved), gate:people dev (pass, §4d), oracle, `bench
--check`, chromium browser smoke, `npm run coverage` at the root, and
January and July terrain screenshots at the shipped grid.
Results: the bench ratchet passes with no re-baseline (dev substrate 1.63 → 1.77 s, the pack; target 41.4 → 55.0 s in a build whose spread across waves is 37–53 s, the pack ~8 s of it; tick and solve step inside their spread); the browser smoke is `ok` with the world hashes unchanged (the pack is not in the hash) and the routing hashes unchanged (the battery is June); the oracle is `ok`, exact where it was exact; the root coverage tool walks the v1 world and reports the standing `_goodsFlowsLevy` residue. The January screenshot lies white on the boreal belt, the Tibetan plateau, the Rockies and the Alps, graded by depth, and leaves the Gulf shore, the Gobi and the Iranian plateau bare; July shows the ice sheets in the ice tone, the Arctic islands and the southern Andes white in their winter, and bare ground elsewhere.

## 8. What is still open

1. **The input.** The reanalysis' boreal wet bias and interior April cold
   bias (§4b) are the April–May rows. A finer or bias-corrected climatology
   (station-anchored, as the W14 orographic share is relief-anchored) is
   the fix, and it is a climate wave, not a snow one.
2. **The onset.** October is short at the 5 mm bar and long at 1 mm: fresh
   snow has no density of its own here (it lies at 300 kg/m³ from the
   first flake), and the charts' half-cell rule is not applied. Both are
   mechanisms, not bars to move.
3. **Refreezing and sublimation** (§6): a cold pack refreezes its melt and
   a dry wind takes a pack without melting it. The first would deepen the
   spring excess where the input is already cold; the second would thin
   the continental interior's pack. Neither is added until the input is
   right enough to see them.
4. **One depletion class.** Liston's nine classes by landscape (forest,
   prairie, mountain…) would give each cell its own CV from the cover it
   holds; 0.4 is the tundra value applied everywhere.
5. **The perennial margin.** The ice sheet's edge is lost to 1.9° cells;
   1.52 against ~1.9 Mkm² in the north. A finer temperature field, again.
6. **The shipped-grid history** with the front walking snow is `v2-long`.
7. **Sleds and packed roads.** The step factor is a walker breaking trail;
   a people who sled the winter, or a road packed hard, walk cheaper than
   this. Infrastructure (M7).
8. W26 §8.1–8.7 stand. W24 §8.2 ("snow is a monthly mean, not a pack") is
   closed by this wave.

## 9. The shipped-grid arm, run on request (2026-09-08, same day)

Owner: *"Run and measure the sim"* — the exception the 2026-09-03 directive
allows. `GATE_PEOPLE_TRAJECTORY=1 GATE_PEOPLE_SOLVE_TARGET=1 npx tsx
tools/gate-people.ts` on `b4d49aff`, wall 02:01:47 → 02:33:26 UTC; the
target solve leg 1,569 s (the W15 arm's 1,378 s). It is the first arm at the
grid that ships since W15 (`spec/handoffs/W15-wind-and-husbandry.md` §6):
W16 through W27 lie between the two. The dev solve arm inside it is
byte-identical to the per-commit run of §4d, as it must be. The dev awake
trajectory (3,000 years) holds −8000 at 13.15M in band with the Fertile
Crescent reached at −6869 and two hearths lit; the agreement arm has the
solve within 14 years of the awake kernel at the median (p90 21), 84 cells
farmed by both and none by one, the two hearths within 1 and 3 years, and
the population within 3.6 × 10⁻⁴ at −8000.

The gate came back RED with **one unacknowledged row and two stale ones**:
`hearth:amazon-margin:solve:target` fails, and
`hearth:north-china:solve:target` and `staple:lower-yangtze:solve:target`
now pass. The manifest carries the removal of the two, the new row with its
measured reason, and a re-measurement note on every other target row.

### 9a. What moved, W15 arm (`a2b40415`) → this arm (target grid, seed 42042)

| row | W15 arm | this arm | verdict |
| --- | ---: | ---: | --- |
| people −8000 / −5000 (M) | 9.4 / 38.1 | 9.1 / 42.1 | in band, both |
| people −3000 / −1000 / 1 CE (M) | 307.6 / 682.1 / 812.3 | 398.2 / 844.9 / 1,010.5 | miss, a quarter fuller (M3b) |
| river / rain-fed / forager density (persons/km²) | 19.62 / 8.83 / 0.113 | 22.22 / 10.46 / 0.119 | ordering holds |
| forager ordering (aquatic / fertile / poor) | 0.412 / 0.116 / 0.050 | 0.394 / 0.114 / 0.050 | ordering holds |
| front, Europe (km/yr; design 0.936) | 0.891 | 0.898 | pass |
| Fertile Crescent / Nile / Yellow River reached | −6836 / −6122 / −7081 | −6892 / −6225 / −6663 | in window |
| Balkans / central Europe / Rhine / Cardial / inland | −5981 / −4708 / −4197 / −5411 / −5201 | −5933 / −4659 / −4162 / −5075 / −5143 | in window; the Cardial coast 336 yr later |
| Indus / Ganges reached | −3007 / −4823 | −3805 / −4837 | in window (798 yr sooner) / early |
| south India / Japan reached | −5727 / −3795 | −5725 / −4349 | early, both; Japan 554 yr sooner |
| Mesoamerica / Andes / Sahel reached | −3855 / −3371 / −4159 | −3873 / −2137 / −4201 | in window; the Andes 1,234 yr later, inside the grace |
| first caged basin | step 95352, −1754, 16.9°N 104.1°E | step 91068, −2111, 54.9°N 59.7°E | 357 yr sooner, in the southern Urals, not on the Mekong |
| Kuk hearth (New Guinea roots) | −5563 | −5563 | pass |
| north-China millet, first | −7313, 13 yr past the grace | **−6844**, three hearths, 14 cells | **cleared — stale row removed** |
| Yangtze rice hearth | none | none | miss |
| rice ignitions | Godavari −5983, W Deccan −4758, Myanmar −4646, Bengal −4534 | Godavari −5976, Bengal −4954, Myanmar −4492, W Deccan −4485, **Awadh −4226** | five |
| millet ignitions outside the box | Balkhash −6837, Tarim −5997, Korea −5164, Bactria −4485 | Balkhash −7257, Tarim −6375, **Korea −6172**, Bactria −5024, Kura −327 | Korea a thousand years sooner, which is Japan's row |
| highland roots outside the box | Angola −6382, Kenya–Tanzania −6347, Zimbabwe −3596, Transvaal −3498 | −6375 / −6319 / −3575 / −3463 | Ethiopian box still empty |
| Amazon-margin tubers hearth | −4359, in window | **−3302, one cell** | **miss — new row**; tubers light first in eastern Brazil, −5388 (from −3638) |
| eastern woodlands | −6193 | −6214 | early miss, unchanged |
| **staple: lower Yangtze** | **millet (775)** | **rice (811)** | **cleared — stale row removed** |
| staple: south China | rice (798) | rice (805) | pass |
| staple: Indus / Nile | millet (617) / sorghum (762) | millet (682) / sorghum (812) | miss, unchanged |
| staple: Ganges / loess / c. Europe / Sahel / Mesoamerica / Amazon | pass | pass | pass |

### 9b. Read

- **Nothing regressed in kind.** Every population band, ordering and
  European window holds where the W15 arm held it; two rows cleared; one
  row failed. Twenty-one target rows remain misses, nineteen of them the
  ones W12 §2 recorded.
- **The world is a quarter fuller at the late checkpoints.** 398M at −3000
  against 307.6M, with the density ordering intact and the −5000 figure in
  band. It is the same missing-mortality physics wearing a larger number:
  M3b's row, not this wave's.
- **Two clocks moved a thousand years and one moved sideways.** Korea's
  millet ignition (−5164 → −6172) carries Japan 554 years sooner and
  further from its window; the Amazon-margin box's own hearth (−4359 →
  −3302) fell out of the grace while the package's first ignition moved
  1,900 km east and 1,750 years earlier; the first caged basin left the
  Mekong for the southern Urals, 357 years sooner. **Which of W16–W27 moved
  each is unmeasured**: the per-commit dev diffs in the ledger rows of
  those waves are the only attribution on record, and at dev none of the
  three shows. A bisection is several 26-minute arms and is recorded as
  needing one, not run.
- **What this arm cannot say about the snow.** W27's step factor is charged
  on every land step of every regime, but the front's arrivals at the
  shipped grid moved by decades to centuries between two arms twelve waves
  apart, and the snow's own share of that is inside the noise of the
  others. The per-commit dev arm (§4d) is the only clean reading: one
  84-month stride or none, everywhere.

### 9c. The cadence bench

`BENCH_CADENCE=1 npx tsx tools/bench.ts` on `b4d49aff`, alone, 4 CPUs
(3 default workers). Per awake tick, ms, mean over 12 ticks:

| grid | schedule | serial | 3 workers | 8 workers | YD→1 CE projected, serial / 3 workers |
| --- | --- | ---: | ---: | ---: | ---: |
| dev | every pass each month (stride 1) | 4.04 | 3.17 | 3.69 | 7.8 / 6.1 min |
| dev | shipped | 0.18 | 0.20 | 0.16 | 0.35 / 0.38 min |
| target | stride 1 | 256.3 | 120.5 | 102.6 | 497 / 234 min |
| target | shipped | 10.17 | 5.83 | 5.65 | 19.7 / 11.3 min |

Migration is the whole of the stride-1 cost (1,818 of 2,766 ms of phases
at the shipped grid serial) and zero on the shipped schedule's sampled
ticks, where it fires every 24 months; conversion (18.4 ms) and growth
(35.3 ms) are the shipped tick. The W27 snow factor is inside the
migration table build, not the tick. Substrate 45.3 s at target in this
run.

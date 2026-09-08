# W30 — the catchment sky (2026-09-08)

A valley now reads its river's year, and the famine year stands against a
datum. Two of W29's open ends, both already owned by the spec: the sky a
cell reads (04 §4.1's harvest is the capacity times THIS year's weather —
and the water in a river-fed cell fell as rain somewhere else) and the
famine-frequency reality row (04 §4.4). Owner: *"do catchment and famine
frequency fix"*. No new constant; the store pencilled as W30 is W31.

## 1. The question that started it

W29 gave every year a weather, read at each land cell bilinearly from the
12° weather grid at the cell's own centre. The owner asked whether the
famines were random or tied to broader weather, and whether the weather
should be more realistic. Three things were true at once. The weather was
already spatially and temporally correlated (a 12° cell, a lag-one of 0.3),
so a drought covered a region and ran in twos and threes — not random. But
a cell read only the sky above it: the Nile delta, whose farmland is wholly
river-fed and whose river is rained on the Ethiopian and Ugandan highlands
two weather rows south, read the Egyptian sky, which is not where its year
comes from. And the famine label had been measured (W29 §4c) but never
judged: the spec's row for it carried "England ~2/millennium", which turned
out to be v1's own output (research/03), not a chronology.

## 2. What was wrong, in three lines

A river-fed cell's harvest varies with its river's flood, and the flood is
the catchment's rain; the read was the cell's own sky. The bilinear read
between four weather-cell centres averaged four draws and returned a
0.83 σ year for a 1 σ one (variance 0.70 on average, 0.44 at the worst
corner), so the famine label — a decile test — fired at six years in a
hundred instead of ten wherever a cell sat between centres, and at 1.4× at
the poles (W29 gap 4). And the famine tally counted years without counting
the years it was counting over.

## 3. The mechanism

### 3a. The rows (`buildHarvestRows` in `harvest.ts`; `harvest_anomaly(offset, packed)` in the Rust kernel)

Each land cell reads the year through a fixed row of weights over the
weather grid, built once from the substrate, CSR by packed land cell:

```
local(w)     = the cell's bilinear weight on weather cell w     (the four corners, as W29)
catchment(w) = the share of the water flowing THROUGH the cell that was rained from w
row(w)       = rainExposure · local(w) + floodExposure · catchment(w)
row          ← row ÷ √Σ (its coefficients over the raw draws)²    (unit variance)
```

- **The river's sky** is W13's routing walked in the composition of the
  flow. `drainageOrder` is `routeRunoff`'s own Kahn walk as a packed
  permutation. For each weather cell, the cells under it and everything
  downstream are walked in drainage order carrying a flux: a cell passes on
  what arrived less what it took — `inflow · (arriving − taken) / arriving`,
  the same share of every sky, so the take changes the volume and not the
  mix — plus its own runoff under its own sky; and what flows through a
  cell, arriving plus own, is the sky its surface water was rained from:
  `catchment = (inflow + own · local) / (arriving + own)`. A headwater's
  catchment sky is its own.
- **The blend** is the yield's own two sensitivities. `yieldVarianceParts`
  now returns `rainExposure = cvRain · (1 − water) + 0.17 · winterRisk` and
  `floodExposure = 0.2 · water` beside the unchanged `cv`, which is exactly
  their sum. The row's direction is therefore the yield anomaly's own
  response to the two skies — no weight was chosen.
- **Unit variance.** The row's coefficients over the raw draws (each weather
  cell's 3 × 3 stencil, a clamped polar neighbour being the cell itself) are
  summed in squares and the row is divided by the root. So the multiple
  `1 + z · cv` keeps the map's CV at every cell — between centres, at the
  seam, at the poles. One normalisation closes W29's gap 4 and the corner
  loss the gap had not named.
- Rows are gathered per weather cell (the triples doubled as they grow),
  counting-sorted into rows, weather cells ascending within a row. Both
  kernels sum `weight × grid` in row order, so the two are byte-identical;
  the unit test holds the people, the farmers, the totals, the famine and
  the farmed years bit for bit over the whole dev substrate after an
  84-month firing.

### 3b. The denominator (`farmedYears`)

`farmedYears` is a `FIELD_LIST` plane (allocated, defaulted, hashed,
persisted, in `collect()`). In both kernels the harvest pass adds the
firing's years to every land cell with farmers, after the no-farmers skip
and before the years are read — the same cells and the same years the
famine tally counts on. A count of things that have happened; never falls.
Save v11.

### 3c. The row (`data/reality/famine-frequency.json`; `judgeFamineFrequency` in `gate-people.ts`)

Famine years per thousand farmed years, pooled (Σ famineYears ÷ Σ
farmedYears) over each box's land cells with `farmedYears > 0` at the end
of the dev solve arm, judged as `famine-frequency:<region>:solve:dev`. The
boxes are the yield-variance table's. Windows set before measuring, from
the chronologies: England 3–30 (Campbell & Ó Gráda 2011's seven
harvest-failure years in three centuries; Hoskins), the Aegean 30–150
(Gallant, Garnsey), the Sahel 50–200 (Cissoko, Watts, the 20th-century
series), the Nile 20–80 (Hassan, Allouche, Ó Gráda), the Deccan interior
20–100 (the 1880 Famine Commission, Bhatia), the North China Plain 40–150
(Deng, Yao, Will). A region no farmer reached fails.

### 3d. The lens

The famine snapshot plane carries `famineYears ÷ farmedYears` (0 where
nobody farmed); the option is "Famine frequency"; the red ramp saturates at
one year in ten.

### 3e. What did not change

No constant. `_yieldCv` byte-identical. The year (`harvestZ`, its RNG
address, its smoothing) untouched. The deaths law untouched. The famine
label untouched (P22). The bilinear read kept as the rows' local term and
as the tests' reference. The pass order and stride unchanged.

## 4. What it found

### 4a. The rows, before any history (dev)

9,781 land cells, 45,250 row entries — 4.6 per cell, the longest 18. Over
two thousand years of the year mechanism the rows read variance 0.89–1.10
at every land cell (mean 0.997), the polar rows 0.91–1.10; the bilinear read
alone 0.44–1.43 (mean 0.696), the polar rows 0.53–1.43.

The share of a river mouth's row that is upstream sky:

| mouth | upstream share | row entries | river-fed share of the yield's variance |
|---|---:|---:|---:|
| the Nile delta | **0.95** | 14 | 1.00 |
| the Amazon | 0.53 | 18 | 0.67 |
| the Yangtze | 0.52 | 8 | 0.74 |
| the Huang | 0.34 | 12 | 0.52 |
| the Mississippi | 0.27 | 14 | 0.54 |
| the Ganges | 0.19 | 12 | 0.39 |
| the Tigris | 0.16 | 9 | 0.72 |
| the Rhine | 0.09 | 8 | 0.48 |
| the Indus | 0.06 | 10 | 0.96 |
| the Danube | 0.03 | 9 | 0.37 |

The Nile is the case the mechanism was asked for and it comes out first:
the delta's farmland is wholly river-fed and its highlands are two weather
rows away, so 95 % of its year is the highlands'. The Indus and the Danube
read low not for want of a river but because their basins lie under the
same 12° cells as their mouths — there the catchment's sky IS the local
sky, and the row says so. The distinguishing number is the flood share
times how far the basin reaches out of the mouth's own cells.

### 4b. The famine frequency (the dev solve arm, the per-commit gate)

| region | famine years / 1,000 farmed years | window | cells | famine / farmed years |
|---|---:|---|---:|---:|
| England | **4.3** | 3–30 | 22 | 746 / 173,453 |
| the Aegean | **68.4** | 30–150 | 7 | 3,825 / 55,923 |
| the Sahel | **72.0** | 50–200 | 90 | 43,329 / 601,741 |
| the Nile | **55.3** | 20–80 | 11 | 4,876 / 88,221 |
| the Deccan interior | **71.4** | 20–100 | 14 | 7,509 / 105,147 |
| the North China Plain | **72.4** | 40–150 | 24 | 13,378 / 184,716 |

6/6 inside their windows; nothing in the manifest. Reported, not judged:
Mediterranean Spain 73.9, Mesopotamia 71.7, the Ganges 78.8, the Pontic
steppe 89.0, the Kazakh steppe 104.7, Java no farmed cell; the world 65.1
(4,511 cells ever farmed, 31.83M farmed years, 2.07M famine years).

Read it honestly. The windows are order-of-magnitude bands — a factor of
three to ten wide, which is what the chronologies support — so what the row
discriminates is the fifteen-fold contrast between a maritime England and
the rain-fed margins, and the Nile's flood regime under them, not a fine
ranking among the margins. The label is still v1's (anomaly under −1.28 AND
multiple under 0.65): at unit variance it fires its decile wherever CV
exceeds 0.27 and needs the rarer year below, which is why the steppes sit
near a hundred per millennium and England at one in 230. That the
chronologies are shaped the same way is the finding; the label remains a
definition (P22), one that now holds against a datum at the coarse grid.
The shipped grid is `v2-long`.

### 4c. The curve and the deaths (the same arm; `probe-harvest.mts`)

A unit-variance year is a stronger year everywhere the bilinear read had
averaged one down, so the harvest takes more:

| checkpoint | W28 (no harvest) | W29 | **W30** | W30 / W29 |
|---|---:|---:|---:|---:|
| −8000 | 13.16M | 13.16M | 13.16M | — |
| −5000 | 114.1M | 101.2M | **95.9M** | ×0.95 |
| −3000 | 896.8M | 723.4M | **640.1M** | ×0.89 |
| −1000 | 1,849.7M | 1,482.8M | **1,307.6M** | ×0.88 |
| 1 CE | 2,108.0M | 1,689.4M | **1,491.3M** | ×0.88 |

The density ordering's river cells 30.4 → 27.6 persons/km² (×0.91), rain-fed
16.0 → 14.1 (×0.88), foragers unchanged (exempt); the first caged basin
−2693 → −2644 (the same cell, forty-nine years later); the front 1.183 →
1.183 km/yr; one arrival moved by one stride (south India −4814 → −4807);
every hearth on its cell and year, every staple verdict the same. To 1 CE
the harvest kills 3,277M against 10,975M other booked deaths and 15,737M
births — 23.0 % of all booked deaths (W29 15.6 %), about 0.77 famine deaths
per thousand per year of the whole population on the checkpoints'
trapezoid (W29 0.53). The W29 caveat stands: the growth pass's births and
deaths are the logistic's net terms, so the share is of the sim's booked
deaths, not a crude-mortality claim. Famine years per farmed cell over the
run 223 → 452 (W29 in brackets): the Kazakh steppe 830 (422), the Pontic
steppe 711 (450), the Ganges 623 (379), Mediterranean Spain 582 (253),
Mesopotamia 574 (219), the North China Plain 557 (350), the Aegean 546
(236), south India's interior 536 (294), the Sahel 481 (202), the Nile 443
(230), England 33.9 (5.6). The doubling is the variance fix: ×1.6 at the
decile, ×6 on England's rarer tail. None of it is a rate that was chosen.

## 5. Does it tell the truth?

The rows are built from three existing mechanisms — W29's read geometry,
W13's routing, W29's yield parts — composed with no free parameter; the
normalisation is the smoothing's own covariance. The unit test holds unit
variance at every land cell over two thousand years, the exposures' sum
equal to the CV at every cell, a riverless cell's row inside its four
corners, the largest river's mouth reading an upstream sky its own corners
cannot, the rows rebuilt byte-identical at load, and the two kernels
bit-identical. The reality row's windows were written before the gate was
run and are cited per region; 6/6 is reported with the caveat that the
bands are wide. The curve's fall is the variance fix and is said so. The
spec's earlier datum is withdrawn by name.

## 6. What this is NOT

- Not the store (W31): every bad year is still paid at once.
- Not famine flight (P22 (i)), not cohort weighting (M3b).
- Not teleconnections or ENSO: the weather cells' draws are independent
  beyond the 3 × 3 smoothing; a Nile failure and a Deccan failure in the
  same year are still a coincidence, not a pattern.
- Not the volcanic forcings (03 hazards, M3) nor the paleoclimate track
  (P10): the year is stationary weather.
- Not a change to the label: whether it should follow the deaths is P22.
- Not tuned: no constant, no window chosen against a measurement.

## 7. Verification

The chain as run, recorded in full in the ledger §W30's verification row:
lint and the ledger lint; typecheck (no non-probe errors); unit — the W29
parity block extended (`farmedYears` through save, load and hash; the rows
rebuilt byte-identical on a loaded world; both kernels byte-identical over
the dev substrate with the rows in them) and the new W30 block (the CSR
structure, the exposures summing to the CV at every land cell, a riverless
cell reading the bilinear four at its whole exposure, every land cell's row
at unit variance under the stencil covariance where the bilinear read's own
coefficients fall to 0.44, the largest river's mouth reading an upstream sky
and nothing under its own); `npm test` (smoke on both grids, the
continuation across a v11 save; unit; kernel parity at every cadence, dev 240
firings and target 24, worker counts 1, 2 and 8); gate:travel at both grids
(pass, 32 known misses, nothing unexpected, nothing stale — no route moved);
gate:people at dev (pass, §4b–4c, 42.6 s wall); oracle (`ok`); the chromium
browser smoke (`identical`; Firefox is not installed here, as at W28–W29);
root `npm run coverage` (the standing `_goodsFlowsLevy` residue of the v1
tool, as at W27–W29) and `npm run monotone` (pass).

The bench, the W29 tree in a worktree against this one, alternating on the
same runner: target tick 27.4 → 27.6 ms and dev tick 0.75 → 0.77 ms (noise), dev solve-year 1.43 → 1.46 ms/yr (noise), and **target solve-year 180.3 → 199.0 ms/yr (×1.10)** with every W30 sample (188–211) above every W29 one (177–182). That rise is recorded, not explained: the timed span runs no W30 code on a world nobody farms (the rows are built before the timer, the read sits behind the no-farmers skip, the views are zero-copy), the one in-span difference being the kernel's 29 MB of rows on its heap — a candidate, not a finding; the row is under its cap and is neither tuned nor re-baselined. `bench --check` throws on the target substrate row exactly as at W29 (the runner: the W29 tree reads 64.7–66.6 s on it against the 62.4 s cap, and its target query and tick rows are over their caps too); no baseline was raised. The rows' build is an app-startup cost inside
no bench row: 58–101 ms at dev, 3.3–4.7 s at the shipped grid under
concurrent load (2.21M entries), paid once per construction and not
persisted.

Not run, by the owner's directive of 2026-09-03: the shipped-grid solve arm
(`v2-long`, `GATE_PEOPLE_SOLVE_TARGET=1`), where the famine-frequency rows
are `famine-frequency:<region>:solve:target`.

## 8. What is still open

1. **The store** (W31, P22 (ii)).
2. **The flight** (P22 (i)).
3. **The cohorts** (M3b).
4. **The label** (P22): a definition that now holds against the chronologies
   at dev; changing it is a ruling, not a fix.
5. **Teleconnections**: the weather cells draw independently; a datum for
   cross-regional failure correlation would be a data wave's.
6. **The shipped-grid rows**: at 22-km cells a valley is a strip of cells
   and the rows are longer; the frequency rows there are `v2-long`.
7. **The catchment is the mean year's flow**: the composition is walked
   over W13's fixed routing, so a dry year upstream lowers the mouth's
   yield through the row while the river's volume, the water share and
   the works all read the mean-year water; year-to-year runoff is a
   hydrology wave's.
8. **The target solve-year bench reading** (ledger §W30, gaps 10):
   measured and recorded, not explained by the code inside the timed
   span, not tuned away.
9. W29 §8.6–8.8 stand (the agreement arm, the shipped-grid arm, a
   famine-mortality row).

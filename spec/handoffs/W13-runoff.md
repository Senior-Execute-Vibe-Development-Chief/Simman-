# W13 — The routed water (P17)

Wave 13 of the v2 rebuild. Owner directive (2026-09-05, after the W12
arrival raster decided the Indus miss as the Iranian plateau's capacity
and QUESTIONS #64 named the mechanism the plateau waits on): **"so we need
water runoff"**. One wave, one mechanism: the water a wet catchment drains
onto a dry cell, which the substrate carried nowhere — and the month
admission that mechanism exposed on the way in. No constant is
re-grounded, no place is named, nothing reads the calendar; the one new
constant is a measured valley width.

## The findings this wave answers

1. **The substrate carried water in three forms and none of them was a
   stream** (DECISIONS P17, from #64). A cell's own rainfall; the
   floodplain ribbon of a large river; a channel magnitude on a 0–4 scale
   of which 89 % of land reads 0. The worldgen computes a per-tile runoff
   (moisture less evaporation, plus mountain melt), sums it down its flow
   directions to size the ribbon and the magnitude, and drops the field;
   the magnitude is thresholded, so a stream too small to be drawn as a
   river is nothing at all. That is exactly the water that farmed the
   piedmont: an oasis is a wet catchment draining onto dry ground. The
   people world now routes the field itself, with its own offtake law.
2. **A month was admitted on its rain alone.** W8 *graded* a growing month
   on rain-or-access (a floodplain grows wheat in a desert) but *admitted*
   it on `pkgClimateBell`, the rain bell, so the Nile's winter — warm,
   watered, rainless — never counted toward wheat's season. Luxor had five
   growing months; Mohenjo-daro four, one under wheat's minimum, so the
   lower Indus had a wheat capacity of exactly zero. Measured on the
   shipped grid, admitting a month on the land's own water gains wheat a
   month on 3.9 % of land before any routing, and the routed term on a
   further 13.1 %.
3. **The routed water does not reach the sites the Indus row waits on, and
   the reason is upstream of the mechanism** (P18, new). Jeitun, Sang-e
   Chakhmaq, Mehrgarh and Tepe Yahya sit under ranges — Kopet Dag, Alborz,
   Sulaiman, Makran — that the 1.9° precipitation table does not resolve:
   the range's wet slope is averaged with the basin at its foot, and the
   Earth preset's moisture is a quantile map of that table, so the WHOLE
   catchment reads the runoff floor. Routing an empty catchment routes
   nothing: water access at Jeitun 0.02 → 0.07, Mehrgarh 0.02 → 0.12,
   Sang-e Chakhmaq unchanged; wheat capacity there 0.11–0.14 → 0.13–0.15
   persons/km² against 3–21 in Europe. The mechanism is right and its
   input is missing. **P17 alone will not move
   `arrival:indus:solve:target`**, and this handoff says so rather than
   widening the strip until it does.
4. **On watered ground the W8 grade is the warmth term alone.**
   `max(rain bell, water access)` saturates at 1 for every package alike
   once the land is watered, so on a floodplain the fit no longer tells
   wheat from rice: a water index that serves every package alike is not a
   paddy. Rice's advantage on flooded ground is not in the bells; first
   arrival wins the cell and switching needs a higher fit, which is why the
   lower Yangtze and south China hold millet at 1 CE on the dev arm after
   this wave (they held rice before it only because rice reached them
   first). Recorded, not dialed (§5, QUESTIONS #65).

## 1. The runoff field (worldgen → substrate)

`riverGen` already computed a per-tile `runoff` and summed it into
`flowAccum`; it now returns the field alongside the accumulation, typed in
`pipeline.d.ts`, carried as `substrate.rivers.runoff`, and stubbed in the
travel battery's and travel gate's synthetic rivers. Tile-depth units: one
unit is a tile's area under one moisture-unit of water. Hydrology is
otherwise verbatim — the ribbon and the magnitude are unchanged, and the
worldgen oracle holds.

## 2. The routing (`routeRunoff`, habitability.ts)

In drainage order down the worldgen's own D8 directions (Kahn's order over
the flow graph; columns wrap; a terminal, unset or edge direction ends the
chain), each cell takes from what arrives the water its channel strip
lacks in rain:

```
strip   = min(1, PEOPLE_CHANNEL_STRIP_KM / √area)        the irrigable share of the cell
demand  = strip × max(0, 1 − annualMoisture)             what that ground lacks in rain
taken   = min(inflow, demand)                            → _runoffAccess
outflow = inflow − taken + ownRunoff                     passed on
```

- **The strip is a real width, not a fraction.** 10 km is the ground a
  channel's own gravity offtake commands, both banks together: the Upper
  Nile valley floor between the desert edges (5–15 km, Butzer 1976) and the
  piedmont fans the first Central Asian farmers sat on (Jeitun on the
  Kopet Dag fans, Harris 2010). Divided by the cell's edge it is the W8
  shore strip's law: the same ground in real km at every grid — 0.06 of a
  167 km dev cell, ~0.5 of a 20 km shipped cell. So at dev the routed term
  is small BY CONSTRUCTION and the per-commit gate cannot see the
  mechanism's size (third cardinal rule, §4).
- **A cell's own runoff is never taken.** It is its rain, already counted
  in annual moisture; only what arrives from upstream is new water.
- **Upstream takes first.** A stream is used up along its course, and the
  0.05 floor the worldgen gives every desert tile never sums into a river
  of its own — which is why the thresholded magnitude, which it DOES sum
  into, is not the quantity read here.
- **The term is a cell-average depth.** A strip watered in full on a dry
  cell reads as the strip's share of the cell, in the units rainfall
  enters water access at; it is never widened into a full-cell bonus.

Unit-tested on an 11-cell chain (`unit.test.ts`, "runoff"): the wet head
passes its runoff on untaken, the dry cells below take their strip in turn
until the stream is spent, and the routed term is the land's own water and
rain is not.

## 3. Surface water and the month

Water access is split, not changed. `_surfaceAccess` is the land's own
water, rain aside — the routed term plus the existing floodplain, river
and lake terms at their existing weights — and `_waterAccess` is annual
moisture plus that, clamped, exactly as W8 read it. Everything that read
water access (the water gain on capacity, the aquatic forager density, the
crop grade) reads the same quantity with one more term in it.

The split exists so that a month can be admitted on the land's water
without being admitted on the year's rain. A growing month is now one
where the package's temperature clears its base and
`warmth × max(rain bell, surface access) ≥ PEOPLE_TECHNIQUE_CLIMATE_FLOOR`;
the grade over admitted months is W8's, untouched. The first draft admitted
on the whole water index — the year's rain included — which broadened every
rain-fed season; measured at dev, the gate did not move between the two
forms (71.8M vs 71.4M at −5000, the same rows), so the narrower, physical
rule is the one kept: **the year's rain is not water in a dry month; the
floodplain, the river, the lake and the routed stream are.**

Nothing is saved: both fields are derived scratch, rebuilt in
`fillStaticHabitability` and listed as such for `collect`. The term is
farming's water, not fishing's: forager capacity reads `aquaticAccess`
(floodplain, river, lake, shore strip) and not the water-access index, as
W8 ruled, and a mountain stream on a desert fan is not a fishery. So
nothing a forager-only step reads has changed — the 500-step smoke hashes
are byte-identical to W12 at both grids (dev `64e16935452e6c26`, target
`217a88344bd3a6b1`), which is the check that the mechanism enters through
the crop grade and the farmer capacity alone; the solve arm, where
farming happens, moves (§4b).

## 4. Measured

### 4a. The substrate at the sites (shipped grid, no history)

Water access before → after; wheat's growing months and fit under W12's
admission rule → W13's; wheat capacity at full technique in persons/km²
under W13's admission WITHOUT the routed term → with it (so the last
column isolates the routing; the months column isolates the admission).

| site | water | months | fit | capacity |
|---|---|---|---|---|
| Aleppo (the hearth) | 0.15 → 0.31 | 10 | 0.30 → 0.32 | 3.46 → 4.33 |
| Ali Kosh | 0.12 → 0.22 | 6 | 0.30 | 2.49 → 2.78 |
| Ganj Dareh | 0.14 | 8 | 0.20 | 1.65 |
| **Sang-e Chakhmaq** | 0.02 | 6 | 0.05 | 0.14 |
| **Jeitun** | 0.02 → 0.07 | 5 | 0.04 | 0.12 → 0.13 |
| **Tepe Yahya** | 0.02 → 0.07 | 7 | 0.06 | 0.14 → 0.15 |
| **Mehrgarh** | 0.02 → 0.12 | 5 | 0.04 → 0.05 | 0.11 → 0.14 |
| Harappa | 0.02 → 0.07 | 4 (no season) | 0 | 0 |
| Mohenjo-daro | 0.74 → 1.00 | **4 → 7** | 0.00 → 0.35 | 7.12 → 11.44 (0 under W12: no season) |
| Çatalhöyük | 0.24 → 0.36 | 12 | 0.37 → 0.38 | 7.46 → 8.57 |
| Karanovo | 0.35 → 0.58 | 12 | 0.55 → 0.56 | 16.63 → 20.50 |
| Bylany | 0.25 → 0.56 | 9 | 0.38 → 0.41 | 6.57 → 9.43 |
| Elsloo | 0.27 | 12 | 0.58 | 13.55 |
| Luxor (the Nile) | 0.35 → 0.81 | **5 → 8** | 0.12 → 0.32 | 0.91 → 3.11 |
| Merv | 0.12 → 0.22 | 7 → 8 | 0.23 → 0.25 | 2.11 → 2.54 |
| Bukhara | 0.02 → 0.22 | 5 → 8 | 0.04 → 0.09 | 0.15 → 0.44 |
| Kashgar | 0.33 → 0.67 | 8 → 9 | 0.32 → 0.41 | 6.17 → 10.71 |
| Peshawar | 0.54 → 0.77 | **9 → 12** | 0.36 → 0.54 | 12.07 → 21.00 |
| Baghdad | 1.00 | 6 → 9 | 0.41 → 0.46 | 25.09 |
| Turfan | 0.02 → 0.12 | 5 | 0.03 → 0.04 | 0.09 → 0.12 |
| Lima (the Rímac) | 0.02 → 0.12 | 12 | 0.08 → 0.10 | 0.21 → 0.28 |
| Phoenix (the Salt) | 0.02 → 0.07 | 7 | 0.06 | 0.22 → 0.24 |
| Patna (the Ganges) | 0.36 → 0.66 | 5 → 8 | 0.12 → 0.24 | 4.51 → 11.01 |
| Kolkata | 0.48 | 5 | 0.11 | 2.26 |
| Nanjing | 0.48 | 9 | 0.34 | 13.22 |
| Xi'an (the Wei) | 0.20 → 0.28 | 10 | 0.20 → 0.22 | 3.12 → 3.57 |

Three things the table says. The Nile, the lower Indus, the Ganges, the
Oxus, the Tarim and the Kabul valley get their water: Luxor's wheat
capacity triples and Mohenjo-daro's goes from nothing to eleven, on the
month the floodplain admits and the strip the stream waters. The Iranian
plateau (bold) does not: its catchments are empty in the table the moisture
is drawn from (finding 3, P18). And the rain-fed sites are lifted a little
everywhere a stream crosses them (Karanovo, Bylany) and not at all where
none does (Elsloo, Ganj Dareh) — the term is a stream, not a blanket.

### 4b. The dev solve arm (the per-commit people gate)

W12 (`5bd76356`) → W13, seed 42042, `wake: "never"`, 1 CE:

| | W12 | W13 |
|---|---|---|
| people −8000 / −5000 / −3000 / −1000 / 1 CE (M) | 12.9 / 58.5 / 482 / 871 / 960 | 14.3 / **71.4** / 624 / 1,078 / 1,162 |
| band ceiling (M) | 20 / 60 / 100 / 200 / 400 | |
| fertile crescent / Nile / yellow river | −6690 / −3148 / −6641 | −6711 / −3106 / −6620 |
| Indus / Ganges / south India | −4758 / −4079 / −3484 | **−4121** (in window) / −5346 / **−4807** (out, 507 y past the grace) |
| Balkans / central Europe / Rhine / Cardial / inland | −4961 / −4177 / −3841 / −4310 / −4408 | −5017 / **−4240** (cleared) / −3911 / −4366 / −4492 |
| Mesoamerica / Andes / Sahel | −4191 / −4723 / −4485 | −4198 / −4548 / −4758 |
| front, Balkans → Rhine (km/yr) | 1.420 | 1.438 |
| density: river / rain-fed / forager | 17.77 / 9.78 / 0.09 | 20.45 / 11.62 / 0.09 |
| first caged basin | −2322 | −2875 |
| staples: south China / lower Yangtze / Ganges / Indus | rice / rice / millet / millet | **millet / millet** / rice (pass) / rice |
| wall (s) | 15.5 | 18.7 |

The manifest moved with it: 7 dev rows newly failing and acknowledged
(`population:-5000`, `arrival:south-india`, `hearth:north-china` — millet
now lights ON the lower Yangtze at −7327, 27 years past the grace, with
Sichuan second at −6116 —, `hearth:northwest-neotropics`, the two millet
staples), 3 cleared (`arrival:central-europe`, `hearth-outside:millet`,
`staple:ganges`), and every dev reason re-measured. Each new reason says
that W13 is the only simulation change since the row was last measured.
The gate passes with 63 rows, none unacknowledged, none stale.

The population overshoot grows with the capacity, as it grew with the
speed in W12: −5000 leaves its band for the first time at dev. That is
M3b's debt (mortality), and the correct reading is that a wetter world
holds more people; the water is not to be withheld to hold the curve.

### 4c. Cross-grid

At dev the strip is 0.06, at the shipped grid ~0.5; the routed term is
eight times larger per cell where the app runs than where the gate runs.
The dev gate proves the machinery, the ordering and the sign; it cannot
measure the size. The measurement that can — the shipped-grid solve arm,
`GATE_PEOPLE_SOLVE_TARGET=1` — is `v2-long`, on request, and the target
rows of the manifest (`arrival:indus:solve:target`,
`arrival:ganges:solve:target`) are annotated as not re-measured since W13
rather than refreshed by guess. The expectation from 4a is stated before
the run: the lower Indus and the Ganges move, the plateau crossing does
not, so the Indus row stays a miss until P18.

## 5. Findings surfaced, owned elsewhere

- **P18 — sub-grid orographic redistribution of the coarse precipitation**
  (data). The Earth preset's moisture is a quantile map of the 1.9°
  NCEP/NCAR precipitation, and a range narrower than a cell is smeared into
  its desert. The physical redistribution is by the fine elevation anomaly
  against the coarse cell's mean, conserving the cell's total — no place
  named, one lapse-like coefficient with a citation. Proposed in DECISIONS;
  the owner's to rule on. Until it lands the plateau rows are recorded
  misses of the input, not of the mechanism.
- **The paddy.** Finding 4: the W8 grade cannot distinguish packages on
  watered ground. The mechanism that would is a per-package response to
  STANDING water — rice is a wetland grass, wheat drowns — grounded in the
  plant, not a floodplain bonus for rice by name. Not built; recorded in
  QUESTIONS #65 for a ruling.
- **M3b.** The curve leaves its band at −5000 at dev; every wave that lifts
  capacity will push it further until mortality exists.

## What NOT to do

- **Do not lift the moisture floor or the plateau's fertility.** The row is
  a missing input (P18); raising the floor waters every desert on Earth to
  reach one.
- **Do not widen the strip to reach the Indus.** 10 km is a measured
  valley floor. The plateau sites' deficit is that nothing arrives, and a
  wider strip on an empty catchment takes nothing; on every full one it
  waters ground the channel does not command.
- **Do not read the drawn magnitude as the stream.** It is thresholded and
  it sums the desert floor; the routed field is the quantity.
- **Do not admit a month on the year's rain.** Measured and withdrawn
  (§3); it broadens every rain-fed season for nothing.
- **Do not give rice a floodplain bonus by name.** Finding 4 asks for the
  plant's water response, a mechanism; a package-specific weight on
  `floodplain` is the outcome painted on.
- **Do not run the shipped-grid arm to see the term.** Owner directive
  2026-09-03: it is `v2-long`, on request.

## Acceptance

- The routed term is nonzero only where something arrives; a wet head's
  runoff is passed on untaken; the chain is spent in order (unit).
- Rain-fed cells with no channel are byte-identical in water access
  (Elsloo, Ganj Dareh, Kolkata, Nanjing in 4a).
- Every month W12 admitted, W13 admits; the added months are warm and
  watered by the land, never by the year's rain (4a months column; the
  first draft's form withdrawn).
- Lint, tsc, unit, smoke, the byte-exact kernel parity harness, the travel
  gate, the people gate at dev with the manifest re-measured, the bench
  ratchet `--check`, the worldgen oracle (§Status).

## Rulings that stay the owner's

- **P18**, the data-side half of the Indus row.
- **The paddy** (finding 4): whether a per-package standing-water response
  is the next mechanism or the staple rows stay recorded.
- **The shipped-grid solve arm**, run on request in `v2-long`, is the only
  measurement of this wave at the grid that ships.
- P15, P16, P10, 32(d) — unchanged, not touched here.

## Status (2026-09-05)

Landed in one commit on the W12 head (`5bd76356`), in the surface-water
admission form (§3; the whole-index form was measured and withdrawn).
Verified on that form: tsc, lint (eslint and the ledger lint), unit (the
11-cell routing chain), smoke (dev `64e16935452e6c26`, target
`217a88344bd3a6b1`, byte-identical to W12 — §3 says why that is the right
answer), the byte-exact kernel parity harness (9m31s; solve, awake and
switch regimes at dev, solve and awake at target; serial wasm and 1/2/8
workers), the travel gate, the people gate at dev (63 known misses, none
unacknowledged, none stale), the bench ratchet `--check`, the worldgen
oracle (the same 37 exact / 36 accepted-cleanup / 10 data-deviation / 3
mismatch / 1 within-dmath as W12 — the runoff field is returned, not
altered), and the Chromium browser smoke (the same hashes).

No history was run. The site table (§4a) is the substrate alone; the dev
arm (§4b) is the solve regime the 2026-09-03 directive allows inside the
per-commit gate; the shipped-grid solve arm — the only measurement of this
wave's SIZE where the app runs, since the strip is eight times larger there
— is `v2-long`, on request, and the expectation for it is written down in
§4c before it runs.

Not done, and said so: the Indus target row (waits on P18, the data); the
paddy (finding 4, a ruling); the population band at −5000 (M3b).

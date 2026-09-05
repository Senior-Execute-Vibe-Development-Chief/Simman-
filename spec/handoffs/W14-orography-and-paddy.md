# W14 — The rain on the slope (P18) and the paddy

Wave 14 of the v2 rebuild. Owner directive (2026-09-05, on the W13 handoff's
list of what is next): **"2 and 4 are really the only immediate fixes"** —
P18, the sub-grid orographic redistribution of the coarse rain, and the
paddy, a per-package response to standing water — then **"do it"**. Two
mechanisms, both on the substrate side of the crop grade; no place is
named, nothing reads the calendar, nothing is lifted to reach a row. Five
constants, every one with a citation and chosen before any run; the two
findings this wave surfaces are recorded, not dialed.

## The findings this wave answers

1. **The plateau's rain is in the wrong place** (W13 finding 3, DECISIONS
   P18). The Earth preset's moisture is a quantile map of the 1.9°
   NCEP/NCAR precipitation, and a range narrower than a table cell — the
   Kopet Dag, the Alborz foot, the Sulaiman, the Makran — is averaged with
   the basin at its foot and comes back as desert. The physical remedy is to
   put each footprint's rain on the slope it fell on, conserving the
   footprint's total: no rain invented, only placed. Built (§1) — and
   measured, it does what it says on every wet range and **does not lift the
   plateau sites**, for a reason downstream of the redistribution (finding
   3). This handoff says so instead of lifting the floor.
2. **On watered ground the W8 grade is the warmth term alone** (W13 finding
   4, QUESTIONS #65). `max(rain bell, water access)` saturates for every
   package alike once the land is watered, so a floodplain grades wheat and
   rice identically; a water index that serves every package alike is not a
   paddy. The mechanism that distinguishes them is the plant's: rice is a
   wetland grass and the paddy about doubles the upland crop, wheat drowns.
   Built (§2) as a per-package response to the ground standing under water,
   which is a property of the plant and a state of the land, never a
   floodplain bonus for a package by name.
3. **P18 as built moves the wet ranges and leaves the desert plateau at the
   floor** (new). The quantile map takes each land pixel's rank in the
   observed-rain distribution to the solver's own moisture at that rank,
   floored at 0.02 — and the driest 26.3 % of land sits at that floor (raw
   annual moisture p25 = 0.020, p30 = 0.022). A ×1.5 share on a desert-range
   pixel moves it up inside the floor band and not out of it: of the 1,260
   target-grid cells with share ≥ 1.5, 117 sat at the floor before and 57
   do after; in the 33–41°N 50–72°E window 1,061 cells sat at the floor
   before and 1,064 do after. Jeitun, Sang-e Chakhmaq, Mehrgarh and Tepe
   Yahya read 0.02 → 0.02; their highest nearby range cells (share
   1.33–1.73) read 0.019–0.026 → 0.020–0.080. The Alps, the Pamir, the Tian
   Shan, the Hindu Kush and the Alborz crest, where the table cell holds
   rain to place, gain 0.1–0.25 at the crest and lose 0.05–0.15 at the foot.
   **`arrival:indus:solve:target` will not move under W14.** The miss is now
   placed at the floor band of the quantile map — a data-side finding
   (QUESTIONS #66, DECISIONS 35) — and the floor is not to be lifted to
   reach it (second cardinal rule).
4. **The seasonal river model's amplitude is flat** (new, from the paddy's
   flood term). `seasonalFlowScale` is monthly flow over the static annual
   accumulation, not mean-one (the Nile ≈ 1.0, the Ganges 0.57, the lower
   Indus 0.41), so the flood term reads it against its own twelve-month
   mean; read that way, the peak month on floodplain cells is p50 1.19 of
   the mean (p90 2.03, max 3.74) and the Nile's is 1.21, against the ~3× of
   the real pre-dam flood at Aswan (Sutcliffe & Parks 1999). So the imposed
   flood is a few hundredths on the great rivers and it is the stream term
   (§2) that carries the paddy there. A finding about the river model,
   recorded for its owner; not compensated in the paddy.

## 1. P18 — the rain on the slope (`realClimateData.js`)

Within the observation's own footprint, each land pixel is weighted by
`exp(g · Δz)` for its elevation anomaly against the footprint's land-mean
elevation, and the weights are normalised to a land mean of one over the
same footprint:

```
rad     = max(0, floor((W · 1.9 / 360 − 1) / 2))        widest odd box inside one 1.9° table cell
Δz      = clamp(elev − mean_box(land elev), ±H_w)        km, against the footprint's LAND mean
weight  = exp(g · Δz)                                    g = 0.5 /km, H_w = 2.5 km
share   = weight × landCount_box / Σ_box weight          land mean one; sea and rad 0 read 1
mm      = sampled mm × share                             before the quantile rank (Pass 1)
```

- **The gain is the windward precipitation gradient**, 0.25–1 per km on
  1,000–2,000 mm regimes (Barry 2008 ch. 4; PRISM's slope regression, Daly,
  Neilson & Phillips 1994). The footprint is aspect-blind — a lee slope is
  lifted like a windward one, the rain shadow BETWEEN table cells stays in
  the table — so the low-middle of the range, 0.5. The clamp at the vapour
  scale height (Smith & Barstad 2004; Roe 2005: 2–3 km) is where the
  column has no more water to wring out.
- **Nothing crosses the table's own resolution.** The footprint is the
  widest odd box that fits inside one table cell: zero at the reference
  grid (240 wide) and the 480-wide cross-grid proxy, where a map cell is no
  finer than about half a table cell and the correction is inert by
  construction; two at the app's Half grid (960 wide, a 5-cell 1.875° box);
  four at the v2 target grid (1800 wide, a 9-cell 1.8° box) and at 1920. So
  **the per-commit gate cannot see P18 at all** (third cardinal rule, §4c):
  the reference grid is exactly the regime where it does nothing, and the
  measurement is the target grid's, on the substrate (§4a) and, with
  history, in `v2-long`.
- **The footprint's rain is conserved to first order.** Measured land mean
  of the share 0.9988 over the target grid's 558,091 land cells; the unit
  test holds a synthetic ridge's crest above 2, its foot below 1, far land
  and the sea at 1, and the land mean within 1 %. The quantile map (Pass 2)
  is untouched: the ranking is of corrected millimetres, the mapping of
  rank to the solver's moisture is as it was, the floor is as it was.
- **Off switch, for the probe and the oracle:** `SubstrateConfig.rawRain`.
  Columns wrap and rows clamp at the poles, the lapse smoothing's own
  convention. `orographicShare` is exported so the property can be checked
  on a synthetic field; the loader calls it once per fill.

## 2. The paddy (`crop.ts`, `crop-packages.json`)

Each package carries `standingWaterResponse`, the relative change of its
monthly fit on ground standing under water: rice 1.0 (the paddy about
doubles the upland crop — Bray 1986; GRiSP 2013, irrigated ~5.4 t/ha
against rainfed lowland ~2.3 and upland ~1), the New Guinea roots 0.33
(taro's ~2× wet-over-dry gain, Kirch 1994, over one member of three),
every other package −0.35 (the middle of the 20–50 % waterlogging loss in
cereals, Setter & Waters 2003, applied as the class figure to the tubers
as well — coarse, and the data file says so). Per cell and month:

```
flowRatio = flow_m / mean₁₂(flow)                        seasonalFlowScale against its own mean
imposed   = floodplain × clamp01(flowRatio − 1)          the plain under this month's flood
stream    = min(strip, inflow × flowRatio)               what arrives can keep up to the strip wet
standing  = response ≥ 0 ? min(1, imposed + stream) : imposed
fit_m     = W8's month term × (1 + response × standing)  over the admitted months, admission unchanged
```

- **The flood is the discharge above the year's own mean**: one mean-flow's
  worth covers the plain. Because `seasonalFlowScale` is not mean-one
  (finding 4) it is read against its own twelve-month mean, so a river's
  absolute size does not read as a flood.
- **The stream is W13's routed water, kept per cell** (`_runoffInflow`: what
  arrives from upstream, in the runoff's own units, before the strip takes
  its share). One cell-runoff is taken to keep about one cell-area of paddy
  under water (Bouman et al. 2007: 1,300–1,500 mm a season, the order of a
  wet year's rain) — a unit assumption, stated as one. It is counted only by
  a wetland crop: an upland crop is hurt by the flood it cannot drain, never
  by a stream beside it, which is the asymmetry in the plant.
- **The fit is a pure multiplier of capacity** (TS and Rust read it the same
  way), so a fit above one is a paddy above the rain-fed optimum (Tonle Sap
  0.98 → 1.44). The stand, bells × fit × fertility × relief, rises with it on
  flooded native cells, so the paddy also makes the flooded wild stand
  richer — which is the right side of the hearth race to be on.
- **The admission rule is untouched.** A month counts on W13's rule; the
  paddy grades it. Nothing here says "rice" or "floodplain" in code: the
  package's number and the land's state meet in one product.

Unit-tested (`unit.test.ts`, "paddy"): a flooded cell in its flood months
raises the wetland package's fit and lowers the upland one's, a dry cell
leaves both as W13 graded them, and the stream term is counted by the
wetland package alone.

## 3. What did not change

The month admission, every bell and lag, `PEOPLE_CHANNEL_STRIP_KM`, every
access weight, the quantile map and its floor, the worldgen's runoff floor.
Nothing is saved: the share is applied inside the fill and the inflow is
derived scratch, rebuilt in `fillStaticHabitability` and listed as such for
`collect`. The awake 500-step smoke hashes are byte-identical to W13 and
W12 at both grids (dev `64e16935452e6c26`, target `217a88344bd3a6b1`):
`hashWorld` excludes the substrate and those runs are forager-only, so
nothing they read has changed — which is the check that both mechanisms
enter through the crop grade alone. The solve smoke, where farming
happens, moves (`dfe819185e26e2a1` → `f0394a5a647589b3`; the wake 81900 →
81648).

## 4. Measured

### 4a. The substrate at the sites (target grid 1800 × 900, no history)

The share, annual moisture raw → P18, water access raw → P18; then rice's
fit paddy off → on at the P18 substrate, with the other packages where they
move. Bold: the plateau sites the Indus row waits on.

| site | share | moisture | access | rice fit | others |
|---|---|---|---|---|---|
| **Jeitun** | 0.92 | 0.02 → 0.02 | 0.02 | 0 | wheat 0, sorghum 0.12 |
| **Sang-e Chakhmaq** | 1.05 | 0.02 → 0.02 | 0.02 | 0 | wheat 0.05 |
| **Mehrgarh** | 0.80 | 0.02 → 0.02 | 0.12 | 0 | wheat 0.05, sorghum 0.18 |
| **Tepe Yahya** | 1.28 | 0.02 → 0.02 | 0.07 | 0 | wheat 0.06 |
| Kopet Dag crest (2,096 m) | 1.55 | 0.019 → 0.020 | 0.13 | — | runoff 0.169 → 0.170 |
| Bukhara | 0.99 | 0.02 | 0.22 | 0.09 → 0.11 | wheat 0.09 |
| Kashgar | 0.82 | 0.33 → 0.26 | 0.67 → 0.64 | 0 | wheat 0.41 |
| Pamir above Kashgar (5,049 m) | 1.95 | 0.16 → 0.37 | — | — | runoff 0.80 → 1.21 |
| Peshawar | 0.93 | 0.54 → 0.51 | 0.77 → 0.75 | 0.33 → 0.50 | wheat 0.53 |
| Aleppo | 0.99 | 0.13 | 0.18 | 0 | wheat 0.26 |
| Mohenjo-daro | 1.01 | 0.02 | 1.00 | 0.54 → 0.80 | wheat 0.35, sorghum 0.75 → 0.74 |
| Harappa | 1.00 | 0.02 | 0.07 | 0 | sorghum 0.19 |
| Luxor | 0.93 | 0.02 | 0.81 | 0.48 → 0.72 | sorghum 0.63, wheat 0.32 |
| Uruk | 0.99 | 0.02 | 0.07 | 0 | sorghum 0.16 |
| Patna | 1.01 | 0.36 → 0.37 | 0.66 → 0.67 | 0.52 → 0.77 | wheat 0.24, sorghum 0.60 |
| Bengal | 1.00 | 0.43 | 0.70 | 0.59 → 0.81 | wheat 0.16, millet 0.62 |
| Lower Yangtze (30.5°N 119°E, off the ribbon) | 0.99 | 0.54 | 0.54 | 0.26 | wheat 0.34 |
| Dongting | 0.99 | 0.67 | 1.00 | 0.48 → 0.74 | wheat 0.60, sorghum 0.59 → 0.57 |
| South China | 0.98 | 0.63 | 0.92 | 0.57 → 0.83 | millet 0.72, wheat 0.55 |
| Tonle Sap | 0.96 | 0.68 | 1.00 | 0.98 → 1.44 | sorghum 0.99 → 0.98 |
| Xi'an | 0.76 | 0.20 → 0.15 | 0.28 → 0.21 | 0 | sorghum 0.37, millet 0.35 |
| Cologne | 0.92 | 0.31 → 0.28 | 1.00 → 0.99 | 0.19 → 0.30 | wheat 0.70 → 0.69 |
| Alps, Turin foot | 0.66 | 0.34 → 0.19 | 0.69 → 0.63 | 0.19 → 0.29 | wheat 0.46 |
| Alps crest above it (2,398 m) | 1.54 | 0.30 → 0.50 | — | — | runoff 0.56 → 0.84 |
| Andes, Cusco | 1.03 | 0.73 | 0.96 | 0 | wheat 0.66 |

Three things the table says. **P18 acts where the range is wet**: the Pamir,
the Alps, the Hindu Kush (35.3°N 68.7°E, 0.19 → 0.44), the Alborz crest
(35.9°N 52.5°E, 0.04 → 0.16) gain at the crest and their feet lose (Turin,
Kashgar, Xi'an) — the rain is placed, not invented, and the wet crest's
runoff now drains into W13's routing. **It does not touch the plateau
sites** (bold; finding 3): the whole table cell is dry, the quantile map's
floor band absorbs the share, and their water access is what W13 left it.
**The paddy grades rice above every other package exactly where ground
stands under water** — the lower Indus, the Nile strip, the Ganges, Bengal,
Dongting, south China, Tonle Sap — and nowhere else: wheat is unchanged at
every site (its months are not the flood's), the summer crops lose a
hundredth or two on flooded cells, and the lower Yangtze's centre cell, off
the ribbon, is unchanged.

Over the 3° staple boxes, the best package by summed capacity at technique
1, paddy off → on: south China New Guinea roots → rice, the Ganges tubers →
rice, the Indus sorghum → rice, the Sahel sorghum → rice, Mesoamerica New
Guinea roots → rice; the lower Yangtze stays with the New Guinea roots (rice
5.19M, wheat 5.00M, millet 3.43M — the paddy makes rice the best cereal
there, not the best package), the Nile with sorghum (0.38M; rice 0.28M,
wheat 0.19M), the loess with wheat, central Europe with the highland roots,
the Amazon margin with rice. Fit statements on the substrate — they include
climatic admission and exclude the wild range and the front — not
predictions.

### 4b. The dev solve arm (the per-commit people gate)

W13 (`2802a7ec`) → W14, seed 42042, `wake: "never"`, 1 CE. P18 is inert at
dev (zero footprint), so every move here is the paddy's alone.

| | W13 | W14 |
|---|---|---|
| people −8000 / −5000 / −3000 / −1000 / 1 CE (M) | 14.3 / 71.4 / 624 / 1,078 / 1,162 | 14.3 / 71.5 / 629 / 1,076 / 1,160 |
| fertile crescent / Nile / yellow river | −6711 / −3106 / −6620 | −6718 / −3099 / −6613 |
| Indus / Ganges / south India | −4121 / −5346 / −4807 | −4114 / −5353 / −4807 |
| Balkans / central Europe / Rhine / Cardial / inland | −5017 / −4240 / −3911 / −4366 / −4492 | −5024 / −4233 / −3904 / −4359 / −4485 |
| Mesoamerica / Andes / Sahel | −4198 / −4548 / −4758 | −4205 / −4555 / **−4842** |
| front, Balkans → Rhine (km/yr) | 1.438 | 1.420 |
| density: river / rain-fed / forager | 20.45 / 11.62 / 0.09 | 20.25 / 11.61 / 0.09 |
| first caged basin | −2875 | −2896 |
| hearths moved: Sichuan millet / 2nd sorghum / Angola roots / Orinoco tubers / Balsas maize | −6116 / −5563 / −5185 / −4800 / −3918 | −6228 / −5640 / −5206 / −4856 / −3925 |
| staples: south China / lower Yangtze / Ganges / Indus / Nile | millet / millet / rice / rice / sorghum | millet / millet / rice / rice / sorghum |
| wall (s) | 19.3 | 21.0 |

Most rows move one 84-month stride or none; the Sahel moves twelve, and the
river cells of the density ordering read a hair lower (the drowning loss on
the packages that hold the floodplains where rice is not yet present). **No
verdict changed**: the paddy is the mechanism finding 4 asked for and at 167
km cells it does not flip the lower Yangtze or south China — the ribbon is a
handful of cells there, the flood amplitude on it is flat (finding 4), and
the millet that holds the south from −7327 is not displaced where the
challenger's fit is not higher. The manifest says so on both rows, with the
target-grid fits of 4a beside it. Every dev reason was re-measured; 63 rows,
none unacknowledged, none stale, the same 63 as W13.

### 4c. Cross-grid

P18 has a footprint of zero at the reference grid and four at the target,
and the paddy's flood term is a ribbon of a few cells at 167 km and of
40,286 cells at 22 km: both mechanisms are, by construction, sized where the
app runs and not where the gate runs (third cardinal rule). The dev gate
proves the machinery and the sign; the substrate table (4a) measures both
mechanisms' size at the target grid without history; the shipped-grid solve
arm (`GATE_PEOPLE_SOLVE_TARGET=1`) is `v2-long`, on request, and the target
rows of the manifest are annotated with 4a's numbers and an expectation each
rather than refreshed by guess. The expectations, written before the run:
the Indus row does not move (finding 3); the Ganges plain's rice front is
faster and its staple row may clear from the east; the Nile stays sorghum or
takes rice on the irrigated strip, neither being wheat (the winter-crop
finding stands); the lower Yangtze stays the race it is.

## 5. Findings surfaced, owned elsewhere

- **The quantile map's floor band** (finding 3, QUESTIONS #66). The driest
  quarter of the land reads one value, so no correction of the observed rain
  inside that band reaches the solver's moisture. The band is the floor's:
  whether the mapping should carry the observed rain's own ordering inside
  it (a lower floor, or a rank-preserving map below the present one) is a
  data-side ruling for the owner — not this wave's, and not to be reached by
  lifting the floor to some value that clears the plateau.
- **The seasonal river model's amplitude** (finding 4). A pre-dam Nile
  flood is ~3× the mean at Aswan; the model reads 1.21. Its owner is the
  rivers round, not the paddy, which reads what it is given.
- **M3b.** Unchanged in kind: the curve saturates against a ceiling the
  paddy moves both ways on flooded ground.
- **W9's box-versus-range question** and **P10** — untouched.

## What NOT to do

- **Do not lift the moisture floor, the runoff floor or the plateau's
  fertility to make P18 reach the plateau.** Finding 3 is the floor band's;
  a lower floor waters every desert on Earth to reach one range. Record the
  ruling, then build it if it is given.
- **Do not raise the gain to reach the plateau.** 0.5 /km is the measured
  windward gradient; a ×1.5 share does not leave the floor band and a ×3 one
  would not either — the band, not the gain, is the wall.
- **Do not widen the footprint past the table cell.** It would move rain
  across the observation's own resolution and invent a rain shadow the
  table already carries.
- **Do not give rice a floodplain weight by name, or compensate the flat
  flood amplitude inside the paddy.** The paddy reads the land's state;
  the river model's amplitude is its own finding.
- **Do not read the dev gate as a measurement of either mechanism's size.**
  Zero footprint, a ribbon of a few cells: it is the machinery check.
- **Do not run the shipped-grid arm to see the term.** Owner directive
  2026-09-03: it is `v2-long`, on request.

## Acceptance

- The share is one at radius 0 and on the sea; a synthetic ridge's crest
  reads above 2 and its foot below 1, aspect-blind; far land reads 1; the
  land mean is within 1 % of one (unit).
- The footprint radius is 0 at 240 and 480 wide, 2 at 960, 4 at 1800 and
  1920 (unit).
- A flooded cell in its flood months raises the wetland package's fit and
  lowers the upland one's; a dry cell is graded as W13 graded it; the stream
  term is counted by the wetland package alone (unit).
- Wheat's fit is unchanged at every site of 4a; the plateau sites' water
  access is unchanged; the awake smoke hashes are byte-identical.
- Lint, tsc, unit, smoke, the byte-exact kernel parity harness, the travel
  gate, the people gate at dev with the manifest re-measured, the bench
  ratchet `--check`, the worldgen oracle, the Chromium browser smoke
  (§Status).

## Rulings that stay the owner's

- **The floor band** (finding 3): the data-side question the Indus row now
  waits on.
- **The river model's flood amplitude** (finding 4).
- **The shipped-grid solve arm**, `v2-long` on request, the only
  measurement of either mechanism with history at the grid that ships.
- P15, P16, P10, 32(d), W9 — unchanged, not touched here.

## Status (2026-09-05)

**Landed on `claude/world-sim-rebuild-decision-1umpax`, head `2802a7ec` (W13)
plus this wave.** Verified mechanically, the chain the directive allows, no
history run:

- `tsc --noEmit` 0 errors; `npm run lint` (eslint + ledger-lint) clean; `npm
  run unit` green, with the two new blocks — orography (a 9-cell box on a
  ridge: crest share 2.53, foot 0.594, land mean 1.0028 → 1 after
  normalisation; radius 0 at 240 and 480, 2 at 960, 4 at 1800) and the paddy
  (rice on flooded ground gains, wheat loses, dry ground unchanged, admission
  untouched).
- `npm run smoke`: awake hashes unchanged at dev (`64e16935452e6c26`) and
  target (`217a88344bd3a6b1`) — forager-only runs never enter the crop fit;
  the solve hash moves as it must (`f0394a5a647589b3`, wake 81648, against
  W13's `dfe819185e26e2a1` at 81900).
- kernel parity (`npm run parity`) identical across thread counts; `gate:travel`
  pass; oracle counts unchanged from W13 (37/36/10/3/1); Chromium browser
  smoke same hashes as the node run.
- `gate:people` (dev, W5 solve regime): pass, 63 rows, none unacknowledged,
  none stale, re-run after the manifest edit. Every moved value is in §4b.
- `bench --check`: passed. Honestly: the first run of the full chain failed
  the ratchet on `dev routingInitializeMilliseconds` at 92.7 ms against a
  24 ms cap — the travel router's wasm cold-init, a phase W14 does not touch
  (W13 measured it at 10.5 ms, this run at 19.3). Re-run alone it passed:
  dev tick 0.50 ms / solve 1.04 ms per year, target tick 17.3 / solve
  125.8 ms per year, substrate build 1.49 s dev / 36.9 s target with P18's
  box sums inside it. No baseline was moved.

**Not done, and not to be claimed:** the Indus target row (`arrival:indus:
solve:target`) does not move — the floor band (finding 3) is the owner's
ruling, and P18 was built not to lift it. The two dev staple misses that are
the crop fit's (south-china and lower-yangtze come out millet) are the paddy's
to move at the shipped grid, not at dev, where the runoff is one cell wide and
the rivers' flood amplitude is flat (finding 4). M3b (mortality) is next; the
shipped-grid solve arm (`GATE_PEOPLE_SOLVE_TARGET=1`, `v2-long`) is the only
measurement of either mechanism with history at the grid that ships and runs
on request only.

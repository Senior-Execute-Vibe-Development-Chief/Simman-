# W15 — The wind the rain climbed, and the paddy as husbandry

Wave 15 of the v2 rebuild. Owner directive (2026-09-05, after the W14
shipped-grid arm and the "why did what's wrong go wrong" assessment):
**"implement all"** — the two fixes that assessment named. Both are
corrections to W14's own mechanisms, not new ones, and both are changes of
CAUSE, not of value: no constant moves, no place is named, nothing reads the
calendar, and no window is widened.

## The two findings this wave answers

1. **The paddy was botany; it is husbandry.** W14 gave every package a
   `standingWaterResponse` and multiplied the monthly fit by
   `1 + response × standing`. Read at every technique, that hands the
   paddy's doubling to a WILD STAND and to a hearth's site-quality payoff —
   both of which read `packageCapacityAt(cell, package, 0)`. Nobody has
   built a bund, levelled a field or transplanted a seedling at technique
   zero. Worse, the numbers behind the positive response are themselves
   managed-flooding yields: the GRiSP irrigated ~5.4 t/ha is a bunded,
   levelled, transplanted paddy, and Kirch's wet taro is a built pondfield.
   The mechanism was crediting wild rice with the works of a rice farmer.
2. **P18 was aspect-blind.** W14 weighted each land pixel by `exp(g · Δz)`
   on its elevation anomaly against its footprint's LAND MEAN. That lifts a
   lee slope exactly as much as a windward one, which is not the upslope
   mechanism — orographic rain falls where the air CLIMBS, and which way
   that is depends on the wind. The ledger recorded the blindness as the
   reason for taking the low-middle of the gain's range: a fitted apology
   for a missing term.

## 1. The paddy is scaled by the technique that impounds it

`packageCapacityAt` now reads two fields where it read one. `_cropFit`
carries the month term with the NEGATIVE half of the response folded in;
`_standingGain` carries the positive half as a ratio to that fit, and the
capacity multiplies by `1 + technique × gain`.

```
per admitted month:  base   = warmth × max(moisture bell, water access)
                     fitSum += base × (1 + min(0, response) × standing)
                     gainSum += base × max(0, response) × standing
after the year:      fit  = fitSum / 12
                     gain = fitSum > 0 ? gainSum / fitSum : 0
capacity:            … × fit × (1 + technique × gain) × (techniqueBase + techniqueGain × technique)
```

The split is exact at both ends by construction, using no literal but 0 and
1: at technique 1 the capacity is bit-for-bit W14's, and at technique 0 it
is bit-for-bit the un-paddied one. **The negative half is physiology and
stays at every technique** — a plant drowns whether or not anyone is farming
it — so a wild stand on a flooded plain still takes the waterlogging loss.
It is only the gift that is now earned.

Mirrored in the Rust kernel with the same expression and the same field,
and the parity harness compares them on the same world.

## 2. P18 references the elevation the air climbed

`orographicShare` now takes the month's observed wind and weighs the height
each land pixel stands above the ground **one footprint half-width upwind**
along it:

```
ex = u / cos(lat)          // equirectangular: scale the zonal component…
ny = −v                    // …raster y runs south; NCEP v runs north
(ex, ny) → unit            // …then renormalise, so the bearing is exact
                           //    and the pole degenerates to zonal on its own
Δz  = clamp(elev − elev(x − rad·ex, y − rad·ny), ±H_w)
w   = exp(g · Δz)          // same gain, same vapour scale height
```

Twelve monthly shares, each with its own month's wind, so a monsoon slope is
lifted by the monsoon in the months the monsoon falls and by the winter's
wind in the months it does not. Normalisation, conservation, the footprint
radius, the sea's exemption and the quantile map are all unchanged; a dead
calm gives share 1, which is right — no slope is windward to a wind that is
not blowing. **The gain is deliberately NOT re-tuned.** Moving it to suit the
new term would be fitting the outcome; the ledger's justification changes
instead, from "the footprint is aspect-blind, so the low-middle of the
range" to the middle of the range with the aspect now modelled.

## 3. Measured — substrate only, target grid 1800 × 900, no history

### 3a. The paddy split

`fit`, `gain`, and the capacity at the wild stand's regime and a full
farmer's, at nine wetland and dryland sites:

| site | fit | gain | cap @ t=0 | cap @ t=1 |
|---|---:|---:|---:|---:|
| Yangtze (rice) | 0.216 | 0.000 | 0.80 | 3.74 |
| Ganges (rice) | 0.523 | 0.473 | 5.92 | 40.67 |
| Godavari (rice) | 0.583 | 0.255 | 6.44 | 37.71 |
| Bengal (rice) | 0.610 | 0.469 | 5.35 | 36.70 |
| Sichuan (rice) | 0.317 | 0.486 | 1.50 | 10.41 |
| Mekong (rice) | 0.979 | 0.480 | 2.95 | 20.35 |
| Levant (wheat) | 0.186 | 0.000 | 0.26 | 1.23 |
| Nile (wheat) | 0.041 | 0.000 | 0.03 | 0.15 |
| Indus (wheat) | 0.376 | 0.000 | 1.83 | 8.55 |

Every wheat row has gain 0 — a drowning package has no paddy to earn — and
its drowning is already inside `fit` at every technique (the Indus row's
flood presence is 0.190 and its fit carries the loss). **81,337 land cells
carry a rice paddy gain, mean 0.367, max 0.819.**

Because `gain = gainSum / fitSum`, W14's technique-0 capacity was exactly
`(1 + gain)` times W15's. So on those 81,337 cells the wild stand and the
hearth's site-quality payoff were reading up to **82 % more capacity than
any un-farmed ground can deliver** — at the Ganges 8.72 against 5.92, at
Bengal 7.86 against 5.35, at the Mekong 4.37 against 2.95. That is the leak
this fix closes, and it is largest exactly where the wild rice is.

### 3b. The wind reference against the aspect-blind footprint

The same eight ranges under W14 (aspect-blind) and W15 (wind-referenced),
both at the target grid, same seed, same elevation. `share` is the annual
factor applied to the sampled millimetres; `ratio` is the annual moisture
after the quantile map, against the raw table. The quantile map re-ranks
globally, so a cell's moisture depends on every other land cell's share —
which is why the honest statistic is the windward-minus-lee CONTRAST, not
either side alone.

| range (windward / lee) | elev m | W14 share | W15 share | W14 ratio | W15 ratio |
|---|---:|---:|---:|---:|---:|
| Alps N foot | 759 | 0.811 | 0.800 | 0.758 | 0.747 |
| Po plain (lee) | 101 | 0.817 | 0.720 | 0.797 | 0.670 |
| Himalaya S foot | 3876 | 1.460 | 1.508 | 1.036 | 1.090 |
| Tibet (lee) | 5212 | 1.034 | 1.034 | 1.055 | 1.059 |
| W Ghats crest | 377 | 0.950 | 0.979 | 0.989 | 1.004 |
| Deccan (lee) | 460 | 0.969 | 0.966 | 0.963 | 0.963 |
| Andes W (Chile) | 769 | 0.965 | 1.066 | 0.962 | 1.108 |
| Patagonia (lee) | 546 | 0.926 | 0.888 | 0.832 | 0.745 |
| Cascades W | 302 | 0.914 | 0.845 | 0.930 | 0.861 |
| Columbia (lee) | 325 | 0.997 | 1.009 | 1.002 | 1.021 |
| S Alps NZ W | 334 | 0.738 | 0.859 | 0.662 | 0.822 |
| Canterbury (lee) | 47 | 0.886 | 0.892 | 0.842 | 0.854 |
| Zagros SW | 1140 | 1.185 | 1.096 | 1.123 | 1.087 |
| Iran plateau (lee) | 1998 | 1.078 | 1.174 | 1.382 | 1.825 |
| Alborz N (Caspian) | 231 | 0.329 | 0.470 | 0.150 | 0.154 |
| Kavir (lee) | 817 | 1.003 | 1.005 | 1.044 | 1.062 |

Windward-minus-lee share, W14 → W15: Alps −0.006 → **+0.080**; Himalaya
+0.426 → **+0.474**; W Ghats −0.019 → **+0.013**; Andes +0.039 →
**+0.178**; S Alps NZ −0.148 → **−0.033**; Alborz −0.674 → **−0.535**;
Cascades −0.083 → −0.164; Zagros +0.107 → −0.078. **Six of the eight
ranges move toward the side reality puts the rain on, two move away.**
These eight are chosen because their asymmetry is not in dispute (the New
Zealand west coast against Canterbury is an order of magnitude in the
gauges), and none of them is named anywhere in the code.

Conservation and spread: the effective annual share over the target grid's
558,091 land cells has mean 0.9981 (a land mean of one is the constraint,
and it holds monthly and after the precipitation weighting), p1 0.711, p10
0.929, p50 1.000, p90 1.055, p99 1.327, max 2.881 — against W14's p1 0.764,
p50 0.999, p99 1.279, max 3.089. Annual moisture moves by more than 0.02 on
13.8 % of land, against W14's 12.3 %; mean |Δ| 0.0100 against 0.0086. The
wind reference redistributes slightly more and less extremely.

## 4. What this wave does NOT fix, recorded not dialed

1. **The two ranges that move the wrong way have one cause, and it is the
   wind data, not the model.** The Caspian foot and the Zagros are watered
   by barrier-normal flow — a northerly off the Caspian, a southwesterly
   ahead of Mediterranean troughs — that a 1.9° monthly climatological mean
   averages away. At a 60–90 km lookback the model then reads along-range
   flow and finds no climb. The remedy is a finer wind field or a
   slope-normal formulation, not a hand-placed exception; the Alborz foot
   sat at 0.329 under W14 too, so this wave does not create the miss, it
   moves it from −0.674 to −0.535.
2. **The Indus/plateau row is untouched.** The Iran plateau's raw annual
   moisture is 0.043 — inside the quantile map's 0.02 floor band, which
   W14's finding 3 placed the miss at. A larger share there still moves a
   cell inside the band. The floor is not lifted to reach it (W14 §3,
   QUESTIONS #66) and this wave does not revisit that ruling.
3. **The tubers' `standingWaterResponse` citation stays open.** −0.35 is
   Setter & Waters' cereal figure applied to a root crop as the class
   number. The real Llanos de Moxos was farmed on raised fields IN the
   flood, which is husbandry, and W15's split now makes that expressible —
   a positive response earned with technique — but the tubers' number is
   still the cereal one. A question for the package's citation, not for a
   constant to move.
4. **The Amazon-margin delay is not the paddy's** (W14 §6c corrected this
   wave). Measured, the drowning term costs that site 3 % of capacity and
   P18 raised the new hearth cell's quality; the site got better and lit
   later, so the delay is in the peopling of the basin and the substrate
   does not hold it. A W13-only target arm would split it.
5. **Two bugs in the ported wind sampler**, found while wiring the wind
   into P18 and left alone this wave because their blast radius is the
   travel costs and the whole procedural climate path: the southern-latitude
   bracket search and the 358–360° longitude band (QUESTIONS #68). Neither
   touches P18b, which reads the same sampler the substrate and the router
   already read, with the same u-east/v-north convention.

## 5. Verification

Mechanical, at dev, per the owner's 2026-09-03 directive — no history is run
in the development loop. `npm run wasm:build`; `tsc --noEmit`; `npm run
lint` (`constants-ledger: ok`); `tools/unit.test.ts` (the P18 block now
holds a symmetric triangular range so any asymmetry is the wind's: crest
1.245, windward foot 1.081, lee foot 0.917, mirrored to 1e-6 when the wind
reverses, land mean within 0.01 of one, share 1 in a dead calm, inert at
radius 0; the paddy block holds that the flood alone does not move rice's
`_cropFit`, that wheat gains no paddy, that rice's technique-0 capacity is
identical with and without the flood, and that wheat's technique-0 capacity
still falls); `tools/kernel-parity.ts`; `tools/smoke.ts`; `gate-people` at
dev over the W5 solve regime; `bench --check`; the worldgen oracle; and the
travel gate. The substrate probes above are substrate-only and run no
history. **The shipped-grid solve arm is `v2-long` and is offered on
request, never run unasked.**

All green on `403d8224` + this tree: lint `constants-ledger: ok`; unit
`{"orography":{"crest":1.245,"windward":1.081,"lee":0.917,"landMean":0.9961},"paddy":"ok","saveLoad":"byte-identical"}`;
parity `{"parity":"ok", … "workerCounts":[1,2,8],"wasmDmathGoldens":3}`;
smoke `{"smoke":"ok"}` with the dev hash `64e16935452e6c26`, the target
`217a88344bd3a6b1` and the solve `c3a77496f8f9bbc3` — **no re-baselining was
needed**, because the paddy split is exact at both ends by construction and
P18 is inert at dev by its zero footprint; `gate-people` pass over the dev
solve regime (63 rows, none unacknowledged, none stale); `bench --check`
pass; the worldgen oracle `{"oracle":"ok"}`, elevation exact; the travel
gate pass.

# LAND_WORKS — capacity is built, not given (2026-07)

User observation behind this: *"Mostly the theme stays — bright rivers, dark
deserts — and civilization just seems to make the whole thing brighter or
darker, never denser in one spot."* Measured and confirmed as a real
mechanism gap, then built. This doc records the reasoning and the numbers.

## The gap (why the map was a static theme)

The population field is a fill-toward-a-ceiling: `cap = fertility ×
technique-that-reached-the-tile × water access × relief`, population grows
logistically toward it and migrates into spare capacity (popField.js). The
technique field is a diffusion wave with a ratchet — it passes over land
once and never differentiates again. Consequences, both confirmed by
measurement (docs/budget-gated-expansion.md round 2 + the density probe):

- After the wave passes, density is a **pure terrain function**: two
  equal-fertility valleys are equally dense forever.
- "Civilization" can only expand the wave's mask (real, and large — governed
  land measured ~6× wilderness at equal fertility, ~17× overall) or raise
  global multipliers — the whole map brightening in step.
- Nothing ever makes ONE place denser than its terrain twin: no hotspots,
  no path dependence, no scars.

## How density actually worked (the research)

- **Boserup's intensification**: carrying capacity responds to population,
  not only the reverse. When land pressed against yield, societies invested
  labour in the land itself — irrigation, terracing, drainage, multi-crop
  rotations. Extensification first (cheaper), intensification when the
  frontier closes.
- **Land capital accumulates in place, over centuries**: Egyptian basin
  irrigation, the Mesopotamian canal grid, qanats, the Grand Canal
  hinterland, wet-rice paddies levelled and bunded over generations.
  Improved land yielded ~2-3× rain-fed (basin irrigation) and wet-rice
  systems carried 5-15× dry-farming densities — which is why the
  Ganges–Yangtze belt held roughly half of humanity on a sliver of the
  world's land.
- **Path dependence and scars**: works need maintaining hands. Mesopotamia
  after the canal system broke (salinization, the Mongol destruction)
  carried a fraction of its ancient population for centuries. Equal
  terrain, divergent histories — the difference was the capital standing in
  the land.

## The mechanism (T.LAND_WORKS, popField.js)

A persistent per-tile `worksField` (0..1, saved like devField — an integral
of history, not re-derivable):

- **BUILD** where (a) people press their current ceiling (pop/cap >
  WORKS_PRESS 0.5 — the Boserup trigger), (b) water can be led onto fields
  (static irrigability: river magnitude, floodplain, genuinely wet climate
  — paddy country irrigates from rain), and (c) the farming technique has
  reached the ground (devField). Rate ≈ 0→0.8 over ~5 centuries of
  sustained pressure on watered land.
- **EFFECT**: crop capacity ×(1 + LAND_WORKS·works). The lever is the
  physical constant — the yield multiple of fully-improved land (2 ≈ the
  historical irrigation premium). Rangeland herding untouched.
- **ROT**: staffing below ~¼ of the (improved) ceiling lets works decay on
  a ~2-century half-life — collapse leaves a visible, rebuildable scar.
- **Self-limiting and concentrating**: building raises cap → lowers
  pressure → slows building (negative feedback); the field's own
  spare-capacity migration then pulls people INTO improved basins — the
  hotspot dynamic the map lacked.

Fully local state — no clock, no named region, byte-identical at 0
(multiplier ×1 exactly; the field is never allocated).

## Measurements (480×240 seed 8817, 8000 steps, probe_works.mjs)

Density on technique-reached fertile land (dev>0.1, fert≥0.35), real
people per reference tile; works = mean level on river-adjacent vs
rain-fed reached land:

| step | baseline: med / p90 / p99 (skew) | works=2: med / p90 / p99 (skew) | works river/dry | world pop base→works |
|---|---|---|---|---|
| 2000 | 11.5k / 18.7k / 26.8k (2.3) | 12.2k / 22.1k / 37.0k (3.0) | 0.15 / 0.04 | 26.3M → 28.2M |
| 4000 | 13.5k / 21.1k / 29.3k (2.2) | 17.3k / 36.8k / 64.6k (3.7) | 0.48 / 0.14 | 31.1M → 42.2M |
| 6000 | 14.2k / 21.8k / 31.1k (2.2) | 22.9k / 51.6k / 86.4k (3.8) | 0.79 / 0.25 | 32.6M → 54.9M |
| 8000 | 14.6k / 22.6k / 32.2k (2.2) | 28.7k / 62.0k / 93.0k (3.2) | 0.95 / 0.36 | 34.0M → 65.3M |

Reading:

- **The baseline IS the user's complaint, quantified**: skew frozen at 2.2
  for six thousand steps — a static terrain theme drifting brighter.
- **Works create the hotspots**: top basins reach ~3× what terrain alone
  supports (93k vs 32k); skew rises to 3.8 as pioneer basins pull ahead,
  then eases to 3.2 as improvement generalizes down the distribution —
  the historical sequence (leaders first, followers later). River works
  saturate (~0.95) by ~5 centuries of sustained pressure; rain-fed country
  builds at a third of that pace and keeps differentiating after.
- **World population 34M → 65M by step 8000** — the real 3000→1000 BC
  band (roughly 14M → 50M) doubled through exactly this mechanism, so the
  magnitude is historically placed, not runaway.
- On the population lens the improved basins cross the amber band (75k+)
  while rain-fed belts hold teal and wilderness stays slate — civilization
  now densifies PLACES on screen.

## Addendum: the rate that made the field a capacity portrait (SETT_GROWTH)

User follow-up: *"The population field shouldn't measure carrying CAPACITY,
it should measure ACTUAL population."* Nominally it always did (popField is
people; capField is the ceiling) — but MEASURED, the distinction had
collapsed: at the shipped intrinsic rate (0.0018/tick ≈ 0.72%/yr — an
open-frontier boom rate applied everywhere, always) the field saturated to
its ceiling and stayed there:

| step | pop/cap p50 | p90 | % of inhabited land ≥0.85·cap |
|---|---|---|---|
| 1000 | 0.63 | 0.76 | 1% (the dawn — the one honest era) |
| 3000 | 0.94 | 1.02 | 72% |
| 9000 | 0.96 | 1.05 | 92% |

Every dent healed in ~50 sim-years; the "actual population" map was a
0.96× copy of the capacity map, and demographic history was invisible.
Real pre-modern natural increase: 0.04-0.1%/yr long-run average, 0.2-0.6%
in recovery; the Black Death scar took 150+ years to close.

**Fix: SETT_GROWTH 0.0018 → 0.0007 (≈0.28%/yr, the historical band).**
Measured (12k steps): pop/cap p50 0.44→0.86 across steps 1500-6000, ~20%
of land persistently below 0.7 of its (works/industry-raised) ceiling —
capacity now OUTRUNS people where history is being made, scars last
generations, and the political arc keeps its exact shape ~1.4× slower
(42 realms / claims 224 / 83 settled by 12k). A dawn-compensation arm
(DAWN 0.5) was REJECTED: the richer initial mass nucleates a 57-realm
fragment field whose biggest claim collapses to ~120 — no empire tail.

Gates at 0.0007: smoke all green; stylized 21k **all hard gates passed,
0 soft warnings** (second consecutive zero-warning run) — Zipf −0.82 /
42 cities, largest empire 9%, tail 10.5, urbanization 9.9%, fallen-polity
median ~260y, pop 89,791 — the era-dependent risk (a slower world under-
developing by 21k) did not materialize.

## Addendum 2: local demographic regimes (GROWTH_LOCAL)

User follow-up: growth was still "universal on a connected landmass" — and
the mechanism agreed: the intrinsic rate was ONE global constant; only the
Malthus term (1−p/K) modulated it, and that synchronizes (the dawn seeds
one fraction everywhere). Historically the RATE was local — differential
natural increase drove the Neolithic expansion (farmers out-bred foragers
~3-5×), and the wet-tropic disease belt cut it regardless of food.

Shipped: r_i = base × (0.35 + 1.30·devField_i) ÷ (1 + 0.35·tropicBurden_i),
lever-blended (GROWTH_LOCAL, default 1). Measured A/B (9k steps, band
growth per 1500-step window): the core band's growth is dominated by
saturation headroom + migration (nearly unchanged — an honest finding),
while the FRONTIER transforms: flat rate raced the forager band to its
thin ceiling and stalled (+47.9% → +1.2%/window); under the regime it
crawls and keeps filling (+22.4% → +11.5%) — the frontier now lags the
civilized world by millennia instead of saturating alongside it. Gates:
smoke green; stylized 21k all hard gates, 0 soft warnings (third
consecutive zero-warning run).

## Addendum 3: the landmass fluid (POP_MIGRATE)

The last uniformizer, named by the user's own phrase — population rising
"universally on a CONNECTED LAND MASS". The migration share was a hard
constant 0.06/tick (~24%/year relocating between ~reference-tile cells,
50-100× real pre-modern mobility): at that diffusion speed the connected
landmass is one fluid — local deficits topped up, local surpluses drained,
the local structure every other mechanism produces laundered away.

Instrument lesson recorded honestly: band-aggregate growth tables are
BLIND to it (tile flows net out inside any large aggregate — measured
near-identical bands at 0.06/0.01/0.005). The right instruments:

- **Saturation structure** (12k steps, 0.01 vs 0.06): land ≥0.85·cap at
  step 9000 = **13% vs 60%**; pop/cap median 0.76 vs 0.94; scar band
  (<0.7) 34% vs 22% — while world totals stay equal (49.1M vs 50.9M).
  Same growth, no longer universally distributed.
- **Scar experiment** (halve a 197-tile basin at step 4000): at 0.06 the
  wound closes by ~1000 steps; at 0.01 it is still visible at 1500 —
  half the healing pace; regional catastrophe leaves generation marks.
- **Trade-off**: peak hotspot skew eases (p99/med 59.6 → 49.5) — great
  basins and cities are partly migrant-fed, which is itself historical.

Default flipped 0.06 → 0.01. Gates: smoke green; stylized 21k all hard
gates, 0 soft warnings — the FOURTH consecutive zero-warning battery
(Zipf −0.84 / 45 cities, largest empire 8%, urbanization 10.1%).

## Addendum 4: climate-gated diffusion (DIFF_CLIM) — SHIPPED at 0.8

The technique wave crossed the Sahara at the same 1 km/yr as the Danube
plain (both are "land"), and its planetary thinning (~0.025/1000 km) let a
connected landmass converge to uniform technique — measured: hot-band and
temperate medians IDENTICAL (0.49/0.49) by step 6000 under the flat wave.
Real packages were climate-bound (crops/livestock re-adapted per band):
agriculture raced along bands and crawled across them — Diamond's axes.

Shipped: per-edge toll loss += DIFF_CLIM × (|Δtemp|+|Δmoist|), resolution-
invariant (sums to total climate distance crossed), applied to the genesis
pre-run too. Measured at 0.8: the tropics run their own later clock — no
package at step 3000 (0.00 vs temperate 0.47), narrowing over ten
millennia (0.37→0.43→0.47 vs ~0.49) as adaptation pays the toll. Gates:
smoke green; stylized 21k all hard gates, 0 soft warnings (fifth
consecutive zero-warning battery; 76 polities, Zipf −0.77/34 cities).

## Addendum 5: capacity from the food ledger (FOOD_K)

User direction: per-tile population should follow "exactly how many people
could live on this tile — how much food they can get, how much they
produce, and other national factors." The architecture had TWO parallel
food systems: the settlement economy's REAL ledger (catchment harvests
with dynamic climate, fish/herds, hierarchy grain, era productivity,
policy) and the field's abstract proxy capacity (fert × technique ×
access). Cities were already unified (urban spikes = economy beyond the
land); FOOD_K unifies the countryside: worked land's K blends toward the
settlement's land-fed s._k share, distributed over the catchment by land
quality, import share staying at the core (sums exactly to the economy's
number). Wild land keeps the subsistence formula.

Measured at 1.0 (12k probe): an honest lean-to-rich arc — the world opens
LEANER (5.6M at step 1500; primitive economies feed less than the terrain
proxy claimed) and matures RICHER (59M by 9k; routing + era productivity),
with deeper sustained unsaturation (half the world under 0.7 of ceiling at
9k) — but realm formation delayed hard early (4 realms at step 1500).

Gates at 1.0: stylized 21k **all hard gates, 0 soft warnings** (63
polities, 65 cities, pop 295,754 — the richest world on record; the
delayed dawn fully recovers) — but the SMOKE dissolve-comparison inverted
(dissolved 61 vs legacy 58 entities at the smoke seed: the leaner ledger
shrank the LEGACY arm), so 1.0 does not ship. Recorded: that gate is a
one-seed structural margin now binding default policy — worth a
re-baseline look, then revisit 1.0. **SHIPPED at 0.5**: smoke passes
(62 vs 63, thin margin noted), stylized 21k all hard gates with 1 soft
warning inside budget (Zipf −0.64 at 80 cities — the half-ledger world
urbanizes more but flatter; 1.0's slope was the better −0.77, so the gate
re-baseline → 1.0 path stands as the follow-up). Population 235k at 21k —
the ledger's richer maturity at half strength.

## Gates at LAND_WORKS=2 — SHIPPED as default

- **Smoke**: all checks passed (determinism, zero invariant violations,
  save/load roundtrip hash identity with the new persisted worksField).
- **Political cycle** (probe_cycle, 6k steps): the rolling dawn is intact —
  ramp 3→9→15→20→24, peak 285 → ~180 gentle correction, 6 polity deaths,
  no runaway, no confetti (49 realms; denser basins support a few more
  viable seats).
- **Stylized 21k steps: all hard gates passed, ZERO soft warnings** —
  first zero-warning run on record. The long-standing knowingly-shipped
  Zipf soft warning RESOLVED: urban rank-size slope −0.83 (empirical
  envelope −0.8..−1.2, 52 cities) vs −0.55 (16 cities) before — the
  differentiated dense basins feed the central-place hierarchy the real
  size gradients it lacked. Other marks: largest empire 7%, fallen-polity
  lifespan median ~603y, urbanization 10.7%, pop~development monotone
  0.92, war rates and price levels in band, final population 106,550
  (the denser agrarian world, as designed).

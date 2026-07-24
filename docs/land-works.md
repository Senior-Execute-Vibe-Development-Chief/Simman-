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

## Gates at LAND_WORKS=2 (the candidate default)

(smoke / stylized results recorded below when run)

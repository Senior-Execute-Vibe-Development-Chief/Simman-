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

## Measurements (480×240 seed 8817, 8000 steps)

(filled from probe_works.mjs / probe_cycle.mjs / gates below)

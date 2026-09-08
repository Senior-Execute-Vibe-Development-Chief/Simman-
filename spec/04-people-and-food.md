# 04 — People and food  `[FULL DETAIL]`

Layers 2–3 (milestones M2–M3). One population, food as conserved mass,
real harvest years. Almost everything here is a validated v1 mechanism
re-homed on the clean substrate — the innovation is what's *absent*: no
census copy, no bridge scalar, no second food book (R4).

## 4.1 People

- **One field.** `people[tile]` in real persons (per-real-area storage).
  Every census-like number anywhere (a community's size, a city's core, a
  realm's subjects) is a windowed sum over this field. No entity holds an
  authoritative population.
- **Growth**: logistic toward local carrying capacity; intrinsic rate
  ≈ 0.28%/yr (v1's re-grounded historical band), modulated by development
  regime (forager × ~0.35 → advanced × ~1.65 — the differential that drove
  the Neolithic expansion), disease burden (static tropical belt here;
  dynamic pools per 16), and the urban
  graveyard (density-graded excess mortality — cities grow only by
  in-migration; v1's URBAN_GAMMA law, ported).
- **Migration**: capacity-gradient diffusion, double-buffered, sub-stepped,
  resolution-invariant (v1 kernels port with their bit-identity contract).
  Rate anchored to real pre-modern mobility (v1's measured correction).
- **Carrying capacity** is derived each pass: fertility × technique reached
  (the wave) × water-access bands × relief × works × environmental stocks
  (soil fatigue, deforestation) — v1's capacity kernel, minus the FOOD_K
  entity-ledger blend (no second book to blend with).
- **Demographic events** (famine, plague, war losses, captive transfers)
  debit the field directly where they happen. Coarse age structure
  (3 cohorts: children / working / elders) rides as field fractions —
  cheap, and it powers war losses, labor supply, and post-crisis rebounds.
- **The technique wave**: farming/craft knowledge spreads over land at the
  measured ~1 km/yr, climate-tolled (axes emerge — Diamond), only ever
  rising at the field level (forgetting is an institutional phenomenon,
  05). Hearths: real Old-World pins as data + the emergent cradle scorer
  for the rest; staggered maturities by package domestication lag
  (v1-validated stack: MULTI_HEARTH, INVENT_STAGGER, CROP_BIOGEO+IRRIG_CROP
  as a pair, GROW_SEASON, millet).

## 4.2 Food

- **Conserved mass** (tonnes; 1 unit = 1 t). Sources: harvest, pasture —
  pastoral calories flow through herd stocks per 15 (grass seasonal and
  locally depletable; fodder and grain as the other feeding strategies).
  Sinks: eating (ration 3 kg/person/day-equivalent — v1's 0.003/tick per
  sim-person, re-derived in real units at v2's tick = 1.095 t/person/year),
  spoilage (W31: temperate humid base 8 %/yr × Q10^((T−10)/10) ×
  (0.25 + 0.75·wetness); at 25 °C humid ~2.8×, arid ~0.7× — 04's earlier
  "~2.5× / ~0.5×" illustration), seed corn, and losses in
  transit (the travel field's freight decay). Balance sheet asserted (R5).
- **Harvest**: per worked tile — fertility × technique × works × labor
  (only rural working-age people farm; city dwellers don't) × the year.
- **The year**: v1's validated harvest-year system ports whole — regional
  annual anomalies (AR(1), ρ=0.30, ~12° weather cells), famine *derived*
  from the tail (a p10 year on thin margins), yield-variance geography
  matching 11/12 literature regions. Volcanic forcings (03) enter here.
- **Storage** (W31): every farmed cell keeps a conserved `store` field
  (tonnes/km²) — spoil the opening stock, fill at the package's
  storability, draw the year's shortfall pooled across packages; deaths
  fall only on the uncovered excess. A community's granary (M4) is the
  sum of its cells' store (P23). The lean-year law (a settlement viable
  only where its basin survives its once-a-century year — margin
  1/(1−2.33·cv)) is **withdrawn as a founding rule**: in v2 the stationary
  fill gap is a *result* of the store's inflow against the run's draw,
  not a viability gate. Storability technique and granary construction
  remain M8 / 11.
- **Storability is political** (05's hinge): only storable, visible,
  concentrated surplus is appropriable. The crop packages carry
  storability; the fields above tag surplus with it.
- **Energy seam** (Phase-2 protection): food, fodder, and wood are logged
  as energy flows in the balance sheet from day one. Phase 1 is an organic
  economy — all energy is land flow; the Malthusian ceiling is energy
  conservation, not a mechanism. Coal later plugs into existing books.
- **Fish**: REINSTATED (DECISIONS 14d — v1's ban was a verdict on its
  broken flat-cap fishery, not on fish). The designed labor/stock fishery
  carries: per-coast-tile logistic stocks, catch = fishers × per-capita ×
  technique × abundance, depletion remembered ("the sea remembers"),
  labor drawn from the same working population as farming. Constants in
  09 (v1-grounded: Lofoten/North-Sea scale).

## 4.3 Communities (the condensation)

Where `people` is dense, **communities** condense (R8): a position, a
membership window over the field, books (food store, labor, unrest,
legitimacy-per-ruler), and identity mixes. They are the atom of the ruled
(P2) and of local food accounting. Below the bar, population is countryside
texture; rendered villages at zoom are deterministic materializations, not
objects. Dissolution is symmetric (fall below the bar → books fold back
into the field). Towns/cities are communities whose non-farming share and
density cross further bars — labels derived, never capability-granting
(v1's hardest-won register rule).

## 4.4 Reality tables (gate M2–M3)

| Quantity | Target | Source |
|---|---|---|
| World population curve shape, YD → early modern | inside envelope; ~4–6M at 10k BCE → ~400–500M at 1500 CE scale-check | HYDE, McEvedy & Jones |
| Regional density ordering & magnitudes at matched development | river valleys ≫ rainfed ≫ steppe/forest; Egypt ~180/km² valley at classical | literature (research/01 §3) |
| Farming arrival dates by region | wave ~1 km/yr from real hearths; spread order matches archaeology | Ammerman–Cavalli-Sforza tradition |
| Yield anchors | Neolithic→classical 3–6× per-area | research/01 §3 |
| Famine frequency by region | famine years per millennium of farmed years: England 3–30 (a national harvest a third short one year in thirty to three hundred), the Aegean 30–150, the Nile 20–80, the Deccan interior 20–100, the North China Plain 40–150, the Sahel 50–200 | the regional famine chronologies (Campbell & Ó Gráda 2011, Hoskins 1964/1968; Gallant 1991, Garnsey 1988; Hassan 1981, Allouche 1994; Famine Commission 1880, Bhatia 1967; Deng 1937, Yao 1942, Will 1990; Cissoko 1968, Watts 1983) — `v2/data/reality/famine-frequency.json`, W30. The earlier "England ~2/millennium" was v1's own output (research/03), not a datum, and is withdrawn |
| Urban share (once towns exist) | 3–8% pre-industrial band | standard estimates |
| Granary practice | cities hold 2–4× subsistence minimum; severity per labelled famine year England 1–6 %, Deccan / North China 1–8 %, Sahel 0.5–8 %; run share of famine deaths ≥ 0.5; fill-by-CV quartile ordered high below low | granary literature; chronologies' mortality estimates (`v2/data/reality/famine-severity.json`, W31) |
| Conservation | zero unexplained flux, every audit tick (`people` and `food` sheets) | R5 |

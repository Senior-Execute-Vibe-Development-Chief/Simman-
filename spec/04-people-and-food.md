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
  sim-person, re-derived in real units at v2's tick), spoilage
  (climate-scaled: hot-wet ~2.5×, hot-dry ~0.5×), seed corn, and losses in
  transit (the travel field's freight decay). Balance sheet asserted (R5).
- **Harvest**: per worked tile — fertility × technique × works × labor
  (only rural working-age people farm; city dwellers don't) × the year.
- **The year**: v1's validated harvest-year system ports whole — regional
  annual anomalies (AR(1), ρ=0.30, ~12° weather cells), famine *derived*
  from the tail (a p10 year on thin margins), yield-variance geography
  matching 11/12 literature regions. Volcanic forcings (03) enter here.
- **Storage**: granaries as community/center stocks with capacity from
  storability tech and construction; the lean-year law (a settlement is
  only viable where its basin survives its own once-a-century year —
  margin 1/(1−2.33·cv)) ports as the founding-viability rule.
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
| Famine frequency by region | England ~2/millennium; Sahel chronic; Nile flood-regime | v1-validated bands |
| Urban share (once towns exist) | 3–8% pre-industrial band | standard estimates |
| Granary practice | cities hold 2–4× subsistence minimum | granary literature |
| Conservation | zero unexplained flux, every audit tick | R5 |

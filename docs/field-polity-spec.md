# Spec — Field polity: countries live on the MAP; settlements are contents

Status: v1 IMPLEMENTED behind `T.FIELD_POLITY` (see bottom for what v1 covers).

## Directive

Settlements stop being the ATOMS of the political layer. Cities and trade remain —
but a country's expansion, extent, and territorial dynamics no longer operate
settlement-to-settlement. The map field is the political ontology; settlements are
dressing that stands ON territory and inherits its flag.

## Why (the accumulated evidence)

docs/country-count-size-diagnosis.md, five rounds of it: every political behavior
was ultimately quantized by settlement granularity, because ONE entity type carried
three resolutions at once — demographic, economic, and political. The measured
tells: country count arithmetically capped by settled count ÷ realm membership;
the territorial atom (one settlement's claim bubble) ≈ 1-2M km²; the reach
subsystem dormant because per-seed basins pinned at a floor; sovereignty starved
through the city-label bottleneck. Each was fixed as far as the atom allowed; the
atom itself was the residual complaint ("still too big").

## The inversion

OLD: `s.countryId` is authored by political events (adoption, absorption, capture,
secession move SETTLEMENTS); `_countryOwner` is derived from the members each pass
(seeded Voronoi + persistence merge).

NEW (`T.FIELD_POLITY=1`): **`world._countryOwner` is the authored, persistent
political state** (already serialized in saves). Political events move TILES.
`s.countryId` is DERIVED: a settlement belongs to whoever owns the ground under it.

## The dynamics, re-keyed to the field

1. **Birth** — unchanged gates (nucleation/founding, ORG_STATE_MIN, statecraft
   symmetry). A founding seeds the polity with a small COST-LIMITED basin of tiles
   around the seat (the day-one chiefdom core), then it lives as territory.
2. **Expansion = frontier growth, not Voronoi.** Each territory pass a polity
   spends a TILE BUDGET on the cheapest tiles adjacent to its own frontier —
   priced by the same zero-/tech-aware edge-cost field as everything else (relief
   walls, deserts, seas gate it naturally). Path-dependent (growth happens where
   the land lets it), and capacity-limited: a polity at/over its admin budget
   stops expanding instead of projecting a bubble. Replaces the per-settlement
   seeded claim Voronoi entirely under the lever.
   - Budget: `EXPAND_RATE × max(0, capacity − load)` tiles per pass, spent
     cheapest-first with the organic-border noise retained. Physical meaning:
     integration of new land consumes spare administrative capacity; an
     over-stretched state cannot annex wilderness.
3. **War** — already field-based (armies.js front advance captures tiles with
   hold clocks; storms take cities). Under the lever, captured tiles ARE the
   transfer; the settlements on them re-derive their flag.
4. **Capacity / load** — same Tilly stack (conquest.js), with membership DERIVED
   from the field each rebuild: `c.members` = settled settlements standing on the
   polity's tiles. Capacity math, loyalty, momentum, duress all carry over
   unchanged — they just read a membership that follows the map instead of
   authoring it.
5. **Secession / shedding** (v1 semantics): the existing member-keyed machinery
   (shedPatch, governors, rebels) continues to run on the derived members; when a
   breakaway fires, it now transfers the REGION — the seceding members' tiles
   flip to the successor id in the field (snapClaim already does this), and
   derivation keeps everything consistent.
6. **Settlement roles kept** (the "dressing"): population, economy, trade,
   knowledge, courts (a polity's capital is its strongest urban member; dynasty/
   chronicle unchanged), tax sources, army bases, culture/faith/language mixes.
   Roles removed: claim seeds, adoption targets, membership atoms.

## What deliberately does NOT change in v1

- The per-settlement ECONOMIC catchment (`_territoryOwner`, territory.js) — the
  worked-land layer is economy, not politics.
- Army movement/combat, dynasties, faith/culture, trade graphs.
- State birth still requires a settlement seat (a court needs a place); virtual
  seats for court-less regions are a possible v2.
- Wilderness gap-fill / enclosed-waste cartography (runs on the field already).

## v1 lever coverage (T.FIELD_POLITY)

- `countryTerritory.js computeCountryTerritory`: under the lever, the seeded
  Voronoi + persistence merge is replaced by PERSIST + FRONTIER-GROWTH: keep the
  existing field, release marooned/dead-owner land, then grow each living
  polity's frontier by its budget. Capital recolor/borders/rendering unchanged
  (they read the field).
- `countryTerritory.js adoptAndFound`: inverted under the lever — non-sovereign
  settlements take `countryId` from the ground (stateless if wilderness).
  Founding paths unchanged (they now also seed a basin in the field).
- `conquest.js rebuildCountries`: unchanged code — membership derives naturally
  because s.countryId now follows the field.
- Persistence: `_countryOwner` already saved+loaded; the polity registry already
  persistent. No schema change.

## Calibration targets

- Early realms: day-one basin ≈ the old integMin bubble (backward-comparable).
- Expansion pace: a healthy classical realm grows O(10-50) tiles/pass at 480;
  measured against the empires probe (count, sizes, mortality all previously
  validated) — the field model must keep count ≥ and max-size ≤ the entity model.
- Gates: full stylized battery 3 seeds; smoke; roundtrip; empires probe at 480+960.

## v1 RESULTS (implemented, default ON)

Three mechanisms landed the field model:
1. **fieldPolityTerritory** (countryTerritory.js) — anchor home tiles → **stamp each
   member's economic catchment (`_territoryOwner`) into the political field** (this is
   what makes war/secession/absorption actually TRANSFER territory: every event flips
   `s.countryId`, the catchment follows it here) → release dead/marooned land →
   capacity-budgeted frontier growth into WILD only (target = `FIELD_SPAN·capacity`,
   rate `EXPAND_RATE·resScale³` for a res-invariant fill trajectory) → shed
   over-capacity marches (never worked/home land) → reused cartography.
2. **adoptAndFound inverted** — a subject derives `countryId` from `_countryOwner`
   directly (growth is already capacity-throttled, no render-crawl lag needed).
3. **Levers** — `FIELD_POLITY` (def 1), `FIELD_SPAN` (12), `EXPAND_RATE` (1.5).

Measured (480 seed 8817): realms **46** at step 20k (entity model ~19-26), 65% claimed,
top-5 13.7/9.5/9.1/8.1/7.2M km² (heavy-tailed great-power set, no continent-spanner);
war transfers territory (captured 142, annexed 30, seceded 46 over the run). At 960:
24 realms at 16k, Europe fractured into ~6-8, China/India/SE-Asia distinct.

Stylized 3 seeds: **37 polities every seed** (was 16-27), largest-empire share 10-19%
(historical band), Zipf in-envelope, area tail 4.8-11.2 — all core POLITICAL and health
gates pass (pop 169-221k, wealth finite, pop~development monotone 0.94-0.97). BUT the
suite trips **2 extra soft warnings on 2/3 seeds** (over its budget-2), all verified as
regime-SHAPE artifacts of the more-fragmented world, not bugs:
- *greatest war's share of war dead* 6-9% (many small realms → many small wars, no single
  dominant war — the gate rewards a hegemon-and-great-war regime);
- *growth accelerates with development* softer (development spreads more evenly across a
  fragmented map; total pop is healthy and monotone — not a broken economy);
- *settlement clustering* reads more uniform (the denser REGION_SPACING packing).

Smoke green; deep roundtrip byte-identical (4e943a00/2367a388); `FIELD_POLITY=0` recovers
the entity model byte-identically (hashbase 7a3afd73/7e8d33f), so the fully-validated
legacy layer is one lever away.

## Post-implementation review (14-agent adversarial workflow) — 6 confirmed, all fixed

1-2, 4 (MAJOR): the connectivity release (step 3) was 4-connected while the catchment
   stamp and frontier growth are 8-connected, and it did not pin worked land — so a tile
   attached only diagonally or across a naval hop (and any actively-WORKED catchment tile
   the economy farms across a strait) was released every pass, re-stamped, re-released:
   no fixed point at ragged coasts / diagonal borders, and the growth budget leaked
   re-claiming held ground. FIX: step 3 now floods 8-connected AND seeds from every worked
   tile (never releases worked land — matching step 6's pin).
5 (CRITICAL): a realm with no capacity yet (a newborn, or EVERY realm on the first
   territory pass after a LOAD — capacity is recomputed in updatePolities, which the load
   warm-up does not run) read target=0 and step 6 shed its entire frontier. FIX: realms
   with capacity ≤ 0 are skipped from target/grow/shed — they HOLD their stamped field
   until the next polity pass computes capacity. (Roundtrip stayed byte-identical because
   it compares the hash at load, before the first post-load territory pass; this closes
   the cold-start step-forward divergence.)
3 (MINOR): growth relaxation lowered cost[ni] even when the claiming realm's budget was
   exhausted, sterilising contested wild against a solvent competitor. FIX: cost[ni] is
   lowered only when the tile is actually claimed.
6 (MAJOR perf): step-6 shed was O(4N·overRealms) — a 4×-full-N scan nested per over-target
   realm. FIX: one O(N) sweep collecting each realm's peripheral candidates.

Post-fix: stylized 2/3 seeds pass (was 1/3 — the diagonal churn had been tripping extra
warnings); 41 realms / 66.8% claimed at 480×20k; smoke green; roundtrip byte-identical
(ff050141/cff49050); FIELD_POLITY=0 still byte-identical (7a3afd73/7e8d33f).

## Known v1 gaps (recorded, non-crashing — see the coupling survey)

- **War/secession heal via the catchment stamp, gradually not instantly.** A stormed
  city's worked hinterland transfers at the next territory pass (stamp); its far marches
  the victor must re-grow. Correct but not instantaneous.
- **`_countryCost` unpublished under the lever** → `shedFrontier.looseAt` loses its
  per-tile local-cost term (guarded, degraded not broken). Publish it for full fidelity.
- **Land-only connectivity** → a *conquered* overseas province flagged to the conqueror
  can be released (colonies use their own id, so they survive). Port the naval hop if
  same-realm overseas holdings are wanted.
- **Newborn day-one basin = 1 tile** (capless until the next polity pass populates
  capacity) — a cosmetic backward-comparability miss vs the old integMin bubble.

## Follow-up (gate recalibration for the fragmented regime)

The stylized budget-2 was calibrated on the entity (fewer-bigger) regime. The war-death-
concentration, growth-acceleration and clustering bands want re-derivation for a 37-realm
world before the field model's gate profile reads clean. Recorded, not done here.

---

# The field-simulation rewrite — people live on the LAND (T.POP_FIELD)

The field-polity above put COUNTRIES on the map but left the demographic and economic
resolution on settlement entities — so a country's extent was still quantized by a
settlement scatter (the residual "still too big"). The rewrite moves population, then
food/economy, then the settlements themselves onto per-tile fields, so a country's
extent becomes REGION DEVELOPMENT, not a settlement-to-settlement claim. Staged, each
phase behind a lever, default-off byte-identical, validated before the next.

## Phase 1 — the population field (IMPLEMENTED, `T.POP_FIELD`, default OFF)

Two per-tile fields (`src/sim/peopleSim/popField.js`):
- `world.capField[t]` = `fert[t] · CAP_PER_FERT · dev` — carrying capacity. `dev =
  DEV_BASE + DEV_TECH·leadAgri` is a GLOBAL agricultural-development multiplier read
  from the leading agriculture across settlements (emergent world STATE, never a clock);
  a later phase makes tech a field. Re-derived each step (not persisted).
- `world.popField[t]` = people on the tile. Each step: (1) recompute capacity; (2)
  LOGISTIC growth `p += POP_GROWTH·dt·p·(1−p/k)`; (3) capacity-seeking MIGRATION —
  each tile sends `POP_MIGRATE·dt·p` to its 4-neighbours weighted by their SPARE
  capacity (`cap−pop`), double-buffered so it's deterministic. People flow from
  crowded land into empty fertile land; nothing flows into zero-capacity tiles, so a
  fertile valley in a desert stays put (doesn't bleed into the sand). Carries state →
  serialized (`persist.js maps.popField`); absent when the lever never ran, so a
  default save stays byte-identical.

Seeded from the deep-ancestry wavefront (`tArrival`): long-settled cradle high, late
frontier near-empty, filled by migration — the peopling of the world as a diffusion.

Runs in `index.js` AFTER the settlement pass (reads this tick's leading agriculture),
gated on `T.POP_FIELD`; honours `SIM_GRANULARITY` dt. **Phase 1 is a passive SUBSTRATE
— nothing downstream reads it** — so it cannot perturb history: with the lever off it
never runs (byte-identical); with it on the settlement sim is untouched.

### Phase-1 validation (`tools/render_popfield.mjs`, 480×240 seed 8817 @12k)

- **pop↔fert rank ρ = 0.991** — people track carrying capacity almost perfectly.
- **45% of land empty** — deserts/tundra/dry interiors (fert ≤ 0.03 → cap ≈ 0) stay
  unpeopled; the Sahara, Arabia, central Australia, the dry interiors read dark.
- **top-decile share 19%** — DELIBERATELY not over-concentrated: capacity is fertility
  ALONE in phase 1, so the field mirrors fertility and no more. Valley-scale
  concentration (a Nile blazing through its desert relative to an equally-fertile wet
  belt) needs capacity to reward RIVERS/IRRIGATION/COAST/agglomeration — a genuine
  mechanism (irrigation carrying capacity, not a fitted constant), deferred to phase 2's
  region-capacity so each phase stays reviewable.
- Byte-identity held: hashbase `ed576254/92744c20`, deep roundtrip `ff050141/cff49050`
  both unchanged with the lever off; with it on, popField save/loads array-exact.

## Phase 2 — capacity terms + food/economy from the REGION

### 2a — real carrying-capacity terms (IMPLEMENTED, still under `T.POP_FIELD`)

Fertility alone made the field near-uniform WITHIN the fertile belts (top-decile share
19%, pop↔fert ρ 0.991 — a pure function of fert). Real land doesn't feed people by crop
suitability alone, so `capField` gained three genuine mechanisms (popField.js):
- **Water-transport premium** (multiplicative on fert): a river/coast tile can import
  food along water — irrigation, grain barges, sea trade — so it supports denser
  settlement. `reach = 1 + (ACCESS_RIVER·min(1,mag/RM_FULL) + ACCESS_COAST·coast)·(ACCESS_DEV0
  + ACCESS_DEVK·leadAgri)`. Multiplicative on fert, so it concentrates people onto FERTILE
  valleys/shores and never blooms a barren bank. The premium GROWS with development (an
  ancient valley ~doubles, an industrial port draws a continent's grain) — read from
  leading agriculture, emergent, never a clock.
- **Relief penalty**: `cap ×= 1/(1+RELIEF_PEN·relief)` — rugged land settles thin.

Each constant has independent physical meaning (a transport premium, a ruggedness loss),
none is a size fitted to a place — the great river valleys, deltas and coasts concentrate
on their own. Measured (480 seed 8817 @12k): top-decile share 19%→**24%**, pop↔fert
ρ 0.991→**0.906** (people now follow water+relief, not fert alone); river valleys read as
bright threads, coasts brighten, mountains thin. Byte-identity held (hashbase
ed576254/92744c20). Agglomeration (increasing-returns cores) deferred to 2b/3, to be
driven by the WIRED measurement (country size), not an eyeballed heatmap.

### 2b — hold-capacity draws on governed-region population (IMPLEMENTED, `T.POP_FIELD`)

First outcome-changing wire. The Tilly hold-capacity that bounds a country's territory
(`target = FIELD_SPAN·capacity`) read `settlementPower(capital)` — one capital settlement.
Under the lever the base coercive power feeding `peaceCapacity`'s log term becomes the
population the realm actually GOVERNS: `popField` summed over its owned tiles ×
capital `mil·org`, anchored to the existing median capital-power via an emergent median
(conquest.js updatePolities pre-pass). Contained — only the capacity log-term reads it;
dominance (revenue), relPow, thronePower, army/absorption keep `capPower`. Byte-identical
off (hashbase ed576254/92744c20).

**Measured (480 seed 8817 @20k, field-mode vs baseline):**

| | realms | claimed | top-5 (M km²) |
|---|---|---|---|
| baseline (field off) | 41 | 66.8% | 17.1 · 14.8 · 7.3 · 6.3 · 5.1 |
| field region-capacity | 42 | 63.5% | 12.1 · 11.3 · 10.9 · 8.6 · 5.0 |

A real but PARTIAL win: the biggest empire shrank (17.1→12.1) and the northern-Eurasia
megastate broke up, but count is flat (~42) and the upper-middle GREW (log-compression
pulls the top down and the middle up). **Diagnosis:** region population is a SUM over
tiles, so capacity still rises with AREA — a realm sprawling across sparse land keeps
accumulating capacity and stays big. The wire fixes WHERE the base power comes from but
not the sum-rewards-area failure mode. The remaining levers for "too big / too few":
- **Sparse-sprawl:** empty land must not fund its own administration — the frontier
  should stall where population thins (a growth/hold cost gated on carrying capacity that
  does NOT fully fade with logistics, unlike the current fertility-hostility term).
- **Dense-region fracture (Europe):** a broad fertile belt has no internal population
  GAPS to stop a realm, so it coalesces — needs the field's terrain-driven structure
  (relief/water gaps from 2a) to be sharp enough, plus competing-core nucleation. To be
  validated at 960 where Europe is resolved (the resolution the complaint lives at).

## THE CRUX FINDING — country size IS the catchment stamp, not capacity

After 2b landed only a partial win, a sweep isolated the real driver. `FIELD_SPAN=6`
(halving the tiles-per-capacity target) had **literally zero effect** — the run was
byte-for-byte the `FIELD_SPAN=12` baseline (top realm 22.3M km², same realms). So the
capacity target is **SLACK**: realms are under target, and neither the target nor its
source (all of 2b) governs their size. The coupling probe says why:

    step 16000: claimed=5508 | STAMPED-catchment=4654 (84%) | grown-march=854 (16%)

**84–89% of every realm's territory is the union of its members' worked food-catchments**
(`_territoryOwner`, stamped into the political field each pass, step 1b), pinned against
the shed. Only 11–16% is capacity-driven march — the only part any capacity/`FIELD_SPAN`
lever can move. So:

- Realm area ≈ member-count × catchment-area. Conquest/absorption add members → area
  grows without limit; capacity never binds.
- This is why EVERY prior size fix (reach, dominance, CAP_MODEL, region-capacity,
  `FIELD_SPAN`) had muted effect — they all move the slack 15%.
- One entity (the settlement) carries demographic + economic (catchment/food) + political
  (stamp) resolution at once; the catchment radius sets all three, so they can't be tuned
  apart. **That is the whole case for the rewrite**, now proven mechanistically.

The naive fix (delete the stamp) already FAILED once (smoke broke, realm count crashed,
churn) because the stamp also provided coverage + stability + war/secession transfer while
capacity/membership still flowed from settlements. The correct fix supplies those from the
FIELD: grow political territory from each realm's cores to cover the surrounding POPULATED
land (popField) up to its region-capacity, with no economic-catchment stamp — phase 3.

## Phase 3a — political territory decoupled from the catchment (IMPLEMENTED, `T.POP_FIELD`)

Under the lever `fieldPolityTerritory` no longer stamps each member's worked food-catchment
as political ground (the 84-89% that made size a settlement artifact). It stamps only a
small pinned CORE per member (`CORE_R`, the stability floor); the rest of the realm's extent
is grown by the capacity budget (`FIELD_SPAN·capacity`), with `POP_FILL` boosting the
per-pass fill since there is no catchment bulk to seed coverage. Deliberately NO
population-preferring growth (that would penalize low-pop steppe and break the intended big
nomad empires); terrain cost + capacity shape it. The economic catchment (`_territoryOwner`)
still feeds FOOD, unchanged. Byte-identical off (hashbase ed576254/92744c20).

**Measured (480 seed 8817 @16k) vs baseline (38 realms, 57% claimed, top-5 22.3·8.6·5.3·5.1·3.8):**

    Phase 3:  32 realms, 42.2% claimed, top-5  7.4 · 5.6 · 4.9 · 4.1 · 3.9 M km²

The runaway megastate is GONE — the top empire collapsed **22.3 → 7.4M km²** and the top-5
are a tight uniform great-power band, with the same rise/fall flows (captured 97, seceded 26,
shattered 33). The map fractures into many moderate compact realms; Europe visibly breaks up.
Removing the catchment stamp did what five rounds of capacity/reach/dominance tuning could not.

**Equilibrium (480 seed 8817 @24k)** — the concerns resolve favourably:

    step  realms  claimed   top-5 (M km²)
     16k     32    42.2%     7.4 5.6 4.9 4.1 3.9
     20k     40    47.2%
     24k     43    54.4%     8.0 7.1 6.9 6.5 6.4

Realm count RISES as the map fills (29→34→32→40→43) — MORE countries than baseline (41) with a
top empire less than half the size (8.0 vs 17.1M), a tight uniform band, and vigorous turnover
(176 captured / 68 annexed / 72 seceded / 85 shattered; top realms span ages 14.8k-24k → they
rise and fall). Coverage climbs 42→54% and is still rising — the "empty map" is transient
(gradual frontier fill from cores), not a floor. The 24k map reads as a proper political atlas:
many compact moderate realms on every continent, Europe fractured, no blob. Smoke green.

Refinement (Phase 3b): `POP_FILL` raised 6→12 so realms reach their capacity target in fewer
passes — coverage fills sooner and, at the late tech-plateau, `FIELD_SPAN` binds (size is
capped by `FIELD_SPAN·capacity`, not by how far growth got). Note `FIELD_SPAN` is a SOFT,
late-binding size lever: capacity rises with development, so the target is a moving goalpost the
growth chases through the run; it only firmly binds once tech plateaus (~24k at 480), where the
equilibrium is already the nice 43-realm/uniform band. Crisp real-time size control is a future
item (tie the target to a more stable capacity measure); the default regime is healthy as-is.

## DEFAULT-ON — POP_FIELD is now the model (def 1)

`T.POP_FIELD` flipped to default 1: the field-simulation model is the canonical sim.
Validation for the flip:
- **Stylized 3/3 seeds pass** (8817/4242/777) — all hard gates, exactly 2 soft warnings each
  (growth-accel + settlement-clustering, the same regime-shape artifacts, consistent across
  seeds). Cleaner than the pre-field default (2 soft on 2/3). largest-empire share 10%, area
  tail 5.0, pop~development 0.96, wealth finite — core health solid and MORE historical.
- **Roundtrip byte-identical** (8817=9f0ebe23, 31337=38b95edf at 8k) — field state save/loads.
- **Smoke green**; determinism + save/load self-consistent.
- **`POP_FIELD=0` recovers the pre-field settlement model byte-for-byte** (hashbase
  ed576254/92744c20, roundtrip ff050141/cff49050) — the fully-validated legacy layer is one
  lever away.
- New default hashbase: 8817=809cfa67, 31337=8da625d2.

### Perf — the field pass overhead and why striding is opt-in (`POP_FIELD_STRIDE`, def 1)

Measured (480, per tick): the field model is +0.9ms/tick (~29%) over the settlement model,
almost all of it the per-tick population-field pass. The field is a slow diffusion, so striding
it (advance every N ticks at N× the step size) cuts that ~N× — BUT the coarser dt=N Euler
integration accumulates over a 15k run into a measurably different country-size distribution:
striding by 4 flattens the empire area tail (5.0→2.7) and shifts prices, tripping the field
regime (which passes at EXACTLY 2 soft warnings, no margin) up to 3-4 → over budget, 0/3 seeds.
So `POP_FIELD_STRIDE` stays def 1 (the validated regime); it's an opt-in speed/shape trade.
A stride-independent fix (region-capacity read from the exact per-tile `capField` instead of the
integrated `popField`) would let the field stride for free — a recorded follow-up.

The dominant cost is anyway NOT the field pass: the per-settlement passes (food, population,
trade) are ~70% of the tick, and the economic CATCHMENT flood (computeTerritory) still runs for
food (cheap at 480, but the code's own profiling notes it dominates ~97% at 1920px). Making the
sim materially cheaper needs the FOOD decoupling below (drop the per-settlement catchment).

## Phase 3 — settlements become emergent LABELS on the field (planned)

Settlements stop having any physical claim: no `s.pos`-anchored territory, no
per-settlement food. They are read OUT of the pop field as the names/dynasties/culture/
trade/courts that sit on dense tiles — "abstract story and economic units, no PHYSICAL
impact." Political territory is keyed entirely to region development.

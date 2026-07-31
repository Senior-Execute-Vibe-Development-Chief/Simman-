# The early game: a self-referential size target (2026-07-31)

**Owner report:** *"Something in a code change I think during our Phase B changes,
or Phase C, the early game got entirely destroyed, with a slow start, and blobs of
nations all over being the starters. It is very bad and different."*

Reproduced at the shipped app grid, root-caused to ONE structural defect, fixed at
the mechanism. The regression is real and this document measures it against the
pre-Tier-B commit rather than arguing from memory.

---

## 1. The regression, measured

`tools/probe_blob.mjs 960 8000 500 8817` — sim grid tw=480, **the resolution the
app actually ships** (mapScale 1920 ÷ simDiv 4). Pre-Tier-B is `dc4e0e9`
(2026-07-28 07:21, the last commit before the Tier-B wave), run from a worktree
with the same probe file.

| step | year | PRE-B realms | PRE-B median realm | HEAD realms | HEAD median realm |
|---|---|---|---|---|---|
| 1000 | 5100BC | 2 | **92k km²** | 5 | 11k km² |
| 3000 | 4100BC | 1 | 11k km² | 4 | **4k km² (1 tile)** |
| 4000 | 3600BC | 1 | **80k km²** | 9 | **4k km²** |
| 5000 | 3100BC | 3 | **153k km²** | 18 | **4k km²** |
| 6000 | 2600BC | 3 | **267k km²** | 19 | **4k km²** |
| 7000 | 2100BC | 8 | **130k km²** | 19 | 23k km² |
| 8000 | 1600BC | 19 | 4k km² | 23 | 23k km² |

The owner's two words are both in that table. **"Blobs of nations all over"**: at
3100 BC the map went from *three* states averaging 150k km² to *eighteen* specks of
one tile each. **"Slow start"**: nothing on the HEAD map grows at all until roughly
step 6000, and then everything starts growing at once.

Note what did NOT change: the LARGEST realm is comparable in both (199k vs 137k at
step 5000, 275k vs 263k at 6000). The leader was never the problem. The typical
realm was.

## 2. The defect: the size target is a feedback loop with no fixed point

`countryTerritory.js`, the `T.SIZE_BY_POP` quota:

    target = govPop / RURAL_BIND_DENS        govPop = Σ popField over OWNED tiles

Write `h` for tiles held and `d` for people per held tile. Then

    target = h·d / bindDens = k·h,           k = d / bindDens

The realm's allowance is proportional to what it already holds. That has **no
interior fixed point**:

* `k > 1` — runs away upward until frontier dilution pulls `d` down.
* `k < 1` — **ratchets**. The realm sheds to `k·h`; the smaller realm has a smaller
  `govPop`; the smaller `govPop` sets a smaller target; it sheds again — all the way
  to the one-tile anchor core, and it stays there *however dense that core is*.

Measured at the app grid, seed 8817 (`tools/probe_sizeloop.mjs`, new here):

| step | governed pop | median realm | **loop gain k** | regime |
|---|---|---|---|---|
| 1000 | 10.0k | 3 t | **0.38** | ratchet → anchor |
| 2000 | 5.9k | 4 t | **0.39** | ratchet → anchor |
| 3000 | 4.6k | **1 t** | **0.37** | at the anchor |
| 4000 | 26.2k | **1 t** | **0.71** | at the anchor |
| 5000 | 118.6k | **1 t** | **1.06** | crossing |
| 6000 | 252.5k | **1 t** | **1.13** | expansion |
| 8000 | 683.2k | 6 t | **1.09** | expansion |

That is the whole shape of the owner's complaint in one column. The early world sits
just below 1 and every realm on the planet collapses to its seat; around step 6000
the world's density crosses the constant and expansion switches on **everywhere at
once**, because `k` is a near-global quantity. It reads exactly like a time gate and
it is not one — it is a bistable loop crossing its own threshold.

Corroborated independently by `tools/probe_fillaudit.mjs 960 8000 8817`:

    step 2000: heldTiles med=4 p90=6   target(load) med=2   AT_TARGET=2  Σspent=0
    step 4000: heldTiles med=1 p90=12  target(load) med=6   Σavailable=15 Σspent=0
    contact:   sharedBorderPairs=0  borderTiles=0  realmsWithLandBorder=0%
               nearest-realm BFS gap med=7-9 tiles, right through step 6000

Realms hold MORE than their target at step 2000 (they are shedding), and they are
isolated dots seven to nine tiles apart that never touch — so no fronts open, no
war transfers anything, and the map just accumulates more specks. That is the
"blobs all over" the owner sees; the count rises monotonically because nothing
consolidates.

## 3. Why no constant fixes it, and why this is a Phase-B regression

`RURAL_BIND_DENS` was already correctly re-derived once (8000 → 5500, the ×0.69
demographic rescale after B3's honest food economy). That was right and it is not
the issue. **A self-referential loop is bistable at every setting of the constant** —
moving it only moves WHERE the knife edge sits, never removes it.

It is also why the same code is empires at one resolution and dots at another. The
residual capacity gap between tw=240 and tw=480 is ~1.3×; the realm-size gap is 15×.
A knife edge is precisely the machine that turns the first number into the second.

The Phase-B connection is real but is not a single bad commit. `deffdce` (Tier-B2)
removed `world._sizePopK` — a LIVE cross-realm anchor (tiles-per-person at the median
capacity-bearing realm) that, with 1-8 realms in sample, WAS the leading cohort.
Removing it was correct: it re-sized every Stone-Age realm on the planet whenever one
distant realm reached Bronze. But it was the thing that had been holding the early
world's `k` above 1 — by accident, and by an unstable mechanism. Its removal left the
bare self-referential quota exposed, and `de97888`'s honest food economy (−43%
capacity, correctly retiring a fitted overlay) pushed the early `k` below 1. Each
change was right on its own; nothing measured the loop they were feeding.

## 4. The second circularity: statehood confiscates the village fields

`territory.js`, `T.CATCHMENT_CLIP`. The clip stops an economic catchment from
creating a border — correct, and the reason it exists. But its wilderness allowance
works only by an **accident of encoding**: a stateless settlement's `countryId` is
`-1`, the same flag unclaimed land carries, so `_countryOwner[tile] === countryId`
happens to admit wilderness *for it and only for it*. The moment that village joins a
state its `countryId` becomes `>= 0` and every wild tile it was farming fails the
same test.

So **founding a state takes away the fields at the village door.** No state has ever
done that, and the clip's own rationale does not ask for it — working wild soil
creates no border (under `TILE_POLITY` the political field is stamped from the
capital core alone, step 1b, and `_territoryOwner` is never copied into
`_countryOwner`; verified — there is exactly one write path and the catchment is not
in it).

Measured, same probe, same run — median worked tiles per settled settlement:

| step | in a state | stateless |
|---|---|---|
| 1000 | **0.75** | 28.50 |
| 2000 | **1.50** | 29.25 |
| 4000 | **0.25** | 25.25 |
| 6000 | **0.75** | 27.00 |
| 8000 | **1.75** | 25.25 |

**Statehood costs a village 97-99% of its farmland.** (The step-3000 row reads 21.5
and is a one-pass staleness transient: the catchment pass clips against the previous
pass's border, so a heavy shed shows up in `_terrTiles` one pass late.)

That accident closes the loop a second time, through the economy, because catchment
size IS the harvest (`landFood` reads the catchment's fertility sum) and under
`FOOD_K` the harvest IS the tile capacity:

    border ↓ → catchment ↓ → harvest, s._k, ledger capacity share ↓
           → popField over the realm's ground ↓ → govPop ↓ → target ↓ → border ↓

So the full chain, start to finish: a village founds a state → the clip confiscates
its fields (29 tiles → 1) → its harvest collapses → `s._k` collapses → under `FOOD_K`
the realm's OWN GROUND goes barren, because worked-land capacity IS that ledger →
`popField` over the realm's tiles collapses → `govPop` collapses → `target < held` →
the realm sheds → smaller catchment → repeat, down to one tile. Founding a state
impoverishes you until you are a single tile. That is the early game the owner is
looking at.

This is also why the earlier `SIZE_HEARTLAND` experiment measured as a dead no-op
(recorded in `resolution-collapse-2026-07-29.md`: "the capital's catchment holds
FEWER people than the realm's own tiles"). It was not a wrong idea — it was reading a
catchment that had already been clipped back to the border it was meant to be
independent of.

## 5. The fix — two levers, both cutting a circularity

Neither is a floor, a coverage minimum, or a re-tuned constant. Both change WHICH
REGION a quantity is measured over, to the region that is physically correct.

**`T.CATCH_WILD`** (`territory.js`) — a settlement works its own country's ground **or
nobody's**, never a foreign realm's. States stop confiscating their own villages'
fields; a settlement's food, population and ledger-capacity share become independent
of where the border happens to be drawn.

**`T.SIZE_WORKED`** (`countryTerritory.js`) — the size target's base is the people on
the ground the realm's own member settlements actually WORK (their catchments,
unioned with its home tiles), instead of the people inside the border it currently
holds. That region is set by where its settlements sit, how far they can haul, and
the terrain — none of which is the political border, *once `CATCH_WILD` holds*. The
physical claim: **a polity can administer the land its people farm, and it funds its
marches out of that base rather than out of the marches themselves.** Conquest still
grows the base, through the cities it takes — which is how it grew in history.

`SIZE_WORKED` needs `CATCH_WILD`: without it the worked ground is clipped back to the
border and the "independent" base is the old one again. That pairing is the whole
finding.

## 6. Measured — the app grid, seed 8817, both levers on

`tools/probe_sizeloop.mjs 960 8000 1000 8817`, against the same run at defaults:

| step | year | OFF realms | OFF median | ON realms | ON median | ON claim% (was) |
|---|---|---|---|---|---|---|
| 1000 | 5100BC | 5 | 12k km² | 10 | **24k km²** | 0.30 (0.05) |
| 3000 | 4100BC | 4 | **4k km² (1 tile)** | 16 | **64k km²** | 0.73 (0.02) |
| 4000 | 3600BC | 9 | **4k km²** | 20 | **85k km²** | 1.18 (0.07) |
| 5000 | 3100BC | 18 | **4k km²** | 22 | **108k km²** | 1.71 (0.21) |
| 6000 | 2600BC | 19 | **4k km²** | 24 | **145k km²** | 2.31 (0.42) |
| 7000 | 2100BC | 19 | 23k km² | 26 | **196k km²** | 3.20 (0.73) |
| 8000 | 1600BC | 23 | 23k km² | 28 | **193k km²** | 3.87 (1.17) |

**The one-tile phase is gone — it does not occur at any checkpoint.** The median realm
holds 60-200k km² of real ground from 4100 BC onward, on a map carrying 16-28 realms.
Against the pre-Tier-B world the owner remembers (median 80k at 3600 BC, 153k at
3100 BC, 130k at 2100 BC) the shape is restored, and restored on a *fuller* map —
twenty-plus realms instead of one to three, which is the more historical picture.

The catchment measurement inverts as it should: a settlement in a state goes from a
median of 0.25-1.75 worked tiles to **36-41**, now slightly ABOVE the stateless
median (17-20), because a state's seat is the bigger town with the longer haul and it
wins the shared ground in the catchment Voronoi.

### The signature that says the loop is actually fixed

The gain `k` in the fixed arm runs **0.14 → 0.69 and never reaches 1** — yet realms
are large and growing the whole way. Under the old model `k < 1` meant collapse to
the anchor without exception. The size no longer depends on the gain crossing a
threshold at all: it rests at the stable fixed point the out-of-border term creates.
**The knife edge is gone**, which is the point of the change — not the larger realms,
which are a consequence.

### The long horizon, and the resolution gap

`tools/probe_blob.mjs 960 20000 2500 8817` — the same instrument the previous session
used to measure the blob phase, at the app grid, with the levers on:

| step | year | realms | claim% | median realm | largest |
|---|---|---|---|---|---|
| 2500 | 4350BC | 15 | 0.47% | 15k km² | 233k km² |
| 5000 | 3100BC | 22 | 1.71% | **103k km²** | 397k km² |
| 7500 | 1850BC | 27 | 3.68% | **195k km²** | 519k km² |
| 10000 | 600BC | 32 | 5.04% | 176k km² | 939k km² |
| 12500 | 650AD | 39 | 8.90% | 206k km² | 1,855k km² |
| 15000 | 1900AD | 48 | 11.59% | 221k km² | 2,065k km² |
| 20000 | 4400AD | 48 | 15.58% | **302k km²** | **4,199k km²** |

Against the same probe on the pre-fix world (recorded in
`resolution-collapse-2026-07-29.md`: median **4k km² — one tile — from step 3000 to
step 15000**, 3.02% claimed at 20k, largest 275k km²).

This is also the resolution-gap prediction coming out. The app grid at 20k now reads
15.58% / 302k / 4,199k against the reference grid's 28.59% / 663k / 7,444k — roughly
**2× behind, where it was 15× behind on the median realm.** The knife edge was the
amplifier: it turned a ~1.3× capacity difference between the grids into a total
regime change. The underlying capacity difference is untouched and still wants
fixing; it no longer decides whether the owner's world has states in it.

## 7. The reference grid — does the mature calibration survive?

Every constant in the size model was calibrated at tw=240, so the change has to be
checked there too, out to 20,000 steps. `tools/probe_sizeloop.mjs 480 20000 2500 8817`:

| step | year | OFF realms / claim% / median | ON realms / claim% / median |
|---|---|---|---|
| 2500 | 4350BC | 3 / 0.12% / 62k km² | 11 / 0.84% / 62k km² |
| 5000 | 3100BC | 9 / 1.35% / 108k km² | 13 / 2.26% / 185k km² |
| 7500 | 1850BC | 18 / 4.46% / 247k km² | 20 / 6.27% / 386k km² |
| 10000 | 600BC | 32 / 8.92% / 200k km² | 23 / 11.21% / 494k km² |
| 12500 | 650AD | 41 / 14.90% / 247k km² | 30 / 17.83% / 632k km² |
| 15000 | 1900AD | 43 / 18.92% / 370k km² | 34 / 20.49% / 632k km² |
| 20000 | 4400AD | 47 / 25.48% / 540k km² | 35 / 28.59% / 663k km² |

Claimed land moves +12% to +25% relative — the calibration is not blown; at the
Bronze edge (~step 5000 here) it reads 2.26%, right at the 2.79% the density constant
was last ratified against. The median realm roughly doubles into the 400-650k km²
band, and the largest reaches 7.2M km² at 20k (was 4.8M) — Rome-to-Han scale.

The interesting number is **realm COUNT, which falls in the mature world: 47 → 35**
(and 41 → 30 at 650AD). Under the old model the count rose monotonically for the
whole run, because realms were dots that never touched and so never merged. With
realms large enough to share borders, the map consolidates. That is the "blobs all
over" symptom resolving through the mechanism rather than through a cap on how many
polities may exist.

## 8. Gates

Both levers shipped ON (`def: 0 -> 1`).

| suite | seed | result |
|---|---|---|
| `npm test` | — | green, 178.3s (determinism, invariants, save/load, dissolve arm) |
| `npm run validate` | 8817 | **all hard gates passed, 1 soft warning** (budget 2) |
| `npm run validate` | 31337 | **all hard gates passed, 1 soft warning** (budget 2) |

That is one soft warning BETTER than HEAD on seed 8817, which was sitting exactly at
its budget of 2. The warning it clears is the one `SPAN_TECH=0` introduced last
session — "market integration narrows prices (Δ): −0.38" now reads **+0.90 (ok)**. The
remaining warning on both seeds is the pre-existing `Zipf rank-size slope: n/a` (too
few cities over 50 urban to fit a slope).

Mature-world shape, 21k steps, unscored reference line "Bronze hegemon ~0.5-1M,
Rome ~5M, Han ~6.5M":

| | seed 8817 | seed 31337 |
|---|---|---|
| polities | 35 (was 46) | 47 (was 60) |
| largest empire's share | 17% (was 14%) | 12% (was 6%) |
| **median realm area** | **692k km²** (was 554k) | **492k km²** (was 385k) |
| largest realm | 7,444k km² (was 5,429k) | 4,137k km² (was 1,969k) |
| world population | 36,312 | 37,750 |
| empire area tail (largest/median) | 10.8 | 8.4 |

Median realm is Bronze-hegemon-scale on both seeds and the largest is Rome-to-Han
scale. Polity count falls on both — the consolidation noted in §7.

## 9. What this does NOT fix — stated plainly

* **Conquest still barely transfers anything.** The earlier measurement (1 realm→realm
  settlement transfer in 12,000 steps) was taken on a map whose realms never touched;
  they touch now, and the mature realm count falling 47→35 says *some* consolidation is
  happening. But nothing here went near the war → territory path, and the truce-cycle
  and treaty-protects-the-loser findings in `resolution-collapse-2026-07-29.md` stand
  untouched. That remains the largest open defect.
* **The residual resolution gap.** The app grid still runs ~2× behind the reference at
  equal settings; this removes the amplifier, not the underlying ~1.3× capacity
  difference (1-D coast dilution is the leading suspect, unchanged).
* **Neither lever was measured alone.** They were designed as a pair and gated as a
  pair, because `SIZE_WORKED` is a near-no-op without `CATCH_WILD` (the worked ground
  is clipped back to the border, so the out-of-border term is empty). The individual
  contribution of `CATCH_WILD` on its own — which changes the food economy without
  touching the political layer — is not measured here.
* **`PROV_FIELD`'s comment is now slightly stale** — it says a settlement's worked
  catchment is "⊆ the realm's land under CATCHMENT_CLIP", which `CATCH_WILD` relaxes to
  "⊆ the realm's land ∪ wilderness". The mechanism is unaffected (that read is
  median-anchored, so a uniform enlargement cancels), but the parenthetical is no
  longer literally true.
* **The gain `k` is still a global-ish quantity** and still rises through the run. It
  no longer decides whether realms exist, but the density constant it is measured
  against remains coupled to the sim's demographic scale — recalibrate together if the
  food model moves again, exactly as `RURAL_BIND_DENS`'s own note says.
* **States still do not spread from cradles** — a SEPARATE regression with a separate
  cause, bisected below. This fix made its count side worse, not better.

---

# THE SECOND REGRESSION: states stopped spreading from the cradles (2026-07-31)

**Owner:** *"In real life, early nations were almost entirely within a very specific
area, be it the Fertile Crescent or Yangtze, and spread from there, they did NOT spawn
across the whole area and grow independently. We had this working moderately well
before either the phase B or C or maybe even A changes."*

Correct on the symptom, and the bisect says the *cause* is none of those phases.
Instrument: `tools/probe_dawnspread.mjs` (new), which reads the claim three ways — how
far a NEW realm is born from the nearest existing one, how far every realm sits from a
genesis cradle, and what share of realms carry a people DESCENDED from a cradle people
(`cultures.js familyOf` — the root of the culture tree, which a cradle founds and every
daughter inherits).

## The bisect — 480x240, seed 8817, identical probe at every commit

| commit | when | cradle distance @2000 / @4000 | descended @2600BC |
|---|---|---|---|
| `dc4e0e9` Tier-A recorded | 07-28 07:21 | **0.0 / 0.0** | 50% |
| `19bd402` end of Phase B | 07-28 16:33 | **0.0 / 0.0** | 40% |
| `bd12940` end of Phase C | 07-29 17:45 | **0.0 / 0.0** | 40% |
| `2fef4f6` ORG_PRESSURE added | 07-30 09:54 | **0.0 / 0.0** | 40% |
| **`5d4ace3` ORG_BIRTH_VAR added + both dawn levers flipped on** | **07-30 10:13** | **8.6 / 8.5** | **23%** |
| `09fdd3a` last commit on main | 07-30 15:13 | 8.6 / 8.5 | 25% |

**Phase A, B and C are innocent on this measure.** Phase C is byte-identical to
end-of-Phase-B on every row (it shipped everything default-off, as labelled), and
Phase B if anything concentrated the dawn slightly (8 realms → 5 at step 6000). Median
distance from a cradle was **0.0 tiles** — the first states sat literally ON the cradle
tiles, 100% of them cradle-descended — right up to one commit at 07-30 10:13, which
was part of the FIX WAVE for the previous session's blob complaint.

Two directions of evidence agree, and they clear the other lever in the same commit:

| arm at HEAD | realms @1000 | cradle distance | descended |
|---|---|---|---|
| default | 12 | 7.2 | 58% |
| `ORG_PRESSURE=0` | 12 | 7.2 | 58% — **no effect** |
| `ORG_BIRTH_VAR=0` | 4 | **0.0** | **100%** — full restore |

## The mechanism, in arithmetic

    birthOrgAt = 0.1 × (1 + ORG_BIRTH_VAR · confinement · fertility)

At `ORG_BIRTH_VAR = 1` that ranges 0.1–0.2, and `ORG_STATE_MIN` is **0.15**. Any site
where `confinement × fertility > 0.5` is **born already above the statehood bar** —
a state at tick one, with no development, no learning and no time. Evaluated over the
map (seed 8817, 9,616 land tiles):

| lever | tiles born AT OR ABOVE the statehood bar |
|---|---|
| `ORG_BIRTH_VAR=0` | 0 (0.00%) |
| `ORG_BIRTH_VAR=1` | **622 (6.47%)** |

**Correction to a claim made earlier in this session:** I asserted that confinement is
low on the cradles' open floodplains, so the lever pushed the dawn away from them. That
is wrong — the cradles score HIGH: Nile 0.1699, Mesopotamia 0.1508, Indus 0.1608
(Yellow River 0.1229), against the 0.15 bar. The lever does not disadvantage the
cradles. It grants the same instant statehood to 6.5% of all land, so the cradles stop
being SPECIAL — which is why states appear scattered instead of at four rivers.

This is also the second cardinal rule in miniature: the lever was aimed at a real
defect (the synchronised dawn — a uniform initial condition plus a uniform rate makes
any threshold a global switch) and cured it by handing out the ANSWER at birth,
according to a site-quality formula, rather than building the mechanism that would
produce it.

## The mechanism that is actually missing

**Organisation has no diffusion term at all.** `k.organization` grows by

    LEARN_BASE × sciMul × orgClim × orgHead × (...) × aptLearn × confineMul
              × rulerLearn × pressMul

— every factor a property of the settlement's OWN site. There is no term for the
organisation of neighbours, trade partners, or a threatening state next door.
Agriculture diffuses (the `devField` wave, `T.DIFF_CLIM`, at a measured ~1 km/year);
statecraft does not. So every qualifying site invents the state independently, by
construction, and the map fills with parallel origins.

History runs the other way round: primary state formation happened perhaps six to
eight times; everything else is SECONDARY — a response to contact with an existing
state, through trade, emulation, or the threat of being conquered by one. Build that
term and the dawn ROLLS outward from wherever statehood first arose (which will be the
best sites — the cradles), which is both what the owner describes and a real cure for
the synchronised dawn, instead of a trade of one symptom for the other.

## Status

**NOT FIXED — awaiting the owner's call on approach.** Three options, all measured or
scoped, none applied; `ORG_BIRTH_VAR` remains at its shipped default of 1:

1. `ORG_BIRTH_VAR = 0` — one line, measured on both sides, restores the cradle dawn
   exactly. Cost: the synchronised dawn it was built to cure comes back.
2. Build the diffusion term (above). Bigger, and fixes both.
3. Bound birth organisation structurally below `ORG_STATE_MIN` — a founding village is
   not a state by definition, so site variation differentiates the START without
   handing out the answer. Keeps a rolling dawn; unmeasured whether it re-centres on
   the cradles.

---

# THE THIRD REGRESSION: routine shedding mints nations (`T.SUCCESSOR_STATES`, 2026-07-31)

The owner ran the builds. **`dc4e0e9` is the last commit that looks right**, which puts
the break INSIDE Phase B — and then pointed at the one commit in that window nobody
had examined: `b859db7` (12:09, "The political fabric re-knits"), which ships
`T.SUCCESSOR_STATES` at default 1.

## Why it was invisible

Every measurement in that commit, and every number in the lever's own description, was
taken at **480x240 (tw=240)**. Its commit message records the result plainly:

> "polity.seceded 0 -> 0 at this horizon: every orphaned patch was a single entity ...
> which the >=2 rule correctly lapses ... the channels are live but atom-starved."

At the reference grid an orphaned patch holds ONE settlement, so the anti-confetti
"≥2 members" rule lapses it and the successor channel never fires. **At the shipped app
grid (tw=480) the same real patch holds several settlements**, so the identical rule
fires constantly. The lever was validated in exactly the regime where it does nothing.

## Measured — app grid, seed 8817, this branch, only the lever differing

| step | OFF: realms / median realm | ON (shipped): realms / median | `polity.receded` |
|---|---|---|---|
| 2000 | **4** / **12 tiles** | 14 / **3 tiles** | 0 → **15** |
| 4000 | **9** / **31 tiles** | 22 / 21 tiles | 0 → **15** |
| 6000 | **16** / **63 tiles** | 25 / 36 tiles | 0 → 3 |
| 8000 | **21** / **55 tiles** | 28 / 48 tiles | 0 → 6 |

`settlement.lapsed` runs 0 in every window OFF, and 2/7/3/6 ON. Claimed land at step
8000 is nearly identical (3.72% vs 3.87%) — **the same ground, carved into far more and
far smaller nations.** Fifteen recessions in the first 2000 steps of a world that holds
four realms.

## The category error

`resolveOrphanedMarches` fires on any settled member standing on ground its realm no
longer holds. But `world._fpRel` is filled by TWO different events in
`fieldPolityTerritory`:

* **step 3, the connectivity release** — a march severed from its capital. A genuine
  loss of grip; a successor state here is right (the Diadochi case the design names).
* **step 6, the over-capacity shed** — the border trimming itself back one ring toward
  its administrative target. This happens EVERY PASS to any realm above target, and it
  is not a political event at all; it is the frontier breathing.

The channel does not distinguish them, so every routine frontier adjustment is read as
a secession and mints a statelet. That is what "blobs of nations all over" is.

It also compounds with the size loop of §2: shed → orphaned members → successor minted
→ the successor is small → it sheds → more successors. And it got WORSE with this
session's size fix, not better (recessions 6 → 15 in the first window), because larger
realms hold more members for a shed to orphan — which is why the size fix alone did not
restore the owner's early game.

## The fix, when it is built

Not "turn the lever off" — restoration from the ground and Diadochi successors are both
right, and the witnessed-lapse logging closed a real silent channel. The fix is to
separate the two release causes, which the code already tracks separately: a shed march
secedes only when the parent actually lost GRIP (connectivity severed, or a collapse in
capacity), and an ordinary over-target trim lapses to wilderness the way a receding
frontier should. No new constants; the distinction is already in the pass.

## Status

**NOT FIXED — no default changed.** Diagnostic build handed to the owner
(`sizefix + SUCCESSOR_STATES=0`) to confirm by eye before anything is shipped.

## The process finding, again

This is the third instance in two sessions of the same blind spot, and now the clearest:
a mechanism gated, measured and shipped entirely at tw=240, whose behaviour at the
shipped grid is not a matter of degree but of KIND — inert at one resolution, dominant
at the other. `docs/resolution-collapse-2026-07-29.md` §6 already asked for one
app-grid arm per wave. This is what it costs when that does not happen.


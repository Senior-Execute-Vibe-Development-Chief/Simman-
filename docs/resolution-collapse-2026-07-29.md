# The app-grid collapse: realms frozen at their anchor core (2026-07-29)

**Owner report, playing the sim:** "still doing the tiny blob nations thing, not
expanding at all mostly." Confirmed, reproduced, and root-caused to a
resolution-invariance break — with one candidate mechanism measured and
REFUTED. Recorded before fixing so the next pass starts from evidence.

## 1. The symptom, at the resolution the app actually runs

`tools/probe_growtraj.mjs 960 12000 8817` (sim grid tw=480 — the shipped app
grid; every battery in the Tier-A/B/C work ran at tw=240):

    step  2000: realms= 2  claimed=0.02%  max=4t (15k km²)  med=3
    step  6000: realms= 2  claimed=0.02%  max=4t            med=3
    step 12000: realms=23  claimed=0.09%  max=4t (15k km²)  med=1

**The largest realm on the planet is frozen at 4 tiles for 10,000 steps.** New
realms appear; none ever grows. Same world at tw=240: max 41 tiles / 631k km²,
claimed 2.79%. A **42× real-area discrepancy**, against the ~2.5×-at-equal-
development the fill audit had recorded.

`tools/probe_fillaudit.mjs 960 12000 8817` names the binding term: `AT_TARGET`
dominates with `RATE_LIM=0` and `target(load) med=2 p90=2 max=3` — growth is not
throttled, the TARGET is simply ~2 load units. Realms believe they are already
as large as they can afford.

## 2. Why the target collapses: the size loop is a knife edge

`target = govPop · spanTechMul · r2 / RURAL_BIND_DENS` and `govPop = Σ popField
over OWNED tiles`. So tiles → people → target → tiles: self-referential, with no
stable interior equilibrium. Writing d for people per tile, the loop grows iff
`d · spanTechMul · r2 / DENS > 1` and otherwise **collapses to the anchor core**.
At tw=240 that ratio computes to ≈1.16 (grows); the app grid's missing
population drops it to ≈0.53 (collapses). Same code, same constants, opposite
behaviour — decided by a population discrepancy. NB the pre-SIZE_BY_POP model
carried a COVER_BASE/COVER_ORG floor that made this mode unreachable; removing
the floor is what exposed it.

## 3. The population discrepancy is in CAPACITY, not in the demography

`tools/probe_popinv.mjs` at step 6000, seed 8817:

| grid | land tiles | Σpop | Σcap | pop/cap | meanDev |
|---|---|---|---|---|---|
| tw=240 | 9,616 | 4.78M | **7.51M** | 0.636 | 0.183 |
| tw=480 | 38,741 | 2.19M | **3.38M** | 0.647 | 0.159 |

`pop/cap` matches to 2% — growth and migration are invariant; the field fills to
the same FRACTION of capacity. There is simply **2.2× less capacity** at the
finer grid. popField stores people per REAL area (`capPerFert = CAP_PER_FERT/rn²`),
so world totals should match and do not.

## 4. Measured contributors — and the one that is NOT the answer

Terrain-field means over land, same seed, three grids:

| field | tw=240 | tw=480 | tw=960 | kind |
|---|---|---|---|---|
| moisture | 0.2950 | 0.2846 | 0.2837 | area field — INVARIANT ✓ |
| fertility | 0.2945 | 0.2620 | 0.2485 | −11%, −16% |
| **riverMag** | **0.7347** | **0.3802** | **0.1986** | halves per doubling |
| **coast** | **0.1555** | **0.0972** | **0.0601** | halves per doubling |
| relief | 0.0737 | 0.0484 | 0.0300 | falls (raises cap — wrong sign for the gap) |

Rivers and coasts are ONE-DIMENSIONAL features on a 2-D grid: the same real
river covers 2× more tiles at 2× resolution while the map has 4× more tiles, so
their per-tile share halves every step. Moisture holding flat proves the class.
Capacity multiplies in a per-tile water-transport premium, so that premium's
contribution to world capacity dilutes as 1/rn.

**REFUTED as the dominant cause.** Restoring the premium's real-area integral
(scaling access by rNormPop, threaded through the worker header so the banded
path saw it too) moved Σcap at tw=480 by **nothing** — 3.38M before and after,
byte-identical at the reference as designed. The dilution is real but the
premium is too small a term to account for 2.2×. The change was REVERTED rather
than shipped unvalidated; the probes are committed.

## 4b. Owner's second observation, and what it rules out

**"They simply don't grow early game, then at a later point they start growing."**
A THRESHOLD, not a permanent freeze — and it matches the loop algebra exactly.
With k = d·spanTechMul·r2/DENS, the target is k·held: k<1 shrinks the realm,
which shrinks its base, which shrinks the target (runaway collapse to the anchor
core); k>1 runs away upward until frontier density falls. Early spanTechMul is
low, so k<1 map-wide and NOTHING grows; accumulated statecraft eventually tips k
past 1 and expansion switches on all at once. The bistability is the bug, and it
is present at every grid — resolution only moves WHEN the crossing happens.

Three fixes were implemented and measured against the app grid this pass:

1. **Water-premium integral** (popField): REFUTED, §4 — Σcap unmoved.
2. **Heartland floor** (target base = max(govPop, capital-catchment pop), so the
   base does not depend on current borders): moved claimed% 0.05→0.06 at step
   8000. Real but negligible; early catchment population is small and
   spanTechMul is low, so the target stays ~1-2 load units either way. REVERTED
   as unvalidated, but the reasoning stands and it belongs in the real fix.
3. **Growth-gate unit mismatch** (`countryTerritory.js` line 762): CONFIRMED and
   SHIPPED. `RURAL_BIND_DENS` is people per REFERENCE tile; `pfM[ti]` is people
   per SIM tile. The target converts (`/r2`); the marginal-tile gate did not, so
   off-reference it demanded r2× the density the target budgeted for — 98 of
   38,721 wild tiles admissible at the app grid. A genuine unit bug, byte-
   identical at the reference. It did NOT unfreeze the map on its own.

**Why (3) alone doesn't fix it, and where the next pass must start:** the audit's
budget line is the tell — at step 8000 `Σavailable=0`. Early realms have NO
growth budget, so the admissibility gate is never consulted; making tiles
admissible cannot help until a budget exists. `target ≤ held` is the binding
constraint, and that is the self-referential loop of §2, not any gate. **Fix the
loop first** (a holdings-independent base — §2 and item 2 above — or replace the
Σ-budget with a purely LOCAL per-tile admissibility rule, which is what the
code's own comment already claims it does and would be inherently non-bistable).
Re-measure the gate fix afterwards: it should matter once budgets are non-zero.

## 5. Where the next pass should look

For the CAPACITY gap of §3 specifically (separate from the loop above),
remaining candidates, in order of suspicion, none yet measured:
1. **FOOD_K** — on worked land capacity blends toward the settlement food
   LEDGER, and the ledger is per-ENTITY. Entity count is ~90 at BOTH grids
   (the Tier-C W4 pin), so ledger-fed capacity is spread over 4× more tiles at
   tw=480 while its total barely moves. This is the strongest candidate: it
   couples the entity-count pin directly into carrying capacity.
2. **devField lag** (0.183 → 0.159): the technique wave advances per TILE-hop;
   verify the "~1 km/year at any grid" invariance claim empirically.
3. **fert max-pooling** to sim tiles (−11%): coarse grids take the max over a
   larger block, inflating the reference.
4. **LAND_WORKS / irrigation** accumulation, per-tile with a real-distance
   meaning.

## 6. The process finding

Every battery in this session ran at tw=240. A defect that freezes the entire
political map at the shipped resolution was invisible to all of them, and was
found by the owner looking at the map. **The shipped grid belongs in the
validation loop** — at minimum one lean app-grid arm per wave, plus the
`Σcap`/`Σpop` invariance check above as a standing gate. This is the same
blind-spot class as the fish share (no food-composition gate) and the size
constant (all empire gates are ratios, blind to absolute area).


---

# The two failure modes share one missing term (2026-07-30)

Investigating whether the control field could replace the budget, prompted by the
owner asking how steps 5/6/7 compare to real states.

## What is actually there

`controlField.js` implements political control as a per-tile FIELD: pinned at each
capital at a strength set by its power, propagating one hop per tick, decaying with
distance, resisted by relief, bled by desert and jungle, checked by great rivers,
crossing open sea only for a nation with navigation. Border = argmax control.

**It is render-only.** `T.CONTROL_FIELD` (def 1) DRAWS the political map; the
tuning entry is explicit that "the sim's authoritative `_countryOwner` ... is
untouched and byte-identical — this only changes how borders LOOK."

**`CTRL_LIVE` — the field AUTHORING the map — was tried and REMOVED (2026-07),
not merely switched off.** The publish block, the `_warFront`/`_warAdv` field-war
coupling in armies.js, and the field-hold loyalty read in conquest.js are all
deleted or bound dead. Measured verdict (default-flip campaign, wave 3):

| lever @12k | countries | pop | verdict |
|---|---|---|---|
| `CTRL_LIVE=1` | **8** | 44.7k | "the world-breaker" — runaway consolidation + unpersisted-field load divergence → REMOVED |

Eight countries on the planet, against ~50-65 for the other levers in the same
sweep.

## The insight: both models fail from the SAME missing physics

- **Budget model (live today):** a size target = f(people already governed).
  Self-referential, hard-capped. Bistable → below break-even it COLLAPSES to the
  anchor core (§2 — the owner-reported early-game freeze).
- **Field model (removed):** control strength ∝ power, and power grows with
  territory. Self-reinforcing with NO cap → RUNAWAY to 8 mega-empires.

Same feedback, opposite clipping. Both let a state's projection grow with its
holdings; one bolts a ceiling on top (bistable), the other has none (runaway).

**The term neither has: administrative DILUTION.** A state's apparatus is finite
and gets spread thinner the more ground it covers. Hold per tile should be
`control output ÷ (extent already held, distance-weighted)`, not a strength
independent of extent. Making the projected quantity CONSERVED changes the
character of the system rather than clipping it:

- a small state projects intensely over a small area; a large one weakly over a
  large area — so the border settles where two dilutions balance. A stable
  interior equilibrium exists, which is exactly what neither model has;
- overextension produces thin hold EVERYWHERE, so an over-large empire is
  fragile and rivals press in — rise and fall for free, no secession timer;
- hold is graduated, which is the raw material for vassals / tributaries /
  indirect rule (§the real-states critique: most historical maps are shades, not
  solid colour);
- land is never "wild" while anyone still projects onto it, which removes the
  wilderness sink that both empties the map and deletes successor states.

This is Lattimore's frontier and Tainter's overstretch stated as a conservation
law, and it is mechanism rather than outcome-fitting: nothing in it names a
region, a size, or a date.

## Recommended order of work

1. **Fix the live budget loop first** (§4b) — that is the shipped bug the owner
   is looking at, and it is a smaller change than reviving the field.
2. **Then prototype dilution in the render field**, where it is free: the field
   already runs every tick and nothing reads it, so a conserved-output variant
   can be measured against the authoritative map with zero risk to saves.
3. **Only then reconsider authoring.** Reviving `CTRL_LIVE` also requires
   persisting `_ctrlOwner`/`_ctrlHold` (the load-divergence half of its gate
   failure) and restoring the field-war coupling.

Do NOT re-enable the removed prototype as-is. It failed on a real defect that
this note does not fix by itself.


---

# ROOT CAUSE FOUND AND FIXED (behind `T.BRIDGE_GLOBAL`, 2026-07-30)

Instrumenting the target's own terms first (rather than guessing a fourth fix)
settled it immediately. A real realm at step 4896, app grid:

    govPop=7209  stm=0.2567  RECAL=1.18  bindDens=1375  ->  popCap=2  held=8

`popCap=2` is ARITHMETICALLY CORRECT: 7,209 people can staff about two tiles of
administration. Nothing in the target is broken. **A whole country had 7,209
people** — the world is under-populated relative to the density needed to hold
ground, and everything downstream follows. §2's bistability is real but it is not
the proximate cause; the missing population is.

## The chain, measured end to end

1. `FOOD_K` A/B across grids — the decisive experiment:

   | | tw=240 | tw=480 | ratio |
   |---|---|---|---|
   | FOOD_K on (default) | 7.51M | 3.38M | **2.22×** |
   | FOOD_K off | 5.89M | 4.44M | **1.33×** |

   The ledger RAISES capacity at the reference and LOWERS it at the app grid.
   A sign flip is the signature of a per-ENTITY quantity spread over a
   resolution-dependent tile count.

2. `ledgerK = (s._k · landShare / bridge) · (cap[i]/W)`, so each catchment sums to
   a per-settlement total divided by the bridge.

3. The bridge is `median(census people) / median(field people in the CATCHMENT)`,
   and catchment extent is grown in TILES, not real area:

   | | tw=240 | tw=480 |
   |---|---|---|
   | mean catchment | 37.8 t | 100.1 t (4× would be parity) |
   | land under a catchment | 25.6% | **16.5%** |
   | bridge | 0.0013 | **0.0041** (3.15×) |

4. So the divisor shrinks with grid fineness, the bridge inflates, every ledger
   share shrinks, capacity falls, and the field population the bridge is measured
   against falls too — **a feedback** that amplifies the underlying 1.33× into the
   measured 2.22×.

## The fix

`T.BRIDGE_GLOBAL` (default 0): measure the bridge as Σcensus ÷ Σfield-people over
all land. Both sides are pure people-totals, so catchment geometry drops out
entirely. This is what a unit conversion between people and people should always
have been.

## Measured

| | Σcap 240 | Σcap 480 | res gap |
|---|---|---|---|
| before | 7.51M | 3.38M | 2.22× |
| BRIDGE_GLOBAL=1 | **13.63M** | **8.15M** | **1.67×** |

App-grid growth trajectory, 12k, seed 8817 — the owner-visible result:

| | max realm | claimed | trajectory |
|---|---|---|---|
| before | 4 t (15k km²) | 0.09% | FROZEN 2k→12k |
| after | **73 t (279k km²)** | **1.16%** | 0 → 1 → 24 → 73 |

Smoke suite green (109.9s, all checks). Default OFF, so nothing shipped changes.

## Honest caveats

- **State formation is DELAYED**: no realms until step 8000 (baseline had 2 by
  step 2000). Higher capacity means pop/cap sits lower early, so nucleation
  thresholds are crossed later. This is a real regression in timing and must be
  understood before the default flips.
- **The reference grid changes a lot** (Σcap +81%). Every validated number moves.
  This needs the full multi-seed gate + stylized battery, not a smoke run.
- **A 1.67× resolution gap remains** — the catchment real-area shortfall (25.6% →
  16.5% of land) is now the leading term, plus fert max-pooling (−11%) and the
  dev-clock lag. The catchment extent being grown in tiles rather than real area
  is the next thing to fix.
- The under-population is only partly addressed: 13.63M world capacity is still
  low for the development level, and absolute population magnitude remains
  ungated by the stylized suite (it checks pop/development SHAPE only).


---

# The catchment real-area shortfall — FIXED (`T.RES_INV_RIVERCOST`, 2026-07-30)

The leading residual after the bridge fix. Diagnosed by elimination rather than
by guessing, since the previous three guesses all cost a full measurement cycle.

## Ruled out first

- **Independent of the bridge fix.** With `BRIDGE_GLOBAL=1`, catchment coverage
  was still 25.3% (tw=240) vs 15.8% (tw=480) — 0.62x, essentially unchanged. So
  it is a separate defect, not a symptom of the capacity gap.
- **NOT the reach budget.** `reachBudget` measures 5.000 at BOTH grids and is
  already multiplied by `rNormPop` in territory.js, whose comment names this exact
  bug class. The scaling is present and correct: cost accumulates per tile step,
  so covering a fixed REAL distance needs a budget ∝ rn, which is what it does.
- **NOT tile desirability.** Mean tile value dilutes only 0.345 -> 0.314 (0.908x).
  Neutralising it entirely (forcing value=1) moved catchment scaling 2.41x ->
  2.56x, where 4x is parity. Worth ~6%, not the ~40% shortfall.

## The cause

The transport cost field classifies each tile as water / RIVER / land, and
river-mode land is far cheaper to cross. A river channel is 1-D on a 2-D grid, so
per the repo's own measurement `riverMag>=1` covers **50% / 27% / 14%** of land at
tw 240 / 480 / 960. Half the reference map is cheap river travel against a quarter
at 2x, so the cost field is systematically dearer on finer grids and every
cost-bounded catchment shrinks with it.

The coarse grid is the GENEROUS one: a tile holding a river grants river travel
across its whole area, including the land in it nowhere near the water. The honest
invariant is that a river makes travel cheap for land within a REAL distance of it
— walk to the water, take a boat.

## The fix

Classify river mode (and read its magnitude) over a real-distance neighbourhood,
radius `round(rNormPop)-1`. Radius 0 at the 240 reference, so byte-identical
there — VERIFIED, not assumed: coverage 25.3%, mean catchment 39.9t, unchanged to
the digit. This is the same correction already shipped and gated for the
per-settlement water scan (`RES_INV_RIVER`).

## Measured (both levers on, seed 8817)

| | tw=240 | tw=480 | gap |
|---|---|---|---|
| catchment coverage | 25.3% | 15.8% -> **19.7%** | 0.62 -> **0.78** |
| catchment tile scaling | — | 2.40x -> **3.13x** | (4x = parity) |
| Σcap | 13.63M | 8.15M -> **10.49M** | 1.67x -> **1.30x** |
| Σpop | 6.63M | 3.92M -> **5.12M** | 1.69x -> **1.29x** |

App-grid growth trajectory, 12k, seed 8817 — the whole arc of this investigation:

| | max realm | claimed | leadAgri |
|---|---|---|---|
| original | 4 t (15k km²) FROZEN | 0.09% | 0.567 |
| + BRIDGE_GLOBAL | 73 t (279k km²) | 1.16% | 0.546 |
| + RES_INV_RIVERCOST | **166 t (634k km²)** | **1.82%** | 0.601 |

634k km² is what the REFERENCE grid produced for the same world (631k km²) — the
app grid now yields the same real empire size, which was the point.

Smoke green (110.4s). Both levers registered in tuning.js, both DEFAULT OFF.

## Still open

- **The residual 1.30x gap.** Catchment coverage is 0.78 of parity, not 1.0.
  Remaining suspects: fert max-pooling to sim tiles (−11% mean), the 1-D coast
  dilution (0.156 -> 0.097), and the dev-clock lag.
- **State formation is delayed** under BRIDGE_GLOBAL (no realms until ~step 8000
  at tw=480, against 2 by step 2000 before). Unexplained; blocks the default flip.
- **Neither lever is gated.** BRIDGE_GLOBAL moves the reference grid +81% on Σcap,
  so it needs the full multi-seed + stylized battery. RES_INV_RIVERCOST is
  byte-identical at the reference but changes every finer grid and needs its own.
- **Absolute population magnitude is still ungated** — the stylized suite checks
  the pop/development SHAPE only. That blind spot is what hid all of this.

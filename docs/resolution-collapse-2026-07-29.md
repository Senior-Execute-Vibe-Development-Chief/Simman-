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


---

# BOTH LEVERS FLIPPED ON BY DEFAULT (2026-07-30)

Owner's call, after the caveats above were put to them. `BRIDGE_GLOBAL` and
`RES_INV_RIVERCOST` both `def: 1`.

## Gate run

| suite | seed | result |
|---|---|---|
| `npm test` (smoke: determinism, invariants, save/load) | — | **green**, 101.2s |
| `npm run validate` (stylized facts) | 8817 | **all hard gates passed**, 1 soft warning (budget 2) |
| `npm run validate` | 31337 | **all hard gates passed**, 1 soft warning (budget 2) |

Both seeds' only warning is the Zipf rank-size slope reporting `n/a` for want of
enough large cities (1 and 2 cities >50 urban) — a pre-existing low-urbanisation
symptom, not something these levers introduced.

Healthy numbers under the flip (seed 8817 / 31337): 44 / 62 polities, largest
empire 14% / 12% of claimed land, empire area tail 9.3 / 9.8, and realm AREA
largest 3.41M km² against the suite's own reference band (Bronze hegemon
~0.5-1M, Rome ~5M, Han ~6.5M) — the first time in this investigation the empire
sizes have looked like history rather than like villages.

## What this does NOT clear

- **The validate suite runs at 480x240 (tw=240) only** — the reference grid. The
  app grid is still not in the loop, so these gates say nothing about the very
  resolution this whole investigation was about. The process finding of §6 stands
  and is now the highest-value open item.
- **The delayed state formation is real but its SIGN is unclear.** At tw=480 the
  first realms now appear ~step 8000 where the baseline had 2 by step 2000 — but
  those baseline realms were the frozen 4-tile blobs that never grew. States
  taking time to form, then growing, may well be the more correct behaviour. Not
  evidence of a regression; not evidence of health either. Unresolved.
- **The residual 1.30x resolution gap** in Σcap (catchment coverage 0.78 of
  parity). Next suspects: fert max-pooling (−11% mean) and the 1-D coast
  dilution (0.156 -> 0.097 across grids), which is the same bug class as the
  river fix one field over.
- **Absolute population magnitude is STILL ungated.** The suite checks the
  pop/development SHAPE (0.93 / 0.94 monotone) and never the level.


---

# BRIDGE_GLOBAL REVERTED TO OFF — it re-scales the census (2026-07-30)

Owner, playing the flipped build: *"still doing the whole very tiny country
blobs, all growing thing. Something fundamental changed with our starting
stage."* Both halves were right, and the second one is a defect I shipped.

## What the owner caught that the gates did not

**1. The median realm never improved.** The "4 t -> 166 t" headline was the MAX.
Measured medians at 12k, seed 8817:

| | median realm | largest |
|---|---|---|
| app grid, before | 1 t | 4 t (frozen) |
| app grid, after | 6 t (23k km²) | 166 t |
| reference, before | 4 t | 41 t |
| reference, after | 4 t | 63 t |

The TYPICAL country is ~4-6 tiles in every configuration, before and after. The
fixes moved the leader and the total claimed land, not the swarm of statelets the
owner is actually looking at. Quoting a max as if it were representative is the
reporting failure here.

**2. The empty early world is BRIDGE_GLOBAL's doing.** The "nothing, then
everything at once" shape is largely pre-existing (reference grid, levers off: 2
realms at step 3000, 5 at 6000, then 27 by 9000). But on the app grid the flip
moved first states from step 3000 to ~7000.

## Root cause — the bridge is a UNIT CONVERSION, not just a ledger divisor

`bridge = census / field`. `deriveOnePop` uses it to convert the field's people
into the economy's census magnitudes. Lowering it deflates every settlement's
recorded population. Measured at tw=240 / 6k:

| config | census | settlements |
|---|---|---|
| both off | 4864 | 66 |
| RES_INV_RIVERCOST only | **4864** | **66** (byte-identical, as designed) |
| + BRIDGE_GLOBAL | **3507** (−28%) | 61 |

State formation gates on CENSUS — `NUCLEATE_SEAT_POP = 160`,
`NUCLEATE_CLUSTER_POP = 400`. Deflate the census 28% and every seat reaches the
bar far later, so the early map is stateless. And it is not only nucleation:
**every census-calibrated constant in the sim silently changed meaning.** That is
not a shippable change, whatever the capacity numbers say.

The stylized suite passed on both seeds because it scores the world at 21k, by
which point the deficit has washed out. It does not test the early game at all —
another gate that measures the wrong thing, and the third time this session the
owner found what the gates could not.

## The trade-off, stated honestly

| | first realms | max @12k | census |
|---|---|---|---|
| baseline | step 3000 | 4 t frozen | 4864 |
| RES_INV_RIVERCOST only | step 3000 | 7 t | 4864 |
| + BRIDGE_GLOBAL | ~step 7000 | 166 t | 3507 |

**The growth win came entirely from the calibration-breaking change.** The
calibration-safe change alone does not deliver it (7 tiles, not 166). There is no
version of this that is both safe and fixes the app grid today.

## Shipped state

- `BRIDGE_GLOBAL` back to **def 0**, with the reason recorded in its lever desc.
- `RES_INV_RIVERCOST` stays **def 1** — byte-identical at the reference (census
  4864 and 66 settlements, unchanged to the digit) and a genuine fix at finer
  grids. Smoke green (151.8s).

## The correct route from here

Do NOT redefine the bridge's LEVEL. Make the EXISTING bridge invariant by fixing
what contaminates it — catchment real-area coverage. `RES_INV_RIVERCOST` took
that 0.62 -> 0.78 of parity; the remaining terms are the 1-D COAST dilution
(mean 0.156/0.097/0.060 across grids — the same bug class as the river, one field
over) and fert max-pooling (−11% mean). At parity the existing bridge is
naturally grid-invariant, capacity converges, and no census is re-scaled.

Separately, and probably bigger for what the owner sees: **the median realm, not
the largest.** Nothing in this investigation has yet moved it, at any grid.


---

# THE REAL DEFECT: nothing is ever conquered (2026-07-30)

Owner's clarification, after three rounds of me fixing the wrong thing:
*"My problem wasn't lack of countries, it was them all being very tiny blobs for
a long time early game."*

Not the realm COUNT. Not the LARGEST realm (which is what my "4 -> 166 tiles"
headline measured). The typical realm, staying tiny, for a long time.

## The early world, reference grid, current defaults

    steps 0-6000:  2-7 realms, each 3-6 tiles
                   sharedBorderPairs=0  borderTiles=0  realmsWithLandBorder=0%
                   nearest realm 10 tiles away
                   war.began=0 in every window
                   AT_TARGET with HEADROOM=0  (target med=2)

Isolated dots ten tiles apart, frozen at a target of 2, touching nobody. Around
step 8000 borders finally appear and wars start. But:

| window | wars begun | settlements captured | annexed |
|---|---|---|---|
| 6000-8000 | 3 | 0 | 0 |
| 8000-10000 | 8 | 0 | 0 |
| 10000-12000 | 7 | 0 | 0 |
| 12000-14000 | 14 | 0 | 0 |
| 14000-16000 | 16 | 0 | 0 |
| 16000-18000 | 38 | 0 | 0 |

**86 wars over 18k steps, zero captures, zero annexations.**

## Verified independently of event naming

Under FIELD_POLITY captured TILES are the transfer and settlements re-derive
their flag, so a zero `settlement.captured` count could have been a reporting
artifact. `tools/probe_transfer.mjs` measures the thing itself — settlements
whose countryId moves from one LIVE realm to another:

    over 12,000 steps, reference grid, seed 8817:
      realm -> realm transfers:      1
      stateless -> realm:           43
      realm -> stateless:            5
      realms: 2 -> 5 -> 27 -> 42 (monotonically rising)

**One settlement conquered in twelve thousand steps.** Not a reporting artifact.

## What this means

Realms grow ONLY by (a) creeping into wilderness, throttled by the size target to
a couple of tiles, and (b) absorbing STATELESS towns. They never take anything
from each other. So the map accumulates ever more small states and never merges
them — realm count rises monotonically for the whole run. Every empire in history
was built by conquest; this sim has no working consolidation mechanism at all.

This is a first-order defect and it dwarfs everything else in this document. The
resolution work (bridge, river cost, catchment) is real and worth keeping, but it
was never going to fix what the owner was looking at: even with capacity perfect,
a world that cannot conquer stays a patchwork of dots.

## Next

Find why wars never transfer. The war pass reaches `war.began` 86 times, so
fronts open and armies exist; something between "front opens" and "tile flips
owner" never fires. Note `armies.js` carries war branches deliberately bound dead
(`const CTRL_LIVE = false`, "strip them on the next war pass") from the removed
control-field prototype — worth checking whether the live path lost anything when
that was torn out, since the timing fits.

Do NOT tune the size target further until this is understood. A conquest-less
world will look like statelets whatever the target says.


---

# Why the dawn of states is SYNCHRONISED (2026-07-30)

Owner: *"at a point the blobs grow back into regular run, but early they are
distantly spaced blobs."* Not the realm count, not conquest — the EARLY map is a
few lone dots, then it fills in and looks normal.

## Measured

State birth requires `org >= T.ORG_STATE_MIN` (0.15). Organisation across all
settled settlements, 480x240 seed 8817:

| step | p10 | med | max | qualifying |
|---|---|---|---|---|
| 1500 | 0.098 | 0.102 | 0.110 | **0 / 49** |
| 3000 | 0.096 | 0.110 | 0.125 | **0 / 57** |
| 4500 | 0.101 | 0.124 | 0.138 | **0 / 61** |
| 6000 | 0.113 | 0.138 | 0.153 | 8 / 66 |
| 7500 | 0.137 | 0.153 | 0.167 | **44 / 68** |
| 9000 | 0.144 | 0.165 | 0.182 | 62 / 73 |

Nothing can be a state for ~5500 steps; then the whole world crosses within
~2000. That is the owner's "few distant dots, then regular run", exactly.

`FRONTIER_FOUNDING=4` (which HALVES the capital-spacing rule and QUARTERS both
population bars) changes the early phase not at all — 3/2/3/5 realms becomes
3/2/3/6 through step 6000, only doubling after 7500. Neither spacing
(NUCLEATE_CAP_DIST) nor population is the early gate. Organisation is.

## A hypothesis I formed, tested, and FALSIFIED

I proposed that the stone-age ceiling `orgEraCap = 0.15 + metalCap*0.95 +
construction*0.15` equals `ORG_STATE_MIN` exactly (both 0.15), so organisation
would asymptote into the bar and statehood be impossible pre-metal — a global
switch when metal lifted the cap. I implemented a Carneiro circumscription term
on the CEILING (`s._confine` already exists and already drives the RATE) and
measured: **org identical to three decimals, qualifying counts 0/0/0/5/42/62 vs
0/0/0/8/44/62.** No effect.

Instrumenting the actual values shows why:

    metalCap=0.900  cap=1.0000  org=0.1000  head=0.9000
    metalCap=1.000  cap=1.0000  org=0.1000  head=0.9000

**The ceiling is already 1.0 from step one; headroom is 0.9, not 0.04.** The
hypothesis was wrong and the patch was reverted rather than kept as a no-op.

## The actual mechanism

Every settlement starts at **org = 0.1000 exactly**, and grows at a near-uniform
rate: `LEARN_BASE (4.5e-6) × sciMul × orgClim × orgHead(0.9) × ...`. The only
regional variation is in those multipliers, and their combined spread is small —
`confineMul = 1 + CONFINE·_confine` is at most ~1.39 with `_confine` median
0.295. So the whole world climbs from 0.100 to 0.15 together and crosses within
~2000 steps of each other.

**A uniform initial condition plus a near-uniform rate makes any threshold a
global switch.** DAWN cannot help: it staggers when basins reach POPULATION bars,
and population is not the gate.

For a rolling dawn, organisation must be BUILT BY LOCAL PRESSURE — density
against capacity, circumscription, conflict — strongly enough to spread crossings
over millennia, not learned at a near-constant rate everywhere. That is a
redesign of the knowledge track, not a patch, and it is not attempted here.

## SEPARATE REAL BUG FOUND: the era gate is inert

    const metalCap = oreTier(r);   // ORE availability, not metallurgy KNOWLEDGE
    orgEraCap = clamp01(0.15 + metalCap * 0.95 + k.construction * 0.15);

The comment on this gate states its purpose: "a stone-tool society runs a
chiefdom, not a continental bureaucracy — without this, a big fertile village grew
org→1.0 (continental reach) on population alone, with zero metallurgy." But
`metalCap` reads the ORE TIER of reachable deposits, not `k.metallurgy`. A
stone-age village standing on iron ore gets a ceiling of 1.0 immediately. The
guard does not guard, which is precisely the failure mode it was written to
prevent. Measured `metalCap` 0.9-1.0 at the earliest settlements.

**Tension to weigh before fixing it:** making the gate bind would LOWER the early
ceiling and make states form LATER, worsening the owner-visible symptom — while
also introducing real regional variation (ore varies by place), which is the
ingredient the rolling dawn actually needs. Both effects are real. Measure both.


---

# Spreading the dawn: circumscription × crowding (`T.ORG_PRESSURE`, 2026-07-30)

The follow-up to the falsified ceiling hypothesis above. This time the term was
verified LIVE and VARYING before any long measurement was run — the lesson from
three no-op "fixes" earlier in the day.

## Mechanism

Carneiro stated properly: **circumscription alone does not build states —
circumscription PLUS population pressure does.** Where land is open the losers of
a quarrel disperse; where it is bounded AND full they must submit, and submission
is what an institution is. `T.CONFINE` already carried circumscription, but as a
bare rate multiplier (1.10–1.28 in practice) with no pressure term, so it rewards
an EMPTY hemmed-in island exactly as much as a packed valley.

    fill      = s.people / s._k                     (settlement against its own capacity)
    pressMul  = 1 + T.ORG_PRESSURE · s._confine · fill

multiplied into organisation learning. 0 = off, byte-identical.

## Verified live first

    [press] confine=0.705 people=110 _k=554.9 fill=0.198 pressMul=1.419 confineMul=1.282
    [press] confine=0.509 people=110 _k=219.9 fill=0.500 pressMul=1.764 confineMul=1.204
    [press] confine=0.661 people=110 _k= 94.5 fill=1.164 pressMul=3.307 confineMul=1.264
    [press] confine=0.250 people=110 _k=179.9 fill=0.611 pressMul=1.459 confineMul=1.100

`pressMul` spans 1.20–3.31 across five settlements where `confineMul` spans
1.10–1.28. The term does what it claims: it DIFFERENTIATES.

## Measured (480x240, seed 8817)

Organisation spread (max − p10), and settlements over `ORG_STATE_MIN`:

| step | spread off | spread @3 | qualify off | qualify @3 |
|---|---|---|---|---|
| 3000 | 0.029 | 0.044 | 0/57 | 0/56 |
| 4500 | 0.038 | **0.069** | 0/61 | **12/61** |
| 6000 | 0.039 | **0.085** | 8/66 | **44/66** |
| 9000 | 0.038 | **0.111** | 62/73 | 69/72 |

The distribution roughly TRIPLES in width — the planet stops crossing the bar as
one cohort.

Realm ramp — the owner-visible result:

| step | off | @3 | @6 |
|---|---|---|---|
| 4500 | 3 | 5 | 6 |
| 6000 | 5 | **12** | **14** |
| 7500 | **21** (4× jump) | 19 | 21 |
| 9000 | 27 (max 9 t) | 25 (**max 20 t**) | 25 (**max 26 t / 400k km²**) |

The "5 -> 21 in one window" burst becomes a gradual 5 -> 12 -> 19, and the leading
realm at 9000 goes from 9 tiles to 20-26 (138k -> 308-400k km²).

Smoke green at the default (122.7s).

## What it does NOT fix — stated plainly

**The first ~3000 steps are unchanged**: 3, 2 realms at both settings, and at
OP=6 as well. Those are the seeded states, alone on the map. Organisation still
starts at **exactly 0.1000 everywhere** and must climb to 0.15; even a 3× rate in
the best-pressed basin needs ~4000 steps. Spreading the RATE cannot fix a uniform
INITIAL CONDITION — to move the earliest phase, the org a settlement is BORN with
has to depend on where it is. That is the remaining half of this defect.

## Shipped

`T.ORG_PRESSURE`, **default 0** (byte-identical). Not gated: the multi-seed
stylized battery has not been run under it, and after the BRIDGE_GLOBAL episode
earlier today nothing goes on by default without one. Try it with
`T.ORG_PRESSURE = 3`.


---

# Birth organisation varies by site — the other half (`T.ORG_BIRTH_VAR`, 2026-07-30)

`ORG_PRESSURE` spread the learning RATE and could not touch the first ~3000
steps, because **a rate cannot differentiate what starts identical**. Every
settlement was born at `organization: 0.1` EXACTLY — in `settlement.js`
makeSettlement AND in `crystallize.js`'s inherit baseline — and inheritance
blends toward neighbours who are also at 0.1, so the uniformity is
self-reinforcing.

## Mechanism

The coordination a founding community carries reflects what its site DEMANDS and
SUPPORTS: a rich site that cannot disperse — hemmed in by desert, mountain or sea
— must manage water, store a surplus and settle disputes over scarce ground from
its first generation. An open or barren site needs none of it. Wittfogel's
hydraulic demand meeting Carneiro's circumscription, both already computed
per-site:

    birthOrg = 0.1 · (1 + T.ORG_BIRTH_VAR · _confine · fert)

## Calibrating it honestly

Birth organisation at step 1200, 480x240 seed 8817 (`ORG_STATE_MIN` = 0.15):

| setting | p10 | med | p90 | max | spread |
|---|---|---|---|---|---|
| 0 (off) | 0.0995 | 0.1012 | 0.1033 | 0.1073 | 0.0078 |
| 0.5 | 0.1133 | 0.1208 | 0.1311 | 0.1400 | 0.0268 |
| **1** | 0.1248 | **0.1367** | **0.1578** | 0.1709 | 0.0462 |
| 2 | 0.1462 | **0.1665** | 0.2235 | 0.2358 | 0.0896 |

**2 OVERSHOOTS**: median 0.167 is already above the statehood bar, so nearly every
site qualifies at birth and nothing is earned. **1** puts the top ~10-15% of sites
above the bar while the median must still climb from 0.137 — cradles first,
periphery later, which is the historical shape.

## Measured — the realm ramp (480x240, seed 8817)

| step | off | BIRTH_VAR=1 | +PRESSURE=3 |
|---|---|---|---|
| 3000 | 2 | 3 | 3 |
| 4500 | 3 | **7** | 6 |
| 6000 | 5 | **13** | 13 |
| 7500 | **21** (4× jump) | 17 | 18 |
| 9000 | 27, max 9 t | 26, max 19 t | 29, max **26 t / 400k km²** |

The cohort burst is gone: a flat line with a 4× jump becomes a smooth monotonic
ramp, and the leading realm at step 9000 is ~2.9× larger in real area.

## Gate — BOTH FLIPPED ON (def: ORG_BIRTH_VAR=1, ORG_PRESSURE=3)

| suite | seed | result |
|---|---|---|
| `npm test` | — | **green**, 119.4s |
| `npm run validate` | 8817 | **all hard gates passed**, 1 soft warning |
| `npm run validate` | 31337 | **all hard gates passed**, 1 soft warning |

Shifts under the flip (8817 / 31337, vs the previous run): polities 44→51 /
62→67; largest empire's share 14%→11% / 12%→8%; empire area tail 9.3→7.7 /
9.8→6.8; settlements 85→89 / 85→94.

**Two things to watch, recorded rather than glossed:**
- **Urbanisation slipped.** Cities over 50 urban: seed 8817 went 1 → **0**, seed
  31337 went 2 → 4. The Zipf warning was pre-existing but 8817 is now at zero
  large cities. Worth a look if city sizes matter.
- **More polities, not fewer.** 44→51 and 62→67. The dawn is smoother but the
  world is MORE fragmented, which cuts against the owner's "tiny blobs" complaint
  even as it fixes the "all at once" one.

## What this does NOT fix

**The median realm is still ~4 tiles**, unchanged by any of this. That is the
conquest defect (86 wars, 1 transfer in 12k steps) recorded above, and it remains
the dominant cause of a map made of statelets. These two levers fix the SHAPE of
the dawn, not the SIZE of what it produces.


---

# GIT ARCHAEOLOGY: when the median realm was an empire (2026-07-30)

Owner: *"Go back in time, look for a time when median realm was not small,
around ~4 tiles."* Measured with `tools/probe_hist.mjs` — 480x240, seed 8817,
9000 steps, identical probe at every commit.

## The arc

| date | commit | realms | claimed | MEDIAN realm | max |
|---|---|---|---|---|---|
| 2026-06-25 | d06c55f | 14 | 6.0% | 11 t (169k km²) | 219 t |
| **2026-07-06** | c608ede | 11 | **25.7%** | **196 t — 3,015k km²** | 778 t (12.0M km²) |
| 2026-07-14 | 3a7a5af | 20 | 16.9% | **77 t — 1,184k km²** | 133 t |
| 2026-07-14 | 4480642 | 27 | 6.3% | 15 t (231k km²) | 90 t |
| 2026-07-22 | d7cbe14 | 46 | 15.2% | 18 t | 189 t |
| 2026-07-26 | 26de3ef | 31 | 12.0% | **33 t — 508k km²** | 93 t |
| 2026-07-26 | 3152d6f | 24 | 6.1% | 16 t | 76 t |
| 2026-07-26 | 4a7734a | 24 | **2.7%** | **7 t** | 30 t |
| 2026-07-30 | ee04d0c | 27 | 1.0% | **4 t** | 9 t |
| 2026-07-30 | 5d4ace3 (HEAD) | 29 | 1.5% | 4 t | 26 t |

**Yes — the median realm was a real empire as recently as 2026-07-06: 196 tiles,
3 million km², with a quarter of all land under a flag.** It is 4 tiles today.

## The three cuts, each isolated

1. **`4480642` SIZE_BY_POP -> 1 (07-14).** Median 77 t -> 15 t, claimed 16.9% ->
   6.3%, in ONE commit. This is the change that made size track governed people —
   and removed the coverage floor, which is what made the collapse-to-anchor mode
   of §2 reachable at all.
2. **`3152d6f` CRADLE_EVE -> 0 (07-26).** Median 33 t -> 16 t, claimed 12.0% ->
   6.1%. Removes the eve-of-states head start (the org 0.28 cradle seed), so
   kingdoms must emerge instead of starting present.
3. **`4a7734a` SPAN_TECH -> 0.85 (07-26).** Median 16 t -> 7 t, claimed 6.1% ->
   2.7%. `1d41f44` built it at def 0 and measures BYTE-IDENTICAL to its parent
   (6.07%, 16 t) — a clean build; the flip is the whole effect.

`SPAN_TECH` is the `spanTechMul` term in the size target, measured at **0.2567**
early in §"ROOT CAUSE": every young realm is allowed roughly a QUARTER of the
territory it could otherwise administer. It is the single highest-leverage dial
on the owner's complaint, and it was flipped deliberately ("the span is earned;
owner call on the flip").

## This session's contribution, measured honestly

| | claimed | median | max |
|---|---|---|---|
| ee04d0c (session start) | 0.99% | 4 t | 9 t (138k km²) |
| 5d4ace3 (now) | 1.45% | 4 t | 26 t (400k km²) |

Claimed land +47%, largest realm ~2.9×, **median unchanged at 4 t**. The collapse
predates this session; the work here did not cause it and has not fixed it.

## What this means

The tiny-blob world is not one bug. It is the CUMULATIVE effect of three
deliberate flips, each defensible alone — size should track people, statehood
should be earned, administrative span should be earned — that together cut the
median realm ~50× from its 07-06 value. Nothing measured the JOINT effect,
because each was gated on its own against ratio-shaped stylized facts that are
blind to absolute area (§6, the standing blind spot).

**Cheapest experiment for the owner:** lower `SPAN_TECH` (0.85 -> ~0.3) and
re-measure. It is one number, it is the largest single term in the size target,
and its flip is fully reversible. Then re-weigh `CRADLE_EVE`. Neither needs new
mechanism — they need the joint effect measured, which is what
`tools/probe_hist.mjs` now does in one command at any commit.


---

# THE COMMIT: `de97888`, the food ledger, 2026-07-28 13:30

Owner corrected my archaeology twice — "more recent than that", "during our
recent phase A, B, C thing" — and was right both times. Bisecting inside the
Tier-B wave (480x240, seed 8817, 9000 steps, `tools/probe_hist.mjs`):

| commit | time | realms | claimed | median | max |
|---|---|---|---|---|---|
| `dc4e0e9` Tier-A | 07-28 07:21 | 32 | 1.91% | 5 t | 23 t (354k km²) |
| `b859db7` | 12:09 | 32 | 1.91% | 5 t | 23 t |
| `deffdce` size target sheds the median anchor | 12:35 | 35 | 1.73% | 4 t | 19 t |
| **`de97888` land works carry the food ledger** | **13:30** | 26 | **0.90%** | 4 t | **8 t (123k km²)** |
| `e484bfe` | 14:34 | 27 | 0.92% | 4 t | 8 t |
| Tier-C (all four) | 07-29 | 27 | 0.92% | 4 t | 8 t (unchanged — default-off, as labelled) |

**One commit halved the claimed land and cut the largest realm 2.4×.** Not the
size-target commit 55 minutes earlier (which cost a modest 1.91% -> 1.73%), and
nothing in Tier-C at all.

## Mechanism — it is a CAPACITY cut

Σ carrying capacity over all land, same seed, 6000 steps:

| commit | Σcap | Σpop | census |
|---|---|---|---|
| `deffdce` (12:35) | **13.93M** | 5.04M | 5327 |
| `de97888` (13:30) | **7.89M** (−43%) | 4.79M | 4478 |
| HEAD | 7.40M | 4.61M | 3899 |

`de97888` put the settlement FOOD LEDGER in charge of worked-land capacity
(`T.FOOD_K`, the `ledgerK` blend in popField.js). The ledger carries roughly HALF
the magnitude of the terrain proxy it replaced, so the world lost 43% of its food
in one commit — and with it the governed population that every realm's size
target is computed from.

## This closes the loop on this session's whole investigation

`BRIDGE_GLOBAL=1` measured Σcap = **13.63M** — within 2% of the pre-`de97888`
value of 13.93M. **That experiment was unknowingly reverting this commit**, which
is why it produced 166-tile realms; and it broke state formation because it got
there by re-scaling the census unit (−28% census, seats never reaching
NUCLEATE_SEAT_POP) instead of fixing the ledger's magnitude.

So the correct fix is now precisely stated, and it is NOT the bridge:
**the ledger -> capacity conversion in the FOOD_K blend is under-scaled by ~2×
relative to the terrain proxy it replaced.** Fixing it there restores the world's
food without touching the census calibration, which is what every downstream
constant is tuned against.

## Corrected picture of the whole decline

Three flips (SIZE_BY_POP 07-14, CRADLE_EVE 07-26, SPAN_TECH 07-26) took the
median from 77 t to 7 t. Then `de97888` (07-28) halved what remained, taking the
LARGEST realm from 354k km² to 123k km². The owner's memory was right: the world
was visibly bigger a few days ago, during Tier-A/B, and the drop is a single
commit inside the Tier-B wave.

Each change was gated on its own and each passed. None of the gates measure
absolute carrying capacity or absolute realm area — §6, the standing blind spot,
now with a fourth instance.


---

# What `de97888` ACTUALLY did — and why restoring it is the wrong instinct

Chased the fix, measured it, and the conclusion inverted. Recording it because
the instinct ("find the commit, put it back") is wrong here and the next
generation will have it too.

## The lever restore does not work — measured first

`ERA_PROD_SCALE` and `TIER_SCALE_REF` are documented "retired; >0 restores".
At HEAD, 480x240 seed 8817, 6000 steps:

| config | Σcap | census |
|---|---|---|
| defaults (0 / 0) | 7.40M | 3899 |
| `ERA_PROD_SCALE=260` | 7.74M (**+4.6%**) | 4006 |
| `+ TIER_SCALE_REF=29000` | 7.74M (no further change) | 4006 |

The consuming code was replaced alongside the constants, so the old world is not
recoverable by the levers. The missing ~6M of capacity is in the new mechanism.

## What the commit was doing — from its own message

> "The fitted overlay `_eraProd = BASE + 260·agri^6·devGate` is retired
> (ERA_PROD_SCALE default 260 -> 0)... **The 260 and the exponent 6 existed only
> to land the modern boom at a target scale** while staying invisible pre-modern
> (measured exactly 1.000 until ~10500), and devGate keyed FOOD productivity on
> political organisation — **a state grows no wheat**."

replaced by

    s._eraProd = (1 + LAND_WORKS × _terrWorksMean) × s._indCap

**That commit was obeying THE SECOND CARDINAL RULE.** `260·agri^6` is precisely
the tell the rule describes: a constant with no independent physical meaning,
chosen to land an outcome. Retiring it is correct. And `devGate` — food
productivity keyed on political organisation — was a genuine causal error.

## The real finding, stated the way CLAUDE.md asks

The world did not get worse; it got HONEST, and the honest number is lower. Per
the rule's own closing line — *"A surprising-but-mechanistic result beats a
correct-but-fitted one. If the honest system makes Egypt a city-state, that is a
TRUE finding about a missing mechanism — surface it and build the missing system,
don't paper over it with a constant."*

**So: the 43% capacity loss is a TRUE finding, and the missing system is the
pre-industrial TECHNIQUE→YIELD channel.** What replaced the overlay covers:
- Boserupian built works (canals, terraces, drainage) — `LAND_WORKS × worksMean`
- industrial capacity — `_indCap`

What it does NOT cover is the several-fold rise in pre-industrial yields from
agricultural technique itself: crop rotation, the mouldboard plough, manuring,
selective breeding, new crop packages. The retired `agri^6` was FAKING that
channel with a fitted exponent. Deleting the fake correctly left a hole where a
real mechanism should be.

The sim already carries the ingredients — crop packages (`CROP_AXIS`), livestock
(`LIVESTOCK`: traction/manure/dairy), `k.agriculture`. The build is to price
yield from those, so a people with a good package, draught animals and manure
out-produces one without — mechanistically, with no exponent chosen to hit a
target.

## Recommendation

**Do NOT restore `ERA_PROD_SCALE`.** It is a fitted constant, it is banned by the
project's own rule, and it only buys +4.6% anyway. Build the technique→yield
mechanism instead. Until it exists, the world's food — and therefore its realm
sizes — is honestly short by roughly the amount that overlay was inventing.

**Caveat worth weighing:** `de97888`'s own commit message records that "the
5-seed battery at 21k is the recorded next validation step **before any push**".
It was pushed with that validation outstanding. The design is right; whether the
magnitude of what replaced the overlay is right was never established, and that
is the open question — not whether to bring the overlay back.


---

# THE BLOB PHASE, MEASURED (tools/probe_blob.mjs, 2026-07-30)

Owner: *"my problem is still that slow start, and the phase of tiny blob nations
all over. Can you accurately measure that, and is it still there."*

Defined: the phase runs from the first step with >=3 realms until the MEDIAN
realm reaches 250k km² (a state-sized polity — Romania, the UK). Reported with
displayed years so it can be read against the calendar the player sees.
**HEAD, seed 8817, 20000 steps, both grids.**

## THE APP GRID (tw=480 — what the owner plays)

| step | year | realms | claim% | median | max |
|---|---|---|---|---|---|
| 3000 | 4100BC | 4 | 0.02 | **4k km²** | 23k |
| 6000 | 2600BC | 16 | 0.08 | **4k km²** | 23k |
| 9000 | 1100BC | 25 | 0.12 | **4k km²** | 27k |
| 12000 | 400AD | 36 | 0.20 | **4k km²** | 27k |
| 15000 | 1900AD | 43 | 0.37 | **4k km²** | 80k |
| 17000 | 2900AD | 51 | 1.46 | 19k | 305k |
| 20000 | 4400AD | 56 | 3.02 | 65k | 275k |

**The median realm is 4,000 km² — ONE TILE — from step 3000 to step 15000.**
That is 4100 BC to 1900 AD in displayed years. One tile is the anchor core: the
floor, the smallest a realm can be. **The typical nation on this map is pinned at
its minimum for 12,000 consecutive steps**, while realm COUNT climbs 4 -> 43.

Blob phase: **never ends within 20,000 steps.** At 4400 AD the median is still
65k km² and 97% of the world is unclaimed.

## THE REFERENCE GRID (tw=240 — where every battery in this doc was run)

| step | year | realms | claim% | median | max |
|---|---|---|---|---|---|
| 4000 | 3600BC | 5 | 0.19 | 62k km² | 77k |
| 10000 | 600BC | 33 | 1.86 | 62k km² | 600k |
| 14000 | 1400AD | 50 | 6.09 | 108k | 907k |
| 18000 | 3400AD | 52 | 11.46 | **261k** | 1938k |
| 20000 | 4400AD | 51 | 12.82 | 261k | 2353k |

Blob phase: 14000 steps, **ENDS at step 18000**.

## The comparison — the resolution gap is the dominant term

| | app grid | reference | gap |
|---|---|---|---|
| median during phase | 4k km² (1 tile) | 62k km² (4 tiles) | **15×** |
| claimed @20k | 3.02% | 12.82% | 4.2× |
| max @20k | 275k km² | 2353k km² | 8.5× |
| phase ends | never (>20k) | step 18000 | — |

**The owner's experience is 15× worse than every measurement in this document**,
because every battery here — and the entire stylized suite — runs at tw=240. The
residual Σcap gap after the river fix was only 1.30×, yet the median realm gap is
15×: the political layer amplifies a modest capacity shortfall into a total
collapse, because the size loop of §2 is BISTABLE. At tw=240 the median realm
clears the break-even and sits at 4 tiles; at tw=480 it falls below and collapses
to the 1-tile anchor, which is exactly the failure mode diagnosed at the start of
this document and never fixed.

## So, in priority order

1. **The bistable size loop (§2) is the proximate cause** of the owner's world
   and remains unfixed. A floor — or a holdings-independent base — stops the
   median collapsing to its anchor. This is now the single highest-value change.
2. **The residual resolution gap** feeds it. Coast dilution (0.156/0.097/0.060
   across grids) is the next term, same class as the shipped river fix.
3. **The technique→yield mechanism** (previous section) sets the ceiling for
   everyone, both grids.
4. **Conquest** (86 wars, 1 transfer) stops consolidation at every grid.

None of these is the food-overlay restore, and none of them is what I spent the
first half of this session on.

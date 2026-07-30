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

# Country count & size — measured diagnosis (2026-07)

User report: **countries are generally too few and too large.** This doc records the
measured causes and the trial results (including the negatives), so the follow-up
mechanism work starts from evidence, not vibes. All numbers: 480×240, seed 8817,
15 000 steps, app-identical pipeline (`tools/_harness.mjs` buildSim), current defaults
(post real-width-floodplain fix). The timeline probe lives in the session scratchpad;
its columns are reproducible from `world._countryOwner` + settlement/polity state at
1 000-step checkpoints.

## The measured shape

| step | settled | stateless (pop%) | cities (bar) | countries | claimed% | max realm (tiles) |
|-----:|--------:|-----------------:|-------------:|----------:|---------:|------------------:|
| 1000 | 24 | 12 (47%) | 0 (240) | 3 | 5.9% | 370 |
| 3000 | 35 | 6 (10%) | 7 (240) | 7 | 16.3% | 890 |
| 8000 | 41 | 10 (7%) | 3 (410) | 8 | 22.2% | 753 |
| 12000 | 42 | 3 (1%) | 4 (933) | 10 | 26.2% | 521 |
| 15000 | 70 | 15 (1%) | 4 (2100) | 14 | 46.2% | 806 |

Flows over the run: `polity.founded` = 7 (3 genesis cradles, 3 frontier, 1 fragment)
vs `polity.ended` = 38; `settlement.annexed` = 64, `settlement.captured` = 29,
`polity.seceded` = 20 (mostly reabsorbed). Realm membership at 12 000:
11,7,5,4,3,3,2,2,1,1.

## Findings

**1. The count is arithmetically bounded by the settlement map.** 42–70 settlements
whose realms hold 1–11 members can only make ~10–15 countries. The
`countryTerritory.js` CITY_TIER comment's "~80–100-country target" is unreachable at
this settlement count regardless of any political lever.

**2. City formation didn't stop — it is PINNED by construction.** Cities peaked at 7
(step 3000) and settled at 3–4 forever while the floating city bar climbed 240 → 2100
(`updateTier`: `TIER_THRESHOLD[2]=600 × tierScale`, tierScale = totalPop/29 000 capped
at 3.5 under `DISSOLVE_FARMS`). A *relative* bar keeps "city" = the top handful of the
age — so any sovereignty rule anchored on CITY_TIER (city-led secession, adoptAndFound
founding) can only ever mint a handful of seats. The label is fine as a label; as a
*sovereignty gate* it hard-caps the polity count at ≈ member-count of the top of the
settlement hierarchy.

**3. Primary state formation is fuel-starved by a timing scissors.** Statelessness is
plentiful early (47% of pop at step 1000) but org is below `ORG_STATE_MIN=0.15` — no
one may found. By the time org crosses the bar (~step 4-5000), the cradle realms'
claims + the connected-extension adoption channel (crystallize: a village founded by a
realm's people joins that realm) have consumed the fuel: stateless pop is ~7% by 6000
and ~1% from 10 000 on. The whole run mints THREE frontier states. Note the asymmetry:
a *people* below the statecraft bar cannot found a state, but a *realm* whose org is
below that same bar (the cradles at org 0.11, 9–18 members by step 3000) claims and
adopts without limit.

**4. The tech-reach subsystem is DORMANT — measured, not suspected.** Instrumenting
`computeCountryTerritory`'s seed loop (step ~2000): every seed's basin =
`integMin` floor = 2 cost-units; the ramped national budget (`full`) is 1.2–2.0. The
formula `reach = max(integMin, full × min(1, √(urbanPop/2500)))` multiplies three
throttles — `REACH_SIZE_MIN=0.25`-scaled budget, `√(urbanPop/2500)` ≈ 0.1–0.45 all
game (urban cores never approach 2500), and `BUDGET_RAMP` from `min(target, BASE=4)` —
whose product sits BELOW the floor for every realm at every stage measured. Direct
proof: `SIM_REACH_BASE=99` (25× the base) and a trial `CLAIM_POP_REF` 2500→500 both
produce a 15 000-step trajectory that differs by **±2 tiles at step 14 000, zero
before**. Political territory is therefore *flat member bubbles* (+`REALM_GAP_FILL`,
enclosed-waste fill, capital recolor); org/logistics/personality/value-pull reach
differentiation never engages. **The only live size lever is member count** (hold
capacity, conquest.js) — which is why realms read as uniformly-sized blobs that grow
by absorbing members.

## Trial results (the negatives matter)

- **`FRONTIER_FOUNDING=3`**: frontier foundings 3→7-11; mid-run count 10→14; but the
  extra statelets are conquest fodder — by 15 000 the run ends with **11 countries
  (fewer than baseline's 14), max realm 1849 tiles (vs 806), largest-empire share of
  claimed land 40% (vs 18%)**, and the stylized suite returns **3 soft warnings
  (budget 2) — FAIL**: tech~cradle-distance −0.09 (diffusion signature washed out),
  growth-acceleration inverted, market-integration inverted. Default change REJECTED.
- **`SIM_REACH_BASE=2/99`** and **`CLAIM_POP_REF→500`**: byte-identical trajectories
  (see finding 4). These are not levers today; treating them as levers is a trap.

## What would actually move it (mechanism work, not dials)

1. **Re-couple sovereignty to something the world actually produces.** CITY_TIER
   sovereignty + the floating city bar pins the seat supply at ~4. Either the bar
   stops gating *sovereignty* (only labels), or seats derive from function
   (administrative centres of provinces past the capital's reach) rather than a
   relative size label.
2. **Close the founding scissors.** Symmetric statecraft: a realm's *adoption/claim*
   capacity below `ORG_STATE_MIN` should be as limited as founding is (the cradle
   exemption is currently absolute), so the frontier stays stateless long enough for
   org to arrive — the historical archipelago phase. (This also directly shrinks
   early realm size: 9–18-member org-0.11 cradle realms are the anachronism.)
3. **Revive or retire the reach subsystem.** If reach differentiation is wanted (it is
   — it's the designed size mechanism), the three compounding throttles must be
   recalibrated so `full × popScale` crosses the `integMin` floor for developed realms
   at BOTH grids — NB the git-history warning that empire size is resolution-sensitive
   (`SIM_REACH_ORG` 14→26 over-inflated at app resolution): calibrate at 1920, not
   only 240. If it's not wanted, delete it honestly rather than shipping dead code
   that reads like the size dial.
4. **The settlement count itself** (42–70 at 480; ~235 at the full-Earth 30k run) is
   the deep bound on any count target — that's crystallize spacing / DISSOLVE_FARMS
   territory, with sim-wide blast radius; treat as its own project.

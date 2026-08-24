# The lever audit — everything not on, or not acting (2026-08-23)

Owner: *"review EVERY SINGLE LEVER or VALUE in the sim that is either not on or
not acting."* The schema holds **416 levers; 31 sit at 0**. Every one of the 31 is
classified below with its recorded reason, and section B lists the mechanisms that
are ON but measured inert. Sources are the levers' own descs, the docs they cite,
and this session's probes. (`SEAT_ADMIN` was the 32nd — flipped ON with this
audit, SAVE_VERSION 41.)

## A1. OFF because 0 IS the design (not disabled — the shipped value)

| lever | why 0 is correct |
|---|---|
| `FARM_MAX_TIER` | 0 = only farming regions farm; cities BUY grain (Rome's Egyptian wheat). The design. |
| `FISH` | Owner directive 2026-08-14: "remove fish as a food source entirely". |
| `FORT_GARRISON_REF` | 0 = scale-honest (derived from the age's own armies); >0 restores a legacy absolute. |
| `LUX_VILLAGE_FRAC` | Villages buy no luxury — subsistence realism. |
| `SPAN_TECH` | TURNED OFF 2026-07-30, owner decision on measurement (double-corrected the same symptom as the food-overlay retirement). |

## A2. OFF as retired legacy / instruments (flipping restores an old regime)

`ERA_PROD_SCALE`, `TIER_SCALE_REF`, `FISH_RATE` (retired references),
`CRADLE_EVE` (the pre-dawn-live seeded head start), `CROP_HOMELAND` (a
decomposition instrument, kept for its answer), `TRUCE_TRADE_OWN` (alternative
reference for the truce trade term).

## A3. OFF because measured and REJECTED — do not flip without new evidence

| lever | verdict |
|---|---|
| `INVENT_FIELD` | "MEASURED AND IT DOES NOT WORK — kept for the evidence, do not enable." |
| `MARCH_LAW` | Phenomenon already delivered by war physics (atlas-gap cause IV). |
| `CREST_HOLD` | Refuted at claim time (atlas-gap laps 1-2). |
| `STATE_OPEN` | Three inert laps — the excess lived in claim size, not formation. |
| `STATE_WORKS` | Refuted as a size lever (more radius without apparatus just overextends). |
| `COURT_SPHERE` | THIS SESSION: null at tw=480 — the contagion is saturated at shipping density. |
| `ENGULF_BAR` | THIS SESSION: fires but the speck stock is inflow-limited; count unmoved. |
| `CITY_STORE` | Superseded — under FED_FAMINE the crater class it targeted is non-lethal. |

## A4. OFF awaiting their own waves (built phases, not failures)

`IDEA_FIELD` (design-idea-field phase 1 — "the land can forget"),
`LABEL_BIRTH` (Tier-C market-site ledger), `MARGINAL_HOLD` (per-tile extent),
`REACH_STRAIN` (the third member of the budget-refusal family, below).

## A5. OFF with STALE VERDICTS — the re-measure shortlist, in order

These were judged in worlds that no longer exist (pre-DAWN_LIVE, pre-PEER_SEATS
15x register, pre-BORN_OF_LAND, pre-SEAT_ADMIN). Their reasons-for-0 may have
dissolved; each needs its own battery, never a blind flip.

1. **`SEAT_FIELD`** — measurably BETTER when judged (fewer nationless cities,
   same realm count) and blocked ONLY on seed 777's third soft warning, in a
   ~20-realm world. The register is 15x denser and the political map twice
   rebuilt since. Also retires the unreachable `NUCLEATE_SEAT_POP` bar (B, below).
2. **`FISC_ADOPT` / `ADOPT_BUDGET`** — the court-refusal machinery, off since the
   bare strain gate measured a fiscal death-spiral. That measurement was made
   against the BROKEN ledger (load 20x capacity, headroom never evaluated).
   Under SEAT_ADMIN the strain number means something for the first time;
   refusal semantics also decide what BORN_OF_LAND does with unaffordable mints.
3. **`FOREST_LOCK`** — targets exactly the owner's temperate-Europe carpet
   ("stone-age Europe filled to half-mature farm density"). Its 2026-07 verdict
   was "not the fix for PAINT sprawl" — but today's complaint is the CITY
   carpet, the capacity-carried half it DID move (Europe pop −10%). Known
   weakness recorded: the moisture proxy reads Europe as only ~40% canopy, so
   the lock bites a third of capacity at most; atlas-gap names its flip as a
   standing dependency of the statehood gradient.
> **RE-MEASURE LADDER VERDICTS (2026-08-24):** rung 1 `SEAT_FIELD` PASSED and
> SHIPPED (SAVE_VERSION 42 — the 777 blocker reads 0 warnings on the current
> tree). Rung 2 `FISC_ADOPT`/`ADOPT_BUDGET` FAILED (refusal mints confetti:
> singletons 50%→55%, nations 98→112). Rung 3 `FOREST_LOCK` FAILED on the clean
> pair (Europe −16% but the STEPPE MORE THAN DOUBLES, 19→42 — displacement, the
> COURT_SPHERE conservation law; waits on a real vegetation field). Rungs 4-5:
> see below — the levers are GHOSTS.

4. **`RIVER_REACH`** — "the river as an administrative spine... the mechanism
   that let a single state govern the 1000 km Nile." Removed 2026-07 as
   "over-concentrates" — measured when over-concentration was the disease. The
   disease is now the opposite, and the Egypt-shaped state remains missing.
5. **`CAP_GEO`** — heartland capacity advantage (a Nile/Mesopotamia core holds a
   structurally larger empire). Removed as "fattens the biggest realms" in the
   uniform-attractor era; it is also precisely the cradle-first consolidation
   term the statehood-gradient item asks for.
6. `TRUCE_TOLL`, `PASTORAL_IND` — small, unmeasured, plausible; low priority.

> **RUNGS 4-5 VERDICT (2026-08-24): `RIVER_REACH` and `CAP_GEO` are GHOST
> LEVERS.** The Egypt trio came back byte-identical across all three arms —
> and the grep confirms why: **zero consumers in src/**. The 2026-07 flip
> campaign "removed with code paths" (its own words) — the schema entries
> survived the code they governed. They are not off; they are DISCONNECTED.
> Re-shipping either means re-BUILDING the mechanism (RIVER_REACH's valley-
> spine claim cost, CAP_GEO's heartland capacity term), a design lap, not a
> flip. The audit's A5 shortlist is hereby corrected: its live members were
> SEAT_FIELD (shipped), the refusal family (failed), FOREST_LOCK (failed);
> the ladder is COMPLETE.

## B. ON but measured NOT ACTING

| mechanism | state | source |
|---|---|---|
| `CAP_SEAT` seat capacity payback | p50 **0.01** at both grids (SIZE_REF = one million people) — the "regional seats extend the budget" design is inert; SEAT_ADMIN now carries delegation on the LOAD side instead | probe_capledger |
| `hasAbsorbHeadroom` | was 0 evaluations in ~10,000 candidates (ordering bug) — **FIXED, now acting under SEAT_ADMIN** | probe_absorbbar |
| `ENGULF`'s purpose | the hazard half acts, but an engulfed speck still never REACHES the 5x bar (`resistanceNotHopeless` runs first) — 11 of 20 map specks held there | probe_specks |
| `NUCLEATE_SEAT_POP` = 160 | unreachable: **0 stateless cities clear it at any checkpoint** — throttles the basin nucleation channel while SEAT_FIELD=0 | state-birth-2026-08 |
| `maybePlantTowns` | zero plantations by step 8,000 (PLANT_CAP_MIN_POP 500); ~a quarter of cities by 25k — the nations-create-cities channel opens only late | state-birth-2026-08 |
| `CAPITAL_COURT_MOVE` | dead code — lives in `maybeUrbanGenesis`, whose first line returns under DISSOLVE_FARMS=1 | state-birth-2026-08 |
| capacity momentum | p50 0.0 at rest — by design (conquest streaks only) | probe_capledger |
| integrate / submit lanes | acting at 2-3% pass with named blockers (orgBelowMin, beyondDirectRule, hazard clock) — throttled, not broken | absorbbar arms |

## The honest caveat

"Not acting" above means MEASURED inert, with the instrument named. The other
~380 levers at non-zero defaults have not been individually activity-audited;
the telemetry funnels (telemetry.js) are the tool for that, one subsystem at a
time. This audit covers everything at 0 and everything this month's probes
touched.

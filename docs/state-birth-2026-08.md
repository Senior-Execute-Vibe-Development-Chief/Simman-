# Where nations come from — the state-birth ledger, and SEAT_FIELD

Directive (owner, 2026-08): *"Should we decouple settlements from nations in the
way we currently have it? A nation does not need a city to form, nations create
cities, not the other way round."* — and, standing: *"settlements are ONLY
cities"* (villages are implied in the land; see `src/sim/units.js`).

It follows `docs/settlement-fabric-2026-08-02.md`, which diagnosed the same
world from the settlement side — 90% of the early world stateless and holding
80% of its people, a founding bar 6.4× the size a settlement is born at, and no
settlement fabric at all — and closed with two candidate fixes: *lower the
nucleation bars* (cheap, and a second-cardinal-rule violation) or *let a
settlement outside every realm be its own polity* (mechanism-true, but the owner
judged it would mint far too many legitimate polities). This document takes the
third route the directive above points at: **stop asking the seat how big it is,
and let the land answer instead** — no bar is lowered, one is removed because it
was measuring the wrong thing, and the land test that was already there decides.

What is recorded here is what the sim was actually doing, measured rather than
assumed, and the mechanism change that follows.

## The measurement instrument

`tools/probe_statebirth.mjs` — one run, three readings per checkpoint:

1. **Founding channels** — the `polity.founded` ledger by `how`, plus a
   `selfFound` telemetry marker, because BOTH wilderness founding paths log
   `how:"frontier"` and the event log alone cannot tell them apart.
2. **The funnels** — `nucleate` (state birth) and `birthPolity` (what flag a new
   city gets), tallied at the rejecting lines, reset per window so each reads its
   own regime instead of the run's cumulative average.
3. **The bars in units** — every stateless city's census against the seat bar it
   must clear, and the unclaimed basin mass under it against the basin bar, both
   normalised so ≥1 means "clears".
4. **Urbanisation** — read off `s._urbanPop`, not `s.people`. The first version
   read the catchment census and printed 100% at every checkpoint; that is a
   tautology (the global census↔field ratio is *defined* to make those equal) and
   it is what exposed the unit note's gap. See `src/sim/units.js`.

Plus `tools/probe_seatless.mjs`, which sizes the "a nation forms where there is
no city at all" case directly.

## What the sim was doing (480, seed 8817, step 8000, defaults)

    realms 20   cities 71   stateless cities 43 (61%)

    founded by channel (cumulative):  frontier=15   cradle=4   restored=0
    births this window:               basin(nucleate)=3   city-self-founds=11
    new cities' flag this window:     considered=17  motherIsStatelessToo=10 (59%)  flagged=7 (41%)
    state-planted towns (cumulative): planted=0   blocked: capital-too-small=129, org=8

Read together, that is the causation the directive objects to, quantified:

- **Cities create nations.** Every realm beyond the four genesis cradles was
  born in the wilderness, and the channel that mints them ~4:1 is
  `adoptAndFound`'s self-founding path — a stateless city minting a realm on the
  strength of **its own census**, with no test whatsoever of the country it
  would rule. It is the only birth path in the sim with no land behind it.
- **Nations create no cities — until late.** `maybePlantTowns`, the march/charter
  plantation, is the one channel where a state founds a city, and it had planted
  **zero** by step 8000, every check blocked on `PLANT_CAP_MIN_POP = 500`
  census. By 25000 it has planted 25 — about a quarter of the world's cities —
  so the direction does exist; it simply cannot open until capitals are large.
- **The seat bar, not the land, was the binding gate on the other channel.** The
  basin channel rejects **73–93%** of candidates on `NUCLEATE_SEAT_POP = 160`
  census, with the comment "a real regional centre (a large village / town)"
  beside it. In this sim's units that is 160,000 people in the seat's
  **catchment** — the city and the countryside it farms together (see
  `src/sim/units.js`; `s.people` is the catchment census under `ONE_POP`, not
  the city's own residents). Not one stateless city clears it at any checkpoint
  measured — 0 of 38, 0 of 43, 0 of 39, 0 of 30. `BIRTH_FIELD` had already moved
  *viability* onto the land in 2026-07; leaving this bar on the seat meant the
  land's verdict was never the one that bound.
- **Statelessness is inherited.** 59% of new cities are born flagless because
  their mother city is flagless. A stateless city begets stateless cities.

### The seatless case is inert — measured, not assumed

Spec §4b designs nucleation at unclaimed `popField` maxima with the seat
*created* by the founding (survey open question 5). `probe_seatless` sizes it:
scanning all unclaimed land for basins that clear the founding mass bar and
splitting them by whether a stateless city already stands in them —

    step 2000: 0 viable basins        step 6000: 0        step 12000: 1, of which 0 seatless

Peopled land grows cities (crystallize's own basin bar is comparable to the
state bar), so a basin that can carry a state essentially always already holds
a city. **Machinery to found a state with no seat and plant its capital would be
dead code in this regime**, and is deliberately not built. The literal reading
of "a nation does not need a city to form" is therefore satisfied the other way:
the city's *existence* is no longer what qualifies the land — it is only where
the court sits — and the sim is measured, not argued, into that position.

## The change — `T.SEAT_FIELD` (graded, default off)

**One founding test, asked wherever a state might be born: does the LAND here
carry a state?** Two helpers in `countryTerritory.js`, extracted verbatim from
`nucleateFrontierStates` (same operations, same order, so lever-off is
byte-identical — verified on the hashbase pair `8529d003`/`c0a7ad90`):

- `stateCapacityMul(world, s, ti)` — how much more population this ground needs
  before it can carry a state (carrying capacity, wet tropics, iron-less
  temperate forest raise it; broken terrain lowers it).
- `statelessBasinCensus(world, s, f2c, r)` — the people of the unclaimed basin
  around a prospective seat, in census units.

**`SEAT_FIELD = 1`** — the seat's own bulk stops gating the basin channel. What
remains of the seat requirement is what genuinely belongs to a court: it is a
settled city, it has the statecraft for territorial rule (`ORG_STATE_MIN`), and
it leads its basin. The basin decides how big a state the ground can carry.

**`SEAT_FIELD = 2`** — the wilderness self-founding path asks the same question.
Its census bars (`forestBar`, and the tier-lock escape clause that existed only
so a census bar could substitute for a tier a stateless city can never reach)
are replaced by the shared founding test.

### Why 2 is a re-grounding and not a deletion

The survey's C2 note called for retiring the self-founding path outright. That
was tried first and **measured badly** (480/8k):

| | realms | cities | stateless cities |
|---|---|---|---|
| off (default) | 20 | 71 | 43 (61%) |
| seat bar removed (=1) | 21 | 69 | **39 (57%)** |
| self-founding *deleted* | 14 | 71 | **49 (69%)** |

Deleting it lost a third of the world's realms *and* raised statelessness: the
basin channel cannot absorb the load, because its capital-distance and
basin-leadership gates reject precisely where the other path fires. So the path
keeps firing — it just stops being allowed to answer a different question from
everyone else. (Second cardinal rule: build the mechanism both channels share,
don't delete one and hope.)

## The three-arm result (480, seed 8817, 25000 steps)

    step     SEAT_FIELD=0            =1                      =2
             realms/cities/stateless
     2000     4 / 55 / 51            4 / 55 / 51             4 / 55 / 51
     4000     6 / 61 / 55            6 / 61 / 55             6 / 61 / 55
     8000    20 / 71 / 43           21 / 69 / 39            23 / 71 / 40
    12000    32 / 82 / 30           31 / 81 / 24            26 / 80 / 28
    25000    39 /109 /  4           39 /109 /  4            39 /108 /  8

**`=1` is the default.** It is strictly better or equal on every axis measured:
the same realm count with fewer nationless cities through the whole middle of
the run (43→39 at 8k, 30→**24** at 12k), and it converges to the identical
endpoint. **`=2` is not**: it costs realms (32→26 at 12k) and ends with twice
the statelessness. Kept in the lever because it isolates the second half of the
mechanism for future work, not because it is currently an improvement.

## Gate status — the lever ships OFF

- `npm test` green.
- `npm run resgate` (SEAT_FIELD=1): **all five app-grid bands hold** — app/ref
  median realm area 0.57 (floor 0.42), claimed land 0.55 (0.44), density 0.54
  (0.40), app median realm absolute 210k km² (floor 60k), app realm count 17
  (floor 6).
- `npm run validate`, 3 seeds: 8817 and 4242 pass all hard gates at **1 soft
  warning** each (budget 2) — better than the default's recorded 2. **Seed 777
  goes over budget at 3.** Measured against its own baseline:

      seed 777, SEAT_FIELD=0 :  Zipf n/a · fallen-polity lifespan          → 2 (at budget)
      seed 777, SEAT_FIELD=1 :  Zipf n/a · fallen-polity lifespan
                                · market integration narrows prices (Δ) -0.25   → 3 (over)

  Two of the three are pre-existing on that seed. The third is **new**: the
  first-difference correlation between component drops and price dispersion goes
  to −0.25 against a −0.2 bar, i.e. in the windows where the trade network knits,
  spread widens slightly instead of narrowing.

Per the repo's own flip discipline — 3 seeds, all hard gates, soft warnings
within budget — **the default stays 0.** The lever is built, byte-identical off,
and measurably better on the axis the directive targeted; it is not yet clean
enough to be the world. What it needs before a flip is an explanation of the
market-integration term on that seed (a realm-count/regime artifact, or a real
coupling from the founding change into trade-network topology), not a wider band.

## What this does NOT fix — the early game is gated on something else

The three arms are **bit-for-bit identical for the first ~5000 steps**: 4 realms
and 55 cities at step 2000 in every arm, 6 and 61 at step 4000. The funnel says
why — `org < ORG_STATE_MIN` rejects **100%** of candidates at step 1000 and 99%
at step 2000. No city anywhere in the world has the statecraft to found a state
yet, so no founding gate downstream of it can matter.

So the specific complaint that started this — *"the world covered in settlements
that don't belong to a nation, especially early game"* — is **not** caused by
the seat bar, and nothing here touches it. At step 2000 the world holds **55
cities and 4 states**, and 96% of new cities are born flagless from a flagless
mother. The city supply is a demographic process (crystallize's wave of advance)
with no political gate at all; the state supply waits on organisation. The two
run on different clocks and the cities win by an order of magnitude.

Under "settlements are ONLY cities" that gap is the thing to examine next: a
wave of advance spreads *villages*, and villages already live correctly in
`popField`. What it currently mints at the frontier is a CITY. The `birthPolity`
funnel measures that channel; `probe_statebirth` reports it every checkpoint.

---

# The capital as a SEAT OF POWER (owner proposal) — what the code already has

Directive: *"consider making 'The Capital' be a special settlement type, that can
represent simply the seat of power, be it village or horde or city, whatever."*

## Most of the architecture is already there

- **National power already divides the capital's size out.** `fieldPowerOverlay`
  computes `governed people × (settlementPower(cap) / cap.people)`, and since
  `settlementPower = people × mil × org`, that second factor is pure **court
  competence**. A realm's coercive weight is its people; the seat contributes
  only how well they are administered. The comment beside it already says
  "a horde's might is its PEOPLE ON THE STEPPE, not its (few) towns".
- **Hold capacity is already field-grounded** (`capPowerCap` reads the governed
  region, not the capital).
- **`_nomadic` realms already exist**, derived from where the majority of
  governed people live plus the court's mobility and herds — and `_sovereignSeat`
  already means "carries sovereignty though it never reached city tier". Steppe
  camps are already born at 18–25 census as tier-0 non-town entities, so the sim
  already HAS courts that are not cities; it just cannot found one.

The only live consumer of the capital's own census is **`relPow`**, the
great-power dominance tail. `coerce` is dead under `HOLD_ARMY = 1` and
`thronePower` already reads the throne's *province*. So a village- or ordu-seated
realm would price correctly everywhere except its dominance tail, and that takes
the same governed-region, median-anchored treatment applied twice already.

## A claim of mine that the measurement did NOT support

Reading the code, the deliberate court-relocation mechanism (`CAPITAL_COURT_MOVE`
— "the court's treasury and the capital garrison move there") turns out to be
**dead in the shipped game**: it lives in `maybeUrbanGenesis`, whose first line is
`if (T.DISSOLVE_FARMS) return;`, and that lever defaults to 1. `rebuildCountries`
then re-derives `c.capital` from scratch every polity pass as the strongest
member. I inferred from that the capital must churn — re-landing on whoever grew
biggest. **`tools/probe_seat.mjs` says it does not:**

    step 12000, 32 realms:  7 capital changes in the whole run
      rate 0.04 per realm per 1000 steps  (~one per realm per 25,000 steps)
      why: seatDied 4 (57%) · overtookInPlace 2 · joinedBigger 1

So the architecture PERMITS teleporting and nothing anchors the seat, but
behaviourally it is near-inert. The seat rule is loose, not chaotic. (When a
non-death move does happen it is ugly — p50 jump 899 km on a census ratio of
1.06, a dead heat moving a capital across a continent — but that is 3 events in
12,000 steps.)

## So the case for a seat entity is ontological, not churn

1. **A realm cannot exist without a city.** The seat must be a member settlement,
   members are cities, so no chiefdom, horde or village-seated polity is
   representable at all — the last coupling standing between the sim and spec
   Phase 4's stated goal ("I should be able to entirely remove settlements and it
   wouldn't affect a country's growth, land, anything").
2. **Every court counts as a city** in urban statistics, Zipf and city counts.
3. **There is no institution to move.** A court cannot be founded, relocated or
   lost as an act of state — no Baghdad, no St Petersburg, no ordu.

### V1 shape

A seat is a settlement with `kind: "seat"`, **minted by the founding** at the
founding people's own scale (the camp branch's `18 + roll`, not `TOWN_FOUND_MIN`'s
90), not selected from members — so it rides trade, food, culture and dynasty
unchanged instead of needing a new entity class. It wins capital selection
regardless of size; below the urban floor it is a court and is excluded from
urban statistics; it grows into a capital *city* by ordinary dynamics with no
special case, which is the Baghdad arc and is literally "nations create cities";
and if its polity ends while it is still sub-urban it withers rather than leaving
a ruin city. That also makes "settlements are ONLY cities" precise instead of
violated: entities are cities, **plus** the seats of power.

## The finding that outlives the change

**The stateless-city population is a STOCK, and its size is set by the birth
inflow, not by the founding outflow.** Doubling the founding channel and
retiring it both leave the standing count where it was (30 at step 12000 in
each). The inflow is `crystallize`'s frontier extension — the demographic wave
of advance — and 59% of what it mints is born flagless from a flagless mother.

Under "settlements are ONLY cities" that is the anomaly worth naming: a wave of
advance spreads *villages*, and villages already live correctly in `popField`.
What it currently mints at the frontier is a CITY. Nothing here changes that;
it is recorded as the next mechanism to examine, with the funnel
(`birthPolity`) now in place to measure it.

---

# The wilderness "towns" are hamlets — the tier ladder measures the countryside

Owner, watching the running sim: *"there is still dozens of 'towns' spawning very
early game in wilderness, with no nation attached."*

`tools/probe_towns.mjs`, 480/8817, puts the label beside the thing it names:

    step   settled  labelled     catchment    URBAN CORE    core     core-based
                    town/city    census p50   p50 (p90)     share    ladder says
     500     33      33 / 0         13k       422  (9k)     3.8%     0 towns, 0 cities
    1000     42      42 / 0         14k       453  (3k)     4.3%     0 towns, 0 cities
    2000     55      55 / 0         22k       881  (9k)     4.4%     0 towns, 0 cities
    4000     61      60 / 1         34k        2k  (6k)     4.4%     0 towns, 0 cities
    6000     68      65 / 3         63k        3k (10k)     5.1%     0 towns, 0 cities

**At step 2000 the median "town" has an urban core of 881 people.** That is a
hamlet. Its catchment holds 22,000 — the countryside it farms — and the label is
being computed from THAT. The single "city" at step 4000 has a core of 9,000
against a catchment of 339,000: a large village called a city.

Not one settlement in the world clears the town floor on its actual urban core at
any checkpoint through step 6000. The final column runs the same ladder against
`_urbanPop` at the same floors (60/240 census): 0 towns, 0 cities, everything
below the town bar.

## Why

`updateTier` sets the bars from percentiles of `s.people`, and under `ONE_POP`
that is the **catchment** census — the urban core plus every villager in the
district it works (`src/sim/units.js`). So the ladder ranks settlements by how
peopled their COUNTRYSIDE is and names the result a town. Two things compound it:

- Under `DISSOLVE_FARMS = 1` (shipped default, which abolished tier 0) every new
  settlement is born `tier: 1`, commented *"born URBAN — a market town, not a
  village"*. It is granted by fiat, with no test that anything urban is there.
- The sim's own economy **already disagrees with its own label**: the
  agglomeration pass gives `uTarget = 0` to any place that imports no food from
  beyond its own land — *"Non-importers (kBeyond = 0) have no target — they stay
  rural, as the ontology says."* A fresh wilderness founding has no trade links.
  So the economy says rural, the label says town, and the label is what is drawn
  on the map.

## What this is NOT

It is not the founding rate on its own, and it is not the state-birth bars —
`SEAT_FIELD` is provably inert here (all three arms are identical to step 5000).
The visible complaint is a measurement error wearing a label: the world is not
minting dozens of towns, it is minting dozens of villages and calling them towns.

## The fix, and why it is not just a rename

Two changes, one honest, one structural, and they want measuring apart:

1. **The ladder must read the core.** A settlement's tier is a claim about the
   settlement, and the settlement is its urban core; the district it farms is
   countryside. Switching `updateTier` to `_urbanPop` requires re-deriving the
   floors, which were calibrated on the census — on the core scale a town floor
   of ~2 census (2,000 people) and a city floor of ~10 (10,000) are *definitions*
   of the words, historically anchored (Uruk at ~40,000 was the largest city on
   Earth), not constants fitted to an outcome.
2. **The founding should test whether an urban core CAN form**, not whether
   people are present. `TOWN_BASIN_MIN` counts basin people; the mechanism that
   actually decides urbanity — surplus that can be concentrated, i.e. `kBeyond` —
   is already in the code and is not consulted at founding. Under "villages are
   implied in the land", a basin that can people itself but not concentrate a
   core should stay field, with no entity at all.

**Risk, recorded before touching it:** tier is not only a label. `CORE_BY_TIER`,
`HINTERLAND_BY_TIER`, `ARMY_TIER_FRAC × people`, the food hierarchy's haul ranges
and `adoptAndFound`'s `(s.tier|0) >= 1` all read it, and `updateTier`'s own
comment records a previous label-supply change that pinned everything to tier 0/1
and "collapsed the whole tier-keyed stack". This needs a lever and the full gate
set, not a one-line edit.

## BUILT (T.CITY_CORE, 2026-08-05) — and the bug the first measurement caught

Fix #1 above shipped in two halves, both behind `CITY_CORE` (def 0,
byte-identity 7173d965/b4030359 verified three times as the mechanism grew):

1. **Re-ranking alone, measured insufficient** (recorded in the lever desc):
   ranking `_urbanPop` under the same percentile bars moved label COUNTS
   (87/4 towns/cities → 72/23) but still called 26 hamlet-cored settlements
   "cities" at step 3000 — a percentile bar mints its fixed share of labels in
   ANY distribution. The bar itself was the second half of the bug.
2. **Absolute core floors as definitions** (`TIER_CORE = [0, 2, 10, 40]` census
   units): a town IS a ~2,000-person core, a city ~10,000, a metropolis floored
   at 40,000 (Uruk at its height) while still floating at 0.8× the age's
   largest core. Tier 0 exists again as a LABEL — a village — not the legacy
   farming-region entity: it farms under DISSOLVE, but plans no trunk roads
   (`ROAD_MIN_TIER` bites again), anchors no wilderness sovereignty, founds no
   organized faith, and musters the village army fraction.

**The bug the first honest run caught: the ladder was reading the MODEL, not
the MEASUREMENT.** `_urbanPop` has two writers each tick — the census-side
`ruralShare` heuristic in `updatePopulation` (a ratio model), then the field's
`diskSum` over the core footprint in `deriveOnePop` (the measurement, which
"overrides the heuristic each tick"). `updateTier` runs INSIDE the settlement
pass, immediately after the heuristic write — so the first CITY_CORE arm minted
a "city" at step 1 and metropolises at 3× their field core (a 576k-catchment
settlement whose heuristic split cleared the 40 metro floor while its measured
core held 13k). The fix is a separate `s._coreMeasured` stamped only by the
field derive, which the ladder alone consumes — with a null guard so a fresh
birth or a just-loaded save keeps its tier until the field first measures it,
instead of falling back to catchment units against core bars.

The same audit caught a second units mix: the CITY_CORE branch had overwritten
`world._townBar/_cityBar` — public quantities documented as the age's typical
town/city CATCHMENT census, which `maybePlantTowns`' relative capital bar
(PLANT_EARLY) consumes — with core-unit floors, collapsing the plantation gate
to a fifth of a typical town. The percentile pool now ranks the catchment
census under every regime; the core floors are local to the ladder.

## Measured (arc probes, `tools/probe_cityarc.mjs` + `probe_towns.mjs`)

480/8817/6k, CITY_CORE=1 vs OFF, the owner's symptoms one by one:

| symptom | OFF (shipped) | ON (honest ladder) |
|---|---|---|
| stone-age cities | first "city" step 145, metallurgy 0.01 | first city **step 2720**, metal 0.05 (chalcolithic — the Uruk moment), and it is **Nawaxexi, the wheat hearth** |
| cities born | pinned 4-6 all run (percentile quota) | **0 → 1 → 5 → 7 → 11**, monotone; 16 town→city promotions as real chronicle moments |
| label honesty | "metropolis" with 924k catchment, 4k core | city class core p50 **11k**, metro **39-41k** — every label names its thing |
| wilderness cities | 0-3/checkpoint | **0** at every checkpoint (1 at final) |
| early road web | 255 tiles @ step 500 | 217 (−15%): trunk planning now waits for real towns; the remainder is the kin-path lattice, which serves villages by design |
| tier pyramid @6k | 0 vill / 87 town / 4 city / 1 metro | **16 / 51 / 11 / 1** |

Seed 4242 replicates (first city 2928 at metal 0.05, zero wilderness cities,
no metro by 6k — a slower world, honestly told). The app-proxy grid W=960
(tw=480) holds the arc in KIND: first city 1166 (the finer grid resolves dense
cores earlier — metal 0.02, still pre-bronze), first metro 3344 at core 41,
pyramid 8/39/32/4, wilderness ≤4. No cross-grid kind-difference; the floors are
people-counts, not tile-counts.

**The side effect that needs its own verdict: statehood.** Honest tiers close
the everything-is-a-town sovereignty shortcut (`tierLockedCentre`, city
auto-anchors). At 6k/8817/480, properly attributed (the commit note quoted the
heuristic-core arm's 77 as if it were the baseline — corrected here):

| arm | realms @6k | nationless |
|---|---|---|
| OFF (shipped ladder) | **45** (19 → 45 rising) | 42% |
| CITY_CORE, heuristic-core bug | 77 | 15% |
| CITY_CORE, measured core | **20** | 59% |

So the honest ladder halves the realm count against the shipped baseline. At
metallurgy 0.13 — chalcolithic — ~20 city-states over a mostly stateless
countryside is closer to the record than 45 (states bloom WITH cities; that is
the Uruk story). The open question was whether statehood catches up as
organization spreads — the nationless towns are blocked on the frontier
census bar (`forestBar ≥ NUCLEATE_SEAT_POP`, the bar CLAUDE.md records as
measurably unreachable) and on `ORG_STATE_MIN`, both pre-existing conditions
the inflated ladder was masking by letting every dawn "city" self-anchor.

**Answered on a 16k arc (480/8817, CITY_CORE=1): statehood does not merely
catch up — it overtakes, with the historical shape.**

    step   realms  nationless   cities   lead org
     500     10       71%          0       0.14     ← the hearth cradle states
    3000     10       84%          1       0.18     ← settlement outruns statehood:
    5000     13       77%          7       0.23        the PRE-STATE farming world
    8000     33       44%         15       0.30
   11000     46       25%         31       0.37
   14000     64       17%         40       0.44
   16000     71        9%         64       0.49

Ten realms hold through the whole pre-urban dawn while nationless settlement
peaks at 84% — then, as organization crosses ~0.23, realms climb essentially
linearly with it and the countryside is progressively absorbed: 71 realms and
9% nationless by metal 0.30 (iron age). The shipped baseline reached 45 realms
by step 6000 and its realm count tracks its (inflated) town count; the honest
ladder ends with MORE states, LATER — few and small at the dawn, multiplying
with statecraft. That is the owner's "countries too large too early" fixed
from the state-birth side, and it fell out of the label becoming honest — no
statehood mechanism was touched.

The tier pyramid's top end thickens late (64 cities > 47 towns at 16k): the
floors are fixed definitions and the settlement-size distribution slides up
through them, exactly as the real one did (the iron-age Old World held dozens
of 10k+ cities where the bronze age held a handful). The metro bar floats at
0.8× the age's largest core, so metropolises stay rare (3-8) instead of the
whole city tier crossing a fixed bar into a metro glut.

# The early towns are in the wrong PLACES — and the first fix failed

Owner, watching the sim: *"most of them are in inaccurate locations, is it
possibly caused by a founding wave that happens early or something?"*

## Two probes, and the first refutes the obvious theory

`tools/probe_siting.mjs` — siting is **not** a blind scatter. Sites carry median
tile fertility **0.72–0.99 against an all-land median of 0.033**, ~25×, and 85%
of the first cohort is on a river. There is no early-worse gradient either: the
earliest cohorts are the *best* sited (0.86–0.99), the 501–2000 cohort the worst
(0.72). The probability weighting works. What the probe does confirm is the wave
the owner suspected: **35%** of the settlements alive at step 12000 already
existed at step 500, 56% by step 2000.

`tools/probe_wheretowns.mjs` puts that wave on a map, and the error is geographic:

    step 200 — 24 settled, NINE world regions occupied
      C Asia/Steppe 5 · Mesopotamia 3 · India 3 · China 3 · Europe 3
      · C/S Africa 2 · Sahara 1 · Sahel 1
    step 500 — Siberia has a town at 67°N (founded step 264)
    step 2000 — steppe 11, China 10, Europe 10  vs  Mesopotamia 4, Nile 5

The most-settled region on the planet at the dawn is the Central Asian steppe,
historically pastoral and never an urban core. Europe holds ten towns some two
millennia before it held one. The first non-cradle founding is at **step 24**.
The land under each is genuinely good; the PLACES are anachronisms.

## The mechanism

    diffusionMul = exp(−td / 30) × NEAR_RATE(1.5)   // decays with distance to the network
    independent  = INDEPENDENT_RATE(0.020)          // a FLOOR, on every reachable land tile
    p = quality × (diffusionMul + independent) × BASE_RATE × …

Beyond td ≈ 130 the diffusion term falls below the floor and the floor dominates.
Because it is **added** to the decay, it cancels it: five thousand km from the
nearest farmer is no less likely to invent farming than 130 tiles away. Across
~7000 land tiles every sweep, "low so empty regions stay empty until colonised"
(the constant's own comment) becomes one neolithic origin per fertile valley.

## `T.INVENT_FIELD` — built, measured, DOES NOT WORK

The reasoning was that invention's opportunity is people-time, so the floor should
scale with the basin's population against `TOWN_BASIN_MIN` — the bar the sim
already uses for "enough countryside to carry a town", so no new constant. Built
behind `T.INVENT_FIELD`, byte-identical off (`8529d003`/`c0a7ad90`). Measured:

    step   settled (off → on)   regions (off → on)
     200      24 → 35              9 → 9
     500      33 → 40             10 → 11
    2000      55 → 65             10 → 11

**Worse.** More settlements, the same or wider spread, the steppe still 11 at
step 2000 and Siberia still settled by step 264.

The reason rules out the whole approach, not just the calibration: **every site
that can found at all already clears the urban floor's basin bar**, so
`basin / TOWN_BASIN_MIN ≥ 1` at every candidate that matters and the scaling can
only ever multiply *up*. Population density does not discriminate between a
cradle founding and a Tarim-basin one — both have the people. It was the wrong
variable.

## What the failure points at

Independent invention is a **once-only act of a PEOPLE**, not a per-tile,
per-sweep chance — and the sim does not model it at all. `inheritKnowledgeAt`
hands any isolated site the full neolithic package for free:

    baseline = { agriculture: NEOLITHIC_AGRI (0.45), construction: 0.18, organization: birthOrgAt(…) }
    if (!nearest) return baseline;

So every valley on Earth is farming-capable from step 0, and "independent
invention" is not an invention — it is an assumption. Modelling it properly means
the capability living on a **people** (culture/ancestry), invented once against a
real barrier and inherited by descendants, with diffusion carrying it outward —
which is a genuine subsystem, not a constant. Recorded rather than attempted, and
the failed lever is kept default-off as the evidence that density was not it.

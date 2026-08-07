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

## CROWD_FOUND measured — the first build was degenerate, the re-grounding works

The lever answers "do cities appear where populations are dense?" as a RATE
(founding ∝ basin people), and `probe_crowdfound` scores it directly: every
founding's basin-mass ratio (in TOWN_BASIN_MIN-bar units) sampled within 50
steps of birth, 480/8817/6k.

| arm | foundings | settled @6k | site mass p50 / p75 / p90 | 2nd-half site p50 |
|---|---|---|---|---|
| OFF | 109 | 92 | 249 / 376 / 785 | 579 |
| v1: `sqrt(mass/BAR)` | 202 (+85%) | 123 | 268 / 699 / 1290 | — |
| v2: `sqrt(mass/TYPICAL)` | **96 (−12%)** | 84 | 238 / **492** / **978** | **752** |
| v2 + CITY_CORE | 79 | 76 | 288 / 561 / 1556 | 934 |

**v1's lesson (recorded in the lever desc): the bar is the floor of viability,
not the yardstick of "denser than usual".** Real settled basins run 150-3300×
the TOWN_BASIN_MIN bar, so `min(CAP, sqrt(mass/bar))` pegged the cap on 100%
of foundings — the within-settled gradient (the entire stated mechanism) was
erased, and what remained was a blunt ×CAP step on settled land vs the
frontier: +85% foundings, tail thickened purely by infill acceleration.

**v2 normalizes by `crowdRefMass` — the live median settled basin** (floored
at the bar; the same self-calibrating species as the tier ladder's percentile
bars). The signature flips to the historical one: count roughly flat (−12%,
the sub-typical frontier now founds SLOWER than baseline — the other half of
the Nile-thicket shape), while foundings reweight toward dense countryside
(p75 +31%, p90 +25%, late foundings at 752× vs 579× baseline). Same number of
towns, born where the people are; marginal wilderness sites suppressed —
which is the owner's "cities in nowhere wilderness" complaint attacked from
the founding side too. Composed with CITY_CORE the tilt is strongest (late
site p50 934, 100% on-river) with founding damped a further ~18% through the
market tier-weights (fewer dawn "towns" → weaker marketPull), cleanly — no
interaction pathology.

## DISSOLVE_TOWNS — settlements are ONLY cities (owner directive, 2026-08-05)

*"I think settlements should be ONLY cities. No towns."* DISSOLVE_FARMS part
two, and the historically right register: in 3000 BCE the whole Earth held
maybe a dozen 10,000-person cities.

**One bar, every mint path** (`cityBasinOkAt`): an entity mints only where
basin census ≥ `TIER_CORE[2]/URBAN_SHARE_REF` — a 10k core at the measured
~5% pre-industrial urban share needs a ~200,000-person market basin. Both
terms mean something alone (the ladder's city definition; the share measured
at core p50 4.6-5.6% in every probe arm, ~3-8% historically). Crystallize
founding, state plantations (checked before the settler party is debited),
and sea colonies (a sub-city shore turns the fleet home) all pay it. An
entity whose basin drops below 0.6× the bar, sustained, fades back into the
countryside — chronicled; under ONE_POP its people stay on the land as the
villages and towns they are. The hearth bootstrap keeps its own longer
emergent bar: the first cities ARE the hearth cities.

**v1 was INERT and is recorded** (lever desc): scaling the TOWN_BASIN_MIN
floor ×5 produced a byte-identical arc — that floor is a fossil two orders
below real settled basins (founding sites measured 143-3300× it). Same
units lesson as CROWD_FOUND v1, predictable from data already in hand. The
census form bites at the measured middle of the founding distribution.

**Measured (full candidate set + DISSOLVE_TOWNS, 8817):**

| | ref tw=240 @6k | app-proxy tw=480 @6k |
|---|---|---|
| entities | 41 (was 76) | 59 (was ~83) |
| dawn register | 10 hearth cradles, roads 28 | 10 cradles, roads **0** @500 |
| first city | step 2691 — Nawaxexi, the wheat hearth | step 1496 |
| city share @6k | 4 of 41 | **20 of 59 (34%)** |
| dissolutions | 5 ("faded back into the countryside") | 5 |
| realms | 9 (→52 by 16k, nationless 84→7%) | 20 |

The 16k arc holds the whole historical statehood shape at the weightier
register — ten cradle states through the pre-urban dawn, the dissolution
cull (realms 10→5 as thin-basin cradles fade), then the organization-driven
bloom to 52 realms at 7% nationless, the late map majority-city (54+1 of
102). The proxy grid's early 43k-core metropolis (step 1548) is the Uruk
case, not a bug: a hearth cradle concentrating to ~40k at late-chalcolithic
development is the record itself.

## THE FLIP (2026-08-05): the city register went live, fully gated

Owner, watching the unchanged app: *"are these changes being pushed to the
sim?"* — the wave had been built behind default-off levers by design. The
three flip together as the coherent fix: `CITY_CORE=1`, `CROWD_FOUND=1`,
`DISSOLVE_TOWNS=1` (commit 49e2bf9), alongside the hover/click label
contradiction fix the owner caught live (the inspect panel's legacy array
said "city" for tier 1 since forever; hover said "town").

**Regime battery, all green at the new defaults:**

- smoke: all checks, 155s — faster than the old register (entities-per-person
  8.4 vs 15.0: the register cut visible in the suite's own stats)
- stylized: 3 seeds, all hard gates, 1 soft warning (budget 2); the long
  horizon fills in as the arcs promised (130 settlements, 70 polities)
- resgate: **all bands held and every ratio IMPROVED** — claimed-land
  app/ref 0.67 → 1.29, people-per-km² 0.66 → 0.75, median-area 0.44 → 0.57,
  median realm ABSOLUTE 332k km² (was 130k). The cross-grid gap the ratchet
  guards narrowed under the new register. Per the gate's own recorded lesson
  ("never derive and ship a ratchet tightening in the same wave as a regime
  change") the floors are NOT re-baselined here — that lands in a later
  wave once the regime settles, as a deliberate tightening.
- hash baseline re-recorded for the new register: b862d3aa / e56aa7ae
  (the old register's 7173d965 / b4030359 was verified nine times before
  the flip; the OLD register remains reachable byte-identically by setting
  the three levers to 0).

Old saves migrate: sub-city settlements fade back into the countryside over
the first stretch — the measured dissolution cull; ONE_POP keeps every
person on the field.

## Wave 3 acceptance — the A/B at the SHIPPED grid (tw=960, 12k steps)

The five original complaints, scored at 1920/Half, old register vs the live
set (CITY_CORE + CROWD_FOUND; DISSOLVE_TOWNS measured separately at 240/480
— its tw=960 arm rides with the DAWN_LIVE genesis battery):

| tw=960 @12k | old register | live set |
|---|---|---|
| stone-age cities | first "city" step 25 — a 114-census CATCHMENT mislabel | first city step 733, honest 10k core; metro 3207 at the 40k anchor |
| cities born | pinned 7-9 all run (40 promotion events, all bar-flicker) | 0 → 60 monotone (138 promotions: 44 town, 82 city, 12 metro) |
| pyramid | 94 towns / 8 cities frozen, 0 villages ever | 2/33/60/2 at 12k — the distribution slides through fixed, honest bars |
| not enough countries | 37 realms, 38% nationless | **60 realms, 21% nationless** |
| road web | 3682 tiles | 3498, with the dawn suppressed (742 at step 500) |

The cross-grid first-city gradient (733 at tw=960, ~1500 at tw=480, ~2700 at
tw=240) is the finest grid resolving genuinely dense hearth cores earlier —
honest measurement, not a time-gate.

*"each nation still spawns with a settlement though? i think this is where we
get to decoupling nations from cities. also i still see you spawning villages
and towns."*

**Stage B — CITY_AT_BIRTH (built, def 0, measured):** no entity ever mints
below the city definition. The proto-urban stage lives in the land: unclaimed
ledger sites in city-capable cells concentrate their countryside in the field
(URBAN_DRIFT trickle + a per-tick capacity spike holding the core — the grown
cities' own mechanism applied pre-entity), and the entity is born a CITY when
the core disk holds one ("The city of X arose"). The spontaneous sweep mints
nothing; the runtime hearth mint becomes the invention alone. MEASURED
(probe_sitecities, 480/8817/6k): site cores grow 1.7 → 20 census with no
leak-back; two cities arise from the land by 6k (first ~4500, at the wheat
hearth). The remaining dawn dots are the BUILD-TIME cradles, which are
load-bearing: they carry `_hearthAgeY` (the technique wave's source age,
popField.js:429) and calibrate the census bridge. Their conversion is Stage A.

**Stage A — STATE_OF_LAND (designed, next):** a polity may exist on territory
and people alone. The hearth's maturation births a NATION, not a settlement:
a polity-registry record seated on a TILE (`seatTi`), its hearth age carried
world-side (`world._hearthSeeds`) for the technique wave, its territory
seeded from the seat through the existing claim machinery, liveness =
claimed land holds field population (no settled member required). The realm
derivation (conquest.js ~643, which today rebuilds `world.countries` purely
from settlements) adds memberless land realms — every `c.capital` consumer
null-guarded, armies absent by design (the pre-urban world fights at raid
scale, below the army abstraction). Cities born by the site pass inside a
land nation's territory JOIN it and take the court (the existing
capital-genesis relocation); a land nation whose people scatter ends. The
dawn map then reads: tribal nations over the hearth basins from the first
century — no dots — and the first city rises inside one as the Uruk moment.
Blast-radius audit before build: every `c.capital`/`c.members` consumer in
conquest/countryTerritory/armies/faiths for the memberless case.

**DAWN_LIVE + CITY_AT_BIRTH: the born-from-nothing genesis is WHOLE (v6).**
Owner: *"do you seed the hearths? can we not simply open with nothing and
wait for nations to be born?"* Six measured iterations closed five defects —
forager cities (the farming gate: no site concentrates without the full
invention under it), dead static seeds (practice improves at the hearth
toward the pre-urban plateau), basin-swallowing mints (the pile bounded at
the mint bar), the phantom-bridge runaway (an empty world calibrates on
nothing — leave the bridge unset), and the unit's missing ground truth (the
dawn bridge is DECLARED from the forager Earth: ~5M people on the eve of
agriculture, FORAGER_EARTH_CENSUS/Σfield). The v6 arc, 480/8817/25k, from a
truly empty world: eight staggered inventions (wheat ~8.6k first; two
hearths stood down to diffusion — the Australia machinery), then **the
first city "Ňěňní" born at exactly core 10, growing honestly to cross the
40k Uruk anchor at step 14,945 as the planet's first metropolis** — no
spike, no crash — cities and towns following at their definitions, 20
entities / 18 realms at 25k, 5% nationless, roads from zero. Every constant
in the chain is a real-world anchor. Ships def 0: flipping DAWN_LIVE
default-on requires dawn-aware horizons in the gate harnesses (stylized and
resgate run fixed step counts calibrated to the seeded dawn — at 6k a
DAWN_LIVE world is honestly pre-city and would fail "civilization alive"
semantically, not wrongly). Playable now via the tuning panel:
DAWN_LIVE=1, CITY_AT_BIRTH=1.

**STATE_OF_LAND measured — the full vision arc (v7, all three dawn levers,
480/8817/25k):** from a truly empty world, farming invents at the wheat
hearth, and the political map fills the pre-urban window exactly as
designed: **38 polities by 25k of which 20 are NATIONS OF THE LAND** —
named tribal polities holding their valleys with no city dots — while the
first cities rise INSIDE the tribal era ("Fátǎkú" crossing the 40k Uruk
anchor at 15,265; "Kóltù" born at core 10 at 16,597) and adopt their
nations into statehood through the merged claim (nationless 6%). Nothing,
then farming, then nations, then Uruk: the owner's phrase, measured.
Byte-identity at the live defaults across the whole Stage A build
(b862d3aa/e56aa7ae). Remaining before the dawn set can flip default-on:
dawn-aware horizons in the gate harnesses; recorded follow-ups: tribal
nations ending when their basin empties, and the coast/river dilution debt.

**TRIBUTE_OF_LAND measured (Wave 6, the storehouse economy, full dawn stack
480/8817/25k):** the economic ladder runs live end-to-end. Eleven thousand
steps of correctly ZERO economy (no polities, no tribute, no coin — nothing
before people). Then: 19 nations of the land accrue ~167 food-units of
chiefly stores (no coin — pre-monetary by definition); realms materialise
and their treasuries climb 0 → 6,716 coin as overflow sells at the LIVE
scarcity-scaled grain price (the Egypt channel — the monetisation of
taxation emerging on its own timeline, at real prices, no price constant);
land-nation stores transfer to their successor realms by record continuity
alone (the dowry). Subsistence (field) → tribute (polities) → markets
(cities), each layer emerging with its carrier. Remaining measurements:
the famine A/B (granary vs no granary) and layer-3 court exchange with its
consumers (v2).

**Audit result — the architecture inverts (recorded before building):** the
capital-dereference sweep found 25+ raw `c.capital.x` reads across the
conquest pass (raids, diplomacy, colony supply, resource wars), all
presupposing a court. Null-guarding them all would thread a special case
through every organized-state behavior — for polities that historically DON'T
DO those things. So land nations stay OUT of `world.countries` entirely: a
pre-state tribal nation wages no organized war, holds no court, runs no
colonial supply — the conquest pass rightly never sees it. It exists as (1) a
polity-registry record (name, emblem, chronicle), (2) a PAINTED BASIN CLAIM
in `world._countryClaim` — which the border renderer and the existing
adoption path (`grownOwnerAt`) already consume, so its territory draws on the
map and a city born inside adopts the nation with zero new plumbing, (3) a
`world._hearthSeeds` entry carrying the technique wave's age (re-pointing
popField's `_hearthAgeY` reader), (4) a liveness guard in the polity pass
(a land nation ends only when its basin's people scatter). Its claim is
STATIC at basin size — tribal nations hold their valley; expansion begins
with statecraft, i.e. with the first city, at which point the realm
materializes in `world.countries` with a member and lives fully. Naming
derives from the ancestry field at the seat tile (the same source settlement
naming uses).

**Composed-set arc sanity (CROWD_FOUND=1 + CITY_CORE=1, 480/8817/6k): the
whole city arc survives composition.** First town step 315, first city step
2695 — the same emergent moment as CITY_CORE alone (2720), the same settlement
(Nawaxexi, the wheat hearth), the same development (metal 0.05). City count 8
of 76 settled vs 11 of 90 alone — proportional, not starved. Realms 20 → the
same statehood arc; roads 673 vs 686. CROWD_FOUND's conservatism costs ~3
cities at 6k on this seed and buys siting (every founding on-river, late
foundings at 934× the bar); first metropolis arrives later (5206 vs 3945) as
the denser-but-fewer world takes longer to push one core past 40,000. The
flip-set decision moves to the Wave 3 acceptance run at the shipped grid.

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

---

# The materialisation that never fired (2026-08-06)

Owner, running the live stack: *"why are they minting cities off the bat anyway?
Didn't we JUST make it so that they don't have to do that?"* Two defects, one
visible and one structural, and the visible one was hiding the structural one.

## Measured: zero materialisations, ever

`probe_tribute` grew a founding-channel column (living realms keyed by their
`polity.founded` event's `how`). At the app grid (`tw=960`, seed 8817, dawn
live, 25k steps):

    land nations 20 · realms 40 · founding mix: cradle=1 frontier=1 ?=38 tribal=0

**Not one land nation had ever materialised into a realm.** Forty realms rose
BESIDE forty nations — parallel registers that never touched. The user was
seeing exactly this: tribes form (invisible, see below), then a city rises
*inside* one and self-founds a rival state on top of it.

## The mechanism: the handover was built for a model we no longer ship

The Wave-5 adoption channel lives in the claim crawl (`countryClaim.js`:
merged owner, `grownLiveOwnerAt` accepting land ids — "a city born on tribal
ground adopts the tribe's id through the very same claim the border draws").
But the shipped defaults are `FIELD_POLITY=1` + `TILE_POLITY=1`, and under
them `adoptAndFound`'s `ownerAt` reads the AUTHORED territory field
(`_countryOwner`) — which is seeded **only by settlements**. A nation of the
land has no settlements BY DESIGN, so it can never appear in that field: a
genesis city on its ground read `region = -1` and took `s.countryId = s.id`.
The adoption channel was validated in the regime where it does nothing — the
same failure class as `SUCCESSOR_STATES` at `tw=240` (b859db7).

## The fix: birth is the materialisation

A city rising on a nation's ground IS that nation materialising — Uruk is
Sumer's countryside crystallising a seat, not a rival founded beside it. Two
sites, both mechanism, no constants:

- **The mint** (`crystallize.js`): a site city whose tile lies on live land-
  nation paint (and under no realm's authored field) is born INTO the nation —
  `countryId`, the nation's own culture (its basin's people ARE the nation's;
  a remote donor's culture no longer wins), eager `capitalId`. The retirement
  pass hands the register over within the same crystallize pass; the polity
  record continues (its tribal founding stays its founding — the chronicle is
  continuous from tribe to realm).
- **`adoptAndFound`** (`countryTerritory.js`): the sovereign-anchor branch
  falls back to `landAt(ti)` when no realm field covers the tile. City branch
  ONLY — towns on tribal ground stay stateless (the village tier is the
  nation's own people; only a city turns a nation of the land into a realm).
  Budget/fisc gates don't apply: they are a court's refusal machinery, and a
  land nation has no court yet — its first city is the court coming into being.

Measured after (same seed/grid/horizon):

    tw=960:  first realm in the world is TRIBAL-FOUNDED (~step 10k).
             25k: realms 26 (was 40) · tribal=6 · nations still on the land 5 (was 20)
    tw=480:  25k: realms 16 · tribal=8 — half the world's realms are materialised nations

Realm count consolidated because cities now join their nations instead of
minting rivals; the formation→city→materialisation conveyor runs continuously.

## The visibility half (the app could not draw a land nation)

`CONTROL_FIELD` pretty borders render from capital-seeded `_ctrlOwner`; labels
and hover resolve via `psw.countries` — all capital/settlement-derived, so a
land nation drew NO border, NO name, NO hover. The first visible nation was
always a city-state, which is what made the mechanism gap look total. Now: the
worker fills land-nation territory into the shipped claim grid (both border
modes), ships a compact `landNations` pack `[{id, ti, name}]` on the static
cadence, and the app resolves hover + realm labels through it (same anchor
machinery, same damping; when a nation materialises the id enters
`psw.countries` and the land path simply yields).

## Gates and the honest ledger

- smoke 66s ok · resgate all bands (median 0.83 / claimed 0.84 / people 0.75 /
  absolute 496k km²) · hashbase at defaults UNCHANGED `9fb452b8` (the 1200-step
  mature-regime horizon never reaches a genesis mint — the change is inert
  until the mechanism fires) · `STATE_OF_LAND=0` byte-identical pre/post
  (`70fbdc06`).
- **stylized: 3 soft warnings EXCEEDS budget 2 — and the breach PRE-EXISTS at
  HEAD** (measured by stash A/B). This wave *improves* two of the three: Zipf-
  qualifying cities 4→7, fallen-polity lifespan median 63→150 steps (58 fallen
  vs 67 — materialised nations are more durable than self-found confetti).
  Market-integration Δ is noise-level unchanged (−0.38 → −0.40). Attribution
  by elimination: the granary commit `dd72fbe` is the only physics commit since
  the 2/2 measurement (validate is seeded). **Open item, next in line: diagnose
  granary birth-stores → market-integration regression.**

## Recorded defect: the ?-channel (founding stories are being LOST)

38 of 40 realms carried no `polity.founded` event. Silent successor/secession/
rebellion registrations account for some; the rest is a RACE: hot fiscal paths
(`govOf` → `getOrCreateRecord`) create a polity's record silently within a tick
of its id appearing, so the reconciler's `reg.has(id)` check always short-
circuits and `how:"emerged"` is never logged. A nation can emerge and the
chronicle says nothing. Fix sketch (own wave — it touches record shape and the
event ledger): stamp `foundedHow` on the record at creation, let the reconciler
log the emergence for silently-created live records; measure the mix off
records, not events.

---

# The market "regression" that was a measurement artifact (2026-08-06)

The stylized budget breach recorded above attributed to `dd72fbe` (granary
birth stores) by elimination. The window-level diagnosis (`probe_market.mjs`,
same harness/seed/windows as the suite) overturned the attribution's MEANING:

    HEAD (with granary):   baseline locks ~17,500 · 6 sampled windows
                           dispersion 0.162→0.119, falling in 5 of 5 diffs
                           gate Pearson −0.40 → WARN
    7becbb9 (pre-granary): baseline locks ~18,900 · 4 sampled windows
                           dispersion 0.130→0.111, falling — and Pearson −0.55,
                           WORSE — but post.length 4 < 5 so the gate NEVER RAN
                           ("passed" = silently n/a)

Two findings:

1. **The granary commit improved the world.** Birth stores keep frontier
   people alive → more output and trade → the monetary economy EMERGES one
   window earlier (the baseline's world-state conditions — currency-tech
   organization + ≥3 coined components — are met at 17.5k instead of 18.9k).
   The "regression" was the gate ARMING for the first time on a better world.
2. **The gate misfired on its minimum sample.** A first-difference Pearson
   over ALL windows judges component-RISE windows too — a frontier city
   founding a NEW trade node during the healthy narrowing trend reads as
   anti-integration — and at 4-5 diff points single windows sign-flip it. In
   BOTH worlds dispersion narrows almost monotonically (the exact shape the
   gate demands) and the only knit window with positive Δ is +0.0017, noise.

Fix (measurement, not world): the gate now scores its own sentence — over
knit windows (components drop), mean dispersion Δ must not exceed the series'
per-window noise scale (median |Δ|, self-normalizing, no fitted constant).
The Pearson stays printed, unscored. Re-measured: seed 8817 gives −0.0045
over 2 knit windows vs floor 0.0107 → ok; suite back to 2 soft warnings
(budget 2) — the standing Zipf-thin + young-lifespan pair, both improved by
the materialisation wave (cities 4→7; median 63→150).

Three-seed deep run (canon 8817/4242/777): **2/3 within budget** (majority
passes). The corrected gate SCORES on both seeds where the baseline locks
(8817: −0.0045/2 knit windows; 4242: −0.0034/5 — its Pearson was +0.36, so
the old score was seed-luck in both directions) and n/a-skips honestly on
777 (baseline never locks in 21k there). Seed 777 runs 4 warnings — and the
worktree A/B shows it has been over budget since BEFORE this session's
commits (7becbb9: Zipf n/a·5 cities, lifespan 113, succession-wars 1/100,
cradle-distance +0.74). Its standing defect is the CRADLE-DISTANCE
INVERSION — knowledge leading outward — which this session's waves improved
(+0.74 → +0.46 → +0.55) but did not cure. Open item, its own wave: why does
seed 777's knowledge run ahead of its cradles?

---

# The continental chiefdom and the vanishing ground (2026-08-06)

Owner, watching the live app (tw=960): *"it made a very large imprint with no
city, in northern Australia first, which somehow spread into southern
Indonesia islands? Then a city got made and it lost all that land, shrinking
to land only around the city."* Every clause measured true, and the whole
report traces to ONE modeling shortcut: the formation paint stamped the
nation's entire site-ledger cell.

## Baseline (probe_landpaint.mjs, 25k / 8817 / 960)

    formations 11 · spanning >1 landmass: 1 (9%)
    imprint min/med/max: 319k / 642k / 983k km²
    materialisations keep a median 4% of the nation's ground in the drawn map

The cell partition is a Euclidean nearest-site disk (TOWN_BASIN_R = 10
ref-tiles ≈ 1,670 km radius) and WATER-BLIND — in site-sparse country one
nation stamps a near-continental imprint, islands included (the Australia →
Indonesia case). A ~10,000-person chiefdom held France-plus-Germany; the
historical register for complex chiefdoms is 10³-10⁵ km². And at
materialisation the paint was CLEARED — the realm restarted from its one
city's reach: 96% of the territory teleported to wilderness.

## The fix — gate and ground are one measurement

Formation now breadth-firsts from the seat over the seat's OWN LANDMASS
within the cell, gathering people until the founding bar (TRIBAL_CENSUS —
the existing constant; connectivity is the claim crawl's own law). The
nation IS the people who formed it, on the ground they stand: tight cores in
dense cradles, honestly more ground for the same people in thin country,
never across water — and people the seat cannot walk to no longer count
toward forming a nation at all. At materialisation the ground passes to the
realm in the DRAWN layers (claim + control field at SRC_HOLD), never the
authoritative territory: reach physics decide what the young state can hold,
and the map shows the rest receding ring by ring instead of teleporting.

    formations 20 · spanning >1 landmass: 0
    imprint min/med/max: 13k / 44k / 137k km²   (the chiefdom register)
    materialisations keep a median 63% (some >100%: young realms already growing)

## Gates — and what the honest domains UNMASKED

smoke ok · resgate all bands (0.81/0.83/0.76 · absolute 496k km²) ·
STATE_OF_LAND=0 byte-identical (70fbdc06) · defaults baseline b09ae9c4 (was
9fb452b8 — nations form within the mature 1200-step horizon, so honest
extents show).

stylized runs 3 soft warnings (budget 2) at the CI seed, and the 2×2 A/B
(pre/post × TRIBUTE_OF_LAND on/off, seed 8817) attributes it exactly:

                     tribute ON            tribute OFF
    pre-fix   Zipf 7 · war tail 5.3 ok   Zipf 2 · war tail 3.8 warn
    post-fix  Zipf 4 · war tail 4.3 warn Zipf 2 · war tail 3.8 warn

With tribute off, pre ≡ post — the entire stylized delta is the tribute
DOMAIN right-sizing. Tribute mints stock from governed land area; the
phantom 642k-km² domains were a ~15× food print into capital granaries, and
that subsidy was MASKING two pre-existing thin conditions: few big cities at
the 21k horizon (Zipf warned at 7 cities too — the standing thin-register
item), and a war tail at ~4 (the ≥5 bar passed only with the inflated
economy). Keeping phantom territory because it flatters two count stats is
the fitted-outcome trap; the honest world warns, and the warnings now name
real missing mechanisms.

**Open items (next waves):** (1) URBAN TAKEOFF — what the 21k world needs to
grow >50-urban cities without phantom subsidies (the Zipf-thin item, now
with a measured causal chain: tribute genuinely drives urbanisation, 2→4
cities at honest domains — the storehouse economy is load-bearing and the
honest version may need its missing partners: layer-3 exchange consumers,
famine A/B). (2) WAR SIZES — the deadliness tail reads 3.8-4.3 against
Richardson's ≥5 in every un-subsidised arm; either early-era wars genuinely
lack great-war mechanics (coalitions, succession cascades) or the max/median
bar at n≈46 is knife-edged — measure across seeds before touching either.
(3) Seed 777 chronic (cradle-distance inversion) unchanged. Multi-seed
1/3 this commit (4242 in budget at 2; 777 chronic; 8817 the unmasking).

---

# The death pump and the misplaced gate (2026-08-06, owner screenshot)

Population lens, tw=960: *"a nation was founded in northern Australia, and
the population around it got greyed out? And look at china: they are super
densely populated, but no nation forming."* Both measured (probe_dimfunnel,
25k/8817/960); both were single-mechanism defects.

## 1. The grey-out was a DEATH PUMP, not urbanisation

City-eligible cells lost **50-75% of their people** over thousands of steps
while the site tile held **0-2%** — the drift was not concentrating people,
it was exterminating them. The spike's capacity only ever FOLLOWS what has
already gathered (min(coreNow, 1.2×coreBar)), so the drift's inflow (~90
field units/firing, distance- and water-blind across the whole 1,670 km
cell) chronically overran it and the field pass's capacity enforcement
killed the surplus. Sparse-region cells sat in this state 10k+ steps and
NEVER minted: the bright dot was the small spike-held core, the dark region
its exterminated countryside. Fix: the drift's domain is the PEOPLED BASIN
that qualified the site (cached), and inflow is paced by the core's actual
capacity headroom — min(demand, headroom), no new constant, zero deaths by
construction. After: eligible cells GROW (−16..+1% "drain"), mints land 75-
1,650 steps after eligibility, famine events 12→8 on the 960 arc.

## 2. China was blocked by ONE TILE's devF

Every top-mass basin — up to **95× the nation bar** — read "farming not at
the seat": the formation and eligibility gates tested devF at the SEAT tile,
a shelter/river-mouth maximum the technique wave reaches LAST, while the
basin interiors brimmed with farmed people (devF 0.28-0.44 at seats, full
inland). Fix: `peopledBasinAt` — ONE BFS measurement (seat's own landmass
within the cell, until the bar mass) feeding all consumers: the nation gate
and city eligibility now ask whether THE PEOPLE farm (people-weighted devP ≥
NEOLITHIC_AGRI), the drift drains exactly the ground that qualified the
site, and birth stores provision from the same basin (the phantom-domain
class again). Funnel after: honest "its people do not yet farm (devP 0.36)"
verdicts ripening toward the bar; the full nation → city-inside-it →
materialisation pipeline observed (k=44: nation @<20000, mint @22675).

## The 960 headline arc after

    realms by founding @25k: tribal=13 of 25 — the MAJORITY of the world's
    states are materialised land nations (was 6/26; 0/40 at wave start).
    8 nations still on the land; famine Σ 8 (was 12).

## Gates

smoke ok · resgate all bands (0.70/0.82/0.75, absolute 420k km², count 8) ·
off-levers (STATE_OF_LAND=0 + CITY_AT_BIRTH=0) byte-identical `70fbdc06` ·
defaults baseline `fb8bae2b`. Stylized single-seed: the SAME standing 3-
warning set as the pushed HEAD (Zipf 4 · lifespan 150 · war tail 4.4) — this
commit moves none of them. Deep 3-seed: 0/3, but the composition is seed-
slosh under divergence: 8817 identical, 777 IMPROVED (lost its chronic
cradle inversion), 4242 picked up the two wandering warnings (succession-
wars 1/108, cradle +0.76).

## THE RE-BASELINING WAVE (top of the queue — owner decision)

The suite's count-sensitive bars (Zipf-n/a city floor, war tail ≥5,
succession-war share, cradle Pearson) were calibrated on a world that no
longer exists: farming-region register, pinned dawn, phantom tribute
domains, and a death pump silently deleting frontier populations. Its own
header still claims "23-33 cities at 21k" — stale by two registers. Every
structural fact holds on every seed (resgate bands, realm areas,
urbanization %, pop~dev monotone, price boundedness, war rates, culture
scaling, water clustering); the count bars slosh seed-to-seed with each
honest correction. They need the resgate treatment: re-measure the canon
seeds' honest state, decide per-gate whether the bar or the world is wrong,
re-baseline deliberately, and tighten as mechanisms fill in. One candidate
mechanism question for that wave: the cradle-distance gradient may be
genuinely flattened by city-grade mints inheriting near-baseline knowledge
at any distance (inheritKnowledgeAt dilution vs the mint explosion) —
secondary-state tech lag might need to be earned, not granted.

---

# The re-baselining wave (2026-08-06, owner: "Go")

Measurement and calibration ONLY — zero sim changes (defaults hash unchanged
`fb8bae2b`, smoke green). Method: STYLIZED_DUMP=1 prints each contested
gate's underlying distribution on the three canon seeds; each gate then got
ONE of three verdicts — bar stale (re-baseline with historical
justification), operationalization broken (measure the right thing), or
world wrong (the warn STANDS and the mechanism is queued). Every scoring BAR
predates this wave; only measurements were repaired.

## Verdicts

- **Zipf — instrument error, fixed.** The gate demanded 15 cities over a
  50k-core floor: a METROPOLIS count, calibrated before the cities-only
  register ("23-33 cities at 21k" in its own header — stale by two
  registers). The dumps: top city 80-122k, 12-14 cities >20k, 17-22 >10k at
  leadAgri ≈ 0.70 — the real late-Bronze register almost exactly. Cities now
  rank at the register's OWN bar (TIER_CORE[2] = 10k urban core, the sim's
  definition of a city). Result: the gate went from n/a-blind to MEASURING —
  slopes −0.59/−0.67/−0.75, inside the owner-accepted −0.45..−1.35 band that
  predates this wave. The law was in the world; the floor couldn't see it.
- **State lifespan — wrong population, fixed.** The fallen-only register is
  bimodal: p25 = 13 steps (failed secessions/revolts recorded as polities)
  vs living realms with median age 8,300+ steps. Historical fallen-state
  datasets exclude failed revolts, so the old median compared unlike
  registers. Now scored on ALL states, living included as right-censored
  lifetimes (conservative): medians 1,050-1,575y, within the unchanged
  [50, 2000]y band; the 2000y ceiling still catches immortal map-painters.
  The revolt-churn share prints unscored — it is the standing
  successor-churn mechanism item, not this claim.
- **Cradle gradient — wrong sources, fixed; and then a REAL finding.** The
  "oldest 3 roots" were three ARBITRARY members (map-insertion order — all
  ten init roots carry foundedStep 0) of a ~10-hearth knowledge system;
  seed 4242's +0.76 "inversion" was distance measured to 3 of its 10
  sources. Cradles are now the DAWN COHORT (every root born at the first
  founding step; later ethnogenesis roots stay excluded per the 2026-07
  noise measurement). Against the honest sources: 777 reads −0.14 (proper
  decay — its chronic warn dissolves), but 8817 reads +0.42 and 4242 +0.57 —
  a GENUINE outward knowledge tilt, properly instrumented for the first
  time. Those warns STAND. Mechanism question queued: do city-grade mints
  inherit too much / grow too fast far from hearths (secondary-state tech
  lag may need to be earned)?
- **War deadliness tail — bar KEPT, warn stands.** Even passing seeds read
  6.5-10.2 where Richardson's record runs 10-40×; 8817's top-8 wars cluster
  84..54 over median 19 — no standout great war. Genuinely thin everywhere:
  a mechanism pointer (no great-war cascades — coalitions, alliance chains),
  not a stale bar. top3mean/med now rides in the detail so the knife-edge
  nature of max/median stays visible.
- **Succession-war ignition — bar KEPT, warn stands.** CLAIMANT_WARS ships
  ON; the honest world's larger war count diluted crisis-ignited share to
  0-4%. Real thinness pointer, queued.

## After (canon seeds, all bars pre-existing)

    8817: 2 warnings (cradle +0.42 · war tail 4.4)      — within budget
    4242: 2 warnings (succession 1/108 · cradle +0.57)  — within budget
    777:  1 warning  (succession 0/87)                  — within budget
    multi-seed: 3/3 · every remaining warn is a queued mechanism pointer

**Mechanism queue after this wave:** (1) outward knowledge tilt (cradle
+0.42/+0.57 vs honest hearths); (2) great-war cascades (tail thin on every
seed); (3) succession-war ignition share; (4) revolt-churn realism
(successor-states at fine grids, the standing item); (5) urban takeoff
(tribute-driven urbanisation, from the subsidy-removal wave); (6) the
?-channel founding-story race; (7) coast/river capacity-dilution debt.

---

# Why is the Fertile Crescent weak? (owner question, 2026-08-06) — MEASURED

Answered by measurement, not opinion: `tools/probe_cradleregions.mjs` (new)
compares the historical cradle boxes on the Earth preset by terrain, the
technique field, people, and politics; plus a cradle-score decomposition at
the four Old-World pins and a capacity-vs-population fill read.

## The premise is half wrong: farming LEADS there

Under the app's dawn setting (DAWN_LIVE=1, tw=480, seed 8817, 25k steps) the
Crescent is the world's **most-developed region**: 253 of 255 land tiles
farming, devF 0.574 — tied at the top with the Nile, while the Yellow River
sits at 0.070 and the Yangtze at 0.006. Mesopotamia's hearth ignites SECOND
of the four Old-World pins (~step 12,000, after the Nile, before the Indus
and the Yellow River). The ORDER of invention is roughly historical.

What is weak is everything downstream: 1 settlement, ~0.2M people.

## The binding constraint is the CEILING, not the people

Capacity-vs-population fill (mature-regime initial condition — the harness
pins DAWN_LIVE=0; this is the equilibrium read, not the dawn timeline):

    step 25000 · world 25.7M people / cap 32.2M
    region   |  people |    cap  | fill% | ppl/km2 | devF
    Crescent |   0.90M |   1.02M |   88% |    0.79 | 0.69
    Nile     |   0.12M |   0.14M |   82% |    0.32 | 0.69
    YellowR  |   1.02M |   1.10M |   93% |    1.08 | 0.69
    Yangtze  |   0.43M |   0.48M |   88% |    0.47 | 0.68

Fill is 75-98% at every checkpoint in every region: **population is AT
carrying capacity everywhere**. People are not failing to arrive — the
ceiling is ~1 person/km² in the world's best ancient farmland. Real Bronze
Age Egypt carried ~1.5-2M people on ~34,000 km² of floodplain (~50/km²);
Sumer's irrigated core is the same order. The world TOTAL is fine (25.7M at
late-Bronze technique against a real ~20-30M) — what is missing is
CONCENTRATION. The sim spreads its people thinly and evenly; history piled
them into narrow irrigated ribbons.

## Why the Crescent scores low as a hearth (4.44, lowest of the four pins)

    pin           | fert | moist | river | score | package
    Nile          | 0.99 | 0.45  |  4.0  | 6.00  | wheat suit 0.93
    Mesopotamia   | 0.99 | 0.25  |  2.0  | 4.44  | wheat suit 0.69
    Indus         | 0.99 | 0.45  |  3.0  | 6.09  | sorghum 0.85
    Yellow River  | 0.83 | 0.65  |  3.0  | 5.88  | maize 1.01

Fertility is fine. The Crescent loses on river magnitude (2.0 → riverBonus
1.6 vs 2.6 at rm≥3) and on MOISTURE, which cuts its wheat suitability to
0.69 and scales the whole score by it. Under INVENT_STAGGER (T =
INVENT_EPOCH_Y / score) a low score is a late maturity.

## The four real-history reasons, and what the sim maps

1. **The wild package** (Diamond) — 8 founder crops + 4 of the 5 big
   domesticates, the richest assemblage on Earth. **MAPPED**
   (T.CRADLE_PACKAGE: suit × storability).
2. **Mediterranean seasonality** — wet winter, hot dry summer: the regime
   that selects for large-seeded annual selfers that die back and store,
   which is *why* those grasses were domesticable at all. **NOT MAPPED.**
   Crop suitability reads ANNUAL-MEAN moisture, so the Crescent's signature
   climate reads "semi-arid" and is penalised (suit 0.69). A `summerDry`
   field exists but its Mediterranean branch is disabled, and biomeClass.js
   documents exactly why: the moisture solver models no seasonal storm
   track, so 94-97% of the Mediterranean it painted would be misplaced.
3. **Irrigation on arid alluvium** — farming was invented in the rain-fed
   NORTHERN arc (Göbekli Tepe, Abu Hureyra, Çatalhöyük); cities and states
   came from the irrigated SOUTH (Eridu, Uruk, Ur) — desert with two rivers,
   the highest-yielding farmland of the ancient world once canalised.
   **NOT MAPPED.** There is a river ACCESS premium (reach = 1 + access ×
   (ACCESS_DEV0 + ACCESS_DEVK·dev), ≈3× at full magnitude) but it is
   undifferentiated by aridity — a river through wet Europe earns the same
   multiplier as one through Iraq — and nothing like the order-of-magnitude
   irrigation delivers on desert alluvium versus the same ground unwatered
   (which is zero: aridGate = clamp((m − 0.12)/0.18) kills rain-fed crop).
4. **Circumscription** (Carneiro) — bounded by desert, mountain and sea, the
   losers of a quarrel could not disperse, so they submitted. **MAPPED, and
   carefully**: `_confine` (static terrain), T.CONFINE into birth
   organisation, and T.ORG_PRESSURE stating Carneiro properly —
   circumscription × population FILL, not circumscription alone. The
   codebase already names Wittfogel's hydraulic demand in that lever.

## The gap, in one sentence

**The sim models the DEMAND half of Wittfogel — aridity and confinement
drive organisation — but not the SUPPLY half: organisation unlocks the
water, and water on desert alluvium is worth an order of magnitude.** Sumer
is precisely where those two halves meet, which is why it is the case that
exposes the gap.

Also noted: at the REFERENCE grid (tw=240) the southern alluvium reads as
sea/desert outright (Uruk/Ur elev −0.04, Jericho fert 0.00) while at the app
grid (tw=480) the same pin reads fert 0.99 — the third cardinal rule again,
and partly real (the Gulf did reach further north in the early Holocene).

## Proposed mechanism (NOT built — owner decision)

An irrigation term with independent physical meaning, no region named and no
constant fitted to Egypt: effective crop water = max(rainfall, river-supplied
water × the administering settlement's organisation), so the premium is
LARGEST exactly where the arid gate bites hardest and ~zero where rain
already suffices. Gated on organisation because a canal network is an
institution — which closes the Wittfogel loop the codebase already opened
from the demand side. The Nile, Sumer, the Indus and every procedural
desert-river valley fall out of it; nothing detects a region.

---

# T.IRRIGATION — BUILT, MEASURED, REVERTED; and the finding underneath it

Owner said "go" on the irrigation mechanism sketched above. It was built
behind a lever, verified byte-identical off, verified bit-identical across the
serial/kernel/pool paths with the lever ON (probe_popfield_par), measured —
and **reverted**, because the measurement showed the premise was wrong. The
finding it uncovered instead is the largest open item in the food economy.

## Why the mechanism was wrong: the sim already irrigates, implicitly

The design was `works payoff x (1 + IRRIGATION x gain)`, `gain = max(0,
irrigable - rainGate)` — pay for leading water onto fields in proportion to
how badly the rain fails. Measured on the Nile channel:

    lon/lat      | rMag | tFlood | moist | irrigable | rainGate | gain
    30.8E/22.5N  |    4 |      1 |  0.45 |      1.00 |     1.00 | 0.00
    28.5E/27.0N  |    4 |      1 |  0.45 |      1.00 |     1.00 | 0.00

**Every river tile reads moist 0.45 while the desert beside it reads 0.02.**
The moisture field already carries the river's own water, so cropGen's arid
gate never fires on a river tile, fertility there is already 0.97, and the
irrigation term's gain is 0 BY CONSTRUCTION exactly where it was designed to
pay. The sim does not omit irrigation — it bakes it in, by modelling a river
valley as wet, alluvial, near-maximum-fertility ground. (An earlier read that
"the Nile has no river" was MY sampling error: the sim's Nile runs ~2° west of
the real one, and my transect missed the channel. Corrected here.)

The lever was removed rather than kept default-off: unlike T.INVENT_FIELD
(kept as evidence because it DID something, just worse), this one is provably
inert where intended, and it cost a hot-loop multiply plus worker-bus
plumbing to do nothing.

## The finding underneath: the capacity ruler is right at the MEAN and
## compressed at the TOP

`tools/probe_capruler.mjs` (new) prints the absolute quantity every other food
gate measures only as a ratio (fill %, shares, cross-grid bands — all of which
pass while this is wrong, exactly as the empire ratios passed while realms
were 10× too small, pre-resgate):

    band                     | tiles | fert | works | fill |  density   | real anchor
    prime land (fert>0.85)   |  5246 | 0.95 | 1.79x |  79% |  0.50/km²  | 15-50
    river ribbon (rMag>=3)   |   574 | 0.51 | 2.78x |  73% |  0.96/km²  | 20-50
    marginal (fert<0.4)      | 26952 | 0.04 | 1.20x |  80% |  0.02/km²  |
    ALL LAND                 | 38741 | 0.26 | 1.43x |  80% |  0.15/km²  | ~0.17  ✓

The world AVERAGE is essentially exact (0.15 vs ~0.17 at a matched world total
of 25.7M ≈ real 3500 BC). The TOP is 30-100× low. Fill is 79-80% in every
band — this is a purely capacity-limited world, so the ceiling IS the story.
Dynamic range prime/marginal is 28×; history's is in the hundreds (Nile
floodplain ~20-50/km² against desert at ~0.05).

Cross-check on the Nile specifically, at the ribbon rather than the box: 6
tiles, 27,000 km² (real floodplain ~34,000 — the GEOMETRY is right), fertility
0.97 (right), fill 77% (full), carrying 1.8 people/km² where pre-dynastic
Egypt at this world-date ran ~18. Ten times short, with every input except the
ruler itself correct.

**So: the sim has the right number of people spread far too evenly.** That one
sentence subsumes several open items — the Crescent question that started
this, Zipf-thin cities (a city needs a dense catchment), the urban-takeoff
item from the tribute wave, and probably the succession-war and war-size
thinness too (small dense cores are what make big wars worth fighting).

## Next wave (NOT built — needs its own battery)

Raising CAP_PER_FERT globally is wrong: it lifts marginal land too and the
world total, which is currently CORRECT, would balloon. The fix has to change
the SHAPE of capacity's response, not its level — the top must rise while the
mean holds. The physically-grounded candidate is Ricardian/Boserupian:
**good land repays intensification and marginal land does not**, so capacity's
response to land quality should be super-linear (and technique's payoff should
scale with quality), rather than the present `cap ∝ fert` linear. LAND_WORKS
is the existing term closest to this and its own note already concedes the
range it does not reach — "2-3x (basin irrigation) to 5-15x (wet rice vs dry
farming)" against a uniform 3x ceiling, measured saturating at 2.78x on river
ribbons. That is where to start, with resgate re-baselined afterwards because
every band moves.

---

# RETRACTION: the capacity ruler is broadly SOUND (2026-08-06)

The section above concluded that "prime land carries 0.50 ppl/km² against a
real 15-50" and framed a capacity-ruler wave around a 10-30× shortfall.
**That conclusion was wrong, and the error was mine in two compounding ways.**
Re-measured on the current tree (`tools/probe_capruler.mjs`, corrected):

    world 25.66M · mean 0.150 ppl/km² (real ~0.17 at this world total) ✓
    peak tile 7.9 ppl/km²
    densest 0.5% of land holds 13.1% of people   (real ~3500 BC ≈ 15-20%)
    where history's cradles RANK among 38,741 land tiles:
      Mid-Euphrates  4.16 ppl/km²  rank    50  (top 0.13%)
      Sumer          3.40          rank   122  (top 0.31%)
      Nile           2.70          rank   273  (top 0.70%)
      Yellow River   2.40          rank   400  (top 1.03%)
      Yangtze        0.34          rank  4049  (top 10.45%)

**History's cradles ARE the sim's densest places.** Mid-Euphrates is the 50th
densest tile on Earth out of 38,741; Sumer 122nd; the Nile 273rd. The
concentration curve is close to the real one. The peak is 7.9 against a
date-matched real Nile tile of ~4.

## The two errors, recorded so they are not repeated

1. **DATE MISMATCH.** I compared a world holding 25.7M people — which is
   ~3500 BC — against Egypt's OLD KINGDOM population (~1.5M, c. 2500 BC).
   At 3500 BC Egypt held ~0.4M. Comparing across a millennium of the real
   record manufactured most of the "10× short".
2. **MEAN vs PEAK.** I compared the MEAN density of a 23M km² "prime land"
   band against the PEAK density of the Nile FLOODPLAIN. A 4,427 km² tile on
   the Nile is ~1,000 km² of floodplain plus ~3,400 km² of desert; a real such
   tile at 3500 BC reads ~4 ppl/km², not 18-50. Rank-to-rank and peak-to-peak
   are the only safe comparisons, and the corrected probe now prints them.

A third contributor: two of the measurements in the section above
(world 42.1M, "the world's densest tiles are in Mongolia") were taken while
the container's checkout had silently RESET to a pre-session commit — they
describe code from before this session's waves, not the current tree. The
restored-tree numbers are the ones above. Determinism itself was verified
(identical popField sums across repeated runs and across step batching).

## What is actually left

No capacity-ruler wave. The remaining, much narrower items:

- **The Tarim / Hexi corridor tops the density table** (92-98E, 40-44N: 6.3-7.9
  ppl/km², rMag 4, works 1.00) — above every real cradle. The codebase already
  names this basin as a known false positive in the cradle scorer ("the Tarim
  is the ULTIMATE circumscribed fertile pocket and held none of it"); the same
  geography is now topping the DENSITY table. Worth its own look.
- **Yangtze works 0.23** where every other cradle saturates at ~1.00 — wet-rice
  intensification is not building. This is the wet-farming half of the item
  flagged when irrigation was proposed, and it is real.
- The user's original observation stands but is now correctly attributed: the
  Crescent IS dense and developed (rank 50); what it lacks is CITIES. That is
  the urban-takeoff item, not a food-capacity item.

---

# The Tarim anomaly is a SPURIOUS TRANS-GOBI RIVER (2026-08-06) — diagnosed

Follow-up to the retraction's open item: the Tarim/Hexi corridor (92-98E,
40-45N) tops the world density table at 6.3-7.9 ppl/km², above every real
cradle, carrying a 151k-core city ("Gyiza", 1.07M catchment). The full causal
chain, measured (probe_tarim + a terrain-world downstream trace):

    1. riverGen judges the Gobi course OCEAN-BOUND: drainsTerminal = 0 at the
       channel; the downstream trace runs 122 tiles EAST from 93.8E/41.3N to
       ~131.6E/43.1N — the Sea of Japan. Altai/Tian-Shan melt (the deliberately
       generous orographic-snowmelt runoff term) spills the chained Gobi
       depressions eastward, and each spill beat its brim's evaporative demand,
       so Step 3b never sealed the chain. This is the EASTWARD TWIN of the
       corridor the endorheic machinery documents fixing westward ("the
       Himalaya→Caspian run").
    2. Ocean-bound ⇒ the ordinary catchment bars apply ⇒ flowAccum 607 — the
       NILE's is 783 — classifies the course RIVER_GREAT (mag 4).
    3. The pipeline's moisture/silt stamp is TERMINALITY-BLIND and class-keyed
       (riverMoistPeak[4] = 0.58): every channel tile is stamped to moist 0.45
       — identical to the Nile's channel — silt-lifted to fert 0.7-0.9, and
       marked tFlood ⇒ irrigable 1.0 ⇒ LAND_WORKS builds to 1.00.
    4. Result: a Nile-class breadbasket ribbon across the Gobi, denser than
       the Nile itself (7.9 vs 2.7 ppl/km²) because it is BROAD (the stamp
       paints the whole spurious course) where the real cradles are narrow.

The fix is a RIVERGEN WAVE — the seal's spill-vs-demand judgment at melt-fed
interior basin CHAINS (each small basin spills quickly; the chain as a whole
should die). Global hydrology blast radius: fertility carpet, floodplains,
siting, cradle scores, claims all downstream — full battery + likely re-
baselines. Not attempted at the tail of this session. (Note for the probe
reader: drainsTerminal lives on the TERRAIN world's w.rivers — the sim world
does not carry it, which is why probe_tarim prints "?" in that column.)

# The Yangtze works finding — "young" REFUTED, it is the irrigable term

In the MATURE regime all 205 Yangtze-box tiles are fully taught (devF ≥
0.45), yet works sit at 0.37 where every other cradle saturates ~1.00. The
build gate requires irrigable > 0, and irrigable = river-tiles + floodplain +
wet-climate — with the wet term starting at moist 0.55. The sim's Yangtze
basin reads moist ~0.39-0.45, so away from the river ribbons irrigable is
ZERO and works can never build: wet-rice country is locked out of
intensification by the very term meant to admit it. Whether the defect is
the 0.55 threshold or the MOISTURE FIELD itself reading monsoon China at
0.39 needs its own look (the biomeClass notes already flag the solver's
missing seasonal storm track in the same breath). Own wave; recorded.

# Session-infrastructure note

The container checkout silently reset to a pre-session commit THREE times
today, twice mid-measurement; stale-tree probe outputs were nearly published
as findings twice. tools/_harness.mjs now prints `[harness] tree <sha>` from
every consumer, so any probe output is self-identifying and a reset shows up
as a wrong hash instead of a wrong conclusion.

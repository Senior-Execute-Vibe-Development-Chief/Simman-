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

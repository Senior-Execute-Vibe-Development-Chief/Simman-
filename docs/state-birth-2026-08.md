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
funnel added here measures that channel; `probe_statebirth` reports it every
checkpoint.

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

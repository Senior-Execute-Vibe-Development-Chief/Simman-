# The nationless cities — sovereignty is a DEFAULT, not a decision (2026-08-22)

Owner: *"i think our big problem that is causing our confetti is: the majority of
cities spawn early game, nationless, and then start minting nations of their own
accord; or, in short, nationless cities are the problem. i notice that the truly
nation sized nations generally come out of areas with low early city density."*

Two claims. Both were measured on the arm the owner plays, at both grids, with
`tools/probe_natdensity.mjs`. The first is right and the cause is one line. The
second is half right, and its honest form points somewhere else entirely.

Raw logs: `docs/runs/2026-08-22/natdensity{240,480}{,_why,_tight,_norecords}.log`,
per-realm rows in the matching `.csv`. Live arm throughout:

    SIM_TUNE="DAWN_LIVE=1,STATE_RECORDS=1,LAND_KNOW=1,PEER_SEATS=1,FOUND_DRIFT=1,
    ABSORB_ORG_ERA=1,TRIBUTE_UP=0.33,ENGULF=8,FEAR_REACH=1,WAR_FINISH=1,SMALL_WAR=8,
    RELIEF_REACH=1,EXCH_WAVE=3,TECH_USE=1,VASSAL_LEVY=0.5,DISSOLVE_CORE=1,
    SETT_STRIDE=3,TRADE_STRIDE=5"

## The instrument

Every entity mints `tier: 2` and the next `adoptAndFound` decides its politics, so
the probe splits each newborn by **the ground it minted on** — the political field
as it stood one window BEFORE the city existed, so a self-founder cannot be scored
as "born inside a realm" — and by **what became of it**. For the size law it stamps
each realm's 600 km neighbourhood at *its own* founding and joins that to the
territory it ends up holding.

Two confounds were found by the instrument and killed inside it, both recorded
because either would have produced a confident wrong answer:

* **Window staleness.** At `WIN=250` the attribution read "the field had RECEDED
  off the tile, 92%". At `WIN=25` that collapses to 16% and the opposite reading
  (owner still live and holding the tile) goes 7% → 83%. The first arm was
  measuring its own sampling interval.
* **Secession.** Fate was read a window after detection — long enough at
  `WIN=250` for a city to JOIN and then secede, which would score as
  self-founding. Recording the flag at detection as well settles it:
  **sovereign from the first read 100%, joined-then-seceded 0%**, at both grids.

## A. The mint — measured

| | tw=240 / 24k | tw=480 / 30k |
|---|---|---|
| cities → realms | 405 → 353 | 1,352 → 1,186 |
| members p50 | **1 in every size bin** | **1 in every size bin** |
| realms under 100k km² | 48% | **99%** (median realm 27–31k km²) |
| born INSIDE a realm's field | n=728: **joined 3 (0%)** · own realm 97% | n=1,252: **joined 4 (0%)** · own realm 89% · stateless 11% |
| born in the WILD | joined 19% · own 32% · stateless 49% | joined 5% · own 28% · stateless 67% |

**Four cities out of 1,252 joined the realm whose ground they rose on.** The
owner's own journal says the same thing at the shipping grid (`owner-run-t36312`,
tw=960): 151 cities at 100% stateless before the first state exists, then the
singleton share never leaves 80–94% from the first state to step 36k.

## The cause — `settlement.js`, `makeSettlement`

```js
s.countryId = opts.countryId ?? (
  !T.STATE_RECORDS || (((s.knowledge && s.knowledge.organization) || 0) >= stateOrgBar())
    ? s.id : -1);
```

**Every settlement is born flying its own flag.** Sovereignty is the fallback
value of the field, not the outcome of any test — and `adoptAndFound`'s adoption
branch is `if (s.countryId < 0)`, so a city born with its own id never enters it.
The ground it stands on is never consulted.

`mintCityAt` is where the handoff breaks. On realm ground it explicitly denies the
land-nation door —

```js
let nid = (T.STATE_OF_LAND && loA && world._landSeats
  && (!coA || coA[ti] < 0) && world._landSeats.has(loA[ti])) ? loA[ti] : -1;
```

— with the comment *"Ground already under a realm's authored field keeps the gated
adoptAndFound channel — a court must AFFORD a new city."* It defers the case to
`adoptAndFound` and hands the newborn the one value that stops `adoptAndFound`
from acting. `countryTerritory.js`'s own model comment claims the opposite happens
(*"A stateless city FOUNDS a country — its own id if the border hasn't reached it,
**or joins the realm whose land it's on**"*); the birth default means it almost
never is stateless.

**`STATE_RECORDS` does not prevent this — it postpones it.** Cities mint at
`URBAN_ORG = 0.28` (tallies) and the flag switches on at `RECORDS_ORG = 0.35`
(writing), so the whole nationless window IS that 0.28–0.35 gap, and every mint
after a basin's ledger passes 0.35 is born a nation. The 11% "left stateless" at
tw=480 are exactly the sub-0.35 births.

Two readings were ruled out along the way and should not be re-proposed:

* **Not a fiscal refusal.** `ADOPT_BUDGET` and `FISC_ADOPT` both ship at `def: 0`,
  so `overBudget()` is always false and `fiscOk()` always true. Nothing in
  `adoptAndFound` ever declines a city.
* **Not paint outliving a dead realm.** 0–11% across arms; the `alive` filter is
  doing its job.

### Falsification arm (`natdensity240_norecords.log`)

The diagnosis predicts that clearing `STATE_RECORDS` removes the nationless
window entirely, because that lever IS the `!T.STATE_RECORDS ||` short-circuit in
the same expression. Run at tw=240/24k, `WIN=25`:

    born INSIDE a realm's field (n=758): joined 1 (0%)  own realm 757 (100%)  stateless 0 (0%)
    born in the WILD            (n=210): joined 20%     own realm 80%         stateless 0 (0%)
    stateless column: 0% at EVERY checkpoint
    step 15,025:  37 entities,  0 stateless,  35 realms
      (against STATE_RECORDS=1 at the same step: 38 entities, 38 stateless, 0 realms)

Realms track cities from the very first mint. Confirmed.

## B. The size law — the owner's second claim, honestly

| | tw=240 | tw=480 |
|---|---|---|
| Spearman(cities within 600 km at birth, final area) | +0.06 | −0.115 |
| own area p50, sparsest → densest quartile | 0.092M → 0.108M | 0.031M → 0.027M |
| own area **p90**, sparsest → densest | **0.431M → 0.261M** | **0.069M → 0.038M** |
| **bloc** area p90, sparsest → densest | 0.179M → **0.846M** | 0.179M → **0.779M** |

Crowding does not make a realm small — the median barely moves and is a singleton
in every bin. It **caps the ceiling**: a sparse birth roughly doubles the p90. At
tw=240 the four largest realms were each born with zero cities within 600 km; at
tw=480 the top of the table is mixed.

**And bloc area runs the other way.** Dense birth neighbourhoods produce the
BIGGER suzerainty blocs, which is history's direction — hegemons form where the
cities are. Since the atlas paints a bloc as one nation, the big painted nations
should already be coming out of dense country; that they look thin and
vassal-strung rather than solid is the integration lane, not the founding lane
(`docs/consolidation-2026-08-20.md` open item 1: biggest bloc ~6% of claimed land
against history's hegemonic 25–50%).

A counter-signal worth keeping: Spearman(free-land share at birth, final area) is
**−0.23** at tw=240, and the 94%-free quartile holds the SMALLEST realms
(p50 0.062M). Empty land is usually empty because nobody can live on it. "Founded
in emptiness" and "founded in good country that happened to be empty" are
different things and only the second one grows.

The mechanism behind the ceiling is the size law, not the founding law:
`target = popCap + march`, `popCap = govPop × spanTech / bindDens`, with `govPop`
summed over **tiles the realm already owns** (plus, under `SIZE_WORKED`, the
people its members' catchments work in unclaimed land). `countryTerritory.js`'s
own comment derives it as a proportional feedback with fixed point
`h* = W/(bindDens·(1−k))`. A realm can only fund growth out of people it already
holds, so the partition of the land at the moment the statehood cohort crosses is
close to final, and only conquest→integration can undo it.

## What this says to build

Not a lowered bar and not a deleted channel — deleting the city-self-founding path
was already measured and it made things worse (`docs/state-birth-2026-08.md`:
realms 20→14 *and* stateless cities 43→49).

1. **Make the residual the residual.** A city's birth politics should be the
   politics of the ground it is born on; sovereignty is what is left when there is
   no owner *and* the land test passes. That is what `countryTerritory.js`'s model
   comment already claims happens, and what `mintCityAt`'s comment already intends
   to defer to. The `??` fallback is the whole of the gap between the design and
   the world. Smallest change with the largest blast radius on this list — it
   needs a lever, byte-identity off, and the full gate set.
2. **Refusal must not confer sovereignty** — if 1 lands and the fiscal gates are
   ever raised off 0, `adoptAndFound`'s else-branch becomes live for the first
   time. A court that cannot afford a city should get a client or a stateless
   city in its sphere, never a sovereign peer, and never irreversibly on one
   tick's reading.
3. **Born in a hegemon's shadow → born a client.** `FEAR_REACH` already projects a
   great power's threat to any capital within `SUBMIT_REACH × holdReach`, and
   tribute bonds and `VASSAL_SHIELD` already exist. Applying that law at the
   moment of birth is the Sumerian/early-Assyrian ring, and it converts confetti
   into blocs the atlas already paints as one nation.
4. **Re-measure `SEAT_FIELD = 2`.** Built and shelved on a tw=240/8k arm in a
   ~20-realm world — the atom-starved regime the third cardinal rule warns about.
   The register is now 15× denser; that verdict is stale.

## The finding that outlives the fix

**The register IS the political map.** 1,352 cities → 1,186 realms, one member
each, 99% under 100k km². The count is not the problem — 1,223 cities and 465
painted nations at Medieval sits inside history's band. The SHAPE is: a state per
city, at ~30,000 km², from the first state to the last. History's question was
never "does a city have a state" but "which cities share one", and in this sim
that question is answered at birth, by a default value, and never asked again.

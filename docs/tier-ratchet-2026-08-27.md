# The tier ratchet (2026-08-27)

> Owner, on being shown the mechanism: *"that tier ratchet thing seems utterly
> useless, and against our design philosophy."*

This is the lap's own document. It exists because the 12k fix (`CORE_LOCAL`) was
measured on the live arm, passed the kill-shot it was built to face, and then
failed on something else entirely — and the something else turned out not to be
its fault.

## 0. WHERE THIS STANDS

*This document is written forward, in the order things were measured, and several
of its findings were later retracted by their own follow-up measurements. Read this
section for what currently holds; read the rest for how it was arrived at and what
went wrong on the way.*

**Built, all behind levers defaulting to 0, all proven byte-transparent** — not by
the usual few-thousand-step hash check but by an unplanned 32,000-step reproduction
of the live arm at the shipped grid, through 592 realms and 22% of land claimed
(§9.1): `T.HAUL_PAID`, `T.FARM_RES`, `T.URBAN_LABOR`, plus the pre-existing
`T.CORE_LOCAL`. Nothing shipped. No default changed.

**Established**

| | verdict | evidence |
|---|---|---|
| `HAUL_PAID` (ratchet leg 1) | **inert** — the haul-range table is not load-bearing | §3, wave 3 |
| `FARM_RES` | **do not ship as a ceiling brake** — lowers urbanisation by pinning >half the register at 12k (53.9% vs ~43%) | §12 |
| `URBAN_LABOR` | **brakes the ceiling to 73-82% of untreated**, bands non-overlapping on raw values; population *up*; `bind%` below all three untreated draws | §13-15 |
| the `STARVE_SHED` seam | **real, verified by code read, not yet measured** — the fed-ness melt reaches the capacity spike and not the size read | §11, §16 |
| `GRAIN_PRICE_BY_TIER` (leg 2) | **load-bearing — do not simply delete** | §4 |

**Retracted, by later measurement in this same document**

- §8's "urban capacity rewards import-dependence" — the share cancels out of the
  algebra exactly (§10).
- §13.3's "the runaway tail is halved" — the twin read *higher* than untreated
  (§14.1).
- §14's "81% and 82%" tightness — both ratios shared one reference draw; the honest
  range is 73-82% (§15.2).
- §11.4's "the fix is one term and safe" — it lowers cores and will cause
  dissolutions (§16.3).

**Open**

- **Wave 4 is complete.** `URBAN_LABOR` passes a measurement wave, not a gate
  ladder: pin −4.1 to −6.5 points at matched maturity, ceiling below all three
  control draws on raw values, population up. Its median-core headline was
  **retracted** (§20) when a third control draw also cleared the stamp. Effect-size
  magnitude is unresolvable at 61-94% because the controls spread 7.6 points among
  themselves at matched development.
- The **resolution anchor** is an owner decision and blocks the last Phase-2 site
  (`MIN_SETT_DIST`), which blocks `FARM_RES` regardless of §12 (§5b).
- The `STARVE_SHED` fix is designed, predicted and deliberately unbuilt (§16.5).

**The standing caveat on every urbanisation number here:** while the founding stamp
reports full size for starving cities, all of them are read through a partly broken
instrument (§11).

---

## 1. What the ratchet is

A settlement's **tier** is a label derived from its size: village / town / city /
metropolis, quantised off the measured urban core against `TIER_CORE = [0, 2, 10,
40]`. A label. A readout.

Except six tables index capability on it, and four of them fire at the metropolis
bar:

| table | file | at the bar (core 40) | grant |
|---|---|---|---|
| `CORE_BY_TIER` | `territory.js:116` | 3 → 4 | guaranteed home block, **+78% area** |
| `HINTERLAND_BY_TIER` | `territory.js:128` | 6 → 8 | guaranteed farm belt, **+78% area** |
| `FOOD_RANGE_BY_TIER` | `foodHierarchy.js:85` | 2.2 → 3.6 | grain haul range **+64%** |
| `GRAIN_PRICE_BY_TIER` | `foodHierarchy.js:170` | 14 → 22 | grain price **+57%** |

(The other two: `SHIP_FRAC_BY_TIER`, already retired — see §4 — and
`NEEDED_BY_TIER` in `roads.js`, not examined this lap.)

Crossing the bar is a **fractional change in size** at the margin. It buys four
discontinuous upgrades at once, and **every one of them grows the core that
produced the label**, so the label sticks and the grants keep arriving.

CLAUDE.md already forbids this exact shape, for the derived *era*: it "must be
*derived* from emergent development … and only ever *read*, never used to *drive*
anything." The tier is the same kind of object. The ratchet is that rule broken in
space instead of in time.

Two of the four don't even claim a cause. `CORE_BY_TIER`'s comment: *"that size
gap is what reads as a hierarchy on the map."* `HINTERLAND_BY_TIER`'s: *"so a
dominant city can't hoard all the shared countryside."* Those are the pictures
wanted, written directly into the code — the SECOND CARDINAL RULE's own tell.

## 2. How it surfaced

`CORE_LOCAL` lets a city count its own hinterland's harvest toward its urban core.
Before it, a self-fed city was pinned at the 12,000-person founding stamp, hence
pinned at tier 2, hence unable to reach or outbid for the imports that would have
grown it — the closed trap its own lever description names.

Run on the live arm (tw=480, seed 8817, 40k, one treated arm against three
float-epsilon no-mechanism draws; `docs/runs/2026-08-27/mil_*.log`):

- **At 32k-36k the military-balance kill-shot passed.** Per realm: deaths 0.3988
  vs 0.3344 ± 0.1317, wars 11.97 vs 13.59 ± 2.44, shatterings and foundings inside.
- **At 32k-36k the political map converged.** 766 realms vs 782 ± 42; claimed land
  32.34% vs 31.96% ± 1.85. The +43% realms visible at 28k was a timing shift.
- **The urban ceiling broke.** Urban share 8.79% → **15.57%** at 36k, past
  `urban-claim-memo` §5.3's refutation line, against 4.68% on the null arms.

### …and then 36k-40k overturned the first two

> **A verdict read at one horizon is not a verdict.** This is the second time in
> this lap that the next window reversed a conclusion I had already written down
> (the first: "the ceiling is bending down, not up", at 8.79%, one window before it
> reached 15.57%). The mechanisms in this world have a long fuse. Record the
> horizon with the verdict, always.

At 36k-40k, against the same three-draw band:

| metric | treated | no-mech | band | verdict |
|---|---|---|---|---|
| urban share | **28.21%** | 6.06% | — | ~5×, and double the ceiling |
| urban mass | 119,060su | 31,015su | ±2,716 | **32× band** |
| rural mass | 302,921su | 481,453su | ±33,121 | **−37%**, 5.4× band |
| realms | 818 | 889 | ±13 | −71, 5.5× band |
| **ended / realm** | **0.4684** | **0.3140** | **±0.0250** | **+49%, 6.2× band** |
| seceded / realm | 0.4369 | 0.3190 | ±0.0761 | +37%, 1.6× band |
| wars / realm | 16.61 | 12.06 | ±4.62 | inside |
| founded / realm | 0.0631 | 0.0707 | ±0.0143 | inside |

**So the military balance does NOT hold at 40k.** Realm deaths per realm are up
49% at six times the band — the "or explode" half of the memo's own refutation
criterion. The countryside has lost **37% of its mass** to the cities feeding on
it, and the realms are dying on top of that.

The proximate cause is almost certainly economic rather than military: wars per
realm stay inside the band, so this is not walls-versus-armies going wrong. It is
a world whose countryside is being consumed. But "the kill-shot passed" is no
longer a true sentence about this lever, and the earlier verdict is superseded
rather than merely qualified.

So the trap `CORE_LOCAL` opens **was also the brake**. Take it away and there is
nothing between a city and the ratchet.

### A correction that belongs in the record

The first version of this diagnosis argued from the register's **mean** core
(35.1 → 37.4 → 60.3, crossing the bar of 40 exactly when the share doubled). The
distribution instrument then showed the median pinned at **12.0** with p90 103 and
max 557: a large mean with most of the register untouched. The mean crossing 40 is
**not** evidence that cities crossed the bar. The ratchet diagnosis survives, but
as a **tail** phenomenon — a few cities deep past the bar, taking the 3.6× reach
and the 22 bid and pulling grain globally. Which matches a finding already on the
books from the grain-shed lap: *"a runaway metropolis still exists — it
RELOCATES."*

## 3. Leg 1, removed: `T.HAUL_PAID` (built, def 0)

`FOOD_RANGE_BY_TIER` multiplied the **spoilage** range by the **destination's**
size label. Spoilage does not know who is buying: grain rots on the road at a rate
set by the road, the vehicle and the weather.

The table's header names three causes — *"granaries, ports, professional
carters"* — and **two are already separate terms in the same function**, three and
six lines below: carters and roads are the transport-tech term, ports are the
water-corridor term. The third, granaries, is storage at the destination, which
bounds how much a buyer can **hold**, not how far grain survives, and `granaryCap`
prices it where it belongs. The multiplier was a second, unphysical copy.

**What replaces it is already built.** Under `GRAIN_FREIGHT` the buyer buys at the
farm gate and the road eats the loss, so a richer, hungrier city can afford
consignments whose survival fraction is low. A big city still reaches further — by
**paying**. That is continuous in the city's own emergent state instead of stepped
on its rank, and unlike the table **it stops**: past the distance where freight
exceeds the grain's worth, nobody sells. Zero new constants; this deletes one.

## 4. Leg 2, load-bearing: `GRAIN_PRICE_BY_TIER` — do NOT simply delete

The steep gradient is not a size bonus. Its comment is honest about the job it
does: a market town ships only ~a third of the grain it takes in further up yet
pays its villages for **all** of it, so a gentle markup leaves the town a **net
buyer** pumping coin into the countryside. The farm-gate→market step-up is what
lets a town capture the entrepôt margin.

Delete it naively and the coin economy inverts. The margin needs a real source
first — and all three candidates are already tracked:

- **collection**: the haul already happened; `GRAIN_FREIGHT` already prices it
- **storage**: `granaryCap(s)`
- **the market**: `techEff.market`, which already gates `GRAIN_MARKET`

**The honest cause is simpler than any of them: grain is dearer where it is
scarcer.** A market town structurally consumes more than its own land grows —
that is what makes it a town — so its `_foodDemand / _foodSupply` is higher and
its grain is dearer, with no table at all.

Two things stop that working today, and the code already names one of them:

1. The scarcity term is **clamped to [0.5, 3]**, a 6× span, against the table's
   11×.
2. `_foodSupply` is the **retained net after shipping up**, not production — the
   function's own "KNOWN TRADEOFF" note says so, and says the fix ("a truer supply
   signal, production-relative not retained-relative") is a scoped follow-up.

So the replacement is: fix (2), then let scarcity set the price and see what shape
falls out. Build the cause; do not reproduce the 2/8/14/22 curve.

**Precedent that this works.** `SHIP_FRAC_BY_TIER = [0.8, 0.5, 0.2, 0.05]`, in
this same file, was already retired on exactly this reasoning under
`T.SHIP_SURPLUS`: *"the farm gate sells the SURPLUS, not a tier slice — the
fractions were the village world's proxy for need."* It now runs only on the
legacy path. The surgery stopped after one table.

## 5. Legs 3 and 4: the territory half

`HINTERLAND_BY_TIER` and `CORE_BY_TIER` are the bigger job and the wider blast
radius — 46 references assume one owner per tile, `s.tier` has 77 read sites. This
is work-plan item 3 proper, and the design constraints are already established in
`gravity-partition-memo-2026-08-27.md`: attraction is the measured urban core, not
the catchment census (circular by identity); the partition stays exclusive; a
switching margin stops flicker and has real warrant in market-franchise law.

## 5b. The resolution half — measured after the owner named it

> Owner, on being shown that a city's own farmland books a tenth of its core's
> need: *"We need tile irrespective farming."*

Measured with `tools/probe_farmres.mjs` — the same world at two grids, seed 8817,
3000 steps:

| | tw=240 | tw=480 | |
|---|---|---|---|
| core radius | 2 tiles | 2 tiles | identical |
| belt radius | 4 tiles | 4 tiles | identical |
| belt **real area** | 953,598 km² | 211,880 km² | **4.5× apart** |
| farm output per real Mkm² | 0.873 | 3.107 | **3.56× apart** |

**The bug had already been found once.** `territory.js:195-201` diagnoses it in its
own words for the Dijkstra reach budget — *"a fixed budget is a fixed TILE radius, a
smaller REAL catchment on a finer grid (the second half of the Phase-2 resolution
bug: the same settlement farmed ¼ the real land at 2× resolution)"* — and scales it
by `rNormPop`. `countryTerritory.js` does the same for political reach. The two
guaranteed radii were left raw, and being **floors** they override the corrected
budget wherever they bind.

`T.FARM_RES` (built, def 0) applies the pair `settlement.js:3370-3` spells out for
the population scan and applies to itself. **One half landed, one did not:**

- farm output per real Mkm² → **0.873 vs 0.904, invariant** ✓
- belt real area → 953,598 vs 242,421, **still 3.9× apart** ✗

The radii do scale (verified: core 2→4, belt 4→8 at tw=480). The belt is
**contention-limited, not radius-limited**: `crystallize.js:113 MIN_SETT_DIST = 8`
is another raw tile count, so the settlements competing for that ground sit at half
the real distance on the finer grid. Widening a belt cannot help while its
competitors are twice as close.

**So the Phase-2 bug has at least five sites, three repaired**: reach budget ✓,
political reach ✓, the two guaranteed radii ✓, the harvest area unit ✓, and
**settlement spacing — open**.

### Why the fifth site is not simply finished: the anchor is an owner decision

Every repair so far anchors at the REFERENCE grid, because that is where the
constants were calibrated. Measured, that choice propagates the worse absolute
values into the shipped world:

| | test grid | play grid | reality |
|---|---|---|---|
| farm belt **ceiling** | 953,598 km² | 211,880 km² | see the correction below |
| settlement spacing **floor** | 992 km | 496 km | ~200–470 km between PROVINCE seats |

> **CORRECTION to the row above.** I first wrote reality as "30–100 km between
> cities" and compared the floor against it. That is the spacing of **cities**, and
> this simulation's entity is not a city — CLAUDE.md is explicit that it is a city
> **and its province**, and that a realm with four members administers four urban
> provinces. The right comparison is province seats: ~25 Achaemenid satrapies over
> 5.5 Mkm² → ~220,000 km² each → **~469 km apart**; ~50 Roman provinces under
> Diocletian → ~100,000 km² → **~316 km**; ~100 Han commanderies → **~200 km**.
>
> Against that, the play grid's 496 km floor is **in range** and the test grid's
> 992 km is ~2× too sparse — the opposite of a floor ten times too large.
>
> And the same "early world vs mature world" correction applies here as to the belt:
> measured at 40k the mature register holds ~47–54,000 km² per settlement, i.e.
> centres ~224 km apart — Han-commandery scale, and **well inside** the 496 km floor,
> which therefore does not bind once the world fills. Both constants are **early-world
> floors**. They shape genesis, not the mature map.

> **CORRECTION, and it retracts a finding of mine from earlier today.** I wrote that
> the belt is "absurdly large at both grids — 953,598 km² is not a hinterland, it is
> an empire." That measurement came from a **5-settlement world at 3,000 steps**, and
> I read it as though it described the mature one. It does not. In the mature world
> the belt constant is a ceiling that contention almost never lets a settlement
> reach:
>
> | arm at 40k | claimed land | settlements | **per settlement** |
> |---|---|---|---|
> | base | 65.1 Mkm² | 1,385 | **46,986 km²** |
> | chaos | 58.7 Mkm² | 1,289 | **45,552 km²** |
> | CORE_LOCAL | 65.7 Mkm² | 1,221 | **53,782 km²** |
>
> ~47–54,000 km² per settlement — Denmark-to-Estonia scale, entirely reasonable for a
> city *and its province*, which is what the entity is (CLAUDE.md: a realm with four
> members administers four urban provinces; Achaemenid satrapies averaged ~200,000
> km²). The belt is **not** absurdly sized in effect.
>
> What survives, and it is narrower but still real: the constant **does** bind in the
> **empty early world** — which is exactly when cities are founded and when the 12,000
> founding stamp is set. So it matters for genesis, not for the mature map. And the
> resolution defect is untouched by this correction: 953,598 against 211,880 is a
> 4.5× difference in the same constant's meaning, whether or not the constant binds.

*(The spacing row is the FLOOR the constant sets — `MIN_SETT_DIST = 8` tiles at the
measured tile width — not a measured mean; `SPARSE_SPREAD` pushes barren land
further apart still. It is arithmetic on the constant, and the real mean is ≥ it.)*

**The play grid is closer to right on both counts.** So scaling `MIN_SETT_DIST` the
obvious way moves cities from 496 km apart to 992 km: consistent, and further from
reality than before.

Three ways to make the world resolution-invariant, not equivalent:

1. **Anchor at the reference grid** — what has been done; propagates the error.
2. **Anchor at the shipped grid** — breaks every calibrated constant.
3. **Anchor at real distances**, the way `T.HAUL_PHYS` did off Diocletian's edict —
   right by the SECOND CARDINAL RULE, since the constants would then mean something
   on their own. A recalibration wave, not a patch.

Recommended: (3). Not chosen unilaterally.

## 6. Method notes worth keeping

- **The arming check** (`urban.coreBlockRanPct` / `urban.coreLocalBindPct`)
  confirmed itself against a static prediction made days earlier: the memo counted
  37% of the register where the local claim would bind; the live arms reported
  **37.9%**, with **0.0%** on every null arm.
- **The matched-maturity view reversed a conclusion.** At 20k-24k the treated arm
  reads "8× the band, MORE war" at matched step and "3.2× the band, LESS war" at
  matched claimed land. The first number was measuring that the treated world is
  older, not that it is more violent.
- **Cross-tree comparison is legitimate here only because it was checked.** The
  arms span two tree hashes; every change in between was verified byte-transparent
  by `probe_hashbase` (7fb32527 / ebfb8021 each time).
- **Band=0 verdicts in the first political window are artifacts.** At 20k-24k the
  null arms had zero deaths and zero secessions, so any nonzero treated value read
  as "OUTSIDE". The 28k-32k band is the first with enough events to carry a verdict.

---

## 7. Wave 3, pre-registered before the data lands

Four arms, live arm, tw=480, seed 8817, 40k, all carrying `CORE_LOCAL` so there is a
runaway to brake: `+HAUL_PAID`, `+FARM_RES`, `+both`, and a float-epsilon draw for
the band. **The criterion is written here before the decisive window reports**, because
today has already shown how easily a verdict follows the number that happens to
arrive.

The two reference trajectories, both measured:

| urban share | 28k | 32k | 36k | 40k |
|---|---|---|---|---|
| **untreated** (base world, 3 draws) | 2.45% | 3.83% | 4.68% | 6.06% |
| **runaway** (`CORE_LOCAL` alone) | 7.68% | 8.79% | **15.57%** | **28.21%** |

- **A brake HOLDS** if its arm tracks the untreated row — under ~7% at 40k, and with
  the 36k→40k increment small rather than doubling.
- **A brake FAILS** if it tracks the runaway row: past 15% at 36k, and accelerating.
- **A brake PARTLY holds** if it lands between and, critically, **decelerates** — the
  increment matters more than the level, since the untreated row's increments are
  +1.4, +0.9, +1.4 while the runaway's are +1.1, +6.8, +12.6.

Two things that would NOT count as success and must be checked before any is claimed:

1. **Starving the world.** If the share falls because urban mass collapsed while total
   population fell too, that is not a brake, it is a famine. Check `urban + rural`
   against the untreated arms — `FARM_RES` v1 passed this check (total 125,925su
   against 104,415su, i.e. more people, more rural).
2. **Making the pin worse.** The owner's complaint is cities stuck at 12,000. If the
   modal share at exactly 12.00 rises, a brake has bought the ceiling at the cost of
   the thing this lap exists to fix — which `FARM_RES` v1 measurably did (45.1%
   against 40.6%, and `bind` 13.3% against 29.2%).

Both checks are in the probe's own output. Neither is optional.

---

## 8. The perverse loop: urban capacity keys on the SHARE imported, not the AMOUNT available

`T.URBAN_LABOR`'s first political window contradicted its own pre-registered
prediction on both axes, and the reason is worth more than the lever.

| 20k–24k | untreated (CL) | HAUL_PAID | FARM_RES | **URBAN_LABOR** |
|---|---|---|---|---|
| urban share | 5.08% | 5.09% | 3.34% | **6.85%** |
| urban mass | 5,351su | 5,319su | 3,991su | **7,121su** |
| rural mass | 100,025su | 99,096su | 115,531su | **96,829su** |
| core p90 | 108.7 | 103.2 | 70.0 | **113.4** |
| core max | 357.6 | 556.7 | 418.7 | **1,177.6** |
| pin | 36.2% | 40.6% | 38.2% | **44.8%** |

Predicted: hold the ceiling, leave the pin alone. Measured at this window: ceiling
**up**, largest core more than tripled, pin **worse**. The two untreated draws read
5.08 and 5.09, so the band here is tight.

**The mechanism.** Urban capacity is built from

```
importShare = (_foodNet − _landFood) / _foodSupply
kBeyond     = _k × importShare          ← the agglomeration target's basis
```

`importShare` is the **fraction** of a city's food that came from beyond its own
land. Cut `_landFood` and that fraction **rises** for any city with imports at all —
the numerator is its imports, and the denominator shrinks with local supply. So the
model reads *"this city's own fields feed it less"* as *"this city is more
import-dependent"* and **rewards it with urbanisation**.

**Urban capacity is keyed on the share of food imported, not on the amount of food
available. Starve a city's hinterland and it grows.**

That is plausibly a deeper defect than any of the ratchet's four legs, and it
explains something that had been sitting in plain sight all day: `CORE_LOCAL` exists
*because* a self-fed city was denied urban capacity, and its fix was to credit local
food — while `URBAN_LABOR` removes local food and collects the same reward from the
opposite direction. Both levers are pushing on the same broken denominator.

It also explains why `FARM_RES` behaved the way it did rather than the same way: it
cuts `_landFood` **and** the census over the same catchment, so the ratio moves far
less than under a pure labour withdrawal.

**Status:** one window, 143 settlements, and this lap has twice been punished for
calling a verdict at the first window that showed something. But the direction is
wrong on both pre-registered axes *and* there is a mechanism that predicts it, which
is a different situation from noise. The arm runs to 40k before any verdict.

---

## 9. Wave 4 — `URBAN_LABOR` measured to 32k, and a transparency proof I did not plan

### 9.1 The `ref3` arm is not a third draw — it is the chaos2 draw carried to 40k

I launched `w4_cl_ref3` as `CORE_LOCAL=1,MINING_RATE=4.9999999` believing it was a
new epsilon. It is not: `mil_corelocal_chaos2` already used that exact lever set on
the same seed. The two arms' `MACHINE` lines are **identical over every window both
have reached** (windows 0-32k; the diff is one line, the window chaos2 has and ref3
has not yet produced).

Two consequences, one bad and one good:

- **The untreated band at 32k-40k is still two independent draws, not three.** The
  intended tightening did not happen.
- **It is an unplanned byte-transparency proof, and a far stronger one than the gate
  I have been running.** `probe_hashbase` checks a few thousand steps. This is
  32,000 steps of the live arm at the shipped grid, through 592 realms and 22% of
  the land claimed, reproducing bit-for-bit across a tree that has since gained
  `URBAN_LABOR`, `FARM_RES` and `HAUL_PAID`. All three are genuinely inert at
  `def: 0`.

The arm is still worth its core: chaos2 stopped at 32k, so ref3 supplies that draw's
32k-40k tail, which nothing else has.

### 9.2 The numbers, 20k-32k

Urban share of population mass, by window. Untreated = `CORE_LOCAL` alone across
three epsilon draws.

| window | untreated (3 draws) | `+URBAN_LABOR` | `+ULAB` (chaos) | `+ULAB+FARM_RES` |
|---|---|---|---|---|
| 20k-24k | 5.08 / 5.16 / 5.32 | 6.85 | 6.93 | 3.15 |
| 24k-28k | 7.04 / 7.35 / 7.68 | 6.72 | 6.49 | 4.13 |
| 28k-32k | 8.60 / 8.79 / 11.45 | **7.59** | **7.82** | — |

And `bind%` — the pin measure, the axis the owner actually complained about:

| window | untreated | `+URBAN_LABOR` | `+ULAB` (chaos) | `+ULAB+FARM_RES` |
|---|---|---|---|---|
| 24k-28k | 32.6 / 33.3 / 37.9 | 33.0 | 34.8 | 23.4 |
| 28k-32k | 32.9 / 34.0 / 36.1 | 34.1 | 36.6 | — |

### 9.3 What that supersedes

§8 called `URBAN_LABOR` wrong on both pre-registered axes off the 20k-24k window
alone. **That read does not survive the next two windows.** At 20k-24k the treated
arms sit above the untreated band; by 24k-28k they are inside it; by 28k-32k both
sit **below the entire untreated spread** (7.59 / 7.82 against a 8.60 minimum), and
`bind` sits **inside** the untreated band at every window — neutral, not worse.

The §8 mechanism (urban capacity keyed on import *share*, so starving a hinterland
reads as import-dependence and is rewarded) is still a real defect in the
denominator, and still worth fixing on its own terms. What is now clear is that its
transient — a capacity bump while the world is young and imports are a large
fraction of a small supply — is not the arm's steady state. This is the third time
this lap that a single window has produced a story the next window undercut.

**No verdict yet.** 32k-36k is where the untreated world jumps (+6.1 and +6.8 in the
two draws that reached it, 8.6→14.7 and 8.8→15.6). `URBAN_LABOR`'s last two
increments are −0.13 and +0.87. If it tracks the untreated jump it fails; if it
stays near 8-9 it holds. The criterion was written in §7 before any of this data
existed and does not move now.

---

## 10. §8 IS RETRACTED — the share cancels, exactly

§8 claimed: *"Urban capacity is keyed on the share of food imported, not on the
amount of food available. Starve a city's hinterland and it grows."* I published
that. **It is wrong.** Not approximately — the term it names cancels out of the
algebra exactly.

### 10.1 The cancellation

Three lines, all already in the tree:

```
settlement.js:3192   netLand      = s._foodNet
settlement.js:3354   _foodSupply  = netLand + fish                = foodNet + fish
settlement.js:3591   foodK        = (_foodSupply + _foodExported) / perCapita
settlement.js:3647   _k           = max(K_MIN_VIABLE, foodK)              [DISSOLVE_FARMS]
popField.js:1979     importShare  = clamp01((_foodNet − _landFood) / _foodSupply)
popField.js:1981     kBeyond      = _k × importShare / scale
popField.js:2103     kLocal       = _k × (1 − importShare) / scale        [CORE_LOCAL]
```

Substitute. With no market exports and `_k` off its floor:

```
kBeyond = (foodNet + fish)/pc × (foodNet − landFood)/(foodNet + fish)
        = (foodNet − landFood) / pc          ← the IMPORT VOLUME, in mouths

kLocal  = (foodNet + fish)/pc × (landFood + fish)/(foodNet + fish)
        = (landFood + fish) / pc             ← the LOCAL HARVEST, in mouths
```

**`_foodSupply` is both the numerator of `_k` and the denominator of
`importShare`, so it divides out.** The two capacity terms are pure volumes —
grain divided by per-capita demand. There is no share-reward anywhere in them.
`perCapita` cancels nothing and needs to be nothing in particular; the result
holds whatever `_urbanFactor` does.

So cutting a city's local harvest leaves `kBeyond` **untouched** (its imports did
not change) and cuts `kLocal` **proportionally**. Urban capacity falls with local
food, which is the direction it should fall. §8's mechanism does not exist.

Two exceptions, both narrow and neither load-bearing here: the market export
add-back (`_foodExported`) scales `kBeyond` up by `(supply+exported)/supply` for
sellers, and below `K_MIN_VIABLE` the floor breaks the cancellation for the
starving tail.

### 10.2 What actually raised urban share at 20k-24k

The real mechanism was visible in the instrument the whole time, in the column I
built to answer a different question.

```
coreEff = min(_coreF, max(holdF, kLocal) + kBeyond)
                      ^^^^^^^^^^^^^^^^^^
```

`holdF` is the founding stamp — 12 sim units, 12,000 people — and it is a **floor**
under the local term. `bind%` is precisely the share of settlements where
`kLocal > holdF`, i.e. where that floor is *not* binding. At 20k-24k it read
**29-34%**. So for roughly **seven cities in ten, the urban core is pinned to the
stamp and does not respond to local food at all.**

Now apply any brake on farm output:

- **The countryside shrinks immediately** — rural population is `people − _urbanPop`,
  and `people` follows `_k`, which follows the harvest. Measured: rural mass
  −7% at 20k-24k.
- **The cities do not** — 70% of them are sitting on a floor the brake cannot reach.
  Measured: urban mass +22%.

Urban *share* rises because the denominator was cut and the numerator was floored.
It is an artefact of the pin, not a reward for import-dependence.

And that predicts the rest of the wave, which §8's story did not: as the world
matures, more cities clear the stamp, the brake reaches them too, and the treated
arms cross below untreated — 20k-24k above the band, 24k-28k inside it, 28k-32k
below all three draws. That is exactly the observed sequence.

### 10.3 What this changes

- **The pin is not one pathology among several. It is the thing that makes every
  food brake read backwards while it holds.** Any mechanism that reduces rural
  output — `URBAN_LABOR`, `FARM_RES`, a yield change, a climate shock — will
  raise measured urbanisation in a world where most cores are stamped, and will
  do it for a reason that has nothing to do with the mechanism being tested.
- **§8's "both levers push on the same broken denominator" is withdrawn.** There is
  no broken denominator. `CORE_LOCAL` credits local harvest volume and
  `URBAN_LABOR` reduces local harvest volume; they oppose each other honestly.
- **The §8 objection to `URBAN_LABOR` is void**, and the wave-4 verdict rests
  entirely on the 32k-36k window and the pre-registered §7 criterion, as it should
  have from the start.

This is the fourth time this lap that a story told from one window did not survive
contact with the next thing measured. The pattern is consistent enough to name:
**every one of them was a mechanism inferred from a direction, and every one was
refuted by reading the actual arithmetic or waiting one more window.** The
arithmetic here took ten minutes and could have been done before §8 was written.

---

## 11. THE SEAM — `STARVE_SHED` reaches the capacity spike and not the size read

§10.2 named the founding stamp as a floor that a food brake cannot reach. Reading
why turned up something better than a diagnosis: **the law that is supposed to make
that floor yield already exists, is already flipped on, and is wired to only one of
the two places the stamp is read.**

### 11.1 Two sites, two different laws

The stamp `_coreHoldCapF` (= `coreBarF × 1.2` = 12 sim units = 12,000 people,
`crystallize.js:1751`) is consumed twice in the same function, ~90 lines apart.

**Site A — the CAPACITY SPIKE** (`popField.js:2182-2193`), what the field's logistic
and migration see:

```js
if (T.CORE_HOLD && s._coreHoldCapF > 0 && _coreF > 0) {
  const fedY = T.STARVE_SHED && s._fedM !== undefined ? s._fedM : 1;
  const hold = Math.min(_coreF, s._coreHoldCapF) * fedY;      // ← melts when unfed
  if (hold > kCap) kCap = hold;
}
```

**Site B — the SIZE READ** (`popField.js:2104-2105`), what `_urbanPop`,
`_coreMeasured`, the tier ladder and every ratchet leg keyed on tier see:

```js
const holdF = s._coreHoldCapF > 0 ? s._coreHoldCapF : Math.max(0, pf[ti]);
coreEff = Math.min(_coreF, Math.max(holdF, kLocal) + kBeyond);   // ← raw stamp
```

Site B has no `fedY`. `git log -L` confirms this predates `CORE_LOCAL` — the line
was `Math.min(_coreF, holdF + kBeyond)` before `df837c7` and the raw stamp was
already the floor. This is baseline behaviour, not something a lever introduced.

### 11.2 Why that is a defect and not a choice

`T.STARVE_SHED` exists for exactly this. Its own description says so:

> *"'hold what arrived' was food-blind, so a chronically unfed core kept its full
> capacity and the field logistic kept growing it through famine. The floor now
> carries the settlement's fed-ness average … a starving one melts at generational
> pace and hunger finally empties the CITY, not just the land around it."*

It empties the city's *capacity*. It does not empty the city's *reported size*. So a
core that has been starving for generations still reads 12,000 urbanites, still
quantises to tier 2, still holds `FOOD_RANGE_BY_TIER`, `GRAIN_PRICE_BY_TIER`,
`granaryCap` and `hinterlandRadiusFor` at the tier-2 rungs, and still contributes a
full 12 sim units to every urbanisation figure this lap has quoted. The melt was
built and shipped and then read by only half the code that needed it.

`_fedM` is not near 1 in this world — the shipped record has Egypt/Mideast at
fed p50 0.24 and leaf settlements at p50 0.08 before the grain market, 0.58 after.
A `× fedY` at site B is not a cosmetic change.

### 11.3 Why this matters for everything measured today

It is the confounder in §10.2 with a name. A brake on farm output shrinks the
countryside and starves marginal cores; the starved cores' capacity melts, so their
people leave — but their *measured urban core* does not move, because site B never
learned about fed-ness. The urban-share numerator is held up by cities that are, by
the simulation's own fed-ness memory, dying. That is the mechanism by which a food
brake reads as urbanisation.

It also means the standing 12k complaint has two distinct halves that this lap had
been treating as one:

- **cities that never grow past the stamp** — `CORE_LOCAL`'s target, the closed
  loop (no imports → no core → no tier → no imports). Addressed.
- **cities that should have fallen back below it and cannot** — this seam. The
  `DISSOLVE_CORE` law (`tuning.js:92`, the owner's *"they CANNOT become smaller
  than 12k"*) was written against exactly this shape and tests the basin and the
  core against the city bar — but the core it tests is the one site B reports.

### 11.4 Registered, not built

The fix is one term: carry `fedY` into site B the way site A already does. It adds
no constant, invents no mechanism, and applies a law the repo already flipped to the
second place it plainly belongs.

**It is not being built today.** Four arms are on the machine and this lap's
recorded lesson is that a mechanism proposed off a fresh reading gets measured
before it gets written. Pre-registering the prediction now, so the measurement can
falsify it later:

- `bind%` should be **unchanged** — the seam is about `holdF`'s value, not about
  whether `kLocal` beats it. (If bind moves much, the reasoning here is wrong.)
- Urban share should **fall**, concentrated in the marginal/starving tail, with the
  fed cores untouched.
- `MODE …su held by n/N` — the share sitting at exactly 12.0 — should **fall
  sharply**. That is the direct measure and the one to watch.
- Total population should be **roughly unchanged**: capacity already melted at site
  A, so the people have already left; this corrects the *report*, not the census.

That last one is the disqualifier's mirror image and worth stating plainly: if
population drops materially, the two sites were not measuring the same thing and
the premise fails.

---

## 12. The pin measure, tabulated — and what it says about `FARM_RES`

`probe_milbalance` prints the modal core size and how much of the register holds it.
That is the owner's complaint stated directly, and this lap had not tabulated it
across the wave. Share of settled entities whose measured core sits at **exactly
12.00 sim units** — the founding stamp:

| window | untreated (2 draws) | `+URBAN_LABOR` | `+ULAB` (chaos) | `+ULAB+FARM_RES` |
|---|---|---|---|---|
| 20k-24k | 36.2 / 43.5 | 44.8 | 45.0 | 40.0 |
| 24k-28k | 43.8 / 45.0 | 45.4 | 44.8 | **50.6** |
| 28k-32k | 44.6 / 42.1 | 40.9 | 42.9 | **53.9** |

`URBAN_LABOR` sits inside the untreated spread at every window and is at or below it
by 28k-32k. `URBAN_LABOR + FARM_RES` is **11 points worse than the untreated
maximum** by 28k-32k, and rising while every other arm is flat or falling.

### 12.1 `FARM_RES` buys its ceiling by pinning more cities

Wave 3 recorded that `FARM_RES` holds the urban ceiling (7.22% vs 20.61/28.21%) but
fails the pre-registered pin disqualifier on `bind%` (22.4% vs 32.9%). This is the
same finding on the direct measure, and it is worse than `bind` made it look: over
half the register frozen at the founding stamp, against ~43% untreated.

The two measures agree because they are two views of one event. `FARM_RES` halves
the hinterland radius, which cuts each city's own harvest, which cuts `kLocal`,
which drops cities back below `holdF`. `bind%` falls (fewer cities beat the stamp);
the modal share rises (more cities sit on it). Urban share falls — but §11 says why
that number falls, and it is not because the cities got smaller in any way the world
would feel. They are being held at 12,000 by a floor that does not know they are
starving.

**A brake whose whole effect is to push cities back onto the pin does not fix the
pin, it feeds it.** `FARM_RES` remains blocked on the resolution-anchor decision
regardless; this is a second, independent reason not to ship it as a ceiling brake.

### 12.2 A number in §10.2 was loose

§10.2 said *"for roughly seven cities in ten, the urban core is pinned to the stamp
and does not respond to local food at all."* Two different quantities were run
together there:

- **~65%** is the share where `kLocal` does **not** beat `holdF` (`bind%` 33-37%, so
  63-67% of cores take the stamp as their local term). This is the number the
  argument needs, and it is right.
- **~43%** is the share sitting at **exactly** 12.00su. The rest of that 65% clear
  the mode because `kBeyond` — their imports — lifts them above it.

The mechanism is unchanged: local harvest does not reach the core read for about two
thirds of the register. But "pinned at 12k" describes 43%, not 70%, and the
distinction matters because it is the 43% that §11's fed-ness melt would actually
move.

---

## 13. WAVE 4 VERDICT — `URBAN_LABOR` partly holds, and is the first brake that costs nothing

The pre-registered decisive window (§7: *"32k-36k decides it"*) is in.

### 13.1 The decisive window, matched on maturity

Comparing at the same step is not comparing at the same world. The untreated draw
that brackets `URBAN_LABOR`'s claimed-land figure is interpolated to it; the other
would require extrapolating past its own range and is dropped rather than stretched.

| | claimed% | urban% | bind% | pin (=12.00su) | urban su | rural su | **total su** | max core |
|---|---|---|---|---|---|---|---|---|
| untreated, clean | 32.34 | 15.57 | 39.9 | — | 64,186 | 348,138 | 412,324 | — |
| untreated, chaos1 | 37.51 | 14.72 | 39.5 | 37.4% | 63,454 | 367,527 | 430,981 | 1234.3 |
| untreated, **interpolated to 36.04** | 36.04 | **14.09** | | | | | | |
| **`+URBAN_LABOR`** | 36.04 | **11.59** | **39.1** | **36.0%** | 51,959 | **396,321** | **448,280** | **613.5** |

### 13.2 Against the criterion, as written

§7 set three outcomes before any of this existed. **HOLD** = tracks the base world
(~7% with a small final increment). **FAIL** = tracks the runaway (past 15% at 36k,
accelerating). **PARTLY** = between and decelerating.

`URBAN_LABOR` is **between**, clearly: 11.59 against a base world at ~6-7% and a
runaway at 14.72/15.57. It is not past 15% and it is not near 7%.

On the deceleration clause I have to be exact rather than generous. Its increments
run −0.13, +0.87, **+4.00** — that is accelerating in absolute terms. It decelerates
only *relative* to the untreated world, whose same-window increments were +6.12 and
+6.78. The brake removes about 40% of the growth and 18% of the level; it does not
flatten the curve. **The letter of "PARTLY holds" is met on "between" and not on
"decelerating," and the honest verdict is: it brakes, it does not hold.**

### 13.3 Both disqualifiers pass — cleanly, and one of them inverts

The two disqualifiers were written to catch a brake that buys its number with damage.
Both were checked before the headline:

- **Starvation.** Total population must not fall. It **rose**: 448,280su against
  430,981 and 412,324 — **+4.0%** over the bracketing draw. The countryside is
  *bigger* (396,321 vs 367,527, **+7.8%**), which is what a mechanism that stops
  counting city-dwellers as farmhands should do. This is the opposite of the
  failure mode, not a narrow escape from it.
- **The pin.** `bind%` 39.1 against 39.5/39.9, and the direct modal share 36.0%
  against 37.4%. Neutral to marginally better on both, at every window of the wave.

And a third thing nobody asked for: **the runaway tail is halved.** Largest core
613.5su against 1234.3su. The brake bites hardest exactly where the pathology is —
the one metropolis eating a continent — and not on the median city, which stays at
12.0su in both arms.

### 13.4 What this settles

Four mechanisms have now been measured against the same ceiling on the same arm:

| | ceiling | pin | population |
|---|---|---|---|
| `HAUL_PAID` | inert | — | — |
| `FARM_RES` | holds (7.2%) | **fails** — 54% pinned | — |
| `URBAN_LABOR + FARM_RES` | lowest (4.9%) | **worst** — 53.9% pinned | — |
| **`URBAN_LABOR`** | **brakes 40%** | **neutral** (36.0% vs 37.4%) | **+4%** |

`URBAN_LABOR` is the only one that moves the ceiling without paying for it
somewhere else, and the only one that leaves the world with more people in it than
it found. That is the difference between a brake and a mechanism: the others reduce
urbanisation by making the world smaller or by shoving cities back onto the stamp;
this one reduces it by charging cities the farm labour they actually withdrew.

**Not yet a flip recommendation.** 36k-40k is still running, and that is where the
untreated world went +12.6 and +5.9 — the steepest part of the runaway and the real
test of whether a 40% brake survives at the top. And §11's seam is untouched: while
the founding stamp reports full size for starving cities, every ceiling number in
this table — including this one — is measured through a partly broken instrument.

---

## 14. The chaos twin lands — one §13 claim retracted, the main one replicates

`URBAN_LABOR`'s float-epsilon twin reached the decisive window an hour after the
first draw. It refutes one of §13's three claims and strengthens the other two.

| 32k-36k | claimed% | urban% | bind% | pin | total su | max core |
|---|---|---|---|---|---|---|
| untreated, clean | 32.34 | 15.57 | 39.9 | — | 412,324 | — |
| untreated, chaos1 | 37.51 | 14.72 | 39.5 | 37.4% | 430,981 | 1234.3 |
| `+URBAN_LABOR` | 36.04 | 11.59 | 39.1 | 36.0% | 448,280 | 613.5 |
| `+URBAN_LABOR` (chaos) | 32.72 | 10.29 | 39.2 | 39.4% | 439,134 | **1366.5** |

### 14.1 RETRACTED: "the runaway tail is halved"

§13.3 reported the largest core at 613.5su against 1234.3su untreated and read it as
the brake biting the runaway metropolis. **The twin reads 1366.5su — above the
untreated draw.** The treated pair straddles the untreated value. There is no tail
signal; there was one draw's noise in a quantity that is, by construction, the
maximum of a heavy-tailed distribution and therefore the single worst statistic in
the printout to read off one arm.

I flagged that exact failure mode in §10.3 — *"a mechanism inferred from a
direction"* — and then did it again in the same document three sections later, on a
claim I had explicitly labelled as unasked-for. The lesson is not about tails. It is
that the sentence "and here is a bonus finding" is where the discipline lapses.

### 14.2 SOFTENED: the pin is neutral, not better

§13.3 called the modal-share reading "marginally better" (36.0% vs 37.4%). The twin
reads 39.4%, straddling untreated. The correct word is **neutral** — which is what
the disqualifier required and all it required. `bind%` does hold up as marginally
better: 39.1 and 39.2 against 39.5 and 39.9, below both untreated draws.

### 14.3 REPLICATED, and tightly: the ceiling effect and the population gain

Interpolated to matched maturity against the one untreated draw that brackets both:

```
ULAB    claimed 36.04   urban 11.59  vs 14.09   →  82% of untreated
ULABx   claimed 32.72   urban 10.29  vs 12.66   →  81% of untreated
```

**Two independent draws landing at 81% and 82% is a far stronger result than the
single −2.5 points §13 reported.** The effect size is stable under a float-epsilon
perturbation of an unrelated lever, which is this repo's standard for "not noise."

The population gain replicates too, and at almost exactly matched maturity — the
twin's claimed-land figure (32.72) sits within half a point of the untreated clean
draw's (32.34):

```
ULABx  439,134su    untreated clean  412,324su    →  +6.5%
```

So the headline stands and is better evidenced than when it was written: **a brake
that removes about a fifth of urbanisation, leaves the pin alone, and leaves the
world with more people in it.** What does not stand is that it does so by cutting
down the largest city. Where the fifth comes from is now an open question, not an
answered one.

---

## 15. Third untreated draw — the bands separate, and §14's tightness was partly mine

`w4_cl_ref3` reached the decisive window: claimed 34.35, urban **14.46**, bind 41.3,
total 418,181su. The untreated reference at 32k-36k is now three draws.

### 15.1 The bands do not overlap

```
untreated   14.46   14.72   15.57        (spread 1.11)
treated     10.29   11.59                (spread 1.30)
                    ^^^^^ gap 2.87 ^^^^^
```

On raw values, with no maturity correction at all, every treated draw is below every
untreated draw. That is the cleanest form this comparison can take and it is the
first time this lap that any mechanism has produced it.

`bind%` separates the same way, and in the direction the disqualifier wanted:
treated 39.1 and 39.2 against untreated 39.5, 39.9 and **41.3** — below all three.
So the marginal-improvement reading on the pin, which §14.2 softened to "neutral" on
the modal measure, does hold on `bind`.

Population separates too, and against the maturity gradient: both treated draws hold
more people than any untreated draw **despite being less far along**.

```
untreated   412,324 (claimed 32.34)   418,181 (34.35)   430,981 (37.51)
treated     439,134 (claimed 32.72)   448,280 (36.04)
```

### 15.2 §14's "81% and 82%" shared a denominator

§14 called two draws landing at 81% and 82% "a far stronger result." The treated
numerators are genuinely independent. **The untreated denominator was the same draw
in both** — chaos1 was the only reference whose claimed-land range bracketed both
treated arms, so the agreement measured the stability of the treatment and not, as
the phrasing implied, of the whole ratio.

With `ref3` available as a second anchor, one more pair becomes computable, and it
does not agree as neatly:

| pair | untreated at matched maturity | treated | ratio |
|---|---|---|---|
| ULAB (36.04) vs chaos1 | 14.09 | 11.59 | 82% |
| ULABx (32.72) vs chaos1 | 12.66 | 10.29 | 81% |
| ULABx (32.72) vs **ref3** | 14.06 | 10.29 | **73%** |

The other three pairs would require extrapolating a reference past its own range and
are dropped rather than stretched.

**The honest effect size is 73-82% of untreated — "removes a fifth to a quarter" —
not the 81-82% §14 reported.** The spread comes from the untreated world's own
trajectory being less repeatable than the treated one: ref3 sat at 11.45% urban at
28k-32k where chaos1 sat at 8.60%, so the two references disagree about how much
urbanisation the untreated world had already accumulated before this window.

That is worth noting on its own: **the untreated world's path is noisier than the
braked world's.** Three draws that spread 2.85 points at 28k-32k converge to 1.11 by
32k-36k, while the treated pair holds 1.30 throughout. A brake that reduces
run-to-run variance is behaving like a stabiliser, which is what a real constraint
does and what a fitted constant does not.

### 15.3 Where this leaves the verdict

Unchanged in direction, better evidenced, honestly wider in magnitude:

- **Ceiling:** treated 73-82% of untreated, bands non-overlapping on raw values.
- **Pin:** `bind%` below all three untreated draws; modal share neutral.
- **Population:** above all three untreated draws at lower maturity.
- **Tail:** no signal (§14.1, retracted).

36k-40k remains the last word — the untreated world's steepest window, where two of
the three draws went +12.6 and +5.9.

---

## 16. §11 refined — why the melt at site A cannot reach the report, and why the fix is not one term

Before building §11's fix I went looking for the reason it is *needed* — if site A
already melts a starving core's capacity, the people should already have left, and
the size read's own `min(_coreF, ·)` should already report a smaller core. It does
not, and the reason is worth writing down.

### 16.1 The spike ADDS to terrain capacity

`applyUrbanSpikes` (popField.js:1626): `cap[ti] += e.k`.

The urban spike is added **on top of** the tile's own terrain-derived capacity, not
substituted for it. So when `STARVE_SHED` melts the spike toward zero, what remains
is whatever the land itself supports — and a city sits on good land by construction
(that is what `cityBasinOkAt` tested at the mint). The disk keeps holding twelve or
more sim units of people, so `_coreF ≥ 12` and the `min` never binds.

### 16.2 The two sites control different things

That makes them complementary rather than redundant, which is exactly why one
being fed-ness-aware and the other not is a seam and not a duplication:

- **Site A (capacity spike)** — how many people the core tile *can hold*, over and
  above what the land gives for free. Fed-ness reaches this.
- **Site B (size read)** — how many of the people standing there *count as urban*.
  `coreEff = min(_coreF, max(holdF, kLocal) + kBeyond)`: the field supplies the cap,
  the economy supplies the estimate, and the smaller wins. Fed-ness does not reach
  this.

For the 43% at exactly 12.00su, the estimate is the binding side and the estimate is
the stamp: `kLocal ≤ holdF` and `kBeyond ≈ 0`, so the whole expression is 12. The
people are genuinely there — the report simply refuses to credit more than the
founding endowment as urban, and refuses to credit less no matter how hungry they
are.

### 16.3 The fix is not safe-by-construction, and I said it was

§11.4 called it *"one term … adds no constant, invents no mechanism."* The first
half is true and the second half is misleading.

`CORE_LOCAL` was safe by construction and its design note says why: `max` not `plus`
makes it **strictly monotone**, so no core falls, no tier demotes, and it *cannot
cause a single `DISSOLVE_CORE` dissolution*. Multiplying `holdF` by `fedY < 1` is the
exact opposite — it lowers reported cores, and a core sustained below `TIER_CORE[2]`
is precisely what `DISSOLVE_CORE` dissolves. **Cities will die.**

That is the intended behaviour — `tuning.js:92` is the owner's own *"cities can
become smaller than 12k, then they stop being cities"*, and `STARVE_SHED`'s text
promises *"hunger finally empties the CITY"*. But intended is not the same as small,
and a change that can retire a large share of the register is not honestly described
as one term. The `DISSOLVE_SUSTAIN` timer is the anti-flicker guard and it will
matter here.

### 16.4 An open modelling question, stated rather than assumed

At site A, `fedY` multiplies a **capacity floor** — "hold what arrived, scaled by
how well you've been eating" is a natural reading. At site B it would multiply a
**size estimate**, and a city at `fedM = 0.24` is not obviously a city 24% the size.
It is a city that has been receiving a quarter of its food.

Consistency with the site the repo already shipped is a real argument, and it is the
argument I would make. But it is a modelling choice, not an identity, and the
alternative — that the stamp should decay on a sustain timer rather than scale
linearly with fed-ness — is not obviously worse. Worth deciding deliberately.

### 16.5 Revised prediction list

Replacing §11.4's, with the entity count added and the population claim weakened:

- `bind%` **unchanged** — the seam is `holdF`'s value, not whether `kLocal` beats it.
- The **exactly-12.00su share falls sharply**. Still the direct measure.
- Urban share **falls**, concentrated in the starving tail; fed cores untouched.
- **Entity count falls** — possibly a lot. This is `DISSOLVE_CORE` doing its stated
  job, but it is the number most likely to reveal the change as too blunt, and it
  needs a band agreed before the arm runs, not after.
- Total population **roughly unchanged**: under `ONE_POP` the people were always the
  land's, so retiring the urban institution should move the urban/rural split and
  not the census. If the census moves materially, the premise is wrong.

---

## 17. `URBAN_LABOR` runs to 40k — the brake holds at the top, on one draw

The first `URBAN_LABOR` arm completed. Its final window needs no interpolation,
because the maturity gradient runs **against** it:

| 36k-40k | claimed% | urban% | bind% | pin | rural su | total su | p50 core |
|---|---|---|---|---|---|---|---|
| untreated, clean | 44.42 | 28.21 | 44.5 | — | 302,921 | 421,981 | — |
| untreated, chaos1 | 50.83 | 20.61 | 40.2 | 37.0% | 325,049 | 409,448 | 12.5 |
| **`+URBAN_LABOR`** | **55.95** | **15.76** | 41.3 | **34.6%** | **386,984** | **459,406** | **14.1** |

`URBAN_LABOR` reaches the **highest claimed land of any arm in the wave** — it is the
most developed world at this checkpoint — and is the **least urbanised**. Urbanisation
rises with development, so this is a dominance reading: no matching, no interpolation,
no anchor choice to argue about. A more advanced world with less of its population in
cities and more people in it overall.

- **Ceiling.** 15.76% against 20.61% and 28.21% at *lower* development. The
  window's increment is +4.17 against untreated's +5.89 and +12.64.
- **Against history.** The agrarian band this repo works to is 5-15%. The treated
  world lands just at its top edge; the untreated world runs at 1.4-1.9× it.
- **Population.** 459,406su against 421,981 and 409,448 — more people, at greater
  development, with a countryside 19-28% larger.
- **Pin.** Modal share 34.6% against 37.0%, the best reading of the wave. `bind%`
  41.3 sits inside the untreated band (40.2, 44.5).

### 17.1 The median city moved off the stamp

`p50 core = 14.1su`. Every arm, every window, all lap, that number has been **12.0** —
the founding stamp, the owner's twelve thousand. Untreated reaches 12.5 in the same
window; `URBAN_LABOR` reaches 14.1.

If it replicates, this is the first time the *typical* city in this simulation has
been something other than its own birth certificate. That would matter more than the
ceiling result, because the ceiling was this lap's stated target and the pin is the
owner's actual complaint.

### 17.2 Held, deliberately

**This is one draw, and every number in §17 is exactly the kind that has been
retracted twice today** — §13.3's halved tail died on the twin, §14's tightness died
on a shared denominator. The twin (`w4_cl_ulab_chaos`) and `ULAB+FARM` are still on
their final windows.

Nothing here becomes a verdict until the twin lands. Registering what would falsify
each claim, before seeing it:

- **Ceiling:** the twin must also read below both untreated draws. It sat at 10.29
  where this arm sat 11.59, so it should come in near or below 15.76.
- **`p50 core > 12.0`:** the claim most likely to be a single-draw artefact, because
  a median crossing a mode is a threshold event. If the twin reads 12.0, this is
  noise and §17.1 goes.
- **Population and pin:** both have already replicated at 32k-36k, so a reversal
  here would be the surprising outcome.

---

## 18. `ULAB+FARM` completes — `FARM_RES` convicted on the pin, and a §17 claim tempered

| 36k-40k | claimed% | urban% | bind% | pin | p50 core | rural su | total su |
|---|---|---|---|---|---|---|---|
| untreated, clean | 44.42 | 28.21 | 44.5 | — | — | 302,921 | 421,981 |
| untreated, chaos1 | 50.83 | 20.61 | 40.2 | 37.0% | 12.5 | 325,049 | 409,448 |
| `+URBAN_LABOR` | 55.95 | 15.76 | 41.3 | 34.6% | **14.1** | 386,984 | 459,406 |
| `+ULAB+FARM_RES` | 39.16 | **6.28** | **26.1** | **50.1%** | **12.0** | 463,660 | 494,729 |

### 18.1 The prettiest number, bought with the pin

`ULAB+FARM` posts the lowest urbanisation of the wave — 6.28%, squarely inside
history's 5-15% agrarian band, better on that axis than anything else measured.

It is also the worst world by the measure the owner actually raised. **Half the
register — 675 of 1,348 settlements — sits at exactly 12.00 sim units**, and the
median city is *still exactly its birth certificate* where `URBAN_LABOR` alone
reached 14.1.

That gap is not a maturity artefact, and the check matters because the pin **falls**
as a world develops (untreated: 44.6% → 37.4% → 37.0%), so a less-developed arm is
naturally more pinned. Interpolating the untreated draw to `ULAB+FARM`'s own
claimed-land figure:

```
ULAB+FARM   claimed 39.16   pin 50.1%
untreated interpolated to 39.16          37.4%
                                        +12.7 points worse
```

`bind%` says the same and louder: 26.1 against untreated 40.2 and 44.5. Cities are
being pushed back below the founding stamp wholesale.

**Verdict: `FARM_RES` lowers urbanisation by freezing the city register, not by
constraining it.** Two measures, matched on maturity, both decisive, consistent
across every window of two waves. It stays off, independently of the resolution-anchor
question that already blocked it.

### 18.2 Tempering §17: `URBAN_LABOR`'s pin reading is *not* clearly better

§17 called 34.6% "the best reading of the wave." That overstates it, and the same
maturity gradient is why.

`URBAN_LABOR` reaches claimed land 55.95 — **past the end of both untreated draws**,
so its pin cannot be matched against an interpolated reference at all; both would be
extrapolations and are dropped. Untreated pin was falling steadily (37.4 → 37.0) and
would plausibly reach ~36% at that development. Against 34.6%, that is a 1-2 point
edge inside an untreated spread that runs 35.2% to 45.0%.

**The honest statement: `URBAN_LABOR`'s pin is at the low end of the untreated range
and not distinguishable from it.** Which is exactly what the disqualifier asked for —
*do not make the pin worse* — and no more. `bind%` (41.3, inside the untreated band
40.2-44.5) says the same. The claim that survives is "neutral," not "best."

§13.3 already had to walk this back once from "marginally better" to "neutral."
Walking it there a second time from the other direction suggests the disciplined
default on this metric is to read it as neutral unless a matched comparison exists.

### 18.3 What is still open

Only the twin. `w4_cl_ulab_chaos` is the last arm running, and §17.1's median-core
finding — the first time the typical city has been anything but 12.0su — rests on
the single draw it is there to check.

---

## 19. WAVE 4 CLOSES — the median city leaves the stamp, and a sign error is retracted

The twin completed. Final window, all four arms:

| 36k-40k | claimed% | urban% | bind% | pin | **p50 core** | total su |
|---|---|---|---|---|---|---|
| untreated, clean | 44.42 | 28.21 | 44.5 | — | — | 421,981 |
| untreated, chaos1 | 50.83 | 20.61 | 40.2 | 37.0% | **12.5** | 409,448 |
| `+URBAN_LABOR` | 55.95 | 15.76 | 41.3 | 34.6% | **14.1** | 459,406 |
| `+URBAN_LABOR` (chaos) | 42.45 | 15.84 | 46.0 | **30.8%** | **16.7** | 446,692 |
| `+ULAB+FARM_RES` | 39.16 | 6.28 | 26.1 | 50.1% | 12.0 | 494,729 |

### 19.1 §17.1 REPLICATES — and it was the claim I expected to lose

§17.2 registered the median core as *"the claim most likely to be a single-draw
artefact, because a median crossing a mode is a threshold event. If the twin reads
12.0, this is noise and §17.1 goes."*

The twin reads **16.7** — further from the stamp than the first draw's 14.1, against
untreated's 12.5.

**For the first time in this simulation's recorded history, the typical city is not
its own birth certificate.** Both treated draws clear it; neither untreated draw
does; the arm that *added* `FARM_RES` falls straight back to exactly 12.0. That is
the owner's standing complaint — *"the vast majority of cities stuck at 12k"* —
moving, on the mechanism the owner proposed.

It matters more than the ceiling number. The ceiling was this lap's stated target;
the pin is what was actually wrong.

### 19.2 RETRACTED: I had `bind%` the wrong way round

`bind%` is the share of settlements where a city's **own land** books more food than
its founding stamp — where local harvest, not the birth endowment, sets the size.
**Higher is better.** Wave 3 used it correctly: `FARM_RES` at 22.4% against 32.9%
was recorded as a *failure*.

§13.3 then read treated 39.1 against untreated 39.5/39.9 as *"neutral to marginally
better,"* and §15.1 read treated *"below all three untreated draws"* as *"the
direction the disqualifier wanted."* **Both have the sign backwards.** Below is
marginally worse.

Corrected, with the final window included:

```
32k-36k   treated 39.1 39.2   untreated 39.5 39.9 41.3   → marginally WORSE
36k-40k   treated 41.3 46.0   untreated 40.2 44.5        → BETTER
```

The conclusion happens to survive — mixed, trending better, comfortably inside the
disqualifier — but it survives by luck, not by the argument I made for it. A metric
whose direction I had to look up twice in one day is one I should have pinned to its
definition in the instrument itself.

### 19.3 §18.2's temper was too conservative — the pin IS better

§18.2 downgraded the pin claim to "neutral" because `URBAN_LABOR`'s first draw
reached development past both untreated draws and could not be matched.

The twin can be matched — claimed 42.45 sits inside the untreated range:

```
ULABx      claimed 42.45   pin 30.8%
untreated interpolated to 42.45      37.25%
                                     −6.5 points
```

Combined with §19.1's median result, the honest verdict on the pin is **better**, not
neutral: 6.5 points fewer cities frozen at the stamp at matched development, and the
median city off it in both draws. `bind%` is the one pin measure that stays mixed.

This is the third time today this metric has been re-called — "marginally better",
"neutral", now "better". Each move followed new evidence rather than a re-reading of
the same evidence, which is the acceptable version, but the pattern says the
disqualifier should have been defined against a matched-maturity reference from the
start instead of against whatever draws happened to exist.

### 19.4 The ceiling: raw dominance holds, magnitude unresolved

Both treated draws (15.76, 15.84) sit below both untreated draws (20.61, 28.21) on
raw values, and one of them does so at *greater* development than either. Direction
is not in doubt.

The magnitude is. The two untreated draws diverge sharply at the top — one reaches
28.21% at claimed 44.42, the other only 20.61% at claimed 50.83 — so matching the
twin against each gives:

```
vs chaos1   15.84 against 16.90   →  94% of untreated
vs clean    15.84 against 26.15   →  61% of untreated
```

**61-94% at the final window**, against 73-82% at the decisive one. The untreated
world's own path at high development is too variable for two draws to pin the effect
size, and honestly reporting that is better than quoting whichever anchor flatters
the result. What can be said: the effect is real, it does not vanish at the top, and
the world it produces sits at the edge of history's agrarian band where the
untreated world sits well outside it.

### 19.5 Verdict

`URBAN_LABOR` — charging farm output for the labour that moved into the city —
**passes**, on the mechanism the owner proposed:

- **Ceiling:** down, raw bands non-overlapping at both late windows; magnitude 61-94%.
- **Pin:** −6.5 points at matched maturity, and the median city off the stamp in
  both draws (14.1, 16.7 vs untreated 12.5). The lap's actual target.
- **Population:** up in every arm and every window; countryside 19-28% larger.
- **Tail:** no signal (§14.1).

It is not yet a flip. What it has passed is a measurement wave, not the gate ladder —
`npm test`, `validate`, `resgate`, `coverage` and a `tw=960` spot-check are all
still owed, and `validate` is a known no-op for this code path (`tuning.js:114`), so
a green battery would prove nothing here either. And §11's seam means every
urbanisation figure above is still read through a partly broken instrument; the
honest order is to fix the instrument, then re-measure, then decide.

---

## 20. §19.1 RETRACTED — an untreated draw also leaves the stamp

The third untreated arm finished last and refutes the wave's headline.

| 36k-40k | claimed% | urban% | pin | **p50 core** |
|---|---|---|---|---|
| untreated, clean | 44.42 | 28.21 | — | — |
| untreated, chaos1 | 50.83 | 20.61 | 37.0% | 12.5 |
| **untreated, ref3** | **44.88** | **20.60** | 34.8% | **14.6** |
| `+URBAN_LABOR` | 55.95 | 15.76 | 34.6% | 14.1 |
| `+URBAN_LABOR` (chaos) | 42.45 | 15.84 | 30.8% | 16.7 |

§19.1 said: *"Both treated draws clear it; neither untreated draw does… for the first
time in this simulation's recorded history, the typical city is not its own birth
certificate."* **An untreated draw reads 14.6 — clear of the stamp, and higher than
the first treated draw's 14.1.**

```
untreated   12.5   14.6
treated     14.1   16.7
                ^^ overlap ^^
```

Only `ULABx` (16.7) sits above every untreated draw. The bands overlap, n=2 a side,
and the correct statement is: **the median city leaves the founding stamp in a mature
world with or without this mechanism, and `URBAN_LABOR` appears to push it further —
on evidence too thin to quantify.**

That was the finding I called *"more than the ceiling result"* and *"the owner's
standing complaint moving."* It was two draws against two, published before the
third arrived, having explicitly registered one falsifier (the twin reading 12.0)
while not registering the one that actually fired (an untreated draw reading high).
**The falsifier I wrote down was for the treatment. The variance was in the control,
where it has been all day.**

### 20.1 What survives, and it is not nothing

- **Pin, matched on maturity, two anchors, both negative:** −6.5 points against
  chaos1 and −4.1 against ref3. The improvement is real and the range is narrow.
- **Ceiling, raw:** treated 15.76 and 15.84 against untreated 28.21, 20.61 and
  20.60 — below all three, one of them at greater development than any.
- **Population:** up in every arm, every window, with a larger countryside.
- **Median core:** directionally higher, magnitude unresolved (§20 above).

### 20.2 The control is the noisy thing, and that is now measured

Two untreated draws at effectively the same development:

```
clean   urban 28.21  at claimed 44.42
ref3    urban 20.60  at claimed 44.88
                     7.6 points apart
```

Matching the treated twin against each of the three untreated anchors gives 61%,
83% and 94% of untreated. **The spread among controls is comparable to the effect
being measured.** No amount of care with the treated arms fixes that; only more
control draws do.

This is the lap's most reusable lesson and it cost four retractions to learn:
**this world's run-to-run variance at high development is large enough that two
control draws cannot support a quantitative claim, and every retraction today came
from a third draw, not from a mistake in the treated arm.** Three of the four
retractions (§14.1, §15.2, §20) are the same error in different clothes.

The instrument change that follows: `cmp_arms` should refuse to report an effect
size when fewer than three usable control anchors bracket the treated arm, and
should print the control spread beside every ratio it does report. A number that
cannot be qualified should not be printable.

---

## 21. THE OWNER'S QUESTION — the stamp's premise died, but only on one side

> Owner: *"that stamp is meant to let it survive without imports, but now it CAN,
> because it eats its own SURPLUS now, instead of HAVING to import"*

The premise is exactly right and the conclusion does not follow yet, because
`CORE_LOCAL` repaired **one** of the two places the import-only read lives.

### 21.1 What `CORE_LOCAL` fixed, and what it did not

The birth crater (`CORE_HOLD`, `tuning.js:154`) was caused by this: at the mint the
site spike is deleted and the entity's own capacity takes over, but that capacity was
import-driven and ~zero for a newborn feeding itself. Measured: census 457 → 20.

`CORE_LOCAL` added `kLocal` — the city's own harvest — to the **size read**
(`coreEff`, popField.js:2105). A self-fed city is now *reported* at its true size.

**The concentration engine was not touched.** popField.js:1936-1994:

```js
const isr = clamp01((foodNet − landFood) / foodSupply);   // import share
const kb  = (s._k × isr) / scale;                          // IMPORT-fed capacity
if (kb > 0) { sumK += kb; sumKb += pow(kb, betaEff); }     // ← the whole basis
…
if (agglom && kBeyond > 0 && sumKb > 0) {                  // ← the gate
  const share = pow(kBeyond, betaEff) / sumKb;
  uTarget = T.URBAN_AGGLOM × … × sumK × share;
}
let kCap = agglom ? uTarget : kBeyond;
```

A city with no imports has `kBeyond = 0`, so **`uTarget = 0`, `kCap = 0`, and nothing
concentrates its countryside into a core at all.** The only thing holding it up is
the `CORE_HOLD` stamp.

So: **the stamp is still load-bearing today.** Removing it now would re-open the
crater exactly as measured in 2026-08-07. The owner's statement describes what
*should* be true, and names the mechanism that would make it true.

### 21.2 The import-only read has FOUR consumers, and one is fixed

| site | what it decides | state |
|---|---|---|
| `coreEff` (size read) | how big the city is *reported* | **fixed** by `CORE_LOCAL` |
| `uTarget` / `sumK` / `sumKb` | whether the countryside *concentrates* into a core | **import-only** |
| `kCap` (capacity spike) | whether the field *holds* the core | inherits the above |
| `holdF` in the size read | whether a starving core's report *melts* | **missing** (§11) |

§11 found the fourth from one direction; the owner's question finds the second from
the other. **The second is the more fundamental — it is the one the stamp exists to
paper over.**

### 21.3 The fix that would actually retire the stamp

The owner's own logic, applied to the engine: a city should gather its countryside in
proportion to **its whole economy**, not just the imported slice — the same partition
`CORE_LOCAL` already uses on the size read. Then a self-fed city builds a real core
from its own surplus, the handoff has something to hand off *to*, and the stamp
becomes a genuine birth transient that can be retired rather than a permanent floor
that has to be melted.

This is not double-counting. `uTarget` is a **target for concentration**, not added
food: the flow moves a region's own people between its core and its own countryside
and the region's census total is unchanged by construction. Widening the basis says
"a self-fed city may gather its own people too," not "a self-fed city has more food."

**Two honest catches, both of which say measure before building:**

1. **It pushes toward MORE urbanisation, not less.** Widening the basis from imports
   to the whole economy raises `sumK` by roughly the ratio of total economy to import
   economy — a large multiplier where `importShare` is small, which is most cities.
   This lap spent a day establishing the world already over-urbanises (28% against
   history's 5-15%). This change goes the other way and would have to be paired with
   the brake, not shipped alone.
2. **`URBAN_AGGLOM`'s meaning changes.** Its comment defines it as *"the fraction of
   import-fed capacity that concentrates in the core."* Under a whole-economy basis
   it becomes the fraction of *total* capacity, and a constant whose referent changed
   is exactly the resolution-constant mistake in different clothes. It needs
   re-grounding on its new meaning, not carrying over at its old value.

### 21.4 Order of work

1. **The concentration basis** (§21.3) — the cause. Retires the stamp's reason to
   exist and is the owner's insight implemented as a mechanism.
2. **The stamp itself** — once (1) holds, it can be a decaying birth transient or
   simply go. Deciding this before (1) is deciding it blind.
3. **§11's melt** — may become moot: if a self-fed city's core is built from live
   local food, a starving one's core falls on its own without a fed-ness term.

That third point is worth flagging: **the owner's fix may make my §11 fix
unnecessary.** A core sized from current harvest already shrinks when the harvest
fails. The melt was a patch for a floor that should not have been permanent — which
is the second cardinal rule pointing at my own morning's work.

---

## 22. `T.AGGLOM_LOCAL` built — wave 5 pre-registered before the data

Owner: *"do it, it HAS to be this way to be realistic, no alternatives."* Built,
`def: 0`, byte-identical when off (`hashbase` 7fb32527 / ebfb8021 unchanged, smoke
green). Four edits, all in `popField.js`, no new state and no new metric.

### 22.1 The one thing that made this cleaner than expected

I flagged in §21.3 that `URBAN_AGGLOM`'s referent changes and would need
re-grounding. **It does change, and it needs no re-grounding — it becomes
meaningful for the first time.**

`URBAN_GAMMA = 0.5 > 0`, so `betaEff = 1`, and at β=1 the global sums cancel
exactly:

```
share   = pull / sumK
uTarget = URBAN_AGGLOM × (1 + URBAN_IND·indGate) × sumK × share
        = URBAN_AGGLOM × (1 + URBAN_IND·indGate) × pull
```

So `URBAN_AGGLOM = 0.13` means:

- **under the import basis** — "13% of a city's *import-fed* capacity stands in its
  core." That has no independent physical meaning; it is a number that could be
  anything.
- **under the whole-economy basis** — "13% of a region's capacity stands in its
  city." That is an **urbanisation rate**, and 0.13 sits inside history's 5-15%
  agrarian band.

The value is deliberately left alone. A parameter that acquires a real referent and
turns out to already hold a historically sound value is the second cardinal rule's
own test passing, not a coincidence to tune away.

### 22.2 Wave 5, registered before it lands

Four arms, `tw=480` (W=960), seed 8817, 40k, live arm, all on `CORE_LOCAL`, each
lever set verified from `/proc/<pid>/environ` **and** from the arm's own echoed
header:

```
w5_agg              +AGGLOM_LOCAL
w5_agg_chaos        +AGGLOM_LOCAL, MINING_RATE=5.0000001
w5_agg_ulab         +AGGLOM_LOCAL, URBAN_LABOR
w5_agg_ulab_chaos   +AGGLOM_LOCAL, URBAN_LABOR, MINING_RATE=5.0000001
```

Two draws per treatment, against **three** control draws already banked to 40k
(`mil_corelocal`, `w3_cl_chaos`, `w4_cl_ref3`) — the count §20 said was the minimum.

**The prediction: a DISTRIBUTION, not a uniform rise.** The mechanism gives pinned
self-fed cities a target for the first time (floor up) while pulling the runaway
tail toward 13% of its own region's capacity (ceiling down). Specifically:

| measure | untreated | predicted |
|---|---|---|
| exactly-12.00su share, final window | 37.0 / 34.8% | **materially below** |
| urban share, final window | 20.61 / 20.60 / 28.21% | **at or under ~16%** |
| median core, final window | 12.5 / 14.6su | **above both** |
| total population | 409k / 418k / 422k | **not lower** (disqualifier) |

**The falsifier, stated plainly: if urbanisation rises uniformly — floor up AND
ceiling up — the distribution argument is wrong and this is just a bigger knob.**
That is the outcome that would make the mechanism wrong rather than merely
mis-tuned, and it is the one I will be looking for first.

Two disciplines carried from wave 4, both bought with retractions:

- **No effect size quoted without three control anchors bracketing the treated
  arm** (§20). If the treated arms outrun every control's claimed land, the honest
  output is "unmatchable", not a ratio against the one control that reaches.
- **No claim from a single draw**, including — especially — an unasked-for bonus
  finding. §13.3 and §17.1 both died that way.

---

## 23. THE OWNER ON `URBAN_AGGLOM` — §22.1 conceded, and the test that settles it

> Owner: *"and then what is that 13 percent number? that feels like a cardinal rule
> violation"*

### 23.1 §22.1 is conceded

§22.1 argued that widening the basis makes `URBAN_AGGLOM = 0.13` *meaningful* — that
it stops being "13% of import-fed capacity" (no independent referent) and becomes
"13% of a region's capacity stands in its city", an urbanisation rate sitting inside
history's 5-15% agrarian band. I called that "the second cardinal rule's own test
passing."

**That argument is weaker than it was written.** Urbanisation is an OUTPUT of
history — the joint result of agricultural surplus, transport cost, crowd disease,
and the labour cost of taking a farmer off the land. Setting a dial to 0.13 and
observing 13% urbanisation is dialling in the answer. The rule's own words:

> *"A constant with no independent physical meaning… If `RIVER_UNIFY_FLOOR = 0.85`
> exists only because it makes Egypt come out ~1M km², it is a fitted answer, not a
> mechanism."*

Giving a fitted constant a more physical-sounding *interpretation* does not convert
it into a mechanism. §22.1 confused a nicer name for a better cause, which is the
exact failure the rule describes. The owner applied the rule correctly against a
claim I had published with confidence.

**What is defensible, and stays:** the `TIER_CORE` bars (2,000 / 10,000 / 40,000)
are *definitions of words*, grounded on what the literature calls a town, a city and
a metropolis. A constant that only LABELS an outcome is not a fitted answer. The
distinction that matters is whether the constant **drives**: `TIER_CORE` reads a
core and names it; `URBAN_AGGLOM` sets what the core becomes. Only the second is the
violation.

### 23.2 `URBAN_LABOR` may make the dial deletable

The reason `URBAN_AGGLOM` has to exist is that the model had no force setting the
urbanisation *level* — only a distribution across cities. `T.URBAN_LABOR`, built
today at the owner's direction, supplies exactly that missing force: move a farmer
into the city and farm output falls, so capacity falls, so the flow reverses. That
is a genuine negative feedback on urban size, and it is the physics that should set
the level.

**The test, cheap and decisive:** run with `URBAN_AGGLOM` set to something
implausible — 0.5, then 1.0 — with `URBAN_LABOR` and `AGGLOM_LOCAL` on.

- If the world still settles near a sane urbanisation rate, **the dial is not
  load-bearing and can be deleted.** The equilibrium is set by the physics and
  `URBAN_AGGLOM` is only the speed at which it is approached.
- If urbanisation tracks the dial, **it IS the answer being painted on**, the owner
  is right without qualification, and it has to be replaced by a mechanism rather
  than re-tuned.

Either outcome is worth having and neither depends on wave 5's result. Queued behind
wave 5 (the machine is full); it is a better question than anything else pending.

### 23.3 The stamp, per the owner's design

> Owner: *"maybe when the city is born, pull an immediate amount of people from
> around into it, somewhere less than 3k, and have them sustain from there? no
> minimum? and if they get less than a certain sustaining population, or something
> emergent like there is not enough people for it to function basically, it falls
> apart?"*

Birth small, grow or die on the world's terms, no floor. That is how cities happened
and it is the cardinal-rule-clean form.

The precise change: **the stamp must stop DRIVING.** Today `_coreHoldCapF` floors
the core at 12,000 regardless of what the world says, and §21 established why it is
still load-bearing — the concentration engine gave a self-fed city no target at all.
`T.AGGLOM_LOCAL` removes that reason. Once a self-fed city builds a real core from
its own surplus, the stamp has nothing left to do and the birth seed can be whatever
the site actually gathers.

The dissolve half already exists (`DISSOLVE_CORE` tests the core against the city
bar). What is missing is not the death rule — it is letting the core FALL in the
first place, which the stamp prevents. So the order is forced: `AGGLOM_LOCAL` must
land before the stamp can go, and this is the second reason (after §16.3's
dissolution risk) not to pull it early.

Note also that a city born at ~3,000 IS a town for a while, which reverses the
owner's 2026-08-22 directive (*"towns should not exist, anything smaller than a city
should not be anything"*). That is the owner's call to reverse and is flagged here
only so the reversal is deliberate rather than incidental.

---

## 24. WAVE 5, WINDOW 9 — three predictions separate cleanly; the population disqualifier FIRES

Maturity overlaps (controls claimed 32.3-37.5, treated 31.5-39.1), so the raw
comparison is near-fair without interpolation. Four treated draws against three
controls:

| arm | claimed% | urban% | bind% | med core | total su | ended |
|---|---|---|---|---|---|---|
| ctrl clean | 32.34 | 15.57 | 39.9 | — | 412,324 | 266 |
| ctrl chaos1 | 37.51 | 14.72 | 39.5 | 12.0 | 430,981 | 286 |
| ctrl ref3 | 34.35 | 14.46 | 41.3 | 12.0 | 418,181 | 239 |
| `+AGGLOM_LOCAL` | 36.25 | 11.55 | 44.2 | **16.1** | 337,703 | 301 |
| `+AGGLOM_LOCAL` chaos | 31.53 | 11.84 | 44.7 | **14.1** | 328,436 | 312 |
| `+AGG+URBAN_LABOR` | 34.05 | 9.91 | 48.0 | **15.8** | 317,959 | 331 |
| `+AGG+ULAB` chaos | 39.08 | 9.20 | 44.2 | **14.2** | 353,404 | 411 |

### 24.1 Three predicted measures separate with no overlap

```
urban%     controls [14.5, 15.6]   treated [ 9.2, 11.8]   treated LOWER
bind%      controls [39.5, 41.3]   treated [44.2, 48.0]   treated HIGHER
med core   controls [12.0, 12.0]   treated [14.1, 16.1]   treated HIGHER
```

Every treated draw beats every control draw on all three, 4 against 3, no
interpolation needed. **This is the strongest separation any mechanism has produced
this lap**, and it is the exact shape §22.2 registered before the data: the floor
rises (median city off the stamp, more cities sized by their own land) while the
ceiling falls.

The median core result is the one wave 4 could not establish and retracted (§20).
Here both control draws read **exactly 12.0** and all four treated draws clear it.
That is the owner's complaint moving, on the owner's own mechanism.

### 24.2 THE DISQUALIFIER FIRED — population is 14-26% lower

§22.2 registered: *"total population — **not lower** (disqualifier)."*

```
controls   412,324 - 430,981
treated    317,959 - 353,404      →  −14% to −26%
```

Non-overlapping in the wrong direction, at matched maturity. Settlements ending
in-window also rise: 301-411 treated against 239-286 control.

**The mechanism is coherent and that is exactly why this needs care.** Concentrating
people into cores puts them under the urban graveyard — excess crowd mortality that
scales with urban share. More concentration, more deaths. Historically cities *were*
population sinks that grew only by in-migration, so a more-urban world holding fewer
people is not obviously wrong physics. But a 14-26% loss of world population is not
a detail, and the disqualifier was written precisely so that a good-looking result on
three axes could not carry a bad one on the fourth by omission.

Two readings, and this window cannot distinguish them:

1. **Correct physics.** The graveyard is real, cities really did kill people, and
   the untreated world's larger population was an artefact of cities being frozen at
   12k and never concentrating anyone into the mortality.
2. **The graveyard is mis-scaled.** It saturates at 30% urban share and decays with
   health tech — parameters set when almost nothing concentrated. Feeding it real
   concentration for the first time may be exposing a term that was never tested in
   the regime it now runs in.

Reading 2 is the more likely and is checkable: the graveyard's `min(1, urbShare/0.3)`
cap was named in `CORE_LOCAL`'s own description as "the honest boundary of the safety
argument", and nothing before today pushed a median city off the founding stamp.

**No verdict.** One window remains, and the population gap is the thing to watch in
it — if it widens, the mechanism needs the graveyard re-examined before it can ship;
if it closes as the world matures, reading 1 gains ground.

---

## 25. WAVE 5 VERDICT — the disqualifier holds, two of three separations do not

All four arms completed. Final window, against three controls, maturity overlapping
(controls claimed 44.4-50.8, treated 39.9-50.1):

| arm | claimed% | urban% | bind% | medCore | total su | urban su | ended |
|---|---|---|---|---|---|---|---|
| ctrl clean | 44.42 | 28.21 | 44.5 | — | 421,981 | 119,060 | 371 |
| ctrl chaos1 | 50.83 | 20.61 | 40.2 | 12.5 | 409,448 | 84,399 | 387 |
| ctrl ref3 | 44.88 | 20.60 | 42.5 | 14.6 | 406,018 | 83,628 | 345 |
| `+AGGLOM_LOCAL` | 39.86 | 15.28 | 45.0 | 18.1 | 322,544 | 49,299 | 410 |
| `+AGG` chaos | 40.24 | 15.38 | 45.6 | 18.1 | 317,968 | 48,916 | 361 |
| `+AGG+ULAB` | 44.37 | 13.49 | 42.4 | 14.3 | 321,131 | 43,305 | 426 |
| `+AGG+ULAB` chaos | 50.05 | 11.53 | 42.7 | 14.7 | 345,294 | 39,830 | 420 |

```
urban%     ctrl [20.6, 28.2]   trt [11.5, 15.4]   SEPARATED, treated lower  (as predicted)
bind%      ctrl [40.2, 44.5]   trt [42.4, 45.6]   overlap
medCore    ctrl [12.5, 14.6]   trt [14.3, 18.1]   overlap
total pop  ctrl [406k, 422k]   trt [318k, 345k]   SEPARATED, treated LOWER  ← disqualifier
urban abs  ctrl [ 84k, 119k]   trt [ 40k,  49k]   SEPARATED, treated LOWER
```

### 25.1 §24.1 does not survive one more window

§24 called window 9 *"the strongest separation any mechanism has produced this
lap"* on three measures. **Two of the three are gone one window later.** `bind%` and
the median core both overlap the control band at 40k. Only the urban-share
separation survived, and the population disqualifier not only held but is now a
clean separation in the wrong direction.

That is the fifth time this lap a separation reported at window N failed at window
N+1, and the second time I published the enthusiasm before the run finished when
the run had one window left. The rule this keeps writing itself into: **on a running
arm, report the reading and withhold the adjective.**

### 25.2 The fact that reframes the mechanism

**Absolute urban population is 47% of control.** Not the share — the count.

```
urban absolute   treated 47% of control
rural absolute   treated 89% of control
total            treated 79% of control
```

The treated world does not concentrate more people into cities. It has **fewer than
half as many urbanites**, a slightly smaller countryside, and ~21% fewer people
overall, with more settlements dying in-window (361-426 against 345-387).

That kills the reading offered in §24.2 — *"concentrating people into cores puts
them under the urban graveyard"* — because there is no extra concentration to pay
for. Something is destroying urban population rather than accumulating it, and the
median core rising while the urban total halves means the surviving cores are
bigger and far fewer.

**No mechanism is offered for that here.** Three candidate stories are available and
this data distinguishes none of them; writing one down would be the exact error §10
and §14 were retracted for.

### 25.3 Where `AGGLOM_LOCAL` actually stands

The mechanism is right in principle — §21's finding stands untouched: the
concentration engine really does read imports only, a self-fed city really does get
no target, and that really is why the founding stamp is still load-bearing. **What
does not follow is that this implementation of the fix is shippable.** It is
measured, it is behind a `def: 0` lever, it is byte-identical when off, and its
first full measurement says it costs a fifth of the world's people and half its
urbanites.

Next step is diagnosis, not iteration: find where the urban population goes. The
`ended` counts and the halved urban total point at the register churning — cities
being minted and dissolved rather than growing — which would also explain a rising
median core (survivorship) with a falling urban total. That is checkable directly
against the founding/ending flows the probe already prints, and it should be checked
before any further lever is written.

---

## 26. REMOVING THE 12k STAMP REVEALED AN 8k FLOOR UNDERNEATH — `K_MIN_VIABLE`

Owner: *"did you remove the 12k limit as well?"* — no, wave 5 tested the new
concentration engine **with the old floor still in place**, a hybrid neither of us
proposed. `T.STAMP_RETIRE` was built to close that, and its first window says
something more interesting than expected.

### 26.1 The pin did not go. It moved.

```
w6_stamp        CORES p10=1.5 p50=8.0 p90=134.2 max=682.9su | MODE 8.00su held by 31/85 (36.5%)
w6_stamp_chaos  CORES p10=1.5 p50=8.0 p90=143.7 max=629.6su | MODE 8.00su held by 36/99 (36.4%)
```

The 12.00su mode is gone — the stamp really is retired, and `p10 = 1.5` shows real
cores below it for the first time. **In its place is a mode at exactly 8.00su
holding 36.5% of the register, replicated to a tenth of a point in the twin.**

### 26.2 The second floor, named

`settlement.js:119`:

```js
const K_MIN_VIABLE = 8;   // bare-survival floor (matches the wither cull threshold)
```

`settlement.js:3647`: `K = Math.max(K_MIN_VIABLE, foodK)`.

The chain is direct. Under `STAMP_RETIRE` the size read is
`coreEff = min(_coreF, kLocal + kBeyond)`, and `kLocal + kBeyond ≡ s._k / scale`
identically (§10.1). So `_urbanPop = min(s.people, _coreF × scale, s._k)`. For any
settlement whose food capacity falls under the floor, `s._k = K_MIN_VIABLE = 8`, and
the reported core is **exactly 8.00su**.

`_k` is in census units — the same units as `s.people` — so **`K_MIN_VIABLE = 8`
means 8,000 people**. A constant labelled *"bare-survival floor"* is asserting that
no settlement's carrying capacity may fall below eight thousand people.

### 26.3 Why this matters more than the 12k stamp did

It is the same defect one layer down, and worse on its own terms:

- **The stamp at least had a reason** — the birth-crater handoff, measured, with a
  mechanism behind it. `K_MIN_VIABLE` is a bare number with a comment.
- **8,000 people is not bare survival.** Bare survival is a hamlet — tens or
  hundreds. Eight thousand is a substantial town. The constant is off by two to
  three orders of magnitude against the thing its own comment says it represents.
- **It defeats the owner's design directly.** *"No minimum… if there is not enough
  people for it to function, it falls apart"* cannot happen while every settlement's
  capacity is floored at 8,000, because `DISSOLVE_CORE`'s bar is 10,000 and a
  settlement pinned at 8,000 is permanently just below it — neither growing nor,
  apparently, dying.

This also reframes §25's unexplained result. The wave-5 world lost a fifth of its
people and half its urbanites with no story available. A capacity floor at 8,000 per
settlement interacts with a register that churns, and the churn was visible there
(`ended` 361-426 against 345-387). **No claim is made that this explains wave 5** —
that is precisely the kind of story this document has retracted four times — but it
is now the first thing to check.

### 26.4 What this does not yet say

One window, a young world (claimed 1.3-1.7%), and the arms run to 40k. Whether the
8k mode persists, whether the register churns itself apart without the stamp, and
whether the entity count survives are all open. The pin moving from 12.00 to 8.00 is
solid — two draws, a mode to a tenth of a point, and a constant that matches
exactly. Everything downstream of it is not yet measured.

### 26.5 The floor's twin: the wither cull, and what the comment gives away

`K_MIN_VIABLE`'s comment says it *"matches the wither cull threshold"*.
`settlement.js:3778`:

```js
// Withering: a settlement stuck below 8 people for too long (a stillborn
// site whose territory can't feed it, or a post-famine zombie) dies.
// Stable small forage hamlets sit at ~10–15 and never trip the timer.
if (s.people < 8) { … dies after 2000/_dt … }
```

`s.people` is in **census units**; `POP_SCALE = 1000`. So the pair reads:

| written as | actually means |
|---|---|
| capacity floored at 8 | no settlement's capacity may fall below **8,000 people** |
| dies below 8 people | anything under **8,000 people** is culled |
| *"small forage hamlets sit at ~10-15"* | forage hamlets of **10,000-15,000 people** |

**That last line is the tell.** A forage hamlet is ten to fifteen *people*. The
comment describes a headcount world, not a world where `s.people` is thousands. The
constants are self-consistent with each other (both 8, deliberately matched) and
inconsistent with the unit system they now run in.

**Honest limit on this claim:** the repository's history is squashed to a single
commit, so `git log -S` cannot date these constants against `POP_SCALE` and I
**cannot prove** they predate the rescale. The evidence is internal — a comment that
only parses in a headcount world — not historical. CLAUDE.md names this exact failure
as *"the single most repeated mistake in [this codebase's] history"*, which raises
the prior but is not itself evidence.

### 26.6 This is a second, independent barrier to the town register

The owner asked (2026-08-27) whether allowing sub-12k settlements would *"simulate
large towns instead of cities that don't work"*. §on the stamp answered that
`DISSOLVE_TOWNS` blocks it. That answer was incomplete.

**Anything below 8,000 people is actively culled by the wither timer**, whatever the
tier rules say. So the historically ordinary town — the 2,000-person borough, the
Greek polis of a few thousand, the several thousand *Städte* of the Empire — cannot
exist in this world for two independent reasons, and removing the tier bar alone
would not create one.

A town register therefore needs the wither threshold re-grounded on what it claims
to mean (a site too small to sustain itself — hundreds of people, not thousands),
not just the tier definitions changed. That is a separate lever from
`T.STAMP_RETIRE` and is **not** being built while wave 6 runs.

---

## 27. WAVE 5 DIAGNOSIS — the churn hypothesis is refuted; a cap hypothesis replaces it (unproven)

§25.3 said the next step was to check the founding/ending flows before writing
another lever. Done, over the full 40k run:

| arm | founded | ended | net | urban su by window |
|---|---|---|---|---|
| ctrl clean | 234 | 883 | −649 | 5418 → 18058 → 31104 → 64186 → **119060** |
| ctrl chaos1 | 303 | 950 | −647 | 5351 → 16452 → 29765 → 63454 → **84399** |
| ctrl ref3 | 273 | 874 | −601 | 5830 → 17419 → 40585 → 60480 → **83628** |
| AGG | 287 | 977 | −690 | 5723 → 15436 → 26607 → 39004 → **49299** |
| AGG chaos | 268 | 995 | −727 | 5511 → 17628 → 25706 → 38875 → **48916** |
| AGG+ULAB | 273 | 1068 | −795 | 4931 → 12103 → 22493 → 31515 → **43305** |
| AGG+ULAB chaos | 261 | 1148 | −887 | 4619 → 13248 → 20115 → 32508 → **39830** |

### 27.1 REFUTED: the register is not churning itself apart

§25.3 offered churn — cities minted and dissolved rather than growing — as the
leading candidate, since it would explain a halved urban total alongside a rising
median. **It does not survive arithmetic.** Foundings are flat across every arm
(261-303 against controls 234-303). Endings are higher, but only by **10-25%**
(977-1148 against 874-950). A quarter more deaths cannot produce a **56% smaller**
urban population. The churn is real and much too small.

### 27.2 The trajectories, which say something different

The shape is the finding, not the endpoint:

```
controls   last window   64186 → 119060   (+85%)   ACCELERATING
treated    last window   39004 →  49299   (+26%)   DECELERATING
```

Through window 8 the arms are within ~20% of each other. They separate in the last
two windows, and they separate because the **controls take off** while the treated
arms flatten. Whatever is happening is a *late* phenomenon in a mature world, and it
is the control that does the unusual thing.

### 27.3 HYPOTHESIS, explicitly not a finding

`T.AGGLOM_LOCAL` does two things, and §21 only argued for the first:

1. it widens the pull from imports to the whole economy — the intended fix; and
2. **it thereby binds `uTarget = URBAN_AGGLOM × pull` to 13% of a city's own
   region**, where under the import basis a hub whose imports dwarfed its own land
   had a target with no effective ceiling.

If (2) is what is biting, everything observed follows: the runaway tail is capped, so
absolute urban population falls; the urban spike is **additive capacity**
(`applyUrbanSpikes`: `cap[ti] += e.k`, §16.1), so smaller spikes mean less total
capacity and a smaller world population; and self-fed cities still gain their first
target, so the median core rises. Supporting: control max cores read 1055-1234su
against treated 432-681su — the treated tails are two to three times smaller.

**This is a story that fits, which is exactly the kind of thing this document has
retracted four times.** It is written here as a hypothesis with a name, not a result.

**The test it implies:** if the cap is the mechanism, then raising `URBAN_AGGLOM`
under `AGGLOM_LOCAL` should restore both the tail and the world population — and
that is the *same arm* §23.2 already queued to decide whether `URBAN_AGGLOM` is a
fitted constant. One experiment answers both questions:

- population and tail recover as the dial rises → the cap is the mechanism, **and**
  the dial is load-bearing, so the owner's cardinal-rule objection stands and
  `URBAN_AGGLOM` must be replaced by a mechanism rather than re-tuned;
- population stays flat as the dial rises → the cap is not the mechanism, and the
  dial is not the answer being painted on.

Either way it is the next arm after wave 6, and it now earns its slot twice over.

---

## 28. WAVE 6 VERDICT — `STAMP_RETIRE` separates on every measure, and three of them need re-reading

All four arms to 40k. Final window, four treated draws against three controls:

| arm | claimed% | urban% | bind% | medCore | mode | total | ended | realms |
|---|---|---|---|---|---|---|---|---|
| ctrl clean | 44.42 | 28.21 | 44.5 | — | — | 421,981 | 371 | 818 |
| ctrl chaos1 | 50.83 | 20.61 | 40.2 | 12.5 | 12.0 @ 37% | 409,448 | 387 | 866 |
| ctrl ref3 | 44.88 | 20.60 | 42.5 | 14.6 | 12.0 @ 35% | 406,018 | 345 | 857 |
| STAMP | 38.38 | 13.35 | 49.7 | 15.6 | 8.0 @ 29% | 310,342 | 573 | 599 |
| STAMP ch | 34.34 | 12.87 | 49.6 | 15.7 | 8.0 @ 28% | 322,414 | 488 | 606 |
| STAMP+ULAB | 40.35 | 11.75 | 49.1 | 17.4 | 8.0 @ 27% | 308,543 | 513 | 650 |
| STAMP+ULAB ch | 49.52 | 11.91 | 48.3 | 16.9 | 8.0 @ 28% | 298,511 | 490 | 635 |

**Every one of six measures separates cleanly**, no overlap, no interpolation:

```
urban%     ctrl [20.6, 28.2]      trt [11.8, 13.3]      treated LOWER
bind%      ctrl [40.2, 44.5]      trt [48.3, 49.7]      treated HIGHER
medCore    ctrl [12.5, 14.6]      trt [15.6, 17.4]      treated HIGHER
total pop  ctrl [406k, 422k]      trt [299k, 322k]      treated LOWER
ended      ctrl [345,  387]       trt [488,  573]       treated HIGHER
realms     ctrl [818,  866]       trt [599,  650]       treated LOWER
```

### 28.1 The pin is broken, and the mode moved down a floor

The 12.00su mode is gone from every treated arm. In its place, 8.00su at 27-29% —
`K_MIN_VIABLE`, §26 — down from 12.00su at 35-37%. So the stamp's removal both
**shrank** the pinned share (36% → 28%) and **exposed the next floor down**.
`bind%` at 48.3-49.7 is the highest reading of the entire lap, and the median core
clears both controls in all four draws — the result wave 4 had to retract for
insufficient evidence now holds with a 1.0-point gap and four draws.

### 28.2 Three "costs" that were never measured against a standard

§25 and §28's table call three measures costs. **The owner challenged that and was
right.** Checked directly: `tools/stylized.mjs` contains **no absolute
world-population bar**. Its only population standards are
`"population ~ development (monotone)"` and `"civilization alive"`
(≥20 settlements, pop > 500). The disqualifier §22.2 registered was invented for
this lap, not taken from the repo, and then reported as a failed test.

What the trajectories actually say:

```
population, millions of real people on catchment land, by window
controls   105 → 235 → 354 → 412 → 422      (chaos1 431→409 and ref3 418→406: two of three TURN DOWN)
treated     84 → 197 → 273 → 306 → 310      (still climbing at the end)
```

The treated world is **still growing** where two of three controls have peaked and
declined. ~310M on settled land is a ~1000 CE world; the controls' ~420M is a ~1400s
world. Both plausible, and the repo's actual standard — population rising with
development — is met by both.

On the one axis that *can* be checked against history, the treated world is the more
accurate one: urbanisation 11.8-13.3% against history's 5-15% agrarian band, where
the controls run 20.6-28.2%, well outside it.

The same applies to the other two. **Settlement deaths**: no standard exists, most
historical settlements failed, and the register keeps *growing* (19 → 243 → 485 →
578 → 599), so this is higher turnover, not collapse. **Realm count**: 599-650
against 818-866, with no benchmark for either — and 866 simultaneous polities is the
harder number to defend, not the smaller one.

**Corrected position: of the six separations, three are results in the intended
direction and three are differences with no standard attached.** Calling the latter
"costs" was a framing error, repeated across two waves.

### 28.3 Wave 7, launched

Four arms, verified from their own echoed headers:

```
w7_viable         AGGLOM_LOCAL + STAMP_RETIRE + VIABLE_UNITS
w7_viable_chaos   … + MINING_RATE=5.0000001
w7_agglom026      AGGLOM_LOCAL + URBAN_LABOR, URBAN_AGGLOM = 0.26   (2×)
w7_agglom052      AGGLOM_LOCAL + URBAN_LABOR, URBAN_AGGLOM = 0.52   (4×)
```

The first pair tests whether removing the 8k floor dissolves the 8.00su mode and
lets real small settlements exist. The second pair is the dose-response §23.2 and
§27.3 both queued, against `w5_agg_ulab` (URBAN_AGGLOM = 0.13) as the low dose — one
sweep answering two questions: whether the 13% dial is a fitted constant (the owner's
cardinal-rule objection), and whether the cap on runaway cities is what moves world
population.

---

## 29. WHY THE CITIES ARE SMALL — early world, plus a mint/dissolve bar with no gap

> Owner: *"why are most of the cities so small, less than historical city size? Is
> that just an early game thing? Or do we now need to calibrate WHEN a city is
> made?"*

Both, and they separate cleanly.

### 29.1 Most of it is the young world

Median urban core, sim units (×1000 = people), by window:

| arm | 20k | 24k | 28k | 32k | 36k |
|---|---|---|---|---|---|
| control | 12.0 | 12.0 | 12.0 | 12.0 | 12.5 |
| `STAMP_RETIRE` | 8.0 | 8.0 | 8.0 | **17.2** | **15.6** |
| `STAMP_RETIRE+ULAB` | 8.0 | 8.0 | 8.0 | **13.6** | **17.4** |

With the stamp gone the median sits on the floor for three windows and then takes
off, ending at **13,600-17,400 people** — above the 10,000 city threshold and a real
distribution rather than a pin. The control never moves off 12.0 at all, which is
the pin restated.

The wave-7 readings that prompted the question (median 2,300-6,200) are from a world
at **1.5% of land claimed**. It has not grown up yet.

### 29.2 But the mode never clears the bar, at any maturity

```
STAMP_RETIRE   mode 8.00su held by  36% / 33% / 41% / 29% / 29%
```

Between 27% and 41% of the register sits at exactly the floor in every window,
mature ones included. That is not an early-world effect and it is the residue the
stamp's removal did not touch.

### 29.3 The cause: the mint bar and the dissolve bar are the same number

- **Mint** (`crystallize.js:1571`): `if (coreF < coreBarF) continue` —
  `coreBarF = TIER_CORE[2] / bridge`, a gathered core of **10,000**.
- **Dissolve** (`crystallize.js:1293`): `coreBar = TIER_CORE[2] * T.DISSOLVE_CORE`
  — at the shipped `DISSOLVE_CORE = 1.0`, a core under **10,000**.

**Identical, by explicit design.** `DISSOLVE_CORE`'s own description says so: *"the
bar is the CITY BAR ITSELF, not a fraction of it… Values below 1 reopen a hysteresis
gap if a future measurement ever wants one."*

With the founding stamp present, that gap did not matter — the stamp held every core
at 12,000, safely above both bars, which is exactly what made it a pin. **Remove the
stamp and the missing hysteresis becomes the dominant behaviour:** mint at 10,000 →
decay to the floor → sit under the bar → dissolve after `DISSOLVE_SUSTAIN` → another
mints elsewhere. A steady-state churn parked at the line.

That accounts for the doubled `ended` counts across waves 5 and 6, and for why the
pinned share never falls below about a quarter whichever floor is removed.

### 29.4 The deeper flaw: the mint tests gathering, not sustainability

`coreF >= coreBarF` is a **momentary** reading — did a core gather this tick. It does
not ask whether the basin can *keep* one. `cityBasinOkAt` was meant to cover that and
measurably does not: every entity in the churn passed both tests at birth and then
decayed to the floor.

Two directions, and this is an owner decision rather than a bug fix:

1. **Separate the bars** — `DISSOLVE_CORE < 1` reopens the hysteresis the code
   already anticipated. Cheapest, uses an existing lever, no new constant. But it
   only lets a city *dip* without dying; it does not stop the world founding cities
   where cities cannot live.
2. **Make the mint test sustainability** — the cause-level fix, and the one the
   second cardinal rule prefers. A core that gathered once is not evidence a city can
   persist; the mint should read something that predicts persistence (the basin's
   sustained surplus rather than an instantaneous core).

**Not built.** Wave 7 changes the floor these entities decay onto, so it may change
the size of the problem before either fix is worth designing.

---

## 30. THE OWNER'S HYSTERESIS — mint 10,000, dissolve 2,000 — and a self-inflicted lost wave

> Owner: *"What about mint 10,000 dissolve 2000? I do want settlements to be ONLY
> considered 'cities', dissolving at 2000 just gives places that used to be cities
> some breathing room"*

### 30.1 This is the better design, and it needs no code

§29 offered two directions and I built the wrong one. `T.TOWN_MINT` lowers the MINT
bar, which reverses the 2026-08-22 directive and turns the register into a settlement
register. The owner wants the opposite: **the register stays a CITY register — only
10,000-person cores mint — and the dissolve bar drops so a declining city has room to
fall before the institution dies.**

That is a strictly better answer to §29's problem, because §29's problem was never
that the mint was too high. It was that **the two bars are the same number**, so a
city has no room at all. Lowering the dissolve bar fixes exactly that and changes
nothing about what qualifies as a city.

It also needs **no new code and no new lever**: `DISSOLVE_CORE` is already a
multiplier on `TIER_CORE[2]`, so `DISSOLVE_CORE = 0.2` puts the dissolve bar at
**2.0 su = 2,000 people = `TIER_CORE[1]`**, this codebase's own town definition. The
lever's description reserved sub-1 values for precisely this: *"Values below 1 reopen
a hysteresis gap if a future measurement ever wants one."*

And it is historically the right shape. `DISSOLVE_CORE`'s own text names the case:
post-Roman Britain, where *"the countryside stayed peopled while the towns emptied
and stopped being towns"*. A city does not stop being a city the moment it dips below
the statistical threshold — it stops when it has fallen to a town and stayed there.

**`T.TOWN_MINT` is therefore built but NOT the plan.** It stays at `def: 0`,
byte-identical, and its description carries the research on where 10,000 comes from,
which is worth keeping. It should be deleted if the town register is never wanted.

### 30.2 The interaction that decides whether it works

A 2,000 dissolve bar can only bite if cores can actually reach 2,000. `K_MIN_VIABLE`
(§26) floors capacity at 8,000, and waves 5-6 measured 27-41% of the register sitting
at exactly that floor. **Against an 8,000 floor, a 2,000 dissolve bar is inert for
that whole population** — it would stop the churn by making the parked entities
permanently safe, rather than by letting them recover or die.

So the design is tested with and without `T.VIABLE_UNITS`, and that pairing is the
wave's real question.

### 30.3 I lost wave 7 — and my explanation was wrong (see §31)

All four wave-7 arms died between windows 7 and 8 with no error written — logs cut
mid-line, no `FATAL`, nothing in `dmesg`, and 15GB free once they were gone. I ran
`npm test` twice while four `tw=960` arms were live on a 16GB machine. The arms were
almost certainly OOM-killed, and it was avoidable.

**Standing rule, added to §6's method notes: do not run the gate suite while
`tw=960` arms are on the machine.** The earlier session already lost a wave to
`pkill` matching its own monitor; this is the same class of error — a tool I ran
destroying the measurement I was waiting for.

Lost: the `VIABLE_UNITS` pair and both `URBAN_AGGLOM` sweep doses. What survived is
two windows of each, which is not enough for anything.

### 30.4 Wave 8, launched

```
w8_hyst           full stack + VIABLE_UNITS + DISSOLVE_CORE=0.2    ← the owner's design
w8_hyst_chaos     … + MINING_RATE=5.0000001                        ← its twin
w8_hyst_nofloor   full stack + DISSOLVE_CORE=0.2, no VIABLE_UNITS  ← §30.2's interaction
                  MISNAMED: "nofloor" means no floor-FIX, i.e. this arm KEEPS the
                  8,000 floor. It is the control, not the treatment. Read it as
                  "w8_hyst_8kfloor".
w8_agglom052      full stack + URBAN_AGGLOM=0.52, DISSOLVE_CORE=1  ← the dial sweep's high dose
```

All carry `CORE_LOCAL`, `AGGLOM_LOCAL`, `URBAN_LABOR`, `STAMP_RETIRE`; lever sets
verified from each arm's own echoed header.

**Pre-registered:** the churn should fall — `ended` back toward the control's
345-387 from waves 5-6's 488-573 — while the median core and `bind` hold their
wave-6 gains. The disqualifier is the opposite: if `ended` falls because the parked
population became permanently safe rather than because cities recovered, the mode at
the floor will persist and the median will not move. **Mode share and `ended` must be
read together; either alone can be satisfied the wrong way.**

---

## 31. §30.3 RETRACTED — the arms are killed by container restarts, not by my smoke runs

Wave 8 died in the same place as wave 7: all four arms stopped after the 24k-28k
window with no error text, no `FATAL`, nothing in `dmesg`. **I ran no test suite
during wave 8.**

```
$ uptime
 03:16:23 up 0 min
$ cat /proc/uptime
 47.06
```

**The container had restarted 47 seconds earlier.** Arm logs last written 03:01-03:05;
restart at ~03:15. `setsid nohup` survives a shell exiting; it does not survive the
machine going away.

### 31.1 The retraction

§30.3 stated the wave-7 arms were *"almost certainly OOM-killed"* by my running
`npm test` twice, called it *"avoidable"*, and added a standing rule about it. **That
was a guess presented as a diagnosis.** The evidence at the time was already against
it — `dmesg` showed no OOM kill and 15GB was free — and I reached for the
explanation where I was at fault instead of the one the data supported. Wave 8 then
died identically with no smoke run anywhere near it.

The standing rule from §30.3 is withdrawn. Running the gate suite alongside `tw=960`
arms may still be unwise on a 16GB box, but it is not what killed wave 7, and a rule
justified by a wrong diagnosis is worse than no rule.

**The real constraint: background arms do not survive a container restart, and this
environment restarts.** Two waves lost the same way in a row. Any measurement that
takes longer than the machine's uptime is a gamble, and 40k arms at `tw=960` take
roughly an hour and a half.

### 31.2 What survived, and it is worth having

Two windows of each wave-8 arm, and the 24k-28k row is the first mature one. The
in-window `ended` count is the churn measure §30.4 pre-registered:

| arm | dissolve bar | claimed% | ended | mode | p50 core |
|---|---|---|---|---|---|
| controls (3) | 10,000 | 10.7-12.9 | **70-77** | 12.0 | 12.0 |
| waves 5-6 treated | 10,000 | 8.3-11.7 | **96-98** | 8.0 | 8.0 |
| `w8_agglom052` | 10,000 | 12.36 | **95** | 8.0 | 8.0 |
| `w8_hyst` | **2,000** | 8.80 | **48** | 0.01 @ 36.2% | 6.5 |
| `w8_hyst_chaos` | **2,000** | 10.36 | **52** | — | 4.5 |
| `w8_hyst_nofloor` | **2,000** | 10.87 | **54** | 8.00 @ 36.2% | 8.0 |

**Every arm with the owner's 2,000 dissolve bar roughly halves the churn** (48-54)
against both the controls (70-77) and every previous treated arm (95-98). The one
wave-8 arm that kept the 10,000 bar sits at 95 with everything else identical — an
internal control, same wave, same build.

That is the pre-registered prediction landing at the first mature window. **One
window, less mature worlds, no verdict** — this document has retracted four
single-window stories and this is not going to be the fifth. But it is the right
direction from the right comparison.

One incidental oddity worth keeping: `w8_hyst` and `w8_hyst_nofloor` hold the mode at
**the same 36.2% share** — at 0.01su and 8.00su respectively. The floor fix moves
*where* the mode sits without changing *how much* of the register sits on it, which
suggests the mode's size is set by something other than the floor's value.

### 31.3 Wave 9, relaunched with honest names

```
w9_hyst         VIABLE_UNITS + DISSOLVE_CORE=0.2    ← the owner's design
w9_hyst_chaos   … + MINING_RATE=5.0000001           ← twin
w9_8kfloor      DISSOLVE_CORE=0.2, floor left at 8,000   ← the §30.2 interaction
w9_nohyst       VIABLE_UNITS + DISSOLVE_CORE=1      ← internal control, no hysteresis
```

`w8_hyst_nofloor` is renamed `w9_8kfloor` so the name says what the arm does. All
carry `CORE_LOCAL`, `AGGLOM_LOCAL`, `URBAN_LABOR`, `STAMP_RETIRE`.

### 31.4 The restarts are frequent — horizon cut to 28k

Wave 9 died after ONE window. `/proc/uptime` read 23 seconds at the check; the
previous check read 47 seconds. **Two container restarts inside about seven
minutes.**

At `tw=480` a 40k arm takes roughly 90 minutes and reaches the first mature window
(24k-28k) at about 8 minutes. Against a machine whose uptime is measured in minutes,
a 40k arm cannot finish — waves 7, 8 and 9 all died, at windows 7, 7 and 6.

**Wave 10 runs to 28,000 steps instead of 40,000.** That is not a compromise on the
third cardinal rule — it is the same `tw=480` app-proxy grid — only on horizon. It
reaches the window where every wave-8 contrast appeared (churn 48-54 against 70-77
and 95-98) and finishes in ~8 minutes, which fits inside the observed uptime.

What it costs: the mature tail. Waves 4-6 showed the median core only clears the
floor at 32k-36k, so a 28k arm cannot see that. The tail needs either a calmer
machine or a resumable probe; neither is being built now.

---

## 32. WAVE 11 COMPLETE — and §31.2's "halves the churn" is RETRACTED

Four arms run to 28k in the FOREGROUND, inside the tool call, so nothing could
outlive the turn. All completed cleanly (301-349s, exit 0, 7 windows each). That
technique is the fix for §31.4's problem and should be the default from here: a 28k
`tw=480` arm costs five minutes and cannot be lost.

Final window (24k-28k), with a **proper internal control** — `w11_nohyst` carries the
identical lever stack and differs ONLY in the dissolve bar:

| arm | dissolve bar | claimed% | urban% | bind% | p50 core | mode | total su | ended | settled |
|---|---|---|---|---|---|---|---|---|---|
| ctrl clean | 10,000 | 11.38 | 7.68 | 37.9 | — | — | 235,051 | 70 | — |
| ctrl chaos1 | 10,000 | 12.91 | 7.04 | 32.6 | 12.0 | 12.00 @ 44% | 233,594 | 77 | 498 |
| ctrl ref3 | 10,000 | 10.70 | 7.35 | 33.3 | 12.0 | 12.00 @ 45% | 237,054 | 70 | 518 |
| **NO-HYST** | **10,000** | 11.40 | 5.11 | 37.9 | 5.1 | 0.01 @ 33% | 211,654 | **59** | 480 |
| HYST | **2,000** | 8.80 | 5.58 | 40.7 | 6.5 | 0.01 @ 36% | 204,133 | **48** | 401 |
| HYST chaos | **2,000** | 10.36 | 4.85 | 37.8 | 4.5 | 0.01 @ 32% | 210,414 | **52** | 475 |
| HYST 8kfloor | **2,000** | 10.87 | 6.81 | 42.7 | 8.0 | 8.00 @ 36% | 202,511 | **54** | 473 |

### 32.1 The retraction

§31.2 reported that *"every arm with the owner's 2,000 dissolve bar roughly halves
the churn (48-54) against both the controls (70-77) and every previous treated arm
(95-98)"*.

**The comparison was wrong.** Wave 8's supposed internal control, `w8_agglom052`,
carried `URBAN_AGGLOM = 0.52` — a completely different lever at four times its
shipped value. It was never a no-hysteresis control; it was a different experiment.
So the "halving" was measured against the whole lever stack plus an unrelated dial,
not against the dissolve bar.

With a real control — same stack, only `DISSOLVE_CORE` differs:

```
raw ended            NO-HYST 59      HYST 48, 52      →  81-88% of control
per settlement       NO-HYST 0.123   HYST 0.120, 0.109 →  89-97% of control
```

**The hysteresis reduces churn by roughly 10-20% raw, and by 3-11% once normalised
for the fact that the treated arms hold fewer settlements to lose.** Not a halving.

Most of the drop from the controls' 70-77 to the treated 48-54 comes from the OTHER
levers in the stack, which the no-hysteresis arm already shows at 59.

### 32.2 What else the dissolve bar does: essentially nothing

Against its own control, every other measure overlaps:

```
urban%     NO-HYST 5.11    HYST 5.58, 4.85     straddles
bind%      NO-HYST 37.9    HYST 40.7, 37.8     straddles
p50 core   NO-HYST 5.1     HYST 6.5, 4.5       straddles
mode share NO-HYST 33%     HYST 36%, 32%       straddles
total pop  NO-HYST 212k    HYST 204k, 210k     at or slightly below
```

So on this evidence the 2,000 dissolve bar is a **small churn effect and nothing
else** at this horizon. It does not move the pin, the median, or urbanisation.

That is not a refutation of the design — §29's argument for hysteresis stands on its
own logic, and the mature tail (32k-40k) where waves 4-6 showed the median finally
moving is exactly what a 28k horizon cannot see. But it is a long way from what §31.2
claimed, and the claim came from a control that was not a control.

### 32.3 The method lesson, which is the same one twice

§20 established that this world's run-to-run variance needs three control draws.
§32.1 adds the other half: **a control must differ from the treatment in exactly one
thing.** `w8_agglom052` differed in two, and I read the difference as if it were one.

Both errors have the same shape — comparing against whatever arm happened to exist
rather than against the arm the question requires. The foreground technique makes the
fix cheap: a purpose-built control now costs five minutes and cannot be lost, so
there is no longer any excuse for reusing an ill-matched one.

---

## 33. WHAT IS STILL BROKEN — the standing list

### A. Blocking any ship decision

1. **The population cost is unexplained.** `AGGLOM_LOCAL` costs 21-28% of world
   population and **halves absolute urban population** (§25, §27). The churn
   explanation was refuted by arithmetic (§27.1); the cap hypothesis (§27.3) is named
   and untested. Until this has a mechanism, the lever cannot ship.

2. **`URBAN_AGGLOM = 0.13` is a fitted constant** (§23, conceded to the owner). The
   dose-response that would settle whether it is load-bearing — and whether the cap is
   what moves population, one sweep answering both — has been launched twice and lost
   twice (§31, §32). **Still unrun.**

3. **The mature tail is unmeasured for everything built since wave 6.** Waves 4-6
   showed the median core only clears the floor at 32k-36k. The 28k horizon forced by
   §31.4 cannot see it. Every current verdict is an early-world verdict.

### B. Structural defects found, not fixed

4. **The mint tests gathering, not sustainability** (§29.4, the owner's own framing).
   A momentary core reading decides whether a city exists. Needs per-site state across
   the `SITE_CITY_IVL` rebuild, which owes `npm run coverage`.

5. **The `STARVE_SHED` seam** (§11, §16): the fed-ness melt reaches the capacity
   spike and not the size read, so a starving core still reports full size. Never
   measured. May be made moot by `AGGLOM_LOCAL` (§21.4) — that itself is untested.

6. **The mode never clears, at any floor.** 27-41% of the register sits at whatever
   the lowest floor happens to be — 12.00su, then 8.00su, then 0.01su — in *every*
   configuration tried. Removing a floor moves the mode; it has never removed it.
   Something other than the floor sets that share and it has not been found. This is
   the deepest open question on the register.

7. **The resolution anchor** (§5b) remains an owner decision, still blocking the last
   Phase-2 site (`MIN_SETT_DIST`).

### C. Known-broken, deliberately parked

8. `FARM_RES` — convicted (§12, §18): buys its ceiling by pinning half the register.
9. `GRAIN_PRICE_BY_TIER` — the load-bearing ratchet leg (§4); needs `_foodSupply`
   fixed from retained-net to production-relative first.
10. `HINTERLAND_BY_TIER` / `CORE_BY_TIER` — the territory half of the ratchet, never
    touched (§5).
11. The urban graveyard's `min(1, urbShare/0.3)` saturation — named in `CORE_LOCAL`'s
    own text as *"the honest boundary of the safety argument"*, and never tested in a
    regime where cores actually concentrate.

### D. Method and instrument debt

12. **`npm run validate` is a no-op for every lever built today** — its arm pins
    `LAND_KNOW = 0` and `urbanCoreR` returns 0, so the edited lines never execute. The
    repo's standard gate proves nothing for this whole family of changes.
13. The live-arm gate (`npm run livegate`) exists but its horizon/grid defaults were
    reasoned, never calibrated.
14. **Background arms do not survive in this environment.** Foreground works and
    cannot be lost, but caps a run at ~10 minutes ≈ 28k steps at `tw=480`.
15. **There is no absolute world-population standard in the repo** (§28.2) — found by
    inventing one and reporting it as a failed test. Worth deciding whether one should
    exist.

### E. Nothing has shipped

Every lever built this lap is `def: 0` and byte-identical when off. **None has been
through a gate ladder**, and item 12 means the usual ladder would not test them
anyway.

| lever | state |
|---|---|
| `HAUL_PAID` | measured inert |
| `FARM_RES` | convicted; also blocked on the anchor |
| `URBAN_LABOR` | passes on pin and ceiling; population question open |
| `AGGLOM_LOCAL` | right diagnosis, unexplained population cost |
| `STAMP_RETIRE` | breaks the 12k pin; costs unquantified at the tail |
| `VIABLE_UNITS` | works; exposes that the mode is not floor-driven |
| `TOWN_MINT` | built, then superseded by the owner's design — delete or keep for a town register |

---

## 34. THE DIAL SWEEP RAN — §27.3's cap hypothesis is REFUTED

Four doses of `URBAN_AGGLOM` across an 8× range, one lever varied, everything else
identical (`CORE_LOCAL + AGGLOM_LOCAL + URBAN_LABOR`), all four run to 28k in the
foreground and completed.

| dial | claimed% | urban% | urban su | max core | total su | p50 core |
|---|---|---|---|---|---|---|
| 0.065 | 11.11 | 5.73 | 11,645 | 1205.2 | 203,272 | 12.0 |
| **0.13** (shipped) | 9.57 | 6.38 | 13,245 | 841.2 | 207,704 | 12.0 |
| 0.26 | 10.94 | 4.54 | 9,319 | 248.6 | 205,474 | 12.0 |
| 0.52 | 13.18 | 8.82 | 18,931 | 930.7 | 214,676 | 12.0 |
| *controls (no `AGGLOM_LOCAL`)* | 10.7-12.9 | 7.04-7.68 | — | 466-696 | **233,594-237,054** | 12.0 |

### 34.1 REFUTED: the cap is not what costs the population

§27.3 hypothesised that `AGGLOM_LOCAL` binds each city to 13% of its own region,
capping the runaway tail, and that the tail was propping up world population. The
test it implied: **raise the dial and the population should come back.**

It does not. **An 8× dial range moves total population by 6%** (203k → 215k) while
the gap to the controls is **12-14%** (234-237k). Even at four times the shipped
value the treated world stays ~9% below control. A cap that can be relaxed eightfold
without closing the gap is not what created the gap.

**So the population cost remains unexplained**, and both of my explanations are now
dead — churn refuted by arithmetic (§27.1), the cap refuted by measurement here.
That is the honest state: the mechanism costs a fifth of the world's people and
nobody knows why.

### 34.2 INCONCLUSIVE: whether the dial is a painted-on answer

The owner's cardinal-rule objection (§23) predicted one of two shapes. Neither
appeared cleanly:

```
dial   ×8       urban%   5.73 → 6.38 → 4.54 → 8.82     ×1.5, and NOT MONOTONE
```

Urbanisation does not track the dial — 8× the input gives 1.5× the output, and the
0.26 dose reads *lower* than both 0.065 and 0.13. On its face that says the system
resists the dial and other forces (the graveyard, the hinterland cap, `URBAN_LABOR`'s
food feedback) dominate the level, which would mean the constant is **not** simply
setting the answer.

**But this cannot be claimed from these runs.** Four doses, one draw each, no twins —
and §20 established that this world's run-to-run spread at matched maturity is
comparable to the effects being measured. The non-monotonicity is exactly as
consistent with four noisy draws as with a real response curve. `max core` swinging
1205 → 841 → 249 → 931 across the same doses is the tell: that is the statistic §14.1
was already retracted for reading off single arms.

**Settling it needs twins at each dose** — eight runs, ~40 minutes of foreground.
Cheap now that arms cannot be lost, and it is the next thing to run.

### 34.3 Answering the owner's question: is it "a few solid runs"?

Partly.

- **Runs settle problems A1 and A2** (§33) — the population cost and the dial. One is
  now settled negatively (the cap is out); the other needs twins.
- **Runs cannot settle A3** (the mature tail). That needs a run longer than the tool
  timeout, so it needs either a calm machine or a resumable probe.
- **Runs cannot settle B6** — *the mode never clears at any floor*, 27-41% of the
  register in every configuration tried. That is a diagnosis problem: something other
  than the floor sets that share, and more arms of the same shape will keep
  re-measuring it rather than explaining it. **It is the deepest open item and it is
  not run-shaped.**

---

## 35. IS THE POPULATION DROP BAD? — checked against history, mostly NO

> Owner: *"is this a bad thing? how does this line up to real life"*

### 35.1 The one axis with a real-world benchmark says the CONTROL is wrong

| 36k-40k | urban | rural | total | **urban %** |
|---|---|---|---|---|
| control clean | 119M | 302M | 421M | **28.3%** |
| control chaos1 | 84M | 325M | 409M | **20.5%** |
| control ref3 | 83M | 322M | 405M | **20.5%** |
| `+AGG+STAMP` | 41M | 268M | 309M | **13.3%** |
| `+AGG+STAMP` chaos | 41M | 280M | 321M | **12.8%** |
| `+AGG+STAMP+ULAB` | 36M | 272M | 308M | **11.7%** |

Against the historical record for share of population in places over ~10,000:

```
Roman Empire at peak     ~10-15%   (within the empire, not the world)
World c.1500 CE            ~5-8%
World c.1800 CE              ~7%
England 1800                ~20%   ← the most urbanised large country on earth
Netherlands 1700            ~30%   ← the outlier of the pre-industrial world
```

**The control worlds run at 20-28%.** That is England-in-1800 at the low end and
Dutch-Republic-outlier at the high end — for a world that is nowhere near
industrial. **The treated worlds run at 11.7-13.3%**, which sits inside the plausible
band for a mature pre-industrial world.

### 35.2 Most of the "lost" population is the excess urbanites

```
control clean   421M total, 119M urban      treated  309M total, 41M urban
   total gap 112M   of which urban gap 78M  →  70% of the loss is city-dwellers

control chaos1  409M total,  84M urban      treated  321M total, 41M urban
   total gap  88M   of which urban gap 43M  →  49% of the loss is city-dwellers
```

**Half to seventy percent of the population drop is urban population that should not
have existed at that urbanisation rate.** Put the other way: at 12% urban and 309M
people, a world should hold ~37M urbanites. The treated arms hold 36-41M. The control
holds 119M against a 12%-implied 50M — **2.4× too many.**

On that reading the drop is not a cost at all. It is the removal of population the
control was carrying *because* its cities were unphysically large, which is the
pathology this entire lap set out to fix.

### 35.3 What that does NOT settle

- **The rural half is unexplained.** 30-50M (10-15%) of the gap is countryside, and
  there is no benchmark for how peopled a countryside should be at a given claimed
  fraction. It could be a correction or a defect; nothing here distinguishes them.
- **"Which total is right" is unanswerable as posed.** 309M ≈ a 1000 CE world,
  421M ≈ a 1450 CE world — both are real figures. Deciding between them needs to know
  what development level the world has actually reached, and CLAUDE.md's two-clock
  warning is exactly that the displayed calendar cannot answer it.
- **The mechanism is still unexplained** (§27.1, §34.1). Knowing the outcome is
  probably fine is not the same as knowing why it happens, and a mechanism whose
  effect nobody can account for should not ship on the grounds that its output looks
  reasonable — that is fitting the outcome, in the other direction.

### 35.4 Standing correction

This is the third time this lap that a "cost" turned out to be a correction once
checked against an external standard rather than against the control (§28.2 was the
first, on population; §32.1 the second, on churn). **The control is not the target.**
The control is a world with a known pathology, and measuring against it will keep
reporting fixes as regressions.

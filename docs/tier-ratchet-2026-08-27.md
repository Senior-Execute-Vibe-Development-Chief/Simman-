# The tier ratchet (2026-08-27)

> Owner, on being shown the mechanism: *"that tier ratchet thing seems utterly
> useless, and against our design philosophy."*

This is the lap's own document. It exists because the 12k fix (`CORE_LOCAL`) was
measured on the live arm, passed the kill-shot it was built to face, and then
failed on something else entirely — and the something else turned out not to be
its fault.

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

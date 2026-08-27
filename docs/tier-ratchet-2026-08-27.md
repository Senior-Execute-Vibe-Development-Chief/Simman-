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

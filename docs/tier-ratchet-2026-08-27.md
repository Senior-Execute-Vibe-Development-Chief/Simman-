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

- **The military-balance kill-shot passed.** Per realm at 32k-36k: deaths 0.3988
  vs 0.3344 ± 0.1317, wars 11.97 vs 13.59 ± 2.44, shatterings and foundings inside.
- **The political map converged.** 766 realms vs 782 ± 42; claimed land 32.34% vs
  31.96% ± 1.85. The +43% realms visible at 28k was a timing shift.
- **The urban ceiling broke.** Urban share 8.79% → **15.57%** in one window, past
  `urban-claim-memo` §5.3's refutation line and still climbing, against 4.68% on
  the null arms.

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

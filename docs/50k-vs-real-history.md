# The 50,000-step run against real history

Companion to `docs/50k-run-2026-08-01.md`. Seed 8817, app grid, commit `21499f8`.

## Method: match on DEVELOPMENT, never on the calendar

The run's displayed year is 19400 AD and that number is meaningless — the calendar is
cosmetic by the FIRST CARDINAL RULE, and the two clocks have drifted by ~17,000 years.
Comparing "19400 AD" to anything real would be the two-clock trap in its purest form.

So every comparison below is anchored on the **organization knowledge track**, using the
sim's own tech gates to date it. `TECHS` gives writing at 0.35, code-of-laws at 0.55,
banking at 0.70, industrialism at 0.88, medicine at 0.95 — so the run's org level maps
onto a real-world date through the technologies it has actually unlocked, not through
the year label.

**Units matter and one series is misleading.** `_onePopScale = census ÷ field`, so
`popField` is the canonical people count and settlement `people` are scaled census
units (ratio ~240–440, drifting over the run). Everything below uses `popField`.
Per-settlement figures are bridge-converted and flagged, because that conversion
assumes a settlement's share of census equals its share of real people, which is an
assumption rather than a fact.

Real-world figures are approximate and, for early periods, genuinely disputed —
population before 1000 AD is uncertain by factors of 2–3. None of the conclusions below
turn on that precision; the gaps are one to three orders of magnitude.

---

## 1. The arc, in five phases

| phase | steps | org | what happens |
|---|---|---|---|
| **Founding burst** | 0–5k | 0.18→0.23 | 78 settlements founded in the first window alone, 4 realms, 0.2% of land claimed |
| **Long stall** | 5k–20k | 0.23→0.56 | settlement founding collapses to **1 per window**; realms grow into empty land; no deaths, no secessions |
| **First mortality** | 20k–30k | 0.56→0.74 | `polity.ended` climbs 23→54/window; secession begins (first 7); plagues start; recession accelerates |
| **Churn** | 30k–42.5k | 0.74→0.90 | realm deaths 83–116/window, shatterings 54, restorations 53; horde raids appear |
| **Crowded end** | 42.5k–50k | 0.90→0.95 | 50% of land claimed; horde raids **139/window**; plagues 103; 96 shatterings |

The shape is recognisably historical: an initial colonisation pulse, a long quiet
expansion, then a sharp rise in conflict, disease and political collapse as the map
fills. `plague.outbreak` going 0 → 138/window as density rises is the correct causal
direction, and nobody scripted it.

The **long stall** is the anomaly. Between steps 7,500 and 17,500 the world founds
**1–10 new settlements per window** while population triples. The `found` funnel says
why: `hardFloorOverlap` rejects **75.7%** of all candidate sites across the run — a raw
anti-overlap spacing constant, not an economic or ecological limit.

## 2. Where the sim matches real history

**Empire sizes are right, and that is the strongest result.**

| | km² |
|---|---|
| sim, largest realm at 50k | **12.8M** |
| Roman Empire (117 AD) | ~5M |
| Han (100 AD) | ~6.5M |
| Umayyad (750) | ~11M |
| Qing (1790) | ~14.7M |
| Mongol (1270) | ~24M |
| British (1920) | ~35.5M |

The sim's largest realm sits between the Umayyad Caliphate and Qing China. Its median
realm is 588,000 km² — comparable to Ukraine or Madagascar, a plausible median for a
world of 62 states. The area *tail* is right too: max/median ≈ 22, and real history has
a similar heavy tail.

**Urban share is right.** 12.5% of census population is urban at 50k. Real world: ~7%
in 1800, ~16% in 1900. At org 0.95 ≈ 1900, that is close.

**Political fragmentation is right.** 62 realms against 195 sovereign states today —
same order. 155 cultures and 239 languages against ~140 real language *families* — also
same order, though 29× fewer than the ~7,000 living languages.

**The event mix is right.** Wars, famines, plagues, secessions, restorations, hordes,
faith adoptions, dynastic unions and elections all occur at rates that read as history
rather than as noise. `ruler.died` runs ~250/window with `ruler.elected` rising steadily
— an emergent shift toward elective succession nobody wrote in.

## 3. Where it does not match — ⚠ CORRECTED, was wrong by 4x

**An earlier version of this section was wrong by a factor of four and inverted one
finding entirely.** It treated `popField` (the land field) as the headcount. The
player-facing population is the settlement census times `POP_SCALE = 1000`
(`src/ui/bits.jsx`, whose export header states *"1 sim-person = 1,000 people"*); the
land field is a different internal scale, bridged by `_onePopScale`. Corrected:

| org | ≈ real era | sim pop | real pop | gap | sim largest city | real largest | |
|---|---|---|---|---|---|---|---|
| 0.34 | writing ~3200 BC | 13M | ~14M | **1x** | **0.84M** | Uruk ~0.04M | **21x too BIG** |
| 0.46 | currency ~600 BC | 24M | ~100M | 4x | 2.12M | ~0.20M | 10.6x too big |
| 0.69 | banking ~1200 AD | 33M | ~400M | 12x | 2.45M | ~0.40M | 6.1x too big |
| 0.88 | industrialism ~1800 | 71M | ~1000M | 14x | 2.75M | ~1.10M | 2.5x too big |
| 0.95 | medicine ~1900 | 135M | ~1650M | **12x** | 4.42M | London 6.5M | 1.5x low |

Final density is **0.91 people/km²** — real-world levels around **1 AD**, not 3000 BC as
previously written. The shortfall at the end is **12x, not 51x**.

**The inverted claim.** This document previously said the largest city was "smaller than
Çatalhöyük". It is **4.42 million people** — a genuine metropolis, close to London in
1900. That was wrong by a factor of a thousand, and it was wrong in the direction that
made the sim look worse than it is.

### The real defect: the world has no villages

With units fixed the picture is sharper, and different:

* **Total population at the dawn is right** — 13M against a real ~14M.
* **But it is packed into far too few centres.** At the writing horizon the world holds
  ~86 settlements averaging ~150,000 people, largest 840,000 — against a real 3200 BC of
  thousands of villages and a largest city of ~40,000.
* **Neither population nor cities accelerate.** Sim population grows 13M → 135M (10x)
  where real grows 14M → 1.65B (118x). Sim largest city grows 0.84M → 4.42M (5x) where
  real grows 40k → 6.5M (160x).

The demographic system is **linear where reality is exponential**, and it begins by
concentrating a CORRECT total population into a tenth of the settlements it should have.
The cities are not too small — they are too FEW and too LARGE, from the first millennium
onward, because the right number of people has nowhere else to live.

That also reframes the settlement count. 230 settlements planet-wide is not "missing
cities"; it is missing the entire VILLAGE AND SMALL-TOWN TIER beneath them. The `found`
funnel names the mechanism holding that tier out: `hardFloorOverlap` rejects **75.7%** of
all candidate sites on a raw anti-overlap spacing constant.

## 4. The anachronism: flight before the compass

The leading civilization at 50k has **flight** (construction 0.99, track complete) and
**medicine, democracy, telegraph, industrialism** (organization 0.95). It does not have
**gunpowder**, **firearms**, **the compass**, **cartography**, or any ship better than a
**galley**.

    Stone Age    9/9   COMPLETE      Renaissance  8/12   missing firearms, ocean_nav, musketry
    Bronze Age  13/13  COMPLETE      Industrial   7/13   missing steel, railroad, steamship
    Classical   12/13  missing cartography          Modern  4/8  missing electricity, combustion

| track | level | last unlocked | blocked on |
|---|---|---|---|
| construction | **0.99** | flight | *complete* |
| organization | **0.95** | medicine | computing @0.97 |
| mobility | 0.90 | chivalry | *complete* |
| agriculture | 0.87 | heavy_plough | fertilizers @0.88 |
| metallurgy | **0.79** | iron_legions | blast_furnace @0.80 |
| navigation | **0.57** | galleys | cartography @0.68 |

**Navigation is the outlier by 0.42.** It has been stuck just past galleys (gate 0.58)
essentially the entire run, which is why there is no age of exploration, no ocean
navigation, and no maritime empire. Metallurgy sits **one hundredth** below the blast
furnace gate, and every firearm in the tree is downstream of it — so a world with
aircraft has no guns.

No real civilization developed like this, and the reason is that in history these
tracks are *coupled*: metallurgy drives construction, navigation drives trade drives
organization. Two tracks in the same knowledge system diverging by 0.42 over a full run
says the coupling is missing — the SECOND CARDINAL RULE's question, "what mechanism
should produce this?", applied to the tech tree.

## 5. Verdict

The sim gets **geography, territory and politics** approximately right: empire sizes,
area tails, realm counts, urban share, and the *shape* of a civilisational arc
including a genuine late-stage rise in war, plague and collapse.

It gets **demography and technological coupling** wrong, and both in the same way — a
missing accelerator. Population grows linearly where history compounds; knowledge tracks
advance independently where history couples them.

The single most consequential number in this document, corrected: at the dawn of writing
the world holds **13M people in ~86 settlements**, when the real world held ~14M in
thousands of villages. The total is right; the container count is off by two orders of
magnitude. Everything downstream — cities 21x too large, population failing to
accelerate, realms administering continents with four provinces — follows from a world
that has cities and no villages.

Every ratio-based check in `npm run validate` passes here, because the ratios are fine.
It is the levels that are wrong — the lesson the THIRD CARDINAL RULE records for
territory, repeating for settlement supply.

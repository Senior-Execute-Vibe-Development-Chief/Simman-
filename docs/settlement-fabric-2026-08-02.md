# The settlement fabric: stateless cities, an unreachable state bar, and no density

Three findings from the 50,000-step run and follow-up probes, seed 8817, app grid
(`tw=480`, 1 tile ≈ 62 km). They are **one problem seen from three sides**.

Read `src/sim/units.js` first: a settlement is a **city or large town, never a
village**, and **1 sim-person = 1,000 people**. Both matter to every number below.

---

## 1. The early world is 90% stateless — and they are cities

| step | settled | stateless | % | share of world population | largest stateless |
|---|---|---|---|---|---|
| 1,500 | 45 | 41 | **91%** | **80.3%** | 115,137 |
| 3,000 | 58 | 52 | **90%** | **77.4%** | **219,396** |
| 6,000 | 74 | 56 | 76% | 43.6% | 154,387 |
| 12,000 | 85 | 45 | 53% | 17.8% | 153,272 |
| 25,000 | 113 | 22 | 19% | 4.4% | 174,067 |

Nine cities in ten belong to no polity, holding four fifths of everyone alive —
including a city of **219,000**, larger than any real city until Rome. And they are not
backwaters; they are wired into the economy:

    Kèňtọ̄ị    118,542 people   org 0.637   12 trade partners   wealth 7,012
    Gabese      116,744 people   org 0.640   12 trade partners   wealth 7,767
    Müganyo     113,446 people   org 0.600   12 trade partners   wealth 12,799

Twelve partners each — the `_tradeReach` cap — and real treasuries.

Historically this is close to a contradiction. Early urbanism *is* state formation:
Uruk, Ur, Lagash, Mari and Ebla were city-states, self-governing by definition. A
200,000-person city answering to nobody is not a state of nature; it is a category
error. (One case reads true: `Tivi`, 174,067 people at org 0.129 with a single trade
partner — a genuine tribal centre.)

## 2. Becoming a city is easier than becoming a state

    settlement is BORN at    18,000-25,000 people   (90,000 at town scale)
    state needs a SEAT of   160,000 people          NUCLEATE_SEAT_POP  = 160
    ...inside a CLUSTER of  400,000 people          NUCLEATE_CLUSTER_POP = 400

**A settlement is born a real town and must grow 6.4× before it may found a state.**
For scale: Uruk was ~40,000 and was the largest city on Earth; medieval London was
40,000–80,000. The sim demands a seat four times Uruk inside a cluster ten times it.

`NUCLEATE_SEAT_POP`'s own comment reads *"a real regional centre (a large village /
town)"* — written in sim units as though they were people. Under `POP_SCALE` it is a
major city. This is the same units confusion that produced two retracted analyses in
one session, baked into a simulation constant.

The `nucleate` funnel confirms the bar is what binds: **`seatPop` rejects 83.9%** of all
candidates, far ahead of `org<ORG_STATE_MIN` at 15.1%.

And the founding code shows why it bites early:

```js
countryId: joinCountry,  // born into the realm it sits in / extends — stateless (-1)
                         // for a rode-away steppe camp or a daughter of a
                         // sub-ORG_STATE_MIN mother
```

A new settlement inherits a realm only if founded inside one. Early there are four
realms, so nearly everything is born outside all of them — stateless, under a bar it
must sextuple to clear.

**The model treats "being a city" and "being a polity" as separate achievements with
different bars, when in the early world they are the same event.**

## 3. There is no settlement fabric — 560 km between neighbours, everywhere

    nearest-neighbour:  p10 391 km · p50 560 km · p90 1,023 km   ·  p90/p10 = 2.6x
    fertile/barren packing ratio: 1.26x   (mechanism permits 2.5x; floodplain 3.3x)
    floodplain: 49 of 85 settlements on ~1% of the land, mean spacing 533 km

Spread from four seeded hearths, measured at ~750 years in (step 1,500):

| | tiles | ≈ km |
|---|---|---|
| median new settlement's distance from any hearth | 20.5 | **1,270** |
| farthest | 80 | **4,960** |
| share beyond 30 tiles from every hearth | 29% | >1,860 |

…rising to 45% beyond that radius by step 25,000. Real Neolithic demic diffusion
(Ammerman & Cavalli-Sforza) ran at ~1 km/year — farming took ~4,000 years from Anatolia
to Britain. Seven hundred and fifty years buys ~750 km, not 5,000.

### Where the analysis was wrong, twice

**The spacing rule is not the culprit, and it is not the wrong shape.** It *is*
fertility-scaled — `capacitySpacingMul` gives barren land up to 2.5× more elbow room,
and `FLOOD_SPACING_MUL = 0.75` packs floodplains tighter still, with a deliberate
base-floor exemption. It works: **49 of 85 settlements sit on ~1% of the land.** An
earlier draft claimed a minimum-spacing constant "can't produce clustering at any
tuning". That was wrong.

**The floor is not even binding.** On floodplain it permits 3 tiles (186 km); realised
spacing is 8.6 tiles (533 km). Sites end up far more spread out than the rule requires,
so the limit is the **supply of viable candidates**, not anti-crowding. The realised
fertile/barren ratio is 1.26× against a permitted 2.5×.

## The synthesis

"Too many settlements in the wilderness" and "too few settlements" are the same
observation. There is no *fabric*: real settlement is dense cores plus empty periphery,
while this is near-uniform scatter at 560 km. Every city looks marooned because none of
them have neighbours — a Sumerian city had five others within a day's travel; Uruk to Ur
is ~60 km, Eridu to Ur ~20 km.

That single absence explains all three findings:

    too few settlements, evenly spread
      → each sits far from any realm            → born stateless
        → and far below a 160,000-person bar    → stays stateless for millennia
          → 90% of the early world, 80% of its people, outside all politics

## Two candidate fixes, differing in kind

1. **Lower `NUCLEATE_SEAT_POP`/`CLUSTER_POP`** so a town-scale settlement founds a
   city-state. Cheap, but it tunes a number toward a desired outcome — what the SECOND
   CARDINAL RULE warns against.
2. **A settlement founded outside every realm is its own polity.** A city *is* a state
   unless absorbed, which is how the early world actually worked; the `nucleate` bars
   then govern something narrower — when a cluster coheres into a realm *above* the
   city-state layer.

(2) is the mechanism-true version. Neither is safe to ship without the full gate set and
a 50k run: this session established that horizon dominates, and every one of these
numbers would move.

**Unaddressed by either:** the density itself. Even with states fixed, 85 settlements at
560 km spacing is not a populated world, and the binding constraint there is candidate
supply, which sits upstream in `crystallize`.

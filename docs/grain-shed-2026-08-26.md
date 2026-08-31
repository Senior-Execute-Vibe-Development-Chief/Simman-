# The grain-shed lap + the cradle inversion (2026-08-26)

The owner's play report on the v49 world, in three claims — all three MEASURED
AND CONFIRMED, then decomposed. Instrument: `tools/probe_where.mjs` (the
atlas, the urban ladder, the grain shed, in one run). Logs in
`docs/runs/2026-08-26/where_*.log`.

> "most cities at 12k? ... food seems to be shipped globally to few points?
> also the toggle board for different goods isnt working. also civilization is
> strong in eastern europe, some in india, west sahel, not really anywhere else"

## 0. The toggle board — FIXED (shipped)

Dead code. The bottom-left legend panel was gated
`viewMode==="terrain"||"atlas"||"resources"`, so the eight per-kind chips and
their All/None row never rendered in `goodsflow` view. One-line gate fix.

## 1. The grain shed — three stacked defects, each hidden by the one before

Baseline (obs-240, seed 8817, 30k): median market haul **965 km**, p90 1,867,
max 4,126 — against history's 20-100 km overland shed — with the top 3
importers taking **42%** of all landed grain (top 10: 73%).

**(a) `T.GRAIN_FREIGHT` — the road was free.** A buyer paid the seller's
farm-gate price for what ARRIVED; the haul's loss was borne by nobody, so a
far city bought at the same unit price as the seller's neighbour. Now the
buyer buys AT THE FARM GATE (ships 1/arrive, pays for the consignment, the
road eats the difference). Measured: concentration 42% → 31%, distances
**unchanged** — which exposed:

**(b) `T.HAUL_PHYS` — the range was a tile constant.** `FOOD_HAUL_RANGE = 14`
is in TILES, and a reference tile is ~167 km: a **2,338 km** e-folding before
the tier (×3.6), tech (×2) and water (×3) multipliers push it past Earth's
circumference. `arrive ≈ 1` between any two points on the planet — there was
no decay left for (a) to price. Re-grounded in real km at the world's own
km-per-tile (grid-honest by construction): land e-folds at **340 km**
(Diocletian's Price Edict — ox-wagon +55% per 148 km, so 148/ln 1.55), water
multiplies by **12** (the edict's land:water freight ratio). Measured: median
965 → 847 km, still barely moved — which exposed:

**(c) The water test was an endpoint test.** The corridor bonus asked only
whether each END touches water, and the stylized gate measures ~100% of
settlements waterside, so a ×12 barge multiplier applied to routes that are
entirely overland (a Caspian city and an Atlantic city both "on water"). Under
`HAUL_PHYS` it now requires an actual water ROUTE — the sea-lane link
`mergeReach` already distinguishes from road reach. RECORDED LIMITATION: river
barge traffic (Thebes→Memphis) is not a sea lane and takes the land curve;
`transport.js` already prices river ground cheap for the ROUTE but not for the
spoilage clock. That is the next lap if the cradles measurably starve on it —
never a widened constant.

**(d) `T.GRAIN_BID` — the plainest defect of the day.** `grainMarketPass`
walks `world.settlements` in ARRAY order — **founding order** — and each buyer
draws down the sellers' live residuals as it goes. The world's oldest city is
served in full before a younger one is offered a bushel; price, hunger and
distance play no part in allocating scarcity. That queue IS the reported
world: one 920k metropolis, 37 of 71 cities at the minting floor, top-3
importers at 42%. Now buyers approach in descending order of their own
emergent scarcity price (`_grainPrice`, already on every settlement; ties on
id for determinism) — the hungriest bid it away, as classical grain tracked
dearth rather than seniority, and a real deficit outbids a granary top-up so
`GRAIN_PROVISION`'s standing demand subordinates to hunger for free.

All four ship at **default 0**, pending the ensemble and the gate ladder.

## 2. The urban ladder — the 12k pin is real

44 of 75 cities at the ≤15k minting floor, p50 8k, beside a 3-city >300k tail.
The `HAUL_PHYS` arm fills the middle in (30-60k doubles, 60-120k goes 1→5),
which is the shape the waves are after, but no arm has cleared the floor mode.

## 3. The cradle inversion — REAL, and it is a LAND finding

**Chaos-bounded first.** A float-epsilon draw (`MINING_RATE=5.0000001`, no
mechanism) reproduces the inversion: E Europe 552k urban people / 489k largest
city, Greece-Italy 0, Mesopotamia 5k, Egypt 52k — statistically the baseline's
490k/369k/0/0/63k. The atlas is a robust feature, NOT a seed accident. The
corollary binds equally: arm-to-arm swings in mid-table regions (Greece/Italy
0 → 171k → 0) sit inside that band and must not be read as mechanism.

**Two instrument bugs caught before publishing**, both recorded because they
nearly became findings: (i) `yOf` inverts latitude, so the area loop ran
backwards and floored every region to the 0.05 Mkm² guard — the "8× density
inversion" was mine, not the sim's; (ii) a BOX MEAN CANNOT MEASURE A RIBBON —
Egypt's and Mesopotamia's boxes are mostly desert, so averaging capacity over
the box buries the Nile in the sand beside it, scoring the very geometry that
MAKES a cradle as poverty. Fixed with `cageField.js`'s own answer to this
problem, the capacity-WEIGHTED mean (Σcap²/Σcap).

**The corrected finding.** Urban people per Mkm² of the box's own land:
E Europe **118k**, Egypt 24k, Indus 19k, N China 6k, Mesopotamia **0** — a 5×
inversion surviving area normalization, on top of the largest-city inversion.
And the ribbon-honest capacity, per tile of the land people actually stand on:

| region | cap/tile (weighted) | fill | cities |
|---|---|---|---|
| Greece/Italy | 213,258 | 0.28 | **0** |
| E Europe/Russia | 162,881 | 0.28 | 3 |
| Anatolia/Levant | 110,187 | 0.25 | 1 |
| Egypt/Nile | 46,768 | **0.94** | 2 |
| N China | 33,720 | 0.61 | 2 |
| Mesopotamia | 31,072 | 0.48 | 0 |
| Indus/NW India | 12,038 | **1.21** | 2 |

Two distinct defects, in one atlas:

- **The cradles are CAPACITY-BOUND and under-fed.** Egypt's settled strip is
  3.5× poorer per tile than the East European plain and Mesopotamia 5×, with
  the Indus 13× — while their fill sits at 0.94-1.21, i.e. AT or OVER
  capacity. They cannot grow whatever the food market does. History runs the
  other way: irrigated Nile alluvium was among the most productive farmland on
  Earth (10:1 seed yields against Europe's 3-4:1, no fallow, silt renewed
  annually, two crops where warm), carrying the densest pre-modern rural
  populations recorded. THE SUSPECT, named for the next lap: capacity is
  `fert × capPerFert × dev × access × relief × industry × works`
  (popFieldKernel capBand), and `fert` is climate-derived — a flood-irrigated
  DESERT ribbon reads its sky, not its river. `FIELD_CRADLE`, `IRR_BAND` and
  `FLOOD_OPT` all ship ON and are supposed to answer this; the measurement
  says they do not lift the ribbon above the rain-fed plain. Decompose
  `capField` into its terms at cradle tiles vs plain tiles BEFORE building.
- **Greece/Italy is a pure FORMATION failure**: the richest weighted capacity
  in the world (213k), fill 0.28, and **zero cities**. The land can feed them,
  the people are not there, nothing forms. A different defect from Egypt's,
  and it should not be conflated with it.

---

## 4. THE UNIFIED VERDICT (2026-08-27) — the atlas and the shed are ONE defect

§3's "cradle inversion is a LAND finding" is **RETRACTED**, by its own
decomposition (`probe_capterms`, `docs/runs/2026-08-26/capterms*.log`):

- Egypt's richest tile carries **fert 1.00 (maxed)** against E Europe's 0.84,
  and the FIELD_CRADLE stack fires there at the LARGEST value of any region
  (×3.48 vs 2.58). The Nile is neither poor land nor un-irrigated.
- Reconstructing `capBand` exactly, the geographic terms EXPLAIN cradle
  capacity (ratio 0.83-1.98) but leave E Europe **14.2×** unexplained,
  Greece/Italy 6.1×, W Europe 3.6×.
- By the land's own geography alone, **Egypt is the richest tile on the map**
  (77,358), level with Greece/Italy (76,359), then N China (60,265), E Europe
  (41,820), W Europe last (21,314) — history's own ordering.

The overlay is the settlement economy: `ONE_POP`'s URBAN CAPACITY SPIKE (what
a city's ECONOMY supports beyond what its land feeds — imports, granary,
housing) and `FOOD_K`'s worked-catchment ledger override. Both are OUTPUTS of
a city. **Reading "richest tile" read whichever metropolis stood there and
called it soil** — the third measurement artifact of this lap, after the
inverted-latitude area loop and the box-mean-over-a-ribbon.

**So the hypothesis became: if capacity at cities is import-fed, repairing the
grain shed repairs the atlas by itself.** Tested behaviourally — the full
stack (`HAUL_PHYS + GRAIN_FREIGHT + GRAIN_BID`) and its own chaos draw against
the two banked no-mechanism draws:

| measure | no-mechanism ×2 | full stack ×2 | verdict |
|---|---|---|---|
| E Europe largest city | 369k, 489k | **35k, 52k** | 7-10× collapse, far outside the band |
| E Europe urban rank | 1st, 1st | 9th, 4th | the runaway is gone |
| N China urban | 15k, 32k | **132k, 272k** | the cradle rises |
| urban core p50 | 8k, ~8k | **15k, 24k** | the 12k pin lifts |
| ≤15k floor mode | 44/75 | 36/70 | the middle fills in |

**CONFIRMED: the E Europe runaway is manufactured by the grain economy, not by
the land.** The owner's four complaints were three symptoms of one broken
market plus one dead UI gate.

### Two of my own framings corrected by the same runs

- **Haul distance is largely GRID-BOUND, not a pure defect.** The median haul
  sits at ~1,000 km in EVERY arm because at tw=240 a tile is 167 km and
  neighbouring settlements are ~6 tiles apart: inter-city grain trade cannot
  be shorter than settlement spacing. History's 20-100 km overland shed lives
  INSIDE the catchment, which `s.people` already accounts for. `HAUL_PHYS` is
  still right on its own terms (a tile constant meaning 2,338 km is a bug
  whatever the grid), but it must not be sold as a fix for the distance
  number. Re-measure at tw=480/960, where spacing halves.
- **Import concentration is probably NOT a defect.** Top-3 share reads 40-52%
  under the stack against 42% baseline — no improvement, and `GRAIN_BID` does
  not de-concentrate (a chronically short metropolis holds the highest
  scarcity price, so it stays first in the queue). But Rome, Constantinople
  and Alexandria DID dominate the ancient grain trade: a few huge cities
  taking most of the traded grain is history's own shape. The owner's real
  complaint was that most cities buy NOTHING, and that is the ladder metric,
  which improved.
- **A runaway metropolis still exists — it RELOCATES** (703k in the stack's
  main arm, 308k in W Europe in its chaos draw). The stack removes E Europe's
  specific advantage without removing whatever lets one city run away. Named
  for the next lap.

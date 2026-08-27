# The catchment audit — radius and overlap (2026-08-27)

Owner, after the grain-shed lap: *"do that [the catchment radius hard look]. also
as a side note look into if multiple cities catchments can overlap. they
shouldnt."* Ten-agent audit (map ×4, measure ×2, adversarial verify ×3,
synthesis), every citation re-verified against HEAD and the probe independently
re-run by the synthesis agent. Instrument: `tools/probe_overlap.mjs`.

**One number to hold:** a reference tile is 40075/240 = **167 km** across. Every
catchment radius in the settlement path is multiplied by `rNormPop = tw/240`, so
real-km extents are identical at tw=240, 480 and 960.

## 1. OVERLAP — the owner's rule HOLDS where the economy counts

`world._territoryOwner` is a single `Int32Array`, one owner slot per tile
(`territory.js:174`). A tile physically cannot hold two owners, and all three
claim phases write that one slot under an exclusivity guard: core first-claim-wins
(`:294`), hinterland nearest-wins (`:326`), and a multi-source Dijkstra where a
neighbour's locked land is a **wall** (`:369`, `:408`). The census reduces over
that partition (`popField.js:1836-41`) and `s.people = f * scale` (`:1999`) is the
only field-derived write. The harvest (`territory.js:466`), the FOOD_K capacity
ledger (`popField.js:907-920`) and governed people (`conquest.js:2711-18`) read
the same array.

| | tw=240 | tw=480 |
|---|---|---|
| tiles in >1 catchment | **0 / 3,473** | **0 / 8,292** |
| max settlements per tile | 1 | 1 |
| double-counted people | **0.000%** | **0.000%** |
| Σ`s.people` ÷ all-land field mass | 0.9032 | 0.8081 |

The ratio being **below 1** is the independent check: the census counts fewer
people than stand on the planet. Overlap would push it above 1. `_onePopScale` is
also safe — under `BRIDGE_GLOBAL` (ships 1) both sides are whole-world totals, so
catchment geometry drops out entirely.

## 2. OVERLAP — but the BASIN DISK overlaps massively, and it mints cities

`townBasinMass` (`crystallize.js:170-181`) is a bare Euclidean disk sum with **no
ownership test**, radius `TOWN_BASIN_R × rNormPop` = **1,670 km**. Consumers at
shipped defaults: the city mint bar, the dissolve bar, the sweep's urban floor,
`CROWD_FOUND`'s founding rate, `INVENT_STAGGER`'s hearth stand-down and ignition,
and — via `CAGE_HORIZON_REF` — the **exit ring of the caging field**, the core
drive of state formation.

| | tw=240 | tw=480 |
|---|---|---|
| tiles under >1 disk | **65.3%** | 62.9% |
| max cities sharing one tile | **8** | 8 |
| field mass multiply-claimed | 88.4% | 88.7% |
| Σ basin mass vs people actually there | **3.58×** | 3.53× |
| land blanketed by ≥1 disk | 67.0% (52 disks) | 50.1% |

The only exclusion that exists (`residualBasinMass`, `crystallize.js:218-232`) is
gated on `MINT_RESIDUAL`, which ships 0. So: **exclusive where people are counted,
triple-counted where cities are born and killed.**

## 3. THE ONE REAL HOLE — `seedLocalTerritory` → `T.SEED_EXCLUSIVE`

`territory.js:563+`, called at mint (`settlement.js:492`) to give a newborn its
opening food/resource stats before the first full territory pass. It walked a raw
box (radius `round(3×rNormPop)`) with **no ownership test**, so a city founded
beside an established one booked that neighbour's fields as its own until the
amortized pass reassigned them.

Measured: **44 episodes per 24k steps, median 103 ticks each, median 49% (max
100%) of the box simultaneously owned and harvested by another settlement,
+9.8% world harvested area** — and worse at finer grids, because the territory
pass amortizes over more tiles (`index.js:161-2`, `TERRITORY_INTERVAL=144×rNormPop`:
144 ticks at tw=240, 288 at 480, **576 at the shipped 960**).

The lever applies the partition's own rule at birth. Dawn bootstrap is
byte-identical (nothing is owned before the first pass). Zero new constants.

### Gate ladder (SEED_EXCLUSIVE=1)

- stylized **8817** all hard, 0 soft — 36 settlements, 25 polities (v50 default: 39 / 20)
- stylized **4242** all hard, 1 soft — 40 settlements, 29 polities
- stylized **777** all hard, 0 soft — **20 settlements, exactly its alive floor**
- **777 chaos ensemble: 20 / 20 / 20** across main + two float-epsilon draws — so
  20 is the TYPICAL value under the fix, not an unlucky tail. Against the v50
  default's 24, the fix costs that seed four settlements and passes with **zero
  margin**.
- **resgate all bands held**, median realm area app/ref **0.96** (v50 default 0.91
  — closer to parity, which matters because the defect is itself resolution-scaled)
- Urban ladder, monotone across arms (median city / floor share / 120-300k tier):
  pre-v50 **8k / 59% / 2** → v50 stack **15k / 51% / 4** → +SEED_EXCLUSIVE **20k / 44% / 6**

**The cost is the mechanism, not a regression:** a newborn minted into saturated
countryside no longer gets a free opening ledger, so marginal foundings that used
to survive on a neighbour's fields now fail. 777's four lost cities were partly
living on stolen land.

## 4. WHAT THE ADVERSARIAL VERIFIERS KILLED

Both headline claims were **refuted and replaced with sharper ones** — recorded
because the corrections matter more than the originals:

- *"Catchments can overlap and inflate Σs.people"* → **REFUTED.** 0.000%, both
  grids. What overlaps is the basin DISK, which prices mints, not censuses.
- *"TOWN_BASIN_R materially distorts the food economy"* → **REFUTED.** It is read
  in exactly two files (`crystallize.js`, `cageField.js`) and by **nothing** in the
  food economy — no harvest, no census, no capacity read. Its *comment* was the
  error, claiming "the day's walk that binds a countryside to one market": wrong by
  ~50× and wrong in kind. Corrected in place this lap.
- Because the disk is huge it is **permissive**, which is why every attempt to make
  it bind measured inert (`TOWN_BASIN_MIN` ×5 byte-identical; `MINT_RESIDUAL`
  near-inert; `MINT_REACH` structurally inert). A residual/reach bar is a
  *saturation detector* — it can only prevent above-saturation minting, never cut
  below it.

## 5. NAMED FOR LATER (measured, not built)

- **One constant, six physical questions.** `TOWN_BASIN_R` serves the mint bar, the
  dissolve bar, the founding-rate reference, the hearth ignition basin, a harbour's
  shelter test and a fleeing household's exit horizon. No number can be all six.
  The pattern to copy is already in the repo: `HAUL_LAND_KM` (`foodHierarchy.js:108`)
  — a real distance converted at the world's own km-per-tile, no `rNormPop`,
  grid-honest by construction.
- **The cage exit ring is the sharp end.** `STATE_CAGE` is the core drive of state
  formation and reads its flight horizon from this constant; a 1,670 km exit window
  plausibly reads ~0 cage everywhere but true deserts — the opposite of the
  discrimination it was built for. Measure before touching.
- **`CORE_BY_TIER` / `HINTERLAND_BY_TIER` are raw tiles** (`territory.js:116,127`),
  unscaled by `rNormPop` while every other radius in the path is scaled. Third
  cardinal rule: a resolution-dependent constant is a bug. But the one-line fix
  quadruples the guaranteed hinterland's real area at tw=960 and moves `armies.js`
  assault distances with it — exactly the `deffdce` shape. **Measure at both grids
  before flipping.**
- **A city's provisioning hinterland is SUB-GRID.** History's is 20-50 km (hard
  ceiling ~100-150 km overland); one reference tile is 167 km across, so a real
  city's shed is **4-22% of a single tile**. Its correct radius is 0.2-0.6 tiles;
  r=0 (own tile only) is already generous. The realized worked catchment measures a
  median ~621 km equivalent radius. This is a statement about what the grid can
  represent, not a bug to patch.

---

## 6. SEED_EXCLUSIVE REFUTED AT THE SHIPPED GRID — and the bug is LOAD-BEARING

The paired tw=960 A/B (`probe_shape` 20k/8817) the dossier demanded, and it
killed the fix twice:

| tw=960, step 20000 | baseline | v1 (veto owned tiles) | v2 (nearest-wins) |
|---|---|---|---|
| realms | 14 | 12 | 11 |
| **small states <100k km²** | **5 of 14 (36%)** | **0 (0%)** | **1 of 11 (9%)** |
| size dispersion lnσ | **2.68** (real ≈2.0-2.6) | 0.92 | 1.12 |
| gini | 0.56 | 0.38 | 0.41 |
| P10 realm | 4k km² | 206k | 394k |

Every tw=240 gate passed BOTH versions — 3 seeds all hard, resgate at app/ref
0.96 (better than the default's 0.91), and a monotone urban ladder (median city
8k → 15k → 20k). The failure is invisible at the diagnosis grid and is a change
in KIND at the shipped one: the `deffdce` pattern, caught only because the arm
was run.

**THE FINDING IS BIGGER THAN THE FIX.** The small-state tier RESTS ON THIS BUG.
A newborn's temporary over-claim is the window in which a marginal founding
establishes itself; remove the subsidy — bluntly (v1) or fairly (v2) — and only
uniform large blobs survive. Nothing else in the sim currently supports a small
state. That is a fragile foundation and worth knowing.

**So the honest repair is not to the seed box.** It is to what a small centre can
legitimately HOLD — and the owner named the mechanism the same day:

> *"I am predicting small slop cities will drown out the big ones? Simply by
> taking their catchment? Why DIDNT this happen irl? Were prices better in big
> cities?"*

Correct on both counts. The partition apportions by DISTANCE: the guaranteed belt
is nearest-wins (`territory.js:326`) and the Dijkstra budget is
`TERRITORY_BASE + reachLevel × ORG_REACH` (`territory.js:78-92`) — weighted by
ORGANIZATION, which measurably CONVERGES (org pack p50/p67/p90 = 0.83/0.84/0.84,
spread 0.001), so in a mature world **a metropolis and a hamlet draw the same
catchment budget**. The only size term anywhere is the tier belt, 3→8 tiles, a
2.7× radius ratio at most.

Reality apportioned by MARKET PULL, which scales with the centre's size:

- **Reilly's law of retail gravitation (1931):** the breakpoint between two
  centres sits at distance ∝ **√(size ratio)** — a 500k city against a 12k town
  holds the boundary ~6.5× further from itself. Christaller: higher-order centres
  have longer ranges. Huff (1964) generalises to pull = attraction / distance^λ.
- **Prices, exactly as the owner guessed:** a big city bids more for grain (more
  mouths, more coin, often a state buying) and sells manufactures cheaper (thicker
  market, scale). Von Thünen's rings are drawn around ONE market because the net
  farm-gate price after transport sets the haul distance — a higher price pushes
  the big city's rings past the nearer small town's.
- **Thick markets:** lower search cost, less risk of hauling and not selling.
- **The law forbade the failure mode outright:** medieval English market
  franchises under Bracton's rule — no new market within 6⅔ miles (a third of a
  day's journey) of an existing one, enforced to suppress rivals. Florence's
  *contado*, the Roman *civitas*, the Chinese *xian*: the hinterland was assigned
  to its seat, and a new settlement inside it was a subordinate village.
- **Hierarchy, not competition:** Skinner's Chinese marketing system nests
  standard markets inside intermediate inside central. Real catchments are
  exclusive WITHIN a tier and NESTED ACROSS tiers. Our register is flat, so a
  minor town and a metropolis contest the same tiles as equals.

**THE NAMED MECHANISM (not built, needs its own lap and both grids):** replace
nearest-wins with a **gravity/Huff partition** — each tile to the centre
maximising `pull = attraction / cost^λ`, attraction ∝ √(market size), the same
√pop convention the sim's trade gravity already uses. Reilly then falls out for
free. A small centre would hold a modest catchment **by right** rather than by
theft — which is what would finally let `SEED_EXCLUSIVE` ship without taking the
small-state tier with it.

**Verdict: SEED_EXCLUSIVE stays at def 0.** The code and both measurements stay
in the tree as the record. Do NOT re-tune the seed box; the next move is the
partition.

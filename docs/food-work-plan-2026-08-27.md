# The work plan — every open food-system issue, and how it gets fixed

Written 2026-08-27 at the owner's request: *"deeply summarise what you will do to fix
ALL of the aforementioned issues, and reference the docs they are written in."*

Every item names the document that carries its evidence. Nothing here is built unless
it says SHIPPED. The order is deliberate and the reasoning for it is in §6.

---

## STATUS 2026-08-27 (evening) — THE ORDER IN §6 IS WRONG, and the measurement says why

This section is appended, not edited over the plan below, so the reasoning that
produced the original order stays readable beside the evidence that overturned it.

**Item 1 was run in full on the live arm** (tw=480, seed 8817, 40k, one treated arm
against three float-epsilon no-mechanism draws; `docs/runs/2026-08-27/mil_*.log`).
Three results, in order of how much they change the plan:

**(a) The military-balance kill-shot PASSED, cleanly.** `urban-claim-memo` §5.1
refutes the change if realm deaths collapse or explode. At 32k-36k, per realm:
deaths 0.3988 vs 0.3344 ± 0.1317, wars 11.97 vs 13.59 ± 2.44, shatterings and
foundings all **inside** the band. Doubling the urban mass that mans walls and pays
garrisons does not disturb the war system.

**(b) The political map CONVERGED.** 766 realms vs 782 ± 42; claimed land 32.34% vs
31.96% ± 1.85. The +43% realms and −36% foundings visible at 28k were a **timing
shift** — states form earlier, then the map settles to the same shape.

**(c) The urban ceiling BROKE, and it is not `CORE_LOCAL`'s fault.** Urban share
8.79% → **15.57%** in one window, past §5.3's refutation line and still climbing.
The cause is the **tier ratchet**: crossing the metropolis bar (core 40) grants four
discontinuous upgrades at once —

| table | at the bar | grant |
|---|---|---|
| `CORE_BY_TIER` | 3 → 4 | home block +78% area |
| `HINTERLAND_BY_TIER` | 6 → 8 | farmland belt +78% area |
| `FOOD_RANGE_BY_TIER` | 2.2 → 3.6 | grain reach +64% |
| `GRAIN_PRICE_BY_TIER` | 14 → 22 | bid +57% |

— every one of which grows the core that produced the label. The register's mean
core crossed 40 between 32k and 36k (35.1 → 37.4 → **60.3**) exactly when the share
doubled; the null arms sat at 18.2 and never approached it. `CORE_LOCAL` only opened
the door: **the closed trap its own description names was the brake.**

Owner's judgment on being shown this: *"that tier ratchet thing seems utterly
useless, and against our design philosophy."* It is — a derived label driving
capability is what CLAUDE.md forbids for the era, in space instead of time.

### What this does to the order

§6 argued §3 must wait for §1 because a size-keyed rule would be inert while cities
are pinned. That reasoning still holds on its own terms. What it missed is the
other direction: **§1 cannot ship without §3, because §3 is the brake.** The two are
not sequential, they are the same repair from two ends.

- **`T.HAUL_PAID` (built 2026-08-27, def 0)** — §3's first leg, and the one that is
  purely a deletion. `FOOD_RANGE_BY_TIER` is removed from the spoilage curve, which
  never had a physical claim on it: the table's own header names "granaries, ports,
  professional carters" and two of the three are already separate terms in the same
  function. Reach becomes what `GRAIN_FREIGHT` already prices — a city reaches as far
  as it pays to. Paired arm running.
- **`GRAIN_PRICE_BY_TIER` — NOT to be deleted.** Load-bearing: the steep
  farm-gate→market gradient is what stops a market town paying its villages for
  everything and becoming a net buyer that pumps coin into the countryside. The
  margin needs a real source (collection, storage, the market institution — all
  already tracked) before the table goes.
- **`HINTERLAND_BY_TIER` / `CORE_BY_TIER`** — the territory half. Their comments
  justify themselves by the map they want to see ("that size gap is what reads as a
  hierarchy on the map") rather than by a cause. Blast radius is the exclusive
  partition; this is the §3 proper.

### Item 2 is built

`npm run livegate` — derives the shipped lever set from the code (never a copied
string), runs the stylized battery on it, and refuses a verdict unless the child
echoes the arm it derived. Measured: **18 of 19 pinned levers** sit at a value the
app does not ship. Horizon and grid defaults are reasoned but not yet calibrated
against a real run.

### And the instrument that made all of this legible

`urban.coreBlockRanPct` / `urban.coreLocalBindPct` through `collect()`, plus
`tools/cmp_arms.mjs`'s chaos band and matched-maturity view. The arming check
confirmed itself against a static prediction made days earlier (memo: 37% of the
register; live: 37.9%, with 0.0% on every null arm), and the maturity view **reversed
a conclusion** — at 20k-24k the treated arm reads "8× the band, more war" at matched
step and "3.2× the band, LESS war" at matched claimed land. The first number was
measuring that the treated world is older.

## 0. WHAT IS ALREADY SHIPPED (no work needed)

| what | lever | record |
|---|---|---|
| Cities buy grain from peers, not just from subordinates | `GRAIN_MARKET` | `grain-shed-2026-08-26.md` §1 |
| A city with a full granary sells the excess, refilling its own stores first | `SHIP_SURPLUS` + market | `grain-shed` §1, seed-corn rule |
| The road is paid for — the buyer buys at the farm gate | `GRAIN_FREIGHT` | `grain-shed` §1(a) |
| Haul range in real kilometres, not map squares | `HAUL_PHYS` | `grain-shed` §1(b) |
| The water bonus needs a real sea route | inside `HAUL_PHYS` | `grain-shed` §1(c) |
| Scarce grain goes to the hungriest buyer, not the oldest city | `GRAIN_BID` | `grain-shed` §1(d) |
| Millennia of villages before the first city; calendar from the ice age | `CAGE_FILL`, `EPOCH_YD` | `genesis-2026-08-26.md` |
| The goods overlay's eight toggles | — | `grain-shed` §0 |

**Two of these carry retractions** that must not be forgotten when quoting them
(`food-system-design-2026-08-27.md` §5.1): `GRAIN_FREIGHT`'s 42%→31% concentration
gain did **not** survive the full stack, and `GRAIN_BID` **does not de-concentrate**
at all — it is measured-and-null, not unmeasured. The haul-distance number is also
largely **grid-bound**, not a defect that was fixed.

---

## 1. FINISH THE 12k FIX — `CORE_LOCAL`  *(nearest to done)*

**Issue.** A city may only count someone as urban if the food was IMPORTED. Its own
farms' harvest buys it nothing, so a self-feeding city freezes at the 12,000-person
founding stamp — and being frozen keeps its tier low, which keeps its reach short and
its grain price weak, which is what would have earned it imports. A closed trap.

**Record.** `food-system-design-2026-08-27.md` §3.5 and §5.2; the full build memo with
the measured table is `urban-claim-memo-2026-08-27.md` §1-§2. Measured: 186 of 273
cities at exactly 12.00; `importShare > 0` for **ten**.

**The fix, already written and switched off.** `coreEff = min(_coreF, max(holdF,
kLocal) + kBeyond)` where `kLocal = _k · (1 − importShare)` — the same landShare the
code already spreads over the countryside. `max` not `+`, so no city can shrink, no
tier can demote, and no dissolution can be caused. Zero new constants.

**What remains.**
1. The **military-balance arm**, which `urban-claim-memo` §5 says to run FIRST because
   nobody would think to: urban mass rises ×2.45, and walls and the paid garrison read
   the urban core while the conscript levy reads the rural remainder. Metric: realms
   founded / ended / shattered per 4k steps, paired, on the **live arm**.
2. The disk-ceiling share at the finer grid (`urban-claim-memo` §5.3).
3. Then flip, with a save-version bump and the guard.

**Already passed:** the political-map kill-shot that killed `SEED_EXCLUSIVE` — small
states 91%→90%, size spread 0.77→0.80, at tw=480 on the live arm.

---

## 2. FIX HOW WE TEST  *(protects everything after it)*

**Issue.** The test harness pins levers the real game ships ON, so the battery
measures a world nobody plays. Two of this session's measurements were void because of
it: one executed no new code at all, one measured a pre-urban planet.

**Record.** `food-system-design-2026-08-27.md` §6.1 and §6.2. Measured divergence: the
gate configuration produces ~20 realms, the live configuration **541** — a factor of
~25. `urban-claim-memo` §5 records that `npm run validate` is a **literal no-op** for
`CORE_LOCAL`: 38 of 39 settlements identical.

**The fix.** A live-arm gate that runs the shipped lever set at the horizon where a
political map exists (~32k steps under the genesis clock), reporting the same stylized
facts. Not a replacement for the existing battery — a second arm, so a green result
means something. Additionally: `TRIBUTE_UP` is pinned to 0 in the harness, so an entire
compelled cross-realm food flow is invisible to every probe we have
(`food-system-design` §6.1).

---

## 3. THE ONE RULE — the owner's two-mode model  *(the prize)*

**Issue.** Four separate gaps are all the same missing decision.

| gap | what is wrong | record |
|---|---|---|
| No price in land assignment | ρ(grain price, land held) = **−0.011** | `food-system-design` §3.1 |
| Straight lines, not terrain | two of three claim phases are pure geometry; **roads are ignored**; a plain Voronoi reproduces the live map to 14.2% of tiles | §3.1, §2.4 |
| Organisation gates farming | a city's fields extend because its realm discovered *writing* | §3.3 |
| The size term is inert | metropolis vs hamlet catchment budgets differ by **1.02–1.05×** | §3.5 |

**The rule** (`food-system-design` §1): *a hinterlander makes one delivery decision — if
someone has a claim on him, liege or landlord, he delivers to them; otherwise he
delivers to whoever pays most after what the journey costs.*

**What it replaces:** the geometric land carve-up, the levy tree, and the peer market —
three systems become one. Big cities hold land further out because they genuinely pay
more (Reilly falls out free). A new city can only take an **uncompelled** tile, and only
by actually outbidding — the crowding-out the owner predicted, solved without a special
case. Egypt sends grain to Rome because Rome owns Egypt, not because Rome is near.

**Constraints already established.** Attraction is the measured urban core, NOT the
catchment census (circular by identity) — `gravity-partition-memo-2026-08-27.md` §1.
The land partition stays **exclusive**; what nests in history is goods and
administration, both already modelled — §2 of the same memo. A switching margin stops
flicker and has real historical warrant (market-franchise law).

**Blast radius, and it is large.** 46 references assume one owner per tile
(`catchment-audit-2026-08-27.md` §1); `s.tier` alone has 77 read sites. Behind a lever,
measured on the live arm at both grids, with the small-state tier and size spread as the
kill-shots.

---

## 4. THE DECAY LAW  *(small, independent, do it with §3)*

**Issue.** Two different decay laws for one physics — the catchment fades as
`1/(1+0.5c)`, the market haul as `exp(−d/range)` — and **neither is right**. Real
freight cost rises steadily with distance, so grain's value hits **exactly zero** at a
finite range. Von Thünen's rings END; ours fade forever, so far land keeps trickling in
food that could never arrive.

**Record.** `food-system-design-2026-08-27.md` §3.2.

**The fix.** One law, `max(0, 1 − d/D)`, with `D` the distance at which freight equals
the grain's value — derived from the same edict figure `HAUL_LAND_KM = 340 km` already
in the code. Risk to watch: a hard cutoff can make boundaries flicker; measure that.

---

## 5. UNTAPPED SURPLUS SHOULD PULL A CITY  *(after §3)*

**Issue.** Rich countryside far from any market should attract a town — bastides,
assarted villages, the grain towns of newly opened farmland. Today nothing pulls.

**Record.** `food-system-design-2026-08-27.md` §3.4 — and note the claim there is
**[CORRECTED]**: my original "it is written as a veto" was wrong about the code; the
conclusion survives for a different reason.

**The fix.** Under §3's rule this becomes almost free: a tile whose best net price is
low *because no one is near enough to pay* is, by definition, unserved demand. Found
where that value is highest. Risk: runaway founding, oscillation. Measure both.

---

## 6. WHY THIS ORDER

`CORE_LOCAL` first because it is nearly finished and it unblocks the rest — while every
city is pinned at 12k, the urban core cannot differentiate, so any law keyed on city
size is measuring a flat quantity (`gravity-partition-memo` §1: 186 of 273 at one value,
interdecile 1.68×). **The size-based rule in §3 would be inert until §1 ships.**

Testing second, because §3 is the largest change in the food system and shipping it
against a battery that measures the wrong world would be the most expensive mistake
available.

§4 and §5 ride along with §3 — they touch the same code and share its measurements.

---

## 7. NOT ON THIS LIST, DELIBERATELY

- **`SEED_EXCLUSIVE`** (newborn cities harvesting a neighbour's fields): refuted twice
  at the shipped grid — it destroys the small-state tier, because that tier currently
  RESTS on the bug. `catchment-audit-2026-08-27.md` §6. Do not re-tune the seed box; the
  repair is the partition, i.e. §3.
  **Caveat recorded 2026-08-27:** that refutation ran on the harness arm, not the live
  arm, so its regime is wrong even if its verdict likely stands. Re-run under §2.
- **The 1,670 km basin disk** serving six unrelated physical questions at once
  (`catchment-audit` §5). Real, but its own lap.
- **The river-barge spoilage gap** — Thebes→Memphis pays cart rates (`grain-shed` §1c).
- **`ABSORB_PEER`** — the owner's flip call, unrelated to food.

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

## 3. Where it does not match — and it is one defect, not many

**The world is demographically empty by a factor of ~50.**

| | sim @ org 0.95 | real @ ~1900 | gap |
|---|---|---|---|
| population | **32.4M** | ~1.65B | **51× low** |
| people per km² | **0.219** | ~12 | **55× low** |
| settlements | **230** | thousands of towns; ~10⁶ villages | **10²–10⁴× low** |
| largest city (bridge-converted) | ~1.1M | 6.5M (London) | ~6× low |

The density figure is the unambiguous one — it needs no bridge conversion. **0.219
people/km² is real-world density around 3000 BC.** The run ends with construction
complete (flight), organization at medicine and democracy, and the population density
of the Early Bronze Age.

And the gap *widens* with development:

| org | ≈ real date | sim pop | real pop | gap |
|---|---|---|---|---|
| 0.35 (writing) | 3200 BC | 4.9M | ~14M | 3× |
| 0.55 (code of laws) | 1750 BC | 8.8M | ~40M | 5× |
| 0.70 (banking) | 1300 AD | 11.8M | ~400M | 34× |
| 0.88 (industrialism) | 1800 AD | 15.7M | ~1B | 64× |
| 0.95 (medicine) | 1900 AD | 32.4M | ~1.65B | 51× |

Real population history is a hockey stick — 14M to 1.65B is **118×** across that span.
The sim manages **6.6×**. It is not that the world starts too small; it is that
**demography never accelerates.** Technology climbs the full tree while population
grows roughly linearly, so the two diverge further at every stage.

This is one defect with many symptoms. Too few people → too few settlements (230) →
too few candidate sites → the `hardFloorOverlap` spacing constant binds → fewer
settlements still.

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

The single most consequential number in this document: **0.219 people per km²**, at the
end of a run whose leading civilization can build aircraft. Every ratio-based check in
`npm run validate` passes on this world, because the ratios are fine. It is the levels
that are wrong — the same lesson the THIRD CARDINAL RULE records for territory, now
repeating for population.

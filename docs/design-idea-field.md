# THE IDEA FIELD — technique with an origin, a carrier, and a memory

Directive (owner, 2026-08): *"I think what we might want is a broader 'Idea'
spread and map system."*

This document is the measured foundation and the proposed law. It is **not** a
fifth attempt at settlement siting. The density lane has been falsified four
times, and the fourth falsification pointed upstream of the whole lane, at the
layer that decides **how densely land can people at all** — which is a
technique-diffusion layer, not a geometry.

Everything below at `480/8817` (sim `tw=240`) unless the shipped grid is named;
the resolution arm is §1g, per the THIRD CARDINAL RULE.

---

## 0. Frame — why the next density design is an IDEA design

Four attempts, four distinct causes of death (`docs/design-c-siting-ledger.md`,
`docs/design-c-hearth-field.md`):

| | approach | died of |
|---|---|---|
| v1 | fixed-disk exclusivity | **geometry** — a spacing constant in disguise (29 entities vs 78 off) |
| v2 | watershed of the smoothed `popField` | **resolution** — attractor texture is grid-resolved (38/82/113 basins at 240/480/960) |
| v3 | the market-site ledger (`T.LABEL_BIRTH`, shipped, off) | **reachability** — 78 labels by step 2000, then frozen for 10k steps; 128 of 206 bar-clearing sites permanently free |
| v4 | the hearth field (`T.MULTI_HEARTH`, shipped, off) | **not dead** — measured 78 → 139 labels, but blocked on a tier bar that is neither an absolute floor nor a fixed quota |

v4 found the cause the first three had each mis-attributed: `world.devField` —
the agricultural-technique field that sets `capField`, hence how densely land
peoples — is stamped from settlements only and relaxed by a **land-only** wave,
so farming has as many origins as the world has cradles and can never cross one
water tile.

Independently, `docs/state-birth-2026-08.md` reached the same layer from the
other side. `T.INVENT_FIELD` — scaling independent invention by local
people-time — was built, measured, and **failed in a way that ruled out its own
approach**: every site that can found already clears the basin bar, so density
can only ever multiply *up*. Its verdict named what was missing:

> Independent invention is a **once-only act of a PEOPLE**, not a per-tile,
> per-sweep chance — and the sim does not model it at all.

Two lanes, two failures, one layer. So the next design is about the idea layer,
and the density outcome is a **consequence** to be discovered, not a target.

---

## 1. The measured foundation

`tools/probe_ideas.mjs` (this branch). Reads only; six readings per checkpoint
plus a perf estimate.

### 1a. There are TWO idea layers, not one — and I had this wrong

Writing up the previous session I claimed technique spreads only at founding.
**That is false**, and the probe exists because I checked. The sim has two idea
layers with genuinely different physics:

| | settlement `s.knowledge` (settlement.js) | `world.devField` (popField.js) |
|---|---|---|
| what it is | 6 tracks per settlement: agriculture, construction, organization, metallurgy, navigation, mobility | one per-tile scalar: agricultural technique on the land |
| carrier | **merged road + sea reach** (`mergeReach`, :2156), damped by route cost `exp(−cost/30·rNormPop)` | **tile adjacency**, land-only (`relaxDevWave` iterates the `land` list) |
| climate | similarity gate on agriculture (`sim`, :2192) | per-edge toll `DIFF_CLIM × (|Δtemp|+|Δmoist|)`, zone-smoothed (**default 0.8, on**) |
| crosses water | **yes** — sea lanes carry technique (review I41/D37) | **never** |
| forgets | **yes** — dark ages on drawdown/cut-off (`T.KNOW_DECAY`, :2105) | **no** — a max-ratchet, `if (v > nxt[i]) nxt[i] = v` |
| origin | `inheritKnowledgeAt` baseline handout | stamped from settlements |
| cadence | every `KNOW_INTERVAL = 8` ticks, staggered by id | every popField pass |

The first layer is **rich** — carriers, route cost, climate, decay. The second
is **impoverished**. They are joined by a one-way stamp (`stampDevSources`).

### 1b. The impoverished layer is the one that governs density

`devField → capField → how densely land peoples`. So the planet's habitability
is decided by the layer with no carriers, no water crossing, and no memory.

Measured, 12 000 steps, 82 settlements, 32 realms (this reproduces the hearth
doc's control arm exactly — 32 realms — so the harness is sound):

```
land on landmasses with NO settlement, devField ≡ 0.000
  step   200 : 60.2% of land
  step 12000 : 59.9% of land
```

**The number does not move in twelve thousand steps.** The four stranded masses,
by latitude span:

```
comp 116   2855 tiles   lat -89..-65   polar — correctly excluded by temperature
comp   0   1592 tiles   lat  17..84    North America
comp  67    676 tiles   lat -56..12    South America
comp  98    297 tiles   lat -38..-12   Australia
```

Three of the four are habitable and permanently at forager density. Meanwhile
the home component (3823 tiles) carries 79 of 82 settlements and reaches 92.3%
farmed.

### 1c. Invention has no gradient — it is free, or it is impossible

The two mechanisms that decide whether a new site can exist sit ~90 lines apart
and fail in **opposite** directions:

```
crystallize.js:1171   independent = isFinite(td) ? INDEPENDENT_RATE : OVERSEAS_INDEPENDENT_RATE
crystallize.js:1261   connected   = !!donor && dCul >= 0 && isFinite(td) && td <= INDEPENDENT_DIST
```

- **Within transport reach**, `INDEPENDENT_RATE` is a flat floor *added* to
  `exp(−td/30)`, so beyond `td ≈ 130` it dominates and cancels the decay
  entirely — five thousand km from the nearest farmer is no less likely to
  invent farming than 130 tiles away. Measured consequence: nine world regions
  occupied by step 200, the Central Asian steppe the most-settled region on the
  planet, Siberia settled at 67°N by step 264.
- **Beyond transport reach** (`td = Infinity`), `OVERSEAS_INDEPENDENT_RATE`
  is computed — and then `connected` is false, so the founding is vetoed
  unconditionally. The constant is **dead code**, exactly as the hearth doc
  found.

So there is no gradient anywhere. The world is partitioned by *transport
connectivity* into a region where invention is free and a region where it is
impossible. Nothing about the idea, the people, or the land enters.

### 1d. The rich layer is contact-starved exactly when it matters

```
settlements with ZERO diffusion partners (learn from nobody)
  step   200 : 20.8%
  step  1000 : 28.6%
  step 12000 :  2.4%
```

The idea network is at its **thinnest during the founding wave that fixes the
world's settlement geography** — 35% of the settlements alive at step 12000
already existed by step 500, 56% by step 2000 (`probe_siting`). By the time the
network is dense enough to discriminate, the map is written.

### 1e. The ratchet asymmetry, measured

```
                                   step 1000   step 6000   step 12000
settlements that FORGOT agriculture     8/42        1/68         0/82
devField tiles that FELL                   0           0            0
```

The people can forget; the land cannot. And the land remembers technique nobody
holds: at step 200, **14.0%** of nonzero-`devField` land has no settlement within
a market horizon at all (3.3% at 12k). A dark age is therefore invisible to
carrying capacity — the settlements lose organisation and craft while the land
they stand on stays exactly as farmable as its best-ever moment.

### 1f. Technique converges to one planetary value

Cross-settlement spread at step 12000 (p10 / p50 / p90):

```
agriculture   0.540 / 0.569 / 0.586   spread 0.046   ←  8% of median
mobility      0.000 / 0.201 / 0.270   spread 0.270
organization  0.247 / 0.311 / 0.391   spread 0.144
construction  0.265 / 0.375 / 0.407   spread 0.142
metallurgy    0.083 / 0.178 / 0.204   spread 0.121
navigation    0.065 / 0.117 / 0.132   spread 0.067
```

**The one track that governs density is the most uniform of the six.** A planet
with a single agriculture is a planet where technique cannot explain any density
difference between one place and another — which is why every density mechanism
so far has had to come from geometry instead.

### 1g. Resolution arm (THIRD CARDINAL RULE) — the finding survives, two measures do not

`tw=480` (`W=960`), seed 8817, same checkpoints. **The headline is invariant to
0.3 points across a 4× tile count:**

| | `tw=240` | `tw=480` |
|---|---|---|
| land tiles / components | 9 616 / 118 | 38 741 / 252 |
| settlements @12k | 82 | 85 |
| realms @12k | 32 | 33 |
| **stranded land @ step 200** | **60.2%** | **60.4%** |
| **stranded land @12k** | **59.9%** | **60.2%** |
| farmed land @12k | 37.5% | 36.8% |
| agriculture spread @12k | 0.046 | 0.055 |
| `devField` tiles that ever fell | 0 | 0 |
| one wave pass | 0.344 ms | 0.678 ms |

That tightness is *expected* and is the point: "land on a component carrying no
settlement" is a **topological** property of the land graph, like the site
ledger's flow-tree node counts. Both grids find the same four stranded masses at
the same latitude spans (`-89..-63` polar, `8..84` N America, `-56..11`
S America, `-39..-11` Australia), plus three small equatorial islands the coarse
grid does not resolve.

**Two measures diverge, both in the same direction — the finer grid is worse
early:**

```
                                  tw=240        tw=480
orphaned technique @ step 200      14.0%   →     26.5%
zero-partner settlements @ 200     20.8%   →     34.8%
```

At the shipped grid, **a third of the world's settlements learn from nobody
during the founding wave**, and a quarter of all land carrying technique has no
market within a horizon of it. Both gaps close by 12k (5.6% / 3.5%), which is
the same "validated in the regime where it does nothing" trap the third cardinal
rule was written for: measured only at `tw=240` and only at maturity, the idea
layer looks nearly fine. It is not.

This strengthens the case rather than weakening it, but it is an **open
question, not a diagnosis** — the wave's per-tile relaxation and its loss term
may not be exactly per-real-area invariant, and phase 1 changes precisely that
neighbourhood. Re-measure both rows after phase 1; do not assume the direction.

### 1h. Perf — a field per idea is affordable

One max-wave pass over the land list: **0.344 ms** at `tw=240` (9 616 tiles),
**0.678 ms** at `tw=480` (38 741 tiles) — sub-linear in tile count, so the
shipped grid is the cheaper one per tile. Ten idea fields at the existing 1-in-8
cadence = **0.43 / 0.85 ms/tick**, against the hearth doc's measured 9.06 ms/tick
baseline. The field-per-idea shape is not what makes this design expensive; §7
names what is.

---

## 2. The law — `T.IDEA_FIELD` (new lever, default 0, byte-identical off)

**One sentence: an idea is something a people INVENTS once, CARRIES along the
same routes that carry its goods, ADOPTS only where it pays, and FORGETS when
the people who practise it are gone — and the field is a view of that, not a
separate physics.**

The design is three phases, each independently measurable and independently
flippable. Phase 1 alone is a defensible ship; phases 2 and 3 are where the
product change lives.

### Phase 1 — THE LAND CAN FORGET (`IDEA_FIELD = 1`) — BUILT, see the addendum

`devField` stops being a monotone ratchet and becomes a **view of what living
peoples practise**. Sources are rebuilt fresh each firing into their own array,
and the wave is run as a genuine fixed-point iteration:

```
dev[i] = max( src[i], best neighbour − climate toll − loss )
```

so when a settlement forgets (`T.KNOW_DECAY`) or dies, the land it fed relaxes
back — at exactly the rate it advanced (one tile per wave interval, the same
`DEV_WAVE_KMPY` in both directions). Dark ages become visible in carrying
capacity, which is what a dark age physically *was*.

**No new constant, no new rate, no bar changed.**

#### The half of phase 1 that was CUT, and why — a correction to this document

An earlier draft of this section also had the wave *ride the carrier*: read the
merged road + sea reach so technique crosses water where goods do, with the
claimed payoff that §1b's 60% would fall and `OVERSEAS_INDEPENDENT_RATE` would
stop being dead code. **Checked against the founding path before building it,
and it is wrong.** Founding requires a settled DONOR, not a field value:

```
crystallize.js:1261   connected    = !!donor && dCul >= 0 && isFinite(td) && td <= INDEPENDENT_DIST
crystallize.js:1307   donorSettled = connected && donor && donor.mode === "settled"
crystallize.js:1309   extension    = region >= 0 || donorSettled
```

So a carrier-borne wave would push `devField` onto a continent with no
settlements, raise `capField` there, and grow population on land **no people
ever carried farming to** — technique teleporting across an ocean with nobody
holding it. That is worse in kind than the land-only wave, not better.

The correct reading is that the cross-water carrier is **already modelled, at
the settlement layer** (`s.knowledge` diffuses over road + sea), and the field
inherits it through `stampDevSources` the moment a settlement exists over there.
The binding constraint on §1b's 60% is therefore the **donor requirement**, not
the wave's neighbourhood — which is phase 2's problem, and `MULTI_HEARTH`'s.

**Consequence for the battery: §6 item 3 as originally written is void.** It
demanded of phase 1 an outcome only phase 2 can deliver. It is restated there.

### Phase 2 — ORIGIN (`IDEA_FIELD = 2`)

Remove the free handout. `inheritKnowledgeAt`'s baseline stops returning
`agriculture: NEOLITHIC_AGRI` to a site with no donor; a people that has met no
farmer does not farm. Invention becomes an **act with prerequisites** — a
people, enough of them, in a place where the idea pays, sustained long enough —
evaluated once per people rather than per tile per sweep. That is precisely the
variable `INVENT_FIELD` was missing: not *how many people are here* but *whether
these people have had the occasion*.

**`T.MULTI_HEARTH` is a hard prerequisite for this phase**, and the dependency is
logical, not stylistic: if the handout is gone, hearths become the *only* source
of agriculture, so with four pinned hearths the planet outside Afro-Eurasia is
empty **by construction**. Phase 2 without v4 is strictly worse than today.

### Phase 3 — ADOPTION AND THE MAP (`IDEA_FIELD = 3`)

A people takes up an idea when it **pays where they are** — the steppe does not
adopt farming because farming does not pay on the steppe. This is the
mechanism-true fix for the wrong-places finding: the steppe becomes land that
ideas *cross* without *rooting*, and no constant knows what a steppe is.

~~The **map** ships with this phase~~ **BUILT EARLY, and that was the right
order** — the lens exists now (Economy → Technique: worker packs `devDens` on an
absolute 0..1 ruler, base map = `devField ≡ 0`, ochre haze below the
`NEOLITHIC_AGRI = 0.45` bar, green snapping in at it). Filing the instrument
under a payoff phase was backwards: the single most consequential field in the
sim had no view in the app, and every finding in §1 was made by throwaway probe.
Siberia farming at 67°N by step 264 is obvious on a map and invisible in a
metric. Phase 3 keeps only the *adoption* mechanism.

### Scope discipline — what this is NOT

Not a field per tech-tree node. The tree stays per-settlement; the **field is a
small number of idea CLASSES** (subsistence package, metallurgy, literacy/
administration, navigation, military) that the per-settlement tracks read as a
local **ceiling**. §1h sizes that; a node-per-field design is not sized and is
not proposed.

---

## 3. Cardinal-rule audit

**FIRST (nothing gated on time).** No phase reads the step, the year or an era.
An idea fires because a people has the prerequisites, the population, the
occasion and a carrier that reaches them. Phase 1's cadence rides the existing
`KNOW_INTERVAL` stagger, which is a performance cadence (how often the same read
refreshes), never a gate on whether history may happen.

**SECOND (build the system, never fit the outcome).** The test to keep applying:
no phase may detect a case. There is no `if (isSteppe)`, no `if (newWorld)`, no
constant whose only justification is a target count. §1c is the current
violation being removed — a rate whose in-code comment states the outcome it was
tuned to produce ("low so empty regions stay empty until colonised") while
measurably producing the opposite. The replacement must be judged the same way:
if a constant here has no meaning independent of the label count it yields, it
is fitted and must go.

**THIRD (measure at the grid that ships).** §1g is the arm. Phase 1 changes the
wave's neighbourhood from tile adjacency to network edges, which is exactly the
class of change that can differ in *kind* between grids — a network is a
topological object and tile adjacency is not. `npm run resgate` is mandatory
before any flip, and the §1g table must be filled at `tw=480` first.

---

## 4. Constants audit

Phase 1 adds **none** — it reuses `DIFF_CLIM` (0.8, shipped), `DIFFUSE_COST_K`
(30 × `rNormPop`, shipped) and `KNOW_INTERVAL` (8, shipped).

Phase 2 **deletes** `NEOLITHIC_AGRI` as a handout and must not replace it with a
tuned invention rate. The prerequisites (a population threshold, a duration, a
payoff test) must each have meaning independent of how many hearths result — if
the honest set yields three hearths on Earth or thirty, that is the finding.

Phase 3's adoption test must price the idea's **return in local conditions**
against the practice it replaces. A number that exists to keep the steppe
pastoral is a fitted answer and fails the second rule.

Existing constants this design puts in question, none to be re-tuned silently:
`INDEPENDENT_RATE` (0.020), `OVERSEAS_INDEPENDENT_RATE` (0.02, dead),
`INDEPENDENT_DIST`, `NEOLITHIC_AGRI` (0.45).

---

## 5. Determinism, persistence, perf

- **Determinism.** The wave is a pure function of live state, as now. Network
  iteration must use a **deterministic edge order** (`mergeReach` is a Map — id
  order, not insertion order) or the field diverges between runs; this is the
  single likeliest source of a determinism-gate failure and the smoke gate
  catches it.
- **Persistence.** Nothing new persists. The field rebuilds from live
  settlements, exactly as `ensureDevField` already does on load.
- **Perf.** §1h. The real cost is not the fields — it is that phase 1's wave
  reads the road/sea graph where today it reads four neighbours. That is a
  gather over a variable-degree graph, and it must be measured at `tw=480`
  before flip, not estimated.

---

## 6. Acceptance battery

1. **Byte-identity off** — hash-equal at 12k with the lever at 0, both grids.
2. **Determinism** — two runs, same seed, identical hashes (`npm test`).
3. ~~**The §1b number moves.**~~ **VOID as written — it was a phase-2 bar
   charged to phase 1.** Phase 1 cannot move the 60%: founding requires a settled
   donor, not a field value, so no change to the wave's neighbourhood can put a
   settlement on an empty continent (see §2 phase 1's correction). Restated as
   a **phase 2** bar: land on settlement-free landmasses must fall from 60%, and
   it must fall because a people invented or carried farming there, not because a
   bar was lowered. Reported per land component. Phase 1's own bar is item 4.
4. **Dark ages become visible.** Settlements that forget must produce a
   measurable fall in `devField` over the land they fed — the §1e table's second
   row must stop being all zeros.
5. **Technique differentiates.** The §1f agriculture spread (0.046) must widen.
   A world whose agriculture is uniform has no idea system regardless of how the
   code is arranged.
6. **The wrong-places finding improves without being targeted.** `probe_wheretowns`
   region occupancy at step 200/500/2000 — the steppe must stop leading the
   planet. If it only improves when a constant is tuned toward it, the phase has
   failed the second cardinal rule and must be reported as failed.
7. **Resolution arm** — `npm run resgate`, plus §1g re-run at `tw=480`.
8. **Standing gates** — `npm test`, `npm run validate`, `npm run coverage` (this
   adds state), `npm run monotone` (this adds metrics — and note that a
   *deliberately non-monotone* field is exactly the kind of thing that gate is
   built to argue with; the metric names must claim only what they can keep).

---

## 7. Risks — named before an implementer finds them

- **Phase 1 makes the world emptier, not fuller.** Removing the ratchet lowers
  `devField` everywhere it was holding a historic peak. Carrying capacity falls,
  population falls. This is *correct* if dark ages are real, and it will look
  like a regression on every population metric. It must be measured and reported
  as a change in kind, not tuned away.
- **The deflation coupling, again.** Every previous phase of this lane was
  blocked by the census/tier bars re-keying under a changed label supply. Phase 2
  changes label supply. The hearth doc's guard analysis applies unchanged and the
  tier-bar derivation is still owed.
- **Network diffusion may be resolution-variant in kind.** `DIFFUSE_COST_K`
  already carries an `rNormPop` correction and an open audit item (#5b, org
  0.84× at matched step). Moving the *field* onto the same network inherits that
  open problem and may amplify it. §1g and `resgate` are not optional here.
- **Phase 2 can empty the map.** Handout removal plus insufficient hearths is a
  world with no farming. The prerequisite on `MULTI_HEARTH` is stated as blocking
  for this reason.
- **Scope.** This design touches the layer under population, settlement, and
  politics simultaneously. Phase 1 is deliberately the smallest change that is
  still a mechanism repair; resist bundling.

---

## 8. Open questions

1. **The tier bar.** Still the blocker inherited from v4: a bar that is neither
   an absolute census floor nor a fixed rank quota. Nobody has derived it, and
   phases 2–3 both need it.
2. **Does an idea live on a PEOPLE or on a PLACE?** Phase 2 says people
   (`cultures.js` already carries ancestry and `admixArrivals`). The field then
   becomes strictly derived. This is the design's deepest commitment and the one
   most worth challenging before implementation.
3. **Do the six existing tracks survive as the idea classes**, or is the right
   decomposition different (a subsistence *package* rather than an "agriculture"
   scalar — wheat and maize are not the same idea and do not cross the same
   barriers)?
4. **Does the interior-pocket gap close?** ~47% of mature demand texture is
   diffuse rain-fed interior the drainage/coast skeleton does not host. If
   technique differentiation makes interior density emerge on its own, the
   ledger's honest limit may not need a band-limited worldgen contract after
   all. Speculative; measure before believing.

---

## IMPLEMENTATION ADDENDUM — phase 1 built and measured

`T.IDEA_FIELD`, default **0**, ships **off**. Three call sites: a
`rebuildDevSources` that zeroes and re-stamps into its own array
(`world._devSrc`), the fixed-point line in `relaxDevWave`, and the genesis
pre-run in `ensureDevField` so the eve-of-states initial condition obeys the
same law as every later firing.

**A confound caught in review, before the numbers were trusted.** The first cut
left `dev` at zero in the genesis pre-run and put the sources only in `_devSrc`,
so the lever's first relaxation pass was consumed re-deriving the sources and
the arm entered the world with a genesis field **one wave-step less spread than
the control** — an initial-condition difference masquerading as a law
difference. Fixed by seeding `dev` from the sources so both arms spend all
`iters` passes propagating. Re-measured: **every number below is unchanged**,
because 36 genesis passes is well past convergence for the settled area, so the
missing pass had nothing left to do. The fix is kept on correctness grounds and
is explicitly *not* claimed to have mattered.

### The gates (all at defaults, i.e. lever off)

| gate | result |
|---|---|
| **byte-identity off** | `5ffd7243` = `5ffd7243` at 3000 steps, `tw=480`, seed 8817 |
| `npm test` | pass (215.1s) + emblem pass |
| `npm run validate` | all hard gates passed, 1 soft warning (budget 2) |
| `npm run resgate` | all app-grid bands held (median realm 0.57 vs floor 0.42) |
| `npm run monotone` | ✓ no metric naming a cumulative history decreased |
| `npm run coverage` | ✓ 173/173 off-lever — **and 174/174 with the lever ON**, 119 perturbation-proved |

The coverage note matters and is the reason it was run twice: off-lever
`world._devSrc` is never allocated, so the default run passes **vacuously** for
the state this change adds. On-lever the gate sees it and proves it reaches a
metric, so it needs no `WORLD_SCRATCH` entry. A lever-gated allocation is a
blind spot in that gate's default arm; run it both ways whenever a lever adds
state.

### The measurement — the land forgets (480/8817, `tw=240`, 12k)

```
                          off        on
devField tiles that FELL
  step  1000                0        93
  step  2000                0       471
  step  6000                0        76
  step 12000                0         1
settlements that FORGOT     8/42     8/43     (unchanged — the CAUSE was always firing)
farming land @ 1000      19.7%     17.3%
farming land @ 2000      24.3%     23.3%
farming land @12k        37.5%     37.4%
```

Acceptance item 4 is met: the second row stops being all zeros. Note *what*
changed — the settlements were always forgetting at the same rate; only the land
now hears about it. The early world is systematically leaner (−2.4 points of
farmed land at step 1000), and the effect shrinks as the world matures, which is
the right shape: a mature dense network re-supplies technique faster than it
recedes.

### The §7 prediction was NOT confirmed — and the contradicting number was noise
*(written before the seed panel; kept as the reasoning, superseded by the A/B below)*

§7 predicted a leaner world. At `tw=240`/12k the run is **richer** — field pop
14.42M → 15.66M (+8.6%), census 16 099 → 17 701 (+9.9%), same 82 settlements,
30 realms vs 32.

I am **not** claiming that as an effect of the lever. The early checkpoints move
in the predicted direction and are mechanistically attributable; the 12k gap
appears after the run has already diverged in realm count, and this sim is
chaotic — `npm run spread` exists precisely because a finding of this size on a
single seed did not survive error bars once before. **Phase 1's population
effect is UNRESOLVED and needs the spread tool over seeds before anyone quotes a
number.** What is established is the mechanism: the land can now forget, at the
rate it learned.

### The resolution arm — same KIND, opposite TREND (`tw=480`, seed 8817, 6k)

The mechanism fires at the shipped grid: `FELL` is nonzero at every checkpoint,
so the land forgets on both grids. But the two grids disagree about **where in
the run the effect lives**, and that is the finding:

```
farmed-land reduction (off → on, percentage points)
  step         tw=240        tw=480
   1000        −2.4 pt       −0.3 pt
   2000        −1.0 pt       −1.5 pt
   6000        −0.9 pt       −1.8 pt

devField tiles that FELL, as a fraction of land
   1000         0.97%         0.60%
   2000         4.90%         1.88%
   6000         0.79%         0.65%
```

**At the reference grid the effect peaks early and fades; at the shipped grid it
starts small and grows.** A reader of the `tw=240` arm alone would conclude "an
early-game correction that the mature world absorbs" — and would be wrong about
the world that ships, where at 6k it is still widening. This is the third
cardinal rule's exact hazard, caught by running the arm rather than assuming the
reference grid generalises.

Two supporting readings at `tw=480`: population is **unchanged** (0.80/0.80,
1.13/1.12, 3.06/3.05 M field units — under 0.5% at every checkpoint) and realm
count is identical in both arms (4, 4, 17). Settlements run consistently 2 lower
with the lever on (41→40, 52→50, 74→72).

That population reading matters for the §7 question: the +8.6% at `tw=240`/12k
does **not** reproduce at the shipped grid through 6k, which is further evidence
it is divergence noise rather than a lever effect. The A/B below is the arbiter.

### The multi-seed A/B — ONE real effect, and the population claim is dead

`abtest --tune=IDEA_FIELD=1 --steps=12000 --seeds=8817,31337,4242,7777`
(provenance: commit `745a26a`). Of 109 matched metrics and 75 exceeding ±2%:

> **9 movers consistent across all 4 seeds; 66 mixed-direction.**

And **5 of those 9 are `field._devSrc.*` — the new array existing.** That is the
instrument appearing in the metric map, not a behavioural result. Discount them
and there are **four** consistent movers, which are four facets of one effect:

```
eventv.settlement.abandoned.step.sum    −44.4%   CONSISTENT
eventv.settlement.abandoned.step.mean   −33.1%   CONSISTENT
eventv.settlement.abandoned.step.max    −32.8%   CONSISTENT
eventv.settlement.abandoned.step.p90    −18.8%   CONSISTENT
```

These are the *step numbers at which abandonments happen*, so every one of them
falling means **settlements that fail, fail EARLIER**. That is mechanistically
exactly what the change should do: a settlement losing its technique base is no
longer propped up by a field holding its best-ever value, so it goes when its
support goes instead of lingering. The abandonment *count* moved −18.5% but
**mixed**, so only the timing is established, not the number.

**The population finding is refuted.** `pop.people` +10.0% and
`pop.largestCity` +27.7% appear in the headline — which is **seed 8817 alone** —
and neither survives the seed panel (`largestCity` scores explicitly `mixed`;
`pop.people` does not reach the consistent set at all). `realm.count` likewise:
32→30, 41→41, 28→32, 45→40 — down, flat, **up**, down. My §7 prediction of a
leaner mature world and the +8.6%/+9.9% reading that seemed to contradict it are
**both** noise from a single seed, exactly as the shipped-grid arm already
suggested.

What survives the panel, then, is narrow and honest: **the land forgets (direct
measurement, both grids), and settlements that fail now fail earlier (4 seeds).**
Everything else this lever appears to do is divergence.

---

## COMPACT VERDICT (foundation only — no law is flipped by this document)

The sim has two idea layers. The rich one (per-settlement knowledge: carriers,
route cost, climate, dark ages) does not govern density. The impoverished one
(`devField`: tile adjacency, land-only, monotone, one origin per cradle) does.
Invention itself has no gradient — free inside transport reach, impossible
outside it, with the boundary drawn by connectivity rather than by anything about
ideas. 60% of land sits at `devField ≡ 0.000` for twelve thousand steps — the
same 60% at both grids, because it is a topological fact about the land graph and
not a resolution artefact — and the one technique that sets carrying capacity is
the most uniform quantity in the world. At the grid that ships, a third of all
settlements learn from nobody during the founding wave that fixes the map.

That is a mechanism gap, not a tuning problem, and it sits upstream of all four
failed density designs. The law above is the proposal.

**Phase 1 is built, gated and shipped OFF.** What the evidence supports, stated
as narrowly as the measurements allow:

- the land can now forget, at the rate it learned — **direct measurement, both
  grids**;
- settlements that fail, fail **earlier** — **4-seed consistent**;
- the effect's trend **inverts between grids** (fades at the reference grid,
  grows at the shipped one), so the reference grid alone would have misdescribed
  it;
- everything else — population, realm count, largest city — is **divergence
  noise**, including a +8.6% population reading of my own that did not survive
  the panel.

Phases 2 and 3 remain proposals. Phase 2 is blocked on `MULTI_HEARTH`, whose
tier-bar blocker is now **resolved**: `docs/tier-bar-derivation.md` derives the
city bar as K towns' load (`T.TIER_BRANCH`, Christaller K, default off) and
measures it — the hearth's label supply is kept exactly, the hierarchy survives
with no floor at any K in the band, and the baseline floor turns out to have
been suppressing dawn-era city-states (early statelessness 93% → 39% at step
2000 with the honest bar). **FLIPPED 2026-08-03**: `MULTI_HEARTH`, `TIER_BRANCH` and `BRIDGE_GLOBAL`
are the defaults — the batteries passed (stylized all-hard-gates, resgate
green at 0.70, better than the old defaults' 0.59). Phase 2 is now genuinely
unblocked: agriculture has multiple origins by default, so removing the
free `NEOLITHIC_AGRI` handout no longer empties the planet by construction.

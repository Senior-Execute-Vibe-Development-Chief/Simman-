# THE DERIVED CITY BAR — a city carries K towns' load

The open item two designs are blocked on, recorded in both:
`docs/design-c-hearth-field.md` ("the honest next step is to *derive* a tier
bar that is neither an absolute census floor nor a fixed rank quota, not to
re-anchor either one") and `docs/design-idea-field.md` (phase 2 needs
`MULTI_HEARTH`, which needs this).

Everything at `480/8817` (sim `tw=240`) unless stated; lever `T.TIER_BRANCH`,
default **0**, byte-identical off.

---

## 0. The two failures being replaced, named precisely

The city bar (tier 2) is load-bearing far beyond labels: province-seat
eligibility, secession/successor candidacy (`conquest.js:1083-1088`,
`CITY_TIER = 2`), `hasCity`, army fractions (`ARMY_TIER_FRAC`), food-haul
ranges, the Zipf/urbanisation stylized facts. Its two shipped forms:

1. **Off-lever: `max(240, P85)`.** The floor is, by its own comment, "a
   documented measured-floor shortcut… not first-principles census minima" — a
   number from a retired scale, priced in **catchment census** units. A census
   is a *partition* of the field people among the labels that exist, so raising
   label supply deflates every label's share: measured p50 69 → 44 going 78 →
   139 labels, at which point the floor binds and pins the world to tier 0/1 —
   the urban hierarchy collapses.
2. **Under `MULTI_HEARTH`'s deflation guard: pure P85.** A fixed **rank
   quota**: it mints 15% "cities" in *any* size distribution, including a flat
   lattice of equal villages. Measured consequence (hearth doc, arm 6+): the
   guard turned a quiet 57-realm world into **105 realms with 150× the polity
   turnover**, because more "cities" means more province seats means more
   secession candidates.

Both failures have the same root: the bar answers "how big must a settlement be
to be a city?" with a number about **counts** (an anchor from one world's
scale, or a fixed share), when the sim's own comment states the mechanism as a
statement about **structure**: *"each city serves ~3-5 towns (the Christaller
branching band)."*

## 1. The derivation

Take the code's own sentence seriously. In central-place theory a city is not
"the biggest 15%" — it is a place carrying the **higher-order functions of K
lower-order places**: its own town-catchment plus the next-order demand of the
~K−1 towns it serves. In catchment-census units that is:

    cityBar = K × (the typical town's census) = K × median(settled census)

Three properties, each the exact negation of one failure:

- **Not an absolute floor.** The bar moves with the world's own census scale.
  Label-supply deflation (more labels partitioning the same field people)
  lowers the median and the bar *together* — the hierarchy survives any label
  supply by construction, with no guard needed.
- **Not a rank quota.** The share of settlements above K×median is a property
  of the size distribution's **tail** — an *output*. A Zipf-tailed world puts a
  few percent of settlements over 4× median (the historical register); a flat
  world of equal villages puts **zero** — a lattice of hamlets has no cities,
  which the quota gets wrong in every world it touches.
- **K means something without reference to any count it yields.** It is the
  Christaller branching band (3-5; 4 is the middle), a statement about market
  geometry — how many lower-order places one higher-order place serves. The
  metro bar is *already this species* (`max(900, 0.8 × the age's largest)`:
  "one of the handful of biggest cities of the age") — the derivation brings
  the city bar into the same family rather than inventing a new one.

The **town bar** needs no derivation under `DISSOLVE_FARMS` (default): every
settlement *is* at least a town (`updateTier` floors tier to 1), town-founding
is priced by the act bars in **field people** (`TOWN_FOUND_MIN = 90` — a
per-community quantum that does not partition), and `_townBar` gates no
promotion. It becomes the pure median — "the typical town", a reference that
probes and the UI read, not a gate.

The **demotion hysteresis** (`TIER_DEMOTE_FRAC = 0.8`) and the **metro bar**
are untouched.

## 2. The law — `T.TIER_BRANCH` (default 0, byte-identical off)

`settlement.js updateTier`, inside the percentile arm:

```js
if (T.TIER_BRANCH > 0) {
  const med = pAt(0.50);
  world._townBar = med;
  world._cityBar = T.TIER_BRANCH * med;
} else { …the shipped expressions verbatim… }
```

The lever's value IS K. It composes with `MULTI_HEARTH` (whose pure-percentile
guard it supersedes when on) and stands alone. One line of mechanism; the rest
of this document is the measurement.

## 3. Cardinal-rule audit

- **First rule:** the bar reads the live census distribution — never the step,
  year, or era.
- **Second rule:** no case is detected, no outcome named. K = 4 must be
  defended as geometry (the 3-5 band), *never* tuned to land a city count — if
  the honest K yields a city share that surprises, that is a finding about the
  size distribution, and the sensitivity across K ∈ {3,4,5} is reported below
  rather than optimized. The quantity to watch: if a future session moves K to
  chase a realm count, that is the exact violation this document replaces.
- **Third rule:** the bar is a ratio of same-units quantities (census/census),
  so no `/r2` conversion enters; the resolution arm below still runs, because
  tier *consumers* (province seats → secession) are exactly where `b859db7`
  failed across grids.

## 4. MEASURED — the four arms (12k steps, seed 8817, `tw=240`)

Success bars were stated before the numbers (see the commit that added this
file). The event counts are the chronicle's window, comparable across arms.

| arm @12k | levers | labels | t2/t3 | realms | stateless | founded/receded | submitted | wars | p50 | cityBar |
|---|---|---|---|---|---|---|---|---|---|---|
| A baseline | none | 82 | 13/1 | 32 | 30 (37%) | 28/20 | 6 | 69 | 105.3 | 352.8 |
| B guard | `MULTI_HEARTH` | 132 | 17/3 | 88 | 18 (14%) | 22/27 | 41 | 168 | 147.5 | 423.9 |
| C derived | `MULTI_HEARTH, K=4` | 133 | 17/3 | 75 | 33 (25%) | 30/35 | 25 | 138 | 124.7 | 498.5 |
| D derived alone | `K=4` | 82 | 5/1 | 51 | 10 (12%) | 17/38 | 23 | 117 | 156.5 | 627.4 |

And the mid-run trajectories, where the real differences live:

```
t2 cities   @2000   @6000   @12000        cityBar   @2000   @6000
A (floors)      0       3       13        A          240*     240*     * = floor binding
B (P85)        14      19       17        B         81.6    204.5
C (K=4)        13       7       17        C         97.6    307.1
D (K=4)         9       2        5        D         88.3    258.0
```

### Bars 1-2: MET

- **C keeps B's label supply exactly** — 132 → 133 labels; the hearth
  mechanism is undisturbed.
- **C's hierarchy survives with no floor** — t2=17, t3=3 (12.8% cities), the
  same top structure as B, reached without a quota.

### Bar 3: PARTIALLY MET, and the target was softer than the doc assumed

C vs B: realms 88 → 75 (−15%), wars 168 → 138, submissions 41 → 25 — the
political temperature cools — but windowed founding/receding rises (22/27 →
30/35). And **B itself did not reproduce the 105-realm / 150× explosion**: that
number was measured on the full C1 stack (`LABEL_BIRTH` + `MULTI_HEARTH`); on
`MULTI_HEARTH` alone the guard gives 88 realms. Most of the realm inflation
over baseline is the hearths *themselves* — five continents legitimately
minting states — not the tier guard. The derivation still improves on the
quota, but the emergency it was framed against is smaller on this config than
the hearth doc's arm suggested.

### Bar 4: **FAILED as stated — and the failure is the most important finding**

K=4 alone was predicted to move little. It moved a lot, and in the opposite
direction from the naive reading of the 12k bars: realms 32 → 51, stateless
share 37% → **12%**, receded 20 → 38, wars 69 → 117.

The cause is at the DAWN, not at maturity. At step 2000 the baseline's floor
(240) binds and the world has **zero cities** — the floor forbids any city
until some catchment holds ~240k people, regardless of structure. The derived
bar reads 88.3 (4 × the dawn median) and finds **nine city-states already
standing**. Those early cities are province seats; seats project territory;
borders actually reach the stateless countryside — and the early world governs
itself: **stateless share at step 2000 falls from 93% (A) to 39% (D)**.

Two things follow, and they must be said plainly:

1. **The floor was not an inert shortcut — it was suppressing the urban
   revolution.** "No city below census 240" is an absolute number from a
   retired scale enforcing "no cities until the world is big", which is a scale
   anachronism: the first cities were dawn-era, small in absolute terms and
   dominant relative to their lattice (Uruk). The derived bar recovers exactly
   that reading, and the extra polity churn (receded 38 vs 20) is successor
   dynamics arriving with the early state system rather than being deferred.
2. **This connects to the state-birth finding from the other side.**
   `docs/state-birth-2026-08.md` measured 90%+ of the early world stateless and
   diagnosed the org gate. This arm shows the CITY-TIER channel binds too: give
   the dawn its honest city-states and early statelessness collapses without
   touching a single founding bar.

Whether 51 realms and 117 wars is a *better* history than 32 and 69 is a
product judgement — but the stylized-history gates, not this doc, are the
arbiter of "history-shaped", and the K-alone arm must pass them before any
default flip. What is settled here: the bar's effect is real, mechanistic, and
in the direction of the owner's standing complaint (the ungoverned early
world), not an artefact.

### Bar 5: K sensitivity (`MULTI_HEARTH` + K ∈ {3,4,5}, @12k)

| K | labels | t2 (share) | t3 | realms | wars | submitted | cityBar | p85/p50 |
|---|---|---|---|---|---|---|---|---|
| 3 | 135 | 28 (20.7%) | 3 | 83 | 158 | 40 | 406 | 3.10 |
| **4** | 133 | 17 (12.8%) | 3 | 75 | 138 | 25 | 498 | — |
| 5 | 129 | 8 (6.2%) | 3 | 71 | 139 | 25 | 671 | 3.40 |
| B (P85) | 132 | 17 (12.9%) | 3 | 88 | 168 | 41 | 424 | 2.87 |

What rides on K and what does not, stated plainly:

- **Structure does not.** Label supply (129-135), the metro tier (3 at every
  K), hierarchy survival, and the dawn city-states hold across the band — the
  derivation's claims are K-invariant.
- **The city COUNT does, strongly** — roughly halving per +1 K (28 → 17 → 8),
  because the bar walks a thinning tail. Choosing K inside the 3-5 band is
  choosing a city share between ~6% and ~21%. That is an honest limit of the
  derivation, not a refutation: K is a real geometric constant whose true value
  the sim cannot measure yet (it would need the trade graph's actual branching
  factor — see §6), and within the band every choice yields a working
  hierarchy.
- **The political cooling saturates at K=4.** K=3 reproduces nearly the quota
  world (its bar, 406, sits next to P85's 424 — the Zipf coincidence again);
  K=4 and K=5 both give the calmer politics (75/71 realms, ~138 wars, 25
  submissions). K=4 — the band's middle, double-digit cities, cooled politics —
  is the default this document recommends, chosen for geometry and *reported*
  for its effects, not tuned to them.
- The mature p85/p50 sits at 2.9-3.4 in **every** arm: the emergent size
  distribution is robustly Zipf-band regardless of the bar that reads it, which
  is the cross-check's premise measured rather than assumed.

## 5b. THE FLIP BATTERY (owner-requested, 2026-08-03) — stylized PASS, resgate FAIL, attributed

### Stylized (`MULTI_HEARTH=1, TIER_BRANCH=4`, 21k, full battery): **all hard gates pass**, 1 soft warning (budget 2)

The flip config's history is history-shaped by every stylized measure, and
three readings are better than the default world's:

- **Polity death exists**: 58 fallen realms, median lifespan 7050 steps
  (~1763y) — in the sim whose founding complaint was the static top.
- **War intensity per polity is unchanged** (0.25/1k vs 0.22) — the higher raw
  war counts in the §4 arms were more actors, not a hotter world.
- **Knowledge radiates**: tech ~ cradle-distance −0.70 vs −0.15 at defaults —
  the hearth geometry visible in a gate that was nearly flat.

Also: 78 polities, largest empire 6% share, urbanisation 4.7% (in band),
159 settlements / 61k pop at 21k.

### Resgate: **FAIL — and the driver is THIS lever, isolated**

| claimed-land band | ref | app | app/ref (floor 0.44) |
|---|---|---|---|
| defaults | 3.83% | 2.27% | 0.59 ✓ |
| `MULTI_HEARTH` alone | 8.36% | 4.30% | 0.51 ✓ |
| **`TIER_BRANCH` alone** | 6.35% | 2.46% | **0.39 ✗** |
| combined | 7.06% | 2.97% | **0.42 ✗** |

`TIER_BRANCH` alone raises reference-grid claiming +66% and shipped-grid
claiming +8% — the dawn city-state effect (§4 bar 4) fires at the calibration
grid and barely at the one that ships. Realms: ref 14 → 45, app 17 → 20.

### The mechanism — my first account is REFUTED by its own owed measurement

The previous revision of this section claimed: the tail is thinner at the
shipped grid (the 1-D capacity-dilution gap), `K × median` reads the
tail-to-median ratio, therefore fewer dawn cities at the app grid. The
confirming measurement was owed, and it came back the other way:

```
6k, defaults:   tw=240   p85/p50 = 2.56   p95/p50 = 3.53   max/p50 = 9.58
                tw=480   p85/p50 = 3.14   p95/p50 = 5.20   max/p50 = 7.87
```

**The shipped grid's tail is FATTER at 6k, not thinner.** At that ratio,
K=4×median sits at a *lower* effective quantile on the app grid — the bar
should mint relatively *more* cities there, not fewer. The tail story cannot
explain the claiming asymmetry, and it is retracted.

What survives, because it is directly measured, not inferred:

- **The FAIL and its attribution** — `TIER_BRANCH` alone: ref claiming +66%,
  app +8%; the isolation table above is the fact the mechanism must explain.
- **The quota-blindness observation** — P85 *is* rescale-invariant and
  `K×median` *does* read distribution shape; that is arithmetic. What is
  refuted is the claim that the shape difference runs in the direction that
  explains the failure.

Open hypotheses, in testable order: (a) the **dawn** tail (step ~2000, where
the city-state divergence originates) may differ from the 6k tail — measured
next, appended below; (b) the asymmetry may live **downstream** of tier
entirely, in the seat → territory-projection machinery (per-seat claimed area
across grids), in which case the bar is innocent and the projection layer
carries the resolution leak; (c) realm-count amplification (ref 14→45 vs app
17→20) may come through a channel other than city seats — nucleation or
secession gates whose inputs scale differently. Until one of these is pinned,
the resgate FAIL is **attributed but unexplained**.

### Verdict

- The **unblock stands**: the bar survives any label supply, the hierarchy
  needs no floor, and `MULTI_HEARTH`'s history passes the stylized battery
  with the derived bar in place.
- The **flip waits**: no default flip while the resgate ratchet is red — the
  bands are "never a target to tune toward", and softening K to pass would be
  the exact violation §3 forbids. The blocking item is the claiming asymmetry
  above: attributed to this lever's presence, mechanism still open (the census
  tail was measured and cleared — see the retraction).
- Both levers ship **off**, unchanged.

## 6. What would make K a measurement (the honest next rung)

K=4 is a constant standing in for a quantity the sim already computes: the
food/trade hierarchy's actual branching factor — how many settlements route
their higher-order demand through each higher-order node (`foodHierarchy`,
`mergeReach`). Deriving tier from the *service graph itself* (a settlement's
tier = its height in that tree) would delete K entirely and make the city
count a pure output. That is a bigger rework touching the food economy, and it
is the right successor to this lever, not a reason to delay it: the lever
unblocks `MULTI_HEARTH` today and the graph derivation replaces K when built.

### The Zipf cross-check (why quota and derivation agree at maturity)

Baseline @12k: p85/p50 = 3.35 — inside the Christaller 3-5 band. In a
rank-size (Zipf) world, "4 × median" ≡ roughly "top ~12.5%", so K×median and
P85 *coincide wherever the tail is actually Zipf* — which is why B and C agree
almost everywhere (their cityBars run within ~20% and their t2 counts converge
to the same 17/3). The three-way divergence is against the FLOOR: at the dawn
the floor forbids all cities (A: 0 at step 2000) while both scale-honest bars
find the early city-states (B: 14, C: 13, D: 9); in the deflated world the
floor pins everything to tier 0/1 while both survive. The derivation's edge
over the quota is not the mature counts — it is that its city share is a
*measurement* (zero in a flat lattice, where the quota would still mint 15%),
and that its constant means something. The quota happens to be right when the
world happens to be Zipf; the derivation is right because of what a city is.

## 5. Risks

- **The tail may be thinner than Zipf early.** If no settlement reaches
  4×median for millennia, province-seat formation waits on real primacy —
  historically defensible, but it changes successor-state cadence; measure
  `event.polity.*` at the dawn checkpoints, not just at 12k.
- **Median flicker.** The median of a small settled set moves in steps; the
  0.8 demotion hysteresis absorbs it (same protection the percentile bars
  needed), but tier *event* volume is the metric to watch.
- **Consumers priced for rare cities.** If K×median yields materially more
  cities than max(240,P85) in some regime, the province-seat economy inflates
  — that is arm C/D's `founded/receded` row, and the fix if it fires is NOT a
  bigger K but a look at which consumer's own bar is mis-priced.

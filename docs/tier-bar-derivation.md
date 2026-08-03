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

### Bar 5: K sensitivity — pending, appended below.

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

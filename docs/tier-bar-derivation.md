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

*(appended as the arms land; the derivation is not shippable until filled)*

| arm | levers | labels | t2 cities | realms | polity founded/receded | cityBar |
|---|---|---|---|---|---|---|
| A baseline | none | | | | | |
| B guard | `MULTI_HEARTH=1` | | | | | |
| C derived | `MULTI_HEARTH=1, TIER_BRANCH=4` | | | | | |
| D derived alone | `TIER_BRANCH=4` | | | | | |

Success bars, stated before the numbers:

1. **C keeps B's label supply** (the hearth mechanism must not be disturbed:
   ~139 labels, 5 components).
2. **C's hierarchy survives** — t2 > 0 and the city share lands in a
   central-place-plausible band (a few percent to ~15%), *without* any floor.
3. **C's polity turnover comes down from B's explosion** toward A's order —
   the 105-realm / 150×-turnover failure must not reproduce.
4. **D at defaults moves little** — the derived bar should approximate the
   shipped effective bar in the un-deflated world (K×median ≈ max(240, P85)
   there), so flipping K alone is a refinement, not an upheaval.
5. K ∈ {3,4,5} sensitivity reported; the conclusion must not ride on the
   choice.

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

# Budget-gated expansion — prototypes & measured negatives (2026-07)

User question behind this: *"How can realms GET overextended? Surely the budget
is critical when expanding — can I actually govern this area?"* This doc records
the mechanism audit, two prototype answers, and the measurements that rejected
their first designs — so the next attempt starts from evidence. All numbers:
480×240, seed 8817, 6 000 steps, harness pipeline, `polity.ended` cumulative.

## Where "can I govern this?" already lives — and where it doesn't

- **Territory growth is already capacity-priced** under the shipped model
  (`TILE_POLITY=1`): the reactive growth target is `max(floor, FIELD_SPAN ×
  capacity)` (countryTerritory.js — the capital-anchored path near the
  `else if (T.TILE_POLITY)` branch). When capacity crashes (war duress, siege,
  insolvency, momentum decay — conquest.js), the *target* crashes; that IS the
  dramatic shrink, by design.
- **Member acquisition is not load-priced anywhere.** adoptAndFound gates on
  ORGANISATION (statecraft symmetry) but never on the load/capacity ratio;
  conquest banks momentum instead (deliberate overshoot-and-shatter); member
  population growth raises load with no acquisition at all.
- The legacy cost-Voronoi budget loop (`COUNTRY_REACH_BASE/ORG`, size gates,
  BUDGET_RAMP) is **not the active authoring path** at defaults — reach edits
  there are dead code under TILE_POLITY=1. (Learned the slow way; see below.)

## Prototypes (kept, DEFAULT-OFF levers)

- `ADOPT_BUDGET` (def 0 = off): a court whose persisted strain
  (`gov._strain = load ÷ capacity`, stamped each polity pass — new telemetry,
  survives save/load) is ≥ the lever refuses NEW stateless subjects; refused
  communities stay independent (primary-state fuel). Conquest untouched.
- `REACH_STRAIN` (def 0 = off): legacy-path reach contraction ∝ strain.
  Inert at defaults (dead path) — kept only for A/B against `TILE_POLITY=0`.

## Measurements

Baseline (defaults, both levers 0) vs ADOPT_BUDGET=1 (the gate active):

| step | baseline: maxClaim / median / realms / ended | gated: maxClaim / median / realms / ended |
|---|---|---|
| 1000 | 324 / 43 / 24 / 3 | 302 / 52 / 26 / 2 |
| 1500 | 297 / 42 / 25 / 5 | **392** / 66 / 23 / 5 |
| 4000 | 185 / 28 / 41 / 6 | **86** / 20 / 50 / 8 |
| 6000 | 168 / 28 / 45 / 7 | 130 / 31 / 46 / **18** |

**The gate made the cycle worse**: a higher, later peak; a far deeper bust;
2.6× the polity deaths. Verified twice (REACH_STRAIN 0.6 and 0 produce
byte-identical runs → the entire delta is the adoption gate).

## Why (failure analysis)

1. **Refusing subjects refuses their taxes.** New members are revenue; a
   strained realm barred from absorbing productive communities is starved of
   exactly the income that would lift its solvency → fiscal-duress spiral →
   more deaths, deeper busts. Historically resonant (empires absorbed to pay
   for themselves) — and the reason a bare load-threshold refusal is the wrong
   mechanism.
2. **Freed land is a commons.** Whoever is *within* budget expands into what
   the strained majority cannot take — inequality of claims grows, the biggest
   blob peaks higher (392 > 324) before its own correction.
3. **Two controllers, one plant.** Strain-fed reach on top of the existing
   loyalty-shed correction (and, at defaults, on top of the capacity-priced
   growth target) oscillates — the classic over-tuned-knot the second cardinal
   rule warns about.

## What the next design must account for

- Price acquisition by **marginal revenue vs marginal load** — a court takes a
  subject whose expected tax yield covers its admin cost (distance, size,
  tongue), refuses one that doesn't. That's a real mechanism with independent
  meaning, not a threshold; it naturally lets rich near provinces in and
  refuses poor far ones, at any strain.
- Feed load into the **reactive growth target** (the TILE_POLITY site), not the
  legacy budget — and *instead of*, not on top of, one of the existing
  corrections.
- Validate as a campaign: this probe's cycle metrics + the stylized-facts
  gates (fallen-polity lifespans, empire tails, war rates) at 480 AND the
  shipped width — empire size is resolution-sensitive.

## Addendum: "remove the crystallisation wave and the core regions?"

Asked and answered with the levers we already have:

- **The core-region floor is already replaced** (SIZE_BY_POP=1, the 2026-07
  flip): extent is population-earned, coverage rises with development. Every
  pulse measurement above ran under that model — the pulse survives, because
  the birth grant is now the (real) 3000-BC initial population being BOOKED
  into org≈0.25 states, not a scripted hinterland. Removing "core regions"
  further = removing the world's people, i.e. the premise.
- **The crystallisation wave is emergent, not scripted** — the condensation of
  that initial population wherever density × fertility crosses threshold. It
  is a wave only because the cold start places every fertile valley NEAR the
  threshold at t0. De-synchronising it means initial conditions deeper in
  prehistory (a thinner, growing scatter), so valleys cross on their own
  clocks and the dawn rolls instead of pulsing. That re-anchors every
  downstream calibration (stylized gates run 15k steps from the current
  genesis) — full-campaign scope. Reality check: the real Holocene dawn was
  itself compressed (~1.5 millennia for all cradles); the sim compresses it
  ~10× further.
- **Ranked fixes**: (1) marginal-revenue adoption (above) — stops infants
  booking countryside they cannot afford; most contained. (2) deep-prehistory
  genesis — fixes universality. Together: a rolling dawn of small states,
  each overreaching and correcting on its own clock.

## Round 2 (2026-07): the two ranked fixes, built and measured

Both mechanisms were implemented and measured on the same pipeline
(480×240, seed 8817, 6 000 steps, defaults byte-identical to the baseline
above — re-verified checkpoint-for-checkpoint before the arms ran).

- **`FISC_ADOPT` (the fisc test, entities.js `fiscAdoptable`)** — the
  corrected marginal-revenue mechanism: a stateless community is adopted
  (crystallise born-join, adoptAndFound anchor + village branches) only if
  the capacity its people bring — the realm's own `_capacity ÷ Σ member
  people`, both stamped by the polity pass — covers `FISC_ADOPT ×` the
  admin load of governing it (the polity pass's own ruler: distance ÷
  holdRange × the SIZE_REF size term, at steady state). Emergent on both
  sides, per-subject (no global freeze — the ADOPT_BUDGET failure), exempts
  conquest / border shifts / colonies / member-region town spin-offs.
  Decision surface unit-checked: the measured 4-person, load-5.27 hamlet is
  refused; a newborn beside the capital, and every productive town, adopts.
- **`DAWN` (the long dawn, popField.js)** — deep-prehistory genesis as an
  initial condition: the genesis field seeds at `DAWN ×` its Malthusian
  equilibrium (residence-graded as before), and the census↔field bridge is
  calibrated at the EQUILIBRIUM reference (without that, mature census
  inflates by 1/DAWN and the staggering cancels out of the nucleation mass
  — found in design review, fixed before first run). Basins then cross the
  absolute state-viability bars on clocks set by their own richness.

| arm | peak (step) | trough | deaths @6k | realms @6k | ramp to ~22 realms | settled @6k |
|---|---|---|---|---|---|---|
| baseline            | 324 (1000) | 168        | 7  | 45 | 2 windows (250→1000)   | 75 |
| FISC=1              | 279 (1000) | **65** (4750) | 10 | 54 | 2 windows              | 69 |
| DAWN=0.35           | 302 (1750) | 197        | **4** (0 thru 1500) | 43 | **5+ windows (250→1500)** | 77 |
| FISC=1 + DAWN=0.35  | 264 (1000) | 99         | 10 | 54 | 5+ windows             | 75 |

**DAWN=0.35 is the genesis-pulse fix.** The dawn rolls (realm ramp
3→9→15→20→26 across 1250 steps), the early die-off disappears (0 deaths
through step 1500 vs 5; 4 by 6k vs 7; 0 abandonments vs 2), the median
realm runs ~25% larger through the peak era, the correction is a gentle
−33% deflation instead of the −48% mass shatter — and the world converges
to the same size by 6k (77 settled vs 75, 43 realms vs 45). Default
flipped to 0.35 (≈ the 3000 BC condition: a third of the agrarian ceiling
carried, most of the filling still ahead).

**FISC_ADOPT is a measured negative at every dose — the honest surprise.**
Alone at 1.0 it trims the early peak modestly but correlates with a deeper
mid-late deflation (trough 65 vs 168) and more deaths (10 vs 7); stacked
on the dawn it suppresses exactly the consolidation the dawn enables (max
110 vs 209, median 20 vs 32, deaths 10 vs 4). Halving it (0.5 + dawn)
reproduces the same signature, merely later: a fragmentation wave at
~3000-3500 (realms 25→51 in 1000 steps), max 74 / median 21 / 63 realms /
8 deaths at 6k. Monotonic dose-response, so this is the mechanism, not the
tuning. Reading: in this sim's fiscal loop CAPACITY COMES FROM SUBJECTS
(capacity-per-person is roughly flat at early development), so *any*
adoption-refusal — global (ADOPT_BUDGET) or marginal (this) — starves the
mid-game hinterland absorption that funds the next ring of consolidation;
the failure analysis above ("empires absorbed to pay for themselves")
applies to the marginal form too. Meanwhile the dawn removes the birth-
grant pathology on its own: infants born into a 35%-full world have
little countryside to over-book. Default stays 0; the lever, the shared
`fiscAdoptable` helper and its verified decision surface stay in the tree
for future re-pricing work (e.g. capacity-formation lag, where a subject's
capacity contribution arrives slower than its load).

**Shipped defaults from this round: `DAWN=0.35`, `FISC_ADOPT=0`,
`ADOPT_BUDGET=0`, `REACH_STRAIN=0`** — one mechanism fixed the cycle;
three levers document why the other three answers were wrong.

Gates at the shipped defaults: smoke fully green (determinism, zero
invariant violations, save/load hash identity, living civilization);
stylized 21k-step run all hard gates passed with the one pre-existing
soft Zipf warning (budget 2) — 80 polities, largest-empire share 5%,
fallen-lifespan median ~305y, wars 0.34/1k-steps/polity.

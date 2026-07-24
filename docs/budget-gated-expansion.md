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

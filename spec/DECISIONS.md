# v2 — Ratified owner decisions

A running log of design rulings for the v2 rebuild. Each entry is binding on
the spec suite unless a later entry supersedes it. Dates are ratification
dates; wording of the ruling is the owner's intent, not a paraphrase to be
lawyered.

## 2026-08-31 — Phase 1 charter round

1. **Identity: plausible alternate Earth.** The sim produces plausible
   alternate Earth histories, NOT a rerun of real history. This is the
   product's differentiator from other history sims. Reality is the
   statistical benchmark, never a script or rails.

2. **Exogenous forcings: stochastic from realistic hazard maps.** Volcanic
   winters, climate excursions etc. are drawn stochastically from
   real-hazard-calibrated distributions. An optional "historical forcing
   track" toggle (real eruptions at their real dates) is permitted —
   forcings are physics inputs, not behavior gates, so the toggle does not
   violate the emergence rule.

3. **Phase 1 timeline: end of the Younger Dryas → early modern.** The end
   is defined in development terms (ocean navigation, print, gunpowder,
   proto-state administration), never as a date. Industrial and speculative-
   future eras are later phases, planned for — Phase 1's ledgers must not
   architecturally preclude them (see the organic-energy seam in the
   economy spec).

4. **No player in Phase 1.** Phase 1 is the pure simulator: observe, zoom,
   inspect, share. Player agency is a later phase.

5. **Mechanism budget + reality calibration.** The mechanism-budget
   guardrail is accepted (few conserved-quantity mechanisms per vertical;
   every constant carries a unit and a citation). Additionally, owner
   directive: **ALL systems must be calibrated against the most realistic
   dataset we have — real life. Numbers must match real life; that is what
   we diagnose AGAINST.** Every subsystem ships with a reality table (the
   historical dataset and the statistics it must reproduce), and the
   validation suite diagnoses against those tables.

6. **Political ontology: no nation-state assumption.** Owner directive:
   v1 over-focused on collective "nations" as the unit. Historically,
   "countries" were not the staple — local lords, city-states, leagues,
   and cultural umbrellas ("Greece" over hundreds of poleis) were. v2's
   political model must be built with this in mind: political authority is
   modeled at the scale history actually had (centers, obligations,
   gradients of control), and the territorially exclusive modern state must
   be an emergent late outcome, not the built-in unit.

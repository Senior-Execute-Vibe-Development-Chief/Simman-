# 01 — The Constitution

The inviolable rules. R1–R3 are v1's cardinal rules, carried forward intact
(they were learned the hard way and re-proven repeatedly — research/02).
R4–R10 are new, each paid for by a documented v1 failure class. Everything
in every other spec bends before these.

## R1 — Everything emerges from state, never from time

No event, capability, transition, or behavior may gate on a point in time —
not ticks, not the calendar, not an "era" label. A thing happens because of
what the world has become, never because of when it is. The calendar and the
era label are read-only displays derived from emergent development.
Per-tick intervals for amortizing work are scheduling, not content gates —
they control how often code runs, never whether history may happen.
*Scar:* the two-clock trap — the calendar and development drift by
millennia; anything keyed to the clock fires in a world that isn't ready
(research/02 §1.13). *Extension learned in v1:* an absolute constant that
only discriminates early-vs-late is a time-gate by proxy (ABSORB_ORG_ERA) —
bars must discriminate capable-vs-not.

## R2 — Build the system, never fit the outcome

If a result is wrong, fix the mechanism that should have produced the right
one. Never a constant whose only meaning is "it makes the answer come out";
never code that detects the case you want and grants it the result; never a
patch on a symptom whose cause is upstream. A surprising-but-mechanistic
result beats a correct-but-fitted one — it is a finding about a missing
mechanism. *Scars:* the 260× productivity overlay, the fitted dominance
curve, the tier-capability ratchet, "four consecutive fixes reasoned from a
story rather than from a measurement" (research/01 §2, research/03 §4a).

## R3 — Measure at the grid that ships, at the regime that ships, at the horizon that matters

The same code can differ in KIND across resolutions (a 10% effect at the
reference grid was a 10× effect one grid finer — twice). Mechanisms get
validated at the shipped grid and the shipped configuration; a "no effect"
reading at a coarse grid is not evidence of no effect; ratios pass worlds
that are uniformly 10× wrong, so absolute quantities are gated too; and a
verdict read at one horizon is not a verdict (12 metrics moved at 25k steps,
3,844 at 50k). v2 tightens v1's version of this rule: **there is no
separate gate regime.** The measurement configuration IS the shipped
configuration; anything else re-opens the "validated in exactly the regime
where it does nothing" class (research/02 §2).

## R4 — One representation per quantity

Every quantity has exactly one authoritative representation; everything else
is a derived view, recomputed, never stored-and-reconciled. No unit bridges
between two live copies of the same thing; no grace timers and
reconciliation passes keeping duplicates from fighting. *Scar:* v1 carried
eight live dual representations (population twice, urban core three ways,
the political map in four layers, food in two books…) and most of its patch
tissue existed solely to referee them (research/04 §1.5).

## R5 — Conservation by construction

People, food (as mass and as energy), money, and any later conserved stock
each keep a world balance sheet with named sources and sinks. Dev builds
assert zero unexplained flux every N ticks and halt on violation. A flow
with no payer, or a stock that appears from nowhere, is a build error, not
a tuning problem. *Scar:* free roads, conjured starter granaries, the
founding-order queue draining the world; "a bid with no payee is an
accounting fiction" (research/01 §1.4–1.5).

## R6 — Calibrate against reality; diagnose against reality

Owner directive (DECISIONS 5): all systems are calibrated against the most
realistic dataset we have — real life. Every subsystem ships with a
**reality table** (08-validation): the historical dataset, the statistics it
must reproduce, and tolerances. Two modes: mechanism-level (the subsystem's
output distributions match its table) and ensemble-level (across seeds, real
Earth history looks like a typical draw from the sim's ensemble — inside
the envelope, not necessarily at its center). Every constant carries a unit
and a citation (09-constants-ledger); a constant you cannot cite is a
mechanism you haven't built.

## R7 — Earthness lives in data, never in mechanism

Real heightmaps, observed climate, wild-crop ranges, hearth pins, hazard
maps: legitimate inputs. `if (nile)`: never. A place-anchored correction is
tolerable only as a labeled data-stage patch over a diagnosed solver debt
(the earth_sim corrections), quarantined from procedural presets. Exogenous
physical forcings (eruptions, climate excursions) are inputs drawn from
real-hazard-calibrated distributions (DECISIONS 2) — the *response* is
always emergent.

## R8 — Simulate fields, render condensations

The simulation state is fields and a bounded register of condensed objects
(communities, centers, institutions) that earn entity-hood by crossing
salience bars and lose it by falling below them. Villages, individual
people, and minor lords are deterministic renderings of the fields — the
same seed and local history always materializes the same village with the
same names — never simulated objects. The map is a query on the sim, not
the sim itself. *Scar:* the settlement register as the source of the polity
mill, and every register-count pathology (research/02 §1.1–1.2, §1.7).

## R9 — A mechanism budget, enforced at the ledger

Realism comes from the interaction of few conserved-quantity mechanisms,
not from per-vertical detail. The constants ledger is the enforcement
point: target order 100 constants for the whole Phase 1 sim (v1 reached 430
levers plus ~950 buried constants); every proposed constant must name its
unit, citation, and the mechanism it belongs to; a change that adds a
constant to patch an outcome is rejected under R2. Model-selection flags
keeping defeated alternatives alive do not exist in v2 — experiments live
in branches, and the losing side is deleted when the experiment concludes.

## R10 — The spec follows the evidence, at the depth of the evidence

Spec detail is graded by certainty (README depth rule). Findings update the
spec in the same change. Instruments are checked like findings ("the label
was checked and the expression was not" — research/02 §2); every
measurement names its seed, grid, regime, and horizon; distributions carry
their n; political metrics are windowed multi-seed means; and the control
is not the target — fixes are judged against reality tables, never against
the pathological world they replace.

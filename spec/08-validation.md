# 08 — Validation  `[FULL DETAIL]`

The suite exists before the sim does (M0). Three gate classes; one metric
collector; one measurement configuration — the shipped one (R3: no
gate-vs-live regime split, ever again).

## 8.1 Gate class A — mechanical integrity (hard, every commit)

Adopted from v1's proven harness (research/05 §4):

- **Determinism**: same seed twice → identical world hash + stats.
- **Save/load/continue**: load hash == save hash; continuation stays within
  drift bands; warm-up rollback keeps save→load→save byte-identical.
- **Conservation audits** (R5): people/food/energy/money balance sheets —
  zero unexplained flux. New in v2, hard from M2.
- **Invariants**: finite fields, sane ranges, no negative stocks.
- **Cross-grid**: dev-grid vs target-grid parity on real-unit aggregates
  (Σ capacity, Σ people per km², realm-area absolutes when they exist) —
  v1's resgate charter: a ratchet, re-baselined downward on improvement,
  floors never derived in the same change as a regime shift.
- **Monotone**: names that claim history never decrease (ported).
- **Coverage**: perturbation-reachability of all state from the collector,
  fail-open exclusions, self-testing canary (ported).

## 8.2 Gate class B — reality tables (the shape gates)

Every subsystem's table (in its spec chapter; union here) is checked at
**matched development, never matched wall-clock**, as **windowed multi-seed
means** with n reported, soft-warning budget semantics as in v1. Two modes:

- **Mechanism-level**: the subsystem's output distributions sit in its
  table's bands (03 travel times; 04 population/famine/yields; 05 polity
  sizes/lifespans/extraction; 06 city sizes/hauls/prices; 07 identity
  structure; 11 technique sequences/diffusion; 13 armies/sieges/war
  sizes; 14 colonial patterns; 15 the agro-pastoral frontier; 16 disease
  thresholds/mortality/spread).
- **Ensemble-level** (the alternate-Earth criterion, R6): across N seeds,
  real history's statistics sit inside the ensemble envelope — empire-size
  trajectories (Taagepera), population curve (HYDE), first-city/state
  timing and geography, urbanization by development. Real Earth should
  read as a typical draw, not an outlier and not the mean.

**The dataset shelf** (`v2/data/reality/`, licensing recorded per source;
NC-licensed sources kept as derived aggregate tables): HYDE 3.x,
McEvedy & Jones, Taagepera empire areas, Seshat (polity variables,
administrative levels), Chandler/Modelski cities, ORBIS-derived travel
times, Brecke conflict catalog, Richardson war-size statistics, the
yield/famine literature bands v1 validated, and the v1 evidence dossiers
(research/01 §3) as the curated citation set.

## 8.3 Gate class C — pathology regressions and play-experience gates

The class v1 lacked until late. Two sources:

- **The pathology catalog** (research/02 §1) becomes a standing regression
  suite: each named pathology's *detection signature* runs as a check —
  the polity mill (realms-through-a-cradle, register turnover, anchor
  deaths), zero-margin packing (mean size ÷ viability bar), confetti
  (born-inside-joins %, singleton share), hollow husk (claims ÷ worked),
  synchronized dawn (org spread, formation batch sizes), identity collapse
  (top-1 shares), immortal giants (mortality gradient, #1 churn), war
  flicker (declarations vs concurrent wars), floor-mode pinning (share of
  register at any floor), two-clock (no mechanic reads the calendar —
  enforced by lint), **personality collapse** (all mature realms
  converging on one style — DECISIONS 15d), and the rest. Plus
  required-outcome gates: **mass-migration cascades** (Sea Peoples /
  Völkerwanderung-class domino folk-movements must occur in the ensemble
  — DECISIONS 17e), hordes beside rich settled belts (15), diaspora
  networks along high-value routes (17b). Thresholds start at v1's measured
  broken/healthy values and are re-derived, blind, per v1's discipline.
- **Play-experience gates**: the owner's recurring reports encoded as
  standing measurements at the shipped grid on the drawn map — median
  realm size, register-vs-history by age, urbanization band, importShare
  liveliness, top-1-of-belt recurrence, regional first-state ordering,
  spatial spread of civilization. Plus the standing rule: every milestone
  is watchable, because eyes on the map out-diagnosed probes every time.

## 8.4 Methodology laws (binding on all measurement)

From research/02 §2, the paid-for lessons: instruments are findings and
get checked (open the expression, not the label); every output is
self-identifying (seed, grid, config diff, horizon, git provenance);
single-seed political comparisons are noise — windowed multi-seed means
with chaos-twin bounding (float-epsilon no-mechanism arms) before
attributing anything; verdicts name their horizon and compounding
mechanisms are re-read at later ones; "never fired" is a finding —
funnel counters sit at the exact rejecting line; mechanism-exists ≠
mechanism-binds — arming statistics ship with every threshold law;
distributions carry `.n`; medians quoted, never maxes; a gate that cannot
fail is deleted; and the control is not the target — improvements are
judged against reality tables.

## 8.5 The collector

One introspective `collect()` (v1's design ported): every numeric leaf
measured by default, fail-open exclusion lists with reasons, unit-named
metrics for anything not in headline units, lifecycle metrics split
state-vs-history (`endedNow` / `endedEver`), right-censored survival, both
the authoritative and the drawn map measured. All tools (observe, trace,
spread, abtest, bisect, why) read this one collector.

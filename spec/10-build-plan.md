# 10 — Build plan  `[FULL DETAIL M0–M4; DESIGN M5–M8; SKETCH beyond]`

The ladder mirrors the bottom-up story: each milestone adds one layer,
is **watchable on screen the day it lands**, and is gated by its reality
table before the next begins. Never two unvalidated layers at once.
M1–M4 is the experimental bet; if the caging/exit physics produces the
right geography of early politics, the design is validated at its
foundation — cheaply and early.

## Repo layout

```
v2/
  src/sim/        # the sim core (worker + node)
  src/shell/      # the observatory UI (grows per milestone)
  src/ported/     # verbatim v1 ports (worldgen adapter, language, emblems, rng, transport seed)
  data/reality/   # the dataset shelf (08.2), licensing per source
  tools/          # harness: smoke, gates, collector, observe, abtest, trace
```

V1 remains at repo root, runnable, as reference oracle and parts shop.

## M0 — Skeleton (small, boring, load-bearing)

Build: TS + Vite + worker scaffold; RNG module (ported); world-hash;
save/load shell; the collector skeleton; smoke gate (determinism +
save/load + invariants); two-grid runner; constants-ledger lint; CI wiring.
Gate: smoke green on an empty world at both grids.

## M1 — The land and the cost of moving

Build: v1 worldgen consumed as input (adapter in `ported/`); the
travel-time field (03) with modes, seasons, capability gates; the map
shell (terrain lens, click-two-points travel query).
Gate: 03's reality table (ORBIS-class checks, freight ratios, cross-grid
real-km parity).

## M2 — People

Build: `people` field with growth/migration/capacity kernels (v1 kernels
ported, re-founded in real units); the technique wave with real hearths;
conservation audits live.
See: the world fills from the Younger Dryas; the population lens.
Gate: 04's table — population curve shape, density ordering, wave timing.

## M3 — Surplus, storage, bad years

Build: food books, harvest years (ported system), granaries, famine
derivation, forcings (03.1); communities condense (bookkeeping only).
See: famine lens; grain valleys glowing; villages render at zoom.
Gate: famine geography/frequency; conservation; lean-year margins.

## M4 — The first taking  ★ the bet

Build: appropriable surplus; exit computation; raid vs subjugation hazards;
the first obligation edges (tribute); unrest books.
See: tribute arrows appear in caged valleys and *only* there.
Gate: 05.2's acceptance — geography and order of first subjugation match
the archaeology, from mechanism. **A miss here stops the ladder** and the
finding drives a physics revision (R10), not a constant (R2).

## M5 — Chiefs and trust

Build: center condensation, retinues (fed stocks), reach, services →
legitimacy, over-extraction → unrest, selection; dynasties (ported)
attach; heraldry (ported) renders.
Gate: chiefdom scale/density bands; extraction band; watchable politics
lens (authority halos).

## M6 — Links and chains

Build: the obligation graph proper (kinds, person/office binding,
successions, defections); peer edges and simple leagues; polity queries;
chronicles (event log + historiography).
Gate: lifespan and size-dispersion tables (the heavy tail v1 never hit);
succession-shatter rates; pathology regressions (confetti, mill) green.

## M7 — Towns, markets, money

Build: gravity condensation of market/temple towns; bid-to-eat market
(ported design); specie loop; roads/sea substrate; the trade and economy
lenses; language (ported) begins naming everything.
Gate: 06's table — city sizes, haul sheds, urban share, price behavior.

## M8 — The tools of rule

Build: the institution catalog; EXTEND vs DEEPEN flows; war economics
with rising capital intensity; sieges/storms (v1's validated forms);
collapse (scars, dark ages, restorations on land memory).
Gate: 05.8 + Seshat administrative-depth checks; first-state timing;
empire rings visible; ensemble-level checks begin.

## M9+ `[SKETCH]`

Sea exploration and the colonial arc (v1-validated designs), epidemics on
the travel field, full identity dynamics, faith networks (P6 decision),
the early-modern sharpening (borders crisp, Phase 1 complete), then the
Phase-2 seam opens (fossil energy into the standing books).

## Standing rules

- Every milestone lands with its lens — the shell grows with the sim
  (eyes on the map out-diagnosed probes in v1, every time).
- Every constant lands with its ledger row, same day.
- Gates run at dev + target grids, shipped configuration, windowed
  multi-seed; verdicts name their horizon.
- The losing side of every experiment is deleted when the experiment
  concludes (R9) — no flag graveyards.
- Port before rebuild: if a v1 mechanism is validated and fits the clean
  substrate, it is ported and cited, not re-invented.

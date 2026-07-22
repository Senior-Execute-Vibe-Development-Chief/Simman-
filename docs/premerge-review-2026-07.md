# Pre-merge review — goods-vector branch (2026-07)

**Method:** ultracode workflow (`goods-vector-premerge`, 107 agents): 8
review lenses over the full `origin/main...HEAD` diff (money conservation,
determinism/order, cardinal rules, byte-identity of defaults, resolution
invariance, economic semantics, performance, UI/worker), every unique
finding adversarially verified by 3 diverse agents (code-refuter,
failure-scenario constructor, materiality assessor — 2-of-3 to survive),
concurrent with an 11-cell sim matrix (4 seeds × full stack, 4 × stack +
`OUTPUT_TOTAL=1,FIAT_OUTPUT=4`, 2 double-run determinism diffs, 1
build+headless-UI), synthesized by an xhigh judge.

## Verdict: READY-WITH-FIXES → fixes applied same day

Two code findings survived adversarial verification (both in the branch's
own flagship levers; the default path was clean throughout):

1. **[major, FIXED] ore double-counted into materials under GOODS_UNIFY**
   (`settlement.js`): the `_agMat` stash ran AFTER `agMat += oreU`, so
   `cap[G_MATERIALS]` carried last tick's full ore production while
   `cap[G_ORE]` booked the same extraction — one physical output shipped as
   two tradable goods (income double-booked, mining-town materials price
   depressed, `_gNet`/specialty/RESOURCE_WARS/INDUCED_INNOV reading the
   distortion). Fix: stash moved before the ore addition (the primary
   component only, as its comment always claimed). Post-fix: ore re-prices
   on real supply (median 1.05 → 0.90 at 3k).
2. **[minor, FIXED] pair freight over-charged then free** (`roads.js`): the
   per-consignment freight divided by the SHRINKING remaining value budget
   (legs compounding to ~1.8–3× the physical transport) while the freight
   pool went negative and later gap-sorted legs shipped FREE — bypassing
   the ship-worthiness check the von Thünen lever depends on. Fix:
   allocation against the INITIAL budget (shares sum ≤ 1; pair total =
   transport × the cargo mix's value-weighted bulkiness — the physics),
   exhaustible pool removed.
3. **[harness, FIXED] timing footer broke the byte-diff gate**: probe
   timing moved to stderr; two same-seed runs now diff BYTE-IDENTICAL
   (verified under the full 14-lever stack and under defaults).

Everything else the lenses raised was refuted on verification (rejected
count in the workflow record) — the conservation, determinism,
cardinal-rules, res-invariance and gating audits otherwise came back clean.

## Matrix results (pre-fix — the goods metrics are refreshed post-fix)

All 8 sim cells + UI green; no NaNs, no globally pinned markets, no
zero-flow worlds; determinism cells differed only on the (now fixed)
timing footer.

## Post-fix re-battery (same day)

Smoke green (defaults byte-identical); stylized all hard gates (1 softie);
20k full stack at 8817: goods sold **20.2 %** (the F8 share holds WITHOUT
the phantom double-book), materials income deflated to 9.2 % as predicted,
capital 1.4 %, entropy 2.13, asymmetry 0.95 / 0.62 / 0.77. Ore now reads
its TRUE scarcity — median 2.88 across a real 0.46–4.00 gradient (the
pre-fix phantom materials had been masking it); the flip battery should
track the at-cap fraction as the watch list says, but this is a market
pricing a genuinely scarce industrial input, not a uniform pin.

## Default-flip watch list (from the synthesis, standing)

- Re-measure everything post-fix (done — see the spec's closing sections);
  track the fraction of settlements with ore at the 4.00 cap, and
  mining-town income composition (double-booking removed).
- Goods asymmetry: should ease below the 0.77–0.99 band once cities sell
  manufactures; if not, chase channel booking before flipping.
- Single-settlement wealth share: flag > ~20 % of world wealth — the
  pilgrimage loop concentrated 48–52 % in one city in 2/4 seeds (a
  faith-economy pathology, pre-existing candidate; bound it with a
  MECHANISM — congestion, offering elasticity — never a cap constant).
- "Baseline" as top export line (45–65 % of towns) is the flip's success
  metric — locked specialties should displace it well below ~50 %.
- Villages = 0 / farm surplus non-monetization: compare against a MAIN
  baseline cell before attributing to this branch.

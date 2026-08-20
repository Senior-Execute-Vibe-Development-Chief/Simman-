# The dense-register tick — the 20× slowdown (2026-08-20)

Owner: "with the new, higher density of cities, the sim runs about 20x
slower." The peer-seats register multiplied entities ~15× (66 → ~900 cities
at the shipped grid); passes tuned for a 60-entity world now dominate.

## Attribution (probe_passcost, new — tw=480/24k, live arm)

| | sparse (36 cities) | dense (535 cities) | ratio |
|---|---|---|---|
| total ms/step | 33.7 | 200.0 | 5.9× |
| settlements pass | 24.6 (73%) | 129.3 (65%) | 5.2× |
| trade | 1.3 | 31.6 | **24.8×** |
| armies / polities / roads / byId | ~4.2 | ~16.8 | 4× |

Sections inside the settlements pass (per-section timers added to
updateSettlement, profiler-guarded): knowledge 23.2 · goods 21.9 · food 17.6
· wealth 5.0 · population 4.0 ms/tick across the register — rate processes
recomputed every tick for every city (~0.2 ms per city per tick). The
remaining ~43ms of the bracket is `stepPopField + deriveOnePop` (the field
pass and the O(cities × catchment) census derive — sub-marks added, being
measured) plus the control field.

## Shipped: T.SETT_STRIDE (def 3; harness pins 1)

The codebase's own stride convention, already shipped twice (TRADE_STRIDE:
"every K ticks at K× volume, same AVERAGE flows"; updateKnowledge's internal
KNOW_INTERVAL: "staggered by id, rates scaled to keep the average pace
identical"), applied to the whole heavy per-settlement economy: food, wealth,
coerced labour, goods, development and knowledge run every K ticks per
settlement, phase-staggered by id, under dt×K. Population and tier stay
per-tick. Consumers read economy fields ≤K−1 ticks stale (the `_linkMoney`
convention). A performance cadence in the CLAUDE.md sense — it moves how
often code runs, never whether history may happen.

Measured (same probe, stride 3): sections fall ~K× (knowledge 23.2→9.1,
goods 21.9→9.6, food 17.6→6.8) and the total falls 171→146 ms/step **despite
the arm carrying more entities** (573 cities/395 realms vs 535/328 — the
run's own history diverges under stride, as any trajectory-touching lever's
does). Gates: anchors byte-identical at the pinned stride
(fd90feea/7239c843), smoke/validate/resgate/coverage/lint/build green.

## Open (next laps, in order of measured size)

1. **deriveOnePop + stepPopField** (~43ms of the dense bracket; 4× the tiles
   at tw=960) — the census derive re-sums every catchment every field tick;
   candidates: derive on the field stride with per-settlement stagger, or
   incremental catchment sums.
2. **The trade sweep** (~92ms every 3rd tick dense) — partner-bounded but
   per-pair work is heavy; candidates: deepen TRADE_STRIDE (its own live
   dial), or thin the per-pair goods loop.
3. A like-for-like A/B of the strided live history against unstrided (the
   register/era arcs should be statistically indistinguishable) before
   raising K further.

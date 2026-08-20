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

## Corrected attribution (marks fixed: the settlement loop had been lumped
into the field bucket) — app-true (pool off), dense, SETT_STRIDE=3, tw=480

| line | ms/tick | share |
|---|---|---|
| settlement loop | 48.7 | 36% |
| trade (stride 3) | 33.3 | 21% |
| stepPopField | 15.8 | 12% |
| controlField | 8.6 | 6% |
| deriveOnePop | 8.3 | 6% |
| roads | 6.5 | 5% |

## Second cut shipped: TRADE_STRIDE def 3 → 5 (harness pins 3)

The sweep is the design's own dial ("every K ticks at K× volume, same AVERAGE
flows"); at 5 it measures **18.6 ms/tick** (−44%). The harness pins 3 so every
gate keeps the calibrated reference trajectory; the app ships 5. Dense total:
~200 (unstrided) → 158 (SETT_STRIDE 3) → **133 ms/step** (+TRADE_STRIDE 5) —
a 1.5× recovery so far at tw=480; the same fractions apply at tw=960.

Register sanity across the strided arms (same seed/step, trajectories
legitimately diverge): 535/328 → 573/395 → 589/372 cities/realms — same
order, same regime; no collapse signature.

## Open (next laps, in order of measured size)

1. **The settlement loop's remainder** (~49ms): the strided sections are now
   27ms of it (K=3 → K=4-5 cuts further; measure history-sanity first),
   population runs per-tick at 6.6ms, and ~11ms is unattributed loop
   overhead — attribute before touching.
2. **stepPopField's foodK bucket** (10.5ms: the FOOD_K blend + urban spikes +
   the capacity logistic + diffusion) — per-phase marks are in; split the
   bucket further if it grows at tw=960.
3. **controlField** (8.6ms, render-only in pretty mode) — tie its stride to
   the snapshot cadence rather than the sim tick.
4. **deriveOnePop** (8.3ms) — stagger catchment sums per settlement.
5. The like-for-like history A/B (strided vs not) before raising either
   stride further.

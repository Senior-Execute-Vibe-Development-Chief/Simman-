# 2026-08-23 — the integration lane

Follows `docs/nationless-cities-2026-08-22.md`. BORN_OF_LAND closed the
birth-side hole (cities born on a realm's land join it, 0% → 97%), and what it
exposed is the lane behind it: a suzerain accumulates vassals and almost never
converts them into governed ground, so the atlas paints one cohesive nation over
a realm partition that is still confetti.

Measured first, per the second cardinal rule — the question is whether the era
org bar is the binding gate or a redundant one in front of the gates that carry
real physics.

| log | arm |
|---|---|
| `absorbbar240_control.log` | reference grid, live stack, `ABSORB_ORG_ERA=1` (the shipped bar) |
| `absorbbar240_nobar.log` | reference grid, `ABSORB_ORG_ERA=0, ABSORB_ORG_MIN=0.1` — the bar effectively removed |
| `absorbbar480_control.log` | shipping proxy, same control |
| `absorbbar480_nobar.log` | shipping proxy, same bar-removed arm |

Instrument: `tools/probe_absorbbar.mjs`. The funnel is the sim's own
(`telemetry.js`); no gate is re-implemented outside the code that runs it.

**Read the arms this way.** If `PASSED` barely moves and `noAdminHeadroom`
absorbs the candidates, the bar is redundant and the real constraint is
administrative capacity — fixing the bar would be fixing the wrong thing. If
`PASSED` rises and the biggest bloc's *root realm's own* area grows as a share of
its bloc, the bar is binding and its quantile form is the thing to re-ground.

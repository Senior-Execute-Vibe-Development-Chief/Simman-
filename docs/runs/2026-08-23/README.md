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

## Reading of the capacity ledger (code, not measurement — 2026-08-23)

Owner: *"is the problem that adding a city to a nation takes up admin capacity? why?"*

Recorded here because it frames the next measurement, and because it is a
READING of `conquest.js`, not a finding — nothing below has been measured.

**A member COSTS** (the per-member load loop):

    load = (d / holdRange) · sizeMul · recMul · langMul / coerce
    sizeMul = 1 + SIZE_LOAD(0.4) · min(3, log2(1 + provPeople/SIZE_REF))

Linear in distance from the capital, with friction for a foreign tongue
(`langMul`, cohesion.js) and for recent conquest, divided by the army's grip.

**A member PAYS** (the delegated-seat term in `peaceCapacity`):

    seatBonus += CAP_SEAT(0.3) · loyalty · min(2, log2(1 + people/SIZE_REF))
    // only members with tier >= 2, or holding vassals
    // TOTAL capped at SEAT_BONUS_CAP = 10

So a city contributes **at most 0.6** and costs **0.5 to 3+**, and the whole
seat contribution is capped at 10 — about seventeen full-value cities, past which
every further province is pure cost. The other capacity term grows as
`log2(1 + governedPower/ref)`.

**Linear cost against logarithmic-and-capped benefit is a ceiling on province
count by construction**, in any era and at any development level.

The distance and tongue terms are good history — empires did pay more for far and
foreign provinces. `SEAT_BONUS_CAP = 10` is the suspicious one: a constant with no
independent physical meaning, which is this repo's own tell for a fitted outcome.
History's answer to governing fifty provinces was MORE GOVERNORS — Persia's
satrapies, Rome's magistracies, Han's commanderies each supplied their own
administration, so capacity scaled roughly linearly in provinces, which a flat cap
of 10 forbids. The honest counter, and presumably why the cap exists: uncapped,
each province funds the next and empire runs away unbounded. The mechanism-true
version would not remove the cap but make a seat's contribution REAL — its own
org, works and revenue, net of what it costs to reach — so the limit emerges from
what provinces produce instead of from a number.

**None of this currently binds.** `noAdminHeadroom` fires 0 times in ~1,600
candidates: the capacity budget is spent upstream by the territory pass, which
sheds until load fits, so the absorb decision always finds headroom. The ledger
above is a ceiling on TERRITORY, not on the vassal roster.

Next measurement, before any constant is touched: per-realm load against seat
contribution across the arc — how many realms are at the SEAT_BONUS_CAP, and what
share of their capacity the cap is withholding.

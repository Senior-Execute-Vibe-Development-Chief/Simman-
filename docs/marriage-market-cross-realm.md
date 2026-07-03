# The royal marriage market needs cross-realm heirs (claimant-wars prerequisite)

**Status:** open problem — blocks W6-F claimant wars + personal unions (D28/D1/D29).
**Owner area:** `src/sim/peopleSim/dynasties.js` (the marriage market: `marry` / `wed` /
`world._royalCourt`).

## The problem

Claimant wars need a **cross-realm royal kin graph**: a realm can press a dynastic claim on
another only if its sovereign is *of* the disputed house (a cadet branch that came to rule
elsewhere) or *married to a person born of it* (a foreign king wed to its princess). The
engine does not produce that graph at any meaningful frequency — dynasties are effectively
**realm-siloed**.

## The evidence (measured)

A probe (seed 8817, ~12 000 steps, W=320) at run end:

- **11 sitting rulers, 11 distinct ruling houses** — every realm has its own house.
- **0 houses rule more than one realm** — a cadet branch never comes to sit a second throne.
- **~1 of 11 rulers has a *housed* living consort** — i.e. a consort with a real
  `dynastyId >= 0`. The rest are married to house*less* in-laws.

Consequently **zero succession claims fired** in that run (and in the 15 000-step validate on
both seeds — the claimant-wars build was byte-for-byte identical to the run without it),
*even after* broadening the claim trigger to "any sovereign of, or married into, the disputed
house" **and** raising `FOREIGN_MATCH` from 0.25 to 0.6.

## Why it happens

`marry()`'s foreign path (`FOREIGN_MATCH`) only weds a **real foreign heir** when
`world._royalCourt` happens to hold a suitable (unwed, sex-matched, 16+) heir from another
court. That pool is thin, so the path overwhelmingly falls through to
`makeAdult(..., { foreign: true })` — a **generated, houseless** consort (`dynastyId = -1`).
A houseless consort carries no realm's blood, so it creates no cross-realm claim. Raising
`FOREIGN_MATCH` does not help: the bottleneck is the *court pool*, not the reach-abroad odds.

Nothing else knits houses across realms — succession always crowns from a realm's *own* house
(`heirByLaw`), and there is no mechanism by which one house comes to rule two realms.

## The fix (direction, not yet built)

Make foreign royal matches routinely wed a **real foreign-house heir that retains its birth
`dynastyId`**, so married-in ties and shared houses actually accumulate. Candidate approaches,
cheapest first:

1. **Fill the court pool from living house members, not just unwed ruler-children.** Widen
   `world._royalCourt` to include eligible unwed adults across every living dynasty's roster
   (`dyn.members`), not only `ruler.children`. More real heirs → more real foreign marriages.
2. **Fall back to a real heir, not a generated consort.** When the reach-abroad roll fires but
   the court pool has no match, wed a living member of *another realm's* house (nearest / same
   culture) instead of `makeAdult({foreign:true})`. Every foreign match then plants a
   cross-realm blood tie.
3. **Let a house inherit a second throne.** On a succession CRISIS (house failed), before
   founding a brand-new line, allow a *foreign-ruling relative of the old house* to inherit —
   which is itself the personal-union seed, and directly creates a house ruling two realms.

Whichever path, keep it emergent (gated on kin + who sits which throne, never a date) and
lever-safe, and re-measure with the probe: success = houses ruling >1 realm and multiple
housed cross-realm consorts appear. **Only then** rebuild claimant wars on top (the reverted
design in `roadmap-wave-6.md` was sound — it just had nothing to fire on).

## Acceptance check

Re-run the probe; the fix is working when it reports, over a full run: at least a handful of
**houses ruling >1 realm** and a materially higher count of **sovereigns married into another
realm's house**. Then the reverted `_succClaims` / `claimBarOf` / `crownForeign` machinery
will actually trigger, and the validate crisis-war gate should rise (the W6-F target).

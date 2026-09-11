# HANDOFF — Wave W32 of Simman v2: the wake's room

**For:** the implementing agent.
**From:** the owner, 2026-09-09 — *"whats next"* → *"simply"* → *"do it"* after the
shipped-grid arm recorded that no basin cages under the merged store law at
either grid (commit `38bfe825`). Branch from that tip or later.
**Scope:** P24. The room `cagedBasin` reads is `capField` — the capacity the
growth pass already reads — not W5's pair-spare expression at best yield with
a farmer share of one. Free is capacity minus people. The knee stays at
Carneiro's 0.2; the window stays the hearth law's. **Do not** net the
lean-year margin out of free (open ruling on P24). **Do not** build the
flight (P22 (i), next as W33), change growth, harvest, store, movement, or
any constant. No place name in code; no year in any expression.
**Status: BUILT (2026-09-09).**

---

## Why

W5's wake measured free share against the room a first farmer sees on an
empty map: `packageCapacity` at the best active yield, farmer share one, no
crop fit. W8's fit, W29's mean-year deaths and W31's store then bounded what
a full cell actually holds. Under the merged harvest law a full basin stands
at 0.78–0.88 of `capField`, and that capacity is 0.79–0.81 of W5's room; the
product bottoms free share at 0.277 against the 0.2 knee. The app under
`wake: auto` solves to the horizon's end at both grids — shipped behaviour,
not a dev curiosity (DECISIONS P24; W31 status; QUESTIONS #89).

The mechanism that should have produced the cage is the room itself. Fix the
room; do not lower the knee or inflate people.

---

## Mechanism

In `v2/src/sim/people/wake.ts`, `cagedBasin`:

```
room[cell]  = max(0, capField[cell])
free[cell]  = max(0, room[cell] − people[cell])
```

then the same summed-area window over farmed centres as today. Delete
`farmerRoom`, `refreshBestYield`, and the `_bestYield` / `_bestYieldDigest`
scratch — they existed only for the stale room. The wake remains a TS oracle
(Rust does not recompute it). Knee, window, schedule, provenance unchanged.

Open ruling left open: whether free should also net the margin the years
demand (04 §4.2 withdrew as a founding rule; W31 made it a result). This
wave does not.

---

## Acceptance

1. Unit: a world whose farmed land sits at 0.85 of `capField` cages with free
   share ≈ 0.15; the same world emptied does not.
2. `npm run lint`, `tsc`, unit, smoke, kernel parity, `gate:people` (dev
   solve). The gate's `findings.solve.dev.cagedStep` / `cagedYear` is the
   measurement — expect a cage inside the horizon where W31 recorded none.
3. Shipped-grid cage is `GATE_PEOPLE_SOLVE_TARGET=1` / `v2-long` — record as
   needing one; do not run it in the development loop.
4. Update DECISIONS P24 (built), QUESTIONS #89, ledger §W5/§W31 wake gap →
   W32 row, this handoff's status. Flight remains next (W33).

No constant chosen by looking at a cage year. No window moved. No physics
outside the wake room.


---

## Status

**BUILT (2026-09-09)** on `cursor/v2-w32-wake-room-4b2d`.

Dev solve arm (`gate:people`): first caged basin at **−5857** (33.8°N 36.8°E),
`cagedStep` 46116 — under the merged W31 law the same arm recorded none
inside the horizon (min free share 0.277). Population curve unchanged
(wake room is not a people law): −8000 13.16M, 1 CE **1,767.9M**. Smoke's
solve run records the same `cagedStep`. Unit: 0.85 fill of `capField`
cages at free share ≈ 0.15; empty world does not.

Shipped-grid cage under the new room is `GATE_PEOPLE_SOLVE_TARGET=1` /
`v2-long` — recorded as needing one, not run in the development loop.

Verification: lint, `tsc`, unit, smoke both grids, kernel parity,
`gate:people` (dev). No constant added or moved. Flight remains W33.

**Shipped grid (`v2-long`, 2026-09-09 on `a68882d2`).** First caged basin at
**−5383** (`cagedStep` 51804). Under the merged W31 law the same arm recorded
none inside the horizon (b4d49aff had caged at −2111). Curve unchanged from
the W31 arm within 1 %: −8000 9.1M, −5000 42.6M, −3000 398.1M, −1000 843.3M,
1 CE **1,021M**. P24 is confirmed at both grids: `wake: auto` now wakes on
the caged-basin trigger before the horizon's end at 22 km cells too.


# HANDOFF — Wave W33 of Simman v2: the flight

**For:** the implementing agent.
**From:** the owner, 2026-09-09 — *"keep iterating … until … ready for the next
BIG thing"* after W32. Branch from W32 tip (`a68882d2` or later on
`cursor/v2-w32-wake-room-4b2d`).
**Scope:** P22 (i). The awake regime's migration room for farmers is this
year's harvest and the store, not the mean-year `packageCapacity`. A cell
whose year failed and whose granary is empty has less room; its people walk
toward the neighbour whose year (or store) is better — the hotspot law on
this year's food, not a new rate. **Do not** build cohort weighting (M3b),
the preventive check (M3b), storability technique (M8), grain trade (06),
or change the wake, harvest deaths, growth, or any constant. No place name
in code; no year in any expression.
**Status: BUILT (2026-09-09).**

---

## Why

W29 kills in place: the year's multiple enters no room the movement sees.
W31's store covers shortfalls before deaths, but people still stand where
they starve once the granary is empty. History's famine is also *flight* —
a failed harvest empties a valley into its neighbour. The mechanism is the
room the hotspot already reads (P22 (i); W31 open #1).

Solve stays on the mean-year room: the solve regime has no monthly year to
respond to, and the agreement arm's bound is the stride error against that
approximation. Flight is awake only.

---

## Mechanism

Already on the world: `_yearMul[packed]` (last harvest year's multiple; 0
where unread), `store[cell]` (tonnes/km²), `FOOD_RATION_TONNES_PER_PERSON_YEAR`.

Awake farmer room at a target (both kernels):

```
mean   = packageCapacity(target, source's dominant package)
mul    = _yearMul[targetPacked]          # 0 = unread → treat as 1
land   = mean * (mul > 0 ? mul : 1)
store  = store[target] / FOOD_RATION     # tonnes/km² → persons/km²
room   = land + store − population
```

`roomFarmers` flag: any active package's `land + store − population` clears
the floor (store counted once). Forager room unchanged. Solve
(`phase !== "awake"`): `land = mean`, `store = 0` — today's law.

Pass the awake flag into the wasm kernel's `begin_migration` (the kernel
does not otherwise read phase). Harvest stays after migration in the
schedule: migration sees the previous firing's yearMul and the current
store — flight after the harvest that wrote them, one year on the awake
stride. No reorder.

No new constant. No change to growth, deaths, the label, the wake, or the
store's own law.

---

## Acceptance

1. Unit: awake — a bad-year neighbour has less farmer room than a good-year
   one at equal mean capacity and people; a store alone opens room; solve
   ignores yearMul and store in the room.
2. Both kernels bit-identical on the flight room (parity).
3. `lint`, `tsc`, unit, smoke, parity, `gate:people` (dev). Severity /
   frequency / curve are measured, not tuned; windows untouched.
4. Long arms (`GATE_PEOPLE_TRAJECTORY=1`, shipped solve) after the
   mechanical chain — owner authorised. Record findings; do not dial.
5. DECISIONS P22 (i) built; QUESTIONS; ledger §W33; this handoff. Next
   toward M4: preventive check / cohorts (M3b) or M4 itself once flight
   is measured.

---

## What NOT to do

No new diffusivity or flight rate. No reorder of harvest before migration.
No solve-regime year room. No cohort weighting. No label change. No
constant chosen against a severity row. No place name in code.


---

## Status

**BUILT (2026-09-09)** on `cursor/v2-w33-the-flight-4b2d` (stacks W32).

Dev solve arm unchanged by flight (awake-only): cage **−5857**, 1 CE
**1,767.9M**, severity England / Deccan / NCP / Sahel 0.09 / 0.25 / 0.06 /
0.38 %, run 0.956 — byte-identical to W32's solve findings. Unit: bad-year
cell has no farmer room, good-year receives the flight; store opens room on
a full mean-year cell; solve ignores yearMul and store.

Verification: lint, tsc, unit, smoke, kernel parity, `gate:people` (dev).
Long arms (trajectory + shipped) authorised and queued after the W32
shipped-grid arm finishes.

Next toward M4: measure flight on the awake trajectory; then M4 the first
taking (communities as query). M3b (preventive check, cohorts) remains open
beside the ladder.

**Long arm (`GATE_PEOPLE_TRAJECTORY=1 GATE_PEOPLE_SOLVE_TARGET=1`, 2026-09-09).**
Solve findings unchanged (awake-only): cage −5857 / −5383, 1 CE 1,768M /
1,021M. **Agreement arm:** median arrival |Δ| **154 yr** (p90 216; was 13.9 /
19.9 before flight), 49 cells farmed by both, 35 by solve only — the solve
regime's mean-year room against the awake year's food. Manifest row
`solve-agreement-arrival:dev` acknowledged; tolerance unmoved (R2).

**Confirming re-run (post-acknowledgment, same flags, EXIT 0):** `gate: pass`,
`unacknowledged: []`. Cages −5857 (dev) / −5383 (shipped); agreement median
154.08 yr, p90 216.08 — byte-stable with the first arm. W33 verification
closed. Ready for M4 when the owner says go.


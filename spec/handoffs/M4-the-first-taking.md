# HANDOFF — Milestone M4 of Simman v2: the first taking

**For:** the implementing agent.
**From:** the W32/W33 session of 2026-09-09 — owner *"keep iterating until …
ready for the next BIG thing"*; owner said **go** 2026-09-09.
**Scope:** Carneiro's circumscription becomes politics. Where a basin is
caged and appropriable surplus sits in the granary, the first obligation
edge forms — tribute subordination, not a map colour. **This is the bet**
(01, 05 §5.2, build plan M4): subjugation sticks in the caged river valleys
and fails in open country, from the exit term, not from placement.
**Status: BUILT (2026-09-09)** — mechanical chain green; geography acceptance
on long arms still to measure (do not dial).

---

## Prerequisites (closed)

| Piece | Wave | Status |
|---|---|---|
| Harvest years + famine label | W29–W30 | built; frequency 6/6 both grids |
| The store (appropriable surplus object) | W31 | built; food sheet; P23 field |
| Wake room = `capField` | W32 / P24 | built; cages at −5857 (dev) and **−5383** (shipped) |
| Flight (awake room = year × store) | W33 / P22 (i) | built; solve unchanged; long arm confirmed (`gate: pass`) |
| Communities as query | P23 | field exists; condensation is this milestone's opening |

Open beside the ladder (do **not** block M4): M3b preventive check and
cohort weighting; arid spoilage datum (#89); storability technique (M8);
W28–W31 shipped bisection.

---

## Mechanism (write before code)

### 1. Community condensation (18.3 / P23)

A **community** is a membership window over the people field — bookkeeping,
not physics. The bar is a representation threshold (18.3): macro-history
must stay invariant under wiggling it.

- **Bar:** `COMMUNITY_BAR_PERSONS = 2000` — settlement-size literature /
  v1 village core (ledger Power row). Count is `Σ people[cell] × area[cell]`
  over member cells (real persons).
- **Radius:** `COMMUNITY_RADIUS_KM = 50` — about a day's walk catchment;
  at the reference cell (~167 km) this is usually one cell; at the shipped
  cell (~22 km) a handful. Not a fitted cradle.
- **Seats:** every farmed cell whose people-mass clears the bar. Stable id =
  seat cell index. (A local-max-only rule collapsed adjacent mid-latitude
  cells into one seat once the radius reached a neighbour.)
- **Members:** every farmed cell within the radius of a seat, assigned to
  the nearest seat (ties → lower cell index). A seat whose claimed mass
  falls below the bar does not mint (or dissolves).
- **Books on the community (M4 cut):** `unrest ∈ [0,1]`; granary is **not**
  copied — `granaryTonnes = Σ store[c] × area[c]` is a query (P23).
- **Dissolution:** symmetric. Drop the community and any edges that name it;
  cell `store` and `people` are untouched.

Rebuild membership every taking firing from the field; persist seat ids,
unrest, and edges so identity survives a year.

### 2. Exit (Carneiro / wake inheritance)

Per community, the same free-share the wake already measures (P24), on the
hearth-law basin window centred on the **seat**:

```
room = capField
free = max(0, capField − people)
exit = windowSum(free) / windowSum(room)     # free share
exitBlocked ⇔ exit < CAGE_KNEE_FREE_SHARE    # 0.2, one row with the wake
```

High exit → the loser walks; low exit → tribute can stick. No second knee.
No year in the expression.

### 3. Appropriable surplus

```
storeTonnes   = Σ store[c] × area[c]          # already surplus × storability
legibility    = 1 if the seat is farmed, else 0
appropriable  = storeTonnes × legibility
```

Legibility is the missing factor in 05 §5.1 (1); storability is already
inside `store` (W31). Do not multiply storability again.

### 4. Raid vs tribute (the bet)

Awake only. Annual cadence (`politics.taking`, growth stride, after the
people passes so the year's store is committed). Solve regime skips — no
communities push back on the peopling front.

For every pair of communities that share a neighbour-edge between member
cells, once per firing, in ascending `(minSeat, maxSeat)` order:

1. **Pressure.** A raid is contemplated only if the target's `appropriable`
   covers at least one person's annual ration
   (`FOOD_RATION_TONNES_PER_PERSON_YEAR`) — there is something to take.
2. **Hazard.** Deterministic draw
   `rng = mkRng(hash32(seed, "taking", year, aSeat, bSeat))`.
   Rate `λ = TAKING_RAID_RATE_PER_YEAR` (seed 0.05/yr — inter-polity
   raiding as the ground state of war before states; measured against the
   M4 geography gate, **not** dialed to land Egypt). Probability
   `1 − exp(−λ · dtYears)`.
3. **Winner.** Strength = community people-mass (retinues are M5). The
   heavier side wins; on a tie the lower seat id wins.
4. **Outcome.**
   - If the **loser's `exitBlocked`**: form or refresh a **tribute** edge
     `(from=loser, to=winner, kind=tribute, strength=EXTRACT_FLOOR,
     binding=person)`. Remit `EXTRACT_FLOOR × appropriable(loser)` tonnes
     from loser member stores (pro-rata) into the winner seat's store.
     Feed loser unrest: `unrest += EXTRACT_FLOOR × (1 − exit)` capped at 1.
   - Else (**cheap exit**): **plunder only** — move
     `PLUNDER_SHARE × appropriable(loser)` the same way; **no edge**.
5. **Edge life.** Each firing, drop edges whose endpoint communities are
   gone, or whose loser's exit has opened (`¬exitBlocked`). Live strength
   stays at `EXTRACT_FLOOR` until M5's coercion/legitimacy re-derives it
   (18 foundations level 3 — recorded fact, strength later re-derived).

No map colour. No centers. No polity query. Events:
`{ kind: "tribute" | "plunder" | "community", step, cell: seat }`.

### 5. Constants (ledger §M4)

| Constant | Value | Grounding |
|---|---|---|
| `COMMUNITY_BAR_PERSONS` | 2000 | settlement-size literature; v1 village core |
| `COMMUNITY_RADIUS_KM` | 50 | day's-walk catchment |
| `EXTRACT_FLOOR` | 0.10 | harvest-tax literature floor (`EXTRACT_BAND`) |
| `TAKING_RAID_RATE_PER_YEAR` | 0.05 | pre-state raiding as war's ground state; gate-measured, not cradle-fitted |
| `PLUNDER_SHARE` | 0.25 | movable share of a raided granary |
| `CAGE_KNEE_FREE_SHARE` | 0.2 | **existing** — shared with the wake |
| `SAVE_VERSION_M4` | 13 | communities, edges, unrest in the envelope |

### 6. Acceptance

Geography of first tribute edges: Nile / Mesopotamia / Indus / Yellow
early; rainfed Europe late; highlands never — **from exit**, not placement.
A miss revises physics (R10), not a constant (R2). Long arms after the
mechanical chain; do not dial rates to pass.

### 7. What NOT to build in this cut

No centers (M5). No retinues / coercion stock. No institution portfolio.
No war capital intensity. No polity map colour. No fitted cradle constants.
No year gates. No dialing subjugation rates to land Egypt. No M3b. No
grain trade between cells beyond the tribute/plunder remit above.

---

## Required reading

1. `spec/01-constitution.md` R1–R5, R9, R10; cardinal rules.
2. `spec/05-politics.md` §5.0–5.2 (the bet).
3. `spec/18-foundations.md` 18.3 (community bar).
4. `spec/DECISIONS.md` P2, P3, P22–P24.
5. `spec/handoffs/W31-the-store.md`, `W32-the-wake-room.md`,
   `W33-the-flight.md` (status).
6. `v2/QUESTIONS.md` #89 open list.

---

## Kickoff

Branch `cursor/v2-m4-the-first-taking-4b2d` from the W33 tip. Mechanism
above first; then code; measure both grids. The wake already fires; M4
inherits it.

---

## Status

**BUILT (2026-09-09)** on `cursor/v2-m4-the-first-taking-4b2d` (stacks W33).

Communities condense from the people field (bar 2000, radius 50 km);
exit reuses the wake's free share at the seat; appropriable surplus is the
store query × farmed legibility; caged losers form tribute edges at
`EXTRACT_FLOOR`, open-country losers are plundered only. Save v13.
Mechanical: lint, unit (condensation / tribute / plunder), smoke, kernel
parity, `gate:people` (dev) — pass. Geography acceptance (Nile /
Mesopotamia / Indus / Yellow early) is the long-arm measurement — record,
do not dial.

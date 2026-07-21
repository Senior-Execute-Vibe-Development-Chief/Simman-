# Completing the industrial transition — design notes, July 2026

The modern demographic transition was **⅓ built.** `INDUSTRIAL_CAP` (carrying
capacity, the population magnitude) works. A deep run to the modern era at the
player's real grid (tw=480, seed 8817, both levers on) exposed the missing two
thirds — verified by two independent forensic passes over the run data + code:

1. **A resolution-invariant urban system** (finding ①) — the urban core is a
   single tile, so the urban *share* collapses ∝1/rn² (33% at tw=240 → ~10% at
   tw=480). Being fixed now behind a default-off `URBAN_FOOTPRINT` lever.
2. **An industrial-scale fiscal/monetary state** (finding ②, this document) — the
   levers scale the real economy ×26 but money and state capacity stayed
   pre-industrial, so the modern realm goes chronically insolvent and secular-
   cycles its population ±40%.

Both are *systems to build*, not tuning errors. This doc specifies ②.

---

## 1. The verified diagnosis — a fiscal-political secular cycle

The modern population does not collapse; it **oscillates** (tw=480: 2.8B → 1.6B →
2.8B). It is being *shed and re-grown*, not killed. Evidence (all confirmed
first-hand against the run data and code):

- **It's a density collapse, not deaths.** Settlement count is flat-to-rising
  through each downswing; people-per-settlement halves. Event-log `dead` is *army*
  casualties (a separate regenerating levy pool, `s.army`, never `s.people`).
  corr(pop, warring) = **−0.06**, corr(pop, plagued) = **+0.05** — war and plague
  do not move population.
- **Population tracks fiscal health.** corr(pop, wealth) = **+0.61**, tradeFlow
  +0.49, treasury +0.46; corr(pop, insolvent) = −0.24, countries = −0.25. The
  economy leads: from step 60k→100k population fell 38% while wealth/treasury/coin
  fell **−92%** and tradeFlow **−99.99%**. Population follows the money and
  recovers with it (the rebound proves the carrying-capacity ceiling stayed
  intact — the trough is population *suppressed below* an intact ceiling).

### The causal chain (mechanism, cited)

1. **The levers scale real output ×26 and urban concentration ×4, but not the
   money supply.** `INDUSTRIAL_CAP=25` → each worked tile's capacity ×(1+25·gate)
   (`popField.js` capField × indMul); `URBAN_IND=3` → urban target ×4
   (`popField.js:654`). Population jumps ×13.6 in ~6k steps.
2. **The money supply is anchored to specie.** `M = Σ wealth` (`inflation.js:83`);
   the credit layer conjures at most `specie × CREDIT_MAX_MULT` on a *metal* base
   (`base = wealth − credit`, `settlement.js:699,704`). Mined specie grows only
   ~×3.5 while real output goes ×26, so **M/T collapses and the price level
   deflates to the hard floor** (measured modern price = **0.20** = RAW_MIN, pinned
   flat; `inflation.js:52`). This is the gold-standard problem: metal-backed money
   cannot monetize an industrial economy.
3. **A deflated ×26 economy can't fund its ×26 state.** Army/administration scale
   with the real population (`_manpowerCap = MANPOWER_FRAC·pop`, `armies.js:418`)
   but nominal revenue is floored by the deflation, so `_solvency → 0`.
4. **Insolvency drives the fiscal death-spiral.** `capacity = peaceCapacity ·
   duress · fiscalDuress + momentum` (`conquest.js:2264-2284`): lose revenue →
   capacity falls → lose provinces → lose more revenue. Unpaid garrisons desert
   (`armies.js:399-404`). Realms **shatter** (country count 38→72).
5. **Fragmentation severs trade → the import-fed urban capacity evaporates.** The
   urban spike added to capField is `uTarget = URBAN_AGGLOM·(1+URBAN_IND·gate)·
   sumK·share` where `sumK` is the total *import-fed* economy (`popField.js:654`);
   when trade dies `sumK→0`, the ×4 urban capacity vanishes and the logistic pass
   expels the now-uncapacitated urban crowd. Population is suppressed below the
   intact ceiling.
6. **Reconsolidation → recovery → repeat.** A realm re-integrates, solvency and
   trade recover, population rebounds. A Turchin-style secular cycle.

**The oscillation itself is legitimate emergent behaviour** (nothing time-gated;
population recovers on reconsolidation). What is **unhistorical is the downward
modern envelope** — a modern industrial state is *more* robust to fragmentation
than a medieval one (the 20th-century breakup of empires did not crash
population), yet here it is *more* fragile. That inversion is the tell.

---

## 2. The root cause — an incomplete lever set, not a mistuned constant

`INDUSTRIAL_CAP` / `URBAN_IND` scale the *population and its trade/fiscal
dependence* ×26/×4 onto a **money model and a state-capacity model that stayed
pre-industrial**. The machinery to scale them exists but is anchored to the wrong
base:

| System | Exists? | Why it doesn't scale to the industrial break |
|--------|---------|----------------------------------------------|
| **Money** | Credit money (`settlement.js:697`, default on) | Anchored to **specie**: `credit ≤ specie·(CREDIT_MAX_MULT−1)`. Specie grows ~×3.5 (mining); the ×26 economy outgrows it → deflation to floor. |
| **Fiscal extraction** | Tax/treasury, seigniorage/debasement (`conquest.js:150`) | Calibrated to pre-industrial extraction rates; the modern fiscal state (income tax, ~30–50% of output) never emerges, so revenue can't fund the ×26 army/admin. |
| **Administrative reach** | `CAP_MODEL` `dominance = 1 + CAP_FISC·surplus·(1+CAP_LOG·logistics)` (`conquest.js:289`) | Scales with logistics — *good bones* — but keyed off a *surplus* that the deflation has crushed, so the reach that should hold a modern realm together isn't funded. |

Per the cardinal rules, the fix is to **build the missing system, not clamp the
outcome.** A population floor, a "don't fragment in the modern era" gate, or a
constant that dials the money supply to the answer would each be a fitted-outcome
/ time-gate anti-pattern. The right mechanisms model the real causes; a stable
modern population then *falls out*.

---

## 3. The design — an industrial monetary/fiscal companion, co-gated on development

Three mechanisms, each **gated on the same emergent industrial development** the
other levers use (capital organisation/metallurgy past ~0.78 — never a clock),
so the whole four-part industrial system **co-activates**: a realm that
industrialises gets more people, more cities, more money, and a more capable
state *together*. Each ships behind a default-off lever, byte-identical at 0.

### ②a — Money decouples from specie (the fiat/central-bank transition)

The historical fix for exactly this problem: at financial maturity, money stops
being a multiple of metal and becomes a claim on the *monetised economy*. Build
on the existing credit layer — at high organisation (past the industrial gate),
raise the credit base from **specie** toward the settlement's **real economic
output** (its `_k` / value-added), and let `CREDIT_MAX_MULT` deepen with
organisation (goldsmith notes → central banking → managed money). Mechanism:
`creditBase = specie + industrialGate·(outputProxy − specie)`, so pre-industrial
realms stay metal-backed (byte-identical) and industrial ones monetise their
output. Effect: M scales with T, the price level leaves the floor, and the ×26
economy is *monetised* rather than deflated — no fitted target, just the money
supply tracking the economy it serves.

*Guard:* this is money creation, so it must not become runaway inflation — the
existing `_inflRaw`/price machinery already prices monetary expansion (and the
now-honest price gate, `stylized.mjs`, will catch runaway); the emergence is
gated and bounded by the same `CREDIT_MAX_MULT` depth curve, not uncapped.

### ②b — The modern fiscal state (extraction rises with development)

Revenue as a share of the economy rises with organisation past the industrial
gate — the emergence of income tax and modern bureaucracy (a modern state
extracts an order of magnitude more per capita than a medieval one). This funds
the ×26 army/administration so `_solvency` stays healthy through the transition
instead of collapsing. Gated on org; the *rate* is an emergent curve of
development, never a target solvency.

### ②c — Reach that holds the modern realm (fund the existing CAP_LOG channel)

`CAP_MODEL` already routes surplus×logistics into hold-capacity ("a rail-age
surplus governs a continent"). Once ②a/②b keep the modern surplus from
collapsing, this channel should already carry a modern realm — so ②c may be *no
new mechanism*, just the confirmation that a *funded* CAP_LOG holds the ×26
realm together. Measure first (does fragmentation subside once solvency is
restored?) before adding anything; if a residual remains, extend the industrial
logistics term, not a fragmentation clamp.

---

## 4. Cardinal-rule check

- **Emergent, never time.** Every part gates on capital organisation/metallurgy
  (the same emergent industrial gate as `INDUSTRIAL_CAP`/`AGRI_INDUSTRIAL`), never
  ticks/year/era. A slow world monetises and builds a fiscal state exactly when it
  industrialises, on any seed/grid/pace.
- **Build the system, not fit the outcome.** The mechanisms model real causes
  (financial development monetises output; the modern state extracts more;
  logistics extends reach). Stable modern population is the *consequence*. No
  population floor, no anti-fragmentation gate, no constant dialed to a target M or
  solvency.

---

## 5. Validation plan

Deep runs to the modern era (the transition only appears there), levers on, at
**both** tw=240 and tw=480 (the ① footprint fix makes the urban read comparable
across grids). Success is measured as emergent outcomes, not dialed values:

- **Price leaves the floor.** Modern people-weighted raw price rises off 0.20
  toward ~1 (money now tracks output). The honest price gate (`stylized.mjs`, V1
  fix) is the instrument.
- **Solvency holds.** `insolvent` count stays low through industrialisation
  (was 0→11 at the collapse).
- **Fragmentation subsides.** Country count stops the 38↔72 swings; the modern
  realm holds together *because it can afford to*, not because a gate forbids
  secession.
- **Population plateaus.** The ±40% secular oscillation damps to a modern
  plateau (real industrial populations grow then level; they don't shed 40%).
- **Byte-identity + pre-industrial identity** with every lever at 0 (`npm test`),
  and no stylized-gate regressions at the tw=240 reference.

---

## 6. Status & sequence

- **① resolution-invariant urban core** — in progress (default-off
  `URBAN_FOOTPRINT`; conservative radius `max(0,round(rNormPop)−1)` keeps the
  tw=240 reference byte-identical). Fixes the resolution-dependence that makes any
  urban tuning meaningless across grids — the prerequisite for trusting ②'s urban
  numbers.
- **② industrial fiscal/monetary state** — designed (this doc). ②a (money
  off specie) is the load-bearing piece: it's the direct cause of the deflation
  that triggers the whole cascade. ②b follows; ②c is measure-first.
- **Then** re-run the deep tw=240/tw=480 battery to confirm the four-part
  industrial system produces a history-shaped modern world (magnitude,
  urbanisation, stability) before any default flip — which remains the owner's
  call.

This is the same class of work as the trade-decoupling arc (backlog #6): a
missing *system*, sketched cardinal-rule-safe, none auto-applied.

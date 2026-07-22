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

- **① resolution-invariant urban core** — **BUILT + validated** (`af19949`,
  default-off `URBAN_FOOTPRINT`, conservative radius keeps tw=240 byte-identical).
- **②a money off specie** — **BUILT + validated** through three refinements the
  deep battery forced: `67f4f6b` (decouple from specie), `9d8b4db` (reach-
  independent — reach-gated fiat fired on 2/140 hubs), `188b9a3` (sticky, not
  panic-recalled). Default-off `FIAT_OUTPUT`, byte-identical.
- **②b / ②c** — not built (②a's outcome changed the priority; see §7).

---

## 7. Battery results (all four levers, seed 8817) & the remaining arc

The deep from-scratch battery — the honest gate that a stable-world injection test
can't be — was run repeatedly as each ②a refinement landed. Net verdict:

**What the four-part stack achieves (validated, tw=480 = the player's grid):**

| tw=480 modern | baseline (IND+URB) | +①+②a (FIAT=4) |
|---|---|---|
| population magnitude | 2.40B | **4.03B** (toward real ~6B) |
| insolvency (realms) | ~4.0 | **~0.2** (eliminated) |
| oscillation (pop CoV) | 18% | **14%** (damped) |
| urban share | 9% | **21%** (was resolution-collapsed) |
| price (mean) | 0.20 (floored) | 0.37 (lifted) |

Real, substantial progress: higher magnitude, no fiscal collapse, milder cycle,
much better urbanisation. **Tuned lever values: `INDUSTRIAL_CAP=25, URBAN_IND=3,
URBAN_FOOTPRINT=1, FIAT_OUTPUT≈4`** (the out×REF proxy runs ~4× light; FIAT=1→P0.20
floored, 4→P0.95, 10→P2.66 inflation).

**Two characterised residuals (NOT fixed — the next arcs):**

1. **The modern price does not SUSTAIN.** It lifts at industrialisation onset
   (P≈1.4) but decays back to the floor (0.21) across the arc. Ruled out as the
   cause: the credit crunch (sticky-fiat `188b9a3` changed the price curve not at
   all — 0.41 mean either way). The **real cause is the price/money model's output
   measure**: `P = (M/T)/REF` with **T = *traded* output** (`exportValue×√people`,
   inflation.js:84-85). A modern economy is mostly *domestic* output (GDP), only a
   fraction traded; pricing the ×26 industrial economy against its shrinking trade
   fraction reads as deflation, and the fiat backing (also `exportValue`-based) is
   trade-sensitive for the same reason. **The next arc is a total-output measure of
   T** (population×productivity, not just trade) — a change to a *core validated
   subsystem* (inflation.js), deliberately NOT undertaken as a fourth default-off
   lever. This is a fresh arc, like trade-decoupling #6.
2. **Urban parity is partial** (tw=480 21% vs tw=240 31%). The conservative
   footprint radius (chosen to keep the reference byte-identical) is a smaller real
   area than full parity needs; closing it means the larger radius, which
   recalibrates the tw=240 reference and the stylized urban/Zipf gates — a
   deliberate tradeoff, not a bug.

**Sequence when resumed:** the T-measure rework (residual 1) is the load-bearing
next step — it's what makes the modern price, and thus the whole fiscal picture,
*stay* healthy. Then re-measure ②b/②c (a funded, non-deflating modern state may
already hold together). Only then, with the price sustaining, is the default-flip
decision (with the tuned values above) ready for the owner.

This is the same class of work as trade-decoupling (backlog #6): a missing
*system*, characterised cardinal-rule-safe, none auto-applied. Everything built
this pass is default-off and byte-identical; the levers are in and validated, the
remaining arc is precisely located in inflation.js's T.

---

## 8. Residual 1 BUILT — the total-output T-measure (`OUTPUT_TOTAL`) + the measured verdict

*(Appended a later session. Corrects §7's sequencing with what the battery showed.)*

**What was built.** §7 residual 1, as a default-off lever `OUTPUT_TOTAL` and ONE
shared `realOutputOf(s, world)` (settlement.js) that BOTH the price denominator T
(inflation.js:85) and the fiat backing (settlement.js, the FIAT_OUTPUT credit
target) now read — so numerator and denominator can never drift.

- **Off (default):** the traded-output proxy `exportValue × √people` — textually
  byte-identical to the two original inline expressions. `npm test` green (smoke
  166s + emblem, all checks); `npm run validate` green (all hard gates, 1 soft
  warning within budget). The shipped world is untouched.
- **On:** total (domestic) real output `people × _eraProd` — population × the
  productivity index that already scales carrying capacity (~1 forager → ~260
  modern, gated on the settlement's OWN development, never a clock). Its magnitude
  is fully absorbed by the live REF calibration (REF = M/ΣT at lock, so a constant
  re-scale of T cancels in both P and the fiat target) — only the SHAPE changes:
  linear in population, productivity-weighted, **trade-independent**.

**The measured A/B** (tw=120 = W240, seed 8817, the 4 industrial levers on,
FIAT=4; control `OUTPUT_TOTAL=0` vs treatment `=1`; deep-modern window, leadOrg=1):

| deep modern (org=1) | control (trade-proxy T) | treatment (total-output T) |
|---|---|---|
| monetisation M/peopleProd | 2.6 | **18.5** (≈7× better-funded) |
| insolvent realms (mean / max) | 2.5 / 7 | **1.0 / 3** |
| country count (fragmentation) | ~55 | ~50 |
| price P (people-weighted raw) | ~1.8 (CoV 0.15) | 2.0 → 0.23 (see below) |

**Verdict — necessary, but NOT sufficient (this corrects §7's optimism).** The
total-output T is the correct, load-bearing base, and it materially improves the
modern economy's MONETISATION (≈7×) and average SOLVENCY (mean insolvent 2.5→1.0,
max 7→3). But it does **not, alone, make the modern price *stay* healthy.** In the
treatment the fiat overshoots at industrial onset (P≈2), then the realm still
cycles into fragmentation (→61 countries) → per-hub organisation drops → the
org-gated fiat is called in → the money supply collapses (M 6.7M → 0.6M) → the
price deflates to the floor (P≈0.23) → insolvency → more fragmentation. The SAME
fiscal-political secular cycle §1 diagnosed. The T-measure smooths the DENOMINATOR
(peopleProd is stable across the arc); the instability has simply **moved into the
fiat money SUPPLY**, which stays fragile because it is gated on per-hub org and
collapses exactly when the realm it must fund breaks apart.

So §7's sequence ("residual 1 makes the price stay healthy; THEN ②b/②c") is too
optimistic. The honest reading: **total-output-②a and ②b/②c are CO-REQUIRED, not
sequential.** ②b (extraction that rises with development, keeping the modern state
solvent through the transition) and ②c (reach that holds the ×N realm together)
are what stop the fragmentation that collapses the org-gated fiat. Residual 1 is a
true, correct piece of that joint system — now in and validated-off — but a stable
modern price is a JOINT property of all three, as the battery shows.

**Resolution caveat.** This A/B is at tw=120 (coarser than §7's tw=240/480). At
tw=120 the baseline pathology reads as inflation-instability (P≈1.8, swinging)
rather than the tw=480 deflation-to-floor — but it is the SAME disease: the trade
proxy is the wrong base (measured peopleProd/Ttrade diverges ≈250× and widening
across the arc). The deep tw=240/480 re-confirmation is the same class of expensive
run §7 flags; the mechanism is resolution-independent.

**FIAT sweep result** (`OUTPUT_TOTAL=1`, deep-modern org=1; ran 1.5 / 4 / 8).
Raising FIAT in the total-output regime does NOT simply center the price — it
trades off cohesion against inflation:

| FIAT | price P (deep modern) | insolvent (mean) | countries (cohesion) |
|---|---|---|---|
| 1.5 | ~0.3 (stuck near the floor) | low then rising | ~52, fragmenting |
| 4   | 2.0 → 0.23 (overshoot, then spiral) | 1.0 | ~55 → 61 |
| 8   | mean 1.48, **CoV 0.75** [0.36–3.8] | 1.1 | **37.8, CoV 0.06** |

Higher FIAT monotonically improves COHESION (countries ~52 → ~38) and solvency:
FIAT=8 holds the realm together far better than the control (~38 vs ~55 countries,
CoV 0.06) — the "holds together because it can afford to" criterion is *largely met
at adequate monetisation*, and FIAT≈4 (carried over from the trade-proxy regime) is
simply under-calibrated for the larger total-output base. BUT the modern PRICE stays
volatile at EVERY level: deflated at 1.5, overshoot-then-spiral at 4, and at 8 it
overshoots to ~3.8, settles near ~1 for a spell, then still suffers periodic
fiat-collapse events (M 10M → 0.6M around step 92k → P to the floor). So the
price residual is NOT pure calibration — no single FIAT stabilises it; the
instability lives in the fiat money-SUPPLY dynamics (the org-gated credit ramp /
call-in that collapses when a realm fragments), which the T-measure doesn't touch.

**Net.** Residual-1 + a regime-appropriate FIAT (≈8, not the trade-proxy ≈4)
already buys the better half — ~7× monetisation, materially better solvency, and
genuine cohesion. A STABLE modern price additionally needs the fiat supply made
robust to fragmentation: ②b (extraction that funds solvency without leaning on
volatile fiat credit) and ②c (reach that stops the fragmentation that collapses
org-gated fiat). Co-required for price STABILITY — confirmed by the sweep, not
assumed. Nothing here is auto-applied; FIAT and OUTPUT_TOTAL stay default-off, and
the co-tuning + flip remain the owner's call.

**Cardinal-rule check.** Emergent (gates on the settlement's own `_eraProd` /
development, never a clock). A SYSTEM (the correct output measure), not a fitted
outcome — no price target dialed; and the finding that it is insufficient *alone*
is surfaced, not papered over with a constant. Default-off, byte-identical.

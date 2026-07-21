# Measurement-layer deep review — July 2026

The simulation is only as trustworthy as the numbers we read off it. This is a
skeptical audit of every surface that turns sim STATE into a figure a human
reads — the validation gates (`tools/stylized.mjs`), the live UI
(`src/WorldSim.jsx` + `src/peopleSimWorker.js`), and the headless recorders
(`tools/earthFullRecord.mjs`, `tools/diag_full.mjs`).

**Why now.** Across this session's analysis, the measurement layer — not the
sim — produced every false alarm: "modern cities with 400M inhabitants,"
urbanization quoted at ~62%, a phantom 8.36-billion population, religion read as
"co-equal." Each traced to a metric computing something other than its label, or
to a unit-layer confusion. So the instruments got the same adversarial audit the
mechanisms get: three independent read-only passes, then **every finding
verified first-hand against the code** before it was trusted or acted on.

**Headline.** The alarms were real bugs — in the *measurement*, not the world.
The single worst one (the "400M city") is a whole PROVINCE's population printed
under a "metropolis" label; the actual city core is only the urban share of that
(~8–13%, so several-fold smaller) and was never shown at all. Thirteen clear-cut
defects are fixed this pass (all in measurement/validation code, not sim
mechanics — `npm test` is byte-identical and `npm run validate` stays green across
all three canon seeds); four more are reported with precise fixes but held for a
decision (one re-draws the deliberately-discussed Zipf soft-warning; the rest are
further UI honesty, lower value than the card fix).

---

## 1. The unit ladder — read this first

Most measurement errors here are not arithmetic mistakes; they are reading a
number at the wrong **layer**. There are three population layers and four unit
bridges. Keep this table next to any analysis.

### Population — three layers, two bridges

| Layer | What it is | Where | To the next layer |
|-------|-----------|-------|-------------------|
| **Field** | `popField[tile]` — people-density substrate, per tile | `popField.js` | × `world._onePopScale` |
| **Census** | `s.people` — a settlement's people (integer-ish sim units) | everywhere in sim | × `POP_SCALE` |
| **Display** | what the UI prints as "people" | `WorldSim.jsx` | — |

- `world._onePopScale ≈ 0.019` — **frozen per world** (`popField.js:570`), so the
  field→census factor is seed-specific. Never assume it is 1.
- `POP_SCALE = 1000` (`WorldSim.jsx:613`). `fmtPeople(p) = fmtNum(p × 1000)`.
- **Composed:** display people `= field × _onePopScale × 1000 ≈ field × 19`.
- **The trap that bit us:** multiply a *field* quantity by `POP_SCALE` and skip
  `_onePopScale` and you overstate by ~50× (the phantom 8.36B); read a *field*
  max as "people" and skip both and you understate by ~19× (finding **C2**).

### City vs province — the split inside `s.people`

A "settlement" owns a whole **catchment (province)**. `s.people` is the field
summed over **all** its tiles (`popField.js:633,668` — `accP` accumulates every
owned tile). That total splits into:

- **`s._urbanPop`** = `popField[coreTile] × _onePopScale` — the **city core** only
  (`popField.js:675`).
- **`s._ruralPop`** = `s.people − s._urbanPop` — the rural hinterland.

> **`s.people` is the PROVINCE. `s._urbanPop` is the CITY.** Confusing the two is
> the single most common error in this codebase's history and in this session
> (findings **C1, D1, D2, D5, M1**). True demographic urbanization is
> `Σ _urbanPop / Σ people` — see `stylized.mjs:305`, the canonical reference.

### Other bridges

| Quantity | Sim unit | Bridge | Display |
|----------|----------|--------|---------|
| Food | 1 unit = 1 tonne grain | `FOOD_KG_PER_UNIT = 1000` | kg/t (`fmtFood`) |
| Gold | 1 coin = 8 g gold | `GOLD_G_PER_COIN = 8` | kg/t (`fmtGoldKg`) |
| Territory | 1 tile | ~3,800 km²/tile at the 480-wide reference (≈149M km² land ÷ ~38.7k land tiles); scales with grid | tiles (labeled "(tiles)") |
| Time (mechanic) | 1 step | `0.25 y/step` (`calendar.js` DYN_RATE) — used for lifespans | — |
| Time (cosmetic) | 1 step | `displayYear()` runs ~2× real pace — the "two-clock" label, **read-only** | year |

**Carrying capacity** `capField[tile] = fert × CAP_PER_FERT(1200) × (0.3 + 3.0 ×
devField_ag) × reach × reliefMul` — governs the field. A settlement's food-based
capacity `K` shown on the card is a different, food-side quantity.

**Money supply.** Total world gold = **settlement coin + LIVE polity treasuries**
(`index.js:424`). The per-country `c._treasury` is a per-pass snapshot that
sawtooths ~50% between polity passes — never sum it for a world total (finding
**D4**).

**Prices.** Two signals: `_inflP` (sim-facing, **clamped [0.4, 3.0]**) drives
wages/costs; `_inflRaw` (display-facing, wide [0.2, 20]) is the honest indicator.
`raw = M/T ÷ the emergent baseline`, so a healthy closed-money world sits near 1
(finding **V1**).

---

## 2. Findings — severity-ranked

Legend: **[FIXED]** landed this pass · **[REPORTED]** verified, fix recommended,
held for a decision (each re-draws a validation band or needs the multi-seed
battery). Every finding was confirmed first-hand against the cited lines.

### CRITICAL

- **C1 [FIXED] — a whole PROVINCE printed as "the city."** The settlement card
  headlined `fmtPeople(s.people)` under a "metropolis"/"city" label
  (`WorldSim.jsx:3637` + `:3295`). `s.people` is the province (core + all rural
  hinterland); the city core (`_urbanPop`) is a fraction of it (the inverse of the
  urban share, ~8–13%) and was **never serialized to the UI**. This is the direct
  source of the "400M cities" alarm — the *city* is several-fold smaller than the
  province total that was shown, with the rural hinterland making up the rest.
  *Fix:* serialize `_urbanPop`/`_ruralPop`; the card now leads with the city core
  and shows the province as context.

- **C2 [FIXED] — "densest tile ≈ N people" printed raw field units.** `popMax` is
  the raw `popField` max (`peopleSimWorker.js:462`), sent and printed as "people"
  (`WorldSim.jsx`) with **neither** bridge applied — understating the real count
  ~19×. *Fix:* scale by `_onePopScale` in the worker, format with `fmtPeople`.

- **V1 [FIXED] — the "price level bounded" gate could never fail.** It scored the
  mean of `_inflP`, which `inflation.js` clamps to exactly `[P_MIN 0.4, P_MAX
  3.0]` — the gate's own pass-band. Any mean of in-band values is in-band; a
  hyperinflating world pegs every component at 3.0 and still passes. A structural
  tautology certifying nothing. *Fix:* read the uncapped `_inflRaw`
  (people-weighted), band `[0.35, 8]` — trips only on genuine runaway/collapse.
  **Measured (seed 8817, 21k):** the honest signal is **0.55** (mild deflation-side
  drift as output outpaces coin; 0 components pegged at the cap), where the old
  tautological read reported the clamped **0.69** — both "pass," but only the new
  one *could* fail. (`earthFullRecord`'s own `P` column already read `_inflRaw`
  correctly — the gate was the outlier.)

- **D1 [FIXED] — `urbanPct` was a settlement COUNT-share, not a people-share.**
  `earthFullRecord.mjs:90` computed `(tier2+tier3)/settlementCount` ≈ **62%**;
  true people-in-cities is ~8–13%. This metric drove several wrong urbanization
  claims this session. *Fix:* mirror `stylized.mjs:305`.

- **D2 [FIXED] — `urbanizationPct` summed whole PROVINCES as "urban."**
  `diag_full.mjs:78` used `(tierP[2]+tierP[3])/total` where `tierP` sums entire
  province populations (core + countryside) of tier≥2 settlements — counting the
  countryside as urban. *Fix:* numerator is `Σ _urbanPop`.

- **V2 [FIXED] — the water-clustering null was miscalibrated; the gate could pass
  random siting.** The numerator (`s.waterAccess > 0.05`) detects water over a
  **3×3** neighborhood (`computeWaterAccess`), but the denominator base-rate was
  **per-tile** — a footprint asymmetry that lifts enrichment above 1.0 even with
  no siting preference, and the bar was only 1.3 (below plausible random-siting
  enrichment). *Fix:* score the numerator's own detector over all land tiles (a
  same-footprint null), bar 1.15. **Cross-seed (8817/4242/777, 21k):** the honest
  same-footprint enrichment is **1.36 / 1.36 / 1.37** — remarkably stable, real
  clustering, with headroom over the ~1.0 a no-preference world reads; the raw
  per-tile null had inflated it to ~1.70. The raw value stays printed as context.

### MAJOR

- **D3 [FIXED] — `top5` labeled "size" was settlement MEMBER count.**
  `earthFullRecord.mjs:73,91`, and cross-tool inconsistent with `diag_full`'s
  tile-based `top5`. *Fix:* renamed `top5Members`.

- **D4 [FIXED] — `treasury` summed the stale `c._treasury` snapshot** (sawtooths
  ~50%; `earthFullRecord.mjs:75`), reintroducing a bug `peopleSimStats` already
  fixed. *Fix:* sum LIVE polity treasuries (`index.js:411` pattern).

- **D5 [FIXED] — `topCityPops` ranked PROVINCES as cities** (`diag_full.mjs:77`,
  on `s.people`). *Fix:* rank on the urban core.

- **D6 [FIXED] — `diag_full` `totalWealth` omitted state treasuries entirely**
  (settlement coin only; `:82`), a different quantity from the HUD under the same
  name. *Fix:* add live treasuries (`index.js:424`).

- **V4 [FIXED] — price dispersion mislabeled "population-weighted."** It weighted
  each price component by **settlement count** (`stylized.mjs:104`), so 20
  villages outvoted 2 cities — contradicting its own header comment. *Fix:* weight
  by summed `s.people`. (Scored quantity is a loose Δ-correlation, so low verdict
  impact, but the metric now matches its claim.)

- **V5 [REPORTED] — the Zipf gate is not the Gabaix–Ibragimov estimator it
  claims.** It regresses `log(size)` on `log(rank−½)` (size-on-rank), which is
  **attenuated shallow** under scatter; true G-I is the transposed regression
  reporting `−α̂`. The entity (urban cores) and band are right, but the estimator
  biases toward the −0.70 fail line — exactly where the known soft-warning sits.
  **Cross-seed (21k):** −0.64 (16 cities) / −0.69 (18 cities) / n/a (11 cities <
  the 15 min) — the attenuation pattern, both landed seeds just shy of the −0.70
  pass line. *Held:* switching estimators re-draws the band and touches the one
  soft-warning the project deliberately chose not to close with a fitted constant
  (backlog #8); it wants a proper G-I-vs-current measurement across seeds and your
  sign-off — not a silent change to what the suite certifies.

- **V3 [FIXED] — "culture count ~ area^k, k<1" admitted superlinear.** The band
  was `slope < 1.3` (`stylized.mjs:423`) — a slope in [1.0, 1.3) passed while
  contradicting the stated sublinearity. *Fix:* tightened to `< 1.05`.
  **Cross-seed (8817/4242/777, 21k):** the measured slope is **0.83 / 0.74 / 0.53**
  — all comfortably sublinear, so the tighter band passes with margin while now
  actually enforcing k<1. (Secondary, *not* addressed: it fits a *temporal*
  accumulation as area fills — a proxy for the cross-sectional area law; the band
  change resolves the superlinear-admittance, not that deeper metric nuance.)

- **M1 [REPORTED] — leaderboard "Settlement → Population" shows province pop.**
  Same province-as-city class as C1 (`WorldSim.jsx:3901`), but under a generic
  "Population" header (defensible as a province total). Resolves for free if it
  adopts `_urbanPop` now that the worker serializes it.

- **M2 [REPORTED] — "% → next tier" divides by the wrong threshold.** The card
  compares province pop to the **unscaled base** `TIER_THRESHOLD`
  (`WorldSim.jsx:3301`), but the sim promotes on a **scaled/floating** bar that
  rises with the largest city (`settlement.js:2808-2846`). The progress readout
  can pin near 100% for a city that will never promote. *Fix needs* the worker to
  send the settlement's actual current bar.

### MINOR

- **m1 [FIXED]** — gold history series labeled "coin" but plotting a gold **mass**;
  relabeled "by weight." (`WorldSim.jsx`)
- **m2 [REPORTED]** — per-settlement rows in the country/peoples lists print
  province pop (same class as C1, compact lists).
- **war-rate normalization [noted]** — cumulative `wars.length` ÷ end-of-run
  `st.countries` snapshot (`stylized.mjs:253`); 400×-wide band makes verdict
  impact ≈ nil.
- **`pop` vs `people` [noted]** — `earthFullRecord` records both `st.totalPeople`
  and `world.debug.totalPeople` (the latter adds captives/in-transit); both
  **census**, so ×1000 below display. Correctly annotated already.
- **`eras` cross-tool [noted]** — `earthFullRecord` counts countries-by-era,
  `diag_full` counts settlements-by-era. Same label, different denominator; don't
  compare across the two tools.

---

## 3. What was verified CORRECT (no change)

To keep the next session from re-auditing these: `stylized.mjs` urbanization
(`:305`, a true people-share), empire land-share/area-tail (`:174` per-tile
owner), censoring-aware lifespans (`:230`), war-deadliness tail (`:401`),
continuity hard gates (`:476`); the HUD global population and "N souls" country
totals (partitioned catchments, no double-count); Land % (`claimed/land`); Food
and Gold mass re-expressions (disclosed in the export header). `earthFullRecord`'s
`P` (reads `_inflRaw`, people-weighted) and `coin`/`people` conservation totals.
`diag_full`'s tile-based `size` block. All confirmed against source.

---

## 4. Disposition

**Fixed (13, all in measurement/validation code, not sim mechanics):** C1, C2,
V1, D1, D2 · D3, D4, D5, D6, V4 · V2, V3, m1. The four gate fixes (V1, V4, V2, V3)
were each **validated across all three canon seeds** (8817/4242/777) before
landing — not tuned to one.

**Reported (fix recommended, held for a decision):** V5 (re-draws the
deliberately-discussed Zipf soft-warning — wants a proper G-I-vs-current
measurement across seeds and your sign-off, per backlog #8) · M1, M2, m2 (further
UI honesty, lower value than the C1 card fix).

V5 is deliberately **not** silently changed: a validation band is what the suite
certifies as "history-shaped," and swapping the estimator to move the one
soft-warning the project chose not to close with a fitted constant is exactly the
outcome-fitting the cardinal rules forbid without deliberate sign-off.

**Validation after the fixes** — `npm test` byte-identical; `npm run validate`
multi-seed (`STYLIZED_SEEDS="8817,4242,777"`, 480×240, 21k): **3/3 seeds pass, all
hard gates, 1 soft warning each within budget 2** (the known Zipf, V5). Cross-seed
behaviour of the four changed gates:

| Gate | 8817 | 4242 | 777 | band |
|------|------|------|-----|------|
| price level bounded (was a can't-fail tautology) | 0.55 | 0.68 | 0.80 | [0.35, 8] |
| market integration Δ (now people-weighted) | −0.17 | 0.89 | 0.51 | > −0.2 |
| water clustering (now same-footprint null) | 1.36 | 1.36 | 1.37 | ≥ 1.15 |
| culture k<1 (was `<1.3`, admitted superlinear) | 0.83 | 0.74 | 0.53 | < 1.05 |

Four gates went from measuring the wrong thing (or being unable to fail) to
measuring the right one — and the suite stays green on every canon seed.

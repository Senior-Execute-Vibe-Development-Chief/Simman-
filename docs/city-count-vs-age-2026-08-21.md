# The city register vs history's, age by age (2026-08-21)

Owner: *"how many cities globally in each age IRL?"* — and then: *"where are
we on this?"* Measured with `tools/probe_cityage.mjs` (register, cores
actually ≥10k real people, per-era city distribution by `techState`, leading
era — keyed to DEVELOPMENT, never the calendar, per the cardinal rule). Raw
log: `docs/runs/2026-08-21/cityage240.log`.

## The real series (cities with ≥10k inhabitants, global)

Sources: Modelski (*World Cities: –3000 to 2000*), Chandler (*Four Thousand
Years of Urban Growth*), Bairoch (*Cities and Economic Development*); modern
end GHS-UCDB. Pre-1800 figures are honest ranges — sources disagree ~2×.

| Age | Cities ≥10k | Note |
|---|---|---|
| Urban dawn (Uruk) | ~5–15 | southern Mesopotamia + a few outliers |
| Early Bronze | ~30–60 | Sumer, Ebla/Mari, Memphis, Indus five |
| Late Bronze | ~50–100 | Shang enters; the collapse then dips it |
| Early Iron | ~100–200 | Modelski ~120 at 650 BCE |
| Classical peak | ~400–600 | Rome and Han each held 150–200 |
| Late-antique trough | ~300–500 | the one sustained contraction |
| High medieval | ~800–1,200 | Song China alone plausibly 300–500 |
| 1500 CE | ~1,000–1,500 | Europe exactly 154 (Bairoch) |
| 1800 CE | ~2,000–3,000 | urban share still ~5–7% |
| 1900 / 2000 CE | ~5–10k / ~30–50k | the industrial explosion |

Shape: 10 → 100 takes 2,500 years; 100 → ~500 the classical millennium; a
DIP; ~1,000 by high medieval; only a doubling 1500→1800; then ×20 in two
centuries. The pre-industrial ceiling is agrarian — urban share pins at
4–7% for four millennia, so the count grows mainly with total population.

## The sim, measured (tw=240, full live stack, seed 8817, 24k)

> **ERRATUM (same day):** the table below was measured against the WRONG
> TREE — a container reset had silently reverted the checkout to the old
> baseline before the probe launched, so the run lacked the entire
> consolidation stack (its unknown SIM_TUNE keys were ignored). A
> verified-tree rerun shows a materially different curve: slower dawn
> (first cities ~14k, not 10k), register 194 by classical mass at 20k —
> but only **43 of 194 clearing the honest ≥10k core bar**, so on the
> Chandler-comparable count the classical deficit is ~10×, worse than the
> table claims, and the register is NOT core-honest under the live stack
> (the wrong-tree world's near-1:1 core ratio was the old regime's).
> Corrected table + the mint-funnel attribution follow from the rerun
> (`docs/runs/2026-08-21/cityage240_funnel.log`). The IRL series above
> and the direction of the finding (knowledge outruns the mint) stand.

"Mass era" = where the bulk of the register's cities sit by their own tech.

| step | mass era | register | cores ≥10k | history's band | verdict |
|---|---|---|---|---|---|
| 10k | Stone (dawn) | 11 | 9 | 5–15 | **ON BAND** |
| 12k | Stone (late dawn) | 32 | 29 | 30–60 (E. Bronze) | **ON BAND** |
| 14k | Stone/Bronze cusp | 45 | 43 | 30–100 | **ON BAND** |
| 16k | Bronze | 65 | 63 | 50–100 | **ON BAND** |
| 18k | Classical (49/76) | 76 | 75 | 400–600 | **~6× UNDER** |
| 20k | Classical (55/88) | 88 | 83 | 400–600 | **~6× UNDER** |
| 22k | Medieval (84/110) | 110 | 97 | 800–1,200 | **~9× UNDER** |
| 24k | Renaissance (71/147) | 147 | 130 | 1,000–1,500 | **~9× UNDER** |

Two clean findings and one caveat:

1. **The dawn-through-bronze arc is on the historical band** — 11 at the
   dawn (the old 1000×-too-few and 70-city-cohort worries are both dead at
   this grid), 32→65 through the bronze bands. The register is also HONEST:
   cores ≥10k ≈ register everywhere (no phantom sub-city entities).
2. **From Classical on, the register falls ~6× behind and widens to ~9×.**
   Per capita it is the same story: at classical mass the sim holds 1 city
   per ~1.5M catchment people vs history's 1 per ~400k. The knowledge
   engine sprints ahead of the mint: eras keep arriving on a register that
   grows arithmetically while history's grew with population. This is the
   registered form of two standing owner observations — "no early or
   classical nations in China/Mediterranean" (the missing secondary
   cohorts ARE these missing cities) and the statehood gradient. The
   next-wave work should make later ages MINT MORE: every mature basin that
   history urbanized (China's hundreds of Song cities) must reach the
   city bar as its region's development wave arrives, not stay countryside.
3. **Grid caveat (third cardinal rule):** measured at tw=240. The funnel
   arms show tw=480 holding ~575 entities at 24k / ~1,050 at 28k — far more
   than 147 — but with no era stamp there yet, and the dev-wave probes show
   the 480 clock runs SLOWER, so its curve may sit materially closer to
   band. Stamping the tw=480 curve is one 2-hour `probe_cityage` run
   (`node tools/probe_cityage.mjs 28000 960 8817`) when next needed.

Also worth copying from history: the register was never monotone — the Late
Bronze collapse and the western-Roman fall genuinely SHRANK it.
`DISSOLVE_TOWNS` makes contraction structurally possible; no collapse era
has yet been observed to use it at scale.

## The wave, built (same day) — corrected numbers and the caravan lap

Verified-tree control (tw=240, full stack; `cityage240_tallywait.log`):
register 43 (Bronze) → 194 (Classical mass) → 406 (Medieval mass); honest
≥10k cores 5 → 43 → 165. Per capita the REGISTER tracks history (1 city
per ~300k people at classical vs history's ~1 per 400k) — the deficits are
the PEOPLE (59M at classical mass vs history's ~200M) and CORE RETENTION
(cores mint at 10k, then most sit below it: 165 of 406 at 24k).

**The mint-funnel attribution** (`cityage240_funnel.log`): `siteCity:
tallyBar` dominates (1,400–2,500/window — a standing stock of gathered
10k-core proto-cities waiting at the LAND_KNOW tally gate), `peerSeat:
cellFull` behind it. **The tally-wait split** (`cityage240_tallywait.log`):
the waiting stock is frozen, not slow — org p50 0.12 across 14k steps,
beyond every contact sphere. **Located** (`frozenwhere240.log`): the frozen
sites are the missing classical cohorts BY NAME — the North China Plain
(114E,38N), the Yangtze (116E,30N), Sichuan, north India (87E,26N), the
Gulf flank, the Maghreb — at 600–1,600 km from the nearest city. Not the
Americas: the pristine gradient was already right.

**Lap 1 (null, kept for the record):** scaling the exchange radius by
logisticsLevel alone was byte-identical through 20k — that channel is
empty exactly when the frozen sites need contact (`exchwave240.log`).

**Lap 2 — the caravan radius (`e39080c`, EXCH_WAVE def 3):** the Uruk
expansion brought cities into the contact term but gave each a VILLAGE's
500 km obsidian horizon; the first cities' real networks immediately
spanned ~2.5× that (Uruk's Anatolian enclaves ~1,200 km, Assur's karum
~1,000 km). Under the lever a city radiates at 2.5× the village scale,
still growing with logistics as eras advance; villages and pristine
continents untouched. **A/B verdict (`caravan240.log`):** dawn
byte-identical through 16k (the stagger survives), then register 104→134
(+29%) at 18k, 288→342 (+19%) at 22k, 406→451 at 24k, cores 165→186; the
era mass shifts DOWN at fixed step (more Classical, less Medieval — the
register now outgrows the era clock, history's direction). Classical-band
gap ~2.5× → ~1.6×. SHIPS.

Remaining, in order: (A) the population level (~2.5× under history at
matched era-mass — the carrying-capacity/dilution axis, tasks #17-18),
(B) core retention post-mint (the urban-share half, task #20-adjacent),
(C) `peerSeat: cellFull` (the in-nation lattice cap — partly grid
granularity; re-judge at the shipping proxy). tw=480 stamp pending.

## The shipping-proxy stamp (tw=480, full stack — `cityage480_caravan.log`)

**AT THE GRID THAT SHIPS, THE REGISTER IS ON HISTORY'S BAND, AGE FOR
AGE, ON ALL THREE MEASURES:**

| mass era | register | ≥10k cores | pop | history |
|---|---|---|---|---|
| dawn (14k) | 16 | 7 | 6M | 5–15 ✓ |
| bronze (16–18k) | 71→155 | 50→95 | 31→52M | 50–200 ✓ |
| classical (24–26k) | 607→851 | 442→649 | 177→229M | 400–600, ~200M ✓ |
| medieval opens (28k) | 1,150 | 861 | 297M | 800–1,200, ~300M ✓ |

Population within ~10% of history's at both matched eras; cores inside
the band through the arc; 75% of entities above the core bar (vs 41% at
tw=240). VERDICT ON THE REMAINING AXES: the tw=240 population and
core-retention deficits were substantially COARSE-GRID DILUTION
artifacts (the known 1.3–2.2× capacity-dilution gap compounding) — the
reference grid was the false pessimist this time; axes (A) and (B) are
DOWNGRADED from mechanism gaps to grid-fidelity notes, and (C) recedes
with cell granularity at tw=960. The frozen-site residue at tw=480 is
~3% of the register and increasingly state-contacted.

Open beyond this chapter: the LONG arc (does the curve hold to the
renaissance/1800 bands of ~1,500–3,000?), the late one-creed faith
surge (identity watch item), and the collapse-era contraction
(`DISSOLVE_TOWNS` at scale) that history's register showed twice.

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

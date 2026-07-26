# Civ-engine backlog — verified against HEAD, July 2026

A 48-item sweep of open civ-sim issues, each **verified against the current
code** (not the stale July review). Method: one skeptical read-only agent per
item, default stance "assume it may already be fixed, prove it from the code,"
every proposed fix checked against the two cardinal rules and determinism.

**Headline: 25 of 48 were already fixed on HEAD** — the `review-2026-07-*` docs
predate the war-termination, one-population, empire-consolidation, and dynasty
work. What actually remained: five real fixes (now landed), a handful of
mechanism-design arcs, and four owner decisions.

Status legend: **DONE** (landed this pass) · **fixed** (already fixed before
this pass) · **design** (needs a mechanism, sketched) · **owner** (a decision
for you) · **infra** (blocked by tooling, not code).

---

## DONE — landed this pass (cardinal-rule-clean, gated on emergent state)

| # | Item | What changed |
|---|------|--------------|
| 13 | Resolution-variant near-query radii | The 5 raw-tile radii (colony saturation, overseas landing, slave reach, culture & faith homelands) now × `rNormPop`. **Byte-identical at the 480 reference** (rNorm=1); only fine grids change — closes the last RES_INVARIANT_POP gap. |
| 34 | Construction tech learned off raw province pop | Routed the "more minds" term to the urban core (`sciSqrt`), matching organization/metallurgy/navigation/mobility. Closes the raw-pop leak into `orgEraCap` → the world clock — the exact bug the urban-core comment (settlement.js:1510) was written to fix. |
| 42 | Global nationalism signal | Loyalty habituation now reads **each realm's own capital-organisation era** (`identityWeightsFor`), not the planet-wide leader. An uncontacted ancient continent no longer gets modern-nationalist habituation the instant someone else industrialises. |
| 40 | Memberless dynasty husks pile up forever | New `pruneDynasties()` drops extinct, unreferenced houses (zero living kin + not any living realm's ruling/roll house). Size-floor gated so short runs stay byte-identical; frees the persons floor too. |
| 48 | Dead code | Removed the dead exported `localPByCountry` (zero callers). Verified `SEA_WOBBLE`/`CAPITAL_ANCHOR` still live — left alone. |

#34/#42/#40 intentionally change the reference trajectory (a dev-time hash
re-bless); all stay green on `npm test` and `npm run validate` (below).

---

## fixed — already resolved before this pass (25), no action

The review's premises are stale; each is resolved on HEAD:

- **1 War saturation** — a full state-gated war-termination stack exists:
  war-exhaustion attack-bar, dyadic truces on exhaustion/stalemate, indemnities,
  congress joins, capitulation→vassalage (`armies.js` advanceFronts; D81 landed).
- **3 dead cavalry/mobility tech**, **4 demographic transition**, **5 tech
  ceiling / endgame** (I99 `arc.complete`), **9 fine-grid dev clock**, **10 pop
  scales res²** — addressed by the res-invariance + one-population work.
- **18 vassalage** (bendTheKnee), **20 admin-tenure adoption**, **43 fitted
  empire stabilizers** (CAP_MODEL) — built.
- Review correctness bugs, verified fixed: **25** river max-pool, **26** pop
  clamp, **27** food from claimed land, **28** fishing tech, **29** virgin-soil
  filter, **30** zombie adoption, **31** sea/strait catchment, **32/33**
  information horizon, **36** granularity (`_dt`/`_ivl`) sweep, **37** wealth
  HUD, **39** coin conservation, **41** culture/faith.
- Validation honesty: **44/45/46** — hard gates, city-ranked Zipf with
  Gabaix–Ibragimov correction, and a lifespan tail incl. living all reworked.
- **7 one-pop Slice C** — substance reads (muster/power/province/birth/grievance)
  are already field-grounded and default-on; only cosmetic Σs.people aggregates
  remain (documented by-design).

---

## design — needs a mechanism (sketched, not landed)

Real gaps that require building a *system*, not a patch. Each has a
cardinal-rule-safe design; none auto-applied.

- **2 Hegemon ossification (residual).** The extreme "immortal cradle" form is
  gone; a seed-dependent late-game top-slot lock-in survives (measured: healthy
  turnover on 8817, one realm holds #1 for the back 40% on 31337). *Design:* an
  endogenous-fracture force that grows with a realm's *internal complexity* —
  many strong, far provincial power-bases relative to central reach compound the
  existing overmighty-governor ambition into secession (elite-overproduction /
  secular-cycle). Keyed on accumulated state, never tick-age.
  > **MEASURED 2026-07-26 — CLOSED, already fixed on HEAD; nothing built.**
  > New standing instrument `tools/probe_hegemon.mjs` (suzerainty-root #1
  > tenure + mortality + fall-event attribution + the governor-bar internals),
  > 3 seeds × 24k @480: the lock-in reproduces NOWHERE — back-40% longest hold
  > 2250–2500 steps (9–12 #1 changes), 31337 churns hardest, and polity
  > mortality RISES ~30× into maturity (0.25–0.38 → 7.3–10.3 deaths/1k) — the
  > inversion of the ossification signature. The killing is attributed:
  > capital-storm shatters dominate (220–268 per back-window), then conquest
  > endings, strain sheds (top realms sampled at strain 4.6–12.8), and
  > war-termination's capitulation-vassalage; `polity.restored` runs 9–23.
  > The W6-C/D/F counter-force stack did the job. One finding survives: the
  > overmighty-governor elite channel is INERT (ambition ≈0 everywhere; the
  > 0.55-ratio and 0.5-far bars close as realms mature) — deliberately left
  > unbuilt per cardinal rule 2, with the fracture blueprint + resume trigger
  > parked in `docs/hegemon-ossification-2026-07.md`.
- **6 Zipf city-size tail (the "hinterland throttle").** Cores stay ~0.04 short
  of target slope for lack of inter-regional migration. *Design:* a *bounded*
  inter-regional labour draw in `urbanConcentrate()`, firing only when a genuine
  primate core has exhausted its own hinterland, braked by the existing
  density-graded urban graveyard. (Flagged in `one-population.md` as the open
  next arc.)
- **14 Amphibious over-consolidation.** *Design:* a separate emergent
  **naval-power contest**; amphibious crossing becomes a *gate* on winning it,
  not another multiplier on the land bar. Ship behind a default-off (byte-
  identical) lever pending the validation battery.
- **16 Per-country encirclement.** Likely **already served** by
  `eliminateEnclaves` + `WAR_REACH`; step 0 is to measure whether a residual
  pathology even survives before building — if not, retire the inert
  `ENCIRCLE_PENALTY` lever.
- **21 Incremental sea flood (perf).** *Design:* a change-signature skip +
  frontier-driven flood; deliberately changes the lane cadence, so a validated
  change, not a silent one.
- **35 Dead tech outputs** (`wealthMult`, `embark`/`ocean`/`colonize`).
  *Design/owner:* wire to real mechanisms (treasury depth; seafaring gates) *or*
  delete the advertisements. Wiring changes bands; removal is behavior-neutral.
- **38 Treasury hoard-then-dump (residual).** Army wages already meter out
  continuously (I93). *Design:* mirror that smoothing for discretionary outflows
  (monuments/infra/relief/court share) — rate = budget ÷ passTicks, no fitted
  target hoard-%.

---

## owner — decisions (recommendation in parens)

- **8 ONE_POP ships with 1 Zipf soft-warning/seed** — keep the flip (mechanism
  is cardinal-rule-clean; the ~0.04 gap was deliberately *not* closed with a
  fitted constant) vs revert to off until Zipf lands in band. *(Recommend: keep.)*
- **15 Coalition armies (`ALLY_FRONT`)** — capability complete & clean; only the
  default value is in question. *(Recommend: keep 0 — the offensive half distorts
  the map via dogpiling.)*
- **23 Sea-trade partner cap (`SEA_MAX_PEERS=64`)** — 64 is what lets the full
  Europe↔Indies spice run form; in-code profile says trade isn't a top-2 tick
  cost. *(Recommend: keep 64 unless a real profile says otherwise.)*
- **47 Retire `ANCHOR_POP`?** — already off by default, byte-identical,
  de-clocked, self-labelling; retains A/B value (the land×tech model
  under-produces the modern world ~100×). *(Recommend: keep for now.)*

---

## infra — blocked by tooling, not code

- **11 Grid-variant river magnitude.** The fix is one line (`RES_INV_RIVER
  def:0→1`, byte-identical at the reference) but flipping it needs the 1920
  windowed multi-seed battery — which is #12.
  > **DONE 2026-07-25.** #12's battery ran; verdict green on both seeds
  > (realms ×1.35–1.6 recovery, no systematic pathology); stylized at 1920
  > under the lever passed; hashbase A/B proved 480 byte-transparency.
  > `RES_INV_RIVER` def 0→1 — the last dormant lever ships.
- **12 1920/rs=4 validation.** Not a code bug — the run outlives the container.
  *Path:* drive the 1920 battery through the existing resumable recorder
  (`earthFullRecord.mjs` checkpoints every 10k, resumes via `RESUME=`), scoring
  claimed-% and biggest-km² from its series output across windows.
  > **DONE 2026-07-25.** `battery_resumable.mjs` chunk loops carried the
  > 4-way to 30k at 1920 inside one session (~2.5h under 4-way contention);
  > the recorder now APPENDS series rows on resume (it truncated per chunk —
  > fixed), series rows carry `landPct`, and `tools/score_resinv.mjs` prints
  > the windowed off-vs-on verdict. Artifacts under `bench/resinv1920_*`.

---

## also noted (low-value / intentional)

- **17 Sovereignty via CITY_TIER label** — residual is intentional; every
  functionally-independent centre already has a function-based route to
  sovereignty (`_sovereignSeat`, frontier founding, secession).
- **19 Political-map pass order** — cores-first structure satisfied by the
  field-polity rewrite; only a measurement-gated perf prune of possibly-dead
  cartography passes remains.
- **22 Border-crawl perf** — `relaxClaim` is still a full-grid ring scan; a
  frontier-set crawl would reproduce it byte-for-byte at lower cost (pure perf).
- **24 Declarative persistence for tile maps** — a settled owner decision to
  leave hand-coded (heterogeneous arrays); only residual is folding the
  `ADOPT_ADMIN` fields in when that feature is productionised.

---

## Validation (this pass)

`npm test` green — determinism, invariants (zero violations), save/load
roundtrip hash-identity. `npm run validate` (seed 8817, 480×240, 21k) — **all
hard gates passed, 1 soft warning within budget** (the known ONE_POP Zipf).

Effect of the landed fixes (before → after, seed 8817): urbanization 11.5 →
15.8 %; tech ~ cradle-distance −0.46 → −0.64; Zipf `n/a (7 cities)` → measurable
−0.64 (16 cities); fallen polities 23 → 54 (more churn); all still in band.

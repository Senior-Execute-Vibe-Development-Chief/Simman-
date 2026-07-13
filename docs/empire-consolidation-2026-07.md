# Too few / too large / half-empty — measured diagnosis + the comboE fix (2026-07)

Continuation of `country-count-size-diagnosis.md`. User report (still true on HEAD):
early realms too large/spread for the bronze age; mid-late **too few, too large**;
late game **never claims all the land** (and coverage even *retreats*). This doc
records what actually drives it, what does NOT move it (with evidence), the
measurement gotchas that cost us, and the value-lever combination that fixes all
three axes while KEEPING amphibious war — validated against the stylized gate.

All numbers: app-identical pipeline (`tools/_harness.mjs buildSim`), seeds 8817 +
4242, 480×240 unless noted. **The metric is windowed** (see gotchas).

## The measured shape (HEAD, `tools/diag_full.mjs`, 960×480, seed 8817)

| step | countries | claimed (land) | top realm | note |
|-----:|----------:|---------------:|----------:|------|
| 3000 | 9 | 2.8% | 309 t | bronze; realms already span ≥2 landmasses |
| 25000 | 24 | 26.9% | 2036 t | peak count |
| 35000 | 21 | 46.1% | 3994 t | industrial transition; peak coverage |
| 50000 | **14** | **29.4%** | 3438 t | consolidated + **coverage RETREATED** |

Top-5 realms are **immortal** (ages 29k–49k in a 50k run); the hall-of-fame top is
all-alive. `probe_empires` flows: `captured=0` the entire run (the TILE_WAR rarely
storms a capital — the only way a realm dies), consolidation is all peaceful
`annexed`; hundreds of small realms `shattered`/`ended` while the giants never fall.

## Root cause (rigorous): AMPHIBIOUS WAR

Windowed, 2-seed test (`probe_avg.mjs`), what robustly moves the realm count:
- suppress peaceful absorption (`ABSORB_ORG_MIN=0.95,ABSORB_DOMINANCE=5,ABSORB_FORCE=12`):
  **no effect** (19→17). Not the channel.
- amphibious OFF (`AMPHIB_BAR=0`): **19→26 realms, coverage 22%→38%** on both seeds.
  THE channel.

Bisect (matched-development, `git worktree` per commit) pins the regression to
**`d991e11` "Amphibious war restored under tile-war"** (count-at-agri≥0.9 26→16),
with latifundia (`49bc43b`) and deditio (`faacd87`) contributing; Ontology V2 and
the chronology "compounding returns" only shifted *timing*, not the equilibrium.
Amphibious lets a strong realm invade across water anywhere its ports can sail
(`armies.js` ~790), so sea-protected coasts/islands fall → the sea stops
fragmenting the map → over-consolidation + the coverage-retreat (dead realms'
land is RELEASED to wilderness, `countryTerritory.js:551/605`, not handed to the victor).

## What does NOT work (all measured, so we don't retry it)

- **Every *multiplicative* gate is inert** because a giant governs 10–20× any
  neighbour and overwhelms any ratio: `AMPHIB_BAR` magnitude (1.8/3/5 all ≈ same;
  only 0 helps), `ABSORB_*`, and a built-then-reverted **amphibious distance-decay
  (`AMPHIB_REACH`, commit reverted)** — decaying the invading army by sea distance
  did nothing (giants clear the bar even at 0.17× strength; and the over-consolidation
  is from SHORT-sea hops anyway, which decay barely touches).
- **`CAP_DOM_MAX` (hegemon ceiling)**: inert — dominance sits below the ceiling.
- **`FIELD_SPAN` down**: DOES shrink giants (8.5M→3.1M km²) but the over-target shed
  dumps land to **wilderness** → map empties, count drops. (The shed pins home/worked
  tiles, so absorbed realms sit at 260–380% of target and never shed by it.)
- **A built-then-reverted `AREA_LOAD`** (land area draws hold-capacity): inert — the
  extra secession it creates is re-absorbed by the same giants.
- `ADMIN_HALF` down, `EXPAND_RATE` up *alone*: make it WORSE (realms collapse / the
  hegemon grabs the fill).

Single levers each fix one axis and break another; **none is a silver bullet.**

## THE FIX — a value-lever COMBINATION (comboE), amphibious kept ON

| lever | default → comboE | role |
|---|---|---|
| `FIELD_SPAN` | 12 → **6** | caps giant size |
| `COVER_ORG` | 150 → **260** | fills the map via SMALL realms' hinterlands — the giants are capacity-bound and sit ABOVE the floor, so this grows the small realms, not them (this is the key that breaks the shrink-vs-fill tension) |
| `EXPAND_RATE` | 1.5 → **8** | frontier fills faster → coverage |
| `REGION_SPACING` | 1.2 → **1.0** | more settlement seats → more realms |

Measured (windowed 16k–30k, both seeds), amphibious ON:
- realms 19/19 → **20/29**, coverage 22/25% → **30/38%**, biggest 9.4/10.1 → **7.3/7.3 Mkm²**.
  Every axis improves on both seeds; none regresses.
- 960 single render @32k: **34 realms, 58.5% claimed** (baseline ~14–26 / 29–46%).
- **Stylized gate (480/21k, seed 8817): ALL hard gates pass, 1 soft warning (budget 2);
  largest-empire share 10%** (baseline 26% — comboE is MORE historical), Zipf −0.87,
  fallen lifespan ~824y, urbanization 10%. So it's not a hack — it stays history-shaped.

Set `SIM_COVER_ORG=260 SIM_TUNE="REGION_SPACING=1.0,FIELD_SPAN=6,EXPAND_RATE=8"` to reproduce
on a pre-flip build. **comboE is now the shipped default** (see PACKAGED below), so on
current HEAD a plain run IS comboE.

## MEASUREMENT GOTCHAS (these cost real time — read before measuring)

1. **The country count is a volatile attractor: it swings 12→31 within a single run.**
   Single-step / single-seed comparisons are NOISE and repeatedly gave OPPOSITE
   conclusions two steps apart. **Always use the windowed multi-seed mean**
   (`tools/probe_avg.mjs`, samples 16k–30k). This is the single most important lesson.
2. **`FIELD_SPAN` was NOT in the tuning schema**, so `applyTuning`/`SIM_TUNE` silently
   ignored it (`applyTuning` does `if (!(k in DEFAULTS)) continue`). Now exposed
   (commit on branch). Any lever you sweep via `SIM_TUNE` MUST be in `TUNING_SCHEMA`.
3. **`COVER_ORG`/`COVER_BASE` are live levers now** (exposed while packaging comboE —
   set via `SIM_TUNE` like everything else). The `SIM_COVER_*` envs still work and
   FORCE-override the levers in headless runs. (Historically they were env-only consts
   that `SIM_TUNE` silently ignored — the same trap as gotcha 2.)
4. **`buildSim({W:480})` → sim grid `tw=240` (tileRes 2), so `NG = world.tw*world.th`,
   not `W*H`.** Iterating `W*H` reads phantom tiles (the 899%-claimed bug).
5. Later steps get slow (settlement/link count); a 960→50k run is ~10 min.

## PACKAGED (2026-07-13) — comboE is now the DEFAULT

- **`COVER_BASE`/`COVER_ORG` are live levers** ("Empire size & cohesion", def 25/260).
  The `SIM_COVER_*` envs still work and FORCE-override the levers for headless sweeps
  (the SIM_PERSIST_TERR pattern). Verified lever path ≡ env path: `SIM_TUNE=
  "COVER_ORG=260"` and `SIM_COVER_ORG=260` hash identically (d6eeee6e/d449827a on the
  pre-flip build), and the exposure alone at old defaults is byte-identical
  (83ccc922/574e8595, the documented pair).
- **The four defaults flipped**: `FIELD_SPAN` 12→6, `COVER_ORG` 150→260, `EXPAND_RATE`
  1.5→8, `REGION_SPACING` 1.2→1.0. Plain `node tools/probe_avg.mjs` now measures comboE.
  Reversible in one line: setting the four levers back
  (`SIM_TUNE="FIELD_SPAN=12,COVER_ORG=150,EXPAND_RATE=1.5,REGION_SPACING=1.2"`)
  recovers the pre-flip trajectory BYTE-FOR-BYTE (probe_hashbase 83ccc922/574e8595);
  the new-defaults pair is d8fc9f8f/bab1ad19.
- **Validation at the new defaults** (this session):
  - comboE reproduced via the env recipe first, both seeds, windowed 16k–30k:
    8817 → 20.4 realms [18–25] / 29.9% / 7.3 Mkm²; 4242 → 29.4 [23–34] / 37.7% / 7.3 —
    the numbers above, exactly.
  - **Stylized 3-seed (8817/4242/777, 480×21k): ALL hard gates pass; soft warnings
    1/0/0 (budget 2).** The one warning (8817) is the empire-area tail reading FLAT
    (largest/median 2.3) — the capped giants, the fix working, not a pathology.
    Largest-empire share 10/12/13%. Perf fine: ~190 s/run even three-concurrent
    (EXPAND_RATE 8 + spacing 1.0 don't blow the budget; 136–143 settlements at 21k).
  - **Smoke green** after replacing its one FITTED constant — the dissolve section's
    `settlements < 60` — with the measured legacy-model comparison it always meant
    (REGION_SPACING 1.0 makes 64 towns at 320, tripping the stale snapshot; the
    second-cardinal-rule fix is to measure the alternative, not re-fit the number).
  - Save/load roundtrip identity + determinism + invariants all pass at the new
    defaults (same smoke run).

## THE IMMORTAL-GIANTS FIX (2026-07-13) — WAR_REACH (force projection is LOCAL)

The follow-up session took the "deeper open question" and closed it. Measured diagnosis
first (probe_empires 24k, seeds 8817+4242, comboE defaults): the immortality is
OVER-DETERMINED —

1. Under TILE_WAR every combatant is a NATION adapter whose might is the WHOLE national
   army, so a realm defends (and attacks) every tile of its frontier at full strength
   simultaneously — nobody clears the front bar against a 10-20× giant ANYWHERE, so the
   top realms sit at zero defensive fronts (`captured=0` at every checkpoint; the same
   giants top every board with age == run length, while war shatters 265 SMALL realms).
2. Capture eats the periphery outermost-first (the anti-salient ring order), so a giant's
   capital is never even approached.
3. The storm gate is a national-ratio (`CITY_STORM_RATIO`) a dominant realm auto-wins.
4. The TILE_WAR adapter accidentally garrisons the capital's WALLS with the whole
   national pool (`homeMight(adapter)`), double-counted with the relief army — an
   adapter-refactor artifact contradicting the code's own intent comment.
5. The only non-war realm death (post-khan succession shatter) is nomad-only.

**The fix is the §4c-designed, never-built locality** (armies.js, `T.WAR_REACH`,
default 15): effective might at a battlefield = national might × **exp(−d/H)**, d =
distance from the realm's own capital, H = WAR_REACH ref-tiles (res-scaled) ×
(1 + 2.2·logisticsLevel) — the same roads→rail channel as administrative reach.
EXPONENTIAL, not hyperbolic: supply loss is per-march-day multiplicative, and at this
grid (a 10M-km² realm is ~600 tiles, rim ~14 tiles out) no hyperbolic tail can let a
modest power at its doorstep out-project a many-times-larger empire's far frontier.
Applied symmetrically at every war site: the front bar (both sides, per tile), the
countryside resolution (per-pair mean projection per side), amphibious landings (the
bar moves per-LANE → per-BEACH, so a giant's far coast decays like its far land rim),
attrition, and the STORM — fought at the capital's distance, with the fortress now the
capital's OWN garrison/militia/walls (fix for #4; rides the lever).

Measured (all windowed 16k–30k probe_avg + probe_empires 24k, 2 seeds; stylized 3-seed):

| | default (WR off) | WR=15 (shipped) | WR=8 |
|---|---|---|---|
| realms 8817/4242 | 20.4 / 29.4 | **29.0 / 36.9** | 33.5 / 33.0 |
| claimed | 29.9 / 37.7% | **41.9 / 44.6%** | 45.7 / 52.0% |
| biggest | 7.3 / 7.3M | **6.1 / 6.5M** | 4.7 / **8.2M** (regressed!) |
| top-5 at 24k | frozen, ages ≈ run | **churns — young realms reach #1** | churns |
| fallen @21k gate | 41 @824y | 32 @275y | 20 @176y (thin) |

- WR=15 improves EVERY axis on both seeds and the leaderboard finally turns over; war
  stays lethal. Stylized 3/3 seeds pass at 1 soft warning each (the flat empire-area
  tail — the capped giants themselves; same class comboE carries).
- WR=8: locality so strong that distance-blind PEACEFUL absorption becomes the dominant
  consolidator (biggest realm regressed on 4242) and death flows thin. Not shipped.
- The remaining longevity is the DEFENSIBLE-SIZE equilibrium: realms shrink to what they
  can militarily project over, and a compact realm at that size is legitimately durable
  (an Egypt/China, not a bug). True deaths still occur when exhaustion/insolvency/
  secession align — rarer, as in history.
- `WAR_REACH=0` recovers the projection-blind war byte-identically.

## OPEN / NEXT

- If you want amphibious war to stop over-consolidating *at the mechanism level*
  (not just capped via comboE): it needs a **NON-multiplicative** limiter — e.g.
  amphibious requires NAVAL DOMINANCE (control of the sea), a separate axis giants
  don't auto-win — since every multiplicative approach (bar, reach-decay) is proven
  inert. (WAR_REACH decays the short-hop channel barely at all, by design.)
- Coalition armies still don't COMBINE on a shared front — the other historical
  hegemon-killer. defForce/offForce are per-dyad; allies each fight alone.
- Provincial force projection: WAR_REACH projects from the CAPITAL only; a realm with
  regional seats (CAP_SEAT) could plausibly project from its nearest seat — would let
  well-administered empires defend far provinces better, at the cost of re-opening
  some giant durability.

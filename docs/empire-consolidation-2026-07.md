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

Set `SIM_COVER_ORG=260 SIM_TUNE="REGION_SPACING=1.0,FIELD_SPAN=6,EXPAND_RATE=8"` to reproduce.

## MEASUREMENT GOTCHAS (these cost real time — read before measuring)

1. **The country count is a volatile attractor: it swings 12→31 within a single run.**
   Single-step / single-seed comparisons are NOISE and repeatedly gave OPPOSITE
   conclusions two steps apart. **Always use the windowed multi-seed mean**
   (`tools/probe_avg.mjs`, samples 16k–30k). This is the single most important lesson.
2. **`FIELD_SPAN` was NOT in the tuning schema**, so `applyTuning`/`SIM_TUNE` silently
   ignored it (`applyTuning` does `if (!(k in DEFAULTS)) continue`). Now exposed
   (commit on branch). Any lever you sweep via `SIM_TUNE` MUST be in `TUNING_SCHEMA`.
3. **`COVER_ORG`/`COVER_BASE` are env consts** (`_envNum("SIM_COVER_ORG",150)`), NOT
   `T.*` levers — set via env, not `SIM_TUNE`. **Next step: expose them as levers.**
4. **`buildSim({W:480})` → sim grid `tw=240` (tileRes 2), so `NG = world.tw*world.th`,
   not `W*H`.** Iterating `W*H` reads phantom tiles (the 899%-claimed bug).
5. Later steps get slow (settlement/link count); a 960→50k run is ~10 min.

## OPEN / NEXT

- **Package comboE**: expose `COVER_ORG`+`COVER_BASE` as levers; run 3-seed stylized +
  smoke + byte-identical roundtrip; then flip the four defaults (or ship as a preset).
- **The deeper root remains the immortal giants**: nothing kills a great power
  (`captured=0` — the tile-war never storms capitals; `field-polity-spec.md §4c`
  designed distance-decayed capital-storm but it was never built). comboE bounds
  giant SIZE and fills the map, but great powers still rarely FALL. A real
  rise-and-fall would need the capital-storm path to actually close, OR a
  non-multiplicative fall mechanism (giants overwhelm every ratio gate).
- If you want amphibious war to stop over-consolidating *at the mechanism level*
  (not just capped via comboE): it needs a **NON-multiplicative** limiter — e.g.
  amphibious requires NAVAL DOMINANCE (control of the sea), a separate axis giants
  don't auto-win — since every multiplicative approach (bar, reach-decay) is proven inert.

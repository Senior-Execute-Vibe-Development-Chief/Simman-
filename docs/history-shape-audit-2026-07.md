# History-shape audit — the playtest notes, measured (July 2026)

Owner playtest notes + an external AI chronicle review, each claim re-measured
on HEAD before anything was built. Instrument: `tools/probe_history_shape.mjs`
(new, read-only — polity lifecycle ledger, event pacing by era, faith
concentration, slave-income breadth, region-boxed Earth development), 3 seeds
(8817/31337/4242) × 24k @ 480×240, app-identical pipeline. Companion to
`docs/hegemon-ossification-2026-07.md` (the tenure/mortality instrument).

**Headline.** The chronicle review's #1 ("nothing persists — the engine has no
memory") is the root finding and it is REAL: single polities were shattered
**22–25 times** per run, ~30 realms per seed are "elastic" (restored or 2+
shatters), and 44–69 % of secession-born states die back within 2 000 steps.
The cause is precise: **political collapse regresses nothing** — the dark-age
machinery (`KNOW_DECAY`) triggers only on population drawdown or isolation, so
a state can be sundered with its provinces' institutions fully intact, and
`restoreNations`/successor formation rebuilds at full administrative strength
within decades. The fix shipped and FLIPPED ON this session
(`COLLAPSE_SCAR=0.7`, dose-validated, 3-seed gates green — record below). The
faith monoculture claim is confirmed at maximum severity (top faith 95–98 %
of world population, ALL THREE seeds) — the sharpest open gap after this
session. India was confirmed broken (no Indus cradle; 1–3 capitals and ~⅛ of
Europe's population) and the Indus cradle shipped, gates green. Late-game war
density, not early-game activity, is the real pacing problem — and the scar
already cuts it by a third as a side effect.

## The notes, verdict by verdict

### 1. "Nations stay around the entire run" + review #1 "nothing persists" — CONFIRMED, root
Per-seed lifecycle ledger (24k): polities ever 115–151; elastic (restored or
≥2 shatters) 29–37; **3+ shatters 16–26; max shatters per single id 22–25**
(Tuwópfafsya ×25 / Tipöčö ×24 / Thitna ×22 — the chronicle's "Kughui ×11" was
mild). Dead-and-stayed-dead: 53–58 % of the roster. Secession/fragment-born
states: median lifespan 1 313–2 663 steps, **44–69 % dead within 2 000** — the
"90 provinces secede and are reabsorbed within decades" oscillation,
quantified. Why: `fragmentRealm` ends the record but `restoreNations` (by
design — homeland memory) and successor formation rebuild with **knowledge
untouched**, because the only regression channel is demographic. Organization
— the institutional stock that capacity, reach and the era clock all read —
survives every political collapse completely.

**Built this session: `T.COLLAPSE_SCAR` (tuning.js; fragmentRealm,
conquest.js).** On state sundering (stormed capital or succession shatter),
every member of the dying realm loses organization technique in proportion to
its own palace-dependence: `org ×= 1 − SCAR·org`. Self-scaling by
construction — a bureaucratic empire (org 0.9) loses ~a third of its
statecraft when the palace system breaks (Linear B with the Mycenaean
palaces); a segmentary chiefdom (org 0.2) barely notices. Successors and
restored nations are born administratively diminished, so re-consolidation is
EARNED through the normal learning law, and repeat collapses compound.
Byte-identical at 0. A/B + gate record below.

### 2. Faith monoculture — CONFIRMED, maximum severity
At 24k the top faith holds **97 / 95 / 98 %** of world population
(8817/31337/4242); exactly ONE faith ≥5 % on every seed; HHI 0.90–0.96. 4242
still had a 74 %/2-faith world at 20k — then consolidated. Total planetary
religious homogenization is the unconditional outcome. Missing counterforce —
candidates, all emergent-state-keyed: conversion resistance ∝ identity
distance + organized rival clergy (the same absorbResistance physics), schism
pressure ∝ span (a faith stretched over many polities/cultures breeds
heresies — the machinery exists in `faith.schism` but evidently under-fires at
scale), state-church lock-in (a throne wedded to faith A resists A→B sweep).
NOT built this session — needs its own measured arc. This is the sharpest
single stylized-fact gap the suite does not currently gate.

### 3. "Too much activity in early ages" — INVERTED: the problem is LATE
Era-0 pacing is quiet (0.4–0.8 polity+war events /1k steps /live polity;
war events 0–4.5/1k). The LATE game is the outlier: **236–451 war events per
1 000 steps** (a war event every ~2–4 steps world-wide), 5–10 events/1k per
polity, and a capital-storm shatter every ~36–40 steps. This is where the
chronicle's "at 130 cities the generator produces noise" lives — the volume
is real, not a rendering artifact. Whether it is I97 (war saturation)
partially returned or mostly capture/front noise needs the war-side breakdown
(`war.began` vs fronts vs captures) before any mechanism work. Note: era-0
statehood cadence (≈20 polities by step 4000) is a separate, milder question.

### 4. "Everyone runs on slave trade" — PARTIALLY confirmed
World slave-trade share of all income: 1.3–7.0 %. Realms with slaving >10 %
of income: typically 6–11 of ~50, peaking at **21/56 (38 %) on 8817 late**;
already 4/8 realms at step 3000 (copper age) in the sanity run. So not
"everyone", but slaving is a top income for a third of states through much of
history, and it starts almost immediately. Suspects: raid supply too cheap at
low tech, gang-labour demand (`_estates`/mines/cash-crop pull) too broad, or
UI salience (the slaver chronicle mark fires at a modest 25/tick). Measure the
supply channels before touching anything.

### 5. Sub-Saharan Africa — WORKING, arguably not deep enough
The stack (TSETSE 0.85 stripping draft animals, malaria/arid signals,
crop-axis, DIFF_CLIM) produces a real, persistent lag: SubSah org 0.52–0.55 vs
Europe 0.71–0.84 at 24k (≈ one full era), pop 16–52k vs Europe's 134–194k,
claimed 22–66 % vs 100 %. Whether an era-scale lag is ENOUGH is an owner
call — the region does still form 3–4 state capitals (not absurd vs
Mali/Benin/Ethiopia). If deeper isolation is wanted, the honest lever is the
Sahara as a *transport* barrier (caravan-tech-gated crossing cost), not a
regional debuff.

### 6. India — CONFIRMED broken, cause identified
End state: **4–5 settlements, 1–3 capitals, pop 6.4–25.1k** (Europe: 16–19
settlements, 10–13 capitals, 134–194k) — the subcontinent spends the run
near-empty, then gets swallowed as a province, and the Eurasian east–west
corridor stays severed (the user's point — this breaks macro-history for
everyone). TWO causes on the map: **(a) the pinned Earth cradle list has no
Indus** — Nile, Mesopotamia, Yellow River only (state.js
`EARTH_HEARTH_SITES`), so the historical fourth cradle simply doesn't exist;
**(b) the India box reads meanMoist 0.333** — the monsoon subcontinent
renders semi-arid (meanFert 0.617 is workable but thin at 150 land tiles).
(a) is a one-line addition to a deliberately hand-picked scenario list —
shipped this session pending its own 3-seed gate (record below). (b) is a
worldgen/moisture question (the depletive-transport solver's stated
acceptance criterion was "Ganges/SE Asia must stay wet" — re-check it on the
current build) — NOT touched this session.

### 7. "Countries too large too early" + Europe-first — REAL, recorded, not touched
Europe is the runaway core on all three seeds — 95–100 % claimed by ~12k
(bronze/iron era) with 134–194k end population — while MENA (both actual
cradles) tops out at 70–86 % claimed. Static fertility crowns temperate
Europe from tick one; historically its heavy northern soils waited on the
medieval plough. The mechanism-shaped answer already half-exists
(`LAND_CLEAR_METAL`, LAND_WORKS — capacity is BUILT), but making northern
Europe's potential tech-gated rather than innate is its own measured arc.
Recorded here so the next session starts from the number, not the vibe.

## Attack order (recommendation)

1. **COLLAPSE_SCAR** — ✅ built, dose-validated, gates 3/3 green at 0.7,
   **default FLIPPED this session**.
2. **Indus hearth** — ✅ shipped, gates 3/3 green (4242 to zero warnings);
   India re-measured alive (pop ×3, org 0.46→0.71, 3 capitals).
3. **Faith counterforce** — next mechanism arc (schism-at-span +
   identity-priced conversion); gate: no seed ends >~70 % single-faith
   without an emergent reason.
4. **Late-war density breakdown** — measurement first (war.began vs captures
   vs front events per window); only then decide if I97 needs a second pass.
5. **Slave-supply narrowing** — measurement first (who sells, who buys, at
   what tech).
6. **Moisture/India (b)** and **Europe-first (7)** — worldgen-side arcs,
   owner-scheduled.

## A/B + gate record

**COLLAPSE_SCAR=0.35 A/B (8817 + 31337 × 24k, pre-Indus world, same-seed
deterministic baselines): the mechanism is real but NOT the binding
constraint.** Direction is consistently right — elastic realms 37→29 (8817) /
32→30 (31337), 3+-shatter realms 26→20 / 20→18, total shatters 245→202 with
restorations 12→8 (tenure probe), secession-born early deaths 69→61 %
(31337) — but dead-and-stayed-dead is flat (58→56 / 55→58 %) and
max-shatters-per-id moved inside noise (22→26 / 25→19). Era arrival times
are essentially unchanged, so the scar is NOT slowing the world clock; it is
simply not what paces the cycle. **Refined diagnosis:** the
shatter→re-form treadmill is *politically* paced, not institutionally —
reassembly runs through POWER (submission ratios, absorb dominance,
`restoreNations`' 2-members-and-a-seat bar, snapClaim's instant re-carve),
and power reads population/army/military-tech, which the scar deliberately
doesn't touch. Organization damage makes rebuilt realms govern *less land*,
not re-form *less often*. The immortality pattern and the late-war density
(a capital-storm every ~36-40 steps) are two views of ONE phenomenon: the
war treadmill grinds, and nothing on the political side makes a fallen
order STAY fallen while it does.

**Strong-dose authority test (8817 × 24k, post-Indus world, SCAR=0 vs 0.7,
same-seed deterministic): the dial has REAL authority at the historical
magnitude.** Max shatters per id 22 → **15**; secession-born early deaths
48 % → **33 %** (median lifespan 2 813 → 3 563); and — the coupling bonus —
late-game war density falls by a third (war events/1k @24k 419 → **283**;
polity events 57.5 → 36.5): weaker re-formed states feed the capital-storm
treadmill less. Era arrival UNCHANGED (era 4 @21.0k vs @21.3k) — the scar
hits collapsed polities, never the leading edge, so the world clock is
preserved. 0.35 was simply under-dosed: the Late Bronze Age reference case
is exactly "the most bureaucratized states lost the most, writing included"
— org 0.9 losing ~⅔ at sundering IS the recorded severity, and 0.7 is that
physical magnitude, not a number dialled to a target (the validation
metrics are shape metrics — treadmill rate, lifespans — not any specific
value).

**Gate record.**
- Indus alone (defaults): stylized 3/3 hard-green — 8817 = 1 soft, 31337 =
  1 soft, **4242 = 0 soft (improved from baseline's 1)**. Smoke green
  (165 s, all checks incl. save/load + emblem suite).
- Indus + SCAR=0.35: 3/3 hard-green at 1 soft each (within budget 2;
  warnings are the usual suspects — Zipf on 4242, market-integration on
  8817, price-level on 31337).
- Indus + SCAR=0.7 (the shipped config): **3/3 hard-green — 8817 = 1 soft,
  31337 = 1 soft, 4242 = 0 soft** — total soft warnings BELOW the
  pre-session baseline (even 4242's Zipf warning, present at 0.35, cleared
  at 0.7). Per the 3-seed rule the default FLIPPED to 0.7 this session.

**India, re-measured with the Indus cradle (8817 × 24k):** population
6.4k → **18.7k**, mean org 0.46 → **0.71**, claimed 37 % → 93 %, 3 state
capitals alive at run end — the subcontinent participates in Eurasian
history from genesis instead of waiting for spillover.

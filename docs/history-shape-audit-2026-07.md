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
faith monoculture claim was confirmed at maximum severity (top faith 95–98 %
of world population, ALL THREE seeds) and FIXED in the follow-up session
(`FAITH_FRONTIER=1` — frontier resistance; 31337 ends 58 % top with three
living creeds; gates 3/3 with 8817 at zero warnings). India was confirmed
broken (no Indus cradle; 1–3 capitals and ~⅛ of Europe's population) and the
Indus cradle shipped, gates green. Late-game war density, not early-game
activity, is the real pacing problem — and the scar already cuts it by a
third as a side effect.

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

### 2. Faith monoculture — CONFIRMED, then FIXED (`T.FAITH_FRONTIER`, flipped)
At 24k the top faith held **97 / 95 / 98 %** of world population
(8817/31337/4242); exactly ONE faith ≥5 % on every seed; HHI 0.90–0.96. Total
planetary religious homogenization was the unconditional outcome. Reading the
machinery found the imbalance over-determined: THREE compounding
rich-get-richer terms (the deliberate `sizePull` network effect up to ~2.15×,
`STATE_PRESSURE` 2.4, affinity up to 2×) against **zero frontier resistance**
— conversion pull ignored cultural distance entirely, and an established
state church added its own pull but never suppressed rivals. Schism was not
under-supplied; it was un-STICKY: every new branch faced the parent's full
network pull with no home-turf defense and was re-absorbed.

**Built + FLIPPED this session: `T.FAITH_FRONTIER=1`** — two counterforces in
the spread pass, both from existing state, the consolidation engine untouched:
(a) contact osmosis between different culture FAMILIES runs at ~35 % of
kin-speed (state pressure deliberately undiscounted — royal adoption is
exactly how faiths really leapt civilizations, so the great sweeps stay
possible via thrones, not market osmosis); (b) an organized state church
suppresses rival organized missions in its territory ∝ its militancy, while
folk/stateless ground stays contestable (where the real mass conversions
happened). **Measured (24k A/B):** 31337 ends 96 %→**58 % / 3 creeds ≥5 % /
HHI 0.92→0.40** — durably plural through the whole late game; 8817 stays
plural through the classical bands (27–64 % top) then one communion
consolidates to 89 % **through the open state channel** — a distribution of
honest outcomes (sometimes a plural world, sometimes a near-universal
communion) rather than a clamped ceiling. Gates: stylized 3/3 hard-green —
**8817 at ZERO soft warnings**, 31337/4242 one each. `FAITH_FRONTIER=0`
recovers the winner-take-all world.

### 3. "Too much activity in early ages" — INVERTED: the problem is LATE
Era-0 pacing is quiet (0.4–0.8 polity+war events /1k steps /live polity;
war events 0–4.5/1k). The LATE game is the outlier: **236–451 war events per
1 000 steps** (a war event every ~2–4 steps world-wide), 5–10 events/1k per
polity, and a capital-storm shatter every ~36–40 steps. This is where the
chronicle's "at 130 cities the generator produces noise" lives — the volume
is real, not a rendering artifact. Note: era-0 statehood cadence (≈20
polities by step 4000) is a separate, milder question.

> **DECOMPOSED (session 2, `tools/probe_war_slavery.mjs`, 2 seeds × 24k on
> shipped defaults): the late game is not in permanent WAR — it is in
> permanent FLICKER.** At any sampled instant only **0–5 of ~50–60 realms
> are at war** (7–37 directed front pairs), yet **~90–170 new wars are
> declared per 1k steps** with matching endings, 27–68 indemnities/1k, and
> **135–309 live truces** at once; regular settlement captures in the late
> windows round to ZERO (the sundering is capital-storms, the countryside
> moves by tile fronts). So the event density is declarations/treaties, not
> battles: the dyadic truce stack works per-pair, but the SYSTEM never
> enters a general peace — pairs declare → skirmish → truce → lapse →
> re-declare (WAR_MEMORY re-logs a fresh `war.began` after 900 dormant
> steps, so long rivalries read as dozens of "wars"). War deadliness stays
> sane (biggest war of a window ~500–1 800 dead vs ~10⁵–10⁶ world pop).
> The I97 residue, in its true form, is that PEACE is not yet a
> system-level state (the review's own congress/interdependence note) —
> a real arc, deliberately not rushed this session. Cheap rider for the
> chronicle meanwhile: annotate re-flares (`rematch`) so the feed can say
> "the war resumed" instead of minting a new war per flare. Also observed:
> with plural faiths surviving (FAITH_FRONTIER), faith-clash annotations
> dominate late declarations on 31337 (137 of 173/1k) — more mixed-faith
> dyads exist to clash; watch, don't tune.

### 4. "Everyone runs on slave trade" — PARTIALLY confirmed
World slave-trade share of all income: 1.3–7.0 %. Realms with slaving >10 %
of income: typically 6–11 of ~50, peaking at **21/56 (38 %) on 8817 late**;
already 4/8 realms at step 3000 (copper age) in the sanity run. So not
"everyone", but slaving is a top income for a third of states through much of
history, and it starts almost immediately. Suspects: raid supply too cheap at
low tech, gang-labour demand (`_estates`/mines/cash-crop pull) too broad, or
UI salience (the slaver chronicle mark fires at a modest 25/tick). Measure the
supply channels before touching anything.

> **PROFILED (session 2, same probe): in-band, with ONE real gap — no
> abolition force.** Unfree runs 3–7 % of world population through the
> mature eras (Rome empire-wide was ~10–15 %), raiding is state-on-stateless
> as designed (crowned raiders 26–46 vs stateless 0–6 — the razzia preys on
> the frontier, the crown fields the razzia), settlement-level sellers with
> >10 % slave income are 5–19 of ~140, world slave income 0.5–4 %. The
> perception of ubiquity is the REALM-level >10 % stat plus the chronicle's
> low slaver-mark bar (25/tick). The genuine defect is the TREND: unfree
> share RISES into the late eras (7.3 % / 9.9 % at 24k, buyers 37–50) —
> nothing ever erodes coerced labour as wage economies mature. The missing
> mechanism is an emergent decline (free-labour substitution as
> industrial/organizational development raises the productivity and
> monitoring cost gap, riding the same machinery the serfdom fork already
> uses) — NOT a date-triggered abolition. Next-session candidate.

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
3. **Faith counterforce** — ✅ built + FLIPPED (`FAITH_FRONTIER=1`,
   session 2 of this audit): 31337 96→58 % top faith with 3 living creeds;
   8817's 89 % consolidation runs through the open state channel (an
   emergent reason, accepted). A stylized faith-plurality gate remains an
   owner option once more seeds are observed.
4. **Late-war density breakdown** — ✅ measured (`probe_war_slavery.mjs`):
   the late game is permanent diplomatic FLICKER, not permanent war (0–5 of
   ~60 realms at war while ~100 wars/1k are declared-and-truced). The next
   mechanism arc here is system-level peace (congress/interdependence eras);
   cheap chronicle rider: a `rematch` annotation on re-flares.
5. **Slave-supply narrowing** — ✅ measured: in-band (unfree 3–7 % of pop,
   state-on-stateless supply as designed); the real gap is the missing
   emergent DECLINE of coerced labour as wage economies mature (unfree share
   still rising at 24k). Next-session candidate.
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

# Hegemon ossification — measured on HEAD, July 2026 (backlog #2 / review I98)

**Verdict: CLOSED — the lock-in does not reproduce on current defaults, on any
of the three canon seeds.** The late game turns over healthily; polity
mortality *rises* ~30× into maturity instead of collapsing; the counter-force
stack built across W6-C/D/F is measurably doing the killing. Per the second
cardinal rule the sketched endogenous-fracture mechanism is **deliberately NOT
built** — there is no broken outcome for it to explain. It is parked below as
a blueprint with a concrete resume trigger, together with the one finding that
*does* survive: the overmighty-governor (elite) channel is inert, and *why*.

Instrument: `tools/probe_hegemon.mjs` (new, read-only). All numbers: 480×240,
24 000 steps, seeds 8817 / 31337 / 4242, app-identical pipeline
(`_harness.mjs` buildSim), current defaults. Two independent runs per seed
produced byte-identical tenure tables (the second added the event tally), so
the figures are deterministic, not run noise.

## 1. The claim under test

- **Review I98 (pre-Wave-4 HEAD, 30k run):** one cradle realm is #1 for 74 %
  of samples, unbroken 13 800→28 500; polity mortality collapses 7× late.
  "Needs a counter-force that grows with maturity."
- **Backlog #2 (July 2026 re-verification):** extreme form gone; residual
  "healthy turnover on 8817, one realm holds #1 for the back 40 % on 31337."
  Sketch: endogenous fracture growing with internal complexity
  (elite-overproduction / secular-cycle), compounding the existing
  overmighty-governor ambition. Both measurements predate the W6-F dynastic
  default flips, FOOD_K, TERRAIN_FADE, LAND_WORKS, GROWTH_LOCAL, the
  POP_MIGRATE recalibration and RES_INV_RIVER — i.e. the default world has
  been re-rolled several times since.

## 2. What the probe measures

Every 250 steps: the #1 realm by claimed land, folded to its suzerainty ROOT
(a vassal's land counts toward its overlord's bloc — hegemony since W6-C is a
network form). Tenure = per-root share of samples, #1 changes, longest
unbroken hold, full-run vs the back 40 % (the ossification window). Mortality
from the polity registry (founded/ended per window). Every 2 000 steps, the
#1 realm's internals — exactly the inputs the fracture channels read:
province-vs-throne power ratios (the governor's `AMBITION_RATIO` bar), a
Euclidean lower bound of the governor's blended `far` (blended = eucl +
terrain *excess* + river toll, and roads erase the excess, so eucl/holdRange
is tight in road country), ambition stocks, `gov._strain`, mean `_estates`,
unrest, `_hegF`, vassal count, dynastic crisis. At end: all `polity.*` events
by type(+how), full vs back-40 %.

## 3. Results

Tenure, back 40 % (9 600 steps, 39 samples):

| seed | #1 changes | longest hold | modal holder (share of samples) |
|---|---|---|---|
| 8817 | 11 | 2 250 steps | P'a 49 % (intermittent — keeps *retaking* #1) |
| 31337 | 12 | 2 500 steps | Ňawixdňe 36 % |
| 4242 | 9 | 2 250 steps | Qǐ̤thṳ̄ā 26 % |

Polity mortality (deaths / 1k steps), first third → last third:
8817 0.25 → 10.25 · 31337 0.38 → 7.25 · 4242 0.25 → 7.88.

Back-40 % fall/exit supply (polity.* event tally, per seed order
8817/31337/4242): capital-storm shatters **237/268/220**, ended(conquest)
57/51/57, ended(dissolved) 45/23/38, submitted(capitulation) 23/27/25,
submitted(submission) 11/8/9, seceded 19/15/16, restored 11/9/23,
founded(frontier) 78/37/57.

Reading:

- **No lock-in anywhere.** The longest late-game hold is ~2 500 steps out of
  9 600 — nothing near the review's unbroken-14.7k signature, and 31337 (the
  alleged residual seed) churns hardest of the three. The mortality gradient
  is *positive* — the exact inversion of ossification.
- **Great powers persist as characters, not as owners.** 8817's P'a holds #1
  for 10 000 steps across the EARLY-mid run (the first-unifier arc — the
  archaic world's Akkad/Egypt pattern, historically right), then spends the
  mature era trading the crown (49 % of samples, 11 changes). Rank-1
  *identity* persistence with rank-1 *tenure* churn is the desired shape.
- **What now kills empires, measured:** capital-storm fragmentation dominates
  (one shatter every ~36–40 steps world-wide in the mature era), with
  conquest endings, dissolutions and war-termination's
  capitulation-into-vassalage behind it, and `polity.restored` (fallen
  nations re-emerging) running at 9–23 per window — rise AND fall AND return,
  all live. Strain sheds visibly bite too: #1 realms were sampled mid-churn
  at `gov._strain` 4.6–12.8 (deep over-budget, shedFrontier regime).
- Flag for the war-side reviewers (not this arc's scope): ~250 capital-storm
  shatters per 9.6k mature steps across ~50 realms is a LOT of sundering.
  `npm run validate`'s war/size gates are green, so it is within the suite's
  bands; if late-game stability ever feels too molten in play, this tally is
  where to look first.

## 4. Why it fixed itself

The counter-force stack that landed after both measurements, each of which
scales with maturity exactly as I98 asked: nomad confederations (1–4 hordes
from ~t≈15k, raid/tribute pressure ∝ the steppe–sown wealth gradient — fires
precisely on the rich), claimant wars + personal unions (a dynastic stumble
now invites external claims on the throne), war-termination
(capitulation→vassalage keeps rivals alive as recoverable states instead of
annihilating them — hence the restorations), CAP_MODEL's self-limiting peer
baseline (the hegemon's own extraction lifts the mean it is measured
against), HEGEMONY_STAG (a peer system's death slows the leader's learning —
relative catch-up), and the trajectory re-rolls from the 2026-07 default
flips. Per the G-equivalence finding, any defaults change re-rolls a chaotic
trajectory — so the structural evidence is not "31337 got lucky" but the
*signature*: 3/3 seeds churn, mortality rises with maturity, and the fall
events attribute to mechanisms that grow with wealth, contact and dynastic
complexity.

## 5. The finding that survives: the elite channel is inert

The overmighty-governor path (`_ambition` → `declareIndependence`) essentially
never fires at this scale: max ambition sampled on any #1 realm across all
three runs was **0.08** (once, 4242 @16k); every other sample read 0.00. The
two qualifying bars close against a mature realm from opposite sides:

- **`ratio ≥ AMBITION_RATIO (0.55)` vs the throne's own province** — the
  capital province is the strongest bucket by construction (rebuildCountries
  seats the crown on the strongest member), so provinces at ≥55 % of it are
  rare: observed mature-era maxProv/throne 0.06–0.56, with ≥0.55 in 2 of 36
  report rows.
- **`far ≥ AMBITION_MIN_FAR (0.5×holdRange)`** — roads erase the terrain
  excess (blended far → eucl/holdRange) and transport tech grows holdRange,
  so strong provinces read "near": 8817's 0.56-ratio province sat pinned at
  euclFar 0.47 for millennia, inside the loyal-court zone.

Their conjunction ~never fires, and the one observed tick (4242's 0.87 + 0.66
ratio provinces, ambition 0.08) never matured before war moved the map anyway.
**Assessment: leave it.** Fracture supply is ample through the other channels,
and popular unrest correctly cools in prosperous realms (peace + plenty +
monuments — by design), so the elite force is currently redundant; building it
now would add a knob with no broken outcome behind it. The code's story
("breakaway duke") still fires where it was designed to: rough-terrain,
pre-road realms whose blended far genuinely exceeds eucl.

## 6. Parked blueprint: `T.ELITE_FRACTURE` (build only on the resume trigger)

**Resume trigger:** a future battery (960 product resolution, 30k+, or any
post-default-change validation) showing the ossification signature — back-40 %
modal share ≳ 70 % with an unbroken hold ≳ ⅓ of the window, or a *falling*
late-game mortality gradient. Re-run `probe_hegemon` first; if the signature
is real, build the following behind a default-0 lever (byte-identical off),
entirely inside the existing governor block (every input already computed
there):

1. **Projected-throne ratio** — qualify on provPower vs
   `thronePower / (1 + far)`: suppression must be *delivered*, not owned.
   Precedent: the colonial independence line already uses projected force
   (`projForce = blocPow × reach`, INDEP_POWER_RATIO).
2. **Rival-court compounding** (the internal-complexity term): ambition gain
   × `(1 + COURT_W · (strongCourts − 1))` — courts embolden each other;
   elite overproduction is the *count* of provincial power bases.
3. **Magnate funding:** gain × `(1 + MAGNATE_W · province mean _estates)` —
   the conquest→latifundia ratchet becomes political; empires that grew by
   extraction breed their own breakers (and ESTATE_BREAK's slow unwind gains
   its political meaning).
4. **Succession crisis emboldens:** duressMul × `CRISIS_EMBOLDEN (~1.6)` when
   `inCrisis(c.id)` — the settled-realm Diadochi arc, routed through the
   orderly province-branch exit (nomads keep their wholesale shatter).

Existing guard-rails already bound it: connectivity + outside-border checks,
the failed-plot ravage cost, CONQUEST_GRACE, ambition fade when unqualified,
and assimilation-driven re-absorption (cycles, not permanent confetti). Every
constant above has independent physical meaning; nothing names an outcome;
nothing reads a clock.

## 7. Bookkeeping

- Backlog #2 → closed by this measurement (note added there).
- `tools/probe_hegemon.mjs` committed as the standing instrument; on-demand
  only. Deliberately NOT wired into validate: late-game #1 tenure is a
  per-seed chaotic statistic (a fragile canary of the C2 class), while the
  probe's full tenure/mortality/attribution table is what a human should read
  when the question comes up.
- No sim behavior changed in this pass.

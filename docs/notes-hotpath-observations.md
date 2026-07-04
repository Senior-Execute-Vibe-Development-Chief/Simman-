# Hot-path sweep — things picked up and NOT fixed (I82 investigation)

Captured while measuring/closing **I82** (settlement-economics perf). These are
observations from reading `settlement.js` (updateFood / updateKnowledge /
updateWealth / updateCoercedLabour / computeLuxury), `habitability.js`, and
`persist.js` — **none are fixed**, most are not even verified beyond a read.
Triage before acting. Each item states: where, what, whether a fix is
**byte-identical** (safe: same emergent trajectory) or **trajectory-shifting**
(changes the history → must re-pass validate + both stylized seeds), and rough
value. Verify with `tools/probe_hashbase.mjs` (hash `11ad8765`/`27063acb`,
2500 steps, seeds 8817/31337) before and after any "byte-identical" change.

> Reminder: none of this is urgent. I82 already established the settlement pass
> is dominated by *irreducible per-tick arithmetic*; every perf item below is
> < 1 % and was measured as lost in the noise. They are recorded for honesty and
> as free-riders for whoever is already editing these lines — not as a backlog to
> grind. The correctness/verification items (§C) matter more than the perf ones.

---

## A. Confirmed correctness / hygiene smells (latent — not currently biting)

**A1 — `_isColony` listed TWICE in `SETT_FIELDS`.** `persist.js:52` and
`persist.js:55`. Harmless (the save loop writes the same value twice), but it is
list-drift: the declarative field list has an accidental duplicate. Trivial dedup,
byte-identical. *Value: cleanliness only.*

**A2 — falsy-vs-nullish climate inconsistency.** `climateOf` sets
`s._climTemp = world.temp[ci] ?? 0.5` (nullish — a real 0 stays 0). But the
seasonStore line in `updateFood` reads `s._climTemp || 0.5` (falsy — a real 0
becomes 0.5), while the apt-ratchet in `updateKnowledge:1416` reads the raw
`s._climTemp`. So a settlement on a temp-*exactly*-0 tile computes
`seasonalSelect(0, moist)` in one place and `seasonalSelect(0.5, moist)` in
another for the *same* tick. Almost certainly never triggers (settled tiles are
not at temperature 0), but it is the kind of quiet quirk that bites once and is
maddening to find. Harmonising to `?? 0.5` everywhere is the principled fix but is
**trajectory-shifting** for any temp-0 tile (gate it). *Value: latent-bug
insurance.*

**A3 — `_metalCap` / `oreTier(r)` recomputed every tick** despite its input being
staggered. `settlement.js:1348` `metalCap = oreTier(r)` and `:1357`
`s._metalCap = metalCap` run every tick, but `r = s._effRes` is only refreshed on
the `% KNOW_INTERVAL` stagger (`:1321`). So `metalCap` is constant between
refreshes yet re-derived every tick. Move the `oreTier` call inside the
KNOW_INTERVAL block (cache `s._metalCap` there). **Byte-identical** (the input is
unchanged between refreshes). *Value: micro perf; also tidies the "what's actually
per-tick in updateKnowledge" story.*

---

## B. Confirmed byte-identical perf micro-opportunities (all < 1 %, measured)

> All of §B together is inside the < 1 % that I82 measured as unmeasurable. Do
> them only as free-riders, never as a dedicated pass.

**B1 — apt-ratchet computes a dead `seasonalSelect` after saturation.**
`settlement.js:1416`. `aptTarget = seasonalSelect(s._climTemp, s._climMoist)`
(two `Math.exp`) is computed every tick but used only `if (aptTarget > apt)`. The
ratchet `s._orgApt` only ever climbs (permanent — never falls), so once it
saturates to its climate target, `aptTarget ≤ apt` **forever** and the
seasonalSelect call is pure waste for the entire rest of the run — which, for most
settlements, is most of the run. Cache the (static) seasonalSelect, or skip when
saturated. **Byte-identical.** *This is the single cleanest dead-recompute in the
pass — and still < 1 %.*

**B2 — `climateOf` fired up to 8× per settlement per tick.** Call sites:
`settlement.js:1401, 1766, 1890, 1909, 1924, 1954, 1985, 2056`. Every call after
the first is a memoised early-return (`if (s._climLat !== undefined) return;`), so
it is cheap, but it is 7+ redundant call+branch overheads. Hoisting one
`climateOf(world, s)` to the top of `updateSettlement` would let the rest collapse
(or be deleted). **Byte-identical.** *Value: micro; also removes noise from future
profiles.*

**B3 — the reverted static-climate memo (record of what was tried).** Memoising
`seasonalSelect`/`livestockClimate`/`malariaSignal`/`aridSignal` (all pure fns of
static `_climTemp`/`_climMoist`/`_riverAcc`; `livestockClimate` lever-keyed on
`T.TSETSE`) is byte-identical and correct, but the A/B was within noise (see the
I82 verdict in `roadmap-wave-6.md`). `malaria`/`arid` short-circuit to ~0 for the
temperate majority; only `seasonalSelect` is consistently paid. **Do not
re-attempt as a perf play.** Kept here so nobody re-scopes it from scratch.

---

## C. Verification / test-robustness gaps (more important than §A/§B)

**C1 — `hashWorld` blind spots vs `SETT_FIELDS`. ✅ FIXED** (this session). The
core loop hashed only `id, mode, name, tier, countryId, people, food, wealth,
army, loyalty, unrest, infrastructure, _foodNet` + knowledge, while `SETT_FIELDS`
persisted much more cross-tick state the hash never touched — so a save/load
regression in the economy/society fields passed the "loaded state hashes
identical" check and was caught only *indirectly*, via the +1000-step functional
continuation (1.5 % pop / 4.3 % wealth tolerance). Now `persist.js` declares
`SETT_HASH_NUM` (`_credit`, `_unfree`, `_cashFrac`, `_captives`, `_serf`,
`_orgApt`, `_rivalN`, `_ambition`, `_diseaseLoad`, `_specStr`) + `_specKey` +
`SETT_HASH_MIX` (`culMix`/`faithMix`/`langMix`/`ancMix`, element-wise) and the
settlement hash iterates them — a declared registry so the guard can't drift from
what's persisted again (the omission class R1 fixed for world maps). Smoke's
determinism + save/load both still pass (proving these fields round-trip cleanly);
baseline hash moved to `20b4f37e`/`43c73b01`.
**C1b — kin-graph / culture / faith registries unhashed. ✅ FIXED** (this
session, the follow-up C1 surfaced). `hashWorld` covered these NOT AT ALL (only
`polities`, minimally), so a determinism or round-trip bug in the dynastic /
cultural state — the state W6-F builds on — was invisible. Now `persons` and
`dynasties` are hashed field-by-field (declared `PERSON_HASH_NUM`/`_STR`,
`DYN_HASH_NUM`, + `children`/`members`/`inlaws`/`traits`), and
`cultures`/`faiths`/`languages` by a divergence signature (count + id + name +
`foundedStep` + `nameCounter`); their deep naming/lineage state is static and its
emergent effect flows through the settlement mixes (already hashed in C1). Verified
byte-identical at 8000 steps with dynasties present (`tools/probe_roundtrip_deep.mjs`:
8817 → 1674p/38d, 31337 → 2004p/22d, `h0 == h1`).

> **Coverage caveat (recorded, deliberately NOT fixed):** *no automated gate*
> exercises this. Smoke's determinism runs 600 steps and its save/load 1500 —
> both BELOW the ~5–6 k steps at which `persons`/`dynasties` first populate — and
> `validate` does no round-trip check at all. So the dynastic-round-trip guard is
> only run on demand via `tools/probe_roundtrip_deep.mjs`. Wiring it into a gate
> costs ~+10 s of smoke (a 6 k-step run for even 4 dynasties; ~15 s for a
> meaningful ~38) against a 25–35 s budget — a runtime-vs-coverage call left to
> the owner. Recommended trigger: run the deep probe by hand after any change to
> `dynasties.js`, the person/dynasty shape, or `persist.js`.
>
> **Still unhashed (deliberate, lower value):** static re-derived site attrs
> (`_riverAcc`/`_confine`/`_rugged`/`waterAccess`/`_buildableArea` — deterministic
> from terrain) and cosmetic chronicle bookkeeping (`_chronFlags`/`_peakTier`).

**C2 — the 31337 clustering stylized fact sits ON its gate boundary.** Observed
across W6-F: seed 31337's settlement-clustering value hovers at ~0.44–0.5 against
a 0.5 floor, so *any* small trajectory perturbation flips it and consumes
`SOFT_BUDGET`. It is a brittle canary — it makes the stylized suite hypersensitive
on that one seed/fact, which (a) will keep tripping on legitimate changes and (b)
gives almost no headroom for a deliberate trajectory-shifting perf change (see the
I82 verdict). Worth either understanding *why* 31337 clusters weakly (is 0.5 the
right floor for it, or is the map genuinely more dispersed?) or widening the
tolerance with a written justification. *Not a bug; a fragile gate.*

**C3 — `INTEGRATE_TICKS` is a fixed-tick, G-dependent integration ramp — but the
ramp is OUTPUT-INERT.** Found scoping adoption-off-render. `countryTerritory.js`
ramps a just-adopted settlement's reach INTEGRATE_MIN→full over
`age / INTEGRATE_TICKS`, with `age = world.step − _integratedAt` in *steps* and
`INTEGRATE_TICKS = 3000` fixed — so at G=4 the ramp completes in ¼ the history-time
(land fills 4× faster: a real G-non-invariance, and a fixed-tick smell the wither
timer's `2000/_dt` already avoids). Applied the obvious fix (`INTEGRATE_TICKS/_dt`,
byte-identical at G=1) and it was **output-inert** — G=4 pop/wealth byte-identical
with/without it at BOTH 256×128 and 480×240. The reach-ramp rarely *binds*
(territory is limited by geography/neighbours first, and `_integratedAt` is only set
on adoption, uncommon at these scales), so its timing never reaches the emergent
output. **Reverted** (I82 discipline — no measurable benefit; and per cardinal-rule-2,
making an inert mechanism's timing "correct" polishes a symptom). *The real question
it raises:* is the "gradual integration / anti-bloom" reach-ramp doing ANYTHING? A
ramp-on-vs-off A/B would say whether it is load-bearing or dead — worth knowing
BEFORE adoption-off-render builds on that machinery.

**C4 — Adoption-off-render (W6-G item 3): scoped, NOT started; bigger than it looks.**
The item wants political adoption (`s.countryId`, set in `adoptAndFound`) to stop
reading the RENDER layer (`grownLiveOwnerAt` → the crawled `_countryClaim` border)
and instead read an explicit "tile administered for a logistics-derived delay" state,
freeing the claim crawl to be pure paint. But that render-coupling is **load-bearing**:
the surrounding comments document anti-runaway-growth, anti-zombie-state and
anti-nationless-megacity fixes all clustered on it, so any replacement delay must
reproduce those guards. Substrate exists (`_tileCapturedAt` entry timestamps,
`_integratedAt`, the `INTEGRATE_*` machinery, a `SIM_ADOPT_TARGET` A/B lever) — but
C3 shows part of that machinery may be inert, so step one is verifying the integration
substrate actually works before rewiring adoption onto it. This is a
**trajectory-changing** refactor of the most visually load-bearing system, gated on
3-seed stylized + the fragile 31337 clustering fact (C2). *Recommendation: deliberate
go-ahead + design-first behind the lever, not a drive-by — and since perf is
deprioritised and the higher-value marriage market is deferred, confirm it is the
priority before sinking the effort.*

---

## D. Spotted in passing — UNVERIFIED (flags, not findings)

**D1 — `updateDevelopment` ≈ 8.5 % of the settlement pass despite being
"DEV_STRIDE-batched."** Worth confirming the stride actually covers the hot part
of the function and not just a sub-computation. Unread beyond the profile number.

**D2 — `updateCoercedLabour` ≈ 8 %** whenever `T.SLAVERY` is on (default). Gated
correctly (`:701` early-return when off), but it is a non-trivial slice for a
subsystem that only matters late; check whether its per-tick work could ride the
same slow cadence as the rest of the coerced-labour state (which "drifts slowly"
per its own comment at `:699`). Possibly **trajectory-shifting**; unverified.

**D3 — `computeLuxury` runs full every tick for every settlement** including
`sackPenalty(s, world)` + `Math.sqrt(pop)` even when `luxRes === 0`
(`settlement.js:656`). An early-out for the no-luxury-resource majority would be
byte-identical. Micro; unverified cost.

**D4 — `agriGate(world, s)` called every tick in `updateFood:~1891`** and "also
builds `world._agriCeil`." Did not read `agriGate`; it is a plausible hidden cost
(it does regional work) and a candidate for the same staggering the rest of
updateKnowledge already uses. Unverified.

---

## E. The strategic read (my actual opinion — see chat)

1. **Perf is not the bottleneck and its easy wins are mined out.** The big
   staggers (KNOW_INTERVAL, DEV_STRIDE, techEff, TERRITORY_INTERVAL, trade stride)
   are already in. What is left in the economy pass is genuine per-tick
   integration. Everything in §A/§B is < 1 %. **Stop chasing settlement-pass
   perf.** If perf ever must improve, it is either algorithmic work on the
   tile-bound passes (B80/B81/B78) or a deliberate, history-changing stagger of
   the economy (a product decision, not a refactor).
2. **The highest-value real work is emergent-history content**, specifically the
   **marriage-market prerequisite** that blocks claimant wars + personal unions
   (`docs/marriage-market-cross-realm.md`). That is the actual product — dynastic
   politics falling out of the kin graph — and it is *blocked*, not done.
3. **Hardening `hashWorld` ✅ DONE (C1 + C1b).** The guard now covers the
   economy/society settlement state AND the kin-graph / culture / faith registries.
   The dynastic round-trip is verified byte-identical (`probe_roundtrip_deep.mjs`).
   Remaining loose end: no *automated gate* runs that deep check (smoke stops below
   dynasty formation) — see the C1b caveat. With the guard in place, the natural
   next move is the **marriage-market prerequisite** (unblocks claimant wars /
   personal unions) — now buildable on a hash that can actually catch a dynastic
   determinism or persistence regression.

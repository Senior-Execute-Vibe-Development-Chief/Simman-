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

**C1 — `hashWorld` has blind spots vs `SETT_FIELDS`.** `persist.js:335` hashes
only: `id, mode, name, tier, countryId, people, food, wealth, army, loyalty,
unrest, infrastructure, _foodNet`, and the knowledge tracks. But `SETT_FIELDS`
*persists* many more cross-tick state fields that the hash never touches directly:
`_credit`, `_unfree`, `_cashFrac`, `_captives`, `_serf`, `_orgApt`, `_rivalN`,
`_specKey`/`_specStr`, `culMix`/`faithMix`/`langMix`/`ancMix`, `_diseaseLoad`,
`_famineUntil`/`_harvestMul`, `_ambition`, `_witherSince`, … A save/load
regression in any of these **passes the "loaded state hashes identical" smoke
check** and is only caught *indirectly*, if and when the field perturbs a hashed
quantity within the +1000-step functional-continuation window (which itself
tolerates 1.5 % pop / 4.3 % wealth drift). This is a real hole in the
determinism/round-trip net. Recommended: fold the economically-load-bearing ones
(`_credit`, `_unfree`, `_cashFrac`, `_serf`, `_orgApt`) into the settlement hash.
*This is the highest-value item in this doc — it hardens the guard every other
change relies on.* Note: the W6-F/W6-E work added `_credit`/`_serf`/etc. exactly
in this unhashed zone.

**C2 — the 31337 clustering stylized fact sits ON its gate boundary.** Observed
across W6-F: seed 31337's settlement-clustering value hovers at ~0.44–0.5 against
a 0.5 floor, so *any* small trajectory perturbation flips it and consumes
`SOFT_BUDGET`. It is a brittle canary — it makes the stylized suite hypersensitive
on that one seed/fact, which (a) will keep tripping on legitimate changes and (b)
gives almost no headroom for a deliberate trajectory-shifting perf change (see the
I82 verdict). Worth either understanding *why* 31337 clusters weakly (is 0.5 the
right floor for it, or is the map genuinely more dispersed?) or widening the
tolerance with a written justification. *Not a bug; a fragile gate.*

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
3. **Hardening `hashWorld` (C1) is the cheapest high-leverage thing** — it makes
   the guard that underwrites every future change actually cover the state that
   recent waves added.

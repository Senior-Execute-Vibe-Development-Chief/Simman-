# The royal marriage market needs cross-realm heirs (claimant-wars prerequisite)

**Status:** the marriage market is BUILT behind `T.CROSS_REALM_HEIRS` (default off, byte-identical
off) — direction 1 (widen the court pool) + heir-reach (the direct royal line marries abroad).
Cross-court marriage flow ≈3× baseline and live cross-realm consorts are present ~half the time;
`houses ruling >1 realm` stays 0 (a claimant-wars output, not a marriage-market one). Next is
claimant wars behind `T.CLAIMANT_WARS`, firing on this now-seeded kin graph. See **## Progress**.
**Owner area:** `src/sim/peopleSim/dynasties.js` (the marriage market: `marry` / `wed` /
`world._royalCourt`).

## The problem

Claimant wars need a **cross-realm royal kin graph**: a realm can press a dynastic claim on
another only if its sovereign is *of* the disputed house (a cadet branch that came to rule
elsewhere) or *married to a person born of it* (a foreign king wed to its princess). The
engine does not produce that graph at any meaningful frequency — dynasties are effectively
**realm-siloed**.

## The evidence (measured)

A probe (seed 8817, ~12 000 steps, W=320) at run end:

- **11 sitting rulers, 11 distinct ruling houses** — every realm has its own house.
- **0 houses rule more than one realm** — a cadet branch never comes to sit a second throne.
- **~1 of 11 rulers has a *housed* living consort** — i.e. a consort with a real
  `dynastyId >= 0`. The rest are married to house*less* in-laws.

Consequently **zero succession claims fired** in that run (and in the 15 000-step validate on
both seeds — the claimant-wars build was byte-for-byte identical to the run without it),
*even after* broadening the claim trigger to "any sovereign of, or married into, the disputed
house" **and** raising `FOREIGN_MATCH` from 0.25 to 0.6.

## Why it happens

`marry()`'s foreign path (`FOREIGN_MATCH`) only weds a **real foreign heir** when
`world._royalCourt` happens to hold a suitable (unwed, sex-matched, 16+) heir from another
court. That pool is thin, so the path overwhelmingly falls through to
`makeAdult(..., { foreign: true })` — a **generated, houseless** consort (`dynastyId = -1`).
A houseless consort carries no realm's blood, so it creates no cross-realm claim. Raising
`FOREIGN_MATCH` does not help: the bottleneck is the *court pool*, not the reach-abroad odds.

Nothing else knits houses across realms — succession always crowns from a realm's *own* house
(`heirByLaw`), and there is no mechanism by which one house comes to rule two realms.

## The fix (direction, not yet built)

Make foreign royal matches routinely wed a **real foreign-house heir that retains its birth
`dynastyId`**, so married-in ties and shared houses actually accumulate. Candidate approaches,
cheapest first:

1. **Fill the court pool from living house members, not just unwed ruler-children.** Widen
   `world._royalCourt` to include eligible unwed adults across every living dynasty's roster
   (`dyn.members`), not only `ruler.children`. More real heirs → more real foreign marriages.
2. **Fall back to a real heir, not a generated consort.** When the reach-abroad roll fires but
   the court pool has no match, wed a living member of *another realm's* house (nearest / same
   culture) instead of `makeAdult({foreign:true})`. Every foreign match then plants a
   cross-realm blood tie.
3. **Let a house inherit a second throne.** On a succession CRISIS (house failed), before
   founding a brand-new line, allow a *foreign-ruling relative of the old house* to inherit —
   which is itself the personal-union seed, and directly creates a house ruling two realms.

Whichever path, keep it emergent (gated on kin + who sits which throne, never a date) and
lever-safe, and re-measure with the probe: success = houses ruling >1 realm and multiple
housed cross-realm consorts appear. **Only then** rebuild claimant wars on top (the reverted
design in `roadmap-wave-6.md` was sound — it just had nothing to fire on).

## Acceptance check

Re-run the probe; the fix is working when it reports, over a full run: at least a handful of
**houses ruling >1 realm** and a materially higher count of **sovereigns married into another
realm's house**. Then the reverted `_succClaims` / `claimBarOf` / `crownForeign` machinery
will actually trigger, and the validate crisis-war gate should rise (the W6-F target).

## Progress (this session)

**Baseline re-confirmed** (`tools/probe_marriage.mjs`, seed 8817, 12 000 steps, 320×160): 10–11
ruling houses, **0 houses ruling >1 realm**, **0** *housed* live consorts at end-of-run (the
snapshot fluctuates ~0–1), 46 cross-court `dynasty.union` events over the run. Realm-siloed, as
documented.

**Both enrichments BUILT** — behind one lever `T.CROSS_REALM_HEIRS` (default **off**; when off the
trajectory is byte-identical — hashbase `6df86092`/`82c7f3f`, deep round-trip `d69f113`/`9c5ecf94`,
validate 8817=1 / 31337=2 all unchanged, and the on-path is itself deterministic + round-trips with
zero invariant violations). When **on** it does two things:

- **Direction 1 — widen the pool.** The court pool is every eligible (living, trueborn, unwed,
  adult) member of every house that currently sits a throne, tagged with that realm (idle houses
  excluded; sitting monarchs excluded) — not just the reigning monarch's own children.
- **Heir-reach — the direct royal line marries abroad.** The reigning monarch's DIRECT children
  contract a foreign state match like the monarch (a crown prince's foreign marriage is the
  canonical dynastic union), instead of all cadets marrying locally — so an heir accedes already
  holding a foreign-house consort and the LIVE cross-realm stock persists across accessions instead
  of resetting each reign. Cross-court cadet couples are bred once, on the husband's side, so the
  pair isn't double-bred across both houses' rosters (B41).

**Measured, lever on** (sampled every 250 steps after a 4 000 warmup — one end snapshot is noisy):

| metric (8817 · 31337) | baseline | + pool (dir 1) | + heir-reach |
|---|---|---|---|
| cross-court marriages / run (flow) | 46 · 35 | 87 · 65 | **150 · 143** |
| live cross-realm consorts (mean) | 0.21 · 0.52 | 0.61 · 0.45 | **0.64 · 0.82** |
| ≥1 live cross-realm consort (% of time) | 12% · 27% | 42% · 36% | **48% · 45%** |
| ≥2 live ("multiple") (% of time) | 6% · 18% | 15% · 6% | **15% · 24%** |
| houses ruling >1 realm | 0 · 0 | 0 · 0 | 0 · 0 |

So the pool-widening roughly **doubles the cross-court marriage flow** (the FOREIGN_MATCH path now
finds a real heir instead of a houseless in-law), and heir-reach **doubles it again** (≈3× baseline)
by letting every reigning house's heirs — not only the occasional ruler who accedes unwed — marry
abroad. The *live* stock followed: ≥1 live cross-realm consort is now present ~**half the time**
(vs ~⅓ at baseline) and "multiple" (≥2) 15–24% of the time. It is still *bounded by mortality* (a
consort from a past reign is dead now) so it plateaus around a mean of ~0.6–0.8 rather than climbing
with the flow — but combined with the *descent* kin every one of those ~150 marriages plants (a
foreign princess's children carry a maternal-line claim), the cross-realm kin graph a claim
enumerates over is now materially seeded. Two findings remain:

1. **The root cause of the old thinness was the marry path, now fixed.** Cadets/heirs married
   through `growCadets`/`nobleUpkeep` with `isRuler=false`, so a ruler who acceded already-wed
   (most of them) never reached abroad — only an unwed accession did, a shrinking minority.
   Heir-reach removes that throttle for the direct line (the caller now passes a `stateMatch` flag,
   the renamed `isRuler`). The remaining ceiling is consort mortality, which is inherent.
2. **`houses ruling >1 realm` is a claimant-wars *output*, not a marriage-market output.** Every current
   succession path crowns from the realm's *own* house (`heirByLaw`), fresh founders (crisis), or a
   realm-local elected pool (`selectElected` explicitly excludes sitting rulers) — there is **no**
   code path by which an existing house takes a *second* throne. `crown()` *would* seat a second
   realm on an existing house (`polity.dynastyId = person.dynastyId` when the crownee already has a
   house), but nothing feeds it a foreign-house crownee. That path is direction 3 / the
   `crownForeign()` half of claimant wars — so this metric stays 0 until that machinery lands.

**The step-4 gate is MET** (`tools/probe_claims.mjs`). Consort counts are a proxy; the real question
is whether a *fireable* claim stands when a succession is contested — a foreign sovereign OF,
MARRIED INTO, or DESCENDED FROM the disputed house. Measuring the standing claim graph (distinct
claimant-realm → target-realm pairs live at once):

| fireable claimant-war pairs, live at once | baseline (off) | lever on |
|---|---|---|
| 8817 — mean · ≥1-present · ≥2 | 0.55 · 33% · 15% | **1.58 · 67% · 52%** |
| 31337 — mean · ≥1-present · ≥2 | ~0.5 · 33% · — | **1.97 · 64% · 55%** |

So with the lever on a cross-realm claim is standing **~⅔ of the time** (mean ~1.6–2.0, peak 5–6) —
roughly **tripling** the baseline. **Descent** claims ("women's sons" — a ruler of foreign-house
blood) dominate the count and outnumber live married-in consorts, because a foreign-blooded ruler
carries the claim for their whole reign whereas a consort must be currently alive — so the graph is
denser and more persistent than the consort snapshot alone suggested. **Conclusion: cross-realm
housed kin are now common enough for claimant wars to fire regularly** — the prerequisite the whole
feature was blocked on. Build claimant wars next (the reverted `_succClaims`/`claimBarOf`/
`crownForeign` design), behind `T.CLAIMANT_WARS`, firing on this graph; it is what finally makes
`houses ruling >1 realm` (the of-the-house claim, currently 0) non-zero.

**Why default-off** (the disciplined choice, mirroring the W6-G adoption lever): the richer marriage
flow perturbs the RNG stream, and on the fragile 31337 seed (note C2) that chaotic reshuffling pushes
it to 3 soft warnings (empire-size-tail 2.6 `<`3 and market-integration −0.72 `<`−0.2) — over the
budget of 2. It is **chaos, not a shape defect**: the same perturbation *repairs* 31337's clustering
canary (0.44→0.60), and 8817 stays at 1 warning. Per the size-distribution caution in
`roadmap-wave-6.md`, a mechanism that moves the size tail goes in behind a lever and the default is
flipped only once the gates hold on **3 seeds** — same rule the task states for `T.CLAIMANT_WARS`.

## Building claimant wars on this graph — the shared-house subtleties (scoped, NOT built)

The kin graph is ready; the remaining work is the machinery that makes a claim *fire*. Scoping it
this session surfaced why it was deferred — the moment ONE house rules TWO realms, several existing
per-realm assumptions break and must be handled together (this is the real content of the build, not
the claim enumeration, which `tools/probe_claims.mjs` already demonstrates):

1. **House maintenance is per-REALM but must become per-HOUSE.** `growCadets` / `reapHouse` /
   `nobleUpkeep` are called once per realm on that realm's ruling `dyn`. If house X rules realms A
   and B, both passes iterate house X's roster → its cadets are bred and married TWICE per pass
   (a new B41 at the house level). Fix: run house maintenance once per house (key on the house's
   primary/lowest realm), or dedupe by `dyn.id` within the pass.
2. **A house member who rules ANOTHER realm must be skipped by his birth-house's passes.**
   `reapHouse` already guards `sittingRulers(world).has(p.id)` (line ~736); `growCadets` (line ~769)
   and `nobleUpkeep` (line ~808) do NOT — they'd try to re-marry/re-breed the cross-realm sovereign.
   Add the same guard (byte-identical when off: with no cross-realm rulers it only re-skips the
   realm's own ruler, already skipped).
3. **Cross-realm succession.** When the shared/foreign monarch of B dies, `heirByLaw(B, ruler, dyn=X)`
   searches house X's roster — the SAME pool realm A draws from, so both realms can crown the same
   person. The union must SPLIT (B takes a different X-member, or founds fresh) or MERGE (the
   Castile-Aragon arc) — decide on legitimacy, and make sure `crown()` doesn't reset the surviving
   sovereign's `reignFrom` (it overwrites it — fine for a fresh cadet crownee, corrupting for a true
   personal union where one person already reigns).
4. **Two paths, both seeded now.** (a) *Peaceful inheritance* (D29 / direction 3): on a crisis, a
   foreign-reigning house with a blood claim on the vacant throne inherits it (a cadet, avoiding the
   shared-monarch reign-record issue) — contained to `dynasties.js`, delivers `houses ruling >1 realm`
   > 0. (b) *Claimant wars* (D28): the strongest external claimant's realm gets a succession casus
   belli (`claimBarOf` in the `armies.js` attack-bar), and decisive victory `crownForeign`s the
   claimant into the defender via the `_overlord` no-fronts bond — touches `armies.js` + the overlord
   plumbing. Path (a) is the smaller first slice; (b) is the headline "wars OF succession."
   Gate both behind `T.CLAIMANT_WARS` (default off); the emergent triggers are kin + who sits which
   throne + the crisis, never a date.

# Tier-B design — SUCCESSOR STATES: shed-to-successor and restoration-from-memory

All line numbers on HEAD `713c766` (branch claude/civ-simulation-balance-ysrx3v). One new lever `T.SUCCESSOR_STATES` (def 1) gates every behavioral change; at 0 everything below is byte-identical to HEAD. No new persisted state; no clock reads anywhere — every gate is state (memory, people, culture descent, org, seats).

## Measured baseline (probe, worldgen 480 → sim 240×120, seed 8817, 12k steps; probe source in scratchpad `probe_shed_baseline.mjs`, promote to tools/probe_successors.mjs)

- **The silent shed is real and 100% populated**: 455 tiles released by the connectivity release + over-capacity shed (steps 3/6, `_fpRel`) over 83 territory passes; **every released tile carried >1 field-person** (cumulative 2.37M field-people stood on released ground); 7 settlement-orphanings across 6 passes — all eventless.
- **The lapse channel is silent**: 12 settlements (955 census people) went `countryId≥0 → -1` via the unguarded derivation; `settlement.lapsed` events logged: **0**. `polity.seceded` in 12k steps: **0**.
- **fragmentRealm mints nothing**: 4 `polity.shattered`, **0** `founded.fragment` successors (survivor sets empty/degenerate — the successor channel is dead at realm sizes the sim actually produces).
- **Restoration fuel exists**: at 12k, 547 wilderness tiles remember a realm; 47 remember an **ENDED** realm with ~168k field-people living on them. Of 27 frontier foundings, 3 (Muudduu, Pisutul, Paik) founded on basins whose dominant memory was an ended polity (remembered share of basin people 14–34%; dominant share of remembered weight 49–100%). Exactly one `polity.restored` in 12k — the accidental id-collision path (old capital re-founding under its own id via `ensurePolity` reopen, entities.js:91-105).

## PIECE 1 — Restoration from the ground (foundings re-open fallen polities)

**Where.** The two wilderness-founding sites:
- `nucleateFrontierStates`, countryTerritory.js:1953 — minting loop :2059-2067;
- `adoptAndFound` frontier-founding branch, countryTerritory.js:1881-1887.

**New helper** `restorableHomeland(world, sx, sy) → polityId | -1`, placed with the nucleation constants (after countryTerritory.js:1952). Scans the same NUCLEATE_R disk the BIRTH_FIELD mass loop already walks (:2043-2051 — fuse the tally into that loop when BIRTH_FIELD is on; standalone disk scan for the adoptAndFound site, which has none; `nucRi = Math.round(NUCLEATE_R × resScaleFor(tw))`, land tiles, `co[ti] < 0` only — claimed ground already carries a state and its memory belongs to the loyalty field, not to founding):

```
w(ti)      = world.popField ? popField[ti] : 1        // people carry the yearning; tiles when POP_FIELD off
remembered = Σ w over tiles with _tileHomeland[ti] ≥ 0
byH[h]    += w for each remembered tile               // per fallen-realm weight
H* = argmax byH (tie → smaller id, deterministic)
```

**Restore H\* iff ALL of:**
1. **Uncontested memory**: `byH[H*] ≥ RESTORE_MAJORITY (2/3) × remembered`. A contested borderland (Paik: 49%) restores nobody → NEW state.
2. **Viable AS the old nation** (zero new constants): the fallen nation's own remembered mass alone clears the exact founding bar already computed at :2054 — `byH[H*] × f2c ≥ NUCLEATE_CLUSTER_POP × capMul` (f2c and capMul are the very locals in scope at the call site; the adoptAndFound site computes capMul from its own forestBar inputs the same way, or — simpler and permitted — reuses `NUCLEATE_CLUSTER_POP` flat since that branch's own bar is people-based already). When BIRTH_FIELD=0 (census mode, non-default): fall back to `byH[H*] ≥ RESTORE_MAJORITY × remembered && remembered ≥ ½ × basin tile weight`.
3. **Actually dead**: `p = getPolity(world, H*)` exists with `p.endedStep ≥ 0`, and H* is not any settled settlement's countryId (the restoreNations live-scan, conquest.js:932-933 — a rump flying the flag means reunification, not cloning). Memory of a LIVE realm is irredenta: found NEW, the live realm's claim expresses through casus belli (cohesion.js:163-192), never here.
4. **Kinship — the ground's people are the old nation's people**: with `cid = p.cultureId` (stamped at the polity's founding, entities.js:126, never rewritten — the founding people): `kin = Σ share over seat.culMix entries e where e[0] === cid OR cid is a lineal ancestor of e[0]` (walk `parentCultureId` up, ≤16 hops — the exact familyOf pattern, cultures.js:183-193, so daughter cultures of the fallen nation still count as its descendants). Require `kin ≥ RESTORE_KIN (1/2)`. A basin resettled by a different people fails and founds NEW. `cid < 0` (pre-culture record) → the gate abstains; memory + viability decide. This reads cultures/identity state only — no clock.

**Application** (both sites, replacing only the id minted):
```
const H = T.SUCCESSOR_STATES ? restorableHomeland(world, s.pos.x|0, s.pos.y|0) : -1;
if (H >= 0 && H !== s.id) {
  s.countryId = H; s._sovereignSeat = world.step; s.loyalty = 1; s._integratedAt = world.step;
  s._homeland = -1; s._homelandFell = -1;
  ensurePolity(world, H, { seat: s, from: -1 });   // reopens the record, logs polity.restored (entities.js:91-105)
  snapClaim(world, H);                              // export snapClaim from conquest.js:780; add to the existing import at countryTerritory.js:27
} else { …existing minting (s.id)… }
```
**What the seat inherits** — all of it by construction, because the id is the record: name, hue (`id*61 % 360`, conquest.js:684), chronicle history, personality/temperament, the buried war-chest (`endPolity` deliberately keeps `treasury`, entities.js:160-164). **The org scar stays scarred**: COLLAPSE_SCAR was applied to people's `knowledge.organization` at death (conquest.js:1157-1162) and the restored realm's capacity derives from its members' *current* org — nothing to add. Ground homecoming is automatic: the next loyalty scan sees `home[ti] === cur` → clears memory and lifts attachment to HOME_RETURN (loyaltyField.js:249-252).

## PIECE 2 — Successors at the shed: the label-free seat bar

**shedPatch seats** (conquest.js:1065). Replace the pinned city-label filter with blocHasSeat's own member test (conquest.js:852):
```
let seats = members.filter(m => m.id !== c.capitalId &&
  ((m.tier|0) >= CITY_TIER || m._provinceCity === m.id));   // a city, or a functional provincial seat
```
`_provinceCity` is stamped by assignProvinces (conquest.js:738-763) at the top of every polity pass (:686), and shedPatch fires later in the same pass (shedFrontier :1053 ← :2606) — fresh, never stale there. The towns-fallback (:1069-1073) and the lapse branch (:1075-1083) stay as the floor.

**Anti-confetti fold** (new, after the watershed grouping :1084-1091): a successor is a seat **plus at least one dependent** — the same ≥2 rule restoreNations enforces (:942). A non-city seat whose group is only itself folds into the nearest other seat's group (distance tie → smaller id); a full CITY alone remains a city-state; if only one seat exists the whole patch is one successor (current behavior).

**Why this cannot re-create the micro-state swarm** (the history in docs/country-count-size-diagnosis.md): the CITY_TIER 1→2 raise fixed a *FOUNDING* swarm — every town in a reach-gap minting its own state unconditionally. This bar governs *succession*, which (a) fires only on a contiguous loose patch of an existing realm that has actually turned restless (loyalty hysteresis + ATTACH_SECEDE + grace all upstream, :985-1053); (b) supplies seats that are **spacing-bounded by construction** — `_provinceCity === m.id` means locally-strongest within PROVINCE_SPAN = 9 ref-tiles (:724, res-scaled :740), so seat density ≤ 1 per province-span disk, i.e. successors are province-sized, never per-town; (c) carries the ≥2-member fold above. This is precisely the "founding and secession need different bars" doctrine the code itself records (conquest.js:837-850) — already applied to blocHasSeat and the governor gate (:2627-2631) by the empire-mortality fix; shedPatch/fragmentRealm are the two sites it missed.

**fragmentRealm successor count** (conquest.js:1183-1202). Replace the city-label basis:
```
const isFnSeat = (s) => (s.tier|0) >= CITY_TIER || s._provinceCity === s.id;
const seatCount = survivors.reduce((n, s) => n + (isFnSeat(s) ? 1 : 0), 0);
const maxStates = Math.max(2, Math.min(FRAG_MAX_STATES, Math.ceil(seatCount / 2)));   // adjacent provinces coalesce in pairs (:1184's own model, real basis)
```
Capitals selection (:1187-1202) becomes two-pass over the power-ranked survivors: pass 1 admits **functional seats only** (existing FRAG_SEPARATION spacing, existing `s.id === oldId` exclusion :1196); pass 2 tops up from any survivor only if fewer than 2 capitals were seated (the Diadochi floor, current behavior for seatless realms). Staleness: `_provinceCity` is ≤ POLITY_INTERVAL (150 ticks) old at fragmentRealm's armies.js call site — identical staleness to what blocHasSeat/declareIndependence already accept.

## PIECE 3 — The silent shed made witnessable: resolveOrphanedMarches

**New export in conquest.js** (near shedPatch), **called from index.js between :157 and :158** — after `computeCountryTerritory` (which fills `world._fpRel`, countryTerritory.js:405-414, written by the connectivity release :657/:676 and the over-capacity shed :907/:919) and **before** `adoptAndFound` (which would otherwise silently lapse the orphans in the same firing):

```
export function resolveOrphanedMarches(world) {
  if (!T.SUCCESSOR_STATES || !T.FIELD_POLITY) return;
  const co = world._countryOwner, rel = world._fpRel; if (!co) return;
  // 1. ORPHANS: settled members standing on ground their own realm no longer holds
  //    and no other realm took (co < 0 = wilderness now). Ground taken by ANOTHER
  //    realm is a border shift — adoptAndFound's realm↔realm derivation owns it.
  const byRealm = new Map();                         // cid → [settlements], settlement-array order (deterministic)
  for (const s of world.settlements) {
    if (s.mode !== "settled" || s.countryId < 0) continue;
    const ti = (s.pos.y|0)*tw + (s.pos.x|0);
    if (!(world.elev[ti] > 0) || co[ti] === s.countryId || co[ti] >= 0) continue;
    (byRealm.get(s.countryId) || byRealm.set(s.countryId, []).get(s.countryId)).push(s);
  }
  for (const [cid, orphans] of byRealm) {
    const c = world.countries && world.countries.get(cid);
    if (!c || orphans.some(m => m.id === c.capitalId)) continue;   // no view yet / the throne itself → the death machinery's case, not a march
    // 2. FALLEN NATIONS FIRST (the ground under a conquered march remembers): the
    //    existing machinery verbatim — requireBorder=false, the ground is already outside.
    const restored = restoreNations(world, orphans.filter(m => (m._homeland ?? -1) >= 0), cid, false);
    const rest = orphans.filter(m => !restored.has(m.id) && m.countryId === cid);
    // 3. SUCCESSOR STATELET vs HONEST REVERSION: exactly shedPatch — functional seat
    //    (piece 2's bar) → polity.seceded successors; no functioning center → the
    //    lapse branch fires settlement.lapsed and the land stays wilderness.
    if (rest.length) shedPatch(world, c, rest);
    // 4. ANCHOR the outcome so this firing's adoptAndFound can't undo it: every orphan
    //    that ended in a (new or restored) realm stamps its home tile — the same
    //    semantics as the territory pass's anchor fallback (countryTerritory.js:546-552).
    for (const m of orphans) { if (m.countryId >= 0 && m.countryId !== cid) co[(m.pos.y|0)*tw + (m.pos.x|0)] = m.countryId; }
    // 5. THE WITNESS RECORD, either way:
    let relTiles = 0, relPeople = 0;
    if (rel && world.popField) for (let ti = 0; ti < world.N; ti++) if (rel[ti] === cid) { relTiles++; relPeople += world.popField[ti]; }
    logEvent(world, "polity.receded", { polity: cid, name: realmName(world, cid), tiles: relTiles,
      people: Math.round(relPeople), n: orphans.length, s: orphans[0].id, sName: orphans[0].name,
      x: orphans[0].pos.x|0, y: orphans[0].pos.y|0 });
  }
  // People-but-no-settlement marches (shed ground with field people, no entity): tallied to
  // world.debug (recededTiles/recededPeople per pass), not an event — the log stays entity-
  // anchored like every other record. (Open question 2 if the owner wants the event.)
}
```
The rel-mask interplay is already correct by construction: the released-by mask blocks only the **parent** re-taking its shed (countryTerritory.js:1504/:1755), and a successor is a different id — its claim is the genuine new-realm capture the Tier-A churn fix explicitly allows (:405-412). The successor seeds full reach via snapClaim/_inheritReach (conquest.js:780-789 → countryTerritory legacy :1086-1095; under the field model the newborn holds via the cold-start guard :782-789 until its first capacity stamp). `polity.seceded` from shedPatch gains an optional `how: "receded"` field at this call path (additive, narrators unaffected).

**Residual witnessability** — the unguarded derivation (countryTerritory.js:1896-1915): at the `s.countryId = region` write (:1914), when `s.countryId >= 0 && region < 0` and the lever is on, log `settlement.lapsed { s, sName, from, fromName }` (the event and its narrator/category already exist — events.js:271-274, :336). After resolveOrphanedMarches this branch handles only stragglers (realms with no countries-view entry), but it must never again be silent.

**events.js additions**: NARRATE entry `"polity.receded"(ev, as)` → as===ev.polity ? `"The realm's grip failed on its far marches — ${ev.n} communities beyond ${ev.sName} were left to fend for themselves."` : founding-side text; categoryOf: `case "polity.receded": return "loss";`.

## Ordering, determinism, save-compat

- **Pass order** (index.js:155-160 becomes): computeTerritory → computeCountryTerritory → **resolveOrphanedMarches** → adoptAndFound → nucleateFrontierStates. All new logic is pure deterministic reads of typed arrays, the settlement array (stable order), and registries; no RNG; Map iteration orders derive from settlement order. The loyalty scan (polity pass, loyaltyField.js:240-263) sees shed→successor as wild-annex (WILD_JOIN floor, no force-detach — no `_tileCapturedAt`), and restored ground homecomes via :249-252. Nothing new for it to learn.
- **Save-compat**: zero new persisted keys. `_fpRel` is per-pass scratch; `_tileHomeland/_tileFellAt/_allegiance`, the polity registry, and the event log already persist (persist.js:206-259, :291-304). New event types are opaque records to old readers. `SUCCESSOR_STATES=0` (plus a `SIM_SUCCESSORS` env force-override, the `_envForce` pattern countryTerritory.js:40) is byte-identical to HEAD — including suppressing the new log lines, which live in saves.
- **Perf**: resolveOrphanedMarches is O(settlements) + O(N) only for realms that actually orphaned someone (7 occurrences per 12k at the reference grid); restorableHomeland is O(disk) at ≤4 foundings/pass, fused into an existing loop at the main site.

This design also discharges the recorded Tier-A constraint that `TIER_SCALE_REF` floor-pins the city label: after it, **no successor-forming channel reads the CITY label as its only bar** — the label reverts to being a label.

## Constants

- **T.SUCCESSOR_STATES** (lever, def 1, min 0, max 1): master switch for all three pieces. 0 = byte-identical HEAD behavior (the repo's lever-off convention). Physical meaning: whether the political fabric re-knits when a realm's grip fails — successor formation and restoration on, or the pre-mechanism world where shed ground lapses flagless.

- **RESTORE_MAJORITY = 2/3** (module const, countryTerritory.js): the fraction of a founding basin's *remembered* people-weight that must point at ONE fallen nation for the founding to be that nation's restoration. Independent meaning: the classic supermajority-consent bar — a restoration is an uncontested popular claim; a borderland remembered by two nations (measured case Paik: 49%) is contested and founds a new state. Not tuned to any outcome; the probe cases split cleanly at it (100%/100%/49%).

- **RESTORE_KIN = 1/2** (module const, countryTerritory.js): the share of the founding seat's census that must be lineally descended from the fallen realm's founding culture (`p.cultureId`, equal-or-descendant via the bounded parentCultureId walk — cultures.js familyOf pattern, ≤16 hops). Independent meaning: a bare majority of the restoring people are the old nation's people — the definitional line between "the nation re-formed" and "someone else settled the ruins". Abstains when the record has no culture (cid < 0).

- **Restoration viability bar — deliberately NOT a new constant**: the fallen nation's own remembered basin mass must clear the *existing* founding bar, `byH[H*]·f2c ≥ NUCLEATE_CLUSTER_POP × capMul` — the same NUCLEATE_CLUSTER_POP (400) and geography multiplier every fresh state pays (countryTerritory.js:2023-2054). The restoration is viable *as* the old nation or it isn't one.

- **Successor seat bar — reused, not new**: `(tier ≥ CITY_TIER) || (_provinceCity === self)` — blocHasSeat's exact member test (conquest.js:852), whose spacing meaning is PROVINCE_SPAN = 9 ref-tiles (a regional administration per province span). The ≥2-members-per-successor fold reuses restoreNations' existing "a state is a seat plus at least one dependent" rule (conquest.js:942).

- **polity.receded witness floor — none**: the event fires iff ≥1 settlement entity was orphaned (entity-anchored, like the whole log); tile/people counts ride as fields. People-only marches go to world.debug tallies (see open question 2).

## Validation plan

**Instrument**: promote the baseline probe (scratchpad `probe_shed_baseline.mjs`) to `tools/probe_successors.mjs`; its columns are the acceptance metrics. All runs app-identical harness, worldgen 480 (sim 240×120) seed 8817 unless noted, ≤12k steps for iteration, 24k via probe_empires for the trajectory tier.

**Before (measured, this session)**: 455 shed tiles/83 passes all populated, 7 settlement-orphanings, 0 events; 12 silent lapses, 0 settlement.lapsed; 0 polity.seceded; 4 polity.shattered with 0 fragment successors; 1 polity.restored (id-collision only); 47 wilderness tiles remembering ended polities (~168k people on them); 3 of 27 frontier foundings on ended-realm-dominant basins.

**After — expectations**:
1. **Witnessability closes exactly**: (lapse-diff count) − (settlement.lapsed events) = 0; every orphaning pass produces polity.receded + (seceded | restored | lapsed). Zero silent transitions is a hard pass/fail.
2. **Restoration fires but stays selective**: 1–3 polity.restored from wilderness foundings by 12k at the reference seed (the three measured candidate basins bracket the gates: Muudduu should restore, Paik must NOT — a named regression check on contested memory).
3. **Successor flows revive**: polity.seceded > 0 per 12k (baseline 0); founded.fragment > 0 across shatters with ≥2 functional seats; at 24k (probe_empires) secessions return toward the empire-mortality fix's measured 39/24k band, and the back-half top-3 union rises above the 6–11 plateau recorded in tier-a residuals.
4. **Micro-swarm guard (the CITY_TIER history)**: share of 1-member realms and realms < 30 tiles at each checkpoint must not exceed baseline by more than noise; total realm count stays inside the stylized polity envelope (27–31 at the reference battery). If successors read as confetti, the ≥2-fold or PROVINCE_SPAN spacing is the knob-free place to look (it would indicate assignProvinces seating too densely — fix there, not with a new constant).
5. **Churn guard**: Tier-A carto tallies (gapsBounce, fills vs net growth) must not regress — successor claims are legitimate new-realm captures, but watch that shed→successor→parent-reabsorb doesn't oscillate (pacified grace should hold it; measure polity lifespan of shed-successors).
6. **Gates that could legitimately move**: growth-acceleration and market-integration soft warnings (chronically soft since the statecraft-symmetry change — more statelets push the same direction); war-count-sensitive deadliness/succession soft bands (more polities → more wars; tier-a flags these as re-derivable); fallen-lifespan median (more short-lived successors is the *intended* signal — if the gate complains, re-derive the band per the tier-a watch note, don't suppress successors). Fish gate unaffected.
7. **Full battery**: stylized 5 seeds (8817/4242/777/31337/12345) all hard gates, soft ≤2/seed; `npm test` (determinism, invariants, save/load byte-roundtrip, dissolve). Byte-identity A/B: SIM_SUCCESSORS=0 vs HEAD must hash identical.
8. **Res-invariance spot-check**: repeat probe_successors at worldgen 960 (sim 480) ≤12k steps — orphaning rate should RISE (the diagnosis says the shed dominates at the app grid) and every one must resolve to events; restoration counts should scale with realm-death counts, not with grid size.

**Calibration procedure**: RESTORE_MAJORITY/RESTORE_KIN are principled fractions — do NOT sweep them against restoration counts (that would be outcome-fitting). If restorations measure zero everywhere, the honest diagnostic order is: (a) is realm death still too rare (diagnosis #6 — a different Tier-B item)? (b) is memory being assimilated before death (HAB_DONE)? (c) only then question the gates, with a mechanism argument.

## Risks

1. **Restoration ping-pong**: a restored nation is born into the conditions that killed it and may die/restore repeatedly — event spam and lifespan-stat distortion. Bounded by the full founding bars paid on every restoration and by pacified grace; if pathological, the fix is the death-conditions mechanism, never a cooldown timer (cardinal rule 1). Watch: restored-per-1k, re-death rate of restored ids.
2. **Same-firing coupling**: resolveOrphanedMarches stamps `co[]` anchor tiles mid-territory-pass, after the held/target ledgers were computed — those stamps are uncharged this pass (≤1 tile/member, the same under-charge the cartography headroom note already accepts, countryTerritory.js:925-936). Any overshoot is one small shed next pass. Verify with the fpPass debug snapshot.
3. **Stale world.countries at the territory firing**: `c` for a realm minted since the last polity pass is absent → its orphans fall through to the adoptAndFound lapse (now logged). Acceptable and witnessed; note in code.
4. **fragmentRealm seat basis at 960**: PROVINCE_SPAN is res-scaled in assignProvinces but NUCLEATE_R is not in nucleation (recorded latent inconsistency, conquest.js:721-723) — successor counts at the app grid may differ from the reference more than expected; measure at 960 before trusting the /2 coalescence there.
5. **Kinship walk under-matching**: if a culture record chain is broken (defensive `getCulture` miss) the walk stops and kin under-counts → restoration wrongly refused. Registries are never pruned (persist.js keeps them wholesale), so this should be unreachable — assert in the probe.
6. **Event-log growth**: polity.receded fires at most once per realm per territory pass and only on orphanings (7/12k measured) — negligible; but at 960 the shed dominates, so re-measure event volume there against EVENT_CAP (200k).
7. **Micro-swarm regression** is the headline risk of piece 2; the spacing + ≥2-fold + restless-patch preconditions are the structural guards, and validation item 4 is the tripwire. The failure mode that raised CITY_TIER (unconditional founding by every town) is not reachable through these channels — all three require an existing realm's collapse or a fallen nation's memory plus the full founding bars.

## Open questions

1. **Isolation gate on restorations**: nucleation's NUCLEATE_CAP_DIST keeps new states 8 ref-tiles from any capital. A nation re-emerging at an occupier's border fails it. Kept as-is (conservative); if validation shows restorations starved specifically by capital proximity, the owner should decide whether a restoration — an already-administered claim — may found closer, and what the mechanism-honest bar is (e.g. the occupier's actual admin load over the basin, not a distance constant).
2. **People-only receded marches**: shed ground with field people but no settlement entity currently gets a debug tally, not an event (the log is entity-anchored throughout). If the owner wants these in the chronicle, the clean unit is census-equivalent people via f2c with NUCLEATE_SEAT_POP (160, "a real community") as the floor — reused ruler, no new constant — but it needs f2c plumbed out of nucleateFrontierStates.
3. **fragmentRealm coalescence factor**: `ceil(seats/2)` keeps the code's "adjacent provinces rally in pairs" model on the new honest basis; the alternative (one successor per functional seat — Diadochi per satrapy) yields larger counts. Integrator should A/B both at 480 and 960 against the Zipf/largest-share gates before choosing; the design defaults to /2 (smaller change, same model).
4. **Restored polity's cultureId**: kept as the ORIGINAL founding culture (identity continuity — restored Poland is Poland) even when a daughter culture leads the restoration. If cultural drift should eventually re-brand the record, that belongs to the cultures pass, not to restoration.
5. **BIRTH_FIELD=0 / POP_FIELD=0 configs**: the restoration viability bar has a specified census/tile fallback, but no validated run uses those configs — confirm the owner doesn't need them gate-quality before shipping the fallback as more than lever-off parity.
6. **Eternal wilderness memory**: homeland memory never decays on unclaimed ground (by design, and cardinal rule 1 forbids a timer). The kinship gate is the sole guard against deep-time restorations ("Sumer restored after 15k steps by its actual descendants" would be allowed — arguably correct). Flagging so the owner endorses that stance explicitly.
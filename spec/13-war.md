# 13 — War in the concrete  `[DESIGN DETAIL — ratified DECISIONS 10; forms marked [DERIVE] settle at M6–M8]`

No fronts. Pre-modern war is seasonal campaigning by supplied columns
against specific objectives, with devastation as the default act and
settlement as the usual end. War is the obligation graph's furnace.

## 13.1 Armies (DECISIONS 10a)

Entities: position, composition, strength, supply state, commander
(dynasty person where one exists). Sources, all from existing books:
retinues (05, professional, year-round), levies (via obligation edges,
seasonal, harvest-bound — campaigning at harvest starves the realm, per
the labor books), called vassals (edge invocation; reliability ∝ edge
strength × legitimacy — the no-show vassal is expected), and mercenaries
(DECISIONS 10d: violence as a purchasable good in 06's market, emerging
where coin and war demand coincide; the unpaid company plunders its
employer — same books).

**The walking logistics problem:** an army carries days of food, then
forages (eats the real fields it crosses, friend or foe — foraging yield
reads population density, season, prior devastation), or draws river/sea
supply, or starves. Consequences, all derived: campaign radius (the
validated exponential force-decay, now from per-march-day supply),
campaign seasons (mud/fodder/harvest from the seasonal travel field),
water-hugging campaigns, winter quarters, and the besieger's clock (13.3).

## 13.2 Devastation and battle

- **Devastation (10b)**: ravaging writes into food stocks, works, and the
  grievance ledger; it is a strategy (force submission, deny supply, draw
  the defender out), and many wars resolve on it alone.
- **Battle** is a hazard event when armies are near — both commanders'
  incentives shape it (defender must fight for the capital or the
  harvest; raiders decline; confident commanders force it). Resolution:
  strength × military technique (armament-revolution multipliers, 11) ×
  terrain (ported ford/ridge/pass holds) × draw `[DERIVE]` → casualties
  (manpower pools + demographic field), rout, capture. Rare and decisive,
  as history had it.

## 13.3 Sieges — two clocks

The v1-validated core (sieges end by starvation; the granary is the
clock) upgraded to the honest form: **defender's granary clock vs the
besieger's own supply clock** (the camp is an army foraging an emptying
neighborhood; once plagues exist (16), camp disease drains it too —
historically the besieger broke first about as often). Assault is a costly option
against the fortification stock. **Negotiated surrender** scales with
relief prospects and the attacker's **reputation stock** (10d): honored
terms open the next gates early; a massacre closes every gate after —
one small stock, both plays available, consequences emergent.

## 13.4 Ending wars (10c) — the flicker cure

Fighting reveals strength: each battle, siege, and ravaged season updates
both sides' assessment of the odds. While assessments diverge, war
continues; as they converge, settlement hazard spikes, and **terms
formalize the shared belief as obligation edges** — tribute, vassalage, a
marriage, ceded march authority. Annexation (the loser's center swapped
into or destroyed within the winner's graph; countryside authority
recomputes) is the exception. Truce is a real state with a decaying term;
raiding across weak-authority frontiers is the ground state beneath formal
war (primitive 7 at low intensity — marches, the steppe rim), no separate
system. Pathology gate: v1's war-flicker signature (declarations ≫
concurrent wars; rematch churn) must read healthy.

## 13.5 War at sea (DECISIONS 17c)

The army logic afloat: **fleets as entities** built from port capacity,
timber, and naval technique; galley-era fleets are coastal, seasonal, and
crew-heavy (rowers draw the same manpower books; beached nightly — battles
hug coasts); the sail era extends reach and season. **Sea control** is
contesting lanes: **blockade** cuts a port's sea supply and plugs directly
into the siege/food books (island and maritime polities become
starvable); **convoy escort vs commerce raiding** is the navy working the
sea danger premium (14a); amphibious operations pay the landing bar.
Athens, Carthage, and Venice live and die by this layer.

## 13.6 Reality tables

| Quantity | Target | Source |
|---|---|---|
| Army sizes by development | Bronze thousands → classical tens of thousands → **the medieval dip** → early-modern rise (fiscal-logistic capacity drives it) | military history |
| Campaign radius / season length | era-consistent; water-hugging visible | logistics literature |
| Siege durations & outcomes | months-scale distribution; a large share lifted by besieger collapse | siege records |
| Battle casualty asymmetry | loser bears rout losses ~5–20%+ | battle records |
| War-size heavy tail | Richardson distribution (v1 gate, kept) | Richardson/Brecke |
| Settlement mix | tribute/vassalage ≫ annexation pre-modern | DECISIONS 6 alignment |
| Flicker | wars have endings; peace is a measurable state | 08.3 regression |

# Heraldry, Banners & Flags — design

A procedural visual-identity system: every people, house and realm carries an
emblem whose existence, form, and evolution are **read from the world's state**
— never granted by the calendar, never rolled independently of history. The
emblem layer is cosmetic (a rendering of identity, not a mechanic), but its
*content* is a record: you should be able to look at a realm's flag and read
its geography, faith, dynasty and past ruptures off it.

The design template is `language.js`, deliberately:

1. **Polarized style genomes, not uniform rolls.** Independent random rolls
   regress to the mean and produce generic mush. A culture's heraldic style
   pushes a handful of dials to coherent corners and lets them co-vary.
2. **Descent, drift, borrow.** Emblems have lineage. Daughter houses difference
   their parent's arms; successor states quarter or break; neighboring courts
   emulate the *practice* itself along the same contact routes that spread
   loanwords.

---

## 1. WHEN and WHY emblems appear — the four stages

Each stage is gated on **what the world has become** (population under arms,
organization/knowledge, government form, trade shape) — the same quantities
that already gate dynastic record-keeping (`dynasties.js` `LITERACY_MIN`),
government forms, and tech. A stage is *reached*, separately, by each culture
and polity; on any given map some realms fly flags while their neighbors still
raise war totems. That unevenness is the point.

### Stage 0 — Totems (peoples)

- **Who:** every culture, from birth. Pre-political, pre-literate.
- **Why:** any group needs an "us" mark — a totem animal, a sacred sign. This
  is the seed all later emblems grow from.
- **Trigger:** existence of a culture. No threshold — this is the floor.
- **Form:** a single motif drawn from the culture's *world*: its cradle
  terrain (coast → fish/wave/gull; steppe → horse; forest → stag/tree;
  mountain → peak/ram), or its founding faith's sign. One motif, one or two
  colors from locally available dyes.
- **Descent:** a daughter culture (culture branching) inherits the parent's
  totem drifted — same motif family, restyled by the daughter's own genome.

### Stage 1 — War standards (polities)

- **Who:** a polity, once it fields organized armies.
- **Why (the real-world cause we're modeling):** battlefield identification.
  Once armies exceed the scale where everyone knows everyone by face —
  massed formations, allied contingents, veiled/armored fighters — a rally
  point visible through dust and distance becomes a military necessity.
- **Trigger (state, not time):** the polity has raised an army above a size
  threshold (it already musters via `armies.js`) *and* capital organization
  is past the "organized levy" floor. A pastoral chiefdom that never fights
  at scale never needs one.
- **Form:** blunt and legible — a solid or simply-divided field in the
  dominant culture's palette bearing the totem or the state faith's sign.
  No systematization yet: two vassal towns may carry near-identical
  standards, and nobody keeps a roll of who bears what.

### Stage 2 — Hereditary heraldry (houses)

- **Who:** ruling **houses**, not polities. Arms belong to blood.
- **Why:** heraldry proper appears where three conditions meet — exactly the
  conditions the sim already tracks:
  1. **Hereditary rule** — the mark must attach to a *lineage* for it to be
     worth inheriting (monarchy, from `dynasties.js` government forms);
  2. **Recorded history** — someone keeps the roll of arms; requires the
     literacy threshold that already begins dynastic record-keeping;
  3. **Sustained elite warfare** — repeated wars between realms whose elites
     meet in battle and treaty and need to be told apart, generation after
     generation.
- **Trigger:** a polity that is a monarchy, past `LITERACY_MIN`, whose house
  has persisted across ≥2 successions, and which has fought at least one
  inter-polity war. All four are existing state.
- **Form:** the war standard is *claimed* by the ruling house and
  systematized: a field (tinctures + division) plus 1–2 charges. The **rule
  of tincture** (metal-on-color contrast) emerges here as a scribal
  convention — it is a legibility law, and it only binds courts literate
  enough to have heralds. Earlier standards may violate it freely.
- **Cadency and difference (rides the existing kin graph):**
  - a **cadet branch** differences the arms — bordure, tincture swap, added
    minor charge — same family, visibly junior;
  - an **acknowledged bastard** takes the arms debruised (the bend-sinister
    move) — visibly of the blood, visibly barred;
  - a **marriage between courts** (FOREIGN_MATCH already samples these) can
    quarter two houses' arms in the issue's shield;
  - a **succession crisis** resolved by a new house = new arms that
    deliberately *reference* the old (a charge retained, field broken) —
    legitimacy is claimed visually;
  - a **successor state** inherits the parent realm's arms differenced, so
    the map shows dynastic archipelagos the way daughter languages show
    descent.
- **Non-monarchies:** a **republic** bears corporate arms — the capital
  city's seal (bridge, harbor, grain) rather than any house's beast; a
  **theocracy** bears the state faith's sign enthroned in an escutcheon. The
  government forms already emerge; the emblem type just reads them.

### Stage 3 — Flags (states)

- **Who:** the polity itself, as an institution distinct from its ruler.
- **Why (the real shift we're modeling):** flags replace heraldry where the
  *state depersonalizes* and where *distance/mass legibility* dominates:
  1. **The sea.** Ships must be identified hull-to-hull at distance by
     strangers — the strongest single driver of simple, high-contrast,
     rectangular state flags. A land empire can stay heraldic for centuries;
     a maritime trader cannot.
  2. **Impersonal government.** A republic has no house to symbolize; a
     bureaucratic monarchy outlives any dynasty. The symbol must attach to
     the *office/state*, not the blood.
  3. **Mass participation.** Standing armies, levies, civic festivals, print:
     when many hands must reproduce the sign cheaply and recognize it
     instantly, complexity dies. Charges shed, geometry wins.
- **Triggers (any of, all state):**
  - sea-trade share of the polity's exchange above a threshold (read from
    the existing sea-lane trade) → a **naval ensign**: the arms *simplified*
    (field kept, charges reduced to one or none);
  - government becomes a republic, or a succession crisis ends the house
    while the state survives → the corporate/simplified emblem becomes the
    primary symbol;
  - organization + literacy high enough for mass administration (the same
    band where `paper`/`code_of_laws`-tier techs live) → the flag displaces
    the arms in civic use; the arms retreat to the court and the chronicle.
- **Form:** rectangular (or the culture-genome's flag shape), 1–3 tinctures,
  geometric division (bicolor, tricolor, cross, canton, saltire), at most one
  charge. Derived from the realm's heraldic ancestry: the flag of a
  post-dynastic republic is recognizably a *reduction* of the old arms —
  or, after a revolution, a deliberate *negation* of them (see §3).

---

## 2. WHAT an emblem is made of — content comes from history

An emblem is never sampled from a free-floating art pool. Every element is
a read of state:

| Element | Read from |
|---|---|
| **Charge (motif)** | culture totem (Stage 0 ancestry) · cradle/dominant terrain · state faith sign · a commemorated chronicle event (a great victory → sword/star; a founding migration → ship/bird; a survived plague or flood → mythologized sign) · staple economy (grain, vine, fish) |
| **Tinctures** | culture palette genome, constrained by **dye availability** — early emblems use local earth/plant dye colors; rare tinctures (deep purple, true crimson) appear only in realms whose trade actually reaches them, so a saturated banner *is* a wealth signal |
| **Field division** | culture style genome (see §4) + stage (Stage 1: solid/halved; Stage 2: full heraldic divisions; Stage 3: geometric) |
| **Shape** | culture genome: tapered banner / square standard / round sign / swallowtail — regionalizes by descent + contact |

Chronicle tie-in: assuming arms, breaking arms, and imposing arms are all
**logged events** ("House Varn assumes the Stag Rampant"), so the emblem's
biography is itself part of the world bible. And because dynastic history
before literacy is "the time of legends," the **historiography layer** gets a
free trick: the scribes' version may claim the arms are ancient — attribute
Stage-2 arms retroactively to legendary founders — while the true record
shows them assumed three reigns ago. Emblems acquire propaganda value for
free.

---

## 3. HOW emblems evolve and disseminate

All four dynamics mirror `language.js` (drift / branch / borrow) plus one
rupture mode:

1. **DESCENT** — cadets difference, successors quarter or difference,
   daughter cultures drift the totem. The arms tree shadows the kin graph
   and the culture tree that already exist.
2. **DRIFT** — slow stylization within a lineage: a charge redrawn in the
   current style genome, a tincture deepening as better dyes arrive. Small,
   per-generation, character-preserving.
3. **BORROW (the practice, and the style)** — heraldry *itself* spreads by
   prestige contact, like a loanword: a court in sustained contact (war,
   marriage, trade) with heraldic realms adopts arms *earlier* than its own
   thresholds alone would produce them — emulation of the strong. Style
   conventions (shield shape, palette leanings, charge fashion) regionalize
   the same way, so continents develop visible heraldic *zones* the way they
   develop language families.
4. **RUPTURE** — discontinuities read from political events:
   - **conquest**: the victor quarters the loser's arms in (absorption) or
     bans and replaces them (subjugation) — which one, reads temperament;
   - **conversion**: state-faith change swaps the faith charge;
   - **revolution / house extinction**: the new regime *breaks* with the old
     design — new field, inverted palette — the anti-emblem move; deliberate
     visual distance is itself information.

---

## 4. The culture style genome

Per culture, rolled once **toward poles** (the anti-mush move), inherited on
branching with drift, borrowable under contact:

| Dial | Poles |
|---|---|
| geometry | curvilinear ↔ angular |
| density | austere (one charge, flat field) ↔ ornate (semé, bordures, multiple charges) |
| palette lean | earth/metal ↔ saturated jewel (dye-constrained, see §2) |
| shape | tapered banner ↔ square/rect standard |
| symmetry | strict bilateral ↔ free composition |

Dials co-vary (an austere culture is austere in geometry AND density AND
palette). The genome only *styles* emblems; the *content* (§2) comes from
history. Two realms of one heraldic zone with different histories look like
siblings with different lives — which is exactly the target.

---

## 5. Data model & rendering sketch (v1 scope)

```js
// on a culture
emblemGenome: { geometry, density, palette, shape, symmetry }   // −1..1 dials
totem: { motif, tinctures }                                      // Stage 0

// on a house / polity (whichever bears it — see stages)
emblem: {
  stage: 0|1|2|3,
  field: { division, tinctures: [t1, t2?] },
  charges: [{ motif, tincture, position, debruised? }],   // ≤2 (stage 3: ≤1)
  shape,                        // from genome
  lineage: { parentEmblemId?, mode: "differenced"|"quartered"|"broken"|"imposed" },
}
```

- **Deterministic:** built from `passRng`-style seeded draws on (seed, entity
  id, event id) — same world, same arms, reproducible across save/load.
- **Rendering:** compose from a small predrawn part kit (field divisions,
  ~24–36 charge motifs, tincture palette) on canvas/SVG at three sizes:
  map marker chip (≈12px), realm-browser chip (≈24px), inspector plate
  (≈64px+). Part kit doubles as the pixel-art heraldry kit already planned.
- **Persistence:** emblems and genomes ride the save like houses do
  (serialized verbatim); the world bible export includes each realm's
  armorial history.
- **Surfaces:** Politics lens (realm chips/borders), realm browser + realm
  inspector (plate beside throne/house), chronicle entries (chip beside the
  actor), war events (both banners), Peoples lens (totems).

**Explicit non-goals (v1):** no mechanical effects (no morale/legitimacy
bonuses from arms), no player-designed emblems, no per-settlement arms
(realm/house/culture only). The one acceptable future feedback is prestige
*perception* (a realm recognizing a differenced kin emblem), and even that
waits.

---

## 6. Build order

1. **Genome + totem** (cultures) — dials, totem assignment, descent on
   branching. Render nothing yet; expose in Peoples registry data.
2. **Part-kit renderer** — canvas compositor for field/division/charge/
   tincture at the three sizes, deterministic from the emblem object.
3. **Stage 1–2 lifecycle** — triggers wired to armies/government/literacy/
   succession events; cadency + rupture rules on the existing kin-graph and
   conquest events; chronicle logging.
4. **Stage 3 flags** — sea-trade / republic / mass-administration triggers,
   simplification transform (arms → ensign → flag).
5. **UI surfaces** — Politics lens chips, realm inspector plate, chronicle
   chips, event-feed banners.
6. **Borrowing/zones + historiography flourishes** — practice diffusion by
   contact, scribes' retro-attribution of ancient arms.

Each step is independently shippable; 1–2 produce visible value with zero
simulation risk.

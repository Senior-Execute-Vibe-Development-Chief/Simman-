# 07 — Peoples, tongues, faiths, and the ported verticals  `[FULL DETAIL for ports; DESIGN for integration]`

## 7.1 The identity layers

Three field-borne mixes over communities (culture, language, faith) plus
deep ancestry (worldgen's peopling wavefront, ported). Doctrine:

- **Identity is not polity** (DECISIONS 6): "Greece" is an identity-layer
  phenomenon over many centers. Political actors can *mobilize* identity
  (legitimacy discounts among co-identifiers, coordination in revolt,
  league formation affinity) but never equal it. Nation-states are the
  late alignment of the two layers — an emergent event.
- Mechanisms port from v1's validated set, re-homed on communities:
  assimilation toward prestige centers at rates set by authority and
  contact; divergence by isolation and by accumulated distance from a
  people's core (the Bantu-expansion rule — branching on *cumulative*
  drift, not single hops; v1's identity-collapse fix, engraved);
  trade convergence; ethnogenesis under durable foreign rule.
- Faiths: folk faiths per culture; organized faiths condensing under the
  conditions v1 validated; conversion pulls, schisms, pilgrimage economy
  (offerings decay with distance — coin flows through 06's books). Frontier
  resistance between organized families, with the royal-adoption channel
  open (great sweeps happen via thrones). Whether faith hierarchies are
  full obligation-graph actors is P6 (open).

## 7.2 The language engine `(port verbatim)`

V1's language cluster is self-contained (one RNG import; a four-verb
lifecycle: found / branch / drift / borrow) and persists only seeds +
history — vocabularies, grammars, and scripts derive deterministically.
v2 hands it a bag `{languages, nextId, step, seed}` and drives the verbs
from culture events. Scripts spread down the transmission ladder
(logograph → syllabary → alphabet) on contact, never on time. The areal
test harness comes with it as its acceptance suite.

Naming per P7: place, person, realm, and dynasty names are generated
(canon); the real-geography gazetteer is an optional annotation overlay.

## 7.3 Emblems and heraldry `(port verbatim / with cleanup)`

The emblem genome engine ports verbatim (pure, deterministic, axis-driven,
no cultural stereotypes baked in) with its art data and CC-BY attribution;
its property test suite comes along. The armorial grammar ports with
re-binding to v2 registries. v2 upgrade (was designed-unwired in v1):
genomes persist on identity records — cadency on succession, marshalling
on union — so arms *evolve* with houses.

## 7.4 Great people `[DESIGN]`

Persons exist as entities only where load-bearing: rulers, founders, heirs
(dynasty machinery ports from v1 — kin graphs, succession law, crises).
"Great people" beyond courts (inventors, prophets, conquerors from nowhere)
are condensation events: hazard-rated by the conditions that make genius
*legible* (density, literacy, patronage, unrest), named by the language
engine, leaving marks through existing mechanisms (an invention arrives
where induced innovation already points; a prophet founds where faith
pressure already builds). No hero mechanics — biography as the visible
face of pressures.

## 7.5 Historiography `(carry the v1 feature)`

The world writes chronicles about itself, with the true-record vs scribes'
version split — the scribes' version filtered through the writing culture's
perspective and the patron's legitimacy needs. A distinctive product
feature; implementation rides the event log.

## 7.6 Values and societal character (DECISIONS 15)

Societal "personality" is path dependence in three layers: what a society
practices (11), what it institutionalized (11/05), and **what it has come
to prize** — a small value vector per culture (martial honor, commercial
esteem, piety, learning, austerity, splendor), written as a slow EMA of
practiced and rewarded life, read back as behavioral weights on the
hazards and pressure dynamics wherever style matters (13 war appetite,
14c prestige-project choice, extraction restraint, conversion resistance,
exploration, 11 blocking). The generational lag is the lock-in: the
war-forged culture comes to prize war and keeps prizing it after the
cause dies — situation → institutionalized response → cultural lock-in →
selection's eventual fee (Sparta's arc, end to end). **Founder effects**
at branching amplify individual traits into cultural ones (small-N
drift). **No society-level dice, ever** (15c): idiosyncrasy enters only
through persons and founders. The emblem engine's semantic axes read
these values — it was built waiting for them.

## 7.7 Reality tables

| Quantity | Target | Source |
|---|---|---|
| Language/culture counts and area scaling | count ~ area^k, 0<k<1; family geography plausible | macro-linguistics (v1 gate) |
| Top-identity share | never converges to one people/faith/tongue world; plural-or-sweep distribution | v1 identity gates |
| Faith structure | folk substrate + few organized families + schism trees | history of religions |
| Onomastics | cognate place-name landscapes along expansion routes | (qualitative; language engine property) |

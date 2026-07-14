# The Emblem Engine — a heritable design-genetics for every banner

*Working notes for future generations. Status: standalone — deliberately **not**
wired into the simulation yet. Everything here is engine + tools + lab.*

The emblem engine turns a small **gene vector** into a flat 2D banner design —
European-style heraldry, an imperial silk, a monochrome mon, a calligraphic
banner, a steppe tamga, geometric tilework, a sacred sigil — and makes that
design **evolvable**: it drifts under mutation, passes to successors with
cadency, and recombines under unions with true accumulating marshalling.

```
genome {genes[26], seed, gen, quarters?, cadency?}
   │  expressGenome()            (pure, deterministic)
   ▼
phenotype {substrate, composition, colors, field, motif, cadency, …}
   │  emblemSVG() / drawEmblem() (pure, deterministic)
   ▼
flat SVG
```

## The six hard constraints

1. **Emergent** — nothing gates on time/step/year; only on state (CLAUDE.md
   cardinal rule 1).
2. **Build the system, never fit the outcome** — no constant tuned to a
   specific result (cardinal rule 2). Where a pick must be made, it is a
   uniform mechanism (class opposition, argmax distance), never a special case.
3. **Flat 2D only** — no physical standards or 3D; subtle 2D shading is fine.
4. **Decoupled** — no pattern or charge is tied to a "kind of realm" or a real
   culture. Every pattern is reachable by any genome. The lab's style presets
   are UI bookmarks into gene-space, nothing more.
5. **No real religious iconography** — faiths get procedural *sacred sigils*
   (an original symmetry-grammar), never a real symbol.
6. **Deterministic** — all randomness is seeded mulberry32; no `Math.random`
   in engine code. A genome and its whole evolutionary tree replay identically.

## Files

| file | role |
|---|---|
| `src/sim/emblemGenome.js` | genes, evolution operators, tinctures, expression, blazon, distance |
| `src/sim/emblemRender.js` | **all** drawing — the single source of truth for rendering |
| `src/sim/heraldryChargesDetailed.js` | generated: 186 recoloured charge silhouettes (~4 MB; grep, don't read) |
| `tools/build_charges.mjs` | builds the charge module from `assets/charges-src/*.svg` |
| `tools/measure_charges.mjs` | **run after build_charges**: re-anchors every charge viewBox to its measured artwork bounds (headless Chromium) |
| `tools/render_emblems.mjs` | static preview sheets (`node tools/render_emblems.mjs both out.svg`) |
| `tools/build_lab.mjs` + `tools/lab_template.html` | builds the interactive lab by inlining the two src modules + a size-capped charge subset |
| `tools/emblem.test.mjs` | property harness — runs as part of `npm test` |
| `tools/flag-reachability.mjs` | **the flag reachability audit** — pins the deciding genes (computed from the live `POOLS`), sweeps founder seeds, and verifies the expressed phenotype against a per-flag structural predicate; every MISS is a capability gap to BUILD, never a flag to hard-code |
| `tools/proof_sheet.mjs` | render a labelled grid of emblems to PNG (headless Chromium) and *look* at it — the eye is part of the acceptance test |

## The genome

26 genes, all in [0,1]; order is the crossover backbone. Enum-valued genes
decode by `pickEnum` (equal windows). Genes not expressed by the chosen
composition still ride along and can surface in a descendant.

Beyond `genes`, a genome may carry **`quarters[]`** (accumulated marshalling,
see below) and **`cadency`** (an integer, the mark of difference).

Several genes are deliberately *overloaded* so the vector never grows: e.g.
`hueC` picks the ordinary, `crescent`'s high window picks a field treatment,
`stripes` counts barry/paly *or* splits an ordinary into diminutives,
`brandSeed` seeds tamga/tilework *or* picks a shield outline, `sunDisc`'s
tails set a charge's attitude. The depth is latent in the vector.

### Evolution operators

- `foundGenome(seed, axes)` — a genome from a seed, optionally biased by
  **abstract visual axes** (figuration, ornateness, boldness, saturation,
  symmetry, tone, hue, format). Deliberately no axis picks a composition or a
  charge category — that's how decoupling is enforced at the API. **Beyond
  those eight abstract dials, a second layer of SEMANTIC axes reads a realm's
  emergent state** — environment (`maritime`, `sylvan`, `arid`, `montane`),
  ethos (`regal`, `martial`, `austere`, `mercantile`, `devout`, `pastoral`),
  structure (`imperial`, `tribal`). Each keys on an emergent STATE variable
  (biome cover, martial ethos, court wealth — never an identity label) and
  shifts a SOFT window: it makes a look more likely, never forces it, so every
  pattern stays reachable by every realm (decoupling's essence holds). Each has
  a strong defining lever (usually the palette — a coloured family is a joint
  lock of hue + value + chroma + mode) and soft secondary ones (category,
  layout), so a family reads at a glance yet stays varied and never a stamp.
  Measured at full strength: maritime→blue 82%, sylvan→green 77%, martial→
  red/black 91%, devout→sigil/aniconic 88%. This is the standalone half of the
  sim-integration mapping (realm state → axes); the transmission layer (descent,
  conquest, prestige-imitation, religion) that turns these into shared, evolving
  TRADITIONS is the sim session's work.
- `mutateGenome(g, seed, strength)` — drift + rare macro-mutations. The same
  bearer: cadency is preserved; quarters drift gently and rarely simplify.
- `inheritGenome(parent, seed, strength)` — a successor. **Cadency**: the heir
  bears the next mark of difference (label → crescent → mullet → martlet →
  annulet → fleur, capped); with p=0.3 the heir takes the house outright and
  the marks clear.
- `crossGenome(a, b, seed)` — uniform crossover of the house *style*, plus
  **accumulating marshalling**: each parent contributes its quarter list
  (itself, if simple), duplicates collapse (dedup by `genomeDistance < 0.02`),
  the four most senior survive. A union founds a new house: cadency clears.
- `genomeDistance(a, b)` — cheap one-pass metric, circular on the hue genes.
  Used for dedup, measured fitness, and the lab's kinship tree.

## The tincture system

Tinctures are **typed**: metals (or, argent — the light class), colours
(gules, azure, vert, sable, purpure — dark), stains (murrey, sanguine, tenné —
dark off-hues). The genome's colour intent walks the **dyer's wheel**
(`DYE_VATS`): hue availability follows the great dyestuffs — madder reds,
weld golds, woad blues wide; purples and tawnies princely slivers — the same
way `MOTIF_CATS` windows model armorial frequency. Naming is a *vat* question
first: each vat lists the names it can be called, and **OKLab** nearness only
ranks within that family (a plain 3D nearest-colour match fails — a vivid
green intent matches muted tinctures on lightness and comes out "tenné").
Each vat also carries the depth its dyestuff can reach (weld is a light dye,
woad a deep one); the value gene picks depth *within* the vat. Argent and
sable join every field's candidates — undyed cloth and the soot vat are
always on the shelf — so metal fields still emerge from pale, dull intents.

The **imperial silk** and **earth pigment** palettes make *continuous*
colours (a free hue, not a vat), and the **bunting** snap picks a named bolt
for one: all three name that colour by its HUE family first (`nameByHue`),
never by 3D nearest — a vivid green matches muted tinctures on *lightness*
and would come out "or", so the wheel's hue-first principle names it "vert"
(and a green silk snaps to the vert bolt, not the gold). Near-neutrals still
fall to metal/soot by lightness.

**The rule of tincture is constructed, not checked.** What a mark wears
follows from what it lies on (`tinctureOn`):

- uniform-class ground of genuine named tinctures → pick from the *opposite*
  class (the hue gene chooses freely inside the pool — opposition alone
  guarantees it reads);
- anything else (mixed colour-and-metal parties, continuous silk/clay fields)
  → threshold-free **argmax of min OKLab distance** over the named palette,
  with a two-pole mode's own poles as first-preference candidates.

Charges **on** an ordinary derive against the band, not the field — the same
rule applied one layer up. Over a mixed two-region party a charge or ordinary
may instead be **counterchanged** (the field's tinctures swapped across the
line). Monochrome heraldic coats engrave the hues their genes imply as
**petra sancta hatching** (dots or, vertical gules, horizontal azure, …).

## The grammar (what can be expressed)

- **Substrates**: shield (heater / Iberian / French / kite outlines), banner,
  roundel, pennon, gonfalon, lozenge. Flag substrates get vexillological
  grammar: Nordic cross toward the hoist (equal arm thickness, the true
  construction), hoist-pointing pile, COUCHED pall and chevron (the Y and
  the wedge-band lie on their sides, arms from the hoist corners — a
  shield's upright pall doesn't exist on cloth), true rectangular canton,
  **fimbriation** (a separating outline on an ordinary or around a charge,
  tincture chosen by the same argmax rule against *everything it touches*),
  and **device panels** (a disc, lozenge, or **inescutcheon** — the small
  state-arms shield — bounding the charge, the charge re-derived against
  the panel: the tincture rule applied recursively). Flag cloth is *sewn,
  not engraved*: seams run straight (the serrated per-pale hoist line
  excepted), the engraver-only partitions express as their sewn analogues
  (gyronny → per saltire, grids → stripes, per chevron → the **hoist
  wedge**), petra sancta hatching, vair and the lattice treatments stay on
  shields (ermine flies — Brittany), attitudes don't express, and a FIGURE
  steps back — never in multiples or strewn, at reduced size, panel-bounded
  more often. Same genes throughout — the substrate reinterprets them.
  See `docs/flag-realism-research.md` for the research behind the modern
  grammar (sources inside). The realism mechanisms, all substrate-keyed:
  - **Corpus-weighted partitions (orientation decoupled from magnitude)** —
    on cloth the partition gene decodes through its own frequency windows
    (the DYE_VATS idiom): horizontal stripes dominate, vertical bands next,
    diagonals and the hoist wedge present, quarterly and per-saltire genuine
    rarities; the engraver partitions don't exist here at all. The families
    are **interleaved across the whole gene range**, never segregated by
    magnitude — else any bias that pushes the gene down (a "plain, clean"
    ornateness, say) silently makes ~96% of flags a horizontal tricolour and
    leaves vertical bands, diagonals, the hoist wedge and quartered fields
    effectively unreachable. That is the two-clock trap in *space*: a whole
    family gated off by a magnitude no one intended as a gate. Slot counts
    still set commonness; reachability stays uniform whatever biases the gene.
  - **The field is the flag** — on partitioned cloth the arrange gene's
    first window flies the geometry ALONE (no device): pure tricolours and
    striped fields, ~38% of heraldic cloth, matching the real ~40%. A
    plain field always speaks through its device.
  - **The constellation grammar** — cloth never wallpapers a repeated
    compact device: the multiple-intent (three / in-pale / semé) expresses
    as an organized **array** — offset rows (the staggered long-flag
    algorithm), a ring, an arc, or a seeded constellation (the idle brand
    gene seeds the sky exactly as it seeds a tamga; the idle script gene
    picks the pattern; the count gene counts members, 2–13, each pattern
    imposing its own geometric floor) — or as SATELLITES: one greater
    device toward the hoist, the rest attending in an arc ("in majesty").
    Blazoned "five mullets in annulo". The celestial pool carries the
    conjoined STAR AND CRESCENT as a single classic device.
  - **The flag device vocabulary** — repeated, housed, or band-riding
    devices are cut from folded cloth many times over: only the simple
    silhouettes survive (mullets, discs, crescents, moons…); the ornate
    interlace (knots, frets, clan marks) stays a shield's and a mon's
    business. A LONE central device keeps the full pool. The rayed suns
    (`sun`/`sunRays`/`sunOutline`) are OUT of the whole charge vocabulary —
    their bundled art reads as a microbe, not a solar disc; a clean sun-disc
    flag (Japan/Bangladesh class) still flies through the geometric `roundel`.
  - **The canton houses the device** — the canton is the position of
    honour, not a second device: a compact device or its whole array moves
    INTO the canton and dresses against it; a figure never boards it; the
    hoist-top stays free (no canton over an ordinary); the canton edge
    SEAMS to a stripe or band boundary whenever one lies near.
  - **The cloth cut** — a banner's ratio (1:2 … 2:3, the real spread)
    comes from the substrate gene's position within its own window.
  - **The Spanish fess** — the thickness gene (the diminutive-splitter,
    same windows) may double a tierced band: middle (1:2:1) or first
    (2:1:1).
  - **Corpus-weighted composition & palette** — the composition and palette
    genes decode through flag-specific windows on cloth (the FLAG_PARTITIONS
    idiom): the vexillological grammar (~84% heraldic + central device) and
    the bright dyed-bunting palette (~80%) dominate, because that is what a
    modern flag almost always IS. Calligraphy, sacred sigils, tamgas and
    tilework — and the imperial-silk and earth-pigment palettes — stay
    REACHABLE but become the rare institutional banners they are (every
    composition and palette is still reachable on cloth: reachability is the
    decoupling constraint, not equal odds). This is also what lets the
    dyer's-wheel hue reach most flags instead of being overridden by a silk
    that remaps it.
  - **Gold grounds a flag only rarely** — on cloth the metal that grounds a
    whole flag is undyed (argent, the default bolt); gold is a device-and-
    stripe metal (the rule of tincture's charge-metal) and a solid gold
    ground reads weak at distance, so a SOLID gold field from any but the
    most saturated intent grounds as undyed cloth. Gold as a STRIPE, charge
    or canton is untouched (a gold band is common — Germany, Colombia). Solid
    gold fields fell 26% → 6%; white leads presence 52%, the Earth ordering.
  - **Blue and green don't collapse to grey** — a saturated colour order is
    DYED, not left near-neutral: a real-chroma field intent whose vat carries
    a colour keeps that colour instead of falling through to undyed cloth or
    soot on lightness alone (the mill stocks the flag-blue and flag-green
    bolts). Blue presence recovered 15% → 25%, now proportional to its
    dye-availability share of the wheel.
  - **No purple, no furs, no weather on cloth** — PURPURE joins the stains
    off the bunting shelf (Tyrian purple was history's rarest, costliest
    dye, never mass-produced — which is why real modern flags almost never
    fly it; a purple intent comes back as its nearest bolt). FURS don't fly
    (a field of ermine spots or vair bells reads as scattered noise at flag
    distance). The NATURAL category (flint, fireball, cloud, flames,
    teardrop) remaps to a clean celestial/geometric device — a weather blob
    isn't an emblem at distance. All three stay on shields and silks.
  - **The field is the flag (strengthened)** — most partitioned cloth flies
    the geometry ALONE (~60%, the Earth rate); a device appears only from the
    arrange gene's upper band and is a lone central emblem (compact multiples
    still organize into an array), and an ordinary (cross, pile, Y) sheds its
    company unless the gene calls for it. Device rate fell 61% → 42% (Earth
    ~40%); when a device flies it's geometric/celestial 55% of the time.
  - **The bunting shelf** — flags are sewn from the six fast single-vat
    bolts; the overdyed stains stay on shields and silks (a stain-intent
    comes back as its vat's fast recipe or the nearest standard bolt; a
    vat LED by an overdye stain isn't milled as bunting at all), and the
    continuous silk/pigment palettes snap to named bolts. Measured: flag
    fields run gules 27 / azure 19 / or 19 / argent 12 / vert 12 — the
    real corpus ordering — while shields keep their stains.
  - **The bunting recipes** — the same named bolts, the mill's own dye
    lots: painter's tinctures are aged pigment, industrial fast dyes run
    VIVID (the "Olympic" gamut real flags fly). Every derivation and the
    blazon stay in the painter's space; only the woven cloth's rgb swaps
    (classes and legibility re-verified: the recipes' metal↔dark floor,
    0.397, exceeds the paint's own 0.152).
  - **The mill's defaults** — WHITE is undyed cloth, the default bolt: a
    pale order duller than the dullest dye lot ships undyed (why dusty
    pigment traditions fly white, not mustard); the light mark on a dark
    ground follows the intent's own saturation (undyed vs a yellow lot),
    so white leads gold everywhere, as on Earth. Colour-and-colour parties
    need a stronger intent on cloth (legibility economics); silks and
    pigments re-derive their marks IN BOLT SPACE against the snapped field.
  - **Fimbriation is a function, not a fashion** — it fires only when it
    has a job (a colour band on a colour ground, its rule-of-tincture
    purpose; a metal band needs none and real flags fly none), and the
    separator is undyed cloth or soot — judged only against the band and
    the grounds of the band's own class (it may run invisibly across the
    rest, the real construction). A fimbriated couched PALL encloses its
    hoist MOUTH: the embraced wedge takes its own statement colour — the
    full unity-Y.
  - **The superimposed union** — when two BAND-LED cloths (a cross and a
    saltire) marshal, the union doesn't fly a canton: the senior's band
    rides over the whole field, separated by undyed cloth (the 1606
    construction as a mechanism). Blazoned "…; surmounted, for the union,
    by a cross Argent fimbriated Sable". All other unions keep the
    canton-ensign.
  - **The sewing economy** — a mark lying on another mark reuses a bolt
    already flying whenever it reads (class opposition on a uniform
    ground; at least the palette's own metal↔dark minimum on a mixed one).
    Flags run 2 bolts 59% / 3 32% / 4 8% — NAVA's "two or three basic
    colours" as economics, not decree.
  - **The ensign grammar** — marshalled CLOTH never quarters: the senior
    coat flies as a canton (sewn — expressed on the parent's substrate)
    over the house's own field; shields keep true quartering. Blazoned
    "…; in the canton the union: …".
  - **The legibility window** — a LIVING figure flies only from a strongly
    figural tradition (the same 0.72 iconism boundary that forces heraldic
    composition); weaker figuration sews the non-living pick. Flags carry
    a beast ~11% vs shields ~31% — the real gradient.
  - **Compound fields** — a hoist element (a vertical BAND / pale, or a WEDGE /
    triangle) laid over a horizontally-striped fly, each in its own bolt: the
    Arab and African compound flags (Benin, UAE, Madagascar, Jordan, Sudan,
    Cuba). The engine otherwise commits to ONE partition, so this whole family
    was unreachable. It is not a second partition fighting the first — the base
    partition stays the FLY striping and the hoist is a distinct region drawn
    OVER it (decoupled exactly the way an ordinary decouples from the field). It
    reuses the field-embellishment gene (crescent) whose FUR output is discarded
    on cloth — a shield furs, sewn cloth carries a hoist device: one gene,
    reinterpreted by substrate, so the vector never grows. The shape rides the
    idle line gene, the extent the idle motifScale gene. A hoist band is a
    COMPLETE statement — no chief, bordure, device or canton stacks on it (else a
    same-tincture chief and pale fuse into a broken L). ~4% of flags, spread
    across all three fly partitions and both shapes.
  - **The tricolour ordinary — fimbriation as an ENABLER, not an ornament** —
    the rule of tincture forbids a colour band on a colour ground UNLESS a metal
    (or undyed) separator runs between them; that is the whole reason
    fimbriation exists (Norway, Iceland, DR Congo, Trinidad — a colour cross /
    bend on a colour field, edged white). The engine previously always
    constructed the band OPPOSITE-class to the field, so colour-on-colour never
    arose and this entire family was unreachable. On a uniform COLOUR ground a
    single bare ordinary may instead take a SECOND colour (the secondary gene —
    already "a colour beside a colour" — asks for it), which then MUST be
    fimbriated by the opposite class; a metal ground, or no such intent, keeps
    the plain opposite-class band (Denmark / Sweden / Switzerland). A tricolour
    ordinary is a complete statement (no chief/bordure — they read on the field
    via markT, which now differs from the band). Fimbriated ordinaries ~10% of
    flag ordinaries; the on-band charge now reads against the BAND's own tincture.
  - **The symmetric cross** — a flag cross is Nordic (hoist-shifted, edge-to-
    edge) by default; a strong symmetry intent makes it a centred COUPED cross
    instead (Switzerland, Georgia). The symmetry gene is otherwise idle on a
    bare cross (counterchange needs a two-region partition, a plain field isn't).
    Blazoned "a cross couped".
  - **The canton's own charge** — a lone canton flies a star, a sun, or a CROSS
    (Greece, Tonga): the idle sunDisc gene splits three ways instead of two.
    Blazoned "on a canton Azure a cross Argent".
  - **Stripe counts to fourteen** — the barry/paly count curve reaches 14
    (Malaysia) as well as 13 (USA), 11 (Liberia), 9 (Greece/Uruguay); the count
    words extend to match.
- **Partitions**: per pale/fess/bend, quarterly, gyronny, per saltire, per
  chevron, barry, paly, **chequy**, **lozengy**, **tierced** (in pale /
  in fess — the tricolour, third tincture constructed against both
  neighbours, one band optionally doubled: the Spanish fess) — edges in
  line-styles (wavy, engrailed, embattled, indented).
- **Field treatments**: ermine, vair (real grounds — marks pick against
  argent / argent+azure), **fretty**, **masoned**.
- **Ordinaries**: fess, pale, bend, bend sinister, chevron, cross, saltire,
  pile, pall — plus chief and bordure; **diminutives** (bars, pallets,
  bendlets, scarpes, chevronels ×2–3); optional counterchange.
- **Company**: an ordinary may stand alone, carry charges **between** it, or
  bear charges **on** the band; or a semé field lies beneath it. Placement
  slots live in the phenotype (`motif.slots`) — one source for renderer and
  blazon.
- **Charges**: ~480 recoloured silhouettes in 11 categories (weighted by
  rough armorial frequency — beasts/objects/geometric common, insects and
  naturalia the rarities they really were) + 17 vector
  primitives (mullets, roundel, annulet, lozenge, fusil, mascle, billet,
  delf, crosses, goutte, …) that counterchange and semé crisply. Aniconism
  (low `iconism`) remaps living categories to non-living ones. Rare
  **attitudes**: inverted / contourné.
- **Non-heraldic compositions**: central device, radial badge, calligraphy
  (procedural pseudo-script; `scriptDensity` sets rows/packing), tamga,
  geometric tilework, semé, sacred sigil.
- **Marshalling**: `quarters[]` renders as a recursive quartered shield
  (2 coats sit 1&4/2&3; 3 repeat the senior in IV; each quarter is a full
  coat through the same pipeline).
- **Cadency**: the mark of difference rides in chief, over everything —
  including a marshalled display.

## Blazon

`blazonGenome(genome)` emits the formal sentence — *"Chequy Azure and Or, a
lion Gules"*, *"Azure, two bars Or between three mullets Or"*, *"Ermine, a
fess Gules, a label Or for difference"*, *"Quarterly: I. …; II. …"* — and an
honest plain-language line for the non-blazonable traditions.
`describeGenome` is the terse debug line.

## Invariants (enforced by `tools/emblem.test.mjs`, part of `npm test`)

1. Rule of tincture holds for every mark on every ground (strict class
   opposition on genuine named grounds; measured min-dE bound ≥ 0.1 on mixed
   or continuous grounds — observed minimum ≈ 0.19). Housed devices audit
   against the canton block; panel charges against the panel.
2. Every motif id in every pool resolves to art (primitive or raster).
3. express/mutate/inherit/cross replay deterministically.
4. Marshalling: self-cross stays simple; unions accumulate deduped quarters
   capped at 4; quarters persist under drift; marshalled coats render;
   shields blazon "Quarterly: …", cloth "…; in the canton the union: …".
5. Cadency: appears down inherit chains, clears eventually, caps at six,
   survives mutation, clears on cross; blazoned "for difference".
6. Reachability: all ten tinctures appear as fields; chequy/lozengy/fretty/
   masoned/diminutives/attitudes all expressed in an 8k sample — plus all
   four array patterns, housing, both Spanish-fess forms, both cloth-cut
   extremes, the inescutcheon, bolt reuse, and a figure on cloth.
7. Flag grammar: no unorganized multiple (semé/three/in-pale) on cloth;
   array counts bounded with per-pattern floors; a housed device implies
   its canton, a canton implies a free hoist; banner cuts stay in
   [1:2, 2:3]; no stain ever flies; ≤ 5 bolts per flag; a living figure
   implies the figural tradition (iconism > 0.72). A compound HOIST element
   is flag-only, sits over a horizontal fly, never beside an ordinary or a
   device, and reads against the fly grounds. A fimbriated ordinary may lie
   same-class on the field (its separator is the legaliser, audited on its job).

## Flag reachability (the corpus backbone)

`tools/flag-reachability.mjs` walks the world's national flags: for every
in-scope flag (a general vexillological pattern, *not* a bespoke emblem) it
pins the deciding genes — values computed from the live `POOLS` arrays, never
hand-typed, so a reorder can't stale them — sweeps founder seeds, and checks
the expressed phenotype against a structural predicate (structure, not pixels —
the predicates are colour-agnostic). A witness seed proves reachability; a MISS
is a capability gap to BUILD, never a flag to hard-code. Bespoke flags are
listed with a one-line exclusion reason so the corpus is auditable. The
mechanism audit covers **36 structural targets** (each a family, representative
flags named); status there is **0 MISS**.

`tools/flag-world.mjs` then walks **all ~197 sovereign flags one by one** — the
whole corpus, not a sample — tagging each by structure and verifying the tag is
reachable. Honest coverage: **~103 reachable, ~69 bespoke-excluded, ~25 genuine
structural gaps** (≈80% of in-scope structures; ≈87% of all flags reachable or
legitimately excluded). The remaining gaps cluster into the next round of
general mechanisms to build — among them: oblique bands *radiating from the
hoist* (Seychelles, Marshall Is.), *fimbriated stripe seams* (Gambia,
Uzbekistan), a device *on* a hoist band (Guinea-Bissau), the quintband
1:1:2:1:1 mirror (Thailand, Costa Rica → a general N-band symmetric tierced),
a *rayed sun to the edges* (North Macedonia), the *superimposed Union Jack*
class (UK + Commonwealth cantons), overlaid hoist triangles (Timor-Leste),
and several near-misses (two-star diagonals, two parallel diagonals, quartered
+ stars). Each is surfaced honestly as a missing SYSTEM, never hard-coded.

## The lab

`node tools/build_lab.mjs` → `tools/emblem-genome-lab.html` (gitignored;
deployed as a claude.ai artifact). Everything runs the *real* inlined engine.
Features: style presets (UI bookmarks), design axes, seed load, gene
inspector with precision editor, mutate/inherit/cross with strength control,
copy/paste genome, shareable URL-hash links, SVG/PNG export, a living
population under drift or measured-fitness selection (distance to a pinned
target), a kinship dendrogram over `genomeDistance`, and ancestry tracing.

## Charge art pipeline

`assets/charges-src/*.svg` (sources not committed) → `build_charges.mjs`
(strip backgrounds, detect recolour slots, minify) → **`measure_charges.mjs`**
(render each charge in headless Chromium, measure the painted leaves, keep
the dominant cluster, drop stray crop-marks, strip zero-scale matrices, and
re-anchor `vb` to true bounds + 2% pad). Never trust a source viewBox.

## What's deliberately NOT here yet

Sim integration. When it happens: realms found genomes from emergent state
via the abstract axes; successions call `inheritGenome`; unions/conquests
call `crossGenome`; schisms re-seed sigils. The engine primitives all exist —
the delicate part is mapping emergent realm state → axes without violating
the cardinal rules. That work deserves its own session.

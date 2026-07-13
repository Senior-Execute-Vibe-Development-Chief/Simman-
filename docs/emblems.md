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
  charge category — that's how decoupling is enforced at the API.
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
  - **Corpus-weighted partitions** — on cloth the partition gene decodes
    through its own frequency windows (the DYE_VATS idiom): horizontal
    stripes dominate, vertical bands next, diagonals and the hoist wedge
    present, quarterly and per-saltire genuine rarities; the engraver
    partitions don't exist here at all.
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
    silhouettes survive (mullets, discs, crescents, suns…); the ornate
    interlace (knots, frets, clan marks) stays a shield's and a mon's
    business. A LONE central device keeps the full pool.
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
  - **The bunting shelf** — flags are sewn from the seven fast single-vat
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
   implies the figural tradition (iconism > 0.72).

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

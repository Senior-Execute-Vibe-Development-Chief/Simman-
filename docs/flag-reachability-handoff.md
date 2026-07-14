# Handoff — make the emblem engine reach the whole world flag corpus

**Mission.** Walk the world's national flags one by one. For every flag whose
structure is a *general vexillological pattern*, prove the generator can express
it. Where it **can't reproduce a flag perfectly, extend the engine to add that
capability** — as an emergent, reachable mechanism — then reproduce it. Exclude
only flags whose defining feature is a *bespoke emblem* (a unique national icon
or coat of arms), e.g. South Korea's taegeuk-and-trigrams or Kenya's Maasai
shield. The deliverable is an engine whose gene space reaches essentially every
non-bespoke real flag, verified by an audit and by eye.

---

## 0. What this codebase is (read first)

Simman's **standalone emblem engine** — a heraldic/vexillological
genotype→phenotype generator. A 26-gene vector (`expressGenome`) decodes to a
flat SVG (`emblemSVG` / `drawEmblem`). It is pure and deterministic (mulberry32
PRNG; **no `Math.random` in the engine**). It is **not wired into the sim** — you
develop it standalone through a browser lab.

Read, in order: `CLAUDE.md` (the two cardinal rules — non-negotiable),
`README.md`, `docs/emblems.md` (the mechanism catalogue), and
`docs/flag-realism-research.md` (the vexillology behind the current grammar).

Key files:
- `src/sim/emblemGenome.js` — genome→phenotype. The pools and windows live here:
  `FLAG_PARTITIONS`, `ORDINARIES`, `FLAG_COMPOSITIONS`, `FLAG_PALETTES`,
  `MOTIFS`, `FLAG_SIMPLE`, `ARRAY_PATTERNS`, `PANEL_SHAPES`, the `foundGenome`
  axis biases, and the `expressGenome` assembly.
- `src/sim/emblemRender.js` — SVG rendering: `ordinaryPath`, `placeArray`
  (constellation grammar), `canton`, `deviceAt`, panels, the superimposed union.
- `src/sim/heraldryChargesDetailed.js` — bundled charge art (`CHARGE_DETAIL`).
- `tools/lab_template.html` + `tools/build_lab.mjs` — the lab. Edit the template
  and `src/`, then `node tools/build_lab.mjs` inlines the **real** engine into
  `tools/emblem-genome-lab.html` (a gitignored build artifact).

The latest emblem work is on branch **`claude/pensive-carson-58eb0r`** — base
your work on it (or on the default branch if it has since been merged). Push to
*your own* assigned branch, never to another. The lab is published at
`https://claude.ai/code/artifact/eb25d9ae-8f7e-40eb-a121-daf9d545acd0`
(favicon 🛡️) — redeploy there.

---

## 1. THE TWO CARDINAL RULES (they govern everything you do here)

**Rule 1 — everything emergent, never gated on time.** A thing happens because
of what the world has *become*, never because of *when* it is. (Less relevant to
this task, but never violate it.)

**Rule 2 — build the SYSTEM, never fit the OUTCOME.** *This is the rule this
whole task lives or dies by.* The mission literally hands you a list of target
outcomes (real flags). **You must not reach in and produce them.** When a flag
can't be made, do **not** write `if (wantSweden) …`, do **not** add a
`SWEDEN_CROSS_OFFSET` constant, do **not** clamp a proportion to a country's
value. Instead find the **general mechanism** the engine is missing — a new
partition, an ordinary variant, an arrangement, a proportion window, a
treatment, a compound field — add it as a corpus-weighted, fully **reachable**
option, and let Sweden (and Finland, and every seed you'll never see) fall out
for free. A parameter must mean something on its own (a stripe count, a canton
seam rule, a border width), and the flag is whatever it implies.

Corollary — **decoupling / reachability is the acceptance test.** Every pattern
you add must be reachable by the gene space *broadly* (many seeds), not only by
one hand-pinned genome. If only your pinned test can produce it, you fitted the
outcome. Verify a mechanism by sampling thousands of random genomes and
confirming the pattern appears at a sane, non-zero rate — then the specific flag
is just one draw.

Corollary — **the banner→flag continuum.** The same genes express on shields,
silk, mon and cloth (keyed on `isFlag`). A new flag mechanism must not break the
shield/badge expressions. Run the audit for both.

---

## 2. The task loop

For each batch of flags:

1. **Classify** — in scope (general pattern) or excluded (bespoke emblem)? See §3.
2. **Reproduce** — add a target to the reachability audit (§5): pin the deciding
   genes, search founder seeds, and write a **predicate** on the expressed
   phenotype that is TRUE only when the structure matches. If a seed satisfies
   it, the flag is reachable — move on.
3. **On a MISS, diagnose the missing mechanism**, not the missing flag. Ask "what
   general capability is absent?" (a compound partition? a bordure on cloth? a
   serrated edge? a diagonal *band* with fimbriation? unequal stripe ratios?).
4. **Build that mechanism** in `emblemGenome.js` / `emblemRender.js` as an
   emergent, corpus-weighted, reachable option. Wire blazon + (if needed)
   `ORD_SLOTS`/proportions so it's one source of truth.
5. **Verify**: the target now passes; the mechanism is broadly reachable (sample
   thousands); `npm test` stays green; render a proof sheet and **look at it**.
6. Commit with a story-telling message. Next batch.

**"Perfectly" means structure, not pixels.** Match the field division, ordinary
geometry, canton/seam behaviour, proportions, tincture logic, fimbriation and
device *arrangement*. It does **not** mean reproducing bespoke central art. If a
flag is "general skeleton + one bespoke emblem", reproduce the skeleton and treat
the emblem as excluded.

---

## 3. Inclusion / exclusion rule

**IN scope — general vexillological patterns:**
- Stripes: any orientation (fess/pale/bend), any count, any proportion
  (incl. the Spanish 1:2:1 and the Canadian 1:2:1 pale), bicolour…quintband.
- Crosses: symmetric (Switzerland/Georgia) and **Nordic/hoist-shifted**
  (Scandinavia), fimbriated or not.
- Saltires, chevrons, piles, hoist triangles, the couched pall (South Africa).
- Cantons (union blocks), star arrangements (rows/ring/arc/constellation/
  satellites), the star-and-crescent, discs, generic geometric charges
  (mullets, roundels, annuli, wheels, crescents, simple crosses).
- Bordures, quarterings, diagonal splits and diagonal **bands**, compound fields
  (a vertical hoist band beside horizontal stripes), serrated/pily edges.

**OUT of scope — bespoke emblems** (the flag reduces to "plain/simple field + a
unique custom picture"): South Korea (taegeuk + trigrams), Kenya (Maasai shield
& spears), Mexico (eagle/snake), Bhutan (dragon), Sri Lanka (lion + bo leaves),
Cambodia (Angkor Wat), Brazil (celestial globe + motto — but its *star field* is
in scope), Nepal (bespoke pennant emblems — but its *double-pennon shape* is a
fair mechanism to add), Albania (double eagle), Saudi Arabia (shahada + sword),
Portugal/Spain/Mexico/Serbia/Montenegro/Ecuador/Bolivia/Egypt (arms & seals &
eagles), Turkmenistan (carpet guls), Cyprus/Kosovo (maps), Argentina/Uruguay
(the Sun of May *face*), Malta, Eritrea, Fiji, San Marino, Andorra, Moldova, etc.

**Borderline — use judgement, reproduce the skeleton + nearest generic charge:**
- India / Niger — the Ashoka chakra / orange disc ≈ a **spoked wheel** (we have
  `cartwheel`/`cogwheel`) and a roundel. Try it; if the wheel reads wrong, that's
  a charge-art note, not a structural gap.
- Croatia — the checkerboard **is** `chequy`; the small shield above is the only
  bespoke part. Reproduce the chequy.
- Pan-Arab / hoist-device flags — reproduce the bands + hoist element; a bespoke
  central emblem (if any) is the excluded part.

When you exclude a flag, log *why* in one line, so the corpus is auditable.

---

## 4. Current vocabulary (accurate snapshot — what already works)

- **Partitions (`FLAG_PARTITIONS`, interleaved so orientation is decoupled from
  gene magnitude):** plain, perFess, tiercedFess, barry (horizontal), perPale,
  tiercedPale, paly (vertical), perBend (diagonal), hoistTriangle, quarterly,
  perSaltire. Horizontal leads ~55%, vertical ~24%, diagonal ~9%, triangle ~8%.
- **Ordinaries (`ORDINARIES`, "none"-weighted 50%):** fess, pale, bend,
  bendSinister, chevron, **cross (renders Nordic/hoist-shifted on cloth)**,
  saltire, pile, pall (couched, with `pallMouth` + fimbriation).
- **Device grammar:** lone central device (full `MOTIFS` pool); a compact device
  or its whole array housed in a **canton** (seams to a stripe boundary); the
  **constellation arrays** rows/ring/arc/constellation/satellites; the
  **inescutcheon** panel (state-arms shield); the **superimposed union** (UK
  class — overlaid cross+saltire, fimbriated); the conjoined **star-and-crescent**.
- **Charges:** geometric (mullets 5/6/8, roundel, annulet, crosses, knots, clan
  symbols, and the **restored wheels** cogwheel/cartwheel/catherinewheel/
  waterwheel/millwheel), celestial (moon/estoile/crescents/starAndCrescent —
  **the rayed suns are removed; use `roundel` for a clean sun-disc**), plus the
  full armorial pools for lone devices.
- **Colour:** dyed-bunting bolts (6: or/argent/gules/azure/vert/sable — **no
  purple**), corpus-weighted palettes; free hue spreads across colours.
- **Treatments:** fimbriation, counterchange across two-region partitions,
  line-styles (wavy/engrailed/embattled/indented — mostly straight on cloth).

---

## 5. The reachability audit (your backbone — recreate it, it isn't committed)

The pattern: pin the deciding genes, brute-force founder seeds, verify the
*expressed phenotype* with a predicate. Every MISS is a capability gap. Skeleton:

```js
// tools/flag-reachability.mjs  (run: node tools/flag-reachability.mjs)
import { writeFileSync } from "node:fs";
import { GENES, foundGenome, expressGenome, crossGenome, blazonGenome } from "../src/sim/emblemGenome.js";
import { drawEmblem } from "../src/sim/emblemRender.js";
const IDX = {}; GENES.forEach((g, i) => IDX[g] = i);
const pin = (g, p) => { for (const [k, v] of Object.entries(p)) g.genes[IDX[k]] = v; return g; };
const CLOTH = { substrate: 0.25, paletteMode: 0.1, iconism: 0.5, border: 0.3, pearl: 0.3, line: 0.05 };

const TARGETS = [
  // [name, pins | null-for-cross-bred, predicate(expressed) => bool]
  ["Horizontal tricolour (Netherlands)", { ...CLOTH, composition: 0.1, partition: 0.35, /*…*/ },
    p => p.field.partition === "tiercedFess" && !p.motif && p.field.ordinary === "none"],
  // …one entry per in-scope flag; grow this to the whole corpus…
];
for (const [name, pins, pred] of TARGETS) {
  let hit = null;
  for (let s = 1; s < 40000 && !hit; s++) { const p = expressGenome(pin(foundGenome(s), pins)); if (pred(p)) hit = s; }
  console.log(hit ? `  OK   ${name} (seed ${hit})` : `  MISS ${name}`);
}
```

Compute pin values from the live arrays so they never go stale:
`(index + 0.5) / POOL.length` for a pool pick; for `FLAG_PARTITIONS` a value `g`
selects `floor(g * len)`. **Import the arrays and compute** — do not hand-guess
(a reorder will silently break hand-typed pins). The predicate is the contract:
write it to be TRUE only for the exact structure, so a MISS is real.

**Render to see it.** `playwright-core` is not installed in a fresh container —
`npm install --no-save playwright-core` (browsers are pre-installed; do **not**
run `playwright install`). Chromium lives under `/opt/pw-browsers/` — find the
`chromium-*/chrome-linux/chrome` binary (the version dir may differ from
`chromium-1194`) and pass it as `executablePath`. Screenshot an SVG:

```js
import pw from "../node_modules/playwright-core/index.js";  // default import; it's CommonJS
const b = await pw.chromium.launch({ executablePath: "/opt/pw-browsers/chromium-XXXX/chrome-linux/chrome" });
const pg = await b.newPage();
await pg.setContent(`<!doctype html><body style="margin:0">${svgString}`);
await (await pg.$("svg")).screenshot({ path: "sheet.png" });  // then Read sheet.png
await b.close();
```

Lay proof sheets as a grid of `drawEmblem` calls, screenshot, and **look** — the
last review found a charge that measured fine but looked like a microbe. Eyes are
part of the acceptance test.

---

## 6. Known gaps to attack first (measured leads, not guesses)

A 3000-flag sample of the Modern preset showed these at **0%**, so they are the
likely first capability gaps:

- **Compound fields** — a vertical hoist band *beside* horizontal stripes
  (Benin, Guinea-Bissau, Madagascar, UAE, Kuwait, Jordan, Palestine, Sudan,
  Western Sahara, Oman) and the mirror. The engine currently picks **one**
  partition; real flags combine a pale/triangle/chevron at the hoist with a
  fess-striped fly. This is probably the single biggest missing mechanism.
- **Bordure on cloth** (`border`/`chief` measured 0% on flags) — Sri Lanka's
  frame, Grenada, Montenegro, the Maldives' plain border. Check whether a bordure
  is even reachable on `isFlag` and add it if not.
- **Serrated / pily edges** — the white dancetty band of Qatar and Bahrain. No
  serrated seam exists yet.
- **Diagonal *bands* with fimbriation** (Tanzania, Trinidad, DR Congo's single
  fimbriated diagonal, Namibia, Brunei's two parallel diagonals, Congo, Solomon
  Is., Seychelles/Marshall Is. radiating bands from the hoist).
- **Nordic-cross proportions & fimbriation variants** — verify Denmark/Sweden/
  Norway/Finland/Iceland/Faroe/Åland all fall out with correct arm ratios and the
  fimbriated (Norway/Iceland) double-outline.
- **Canton + symmetric cross** (Greece, Tonga, Dominican-style quartered crosses),
  **canton + many stripes with exact counts** (USA 13, Liberia 11, Malaysia 14,
  Uruguay 9), and **a device on/beside a canton**.
- **Unequal stripe ratios** (Colombia/ Ecuador 2:1:1, Bahrain proportions,
  Thailand 1:1:2:1:1) — the Spanish-fess splitter exists; generalise it.

Every one of these is a **mechanism** to add, then a whole family becomes
reachable — exactly the rule-2 win. Do not stop at the one flag that revealed it.

---

## 7. Deliverables & guardrails

- A committed reachability corpus (`tools/flag-reachability.mjs`) covering the
  in-scope world flags, **all passing**, with a one-line exclusion note for each
  bespoke flag you skip.
- Engine extensions for each gap — emergent, corpus-weighted, **broadly
  reachable**, blazoned, and reflected in `docs/emblems.md`.
- Proof sheets you have actually looked at.
- `npm test` green (determinism, invariants, tincture checks) **and** the full
  audit green before every push. Rebuild the lab (`node tools/build_lab.mjs`),
  smoke it headlessly (no console errors), and redeploy to the artifact URL.
- **Never hard-code a flag.** No country constants, no "detect this case" branch,
  no clamping to a historical value. If you can name the country in the diff, you
  fitted the outcome — delete it and build the mechanism.
- Keep the banner→flag continuum intact; keep everything reachable by any genome;
  keep the engine pure/deterministic (no `Math.random`, no `Date.now`).

Work in rounds, keep the user posted with before/after proof sheets, and let the
map of the world's flags fall out of the grammar — never the grammar out of the
map.

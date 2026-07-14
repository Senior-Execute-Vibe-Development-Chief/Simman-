// ── THE FLAG REACHABILITY AUDIT ──────────────────────────────────────────────
// Walk the world's national flags. For every flag whose structure is a general
// vexillological pattern, prove the emblem engine's gene space can express it:
// pin the deciding genes, brute-force founder seeds, and verify the EXPRESSED
// phenotype with a predicate that is TRUE only when the structure matches. A
// seed that satisfies the predicate is a witness that the flag is reachable.
// Every MISS is a capability gap — a general mechanism the engine is missing,
// to be BUILT (never a flag hard-coded). Run: `node tools/flag-reachability.mjs`
//
// "Perfectly" here means STRUCTURE, not pixels: field division, ordinary
// geometry, canton/seam behaviour, counts, arrangement — never a specific
// tincture. So the predicates are colour-agnostic; the seed sweep is free to
// find any tincturing that satisfies the structural intent.
//
// Pin values are computed from the LIVE decode pools (`POOLS`), never hand-typed
// — a reorder of any array reshuffles the pins automatically, so a MISS is
// always a real capability gap and never a stale magnitude.
//
// Bespoke-emblem flags (a unique coat of arms / national icon) are OUT of scope
// and listed at the bottom with a one-line reason, so the corpus is auditable.
import { GENES, foundGenome, expressGenome, blazonGenome, POOLS } from "../src/sim/emblemGenome.js";

const IDX = {}; GENES.forEach((g, i) => (IDX[g] = i));
// the gene value that makes pickEnum(v, pool) select `name` (its FIRST slot):
// pickEnum floors v*len, so (i + 0.5)/len lands safely inside slot i.
const slot = (pool, name) => {
  const i = pool.indexOf(name);
  if (i < 0) throw new Error(`"${name}" not in pool [${pool.slice(0, 6)}…]`);
  return (i + 0.5) / pool.length;
};
const SUB_BANNER = slot(POOLS.SUBSTRATES, "banner");
const COMP_HERALDIC = slot(POOLS.FLAG_COMPOSITIONS, "heraldic");
const flagPart = name => slot(POOLS.FLAG_PARTITIONS, name);
const ordinary = name => slot(POOLS.ORDINARIES, name);
const arrayPattern = name => slot(POOLS.ARRAY_PATTERNS, name);
const geomCharge = name => slot(POOLS.MOTIFS.geometric, name);
// the barry/paly stripe COUNT gene: p.field.stripes = 2 + floor(g**1.7 * 11).
// Invert to the MIDPOINT of the gene interval that lands exactly n bands
// (robust to float rounding). Counts above the ceiling clamp to 1.0 and the
// predicate surfaces the ceiling as a MISS — a real finding, not silent rounding.
const stripesGeneFor = n => {
  const lo = Math.pow(Math.max(0, n - 2) / 12, 1 / 1.7);
  const hi = Math.pow(Math.max(0, n - 1) / 12, 1 / 1.7);
  return Math.min(1, (lo + hi) / 2);
};
// a mid, non-aniconic, non-forced-figural iconism keeps composition heraldic
const ICONISM_MID = 0.5;
// pin base: banner + heraldic. Callers override with the structure genes.
const base = () => ({ substrate: SUB_BANNER, composition: COMP_HERALDIC, iconism: ICONISM_MID });
const pin = (g, obj) => { for (const [k, v] of Object.entries(obj)) g.genes[IDX[k]] = v; return g; };

// ── predicate helpers on the expressed phenotype ─────────────────────────────
const bareStriped = (p, part, nBands) => p.isFlag && p.composition === "heraldic"
  && p.field.partition === part && (nBands == null || p.field.stripes === nBands)
  && !p.motif && (!p.field.ordinary || p.field.ordinary === "none") && !p.field.hoist;
const withOrd = (p, ord) => p.isFlag && p.composition === "heraldic" && p.field.ordinary === ord;

// ── THE CORPUS ───────────────────────────────────────────────────────────────
// [name, pins, predicate(expressed) → bool]. Grouped by mechanism family.
const TARGETS = [
  // ── A. STRIPES — any orientation, count, proportion ────────────────────────
  ["Bicolour horizontal (Indonesia/Poland/Ukraine)", { ...base(), partition: flagPart("perFess"), hueC: ordinary("none"), arrange: 0.2 },
    p => bareStriped(p, "perFess", null)],
  ["Bicolour vertical (generic pale bicolour)", { ...base(), partition: flagPart("perPale"), hueC: ordinary("none"), arrange: 0.2 },
    p => bareStriped(p, "perPale", null)],
  ["Horizontal tricolour (Netherlands/Germany)", { ...base(), partition: flagPart("tiercedFess"), hueC: ordinary("none"), arrange: 0.2, stripes: 0.2 },
    p => bareStriped(p, "tiercedFess", null) && p.field.tiercedWide == null],
  ["Vertical tricolour (France/Italy/Belgium)", { ...base(), partition: flagPart("tiercedPale"), hueC: ordinary("none"), arrange: 0.2, stripes: 0.2 },
    p => bareStriped(p, "tiercedPale", null) && p.field.tiercedWide == null],
  ["A-B-A horizontal (Austria/Lebanon skeleton)", { ...base(), partition: flagPart("tiercedFess"), hueC: ordinary("none"), arrange: 0.2, stripes: 0.2, secondary: 0.1 },
    p => bareStriped(p, "tiercedFess", null) && p.field.names[0] === p.field.names[2] && p.field.names[0] !== p.field.names[1]],
  ["Spanish fess 1:2:1 (Spain/Canada skeleton)", { ...base(), partition: flagPart("tiercedFess"), hueC: ordinary("none"), arrange: 0.2, stripes: 0.7 },
    p => bareStriped(p, "tiercedFess", null) && p.field.tiercedWide === 1],
  ["Ratio 2:1:1 top-doubled (Colombia)", { ...base(), partition: flagPart("tiercedFess"), hueC: ordinary("none"), arrange: 0.2, stripes: 0.95 },
    p => bareStriped(p, "tiercedFess", null) && p.field.tiercedWide === 0],
  ["Many equal stripes ×9 (—)", { ...base(), partition: flagPart("barry"), hueC: ordinary("none"), arrange: 0.2, stripes: stripesGeneFor(9) },
    p => bareStriped(p, "barry", 9)],

  // ── B. CROSSES — Nordic, throughout, couped; fimbriated or not ─────────────
  ["Nordic cross plain (Denmark/Sweden/Finland)", { ...base(), partition: flagPart("plain"), hueC: ordinary("cross"), arrange: 0.2, motifCount: 0.2, symmetry: 0.2 },
    p => withOrd(p, "cross") && !p.field.fimbriation && !p.motif && p.field.crossStyle === "nordic"],
  ["Nordic cross fimbriated (Norway/Iceland)", { ...base(), partition: flagPart("plain"), hueC: ordinary("cross"), arrange: 0.2, secondary: 0.9, symmetry: 0.2 },
    p => withOrd(p, "cross") && !!p.field.fimbriation && !p.motif && p.field.crossStyle === "nordic"],
  ["Cross throughout, edge-to-edge (England/Georgia)", { ...base(), partition: flagPart("plain"), hueC: ordinary("cross"), arrange: 0.2, motifCount: 0.2, symmetry: 0.7 },
    p => withOrd(p, "cross") && p.field.crossStyle === "throughout"],
  ["Symmetric couped cross centred (Switzerland)", { ...base(), partition: flagPart("plain"), hueC: ordinary("cross"), arrange: 0.2, motifCount: 0.2, symmetry: 0.9 },
    p => withOrd(p, "cross") && p.field.crossStyle === "couped"],

  // ── C. SALTIRES / CHEVRONS / PILES / TRIANGLES / PALL ──────────────────────
  ["Saltire plain (Scotland/Jamaica skeleton)", { ...base(), partition: flagPart("plain"), hueC: ordinary("saltire"), arrange: 0.2 },
    p => withOrd(p, "saltire") && !p.motif],
  ["Per-saltire field (Jamaica quarters)", { ...base(), partition: flagPart("perSaltire"), hueC: ordinary("none"), arrange: 0.2 },
    p => p.isFlag && p.field.partition === "perSaltire" && !p.motif],
  ["Hoist pile single (Guyana skeleton)", { ...base(), partition: flagPart("plain"), hueC: ordinary("pile"), arrange: 0.2 },
    p => withOrd(p, "pile") && !p.motif],
  ["Couched pall Y (South Africa skeleton)", { ...base(), partition: flagPart("plain"), hueC: ordinary("pall"), arrange: 0.2 },
    p => withOrd(p, "pall") && !p.motif],
  ["Hoist-triangle two-region (Bahamas skeleton)", { ...base(), partition: flagPart("hoistTriangle"), hueC: ordinary("none"), arrange: 0.2 },
    p => p.isFlag && p.field.partition === "hoistTriangle" && !p.motif && !p.field.hoist],

  // ── D. DIAGONAL BANDS with fimbriation ─────────────────────────────────────
  ["Diagonal band single fimbriated (DR Congo/Namibia skeleton)", { ...base(), partition: flagPart("plain"), hueC: ordinary("bend"), arrange: 0.2, secondary: 0.9 },
    p => withOrd(p, "bend") && !!p.field.fimbriation && !p.motif],
  ["Diagonal band on split field (Tanzania/Trinidad)", { ...base(), partition: flagPart("perBend"), hueC: ordinary("bend"), arrange: 0.2, motifCount: 0.9, symmetry: 0.2 },
    p => p.isFlag && p.field.partition === "perBend" && p.field.ordinary === "bend" && !!p.field.fimbriation],
  ["Two parallel diagonals (Brunei/Congo skeleton)", { ...base(), partition: flagPart("plain"), hueC: ordinary("bend"), arrange: 0.2, stripes: 0.7 },
    p => withOrd(p, "bend") && p.field.ordinaryCount === 2],

  // ── E. COMPOUND FIELDS — a hoist element beside independent fly striping ────
  //     (the single biggest measured gap: the engine picks ONE partition)
  ["Vertical hoist band + 2 fly stripes (Benin/Madagascar)", { ...base(), partition: flagPart("perFess"), hueC: ordinary("none"), arrange: 0.2, brandSeed: 0.9 },
    p => p.isFlag && p.field.hoist && p.field.hoist.shape === "pale" && p.field.partition === "perFess" && !p.motif],
  ["Vertical hoist band + 3 fly stripes (UAE/Kuwait skeleton)", { ...base(), partition: flagPart("tiercedFess"), hueC: ordinary("none"), arrange: 0.2, brandSeed: 0.9 },
    p => p.isFlag && p.field.hoist && p.field.hoist.shape === "pale" && p.field.partition === "tiercedFess" && !p.motif],
  ["Hoist triangle + 3 fly stripes (Jordan/Sudan/Palestine)", { ...base(), partition: flagPart("tiercedFess"), hueC: ordinary("none"), arrange: 0.2, brandSeed: 0.5 },
    p => p.isFlag && p.field.hoist && p.field.hoist.shape === "triangle" && p.field.partition === "tiercedFess" && !p.motif],
  ["Hoist triangle + many fly stripes (Cuba/Eritrea skeleton)", { ...base(), partition: flagPart("barry"), hueC: ordinary("none"), arrange: 0.2, brandSeed: 0.5, stripes: stripesGeneFor(5) },
    p => p.isFlag && p.field.hoist && p.field.hoist.shape === "triangle" && p.field.partition === "barry" && p.field.stripes === 5 && !p.motif],

  // ── F. BORDURE — deliberately NOT a flag feature ───────────────────────────
  // A heraldic bordure strokes the field's whole outline, which on cloth reads as
  // exactly the unwanted "line around the edge of the flag". No mainstream national
  // flag carries one; the rare bordered flags (Sri Lanka, Montenegro, Grenada) are
  // bespoke-arms flags, excluded below. So the bordure is now SHIELD/silk-only
  // vocabulary (like the chief) — its reachability is exercised on shields by
  // emblem.test.mjs, not here. No flag target.

  // ── G. SERRATED / PILY edge ────────────────────────────────────────────────
  ["Serrated vertical division (Qatar/Bahrain)", { ...base(), partition: flagPart("perPale"), hueC: ordinary("none"), arrange: 0.2, line: slot(POOLS.LINES, "indented") },
    p => p.isFlag && p.field.partition === "perPale" && p.field.line === "indented" && !p.motif],

  // ── H. CANTONS + arrays, exact stripe counts ───────────────────────────────
  ["Canton + 13 stripes + star array (USA)", { ...base(), partition: flagPart("barry"), hueC: ordinary("none"), arrange: 0.9, motifCat: slot(POOLS.MOTIF_CATS, "geometric"), star: 0.9, scriptDensity: arrayPattern("rows"), stripes: stripesGeneFor(13), motifCount: 0.9 },
    p => p.isFlag && p.field.partition === "barry" && p.field.stripes === 13 && p.motif && p.motif.inCanton && p.motif.array && p.motif.array.pattern === "rows"],
  ["Canton + 11 stripes (Liberia)", { ...base(), partition: flagPart("barry"), hueC: ordinary("none"), arrange: 0.9, motifCat: slot(POOLS.MOTIF_CATS, "geometric"), star: 0.9, stripes: stripesGeneFor(11), motifCount: 0.1 },
    p => p.isFlag && p.field.partition === "barry" && p.field.stripes === 11 && p.ornaments.canton],
  ["Canton + 14 stripes (Malaysia skeleton)", { ...base(), partition: flagPart("barry"), hueC: ordinary("none"), arrange: 0.9, motifCat: slot(POOLS.MOTIF_CATS, "celestial"), star: 0.9, stripes: stripesGeneFor(14), motifCount: 0.1 },
    p => p.isFlag && p.field.partition === "barry" && p.field.stripes === 14 && p.ornaments.canton],
  ["Canton charged with a cross (Greece)", { ...base(), partition: flagPart("barry"), hueC: ordinary("none"), arrange: 0.2, star: 0.9, sunDisc: 0.1, stripes: stripesGeneFor(9) },
    p => p.isFlag && p.field.partition === "barry" && p.field.stripes === 9 && p.ornaments.canton && p.ornaments.cantonKind === "cross"],

  // ── I. STAR ARRANGEMENTS on a plain / simple field ─────────────────────────
  ["Ring of stars (EU/Cape Verde/Venezuela)", { ...base(), partition: flagPart("plain"), hueC: ordinary("none"), arrange: 0.9, motifCat: slot(POOLS.MOTIF_CATS, "geometric"), star: 0.2, scriptDensity: arrayPattern("ring"), motifCount: 0.9 },
    p => p.isFlag && p.motif && p.motif.array && p.motif.array.pattern === "ring" && !p.motif.inCanton],
  ["Arc of stars (Brazil star-field/US-arc skeleton)", { ...base(), partition: flagPart("plain"), hueC: ordinary("none"), arrange: 0.9, motifCat: slot(POOLS.MOTIF_CATS, "geometric"), star: 0.2, scriptDensity: arrayPattern("arc"), motifCount: 0.9 },
    p => p.isFlag && p.motif && p.motif.array && p.motif.array.pattern === "arc"],
  ["Satellites: one great + attendants (China/Turkey skeleton)", { ...base(), partition: flagPart("plain"), hueC: ordinary("none"), arrange: 0.9, motifCat: slot(POOLS.MOTIF_CATS, "geometric"), star: 0.2, scriptDensity: arrayPattern("satellites"), motifCount: 0.9 },
    p => p.isFlag && p.motif && p.motif.array && p.motif.array.pattern === "satellites"],
  ["Star and crescent lone (Turkey/Tunisia/Pakistan skeleton)", { ...base(), partition: flagPart("plain"), hueC: ordinary("none"), arrange: 0.1, star: 0.2, motifCat: slot(POOLS.MOTIF_CATS, "celestial"), motifIdx: 0.95 },
    p => p.isFlag && p.motif && p.motif.id === "starAndCrescent"],
  ["Lone disc clean (Japan/Bangladesh/Palau)", { ...base(), partition: flagPart("plain"), hueC: ordinary("none"), arrange: 0.1, star: 0.2, motifCat: slot(POOLS.MOTIF_CATS, "geometric"), motifIdx: geomCharge("roundel") },
    p => p.isFlag && p.motif && p.motif.id === "roundel" && (p.motif.count || 1) === 1 && !p.motif.inCanton],
  ["Lone star single (Somalia/Vietnam/Morocco skeleton)", { ...base(), partition: flagPart("plain"), hueC: ordinary("none"), arrange: 0.1, star: 0.2, motifCat: slot(POOLS.MOTIF_CATS, "geometric"), motifIdx: geomCharge("mullet") },
    p => p.isFlag && p.motif && /^mullet/.test(p.motif.id) && (p.motif.count || 1) === 1 && !p.motif.inCanton],

  // ── J. BORDERLINE — skeleton + nearest generic charge (§3) ─────────────────
  ["Spoked wheel on tricolour (India skeleton)", { ...base(), partition: flagPart("tiercedFess"), hueC: ordinary("none"), arrange: 0.7, star: 0.2, motifCat: slot(POOLS.MOTIF_CATS, "geometric"), motifIdx: geomCharge("cartwheel") },
    p => p.isFlag && p.field.partition === "tiercedFess" && p.motif && (p.motif.count || 1) === 1 && !p.motif.inCanton],

  // ── K. PROPORTIONS — the aspect-ratio outliers ─────────────────────────────
  ["Square flag 1:1 (Switzerland/Vatican)", { ...base(), substrate: 0.332, partition: flagPart("plain"), hueC: ordinary("cross"), arrange: 0.2, symmetry: 0.9 },
    p => p.isFlag && p.substrate === "banner" && p.flagRatio >= 0.95],
  ["Very long flag 11:28 (Qatar)", { ...base(), substrate: 0.172, partition: flagPart("perPale"), hueC: ordinary("none"), arrange: 0.2, line: slot(POOLS.LINES, "indented") },
    p => p.isFlag && p.substrate === "banner" && p.flagRatio <= 0.45],

  // ── L. NEW MECHANISMS this round ───────────────────────────────────────────
  ["Fimbriated stripe seams (Gambia/Uzbekistan)", { ...base(), partition: flagPart("barry"), hueC: ordinary("none"), arrange: 0.2, stripes: stripesGeneFor(5), motifCount: 0.9 },
    p => p.isFlag && p.field.partition === "barry" && p.field.seamFimbriation],
  ["Quintband 1:1:2:1:1 mirror (Thailand/Costa Rica)", { ...base(), partition: flagPart("quintFess"), hueC: ordinary("none"), arrange: 0.2 },
    p => p.isFlag && p.field.partition === "quintFess" && p.field.stripeWeights && !p.motif],
  ["Radiating bands from the hoist (Seychelles)", { ...base(), partition: flagPart("rays"), hueC: ordinary("none"), arrange: 0.2 },
    p => p.isFlag && p.field.partition === "rays" && !p.motif],
  ["Cross + saltire superimposed (Union Jack skeleton)", { ...base(), partition: flagPart("plain"), hueC: ordinary("cross"), arrange: 0.2, symmetry: 0.7, motifCount: 0.9, brandSeed: 0.9 },
    p => p.isFlag && p.field.ordinary === "cross" && p.field.saltireOverlay],
];

// ── run ──────────────────────────────────────────────────────────────────────
const SEEDS = 60000;
let ok = 0, miss = 0;
const misses = [];
for (const [name, pins, pred] of TARGETS) {
  let hit = null, err = null;
  for (let s = 1; s < SEEDS && hit == null; s++) {
    try {
      const p = expressGenome(pin(foundGenome(s), pins));
      if (pred(p)) hit = s;
    } catch (e) { err = e; break; }
  }
  if (hit != null) { ok++; console.log(`  OK    ${name}  (seed ${hit})`); }
  else { miss++; misses.push(name); console.log(`  MISS  ${name}${err ? "  [err: " + err.message + "]" : ""}`); }
}
console.log(`\n[flag-reachability] ${ok} OK / ${miss} MISS across ${TARGETS.length} in-scope targets`);
if (misses.length) {
  console.log(`\nGAPS (each a general mechanism to BUILD, never a flag to hard-code):`);
  for (const m of misses) console.log(`  · ${m}`);
}

// ── DEFERRED — a real in-scope gap whose GENERAL mechanism is identified but not
// yet built. Recorded honestly (Rule 2: surface the missing SYSTEM, never bolt
// on a narrow fitted partition to reproduce one flag). Does not fail the audit.
const DEFERRED = [
  ["Quintband 1:1:2:1:1 mirror (Thailand, Costa Rica)",
    "needs an N-band SYMMETRIC TIERCED (a tierced generalised to 5/7 bands, mirror " +
    "palette A-B-C-B-A, centre optionally doubled) — the natural generalisation of the " +
    "Spanish-fess splitter we already have for 3 bands. A narrow one-flag partition " +
    "would be a fitted outcome; the general N-tierced is the right build."],
];
console.log(`\nDEFERRED (general mechanism identified, not yet built — ${DEFERRED.length}):`);
for (const [c, why] of DEFERRED) console.log(`  · ${c}\n      ${why}`);

// ── EXCLUDED — bespoke emblems (out of scope), logged for an auditable corpus ─
const EXCLUDED = [
  ["South Korea", "taegeuk + trigrams — bespoke central icon"],
  ["Kenya", "Maasai shield & spears — bespoke central icon"],
  ["Mexico / Ecuador / Bolivia", "eagle-and-serpent / state seal — bespoke arms"],
  ["Bhutan", "dragon — bespoke central icon"],
  ["Sri Lanka", "lion + bo leaves — bespoke icon (and its bordure: flags carry no bordure, it's shield-only)"],
  ["Cambodia", "Angkor Wat — bespoke central icon"],
  ["Brazil", "celestial globe + motto — bespoke (its star FIELD is in scope, tested above)"],
  ["Albania / Serbia / Montenegro", "double eagle / arms — bespoke (borders/fields in scope)"],
  ["Saudi Arabia", "shahada + sword — bespoke inscription"],
  ["Portugal / Spain / Egypt", "arms / eagle — bespoke (their striped fields are in scope)"],
  ["Turkmenistan", "carpet guls — bespoke ornament"],
  ["Cyprus / Kosovo", "map silhouette — bespoke"],
  ["Argentina / Uruguay", "Sun of May FACE — bespoke (the disc/stripes are in scope)"],
  ["Nepal", "double-pennon shape + bespoke emblems — pennon shape a fair future mechanism"],
  ["Malta / Eritrea / Fiji / San Marino / Andorra / Moldova", "bespoke arms/emblems"],
];
console.log(`\nEXCLUDED (bespoke emblems, ${EXCLUDED.length} entries):`);
for (const [c, why] of EXCLUDED) console.log(`  – ${c}: ${why}`);

process.exit(miss ? 1 : 0);

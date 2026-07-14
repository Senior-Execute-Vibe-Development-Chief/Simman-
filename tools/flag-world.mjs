// ── THE WHOLE-WORLD FLAG SWEEP ───────────────────────────────────────────────
// The mechanism audit (flag-reachability.mjs) proves each STRUCTURE is
// reachable. This walks the world's sovereign flags ONE BY ONE (every UN member
// + a few observers) and assigns each a structure tag, so coverage is measured
// against the whole corpus, not a representative sample. The per-flag tags are a
// STRUCTURAL first-pass reading — a few sit at the borderline between "general
// skeleton" and "bespoke emblem" and are judgement calls; the value is the
// exhaustive enumeration and the remaining-gap roadmap. A tag's reachability is
// verified once (a witness founder seed) and attributed to every flag that
// wears it. Bespoke-emblem flags are tagged `excl` with the emblem named; a
// structure the engine cannot yet express is tagged `gap:<reason>` — a real
// remaining capability gap. Run: `node tools/flag-world.mjs`
import { GENES, foundGenome, expressGenome, POOLS } from "../src/sim/emblemGenome.js";

const IDX = {}; GENES.forEach((g, i) => (IDX[g] = i));
const slot = (pool, name) => (pool.indexOf(name) + 0.5) / pool.length;
const pin = (g, obj) => { for (const [k, v] of Object.entries(obj)) g.genes[IDX[k]] = v; return g; };
const B = () => ({ substrate: slot(POOLS.SUBSTRATES, "banner"), composition: slot(POOLS.FLAG_COMPOSITIONS, "heraldic"), iconism: 0.5 });
const fp = n => slot(POOLS.FLAG_PARTITIONS, n);
const od = n => slot(POOLS.ORDINARIES, n);
const ap = n => slot(POOLS.ARRAY_PATTERNS, n);
const gc = n => slot(POOLS.MOTIFS.geometric, n);
const cc = n => slot(POOLS.MOTIF_CATS, n);

// ── reachable STRUCTURE tags: pins + a structural predicate ───────────────────
// (colour-agnostic — structure, not pixels). Verified once each, then shared.
const S = {
  htri:      [{ ...B(), partition: fp("tiercedFess"), hueC: od("none"), arrange: 0.2, stripes: 0.2 }, p => p.field.partition === "tiercedFess" && !p.motif && !p.field.hoist],
  vtri:      [{ ...B(), partition: fp("tiercedPale"), hueC: od("none"), arrange: 0.2, stripes: 0.2 }, p => p.field.partition === "tiercedPale" && !p.motif && !p.field.hoist],
  aba:       [{ ...B(), partition: fp("tiercedFess"), hueC: od("none"), arrange: 0.2, stripes: 0.2, secondary: 0.1 }, p => p.field.partition === "tiercedFess" && p.field.names[0] === p.field.names[2] && p.field.names[0] !== p.field.names[1]],
  vaba:      [{ ...B(), partition: fp("tiercedPale"), hueC: od("none"), arrange: 0.2, stripes: 0.2, secondary: 0.1 }, p => p.field.partition === "tiercedPale" && p.field.names[0] === p.field.names[2] && p.field.names[0] !== p.field.names[1]],
  hbi:       [{ ...B(), partition: fp("perFess"), hueC: od("none"), arrange: 0.2 }, p => p.field.partition === "perFess" && !p.motif && !p.field.hoist],
  vbi:       [{ ...B(), partition: fp("perPale"), hueC: od("none"), arrange: 0.2 }, p => p.field.partition === "perPale" && !p.motif && !p.field.hoist],
  spanish:   [{ ...B(), partition: fp("tiercedFess"), hueC: od("none"), arrange: 0.2, stripes: 0.7 }, p => p.field.partition === "tiercedFess" && p.field.tiercedWide === 1],
  r211:      [{ ...B(), partition: fp("tiercedFess"), hueC: od("none"), arrange: 0.2, stripes: 0.95 }, p => p.field.partition === "tiercedFess" && p.field.tiercedWide === 0],
  barry:     [{ ...B(), partition: fp("barry"), hueC: od("none"), arrange: 0.2, stripes: 0.6 }, p => p.field.partition === "barry" && !p.motif && !p.field.hoist],
  nordic:    [{ ...B(), partition: fp("plain"), hueC: od("cross"), arrange: 0.2, secondary: 0.1, symmetry: 0.2 }, p => p.field.ordinary === "cross" && p.field.crossStyle === "nordic" && !p.field.fimbriation && !p.motif],
  nordicFimb:[{ ...B(), partition: fp("plain"), hueC: od("cross"), arrange: 0.2, secondary: 0.9, symmetry: 0.2 }, p => p.field.ordinary === "cross" && !!p.field.fimbriation && !p.motif],
  symcross:  [{ ...B(), partition: fp("plain"), hueC: od("cross"), arrange: 0.2, symmetry: 0.9 }, p => p.field.ordinary === "cross" && p.field.crossStyle === "symmetric"],
  saltire:   [{ ...B(), partition: fp("plain"), hueC: od("saltire"), arrange: 0.2 }, p => p.field.ordinary === "saltire" && !p.motif],
  persaltire:[{ ...B(), partition: fp("perSaltire"), hueC: od("none"), arrange: 0.2 }, p => p.field.partition === "perSaltire" && !p.motif],
  pile:      [{ ...B(), partition: fp("plain"), hueC: od("pile"), arrange: 0.2 }, p => p.field.ordinary === "pile" && !p.motif],
  pall:      [{ ...B(), partition: fp("plain"), hueC: od("pall"), arrange: 0.2, secondary: 0.9 }, p => p.field.ordinary === "pall" && !!p.field.fimbriation],
  htriangle: [{ ...B(), partition: fp("hoistTriangle"), hueC: od("none"), arrange: 0.2 }, p => p.field.partition === "hoistTriangle" && !p.field.hoist],
  fessFimb:  [{ ...B(), partition: fp("plain"), hueC: od("fess"), arrange: 0.2, secondary: 0.9 }, p => p.field.ordinary === "fess" && !!p.field.fimbriation],
  bendFimb:  [{ ...B(), partition: fp("plain"), hueC: od("bend"), arrange: 0.2, secondary: 0.9 }, p => p.field.ordinary === "bend" && !!p.field.fimbriation && !p.motif],
  cpale2:    [{ ...B(), partition: fp("perFess"), hueC: od("none"), arrange: 0.2 }, p => p.field.hoist?.shape === "pale" && p.field.partition === "perFess"],
  cpale3:    [{ ...B(), partition: fp("tiercedFess"), hueC: od("none"), arrange: 0.2 }, p => p.field.hoist?.shape === "pale" && p.field.partition === "tiercedFess"],
  ctri3:     [{ ...B(), partition: fp("tiercedFess"), hueC: od("none"), arrange: 0.2 }, p => p.field.hoist?.shape === "triangle" && p.field.partition === "tiercedFess"],
  ctriN:     [{ ...B(), partition: fp("barry"), hueC: od("none"), arrange: 0.2, stripes: 0.6 }, p => p.field.hoist?.shape === "triangle" && p.field.partition === "barry"],
  serrated:  [{ ...B(), partition: fp("perPale"), hueC: od("none"), arrange: 0.2, line: slot(POOLS.LINES, "indented") }, p => p.field.partition === "perPale" && p.field.line === "indented"],
  bordure:   [{ ...B(), partition: fp("plain"), hueC: od("none"), arrange: 0.1, border: 0.9, star: 0.2 }, p => p.field.bordure],
  cantonStars:[{ ...B(), partition: fp("barry"), hueC: od("none"), arrange: 0.9, motifCat: cc("geometric"), star: 0.9, scriptDensity: ap("rows"), stripes: 0.6, motifCount: 0.9 }, p => p.field.partition === "barry" && p.motif?.inCanton && p.motif?.array],
  cantonCross:[{ ...B(), partition: fp("barry"), hueC: od("none"), arrange: 0.2, star: 0.9, sunDisc: 0.1, crescent: 0.2, stripes: 0.6 }, p => p.field.partition === "barry" && p.ornaments.canton && p.ornaments.cantonKind === "cross"],
  ring:      [{ ...B(), partition: fp("plain"), hueC: od("none"), arrange: 0.9, motifCat: cc("geometric"), star: 0.2, scriptDensity: ap("ring"), motifCount: 0.9, motifIdx: gc("mullet") }, p => p.motif?.array?.pattern === "ring"],
  arc:       [{ ...B(), partition: fp("plain"), hueC: od("none"), arrange: 0.9, motifCat: cc("geometric"), star: 0.2, scriptDensity: ap("arc"), motifCount: 0.9, motifIdx: gc("mullet") }, p => p.motif?.array?.pattern === "arc"],
  satellites:[{ ...B(), partition: fp("plain"), hueC: od("none"), arrange: 0.9, motifCat: cc("geometric"), star: 0.2, scriptDensity: ap("satellites"), motifCount: 0.9, motifIdx: gc("mullet") }, p => p.motif?.array?.pattern === "satellites"],
  starcresc: [{ ...B(), partition: fp("plain"), hueC: od("none"), arrange: 0.1, star: 0.2, motifCat: cc("celestial"), motifIdx: 0.95 }, p => p.motif?.id === "starAndCrescent"],
  disc:      [{ ...B(), partition: fp("plain"), hueC: od("none"), arrange: 0.1, star: 0.2, motifCat: cc("geometric"), motifIdx: gc("roundel") }, p => p.motif?.id === "roundel" && (p.motif.count || 1) === 1],
  star:      [{ ...B(), partition: fp("plain"), hueC: od("none"), arrange: 0.1, star: 0.2, motifCat: cc("geometric"), motifIdx: gc("mullet") }, p => /^mullet/.test(p.motif?.id || "") && (p.motif.count || 1) === 1],
  // "dev" = a lone GENERAL charge (star/disc/crescent) on a partitioned or plain
  // field — many national flags are a tricolour or bicolour + one generic device.
  dev:       [{ ...B(), partition: fp("tiercedPale"), hueC: od("none"), arrange: 0.7, star: 0.2, motifCat: cc("geometric"), motifIdx: gc("mullet") }, p => p.motif && (p.motif.count || 1) === 1 && !p.motif.inCanton],
  // mechanisms built this round
  xcross:    [{ ...B(), partition: fp("plain"), hueC: od("cross"), arrange: 0.2, symmetry: 0.7 }, p => p.field.crossStyle === "throughout"],
  square:    [{ ...B(), substrate: 0.332, partition: fp("plain"), hueC: od("cross"), arrange: 0.2, symmetry: 0.9 }, p => p.isFlag && p.flagRatio >= 0.95],
  quintband: [{ ...B(), partition: fp("quintFess"), hueC: od("none"), arrange: 0.2 }, p => p.field.partition === "quintFess" && p.field.stripeWeights],
  rays:      [{ ...B(), partition: fp("rays"), hueC: od("none"), arrange: 0.2, stripes: 0.6 }, p => p.field.partition === "rays" && p.field.rays],
  seams:     [{ ...B(), partition: fp("barry"), hueC: od("none"), arrange: 0.2, stripes: 0.5, motifCount: 0.9 }, p => p.field.partition === "barry" && p.field.seamFimbriation],
  union:     [{ ...B(), partition: fp("plain"), hueC: od("cross"), arrange: 0.2, symmetry: 0.7, brandSeed: 0.9 }, p => p.field.ordinary === "cross" && p.field.saltireOverlay],
};
const REACHABLE_TAGS = new Set(Object.keys(S));

// ── THE WORLD — every UN member (+ observers/notable), one by one ─────────────
// [country, tag]. Tags starting "excl:" are bespoke-emblem (out of scope, emblem
// named); "gap:" is a structure not yet expressible; anything else is a
// reachable structure tag from S above. Where a general skeleton is reachable
// but a bespoke central emblem is the defining feature, it is excl (with note).
const WORLD = [
  // ── Africa (54) ──
  ["Algeria", "starcresc"], ["Angola", "excl:machete-gear-star emblem"], ["Benin", "cpale2"],
  ["Botswana", "fessFimb"], ["Burkina Faso", "dev"], ["Burundi", "excl:saltire+3-star disc emblem"],
  ["Cabo Verde", "ring"], ["Cameroon", "dev"], ["Central African Rep.", "gap:centred pale over h-stripes + hoist star"],
  ["Chad", "vtri"], ["Comoros", "ctriN"], ["Congo (Rep.)", "bendFimb"], ["DR Congo", "bendFimb"],
  ["Djibouti", "htriangle"], ["Egypt", "excl:eagle of Saladin"], ["Equatorial Guinea", "excl:national arms"],
  ["Eritrea", "excl:wreath emblem"], ["Eswatini", "excl:shield-and-spears emblem"], ["Ethiopia", "excl:pentagram-disc emblem"],
  ["Gabon", "htri"], ["Gambia", "seams"], ["Ghana", "dev"],
  ["Guinea", "vtri"], ["Guinea-Bissau", "cpale2"], ["Ivory Coast", "vtri"], ["Kenya", "excl:Maasai shield & spears"],
  ["Lesotho", "excl:mokorotlo hat"], ["Liberia", "cantonStars"], ["Libya", "starcresc"], ["Madagascar", "cpale2"],
  ["Malawi", "excl:rising-sun emblem"], ["Mali", "vtri"], ["Mauritania", "starcresc"], ["Mauritius", "barry"],
  ["Morocco", "dev"], ["Mozambique", "excl:rifle-hoe-book emblem"], ["Namibia", "bendFimb"], ["Niger", "dev"],
  ["Nigeria", "vaba"], ["Rwanda", "excl:sun emblem"], ["Sao Tome & Principe", "ctri3"], ["Senegal", "dev"],
  ["Seychelles", "rays"], ["Sierra Leone", "htri"], ["Somalia", "star"],
  ["South Africa", "pall"], ["South Sudan", "ctri3"], ["Sudan", "ctri3"], ["Tanzania", "bendFimb"],
  ["Togo", "cantonStars"], ["Tunisia", "starcresc"], ["Uganda", "excl:grey crowned crane"],
  ["Zambia", "excl:eagle + fly-corner bars"], ["Zimbabwe", "excl:Zimbabwe bird emblem"],

  // ── Americas (35) ──
  ["Antigua & Barbuda", "gap:rising-sun rays over a chevron-rayed field"], ["Argentina", "excl:Sun of May face"],
  ["Bahamas", "htriangle"], ["Barbados", "excl:trident head"], ["Belize", "excl:coat of arms"],
  ["Bolivia", "excl:state coat of arms"], ["Brazil", "excl:celestial globe & motto"], ["Canada", "excl:maple leaf (on a vertical Spanish fess)"],
  ["Chile", "cantonStars"], ["Colombia", "r211"], ["Costa Rica", "quintband"],
  ["Cuba", "ctriN"], ["Dominica", "excl:sisserou-parrot emblem"], ["Dominican Republic", "cantonCross"],
  ["Ecuador", "excl:coat of arms"], ["El Salvador", "excl:coat of arms"], ["Grenada", "bordure"],
  ["Guatemala", "excl:coat of arms"], ["Guyana", "pile"], ["Haiti", "excl:coat of arms"],
  ["Honduras", "star"], ["Jamaica", "persaltire"], ["Mexico", "excl:eagle & serpent"],
  ["Nicaragua", "excl:triangle coat of arms"], ["Panama", "gap:quartered field with a star in two quarters"],
  ["Paraguay", "excl:emblem (obverse/reverse)"], ["Peru", "vaba"], ["Saint Kitts & Nevis", "gap:diagonal band with two stars"],
  ["Saint Lucia", "excl:central arrowhead device"], ["Saint Vincent", "gap:three green lozenges (V)"],
  ["Suriname", "star"], ["Trinidad & Tobago", "bendFimb"], ["United States", "cantonStars"],
  ["Uruguay", "excl:Sun of May face"], ["Venezuela", "arc"],

  // ── Asia (47) ──
  ["Afghanistan", "excl:mosque emblem"], ["Armenia", "htri"], ["Azerbaijan", "starcresc"],
  ["Bahrain", "serrated"], ["Bangladesh", "disc"], ["Bhutan", "excl:dragon"], ["Brunei", "gap:two parallel diagonals + arms"],
  ["Cambodia", "excl:Angkor Wat"], ["China", "satellites"], ["Cyprus", "excl:island map"],
  ["Georgia", "symcross"], ["India", "dev"], ["Indonesia", "hbi"], ["Iran", "excl:emblem + kufic script"],
  ["Iraq", "excl:takbir inscription"], ["Israel", "gap:Star of David between two fesses"], ["Japan", "disc"],
  ["Jordan", "ctri3"], ["Kazakhstan", "excl:sun/eagle + hoist ornament"], ["Kuwait", "ctri3"],
  ["Kyrgyzstan", "excl:sun with tunduk"], ["Laos", "disc"], ["Lebanon", "excl:cedar tree"],
  ["Malaysia", "cantonStars"], ["Maldives", "gap:plain field, bordered rectangle + crescent"], ["Mongolia", "excl:soyombo symbol"],
  ["Myanmar", "star"], ["Nepal", "excl:double-pennon + celestial emblems"], ["North Korea", "gap:bordered central band + disc-star"],
  ["Oman", "excl:national emblem (khanjar)"], ["Pakistan", "starcresc"], ["Palestine", "ctri3"],
  ["Philippines", "gap:hoist triangle with sun & stars + two stripes"], ["Qatar", "serrated"],
  ["Saudi Arabia", "excl:shahada & sword"], ["Singapore", "gap:crescent + five stars in a canton band"],
  ["South Korea", "excl:taegeuk & trigrams"], ["Sri Lanka", "excl:lion & bo-leaves"], ["Syria", "star"],
  ["Taiwan", "excl:sun emblem in canton"], ["Tajikistan", "excl:crown & stars emblem"], ["Thailand", "quintband"],
  ["Timor-Leste", "gap:two overlaid hoist triangles + star"], ["Turkey", "starcresc"], ["Turkmenistan", "excl:carpet guls"],
  ["UAE", "cpale3"], ["Uzbekistan", "seams"], ["Vietnam", "star"], ["Yemen", "htri"],

  // ── Europe (44) ──
  ["Albania", "excl:double-headed eagle"], ["Andorra", "excl:coat of arms"], ["Austria", "aba"],
  ["Belarus", "excl:hoist ornament pattern"], ["Belgium", "vtri"], ["Bosnia & Herzegovina", "gap:triangle with a diagonal star arc"],
  ["Bulgaria", "htri"], ["Croatia", "excl:chequy shield emblem"], ["Czechia", "ctri3"], ["Denmark", "nordic"],
  ["Estonia", "htri"], ["Finland", "nordic"], ["France", "vtri"], ["Germany", "htri"], ["Greece", "cantonCross"],
  ["Hungary", "htri"], ["Iceland", "nordicFimb"], ["Ireland", "vtri"], ["Italy", "vtri"], ["Kosovo", "excl:map + stars"],
  ["Latvia", "gap:A-B-A with a thin (½) middle band"], ["Liechtenstein", "excl:princely crown"], ["Lithuania", "htri"],
  ["Luxembourg", "htri"], ["Malta", "excl:George Cross"], ["Moldova", "excl:coat of arms"], ["Monaco", "hbi"],
  ["Montenegro", "bordure"], ["Netherlands", "htri"], ["North Macedonia", "gap:sun with rays to the edges"],
  ["Norway", "nordicFimb"], ["Poland", "hbi"], ["Portugal", "excl:coat of arms"], ["Romania", "vtri"],
  ["Russia", "htri"], ["San Marino", "excl:coat of arms"], ["Serbia", "excl:coat of arms"], ["Slovakia", "excl:coat of arms"],
  ["Slovenia", "excl:coat of arms"], ["Spain", "spanish"], ["Sweden", "nordic"], ["Switzerland", "symcross"],
  ["Ukraine", "hbi"], ["United Kingdom", "union"],
  ["Vatican City", "excl:crossed keys & tiara"],

  // ── Oceania (14) ──
  ["Australia", "excl:Union Jack canton + Commonwealth star"], ["Fiji", "excl:Union Jack + shield"],
  ["Kiribati", "gap:heraldic wavy field with sun & bird"], ["Marshall Islands", "rays"],
  ["Micronesia", "ring"], ["Nauru", "gap:thin bend with a rayed star below"], ["New Zealand", "excl:Union Jack + Southern Cross"],
  ["Palau", "disc"], ["Papua New Guinea", "excl:bird-of-paradise + Southern Cross"], ["Samoa", "cantonStars"],
  ["Solomon Islands", "gap:diagonal bend dividing a field + star canton"], ["Tonga", "cantonCross"],
  ["Tuvalu", "excl:Union Jack + nine stars (map)"], ["Vanuatu", "excl:pall with boar-tusk emblem"],
];

// ── run ──────────────────────────────────────────────────────────────────────
const SEEDS = 60000;
const reach = {};
for (const tag of REACHABLE_TAGS) {
  const [pins, pred] = S[tag];
  let hit = null;
  for (let s = 1; s < SEEDS && hit == null; s++) if (pred(expressGenome(pin(foundGenome(s), pins)))) hit = s;
  reach[tag] = hit;
}
let ok = 0, excl = 0; const gaps = new Map(), unreachTag = [];
for (const [country, tag] of WORLD) {
  if (tag.startsWith("excl:")) { excl++; continue; }
  if (tag.startsWith("gap:")) { const r = tag.slice(4); if (!gaps.has(r)) gaps.set(r, []); gaps.get(r).push(country); continue; }
  if (REACHABLE_TAGS.has(tag)) { if (reach[tag] != null) ok++; else unreachTag.push(`${country} [${tag}]`); }
  else unreachTag.push(`${country} [UNKNOWN TAG ${tag}]`);
}
const gapCount = [...gaps.values()].reduce((s, a) => s + a.length, 0);
console.log(`\n════ WHOLE-WORLD FLAG SWEEP — ${WORLD.length} sovereign flags, one by one ════\n`);
console.log(`  REACHABLE (structure expressible):     ${ok}`);
console.log(`  EXCLUDED  (bespoke central emblem):    ${excl}`);
console.log(`  GAP       (structure not yet built):   ${gapCount}`);
console.log(`  ${ok}/${ok + gapCount} in-scope structures reachable (${(100 * ok / (ok + gapCount)).toFixed(0)}%); ${(100 * (ok + excl) / WORLD.length).toFixed(0)}% of all flags reachable-or-excluded\n`);
if (unreachTag.length) { console.log(`  !! tag verified UNREACHABLE (regression):`); for (const u of unreachTag) console.log(`     - ${u}`); }
console.log(`REMAINING STRUCTURAL GAPS (each a general mechanism to build next):`);
for (const [reason, countries] of [...gaps.entries()].sort((a, b) => b[1].length - a[1].length))
  console.log(`  · ${reason}\n      — ${countries.join(", ")}`);

// ── Tech discovery layer ─────────────────────────────────────────────
// A Civ-like tech TREE derived from the continuous knowledge tracks
// (settlement.js). There is no separate research economy: a settlement
// discovers a tech the instant (a) all of its PREREQUISITE techs are already
// discovered and (b) the knowledge thresholds are met. The prerequisites make
// the tree a real DAG with Civ-style dependency chains (Iron Working needs
// Bronze Working; Gunpowder needs the Blast Furnace and Alchemy; Steam Power
// needs Clockwork and the Scientific Method).
//
// It needs no resource lookup because the resource-gated tracks already encode
// their inputs in their LEVEL: metallurgy is hard-gated by ore (copper → bronze
// → iron → steel access), navigation by water, mobility by horses. So the six
// knowledge values alone place a culture on the tree — a landlocked, ore-poor
// people simply never lights up the naval or metal branches, exactly as
// geography dictated in history (Diamond). Pure legibility: the tree changes
// nothing in the sim, it only VISUALISES the knowledge a settlement holds.
//
// The eras span the reachable arc — from knapped flint to the early-modern /
// industrial frontier the knowledge model tops out at (organization ≈ science
// & institutions, metallurgy ≈ industrial materials, construction ≈
// engineering). The "Modern" column is the aspirational horizon only the very
// best, ore-and-coal-rich, highly organised civilisations ever touch.

export const ERAS = ["Stone Age", "Bronze Age", "Classical", "Medieval", "Renaissance", "Industrial", "Modern"];

// Each tech: id, era (column), name (kept short for the node — detail lives in
// desc), prereq techs, req(k) → are the knowledge thresholds met?, gate
// (dominant track + threshold) for the "researching" progress hint, and desc
// (the historical flavour, shown in the tooltip).
export const TECHS = [
  // ── Stone Age ───────────────────────────────────────────────────────
  { id:"stone_tools",   era:0, name:"Stone Tools",     prereq:[],                       req:()=>true,                                       gate:null,                  desc:"Knapped flint and bone — the first toolkit." },
  { id:"fire",          era:0, name:"Fire & Cooking",  prereq:["stone_tools"],          req:k=>k.construction>=0.06,                        gate:["construction",0.06], desc:"Taming fire for warmth, cooking and protection." },
  { id:"hunting",       era:0, name:"Hunting",         prereq:["stone_tools"],          req:k=>k.construction>=0.14,                        gate:["construction",0.14], desc:"Spears, traps and the coordinated big-game hunt." },
  { id:"farming",       era:0, name:"Farming",         prereq:["stone_tools"],          req:k=>k.agriculture>=0.15,                         gate:["agriculture",0.15],  desc:"Sowing and reaping the first domesticated cereals." },
  { id:"pottery",       era:0, name:"Pottery",         prereq:["fire"],                 req:k=>k.construction>=0.18,                        gate:["construction",0.18], desc:"Fired clay vessels store grain, water and oil." },
  { id:"animal_husb",   era:0, name:"Animal Husbandry",prereq:["farming"],              req:k=>k.agriculture>=0.30,                         gate:["agriculture",0.30],  desc:"Herding and breeding sheep, goats and cattle." },
  { id:"mysticism",     era:0, name:"Mysticism",       prereq:["stone_tools"],          req:k=>k.organization>=0.18,                        gate:["organization",0.18], desc:"Burial rites, totems and the first priesthood." },
  { id:"the_wheel",     era:0, name:"The Wheel",       prereq:["pottery"],              req:k=>k.construction>=0.32||k.mobility>=0.22,      gate:["construction",0.32], desc:"The wheel and axle — carts and the potter's wheel." },
  { id:"archery",       era:0, name:"Archery",         prereq:["hunting"],              req:k=>k.construction>=0.24,                        gate:["construction",0.24], desc:"The bow — the first true ranged weapon." },

  // ── Bronze Age ──────────────────────────────────────────────────────
  { id:"mining",        era:1, name:"Mining",          prereq:["stone_tools"],          req:k=>k.construction>=0.36,                        gate:["construction",0.36], desc:"Shafts and galleries win ore and stone from the earth." },
  { id:"masonry",       era:1, name:"Masonry",         prereq:["pottery"],              req:k=>k.construction>=0.42,                        gate:["construction",0.42], desc:"Dressed stone — city walls, tombs and temples." },
  { id:"copper_working",era:1, name:"Copper Working",  prereq:["mining"],               req:k=>k.metallurgy>=0.18,                          gate:["metallurgy",0.18],   desc:"Smelted copper — knives, ornaments, the first metal." },
  { id:"sailing",       era:1, name:"Sailing",         prereq:["pottery"],              req:k=>k.navigation>=0.30,                          gate:["navigation",0.30],   desc:"Sails and oars carry boats along the coast." },
  { id:"writing",       era:1, name:"Writing",         prereq:["mysticism"],            req:k=>k.organization>=0.35,                        gate:["organization",0.35], desc:"Cuneiform and hieroglyphs record law, tax and myth." },
  { id:"irrigation",    era:1, name:"Irrigation",      prereq:["farming","pottery"],    req:k=>k.agriculture>=0.48&&k.construction>=0.30,   gate:["agriculture",0.48],  desc:"Canals turn dry river valleys into breadbaskets." },
  { id:"calendar",      era:1, name:"Calendar",        prereq:["writing","mysticism"],  req:k=>k.organization>=0.40,                        gate:["organization",0.40], desc:"Tracking the seasons and stars across the year." },
  { id:"bronze_working",era:1, name:"Bronze Working",  prereq:["copper_working"],       req:k=>k.metallurgy>=0.40,                          gate:["metallurgy",0.40],   desc:"Copper alloyed with tin — proper weapons and ploughs." },
  { id:"the_plough",    era:1, name:"The Plough",      prereq:["animal_husb","copper_working"], req:k=>k.agriculture>=0.55,                 gate:["agriculture",0.55],  desc:"Ox-drawn ploughs break the heavy soils." },
  { id:"monuments",     era:1, name:"Monuments",       prereq:["masonry"],              req:k=>k.construction>=0.60,                        gate:["construction",0.60], desc:"Pyramids, ziggurats and the great god-houses." },
  { id:"chariots",      era:1, name:"Chariots",        prereq:["bronze_working","the_wheel"], req:k=>k.mobility>=0.45,                      gate:["mobility",0.45],     desc:"Horse-drawn war chariots rule the bronze battlefield." },
  { id:"galleys",       era:1, name:"Galleys",         prereq:["sailing","masonry"],    req:k=>k.navigation>=0.58&&k.construction>=0.40,    gate:["navigation",0.58],   desc:"Planked, oared ships carry cargo and marines." },
  { id:"bronze_arms",   era:1, name:"Bronze Arms",     prereq:["bronze_working","archery"], req:k=>k.metallurgy>=0.50,                       gate:["metallurgy",0.50],   desc:"Bronze spears, swords, helms and the phalanx." },

  // ── Classical (Iron-Age antiquity) ──────────────────────────────────
  { id:"iron_working",  era:2, name:"Iron Working",    prereq:["bronze_working"],       req:k=>k.metallurgy>=0.70,                          gate:["metallurgy",0.70],   desc:"Smelted iron — cheap, hard tools and mass armies." },
  { id:"currency",      era:2, name:"Currency",        prereq:["writing"],              req:k=>k.organization>=0.45,                        gate:["organization",0.45], desc:"Stamped coin replaces barter and frees trade." },
  { id:"mathematics",   era:2, name:"Mathematics",     prereq:["writing","calendar"],   req:k=>k.organization>=0.50,                        gate:["organization",0.50], desc:"Geometry, arithmetic and the abacus." },
  { id:"code_of_laws",  era:2, name:"Code of Laws",    prereq:["writing"],              req:k=>k.organization>=0.55,                        gate:["organization",0.55], desc:"Written codes from Hammurabi to the Twelve Tables." },
  { id:"the_arch",      era:2, name:"The Arch",        prereq:["masonry","mathematics"],req:k=>k.construction>=0.55,                        gate:["construction",0.55], desc:"Arches, vaults and the load-bearing keystone." },
  { id:"astronomy",     era:2, name:"Astronomy",       prereq:["mathematics","calendar"],req:k=>k.organization>=0.58,                       gate:["organization",0.58], desc:"Charting the planets and predicting eclipses." },
  { id:"roads",         era:2, name:"Roads",           prereq:["the_wheel","masonry"],  req:k=>k.construction>=0.60&&k.organization>=0.45,  gate:["construction",0.60], desc:"Paved military roads bind the provinces." },
  { id:"philosophy",    era:2, name:"Philosophy",      prereq:["mathematics","mysticism"], req:k=>k.organization>=0.60,                     gate:["organization",0.60], desc:"Reasoned enquiry into nature, ethics and the state." },
  { id:"aqueducts",     era:2, name:"Aqueducts",       prereq:["the_arch"],             req:k=>k.construction>=0.65,                        gate:["construction",0.65], desc:"Aqueducts and sewers water the great cities." },
  { id:"iron_legions",  era:2, name:"Iron Legions",    prereq:["iron_working","code_of_laws"], req:k=>k.metallurgy>=0.78&&k.organization>=0.55, gate:["metallurgy",0.78], desc:"Drilled, iron-armed professional infantry." },
  { id:"cavalry",       era:2, name:"Cavalry",         prereq:["iron_working","chariots"], req:k=>k.mobility>=0.70,                          gate:["mobility",0.70],     desc:"Mounted lancers and horse-archers." },
  { id:"cartography",   era:2, name:"Cartography",     prereq:["galleys","mathematics"],req:k=>k.navigation>=0.68,                          gate:["navigation",0.68],   desc:"Charts and portolans map coast and current." },
  { id:"crop_rotation", era:2, name:"Crop Rotation",   prereq:["irrigation","the_plough"], req:k=>k.agriculture>=0.72,                       gate:["agriculture",0.72],  desc:"Fallow fields and legumes restore the soil." },

  // ── Medieval ────────────────────────────────────────────────────────
  { id:"feudalism",     era:3, name:"Feudalism",       prereq:["code_of_laws"],         req:k=>k.organization>=0.62,                        gate:["organization",0.62], desc:"Lords, vassals, fiefs and the manor economy." },
  { id:"paper",         era:3, name:"Paper",           prereq:["writing"],              req:k=>k.organization>=0.64,                        gate:["organization",0.64], desc:"Cheap rag paper replaces parchment and clay." },
  { id:"alchemy",       era:3, name:"Alchemy",         prereq:["philosophy","pottery"], req:k=>k.organization>=0.66,                        gate:["organization",0.66], desc:"Proto-chemistry: acids, distillation, the elements." },
  { id:"guilds",        era:3, name:"Guilds",          prereq:["currency","masonry"],   req:k=>k.organization>=0.66,                        gate:["organization",0.66], desc:"Craft guilds master and monopolise the trades." },
  { id:"university",    era:3, name:"University",       prereq:["philosophy","paper"],   req:k=>k.organization>=0.68,                        gate:["organization",0.68], desc:"Scholars gather; knowledge gathers and compounds." },
  { id:"machinery",     era:3, name:"Machinery",       prereq:["the_wheel","the_arch"], req:k=>k.construction>=0.70,                        gate:["construction",0.70], desc:"Watermills, windmills and geared machines harness power." },
  { id:"banking",       era:3, name:"Banking",         prereq:["currency","mathematics","guilds"], req:k=>k.organization>=0.70,            gate:["organization",0.70], desc:"Bills of exchange, credit and the first banks." },
  { id:"blast_furnace", era:3, name:"Blast Furnace",   prereq:["iron_working","machinery"], req:k=>k.metallurgy>=0.80,                       gate:["metallurgy",0.80],   desc:"Bellows-fed furnaces pour molten cast iron." },
  { id:"heavy_plough",  era:3, name:"Heavy Plough",    prereq:["crop_rotation"],        req:k=>k.agriculture>=0.80,                         gate:["agriculture",0.80],  desc:"Horse collar and mouldboard feed the booming towns." },
  { id:"the_compass",   era:3, name:"Compass",         prereq:["cartography","astronomy"], req:k=>k.navigation>=0.74,                        gate:["navigation",0.74],   desc:"The lodestone needle frees ships from the shore." },
  { id:"chivalry",      era:3, name:"Chivalry",        prereq:["cavalry","iron_legions"], req:k=>k.mobility>=0.80&&k.metallurgy>=0.74,      gate:["mobility",0.80],     desc:"Stirrup, lance and plate — the armoured knight." },
  { id:"cathedrals",    era:3, name:"Cathedrals",      prereq:["aqueducts","guilds"],   req:k=>k.construction>=0.78,                        gate:["construction",0.78], desc:"Flying buttresses raise the soaring cathedrals." },
  { id:"gunpowder",     era:3, name:"Gunpowder",       prereq:["blast_furnace","alchemy"], req:k=>k.metallurgy>=0.82&&k.organization>=0.58, gate:["metallurgy",0.82],   desc:"Black powder ends the age of the castle wall." },
  { id:"caravels",      era:3, name:"Caravels",        prereq:["the_compass"],          req:k=>k.navigation>=0.80,                          gate:["navigation",0.80],   desc:"Lateen-rigged caravels brave the open ocean." },

  // ── Renaissance ─────────────────────────────────────────────────────
  { id:"printing",      era:4, name:"Printing Press",  prereq:["paper","university"],   req:k=>k.organization>=0.74,                        gate:["organization",0.74], desc:"Movable type floods the world with cheap books." },
  { id:"optics",        era:4, name:"Optics",          prereq:["university","alchemy"], req:k=>k.organization>=0.76,                        gate:["organization",0.76], desc:"Ground lenses — spectacles, microscope, telescope." },
  { id:"firearms",      era:4, name:"Firearms",        prereq:["gunpowder"],            req:k=>k.metallurgy>=0.85,                          gate:["metallurgy",0.85],   desc:"Matchlock muskets and siege cannon." },
  { id:"clockwork",     era:4, name:"Clockwork",       prereq:["machinery","optics"],   req:k=>k.construction>=0.82,                        gate:["construction",0.82], desc:"Escapements and precision gears keep the hour." },
  { id:"architecture",  era:4, name:"Architecture",    prereq:["cathedrals","mathematics"], req:k=>k.construction>=0.84,                     gate:["construction",0.84], desc:"Domes, perspective and the grand Renaissance plan." },
  { id:"economics",     era:4, name:"Economics",       prereq:["banking","printing"],   req:k=>k.organization>=0.80,                        gate:["organization",0.80], desc:"Mercantile empires and the wealth of nations." },
  { id:"heliocentrism", era:4, name:"Heliocentrism",   prereq:["printing","astronomy","optics"], req:k=>k.organization>=0.81,              gate:["organization",0.81], desc:"The Earth and planets circle the Sun." },
  { id:"ocean_nav",     era:4, name:"Ocean Sailing",   prereq:["caravels"],             req:k=>k.navigation>=0.88,                          gate:["navigation",0.88],   desc:"Carracks and galleons link the continents." },
  { id:"foundry",       era:4, name:"Foundry",         prereq:["blast_furnace","firearms"], req:k=>k.metallurgy>=0.88,                       gate:["metallurgy",0.88],   desc:"Bored, cast and standardised cannon and tools." },
  { id:"musketry",      era:4, name:"Musketry",        prereq:["firearms","code_of_laws"], req:k=>k.metallurgy>=0.86&&k.organization>=0.72, gate:["metallurgy",0.86],   desc:"Volley drill and the standing professional army." },
  { id:"sci_method",    era:4, name:"Scientific Method",prereq:["heliocentrism","clockwork"], req:k=>k.organization>=0.85,                   gate:["organization",0.85], desc:"Hypothesis, experiment and reproducible proof." },
  { id:"chemistry",     era:4, name:"Chemistry",       prereq:["alchemy","sci_method"], req:k=>k.organization>=0.86,                        gate:["organization",0.86], desc:"Elements, gases and reactions supplant alchemy." },

  // ── Industrial ──────────────────────────────────────────────────────
  { id:"steel",         era:5, name:"Steel",           prereq:["foundry"],              req:k=>k.metallurgy>=0.92,                          gate:["metallurgy",0.92],   desc:"Cheap mass steel — rails, girders and dreadnoughts." },
  { id:"steam_power",   era:5, name:"Steam Power",     prereq:["clockwork","sci_method","blast_furnace"], req:k=>k.construction>=0.86&&k.metallurgy>=0.85, gate:["construction",0.86], desc:"Steam engines pump, spin and haul tirelessly." },
  { id:"the_factory",   era:5, name:"The Factory",     prereq:["steam_power","machinery"], req:k=>k.construction>=0.90,                      gate:["construction",0.90], desc:"Interchangeable parts and the assembly line." },
  { id:"industrialism", era:5, name:"Industrialism",   prereq:["economics","steam_power"], req:k=>k.organization>=0.88,                     gate:["organization",0.88], desc:"Capital, coal and wage labour remake society." },
  { id:"germ_theory",   era:5, name:"Germ Theory",     prereq:["chemistry","university"], req:k=>k.organization>=0.86&&k.construction>=0.80, gate:["organization",0.86], desc:"Germs, vaccines and clean water beat the plagues." },
  { id:"railroad",      era:5, name:"Railroad",        prereq:["steam_power","steel"],  req:k=>k.metallurgy>=0.92&&k.construction>=0.88,    gate:["metallurgy",0.92],   desc:"Iron rails bind the nation and its markets." },
  { id:"steamship",     era:5, name:"Steamship",       prereq:["steam_power","ocean_nav"], req:k=>k.navigation>=0.92,                       gate:["navigation",0.92],   desc:"Iron-hulled steamers free the sea from the wind." },
  { id:"rifling",       era:5, name:"Rifled Guns",     prereq:["steel","musketry"],     req:k=>k.metallurgy>=0.94,                          gate:["metallurgy",0.94],   desc:"Rifled steel artillery and breech-loading arms." },
  { id:"fertilizers",   era:5, name:"Fertilizers",     prereq:["crop_rotation","chemistry","the_factory"], req:k=>k.agriculture>=0.92,      gate:["agriculture",0.92],  desc:"Synthetic fertiliser and machines — the farm revolution." },
  { id:"democracy",     era:5, name:"Democracy",       prereq:["sci_method","printing","economics"], req:k=>k.organization>=0.90,            gate:["organization",0.90], desc:"Rights, constitutions, parties and the ballot." },
  { id:"telegraph",     era:5, name:"Telegraph",       prereq:["the_factory","sci_method"], req:k=>k.organization>=0.92&&k.metallurgy>=0.90, gate:["organization",0.92], desc:"Messages race the continent down copper wires." },

  // ── Modern (the aspirational frontier — only the very best reach it) ──
  { id:"electricity",   era:6, name:"Electricity",     prereq:["telegraph","industrialism"], req:k=>k.metallurgy>=0.96&&k.organization>=0.92, gate:["metallurgy",0.96],  desc:"Dynamos, motors and the electric light." },
  { id:"combustion",    era:6, name:"Combustion",      prereq:["the_factory","rifling"],req:k=>k.metallurgy>=0.97&&k.construction>=0.94,    gate:["metallurgy",0.97],   desc:"Oil-fired internal-combustion engines." },
  { id:"medicine",      era:6, name:"Medicine",        prereq:["germ_theory","electricity"], req:k=>k.organization>=0.95,                    gate:["organization",0.95], desc:"Antibiotics, anaesthesia and modern surgery." },
  { id:"mass_prod",     era:6, name:"Mass Production",  prereq:["the_factory","electricity"], req:k=>k.construction>=0.95&&k.organization>=0.94, gate:["construction",0.95], desc:"Electrified assembly lines for the millions." },
  { id:"flight",        era:6, name:"Flight",          prereq:["combustion"],           req:k=>k.construction>=0.96&&k.metallurgy>=0.97,    gate:["construction",0.96], desc:"Heavier-than-air machines take the sky." },
  { id:"computing",     era:6, name:"Computing",       prereq:["electricity","mass_prod"], req:k=>k.organization>=0.97&&k.metallurgy>=0.97, gate:["organization",0.97], desc:"Logic engines begin to automate thought itself." },
];

export const TECH_IDX = {}; TECHS.forEach((t, i) => { TECH_IDX[t.id] = i; });

// Are all of a tech's prerequisites present in the discovered set?
const prereqsMet = (t, have) => { for (const p of t.prereq) if (!have[TECH_IDX[p]]) return false; return true; };

// Discovered-tech membership (a Uint8Array: have[i] = 1 if tech i is known) +
// the culture's era (highest reached) + count. A FIXED-POINT pass resolves the
// DAG regardless of authoring order: keep sweeping until no new tech unlocks
// (prereqs met AND knowledge thresholds met). Called only for the inspected
// settlement at render time, never in the sim loop, so the O(n²) worst case is
// irrelevant. No 31-tech ceiling (it is a byte array, not a 32-bit mask).
export function techState(k) {
  const n = TECHS.length;
  const have = new Uint8Array(n);
  if (!k) return { have, era: 0, count: 0 };
  let changed = true, guard = 0;
  while (changed && guard++ < n) {
    changed = false;
    for (let i = 0; i < n; i++) {
      if (have[i]) continue;
      const t = TECHS[i];
      if (prereqsMet(t, have) && t.req(k)) { have[i] = 1; changed = true; }
    }
  }
  let era = 0, count = 0;
  for (let i = 0; i < n; i++) if (have[i]) { count++; if (TECHS[i].era > era) era = TECHS[i].era; }
  return { have, era, count };
}

// Per-tech display state for the tree: "have" (discovered), "next" (all prereqs
// met, only the knowledge threshold holding it back — with progress 0..1), or
// "locked" (a prerequisite tech is still missing).
export function techNodeState(k, have, t) {
  if (have[TECH_IDX[t.id]]) return { state: "have", prog: 1 };
  if (!prereqsMet(t, have)) return { state: "locked", prog: 0 };
  const prog = t.gate ? Math.min(1, (k[t.gate[0]] || 0) / t.gate[1]) : 0;
  return { state: "next", prog };
}

// The next unlockable techs (prereqs met, knowledge in progress), closest first.
export function nextTechs(k, have, n = 3) {
  if (!k) return [];
  const out = [];
  for (let i = 0; i < TECHS.length; i++) {
    if (have[i]) continue;
    const t = TECHS[i]; if (!t.gate || !prereqsMet(t, have)) continue;
    out.push({ id: t.id, name: t.name, era: t.era, prog: Math.min(1, (k[t.gate[0]] || 0) / t.gate[1]), track: t.gate[0] });
  }
  out.sort((a, b) => b.prog - a.prog);
  return out.slice(0, n);
}

// ── Layout ───────────────────────────────────────────────────────────
// Shared by the React overlay and the offline render script so they can never
// drift. Longest-path LAYERING (Civ-style tiers): a tech's COLUMN = 1 + the
// deepest of its prerequisites' columns (roots at 0). This guarantees every
// prerequisite sits in an EARLIER column and the BINDING one in the column
// immediately to the left, so dependency edges run left-to-right and stay
// short, and ~78 techs spread thinly across many slim tiers instead of a few
// tall era stacks. Era is kept only as the node COLOUR — eras interleave across
// the depth tiers, exactly as a Civ tree does. Within a column, techs are
// ordered by the mean ROW of their already-placed prerequisites (a one-sided
// barycentric sort) to keep the edges from crossing.
export function techLayout(opts = {}) {
  const COLW = opts.COLW ?? 228, ROWH = opts.ROWH ?? 84, NW = opts.NW ?? 138, NH = opts.NH ?? 32;
  const MX = opts.MX ?? 20, TOP = opts.TOP ?? 52, CAP = opts.CAP ?? 5;
  // 1. Longest-path depth: dep = 1 + the deepest prerequisite's depth.
  const layer = {};
  const depthOf = t => {
    if (layer[t.id] !== undefined) return layer[t.id];
    layer[t.id] = 0;                                   // guard against cycles
    let m = 0;
    for (const p of t.prereq) { const pt = TECHS[TECH_IDX[p]]; if (pt) m = Math.max(m, depthOf(pt) + 1); }
    return layer[t.id] = m;
  };
  TECHS.forEach(depthOf);
  const nLayers = Math.max(0, ...Object.values(layer)) + 1;
  const byDepth = Array.from({ length: nLayers }, () => []);
  TECHS.forEach(t => byDepth[layer[t.id]].push(t));
  // 2. Place depth by depth; SPLIT any tier wider than CAP into adjacent
  // sub-columns so no column exceeds CAP rows (Civ-style thin tiers). Within a
  // tier, order by the mean row of already-placed prerequisites (one-sided
  // barycentric sort) before slicing, so edges stay short and uncrossed. Two
  // sub-columns of the same depth never have an edge between them (a tech is
  // always strictly deeper than its prerequisites), so splitting is safe.
  const pos = {}, colX = {};
  let gcol = 0;
  for (let d = 0; d < nLayers; d++) {
    const techs = byDepth[d];
    if (!techs.length) continue;
    const keyOf = t => { let s = 0, m = 0; for (const p of t.prereq) { const pp = pos[p]; if (pp) { s += pp.y; m++; } } return m ? s / m : TOP + TECH_IDX[t.id] * 0.001; };
    const sorted = techs.map((t, ri) => ({ t, ri, key: keyOf(t) })).sort((a, b) => a.key - b.key || a.ri - b.ri).map(o => o.t);
    const k = Math.ceil(sorted.length / CAP);
    const base = Math.floor(sorted.length / k), extra = sorted.length % k;
    let idx = 0;
    for (let s = 0; s < k; s++) {
      const size = base + (s < extra ? 1 : 0);
      sorted.slice(idx, idx + size).forEach((t, ri) => { pos[t.id] = { x: MX + gcol * COLW, y: TOP + ri * ROWH }; colX[t.id] = gcol; });
      idx += size; gcol++;
    }
  }
  const nCols = gcol;
  let maxRows = 1;
  for (const id in pos) { const r = (pos[id].y - TOP) / ROWH + 1; if (r > maxRows) maxRows = r; }
  return { pos, layer, colX, nCols, COLW, ROWH, NW, NH, MX, TOP, maxRows, W: MX * 2 + nCols * COLW, H: TOP + maxRows * ROWH + 10 };
}

// Orthogonal (right-angle) SVG path for a prerequisite link a → b, shared by the
// overlay and the render script. Adjacent-column links drop straight through the
// single gutter between the two columns. A LONG link (target ≥ 2 columns away)
// must not run along a node's centre row — that is what makes every node it
// passes look connected — so it rises into a ROW-GUTTER lane (between node rows)
// and runs there, where the intervening columns are empty. `stag` (0..4) offsets
// the risers and the lane a few px so parallel links separate instead of merging
// into one fat line.
export function techEdgePath(a, b, dims, stag = 0) {
  const { NW, NH, COLW, ROWH } = dims;
  const ax = a.x + NW, ay = a.y + NH / 2;
  const bx = b.x, by = b.y + NH / 2;
  const gap = COLW - NW;
  const sgx = (stag - 2) * 7;                                  // −14..+14 px lateral spread
  if (bx - ax <= gap * 1.4) {                                  // adjacent columns: one clean drop
    const cx = (ax + bx) / 2 + sgx;
    return `M${ax},${ay} H${cx} V${by} H${bx}`;
  }
  const sx = ax + gap * 0.30 + sgx;                            // riser just right of the source
  const tx = bx - gap * 0.30 + sgx;                            // riser just left of the target
  const dir = by >= ay ? 1 : -1;
  const laneY = by - dir * (ROWH * 0.5 - 6) + (stag - 2) * 6;  // row-gutter lane beside the target
  return `M${ax},${ay} H${sx} V${laneY} H${tx} V${by} H${bx}`;
}

// ── Tech discovery layer ─────────────────────────────────────────────
// A Civ-like tech TREE derived from the continuous knowledge tracks
// (settlement.js). There is no separate research economy: a settlement
// discovers a tech the instant (a) all of its PREREQUISITE techs are already
// discovered and (b) the knowledge thresholds are met. The prerequisites make
// the tree a real DAG with Civ-style dependency chains (Iron Working needs
// Bronze Working; Gunpowder needs the Blast Furnace and Alchemy; Steam Power
// needs Clockwork and the Scientific Method).
//
// It needs no resource lookup because the knowledge values already encode their
// inputs in their LEVEL: navigation by water, mobility by horses (no sea/horses,
// the technique never even diffuses in). Metallurgy is the one split case — its
// KNOWLEDGE spreads by contact (a connected ore-poor people DOES light up the
// metal branch here: it knows how iron is worked), but the metal BONUSES are
// computed from a capability-capped view of metallurgy (settlement.js practisedK
// → only the ore you can reach lets you forge it). So the tree is pure
// legibility — it VISUALISES what a culture KNOWS — while geography still decides
// what it can DO with that knowledge, exactly as history dictated (Diamond).
//
// The eras span the reachable arc — from knapped flint to the early-modern /
// industrial frontier the knowledge model tops out at (organization ≈ science
// & institutions, metallurgy ≈ industrial materials, construction ≈
// engineering). The "Modern" column is the aspirational horizon only the very
// best, ore-and-coal-rich, highly organised civilisations ever touch.

import { T } from "./tuning.js";

export const ERAS = ["Stone Age", "Bronze Age", "Classical", "Medieval", "Renaissance", "Industrial", "Modern"];

// The records bar (T.STATE_RECORDS, 2026-08-19): the organization level at
// which a court can ADMINISTRATE — keep rolls, levy tax, bind a territory.
// One definition, two uses: this is literally the Writing tech's own gate
// ("record law, tax and myth"), read from the tree so the state's birth bar
// and the tech that represents it can never drift apart. History's anchor:
// Uruk's state and its clay tax tablets arrive together — the state IS an
// administrative machine, so no records, no nation. Below it the world still
// fills with villages, temple towns and tribal chiefdoms; wars of state,
// borders and treasuries wait for the tablet.
export const RECORDS_ORG = 0.35;   // == TECHS writing gate (asserted below)

// The EFFECTIVE state-founding bar: the legacy statecraft floor
// (T.ORG_STATE_MIN, def 0.15 — proto-chiefdom level, why stone-age nations
// used to fire) raised to the records bar when T.STATE_RECORDS is on. All
// de-novo founding doors read THIS; adoption/joining keeps the legacy floor.
export const stateOrgBar = () => Math.max(T.ORG_STATE_MIN || 0, T.STATE_RECORDS ? RECORDS_ORG : 0);

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
  { id:"fertilizers",   era:5, name:"Fertilizers",     prereq:["crop_rotation","chemistry","the_factory"], req:k=>k.agriculture>=0.88,      gate:["agriculture",0.88],  desc:"Synthetic fertiliser and machines — the farm revolution." },
  { id:"democracy",     era:5, name:"Democracy",       prereq:["sci_method","printing","economics"], req:k=>k.organization>=0.90,            gate:["organization",0.90], desc:"Rights, constitutions, parties and the ballot." },
  { id:"telegraph",     era:5, name:"Telegraph",       prereq:["the_factory","sci_method"], req:k=>k.organization>=0.92&&k.metallurgy>=0.90, gate:["organization",0.92], desc:"Messages race the continent down copper wires." },
  { id:"selective_breed",era:5,name:"Selective Breeding",prereq:["crop_rotation","sci_method"], req:k=>k.organization>=0.84,                 gate:["organization",0.84], desc:"Bakewell's stockbreeding and scientific husbandry lift yields." },
  { id:"trawling",      era:5, name:"Industrial Fishing",prereq:["steamship","the_factory"], req:k=>k.navigation>=0.93,                       gate:["navigation",0.93],   desc:"Steam trawlers and canneries strip the open fisheries." },

  // ── Modern (the aspirational frontier — only the very best reach it) ──
  { id:"electricity",   era:6, name:"Electricity",     prereq:["telegraph","industrialism"], req:k=>k.metallurgy>=0.96&&k.organization>=0.92, gate:["metallurgy",0.96],  desc:"Dynamos, motors and the electric light." },
  { id:"combustion",    era:6, name:"Combustion",      prereq:["the_factory","rifling"],req:k=>k.metallurgy>=0.97&&k.construction>=0.94,    gate:["metallurgy",0.97],   desc:"Oil-fired internal-combustion engines." },
  { id:"medicine",      era:6, name:"Medicine",        prereq:["germ_theory","electricity"], req:k=>k.organization>=0.95,                    gate:["organization",0.95], desc:"Antibiotics, anaesthesia and modern surgery." },
  { id:"mass_prod",     era:6, name:"Mass Production",  prereq:["the_factory","electricity"], req:k=>k.construction>=0.95&&k.organization>=0.94, gate:["construction",0.95], desc:"Electrified assembly lines for the millions." },
  { id:"flight",        era:6, name:"Flight",          prereq:["combustion"],           req:k=>k.construction>=0.96&&k.metallurgy>=0.97,    gate:["construction",0.96], desc:"Heavier-than-air machines take the sky." },
  { id:"computing",     era:6, name:"Computing",       prereq:["electricity","mass_prod"], req:k=>k.organization>=0.97&&k.metallurgy>=0.97, gate:["organization",0.97], desc:"Logic engines begin to automate thought itself." },
  { id:"mechanized_farm",era:6,name:"Mechanized Farms", prereq:["fertilizers","combustion"], req:k=>k.metallurgy>=0.94,                       gate:["metallurgy",0.94],   desc:"Tractors and combines replace the ox — the diesel harvest." },
  { id:"green_revolution",era:6,name:"Green Revolution", prereq:["fertilizers","chemistry"], req:k=>k.organization>=0.94,                     gate:["organization",0.94], desc:"High-yield cultivars and agrochemistry — Borlaug's harvest." },
];

export const TECH_IDX = {}; TECHS.forEach((t, i) => { TECH_IDX[t.id] = i; });

// One-definition invariant: the state-birth records bar IS the writing gate.
{ const w = TECHS.find((t) => t.id === "writing"); if (!w || w.gate[1] !== RECORDS_ORG) throw new Error("RECORDS_ORG drifted from the writing tech's gate — they are one definition"); }

// Are all of a tech's prerequisites present in the discovered set?
const prereqsMet = (t, have) => { for (const p of t.prereq) if (!have[TECH_IDX[p]]) return false; return true; };

// Discovered-tech membership (a Uint8Array: have[i] = 1 if tech i is known) +
// the culture's era (highest reached) + count. A FIXED-POINT pass resolves the
// DAG regardless of authoring order: keep sweeping until no new tech unlocks
// (prereqs met AND knowledge thresholds met). NOTE this IS on a sim hot path —
// techEffects() calls it for every settlement's KNOW_INTERVAL refresh
// (settlement.js updateKnowledge), which is why techEffects memoises below;
// the O(n²) worst case only bites on a cache miss.
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

// ── Per-tech bespoke EFFECTS ──────────────────────────────────────────
// The concrete bonus/ability each discovery grants. techEffects() sums these
// across a culture's DISCOVERED techs into channel totals, and the sim reads
// those instead of the raw continuous tracks — so the tree is what gives the
// abilities (Civ-style) while the continuous tracks are demoted to the research
// that EARNS the techs. Channels (per-tech contributions, summed):
//   farm     +land-food multiplier        military +combat multiplier
//   fish     +fishery yield               reach    +admin/territory reach
//   build    +urban density level         cohesion +loyalty / stability
//   trade    +trade & export              defense  +city defence (walls)
//   wealth   +specie / treasury           seaSpeed/seaRange  naval
//   abilities (booleans): embark · ocean · colonize · walls · market · credit
// Calibrated (see techEffects) so that with TECH_EFFECTS = 0 the OLD continuous
// formulas are reproduced exactly, and = 1 is fully tech-driven.
export const TECH_FX = {
  // — subsistence / agriculture —  (farm sums ≈ 1.18, ≈ old ag·1.2; the late
  //  techs stay strong because the food HIERARCHY feeds big cities from
  //  high-agriculture hinterlands — robbing them starves the cities. Partial
  //  credit (techEffects) supplies the early-game on-ramp.)
  hunting:      { farm:0.03 },
  farming:      { farm:0.15 },
  animal_husb:  { farm:0.07, military:0.03 },
  the_plough:   { farm:0.11 },
  irrigation:   { farm:0.18 },
  calendar:     { farm:0.04 },
  crop_rotation:{ farm:0.19 },
  heavy_plough: { farm:0.12 },
  fertilizers:  { farm:0.70 },
  chemistry:    { farm:0.20, military:0.04 },
  // modern agricultural revolution — gated on INDUSTRY/SCIENCE, not raw farming
  // knowledge, so industrialisation is the historical escape from the ~+91%
  // pre-modern (Malthusian) ceiling. A steel-and-science civ pulls into abundance:
  // these lift farmYield from ~1.9 (medieval) to ~5 (post-green-revolution). The
  // modern population BOOM proper is carried by _eraProd (the emergent productivity
  // index, settlement.js), not by inflating these per-acre yields — keeping farmYield
  // modest here keeps urban density (which keys off farmYield) historically sane.
  selective_breed:  { farm:0.35 },
  mechanized_farm:  { farm:0.60, build:0.02 },
  green_revolution: { farm:1.30 },
  // — naval / water —  (fish sums ≈ 1.58: sailing+galleys+ocean_nav+steamship+trawling —
  //  trawling was added after the old "≈1.18 ≈ nav·1.2" calibration note)
  // Sailing carries a seaRange share: the SAIL is what turns a paddled
  // strait-hop into coastal shipping (sea.js gates lane projection on the
  // embark ability and starts the range ladder here — before this tech a
  // port reaches only SEA_RANGE_BASE).
  sailing:      { fish:0.32, seaSpeed:0.20, seaRange:0.12, embark:true },
  galleys:      { fish:0.32, seaRange:0.30, military:0.05 },
  cartography:  { seaRange:0.18, seaSpeed:0.10 },
  the_compass:  { seaRange:0.24, seaSpeed:0.16, logistics:0.04 },
  caravels:     { seaRange:0.38, seaSpeed:0.20, ocean:true, logistics:0.08 },
  ocean_nav:    { fish:0.24, seaRange:0.46, seaSpeed:0.24, colonize:true },
  steamship:    { fish:0.30, seaSpeed:0.60, seaRange:0.50, logistics:0.18 },
  railroad:     { logistics:0.35, trade:0.12, military:0.04 },   // iron rails — the continental land-empire enabler (was missing any effect)
  trawling:     { fish:0.40 },
  optics:       { seaRange:0.10 },
  astronomy:    { seaRange:0.10, farm:0.02 },
  // — building / urban —  (build sums ≈ 1.10; front-loaded so density tracks
  //  construction through the mid-game instead of all arriving late)
  pottery:      { build:0.10 },
  masonry:      { build:0.14, defense:0.25, walls:true },
  monuments:    { build:0.06, cohesion:0.05 },
  the_arch:     { build:0.10, defense:0.10 },
  aqueducts:    { build:0.14, defense:0.04, health:0.25 },   // sewers + clean water: the first real blow against crowd disease
  germ_theory:  { health:0.45 },   // vaccines, antisepsis, clean-water science
  medicine:     { health:0.30 },   // antibiotics, anaesthesia, modern surgery
  machinery:    { build:0.06, trade:0.10 },
  cathedrals:   { build:0.08, cohesion:0.06, defense:0.10 },
  architecture: { build:0.08, defense:0.10 },
  clockwork:    { build:0.02, trade:0.05 },
  steam_power:  { build:0.03, trade:0.15, military:0.04 },
  the_factory:  { build:0.06, trade:0.20, wealth:0.10 },
  mass_prod:    { build:0.04, trade:0.18 },
  electricity:  { build:0.03, wealth:0.15 },
  // — metal / military —  (two regimes, keyed by T.MIL_REVOLUTIONS:)
  //  LEGACY (lever 0): the additive `military` weights below sum ≈ 2.35 ≈ old
  //  met·1.5+mob·0.8, front-loaded onto the era-defining weapons.
  //  REVOLUTIONS (lever 1, default): each armament REVOLUTION is a
  //  MULTIPLICATIVE step (`milMul`, compounding across revolutions), because a
  //  new weapon SYSTEM obsoletes the old one wholesale — its characteristic
  //  battlefield dominance at equal numbers is a RATIO, not a bonus — while
  //  incremental techs inside a paradigm (archery, the chariot/cavalry arm,
  //  roads, drill) still ADD. A carrier tech's legacy `military` weight is
  //  EXCLUDED from the additive base on the revolutions path (replaced by its
  //  factor); each revolution's total multiple is the product of its carriers,
  //  split by their share of delivering the system:
  //    bronze arms      copper 1.10 · bronze_working 1.25 · bronze_arms 1.10  ≈ 1.51
  //    mass iron        iron_working 1.40 · iron_legions 1.15                 ≈ 1.61
  //    pike-and-shot    gunpowder 1.25 · firearms 1.30 · musketry 1.35 · foundry 1.10 ≈ 2.41
  //    rifled-industrial steel 1.20 · rifling 1.40                            ≈ 1.68
  //    mechanization    combustion 1.25 · flight 1.12                         ≈ 1.40
  //  (docs/user-report-diagnosis-2026-07-28.md §12: the additive arc capped the
  //  whole Stone→Modern span at 3.35× and priced the entire gunpowder
  //  revolution below copper working — muskets needed more MEN, not better
  //  guns. Diffusion is untouched: neighbours still converge, so these ratios
  //  express only in the window a gap exists and across capability gates.)
  //  Gunpowder's wall EROSION (the end of the castle age) stays a real channel
  //  effect but is spread over the siege-gun era — gunpowder −0.05, firearms
  //  −0.07 (`defenseRev`, replacing the legacy one-shot −0.12; same −0.12 era
  //  total, so FX_TOTAL.defense is conserved) — and each carrier's own combat
  //  multiple exceeds its wall debit, so adopting guns is never a net own-goal.
  copper_working:{ military:0.24, milMul:1.10, wealth:0.03 },
  bronze_working:{ military:0.28, milMul:1.25 },
  bronze_arms:  { military:0.08, milMul:1.10 },
  archery:      { military:0.05 },
  iron_working: { military:0.30, milMul:1.40 },
  iron_legions: { military:0.12, milMul:1.15, cohesion:0.03 },
  chariots:     { military:0.28, logistics:0.04 },
  cavalry:      { military:0.18, logistics:0.12 },
  chivalry:     { military:0.10, defense:0.08 },
  blast_furnace:{ military:0.03, build:0.02 },
  gunpowder:    { military:0.05, milMul:1.25, defense:-0.12, defenseRev:-0.05 },   // ends the age of the castle wall
  firearms:     { military:0.05, milMul:1.30, defenseRev:-0.07 },
  foundry:      { military:0.04, milMul:1.10, build:0.02 },
  musketry:     { military:0.07, milMul:1.35, cohesion:0.04 },
  steel:        { military:0.06, milMul:1.20, build:0.04 },
  rifling:      { military:0.05, milMul:1.40 },
  combustion:   { military:0.03, milMul:1.25, trade:0.10, seaSpeed:0.20, logistics:0.15 },
  flight:       { military:0.03, milMul:1.12 },
  mining:       { wealth:0.12, military:0.02 },
  // — administration / reach / cohesion —  (reach is GAP-WEIGHTED onto the admin
  //  techs by their org-thresholds, cohesion FRONT-LOADED onto early social/legal
  //  order, so both track continuous organization closely — empire size & lifespan
  //  stay ≈ the same while the DRIVER becomes the visible admin techs.)
  mysticism:    { cohesion:0.18 },
  writing:      { reach:0.35, trade:0.05, sci:0.20 },
  code_of_laws: { reach:0.10, cohesion:0.22 },
  mathematics:  { trade:0.05, build:0.02 },
  philosophy:   { cohesion:0.04, reach:0.05 },
  feudalism:    { reach:0.06, cohesion:0.12, military:0.04 },
  the_wheel:    { trade:0.08, military:0.02, logistics:0.06 },
  roads:        { reach:0.03, trade:0.18, military:0.03, logistics:0.30 },
  paper:        { reach:0.03, trade:0.04, sci:0.15 },
  university:   { reach:0.04, sci:0.40 },
  printing:     { reach:0.05, cohesion:0.04, logistics:0.08, sci:0.50 },
  sci_method:   { reach:0.04, sci:0.60 },
  democracy:    { reach:0.08, cohesion:0.10 },
  industrialism:{ reach:0.06, wealth:0.20, build:0.04 },
  telegraph:    { reach:0.04, cohesion:0.06, logistics:0.25 },
  computing:    { reach:0.05, wealth:0.20, logistics:0.10, sci:0.80 },
  // — economy / wealth / trade —
  currency:     { trade:0.18, wealth:0.15, market:true, reach:0.08 },
  guilds:       { trade:0.10, wealth:0.08, build:0.02 },
  banking:      { trade:0.15, wealth:0.24, credit:true },   // the credit INSTITUTION: fractional money creation unlocks with the first banks (settlement.js updateWealth)
  economics:    { trade:0.20, wealth:0.20, reach:0.05 },
  alchemy:      { wealth:0.05 },
};

const lerp = (a, b, t) => a + (b - a) * t;
const FX_CH = ["farm", "fish", "build", "military", "reach", "cohesion", "defense", "trade", "wealth", "seaSpeed", "seaRange", "logistics", "health", "sci"];
const FX_ABIL = ["embark", "ocean", "colonize", "walls", "market", "credit"];
// (health channel consumers: shocks.js plague mortality/spread and the
// urban-mortality drag in settlement.js — epidemics fade exactly when and
// where a society earns sanitation, never on a date.)

// Full-tech channel totals (every tech's contribution summed). Used to NORMALISE
// the "level" channels — the ones that stand in for a 0..1 track inside a formula
// (build↔construction, reach/cohesion↔organization, sea*↔navigation) — so they
// span 0..1 like that track. The additive-bonus channels (farm/fish/military) are
// NOT normalised; their hand-calibrated sums already equal the old additive max.
const FX_TOTAL = {}; for (const c of FX_CH) FX_TOTAL[c] = 0;
for (const id in TECH_FX) { const fx = TECH_FX[id]; for (const key in fx) if (typeof fx[key] === "number" && key in FX_TOTAL) FX_TOTAL[key] += fx[key]; }
const lvl = (sum, ch) => FX_TOTAL[ch] > 0 ? sum / FX_TOTAL[ch] : 0;   // raw channel sum → 0..1 level

// Aggregate a culture's discovered techs into concrete bonus channels + ability
// flags, blended against the OLD continuous-knowledge formulas by `blend`
// (0 = exactly the previous sim, 1 = fully tech-driven). The returned object is
// what the sim reads — farmYield/fishFactor/buildLevel/military/reach/… — so the
// continuous tracks no longer hand out bonuses directly; the techs do.
//
// MEMOISED on the exact (six tracks, blend) tuple: knowledge only changes on a
// settlement's staggered KNOW_INTERVAL refresh, yet several passes ask for the
// effects in between (techEff lazies, settlementPower, makeSettlement bursts),
// and identical young settlements share inputs. Exact keys keep the function
// bit-identical to the uncached version (no quantisation drift); the cache is
// bounded and simply cleared when full. Treat the returned object as frozen —
// every consumer reads it, none mutate it.
const _fxCache = new Map();
const _FX_CACHE_MAX = 4096;
export function techEffects(k, blend = 1) {
  const _k = k || {};
  // Quantized key (1e-3 buckets): the tracks drift every tick, so exact float
  // keys never repeated and the memo hit ~0% in steady state — every call paid
  // the full DAG walk. A millibucket is far below any gate/effect threshold,
  // deterministic, and turns the 8-tick refresh cadence into real cache hits.
  const q = (v) => Math.round((v || 0) * 1000);
  // CRITICAL for determinism: the effects are computed from the BUCKETED
  // values (qk), not the raw ones — the memo must be a pure function of its
  // key, or two nearby inputs sharing a bucket would return whichever was
  // computed first (cache-history-dependent results broke same-seed runs).
  const qk = {
    agriculture: q(_k.agriculture) / 1000, construction: q(_k.construction) / 1000,
    organization: q(_k.organization) / 1000, metallurgy: q(_k.metallurgy) / 1000,
    navigation: q(_k.navigation) / 1000, mobility: q(_k.mobility) / 1000,
  };
  // T.MIL_REVOLUTIONS is part of the memo key: the lever switches which
  // military formula a cached entry embodies, so dragging it must miss.
  const STEEP = T.MIL_REVOLUTIONS > 0;
  const _key = q(_k.agriculture) + "," + q(_k.construction) + "," + q(_k.organization) + ","
             + q(_k.metallurgy) + "," + q(_k.navigation) + "," + q(_k.mobility) + "|" + blend + (STEEP ? "|R" : "");
  const _hit = _fxCache.get(_key);
  if (_hit) return _hit;
  const have = techState(qk).have;
  const ch = {}; for (const c of FX_CH) ch[c] = 0;
  const can = {}; for (const a of FX_ABIL) can[a] = false;
  // Imminent techs (prereqs met, knowledge in progress) lend a FRACTION of their
  // bonus by how close they are — a soft on-ramp that lets the discrete staircase
  // hug the old smooth curve instead of jumping at the unlock tick. Abilities
  // (embark/ocean/…) still flip only on the real unlock.
  const PARTIAL = 0.6;
  // Revolutions path (T.MIL_REVOLUTIONS): milAdd = the additive military sum
  // EXCLUDING revolution carriers (their weight is replaced by their factor);
  // milMul = the compounding product of the carriers' factors, each factor
  // interpolated by credit (an imminent revolution lends a fraction of its
  // multiple — the same on-ramp as the additive channel).
  let milAdd = 0, milMul = 1;
  for (let i = 0; i < TECHS.length; i++) {
    const fx = TECH_FX[TECHS[i].id]; if (!fx) continue;
    let credit;
    if (have[i]) credit = 1;
    else { const ns = techNodeState(qk, have, TECHS[i]); credit = ns.state === "next" ? ns.prog * PARTIAL : 0; }
    if (credit <= 0) continue;
    for (const key in fx) {
      const v = fx[key];
      if (typeof v === "boolean") { if (v && credit >= 1) can[key] = true; }
      else if (key === "milMul") { if (STEEP) milMul *= 1 + (v - 1) * credit; }
      else if (key === "defenseRev") { if (STEEP) ch.defense += v * credit; }   // the era-spread wall erosion (replaces the carrier's legacy `defense`)
      else if (key in ch) {
        if (STEEP && key === "defense" && fx.defenseRev !== undefined) continue;   // superseded by defenseRev on the revolutions path
        ch[key] += v * credit;
        if (key === "military" && fx.milMul === undefined) milAdd += v * credit;
      }
    }
  }
  const ag = qk.agriculture, cn = qk.construction, nav = qk.navigation,
        met = qk.metallurgy, mob = qk.mobility, org = qk.organization;
  const out = {
    have, ch, ...can,
    farmYield:  1 + lerp(ag * 1.2, ch.farm, blend),            // ×land food   (old 1+ag·1.2)
    fishFactor: 0.3 + lerp(nav * 1.2, ch.fish, blend),          // ×fishery     (old 0.3+nav·1.2)
    // ×combat. Legacy: bounded additive (old 1+met·1.5+mob·0.8 at blend 0).
    // Revolutions (T.MIL_REVOLUTIONS, default): incremental techs add, armament
    // revolutions MULTIPLY and compound (see the TECH_FX military block) — the
    // decisive transitions are real force multiples at equal population.
    military:   STEEP
      ? (1 + lerp(met * 1.5 + mob * 0.8, milAdd, blend)) * (1 + (milMul - 1) * blend)
      : 1 + lerp(met * 1.5 + mob * 0.8, ch.military, blend),
    buildLevel: lerp(cn, lvl(ch.build, "build"), blend),        // density lvl  (old construction)
    reachLevel: lerp(org, lvl(ch.reach, "reach"), blend),       // admin reach  (old organization)
    cohesion:   lerp(org, lvl(ch.cohesion, "cohesion"), blend), // loyalty hold (old organization)
    defenseLevel: lerp(cn, lvl(ch.defense, "defense"), blend),  // city defence (old construction)
    seaSpeed:   lerp(nav, lvl(ch.seaSpeed, "seaSpeed"), blend), // ship speed   (old navigation)
    seaRange:   lerp(nav, lvl(ch.seaRange, "seaRange"), blend), // naval reach  (old navigation)
    logisticsLevel: lvl(ch.logistics, "logistics"),            // transport+comms → empire SIZE (roads→rail→telegraph); blended into eraMul in countryTerritory.js
    // Trade & wealth are ADDED bonuses (the old sim had no trade-infrastructure
    // term) — Currency → Banking → Economics lift a settlement's export value, so
    // trade-tech cities capture more of the (fixed, mining-minted) coin pool.
    // 1.0 at blend 0 (no change), up to ~1.5 fully teched.
    tradeMult:  1 + blend * lvl(ch.trade, "trade") * 0.5,
    // 0 (no sanitation) → ~1 (full modern medicine): fraction of crowd-disease
    // burden the settlement's own discovered techs remove. Sum of health fx,
    // capped — aqueducts alone ≈ a quarter, germ theory the great leap.
    healthRelief: Math.min(0.9, ch.health),
    wealthMult: 1 + blend * lvl(ch.wealth, "wealth") * 0.5,     // exposed for later (treasury/mining); not yet wired
    // Knowledge-INSTITUTION rate multiplier (raw sum, not normalised): writing →
    // printing → universities → the scientific method multiply how fast ideas are
    // produced and kept (settlement.js SCI_COMPOUND — the chronology rectification).
    sciInst: 1 + ch.sci,
  };
  if (_fxCache.size >= _FX_CACHE_MAX) _fxCache.clear();
  _fxCache.set(_key, out);
  return out;
}

// Human-readable one-line summary of a tech's effect, for the tree tooltip.
const FX_LABEL = { farm:"farm", fish:"fishing", build:"city size", military:"military", reach:"reach",
  cohesion:"stability", defense:"defence", trade:"trade", wealth:"wealth", seaSpeed:"ship speed", seaRange:"naval range", logistics:"empire reach",
  embark:"can embark", ocean:"ocean-going ships", colonize:"overseas colonies", walls:"city walls", market:"markets", credit:"bank credit" };
export function techEffectText(id) {
  const fx = TECH_FX[id]; if (!fx) return "";
  return techEffectList(id).map(e => e.text).join(" · ");
}

// Structured per-tech effects for the tree's hover card: one entry per channel
// with its display text, the channel key (for colour-coding) and whether it's a
// boon. Booleans (embark/walls/…) render as plain ability labels. Rendered for
// the live T.MIL_REVOLUTIONS arm: a revolution carrier shows its ×factor (its
// additive `military` weight is the superseded legacy arm), and a carrier's
// era-spread wall debit (`defenseRev`) supersedes its legacy `defense` entry.
export function techEffectList(id) {
  const fx = TECH_FX[id]; if (!fx) return [];
  const steep = T.MIL_REVOLUTIONS > 0;
  const out = [];
  for (const key in fx) {
    const v = fx[key];
    if (typeof v === "boolean") { if (v) out.push({ key, text: FX_LABEL[key] || key, good: true, ability: true }); }
    else if (key === "milMul") { if (steep) out.push({ key: "military", text: `×${v.toFixed(2)} ${FX_LABEL.military}`, good: true, ability: false }); }
    else if (key === "defenseRev") { if (steep) out.push({ key: "defense", text: `${v > 0 ? "+" : ""}${Math.round(v * 100)}% ${FX_LABEL.defense}`, good: v > 0, ability: false }); }
    else {
      if (steep && key === "military" && fx.milMul !== undefined) continue;      // replaced by the ×factor line
      if (steep && key === "defense" && fx.defenseRev !== undefined) continue;   // replaced by the defenseRev line
      out.push({ key, text: `${v > 0 ? "+" : ""}${Math.round(v * 100)}% ${FX_LABEL[key] || key}`, good: v > 0, ability: false });
    }
  }
  return out;
}

// Stacked totals — every DISCOVERED tech's effects summed per channel (+ the
// abilities unlocked). No partial credit, no blend: the raw "what all my techs
// add up to" the tree header shows. `have` is techState(k).have. Under
// T.MIL_REVOLUTIONS the military line reflects the live arm: carriers' factors
// compound into `milMul` (returned for the header), their superseded additive
// weights / one-shot wall debit are excluded from the sums.
export function techTotals(have) {
  const steep = T.MIL_REVOLUTIONS > 0;
  const ch = {}; for (const c of FX_CH) ch[c] = 0;
  const can = {}; for (const a of FX_ABIL) can[a] = false;
  let milMul = 1;
  for (let i = 0; i < TECHS.length; i++) {
    if (!have[i]) continue;
    const fx = TECH_FX[TECHS[i].id]; if (!fx) continue;
    for (const key in fx) {
      const v = fx[key];
      if (typeof v === "boolean") { if (v) can[key] = true; }
      else if (key === "milMul") { if (steep) milMul *= v; }
      else if (key === "defenseRev") { if (steep) ch.defense += v; }
      else if (key in ch) {
        if (steep && key === "military" && fx.milMul !== undefined) continue;
        if (steep && key === "defense" && fx.defenseRev !== undefined) continue;
        ch[key] += v;
      }
    }
  }
  return { ch, can, milMul };
}
export function techTotalList(have) {
  const { ch, can, milMul } = techTotals(have);
  const out = [];
  for (const c of FX_CH) if (Math.abs(ch[c]) > 0.001) out.push({ key: c, text: `${ch[c] > 0 ? "+" : ""}${Math.round(ch[c] * 100)}% ${FX_LABEL[c] || c}`, good: ch[c] > 0 });
  if (milMul > 1.001) out.push({ key: "military", text: `×${milMul.toFixed(2)} ${FX_LABEL.military} (revolutions)`, good: true });
  for (const a of FX_ABIL) if (can[a]) out.push({ key: a, text: FX_LABEL[a] || a, good: true, ability: true });
  return out;
}

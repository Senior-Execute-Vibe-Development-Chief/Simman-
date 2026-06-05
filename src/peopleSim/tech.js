// ── Tech discovery layer ─────────────────────────────────────────────
// A Civ-like tech TREE derived from the continuous knowledge tracks
// (settlement.js). There is no separate research: a settlement discovers a tech
// the instant (a) all of its PREREQUISITE techs are already discovered and (b) the
// knowledge thresholds are met. The prerequisites make the tree a real DAG with
// Civ-style dependency chains (Iron Working needs Bronze Working; Cavalry needs
// Iron Working + Chariots; Bureaucracy needs Laws + Currency).
//
// It needs no resource lookup because the resource-gated tracks already encode
// their inputs in their LEVEL: metallurgy is hard-gated by ore (its value implies
// copper → bronze → iron → steel access), navigation by water, mobility by horses.
// So the knowledge vector alone places a culture on the tree. The list is in
// topological order (prereqs precede dependents), so one forward pass resolves it
// (≤31 techs → a 32-bit mask). Pure legibility — it changes nothing in the sim.

export const ERAS = ["Stone Age", "Copper Age", "Bronze Age", "Iron Age", "Steel Age"];

// id, era (column), name, prereq techs, req(k) → knowledge met?, gate (dominant
// track + threshold) for the "researching" progress hint.
export const TECHS = [
  { id:"stone_tools",   era:0, name:"Stone Tools",            prereq:[],                         req:()=>true,                                      gate:null },
  { id:"farming",       era:0, name:"Farming",                prereq:["stone_tools"],            req:k=>k.agriculture>=0.15,                        gate:["agriculture",0.15] },
  { id:"pottery",       era:0, name:"Pottery",                prereq:["stone_tools"],            req:k=>k.construction>=0.20,                       gate:["construction",0.20] },
  { id:"the_wheel",     era:0, name:"The Wheel",              prereq:["pottery"],                req:k=>k.construction>=0.32||k.mobility>=0.22,     gate:["construction",0.32] },
  { id:"copper_working",era:1, name:"Copper Working",         prereq:["stone_tools"],            req:k=>k.metallurgy>=0.18,                         gate:["metallurgy",0.18] },
  { id:"masonry",       era:1, name:"Masonry · Stone Walls",  prereq:["pottery"],                req:k=>k.construction>=0.40,                       gate:["construction",0.40] },
  { id:"sailing",       era:1, name:"Sailing",                prereq:["pottery"],                req:k=>k.navigation>=0.35,                         gate:["navigation",0.35] },
  { id:"writing",       era:1, name:"Writing",                prereq:["pottery"],                req:k=>k.organization>=0.35,                       gate:["organization",0.35] },
  { id:"irrigation",    era:1, name:"Irrigation",             prereq:["farming","pottery"],      req:k=>k.agriculture>=0.50&&k.construction>=0.30,  gate:["agriculture",0.50] },
  { id:"bronze_working",era:2, name:"Bronze Working",         prereq:["copper_working"],         req:k=>k.metallurgy>=0.40,                         gate:["metallurgy",0.40] },
  { id:"monuments",     era:2, name:"Monumental Architecture",prereq:["masonry"],                req:k=>k.construction>=0.65,                       gate:["construction",0.65] },
  { id:"currency",      era:2, name:"Currency",               prereq:["writing"],                req:k=>k.organization>=0.45,                       gate:["organization",0.45] },
  { id:"chariots",      era:2, name:"Chariots",               prereq:["bronze_working","the_wheel"], req:k=>k.mobility>=0.45,                       gate:["mobility",0.45] },
  { id:"galleys",       era:2, name:"Large Ships · Galleys",  prereq:["sailing","masonry"],      req:k=>k.navigation>=0.60&&k.construction>=0.40,   gate:["navigation",0.60] },
  { id:"iron_working",  era:3, name:"Iron Working",           prereq:["bronze_working"],         req:k=>k.metallurgy>=0.70,                         gate:["metallurgy",0.70] },
  { id:"code_of_laws",  era:3, name:"Code of Laws",           prereq:["writing"],                req:k=>k.organization>=0.55,                       gate:["organization",0.55] },
  { id:"roads",         era:3, name:"Roads & Aqueducts",      prereq:["masonry","the_wheel"],    req:k=>k.construction>=0.60&&k.organization>=0.45, gate:["construction",0.60] },
  { id:"crop_rotation", era:3, name:"Crop Rotation",          prereq:["irrigation"],             req:k=>k.agriculture>=0.80,                        gate:["agriculture",0.80] },
  { id:"cavalry",       era:3, name:"Cavalry",                prereq:["iron_working","chariots"],req:k=>k.mobility>=0.70,                           gate:["mobility",0.70] },
  { id:"ocean_nav",     era:3, name:"Ocean Navigation",       prereq:["galleys","writing"],      req:k=>k.navigation>=0.85,                         gate:["navigation",0.85] },
  { id:"steel",         era:4, name:"Steel",                  prereq:["iron_working"],           req:k=>k.metallurgy>=0.92,                         gate:["metallurgy",0.92] },
  { id:"bureaucracy",   era:4, name:"Bureaucracy",            prereq:["code_of_laws","currency"],req:k=>k.organization>=0.78,                       gate:["organization",0.78] },
];

export const TECH_IDX = {}; TECHS.forEach((t, i) => { TECH_IDX[t.id] = i; });
const bit = (id) => 1 << TECH_IDX[id];
const prereqsMet = (t, mask) => { for (const p of t.prereq) if (!(mask & bit(p))) return false; return true; };

// Discovered-tech bitmask + the culture's era (highest reached) + count.
export function techState(k) {
  if (!k) return { mask: 0, era: 0, have: 0 };
  let mask = 0, era = 0, have = 0;
  for (let i = 0; i < TECHS.length; i++) {
    const t = TECHS[i];
    if (prereqsMet(t, mask) && t.req(k)) { mask |= 1 << i; have++; if (t.era > era) era = t.era; }
  }
  return { mask, era, have };
}

// Per-tech display state for the tree: "have" (discovered), "next" (all prereqs
// met, only knowledge holding it back — with progress 0..1), or "locked" (a
// prerequisite tech is still missing).
export function techNodeState(k, mask, t) {
  if (mask & bit(t.id)) return { state: "have", prog: 1 };
  if (!prereqsMet(t, mask)) return { state: "locked", prog: 0 };
  const prog = t.gate ? Math.min(1, (k[t.gate[0]] || 0) / t.gate[1]) : 0;
  return { state: "next", prog };
}

// The next unlockable techs (prereqs met, knowledge in progress), closest first.
export function nextTechs(k, mask, n = 3) {
  if (!k) return [];
  const out = [];
  for (let i = 0; i < TECHS.length; i++) {
    if (mask & (1 << i)) continue;
    const t = TECHS[i]; if (!t.gate || !prereqsMet(t, mask)) continue;
    out.push({ id: t.id, name: t.name, era: t.era, prog: Math.min(1, (k[t.gate[0]] || 0) / t.gate[1]), track: t.gate[0] });
  }
  out.sort((a, b) => b.prog - a.prog);
  return out.slice(0, n);
}

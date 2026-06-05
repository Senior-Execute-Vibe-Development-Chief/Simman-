// ── Tech discovery layer ─────────────────────────────────────────────
// A Civ-like ladder of named discoveries DERIVED from the continuous knowledge
// tracks (settlement.js). There is no separate research: a settlement "has" a
// tech the instant its knowledge qualifies. This works without any resource
// lookup because the resource-gated tracks already encode their inputs in their
// LEVEL — metallurgy is hard-gated by ore (so its value implies copper → bronze →
// iron → steel access), navigation by water, mobility by horses. So the knowledge
// vector alone places a culture on the tech tree. Prerequisite techs reference
// earlier entries, so one forward pass resolves the whole tree (≤31 techs → a
// 32-bit mask). This is purely a legibility layer for the UI — it changes nothing
// in the simulation.

export const ERAS = ["Stone Age", "Copper Age", "Bronze Age", "Iron Age", "Steel Age"];

// Each tech: id, era index, display name, req(k, has) → discovered?, and `gate`
// (the dominant knowledge track + threshold) used for the "researching" progress
// hint. metallurgy thresholds line up with the ore ladder (chalcolithic 0.15 →
// bronze >0.30 → iron >0.65 → steel >0.90), so they imply the matching ore.
export const TECHS = [
  { id:"stone_tools",   era:0, name:"Stone Tools",            req:()=>true,                                          gate:null },
  { id:"farming",       era:0, name:"Farming",                req:k=>k.agriculture>=0.15,                            gate:["agriculture",0.15] },
  { id:"pottery",       era:0, name:"Pottery",                req:k=>k.construction>=0.20,                           gate:["construction",0.20] },
  { id:"the_wheel",     era:0, name:"The Wheel",              req:k=>k.construction>=0.32||k.mobility>=0.22,         gate:["construction",0.32] },
  { id:"copper_working",era:1, name:"Copper Working",         req:k=>k.metallurgy>=0.18,                             gate:["metallurgy",0.18] },
  { id:"masonry",       era:1, name:"Masonry · Stone Walls",  req:k=>k.construction>=0.40,                           gate:["construction",0.40] },
  { id:"sailing",       era:1, name:"Sailing",                req:k=>k.navigation>=0.35,                             gate:["navigation",0.35] },
  { id:"writing",       era:1, name:"Writing",                req:k=>k.organization>=0.35,                           gate:["organization",0.35] },
  { id:"irrigation",    era:1, name:"Irrigation",             req:k=>k.agriculture>=0.50&&k.construction>=0.30,      gate:["agriculture",0.50] },
  { id:"bronze_working",era:2, name:"Bronze Working",         req:k=>k.metallurgy>=0.40,                             gate:["metallurgy",0.40] },
  { id:"monuments",     era:2, name:"Monumental Architecture",req:k=>k.construction>=0.65,                           gate:["construction",0.65] },
  { id:"currency",      era:2, name:"Currency",               req:(k,has)=>k.organization>=0.45&&has("writing"),     gate:["organization",0.45] },
  { id:"chariots",      era:2, name:"Chariots",               req:(k,has)=>k.mobility>=0.45&&has("bronze_working"),  gate:["mobility",0.45] },
  { id:"galleys",       era:2, name:"Large Ships · Galleys",  req:k=>k.navigation>=0.60&&k.construction>=0.40,       gate:["navigation",0.60] },
  { id:"iron_working",  era:3, name:"Iron Working",           req:k=>k.metallurgy>=0.70,                             gate:["metallurgy",0.70] },
  { id:"code_of_laws",  era:3, name:"Code of Laws",           req:(k,has)=>k.organization>=0.55&&has("writing"),     gate:["organization",0.55] },
  { id:"roads",         era:3, name:"Roads & Aqueducts",      req:k=>k.construction>=0.60&&k.organization>=0.45,     gate:["construction",0.60] },
  { id:"crop_rotation", era:3, name:"Crop Rotation",          req:k=>k.agriculture>=0.80,                            gate:["agriculture",0.80] },
  { id:"cavalry",       era:3, name:"Cavalry",                req:(k,has)=>k.mobility>=0.70&&has("iron_working"),    gate:["mobility",0.70] },
  { id:"ocean_nav",     era:3, name:"Ocean Navigation",       req:(k,has)=>k.navigation>=0.85&&has("galleys"),       gate:["navigation",0.85] },
  { id:"steel",         era:4, name:"Steel",                  req:k=>k.metallurgy>=0.92,                             gate:["metallurgy",0.92] },
  { id:"bureaucracy",   era:4, name:"Bureaucracy",            req:(k,has)=>k.organization>=0.78&&has("code_of_laws"),gate:["organization",0.78] },
];

const TECH_IDX = {}; TECHS.forEach((t, i) => { TECH_IDX[t.id] = i; });

// Discovered-tech bitmask + the culture's era (highest era reached) + count.
export function techState(k) {
  if (!k) return { mask: 0, era: 0, have: 0 };
  let mask = 0, era = 0, have = 0;
  const has = (id) => { const i = TECH_IDX[id]; return i !== undefined && (mask & (1 << i)) !== 0; };
  for (let i = 0; i < TECHS.length; i++) {
    if (TECHS[i].req(k, has)) { mask |= 1 << i; have++; if (TECHS[i].era > era) era = TECHS[i].era; }
  }
  return { mask, era, have };
}

// The next undiscovered techs whose PREREQUISITE techs are already met (so only a
// knowledge track is holding them back), with how close (0..1) that track is —
// the "currently researching" hint for the info panel.
export function nextTechs(k, mask, n = 3) {
  if (!k) return [];
  const has = (id) => { const i = TECH_IDX[id]; return i !== undefined && (mask & (1 << i)) !== 0; };
  const maxed = { agriculture:1, construction:1, organization:1, metallurgy:1, navigation:1, mobility:1 };
  const out = [];
  for (let i = 0; i < TECHS.length && out.length < n; i++) {
    if (mask & (1 << i)) continue;                 // already discovered
    const t = TECHS[i]; if (!t.gate) continue;
    if (!t.req(maxed, has)) continue;              // a prerequisite TECH is still missing — not "next" yet
    const [track, thr] = t.gate;
    out.push({ id: t.id, name: t.name, era: t.era, prog: Math.min(1, (k[track] || 0) / thr), track });
  }
  return out;
}

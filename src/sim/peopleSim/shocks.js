// ── Exogenous shocks: famine + plague ────────────────────────────────
//
// Both crash a settlement's fundamentals — harvest (famine) or population
// (plague) — and so feed the unrest + control-budget systems: a prosperous,
// stable realm can be tipped into collapse by a bad harvest or an epidemic.
// These are the demographic triggers history keeps pointing at: the Antonine /
// Justinian / Black-Death plagues that gutted Rome and the khanates, and the
// famine→rebellion cycle (Little Ice Age, late Ming, the Chinese dynastic
// turnovers). They don't cause collapse on their own — they push the existing
// machinery (hunger→unrest→rebellion; population crash→capacity→fragmentation)
// past its tipping point.

import { passRng } from "./rng.js";
import { logEvent } from "./events.js";
import { T } from "./tuning.js";
import { techEff } from "./settlement.js";
import { fieldShift } from "./popField.js";

// ── FAMINE — a regional bad-harvest event ──
// Hits a geographic cluster of settlements for a window, slashing their land-
// food yield. Reduced supply → starvation (settlement.js) + hunger-driven
// unrest (conquest.js). Read in updateFood via s._famineUntil / s._harvestMul.
const FAMINE_CHECK    = 700;    // ticks between famine-spawn rolls
// FAMINE_CHANCE -> runtime lever (tuning.js T.FAMINE_CHANCE)
const FAMINE_RADIUS   = 12;     // tiles — settlements within this of the seed are struck (regional, not continental)
const FAMINE_MIN_DUR  = 400;
const FAMINE_MAX_DUR  = 1200;
export const FAMINE_SEVERITY = 0.35;   // harvest multiplier during famine (0.35 = ~65% crop loss); exported: T.LEAN_YEAR grounds the founding margin in it — a city's basin must feed it through THIS year (crystallize.js leanMul)
const FAMINE_MIN_POP  = 30;     // only seed on a real settlement
// Famine as VULNERABILITY, not a blind die-roll. A bad harvest becomes a FAMINE
// where the society has no cushion — packed against its food ceiling, on
// exhausted soil, with empty granaries, already running a shortfall. The famine
// OCCURRENCE rate is left exactly as it was (so the long-run mean frequency the
// world was validated at is preserved — no calibration risk), and only the SEED
// PICK is weighted by fragility: when a famine strikes, it lands on the
// over-extended, soil-mined, hungry region, not a slack well-stored one. The
// distribution moves toward the fragile — and toward hungry EPOCHS, since a bad
// climate/harvest window makes more of the map fragile at once, so the weighted
// pick concentrates there — while the mean stays put. A vulnerability floor
// keeps even a fat, well-fed world in the draw (no region is perfectly famine-
// proof), so the pick never degenerates to a single hotspot.
function famineVuln(s) {
  const foodK = s._foodK || s._houseK || 1;
  const pressure = Math.min(2.5, (s.people || 0) / Math.max(1, foodK));           // crowding toward the food ceiling (Malthus)
  const soil     = 1 + (s._soilFatigue || 0);                                     // mined-out land yields a thinner margin
  const granary  = 1 - 0.85 * Math.min(1, (s.food || 0) / (80 + (s.tier | 0) * 200));  // empty stores → no buffer (full stores still leave a 0.15 floor: no one is famine-proof)
  const shortfall = Math.min(3, (s._foodDemand || 1) / Math.max(0.01, s._foodSupply));  // already short → a shock tips it over (also the climate/harvest signal). No `|| 1` on supply: a genuinely food-empty settlement (supply 0) must read as MOST short, not neutral — Math.max(0.01,…) already guards the divide.
  return 0.05 + pressure * soil * granary * shortfall;                            // + a small absolute floor so the weighted draw always has support
}

// ── PLAGUE — an epidemic that SPREADS along the trade graph ──
// Crashes population (worse in dense cities), then burns out leaving survivors
// temporarily immune. The trade network that enriches a realm also carries the
// disease — and a plague that reaches the capital craters its population, which
// shrinks the control budget (conquest.js) and can collapse the realm.
const PLAGUE_CHECK    = 1800;   // ticks between plague-spawn rolls (generational)
// PLAGUE_CHANCE -> runtime lever (tuning.js T.PLAGUE_CHANCE)
const PLAGUE_DUR      = 250;    // how long a settlement stays infectious (shorter window → lower R0)
const PLAGUE_IMMUNE   = 4000;   // post-plague immunity window (resistant survivors block re-cascade)
// PLAGUE_MORT -> runtime lever (tuning.js T.PLAGUE_MORT)
const PLAGUE_URBAN    = 0.6;    // extra mortality ∝ log10(pop/100) (crowding/sanitation)
const PLAGUE_SPREAD   = 0.0006; // per-tick chance an infected node infects a trade partner.
                                // Tuned for R0 ≈ 3 on a real-scale Earth (~250 large hubs,
                                // 20+ trade partners each). Most outbreaks become regional
                                // pandemics affecting tens of settlements; the well-connected
                                // ones sweep continents (Justinian/Black-Death pattern).
                                // Previously 0.00018 — too low for full-Earth maps; only test
                                // disc worlds saw outbreaks of meaningful size.
const PLAGUE_SEA_MULT = 2.0;    // sea routes carried plague fast + far (Black Death by ship)
const PLAGUE_MIN_POP  = 50;     // needs a real population to take hold / seed

// ── ENDEMIC DISEASE LOAD + the VIRGIN-SOIL (Columbian) catastrophe ──
// Every population carries an endemic disease load — the crowd plagues, the zoonoses caught off
// livestock, and the shared immunity of belonging to a vast trade-connected host pool. It is built
// by DENSITY (cities), LIVESTOCK (animal spillover) and CONNECTIVITY, and it DIFFUSES across the
// trade graph so a whole interconnected landmass converges on its highest endemic load: the Old
// World — one immense, dense, livestock-keeping, interlinked continent — climbs high, while an
// isolated continent reached late and lightly (the New World, Sahul) stays low. That GAP is the
// fuel: on the FIRST sea contact bridging it, the low-immunity people meet, all at once, every
// disease the connected world long endured — a virgin-soil epidemic of up to ~90% mortality (the
// Columbian collapse). The crash empties the land, which demographic admixture (settlement.js)
// then repopulates with the immune incomers' stock — REPLACEMENT. The cause is simply contact
// between disease pools that evolved in isolation; it emerges once a navy can cross the ocean.
const LOAD_CHECK    = 300;    // ticks between endemic-load updates (slow, generational)
const LOAD_RATE     = 0.08;   // how far load moves toward its target each update
const LOAD_DIFFUSE  = 0.92;   // a peer's load reaches you at this fraction (shared immunity across the network)
const CONTACT_CHECK = 600;    // ticks between first-contact scans
const CONTACT_GAP   = 0.35;   // load gap that makes first contact catastrophic (an ocean between disease pools)
const VIRGIN_MORT   = 6;      // mortality multiplier while a virgin-soil epidemic burns (no immunity)
const VIRGIN_DUR    = 900;    // how long the virgin-soil wave keeps killing (it sweeps an unexposed people)
const VIRGIN_RADIUS = 22;     // tiles of the contacted population swept by the wave

function loadTarget(s) {
  const urban = Math.min(1, Math.max(0, Math.log10(Math.max(1, s.people) / 200)) / 1.5);            // crowd diseases
  const stock = Math.min(1, (s._livestock || 0) * 2.2);                                             // zoonotic spillover
  const conn  = Math.min(1, ((s._tradeReach ? s._tradeReach.size : 0) + (s._seaReach ? s._seaReach.size : 0)) / 9); // connected host pool
  return Math.min(1, 0.28 * urban + 0.30 * stock + 0.30 * conn);
}

function torusDist(world, ax, ay, bx, by) {
  let dx = Math.abs(ax - bx); if (dx > world.tw / 2) dx = world.tw - dx;
  const dy = ay - by; return Math.sqrt(dx * dx + dy * dy);
}

// Endemic load: grow each settlement toward max(its local target, the immunity it catches from
// trade/sea peers). Diffusion converges a connected landmass on its highest endemic load.
function updateDiseaseLoad(world) {
  const setts = world.settlements;
  const peerMax = new Map();
  for (const s of setts) {
    if (s.mode !== "settled") continue;
    let m = 0;
    const scan = (reach) => { if (reach) for (const id of reach.keys()) { const p = world._byId && world._byId.get(id); if (p && (p._diseaseLoad || 0) > m) m = p._diseaseLoad || 0; } };
    scan(s._tradeReach); scan(s._seaReach);
    peerMax.set(s.id, m);
  }
  for (const s of setts) {
    if (s.mode !== "settled") continue;
    const target = Math.max(loadTarget(s), (peerMax.get(s.id) || 0) * LOAD_DIFFUSE);
    s._diseaseLoad = (s._diseaseLoad || 0) + (target - (s._diseaseLoad || 0)) * LOAD_RATE;
  }
}

// First contact across an immunity gap → a virgin-soil epidemic on the low-immunity people.
function contactEpidemic(world, rng) {
  const _dt = world._dt || 1;
  for (const s of world.settlements) {
    if (s.mode !== "settled" || !s._seaReach || s._seaReach.size === 0) continue;
    const sl = s._diseaseLoad || 0;
    for (const pid of s._seaReach.keys()) {
      const p = world._byId && world._byId.get(pid);
      if (!p || p.mode !== "settled") continue;
      const lo = sl <= (p._diseaseLoad || 0) ? s : p, hi = lo === s ? p : s;
      if (lo._contacted) continue;
      if ((hi._diseaseLoad || 0) - (lo._diseaseLoad || 0) < CONTACT_GAP) continue;
      // The diseases of the connected world arrive among a people with no immunity. Sweep the
      // whole low-immunity population around the contact point (geographic — everyone is exposed).
      const sev = Math.min(1, ((hi._diseaseLoad || 0) - (lo._diseaseLoad || 0)) / 0.6);
      let struck = 0;
      for (const n of world.settlements) {
        if (n.mode !== "settled" || n._contacted) continue;
        if ((hi._diseaseLoad || 0) - (n._diseaseLoad || 0) < CONTACT_GAP) continue;   // only pools genuinely naive to the ARRIVING diseases (comparing against the scanner's own load let a high-load port sweep in mid-load immune neighbours)
        if (torusDist(world, lo.pos.x, lo.pos.y, n.pos.x, n.pos.y) > VIRGIN_RADIUS) continue;
        n._contacted = true;
        n._virginUntil = world.step + (VIRGIN_DUR * sev) / _dt;
        infect(world, n);
        struck++;
      }
      if (struck) logEvent(world, "plague.virginSoil", { polity: lo.countryId, s: lo.id, sName: lo.name,
        x: lo.pos.x | 0, y: lo.pos.y | 0, mortality: +(sev).toFixed(2) });
      break;   // one contact event per source settlement per scan
    }
  }
}

export function updateShocks(world) {
  if (!world._plagued) world._plagued = new Set();
  if (world.step % LOAD_CHECK === 0) updateDiseaseLoad(world);
  if (world.step % CONTACT_CHECK === 0) contactEpidemic(world, passRng(world, "contact"));
  const famineCheck = world.step % FAMINE_CHECK === 0;
  const plagueCheck = world.step % PLAGUE_CHECK === 0;
  // Nothing shock-related can happen this tick (no spawn roll due, no active
  // outbreak to advance) — skip, and skip the per-tick RNG allocation. The RNG
  // is re-seeded from world.step each tick and only ever consumed on these
  // ticks anyway, so not allocating it on the rest is behaviour-identical.
  if (!famineCheck && !plagueCheck && world._plagued.size === 0) return;
  const rng = passRng(world, "shocks");

  // ── Famine spawn ──
  const _dt = world._dt || 1;                         // time-granularity step (1/SIM_GRANULARITY)
  if (famineCheck && rng() < T.FAMINE_CHANCE * _dt) {
    // NOTE (reviewed): the pool deliberately does NOT exclude settlements already under an
    // active famine, even though their _harvestMul-cratered supply inflates famineVuln (so a
    // famined region can be re-drawn, extending the famine). This is intentional — consecutive
    // bad harvests compounding on a chronically-fragile region is the real multi-year-famine
    // pattern (the Great Famine of 1315–17, recurrent Sahel drought). Crucially the
    // concentration is SELF-LIMITING and STABILISING: it keeps famine damage on already-fragile
    // ground instead of spreading it to healthy realms. Excluding active famines (mirroring the
    // plague pool) was tried and measurably shortened the fallen-realm lifespan distribution
    // below the validate floor — spreading famines onto fresh, healthier realms causes MORE
    // collapse, not less — so the concentration is kept on purpose.
    const pool = world.settlements.filter(s => s.mode === "settled" && s.people >= FAMINE_MIN_POP);
    if (pool.length) {
      // Same occurrence rate as ever (mean preserved); the SEED is drawn weighted
      // by vulnerability, so the famine lands on the fragile region, not a random
      // one. (Reduces to a uniform pick if every settlement is equally fragile.)
      let totV = 0; const vs = new Float64Array(pool.length);
      for (let i = 0; i < pool.length; i++) { const v = famineVuln(pool[i]); vs[i] = v; totV += v; }
      let r = rng() * totV, si = pool.length - 1;
      for (let i = 0; i < pool.length; i++) { r -= vs[i]; if (r <= 0) { si = i; break; } }
      const seed = pool[si];
      const dur = ((FAMINE_MIN_DUR + rng() * (FAMINE_MAX_DUR - FAMINE_MIN_DUR)) / _dt) | 0;   // ×G ticks → same span in history-time
      const until = world.step + dur;
      const hitPolities = new Set();
      for (const s of world.settlements) {
        if (s.mode !== "settled") continue;
        if (torusDist(world, seed.pos.x, seed.pos.y, s.pos.x, s.pos.y) > FAMINE_RADIUS) continue;
        s._famineUntil = until;
        s._harvestMul = FAMINE_SEVERITY;
        if (s.countryId >= 0) hitPolities.add(s.countryId);
      }
      // One event per afflicted realm per outbreak (the outbreak is the story,
      // not each village's bad harvest).
      for (const cid of hitPolities)
        logEvent(world, "famine.struck", { polity: cid, x: seed.pos.x | 0, y: seed.pos.y | 0 });
    }
  }

  // ── Plague spawn ──
  if (plagueCheck && rng() < T.PLAGUE_CHANCE * _dt) {
    const pool = world.settlements.filter(s =>
      s.mode === "settled" && s.people >= PLAGUE_MIN_POP &&
      world.step >= (s._plagueUntil || 0) && world.step >= (s._plagueImmuneUntil || 0));
    if (pool.length) {
      // Bias toward ports / big hubs — epidemics started where people and ships
      // concentrated. Weighted pick by population (× extra for ports).
      let total = 0;
      for (const s of pool) total += s.people * (s._isPort ? 2 : 1);
      let pick = rng() * total, seed = pool[0];
      for (const s of pool) { pick -= s.people * (s._isPort ? 2 : 1); if (pick <= 0) { seed = s; break; } }
      infect(world, seed);
    }
  }

  // ── Plague lifecycle + spread ──
  if (world._plagued.size) {
    const recovered = [];
    // Snapshot the infected set: infect() adds to world._plagued mid-loop, and JS Sets
    // visit members added during iteration — so without the copy a settlement infected
    // THIS tick would take a mortality hit and roll its own spread the same tick, letting
    // an epidemic hop multiple links per tick and biasing the calibrated R0 (B69). The
    // snapshot makes newly-infected nodes begin their lifecycle next tick.
    for (const id of [...world._plagued]) {
      const s = world._byId ? world._byId.get(id) : null;
      if (!s || s.mode !== "settled") { recovered.push(id); continue; }
      if (world.step >= (s._plagueUntil || 0)) {            // burns out → immune
        s._plagueActive = false;
        s._plagueImmuneUntil = world.step + PLAGUE_IMMUNE / _dt;   // ×G ticks → same immunity span in history-time
        recovered.push(id);
        continue;
      }
      // Mortality (worse in crowded cities). ×_dt: per-tick rates scale with the
      // time-granularity step so a plague kills the same share of a city per
      // unit of HISTORY at any SIM_GRANULARITY, not G× more.
      const urban = Math.max(0, Math.log10(Math.max(1, s.people) / 100));
      // A virgin-soil people meets every disease of the connected world at once, with no
      // inherited immunity: mortality is multiplied while the wave burns (the Columbian collapse).
      const virgin = world.step < (s._virginUntil || 0) ? VIRGIN_MORT : 1;
      // Health technology (tech.js health channel): sanitation blunts the
      // CROWDING term (sewers attack exactly the density-borne burden) and
      // medicine cuts base mortality — a society that never earns them keeps
      // its plagues forever, one that does gets its mortality transition
      // when IT does (review D36; germ_theory/medicine had no effects at all).
      const relief = techEff(s).healthRelief || 0;
      const mort = T.PLAGUE_MORT * (1 - relief) * (1 + PLAGUE_URBAN * urban * (1 - relief)) * virgin * _dt;
      const before = s.people;
      s.people = Math.max(1, s.people * (1 - mort));
      fieldShift(world, s, s.people - before);   // one population: the pestilence empties the LAND too (FIELD_DEMOG)
      // SLAVE_PEOPLE: the unfree live inside s.people — the pestilence takes its share
      // of them too (slave quarters historically fared worse, not better).
      if (T.SLAVERY && T.SLAVE_PEOPLE && (s._unfree || 0) > 0) s._unfree = Math.min((s._unfree || 0) * (1 - mort), Math.max(0, s.people - 1));
      // Spread along the trade graph (road reach + sea lanes). The very links
      // that carry grain and coin carry the contagion. Per-tick infection odds
      // are _dt-scaled for the same reason as mortality.
      spreadFrom(world, s, s._tradeReach, _dt, rng);
      spreadFrom(world, s, s._seaReach, PLAGUE_SEA_MULT * _dt, rng);
    }
    for (const id of recovered) world._plagued.delete(id);
  }
}

function infect(world, s) {
  if (!s || s.mode !== "settled") return;
  if (world.step < (s._plagueImmuneUntil || 0)) return;     // resistant survivors
  if (world.step < (s._plagueUntil || 0)) return;           // already infected
  s._plagueUntil = world.step + PLAGUE_DUR / (world._dt || 1);   // ×G ticks → same infectious span in history-time
  s._plagueActive = true;
  world._plagued.add(s.id);
  // One outbreak event per realm per epidemic wave (an epidemic infects many
  // towns over many ticks; the realm's chronicle wants the WAVE, not each).
  if (s.countryId >= 0) {
    if (!world._plagueEvAt) world._plagueEvAt = new Map();
    const last = world._plagueEvAt.get(s.countryId) ?? -Infinity;
    if (world.step - last > (PLAGUE_DUR * 3) / (world._dt || 1)) {
      world._plagueEvAt.set(s.countryId, world.step);
      logEvent(world, "plague.outbreak", { polity: s.countryId, s: s.id, sName: s.name,
        x: s.pos.x | 0, y: s.pos.y | 0 });
    }
  }
}

function spreadFrom(world, s, reach, mult, rng) {
  if (!reach || reach.size === 0 || !world._byId) return;
  const p = PLAGUE_SPREAD * mult;
  for (const peerId of reach.keys()) {
    if (rng() >= p) continue;
    const peer = world._byId.get(peerId);
    if (peer && peer.mode === "settled" && peer.people >= PLAGUE_MIN_POP) infect(world, peer);
  }
}

// Famine grievance read by the unrest pass — beyond the food-deficit hunger it
// already causes, an active famine adds direct distress. (Plague distress is
// read via s._plagueActive in the same pass.)
export function shockUnrest(world, s) {
  let u = 0;
  if (world.step < (s._famineUntil || 0)) u += 0.5;
  if (s._plagueActive) u += 0.6;
  return u;
}

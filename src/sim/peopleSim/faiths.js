// ── Faiths: religion as a population layer ──
//
// Every culture begins with a FOLK faith — unnamed gods of hearth and
// harvest, carried implicitly by its people. Organized religion is born
// later, in towns that have crossed the organization threshold (the
// priesthood, scripture, doctrine): it spreads along the same arteries
// as goods and plagues — the trade graph — converts rulers (state
// adoption), legitimizes them (loyalty coupling), and SPLITS when its
// followers span realms too far from the founding see (schism).
//
// Settlements carry a faith MIXTURE (s.faithMix = [[faithId, share],...])
// exactly like the culture mixture: conquest doesn't convert anyone;
// missionaries, markets and state pressure do, over generations.
//
// Effects are deliberately modest: a province sharing its ruler's faith
// is a touch more loyal, a province under a ruler of a rival organized
// faith a touch less. Faith never moves armies by itself — it tilts the
// ground the other systems stand on.

import { passRng, entityRng, hash32 } from "./rng.js";
import { logEvent } from "./events.js";
import { getPolity } from "./entities.js";
import { getCulture, languageOf, dominantCulture } from "./cultures.js";

export const FAITH_INTERVAL = 150;       // cadence (≈ polity/culture passes)
const ORGANIZED_ORG_MIN = 0.30;          // founder settlement's organization floor
const ORGANIZED_POP_MIN = 350;           // a movement needs a real town
const GENESIS_CHANCE = 0.015;            // per eligible settlement per pass
const GENESIS_CULTURE_COOLDOWN = 4000;   // min ticks between new faiths within one culture
const SPREAD_RATE = 0.030;               // per-pass share shift toward the pulling faith
const STATE_PRESSURE = 1.6;              // extra pull weight of the ruler's faith
const ORGANIZED_PULL = 1.6;              // organized faiths proselytize; folk faiths don't travel
const FOLK_PULL = 0.45;
const SCHISM_MIN_AGE = 1800;             // a young faith doesn't schism
const SCHISM_CHANCE = 0.05;              // per distant follower-realm per pass
const SCHISM_MIN_DIST = 70;              // map distance from origin see (tiles)
const LOYAL_MATCH = 0.0012;              // per-pass loyalty nudge for shared faith
const LOYAL_CLASH = 0.0022;              // per-pass loyalty bleed under a rival organized faith

export function faithsOf(world) {
  return world.faiths || (world.faiths = new Map());
}
export function getFaith(world, id) {
  return id != null && id >= 0 && world.faiths ? world.faiths.get(id) || null : null;
}

function newFaith(world, fields) {
  const reg = faithsOf(world);
  const id = world._nextFaithId || 1;
  world._nextFaithId = id + 1;
  const f = {
    id, kind: "folk", name: null, cultureId: -1, parentFaithId: -1,
    originSettlementId: -1, foundedStep: world.step | 0,
    hue: (40 + id * 67.5) % 360,
    ...fields,
  };
  reg.set(id, f);
  return f;
}

/** The unnamed-gods folk faith of a culture (lazily created). */
export function folkFaithOf(world, cultureId) {
  const cul = getCulture(world, cultureId);
  if (!cul) return null;
  if (cul.folkFaithId != null && cul.folkFaithId >= 0) return getFaith(world, cul.folkFaithId);
  const lang = languageOf(cul);
  const f = newFaith(world, {
    kind: "folk", cultureId,
    name: lang.word(hash32("folkfaith", cultureId) % 100000),
  });
  cul.folkFaithId = f.id;
  // folk faiths are a background hum, not an event — history starts caring
  // when religion organizes.
  return f;
}

export function dominantFaith(s) {
  return s.faithMix && s.faithMix.length ? s.faithMix[0][0] : -1;
}

const MIX_K = 4;
function normalizeMix(mix) {
  mix.sort((a, b) => b[1] - a[1]);
  if (mix.length > MIX_K) {
    let tail = 0;
    for (let i = MIX_K; i < mix.length; i++) tail += mix[i][1];
    mix.length = MIX_K;
    mix[0][1] += tail;
  }
  let sum = 0;
  for (const e of mix) sum += e[1];
  if (sum > 0 && Math.abs(sum - 1) > 1e-9) for (const e of mix) e[1] /= sum;
}
function mixFaithToward(s, fid, frac) {
  if (fid == null || fid < 0 || !(frac > 0)) return;
  if (!s.faithMix) s.faithMix = [];
  if (!s.faithMix.length) { s.faithMix = [[fid, 1]]; return; }
  const mix = s.faithMix, scale = 1 - frac;
  let entry = null;
  for (const e of mix) { e[1] *= scale; if (e[0] === fid) entry = e; }
  if (entry) entry[1] += frac; else mix.push([fid, frac]);
  normalizeMix(mix);
}

export function updateFaiths(world) {
  const rng = passRng(world, "religion");
  const byId = world._byId;

  // 1. seed empty mixtures from the people's folk faith (newborns, first pass)
  for (const s of world.settlements) {
    if (s.mode !== "settled") continue;
    if (s.faithMix && s.faithMix.length) continue;
    const cul = dominantCulture(s);
    if (cul < 0) continue;
    const folk = folkFaithOf(world, cul);
    if (folk) s.faithMix = [[folk.id, 1]];
  }

  // 2. organized genesis: a literate town's mysteries become a church.
  // Rare and rate-limited — at most one new movement per pass world-wide,
  // and a culture that just organized one doesn't immediately spawn another
  // (the niche is taken; later movements arrive as SCHISMS instead).
  let genesisDone = false;
  for (const s of world.settlements) {
    if (genesisDone) break;
    if (s.mode !== "settled" || (s.tier | 0) < 1) continue;
    const org = (s.knowledge && s.knowledge.organization) || 0;
    if (org < ORGANIZED_ORG_MIN || (s.people || 0) < ORGANIZED_POP_MIN) continue;
    const df = getFaith(world, dominantFaith(s));
    if (df && df.kind === "organized") continue;          // already converted
    const culId = dominantCulture(s);
    const cul = getCulture(world, culId);
    if (!cul) continue;
    if (world.step - (cul._lastFaithGenesis ?? -Infinity) < GENESIS_CULTURE_COOLDOWN / (world._dt || 1)) continue;
    // an organized faith already knocking on the door? let conversion work
    let orgNearby = false;
    if (s._tradeReach && byId) {
      for (const pid of s._tradeReach.keys()) {
        const peer = byId.get(typeof pid === "number" ? pid : +pid);
        const pf = peer && getFaith(world, dominantFaith(peer));
        if (pf && pf.kind === "organized") { orgNearby = true; break; }
      }
    }
    if (orgNearby) continue;
    if (rng() > GENESIS_CHANCE) continue;
    const lang = languageOf(cul);
    const f = newFaith(world, {
      kind: "organized", cultureId: culId,
      originSettlementId: s.id,
      parentFaithId: dominantFaith(s),
      name: lang.word(hash32("faith", s.id, world.step) % 1000000),
    });
    mixFaithToward(s, f.id, 0.9);                         // the movement sweeps its birthplace
    cul._lastFaithGenesis = world.step;
    genesisDone = true;
    logEvent(world, "faith.founded", {
      faith: f.id, faithName: f.name, s: s.id, sName: s.name,
      polity: s.countryId, culture: culId,
      x: s.pos.x | 0, y: s.pos.y | 0,
    });
  }

  // 3. spread along the trade graph + state pressure
  //    (computed against the PRE-pass dominant faiths, applied after)
  const pulls = [];
  for (const s of world.settlements) {
    if (s.mode !== "settled" || !s.faithMix || !s.faithMix.length) continue;
    const own = dominantFaith(s);
    const pull = new Map();
    const addPull = (fid, w) => { if (fid >= 0 && fid !== own) pull.set(fid, (pull.get(fid) || 0) + w); };
    const weighPeer = (peer) => {
      if (!peer || peer.mode !== "settled") return;
      const pf = dominantFaith(peer);
      const f = getFaith(world, pf);
      if (!f) return;
      let w = f.kind === "organized" ? ORGANIZED_PULL : FOLK_PULL;
      if (peer.countryId === s.countryId && s.countryId >= 0) w *= 1.4;
      addPull(pf, w);
    };
    if (s._tradeReach && byId) for (const pid of s._tradeReach.keys()) weighPeer(byId.get(typeof pid === "number" ? pid : +pid));
    if (s._seaReach && byId) for (const pid of s._seaReach.keys()) weighPeer(byId.get(typeof pid === "number" ? pid : +pid));
    if (s.countryId >= 0) {
      const p = getPolity(world, s.countryId);
      if (p && p.faithId >= 0) {
        const f = getFaith(world, p.faithId);
        if (f && f.kind === "organized") addPull(p.faithId, STATE_PRESSURE);
      }
    }
    if (!pull.size) continue;
    let best = -1, bw = 0;
    for (const [fid, w] of pull) if (w > bw) { bw = w; best = fid; }
    if (best >= 0) pulls.push([s, best, Math.min(0.5, bw / 3)]);
  }
  for (const [s, fid, str] of pulls) mixFaithToward(s, fid, SPREAD_RATE * str * 3);

  // 4. state adoption + legitimacy coupling
  if (world.countries) {
    for (const c of world.countries.values()) {
      const p = getPolity(world, c.id);
      if (!p || !c.capital) continue;
      const capFaith = dominantFaith(c.capital);
      const f = getFaith(world, capFaith);
      if (f && f.kind === "organized" && p.faithId !== capFaith) {
        p.faithId = capFaith;
        // Chronicle a conversion only when it STICKS as something new — a
        // court flip-flopping with its capital's mixture isn't a story beat.
        if (!p._faithsHeld) p._faithsHeld = [];
        if (!p._faithsHeld.includes(capFaith)) {
          p._faithsHeld.push(capFaith);
          if (p._faithsHeld.length > 8) p._faithsHeld.shift();
          logEvent(world, "polity.adoptedFaith", {
            polity: c.id, name: p.name, faith: capFaith, faithName: f.name,
          });
        }
      }
      // legitimacy: members sharing the state faith hold a little tighter
      if (p.faithId >= 0) {
        for (const m of c.members) {
          if (m.id === c.capitalId) continue;
          const mf = dominantFaith(m);
          if (mf === p.faithId) m.loyalty = Math.min(1, (m.loyalty ?? 1) + LOYAL_MATCH);
          else {
            const mff = getFaith(world, mf);
            if (mff && mff.kind === "organized") m.loyalty = Math.max(0, (m.loyalty ?? 1) - LOYAL_CLASH);
          }
        }
      }
    }
  }

  // 5. schism: a follower-realm far from the founding see breaks communion
  for (const f of faithsOf(world).values()) {
    if (f.kind !== "organized") continue;
    if (world.step - f.foundedStep < SCHISM_MIN_AGE / (world._dt || 1)) continue;
    const origin = byId && byId.get(f.originSettlementId);
    if (!origin) continue;
    if (!world.countries) continue;
    for (const c of world.countries.values()) {
      const p = getPolity(world, c.id);
      if (!p || p.faithId !== f.id || !c.capital) continue;
      if (origin.countryId === c.id) continue;            // the home realm itself
      let dx = Math.abs(c.capital.pos.x - origin.pos.x);
      if (dx > world.tw / 2) dx = world.tw - dx;
      const dy = c.capital.pos.y - origin.pos.y;
      if (Math.sqrt(dx * dx + dy * dy) < SCHISM_MIN_DIST) continue;
      const r = entityRng(world, "schism", hash32(f.id, c.id, world.step));
      if (r() > SCHISM_CHANCE) continue;
      const culId = dominantCulture(c.capital);
      const cul = getCulture(world, culId);
      const lang = cul ? languageOf(cul) : null;
      const nf = newFaith(world, {
        kind: "organized", cultureId: culId,
        originSettlementId: c.capital.id, parentFaithId: f.id,
        name: lang ? lang.word(hash32("schism", f.id, c.id) % 1000000) : (f.name + " Rite"),
      });
      mixFaithToward(c.capital, nf.id, 0.7);
      p.faithId = nf.id;
      logEvent(world, "faith.schism", {
        faith: nf.id, faithName: nf.name, parentFaith: f.id, parentName: f.name,
        polity: c.id, name: p.name, s: c.capital.id, sName: c.capital.name,
      });
      break;   // at most one schism per faith per pass
    }
  }
}

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
import { getCulture, languageOf, dominantCulture, familyOf, folkAnchorOf } from "./cultures.js";
import { faithShapePersonality } from "./personality.js";
import { forEachNear } from "./spatialGrid.js";
import { langWord } from "../language.js";

// ── Timing: an AXIAL AGE, then bounded branching (the real pattern) ──
// Real religious history isn't a flat trickle. Organized faith is impossible
// in the neolithic (no cities, no writing, no priesthood), then bursts in a
// WINDOW once civilisations urbanise and become literate — the Axial Age, when
// Zoroaster, the Hebrew prophets, the Buddha, Mahavira, Confucius, Laozi, the
// Greek philosophers (and later Christianity, Mani, Islam) all arose across the
// literate world within a few centuries, amid cities, trade, and social stress.
// AFTER that window, from-scratch foundings become rare; new major religions
// arrive mostly by SCHISM/reform of existing ones (Orthodox/Catholic/Protestant,
// Sunni/Shia, Theravada/Mahayana) and occasionally by SYNCRETISM (a blend of two
// — Sikhism, Manichaeism). Meanwhile most faiths DIE, absorbed by larger ones,
// so the count plateaus instead of exploding. This file models all four:
// founding (front-loaded, saturating), schism (bounded), syncretism, and cull.
export const FAITH_INTERVAL = 150;       // cadence (≈ polity/culture passes)
const ORGANIZED_ORG_MIN = 0.26;          // organization floor for a priesthood (opens the axial window)
const ORGANIZED_POP_MIN = 450;           // a movement needs a real town
const GENESIS_BASE = 0.11;               // base per-eligible-city founding rate (scaled by urbanisation × stress × open niche)
const GENESIS_CULTURE_COOLDOWN = 1500;   // min ticks between new faiths within one PEOPLE
const MAX_FOUNDINGS_PER_PASS = 3;        // the window bursts, but not a single-tick flood
const SPREAD_RATE = 0.055;               // per-pass share shift toward the pulling faith
const STATE_PRESSURE = 2.4;              // extra pull weight of the ruler's faith
const ORGANIZED_PULL = 2.2;              // organized faiths proselytize; folk faiths don't travel
const FOLK_PULL = 0.45;
const CONFORMITY = 2.1;                  // in-group pull a settlement exerts toward its OWN faith, ∝ how dominant it already is — makes a unit CONSOLIDATE to one creed (real settlements are ~homogeneous; only nations span faiths) rather than resting at a 50/50 border mix
const MIX_FLOOR = 0.05;                  // drop faith shares below this so a consolidated settlement reads as single-faith
// Branching (schism) — bounded so the late game doesn't fission exponentially.
const SCHISM_MIN_REALMS = 3;             // only a faith spanning several realms can schism
const SCHISM_MIN_AGE = 3000;             // a young faith doesn't schism
const SCHISM_CHANCE = 0.05;              // base per distant follower-realm per pass (then strongly damped)
const SCHISM_MIN_DIST = 95;              // map distance from origin see (tiles)
const MAX_BRANCHES_PER_ROOT = 6;         // a religion fissions into a few great branches, not endlessly
const SCHISM_ROOT_COOLDOWN = 1400;       // min ticks between schisms within one religion family
const MAX_SCHISMS_PER_PASS = 2;          // global brake on late-game fissioning
// Syncretism — a new faith born where two organized creeds deeply mix.
const SYNCRETISM_WORLD_COOLDOWN = 5000;  // genuinely-new blended religions are rare
const SYNCRETISM_MIN_SHARE = 0.30;       // each parent must hold this share in the meeting-place
// Cull — a faith with almost no followers and no state fades (the long tail of
// dead cults that consolidation erases), so the total count stays bounded.
const CULL_GRACE = 2600;                 // a young faith is spared the cull
const CULL_FLOOR = 2;                    // fewer dominant settlements than this → at risk
const LOYAL_MATCH = 0.0012;              // per-pass loyalty nudge for shared faith
const LOYAL_CLASH = 0.0022;              // per-pass loyalty bleed under a rival organized faith

export function faithsOf(world) {
  return world.faiths || (world.faiths = new Map());
}
export function getFaith(world, id) {
  return id != null && id >= 0 && world.faiths ? world.faiths.get(id) || null : null;
}

// ── Doctrine: a faith's PERSONALITY ───────────────────────────────────
// Six 0..1 axes that classify real creeds: militancy (holy war vs quietism),
// zeal (missionary drive), syncretism (absorbs others vs exclusive truth),
// hierarchy (organized clergy vs diffuse mysticism), asceticism (renunciation
// vs festival), worldliness (engaged with trade/state vs otherworldly).
// Rolled at founding, MUTATED at schism (a reform is usually sterner), and
// DRIFTING with lived experience (a church whose realms are forever at war
// hardens; one spread by merchants grows worldly).
export const DOCTRINE_KEYS = ["militancy", "zeal", "syncretism", "hierarchy", "asceticism", "worldliness"];
function rollDoctrine(world, id, kind, parent) {
  const r = entityRng(world, "doctrine", id);
  // mutation only inherits from an ORGANIZED parent (a schism); a movement
  // organizing out of folk practice is a fresh roll, not a folk clone
  if (parent && parent.doctrine && parent.kind === "organized") {
    // schism: the parent's creed, sharpened — reforms skew sterner
    const d = {};
    for (const k of DOCTRINE_KEYS) d[k] = Math.max(0, Math.min(1, parent.doctrine[k] + (r() - 0.45) * 0.5));
    if (r() < 0.5) d.asceticism = Math.min(1, d.asceticism + 0.2);
    return d;
  }
  if (kind === "folk") return { militancy: 0.12, zeal: 0.08, syncretism: 0.75, hierarchy: 0.08, asceticism: 0.3, worldliness: 0.4 };
  return {
    militancy: r() * r(),                       // most creeds mild, a few fierce
    zeal: 0.3 + r() * 0.7,                      // organizing implies reach
    syncretism: r(),
    hierarchy: 0.4 + r() * 0.6,                 // a church has clergy
    asceticism: r(),
    worldliness: r(),
  };
}
export function doctrineLabel(f) {
  if (!f.doctrine) return f.kind;
  const d = f.doctrine;
  const traits = [];
  if (d.militancy > 0.6) traits.push("militant"); else if (d.militancy < 0.15 && d.asceticism > 0.5) traits.push("quietist");
  if (d.zeal > 0.7) traits.push("missionary");
  if (d.syncretism > 0.65) traits.push("syncretic"); else if (d.syncretism < 0.25) traits.push("exclusivist");
  if (d.asceticism > 0.7) traits.push("ascetic");
  if (d.worldliness > 0.7) traits.push("worldly");
  if (!traits.length) traits.push(d.hierarchy > 0.5 ? "orthodox" : "mystical");
  return traits.slice(0, 2).join(", ");
}

// ── Faith ↔ temperament bridge ─────────────────────────────────────────
// A creed's doctrine maps onto the SAME outward-drive axes a realm/people carries
// (personality.js: aggression, commerce, expansionism). This shared space is what
// lets a religion (a) be BORN in its founder's image — an expansionist people
// coins a missionary, highly-spreadable faith; (b) APPEAL to congenial peoples,
// so it spreads fastest among hosts whose character matches it; and (c) SHAPE its
// adherents, bending a realm that adopts it toward its own temperament. The most
// contagious creeds still spread broadest (zeal drives the base pull); affinity
// only sorts them to the peoples they fit, and feedback makes the fit deepen.
function fClamp(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }
function fClamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }

// Doctrine → the −1..1 temperament a faith expresses (and instils in its realms).
// Centred so a typical organized creed lands near neutral; the extremes (a fierce
// missionary church, an ascetic world-renouncing order) read strongly.
export function faithTemperament(d) {
  if (!d) return { aggression: 0, commerce: 0, expansionism: 0 };
  const excl = 0.5 - (d.syncretism ?? 0.5);                                         // exclusivist (+) vs syncretic (−)
  return {
    aggression:   fClamp((d.militancy - 0.4) * 1.4 + excl * 0.6, -1, 1),            // holy war + exclusivity → warlike
    commerce:     fClamp((d.worldliness - 0.45) * 1.2 - (d.asceticism - 0.4) * 0.8, -1, 1),  // engaged − renunciation → mercantile
    expansionism: fClamp((d.zeal - 0.5) * 1.4 - (d.asceticism - 0.35) * 0.7, -1, 1),         // missionary − renunciation → outward
  };
}

// How strongly a faith of temperament `ft` APPEALS to a people of personality
// `pp` — the dot of the two temperaments mapped to a spread multiplier. A creed
// matched to its host (a militant faith reaching a warlike realm, an ascetic one
// reaching an insular people) pulls harder; a mismatch is resisted. Bland faiths
// or peoples (near 0 on every axis) barely care — only pronounced characters
// sort, which is exactly the intent.
const AFFINITY_W = 0.9;
function affinityMul(ft, pp) {
  if (!ft || !pp) return 1;
  const align = ft.aggression * (pp.aggression || 0)
              + ft.commerce * (pp.commerce || 0)
              + ft.expansionism * (pp.expansionism || 0);
  return fClamp(1 + AFFINITY_W * align, 0.4, 2.0);   // a well-matched creed pulls up to 2×, a clashing one down to 0.4×
}

// Born in the founder's image: nudge a freshly-rolled doctrine toward the founding
// people's temperament — an EXPANSIONIST people coins a high-ZEAL (spreadable)
// creed, a warlike one a MILITANT creed, a merchant one a WORLDLY creed, an inward
// one a renunciatory, low-reach faith. (The user's "make an expansionist people
// have a highly spreadable religion.") A gentle bias ON TOP of the random roll, so
// founders of the same temperament still produce distinct creeds.
function biasDoctrineToFounder(d, pp) {
  if (!d || !pp) return d;
  d.zeal        = fClamp01(d.zeal        + (pp.expansionism || 0) * 0.32);
  d.militancy   = fClamp01(d.militancy   + (pp.aggression   || 0) * 0.34);
  d.worldliness = fClamp01(d.worldliness + (pp.commerce     || 0) * 0.26);
  if ((pp.expansionism || 0) < 0) d.asceticism = fClamp01(d.asceticism - pp.expansionism * 0.24);  // inward founder → renunciatory creed
  return d;
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
  const parent = getFaith(world, f.parentFaithId);
  f.doctrine = f.doctrine || rollDoctrine(world, id, f.kind, parent);
  // rootFaithId: the religion FAMILY a creed belongs to. A schism keeps its
  // parent's root (Protestantism is still of the Christian root); a de-novo
  // founding or a syncretic blend starts a NEW root. Lets us bound how many
  // branches one religion fissions into.
  f.rootFaithId = (f.kind === "organized" && parent && parent.kind === "organized" && !f.syncretic)
    ? (parent.rootFaithId ?? parent.id) : f.id;
  f.endedStep = -1;
  reg.set(id, f);
  return f;
}

/** The folk faith a people practises — shared up the lineage to the first
 *  divergence "anchor" (folkAnchorOf): near dialects share a broad ancestral
 *  religion, but a deeply-diverged or independent people has its own gods. */
export function folkFaithOf(world, cultureId) {
  const anchorId = folkAnchorOf(world, cultureId);
  const cul = getCulture(world, anchorId);
  if (!cul) return null;
  if (cul.folkFaithId != null && cul.folkFaithId >= 0) return getFaith(world, cul.folkFaithId);
  const lang = languageOf(world, cul);
  const f = newFaith(world, {
    kind: "folk", cultureId: anchorId,
    name: langWord(lang, hash32("folkfaith", anchorId) % 100000),
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
  // drop negligible tails so a settlement that has consolidated reads as a single
  // faith rather than carrying a permanent 1-2% ghost minority.
  while (mix.length > 1 && mix[mix.length - 1][1] < MIX_FLOOR) mix.pop();
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

  // 2. organized genesis — the AXIAL WAVE. A prophet's movement crystallises
  // in a literate, urban, STRESSED city whose PEOPLE haven't yet found an
  // organized faith. This is front-loaded by construction: many cities cross
  // the literacy floor together as the classical era dawns, so a burst of
  // foundings appears in that window; then the niche SATURATES (most of each
  // people already follows an organized creed) and foundings taper to the rare
  // reformer. No serial world-cooldown — overlapping faiths can be born in one
  // age, as they were in India and the Mediterranean.
  //
  // Per-family saturation: once a stock's population mostly follows organized
  // religion, the appetite for a brand-new revelation there is largely spent.
  const famTotal = new Map(), famOrg = new Map();
  for (const s of world.settlements) {
    if (s.mode !== "settled") continue;
    const cid = dominantCulture(s); if (cid < 0) continue;
    const fam = familyOf(world, cid);
    famTotal.set(fam, (famTotal.get(fam) || 0) + 1);
    const df0 = getFaith(world, dominantFaith(s));
    if (df0 && df0.kind === "organized") famOrg.set(fam, (famOrg.get(fam) || 0) + 1);
  }
  let founded = 0;
  for (const s of world.settlements) {
    if (founded >= MAX_FOUNDINGS_PER_PASS) break;
    if (s.mode !== "settled" || (s.tier | 0) < 1) continue;
    const org = (s.knowledge && s.knowledge.organization) || 0;
    if (org < ORGANIZED_ORG_MIN || (s.people || 0) < ORGANIZED_POP_MIN) continue;
    const df = getFaith(world, dominantFaith(s));
    if (df && df.kind === "organized") continue;          // already an organized-faith city
    const culId = dominantCulture(s);
    const cul = getCulture(world, culId);
    if (!cul) continue;
    if (world.step - (cul._lastFaithGenesis ?? -Infinity) < GENESIS_CULTURE_COOLDOWN / (world._dt || 1)) continue;
    const fam = familyOf(world, culId);
    const sat = (famOrg.get(fam) || 0) / Math.max(1, famTotal.get(fam) || 1);   // open niche → 0, saturated → 1
    // Social stress fertilises new religion (cities, inequality, war, plague,
    // famine — the "religions of the oppressed"). Urbanisation raises the odds
    // a great city is the cradle.
    const p = s.countryId >= 0 ? getPolity(world, s.countryId) : null;
    const c = s.countryId >= 0 && world.countries ? world.countries.get(s.countryId) : null;
    const stress = 0.4 + (s.unrest || 0)
      + (c && (c._fronts || 0) > 0 ? 0.3 : 0)
      + (world.step < (s._famineUntil || 0) ? 0.3 : 0)
      + (s._plagueActive ? 0.3 : 0);
    const urban = 0.5 + Math.min(1.1, Math.max(0, Math.log10((s.people || 1) / 300)));
    const prob = GENESIS_BASE * urban * stress * (1 - 0.5 * sat);
    if (rng() > prob) continue;
    const lang = languageOf(world, cul);
    const f = newFaith(world, {
      kind: "organized", cultureId: culId,
      originSettlementId: s.id,
      parentFaithId: dominantFaith(s),
      name: langWord(lang, hash32("faith", s.id, world.step) % 1000000),
    });
    if (c && c.personality) biasDoctrineToFounder(f.doctrine, c.personality);   // born in the founding realm's image
    mixFaithToward(s, f.id, 0.9);                         // the movement sweeps its birthplace
    cul._lastFaithGenesis = world.step;
    famOrg.set(fam, (famOrg.get(fam) || 0) + 1);          // this people is now a touch more saturated
    founded++;
    logEvent(world, "faith.founded", {
      faith: f.id, faithName: f.name, s: s.id, sName: s.name,
      polity: p ? p.id : s.countryId, culture: culId, character: doctrineLabel(f),
      x: s.pos.x | 0, y: s.pos.y | 0,
    });
  }

  // 3. spread along the trade graph + state pressure
  //    (computed against the PRE-pass dominant faiths, applied after)
  // Network effect: an established church out-pulls a sect — conversion begets
  // conversion, so faiths consolidate into a few broad communions (the
  // peoples-scale spreads of real history) instead of a patchwork of village rites.
  const followers = new Map();
  for (const s of world.settlements) {
    if (s.mode !== "settled") continue;
    const df0 = dominantFaith(s);
    if (df0 >= 0) followers.set(df0, (followers.get(df0) || 0) + 1);
  }
  const sizePull = (fid) => 0.55 + Math.min(1.6, Math.sqrt(followers.get(fid) || 0) / 7);
  // memoised faith → temperament, for the affinity multiplier (one per faith per pass)
  const ftCache = new Map();
  const ftOf = (fid) => {
    let t = ftCache.get(fid);
    if (t === undefined) { const f = getFaith(world, fid); t = f && f.doctrine ? faithTemperament(f.doctrine) : null; ftCache.set(fid, t); }
    return t;
  };
  const pulls = [];
  for (const s of world.settlements) {
    if (s.mode !== "settled" || !s.faithMix || !s.faithMix.length) continue;
    const own = dominantFaith(s);
    // The RECEIVING people's character: a creed that suits them converts them
    // faster, one that grates on them slower (affinity). Stateless → neutral.
    const rc = s.countryId >= 0 && world.countries ? world.countries.get(s.countryId) : null;
    const recvPers = rc ? rc.personality : null;
    const pull = new Map();
    // own faith is NOT excluded: same-faith neighbours and the state reinforce the
    // local majority, which (with the conformity term below) lets a settlement
    // consolidate to one creed instead of oscillating about a border 50/50.
    const addPull = (fid, w) => { if (fid >= 0) pull.set(fid, (pull.get(fid) || 0) + w); };
    const weighPeer = (peer) => {
      if (!peer || peer.mode !== "settled") return;
      const pf = dominantFaith(peer);
      const f = getFaith(world, pf);
      if (!f) return;
      let w = f.kind === "organized" ? ORGANIZED_PULL * (0.5 + (f.doctrine ? f.doctrine.zeal : 0.5)) * sizePull(pf) : FOLK_PULL;
      if (peer.countryId === s.countryId && s.countryId >= 0) w *= 1.4;
      w *= affinityMul(ftOf(pf), recvPers);              // a faith appeals more to a congenial people
      addPull(pf, w);
    };
    if (s._tradeReach && byId) for (const pid of s._tradeReach.keys()) weighPeer(byId.get(typeof pid === "number" ? pid : +pid));
    if (s._seaReach && byId) for (const pid of s._seaReach.keys()) weighPeer(byId.get(typeof pid === "number" ? pid : +pid));
    // word also travels on foot: near neighbours convert even off the trade map
    forEachNear(world, s.pos.x, s.pos.y, 11, (nb) => { if (nb !== s) weighPeer(nb); });
    if (s.countryId >= 0) {
      const p = getPolity(world, s.countryId);
      if (p && p.faithId >= 0) {
        const f = getFaith(world, p.faithId);
        if (f && f.kind === "organized") addPull(p.faithId, STATE_PRESSURE * (0.6 + 0.8 * (f.doctrine ? f.doctrine.zeal : 0.5)) * affinityMul(ftOf(p.faithId), recvPers));
      }
    }
    // In-group conformity: the settlement's own creed pulls toward itself in
    // proportion to how dominant it already is — a clear majority snowballs to
    // homogeneity, a near-tie stays contested and can still flip to a stronger
    // neighbour/state faith. This is what tips a unit to ONE faith.
    if (own >= 0) pull.set(own, (pull.get(own) || 0) + CONFORMITY * s.faithMix[0][1]);
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
        const sf = getFaith(world, p.faithId);
        const sd = sf && sf.doctrine ? sf.doctrine : null;
        for (const m of c.members) {
          if (m.id === c.capitalId) continue;
          const mf = dominantFaith(m);
          if (mf === p.faithId) m.loyalty = Math.min(1, (m.loyalty ?? 1) + LOYAL_MATCH * (sd ? 0.5 + sd.hierarchy : 1));
          else {
            const mff = getFaith(world, mf);
            if (mff && mff.kind === "organized") {
              // a militant state church bears down on rival creeds; a
              // syncretic minority bends rather than breaks
              const md = mff.doctrine || {};
              const press = (sd ? 0.4 + 1.2 * sd.militancy : 1) * (1 - 0.7 * (md.syncretism || 0));
              m.loyalty = Math.max(0, (m.loyalty ?? 1) - LOYAL_CLASH * press);
            }
          }
        }
        // faith → temperament: the established state creed slowly bends the
        // realm's character toward its own (militant→warlike, missionary→
        // expansionist, ascetic/world-renouncing→insular). Reversible — balanced
        // by each realm's mean-reverting drift toward its intrinsic anchor.
        if (sf && sf.kind === "organized" && sd) faithShapePersonality(world, c, faithTemperament(sd));
      }
    }
  }

  // 4½. doctrine drift: a church learns from the lives of its realms —
  // congregations forever at war harden; peaceful trading flocks grow worldly
  if (world.countries) {
    const warByFaith = new Map(), pcByFaith = new Map();
    for (const c of world.countries.values()) {
      const p = getPolity(world, c.id);
      if (!p || p.faithId < 0) continue;
      pcByFaith.set(p.faithId, (pcByFaith.get(p.faithId) || 0) + 1);
      if ((c._fronts || 0) > 0) warByFaith.set(p.faithId, (warByFaith.get(p.faithId) || 0) + 1);
    }
    for (const [fid, n] of pcByFaith) {
      const f = getFaith(world, fid);
      if (!f || !f.doctrine || f.kind !== "organized") continue;
      const warFrac = (warByFaith.get(fid) || 0) / n;
      f.doctrine.militancy = Math.max(0, Math.min(1, f.doctrine.militancy + (warFrac - 0.25) * 0.01));
      if (warFrac < 0.1) f.doctrine.worldliness = Math.min(1, f.doctrine.worldliness + 0.004);
    }
  }

  // 5. schism: BRANCHING, bounded. A communion fissions when a follower-realm
  // far from the founding see (and estranged by war or a broken succession)
  // breaks away — but each religion fissions into only a FEW great branches,
  // the rate decays sharply as branches accumulate, and a global per-pass brake
  // stops the late game from fissioning exponentially. (This is the dominant
  // source of NEW major faiths after the axial window — the Reformation, the
  // Sunni/Shia split, the Buddhist vehicles.)
  if (world.countries) {
    // living branch count per religion family, and realm-span per faith
    const branches = new Map(), span = new Map();
    for (const f of faithsOf(world).values()) {
      if (f.kind !== "organized" || f.endedStep >= 0) continue;
      branches.set(f.rootFaithId, (branches.get(f.rootFaithId) || 0) + 1);
    }
    for (const c of world.countries.values()) {
      const p0 = getPolity(world, c.id);
      if (p0 && p0.faithId >= 0) span.set(p0.faithId, (span.get(p0.faithId) || 0) + 1);
    }
    let schisms = 0;
    if (!world._schismAt) world._schismAt = new Map();
    for (const f of faithsOf(world).values()) {
      if (schisms >= MAX_SCHISMS_PER_PASS) break;
      if (f.kind !== "organized" || f.endedStep >= 0) continue;
      if (world.step - f.foundedStep < SCHISM_MIN_AGE / (world._dt || 1)) continue;
      if ((span.get(f.id) || 0) < SCHISM_MIN_REALMS) continue;
      const nBranch = branches.get(f.rootFaithId) || 1;
      if (nBranch >= MAX_BRANCHES_PER_ROOT) continue;     // this religion has fissioned enough
      const lastRoot = world._schismAt.get(f.rootFaithId) ?? -Infinity;
      if (world.step - lastRoot < SCHISM_ROOT_COOLDOWN / (world._dt || 1)) continue;
      const origin = byId && byId.get(f.originSettlementId);
      if (!origin) continue;
      // chance decays strongly with how many branches already exist
      const damp = Math.pow(nBranch, 1.4);
      const hierMul = 1.2 - 0.8 * (f.doctrine ? f.doctrine.hierarchy : 0.5);
      for (const c of world.countries.values()) {
        if (schisms >= MAX_SCHISMS_PER_PASS) break;
        const p = getPolity(world, c.id);
        if (!p || p.faithId !== f.id || !c.capital) continue;
        if (origin.countryId === c.id) continue;
        let dx = Math.abs(c.capital.pos.x - origin.pos.x);
        if (dx > world.tw / 2) dx = world.tw - dx;
        const dy = c.capital.pos.y - origin.pos.y;
        if (Math.sqrt(dx * dx + dy * dy) < SCHISM_MIN_DIST) continue;
        // a real estrangement helps light the reform: war or a failed throne
        const estranged = (c._fronts || 0) > 0 || (p._crisisAt != null && world.step - p._crisisAt < 1200 / (world._dt || 1));
        const trigger = estranged ? 1 : 0.45;
        const r = entityRng(world, "schism", hash32(f.id, c.id, world.step));
        if (r() > (SCHISM_CHANCE / damp) * hierMul * trigger) continue;
        const culId = dominantCulture(c.capital);
        const cul = getCulture(world, culId);
        const lang = cul ? languageOf(world, cul) : null;
        const nf = newFaith(world, {
          kind: "organized", cultureId: culId,
          originSettlementId: c.capital.id, parentFaithId: f.id,
          name: lang ? langWord(lang, hash32("schism", f.id, c.id) % 1000000) : (f.name + " Rite"),
        });
        if (c.personality) biasDoctrineToFounder(nf.doctrine, c.personality);   // the breakaway realm's character colours its reform
        mixFaithToward(c.capital, nf.id, 0.7);
        p.faithId = nf.id;
        world._schismAt.set(f.rootFaithId, world.step);
        branches.set(f.rootFaithId, nBranch + 1);
        schisms++;
        logEvent(world, "faith.schism", {
          faith: nf.id, faithName: nf.name, parentFaith: f.id, parentName: f.name,
          character: doctrineLabel(nf),
          polity: c.id, name: p.name, s: c.capital.id, sName: c.capital.name,
        });
        break;   // at most one schism per faith per pass
      }
    }
  }

  // 6. syncretism: a genuinely NEW religion born where two organized creeds
  // deeply intermingle — a great trade city, a long-held borderland — and a
  // prophet fuses them (Sikhism from Hindu + Muslim, Manichaeism from
  // Zoroastrian + Christian + Buddhist). Rare; starts its own root lineage.
  if (world.step - (world._lastSyncretismAt ?? -Infinity) >= SYNCRETISM_WORLD_COOLDOWN / (world._dt || 1)) {
    for (const s of world.settlements) {
      if (s.mode !== "settled" || (s.tier | 0) < 2 || !s.faithMix || s.faithMix.length < 2) continue;
      const [a, b] = s.faithMix;
      if (a[1] < SYNCRETISM_MIN_SHARE || b[1] < SYNCRETISM_MIN_SHARE) continue;
      const fa = getFaith(world, a[0]), fb = getFaith(world, b[0]);
      if (!fa || !fb || fa.kind !== "organized" || fb.kind !== "organized") continue;
      if (fa.rootFaithId === fb.rootFaithId) continue;     // same religion family — that's a schism, not a fusion
      const r = entityRng(world, "syncretism", hash32(s.id, world.step));
      if (r() > 0.5) continue;
      const culId = dominantCulture(s);
      const cul = getCulture(world, culId);
      const lang = cul ? languageOf(world, cul) : null;
      const doctrine = {};
      for (const k of DOCTRINE_KEYS) doctrine[k] = Math.max(0, Math.min(1, ((fa.doctrine[k] + fb.doctrine[k]) / 2) + (r() - 0.5) * 0.2));
      doctrine.syncretism = Math.max(doctrine.syncretism, 0.7);   // a fusion is, by nature, syncretic
      const nf = newFaith(world, {
        kind: "organized", cultureId: culId, syncretic: true, doctrine,
        originSettlementId: s.id, parentFaithId: a[0], parentFaith2: b[0],
        name: lang ? langWord(lang, hash32("syncretism", s.id) % 1000000) : (fa.name + "-" + fb.name),
      });
      const sc = s.countryId >= 0 && world.countries ? world.countries.get(s.countryId) : null;
      if (sc && sc.personality) biasDoctrineToFounder(nf.doctrine, sc.personality);   // born in the meeting-realm's image
      mixFaithToward(s, nf.id, 0.8);
      world._lastSyncretismAt = world.step;
      logEvent(world, "faith.syncretized", {
        faith: nf.id, faithName: nf.name, parentFaith: a[0], parentName: fa.name,
        parent2Name: fb.name, character: doctrineLabel(nf),
        polity: s.countryId, s: s.id, sName: s.name, x: s.pos.x | 0, y: s.pos.y | 0,
      });
      break;   // one fusion per pass at most
    }
  }

  // 7. cull: the long tail of dying cults. A faith older than its grace period
  // with almost no dominant settlements and no state patron FADES — its last
  // adherents reabsorbed by the locally dominant faith. This is the bounding
  // force that stops the count growing without limit (consolidation erases the
  // thousands of antique cults down to a handful of world religions).
  {
    const dom = new Map(), stateFaiths = new Set();
    for (const s of world.settlements) {
      if (s.mode !== "settled") continue;
      const d = dominantFaith(s); if (d >= 0) dom.set(d, (dom.get(d) || 0) + 1);
    }
    if (world.countries) for (const c of world.countries.values()) {
      const p = getPolity(world, c.id); if (p && p.faithId >= 0) stateFaiths.add(p.faithId);
    }
    for (const f of faithsOf(world).values()) {
      if (f.kind !== "organized" || f.endedStep >= 0) continue;
      if (world.step - f.foundedStep < CULL_GRACE / (world._dt || 1)) continue;
      if ((dom.get(f.id) || 0) >= CULL_FLOOR || stateFaiths.has(f.id)) continue;
      // fade it: strip from every mixture, let the rest renormalise
      for (const s of world.settlements) {
        if (!s.faithMix || !s.faithMix.length) continue;
        const before = s.faithMix.length;
        s.faithMix = s.faithMix.filter(e => e[0] !== f.id);
        if (s.faithMix.length !== before) {
          if (!s.faithMix.length) { const folk = folkFaithOf(world, dominantCulture(s)); if (folk) s.faithMix = [[folk.id, 1]]; }
          else normalizeMix(s.faithMix);
        }
      }
      f.endedStep = world.step | 0;
      logEvent(world, "faith.faded", { faith: f.id, faithName: f.name, character: doctrineLabel(f) });
    }
  }
}

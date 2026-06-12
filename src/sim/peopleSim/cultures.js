// ── Cultures: peoples as persistent entities ──
//
// A culture is a people — a named identity with its own naming language,
// carried BY population. Settlements hold a top-k culture MIXTURE
// (s.culMix = [[cultureId, share], ...], shares summing to 1, dominant
// first) so conquest does not change who lives somewhere: a captured city
// keeps its people, and only generations of assimilation shift the mix.
//
// Genesis: each cradle founds a culture. Lineage: new settlements carry
// their parent's (or knowledge-donor's) culture. Drift: an isolated
// overseas colony that loses living contact with its homeland diverges
// into a daughter culture; subject peoples assimilate slowly toward
// their ruler's culture at a rate set by the state's organization.
//
// Cultures never die — a people can fade from every mixture, but the
// record (and its history) persists.

import { foundLanguage, branchLanguage, driftLanguage, borrowFrom, getLanguage, langWord, langRealmName, langPersonName, langDynastyName } from "../language.js";
import { hash32, entityRng } from "./rng.js";
import { logEvent } from "./events.js";
import { getPolity } from "./entities.js";
import { forEachNear } from "./spatialGrid.js";

export const CULTURE_INTERVAL = 150;      // ticks between assimilation/divergence passes (≈ polity cadence)
const ASSIM_RATE = 0.012;                 // per-pass share shift toward the state culture (×org, ×interval/150)
const DIVERGE_AFTER = 6000;               // ticks of overseas isolation before a colony's culture diverges
const MIX_K = 4;                          // mixture components kept per settlement (rest folds into dominant)

export function culturesOf(world) {
  return world.cultures || (world.cultures = new Map());
}
export function getCulture(world, id) {
  return id != null && id >= 0 && world.cultures ? world.cultures.get(id) || null : null;
}

// A culture's tongue is a LIVING entity (world.languages, language.js):
// it drifts, branches when peoples diverge, and borrows under contact.
export function languageOf(world, culture) {
  let l = getLanguage(world, culture.languageId);
  if (!l) {
    l = foundLanguage(world, { seed: culture.langSeed });
    culture.languageId = l.id;
  }
  return l;
}

/** Coin a name in this culture's tongue; the per-culture counter keeps
 *  names order-independent and (within a world) collision-free. */
export function nameFor(world, culture, kind, base) {
  const lang = languageOf(world, culture);
  const n = culture.nameCounter++;
  if (kind === "realm") return langRealmName(lang, n, base);
  if (kind === "person") return langPersonName(lang, n, base === "f");
  if (kind === "dynasty") return langDynastyName(lang, n, base);
  return langWord(lang, n);
}

export function foundCulture(world, { origin, parentCultureId = -1 } = {}) {
  const reg = culturesOf(world);
  const id = world._nextCultureId || 1;
  world._nextCultureId = id + 1;
  const langSeed = hash32(world.seed || 1, "lang", id);
  const c = {
    id, langSeed, languageId: -1,
    name: null,
    parentCultureId,
    originSettlementId: origin ? origin.id : -1,
    foundedStep: world.step | 0,
    nameCounter: 1,
    hue: (id * 137.508) % 360,            // golden-angle spread
  };
  // The tongue: a daughter people's language BRANCHES from the parent's
  // (a dialect hardening into a language); a root people gets a fresh one.
  const parent = getCulture(world, parentCultureId);
  const plang = parent ? languageOf(world, parent) : null;
  const lang = plang ? branchLanguage(world, plang) : foundLanguage(world, { seed: langSeed });
  c.languageId = lang.id;
  // A culture names ITSELF in its own tongue (endonym).
  c.name = langWord(lang, 0);
  reg.set(id, c);
  logEvent(world, "culture.born", {
    culture: id, cultureName: c.name,
    parent: parentCultureId, parentName: parentCultureId >= 0 ? (getCulture(world, parentCultureId) || {}).name : undefined,
    s: origin ? origin.id : -1,
    x: origin ? origin.pos.x | 0 : undefined, y: origin ? origin.pos.y | 0 : undefined,
  });
  return c;
}

// ── population mixture helpers ───────────────────────────────────────────
export function dominantCulture(s) {
  return s.culMix && s.culMix.length ? s.culMix[0][0] : (s.cultureId ?? -1);
}

function normalizeMix(mix) {
  mix.sort((a, b) => b[1] - a[1]);
  if (mix.length > MIX_K) {   // fold the tail into the dominant share
    let tail = 0;
    for (let i = MIX_K; i < mix.length; i++) tail += mix[i][1];
    mix.length = MIX_K;
    mix[0][1] += tail;
  }
  let sum = 0;
  for (const e of mix) sum += e[1];
  if (sum > 0 && Math.abs(sum - 1) > 1e-9) for (const e of mix) e[1] /= sum;
  return mix;
}

/** Shift `frac` of a settlement's people toward culture `cid`. */
export function mixToward(s, cid, frac) {
  if (cid == null || cid < 0 || !(frac > 0)) return;
  if (!s.culMix) s.culMix = [[s.cultureId ?? cid, 1]];
  const mix = s.culMix;
  const scale = 1 - frac;
  let entry = null;
  for (const e of mix) { e[1] *= scale; if (e[0] === cid) entry = e; }
  if (entry) entry[1] += frac; else mix.push([cid, frac]);
  normalizeMix(mix);
  s.cultureId = mix[0][0];
}

/** Initialize a newborn settlement's culture from its founder stock. */
export function seedCulture(world, s, cultureId) {
  s.cultureId = cultureId ?? -1;
  s.culMix = cultureId != null && cultureId >= 0 ? [[cultureId, 1]] : [];
  if (!s.faithMix) s.faithMix = [];
}

// ── the periodic culture pass ───────────────────────────────────────────
// Assimilation: a settlement whose dominant culture differs from its
// ruler's drifts toward the state culture — faster under an organized
// bureaucracy, never instant (centuries, not passes). Divergence: an
// overseas colony out of living contact with its own people for
// DIVERGE_AFTER ticks becomes a NEW people (daughter culture).
const LANG_DRIFT_EVERY = 2600;     // ≈ ticks between sound changes per tongue
export function updateCultures(world) {
  // ── living languages: slow sound change; borrowing under contact ──
  if (world.cultures) {
    for (const cul of world.cultures.values()) {
      const lang = languageOf(world, cul);
      const due = (cul._lastDrift ?? cul.foundedStep) + LANG_DRIFT_EVERY / (world._dt || 1);
      if (world.step >= due) {
        cul._lastDrift = world.step;
        const before = langWord(lang, 1);
        driftLanguage(world, lang);
        logEvent(world, "language.shift", { culture: cul.id, cultureName: cul.name,
          was: before, now: langWord(lang, 1) });
      }
    }
    // contact: a settlement whose population is a real MIXTURE of two
    // peoples lets the larger group's tongue borrow from the smaller's.
    for (const s of world.settlements) {
      if (s.mode !== "settled" || !s.culMix || s.culMix.length < 2) continue;
      if (s.culMix[1][1] < 0.25) continue;
      if ((s._lastBorrow ?? 0) + 6000 / (world._dt || 1) > world.step) continue;
      const a = getCulture(world, s.culMix[0][0]), b = getCulture(world, s.culMix[1][0]);
      if (!a || !b) continue;
      s._lastBorrow = world.step;
      borrowFrom(world, languageOf(world, a), languageOf(world, b));
    }
  }
  // (Called every _ivl(CULTURE_INTERVAL) ticks — the interval stretches with
  // SIM_GRANULARITY, so per-pass rates below stay calibrated per history-time.)
  // refresh each polity's culture from its capital's dominant people
  if (world.countries) {
    for (const c of world.countries.values()) {
      const p = getPolity(world, c.id);
      if (p && c.capital) p.cultureId = dominantCulture(c.capital);
    }
  }
  for (const s of world.settlements) {
    if (s.mode !== "settled") continue;
    if (!s.culMix || !s.culMix.length) continue;

    // assimilation toward the state culture
    if (s.countryId >= 0) {
      const p = getPolity(world, s.countryId);
      const stateCul = p ? p.cultureId : -1;
      if (stateCul >= 0 && dominantCulture(s) !== stateCul) {
        const cap = world.countries && world.countries.get(s.countryId);
        const org = cap && cap.capital && cap.capital.knowledge ? (cap.capital.knowledge.organization || 0) : 0;
        mixToward(s, stateCul, ASSIM_RATE * (0.4 + org));
      }
    }

    // divergence: ANY community out of living contact with its own people
    // becomes a people of its own in time (overseas colonies fastest —
    // an ocean is the sharpest isolator).
    if (!s._diverged) {
      const myCul = dominantCulture(s);
      let contact = false;
      if (s._tradeReach) {
        for (const pid of s._tradeReach.keys()) {
          const peer = world._byId && world._byId.get(typeof pid === "number" ? pid : +pid);
          if (peer && peer.mode === "settled" && dominantCulture(peer) === myCul && peer.id !== s.id) { contact = true; break; }
        }
      }
      if (!contact && s._seaReach) {
        for (const pid of s._seaReach.keys()) {
          const peer = world._byId && world._byId.get(typeof pid === "number" ? pid : +pid);
          if (peer && peer.mode === "settled" && dominantCulture(peer) === myCul && peer.id !== s.id) { contact = true; break; }
        }
      }
      if (contact) { s._isolatedSince = undefined; continue; }
      if (s._isolatedSince === undefined) { s._isolatedSince = world.step; continue; }
      const divAfter = (s._isColony ? DIVERGE_AFTER : DIVERGE_AFTER * 2.2) / (world._dt || 1);
      if (world.step - s._isolatedSince > divAfter) {
        const parent = getCulture(world, myCul);
        const daughter = foundCulture(world, { origin: s, parentCultureId: myCul });
        // language relationship is implicit: daughter seeds a fresh tongue,
        // history records the lineage (parentCultureId + culture.born event)
        seedCulture(world, s, daughter.id);
        s._diverged = true;
        // the new people's homeland: same-stock neighbours join the daughter
        forEachNear(world, s.pos.x, s.pos.y, 16, (nb) => {
          if (nb !== s && nb.mode === "settled" && dominantCulture(nb) === myCul) {
            seedCulture(world, nb, daughter.id);
            nb._diverged = true;
          }
        });
        logEvent(world, "culture.diverged", {
          culture: daughter.id, cultureName: daughter.name,
          parent: myCul, parentName: parent ? parent.name : undefined,
          s: s.id, sName: s.name, polity: s.countryId,
        });
      }
    }
  }
}

/** The culture a brand-new settlement inherits at a given site: its
 *  parent's, else the knowledge-donor's, else a fresh frontier culture. */
export function inheritCultureAt(world, donor) {
  if (donor && donor.culMix && donor.culMix.length) return dominantCulture(donor);
  return -1;
}

// Deterministic per-culture rng hook for later systems (faith rolls, drift)
export function cultureRng(world, cultureId, system) {
  return entityRng(world, system + ".cul", cultureId);
}

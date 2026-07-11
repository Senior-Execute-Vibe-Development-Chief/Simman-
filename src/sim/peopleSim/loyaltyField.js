// ── Ontology V2: the loyalty field — the land remembers, the people attach ──
//
// docs/settlement-ontology.md §V2. The member roster must never proxy for the
// land and its people, so the two slow, popular stocks the roster mis-owned
// move onto the LAND layer, next to _tileCapturedAt (the in-repo precedent for
// tile-anchored political memory):
//
//   _tileHomeland / _tileFellAt  (T.LOYAL_FIELD)
//     Which polity this ground last belonged to, and when it fell — stamped by
//     ONE owner-diff scan per polity pass (recordOccupation semantics on tiles:
//     coming home clears; a re-occupation keeps the ORIGINAL homeland), never
//     by edits at the dozen _countryOwner write sites. Memory attaches to
//     ground, so it outlives the roster: a town founded on old-Poland ground
//     inherits the yearning. Settlements DERIVE s._homeland from the ground
//     under their seat.
//
//   _allegiance  (T.LOYAL_FIELD)
//     The tile-attachment continuum: how far the people of this ground have
//     accepted their CURRENT ruler (0..1). It relaxes toward the
//     administrative condition its county lives under (the governing
//     settlement's s.loyalty stock — which REMAINS the seat's entity stock at
//     every write site: administrative cohesion is a seat property, role 2) at
//     a HABITUATION rate that is identity-coupled (absorbResistance: a wholly
//     foreign ruler is accepted ~×(1-HAB_IDENT) as fast) and ledger-fed
//     (grievance freezes it, alliance speeds it). Detachment runs faster than
//     attachment. On transfer the people stay put: attachment CARRIES a
//     fraction (ATTACH_CARRY) — coming home restores it (HOME_RETURN).
//     ASSIMILATION IS EMERGENT: when attachment completes (HAB_DONE) the
//     ground forgets its old flag — replacing the flat HOMELAND_MEMORY timer
//     under the lever. At the median (covered province, median identity, no
//     grievance) completion lands in the same ~1000-1500-dyn-year band the old
//     timer asserted; the tails now mean something — kin provinces assimilate
//     in centuries, grieved foreign ones effectively never.
//
//   _natGriev  (T.GRIEV_LEDGER)
//     Nation-pair grievance: ordered "H:P" → people of H harmed by P, fed at
//     the harm sites themselves (war tile capture weighted by the popField
//     people on the ground taken — armies.js; the sack of a city — armies.js;
//     razzias on crowned towns — slavery.js), decaying with a ~two-long-
//     generation half-life (GRIEV_HALF) — grievance renews or fades — and
//     ~3× faster between ALLIED dyads (reconciliation; the alliance map
//     already folds trade in, so amity needs no second stock). Read
//     SATURATING against the era's median realm population (smoothed, the
//     _refRevenue pattern): G = harmed / (harmed + frac·medianPop) — era-
//     proof, no absolute people-count constant. Consumed by the habituation
//     rate above and by an "old wounds" term in the unrest pass — the channel
//     pure identity-mixture mismatch could never express (Poland grieved its
//     partitioners nationally, not confessionally).
//
// All rates are stated in DYN-YEARS (calendar.js dynYear: 0.25 y/step at G=1;
// a default polity pass = 37.5 dyn-years) and computed from the pass interval,
// so SIM_GRANULARITY re-timing cancels out. No RNG anywhere; the tile walk is
// a fixed-order pure function of state. Levers off ⇒ nothing allocates,
// nothing runs, saves carry no new keys — byte-identical.

import { T } from "./tuning.js";
import { dynYear } from "../calendar.js";
import { absorbResistance, identityWeightsNow } from "./cohesion.js";

// ── Habituation (dyn-years) ───────────────────────────────────────────────
const HAB_RISE_TAU = 500;  // e-fold time of attachment toward a WELL-GOVERNED condition at median identity;
                           // completion (0.35 → 0.9 under target 1) ≈ 2.2τ ≈ 1100 dyn-years — the band the
                           // old flat HOMELAND_MEMORY timer asserted, now earned and condition-dependent
const DETACH_TAU   = 300;  // e-fold time of DISAFFECTION (target below current): trust is lost faster than built
const HAB_IDENT    = 0.85; // identity coupling: a wholly foreign ruler (absorbResistance 1) habituates at 15% pace
const HAB_GRIEV    = 3;    // grievance freeze: rate ÷ (1 + this × G) — at G=1 habituation runs at a quarter pace
const AMITY_BOOST  = 1.5;  // an ALLIED old-homeland reconciles faster (the ledger's amity side, read live from _allies)
const HAB_DONE     = 0.9;  // attachment at which the ground FORGETS its old flag (emergent assimilation)
// ── Transfer semantics (the owner-diff scan) ──────────────────────────────
const ATTACH_CARRY = 0.25; // a foreign conquest carries this fraction of attachment — the part habituated to
                           // place and order rather than flag; the rest must be re-earned at the rates above
const HOME_RETURN  = 0.85; // coming home restores attachment at least to this (restoreNations' historical stamp)
const WILD_JOIN    = 0.5;  // frontier folk annexed from wilderness start here (the garrison/pacified base)
// ── Consumers ─────────────────────────────────────────────────────────────
export const ATTACH_SECEDE = 0.5;  // a collapsed province secedes only once its PEOPLE are this detached
                                   // (= REVOLT_JOIN_LOYALTY — the same "restless" line contagion uses)
export const GRIEV_UNREST_W = 0.5; // peak "old wounds" unrest contribution (comparable to identity's GRIEVANCE_W)
// ── Ledger (dyn-years / people) ───────────────────────────────────────────
const GRIEV_HALF     = 120;   // half-life of a grievance: two long generations, unless renewed
const AMITY_HALF     = 40;    // half-life between ALLIED dyads: reconciliation forgets ~3× faster
const GRIEV_REF_FRAC = 0.25;  // harm equal to a quarter of the era-median realm's people reads G = 0.5
const GRIEV_MIN      = 0.5;   // ledger entries below half a person are dropped (keeps the map small)
const REF_POP_SMOOTH = 0.25;  // low-pass on the median-realm-pop reference (the _refRevenue pattern)
export const SACK_GRIEV_FRAC = 0.15; // a stormed city: this fraction of its people count harmed (dead, enslaved, scattered)

// Dyn-years elapsed per polity pass — G-invariant: the pass interval stretches
// ×G while the dyn clock slows ×1/G, so the product is the plain product.
const passDynYears = () => T.POLITY_INTERVAL * (dynYear(1) - dynYear(0));

// ── Nation-pair grievance ledger ──────────────────────────────────────────

/** Record that `harmed` people of nation h were harmed by nation p. */
export function feedGrievance(world, h, p, harmed) {
  if (!T.GRIEV_LEDGER || h < 0 || p < 0 || h === p || !(harmed > 0)) return;
  const m = world._natGriev || (world._natGriev = new Map());
  const k = h + ":" + p;
  m.set(k, (m.get(k) || 0) + harmed);
}

/** How aggrieved nation h is at nation p, 0..1 (saturating, era-normalized). */
export function grievOf(world, h, p) {
  if (!T.GRIEV_LEDGER || h < 0 || p < 0 || h === p) return 0;
  const m = world._natGriev;
  if (!m) return 0;
  const raw = m.get(h + ":" + p);
  if (!(raw > 0)) return 0;
  const ref = GRIEV_REF_FRAC * Math.max(1, world._refRealmPop || 0);
  return raw / (raw + ref);
}

/**
 * Per polity pass: decay the ledger (allied dyads reconcile faster) and
 * refresh the era's median-realm-population reference the saturating read
 * normalizes against. Deterministic; O(ledger + realms).
 */
export function updateGrievLedger(world, countries) {
  if (!T.GRIEV_LEDGER) return;
  // Era reference: median MULTI-member realm population (same robust-median +
  // low-pass reasoning as _refCapPower/_refRevenue — one sacked hegemon must
  // not swing what a "people" weighs).
  const pops = [];
  for (const c of countries.values()) {
    if (c.members.length <= 1) continue;
    let p = 0;
    for (const s of c.members) if (s.countryId === c.id) p += Math.max(0, s.people || 0);
    if (p > 0) pops.push(p);
  }
  pops.sort((a, b) => a - b);
  const med = pops.length ? pops[pops.length >> 1] : 0;
  if (med > 0) {
    const prev = world._refRealmPop || 0;
    world._refRealmPop = prev > 0 ? prev + (med - prev) * REF_POP_SMOOTH : med;
  }
  const m = world._natGriev;
  if (!m || !m.size) return;
  const passY = passDynYears();
  const keep = Math.pow(0.5, passY / GRIEV_HALF);
  const keepAllied = Math.pow(0.5, passY / AMITY_HALF);
  const allies = world._allies;
  for (const [k, v] of m) {
    const colon = k.indexOf(":");
    const h = +k.slice(0, colon), p = +k.slice(colon + 1);
    const pals = allies && allies.get(h);
    const nv = v * (pals && pals.has(p) ? keepAllied : keep);
    if (nv < GRIEV_MIN) m.delete(k); else m.set(k, nv);
  }
}

// ── The loyalty field ─────────────────────────────────────────────────────

/**
 * Allocate + SEED the field on first activation (or after a load that carried
 * no field). Seeding mirrors the current entity state — allegiance starts at
 * the governing settlement's administrative stock, and the roster's existing
 * homeland memory is stamped onto its counties — so a mid-run lever flip (or
 * an old save) inherits what the world already knows instead of amnesia.
 * Idempotent; deterministic (a pure function of current state).
 */
function ensureLoyaltyField(world) {
  const N = world.N;
  if (world._allegiance && world._allegiance.length === N) return;
  const alg = world._allegiance = new Float32Array(N);
  const home = world._tileHomeland = new Int32Array(N).fill(-1);
  const fell = world._tileFellAt = new Float64Array(N).fill(-Infinity);
  const prev = world._tileOwnerPrev = new Int32Array(N).fill(-1);
  const co = world._countryOwner, owner = world._territoryOwner, byId = world._byId;
  if (co) prev.set(co);
  if (!co || !owner || !byId) return;
  for (let ti = 0; ti < N; ti++) {
    const cc = co[ti];
    if (cc < 0) continue;
    const s = byId.get(owner[ti]);
    if (s && s.mode === "settled") {
      alg[ti] = Math.max(0, Math.min(1, s.loyalty ?? 1));
      if ((s._homeland ?? -1) >= 0 && s.countryId === cc) {
        home[ti] = s._homeland;
        fell[ti] = s._homelandFell ?? world.step;
      }
    } else {
      alg[ti] = WILD_JOIN;   // governed ground with no live county settlement
    }
  }
}

/**
 * The V2 pass, called once per polity pass (conquest.js updatePolities):
 *   1. owner-diff SCAN — stamp tile memory + apply transfer semantics to
 *      attachment (recordOccupation, on tiles, at one choke point);
 *   2. HABITUATION — relax each governed tile's attachment toward the
 *      administrative condition of its county, at identity/ledger-coupled
 *      rates; completed attachment forgets the old flag (assimilation);
 *   3. DERIVE — s._attach (county mean) and s._homeland/_homelandFell
 *      (the ground under the seat) for every settled settlement.
 */
export function updateLoyaltyField(world, countries) {
  if (!T.LOYAL_FIELD) return;
  ensureLoyaltyField(world);
  const N = world.N;
  const co = world._countryOwner, owner = world._territoryOwner, byId = world._byId;
  const alg = world._allegiance, home = world._tileHomeland, fell = world._tileFellAt, prev = world._tileOwnerPrev;
  if (!co || !owner || !byId) return;

  // 1. Owner-diff scan: one choke point for every transfer path (war capture,
  // absorption, secession, restoration, border smoothing, death-to-wilderness).
  for (let ti = 0; ti < N; ti++) {
    const cur = co[ti], was = prev[ti];
    if (cur === was) continue;
    prev[ti] = cur;
    if (cur < 0) {
      // Fell to wilderness: the ground remembers the realm that held it.
      if (was >= 0 && home[ti] < 0) { home[ti] = was; fell[ti] = world.step; }
      continue;
    }
    if (home[ti] === cur) {
      // Home again — by any path (reconquest, restoration, a reused id).
      home[ti] = -1; fell[ti] = -Infinity;
      alg[ti] = Math.max(alg[ti], HOME_RETURN);
    } else if (was >= 0) {
      // A foreign hand takes governed ground: keep the ORIGINAL homeland if
      // one is already remembered, else remember who just lost it.
      if (home[ti] < 0) { home[ti] = was; fell[ti] = world.step; }
      alg[ti] *= ATTACH_CARRY;
    } else {
      // Annexed from wilderness: frontier folk join at the garrison base —
      // unless this is remembered ground coming home (handled above).
      alg[ti] = Math.max(alg[ti], WILD_JOIN);
    }
  }

  // 2. Habituation. Per-member rates once (identity vs the ruler's core),
  // then a flat O(N) tile walk with cached per-(homeland,ruler) ledger factors.
  const passY = passDynYears();
  const idW = identityWeightsNow(world);
  const allies = world._allies;
  // settlement id → rise rate (per pass, identity-coupled); country id → its
  // capital's rise rate + the realm's mean administrative condition (the
  // target for tiles with no live county settlement).
  const riseOf = new Map(), capRise = new Map(), meanLoyal = new Map();
  for (const c of countries.values()) {
    const cap = c.capital;
    let sum = 0, n = 0;
    for (const m of c.members) {
      if (m.countryId !== c.id) continue;
      const res = cap && m !== cap ? absorbResistance(cap, m, idW) : 0;
      riseOf.set(m.id, 1 - Math.exp(-passY * (1 - HAB_IDENT * res) / HAB_RISE_TAU));
      sum += Math.max(0, Math.min(1, m.loyalty ?? 1)); n++;
    }
    capRise.set(c.id, 1 - Math.exp(-passY / HAB_RISE_TAU));
    meanLoyal.set(c.id, n ? sum / n : WILD_JOIN);
  }
  const detach = 1 - Math.exp(-passY / DETACH_TAU);
  const gf = new Map();   // "h:p" → grievance/amity habituation factor (cached per pass)
  const grievFactor = (h, p) => {
    if (!T.GRIEV_LEDGER || h < 0) return 1;
    const k = h + ":" + p;
    let f = gf.get(k);
    if (f === undefined) {
      f = 1 / (1 + HAB_GRIEV * grievOf(world, h, p));
      const pals = allies && allies.get(h);
      if (pals && pals.has(p)) f *= AMITY_BOOST;
      gf.set(k, f);
    }
    return f;
  };
  // County accumulators for the derive (mean attachment over each member's tiles).
  const accA = new Map(), accN = new Map();
  for (let ti = 0; ti < N; ti++) {
    const cc = co[ti];
    if (cc < 0) continue;
    const m = byId.get(owner[ti]);
    const governed = m && m.mode === "settled" && m.countryId === cc;
    const target = governed ? Math.max(0, Math.min(1, m.loyalty ?? 1)) : (meanLoyal.get(cc) ?? WILD_JOIN);
    const cur = alg[ti];
    if (target > cur) {
      const base = governed ? (riseOf.get(m.id) ?? capRise.get(cc) ?? 0) : (capRise.get(cc) ?? 0);
      alg[ti] = cur + base * grievFactor(home[ti], cc) * (target - cur);
    } else if (target < cur) {
      alg[ti] = cur + detach * (target - cur);
    }
    // Emergent assimilation: fully-attached ground forgets its old flag.
    if (home[ti] >= 0 && alg[ti] >= HAB_DONE) { home[ti] = -1; fell[ti] = -Infinity; }
    if (governed) {
      accA.set(owner[ti], (accA.get(owner[ti]) || 0) + alg[ti]);
      accN.set(owner[ti], (accN.get(owner[ti]) || 0) + 1);
    }
  }

  // 3. Derive the settlement-level readings from the ground.
  const tw = world.tw;
  for (const s of world.settlements) {
    if (s.mode !== "settled") continue;
    const ti = (s.pos.y | 0) * tw + (s.pos.x | 0);
    const n = accN.get(s.id);
    s._attach = n ? (accA.get(s.id) || 0) / n : (ti >= 0 && ti < N ? alg[ti] : (s.loyalty ?? 1));
    if (ti < 0 || ti >= N) continue;
    const h = home[ti];
    if (h >= 0 && h !== s.countryId) { s._homeland = h; s._homelandFell = fell[ti]; }
    else { s._homeland = -1; s._homelandFell = -1; }
  }
}

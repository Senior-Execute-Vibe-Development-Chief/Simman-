// ── T.LAND_KNOW: the countryside learns (2026-08-20) ─────────────────────────
// The pre-urban knowledge ledger — the owner's architecture question made
// mechanism: "the sim still depends on settlements for statecraft, knowledge,
// people. why?" People already live OFF entities (popField); farming technique
// already lives ON THE LAND (devField, hearth seeds). This module moves the
// remaining pre-urban knowledge there too, so the causality inverts to match
// history: CITIES BECOME AN OUTPUT OF THE LAND'S ACCUMULATED DEVELOPMENT
// instead of the carriers of it. Prehistory is then literally entity-free —
// no cities, no roads, no bordered nations — until a basin's own people can
// COUNT (the tallies bar, tech.js URBAN_ORG), at which moment the gathered
// proto-urban pile mints the first city, and the tablet (writing, RECORDS_ORG)
// follows on the newborn court. Çatalhöyük → Uruk → the state, from one law.
//
// THE CARRIER is a per-basin LEDGER keyed to the static urban-site lattice
// (crystallize.js labelSiteLedger — one hydro-anchor site per market cell): a
// record is planted the first time a basin qualifies as a peopled, farming
// community (exactly the gates the city/nation doors already sat), and its six
// knowledge tracks then grow by a VILLAGE-SIMPLIFIED form of the settlement
// law (settlement.js updateKnowledge) — same tuning constants, same track
// shapes, same era ceiling (tech.js orgEraCapOf), minus the urban machinery a
// village world does not have (no trade reach, no rival courts, no scribes, no
// ruler). Deliberate simplifications, each a physical claim:
//   · agriculture is READ from devField — the technique wave IS village
//     agronomy (hearth-seed practice already improves it at the source).
//   · ore is read over the EXCHANGE SPHERE (EXCH_KM): Neolithic hand-to-hand
//     networks moved obsidian and copper hundreds of km (Anatolian obsidian in
//     the Levant; Sumer smelted with no ore of its own) — a village world has
//     no roads yet, but it has neighbours.
//   · winter aptitude reads the site's own selection target (seasonalSelect):
//     the resident people have lived there for generations, so their heritable
//     aptitude ≈ what the climate selects for.
//   · organization compounds only under PRESSURE (the ORG_CONTACT re-base,
//     cage × storable-ceiling — Carneiro's pristine lane) or an existing
//     STATE'S EXAMPLE in the basin's own market cell (the secondary lane), so
//     the cradles lead and the open periphery waits — the state frontier the
//     2026-08-11 wave measured, now starting at the village layer.
//
// A record freezes the moment its cell seats a settlement (the court carries
// knowledge from there — updateKnowledge), and the newborn is SEEDED from the
// ledger (per-track max with the inherit path), so the handoff is continuous:
// the basin's own learning is the city's birthright. Off-lever this module is
// inert and every door reads exactly as before (byte-identical).
import { T, rNormPop } from "./tuning.js";
import { URBAN_ORG, orgEraCapOf, techState } from "./tech.js";
import { oreTier, seasonalSelect, computeWaterAccess, birthOrgAt, TIER_CORE } from "./settlement.js";
import { cageAt } from "./cageField.js";
import { bestPackageAt } from "./agriculture.js";
import { CROP_BY_ID } from "../cropPackages.js";
import { labelSiteLedger, labelBasinMass, siteClaims, URBAN_SHARE_REF } from "./crystallize.js";

const LK_IVL = 25;          // growth cadence, steps (matches the site pass SITE_CITY_IVL)
const LK_SWEEP_IVL = 100;   // state-contact sweep cadence (one O(N) pass)
// The Neolithic/Chalcolithic exchange sphere: how far ore and its working
// travelled between villages hand-to-hand, before any road or port existed —
// Anatolian obsidian reached the southern Levant (~700 km), Balkan copper
// crossed the Danube world, Sumer's copper walked in from the Zagros/Gulf.
// This is what lets an alluvial cradle (Nile, Sumer — ore-poor by nature)
// climb the material ladder its own floodplain cannot supply.
const EXCH_KM = 500;
const EARTH_KM = 40075;
// A village world's learning efficiency relative to a court of the same era —
// no specialist class, no market of ideas; the density term below carries the
// rest of the swing. Calibrated against the measured proto-city org pace (the
// entities this ledger replaces WERE that village world, mislabeled).
const VILLAGE_LEARN = 1.0;

const KNOW_TRACKS = ["agriculture", "construction", "organization", "metallurgy", "navigation", "mobility"];
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

export function ensureLandKnow(world) {
  let m = world._landKnow;
  if (!m) m = world._landKnow = new Map();
  return m;
}

export function landKnowRec(world, ti) {
  const m = world._landKnow;
  return m ? m.get(ti) || null : null;
}

/** Static site geography for a ledger record — pure functions of terrain and
 *  deposits, computed once at planting (and re-derived on load, exactly). */
function deriveStatics(world, rec) {
  const { tw, th, deposits } = world;
  const ti = rec.ti, y = (ti / tw) | 0, x = ti - y * tw;
  const rn = rNormPop(world);
  // Exchange-sphere ore: best grade of each smeltable within EXCH_KM.
  const rx = Math.max(1, Math.round(EXCH_KM / (EARTH_KM / tw)));
  const ore = { copper: 0, tin: 0, iron: 0, coal: 0 };
  if (deposits) {
    for (const id of Object.keys(ore)) {
      const arr = deposits[id];
      if (!arr) continue;
      let best = 0;
      for (let dy = -rx; dy <= rx; dy++) {
        const ny = y + dy; if (ny < 0 || ny >= th) continue;
        const row = ny * tw;
        for (let dx = -rx; dx <= rx; dx++) {
          if (dx * dx + dy * dy > rx * rx) continue;
          const v = arr[row + (((x + dx) % tw) + tw) % tw] || 0;
          if (v > best) best = v;
        }
      }
      ore[id] = best;
    }
  }
  // Local materials + herds: the seed-box radius (bulk goods stay local).
  const rb = Math.max(1, Math.round(3 * rn));
  const loc = { timber: 0, stone: 0, horses: 0 };
  if (deposits) {
    for (const id of Object.keys(loc)) {
      const arr = deposits[id];
      if (!arr) continue;
      let best = 0;
      for (let dy = -rb; dy <= rb; dy++) {
        const ny = y + dy; if (ny < 0 || ny >= th) continue;
        const row = ny * tw;
        for (let dx = -rb; dx <= rb; dx++) {
          const v = arr[row + (((x + dx) % tw) + tw) % tw] || 0;
          if (v > best) best = v;
        }
      }
      loc[id] = best;
    }
  }
  rec.ore = ore;
  rec.timber = loc.timber; rec.stone = loc.stone; rec.horses = loc.horses;
  rec.wa = computeWaterAccess(world, x, y).wa;
  // The land's own storable ceiling (suit × storability of the best
  // domesticable package) — the same axis the city gates read.
  const best = bestPackageAt(world, ti);
  const pkg = best ? CROP_BY_ID[best.id] : null;
  rec.ceil = best ? best.suit * (pkg ? pkg.storability : 1) : 0;
  // Point-read climate (the raw fields — a basin-scale smooth would be nicer
  // but the terms below only need the zone, and the raw read is what
  // updateKnowledge's climateOf effectively sees for a lone village).
  rec.tmp = world.temp ? world.temp[ti] || 0 : 0.5;
  rec.mst = world.moist ? world.moist[ti] || 0 : 0.5;
  rec.cell = labelSiteLedger(world).siteId[ti];
  return rec;
}

/** Plant (or fetch) the ledger record for a qualifying basin's site tile.
 *  Called from the doors that already proved the basin is peopled and farming
 *  (city eligibility, land-nation formation) — never speculatively. */
export function ensureLedgerAt(world, ti) {
  if (!T.LAND_KNOW) return null;
  const m = ensureLandKnow(world);
  let rec = m.get(ti);
  if (rec) return rec;
  const tw = world.tw, y = (ti / tw) | 0, x = ti - y * tw;
  rec = {
    ti,
    born: world.step,
    // The genesis-village package (one definition with inheritKnowledgeAt):
    // a people that farms owns the pot and the granary; organization starts
    // where a founding community's site demands (ORG_BIRTH_VAR), the same
    // birth law settlements read.
    k: {
      agriculture: world.devField ? world.devField[ti] || 0 : 0,
      construction: 0.18,
      organization: birthOrgAt(world, x, y, 0.1),
      metallurgy: 0, navigation: 0, mobility: 0,
    },
  };
  deriveStatics(world, rec);
  m.set(ti, rec);
  return rec;
}

/** Rebuild statics for loaded records (saves carry only {ti, k, born}), and
 *  re-derive the cached land era so the ribbon doesn't dip to Stone for the
 *  first growth interval after a load. */
export function rederiveLandKnow(world) {
  const m = world._landKnow;
  if (!m) return;
  let lkEra = 0;
  for (const rec of m.values()) {
    deriveStatics(world, rec);
    const e = techState(rec.k).era;
    if (e > lkEra) lkEra = e;
  }
  world._lkEra = lkEra;
}

/** Per-track max over all live records — the land's leading knowledge, for
 *  the era readouts (chronicle _eraAt, HUD leadingEra) while no court exists.
 *  Null when the ledger is empty. */
export function landKnowLeadK(world) {
  const m = world._landKnow;
  if (!T.LAND_KNOW || !m || !m.size) return null;
  const out = { agriculture: 0, construction: 0, organization: 0, metallurgy: 0, navigation: 0, mobility: 0 };
  for (const rec of m.values()) {
    const k = rec.k;
    for (const t of KNOW_TRACKS) if ((k[t] || 0) > out[t]) out[t] = k[t];
  }
  return out;
}

/** The growth pass: every LK_IVL steps, each live (unclaimed-cell) record
 *  learns by the village-simplified settlement law. Deterministic: Map
 *  insertion order (= planting order), no RNG. */
export function stepLandKnow(world) {
  if (!T.LAND_KNOW) return;
  const m = world._landKnow;
  if (!m || !m.size) return;
  if (world.step % LK_IVL !== 0) return;
  const claims = siteClaims(world);
  // State contact per record cell (the secondary org lane): one O(N) sweep at
  // its own cadence marks cells any realm's bordered field has entered —
  // trade, threat and example arrive at the basin's own market.
  let contact = world._lkContact;
  if (T.ORG_CONTACT > 0 && (!contact || world.step - (world._lkContactStep || -Infinity) >= LK_SWEEP_IVL)) {
    contact = world._lkContact || (world._lkContact = new Set());
    contact.clear();
    const co = world._countryOwner;
    if (co) {
      const siteId = labelSiteLedger(world).siteId;
      const cells = new Set();
      for (const rec of m.values()) if (rec.cell >= 0) cells.add(rec.cell);
      for (let i = 0; i < world.N; i++) {
        if (co[i] < 0) continue;
        const k = siteId[i];
        if (k >= 0 && cells.has(k)) contact.add(k);
      }
    }
    world._lkContactStep = world.step;
  }
  const dev = world.devField;
  const tw = world.tw;
  const bridge = world._onePopScale > 0 ? world._onePopScale : 0;
  const basinBarF = bridge > 0 ? (TIER_CORE[2] / URBAN_SHARE_REF) / bridge : Infinity;
  const dtI = (world._dt || 1) * LK_IVL;   // per-firing steps × granularity (the settlement law is per-tick)
  const LB = T.LEARN_BASE;
  let lkEra = 0;
  for (const rec of m.values()) {
    // A seated cell's knowledge lives on its court now — the ledger freezes
    // (and stays, so a later peer/mint in the cell still reads the ground).
    if (rec.cell >= 0 && claims.claimed[rec.cell]) { const e = techState(rec.k).era; if (e > lkEra) lkEra = e; continue; }
    const k = rec.k;
    const y = (rec.ti / tw) | 0, x = rec.ti - y * tw;
    // ── the village science rate ──
    const mass = labelBasinMass(world, x, y);
    const dens = basinBarF < Infinity ? Math.min(1, mass / basinBarF) : 0;
    // MORE MINDS, dispersed: the basin holds a real census (that is what its
    // eligibility MEANS), and the settlement law's specialist terms scale
    // with sqrt(minds) — the proto-city entities this ledger replaces carried
    // exactly that term, and dropping it halved the measured climb (first
    // arc run: org 0.22 at 20k where the entity regime made states by ~15k).
    // Same sqrt, same coefficients as updateKnowledge; VILLAGE_LEARN remains
    // the dispersal discount if calibration demands one.
    const vMinds = bridge > 0 ? Math.sqrt(mass * bridge) : 0;
    const winterness = T.ORG_APTITUDE > 0
      ? Math.min(1, Math.max(0, seasonalSelect(rec.tmp, rec.mst) / T.ORG_APT_FULL)) : 0.5;
    const winterSci = Math.max(0.1, 1 + T.WINTER_LEARN * (2 * winterness - 1));
    const sciMul = VILLAGE_LEARN * winterSci * dtI * (0.4 + 0.6 * dens);
    // ── material ladder ──
    const metalCap = oreTier(rec.ore);
    const metalEff = Math.min(k.metallurgy, metalCap);
    // agriculture: the wave is the village's agronomy (max-read, never falls
    // below its own record — a receding wave doesn't unlearn the basin).
    if (dev) { const a = dev[rec.ti] || 0; if (a > k.agriculture) k.agriculture = a; }
    // construction (settlement law, minus the urban-minds term)
    const buildMat = 1 + rec.timber * 0.8 + rec.stone * 0.6;
    const stoneBoost = 1 + rec.stone * 0.6;
    const metalBoost = 1 + metalEff * 1.8;
    k.construction = clamp01(k.construction + LB * 1.0 * sciMul * (1 - k.construction)
      * buildMat * stoneBoost * metalBoost * (1 + k.agriculture * 0.6) * (1 + vMinds * 0.06));
    // metallurgy (thin-ore rule over the exchange sphere)
    if (metalCap > 0 && k.metallurgy < metalCap) {
      const oreRate = Math.max(rec.ore.copper, rec.ore.tin, rec.ore.iron, rec.ore.coal);
      const fuel = 1 + rec.timber * 0.3 + rec.ore.coal * 0.4;
      const headroom = 1 - k.metallurgy / metalCap;
      k.metallurgy = Math.min(metalCap, k.metallurgy +
        LB * 2.6 * sciMul * headroom * (0.5 + 0.5 * oreRate) * fuel * (1 + k.construction * 0.4 + vMinds * 0.04));
    }
    // navigation (water-gated; no fleet/demand — those are port economies)
    if (rec.wa > 0) {
      k.navigation = clamp01(k.navigation + LB * 1.9 * sciMul * (1 - k.navigation)
        * (0.5 + 0.5 * rec.wa) * (1 + k.construction * 0.6 + vMinds * 0.04));
    }
    // mobility (herd-gated; saddle-life needs the food model — a village
    // world merely owns horses)
    if (rec.horses > 0.05) {
      const herd = Math.min(1, rec.horses / 0.2);
      k.mobility = clamp01(k.mobility + LB * 2.2 * sciMul * (1 - k.mobility)
        * (0.5 + 0.5 * herd) * (1 + k.construction * 0.4 + metalEff * 0.6 + vMinds * 0.04));
    }
    // organization: the era ceiling, the climate term, and the PRESSURE
    // re-base — Carneiro's pristine lane (cage × storable ceiling) or an
    // existing state's example in the cell (the secondary lane). Identical in
    // form to the settlement law's pre-state climb (updateKnowledge).
    const orgEraCap = orgEraCapOf(metalCap, k.construction);
    const orgHead = Math.max(0, orgEraCap - k.organization);
    if (orgHead > 0) {
      const tropical = (Math.max(0, rec.tmp - 0.80) / 0.20) * (Math.max(0, rec.mst - 0.55) / 0.45);
      const maritime = rec.wa * Math.max(0, 1 - Math.abs(rec.tmp - 0.62) / 0.25);
      const orgClim = Math.max(0.4, 1 + T.ENV_SPEC * (maritime * 0.3 - tropical * 0.40));
      const aptLearn = T.ORG_APTITUDE > 0 ? Math.max(0.05, 1 + T.ORG_APT_LEARN * (2 * winterness - 1)) : 1;
      let contactMul = 1;
      if (T.ORG_CONTACT > 0) {
        const cageDrv = T.STATE_CAGE ? cageAt(world, rec.ti) * rec.ceil : 0;
        const stateNear = contact && contact.has(rec.cell) ? 1 : 0;
        const drive = Math.min(1, Math.max(cageDrv, stateNear));
        contactMul = (1 + T.ORG_CONTACT * drive) / (1 + T.ORG_CONTACT);
      }
      k.organization = clamp01(k.organization + LB * sciMul * orgClim * orgHead
        * (1 + vMinds * 0.10) * aptLearn * contactMul);
    }
    const e = techState(k).era;
    if (e > lkEra) lkEra = e;
  }
  // The land's era, cached per firing: the MAX over single records' tech eras
  // (never a per-track chimera across basins — the first arc run combined one
  // basin's organization with another's seamanship and rang Bronze early).
  // Read by the HUD leadingEra and the chronicle's era timeline while no
  // court exists; a court's own era supersedes it naturally via max().
  world._lkEra = lkEra;
}

export { URBAN_ORG };
